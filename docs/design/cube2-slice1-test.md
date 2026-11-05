# Cube 2.0 Slice 1: manual test script

Branch `cube-2`. This covers what Slice 1 delivers (see `docs/design/cube2-plan.md`, "Slice 1"):
the flag and nav, migrations `0034`–`0036`, the seed and `export-db` scripts, the `/companion` list,
the workspace shell with empty tabs, self-join, and the admin "Playbook contributors" panel.

**Not covered here, because later slices build them:** the chat, the Jobs screen, the asset screens,
the Conversations viewer, the daily message cap, prompt caching and large-file uploads. Every
workspace tab in Slice 1 is a placeholder ("Coming in a later build step"). That is expected.

**Already checked automatically, so not repeated here:** 57 SQL checks in PGlite (schema, functions,
triggers), and the flag on/off redirects with curl. This script covers what needs a real Supabase
project (real `auth.uid()`, real roles and grants, Storage, account deletion) and a browser.

---

## 0. Before you start

### 0.1 Safety check: are you pointed at the TEST project?

Everything below writes to the database in `.env.local`. It must be the **non-production** project.

```bash
cd "D:/ekstep-new/AI Diffusion Pathways/ai-diffusion-cube-app-cube-dev"
grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local
git branch --show-current
```

| Expected | Pass/Fail |
|---|---|
| The URL's project ref (the part before `.supabase.co`) matches the **test** project in Supabase Dashboard > Project Settings. The branch is `cube-2`. **If the ref is production, stop here.** | |

### 0.2 What you need

- `npm install` already run on this branch.
- `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` for the test project, plus `ADMIN_EMAILS` including your admin email.
- The Supabase Dashboard for the test project open in one browser tab (SQL Editor).
- Two browsers, or one normal window plus one private window, so you can be signed in as two
  people at once.

### 0.3 Test accounts

Create these as you reach them (Section 7). Use addresses you can receive mail at
(plus-addressing such as `you+qa-b@example.com` works).

| Name in this script | Purpose | Roles |
|---|---|---|
| **A** | Admin | Listed in `ADMIN_EMAILS` **and** has at least one `user_roles` row (see note in 4.3) |
| **B** | New sign-up, adopter, self-joins the main playbook, later deleted | `adopter` (automatic on sign-up) |
| **C** | Contributor to the main playbook only, later deleted | `adopter` |
| **D** | Adopter in `test-playbook` only | `adopter` |
| **P** | Pending user (no roles) | none |

### 0.4 Values to fill in as you go

Copy each value into this table when a step tells you to, then paste it wherever the script shows
`<NAME>`.

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>` (low-resource-language playbook id) | | 5.1 |
| `<TEST_ID>` (test-playbook id) | | 7.1 |
| `<A>`, `<B>`, `<C>`, `<D>`, `<P>` (user ids) | | 7.3 |
| `<BASE_TS>` (playbook `updated_at` before saving) | | 13.2 |
| `<T1>` (timestamp returned by the first save) | | 13.3 |
| `<B_MEMBER>`, `<B_CONV>`, `<C_CONV>`, `<D_CONV>` | | 10.4 |
| `<C_FILE>` (storage path of C's test file) | | 17.2 |

### 0.5 How to run SQL in the Supabase SQL Editor

- Dashboard > SQL Editor > New query. Paste, then **Run**.
- The editor only shows the result of the **last** statement. Every block below is written so the
  last statement is the one that matters.
- By default you run as the `postgres` superuser, which **ignores RLS**. Blocks marked
  **"as postgres"** are for setting up and checking data.
- To act as a particular user so RLS applies, wrap the statements in a transaction like this
  (**"impersonating"**):

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
  -- the statements to test go here
  rollback;   -- or commit; when the step says so
  ```

  `set local` and `set_config(..., true)` only last until the end of the transaction, so you go
  back to `postgres` straight afterwards.
- Most negative checks end with `rollback;`, so they change nothing even if something is wrong.
- If you ever see `current transaction is aborted`, run `rollback;` on its own and carry on.
- An "expected error" step passes when the editor shows an **error** whose text contains the word
  given (for example `stale_playbook`).

### 0.6 Starting and stopping the dev server

```bash
npm run dev
```

Open the URL it prints (normally `http://localhost:3000`). To stop: Ctrl+C. The flag
(`NEXT_PUBLIC_CUBE_VERSION`) is read **only when the server starts**, so restart after every change
to `.env.local`.

---

## 1. Apply the migrations

Pick **one** option. Option A is simpler.

### 1.1 Option A: paste the three files in the SQL Editor (as postgres)

Open each file in an editor, copy all of it, paste it into a new SQL Editor query and Run. **In this
order, once each:**

1. `supabase/migrations/0034_cube2_playbooks.sql`
2. `supabase/migrations/0035_cube2_assets.sql`
3. `supabase/migrations/0036_cube2_companion.sql`

| Expected | Pass/Fail |
|---|---|
| Each run shows "Success. No rows returned". No errors. | |

Do **not** run a file twice. A second run fails with `policy ... already exists`. That is
expected (migrations run once), not a bug.

### 1.2 Option B: Supabase CLI

```bash
npx supabase link --project-ref <test-project-ref>
npx supabase migration list
```

| Expected | Pass/Fail |
|---|---|
| `0001`–`0033` show a value in **both** the Local and Remote columns, and `0034`–`0036` show Local only. | |

**If `0001`–`0033` show Local only, stop and use Option A.** In that case the project's migration
history was never recorded, and `db push` would try to re-run all 33 old migrations.

```bash
npx supabase db push --dry-run
npx supabase db push
```

| Expected | Pass/Fail |
|---|---|
| The dry run lists exactly `0034`, `0035`, `0036`. The real push applies them with no error. | |

### 1.3 Rollback

There is no down-migration for `0034`–`0036`, and the repo has never had one. Rollback is
**untested**. If the test project needs resetting, ask the developer.

---

## 2. Check the schema on the real project (as postgres)

These checks cover what PGlite can't: Supabase's own default grants to `anon` and `authenticated`,
and the `storage` schema.

### 2.1 RLS is on for every new table

```sql
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('playbooks','playbook_jobs','playbook_members','assets',
                    'member_job_states','companion_conversations','companion_messages','companion_usage')
order by 1;
```

| Expected | Pass/Fail |
|---|---|
| 8 rows, `rls_on = true` for all. | |

### 2.2 Function grants: anonymous visitors can't call any of them

```sql
select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute')          as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('is_playbook_member','is_playbook_contributor','save_playbook',
                    'record_companion_turn','bump_companion_usage',
                    'contributor_list_conversations','contributor_get_conversation')
order by 1;
```

