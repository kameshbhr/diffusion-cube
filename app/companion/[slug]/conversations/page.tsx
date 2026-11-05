import ConversationList from '@/components/companion-v2/conversations/ConversationList';
import { getViewer, requireContributor } from '@/lib/companion-v2/server';
import { listConversations } from '@/lib/companion-v2/conversations';

// Contributor-only: adopters' conversations with Cube, read-only, through the
// contributor_list_conversations RPC. Every adopter is "User"; no name, email
// or id reaches this page. 404 for everyone else.
export default async function ConversationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { playbook } = await requireContributor(slug);
  const { supabase } = await getViewer();
  return <ConversationList slug={playbook.slug} conversations={await listConversations(supabase, playbook.id)} />;
}
