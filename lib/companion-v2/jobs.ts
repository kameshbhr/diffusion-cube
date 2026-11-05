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
