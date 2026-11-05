# Cube 2.0 Slice 5: manual test script

Branch `cube-2`. This covers what Slice 5 delivers (see `docs/design/cube2-plan.md`, "Slice 5",
section 2 "Anonymous conversation access", section 7 "Conversations", and Slice 3's acceptance row
"Deleting one … drops it from the contributor viewer"):

- `app/companion/[slug]/conversations/page.tsx`: the contributor-only list (`requireContributor`,
  then `listConversations`);
- `app/companion/[slug]/conversations/[id]/page.tsx`: one conversation, read-only. 404 when the id
  isn't a UUID (`UUID` regex), when `contributor_get_conversation` returns nothing, or when the
  conversation belongs to **another** playbook than the one in the URL (`playbook_id !== playbook.id`);
- `components/companion-v2/conversations/ConversationList.tsx` (every row "User", "Last message …
  · N messages", the first **two** filled context entries, "Nothing known about their situation
  yet.", "Started …", "No conversations yet.") and `ConversationView.tsx` ("What Cube knows about
  their situation", "Where they are on the jobs" in sequence order with "A job no longer in the
  playbook" for unknown codes and "Set by the person", the transcript with "User · …" / "Cube · …");
- `lib/companion-v2/conversations.ts`: the two RPC wrappers, `CONTEXT_LABEL` ("Where they are",
  "Where the work is", "Already done", "Their part"), `contextEntries` (only the four keys, only
  non-empty strings, in a fixed order) and `formatWhen` (`en-IN`, `Asia/Kolkata`, suffix ` IST`);
- `components/companion-v2/StateMarker.tsx`: new optional `title` prop. Callers that don't pass it
  (the adopter Jobs list) must keep "Set by you" / "From your conversation with Cube";
- the committed RPCs in `supabase/migrations/0036_cube2_companion.sql` (lines 265–336):
  `contributor_list_conversations(p_playbook_id)` and `contributor_get_conversation(p_conversation_id)`,
  both `security definer`, both gated by `is_playbook_contributor` (`0034`, which also needs a
  `user_roles` row), both limited to `member_role = 'adopter'`, both passing `context` through
  `filter_companion_context` (only `stage`, `location`, `done`, `role_note`), neither returning a
  user id, member id, name or email. `execute` is revoked from `anon`.

**No migration in this slice.** `0036` already holds both RPCs (applied in Slice 1). `git status`
also shows `supabase/.gitignore` and `supabase/config.toml` as untracked: they come from
`supabase init`, are not part of Slice 5, and hold no secrets (only `env(...)` references). Decide
separately whether to commit them (Findings F8).

**Not run by whoever wrote this script:** lint, types, build, any page load, any SQL. Section 0.2
runs the first three.

**Cost.** Section 3 makes about **10** Anthropic calls (each adopter Home open makes one hidden
kickoff call, plus one per message). Per the Product Charter the Anthropic account was a free trial
due to expire on **28-Oct-2026** (TD-16), which has passed. If a call fails with 401/403 or "Cube
couldn't answer just now", check the account, then use **3.6 (no-model fallback)** instead: every
other section works on SQL-made conversations. Everything outside section 3 is browser ↔ Supabase
and must print **no** `[companion-v2]` line in the dev-server log.

> Test data in this script carries the marker **`QA-5`** in message text and notes. Section 16
> removes what this script adds (the `qa-empty` playbook, the injected context keys, the unknown job
> state). If you stop part-way, go straight to section 16.

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
| The project ref is the **test** project. Branch `cube-2`. `git status`: ` M app/companion/[slug]/conversations/page.tsx`, ` M components/companion-v2/StateMarker.tsx`, `?? app/companion/[slug]/conversations/[id]/`, `?? components/companion-v2/conversations/`, `?? lib/companion-v2/conversations.ts`, `?? supabase/.gitignore`, `?? supabase/config.toml`. Nothing under `supabase/migrations/` changed. **If the ref is production, stop here.** | |

### 0.2 Lint, types, build

```bash
npm run lint
npx tsc --noEmit
npm run build
```

| Expected | Pass/Fail |
|---|---|
| No errors from any of the three (warnings that already existed before this slice are fine; record any new one that names a file in this slice). The build's route list includes `ƒ /companion/[slug]/conversations` and `ƒ /companion/[slug]/conversations/[id]` (dynamic). | |

### 0.3 `.env.local` and the dev server

`NEXT_PUBLIC_CUBE_VERSION=2` is set. `COMPANION_DAILY_MESSAGE_CAP` and
`COMPANION_V2_FAIL_AFTER_CHARS` are **not** set. Start `npm run dev`. The terminal is the
**dev-server log**: each model call prints one `[companion-v2] stop=... in=... cache_read=...` line.

**Go to pages by URL, not via Home**, except in section 3. Opening a Home tab with an empty latest
conversation starts Cube's greeting (a model call). C goes straight to
`/companion/low-resource-language/conversations`; B and E straight to `/companion/low-resource-language/jobs`.

### 0.4 Test accounts

| Name | Purpose | Roles / membership |
|---|---|---|
| **A** | Admin, **not** a contributor: must get a 404. Also re-adds C if needed. | In `ADMIN_EMAILS`, has a `user_roles` row |
| **B** | First adopter of the main playbook. Two conversations, one via **Start a new conversation**. Sets a job state by hand. Deletes a conversation. | `adopter`; `adopter` member of `low-resource-language` |
| **C** | Contributor to the main playbook **only**. Does most of this script. Also chats on Home (must not be listed). | `adopter`; `contributor` member of `low-resource-language`; at most an `adopter` member of `test-playbook` |
| **D** | Adopter of `test-playbook` only. Owns the conversation C must never see. | `adopter`; `adopter` member of `test-playbook` only |
| **E** | Second adopter of the main playbook. **New in this slice**: sign up a fresh account (it gets `adopter` automatically), or reuse any approved account that is not B, C or D and is not a contributor anywhere. | `adopter` |
| **P** | Pending user (no roles). | none |

**Never open a `/companion/low-resource-language/…` page as D** (until 13.3 says so). Any approved
user who opens a listed playbook joins it as an adopter (plan, Decision 6), and a 404 page under that
slug still joins them (Findings F4).

Use **three browser profiles** (or a normal window, a private window and a second browser): one for
C, one for B, one for E (later D, A, P).

### 0.5 Values to fill in as you go

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>`, `<TEST_ID>` | | 1.1 |
| `<B>`, `<C>`, `<D>`, `<E>` (user ids) | | 1.1 |
| `<B email>`, `<E email>`, `<D email>` | | 1.1 |
| `<B_MEMBER>`, `<E_MEMBER>`, `<C_MEMBER>` (`playbook_members.id` on the main playbook) | | 1.1 / 3.5 |
| `<D_MEMBER>` (D's member id on `test-playbook`) | | 1.1 |
| `<T0>` (start time) | | 1.3 |
| `<B_CONV1>`, `<B_CONV2>` (B's first and "new" conversation) | | 3.5 |
| `<E_CONV>`, `<C_CONV>` | | 3.5 |
| `<D_CONV>` (D's conversation in `test-playbook`) | | 7.1 |
| `<EMPTY_ID>` (the `qa-empty` playbook) | | 8.1 |

### 0.6 SQL in the Supabase SQL Editor

Same rules as Slice 1, section 0.5:

- Blocks marked **"as postgres"** run as the superuser (RLS ignored), for setup and checking.
- **"Impersonating X"** blocks wrap the statements so RLS applies:

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<X>","role":"authenticated"}', true);
  -- statements
  rollback;   -- or commit; when the step says so
  ```
- The editor shows only the **last** statement's result.
- `current transaction is aborted` → run `rollback;` on its own and carry on.

### 0.7 Named queries (as postgres)

**MIRROR**: every conversation as the database holds it, with the account behind it (for your eyes
only; the app must never show the `email`, `member_id` or `user` columns). The `*_ist` columns are
formatted the way the app's `formatWhen` should print them, minus the ` IST` suffix.

```sql
select p.slug,
       c.id                                                    as conversation_id,
       u.email,
       m.member_role,
       m.id                                                    as member_id,
       public.filter_companion_context(c.context)              as shown_context,
       c.context = public.filter_companion_context(c.context)  as context_clean,
       to_char(c.started_at at time zone 'Asia/Kolkata', 'FMDD Mon YYYY, FMHH12:MI am') as started_ist,
       to_char(c.updated_at at time zone 'Asia/Kolkata', 'FMDD Mon YYYY, FMHH12:MI am') as updated_ist,
       (select count(*) from companion_messages x where x.conversation_id = c.id)      as messages,
       (select left(x.content, 50) from companion_messages x
          where x.conversation_id = c.id and x.role = 'user' order by x.created_at limit 1) as first_user_msg
from companion_conversations c
join playbook_members m on m.id = c.member_id
join playbooks p        on p.id = c.playbook_id
join auth.users u       on u.id = m.user_id
where p.slug in ('low-resource-language', 'test-playbook', 'qa-empty')
order by p.slug, c.updated_at desc;
```

"The expected list" for a playbook = MIRROR's rows for that `slug` **with `member_role = 'adopter'`**,
in the order shown (newest `updated_at` first).

**STATES** (`<MEMBER>` = the member id of the conversation's owner): the job states the detail page
should show, in the order it should show them.

```sql
select s.job_code,
       coalesce(j.name, '(not in playbook)') as shown_name,
       j.position,
       s.state, s.note, s.set_by
from member_job_states s
left join playbook_jobs j on j.playbook_id = '<LRL_ID>' and j.job_code = s.job_code
where s.member_id = '<MEMBER>'
order by coalesce(j.position, 1000000000), s.job_code;
```

**MSGS** (`<CONV>` = a conversation id): the transcript the detail page should show.

```sql
select role, left(content, 60) as starts,
       to_char(created_at at time zone 'Asia/Kolkata', 'FMDD Mon YYYY, FMHH12:MI am') as at_ist
from companion_messages
where conversation_id = '<CONV>'
order by created_at;
```

### 0.8 Console helpers (paste once per tab), "HELPERS"

The Slice 4b/4c pattern: each user signs in on a **separate, throw-away** client, so your app
session isn't touched. Any `localhost:3000` tab, devtools (F12) > Console. Fill in the URL and anon
key from `.env.local` and the placeholders.

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
const list = (sb, pb) => sb.rpc('contributor_list_conversations', { p_playbook_id: pb });
const get = (sb, id) => sb.rpc('contributor_get_conversation', { p_conversation_id: id });
const show = (label, r) => console.log(label, r.error ? [r.error.code, r.error.message] : r.data);
// Identity values that must never appear in what a contributor receives.
const FORBIDDEN = ['<B email>', '<E email>', '<D email>', '<B>', '<E>', '<D>', '<B_MEMBER>', '<E_MEMBER>', '<D_MEMBER>'];
const leaks = (data) => { const s = JSON.stringify(data ?? null).toLowerCase(); return FORBIDDEN.filter((f) => s.includes(f.toLowerCase())); };
// Every key in the response, with context keys as "context.<key>".
function keysDeep(x, out = new Set(), prefix = '') {
  if (Array.isArray(x)) x.forEach((v) => keysDeep(v, out, prefix));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
    out.add(prefix + k);
    if (k === 'context') Object.keys(v ?? {}).forEach((ck) => out.add('context.' + ck));
    else keysDeep(v, out, prefix);
  }
  return [...out].sort();
}
```

| Expected | Pass/Fail |
|---|---|
| No error. A "Multiple GoTrueClient instances" warning is harmless. | |

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
       (select m.member_role || ' / ' || m.id from playbook_members m
          join playbooks p on p.id = m.playbook_id
          where m.user_id = u.id and p.slug = 'test-playbook')         as test_member,
       (select string_agg(role, ',') from user_roles r where r.user_id = u.id) as roles
from auth.users u
where u.email in ('<A email>', '<B email>', '<C email>', '<D email>', '<E email>', '<P email>')
order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| **A**: roles non-empty; `lrl_member` null or `adopter / …` (**not** `contributor`; if it is, record it and use another admin, or remove A as contributor in `/admin` first). **B**: `adopter / <id>` on the main playbook (copy `<B_MEMBER>`). **C**: `contributor / <id>` on the main playbook (copy `<C_MEMBER>`), `test_member` null or `adopter / …`, **never** `contributor`. **D**: `test_member adopter / <id>` (copy `<D_MEMBER>`), `lrl_member` **null**. **E**: roles include `adopter`; `lrl_member` null (E joins in 3.3) or `adopter`. **P**: roles null, both members null. **Copy `<LRL_ID>`, `<TEST_ID>` and all user ids and emails.** If `test_id` is null, seed it as in Slice 1 step 7.1 (`seed-playbook.mjs … --slug test-playbook`, then rename to "TEST COPY: …"). If C isn't a contributor: as **A**, `/admin` > **Playbook contributors** > main playbook > add C. If D's `lrl_member` is not null, D already belongs to the main playbook: record it, and in sections 6.3 and 7 use **P** where the script says D for "a non-member". | |

### 1.2 The RPCs exist and anon can't run them (as postgres)

```sql
select p.proname,
       p.prosecdef                                                    as security_definer,
       pg_get_function_result(p.oid)                                  as returns,
       has_function_privilege('anon', p.oid, 'execute')               as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute')      as auth_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('contributor_list_conversations', 'contributor_get_conversation',
                    'is_playbook_contributor', 'filter_companion_context')
