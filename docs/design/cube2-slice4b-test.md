# Cube 2.0 Slice 4b: manual test script

Branch `cube-2`. This covers what Slice 4b delivers (see `docs/design/cube2-plan.md`, "Slice 4b",
section 5 "Patch format" / "Applying a patch", and section 7 "Edit controls"):

- the edit controls on the contributor **Playbook** screen (`PlaybookView.tsx`, `OverviewTab.tsx`,
  `RolesTab.tsx`, `JobsMapTab.tsx`, `SequenceTab.tsx`, `JobDrawer.tsx`, `shared.tsx`: the `✎` buttons);
- the edit dialog and forms in `components/companion-v2/playbook/edit/` (`EditDialog.tsx`,
  `forms.tsx`: `JobEditForm`, `NewJobForm`, `RoleForm`, `OverviewForm`, `PhaseForm`, `RulesForm`,
  `MilestonesForm`, `StagesNoteForm`; `inputs.tsx`);
- `lib/companion-v2/patch.ts` (`applyOps`, `checkGuards`, the soft `checkWarnings`, `toSave`, and
  `listOps`, which turns an edited How / Gaps / Checklist list into item ops),
  `lib/companion-v2/patch-display.ts` (card labels and before/after text, `beforeAfter`) and
  `lib/companion-v2/save.ts` (the one `save_playbook` RPC call and its error messages);
- the diff and Apply screen, `components/companion-v2/PatchReview.tsx` (ops previewed in order:
  each card's before/after is the playbook just before and after that op, after the earlier ticked
  ops);
- the committed `save_playbook()` in `supabase/migrations/0034_cube2_playbooks.sql` (contributor
  check, row lock, stale check, upsert/delete, removed-job markers, content guards, all in one
  transaction);
- `scripts/cube2/check-patch.mjs`.

**This script reflects the code after the code-review fixes** (list fields as item ops, the
duplicate-code and stage checks on a new job, the drawer closing after its job is removed, in-order
previews with job names in step diffs, the "PMU no longer tracks" warning, the dialog's focus and
"Close without saving?" behaviour, "Updating…" after Apply, the checklist-row check).

**Already checked automatically, so only spot-checked here:** `check-patch.mjs` (now 66/66); an end-to-end
PGlite save of nine op types whose stored result matched the preview; the dialog and the diff screen
in a browser. This script covers what needs the real test project: real sessions and RLS, two
browsers, the adopter's view of a change, the stale and guard errors from the database, and the
model.

**Not covered here, because later slices build them:** the source-document ops in a UI (they exist
in `patch.ts` and are covered by `check-patch.mjs`, but only Update with Cube and the Source document
screen use them: Slice 4d), contradictions in `PatchReview` (4d), Assets (4c), Conversations (5).

> **Edits in this script go LIVE on the test project, and there is no history.** Section 1 (backup)
> is mandatory before anything else, and section 19 (restore) is mandatory at the end. If you stop
> part-way for any reason, go straight to section 19. Every test edit contains the marker
> **`QA-4b`**, so leftovers can be found with SQL (0.8).

**Cost.** One Anthropic call (section 7.4). Per the Product Charter, the Anthropic account in
`.env.local` was a free trial due to expire on **28-Oct-2026** (TD-16), which is already past. If
that call fails with a 401 or 403, check the account before recording a failure.

---

## 0. Before you start

