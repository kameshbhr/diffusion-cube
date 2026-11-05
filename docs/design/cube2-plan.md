# Cube 2.0 (test version): build plan

Branch `cube-2`. Approved plan (2026-11-05), revised the same day after the new HTML and spec: atomic saves, safer patch ops, direct-to-Storage uploads, a function time limit, slices 4a–4d, a daily cap, and extra acceptance checks. No code is written until you say go on Slice 1.

Sources: `CLAUDE.md` (Cube 2.0 section), `docs/design/cube2-spec.md` (wins on conflicts), `docs/design/Cube 2.0.md` (the concept note, which has a different file name from the one you gave), and `docs/design/low-resource-language-ai-adoption-playbook.html`.

## Context

Cube 1.0 grounds answers in a corpus of pathways, places them on a 4×4 grid, and has three surfaces: Explore, Analyse and Contribute. Cube 2.0 is a test of a different idea: a calm companion built around **one playbook**. It helps a first-time PMU work out what to do next, who owns it, when, and how, and it lets a contributor keep that playbook current.

Cube 2.0 is built beside Cube 1.0 behind a flag:
- Nothing in Cube 1.0 is deleted or renamed. The `companion` mode is not touched.
- Everything new lives under `/companion`, `lib/companion-v2/`, `components/companion-v2/` and migrations `0034` onwards.

### What the repo looks like today (verified)
- **Chat route.** `app/api/chat/route.ts` (246 lines):
  - It checks `MODES`, then `hasAnyRole` for every mode except `library`.
  - There is **no shared streaming helper**. Each branch inlines `anthropic.messages.stream(...)` plus a `ReadableStream` that forwards text deltas.
  - **No prompt caching** is used anywhere.
  - The model is `claude-sonnet-4-6`.
  - `logConversation` (Google Sheets) fires for every non-library mode.
- **`<grid_update>` pattern.** `lib/grid-update.ts` holds `parseGridUpdate` and `stripGridUpdate`. It is kept free of React so the route can import it. The new `<ui_action>` and `<playbook_patch>` parsers copy this file's shape.
- **Client streaming.** `lib/adoption-conversation.ts` uses a `fetch('/api/chat')` → `getReader()` → `TextDecoder` loop.
- **Nav.** The nav is hard-coded in `components/Sidebar.tsx:111-116`: Explore, Analyse and Contribute, plus Admin when `isAdmin`. `components/AppShell.tsx` wraps it. There are no feature flags yet.
- **`proxy.ts`.** Its `PUBLIC_PATHS` include `/explore`, `/analyse`, `/contribute` and `/api/chat`. Signed-out users on any other path are redirected to `/login?next=…`.
- **Roles.** `lib/roles.ts` has `hasRole`, `hasAnyRole`, `isAdmin(supabase, email)` and `isAdminEmail`. Admin API routes follow one pattern: `isAdmin`, then `createAdminClient()`, as in `app/api/admin/roles/route.ts`.
- **Migrations** run `0001`–`0033`.
  - RLS uses owner-row policies (`auth.uid() = user_id`) and inline `exists (select 1 from user_roles …)`.
  - There are **no** `security definer` functions and **no** storage buckets.
  - `0033` sets the deletion convention: private rows cascade, and shared or published rows use `set null`.
- **Reusable pieces:**
  - `lib/extract-text.ts` → `extractTextFromFile(file: File)` (browser-side).
  - `components/WikiMarkdown` (markdown renderer), `ConfirmDialog`/`useConfirm`, `Toaster`/`showToast` and `AccessGateMessage`.
  - The `diff` package is already in `dependencies` but unused, so it is available for the diff screens.
  - Theme tokens live in `app/globals.css:8-33`.
- **Scripts.** `scripts/` contains only `smtp-test.mjs`, run with `node --env-file=.env.local`. There is no tsx.
- **Playbook HTML.** All its data sits in one `<script>`:
  - `JOBS` (40 jobs: P1–P6, S1–S14, I1–I10, E1–E10)
  - `OVERVIEW` (context, outcomes, insights, maturity flags)
  - `PHASES` (14: Readiness plus Stage 0–12, each with `n`, `w`, `jobs[]` and `t`). In the replaced HTML every one of the 40 jobs is in at least one phase: P3 and P4 are in Readiness, and S3 is in Stage 3.
  - `RULES` (12 `[rule, why]` pairs)
  - `ROLES` (23 roles)
  - `PMU` (Owns/Tracks plus a note per job)
  - `WHEN` (per job)
  - `TASKS` (139 checklist rows `[jobIds, stage, timing, owner, text]`). A row can name several jobs (`"P2,I1"`), so the number of task-to-job links can be higher than 139.
  - `OWNERS` (per job)

  Enrichment loops then add `pmu`, `when`, `tasks`, `owners` and `trackedBy=["PMU"]` to each job. The Purpose, Based on and Credits cards are **hard-coded HTML inside render functions** (`purposeHtml`, `basisHtml`, `creditsHtml`), not data.

---

## 1. Flag and navigation

- **`lib/flags.ts`** exports `isCube2 = process.env.NEXT_PUBLIC_CUBE_VERSION === '2'`. The value is inlined at build time, so set it per Vercel environment (non-production project only).
- **Sidebar** (`components/Sidebar.tsx`): when `isCube2`, the items become **Companion** (`/companion`) plus Admin when admin. The "Recent Explorations" block is hidden, because it is Cube 1.0 data. Account and Sign out stay. This is the only edit to a shared Cube 1.0 component.
- **Hiding routes without touching them.** Add a `redirects()` in `next.config.ts`, active only when the flag is `2`:
  - `/explore`, `/analyse`, `/contribute`, `/navigate`, `/adoptions`, `/wiki` and `/` all go to `/companion`.
  - Next applies config redirects before `proxy.ts`, so a signed-out visitor then lands on `/login?next=/companion`.
  - `proxy.ts` and the Cube 1.0 page files stay unchanged. The Cube 1.0 API routes stay reachable, because hiding is not deleting.
- **`/companion` is not added to `PUBLIC_PATHS`.** Access is only after sign-up, so the proxy's default redirect applies.
- **`/companion` page:**
  - It is a server page that returns `notFound()` when the flag is off.
  - It gates on `hasAnyRole` and shows `AccessGateMessage` when the account is pending.
  - It lists the listed playbooks as cards in the right panel. Opening a card goes to the workspace at `/companion/[slug]`.
- **Sign-up notice:** none, as you decided. `app/login/page.tsx` is not touched.

## 2. Schema and migrations

There are three migrations. All tables have RLS enabled, and private rows cascade from `auth.users`, following the `0033` convention.

### `0034_cube2_playbooks.sql`
- **`playbooks`**
  - Columns: `id uuid pk`, `slug text unique`, `title`, `description` (for the list card; an addition to the spec), `overview jsonb`, `roles jsonb`, `sequence jsonb` (`{phases:[{name, when, text, jobs[]}], rules:[{rule, why}]}`), `source_doc text not null default ''`, `listed boolean default true`, `updated_at`, `updated_by uuid → auth.users on delete set null`.
  - `overview` holds `{purpose, context, based_on, maturity_flags, credits: [{label, value | items, note?}], outcomes[], insights[]}`, matching the exported JSON (Slice 0).
