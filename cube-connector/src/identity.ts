/**
 * Who is calling, and are they allowed in.
 *
 * People sign in with their Cube app account (email + password, email
 * verified with a 6-digit code at signup) on the Cube app's /oauth/consent
 * page. The access token only proves which Supabase user is calling, so each
 * tool call looks the user up server-side and requires a confirmed email in
 * an allowed domain (CUBE_ALLOWED_DOMAINS). The consent page shows the same
 * rule, but this is the check that counts.
 *
 * What people do is stored by their user id only (migration 0042). The email
 * is used to find their access on the allowlist, never stored.
 */

import type { User } from "@supabase/supabase-js";

import { ALLOWED_DOMAINS } from "./config.js";
import { db } from "./db.js";

export interface CubeIdentity {
  userId: string;
  email: string;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

export const ALLOWED_DOMAINS_TEXT = ALLOWED_DOMAINS.map((d) => `@${d}`).join(" or ");

const REFUSED_TOOL_MESSAGE = `Only Cube accounts with a verified ${ALLOWED_DOMAINS_TEXT} email can use the Cube connector. Reconnect it and sign in with your office account.`;

/** Allowed: a confirmed email in an allowed domain. */
export function checkUser(user: User): CubeIdentity | null {
  const email = (user.email ?? "").toLowerCase();
  const domain = domainOf(email);
  if (!user.email_confirmed_at || !domain || !ALLOWED_DOMAINS.includes(domain)) return null;
  return { userId: user.id, email };
}

const USER_CHECK_TTL_MS = 5 * 60 * 1000;
const userChecks = new Map<string, { identity: CubeIdentity | null; at: number }>();

/**
 * Identity for a tool call. The access token only proves which Supabase user
 * is calling; any session of the project's users would verify. So the user
 * is looked up server-side and must pass checkUser. Cached for 5 minutes.
 * Throws when the account isn't allowed.
 */
export async function identityForUser(userId: string): Promise<CubeIdentity> {
  const cached = userChecks.get(userId);
  if (cached && Date.now() - cached.at < USER_CHECK_TTL_MS) {
    if (!cached.identity) throw new Error(REFUSED_TOOL_MESSAGE);
    return cached.identity;
  }
  const { data, error } = await db().auth.admin.getUserById(userId);
  if (error || !data.user) {
    if (error && error.status !== 404) throw new Error("Couldn't check your sign-in. Please try again.");
    userChecks.set(userId, { identity: null, at: Date.now() });
    throw new Error(REFUSED_TOOL_MESSAGE);
  }
  const identity = checkUser(data.user);
  userChecks.set(userId, { identity, at: Date.now() });
  if (!identity) throw new Error(REFUSED_TOOL_MESSAGE);
  return identity;
}

/** Display names for user ids (the account's name, else its email). Only for curators. */
export async function personNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data, error } = await db().rpc("cube_person_names", { p_user_ids: ids });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { user_id: string; name: string | null }[]) {
    if (row.name) names.set(row.user_id, row.name);
  }
  return names;
}
