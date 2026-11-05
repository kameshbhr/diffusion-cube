# Cube 2.0 Slice 2: manual test script

Branch `cube-2`. This covers what Slice 2 delivers (see `docs/design/cube2-plan.md`, section 4 and
"Slice 2"): the `companion-v2` mode of `/api/chat` (`lib/companion-v2/handler.ts`), the prompt
(`content/companion-v2.md` plus `lib/companion-v2/prompt.ts`), the stream helper
(`lib/anthropic-stream.ts`), the `<ui_action>` parser (`lib/companion-v2/ui-action.ts`), the client
hook (`lib/companion-v2/use-companion-chat.ts`) and the Home chat with its four chips
(`components/companion-v2/CompanionChat.tsx`, `app/companion/[slug]/page.tsx`).

**Request format (after the code-review fixes).** The browser sends only the new message:
`{ mode:'companion-v2', role, playbookId, conversationId, message, kickoff, focusJob }`. The
server reads the history from `companion_messages` itself (the last 40, in order); any `messages`
field is ignored. `kickoff:true` must have no `message` and an empty conversation. Otherwise
`message` is required, non-empty after trimming, and at most 8,000 characters. **Every model
call counts toward the daily cap, including Cube's opening greeting.**

**Not covered here, because later slices build them:** the Jobs list and the job sheet (Slice 3),
so tapping a job card opens the Jobs placeholder. Also not covered: assets and asset chips (no
asset screen yet, so `showAssets` can't be exercised), contributor chat (`role:'contributor'` returns
501 by design), and the Conversations viewer.

**Already checked automatically, so not repeated here:** lint, types and build; a signed-out POST
to the mode returns 403; and a scripted 5-turn model conversation (caching works, `<ui_action>`
parses, no job codes in the text, both telephony figures, the absence line for an off-playbook
question). This script covers what needs a real browser, a real Supabase session and RLS, and the
dev-only failure switches.

**Cost.** The whole script makes about 35 Anthropic calls on the account in `.env.local`. Per the
Product Charter, that account was a free trial due to expire on 28-Oct-2026 (TD-16). The automated
run worked today, but if **every** call fails with a 401 or 403 before you reach section 9, check
the Anthropic account before recording failures.

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

### 0.2 `.env.local` values for this slice

These must already be set: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`.

Add or check:

```
NEXT_PUBLIC_CUBE_VERSION=2
```

Two optional values, used **only** in the sections that say so. Leave them out otherwise:

| Variable | Used in | What it does |
|---|---|---|
| `COMPANION_DAILY_MESSAGE_CAP=3` | Section 10 | Adopter messages per user per UTC day. Default 60 when unset (or not a positive number). |
| `COMPANION_V2_FAIL_AFTER_CHARS=200` | Section 9.5 | **Dev only.** Makes the stream fail after about 200 characters of reply. It is ignored when `NODE_ENV=production`. **Never set it on Vercel.** |

**Back up your real key before section 9.** Copy the `ANTHROPIC_API_KEY=...` line into a note
outside the repo. Section 9 replaces it with an invalid value for a while.

### 0.3 The dev server and its log line

```bash
npm run dev
```

Every `.env.local` change needs a restart (Ctrl+C, then `npm run dev`). The terminal running
`npm run dev` is the **dev-server log**. After every successful companion-v2 reply it prints one
line:

```
[companion-v2] stop=end_turn in=1234 cache_read=52341 cache_write=0 out=287
```

- `stop`: `end_turn` is normal. `max_tokens` means the reply was cut off (and its `<ui_action>`
  block is likely lost). Record it.
- `cache_read`: tokens read from the prompt cache. The first call after a 5-minute gap shows
  `cache_read=0` and a large `cache_write`. Every call within 5 minutes of the previous one should
  show `cache_read` > 0, roughly equal to that earlier `cache_write`.
- Failures print `[companion-v2] API error <status>: ...` (before streaming) or
  `[companion-v2] failed mid-stream: ...`.
- No line at all means the model was not called (correct for 400/403/404/429 responses).

### 0.4 Test accounts

Slice 1 deleted B and C (step 18) and suggested deleting D and P (step 19). **Use new addresses**
(plus-addressing works, for example `you+qa2-b@example.com`). A is the same admin as in Slice 1.

| Name | Purpose | Roles |
|---|---|---|
| **A** | Admin. Adds C as a contributor. | Listed in `ADMIN_EMAILS`, has a `user_roles` row |
| **B** | Main adopter. Runs the scripted conversation. **Brand new, never opened a playbook.** | `adopter` (automatic on sign-up) |
| **C** | Contributor to the main playbook | `adopter` |
| **D** | Second adopter, used for the daily cap and as "another user" | `adopter` |
| **P** | Pending user (no roles) | none |

### 0.5 Values to fill in as you go

| Placeholder | Value | Found in step |
|---|---|---|
| `<LRL_ID>` (low-resource-language playbook id) | | 1.1 |
| `<TEST_ID>` (test-playbook id) | | 1.2 |
| `<A>`, `<B>`, `<C>`, `<D>`, `<P>` (user ids) | | 1.4 |
| `<B_MEMBER>`, `<B_CONV>` (B's first conversation) | | 2.3 |
| `<D_MEMBER>`, `<D_CONV>` | | 10.2 |
| `<D_EMPTY_CONV>` | | 10.9 |
| `<B_LATEST>` (B's latest conversation) | | 11.0 |

### 0.6 SQL in the Supabase SQL Editor

Same rules as Slice 1, section 0.5:

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

### 0.7 The "snapshot" query (as postgres)

Several steps say "run the snapshot". It is:

```sql
select
  (select count(*) from companion_messages m
     join companion_conversations c on c.id = m.conversation_id
     where c.member_id = '<B_MEMBER>')                                   as messages,
  (select count(*) from companion_conversations where member_id = '<B_MEMBER>') as conversations,
  (select context::text from companion_conversations
     where member_id = '<B_MEMBER>' order by updated_at desc limit 1)   as latest_context,
  (select string_agg(job_code || '=' || state || '/' || set_by, ', ' order by job_code)
     from member_job_states where member_id = '<B_MEMBER>')             as job_states,
  (select count from companion_usage
     where user_id = '<B>' and role = 'adopter'
       and day = (now() at time zone 'utc')::date)                      as usage_today;
```

The usage counter resets at **midnight UTC (05:30 IST)**. Don't run sections 9 or 10 across that
boundary.

---

## 1. Pre-flight: data and accounts

### 1.1 The main playbook is seeded (as postgres)

```sql
select id, slug, listed,
       (select count(*) from playbook_jobs j where j.playbook_id = p.id) as jobs,
       length(source_doc) > 50000 as has_source_doc
