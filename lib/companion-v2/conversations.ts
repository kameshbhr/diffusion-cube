// Contributor view of adopter conversations. Read only through the two
// security-definer RPCs in migration 0036, which check that the caller
// contributes to the playbook, cover adopters only, and return no name,
// email or user id: every adopter is "User".

import type { SupabaseClient } from '@supabase/supabase-js';
import { CONTEXT_KEYS, type CompanionContext, type ContextKey, type JobState } from './types';

export interface ConversationSummary {
  conversation_id: string;
  label: string;
  context: CompanionContext;
  started_at: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationDetail {
  conversation_id: string;
  playbook_id: string;
  label: string;
  context: CompanionContext;
  started_at: string;
  updated_at: string;
  messages: { role: 'user' | 'assistant'; content: string; created_at: string }[];
  job_states: { job: string; state: JobState; note: string; set_by: 'cube' | 'user'; updated_at: string }[];
}

export const CONTEXT_LABEL: Record<ContextKey, string> = {
  stage: 'Where they are',
  location: 'Where the work is',
  done: 'Already done',
  role_note: 'Their part',
};

/** The context entries that are filled in, in a fixed order. */
export const contextEntries = (c: CompanionContext | null | undefined) =>
  CONTEXT_KEYS.filter((k) => typeof c?.[k] === 'string' && c[k]!.trim()).map((k) => ({ key: k, label: CONTEXT_LABEL[k], value: c![k]! }));

export async function listConversations(supabase: SupabaseClient, playbookId: string): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('contributor_list_conversations', { p_playbook_id: playbookId });
  if (error) throw error;
  return ((data ?? []) as ConversationSummary[]).map((r) => ({ ...r, message_count: Number(r.message_count) }));
}

/** null when it doesn't exist, isn't an adopter's, or the caller doesn't contribute to its playbook. */
export async function getConversation(supabase: SupabaseClient, conversationId: string): Promise<ConversationDetail | null> {
  const { data, error } = await supabase.rpc('contributor_get_conversation', { p_conversation_id: conversationId });
  if (error) throw error;
  return (data as ConversationDetail | null) ?? null;
}

/** Dates as the people using this playbook read them (India). */
const FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export const formatWhen = (iso: string) => `${FORMAT.format(new Date(iso))} IST`;
