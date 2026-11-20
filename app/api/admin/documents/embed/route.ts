import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { embedTexts, toPgVector } from '@/lib/embeddings';

// Cube raw layer: embeds the next few passages that have no embedding
// (documents' and notes'). The Documents page calls this repeatedly and shows
// progress, so each request stays short whatever the host's time limit is.
// { add_note_passages: true } first adds a passage for every Cube note that
// has none ("Embed pending").
//
// A passage that can't be embedded is skipped for this run (the page passes
// back `skip`), so one bad passage never blocks the ones after it; the next
// "Embed pending" tries it again.

const BATCH = 8;
// gte-small reads ~512 tokens (~1,600 characters), and longer texts can
// overload the embed function. Document passages are already this size;
// a note's passage is its whole raw text, so only its start is embedded.
const EMBED_CHARS = 1600;
// A batch that failed slower than this was probably a hang or timeout;
// retrying each passage could then run past maxDuration, so the run stops.
const FAST_FAILURE_MS = 10_000;
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
  const body = await req.json().catch(() => ({}));
  const skip: string[] = Array.isArray(body?.skip)
    ? (body.skip as unknown[]).filter((id): id is string => typeof id === 'string' && UUID.test(id)).slice(0, 500)
    : [];
  const admin = createAdminClient();

  if (body?.add_note_passages === true) {
    const { error } = await admin.rpc('cube_add_missing_note_passages');
    if (error) {
      console.error('[admin/documents/embed] adding note passages failed:', error.message);
      return Response.json({ error: "Could not add the notes' passages." }, { status: 500 });
    }
  }

  let query = admin
    .from('raw_source_passages')
    .select('id, text')
    .is('embedding', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BATCH);
  if (skip.length > 0) query = query.not('id', 'in', `(${skip.join(',')})`);
  const { data: rows, error } = await query;
  if (error) {
    console.error('[admin/documents/embed] load failed:', error.message);
    return Response.json({ error: 'Could not load passages.' }, { status: 500 });
  }

  let embedded = 0;
  const failed: string[] = [];
  const store = async (id: string, vector: number[]) => {
    const { error: updateError } = await admin
      .from('raw_source_passages')
      .update({ embedding: toPgVector(vector) })
      .eq('id', id);
    if (updateError) throw new Error(updateError.message);
    embedded++;
  };

  const batch = (rows ?? []).map((r) => ({ id: r.id as string, text: String(r.text).slice(0, EMBED_CHARS) }));
  if (batch.length > 0) {
    try {
      let vectors: number[][] | null = null;
      const started = Date.now();
      try {
        vectors = await embedTexts(batch.map((r) => r.text));
      } catch {
        // Handled below.
      }
      if (vectors) {
        for (let i = 0; i < batch.length; i++) await store(batch[i].id, vectors[i]);
      } else if (Date.now() - started < FAST_FAILURE_MS) {
        // The batch was refused quickly (not a hang): try each passage alone,
        // so one bad passage only skips itself.
        for (const row of batch) {
          let vector: number[] | null = null;
          try {
            [vector] = await embedTexts([row.text]);
          } catch {
            failed.push(row.id);
          }
          if (vector) await store(row.id, vector);
        }
      }
    } catch (err) {
      console.error('[admin/documents/embed] update failed:', (err as Error).message);
      return Response.json({ error: 'Could not store embeddings.' }, { status: 500 });
    }
    // Nothing in the batch could be embedded: the embed function is most
    // likely down, so stop rather than walk through every passage.
    if (embedded === 0) {
      return Response.json(
        { error: "The embedding service didn't answer. Keyword search still works; try \"Embed pending\" later." },
        { status: 502 }
      );
    }
  }

  const { count, error: countError } = await admin
    .from('raw_source_passages')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null);
  if (countError) return Response.json({ error: 'Could not count passages.' }, { status: 500 });
  return Response.json({ embedded, failed, remaining: count ?? 0 });
}
