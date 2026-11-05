# Cube 2.0 Slice 4d: manual test script

Branch `cube-2`. This covers what Slice 4d delivers (see `docs/design/cube2-plan.md`, "Slice 4d",
section 5 "Contributor chat: Update with Cube" including "Decided in Slice 4d", and section 7
"Update with Cube" / "Source document"):

- the contributor prompt `content/companion-v2-contributor.md` (one question when unclear, no job
  or step removal, contradictions from files, long text in `<patch_text>` blocks, ~4,500-word reply);
- the contributor branch of the chat route, `handleContributor` in `lib/companion-v2/handler.ts`
  (membership and contributor checks, the request limits: 40 messages, 60,000 characters a message,
  300,000 in all, 10 files and 130,000 file characters a request; the daily cap through
  `bump_companion_usage('contributor', …)`; 8,000 output tokens; the 413 "too much" and 503 replies;
  **no** `logConversation`);
- `lib/companion-v2/playbook-patch.ts` (`parsePatchBlock` with `{"block":N}` filling,
  `stripPatchBlock`, `modelOpProblem` / `sanitizePatch` with "Not offered here", `opTargetKey` /
  `overlappingOps`, `splitText` / `chunkFiles` at 120,000 characters a part, the 600,000-character
  upload limit);
- `lib/companion-v2/use-contributor-chat.ts` (history kept in React state only, a note per earlier
  proposal, one request per part, "Part i of n" labels, the stop-at-the-limit note, abort on
  Start over or leaving the screen);
- `components/companion-v2/ContributorChat.tsx` (`/companion/[slug]/update`, the 4 chips, file
  reading in the browser, `?from=files`, the "The playbook has changed since Cube proposed these"
  note on an outdated proposal) and `components/companion-v2/SourceDocument.tsx`
  (`/companion/[slug]/source`, the view, the editor, the size meter that blocks only growing past the
  cap, `source.set`);
- `lib/companion-v2/leave-warning.ts` (`useLeaveWarning`: `beforeunload` for reload and close, plus a
  count of screens with unsaved work) and its use in `components/companion-v2/WorkspaceTabs.tsx`
  (`confirmLeave()`: "Leave this screen? Your unsaved work here will be lost." on a tab click);
- the changes to `components/companion-v2/PatchReview.tsx` (contradictions, overlap notes, the size
  guard, Apply waiting while the page refreshes, and the stale-save button: in Update with Cube
  "Load the latest playbook, then apply again", which refreshes the data and keeps the chat;
  elsewhere still "Reload now …") and to `lib/companion-v2/patch.ts` (`source.set`, `checkSize`);
- unchanged but exercised: `lib/companion-v2/save.ts` and `save_playbook()` (`0034`), and
  `bump_companion_usage()` / `companion_usage` (`0036`).

**This script reflects the working tree at 21:31 on 2026-11-05**: the 413 "too much" reply, the
"Not read: …" wording in the stop note, the `checkSize` guard and the abort-on-leave (21:19), then
the fixes for review findings F2, F3, F4 and half of F5 (21:31). If those files change again before
you run it, re-check the quoted messages.

**Already checked automatically, so only re-run here:** `scripts/cube2/check-patch.mjs` (105 passed,
0 failed when this script was written; section 2). The generator in 0.9 was tried: the `.docx` it
writes reads back through mammoth as 480 characters, and the real `chunkFiles` splits `QA-4d long.md`
into exactly 3 parts of 110,117 / 110,127 / 110,014 characters.

**Not covered here, because a later slice builds it:** the Conversations viewer (5).

> **Applied changes go LIVE on the test project, and there is no history.** Section 1 (backup) is
> mandatory before anything else, and section 21 (restore) is mandatory at the end. If you stop
> part-way, go straight to section 21. Every request in this script either contains **`QA-4d`** or
> is discarded, and every proposal from **files** is discarded, so the database checks in section 14
> mean something.

**Cost.** About **19 contributor calls and 1 adopter call** locally (sections 5–13, plus 1 in 18.3; each contributor
call sends ~55–90k input tokens, most of it cached after the first within 5 minutes), plus **1–5**
on the Vercel deployment (section 17). Per the Product Charter, the Anthropic account in `.env.local`
was a free trial due to expire on **28-Oct-2026** (TD-16), which is already past. If the first call
fails with a 401 or 403 from Anthropic (dev-server log: `API error 401`), check the account before
recording a failure. Sections 3, 4, 14, 15 and 16 make **no** model calls.

---

## 0. Before you start

### 0.1 Safety check: are you pointed at the TEST project?

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local
git branch --show-current
git status --short
node --version
```

| Expected | Pass/Fail |
|---|---|
| The project ref matches the **test** project. The branch is `cube-2`. `git status` shows the 4d files (`ContributorChat.tsx`, `SourceDocument.tsx`, `content/companion-v2-contributor.md`, `playbook-patch.ts`, `use-contributor-chat.ts` untracked; `handler.ts`, `PatchReview.tsx`, `patch.ts` … modified). Node is 22.18 or later. **If the ref is production, stop here.** | |

### 0.2 `.env.local` and the dev server

`NEXT_PUBLIC_CUBE_VERSION=2` is set. `COMPANION_DAILY_MESSAGE_CAP`,
`COMPANION_DAILY_CONTRIBUTOR_CAP` and `COMPANION_V2_FAIL_AFTER_CHARS` are **not** set (section 13 sets
the contributor cap for a while). Start `npm run dev`. The terminal is the **dev-server log**:

- each contributor call prints one `[companion-v2 contributor] stop=... in=... cache_read=... cache_write=... out=...` line;
- each adopter call prints one `[companion-v2] stop=...` line;
- applying a change (a browser-to-Supabase RPC) prints **nothing**.

**Go to pages by URL, not via Home, and never open Home as C in this script.** Opening Home can start
Cube's adopter greeting (a model call) and would create a conversation row for C, which would spoil
section 14's "no rows for C" check. C goes straight to `/companion/low-resource-language/update`
(or `/source`, `/playbook`).

### 0.3 Test accounts (same as Slice 4c)

| Name | Purpose | Roles |
|---|---|---|
| **A** | Admin. Only needed if C has lost the contributor row (1.4). | Listed in `ADMIN_EMAILS` |
| **B** | Adopter of the main playbook. 404 checks, the API 403, sees applied changes, one chat turn. | `adopter`, `lrl_role adopter` |
| **C** | Contributor to the main playbook. **Does most of this script.** | `adopter`, `playbook_members.member_role = contributor` on `low-resource-language` only |
| **P** | Pending user (no roles). Gate checks. | none |

Use **two browsers** (or a normal and a private window): one for C, one for B (and later P). Sections
10 and 15 also need a **second tab** in C's browser.

### 0.4 Values to fill in as you go

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>`, `<TEST_ID>` | | 1.4 |
| `<B>`, `<C>`, `<P>` (user ids) | | 1.4 |
| `<BACKUP_DIR>` (an empty folder **outside** the repo, e.g. `D:/cube2-4d-backup`) | | 1.1 |
| `<AFTER_DIR>` (a second empty folder outside the repo) | | 21.2 |
| `<FILES>` (an empty folder **outside** the repo, e.g. `D:/cube2-4d-files`) | | 0.9 |
| `<T0>` (start time) | | 1.6 |
| `<FP_0>` (the whole fingerprint row before any change) | | 1.5 |
| `<SRC_0>` (the SRC row before any change) | | 1.5 |
| `<VERCEL_URL>` (the non-production deployment) | | 17.1 |

### 0.5 SQL in the Supabase SQL Editor

Same rules as Slice 4b, section 0.5:

- Blocks marked **"as postgres"** run as the superuser (RLS ignored), for setup and checking.
- The editor shows only the **last** statement's result: run multi-query blocks one statement at a time.
- `current transaction is aborted` → run `rollback;` on its own and carry on.

### 0.6 The fingerprint (as postgres), "FP"

One row that changes if anything in the playbook changes. Used for every "nothing changed" check.

```sql
select p.updated_at,
       p.updated_by,
       (select count(*) from playbook_jobs j where j.playbook_id = p.id)       as jobs,
       jsonb_array_length(p.roles)                                              as roles,
       jsonb_array_length(p.sequence->'phases')                                 as phases,
       md5(p.title || p.description)                                            as title_md5,
       md5(p.overview::text)                                                    as overview_md5,
       md5(p.roles::text)                                                       as roles_md5,
       md5(p.sequence::text)                                                    as sequence_md5,
       md5(p.source_doc)                                                        as source_md5,
       (select md5(string_agg(job_code || '|' || name || '|' || body::text, '¦' order by job_code))
          from playbook_jobs j where j.playbook_id = p.id)                      as jobs_md5
from playbooks p
where p.slug = 'low-resource-language';
```

### 0.7 Job P1 and the source document (as postgres), "P1" and "SRC"

"P1":

```sql
select body->>'when'                       as when_,
       jsonb_array_length(body->'gaps')    as gaps,
       body->'gaps'->-1                    as last_gap,
       updated_at
from playbook_jobs
where playbook_id = '<LRL_ID>' and job_code = 'P1';
```

"SRC" (the heading line uses an em dash, `—`; copy it exactly):

```sql
select length(source_doc)                                                          as chars,
       ceil(length(source_doc) / 4.0)                                              as approx_tokens,
       (select count(*) from regexp_split_to_table(source_doc, E'\n') l
          where l ~ '^#{1,6}\s')                                                   as headings,
       (select count(*) from regexp_split_to_table(source_doc, E'\n') l
          where l = '### 4.2 — Budget Categories to Plan For')                     as h42,
       substring(source_doc from position('### 4.2 — Budget' in source_doc) for 1800) as s42
from playbooks
where id = '<LRL_ID>';
```

### 0.8 Usage, stored rows and a marker search (as postgres)

"USAGE" (today, UTC):

```sql
select u.email, cu.role, cu.day, cu.count
from companion_usage cu
join auth.users u on u.id = cu.user_id
where cu.user_id in ('<B>', '<C>', '<P>')
  and cu.day = (now() at time zone 'utc')::date
order by u.email, cu.role;
```

