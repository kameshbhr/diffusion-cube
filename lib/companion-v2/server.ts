// Server-side loaders for the Cube 2.0 companion pages. Wrapped in React
// cache() so a layout and its page share one lookup per request.
//
// Everything here uses the caller's own Supabase session, so RLS decides what
// they can see: listed playbooks for any approved user, plus unlisted ones
// they contribute to.

import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasAnyRole, isAdmin } from '@/lib/roles';
import type { JobRow, PlaybookRow } from './types';
import type { Snapshot } from './patch';

export interface PlaybookSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  member_role: 'adopter' | 'contributor';
  project_role: string;
}

export const getViewer = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy.ts forwards the verified email; fall back to the user record.
  const email = (await headers()).get('x-user-email') ?? user?.email ?? null;
  const [approved, admin] = user
    ? await Promise.all([hasAnyRole(supabase), isAdmin(supabase, email)])
    : [false, false];
  return { supabase, user, email, approved, isAdmin: admin };
});

export const listPlaybooks = cache(async (): Promise<PlaybookSummary[]> => {
  const { supabase } = await getViewer();
  const { data, error } = await supabase
    .from('playbooks')
    .select('id, slug, title, description, updated_at')
    .order('title');
  if (error) throw error;
  return data ?? [];
});

/**
 * Loads a playbook by slug and the caller's membership, joining them as an
 * adopter (PMU) on first open. 404s when the playbook is not visible to them.
 */
export const getWorkspace = cache(async (slug: string) => {
  const { supabase, user } = await getViewer();
  if (!user) notFound();

  const { data: playbook, error } = await supabase
    .from('playbooks')
    .select('id, slug, title, description, updated_at')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!playbook) notFound();

  let member = await readMembership(playbook.id);
  if (!member) {
    // Self-join. RLS only allows an adopter/PMU row for the caller on a
    // listed playbook; ignoreDuplicates makes two tabs opening at once safe.
    const { error: joinError } = await supabase
      .from('playbook_members')
      .upsert(
        { user_id: user.id, playbook_id: playbook.id, member_role: 'adopter', project_role: 'PMU' },
        { onConflict: 'user_id,playbook_id', ignoreDuplicates: true }
      );
    if (joinError) throw joinError;
    member = await readMembership(playbook.id);
    if (!member) notFound();
  }

  return { playbook: playbook as PlaybookSummary, member };

  async function readMembership(playbookId: string): Promise<Membership | null> {
    const { data, error: memberError } = await supabase
      .from('playbook_members')
      .select('id, member_role, project_role')
      .eq('playbook_id', playbookId)
      .eq('user_id', user!.id)
      .maybeSingle();
    if (memberError) throw memberError;
    return (data as Membership | null) ?? null;
  }
});

/** The whole playbook and its jobs in sequence order (contributor screens). */
export async function loadPlaybookContent(playbookId: string): Promise<{ playbook: PlaybookRow; jobs: JobRow[] }> {
  const { supabase } = await getViewer();
  const [{ data: playbook, error }, { data: jobRows, error: jobsError }] = await Promise.all([
    supabase
      .from('playbooks')
      .select('id, slug, title, description, overview, roles, sequence, source_doc, updated_at')
      .eq('id', playbookId)
      .single(),
    supabase
      .from('playbook_jobs')
      .select('job_code, name, position, stages, work_area, job_type, body')
      .eq('playbook_id', playbookId),
  ]);
  if (error) throw error;
  if (jobsError) throw jobsError;
  const jobs = ((jobRows ?? []) as JobRow[]).sort(
    (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.job_code.localeCompare(b.job_code, 'en', { numeric: true })
  );
  return { playbook: playbook as PlaybookRow, jobs };
}

/** The snapshot the patch functions work on. */
export function toSnapshot(playbook: PlaybookRow, jobs: JobRow[]): Snapshot {
  return {
    playbook: {
      title: playbook.title,
      description: playbook.description,
      overview: playbook.overview ?? {},
      roles: playbook.roles ?? [],
      sequence: playbook.sequence ?? {},
      source_doc: playbook.source_doc ?? '',
    },
    jobs,
  };
}

/**
 * Whether the caller may see and generate this playbook's Digest. Decided
 * only by can_run_digest() in the database (migration 0037), so widening it
 * (e.g. to admins) is a change there, not here.
 */
export const canRunDigest = cache(async (playbookId: string): Promise<boolean> => {
  const { supabase } = await getViewer();
  const { data, error } = await supabase.rpc('can_run_digest', { p_playbook_id: playbookId });
  if (error) throw error;
  return data === true;
});

/** For contributor-only pages: 404 for everyone else. */
export async function requireContributor(slug: string) {
  const ws = await getWorkspace(slug);
  if (ws.member.member_role !== 'contributor') notFound();
  return ws;
}
