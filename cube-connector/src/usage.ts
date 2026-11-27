/**
 * Usage log (migration 0040): one cube_tool_calls row per tool call, for a
 * usage dashboard. Written by withCaller in tools.ts after every call,
 * including refused ones.
 *
 * The caller is stored by user id only (migration 0042), never by email.
 *
 * Search text is stored (cube_search_notes' query, cube_log_question's
 * question) and blanked after 90 days by the database. Note text is never
 * copied here; it's already in cube_notes.
 *
 * Logging never blocks or fails a tool call: errors are logged and dropped.
 */

import type { CallToolResult } from "mcp-use";

import { db } from "./db.js";

export interface ToolCallLog {
  /** The signed-in Supabase user. */
  userId: string;
  tool: string;
  input: Record<string, unknown>;
  /** Use cases the caller could read, when they were loaded. */
  readableUseCaseIds: string[] | null;
  result: CallToolResult;
  startedAt: number;
}

/** Inputs whose text is the search itself, by tool. */
const QUERY_FIELD: Record<string, string> = {
  cube_search_notes: "query",
  cube_log_question: "question",
};

/** Inputs never copied into params (note text is in cube_notes; queries have their own column). */
const NOT_IN_PARAMS = new Set(["raw_text", "query", "question"]);

const MAX_QUERY = 2000;
const MAX_PARAMS = 2000;
const MAX_ERROR = 500;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** How many items came back; null when it doesn't apply. */
function resultCount(data: Record<string, unknown> | null): number | null {
  if (!data) return null;
  if (typeof data.count === "number") return data.count;
  if (Array.isArray(data.passages)) return data.passages.length;
  if (Array.isArray(data.use_cases)) return data.use_cases.length;
  if (data.saved === true || data.logged === true) return 1;
  return null;
}

/** The use case(s) the call was about. */
function useCaseIds(log: ToolCallLog, data: Record<string, unknown> | null): string[] {
  const given = log.input.use_case_id;
  if (typeof given === "string") return [given];
  const fromResult =
    (typeof data?.use_case_id === "string" && data.use_case_id) ||
    record(data?.note)?.use_case_id ||
    record(data?.question)?.use_case_id;
  if (typeof fromResult === "string") return [fromResult];
  return log.readableUseCaseIds ?? [];
}

export async function logToolCall(log: ToolCallLog): Promise<void> {
  try {
    const data = record(log.result.structuredContent);
    const queryField = QUERY_FIELD[log.tool];
    const query = queryField && typeof log.input[queryField] === "string" ? (log.input[queryField] as string) : null;

    const paramsEntries = Object.entries(log.input).filter(([key, value]) => !NOT_IN_PARAMS.has(key) && value !== undefined);
    let params: Record<string, unknown> = Object.fromEntries(paramsEntries);
    if (JSON.stringify(params).length > MAX_PARAMS) params = { truncated: true };

    const errorText = log.result.isError
      ? log.result.content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join(" ")
          .slice(0, MAX_ERROR)
      : null;

    const { error } = await db()
      .from("cube_tool_calls")
      .insert({
        user_id: log.userId,
        tool: log.tool,
        use_case_ids: useCaseIds(log, data),
        query: query ? query.slice(0, MAX_QUERY) : null,
        params,
        result_count: log.result.isError ? null : resultCount(data),
        ok: !log.result.isError,
        error: errorText,
        duration_ms: Date.now() - log.startedAt,
      });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[cube-connector] couldn't log the tool call:", (err as Error).message);
  }
}
