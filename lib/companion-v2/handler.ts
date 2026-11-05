// mode: "companion-v2" of /api/chat (Cube 2.0). Separate from Cube 1.0's
// "companion" mode: no grid, no flows, no <grid_update>. The reply ends with
// a <ui_action> block that the client validates and persists; the model and
// this handler never write conversation data.
//
// Called from app/api/chat/route.ts after its approval check (hasAnyRole).

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { startTextStream } from '@/lib/anthropic-stream';
import { serializePlaybook } from './playbook-json.mjs';
import { MAX_FILES_PER_PART } from './playbook-patch';
import {
  buildContributorSystem,
  buildSystemBlocks,
  kickoffMessage,
  loadAdopterInstructions,
  loadContributorInstructions,
  renderAssets,
  renderPlaybook,
  renderUserFacts,
} from './prompt';
import type { AssetRow, CompanionContext, JobRow, JobStateRow, PlaybookRow } from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';
const ADOPTER_MAX_TOKENS = 2048;
// Fits inside the 300 s function limit (Vercel Hobby). Raise with maxDuration on Pro.
const CONTRIBUTOR_MAX_TOKENS = 8000;
// Contributor chats are never stored, so the client sends the history. These
// bound what one request may carry.
const CONTRIB_MAX_MESSAGES = 40;
const CONTRIB_MAX_MESSAGE_CHARS = 60_000;
const CONTRIB_MAX_HISTORY_CHARS = 300_000;
const CONTRIB_MAX_FILES = MAX_FILES_PER_PART;
/** One part of an upload (the client splits at 120k characters). */
const CONTRIB_MAX_FILE_CHARS = 130_000;
const MAX_HISTORY = 40;
const MAX_USER_CHARS = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dailyCap(role: 'adopter' | 'contributor'): number {
  const raw = role === 'adopter' ? process.env.COMPANION_DAILY_MESSAGE_CAP : process.env.COMPANION_DAILY_CONTRIBUTOR_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : role === 'adopter' ? 60 : 40;
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// Neutral stand-ins for a history that starts with Cube's message. The API
// needs a user turn first; these say what happened without re-issuing the
// kickoff instruction ("first visit, ask about their situation").
const OPENED_BY_CUBE = '[Cube opened this conversation.]';
const EARLIER_OMITTED = '[Earlier messages in this conversation are not shown.]';

export async function handleCompanionV2(body: Record<string, unknown>, supabase: SupabaseClient): Promise<Response> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { error: 'Please sign in.' });

  const role = body.role === 'contributor' ? 'contributor' : body.role === 'adopter' ? 'adopter' : null;
  const playbookId = typeof body.playbookId === 'string' && UUID.test(body.playbookId) ? body.playbookId : null;
  if (!role || !playbookId) return json(400, { error: 'Invalid request.' });

  // Membership (RLS: own row only) decides what the caller may do here.
  const { data: member } = await supabase
    .from('playbook_members')
    .select('id, member_role, project_role')
    .eq('playbook_id', playbookId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return json(403, { error: 'Open the playbook first.' });

  if (role === 'contributor') {
    if (member.member_role !== 'contributor') return json(403, { error: 'Only contributors can update the playbook.' });
    return handleContributor(body, supabase, playbookId);
  }

  return handleAdopter(body, supabase, playbookId, member as { id: string; project_role: string });
}

