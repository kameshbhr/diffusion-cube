import type { SupabaseClient } from '@supabase/supabase-js';

// SERVER-ONLY. Who can do what on a use case (docs/design/cube-usecase-plan.md,
// migrations 0039 and 0041). Every Cube 2.0 server route checks access here,
// with the service-role client; the connector applies the same rules
// (cube-connector/src/scope.ts).
//
//   read    on the use case's allowlist (use_case_members, any access), or
//           the use case is open_to_all
//   write   on the allowlist with write or curate: + save notes, add documents
//   curate  on the allowlist with curate: + edit the playbook and assets,
//           see the Digest

export type UseCaseAccess = 'read' | 'write' | 'curate';

const RANK: Record<UseCaseAccess, number> = { read: 0, write: 1, curate: 2 };

/** True when `access` is at least `needed`. */
export function hasAccess(access: UseCaseAccess | null, needed: UseCaseAccess): boolean {
  return access !== null && RANK[access] >= RANK[needed];
}

function level(value: unknown): UseCaseAccess {
  return value === 'write' || value === 'curate' ? value : 'read';
}

/** The person's access to one use case, or null for none. */
export async function useCaseAccess(
  admin: SupabaseClient,
  email: string | null | undefined,
  useCaseId: string
): Promise<UseCaseAccess | null> {
  const address = (email ?? '').trim().toLowerCase();
  const [member, useCase] = await Promise.all([
    address
      ? admin.from('use_case_members').select('access').eq('use_case_id', useCaseId).eq('email', address).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('use_cases').select('open_to_all').eq('id', useCaseId).maybeSingle(),
  ]);
  if (member.error) throw new Error(member.error.message);
  if (useCase.error) throw new Error(useCase.error.message);
  if (!useCase.data) return null;
  if (member.data) return level(member.data.access);
  return useCase.data.open_to_all ? 'read' : null;
}

/** Every use case the person can read, with their access to each. */
export async function readableUseCases(
  admin: SupabaseClient,
  email: string | null | undefined
): Promise<Map<string, UseCaseAccess>> {
  const address = (email ?? '').trim().toLowerCase();
  const [members, open] = await Promise.all([
    address
      ? admin.from('use_case_members').select('use_case_id, access').eq('email', address)
      : Promise.resolve({ data: [], error: null }),
    admin.from('use_cases').select('id').eq('open_to_all', true),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (open.error) throw new Error(open.error.message);
  const result = new Map<string, UseCaseAccess>();
  for (const row of (open.data ?? []) as { id: string }[]) result.set(row.id, 'read');
  for (const row of (members.data ?? []) as { use_case_id: string; access: string }[]) {
    result.set(row.use_case_id, level(row.access));
  }
  return result;
}