### 0.1 Safety check: are you pointed at the TEST project?

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local
git branch --show-current
node --version
```

| Expected | Pass/Fail |
|---|---|
| The project ref matches the **test** project. The branch is `cube-2`. Node is **22.18 or later** (`check-patch.mjs` runs the `.ts` file directly). **If the ref is production, stop here.** | |

### 0.2 `.env.local` and the dev server

`NEXT_PUBLIC_CUBE_VERSION=2` is set. `COMPANION_DAILY_MESSAGE_CAP` and
`COMPANION_V2_FAIL_AFTER_CHARS` are **not** set. Start `npm run dev`. The terminal is the
**dev-server log**: each model call prints one `[companion-v2] stop=... in=... cache_read=...` line.
Editing and saving the playbook must **never** print one (saving is a browser-to-Supabase RPC, no
`/api` route).

### 0.3 Test accounts (same as Slice 4a)

| Name | Purpose | Roles |
|---|---|---|
| **A** | Admin. Only needed if C has lost the contributor row (1.4). | Listed in `ADMIN_EMAILS` |
| **B** | Adopter. Checks that changes reach adopters, sets one marker, the RPC negative. | `adopter`, `lrl_role adopter` |
| **C** | Contributor to the main playbook. **Does almost all of this script.** | `adopter`, `playbook_members.member_role = contributor` on `low-resource-language` only |

Use **two browsers** (or a normal and a private window): one for C, one for B. Section 14 also needs
a **second tab** in C's browser.

### 0.4 Values to fill in as you go

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>`, `<TEST_ID>` | | 1.4 |
| `<B>`, `<C>` (user ids) | | 1.4 |
| `<BACKUP_DIR>` (an empty folder **outside** the repo, e.g. `D:/cube2-4b-backup`) | | 1.1 |
| `<DL_JSON>`, `<DL_MD>` (the two downloads in 1.2) | | 1.2 |
| `<FP_0>` (the whole fingerprint row before any edit) | | 1.5 |
| `<B_STATES_0>` (B's marker rows before any edit) | | 1.6 |
| `<AFTER_DIR>` (a second empty folder outside the repo, e.g. `D:/cube2-4b-after`) | | 19.2 |

### 0.5 SQL in the Supabase SQL Editor

Same rules as Slice 4a, section 0.6:

- Blocks marked **"as postgres"** run as the superuser (RLS ignored), for setup and checking.
- The editor shows only the **last** statement's result.
- `current transaction is aborted` → run `rollback;` on its own and carry on.

### 0.6 The fingerprint query (as postgres), "FP"

One row that changes if anything in the playbook changes. Used for every "nothing changed" check.

```sql
select p.updated_at,
       p.updated_by,
       p.title,
       (select count(*) from playbook_jobs j where j.playbook_id = p.id)       as jobs,
       jsonb_array_length(p.roles)                                              as roles,
       jsonb_array_length(p.sequence->'phases')                                 as phases,
       jsonb_array_length(p.sequence->'rules')                                  as rules,
       jsonb_array_length(coalesce(p.sequence->'milestones', '[]'))             as milestones,
       (select count(*) from member_job_states s
          join playbook_members m on m.id = s.member_id
          where m.playbook_id = p.id)                                           as states,
       md5(p.description)                                                       as desc_md5,
       md5(p.overview::text)                                                    as overview_md5,
       md5(p.roles::text)                                                       as roles_md5,
       md5(p.sequence::text)                                                    as sequence_md5,
       md5(p.source_doc)                                                        as source_md5,
       (select md5(string_agg(job_code || '|' || name || '|' || coalesce(position::text,'') || '|'
                              || array_to_string(stages, ',') || '|' || body::text, '¦' order by job_code))
          from playbook_jobs j where j.playbook_id = p.id)                      as jobs_md5
from playbooks p
where p.slug = 'low-resource-language';
```

### 0.7 "What did the last save touch?" (as postgres), "LAST"

```sql
select job_code, name, updated_at,
       updated_at = (select updated_at from playbooks where id = '<LRL_ID>') as in_last_save
from playbook_jobs
where playbook_id = '<LRL_ID>'
order by updated_at desc, job_code
limit 5;
```

`save_playbook` stamps the playbook and every job it writes with the same timestamp, so
`in_last_save = true` lists exactly the jobs the last save wrote.

### 0.7a Closing a dialog, and "Updating…"

Wherever this script says **Cancel**, **Close** or **Back to the form, Cancel** after you typed
something, the dialog asks "Close without saving? Your changes here will be lost." Answer **OK**
unless the step says otherwise. With nothing typed it closes at once (checked in 4.7, 4.8, 16).
After every **Apply**, wait until "Updating…" next to the header buttons has gone before opening
the next ✎ (the ✎ buttons do nothing while it shows; 5.5g).

### 0.8 Leftover test edits (as postgres), "QA"

```sql
select 'playbook' as where_, null as job_code
from playbooks
where slug = 'low-resource-language'
  and concat_ws(' ', title, description, overview::text, roles::text, sequence::text, source_doc) like '%QA-4b%'
union all
select 'job', job_code
from playbook_jobs
where playbook_id = '<LRL_ID>'
  and (job_code like 'QA%' or name like '%QA-4b%' or body::text like '%QA-4b%');
```

---

## 1. BACKUP (mandatory, before any edit)

### 1.1 Export from the database (terminal)

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
node --env-file=.env.local scripts/cube2/export-db.mjs --slug low-resource-language --out "<BACKUP_DIR>"
```

| Expected | Pass/Fail |
|---|---|
| `Wrote <BACKUP_DIR>/low-resource-language.json (40 jobs) and <BACKUP_DIR>/low-resource-language.source.md.` Exit code 0. **Do not delete this folder until section 19 has passed.** | |

### 1.2 Download from the app (a second copy)

Sign in as **C**. Companion > "Low-resource language AI adoption" > **Playbook**. Click **Download
playbook as JSON**, then **Download source document**. Note where they were saved (`<DL_JSON>`,
`<DL_MD>`).

```bash
cmp "<BACKUP_DIR>/low-resource-language.json" "<DL_JSON>" && echo "json identical"
cmp "<BACKUP_DIR>/low-resource-language.source.md" "<DL_MD>" && echo "md identical"
```

| Expected | Pass/Fail |
|---|---|
| `json identical`, `md identical` (as in Slice 4a, 10.3). If not, stop: the backup isn't trustworthy. | |

### 1.3 Is the database still the checked-in seed? (information only)

```bash
git diff --no-index --stat content/playbooks/low-resource-language.json "<BACKUP_DIR>/low-resource-language.json"; echo "exit $?"
```

| Expected | Pass/Fail |
|---|---|
| `exit 0` if nobody has edited the playbook since the re-seed. A non-zero exit is not a failure, but then the **exact numbers in this script** (40 jobs, 11 bullets on S4, 9 checklist items on P1 …) may differ: record which, and use the backup (not the repo file) for the restore in any case. | |

### 1.4 Pre-flight (as postgres)

```sql
select u.email, u.id as user_id,
       (select id from playbooks where slug = 'low-resource-language') as lrl_id,
       (select id from playbooks where slug = 'test-playbook')         as test_id,
       (select member_role from playbook_members m
          join playbooks p on p.id = m.playbook_id
          where m.user_id = u.id and p.slug = 'low-resource-language') as lrl_role
from auth.users u
where u.email in ('<B email>', '<C email>')
order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| C: `lrl_role contributor`. B: `lrl_role adopter`. **Copy `<LRL_ID>`, `<TEST_ID>`, `<B>` and `<C>`.** If C isn't `contributor`: as **A**, `/admin` > **Playbook contributors** > "Low-resource language AI adoption" > add C > **Add as contributor**, then re-run. | |

### 1.5 Fingerprint before (FP, 0.6)

| Expected | Pass/Fail |
|---|---|
| `jobs 40`, `roles 23`, `phases 14`, `rules 12`, `milestones 3`. **Save the whole row as `<FP_0>`** (copy it to a text file). | |

### 1.6 B's markers before (as postgres)

```sql
select s.job_code, s.state, s.set_by, s.note
from member_job_states s
join playbook_members m on m.id = s.member_id
where m.user_id = '<B>' and m.playbook_id = '<LRL_ID>'
order by s.job_code;
```

| Expected | Pass/Fail |
|---|---|
| Any number of rows. **Save them as `<B_STATES_0>`.** None has a `job_code` starting `QA`. (This script removes only a job it adds itself, so these rows must be identical at the end; the restore does **not** bring back marker rows.) | |

---

## 2. `check-patch.mjs` (no database, no browser)

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
node scripts/cube2/check-patch.mjs; echo "exit $?"
```

| # | Expected | Pass/Fail |
|---|---|---|
| 2.1 | 66 lines starting `PASS`, none starting `FAIL`, then `66 passed, 0 failed` and `exit 0`. (A Node "type stripping is experimental" warning is harmless.) | |
| 2.2 | Among them (the plan's named checks): `job.remove_item with a stale expect fails`, `job.replace_item replaces in place`, `missing heading fails`, `duplicate heading fails`, `replace with missing text fails`, `replace with repeated text fails`, `removing CC BY 4.0 is caught`, `"Only for Author" (odd spacing) is caught`, `"only for authorised staff" is allowed`. | |
| 2.3 | And the checks added with the code-review fixes: `adding one task gives a single job.append`, `editing one task gives one job.replace_item`, `removing two tasks gives two remove_item, highest first`, `a reorder gives one whole-list job.set`, `clearing gives job.set []`, `duplicate job in a step fails`, `remove then re-add the same code fails`, `job.add with no stages fails`, `job.add with an unknown area fails`, `job.add with a fractional position fails`, `source.replace with no replacement fails`, `roles as an array fails`, `phase.add with no "after" goes at the end`, `replace_section leaves the rest of the document byte-for-byte`, `dropping PMU from Who tracks gives a warning`. (Re-using a removed code in the same change, and the source ops, can't be reached from the 4b forms, so these checks are their only coverage here.) | |

---

## 3. Where the edit controls are (C) and aren't (B)

### 3.1 C's Playbook screen

As **C**, on `/companion/low-resource-language/playbook`. Each `✎` button is small, outlined, accent
text.

| # | Where | Expected | Pass/Fail |
|---|---|---|---|
| 3.1a | Header (next to the download buttons) | **✎ Edit title and description**. | |
| 3.1b | Overview | A **✎ Edit** on the right of each of the 7 card titles (Purpose, Context, Based on, Outcomes, Key insights, Maturity flags, Credits). Hover in devtools: `aria-label="Edit Purpose: what this playbook is for"` etc. | |
| 3.1c | Roles | **✎ Add a role** after the group chips. A **✎ Edit** on each of the 23 real role cards (`aria-label="Edit role: Champion"` …). **No** ✎ on the 24th card, **EkStep** ("Named in the checklist"): it isn't a role in the playbook. Console: `document.querySelectorAll('[aria-label^="Edit role:"]').length` → `23`. | |
| 3.1d | Jobs map | **✎ Add a job** at the right end of the controls row. Tiles have no ✎ (editing a job is from its drawer). | |
| 3.1e | Any job drawer (open S4) | **✎ Edit this job** next to **Close**. | |
| 3.1f | Sequence | Milestones card: **✎ Edit**. Stages and timing: **✎ Add a step at the start** and **✎ Edit the note on the stages** under the title; under each of the 14 step names a **✎ Edit** and **✎ Add a step after**. Hard rules card: **✎ Edit**. | |
| 3.1g | Dev-server log, Network | No `[companion-v2]` line. Opening and closing dialogs makes no request. | |

### 3.2 B sees no edit controls

In the other browser, as **B**: `/companion/low-resource-language/jobs`, open any job (e.g. `?open=S4`).

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 3.2a | Tabs | Home and Jobs only. | |
| 3.2b | Console on the Jobs page with a sheet open: `[...document.querySelectorAll('button')].filter((b) => b.textContent.includes('✎')).length` | `0`. | |
| 3.2c | `/companion/low-resource-language/playbook` | 404 (as in 4a). | |

(B's direct RPC call is in section 15.)

---

## 4. The dialog and "Review changes" (C, using S4)

Jobs map > open **Design the data collection plan** (S4) > **✎ Edit this job**.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 4.1 | Look | A dialog over a dimmed page. Small grey "Edit", title **Design the data collection plan**, **Close** top right. The S4 drawer is hidden while the dialog is open. Focus is in the first field, **Name**. | |
| 4.2 | Fields are filled in | Name; Intended result; Why it matters; When ("Week 2 for the requirements study, Weeks 4–5 for the technical specification, then 2–3 collection rounds."); How it’s done (11 lines); Checklist items (4 rows, each with stage, timing, owner, text, ↑ ↓ Remove); Who owns `PMU, Nodal Officer, Data Collection Agency, EkStep`; Who tracks `PMU`; Note on who owns; four "Roles as written" fields (Does = "PMU works out data collection requirements (types, quantity).", Enables = "Champion co-signs the scope document."); Gaps (4 lines); Maturity flag **Needs check** and its note; "Recurs in each build round" **unticked**. At the bottom: **Review changes**, Cancel, and **Remove this job** (red). | |
| 4.3 | Change nothing | **Review changes** is disabled (faded, not clickable). | |
| 4.4 | Add a space at the end of When; add an empty line at the end of How | Still disabled (values are trimmed and empty lines dropped before comparing). | |
| 4.5 | Change one character of When, then change it back | Enabled, then disabled again. | |
| 4.6 | Type in Who owns `PMU, Nodal Officer, Data Collection Agency, EkStep, ` (trailing comma and space) | The box keeps **exactly** what you typed (the trailing `, ` stays; it isn't reformatted as you type). **Review changes** still disabled (empty names are dropped when comparing). | |
| 4.7 | Close the dialog (**Cancel**; if it asks "Close without saving?", OK, because 4.4–4.6 typed something). Open **✎ Edit this job** again and press **Cancel** straight away | The second time it closes **at once**, no question; the S4 drawer is back. Nothing saved (no toast; FP unchanged at the end of the section). | |
| 4.8 | Open again, change When, then press **Close** | Confirm "Close without saving? Your changes here will be lost." **Cancel** → still in the form, the change still typed. **Close** again, **OK** → closes, nothing saved. Same with **Cancel** at the bottom. (Typing and then undoing a change still counts as typed: it asks.) | |
| 4.9 | Open again. **+ Add a checklist item**; fill only Stage `Stage 4` and Owner `PMU`, no text | Red line under the form: "Checklist item 5 needs its text (or clear the row)." **Review changes** disabled. Clear Stage and Owner again: the message goes (the empty row is dropped) and Review is disabled because nothing changed. **Cancel**, OK. | |

---

## 5. Edit a job's how: diff, include boxes, "Edit this change", Apply (C, S4)

Plan acceptance: "Editing a job's how shows a diff, and Apply makes it visible to an adopter
immediately."

### 5.1 Make three changes

S4 drawer > **✎ Edit this job**:

1. **When**: change the end to `then 2–3 collection rounds of about 3 months each (QA-4b).`
2. **How it’s done**: add a 12th line: `Hold a review call with the data collection vendor every Tuesday at 4 pm (QA-4b).`
3. Tick **Recurs in each build round**.

Click **Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.1a | Header and focus | Caption changes to "Review your changes"; same title. Focus moves to the **first card's checkbox**. | |
| 5.1b | Cards | **3** cards, in this order, each with a ticked checkbox: "Design the data collection plan → When", "Design the data collection plan → How, in short: **add an item**" (a single `job.append`, because the line was added at the end), "Design the data collection plan → Recurs across rounds". | |
| 5.1c | When card (word diff) | One paragraph: the old text in normal ink, **only** "of about 3 months each (QA-4b)" (and the moved full stop) highlighted green; "rounds." shows a small red struck-through change at most. Nothing else coloured. | |
| 5.1d | How card (folded line diff) | Monospace block: `… 8 unchanged lines …`, then the old bullets 9–11 as plain `•` lines, then one green `+ • Hold a review call … every Tuesday at 4 pm (QA-4b).` line. **No** red lines (the last old bullet is not shown as removed and re-added). | |
| 5.1e | Recurs card | Word diff: `No` struck red, `Yes` green. | |
| 5.1f | Footer | **Apply** (no count, because all 3 apply), **Back to the form**, and "Changes go live as soon as you apply them. There is no undo." | |
| 5.1g | Dev-server log, Network | No request yet. | |

### 5.2 Include checkboxes and "Apply N of M"

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 5.2a | Untick the **Recurs** card | That card fades. Button reads **Apply 2 of 3**. | |
| 5.2b | Tick it again, untick all three | Button **Apply 0 of 3**, disabled. | |
| 5.2c | Tick all three again | **Apply**, enabled. | |

### 5.3 "Edit this change", valid and invalid

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 5.3a | On the When card, **Edit this change** | A textarea with the new When as **plain text** (no quotes, no JSON). The link reads **Done editing**. | |
| 5.3b | On the How card, **Edit this change** | A textarea with **only the new line**, as plain text (the appended item is a string). | |
| 5.3c | In it, change `4 pm` to `5 pm` | The How diff updates as you type: the green line now ends "at 5 pm (QA-4b).". **Done editing** hides the textarea and keeps the edit. | |
| 5.3d | On the Recurs card, **Edit this change** | A textarea with `true` (JSON). | |
| 5.3e | Change it to `tru` (invalid JSON) | Red line under the card: "This edit isn’t valid. Check the brackets and quotes." The card border turns reddish; the diff falls back to the original proposal (No → Yes); the button reads **Apply 2 of 3**. | |
| 5.3f | Change it to `"yes"` (valid JSON, wrong type) | Red line: `"recurs" must be true or false.` Still **Apply 2 of 3**. | |
| 5.3g | Change it back to `true`, **Done editing** | Errors gone; **Apply**. | |

### 5.4 Back to the form keeps the form edits

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 5.4a | **Back to the form** | The form again, focus on its first field (Name), with **all three** typed changes still there (When, 12th How line with **4 pm**, Recurs ticked). | |
| 5.4b | **Review changes** again | 3 cards, all ticked, How back to **4 pm**. Expected: the review's include boxes and "Edit this change" edits reset when you go back; the form is the source. | |
| 5.4c | Untick the Recurs card; on the How card change `4 pm` to `5 pm` (as in 5.3c) | **Apply 2 of 3**. | |

### 5.5 Apply

Click **Apply 2 of 3**. (To see 5.5g, first set devtools > Network throttling to "Slow 4G"; set it
back afterwards.)

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.5a | Button | Briefly **Applying…**, then the dialog closes and a toast "Saved. The change is live." The S4 drawer shows the new When and 12 How bullets **without** a manual reload, and **no** ↻ pill (Recurs was left out). | |
| 5.5b | Network | One `POST …/rest/v1/rpc/save_playbook` (to the Supabase host, **not** `/api/…`), status 200, response body a timestamp string. Then the page's own refresh request. No `[companion-v2]` line. | |
| 5.5c | Request payload (devtools > the rpc call > Payload) | `p_playbook` is `{}` (no playbook keys changed); `p_jobs` has **one** row, `job_code "S4"`, with the whole job (`name`, `position`, `stages`, `work_area`, `job_type`, `body`); `p_removed_jobs` is `[]`; `p_base_updated_at` is the same instant as FP's `updated_at` from 1.5, with all six decimal places (ISO format here, `+00` format in the SQL editor). | |
| 5.5d | As postgres: `select body->>'when', body->'how_summary'->>11, jsonb_array_length(body->'how_summary'), body->'recurs' from playbook_jobs where playbook_id = '<LRL_ID>' and job_code = 'S4';` | `…of about 3 months each (QA-4b).`, `Hold a review call … every Tuesday at 5 pm (QA-4b).`, `12`, `false`. | |
| 5.5e | LAST (0.7) | Only `S4` has `in_last_save = true`. | |
| 5.5f | `select updated_at, updated_by from playbooks where id = '<LRL_ID>';` | `updated_at` later than `<FP_0>`'s; `updated_by = <C>`. | |
| 5.5g | While the page reloads after Apply (throttled) | "**Updating…**" appears next to the header buttons (left of ✎ Edit title and description). Clicking any ✎ while it shows does **nothing** (no dialog opens); once it goes, the ✎ buttons work again. | |

---

## 6. List fields: add, edit, delete, reorder (C, P1 and S4)

Plan acceptance: "Adding one checklist task produces a single `job.append`, not a rewrite of the
whole list." The form turns How, Gaps and Checklist items into the smallest ops: items added at the
end are one `job.append` each; items edited in place are `job.replace_item`; deleted items are
`job.remove_item` (highest index first); a reorder, a mix of these, or clearing the list is one
whole-list `job.set`.

### 6.1 Add one checklist item (P1, `job.append`)

Open **Understand the language community and the access gap** (P1) > **✎ Edit this job**. Under
Checklist items (9 rows) click **+ Add a checklist item**.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 6.1a | Leave the new row empty | **Review changes** stays disabled (a fully empty row is dropped). | |
| 6.1b | Fill: Stage `Stage 4`, Timing `Week 3`, Owner `PMU`, Text `Confirm the survey sample list with the Linguistic Expert (QA-4b).` → **Review changes** | **One** card: "Understand the language community and the access gap → Checklist items: **add an item**". | |
| 6.1c | **Edit this change** on that card | **One** JSON object with `stage`, `timing`, `owner`, `text` (the new item), not the whole list. **Done editing** without changing anything. | |
| 6.1d | Diff | `… 6 unchanged lines …`, three plain context lines (items 7–9), then **one** green line `+ • Stage 4, Week 3 · PMU: Confirm the survey sample list with the Linguistic Expert (QA-4b).`. No red lines. | |
| 6.1e | **Apply** | Toast; P1 drawer shows 10 checklist items; the new one has a **PMU** pill and `PMU · Stage 4, Week 3`. | |
| 6.1f | As postgres: `select jsonb_array_length(body->'tasks'), body->'tasks'->9 from playbook_jobs where playbook_id = '<LRL_ID>' and job_code = 'P1';` | `10`, and item 10 is exactly the four fields typed (trimmed). Items 1–9 unchanged (compare item 1 with the drawer). | |

### 6.2 Edit one item in place (P1, `job.replace_item`)

Wait until "Updating…" has gone. P1 > ✎ Edit this job. In checklist item 1, change Timing `Week 1`
to `Week 1 (QA-4b)`. **Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 6.2a | Card | **One**: "… → Checklist items: **change item 1**". | |
| 6.2b | Diff | Red `- • Stage 0, Week 1 · Nodal Officer’s team: Fill out the one-page Language Profile form …`, green `+ • Stage 0, Week 1 (QA-4b) · Nodal Officer’s team: …`, then three plain lines and `… 6 unchanged lines …`. | |
| 6.2c | **Edit this change** | One JSON object (the new item 1). **Done editing**. | |
| 6.2d | **Apply**; as postgres: `select jsonb_array_length(body->'tasks'), body->'tasks'->0->>'timing', body->'tasks'->9->>'text' from playbook_jobs where playbook_id = '<LRL_ID>' and job_code = 'P1';` | `10`, `Week 1 (QA-4b)`, the 6.1 item's text. | |

### 6.3 Delete two items (S4 Gaps, two `job.remove_item`)

S4 > ✎ Edit this job. **Gaps** has 4 lines. Delete line 2 ("How the mix changes for a much smaller or
larger speaker base.") and line 4 ("The playbook and the DC checklist give different figures …").
**Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 6.3a | Cards | **Two**, highest index first: "Design the data collection plan → Gaps: **remove item 4**", then "… → Gaps: **remove item 2**". Neither has "Edit this change". | |
| 6.3b | Diffs, in order | Card 1: three plain lines, then red `- • The playbook and the DC checklist give different figures …`. Card 2 is previewed **after** card 1 (3 lines before it): plain line 1, red `- • How the mix changes …`, plain "The volume table …". No green lines. | |
| 6.3c | Untick card 1 | Card 2 still has no error (its index is still valid); **Apply 1 of 2**. Tick it again: **Apply**. | |
| 6.3d | **Apply**; as postgres: `select body->'gaps' from playbook_jobs where playbook_id = '<LRL_ID>' and job_code = 'S4';` | Exactly the original items 1 and 3: `["The budget assumes 100 of 300 hours …", "The volume table is an image in the source, …"]`. | |

### 6.4 Reorder (P1, one whole-list `job.set`)

P1 > ✎ Edit this job. On checklist item **10** (the QA-4b one) press **↑** once. **Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 6.4a | Card | **One**: "… → Checklist items" (no ": add an item / change item / remove item" suffix). | |
| 6.4b | **Edit this change** | A JSON **array of 10** objects (the whole list). **Done editing**. | |
| 6.4c | Diff | A fold, then the QA-4b line moving above "Timing not stated · Data Collection Vendor: Map dialect variation …" (one line shown red in one place and green in the other). No other line coloured. | |
| 6.4d | **Apply**; as postgres: `select body->'tasks'->8->>'text', body->'tasks'->9->>'text' from playbook_jobs where playbook_id = '<LRL_ID>' and job_code = 'P1';` | Item 9 is the QA-4b item; item 10 "Map dialect variation across the district and set sampling quotas." | |

### 6.5 Clearing and a mix (don't apply)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 6.5a | S4 > ✎ Edit this job. Delete both remaining Gaps lines → Review | **One** card "… → Gaps": both lines red, `+ (empty)` green. **Edit this change** shows `[]`. | |
| 6.5b | **Back to the form**; put the two gaps back exactly as they were; in **How** change one word of line 1 **and** add a line at the end → Review | **One** card "… → How, in short" (a mix is one whole-list `job.set`): one -/+ pair for line 1 and a green new last line. | |
| 6.5c | **Close** → "Close without saving? Your changes here will be lost." → OK | Nothing saved (LAST unchanged since 6.4). | |

---

## 7. The adopter sees it immediately (B)

In B's browser. Don't reload C's tabs.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 7.1 | `/companion/low-resource-language/jobs` (reload if it was open) | S4 "Design the data collection plan" row: the short when now begins "Week 2 for the requirements study, Weeks 4–5 …" and is cut with "…" (it is longer than 110 characters now). Still 40 jobs, Only mine 11. | |
| 7.2 | Open S4 (`?open=S4`) | When: the full new text ending "(QA-4b)."; How: **12** bullets, the last "Hold a review call with the data collection vendor every Tuesday at 5 pm (QA-4b)."; Gaps: **2** (6.3). No ✎ anywhere. | |
| 7.3 | Open P1 | Checklist: **10** items. Item 1 shows "Week 1 (QA-4b)" (6.2). The new one is **9th** (moved up in 6.4), highlighted as a PMU item, shown with its step ("Language survey", Week 3) and owner PMU. | |
| 7.4 | **Home**. Send: `For the data collection plan, how often should we hold a review call with the vendor?` | **1** model call: one `[companion-v2] stop=end_turn …` line. (Observe `cache_read`: the cached playbook prefix changed with C's save, so `cache_read=0` on this call is expected.) The reply says **every Tuesday at 5 pm**, from the playbook. Plain language: no job codes, no "work area", no `<ui_action>` on screen. (It may echo "QA-4b" from the bullet: ignore that.) | |
| 7.5 | Dev-server log | Exactly one new line since 7.4 started. | |

---

## 8. Add a job, placed in a step (C)

Jobs map > **✎ Add a job**.

### 8.1 The form and its negatives

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 8.1a | Look | Title **A new job**. Top: **Job code** (hint "Fixed once created, e.g. S15. Not shown to adopters."), **Add it to this step of the sequence** (default "Not in a step (listed last)", then the 14 steps by name), **Work area** (People and Problem, Solution, Institution, Ecosystem), **Job type** (Discover, Decide, Deliver, Operate), **Stages** checkboxes with **Explore** ticked. Then the job fields, all empty except Who tracks `PMU`. | |
| 8.1a2 | Focus | In the first field, **Job code**. | |
| 8.1b | Code empty, or name empty | **Review changes** disabled until both have text. | |
| 8.1b2 | Code `QA1`, name `QA-4b x`, then untick **Explore** (no stage ticked) | Red line "Pick at least one stage so the job appears on the jobs map."; **Review changes** disabled. Tick Explore again: the line goes, Review enabled. | |
| 8.1c | Code `QA 1` (space), name `QA-4b bad code` → Review | One card "New job: QA-4b bad code" with the error "A job code must start with a letter and use only letters, numbers, - or _." Apply disabled. **Back to the form**. | |
| 8.1d | Code `S4` (exists), name `QA-4b duplicate`, step **Stage 5: Standards creation** | Red line under the form: "A job with the code “S4” already exists. Choose another code." **Review changes** disabled, so neither the job nor the step change can be reviewed or applied. Change the code to `s4` (lower case): the message goes (codes are case-sensitive); then clear the code field. | |
| 8.1e | **Cancel** | "Close without saving?" (you typed) → OK. Then reopen **✎ Add a job** for 8.2. | |

### 8.2 Add QA1

Fill in:

| Field | Value |
|---|---|
| Job code | `QA1` |
| Add it to this step | **Stage 5: Standards creation** |
| Work area / Job type | **Institution** / **Deliver** |
| Stages | untick Explore; tick **Define** and **Pilot** |
| Name | `QA-4b test job` |
| Intended result | `A test job exists for Slice 4b.` |
| When | `During standards creation (QA-4b).` |
| How it’s done | two lines: `First step (QA-4b).` / `Second step (QA-4b).` |
| Who owns | `PMU, Nodal Officer` |
| Who tracks | `PMU` |

**Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 8.2a | Cards | **2**: "New job: QA-4b test job" and "Step 7: Stage 5: Standards creation". **Edit this change** appears on the step card only (a new job is edited in the form). | |
| 8.2b | New-job diff | `- (no such job yet)` red, then green lines: first `QA-4b test job [QA1]`, then one line per field, including `Who tracks: • PMU`, `Who owns: • PMU` with `• Nodal Officer` on the next line, `What it achieves: A test job exists for Slice 4b.`, `When: During standards creation (QA-4b).`, `How, in short: • First step (QA-4b).` / `• Second step (QA-4b).`, `Checklist items: (empty)`, `Maturity: (none)`, `Recurs across rounds: No`, and last `Jobs map: Institution · Deliver · Define, Pilot`. | |
| 8.2c | Step diff (previewed **after** the new job, so its name resolves) | Three lines: `Stage 5: Standards creation (1–2 months)` and its text unchanged; red `- Jobs: Set orthography and transcription standards, Set the quality bar and acceptance criteria`, green `+ Jobs: Set orthography and transcription standards, Set the quality bar and acceptance criteria, QA-4b test job`. Job **names**, not codes. | |
| 8.2c2 | Untick card 1 (the new job) | Card 2 now shows "Unknown job code(s) in the step: QA1." and the button **Apply 0 of 2** is disabled (the step can't name a job that isn't being added). Tick card 1 again: both fine, **Apply**. | |
| 8.2d | **Apply** | Toast. Jobs map: a solid **QA-4b test job** tile in **Define × Institution** (last in the cell) with "Deliver", "Who owns: **PMU**, Nodal Officer", "Who tracks: PMU", and a dashed tile in **Pilot × Institution**. No "No owner named". Sequence: Stage 5 now has 3 chips, the last "QA-4b test job". | |
| 8.2e | As postgres: `select job_code, name, position, stages, work_area, job_type, body->'owners', body->'tracked_by' from playbook_jobs where playbook_id = '<LRL_ID>' and job_code = 'QA1';` and `select p->'jobs' from playbooks, jsonb_array_elements(sequence->'phases') p where id = '<LRL_ID>' and p->>'name' like 'Stage 5:%';` | `QA1`, `QA-4b test job`, `41`, `{Define,Pilot}`, `Institution`, `Deliver`, `["PMU","Nodal Officer"]`, `["PMU"]`; step jobs `["S5","P5","QA1"]`. | |
| 8.2f | LAST | Only `QA1` in the last save (S4 and P1 untouched). | |

### 8.3 B sees QA1 and sets a marker

As **B**, reload `/companion/low-resource-language/jobs`.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 8.3a | Intro | "… you track all of them and own **12**." 41 rows; **Only mine** 12. | |
| 8.3b | Group "Standards creation" (1–2 months) | Three rows: S5, P5, then **QA-4b test job** with an **Owns** tag, "Who owns: **PMU**, Nodal Officer", "Who tracks: PMU". No code shown. | |
| 8.3c | Open it, "Where you are with this" > **In progress**, note `QA-4b marker`, **Save** | Toast "Saved."; the row shows the In progress marker. | |
| 8.3d | As postgres: `select job_code, state, set_by, note from member_job_states s join playbook_members m on m.id = s.member_id where m.user_id = '<B>' and m.playbook_id = '<LRL_ID>' and job_code = 'QA1';` | One row: `QA1`, `in_progress`, `user`, `QA-4b marker`. | |

---

## 9. Remove a job (C, QA1)

Close B's QA1 sheet but leave B on `?open=QA1` in one tab for 9.4. As **C**, Jobs map > open
**QA-4b test job** > **✎ Edit this job** > **Remove this job**.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 9.1 | Confirm text | Browser confirm: `Remove "QA-4b test job" from the playbook? It is also taken out of 1 step of the sequence, and adopters’ markers for it are deleted. This goes live as soon as you apply it, and there is no undo.` **Cancel** → nothing happens, still on the form. | |
| 9.2 | Again, **OK** | Review screen with **one** card "Remove job: QA-4b test job": all the job's lines red, `+ (none)` green. (Observe: the step change isn't shown as its own card. Record.) | |
| 9.3 | **Apply** | Toast. QA1's tiles are gone from the Jobs map; Stage 5 back to 2 chips. The QA1 drawer is **closed** (it doesn't flash back after the dialog closes) and `open=QA1` has **left the URL** (the tab, e.g. `?tab=map`, stays). | |
| 9.4 | As postgres | `select count(*) from playbook_jobs where playbook_id = '<LRL_ID>' and job_code = 'QA1';` → `0`. `select count(*) from playbooks, jsonb_array_elements(sequence->'phases') p where id = '<LRL_ID>' and p->'jobs' ? 'QA1';` → `0`. The 8.3d query → **no rows** (B's marker deleted). The 1.6 query → exactly `<B_STATES_0>` again. | |
| 9.5 | Network (C) | The rpc payload had `p_removed_jobs: ["QA1"]`, `p_jobs: []`, and `p_playbook` with **only** `sequence`. | |
| 9.6 | B: reload the `?open=QA1` tab | Jobs page, 40 jobs, own 11, **no** sheet and no error. | |

---

## 10. Overview, title and description (C)

For each row: open the ✎, check the form is filled in and **Review changes** is disabled, make the
change, **Review changes**, check the card(s), **Apply**, check the Overview tab shows it without a
reload.

| # | Edit | Change | Expected card(s) and diff | Pass/Fail |
|---|---|---|---|---|
| 10.1 | **✎ Edit title and description** | Title: add ` (QA-4b)` at the end. Description: add ` Test edit (QA-4b).` at the end. | Dialog "Title and description" (Title field, Description textarea). 2 cards: "Playbook title" (word diff, only "(QA-4b)" green) and "Playbook description" (word diff, only the added sentence green). After Apply the description above the tabs changes. | |
| 10.1b | Same dialog, clear the Title | One card "Playbook title" with "The title must be text."; Apply disabled. **Back to the form**, **Cancel**. | |
| 10.2 | Purpose **✎ Edit** | 6 entries (label + text, "Use cases" ticked as **A list** with 4 lines). In "Who it is for" add ` (QA-4b)`. | 1 card "Overview → Purpose". Line diff: one red and one green "Who it is for: …" line; every other line plain (6 entries + 4 use-case lines, so short enough to show without folding, or with one fold). | |
| 10.3 | Context | 8 entries. "Scale": add ` (QA-4b)`. | "Overview → Context": one -/+ line ("Scale: …"). | |
| 10.4 | Based on | On "Deployment reference" tick **A list**: the text becomes one line in a list box. Add a second line `Second reference (QA-4b)`. | "Overview → Based on": red `Deployment reference: …`, green `Deployment reference:`, `  - <old text>`, `  - Second reference (QA-4b)`. | |
| 10.5 | Outcomes | Lines field with 5 lines; add `Test outcome (QA-4b)`. | "Overview → Outcomes": fold or plain lines, one green `+ • Test outcome (QA-4b)`. | |
| 10.6 | Key insights | 4 lines; in line 2 change one word and add ` (QA-4b)`. | "Overview → Key insights": one -/+ pair for line 2. | |
| 10.7 | Maturity flags | 5 entries; "Open": add ` (QA-4b)`. | "Overview → Maturity flags": one -/+ line. | |
| 10.8 | Credits | **Banner** at the top: "The credits must keep the CC BY 4.0 licence and the attribution to EkStep; a save without them is refused." 4 entries; "Acknowledged contributors" is a list (12 lines) with its note. Add a 13th line `QA-4b Tester, Test Organisation`. | "Overview → Credits": one green `  - QA-4b Tester, Test Organisation` line; the note line `(Listed in no particular order. …)` unchanged. Apply works (CC BY 4.0 and EkStep still there). Overview shows 13 contributors. | |
| 10.9 | After 10.1–10.8, as postgres | `select title, overview->'credits'->2->'items'->>12 from playbooks where id = '<LRL_ID>';` and QA (0.8) | Title ends `(QA-4b)`; item 13 `QA-4b Tester, Test Organisation`. QA lists `playbook`. | |
| 10.10 | B: reload `/companion` and the workspace | The playbook card and workspace header show the new title "Low-resource language AI adoption (QA-4b)". | |

---

## 11. Roles (C)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 11.1 | **✎ Add a role** | Dialog "A new role": Name, Group (hint lists "Existing groups: Governance and delivery, Community, External vendors, Review and testing"), Description, Example, See also, Owner names in the checklist, Names in the playbook. **Review changes** disabled until Name, Group and Description all have text. | |
| 11.2 | Name `QA-4b Reviewer`, Group `Review and testing`, Description `A test role for Slice 4b.`, Owner names `QA Owner` → Review | 1 card "New role: QA-4b Reviewer": `- (none)`, then green `QA-4b Reviewer (Review and testing)`, `A test role for Slice 4b.`, `Owner names in the checklist: QA Owner`. **Apply**. | |
| 11.3 | Roles tab | 25 cards; **Review and testing** chip → 8. The new card has a ✎ Edit. | |
| 11.4 | ✎ Edit on **QA-4b Reviewer**: description → `A test role for Slice 4b, edited.` | Form filled; disabled until changed. 1 card "Role: QA-4b Reviewer": one -/+ line (the description); the name and owner lines plain. **Apply**. | |
| 11.5 | ✎ Edit on **QA-4b Reviewer**: name → `Champion` → Review | Error "A role "Champion" already exists."; Apply disabled. **Back to the form**, **Cancel**. | |
| 11.6 | ✎ Edit on **Champion** (a real role): Example: add ` (QA-4b)` | Filled with "E.g. a District Collector, …", Owner names `District Collector`, Names in the playbook `Champion`. 1 card "Role: Champion": one -/+ `Example: …` line. **Apply**. The Champion card shows the new example. | |
| 11.7 | ✎ Edit on **QA-4b Reviewer** > **Remove this role** | Confirm `Remove the role "QA-4b Reviewer"? This goes live as soon as you apply it, and there is no undo.` OK → 1 card "Remove role: QA-4b Reviewer": its lines red, `+ (none)`. **Apply** → 24 cards, Review and testing 7. | |
| 11.8 | As postgres: `select jsonb_array_length(roles), roles->0->>'example' from playbooks where id = '<LRL_ID>';` | `23`; Champion's example ends `(QA-4b)`. No role named `QA-4b Reviewer`: `select count(*) from playbooks, jsonb_array_elements(roles) r where id = '<LRL_ID>' and r->>'name' like 'QA-4b%';` → `0`. | |

---

## 12. Sequence (C)

### 12.1 Milestones

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.1a | Milestones **✎ Edit** | Dialog "Milestones": 3 entries ("3 months", "6 months" as text; "12 months" as a list of 6 lines) and "Note under the milestones". Review disabled. | |
| 12.1b | "3 months": add ` (QA-4b)`. **+ Add an entry**: label `18 months (QA-4b)`, text `A test milestone (QA-4b).` Note: add ` (QA-4b)`. → Review | 2 cards: "Sequence → Milestones" (line diff: one -/+ `3 months: …` line, a green `18 months (QA-4b): A test milestone (QA-4b).` at the end, the 12-month lines plain) and "Sequence → Milestones note" (word diff, only "(QA-4b)" green). **Apply** → Sequence tab shows 4 milestones and the new note. | |
| 12.1c | An entry with an empty label | Dropped on save (cleanEntries). Add one, leave the label empty, Review: no extra line in the diff. **Back to the form**, **Cancel**. | |

### 12.2 Note on the stages

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.2a | **✎ Edit the note on the stages**: add ` (QA-4b)` at the end → Review | 1 card "Sequence → Note on the stages". The note is one line of about 300 characters, well under the ~2400-character limit for a word diff, so it shows as **one paragraph with only "(QA-4b)" green**, not a whole-line red/green pair. **Apply**; the note under the steps ends "(QA-4b)". | |

### 12.3 Steps

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.3a | Under **Stage 5: Standards creation**, **✎ Edit** | Dialog titled "Stage 5: Standards creation": Name, When `1–2 months`, "What happens in this step", "Jobs in this step (2), in order" (Set orthography and transcription standards; Set the quality bar and acceptance criteria, each with ↑ ↓ Remove), a "Find a job to add" box and a list of the other jobs as `+ <name>`. Review disabled. | |
| 12.3b | Add ` (QA-4b)` to the text; move "Set the quality bar…" **up** → Review | 1 card "Step 7: Stage 5: Standards creation": first line plain; text -/+ (one line each); red `- Jobs: Set orthography and transcription standards, Set the quality bar and acceptance criteria`, green `+ Jobs: Set the quality bar and acceptance criteria, Set orthography and transcription standards` (names, not codes). **Apply**. Sequence tab: the chips in the new order. | |
| 12.3c | B: reload Jobs | Group "Standards creation": **P5** row ("Set the quality bar and acceptance criteria") now **before** S5. | |
| 12.3d | **✎ Add a step after** under Stage 5 | Dialog "A new step", empty, Jobs (0). Review disabled until Name **and** When have text. | |
| 12.3e | Name `QA-4b review pause`, When `1 week (QA-4b)`, text `A test step.` → Review | 1 card "New step: QA-4b review pause". Diff shows the **whole new step**: red `- (no such step yet)`, green `+ QA-4b review pause (1 week (QA-4b))`, `+ A test step.`, `+ Jobs: (none)`. **Apply** → 15 steps, the new one 8th, **directly after** Stage 5 on the Sequence tab. | |
| 12.3f | **✎ Add a step at the start**: Name `QA-4b first step`, When `Day 0 (QA-4b)`, text `A test step.`, filter "Find a job to add" with `usage`, click `+ Capture usage gaps and keep improving` → Review | 1 card "New step: QA-4b first step": red `- (no such step yet)`, green `+ QA-4b first step (Day 0 (QA-4b))`, `+ A test step.`, `+ Jobs: Capture usage gaps and keep improving` (the name, not `S14`). **Apply** → 16 steps, the new one first, with one chip. | |
| 12.3g | B: reload Jobs | The **first** group is now "QA-4b first step" (Day 0 (QA-4b)) with one row, "Capture usage gaps and keep improving"; that job is **no longer** under "Sustaining" (each job is listed under the first step it appears in). | |
| 12.3h | Under **QA-4b first step**, ✎ Edit > **Remove this step** | Confirm `Remove the step "QA-4b first step"? Its jobs stay in the playbook. This goes live as soon as you apply it, and there is no undo.` OK → 1 card "Remove step 1: QA-4b first step" showing the **whole step** red (`- QA-4b first step (Day 0 (QA-4b))`, `- A test step.`, `- Jobs: Capture usage gaps and keep improving`) and green `+ (removed)`. **Apply**. | |
| 12.3i | Same for **QA-4b review pause** | Card "Remove step 8: QA-4b review pause": its three lines red, `+ (removed)`. **Apply** → 14 steps. | |
| 12.3j | As postgres: `select jsonb_array_length(sequence->'phases'), sequence->'phases'->0->>'name', sequence->'phases'->6->'jobs' from playbooks where id = '<LRL_ID>';` and `select count(*) from playbook_jobs where playbook_id = '<LRL_ID>';` | `14`, `Readiness`, `["P5","S5"]`; jobs still `40` (removing a step never removes jobs). B's Jobs: "Capture usage gaps…" back under "Sustaining". | |

### 12.4 Hard rules

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.4a | Hard rules **✎ Edit** | Dialog "Hard rules": 12 rows (rule textarea, "Why (optional)" box, ↑ ↓ Remove); rule 6's Why is empty; **+ Add a rule**. Review disabled. | |
| 12.4b | **+ Add a rule**, leave it empty | Review still disabled (empty rules are dropped). | |
| 12.4c | Rule `Test rule (QA-4b).`, Why `Test reason (QA-4b).` → Review | 1 card "Hard rules": `… 9 unchanged lines …`, 3 plain context lines, green `+ • Test rule (QA-4b). (Why: Test reason (QA-4b).)`. **Apply** → 13 rules, the new one last. | |
| 12.4d | **✎ Edit** again; press **↑** on the new rule 12 times (↑ is disabled on the first row) → Review | Green `+ • Test rule …` at the **top**, red `- • Test rule …` at the bottom, `… 6 unchanged lines …` in between. **Apply** → the test rule is first. | |
| 12.4e | **✎ Edit**, **Remove** on the test rule → Review | Red `- • Test rule …` first, then context and `… 9 unchanged lines …`. **Apply** → 12 rules. | |
| 12.4f | As postgres: `select jsonb_array_length(sequence->'rules'), sequence->'rules'->0->>'rule', sequence->'rules'->5 from playbooks where id = '<LRL_ID>';` | `12`, "A committed deployment application before any data collection starts.", `{"rule": "Review each work order …", "why": ""}` (rule 6 kept, still with no reason). | |

---

## 13. Guards in the UI (C)

### 13.1 CC BY 4.0 removed from Credits

Credits **✎ Edit**. In "Licence", delete ` (CC BY 4.0)` so it reads "Creative Commons Attribution 4.0
International. Suggested credit: …". **Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 13.1a | Review | The card "Overview → Credits" shows the -/+ Licence line. Under the list, a red alert box: "The credits must keep the CC BY 4.0 licence and the attribution to EkStep." | |
| 13.1b | Button | **Apply** is **disabled**. No request when clicking it. | |
| 13.1c | **Back to the form**, **Cancel** | FP (0.6) `overview_md5` unchanged since the end of 10.8. | |

### 13.2 "Only for Author" in a field

Open S4 > **✎ Edit this job**. In "Note on who owns", add ` Only for Author: internal note.` →
**Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 13.2a | Review | Card "Design the data collection plan → Note on who owns", and the alert: "Content marked "Only for Author" can't be published in the playbook or the source document." **Apply** disabled. | |
| 13.2b | Back to the form; change it to `only   for   AUTHOR` (extra spaces, capitals) | Same alert; Apply disabled. | |
| 13.2c | Change it to `For use only for authorised staff.` | **No** alert; Apply enabled. **Don't apply.** **Back to the form**, **Cancel**. | |
| 13.2d | Put `Only for Author` in a **new job's** name instead (Add a job, code `QA2`, name `Only for Author QA-4b`) | Alert; Apply disabled. Cancel (→ "Close without saving?" → OK). | |

### 13.3 Soft warning: PMU no longer tracks a job (doesn't block)

Open S4 > **✎ Edit this job**. Change **Who tracks** from `PMU` to `Nodal Officer`. **Review changes**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 13.3a | Review | Card "Design the data collection plan → Who tracks" (`- • PMU` / `+ • Nodal Officer`). Below the cards an **amber** box (not red, no alert role): "PMU no longer tracks: Design the data collection plan. It will disappear from the PMU’s Jobs screen." | |
| 13.3b | Button | **Apply** is **enabled** (a warning, not a guard). **Don't apply.** | |
| 13.3c | Untick the card | The amber box goes (the warning follows only the ticked changes). Tick it again: it's back. | |
| 13.3d | **Back to the form**; set Who tracks to `PMU, Nodal Officer` → Review | No amber box (PMU still tracks it). | |
| 13.3e | **Close** → "Close without saving?" → OK | Nothing saved (FP unchanged). | |

---

## 14. Two tabs editing at once (C, stale test)

Plan acceptance: "the second save gets the reload message, and its proposal stays on screen."

1. In C's browser, **reload** the Playbook (so it has the current `updated_at`), then open it in a
   **second tab** (`/companion/low-resource-language/playbook?tab=map`). Call them T1 and T2.
2. **T2**: open **Set the quality bar and acceptance criteria** (P5) > ✎ Edit this job. Change
   **When** (add ` (QA-4b T2)`) **and** **Why it matters** (add ` (QA-4b T2)`). **Review changes**
   (2 cards). **Don't apply yet.**
3. **T1**: open **Set orthography and transcription standards** (S5) > ✎ Edit this job, add
   ` (QA-4b T1)` to When, Review, **Apply**. Toast.
4. Run FP. Copy `updated_at` as `<T1_UPD>`.
5. **T2**: **Apply**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 14.1 | T2 message | Red box: "Someone changed the playbook since you loaded it. Reload to see their change, then make yours again." and a button **Reload now (your unsaved changes here are lost)**. | |
| 14.2 | T2 proposal | Still on screen: both cards, their diffs and checkboxes, the Apply button enabled again (not stuck on Applying…). The dialog didn't close; no toast. | |
| 14.3 | T2 Network | The rpc call returned an error with `code "P0409"`, `message "stale_playbook"`. | |
| 14.4 | As postgres: FP, and `select job_code, body->>'when', body->>'why_it_matters' from playbook_jobs where playbook_id = '<LRL_ID>' and job_code in ('S5','P5');` | FP `updated_at` = `<T1_UPD>` (T2 changed nothing). S5's when ends `(QA-4b T1)`. P5's when **and** why have **no** `(QA-4b T2)`: neither of the two ops was half-applied. | |
| 14.5 | T2: **Reload now** | The page reloads (the dialog and its proposal go, as the button says). Open S5: the T1 change is there. Redo the P5 edit and **Apply**: it saves (toast). | |
| 14.6 | Same tab, twice in a row | In T1, edit S5 again (add ` again`), Apply; as soon as the toast shows, click S5's ✎ Edit this job repeatedly. While "Updating…" shows, nothing opens; once it goes, the dialog opens with the **just-saved** text in the form. Change it once more, Apply: saves without a stale error. | |
| 14.7 | An open edit keeps the playbook it was opened with | T2 (reload it first): open P5's ✎ Edit this job and **leave the form open**. In T1 change P5's When and Apply. Back in T2: the form still shows the When **as it was when T2 opened it** (it doesn't change under you). Change Why it matters, Review, Apply → the stale message (14.1), not a silent overwrite of T1's When. As postgres: P5's When is T1's. **Reload now**. | |

---

## 15. RPC from the browser console (guards, atomicity, access)

These call `save_playbook` directly, the way devtools could, signing each user in on a **separate,
throw-away** client (the Slice 1 section 17 pattern), so your normal app session isn't affected. Use
any `localhost:3000` tab. Devtools (F12) > Console.

### 15.1 Helpers (paste once)

```js
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const SB_URL = 'https://<ref>.supabase.co';
const SB_ANON = '<anon key>';
const LRL = '<LRL_ID>', TEST = '<TEST_ID>';
async function as(email, password) {
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  if (email) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; }
  return sb;
}
const load = async (sb) => (await sb.from('playbooks').select('updated_at,title,description,overview').eq('id', LRL).single()).data;
const save = (sb, base, playbook = {}, jobs = [], removed = [], id = LRL) =>
  sb.rpc('save_playbook', { p_playbook_id: id, p_base_updated_at: base, p_playbook: playbook, p_jobs: jobs, p_removed_jobs: removed });