| Expected | Pass/Fail |
|---|---|
| 7 rows. `anon_can_run = false` on **all 7**. `signed_in_can_run = true` on all 7. `security_definer = true` on all except `record_companion_turn` (`false`). | |

### 2.3 Storage bucket and its policies

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'assets';
```

| Expected | Pass/Fail |
|---|---|
| One row: `assets`, `public = false`, `file_size_limit = 104857600`, `allowed_mime_types` null. | |

```sql
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%asset%'
order by cmd;
```

| Expected | Pass/Fail |
|---|---|
| 4 rows: DELETE, INSERT, SELECT, UPDATE. | |

Note: on the Supabase Free plan, the project-wide upload limit (50 MB) still applies. Large files
are tested in Slice 4c, not here.

---

## 3. Flag OFF: the app is the same as today

### 3.1 Turn the flag off and start

In `.env.local`, delete the `NEXT_PUBLIC_CUBE_VERSION` line or put `#` in front of it. Then:

```bash
npm run dev
```

Sign in as **A**.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 3.2 | Look at the left nav | Explore, Analyse, Contribute, Admin. No "Companion". "Recent Explorations" shows as before (if A has any). | |
| 3.3 | Click Explore, then Analyse, then Contribute | Each page loads as it did before this branch. | |
| 3.4 | Go to `/companion` | 404 page. | |
| 3.5 | Go to `/companion/low-resource-language` | 404 page. | |
| 3.6 | Go to `/admin` | Admin page as before. **No** "Playbook contributors" section. | |

---

## 4. Flag ON: navigation, before any playbook exists

### 4.1 Turn the flag on and restart

Add this line to `.env.local`, stop the server (Ctrl+C), then start it again:

```
NEXT_PUBLIC_CUBE_VERSION=2
```