/** Keeps a file name safe inside an attribute: no quotes, brackets or line breaks. */
const safeName = (n: string) => n.replace(/["<>\r\n]/g, ' ').trim().slice(0, 200) || 'file';

/**
 * Update with Cube. Nothing is stored: the history comes from the client and
 * uploaded file text is placed in the last user turn only (never in the
 * cached system prompt, never logged). The reply ends with <playbook_patch>,
 * which the client turns into a diff for the contributor to review.
 */
async function handleContributor(body: Record<string, unknown>, supabase: SupabaseClient, playbookId: string): Promise<Response> {
  const bad = () => json(400, { error: 'Invalid request.' });

  const raw = Array.isArray(body.messages) ? body.messages : null;
  if (!raw || !raw.length || raw.length > CONTRIB_MAX_MESSAGES) return bad();
  const messages: ChatMessage[] = [];
  let total = 0;
  for (const [i, m] of raw.entries()) {
    const r = m as Record<string, unknown> | null;
    const want = i % 2 === 0 ? 'user' : 'assistant';
    if (!r || r.role !== want || typeof r.content !== 'string') return bad();
    const content = r.content.trim();
    if (!content || content.length > CONTRIB_MAX_MESSAGE_CHARS) return bad();
    total += content.length;
    messages.push({ role: want, content });
  }
  if (messages[messages.length - 1].role !== 'user' || total > CONTRIB_MAX_HISTORY_CHARS) return bad();

  // Files for this turn only (one part of an upload).
  const files: { name: string; text: string }[] = [];
  if (body.files !== undefined) {
    if (!Array.isArray(body.files) || body.files.length > CONTRIB_MAX_FILES) return bad();
    let chars = 0;
    for (const f of body.files) {
      const r = f as Record<string, unknown> | null;
      if (!r || typeof r.name !== 'string' || typeof r.text !== 'string' || !r.text.trim()) return bad();
      chars += r.text.length;
      files.push({ name: safeName(r.name), text: r.text });
    }
    if (chars > CONTRIB_MAX_FILE_CHARS) return bad();
  }
  const part = body.part as { index?: unknown; total?: unknown } | undefined;
  const partLine =
    part && Number.isInteger(part.index) && Number.isInteger(part.total) && (part.total as number) > 1
      ? `\n\n[This is part ${part.index} of ${part.total} of the uploaded material. Propose changes from this part only.]`
      : '';
  if (files.length) {
    const blocks = files
      .map((f) => `<uploaded_file name="${f.name}">\n${f.text.replace(/<\/uploaded_file/gi, '</uploaded-file')}\n</uploaded_file>`)
      .join('\n\n');
    const last = messages[messages.length - 1];
    last.content = `${last.content}${partLine}\n\n${blocks}`;
  }

  const [pbRes, jobsRes] = await Promise.all([
    supabase
      .from('playbooks')
      .select('id, slug, title, description, overview, roles, sequence, source_doc, updated_at')
      .eq('id', playbookId)
      .maybeSingle(),
    supabase
      .from('playbook_jobs')
      .select('job_code, name, position, stages, work_area, job_type, body')
      .eq('playbook_id', playbookId),
  ]);
  const failed = [pbRes, jobsRes].find((r) => r.error);
  if (failed) {
    console.error('[companion-v2 contributor] load failed:', failed.error);
    return json(500, { error: 'Could not load the playbook.' });
  }
  const playbook = pbRes.data as PlaybookRow | null;
  if (!playbook) return json(404, { error: 'Unknown playbook.' });

  const { data: allowed, error: capError } = await supabase.rpc('bump_companion_usage', {
    p_role: 'contributor',
    p_cap: dailyCap('contributor'),
  });
  if (capError) {
    console.error('[companion-v2 contributor] usage counter failed:', capError);
    return json(500, { error: 'Could not check the daily limit.' });
  }
  if (allowed === false) {
    return json(429, {
      error: 'daily_limit',
      message: "You've reached today's limit for Update with Cube. It resets at midnight UTC.",
    });
  }

  const system = buildContributorSystem({
    instructions: await loadContributorInstructions(),
    playbookJson: serializePlaybook({
      slug: playbook.slug,
      title: playbook.title,
      description: playbook.description,
      overview: playbook.overview,
      roles: playbook.roles,
      sequence: playbook.sequence,
      jobs: jobsRes.data ?? [],
    }),
    sourceDoc: playbook.source_doc,
  });

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: CONTRIBUTOR_MAX_TOKENS,
      system,
      messages,
    });
    return await startTextStream(stream, { label: 'companion-v2 contributor' });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /prompt is too long|too many tokens|context/i.test(err.message)) {
      console.error('[companion-v2 contributor] prompt too long:', err.message);
      return json(413, {
        error: 'too_long',
        message:
          'This is too much for Cube to read at once. Start over to clear the conversation, or upload less material at a time.',
      });
    }
    if (err instanceof Anthropic.APIError) console.error(`[companion-v2 contributor] API error ${err.status}:`, err.message);
    else console.error('[companion-v2 contributor] failed before streaming:', err);
    return json(503, { error: 'model_unavailable', message: "Cube couldn't answer just now. Please try again." });
  }
}