- **`playbook_jobs`**
  - Columns: `id`, `playbook_id → playbooks on delete cascade`, `job_code`, `name`, `stages text[]`, `work_area`, `job_type`, `position int`, `body jsonb`, `updated_at`. Unique on `(playbook_id, job_code)`.
  - `body` holds `{intended_result, why_it_matters, when, how_summary[] (the short how, as a list of bullets), tasks:[{stage,timing,owner,text}], roles:{owns,does,reviews,enables}, owners[], tracked_by[], owner_note, gaps[], maturity:{flag,note}|null, recurs}`. Owners and tracked_by stay in `body`, as the spec says.
  - Job codes are fixed once created, because `member_job_states` keys on them.
- **`playbook_members`**
  - Columns: `id uuid pk` (added: the spec has `member_id` elsewhere but no id here), `user_id → auth.users on delete cascade`, `playbook_id → playbooks on delete cascade`, `member_role check in ('adopter','contributor')`, `project_role text default 'PMU'`, `created_at`. Unique on `(user_id, playbook_id)`.
  - There is no pseudonym column. You decided contributors see every adopter simply as **"User"**, so there is nothing to generate.
- **Helper functions.** `is_playbook_member(pid)` and `is_playbook_contributor(pid)` are `stable security definer set search_path = public`. They are needed so `playbook_members` policies don't recurse. These are the repo's first security-definer functions; this is a deliberate new pattern. Both also require an approved account (a `user_roles` row), so revoking a user's roles ends their playbook access at the database. `is_playbook_member` also requires the playbook to be listed, unless the caller contributes to it. (Slice 1 review.)
- **`save_playbook(p_playbook_id uuid, p_base_updated_at timestamptz, p_playbook jsonb, p_jobs jsonb, p_removed_jobs text[]) returns timestamptz`.** This is the **only write path** for playbook content after seeding. It is a `security definer` plpgsql function with `search_path = public`, and `execute` is granted to `authenticated`. It runs in one transaction:
  1. If `is_playbook_contributor(p_playbook_id)` is false, it raises `forbidden`.
  2. It runs `select updated_at … for update` on the playbook row. This locks the row, so two saves cannot interleave.
  3. If `updated_at <> p_base_updated_at`, it raises `stale_playbook` with a custom SQLSTATE. The client shows "Someone changed the playbook since you loaded it. Reload to see their change."
  4. It applies the keys present in `p_playbook`: `title`, `description`, `overview`, `roles`, `sequence` and `source_doc`.
  5. It upserts every row in `p_jobs` (full job rows) on `(playbook_id, job_code)` and deletes `p_removed_jobs`.
  6. **Content guards** run in SQL, so they can't be bypassed: the credits must still contain `CC BY 4.0` and `EkStep`, and no text may contain `only for author` (case-insensitive). A failed guard raises an error and rolls the whole save back.
  7. It sets `updated_at = now()` and `updated_by = auth.uid()`, and returns the new `updated_at`.

  Any error rolls back everything, so a failed save can never leave an edit half-applied. Because this function sets `updated_at` itself, no trigger is needed on `playbook_jobs`.

### `0035_cube2_assets.sql`
- **`assets`**
  - Columns: `id`, `playbook_id → playbooks cascade`, `title`, `kind check in ('file','link')`, `storage_path`, `url`, `description`, `job_codes text[] default '{}'`, `added_by → auth.users set null`, `created_at`.
  - Check: a file asset needs `storage_path`, and a link asset needs `url`.
- **Storage bucket `assets`** (private, `file_size_limit` 100 MB, no MIME restriction). Paths have the form `{playbook_id}/{asset_id}/{filename}`. `storage.objects` policies:
  - Read: `is_playbook_member(first path segment)`.
  - Insert and delete: `is_playbook_contributor(…)`.

  Downloads use signed URLs.
- **Uploads go straight from the browser to Supabase Storage**, never through a Next.js API route. Vercel functions reject request bodies over about 4.5 MB, so a 100 MB file cannot pass through one. The upload uses the contributor's own session, so the storage RLS policies above are the enforcement. Files over about 6 MB use Supabase's resumable (TUS) upload.
- **No orphan files.** The order is:
  1. The browser generates `asset_id`.
  2. It uploads the object.
  3. It inserts the `assets` row.
  4. If the insert fails, it removes the object (`storage.remove`) straight away and shows the error.

  Delete runs the other way round: first the row, then the object. A leftover can only happen if the clean-up call itself fails. For that case, `0035` adds a contributor-only view, `asset_orphans` (objects with no row), and the Assets screen shows a "Clean up" link when it is not empty.

### `0036_cube2_companion.sql`
- **`member_job_states`**
  - Columns: `member_id → playbook_members cascade`, `job_code`, `state check in ('discussed','in_progress','done','skipped')`, `note`, `set_by check in ('cube','user')`, `updated_at`. Primary key `(member_id, job_code)`.
  - A **`before update` trigger returns NULL when `OLD.set_by='user' and NEW.set_by='cube'`**. This puts "Cube never overwrites a user correction" in the database itself.
- **`companion_conversations`**: `id`, `member_id → cascade`, `playbook_id → cascade`, `context jsonb default '{}'`, `started_at`, `updated_at`.
- **`companion_messages`**: `id`, `conversation_id → cascade`, `role check in ('user','assistant')`, `content text`, `ui jsonb` (an addition: the parsed `<ui_action>`, so job cards re-render on reload), `created_at`. It has an index on `(conversation_id, created_at)` for loading history.
- **`companion_usage`**: `user_id → auth.users on delete cascade`, `role check in ('adopter','contributor')`, `day date default (now() at time zone 'utc')::date`, `count int not null default 0`. Primary key `(user_id, role, day)`.
  - RLS: users can select their own rows only, and nobody writes directly.
  - **`bump_companion_usage(p_role text, p_cap int) returns boolean`** is `security definer`. It runs `insert … on conflict (user_id, role, day) do update set count = companion_usage.count + 1 returning count`, using `auth.uid()`, and returns `count <= p_cap`.
  - Rows older than 30 days can be deleted at any time. Nothing reads them.
- **`record_companion_turn(p_conversation_id, p_user_text, p_assistant_text, p_ui jsonb, p_context_patch jsonb, p_job_updates jsonb)`.** This is a `security invoker` function, so RLS still applies. In one transaction it inserts both messages, merges `context` (`context || p_context_patch`), and upserts the job states with `set_by='cube'`; the user-correction trigger still applies. A completed turn is therefore stored completely, and a failed one leaves nothing. Two safeguards, added after the Slice 1 review:
  - A job update with an unknown job code, or a state outside the four allowed, is **skipped**, not fatal, so one bad entry from the model never costs the user their turn.
  - Only the context keys `stage`, `location`, `done` and `role_note` are stored. The contributor RPCs show only those keys, so nothing else the model writes can reach a contributor.

### RLS matrix