```bash
npm run dev
```

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 4.2 | Signed in as A, look at the nav | Only **Companion** and **Admin**. No Explore, Analyse, Contribute, and no "Recent Explorations" block. Account and Sign out still there. | |
| 4.3 | Click Companion | "Your playbooks" page, with "There are no playbooks here yet." (No seed yet.) **If you instead see "Your account is almost ready":** A has no `user_roles` row (admin only through `ADMIN_EMAILS`). Note it, then give A a role: as postgres, `insert into user_roles (user_id, role) select id, 'adopter' from auth.users where email = '<A email>';` and reload. | |
| 4.4 | Type each URL in the address bar: `/`, `/explore`, `/analyse`, `/contribute`, `/navigate`, `/wiki`, `/adoptions`, `/explore/anything` | Each lands on `/companion`. | |
| 4.5 | Go to `/admin` | A "Playbook contributors" section is at the bottom, reading "No playbooks yet. Seed one with scripts/cube2/seed-playbook.mjs." | |
| 4.6 | Sign out, then go to `/companion` | Sent to the login page (URL contains `next=%2Fcompanion` or `next=/companion`). | |
| 4.7 | Sign in as A on that page | You land back on `/companion`. | |
| 4.8 | Narrow the window to about 375 px wide (or use devtools' phone view) | The nav and the Companion page are usable; nothing overlaps or is cut off. | |

---

## 5. Seed the playbook

Run in a terminal, from the repo folder. Leave the dev server running in another terminal.

Note: if `ANTHROPIC_API_KEY` is set, the seed asks Anthropic for an exact token count. That uses
the free `count_tokens` endpoint, but on the trial account that expires on 28-Oct-2026. Without the
key, the script prints an estimate instead. Either is fine for this test.

### 5.1 First seed

```bash
node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
  --json content/playbooks/low-resource-language.json \
  --source content/playbooks/low-resource-language.source.md
echo "exit code: $?"
```

| Expected | Pass/Fail |
|---|---|
| A line `Source document: 59,215 characters, ...` (about 13,700 tokens, or about 14,800 if estimated; around 14–15% of the cap; no WARNING). Then `Seeded "low-resource-language" (<uuid>): 40 jobs, 23 roles, 14 phases, 12 rules.` Exit code 0. **Copy the uuid into `<LRL_ID>`.** | |

### 5.2 Count what landed (as postgres)

```sql
select p.slug,
       (select count(*) from playbook_jobs j where j.playbook_id = p.id)          as jobs,
       jsonb_array_length(p.roles)                                               as roles,
       jsonb_array_length(p.sequence->'phases')                                  as phases,
       jsonb_array_length(p.sequence->'rules')                                   as rules,
       (select sum(jsonb_array_length(coalesce(j.body->'tasks','[]'::jsonb)))
          from playbook_jobs j where j.playbook_id = p.id)                       as task_links,
       length(p.source_doc) > 50000                                              as has_source_doc,
       p.listed, p.updated_by
from playbooks p where p.slug = 'low-resource-language';
```

| Expected | Pass/Fail |
|---|---|
| `jobs 40`, `roles 23`, `phases 14`, `rules 12`, `task_links 163` (139 checklist rows, some linked to several jobs), `has_source_doc true`, `listed true`, `updated_by` null. | |

### 5.3 Re-running without `--force` refuses

First note the current timestamp (as postgres):

```sql
select updated_at from playbooks where slug = 'low-resource-language';
```

Then:

```bash
node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
  --json content/playbooks/low-resource-language.json \
  --source content/playbooks/low-resource-language.source.md
echo "exit code: $?"
```

| Expected | Pass/Fail |
|---|---|
| The size line prints, then `Playbook "low-resource-language" already exists. Re-seeding overwrites every live edit; back it up with export-db.mjs, then re-run with --force.` Exit code 1. Running the `updated_at` query again gives the **same** value. | |

### 5.4 Negative: a source document with "Only for Author" is refused before anything is written

```bash
cp content/playbooks/low-resource-language.source.md ../qa-bad-source.md
printf '\n\nOnly for author: internal note, do not publish\n' >> ../qa-bad-source.md
node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
  --json content/playbooks/low-resource-language.json \
  --source ../qa-bad-source.md --slug qa-should-not-exist
echo "exit code: $?"
```

As postgres:

```sql
select count(*) from playbooks where slug = 'qa-should-not-exist';
```

| Expected | Pass/Fail |
|---|---|
| `Refusing to seed: The source document contains "Only for Author" text.` (matched regardless of case). Exit code 1. The count is `0`. | |

### 5.5 Negative: missing arguments

```bash
node --env-file=.env.local scripts/cube2/seed-playbook.mjs
echo "exit code: $?"
```

| Expected | Pass/Fail |
|---|---|
| `Usage: seed-playbook.mjs --json <file> --source <md> ...`, exit code 2. | |

---

## 6. Round trip: the database export matches the checked-in files

Do this **straight after seeding**, before anyone saves anything. After a save the files are
expected to differ (see 13.9).

### 6.1 The checked-in files use LF line endings

```bash
git ls-files --eol content/playbooks/
```

| Expected | Pass/Fail |
|---|---|
| Both files show `i/lf` and `w/lf`. (If `w/crlf` shows, the compare in 6.2 will fail for line endings only. Note it as a FAIL with that reason.) | |

### 6.2 Export and compare

```bash
mkdir -p ../cube2-export
node --env-file=.env.local scripts/cube2/export-db.mjs --slug low-resource-language --out ../cube2-export
git diff --no-index content/playbooks/low-resource-language.json ../cube2-export/low-resource-language.json
echo "json diff exit code: $?"
git diff --no-index content/playbooks/low-resource-language.source.md ../cube2-export/low-resource-language.source.md
echo "md diff exit code: $?"
```

| Expected | Pass/Fail |
|---|---|
| `Wrote ../cube2-export/low-resource-language.json (40 jobs) and ../cube2-export/low-resource-language.source.md.` Then **no diff output at all**, and both exit codes are `0`. | |

### 6.3 Negative: unknown slug

```bash
node --env-file=.env.local scripts/cube2/export-db.mjs --slug no-such-playbook --out ../cube2-export
echo "exit code: $?"
```

| Expected | Pass/Fail |
|---|---|
| `No playbook with slug "no-such-playbook".` Exit code 1. No new file in `../cube2-export`. | |

---

## 7. Second playbook and test accounts

### 7.1 Seed `test-playbook` from the same JSON

```bash
node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
  --json content/playbooks/low-resource-language.json \
  --source content/playbooks/low-resource-language.source.md \
  --slug test-playbook
```

| Expected | Pass/Fail |
|---|---|
| `Seeded "test-playbook" (<uuid>): 40 jobs, 23 roles, 14 phases, 12 rules.` **Copy the uuid into `<TEST_ID>`.** | |

Both playbooks now have the **same title**, so they look identical on `/companion` and in the admin
dropdown. Rename the test copy (as postgres):

```sql
update playbooks set title = 'TEST COPY: ' || title where slug = 'test-playbook'
returning slug, title;
```

### 7.2 Create the accounts

- **B:** sign up through the app's own sign-up (`/login`, sign-up with the 6-digit code). This also
  tests that a new account gets `adopter` automatically. **Don't open any playbook as B yet.**
- **C, D, P:** sign up the same way. If the test project's sign-up email isn't working, create them
  in Dashboard > Authentication > Users > Add user (tick "Auto confirm"), then give each one the
  adopter role as postgres:
  `insert into user_roles (user_id, role) select id, 'adopter' from auth.users where email = '<email>';`
- **D and P must not open any playbook in the browser** until a step says so.

### 7.3 Look up the ids (as postgres)

```sql
select u.email, u.id, array_agg(r.role) filter (where r.role is not null) as roles
from auth.users u left join user_roles r on r.user_id = u.id
where u.email in ('<A email>','<B email>','<C email>','<D email>','<P email>')
group by u.email, u.id order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| 5 rows. B (signed up through the app) has `{adopter}`. **Copy the ids into `<A>`…`<P>`.** | |

### 7.4 Make P pending (as postgres)

```sql
delete from user_roles where user_id = '<P>';
select count(*) from user_roles where user_id = '<P>';
```

| Expected | Pass/Fail |
|---|---|
| `0`. | |

---

## 8. `/companion` list, self-join and the pending gate

### 8.1 Opening the list does not join

Sign in as **B**. Click Companion.

| Expected | Pass/Fail |
|---|---|
| Two cards: "Low-resource language AI adoption" and "TEST COPY: Low-resource language AI adoption", each with its description and "Open →". | |

As postgres:

```sql
select count(*) from playbook_members where user_id = '<B>';
```

| Expected | Pass/Fail |
|---|---|
| `0`. Viewing the list alone creates no membership. | |

### 8.2 Opening a playbook joins as adopter / PMU

As B, click the "Low-resource language AI adoption" card.

| Expected | Pass/Fail |
|---|---|
| The page shows "← All playbooks", the playbook title, and **two** tabs: Home and Jobs. Home shows the "Chat with Cube" placeholder. Jobs shows the "Jobs" placeholder. | |

As postgres:

```sql
select p.slug, m.member_role, m.project_role, m.id
from playbook_members m join playbooks p on p.id = m.playbook_id
where m.user_id = '<B>';
```

| Expected | Pass/Fail |
|---|---|
| Exactly one row: `low-resource-language`, `adopter`, `PMU`. | |

### 8.3 Re-opening doesn't duplicate

As B, reload the page 3 times, go back to the list, then open the same card again. Open the
playbook URL in a second tab at the same time. Run the 8.2 query again.

| Expected | Pass/Fail |
|---|---|
| Still exactly one row for `low-resource-language`. No error page in either tab. | |

### 8.4 Negative: B can't open contributor tabs by URL

As B, type each URL:

- `/companion/low-resource-language/playbook`
- `/companion/low-resource-language/update`
- `/companion/low-resource-language/source`
- `/companion/low-resource-language/assets`
- `/companion/low-resource-language/conversations`

| Expected | Pass/Fail |
|---|---|
| All five show a 404 page. | |

### 8.5 Negative: unknown and wrongly-cased slugs

As B, open `/companion/does-not-exist` and `/companion/Low-Resource-Language`.

| Expected | Pass/Fail |
|---|---|
| Both 404. As postgres, `select count(*) from playbook_members where user_id = '<B>';` is still `1`. | |

### 8.6 Pending user P sees the gate and joins nothing

Sign in as **P** in the other browser.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 8.6a | Click Companion (or go to `/companion`) | "Your account is almost ready" message. No playbook cards. | |
| 8.6b | Go to `/companion/low-resource-language` directly | The same "almost ready" message (a 404 is also acceptable). **Not** the playbook workspace. | |
| 8.6c | As postgres: `select count(*) from playbook_members where user_id = '<P>';` | `0`. | |

---

## 9. Admin adds a contributor (C)

### 9.1 Add C through the panel

As **A**, go to `/admin` > Playbook contributors. Choose "Low-resource language AI adoption". Type
C's email and click **Add as contributor**.

| Expected | Pass/Fail |
|---|---|
| C's email appears in the list with a "Remove" button. The email box clears. | |

As postgres:

```sql
select p.slug, m.member_role, m.project_role
from playbook_members m join playbooks p on p.id = m.playbook_id
where m.user_id = '<C>';
```

| Expected | Pass/Fail |
|---|---|
| One row: `low-resource-language`, `contributor`, `PMU`. | |

### 9.2 C sees the extra tabs

Sign in as **C**. Companion > open "Low-resource language AI adoption".

| Expected | Pass/Fail |
|---|---|
| Seven tabs: Home, Jobs, Playbook, Update with Cube, Source document, Assets, Conversations. Clicking each shows its own placeholder (title matches the tab), and the clicked tab is underlined. | |

### 9.3 C's contributor role is scoped to that playbook

As C, open the "TEST COPY" card, then type `/companion/test-playbook/playbook`.

| Expected | Pass/Fail |
|---|---|
| The TEST COPY workspace shows only Home and Jobs. The `/playbook` URL is a 404. | |

Note: opening TEST COPY makes C an **adopter** member of `test-playbook`. That's expected (self-join);
it must not give C any contributor rights there (checked in Section 14).

### 9.4 Panel negatives (as A)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 9.4a | Type `nobody-qa@example.com` and click Add | "No signed-up user has that email." Nothing changes. | |
| 9.4b | Add C again to the same playbook | C appears **once**. As postgres, `select count(*) from playbook_members where user_id = '<C>' and playbook_id = '<LRL_ID>';` is `1`. | |
| 9.4c | Switch the dropdown to TEST COPY | "No contributors yet." (C isn't listed there.) | |
| 9.4d | Switch back, reload `/admin` | C is still listed for the main playbook (it was saved, not just shown). | |

### 9.5 API negatives

**Signed out** (terminal, dev server running):

```bash
curl -s -i -X POST http://localhost:3000/api/admin/playbook-members \
  -H "Content-Type: application/json" \
  -d '{"playbook_id":"<LRL_ID>","user_id":"<D>","action":"add"}' | head -20
```

| Expected | Pass/Fail |
|---|---|
| HTTP 401, body `{"error":"Unauthorized"}`. | |

**As C (not an admin).** In C's browser, open devtools (F12) > Console, paste and press Enter:

```js
await fetch('/api/admin/playbook-members', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playbook_id: '<TEST_ID>', user_id: '<C>', action: 'add' }),
}).then(async r => [r.status, await r.text()]);
```

| Expected | Pass/Fail |
|---|---|
| `[403, '{"error":"Not authorized."}']`. As postgres, C is still only an adopter in `test-playbook`. | |

**As A, bad requests.** In A's browser console:

```js
const post = (body) => fetch('/api/admin/playbook-members', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}).then(async r => [r.status, await r.text()]);

