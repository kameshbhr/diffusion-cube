import Placeholder from '@/components/companion-v2/Placeholder';
import { requireContributor } from '@/lib/companion-v2/server';

export default async function SourceDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireContributor(slug);
  return <Placeholder title="Source document" body="View and edit the source document, or update it from files. Coming in a later build step." />;
}
