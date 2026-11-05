import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';

// Cube 2.0: an admin makes a user a contributor to one playbook, or removes
// that. Contributor status is per playbook and independent of Cube 1.0's
// pathway_contributor role. Removing deletes the membership, unless the user
// has their own adopter conversations in that playbook: then it is set back
// to adopter so those conversations and job states are kept.
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
    const { data: member, error: findError } = await admin
      .from('playbook_members')
      .select('id')
      .eq('playbook_id', playbook_id)
      .eq('user_id', user_id)
      .maybeSingle();
    if (findError) return Response.json({ error: findError.message }, { status: 500 });
    if (!member) return Response.json({ ok: true });

    const { count, error: countError } = await admin
      .from('companion_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id);
    if (countError) return Response.json({ error: countError.message }, { status: 500 });

    const { error } = count
      ? await admin.from('playbook_members').update({ member_role: 'adopter' }).eq('id', member.id)
      : await admin.from('playbook_members').delete().eq('id', member.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
