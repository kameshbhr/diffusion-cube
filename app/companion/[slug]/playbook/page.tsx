import { Suspense } from 'react';
import PlaybookView from '@/components/companion-v2/playbook/PlaybookView';
import { getViewer, requireCurator } from '@/lib/companion-v2/server';
import { sortJobs } from '@/lib/companion-v2/jobs';
import type { JobRow, PlaybookRow } from '@/lib/companion-v2/types';

// Curators only: the use case's playbook as the HTML prototype shows it. 404
// for everyone else (requireCurator).
export default async function PlaybookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { playbook } = await requireCurator(slug);
  const { supabase } = await getViewer();

  const [{ data: full, error }, { data: jobRows, error: jobsError }] = await Promise.all([
    supabase
      .from('playbooks')
      .select('id, slug, title, description, overview, roles, sequence, updated_at')
      .eq('id', playbook.id)
      .single(),
    supabase
      .from('playbook_jobs')
      .select('job_code, name, position, stages, work_area, job_type, body')
      .eq('playbook_id', playbook.id),
  ]);
  if (error) throw error;
  if (jobsError) throw jobsError;

  const jobs = sortJobs((jobRows ?? []) as JobRow[]);

  return (
    <Suspense>
      <PlaybookView playbook={full as PlaybookRow} jobs={jobs} />
    </Suspense>
  );
}
