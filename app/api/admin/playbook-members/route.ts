import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';

// Cube 2.0: an admin makes a user a contributor to one playbook, or removes
// that. Contributor status is per playbook and independent of Cube 1.0's
// pathway_contributor role. Removing deletes the membership, and with it
// (on delete cascade) the person's conversations and job states in that
// playbook, so a contributor's test chats never show up as an adopter's.
// If they open the playbook again, they join afresh as an adopter.
export async function POST(req: Request) {
  // Never trust the client: re-check against the caller's own session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAdmin(supabase, user?.email))) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const { playbook_id, user_id, action } = await req.json().catch(() => ({}));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    typeof playbook_id !== 'string' ||
    typeof user_id !== 'string' ||
    !UUID.test(playbook_id) ||
    !UUID.test(user_id) ||
    (action !== 'add' && action !== 'remove')
  ) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const admin = createAdminClient();

  if (action === 'add') {
    const { data: playbook, error: pbError } = await admin
      .from('playbooks')
      .select('id')
      .eq('id', playbook_id)
      .maybeSingle();
    if (pbError) return Response.json({ error: pbError.message }, { status: 500 });
    if (!playbook) return Response.json({ error: 'Unknown playbook.' }, { status: 404 });

    const { error } = await admin
      .from('playbook_members')
      .upsert({ playbook_id, user_id, member_role: 'contributor' }, { onConflict: 'user_id,playbook_id' });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    // Only a contributor row: an adopter's membership is never removed here.
    const { error } = await admin
      .from('playbook_members')
      .delete()
      .eq('playbook_id', playbook_id)
      .eq('user_id', user_id)
      .eq('member_role', 'contributor');
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
