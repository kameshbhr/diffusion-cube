/**
 * The seven Cube tools from connector-contract.md (version 2). Names, inputs
 * and outputs match the contract exactly, because the cube-capture, cube-ask
 * and cube-curator skills call them by these names.
 *
 * Every tool takes the caller's identity from the verified sign-in token and
 * is scoped to the caller's use cases. No tool edits or deletes notes, and
 * nothing here touches the playbook.
 */

import type { CallToolResult, MCPServer } from "mcp-use";
import type { SupabaseOAuthUser } from "mcp-use/oauth/supabase";
import { z } from "zod";

import { DATE_INPUT_HELP, parseDateInput } from "./dates.js";
import { db } from "./db.js";
import { ensurePerson, identityForUser, type CubeIdentity } from "./identity.js";
import { shapeNotes, type NoteRow } from "./notes.js";
import { saveNote, type CandidateJourney } from "./save-note.js";
import {
  checkJourneyFilter,
  checkUseCaseFilter,
  loadScope,
  NOT_A_MEMBER_MESSAGE,
  pickUseCase,
  type CallerScope,
} from "./scope.js";

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
 * thrown error into a plain tool error so Claude can tell the person.
 */
async function withCaller(
  ctx: TokenCtx,
  body: (me: CubeIdentity, scope: CallerScope) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  let me: CubeIdentity;
  try {
    me = await identityForUser(ctx.auth.user.id);
  } catch (err) {
    return fail((err as Error).message);
  }
  await ensurePerson(me);
  try {
    const scope = await loadScope(me.email);
    return await body(me, scope);
  } catch (err) {
    if (err instanceof PlainError) return fail(err.message);
    console.error("[cube-connector] tool failed:", err);
    return fail(`The Cube couldn't complete this: ${(err as Error).message}`);
  }
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
        "List the signed-in person's use cases, and the journeys in each (a journey is one team's lived experience of the use case, e.g. \"Bihar DC, 2026\"). " +
        "Every journey in the use case is listed: the person can write about any of them, or a general note, and can filter searches by any of them. " +
        "Each use case also lists its playbooks; a playbook's curators are its contributors, so is_curator on a playbook says whether the person curates it, and is_curator on the use case is true if they curate any of its playbooks. " +
        "Call this once per conversation before saving a note or filtering by journey.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (_input, ctx) =>
      withCaller(ctx, async (_me, scope) => {
        const result: Record<string, unknown> = { use_cases: scope.useCases };
        if (scope.useCases.length === 0) result.message = NOT_A_MEMBER_MESSAGE;
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
        "Pass use_case_id when leaving journey_ids out and the person belongs to more than one use case. " +
        "Returns the saved note with its id and title. If structuring_pending is true, the note is saved and will be tidied up later.",
      inputSchema: z.object({
        raw_text: z.string().trim().min(1).max(8000).describe("The note in the person's own words, self-contained."),
        journey_ids: z
          .array(uuid("A journey id from cube_my_journeys."))
          .max(20)
          .optional()
          .describe("Journeys this note is about, all in the same use case. Leave out if it isn't clear: the Cube infers one or keeps the note general."),
        use_case_id: uuid("The use case, from cube_my_journeys. Needed without journey_ids when the person belongs to more than one use case.").optional(),
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
      withCaller(ctx, async (me, scope) => {
        if (scope.useCases.length === 0) throw new PlainError(NOT_A_MEMBER_MESSAGE);
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
          if (input.use_case_id && input.use_case_id !== useCaseId) {
            throw new PlainError("use_case_id doesn't match the journeys given. Leave use_case_id out: it comes from the journeys.");
          }
        } else {
          // No journey named: the use case's only journey, or one inferred
          // from the text (below), or a general note.
          const useCase = plain(() => pickUseCase(scope, input.use_case_id));
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
      title: "Search the Cube's notes",
      description:
        "Find notes in the person's use cases, across every journey, that match a question or topic. Matches notes that share any meaningful word with the query, best matches first. " +
        "It matches words, not meaning, so search more than once: with the question's own key words, then with synonyms or related terms (vendor/supplier, field test/pilot, sign-off/approval). " +
        "Optional filters: use_case_id, journey_id (ids from cube_my_journeys), note_type, outcome (e.g. 'did_not_work' for what went wrong), status, since, until, author_email. " +
        "Each note lists the journeys it came from. Check status: 'superseded' means a later note replaced it, 'disputed' means the curator hasn't settled it, 'unstructured' means it hasn't been tidied yet, so read raw_text.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500).describe("Key words to look for."),
        use_case_id: uuid("Only notes in this use case.").optional(),
        journey_id: uuid("Only notes linked to this journey.").optional(),
        note_type: noteType.optional().describe("Only 'learned', 'did' or 'stuck' notes."),
        outcome: outcome.optional().describe("Only notes with this outcome."),
        status: status.optional().describe("Only notes with this status, e.g. 'approved'."),
        since: dateInput("Only notes created on or after this.").optional(),
        until: dateInput("Only notes created before this.").optional(),
        author_email: z.string().trim().email().optional().describe("Only notes by this person."),
        limit: z.number().int().min(1).max(30).optional().describe("How many notes to return. Default 10, at most 30."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, ctx) =>
      withCaller(ctx, async (me, scope) => {
        if (scope.useCases.length === 0) return ok({ count: 0, notes: [], message: NOT_A_MEMBER_MESSAGE });
        plain(() => checkUseCaseFilter(scope, input.use_case_id));
        plain(() => checkJourneyFilter(scope, input.journey_id));
        const { data, error } = await db().rpc("cube_search_notes", {
          p_caller_email: me.email,
          p_query: input.query,
          p_use_case_id: input.use_case_id ?? null,
          p_journey_id: input.journey_id ?? null,
          p_note_type: input.note_type ?? null,
          p_outcome: input.outcome ?? null,
          p_status: input.status ?? null,
          p_since: input.since ? date(input.since, "since").toISOString() : null,
          p_until: input.until ? date(input.until, "until").toISOString() : null,
          p_author_email: input.author_email?.toLowerCase() ?? null,
          p_limit: input.limit ?? 10,
        });
        if (error) throw new Error(error.message);
        const notes = await shapeNotes((data ?? []) as NoteRow[]);
        return ok({ count: notes.length, notes });
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
      withCaller(ctx, async (me, scope) => {
        if (scope.useCases.length === 0) return ok({ count: 0, notes: [], message: NOT_A_MEMBER_MESSAGE });
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
      withCaller(ctx, async (me, scope) => {
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
      withCaller(ctx, async (_me, scope) => {
        if (scope.useCases.length === 0) return ok({ count: 0, questions: [], message: NOT_A_MEMBER_MESSAGE });
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
      withCaller(ctx, async (_me, scope) => {
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
}
