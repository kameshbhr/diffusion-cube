// The contributor Digest (docs/design/cube2-plan.md section 9): building the
// model's input, the output schema, validating what the model returns, and
// the view shown on the Digest tab. Pure: no React, no server imports, so it
// can be checked with a plain Node script.
//
// Code, never the model, decides: which items survive (every cited reference
// must be real), how many people stand behind an item, the dates and kind of
// an unanswered question, journey-state counts, and what remains after
// conversations are deleted. People are run-local labels (U1, U2): no user
// id, member id, name or email is ever stored or shown.

import { cap, scrubContact } from './ui-action';
import { GAP_KINDS, JOB_STATES, type GapKind, type JobState } from './types';

export const DIGEST_PERIODS = [7, 30] as const;
export type DigestPeriod = (typeof DIGEST_PERIODS)[number];
export const toPeriod = (v: unknown): DigestPeriod => (String(v) === '30' ? 30 : 7);

/** Below this many people, the banner says patterns can't be seen yet. */
export const FEW_USERS = 3;
/** Characters of each adopter message the model sees. */
const MESSAGE_CHARS = 300;

// ---------------------------------------------------------------------------
// Shapes from the 0037 functions
// ---------------------------------------------------------------------------

export interface DigestStats {
  users_total: number;
  users_period: number;
  conversations_total: number;
  conversations_period: number;
  jobs: { job: string; name: string; conversations: number }[];
  conversation_ids: string[];
}

export interface RawDigestInput {
  messages_total: number;
  messages: { id: string; conversation_id: string; person: number; created_at: string; content: string }[];
  gaps: { id: string; conversation_id: string; person: number; created_at: string; gap: unknown }[];
}

export interface StateCountRow {
  job_code: string;
  state: string;
  people: number;
}

export type StateCounts = Record<string, Partial<Record<JobState, number>>>;

