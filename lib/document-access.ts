import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/roles';
import { hasAccess, readableUseCases } from '@/lib/use-case-access';

// SERVER-ONLY. Who may add documents (app/api/documents/*): Cube admins, for
// every use case, and anyone with write or curate access, for those use
// cases (docs/design/cube-usecase-plan.md, stage 5). Access comes from the
// database's rule with the caller's own session (lib/use-case-access.ts).

export interface DocumentCaller {
  userId: string;
  admin: boolean;
  /** Use cases this person may add documents to; ignored for admins. */
  writable: Set<string>;
  /** Use cases this person curates: they see who added each document. */
  curated: Set<string>;
}

/** The signed-in person, or null when they can add documents nowhere. */
export async function documentCaller(): Promise<DocumentCaller | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !user.email_confirmed_at) return null;
  const admin = await isAdmin(supabase, user.email.toLowerCase());
  const access = await readableUseCases(supabase);
  const ids = (needed: 'write' | 'curate') =>
    new Set([...access].filter(([, level]) => hasAccess(level, needed)).map(([id]) => id));
  const writable = ids('write');
  if (!admin && !writable.size) return null;
  return { userId: user.id, admin, writable, curated: ids('curate') };
}

export function canAddDocuments(caller: DocumentCaller, useCaseId: string): boolean {
  return caller.admin || caller.writable.has(useCaseId);
}

/** Admins and the use case's curators see who added a document; others don't. */
export function canSeeAuthors(caller: DocumentCaller, useCaseId: string): boolean {
  return caller.admin || caller.curated.has(useCaseId);
}