"RESET" (C's contributor count for today; run whenever the script says so):

```sql
delete from companion_usage
where user_id = '<C>' and role = 'contributor' and day = (now() at time zone 'utc')::date
returning count;
```

"STORED":

```sql
select
  (select count(*) from companion_conversations c join playbook_members m on m.id = c.member_id
     where m.user_id = '<C>' and c.started_at >= '<T0>')                         as c_conversations,
  (select count(*) from companion_messages cm
     join companion_conversations c on c.id = cm.conversation_id
     join playbook_members m on m.id = c.member_id
     where m.user_id = '<C>' and cm.created_at >= '<T0>')                         as c_messages,
  (select count(*) from companion_messages where created_at >= '<T0>')           as all_messages_since_t0,
  (select count(*) from companion_messages
     where content ilike '%QA-4d%' or content ilike '%QA4D%')                    as qa_messages,
  (select count(*) from storage.objects where created_at >= '<T0>')              as new_objects;
```

"MARKER" (counts a string in **every** text and JSON column of every `public` table; replace
`QA4D-FILEONLY` to search for something else):

```sql
select c.table_name, c.column_name,
       (xpath('/row/n/text()',
          query_to_xml(format('select count(*) as n from public.%I where %I::text like %L',
                              c.table_name, c.column_name, '%QA4D-FILEONLY%'), false, true, '')))[1]::text::int as hits
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
where c.table_schema = 'public'
  and c.data_type in ('text', 'character varying', 'jsonb', 'json')
order by hits desc, c.table_name, c.column_name;
```

### 0.9 Test files (terminal)

Writes five files into `<FILES>`: a small `.docx` and `.md` with a conflicting figure, a new gap and an
"Only for Author" paragraph (marker `QA4D-FILEONLY-7731`); a 330,260-character `.md` that splits into
3 parts (blocks A and B both change the language survey's duration, so their changes overlap); a
610,263-character `.md` over the 600,000 limit; and a tiny PNG. It uses the repo's own `jszip` and
writes nothing into the repo.

```bash
mkdir -p "<FILES>"
cat > "<FILES>/make-qa4d.cjs" <<'EOF'
// Usage: node make-qa4d.cjs <repo folder> <output folder>
const fs = require('fs');
const path = require('path');
const [repo, out] = process.argv.slice(2);
const JSZip = require(require.resolve('jszip', { paths: [repo] }));
const w = (name, data) => fs.writeFileSync(path.join(out, name), data);

// 1. Small file with a conflicting figure, a new gap and an "Only for Author" paragraph.
const notes = [
  ['h', 'QA-4d field notes from a second district'],
  ['p', 'These notes come from a second district that ran the same programme in 2026.'],
  ['h', 'Translation costs'],
  ['p', 'In our district, NMT translation cost ₹30 to ₹35 per sentence pair, not the ₹18 to ₹25 we had planned for.'],
  ['h', 'A new gap we hit'],
  ['p', 'Nobody had a list of local radio stations, so recruiting voice contributors through radio took an extra three weeks.'],
  ['h', 'Only for Author'],
  ['p', 'Only for Author: vendor quote reference QA4D-FILEONLY-7731. Not for publication.'],
];
w('QA-4d field notes.md', notes.map(([k, t]) => (k === 'h' ? `## ${t}` : t)).join('\n\n') + '\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const body = notes.map(([k, t]) => k === 'h'
  ? `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${esc(t)}</w:t></w:r></w:p>`
  : `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join('');
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);

// 2. Long file: three ~110k-character blocks, so the client splits it into 3 parts.
//    Blocks A and B both change the language survey's duration (an overlap).
const block = (title, fact) => {
  let s = `# ${title}\n\n${fact}\n`;
  for (let d = 1; s.length < 110000; d++)
    s += `\nDay ${d}: recording continued at the block office. ${10 + (d % 7)} speakers recorded, all files checked the same evening, no issues to report.\n`;
  return s;
};
const long = [
  block('QA-4d long notes, block A', 'Key finding from block A: the language survey took 3 months here, not 1 to 2 months.'),
  block('QA-4d long notes, block B', 'Key finding from block B: plan the language survey for 4 months; 1 to 2 months was not enough.'),
  block('QA-4d long notes, block C', 'Key finding from block C: nobody kept a list of local radio stations, which slowed recruiting voice contributors.'),
].join('\n\n');
w('QA-4d long.md', long);
w('QA-4d too long.md', long + '\n\n' + long.slice(0, 280000));

// 3. An image (1x1 PNG).
w('QA-4d image.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

zip.generateAsync({ type: 'nodebuffer' }).then((b) => {
  w('QA-4d field notes.docx', b);
  for (const f of fs.readdirSync(out).sort()) console.log(f.padEnd(26), fs.statSync(path.join(out, f)).size, 'bytes');
});
EOF
node "<FILES>/make-qa4d.cjs" "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev" "<FILES>"
```

| Expected | Pass/Fail |
|---|---|
| Listed: `QA-4d field notes.docx 2406 bytes`, `QA-4d field notes.md 501`, `QA-4d image.png 70`, `QA-4d long.md 330261`, `QA-4d too long.md 610263` (plus `make-qa4d.cjs`). (Byte counts differ from the character counts the app shows, because `₹` is 3 bytes.) | |

### 0.10 Console helper for `/api/chat` (paste once per tab), "POST"

Same-origin `fetch`, so it carries the signed-in user's own cookies. **Only the requests this script
lists are sent with it**; a well-formed request from C would reach the model.

```js
const LRL = '<LRL_ID>', TEST = '<TEST_ID>';
async function post(body) {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'companion-v2', role: 'contributor', playbookId: LRL, ...body }),
  });
  const t = await r.text();
  console.log(r.status, t.slice(0, 200));
  return r.status;
}
const u = (content) => ({ role: 'user', content }), a = (content) => ({ role: 'assistant', content });
```

---

## 1. BACKUP and pre-flight (mandatory, before any change)

### 1.1 Export from the database (terminal)

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
node --env-file=.env.local scripts/cube2/export-db.mjs --slug low-resource-language --out "<BACKUP_DIR>"
```

| Expected | Pass/Fail |
|---|---|
| `Wrote <BACKUP_DIR>/low-resource-language.json (40 jobs) and <BACKUP_DIR>/low-resource-language.source.md.` Exit 0. **Keep this folder until section 21 has passed.** | |

### 1.2 Is the database still the checked-in seed? (information only)

```bash
git diff --no-index --stat content/playbooks/low-resource-language.json "<BACKUP_DIR>/low-resource-language.json"; echo "exit $?"
git diff --no-index --stat content/playbooks/low-resource-language.source.md "<BACKUP_DIR>/low-resource-language.source.md"; echo "exit $?"
```

