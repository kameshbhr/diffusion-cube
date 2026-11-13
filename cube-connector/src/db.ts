import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./config.js";

let client: SupabaseClient | null = null;

/**
 * Service-role client for the cube_* tables. The tables have RLS on and no
 * policies, so only this server can read or write them. Author fields always
 * come from the verified sign-in token, never from tool input.
 */
export function db(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("The Cube connector is not configured (missing Supabase settings).");
    }
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