order by p.proname;
```

| Expected | Pass/Fail |
|---|---|
| 4 rows. Both `contributor_*`: `security_definer true`, `anon_exec false`, `auth_exec true`. `contributor_list_conversations` returns `TABLE(conversation_id uuid, label text, context jsonb, started_at timestamp with time zone, updated_at timestamp with time zone, message_count bigint)`; `contributor_get_conversation` returns `jsonb`. **No** column or key named `user_id`, `member_id` or `email` in either. | |

### 1.3 Baseline (as postgres)

```sql
select now();
```

Copy into `<T0>`. Then run **MIRROR** (0.7) and keep the result.

| Expected | Pass/Fail |
|---|---|
| MIRROR may already hold conversations from earlier slices (B's Slice 3 chats, C's Slice 1 test chat, D's Slice 1 turn in `test-playbook`). Record how many rows each slug has and how many are `adopter`. All `context_clean` values: record any `false` (an older row with extra keys: the RPC must still hide them, 6.3c). | |

---

## 2. Who can reach the Conversations screen

### 2.1 C sees the tab and the list

Sign in as **C**. Go to `/companion/low-resource-language/conversations`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 2.1a | Tabs | Home, Jobs, Playbook, Update with Cube, Source document, Assets, **Conversations** (underlined, `aria-current="page"`). | |
| 2.1b | Intro | "Conversations people have had with Cube about this playbook, newest first. Everyone is shown as “User”: names and emails are never shown. Your own conversations as a contributor aren’t listed." **No** placeholder ("Coming in a later build step"). | |
| 2.1c | Rows | One per adopter row in MIRROR for `low-resource-language` (1.3), or "No conversations yet." if there are none. Detailed checks are in section 4. | |
| 2.1d | Dev-server log | No `[companion-v2]` line, no error. | |

### 2.2 Everyone else gets a 404 (or the login page)

Use B's, A's and P's browsers. Type the URLs; don't click.

| # | Who | URL | Expected | Pass/Fail |
|---|---|---|---|---|
| 2.2a | B (adopter) | `/companion/low-resource-language/conversations` | The 404 page. | |
| 2.2b | B | `/companion/low-resource-language/conversations/00000000-0000-0000-0000-000000000000` | 404. (With real ids again in 9.2.) | |
| 2.2c | B | `/companion/low-resource-language/jobs` | Tabs **Home, Jobs** only: no Conversations tab. | |
| 2.2d | A (admin, not a contributor) | `/companion/low-resource-language/conversations` | 404 (admins are not implicitly contributors, plan Assumption 1). Opening it may make A an adopter member: as postgres, record whether A now has an `adopter` row on the main playbook (expected by design, Findings F4). | |
| 2.2e | P (pending) | `/companion/low-resource-language/conversations` | 404 (the playbook isn't visible to a pending account). As postgres, P still has **no** `playbook_members` row. | |
| 2.2f | Signed out (a private window) | `/companion/low-resource-language/conversations` | Redirect to `/login?next=%2Fcompanion%2Flow-resource-language%2Fconversations` (or the unencoded form). | |
| 2.2g | C | `/companion/does-not-exist/conversations` | 404. | |

---

## 3. Adopters chat (real model calls, about 10)

Skip to **3.6** if the model is unavailable.

### 3.1 B: first conversation (3 calls)

As **B**, open `/companion/low-resource-language` (Home). Cube greets (1 call). Click the chip
**"Where do I start?"** (1 call). When Cube replies, send:

> QA-5 We are the PMU for a district in Odisha. The District Collector has approved the project and we are just starting.

(1 call.) Wait for the reply to finish.

| Expected | Pass/Fail |
|---|---|
| 3 `[companion-v2]` lines. No error on screen. | |

### 3.2 B: "Start a new conversation" (2 calls)

Still as B, click **Start a new conversation** (top right of the chat). The URL gains `?c=<new id>`,
the chat is empty and Cube greets (1 call). Click **"What usually goes wrong, and how do I avoid
it?"** (1 call).

| Expected | Pass/Fail |
|---|---|
| The sidebar's Recent conversations shows **two** entries for B ("What usually goes wrong…" on top, "Where do I start?" below). 2 more `[companion-v2]` lines. | |

### 3.3 E: one conversation (2 calls)

As **E**, first open `/companion/low-resource-language/jobs` (joins E as an adopter, no model call),
then the **Home** tab (Cube greets, 1 call). Send:

> QA-5 My name is Ravi QA. Our PMU works in Bihar. We have not started the language survey yet.

(1 call.) The typed name is on purpose: free text in transcripts is accepted (plan, Decision 7), so
it **will** show in the transcript; what must never show is E's **account** email, name or id.

| Expected | Pass/Fail |
|---|---|
| 2 more `[companion-v2]` lines. | |

### 3.4 C: a contributor's own chat on Home (2 calls)

As **C**, open `/companion/low-resource-language` (Home, greeting: 1 call), send:

> QA-5 contributor trying the adopter chat

(1 call.)

| Expected | Pass/Fail |
|---|---|
| 2 more `[companion-v2]` lines (about **9–10** in total for section 3). | |

### 3.5 Record the ids (as postgres)

Run **MIRROR**.

| Expected | Pass/Fail |
|---|---|
| New rows since `<T0>`: **B** ×2 (`adopter`), **E** ×1 (`adopter`), **C** ×1 (`contributor`). B's newer row (`first_user_msg` "What usually goes wrong…") has the same `shown_context` as B's older row had **at the moment the button was pressed** (the new conversation copies it; later turns may add to it). Message counts: each starts with Cube's greeting, so a conversation with k user messages has `2k + 1` (B first: 5, B new: 3, E: 3, C: 3). **Copy `<B_CONV1>` (B, "Where do I start?"), `<B_CONV2>` (B, "What usually goes wrong…"), `<E_CONV>`, `<C_CONV>`, and E's `member_id` into `<E_MEMBER>`.** | |

### 3.6 No-model fallback (only if 3.1–3.4 couldn't run)

This creates the same shape of data through `record_companion_turn`, as the users themselves, so RLS
applies. It does **not** test the Start-a-new-conversation button's own insert; for that, press the
button anyway as B after 3.6a: the row is created **before** the model call, so a separate row with
0 messages (if the greeting fails) still shows that the button made a new row. Record which you did.

E must have joined first: as E, open `/companion/low-resource-language/jobs` once (no model call).

**3.6a B, first conversation (impersonating B, commit)**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id)
values ('<B_MEMBER>', '<LRL_ID>');
select public.record_companion_turn(
  (select id from public.companion_conversations where member_id = '<B_MEMBER>' order by started_at desc limit 1),
  'QA-5 Where do I start?', 'QA-5 Start with **the language survey**.',
  null, '{"stage":"Just starting","location":"A district in Odisha"}'::jsonb,
  '[{"job":"P1","state":"in_progress","note":"QA-5 survey being planned"}]'::jsonb);
commit;
```

