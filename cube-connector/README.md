# Cube connector

A small remote MCP server that lets Claude save and search know-how in the Cube's Supabase database. It implements `cube-claude-kit/connector-contract.md` (version 2). The `cube-capture`, `cube-ask` and `cube-curator` skills call its tools by these exact names.

It started from [`mcp-use/mcp-oauth-supabase-template`](https://github.com/mcp-use/mcp-oauth-supabase-template) (MIT, see `LICENSE`), ported from mcp-use v1 to v2. The template's Google sign-in pages were later replaced by the Cube app's own login.

## How it works

| Piece | Where |
|---|---|
| OAuth 2.1 server (`/authorize`, `/token`, `/register`, discovery) | Supabase Auth on the Cube's project (Authentication → OAuth Server) |
| Sign-in and approval | The Cube app: its usual `/login`, then `app/oauth/consent/page.tsx` |
| MCP endpoint `/mcp`, protected-resource metadata, token check | this server (`src/server.ts`; mcp-use's Supabase provider verifies tokens against the project JWKS) |
| Tables (`use_cases`, `journeys`, `use_case_members`, `cube_people`, `cube_notes`, `cube_note_journeys`, `cube_questions`) and SQL functions | `supabase/migrations/0038_cube_connector.sql` |
| Note structuring (Claude API) | `src/structure.ts`, `src/save-note.ts` |

The flow: Claude starts sign-in → Supabase sends the browser to the Cube app's `/oauth/consent?authorization_id=…` → `proxy.ts` sends a signed-out visitor to `/login` and back (query kept) → the person approves → Supabase returns them to Claude with a token for `/mcp`.

- **Who can sign in:** a Cube account with a **verified** email in an allowed domain (`CUBE_ALLOWED_DOMAINS`, default `ekstep.org`). Cube signup verifies the email with a 6-digit code. The approval page shows this rule. Every tool call enforces it, looking the user up with the service role (cached 5 minutes), because a valid token alone isn't enough: any Cube session verifies.
- **Identity:** the author is the account's email; the name is the account's own name (`user_metadata.name` from signup), for display only. No tool accepts an author.
- **Use cases and journeys:** every note belongs to one use case and links to any number of that use case's journeys (one team's lived experience each, e.g. "Bihar DC, 2026"). A person's use cases are those they're a member of (`use_case_members`) plus those of playbooks they curate. Membership isn't tied to a journey: a member can write about any journey in the use case, or a general note. Use cases, journeys and members are set with SQL for the pilot (`seed-example.sql`).
- **Curators:** curation is per playbook. A playbook's curators are its contributors (`playbook_members.member_role = 'contributor'`, assigned in the Cube admin panel's "Playbook contributors"), and `playbooks.use_case_id` makes them curators of that use case. A use case may have several playbooks (e.g. for different contexts), each with its own curators, and a playbook may have more than one. Playbook adopters are not use-case members through the playbook. The lookups go through `auth.users` in two security-definer functions (`cube_curated_playbooks`, `cube_use_case_curators`) that only the service role can run.
- **Permissions:** a person reads all notes and questions in their use cases, across every journey, and adds notes only as themselves in those use cases, linked to any journeys within them. Someone in no use case sees nothing and can't add notes. No tool edits or deletes, and nothing touches the playbook. The database enforces the rest: a note's origin fields can't change, and a journey link must be in the note's use case.
- **Approval page:** shows who is signed in and where approval sends them. If that isn't `claude.ai`/`claude.com` (or localhost for testing), it warns, since dynamic registration lets anyone register an app named "Claude".
- **Database:** the server uses the service-role key, which stays on the server. The tables have RLS on with no policies, and `anon`/`authenticated` have no grants (tables or functions), so Cube app users can't reach them with the anon key.
- **People:** a `cube_people` row is added on a person's first tool call after connecting. (Sign-in happens in the Cube app, which can't write these tables.) Team activity lists a use case's members and curators whether or not they've connected.

## Saving a note (`save_note`)

`saveNote` in `src/save-note.ts` is the one shared save function. `cube_add_note` calls it with channel `claude`; a future channel (WhatsApp, email, web form, meeting import) calls it with its own channel and `external_id`.

