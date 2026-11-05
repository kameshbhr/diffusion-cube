// Owns / Tracks for a user's project role, derived from a job's owners and
// tracked_by (spec section 2.3). A job appears for a role when the role is in
// either list.

import type { JobBody, PlaybookPhase } from './types';

export type RoleTag = 'Owns' | 'Tracks';

export function tagFor(body: JobBody, projectRole: string): RoleTag | null {
  if ((body.owners ?? []).includes(projectRole)) return 'Owns';
  if ((body.tracked_by ?? []).includes(projectRole)) return 'Tracks';
  return null;
}

/** The phase each job first appears in, keyed by job code. */
export function firstPhaseByJob(phases: PlaybookPhase[]): Map<string, PlaybookPhase> {
  const out = new Map<string, PlaybookPhase>();
  for (const phase of phases) for (const code of phase.jobs) if (!out.has(code)) out.set(code, phase);
  return out;
}

/** First sentence of a job's "when", trimmed for a list row or card. */
export function shortWhen(when: string | undefined): string {
  if (!when) return '';
  const first = when.split(/(?<=\.)\s/)[0] ?? when;
  return first.length > 110 ? `${first.slice(0, 107).trimEnd()}…` : first;
}

/** "Stage 3: Scope definition, …" -> "Scope definition, …" (plain words first). */
export function phaseTitle(name: string): string {
  return name.replace(/^Stage\s+\d+\s*:\s*/i, '');
}

/** Key for a checklist row's stage: "Stage 3" -> "stage 3". */
export function stageKey(stage: string): string {
  return stage.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Maps a checklist row's stage ("Stage 3") to the plain title of that step. */
export function stageTitles(phases: PlaybookPhase[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of phases) {
    const m = p.name.match(/^Stage\s+\d+/i);
    if (m) out.set(stageKey(m[0]), phaseTitle(p.name));
  }
  return out;
}
