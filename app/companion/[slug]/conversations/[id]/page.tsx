import { notFound } from 'next/navigation';
import ConversationView from '@/components/companion-v2/conversations/ConversationView';
import { getViewer, requireCurator } from '@/lib/companion-v2/server';
import { getConversation } from '@/lib/companion-v2/conversations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Curators only: one conversation, read-only, through the
// use_case_conversation RPC. 404 when it isn't this use case's, or the caller
// can't curate it.
export default async function ConversationPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { useCase } = await requireCurator(slug);
  if (!UUID.test(id)) notFound();
  const { supabase } = await getViewer();

  const conversation = await getConversation(supabase, id);
  // Also 404 for a conversation from another use case opened under this one's URL.
  if (!conversation || conversation.use_case_id !== useCase.id) notFound();

  return <ConversationView slug={useCase.slug} conversation={conversation} />;
}
