import ContributorChat from '@/components/companion-v2/ContributorChat';
import { loadPlaybookContent, requireContributor, toSnapshot } from '@/lib/companion-v2/server';

// Contributor-only: Update with Cube. 404 for everyone else (requireContributor).
export default async function UpdateWithCubePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { slug } = await params;
  const { from } = await searchParams;
  const { playbook } = await requireContributor(slug);
  const { playbook: full, jobs } = await loadPlaybookContent(playbook.id);

  return (
    <ContributorChat
      playbookId={full.id}
      base={toSnapshot(full, jobs)}
      updatedAt={full.updated_at}
      fromFiles={from === 'files'}
    />
  );
}
