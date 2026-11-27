import type { SupabaseClient } from '@supabase/supabase-js';

// SERVER-ONLY. Who can do what on a use case (docs/design/cube-usecase-plan.md,
// migrations 0039, 0041 and 0042). The rule lives in the database
// (cube_use_case_access): these helpers ask it with the signed-in person's
// own session, so the app, the row rules and the SQL functions always agree
// (an approved account and a confirmed email are part of it). The connector
// applies the same allowlist (cube-connector/src/scope.ts).
//
//   read    on the use case's allowlist (use_case_members, any access), or
//           the use case is open_to_all
//   write   on the allowlist with write or curate: + save notes, add documents
//   curate  on the allowlist with curate: + edit the playbook and assets,
//           see the Digest, see who wrote notes and added documents

export type UseCaseAccess = 'read' | 'write' | 'curate';

const RANK: Record<UseCaseAccess, number> = { read: 0, write: 1, curate: 2 };

/** True when `access` is at least `needed`. */
export function hasAccess(access: UseCaseAccess | null, needed: UseCaseAccess): boolean {
  return access !== null && RANK[access] >= RANK[needed];
}

function level(value: unknown): UseCaseAccess | null {
  return value === 'read' || value === 'write' || value === 'curate' ? value : null;
}

/** The signed-in person's access to one use case, or null for none. `session` is their own client. */
export async function getUseCaseAccess(session: SupabaseClient, useCaseId: string): Promise<UseCaseAccess | null> {
  const { data, error } = await session.rpc('cube_use_case_access', { p_use_case_id: useCaseId });
  if (error) throw new Error(error.message);
  return level(data);
}

/** Every use case the signed-in person can read, with their access to each. */
export async function readableUseCases(session: SupabaseClient): Promise<Map<string, UseCaseAccess>> {
  const { data, error } = await session.rpc('cube_my_use_cases');
  if (error) throw new Error(error.message);
  const result = new Map<string, UseCaseAccess>();
  for (const row of (data ?? []) as { use_case_id: string; access: string }[]) {
    const access = level(row.access);
    if (access) result.set(row.use_case_id, access);
  }
  return result;
}