| Expected | Pass/Fail |
|---|---|
| `exit 0` twice if nobody has edited the playbook since the last restore. Otherwise the **exact texts quoted below** (P1's When "1–2 months", one gap on P1, 42 headings, the 4.2 table, "steering it, rather than inventing it from scratch" in 4.3) may differ: record which, and use the backup for the restore in any case. | |

### 1.3 Seed facts this script relies on (information)

| Fact | Value in the seed |
|---|---|
| The language survey job | **P1, "Understand the language community and the access gap"**. When: "Week 1 for the language profile, then the language survey (1–2 months, after scope and vendor selection)." Gaps: 1 item. Two other jobs mention the survey in their When: S1 "Map what already exists" and S5 "Set orthography and transcription standards". |
| Section 4.2 | Heading line `### 4.2 — Budget Categories to Plan For`; a cost table with `\~` and `\-` escapes and a paragraph with `"free"` in quotation marks (the kind of text that broke the JSON before `<patch_text>`). |
| Section 4.3 | Contains "steering it, rather than inventing it from scratch" exactly once. |
| Source document | 58,728 characters, about 14,682 tokens, 42 headings. |

### 1.4 Ids and memberships (as postgres)

```sql
select u.email, u.id as user_id,
       (select id from playbooks where slug = 'low-resource-language') as lrl_id,
       (select id from playbooks where slug = 'test-playbook')         as test_id,
       (select m.member_role from playbook_members m join playbooks p on p.id = m.playbook_id
          where m.user_id = u.id and p.slug = 'low-resource-language')  as lrl_role,
       (select m.member_role from playbook_members m join playbooks p on p.id = m.playbook_id
          where m.user_id = u.id and p.slug = 'test-playbook')          as test_role,
       (select count(*) from user_roles r where r.user_id = u.id)       as roles
from auth.users u
where u.email in ('<B email>', '<C email>', '<P email>')
order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| C: `lrl_role contributor`, `test_role` adopter or null. B: `lrl_role adopter`. P: `roles 0`. **Copy `<LRL_ID>`, `<TEST_ID>`, `<B>`, `<C>`, `<P>`.** If C isn't `contributor`: as **A**, `/admin` > **Playbook contributors** > "Low-resource language AI adoption" > add C > **Add as contributor**, then re-run. | |

### 1.5 Fingerprint and source before (as postgres)

Run **FP** (0.6), **P1** and **SRC** (0.7).

| Expected | Pass/Fail |
|---|---|
| FP: `jobs 40`, `roles 23`, `phases 14`. P1: `gaps 1`, When as in 1.3. SRC: `headings 42`, `h42 1`. **Save the FP row as `<FP_0>` and the SRC row as `<SRC_0>`.** | |

### 1.6 Start time, usage reset and baseline (as postgres)

```sql
select now();
```

**Copy into `<T0>`.** Then run **RESET** (0.8), then **USAGE** and **STORED**.

| Expected | Pass/Fail |
|---|---|
| USAGE: no `contributor` row for C (B may have an `adopter` row from earlier tests: note its count). STORED: all five columns `0`. | |

---

## 2. `check-patch.mjs` (no database, no browser, no model)

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
node scripts/cube2/check-patch.mjs; echo "exit $?"
```

| # | Expected | Pass/Fail |
|---|---|---|
| 2.1 | Every line starts `PASS`, none `FAIL`; then `N passed, 0 failed` (105 when this script was written) and `exit 0`. (A "Module type … not specified" or "type stripping" warning is harmless.) | |
| 2.2 | Among them, the 4d checks: `text blocks fill {"block":N}`, `strip hides text blocks too`, `strip hides a text block that arrives alone`, `a missing text block leaves the change incomplete`, `job.remove is refused`, `phase.remove is refused`, `source.set is refused`, `rewriting a list is refused`, `clearing a list is allowed`, `reordering a list is allowed`, `sanitize lists refused ops with a reason`, `splitText keeps pieces under the limit`, `splitText loses no text`, `chunkFiles keeps each part under the limit`, `chunkFiles names split pieces`, `overlaps flag the same target from two parts`, `no overlaps within one part`, `growing past the budget is blocked`, `shrinking an over-budget document is allowed`. | |

---

## 3. Who can reach Update with Cube and the Source document

### 3.1 C sees both tabs

As **C**, go to `/companion/low-resource-language/update`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 3.1a | Tabs | Home, Jobs, Playbook, **Update with Cube** (underlined, `aria-current="page"`), Source document, Assets, Conversations. | |
| 3.1b | Page | "Ask Cube to change the playbook or the source document, or give it files to update from. Each change is shown as a diff first; nothing changes until you apply it. This conversation isn’t saved." No **Start over** yet. Four chips: **Edit a job**, **Edit the overview, roles, sequence or rules**, **Edit the source document**, **Update from files**. Composer with **+**, placeholder "What should change?", **↑** disabled. Under it: "Cube can be wrong. Check each change before you apply it; applied changes go live at once." No placeholder text from earlier slices. | |
| 3.1c | Network and log | **No** `/api/chat` request on load (Cube does not open a contributor chat). No dev-server log line. | |
| 3.1d | `/companion/low-resource-language/source` | The Source document screen (section 15.1). | |

### 3.2 Adopter B, pending P and signed out (pages)

| # | Who, URL | Expected | Pass/Fail |
|---|---|---|---|
| 3.2a | B: `/companion/low-resource-language/jobs` | Tabs **Home and Jobs only**. | |
| 3.2b | B: `/companion/low-resource-language/update` | The app's **404** page. Ctrl+U, search `What should change?` and `Edit the source document`: no match. | |
| 3.2c | B: `/companion/low-resource-language/update?from=files` | 404. | |
| 3.2d | B: `/companion/low-resource-language/source` | 404. Ctrl+U, search `Budget Categories`: no match. | |
| 3.2e | P: `/companion/low-resource-language/update` and `/source` | Not the screen: "Your account is almost ready" (as in Slice 4a, 2.3) or a 404. | |
| 3.2f | Fresh private window, signed out: `/companion/low-resource-language/update` | Redirected to `/login?next=%2Fcompanion%2Flow-resource-language%2Fupdate`. Same for `/source`. | |
| 3.2g | C: `/companion/test-playbook/update` and `/companion/test-playbook/source` | 404 (contributor status is per playbook). | |

### 3.3 The API refuses non-contributors (no model calls)

Paste **POST** (0.10) in each tab first.

| # | Who and what | Expected | Pass/Fail |
|---|---|---|---|
| 3.3a | **B**'s tab: `post({ messages: [u('QA-4d B probe')] })` | `403 {"error":"Only contributors can update the playbook."}`. | |
| 3.3b | **B**: `post({ role: 'contributor', playbookId: TEST, messages: [u('QA-4d B probe')] })` | `403`: "Open the playbook first." (B not a member of `test-playbook`) or "Only contributors can update the playbook." | |
| 3.3c | **C**: `post({ playbookId: TEST, messages: [u('QA-4d C probe')] })` | `403` (either message as in 3.3b). C is not a contributor of `test-playbook`. | |
| 3.3d | **P** (signed in, no roles), any tab: `post({ messages: [u('QA-4d P probe')] })` | `403 {"error":"Your account is awaiting approval."}`. | |
| 3.3e | **Signed out** (terminal): see below | **By the code: `403 {"error":"Your account is awaiting approval."}`**, not the 401 the brief expected: the route's approval check (`app/api/chat/route.ts:70-74`) runs before the handler's `401 "Please sign in."` (`handler.ts:62`), and `proxy.ts` lets `/api/chat` through unauthenticated. Record what you see; either 401 or 403 is a refusal (PASS on access), but note the message (Findings F1). | |
| 3.3f | Dev-server log, USAGE | No `[companion-v2 …]` line for any of these. USAGE: no `contributor` row for B or P; C's row (if any) unchanged. | |

```bash
curl -s -i -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"mode":"companion-v2","role":"contributor","playbookId":"<LRL_ID>","messages":[{"role":"user","content":"QA-4d anon probe"}]}'
```

---

## 4. The route's request limits (C, console, no model calls)

Every request here must be refused **before** the usage counter and the model. If any returns 200,
record a FAIL (and that it cost one call). Run USAGE before and after.

| # | In C's tab | Expected | Pass/Fail |
|---|---|---|---|
| 4.1 | `post({ playbookId: 'not-a-uuid', messages: [u('x')] })` | `400 {"error":"Invalid request."}` | |
| 4.2 | `post({ role: 'editor', messages: [u('x')] })` | 400 | |
| 4.3 | `post({ messages: [] })` | 400 | |
| 4.4 | `post({ messages: [a('hi'), u('x')] })` (starts with Cube) | 400 | |
| 4.5 | `post({ messages: [u('x'), u('y')] })` (two user turns in a row) | 400 | |
| 4.6 | `post({ messages: [u('x'), a('y')] })` (ends with Cube) | 400 | |
| 4.7 | `post({ messages: [u('   ')] })` (blank) | 400 | |
| 4.8 | `post({ messages: Array.from({ length: 41 }, (_, i) => (i % 2 ? a('a') : u('u'))) })` (41 messages) | 400 | |
| 4.9 | `post({ messages: [u('x'.repeat(60001))] })` | 400 | |
| 4.10 | `post({ messages: Array.from({ length: 7 }, (_, i) => (i % 2 ? a('y'.repeat(50000)) : u('x'.repeat(50000)))) })` (350,000 in all) | 400 | |
| 4.11 | `post({ messages: [u('x')], files: Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, text: 'x' })) })` | 400 | |
| 4.12 | `post({ messages: [u('x')], files: [{ name: 'big.txt', text: 'x'.repeat(130001) }] })` | 400 | |
| 4.13 | `post({ messages: [u('x')], files: [{ name: 'empty.txt', text: '   ' }] })` | 400 | |
| 4.14 | `post({ messages: [u('x')], files: 'nope' })` | 400 | |
| 4.15 | USAGE, dev-server log | C's contributor count **unchanged** (still no row after 1.6's reset). No `[companion-v2 contributor]` line. | |

---

## 5. Scripted request 1: change the when of the language survey (one `job.set`)

As **C**, `/companion/low-resource-language/update`, devtools open on **Network** (filter `chat|rpc`)
with **Preserve log** on. In B's browser, have `/companion/low-resource-language/jobs` open.

### 5.1 Send

Type `Change the when of the language survey to 2–3 months.` and press **Enter**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.1a | While it streams | The message appears as a bubble; three dots, then prose streaming in. At **no** point does `<playbook_patch`, `{"summary"`, `<patch_text` or any JSON show on screen, even for a moment (watch the end of the reply). The chips have gone; **Start over** has appeared. | |
| 5.1b | The prose | Short; names the job by name ("Understand the language community and the access gap"), never "P1", a JSON field name or an op name. | |
| 5.1c | The review card | **One** card labelled "Understand the language community and the access gap → When", ticked. A word diff: the old "1–2 months" struck through (red), "2–3 months" inserted (green), the rest of the sentence plain. No contradictions box, no "Not offered here". Buttons **Apply** and **Discard**, and "Changes go live as soon as you apply them. There is no undo." | |
| 5.1d | Network: the `/api/chat` request | Payload `{"mode":"companion-v2","role":"contributor","playbookId":"<LRL_ID>","messages":[{"role":"user","content":"Change the when …"}]}` (no `files`, no `part`). Response (Response tab, once finished) ends with `<playbook_patch>{…"ops":[{"op":"job.set","job":"P1","field":"when","value":"…"}]…}</playbook_patch>`: **exactly one op**. (If Chrome shows no response data for the stream, record that and rely on 5.1c.) | |
| 5.1e | Dev-server log | One `[companion-v2 contributor] stop=end_turn in=… cache_read=… cache_write=… out=…` line. **Record `out`** (for section 17). | |

If Cube instead asks which job (S1 and S5 also mention the survey), record it, answer
`Understand the language community and the access gap`, and check 5.1c–e on that reply (one extra call).

### 5.2 Include checkbox and "Edit this change"

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 5.2a | Untick the card | The card fades; the button reads **Apply 0 of 1** and is disabled. | |
| 5.2b | Tick it again | **Apply** enabled. | |
| 5.2c | **Edit this change** | A text box with the proposed When as plain text (not JSON); the link reads **Done editing**. | |
| 5.2d | Add ` (QA-4d)` at the end | The diff updates as you type and now also shows ` (QA-4d)` inserted. **Done editing**. | |

### 5.3 Apply

Click **Apply**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.3a | Screen | "Applying…", then a toast "Applied. The change is live.", "Updating the playbook…" briefly, and the card is replaced by "Applied. These changes are live." | |
| 5.3b | Network | One `POST https://<ref>.supabase.co/rest/v1/rpc/save_playbook` → 200 with a timestamp. **No** other `/api/...` request. No dev-server log line. | |
| 5.3c | As postgres: **P1** | `when_` is the old sentence with "2–3 months" and ends with "(QA-4d)". `gaps 1`. `updated_at` new. | |
| 5.3d | **FP** | `updated_at` and `jobs_md5` changed; every other md5 equal to `<FP_0>`. | |