console.log('bad action  ', await post({ playbook_id: '<LRL_ID>', user_id: '<D>', action: 'delete' }));
console.log('missing user', await post({ playbook_id: '<LRL_ID>', action: 'add' }));
console.log('not json    ', await post('not json'));
console.log('unknown pb  ', await post({ playbook_id: '00000000-0000-0000-0000-000000000000', user_id: '<D>', action: 'add' }));
console.log('not a uuid  ', await post({ playbook_id: 'abc', user_id: '<D>', action: 'add' }));
console.log('remove non-member', await post({ playbook_id: '<LRL_ID>', user_id: '<D>', action: 'remove' }));
```

| Line | Expected (current code) | Pass/Fail |
|---|---|---|
| bad action | `400 {"error":"Invalid request."}` | |
| missing user | `400 {"error":"Invalid request."}` | |
| not json | `400 {"error":"Invalid request."}` | |
| unknown pb | `404 {"error":"Unknown playbook."}`. No row is created. | |
| not a uuid | `400 {"error":"Invalid request."}` | |
| remove non-member | `200 {"ok":true}` and nothing changes (D has no row in the main playbook). Silent no-op. | |

As postgres, confirm none of these created a row:

```sql
select count(*) from playbook_members where user_id = '<D>';
```

| Expected | Pass/Fail |
|---|---|
| `0` (D hasn't joined anything yet). | |

---

## 10. Set up conversations by SQL

There is no chat yet, so these steps create conversation rows directly, **as the users themselves**,
so RLS and `record_companion_turn` are exercised along the way.

### 10.1 D joins `test-playbook` and has one turn (impersonating D, commit)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<D>","role":"authenticated"}', true);

insert into public.playbook_members (playbook_id)
select id from public.playbooks where slug = 'test-playbook';

insert into public.companion_conversations (member_id, playbook_id, context)
select m.id, m.playbook_id, '{"stage":"pilot"}'::jsonb
from public.playbook_members m
join public.playbooks p on p.id = m.playbook_id
where p.slug = 'test-playbook' and m.user_id = '<D>';

select public.record_companion_turn(
  c.id,
  'We have already confirmed the language.',
  'Good, that settles the first step.',
  '{"jobUpdates":[{"job":"P2","state":"done"}]}'::jsonb,
  '{"district":"QA district"}'::jsonb,
  '[{"job":"P2","state":"done","note":"Language confirmed"}]'::jsonb
)
from public.companion_conversations c
join public.playbook_members m on m.id = c.member_id
where m.user_id = '<D>';

commit;
```

| Expected | Pass/Fail |
|---|---|
| No error. | |

### 10.2 B has one turn in the main playbook (impersonating B, commit)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);

insert into public.companion_conversations (member_id, playbook_id)
select m.id, m.playbook_id from public.playbook_members m
where m.user_id = '<B>' and m.playbook_id = '<LRL_ID>';

select public.record_companion_turn(
  c.id, 'Where do I start?', 'Let us start with the language survey.',
  null, '{"stage":"explore"}'::jsonb,
  '[{"job":"P1","state":"in_progress","note":"Started survey"}]'::jsonb
)
from public.companion_conversations c
join public.playbook_members m on m.id = c.member_id
where m.user_id = '<B>';

select public.bump_companion_usage('adopter', 50);

commit;
```

| Expected | Pass/Fail |
|---|---|
| Last result: `true`. | |

### 10.3 C has a "test chat" in the main playbook as themself (impersonating C, commit)

This one must **not** appear in the contributor conversation list later, because C is a contributor.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);

insert into public.companion_conversations (member_id, playbook_id)
select m.id, m.playbook_id from public.playbook_members m
where m.user_id = '<C>' and m.playbook_id = '<LRL_ID>';

select public.record_companion_turn(
  c.id, 'Contributor trying the adopter chat', 'Reply',
  null, '{}'::jsonb, '[]'::jsonb
)
from public.companion_conversations c
join public.playbook_members m on m.id = c.member_id
where m.user_id = '<C>' and c.playbook_id = '<LRL_ID>';

commit;
```