**3.6b B, "new conversation" with the context copied (impersonating B, commit)**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id, context)
select member_id, playbook_id, context from public.companion_conversations
where member_id = '<B_MEMBER>' order by started_at desc limit 1;
select public.record_companion_turn(
  (select id from public.companion_conversations where member_id = '<B_MEMBER>' order by started_at desc limit 1),
  'QA-5 What usually goes wrong, and how do I avoid it?', 'QA-5 The most common problem is starting data collection too early.',
  null, '{}'::jsonb, '[]'::jsonb);
commit;
```

**3.6c E (impersonating E, commit)**: the same as 3.6a with `<E>` / `<E_MEMBER>`, user text
`'QA-5 My name is Ravi QA. Our PMU works in Bihar.'`, context `'{"location":"Bihar"}'` and job
updates `'[{"job":"P2","state":"discussed","note":"QA-5"}]'`.

**3.6d C (impersonating C, commit)**: the same as 3.6a with `<C>` / `<C_MEMBER>`, user text
`'QA-5 contributor trying the adopter chat'`, context `'{}'`, job updates `'[]'`.

Then do 3.5 (message counts are 2 per conversation here, not `2k + 1`).

---

## 4. The list (C)

As **C**, reload `/companion/low-resource-language/conversations`. Run **MIRROR** next to it.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 4.1 | Rows | Exactly the expected list (0.7): same number, same order. `<B_CONV2>` and `<B_CONV1>` are **two separate rows**; `<E_CONV>` is a row; **`<C_CONV>` is not** (C is a contributor). No `test-playbook` rows (D's). | |
| 4.2 | Label | Every row's title is **User**. No email, name, initials, member number or id anywhere on the page. | |
| 4.3 | Counts | "· N messages" equals MIRROR's `messages` for each row; "1 message" (singular) where it is 1. | |
| 4.4 | Context | For each row: the **first two** filled keys of `shown_context` in the order stage → location → done → role_note, with labels "Where they are:", "Where the work is:", "Already done:", "Their part:". A row whose `shown_context` is `{}` (or has only empty strings) shows "Nothing known about their situation yet." | |
| 4.5 | B's two rows | Both show the same context lines, unless B's later turns changed it (compare with MIRROR). | |
| 4.6 | Dates | "Last message `<updated_ist>` IST" and "Started `<started_ist>` IST" for each row, matching MIRROR's columns exactly in date and clock time (for example `5 Nov 2026, 3:04 pm IST`; spacing or the case of am/pm may differ by Node version). A UTC time would be **5 h 30 min earlier**: that is a fail. | |
| 4.7 | Hover / click | Hovering a row turns its border to the accent colour. Clicking `<B_CONV1>`'s row opens `/companion/low-resource-language/conversations/<B_CONV1>`. | |
| 4.8 | Dev-server log | No `[companion-v2]` line. | |

---

## 5. Context and job-state markers (detail)

### 5.1 Prepare the edge cases

**5.1a A state set by the person (B, in the app, no model call).** As **B**, open
`/companion/low-resource-language/jobs?open=S4`. In the job sheet's state editor choose **Skipped**,
note `QA-5 set by me`, save. Then open `?open=P1` and, if P1 has a state from Cube, leave it.

**5.1b A job code no longer in the playbook (as postgres).** `record_companion_turn` skips unknown
codes, so put the row in directly (there is no foreign key on `job_code`; this is what a state left
behind by a removed job looks like):

```sql
insert into member_job_states (member_id, job_code, state, note, set_by)
values ('<B_MEMBER>', 'QA9', 'done', 'QA-5 job removed from the playbook', 'cube')
returning *;
```

**5.1c Extra and odd context keys (as postgres).** The RPCs must pass only the four keys:

```sql
update companion_conversations
set context = context || jsonb_build_object(
      'stage', 'QA-5 Just starting',
      'location', 'QA-5 A district in Odisha',
      'done', 'QA-5 Collector approval',
      'role_note', 'QA-5 PMU lead',
      'email', '<B email>',
      'name', 'QA-5 Real Name Leak',
      'user_id', '<B>')
