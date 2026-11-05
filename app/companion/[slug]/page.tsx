import CompanionChat, { type ChatAsset, type ChatJob } from '@/components/companion-v2/CompanionChat';
import { getViewer, getWorkspace } from '@/lib/companion-v2/server';
import { tagFor } from '@/lib/companion-v2/jobs';
import type { JobBody } from '@/lib/companion-v2/types';

// Home: the adopter's chat with Cube, with the four starter chips.
export default async function WorkspaceHome({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { slug } = await params;
  const { job } = await searchParams;
  const { playbook, member } = await getWorkspace(slug);
  const { supabase } = await getViewer();

  const [{ data: jobRows }, { data: assetRows }] = await Promise.all([
    supabase.from('playbook_jobs').select('job_code, name, position, body').eq('playbook_id', playbook.id),
    supabase.from('assets').select('id, title, kind, url').eq('playbook_id', playbook.id),
  ]);

  const jobs: ChatJob[] = (jobRows ?? [])
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
    .map((j) => {
      const body = (j.body ?? {}) as JobBody;
      return { code: j.job_code, name: j.name, when: body.when ?? '', tag: tagFor(body, member.project_role) };
    });
  const assets: ChatAsset[] = (assetRows ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    url: a.url,
  }));

  return (
    <CompanionChat
      slug={playbook.slug}
      playbookId={playbook.id}
      memberId={member.id}
      jobs={jobs}
      assets={assets}
      initialJob={typeof job === 'string' ? job : null}
    />
  );
}