| Expected | Pass/Fail |
|---|---|
| No error. | |

### 10.4 Look up the ids (as postgres)

```sql
select u.email, p.slug, m.id as member_id, m.member_role, c.id as conversation_id,
       c.context,
       (select count(*) from companion_messages x where x.conversation_id = c.id) as messages
from companion_conversations c
join playbook_members m on m.id = c.member_id
join playbooks p on p.id = c.playbook_id
join auth.users u on u.id = m.user_id
order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| Three rows. B: main playbook, `adopter`, context `{"stage":"explore"}`, 2 messages. C: main playbook, `contributor`, 2 messages. D: `test-playbook`, `adopter`, context has both `stage` and `district`, 2 messages. **Copy `<B_MEMBER>`, `<B_CONV>`, `<C_CONV>`, `<D_CONV>`.** | |

### 10.5 Negative: B can't write into D's conversation (impersonating B, rollback)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select public.record_companion_turn('<D_CONV>', 'injected', 'injected', null, '{}'::jsonb, '[]'::jsonb);
rollback;
```

| Expected | Pass/Fail |
|---|---|
| Error containing `conversation_not_found` (B can't even see D's conversation). | |

---

## 11. Admin add and remove (B)

Changed after Slice 5: removing a contributor now deletes their membership, conversations and job states in that playbook (after a confirm), so their test chats never appear in the Conversations viewer.

### 11.1 Add B as a contributor

As A, `/admin` > Playbook contributors > main playbook > add B's email.

As postgres:

```sql
select id, member_role from playbook_members where user_id = '<B>' and playbook_id = '<LRL_ID>';
```

| Expected | Pass/Fail |
|---|---|
| Same `id` as `<B_MEMBER>` (the row was updated, not replaced), `member_role = contributor`. | |

As B, reload the main playbook workspace.

| Expected | Pass/Fail |
|---|---|
| Seven tabs now show. `/companion/low-resource-language/playbook` opens the placeholder (no 404). | |

### 11.2 Remove B

As A, click **Remove** next to B.

| Expected | Pass/Fail |
|---|---|
| A confirm names B and the playbook and says B's own conversations and job markers are deleted. Cancel changes nothing; OK removes. | |
| B disappears from the panel list. | |

As postgres:

```sql
select m.id, m.member_role,
       (select count(*) from companion_conversations c where c.member_id = m.id) as conversations,
       (select count(*) from member_job_states s where s.member_id = m.id)       as job_states
from playbook_members m where m.user_id = '<B>' and m.playbook_id = '<LRL_ID>';
```

| Expected | Pass/Fail |
|---|---|
| No row: B's membership, conversations and job states in this playbook are gone. | |

As B, reload.

| Expected | Pass/Fail |
|---|---|
| Back to two tabs (Home, Jobs), with an empty Home chat: B has joined afresh as an adopter (a new member id). `/companion/low-resource-language/playbook` is a 404 again. | |

---

## 12. RLS: adopter B (impersonating B, every block ends with rollback)

### 12.1 B can't change playbook content

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
with u1 as (update public.playbooks set title = 'HACKED' returning 1),
     u2 as (update public.playbook_jobs set name = 'HACKED' returning 1),
     d1 as (delete from public.playbook_jobs returning 1),
     d2 as (delete from public.playbooks returning 1)
select (select count(*) from u1) as playbooks_updated,
       (select count(*) from u2) as jobs_updated,
       (select count(*) from d1) as jobs_deleted,
       (select count(*) from d2) as playbooks_deleted;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| All four are `0`. | |

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.playbooks (slug, title) values ('qa-hack', 'hack');
rollback;
```

| Expected | Pass/Fail |
|---|---|
| Error: `new row violates row-level security policy for table "playbooks"`. | |

### 12.2 B sees only their own membership

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select user_id, member_role, project_role from public.playbook_members;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| Exactly one row, `user_id = <B>`. (C and D have rows too, but B can't see them.) | |

### 12.3 B can't make themself a contributor

Run each block separately.

```sql
-- (a) insert a contributor row for themself
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.playbook_members (playbook_id, member_role)
select id, 'contributor' from public.playbooks where slug = 'test-playbook';
rollback;
```

```sql
-- (b) upgrade their existing row
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
with u as (update public.playbook_members set member_role = 'contributor' where user_id = '<B>' returning 1)
select count(*) as rows_changed from u;
rollback;
```

```sql
-- (c) join with a project role other than PMU
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.playbook_members (playbook_id, project_role)
select id, 'Nodal Officer' from public.playbooks where slug = 'test-playbook';
rollback;
```

```sql
-- (d) add somebody else (D) to a playbook
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.playbook_members (user_id, playbook_id)
select '<D>', id from public.playbooks where slug = 'low-resource-language';
rollback;
```

| Block | Expected | Pass/Fail |
|---|---|---|
| (a) | RLS error on `playbook_members`. | |
| (b) | `rows_changed = 0`. | |
| (c) | RLS error. | |
| (d) | RLS error. | |

### 12.4 Positive control: B **can** self-join another listed playbook

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.playbook_members (playbook_id)
select id from public.playbooks where slug = 'test-playbook'
returning member_role, project_role;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| One row: `adopter`, `PMU`. (Rolled back, so B stays out of `test-playbook`.) | |

### 12.5 B sees only their own conversations, messages and states, and nothing as a contributor

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select (select count(*) from public.companion_conversations)                    as my_conversations,
       (select count(*) from public.companion_messages)                         as my_messages,
       (select count(*) from public.member_job_states)                          as my_states,
       (select count(*) from public.companion_usage)                            as my_usage_rows,
       (select count(*) from public.contributor_list_conversations('<LRL_ID>')) as as_contributor_list,
       public.contributor_get_conversation('<B_CONV>')                          as as_contributor_get;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| `my_conversations 1`, `my_messages 2`, `my_states 1`, `my_usage_rows 1`, `as_contributor_list 0`, `as_contributor_get` NULL. | |

### 12.6 B can't call `save_playbook`

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select public.save_playbook(p.id, p.updated_at, '{"description":"adopter edit"}'::jsonb)
from public.playbooks p where p.slug = 'low-resource-language';
rollback;
```

| Expected | Pass/Fail |
|---|---|
| Error containing `forbidden`. | |

