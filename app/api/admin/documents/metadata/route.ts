import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { checkDocumentMetadata } from '@/lib/cube-metadata';

// Cube raw layer: after a document is saved, checks it against its use
// case's and journeys' metadata and writes the changes (lib/cube-metadata.ts).
// A failure here never affects the saved document.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAdmin(supabase, user?.email))) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const { source_id } = await req.json().catch(() => ({}));
  if (typeof source_id !== 'string' || !UUID.test(source_id)) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  try {
    const result = await checkDocumentMetadata(createAdminClient(), source_id);
    return Response.json(result);
  } catch (err) {
    console.error('[admin/documents/metadata] failed:', (err as Error).message);
    return Response.json({ error: 'The metadata check failed.' }, { status: 502 });
  }
}