export function toStateCounts(rows: StateCountRow[]): StateCounts {
  const out: StateCounts = {};
  for (const r of rows) {
    if (!JOB_STATES.includes(r.state as JobState)) continue;
    (out[r.job_code] ??= {})[r.state as JobState] = Number(r.people);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The stored payload
// ---------------------------------------------------------------------------

/** One conversation behind an item, with the run-local label of its person. */
export interface ConvRef {
  c: string;
  p: string;
}

export interface Theme { title: string; summary: string; jobs: string[]; convs: ConvRef[] }
export interface Unanswered {
  question: string;
  topic: string;
  job: string | null;
  kind: GapKind | 'mixed';
  dates: string[];
  convs: ConvRef[];
}
export interface Stuck { job: string; observation: string; convs: ConvRef[]; state_only: boolean }
export interface Term { term: string; observation: string; convs: ConvRef[] }
export interface Remark { about: 'cube' | 'playbook'; summary: string; convs: ConvRef[] }

export const SECTIONS = ['themes', 'unanswered', 'stuck', 'terms', 'complaints', 'working'] as const;
export type Section = (typeof SECTIONS)[number];

export interface SummaryBullet {
  text: string;
  refs: { section: Section; index: number }[];
}

export interface DigestPayload {
  version: 1;
  period_days: DigestPeriod;
  basis: { messages_used: number; messages_total: number; gaps_used: number; convs: ConvRef[] };
  summary: SummaryBullet[];
  themes: Theme[];
  unanswered: Unanswered[];
  stuck: Stuck[];
  terms: Term[];
  complaints: Remark[];
  working: Remark[];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** What each reference in the input stands for. Kept in memory for one run. */
export interface RefMaps {
  M: Map<string, ConvRef>;
  G: Map<string, ConvRef & { date: string; kind: GapKind }>;
}

/** YYYY-MM-DD in India time. */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = (iso: string) => DAY.format(new Date(iso));

/** One line of input: no line breaks, no "|" (the field separator), no tags. */
const oneLine = (s: string) => s.replace(/[\r\n|]+/g, ' ').replace(/</g, '‹').replace(/\s+/g, ' ').trim();

export interface BuiltInput {
  text: string;
  refs: RefMaps;
  basis: DigestPayload['basis'];
  people: number;
}

export function buildDigestInput(
  raw: RawDigestInput,
  jobs: { job_code: string; name: string }[],
  states: StateCounts,
  period: DigestPeriod,
  now = new Date()
): BuiltInput {
  const jobCodes = new Set(jobs.map((j) => j.job_code));
  // Relabel people U1, U2… in order of first appearance, for this run only.
  const label = new Map<number, string>();
  const personOf = (n: number) => {
    if (!label.has(n)) label.set(n, `U${label.size + 1}`);
    return label.get(n)!;
  };

  const refs: RefMaps = { M: new Map(), G: new Map() };
  const convs = new Map<string, string>();

  const messageLines = raw.messages.map((m, i) => {
    const ref = `M${i + 1}`;
    const p = personOf(Number(m.person));
    refs.M.set(ref, { c: m.conversation_id, p });
    convs.set(m.conversation_id, p);
    const text = cap(oneLine(scrubContact(m.content)), MESSAGE_CHARS);
    return `${ref} | ${p} | ${dayOf(m.created_at)} | ${text}`;
  });

  const gapLines: string[] = [];
  for (const g of raw.gaps) {
    // Stored gaps came from the browser: check and scrub them again here.
    const gap = g.gap as Record<string, unknown> | null;
    if (!gap || typeof gap !== 'object') continue;
    const kind = gap.kind as GapKind;
    if (!GAP_KINDS.includes(kind) || typeof gap.question !== 'string' || typeof gap.topic !== 'string') continue;
    const question = cap(oneLine(scrubContact(gap.question)), 160);
    const topic = cap(oneLine(scrubContact(gap.topic)), 40);
    if (!question || !topic) continue;
    const job = typeof gap.job === 'string' && jobCodes.has(gap.job) ? gap.job : '-';
    const ref = `G${refs.G.size + 1}`;
    const p = personOf(Number(g.person));
    const date = dayOf(g.created_at);
    refs.G.set(ref, { c: g.conversation_id, p, date, kind });
    convs.set(g.conversation_id, p);
    gapLines.push(`${ref} | ${p} | ${date} | ${kind} | ${job} | ${topic} | ${question}`);
  }

  const jobLines = jobs.map((j) => {
    const s = states[j.job_code] ?? {};
    return `${j.job_code} | ${oneLine(j.name)} | ${s.discussed ?? 0} | ${s.in_progress ?? 0} | ${s.done ?? 0} | ${s.skipped ?? 0}`;
  });

  const from = dayOf(new Date(now.getTime() - period * 86_400_000).toISOString());
  const capped = raw.messages_total > raw.messages.length;
  const text = [
    `Period: the last ${period} days (${from} to ${dayOf(now.toISOString())}).`,
    `People in this period: ${label.size}. Messages: ${raw.messages.length}${capped ? ` (the most recent ${raw.messages.length} of ${raw.messages_total})` : ''}. Gap entries: ${gapLines.length}.`,
    '',
    '<jobs>',
    'code | name | discussed | in progress | done | skipped   (current journey-state counts, till date, people per state)',
    ...jobLines,
    '</jobs>',
    '',
    '<messages>',
    'ref | person | date | the person\'s own message',
    ...messageLines,
    '</messages>',
    '',
    '<gaps>',
    'ref | person | date | kind | job | topic | question',
    ...gapLines,
    '</gaps>',
    '',
    'Write the digest with the record_digest tool.',
  ].join('\n');

  return {
    text,
    refs,
    people: label.size,
    basis: {
      messages_used: raw.messages.length,
      messages_total: Number(raw.messages_total),
      gaps_used: gapLines.length,
      convs: [...convs].map(([c, p]) => ({ c, p })),
    },
  };
}

// ---------------------------------------------------------------------------
// Output schema (forced tool use). Summary is the last property, written last.
// ---------------------------------------------------------------------------

const refList = (prefix: 'M' | 'G', what: string) => ({
  type: 'array',
  items: { type: 'string', pattern: `^${prefix}[0-9]+$` },
  description: what,
});
const about = { type: 'string', enum: ['cube', 'playbook'] };

export const DIGEST_TOOL = {
  name: 'record_digest',
  description: 'Record the digest. Every item must cite the references it rests on.',
  input_schema: {
    type: 'object' as const,
    properties: {
      themes: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            jobs: { type: 'array', items: { type: 'string' }, description: 'Job codes, if any' },
            evidence: refList('M', 'Message refs (M…) this theme rests on'),
          },
          required: ['title', 'summary', 'jobs', 'evidence'],
        },
      },
      unanswered: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            topic: { type: 'string' },
            job: { type: ['string', 'null'] },
            entries: refList('G', 'Gap entry refs (G…) grouped here'),
          },
          required: ['question', 'topic', 'job', 'entries'],
        },
      },
      stuck: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            job: { type: 'string' },
            observation: { type: 'string' },
            evidence: refList('M', 'Message refs (M…); may be empty if it rests only on the state counts'),
          },
          required: ['job', 'observation', 'evidence'],
        },
      },
      terms: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: { term: { type: 'string' }, observation: { type: 'string' }, evidence: refList('M', 'Message refs (M…)') },
          required: ['term', 'observation', 'evidence'],
        },
      },
      complaints: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: { about, summary: { type: 'string' }, evidence: refList('M', 'Message refs (M…)') },
          required: ['about', 'summary', 'evidence'],
        },
      },
      working: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: { about, summary: { type: 'string' }, evidence: refList('M', 'Message refs (M…)') },
          required: ['about', 'summary', 'evidence'],
        },
      },
      summary: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            refs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Items above this bullet rests on, e.g. "themes[0]", "unanswered[2]"',
            },
          },
          required: ['text', 'refs'],
        },
      },
    },
    required: ['themes', 'unanswered', 'stuck', 'terms', 'complaints', 'working', 'summary'],
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Per-section item limits (the schema's maxItems, enforced here too). */
const LIMITS: Record<Section, number> = { themes: 8, unanswered: 12, stuck: 8, terms: 8, complaints: 8, working: 8 };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Model text as stored: contact details removed; stray references (U3, M12,
 * G2) and job codes removed (the app shows job names); one line, capped.
 */
function makeClean(jobCodes: Set<string>) {
  const codes = [...jobCodes].filter(Boolean).map(escapeRe);
  const CODE = codes.length ? new RegExp(`\\b(?:${codes.join('|')})\\b`, 'g') : null;
  return (v: unknown, max: number): string => {
    if (typeof v !== 'string') return '';
    let s = scrubContact(v).replace(/\b[UMG]\d+\b/g, ' ');
    if (CODE) s = s.replace(CODE, ' ');
    s = s
      .replace(/\(\s*(?:[,;/&]|and|\s)*\)|\[\s*(?:[,;/&]|and|\s)*\]/g, ' ')
      .replace(/\s+([,.;:?!)\]])/g, '$1')
      .replace(/([,;:])(?:\s*[,;:])+/g, '$1');
    return cap(oneLine(s), max).replace(/‹/g, '<').replace(/^[\s,;:.-]+/, '');
  };
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Resolves every reference, or returns null if any doesn't resolve (an item
 * that cites something that isn't there is dropped whole).
 */
