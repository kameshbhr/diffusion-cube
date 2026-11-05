import type { JobRow, PlaybookSequence } from '@/lib/companion-v2/types';
import { Card, EditButton, JobChip, KV } from './shared';

// Milestones, the stages with their jobs, and the hard rules.
export default function SequenceTab({
  sequence,
  jobs,
  onOpenJob,
  onEdit,
}: {
  sequence: PlaybookSequence;
  jobs: JobRow[];
  onOpenJob: (code: string) => void;
  onEdit?: (target: { kind: 'milestones' } | { kind: 'stagesNote' } | { kind: 'rules' } | { kind: 'phase'; index: number | null; after?: number }) => void;
}) {
  const byCode = new Map(jobs.map((j) => [j.job_code, j]));
  return (
    <div className="grid gap-[18px]">
      {!!sequence.milestones?.length && (
        <Card title="Milestones" onEdit={onEdit ? () => onEdit({ kind: 'milestones' }) : undefined}>
          <KV entries={sequence.milestones} />
          {sequence.milestones_note && <p className="mx-0.5 mt-3 max-w-[90ch] text-[13px] text-pb-muted">{sequence.milestones_note}</p>}
        </Card>
      )}

      <Card title="Stages and timing">
        {onEdit && (
          <div className="-mt-1 mb-2 flex flex-wrap gap-2">
            <EditButton label="Add a step at the start" onClick={() => onEdit({ kind: 'phase', index: null, after: -1 })} />
            <EditButton label="Edit the note on the stages" onClick={() => onEdit({ kind: 'stagesNote' })} />
          </div>
        )}
        {(sequence.phases ?? []).map((p, i) => (
          <div
            key={`${p.name}-${i}`}
            className="grid gap-x-[22px] gap-y-1.5 border-t border-pb-line-soft py-3.5 first:border-t-0 md:grid-cols-[200px_1fr]"
          >
            <div>
              <h3 className="font-serif text-base font-bold">{p.name}</h3>
              <div className="mt-0.5 text-[13px] text-pb-muted">{p.when}</div>
              {onEdit && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <EditButton ariaLabel={`Edit step: ${p.name}`} onClick={() => onEdit({ kind: 'phase', index: i })} />
                  <EditButton label="Add a step after" ariaLabel={`Add a step after ${p.name}`} onClick={() => onEdit({ kind: 'phase', index: null, after: i })} />
                </div>
              )}
            </div>
            <div>
              <p className="mb-2">{p.text}</p>
              <div className="flex flex-wrap gap-1.5">
                {p.jobs.map((code) => {
                  const j = byCode.get(code);
                  return j ? <JobChip key={code} job={j} onOpen={onOpenJob} /> : null;
                })}
              </div>
            </div>
          </div>
        ))}
        {sequence.note && <p className="mx-0.5 mt-3 max-w-[90ch] text-[13px] text-pb-muted">{sequence.note}</p>}
      </Card>

      <Card title="Hard rules" onEdit={onEdit ? () => onEdit({ kind: 'rules' }) : undefined}>
        {(sequence.rules ?? []).map((r, i) => (
          <div key={i} className="border-t border-pb-line-soft py-2.5 first:border-t-0">
            <b className="block">{r.rule}</b>
            {r.why && <span className="text-pb-muted">{r.why}</span>}
          </div>
        ))}
      </Card>
    </div>
  );
}
