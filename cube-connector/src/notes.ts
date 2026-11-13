/**
 * The note shape every tool returns (connector-contract.md, "Tools"): id,
 * title, raw_text, the structured fields that are set, note_type, outcome,
 * topics, status, channel, source, source_ref, author_name, author_email,
 * created_at, occurred_at, the use case name and the linked journeys.
 */

import { db } from "./db.js";

export type NoteRow = Record<string, unknown> & { id: string; use_case_id: string };
export type Note = Record<string, unknown> & { id: string; status: string };

const NOTE_COLUMNS =
  "id, use_case_id, raw_text, channel, source, source_ref, external_id, occurred_at, author_email, author_name, created_at, " +
  "note_type, title, situation, what_was_done, how, outcome, why, what_to_do_next_time, open_question, topics, status";

const OPTIONAL_STRUCTURED_FIELDS = [
  "situation",
  "what_was_done",
  "how",
  "why",
  "what_to_do_next_time",
  "open_question",
] as const;

/** Adds use case names and linked journeys to raw rows, keeping their order. */
export async function shapeNotes(rows: NoteRow[]): Promise<Note[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const useCaseIds = [...new Set(rows.map((r) => r.use_case_id))];

  const [links, useCases] = await Promise.all([
    db().from("cube_note_journeys").select("note_id, journeys(id, name)").in("note_id", ids),
    db().from("use_cases").select("id, name").in("id", useCaseIds),
  ]);
  if (links.error) throw new Error(links.error.message);
  if (useCases.error) throw new Error(useCases.error.message);

  const journeysByNote = new Map<string, { id: string; name: string }[]>();
  for (const link of (links.data ?? []) as unknown as {
    note_id: string;
    journeys: { id: string; name: string } | { id: string; name: string }[] | null;
  }[]) {
    const list = journeysByNote.get(link.note_id) ?? [];
    for (const j of Array.isArray(link.journeys) ? link.journeys : link.journeys ? [link.journeys] : []) {
      list.push({ id: j.id, name: j.name });
    }
    journeysByNote.set(link.note_id, list);
  }
  const useCaseName = new Map((useCases.data ?? []).map((u) => [u.id as string, u.name as string]));

  return rows.map((row) => {
    const note: Note = {
      id: row.id,
      title: row.title ?? null,
      raw_text: row.raw_text,
      status: row.status as string,
    };
    for (const field of OPTIONAL_STRUCTURED_FIELDS) {
      const value = row[field];
      if (value !== null && value !== undefined && value !== "") note[field] = value;
    }
    note.note_type = row.note_type ?? null;
    note.outcome = row.outcome ?? null;
    note.topics = row.topics ?? [];
    note.status = row.status as string;
    note.channel = row.channel;
    note.source = row.source;
    note.source_ref = row.source_ref ?? null;
    note.author_name = row.author_name ?? null;
    note.author_email = row.author_email;
    note.created_at = row.created_at;
    note.occurred_at = row.occurred_at ?? null;
    note.use_case_id = row.use_case_id;
    note.use_case_name = useCaseName.get(row.use_case_id) ?? null;
    note.journeys = (journeysByNote.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return note;
  });
}

/** Reads notes by id, in the order given. */
export async function loadNotes(ids: string[]): Promise<Note[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db().from("cube_notes").select(NOTE_COLUMNS).in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map(((data ?? []) as unknown as NoteRow[]).map((r) => [r.id, r]));
  return shapeNotes(ids.map((id) => byId.get(id)).filter((r): r is NoteRow => Boolean(r)));
}
