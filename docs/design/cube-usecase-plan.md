# Cube: use cases as the primary entity (plan)

Status: agreed 2026-11-23, not started. Branch `cube-2`, development Supabase project only.

## Goal

Bring the Cube connector's model (use cases, journeys, notes, documents, allowlist) and the Cube 2.0 Companion (playbooks) together into one model, used through two channels: the web app and the connector.

- A **use case** is the primary entity. It may have **one playbook**, or none.
- People see and converse on the use cases they can read. Answers come from the use case's sources (notes and documents), as through the connector, plus its playbook where there is one.
- Access comes only from the use case's **allowlist** and `open_to_all`. Separate playbook adopter and contributor memberships go away.
- The **Digest** covers questions from both the web app and the connector.

## Decisions

| # | Decision |
|---|---|
| 1 | Three access levels on `use_case_members.access`: `read` (converse, search, read), `write` (+ save notes, add documents), `curate` (+ edit the playbook and assets, see the Digest). `curate` replaces today's playbook contributor. |
| 2 | No join step. Read access is the allowlist (any level) or `open_to_all`. Nothing in the app adds people to the allowlist; the admin sets it with SQL. |
| 3 | No per-person role. Jobs show who owns and who tracks them; people filter the Jobs list by owner. Answers say who owns a job ("PMU owns it; the Nodal Officer tracks it"), never "you own it". |
| 4 | No job markers. `member_job_states` and the journey-capture rule (`jobUpdates` in `<ui_action>`) are removed. The Jobs screen lists jobs; Cube doesn't record progress. |
| 5 | One playbook per use case (`playbooks.use_case_id` unique and required). |
| 6 | The playbook is the source of jobs, their sequence, owners and the job details. Where a source disagrees on sequencing, the playbook wins and Cube says so. |
| 7 | The playbook's hidden "detailed guidance" (`playbooks.source_doc`) becomes an ordinary document of the use case: searched by passage, cited, never edited in place. Curators edit only the structured playbook (overview, roles, jobs, sequence, rules) and assets. |
| 8 | Web answers cite their sources: a note by author, journey and date; a document by its title; jobs and sequence as "the playbook". |
| 9 | People with write access can save notes from the web app (channel `web`), through the same save path as the connector. |
| 10 | Access is checked in server code with the service-role client and one shared helper, as in the connector, instead of per-user database rules. Browser-side reads and writes of Cube tables move behind server routes. |
| 11 | The Digest takes in web conversations, connector searches (`cube_tool_calls`) and unanswered questions (`cube_questions`), anonymous as today. |
| 12 | Existing playbook adopters are added to their playbook's use case allowlist as `read`, so nobody's exposure changes. `open_to_all` is decided per use case separately. |
| 13 | Gaps found in the web app are also written to `cube_questions`, so curators see one list (and `cube_open_questions` shows both channels). |
| 14 | Note structuring is copied into the app (`lib/cube-structure.ts`), as was done for metadata, and kept in step with `cube-connector/src/structure.ts`. |
| 15 | The Digest covers everyone's conversations and searches on the use case, curators' included. |

## Later (not in these stages)

- **Removing a document.** With the guidance now a document, a revised version can only be added next to the old one, and answers could quote both. A "remove document" for curators comes later.

## Model changes

### Schema (migration `0041_cube_use_case_model.sql`)

- `use_case_members.access`: allow `'curate'` (check becomes `read | write | curate`).
- `use_cases.slug`: unique, URL-safe, for `/companion/<slug>`. Backfilled from the name.
- `playbooks.use_case_id`: `not null` and `unique`. Before applying, every playbook must be linked to exactly one use case (on dev, check the "Connector test playbook").
- Data moves (in the migration, idempotent):
  - each playbook contributor → `use_case_members` row on the playbook's use case with `access = 'curate'` (email from `auth.users`);
  - each current adopter → `read` row (decision 12);
  - each non-empty `playbooks.source_doc` → a `raw_sources` row titled "<playbook title> – detailed guidance", with its passages (embedded later by "Embed pending").
- Access functions: `cube_writable_use_case_ids` counts `write` and `curate`; new `cube_curating_use_case_ids`. `cube_curated_playbooks` and `cube_use_case_curators` are redefined from `access = 'curate'` instead of `playbook_members`, so the connector's `is_curator` and team activity follow.
- Kept until stage 7 (so stage 1 can be rolled back): `playbook_members`, `member_job_states`, `playbooks.source_doc`, the old row rules.

### Shared access helper (`lib/use-case-access.ts`)

`useCaseAccess(email, useCaseId)` → `null | 'read' | 'write' | 'curate'`, and `readableUseCases(email)`, from `use_case_members` and `open_to_all`. Every server route and page uses it. The connector keeps its own copy of the same rules (`scope.ts`); `curate` counts as write there.

## Stages

Each stage ends with a stop for you to test, then `qa-tester` and `code-reviewer`, and a commit when you say "commit".

### Stage 1: model and access

Migration 0041 and its data moves, the access helper (`lib/use-case-access.ts`, used from stage 2), the connector following the new levels (`curate` = write + `is_curator`). The web app doesn't change: it keeps using `playbook_members` until stages 2–3. A playbook with no use case gets a new use case named after it, with the playbook's slug.

