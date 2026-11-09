# Cube 2.0 slice 6a: gap logging test script

Spec: `docs/design/cube2-plan.md` section 9, "Part 1" and "Slice 6a".
Change under test (uncommitted on `cube-2`): `lib/companion-v2/types.ts` (`UiGap`, `GAP_KINDS`), `lib/companion-v2/ui-action.ts` (`sanitizeUiAction` → `sanitizeGap`, `scrubContact`, `cap`), `content/companion-v2.md` (the `gap` field and the two example blocks). Storage is unchanged: `use-companion-chat.ts` passes the sanitized `ui` (now with `gap`) to `record_companion_turn` as `p_ui`, which inserts it into `companion_messages.ui`.

The repo has no test harness (TD-03, a Product Charter-tracked gap). Part A is a throwaway Node script, run on 2026-11-09. Part B is a manual script for a running dev server; it needs a non-production Supabase project and the Anthropic key, so it has not been run yet.

## Acceptance criteria (Slice 6a)

| AC | Criterion | Covered by |
|---|---|---|
| AC-1 | A not-covered question about the adoption stores a `gap` in that reply's `ui` | B-Q2, B-Q3 (live); A: H1, H6 |
| AC-2 | A partly covered one stores `partly_covered` | B-Q4 (live); A: H2 |
| AC-3 | Small talk or an off-topic question stores none | B-Q6, B-Q7, B-Q0 (live) |
| AC-4 | A gap with an email, URL or phone number in its question is stored without it | B-Q3 (live, model-dependent), B-M2 (forced, deterministic); A: E*, U*, P* |
| AC-5 | A malformed gap is dropped and the turn is still saved | B-M1, B-M3 (forced); A: N1–N26 |
| AC-6 | The reply text never shows the block | B-V1, B-V2; A: S1–S4 |
| (spec) | Covered question stores no gap | B-Q5 |
| (spec) | `job` kept only if it is a known job code | A: N19–N22; B: check `gap.job` per row |
| (spec) | Older messages have no gap; no backfill | A: O1–O3; B-V3 |

---

## Part A: sanitizer script (automated, run)

Node 24 strips TypeScript types but needs explicit `.ts` import extensions, so the two modules are copied to a scratch folder and the import is rewritten:

```bash
D=<scratch folder>
cp lib/companion-v2/types.ts "$D/types.ts"
sed "s#from './types'#from './types.ts'#" lib/companion-v2/ui-action.ts > "$D/ui-action.ts"
# save the script in the appendix as $D/test-gap.mts, then:
node "$D/test-gap.mts"
```

Also run: `npx tsc --noEmit -p .` (clean) and `npx eslint lib/companion-v2/ui-action.ts lib/companion-v2/types.ts` (clean).

### Rerun after the fixes (2026-11-09): 107 passed, 0 failed

The fixes in `ui-action.ts` resolve all eight failures below. Two expectations were updated because the behaviour changed on purpose:
- **U2:** `see http://example.com/a.` now gives `see.`: a link no longer swallows the sentence's full stop.
- **X3:** Devanagari phone numbers are now removed (`फ़ोन ९८७६५ ४३२१०` gives `फ़ोन`).

A further 17 probes all pass, among them:
- The removals: two phone numbers side by side, `+91 98 76 54 32 10`, `bit.ly`, `forms.gle`, `wa.me` and `t.me` links, `x.co.uk`, `mailto:` and the UPI id `ravi@okaxis`.
- What must stay: ISO date ranges, `₹150000000`, `ready.In the`, `e.g. a co-op`.
- An emoji at the 160-character cut no longer leaves a lone surrogate.

The probes are in the session scratchpad as `extra.mts`, not in this doc.

The probe notes further down describe the first run: UPI ids and Devanagari digits are now removed.

### First run (2026-11-09): 99 passed, 8 failed, 107 total

Every failure is in `scrubContact`'s edges. None stops a turn from saving or lets an email or phone number through. All gap shape validation (kind, question, topic, job, extra fields, older ui) passed.