### 12.7 Nobody writes the usage counter directly

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.companion_usage (user_id, role, count) values ('<B>', 'adopter', -100);
rollback;
```

| Expected | Pass/Fail |
|---|---|
| RLS error on `companion_usage`. | |

### 12.8 Pending P sees nothing and can't join

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<P>","role":"authenticated"}', true);
select count(*) as visible_playbooks from public.playbooks;
rollback;
```

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<P>","role":"authenticated"}', true);
insert into public.playbook_members (playbook_id) values ('<LRL_ID>');
rollback;
```

| Block | Expected | Pass/Fail |
|---|---|---|
| visible_playbooks | `0`. | |
| join | RLS error. | |

---

## 13. RLS and `save_playbook`: contributor C

### 13.1 C can't write directly either (impersonating C, rollback)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
with u1 as (update public.playbooks set title = 'HACKED' where slug = 'low-resource-language' returning 1),
     u2 as (update public.playbook_jobs set name = 'HACKED' where playbook_id = '<LRL_ID>' returning 1),
     d1 as (delete from public.playbook_jobs where playbook_id = '<LRL_ID>' returning 1)
select (select count(*) from u1) as playbooks_updated,
       (select count(*) from u2) as jobs_updated,
       (select count(*) from d1) as jobs_deleted;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| All three are `0`. | |

C sees only their own memberships:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select user_id, playbook_id, member_role from public.playbook_members;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| Only rows with `user_id = <C>`: the main playbook as `contributor`, plus `test-playbook` as `adopter` (from 9.3). B's row is **not** listed. | |

### 13.2 Note the base timestamp and original values (as postgres)

```sql
select p.updated_at, p.description,
       (select name from playbook_jobs where playbook_id = p.id and job_code = 'P1') as p1_name
from playbooks p where p.slug = 'low-resource-language';
```

| Expected | Pass/Fail |
|---|---|
| Copy `updated_at` **exactly as shown, with its time zone** into `<BASE_TS>`. `p1_name` is "Understand the language community and the access gap". | |

### 13.3 Save with the current timestamp succeeds (impersonating C, **commit**)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.save_playbook(p.id, '<BASE_TS>'::timestamptz,
                            jsonb_build_object('description', p.description || ' (QA)'))
from public.playbooks p where p.slug = 'low-resource-language';
commit;
```

| Expected | Pass/Fail |
|---|---|
| Returns a new timestamp, later than `<BASE_TS>`. **Copy it into `<T1>`.** | |

As postgres:

```sql
select updated_at, updated_by, right(description, 5) as ends_with
from playbooks where slug = 'low-resource-language';
```

| Expected | Pass/Fail |
|---|---|
| `updated_at = <T1>`, `updated_by = <C>`, `ends_with = (QA)`. | |

### 13.4 Negative: saving again with the old timestamp is refused (impersonating C)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.save_playbook(p.id, '<BASE_TS>'::timestamptz,
                            '{"description":"stale edit, must not save"}'::jsonb)
from public.playbooks p where p.slug = 'low-resource-language';
commit;
```

| Expected | Pass/Fail |
|---|---|
| Error containing `stale_playbook` (code P0409). | |

As postgres, re-run the 13.3 check query.

| Expected | Pass/Fail |
|---|---|
| Unchanged: `updated_at = <T1>`, description still ends `(QA)`. | |

### 13.5 Negative: removing "CC BY 4.0" rolls back everything, including job changes

This save, in one call: strips the licence from the credits, renames job P1 and deletes job E10.
All of it must be refused.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.save_playbook(
  p.id,
  p.updated_at,
  jsonb_build_object('overview',
    jsonb_set(p.overview, '{credits}',
      '[{"label":"Created by","value":"EkStep Foundation, 2026."}]'::jsonb)),
  (select jsonb_agg(jsonb_build_object(
            'job_code', j.job_code, 'name', j.name || ' (QA SHOULD NOT SAVE)',
            'stages', to_jsonb(j.stages), 'work_area', j.work_area, 'job_type', j.job_type,
            'position', j.position, 'body', j.body))
     from public.playbook_jobs j where j.playbook_id = p.id and j.job_code = 'P1'),
  array['E10']
)
from public.playbooks p where p.slug = 'low-resource-language';
commit;
```

| Expected | Pass/Fail |
|---|---|
| Error containing `credits_attribution_missing` (code P0422). | |

As postgres:

```sql
select p.updated_at,
       position('CC BY 4.0' in (p.overview->'credits')::text) > 0                                as still_has_cc_by,
       (select name from playbook_jobs where playbook_id = p.id and job_code = 'P1')            as p1_name,
       exists (select 1 from playbook_jobs where playbook_id = p.id and job_code = 'E10')        as e10_still_there,
       (select count(*) from playbook_jobs where playbook_id = p.id)                             as jobs
from playbooks p where p.slug = 'low-resource-language';
```

| Expected | Pass/Fail |
|---|---|
| `updated_at = <T1>`, `still_has_cc_by true`, `p1_name` is the original name (no "QA"), `e10_still_there true`, `jobs 40`. | |

### 13.6 Negative: "Only for Author" text is refused (impersonating C)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.save_playbook(p.id, p.updated_at,
         jsonb_build_object('description', p.description || ' ONLY FOR AUTHOR: internal'))
from public.playbooks p where p.slug = 'low-resource-language';
commit;
```

| Expected | Pass/Fail |
|---|---|
| Error containing `only_for_author_content` (code P0423). As postgres, `updated_at` is still `<T1>`. | |

### 13.7 Negative: C can't save the playbook they don't contribute to

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.save_playbook(p.id, p.updated_at, '{"description":"cross-playbook edit"}'::jsonb)
from public.playbooks p where p.slug = 'test-playbook';
rollback;
```

| Expected | Pass/Fail |
|---|---|
| Error containing `forbidden`. | |

### 13.8 Put the description back (impersonating C, **commit**)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.save_playbook(p.id, p.updated_at,
         jsonb_build_object('description', replace(p.description, ' (QA)', '')))
from public.playbooks p where p.slug = 'low-resource-language';
commit;
```

| Expected | Pass/Fail |
|---|---|
| Returns a new timestamp. As postgres, the description no longer ends with `(QA)`. | |

### 13.9 Optional: round trip again after a save

Re-run the commands in 6.2.

| Expected | Pass/Fail |
|---|---|
| No diff. The content is back to the seed, and `updated_at`/`updated_by` aren't in the export. (Any diff here means a save changed something it shouldn't have.) | |

---

## 14. Contributor conversation RPCs: scoped and anonymous

All impersonating **C**, all `rollback`.

### 14.1 C's own playbook: only adopter conversations, labelled "User"

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select * from public.contributor_list_conversations('<LRL_ID>');
rollback;
```

