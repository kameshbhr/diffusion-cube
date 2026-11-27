import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { chunkText } from '@/lib/chunk-text';
import { canAddDocuments, canSeeAuthors, documentCaller } from '@/lib/document-access';

// Cube raw layer (migration 0039): a Cube admin, or anyone with write access
// to the use case, uploads a document to it (lib/document-access.ts).
// The browser extracts the text (lib/extract-text.ts) and sends it here; the
// document and its passages are saved at once without embeddings, so keyword
// search works straight away. Embeddings come from ./embed, called
// repeatedly by the page, and metadata from ./metadata.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_CHARS = 3_000_000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// The page's data: the use cases the caller may add documents to, with their
// journeys and documents (passage counts), and how many passages (documents
// and notes, everywhere) wait for an embedding. Who added a document is
// stored as a user id; its name is shown only to admins and the use case's
// curators (migration 0042).
export async function GET() {
  const caller = await documentCaller();
  if (!caller) return Response.json({ error: 'Not authorized.' }, { status: 403 });
  const admin = createAdminClient();
  const [useCases, journeys, documents, pending] = await Promise.all([
    admin.from('use_cases').select('id, name').order('name'),
    admin.from('journeys').select('id, use_case_id, name').order('name'),
    admin.rpc('cube_document_list'),
    admin.from('raw_source_passages').select('id', { count: 'exact', head: true }).is('embedding', null),
  ]);
  const failed = useCases.error ?? journeys.error ?? documents.error ?? pending.error;
  if (failed) {
    console.error('[documents] load failed:', failed.message);
    return Response.json({ error: 'Could not load documents.' }, { status: 500 });
  }
  const mine = (id: string) => canAddDocuments(caller, id);
  type DocRow = { use_case_id: string; added_by: string | null } & Record<string, unknown>;
  const docs = ((documents.data ?? []) as DocRow[]).filter((d) => mine(d.use_case_id));
  const shown = docs.filter((d) => canSeeAuthors(caller, d.use_case_id) && d.added_by).map((d) => d.added_by as string);
  const names = new Map<string, string>();
  if (shown.length) {
    const { data: people, error: namesError } = await admin.rpc('cube_person_names', { p_user_ids: [...new Set(shown)] });
    if (namesError) console.error('[documents] names failed:', namesError.message);
    for (const p of (people ?? []) as { user_id: string; name: string }[]) names.set(p.user_id, p.name);
  }
  return Response.json({
    useCases: (useCases.data ?? []).filter((u) => mine(u.id as string)),
    journeys: (journeys.data ?? []).filter((j) => mine(j.use_case_id as string)),
    documents: docs.map(({ added_by, ...d }) => ({
      ...d,
      added_by_name: canSeeAuthors(caller, d.use_case_id as string) && added_by ? (names.get(added_by) ?? null) : null,
      added_by_me: added_by === caller.userId,
    })),
    pendingPassages: pending.count ?? 0,
  });
}

// One document: { use_case_id, journey_ids?, title, text }.
// Answers { status: 'saved', source_id, passages } | { status: 'duplicate', title }
// | { status: 'skipped', reason }.
export async function POST(req: Request) {
  const caller = await documentCaller();
  if (!caller) return Response.json({ error: 'Not authorized.' }, { status: 403 });

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
  if (!canAddDocuments(caller, use_case_id)) {
    return Response.json({ error: "You don't have access to add documents to this use case." }, { status: 403 });
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
    console.error('[documents] duplicate check failed:', dupError.message);
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
      added_by: caller.userId,
    })
    .select('id')
    .single();
  if (insertError) {
    // Two uploads of the same file at once: the unique (use_case_id, content_hash) catches the second.
    if (insertError.code === '23505') return Response.json({ status: 'duplicate', title: title.trim() });
    console.error('[documents] insert failed:', insertError.message);
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
    console.error('[documents] passages failed:', (links.error ?? chunks.error)?.message);
    await admin.from('raw_sources').delete().eq('id', source.id);
    const reason = links.error ? 'A chosen journey is not in this use case.' : 'Could not save its passages.';
    return Response.json({ error: `Could not save the document. ${reason}` }, { status: 500 });
  }

  return Response.json({ status: 'saved', source_id: source.id, passages: passages.length });
}
