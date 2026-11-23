/**
 * The Cube tools from connector-contract.md (version 2), plus cube_read_source
 * (raw layer, migration 0039). Names match the contract, because the
 * cube-capture, cube-ask and cube-curator skills call them by these names.
 *
 * Every tool takes the caller's identity from the verified sign-in token and
 * is scoped to the use cases the caller can read (allowlisted, or open to
 * all); saving a note needs write access (scope.ts). No tool edits or deletes
 * notes or documents, and nothing here touches the playbook.
 */

import type { CallToolResult, MCPServer } from "mcp-use";
import type { SupabaseOAuthUser } from "mcp-use/oauth/supabase";
import { z } from "zod";

import { DATE_INPUT_HELP, parseDateInput } from "./dates.js";
import { db } from "./db.js";
import { embedTexts, QUICK_EMBED, toPgVector } from "./embeddings.js";
import { ensurePerson, identityForUser, type CubeIdentity } from "./identity.js";
import { loadNotes, shapeNotes, type NoteRow } from "./notes.js";
import { saveNote, type CandidateJourney } from "./save-note.js";
import {
  canWrite,
  checkJourneyFilter,
  checkUseCaseFilter,
  loadScope,
  NO_ACCESS_MESSAGE,
  pickUseCase,
  pickWritableUseCase,
  type CallerScope,
} from "./scope.js";
import { logToolCall } from "./usage.js";

type CubeServer = MCPServer<SupabaseOAuthUser>;

