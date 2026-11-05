# Cube 2.0 Slice 4c: manual test script

Branch `cube-2`. This covers what Slice 4c delivers (see `docs/design/cube2-plan.md`, "Slice 4c",
section 2 "`0035_cube2_assets.sql`" (bucket, direct uploads, no orphan files), section 6 "Job
detail" and section 7 "Assets"):

- the contributor **Assets** screen, `app/companion/[slug]/assets/page.tsx` (contributor-only via
  `requireContributor`) and `components/companion-v2/assets/AssetsManager.tsx` (list, `AddAsset`,
  `EditAsset`, `JobPicker`, delete with confirm, the orphan banner);
- `lib/companion-v2/assets.ts`: `uploadWithProgress` (**one** XHR `POST` straight to
  `<project>.supabase.co/storage/v1/object/assets/…` with the contributor's own token and a progress
  bar; no TUS/resumable upload), `contentTypeFor` / `opensInline` (only pdf, png, jpg, jpeg, gif,
  webp and txt get their real type and open in the browser; everything else, e.g. html, svg, docx,
  is stored as `application/octet-stream` and opened as a download), `createFileAsset` (new
  `asset_id` in the browser → upload → "Saving…" → insert the row → **remove the object if the
  insert fails**, and say truthfully whether that removal worked), `createLinkAsset`, `updateAsset`
  and `deleteAsset` (both report "couldn't be changed/deleted … reload the page" when RLS lets zero
  rows through; delete is row first, then the object), `listOrphans` (only files with no row that
  are **older than 10 minutes**) and `removeOrphans` (fetches that list **again** right before
  removing), `safeFileName`, the 100 MB browser check and the "bigger than the project allows"
  message;
- the committed `supabase/migrations/0035_cube2_assets.sql`: the `assets` table and its checks
  (`assets_kind_target`, `assets_url_http`, `assets_path_in_playbook`), RLS, the private `assets`
  bucket (100 MB, any type), the four `storage.objects` policies and the contributor-only
  `asset_orphans` view;
- the adopter side: file assets now open through a signed URL everywhere (`AssetLink.tsx` in the
  job sheet, General resources, **and now the chat chips**: `CompanionChat.tsx` and
  `app/companion/[slug]/page.tsx` were changed in this slice so a file chip is a button, not a
  dead label); non-inline types are signed with `download`; on the Jobs page
  (`app/companion/[slug]/jobs/page.tsx`) an asset tagged **only** to jobs that no longer exist is
  listed under General resources.

**Already checked automatically, so not repeated here:** lint, types and build; against the real
test project, the upload endpoint accepts a file, and a **55 MB** upload is refused with "The object
exceeded the maximum allowed size". So the project's **global** upload limit is below 100 MB
(probably the Free plan's 50 MB), and the bucket's own 100 MB setting can't lift it (plan, review
note 8 and "Remaining check").

**Consequence for the plan's "90 MB file" acceptance check.** The app supports 90 MB where the
project allows it, but the check **cannot pass on this project as it stands** (cap ~50 MB); here a
file over the cap must show the friendly "bigger than the project allows" message. Section 4 therefore tests: (a) a ~45 MB file that must succeed; (b) a ~60 MB file that
must show the friendly too-big message and leave **no object and no row**; (c) a 90 MB file,
**optional**, only if you raise the project's limit (Dashboard → Storage → Settings); (d) a file over
100 MB, refused in the browser before any upload. Record the outcome of (c) as "not run" if you don't
raise the limit; the acceptance table at the end says so.

**Not covered here, because later slices build them:** Update with Cube, Source document and Update
from files (4d), Conversations (5).

> **Uploads in this script are real objects in the test project's Storage.** Every asset you add
> carries the marker **`QA-4c`** in its description (the description is required, so type it every
> time). Section 19 (clean up) removes all QA rows and objects. If you stop part-way, go straight to
> section 19. **Section 8 adds a blocking constraint to `assets`: it must be dropped again in the same
> section** (19.1 double-checks).

**Cost.** One Anthropic call (section 13.1). Per the Product Charter, the Anthropic account in
`.env.local` was a free trial due to expire on **28-Oct-2026** (TD-16), which is already past. If
that call fails with a 401 or 403, check the account before recording a failure. Everything else in
this script is browser ↔ Supabase and must print **no** `[companion-v2]` line.

---

## 0. Before you start

### 0.1 Safety check: are you pointed at the TEST project?

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local
git branch --show-current
git status --short
```

| Expected | Pass/Fail |
|---|---|
| The project ref matches the **test** project. The branch is `cube-2`. `git status` shows the uncommitted 4c files (`AssetsManager.tsx`, `lib/companion-v2/assets.ts`, the three modified files). **If the ref is production, stop here.** | |

### 0.2 `.env.local` and the dev server

`NEXT_PUBLIC_CUBE_VERSION=2` is set. `COMPANION_DAILY_MESSAGE_CAP` and
`COMPANION_V2_FAIL_AFTER_CHARS` are **not** set. Start `npm run dev`. The terminal is the
**dev-server log**: each model call prints one `[companion-v2] stop=... in=... cache_read=...` line.

**Go to pages by URL, not via Home.** Opening a Home tab with an empty latest conversation can start
Cube's greeting (a model call). In this script, C goes straight to
`/companion/low-resource-language/assets` and B straight to `/companion/low-resource-language/jobs`,
except in section 13.

### 0.3 Test accounts (same as Slice 4b, plus D and P)

| Name | Purpose | Roles |
|---|---|---|
| **A** | Admin. Only needed if C has lost the contributor row (1.1). | Listed in `ADMIN_EMAILS` |
| **B** | Adopter of the main playbook. Sees and opens assets; the negative console checks. | `adopter`, `lrl_role adopter` |
| **C** | Contributor to the main playbook. **Does most of this script.** | `adopter`, `playbook_members.member_role = contributor` on `low-resource-language` only |
| **D** | Adopter of `test-playbook` only. Must see nothing of the main playbook's assets. | `adopter` |
| **P** | Pending user (no roles). Gate check, and the fallback for D if D has already joined (1.1). | none |

**Do not open any `/companion/low-resource-language/…` page as D until section 11.3.** Any approved
user who opens a listed playbook joins it as an adopter (plan, Decision 6), after which D would
rightly see its assets and section 11's checks would mean nothing.

Use **two browsers** (or a normal and a private window): one for C, one for B (and later D, P).

### 0.4 Values to fill in as you go

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>`, `<TEST_ID>` | | 1.1 |
| `<B>`, `<C>`, `<D>` (user ids), `<B_MEMBER>` (B's `playbook_members.id` on the main playbook) | | 1.1 |
| `<T0>` (start time) | | 1.5 |
| `<GLOBAL_LIMIT>` (the project's upload limit as shown in the Dashboard) | | 1.3 |
| `<FILES>` (an empty folder **outside** the repo, e.g. `D:/cube2-4c-files`) | | 0.9 |
| `<PDF_ID>`, `<PDF_PATH>` (the 2 MB PDF asset) | | 3.5 |
| `<BIG_ID>`, `<BIG_PATH>` (the 45 MB asset) | | 4.1 |
| `<LINK_ID>` (the link tagged to S4) | | 6.2 |
| `<GEN_ID>` (the untagged link) | | 6.3 |
| `<ORPHAN_1>`, `<ORPHAN_2>` (paths uploaded with no row) | | 9.1 |

### 0.5 SQL in the Supabase SQL Editor

Same rules as Slice 4b, section 0.5:

- Blocks marked **"as postgres"** run as the superuser (RLS ignored), for setup and checking.
- The editor shows only the **last** statement's result: run multi-query blocks one statement at a
  time where the expected column says so.
- `current transaction is aborted` → run `rollback;` on its own and carry on.
- **Never `delete from storage.objects` in SQL.** Recent Supabase projects refuse it ("use the
  Storage API"), and where it is allowed it leaves the file in the backing store. Remove objects with
  the app, the console helpers (0.8) or Dashboard → Storage.

### 0.6 The asset rows (as postgres), "ASSETS"

```sql
select a.id, a.title, a.kind, a.job_codes, a.url, a.storage_path,
       split_part(a.storage_path, '/', 1) = a.playbook_id::text as in_playbook_folder,
       split_part(a.storage_path, '/', 2) = a.id::text          as id_is_folder,
       a.added_by = '<C>'                                      as added_by_c,
       left(a.description, 60)                                  as description,
       a.created_at
from assets a
where a.playbook_id = '<LRL_ID>' and a.created_at >= '<T0>'
order by a.created_at desc;
```

(For a link, `in_playbook_folder` and `id_is_folder` are `null`.)

### 0.7 The stored objects (as postgres), "OBJ"

```sql
select o.name,
       (o.metadata->>'size')::bigint                            as bytes,
       o.metadata->>'mimetype'                                  as mimetype,
       o.created_at,
       exists (select 1 from assets a where a.storage_path = o.name) as has_row
from storage.objects o
where o.bucket_id = 'assets'
order by o.created_at desc
limit 15;
```

"No new object" below means: no row in OBJ with `created_at` after the step started.

### 0.7a Making an orphan old enough for the banner (as postgres), "BACKDATE"

The Assets screen offers to clean up only files with no row that are **older than 10 minutes** (so
an upload still saving its row is never touched). Either wait 10+ minutes, or backdate the object:

```sql
update storage.objects
set created_at = now() - interval '11 minutes'
where bucket_id = 'assets' and name in ('<path 1>', '<path 2>')
returning name, created_at;
```

(This changes only the timestamp, not the file. If your project refuses even this, wait 10 minutes
instead and record it.)

### 0.8 Console helpers (paste once per tab), "HELPERS"

The Slice 4b section 15.1 pattern: each user is signed in on a **separate, throw-away** client, so
your normal app session isn't touched. Use any `localhost:3000` tab, devtools (F12) > Console. Fill
in the URL and anon key from `.env.local`.

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
const newPath = (pb = LRL, name = 'QA-4c-console.txt') => `${pb}/${crypto.randomUUID()}/${name}`;
const up = (sb, path, text = 'QA-4c console file') =>
  sb.storage.from('assets').upload(path, new Blob([text], { type: 'text/plain' }));
const show = (label, r) => console.log(label, r.error ? [r.error.statusCode ?? r.error.status ?? r.error.code, r.error.message] : r.data);
```

| Expected | Pass/Fail |
|---|---|
| No error. A "Multiple GoTrueClient instances" warning is harmless. | |

### 0.9 Test files (terminal)

```bash
mkdir -p "<FILES>" && cd "<FILES>"
node -e "
const fs = require('fs');
for (const [n, mb] of [['QA-4c_45MB.bin', 45], ['QA-4c_60MB.bin', 60], ['QA-4c_90MB.bin', 90], ['QA-4c_101MB.bin', 101]]) {
  const fd = fs.openSync(n, 'w'); fs.ftruncateSync(fd, mb * 1024 * 1024); fs.closeSync(fd);
  console.log(n, fs.statSync(n).size);
}
fs.writeFileSync('Données – plan_v2 (final).txt', 'QA-4c unicode name\n');
fs.writeFileSync('QA-4c_a_very_long_file_name_without_any_spaces_to_check_wrapping_at_phone_width_0123456789.txt', 'QA-4c long name\n');
fs.writeFileSync('QA-4c page.html', '<!doctype html><h1>QA-4c html</h1><script>alert(document.domain)</script>\n');
fs.writeFileSync('QA-4c image.svg', '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"40\"><script>alert(1)</script><text y=\"20\">QA-4c svg</text></svg>\n');
console.log(fs.readdirSync('.'));
"
```

Also copy **any real PDF of about 2 MB** into `<FILES>` and rename it `QA-4c guide.pdf` (the plan's
"2 MB file"; a real PDF so it displays in the browser in section 12).

| Expected | Pass/Fail |
|---|---|
| `QA-4c_45MB.bin 47185920`, `QA-4c_60MB.bin 62914560`, `QA-4c_90MB.bin 94371840`, `QA-4c_101MB.bin 105906176`, then the folder listing with all eight names plus your PDF. | |

---

## 1. Pre-flight

### 1.1 Ids and memberships (as postgres)

```sql
select u.email, u.id as user_id,
       (select id from playbooks where slug = 'low-resource-language') as lrl_id,
       (select id from playbooks where slug = 'test-playbook')         as test_id,
       (select m.member_role || ' / ' || m.id from playbook_members m
          join playbooks p on p.id = m.playbook_id
          where m.user_id = u.id and p.slug = 'low-resource-language') as lrl_member,
       (select m.member_role from playbook_members m
          join playbooks p on p.id = m.playbook_id
          where m.user_id = u.id and p.slug = 'test-playbook')         as test_member
from auth.users u
where u.email in ('<B email>', '<C email>', '<D email>', '<P email>')
order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| C: `lrl_member contributor / …`. B: `lrl_member adopter / <id>` (**copy the id into `<B_MEMBER>`**). D: `test_member adopter`, `lrl_member` **null**. P: both null. **Copy `<LRL_ID>`, `<TEST_ID>`, `<B>`, `<C>`, `<D>`.** If C isn't `contributor`: as **A**, `/admin` > **Playbook contributors** > "Low-resource language AI adoption" > add C > **Add as contributor**, then re-run. **If D's `lrl_member` is not null** (an earlier slice opened the main playbook as D), D already belongs to it and will see its assets by design: record this, and in section 11 run the **P** rows instead of the D rows. | |

### 1.2 Bucket, policies and constraints (as postgres, one statement at a time)

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'assets';
```
```sql
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%asset%' order by cmd;
```
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'assets' order by cmd;
```
```sql
select conname from pg_constraint where conrelid = 'public.assets'::regclass order by conname;
```

| # | Expected | Pass/Fail |
|---|---|---|
| 1.2a | `assets | false | 104857600 | null` (private, 100 MB, any type). | |
| 1.2b | 4 rows: DELETE "Playbook contributors can delete asset files", INSERT "…can upload…", SELECT "Playbook members can read asset files", UPDATE "…can update…". | |
| 1.2c | 4 rows: DELETE, INSERT, SELECT ("Members can view assets of their playbooks"), UPDATE. | |
| 1.2d | Includes `assets_kind_check`, `assets_kind_target`, `assets_path_in_playbook`, `assets_title_check`, `assets_url_http`, `assets_storage_path_key`. **No `qa_block`.** | |

### 1.3 The project's global upload limit (Dashboard)

Supabase Dashboard > the test project > **Storage > Settings** ("Upload file size limit").

| Expected | Pass/Fail |
|---|---|
| A value **below 100 MB** (50 MB on Free), consistent with the automatic 55 MB refusal. **Copy it into `<GLOBAL_LIMIT>`.** If it is 60 MB or more, sections 4.2's expectations change (record, and pick a file above `<GLOBAL_LIMIT>` instead). | |

### 1.4 What's already there (as postgres)

```sql
select id, title, kind, job_codes, storage_path, url, created_at
from assets where playbook_id = '<LRL_ID>' order by created_at;
```

| Expected | Pass/Fail |
|---|---|
| Either no rows, or the Slice 3 rows ("QA data collection plan template" file, "QA AI4Bharat volume reference" link, "QA general reading list" link). Record which. They stay until section 19 (14.4 deletes one of them through the UI if present). **No other rows**; if there are real (non-QA) assets, record their titles so section 19 leaves them alone. | |

### 1.5 Start time and baseline (as postgres)

```sql
select now();
```

**Copy into `<T0>`.** Then run **OBJ** (0.7) and keep the result as the baseline.

| Expected | Pass/Fail |
|---|---|
| OBJ lists only the Slice 3 `…/qa-plan.pdf` (if it was kept) or nothing. Every row `has_row = true`. | |

---

## 2. Who can reach the Assets screen

### 2.1 C sees the Assets tab

Sign in as **C**. Go to `/companion/low-resource-language/assets`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 2.1a | Tabs | Home, Jobs, Playbook, Update with Cube, Source document, **Assets** (underlined, `aria-current="page"`), Conversations. | |
| 2.1b | Page | The line "Templates, sheets, guides and links for this playbook. Each one shows in the jobs it belongs to. Cube sees only its title, description and jobs, never the file itself." and a **+ Add an asset** button on the right. The Slice 3 rows (if any, 1.4) listed newest first, each with a **File**/**Link** pill, **Edit**, **Delete**, its description and "Jobs: Design the data collection plan" or "General resource (not tied to a job)". With no rows: "No assets yet." in a dashed box. **No** placeholder text ("Coming in a later build step"). | |
| 2.1c | Orphan banner | **Not shown** (no orphans yet). Network: one `GET …/rest/v1/asset_orphans?select=storage_path&playbook_id=eq.<LRL_ID>&created_at=lt.<10 minutes ago>` with 200 and `[]`. | |
| 2.1d | Dev-server log | No `[companion-v2]` line. | |

### 2.2 Adopter B gets a 404

In the other browser, sign in as **B**, go to `/companion/low-resource-language/jobs`.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 2.2a | Look at the tabs | **Home and Jobs only.** No Assets tab. | |
| 2.2b | Go to `/companion/low-resource-language/assets` | The app's **404** page. No asset list, no **+ Add an asset**. | |

(D's 404 is in 11.3, after D's console checks; see 0.3.)

### 2.3 Pending user (P)

Sign in as **P**, go to `/companion/low-resource-language/assets`.

| Expected | Pass/Fail |
|---|---|
| **Not** the Assets screen: "Your account is almost ready" (as in Slice 4a, 2.3) or a 404. Ctrl+U, search `Add an asset`: no match. | |

### 2.4 Signed out

Fresh private window, go to `/companion/low-resource-language/assets`.

| Expected | Pass/Fail |
|---|---|
| Redirected to `/login?next=%2Fcompanion%2Flow-resource-language%2Fassets` (by `proxy.ts`). No asset content. | |

### 2.5 Other playbook and no such playbook (C)

| # | As C, go to | Expected | Pass/Fail |
|---|---|---|---|
| 2.5a | `/companion/test-playbook/assets` | 404 (C isn't a contributor of `test-playbook`; contributor status is per playbook). | |
| 2.5b | `/companion/no-such-playbook/assets` | 404. | |

---

## 3. Add a file: the form, the upload, the row (C, the 2 MB PDF)

Plan acceptance: "a file … can be added, tagged to a job"; "The upload request goes to the Supabase
Storage host, not `/api/...`".

As C on the Assets screen, open devtools > **Network** (filter off, "Preserve log" on). Click
**+ Add an asset**.

### 3.1 The form

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 3.1a | Layout | A bordered box with a pill toggle **Upload a file** (selected, filled) / **Add a link**; "File (any type, up to 100 MB)" and a file picker; **Title**; **Description** with the hint "Cube sees only this description, never the file. Say what it is and when to use it."; "Jobs it belongs to" with its note ("It shows in each of these jobs, and Cube offers it when they come up. With no job, it is listed under General resources."), a **Find a job** box and a list of `+ <job name>` buttons in sequence order; **Upload and add** (faded) and **Cancel**. The **+ Add an asset** button has gone, and **focus is on "Upload a file"** (the selected kind; visible focus ring). | |
| 3.1b | No job codes | The job list shows names only ("+ Understand the language community and the access gap", …). No `P1`, `S4` etc. anywhere in the form. | |
| 3.1c | **Cancel** | The box closes, **+ Add an asset** is back, nothing saved. Open it again. | |

### 3.2 Title prefill and the required description

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 3.2a | Choose `QA-4c guide.pdf` | Under the picker: `QA-4c guide.pdf · 2.0 MB` (or your PDF's size) in grey. **Title** is filled with `QA 4c guide` (extension dropped, `-`/`_` turned into spaces). **Upload and add** still faded (no description). | |
| 3.2b | Type three spaces in Description | Still faded (whitespace doesn't count). | |
| 3.2c | Clear Title, type a description `QA-4c: a two-page test guide for the data collection plan.` | Still faded (no title). | |
| 3.2d | Type the title `QA-4c data collection guide` | **Upload and add** enabled. | |
| 3.2e | Choose the PDF again (or another file) | The title you typed is **kept** (prefill only fills an empty title). Re-choose `QA-4c guide.pdf` if you switched. | |

### 3.3 The job picker

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 3.3a | Type `data coll` in **Find a job** | The list narrows to jobs whose **name** contains it (case-insensitive), including "+ Design the data collection plan". | |
| 3.3b | Type `S4` | "No more jobs match." (search is by name, not code). | |
| 3.3c | Search `data coll` again, click **+ Design the data collection plan** | A chip "Design the data collection plan ×" appears above the box; the job disappears from the list; **focus moves to the "Find a job" box** (its text `data coll` is kept). | |
| 3.3d | Search `language community`, click **+ Understand the language community and the access gap** | A second chip. | |
| 3.3e | Click the **×** on the second chip (hover: `aria-label="Remove Understand the language community and the access gap"`) | The chip goes; the job is back in the list. One chip left: Design the data collection plan. | |

### 3.4 Upload

Click **Upload and add**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 3.4a | While uploading | A thin progress bar (devtools > Elements: `role="progressbar"`, `aria-label="Upload"`, `aria-valuenow` climbing 0→100) and "Uploading… N%" (may flash by for 2 MB); the kind toggle **and every field** (file, title, description, Find a job, the "+ job" buttons and chip ×) are disabled; **Cancel** has become **Cancel upload** (red). | |
| 3.4a2 | After the bytes are up | Briefly "Saving…" instead of the percentage, and **no** Cancel or Cancel upload button (the row is being saved; it can't be cancelled now). Use the 45 MB file in 4.1 if it's too quick to see here. | |
| 3.4b | When done | Toast "Asset added."; the box closes; "Updating…" briefly; the new asset at the **top**: "QA-4c data collection guide ↓", a **File** pill, the description, "Jobs: Design the data collection plan". | |
| 3.4c | Network: the upload | One `POST https://<ref>.supabase.co/storage/v1/object/assets/<LRL_ID>/<uuid>/QA-4c-guide.pdf`, status **200**, response `{"Key":"assets/<LRL_ID>/<uuid>/QA-4c-guide.pdf","Id":"…"}`. Request headers include `authorization: Bearer …`, `apikey`, `x-upsert: false`, `content-type: application/pdf`. **No request to `localhost:3000/api/…`** at any point during the upload. | |
| 3.4d | Network: the row | Then `POST https://<ref>.supabase.co/rest/v1/assets` → **201**. Then a `GET …/asset_orphans…` → `[]`. (A `localhost:3000/…?_rsc=` request is the page refresh, not an API route.) | |
| 3.4e | Dev-server log | No `[companion-v2]` line. | |

### 3.5 The row and the object (as postgres)

Run **ASSETS** (0.6) and **OBJ** (0.7).

| # | Expected | Pass/Fail |
|---|---|---|
| 3.5a | ASSETS: one row, `title QA-4c data collection guide`, `kind file`, `job_codes {S4}`, `url null`, `storage_path <LRL_ID>/<id>/QA-4c-guide.pdf`, `in_playbook_folder true`, `id_is_folder true` (the row's `id` **is** the second path segment), `added_by_c true`, description starts `QA-4c: a two-page…`. **Copy the id into `<PDF_ID>` and the path into `<PDF_PATH>`.** | |
| 3.5b | OBJ: the top row is `<PDF_PATH>`, `bytes` = the PDF's size, `mimetype application/pdf`, `has_row true`. | |

### 3.6 C opens it from the list

Click "QA-4c data collection guide ↓".

| Expected | Pass/Fail |
|---|---|
| A new tab with the PDF; its URL is `https://<ref>.supabase.co/storage/v1/object/sign/assets/<PDF_PATH>?token=…` (no `download` parameter). The Assets tab is unchanged. | |

### 3.7 HTML and SVG are stored as downloads, never rendered

Add two files, no job tag: `QA-4c page.html` (description `QA-4c: HTML must download.`) and
`QA-4c image.svg` (description `QA-4c: SVG must download.`).

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 3.7a | Network, each upload | Request `content-type: application/octet-stream` (not `text/html` / `image/svg+xml`). | |
| 3.7b | OBJ | `…/QA-4c-page.html` and `…/QA-4c-image.svg`, both `mimetype application/octet-stream`, `has_row true`. | |
| 3.7c | Click each title in the list | The new tab's URL ends in `…?token=…&download=` (or similar `download` parameter) and the browser **downloads** the file; **no** alert box, no page or picture rendered. | |

---

## 4. Large files

### 4.1 (a) ~45 MB succeeds

**+ Add an asset** > choose `QA-4c_45MB.bin`. Description `QA-4c: 45 MB zero-filled test file.`;
job **Design the data collection plan**. Network open. Click **Upload and add**, and while it is
uploading do 4.1c.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 4.1a | Before upload | `QA-4c_45MB.bin · 45.0 MB` in grey (not red). Title prefilled `QA 4c 45MB`. | |
| 4.1b | Progress | The bar fills steadily and the percentage climbs to 100 (throttle to "Fast 4G" in Network if it's too quick to see). | |
| 4.1c | **While it uploads**, try to change the Title, the Description, add or remove a job | Nothing can be changed: all fields, the job buttons and the chip × are disabled (greyed, not focusable). The kind toggle doesn't react to clicks or arrow keys. | |
| 4.1c2 | At 100% | "Saving…" replaces the percentage and the **Cancel upload** button disappears until the toast. | |
| 4.1d | When done | Toast "Asset added."; the asset at the top with a **File** pill. | |
| 4.1e | ASSETS / OBJ | A row `kind file`, `job_codes {S4}`, `storage_path <LRL_ID>/<id>/QA-4c_45MB.bin`, both folder checks `true`; OBJ has it with `bytes 47185920`, `mimetype application/octet-stream` (`.bin` isn't an inline type), `has_row true`. Title `QA 4c 45MB`. **Copy `<BIG_ID>`, `<BIG_PATH>`.** | |
| 4.1f | Network: how it uploaded | **One** `POST https://<ref>.supabase.co/storage/v1/object/assets/<LRL_ID>/<uuid>/QA-4c_45MB.bin` → 200, request `content-type: application/octet-stream`. No `…/upload/resumable` or `PATCH` requests (this build deliberately uses a single request, not TUS; the plan's TUS line is superseded). No `localhost:3000/api/…` request. | |

### 4.2 (b) ~60 MB: the friendly too-big message, no object, no row

**+ Add an asset** > choose `QA-4c_60MB.bin`. Description `QA-4c: 60 MB, should be refused by the
project limit.` Click **Upload and add**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 4.2a | Before upload | `QA-4c_60MB.bin · 60.0 MB` in **grey** (it is under the app's 100 MB check). Button enabled. | |
| 4.2b | After the upload attempt | A red box: "This file is bigger than the project allows. (The Supabase project’s upload limit may be lower than 100 MB.)". The form stays open with your values; **Upload and add** usable again; no toast. Record whether the bar reached 100% before the error (the server may read the whole body first). | |
| 4.2c | Network | The `POST …/storage/v1/object/assets/…/QA-4c_60MB.bin` ends in **413** (or a 400 whose body says "The object exceeded the maximum allowed size"). **No** `POST …/rest/v1/assets`. | |
| 4.2d | ASSETS / OBJ | **No** new row; **no** new object. | |
| 4.2e | Reload the Assets page | No orphan banner. Click **Cancel** on the form first if it is still open. | |

### 4.3 (c) Optional: 90 MB, only if you raise the project limit

Skip and record "not run" unless you want to test the plan's 90 MB case. To run it: Dashboard >
Storage > Settings > set the upload limit to **100 MB or more** (needs a paid plan if the field won't
accept it; the bucket's own limit stays at 100 MB). Then **+ Add an asset** > `QA-4c_90MB.bin`,
description `QA-4c: 90 MB test file.`, job **Design the data collection plan** > **Upload and add**.

| Expected | Pass/Fail |
|---|---|
| `90.0 MB` grey; the bar fills; "Asset added."; ASSETS has the row; OBJ has it with `bytes 94371840`, `has_row true`. **Afterwards set the global limit back to `<GLOBAL_LIMIT>`** (19.2 double-checks). | |

### 4.4 (d) Over 100 MB: refused in the browser

**+ Add an asset** > choose `QA-4c_101MB.bin`. Fill title and description `QA-4c: 101 MB.`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 4.4a | The size line | `QA-4c_101MB.bin · 101.0 MB · too big: files can be up to 100 MB` in **red**. | |
| 4.4b | The button | **Upload and add** stays faded with title and description filled. | |
| 4.4c | Network | **No** request at all to `…/storage/v1/object/…` after choosing the file. | |
| 4.4d | Choose `QA-4c guide.pdf` instead, then Cancel | The red line goes and the button enables (then Cancel). Nothing saved. | |

---

## 5. Cancel an upload mid-way (C)

**+ Add an asset** > `QA-4c_45MB.bin`, description `QA-4c: cancelled upload.` In Network, set
throttling to **Slow 4G** (or a custom ~1 Mbit/s upload) so it takes long enough. Click **Upload and
add**, and at about 20–50% click **Cancel upload**. Set throttling back to **No throttling**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.1 | The form | The bar goes; a red box "Upload cancelled."; the form stays open with your values; **Cancel** is back (not "Cancel upload"); no toast. | |
| 5.2 | Network | The storage `POST` shows as **(canceled)** / no status. **No** `POST …/rest/v1/assets`. | |
| 5.3 | ASSETS | No new row. | |
| 5.4 | OBJ | **No** new object (a cancelled standard upload stores nothing). If one **is** there, `has_row false`: record it, then go to 5.5. | |
| 5.5 | Reload the Assets page | **No** orphan banner. (If 5.4 found an object, it still won't show yet: the banner only lists files older than 10 minutes. BACKDATE it (0.7a), reload: "1 uploaded file has no asset (an upload that didn’t finish saving)." with **Remove it**. Click it: toast "Removed 1 file.", banner gone, OBJ no longer lists it. Record this as an observation, not a failure.) | |
| 5.6 | Start the upload again and let it reach **Saving…** | No Cancel upload button is offered during Saving…; the asset is added normally ("Asset added."). Then **Delete** it (confirm) so it doesn't count in later steps. | |

---

## 6. Add a link (C)

### 6.1 The form refuses bad links

**+ Add an asset** > **Add a link**. The file picker is replaced by a **Link** box (`https://…`).
Title `QA-4c bad link`, description `QA-4c: should not save.`

| # | Type in Link | Expected | Pass/Fail |
|---|---|---|---|
| 6.1a | `javascript:alert(document.cookie)` | Red line "Enter a full link that starts with http:// or https://."; **Add link** faded. | |
| 6.1b | `JavaScript:alert(1)` | Same. | |
| 6.1c | `data:text/html,<b>x</b>` | Same. | |
| 6.1d | `example.com/guide` (plain text, no scheme) | Same. | |
| 6.1e | `ftp://example.com/x` | Same. | |
| 6.1f | `https://` (scheme only), then `https:///path`, then `https:// example.com` | Same red line each time (a link needs a host); **Add link** faded. | |
| 6.1f2 | `https://example.com` | The red line goes; **Add link** enabled. | |
| 6.1g | Network throughout 6.1a–6.1e | No request. Click **Cancel**. | |

(The database refusing the same values when the form is bypassed is in 10.1.)

### 6.2 A link tagged to a job

**+ Add an asset** > **Add a link**. Link `https://example.com/?qa=4c-s4`, title
`QA-4c volume reference`, description `QA-4c: a link tagged to the data collection plan.`, job
**Design the data collection plan**. **Add link**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 6.2a | Screen | Toast "Asset added."; at the top "QA-4c volume reference ↗" with a **Link** pill, the description and "Jobs: Design the data collection plan". No progress bar was shown. | |
| 6.2b | Network | Only `POST …/rest/v1/assets` → 201 (no Storage request). | |
| 6.2c | ASSETS | `kind link`, `url https://example.com/?qa=4c-s4`, `storage_path null`, `job_codes {S4}`, `added_by_c true`. **Copy `<LINK_ID>`.** | |

### 6.3 An untagged `http://` link (General resources)

**+ Add an asset** > **Add a link**. Link `  HTTP://example.org/?qa=4c-general  ` (with spaces before
and after, upper-case scheme), title `QA-4c general reading`, description `QA-4c: an untagged link.`,
no job. **Add link**.

| Expected | Pass/Fail |
|---|---|
| Accepted (the scheme check is case-insensitive). The list shows "General resource (not tied to a job)". ASSETS: `url HTTP://example.org/?qa=4c-general` (trimmed, no spaces), `job_codes {}`. **Copy `<GEN_ID>`.** | |

---

## 7. Edit (C)

### 7.1 Edit a file asset's title, description and jobs

On "QA-4c data collection guide" click **Edit** (it turns into **Close**).

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 7.1a | Look | Title, Description and the job picker, filled in (chip "Design the data collection plan"). **No** Link field and no way to replace the file (record in 18). **Save** faded. | |
| 7.1b | Add a trailing space to Title | Save still faded (values are trimmed before comparing). | |
| 7.1c | Clear Description | Save faded (description required). Put it back. | |
| 7.1d | Title → `QA-4c data collection guide (v2)`; Description → append ` Edited.`; add job **Understand the language community and the access gap**. **Save** | "Saving…", then toast "Asset saved."; the editor closes; the item shows the new title, the new description and "Jobs: Design the data collection plan, Understand the language community and the access gap". | |
| 7.1e | ASSETS | `<PDF_ID>`: new title, `job_codes {S4,P1}`; **`storage_path` unchanged** (`<PDF_PATH>`). OBJ unchanged. | |
| 7.1f | **Edit** then **Close** without changes; **Edit**, change something, **Cancel** | Both close the editor; nothing saved (no toast, ASSETS unchanged). | |

### 7.2 Edit a link's URL, including a bad one

On "QA-4c volume reference" click **Edit**.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 7.2a | Look | A **Link** field with `https://example.com/?qa=4c-s4`. | |
| 7.2b | Link → `javascript:alert(1)`, then `https://` | Each time: red line "Enter a full link that starts with http:// or https://." under the Link field, and **Save** faded. ASSETS: `url` unchanged. (The database refusing it when the form is bypassed is 10.1.) | |
| 7.2c | Clear the Link | Save faded. | |
| 7.2d | Link → `https://example.com/?qa=4c-s4-edited`, **Save** | "Asset saved."; ASSETS has the new url; clicking the title opens the new URL in a new tab. | |

### 7.3 Saving or deleting a row that's no longer there (two tabs)

**+ Add an asset** > **Add a link** `https://example.com/?qa=4c-gone`, title `QA-4c gone`,
description `QA-4c: two-tab test.` Open the Assets screen in a **second tab** (T2). In T1 click
**Edit** on "QA-4c gone". In T2 **Delete** it (confirm).

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 7.3a | T1: change the description, **Save** | Red box "This asset couldn’t be changed. You may no longer be a contributor; reload the page." No "Asset saved." toast. (Before this fix it reported success with nothing saved.) | |
| 7.3b | T1: **Cancel**, then **Delete** on "QA-4c gone" (still listed in T1), confirm | Error toast "Couldn’t delete: This asset couldn’t be deleted. You may no longer be a contributor; reload the page." No "Asset deleted." toast. | |
| 7.3c | Reload T1 | "QA-4c gone" is not listed. ASSETS: no such row. Close T2. | |

---

## 8. A failed row insert leaves no object (plan test 3)

Plan acceptance: "If the row insert fails, the uploaded object is removed and no orphan is listed."

### 8.1 Block every insert (as postgres)

```sql
alter table assets add constraint qa_block check (false) not valid;
```

(`not valid` skips the existing rows, but every new or updated row must still pass it, so every
insert fails.)

### 8.2 Upload a file (C)

**+ Add an asset** > choose `Données – plan_v2 (final).txt`. Description
`QA-4c: unicode file name test.` Network open. **Upload and add**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 8.2a | Prefill | Title `Données – plan v2 (final)` (accent and en dash kept; `_` → space). | |
| 8.2b | Result | The bar reaches 100%, then a red box: "The file was uploaded but couldn’t be saved, so it was removed again: new row for relation "assets" violates check constraint "qa_block"". Form still open, no toast. | |
| 8.2c | Network, in order | `POST …/storage/v1/object/assets/<LRL_ID>/<uuid>/Donnees-plan_v2-final.txt` → 200 (note the safe name: accent stripped, spaces/dash/brackets → `-`); `POST …/rest/v1/assets` → 400; then a `DELETE …/storage/v1/object/assets` → 200 (the clean-up). | |
| 8.2d | OBJ | **No** object named `…/Donnees-plan_v2-final.txt`. | |
| 8.2e | ASSETS | No new row. | |
| 8.2f | Reload Assets (the form closes) | **No** orphan banner. | |

### 8.3 Links and edits fail cleanly too (C)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 8.3a | **Add a link** `https://example.com/?qa=4c-blocked`, title `QA-4c blocked`, description `QA-4c: blocked.` | Red box with `…violates check constraint "qa_block"`; no row. **Cancel.** | |
| 8.3b | Edit "QA-4c general reading": change the description, **Save** | Red box with the same `qa_block` message (updated rows are checked too); ASSETS unchanged. **Cancel.** | |

### 8.4 Drop the block (as postgres): mandatory

```sql
alter table assets drop constraint qa_block;
select count(*) from pg_constraint where conname = 'qa_block';
```

| Expected | Pass/Fail |
|---|---|
| `0`. | |

### 8.5 Retry the same file (C)

**+ Add an asset** > `Données – plan_v2 (final).txt`, description `QA-4c: unicode file name test.`
> **Upload and add**.

| Expected | Pass/Fail |
|---|---|
| "Asset added."; title "Données – plan v2 (final)" in the list. ASSETS: `storage_path <LRL_ID>/<new id>/Donnees-plan_v2-final.txt` with a **different** id from the one in 8.2c (a fresh `asset_id` per attempt); OBJ has it with `mimetype text/plain`, `has_row true`. | |

### 8.6 Optional: the message when the clean-up itself fails

This checks the second, truthful message. It **temporarily removes the contributor's Storage delete
policy** in the test project; the restore below is mandatory.

As postgres:

```sql
alter table assets add constraint qa_block check (false) not valid;
drop policy "Playbook contributors can delete asset files" on storage.objects;
```

As C: **+ Add an asset** > `QA-4c page.html`, description `QA-4c: clean-up fails.` > **Upload and
add**.

| # | Expected | Pass/Fail |
|---|---|---|
| 8.6a | Red box: "The file was uploaded but couldn’t be saved, and it couldn’t be removed either (new row for relation "assets" violates check constraint "qa_block"). It will show under clean-up." (Storage refuses the removal silently under RLS; the code checks that nothing was removed.) | |
| 8.6b | OBJ: `…/QA-4c-page.html`, `mimetype application/octet-stream`, `has_row false`. No banner yet (too new; section 9 covers the age rule). | |

Restore, as postgres (**mandatory**, run all three):

```sql
alter table assets drop constraint qa_block;
create policy "Playbook contributors can delete asset files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'assets' and public.is_playbook_contributor(public.asset_playbook_id(name)));
select (select count(*) from pg_constraint where conname = 'qa_block') as qa_block,
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname ilike '%asset%') as asset_policies;
```

| Expected | Pass/Fail |
|---|---|
| `qa_block 0`, `asset_policies 4`. The leftover `QA-4c-page.html` object is removed through the banner in 9.5. | |

---

## 9. Orphans: the clean-up banner (C)

The banner lists only files with no row that are **older than 10 minutes**, and **Remove** fetches
that list again just before removing, so a file that got its row in the meantime is never deleted.

### 9.1 Make two orphans on purpose (console as C)

Any `localhost:3000` tab, paste **HELPERS** (0.8), then:

```js
const c = await as('<C email>', '<C password>');
const o1 = newPath(LRL, 'QA-4c-orphan-1.txt'), o2 = newPath(LRL, 'QA-4c-orphan-2.txt');
show('o1', await up(c, o1)); show('o2', await up(c, o2));
console.log(o1, o2);
```

| Expected | Pass/Fail |
|---|---|
| Two `{path: …, id: …, fullPath: 'assets/…'}` results (C may upload under the main playbook's folder). **Copy the two paths into `<ORPHAN_1>`, `<ORPHAN_2>`.** OBJ: both, `has_row false`. | |

### 9.2 Too new for the banner, then old enough

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 9.2a | Reload the Assets screen straight away | **No** banner (both orphans are under 10 minutes old). | |
| 9.2b | As postgres, impersonating C: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true); select storage_path from asset_orphans; rollback;` | Exactly `<ORPHAN_1>` and `<ORPHAN_2>` (plus `…/QA-4c-page.html` if you ran 8.6): the view has no age rule; the app applies it. (As plain postgres the view returns nothing, because `auth.uid()` is null.) | |
| 9.2c | BACKDATE (0.7a) `<ORPHAN_1>` and `<ORPHAN_2>`, reload Assets | Banner: "2 uploaded files have no asset (an upload that didn’t finish saving)." and **Remove them**. Neither appears as an asset in the list. | |

### 9.3 Remove one by hand, then the banner's singular

In the console: `show('rm1', await c.storage.from('assets').remove([o1]));` then reload Assets.

| Expected | Pass/Fail |
|---|---|
| `rm1` lists the removed object. Banner: "1 uploaded file has no asset (an upload that didn’t finish saving)." and **Remove it**. | |

### 9.4 The list is fetched again before removing

With the banner still showing (**don't reload**), give `<ORPHAN_2>` a row from the console:

```js
show('adopt', await c.from('assets').insert({ playbook_id: LRL, kind: 'file', storage_path: o2,
  title: 'QA-4c adopted orphan', description: 'QA-4c: row added after the banner showed' }).select('id'));
```

Then click **Remove it**.

| Expected | Pass/Fail |
|---|---|
| Toast "Nothing to remove any more."; the banner disappears. OBJ: `<ORPHAN_2>` is **still there**, `has_row true` (the file that got its row was not deleted). | |

### 9.5 Clean up through the app

As postgres: `delete from assets where storage_path = '<ORPHAN_2>' returning id;` (it is an orphan
again, already backdated). If you ran 8.6, BACKDATE its `…/QA-4c-page.html` too. Reload Assets.

| Expected | Pass/Fail |
|---|---|
| Banner with 1 (or 2, with 8.6) file(s). Click **Remove it** / **Remove them**: toast "Removed 1 file." (or "Removed 2 files."); the banner disappears without a reload. OBJ: no orphan left, nothing with `has_row false`. Reload: still no banner. The real assets are untouched. | |

---

## 10. The database and Storage refuse what the form would (console)

### 10.1 As C: constraints when the form is bypassed

Same console (C signed in as `c`):

```js
const base = { playbook_id: LRL, description: 'QA-4c: forced from the console' };
show('js link',   await c.from('assets').insert({ ...base, title: 'QA-4c f1', kind: 'link', url: 'javascript:alert(1)' }));
show('text link', await c.from('assets').insert({ ...base, title: 'QA-4c f2', kind: 'link', url: 'example.com' }));
show('no title',  await c.from('assets').insert({ ...base, title: '', kind: 'link', url: 'https://example.com' }));
show('mixed',     await c.from('assets').insert({ ...base, title: 'QA-4c f3', kind: 'link', url: 'https://example.com', storage_path: `${LRL}/x/y.txt` }));
show('file, other playbook path', await c.from('assets').insert({ ...base, title: 'QA-4c f4', kind: 'file', storage_path: `${TEST}/${crypto.randomUUID()}/x.pdf` }));
show('other playbook row', await c.from('assets').insert({ ...base, playbook_id: TEST, title: 'QA-4c f5', kind: 'link', url: 'https://example.com' }));
show('update to js', await c.from('assets').update({ url: 'javascript:alert(1)' }).eq('id', '<GEN_ID>').select());
```

| Line | Expected | Pass/Fail |
|---|---|---|
| js link | `23514` … `violates check constraint "assets_url_http"`. | |
| text link | `23514` … `"assets_url_http"`. | |
| no title | `23514` … `"assets_title_check"`. | |
| mixed | `23514` … `"assets_kind_target"`. | |
| file, other playbook path | `23514` … `"assets_path_in_playbook"`. | |
| other playbook row | `42501` … `new row violates row-level security policy for table "assets"`. | |
| update to js | `23514` … `"assets_url_http"`. | |
| After all (as postgres) | `select count(*) from assets where title like 'QA-4c f%';` → `0`; `<GEN_ID>`'s url unchanged. | |

### 10.2 As C: Storage refuses paths outside the playbook

```js
show('test folder', await up(c, newPath(TEST, 'QA-4c-should-fail.txt')));
show('not a uuid',  await up(c, 'not-a-playbook/QA-4c-should-fail.txt'));
show('top level',   await up(c, 'QA-4c-should-fail.txt'));
show('same path twice', await up(c, '<PDF_PATH>'));
```

| Line | Expected | Pass/Fail |
|---|---|---|
| test folder | `403` (or `400`) `new row violates row-level security policy`. | |
| not a uuid | Same (the first segment isn't a playbook id, so `asset_playbook_id` is null and the policy fails; no SQL error). | |
| top level | Same. | |
| same path twice | `409` (or `400`) "The resource already exists" (`x-upsert` is off; the existing PDF is not overwritten). | |
| OBJ | No `QA-4c-should-fail.txt` anywhere; `<PDF_PATH>` `bytes` unchanged. | |

### 10.3 Observe: `added_by` is not checked

```js
show('spoof', await c.from('assets').insert({ ...base, title: 'QA-4c spoofed added_by', kind: 'link', url: 'https://example.com/?qa=spoof', added_by: '<B>' }).select('id, added_by'));
```

| Expected | Pass/Fail |
|---|---|
| **Observe and record (section 18), not pass/fail:** the insert probably succeeds with `added_by = <B>` (no policy pins it to `auth.uid()`). Nothing in the UI shows `added_by` today, so the impact is low. Section 19 deletes this row. | |

### 10.4 Adopter B can't upload, insert, change or delete (plan test 4)

In **B's** browser, a `localhost:3000` tab, paste **HELPERS**, then:

```js
const b = await as('<B email>', '<B password>');
show('B upload',  await up(b, newPath(LRL, 'QA-4c-b-should-fail.txt')));
show('B insert',  await b.from('assets').insert({ playbook_id: LRL, title: 'QA-4c by B', kind: 'link', url: 'https://example.com', description: 'QA-4c' }));
show('B update',  await b.from('assets').update({ title: 'QA-4c changed by B' }).eq('id', '<LINK_ID>').select());
show('B delete',  await b.from('assets').delete().eq('id', '<LINK_ID>').select());
show('B remove object', await b.storage.from('assets').remove(['<PDF_PATH>']));
show('B orphans', await b.from('asset_orphans').select('storage_path'));
show('B reads',   await b.from('assets').select('id, title').eq('playbook_id', LRL));
show('B signs',   await b.storage.from('assets').createSignedUrl('<PDF_PATH>', 60));
```

| Line | Expected | Pass/Fail |
|---|---|---|
| B upload | `403` (or `400`) `new row violates row-level security policy`. **Storage refuses.** | |
| B insert | `42501` `new row violates row-level security policy for table "assets"`. | |
| B update | `[]` (no error; RLS hides the row from updates). | |
| B delete | `[]`. | |
| B remove object | `[]` (nothing removed). | |
| B orphans | `[]`. | |
| B reads | The QA assets (B is a member, so B **may** read them). | |
| B signs | `{signedUrl: 'https://<ref>.supabase.co/storage/v1/object/sign/assets/…?token=…'}` (members may download). | |
| As postgres | ASSETS: `<LINK_ID>` title unchanged and present; OBJ: `<PDF_PATH>` present; no `QA-4c-b-should-fail.txt`; no `QA-4c by B`. | |

### 10.5 Signed out (anon)

```js
const anon = await as();
show('anon upload', await up(anon, newPath(LRL, 'QA-4c-anon.txt')));
show('anon reads',  await anon.from('assets').select('id').eq('playbook_id', LRL));
show('anon orphans', await anon.from('asset_orphans').select('storage_path'));
show('anon signs',  await anon.storage.from('assets').createSignedUrl('<PDF_PATH>', 60));
```

| Line | Expected | Pass/Fail |
|---|---|---|
| anon upload | 4xx, row-level security. | |
| anon reads | `[]` or a `42501` permission error. **Never rows.** | |
| anon orphans | `42501` `permission denied for view asset_orphans` (revoked from anon). | |
| anon signs | An error ("Object not found" or similar). No `signedUrl`. | |

---

## 11. Another playbook's member (D) and a pending user (P)

### 11.1 D sees nothing of the main playbook (console)

**Only if 1.1 showed D's `lrl_member` as null.** Otherwise run 11.2 with P and record "D already a
member" here.

In D's browser, a `localhost:3000/companion` tab (the playbook list; **not** the main playbook),
paste **HELPERS**, then:

```js
const d = await as('<D email>', '<D password>');
show('D reads',  await d.from('assets').select('id, title').eq('playbook_id', LRL));
show('D lists',  await d.storage.from('assets').list(LRL));
show('D signs',  await d.storage.from('assets').createSignedUrl('<PDF_PATH>', 60));
show('D download', await d.storage.from('assets').download('<PDF_PATH>'));
show('D upload', await up(d, newPath(LRL, 'QA-4c-d-should-fail.txt')));
show('D orphans', await d.from('asset_orphans').select('storage_path'));
```

| Line | Expected | Pass/Fail |
|---|---|---|
| D reads | `[]`. | |
| D lists | `[]`. | |
| D signs | Error "Object not found" (or similar 4xx). | |
| D download | Error. | |
| D upload | 4xx, row-level security. | |
| D orphans | `[]`. | |
| As postgres, 1.1 query | D's `lrl_member` **still null** (the console never joins). | |

### 11.2 P (pending): same reads (optional, or instead of 11.1)

As **P**, paste HELPERS and run the 11.1 block with `const d = await as('<P email>', '<P password>');`.

| Expected | Pass/Fail |
|---|---|
| Same as 11.1. | |

### 11.3 D's and P's browser 404

Now (and only now) as **D**, go to `/companion/low-resource-language/assets`.

| Expected | Pass/Fail |
|---|---|
| **404.** (This opens the main playbook's layout, so D now joins it as an adopter: from here on D is like B. That is by design.) Tabs, if a page shows at all: Home and Jobs only. | |

---

## 12. Adopter B sees and opens the assets (plan test 2)

Plan acceptance: "seen by an adopter in that job, and downloaded through a signed URL".

As **B**, reload `/companion/low-resource-language/jobs`. Network open.

### 12.1 Where they appear

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 12.1a | Bottom of the list | **General resources** listing every untagged asset with its description: "QA-4c general reading ↗" ("QA-4c: an untagged link.") and "Données – plan v2 (final) ↓", "QA 4c image ↓", "QA 4c page ↓" (plus Slice 3's "QA general reading list" if kept). No S4-tagged asset here. | |
| 12.1b | **Only mine** | General resources still shows the same items. | |
| 12.1c | Open **Design the data collection plan** (`?open=S4`) | A **Resources** section (above "Where you are with this"), alphabetical by title, each with its description: "QA 4c 45MB ↓" (or the title stored in 4.1e), "QA-4c data collection guide (v2) ↓", "QA-4c volume reference ↗" (plus Slice 3's two S4 rows if kept). Not the untagged links, not "Données – plan v2 (final)" (untagged: it is under General resources). | |
| 12.1d | Open **Understand the language community and the access gap** (`?open=P1`) | Resources: **only** "QA-4c data collection guide (v2) ↓" (tagged in 7.1d). | |
| 12.1e | Open any other job, e.g. **Secure funding** (`?open=E3`) | **No** Resources section. | |
| 12.1f | No editing | No Edit, Delete or "+ Add an asset" anywhere on B's screens. | |

### 12.2 Opening them

In the S4 sheet:

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.2a | Click "QA-4c volume reference" | `https://example.com/?qa=4c-s4-edited` opens in a **new tab**; the Jobs tab stays with the sheet open. | |
| 12.2b | Click "QA-4c data collection guide (v2)" | A new tab opens and shows the PDF. Its URL is `https://<ref>.supabase.co/storage/v1/object/sign/assets/<PDF_PATH>?token=…`. In the first tab, Network shows `POST …/storage/v1/object/sign/assets/<PDF_PATH>` → **200** with `{"signedURL": …}`. The bucket is private: the URL carries a token. | |
| 12.2c | In the PDF tab: devtools > Console, `window.opener` | `null` (no link back to the app). | |
| 12.2d | Copy the PDF tab's URL. Wait **more than 60 seconds**. Paste it into a new tab | An error (e.g. `{"statusCode":"400","error":"InvalidJWT","message":"\"exp\" claim timestamp check failed"}`), not the PDF. The link expires after ~60 s. | |
| 12.2e | Click the file again | A fresh tab opens the PDF again (a new signed URL each click). | |
| 12.2f | Click "QA 4c 45MB" | A new tab opens and the browser **downloads** it (45.0 MB): `.bin` isn't an inline type, so the signed URL carries a `download` parameter. The Jobs tab is unchanged. | |
| 12.2g | General resources > "Données – plan v2 (final)" | A new tab shows the text `QA-4c unicode name`. | |
| 12.2h | General resources > "QA-4c general reading" | `HTTP://example.org/?qa=4c-general` (browser shows it lower-cased) in a new tab. | |
| 12.2i | General resources > "QA 4c page" and "QA 4c image" | Each **downloads**; no alert box, nothing rendered on the storage domain (as 3.7c). | |

### 12.3 An asset tagged only to a job that no longer exists

As postgres:

```sql
update assets set job_codes = '{ZZ9}' where id = '<GEN_ID>' returning id, job_codes;
update assets set job_codes = '{S4,ZZ9}' where id = '<LINK_ID>' returning id, job_codes;
```

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 12.3a | B: reload Jobs | "QA-4c general reading" is still listed under **General resources** (its only job is gone, so it doesn't disappear). "QA-4c volume reference" is **not** there. | |
| 12.3b | B: open S4 | "QA-4c volume reference" still under Resources (its unknown tag is ignored). | |
| 12.3c | C: Assets list | "QA-4c general reading": "Jobs: ZZ9 (no longer in the playbook)"; "QA-4c volume reference": "Jobs: Design the data collection plan, ZZ9 (no longer in the playbook)". | |
| 12.3d | Put them back (as postgres) | `update assets set job_codes = '{}' where id = '<GEN_ID>';` and `update assets set job_codes = '{S4}' where id = '<LINK_ID>';` | |

(The pop-up-blocked and missing-file cases were covered in Slice 3, 5.6g and 5.8, on the same
`AssetLink` component; this slice changed only how the URL is signed, not that handling.)

---

## 13. Cube offers an asset in chat (B)

### 13.1 From "Ask Cube about this job" (1 model call)

As **B**, Jobs > open **Design the data collection plan** > **Ask Cube about this job**.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 13.1a | Sent | `Tell me about "Design the data collection plan".` appears as B's message. | |
| 13.1b | Reply | About the job. **Expected:** Cube offers **one** fitting resource in one short line (e.g. the guide or the volume reference) by its title, says nothing about the file's contents beyond its description, and shows no asset id or job code in the text. | |
| 13.1c | Chips | Under the reply, a chip per offered resource: a **file** chip reads "<title> ↓" and is a **button** (new in this slice; before, file chips were greyed-out labels); a link chip "<title> ↗". | |
| 13.1d | Click the file chip (if offered) | A new tab with the file via a signed URL (`…/object/sign/assets/…?token=…`), as in 12.2b. Click the link chip: the URL in a new tab. | |
| 13.1e | Dev-server log | Exactly **one** new `[companion-v2]` line. Record `cache_read` (the asset list sits outside the cached prefix, so it should be > 0 if the prefix was cached recently). | |
| 13.1f | As postgres | `select ui->'showAssets' from companion_messages m join companion_conversations c on c.id = m.conversation_id join playbook_members pm on pm.id = c.member_id where pm.user_id = '<B>' and m.role = 'assistant' order by m.created_at desc limit 1;` → the offered id(s), all among the QA asset ids. | |

If Cube offers **no** resource, record it (the model decides; this is not a code failure by itself)
and **don't retry** (cost). Use 13.2 to check the chips instead.

### 13.2 Chips without a model call (always run)

Impersonating **B**, **commit** (the Slice 3, 6.1 pattern):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id)
values ('<B_MEMBER>', '<LRL_ID>') returning id;
commit;
```

Copy the id into `<QA_CONV>`. Then impersonating B, **commit**:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select public.record_companion_turn(
  '<QA_CONV>',
  'QA-4c: show me the resources',
  'QA-4c: injected reply. Three resource chips should show below.',
  jsonb_build_object(
    'focusJobs',  '[]'::jsonb,
    'openJob',    null,
    'showAssets', jsonb_build_array('<PDF_ID>', '<LINK_ID>', '<GEN_ID>', '11111111-2222-4333-8444-555555555555'),
    'context',    '{}'::jsonb,
    'jobUpdates', '[]'::jsonb),
  '{}'::jsonb, '[]'::jsonb);
commit;
```

As B, go to `/companion/low-resource-language?c=<QA_CONV>`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 13.2a | Chips | **Exactly three**: "QA-4c data collection guide (v2) ↓" (a button), "QA-4c volume reference ↗", "QA-4c general reading ↗". Nothing for the unknown id. No greeting, no log line. | |
| 13.2b | Click the file chip | The PDF in a new tab via a signed URL; `window.opener` there is `null`. | |
| 13.2c | Keyboard: Tab to the file chip, Enter | Same as 13.2b (it is a real button). | |

---

## 14. Delete (C)

Plan acceptance: "Delete removes both the row and the object."

### 14.1 The confirm, and cancelling it

As C on Assets, click **Delete** on "QA 4c 45MB" (the 45 MB file).

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 14.1a | Dialog | Title "Delete this asset?", message "“QA 4c 45MB” will be removed from every job, and the file deleted. This can't be undone.", a red **Delete** and **Cancel**. | |
| 14.1b | **Cancel** (then repeat with **Esc**) | The dialog closes; nothing deleted (ASSETS and OBJ unchanged). | |

### 14.2 Delete a file

**Delete** > **Delete**. Network open.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 14.2a | Screen | Toast "Asset deleted."; the item disappears; no orphan banner. | |
| 14.2b | Network, in order | `DELETE …/rest/v1/assets?id=eq.<BIG_ID>` → 204/200, **then** `DELETE …/storage/v1/object/assets` → 200 (row first, then object). | |
| 14.2c | ASSETS | No `<BIG_ID>`. | |
| 14.2d | OBJ (and `select count(*) from storage.objects where bucket_id = 'assets' and name = '<BIG_PATH>';`) | `<BIG_PATH>` gone; count `0`. | |
| 14.2e | B: reload Jobs, open S4 | "QA 4c 45MB" no longer under Resources. | |

### 14.3 Delete a link

**Delete** on "QA-4c spoofed added_by" (from 10.3). If that insert failed, skip 14.3 here and check the
same expectations when 15.7 deletes the "QA-4c keyboard" link.

| Expected | Pass/Fail |
|---|---|
| The message has **no** ", and the file deleted". Toast "Asset deleted."; ASSETS no longer has it; Network: only the `rest/v1/assets` DELETE (no Storage call). | |

### 14.4 Delete a Slice 3 row (if kept, 1.4)

Delete "QA data collection plan template" (Slice 3's SQL-inserted file).

| Expected | Pass/Fail |
|---|---|
| "Asset deleted."; the row and `…/qa-plan.pdf` are gone from ASSETS (drop the `<T0>` filter) and OBJ. If its object had already been removed in Slice 3 (5.8), the row still deletes without an error (the object removal just finds nothing). | |

---

## 15. Keyboard only (desktop width, C then B)

Put the mouse aside. Start on C's Assets screen with focus on the address bar, then Tab.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 15.1 | Tab to **+ Add an asset**, Enter | The form opens and focus is on **Upload a file** (the selected kind), with a visible focus ring. |  |
| 15.2 | Arrow keys, then Tab through the form | **Right/Down** (or Left/Up) switches to **Add a link** and moves focus to it (the Link field replaces the file picker); another arrow switches back. Only the selected kind is a Tab stop (roving tabIndex). Then Tab: file picker (Space/Enter opens the file dialog) → Title → Description → Find a job → each "+ job" button → Upload and add (skipped while faded) → Cancel. Record any stop without a visible focus indicator (the inputs only change their border colour). | |
| 15.3 | In **Find a job** type `data coll`, Tab to "+ Design the data collection plan", Enter | The chip appears and focus is back in **Find a job** (typing continues the search). | |
| 15.4 | Shift+Tab to the chip's **×**, Enter | The chip is removed; screen reader name "Remove Design the data collection plan" (devtools > Accessibility). | |
| 15.5 | Add a link entirely by keyboard (`https://example.com/?qa=4c-kbd`, title `QA-4c keyboard`, description `QA-4c: keyboard test.`), Tab to **Add link**, Enter | "Asset added." | |
| 15.6 | Tab to that asset's **Edit**, Enter | The editor opens below it; the button now reads **Close**. Tab reaches Title, Link, Description, the picker, Save, Cancel. Esc does nothing here (record; Cancel closes it). | |
| 15.7 | Tab to its **Delete**, Enter | The confirm dialog; focus inside it. **Esc** cancels; Enter on **Delete** deletes ("Asset deleted."). | |
| 15.8 | Upload a small file by keyboard, and during an upload (use the 45 MB file with throttling) Tab to **Cancel upload**, Enter | "Upload cancelled.", as in section 5. Then remove any leftover via the banner (as 5.5). | |
| 15.9 | B: Jobs > open S4 with Enter, Tab to "QA-4c data collection guide (v2)", Enter | The PDF opens in a new tab (keyboard-activated `window.open` is not blocked). | |

---

## 16. Phone width (375 px, C and B)

Devtools > device toolbar > a 375 px wide phone, touch emulation on.

| # | Screen | Expected | Pass/Fail |
|---|---|---|---|
| 16.1 | C: Assets list | The intro line and **+ Add an asset** stack; each item's title/pill and Edit/Delete wrap; descriptions wrap. | |
| 16.2 | C: Add form | Full width; the kind toggle fits; the job list scrolls inside its box (max ~11 rows); chips wrap; Upload and add / Cancel wrap if needed. | |
| 16.3 | C: choose `QA-4c_a_very_long_file_name_without_any_spaces_to_check_wrapping_at_phone_width_0123456789.txt` | The size line under the picker **wraps** inside the form (broken mid-word). Console: `document.documentElement.scrollWidth <= innerWidth` → `true`. Cancel without saving. | |
| 16.4 | C: an asset whose description contains a long URL (edit "QA-4c general reading": append ` https://example.org/a/very/long/path/without/spaces/0123456789/0123456789/0123456789`, Save) | Same check: wraps, `scrollWidth <= innerWidth`. Then put the description back. | |
| 16.5 | C: orphan banner (make one with 9.1 if needed) | Text and **Remove it** wrap; then remove it. | |
| 16.6 | C: the delete confirm | Fits the width; buttons reachable. | |
| 16.7 | B: Jobs > S4 sheet Resources, General resources, and the 13.2 chat chips | Titles and descriptions wrap; chips wrap; `scrollWidth <= innerWidth` → `true`. Tapping a file opens it in a new tab. | |

---

## 17. Regression

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 17.1 | C: Playbook, Update with Cube, Source document, Conversations tabs | As after 4b (Playbook works and its ✎ buttons still open forms; the other three are placeholders). | |
| 17.2 | B: Jobs page | 40 jobs, Only mine 11; markers and the state editor work as in Slice 3. | |
| 17.3 | B: an older conversation with chips (Slice 3's `<QA_CONV>`, if kept) | Its link chips work; its file chip is now a **button** opening a signed URL (or nothing, if that asset was deleted in 14.4: unknown ids are dropped, no crash). | |
| 17.4 | Dev-server log, whole run | Exactly **one** `[companion-v2]` line (13.1). | |
| 17.5 | Console, all pages | No React errors or uncaught promise rejections (the "Multiple GoTrueClient" warning from the helpers is fine). | |

---

## 18. Things to record

Not pass/fail by themselves.

| Measure | Details |
|---|---|
| `<GLOBAL_LIMIT>`; 4.3 run or not run | |
| 4.2b: did the bar reach 100% before the too-big error? | |
| 5.4: any object left after Cancel upload? | |
| 3.4a2 / 4.1c2: was "Saving…" visible, and for how long? | |
| 7.1a: a file asset's file can't be replaced (delete and re-add instead) | |
| 10.3: `added_by` can be set to another user (no policy pins it to `auth.uid()`) | |
| Description is required only in the form; the database allows an empty one (Cube then sees "No description.") | |
| 15.2: visible focus on inputs (border colour only?) | |
| 15.6: Esc doesn't close the inline editor | |
| 16.4: a long URL in a description at 375 px (descriptions have no word-breaking) | |
| 8.6 run or not run; was BACKDATE (0.7a) accepted, or did you wait 10 minutes? | |
| 13.1: did Cube offer a resource? which? `cache_read` | |

---

## 19. Clean up (test project only, mandatory)

### 19.1 The block constraint is gone (as postgres)

```sql
select count(*) from pg_constraint where conname = 'qa_block';
```

| Expected | Pass/Fail |
|---|---|
| `0`. If `1`: `alter table assets drop constraint qa_block;` and re-run. | |

### 19.2 The global upload limit

If you changed it in 4.3: Dashboard > Storage > Settings > set it back to `<GLOBAL_LIMIT>`.

### 19.3 Delete the QA asset rows (as postgres)

First look:

```sql
select id, title, kind, storage_path, created_at
from assets
where playbook_id = '<LRL_ID>'
  and (title like 'QA%' or description like '%QA-4c%' or description like 'QA:%')
order by created_at;
```

| Expected | Pass/Fail |
|---|---|
| Only rows from this script (and Slice 3's "QA …" rows, if still there; the plan says 4c replaces them). **None** of the real assets recorded in 1.4. If a real one appears, stop and narrow the filter. | |

Then:

```sql
delete from assets
where playbook_id = '<LRL_ID>'
  and (title like 'QA%' or description like '%QA-4c%' or description like 'QA:%')
returning id, title, storage_path;
```

### 19.4 Remove the files that are now orphans (C, in the app)

Deleting rows in SQL leaves their files behind as orphans; BACKDATE (0.7a) every `storage_path` that 19.3 returned (files from the last 10 minutes are otherwise not offered), then the app removes them through the Storage
API. As C, reload the Assets screen.

| # | Expected | Pass/Fail |
|---|---|---|
| 19.4a | The banner "N uploaded files have no asset …" with N = the number of `storage_path`s returned by 19.3. Click **Remove them** (or **Remove it**): "Removed N files." (or "Removed 1 file."), banner gone. | |
| 19.4b | OBJ: no `QA-4c…`, `Donnees-…`, `qa-plan.pdf` objects; nothing with `has_row false`. (Anything left outside the main playbook's folder, which C's banner can't see, would mean a negative in 10.2 or 11.1 unexpectedly succeeded: record it and delete it in Dashboard > Storage.) | |
| 19.4c | ASSETS without the `<T0>` filter: only the real assets from 1.4, if any. | |

### 19.5 B's QA conversations

Delete `<QA_CONV>` and the 13.1 conversation from B's sidebar (🗑), or leave them (they only hold
test text).

### 19.6 Local files and browser settings

Delete `<FILES>`. Turn network throttling off. If you blocked pop-ups at any point, set them back to
the default.

### 19.7 Final look (B)

Reload Jobs as B.

| Expected | Pass/Fail |
|---|---|
| No General resources section (unless real untagged assets exist); S4 and P1 sheets show no QA resources. | |

---

## Acceptance criteria to steps

| Slice 4c acceptance criterion / requested check (plan and brief) | Steps | Pass/Fail |
|---|---|---|
| **A 90 MB file** can be added, tagged to a job, seen by an adopter in that job, and downloaded through a signed URL (where the project allows it) | **Cannot pass on this project as configured** (global limit `<GLOBAL_LIMIT>` < 100 MB). Covered instead by 4.1 (45 MB succeeds), 4.2 (60 MB: friendly message, no object, no row), 4.4 (> 100 MB refused in the browser); 4.3 only if the limit is raised. Record "not run" otherwise. | |
| A file (2 MB PDF) can be added, tagged to a job, seen by an adopter in that job, and downloaded through a signed URL | 3, 12.1c, 12.2b | |
| A link can be added, tagged to a job, seen by an adopter, opened in a new tab | 6.2, 12.1c, 12.2a | |
| The upload request goes to the Supabase Storage host, not `/api/...` | 3.4c, 3.4d, 4.1f | |
| An adopter can't upload; Storage refuses, as it does from devtools | 10.4 (B), 10.5 (anon), 11.1 (D) | |
| If the row insert fails, the uploaded object is removed and no orphan is listed (`check (false)` test); the message says truthfully whether the removal worked | 8.2, 8.6 (optional) | |
| Delete removes both the row and the object | 14.2, 14.3 | |
| Access: C sees the Assets tab; B, D and P get a 404 / gate; signed out → login | 2, 11.3 | |
| Add-file form: title prefilled from the file name, description required with the hint, job picker search/add/remove, progress bar (`role=progressbar`), all fields locked during upload, "Saving…" with no Cancel after the bytes are up | 3.1–3.4, 4.1a–c2, 5.6 | |
| Cancel upload mid-way leaves no row (and no object, or the clean-up banner removes it) | 5 | |
| Links: http/https with a host accepted; `javascript:`, plain text and bare `https://` refused in the add and edit forms, and by the DB when forced from the console | 6.1, 6.3, 7.2b, 10.1 | |
| Row checks: id = path segment, playbook_id, kind, storage_path under the playbook folder, job_codes, added_by | 3.5, 4.1e, 6.2c, 8.5 | |
| Edit title / description / jobs / url; saving or deleting a row that is gone reports it instead of claiming success | 7 | |
| Orphans: created deliberately from the console; shown only after 10 minutes; list fetched again before removal; removed | 9 | |
| Adopter B sees file and link assets in the job sheet and General resources; file opens via signed URL in a new tab; `window.opener` null; URL expires after ~60 s; only pdf/images/txt open inline, HTML/SVG/other download (stored as octet-stream); an asset tagged only to removed jobs shows under General resources | 3.7, 12 | |
| D (another playbook's member) sees nothing of the main playbook's assets | 11.1 (or 11.2 with P) | |
| Cube offers an asset in chat when its job comes up, and the chip opens it (1 model call) | 13.1 (chips without a model call: 13.2) | |
| 375 px | 16 | |
| Keyboard | 15 | |
| Clean up all QA assets and objects | 19 | |