| Expected | Pass/Fail |
|---|---|
| Exactly **one** row: `conversation_id = <B_CONV>`, `label = User`, `context {"stage":"explore"}`, `message_count 2`. C's own conversation `<C_CONV>` is **not** listed. Columns are only conversation_id, label, context, started_at, updated_at, message_count; **no user id or email column**. | |

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.contributor_get_conversation('<B_CONV>');
rollback;
```

| Expected | Pass/Fail |
|---|---|
| One JSON value with `label: "User"`, the two messages (role, content, created_at), and `job_states` with P1 `in_progress`. Search the text for B's email, `<B>` and `<B_MEMBER>`: **none** appear. | |

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select public.contributor_get_conversation('<C_CONV>');
rollback;
```

| Expected | Pass/Fail |
|---|---|
| NULL. A contributor's own chat isn't shown as an adopter conversation. | |

### 14.2 The other playbook: nothing

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select (select count(*) from public.contributor_list_conversations('<TEST_ID>')) as listed_in_test_playbook,
       public.contributor_get_conversation('<D_CONV>')                          as d_conversation;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| `listed_in_test_playbook 0`, `d_conversation` NULL. (C is an adopter member of `test-playbook` from 9.3, and that still gives nothing.) | |

### 14.3 Direct table reads give C nothing of B's or D's

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select (select count(*) from public.companion_conversations where id in ('<B_CONV>','<D_CONV>')) as others_conversations,
       (select count(*) from public.companion_messages where conversation_id in ('<B_CONV>','<D_CONV>')) as others_messages,
       (select count(*) from public.member_job_states)                                             as visible_states;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| `0`, `0`, `0` (C has no job states of their own). | |

---

## 15. Unlisted playbook

### 15.1 Hide `test-playbook` (as postgres)

```sql
update playbooks set listed = false where slug = 'test-playbook' returning slug, listed;
```

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 15.2 | As B, open `/companion` | Only the main playbook card. | |
| 15.3 | As B, go to `/companion/test-playbook` | 404. As postgres, B still has no `test-playbook` row. | |
| 15.4 | Sign in as D, open `/companion` and `/companion/test-playbook` | The list doesn't show TEST COPY, and the URL is a 404, even though D is a member. **Record what you see.** This matches the current rule ("listed, or you're a contributor"); note whether that's what you want for a member when a playbook is unlisted. | |

### 15.5 Show it again (as postgres)

```sql
update playbooks set listed = true where slug = 'test-playbook' returning slug, listed;
```

---

## 16. Anonymous access through the Supabase API

Run in a terminal. Paste the two values from `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```bash
export SB_URL="https://<ref>.supabase.co"
export SB_ANON="<anon key>"

curl -s "$SB_URL/rest/v1/playbooks?select=slug" -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON"; echo
curl -s "$SB_URL/rest/v1/playbook_jobs?select=job_code&limit=3" -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON"; echo
curl -s "$SB_URL/rest/v1/playbook_members?select=*" -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON"; echo
curl -s -X POST "$SB_URL/rest/v1/rpc/contributor_list_conversations" \
  -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON" -H "Content-Type: application/json" \
  -d '{"p_playbook_id":"<LRL_ID>"}'; echo
curl -s -X POST "$SB_URL/rest/v1/rpc/save_playbook" \
  -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON" -H "Content-Type: application/json" \
  -d '{"p_playbook_id":"<LRL_ID>","p_base_updated_at":"2000-01-01T00:00:00Z","p_playbook":{}}'; echo
```

| Line | Expected | Pass/Fail |
|---|---|---|
| playbooks | `[]` | |
| playbook_jobs | `[]` | |
| playbook_members | `[]` | |
| contributor_list_conversations | Error JSON with `permission denied for function` (code `42501`). | |
| save_playbook | Error JSON with `permission denied for function`. | |

---

## 17. Storage upload checks from the browser console

These run in the browser against the test project's Storage, signing each user in on a **separate,
throw-away** client, so your normal app session isn't affected. Use any `localhost:3000` tab.
Open devtools (F12) > Console.

### 17.1 Set up the helper (paste once per tab)

Fill in the URL, anon key and the two playbook ids:

```js
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const SB_URL = 'https://<ref>.supabase.co';
const SB_ANON = '<anon key>';
const LRL = '<LRL_ID>', TEST = '<TEST_ID>';
const txt = (s) => new Blob([s], { type: 'text/plain' });
async function as(email, password) {
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  if (email) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; }
  return sb;
}
```

A "Multiple GoTrueClient instances" warning is harmless.

### 17.2 C uploads to their own playbook

```js
const c = await as('<C email>', '<C password>');
const cFile = `${LRL}/${crypto.randomUUID()}/qa-contributor.txt`;
console.log(cFile, await c.storage.from('assets').upload(cFile, txt('hello from C')));
```

| Expected | Pass/Fail |
|---|---|
| `error: null`, `data.path` equals the printed path. **Copy the path into `<C_FILE>`.** | |

### 17.3 C's negatives

```js
console.log('other playbook', await c.storage.from('assets').upload(`${TEST}/${crypto.randomUUID()}/x.txt`, txt('x')));
console.log('bad path      ', await c.storage.from('assets').upload(`not-a-uuid/x.txt`, txt('x')));
console.log('orphans       ', await c.from('asset_orphans').select('*'));
```

| Line | Expected | Pass/Fail |
|---|---|---|
| other playbook | `error` with "new row violates row-level security policy". | |
| bad path | Same RLS error. | |
| orphans | One row: `storage_path = <C_FILE>`, `playbook_id = <LRL_ID>`. (There's no `assets` row for it, so it counts as an orphan. That's expected; the Assets screen arrives in Slice 4c.) | |

### 17.4 C can delete a file

```js
const tmp = `${LRL}/${crypto.randomUUID()}/qa-delete-me.txt`;
console.log(await c.storage.from('assets').upload(tmp, txt('delete me')));
console.log(await c.storage.from('assets').remove([tmp]));
console.log((await c.from('asset_orphans').select('storage_path')).data);
```

| Expected | Pass/Fail |
|---|---|
| Upload OK. `remove` returns `data` with one item. The orphans list shows only `<C_FILE>`. | |

### 17.5 Adopter B (member of the main playbook): can read, can't write

```js
const b = await as('<B email>', '<B password>');
console.log('download   ', await b.storage.from('assets').download('<C_FILE>').then(async r => r.error ?? await r.data.text()));
console.log('signed url ', await b.storage.from('assets').createSignedUrl('<C_FILE>', 60));
console.log('upload     ', await b.storage.from('assets').upload(`${LRL}/${crypto.randomUUID()}/b.txt`, txt('b')));
console.log('remove     ', await b.storage.from('assets').remove(['<C_FILE>']));
console.log('orphans    ', await b.from('asset_orphans').select('*'));
```

| Line | Expected | Pass/Fail |
|---|---|---|
| download | `hello from C` | |
| signed url | `data.signedUrl` present. Open it in a new tab: the text "hello from C" shows. | |
| upload | RLS error. | |
| remove | `data: []` (nothing removed). Re-run C's orphans query: `<C_FILE>` is still there. | |
| orphans | `data: []`. Not a contributor, so no rows. | |

### 17.6 Adopter D (member of `test-playbook` only): nothing in the main playbook, and can't upload

```js
const d = await as('<D email>', '<D password>');
console.log('download other', await d.storage.from('assets').download('<C_FILE>'));
console.log('upload own pb ', await d.storage.from('assets').upload(`${TEST}/${crypto.randomUUID()}/d.txt`, txt('d')));
console.log('list other    ', await d.storage.from('assets').list(LRL));
```

| Line | Expected | Pass/Fail |
|---|---|---|
| download other | `error` (not found / not allowed). No file content. | |
| upload own pb | RLS error. Adopters can't upload, even to their own playbook. | |
| list other | `data: []`. | |

### 17.7 Signed out

```js
const anon = await as();
console.log(await anon.storage.from('assets').download('<C_FILE>'));
console.log(await anon.storage.from('assets').upload(`${LRL}/${crypto.randomUUID()}/anon.txt`, txt('anon')));
```

| Expected | Pass/Fail |
|---|---|
| Both return an `error`. | |

**Leave `<C_FILE>` in place.** Step 18.4 uses it.

---

## 18. Account deletion removes the member's rows

### 18.1 Before (as postgres)

```sql
select (select count(*) from playbook_members where id = '<B_MEMBER>')             as members,
       (select count(*) from companion_conversations where id = '<B_CONV>')       as conversations,
       (select count(*) from companion_messages where conversation_id = '<B_CONV>') as messages,
       (select count(*) from member_job_states where member_id = '<B_MEMBER>')    as job_states,
       (select count(*) from companion_usage where user_id = '<B>')               as usage,
       (select count(*) from auth.users where id = '<B>')                         as auth_user;
