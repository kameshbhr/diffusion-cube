/**
 * Admin script (not an MCP tool): re-run structuring (save_note, steps 3-4).
 *
 *   npm run restructure                  every 'unstructured' note
 *   npm run restructure -- --ids a,b,c   these notes (e.g. after the prompt changes)
 *   npm run restructure -- --all         every note
 *
 * Only the structured fields change. Origin fields never change, and a note
 * the curator already reviewed keeps its status. A note with no journey also
 * gets another try at inferring one, when its use case has several journeys.
 * Uses .env, like the server.
 */

import { db } from "./db.js";
import { structureAndApply, type CandidateJourney } from "./save-note.js";

/** Journeys to infer from for a note with no journey (two or more in its use case). */
async function candidatesFor(noteId: string, useCaseId: string): Promise<CandidateJourney[]> {
  const { count, error } = await db()
    .from("cube_note_journeys")
    .select("note_id", { count: "exact", head: true })
    .eq("note_id", noteId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return [];
  const { data, error: jError } = await db()
    .from("journeys")
    .select("id, name, organisation")
    .eq("use_case_id", useCaseId);
  if (jError) throw new Error(jError.message);
  const journeys = (data ?? []) as CandidateJourney[];
  return journeys.length > 1 ? journeys : [];
}

type NoteToRedo = { id: string; raw_text: string; use_case_id: string };

async function noteIds(args: string[]): Promise<NoteToRedo[]> {
  const idsFlag = args.indexOf("--ids");
  let query = db().from("cube_notes").select("id, raw_text, use_case_id").order("created_at", { ascending: true });
  if (idsFlag !== -1) {
    const ids = (args[idsFlag + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error("--ids needs a comma-separated list of note ids.");
    query = query.in("id", ids);
  } else if (!args.includes("--all")) {
    query = query.eq("status", "unstructured");
  }
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as NoteToRedo[];
}

async function main(): Promise<void> {
  const notes = await noteIds(process.argv.slice(2));
  console.log(`Structuring ${notes.length} note(s)...`);
  let done = 0;
  const failed: string[] = [];
  for (const note of notes) {
    if (await structureAndApply(note.id, note.raw_text, await candidatesFor(note.id, note.use_case_id))) done++;
    else failed.push(note.id);
  }
  console.log(`Structured ${done} of ${notes.length}.`);
  if (failed.length > 0) {
    console.log(`Still unstructured or unchanged (${failed.length}): ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