| Id | Input | Expected | Actual | Kind of problem |
|---|---|---|---|---|
| K14 | `ages 6-18 18-45 45-60` | unchanged | `ages` | Removes real content: hyphenated ranges separated by spaces add up to 9+ digits |
| K15 | `period 01/04/2025 - 31/03/2026` | unchanged | `period` | Removes real content: a date range is 16 digits |
| K16 | `Rs 150000000 total` | unchanged | `Rs total` | Removes real content: an amount of 9+ digits with no commas |
| X5 | 159 × `a` + `😀😀` | no lone surrogate | `a\ud83d…` | `cap` cuts a surrogate pair in half (see note 1) |
| U10 | `the vendor (www.x.com) said` | `the vendor said` | `the vendor ( said` | Cosmetic: the URL match takes the `)`, so a stray `(` is left |
| P9 | `Call (080) 2345-6789 now` | `Call now` | `Call ( now` | Cosmetic: same stray `(` (the number itself is removed) |
| U14 | `vendor acme.co.uk said` | `vendor said` | `vendor.uk said` | Cosmetic: `.uk` is left behind |
| U15 | `write mailto:ravi@x.com now` | `write now` | `write mailto: now` | Cosmetic: `mailto:` is left behind |

Behaviour observed by probes, outside the stated scope (not counted as failures):
- A UPI id such as `ravi@okaxis` is **not** removed: the email pattern needs a dot after the `@`. `9876543210@ybl` loses the digits and keeps `@ybl`.
- Names and places (`Can Ravi Kumar in Jhabua get paid by cheque`) are not removed. That is up to the prompt alone, as the plan intends.
- Job codes in the question (`How does S7 handle…`) are kept. `suggestions` filters out job codes, but `gap.question` does not.
- Phone numbers written in Devanagari digits (`९८७६५ ४३२१०`) are not removed, because `\d` only matches ASCII digits.
- An 8-digit local landline with no STD code (`2345 6789`) is kept, as the 9-digit rule intends.
- A question that becomes only punctuation after scrubbing (`ravi@x.in ?` → `?`) is still stored as a gap.

Note 1: JSON-encoding a lone surrogate gives `"\ud83d"`. Postgres `jsonb` usually rejects that, and if it does, `record_companion_turn` fails and the user sees "Cube's reply couldn't be saved". It only happens when the cut point falls on an emoji in a long run with no spaces (no space after about 60% of the limit), so it is very unlikely. The same `.slice` pattern already exists for `note` and `context`. **Unverified**: run this on the non-production project to confirm:
```sql
select '{"q":"a\ud83d…"}'::jsonb;   -- expect: ERROR … Unicode low surrogate …
```

---

## Part B: manual script (live; not run)

### Setup
1. Use a **non-production** Supabase project with migrations through `0036` applied and the `low-resource-language` playbook loaded (slug `low-resource-language`).
2. `.env.local`: `NEXT_PUBLIC_CUBE_VERSION=2`, `ANTHROPIC_API_KEY`, Supabase keys. Leave `COMPANION_V2_FAIL_AFTER_CHARS` unset. `npm run dev`.
3. Sign in as a fresh test adopter (adopter member of the playbook, not a contributor). Open `/companion/low-resource-language` and start a **new** conversation so the kickoff turn is the first row.
4. About 10 model calls, well under the daily cap of 60. Anthropic note (TD-16): the account is a free trial ending 28-Oct-2026, so check it is still active before you start.
5. DevTools open on the Console and Network tabs.

### Scripted conversation

The questions were chosen by searching `content/playbooks/low-resource-language.json` and `.source.md`. The "evidence" column says what the playbook does or doesn't contain. Send each message exactly as written, one per turn.

