import Placeholder from '@/components/companion-v2/Placeholder';
import { requireContributor } from '@/lib/companion-v2/server';

export default async function PlaybookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireContributor(slug);
  return <Placeholder title="Playbook" body="The full playbook with Overview, Roles, Jobs map and Sequence, and edit controls. Coming in a later build step." />;
}
