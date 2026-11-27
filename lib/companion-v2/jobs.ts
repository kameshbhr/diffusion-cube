// Helpers for showing jobs. There are no per-person roles: every job shows
// who owns and who tracks it, and people filter by owner.

import type { JobRow, PlaybookPhase } from './types';

/** Jobs in sequence order, then by code. */
export function sortJobs<T extends { position: number | null; job_code: string }>(jobs: T[]): T[] {
  return [...jobs].sort(
    (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.job_code.localeCompare(b.job_code, 'en', { numeric: true })
  );
}

/** Every owner named across the jobs, sorted, for the Jobs filter. */
export function allOwners(jobs: Pick<JobRow, 'body'>[]): string[] {
  return [...new Set(jobs.flatMap((j) => j.body.owners ?? []))].sort((a, b) => a.localeCompare(b));
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