where id = '<B_CONV1>'
returning context;
```

**5.1d A date across midnight IST (as postgres).** Only `started_at`, so the list order (by
`updated_at`) doesn't change:

```sql
update companion_conversations set started_at = '2026-11-04T20:00:00Z'
where id = '<B_CONV1>' returning started_at;
```

Then run **STATES** with `<MEMBER>` = `<B_MEMBER>`, and **MSGS** with `<CONV>` = `<B_CONV1>`.

| Expected | Pass/Fail |
|---|---|
| STATES: S4 `skipped`, note `QA-5 set by me`, `set_by user`; `QA9` with `shown_name (not in playbook)`, `position null`, **last**; any states Cube recorded in section 3 (for example P1). | |

### 5.2 `<B_CONV1>` as C

As **C**, open `/companion/low-resource-language/conversations/<B_CONV1>`.

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.2a | Header | "← All conversations", then **User**, then "Started **5 Nov 2026, 1:30 am IST** · last message `<updated_ist>` IST" (20:00 UTC on 4 Nov = 01:30 IST on 5 Nov: the date must be the **5th**). | |
| 5.2b | "What Cube knows about their situation" | Four entries in this order: Where they are → `QA-5 Just starting`; Where the work is → `QA-5 A district in Odisha`; Already done → `QA-5 Collector approval`; Their part → `QA-5 PMU lead`. **No** `email`, `name`, `user_id`, "Real Name Leak" or B's email anywhere. | |
| 5.2c | "Where they are on the jobs" | The sub-line "From all their conversations. Jobs they haven’t talked about aren’t listed." Then one row per STATES row, **in STATES order**: the job **name** (no job code), a marker with the right label (Discussed / In progress / Done / Skipped), the note under it. | |
| 5.2d | S4 | Marker **Skipped** (struck through, hollow dot), note `QA-5 set by me`, and the small line **Set by the person**. Hovering the marker: tooltip "Set by the person". | |
| 5.2e | A Cube-recorded state (e.g. P1) | No "Set by the person" line. Tooltip "Recorded by Cube from what they said". | |
| 5.2f | `QA9` | Last row: **A job no longer in the playbook**, marker **Done**, note `QA-5 job removed from the playbook`. The text `QA9` does not appear. | |
| 5.2g | Jobs B never discussed | Not listed (no "not discussed" rows, no warnings). | |
| 5.2h | Transcript | Matches MSGS row for row, in order. User messages right-aligned in accent bubbles with "User · `<at_ist>` IST"; Cube's left-aligned with markdown rendered (bold shows bold) and "Cube · `<at_ist>` IST". The first message is Cube's greeting (there is no user message before it). No `<ui_action>` text anywhere. | |
| 5.2i | Read-only | No composer, no edit or delete controls, no "Ask Cube" button. | |

### 5.3 `<B_CONV2>` (the "new conversation") as C

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.3a | Context | Its own `shown_context` (MIRROR). The keys injected in 5.1c are **not** here (they went into `<B_CONV1>` only). | |
| 5.3b | Jobs | **The same** job states as 5.2c–5.2f (they belong to B, not to a conversation). | |
| 5.3c | Transcript | Only this conversation's messages (MSGS with `<B_CONV2>`); nothing from `<B_CONV1>`. | |

### 5.4 `<E_CONV>` as C

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 5.4a | Header and transcript | **User**; the transcript (MSGS with `<E_CONV>`) includes "My name is Ravi QA" as E typed it (by design, Decision 7). E's account email and id appear nowhere. | |
| 5.4b | Jobs | STATES with `<MEMBER>` = `<E_MEMBER>`: only E's states (none of B's: no S4 Skipped, no QA9). "None yet." if E has none. | |

### 5.5 The person sees the same markers (B)

As **B**, reload `/companion/low-resource-language/jobs`.

| Expected | Pass/Fail |
|---|---|
| S4 shows **Skipped**; hovering it says "Set by you" (the adopter wording is unchanged by the new `title` prop). A Cube-recorded job (e.g. P1) says "From your conversation with Cube". The same states as C saw in 5.2c, except QA9, which has no job to show under. | |

### 5.6 Hostile and long content renders as text (impersonating E, commit)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<E>","role":"authenticated"}', true);
select public.record_companion_turn(
  '<E_CONV>',
  'QA-5 <script>alert(1)</script> <img src=x onerror=alert(2)> https://example.com/' || repeat('verylongunbrokenpath', 15),
  'QA-5 **bold** <img src=x onerror=alert(3)> [link](javascript:alert(4)) ' || repeat('Lorem-ipsum-dolor-', 20),
  null, '{}'::jsonb, '[]'::jsonb);
commit;
```