function resolve<T extends ConvRef>(v: unknown, map: Map<string, T>): T[] | null {
  const out: T[] = [];
  for (const r of arr(v)) {
    const hit = typeof r === 'string' ? map.get(r.trim()) : undefined;
    if (!hit) return null;
    out.push(hit);
  }
  return out;
}

/** Distinct conversations, each with its person. */
const toConvs = (refs: ConvRef[]): ConvRef[] => {
  const seen = new Map<string, string>();
  for (const r of refs) if (!seen.has(r.c)) seen.set(r.c, r.p);
  return [...seen].map(([c, p]) => ({ c, p }));
};

/**
 * Turns the model's tool input into the stored payload. Items that cite
 * anything that doesn't exist are dropped; counts, dates and kinds are
 * derived here from the cited references, never taken from the model.
 */
export function validateDigest(
  raw: unknown,
  refs: RefMaps,
  ctx: { jobCodes: Set<string>; states: StateCounts; period: DigestPeriod; basis: DigestPayload['basis'] }
): DigestPayload {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  // Original index (as the model numbered it) → index among kept items.
  const kept: Record<Section, Map<number, number>> = {
    themes: new Map(), unanswered: new Map(), stuck: new Map(), terms: new Map(), complaints: new Map(), working: new Map(),
  };
  const clean = makeClean(ctx.jobCodes);
  const keep = <T,>(section: Section, out: T[], i: number, item: T | null) => {
    if (!item || out.length >= LIMITS[section]) return;
    kept[section].set(i, out.length);
    out.push(item);
  };
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

  const themes: Theme[] = [];
  arr(r.themes).forEach((v, i) => {
    const t = obj(v);
    const ev = t && resolve(t.evidence, refs.M);
    const title = clean(t?.title, 100);
    const summary = clean(t?.summary, 400);
    keep('themes', themes, i, t && ev?.length && title && summary
      ? { title, summary, jobs: [...new Set(arr(t.jobs).filter((j): j is string => typeof j === 'string' && ctx.jobCodes.has(j)))], convs: toConvs(ev) }
      : null);
  });

  const unanswered: Unanswered[] = [];
  arr(r.unanswered).forEach((v, i) => {
    const u = obj(v);
    const entries = u && resolve(u.entries, refs.G);
    const question = clean(u?.question, 200);
    const topic = clean(u?.topic, 40);
    if (!u || !entries?.length || !question || !topic) return;
    const kinds = new Set(entries.map((e) => e.kind));
    keep('unanswered', unanswered, i, {
      question,
      topic,
      job: typeof u.job === 'string' && ctx.jobCodes.has(u.job) ? u.job : null,
      kind: kinds.size === 1 ? [...kinds][0] : 'mixed',
      dates: [...new Set(entries.map((e) => e.date))].sort(),
      convs: toConvs(entries),
    });
  });

  const stuck: Stuck[] = [];
  arr(r.stuck).forEach((v, i) => {
    const s = obj(v);
    const observation = clean(s?.observation, 400);
    const job = typeof s?.job === 'string' && ctx.jobCodes.has(s.job) ? s.job : null;
    if (!s || !job || !observation) return;
    const ev = resolve(s.evidence, refs.M);
    if (!ev) return;
    // No message evidence: kept only if there are journey states for the job.
    const hasStates = Object.values(ctx.states[job] ?? {}).some((n) => (n ?? 0) > 0);
    if (!ev.length && !hasStates) return;
    keep('stuck', stuck, i, { job, observation, convs: toConvs(ev), state_only: ev.length === 0 });
  });

  const terms: Term[] = [];
  arr(r.terms).forEach((v, i) => {
    const t = obj(v);
    const ev = t && resolve(t.evidence, refs.M);
    const term = clean(t?.term, 60);
    const observation = clean(t?.observation, 400);
    keep('terms', terms, i, t && ev?.length && term && observation ? { term, observation, convs: toConvs(ev) } : null);
  });

  const remarks = (section: 'complaints' | 'working') => {
    const out: Remark[] = [];
    arr(r[section]).forEach((v, i) => {
      const c = obj(v);
      const ev = c && resolve(c.evidence, refs.M);
      const summary = clean(c?.summary, 400);
      const ab = c?.about === 'cube' || c?.about === 'playbook' ? c.about : null;
      keep(section, out, i, c && ev?.length && summary && ab ? { about: ab, summary, convs: toConvs(ev) } : null);
    });
    return out;
  };
  const complaints = remarks('complaints');
  const working = remarks('working');

  // Summary: every ref must point at an item that survived.
  const REF = /^(themes|unanswered|stuck|terms|complaints|working)\[(\d+)\]$/;
  const summary: SummaryBullet[] = [];
  for (const v of arr(r.summary)) {
    if (summary.length === 3) break;
    const b = obj(v);
    const text = clean(b?.text, 300);
    const list = arr(b?.refs);
    if (!b || !text || !list.length) continue;
    const out: SummaryBullet['refs'] = [];
    for (const ref of list) {
      const m = typeof ref === 'string' ? ref.trim().match(REF) : null;
      const index = m ? kept[m[1] as Section].get(Number(m[2])) : undefined;
      if (!m || index === undefined) {
        out.length = 0;
        break;
      }
      if (!out.some((o) => o.section === m[1] && o.index === index)) out.push({ section: m[1] as Section, index });
    }
    if (out.length) summary.push({ text, refs: out });
  }

  return { version: 1, period_days: ctx.period, basis: ctx.basis, summary, themes, unanswered, stuck, terms, complaints, working };
}