| Table | Adopter (member) | Contributor of that playbook | Admin |
|---|---|---|---|
| `playbooks`, `playbook_jobs` | select where `listed` (any approved user, so the list shows before joining) | **no direct insert, update or delete**; writes only through `save_playbook()` | via service-role API / seed script |
| `assets` + bucket | select / read if member | + insert, update, delete | via service role |
| `playbook_members` | select own row; **insert own row only with `member_role='adopter'`, `project_role='PMU'`**, requires a `user_roles` row | own row only (no reading other members) | manages contributors via `/api/admin/playbook-members` (service role) |
| `member_job_states`, `companion_conversations`, `companion_messages` | full CRUD on own (via `exists member where user_id = auth.uid()`) | **no direct access** | none in UI |

### Anonymous conversation access
Contributors never get select on other members' rows. They go through two `security definer` RPCs. Each checks `is_playbook_contributor` **for the playbook the conversation belongs to**, so a contributor to playbook A gets nothing from playbook B. Neither returns a `user_id` or an email:
- `contributor_list_conversations(p_playbook_id)` returns conversation id, `context`, started/updated, and message count. Every row is labelled "User". It covers only `member_role = 'adopter'`, so a contributor's own test chats are excluded.
- `contributor_get_conversation(p_conversation_id)` returns the context, messages (content only), and that member's job states.

`auth.users` and `profiles` are never joined. Names or districts that adopters type into messages stay visible to contributors; you accepted this for the test.

## 3. Seed and import

There are two steps, so the data can be reviewed in git before it reaches the database.

1. **`scripts/cube2/export-playbook.mjs <html> <out.json>`**
   - It pulls the `<script>` body and runs it in `node:vm` with a no-op DOM stub (a Proxy for `document`, `window` and `history`), so the data statements and enrichment loops all execute. It then reads `JOBS`, `OVERVIEW`, `PHASES`, `RULES`, `ROLES`, `STAGES` and `AREAS` from the context.
   - It calls `purposeHtml()`, `basisHtml()` and `creditsHtml()` and parses their `<dt>/<dd>` and `<li>` markup into `overview.purpose`, `based_on` and `credits`.
   - It normalises the data to the database shape:
     - `result` → `intended_result`, `why` → `why_it_matters`.
     - `how` → `how_summary`, kept as the list of bullets (Decision 2). There is no separate `how` field, so the same text is never stored twice.
     - `pmu.n` → `owner_note`, `trackedBy` → `tracked_by`, `mat` → `maturity`.
     - `position` comes from each job's first appearance in `PHASES`.
   - It writes **`content/playbooks/low-resource-language.json`**, which is checked in and closes the spec's open item "Export the playbook as JSON".
   - **One serializer.** The JSON shape and key order come from `lib/companion-v2/playbook-json.mjs`, which is plain JavaScript so both Node scripts and the app can import it. The export script, the database export check (Slice 1) and the contributor's "Download playbook as JSON" button all use it, so all three produce identical output.
   - It prints checks:
     - Counts: 40 jobs, 23 roles, 14 phases, 12 rules, 139 checklist rows.
     - Every phase job code exists, and **every job is in at least one phase**. The export fails otherwise.
     - Jobs with no owners (flagged) and jobs with no tasks (expected: Set goals, Design the voice experience, Secure funding).
     - The credits contain "CC BY 4.0" and "EkStep".
2. **`scripts/cube2/seed-playbook.mjs --json <file> --source <md> --slug low-resource-language [--force] [--prune]`**
   - It uses the service-role client from `.env.local` and runs with `node --env-file=.env.local …`, the same pattern as `smtp-test.mjs`.
   - It upserts the playbook by slug and the jobs by `(playbook_id, job_code)`.
   - It refuses if the playbook already exists unless `--force` is given, because a re-seed would overwrite live contributor edits. `--prune` deletes jobs that are not in the JSON.
   - It **refuses if the source contains "Only for Author"**, matched without regard to case.
   - It prints the source-document size: characters, a rough token estimate, and an exact figure from Anthropic's `count_tokens`. It warns above 80% of the 100k-token cap.
3. **`scripts/cube2/export-db.mjs --slug <slug> [--out <file>]`** reads the playbook back from the database with the service role. It writes the JSON through the same serializer, plus the source document as `.md`. It is used for the round-trip check in Slice 1, and as a backup at any time.

**After the first seed, the database is the source of truth.**
- The HTML file is frozen as the historical source. It is never re-exported or edited to change the playbook.
- The checked-in JSON is a snapshot of the first seed. It drifts from the live playbook as soon as a contributor saves anything.
- Re-seeding with `--force` **overwrites every live edit**: overview, roles, sequence, jobs and the source document. There is no history to recover them from. Before any forced re-seed, take a backup with `export-db.mjs` or the Download button.

**Source document (settled):**
- **File:** `docs/design/Adoption_Package_India_Rebuild_31_Aug_2026.md`. It is about 59 KB and 8.9k words, so roughly 15k tokens, well under the 100k cap.
- **Already clean:** "Only for Author" content has been removed.
- **Left as they are:**
  - Image references (3): they were dangling (`![][imageN]` with no target), so the lines are removed. Nothing is transcribed.
  - The DC checklist. It is not added to the source document.
  - The headings (Clusters 1–8).
- **Seeding:** the cleaned file is `content/playbooks/low-resource-language.source.md`. Two cleanups: the empty `## ` heading and the three dangling image lines were removed. It measures **13,707 tokens** (Anthropic `count_tokens`), 14% of the cap.

## 4. companion-v2 chat (adopter)

### Route
- `app/api/chat/route.ts` gets three small edits:
  - Add `'companion-v2'` to `MODES`.
  - After the existing `hasAnyRole` gate and before the wiki loading, add `if (mode === 'companion-v2') return handleCompanionV2(body, supabase);`.
  - Read the full body once (an additive change to the destructuring).
- Nothing else in the route changes.

### `lib/companion-v2/handler.ts`
- **Request:** `{ role: 'adopter'|'contributor', playbookId, conversationId?, messages, focusJob?, files? }`.
- **Auth:** `getUser()`, then a 401 if there is no user.
  - For adopters, it loads the member row (RLS), which supplies `project_role` and `id`.
  - For contributors, it requires `member_role='contributor'`, otherwise 403.
  - `context` and job states are loaded **from the database**, not trusted from the client.
- It loads the playbook, jobs and assets under the user's RLS client.
- **Streaming:** a new `lib/anthropic-stream.ts` (`streamText(stream, { onDone })`) does the same delta-forwarding as today. Only v2 uses it; existing branches are left alone.
  - It logs `usage.cache_read_input_tokens` and `cache_creation_input_tokens` from the final message, in dev, to confirm caching works.
  - `max_tokens` is 2048 for adopters and **8000** for contributors (see "Function time limit" below).
  - **Errors.** If Anthropic fails before the first token, for example because it is overloaded (529) or rate-limited, the handler returns JSON `{error:'model_unavailable'}` with a 503. If it fails mid-stream, the stream helper calls `controller.error()`, so the client's reader throws instead of seeing a normal end. There are no automatic retries; the user retries.
- **Daily message cap (cost guard), counted on the server.** Before calling the model, the handler calls `bump_companion_usage(p_role, p_cap)` (section 2, `0036`). It passes `'adopter'` with `COMPANION_DAILY_MESSAGE_CAP` (default 60), or `'contributor'` with `COMPANION_DAILY_CONTRIBUTOR_CAP` (default 40).
  - The function adds one to today's count for this user and role, and returns whether the user is still within the cap. Both happen in one statement, so two tabs can't slip past the cap together.
  - If the user is over the cap, the handler returns 429 without calling the model. Cube then says, in plain words, that the daily limit is reached and that it resets at midnight UTC.
  - **What counts:** every model call is counted when it is made, whether or not the reply is later stored. Calls made straight to `/api/chat` and failed turns therefore count too.
  - **What doesn't count:** the hidden kickoff turn. Each chunk of an "Update from files" run counts as one contributor call.
