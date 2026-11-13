/**
 * A caller's use cases and journeys: the use cases they're a member of
 * (use_case_members), and the use cases of playbooks they curate. A
 * playbook's curators are its contributors (playbook_members), as assigned in
 * the Cube admin panel.
 *
 * Membership isn't tied to a journey: a member can write about any journey in
 * the use case, or a general note. So every journey of each use case is
 * listed.
 */

import { db } from "./db.js";

export interface ScopeJourney {
  id: string;
  name: string;
  organisation: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
}

export interface ScopePlaybook {
  id: string;
  title: string;
  /** True when the caller is one of this playbook's contributors (its curators). */
  is_curator: boolean;
}

export interface ScopeUseCase {
  id: string;
  name: string;
  description: string | null;
  /** True when the caller curates at least one of this use case's playbooks. */
  is_curator: boolean;
  playbooks: ScopePlaybook[];
  journeys: ScopeJourney[];
}

export interface CallerScope {
  useCases: ScopeUseCase[];
}

export async function loadScope(email: string): Promise<CallerScope> {
  const [direct, curated] = await Promise.all([
    db().from("use_case_members").select("use_case_id").eq("email", email),
    // Curators are a playbook's contributors (Cube admin panel).
    db().rpc("cube_curated_playbooks", { p_email: email }),
  ]);
  if (direct.error) throw new Error(direct.error.message);
  if (curated.error) throw new Error(curated.error.message);

  const useCaseIds = new Set<string>();
  for (const row of (direct.data ?? []) as { use_case_id: string }[]) useCaseIds.add(row.use_case_id);
  const curatedPlaybookIds = new Set<string>();
  for (const row of (curated.data ?? []) as { playbook_id: string; use_case_id: string }[]) {
    useCaseIds.add(row.use_case_id);
    curatedPlaybookIds.add(row.playbook_id);
  }
  if (useCaseIds.size === 0) return { useCases: [] };

  const ids = [...useCaseIds];
  const [useCases, journeys, playbooks] = await Promise.all([
    db().from("use_cases").select("id, name, description").in("id", ids),
    db()
      .from("journeys")
      .select("id, use_case_id, name, organisation, period_start, period_end, status")
      .in("use_case_id", ids),
    db().from("playbooks").select("id, use_case_id, title").in("use_case_id", ids),
  ]);
  if (useCases.error) throw new Error(useCases.error.message);
  if (journeys.error) throw new Error(journeys.error.message);
  if (playbooks.error) throw new Error(playbooks.error.message);

  const playbookRows = (playbooks.data ?? []) as { id: string; use_case_id: string; title: string }[];

  const result: ScopeUseCase[] = ((useCases.data ?? []) as { id: string; name: string; description: string | null }[])
    .map((u) => {
      const ucPlaybooks = playbookRows
        .filter((p) => p.use_case_id === u.id)
        .map((p) => ({ id: p.id, title: p.title, is_curator: curatedPlaybookIds.has(p.id) }))
        .sort((a, b) => a.title.localeCompare(b.title));
      return {
      id: u.id,
      name: u.name,
      description: u.description ?? null,
      is_curator: ucPlaybooks.some((p) => p.is_curator),
      playbooks: ucPlaybooks,
      journeys: ((journeys.data ?? []) as (ScopeJourney & { use_case_id: string })[])
        .filter((j) => j.use_case_id === u.id)
        .map((j) => ({
          id: j.id,
          name: j.name,
          organisation: j.organisation ?? null,
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

/**
 * The one use case a tool should act on: the given id (which must be one of
 * the caller's), or the caller's only use case. Throws a plain message
 * otherwise, naming the choices.
 */
export function pickUseCase(scope: CallerScope, useCaseId: string | undefined): ScopeUseCase {
  if (scope.useCases.length === 0) throw new Error(NOT_A_MEMBER_MESSAGE);
  if (useCaseId) {
    const found = scope.useCases.find((u) => u.id === useCaseId);
    if (!found) throw new Error(`You don't belong to use case ${useCaseId}. ${choices(scope)}`);
    return found;
  }
  if (scope.useCases.length === 1) return scope.useCases[0];
  throw new Error(`You belong to more than one use case, so say which one with use_case_id. ${choices(scope)}`);
}

/** Checks an optional use case filter against the caller's scope. */
export function checkUseCaseFilter(scope: CallerScope, useCaseId: string | undefined): void {
  if (useCaseId && !scope.useCases.some((u) => u.id === useCaseId)) {
    throw new Error(`You don't belong to use case ${useCaseId}. ${choices(scope)}`);
  }
}

/** Checks an optional journey filter: it must be in one of the caller's use cases. */
export function checkJourneyFilter(scope: CallerScope, journeyId: string | undefined): void {
  if (journeyId && !scope.useCases.some((u) => u.journeys.some((j) => j.id === journeyId))) {
    throw new Error(`Journey ${journeyId} isn't in any of your use cases. Call cube_my_journeys to see the journeys you can use.`);
  }
}

export const NOT_A_MEMBER_MESSAGE =
  "You aren't a member of any use case in the Cube yet, so there's nothing to show and you can't add notes. Ask the use case's curator or an admin to add you.";

function choices(scope: CallerScope): string {
  return `Your use cases: ${scope.useCases.map((u) => `"${u.name}" (${u.id})`).join(", ")}.`;
}