// ---------------------------------------------------------------------------
// The view: a stored digest against the conversations that still exist
// ---------------------------------------------------------------------------

export interface ViewItem<T> {
  item: T;
  convIds: string[];
  people: number;
}

export interface DigestView {
  basis: { people: number; conversations: number; messagesUsed: number; messagesTotal: number };
  summary: { text: string; people: number; convIds: string[] }[];
  themes: ViewItem<Theme>[];
  unanswered: ViewItem<Unanswered>[];
  stuck: ViewItem<Stuck>[];
  terms: ViewItem<Term>[];
  complaints: ViewItem<Remark>[];
  working: ViewItem<Remark>[];
}

/**
 * Drops conversations that no longer exist (deleted by the person, or by
 * account deletion), recounts people from what remains, and hides any item
 * or summary bullet left with nothing. A "stuck" item that rests only on
 * journey states has no conversations and stays.
 */
/** Conversation refs of a stored item; tolerates a malformed payload. */
const convsOf = (item: unknown): ConvRef[] => {
  const list = item && typeof item === 'object' ? (item as { convs?: unknown }).convs : null;
  return arr(list).filter(
    (c): c is ConvRef => !!c && typeof (c as ConvRef).c === 'string' && typeof (c as ConvRef).p === 'string'
  );
};