### 5.4 The adopter sees it (B)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 5.4a | B: reload Jobs, open "Understand the language community and the access gap" | Its When shows the new text with "2–3 months (QA-4d)". | |
| 5.4b | B: Home > a **new** conversation (or the latest) > ask `How long does the language survey take?` (**1 adopter call**) | Cube answers with **2–3 months** (not 1–2). Dev log: one `[companion-v2] stop=…` line, `cache_read=0` (the playbook changed, so the cached prefix is new). | |

---

## 6. Scripted request 2: add a gap (one `job.append`)

Same chat as section 5 (don't leave the screen). Send:
`Add a gap to the language survey: no list of local radio stations existed for recruiting voice contributors (QA-4d).`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 6.1 | Review | **One** card "Understand the language community and the access gap → Gaps: add an item". A line diff: the existing gap unchanged (no `-`), one `+` line with the new gap. **No** "The playbook has changed since Cube proposed these…" note (this was proposed after the 5.3 refresh had finished). | |
| 6.2 | Network response | One op, `{"op":"job.append","job":"P1","field":"gaps","item":"…"}`. **Not** a `job.set` of the whole `gaps` list. | |
| 6.3 | Network payload | `messages` has 3 entries: your first message, Cube's first reply ending with `[You proposed 1 change: Understand the language community and the access gap → When. The contributor applied the changes they kept; …]`, and this message. | |
| 6.4 | **Apply**; as postgres **P1** | `gaps 2`, `last_gap` is the new text with "(QA-4d)". | |
| 6.5 | B: reload Jobs, open the job | Two gaps. | |

---

## 7. Scripted request 3: rewrite section 4.2 (one `source.replace_section`, text in a `patch_text` block)

Same chat. Send:
`Rewrite section 4.2 of the source document in plainer words for first-timers. Keep every figure and the cost table exactly.`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 7.1 | Review | **One** card `Source document → replace section "4.2 — Budget Categories to Plan For"`. A line diff in a scrolling box: "… N unchanged lines …" folds above and below; only lines inside 4.2 are marked `-`/`+`; the `### 4.3 — Personal Bandwidth This Actually Demands` heading appears as unchanged context after the change. No red error on the card (in particular **not** "This change is missing its "text"."). | |
| 7.2 | Network response | The block has `"op":"source.replace_section","heading":"### 4.2 — Budget Categories to Plan For","text":{"block":1}`; after `</playbook_patch>` comes `<patch_text id="1">`, the markdown (with any quotation marks unescaped), `</patch_text>`, and **nothing after it**. | |
| 7.3 | The prose | Does not repeat the whole new section (the diff shows it). | |
| 7.4 | **Edit this change** | The new section as plain markdown (not a JSON string with `\n`). Close it without changing anything (**Done editing**). | |
| 7.5 | Dev-server log | `stop=end_turn` (not `max_tokens`). **Record `out`.** | |
| 7.6 | **Apply**; as postgres **SRC** | `headings` same as `<SRC_0>` (42) unless Cube deliberately added sub-headings (record); `h42 1`; `s42` starts with the heading line and shows the new text; the table figures (₹40 lakh, ₹2 lakh, ₹4 lakh, ₹20 lakh, ~26 lakhs, ₹4 lakh, ~₹70 lakh, ~₹14 lakh, ₹84 lakh – ₹1 Cr) are all still there; the 4.3 heading follows the section. | |
| 7.7 | C: Playbook tab, then Source document tab (this leaves the chat; fine, everything is applied) | Playbook: the job drawer for the survey job shows the new When and both gaps. Source document: 4.2 shows the new text. | |

---

## 8. Requests that must not change anything

C: `/companion/low-resource-language/update`. Run **FP** before 8.1 and after 8.4.

| # | Send | Expected | Pass/Fail |
|---|---|---|---|
| 8.1 | `Change the owner.` | Cube asks **one** short question (which job, and who should own it) and proposes nothing: **no** review card, no "Not offered here". Response block: `"question":"…"` and `"ops":[]`. | |
| 8.2 | **Start over** (no confirm, since nothing is open), then `Remove the job "Map what already exists".` | The prose says removing a job is done on the **Playbook** screen (open the job, then Edit). No review card. If Cube proposed it anyway, a "Not offered here:" box lists "Removing a job is done on the Playbook screen (open the job, then Edit)." and there is still **no Apply**. Record which of the two you saw. | |
| 8.3 | **Start over**, click the chip **Edit a job** | The bubble reads "Edit a job"; Cube asks one question (which job, what change). No review card. | |
| 8.4 | Optional (1 call): **Start over**, `Remove step 3 of the sequence.` | As 8.2, for steps: "Removing a step is done on the Playbook screen (Sequence tab)." if Cube emits `phase.remove`. | |
| 8.5 | FP | Identical to the FP after 7.6 (nothing changed). | |

---

## 9. Two open proposals: a stale `find`, Apply waiting for the refresh, the "playbook has changed" note

**Start over.** In devtools > Network, set throttling to **Slow 4G** only for 9.3 (it slows the
page refresh so it can be seen). Paste this in the Console first:

```js
const watch = new MutationObserver(() => {
  const upd = [...document.querySelectorAll('[role=status]')].some((e) => e.textContent.includes('Updating the playbook'));
  if (upd) console.log('updating; Apply buttons disabled:',
    [...document.querySelectorAll('button')].filter((b) => /^Apply/.test(b.textContent.trim())).map((b) => b.disabled));
});
watch.observe(document.body, { subtree: true, childList: true, characterData: true });
```

### 9.1 Proposal A, then proposal B on the same text (2 calls)

1. Send: `In section 4.3 of the source document, change "steering it, rather than inventing it from scratch" to "steering it, not inventing it (QA-4d A)".` **Don't apply.**
2. Send: `In section 4.3 of the source document, change "steering it, rather than inventing it from scratch" to "guiding it rather than building it from nothing (QA-4d B)".` **Don't apply.**

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.1a | Both replies | Each has **one** card "Source document → change wording" (`source.replace`), each with a word diff of that phrase. Both Apply buttons enabled. | |
| 9.1b | Payload of request 2 | Cube's first reply carries `[You proposed 1 change: Source document → change wording. The contributor has not applied them yet.]`. | |
| 9.1c | If Cube used `replace_section` for either | Record it (the prompt prefers find/replace for small fixes). Then 9.2b will **not** show the "text to replace" error; instead B's diff will show A's wording being reverted, and only the 9.2b2 note warns about it (the 9.4 case). Carry on. | |
| 9.1d | Before anything is applied | **Neither** review shows "The playbook has changed since Cube proposed these…". | |

### 9.2 Apply A; B goes stale

Click **Apply** on **A**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.2a | A | Toast; "Applied. These changes are live." | |
| 9.2b | B, after "Updating the playbook…" has gone | B's card has a red border and "The text to replace isn’t in the source document (it may have changed)."; its button reads **Apply 0 of 1** and is disabled. **No** wrong edit is possible. | |
| 9.2b2 | Above B's review | The note "The playbook has changed since Cube proposed these. Check each diff: a change here may undo one you applied since. To be safe, ask Cube to propose them again." | |
| 9.2c | As postgres: `select position('not inventing it (QA-4d A)' in source_doc) > 0 as a, position('QA-4d B' in source_doc) > 0 as b from playbooks where id = '<LRL_ID>';` | `a true`, `b false`. | |
| 9.2d | B: **Discard** | "Discarded. Nothing was changed." | |

### 9.3 Apply waits while the page refreshes (throttled, 2 calls)

1. Send `Add a gap to the language survey: QA-4d refresh test one.` **Don't apply.**
2. Send `Add a gap to the language survey: QA-4d refresh test two.` **Don't apply.**
3. Set Network throttling to **Slow 4G**. Click **Apply** on the **first** of the two and watch the
   Console.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.3a | Console during "Updating the playbook…" | One or more `updating; Apply buttons disabled: [true]` lines: the second proposal's **Apply** is disabled while the page reloads its data. (`[]` means the second card wasn't on screen: record and repeat.) | |
| 9.3b | After "Updating the playbook…" has gone | The second card's **Apply** is enabled again (an append doesn't go stale); its diff now shows the first new gap as an unchanged line; the "The playbook has changed since Cube proposed these…" note is above it. | |
| 9.3c | Clean up | **Discard** the second. Throttling **off**. `watch.disconnect()`. The "refresh test one" gap stays until the restore. | |

### 9.4 Two whole-field changes to the same When: the second is flagged (2 calls)

A `job.set` replaces the whole field, so it never fails as stale; this is the case the note exists for.

1. Send `Change the when of the language survey to 3–4 months (QA-4d W1).` **Don't apply.**
2. Send `Change the when of the language survey to 4–5 months (QA-4d W2).` **Don't apply.**

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.4a | Both reviews | Each one card "Understand the language community and the access gap → When" (`job.set`, check the Network response). **No** "playbook has changed" note on either yet. | |
| 9.4b | **Apply** W1, wait for "Updating the playbook…" to go | W1: "Applied. These changes are live." | |
| 9.4c | W2 | The note "The playbook has changed since Cube proposed these. Check each diff: a change here may undo one you applied since. To be safe, ask Cube to propose them again." above its review. Its card has **no** error and **Apply** is enabled; the diff's "before" is now W1's text, so it shows "(QA-4d W1)" and "3–4 months" being removed. | |
| 9.4d | **Discard** W2; as postgres **P1** | `when_` contains "3–4 months" and "(QA-4d W1)", not "W2". | |
| 9.4e | A proposal made after the refresh | (Free check, from section 6.1: a proposal sent after an Apply has finished shows no note.) | |

---

## 10. The stale_playbook message when another tab saved; load the latest and apply again

1. **T1** (C): `/companion/low-resource-language/update`, **Start over**. Send
   `Add a gap to the language survey: QA-4d stale test gap.` (1 call). **Don't apply.**
2. **T2** (C, a second tab): `/companion/low-resource-language/source` > **Edit**, add a new last line
   `QA-4d T2 edit`, **Review changes**, **Apply**. Toast "Saved. The source document is live."