from playbooks p order by slug;
```

| Expected | Pass/Fail |
|---|---|
| A `low-resource-language` row: `listed true`, `jobs 40`, `has_source_doc true`. **Copy its id into `<LRL_ID>`.** If it's missing, run Slice 1 section 5.1 first. | |

### 1.2 A second playbook exists

If `test-playbook` is not in the 1.1 result (Slice 1 step 19 deletes it), seed it again:

```bash
node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
  --json content/playbooks/low-resource-language.json \
  --source content/playbooks/low-resource-language.source.md \
  --slug test-playbook
```

As postgres:

```sql
update playbooks set title = 'TEST COPY: ' || title
where slug = 'test-playbook' and title not like 'TEST COPY:%'
returning id, slug, title;
select id from playbooks where slug = 'test-playbook';
```

| Expected | Pass/Fail |
|---|---|
| One id. **Copy it into `<TEST_ID>`.** | |

### 1.3 Create the accounts

- **B:** sign up through `/login` (6-digit code). **Do not open any playbook as B yet.**
- **C, D, P:** sign up the same way, or create them in Dashboard > Authentication > Users > Add
  user ("Auto confirm"), then as postgres:
  `insert into user_roles (user_id, role) select id, 'adopter' from auth.users where email = '<email>';`
- **D and P:** don't open any playbook until a step says so.

### 1.4 Look up the ids and make P pending (as postgres)

```sql
delete from user_roles where user_id = (select id from auth.users where email = '<P email>');
select u.email, u.id, array_agg(r.role) filter (where r.role is not null) as roles
from auth.users u left join user_roles r on r.user_id = u.id
where u.email in ('<A email>','<B email>','<C email>','<D email>','<P email>')
group by u.email, u.id order by u.email;
```

| Expected | Pass/Fail |
|---|---|
| 5 rows. B, C and D have `{adopter}`. P has `null`. **Copy the ids into `<A>`…`<P>`.** | |

### 1.5 Make C a contributor

As **A**: `/admin` > Playbook contributors > "Low-resource language AI adoption" > C's email >
**Add as contributor**.

As postgres:

```sql
select member_role from playbook_members where user_id = '<C>' and playbook_id = '<LRL_ID>';
```

| Expected | Pass/Fail |
|---|---|
| `contributor`. | |

### 1.6 Start the server with the flag on

`.env.local` has `NEXT_PUBLIC_CUBE_VERSION=2` and **neither** of the two optional variables. Start
`npm run dev`.

---

## 2. First visit (B)

### 2.1 Cube opens with one question

Sign in as **B**. Companion > open "Low-resource language AI adoption". **Don't type anything.**

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 2.1a | While loading | "Opening your conversation…", then three bouncing dots. | |
| 2.1b | Cube's opening message | One or two short greeting sentences, one line on what Cube can help with, then **exactly one question**, about B's situation (what has happened so far, where the work is, or B's part). No job codes, no framework terms. | |
| 2.1c | Below the message | The four chips, in this order: "Where do I start?", "What do I own, and what do I only track?", "How long will this take and what will it cost?", "What usually goes wrong, and how do I avoid it?" | |
| 2.1d | Top right | "Start a new conversation" is **not visible** (it appears only after B has sent a message). | |
| 2.1e | While streaming and after | No `<ui_action`, `<ui_ac`, `{"focusJobs"` or any JSON appears at any point. | |
| 2.1f | Footer | "Cube answers from this playbook and its source document only, and can be wrong." | |
| 2.1g | Dev-server log | One `[companion-v2] stop=end_turn ... cache_write=<large number>` line. (If you ran anything in the last 5 minutes, `cache_read` may already be > 0. That's fine.) | |

### 2.2 Reload before answering

Reload the page once.

| Expected | Pass/Fail |
|---|---|
| The same opening message shows. **No second greeting**, and no new log line (no model call on reload). | |

### 2.3 What was stored (as postgres)

```sql
select pm.id as member_id, c.id as conversation_id, c.context,
       (select count(*) from companion_messages m where m.conversation_id = c.id)                       as messages,
       (select count(*) from companion_messages m where m.conversation_id = c.id and m.role = 'user')   as user_rows,
       (select count(*) from companion_messages m where m.conversation_id = c.id and m.role = 'assistant') as assistant_rows,
       (select bool_or(m.content like '%<ui_action%') from companion_messages m where m.conversation_id = c.id) as leaked_block,
       (select coalesce(sum(u.count), 0) from companion_usage u where u.user_id = '<B>')                as usage_count
from playbook_members pm join companion_conversations c on c.member_id = pm.id
where pm.user_id = '<B>';
```

| Expected | Pass/Fail |
|---|---|
| **Exactly one** row (one conversation, even after the reload). `context {}`, `messages 1`, `user_rows 0`, `assistant_rows 1`, `leaked_block false`, `usage_count 1` (the greeting **is** counted; the reload added nothing). **Copy `member_id` into `<B_MEMBER>` and `conversation_id` into `<B_CONV>`.** | |

---

## 3. The scripted conversation (B, 8 turns)

Type each message **exactly** as written, one at a time, and wait for the reply to finish. Send
them even if Cube's question doesn't match: the script also tests that Cube doesn't re-ask a
question the person moved past. Send turn 1 within 5 minutes of 2.1 so the cache is warm.

### 3.1 Checks for every reply

Apply these to **every** reply, in addition to the per-turn checks in 3.2. Record any miss in the
tally in section 13.

| Code | Check |
|---|---|
| **G1** | Plain words, short: a few sentences or a short list. |
| **G2** | No job codes (P2, S4, I10 …), no "work area", "job type", and no stage labels (Explore, Define, Pilot, Scale) used as labels. "Pilot collection" as plain English is fine. |
| **G3** | At most **one** question, and only at the end. |
| **G4** | Never asks something it already asked earlier in this conversation. |
| **G5** | No `<ui_action>` text or JSON on screen, including while it streams. |
| **G6** | When it talks about a specific job: says whether the PMU **owns** or **tracks** it, and **who owns it**. |
| **G7** | Job cards under the reply (0 to 3): job name, a short "when", and an **Owns** (filled) or **Tracks** (outlined) pill. A card shows "In progress"/"Done"/… only if a state is recorded. |
| **G8** | Dev-server log: `stop=end_turn` and `cache_read` > 0 (if within 5 minutes of the previous call). |

### 3.2 The turns

| Turn | You send (exact) | Turn-specific expected | Pass/Fail |
|---|---|---|---|
| T1 | `We're just getting started. The District Collector has asked our PMU to run a project to bring Bhili onto voice AI in Nandurbar district, Maharashtra.` | Acknowledges. Asks **one** next intake question (what is already done, or B's part). **Does not** ask where the work is or which language. "Start a new conversation" now appears top right. Chips are gone. **Log: `cache_read` > 0** (acceptance: "the second turn shows cache_read > 0"). | |
| T2 | `The Collector confirmed Bhili as the language in writing last week. We haven't decided the script or which dialect to start with yet.` | Acknowledges the language is confirmed and that script and dialect are still open. If it names that job ("Confirm target language and starting scope"), it says the PMU **tracks** it and that the District Collector, Nodal Officer, DC's Office and a Linguistic Expert own it. If a card for that job shows, it reads **"In progress"**, not "Done". | |
| T3 | `I lead the PMU. My job is to coordinate between the Collector's office, the Nodal Officer and the vendors.` | Intake is now complete: **no more questions about B's situation** from here on. Offers the next two or three steps (not the whole plan), each with Owns/Tracks and owner. 1–3 job cards. | |
| T4 | `What do I own, and what do I only track?` **Press Enter twice quickly.** | Only **one** copy of the message appears, and only one request goes out (devtools > Network). The composer is empty while Cube replies and stays empty afterwards (it isn't refilled by the second Enter). Lists what the PMU owns. Compare with the **11 Owns jobs** in section 13.3: every job it says the PMU owns must be on that list, and the list should be complete or clearly say "and N more". It says the PMU tracks everything else (it may summarise instead of listing all 29). **Fail** if it says the PMU owns, for example, "Confirm target language and starting scope", "Secure consent and data-protection compliance" or "Collect speech and text". | |
| T5 | `How much of our audio should come over phone calls, and what's the minimum amount of data we need for a first working model?` | **Telephony:** gives **both** 50% (playbook) **and** at least 25% (the district checklist), and says they differ, without picking one. **Minimum volume:** gives **both** about 300 hours of audio and 200,000 translation pairs (playbook) **and** about 60–100 hours of speech and 25,000–40,000 translated sentences (checklist, first gate), and says they differ. Ideally says these figures still need checking. Says the PMU **owns** designing the data collection plan, with the Nodal Officer, the Data Collection Agency and EkStep. No figure that isn't one of these. | |
| T6 | `How many hours of studio recording do we need for the voice, and who arranges the studio?` | **Both** figures: 5–10 hours per speaker (checklist) **and** about 20 hours in total (the budget reference), and says they differ. Studio space: the checklist has the Nodal Officer allocating government rooms and microphones. Recording sits under collecting speech and text, which the Data Collection Agency, Nodal Officer and Super Reviewer own; the PMU **tracks** it. | |
| T7 | `Update: the Nodal Officer was appointed on Monday and we've set up the WhatsApp group for coordination. The rest of the PMU team isn't on board yet.` | Acknowledges. The job is "Appoint the Nodal Officer and stand up the PMU": PMU **owns** it with the District Collector, Nodal Officer and DC's Office. Its card (if shown) reads **"In progress"**, not "Done". | |
| T8 | `Which GPU should we buy to train the model?` | Says plainly that **neither the playbook nor the source document covers this** (same meaning, close wording). **No** GPU name, spec or price. It may add who handles model work in the playbook, nothing more. No card required. | |

---

## 4. Database checks after the conversation (as postgres)

### 4.1 Messages

```sql
select row_number() over (order by m.created_at) as n, m.role,
       left(m.content, 70)              as starts,
       m.ui is not null                 as has_ui,
       m.content like '%<ui_action%'    as leaked_block,
       m.content like '%"focusJobs"%'   as leaked_json
from companion_messages m
where m.conversation_id = '<B_CONV>'
order by m.created_at;
```

| Expected | Pass/Fail |
|---|---|
| **17 rows**: row 1 `assistant` (the opening), then `user`/`assistant` alternating for T1–T8. User rows have `has_ui false`. Assistant rows have `has_ui true` (a `false` means that reply had no valid block: note which turn). `leaked_block` and `leaked_json` are `false` on every row. User texts match what you typed. | |

### 4.2 Codes and framework words in Cube's text

```sql
select row_number() over (order by m.created_at) as n,
       m.content ~ '\m[PSIE]([1-9]|1[0-4])\M'       as job_code,
       m.content ~* '(work area|job type)'          as framework_words,
       m.content ~  '\m(Explore|Define|Pilot|Scale)\M' as stage_word_read_it
from companion_messages m
where m.conversation_id = '<B_CONV>' and m.role = 'assistant'
order by m.created_at;
```

| Expected | Pass/Fail |
|---|---|
| `job_code false` and `framework_words false` on all 9 rows. For any `stage_word_read_it true`, read that message: **fail only** if the word is used as a stage label ("you're in the Pilot stage", "during Define"). | |

### 4.3 Context holds only the four keys

```sql
select context,
       (select array_agg(k order by k) from jsonb_object_keys(context) k) as keys,
       context - array['stage','location','done','role_note']            as other_keys
from companion_conversations where id = '<B_CONV>';
```

| Expected | Pass/Fail |
|---|---|
| `other_keys = {}`. `keys` is a subset of `{done, location, role_note, stage}`, and after T1–T3 should include **at least** `location` and `role_note` (acceptance: "after 2–3 answers, context is filled"). `location` mentions Nandurbar, Maharashtra and Bhili. `done` mentions the language being confirmed (and may mention the Nodal Officer after T7). `role_note` mentions leading the PMU or coordinating. Each value is a few words, in B's terms. | |

### 4.4 Job states: only what B said

```sql
select job_code, state, note, set_by from member_job_states
where member_id = '<B_MEMBER>' order by job_code;
```

| Expected | Pass/Fail |
|---|---|
| **Exactly two rows**, both `set_by = cube`: **`I2` `in_progress`** (note about the Nodal Officer being appointed / team not on board), and **`P2` `in_progress`** (note about Bhili confirmed, script and dialect open). `P2 done` is a FAIL: B said only part is done. | |
| **No row** for `S4` (B asked a general question about it in T5 and T6), `S7` (T6), `S11` or `E9` (never mentioned). Any extra row: copy its job, state and note into the tally in 13.1. | |

### 4.5 Which reply recorded what

```sql
select row_number() over (order by created_at) as n,
       ui->'jobUpdates' as job_updates, ui->'focusJobs' as cards, ui->'context' as context_patch
from companion_messages
where conversation_id = '<B_CONV>' and role = 'assistant' order by created_at;
```

| Expected | Pass/Fail |
|---|---|
| `job_updates` is `[]` on every row except row 3 (the T2 reply: `P2`) and row 8 (the T7 reply: `I2`). `cards` hold real job codes only, at most 3. | |

### 4.6 Usage and logging

Run the snapshot (0.7).

| Expected | Pass/Fail |
|---|---|
| `usage_today = 9` (the opening greeting plus the 8 turns). If you retried anything, add one per extra attempt. | |
| If `GOOGLE_SHEET_ID` is set: the Sheet has **no** new row from these turns (companion-v2 never logs). | |

---

## 5. Job state changes

### 5.1 Turn 9: Cube moves a state forward when the user says so

As B, send:

`The script and dialect are settled too: we're using Devanagari and starting with the Dehwali dialect.`

As postgres, re-run the 4.4 query.

| Expected | Pass/Fail |
|---|---|
| `P2` is now `done`, `set_by cube`, with a note in B's words. `I2` unchanged. Still no `S4` row. | |

### 5.2 The user's own correction is protected, through the chat

**(a) B marks the data collection plan as skipped** (impersonating B, **commit**). This is what the
Slice 3 job editor will do.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
insert into public.member_job_states (member_id, job_code, state, note, set_by)
values ('<B_MEMBER>', 'S4', 'skipped', 'QA: user says EkStep is doing this for us', 'user')
on conflict (member_id, job_code)
  do update set state = excluded.state, note = excluded.note, set_by = 'user'
returning job_code, state, note, set_by, updated_at;
commit;
```

| Expected | Pass/Fail |
|---|---|
| One row: `S4`, `skipped`, the QA note, `user`. **Copy `updated_at`.** | |

**(b) B tells Cube it's done.** Send:

`We've finished the data collection plan: the requirements study and the technical specification are both done.`

As postgres:

```sql
select job_code, state, note, set_by, updated_at from member_job_states
where member_id = '<B_MEMBER>' and job_code = 'S4';
select count(*) as messages from companion_messages where conversation_id = '<B_CONV>';
```

| Expected | Pass/Fail |
|---|---|
| `S4` is **still `skipped`, `set_by user`**, same note, same `updated_at` as in (a). | |
| `messages = 21` (19 after 5.1, plus this turn). The turn itself was stored normally: no error on screen. | |
| (Observe, not pass/fail) Did Cube's reply mention that B had marked it as not being done? Did the `<ui_action>` include an `S4` update anyway? `select ui->'jobUpdates' from companion_messages where conversation_id = '<B_CONV>' and role = 'assistant' order by created_at desc limit 1;` | |

### 5.3 The same protection, at the database level (impersonating B, rollback)

5.2 can pass just because Cube chose not to send an update. This calls the store function directly
with a Cube update for `S4`:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
select public.record_companion_turn('<B_CONV>', 'QA direct', 'QA direct reply', null, '{}'::jsonb,
  '[{"job":"S4","state":"done","note":"QA: Cube tries to overwrite"}]'::jsonb);
select job_code, state, note, set_by from public.member_job_states
where member_id = '<B_MEMBER>' and job_code = 'S4';
rollback;
```

| Expected | Pass/Fail |
|---|---|
| `S4`, `skipped`, the QA note from 5.2(a), `user`. (Rolled back, so the QA messages are not kept.) | |

### 5.4 Put S4 back (as postgres)

```sql
delete from member_job_states where member_id = '<B_MEMBER>' and job_code = 'S4' returning job_code;
```

---

## 6. Reload keeps history and cards

As B, reload the page. Then open the same URL in a second tab.

| Expected | Pass/Fail |
|---|---|
| Both tabs show the whole conversation in order: the opening, T1–T8, turn 9 and the 5.2(b) turn. No new greeting, no new log line. | |
| The job cards under each reply are back, with the same jobs as before the reload, each with its Owns/Tracks pill. The "Confirm target language and starting scope" card (wherever it appears) now reads **Done**; the "Appoint the Nodal Officer…" card reads **In progress**. | |
| As postgres, the snapshot shows the same `messages` and `conversations = 1` as before the reload. | |

Close the second tab.

---

## 7. "Start a new conversation" and the chips (B)

### 7.1 A new conversation keeps what Cube knows

Click **Start a new conversation**.

| Expected | Pass/Fail |
|---|---|
| The screen clears. Cube greets in **one** short sentence and asks what B would like to work on now. It does **not** ask where the work is, which language, what's done or B's part. The four chips show. | |

As postgres:

```sql
select c.id, c.started_at, c.context,
       (select count(*) from companion_messages m where m.conversation_id = c.id) as messages
from companion_conversations c where c.member_id = '<B_MEMBER>' order by c.started_at;
```

| Expected | Pass/Fail |
|---|---|
| Two rows. The new row's `context` equals the first row's. The new row has `messages 1` (the greeting). Snapshot `usage_today` **+1** (the greeting is a counted model call). | |

### 7.2 Chip: "What do I own, and what do I only track?"

Tap the chip.

| Expected | Pass/Fail |
|---|---|
| The chip text appears as B's message. The chips disappear. The answer matches the 11 Owns jobs (section 13.3) and agrees with T4. G1–G8 hold. | |

### 7.3 Follow-up in the new conversation: no re-asking

Send: `Thanks. What should I push on this week?`

| Expected | Pass/Fail |
|---|---|
| Builds on what Cube knows (Bhili, Nandurbar, language and script settled, Nodal Officer appointed, PMU lead). It does **not** ask about B's situation (district, language, what's done, B's part). **If it does, record the exact question as a FAIL.** Expected to pass: when the stored history starts with Cube's greeting, the server now puts a neutral `[Cube opened this conversation.]` in front of it (`handler.ts:144-147`), not the first-visit instruction. | |

### 7.4 Chip: "How long will this take and what will it cost?"

Click **Start a new conversation**, then tap the chip.

| Expected | Pass/Fail |
|---|---|
| Timings come from the playbook (for example, full collection of 6–9 months in 2–3 rounds, about 9 months overall on the Nandurbar experience). Any cost figure comes from the budget reference and is called an estimate. **Fail** on any figure that isn't in the playbook or source document. Short: the next few steps' timings, not the full plan. | |

### 7.5 Chip: "What usually goes wrong, and how do I avoid it?"

Click **Start a new conversation**, then tap the chip.

| Expected | Pass/Fail |
|---|---|
| Points come from the playbook's insights, hard rules and gaps (said plainly, not quoted by section). Nothing from general AI knowledge. G1–G8 hold. | |

### 7.6 Phone width

Narrow the window to about 375 px (or devtools' phone view).

| Expected | Pass/Fail |
|---|---|
| Messages, job cards (one column), chips (wrapping) and the composer are usable. Nothing overlaps or is cut off. The composer stays at the bottom. | |

---

## 8. "Ask Cube about this job" (URL entry)

The Jobs page and its button arrive in Slice 3. The URL it will use already works.

### 8.1 A known job

As B, go to `/companion/low-resource-language?job=S4`.

| Expected | Pass/Fail |
|---|---|
| The address bar changes to `/companion/low-resource-language` (the `?job=` is removed). | |
| B's message appears automatically: `Tell me about "Design the data collection plan".` | |
| The reply is about that job: the PMU **owns** it with the Nodal Officer, the Data Collection Agency and EkStep; when it happens (the requirements study around week 2, the technical specification in weeks 4–5); and a short how. If it mentions the telephony share, minimum volume or studio hours, both figures appear. No "S4" in the text. A card for "Design the data collection plan" with an **Owns** pill. | |
| Snapshot: `usage_today` +1. As postgres, `select count(*) from member_job_states where member_id = '<B_MEMBER>' and job_code = 'S4';` is `0` (asking about a job is not a state). | |

### 8.2 Reload doesn't resend

Reload.

| Expected | Pass/Fail |
|---|---|
| The message is not sent again. No new log line. `usage_today` unchanged. | |

### 8.3 Unknown codes are ignored

Go to `/companion/low-resource-language?job=ZZ9`, then `/companion/low-resource-language?job=s4`.

| Expected | Pass/Fail |
|---|---|
| Nothing is sent in either case (the conversation already has messages, so there's no greeting either). No log line. Snapshot unchanged. (The `?job=` stays in the address bar for unknown codes. That's fine.) | |

### 8.4 Tapping a job card

Tap any job card.

| Expected | Pass/Fail |
|---|---|
| Opens `/companion/low-resource-language/jobs?open=<code>`, which shows the Jobs placeholder. (The job sheet is Slice 3.) | |

---

## 9. Failure paths (B)

Before each step, run the **snapshot** (0.7) and keep the numbers. Have devtools > Network open.

### 9.1 The model call fails before streaming

In `.env.local`, change the key line to:

```
ANTHROPIC_API_KEY=sk-ant-qa-invalid
```

Restart the dev server. Reload B's page. Send:

`What should we do in the first week of the pilot collection?`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.1a | Screen | B's message and the dots appear briefly, then **both disappear**. An alert reads "Cube couldn't answer just now. Please try again." with a **Retry** link. | |
| 9.1b | Composer | Contains exactly the text you sent. | |
| 9.1c | Network | `POST /api/chat` → **503**, body `{"error":"model_unavailable","message":"Cube couldn't answer just now. Please try again."}`. | |
| 9.1d | Dev-server log | `[companion-v2] API error 401: ...` (or similar). No `stop=` line. Record any `unhandledRejection` line. | |
| 9.1e | Snapshot | `messages`, `conversations`, `latest_context`, `job_states` **unchanged**. `usage_today` **+1** (by design, a failed turn still counts). | |

### 9.2 Retry while the key is still wrong

Click **Retry**.

| Expected | Pass/Fail |
|---|---|
| The same alert again. Snapshot: nothing stored, `usage_today` +1 again. | |
| **Composer:** Retry clears the composer **before** it resends (so while the retry runs, the composer is empty). When the retry fails, the text must **come back** into the composer. Empty composer after the failed retry = FAIL (minor; Retry still resends the right text). Developer note: by code reading the Retry link still only does `setDraft(''); chat.retry();` (`CompanionChat.tsx:232-233`) and ignores the result, so check this one carefully. | |

### 9.2b "Ask Cube about this job" fails

Still with the invalid key, go to `/companion/low-resource-language?job=S4`.

| Expected | Pass/Fail |
|---|---|
| The `?job=` is removed from the address bar. `Tell me about "Design the data collection plan".` and the dots appear briefly, then disappear. The retry alert shows, and the composer contains `Tell me about "Design the data collection plan".` | |
| Snapshot: nothing stored, `usage_today` +1. | |

Clear the composer before carrying on.

### 9.3 The opening greeting fails

Still with the invalid key, click **Start a new conversation**.

| Expected | Pass/Fail |
|---|---|
| The screen clears, then the retry alert appears with **no** greeting. The composer is empty. | |
| Snapshot: `conversations` +1, `messages` unchanged, `usage_today` **+1** (the greeting is counted, even when it fails). The new conversation has 0 messages. | |

### 9.4 Retry works after restoring the key

Put the real `ANTHROPIC_API_KEY` back and restart. **Don't reload the page.** Click **Retry**.

| Expected | Pass/Fail |
|---|---|
| Cube's short greeting appears (the new conversation's opening), with no intake questions. A log line with `stop=end_turn`. Snapshot: `messages` +1 (assistant only), `usage_today` **+1**. | |

Then send the 9.1 text again: `What should we do in the first week of the pilot collection?`

| Expected | Pass/Fail |
|---|---|
| A normal reply. Snapshot: `messages` +2, `usage_today` +1. | |

### 9.5 The stream fails part-way

Add to `.env.local` and restart:

```
COMPANION_V2_FAIL_AFTER_CHARS=200
```

Reload. Send a question with a long answer:

`Walk me through everything the language survey involves, step by step.`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 9.5a | Screen | About 200 characters of reply appear, then the reply **and** B's message disappear. The retry alert shows. (If the reply was finished in under 200 characters, nothing fails: ask again with a longer question.) | |
| 9.5b | Composer | Contains the text you sent. | |
| 9.5c | Network | `POST /api/chat` shows status **200**, but its response ends in an error (Chrome: "Failed to load response data" or `net::ERR_...`). | |
| 9.5d | Dev-server log | `[companion-v2] failed mid-stream: Error: Injected failure (COMPANION_V2_FAIL_AFTER_CHARS)`. No `stop=` line. | |
| 9.5e | Snapshot | Nothing stored. `usage_today` +1. | |

### 9.6 Retry after the mid-stream failure

Remove `COMPANION_V2_FAIL_AFTER_CHARS` from `.env.local` and restart. Don't reload. Click **Retry**.

| Expected | Pass/Fail |
|---|---|
| The full reply streams and stays. Snapshot: `messages` +2, `usage_today` +1. | |

### 9.7 Optional: the save step fails after a good reply

This checks that a reply the browser can't store leaves nothing behind. **Test project only.**
As postgres:

```sql
alter table companion_messages add constraint qa_block_inserts check (false) not valid;
```

As B, send `Who signs off at the gates?`

| Expected | Pass/Fail |
|---|---|
| The reply streams in full, then disappears. Alert: "Cube's reply couldn't be saved. Please try again." with Retry. The composer has the text. Snapshot: `messages`, `latest_context` and `job_states` unchanged; `usage_today` +1. | |

**Remove the constraint straight away** (as postgres):

```sql
alter table companion_messages drop constraint qa_block_inserts;
```

Click **Retry**.

| Expected | Pass/Fail |
|---|---|
| A normal reply that stays. Snapshot: `messages` +2. | |

### 9.8 Optional: the history can't be loaded

**Test project only.** As postgres, temporarily stop signed-in users from reading messages:

```sql
revoke select on public.companion_messages from authenticated;
```

As B, reload the page.

| Expected | Pass/Fail |
|---|---|
| The alert reads "Couldn't load your conversation. Please reload the page." No messages are shown, no greeting is sent (no log line), and the snapshot is unchanged. | |

**Restore the grant straight away** (as postgres), then reload as B:

```sql
grant select on public.companion_messages to authenticated;
```

| Expected | Pass/Fail |
|---|---|
| The conversation loads normally, with its history. | |

---

## 10. Daily cap (D)

### 10.1 Set the cap

Add to `.env.local` and restart:

```
COMPANION_DAILY_MESSAGE_CAP=3
```

### 10.2 First visit as D (counted: call 1)

Sign in as **D** in the other browser. Companion > open "Low-resource language AI adoption".

| Expected | Pass/Fail |
|---|---|
| Cube's opening message with one question; the four chips. | |

As postgres:

```sql
select pm.id as member_id, c.id as conversation_id,
       (select coalesce(sum(u.count), 0) from companion_usage u where u.user_id = '<D>') as usage_count
from playbook_members pm join companion_conversations c on c.member_id = pm.id
where pm.user_id = '<D>';
```

| Expected | Pass/Fail |
|---|---|
| One row, `usage_count 1` (the greeting counts). **Copy `<D_MEMBER>` and `<D_CONV>`.** | |

### 10.3 Calls 2 and 3 (also: a chip before any intake)

| # | As D | Expected | Pass/Fail |
|---|---|---|---|
| 10.3a | Tap **"Where do I start?"** | Cube answers **briefly** first (the first one or two steps), **then** asks one intake question. | |
| 10.3b | Send `We're in Nandurbar, working on Bhili.` | Normal reply. | |

As postgres:

```sql
select count from companion_usage where user_id = '<D>' and role = 'adopter'
  and day = (now() at time zone 'utc')::date;
```

| Expected | Pass/Fail |
|---|---|
| `3` (greeting + 2 messages). | |

### 10.4 Call 4 is refused without a model call

Because the greeting now counts, the fourth counted call is D's **third** message. Send:
`I'm with the PMU.`

| # | Check | Expected | Pass/Fail |
|---|---|---|---|
| 10.4a | Screen | D's message disappears. A calm notice reads: "You've reached today's limit for messages to Cube. It resets at midnight UTC." **No Retry link.** The composer is disabled. No chips. | |
| 10.4b | Network | `POST /api/chat` → **429**, body `{"error":"daily_limit","message":"You've reached today's limit for messages to Cube. It resets at midnight UTC."}`. | |
| 10.4c | Dev-server log | **No** new `[companion-v2] stop=` line (the model wasn't called). | |
| 10.4d | Usage query (10.3) | `4`. | |
| 10.4e | As postgres: `select count(*) from companion_messages where conversation_id = '<D_CONV>';` | `5` (opening + 2 turns). | |

### 10.5 A direct POST over the cap is refused (browser console)

In D's browser, devtools > Console:

```js
await fetch('/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'companion-v2', role: 'adopter', playbookId: '<LRL_ID>', conversationId: '<D_CONV>',
    message: 'Console message over the cap',
  }),
}).then(async r => [r.status, await r.text()]);
```

| Expected | Pass/Fail |
|---|---|
| `[429, '{"error":"daily_limit",...}']`. No log line. Usage query: `5`. | |

### 10.6 The same with curl

In devtools > Network, right-click the 429 `/api/chat` request > **Copy > Copy as cURL (bash)**.
Paste it into Git Bash, add ` -s -o /dev/null -w "%{http_code}\n"` at the end, and run it.

| Expected | Pass/Fail |
|---|---|
| `429`. No log line. Usage query: `6`. | |

### 10.7 The opening greeting is counted and refused over the cap

As D, reload, then click **Start a new conversation**.

| Expected | Pass/Fail |
|---|---|
| Reload: no new call (the conversation isn't empty), usage still `6`. | |
| Start a new conversation: the screen clears, **no greeting** appears, and the daily-limit notice shows (no Retry). Network: 429. No log line. Usage query: `7`. As postgres, D now has 2 conversations and the new one has 0 messages. | |

### 10.8 A failed turn counts

Covered in 9.1e, 9.2, 9.2b, 9.3 and 9.5e (each failed attempt added 1).

### 10.9 Repeated direct kickoffs are counted and refused

A kickoff is allowed only on an **empty** conversation, and a direct call stores nothing, so the
same empty conversation can be kicked off again and again. Each attempt must still count, and
must be refused once over the cap.

Create an empty conversation for D (impersonating D, **commit**):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<D>","role":"authenticated"}', true);
insert into public.companion_conversations (member_id, playbook_id)
values ('<D_MEMBER>', '<LRL_ID>') returning id;
commit;
```

Copy the id into `<D_EMPTY_CONV>`. In D's console, run this **twice**:

```js
await fetch('/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'companion-v2', role: 'adopter', playbookId: '<LRL_ID>',
    conversationId: '<D_EMPTY_CONV>', kickoff: true,
  }),
}).then(async r => [r.status, (await r.text()).slice(0, 120)]);
```

| Expected | Pass/Fail |
|---|---|
| Both times `[429, '{"error":"daily_limit",...}']`. **No** `stop=` log line. Usage query: `8`, then `9`. `<D_EMPTY_CONV>` still has 0 messages. | |

### 10.10 Reset

Remove `COMPANION_DAILY_MESSAGE_CAP` from `.env.local` and restart. As postgres (optional, so D can
chat again today):

```sql
delete from companion_usage where user_id = '<D>';
```

---

## 11. Access and malformed requests

None of these should reach the model or change any data.

### 11.0 Values (as postgres)

```sql
select c.id from companion_conversations c
where c.member_id = '<B_MEMBER>' order by c.updated_at desc limit 1;
select count(*) from playbook_members where user_id = '<B>' and playbook_id = '<TEST_ID>';
```

Copy the id into `<B_LATEST>`. The count must be `0` (B never opened TEST COPY). Run the snapshot
and keep `usage_today`.

### 11.1 As B (adopter), in B's browser console

```js
const PB = '<LRL_ID>', TEST = '<TEST_ID>', CONV = '<B_LATEST>', OTHER = '<D_CONV>';
const RANDOM = '11111111-2222-4333-8444-555555555555';
const post = (body) => fetch('/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}).then(async r => [r.status, (await r.text()).slice(0, 120)]);
// A valid body. It is never sent as is: every line below breaks it in one way.
const v = { mode: 'companion-v2', role: 'adopter', playbookId: PB, conversationId: CONV,
            message: 'QA: this must be refused' };
const run = async (label, body) => console.log(label.padEnd(26), ...(await post(body)));

await run('a contributor role',       { ...v, role: 'contributor' });
await run('b no role',                { ...v, role: undefined });
await run('c role admin',             { ...v, role: 'admin' });
await run('d playbook not uuid',      { ...v, playbookId: 'abc' });
await run('e not a member',           { ...v, playbookId: TEST });
await run('f unknown playbook',       { ...v, playbookId: RANDOM });
await run('g no conversation',        { ...v, conversationId: undefined });
await run("h D's conversation",       { ...v, conversationId: OTHER });
await run('i unknown conversation',   { ...v, conversationId: RANDOM });
await run('j missing message',        { ...v, message: undefined });
await run('k empty message',          { ...v, message: '' });
await run('l whitespace message',     { ...v, message: '   \n\t ' });
await run('m message 8001 chars',     { ...v, message: 'x'.repeat(8001) });
await run('n message a number',       { ...v, message: 42 });
await run('o kickoff with a message', { ...v, kickoff: true });
await run('p kickoff, not empty',     { ...v, message: undefined, kickoff: true });
await run('q old messages array only',{ ...v, message: undefined, messages: [{ role: 'user', content: 'hi' }] });
await run('r no mode',                { ...v, mode: undefined });
await run('s not JSON',               'not json');
```

| Line | Expected | Pass/Fail |
|---|---|---|
| a | `403 {"error":"Only contributors can update the playbook."}` | |
| b, c, d | `400 {"error":"Invalid request."}` | |
| e, f | `403 {"error":"Open the playbook first."}` | |
| g | `400 {"error":"Invalid request."}` | |
| h, i | `404 {"error":"Unknown conversation."}` | |
| j, k, l, m, n | `400 {"error":"Invalid request."}` (message missing, empty after trimming, over 8,000 characters, or not a string). | |
| o | `400 {"error":"Invalid request."}` (a kickoff must have no message). | |
| p | `400 {"error":"Invalid request."}` (`<B_LATEST>` already has messages). | |
| q | `400 {"error":"Invalid request."}` (the `messages` array is ignored, so there is no message). | |
| r | `400 {"error":"Unknown mode."}` | |
| s | `500` (Next's error page). The route parses the body before anything else, the same as before this branch and for every mode. Pre-existing, not a Slice 2 regression; note it only. | |

Then:

| Expected | Pass/Fail |
|---|---|
| No `[companion-v2] stop=` line for any of these. Snapshot: everything unchanged, **including `usage_today`** (every one of these is refused before the usage counter). As postgres, B still has `0` rows in `playbook_members` for `<TEST_ID>` (the API never joins). D's conversation `<D_CONV>` still has the same message count as in 10.4e. | |

### 11.2 As C (contributor), in C's browser console

Sign in as C (any `localhost:3000` page), then paste the `post` and `run` helpers from 11.1 (only
the `RANDOM`, `post` and `run` lines), and:

```js
const c = { mode: 'companion-v2', role: 'contributor', conversationId: RANDOM, message: 'Edit a job' };
await run('C, own playbook',   { ...c, playbookId: '<LRL_ID>' });
await run('C, other playbook', { ...c, playbookId: '<TEST_ID>' });
```

| Line | Expected | Pass/Fail |
|---|---|---|
| own playbook | `501 {"error":"Update with Cube is not available yet."}` (contributor chat is Slice 4d). | |
| other playbook | `403 {"error":"Open the playbook first."}` | |

### 11.3 As P (pending), in P's browser console

Sign in as P, paste the 11.1 helpers (`RANDOM`, `post`, `run`), then:

```js
await run('P pending', { mode: 'companion-v2', role: 'adopter', playbookId: '<LRL_ID>',
  conversationId: RANDOM, message: 'hi' });
```

| Expected | Pass/Fail |
|---|---|
| `403 {"error":"Your account is awaiting approval."}`. As postgres, P has no `playbook_members` and no `companion_usage` rows. | |

---

## 12. Cube 1.0 is unchanged with the flag off

Comment out `NEXT_PUBLIC_CUBE_VERSION` in `.env.local` (`# NEXT_PUBLIC_CUBE_VERSION=2`) and
restart. Sign in as B (B has `adopter`).

| # | Do | Expected | Pass/Fail |
|---|---|---|---|
| 12.1 | Nav | Explore, Analyse, Contribute (no Companion). | |
| 12.2 | Go to `/analyse`, start a conversation, send `We're a district office in Maharashtra planning a voice helpline in a tribal language.` | The reply streams as before this branch. No `<grid_update>` text on screen. The Grid button opens the grid table. The dev-server log has **no** `[companion-v2]` line. | |
| 12.3 | Reload `/analyse` | The conversation is still there (Cube 1.0 persistence works). | |
| 12.4 | Console: `await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'companion-v2',role:'adopter',playbookId:'<LRL_ID>',conversationId:'<B_LATEST>',message:'hi'})}).then(async r=>[r.status,await r.text()])` | `[400, '{"error":"Unknown mode."}']`. | |
| 12.5 | Go to `/companion` | 404. | |

Put `NEXT_PUBLIC_CUBE_VERSION=2` back and restart.

---

## 13. Things to watch and record (prompt quality)

Not pass/fail by themselves: these numbers tell us whether `content/companion-v2.md` needs work.
Fill them in across **all** replies in sections 2–10 (about 25 replies).

### 13.1 Job states Cube recorded that the user didn't state

List every `member_job_states` row for B and D (as postgres):

```sql
select u.email, s.job_code, s.state, s.note, s.set_by, s.updated_at
from member_job_states s join playbook_members m on m.id = s.member_id
join auth.users u on u.id = m.user_id
where m.user_id in ('<B>','<D>') order by u.email, s.updated_at;
```

| Measure | Count / details |
|---|---|
| Rows that match something the user said (expected: B's `P2`, `I2`; any D rows from 10.3) | |
| Rows the user did **not** state (job, state, note, which turn) | |
| `done` where the user said only part was done | |
| A state from a general question (for example T5, T6, 8.1) | |

### 13.2 Questions

| Measure | Count / details (turn and the question) |
|---|---|
| Replies with more than one question | |
| A question repeated from earlier in the same conversation | |
| An intake question after T3, or after "Start a new conversation" | |

### 13.3 "What do I own, and what do I only track?" against the Owns list

The PMU owns these **11** jobs (from `content/playbooks/low-resource-language.json`, where
`body.owners` includes "PMU"), in sequence order. It tracks the other 29.

| # | Job (owned with) | T4 | 7.2 |
|---|---|---|---|
| 1 | Map what already exists (with the Data Collection Agency, District Collector, Nodal Officer) | | |
| 2 | Understand the language community and the access gap (with the Data Collection Agency, Nodal Officer, Technical Partner, Linguistic Expert) | | |
| 3 | Appoint the Nodal Officer and stand up the PMU (with the District Collector, Nodal Officer, DC's Office) | | |
| 4 | Design the data collection plan (with the Nodal Officer, Data Collection Agency, EkStep) | | |
| 5 | Write the scope and requirements document (with the Nodal Officer, DC's Office) | | |
| 6 | Select and contract partners (with the District Collector, Steering Committee, DC's Office) | | |
| 7 | Measure progress, quality and real use (with the Data Collection Agency, District Collector) | | |
| 8 | Decide at the gates and sign off (with the Core Application Owner, Nodal Officer, Super Reviewer, Department of Agriculture) | | |
| 9 | Secure lasting ownership and continuity (with the District Collector, Technical Partner) | | |
| 10 | Document and share the playbook (PMU alone) | | |
| 11 | Capture usage gaps and keep improving (with the Technical Partner) | | |
| | **Jobs it said the PMU owns that are not on this list** | | |

Three jobs have **no named owner**: "Secure funding", "Set goals and the output tier" and "Design
the voice experience for low-literacy users". Optional probe (one model call), as B:
`Who owns securing the funding?` Expected: the playbook doesn't name an owner; the PMU tracks it.
No guess.

| Probe result | |
|---|---|

### 13.4 Other checks

| Measure | Count / details |
|---|---|
| Replies with a job code or framework term (4.2, and by eye elsewhere) | |
| A conflicting figure given with only one value (telephony share, minimum volume, studio hours) | |
| A figure or fact not in the playbook or source document | |
| Off-playbook question not answered with the plain absence line | |
| Replies over about 200 words | |
| `stop=max_tokens` in the log | |
| Calls within 5 minutes of the previous one with `cache_read=0` | |
| `has_ui false` on an assistant row (block missing or invalid) | |

---

## 14. Clean up (test project only)

- `.env.local`: the real `ANTHROPIC_API_KEY` is back; `COMPANION_DAILY_MESSAGE_CAP` and
  `COMPANION_V2_FAIL_AFTER_CHARS` are **gone**; `NEXT_PUBLIC_CUBE_VERSION=2` is on. Restart.
- If you ran 9.7, confirm the constraint is gone (as postgres; expect `0`):
  `select count(*) from pg_constraint where conname = 'qa_block_inserts';`
- Usage rows (as postgres): `delete from companion_usage where user_id in ('<B>','<D>');`
- Keep B, C and D if Slice 3 follows (B's job states and conversations are useful there).
  Otherwise delete D and P in Dashboard > Authentication > Users.

---

## Acceptance criteria to steps

| Slice 2 acceptance criterion (plan) | Steps | Pass/Fail |
|---|---|---|
| A first visit opens with Cube asking one question | 2.1, 2.2, 10.2 | |
| … a conversation row exists; the opening is stored as an assistant message only | 2.3 | |
| After 2–3 answers, `context` is filled | T1–T3, 4.3 | |
| Chips work | 2.1c, 7.2, 7.4, 7.5, 10.3a | |
| Plain language, no job codes or framework terms | 3.1 (G1, G2) on every reply, 4.2, 13.4 | |
| Says Owns or Tracks plus the owner | T2–T7, 7.2, 8.1, 13.3 | |
| Both figures for telephony share and minimum volume (and studio hours) | T5, T6 | |
| Off-playbook question gets the plain absence statement | T8 | |
| `<ui_action>` never appears on screen | 2.1e, G5, 4.1 (`leaked_block`, `leaked_json`) | |
| Its job updates appear in `member_job_states`, only for what the user said | 4.4, 4.5, 5.1, 13.1 | |
| (Plan test 3) "we've already confirmed the language" → language job recorded; S4 not mentioned → no row | T2, 4.4, 5.1 | |
| User correction is never overwritten by Cube | 5.2, 5.3 | |
| Second turn shows `cache_read_input_tokens > 0` | T1 (G8) | |
| "Start a new conversation" keeps context, no re-asked intake | 7.1, 7.3 | |
| Reload keeps history and cards | 2.2, 6 | |
| "Ask Cube about this job" (`?job=`) | 8.1–8.3 | |
| API failure before streaming: retry message, text back, no rows | 9.1, 9.2, 9.2b, 9.3 | |
| Composer: a double Enter sends once; a failed turn (and a failed Retry) puts the text back | T4, 9.1b, 9.2, 9.2b, 9.5b | |
| API failure mid-stream: same | 9.5 | |
| Retry then works normally | 9.4, 9.6 | |
| A failed save stores nothing | 9.7 (optional) | |
| A failed history load shows "Couldn't load your conversation. Please reload the page." | 9.8 (optional) | |
| Daily cap 3: 4th counted call (greeting + 2 messages + this one) refused, no model call, `count = 4` | 10.2–10.4 | |
| Every model call counts, the opening greeting included; a greeting over the cap is refused | 2.3, 4.6, 7.1, 9.3, 9.4, 10.2, 10.7 | |
| A failed turn still counts | 9.1e, 9.2, 9.2b, 9.3, 9.5e | |
| Direct POST counts and is refused over the cap, including repeated direct kickoffs | 10.5, 10.6, 10.9 | |
| (Plan test 4) Adopter posting `role:'contributor'` → 403 | 11.1a | |
| Contributor → 501 (not built yet); non-member → 403; another user's conversation → 404; malformed (missing, empty, over-long or non-string message; kickoff with a message or on a non-empty conversation; old `messages` array only) → 400 | 11.1, 11.2, 11.3 | |
| Cube 1.0 `/analyse` still works with the flag off | 12 | |
| No Google Sheets logging for companion-v2 | 4.6, 12.2 | |