/** Text fields a section's items must have, so a malformed stored item is skipped rather than crashing the page. */
const REQUIRED: Record<Section, string[]> = {
  themes: ['title', 'summary'],
  unanswered: ['question', 'topic'],
  stuck: ['job', 'observation'],
  terms: ['term', 'observation'],
  complaints: ['summary'],
  working: ['summary'],
};
const wellFormed = (section: Section, item: unknown) =>
  !!item && typeof item === 'object' && REQUIRED[section].every((k) => typeof (item as Record<string, unknown>)[k] === 'string');

export function viewDigest(payload: DigestPayload, live: Set<string>): DigestView {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<DigestPayload>;
  const viewOf = <T,>(item: T, alwaysShow = false): ViewItem<T> | null => {
    const convs = convsOf(item).filter((c) => live.has(c.c));
    if (!convs.length && !alwaysShow) return null;
    return { item, convIds: convs.map((c) => c.c), people: new Set(convs.map((c) => c.p)).size };
  };
  // Keep each section's original positions so summary refs still line up.
  const sectionView = <T,>(section: Section, always?: (t: T) => boolean) =>
    arr(p[section]).map((t) => {
      if (!wellFormed(section, t)) return null;
      const item = t as T;
      if (section === 'themes') (item as Theme).jobs = arr((item as Theme).jobs).filter((j): j is string => typeof j === 'string');
      if (section === 'unanswered') (item as Unanswered).dates = arr((item as Unanswered).dates).filter((d): d is string => typeof d === 'string');
      return viewOf(item, always?.(item));
    });

  const all: Record<Section, (ViewItem<unknown> | null)[]> = {
    themes: sectionView<Theme>('themes'),
    unanswered: sectionView<Unanswered>('unanswered'),
    stuck: sectionView<Stuck>('stuck', (s) => s.state_only === true),
    terms: sectionView<Term>('terms'),
    complaints: sectionView<Remark>('complaints'),
    working: sectionView<Remark>('working'),
  };

  const summary: DigestView['summary'] = [];
  for (const raw of arr(p.summary)) {
    const b = raw as Partial<SummaryBullet> | null;
    if (!b || typeof b.text !== 'string') continue;
    const cited = arr(b.refs).map((r) => {
      const ref = r as { section?: unknown; index?: unknown } | null;
      return ref && SECTIONS.includes(ref.section as Section) && typeof ref.index === 'number'
        ? (all[ref.section as Section][ref.index] ?? null)
        : null;
    });
    // A bullet is shown only while every item it rests on is still shown.
    if (!cited.length || cited.some((c) => !c)) continue;
    const convs = new Map<string, string>();
    for (const c of cited) for (const cv of convsOf(c!.item)) if (live.has(cv.c)) convs.set(cv.c, cv.p);
    summary.push({ text: b.text, convIds: [...convs.keys()], people: new Set(convs.values()).size });
  }

  const basisConvs = convsOf(p.basis).filter((c) => live.has(c.c));
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const present = <T,>(xs: (ViewItem<unknown> | null)[]) => xs.filter((x): x is ViewItem<T> => x !== null);
  return {
    basis: {
      people: new Set(basisConvs.map((c) => c.p)).size,
      conversations: basisConvs.length,
      messagesUsed: num(p.basis?.messages_used),
      messagesTotal: num(p.basis?.messages_total),
    },
    summary,
    themes: present<Theme>(all.themes),
    unanswered: present<Unanswered>(all.unanswered),
    stuck: present<Stuck>(all.stuck),
    terms: present<Term>(all.terms),
    complaints: present<Remark>(all.complaints),
    working: present<Remark>(all.working),
  };
}