- **Function time limit.** The deploy workflow (`.github/workflows/deploy.yml`) notes the Vercel **Hobby** plan. With Fluid Compute, which is on by default for current projects, Hobby allows functions up to **300 s**. Pro allows up to 800 s.
  - `app/api/chat/route.ts` already exports `maxDuration = 300`, and that covers `companion-v2` because it is the same route file. No change is needed on Hobby.
  - At typical Sonnet output speeds, 16,000 output tokens can take about 200–320 s and could be cut off at 300 s. So the contributor ceiling is 8,000 tokens. The item-level array ops and the heading-based source ops (section 5) keep patches small enough for that.
  - Before Slice 2, confirm the plan and that Fluid Compute is on, under Vercel → Project → Settings → Functions, for the non-production project. Without Fluid Compute, Hobby allows only 60 s, which the contributor chat would not survive. On Pro, `maxDuration` can go up to 800, and the contributor ceiling back to 16,000.

### Prompt builder: `lib/companion-v2/prompt.ts`
It returns `system` as content blocks, with the stable prefix first:
1. Instructions: `content/companion-v2.md` (or `-contributor.md`), read with `readFile` like `lib/wiki-loader.ts`.
2. The structured playbook, rendered by `renderPlaybook()` as compact, deterministic markdown, not raw JSON:
   - Overview, roles, and the sequence with hard rules.
   - Then each job with its code, name, when, owners, tracked_by, owner note, intended result, why, how summary, tasks, gaps and maturity.
3. The source document, marked **`cache_control: {type:'ephemeral'}`**. This caches blocks 1–3. A contributor edit changes the text, so the cache refreshes itself.
4. Not cached: the asset list (id, title, description, job names). It is small and changes often.
5. Not cached: this user's facts:
   - Their project role (PMU).
   - `context` so far.
   - Recorded job states.
   - `focusJob`, when the chat was opened from a job.
   - "first visit: yes/no".

**First visit.** An empty conversation sends a hidden kickoff turn, the same pattern as `LIBRARY_KICKOFF_PROMPT`, and it is never stored. Cube greets and asks the first intake question. The client sends the last about 40 turns.

### `content/companion-v2.md` outline
- **Who Cube is.** A companion for first-timers. Plain words, short replies, one question at a time.
- **Knowledge rules:**
  - The playbook is authoritative for what, when and who.
  - The source document gives depth on how.
  - If the two disagree, say so plainly and follow the playbook for sequencing.
  - If neither covers something, say "neither the playbook nor the source document covers this".
  - Never use general AI knowledge.
  - No citations.
- **The three known figure conflicts:** telephony share, minimum volume and studio hours. Present both and say they differ.
- **For PMU:** say whether PMU owns or tracks the job, and who owns it. If no owner is stated, say so.
- **Maturity:** say how well supported something is (thin, estimate, one adoption).
- **Assets:** offer one when it fits.
- **Never:** framework terms (work area, job type, stage letters) or job codes in prose, and never narrate the playbook's structure.
- **Intake:** 2–3 questions, one at a time: where are you, what's done, what's your part. Save the answers into `context`. If the user taps a chip first, answer briefly, then ask.
- **Journey capture:** record a state only from what the user said. "Not discussed" gets no marker. A note is one line in the user's words. No due dates, assignees or reminders.
- **Response contract (the single source of truth):** end every reply with
  ```
  <ui_action>{"focusJobs":["S4"],"openJob":null,"showAssets":[],"context":{"stage":"","location":"","done":"","role_note":""},"jobUpdates":[{"job":"P2","state":"done","note":"Confirmed Bhili in writing in March"}]}</ui_action>
  ```

### Client
- **`lib/companion-v2/ui-action.ts`.** `parseUiAction` and `stripUiAction`, a copy of `grid-update.ts`. It cuts at `<ui_action` while streaming. It validates job codes and asset ids against the loaded data and drops anything unknown.
- **`lib/companion-v2/use-companion-chat.ts`.** It loads or creates the member's conversation and streams the reply.
  - **When the stream ends normally:**
    1. It calls `record_companion_turn(...)` once, storing both messages, the `context` patch and the `jobUpdates` in one transaction.
    2. It then applies `focusJobs`, `showAssets` and `openJob` to the UI.
  - **When the request fails** (a 503, a reader error mid-stream, or a network failure):
    - The partial reply is removed from the screen.
    - **Nothing is written.**
    - The user's text goes back into the composer, with "Cube couldn't answer just now. Please try again." and a **Retry** button.
  - **When the record call fails:** the same retry message shows. The transaction means nothing was stored.
  - **On a 429:** the daily-limit message shows, with no retry.
- **Conversation scope.** Home opens the member's latest conversation.
  - A **"Start a new conversation"** button creates a fresh conversation whose `context` is copied from the previous one. Cube therefore remembers the situation but skips the intake questions.
  - Job states belong to the member, not the conversation, so they carry over automatically.
  - **Recent conversations in the sidebar** (decided 2026-11-05, built in Slice 3): under **Companion**, the signed-in user's own conversations, newest first, as Cube 1.0 lists Recent Explorations.
    - Each entry is labelled with the start of the user's first message, plus the playbook name when there is more than one playbook. A conversation with no user message yet shows "New conversation".
    - Clicking one opens it on that playbook's Home (`/companion/[slug]?c=<conversation id>`). Without `?c=`, Home opens the latest conversation as now.
    - **Delete** (with the same confirm dialog as Cube 1.0) removes the conversation and its messages for good, including from the contributors' anonymous viewer. Job states belong to the member, not the conversation, so they stay. RLS already lets users delete only their own conversations; no new tables.
- **Google Sheets:** no logging for companion-v2, adopter or contributor. `logConversation` is not called.

## 5. Contributor chat: Update with Cube

### Route and prompt
- Same route with `role:'contributor'`. The prompt is `content/companion-v2-contributor.md` plus the same cached playbook and source-document blocks.
- **Nothing is persisted.** Messages live in React state, with a `beforeunload` warning while a proposal is unapplied.
- Contributor turns are **not sent to `logConversation`**, so file text never reaches Google Sheets.
- Cube asks one short question when a request is ambiguous. In that case the reply has a `question` and no ops.

