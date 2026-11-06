'use client';

// The contributor's chat (their Converse tab). Conversations are saved like an
// adopter's (companion_conversations / companion_messages, through
// record_companion_turn), so they show under Recent conversations. What is
// saved: the messages, the names and sizes of attached files (never their
// text), and for each proposal a one-line label per change and whether it
// was applied or discarded. The proposed changes themselves are not saved: an
// old proposal can be read but not applied (ask Cube again). The history is
// sent with each request, and file text only with the turn it belongs to.
//
// A large upload is split into parts (chunkFiles). Each part is its own
// request against the playbook as it is now, and the parts' proposals are
// merged into one review list, with overlaps flagged.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Snapshot } from './patch';
import { CONVERSATIONS_CHANGED, NEW_CONVERSATION, notifyConversationsChanged, type ConversationsChangedDetail } from './use-companion-chat';
import { opLabel } from './patch-display';
import {
  chunkFiles,
  overlappingOps,
  parsePatchBlock,
  sanitizePatch,
  stripPatchBlock,
  type ProposedPatch,
  type UploadedText,
} from './playbook-patch';

export type ProposalStatus = 'open' | 'applied' | 'discarded';

/** What a contributor reply stores in companion_messages.ui. Never the changes themselves. */
export interface StoredContributorUi {
  kind: 'contributor';
  /** Files attached to the message this replies to: names and sizes only. */
  files?: { name: string; chars: number }[];
  proposal?: { summary: string; changes: string[]; status: ProposalStatus };
  question?: string | null;
  notes?: string[];
}

export interface ContributorMessage {
  id: string;
  role: 'user' | 'assistant';
  /** What the screen shows (the reply without its block). */
  content: string;
  /** Files attached to a user message: names and sizes only. */
  files?: { name: string; chars: number }[];
  proposal?: ProposedPatch & { overlaps: number[] };
  /** The playbook version (updated_at) Cube saw when it proposed these changes. */
  madeAgainst?: string;
  status?: ProposalStatus;
  /** Shown under the reply, e.g. a part that failed or the daily limit. */
  notes?: string[];
  pending?: boolean;
  /** The stored row of this reply (to record applied or discarded). */
  dbId?: string;
  /** What was stored for this reply; for a reply loaded from an earlier visit, all there is. */
  stored?: StoredContributorUi;
}