As C, reload `/companion/low-resource-language/conversations/<E_CONV>`.

| Expected | Pass/Fail |
|---|---|
| No alert dialog. The user bubble shows the `<script>` and `<img …>` text literally. Cube's message shows **bold** as bold, and the `<img …>` and `[link](javascript:…)` as literal text (no image, no link). The long URL and the long hyphenated run wrap inside their boxes; the page has no horizontal scroll at desktop width. E's row on the list moves to the top (its `updated_at` changed). | |

---

## 6. Anonymity: page source, RSC payload and RPC JSON

### 6.1 Page source (C)

On `/companion/low-resource-language/conversations` and then on `…/conversations/<B_CONV1>`: press
**Ctrl+U** (view source). The RSC payload is inside the `self.__next_f.push(...)` scripts at the
bottom. Use Ctrl+F for each of: `<B email>`, the part of B's email before `@`, `<E email>`, the part
of E's email before `@`, `<B>`, `<E>`, `<B_MEMBER>`, `<E_MEMBER>`, `user_id`, `member_id`,
`Real Name Leak`.

| Expected | Pass/Fail |
|---|---|
| **Zero** hits for every term on both pages. (C's **own** email appears in the sidebar and in the payload as the signed-in user: that is fine. If an email search term is also part of C's address, check each hit is C's.) | |

### 6.2 Client navigation payload (Network)

Devtools > Network, "Preserve log" on, filter `_rsc`. On the list page click `<E_CONV>`'s row, then
"← All conversations", then `<B_CONV1>`'s row. Select each `?_rsc=` request > Response. Then use the
Network panel's search (Ctrl+F inside Network, "Search" in response bodies) for the same terms as 6.1.

| # | Expected | Pass/Fail |
|---|---|---|
| 6.2a | One `?_rsc=` request (status 200) per navigation; responses contain "User" and the transcript text. | |
| 6.2b | **Zero** hits for any 6.1 term in any response. | |
| 6.2c | No request from the browser to `/rest/v1/rpc/contributor_…` (the RPCs run on the server for these pages). The only `companion_conversations` request is the sidebar's own list, and its response holds only C's own conversations (`<C_CONV>` and any older C rows), never B's or E's. | |

### 6.3 The RPC JSON from devtools (C)

In C's tab, Console, paste **HELPERS** (0.8), then:

```js
const c = await as('<C email>', '<C password>');
const L = await list(c, LRL);   show('list', L);
console.log('list keys', keysDeep(L.data), 'leaks', leaks(L.data), 'labels', [...new Set(L.data.map((r) => r.label))]);
const G = await get(c, '<B_CONV1>');   show('get B1', G);
console.log('get keys', keysDeep(G.data), 'leaks', leaks(G.data));
console.log('own chat', (await get(c, '<C_CONV>')).data, 'own chat listed?', L.data.some((r) => r.conversation_id === '<C_CONV>'));
```

| # | Expected | Pass/Fail |
|---|---|---|
| 6.3a | `list`: an array with the same ids, order and `message_count` as the page (4.1). `list keys` exactly `context`, `context.<only stage/location/done/role_note>`, `conversation_id`, `label`, `message_count`, `started_at`, `updated_at`. `labels` = `['User']`. `leaks` = `[]`. | |
| 6.3b | `get B1`: `get keys` exactly `content`, `context`, `context.done`, `context.location`, `context.role_note`, `context.stage`, `conversation_id`, `created_at`, `job`, `job_states`, `label`, `messages`, `note`, `playbook_id`, `role`, `set_by`, `started_at`, `state`, `updated_at`. **No** `context.email`, `context.name`, `context.user_id`, `user_id`, `member_id`, `email`, `ui`. `leaks` = `[]`. `job_states` includes S4 (`set_by: "user"`) and QA9. | |
| 6.3c | If 1.3 found an older row with `context_clean false`: its `context` in `list` shows only the allowed keys. | |
| 6.3d | `own chat` = `null`; `own chat listed?` = `false`. | |

### 6.4 C has no direct table access to adopters' rows (console, same tab)

```js
show('convs', await c.from('companion_conversations').select('id, member_id'));
show('msgs', await c.from('companion_messages').select('conversation_id').eq('conversation_id', '<B_CONV1>'));
show('states', await c.from('member_job_states').select('member_id, job_code').eq('member_id', '<B_MEMBER>'));
show('members', await c.from('playbook_members').select('user_id, member_role').eq('playbook_id', LRL));
```

| Expected | Pass/Fail |
|---|---|
| `convs`: only C's own rows (`member_id` = `<C_MEMBER>`, or C's member id in `test-playbook`). `msgs` `[]`. `states` `[]`. `members`: only C's own row. | |

---

## 7. Two playbooks: a contributor sees nothing of another

### 7.1 D's conversation in `test-playbook` (as postgres)

From MIRROR, copy D's `test-playbook` conversation id into `<D_CONV>`. If D has none, create one
(impersonating D, commit):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<D>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id, context)
values ('<D_MEMBER>', '<TEST_ID>', '{"stage":"QA-5 D stage"}');
select public.record_companion_turn(
  (select id from public.companion_conversations where member_id = '<D_MEMBER>' order by started_at desc limit 1),
  'QA-5 D asks something', 'QA-5 D gets an answer', null, '{}'::jsonb,
  '[{"job":"P2","state":"done","note":"QA-5 D"}]'::jsonb);
