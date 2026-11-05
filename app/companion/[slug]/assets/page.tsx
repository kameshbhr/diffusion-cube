import AssetsManager, { type ManagedAsset } from '@/components/companion-v2/assets/AssetsManager';
import { getViewer, requireContributor } from '@/lib/companion-v2/server';

// Contributor-only: add, edit and delete the playbook's assets (files and
// links). 404 for everyone else (requireContributor).
export default async function AssetsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { playbook } = await requireContributor(slug);
  const { supabase } = await getViewer();

  const [{ data: assetRows, error }, { data: jobRows, error: jobsError }] = await Promise.all([
    supabase
      .from('assets')
      .select('id, title, kind, url, storage_path, description, job_codes, created_at')
      .eq('playbook_id', playbook.id)
      .order('created_at', { ascending: false }),
    supabase.from('playbook_jobs').select('job_code, name, position').eq('playbook_id', playbook.id),
  ]);
  if (error) throw error;
  if (jobsError) throw jobsError;

  const jobs = (jobRows ?? [])
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
    .map((j) => ({ code: j.job_code as string, name: j.name as string }));

  return <AssetsManager playbookId={playbook.id} assets={(assetRows ?? []) as ManagedAsset[]} jobs={jobs} />;
}
