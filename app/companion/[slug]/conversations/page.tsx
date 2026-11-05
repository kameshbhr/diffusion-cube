import Placeholder from '@/components/companion-v2/Placeholder';
import { requireContributor } from '@/lib/companion-v2/server';

export default async function ConversationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireContributor(slug);
  return <Placeholder title="Conversations" body="Adopter conversations, shown without names or emails. Coming in a later build step." />;
}
