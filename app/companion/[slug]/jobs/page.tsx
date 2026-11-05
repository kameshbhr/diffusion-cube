import { Suspense } from 'react';
import JobsView from '@/components/companion-v2/JobsView';
import { getViewer, getWorkspace } from '@/lib/companion-v2/server';
import type { JobRow, JobStateRow, PlaybookSequence } from '@/lib/companion-v2/types';

// Jobs: every job for the user's role, in sequence order, with Who owns /
// Who tracks, an Owns or Tracks tag, state markers and the job detail sheet.
export default async function JobsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { playbook, member } = await getWorkspace(slug);
  const { supabase } = await getViewer();

  const [{ data: pb }, { data: jobRows }, { data: assetRows }, { data: stateRows }] = await Promise.all([
    supabase.from('playbooks').select('sequence').eq('id', playbook.id).single(),
    supabase
      .from('playbook_jobs')
      .select('job_code, name, position, stages, work_area, job_type, body')
      .eq('playbook_id', playbook.id),
    supabase
      .from('assets')
      .select('id, title, kind, url, storage_path, description, job_codes')
      .eq('playbook_id', playbook.id)
      .order('title'),
    supabase.from('member_job_states').select('job_code, state, note, set_by').eq('member_id', member.id),
  ]);

  const jobs = ((jobRows ?? []) as JobRow[]).sort(
    (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.job_code.localeCompare(b.job_code, 'en', { numeric: true })
  );
  const sequence = (pb?.sequence ?? {}) as PlaybookSequence;
  const assets = (assetRows ?? []).map((a) => ({
    id: a.id as string,
    title: a.title as string,
    kind: a.kind as 'file' | 'link',
    url: a.url as string | null,
    storage_path: a.storage_path as string | null,
    description: (a.description as string) ?? '',
  }));
  const assetJobs = Object.fromEntries((assetRows ?? []).map((a) => [a.id as string, (a.job_codes as string[]) ?? []]));

  return (
    <Suspense>
      <JobsView
        slug={playbook.slug}
        memberId={member.id}
        projectRole={member.project_role}
        jobs={jobs}
        phases={sequence.phases ?? []}
        assets={assets}
        assetJobs={assetJobs}
        initialStates={(stateRows ?? []) as JobStateRow[]}
      />
    </Suspense>
  );
}
