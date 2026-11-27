// SERVER-ONLY. Saves a note from the web app (channel 'web'), the same way
// the connector's saveNote does for Claude (cube-connector/src/save-note.ts;
// keep the two in step):
//
//   1-2. cube_save_note_raw: checks write access and saves the raw note. The
//        author is stored by user id only (migration 0042).
//   3-4. Claude structures it (and, if the use case has several journeys,
//        picks the one it's clearly about), and the note's facts update the
//        use case's and journey's metadata. On failure the note stays
//        'unstructured'; nothing is lost.
//   +    The note's passage, embedded if the embed function answers, so one
//        search covers notes and documents straight away.

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedTexts, QUICK_EMBED, toPgVector } from '@/lib/embeddings';
import { applyMetadataUpdates, loadMetadataContext, type MetadataContext } from './metadata';
import { structureNote, type JourneyChoice } from './structure';

/** gte-small reads ~512 tokens (~1,600 characters): only the start is embedded. */
const EMBED_CHARS = 1600;

interface Candidate extends JourneyChoice {
  id: string;
}

export interface SavedNote {
  id: string;
  title: string | null;
  structured: boolean;
}

export async function saveWebNote(
  admin: SupabaseClient,
  authorId: string,
  useCaseId: string,
  rawText: string
): Promise<SavedNote> {
  const text = rawText.trim();
  const { data: journeyRows, error: jError } = await admin
    .from('journeys')
    .select('id, name, organisation')
    .eq('use_case_id', useCaseId);
  if (jError) throw new Error(jError.message);
  const journeys = (journeyRows ?? []) as Candidate[];
  // One journey: the note goes to it. Several: the Cube infers one or keeps the note general.
  const journeyIds = journeys.length === 1 ? [journeys[0].id] : [];
  const inferFrom = journeys.length > 1 ? journeys : [];

  const { data, error } = await admin.rpc('cube_save_note_raw', {
    p_author_id: authorId,
    p_use_case_id: useCaseId,
    p_journey_ids: journeyIds,
    p_raw_text: text,
    p_channel: 'web',
    p_source: 'conversation',
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { note_id: string } | undefined;
  if (!row?.note_id) throw new Error('The note could not be saved.');
  const noteId = row.note_id;

  const context = await loadMetadataContext(useCaseId, journeyIds.length ? journeyIds : inferFrom.map((j) => j.id));
  const [structured] = await Promise.all([
    structure(admin, noteId, text, inferFrom, context ? { context, journeyIds } : null),
    addPassage(admin, noteId, text),
  ]);

  const { data: saved } = await admin.from('cube_notes').select('title').eq('id', noteId).maybeSingle();
  return { id: noteId, title: (saved?.title as string | null) ?? null, structured };
}

async function structure(
  admin: SupabaseClient,
  noteId: string,
  text: string,
  inferFrom: Candidate[],
  metadata: { context: MetadataContext; journeyIds: string[] } | null
): Promise<boolean> {
  const fields = await structureNote(text, inferFrom, metadata?.context ?? null);
  if (!fields) return false;
  const linked = [...(metadata?.journeyIds ?? [])];
  if (fields.journey) {
    const match = inferFrom.find((j) => j.name === fields.journey);
    if (match) {
      const { data: didLink, error } = await admin.rpc('cube_link_inferred_journey', { p_note_id: noteId, p_journey_id: match.id });
      if (error) console.error('[web note] could not link the inferred journey:', error.message);
      else if (didLink) linked.push(match.id);
    }
  }
  if (metadata && fields.metadata) await applyMetadataUpdates(metadata.context, fields.metadata, linked);
  const { error } = await admin.rpc('cube_apply_structure', {
    p_note_id: noteId,
    p_note_type: fields.note_type,
    p_title: fields.title,
    p_situation: fields.situation,
    p_what_was_done: fields.what_was_done,
    p_how: fields.how,
    p_outcome: fields.outcome,
    p_why: fields.why,
    p_what_to_do_next_time: fields.what_to_do_next_time,
    p_open_question: fields.open_question,
    p_topics: fields.topics,
  });
  if (error) {
    console.error('[web note] could not store structured fields:', error.message);
    return false;
  }
  return true;
}

async function addPassage(admin: SupabaseClient, noteId: string, text: string): Promise<void> {
  let embedding: string | null = null;
  try {
    embedding = toPgVector((await embedTexts([text.slice(0, EMBED_CHARS)], QUICK_EMBED))[0]);
  } catch {
    // Logged by embedTexts; "Embed pending" fills it in later.
  }
  const { error } = await admin
    .from('raw_source_passages')
    .upsert({ note_id: noteId, chunk_index: 0, text, embedding }, { onConflict: 'note_id', ignoreDuplicates: true });
  if (error) console.error('[web note] could not save the passage:', error.message);
}
