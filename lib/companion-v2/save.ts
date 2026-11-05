// Saves a playbook change with one save_playbook() call (migration 0034):
// contributor check, stale check against the updated_at the contributor
// loaded, the write, and the content guards, all in one transaction.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SaveArgs } from './patch';

export type SaveOutcome =
  | { ok: true; updatedAt: string }
  | { ok: false; kind: 'stale' | 'guard' | 'forbidden' | 'error'; message: string };

export async function savePlaybook(
  supabase: SupabaseClient,
  playbookId: string,
  /** The updated_at string exactly as loaded (microseconds matter). */
  baseUpdatedAt: string,
  args: SaveArgs
): Promise<SaveOutcome> {
  const { data, error } = await supabase.rpc('save_playbook', {
    p_playbook_id: playbookId,
    p_base_updated_at: baseUpdatedAt,
    p_playbook: args.playbook,
    p_jobs: args.jobs.map((j) => ({
      job_code: j.job_code,
      name: j.name,
      position: j.position,
      stages: j.stages,
      work_area: j.work_area,
      job_type: j.job_type,
      body: j.body,
    })),
    p_removed_jobs: args.removed,
  });

  if (!error) return { ok: true, updatedAt: data as string };

  switch (error.code) {
    case 'P0409':
      return {
        ok: false,
        kind: 'stale',
        message: 'Someone changed the playbook since you loaded it. Reload to see their change, then make yours again.',
      };
    case 'P0422':
      return { ok: false, kind: 'guard', message: 'The credits must keep the CC BY 4.0 licence and the attribution to EkStep.' };
    case 'P0423':
      return { ok: false, kind: 'guard', message: 'Content marked "Only for Author" can’t be published.' };
    case '42501':
      return { ok: false, kind: 'forbidden', message: 'Only contributors to this playbook can change it.' };
    default:
      console.error('[save_playbook] failed:', error);
      return { ok: false, kind: 'error', message: `The change couldn’t be saved: ${error.message}` };
  }
}
