# Cube 2.0 slices 6b and 6c: Digest test script

Spec: `docs/design/cube2-plan.md` section 9 ("Part 2", "Migration 0037", "Choices made while building", and the 6b and 6c entries under "Slices").

Changes under test (uncommitted on `cube-2`):
- `supabase/migrations/0037_cube2_digest.sql`: `can_run_digest`, `playbook_digests`, `playbook_digest_runs`, the stats, input and state-count functions, and the lease functions `claim_digest_run`, `save_digest` and `release_digest_run`.
- `lib/companion-v2/digest.ts`: builds the model input, defines the tool schema, validates the model output and builds the view.
- `app/api/companion-v2/digest/route.ts`: generation.
- `app/companion/[slug]/digest/page.tsx` and `components/companion-v2/digest/{DigestScreen,GenerateButton}.tsx`.
- The `?ids=` filter in `app/companion/[slug]/conversations/page.tsx` and `ConversationList.tsx`.
- The Digest tab in `components/companion-v2/WorkspaceTabs.tsx`.
- The prompt in `content/companion-v2-digest.md`.

The repo has no test harness (TD-03, a Product Charter-tracked gap). Part A covers the throwaway scripts, which were run on 2026-11-09. Part B is the manual script for a non-production Supabase project and a local dev server. Part B has **not been run yet**. Several of its steps make real Anthropic calls; see "Cost" below.

## Acceptance criteria

| AC | Criterion (plan, section 9) | Covered by |
|---|---|---|
| 6b-1 | The numbers match hand-counted SQL | B3; A: test.mjs (stats), sqlcheck.mjs |
| 6b-2 | A contributor's own chats and opening-only conversations aren't counted | B2 seed + B3; A: test.mjs |
| 6b-3 | Adopters get 404 on `/digest` | B4.1 |
| 6b-4 | A contributor to playbook A gets nothing (or an error) from every 0037 function for playbook B | B5; A: test.mjs, extra.mjs |
| 6b-5 | No signed-in user can insert, update or delete `playbook_digests` directly | B6; A: test.mjs |
| 6c-1 | Every shown item resolves to real messages or gap entries | B7.3, B7.4; A: check.mts |
| 6c-2 | User counts match the people cited | B7.4 (`ITEMS` query); A: check.mts, sqlcheck.mjs |
| 6c-3 | Deleting a cited conversation reduces or hides the item on reload | B14; A: check.mts, test.mjs |
| 6c-4 | The payload contains no user ids or emails (inspect the row) | B7.5 (`LEAK` query); A: check.mts, sqlcheck.mjs |
| 6c-5 | The call counts against the daily cap | B7.2, B12 |
| 6c-6 | A second Generate while one is running is refused | B10, B9.2; A: test.mjs |
| Test 2 | max_tokens stop: the previous digest is unchanged, the retry message shows, the lease is released | B8 |
| Test 3 | Tab closed mid-generation: never a partial digest; refused only if the run was cut off; works again after expiry with no clean-up | B9 |
| Test 4 | API failure (`COMPANION_DIGEST_FAIL=1`) | B11 |
| Test 5 | 403 from the route for an adopter and for a contributor of another playbook; the functions return nothing | B4.2, B5 |
| (spec) | Empty period: no model call, no cap used | B13 |
| (spec) | 7/30 selector, Regenerate overwrites (one row per period), tab stays highlighted, "Show all" | B15 |
| (spec) | Prompt rules: no recommendations, names or places, no long quotes, complaints only from explicit statements | B16 (human judgement) |

---

## Part A: automated checks (run 2026-11-09)

All of these are in the session scratchpad, not in the repo.

| Script | What it covers | Result |
|---|---|---|
| `…\scratchpad\digest\check.mts` | `buildDigestInput`, `validateDigest` and `viewDigest`: relabelling people, scrubbing, neutralising pipes and tags, dropping invalid gaps, dropping any item with an unresolvable reference, ignoring counts the model writes, summary remapping, recounting after deletes | **29 passed, 0 failed** |
| `…\scratchpad\pg\test.mjs` | 0034, 0036 and 0037 in PGlite with stubbed auth: `can_run_digest`, stats, input, state counts, the lease (claim, refuse, release, expiry, stale save), table grants, anon, a deleted conversation | **45 passed, 0 failed** |
| `…\scratchpad\digest\extra.mts` (new) | Prompt-injection text in a message; contact details; whitespace and duplicate references; out-of-range and bad-section summary references; malformed stored payloads; `toPeriod` | **9 passed, 2 failed** (findings 1 and 3 below) |
| `…\scratchpad\pg\extra.mjs` (new) | Every function as contributor B and as an adopter (save and release raise; input null; counts empty); the lease is per playbook; anon claim; direct insert, update and delete on `playbook_digest_runs`; unknown playbook; the 1 MB payload limit; the lease surviving a rejected save; an expired lease that no one took over can still save; one row per period; the 400-message cap and 1000-character cut; an adopter turned contributor dropping out | **20 passed, 0 failed** (plus two info lines, see A.2) |
| `…\scratchpad\pg\sqlcheck.mjs` (new) | Runs the hand-count SQL in B3 and the `ITEMS` and `LEAK` queries in B7 against the fixture. Checks they agree with `contributor_digest_stats`, and that `LEAK` catches a planted user id and email | **5 passed, 0 failed** |
| `npx tsc --noEmit -p .` | Whole repo | clean |
| `npx eslint` on the changed files | digest.ts, the route, the page, the digest components, the conversations page, WorkspaceTabs, ConversationList | clean |

