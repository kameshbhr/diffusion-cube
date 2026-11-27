import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUseCaseAccess, hasAccess } from '@/lib/use-case-access';
import { dailyCap } from '@/lib/companion-v2/usage';
import { saveWebNote } from '@/lib/cube-notes/save-note';

// POST /api/companion/notes  { useCaseId, text }
//
// Saves a note Cube offered in the web chat, after the person said yes
// (docs/design/cube-usecase-plan.md, decision 9). Needs write access to the
// use case, decided in the database with the person's own session. The
// author is the signed-in person, stored by user id only; the text is theirs.
// Structuring the note is a model call, so it counts toward the person's
// daily limit like a chat message.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHARS = 8000;

export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Please sign in.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const useCaseId = typeof body?.useCaseId === 'string' && UUID.test(body.useCaseId) ? body.useCaseId : null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!useCaseId || !text || text.length > MAX_CHARS) return Response.json({ error: 'Invalid request.' }, { status: 400 });

  let access;
  try {
    access = await getUseCaseAccess(supabase, useCaseId);
  } catch (err) {
    console.error('[companion notes] access check failed:', (err as Error).message);
    return Response.json({ error: 'Could not check your access.' }, { status: 500 });
  }
  if (!hasAccess(access, 'write')) {
    return Response.json({ error: "You don't have access to add notes to this use case. Please contact the admin." }, { status: 403 });
  }

  const { data: allowed, error: capError } = await supabase.rpc('bump_companion_usage', {
    p_role: 'adopter',
    p_cap: dailyCap('adopter'),
  });
  if (capError) {
    console.error('[companion notes] usage counter failed:', capError.message);
    return Response.json({ error: 'Could not check the daily limit.' }, { status: 500 });
  }
  if (allowed === false) {
    return Response.json(
      { error: "You've reached today's limit for messages to Cube. It resets at midnight UTC." },
      { status: 429 }
    );
  }

  try {
    const note = await saveWebNote(createAdminClient(), user.id, useCaseId, text);
    return Response.json({ saved: true, title: note.title, structuring_pending: !note.structured });
  } catch (err) {
    console.error('[companion notes] save failed:', (err as Error).message);
    return Response.json({ error: 'The note could not be saved. Please try again.' }, { status: 500 });
  }
}
