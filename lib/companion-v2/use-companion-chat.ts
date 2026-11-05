'use client';

// Client hook for the adopter's Home chat (Cube 2.0). Separate from Cube 1.0's
// lib/adoption-conversation.ts.
//
// One turn: stream the reply from /api/chat (mode "companion-v2"), show it
// with the <ui_action> block stripped, then store the whole turn with one
// record_companion_turn() call (messages, context, job states in one
// transaction). If anything fails, nothing is stored: the partial reply is
// removed and the user's text goes back into the composer for a retry.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseUiAction, sanitizeUiAction, stripUiAction } from './ui-action';
import type { CompanionContext, JobState, UiAction } from './types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ui?: UiAction | null;
  pending?: boolean;
}

export type ChatError = { kind: 'retry'; text: string; message: string } | { kind: 'limit'; message: string };

interface Options {
  playbookId: string;
  memberId: string;
  jobCodes: string[];
  assetIds: string[];
}

let localId = 0;
const nextId = () => `local-${++localId}`;

export function useCompanionChat({ playbookId, memberId, jobCodes, assetIds }: Options) {
  const [supabase] = useState(() => createClient());
  const known = useMemo(() => ({ jobCodes: new Set(jobCodes), assetIds: new Set(assetIds) }), [jobCodes, assetIds]);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [context, setContext] = useState<CompanionContext>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const busyRef = useRef(false);

  // ---------- one turn ----------
  const runTurn = useCallback(
    async (
      conv: { id: string; history: ChatMessage[] },
      userText: string | null,
      opts: { focusJob?: string } = {}
    ): Promise<boolean | null> => {
      // null = not started (another turn is running); false = failed.
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      setError(null);

      const userMsg: ChatMessage | null = userText ? { id: nextId(), role: 'user', content: userText } : null;
      const replyId = nextId();
      setMessages([
        ...conv.history,
        ...(userMsg ? [userMsg] : []),
        { id: replyId, role: 'assistant', content: '', pending: true },
      ]);

      const restore = () => setMessages(conv.history);
      const fail = (message: string) => {
        restore();
        if (userText) setError({ kind: 'retry', text: userText, message });
        else setError({ kind: 'retry', text: '', message });
      };

      try {
        // Only the new message is sent; the server reads the history itself.
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'companion-v2',
            role: 'adopter',
            playbookId,
            conversationId: conv.id,
            message: userText ?? undefined,
            kickoff: !userText,
            focusJob: opts.focusJob,
          }),
        });

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          restore();
          setError({ kind: 'limit', message: data.message ?? "You've reached today's limit for messages to Cube." });
          return false;
        }
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          fail(data.message ?? "Cube couldn't answer just now. Please try again.");
          return false;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          const shown = stripUiAction(full);
          setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: shown } : m)));
        }
        full += decoder.decode();

        const reply = stripUiAction(full);
        if (!reply) {
          fail("Cube couldn't answer just now. Please try again.");
          return false;
        }
        const raw = parseUiAction(full);
        const ui = sanitizeUiAction(raw, known);

        const { error: saveError } = await supabase.rpc('record_companion_turn', {
          p_conversation_id: conv.id,
          p_user_text: userText,
          p_assistant_text: reply,
          p_ui: raw ? ui : null,
          p_context_patch: ui.context,
          p_job_updates: ui.jobUpdates,
        });
        if (saveError) {
          console.error('[companion] could not store the turn:', saveError);
          fail("Cube's reply couldn't be saved. Please try again.");
          return false;
        }

        setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: reply, ui, pending: false } : m)));
        if (Object.keys(ui.context).length) setContext((c) => ({ ...c, ...ui.context }));
        if (ui.jobUpdates.length) {
          // Cube never overrides a state the user set; reload what was stored.
          const { data } = await supabase.from('member_job_states').select('job_code, state').eq('member_id', memberId);
          if (data) setJobStates(Object.fromEntries(data.map((s) => [s.job_code, s.state as JobState])));
        }
        return true;
      } catch (err) {
        console.error('[companion] turn failed:', err);
        fail("Cube couldn't answer just now. Please try again.");
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [known, memberId, playbookId, supabase]
  );

  // ---------- load or create the conversation ----------
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: conv }, { data: states }] = await Promise.all([
      supabase
        .from('companion_conversations')
        .select('id, context')
        .eq('member_id', memberId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('member_job_states').select('job_code, state').eq('member_id', memberId),
    ]);
    setJobStates(Object.fromEntries((states ?? []).map((s) => [s.job_code, s.state as JobState])));

    let id = conv?.id as string | undefined;
    let ctx = (conv?.context ?? {}) as CompanionContext;
    if (!id) {
      const { data: created, error } = await supabase
        .from('companion_conversations')
        .insert({ member_id: memberId, playbook_id: playbookId })
        .select('id, context')
        .single();
      if (error || !created) {
        console.error('[companion] could not start a conversation:', error);
        setError({ kind: 'retry', text: '', message: "Couldn't start the conversation. Please reload the page." });
        setLoading(false);
        return null;
      }
      id = created.id as string;
      ctx = (created.context ?? {}) as CompanionContext;
    }

    const { data: rows, error: rowsError } = await supabase
      .from('companion_messages')
      .select('id, role, content, ui')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    if (rowsError) {
      console.error('[companion] could not load the conversation:', rowsError);
      setError({ kind: 'retry', text: '', message: "Couldn't load your conversation. Please reload the page." });
      setLoading(false);
      return null;
    }
    const history: ChatMessage[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      role: r.role as 'user' | 'assistant',
      content: r.content as string,
      ui: (r.ui as UiAction | null) ?? null,
    }));

    setConversationId(id);
    setContext(ctx);
    setMessages(history);
    setLoading(false);
    return { id, history };
  }, [memberId, playbookId, supabase]);

  // ---------- public actions ----------
  const send = useCallback(
    async (text: string, opts: { focusJob?: string } = {}) => {
      const trimmed = text.trim();
      if (!trimmed || !conversationId) return false;
      return runTurn({ id: conversationId, history: messages.filter((m) => !m.pending) }, trimmed, opts);
    },
    [conversationId, messages, runTurn]
  );

  /** Cube opens an empty conversation (hidden kickoff, not counted). */
  const kickoff = useCallback(
    async (conv: { id: string; history: ChatMessage[] }) => {
      if (conv.history.length) return true;
      return runTurn(conv, null);
    },
    [runTurn]
  );

  /** Starts a fresh conversation that keeps what Cube knows about the situation. */
  const startNewConversation = useCallback(async () => {
    if (busyRef.current) return;
    // Hold the busy flag while the new conversation is created, so a message
    // sent meanwhile can't land in the old one and then be wiped.
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { data: created, error } = await supabase
      .from('companion_conversations')
      .insert({ member_id: memberId, playbook_id: playbookId, context })
      .select('id, context')
      .single();
    busyRef.current = false;
    setBusy(false);
    if (error || !created) {
      setError({ kind: 'retry', text: '', message: "Couldn't start a new conversation. Please try again." });
      return;
    }
    setConversationId(created.id as string);
    setContext((created.context ?? {}) as CompanionContext);
    setMessages([]);
    await runTurn({ id: created.id as string, history: [] }, null);
  }, [context, memberId, playbookId, runTurn, supabase]);

  const retry = useCallback(async (): Promise<boolean | null> => {
    if (!error || error.kind !== 'retry' || !conversationId) return null;
    const history = messages.filter((m) => !m.pending);
    return runTurn({ id: conversationId, history }, error.text || null);
  }, [conversationId, error, messages, runTurn]);

  // First load (once per member).
  const started = useRef(false);
  const [ready, setReady] = useState<{ id: string; history: ChatMessage[] } | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load().then((conv) => {
      if (conv) setReady(conv);
    });
  }, [load]);

  return {
    loading,
    busy,
    error,
    messages,
    context,
    jobStates,
    conversationId,
    ready,
    send,
    kickoff,
    retry,
    startNewConversation,
    dismissError: () => setError(null),
  };
}