1. `cube_save_note_raw` (SQL, one transaction) checks the author belongs to the use case and every journey is in it, then inserts the raw note as `unstructured` with the journey links Claude passed. Saving the same `(channel, external_id)` again returns the existing note.
2. The server asks Claude to structure it, with the prompt from the contract's appendix (`src/structure.ts`), a 20-second timeout and no retries. The reply is read leniently (first `{...}` block). If no journey was named and the use case has several, the same call is given the journey names and asked which one the note clearly says it's about, or none; only an exact match to a listed name is linked, otherwise the note stays general.
3. On success the fields are written and the note becomes `new`. On any failure (no key, error, timeout, refusal, unreadable reply) it stays `unstructured`, and the tool says structuring is pending. Nothing is lost.
4. `npm run restructure` re-runs structuring for every `unstructured` note. `npm run restructure -- --ids a,b` or `-- --all` re-runs chosen notes, e.g. after the prompt changes. Re-structuring a note the curator already reviewed keeps its status, and a note that still has no journey gets another try at inferring one.

## Tools

| Tool | Inputs | Notes |
|---|---|---|
| `cube_my_journeys` | none | The caller's use cases, each with `is_curator` (true if they curate any of its playbooks), its `playbooks` (id, title, `is_curator`) and all its journeys (id, name, organisation, period, status), since a member can write about any of them. |
| `cube_add_note` | `raw_text` (required); `journey_ids`, `use_case_id`, `source` (`conversation` default, `nudge`, `document`), `source_ref`, `occurred_at` | With `journey_ids`: linked as given (all in one use case). Without: the use case is `use_case_id` or the caller's only one; if it has one journey the note goes to it, if several the server infers one from the text or keeps the note general. Returns the note and `structuring_pending`. |
| `cube_search_notes` | `query` (required); `use_case_id`, `journey_id`, `note_type`, `outcome`, `status`, `since`, `until`, `author_email`, `limit` (10, max 30) | Version 1: Postgres full-text over title, topics, raw text and the structured fields; words OR-ed (`-word` exclusions dropped), ranked by `ts_rank_cd` then recency. |
| `cube_recent_notes` | `since` (required); `until`, `use_case_id`, `journey_id`, `author` (`me` or email), `limit` (50, max 200) | Newest first. |
| `cube_log_question` | `question`; `use_case_id` (optional if the caller has one use case) | Asker and time come from the server. |
| `cube_open_questions` | `use_case_id`, `since` | Unresolved only, newest first; all the caller's use cases by default. |
| `cube_team_activity` | `since`; `use_case_id` (optional if one) | One row per member or curator of one of its playbooks: name, email, the journeys they've written about, notes in the period, last note date. Includes people with zero notes. |

Dates accept `2026-11-13` (start of that day in `CUBE_TIME_ZONE`, default Asia/Kolkata), an ISO date-time with a zone, `today`, `yesterday` or `7 days ago`. `until` is exclusive.

Every note returned has `id, title, raw_text`, the structured fields that are set, `note_type, outcome, topics, status, channel, source, source_ref, author_name, author_email, created_at, occurred_at, use_case_id, use_case_name` and `journeys` (id and name). `title` is null while a note is `unstructured`.

Phase 2 tools (`cube_search_playbook`, `cube_open_conflicts`) are not built.

## Set up a development project

Use a **development** Supabase project, never production.

