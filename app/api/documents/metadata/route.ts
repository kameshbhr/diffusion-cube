import { createAdminClient } from '@/lib/supabase/admin';
import { checkDocumentMetadata } from '@/lib/cube-metadata';
import { canAddDocuments, documentCaller } from '@/lib/document-access';

// Cube raw layer: after a document is saved, checks it against its use
// case's and journeys' metadata and writes the changes (lib/cube-metadata.ts).
// A failure here never affects the saved document.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

export async function POST(req: Request) {
  const caller = await documentCaller();
  if (!caller) return Response.json({ error: 'Not authorized.' }, { status: 403 });
  const { source_id } = await req.json().catch(() => ({}));
  if (typeof source_id !== 'string' || !UUID.test(source_id)) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: source } = await admin.from('raw_sources').select('use_case_id').eq('id', source_id).maybeSingle();
  if (!source || !canAddDocuments(caller, source.use_case_id as string)) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }
  try {
    const result = await checkDocumentMetadata(admin, source_id);
    return Response.json(result);
  } catch (err) {
    console.error('[documents/metadata] failed:', (err as Error).message);
    return Response.json({ error: 'The metadata check failed.' }, { status: 502 });
  }
}
