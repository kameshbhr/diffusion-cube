# Cube 2.0 Slice 4a: manual test script

Branch `cube-2`. This covers what Slice 4a delivers (see `docs/design/cube2-plan.md`, "Slice 4a" and
section 7, "Playbook"):

- the contributor **Playbook** screen (`app/companion/[slug]/playbook/page.tsx`), 404 for anyone
  who isn't a contributor to that playbook (`requireContributor` in `lib/companion-v2/server.ts`);
- the React port of the HTML prototype in `components/companion-v2/playbook/`: `PlaybookView.tsx`
  (tabs, `?tab=` / `?open=`, the two download buttons), `OverviewTab.tsx`, `RolesTab.tsx`,
  `JobsMapTab.tsx`, `SequenceTab.tsx`, `JobDrawer.tsx` and `shared.tsx` (the "No owner named" flag,
  maturity pills, job chips);
- **Download playbook as JSON** (browser-side `serializePlaybook` from
  `lib/companion-v2/playbook-json.mjs`) and **Download source document**;
- the data change that came with it: `sequence.milestones`, `sequence.milestones_note` and
  `sequence.note` in `content/playbooks/low-resource-language.json` (read from the HTML by
  `scripts/cube2/export-playbook.mjs`), now shown on the Sequence tab and rendered into Cube's
  prompt (`lib/companion-v2/prompt.ts`).

**Already checked automatically in a temporary preview, so only spot-checked here:** 7 overview
cards; 24 role cards (23 + "EkStep" under "Named in the checklist"); 57 tiles (40 solid + 17
dashed); PMU owns = 11 jobs; Decide = 17 jobs; search "survey" = 1 job (E3); the drawer opens from
`?open=`, focuses Close and closes on Esc; P4, S3 and E3 carry "No owner named"; 14 phases; 12
rules; 3 milestones; no horizontal overflow at 375 px. **The test project was re-seeded today**, so
the Sequence tab now also has the Milestones card and two notes, and Cube's prompt includes the
milestones. This script covers what needs a real browser, a real Supabase session, the HTML side by
side, the export script and the model.

**Not covered here, because later slices build them:** edit controls, `PatchReview` and saving
(4b), Assets (4c), Update with Cube and the Source document screen (4d), Conversations (5). The
other contributor tabs (Update with Cube, Source document, Assets, Conversations) are still
placeholders.

**Cost.** One Anthropic call (section 12). Per the Product Charter, the Anthropic account in
`.env.local` was a free trial due to expire on **28-Oct-2026** (TD-16), which is already past. If
that call fails with a 401 or 403, check the account before recording a failure.

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
line. No line means no model call. Browsing the Playbook screen must never print one.

### 0.3 Test accounts (same as Slice 3)

| Name | Purpose | Roles |
|---|---|---|
| **A** | Admin. Only needed if C has lost the contributor row (1.2). | Listed in `ADMIN_EMAILS` |
| **B** | Main adopter. Used for the 404 check and the milestone question (section 12). | `adopter` |
| **C** | Contributor to the main playbook. **Does almost all of this script.** | `adopter`, `playbook_members.member_role = contributor` on `low-resource-language` only |
| **D** | Second adopter, 404 check only. | `adopter` |
| **P** | Pending user (no roles). 404 / gate check only. | none |

Use **two browsers** (or a normal and a private window): one for C, one for B, D or P.

### 0.4 The HTML prototype, side by side

Open `docs/design/low-resource-language-ai-adoption-playbook.html` directly in Chrome
(`file:///D:/ekstep-new/AI%20Diffusion%20Pathways/ai-diffusion-cube-app-cube-dev/docs/design/low-resource-language-ai-adoption-playbook.html`).
Put it next to C's `/companion/low-resource-language/playbook` window, at the same width
(at least 1280 px each, or one monitor each). Throughout, **"HTML"** means this file and
**"app"** means C's Playbook screen.

