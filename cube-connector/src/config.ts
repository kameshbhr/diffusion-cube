/**
 * Environment for the Cube connector. Every value is read once at start-up.
 * See .env.example for what each one is and where to find it.
 */

function trimmed(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const SUPABASE_PROJECT_ID = trimmed("MCP_USE_OAUTH_SUPABASE_PROJECT_ID");

/** Full project URL. Optional; derived from the project id when unset. */
export const SUPABASE_URL = (
  trimmed("MCP_USE_OAUTH_SUPABASE_URL") ||
  (SUPABASE_PROJECT_ID ? `https://${SUPABASE_PROJECT_ID}.supabase.co` : "")
).replace(/\/$/, "");

/**
 * Service-role (or sb_secret_) key: used only on this server for reading and
 * writing the cube_* tables. Never sent to Claude, never put in a skill.
 */
export const SUPABASE_SERVICE_ROLE_KEY = trimmed("SUPABASE_SERVICE_ROLE_KEY");

/**
 * Email domains allowed to use the connector, comma-separated. Keep in step
 * with NEXT_PUBLIC_CUBE_ALLOWED_DOMAINS in the Cube app.
 * Defaults to ekstep.org.
 */
export const ALLOWED_DOMAINS: string[] = (
  trimmed("CUBE_ALLOWED_DOMAINS") || "ekstep.org"
)
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

/**
 * Claude API key, used only by this server to structure raw notes (the
 * connector-contract's save_note, step 3). Without it, notes are still saved,
 * as 'unstructured'.
 */
export const ANTHROPIC_API_KEY = trimmed("ANTHROPIC_API_KEY");

/** Model used to structure notes. */
export const STRUCTURING_MODEL = trimmed("CUBE_STRUCTURING_MODEL") || "claude-opus-5-5";

/** How long to wait for structuring before saving the note as unstructured. */
export const STRUCTURING_TIMEOUT_MS = 20_000;

/**
 * Time zone used to read a plain date such as "2026-11-13" or "today" as the
 * start of that day. Defaults to India.
 */
export const TIME_ZONE = trimmed("CUBE_TIME_ZONE") || "Asia/Kolkata";

const missing = [
  ["MCP_USE_OAUTH_SUPABASE_PROJECT_ID or MCP_USE_OAUTH_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
  ["ANTHROPIC_API_KEY (notes will be saved unstructured)", ANTHROPIC_API_KEY],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.warn(`[cube-connector] Missing environment: ${missing.join(", ")}`);
}
if (ALLOWED_DOMAINS.length === 0) {
  throw new Error("CUBE_ALLOWED_DOMAINS must name at least one domain.");
}
