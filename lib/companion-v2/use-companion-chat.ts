'use client';

// Client hook for the adopter's Home chat (Cube 2.0). Separate from Cube 1.0's
// lib/adoption-conversation.ts.
//
// One turn: stream the reply from /api/chat (mode "companion-v2"), show it
// with the <ui_action> block stripped, then store the whole turn with one
// record_companion_turn() call (messages, context, job states in one
// transaction). If anything fails, nothing is stored: the partial reply is
// removed and the user's text goes back into the composer for a retry.
//
// Which conversation is shown: the one asked for (?c= from the sidebar) if it
// is the user's own, otherwise the latest; a new one is created if none exist.

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

export interface LoadedConversation {
  id: string;
  history: ChatMessage[];
}

interface Options {
  playbookId: string;
  memberId: string;
  jobCodes: string[];
  assetIds: string[];
  /** ?c= from the sidebar; null/undefined opens the latest conversation. */
  requestedConversationId?: string | null;
}

/**
 * Tells listeners that the user's conversations changed: the sidebar's Recent
 * conversations list refreshes, and the chat reloads if the conversation on
 * screen was the one deleted (detail.deletedId).
 */
export const CONVERSATIONS_CHANGED = 'companion:conversations-changed';
export interface ConversationsChangedDetail {
  deletedId?: string;
}
export const notifyConversationsChanged = (detail: ConversationsChangedDetail = {}) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CONVERSATIONS_CHANGED, { detail }));
};

let localId = 0;
const nextId = () => `local-${++localId}`;