interface TokenCtx {
  auth: { user: SupabaseOAuthUser };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Thrown for problems Claude should relay as they are (not "couldn't complete"). */
class PlainError extends Error {}

/**
 * Runs a tool body with the caller's identity and use-case scope, turning any
 * thrown error into a plain tool error so Claude can tell the person. Every
 * call, refused ones included, is then written to the usage log (usage.ts).
 */
async function withCaller(
  ctx: TokenCtx,
  tool: string,
  input: object,
  body: (me: CubeIdentity, scope: CallerScope) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const startedAt = Date.now();
  let email = ctx.auth.user.email?.toLowerCase() || `user:${ctx.auth.user.id}`;
  let scope: CallerScope | null = null;
  let result: CallToolResult;
  try {
    const me = await identityForUser(ctx.auth.user.id);
    email = me.email;
    await ensurePerson(me);
    try {
      scope = await loadScope(me.email);
      result = await body(me, scope);
    } catch (err) {
      if (err instanceof PlainError) result = fail(err.message);
      else {
        console.error("[cube-connector] tool failed:", err);
        result = fail(`The Cube couldn't complete this: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    // Not allowed to use the connector (domain or unverified email).
    result = fail((err as Error).message);
  }
  await logToolCall({
    email,
    tool,
    input: input as Record<string, unknown>,
    readableUseCaseIds: scope ? scope.useCases.map((u) => u.id) : null,
    result,
    startedAt,
  });
  return result;
}

/** Wraps scope checks so their messages reach Claude unchanged. */
function plain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new PlainError((err as Error).message);
  }
}

function date(value: string, field: string): Date {
  return plain(() => parseDateInput(value, field));
}

const dateInput = (describe: string) => z.string().trim().min(1).describe(`${describe} ${DATE_INPUT_HELP}`);
const uuid = (describe: string) => z.string().trim().uuid().describe(describe);

const noteType = z.enum(["learned", "did", "stuck"]);
const outcome = z.enum(["worked", "did_not_work", "mixed", "too_early"]);
const status = z.enum(["unstructured", "new", "approved", "superseded", "disputed"]);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function registerCubeTools(server: CubeServer): void {
  // 1. cube_my_journeys ----------------------------------------------------
  server.tool(
    {
      name: "cube_my_journeys",
      title: "My use cases and journeys",
      description:
        "List the use cases the signed-in person can read, and the journeys in each (a journey is one team's lived experience of the use case, e.g. \"Bihar DC, 2026\"). " +
        "Each use case has access: 'write' and 'curate' mean the person can add notes to it, 'read' means they can only search and read it. " +
        "Each use case describes itself (objective, problem, users, sector), and each journey says who the adopter is (organisation), where (geography), and the scale and impact achieved. Use these as background, and say a field is empty rather than guessing. " +
        "Every journey in the use case is listed: with write access the person can write about any of them, or a general note, and anyone can filter searches by any of them. " +
        "Access 'curate' means the person can also edit the use case's playbook in the Cube app (is_curator is true); it includes write. " +
        "Call this once per conversation before saving a note or filtering by journey.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (_input, ctx) =>
      withCaller(ctx, "cube_my_journeys", _input, async (_me, scope) => {
        const result: Record<string, unknown> = { use_cases: scope.useCases };
        if (scope.useCases.length === 0) result.message = NO_ACCESS_MESSAGE;
        return ok(result);
      }),
  );

  // 2. cube_add_note -------------------------------------------------------
  server.tool(
    {
      name: "cube_add_note",
      title: "Add a note to the Cube",
      description:
        "Save one piece of know-how to the Cube. Only call this after the person has said yes to saving it. " +
        "Pass raw_text: the note in the person's own words, 1 to 5 sentences, self-contained (include the context it needs, such as which pilot or district, but nothing they didn't say). " +
        "The Cube works out the type, title, fields and topics itself, so don't send those. The author is recorded from sign-in: never pass a name. " +
        "Which journey: if the conversation makes it clear which journey or journeys the note is about, pass journey_ids (a note may cover several journeys of one use case, e.g. \"UP had the same problem\"). " +
        "Otherwise leave journey_ids out: if the use case has one journey the note goes to it; if it has several, the Cube links the one the note clearly names, or else keeps the note general. " +
        "Needs write access to the use case (access 'write' or 'curate' in cube_my_journeys). Pass use_case_id when leaving journey_ids out and the person can write to more than one use case; if it isn't clear which, ask them. " +
        "Returns the saved note with its id and title. If structuring_pending is true, the note is saved and will be tidied up later.",
      inputSchema: z.object({
        raw_text: z.string().trim().min(1).max(8000).describe("The note in the person's own words, self-contained."),
        journey_ids: z
          .array(uuid("A journey id from cube_my_journeys."))
          .max(20)
          .optional()
          .describe("Journeys this note is about, all in the same use case. Leave out if it isn't clear: the Cube infers one or keeps the note general."),
        use_case_id: uuid("The use case, from cube_my_journeys. Needed without journey_ids when the person can write to more than one use case.").optional(),
        source: z
          .enum(["conversation", "nudge", "document"])
          .optional()
          .describe("'nudge' when answering a daily nudge, 'document' when taken from a shared document, otherwise 'conversation' (the default)."),
        source_ref: z
          .string()
          .trim()
          .max(500)
          .optional()
          .describe("For documents: the document's name, plus its link if given. The document itself is not stored."),
        occurred_at: dateInput("Only if the person says it happened on a specific earlier date.").optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, "cube_add_note", input, async (me, scope) => {
        if (!scope.useCases.some(canWrite)) throw new PlainError(NO_ACCESS_MESSAGE);
        const journeyIds = [...new Set(input.journey_ids ?? [])];
        let useCaseId: string;
        let inferFrom: CandidateJourney[] = [];

        if (journeyIds.length > 0) {
          const useCasesOfJourneys = new Set<string>();
          for (const id of journeyIds) {
            const owner = scope.useCases.find((u) => u.journeys.some((j) => j.id === id));
            if (!owner) {
              throw new PlainError(`Journey ${id} isn't in any of your use cases. Call cube_my_journeys to see the journeys you can use.`);
            }
            useCasesOfJourneys.add(owner.id);
          }
          if (useCasesOfJourneys.size > 1) {
            throw new PlainError("All journeys on one note must be in the same use case. Save a separate note for each use case.");
          }
          useCaseId = [...useCasesOfJourneys][0];
          const target = scope.useCases.find((u) => u.id === useCaseId);
          if (!target || !canWrite(target)) throw new PlainError(NO_ACCESS_MESSAGE);
          if (input.use_case_id && input.use_case_id !== useCaseId) {
            throw new PlainError("use_case_id doesn't match the journeys given. Leave use_case_id out: it comes from the journeys.");
          }
        } else {
          // No journey named: the use case's only journey, or one inferred
          // from the text (below), or a general note.
          const useCase = plain(() => pickWritableUseCase(scope, input.use_case_id));
          useCaseId = useCase.id;
          if (useCase.journeys.length === 1) journeyIds.push(useCase.journeys[0].id);
          else inferFrom = useCase.journeys.map((j) => ({ id: j.id, name: j.name, organisation: j.organisation }));
        }

        const result = await saveNote({
          authorEmail: me.email,
          authorName: me.name,
          useCaseId,
          journeyIds,
          rawText: input.raw_text,
          channel: "claude",
          source: input.source ?? "conversation",
          sourceRef: input.source_ref || null,
          occurredAt: input.occurred_at ? date(input.occurred_at, "occurred_at") : null,
          inferJourneyFrom: inferFrom,
        });
        const data: Record<string, unknown> = {
          saved: true,
          structuring_pending: result.structuringPending,
          note: result.note,
        };
        if (result.structuringPending) {
          data.message = "The note is saved. Structuring is pending: it will be tidied up later. Nothing is lost.";
        }
        return ok(data);
      }),
  );

  // 3. cube_search_notes ---------------------------------------------------
  server.tool(
    {
      name: "cube_search_notes",
      title: "Search the Cube",
      description:
        "Search everything the person can read in the Cube: notes people wrote, and passages of documents an admin uploaded, across every journey. " +
        "It matches both meaning and exact words, best matches first, so a plain-language question works (e.g. \"people don't answer unknown calls\"), and so does an exact term or acronym (e.g. \"ADIP\"). If the first results miss, search again with other words. " +
        "Each result has kind 'note' or 'document'. A note has the usual note fields and lists the journeys it came from; check status: 'superseded' means a later note replaced it, 'disputed' means the curator hasn't settled it, 'unstructured' means it hasn't been tidied yet, so read raw_text. " +
        "A document result is one passage: its text, source_id, the document's title, chunk_index and journeys. To read the text around it, call cube_read_source with source_id and a range of chunks around chunk_index. " +
        "Optional filters: use_case_id, journey_id (ids from cube_my_journeys; keeps notes and documents linked to that journey), since, until. The note-only filters note_type, outcome (e.g. 'did_not_work' for what went wrong), status and author_email leave documents out.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500).describe("The question or key words to look for."),
        use_case_id: uuid("Only this use case.").optional(),
        journey_id: uuid("Only notes and documents linked to this journey.").optional(),
        note_type: noteType.optional().describe("Only 'learned', 'did' or 'stuck' notes (leaves documents out)."),
        outcome: outcome.optional().describe("Only notes with this outcome (leaves documents out)."),
        status: status.optional().describe("Only notes with this status, e.g. 'approved' (leaves documents out)."),
        since: dateInput("Only notes and documents added on or after this.").optional(),
        until: dateInput("Only notes and documents added before this.").optional(),
        author_email: z.string().trim().email().optional().describe("Only notes by this person (leaves documents out)."),
        limit: z.number().int().min(1).max(30).optional().describe("How many results to return. Default 10, at most 30."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, "cube_search_notes", input, async (_me, scope) => {
        if (scope.useCases.length === 0) return ok({ count: 0, results: [], message: NO_ACCESS_MESSAGE });
        plain(() => checkUseCaseFilter(scope, input.use_case_id));
        plain(() => checkJourneyFilter(scope, input.journey_id));

        // Meaning and words when the embed function answers; words only otherwise.
        let embedding: string | null = null;
        try {
          embedding = toPgVector((await embedTexts([input.query], QUICK_EMBED))[0]);
        } catch {
          // Logged by embedTexts.
        }

        const { data, error } = await db().rpc("cube_search_passages", {
          p_query: input.query,
          p_embedding: embedding,
          p_use_case_ids: input.use_case_id ? [input.use_case_id] : scope.useCases.map((u) => u.id),
          p_limit: input.limit ?? 10,
          p_journey_id: input.journey_id ?? null,
          p_note_type: input.note_type ?? null,
          p_outcome: input.outcome ?? null,
          p_status: input.status ?? null,
          p_author_email: input.author_email?.toLowerCase() ?? null,
          p_since: input.since ? date(input.since, "since").toISOString() : null,
          p_until: input.until ? date(input.until, "until").toISOString() : null,
        });
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as PassageHit[];

        const noteIds = rows.filter((r) => r.note_id).map((r) => r.note_id as string);
        const sourceIds = rows.filter((r) => r.source_id).map((r) => r.source_id as string);
        const [notes, sourceJourneys] = await Promise.all([loadNotes(noteIds), journeysOfSources(sourceIds)]);
        const noteById = new Map(notes.map((n) => [n.id, n]));
        const useCaseName = new Map(scope.useCases.map((u) => [u.id, u.name]));

        const results: Record<string, unknown>[] = [];
        for (const row of rows) {
          if (row.kind === "note") {
            const note = noteById.get(row.note_id as string);
            if (note) results.push({ kind: "note", ...note });
          } else {
            results.push({
              kind: "document",
              text: row.text,
              source_id: row.source_id,
              title: row.source_title,
              chunk_index: row.chunk_index,
              use_case_id: row.use_case_id,
              use_case_name: useCaseName.get(row.use_case_id) ?? null,
              journeys: sourceJourneys.get(row.source_id as string) ?? [],
              added_at: row.created_at,
            });
          }
        }
        const result: Record<string, unknown> = { count: results.length, results };
        if (!embedding) result.search_mode = "words only (meaning search is unavailable right now)";
        return ok(result);
      }),
  );

  // 4. cube_recent_notes ---------------------------------------------------
  server.tool(
    {
      name: "cube_recent_notes",
      title: "List recent Cube notes",
      description:
        "List notes added in a date range in the person's use cases, across every journey, newest first. Use for digests, nudges and curator reports. " +
        "Optional filters: use_case_id, journey_id (ids from cube_my_journeys), and author: 'me' for the signed-in person's own notes, or a person's email.",
      inputSchema: z.object({
        since: dateInput("Notes created on or after this (required)."),
        until: dateInput("Notes created before this.").optional(),
        use_case_id: uuid("Only notes in this use case.").optional(),
        journey_id: uuid("Only notes linked to this journey.").optional(),
        author: z.string().trim().min(1).optional().describe("'me' or a person's email."),
        limit: z.number().int().min(1).max(200).optional().describe("How many notes to return. Default 50, at most 200."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, "cube_recent_notes", input, async (me, scope) => {
        if (scope.useCases.length === 0) return ok({ count: 0, notes: [], message: NO_ACCESS_MESSAGE });
        plain(() => checkUseCaseFilter(scope, input.use_case_id));
        plain(() => checkJourneyFilter(scope, input.journey_id));
        let author: string | null = null;
        if (input.author) {
          author = input.author.toLowerCase() === "me" ? me.email : input.author.toLowerCase();
          if (!author.includes("@")) throw new PlainError("author must be 'me' or an email address.");
        }
        const { data, error } = await db().rpc("cube_recent_notes", {
          p_caller_email: me.email,
          p_since: date(input.since, "since").toISOString(),
          p_until: input.until ? date(input.until, "until").toISOString() : null,
          p_use_case_id: input.use_case_id ?? null,
          p_journey_id: input.journey_id ?? null,
          p_author_email: author,
          p_limit: input.limit ?? 50,
        });
        if (error) throw new Error(error.message);
        const notes = await shapeNotes((data ?? []) as NoteRow[]);
        return ok({ count: notes.length, notes });
      }),
  );

  // 5. cube_log_question ---------------------------------------------------
  server.tool(
    {
      name: "cube_log_question",
      title: "Log a question the Cube couldn't answer",
      description:
        "Record a question the Cube had no notes on (or only partly answered), so the use case's curator sees it. " +
        "Write the question plainly, as the person asked it. Pass use_case_id if the person has more than one use case. Who asked and when are recorded automatically.",
      inputSchema: z.object({
        question: z.string().trim().min(1).max(2000).describe("The unanswered question."),
        use_case_id: uuid("The use case the question is about. Optional if the person has only one.").optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, "cube_log_question", input, async (me, scope) => {
        const useCase = plain(() => pickUseCase(scope, input.use_case_id));
        const { data, error } = await db()
          .from("cube_questions")
          .insert({
            use_case_id: useCase.id,
            question: input.question,
            asked_by_email: me.email,
            asked_by_name: me.name,
          })
          .select("id, use_case_id, question, asked_by_name, asked_by_email, created_at, resolved")
          .single();
        if (error) throw new Error(error.message);
        return ok({ logged: true, question: { ...data, use_case_name: useCase.name } });
      }),
  );

  // 6. cube_open_questions -------------------------------------------------
  server.tool(
    {
      name: "cube_open_questions",
      title: "List open questions",
      description:
        "List questions the Cube couldn't answer that nobody has resolved yet, in the person's use cases, newest first. Optional: use_case_id, since.",
      inputSchema: z.object({
        use_case_id: uuid("Only questions in this use case.").optional(),
        since: dateInput("Only questions logged on or after this.").optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, "cube_open_questions", input, async (_me, scope) => {
        if (scope.useCases.length === 0) return ok({ count: 0, questions: [], message: NO_ACCESS_MESSAGE });
        plain(() => checkUseCaseFilter(scope, input.use_case_id));
        const ids = input.use_case_id ? [input.use_case_id] : scope.useCases.map((u) => u.id);
        let query = db()
          .from("cube_questions")
          .select("id, use_case_id, question, asked_by_name, asked_by_email, created_at")
          .in("use_case_id", ids)
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(200);
        if (input.since) query = query.gte("created_at", date(input.since, "since").toISOString());
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const names = new Map(scope.useCases.map((u) => [u.id, u.name]));
        const questions = (data ?? []).map((q) => ({ ...q, use_case_name: names.get(q.use_case_id as string) ?? null }));
        return ok({ count: questions.length, questions });
      }),
  );

  // 7. cube_team_activity --------------------------------------------------
  server.tool(
    {
      name: "cube_team_activity",
      title: "Team activity",
      description:
        "One row per person in a use case (its members and the curators of its playbooks): name, email, the journeys they've written about, number of notes since the given date, and the date of their last note. " +
        "Includes people with zero notes. Pass use_case_id if the person has more than one use case. For learning, not for judging people.",
      inputSchema: z.object({
        use_case_id: uuid("The use case. Optional if the person has only one.").optional(),
        since: dateInput("Count notes created on or after this."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, "cube_team_activity", input, async (_me, scope) => {
        const useCase = plain(() => pickUseCase(scope, input.use_case_id));
        const { data, error } = await db().rpc("cube_team_activity", {
          p_use_case_id: useCase.id,
          p_since: date(input.since, "since").toISOString(),
        });
        if (error) throw new Error(error.message);
        const people = ((data ?? []) as Record<string, unknown>[]).map((p) => ({
          name: p.name ?? null,
          email: p.email,
          journeys: p.journeys ?? [],
          notes_in_period: Number(p.notes_in_period ?? 0),
          last_note_at: p.last_note_at ?? null,
        }));
        return ok({ use_case_id: useCase.id, use_case_name: useCase.name, count: people.length, people });
      }),
  );

  // 8. cube_read_source ----------------------------------------------------
  server.tool(
    {
      name: "cube_read_source",
      title: "Read part of a document",
      description:
        "Read consecutive passages of an uploaded document, in order, to see the text around a passage that cube_search_notes found. " +
        "Pass the result's source_id and a range of chunk numbers around its chunk_index (e.g. for chunk_index 5: from_chunk 3, to_chunk 7). " +
        "At most 10 passages per call; total_passages says how many the document has.",
      inputSchema: z.object({
        source_id: uuid("The document's source_id, from a cube_search_notes result."),
        from_chunk: z.number().int().min(0).describe("First passage to return (its chunk_index)."),
        to_chunk: z.number().int().min(0).describe("Last passage to return (its chunk_index). At most 9 more than from_chunk."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, "cube_read_source", input, async (_me, scope) => {
        const { data: source, error } = await db()
          .from("raw_sources")
          .select("id, use_case_id, title, created_at")
          .eq("id", input.source_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const useCase = source ? scope.useCases.find((u) => u.id === source.use_case_id) : undefined;
        // An unknown id and an unreadable one get the same answer, so ids reveal nothing.
        if (!source || !useCase) throw new PlainError(NO_ACCESS_MESSAGE);
        if (input.to_chunk < input.from_chunk) throw new PlainError("to_chunk must not be less than from_chunk.");
        const to = Math.min(input.to_chunk, input.from_chunk + MAX_READ_PASSAGES - 1);

        const [passages, total, journeys] = await Promise.all([
          db()
            .from("raw_source_passages")
            .select("chunk_index, text")
            .eq("source_id", source.id)
            .gte("chunk_index", input.from_chunk)
            .lte("chunk_index", to)
            .order("chunk_index", { ascending: true }),
          db().from("raw_source_passages").select("id", { count: "exact", head: true }).eq("source_id", source.id),
          journeysOfSources([source.id]),
        ]);
        if (passages.error) throw new Error(passages.error.message);
        if (total.error) throw new Error(total.error.message);
        return ok({
          source_id: source.id,
          title: source.title,
          use_case_id: useCase.id,
          use_case_name: useCase.name,
          journeys: journeys.get(source.id) ?? [],
          added_at: source.created_at,
          total_passages: total.count ?? 0,
          passages: passages.data ?? [],
        });
      }),
  );
}

const MAX_READ_PASSAGES = 10;

/** One row from cube_search_passages. */
interface PassageHit {
  passage_id: string;
  kind: "note" | "document";
  note_id: string | null;
  source_id: string | null;
  source_title: string | null;
  chunk_index: number;
  text: string;
  use_case_id: string;
  created_at: string;
  score: number;
}

/** The journeys linked to each document. */
async function journeysOfSources(sourceIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const result = new Map<string, { id: string; name: string }[]>();
  const ids = [...new Set(sourceIds)];
  if (ids.length === 0) return result;
  const { data, error } = await db().from("raw_source_journeys").select("source_id, journeys(id, name)").in("source_id", ids);
  if (error) throw new Error(error.message);
  for (const link of (data ?? []) as unknown as {
    source_id: string;
    journeys: { id: string; name: string } | { id: string; name: string }[] | null;
  }[]) {
    const list = result.get(link.source_id) ?? [];
    for (const j of Array.isArray(link.journeys) ? link.journeys : link.journeys ? [link.journeys] : []) {
      list.push({ id: j.id, name: j.name });
    }
    result.set(link.source_id, list.sort((a, b) => a.name.localeCompare(b.name)));
  }
  return result;
}