async function handleAdopter(
  body: Record<string, unknown>,
  supabase: SupabaseClient,
  playbookId: string,
  member: { id: string; project_role: string }
): Promise<Response> {
  const conversationId =
    typeof body.conversationId === 'string' && UUID.test(body.conversationId) ? body.conversationId : null;
  if (!conversationId) return json(400, { error: 'Invalid request.' });

  // Only the new message comes from the client. History is read from the
  // database (RLS: the caller's own conversation), never trusted from the client.
  const kickoff = body.kickoff === true;
  const userText = typeof body.message === 'string' ? body.message.trim() : '';
  if (kickoff ? userText : !userText || userText.length > MAX_USER_CHARS) {
    return json(400, { error: 'Invalid request.' });
  }
  const focusJob = typeof body.focusJob === 'string' ? body.focusJob : null;

  const [pbRes, jobsRes, assetsRes, convRes, statesRes, countRes] = await Promise.all([
    supabase
      .from('playbooks')
      .select('id, slug, title, description, overview, roles, sequence, source_doc, updated_at')
      .eq('id', playbookId)
      .maybeSingle(),
    supabase
      .from('playbook_jobs')
      .select('job_code, name, position, stages, work_area, job_type, body')
      .eq('playbook_id', playbookId),
    supabase
      .from('assets')
      .select('id, title, kind, url, storage_path, description, job_codes')
      .eq('playbook_id', playbookId),
    supabase
      .from('companion_conversations')
      .select('id, context')
      .eq('id', conversationId)
      .eq('member_id', member.id)
      .maybeSingle(),
    supabase.from('member_job_states').select('job_code, state, note, set_by').eq('member_id', member.id),
    supabase
      .from('companion_messages')
      .select('role, content', { count: 'exact' })
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY),
  ]);

  const failed = [pbRes, jobsRes, assetsRes, convRes, statesRes, countRes].find((r) => r.error);
  if (failed) {
    console.error('[companion-v2] load failed:', failed.error);
    return json(500, { error: 'Could not load the playbook.' });
  }
  const playbook = pbRes.data as PlaybookRow | null;
  const conversation = convRes.data as { id: string; context: CompanionContext } | null;
  if (!playbook) return json(404, { error: 'Unknown playbook.' });
  if (!conversation) return json(404, { error: 'Unknown conversation.' });

  const jobs = ((jobsRes.data ?? []) as JobRow[]).sort(
    (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.job_code.localeCompare(b.job_code, 'en', { numeric: true })
  );
  const context = conversation.context ?? {};
  const total = countRes.count ?? 0;
  const history = ((countRes.data ?? []) as ChatMessage[]).reverse();

  // The model's input. A kickoff (Cube opens the conversation) is only allowed
  // on an empty conversation.
  let messages: ChatMessage[];
  if (kickoff) {
    if (total > 0) return json(400, { error: 'Invalid request.' });
    messages = [{ role: 'user', content: kickoffMessage(Object.keys(context).length > 0) }];
  } else {
    const lead: ChatMessage[] =
      history[0]?.role === 'assistant'
        ? [{ role: 'user', content: total > history.length ? EARLIER_OMITTED : OPENED_BY_CUBE }]
        : [];
    messages = [...lead, ...history, { role: 'user', content: userText }];
  }

  // Every model call counts toward the daily cap, kickoffs included (one per
  // conversation in normal use), so no path reaches the model uncounted.
  const { data: allowed, error: capError } = await supabase.rpc('bump_companion_usage', {
    p_role: 'adopter',
    p_cap: dailyCap('adopter'),
  });
  if (capError) {
    console.error('[companion-v2] usage counter failed:', capError);
    return json(500, { error: 'Could not check the daily limit.' });
  }
  if (allowed === false) {
    return json(429, {
      error: 'daily_limit',
      message: "You've reached today's limit for messages to Cube. It resets at midnight UTC.",
    });
  }

  const system = buildSystemBlocks({
    instructions: await loadAdopterInstructions(),
    playbookText: renderPlaybook(playbook, jobs),
    sourceDoc: playbook.source_doc,
    assetsText: renderAssets((assetsRes.data ?? []) as AssetRow[], jobs),
    userText: renderUserFacts({
      projectRole: member.project_role,
      context,
      jobStates: (statesRes.data ?? []) as JobStateRow[],
      jobs,
      focusJob,
    }),
  });

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: ADOPTER_MAX_TOKENS,
      system,
      messages,
    });
    return await startTextStream(stream, { label: 'companion-v2' });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[companion-v2] rate limited:', err.message);
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[companion-v2] API error ${err.status}:`, err.message);
    } else {
      console.error('[companion-v2] failed before streaming:', err);
    }
    return json(503, { error: 'model_unavailable', message: "Cube couldn't answer just now. Please try again." });
  }
}