3. **T1**: **Apply**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 10.1 | T1 message | Red box: "Someone changed the playbook since you loaded it. Reload to see their change, then make yours again." and a button **Load the latest playbook, then apply again** (not "Reload now …"). | |
| 10.2 | T1 proposal | Still on screen with its diff and checkbox; Apply enabled again (not stuck on "Applying…"). No toast. No "playbook has changed" note yet (T1 hasn't seen the new playbook). | |
| 10.3 | T1 Network | The `rpc/save_playbook` call failed with `code "P0409"`, `message "stale_playbook"`. | |
| 10.4 | As postgres: **P1** and `select right(source_doc, 40) from playbooks where id = '<LRL_ID>';` | P1 gaps unchanged (no "stale test gap"); the source ends with `QA-4d T2 edit`. | |
| 10.5 | T1: **Load the latest playbook, then apply again** | **No** page reload and **no** "Reload site?" prompt: the chat, your message, Cube's reply and the review all stay. "Updating the playbook…" shows briefly. Then the note "The playbook has changed since Cube proposed these. Check each diff…" appears above the review. The red stale box may stay until you click Apply (record). Network: a page-data request (`?_rsc=…`), no document reload. | |
| 10.6 | T1: **Apply** | It saves: toast "Applied. The change is live."; "Applied. These changes are live." As postgres **P1**: the "stale test gap" is now the last gap, and the source still ends with `QA-4d T2 edit` (T2's change wasn't undone). | |
| 10.7 | T1: press **F5** | **No** prompt (nothing open, composer empty). The page reloads to an empty chat with the four chips (the conversation was never stored). | |

---

## 11. Update from files: a small file with a conflicting figure, and an image

C: `/companion/low-resource-language/update`, **Start over** (or reload). Network on, Preserve log on.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 11.1 | Click the chip **Update from files** | The file picker opens filtered to `.pdf, .docx, .pptx, .xlsx, .xls, .md, .txt` ("Custom files"). | |
| 11.2 | Switch the picker's type filter to **All files**, pick `QA-4d image.png` | A box above the composer lists "QA-4d image.png Only PDF, Word, PowerPoint, Excel, Markdown and text files can be read." in red. **↑** stays disabled with an empty composer. No network request. Remove it with **×**. | |
| 11.3 | **+** in the composer, pick `QA-4d field notes.docx` | "Reading…", then "480 characters, about 120 tokens". The placeholder becomes "What should Cube do with these files? (optional)". **No** `/api` or Storage request while reading (a `_next/static` script chunk for the reader is fine). | |
| 11.4 | Leave the composer empty, press **↑** | Your bubble reads "Update the playbook and the source document from these files." with "📄 QA-4d field notes.docx · 480 characters" under it. **One** `/api/chat` request; its payload has `files: [{ name: "QA-4d field notes.docx", text: "QA-4d field notes …QA4D-FILEONLY-7731…" }]` and **no** `part`. (1 call) | |
| 11.5 | The reply | A box "**Where the new material disagrees with the playbook**" (inside the review, above the cards) with an item on the translation cost: the playbook says ₹18–₹25 per sentence pair (or the 4.2 wording after section 7), the new material says ₹30–₹35, "(QA-4d field notes.docx)". | |
| 11.6 | The changes | A change adopting the file's figure (a source-document change to the cost line), which you can tick or leave, and probably a new gap about radio stations on a job of Cube's choice. Record the ops. | |
| 11.7 | "Only for Author" | The prose says the "Only for Author" part was left out. **No** card contains "Only for Author" or `QA4D-FILEONLY` (if one did, the alert "Content marked "Only for Author" can’t be published in the playbook or the source document." would show and Apply would be disabled: record that as a prompt FAIL, the guard as a PASS). | |
| 11.8 | **Discard** | "Discarded. Nothing was changed." FP unchanged. | |
| 11.9 | Optional (1 call): the `.md` version | Attach `QA-4d field notes.md`: "492 characters, about 123 tokens". Same expectations as 11.5–11.7; Discard. | |
| 11.10 | Network search (Ctrl+F in the Network panel, "Search" pane) for `QA4D-FILEONLY` | Hits **only** in the 11.4 request (and 11.9's, if run), in its payload, and possibly in its response if Cube quoted it. | |

---

## 12. A long file: parts, labels and overlaps (3 calls)

Same chat as section 11 (so the history now includes the 11.4 turn).

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.1 | **+**, pick `QA-4d too long.md` | "610,263 characters, about 152,566 tokens" and, in red, "That’s more than one update can take (600,000 characters). Remove a file, or upload the rest in a second update." **↑** disabled; Enter in the composer sends nothing; no request. Remove it (**×**). | |
| 12.2 | Pick `QA-4d long.md` | "330,260 characters, about 82,565 tokens" and "This is long, so Cube reads it in 3 parts, one request each, and shows all the changes together. Each part counts toward today’s limit." | |
| 12.3 | Optional: also pick `QA-4d field notes.docx` | Still "3 parts" (the small file shares the last part). Remove it again. | |
| 12.4 | **↑** (empty composer) | Bubble "Update the playbook and the source document from these files." with "📄 QA-4d long.md · 330,260 characters". | |
| 12.5 | Network | **Three** `/api/chat` requests, **one after another** (the next starts only when the previous has finished). Each payload: the same `messages` (whose earlier user turn says `[Files attached to this message earlier (not repeated): QA-4d field notes.docx, 480 characters]`, with **no** file text), `files: [{ name: "QA-4d long.md (part i of 3)", text: <≈110,000 characters> }]` and `part: { index: i, total: 3 }`. Dev log: three lines. | |
| 12.6 | While streaming | The reply builds up as "**Part 1 of 3.** …", then "**Part 2 of 3.** …", then "**Part 3 of 3.** …" (bold labels), each part's text kept as the next arrives. No review card until all three have finished. | |
| 12.7 | The review | **One** list with the changes from all parts. Contradictions mention the survey's duration (3 months, from part 1; 4 months, from part 2), with sources like "QA-4d long.md (part 1 of 3)". | |
| 12.8 | Overlaps | If parts 1 and 2 both proposed a change to the survey job's When, **both** cards show "Another part of the files also changes this. Changes apply in order, so a later one may replace this one." and part 3's card (the radio-station gap) does not. The second When card's "before" is the first one's "after" (in-order preview); untick the first and the second's "before" becomes the current When. If Cube didn't propose both, record "overlap not exercised" (the logic is covered by `check-patch.mjs`). | |
| 12.9 | **Discard**; FP | Unchanged. | |

---

## 13. The daily contributor cap (2 calls, then refusals)

### 13.1 Set the cap to 2

Stop the dev server. Add `COMPANION_DAILY_CONTRIBUTOR_CAP=2` to `.env.local`. Start `npm run dev`.
Run **RESET** (0.8), then **USAGE**.

| Expected | Pass/Fail |
|---|---|
| USAGE: no `contributor` row for C. (Each model call is counted **before** it is made: every message, every part of an upload, and refused requests too, so the count can go above the cap. To start again at any point, run RESET.) | |

### 13.2 A 3-part upload stops after part 2

C: reload `/companion/low-resource-language/update`. Attach `QA-4d long.md`, **↑**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 13.2a | The reply | "**Part 1 of 3.** …" and "**Part 2 of 3.** …", then a note: "Stopped after part 2 of 3: You’ve reached today’s limit for Update with Cube. It resets at midnight UTC. Not read: QA-4d long.md (part 3 of 3). The changes from the parts before are below. To cover the rest, upload just that material again." The review list holds the changes from parts 1 and 2 only. Nothing fails silently. | |
| 13.2b | Network | Requests 1 and 2: 200. Request 3: **429** `{"error":"daily_limit","message":"You've reached today's limit for Update with Cube. It resets at midnight UTC."}`. | |
| 13.2c | Dev log, USAGE | **Two** `[companion-v2 contributor]` lines. USAGE: `contributor 3`. | |

### 13.3 The next request gets the limit message

Type `QA-4d: one more request after the limit.` and press Enter.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 13.3a | Screen | A grey box "You’ve reached today’s limit for Update with Cube. It resets at midnight UTC." (no "Your message is back in the box below." text, but the message **is** back in the composer). No new bubble stays in the chat. | |
| 13.3b | Network, log, USAGE | One 429; no dev-server line; `contributor 4`. | |

### 13.4 Put the cap back

**Discard** the 13.2 proposal. Stop the dev server, **remove** the `COMPANION_DAILY_CONTRIBUTOR_CAP`
line, start it again, run **RESET**.

| Expected | Pass/Fail |
|---|---|
| `grep COMPANION_DAILY .env.local` prints nothing. B's `adopter` row in USAGE is unaffected by any of this (separate role). | |

---

## 14. Nothing about the contributor chat or the files is stored (no model calls)

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 14.1 | **STORED** (0.8) | `c_conversations 0`, `c_messages 0`, `qa_messages 0`, `new_objects 0`. `all_messages_since_t0` = **2** (B's one turn in 5.4b: a user and an assistant row) and nothing else. | |
| 14.2 | **MARKER** for `QA4D-FILEONLY` | Every `hits` is `0`. | |
| 14.3 | **MARKER** again with `QA-4d long notes`, then with `recording continued at the block office` | Every `hits` is `0` (the long file's text is nowhere, because its proposals were discarded). | |
| 14.4 | **MARKER** with `QA-4d` | Hits only in `playbooks.source_doc` and `playbook_jobs.body` (the changes you applied in 5–10), nowhere else. | |
| 14.5 | Google Sheets | Open the Sheet (`GOOGLE_SHEET_ID`): no rows timestamped during this run. If `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_SHEET_ID` aren't set locally, logging is off here anyway: record that, and rely on 14.6 and on section 17 (Vercel, if it has the Sheets settings). | |
| 14.6 | Dev-server log, whole run | No `[logger]` line. The only `[companion-v2 …]` lines are the usage lines (numbers only, no text from messages or files). | |
| 14.7 | Network, whole session: search `QA4D-FILEONLY` | Only 11.4 (and 11.9). Every later `/api/chat` payload refers to the file as `[Files attached to this message earlier (not repeated): QA-4d field notes.docx, 480 characters]`. | |
| 14.8 | Browser storage (C's tab console) | `[localStorage, sessionStorage].flatMap((s) => Object.keys(s).filter((k) => /QA4D|QA-4d/.test(s.getItem(k))))` → `[]`. | |

---

## 15. The Source document screen (no model calls)

C: `/companion/low-resource-language/source`. Run **SRC** first.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 15.1 | Look | Tab **Source document** underlined. A size meter: a thin bar and "About N of 100,000 tokens." with N = SRC `approx_tokens` (muted grey). Buttons **Edit** and **Update from files**. The document rendered as formatted markdown (headings, lists, the 4.2 table or list). No "This document has no headings…" note. | |
| 15.2 | **Edit** | A monospace text box with the whole document, focused. Above it: "Markdown: start a line with ## or ### for a heading. Keep the headings unique; Cube finds sections by them. Never paste content marked “Only for Author”." Below: **Review changes** (disabled), **Cancel**, "No changes yet." The Edit and Update from files buttons have gone. | |
| 15.3 | **Cancel** with nothing changed | Closes at once, no question. | |
| 15.4 | **Edit**, Ctrl+End, type two Enters and `QA-4d source editor line.` | "No changes yet." goes; **Review changes** enabled; the meter's number goes up slightly. | |
| 15.5 | **Review changes** | One card "**Source document**" (no **Edit this change** link) with a line diff: folded "… N unchanged lines …" and `+ QA-4d source editor line.` at the end. Buttons **Apply** and **Back to editing**. | |
| 15.6 | **Back to editing** | The editor with your line still there; focus back in the text box. | |
| 15.7 | **Cancel** | The browser's dialog "Stop editing? Your changes here will be lost." Click **Cancel** in it: still editing, line kept. **Cancel** again, then **OK**: back to the view; FP unchanged. | |
| 15.8 | Amber: **Edit**, then in the Console run the snippet below with `17000` | The meter turns **amber**: "About 8x,xxx of 100,000 tokens: getting close to the limit." **Review changes** still enabled. (Don't review.) | |
| 15.9 | Red: run the snippet again with `6000` (adds 96,000 more characters) | The meter turns **red**, the bar is full: "About 10x,xxx of 100,000 tokens: too long for Cube to read whole. Shorten it before saving." **Review changes** disabled. (If it isn't red yet, the document was shorter than expected: run it once more and record.) | |
| 15.10 | **Cancel** → **OK** | Back to the view; the meter shows N again; FP unchanged. | |
| 15.10a | Make the **stored** document over the cap: run the "OVERCAP" console snippet below as C | Prints `saved` and a timestamp. (`save_playbook` has no size check, so this works: the remaining half of Findings F5.) | |
| 15.10b | Reload the Source document | The meter is **red**: "About 10x,xxx of 100,000 tokens: too long for Cube to read whole. Shorten it before saving."; the view ends with the pad lines. | |
| 15.10c | **Edit**, then `setDoc((v) => v + ' x')` | Still red; **Review changes** **disabled** (it would grow a document already over the cap). | |
| 15.10d | `setDoc((v) => v.slice(0, -16000))` | Still red (still over the cap) but now shorter than the stored one: **Review changes** **enabled**. **Review changes**: one "Source document" card, **no** red size alert, **Apply** enabled (the same rule as the diff screens: shrinking is allowed). **Back to editing**. | |
| 15.10e | `setDoc((v) => v.slice(0, v.indexOf('\n\nQA-4d pad line.')))`, then **Review changes**, **Apply** | Saves ("Saved. The source document is live."); the meter is back to N, muted. SRC: `chars` equals its value before 15.10a. | |
| 15.11 | Guard: **Edit**, add a last line `Only for Author: QA-4d guard test`, **Review changes** | A red alert "Content marked "Only for Author" can’t be published in the playbook or the source document."; **Apply** disabled. **Back to editing**, **Cancel** → **OK**. | |
| 15.12 | **Apply** (the real one): **Edit**, add a last line `QA-4d source editor line.`, **Review changes**, **Apply** | Toast "Saved. The source document is live."; "Updating…" next to the buttons, and while it shows **Edit** is disabled; then the view shows the new line at the end. Network: one `rpc/save_playbook` → 200, no `/api/...`. No dev-server line. SRC: `chars` up by the line; FP `source_md5` changed. | |
| 15.13 | Stale in the editor: **Edit** (T1), add `QA-4d T1 stale`; in **T2** `/companion/low-resource-language/playbook`, ✎ any job, add ` (QA-4d T2)` to When, Review, Apply; back in T1 **Review changes**, **Apply** | The stale message, and here the button still reads **Reload now (your unsaved changes here are lost)** (only Update with Cube has the "Load the latest playbook" button); the review stays. **Back to editing**, **Cancel** → **OK**. As postgres: the source has no `QA-4d T1 stale`. | |
| 15.14 | **Update from files** | Goes to `/companion/low-resource-language/update?from=files`: a highlighted card "Choose the files to update from. Cube reads them, compares them with the playbook and the source document, and proposes changes for you to review. The files aren’t stored." with **Choose files**; the four chips below. **Choose files** opens the picker; cancelling it leaves the card. Picking `QA-4d field notes.md` hides the card and lists the file (don't send; remove it with **×**). | |

Snippet for 15.8–15.10e (types into the React-controlled box the way a paste would; the editor must be open):

```js
function setDoc(fn) {
  const ta = document.querySelector('textarea[aria-label="Source document (markdown)"]');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, fn(ta.value));
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  console.log(ta.value.length, 'characters,', Math.ceil(ta.value.length / 4), 'tokens');
}
const pad = (n) => setDoc((v) => v + '\n\n' + 'QA-4d pad line. '.repeat(n));
pad(17000);   // 15.8 (adds 272,000 characters)
// pad(6000); // 15.9
```

"OVERCAP" for 15.10a (C's own session on a throw-away client, the Slice 4b 15.1 pattern; fill in the
URL and anon key from `.env.local` and C's password):

```js
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const sb = createClient('https://<ref>.supabase.co', '<anon key>', { auth: { persistSession: false, autoRefreshToken: false } });
await sb.auth.signInWithPassword({ email: '<C email>', password: '<C password>' });
const { data: pb } = await sb.from('playbooks').select('updated_at, source_doc').eq('id', '<LRL_ID>').single();
const r = await sb.rpc('save_playbook', {
  p_playbook_id: '<LRL_ID>', p_base_updated_at: pb.updated_at,
  p_playbook: { source_doc: pb.source_doc + '\n\n' + 'QA-4d pad line. '.repeat(23000) }, // +368,002 characters
  p_jobs: [], p_removed_jobs: [],
});
console.log(r.error ? r.error : ['saved', r.data]);
```

---

## 16. Leaving the screens with unsaved work (no model calls unless 16.15)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 16.1 | Update with Cube, empty chat: type `QA-4d draft`, press **F5** | The browser asks "Reload site? Changes you made may not be saved." **Cancel**: the text is still there. | |
| 16.2 | Clear the composer, **F5** | No prompt. | |
| 16.3 | Attach `QA-4d field notes.md` (ready), **Ctrl+W** | A "Leave site?" prompt. **Cancel**, remove the file. | |
| 16.4 | With an **open proposal** on screen (do this right after any request in 5–12, before Apply), **F5** | Prompt. | |
| 16.5 | Source document: **Edit**, type a character, **F5** | Prompt. **Cancel**. | |
| 16.6 | **Edit** with nothing changed, **F5** | No prompt. | |

The workspace tabs (client-side links, which don't fire `beforeunload`) now ask through
`confirmLeave()` in `WorkspaceTabs.tsx`:

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 16.7 | Source document: **Edit**, type `QA-4d`, click the **Jobs** tab | The browser dialog "Leave this screen? Your unsaved work here will be lost." **Cancel**: you stay on the Source document, still editing, `QA-4d` still there. | |
| 16.8 | Same, click **Jobs** again and choose **OK** | You go to Jobs; back on Source document the draft is gone (expected: you agreed). | |
| 16.9 | Source document: **Edit** with nothing changed, click **Jobs** | No dialog; you go straight there. | |
| 16.10 | Update with Cube: type `QA-4d` in the composer, click **Playbook** | The dialog; **Cancel** keeps you there with the text. Clear the composer. | |
| 16.11 | Update with Cube: attach `QA-4d field notes.md`, click **Assets** | The dialog; **Cancel**, remove the file. | |
| 16.12 | Update with Cube with an **open proposal** (right after any request in 5–12, before Apply), click **Jobs** | The dialog; **Cancel**: the chat and the proposal are intact. | |
| 16.13 | Update with Cube, everything applied or discarded and the composer empty, click **Jobs** | No dialog. | |
| 16.14 | Clicking the tab you are already on (e.g. **Update with Cube** while there, with a draft) | No dialog (nothing is left). | |
| 16.15 | Optional (1 call): send `Add a gap to the language survey: QA-4d leave test.` and, while it is still streaming, click **Jobs** | The dialog (a reply is coming). **Cancel**: the reply carries on. Do it again and choose **OK**: Network shows that `/api/chat` request **(canceled)**; dev log has no `failed mid-stream` error; USAGE: C's contributor count went up by 1 (counted when the call started). FP unchanged. | |
| 16.16 | **Known gaps** (record, not a FAIL): with a draft in either screen, (a) the browser's **Back** button, (b) a sidebar link (e.g. **All playbooks** or the app sidebar) | **By the code: no dialog**, and the work is lost: only the workspace tabs call `confirmLeave()`. Record what you see. | |

---

## 17. Timing on the non-production Vercel deployment (plan acceptance)

The route sets `maxDuration = 300` and contributor replies stop at 8,000 tokens, chosen to fit Vercel
Hobby's 300 s limit (plan, review note 2). The check must be made **on the deployment**, not locally.

### 17.1 Setup

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 17.1a | The non-production Vercel project has this working tree deployed | This needs either a commit and push of `cube-2` (which waits for your "commit") or a preview deploy from the CLI; production deploys only from `main`. Copy the URL into `<VERCEL_URL>`. | |
| 17.1b | Its environment | `NEXT_PUBLIC_CUBE_VERSION=2`; the **non-production** Supabase URL and keys; `ANTHROPIC_API_KEY`; `COMPANION_DAILY_CONTRIBUTOR_CAP` unset or ≥ 5. | |
| 17.1c | Vercel > the project > Settings > Functions | The plan (Hobby or Pro) and the maximum duration. Record. | |

### 17.2 Measure

From the local runs, take the request with the **largest `out=`** (5.1e, 7.5, 12.5: usually the 4.2
rewrite or one long-file part). As C on `<VERCEL_URL>/companion/low-resource-language/update`, devtools
> Network, **no throttling**, **Disable cache** on, send exactly that request.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 17.2a | The reply | Finishes normally: the review card appears; **no** "Cube’s reply was interrupted. Please try again."; **no** "Cube's reply came without its list of changes" note. | |
| 17.2b | Network > the `/api/chat` request > **Timing** | "Waiting for server response" + "Content Download" **< 300 s**. Record the total and the margin. | |
| 17.2c | Vercel > the project > **Logs**, filter `/api/chat` | The invocation's duration matches 17.2b; status 200; **no** "Task timed out", 504 or `FUNCTION_INVOCATION_TIMEOUT`; **no** "reply hit max_tokens" warning; **no** `ENOENT … companion-v2-contributor.md` (see Findings F7). (No `stop=` usage line here: it is printed only outside production.) | |
| 17.2d | **Discard** | Nothing applied from Vercel. | |
| 17.2e | Optional worst case (1 call): `Rewrite sections 7.1 to 7.5 of the source document in plainer words for first-timers, keeping every figure and all seven failure patterns.` | Either finishes < 300 s with a review card, or reaches 8,000 tokens and shows the cut-off note **before** 300 s. A timeout is a FAIL. Record the time; Discard. | |
| 17.2f | Optional (3 calls): `QA-4d long.md` on Vercel | Each of the three requests < 300 s. Discard. | |
| 17.2g | Sheets (if Vercel has the Sheets settings) | No new row from these calls. | |

---

## 18. Phone width (375 px, C)

Devtools > device toolbar > a 375 px phone, touch on. After each row, in the Console:
`document.documentElement.scrollWidth <= innerWidth` → `true`.

| # | Screen | Expected | Pass/Fail |
|---|---|---|---|
| 18.1 | Update with Cube, empty | The intro wraps; the tabs scroll sideways inside their bar; the four chips wrap onto several lines; the composer (**+**, text box, **↑**) fits and stays at the bottom while scrolling. | |
| 18.2 | With an attachment (`QA-4d long.md`) | The name and "330,260 characters, about 82,565 tokens" wrap; the 3-parts note wraps; **×** stays on the right. Remove it. | |
| 18.3 | A reply with a review (send `Change the when of the language survey to 2–3 months (QA-4d phone).`, 1 call) | The prose wraps; the card's label and **Edit this change** wrap; the word diff wraps; **Apply** / **Discard** and the "no undo" note wrap. **Discard**. | |
| 18.4 | A line diff (optional: reuse 18.3 with a source-section request, or check a 15.5 review at 375 px instead) | Long lines wrap inside the grey box; the box scrolls inside itself (max ~420 px tall), not the page. | |
| 18.5 | Source document, view | The meter (min 220 px) and **Edit** / **Update from files** stack or wrap; the document text wraps. The 4.2 table: record whether it scrolls inside its own box or widens the page (`scrollWidth` check). | |
| 18.6 | Source document, Edit and Review | The text box is full width and scrolls inside; the buttons wrap; the review card's diff fits. **Cancel** → **OK**. | |
| 18.7 | The Start over confirm and the stale message | Fit the width; buttons reachable. | |

---

## 19. Regression

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 19.1 | C: Playbook tab, ✎ a job, change When, **Review changes** (don't apply) | The Slice 4b review works as before: diff, checkbox, **Apply** enabled, no overlap note, no contradictions box, no size alert. **Close** → OK. | |
| 19.2 | C: Assets tab | As after 4c. | |
| 19.3 | B: Home and Jobs | Work; 40 jobs, "Only mine" as before. | |
| 19.4 | `npm run lint` and `npx tsc --noEmit` (terminal) | No errors in the 4d files. | |
| 19.5 | Console, all pages, whole run | No React errors or unhandled promise rejections. | |
| 19.6 | Dev-server log, whole run | `[companion-v2 contributor]` lines = the contributor calls you made (about 19 plus optionals); `[companion-v2]` lines = 1 (5.4b). No `failed mid-stream`, `usage counter failed` or `load failed` lines. | |

---

## 20. Things to record

Not pass/fail by themselves.

| Measure | Details |
|---|---|
| `out=` and `cache_read=` per contributor call (5.1e, 6, 7.5, 8, 9, 10, 11, 12, 13) | |
| 5.1: did Cube pick the right job straight away, or ask? | |
| 7.6: did the 4.2 rewrite keep every figure? Any headings added or lost? | |
| 8.2: refused in prose only, or via "Not offered here"? | |
| 9.1c: did Cube use `source.replace` for both small edits? | |
| 9.4: did both W1 and W2 come back as `job.set` on When? | |
| 10.5: did the red stale box stay after "Load the latest playbook" until Apply? | |
| 11.6: which ops did the conflict file produce; which job got the radio-station gap? | |
| 12.8: overlap exercised or not | |
| 13.2c / 13.3b: USAGE counts above the cap (3, 4) | |
| 16.16: work lost on Back or a sidebar link without a prompt (known gap) | |
| 17.2b: longest time on Vercel, plan and limit; 17.2e run or not | |
| 18.5: the 4.2 table at 375 px | |
| 3.3e: 401 or 403 for a signed-out caller | |

---

## 21. RESTORE (mandatory)

### 21.1 Re-seed from the backup (terminal)

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
  --json "<BACKUP_DIR>/low-resource-language.json" \
  --source "<BACKUP_DIR>/low-resource-language.source.md" \
  --force --prune
```

| Expected | Pass/Fail |
|---|---|
| A source-size line, then `Re-seeded "low-resource-language" (<LRL_ID>): 40 jobs, 23 roles, 14 phases, 12 rules.` (same id). No `Pruned` line (this script adds no jobs; if one appears, record it). Exit 0. | |

### 21.2 Round trip (terminal)

```bash
node --env-file=.env.local scripts/cube2/export-db.mjs --slug low-resource-language --out "<AFTER_DIR>"
cmp "<BACKUP_DIR>/low-resource-language.json" "<AFTER_DIR>/low-resource-language.json" && echo "json identical"
cmp "<BACKUP_DIR>/low-resource-language.source.md" "<AFTER_DIR>/low-resource-language.source.md" && echo "md identical"
```

| Expected | Pass/Fail |
|---|---|
| `json identical` and `md identical`. If not, `git diff --no-index` the pair and record; don't go on until it's understood. | |

### 21.3 Database checks (as postgres)

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 21.3a | FP vs `<FP_0>` | Identical except `updated_at` (new) and `updated_by` (`null` after a seed). | |
| 21.3b | SRC vs `<SRC_0>` | Identical. | |
| 21.3c | MARKER with `QA-4d` | **All 0.** | |
| 21.3d | 1.4 query | C still `contributor`, B still `adopter`. | |
| 21.3e | RESET | Clears C's contributor count for today (optional; it resets at midnight UTC anyway). | |

### 21.4 In the app

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 21.4a | C: reload Source document | 4.2 is the original table; no QA lines at the end; 4.3 says "steering it, rather than inventing it from scratch". Close any tab opened before the restore (its next save would rightly be stale). | |
| 21.4b | B: reload Jobs, open the survey job | When "1–2 months", one gap. | |

---

## 22. Clean up

- Section 21 passed: delete `<BACKUP_DIR>`, `<AFTER_DIR>` and `<FILES>`.
- `.env.local`: no `COMPANION_DAILY_CONTRIBUTOR_CAP` line (13.4).
- B's 5.4b conversation can stay, or be deleted from B's sidebar (🗑).
- Devtools: throttling off, device toolbar off, "Disable cache" off.

---

## Acceptance criteria to steps

| Slice 4d acceptance criterion / requested check (plan and brief) | Steps | Pass/Fail |
|---|---|---|
| "Change the when of the language survey to 2–3 months" yields **one `job.set`** (on "Understand the language community and the access gap"), its diff, and an Apply | 5.1, 5.2, 5.3 | |
| "Add a gap to the language survey: …" yields **one `job.append`** | 6.1, 6.2 | |
| "Rewrite section 4.2 of the source" yields **one `source.replace_section`**, its text delivered in a `patch_text` block | 7.1, 7.2, 7.4, 7.6 | |
| The longest contributor reply in the scripted set finishes inside the function time limit **on the non-production Vercel deployment**, not only locally (how measured: Network Timing and Vercel Logs duration) | 17 | |
| With `COMPANION_DAILY_CONTRIBUTOR_CAP=2`, the third contributor request gets the daily-limit message; a 3-part file update stops at the cap and says so (each part and each message counts; how to reset `companion_usage`) | 13 (RESET in 0.8) | |
| An ambiguous request ("Change the owner.") gets one question and no ops | 8.1 (also 8.3, the Edit a job chip) | |
| Asking to remove a job is redirected to the Playbook screen | 8.2 (8.4 for steps) | |
| Uploading a doc with a conflicting figure lists a contradiction (.docx; .md optional) | 11.4–11.7 (11.9) | |
| An image is refused | 11.2 | |
| A long file (> 120k characters) is split into parts with "Part i of n" labels and overlap notes; over 600k is refused | 12 | |
| After Apply, the adopter chat reflects the change (and the Jobs screen) | 5.4, 6.5 | |
| Nothing about the contributor chat or the files exists in the database or in Sheets; file text only in that turn's `/api/chat` request body | 11.10, 14 | |
| A stale `find` shows an error rather than a wrong edit (apply a change to the same text first) | 9.1, 9.2 | |
| Review/apply: diff shown, untick, edit a change, Apply goes live (adopter in another browser), Discard | 5.1c, 5.2, 5.3, 5.4, 9.2d, 9.4d, 11.8 | |
| Two open proposals where applying one makes the other's change stale | 9.2 | |
| A proposal made before the playbook changed shows "The playbook has changed since Cube proposed these…": two `job.set` on the same When, apply the first, the note is on the second (and not before, nor on a proposal made after the refresh) (fix for F4) | 9.1d, 9.2b2, 9.3b, 9.4, 6.1, 10.5 | |
| Apply blocked while the page refreshes | 9.3 (and 15.12 for Edit) | |
| The stale_playbook message when another tab saved meanwhile; the proposal stays | 10.1–10.3, 15.13 | |
| In Update with Cube the stale-save button reads "Load the latest playbook, then apply again", refreshes the data without clearing the chat, then Apply works; elsewhere it still reloads the page (fix for F3) | 10.1, 10.5, 10.6; 15.13 (elsewhere) | |
| Access: adopter 404 on /update and /source; adopter POST with role "contributor" → 403; signed out → refused (401 expected by the brief, 403 by the code) | 3.2, 3.3 | |
| The route's request limits refuse oversize or malformed requests before the counter and the model | 4 | |
| Source document: view, Edit, size meter amber/red with Review blocked when growing past the cap, Review shows a diff, Back to editing keeps the draft, Cancel asks before discarding, Apply makes it live, the "Only for Author" guard | 15.1–15.12 | |
| A shorter version of an over-cap document can be reviewed and saved; growing it is blocked (fix for the editor half of F5) | 15.10a–15.10e | |
| beforeunload warning with unsaved edits (both screens) | 16.1–16.6 | |
| The workspace tabs ask "Leave this screen? Your unsaved work here will be lost." with an open proposal, attached files, a draft or a reply coming (Update with Cube) or an unsaved edit (Source document); Cancel stays; no dialog when nothing is unsaved (fix for F2). Back and the sidebar are a known gap | 16.7–16.15 (16.16 records the gap) | |
| The "Update from files" link opens Update with Cube with the Choose files card | 15.14 | |
| Phone width (375 px), both screens | 18 | |
| `check-patch.mjs` passes, including the 4d checks | 2 | |
| Backup before, restore after, round trip byte-identical | 1, 21 | |

---

## Findings (from reading the code; not yet confirmed by running it)

Ordered most significant first. Line numbers are for the working tree at 21:31 on 2026-11-05.
F2, F3, F4 and the editor half of F5 were **fixed** at 21:31; their original text is kept, shortened,
with the fix and the steps that confirm it. F1, F6, F7 and F8 are open; F9 is fixed.

**F4. A proposal made before another one was applied can quietly undo it (medium). FIXED (warned),
confirm with 9.4, 9.2b2, 9.3b, 6.1.** After any Apply every open proposal is re-previewed against the
refreshed playbook, so `find`, `expect` and heading ops fail as stale (9.2), but whole-value ops
(`job.set`, `overview.set`, `rules.set`, `role.set`, `phase.set`) and `source.replace_section` still
apply and can put back the old text around their change. **Fix:** each reply records the playbook's
`updated_at` it was made against (`use-contributor-chat.ts:199`), and a proposal whose value differs
from the page's current one shows "The playbook has changed since Cube proposed these. Check each diff:
a change here may undo one you applied since. To be safe, ask Cube to propose them again."
(`ContributorChat.tsx:366`, the note above `PatchReview`). It is a warning: the change can still be
applied, and the diff shows what it undoes. **Still open, low:** the overlap note between parts of one
upload (`use-contributor-chat.ts:248`) keys `source.replace_section` by heading and `source.replace` by
its `find` text (`playbook-patch.ts:185-218`), so two changes inside one section from different parts
aren't flagged as overlapping (both are made against the same playbook, so the new note doesn't apply).

**F2. Switching tabs inside the app lost unsaved work with no warning (medium). FIXED for the
workspace tabs, confirm with 16.7–16.15; known gap 16.16.** `beforeunload` only fires on reload,
close or a typed URL, and the tabs are client-side links. **Fix:** `lib/companion-v2/leave-warning.ts`
counts screens with unsaved work (`useLeaveWarning`, used by `ContributorChat.tsx` for an open
proposal, attached files, a draft or a reply coming, and by `SourceDocument.tsx:64` for a changed
draft), and `WorkspaceTabs.tsx:41` calls `confirmLeave()`: "Leave this screen? Your unsaved work here
will be lost." **Still open (known gap):** the browser's Back button and links outside the tabs (the
"← All playbooks" link in `app/companion/[slug]/layout.tsx`, the app sidebar) navigate without the
dialog and lose the work.
- Given an open proposal or a changed Source document draft
- When the contributor presses Back, or clicks "All playbooks" or a sidebar link
- Then they are asked to confirm before leaving, and Cancel keeps the work

**F3. "Reload now" after a stale save threw away the whole contributor chat (medium, UX). FIXED,
confirm with 10.1, 10.5, 10.6.** **Fix:** in Update with Cube, `PatchReview` gets `onReload`
(`ContributorChat.tsx:430`), and the button reads "Load the latest playbook, then apply again"
(`PatchReview.tsx:285-286`), refreshing the page's data with `router.refresh()` and keeping the chat;
the outdated-proposal note (F4) then appears on it. Elsewhere (the Playbook forms, the Source document
editor, 15.13) it still reloads the page, which loses only that one edit.

**F1. A signed-out call to the contributor chat gets "Your account is awaiting approval." (low).**
`app/api/chat/route.ts:70-74` runs `hasAnyRole` before `handleCompanionV2`, and `proxy.ts` lets
`/api/chat` through without a session, so an anonymous caller gets **403 "awaiting approval"**; the
handler's `401 "Please sign in."` (`handler.ts:62`) is unreachable through the route. Access is still
refused, so this is wording and status only.
- Given no session
- When `POST /api/chat` with `mode: "companion-v2"`
- Then the response is 401 with a sign-in message, and no model call or usage count is made

**F5. The 100k-token cap on the source document is enforced only in the browser (low). Editor
half FIXED, confirm with 15.10a–15.10e; server half open.** **Fixed:** the editor used to disable
Review whenever the draft was over the cap, even when it shrank a document already over it; now it
blocks only a draft that is over the cap **and** longer than the stored document
(`SourceDocument.tsx:61-62`), the same rule as `checkSize` (`patch.ts:555-561`) in the diff screens.
**Still open:** `save_playbook` writes `source_doc` with no size check
(`0034_cube2_playbooks.sql:221`), so a console RPC can store any size (15.10a does exactly that), and
every adopter and contributor prompt then loads the whole document.
- Given a contributor calling `save_playbook` directly with a source document over 100,000 tokens (about 400,000 characters) that is longer than the stored one
- When the call runs
- Then it is refused with an error and nothing is changed

**F6. Cube's one-line `summary` is parsed but never shown (low, open).** `Reply` doesn't pass
`proposal.summary` to `PatchReview` (`ContributorChat.tsx:420-431`), so the `summary` prop
(`PatchReview.tsx:187`) is never used on this screen. The prose usually covers it, so this is cosmetic.

**F7. Risk on Vercel: the contributor prompt file is read at run time, outside the try (low).**
`loadContributorInstructions()` reads `content/companion-v2-contributor.md` through
`process.cwd()` (`prompt.ts:240-243`) and is awaited at `handler.ts:173`, before the `try`. If the
file isn't traced into the function bundle (there is no `outputFileTracingIncludes` in
`next.config.ts`), every contributor call would fail with a raw 500 rather than the 503 message. The
adopter prompt uses the same pattern, so check whether Slice 2 was confirmed on Vercel; 17.2c checks
it directly.

**F8. The history note doesn't say which changes were kept (low, open).** For an applied proposal,
`use-contributor-chat.ts:64-67` lists **all** proposed changes and says "the contributor applied the
changes they kept". Cube can't tell which were unticked or edited unless it compares with the current
playbook (which it does see), so a follow-up may assume an unticked change is live.

**F9 (fixed: Send and the chips now wait while the playbook refreshes).** Was low. A proposal sent while the page is still refreshing after an Apply gets the
"playbook has changed" note although it is current.** The composer doesn't wait for the refresh
(`canSend`, `ContributorChat.tsx:132`, doesn't check `refreshing`), and the reply records the page's
`updated_at` from before the refresh landed (`use-contributor-chat.ts:199`), while the server already
read the saved playbook. The note then shows on a proposal that is up to date. A false alarm only
(the change can still be applied), but it teaches contributors to ignore the note. To see it: Apply
with throttling on (as 9.3), and send a request while "Updating the playbook…" still shows.
- Given an Apply whose refresh hasn't finished
- When the contributor sends a new request and Cube proposes changes
- Then that proposal shows no "playbook has changed" note (or sending waits until the refresh is done)

**Observations (by design, recorded so they aren't mistaken for bugs).**
- Refused requests still raise `companion_usage.count` (`0036_cube2_companion.sql:246-251`), so the
  count goes past the cap (13.2c: 3, 13.3b: 4). Each part of an upload and each failed model call
  counts, as the plan intends.
- A file over 100 MB shows "This file couldn’t be read." rather than the size message
  (`ContributorChat.tsx:99-102`).
- The size meter and the parts estimate use 4 characters per token (`playbook-patch.ts:312`,
  `SourceDocument.tsx:10`); for Indic-script text this understates the real token count.
- The 413 "This is too much for Cube to read at once…" reply (`handler.ts:195-201`) is not exercised
  here: it needs a prompt over the model's context, which the client's history limit (160,000
  characters, `use-contributor-chat.ts`) and the 600,000-character upload limit are designed to prevent.