const c = await as('<C email>', '<C password>');
let pb = await load(c);
console.log(pb.updated_at, pb.title);
```

| Expected | Pass/Fail |
|---|---|
| The current `updated_at` (same as FP) and the title. A "Multiple GoTrueClient instances" warning is harmless. | |

### 15.2 Credits stripped of CC BY 4.0 (plan test 3)

```js
const stripped = { ...pb.overview, credits: JSON.parse(JSON.stringify(pb.overview.credits).replaceAll('CC BY 4.0', 'CC BY')) };
console.log('still has it?', JSON.stringify(stripped.credits).includes('CC BY 4.0'));
const r1 = await save(c, pb.updated_at, { overview: stripped });
console.log(r1.error?.code, r1.error?.message, 'unchanged:', (await load(c)).updated_at === pb.updated_at);
```

| Expected | Pass/Fail |
|---|---|
| `still has it? false`, then `P0422 credits_attribution_missing unchanged: true`. | |

### 15.3 "Only for Author" through the RPC

```js
const r2 = await save(c, pb.updated_at, { description: pb.description + ' Only for Author: secret.' });
const r3 = await save(c, pb.updated_at, { description: pb.description + ' only\u00a0for\u00a0author' });
const r4 = await save(c, pb.updated_at, { description: pb.description + ' For use only for authorised staff.' }, [], [], TEST);
console.log(r2.error?.code, r2.error?.message, '|', r3.error?.code, '|', r4.error?.code, r4.error?.message);
console.log('unchanged:', (await load(c)).updated_at === pb.updated_at);
```

| Expected | Pass/Fail |
|---|---|
| `P0423 only_for_author_content | P0423 | 42501 forbidden` (r4 targets test-playbook, where C isn't a contributor), then `unchanged: true`. | |

### 15.4 Stale base

```js
const r5 = await save(c, '2000-01-01T00:00:00Z', { title: pb.title + ' QA-4b stale' });
console.log(r5.error?.code, r5.error?.message, 'unchanged:', (await load(c)).title === pb.title);
```

| Expected | Pass/Fail |
|---|---|
| `P0409 stale_playbook unchanged: true`. | |

### 15.5 A save that fails half-way leaves nothing (plan acceptance)

One save that changes the title, then a valid S4 row, then a job whose `job_code` breaks the check
constraint.

```js
const { data: s4 } = await c.from('playbook_jobs').select('job_code,name,position,stages,work_area,job_type,body').eq('playbook_id', LRL).eq('job_code', 'S4').single();
const good = { ...s4, body: { ...s4.body, when: 'QA-4b half-applied test' } };
const bad = { job_code: '9bad', name: 'QA-4b bad job', body: {} };
const r6 = await save(c, pb.updated_at, { title: 'QA-4b half-applied title' }, [good, bad]);
console.log(r6.error?.code, r6.error?.message);
const after = await load(c);
const { data: s4b } = await c.from('playbook_jobs').select('body').eq('playbook_id', LRL).eq('job_code', 'S4').single();
const { count } = await c.from('playbook_jobs').select('*', { count: 'exact', head: true }).eq('playbook_id', LRL);
console.log(after.title === pb.title, after.updated_at === pb.updated_at, s4b.body.when === s4.body.when, count);
const r7 = await save(c, pb.updated_at, {}, [good, { job_code: 'QA9', name: '', body: {} }]);
console.log(r7.error?.code, r7.error?.message, (await load(c)).updated_at === pb.updated_at);
```

| Expected | Pass/Fail |
|---|---|
| `23514 new row for relation "playbook_jobs" violates check constraint "playbook_jobs_job_code_check"`; then `true true true 40`; then `23514 … "playbook_jobs_name_check" true`. Run FP: identical to the FP after section 14. | |

### 15.6 Contributors can't write the tables directly

```js
console.log(await c.from('playbooks').update({ title: 'QA-4b direct' }).eq('id', LRL).select());
console.log(await c.from('playbook_jobs').delete().eq('playbook_id', LRL).eq('job_code', 'S4').select());
```

| Expected | Pass/Fail |
|---|---|
| Both return an `error` with `code "42501"`, "permission denied for table …" (no update/delete grant; writes go only through `save_playbook`). FP unchanged. | |

### 15.7 Adopter B and a signed-out caller

```js
const b = await as('<B email>', '<B password>');
const rb = await save(b, pb.updated_at, { title: 'QA-4b by B' });
console.log('B rpc:', rb.error?.code, rb.error?.message);
console.log('B direct:', (await b.from('playbooks').update({ title: 'QA-4b by B' }).eq('id', LRL).select()).error?.code);
const anon = await as();
const ra = await save(anon, pb.updated_at, { title: 'QA-4b anon' });
console.log('anon rpc:', ra.error?.code, ra.error?.message);
```

| Expected | Pass/Fail |
|---|---|
| `B rpc: 42501 forbidden`; `B direct: 42501`; `anon rpc: 42501 permission denied for function save_playbook`. FP unchanged (title has no "by B" / "anon"). | |

---

## 16. Keyboard only (desktop width, C)

Put the mouse aside.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 16.1 | Tab to a card's **✎ Edit** (e.g. Key insights), Enter | The dialog opens; focus is in the **first field** (the Key insights textarea), with a visible focus ring. | |
| 16.2 | Tab repeatedly | textarea → Review changes (only once enabled; disabled buttons are skipped) → Cancel → wraps to the dialog's **Close** → textarea. Focus never reaches the page behind. **Shift+Tab** on Close goes to the last control (Cancel). | |
| 16.3 | Esc on the form step with **nothing** changed | Closes at once, no question. Focus returns to the **✎ Edit** button that opened it (visible ring). | |
| 16.4 | Open again, type a change, press **Esc** | Confirm "Close without saving? Your changes here will be lost." **Cancel** → still in the form, the change still typed, focus back in the dialog. Esc again, **OK** → closes, nothing saved (FP unchanged); focus as in 16.3. | |
| 16.5 | Open again, type a change, Tab to **Review changes**, Enter | The review screen; focus on the **first card's checkbox**. Press **Esc** → the same confirm. **Cancel** → still on the review screen, nothing lost. | |
| 16.6 | On the review screen, Tab | checkbox → "Edit this change" (if the card has one) → next card … → Apply → **Back to the form** → wraps to Close → first checkbox. Space toggles a checkbox; the Apply label follows ("Apply 0 of 1"). | |
| 16.7 | Enter on **Back to the form** | The form, focus on its first field, with the change still typed. Review again, then **Apply** with Enter: toast; focus as in 16.3. | |
| 16.8 | Job drawer: Tab to **✎ Edit this job**, Enter; then Esc (nothing typed) | The drawer hides and the dialog opens with focus on **Name**; Esc closes the dialog at once and the drawer comes back with focus on its **Close**. Esc again closes the drawer. | |
| 16.9 | With the dialog open, scroll with the wheel or arrow keys over the dimmed page | The page behind doesn't scroll; the dialog itself scrolls if taller than the window, and the form's Review changes / Cancel bar stays stuck to the bottom of the dialog. | |
| 16.10 | Remove confirms (job, role, step), "Close without saving?" and the stale Reload button | Reachable and operable with Tab and Enter; the browser confirm takes Enter (OK) and Esc (Cancel). | |

---

## 17. Phone width (375 px, C)

Devtools > device toolbar > a 375 px wide phone, touch emulation on.

| # | Screen | Expected | Pass/Fail |
|---|---|---|---|
| 17.1 | The ✎ buttons | Visible and tappable: on card titles (title wraps, ✎ stays on the right), on role cards, under step names, in the drawer header beside Close. | |
| 17.2 | Job dialog (S4) | Full width, no rounded corners, no side margin. Fields full width; the two-column parts (Roles as written, Maturity flag + note) stack to one column; each checklist item's stage/timing/owner stack. The Review changes / Cancel / Remove this job bar stays at the bottom and wraps if needed. | |
| 17.3 | Review screen | Card labels wrap; "Edit this change" wraps below the label if needed. A long line diff (S4 How) scrolls **inside its box** (max height ~420 px); long lines wrap rather than run off. Apply, Back to the form and the "no undo" note wrap. | |
| 17.4 | Add a job | Code / step / area / type stack; stage checkboxes wrap. | |
| 17.5 | Every screen above | Console: `document.documentElement.scrollWidth <= innerWidth` → `true`. | |

Don't apply anything here (or, if you do, it's covered by the restore).

---

## 18. Regression and the state before restoring

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 18.1 | 4a views | Overview 7 cards, Roles 24, Jobs map `tiles 57 dashed 17` (4a 5.2 console snippet), Sequence 14 steps, 12 rules, 4 milestones (one is still the QA one). Drawers and filters work as in 4a. (Note: the 4a script's 3.1 console snippet used `h.parentElement`; the card title now sits in a row with the ✎ button, so use `h.parentElement.parentElement` there.) | |
| 18.2 | Adopter B Home and Jobs | Work; 40 jobs, Only mine 11. | |
| 18.3 | Download now (optional) | Download playbook as JSON again, then `git diff --no-index "<BACKUP_DIR>/low-resource-language.json" "<new download>"`: every difference contains `QA-4b` (or is the rule/step/job order you changed and put back, which should show **no** difference). Information for the restore. | |
| 18.4 | QA (0.8) | Lists `playbook` and jobs `S4`, `P1`, `S5`, `P5` (and nothing starting `QA`). | |
| 18.5 | Dev-server log | Exactly **one** `[companion-v2]` line in the whole run (7.4). | |

---

## 19. RESTORE (mandatory)

### 19.1 Re-seed from the backup (terminal)

`--force` is needed because the playbook exists. `--prune` is added so that a job left over by an
interrupted run (e.g. `QA1` if section 9 didn't finish) is deleted too; without it the seed only
upserts and a test job would survive.

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
  --json "<BACKUP_DIR>/low-resource-language.json" \
  --source "<BACKUP_DIR>/low-resource-language.source.md" \
  --force --prune
```