commit;
```

| Expected | Pass/Fail |
|---|---|
| MIRROR shows `<D_CONV>` under `test-playbook`, `adopter`, at least 2 messages. | |

### 7.2 Through the URL (C, typed into the address bar)

| # | URL | Expected | Pass/Fail |
|---|---|---|---|
| 7.2a | `/companion/test-playbook/conversations` | 404 (C is at most an adopter there). | |
| 7.2b | `/companion/test-playbook/conversations/<D_CONV>` | 404. | |
| 7.2c | `/companion/test-playbook/conversations/<B_CONV1>` | 404 (C's own playbook's conversation under the other slug). | |
| 7.2d | `/companion/low-resource-language/conversations/<D_CONV>` | 404 (the RPC returns nothing: C doesn't contribute to `test-playbook`). | |
| 7.2e | `/companion/test-playbook/jobs` | Tabs **Home, Jobs** only. As postgres, C's `test-playbook` row is `adopter` (it may have been created by 7.2a; Findings F4). | |
| 7.2f | Dev-server log | No 500, no stack trace; no `[companion-v2]` line. | |

### 7.3 Through the RPCs (console)

In any tab with HELPERS pasted:

```js
const c = await as('<C email>', '<C password>');
show('C list TEST', await list(c, TEST));
show('C get D', await get(c, '<D_CONV>'));
const d = await as('<D email>', '<D password>');
show('D list TEST', await list(d, TEST));
show('D get own', await get(d, '<D_CONV>'));
show('D list LRL', await list(d, LRL));
show('D get B1', await get(d, '<B_CONV1>'));
const b = await as('<B email>', '<B password>');
show('B list LRL', await list(b, LRL));
show('B get own', await get(b, '<B_CONV1>'));
show('B get E', await get(b, '<E_CONV>'));
const p = await as('<P email>', '<P password>');
show('P list LRL', await list(p, LRL));
show('P get B1', await get(p, '<B_CONV1>'));
const anon = await as();
show('anon list', await list(anon, LRL));
show('anon get', await get(anon, '<B_CONV1>'));
```

| # | Line | Expected | Pass/Fail |
|---|---|---|---|
| 7.3a | `C list TEST`, `C get D` | `[]` and `null`. | |
| 7.3b | `D list TEST`, `D get own` | `[]` and `null` (D is an adopter: even their own conversation isn't served by the contributor RPC). | |
| 7.3c | `D list LRL`, `D get B1` | `[]` and `null`. | |
| 7.3d | `B list LRL`, `B get own`, `B get E` | `[]`, `null`, `null`. | |
| 7.3e | `P list LRL`, `P get B1` | `[]` and `null`. | |
| 7.3f | `anon list`, `anon get` | `['42501', 'permission denied for function contributor_list_conversations']` and the same for `contributor_get_conversation`. | |

### 7.4 The same at the database (impersonating C, rollback)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C>","role":"authenticated"}', true);
select (select count(*) from public.contributor_list_conversations('<TEST_ID>')) as test_rows,
       public.contributor_get_conversation('<D_CONV>')                           as d_conv,
       (select count(*) from public.contributor_list_conversations('<LRL_ID>'))  as lrl_rows;
rollback;
```

| Expected | Pass/Fail |
|---|---|
| `test_rows 0`, `d_conv` NULL, `lrl_rows` = the number of adopter rows for the main playbook in MIRROR. | |

---

## 8. Empty playbook, and a contributor of two playbooks

### 8.1 Create `qa-empty` with C as its contributor (as postgres)

`listed = false`, so no adopter sees it; C sees it because C contributes to it.

```sql
insert into playbooks (slug, title, description, listed)
values ('qa-empty', 'QA-5 empty playbook', 'QA-5', false)
returning id;
```

Copy into `<EMPTY_ID>`, then:

```sql
insert into playbook_members (user_id, playbook_id, member_role)
values ('<C>', '<EMPTY_ID>', 'contributor')
returning id, member_role;
```

**Don't open Home in `qa-empty`** (it would start a greeting on an empty playbook).

### 8.2 "No conversations yet" (C)

Open `/companion/qa-empty/conversations`.

| # | Expected | Pass/Fail |
|---|---|---|
| 8.2a | Title "QA-5 empty playbook", all seven tabs, the intro line, then **No conversations yet.** in a dashed box. No error. | |
| 8.2b | Console: `show('empty', await list(c, '<EMPTY_ID>'))` → `[]` (paste HELPERS and sign in C first if this is a new tab). | |

### 8.3 Wrong slug for a conversation C *can* read (C)

C now contributes to two playbooks, so the RPC returns `<B_CONV1>` to C whichever URL is used; the
page itself must refuse it under the wrong slug.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 8.3a | Console: `show('B1', await get(c, '<B_CONV1>'))` | The conversation JSON (`playbook_id` = `<LRL_ID>`). | |
| 8.3b | Open `/companion/qa-empty/conversations/<B_CONV1>` | **404** (`[id]/page.tsx:22`, `conversation.playbook_id !== playbook.id`). | |
| 8.3c | Open `/companion/low-resource-language/conversations/<B_CONV1>` | Renders (as 5.2). | |

---

## 9. Invalid ids and adopters on detail URLs

### 9.1 C, typed URLs under `/companion/low-resource-language/conversations/`

| # | Path segment | Expected | Pass/Fail |
|---|---|---|---|
| 9.1a | `not-a-uuid` | 404. | |
| 9.1b | `123` | 404. | |
| 9.1c | `<B_CONV1>` with one extra character at the end | 404. | |
| 9.1d | `<B_CONV1>` with the last character removed | 404. | |
| 9.1e | `00000000-0000-0000-0000-000000000000` | 404. | |
| 9.1f | A random UUID (console: `crypto.randomUUID()`) | 404. | |
| 9.1g | `<LRL_ID>` (a real id, but of a playbook) | 404. | |
| 9.1h | `<B_MEMBER>` (a real id, of a member) | 404. | |
| 9.1i | `%27%20or%201%3D1--` | 404. | |
| 9.1j | `<B_CONV1>` in **UPPER CASE** | Record: renders the same conversation (the regex is case-insensitive and Postgres accepts it) or 404. Either is acceptable; no 500. | |
| 9.1k | `<B_CONV1>/extra` | 404. | |
| 9.1l | Dev-server log after all of 9.1 | No 500 and no stack trace (a 404 is not logged as an error). | |

### 9.2 Adopters on real detail URLs

| # | Who | URL | Expected | Pass/Fail |
|---|---|---|---|---|
| 9.2a | B | `/companion/low-resource-language/conversations/<B_CONV1>` (their own) | 404. | |
| 9.2b | B | `…/conversations/<E_CONV>` | 404. | |
| 9.2c | E | `…/conversations/<B_CONV1>` | 404. | |
| 9.2d | E | `…/conversations` | 404. | |

---

