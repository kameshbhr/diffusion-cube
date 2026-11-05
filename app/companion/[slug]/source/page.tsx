import SourceDocument from '@/components/companion-v2/SourceDocument';
import { loadPlaybookContent, requireContributor, toSnapshot } from '@/lib/companion-v2/server';

// Contributor-only: the source document, to read, edit, or update from files.
// 404 for everyone else (requireContributor).
export default async function SourceDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { playbook } = await requireContributor(slug);
  const { playbook: full, jobs } = await loadPlaybookContent(playbook.id);

  return <SourceDocument slug={full.slug} playbookId={full.id} base={toSnapshot(full, jobs)} updatedAt={full.updated_at} />;
}
