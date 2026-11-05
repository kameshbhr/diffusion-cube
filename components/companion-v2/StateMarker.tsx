import type { JobState } from '@/lib/companion-v2/types';

export const STATE_LABEL: Record<JobState, string> = {
  discussed: 'Discussed',
  in_progress: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};

const STYLE: Record<JobState, { dot: string; text: string }> = {
  discussed: { dot: 'bg-pb-muted/60', text: 'text-pb-muted' },
  in_progress: { dot: 'bg-pb-decide', text: 'text-pb-decide' },
  done: { dot: 'bg-pb-deliver', text: 'text-pb-deliver' },
  skipped: { dot: 'border border-pb-muted bg-transparent', text: 'text-pb-muted line-through decoration-pb-muted/50' },
};

// A small, calm marker for a job state. No marker at all means "not
// discussed", which is never shown as a gap or warning.
export default function StateMarker({ state, byUser, title }: { state: JobState; byUser?: boolean; title?: string }) {
  const s = STYLE[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}
      title={title ?? (byUser ? 'Set by you' : 'From your conversation with Cube')}
    >
      <span aria-hidden className={`h-2 w-2 flex-shrink-0 rounded-full ${s.dot}`} />
      {STATE_LABEL[state]}
    </span>
  );
}