The HTML is the reference for **content**. Known, intended differences (don't fail on these):

| Where | HTML | App |
|---|---|---|
| Page header | Its own h1 "Low-resource language AI adoption: playbook" and description | Workspace header (← All playbooks, title, Home / Jobs / Playbook … tabs); the description sits above the four tabs, next to the two download buttons |
| Drawer deep link | `#job-s4` (lower case) | `?open=S4` (upper case) |
| Deep link on Overview | Opening `#job-s4` while on Overview switches to Jobs map | `?open=S4` opens the drawer over whatever tab is showing |
| Jobs with no owner | No flag | A small "No owner named" pill on the tile and in the drawer (plan, section 7) |
| Jobs map tiles | No maturity pills | A **Thin**, **Estimate** or **Needs check** pill on the 19 tiles of the 13 flagged jobs (kept on purpose) |
| Drawer | No Maturity section | A **Maturity** section with the flag pill and note, when the job has one |
| Fonts and colours | The prototype's | The `--pb-*` palette; same layout and order |

### 0.5 Values to fill in as you go

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>`, `<TEST_ID>` | | 1.1 |
| `<A>`, `<B>`, `<C>`, `<D>`, `<P>` (user ids) | | 1.2 |
| `<C_TEST_ROW>` (does C have a `test-playbook` member row before 2.6? yes/no, and its role) | | 1.2 |
| `<EXPORT_DIR>` (an empty folder **outside** the repo, e.g. `D:/cube2-4a-export`) | | 10.1 |
| `<DL_JSON>`, `<DL_MD>` (the two downloaded files) | | 10.2 |

### 0.6 SQL in the Supabase SQL Editor

Same rules as Slice 3, section 0.5:

- Blocks marked **"as postgres"** run as the superuser (RLS ignored), for setup and checking.
- **"Impersonating X"** blocks run as that user, so RLS applies:

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
  -- statements
  rollback;
  ```

- The editor shows only the **last** statement's result.
- `current transaction is aborted` → run `rollback;` on its own and carry on.

### 0.7 The "no writes" snapshot (as postgres)

Every table Cube 2.0 writes to, with a count and (where the table has one) the latest `updated_at`.
Section 11 compares a "before" and an "after" run of this.

```sql
select
  (select count(*) from playbooks)                                       as playbooks,
  (select max(updated_at) from playbooks)                                as playbooks_upd,
  (select updated_at from playbooks where slug = 'low-resource-language') as lrl_upd,
  (select count(*) from playbook_jobs)                                   as jobs,
  (select max(updated_at) from playbook_jobs)                            as jobs_upd,
  (select count(*) from playbook_members)                                as members,
  (select count(*) from playbook_members p
     join playbooks b on b.id = p.playbook_id
     where b.slug = 'low-resource-language')                             as members_lrl,
  (select count(*) from member_job_states)                               as job_states,
  (select max(updated_at) from member_job_states)                        as job_states_upd,
  (select count(*) from companion_conversations)                         as conversations,
  (select max(updated_at) from companion_conversations)                  as conversations_upd,
  (select count(*) from companion_messages)                              as messages,
  (select count(*) from assets)                                          as assets,
  (select coalesce(sum(count), 0) from companion_usage)                  as usage_total;
```

---

## 1. Pre-flight

### 1.1 Playbooks after today's re-seed (as postgres)

```sql
select id, slug, title, listed, updated_at,
       (select count(*) from playbook_jobs j where j.playbook_id = p.id) as jobs,
       jsonb_array_length(roles)                                       as roles,
       jsonb_array_length(sequence->'phases')                          as phases,
       jsonb_array_length(sequence->'rules')                           as rules,
       jsonb_array_length(coalesce(sequence->'milestones', '[]'))      as milestones,
       sequence ? 'milestones_note'                                    as has_ms_note,
       sequence ? 'note'                                               as has_seq_note,
       length(source_doc)                                              as source_chars
from playbooks p order by slug;
```

| Expected | Pass/Fail |
|---|---|
| `low-resource-language`: `listed true`, `jobs 40`, `roles 23`, `phases 14`, `rules 12`, `milestones 3`, `has_ms_note true`, `has_seq_note true`. **Copy its id into `<LRL_ID>`.** `test-playbook` ("TEST COPY: …"): **copy its id into `<TEST_ID>`**, and note whether it is `listed` (2.6 depends on it). If `milestones` is `0` or missing, the re-seed didn't use the new JSON: stop and re-seed before going on. | |

### 1.2 Accounts and memberships (as postgres)

```sql
select u.email, u.id as user_id,
       array_agg(distinct r.role) filter (where r.role is not null) as roles,
       (select member_role from playbook_members m where m.user_id = u.id and m.playbook_id = '<LRL_ID>')  as lrl_role,
       (select member_role from playbook_members m where m.user_id = u.id and m.playbook_id = '<TEST_ID>') as test_role
from auth.users u
left join user_roles r on r.user_id = u.id
where u.email in ('<A email>','<B email>','<C email>','<D email>','<P email>')
group by u.email, u.id
order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| C: `lrl_role contributor`, `test_role` **not** `contributor` (either `null` or `adopter`). **Write C's `test_role` into `<C_TEST_ROW>`.** B and D: `lrl_role adopter`. P: roles `null`, no member rows. **Copy the user ids.** | |
| If C's `lrl_role` isn't `contributor` (a re-seed with `--force` can cascade member rows away): as **A**, `/admin` > **Playbook contributors** > pick "Low-resource language AI adoption" > add C's email > **Add as contributor**, then re-run. | |

### 1.3 The data the screens should show (as postgres)

```sql
select count(*)                                                                   as jobs,
       sum(cardinality(stages))                                                    as tiles,
       sum(cardinality(stages) - 1)                                                as dashed_tiles,
       count(*) filter (where body->'owners' ? 'PMU')                              as pmu_owns,
       count(*) filter (where body->'tracked_by' ? 'PMU')                          as pmu_tracks,
       count(*) filter (where job_type = 'Decide')                                 as decide,
       count(*) filter (where (body->>'recurs')::boolean)                          as recurs,
       string_agg(job_code, ',' order by position)
         filter (where jsonb_array_length(coalesce(body->'owners','[]'::jsonb)) = 0) as no_owner
from playbook_jobs where playbook_id = '<LRL_ID>';
```

| Expected | Pass/Fail |
|---|---|
| `jobs 40`, `tiles 57`, `dashed_tiles 17`, `pmu_owns 11`, `pmu_tracks 40`, `decide 17`, `recurs 10`, `no_owner E3,P4,S3`. | |

### 1.4 "Before" snapshot

Run the snapshot (0.7). **Keep the whole row.** From here until section 11, don't chat, don't
change job states and don't add assets as anyone.

---

## 2. Access

### 2.1 C sees the Playbook tab and screen

Sign in as **C**. Companion > "Low-resource language AI adoption".

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 2.1a | Workspace tabs | Home, Jobs, **Playbook**, Update with Cube, Source document, Assets, Conversations. | |
| 2.1b | Click **Playbook** | URL `/companion/low-resource-language/playbook`. The Playbook tab is underlined (`aria-current="page"` in devtools). Above the four section tabs: the description "For a district or state champion bringing a tribal or low-resource language onto India’s language AI infrastructure. Built on the Pathway Model: …" (same text as the HTML header paragraph), and two buttons **Download playbook as JSON** and **Download source document**. | |
| 2.1c | Section tabs | Overview (selected, underlined), Roles, Jobs map, Sequence. Same four, same order, as the HTML. | |
| 2.1d | Dev-server log, devtools > Network | No `[companion-v2]` line. No `POST /api/chat`. No Supabase `POST`/`PATCH`/`DELETE` to `/rest/v1/` (filter Network by `rest/v1`; only `GET`s, or nothing, since the data loads on the server). | |

### 2.2 Adopters get a 404 (B and D)

In the other browser, sign in as **B**.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 2.2a | Companion > the playbook | Tabs: **Home and Jobs only**. No Playbook tab. | |
| 2.2b | Go to `/companion/low-resource-language/playbook` | The app's **404** page. No playbook content, no download buttons. | |
| 2.2c | `/companion/low-resource-language/playbook?tab=map&open=S4` | 404 (query strings don't bypass it). | |
| 2.2d | Sign out, sign in as **D**, repeat 2.2a–2.2b | Same: Home and Jobs only; 404. | |

### 2.3 Pending user (P)

Sign in as **P**, go to `/companion/low-resource-language/playbook`.

| Expected | Pass/Fail |
|---|---|
| **Not** the Playbook. The companion layout shows "Your account is almost ready" (as in Slice 1, 8.6b) for any user with no roles; a 404 is also acceptable. No playbook content in the page source (Ctrl+U, search for `Stages and timing`: no match). | |

### 2.4 Signed out

Sign out (or use a fresh private window), go to `/companion/low-resource-language/playbook?tab=roles`.

| Expected | Pass/Fail |
|---|---|
| Redirected to `/login?next=%2Fcompanion%2Flow-resource-language%2Fplaybook` (by `proxy.ts`). No playbook content. (Observe: the `?tab=roles` is not carried in `next`. Record.) | |

### 2.5 A slug that doesn't exist (C)

As C, go to `/companion/no-such-playbook/playbook`.

| Expected | Pass/Fail |
|---|---|
| 404. | |

### 2.6 C on a playbook C doesn't contribute to

As C, go to `/companion/test-playbook/playbook`.

| # | Expected | Pass/Fail |
|---|---|---|
| 2.6a | **404**. | |
| 2.6b | Then go to `/companion/test-playbook` (Home): tabs are **Home and Jobs only** (C is only an adopter there). Don't send anything. (The Home tab may run the opening greeting if C has no conversation there: one model call. To avoid it, check the tabs on `/companion/test-playbook/jobs` instead.) | |
| 2.6c | As postgres: `select member_role, project_role, created_at from playbook_members where playbook_id = '<TEST_ID>' and user_id = '<C>';` If `<C_TEST_ROW>` was `null` **and** `test-playbook` is `listed`, there is now **one** `adopter`/`PMU` row created just now: that is the normal self-join on first open (the workspace layout joins every approved visitor as an adopter before the page checks the role). If `test-playbook` is unlisted, there is still **no** row and 2.6a was a 404 because C can't see it at all. Either way, **never** `contributor`. | |

---

## 3. Overview tab (C, side by side)

App: Playbook > **Overview**. HTML: **Overview**.

Console (app):

```js
console.log([...document.querySelectorAll('[role=tabpanel] h2')].map((h) => {
  const c = h.parentElement;
  return `${h.textContent} | dt ${c.querySelectorAll('dt').length} | li ${c.querySelectorAll('li').length}`;
}).join('\n'));
```

Console (HTML), same output format:

```js
console.log([...document.querySelectorAll('#p-overview .card h2')].map((h) => {
  const c = h.parentElement;
  return `${h.textContent} | dt ${c.querySelectorAll('dt').length} | li ${c.querySelectorAll('li').length}`;
}).join('\n'));
```

| # | Expected (both) | Pass/Fail |
|---|---|---|
| 3.1 | Exactly 7 lines, identical in both, in this order: `Purpose: what this playbook is for \| dt 6 \| li 4`, `Context: where this playbook applies \| dt 8 \| li 0`, `Based on \| dt 6 \| li 2`, `Outcomes it can enable \| dt 0 \| li 5`, `Key insights across the jobs \| dt 0 \| li 4`, `Maturity flags \| dt 5 \| li 0`, `Credits \| dt 4 \| li 12`. | |

| # | Card | Compare app vs HTML | Pass/Fail |
|---|---|---|---|
| 3.2 | Layout | At desktop width, Purpose, Context and Based on are full width; **Outcomes** and **Key insights** sit side by side; Maturity flags and Credits are full width. Same as the HTML. | |
| 3.3 | Purpose | Labels: What it is for, The problem, Why voice AI, Use cases (4 bullets, ending "A first keyword-spotting model for 20–30 priority terms, such as health service names, scheme names, crop names or emergency phrases"), Who benefits, Who it is for. Text word for word. | |
| 3.4 | Context | Sector, People served, Geography, Organisational capacity, Existing infrastructure, Regulatory environment, Scale, Resources ("₹84 lakh to ₹1 crore for foundation-building. Data collection of 9+ months under normal conditions."). | |
| 3.5 | Based on | Adoptions drawn on (2 bullets: Project Astitva…, Mission BAANI…), Deployment reference, Methodology, Convenings, DC meeting checklist, Not recorded ("Which job or insight came from which adoption."). | |
| 3.6 | Outcomes | 5 bullets; the last is "Reported results from a completed run: not stated. The milestones in the Sequence tab are targets." | |
| 3.7 | Key insights | 4 bullets; the first ends "The champion’s role is closer to a midwife’s than an owner’s: facilitate, then step back." | |
| 3.8 | Maturity flags | Estimate, Needs check, Thin, Open, **Needs check: PMU tags** (5 rows; the last starts "The PMU tags come from the DC meeting checklist (MahaPMU)."). | |
| 3.9 | Credits | **Created by**: "EkStep Foundation, 2026. Drawn on Project Astitva and Mission BAANI, both associated with EkStep Foundation." **Licence**: "Creative Commons Attribution 4.0 International (**CC BY 4.0**). Suggested credit: “Low-Resource Language AI Adoption Package for India,” EkStep Foundation." **Acknowledged contributors**: 12 bullets from "Santosh Kevlani, EkStep Foundation" to "Gates Foundation: funder audience and reference point for diligence framing", then the muted note "Listed in no particular order. Being listed reflects contribution to the underlying work and does not make anyone an author or co-owner." **Feedback**: "This is a working document. …". | |
| 3.10 | CC BY 4.0 | Ctrl+F `CC BY 4.0` on the app finds it in Credits > Licence. | |
| 3.11 | Curly quotes and symbols | ’ “ ” – ₹ render as in the HTML (no `&rsquo;`, `â€™` or `?`). | |

---

## 4. Roles tab (C, side by side)

App: **Roles**. HTML: **Roles**.

### 4.1 Banner

| # | Check | Expected (app = HTML) | Pass/Fail |
|---|---|---|---|
| 4.1a | Heading and text | "PMU tracks every job", then "PMU is responsible for tracking all the jobs. It owns the jobs where the DC checklist names PxD, PMU or the Nodal Officer’s team as the owner. The Nodal Officer is a separate role, so jobs the Nodal Officer owns are tracked by PMU, not owned." | |
| 4.1b | Numbers | **11** "jobs PMU owns", **40** "jobs PMU tracks". (App: the 40 is counted from `tracked_by`; HTML counts all jobs. Same result because every job is tracked by PMU, per 1.3.) | |
| 4.1c | Open "Show the jobs PMU owns" | 11 chips, in this order: Map what already exists, Understand the language community and the access gap, Appoint the Nodal Officer and stand up the PMU, Design the data collection plan, Write the scope and requirements document, Select and contract partners, Measure progress, quality and real use, Decide at the gates and sign off, Secure lasting ownership and continuity, Document and share the playbook, Capture usage gaps and keep improving. Each chip has a coloured left border by job type, same colours as the HTML. | |
| 4.1d | Click "Design the data collection plan" chip | The S4 drawer opens (checked in 7.3). URL gains `?tab=roles&open=S4`. Close it. | |

### 4.2 Cards and group chips

Console (app): `document.querySelectorAll('[role=tabpanel] article').length` ·
Console (HTML): `document.querySelectorAll('#rgrid .rcard').length`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 4.2a | Card count | **24** in both. | |
| 4.2b | Group chips | `All` (selected), `Governance and delivery`, `Community`, `External vendors`, `Review and testing`, `Named in the checklist`. Same in both. | |
| 4.2c | Click each group | Card counts: Governance and delivery **10**, Community **3**, External vendors **3**, Review and testing **7**, Named in the checklist **1**. Selected chip filled, `aria-pressed="true"`; the others `false`. Same in the HTML. Back to **All**: 24. | |
| 4.2d | First card | "Champion" (group label "GOVERNANCE AND DELIVERY" in small caps above). The PMU card ("Project Management Unit (PMU)") has an **accent** border; no other card does. | |
| 4.2e | The extra card | Last card, group "NAMED IN THE CHECKLIST": **EkStep**, "Named as an owner in the DC checklist. Not described as a role in the playbook.", "Owns 1 job in the checklist" (singular) → Design the data collection plan. | |

### 4.3 Owned and named job chips (five cards, app vs HTML)

Open each `<details>` in both and compare the chips.

| # | Card | "Owns N jobs in the checklist" | "Named in the playbook for N more jobs" | Pass/Fail |
|---|---|---|---|---|
| 4.3a | Project Management Unit (PMU) | 11 (the 4.1c list) | 6, in this order: Establish governance and the review mechanism, Build the validator, reviewer and coordinator pool, Set the quality bar and acceptance criteria, Recruit, train and pay community contributors, Train, fine-tune and benchmark models, Manage partners through delivery (I3, I6, P5, E6, S10, E5) | |
| 4.3b | Champion | 13 | 4 (S4, I4, S7, E8) | |
| 4.3c | Nodal Officer | 20 | 2 (I3, P6) | |
| 4.3d | Ecosystem Orchestrator | **no** "Owns" section | 2 (Map what already exists, Write the scope and requirements document). The card also shows two muted lines: "E.g. PxD or an EkStep Foundation equivalent." and "In the DC checklist, PxD acts as the Ecosystem Orchestrator, so its items count as PMU’s." | |
| 4.3e | Subject Matter Experts | **neither** section | — | |

(Job codes aren't shown on chips; hover is not a code either. To map a chip to its code, click it:
the drawer header reads `<code> · <work area>`.)

### 4.4 Search

| # | Type in "Search roles" | Expected (app = HTML) | Pass/Fail |
|---|---|---|---|
| 4.4a | `nodal` | 2 cards: Nodal Officer, Project Management Unit (PMU). | |
| 4.4b | `vendor` | 4: Steering Committee, Project Management Unit (PMU), Ecosystem Orchestrator, Independent Third Party. | |
| 4.4c | `checklist` | 4: Steering Committee, Project Management Unit (PMU), Independent Third Party, EkStep. | |
| 4.4d | `  NODAL  ` (capitals, spaces around) | Same as 4.4a (trimmed, case-insensitive). | |
| 4.4e | `zzz` | "No roles match." | |
| 4.4f | `vendor`, then click **External vendors** | Search and group combine: 0 cards → "No roles match." (none of the three vendor cards mentions "vendor" in its name or description). Same in the HTML. | |
| 4.4g | Clear the search, click **All** | 24 again. | |
| 4.4h | Switch to Overview and back to Roles | (Observe) The search box and group reset to empty / All (the tab remounts). The HTML keeps them. Record. | |

---

## 5. Jobs map tab (C, side by side)

App: **Jobs map**. HTML: **Jobs map**. Clear any filter in the HTML (reload it if unsure).

### 5.1 Structure

| # | Check | Expected (app = HTML) | Pass/Fail |
|---|---|---|---|
| 5.1a | Stage headers | Explore "Set purpose, goals and use cases. Ends with a decision on what to pursue."; Define "Understand the use case in detail and get ready for real-world testing."; Pilot "Build, test and improve in real conditions. Ends with a decision to scale, change or stop."; Scale "Expand and sustain in regular use while continuing to improve." | |
| 5.1b | Area rows | People and Problem "People served, needs, purpose, goals, use cases, outcomes"; Solution "Technology, data, safeguards, delivery and operations"; Institution "Leadership, governance, capability, resources, ownership"; Ecosystem "Partners, funders, government, communities". | |
| 5.1c | Controls | "Search jobs" box; type chips Discover, Decide, Deliver, Operate (each with a coloured dot); a **PMU owns** chip. | |
| 5.1d | Legend | Five items, word for word: "Solid tile: where the job starts", "Dashed tile: the job continues in this stage", "↻ the job recurs across build rounds", "Who owns: the roles that own the job’s checklist items, with PMU in bold. Who tracks: PMU tracks every job.", "“PMU owns” shows only the jobs where PMU is an owner. The Nodal Officer is a separate role from PMU." | |
| 5.1e | Note under the matrix | "Stage, work area and job type placements are a first mapping of the playbook’s content onto the jobs framework. Where the content gives no timing, the placement is an assumption." | |

### 5.2 Tiles: counts per cell

Console (app):

```js
const T = [...document.querySelectorAll('button[data-code]')];
console.log('tiles', T.length, 'dashed', T.filter((b) => b.classList.contains('border-dashed')).length,
  'recur', T.filter((b) => b.querySelector('span').textContent.includes('↻')).length,
  'noOwner', T.filter((b) => b.textContent.includes('No owner named')).length);
```

Console (HTML):

```js
const H = [...document.querySelectorAll('#matrix .job')];
console.log('tiles', H.length, 'dashed', H.filter((b) => b.classList.contains('cont')).length,
  'recur', H.filter((b) => b.querySelector('span').textContent.includes('↻')).length);
```

| # | Expected | Pass/Fail |
|---|---|---|
| 5.2a | App: `tiles 57 dashed 17 recur 18 noOwner 4`. HTML: `tiles 57 dashed 17 recur 18`. | |
| 5.2b | Each cell has the same tiles in the same order as the HTML. Counts (solid + dashed): | |

| Area \ Stage | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| People and Problem | 4 (P3, P4, P2, P1) | 1 (P5) | 1 (P6) | 1 dashed (P6) |
| Solution | 1 (S1) | 6: 5 + dashed S1 | 8: 7 + dashed S6 | 6: 1 (S14) + 5 dashed (S6, S7, S9, S8, S10) |
| Institution | 1 (I1) | 5 (I2, I3, I6, I4, I5) | 3: 2 (I7, I8) + dashed I6 | 4: 2 (I9, I10) + 2 dashed (I7, I8) |
| Ecosystem | 3 (E2, E3, E1) | 4: 3 (E4, E6, E8) + dashed E3 | 4: 2 (E7, E5) + 2 dashed (E6, E8) | 5: 2 (E9, E10) + 3 dashed (E8, E7, E5) |

(Codes aren't on the tiles; read the cell names against the HTML, or hover a tile in devtools and
read `data-code`.)

| # | Tile details | Expected | Pass/Fail |
|---|---|---|---|
| 5.2c | A solid tile, e.g. Explore × People and Problem "Choose the deployment use case ↻" | Name with " ↻"; line "Decide"; "Who owns: Nodal Officer, Core Application Owner"; "Who tracks: PMU". Coloured left border (Decide colour), solid. Same as HTML. | |
| 5.2d | A dashed tile, e.g. Scale × People and Problem "Measure progress, quality and real use ↻" | Dashed border (the coloured **left** border stays solid), muted text, line "Operate · continues", "Who owns: **PMU**, Data Collection Agency, District Collector". Same as the HTML's dashed tile. | |
| 5.2e | Owner shortening | Pilot × Solution "Field-test and accept the service ↻": "Who owns: Core Application Owner, Technical Partner, Field Testers +3". Explore × Solution "Map what already exists": "Who owns: **PMU**, Data Collection Agency, District Collector +1" (PMU bold). Same as HTML. | |
| 5.2f | No owner | "Secure funding" (Explore and the dashed Define tile), "Set goals and the output tier", "Design the voice experience for low-literacy users": a small **No owner named** pill after the name; "Who owns: *Not stated*" (italic). HTML: "Who owns: Not stated", no pill (intended difference, 0.4). | |
| 5.2g | Maturity pills on tiles | (App only, kept on purpose: decided 2026-11-05.) 13 jobs carry a pill on every one of their tiles, 19 tiles in all: **Thin** (8 jobs, e.g. "Secure funding"), **Estimate** (3, e.g. "Integrate into the live service"), **Needs check** (2: "Design the data collection plan", "Budget and resource the effort"). The HTML defines but never shows these. | |

### 5.3 Filters (app and HTML, same action in each)

Count the **un-dimmed** jobs and tiles after each action.

Console (app):

```js
const lit = () => { const t = [...document.querySelectorAll('button[data-code]')].filter((b) => !b.className.includes('opacity-[0.22]'));
  return `jobs ${new Set(t.map((b) => b.dataset.code)).size} tiles ${t.length} [${[...new Set(t.map((b) => b.dataset.code))].join(',')}]`; };
lit();
```

Console (HTML):

```js
const lit = () => { const t = [...document.querySelectorAll('#matrix .job:not(.dim)')];
  return `jobs ${new Set(t.map((b) => b.dataset.id)).size} tiles ${t.length} [${[...new Set(t.map((b) => b.dataset.id))].join(',')}]`; };
lit();
```

| # | Action (reset between rows unless stated) | Expected `lit()` (app = HTML; code order may differ) | Pass/Fail |
|---|---|---|---|
| 5.3a | Nothing | `jobs 40 tiles 57` | |
| 5.3b | **PMU owns** on | `jobs 11 tiles 14`: S1, P1, I2, S4, I4, E4, P6, I8, I10, E10, S14. The chip is filled, `aria-pressed="true"`. Dimmed tiles stay in place, faded (not removed). | |
| 5.3c | PMU owns off | Back to `jobs 40 tiles 57`, `aria-pressed="false"`. | |
| 5.3d | **Decide** on | `jobs 17 tiles 19`. | |
| 5.3e | Decide + **Deliver** on | `jobs 30 tiles 40` (type chips combine with OR). | |
| 5.3f | Decide on + PMU owns on | `jobs 6 tiles 7`: I2, S4, I4, E4, I8, I10 (AND across filter kinds). | |
| 5.3g | Search `survey` | `jobs 1 tiles 2`: E3 "Secure funding" (its intended result mentions the survey; "Understand the language community…" does not match, because search looks at code, name and intended result only). | |
| 5.3h | Search `s4` | `jobs 1 tiles 1`: S4 (the code is searched, case-insensitive). | |
| 5.3i | Search `budget` | `jobs 1`: I5. | |
| 5.3j | Search `zzz` | `jobs 0 tiles 0`: every tile dimmed; no "no results" message (same as HTML). | |
| 5.3k | Search `gate` + PMU owns | `jobs 1`: I8 "Decide at the gates and sign off". | |
| 5.3l | Clear all filters | `jobs 40 tiles 57`. | |
| 5.3m | A dimmed tile | Still clickable: opens its drawer (same in HTML). | |

### 5.4 Matrix layout

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.4a | Width ~1280 px | The matrix fits or scrolls **inside its own box** horizontally; the page itself doesn't scroll sideways (`document.documentElement.scrollWidth <= innerWidth` → `true`). | |
| 5.4b | Scroll the page down over the matrix | (Observe) Do the stage headers stay visible (sticky)? In the app the scroll container is the companion area, not the matrix box. Record. | |

---

## 6. Sequence tab (C, side by side)

App: **Sequence**. HTML: **Sequence**.

| # | Check | Expected (app = HTML) | Pass/Fail |
|---|---|---|---|
| 6.1 | Cards, in order | **Milestones**, **Stages and timing**, **Hard rules**. | |
| 6.2 | Milestones | "3 months": "A first keyword-spotting model is live in a pilot government service." "6 months": "A department queries a real service, such as a crop advisory line, by voice in the language and receives a voice response in the same language, with a few errors." "12 months": 6 bullets (dataset public on AIKosh, Bhashini or ULCA; model public on Bhashini or Hugging Face; tested service live to a larger public; another use case identified; methodology handbook published; evaluation metrics reported and quality targets set). Muted note under it: "These are targets, not reported results. The quality needed for each to count as met is set in the job on the quality bar and acceptance criteria." | |
| 6.3 | Phases | 14, each with its name and timing on the left, its text and job chips on the right. Console (app): `[...document.querySelectorAll('[role=tabpanel] h3')].map((h) => h.textContent + ' | ' + h.nextElementSibling.textContent + ' | ' + h.closest('.grid').querySelectorAll('button').length).join('\n')` | |
| 6.3a | Phase list (name \| timing \| chips) | `Readiness \| Before you start \| 6`, `Stage 0: Readiness and language confirmation \| Week 1 \| 3`, `Stage 1: Team mobilisation and departmental order \| Weeks 1–2 \| 4`, `Stage 2: Community engagement and script and dialect decision \| Weeks 2–4 \| 3`, `Stage 3: Scope definition, vendor selection and work order \| Weeks 4–6 \| 6`, `Stage 4: Language survey \| 1–2 months \| 2`, `Stage 5: Standards creation \| 1–2 months \| 2`, `Stage 6: Pilot collection \| About 1 month \| 4`, `Stage 7: Full collection, annotation and validation \| 6–9 months, in 2–3 rounds \| 15`, `Stage 8: Model building and benchmarking \| After Gate 1; about 1 week per fine-tuning cycle \| 4`, `Stage 9: Hosting and open release \| After Gate 2 \| 2`, `Stage 10: Application integration and field testing \| About 2 weeks, one time \| 2`, `Stage 11: Use-case acceptance and sign-off \| Repeats every cycle \| 2`, `Stage 12: Sustaining \| Ongoing, no exit \| 4`. (59 chips in all. "Stage N:" prefixes are right here: this is the contributor view, as in the HTML; adopters never see them.) | |
| 6.3b | Chips | Same names and order as the HTML in every phase; a job can appear in several phases (e.g. "Map what already exists" in Readiness, Stage 2 and Stage 4). Each chip opens that job's drawer. | |
| 6.4 | Note under the phases | "Stage names and timings follow the DC meeting checklist. Readiness comes from the playbook itself. Where neither gives timing, a job’s placement is an assumption. The source also gives two different durations: 6–9 months of active effort for foundation-building, and 9+ months for data collection alone." | |
| 6.5 | Hard rules | 12, each a bold rule and a muted reason. First: "A committed deployment application before any data collection starts." Rule 6, "Review each work order with the Steering Committee before the next stage proceeds.", has **no** reason line (the only one). Last: "Hold a dedicated proposal walkthrough before finalising a vendor." / "Cost assumptions get checked, not accepted on trust." Console (app): `document.querySelectorAll('[role=tabpanel] b.block').length` → `12`. | |

---

## 7. Five drawers, field by field (C, side by side)

Open each job in **both** (app: click its tile on Jobs map; HTML: click its tile). Compare top to
bottom. Expected values come from `content/playbooks/low-resource-language.json`.

**Drawer layout in both:** header `<code> · <work area>`, title, **Close**; a row of pills (type
with coloured dot, stage or "A to B", "↻ Recurs across rounds" if recurring); then **Intended
result**, **Why it matters**, **When**, **How it’s done** (bullets), **Checklist items** (only if
there are tasks: intro "From the DC meeting checklist, with the owner and timing given there.",
then each item with a **PMU** pill when the owner matches PxD, PMU or Nodal Officer’s team, and a
small line `<owner> · <stage>, <timing>` or `<owner> · Timing not stated`), **Who owns and who
tracks** (Who owns with **PMU** bold and *all* owners, Who tracks, owner note), a collapsed
**Roles as written in the playbook** (Owns, Does, Reviews, Enables; "Not stated" in muted italic),
**Gaps** (shaded box). **App only:** a **Maturity** section after Gaps when the job has a flag or
note, and a "No owner named" pill in the pill row for jobs without owners.

### 7.1 P1 "Understand the language community and the access gap"

| # | Field | Expected | Pass/Fail |
|---|---|---|---|
| 7.1a | Header, pills | `P1 · People and Problem`. Pills: **Discover**, **Explore**. No ↻, no "No owner named". | |
| 7.1b | Intended result | "Speakers, dialects and script status of the language are mapped, and the gap between the language people live in and the language services run in is understood." | |
| 7.1c | Why / When | Why: "Digital infrastructure gets built where data already exists, …" (not italic). When: "Week 1 for the language profile, then the language survey (1–2 months, after scope and vendor selection)." | |
| 7.1d | How it’s done | 3 bullets (secondary research; language survey 1–2 months; look at where services fail). | |
| 7.1e | Checklist items | **9** items. Item 1 has a **PMU** pill, owner line `Nodal Officer’s team · Stage 0, Week 1`. Items 2–9 have no pill: 2 `Data Collection Agency / Vendor + Technical Partner · Stage 4, Weeks 1–2 of the stage`; 5 `Data Collection Agency / Vendor · Stage 4, Weeks 5–8 of the stage (if full 2 months)`; 7 `Nodal Officer · Stage 4, Ongoing this stage`; 9 `Data Collection Vendor · Timing not stated`. | |
| 7.1f | Who owns and who tracks | Who owns: **PMU**, Data Collection Agency, Nodal Officer, Technical Partner, Linguistic Expert (all 5, no "+N"). Who tracks: PMU. Note: "The Nodal Officer’s team fills out the language profile (a PMU item). …". | |
| 7.1g | Roles as written | Expand: all four **Not stated** (muted italic). | |
| 7.1h | Gaps | 1 bullet: "How script disputes, the most common delay at this step, are settled …". | |
| 7.1i | Maturity (app) | **No** Maturity section (maturity is null). | |

### 7.2 P3 "Choose the deployment use case"

| # | Field | Expected | Pass/Fail |
|---|---|---|---|
| 7.2a | Header, pills | `P3 · People and Problem`. Pills: **Decide**, **Explore**, **↻ Recurs across rounds**. | |
| 7.2b | Intended result / Why | "A deployment use case is chosen with community input at the centre of the decision." / "A deployment that misses actual community need, …". | |
| 7.2c | When | "Timing not stated in the checklist. The playbook places it before data collection starts." | |
| 7.2d | How it’s done | 4 bullets, the last "Revisit the choice at the 12-month point, when another use case is identified for testing." | |
| 7.2e | Checklist items | **2**, **no** PMU pill on either: `Nodal Officer · Timing not stated`, `MahaVISTAAR · Timing not stated`. | |
| 7.2f | Who owns | Nodal Officer, Core Application Owner (no PMU, nothing bold). Who tracks: PMU. Note: "Owners in the DC checklist: Nodal Officer (defines the use case in plain language), MahaVISTAAR team (the deployment platform)." | |
| 7.2g | Roles as written | Owns, Does, Reviews: *Not stated*. Enables: "The language community (Community Heads and Community Contributors), whose input is at the centre of the decision." (not italic). | |
| 7.2h | Gaps / Maturity | 2 gaps ("Who makes the final choice.", "How candidate use cases are compared."). No Maturity section. | |

### 7.3 S4 "Design the data collection plan"

| # | Field | Expected | Pass/Fail |
|---|---|---|---|
| 7.3a | Header, pills | `S4 · Solution`. Pills: **Decide**, **Define**. No ↻. | |
| 7.3b | Intended result | "An agreed volume target and speaker mix, planned as two to three collection rounds." | |
| 7.3c | When | "Week 2 for the requirements study, Weeks 4–5 for the technical specification, then 2–3 collection rounds." | |
| 7.3d | How it’s done | **11** bullets, including both telephony figures (50%, and the DC checklist's "no less than 25%"), both minimum volumes (about 300 hours / 200K pairs, and 60–100 hours / 25,000–40,000 sentences) and both studio-hours figures (5–10 hours per speaker, 20 hours in total). | |
| 7.3e | Checklist items | **4**: 1 `Nodal Officer · Stage 1, Week 2` (no pill); 2 **PMU** pill, `Ecosystem Orchestrator (PxD/EkStep) · Stage 3, Week 4–5`; 3 `Data Collection Vendor · Timing not stated`; 4 `EkStep · Timing not stated`. | |
| 7.3f | Who owns | **PMU**, Nodal Officer, Data Collection Agency, EkStep. Who tracks: PMU. Note: "The technical specification (dataset type, quantity and the telephony, read and conversational split) is the Ecosystem Orchestrator’s (PxD/EkStep) item. The requirements study is the Nodal Officer’s." | |
| 7.3g | Roles as written | Owns *Not stated*; Does "PMU works out data collection requirements (types, quantity)."; Reviews *Not stated*; Enables "Champion co-signs the scope document." | |
| 7.3h | Gaps | 4 bullets (read-speech share, smaller/larger speaker base, the volume table is an image, the figures that differ). | |
| 7.3i | Maturity (app only) | A **Needs check** pill, then "Check the volume figures against the original AI4Bharat table, and against the different figures in the DC checklist." | |

### 7.4 I5 "Budget and resource the effort"

| # | Field | Expected | Pass/Fail |
|---|---|---|---|
| 7.4a | Header, pills | `I5 · Institution`. Pills: **Decide**, **Define**. | |
| 7.4b | Intended result / When | "A budget for foundation-building, plus the items outside it." / "Weeks 5–6 for vendor proposals and cost review. Honorarium approval timing is not stated." | |
| 7.4c | How it’s done | 4 bullets; the first is the reference budget (₹40 lakh, ₹6 lakh, ₹20 lakh, ₹4 lakh, subtotal about ₹70 lakh, plus 20% contingency, ₹84 lakh to ₹1 crore); the last "Champion’s own time: 5–6 hours a week …". | |
| 7.4d | Checklist items | **4**, **no** PMU pill: `DC’s Office + Steering Committee · Stage 3, Week 5–6`; `Data Collection Agency / Vendor / DC’s Office · Stage 7, Every week`; `District Collector · Timing not stated`; `AI4Bharat · Timing not stated`. (Item 1's text mentions PxD/EkStep, but the pill depends on the **owner** only: no pill. Same in HTML.) | |
| 7.4e | Who owns | DC’s Office, Steering Committee, Data Collection Agency, District Collector, Technical Partner (5, no PMU). Who tracks: PMU. Note: "Owners in the DC checklist: DC’s Office and Steering Committee (vendor proposals and cost), District Collector (honorarium approval)." | |
| 7.4f | Roles as written | Reviews: "Steering Committee approves budget and direction."; the other three *Not stated*. | |
| 7.4g | Gaps | 3 bullets (maintenance/Super Reviewer/new use-case costs; existing media labelling not costed; Gate 1 minimum lower than the reference budget). | |
| 7.4h | Maturity (app only) | **Needs check**: "The cost table is not reconciled with the AI4Bharat per-hour estimate. The champion hours are an informed estimate, not documented from a project." | |

### 7.5 E10 "Document and share the playbook"

| # | Field | Expected | Pass/Fail |
|---|---|---|---|
| 7.5a | Header, pills | `E10 · Ecosystem`. Pills: **Deliver**, **Scale**. | |
| 7.5b | Intended result / When | "A methodology handbook for dataset collection and model building, plus evaluation metrics, published for the next adopter." / "Ongoing. The handbook is published at the 12-month milestone." | |
| 7.5c | How it’s done | 2 bullets. | |
| 7.5d | Checklist items | **1**, with a **PMU** pill: "Keep this playbook current as the replication handbook — …", `PMU · Stage 12, Ongoing`. | |
| 7.5e | Who owns | **PMU** (only). Who tracks: PMU. Note: "PMU keeps the playbook current as the replication handbook." | |
| 7.5f | Roles / Gaps / Maturity | All four roles *Not stated*. 1 gap: "Who writes and maintains the handbook." No Maturity section. | |

### 7.6 Two more edge drawers (app)

| # | Open | Expected | Pass/Fail |
|---|---|---|---|
| 7.6a | E3 "Secure funding" (either tile) | Pills: **Decide**, **Explore to Define**, **No owner named**. **No** "Checklist items" section (no tasks). Who owns: *Not stated* (italic). Maturity: **Thin** pill and its note. HTML: same, minus the pill and Maturity. | |
| 7.6b | Opening from a dashed tile (e.g. Scale × Solution "Train, fine-tune and benchmark models") | The same drawer as from its solid tile (`S10`, "Pilot to Scale"). | |

---

## 8. Deep links and back/forward (C)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 8.1 | Click each section tab | URL: Overview → `/playbook` (no `?tab=`), Roles → `?tab=roles`, Jobs map → `?tab=map`, Sequence → `?tab=sequence`. The page doesn't scroll to the top on each click. | |
| 8.2 | Paste `/companion/low-resource-language/playbook?tab=sequence` in a **new tab** | Opens on Sequence. | |
| 8.3 | `…/playbook?tab=bogus`, then `?tab=` | Overview, no error. | |
| 8.4 | `…/playbook?tab=map&open=E10` in a new tab | Jobs map with the E10 drawer open, focus on Close. | |
| 8.5 | `…/playbook?open=S4` (no tab) | The S4 drawer opens **over the Overview** (intended difference from the HTML, 0.4). | |
| 8.6 | `…/playbook?tab=map&open=ZZ9`, then `?tab=map&open=s4` (lower case) | Jobs map, **no** drawer, no error. (Observe: the HTML accepts `#job-s4` in lower case; the app's `?open=` is case-sensitive, as on the adopter Jobs page. Record.) | |
| 8.7 | On `?tab=map`, open S4, then close it | URL `?tab=map&open=S4`, then back to `?tab=map` (the tab is kept). | |
| 8.8 | On Roles, open a chip's drawer, close, click **Sequence** | `?tab=sequence` (no stale `open=`). | |
| 8.9 | **Back/forward.** Start on the **Jobs** workspace tab. Click **Playbook**, then Roles, then Jobs map, open S4, close it. Press browser **Back** once. | Tabs and drawers use `router.replace`, so they add no history entries: Back returns to the **Jobs** workspace page (the page before Playbook), not to Roles. Record what happens. | |
| 8.10 | Press **Forward** | Back on the Playbook at the last URL (`?tab=map`), Jobs map showing, no drawer. | |
| 8.11 | Open `?tab=map&open=S4` from the address bar, press Back | (Observe) Leaves to whatever page was before. Record. | |
| 8.12 | With a drawer open, reload | The same tab and drawer come back. | |

---

## 9. Keyboard only (desktop width, C)

Put the mouse aside. Start on `/companion/low-resource-language/playbook`.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 9.1 | Tab from the top | Reaches, in order: the workspace tabs, Download playbook as JSON, Download source document, then the four section tabs. Each shows a visible focus ring (the browser default is fine). | |
| 9.2 | On "Roles", press Enter (and on "Jobs map", Space) | The tab switches. Only the selected tab is a Tab stop; Left/Right arrow keys move to the previous/next tab and select it (wrapping at the ends), and focus follows. | |
| 9.3 | Roles: Tab to the search box, type `pmu`, Tab to the group chips | Enter or Space selects a group; `aria-pressed` follows. | |
| 9.4 | Tab to "Owns 11 jobs in the checklist" (a `<summary>`) on the PMU card, press Enter; then Tab to its first chip and press Enter | The details expand; then the drawer opens with focus on **Close**. | |
| 9.5 | In the drawer, press Tab repeatedly | Focus moves Close → "Roles as written in the playbook" → back to **Close** (wraps). It never reaches the page behind the dimmed backdrop. | |
| 9.6 | On Close, press **Shift+Tab** | Focus goes to "Roles as written in the playbook". | |
| 9.7 | On "Roles as written…", press Enter | It expands; the four rows show. Tab still wraps. | |
| 9.8 | Press **Esc** | The drawer closes, `open=` leaves the URL, and focus returns to the **chip** that opened it (visible ring). Enter opens it again. | |
| 9.9 | Jobs map: Tab to the search box, then the type chips, then PMU owns | Each toggles with Enter/Space; `aria-pressed` updates. Keep Tabbing: focus moves into the matrix tiles, row by row (Explore → Scale within People and Problem, then Solution …). | |
| 9.10 | Enter on a tile, then **Close** with Enter | Drawer closes; focus returns to that tile. | |
| 9.11 | Sequence: Tab to a phase chip, Enter, Esc | Opens and closes; focus back on the chip. | |
| 9.12 | Open `?tab=map&open=S4` from the address bar, press Esc | Closes. (Observe: there was no opener, so focus falls to the page body. Record where the next Tab goes.) | |
| 9.13 | While the drawer is open, try to scroll the page behind with the wheel or arrow keys | The page behind doesn't scroll (the companion scroll area is locked); it scrolls again after closing. The drawer body scrolls on its own. | |

---

## 10. Downloads equal the export script (C)

### 10.1 Export from the database (terminal)

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
node --env-file=.env.local scripts/cube2/export-db.mjs --slug low-resource-language --out "<EXPORT_DIR>"
```

| Expected | Pass/Fail |
|---|---|
| `Wrote <EXPORT_DIR>/low-resource-language.json (40 jobs) and <EXPORT_DIR>/low-resource-language.source.md.` Exit code 0. (Read-only: it uses the service role for `select` only.) | |

### 10.2 Download from the app

On the Playbook screen click **Download playbook as JSON**, then **Download source document**.
Note where the browser saved them (`<DL_JSON>`, `<DL_MD>`).

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 10.2a | File names | `low-resource-language-YYYY-MM-DD.json` and `low-resource-language-YYYY-MM-DD.source.md`. (The date is today's **local** date.) | |
| 10.2b | Network | No request when clicking either button (generated in the browser). No log line. | |
| 10.2c | Chrome's download bar | No "insecure download" or "blocked" warning. (If Chrome renames to `… (1).json` because of an earlier run, use that file.) | |

### 10.3 Byte for byte (terminal)

```bash
git diff --no-index --exit-code "<EXPORT_DIR>/low-resource-language.json" "<DL_JSON>"; echo "json exit $?"
git diff --no-index --exit-code "<EXPORT_DIR>/low-resource-language.source.md" "<DL_MD>"; echo "md exit $?"
cmp "<EXPORT_DIR>/low-resource-language.json" "<DL_JSON>" && echo "json bytes identical"
cmp "<EXPORT_DIR>/low-resource-language.source.md" "<DL_MD>" && echo "md bytes identical"
```

| # | Expected | Pass/Fail |
|---|---|---|
| 10.3a | No diff output; `json exit 0`, `md exit 0`; both `bytes identical`. (`cmp` is the strict check: `git diff` can hide line-ending differences on Windows.) | |
| 10.3b | Round trip to the repo (the test project was re-seeded from it today): `git diff --no-index --exit-code content/playbooks/low-resource-language.json "<DL_JSON>"` and the same for `content/playbooks/low-resource-language.source.md` vs `<DL_MD>`: no output, exit 0. If this fails but 10.3a passes, the DB differs from the checked-in file (someone edited it after seeding): record which keys differ. | |

### 10.4 Content spot-checks on the downloaded JSON

```bash
node -e "const p=require(process.argv[1]);console.log(p.version,p.slug,p.jobs.length,p.roles.length,p.sequence.phases.length,p.sequence.rules.length,p.sequence.milestones.length,!!p.sequence.milestones_note,!!p.sequence.note,Object.keys(p).join(','),'source_doc' in p)" "<DL_JSON>"
```

| Expected | Pass/Fail |
|---|---|
| `1 low-resource-language 40 23 14 12 3 true true version,slug,title,description,overview,roles,sequence,jobs false` (the source document is a separate file, not in the JSON). | |

### 10.5 Optional: test-playbook export differs only where it should

Skip unless you want extra confidence. As C you can't open test-playbook's Playbook (2.6), so
there's no download to compare. Nothing to do here; noted so it isn't mistaken for a gap.

---

## 11. Nothing was written to the database

Run the snapshot (0.7) again, after sections 2–10, **before** section 12.

| # | Expected | Pass/Fail |
|---|---|---|
| 11.1 | Identical to 1.4 in every column (`playbooks`, `playbooks_upd`, `lrl_upd`, `jobs`, `jobs_upd`, `members_lrl`, `job_states`, `job_states_upd`, `conversations`, `conversations_upd`, `messages`, `assets`, `usage_total`). | |
| 11.2 | `members`: same as 1.4, **or** +1 only if 2.6c showed C's self-join row on test-playbook. Nothing else. | |
| 11.3 | The dev-server log has **no** `[companion-v2]` line since 1.4 (unless 2.6b ran a greeting on test-playbook; then `conversations`, `messages` and `usage_total` would also have moved, so prefer the `/jobs` route there). | |

---

## 12. The adopter chat still works, and knows the milestones (B, 1 model call)

Sign in as **B**. Go to `/companion/low-resource-language` (Home; B's latest conversation opens,
no greeting because it isn't empty). Send:

`How long will this take?`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 12.1 | Streaming | A normal reply streams. One `[companion-v2] stop=end_turn …` line. (Observe `cache_read`: the cached prefix changed with today's re-seed, so the first call after it may show `cache_read=0`; a second call would show `> 0`. Not required.) | |
| 12.2 | Milestones | The reply can now mention the **3/6/12-month milestones** (a first keyword-spotting model live in a pilot service at 3 months; a department querying a real service by voice at 6 months; the dataset and model public, the service live to a larger public, and the handbook published at 12 months) and says or implies they are **targets**, not reported results. Record whether it mentions them at all (it *can*, not *must*). | |
| 12.3 | No overstatement | No invented durations. Durations it gives come from the playbook (e.g. 6–9 months of collection in 2–3 rounds, 9+ months for data collection, 1–2 months for standards). If it gives one total, it should say the source gives two different durations (the sequence note). | |
| 12.4 | Plain language | No job codes (S4, E10 …), no "work area", "job type", no "Stage 7"-style numbering. No `<ui_action>` on screen. | |
| 12.5 | Stored | As postgres: `select left(content, 300) from companion_messages m join companion_conversations c on c.id = m.conversation_id join playbook_members pm on pm.id = c.member_id where pm.user_id = '<B>' and m.role = 'assistant' order by m.created_at desc limit 1;` shows this reply. `member_job_states` for B unchanged (asking isn't a state). | |
| 12.6 | Jobs tab | B's Jobs page still lists 40 jobs, Only mine 11 (no regression from the types change). | |

---

## 13. Phone width (375 px, C)

Devtools > device toolbar > a 375 px wide phone (e.g. iPhone SE), touch emulation on.

| # | Screen | Expected | Pass/Fail |
|---|---|---|---|
| 13.1 | Header | The description wraps; the two download buttons wrap below it, fully visible and tappable. Workspace tabs and the four section tabs scroll sideways inside their own rows if they don't fit. | |
| 13.2 | Overview | One column; every card full width; each label sits **above** its value (not in a squeezed column). Credits' bullets readable. | |
| 13.3 | Roles | Banner numbers side by side or wrapped; search box full width; group chips wrap; one card per row, no card wider than the screen. | |
| 13.4 | Jobs map | Controls wrap. The matrix scrolls sideways **inside its box** (it is 1070 px wide by design); the page itself doesn't. Console: `document.documentElement.scrollWidth <= innerWidth` → `true`. | |
| 13.5 | Sequence | Each phase stacks: name and timing above, text and chips below. Milestones labels above values. | |
| 13.6 | Drawer (S4) | Full width; title and **Close** visible; the body scrolls; the page behind doesn't. Checklist items, owners and gaps wrap. Close and backdrop-free area: tapping Close works. | |
| 13.7 | Repeat 13.4's console check on every tab | `true` each time. | |

---

## 14. Flag off (optional, 1 restart)

Comment out `NEXT_PUBLIC_CUBE_VERSION` in `.env.local` and restart. As C, go to
`/companion/low-resource-language/playbook`.

| Expected | Pass/Fail |
|---|---|
| 404 (the companion layout doesn't exist without the flag). Nav shows Explore, Analyse, Contribute. | |

Put `NEXT_PUBLIC_CUBE_VERSION=2` back and restart.

---

## 15. Things to record

Not pass/fail by themselves.

| Measure | Details |
|---|---|
| Model calls (dev-server log lines) vs. the 1 expected | |
| 2.3: P sees the "almost ready" gate or a 404? | |
| 2.4: `?tab=` dropped from `next` on the login redirect | |
| 2.6c: C self-joined test-playbook as an adopter just by opening its Playbook URL (acceptable?) | |
| 4.4h: Roles search/group reset on switching tabs (the HTML keeps them) | |
| 5.2g: maturity pills on tiles (app only; not in the HTML) | |
| 5.4b: sticky stage headers | |
| 8.6: `?open=` is case-sensitive (HTML's `#job-` isn't) | |
| 8.9 / 8.11: Back leaves the Playbook instead of stepping through tabs | |
| 9.12: focus after closing a deep-linked drawer | |
| 12.2: did Cube mention the milestones, and as targets? | |

---

## 16. Clean up (test project only)

- `.env.local`: `NEXT_PUBLIC_CUBE_VERSION=2` on. Restart if you ran 14.
- Delete `<EXPORT_DIR>` and the two downloads (they are copies; nothing in the repo changed).
- If 2.6c created C's adopter row on test-playbook and you don't want it (as postgres):
  `delete from playbook_members where playbook_id = '<TEST_ID>' and user_id = '<C>' and member_role = 'adopter';`
- B's section 12 turn can stay, or be deleted from B's sidebar (🗑).

---

## Acceptance criteria to steps

| Slice 4a acceptance criterion / requested check (plan) | Steps | Pass/Fail |
|---|---|---|
| Overview matches the HTML: every overview card (7), with Credits and CC BY 4.0 | 3 | |
| Roles match the HTML: all 23 roles (+ EkStep under "Named in the checklist"), banner 11 / 40, group chips, search, owned and named job chips | 4 | |
| Jobs map matches the HTML: all 40 jobs, 57 tiles with 17 dashed continuations, ↻, stage headers, area rows, legend and note; "No owner named" on P4, S3, E3 | 5.1, 5.2 | |
| Sequence matches the HTML: milestones (3) with note, all 14 phases with their job chips, the sequence note, all 12 rules | 6 | |
| The drawer shows the same fields as the HTML drawer (plan test 1: P1, P3, S4, I5, E10), plus the Maturity section the HTML lacks | 7 | |
| Search, type chips and "PMU owns" filter the same way the HTML does (plan test 2) | 5.3, 4.4 | |
| Adopters get a 404 on `/playbook`; pending and signed-out users never see it; a contributor to one playbook gets a 404 on another's | 2.2, 2.3, 2.4, 2.6 | |
| `?tab=` and `?open=` deep links; back/forward behaviour | 8 | |
| Keyboard: tabs, chips, drawer focus on Close, Tab/Shift+Tab trapped, Esc closes, focus returns | 9 | |
| The downloaded JSON equals `export-db.mjs` output for the same playbook, byte for byte (plan test 3); the downloaded source document equals the exported `.source.md` | 10 | |
| Read-only: browsing the Playbook writes nothing to the database | 2.1d, 11 | |
| Clean at phone width (375 px) | 13 | |
| Adopter Home chat still works, and Cube can use the new milestones as targets | 12 | |
| Flag off: the Playbook route doesn't exist | 14 (optional) | |
