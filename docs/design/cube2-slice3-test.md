# Cube 2.0 Slice 3: manual test script

Branch `cube-2`. This covers what Slice 3 delivers (see `docs/design/cube2-plan.md`, "Slice 3",
section 6 and the "Recent conversations" bullet in section 4, Client):

- the adopter **Jobs** screen (`app/companion/[slug]/jobs/page.tsx`,
  `components/companion-v2/JobsView.tsx`): all jobs in sequence order, Who owns / Who tracks,
  the Owns or Tracks tag, state markers (`StateMarker.tsx`), the **All jobs / Only mine** toggle and
  **General resources**;
- the **job sheet** (`JobSheet.tsx`, opened with `?open=CODE`): sections, checklist, the user's own
  state and note editor, assets (`AssetLink.tsx`) and **Ask Cube about this job**;
- in the Home chat (`CompanionChat.tsx`): job cards that open the sheet, `openJob` shown as a card,
  asset chips;
- the sidebar's **Recent conversations** (`RecentConversations.tsx`, `components/Sidebar.tsx`) with
  open (`?c=<id>`) and delete, and the hook changes behind it
  (`lib/companion-v2/use-companion-chat.ts`).

**Already checked automatically, so not repeated here:** `tsc`, lint, build, and 80 PGlite RLS
checks (a user can delete their own conversation, its messages cascade and their job states stay; a
user can set and clear their own job state; other users can't do either). This script covers what
needs a real browser, a real Supabase session, Storage and the model.

**Not covered here, because later slices build them:** the contributor Playbook, Assets, Update
with Cube, Source document and Conversations screens (Slices 4a to 5). Assets are inserted by SQL
for now. The contributor's anonymous list is checked through its SQL function
(`contributor_list_conversations`), not a screen.

**Cost.** The required steps make about **8** Anthropic calls; the optional ones add about 4 more.
Every call counts toward the daily cap (default 60). Per the Product Charter, the Anthropic account
in `.env.local` was a free trial due to expire on **28-Oct-2026** (TD-16), which is already past. If
**every** call fails with a 401 or 403, check the account before recording failures.

---

## 0. Before you start

### 0.1 Safety check: are you pointed at the TEST project?

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local
git branch --show-current
```

| Expected | Pass/Fail |
|---|---|
| The project ref matches the **test** project. The branch is `cube-2`. **If the ref is production, stop here.** | |

### 0.2 `.env.local` and the dev server

`NEXT_PUBLIC_CUBE_VERSION=2` is set. `COMPANION_DAILY_MESSAGE_CAP` and
`COMPANION_V2_FAIL_AFTER_CHARS` are **not** set. Start `npm run dev`. The terminal is the
**dev-server log**: each model call prints one `[companion-v2] stop=... in=... cache_read=...`
line. No line means no model call.

### 0.3 Test accounts (same as Slice 2)

| Name | Purpose | Roles |
|---|---|---|
| **A** | Admin | Listed in `ADMIN_EMAILS` |
| **B** | Main adopter. Has the Slice 2 conversations and job states. | `adopter` |
| **C** | Contributor to the main playbook. Uploads the test file and adds assets. | `adopter`, `playbook_members.member_role = contributor` |
| **D** | Second adopter, used as "another user". Has the Slice 2 conversations (`<D_CONV>` and two empty ones). | `adopter` |
| **P** | Pending user (no roles). Optional, step 5.9 only. | none |

If Slice 2's clean-up deleted D or P, create them again as in Slice 2 step 1.3, and for D open the
playbook once (one greeting call) and send `Where do I start?` (one call).

Use **two browsers** (or a normal and a private window): one for B, one for C or D.

### 0.4 Values to fill in as you go

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>`, `<TEST_ID>` | | 1.1 |
| `<A>`, `<B>`, `<C>`, `<D>`, `<P>` (user ids) | | 1.2 |
| `<B_MEMBER>`, `<D_MEMBER>` | | 1.2 |
| `<D_CONV>` (D's conversation that has user messages) | | 1.5 |
| `<FILE_ASSET_ID>` | | 5.1 |
| `<LINK_S4_ID>`, `<LINK_GENERAL_ID>` | | 5.3 |
| `<QA_CONV>` (injected conversation for cards and chips) | | 6.1 |
| `<NEW_CONV>` (from "Start a new conversation") | | 7.4 |
| `<QA_EMPTY>` (empty conversation for the switch test) | | 7.7 |
| `<B_TEST_CONV>` (B's conversation on TEST COPY, optional) | | 7.8 |
| `<QA_CONV2>` (throwaway for the delete test) | | 9.4 |

### 0.5 SQL in the Supabase SQL Editor

Same rules as Slice 2, section 0.6:

- Blocks marked **"as postgres"** run as the superuser (RLS ignored), for setup and checking.
- **"Impersonating X"** blocks run as that user, so RLS applies:

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
  -- statements
  rollback;   -- or commit; when the step says so
  ```

- The editor shows only the **last** statement's result.
- `current transaction is aborted` → run `rollback;` on its own and carry on.

### 0.6 The "snapshot" query (as postgres)

```sql
select
  (select count(*) from companion_conversations where member_id = '<B_MEMBER>')       as conversations,
  (select count(*) from companion_messages m
     join companion_conversations c on c.id = m.conversation_id
     where c.member_id = '<B_MEMBER>')                                                 as messages,
  (select string_agg(job_code || '=' || state || '/' || set_by, ', ' order by job_code)
     from member_job_states where member_id = '<B_MEMBER>')                            as job_states,
  (select max(updated_at) from member_job_states where member_id = '<B_MEMBER>')      as states_last_change,
  (select count from companion_usage
     where user_id = '<B>' and role = 'adopter'
       and day = (now() at time zone 'utc')::date)                                     as usage_today;
```

### 0.7 The "list" query: what B's sidebar should show (as postgres)

Mirrors `RecentConversations.tsx`: newest activity first (`updated_at`), at most 30, labelled by
the first user message with whitespace collapsed and cut to 59 characters plus "…" when longer
than 60, or "New conversation" when there is no user message yet.

```sql
select row_number() over (order by c.updated_at desc) as n, c.id, p.slug,
  coalesce((select case when length(t) > 60 then rtrim(left(t, 59)) || '…' else t end
            from (select btrim(regexp_replace(m.content, '\s+', ' ', 'g')) as t
                  from companion_messages m
                  where m.conversation_id = c.id and m.role = 'user'
                  order by m.created_at limit 1) f), 'New conversation') as expected_label,
  (select count(*) from companion_messages m where m.conversation_id = c.id) as messages,
  c.updated_at
from companion_conversations c
join playbook_members pm on pm.id = c.member_id
join playbooks p on p.id = c.playbook_id
where pm.user_id = '<B>'
order by c.updated_at desc
limit 30;
```

For D, replace `<B>` with `<D>`.

---

## 1. Pre-flight

### 1.1 Playbooks (as postgres)

```sql
select id, slug, title, listed,
       (select count(*) from playbook_jobs j where j.playbook_id = p.id) as jobs
from playbooks p order by slug;
```

| Expected | Pass/Fail |
|---|---|
| `low-resource-language`: `listed true`, `jobs 40`. **Copy its id into `<LRL_ID>`.** If `test-playbook` (title "TEST COPY: …") is there, copy its id into `<TEST_ID>`; if not, reseed it as in Slice 2 step 1.2 (only needed for the optional 7.8 and 8.3c). | |

### 1.2 Accounts and memberships (as postgres)

```sql
select u.email, u.id as user_id,
       array_agg(distinct r.role) filter (where r.role is not null) as roles,
       pm.id as member_id, pm.member_role, pm.project_role
from auth.users u
left join user_roles r on r.user_id = u.id
left join playbook_members pm on pm.user_id = u.id and pm.playbook_id = '<LRL_ID>'
where u.email in ('<A email>','<B email>','<C email>','<D email>','<P email>')
group by u.email, u.id, pm.id, pm.member_role, pm.project_role
order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| B: `{adopter}`, `member_role adopter`, `project_role PMU`. C: `member_role contributor`. D: `adopter`/`PMU`. P: roles `null`, no member row. **Copy the user ids, and B's and D's `member_id` into `<B_MEMBER>` and `<D_MEMBER>`.** | |

### 1.3 The jobs as stored, with the PMU tag (as postgres)

```sql
select count(*)                                                                    as total,
       count(*) filter (where body->'owners' ? 'PMU')                               as owns,
       count(*) filter (where not body->'owners' ? 'PMU'
                          and body->'tracked_by' ? 'PMU')                          as tracks,
       count(*) filter (where not body->'tracked_by' ? 'PMU')                       as not_tracked,
       count(*) filter (where jsonb_array_length(coalesce(body->'owners','[]'::jsonb)) = 0) as no_owner,
       string_agg(job_code, ',' order by position) filter (where body->'owners' ? 'PMU') as owns_codes,
       string_agg(job_code, ',' order by position)
         filter (where jsonb_array_length(coalesce(body->'owners','[]'::jsonb)) = 0)      as no_owner_codes
from playbook_jobs where playbook_id = '<LRL_ID>';
```

| Expected | Pass/Fail |
|---|---|
| `total 40`, `owns 11`, `tracks 29`, `not_tracked 0`, `no_owner 3`. `owns_codes = S1,P1,I2,S4,I4,E4,P6,I8,I10,E10,S14`. `no_owner_codes = E3,P4,S3`. (These match `content/playbooks/low-resource-language.json`. If not, the DB was edited after seeding: the rest of this script assumes the seeded data.) | |

### 1.4 B's starting state (as postgres)

Run the **snapshot** (0.6) and the **list query** (0.7). Keep both results.

```sql
select job_code, state, set_by, note from member_job_states
where member_id = '<B_MEMBER>' order by job_code;
```

| Expected | Pass/Fail |
|---|---|
| After Slice 2: `I2 in_progress cube` and `P2 done cube` (S4 was deleted in Slice 2 step 5.4). Whatever is there, **write the rows down**: section 2.4 checks them against the screen. | |
| The list query shows several conversations from Slice 2 (the first one labelled `We're just getting started. The District Collector has aske…`, and the chip and 9.x ones). | |

### 1.5 D's conversations (as postgres)

Run the list query for D.

| Expected | Pass/Fail |
|---|---|
| After Slice 2: three rows. One labelled `Where do I start?` (**copy its id into `<D_CONV>`**), and two labelled `New conversation` with `messages 0`. | |

---

## 2. Jobs list (B)

Sign in as **B**. Companion > "Low-resource language AI adoption" > **Jobs** tab
(`/companion/low-resource-language/jobs`).

### 2.1 Header, count, order and headings

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 2.1a | Intro line | "Every job in this adoption, in the order they usually happen. As the PMU, you track all of them and own 11." (Both numbers are computed from the data: if some job weren't tracked by PMU it would read "you track N of them". 1.3 showed `not_tracked 0`, so "all of them" is right.) | |
| 2.1b | Toggle | Two buttons, **All jobs** (selected, filled) and **Only mine**. | |
| 2.1c | No framework labels | No job codes (S4, P2 …), no "work area", "job type", no stage letters or "Explore / Define / Pilot / Scale" labels, no "Stage N:" anywhere on the page. | |
| 2.1d | Nothing outside a step | No "Other jobs" heading (every job is in the sequence). | |

Devtools > Console, run:

```js
const rows = [...document.querySelectorAll('section[aria-labelledby^="phase-"] li > button')];
console.log(rows.length);
console.log([...document.querySelectorAll('section[aria-labelledby^="phase-"] h2')]
  .map((h) => `${h.textContent} | ${h.nextElementSibling?.textContent ?? ''} | ${h.closest('section').querySelectorAll('li').length}`).join('\n'));
console.log(rows.map((b, i) => `${i + 1}. ${b.querySelector(':scope > span:first-child > span:first-child').textContent} | ${b.querySelector(':scope > span:first-child > span:last-child > span:last-child')?.textContent}`).join('\n'));
console.log('bold:', document.querySelectorAll('section[aria-labelledby^="phase-"] li strong').length,
  [...new Set([...document.querySelectorAll('section[aria-labelledby^="phase-"] li strong')].map((s) => s.textContent))]);
```

| # | Expected | Pass/Fail |
|---|---|---|
| 2.1e | First line: `40`. | |
| 2.1f | **11 headings**, in this order, each with its timing and job count (headings have **no** "Stage N:" prefix): `Readiness \| Before you start \| 6`, `Readiness and language confirmation \| Week 1 \| 2`, `Team mobilisation and departmental order \| Weeks 1–2 \| 4`, `Community engagement and script and dialect decision \| Weeks 2–4 \| 1`, `Scope definition, vendor selection and work order \| Weeks 4–6 \| 4`, `Standards creation \| 1–2 months \| 2`, `Pilot collection \| About 1 month \| 4`, `Full collection, annotation and validation \| 6–9 months, in 2–3 rounds \| 10`, `Hosting and open release \| After Gate 2 \| 2`, `Application integration and field testing \| About 2 weeks, one time \| 2`, `Sustaining \| Ongoing, no exit \| 3`. | |
| 2.1g | The 40 job lines match the table below exactly, in order, with the tag shown. | |
| 2.1i | Every row has a short "when" line under the name: the **first sentence** of the job's `when`, cut to about 110 characters with "…" if longer. Console: `rows.filter((b) => !b.querySelector(':scope > span:nth-child(2)')?.textContent).length` → `0`; `rows.filter((b) => b.querySelector(':scope > span:nth-child(2)').textContent.endsWith('…')).length` → `4`. Examples in 2.2. | |
| 2.1h | `bold: 11 ['PMU']`. PMU is bold in Who owns on the 11 Owns jobs and nowhere else (Who tracks "PMU" is **not** bold). | |

**Note on 2.1f:** the playbook has 15 steps, but three of them ("Language survey", "Model building
and benchmarking", "Use-case acceptance and sign-off") introduce no new job (each of their jobs
already appeared earlier), so they have no heading. Fail if the 11 above don't match, a heading
appears with zero jobs, or one of those three appears.

**Expected list (from `content/playbooks/low-resource-language.json`, grouped by the step where
each job first appears):**

| # | Heading | Job | Tag |
|---|---|---|---|
| 1 | Readiness | Secure the champion and an institutional anchor | Tracks |
| 2 | | Secure a committed application owner | Tracks |
| 3 | | Secure funding | Tracks |
| 4 | | Map what already exists | **Owns** |
| 5 | | Choose the deployment use case | Tracks |
| 6 | | Set goals and the output tier | Tracks |
| 7 | Readiness and language confirmation | Confirm target language and starting scope | Tracks |
| 8 | | Understand the language community and the access gap | **Owns** |
| 9 | Team mobilisation and departmental order | Appoint the Nodal Officer and stand up the PMU | **Owns** |
| 10 | | Establish governance and the review mechanism | Tracks |
| 11 | | Build the validator, reviewer and coordinator pool | Tracks |
| 12 | | Design the data collection plan | **Owns** |
| 13 | Community engagement and script and dialect decision | Convene community leaders and language experts | Tracks |
| 14 | Scope definition, vendor selection and work order | Write the scope and requirements document | **Owns** |
| 15 | | Select and contract partners | **Owns** |
| 16 | | Budget and resource the effort | Tracks |
| 17 | | Design the voice experience for low-literacy users | Tracks |
| 18 | Standards creation | Set orthography and transcription standards | Tracks |
| 19 | | Set the quality bar and acceptance criteria | Tracks |
| 20 | Pilot collection | Recruit, train and pay community contributors | Tracks |
| 21 | | Secure consent and data-protection compliance | Tracks |
| 22 | | Collect speech and text | Tracks |
| 23 | | Validate and audit data quality | Tracks |
| 24 | Full collection, annotation and validation | Transcribe, translate and label | Tracks |
| 25 | | Measure progress, quality and real use | **Owns** |
| 26 | | Steer delivery and resolve blockers | Tracks |
| 27 | | Keep line departments and government stakeholders aligned | Tracks |
| 28 | | Keep the community engaged | Tracks |
| 29 | | Train, fine-tune and benchmark models | Tracks |
| 30 | | Decide at the gates and sign off | **Owns** |
| 31 | | Manage partners through delivery | Tracks |
| 32 | | Decide technology and hosting approach | Tracks |
| 33 | | Embed the service in departmental work and drive uptake | Tracks |
| 34 | Hosting and open release | Host the models | Tracks |
| 35 | | Release dataset and model to the open commons | Tracks |
| 36 | Application integration and field testing | Integrate into the live service | Tracks |
| 37 | | Field-test and accept the service | Tracks |
| 38 | Sustaining | Secure lasting ownership and continuity | **Owns** |
| 39 | | Document and share the playbook | **Owns** |
| 40 | | Capture usage gaps and keep improving | **Owns** |

### 2.2 Five jobs, row by row (acceptance: "Owns or Tracks tags that match the HTML")

Compare each row on screen with the JSON (`body.owners` includes "PMU" = Owns). Optional cross-check:
open `docs/design/low-resource-language-ai-adoption-playbook.html` in a browser, Jobs map tab, press
**PMU owns** (or Roles tab > "Show the jobs PMU owns"): the same 11 jobs.

| # | Job | Expected "when" line | Expected tag | Expected **Who owns** (PMU bold) | Who tracks | Pass/Fail |
|---|---|---|---|---|---|---|
| 2.2a | Map what already exists | "Before the project starts; Weeks 2–4 for community resources and the open-source scan; Weeks 1–2 of the lan…" (cut at about 110 characters) | **Owns** (filled pill) | **PMU**, Data Collection Agency, District Collector, Nodal Officer | PMU | |
| 2.2b | Confirm target language and starting scope | "Week 1 to confirm the language, then Weeks 2–4 for the script and dialect decision." | Tracks (outlined/soft pill) | District Collector, Nodal Officer, DC’s Office, Linguistic Expert | PMU | |
| 2.2c | Design the data collection plan | "Week 2 for the requirements study, Weeks 4–5 for the technical specification, then 2–3 collection rounds." | **Owns** | **PMU**, Nodal Officer, Data Collection Agency, EkStep | PMU | |
| 2.2d | Secure funding | "Before the first collection stage." (first sentence only; "No week is stated." is not shown) | Tracks | *No owner named in the playbook* (italic, muted) | PMU | |
| 2.2e | Field-test and accept the service | "About 2 weeks of field testing, then acceptance testing." (not "Repeats every cycle.") | Tracks | Core Application Owner, Technical Partner, Field Testers, Linguistic Expert, Engineering Teams, Independent Third Party | PMU | |

### 2.3 Only mine, and the jobs with no owner

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 2.3a | Console: `[...document.querySelectorAll('section[aria-labelledby^="phase-"] li span.italic')].map((s) => s.closest('li').querySelector('button > span > span').textContent + ' → ' + s.textContent)` | Exactly 3: `Secure funding → No owner named in the playbook`, `Set goals and the output tier → …`, `Design the voice experience for low-literacy users → …`. All three are tagged **Tracks**. | |
| 2.3b | Click **Only mine**. Re-run the 2.1 console block. | Count `11`. Every line tagged `Owns`. In order: Map what already exists; Understand the language community and the access gap; Appoint the Nodal Officer and stand up the PMU; Design the data collection plan; Write the scope and requirements document; Select and contract partners; Measure progress, quality and real use; Decide at the gates and sign off; Secure lasting ownership and continuity; Document and share the playbook; Capture usage gaps and keep improving. | |
| 2.3c | Headings in Only mine | 6 headings: Readiness (1), Readiness and language confirmation (1), Team mobilisation and departmental order (2), Scope definition, vendor selection and work order (2), Full collection, annotation and validation (2), Sustaining (3). No empty heading. None of the 3 no-owner jobs appears. | |
| 2.3d | Look at the toggle (devtools > Elements) | **Only mine** is selected (filled) with `aria-pressed="true"`; All jobs has `aria-pressed="false"`. | |
| 2.3e | Click **All jobs** | Back to 40. | |

### 2.4 State markers from the chat

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 2.4a | Rows with a state in 1.4 | Each shows a marker next to the tag, with the state's label: after Slice 2, "Confirm target language and starting scope" shows **Done** (green dot) and "Appoint the Nodal Officer and stand up the PMU" shows **In progress** (amber dot). Hover: tooltip "From your conversation with Cube". | |
| 2.4b | Every other row | **No marker at all.** | |
| 2.4c | No warnings | Nowhere on the page: "Not started", "Not discussed", "To do", "Overdue", a red or warning colour, a progress bar, a percentage, a due date or an assignee. Absence of a marker is simply nothing. | |
| 2.4d | Marker count | Console: `document.querySelectorAll('section[aria-labelledby^="phase-"] li [title^="From your"], section[aria-labelledby^="phase-"] li [title="Set by you"]').length` equals the number of rows in 1.4. | |

---

## 3. Job sheet (B)

### 3.1 Open and close

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 3.1a | Scroll down a little, then click "Design the data collection plan". | A sheet slides in from the right over a dimmed backdrop. URL becomes `/companion/low-resource-language/jobs?open=S4`. Keyboard focus is on **Close**. The page behind doesn't scroll while the sheet is open, and scrolls again after it closes. | |
| 3.1b | Press **Esc** | Sheet closes. URL back to `/jobs` (no `?open=`). The list is at the same scroll position. The page scrolls again. Focus is back on the "Design the data collection plan" row. | |
| 3.1c | Open it again, click the dimmed backdrop | Closes, as in 3.1b. | |
| 3.1d | Open it again, click **Close** | Closes, as in 3.1b. | |
| 3.1e | Open it, then press the browser **Back** button | (Observe, not pass/fail.) Opening uses `router.replace`, so Back leaves the Jobs page rather than just closing the sheet. Record what happens. | |
| 3.1f | Paste `/companion/low-resource-language/jobs?open=S4` into a **new tab** | The Jobs page loads with the S4 sheet already open (deep link works). | |
| 3.1g | Go to `/companion/low-resource-language/jobs?open=ZZ9`, then `?open=s4` | The list shows, **no** sheet, no error. | |
| 3.1h | Click **Only mine**, open "Write the scope and requirements document", close it | Still in Only mine after closing. | |

### 3.2 Sections: "Design the data collection plan" (S4)

Open `?open=S4`. Compare with `content/playbooks/low-resource-language.json`, job `S4`.

| # | Section | Expected | Pass/Fail |
|---|---|---|---|
| 3.2a | Title and tag | "Design the data collection plan", **Owns** pill, "The PMU owns this job". | |
| 3.2b | What it achieves | "An agreed volume target and speaker mix, planned as two to three collection rounds." | |
| 3.2c | Why it matters | Starts "Testing after each round reveals surprises…". | |
| 3.2d | When | "Week 2 for the requirements study, Weeks 4–5 for the technical specification, then 2–3 collection rounds." | |
| 3.2e | How, in short | 11 bullets, including both telephony figures (50% and "no less than 25%"), both minimum volumes and both studio-hours figures. | |
| 3.2f | Who owns and who tracks | Who owns: **PMU** (bold), Nodal Officer, Data Collection Agency, EkStep. Who tracks: PMU. Below: the owner note "The technical specification (…) is the Ecosystem Orchestrator’s (PxD/EkStep) item. The requirements study is the Nodal Officer’s." | |
| 3.2g | Checklist | Intro "From the district checklist. A guide to what this job involves, not a to-do list." **4 items, no checkboxes, no status.** | |
| 3.2h | Checklist meta lines (step title · timing · owner) | 1: `Team mobilisation and departmental order · Week 2 · Nodal Officer` (plain). 2: `Scope definition, vendor selection and work order · Week 4–5 · Ecosystem Orchestrator (PxD/EkStep)` (**highlighted** row background, owner in bold accent: PxD is a PMU-owned item). 3: `Timing not stated · Data Collection Vendor`. 4: `Timing not stated · EkStep`. The step titles match the list headings word for word. Neither "Stage" nor "Step" nor a number appears. The timing shown is the **task's** own timing (Week 4–5), not the step's (Weeks 4–6). | |
| 3.2i | Who is involved | Owns: *Not stated* (italic, muted). Does: "PMU works out data collection requirements (types, quantity)." Reviews: *Not stated*. Enables: "Champion co-signs the scope document." | |
| 3.2j | What the playbook doesn't cover yet | 4 bullets (the read-speech share question, smaller/larger speaker base, the volume table being an image, the figures that differ). | |
| 3.2k | How well supported | "Some figures here still need checking. Check the volume figures against the original AI4Bharat table, and against the different figures in the DC checklist." | |
| 3.2l | Resources | **Not shown yet** (no assets until section 5). | |
| 3.2m | Footer | A full-width **Ask Cube about this job** button, always visible at the bottom while the content scrolls. | |

### 3.3 Sections: two more jobs

| # | Open | Expected | Pass/Fail |
|---|---|---|---|
| 3.3a | `?open=S1` "Map what already exists" | Checklist: 5 items. Items 1 (`Community engagement and script and dialect decision · Week 2–3 · Nodal Officer’s team`) and 2 (`Community engagement and script and dialect decision · Week 3–4 · Ecosystem Orchestrator (PxD/EkStep)`) are **highlighted**; items 3 (`Language survey · Weeks 1–2 of the stage · Data Collection Agency / Vendor`), 4 (`Timing not stated · District Collector`) and 5 (`Timing not stated · Nodal Officer`) are not. (Observe: "Language survey" is a real step but has no heading in the list, because it adds no new job; see the note under 2.1. Record whether that is confusing.) **"Nodal Officer" alone is not highlighted** (the Nodal Officer is a separate role). No "How well supported" section (maturity is null). | |
| 3.3b | `?open=E3` "Secure funding" | Tracks pill, "The PMU tracks this job". Who owns: *No owner is named in the playbook.* Owner note: "No owner is named in the DC checklist or the playbook." **No Checklist section** (no tasks). Who is involved: all four *Not stated*. 3 gaps (where funding comes from, a route for later cycles, a sustaining model). How well supported: "The evidence for this job is thin. Only the checklist item and the cost reference are given." | |
| 3.3c | `?open=S13` "Field-test and accept the service" | Checklist: 10 items, **none** highlighted. Item 1: `Application integration and field testing · About 2 weeks · Core Application Owner`. Item 5: `Application integration and field testing · End of stage · Core Application Owner`. Item 6: `Use-case acceptance and sign-off · Core Application Owner` (a step but no timing: no "Timing not stated" here). Items 9 and 10: `Timing not stated · AI4Bharat`. | |

### 3.4 Switching jobs resets the editor

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 3.4a | Open S4. Under "Where you are with this", click **Done** and type `unsaved` in the note box. **Don't save.** Close. Open "Appoint the Nodal Officer and stand up the PMU". | The editor shows **that** job's state (In progress after Slice 2), its own note (if any), not "Done"/"unsaved". | |
| 3.4b | Close, re-open S4 | The unsaved choice is gone: **No marker** selected, no note box. (Observe: nothing warned you that the unsaved edit would be discarded. Record it.) | |
| 3.4c | With S4 open, edit the address bar to `…/jobs?open=I2` and press Enter | The I2 sheet shows I2's state; nothing from S4 carries over. | |

---

## 4. The state and note editor (B)

### 4.1 Set a state and a note

Open S4 ("Design the data collection plan").

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 4.1a | Look at the editor | Five options: **No marker** (selected), Discussed, In progress, Done, Skipped. No note box. **Save** disabled. | |
| 4.1b | Click **Skipped** | A note box appears ("A short note, in your words (optional)"). Save enabled. | |
| 4.1c | Type `QA: EkStep is doing this for us`, click **Save** | Toast "Saved." Under Save: "Set by you. Cube won’t change it." The list row behind (visible after closing) shows **Skipped** (struck-through, hollow dot) without a reload; hover tooltip "Set by you". | |
| 4.1d | Click Save again without changing anything | Save is disabled (nothing to save). | |

As postgres:

```sql
select job_code, state, note, set_by, updated_at from member_job_states
where member_id = '<B_MEMBER>' and job_code = 'S4';
```

| Expected | Pass/Fail |
|---|---|
| One row: `S4`, `skipped`, `QA: EkStep is doing this for us`, `user`. **Copy `updated_at`.** | |

Reload the Jobs page.

| Expected | Pass/Fail |
|---|---|
| S4 still shows **Skipped**; its sheet shows Skipped selected and the note. | |

### 4.2 Cube does not overwrite it (plan test 2; 1 model call)

Go to **Home** (latest conversation). Send:

`We've finished the data collection plan: the requirements study and the technical specification are both done.`

As postgres, re-run the 4.1 query, then:

```sql
select ui->'jobUpdates' as job_updates, ui->'focusJobs' as cards
from companion_messages m join companion_conversations c on c.id = m.conversation_id
where c.member_id = '<B_MEMBER>' and m.role = 'assistant'
order by m.created_at desc limit 1;
```

| # | Expected | Pass/Fail |
|---|---|---|
| 4.2a | `S4` is **still `skipped`, `set_by user`**, same note, **same `updated_at`** as in 4.1. | |
| 4.2b | If the reply shows a card for "Design the data collection plan", the card reads **Skipped**, not Done. | |
| 4.2c | Jobs tab: S4 still **Skipped**. | |
| 4.2d | (Observe) Did Cube's reply acknowledge the user had marked it skipped? Did `job_updates` include S4 anyway (it is silently ignored by the DB trigger)? | |

### 4.3 Making Cube's marker your own, unchanged

Jobs > open "Confirm target language and starting scope" (Done, set by Cube in Slice 2). Before you
start, as postgres, note its row:
`select state, note, set_by, updated_at from member_job_states where member_id = '<B_MEMBER>' and job_code = 'P2';`

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 4.3a | Look at the editor | **Done** is selected and Cube's note is in the note box. Under Save: "From your conversation with Cube. Save to make it yours, and Cube won’t change it." **Save is enabled** even though nothing has been changed. | |
| 4.3b | Click **Save** without changing anything | Toast "Saved." The hint changes to "Set by you. Cube won’t change it." Save is now **disabled** (nothing left to save). In the list, the marker still reads **Done**; its tooltip is now "Set by you". | |
| 4.3c | As postgres, re-run the query above | Same `state` (`done`) and the **same note** as before, `set_by` now `user`, `updated_at` later than before. | |

### 4.3 (continued) Correcting a state Cube set

Jobs > open "Appoint the Nodal Officer and stand up the PMU" (In progress, set by Cube in Slice 2).

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 4.3d | Look under Save | "From your conversation with Cube. Save to make it yours, and Cube won’t change it." | |
| 4.3e | Click **Done**, note `QA: whole PMU team on board`, Save | Toast "Saved.", "Set by you. Cube won’t change it.", list row shows **Done**. | |
| 4.3f | Change only the note to `QA: team on board, induction done`, Save | Save was enabled for a note-only change. Toast "Saved." | |
| 4.3g | Add only trailing spaces to the note | Save stays disabled (whitespace-only change). | |

As postgres:

```sql
select job_code, state, note, set_by from member_job_states
where member_id = '<B_MEMBER>' and job_code = 'I2';
```

| Expected | Pass/Fail |
|---|---|
| `I2`, `done`, `QA: team on board, induction done`, `user`. | |

### 4.4 "No marker" deletes the row

Open S4, click **No marker**, Save.

| Expected | Pass/Fail |
|---|---|
| Toast "Saved." The note box disappears. The S4 row in the list has **no marker**. Re-opening S4 shows No marker selected. | |
| As postgres, `select count(*) from member_job_states where member_id = '<B_MEMBER>' and job_code = 'S4';` → `0`. | |

### 4.5 Optional: a failed save (test project only)

As postgres:

```sql
revoke insert, update, delete on public.member_job_states from authenticated;
```

As B, open S4, choose **Discussed**, Save.

| Expected | Pass/Fail |
|---|---|
| Toast "Couldn't save. Please try again." (error style). The sheet keeps Discussed selected (the draft is not lost). The list row shows **no marker**. Browser console: `[jobs] could not save the state: …`. | |

**Restore straight away** (as postgres), then click Save again:

```sql
grant insert, update, delete on public.member_job_states to authenticated;
```

| Expected | Pass/Fail |
|---|---|
| "Saved.", row shows **Discussed**. Then set S4 back to **No marker** and Save. | |

Run the **snapshot** and keep `job_states` and `states_last_change`: section 9 checks that deleting
conversations leaves them unchanged.

---

## 5. Assets

### 5.1 Pick an id for the file asset (as postgres)

```sql
select gen_random_uuid();
```

Copy it into `<FILE_ASSET_ID>`. The file goes at `<LRL_ID>/<FILE_ASSET_ID>/qa-plan.pdf`.

### 5.2 Upload a small PDF (choose one option)

**Option A, Supabase dashboard.** Storage > bucket `assets` > Create folder `<LRL_ID>` > open it >
Create folder `<FILE_ASSET_ID>` > open it > Upload any small PDF, renamed to `qa-plan.pdf`. (The
dashboard uses the service role, so this skips the Storage policies. Option B tests them.)

**Option B, as C in the browser console** (tests the contributor's upload policy). Sign in as **C**
on `localhost:3000`, then in devtools > Console paste, filling in the first three values from
`.env.local` and 0.4:

```js
const SUPA = '<NEXT_PUBLIC_SUPABASE_URL>';
const ANON = '<NEXT_PUBLIC_SUPABASE_ANON_KEY>';
const PATH = '<LRL_ID>/<FILE_ASSET_ID>/qa-plan.pdf';
function sessionToken() {
  const jar = Object.fromEntries(document.cookie.split('; ').map((c) => {
    const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
  }));
  const base = Object.keys(jar).find((k) => /^sb-.+-auth-token(\.\d+)?$/.test(k)).replace(/\.\d+$/, '');
  let raw = jar[base] ?? Object.keys(jar).filter((k) => k.startsWith(base + '.'))
    .sort((a, b) => a.split('.').pop() - b.split('.').pop()).map((k) => jar[k]).join('');
  if (raw.startsWith('base64-')) raw = new TextDecoder().decode(
    Uint8Array.from(atob(raw.slice(7).replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));
  return JSON.parse(raw).access_token;
}
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
  '4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 70 Td (QA asset file) Tj ET\nendstream endobj\n' +
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const upload = (path) => fetch(`${SUPA}/storage/v1/object/assets/${path}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${sessionToken()}`, apikey: ANON, 'Content-Type': 'application/pdf' },
  body: new Blob([PDF], { type: 'application/pdf' }),
}).then(async (r) => [r.status, await r.text()]);
await upload(PATH);
```

| Expected | Pass/Fail |
|---|---|
| Option A: the file is listed at `<LRL_ID>/<FILE_ASSET_ID>/qa-plan.pdf`. Option B: `[200, '{"Key":"assets/<LRL_ID>/<FILE_ASSET_ID>/qa-plan.pdf",…}']`. | |

**Option B negative (as B).** Sign in as **B** in the other browser, paste the same block but change
the last line to `await upload('<LRL_ID>/' + crypto.randomUUID() + '/b-should-fail.pdf');`

| Expected | Pass/Fail |
|---|---|
| A 4xx (400 or 403) whose body mentions **row-level security**. Adopters can't upload. | |

### 5.3 Add the asset rows (impersonating C, commit)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
insert into public.assets (id, playbook_id, title, kind, storage_path, url, description, job_codes) values
  ('<FILE_ASSET_ID>', '<LRL_ID>', 'QA data collection plan template', 'file',
   '<LRL_ID>/<FILE_ASSET_ID>/qa-plan.pdf', null, 'QA: a one-page test PDF.', '{S4}'),
  (gen_random_uuid(), '<LRL_ID>', 'QA AI4Bharat volume reference', 'link',
   null, 'https://example.com/?qa=s4', 'QA: a link tagged to the data collection plan.', '{S4}'),
  (gen_random_uuid(), '<LRL_ID>', 'QA general reading list', 'link',
   null, 'https://example.org/?qa=general', 'QA: an untagged link.', '{}')
returning id, title, kind, job_codes, added_by;
commit;
```

| Expected | Pass/Fail |
|---|---|
| 3 rows, `added_by = <C>`. **Copy the "AI4Bharat" id into `<LINK_S4_ID>` and the "general" id into `<LINK_GENERAL_ID>`.** | |

### 5.4 Bad links and paths are rejected by the database

Run each block **separately**; each must fail. As postgres (so it is the constraint, not RLS,
that stops it):

```sql
insert into public.assets (playbook_id, title, kind, url)
values ('<LRL_ID>', 'QA bad 1', 'link', 'javascript:alert(document.cookie)');
```

```sql
insert into public.assets (playbook_id, title, kind, url)
values ('<LRL_ID>', 'QA bad 2', 'link', 'JavaScript:alert(1)');
```

```sql
insert into public.assets (playbook_id, title, kind, url)
values ('<LRL_ID>', 'QA bad 3', 'link', 'data:text/html,<script>alert(1)</script>');
```

```sql
insert into public.assets (playbook_id, title, kind, storage_path)
values ('<LRL_ID>', 'QA bad 4', 'file', '<TEST_ID>/11111111-2222-4333-8444-555555555555/x.pdf');
```

Then impersonating **B** (rollback):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.assets (playbook_id, title, kind, url)
values ('<LRL_ID>', 'QA bad 5', 'link', 'https://example.com/');
rollback;
```

| Block | Expected | Pass/Fail |
|---|---|---|
| bad 1, 2, 3 | `violates check constraint "assets_url_http"` (any case of `javascript:`, and `data:`). | |
| bad 4 | `violates check constraint "assets_path_in_playbook"` (a file must be in its own playbook's folder). (If you have no `<TEST_ID>`, use any other uuid.) | |
| bad 5 | `new row violates row-level security policy for table "assets"`. | |
| After all | As postgres: `select count(*) from assets where title like 'QA bad%';` → `0`. | |

### 5.5 Where each asset appears (B)

As **B**, reload `/companion/low-resource-language/jobs`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.5a | Bottom of the list | A **General resources** heading with **one** item: "QA general reading list ↗" and its description "QA: an untagged link." Neither S4 asset is here. | |
| 5.5b | Only mine | General resources still shows the same one item. | |
| 5.5c | Open S4 | A **Resources** section (above "Where you are with this") with **two** items, alphabetical: "QA AI4Bharat volume reference ↗" and "QA data collection plan template ↓", each with its description. Not the general one. | |
| 5.5d | Open E3 and I2 | **No** Resources section. | |

### 5.6 Opening them

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 5.6a | Click "QA AI4Bharat volume reference" | `https://example.com/?qa=s4` opens in a **new tab**; the Jobs tab stays as it was with the sheet open. | |
| 5.6b | Click "QA general reading list" | `https://example.org/?qa=general` opens in a new tab. | |
| 5.6c | Devtools > Network open. Click "QA data collection plan template" | A new tab opens and shows the PDF ("QA asset file", or your own PDF). Its URL is `https://<ref>.supabase.co/storage/v1/object/sign/assets/<LRL_ID>/<FILE_ASSET_ID>/qa-plan.pdf?token=…`. In the first tab, Network shows a `POST …/object/sign/assets/…` with **200**. The bucket is private: the URL has a token. | |
| 5.6d | Wait **more than 60 seconds**, reload the PDF tab | An error (e.g. `InvalidJWT` / "exp" claim check failed). The link is short-lived. | |
| 5.6e | Click the file again | A fresh tab works again (a new signed URL each click). | |
| 5.6f | In the PDF tab, open devtools > Console and run `window.opener` | `null` (the new tab has no link back to the app). | |
| 5.6g | Block pop-ups for the site: Chrome address bar > site settings (the icon left of the URL) > **Pop-ups and redirects: Block**, reload. Click the file. | **No** new tab, and the Jobs page stays where it is (it does **not** navigate to the file). Next to the file name, an inline message: "Your browser blocked the new tab. Allow pop-ups for this site and try again." No sign request in Network. | |
| 5.6h | Set pop-ups back to **Allow** (or default), reload, click the file | The PDF opens in a new tab again; the inline message is gone. | |

### 5.7 Optional: a non-member can't sign the file URL

Sign in as **P** (pending, not a member). In P's console paste the `SUPA`, `ANON`, `PATH` and
`sessionToken` lines from 5.2, then:

```js
await fetch(`${SUPA}/storage/v1/object/sign/assets/${PATH}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${sessionToken()}`, apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 60 }),
}).then(async (r) => [r.status, await r.text()]);
```

| Expected | Pass/Fail |
|---|---|
| A 4xx ("Object not found" or similar). No `signedURL`. | |

### 5.8 Optional: the file is missing

In the Supabase dashboard, delete the object `<LRL_ID>/<FILE_ASSET_ID>/qa-plan.pdf` (keep the row).
As B, reload Jobs, open S4, click the file.

| Expected | Pass/Fail |
|---|---|
| The new tab opens and closes by itself. Next to the file name, an inline message: "Couldn't open this file. Please try again." The Jobs page stays where it is. No crash. | |

Re-upload the file (5.2) before section 6 if you ran this.

---

## 6. Chat: job cards, asset chips and "Ask Cube about this job" (B)

### 6.1 A conversation with known cards and chips (no model call)

This injects one stored turn so the cards and chips can be checked exactly. Impersonating **B**,
**commit**:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id)
values ('<B_MEMBER>', '<LRL_ID>') returning id;
commit;
```

Copy the id into `<QA_CONV>`. Then, impersonating B, **commit**:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select public.record_companion_turn(
  '<QA_CONV>',
  'QA: show me cards and resources',
  'QA: injected reply. Two job cards (funding first) and two resource chips should show below.',
  jsonb_build_object(
    'focusJobs',  jsonb_build_array('E3', 'S4', 'ZZ9'),
    'openJob',    'E3',
    'showAssets', jsonb_build_array('<LINK_S4_ID>', '<FILE_ASSET_ID>', '11111111-2222-4333-8444-555555555555'),
    'context',    '{}'::jsonb,
    'jobUpdates', '[]'::jsonb),
  '{}'::jsonb, '[]'::jsonb);
commit;
```

As B, go to `/companion/low-resource-language?c=<QA_CONV>`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 6.1a | Messages | B's "QA: show me cards and resources", then the injected reply. **No greeting** is added (the conversation isn't empty). No log line. | |
| 6.1b | Cards | **Exactly two**: "Secure funding" (Tracks) **first** (the `openJob`), then "Design the data collection plan" (Owns). `E3` appears once even though it is both `openJob` and in `focusJobs`. Nothing for `ZZ9`. Each card shows a short "when". No state line on either (no state for E3; S4 was cleared in 4.4). | |
| 6.1c | Chips | **Exactly two**: "QA AI4Bharat volume reference ↗" (a link) and "QA data collection plan template" (no arrow, not clickable; hover: "Files open from the job's page"). Nothing for the unknown id. | |
| 6.1d | Click the link chip | example.com opens in a new tab. | |
| 6.1e | Sidebar | A "QA: show me cards and resources" entry, **highlighted**, at the top. | |

### 6.2 A job card opens the sheet

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 6.2a | Click the "Secure funding" card | `/companion/low-resource-language/jobs?open=E3`: the Jobs page with the E3 sheet open. | |
| 6.2b | Close the sheet, press browser **Back** | Back to the `?c=<QA_CONV>` Home with the same history and cards. | |
| 6.2c | Click the "Design the data collection plan" card | The S4 sheet, with its two Resources (5.5c). | |

### 6.3 "Ask Cube about this job" (1 model call)

From the Jobs tab, open the **E3** sheet ("Secure funding") and click **Ask Cube about this job**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 6.3a | Navigation | Home opens. The address bar briefly shows `?job=E3`, then `/companion/low-resource-language` (the `?job=` is removed). It is the **latest** conversation (`<QA_CONV>`, the top of the sidebar). | |
| 6.3b | Sent message | `Tell me about "Secure funding".` appears as B's message automatically. | |
| 6.3c | Reply | About that job: says the playbook **doesn't name an owner** and that the PMU **tracks** it; when: before the first collection stage, with no week stated; how: secure funding before starting collection, and each deploying department funds its own domain-specific top-up. It may say where funding comes from isn't covered. **No** invented funding source, amount or owner. No "E3" in the text. | |
| 6.3d | Card | A "Secure funding" card with a **Tracks** pill. | |
| 6.3e | Reload | The message is not sent again. No new log line. | |
| 6.3f | As postgres | `select count(*) from member_job_states where member_id = '<B_MEMBER>' and job_code = 'E3';` → `0` (asking is not a state). | |

### 6.4 Optional: `openJob` and asset chips from the model (1 to 2 model calls)

As B, send `Show me the details of the data collection plan job.`

| Expected | Pass/Fail |
|---|---|
| (Observe) A "Design the data collection plan" card (from `openJob` or `focusJobs`). As postgres, `select ui->'openJob', ui->'focusJobs' from companion_messages where conversation_id = '<QA_CONV>' and role = 'assistant' order by created_at desc limit 1;` Record whether `openJob` was `"S4"`. | |

Send `Is there anything I can read on how much data to collect?`

| Expected | Pass/Fail |
|---|---|
| (Observe) Cube may offer "QA AI4Bharat volume reference" and/or the template, shown as chips. It must **not** describe what's inside the file (Cube sees only title, description and job tags). Record `ui->'showAssets'` for that reply. | |

---

## 7. Recent conversations: list, open, new (B)

### 7.1 The list matches the database

Run the **list query** (0.7) for B.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 7.1a | Sidebar heading | "RECENT CONVERSATIONS" under the **Companion** nav item. No "Recent Explorations" heading. | |
| 7.1b | Entries | Same number, same order and same labels as the query (`expected_label`). Long first messages end in "…" (for example `We're just getting started. The District Collector has aske…`). Chip conversations show the chip text (for example `What do I own, and what do I only track?`). Any conversation with no user message shows **New conversation**. (Labels come from one request that embeds each conversation's first user message, so they stay right however many messages B has.) | |
| 7.1c | One playbook | Only one line per entry (no playbook name), because B's conversations are all on one playbook (unless you ran 7.8 earlier). | |
| 7.1d | Hover an entry | The full label as a tooltip; a 🗑 appears on the right. | |

### 7.2 Which entry is highlighted

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 7.2a | Click the **Home** tab (URL has no `?c=`) | The **top** entry is highlighted (it is the conversation shown). | |
| 7.2b | Click the third entry | URL `/companion/low-resource-language?c=<its id>`. That entry is highlighted, the top one isn't. | |
| 7.2c | Go to the **Jobs** tab | No entry is highlighted (highlight is for Home only). | |

### 7.3 Switching conversations

Keep devtools > Network open and watch the dev-server log.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 7.3a | Click an older entry with several turns (e.g. the `We're just getting started…` one) | "Opening your conversation…" briefly, then its **full history** in order, with the job cards under each reply and their Owns/Tracks pills and current state markers. **No greeting, no new log line, no `POST /api/chat`.** | |
| 7.3b | Click a different entry | That conversation replaces the first; nothing from the first remains on screen. | |
| 7.3c | Reload | The same conversation (from `?c=`) reloads. | |
| 7.3d | Snapshot | `messages`, `conversations`, `usage_today` unchanged since before 7.3a. | |
| 7.3e | Order | Opening a conversation does **not** move it in the list (only activity does). | |

### 7.4 "Start a new conversation" (1 model call)

Open the `We're just getting started…` conversation (it has the richest context). Click **Start a
new conversation** (top right).

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 7.4a | URL | `?c=<new id>`. **Copy it into `<NEW_CONV>`.** | |
| 7.4b | Sidebar | A **New conversation** entry appears at the top, highlighted. | |
| 7.4c | Greeting | One short greeting asking what B wants to work on now. It does **not** ask where the work is, which language, what's done or B's part. The four chips show. Log: one `stop=end_turn` line. | |
| 7.4d | "Start a new conversation" | Hidden until B sends a message. | |

As postgres:

```sql
select c.id, c.context, (select count(*) from companion_messages m where m.conversation_id = c.id) as messages
from companion_conversations c where c.id in ('<NEW_CONV>', '<the conversation you started from>');
```

| Expected | Pass/Fail |
|---|---|
| `<NEW_CONV>` has `messages 1` and the **same `context`** as the conversation you started from. | |

### 7.5 The label follows the first user message (1 model call)

In `<NEW_CONV>`, send `QA: what should I push on this week?`

| Expected | Pass/Fail |
|---|---|
| After the reply, the sidebar entry reads `QA: what should I push on this week?` (it changes from "New conversation" without a reload) and stays at the top. The reply builds on what Cube knows; no intake questions. | |

### 7.6 Activity moves an entry to the top (no model call)

Impersonating **B**, **commit** (records a turn in an older conversation without a model call):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select public.record_companion_turn('<QA_CONV>', 'QA: bump', 'QA: bump reply', null, '{}'::jsonb, '[]'::jsonb);
commit;
```

Reload any page as B.

| Expected | Pass/Fail |
|---|---|
| "QA: show me cards and resources" is now the **top** entry (its label is still its **first** user message, not "QA: bump"). The list matches the list query again. | |

### 7.7 Switching quickly, and switching while Cube is replying (2 model calls)

**(a) Rapid switching (no model call).** Click four different non-empty entries one after another
as fast as you can, then wait.

| # | Expected | Pass/Fail |
|---|---|---|
| 7.7a | The chat ends on the **last** entry you clicked (its history, its entry highlighted). It never stays stuck on "Opening your conversation…". No messages from an earlier pick appear. No `POST /api/chat`, no log line. Repeat once more to be sure. | |

**(b) Switching to a conversation that has messages.** Open `<NEW_CONV>` (click its entry). Send
`Walk me through everything the language survey involves, step by step.` **While the reply is
still streaming**, click the "QA: show me cards and resources" entry.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 7.7b | Screen | The QA conversation shows, and the streaming reply does **not** appear in it. No retry alert. The composer is empty. | |
| 7.7c | While the other reply is still running | (Observe) The Send button stays disabled until that reply finishes. Record. | |
| 7.7d | When it has finished | `<NEW_CONV>` moves to the top of the list. Click it: B's message and the **complete** reply are both there. | |
| 7.7e | As postgres | `select role, left(content, 50) from companion_messages where conversation_id = '<NEW_CONV>' order by created_at;` ends with the user message and a full assistant reply. | |

**(c) Switching to an empty conversation.** Create one. Impersonating **B**, **commit**:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id)
values ('<B_MEMBER>', '<LRL_ID>') returning id;
commit;
```

Copy the id into `<QA_EMPTY>`. As B, reload; it is now the top entry ("New conversation"). Click
`<NEW_CONV>`, send `What happens in the pilot collection, briefly?`, and **while the reply is
streaming** click the `<QA_EMPTY>` entry.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 7.7f | Screen, while the first reply is still running | `<QA_EMPTY>` is shown, empty, with no greeting yet and no error. | |
| 7.7g | When the first reply has finished | Cube's opening greeting appears in `<QA_EMPTY>` **once** (two log lines in total: the `<NEW_CONV>` reply, then the greeting). | |
| 7.7h | As postgres | `select role, count(*) from companion_messages where conversation_id = '<QA_EMPTY>' group by role;` → `assistant 1` only. `<NEW_CONV>` gained the user message and its full reply. | |

**(d) Optional: a failed turn after switching (dev only, 1 counted call).** Add
`COMPANION_V2_FAIL_AFTER_CHARS=200` to `.env.local` and restart. Click `<NEW_CONV>`, send
`Walk me through the standards creation step, in detail.` and **immediately** (before any text
appears) click the "QA: show me cards and resources" entry. Wait 30 seconds.

| # | Expected | Pass/Fail |
|---|---|---|
| 7.7i | The QA conversation shows no retry alert, and its composer stays **empty** (the failed text is not put into another conversation's composer). Dev-server log: `[companion-v2] failed mid-stream: …`. | |
| 7.7j | Click `<NEW_CONV>`: nothing was stored for that turn (last message is still 7.7e/7.7h's reply). (Observe: the text you sent is gone, since you had left the conversation. Record whether that is acceptable.) | |

Remove `COMPANION_V2_FAIL_AFTER_CHARS` and restart.

### 7.8 Optional: two playbooks (1 model call)

As B, Companion > open "TEST COPY: …" (the greeting runs). Then come back to the low-resource
language Home.

| Expected | Pass/Fail |
|---|---|
| Every entry now has a **second line** with its playbook title ("Low-resource language AI adoption" or "TEST COPY: …"). The TEST COPY entry ("New conversation") links to `/companion/test-playbook?c=…`. **Copy its id into `<B_TEST_CONV>`.** | |

---

## 8. Another user's conversations

### 8.1 B opens D's conversation id

As B, go to `/companion/low-resource-language?c=<D_CONV>`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 8.1a | Conversation shown | **B's own latest** conversation (the top of B's list). Nothing of D's ("Where do I start?" from D, D's replies) appears. | |
| 8.1b | No side effects | No greeting, no log line. Snapshot unchanged (no new conversation for B). As postgres, `<D_CONV>`'s message count is unchanged. | |
| 8.1c | (Observe) | The address bar keeps `?c=<D_CONV>`, and probably **no** sidebar entry is highlighted (the highlight follows `?c=`). Record. | |

### 8.2 Other bad `?c=` values

| # | URL (as B) | Expected | Pass/Fail |
|---|---|---|---|
| 8.2a | `/companion/low-resource-language?c=not-a-uuid` | B's latest conversation. No error on screen. | |
| 8.2b | `/companion/low-resource-language?c=11111111-2222-4333-8444-555555555555` | B's latest conversation. | |
| 8.2c | (If you ran 7.8) `/companion/low-resource-language?c=<B_TEST_CONV>` | B's latest **low-resource language** conversation, not the TEST COPY one (a conversation only opens on its own playbook). | |

### 8.3 D never sees B's list

Sign in as **D** and go to `/companion` (the playbook list, so no greeting runs). Run the list
query for D.

| Expected | Pass/Fail |
|---|---|
| D's sidebar matches D's list query: `Where do I start?` and two `New conversation` entries (from 1.5). **None** of B's labels (no "We're just getting started…", no "QA: …"). | |

Impersonating **D** (rollback):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<D>","role":"authenticated"}', true);
select count(*) as visible_to_d,
       count(*) filter (where member_id = '<B_MEMBER>') as bs_visible_to_d
from public.companion_conversations;
delete from public.companion_conversations where id = '<QA_CONV>' returning id;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| The `delete … returning id` returns **no rows** (D can't delete B's). Run the first `select` on its own in the same pattern if you want its numbers: `visible_to_d` = D's count from 1.5, `bs_visible_to_d = 0`. | |

---

## 9. Deleting conversations

Before each delete, run the **snapshot** and keep `job_states` and `states_last_change`.

### 9.1 Cancel does nothing (B)

Hover the "QA: show me cards and resources" entry, click 🗑.

| Expected | Pass/Fail |
|---|---|
| A dialog: title "Delete this conversation?", text `"QA: show me cards and resources" and all its messages will be permanently deleted. Your job markers stay. This can't be undone.`, buttons Cancel and **Delete** (coral). | |
| Click **Cancel** (and separately try **Esc**): the dialog closes, the entry stays, snapshot unchanged. | |

### 9.2 Delete a conversation that isn't open (B)

First, record what contributors can see. Impersonating **C** (rollback):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select count(*) as total,
       count(*) filter (where conversation_id = '<QA_CONV>') as qa_listed
from public.contributor_list_conversations('<LRL_ID>');
rollback;
```

Note `total`; `qa_listed` should be `1`. As postgres:

```sql
select (select count(*) from companion_conversations where id = '<QA_CONV>') as conv,
       (select count(*) from companion_messages where conversation_id = '<QA_CONV>') as msgs;
```

Note `msgs` (6 or more: the injected turn, the 6.3 turn and the 7.6 bump). As B, open a **different** conversation (click `<NEW_CONV>`), then delete
"QA: show me cards and resources" with 🗑 > **Delete**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.2a | Screen | Toast "Conversation deleted." The entry disappears. `<NEW_CONV>` stays open and highlighted. | |
| 9.2b | As postgres, re-run the `conv`/`msgs` query | `conv 0`, `msgs 0` (messages cascaded). | |
| 9.2c | Snapshot | `job_states` and `states_last_change` **unchanged**. `conversations` −1, `messages` − the noted `msgs`. | |
| 9.2d | Impersonating C, re-run the contributor query | `qa_listed 0`, `total` −1. | |
| 9.2e | As B, go to `/companion/low-resource-language?c=<QA_CONV>` | B's latest conversation opens (a deleted id falls back like a foreign one). | |

### 9.3 Delete the conversation that is open, URL has `?c=` (B)

Click an older Slice 2 conversation you don't need (for example the `How long will this take and
what will it cost?` one) so the URL has `?c=<its id>`. Note its id. Delete it.

| Expected | Pass/Fail |
|---|---|
| The URL becomes `/companion/low-resource-language` (no `?c=`). Home shows B's **latest remaining** conversation (the new top entry, highlighted) with its history. No greeting, no log line (it isn't empty). | |
| As postgres, the deleted id has no conversation and no messages. Snapshot `job_states`/`states_last_change` unchanged. | |

### 9.4 Delete the conversation that is open, URL has no `?c=` (B)

Create a throwaway so it becomes B's latest. Impersonating **B**, **commit** (two statements; the
second uses the first's id, so run them one after the other):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id)
values ('<B_MEMBER>', '<LRL_ID>') returning id;
commit;
```

Copy the id into `<QA_CONV2>`, then:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select public.record_companion_turn('<QA_CONV2>', 'QA: throwaway for the delete test', 'QA: throwaway reply', null, '{}'::jsonb, '[]'::jsonb);
commit;
```

As B, click the **Home** tab (no `?c=`). The throwaway is shown and its entry (top) is highlighted.
Delete it from the sidebar.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.4a | Screen | The throwaway disappears from **both** the list and the chat. "Opening your conversation…" briefly, then Home shows the **next** latest conversation (the new top entry, highlighted) with its history. The URL stays `/companion/low-resource-language`. No greeting, no log line (it isn't empty). | |
| 9.4b | Then send `QA: are you there?` | A normal reply in **that** conversation (1 model call). Network: `POST /api/chat` → 200, not 404. | |
| 9.4c | As postgres | `<QA_CONV2>` has no conversation row and no messages. `QA: are you there?` is stored in the conversation that was shown. Snapshot `job_states`/`states_last_change` unchanged. | |

(How it works: the sidebar sends a "conversations changed" event with the deleted id, and the chat
reloads when it matches the conversation on screen. With `?c=` (9.3) the sidebar also navigates to
the plain Home address.)

### 9.5 Deleting every conversation gives a fresh one (D, 1 model call)

As **D**, click the `Where do I start?` entry first (so the URL has `?c=<D_CONV>`; it has messages,
so no greeting runs). Then delete the two **New conversation** entries (neither is open). Then
delete `Where do I start?` (the open one).

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.5a | After the first two deletes | Each: toast, entry gone, `<D_CONV>` still open. | |
| 9.5b | After the last delete | The URL becomes `/companion/low-resource-language`. A **new** conversation is created and Cube's opening greeting appears (with the four chips). A **New conversation** entry appears in the sidebar, highlighted. Log: one `stop=end_turn` line. | |

As postgres:

```sql
select c.id, c.context, (select count(*) from companion_messages m where m.conversation_id = c.id) as messages
from companion_conversations c where c.member_id = '<D_MEMBER>';
select string_agg(job_code || '=' || state || '/' || set_by, ', ' order by job_code) as d_states
from member_job_states where member_id = '<D_MEMBER>';
```

| Expected | Pass/Fail |
|---|---|
| Exactly **one** conversation, `messages 1`, `context {}` (a fresh one; there was nothing to copy). Deleting the open conversation starts exactly one reload (with `?c=` in the address it navigates to the plain Home address; without it, the chat reloads itself), so only one fresh conversation is created. Two rows here = FAIL. `d_states` is the same as before 9.5 (run it before you start if D had any). `<D_CONV>` has no messages left (`select count(*) from companion_messages where conversation_id = '<D_CONV>';` → `0`). | |
| (Observe) Since the old conversations and their context are gone, does this greeting go back to intake questions? It should, by design. Record. | |

---

## 10. Phone width (375 px)

Devtools > device toolbar > a 375 px wide phone (e.g. iPhone SE), touch emulation on. As B.

| # | Screen | Expected | Pass/Fail |
|---|---|---|---|
| 10.1 | Jobs list | The intro line wraps; the All jobs / Only mine toggle sits below it, fully visible. Each row: the name wraps; marker and tag wrap under it without overlapping; Who owns and Who tracks stack (label above value). No horizontal scroll (`document.documentElement.scrollWidth <= innerWidth` in the console is `true`). Headings and timings wrap cleanly. General resources readable. | |
| 10.2 | Job sheet (S4) | The sheet covers the full width; title and **Close** both visible; the content scrolls inside the sheet; the page behind doesn't scroll; **Ask Cube about this job** stays visible at the bottom; checklist rows, state buttons (wrapping) and the note box fit; the Resources links are tappable. | |
| 10.3 | Sidebar | Tap ☰: the drawer opens with Companion and **Recent conversations**; long labels are cut with "…". | |
| 10.4 | Sidebar: while on the low-resource language Home, tap ☰ and tap a **different** entry of the same playbook (only `?c=` changes) | The drawer **closes** and the picked conversation opens. Repeat from the Jobs tab (the path changes too): the drawer closes as well. | |
| 10.5 | Sidebar: delete on a phone | The 🗑 is **visible on every entry** without hover (below the `md` breakpoint it is always shown). Tap one: the confirm dialog appears above the drawer; tap **Cancel** (don't delete here). | |
| 10.5b | Back at desktop width (≥ 768 px) | The 🗑 is hidden again until you hover the entry or Tab to it. | |
| 10.6 | Home chat | Job cards are one column; asset chips wrap; the composer stays at the bottom. | |

---

## 11. Keyboard only (desktop width)

As B, on the Jobs page, put the mouse aside.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 11.1 | Tab to the toggle | Each of All jobs and Only mine gets a visible focus ring. Enter or Space switches; the pressed one is filled. | |
| 11.2 | Tab to "Design the data collection plan" (it has Resources after section 5), press Enter | The sheet opens; focus is on **Close**. | |
| 11.3 | Tab through the sheet | Reaches, in order: Close, the Resources links, the five state buttons, the note box (once a state is chosen), Save (only while enabled; a disabled Save is skipped), Ask Cube about this job. Each has a visible focus ring. Space or Enter picks a state. (Observe: the state buttons are announced as radios but arrow keys don't move between them; each is its own Tab stop.) | |
| 11.4 | Choose Discussed, Tab to Save, press Enter | "Saved." Focus stays on (the now disabled) Save or the next control; it does **not** jump back to Close. Pressing Tab carries on from there. | |
| 11.5 | Keep pressing **Tab** past "Ask Cube about this job" | Focus wraps to **Close**; it never reaches the sidebar, the tabs or the list behind the backdrop. | |
| 11.6 | On **Close**, press **Shift+Tab** | Focus wraps to "Ask Cube about this job". | |
| 11.7 | Press **Esc** | The sheet closes, the URL drops `?open=`, and focus is back on the "Design the data collection plan" **row** (visible focus ring). Press Enter again: the same sheet opens. | |
| 11.8 | Set the job back to **No marker**, Save, Esc | Focus returns to the row again. | |
| 11.9 | Sidebar: Tab to a Recent conversations entry, then Tab once more | The 🗑 becomes visible when focused (`focus:opacity-100`). Enter opens the confirm dialog; Esc cancels it. | |

---

## 12. Flag off: the sidebar is Cube 1.0's

Comment out `NEXT_PUBLIC_CUBE_VERSION` in `.env.local` (`# NEXT_PUBLIC_CUBE_VERSION=2`) and restart.
Sign in as B.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 12.1 | Nav | Explore, Analyse, Contribute (no Companion). | |
| 12.2 | Sidebar list | **No** "Recent conversations" heading or entries. If B has Cube 1.0 history (Slice 2 step 12.2 made an `/analyse` conversation), the **Recent Explorations** heading and entries show as before this branch, and clicking one opens `/analyse?open=<id>`. | |
| 12.3 | Network | Filter by `companion_conversations`: **no** requests on any page. | |
| 12.4 | `/companion/low-resource-language/jobs?open=S4` | 404. | |

Put `NEXT_PUBLIC_CUBE_VERSION=2` back and restart.

---

## 13. Things to record

Not pass/fail by themselves.

| Measure | Details |
|---|---|
| Model calls made (dev-server log lines) vs. the ~8 required | |
| Any reply in 4.2, 6.3, 7.4, 7.5, 9.4b, 9.5 with a job code, framework term, or invented figure | |
| 4.2d: did Cube try to set S4 anyway? | |
| 6.4: did the model set `openJob` / `showAssets`? | |
| 3.4b: unsaved edits discarded on close without a warning (acceptable?) | |
| List says "No owner named in the playbook"; sheet says "No owner is named in the playbook." (wording differs slightly) | |
| "Ask Cube about this job" always goes to the **latest** conversation, even if the user came from an older one via `?c=`. Acceptable? | |

---

## 14. Clean up (test project only)

- `.env.local`: `NEXT_PUBLIC_CUBE_VERSION=2` on; no cap or failure variables. Restart.
- If you ran 4.5, confirm the grants are back (as postgres; expect `true`):
  `select has_table_privilege('authenticated', 'public.member_job_states', 'INSERT');`
- Keep the three QA assets and the file if Slice 4c (Assets) follows; it can test edit and delete on
  them. Otherwise, as postgres:
  `delete from assets where playbook_id = '<LRL_ID>' and title like 'QA %' returning id;` then delete
  the folder `<LRL_ID>/<FILE_ASSET_ID>/` in Storage (the row first, then the object, as the plan
  says).
- B's job states: S4 should already be back to no marker. P2 (`done`) and I2 (`done`) are now `set_by user` from 4.3. Leave them, or put the
  Slice 2 state back. An `update` from `user` to `cube` is silently skipped by the trigger (even as
  postgres), so delete and re-insert:
  `delete from member_job_states where member_id = '<B_MEMBER>' and job_code in ('P2', 'I2');`
  `insert into member_job_states (member_id, job_code, state, note, set_by) values ('<B_MEMBER>', 'P2', 'done', 'Bhili confirmed; Devanagari script and Dehwali dialect chosen', 'cube'), ('<B_MEMBER>', 'I2', 'in_progress', 'Nodal Officer appointed; rest of PMU not on board', 'cube');`
- Empty or QA conversations left in B's list (`<QA_EMPTY>`, "QA: what should I push on this week?") can be deleted from the sidebar.
- Usage rows (optional): `delete from companion_usage where user_id in ('<B>','<D>');`

---

## Acceptance criteria to steps

| Slice 3 acceptance criterion / requested check (plan) | Steps | Pass/Fail |
|---|---|---|
| All 40 jobs show in sequence order, grouped under the step where each first appears, headings without "Stage N:", with timing; a short "when" under each name; intro line counts computed from the data | 2.1, 2.2 | |
| Who owns (PMU bold), Who tracks, Owns or Tracks tag that match the HTML / JSON (plan test 1: five jobs) | 1.3, 2.1h, 2.2 | |
| Only mine shows exactly the 11 Owns jobs | 2.3b, 2.3c | |
| The three jobs with no owner show "No owner named in the playbook" | 2.3a, 2.2d, 3.3b | |
| State markers: states from chat appear; none for jobs never discussed; no warnings | 2.4 | |
| Job sheet: `?open=` deep link, Esc / backdrop / Close, unknown code ignored | 3.1 | |
| Job sheet sections: what, why, when, short how, checklist (PMU items highlighted, each row shows the plain step title matching the list headings, no "Stage"/"Step N", no checkboxes), owner note, roles with "Not stated", gaps, maturity line | 3.2, 3.3 | |
| Switching jobs resets the editor | 3.4 | |
| User state and note save with `set_by='user'`; a marker Cube set can be saved unchanged to make it the user's own; "No marker" deletes the row | 4.1, 4.3a–4.3g, 4.4 | |
| A user correction persists, and a later Cube update does not overwrite it (plan test 2) | 4.1, 4.2 | |
| A failed save shows an error and keeps the draft | 4.5 (optional) | |
| Assets: link and file tagged to a job show in its sheet; untagged shows under General resources (plan test 3) | 5.3, 5.5 | |
| Files open through a signed URL in a new tab (opener cleared); links open in a new tab; a blocked pop-up or a failed signed URL shows an inline message and the page stays | 5.6, 5.8 (optional) | |
| `javascript:` / `data:` links and cross-playbook file paths are rejected by the database; adopters can't add assets or upload | 5.2 (negative), 5.4, 5.7 (optional) | |
| Inline job cards open the sheet; `openJob` shows as a card (no duplicate); asset chips | 6.1, 6.2, 6.4 (optional) | |
| "Ask Cube about this job" opens Home focused on that job | 6.3 | |
| Sidebar lists the user's own conversations, newest first, labelled by their first question ("New conversation" before one) | 7.1, 7.4b, 7.5, 7.6 | |
| Playbook name shown when there is more than one playbook | 7.8 (optional) | |
| Clicking one opens it with its history and job cards; active one highlighted (including the latest with no `?c=`); rapid switching never sticks on "Opening…"; switching mid-reply keeps the reply out of the new conversation, still greets an empty one, and never moves failed text across | 7.2, 7.3, 7.7 | |
| "Start a new conversation" adds one; Cube greets without re-asking intake; context copied | 7.4 | |
| Delete (after a confirm) removes the conversation and its messages, keeps job states, drops it from the contributor list (plan test 5) | 9.1, 9.2 | |
| Deleting the open one (with or without `?c=`) returns to the latest remaining, or a fresh one with Cube's greeting | 9.3, 9.4, 9.5 | |
| Another user's conversations never appear; another user's `?c=` opens your own latest (plan test 6) | 8.1, 8.2, 8.3 | |
| Clean on a phone-width screen (plan test 4) | 10 | |
| Keyboard-only use of the sheet and toggle: focus to Close once on open, Tab and Shift+Tab trapped, Esc closes, focus returns to the row | 3.1b, 11 |
| Flag off: Cube 1.0 sidebar unchanged, no Recent conversations | 12 | |
