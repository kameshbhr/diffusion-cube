import { notFound } from 'next/navigation';
import DigestScreen from '@/components/companion-v2/digest/DigestScreen';
import { canRunDigest, getViewer, getWorkspace } from '@/lib/companion-v2/server';
import {
  toPeriod,
  toStateCounts,
  viewDigest,
  type DigestPayload,
  type DigestStats,
  type StateCountRow,
} from '@/lib/companion-v2/digest';

// Only for those can_run_digest() allows (today: the playbook's contributors);
// 404 for everyone else. Numbers computed in SQL when the
// tab opens, then the stored digest for the selected period, checked against
// the conversations that still exist. Everything is read with the caller's
// own session through the 0037 functions and the playbook_digests policy,
// all gated by can_run_digest().
export default async function DigestPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { slug } = await params;
  const period = toPeriod((await searchParams).days);
  const { playbook } = await getWorkspace(slug);
  if (!(await canRunDigest(playbook.id))) notFound();
  const { supabase } = await getViewer();

  const [statsRes, digestRes, statesRes, jobsRes] = await Promise.all([
    supabase.rpc('contributor_digest_stats', { p_playbook_id: playbook.id, p_days: period }),
    supabase
      .from('playbook_digests')
      .select('payload, generated_at')
      .eq('playbook_id', playbook.id)
      .eq('period_days', period)
      .maybeSingle(),
    supabase.rpc('contributor_job_state_counts', { p_playbook_id: playbook.id }),
    supabase.from('playbook_jobs').select('job_code, name').eq('playbook_id', playbook.id),
  ]);
  for (const r of [statsRes, digestRes, statesRes, jobsRes]) if (r.error) throw r.error;
  if (!statsRes.data) notFound();

  const stats = statsRes.data as DigestStats;
  const live = new Set(stats.conversation_ids ?? []);
  const stored = digestRes.data as { payload: DigestPayload; generated_at: string } | null;

  return (
    <DigestScreen
      slug={playbook.slug}
      playbookId={playbook.id}
      period={period}
      stats={stats}
      states={toStateCounts((statesRes.data ?? []) as StateCountRow[])}
      jobNames={Object.fromEntries(((jobsRes.data ?? []) as { job_code: string; name: string }[]).map((j) => [j.job_code, j.name]))}
      digest={stored ? { view: viewDigest(stored.payload, live), generatedAt: stored.generated_at } : null}
    />
  );
}
