import { Suspense } from 'react';
import PlaybookView from '@/components/companion-v2/playbook/PlaybookView';
import { getViewer, requireContributor } from '@/lib/companion-v2/server';
import type { JobRow, PlaybookRow } from '@/lib/companion-v2/types';

// Contributor-only: the playbook as the HTML prototype shows it. 404 for
// everyone else (requireContributor).
export default async function PlaybookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { playbook } = await requireContributor(slug);
  const { supabase } = await getViewer();

  const [{ data: full, error }, { data: jobRows, error: jobsError }] = await Promise.all([
    supabase
      .from('playbooks')
      .select('id, slug, title, description, overview, roles, sequence, source_doc, updated_at')
      .eq('id', playbook.id)
      .single(),
    supabase
      .from('playbook_jobs')
      .select('job_code, name, position, stages, work_area, job_type, body')
      .eq('playbook_id', playbook.id),
  ]);
  if (error) throw error;
  if (jobsError) throw jobsError;

  const jobs = ((jobRows ?? []) as JobRow[]).sort(
    (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.job_code.localeCompare(b.job_code, 'en', { numeric: true })
  );

  return (
    <Suspense>
      <PlaybookView playbook={full as PlaybookRow} jobs={jobs} />
    </Suspense>
  );
}
