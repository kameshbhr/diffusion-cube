// Parses and strips the <ui_action> block at the end of a companion-v2 reply.
// Same pattern as lib/grid-update.ts, and free of React so both the route and
// the client hook can import it. The model never writes to the database: the
// client validates this block against the loaded playbook and persists it.

import {
  CONTEXT_KEYS,
  GAP_KINDS,
  JOB_STATES,
  type CompanionContext,
  type GapKind,
  type JobState,
  type UiAction,
  type UiGap,
} from './types';

const OPEN = '<ui_action';
const BLOCK = /<ui_action>([\s\S]*?)<\/ui_action>/;

export const EMPTY_UI_ACTION: UiAction = {
  focusJobs: [],
  openJob: null,
  showAssets: [],
  context: {},
  jobUpdates: [],
  suggestions: [],
  gap: null,
};

/** Raw JSON of the block, or null if it is missing or not valid JSON. */
export function parseUiAction(text: string): unknown | null {
  const match = text.match(BLOCK);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Cuts at the opening tag rather than matching a closed block, so a block
 * that has only partly streamed in never shows on screen.
 */
export function stripUiAction(text: string): string {
  const idx = text.indexOf(OPEN);
  if (idx > -1) return text.slice(0, idx).trim();
  // Hide a tag that is still arriving ("<ui_ac") at the very end of the text.
  for (let n = Math.min(OPEN.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(OPEN.slice(0, n))) return text.slice(0, text.length - n).trimEnd();
  }
  return text.trim();
}

const NOTE_MAX = 300;
const CONTEXT_VALUE_MAX = 300;
const SUGGESTION_MAX = 90;
const GAP_QUESTION_MAX = 160;
const GAP_TOPIC_MAX = 40;

const EMAIL = /(?:mailto:)?[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
// UPI ids and other handles with no dot after the @ (ravi@okaxis).
const HANDLE = /[\w.-]{2,}@[a-z][a-z0-9]+\b/gi;
// Links end on a character that isn't closing punctuation, so "(see www.x.com)"
// keeps its ")" and the empty brackets are tidied away below.
const LINK_END = `[^\\s<>"'.,;:!?)\\]]`;
const URL_LIKE = new RegExp(`(?:\\b(?:https?|ftp):\\/\\/|\\bwww\\.)(?:[^\\s<>"]*${LINK_END})?`, 'gi');
// Bare domains (incl. short links: bit.ly, forms.gle, wa.me, t.me, x.co.uk).
// The ending must be lowercase, so a capitalised sentence start after a
// missing space ("ready.In the") is never taken for one.
const DOMAIN_LIKE = new RegExp(
  `\\b[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.(?:com|org|net|in|gov|edu|io|co|info|ai|ly|gle|me|app|link|gl|uk)\\b(?:\\/(?:[^\\s<>"]*${LINK_END})?)?`,
  'g'
);
// Runs of digits (any script) joined by spaces, brackets, dots or hyphens.
// Not "/", so dates like 01/04/2025 never join up. See isPhoneLike.
const DIGIT_RUN = /[+(]?\p{Nd}[\p{Nd}\s().-]{6,}\p{Nd}/gu;
const AFTER_CURRENCY = /(?:\brs\.?|₹|\binr)\s*$/i;
const ISO_DATE_RANGE = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}(?:\s*-\s*\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2})?$/u;

/**
 * Whether a digit run looks like a phone (or Aadhaar-like) number:
 * 9-13 digits with at least one group of 3+ digits, or any run starting
 * with "+". Longer runs (two numbers side by side) count too, except ISO
 * date ranges. Age bands ("6-18 18-45"), years, "2024-2025" and amounts
 * after Rs/₹/INR stay. Local landlines without the STD code (6-8 digits)
 * are not caught.
 */
function isPhoneLike(run: string, before: string): boolean {
  if (AFTER_CURRENCY.test(before)) return false;
  const groups = run.match(/\p{Nd}+/gu) ?? [];
  const digits = groups.join('').length;
  if (digits < 9) return false;
  if (run.startsWith('+')) return true;
  if (Math.max(...groups.map((g) => g.length)) < 3) return false;
  if (digits <= 13) return true;
  return !ISO_DATE_RANGE.test(run.trim());
}

/** Removes emails, handles, links and phone-like numbers, then tidies the leftovers. */
export function scrubContact(s: string): string {
  return s
    .replace(EMAIL, ' ')
    .replace(HANDLE, ' ')
    .replace(URL_LIKE, ' ')
    .replace(DOMAIN_LIKE, ' ')
    .replace(DIGIT_RUN, (m, offset: number, whole: string) => (isPhoneLike(m, whole.slice(0, offset)) ? ' ' : m))
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+([,.;:?!)\]])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuts at a word boundary when one is near the limit; never splits a character (emoji). */
export function cap(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return (space > cut.length * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

/** The unanswered-question entry, or null if it is missing or invalid. */
function sanitizeGap(v: unknown, jobCodes: Set<string>): UiGap | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { kind, question, job, topic } = v as Record<string, unknown>;
  if (typeof kind !== 'string' || !GAP_KINDS.includes(kind as GapKind)) return null;
  if (typeof question !== 'string' || typeof topic !== 'string') return null;
  const q = cap(scrubContact(question), GAP_QUESTION_MAX);
  const t = cap(scrubContact(topic), GAP_TOPIC_MAX);
  if (!q || !t) return null;
  return {
    kind: kind as GapKind,
    question: q,
    job: typeof job === 'string' && jobCodes.has(job) ? job : null,
    topic: t,
  };
}

/**
 * Keeps only what is valid for this playbook: known job codes and asset ids,
 * the four job states, the four context keys, string values. Anything else
 * the model produced is dropped silently.
 */
export function sanitizeUiAction(
  raw: unknown,
  known: { jobCodes: Set<string>; assetIds: Set<string> }
): UiAction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_UI_ACTION, context: {}, jobUpdates: [], suggestions: [], gap: null };
  const r = raw as Record<string, unknown>;

  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const unique = <T,>(a: T[]) => [...new Set(a)];

  const focusJobs = unique(strings(r.focusJobs).filter((c) => known.jobCodes.has(c))).slice(0, 3);
  const openJob = typeof r.openJob === 'string' && known.jobCodes.has(r.openJob) ? r.openJob : null;
  const showAssets = unique(strings(r.showAssets).filter((id) => known.assetIds.has(id))).slice(0, 5);

  const context: CompanionContext = {};
  if (r.context && typeof r.context === 'object' && !Array.isArray(r.context)) {
    const c = r.context as Record<string, unknown>;
    for (const key of CONTEXT_KEYS) {
      const v = c[key];
      if (typeof v === 'string' && v.trim()) context[key] = v.trim().slice(0, CONTEXT_VALUE_MAX);
    }
  }

  const jobUpdates: UiAction['jobUpdates'] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.jobUpdates)) {
    for (const u of r.jobUpdates) {
      if (!u || typeof u !== 'object') continue;
      const { job, state, note } = u as Record<string, unknown>;
      if (typeof job !== 'string' || !known.jobCodes.has(job) || seen.has(job)) continue;
      if (typeof state !== 'string' || !JOB_STATES.includes(state as JobState)) continue;
      seen.add(job);
      jobUpdates.push({
        job,
        state: state as JobState,
        note: typeof note === 'string' ? note.trim().slice(0, NOTE_MAX) : '',
      });
    }
  }

  // Follow-up questions: short plain text, no duplicates, never a job code
  // (codes are for the block only, never shown to the person).
  const seenText = new Set<string>();
  const suggestions = strings(r.suggestions)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || s.length > SUGGESTION_MAX || seenText.has(key)) return false;
      if (s.split(/[^A-Za-z0-9]+/).some((w) => known.jobCodes.has(w))) return false;
      seenText.add(key);
      return true;
    })
    .slice(0, 3);

  const gap = sanitizeGap(r.gap, known.jobCodes);

  return { focusJobs, openJob, showAssets, context, jobUpdates, suggestions, gap };
}