## 10. Deleting a conversation (B's sidebar)

### 10.1 Delete

Keep C's list page open in one browser and `…/conversations/<B_CONV2>` open in a second C tab. As
**B**, hover `<B_CONV2>`'s sidebar entry ("What usually goes wrong…"), click 🗑, confirm **Delete**.

| Expected | Pass/Fail |
|---|---|
| Toast "Conversation deleted."; the entry is gone from B's sidebar. No model call (unless B was on Home showing that conversation, in which case Home reloads B's latest conversation; it has messages, so no greeting). | |

### 10.2 The database (as postgres)

```sql
select (select count(*) from companion_conversations where id = '<B_CONV2>') as conv,
       (select count(*) from companion_messages where conversation_id = '<B_CONV2>') as msgs,
       (select count(*) from member_job_states where member_id = '<B_MEMBER>') as b_states;
```

| Expected | Pass/Fail |
|---|---|
| `conv 0`, `msgs 0`, `b_states` unchanged from 5.1 (S4, QA9 and Cube's rows still there). | |

### 10.3 The viewer (C)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 10.3a | Reload the list tab | `<B_CONV2>`'s row is gone; `<B_CONV1>` and `<E_CONV>` remain; the list equals the new expected list (MIRROR). | |
| 10.3b | In the second tab (still showing `<B_CONV2>`), click "← All conversations" | The list without `<B_CONV2>` (client navigation fetches fresh data; no stale row). | |
| 10.3c | Press Back, then reload | 404. | |
| 10.3d | Console: `show('gone', await get(c, '<B_CONV2>'))` | `null`. | |
| 10.3e | Open `<B_CONV1>` | The job states are still all there (they belong to B). | |

---

## 11. Phone width (375 px)

Devtools device toolbar, 375 × 812, as C.

| # | Page | Expected | Pass/Fail |
|---|---|---|---|
| 11.1 | List | No horizontal page scroll (the tab strip scrolls sideways on its own; that's expected). Each row's "User" and "Last message … · N messages" wrap onto two lines cleanly. Long context values wrap. | |
| 11.2 | `<B_CONV1>` | The two boxes ("What Cube knows…", "Where they are on the jobs") **stack**. Job names and markers wrap without overlapping. User bubbles at most ~85% wide, right-aligned. | |
| 11.3 | `<E_CONV>` (with 5.6's long text) | The long URL and the long run wrap inside the bubble; no horizontal page scroll. | |
| 11.4 | Tap targets | Every list row is one big tap target; "← All conversations" is reachable. | |

---

## 12. Keyboard (desktop width)

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.1 | On the list, Tab from the address bar | Focus reaches the tabs, then each row in order, with a visible focus ring (record if it is only the browser default). | |
| 12.2 | Enter on a focused row | Opens that conversation. | |
| 12.3 | Tab to "← All conversations", Enter | Back to the list. | |

---

## 13. Cube 1.0 unaffected

### 13.1 Flag on

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 13.1a | As B, open `/explore`, `/analyse`, `/contribute` | Each redirects to `/companion` (unchanged from Slice 1). | |
| 13.1b | `git diff --stat` | Only `app/companion/[slug]/conversations/page.tsx` and `components/companion-v2/StateMarker.tsx` among tracked files. No Cube 1.0 file, no `proxy.ts`, no `lib/roles.ts`, no `app/api/chat/route.ts`, no migration. | |

### 13.2 Flag off

Comment out `NEXT_PUBLIC_CUBE_VERSION` in `.env.local` and restart `npm run dev`.

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 13.2a | As B: nav | Explore, Analyse, Contribute (Admin for A). No Companion, no Recent conversations. | |
| 13.2b | `/explore` | Library cards load; open one card (no chat message). | |
| 13.2c | `/analyse`, `/contribute` | Each page loads with its usual content or access message. **Don't send a message** (model call). | |
| 13.2d | As C: `/companion/low-resource-language/conversations` and `…/conversations/<B_CONV1>` | 404 both. | |

### 13.3 Flag off: does a 404 still join? (record, then clean)

As postgres, confirm D has **no** row on the main playbook (1.1). Sign in as **D** and open
`/companion/low-resource-language/conversations` (flag still off). Then:

```sql
select m.id, m.member_role, m.created_at from playbook_members m
where m.user_id = '<D>' and m.playbook_id = '<LRL_ID>';
```

| Expected | Pass/Fail |
|---|---|
| The page is a 404. **Record** whether a row now exists (Findings F4: the `[slug]` layout may still run `getWorkspace`'s self-join while the parent layout 404s). If one exists and has no conversations, delete it: `delete from playbook_members where user_id = '<D>' and playbook_id = '<LRL_ID>' returning id;` | |

Put `NEXT_PUBLIC_CUBE_VERSION=2` back and restart.

---

## 14. Whole run

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 14.1 | Dev-server log | `[companion-v2]` lines only during section 3 (about 9–10; none with 3.6). No 500s. | |
| 14.2 | Browser console, every page | No React errors (hydration, key warnings) and no uncaught rejections. The "Multiple GoTrueClient" warning from HELPERS is fine. | |

---

## 15. Things to record

Not pass/fail by themselves.

| Measure | Details |
|---|---|
| 3.x or 3.6 used; number of model calls | |
| 2.2d / 7.2e / 13.3: which 404 visits created a member row | |
| 9.1j: upper-case id renders or 404s | |
| A conversation with **0 messages** in the list (e.g. a greeting that failed): what it shows (expected: "No messages yet"; Findings F2) | |
| Whether two rows can be told apart as the same person (same context, same job states; Findings F3) | |
| 12.1: focus ring visible or browser default only | |
| Total adopter rows in the main playbook's list at the end | |

---

## 16. Clean up (test project only)

### 16.1 The `qa-empty` playbook (as postgres)

```sql
delete from playbooks where slug = 'qa-empty' returning id;
```

(Cascades C's contributor row there.)

### 16.2 The injected state and context (as postgres)

```sql
delete from member_job_states where member_id = '<B_MEMBER>' and job_code = 'QA9' returning job_code;
update companion_conversations
set context = context - 'email' - 'name' - 'user_id'
where id = '<B_CONV1>' returning context;
```

### 16.3 Optional

- B's S4 state: clear it from the job sheet (**Clear**) or leave it.
- The QA-5 conversations of B, E and C: delete them from each person's sidebar (🗑), or leave them
  (test text only). D's 7.1 conversation, if you created it: delete as postgres
  (`delete from companion_conversations where id = '<D_CONV>'`) or leave it for later slices.

| Expected | Pass/Fail |
|---|---|
| 16.1 returns one id; 16.2 returns `QA9` and a context with only the four allowed keys. | |

---

## Acceptance criteria to steps

| Slice 5 acceptance criterion / requested check (plan and brief) | Steps | Pass/Fail |
|---|---|---|
| The contributor sees adopter conversations labelled "User", with their context and markers | 4.1–4.4, 5.2, 5.3, 5.4 | |
| …and no names, emails or user ids; **network responses included** (RSC payload, page source, RPC JSON from devtools) | 4.2, 5.2b, 6.1, 6.2, 6.3, 6.4 | |
| Context and job-state markers match the database, including a state **set by the person** and a job code **no longer in the playbook** | 5.1, 5.2b–g, 5.3b, 5.4b, 5.5 | |
| Dates shown in IST | 4.6, 5.2a (midnight crossing), 5.2h | |
| Two adopter accounts chatting | 3.1–3.3 (or 3.6), 4.1, 5.4 | |
| An adopter's "Start a new conversation" shows as a separate row | 3.2, 3.5, 4.1, 4.5, 5.3 | |
| A contributor's own adopter-tab (Home) chats are not listed | 3.4, 4.1, 6.3d | |
| An adopter gets a 404 on `/conversations` (and on `/conversations/<id>`) | 2.2a–c, 9.2 | |
| A contributor to one playbook sees no conversations from another: via the URL under either slug | 7.2a–d, 8.3b | |
| …and via direct RPC calls with the other playbook's ids | 7.3a, 7.4 (plus 7.3b–f for adopters, pending, anon) | |
| Opening `/companion/test-playbook/conversations/<id>` for a playbook they don't contribute to returns a 404 | 7.2b, 7.2c | |
| Invalid and random UUIDs give a 404 | 9.1 | |
| An empty playbook shows "No conversations yet" | 8.2 | |
| Deleting an adopter's conversation (from their sidebar) removes it from the list (Slice 3 row) | 10 | |
| 375 px layout | 11 | |
| Cube 1.0 unaffected | 13 | |
| Admin, pending and signed-out access | 2.2d–f | |
| Hostile content renders as text | 5.6 | |
| Clean up | 16 | |

---

## Findings

From reading the code for this script (nothing was run). None blocks the acceptance rows above;
F1 is the one worth a decision before real adopters use this.

**F1. "Not a contributor's chat" is decided by the role *now*, not when the chat happened (medium,
risk).** Both RPCs filter on the member's **current** `member_role = 'adopter'`
(`supabase/migrations/0036_cube2_companion.sql:289` and `:329`). So:
(a) when an admin removes a contributor who has conversations, the route demotes them to `adopter`
instead of deleting the row (`app/api/admin/playbook-members/route.ts:63-64`), and all their test
chats from when they were a contributor appear in the viewer as "User";
(b) when an admin adds an adopter as a contributor (`route.ts:45`, an upsert onto the same row), all
their real adopter conversations disappear from every contributor's view, and their job states go
with them. The plan's rule ("a contributor's own test chats are excluded") holds only while nobody's
role changes.
- Given contributor C has a Home conversation in the main playbook
- When an admin removes C as a contributor (C becomes an adopter)
- Then C's conversations from while they were a contributor do not appear in `contributor_list_conversations`
- And (for the reverse case) an adopter later made a contributor still has their earlier adopter conversations listed, or the product decides explicitly that they vanish

**F2 (fixed for empty conversations: the row now shows "No messages yet" instead of a "Last message" time; greeting-only conversations are still listed). Empty and greeting-only conversations are listed, and "Last message" is wrong for them
(low).** A row is created before any message: on first Home load (`lib/companion-v2/use-companion-chat.ts:225`)
and on "Start a new conversation" (`:326`), then the hidden greeting is a model call
(`:310`). If that call fails or the daily cap is hit, the list shows a row with "0 messages" whose
"Last message …" (`components/companion-v2/conversations/ConversationList.tsx:30`) is really the
creation time, and its detail page says "No messages." (`ConversationView.tsx:78`). Every successful
greeting also makes a "1 message" row for someone who never typed. Noise rather than a leak.
- Given a conversation with 0 messages (or only Cube's greeting)
- When a contributor opens the Conversations list
- Then it is either not listed, or shown without a "Last message" time (for example "No messages yet · started …")

**F3. Rows from the same person can be linked (low, observation).** "Start a new conversation"
copies the context (`use-companion-chat.ts:326`), and the detail page shows the person's job states
from all their conversations (`0036_cube2_companion.sql:316-324`, keyed on `member_id`). A
contributor can therefore tell that two "User" rows are the same person. Nothing identifying is
exposed, and the UI says "From all their conversations", so this matches Decision 4 as written;
record it in case "anonymous" was meant to include "unlinkable".

**F4. Opening a 404 conversations URL can still join the visitor to that playbook (low).**
`requireContributor` calls `getWorkspace`, which self-joins any approved caller as an adopter
**before** the contributor check (`lib/companion-v2/server.ts:70-82`, `:136-139`); the `[slug]`
layout does the same (`app/companion/[slug]/layout.tsx:14`). So a contributor of playbook A who
probes `/companion/test-playbook/conversations/<id>` becomes an adopter member of `test-playbook`
(7.2e), and an admin who isn't a contributor becomes an adopter of any playbook whose
Conversations URL they open (2.2d). By design for Home (Decision 6), but surprising from a page that
returns 404. 13.3 checks whether the same happens with the flag **off** (the parent
`app/companion/layout.tsx:10` 404s, but Next may still render the nested layout).
- Given an approved user who is not a member of a listed playbook
- When they open `/companion/<slug>/conversations` or `/conversations/<id>`
- Then they get a 404 and no `playbook_members` row is created

**F5. No paging on the list or the transcript (low).** `contributor_list_conversations` returns
every adopter conversation (`0036_cube2_companion.sql:265-291`), and PostgREST's `max_rows`
(1000 by default; `supabase/config.toml:18` for a local stack) cuts the result **silently** past
that. The detail page renders every message at once. Fine for the test's scale.

**F6. A context value that isn't a string is hidden in the page but present in the RPC JSON
(low).** `filter_companion_context` keeps any JSON type for the four keys (`0036:136-144`), while
`contextEntries` shows only non-empty strings (`lib/companion-v2/conversations.ts:38`). A model that
writes `"done": ["…", "…"]` would show "Nothing known…" on the page while the data is there. Check
whether the `<ui_action>` parser already forces strings; if so this is moot.

**F7. The transcript drops Cube's job cards and asset chips (low, observation).** The RPC returns
only `role`, `content` and `created_at` per message (`0036:310`), not `ui`, so where Cube's prose
relied on the inline next-step cards ("see the card below"), the contributor sees the prose alone.
Removed jobs are also shown only as "A job no longer in the playbook"
(`ConversationView.tsx:60`), so a contributor can't tell which removed job it was.

**F8. Untracked `supabase/.gitignore` and `supabase/config.toml` (housekeeping).** Generated by
`supabase init`; not part of Slice 5 and not needed by the app. `config.toml` holds only commented
or `env(...)` secrets, so committing it is safe, but it pins a local `project_id`. Decide whether to
commit them or add them to `.gitignore` before the Slice 5 commit, so they don't ride along by
accident.