### Patch format
The reply ends with:
```
<playbook_patch>{"summary":"…","question":null,"ops":[…],"contradictions":[{"topic":"…","existing":"…","incoming":"…","source":"file name"}]}</playbook_patch>
```
| op | fields |
|---|---|
| `job.set` | `job`, `field` ∈ name, intended_result, why_it_matters, when, roles, owners, tracked_by, owner_note, maturity; `value` (whole field). For `how_summary`, `gaps` and `tasks`, use the item ops below; `job.set` on those three is allowed only to clear or reorder the whole list. |
| `job.append` | `job`, `field` ∈ how_summary, gaps, tasks; `item` (a string, or `{stage,timing,owner,text}` for tasks) |
| `job.remove_item` | `job`, `field`, `index`, `expect` (the current item's text, or the task's `text`). If `expect` doesn't match the item at `index`, the op fails as stale. |
| `job.replace_item` | `job`, `field`, `index`, `expect`, `item` |
| `job.add` | `job` (new code), `value` (full job). Removing a job is form-only, with a confirm. |
| `overview.set` | `field` ∈ title, description, purpose, context, outcomes, insights, based_on, credits, maturity_flags; `value` |
| `role.set` / `role.add` / `role.remove` | `name`, `value` |
| `phase.set` / `phase.add` | `index` / `after`, `value` |
| `rules.set` | `value` (full list) |
| `source.replace_section` | `heading` (the exact heading line, e.g. `### 4.2 — Budget Categories to Plan For`), `text`. Replaces the body under the heading, up to the next heading of the same or a higher level. The heading line itself is kept. |
| `source.append_to_section` | `heading`, `text`. Adds text at the end of that section's body. |
| `source.add_section` | `after_heading` (or null for the end), `heading`, `text` |
| `source.replace` | `find` (exact text, must match once), `replace`. For small wording fixes. |
| `source.insert_after` / `source.append` | `find`, `text` / `text` |

A heading op fails, rather than guessing, when the heading is missing or appears more than once.

The contributor prompt tells Cube which op to prefer: item ops for list fields, section ops for anything larger than a sentence in the source document, and `find`/`replace` only for small edits.

### Applying a patch
- **`lib/companion-v2/patch.ts`.** A pure function, `applyOps(snapshot, ops)` → `{ next, results[] }`. Each op returns ok or an error, for example "text not found" or "unknown job". The same function drives both the preview and the save.
- **Validators block an apply when:**
  - the credits lose "CC BY 4.0" or "EkStep";
  - any text adds "Only for Author";
  - a `job.set` names a field that is not whitelisted.

  These run in `patch.ts` for instant feedback. The first two also run inside `save_playbook`, which is the real enforcement.
- **Diff and Apply screen** (`components/companion-v2/PatchReview.tsx`):
  - One card per op, with a plain label such as "Run the language survey → How".
  - Diffs: `diffWords` for strings, a list diff for arrays and tasks, and `diffLines` for source sections.
  - Each card has an include checkbox and an inline editor for the proposed value.
  - Per-op errors and the contradictions list are shown.
  - Buttons: **Apply selected** and **Discard**.
- **Saving.**
  - Apply calls `supabase.rpc('save_playbook', …)` once from the browser, using the contributor's session. The arguments are the `updated_at` the contributor loaded, the changed playbook keys, the full rows of every changed job, and any removed job codes.
  - There is no separate Next.js save route. The SQL function is the atomic check and the write, so a route would add nothing.
  - **Errors:**
    - `stale_playbook` shows the reload message, and the proposal stays on screen so nothing typed is lost.
    - Guard errors show the reason.
    - Any error leaves the database exactly as it was.
  - After a successful save, the client stores the returned `updated_at` as the new base.
  - The form editors use the same call and the same diff step.
  - No history is kept.

### Update from files
1. The "Update from files" chip, or the button on the Source document screen, opens a file picker.
2. The browser runs `extractTextFromFile` and shows each file's size.
3. The text is sent as `files:[{name, text}]` and placed in the **user turn** as `<uploaded_file name="…">`. It is never in the system prompt, never cached, never logged and never stored.
4. Above about 120k characters, the client splits the text by headings into chunks and calls once per chunk. All the ops are then shown in one review list, and ops that touch the same target are flagged as overlapping.
5. Apply and Discard work as above.

## 6. Adopter UI (two screens)

- **Workspace:** `app/companion/[slug]/layout.tsx`.
  - It loads the playbook and the member row. On first open it self-joins via `POST /api/playbooks/[id]/join`, an RLS insert of an adopter row.
  - It shows top tabs: **Home · Jobs**, plus the contributor tabs for contributors.
  - Calm light theme, using the playbook HTML palette ported as `--pb-*` tokens in `globals.css`, plus the `frontend-design` skill.
- **Home** (`/companion/[slug]`): `components/companion-v2/CompanionChat.tsx`.
  - It is new and leaves `ChatPanel` untouched, because that component is tied to Cube 1.0 props. It reuses `WikiMarkdown` and the auto-grow composer pattern.
  - The 4 chips show until the first user message: "Where do I start?", "What do I own, and what do I only track?", "How long will this take and what will it cost?", "What usually goes wrong, and how do I avoid it?".
  - `focusJobs` render as inline next-step cards (name, when, Owns or Tracks), and tapping one opens the job sheet. `showAssets` render as asset chips.
  - `?job=S4` (from "Ask Cube about this job") sends "Tell me about *{job name}*" with `focusJob`.
- **Jobs** (`/companion/[slug]/jobs`):
  - Jobs appear in sequence order, grouped under the phase where each first appears (Before you start, Week 1, …).
  - Each row shows the name, a short when, **Who owns** (PMU in bold), **Who tracks**, an **Owns** or **Tracks** tag, and a state marker. The markers are Discussed, In progress, Done and Skipped. No marker means not discussed; there is never a warning.
  - A toggle switches between **All jobs** and **Only mine** (Owns).
  - `lib/companion-v2/jobs.ts` derives `tagFor(job, role)` and `jobsForRole(role)`, which includes a job when the role is in its owners or tracked_by.
  - Untagged assets appear under "General resources" at the bottom.
  - No area, type or stage-letter labels anywhere.
- **Job detail** (a sheet, `?open=S4`):
  - What (intended result), why, when, the short how (bullets).
  - Checklist tasks with stage, timing and owner, PMU items highlighted. Guidance only: no checkboxes.
  - Who's involved, with "Not stated" shown plainly. The owner note and the maturity line.
  - Assets: files open through a signed URL, and links open in a new tab.
  - The user's own state and note editor, which saves with `set_by='user'`. "Clear" deletes the row.
  - **Ask Cube about this job.**

## 7. Contributor UI

All of these sit under `/companion/[slug]/…`. The server checks the member role and returns `notFound()` for non-contributors.

- **Playbook** (`/playbook`): a React port of the HTML, in `components/companion-v2/playbook/`:
  - `Overview`: purpose, context, outcomes, insights, based on, credits and maturity flags.
  - `Roles`: cards grouped by `g`, with search, each linking to the jobs it owns.
  - `JobsMap`: the stage × area matrix, with continuation tiles, ↻, type chips, search and a "PMU owns" toggle.
  - `Sequence`: the phases plus hard rules.
  - `JobDrawer`.

  Edit controls:
  - A pencil on each card or section opens a form: `JobEditForm` (with a tasks table and chip inputs for owners and tracked_by), `RoleForm`, `OverviewForm`, `PhaseForm` and `RulesForm`.
  - Saving turns the form into ops, shows them in `PatchReview`, then calls `save_playbook`.
  - Jobs with no owners carry a small "No owner named" flag.
  - **Download playbook as JSON** (optional, as a manual backup). This is a button in the Playbook header. It serialises the loaded playbook and jobs with `playbook-json.mjs`, plus the source document, into `{slug}-{date}.json`. It is generated in the browser, with no server call. The file has the same shape the seed script accepts, so it can be re-seeded with `--force` if ever needed.
