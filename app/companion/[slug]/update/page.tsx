import Placeholder from '@/components/companion-v2/Placeholder';
import { requireContributor } from '@/lib/companion-v2/server';

export default async function UpdateWithCubePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireContributor(slug);
  return <Placeholder title="Update with Cube" body="Ask Cube to change the playbook or the source document, then review the changes before applying them. Coming in a later build step." />;
}