Full scratchpad folder: `C:\Users\Kamesh\AppData\Local\Temp\claude\c43f3a2ec54a4bb1\97f22b73-b9d2-478b-b75c-ec80e08d4fec\scratchpad`.

### A.1 How to re-run

```bash
S="C:/Users/Kamesh/AppData/Local/Temp/claude/c43f3a2ec54a4bb1/97f22b73-b9d2-478b-b75c-ec80e08d4fec/scratchpad"
R="<repo root>"
# digest.ts checks: copy the three modules with imports rewritten to './x.ts'
cp "$R/lib/companion-v2/types.ts" "$S/digest/types.ts"
sed "s#'./types'#'./types.ts'#" "$R/lib/companion-v2/ui-action.ts" > "$S/digest/ui-action.ts"
sed "s#'./ui-action'#'./ui-action.ts'#; s#'./types'#'./types.ts'#" "$R/lib/companion-v2/digest.ts" > "$S/digest/digest.ts"
cd "$S/digest" && node check.mts && node extra.mts
# migration checks (PGlite is installed in $S/pg)
cd "$S/pg" && node test.mjs "$R" && node extra.mjs "$R" && node sqlcheck.mjs "$R"
```

### A.2 Information lines from `extra.mjs` (not failures)
- **Re-applying 0037 fails** at `create policy "Digest readers can view digests"` ("already exists"). If 0037 is pasted twice in the SQL editor, expect that error; nothing else is affected.
- `contributor_digest_stats(<own playbook>, null)` returns an object with period counts of 0 for an allowed contributor instead of null: in SQL, `null not in (7, 30)` is null, not true. This is harmless because the route and page only pass 7 or 30.

---

## Part B: manual script (non-production Supabase and local dev server)

### Cost
Each Generate that reaches the model is a real, billed `claude-sonnet-4-6` call. The Anthropic account is the trial expiring 28-Oct-2026 (TD-16); re-check its status first. This script needs about **8 model calls**: B7 1, B8 2, B9 2–3, B15 2, B16 0. B11, B12, B13 and B14 make none.

### Setup
1. **Project.** Use the non-production Supabase project already used for slices 1–6a. It must have 0034–0036 applied, the LRL playbook seeded, and 6a's gap logging in the running code.
2. **Accounts** (approved, with at least one role):
   - **A**: contributor of LRL, assigned through the admin "Playbook contributors" panel.
   - **B**: contributor of the TEST playbook only (not of LRL).
   - **P1, P2, P3**: adopters who use LRL.
   - An admin account, for assignments only.

   Use a separate browser profile, or a private window, for each person you are signed in as at the same time.
3. **`.env.local`** (restart `npm run dev` after **every** change to it):
   ```
   NEXT_PUBLIC_CUBE_VERSION=2
   # leave these unset unless a step says otherwise:
   # COMPANION_DIGEST_MAX_TOKENS=200
   # COMPANION_DIGEST_FAIL=1
   # COMPANION_DAILY_CONTRIBUTOR_CAP=1
   ```
   The two `COMPANION_DIGEST_*` switches only work under `npm run dev` (`NODE_ENV !== 'production'`); `npm run start` ignores them.
4. **Ids.** In the SQL editor (it runs as `postgres` and bypasses RLS), run:
   ```sql
   select id, slug from public.playbooks;   -- note <LRL_ID>, <LRL_SLUG>, <TEST_ID>, <TEST_SLUG>
   ```
5. **Opening LRL as B adds B as an adopter.** If B opens `/companion/<LRL_SLUG>/…`, `getWorkspace` joins B to LRL as an adopter. That is existing behaviour. In B4 B only opens the Digest URL and never chats there, so B adds nothing to the counts. If B chats in LRL by mistake, B counts as a fourth adopter.

### Console helper (paste once per tab, any `localhost:3000` tab)
This signs each person in on a separate, throw-away client, so the app session in that tab is unaffected.

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
// Every 0037 function for one playbook. Never claim/save/release with a real lease here unless a step says so.
async function probe(sb, pb) {
  const fake = crypto.randomUUID();
  const out = {};
  out.can_run_digest = await sb.rpc('can_run_digest', { p_playbook_id: pb });
  out.stats_7 = await sb.rpc('contributor_digest_stats', { p_playbook_id: pb, p_days: 7 });
  out.input_30 = await sb.rpc('contributor_digest_input', { p_playbook_id: pb, p_days: 30 });
  out.state_counts = await sb.rpc('contributor_job_state_counts', { p_playbook_id: pb });
  out.claim = await sb.rpc('claim_digest_run', { p_playbook_id: pb });
  out.save = await sb.rpc('save_digest', { p_playbook_id: pb, p_period_days: 7, p_run_id: fake, p_payload: { x: 1 } });
  out.release = await sb.rpc('release_digest_run', { p_playbook_id: pb, p_run_id: fake });
  out.digests = await sb.from('playbook_digests').select('*').eq('playbook_id', pb);
  for (const [k, v] of Object.entries(out)) console.log(k.padEnd(15), JSON.stringify({ data: v.data, error: v.error && `${v.error.code} ${v.error.message}` }));
}
// The route, with this tab's own app session (cookies).
const post = (b) => fetch('/api/companion-v2/digest', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: typeof b === 'string' ? b : JSON.stringify(b),
}).then(async (r) => [r.status, await r.json().catch(() => null)]);
```

### Reusable SQL (SQL editor)

**`RUNS`**: the lease table, which no signed-in user can read:
```sql
select p.slug, r.run_id, r.running_until, r.running_until > now() as active,
       greatest(r.running_until - now(), interval '0') as time_left