```

| Expected | Pass/Fail |
|---|---|
| `1, 1, 2, 1, 1, 1`. | |

### 18.2 B deletes their account

Sign in as B, go to `/account`, use the delete-account option and enter B's password.

| Expected | Pass/Fail |
|---|---|
| Success; B is signed out. | |

### 18.3 After (as postgres): re-run the 18.1 query, then check nobody else lost anything

| Expected | Pass/Fail |
|---|---|
| All six are `0`. | |

```sql
select (select count(*) from companion_conversations where id in ('<C_CONV>','<D_CONV>')) as others_conversations,
       (select count(*) from playbook_jobs where playbook_id = '<LRL_ID>')                as lrl_jobs,
       (select count(*) from playbooks)                                                  as playbooks;
```

| Expected | Pass/Fail |
|---|---|
| `2`, `40`, `2`. | |

### 18.4 Delete C: a contributor who saved the playbook and owns an uploaded file

Before: as postgres, `select updated_by from playbooks where slug = 'low-resource-language';` shows
`<C>` (from 13.8).

Sign in as C, `/account`, delete the account.

| Expected | Pass/Fail |
|---|---|
| Success. **If you get "Could not delete your account"**, look in the `npm run dev` terminal for an `[account/delete] deleteUser` line and copy it. A message about `storage.objects` or an `owner` foreign key means a user who uploaded a file can't delete their account: record it as a FAIL. | |

As postgres:

```sql
select (select updated_by from playbooks where slug = 'low-resource-language')          as updated_by,
       (select count(*) from playbooks)                                                as playbooks,
       (select count(*) from playbook_members where user_id = '<C>')                   as c_members,
       (select count(*) from companion_conversations where id = '<C_CONV>')            as c_conversation,
       (select count(*) from storage.objects where bucket_id = 'assets' and name = '<C_FILE>') as c_file;
```

| Expected | Pass/Fail |
|---|---|
| `updated_by` NULL, `playbooks 2`, `c_members 0`, `c_conversation 0`, `c_file 1` (playbook content outlives its uploader). | |

As A, reload `/admin`.

| Expected | Pass/Fail |
|---|---|
| The main playbook shows "No contributors yet." | |

---

## 19. Clean up (test project only)

- Storage: Dashboard > Storage > `assets` > delete the `<LRL_ID>` folder.
- `test-playbook` (removes its members and conversations too), as postgres:
  `delete from playbooks where slug = 'test-playbook';`
- Test users D and P: Dashboard > Authentication > Users > delete.
- `rm -rf ../cube2-export ../qa-bad-source.md`
- Keep `low-resource-language` seeded if you want to carry on with Slice 2.

---

## Acceptance criteria to steps

| Slice 1 acceptance criterion | Steps | Pass/Fail |
|---|---|---|
| Flag unset: app identical (nav, `/explore`, `/analyse`, `/contribute`) | 3.2–3.6 | |
| Flag `2`: nav shows Companion (+ Admin), old URLs redirect, signed out goes to login | 4.2, 4.4, 4.6–4.7 | |
| Migrations apply cleanly to non-production | 1.1 or 1.2, 2.1–2.3 | |
| Seed loads 40 jobs, 23 roles, 14 phases, 12 rules | 5.1, 5.2 | |
| Re-running without `--force` refuses | 5.3 (+ 5.4, 5.5 negatives) | |
| Round trip: export byte-identical to checked-in JSON and `.md` | 6.1, 6.2 (+ 13.9) | |
| Opening the playbook creates an adopter member row | 8.1–8.3 (+ 8.5, 8.6, 12.4) | |
| Admin can add or remove a contributor; contributor then sees the extra tabs | 9.1–9.4, 11.1–11.2 (+ 9.5 negatives) | |
| Scoped contributor reads: nothing from playbook B's list or conversation ids | 14.2 (+ 14.1, 14.3) | |
| Contributor can't `update playbooks` directly | 13.1 (+ 12.1 for adopters) | |
| `save_playbook` with stale `updated_at` raises `stale_playbook` and changes nothing | 13.4 | |
| Save without "CC BY 4.0" rolls back completely, no job row changed | 13.5 | |
| (Plan test 7) Adopter `update playbooks` affects 0 rows; sees only own member row | 12.1, 12.2 | |
| (Plan test 9) Deleting an account removes its member, conversation and state rows | 18.1–18.4 | |
| Storage policies: members read, contributors write, scoped per playbook | 17.2–17.7 | |
| Anonymous visitors get nothing | 16 | |
