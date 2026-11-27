import ConversationList from '@/components/companion-v2/conversations/ConversationList';
import { getViewer, requireCurator } from '@/lib/companion-v2/server';
import { listConversations } from '@/lib/companion-v2/conversations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Curators only: the use case's conversations with Cube, read-only, through
// the use_case_conversations RPC. Everyone is "User"; no name, email or id
// reaches this page. 404 for everyone else.
//
// ?ids=a,b,c (from a Digest item's "View conversations") shows exactly those
// conversations; ids that no longer exist, or aren't this use case's, drop out.
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
  const { useCase } = await requireCurator(slug);
  const { supabase } = await getViewer();
  const all = await listConversations(supabase, useCase.id);

  const wanted = ids ? new Set(ids.split(',').filter((id) => UUID.test(id))) : null;
  const conversations = wanted ? all.filter((c) => wanted.has(c.conversation_id)) : all;

  return <ConversationList slug={useCase.slug} conversations={conversations} filtered={wanted !== null} />;
}