from public.playbook_digest_runs r join public.playbooks p on p.id = r.playbook_id;
```

**`SNAP`**: the stored digests; compare before and after:
```sql
select period_days, generated_at, md5(payload::text) as payload_md5,
       jsonb_array_length(payload->'themes') as themes, jsonb_array_length(payload->'summary') as bullets
from public.playbook_digests
where playbook_id = (select id from public.playbooks where slug = '<LRL_SLUG>')
order by period_days;
```

**`USAGE`**: today's daily-cap counter for A:
```sql
select role, day, count from public.companion_usage
where user_id = (select id from auth.users where email = '<A email>')
  and day = (now() at time zone 'utc')::date;
```

---

### B1. Apply 0037
1. In the non-production project's SQL editor, paste and run `supabase/migrations/0037_cube2_digest.sql` once. **Expect:** success.
2. Check the objects:
   ```sql
   select proname, prosecdef from pg_proc
   where proname in ('can_run_digest','contributor_digest_stats','contributor_digest_input',
                     'contributor_job_state_counts','claim_digest_run','save_digest','release_digest_run')
   order by 1;                                                    -- 7 rows, all prosecdef = true
   select tablename, rowsecurity from pg_tables
   where tablename in ('playbook_digests','playbook_digest_runs');  -- both true
   select grantee, privilege_type from information_schema.role_table_grants
   where table_name in ('playbook_digests','playbook_digest_runs') and grantee in ('anon','authenticated')
   order by 1, 2;                                                 -- exactly one row: authenticated SELECT on playbook_digests
   select policyname, cmd from pg_policies where tablename in ('playbook_digests','playbook_digest_runs');
                                                                  -- one row: "Digest readers can view digests", SELECT
   ```
3. Do **not** run it a second time. If you do, it errors at `create policy` (see A.2).

### B2. Seed the conversations
Use the app (Converse tab) as each person, with gap logging (6a) on. Leave about a minute between people, so their timestamps are easy to tell apart in the listings.

| Who | Conversation | What to send (one message per row) | Meant to produce |
|---|---|---|---|
| P1 | P1-a | chip "Where do I start?" | a theme |
| | | `What does "orthography" mean here?` | a term |
| | | `Can we get insurance for the recording kit? Call me on 98765 43210` | a gap (probably not covered), and a contact detail to check for |
| | | `That answer was too long.` | a complaint about Cube |
| P1 | P1-b ("Start a new conversation") | `How many speakers do we need?` | backdated in step 2 (30-day only) |
| P2 | P2-a | `We've started contracting the partners` | journey state in_progress |
| | | `We're stuck waiting for the vendor contract. Ravi Kumar at the Jhabua district office hasn't replied` | stuck; a name and place to check for |
| | | `How do I pay speakers by UPI?` | a gap (probably) |
| | | `Thanks, that made it clear` | what's working |
| P3 | P3-a | chip "What usually goes wrong, and how do I avoid it?" | a theme |
| | | `What does orthography mean?` | the same term, so 2 users |
| | | `You keep repeating yourself, this isn't helpful` | a complaint about Cube |
| | | `The officials are so slow, I'm fed up` | frustration about the real-world project: must **not** become a complaint |
| P3 | P3-b | open a new conversation and send **nothing** (Cube's opening message only) | must not be counted |
| A | contributor chat in LRL | chip "What's missing from the playbook?" | must not be counted |

1. Find the conversation ids:
   ```sql
   -- H1: every conversation in the playbook, with what decides whether it counts
   select c.id, u.email, m.member_role, c.started_at,
     (select count(*) from public.companion_messages x where x.conversation_id = c.id and x.role = 'user') as user_msgs,
     (select count(*) from public.companion_messages x where x.conversation_id = c.id and x.role = 'user'
        and x.created_at >= now() - interval '7 days') as user_msgs_7d,
     (select count(*) from public.companion_messages x where x.conversation_id = c.id and x.role = 'user'
        and x.created_at >= now() - interval '30 days') as user_msgs_30d,
     (select count(*) from public.companion_messages x where x.conversation_id = c.id
        and jsonb_typeof(x.ui->'gap') = 'object') as gaps
   from public.companion_conversations c
   join public.playbook_members m on m.id = c.member_id
   join auth.users u on u.id = m.user_id
   where c.playbook_id = (select id from public.playbooks where slug = '<LRL_SLUG>')
   order by m.member_role, u.email, c.started_at;
   ```
   **Expect:** P3-b has `user_msgs = 0`. A's chat has `member_role = contributor`. At least one of P1-a and P2-a has `gaps ≥ 1`. If neither does, the model answered both questions: ask another plainly out-of-scope adoption question, such as `Do we need fire insurance for the studio?`.
2. Backdate P1-b by 10 days (non-production only):
   ```sql
   update public.companion_messages set created_at = created_at - interval '10 days' where conversation_id = '<P1-b id>';
   update public.companion_conversations set started_at = started_at - interval '10 days',
          updated_at = updated_at - interval '10 days' where id = '<P1-b id>';
   ```

### B3. Numbers against hand-counted SQL (6b-1, 6b-2)
1. **By eye, from H1:** count adopter rows only, ignoring rows with `user_msgs = 0`.
   - Users total: distinct emails = **3**.
   - Users, last 7 days: distinct emails with `user_msgs_7d > 0` = **3**.
   - Conversations total: **4** (P1-a, P1-b, P2-a, P3-a).
   - Conversations, last 7 days: **3**. Last 30 days: **4**.
2. **The same, aggregated** (written differently from the 0037 function; checked against it in `sqlcheck.mjs`):
   ```sql
   -- H2
   select
     count(distinct m.user_id) filter (where uc.n > 0)  as users_total,
     count(distinct m.user_id) filter (where uc.n7 > 0) as users_7,
     count(distinct m.user_id) filter (where uc.n30 > 0) as users_30,
     count(*) filter (where uc.n > 0)   as convs_total,
     count(*) filter (where uc.n7 > 0)  as convs_7,
     count(*) filter (where uc.n30 > 0) as convs_30
   from public.companion_conversations c
   join public.playbook_members m on m.id = c.member_id and m.member_role = 'adopter'
   cross join lateral (
     select count(*) as n,
            count(*) filter (where x.created_at >= now() - interval '7 days')  as n7,
            count(*) filter (where x.created_at >= now() - interval '30 days') as n30
     from public.companion_messages x where x.conversation_id = c.id and x.role = 'user') uc
   where c.playbook_id = (select id from public.playbooks where slug = '<LRL_SLUG>');
   ```
3. **Most discussed jobs** (till date: a reply counts only if the message right before it is the user's):
   ```sql
   -- H3
   with r as (
     select a.conversation_id, a.ui
     from public.companion_messages a
     join public.companion_conversations c on c.id = a.conversation_id
     join public.playbook_members m on m.id = c.member_id and m.member_role = 'adopter'
     where c.playbook_id = (select id from public.playbooks where slug = '<LRL_SLUG>')
       and a.role = 'assistant'
       and (select p.role from public.companion_messages p
            where p.conversation_id = a.conversation_id and p.created_at < a.created_at
            order by p.created_at desc limit 1) = 'user'
   ), j as (
     select conversation_id, jsonb_array_elements_text(ui->'focusJobs') as code from r where jsonb_typeof(ui->'focusJobs') = 'array'
     union
     select conversation_id, ui->>'openJob' from r where jsonb_typeof(ui->'openJob') = 'string'
   )
   select j.code, pj.name, count(distinct j.conversation_id) as conversations
   from j join public.playbook_jobs pj
     on pj.playbook_id = (select id from public.playbooks where slug = '<LRL_SLUG>') and pj.job_code = j.code
   group by j.code, pj.name, pj.position
   order by conversations desc, pj.position nulls last, j.code
   limit 10;
   ```
4. As **A**, open `/companion/<LRL_SLUG>/digest`. Compare:
   - The "Users" card: big number = `users_total`; "N in the last 7 days" = `users_7`.
   - The "Conversations" card: `convs_total` and `convs_7`.
   - "Most discussed jobs, till date": the card shows **the top 5** of H3, in the same order, with the same "N conv." values. (The function returns 10; the screen shows 5. See observation 7.)
   - With no digest stored yet, the banner reads "Based on 3 users and 3 conversations in the last 7 days." It has no "Too few users" sentence.
5. Click **Last 30 days**. **Expect:** the URL is `?days=30`; the cards show `users_30` / `convs_30` (4) beside the same totals; the jobs card is unchanged (it is till date).
6. **Excluded chats.** Neither A's contributor chat nor P3-b changes any number. To confirm, temporarily send one more message in A's contributor chat and reload: the numbers stay the same.
7. **Expected mismatch:** "Browse all conversations →" lists P3-b too, because the existing list counts opening-only conversations. So the list shows one more conversation than the card. That is expected: the plan keeps `/conversations` unchanged.

### B4. Page and route access (6b-3, Test 5)
1. **404 on the page.** As P1, open `/companion/<LRL_SLUG>/digest` → **404**. P1's tab bar shows Converse and View Jobs, with no Digest. As B, open `/companion/<LRL_SLUG>/digest` → **404** (see Setup 5). As A, open `/companion/<TEST_SLUG>/digest` → **404**, unless A is also a TEST contributor.
2. **403 from the route.** In P1's tab console: `await post({ playbookId: LRL, periodDays: 7 })` → `[403, {error: "Only contributors to this playbook can generate its digest."}]`. In B's tab: the same call → **403**. Run `SNAP` and `RUNS`: nothing changed, and there is no lease row.
3. **Bad requests** (in A's tab):

   | Call | Expect |
   |---|---|
   | `post({ playbookId: LRL, periodDays: '7' })` | 400 |
   | `post({ playbookId: LRL, periodDays: 14 })` | 400 |
   | `post({ playbookId: 'abc', periodDays: 7 })` | 400 |
   | `post('not json')` | 400 |
   | `post({ playbookId: crypto.randomUUID(), periodDays: 7 })` | 403 |

   Afterwards, `RUNS` shows no lease row.
4. **Signed out.** In a private window on `localhost:3000` (not signed in), paste only the `post` helper and run `post({ playbookId: LRL, periodDays: 7 })` → `[401, {error: "Unauthorized"}]` from `proxy.ts`.

### B5. Every 0037 function with the other playbook's id (6b-4, Test 5)
In any tab, run:
```js
const b = await as('<B email>', '<B pw>');  await probe(b, LRL);
const p1 = await as('<P1 email>', '<P1 pw>'); await probe(p1, LRL);
const anon = await as();                      await probe(anon, LRL);
```

| Call | B and P1: expect | anon: expect |
|---|---|---|
| `can_run_digest` | `data: false` | error `42501` permission denied for function |
| `stats_7`, `input_30` | `data: null` | `42501` |
| `state_counts` | `data: []` | `42501` |
| `claim` | error `42501 not_allowed` | `42501` |
| `save`, `release` | error `42501 not_allowed` | `42501` |
| `digests` (table select) | `data: []` | `data: []` or `42501` |

Then run **`RUNS`** in SQL: no row for LRL, because the denied `claim` took no lease.

As a control, `probe(await as('<A email>', …), LRL)` → `can_run_digest: true`, with stats and input returned. **But** `claim` then takes a real lease. Release it straight away:
```js
const a = await as('<A email>', '<A pw>');
const { data: run } = await a.rpc('claim_digest_run', { p_playbook_id: LRL }); console.log(run);
console.log(await a.rpc('release_digest_run', { p_playbook_id: LRL, p_run_id: run }));   // RUNS: no row
```
(Use this pair instead of `probe` for A.)

### B6. Direct table access is denied (6b-5)
In any tab:
```js
const a = await as('<A email>', '<A pw>');
console.log('insert', await a.from('playbook_digests').insert({ playbook_id: LRL, period_days: 30, payload: { x: 1 } }));
console.log('update', await a.from('playbook_digests').update({ payload: { x: 1 } }).eq('playbook_id', LRL));
console.log('delete', await a.from('playbook_digests').delete().eq('playbook_id', LRL));
console.log('runs select', await a.from('playbook_digest_runs').select('*'));
console.log('runs insert', await a.from('playbook_digest_runs').insert({ playbook_id: LRL, run_id: crypto.randomUUID(), running_until: new Date().toISOString() }));
```
**Expect:** each returns `error.code = "42501"` ("permission denied for table …"). Repeat with P1's client: same result. Then run `SNAP` and `RUNS`: unchanged.

### B7. Generate with 3+ adopters (6c-1, 6c-2, 6c-4, 6c-5; Test 1)
1. Run `USAGE` and note the count (call it `u0`). As A, on `/digest` (7 days), click **Generate digest**. **Expect:**
   - The button reads "Generating…", with "This can take a minute or two."
   - When it finishes, the page refreshes: "Generated on <date>, <time> IST", and the button becomes **Regenerate**.
2. Run `USAGE`: **`u0 + 1`** (6c-5). Run `RUNS`: no row. Run `SNAP`: one row, `period_days = 7`.
3. **Every item and link.** For each shown item (Summary, Themes, Unanswered questions, Where people got stuck, Terms, Complaints, What's working):
   - Click **View conversations**. The URL is `/conversations?ids=…`, and the list text reads "The N conversations behind one item in the digest". N must equal the item's number of distinct conversations. Open each conversation and confirm that what the item says is actually in **that adopter's own messages** in the last 7 days.
   - The "N users" on the item equals the number of **different people** among those conversations. P1-a and P1-b are both P1: one user.
   - Unanswered questions: "Asked <dates>" matches the dates of the gap replies (H1 `gaps`), the kind tag matches `ui->'gap'->>'kind'`, and each one rests on a reply with a `gap` (not just a user question).
   - Where people got stuck: "Now, till date: …" equals `select job_code, state, count(*) from member_job_states s join playbook_members m on m.id = s.member_id where m.playbook_id = '<LRL_ID>' and m.member_role = 'adopter' group by 1, 2;`. An item that rests only on state counts shows **no** user count and **no** link.
   - Summary: at most 3 bullets, each with "(N users)". N is the union of the people in the items the bullet sums up.
   - Sections with nothing are **absent**. There is never a "none found".
4. **Counts by SQL.** In the query below, `people_by_label` must equal `people_real` on every row: the U labels map one-to-one to real adopters. `convs_live` and `people_by_label` must equal what the screen shows.
   ```sql
   -- ITEMS
   with d as (
     select payload from public.playbook_digests
     where playbook_id = (select id from public.playbooks where slug = '<LRL_SLUG>') and period_days = 7
   ), items as (
     select s.section, i.ord - 1 as idx, i.item
     from d
     cross join lateral unnest(array['themes','unanswered','stuck','terms','complaints','working']) as s(section)
     cross join lateral jsonb_array_elements(d.payload -> s.section) with ordinality as i(item, ord)
   )
   select section, idx,
     left(coalesce(item->>'title', item->>'question', item->>'term', item->>'summary', item->>'job'), 60) as label,
     jsonb_array_length(item->'convs') as convs_stored,
     (select count(*) from jsonb_array_elements(item->'convs') cv
        where exists (select 1 from public.companion_conversations c where c.id = (cv->>'c')::uuid)) as convs_live,
     (select count(distinct cv->>'p') from jsonb_array_elements(item->'convs') cv
        where exists (select 1 from public.companion_conversations c where c.id = (cv->>'c')::uuid)) as people_by_label,
     (select count(distinct c.member_id) from jsonb_array_elements(item->'convs') cv
        join public.companion_conversations c on c.id = (cv->>'c')::uuid) as people_real
   from items
   order by array_position(array['themes','unanswered','stuck','terms','complaints','working'], section), idx;
   ```
5. **No identities in the payload.** Every column must be **0**:
   ```sql
   -- LEAK
   with d as (
     select payload::text as t from public.playbook_digests
     where playbook_id = (select id from public.playbooks where slug = '<LRL_SLUG>')
   )
   select
     (select count(*) from d, auth.users u where d.t ilike '%' || u.id::text || '%') as user_ids,
     (select count(*) from d, public.playbook_members m where d.t ilike '%' || m.id::text || '%') as member_ids,
     (select count(*) from d, public.companion_messages msg where d.t ilike '%' || msg.id::text || '%') as message_ids,
     (select count(*) from d, auth.users u where u.email is not null and d.t ilike '%' || u.email || '%') as known_emails,
     (select count(*) from d where d.t ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}') as any_email_shape,
     (select count(*) from d where d.t ~ '"(user_id|member_id|email|name|person)"') as id_keys;
   ```
   Then read the payload yourself (`select jsonb_pretty(payload) from public.playbook_digests where …`).
   - The only UUIDs are conversation ids (in `c`), and people appear only as `"p": "U1"`.
   - `98765 43210`, `Ravi Kumar` and `Jhabua` appear **nowhere**. The phone number is removed by code. The name and place are left to the prompt, so if they show up, record it under B16.
6. The banner now reads "Based on 3 users and 3 conversations in the last 7 days." These numbers come from what the digest was built on; see observation 6.

### B8. max_tokens stop (Test 2; user test a)
1. A 7-day digest exists from B7. Run `SNAP` and note `generated_at` and `payload_md5`.
2. Set `COMPANION_DIGEST_MAX_TOKENS=200` in `.env.local` and restart `npm run dev`.
3. As A, click **Regenerate**. **Expect:**
   - In the Network tab, the POST returns **502** `{error: "too_long", message: …}`.
   - Under the button: "The digest couldn't be generated just now. The previous digest is unchanged; please try again."
   - The server log shows `[digest] stopped at max_tokens`.
   - On screen, the digest and "Generated on" are unchanged.
4. Run `SNAP`: the **same** `generated_at` and `payload_md5`. Run `RUNS`: **no row** (the lease was released).
5. **Retry works at once.** Click **Regenerate** again immediately. **Expect:** the same 502 and retry message, and **not** the 409 "already being generated". That proves the lease was released. This costs a second (short) model call.
6. Run `USAGE`: it went up by 2 (failed runs count, by design).
7. Remove the variable, restart, and click **Regenerate**. **Expect:** success, with a new `generated_at`.

### B9. Closing the tab mid-generation (Test 3; user test b)
**Read first:** under `npm run dev`, closing the tab cancels the browser's fetch but **not** the route handler. The route doesn't watch `req.signal`, and the Anthropic call isn't given one, so the run normally **finishes and saves**. B9.1 checks that case; B9.2 actually cuts the run off by stopping the server.

**B9.1 Tab closed, run not cut off**
1. Run `SNAP` (note `generated_at`). As A, click **Regenerate**, wait about 3 seconds, and close the tab.
2. Run `RUNS` every 15 s. **Expect:** a row with `active = true` while the model runs, then **no row** (`save_digest` released it).
3. Run `SNAP`: a **new** `generated_at`, with a complete payload. Repeat B7.5's `LEAK` query, and re-run `ITEMS`: it is consistent.
4. Within 5 minutes of step 1, open `/digest` and click **Regenerate**. **Expect:** it is **not** refused (the run wasn't cut off), and it succeeds. (Skip this click to save a model call if B9.2 will cover the refusal.)

**B9.2 Run actually cut off**
1. Run `SNAP` and `USAGE`. As A, click **Regenerate**. After about 5 seconds, when `USAGE` has gone up by one (the run is past the cap check and in the model call), stop the dev server with **Ctrl+C**. Close the tab.
2. Run `RUNS`: one row, `active = true`, with `time_left` under 5 minutes. Run `SNAP`: **unchanged**, so there is no partial digest.
3. Start `npm run dev` again, open `/digest` as A, and click **Regenerate** while `RUNS` still shows `active = true`. **Expect:**
   - The POST returns 409 `{error: "busy"}`.
   - The message reads "A digest for this playbook is already being generated. Try again in a few minutes."
   - `SNAP` is unchanged, and `USAGE` is unchanged: the refusal happens before the cap check.
4. Also click **Last 30 days**, then **Generate digest**. **Expect:** the same 409. The lease covers both periods.
5. Wait until `RUNS` shows `active = false` (`running_until` has passed). **Do not** delete the row. Click **Regenerate**. **Expect:**
   - Success, with a new `generated_at`.
   - `RUNS` shows **no row** afterwards: the claim took over the expired row and the save removed it.
   - No manual clean-up was needed.

### B10. A second Generate while one is running (6c-6)
This is deterministic and needs no model call.
1. In the console:
   ```js
   const a = await as('<A email>', '<A pw>');
   const { data: run } = await a.rpc('claim_digest_run', { p_playbook_id: LRL });
   console.log(run);
   ```
   `RUNS` shows the lease.
2. In the app, as A, click **Regenerate** → 409 "already being generated". `USAGE` is unchanged.
3. Run `await a.rpc('claim_digest_run', { p_playbook_id: LRL })` again → `data: null`.
4. Release: `await a.rpc('release_digest_run', { p_playbook_id: LRL, p_run_id: run })`. `RUNS` shows no row. Do not click Regenerate here (it would cost a call); B8.5 already covers "works at once".
5. Optional, live: open `/digest` in two tabs as A and click **Regenerate** in both within a second. **Expect:** one succeeds and the other gets the 409 message.

### B11. API failure path (Test 4)
1. Set `COMPANION_DIGEST_FAIL=1` and restart. Run `SNAP` and `USAGE`.
2. Click **Regenerate**. **Expect:**
   - The POST returns **503** `{error: "failed"}`, with the retry message.
   - The server log shows `[digest] failed: Error: Injected failure (COMPANION_DIGEST_FAIL)`.
   - `SNAP` is unchanged, and `RUNS` has no row.
   - `USAGE` has gone up by 1: the failure is injected after the cap check.
3. Click **Regenerate** again at once → the same 503, **not** 409. Unset the variable and restart.

### B12. Daily cap (6c-5)
1. Set `COMPANION_DAILY_CONTRIBUTOR_CAP=1` and restart. Run `USAGE`: A's count today is already ≥ 1 from the steps above. (If not, run `insert into public.companion_usage (user_id, role, day, count) values ((select id from auth.users where email = '<A email>'), 'contributor', (now() at time zone 'utc')::date, 1) on conflict (user_id, role, day) do update set count = 1;`.)
2. Run `SNAP`. Click **Regenerate**. **Expect:**
   - **429** `{error: "daily_limit"}`, with the message "You've reached today's limit for requests to Cube. It resets at midnight UTC."
   - No model call: the log has no `[digest]` API line, and the reply is near-instant.
   - `SNAP` is unchanged, and `RUNS` has **no row** (the lease was released).
   - `USAGE` is +1 (an attempt over the cap still counts).
3. Click **Regenerate** again at once → **429** again, **not** 409. That confirms the lease was released.
4. A's contributor **chat** is now over the cap too (it shares the `contributor` counter). That is expected.
5. Clean up: `delete from public.companion_usage where user_id = (select id from auth.users where email = '<A email>') and day = (now() at time zone 'utc')::date and role = 'contributor';`. Then unset the cap and restart.

### B13. Empty period: no model call, no cap used
1. Use TEST, where no adopter has chatted in the last 7 days (H1 with `<TEST_SLUG>`: no adopter rows with `user_msgs_7d > 0`). Sign in as B and run `USAGE` for B's email.
2. Open `/companion/<TEST_SLUG>/digest` and click **Generate digest**. **Expect:**
   - It returns almost at once with 200.
   - "Generated on …" appears.
   - The banner reads "Based on 0 users and 0 conversations in the last 7 days. Too few users to see patterns."
   - There is no Summary and no sections.
   - "Browse all conversations →" is still present.
3. Run `USAGE` for B: **unchanged**. In the SQL editor, the stored row's payload has empty arrays and `basis.messages_used = 0`.
4. Negative control: an LRL period that only has gap entries still calls the model (only "no messages **and** no gaps" skips it). This is covered in Part A; no live step.

### B14. Deleting a cited conversation (6c-3)
1. Using `ITEMS`, pick a conversation id that is cited by (a) an item **only** it supports, and (b) an item it shares with another adopter. Ideally (c) a summary bullet cites (a). P1-a is a good choice: the "too long" complaint is P1-only, and the orthography term is P1 + P3.
2. Note the screen: the item counts, the bullets, the banner and the stat cards.
3. As **P1**, on Converse, open "Recent conversations", delete P1-a, and confirm.
4. As A, reload `/digest` (**do not** regenerate). **Expect:**
   - Item (a) is **hidden**.
   - Item (b) is shown with its user count **reduced by one**. Its "View conversations" list no longer includes P1-a.
   - Every summary bullet that cited (a) is **hidden**. A bullet citing only surviving items shows its recounted user count.
   - The banner's people and conversation counts drop to match.
   - The stat cards drop (Conversations total −1; Users drop only if P1 has no other counted conversation; P1-b remains).
   - A "stuck" item that rests only on state counts stays (job states survive conversation deletion).
5. Open the old link for (a), which you copied in step 2 (`/conversations?ids=<P1-a id>`): "These conversations are no longer available."
6. Run `ITEMS`: for the rows that cited P1-a, `convs_stored` > `convs_live`. The stored payload is untouched; hiding happens on the view.

### B15. Period switch, Regenerate, tab highlight and the filtered list
1. On **Last 30 days** with no 30-day digest: "No digest for the last 30 days yet." and **Generate digest**. Generate (a live call). `SNAP` shows two rows (7 and 30). Its items may include P1-b (the backdated conversation); the 7-day ones must not.
2. Click **Regenerate** on 30 days (a live call). `SNAP`: still **one** row for `period_days = 30`, with a newer `generated_at` and a different md5 (usually). There is no history row anywhere.
3. **Tab highlight.** The **Digest** tab is underlined (`aria-current="page"`) on:
   - `/digest`
   - `/digest?days=30`
   - `/conversations`
   - `/conversations?ids=…`
   - `/conversations/<id>`

   No other tab is underlined on these pages. Converse is underlined only on `/companion/<slug>`.
4. **Filtered list.** On a "View conversations" page:
   - the text reads "The N conversations behind one item in the digest… Show all conversations";
   - **Show all conversations** opens the unfiltered `/conversations`, with the original intro text;
   - "← Digest" returns to the 7-day Digest (not 30; it has no `?days`).
5. `?ids=` edge cases:

   | URL | Expect |
   |---|---|
   | `/conversations?ids=not-a-uuid` | "These conversations are no longer available." |
   | `/conversations?ids=<a TEST conversation id>` | the same (another playbook's id is dropped) |
   | `/conversations?ids=` | the full, unfiltered list |
   | `/conversations?ids=<id1>&ids=<id2>` | **predicted: server error page** (finding 2) |

6. **Period switch after a failure** (traced, finding 5): repeat B11.2 on 7 days, then click **Last 30 days**. Record whether the red retry message is still shown under the 30-day button.
7. **Mobile width** (DevTools, 375 px): the period selector, Regenerate, the three cards and the items wrap without horizontal scrolling. The tab bar scrolls sideways if needed.

### B16. Prompt behaviour (human judgement; read the 7-day and 30-day digests)
Tick each one, and quote the offending text if any fails:

- [ ] **No recommendations:** nothing like "the playbook should add…", "consider…", "prioritise…", "we recommend". Descriptions only.
- [ ] **No names, places or organisations:** "Ravi Kumar", "Jhabua", "district office" (as a specific office) and vendor names are absent. People are "people" or "users", never "U1".
- [ ] **No quotes beyond a few words:** no sentence copied from an adopter message.
- [ ] **Complaints only from explicit statements:** "too long" (P1) and "repeating yourself / not helpful" (P3) may appear. "The officials are so slow, I'm fed up" must **not** be a complaint. If anywhere, it belongs under Where people got stuck.
- [ ] **What's working only from explicit praise:** only "Thanks, that made it clear" (P2).
- [ ] **Terms:** "orthography" appears only as a question asked, never with "people misunderstood…".
- [ ] **Unanswered questions:** each one maps to a stored gap (B7.3). None is invented from a plain question that Cube did answer.
- [ ] **Thin evidence:** with 3 users, the text describes what was said or says "too few users to tell", rather than claiming trends.
- [ ] **No framework terms or job codes in the text:** no "work area", "job type", "S7" or "E4" in titles or summaries. Job names appear as chips.
- [ ] **No "Fix with Cube" button**, and no edit controls anywhere on the Digest.

### Results (fill in when run)

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | B1 apply 0037 | | |
| 2 | B3 numbers vs H1, H2, H3 | | |
| 3 | B4 404 / 403 / 400 / 401 | | |
| 4 | B5 functions, other playbook | | |
| 5 | B6 direct table access | | |
| 6 | B7 generate, links, counts, LEAK | | |
| 7 | B8 max_tokens | | |
| 8 | B9.1 tab closed | | |
| 9 | B9.2 server killed, lease expiry | | |
| 10 | B10 second Generate refused | | |
| 11 | B11 injected failure | | |
| 12 | B12 daily cap | | |
| 13 | B13 empty period | | |
| 14 | B14 deleted conversation | | |
| 15 | B15 7/30, regenerate, tabs, ids | | |
| 16 | B16 prompt behaviour | | |

---

## Findings from code review and Part A

Ordered by severity. None blocks the acceptance criteria; findings 1–3 are real defects, and 4–5 are spec or UX gaps.

1. **A summary bullet resting only on a "state-only" stuck item shows "(0 users)".** `lib/companion-v2/digest.ts:515-520` takes the bullet's people from its cited items' conversations. A state-only stuck item has none, and `components/companion-v2/digest/DigestScreen.tsx:205` always prints `(${users(b.people)})`. The model is allowed to cite `stuck[i]` in a bullet, so this can happen. Found by `extra.mts` (FAIL: `{"text":"Only state-based","convIds":[],"people":0}`). *Fix acceptance:* Given a stored digest whose bullet cites only a stuck item with `state_only: true`, When the Digest opens, Then the bullet shows no user count (or the count of people in the state counts), and never "0 users".
2. **`/conversations?ids=a&ids=b` crashes the page.** `app/companion/[slug]/conversations/page.tsx:145` calls `ids.split(',')`, but a repeated query key gives a `string[]` at runtime (it is typed `string`). Only a hand-made URL triggers it; the app's own links use one `ids`. Traced, not executed. *Fix acceptance:* Given `?ids=<id1>&ids=<id2>`, When the page loads, Then it shows the filtered list (or ignores the extra key) and returns 200.
3. **A malformed stored payload breaks the Digest page for every contributor of that playbook.** `save_digest` accepts any JSON object up to 1 MB. A contributor can `claim_digest_run` and `save_digest` from the console. `viewDigest` (`digest.ts:493` `item.convs.filter`, `digest.ts:512` `b.refs.map`) then throws on missing fields, and the Regenerate button is on the page that fails. Recovery is a console `post(...)` or switching to the other period. Found by `extra.mts` (FAIL: `TypeError … reading 'filter'`). Low severity, because contributors are trusted and only that playbook's Digest is affected. *Fix acceptance:* Given a stored payload `{"summary":[{"text":"x"}],"themes":[{"title":"t"}]}`, When the Digest opens, Then the page renders (bad items skipped) and Regenerate is available.
4. **The page's gate doesn't use `can_run_digest`.** The plan says every digest permission check uses it. The page uses `requireContributor` (`app/companion/[slug]/digest/page.tsx:26`, `member_role === 'contributor'`), and the Digest tab shows on the same basis (`app/companion/[slug]/layout.tsx`). So "allowing admins later is a one-line change" would also need the page and tab changed. Today the two checks agree, because role-less users are stopped by the companion layout.
5. **The Generate button keeps its state across the 7/30 switch** (traced). `GenerateButton` isn't keyed by period (`DigestScreen.tsx:162`), and App Router soft navigation keeps client state. A retry message from the 7-day run would still show on the 30-day view, and "Generating…" would carry over if you switch mid-run. *Fix acceptance:* Given a failed Generate on 7 days, When the user clicks Last 30 days, Then no error message is shown under the 30-day button.

Observations (decide whether they matter; not counted as bugs):

6. When a digest exists, the banner uses the digest's own basis (who it was built on, minus deletions) rather than the current period counts (`DigestScreen.tsx:39-40`). A digest generated days ago still says "in the last 7 days" about its generation window, so it can differ from the cards above it.
7. The jobs card shows the top 5 (`DigestScreen.tsx:173`) of the 10 the function returns.
8. "Browse all conversations" counts opening-only conversations; the cards don't (B3.7).
9. A failed run (max_tokens, injected failure, API error) and an over-cap attempt all use up a daily-cap call. This is consistent with the 0036 design ("counted at call time").
10. Re-running 0037 fails at `create policy` (A.2). `stats(…, null)` returns zeros for an allowed caller (A.2).
11. On Vercel, the 5-minute lease equals `maxDuration = 300`. The Anthropic timeout (240 s) keeps a run inside it, so a run that is still alive can't lose its lease to a new claim.
