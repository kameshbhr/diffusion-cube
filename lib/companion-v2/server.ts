// Server-side loaders for the Cube 2.0 companion pages. Wrapped in React
// cache() so a layout and its page share one lookup per request.
//
// A workspace is a use case (docs/design/cube-usecase-plan.md). Access comes
// from its allowlist and open_to_all, decided in the database with the
// caller's session (lib/use-case-access.ts): read, write or curate. Use cases
// are read with the service-role client after that check;
// the use case's playbook, jobs and assets are read with the caller's own
// session, whose row rules follow the same allowlist (migration 0042).

import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasAnyRole, isAdmin } from '@/lib/roles';
import { getUseCaseAccess, readableUseCases, type UseCaseAccess } from '@/lib/use-case-access';
import { sortJobs } from './jobs';
import type { JobRow, PlaybookRow } from './types';
import type { Snapshot } from './patch';

export interface UseCaseSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  access: UseCaseAccess;
  hasPlaybook: boolean;
}

export interface PlaybookSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  updated_at: string;
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

/** The use cases the caller can read, by name. */
export const listUseCases = cache(async (): Promise<UseCaseSummary[]> => {
  const { supabase, user } = await getViewer();
  if (!user) return [];
  const admin = createAdminClient();
  const access = await readableUseCases(supabase);
  if (!access.size) return [];
  const [useCases, playbooks] = await Promise.all([
    admin.from('use_cases').select('id, slug, name, description').in('id', [...access.keys()]).order('name'),
    admin.from('playbooks').select('use_case_id').in('use_case_id', [...access.keys()]),
  ]);
  if (useCases.error) throw useCases.error;
  if (playbooks.error) throw playbooks.error;
  const withPlaybook = new Set((playbooks.data ?? []).map((p) => p.use_case_id as string));
  return (useCases.data ?? []).map((u) => ({
    id: u.id as string,
    slug: u.slug as string,
    name: u.name as string,
    description: (u.description as string | null) ?? null,
    access: access.get(u.id as string)!,
    hasPlaybook: withPlaybook.has(u.id as string),
  }));
});

/**
 * The use case at /companion/<slug>, the caller's access and its playbook (or
 * null). 404s when the caller can't read it. An old playbook link
 * (/companion/<playbook slug>) redirects to its use case.
 */
export const getWorkspace = cache(async (slug: string) => {
  const { user, supabase } = await getViewer();
  if (!user) notFound();
  const admin = createAdminClient();

  const { data: useCase, error } = await admin
    .from('use_cases')
    .select('id, slug, name, description')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!useCase) {
    const { data: old } = await admin.from('playbooks').select('use_case_id').eq('slug', slug).maybeSingle();
    if (old?.use_case_id) {
      const { data: target } = await admin.from('use_cases').select('slug').eq('id', old.use_case_id).maybeSingle();
      if (target?.slug) redirect(`/companion/${target.slug}`);
    }
    notFound();
  }

  const access = await getUseCaseAccess(supabase, useCase.id as string);
  if (!access) notFound();

  const { data: playbook, error: pbError } = await supabase
    .from('playbooks')
    .select('id, slug, title, description, updated_at')
    .eq('use_case_id', useCase.id)
    .maybeSingle();
  if (pbError) throw pbError;

  return {
    useCase: {
      id: useCase.id as string,
      slug: useCase.slug as string,
      name: useCase.name as string,
      description: (useCase.description as string | null) ?? null,
    },
    access,
    playbook: (playbook as PlaybookSummary | null) ?? null,
    userId: user.id,
  };
});

/** For pages that need a playbook and curate access (Playbook, Assets, Digest, Conversations): 404 otherwise. */
export async function requireCurator(slug: string) {
  const ws = await getWorkspace(slug);
  if (ws.access !== 'curate' || !ws.playbook) notFound();
  return { ...ws, playbook: ws.playbook };
}

/** The whole playbook and its jobs in sequence order. */
export async function loadPlaybookContent(playbookId: string): Promise<{ playbook: PlaybookRow; jobs: JobRow[] }> {
  const { supabase } = await getViewer();
  const [{ data: playbook, error }, { data: jobRows, error: jobsError }] = await Promise.all([
    supabase
      .from('playbooks')
      .select('id, slug, title, description, overview, roles, sequence, updated_at')
      .eq('id', playbookId)
      .single(),
    supabase
      .from('playbook_jobs')
      .select('job_code, name, position, stages, work_area, job_type, body')
      .eq('playbook_id', playbookId),
  ]);
  if (error) throw error;
  if (jobsError) throw jobsError;
  return { playbook: playbook as PlaybookRow, jobs: sortJobs((jobRows ?? []) as JobRow[]) };
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
    },
    jobs,
  };
}
