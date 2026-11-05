# Cube 2.0 (test version): Spec

Status: draft for planning. Built as a modification of the Cube 1.0 repo on branch `cube-2`, not a rewrite.
Source concept: Diffusion Cube 2.0 Concept Note. First playbook: *Low-resource language AI adoption* (EkStep package, CC BY 4.0).

## 1. Goal

A simple, good-looking companion that helps a first-time adopter do the jobs of an AI adoption, using one playbook. A contributor can keep the playbook current, add assets, and see how adopters use it.

Success for this test: a first-time PMU can sign up, say where they are, and get clear next steps and good answers without knowing anything about the playbook or the framework.

## 2. Decisions already made

1. Access only after sign-up. Sign-up, login, OTP and reset work as in Cube 1.0.
2. Left nav: hide Explore, Analyse, Contribute (behind a flag). Show one item, "Companion". It shows the playbook(s) on the right panel. Opening one opens the workspace.
3. One adopter role for now: **PMU**. Store it per member so more roles can be added later. PMU is responsible for tracking **all** jobs: it owns the jobs where the DC meeting checklist names PxD, PMU, or the Nodal Officer's team as the owner, and tracks every other job. The Nodal Officer is a separate role, not part of the PMU, so jobs the Nodal Officer owns are tagged Tracks. Each job lists who owns it and who tracks it (PMU tracks every job for now). A user's Owns or Tracks tag is derived: Owns if their role is in the job's owners, Tracks if it is in tracked_by.
4. Contributors are configured per playbook.
5. Contributors see adopter conversations **anonymously**: every adopter is labelled "User", with no pseudonym number, name, email or user id. There is no sign-up notice. Free text that adopters type stays visible to contributors; this is accepted for the test.
6. Playbook edits go live immediately. No version history or revert in v1; the contributor's review of the diff before Apply is the safeguard.
7. Contributors can upload files and ask Cube to update the playbook and source document from them (proposal, then Apply), as well as edit by hand.
8. Assets can be uploaded files or links.
9. Adopter UI is two screens: **Home** and **Jobs**. Assets appear inside each job. No jobs map for adopters.
10. Users are first-timers. They know nothing about the playbook or the framework.
10b. Chats on `companion-v2` are not logged to Google Sheets, for adopters or contributors.
10a. Contributors get an "Update with Cube" tab: a chat that proposes playbook changes as a diff. Contributor chats are not saved in v1.
11. No embeddings or retrieval in v1. The whole source document is loaded into the prompt.
12. v1 captures the adopter's journey in a light form: job states recorded from the conversation and shown as markers in the Jobs list (section 8). No separate journey screen, timeline or summary yet.
13. Naming: the tables `assets`, `companion_conversations` and `companion_messages` carry no "playbook" prefix, so they can later serve a pathway as well as a playbook. The new chat mode and prompt file are `companion-v2`. Cube 1.0's `companion` mode is left untouched.
14. Anthropic account status is taken care of.

## 3. Knowledge model: three separate things

| Part | What it is | Used for |
|---|---|---|
| **Structured playbook** | Jobs map, sequence and hard rules, overview (purpose, context, based on, key insights, credits). Per job: intended result, why it matters, a short "how" summary, when, checklist tasks (owner and timing), roles, gaps, maturity | What to do next, who, when, why. The jobs list for adopters. A baseline "how" for every job. |
| **Source document** | One living document (markdown), starting from the source package | Depth on "how" and answers to follow-up questions. Loaded whole into the prompt (cached). |
| **Assets** | Reusable files or links (templates, sheets, guides), tagged by job, each with a short description | Shown inside the relevant job and offered in chat when relevant. |

The sequence follows the 13 stages of the DC meeting checklist (Stage 0 to Stage 12) with their timings, preceded by a Readiness step from the playbook itself.

Rules:
- Sequencing, "when" and "what next" come from the structured playbook only.
- "How" starts from the job's short how summary, then goes deeper using the source document.
- If the source document and the playbook disagree, the playbook wins for sequencing, and Cube tells the user plainly that the sources differ.
- Answers do not need to cite the document. If neither the playbook nor the source document covers a question, Cube says so plainly. It never fills the gap with general AI knowledge. Because the whole source document is in context, this statement is reliable.
- Content that was meant to be removed before publication (e.g. "Only for Author" sections) must not be in the source document.
- Keep CC BY 4.0 attribution to EkStep in the overview's Credits card.
- Cube sees only the title, description and job tags of an asset, not its contents. Contributors should write good descriptions.
- Uploaded update files are not loaded into the prompt and are not stored. Their text is extracted in the browser and used once to generate a proposal (section 6). Their content reaches Cube only after a contributor applies a proposal that merges it into the source document or playbook.
- Size: the source document should stay under a cap (set after measuring the package; start at roughly 100k tokens). The editor warns when it nears the cap. If it outgrows the cap, add retrieval then (pgvector in Supabase is the planned route). Do not build it now.

