/**
 * A caller's use cases (per-use-case allowlist, migrations 0039 and 0041):
 *
 *   read    on the use case's allowlist (use_case_members, any access), or
 *           the use case is open_to_all
 *   write   on the allowlist with write or curate
 *   curate  on the allowlist with curate: write, plus editing the use case's
 *           playbook in the Cube app. is_curator says so.
 *
 * CUBE_ALLOWED_DOMAINS only decides who can use the connector at all
 * (identity.ts).
 *
 * Membership isn't tied to a journey: a person can write about any journey in
 * a use case they can write to, or a general note. So every journey of each
 * use case is listed.
 */

import { db } from "./db.js";

export type Access = "read" | "write" | "curate";

const RANK: Record<Access, number> = { read: 0, write: 1, curate: 2 };

/** True for write and curate. */
export function canWrite(useCase: { access: Access }): boolean {
  return useCase.access !== "read";
}

export interface ScopeJourney {
  id: string;
  name: string;
  /** The adopter's name. */
  organisation: string | null;
  geography: string | null;
  scale_achieved: string | null;
  impact_achieved: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
}

export interface ScopePlaybook {
  id: string;
  title: string;
  /** True when the caller has curate on the playbook's use case. */
  is_curator: boolean;
}

export interface ScopeUseCase {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  problem: string | null;
  users: string | null;
  sector: string | null;
  /** The caller's allowlist access; 'read' when the use case is only open to all. */
  access: Access;
  /** True when access is 'curate'. */
  is_curator: boolean;
  playbooks: ScopePlaybook[];
  journeys: ScopeJourney[];
}

export interface CallerScope {
  useCases: ScopeUseCase[];
}

export const NO_ACCESS_MESSAGE = "You don't have access to this use case. Please contact the admin.";

export async function loadScope(email: string): Promise<CallerScope> {
  const [members, open] = await Promise.all([
    db().from("use_case_members").select("use_case_id, access").eq("email", email),
    db().from("use_cases").select("id").eq("open_to_all", true),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (open.error) throw new Error(open.error.message);

  const access = new Map<string, Access>();
  for (const row of (open.data ?? []) as { id: string }[]) access.set(row.id, "read");
  for (const row of (members.data ?? []) as { use_case_id: string; access: string }[]) {
    const level: Access = row.access in RANK ? (row.access as Access) : "read";
    const current = access.get(row.use_case_id);
    if (!current || RANK[level] > RANK[current]) access.set(row.use_case_id, level);
  }
  if (access.size === 0) return { useCases: [] };

  const ids = [...access.keys()];
  const [useCases, journeys, playbooks] = await Promise.all([
    db().from("use_cases").select("id, name, description, objective, problem, users, sector").in("id", ids),
    db()
      .from("journeys")
      .select("id, use_case_id, name, organisation, geography, scale_achieved, impact_achieved, period_start, period_end, status")
      .in("use_case_id", ids),
    db().from("playbooks").select("id, use_case_id, title").in("use_case_id", ids),
  ]);
  if (useCases.error) throw new Error(useCases.error.message);
  if (journeys.error) throw new Error(journeys.error.message);
  if (playbooks.error) throw new Error(playbooks.error.message);

  const playbookRows = (playbooks.data ?? []) as { id: string; use_case_id: string; title: string }[];
  const journeyRows = (journeys.data ?? []) as (ScopeJourney & { use_case_id: string })[];

  type UseCaseRow = Omit<ScopeUseCase, "access" | "is_curator" | "playbooks" | "journeys">;
  const result: ScopeUseCase[] = ((useCases.data ?? []) as UseCaseRow[])
    .map((u) => {
      const ucPlaybooks = playbookRows
        .filter((p) => p.use_case_id === u.id)
        .map((p) => ({ id: p.id, title: p.title, is_curator: access.get(u.id) === "curate" }))
        .sort((a, b) => a.title.localeCompare(b.title));
      return {
        id: u.id,
        name: u.name,
        description: u.description ?? null,
        objective: u.objective ?? null,
        problem: u.problem ?? null,
        users: u.users ?? null,
        sector: u.sector ?? null,
        access: access.get(u.id) ?? "read",
        is_curator: access.get(u.id) === "curate",
        playbooks: ucPlaybooks,
        journeys: journeyRows
          .filter((j) => j.use_case_id === u.id)
          .map((j) => ({
            id: j.id,
            name: j.name,
            organisation: j.organisation ?? null,
            geography: j.geography ?? null,
            scale_achieved: j.scale_achieved ?? null,
            impact_achieved: j.impact_achieved ?? null,
            period_start: j.period_start ?? null,
            period_end: j.period_end ?? null,
            status: j.status,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { useCases: result };
}

function choices(useCases: ScopeUseCase[]): string {
  return useCases.map((u) => `"${u.name}" (${u.id})`).join(", ");
}

/**
 * The one use case a read tool should act on: the given id (which the caller
 * must be able to read), or the caller's only readable use case.
 */
export function pickUseCase(scope: CallerScope, useCaseId: string | undefined): ScopeUseCase {
  if (scope.useCases.length === 0) throw new Error(NO_ACCESS_MESSAGE);
  if (useCaseId) {
    const found = scope.useCases.find((u) => u.id === useCaseId);
    if (!found) throw new Error(NO_ACCESS_MESSAGE);
    return found;
  }
  if (scope.useCases.length === 1) return scope.useCases[0];
  throw new Error(
    `You can see more than one use case, so say which one with use_case_id. Your use cases: ${choices(scope.useCases)}.`,
  );
}

/**
 * The one use case a note is saved to: the given id (which the caller must be
 * able to write to), or the caller's only writable use case.
 */
export function pickWritableUseCase(scope: CallerScope, useCaseId: string | undefined): ScopeUseCase {
  const writable = scope.useCases.filter(canWrite);
  if (useCaseId) {
    const found = writable.find((u) => u.id === useCaseId);
    if (!found) throw new Error(NO_ACCESS_MESSAGE);
    return found;
  }
  if (writable.length === 0) throw new Error(NO_ACCESS_MESSAGE);
  if (writable.length === 1) return writable[0];
  throw new Error(
    `You can add notes to more than one use case, so ask the person which one and pass use_case_id. Use cases you can add notes to: ${choices(writable)}.`,
  );
}

/** Checks an optional use case filter: the caller must be able to read it. */
export function checkUseCaseFilter(scope: CallerScope, useCaseId: string | undefined): void {
  if (useCaseId && !scope.useCases.some((u) => u.id === useCaseId)) throw new Error(NO_ACCESS_MESSAGE);
}

/** Checks an optional journey filter: it must be in a use case the caller can read. */
export function checkJourneyFilter(scope: CallerScope, journeyId: string | undefined): void {
  if (journeyId && !scope.useCases.some((u) => u.journeys.some((j) => j.id === journeyId))) {
    throw new Error(`Journey ${journeyId} isn't in any of your use cases. Call cube_my_journeys to see the journeys you can use.`);
  }
}
