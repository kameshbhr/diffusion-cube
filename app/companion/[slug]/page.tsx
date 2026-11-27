import CompanionChat, { type ChatAsset, type ChatJob } from '@/components/companion-v2/CompanionChat';
import ContributorChat from '@/components/companion-v2/ContributorChat';
import { getViewer, getWorkspace, loadPlaybookContent, toSnapshot } from '@/lib/companion-v2/server';
import { sortJobs } from '@/lib/companion-v2/jobs';
import type { JobBody } from '@/lib/companion-v2/types';

// Converse: the chat with Cube about this use case (saved, with starter and
// suggested questions), answered from its playbook (if any), notes and
// documents. For a curator of a use case with a playbook, the curator chat
// instead (ask about the playbook, ask for changes, add files).
export default async function WorkspaceHome({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ job?: string; c?: string }>;
}) {
  const { slug } = await params;
  const { job, c } = await searchParams;
  const { useCase, access, playbook } = await getWorkspace(slug);

  if (access === 'curate' && playbook) {
    const { playbook: full, jobs: allJobs } = await loadPlaybookContent(playbook.id);
    return (
      <ContributorChat
        useCaseId={useCase.id}
        playbookId={full.id}
        conversationParam={typeof c === 'string' ? c : null}
        base={toSnapshot(full, allJobs)}
        updatedAt={full.updated_at}
      />
    );
  }

  let jobs: ChatJob[] = [];
  let assets: ChatAsset[] = [];
  if (playbook) {
    const { supabase } = await getViewer();
    const [{ data: jobRows }, { data: assetRows }] = await Promise.all([
      supabase.from('playbook_jobs').select('job_code, name, position, body').eq('playbook_id', playbook.id),
      supabase.from('assets').select('id, title, kind, url, storage_path').eq('playbook_id', playbook.id),
    ]);
    jobs = sortJobs(jobRows ?? []).map((j) => ({
      code: j.job_code,
      name: j.name,
      when: ((j.body ?? {}) as JobBody).when ?? '',
    }));
    assets = (assetRows ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      storage_path: a.storage_path,
      url: a.url,
    }));
  }

  return (
    <CompanionChat
      slug={useCase.slug}
      useCaseId={useCase.id}
      canWrite={access !== 'read'}
      hasPlaybook={playbook !== null}
      jobs={jobs}
      assets={assets}
      initialJob={typeof job === 'string' ? job : null}
      conversationParam={typeof c === 'string' ? c : null}
    />
  );
}
