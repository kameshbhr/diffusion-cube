// POST /api/companion-v2/digest  { playbookId, periodDays: 7 | 30 }
//
// Generates the contributor Digest for one playbook and period
// (docs/design/cube2-plan.md section 9). Everything here runs with the
// caller's own Supabase session: the 0037 functions check can_run_digest()
// themselves, so RLS and those checks decide. The service role is not used
// in this route; only the Anthropic call uses the server's key.
//
// One run at a time per playbook (claim_digest_run). A failed run (API
// error, max_tokens stop, unusable output) keeps the previous digest and
// releases the lease; a run that dies (tab closed, timeout) lets the lease
// expire by itself after 5 minutes. Nothing is stored half-way: save_digest
// writes the whole payload in one statement.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { isCube2 } from '@/lib/flags';
import {
  DIGEST_TOOL,
  buildDigestInput,
  toPeriod,
  toStateCounts,
  validateDigest,
  type DigestPayload,
  type RawDigestInput,
  type StateCountRow,
} from '@/lib/companion-v2/digest';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 240_000, maxRetries: 0 });
const MODEL = 'claude-sonnet-4-6';
const PROMPT_FILE = path.join(process.cwd(), 'content', 'companion-v2-digest.md');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY = "The digest couldn't be generated just now. The previous digest is unchanged; please try again.";

/** About 6000. COMPANION_DIGEST_MAX_TOKENS lowers it outside production, to test the max_tokens path. */
function maxTokens(): number {
  const n = Number(process.env.COMPANION_DIGEST_MAX_TOKENS);
  return process.env.NODE_ENV !== 'production' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 6000;
}

function dailyCap(): number {
  const n = Number(process.env.COMPANION_DAILY_CONTRIBUTOR_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(req: Request) {
  if (!isCube2) return json(404, { error: 'Not found.' });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const playbookId = typeof body?.playbookId === 'string' && UUID.test(body.playbookId) ? body.playbookId : null;
  const periodRaw = body?.periodDays;
  if (!playbookId || (periodRaw !== 7 && periodRaw !== 30)) return json(400, { error: 'Invalid request.' });
  const period = toPeriod(periodRaw);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { error: 'Please sign in.' });

  const { data: allowed, error: allowedError } = await supabase.rpc('can_run_digest', { p_playbook_id: playbookId });
  if (allowedError) {
    console.error('[digest] permission check failed:', allowedError);
    return json(500, { error: 'failed', message: RETRY });
  }
  if (allowed !== true) return json(403, { error: 'Only contributors to this playbook can generate its digest.' });

  const { data: runId, error: claimError } = await supabase.rpc('claim_digest_run', { p_playbook_id: playbookId });
  if (claimError) {
    console.error('[digest] claim failed:', claimError);
    return json(500, { error: 'failed', message: RETRY });
  }
  if (!runId) {
    return json(409, {
      error: 'busy',
      message: 'A digest for this playbook is already being generated. Try again in a few minutes.',
    });
  }

  let saved = false;
  try {
    const [inputRes, statesRes, jobsRes] = await Promise.all([
      supabase.rpc('contributor_digest_input', { p_playbook_id: playbookId, p_days: period }),
      supabase.rpc('contributor_job_state_counts', { p_playbook_id: playbookId }),
      supabase.from('playbook_jobs').select('job_code, name, position').eq('playbook_id', playbookId),
    ]);
    const failed = [inputRes, statesRes, jobsRes].find((r) => r.error);
    if (failed || !inputRes.data) {
      console.error('[digest] load failed:', failed?.error ?? 'no input');
      return json(500, { error: 'failed', message: RETRY });
    }

    const jobs = ((jobsRes.data ?? []) as { job_code: string; name: string; position: number | null }[]).sort(
      (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.job_code.localeCompare(b.job_code, 'en', { numeric: true })
    );
    const states = toStateCounts((statesRes.data ?? []) as StateCountRow[]);
    const input = buildDigestInput(inputRes.data as RawDigestInput, jobs, states, period);
    const ctx = { jobCodes: new Set(jobs.map((j) => j.job_code)), states, period, basis: input.basis };

    let payload: DigestPayload;
    if (input.basis.messages_used === 0 && input.basis.gaps_used === 0) {
      // Nothing said in the period: an empty digest, no model call, no cap used.
      payload = validateDigest({}, input.refs, ctx);
    } else {
      const { data: withinCap, error: capError } = await supabase.rpc('bump_companion_usage', {
        p_role: 'contributor',
        p_cap: dailyCap(),
      });
      if (capError) {
        console.error('[digest] usage counter failed:', capError);
        return json(500, { error: 'failed', message: RETRY });
      }
      if (withinCap === false) {
        return json(429, {
          error: 'daily_limit',
          message: "You've reached today's limit for requests to Cube. It resets at midnight UTC.",
        });
      }

      if (process.env.NODE_ENV !== 'production' && process.env.COMPANION_DIGEST_FAIL === '1') {
        throw new Error('Injected failure (COMPANION_DIGEST_FAIL)');
      }

      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens(),
        system: (await readFile(PROMPT_FILE, 'utf-8')).trim(),
        tools: [DIGEST_TOOL],
        tool_choice: { type: 'tool', name: DIGEST_TOOL.name },
        messages: [{ role: 'user', content: input.text }],
      });

      // A max_tokens stop means the tool input was cut off: a failed run.
      if (message.stop_reason === 'max_tokens') {
        console.error('[digest] stopped at max_tokens');
        return json(502, { error: 'too_long', message: RETRY });
      }
      const tool = message.content.find((b) => b.type === 'tool_use');
      if (!tool || tool.type !== 'tool_use') {
        console.error('[digest] no tool output, stop_reason:', message.stop_reason);
        return json(502, { error: 'failed', message: RETRY });
      }
      payload = validateDigest(tool.input, input.refs, ctx);
    }

    const { data: ok, error: saveError } = await supabase.rpc('save_digest', {
      p_playbook_id: playbookId,
      p_period_days: period,
      p_run_id: runId,
      p_payload: payload,
    });
    if (saveError) {
      console.error('[digest] save failed:', saveError);
      return json(500, { error: 'failed', message: RETRY });
    }
    if (ok !== true) {
      // This run's lease expired and another run took over.
      saved = true; // nothing of ours to release
      return json(409, { error: 'superseded', message: 'Another digest was generated meanwhile. Reload to see it.' });
    }
    saved = true;
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error(`[digest] API error ${err.status}:`, err.message);
    else console.error('[digest] failed:', err);
    return json(503, { error: 'failed', message: RETRY });
  } finally {
    if (!saved) {
      const { error } = await supabase.rpc('release_digest_run', { p_playbook_id: playbookId, p_run_id: runId });
      if (error) console.error('[digest] release failed (the lease will expire by itself):', error);
    }
  }
}
