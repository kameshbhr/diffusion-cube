import ConversationList from '@/components/companion-v2/conversations/ConversationList';
import { getViewer, requireContributor } from '@/lib/companion-v2/server';
import { listConversations } from '@/lib/companion-v2/conversations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Contributor-only: adopters' conversations with Cube, read-only, through the
// contributor_list_conversations RPC. Every adopter is "User"; no name, email
// or id reaches this page. 404 for everyone else.
//
// ?ids=a,b,c (from a Digest item's "View conversations") shows exactly those
// conversations; ids that no longer exist, or aren't this playbook's, drop out.
export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const { slug } = await params;
  // A repeated key (?ids=a&ids=b) arrives as an array.
  const raw = (await searchParams).ids;
  const ids = Array.isArray(raw) ? raw.join(',') : raw;
  const { playbook } = await requireContributor(slug);
  const { supabase } = await getViewer();
  const all = await listConversations(supabase, playbook.id);

  const wanted = ids ? new Set(ids.split(',').filter((id) => UUID.test(id))) : null;
  const conversations = wanted ? all.filter((c) => wanted.has(c.conversation_id)) : all;

  return <ConversationList slug={playbook.slug} conversations={conversations} filtered={wanted !== null} />;
}
