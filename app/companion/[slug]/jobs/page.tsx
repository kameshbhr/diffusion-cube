import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import JobsView from '@/components/companion-v2/JobsView';
import { getViewer, getWorkspace } from '@/lib/companion-v2/server';
import { sortJobs } from '@/lib/companion-v2/jobs';
import type { JobRow, PlaybookSequence } from '@/lib/companion-v2/types';

// View Jobs: every job of the use case's playbook, in sequence order, with
// who owns and who tracks it, a filter by owner, and the job detail sheet.
export default async function JobsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { useCase, access, playbook } = await getWorkspace(slug);
  if (!playbook) notFound();
  // Curators see every job in the Playbook tab.
  if (access === 'curate') redirect(`/companion/${useCase.slug}/playbook?tab=map`);
  const { supabase } = await getViewer();

  const [{ data: pb }, { data: jobRows }, { data: assetRows }] = await Promise.all([
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
  ]);

  const jobs = sortJobs((jobRows ?? []) as JobRow[]);
  const sequence = (pb?.sequence ?? {}) as PlaybookSequence;
  const assets = (assetRows ?? []).map((a) => ({
    id: a.id as string,
    title: a.title as string,
    kind: a.kind as 'file' | 'link',
    url: a.url as string | null,
    storage_path: a.storage_path as string | null,
    description: (a.description as string) ?? '',
  }));
  // Only codes of jobs that still exist: an asset tagged only to removed jobs
  // is listed under General resources instead of disappearing.
  const known = new Set(jobs.map((j) => j.job_code));
  const assetJobs = Object.fromEntries(
    (assetRows ?? []).map((a) => [a.id as string, ((a.job_codes as string[]) ?? []).filter((c) => known.has(c))])
  );

  return (
    <Suspense>
      <JobsView slug={useCase.slug} jobs={jobs} phases={sequence.phases ?? []} assets={assets} assetJobs={assetJobs} />
    </Suspense>
  );
}
