import { notFound } from 'next/navigation';
import ConversationView from '@/components/companion-v2/conversations/ConversationView';
import { getViewer, requireContributor } from '@/lib/companion-v2/server';
import { getConversation } from '@/lib/companion-v2/conversations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Contributor-only: one adopter conversation, read-only, through the
// contributor_get_conversation RPC. 404 when it isn't an adopter's
// conversation in this playbook, or the caller doesn't contribute to it.
export default async function ConversationPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { playbook } = await requireContributor(slug);
  if (!UUID.test(id)) notFound();
  const { supabase } = await getViewer();

  const [conversation, { data: jobRows, error: jobsError }] = await Promise.all([
    getConversation(supabase, id),
    supabase.from('playbook_jobs').select('job_code, name, position').eq('playbook_id', playbook.id),
  ]);
  // Also 404 for a conversation from another playbook opened under this one's URL.
  if (!conversation || conversation.playbook_id !== playbook.id) notFound();
  if (jobsError) throw jobsError;

  return <ConversationView slug={playbook.slug} conversation={conversation} jobs={jobRows ?? []} />;
}
