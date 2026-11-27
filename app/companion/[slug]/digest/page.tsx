import { notFound } from 'next/navigation';
import DigestScreen from '@/components/companion-v2/digest/DigestScreen';
import { getViewer, requireCurator } from '@/lib/companion-v2/server';
import { toPeriod, viewDigest, type DigestPayload, type DigestStats } from '@/lib/companion-v2/digest';

// Curators only (curate access on the use case; can_run_digest() in the
// database agrees); 404 for everyone else. Numbers computed in SQL when the
// tab opens, then the stored digest for the selected period, checked against
// the conversations that still exist. Covers the app's conversations and
// what came through Claude (the connector).
export default async function DigestPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { slug } = await params;
  const period = toPeriod((await searchParams).days);
  const { useCase, playbook } = await requireCurator(slug);
  const { supabase } = await getViewer();

  const [statsRes, digestRes, jobsRes] = await Promise.all([
    supabase.rpc('contributor_digest_stats', { p_playbook_id: playbook.id, p_days: period }),
    supabase
      .from('playbook_digests')
      .select('payload, generated_at')
      .eq('playbook_id', playbook.id)
      .eq('period_days', period)
      .maybeSingle(),
    supabase.from('playbook_jobs').select('job_code, name').eq('playbook_id', playbook.id),
  ]);
  for (const r of [statsRes, digestRes, jobsRes]) if (r.error) throw r.error;
  if (!statsRes.data) notFound();

  const stats = statsRes.data as DigestStats;
  const live = new Set(stats.conversation_ids ?? []);
  const stored = digestRes.data as { payload: DigestPayload; generated_at: string } | null;

  return (
    <DigestScreen
      slug={useCase.slug}
      playbookId={playbook.id}
      period={period}
      stats={stats}
      jobNames={Object.fromEntries(((jobsRes.data ?? []) as { job_code: string; name: string }[]).map((j) => [j.job_code, j.name]))}
      digest={stored ? { view: viewDigest(stored.payload, live), generatedAt: stored.generated_at } : null}
    />
  );
}
