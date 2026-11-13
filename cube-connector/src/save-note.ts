/**
 * save_note: the one shared save function from connector-contract.md.
 *
 * The connector's cube_add_note calls it with channel 'claude'. A future
 * channel (WhatsApp, email, web form, meeting import) calls it the same way
 * with its own channel and external_id, after working out the author and use
 * case on its side.
 *
 *   1-2. cube_save_note_raw (SQL, one transaction): check the author belongs
 *        to the use case and every journey is in it, then insert the raw
 *        note as 'unstructured' with its journey links.
 *   3.   Ask Claude to structure it (20-second timeout). If the note has no
 *        journey and the caller passes the use case's journeys, the same call
 *        asks which one the note is clearly about; a match is linked, else
 *        the note stays general.
 *   4.   On success, write the fields; the note becomes 'new'.
 *   5.   On failure, the note stays 'unstructured'. Nothing is lost.
 */

import { db } from "./db.js";
import { loadNotes, type Note } from "./notes.js";
import { structureNote, type JourneyChoice, type StructuredFields } from "./structure.js";

export interface CandidateJourney extends JourneyChoice {
  id: string;
}

export type Channel = "claude" | "whatsapp" | "email" | "web" | "meeting" | "import";
export type Source = "conversation" | "nudge" | "document";

export interface SaveNoteInput {
  authorEmail: string;
  authorName: string | null;
  useCaseId: string;
  journeyIds: string[];
  rawText: string;
  channel: Channel;
  source?: Source;
  sourceRef?: string | null;
  externalId?: string | null;
  occurredAt?: Date | null;
  /**
   * Journeys to pick from when `journeyIds` is empty: the server links the
   * one the note is clearly about, if any. Leave empty for no inference.
   */
  inferJourneyFrom?: CandidateJourney[];
}

export interface SaveNoteResult {
  note: Note;
  /** True when structuring didn't happen; the note is saved as 'unstructured'. */
  structuringPending: boolean;
  /** True when this channel's external_id had been saved before. */
  alreadySaved: boolean;
}

/**
 * Steps 3-4 for one note, plus the journey guess when `inferFrom` is given.
 * Returns whether it is now structured.
 */
export async function structureAndApply(
  noteId: string,
  rawText: string,
  inferFrom: CandidateJourney[] = [],
): Promise<boolean> {
  const fields: StructuredFields | null = await structureNote(rawText, inferFrom);
  if (!fields) return false;
  if (fields.journey) {
    const match = inferFrom.find((j) => j.name === fields.journey);
    if (match) {
      const { error: linkError } = await db().rpc("cube_link_inferred_journey", {
        p_note_id: noteId,
        p_journey_id: match.id,
      });
      if (linkError) console.error("[cube-connector] couldn't link the inferred journey:", linkError.message);
    }
  }
  const { error } = await db().rpc("cube_apply_structure", {
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
    console.error("[cube-connector] couldn't store structured fields:", error.message);
    return false;
  }
  return true;
}

export async function saveNote(input: SaveNoteInput): Promise<SaveNoteResult> {
  const { data, error } = await db().rpc("cube_save_note_raw", {
    p_author_email: input.authorEmail,
    p_author_name: input.authorName,
    p_use_case_id: input.useCaseId,
    p_journey_ids: input.journeyIds,
    p_raw_text: input.rawText,
    p_channel: input.channel,
    p_source: input.source ?? "conversation",
    p_source_ref: input.sourceRef ?? null,
    p_external_id: input.externalId ?? null,
    p_occurred_at: input.occurredAt ? input.occurredAt.toISOString() : null,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { note_id: string; already_saved: boolean } | undefined;
  if (!row?.note_id) throw new Error("The note couldn't be saved.");

  if (!row.already_saved) {
    const inferFrom = input.journeyIds.length === 0 ? (input.inferJourneyFrom ?? []) : [];
    await structureAndApply(row.note_id, input.rawText.trim(), inferFrom);
  }

  const [note] = await loadNotes([row.note_id]);
  if (!note) throw new Error("The note was saved but couldn't be read back.");
  return {
    note,
    structuringPending: note.status === "unstructured",
    alreadySaved: row.already_saved,
  };
}
