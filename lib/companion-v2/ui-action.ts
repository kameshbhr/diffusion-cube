// Parses and strips the <ui_action> block at the end of a companion-v2 reply.
// Same pattern as lib/grid-update.ts, and free of React so both the route and
// the client hook can import it. The model never writes to the database: the
// client validates this block against the loaded playbook and persists it.

import { CONTEXT_KEYS, JOB_STATES, type CompanionContext, type JobState, type UiAction } from './types';

const OPEN = '<ui_action';
const BLOCK = /<ui_action>([\s\S]*?)<\/ui_action>/;

export const EMPTY_UI_ACTION: UiAction = {
  focusJobs: [],
  openJob: null,
  showAssets: [],
  context: {},
  jobUpdates: [],
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

/**
 * Keeps only what is valid for this playbook: known job codes and asset ids,
 * the four job states, the four context keys, string values. Anything else
 * the model produced is dropped silently.
 */
export function sanitizeUiAction(
  raw: unknown,
  known: { jobCodes: Set<string>; assetIds: Set<string> }
): UiAction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_UI_ACTION, context: {} };
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

  return { focusJobs, openJob, showAssets, context, jobUpdates };
}