## 4. Data model (migrations from `0034`)

- `playbooks`: id, slug, title, overview (jsonb), roles (jsonb: the role cards with name, group, description, example), sequence (jsonb: phases and hard rules), source_doc (text, markdown), updated_at.
- `playbook_jobs`: id, playbook_id, job_code, name, stages (text[]), work_area, job_type, body (jsonb: intended_result, why_it_matters, how_summary, when, tasks [{stage, timing, owner, text}], roles {owns, does, reviews, enables}, owners [role names, PMU first where it owns], tracked_by [role names; PMU for every job], owner_note, gaps, maturity), position.
- `assets`: id, playbook_id, title, kind (`file` | `link`), storage_path, url, description, job_codes (text[]), added_by, created_at. A `pathway_id` column is added later when pathways need assets; no rename needed.
- `playbook_members`: user_id, playbook_id, member_role (`adopter` | `contributor`), project_role (default `PMU`). There is no pseudonym column.
- `member_job_states`: member_id, job_code, state (`discussed` | `in_progress` | `done` | `skipped`), note (one line, in the user's words), updated_at, set_by (`cube` | `user`). No row means not discussed.
- `companion_conversations`: id, member_id, playbook_id, context (jsonb: stage, location, what's done so far), started_at. A `pathway_id` column is added later.
- `companion_messages`: id, conversation_id, role, content, created_at.

Update proposals are not stored. The API returns the proposal, the browser holds it until the contributor applies or discards it.

RLS: adopters read playbook content, assets and their own conversations; contributors of a playbook additionally write content and assets and read anonymised conversations; admin manages memberships.

## 5. Chat

New `mode: "companion-v2"` in `/api/chat`. It does not use the grid or flows.

Cube 1.0 already has a mode called `companion` (used by `/analyse` and `/contribute`). Do not change or rename it. Add `companion-v2` as a separate branch in the route with its own prompt builder and its own client hook, and reuse the shared streaming and auth code only.

Prompt builder (in `lib/system-prompts.ts` or a new file) takes: the structured playbook, the source document, the asset list (title, description, job tags), and the user's intake context and project role. The prompt text lives in `content/companion-v2.md` so it can be edited without code. Use prompt caching for the playbook and source document.

Response ends with a `<ui_action>` JSON block, parsed and stripped by the client (same pattern as `<grid_update>`). The model never writes to the DB.
Fields: `focusJobs` (job codes to show as cards in the chat), `openJob`, `showAssets` (asset ids), `context` (updates to what we know about the adopter's situation), `jobUpdates` (list of job code, state, one-line note; see section 8).

Prompt rules:
- Plain language. No "work area", "job type" or other framework terms. Stage names only if the user needs them.
- On the first visit, open by asking 2 or 3 short questions, one at a time (where are you, what's done so far, what's your part). Save the answers as `context`.
- Start from the user's situation. Offer the next 2 to 3 steps. Ask short questions, one at a time.
- Roles and "when" for each step come from the structured playbook. For a PMU user, say whether PMU owns or tracks the job and who owns it. Where the playbook does not state an owner, say so. Do not guess.
- Say how well supported something is (maturity, thin evidence, one adoption).
- Offer an asset when one fits the job being discussed.
- Do not narrate the playbook structure.

## 6. Contributor: update from files

1. Contributor uploads one or more files (PDF, Word, etc.) and clicks "Update the playbook from these files". Text is extracted with `lib/extract-text.ts`.
2. The model receives the current playbook, the current source document and the new file text. It returns a proposal: (a) edits to the source document by section, (b) changes to jobs (for example how summary, gaps, maturity), and (c) any point where the new file contradicts what exists.
3. The contributor sees the diff and the flagged contradictions, can edit or drop items, and clicks Apply.
4. Apply writes the changes live. Discard throws the proposal away. There is no history or revert in v1.

The model proposes; the client writes to the DB. For very large files, process in sections.

## 6a. Update with Cube (contributor chat)

A tab where contributors change the playbook by typing, like editing it in a conversation.

- Same `companion-v2` route with a role switch and its own prompt, `content/companion-v2-contributor.md`. The model sees the full playbook and the source document.
- Cube replies with a **patch**: a list of operations, for example edit a field of a job (how, why, when, gaps, owners, tracked_by, maturity, checklist tasks), edit the overview, roles, sequence or hard rules, or edit a section of the source document. The client shows the patch as a diff; Apply writes it live and Discard drops it. The model never writes to the DB.
- Changing job roles, the Owns or Tracks tag and checklist tasks is part of editing a job.
- Cube asks one short question when a request is ambiguous and never applies anything silently. There is no version history, so the diff is the safeguard.
- Large restructures are better done as several smaller patches, with the form editor, or by rebuilding from a new file.
- Contributor chats are not saved in v1. The conversation viewer shows adopter conversations only.
- "Update from files" (section 6) is the same flow with uploaded file text as the input.

## 7. UI

Calm light theme, one main column. Reuse the palette and job cards from the playbook HTML prototype. Use the `frontend-design` skill. The contributor's Playbook view is a port of the playbook HTML (Overview, Roles, Jobs map and Sequence tabs, with the job drawer) with edit controls added. The adopter's Jobs list is a simpler view and has no Roles tab or jobs map.

**Adopter (2 screens)**
1. **Home**: the chat, with 4 chips as quick starters: "Where do I start?", "What do I own, and what do I only track?", "How long will this take and what will it cost?", "What usually goes wrong, and how do I avoid it?". Spare options: "What should I do in the next two weeks?", "Who does what?", "What do I need before I can start collecting data?". There is no intake form; Cube asks the first questions in the chat. Next-step cards appear inline in the chat.
2. **Jobs**: the jobs for the user's role, in sequence order, each with a small state marker. Tapping a job opens its detail: what, why, when, a short how, the checklist tasks (with owner and timing; guidance only, no status), who is involved, the assets for that job (files and links), the user's state and note (editable), and an "Ask Cube about this job" button that opens the chat with that job in focus.
   - For PMU, all jobs are listed. Each shows **Who owns** (PMU in bold where it owns) and **Who tracks**, an Owns or Tracks tag for the user's role, and a one-line note on the basis. A toggle switches between all jobs and only the jobs PMU owns.
   - For roles added later, the same rule applies: a job appears for a role if the role is in its owners or tracked_by.
   - Assets with no job tag appear in a small "General resources" section at the bottom of the list.

**Contributor** sees the adopter screens (to try the companion) plus:
- **Playbook**: tabs for Overview, Roles (who does what, as cards grouped by type, each linking to the jobs it owns), Jobs map and Sequence. Click a job, a role, the overview or the sequence to edit it with a form. Saves go live. Jobs with no owner named carry a small flag.
- **Update with Cube**: the contributor chat (section 6a), with 4 chips: "Edit a job", "Edit the overview, roles, sequence or rules", "Edit the source document", and "Update from files" (opens the file upload).
- **Source document**: view and edit; "Update from files" with the diff and Apply step.
- **Assets**: upload files or add links; write a description and tag jobs.
- **Conversations**: read-only, anonymous.

## 8. Journey capture (light, v1)

Purpose: reflect the adopter's own journey back to them, and start collecting first-hand journey data. It is a reflection, not a tracker.

- Cube returns `jobUpdates` in `<ui_action>` only when the user has said something that shows a job's state. The client upserts it into `member_job_states` with `set_by = cube`. User corrections from the job detail set `set_by = user` and are never overwritten by Cube.
- Prompt rules: record a state only from what the user said, never from Cube's own guess. "Not discussed" is different from "not done": show no marker, never a gap or warning.
- The note is one short line in the user's words (what happened, what was decided).
- Do not add due dates, assignees, reminders, progress percentages or status-reporting prompts. If a feature needs one of these, it is a tracker and out of scope.
- Later (not v1): a timeline of decisions, setbacks and lessons, and a shareable "where you are" summary. With the adopter's consent, journeys can become first-hand material for the playbook.

## 9. Product rules carried over from Cube 1.0

- Say how well supported something is. Do not overstate; one adoption is one adoption.
- Absence is stated plainly, never backfilled from general knowledge.
- A gap is a question, not a conclusion.
- Honest, not flattering.

## 10. Out of scope for this test

Jobs map for adopters, journey timeline and "where you are" summary (the capture and markers are in v1), version history and revert, stored proposals, multiple roles beyond PMU, multiple playbooks beyond the list, pathway-scoped companion data (naming is ready for it), retrieval and embeddings, document citations in answers, rate limiting, PII screening, notifications, cross-pathway synthesis, success metrics dashboards.

## 11. Open items

- Export the playbook as JSON from the HTML prototype (jobs, sequence, overview).
- Prepare the source document as clean markdown (remove "Only for Author" content) and measure its size against the cap.
- Confirm the drafted chips for adopters and contributors (section 7).
- Review the Owns tags that rest on a single checklist item inside a larger job (for example Understand the language community, Measure progress, Keep improving, Decide at the gates). Release to the open commons is tagged Tracks. Each job's note says which item the tag rests on.
- The playbook and the DC checklist give different figures for the telephony share (50% vs at least 25%), the minimum volume (about 300 hours and 200K pairs vs about 60-100 hours and 25,000-40,000 sentences) and studio recording (20 hours in total vs 5-10 hours per speaker). Both are shown in the playbook and the companion should present both until a contributor settles which applies.
- Three jobs have no checklist tasks (Set goals and the output tier, Design the voice experience, Secure funding) because the checklists name no owner for them.
- Check in testing how often Cube infers a job state wrongly; adjust the prompt before building anything more on top of it.