- **Update with Cube** (`/update`): `ContributorChat` with 4 chips: "Edit a job", "Edit the overview, roles, sequence or rules", "Edit the source document" and "Update from files". `PatchReview` appears under each reply that carries a patch.
- **Source document** (`/source`):
  - A `WikiMarkdown` view.
  - An Edit mode: a textarea with a size meter (estimated tokens against the 100k cap; amber at 80%, red above). Saving shows a `diffLines` review first.
  - An "Update from files" button.
- **Assets** (`/assets`):
  - The list, plus an add/edit form: kind (file upload to the bucket, **100 MB limit, any file type**, or a link), title, a required description with the hint "Cube sees only this description", and job tags picked by job name.
  - A file upload goes straight from the browser to Storage and shows a progress bar. The upload-then-insert order and the clean-up on failure are described in section 2.
  - Delete removes both the row and the stored object.
- **Conversations** (`/conversations`, `/conversations/[id]`): a read-only list and transcript from the two RPCs. Each conversation is labelled "User" and shows dates, context and job-state markers. No name or email.
- **Admin: assigning a contributor to a playbook.** A new **"Playbook contributors"** panel on `/admin` (`components/AdminPlaybookMembersPanel.tsx`) sits beside the existing role and registration panels.
  - The admin picks a playbook from a dropdown and sees its current contributors by email. Admin-only data comes from `auth.admin.listUsers`, as `/admin` already does.
  - The admin types or selects a signed-up user's email and clicks **Add as contributor**, or clicks **Remove** on a row.
  - **Backend:** `app/api/admin/playbook-members/route.ts` follows the `app/api/admin/roles` pattern:
    - It checks `isAdmin` and writes with the service-role client.
    - POST `{playbook_id, user_id, action:'add'|'remove'}` upserts the member row with `member_role='contributor'`. Remove deletes the row, or sets it back to `adopter` if the user has their own conversations in that playbook.
  - The user does not need Cube 1.0's `pathway_contributor` role. Contributor status is per playbook.
  - The change applies on the user's next page load: the extra tabs appear, and RLS allows edits.
  - Adopters join themselves on first open. There are no invites.

## 8. Build order

After each slice I stop. You test locally, then run the `qa-tester` subagent (manual scripts), then `code-reviewer` on the diff. I commit **only when you say "commit"**.

### Slice 0: data prep (no app code)
**Build:**
- The export script, and the checked-in `content/playbooks/low-resource-language.json`.
- The source document as clean markdown, from your files.

**Accept when:**
- The script prints the counts above with no unknown codes.
- I list the 3 no-task jobs and any no-owner jobs.
- The source document has no "Only for Author" text, and its size has been measured.

**Test:**
1. Open the JSON and spot-check P1, S4 and E10 against the HTML drawer (when, tasks, owners, owner note).

### Slice 1: flag, schema, seed, membership
**Build:** `lib/flags.ts`, the Sidebar change, the `next.config.ts` redirects, migrations `0034`–`0036` (including `save_playbook`, `record_companion_turn` and the two conversation RPCs), the seed and `export-db` scripts, the `/companion` list page, the workspace shell with empty tabs, self-join, and the admin contributor panel.

**Accept when:**
- **Flag unset:** the app is identical to today (nav, `/explore`, `/analyse`, `/contribute` all work).
- **Flag `2`:** the nav shows Companion (and Admin); the old URLs redirect to `/companion`; signed out goes to login.
- The migrations apply cleanly to a non-production Supabase. The seed loads 40 jobs, 23 roles, 14 phases and 12 rules. Re-running without `--force` refuses.
- **Round trip:** straight after seeding, `export-db.mjs` output is byte-identical to the checked-in JSON and source `.md` (`git diff --no-index` shows nothing).
- Opening the playbook creates an adopter member row.
- Admin can add or remove a contributor, and the contributor then sees the extra tabs.
- **Scoped contributor reads:** a contributor to playbook A gets an empty result or an error from both conversation RPCs when called for playbook B, or for one of B's conversation ids.
- **Saves are atomic:** a contributor can't `update playbooks` directly, and RLS refuses. `save_playbook` with a stale `updated_at` raises `stale_playbook` and changes nothing. A save whose credits lack "CC BY 4.0" rolls back completely, with no job row changed either.

**Test:**
1. Run `npm run dev` with and without the flag in `.env.local`, and click through the nav.
2. Apply the migrations with `supabase db push` against the test project.
3. Run the seed, then `select count(*)` on the tables.
4. Run `node --env-file=.env.local scripts/cube2/export-db.mjs --slug low-resource-language --out <scratch>`, then `git diff --no-index` it against `content/playbooks/`.
5. Seed the same JSON a second time as `--slug test-playbook`, so there are two playbooks. Make user C a contributor to the first only. Have user D, an adopter, chat once in `test-playbook` by inserting rows in SQL.
6. Sign up a new user, open the playbook, and check `playbook_members`.
7. In the SQL editor, impersonating an adopter (`set role authenticated; set request.jwt.claims …`): `update playbooks` affects 0 rows; `select * from playbook_members` returns only the adopter's own row.
8. Impersonate contributor C:
   - A direct `update playbooks` affects 0 rows.
   - `save_playbook` with the current `updated_at` succeeds.
   - Repeating it with the old `updated_at` raises `stale_playbook`.
   - A save that removes "CC BY 4.0" fails, and `select` shows nothing changed.
   - `contributor_list_conversations('<test-playbook id>')` returns nothing, and `contributor_get_conversation('<D's conversation id>')` returns nothing.
9. Delete a test account and confirm its member, conversation and state rows are gone.

### Slice 2: companion-v2 adopter chat
**Build:** the route branch, `handler.ts`, `prompt.ts`, `renderPlaybook`, `anthropic-stream.ts`, `content/companion-v2.md`, the ui_action parser, `use-companion-chat`, and a basic Home chat with chips.

**Accept when:**
- A first visit opens with Cube asking one question. After 2–3 answers, `context` is filled.
- Chips work.
- Answers use plain language, with no job codes or framework terms. They say Owns or Tracks plus the owner, and present both figures for telephony share and minimum volume.
- An off-playbook question ("which GPU should I buy?") gets the plain absence statement.
- `<ui_action>` never appears on screen, and its job updates appear in `member_job_states`.
- The second turn shows `cache_read_input_tokens > 0` in the server log.
- Cube 1.0 `/analyse` still works with the flag off.
- **API failure:** when the Anthropic call fails, before or during streaming, the user sees "Cube couldn't answer just now" with Retry, their text is back in the composer, and **no row** was added to `companion_messages`, `companion_conversations.context` or `member_job_states`. Retry then works normally.
- **Daily cap:** with the cap set to 3, the fourth message gets the daily-limit message with no model call, and `companion_usage.count` is 4. The kickoff turn doesn't count. A turn that failed still counts. Posting directly with curl counts too, and is refused once over the cap.

