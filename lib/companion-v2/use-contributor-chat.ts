'use client';

// Update with Cube: the contributor's chat. Nothing is stored anywhere. The
// conversation lives in React state, the history is sent with each request,
// and uploaded file text is sent once, with the turn it belongs to.
//
// A large upload is split into parts (chunkFiles). Each part is its own
// request against the playbook as it is now, and the parts' proposals are
// merged into one review list, with overlaps flagged.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from './patch';
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
}

export type ContributorError = { kind: 'retry' | 'limit'; message: string };

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}-${seq++}`;

const DEFAULT_FILE_REQUEST = 'Update the playbook and the source document from these files.';
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
      let note = '';
      if (p?.ops.length) {
        const labels = p.ops.map((op) => opLabel(op, base)).join('; ');
        const fate =
          m.status === 'applied'
            ? 'The contributor applied the changes they kept; the playbook and source document you see now include them.'
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

export function useContributorChat({ playbookId, base, updatedAt }: { playbookId: string; base: Snapshot; updatedAt: string }) {
  const [messages, setMessagesState] = useState<ContributorMessage[]>([]);
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
      return { ok: false, kind: 'limit', message: data.message ?? "You've reached today's limit for Update with Cube." };
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
      setReply({
        content: texts.join('\n\n'),
        proposal,
        status: proposal?.ops.length ? 'open' : undefined,
        notes: notes.length ? notes : undefined,
        madeAgainst,
        pending: false,
      });
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

  const setStatus = useCallback((id: string, status: ProposalStatus) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
  }, [setMessages]);

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

  return { messages, busy, error, send, setStatus, reset, clearError: () => setError(null) };
}