1. **Apply the migration** `supabase/migrations/0038_cube_connector.sql`. It drops and recreates version 1's tables (no notes were saved with them) and adds a nullable `use_case_id` to `playbooks`. Then seed a use case, its journeys and members, and a playbook with its curator: edit and run `seed-example.sql`. Curators are a playbook's contributors (also editable in the Cube admin panel).
2. **OAuth server:** Authentication → OAuth Server → enable it, turn on **Allow dynamic OAuth apps** (Claude registers itself), and set the authorization path to **`/oauth/consent`**. Supabase sends people to Site URL + that path, which is the Cube app's approval page.
3. **Cube app env:** optionally `NEXT_PUBLIC_CUBE_ALLOWED_DOMAINS` (default `ekstep.org`; same value as the connector's `CUBE_ALLOWED_DOMAINS`). It's read at build time.
4. **Connector env:** `cp .env.example .env` and fill in the project ref, the service-role key and `ANTHROPIC_API_KEY`. `CUBE_STRUCTURING_MODEL` defaults to `claude-opus-5-5`.

No Google provider or Google Cloud app is needed.

## Run locally

```bash
npm install
npm run dev
```

Run the Cube app (`npm run dev` at the repo root, port 3000) alongside it. The connector listens on `http://localhost:3100`, MCP endpoint `http://localhost:3100/mcp`. Test each tool with the MCP Inspector (`npx @modelcontextprotocol/inspector`, or mcp-use's built-in one at `http://localhost:3100/mcp/inspector`): connect, sign in with a Cube account, approve, then call each tool.

Checks before rollout (from the contract):
- Without `journey_ids`: a note that names a journey ("In Team A we…") is linked to it; one that doesn't stays general. In a use case with one journey, notes go to it.
- With `journey_ids`: several journeys of one use case (allowed) and a journey in another use case (refused).
- A member, a curator (contributor on the use case's playbook) and someone in no use case (sees nothing, can't add notes).
- A structuring failure: set `ANTHROPIC_API_KEY` to a bad value; the note saves as `unstructured`. Then `npm run restructure` with the right key structures it.
- A Cube account outside the allowed domain is refused (approval page and tool calls).
- The author is the signed-in person, notes come back structured, search finds notes written in different words from the question, and results show their journeys.

## Deploy

The connector deploys separately from the Cube app. The Next.js build and lint ignore this folder, and the approval page ships with the Cube app as usual.

`MCP_URL` is the connector's public **origin only**, with no `/mcp` on the end (e.g. `https://cube-connector.vercel.app`); mcp-use refuses to start otherwise. The MCP endpoint is that address + `/mcp`.

### On Vercel (its own project)

Vercel runs request functions, not a long-running server, so `api/index.ts` hands every request to the connector's Web handler (`server.fetch`), and `vercel.json` sends every path to it with a 60-second limit (structuring takes up to 20). Local `npm run dev` ignores both.

1. New Vercel project from this repo, **Root Directory** `cube-connector`, on the branch you're testing.
2. Environment variables: `MCP_USE_OAUTH_SUPABASE_PROJECT_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CUBE_ALLOWED_DOMAINS`, and `MCP_URL` set to the project's address (origin only).
3. Turn **Deployment Protection** off for this project, or use its production address: Claude can't get past Vercel's login on protected preview addresses.
4. Check `https://<address>/.well-known/oauth-protected-resource/mcp` returns JSON naming `<address>/mcp` and the Supabase auth server, and `https://<address>/mcp` returns 401. Then add `<address>/mcp` as a custom connector in Claude.

The MCP Inspector isn't served on Vercel; test with it locally.

### On a Node host

`npm run build` then `npm start`, with `HOST=0.0.0.0`, `PORT` and `MCP_URL` (origin only). Any Node host with HTTPS works (Fly, Render, Railway, an AWS container).

Then a Claude owner adds `<public URL>/mcp` as a custom connector (see the kit README).

## Known gaps

- The kit's contract and skills still describe Google sign-in, `journey_members`, "one curator per use case, recorded in `use_case_members`" and "on exactly one journey, the connector assigns it". This connector uses the Cube app's own login, use-case membership only, playbook contributors as curators (per playbook), and journey inference, as decided. The contract, `cube-capture` ("Which journey") and `cube-curator` text should be updated to match.
- People who leave keep access until their Cube account is deleted (accepted for now). Removing them from `use_case_members` (and as playbook contributors) stops them seeing notes at once.
- A brand-new signup during the connect flow lands on `/explore`, not back on the approval page (the Cube app's signup always does). They start the connection again from Claude, and the second time they're already signed in.
- Not yet confirmed against a real project: that OAuth-issued tokens carry `sub` as expected, and that the project signs with ES256 (otherwise set `MCP_USE_OAUTH_SUPABASE_JWT_SECRET`).
- Search is word-based (version 1). If the pilot shows misses, add pgvector meaning-based search (version 2 in the contract).