Order: deploy and run 0041 in either order (a short gap where curators are read-only in the connector is accepted). Then press "Embed pending" for the guidance passages.

Test: the before/after access query; connector tools behave as before for every kind of caller, with former contributors now `curate`; the guidance documents appear on the Documents page and are found by search.

### Stage 2: Companion data behind server routes

Replace every browser-side read and write of Cube tables with server routes that check the helper:

| Today (browser, user's session) | Becomes |
|---|---|
| `RecentConversations.tsx`: list and delete conversations | `GET/DELETE /api/companion/conversations` |
| `use-companion-chat.ts`, `use-contributor-chat.ts`: create conversations, save messages | `POST /api/companion/conversations`, `.../messages` |
| `lib/companion-v2/assets.ts`, `AssetsManager.tsx`: add, edit, delete assets | `POST/PATCH/DELETE /api/companion/assets` (curate) |
| `AssetLink.tsx`: asset file download | signed URL from `GET /api/companion/assets/<id>/file` |
| `JobSheet.tsx`, `use-companion-chat.ts`: job markers | removed (decision 4) |

The server code in `lib/companion-v2/server.ts` and `handler.ts` switches from `playbook_members` to the helper.

Test: every Companion screen works as before for an adopter (`read`) and a contributor (`curate`); someone without access sees nothing.

### Stage 3: use case list and home

- `/companion`: the use cases the person can read ("Your use cases"), each showing whether it has a playbook.
- `/companion/<use case slug>`, tabs by access:
  - **Converse** (everyone)
  - **Jobs** (when there's a playbook): all jobs in sequence order, each with who owns and who tracks it, filter by owner; job detail as today, without markers
  - **Documents** (write and curate): upload and list (moves from `/admin/documents`; admins keep it there for every use case)
  - **Playbook**, **Assets**, **Digest** (curate), as today's contributor tabs
- Old `/companion/<playbook slug>` links redirect to the use case.

Test: each access level sees the right tabs; a use case without a playbook shows Converse and, for writers, Documents.

### Stage 4: conversation grounded in the use case

- Every turn: embed the question, retrieve passages and notes with `cube_search_passages` over this use case, and put them in the prompt with their source labels. With a playbook, the structured playbook stays in the (cached) prompt as the authority on jobs and sequence; `source_doc` is no longer loaded whole.
- Answers cite notes, documents and "the playbook" (decision 8). Absence is stated plainly; no general knowledge.
- `<ui_action>`: `jobUpdates` removed; `gap` also written to `cube_questions` (decision 13); new `noteOffer` (a one-line note Cube proposes to save). On the person's yes, `POST /api/companion/notes` saves it through `cube_save_note_raw` with channel `web`, adds its passage and embedding, and structures it (decision 14). Writers only.
- Contributor chat: proposes changes to the structured playbook only; the "Playbook → detailed guidance" changes and "update from files" edits to the guidance go away.
- Prompts: `content/companion-v2.md` and `content/companion-v2-contributor.md` updated for retrieval, citations, no roles ("who owns", not "you own") and no job markers.

Test: questions answered from notes and documents with correct citations; the playbook wins on sequencing; a gap appears in `cube_questions`; a note saved from the web is found by the connector straight after.

### Stage 5: documents for writers

Upload under the use case for `write` and `curate` (stage 3 shows the tab; this stage moves the routes from admin-only to the helper). Metadata checks and embedding as today. Removing documents comes later.

Test: a `read` person can't upload; a writer can; duplicates are still caught.

### Stage 6: Digest across channels

- Numbers (SQL): conversations and questions from the web app, connector searches per tool, searches that found nothing, unanswered questions from both channels, notes added per channel.
- AI digest input: web questions (as today) plus connector search text and logged questions, all anonymous. `content/companion-v2-digest.md` updated to say where each came from.
- Covers everyone's conversations and searches, curators' included (decision 15). `can_run_digest()` becomes "has curate on the use case".

Test: a connector search and a web question in the same week both appear in the Digest; no names or emails.

### Stage 7: clean-up

Drop `member_job_states`, `playbook_members`, `playbooks.source_doc`, the old row rules and functions (`is_playbook_member`, `is_playbook_contributor`), and the job-marker code (`StateMarker`, marker parts of `JobSheet` and the hooks). Update `CLAUDE.md` (Cube 2.0 section), `docs/design/cube2-plan.md`, the connector README and the cube-claude-kit skills.

## Unchanged

- Cube 1.0 (Explore, Analyse, Contribute) and its `companion` mode.
- Auth, `proxy.ts`, `lib/roles.ts` (account roles), deploy.
- The connector's tool names and behaviour, apart from `curate` counting as write and `is_curator` coming from `curate`.
- Product rules: plain language for first-timers, absence stated plainly, never fill gaps from general knowledge, the playbook-vs-checklist differences shown, CC BY 4.0 attribution to EkStep, content marked "Only for Author" never stored as a document.

## Risks

- **Access regressions in the move off `playbook_members`.** Mitigation: stage 1 keeps the old tables, and its test compares every existing person's access before and after.
- **Retrieval missing what the whole guidance gave.** Mitigation: compare answers to the same questions before and after stage 4; raise the number of passages retrieved if needed.
- **Two copies of structuring and metadata code** (app and connector). Mitigation: same field lists and prompts, a note in each file to keep them in step.
