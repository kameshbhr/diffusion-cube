import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { chunkText } from '@/lib/chunk-text';

// Cube raw layer (migration 0039): an admin uploads a document to a use case.
// The browser extracts the text (lib/extract-text.ts) and sends it here; the
// document and its passages are saved at once without embeddings, so keyword
// search works straight away. Embeddings come from ./embed, called
// repeatedly by the page, and metadata from ./metadata.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_CHARS = 3_000_000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !(await isAdmin(supabase, user.email))) return null;
  return user.email.toLowerCase();
}

// The page's data: use cases with their journeys, every document with its
// passage counts, and how many passages (documents and notes) wait for an
// embedding.
export async function GET() {
  if (!(await adminEmail())) return Response.json({ error: 'Not authorized.' }, { status: 403 });
  const admin = createAdminClient();
  const [useCases, journeys, documents, pending] = await Promise.all([
    admin.from('use_cases').select('id, name').order('name'),
    admin.from('journeys').select('id, use_case_id, name').order('name'),
    admin.rpc('cube_document_list'),
    admin.from('raw_source_passages').select('id', { count: 'exact', head: true }).is('embedding', null),
  ]);
  const failed = useCases.error ?? journeys.error ?? documents.error ?? pending.error;
  if (failed) {
    console.error('[admin/documents] load failed:', failed.message);
    return Response.json({ error: 'Could not load documents.' }, { status: 500 });
  }
  return Response.json({
    useCases: useCases.data ?? [],
    journeys: journeys.data ?? [],
    documents: documents.data ?? [],
    pendingPassages: pending.count ?? 0,
  });
}

// One document: { use_case_id, journey_ids?, title, text }.
// Answers { status: 'saved', source_id, passages } | { status: 'duplicate', title }
// | { status: 'skipped', reason }.
export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return Response.json({ error: 'Not authorized.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { use_case_id, journey_ids, title, text } = body ?? {};
  const journeyIds: string[] = Array.isArray(journey_ids) ? [...new Set(journey_ids as unknown[])].map(String) : [];
  if (
    typeof use_case_id !== 'string' ||
    !UUID.test(use_case_id) ||
    journeyIds.some((id) => !UUID.test(id)) ||
    typeof title !== 'string' ||
    !title.trim() ||
    typeof text !== 'string'
  ) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) return Response.json({ status: 'skipped', reason: 'The text is too long.' });

  // PDF extraction often yields null characters (\u0000), which Postgres can't
  // store ("unsupported Unicode escape sequence"), and other invisible control
  // characters. They're removed; line breaks and tabs stay. The duplicate
  // check hashes the cleaned text, so a re-upload is still a duplicate.
  const fullText = text.replace(CONTROL_CHARS, '').trim();
  const passages = chunkText(fullText);
  if (passages.length === 0) {
    return Response.json({ status: 'skipped', reason: 'No text could be read from this file (a scanned PDF?).' });
  }

  const admin = createAdminClient();
  const contentHash = createHash('sha256').update(fullText).digest('hex');

  const { data: existing, error: dupError } = await admin
    .from('raw_sources')
    .select('title')
    .eq('use_case_id', use_case_id)
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (dupError) {
    console.error('[admin/documents] duplicate check failed:', dupError.message);
    return Response.json({ error: 'Could not save the document.' }, { status: 500 });
  }
  if (existing) return Response.json({ status: 'duplicate', title: existing.title });

  const { data: source, error: insertError } = await admin
    .from('raw_sources')
    .insert({
      use_case_id,
      title: title.trim().slice(0, 300),
      content_hash: contentHash,
      full_text: fullText,
      added_by_email: email,
    })
    .select('id')
    .single();
  if (insertError) {
    // Two uploads of the same file at once: the unique (use_case_id, content_hash) catches the second.
    if (insertError.code === '23505') return Response.json({ status: 'duplicate', title: title.trim() });
    console.error('[admin/documents] insert failed:', insertError.message);
    return Response.json({ error: 'Could not save the document.' }, { status: 500 });
  }

  // Journeys and passages; if either fails the document is removed again, so
  // a half-saved document never sits there as a "duplicate".
  const links =
    journeyIds.length > 0
      ? await admin.from('raw_source_journeys').insert(journeyIds.map((journey_id) => ({ source_id: source.id, journey_id })))
      : { error: null };
  const chunks = links.error
    ? { error: links.error }
    : await admin.from('raw_source_passages').insert(
        passages.map((passage, i) => ({ source_id: source.id, chunk_index: i, text: passage }))
      );
  if (links.error || chunks.error) {
    console.error('[admin/documents] passages failed:', (links.error ?? chunks.error)?.message);
    await admin.from('raw_sources').delete().eq('id', source.id);
    const reason = links.error ? 'A chosen journey is not in this use case.' : 'Could not save its passages.';
    return Response.json({ error: `Could not save the document. ${reason}` }, { status: 500 });
  }

  return Response.json({ status: 'saved', source_id: source.id, passages: passages.length });
}
