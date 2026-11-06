import CompanionChat, { type ChatAsset, type ChatJob } from '@/components/companion-v2/CompanionChat';
import ContributorChat from '@/components/companion-v2/ContributorChat';
import { getViewer, getWorkspace, loadPlaybookContent, toSnapshot } from '@/lib/companion-v2/server';
import { tagFor } from '@/lib/companion-v2/jobs';
import type { JobBody } from '@/lib/companion-v2/types';

// Converse: the adopter's chat with Cube (saved, with starter and suggested
// questions), or, for a contributor, the contributor chat (ask about the
// playbook, ask for changes, add files; saved, but not the proposed changes).
export default async function WorkspaceHome({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ job?: string; c?: string }>;
}) {
  const { slug } = await params;
  const { job, c } = await searchParams;
  const { playbook, member } = await getWorkspace(slug);

  if (member.member_role === 'contributor') {
    const { playbook: full, jobs: allJobs } = await loadPlaybookContent(playbook.id);
    return (
      <ContributorChat
        playbookId={full.id}
        memberId={member.id}
        conversationParam={typeof c === 'string' ? c : null}
        base={toSnapshot(full, allJobs)}
        updatedAt={full.updated_at}
      />
    );
  }

  const { supabase } = await getViewer();

  const [{ data: jobRows }, { data: assetRows }] = await Promise.all([
    supabase.from('playbook_jobs').select('job_code, name, position, body').eq('playbook_id', playbook.id),
    supabase.from('assets').select('id, title, kind, url, storage_path').eq('playbook_id', playbook.id),
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
    storage_path: a.storage_path,
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
      conversationParam={typeof c === 'string' ? c : null}
    />
  );
}
