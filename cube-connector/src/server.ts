/**
 * Cube connector: a remote MCP server that lets Claude save and search the
 * team's know-how in the Cube's Supabase database.
 *
 * Built from mcp-use/mcp-oauth-supabase-template (MIT), ported to mcp-use v2.
 * Contract: cube-claude-kit/connector-contract.md.
 *
 * Supabase Auth is the OAuth 2.1 server (it hosts /authorize, /token,
 * /register and discovery). People sign in and approve on the Cube app's
 * /oauth/consent page with their Cube account. This server hosts only the
 * MCP endpoint (/mcp) and the protected-resource metadata.
 * Access tokens are verified against the project's JWKS by the mcp-use
 * Supabase provider. See README.md for setup.
 */

import { isBuilding, MCPServer } from "mcp-use";
import { oauthSupabaseProvider } from "mcp-use/oauth/supabase";

import { SUPABASE_URL } from "./config.js";
import { registerCubeTools } from "./tools.js";

const server = new MCPServer({
  name: "cube",
  title: "Cube",
  version: "0.2.0",
  description: "Save and search the team's shared know-how in the Cube.",
  instructions:
    "The Cube holds notes people wrote about their own work adopting AI: decisions and why, what worked or didn't, workarounds, setbacks and open problems. " +
    "Each note belongs to a use case and links to one or more journeys (one team's lived experience, e.g. \"Bihar DC, 2026\"); cube_my_journeys lists the person's. " +
    "Save a note only after the person agrees, as raw text in their own words: the Cube structures it. Answer only from what the notes say, name who wrote them, when and which journey, and log questions the notes can't answer with cube_log_question. " +
    "Nothing here edits or deletes notes, and nothing here changes the playbook.",
  oauth: oauthSupabaseProvider({
    // `mcp-use build` loads this module without secrets; a placeholder lets
    // it build. At run time a missing URL fails loudly, as it should.
    supabaseUrl: SUPABASE_URL || (isBuilding() ? "https://build.invalid" : undefined),
    resourceName: "Cube",
  }),
});

registerCubeTools(server);

// `mcp-use dev` / `mcp-use start` import this default export and serve it
// (port from PORT, default 3000; host from HOST).
export default server;