**Test:**
1. Use a fresh account with a scripted 8-turn conversation (I'll supply it).
2. Inspect `companion_messages` and `companion_conversations.context`.
3. Say "we've already confirmed the language", check that P2 ("Confirm target language and starting scope") becomes `in_progress` (only part of the job is done; `done` only when the person says dialect and scope are decided too), then say nothing about S4 and check it has no row.
4. Use curl to post `role:'contributor'` as an adopter and expect a 403.
5. **Failure before streaming:** set `ANTHROPIC_API_KEY` to an invalid value and restart. Send a message: Retry appears, and the row counts are unchanged.
6. **Failure mid-stream:** a dev-only env var, `COMPANION_V2_FAIL_AFTER_CHARS=200`, makes the stream helper call `controller.error()` partway through. Check the same outcome.
7. Set `COMPANION_DAILY_MESSAGE_CAP=3` and send 4 messages. Check `select * from companion_usage`. Then send a 5th with curl, using the session cookie, and expect a 429.

### Slice 3: adopter Home and Jobs
**Build:** the Jobs list, the job sheet, state markers, the state/note editor, Only mine, inline job cards, asset chips and General resources (assets inserted by SQL for now), "Ask Cube about this job", and the **Recent conversations** list in the sidebar with open and delete (section 4, Client).

**Accept when:**
- All 40 jobs show in sequence order with Owns or Tracks tags that match the HTML.
- Only mine shows exactly the Owns jobs.
- A user correction persists, and a later Cube update to the same job does not overwrite it.
- "Ask Cube about this job" opens Home focused on that job.
- The layout is clean on a phone-width screen.
- The sidebar lists the user's own conversations, newest first, labelled by their first question. Clicking one opens it with its history and job cards. Deleting one (after a confirm) removes it and its messages, keeps the job states, and drops it from the contributor viewer. Another user's conversations never appear, and opening another user's `?c=` id falls back to the user's latest conversation.

**Test:**
1. Compare five jobs against the HTML "PMU owns" filter.
2. Set S4 to Skipped by hand, then tell Cube "S4 is done" (in plain words). The marker should stay Skipped, with `set_by='user'`.
3. Insert one link asset and one untagged asset by SQL and see where each appears.
4. Resize to 375px.
5. Start two conversations, reload, and switch between them from the sidebar. Delete one and check in SQL that its `companion_conversations` and `companion_messages` rows are gone while `member_job_states` is unchanged.
6. Open `/companion/<slug>?c=<another user's conversation id>`: the user's own latest conversation opens instead.

### Slice 4a: contributor Playbook view, read-only
**Build:** the React port of the HTML (Overview, Roles, Jobs map and Sequence tabs, plus `JobDrawer`), the `--pb-*` palette, the "No owner named" flag, and the **Download playbook as JSON** button.

**Accept when:**
- All four tabs match the HTML in content: every overview card, all 23 roles, all 40 jobs in the matrix with their continuation tiles, all 14 phases and 12 rules.
- The drawer shows the same fields as the HTML drawer.
- Search, type chips and "PMU owns" filter the same way the HTML does.
- Adopters get a 404 on `/playbook`.
- The downloaded JSON equals `export-db.mjs` output for the same playbook.

**Test:**
1. Open the HTML and `/playbook` side by side, and compare each tab and five drawers (P1, P3, S4, I5, E10).
2. Try the filters in both.
3. Download the JSON, then `git diff --no-index` it against the `export-db` output.

### Slice 4b: edit forms, patch.ts, PatchReview and save
**Build:** `JobEditForm`, `RoleForm`, `OverviewForm`, `PhaseForm` and `RulesForm`; `lib/companion-v2/patch.ts` with every op in section 5 (including the item and section ops); `PatchReview`; and the `save_playbook` call with its error messages.

**Accept when:**
- Editing a job's how shows a diff, and Apply makes it visible to an adopter immediately.
- Adding one checklist task produces a single `job.append`, not a rewrite of the whole list.
- Two tabs editing at once: the second save gets the reload message, and its proposal stays on screen.
- Removing "CC BY 4.0" from the credits is blocked in the UI. It is also blocked when the RPC is called directly from devtools.
- A save that fails halfway leaves nothing changed. Test this by including one job whose `job_code` breaks a constraint.
- `patch.ts` unit checks pass: a stale `expect` on `remove_item`/`replace_item` fails, and a missing or duplicated heading fails.

**Test:**
1. Make one edit of each form type and confirm it as an adopter in another browser.
2. Run the two-tab test.
3. Call `supabase.rpc('save_playbook', …)` from devtools with the credits stripped.
4. Run `node scripts/cube2/check-patch.mjs` (a small assertion script over `patch.ts` cases, which I'll supply).

### Slice 4c: Assets
**Build:** the `assets` bucket policies in use, the Assets screen (list, add or edit file or link, delete), direct browser upload with resumable upload over 6 MB and a progress bar, the orphan clean-up, and asset display in the job sheet and General resources, replacing the SQL-inserted test rows.

**Accept when:**
- A 90 MB file and a link can each be added, tagged to a job, seen by an adopter in that job, and downloaded through a signed URL.
- The upload request goes to the Supabase Storage host, not `/api/...` (check the Network tab).
- An adopter can't upload. Storage refuses, as it does from devtools.
- If the row insert fails, the uploaded object is removed and no orphan is listed.
- Delete removes both the row and the object.

**Test:**
1. Upload 90 MB and 2 MB files and add a link, as a contributor.
2. View them as an adopter.
3. Simulate a failed insert by temporarily adding a `check (false)` constraint on `assets` in the test project, then check that Storage has no leftover object.
4. Try `supabase.storage.from('assets').upload(...)` from an adopter's devtools.

### Slice 4d: Update with Cube, Source document and Update from files
**Build:** `content/companion-v2-contributor.md`, `ContributorChat`, the Source document view and editor with the size meter, and the file flow with chunking.

**Accept when:**
- "Change the when of the language survey to 2–3 months" yields one `job.set` op, its diff, and an Apply.
- "Add a gap to the language survey: …" yields one `job.append`. "Rewrite section 4.2 of the source" yields one `source.replace_section`.
- The longest contributor reply in the scripted set finishes inside the function time limit on the non-production Vercel deployment, not only locally.
- With `COMPANION_DAILY_CONTRIBUTOR_CAP=2`, the third contributor request gets the daily-limit message. A 3-chunk file update stops at the cap and says so, rather than failing silently.
- An ambiguous request gets one question and no ops.
- Uploading a doc with a conflicting figure lists a contradiction.
- After Apply, the adopter chat reflects the change.
- Nothing about the contributor chat or the files exists in the database or in Sheets.
- A stale `find` shows an error rather than a wrong edit.

**Test:**
1. Five scripted requests (I'll supply them).
2. Upload a test .docx.
3. Query `companion_messages` for contributor rows (expect none).
4. Check the Sheet.

### Slice 5: Conversations viewer
**Accept when:**
- The contributor sees adopter conversations labelled "User", with their context and markers, and no names, emails or user ids. Network responses are included in this check.
- An adopter's "Start a new conversation" shows as a separate row.
- A contributor's own adopter-tab chats are not listed.
- An adopter gets a 404 on `/conversations`.
- A contributor to one playbook sees no conversations from another. Opening `/companion/test-playbook/conversations/<id>` for a playbook they don't contribute to returns a 404.

**Test:**
1. Have two adopter accounts chat.
2. View as a contributor.
3. Inspect the RPC response JSON in devtools.
4. Use the two-playbook setup from Slice 1: as contributor C, open the `test-playbook` conversations URL directly and call both RPCs with its ids.

---

## Assumptions
1. Adopters can **self-join** any listed playbook as PMU. Contributors are added only by an admin. Admins are **not** implicitly contributors (an admin can add themself).
2. History sent to the model is capped at about 40 turns. `context` and job states carry the longer memory, including across "Start a new conversation".
3. Job codes are fixed once created. Removing a job is a form-only action with a confirm.
4. Additions to the spec's data model: `playbooks.description`, `playbooks.listed` and `updated_by`; `playbook_members.id`; `companion_messages.ui`; `body.recurs`; `sequence.framework` (stages, areas and types for the contributor Jobs map only).
5. The Jobs list groups each job under the phase where it first appears. With the new HTML, every job has a phase.
6. Prompt caching uses the default 5-minute TTL. The model stays `claude-sonnet-4-6`. The playbook prompt was measured in Slice 0: the raw playbook JSON is 40,382 tokens, and the rendered markdown will be smaller (measured in Slice 2). With the 13,707-token source, the cached prefix is about 45–55k tokens.
7. The flag is read at build time (`NEXT_PUBLIC_`), so it is set per Vercel environment, not toggled at runtime.

## Conflicts between the spec and the repo
1. **Concept note file name:** it is `docs/design/Cube 2.0.md`, not `cube2-concept-note.md`. Where it differs from the spec (health checks, proactive suggestions, connecting people, the framework dimensions shown to users), the spec wins and those are out of scope.
2. **"Reuse the shared streaming code":** there is none. Streaming is inlined per branch. I add a small helper used only by companion-v2 and leave the existing branches alone.
3. **New patterns** with no precedent in the repo: a feature flag, Supabase Storage with direct browser uploads, `security definer` functions (including `save_playbook` as the single write path), and prompt caching.
4. **`logConversation`** sends every non-library chat to Google Sheets. That conflicts with "uploaded files are not stored" (so it is turned off for contributor turns) and arguably with anonymity. Resolved: companion-v2 never calls it (Decision 3).
5. **The HTML has no `how_summary`.** Each job's `how` is 2–11 bullets (S4 has 11), so the "short how" is not always short. 15 of 40 jobs carry maturity. Purpose, Based on and Credits are hard-coded markup, not data.
6. **PMU Owns rule:** the HTML treats "Quality PMU" as PMU-owned, in addition to the spec's PxD, PMU and the Nodal Officer's team. I'll keep the HTML's tags as exported.
7. **Spec data model:** `playbook_members` has no `id`, but `member_job_states.member_id` needs one.
8. **Per-playbook contributor vs Cube 1.0's global `pathway_contributor` role:** these are independent. A Cube 1.0 contributor is not a Cube 2.0 contributor.
9. **Commits: resolved.** `CLAUDE.md` now says to stop after each slice and commit only on your "commit".
10. **`CLAUDE.md` line 1** has a stray `“` and no line break before the title. This is cosmetic, and I'll fix it only if you want.
11. **The existing low-resource pathway `.md`** in `content/wiki/pathways/` uses Cube 1.0 framework sections, so it cannot serve as the source document.

## Review notes on the revision (2026-11-05)

You agreed with all of these on 2026-11-05. Notes 2–10 stand as written:
- the contributor ceiling stays at 8,000 tokens unless the project turns out to be on Pro;
- `CLAUDE.md` now says the admin page gains one panel, and that commits wait for your "commit".

1. **Daily cap: resolved (your decision, 2026-11-05).** You chose the server-side counter (`companion_usage` plus `bump_companion_usage()`) over counting stored messages, which direct API calls and failed turns could get around. It now also caps contributor turns, at a default of 40 a day. That limit is my assumption; change it if you like.
2. **Max tokens: 16,000 vs 8,000.** I lowered the contributor ceiling to 8,000 so a reply fits inside Hobby's 300 s limit. If the non-production project is on Pro, we can raise `maxDuration` to 800 and go back to 16,000. Please confirm which plan it is.
3. **"Admin page" is listed as unchanged in `CLAUDE.md`,** but the plan adds a "Playbook contributors" panel to `/admin`. Either `CLAUDE.md` should say the admin page gains one panel, or contributor assignment should move to a separate page. I suggest updating `CLAUDE.md`.
4. **The save route has gone.** With `save_playbook` as an RPC there is no `/api/playbooks/[id]/save`. The content guards had to move into SQL, because a browser can call the RPC directly. That makes them the real enforcement, and `patch.ts` is now only early feedback. This is consistent, but it means guard rules live in two places, SQL and TS, and must be kept in step.
5. **Contributors lose direct write access.** Under RLS, contributors can no longer insert, update or delete `playbooks` or `playbook_jobs` directly; everything goes through `save_playbook`. That is intentional, because otherwise the atomic check could be skipped. But the original matrix said "+ update", so the spec's RLS line ("contributors … write content") is now satisfied only through the function.
6. **The round-trip check holds only right after seeding.** Byte-identical export depends on the serializer producing a stable key order and on nothing being edited in between. Once a contributor saves, the checked-in JSON is expected to differ (item 10 of your list). This is not a problem, but it shouldn't be mistaken for a regression later.
7. **`record_companion_turn` is an addition you didn't ask for.** Without it, "nothing is stored half-way" can't be guaranteed, because messages, context and job states would be three separate writes. I've included it. It is `security invoker`, so RLS still applies.
8. **Uploads and the 100 MB limit.** Direct upload is right for size, but the Supabase Free plan's 50 MB global cap still applies (Remaining check). The bucket-level 100 MB setting can't exceed the project's global limit.
9. **Spec section 6 says "for very large files, process in sections"; the plan chunks at about 120k characters per call.** Each chunk sees the playbook as it was before any proposal, so two chunks can propose conflicting edits to the same field. The plan flags overlaps but doesn't merge them. That is acceptable for a test, but worth knowing.
10. **Commit cadence.** This is still open: `CLAUDE.md` says commit after each slice, and you've asked me to wait for "commit". The plan follows you.

## Decisions (your answers, 2026-11-05)
1. **Source document:** `Adoption_Package_India_Rebuild_31_Aug_2026.md`, already clean. Images are left out, the DC checklist is not included, and the headings stay as they are.
2. **How summary:** no separately written summary. `how_summary` is the HTML's `how` bullets as they are.
3. **Google Sheets:** no logging for companion-v2.
4. **Anonymity:** adopters show only as "User". There is no pseudonym number and no sign-up line.
5. **Continuity:** "Start a new conversation" is available, and it keeps the context.
6. **Access:** any signed-up user can open any listed playbook. No invites.
7. **Free text in transcripts:** OK for the test.
8. **Environments:** non-production Supabase and Vercel projects exist. Migrations go there first, and `NEXT_PUBLIC_CUBE_VERSION=2` is set on the non-production Vercel.
9. **Chips:** final as drafted.
10. **Assets:** 100 MB and any file type.

## Remaining check
- **Supabase Storage upload limit:** the Free plan caps a single file at 50 MB. Pro allows a larger global limit, set in Dashboard → Storage → Settings. Please check the plan for both projects; on Free, the 100 MB limit falls back to 50 MB.