| Expected | Pass/Fail |
|---|---|
| A source-size line, then `Re-seeded "low-resource-language" (<LRL_ID>): 40 jobs, 23 roles, 14 phases, 12 rules.` (same id). A `Pruned N job(s): …` line only if a test job was left over: record which. Exit 0. | |

If anything was pruned, also remove its markers (as postgres; the seed script doesn't):

```sql
delete from member_job_states s
using playbook_members m
where m.id = s.member_id and m.playbook_id = '<LRL_ID>' and s.job_code like 'QA%';
```

### 19.2 Round trip (terminal)

```bash
node --env-file=.env.local scripts/cube2/export-db.mjs --slug low-resource-language --out "<AFTER_DIR>"
cmp "<BACKUP_DIR>/low-resource-language.json" "<AFTER_DIR>/low-resource-language.json" && echo "json identical"
cmp "<BACKUP_DIR>/low-resource-language.source.md" "<AFTER_DIR>/low-resource-language.source.md" && echo "md identical"
```

| Expected | Pass/Fail |
|---|---|
| `Wrote … (40 jobs) …`, then `json identical` and `md identical`. If `cmp` reports a difference, run `git diff --no-index` on the pair and record it; do **not** go on until it is understood. | |

### 19.3 Database checks (as postgres)

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 19.3a | FP (0.6) vs `<FP_0>` | Identical in every column **except** `updated_at` (new) and `updated_by` (`null` after a seed). | |
| 19.3b | QA (0.8) | **No rows.** | |
| 19.3c | 1.6 query | Exactly `<B_STATES_0>`. | |
| 19.3d | 1.4 query | C still `contributor`, B still `adopter` (the seed upserts the playbook row, so members are kept; if C's row is gone, re-add C as in 1.4). | |

### 19.4 In the app

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 19.4a | C: reload the Playbook (both tabs, if T2 is still open) | Title without "(QA-4b)"; S4 back to 11 How bullets; P1 9 checklist items; 3 milestones; 12 rules; 14 steps; 24 role cards. (A tab left open from before the restore would get the stale message on its next save: that is correct.) | |
| 19.4b | B: reload Jobs | 40 jobs, own 11; "Standards creation" back to S5 then P5. | |

(Cube's cached prefix is back to the original text; the next adopter call will show `cache_read=0`
once. No model call is needed here.)

---

## 20. Things to record

Not pass/fail by themselves.

| Measure | Details |
|---|---|
| Model calls (dev-server log lines) vs. the 1 expected | |
| 9.2: removing a job shows no separate card for the step it leaves | |
| 4.8: typing and then undoing a change still asks "Close without saving?" (acceptable?) | |
| 5.5g / 14.6: "Updating…" seen; ✎ ignored while it showed | |
| 7.4: did Cube use the new "every Tuesday at 5 pm"? `cache_read` value | |

---

## 21. Clean up (test project only)

- Section 19 passed: delete `<BACKUP_DIR>`, `<AFTER_DIR>` and the downloads (keep `<BACKUP_DIR>`
  until then).
- B's section 7 turn can stay, or be deleted from B's sidebar (🗑).
- Close any Playbook tab that was open before the restore.

---

## Acceptance criteria to steps

| Slice 4b acceptance criterion / requested check (plan) | Steps | Pass/Fail |
|---|---|---|
| Editing a job's how shows a diff, and Apply makes it visible to an adopter immediately (Jobs screen, job sheet, Cube's next answer) | 5, 7 | |
| Adding one checklist task produces a single `job.append`, not a rewrite of the whole list | 6.1 | |
| List fields use the smallest ops: edit in place → `job.replace_item`; delete two → two `job.remove_item`, highest first; reorder / mix / clear → one whole-list `job.set` | 6.2–6.5 | |
| Two tabs editing at once: the second save gets the reload message and a Reload button, its proposal stays on screen, nothing half-applied; an open edit keeps the playbook it was opened with | 14 | |
| Removing "CC BY 4.0" from the credits is blocked in the UI, and when the RPC is called directly from devtools (P0422, nothing changed) | 13.1, 15.2 | |
| "Only for Author" is blocked in the UI and through the RPC | 13.2, 15.3 | |
| Dropping PMU from Who tracks warns (amber) but doesn't block | 13.3 | |
| A save that fails half-way leaves nothing changed (a `job_code` that breaks a constraint) | 15.5 | |
| `patch.ts` unit checks pass (`check-patch.mjs` 66/66), incl. stale `expect`, missing/duplicated heading, list ops, new-job placement checks | 2 | |
| One edit of each form type, confirmed as an adopter in another browser: title/description, every overview card incl. the Credits warning, role add/edit/remove, job edit via the drawer, add a job with step placement, remove a job (leaves the sequence, deletes adopters' markers, closes its drawer), step edit / add after / add at start / remove, milestones, stages note, hard rules add/reorder/remove | 5, 6, 8, 9, 10, 11, 12 (adopter checks 7, 8.3, 9.6, 10.10, 12.3c, 12.3g) | |
| New job: an existing code or no stage is refused in the form; add-and-place previews both cards in order | 8.1b2, 8.1d, 8.2c, 8.2c2 | |
| "Review changes" disabled until something changes; a checklist row without text blocks it | 4, 4.9, and the first row of 8, 10, 11, 12 | |
| The diff: word diff for one-line text (up to ~2400 characters), folded line diff for lists, step diffs by job name with whole added/removed steps, only the real change highlighted | 5.1, 6, 8.2, 10, 11, 12 | |
| Include checkboxes and "Apply N of M"; "Edit this change" inline, valid and invalid | 5.2, 5.3, 6.3c | |
| Saving is one `save_playbook` call from the browser with only what changed; writes only through the function; edit buttons wait while the page reloads | 5.5, 9.5, 15.6 | |
| Adopters can't see edit controls or save (RPC → 42501); per-playbook contributor check | 3.2, 15.3 (r4), 15.7 | |
| Keyboard: focus on the first field, then the first review checkbox; trap; Esc/Close/Cancel ask "Close without saving?" whenever anything was typed or reviewed, and close at once otherwise; Back to the form keeps the form's edits | 4.7, 4.8, 5.4, 16 | |
| Clean at phone width (375 px) | 17 | |
| Backup before, restore after, round trip byte-identical | 1, 19 | |