| # | Message to send | Playbook evidence | Expected `ui.gap` |
|---|---|---|---|
| Q0 | *(kickoff: Cube's opening message, nothing sent)* | n/a | `null` |
| Q1 | `Where do I start?` (starter chip) | Covered: sequence, I1/E2/P1 etc. | `null` |
| Q2 | `How do we make the voice service work for people who are deaf or hard of hearing?` | **Not covered.** No occurrences of `deaf`, `sign language`, `disab`, `impair` in either file. S3 (voice experience) covers only voice and telephony for low-literacy users. | `{"kind":"not_covered", "question":"<generic, e.g. How to serve deaf or hard-of-hearing users>", "job":"S3" or null, "topic":"<2–4 words, e.g. deaf user access>"}` |
| Q3 | `Our block coordinator Ravi Sharma (ravi.sharma@mp.gov.in, +91 98765 43210, see www.jhabua-voice.org) asks: how should we plan field recording around the monsoon, when some villages get cut off?` | **Not covered.** No occurrences of `monsoon`, `season`, `weather`, `harvest`. (S7 lists delays such as trust-building, validator availability and dropout, but nothing seasonal.) | `kind:"not_covered"` (`partly_covered` is acceptable only if the reply explicitly gives S7's delay guidance as a partial answer); `job:"S7"` or null; `question` has **no** `Ravi`, `Sharma`, `Jhabua`, `@`, `www`, `.org` or digits |
| Q4 | `The age mix says 20% of speakers should be aged 6–18. How do we take consent from children, and do parents have to sign?` | **Partly covered.** The 6–18 band is in the age mix (S4/S7). S6 covers consent: before recording, DPDP Act, granular in-language consent, right to withdraw. No occurrences of `child`, `minor`, `parent`, `guardian`. | `{"kind":"partly_covered", "job":"S6", …}`. The reply should give S6's consent guidance and say plainly that children/parental consent isn't covered, **without** filling in DPDP's parental-consent rule from general knowledge |
| Q5 | `How long does the pilot data collection take, and how long is the full collection after that?` | **Covered.** S7 `when`: "Pilot collection (about 1 month), then full collection (6–9 months, in 2–3 rounds)." | `null`; the reply says about 1 month, then 6–9 months in 2–3 rounds |
| Q6 | `Thanks, that's really helpful!` | Small talk | `null` |
| Q7 | `By the way, who won the last cricket World Cup?` | Off-topic | `null` (the reply may say this is outside the playbook, but it is not about the adoption, so no gap) |
| Q8 *(optional, unicode)* | `भीली के लिए भाषा सर्वेक्षण में कितना समय लगता है?` | Covered: P1 language survey, 1–2 months | `null`; the Devanagari user message and reply are stored and shown intact |

Pass rule per row: the stored `ui.gap` matches the column (kind exactly; question and topic judged by meaning, generic, no PII). Model output can vary, so if a row deviates, re-run that one question once in a new conversation and record both results.

### Inspect what was stored

Run in the Supabase SQL editor (service role, non-production project). Replace the email.

```sql
-- B-S1: every message of the test adopter's conversations in this playbook, oldest first
select m.created_at, m.role,
       left(m.content, 70)            as content,
       m.ui is null                   as ui_null,
       m.ui ? 'gap'                   as has_gap_key,
       m.ui -> 'gap'                  as gap
from companion_messages m
join companion_conversations c on c.id = m.conversation_id
join playbook_members pm      on pm.id = c.member_id
join playbooks p              on p.id = c.playbook_id
where p.slug = 'low-resource-language'
  and pm.user_id = (select id from auth.users where email = 'qa-adopter@example.com')
order by m.created_at;
```
Expected: user rows have `ui_null = true`. Every assistant row from this session has `has_gap_key = true`; `gap` is JSON `null` everywhere except Q2, Q3 (`not_covered`) and Q4 (`partly_covered`).

```sql
-- B-S2: shape check. Only the four keys, a valid kind, a known job or null, capped lengths
select m.id,
       (select array_agg(k order by k) from jsonb_object_keys(m.ui->'gap') k) as keys,
       m.ui->'gap'->>'kind'                     as kind,
       m.ui->'gap'->>'job'                      as job,
       exists (select 1 from playbook_jobs j
               where j.playbook_id = c.playbook_id
                 and j.job_code = m.ui->'gap'->>'job') as job_known,
       char_length(m.ui->'gap'->>'question')    as q_len,   -- <= 161
       char_length(m.ui->'gap'->>'topic')       as t_len,   -- <= 41
       m.ui->'gap'->>'question'                 as question
from companion_messages m
join companion_conversations c on c.id = m.conversation_id
join playbooks p on p.id = c.playbook_id
where p.slug = 'low-resource-language'
  and jsonb_typeof(m.ui->'gap') = 'object'
order by m.created_at desc;
```
Expected: `keys = {job,kind,question,topic}`; `kind` in (`not_covered`, `partly_covered`); `job_known` is true whenever `job` is not null.

```sql
-- B-S3: no contact details survived in any stored gap (should return zero rows)
select m.id, m.ui->'gap'
from companion_messages m
where jsonb_typeof(m.ui->'gap') = 'object'
  and ( (m.ui->'gap'->>'question') ~* '@|https?://|www\.|[a-z0-9-]+\.(com|org|net|in|gov|edu|io|co|info|ai)\b'
     or regexp_replace(m.ui->'gap'->>'question', '\D', '', 'g') ~ '\d{9,}'
     or (m.ui->'gap'->>'topic')    ~* '@|https?://|www\.' );
```
Also read the Q3 row by eye: the name "Ravi Sharma" and the place "Jhabua" must not appear. Only the prompt removes these; the sanitizer does not.

### Forced checks (deterministic, no reliance on the model)

Paste into the DevTools console on the companion page. It wraps `fetch` so the `/api/chat` reply's `<ui_action>` is rewritten before the hook sees it. The reply then appears all at once instead of streaming, which is expected for these checks. Reload the page to remove it.

```js
(() => {
  const orig = window.fetch.bind(window);
  window.__qa = 'off';   // 'badgap' | 'pii' | 'brokenjson' | 'nogap' | 'off'
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/api/chat') || !res.ok || window.__qa === 'off') return res;
    let text = await res.text();
    const m = text.match(/<ui_action>([\s\S]*?)<\/ui_action>/);
    if (m) {
      if (window.__qa === 'brokenjson') {
        text = text.replace(m[1], m[1].slice(0, -3));             // invalid JSON
      } else {
        const o = JSON.parse(m[1]);
        if (window.__qa === 'badgap') o.gap = { kind: 'maybe', question: 42, job: 'ZZ9', extra: 'x' };
        if (window.__qa === 'pii')    o.gap = { kind: 'not_covered',
          question: 'Ask ravi.sharma@mp.gov.in or call +91 98765 43210 / 080 2345 6789 about https://karya.in/pay and vaanitech.com',
          job: 'NOPE', topic: 'www.x.com contributor pay' };
        if (window.__qa === 'nogap')  delete o.gap;
        text = text.replace(m[1], JSON.stringify(o));
      }
    }
    console.log('[qa] rewritten ui_action:', text.slice(text.indexOf('<ui_action')));
    return new Response(text, { status: res.status, headers: res.headers });
  };
})();
```

| # | Steps | Expected |
|---|---|---|
| B-M1 (AC-5) | `window.__qa='badgap'`, send `What does the Nodal Officer do?` | The reply shows normally with no error banner. Its job chips (focusJobs) still render. Re-run B-S1: the new assistant row has `ui` not null and `gap = null`; the user row is present |
| B-M2 (AC-4) | `window.__qa='pii'`, send `Who owns the speech collection?` | Stored `gap` = `{"kind":"not_covered","question":"Ask or call about and","job":null,"topic":"contributor pay"}` (verified offline against the sanitizer; leftover connector words are acceptable; **no** `@`, digits, `karya.in`, `vaanitech.com`, `www`). B-S3 returns zero rows |
| B-M3 (AC-5) | `window.__qa='brokenjson'`, send `What is the quality bar?` | The reply shows; no block text on screen; the turn is saved with `ui IS NULL` (the hook sends `p_ui: null` when the block won't parse). Job chips and suggestions are absent for that reply; that is expected |
| B-M4 (older format) | `window.__qa='nogap'`, send `Who should come to the community meetings?` | Stored `ui.gap` is JSON `null` (the sanitizer always adds the key) |
| B-M5 | `window.__qa='off'`, reload | Normal streaming again |

### Block never shows on screen (AC-6)

| # | Steps | Expected |
|---|---|---|
| B-V1 | During Q2–Q4 (natural streaming), watch the reply as it streams, especially the last second | No `<ui_action`, `<ui_ac`, `{"focusJobs"`, `"gap"` or `not_covered` text appears at any point. (Part A S4 checked every streaming prefix offline) |
| B-V2 | After Q2–Q4, reload the page (the conversation loads from the DB) | The reply text has no block. `companion_messages.content` for those rows doesn't contain `ui_action`: `select count(*) from companion_messages where content ilike '%ui_action%';` returns 0 |
| B-V3 | Open an adopter conversation from before this change (Recent conversations) | It loads and renders job chips and suggestions as before. Its stored `ui` has no `gap` key, and nothing breaks |
| B-V4 | Mobile width (375 px) in DevTools, repeat B-V1 for one question | Same as B-V1 |

### Regression spot-checks (same session)
- Contributor chat (sign in as a playbook contributor, send one message): stored `ui` still has top-level `"kind":"contributor"` and **no** `gap` key. The contributor prompt is unchanged and the contributor hook doesn't call `sanitizeUiAction`.
- Q5's reply still shows `focusJobs`/`openJob` chips and 0–3 suggestion chips (the `gap` addition didn't break the other fields).
- Journey capture still works: send `We finished the language survey last month.`, then check `member_job_states` for P1 with `set_by='cube'`.

---

## Coverage gaps
- Part B hasn't been run: whether the model follows the prompt (AC-1 to AC-3, and AC-4 for model-written text) is unverified until someone runs it on a live server.
- The model alone removes names and places from `gap.question`. Code can't check this; only B-Q3's eyeball check covers it.
- `ui` is client-supplied, so an adopter calling `record_companion_turn` directly can store any gap, unsanitized. The plan accepts this for the test; it isn't tested here.
- Whether Postgres rejects a lone surrogate (Note 1) is unverified because there was no database access.
- There's no CI and no committed harness (TD-03), so Part A has to be re-run by hand from the appendix.

---

## Appendix: `test-gap.mts`

```ts
// QA for slice 6a: sanitizeUiAction gap handling + scrubContact.
// Run: node test-gap.mts   (Node 24, type stripping)
import { sanitizeUiAction, scrubContact, parseUiAction, stripUiAction, EMPTY_UI_ACTION } from './ui-action.ts';

const known = { jobCodes: new Set(['S3', 'S6', 'S7', 'E6', 'P2']), assetIds: new Set(['a1']) };
let pass = 0, fail = 0;
const results: string[] = [];
function check(id: string, desc: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  ok ? pass++ : fail++;
  results.push(`${ok ? 'PASS' : 'FAIL'} ${id} ${desc}${ok ? '' : `\n     expected: ${e}\n     actual:   ${a}`}`);
}
function checkTrue(id: string, desc: string, cond: boolean, detail: unknown) {
  cond ? pass++ : fail++;
  results.push(`${cond ? 'PASS' : 'FAIL'} ${id} ${desc}${cond ? '' : `\n     actual: ${JSON.stringify(detail)}`}`);
}
const base = { focusJobs: ['S7'], openJob: null, showAssets: [], context: {}, jobUpdates: [], suggestions: [] };
const gapOf = (gap: unknown) => sanitizeUiAction({ ...base, gap }, known).gap;
const g = (over: Record<string, unknown>) => ({ kind: 'not_covered', question: 'How to insure field equipment', job: 'S7', topic: 'equipment insurance', ...over });

// ---------------- Happy path ----------------
check('H1', 'valid not_covered gap kept as-is', gapOf(g({})), { kind: 'not_covered', question: 'How to insure field equipment', job: 'S7', topic: 'equipment insurance' });
check('H2', 'valid partly_covered gap kept', gapOf(g({ kind: 'partly_covered' }))?.kind, 'partly_covered');
check('H3', 'job null kept as null', gapOf(g({ job: null }))?.job, null);
check('H4', 'gap: null -> null', gapOf(null), null);
check('H5', 'rest of ui unaffected by gap', (() => { const u = sanitizeUiAction({ ...base, suggestions: ['Who owns it?'], gap: g({}) }, known); return [u.focusJobs, u.suggestions]; })(), [['S7'], ['Who owns it?']]);
check('H6', 'full prompt example block parses + sanitizes', (() => {
  const text = 'The playbook does not cover insurance.\n<ui_action>{"focusJobs":["S7"],"openJob":null,"showAssets":[],"context":{},"jobUpdates":[],"suggestions":["Who owns the speech collection?"],"gap":{"kind":"not_covered","question":"How to insure recording equipment used in the field","job":"S7","topic":"equipment insurance"}}</ui_action>';
  return sanitizeUiAction(parseUiAction(text), known).gap;
})(), { kind: 'not_covered', question: 'How to insure recording equipment used in the field', job: 'S7', topic: 'equipment insurance' });

// ---------------- Older / missing gap ----------------
check('O1', 'older ui without gap key -> gap null', sanitizeUiAction(base, known).gap, null);
check('O2', 'older ui: output has exactly the 7 keys', Object.keys(sanitizeUiAction(base, known)), ['focusJobs', 'openJob', 'showAssets', 'context', 'jobUpdates', 'suggestions', 'gap']);
check('O3', 'raw null -> EMPTY with gap null', sanitizeUiAction(null, known), { ...EMPTY_UI_ACTION });
check('O4', 'raw array -> gap null', sanitizeUiAction([g({})], known).gap, null);
check('O5', 'raw string -> gap null', sanitizeUiAction('{"gap":1}', known).gap, null);
check('O6', 'EMPTY_UI_ACTION not mutated across calls', (() => { const u = sanitizeUiAction(null, known); (u.suggestions as string[]).push('x'); return EMPTY_UI_ACTION.suggestions; })(), []);

// ---------------- Negative: invalid gap shapes ----------------
check('N1', 'unknown kind -> dropped', gapOf(g({ kind: 'maybe' })), null);
check('N2', 'kind wrong case -> dropped', gapOf(g({ kind: 'Not_Covered' })), null);
check('N3', 'kind missing -> dropped', gapOf({ question: 'x y', topic: 't', job: null }), null);
check('N4', 'kind number -> dropped', gapOf(g({ kind: 1 })), null);
check('N5', 'question missing -> dropped', gapOf(g({ question: undefined })), null);
check('N6', 'question number -> dropped', gapOf(g({ question: 42 })), null);
check('N7', 'question array -> dropped', gapOf(g({ question: ['a'] })), null);
check('N8', 'question empty -> dropped', gapOf(g({ question: '' })), null);
check('N9', 'question whitespace only -> dropped', gapOf(g({ question: '   \n\t ' })), null);
check('N10', 'question only an email -> dropped', gapOf(g({ question: 'ravi@vaani.in' })), null);
check('N11', 'topic missing -> dropped', gapOf(g({ topic: undefined })), null);
check('N12', 'topic null -> dropped', gapOf(g({ topic: null })), null);
check('N13', 'topic empty -> dropped', gapOf(g({ topic: '  ' })), null);
check('N14', 'topic only a phone number -> dropped', gapOf(g({ topic: '+91 98765 43210' })), null);
check('N15', 'gap is array -> dropped', gapOf([g({})]), null);
check('N16', 'gap is string -> dropped', gapOf('not covered'), null);
check('N17', 'gap is number/true -> dropped', [gapOf(1), gapOf(true)], [null, null]);
check('N18', 'gap is {} -> dropped', gapOf({}), null);
check('N19', 'unknown job code -> job null, gap kept', gapOf(g({ job: 'Z99' })), { kind: 'not_covered', question: 'How to insure field equipment', job: null, topic: 'equipment insurance' });
check('N20', 'lowercase job code -> null', gapOf(g({ job: 's7' }))?.job, null);
check('N21', 'job as number -> null', gapOf(g({ job: 7 }))?.job, null);
check('N22', 'job as array -> null', gapOf(g({ job: ['S7'] }))?.job, null);
check('N23', 'extra fields stripped', gapOf(g({ userId: 'abc', email: 'x@y.com', name: 'Ravi' })), { kind: 'not_covered', question: 'How to insure field equipment', job: 'S7', topic: 'equipment insurance' });
check('N24', 'malformed gap does not affect rest of ui', (() => { const u = sanitizeUiAction({ ...base, jobUpdates: [{ job: 'S7', state: 'done', note: 'n' }], gap: { kind: 'x', question: 5 } }, known); return [u.gap, u.jobUpdates.length, u.focusJobs]; })(), [null, 1, ['S7']]);
check('N25', 'malformed JSON block -> parse null (turn stored with p_ui null)', parseUiAction('hi <ui_action>{"gap":{"kind":"not_covered",}</ui_action>'), null);
check('N26', 'prototype keys ignored (__proto__ in JSON)', gapOf(JSON.parse('{"__proto__":{"kind":"not_covered"},"question":"q q","topic":"t"}')), null);

// ---------------- Scrub: emails ----------------
check('E1', 'email removed', scrubContact('Ask ravi.kumar@vaanitech.in about TDS'), 'Ask about TDS');
check('E2', 'email with plus/sub-domain', scrubContact('mail a.b+qa@mail.mp.gov.in now'), 'mail now');
check('E3', 'uppercase email', scrubContact('Contact RAVI@EXAMPLE.COM today'), 'Contact today');
check('E4', 'email at end with period', scrubContact('Write to ravi@x.org.'), 'Write to.');
check('E5', 'gap question with email', gapOf(g({ question: 'Can ravi@vaani.in pay contributors in cash?' }))?.question, 'Can pay contributors in cash?');

// ---------------- Scrub: URLs and bare domains ----------------
check('U1', 'https link removed', scrubContact('See https://bhashini.gov.in/ulca?x=1 for hosting'), 'See for hosting');
check('U2', 'http link removed, full stop kept', scrubContact('see http://example.com/a.'), 'see.');
check('U3', 'www link removed', scrubContact('Is www.vaanitech.co.in a good vendor?'), 'Is a good vendor?');
check('U4', 'bare .com domain', scrubContact('Is vaanitech.com reliable?'), 'Is reliable?');
check('U5', 'bare gov.in domain', scrubContact('Host on bhashini.gov.in or not'), 'Host on or not');
check('U6', 'bare domain with path', scrubContact('read karya.in/blog/post today'), 'read today');
check('U7', 'bare .ai/.io/.org/.net/.edu/.info', scrubContact('a.ai b.io c.org d.net e.edu f.info'), '');
check('U8', 'capitalised bare domain (Vaanitech.com) removed', scrubContact('Is Vaanitech.com ok'), 'Is ok');
check('U9', 'sentence "ready.In the" not a domain', scrubContact('We are ready.In the field'), 'We are ready.In the field');
check('U10', 'link inside parentheses leaves no empty parens', scrubContact('the vendor (www.x.com) said'), 'the vendor said');
check('U11', 'unknown TLD not stripped (documented scope)', scrubContact('see vaani.xyz'), 'see vaani.xyz');
check('U12', 'URL in gap topic', gapOf(g({ topic: 'www.x.com hosting' }))?.topic, 'hosting');
check('U13', 'ALL-CAPS domain kept (lowercase TLD rule)', scrubContact('VAANI.COM vendor'), 'VAANI.COM vendor');
check('U14', '.co.uk domain fully removed', scrubContact('vendor acme.co.uk said'), 'vendor said');
check('U15', 'mailto: link fully removed', scrubContact('write mailto:ravi@x.com now'), 'write now');

// ---------------- Scrub: Indian phone formats ----------------
check('P1', '098765 43210', scrubContact('Call 098765 43210 tomorrow'), 'Call tomorrow');
check('P2', '+91-98765-43210', scrubContact('Call +91-98765-43210 tomorrow'), 'Call tomorrow');
check('P3', '080 2345 6789 (landline with STD)', scrubContact('Office 080 2345 6789 today'), 'Office today');
check('P4', '+91 98765 43210', scrubContact('ph +91 98765 43210.'), 'ph.');
check('P5', '9876543210 bare 10 digits', scrubContact('mobile 9876543210 ok'), 'mobile ok');
check('P6', '+919876543210', scrubContact('wa +919876543210 ok'), 'wa ok');
check('P7', '0755-2551234', scrubContact('Bhopal 0755-2551234 ok'), 'Bhopal ok');
check('P8', '98765.43210 dotted', scrubContact('x 98765.43210 y'), 'x y');
check('P9', '(080) 2345-6789 parenthesised STD', scrubContact('Call (080) 2345-6789 now'), 'Call now');
check('P10', 'Aadhaar-shaped 1234 5678 9012', scrubContact('id 1234 5678 9012 ok'), 'id ok');
check('P11', 'toll-free 1800-180-1551', scrubContact('helpline 1800-180-1551 ok'), 'helpline ok');
check('P12', '8-digit local landline kept (below 9-digit rule)', scrubContact('dial 2345 6789'), 'dial 2345 6789');
check('P13', 'gap question with phone', gapOf(g({ question: 'Should we pay contributors by UPI to 98765 43210?' }))?.question, 'Should we pay contributors by UPI to?');

// ---------------- Must survive: years, ranges, amounts, percentages ----------------
check('K1', 'year', scrubContact('Started in 2024'), 'Started in 2024');
check('K2', 'year range hyphen', scrubContact('FY 2024-2025 budget'), 'FY 2024-2025 budget');
check('K3', 'year range en dash', scrubContact('FY 2024–2025'), 'FY 2024–2025');
check('K4', 'two years with space', scrubContact('in 2024 2025'), 'in 2024 2025');
check('K5', 'amount ₹50,00,000', scrubContact('budget ₹50,00,000 for collection'), 'budget ₹50,00,000 for collection');
check('K6', 'amount 15 lakh / 2.5 crore', scrubContact('15 lakh or 2.5 crore'), '15 lakh or 2.5 crore');
check('K7', 'percentage', scrubContact('50% telephony and 10% read'), '50% telephony and 10% read');
check('K8', '300 hours / 200K pairs', scrubContact('300 hours of audio and 200K pairs'), '300 hours of audio and 200K pairs');
check('K9', 'date 12/03/2025', scrubContact('on 12/03/2025'), 'on 12/03/2025');
check('K10', 'range 6–9 months', scrubContact('6–9 months in 2–3 rounds'), '6–9 months in 2–3 rounds');
check('K11', 'decimal 1,234.56', scrubContact('cost 1,234.56'), 'cost 1,234.56');
check('K12', 'amount 1500000 (7 digits) kept', scrubContact('Rs 1500000'), 'Rs 1500000');
check('K13', 'amount ₹15,00,00,000 with commas kept', scrubContact('₹15,00,00,000'), '₹15,00,00,000');
check('K14', 'age bands with hyphens and spaces kept', scrubContact('ages 6-18 18-45 45-60'), 'ages 6-18 18-45 45-60');
check('K15', 'date range 01/04/2025 - 31/03/2026 kept', scrubContact('period 01/04/2025 - 31/03/2026'), 'period 01/04/2025 - 31/03/2026');
check('K16', 'plain 9-digit amount kept (Rs 150000000)', scrubContact('Rs 150000000 total'), 'Rs 150000000 total');
check('K17', 'version / section numbers kept', scrubContact('see 3.4 and 7.1'), 'see 3.4 and 7.1');

// ---------------- Unicode ----------------
check('X1', 'Devanagari question kept', gapOf(g({ question: 'भीली में बच्चों से सहमति कैसे लें?' }))?.question, 'भीली में बच्चों से सहमति कैसे लें?');
check('X2', 'Devanagari with phone + email scrubbed', scrubContact('रवि से 98765 43210 या ravi@x.in पर बात करें'), 'रवि से या पर बात करें');
check('X3', 'Devanagari digits phone (९८७६५ ४३२१०) removed', scrubContact('फ़ोन ९८७६५ ४३२१०'), 'फ़ोन');
check('X4', 'Devanagari topic cap at 40', (() => { const t = gapOf(g({ topic: 'क'.repeat(60) }))!.topic; return [t.length, t.endsWith('…')]; })(), [41, true]);
checkTrue('X5', 'emoji at cut boundary leaves no lone surrogate', (() => {
  const q = gapOf(g({ question: 'a'.repeat(159) + '😀😀' }))!.question;
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(q);
})(), gapOf(g({ question: 'a'.repeat(159) + '😀😀' }))?.question.slice(-3));

// ---------------- Length caps / whitespace ----------------
const longQ = 'How should the district pay community contributors who record speech in remote villages when there is no bank branch nearby and many contributors do not have accounts or phones of their own at all';
check('L1', 'question <=160 untouched', gapOf(g({ question: 'x'.repeat(160) }))?.question.length, 160);
checkTrue('L2', 'long question capped at word boundary + ellipsis, <=161', (() => { const q = gapOf(g({ question: longQ }))!.question; return q.length <= 161 && q.endsWith('…') && !q.includes('  ') && longQ.startsWith(q.slice(0, -1)); })(), gapOf(g({ question: longQ }))?.question);
check('L3', 'question 161 chars no spaces -> hard cut 160 + …', gapOf(g({ question: 'y'.repeat(161) }))?.question.length, 161);
check('L4', 'topic 40 untouched', gapOf(g({ topic: 't'.repeat(40) }))?.topic.length, 40);
check('L5', 'topic long -> capped', (() => { const t = gapOf(g({ topic: 'contributor payment without bank accounts in remote villages' }))!.topic; return [t.length <= 41, t.endsWith('…')]; })(), [true, true]);
check('L6', 'whitespace/newlines collapsed', gapOf(g({ question: '  How   to\n\ninsure\tgear  ' }))?.question, 'How to insure gear');
check('L7', 'cap applied after scrub (email in long question gone)', gapOf(g({ question: 'ravi@x.in ' + 'word '.repeat(40) }))!.question.includes('@'), false);
check('L8', 'trailing punctuation trimmed before …', gapOf(g({ question: 'w'.repeat(120) + ', ' + 'z'.repeat(60) }))?.question, 'w'.repeat(120) + '…');
check('L9', 'exactly-one-char topic kept', gapOf(g({ topic: 'x' }))?.topic, 'x');

// ---------------- Leftover cosmetics ----------------
check('C1', 'question that scrubs to only "?" is still stored', gapOf(g({ question: 'ravi@x.in ?' }))?.question ?? null, '?');

// ---------------- stripUiAction keeps the block off screen ----------------
const block = '<ui_action>{"focusJobs":[],"openJob":null,"showAssets":[],"context":{},"jobUpdates":[],"suggestions":[],"gap":{"kind":"not_covered","question":"q","job":null,"topic":"t"}}</ui_action>';
check('S1', 'full block with gap stripped', stripUiAction('The playbook does not cover this.\n' + block), 'The playbook does not cover this.');
check('S2', 'partial stream mid-gap stripped', stripUiAction('Reply.\n' + block.slice(0, 120)), 'Reply.');
check('S3', 'partial tag "<ui_ac" stripped', stripUiAction('Reply.\n<ui_ac'), 'Reply.');
check('S4', 'every streaming prefix hides the block', (() => {
  const full = 'Not covered here.\n' + block;
  for (let i = 1; i <= full.length; i++) { const s = stripUiAction(full.slice(0, i)); if (s.includes('<') || s.includes('gap')) return full.slice(0, i); }
  return 'ok';
})(), 'ok');

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exitCode = fail ? 1 : 0;
```