export type ContributorError = { kind: 'retry' | 'limit'; message: string };

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}-${seq++}`;

const DEFAULT_FILE_REQUEST = 'Update the playbook from these files.';
const FAILED = "Cube couldn't answer just now. Please try again.";

/** The history the model sees: replies with a note on what became of each proposal. */
function toHistory(messages: ContributorMessage[], base: Snapshot): { role: 'user' | 'assistant'; content: string }[] {
  const all = messages
    .filter((m) => !m.pending)
    .map((m) => {
      if (m.role === 'user') {
        const files = m.files?.length
          ? `\n\n[Files attached to this message earlier (not repeated): ${m.files.map((f) => `${f.name}, ${f.chars.toLocaleString('en')} characters`).join('; ')}]`
          : '';
        return { role: 'user' as const, content: `${m.content}${files}` };
      }
      const p = m.proposal;
      const kept = m.stored?.proposal;
      let note = '';
      if (!p && kept?.changes.length) {
        const fate =
          kept.status === 'applied'
            ? 'The contributor applied the changes they kept.'
            : kept.status === 'discarded'
              ? 'The contributor discarded them.'
              : 'They were not applied, and are no longer available.';
        note = `\n\n[You proposed ${kept.changes.length} change${kept.changes.length === 1 ? '' : 's'}: ${kept.changes.join('; ')}. ${fate}]`;
      } else if (!p && m.stored?.question) note = `\n\n[You asked: ${m.stored.question}]`;
      else if (p?.ops.length) {
        const labels = p.ops.map((op) => opLabel(op, base)).join('; ');
        const fate =
          m.status === 'applied'
            ? 'The contributor applied the changes they kept; the playbook you see now includes them.'
            : m.status === 'discarded'
              ? 'The contributor discarded them.'
              : 'The contributor has not applied them yet.';
        note = `\n\n[You proposed ${p.ops.length} change${p.ops.length === 1 ? '' : 's'}: ${labels}. ${fate}]`;
      } else if (p?.question) note = `\n\n[You asked: ${p.question}]`;
      return { role: 'assistant' as const, content: `${m.content || '(no text)'}${note}` };
    })
    // Within the route's limits: each message and the whole history.
    .map((m) => (m.content.length > MAX_MESSAGE_CHARS ? { ...m, content: `${m.content.slice(0, MAX_MESSAGE_CHARS)}\n[…shortened]` } : m));
  // Drop the oldest exchanges (in pairs, so it still starts with the contributor).
  let total = all.reduce((n, m) => n + m.content.length, 0);
  while (all.length > MAX_HISTORY_MESSAGES || total > MAX_HISTORY_CHARS) {
    const dropped = all.splice(0, 2);
    total -= dropped.reduce((n, m) => n + m.content.length, 0);
  }
  return all;
}

// Under the route's limits (40 messages, 60k per message, 300k in all), with
// room for the new message.
const MAX_HISTORY_MESSAGES = 38;
const MAX_MESSAGE_CHARS = 50_000;
// About 40k tokens: with the playbook JSON (~45k), the source document (up to
// 100k), one upload part (~30k) and the reply (8k), this stays inside the
// model's 200k-token context.
const MAX_HISTORY_CHARS = 160_000;

type TurnResult =
  | { ok: true; text: string; patch: ProposedPatch | null }
  | { ok: false; kind: 'limit' | 'retry'; message: string };

/** Stored rows back into messages. Files recorded on a reply belong to the message before it. */
function fromRows(rows: { id: string; role: string; content: string; ui: unknown }[]): ContributorMessage[] {
  const out: ContributorMessage[] = [];
  for (const r of rows) {
    if (r.role === 'user') {
      out.push({ id: r.id, role: 'user', content: r.content });
      continue;
    }
    const ui = r.ui && typeof r.ui === 'object' && (r.ui as StoredContributorUi).kind === 'contributor' ? (r.ui as StoredContributorUi) : undefined;
    const prev = out[out.length - 1];
    if (ui?.files?.length && prev?.role === 'user') prev.files = ui.files;
    out.push({ id: r.id, role: 'assistant', content: r.content, dbId: r.id, stored: ui, notes: ui?.notes });
  }
  return out;
}

export function useContributorChat({
  playbookId,
  memberId,
  base,
  updatedAt,
  requestedConversationId,
}: {
  playbookId: string;
  memberId: string;
  base: Snapshot;
  updatedAt: string;
  /** ?c= : a conversation id, NEW_CONVERSATION (opened from the playbook list), or null for the latest. */
  requestedConversationId?: string | null;
}) {
  const [supabase] = useState(() => createClient());
  const [messages, setMessagesState] = useState<ContributorMessage[]>([]);
  // The conversation on screen; null until the first reply of a new one is saved.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const requestKey = requestedConversationId || 'latest';
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;
  // A mirror of the messages, so a turn can read the history it starts from.
  const messagesRef = useRef<ContributorMessage[]>([]);
  const setMessages = useCallback((next: ContributorMessage[] | ((prev: ContributorMessage[]) => ContributorMessage[])) => {
    messagesRef.current = typeof next === 'function' ? next(messagesRef.current) : next;
    setMessagesState(messagesRef.current);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ContributorError | null>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped by reset(): a turn from before a reset never touches the new chat.
  const epochRef = useRef(0);

  const baseRef = useRef(base);
  const updatedAtRef = useRef(updatedAt);
  useEffect(() => {
    baseRef.current = base;
    updatedAtRef.current = updatedAt;
  }, [base, updatedAt]);

  // ---------- load the conversation asked for ----------
  useEffect(() => {
    let cancelled = false;
    // From a microtask: state is only set after awaiting the database.
    Promise.resolve().then(async () => {
      const key = requestedConversationId || 'latest';
      const fresh = requestedConversationId === NEW_CONVERSATION;
      const mine = () =>
        supabase.from('companion_conversations').select('id').eq('member_id', memberId).eq('playbook_id', playbookId);
      let id: string | null = null;
      if (requestedConversationId && !fresh) {
        const { data } = await mine().eq('id', requestedConversationId).maybeSingle();
        id = (data?.id as string | undefined) ?? null;
      }
      if (!id) {
        // The latest one; for a new conversation, only if nothing was said in it yet.
        const { data } = await mine().order('updated_at', { ascending: false }).limit(1).maybeSingle();
        id = (data?.id as string | undefined) ?? null;
        if (id && fresh) {
          const { count } = await supabase
            .from('companion_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', id)
            .eq('role', 'user');
          if ((count ?? 0) > 0) id = null;
        }
      }
      let rows: { id: string; role: string; content: string; ui: unknown }[] = [];
      if (id) {
        const { data, error: rowsError } = await supabase
          .from('companion_messages')
          .select('id, role, content, ui')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true });
        if (rowsError) console.error('[contributor chat] could not load the conversation:', rowsError);
        rows = data ?? [];
      }
      if (cancelled) return;
      // A turn still running belongs to the conversation being left.
      epochRef.current++;
      abortRef.current?.abort();
      busyRef.current = false;
      setBusy(false);
      setError(null);
      conversationRef.current = id;
      setConversationId(id);
      setMessages(fromRows(rows));
      setLoadedKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [requestedConversationId, memberId, playbookId, supabase, setMessages]);

  // The conversation on screen was deleted (from the sidebar): start afresh.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const { deletedId } = ((e as CustomEvent<ConversationsChangedDetail>).detail ?? {}) as ConversationsChangedDetail;
      if (deletedId && deletedId === conversationRef.current) {
        conversationRef.current = null;
        setConversationId(null);
        setMessages([]);
      }
    };
    window.addEventListener(CONVERSATIONS_CHANGED, onChanged);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, onChanged);
  }, [setMessages]);

  /**
   * Saves a finished turn (creating the conversation on its first reply) and
   * returns the stored reply's id, or null if it couldn't be saved.
   */
  async function saveTurn(userText: string, reply: string, ui: StoredContributorUi): Promise<string | null> {
    let id = conversationRef.current;
    if (!id) {
      const { data, error: createError } = await supabase
        .from('companion_conversations')
        .insert({ member_id: memberId, playbook_id: playbookId })
        .select('id')
        .single();
      if (createError || !data) {
        console.error('[contributor chat] could not start a conversation:', createError);
        return null;
      }
      id = data.id as string;
      conversationRef.current = id;
      setConversationId(id);
    }
    const { error: saveError } = await supabase.rpc('record_companion_turn', {
      p_conversation_id: id,
      p_user_text: userText,
      p_assistant_text: reply,
      p_ui: ui,
    });
    if (saveError) {
      console.error('[contributor chat] could not save the turn:', saveError);
      return null;
    }
    notifyConversationsChanged();
    const { data: last } = await supabase
      .from('companion_messages')
      .select('id')
      .eq('conversation_id', id)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (last?.id as string | undefined) ?? null;
  }

  /** One request; streams the reply text into onText. */
  async function request(
    history: { role: 'user' | 'assistant'; content: string }[],
    files: UploadedText[] | undefined,
    part: { index: number; total: number } | undefined,
    signal: AbortSignal,
    onText: (shown: string) => void
  ): Promise<TurnResult> {
    let res: Response;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'companion-v2', role: 'contributor', playbookId, messages: history, files, part }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      return { ok: false, kind: 'retry', message: FAILED };
    }
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, kind: 'limit', message: data.message ?? "You've reached today's limit for messages to Cube." };
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, kind: 'retry', message: data.message ?? data.error ?? FAILED };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        onText(stripPatchBlock(full));
      }
      full += decoder.decode();
    } catch (err) {
      if (signal.aborted) throw err;
      return { ok: false, kind: 'retry', message: 'Cube’s reply was interrupted. Please try again.' };
    }
    const text = stripPatchBlock(full);
    if (!text && !full.includes('<playbook_patch')) return { ok: false, kind: 'retry', message: FAILED };
    return { ok: true, text, patch: sanitizePatch(parsePatchBlock(full), baseRef.current) };
  }

  /**
   * Sends a message, with optional files. Returns true when a reply arrived,
   * false when nothing did (the caller puts the text and files back).
   */
  async function send(text: string, files: UploadedText[] = []): Promise<boolean> {
    if (busyRef.current) return false;
    const userText = text.trim() || (files.length ? DEFAULT_FILE_REQUEST : '');
    if (!userText) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const epoch = epochRef.current;
    const live = () => epochRef.current === epoch;
    const abort = new AbortController();
    abortRef.current = abort;

    const userMsg: ContributorMessage = {
      id: nextId(),
      role: 'user',
      content: userText,
      files: files.length ? files.map((f) => ({ name: f.name, chars: f.text.length })) : undefined,
    };
    const replyId = nextId();
    const before = messagesRef.current;
    setMessages([...before, userMsg, { id: replyId, role: 'assistant', content: '', pending: true }]);
    const history = [...toHistory(before, baseRef.current), { role: 'user' as const, content: userText }];
    const setReply = (patch: Partial<ContributorMessage>) => {
      if (live()) setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, ...patch } : m)));
    };

    const madeAgainst = updatedAtRef.current;
    const parts = files.length ? chunkFiles(files) : [undefined];
    const texts: string[] = [];
    const patches: { patch: ProposedPatch; part: number }[] = [];
    const notes: string[] = [];

    try {
      for (let i = 0; i < parts.length; i++) {
        const multi = parts.length > 1;
        const label = multi ? `**Part ${i + 1} of ${parts.length}.** ` : '';
        const result = await request(
          history,
          parts[i],
          multi ? { index: i + 1, total: parts.length } : undefined,
          abort.signal,
          (shown) => setReply({ content: [...texts, `${label}${shown}`].join('\n\n') })
        );
        if (!live()) return true;
        if (!result.ok) {
          if (i === 0) {
            // Nothing arrived: take the turn back so it can be sent again.
            setMessages(before);
            setError({ kind: result.kind, message: result.message });
            return false;
          }
          const unread = [...new Set(parts.slice(i).flatMap((p) => p ?? []).map((f) => f.name))].join(', ');
          notes.push(
            (result.kind === 'limit'
              ? `Stopped after part ${i} of ${parts.length}: ${result.message}`
              : `Part ${i + 1} of ${parts.length} couldn't be read: ${result.message}`) +
              ` Not read: ${unread}. The changes from the parts before are below. To cover the rest, upload just that material again.`
          );
          break;
        }
        texts.push(`${label}${result.text || '(No text.)'}`);
        if (result.patch) patches.push({ patch: result.patch, part: i });
        else notes.push(`${multi ? `Part ${i + 1}: c` : 'C'}ube's reply came without its list of changes (it may have been cut off). Ask again, or ask for fewer changes at once.`);
        setReply({ content: texts.join('\n\n') });
      }

      const ops = patches.flatMap((p) => p.patch.ops);
      const partOf = patches.flatMap((p) => p.patch.ops.map(() => p.part));
      const proposal: ContributorMessage['proposal'] = patches.length
        ? {
            summary: patches.map((p) => p.patch.summary).filter(Boolean).join(' '),
            question: patches.map((p) => p.patch.question).filter(Boolean).join(' ') || null,
            ops,
            contradictions: patches.flatMap((p) => p.patch.contradictions),
            refused: patches.flatMap((p) => p.patch.refused),
            overlaps: parts.length > 1 ? overlappingOps(ops, partOf) : [],
          }
        : undefined;
      const reply = texts.join('\n\n');
      const stored: StoredContributorUi = {
        kind: 'contributor',
        files: userMsg.files,
        proposal: proposal?.ops.length
          ? { summary: proposal.summary, changes: proposal.ops.map((op) => opLabel(op, baseRef.current)), status: 'open' }
          : undefined,
        question: proposal?.question ?? null,
        notes: notes.length ? notes : undefined,
      };
      setReply({
        content: reply,
        proposal,
        status: proposal?.ops.length ? 'open' : undefined,
        notes: notes.length ? notes : undefined,
        madeAgainst,
        stored,
        pending: false,
      });
      // Saved after it is on screen; a failed save keeps the reply usable here.
      const dbId = await saveTurn(userText, reply, stored);
      if (!live()) return true;
      if (dbId) setReply({ dbId });
      else setReply({ notes: [...notes, 'This reply couldn’t be saved to your conversations. You can still apply its changes now.'] });
      return true;
    } catch (err) {
      // Aborted by reset() or by leaving the page: the chat it belonged to is
      // gone, so there is nothing to put back.
      if (abort.signal.aborted || !live()) return true;
      console.error('[update with cube] turn failed:', err);
      setMessages(before);
      setError({ kind: 'retry', message: FAILED });
      return false;
    } finally {
      if (live()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  /** Marks a proposal applied or discarded, here and in the stored reply. */
  const setStatus = useCallback(
    (id: string, status: ProposalStatus) => {
      const m = messagesRef.current.find((x) => x.id === id);
      const stored = m?.stored?.proposal ? { ...m.stored, proposal: { ...m.stored.proposal, status } } : m?.stored;
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, status, stored } : x)));
      if (m?.dbId && stored) {
        supabase
          .from('companion_messages')
          .update({ ui: stored })
          .eq('id', m.dbId)
          .then(({ error: updateError }) => {
            if (updateError) console.error('[contributor chat] could not record the outcome:', updateError);
          });
      }
    },
    [setMessages, supabase]
  );

  // Leaving the screen (a client-side navigation, so no beforeunload) stops
  // the turn, including any upload parts not yet sent.
  useEffect(
    () => () => {
      epochRef.current++;
      abortRef.current?.abort();
    },
    []
  );

  /** Clears the conversation (and stops a reply that is still coming). */
  const reset = useCallback(() => {
    epochRef.current++;
    abortRef.current?.abort();
    busyRef.current = false;
    setBusy(false);
    setError(null);
    setMessages([]);
  }, [setMessages]);

  return { messages, busy, error, loading, conversationId, send, setStatus, reset, clearError: () => setError(null) };
}
