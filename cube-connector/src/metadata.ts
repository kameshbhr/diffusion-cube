/**
 * Use case and journey metadata (migration 0039): what the use case is for,
 * and what each journey achieved. Every new note is checked against it in the
 * same Claude call that structures the note (structure.ts): a note that adds
 * to a field extends it, and a note that conflicts with it replaces it (the
 * latest source wins). Only new notes do this; re-running structuring on old
 * notes (restructure.ts) never touches metadata.
 *
 * The Cube app does the same for uploaded documents (lib/cube-metadata.ts);
 * keep the two field lists and rules in step.
 */

import { db } from "./db.js";

export const USE_CASE_FIELDS = ["objective", "problem", "users", "sector"] as const;
export const JOURNEY_FIELDS = ["organisation", "geography", "scale_achieved", "impact_achieved"] as const;

type UseCaseField = (typeof USE_CASE_FIELDS)[number];
type JourneyField = (typeof JOURNEY_FIELDS)[number];

export type UseCaseMeta = { name: string } & Record<UseCaseField, string | null>;
export type JourneyMeta = { id: string; name: string } & Record<JourneyField, string | null>;

export interface MetadataContext {
  useCaseId: string;
  useCase: UseCaseMeta;
  /** The journeys whose fields this note may update. */
  journeys: JourneyMeta[];
}

export interface MetadataUpdates {
  useCase: Partial<Record<UseCaseField, string>>;
  /** Keyed by journey name, exactly as offered. */
  journeys: Map<string, Partial<Record<JourneyField, string>>>;
}

const MAX_FIELD = 2000;

const FIELD_HELP = `Use case fields: objective (what the use case is for), problem (the problem it solves), users (who uses it), sector.
Journey fields: organisation (the adopter's name), geography (where), scale_achieved (how far it has reached, e.g. districts, users, calls), impact_achieved (results so far).`;

function show(value: string | null): string {
  return value && value.trim() ? JSON.stringify(value) : "(empty)";
}

/** Extra instructions for the structuring prompt. */
export function metadataInstructions(ctx: MetadataContext): string {
  const useCase = USE_CASE_FIELDS.map((f) => `  ${f}: ${show(ctx.useCase[f])}`).join("\n");
  const journeys = ctx.journeys
    .map((j) => `- ${JSON.stringify(j.name)}\n${JOURNEY_FIELDS.map((f) => `  ${f}: ${show(j[f])}`).join("\n")}`)
    .join("\n");
  return `

Also check whether the note gives facts for the descriptive fields below, and return them under the key "metadata":
  {"use_case": {field: new value, ...}, "journeys": {"<journey name as listed>": {field: new value, ...}}}
${FIELD_HELP}
Use case ${JSON.stringify(ctx.useCase.name)} now has:
${useCase}
${journeys ? `Journeys:\n${journeys}` : "No journey can be updated from this note: leave \"journeys\" empty."}
Rules: include a field only when the note states something for it. If the note adds to what is there, return the current value with the addition merged in. If the note contradicts it, return the note's version. Leave out everything else, and use {} when nothing changes. Never infer or add details the note doesn't state. Keep each value under 60 words.`;
}

function cleanValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, MAX_FIELD) : null;
}

/** Reads the reply's "metadata" key. Unknown fields and journeys are dropped. */
export function parseMetadataUpdates(raw: unknown, journeyNames: string[]): MetadataUpdates {
  const updates: MetadataUpdates = { useCase: {}, journeys: new Map() };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return updates;
  const data = raw as Record<string, unknown>;

  const useCase = data.use_case;
  if (useCase && typeof useCase === "object" && !Array.isArray(useCase)) {
    for (const field of USE_CASE_FIELDS) {
      const value = cleanValue((useCase as Record<string, unknown>)[field]);
      if (value) updates.useCase[field] = value;
    }
  }

  const journeys = data.journeys;
  if (journeys && typeof journeys === "object" && !Array.isArray(journeys)) {
    for (const [name, fields] of Object.entries(journeys as Record<string, unknown>)) {
      const match = journeyNames.find((n) => n.trim().toLowerCase() === name.trim().toLowerCase());
      if (!match || !fields || typeof fields !== "object" || Array.isArray(fields)) continue;
      const changed: Partial<Record<JourneyField, string>> = {};
      for (const field of JOURNEY_FIELDS) {
        const value = cleanValue((fields as Record<string, unknown>)[field]);
        if (value) changed[field] = value;
      }
      if (Object.keys(changed).length > 0) updates.journeys.set(match, changed);
    }
  }
  return updates;
}

const USE_CASE_COLUMNS = `name, ${USE_CASE_FIELDS.join(", ")}`;
const JOURNEY_COLUMNS = `id, name, ${JOURNEY_FIELDS.join(", ")}`;

/** Current metadata for a use case and the given journeys. Null if it can't be read. */
export async function loadMetadataContext(useCaseId: string, journeyIds: string[]): Promise<MetadataContext | null> {
  const [useCase, journeys] = await Promise.all([
    db().from("use_cases").select(USE_CASE_COLUMNS).eq("id", useCaseId).maybeSingle(),
    journeyIds.length > 0
      ? db().from("journeys").select(JOURNEY_COLUMNS).in("id", journeyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (useCase.error || !useCase.data || journeys.error) {
    console.error("[cube-connector] couldn't read metadata:", useCase.error?.message ?? journeys.error?.message);
    return null;
  }
  return {
    useCaseId,
    useCase: useCase.data as unknown as UseCaseMeta,
    journeys: (journeys.data ?? []) as unknown as JourneyMeta[],
  };
}

/**
 * Writes the updates. `linkedJourneyIds`: only these journeys are changed (the
 * ones the note ended up linked to). Failures are logged, never thrown.
 */
export async function applyMetadataUpdates(
  ctx: MetadataContext,
  updates: MetadataUpdates,
  linkedJourneyIds: string[],
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const useCaseChanges = Object.fromEntries(
      Object.entries(updates.useCase).filter(([field, value]) => value !== ctx.useCase[field as UseCaseField]),
    );
    if (Object.keys(useCaseChanges).length > 0) {
      const { error } = await db()
        .from("use_cases")
        .update({ ...useCaseChanges, metadata_updated_at: now })
        .eq("id", ctx.useCaseId);
      if (error) throw new Error(error.message);
    }
    for (const journey of ctx.journeys) {
      const changed = Object.fromEntries(
        Object.entries(updates.journeys.get(journey.name) ?? {}).filter(
          ([field, value]) => value !== journey[field as JourneyField],
        ),
      );
      if (Object.keys(changed).length === 0 || !linkedJourneyIds.includes(journey.id)) continue;
      const { error } = await db()
        .from("journeys")
        .update({ ...changed, metadata_updated_at: now })
        .eq("id", journey.id);
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    console.error("[cube-connector] couldn't update metadata:", (err as Error).message);
  }
}