export function useCompanionChat({ playbookId, memberId, jobCodes, assetIds, requestedConversationId }: Options) {
  const [supabase] = useState(() => createClient());
  const known = useMemo(() => ({ jobCodes: new Set(jobCodes), assetIds: new Set(assetIds) }), [jobCodes, assetIds]);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [context, setContext] = useState<CompanionContext>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({});
  // Which request the shown conversation answers ("latest" or an id); while it
  // differs from the current request, the conversation is loading.
  const requestKey = requestedConversationId || 'latest';
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey && failedKey !== requestKey;
  // Bumped to reload the same request (the conversation on screen was deleted).
  const [reloadTick, setReloadTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [ready, setReady] = useState<LoadedConversation | null>(null);
  const busyRef = useRef(false);
  // The conversation on screen. A turn that finishes after the user switched
  // away is still stored, but no longer paints over the new conversation.
  const shownRef = useRef<string | null>(null);

  const refreshJobStates = useCallback(async () => {
    const { data } = await supabase.from('member_job_states').select('job_code, state').eq('member_id', memberId);
    if (data) setJobStates(Object.fromEntries(data.map((s) => [s.job_code, s.state as JobState])));
  }, [memberId, supabase]);

  // ---------- one turn ----------
  const runTurn = useCallback(
    async (conv: LoadedConversation, userText: string | null, opts: { focusJob?: string } = {}): Promise<boolean | null> => {
      // null = not started (another turn is running); false = failed.
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      setError(null);

      const onScreen = () => shownRef.current === conv.id;
      const userMsg: ChatMessage | null = userText ? { id: nextId(), role: 'user', content: userText } : null;
      const replyId = nextId();
      setMessages([...conv.history, ...(userMsg ? [userMsg] : []), { id: replyId, role: 'assistant', content: '', pending: true }]);

      // Returns false for a failure the user sees, null when they have since
      // switched to another conversation (nothing to restore there).
      const fail = (message: string): false | null => {
        if (!onScreen()) return null;
        setMessages(conv.history);
        setError({ kind: 'retry', text: userText ?? '', message });
        return false;
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
          if (!onScreen()) return null;
          setMessages(conv.history);
          setError({ kind: 'limit', message: data.message ?? "You've reached today's limit for messages to Cube." });
          return false;
        }
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          return fail(data.message ?? "Cube couldn't answer just now. Please try again.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          if (onScreen()) {
            const shown = stripUiAction(full);
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: shown } : m)));
          }
        }
        full += decoder.decode();

        const reply = stripUiAction(full);
        if (!reply) return fail("Cube couldn't answer just now. Please try again.");
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
          return fail("Cube's reply couldn't be saved. Please try again.");
        }

        notifyConversationsChanged();
        if (onScreen()) {
          setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: reply, ui, pending: false } : m)));
          if (Object.keys(ui.context).length) setContext((c) => ({ ...c, ...ui.context }));
        }
        // Cube never overrides a state the user set; reload what was stored.
        if (ui.jobUpdates.length) await refreshJobStates();
        return true;
      } catch (err) {
        console.error('[companion] turn failed:', err);
        return fail("Cube couldn't answer just now. Please try again.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [known, playbookId, refreshJobStates, supabase]
  );

  // ---------- load a conversation ----------
  const load = useCallback(
    async (requested: string | null | undefined, isCancelled: () => boolean): Promise<LoadedConversation | null> => {
      const key = requested || 'latest';
      const pick = supabase
        .from('companion_conversations')
        .select('id, context')
        .eq('member_id', memberId)
        .eq('playbook_id', playbookId);
      let { data: conv } = requested
        ? await pick.eq('id', requested).maybeSingle()
        : await pick.order('updated_at', { ascending: false }).limit(1).maybeSingle();
      // Not the user's own, or deleted: fall back to the latest.
      if (!conv && requested) {
        ({ data: conv } = await supabase
          .from('companion_conversations')
          .select('id, context')
          .eq('member_id', memberId)
          .eq('playbook_id', playbookId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle());
      }
      // A newer request superseded this one: change nothing (and create nothing).
      if (isCancelled()) return null;
      setError(null);
      await refreshJobStates();
      if (isCancelled()) return null;

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
          if (isCancelled()) return null;
          setError({ kind: 'retry', text: '', message: "Couldn't start the conversation. Please reload the page." });
          setFailedKey(key);
          return null;
        }
        id = created.id as string;
        ctx = (created.context ?? {}) as CompanionContext;
        notifyConversationsChanged();
      }

      const { data: rows, error: rowsError } = await supabase
        .from('companion_messages')
        .select('id, role, content, ui')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      if (isCancelled()) return null;
      if (rowsError) {
        console.error('[companion] could not load the conversation:', rowsError);
        setError({ kind: 'retry', text: '', message: "Couldn't load your conversation. Please reload the page." });
        setFailedKey(key);
        return null;
      }
      const history: ChatMessage[] = (rows ?? []).map((r) => ({
        id: r.id as string,
        role: r.role as 'user' | 'assistant',
        content: r.content as string,
        ui: (r.ui as UiAction | null) ?? null,
      }));

      shownRef.current = id;
      setConversationId(id);
      setContext(ctx);
      setMessages(history);
      setLoadedKey(key);
      return { id, history };
    },
    [memberId, playbookId, refreshJobStates, supabase]
  );

  // Load on mount and whenever the requested conversation changes.
  useEffect(() => {
    let cancelled = false;
    shownRef.current = null;
    // Started from a microtask: load() only sets state after awaiting the
    // database, never synchronously inside this effect.
    Promise.resolve()
      .then(() => load(requestedConversationId, () => cancelled))
      .then((conv) => {
        if (!cancelled && conv) setReady(conv);
      });
    return () => {
      cancelled = true;
    };
  }, [load, requestedConversationId, reloadTick]);

  // The conversation on screen was deleted (from the sidebar): load again.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const { deletedId } = ((e as CustomEvent<ConversationsChangedDetail>).detail ?? {}) as ConversationsChangedDetail;
      if (deletedId && deletedId === shownRef.current) {
        setLoadedKey(null);
        setReloadTick((n) => n + 1);
      }
    };
    window.addEventListener(CONVERSATIONS_CHANGED, onChanged);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, onChanged);
  }, []);

  // ---------- public actions ----------
  const send = useCallback(
    async (text: string, opts: { focusJob?: string } = {}) => {
      const trimmed = text.trim();
      if (!trimmed || !conversationId) return false;
      return runTurn({ id: conversationId, history: messages.filter((m) => !m.pending) }, trimmed, opts);
    },
    [conversationId, messages, runTurn]
  );

  /** Cube opens an empty conversation (hidden kickoff). */
  const kickoff = useCallback(
    async (conv: LoadedConversation) => (conv.history.length ? true : runTurn(conv, null)),
    [runTurn]
  );

  /**
   * Creates a fresh conversation that keeps what Cube knows about the
   * situation, and returns its id. The caller opens it (?c=), which loads it
   * and lets Cube greet.
   */
  const startNewConversation = useCallback(async (): Promise<string | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { data: created, error } = await supabase
      .from('companion_conversations')
      .insert({ member_id: memberId, playbook_id: playbookId, context })
      .select('id')
      .single();
    busyRef.current = false;
    setBusy(false);
    if (error || !created) {
      setError({ kind: 'retry', text: '', message: "Couldn't start a new conversation. Please try again." });
      return null;
    }
    notifyConversationsChanged();
    return created.id as string;
  }, [context, memberId, playbookId, supabase]);

  const retry = useCallback(async (): Promise<boolean | null> => {
    if (!error || error.kind !== 'retry' || !conversationId) return null;
    const history = messages.filter((m) => !m.pending);
    return runTurn({ id: conversationId, history }, error.text || null);
  }, [conversationId, error, messages, runTurn]);

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
