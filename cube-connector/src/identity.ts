/**
 * Who is calling, and are they allowed in.
 *
 * People sign in with their Cube app account (email + password, email
 * verified with a 6-digit code at signup) on the Cube app's /oauth/consent
 * page. The access token only proves which Supabase user is calling, so each
 * tool call looks the user up server-side and requires a confirmed email in
 * an allowed domain (CUBE_ALLOWED_DOMAINS). The consent page shows the same
 * rule, but this is the check that counts.
 */

import type { User } from "@supabase/supabase-js";

import { ALLOWED_DOMAINS } from "./config.js";
import { db } from "./db.js";

export interface CubeIdentity {
  email: string;
  name: string | null;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

function nameFromMetadata(metadata: unknown): string | null {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  // Cube signup stores the person's name as user_metadata.name.
  for (const key of ["name", "full_name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export const ALLOWED_DOMAINS_TEXT = ALLOWED_DOMAINS.map((d) => `@${d}`).join(" or ");

const REFUSED_TOOL_MESSAGE = `Only Cube accounts with a verified ${ALLOWED_DOMAINS_TEXT} email can use the Cube connector. Reconnect it and sign in with your office account.`;

/** Allowed: a confirmed email in an allowed domain. */
export function checkUser(user: User): CubeIdentity | null {
  const email = (user.email ?? "").toLowerCase();
  const domain = domainOf(email);
  if (!user.email_confirmed_at || !domain || !ALLOWED_DOMAINS.includes(domain)) return null;
  // The name is the person's own (editable) account name, used for display
  // only. The email, which can't be changed without re-verifying, is the
  // real author.
  return { email, name: nameFromMetadata(user.user_metadata) };
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

const knownPeople = new Set<string>();

/**
 * Adds a cube_people row on a person's first tool call after connecting
 * (sign-in itself happens in the Cube app, which can't write these tables).
 * Existing rows are left alone except to fill a missing name. Failures are
 * logged, not thrown: they must never block a note.
 */
export async function ensurePerson(identity: CubeIdentity): Promise<void> {
  if (knownPeople.has(identity.email)) return;
  try {
    const { error } = await db()
      .from("cube_people")
      .upsert({ email: identity.email, name: identity.name }, { onConflict: "email", ignoreDuplicates: true });
    if (error) throw error;
    if (identity.name) {
      await db().from("cube_people").update({ name: identity.name }).eq("email", identity.email).is("name", null);
    }
    knownPeople.add(identity.email);
  } catch (err) {
    console.error("[cube-connector] could not record person:", err);
  }
}
