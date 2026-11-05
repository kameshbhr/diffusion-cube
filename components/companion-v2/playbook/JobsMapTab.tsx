'use client';

import { useState } from 'react';
import type { JobRow, PlaybookFramework } from '@/lib/companion-v2/types';
import { MATURITY_FLAG, NoOwnerFlag, OwnersText, typeColor } from './shared';

function Tile({ job, cont, dim, onOpen }: { job: JobRow; cont: boolean; dim: boolean; onOpen: (code: string) => void }) {
  const b = job.body;
  const owners = b.owners ?? [];
  const flag = b.maturity?.flag ? MATURITY_FLAG[b.maturity.flag] : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(job.job_code)}
      data-code={job.job_code}
      className={`block w-full rounded-md border border-l-4 border-pb-line px-3 py-2 text-left text-[13.5px] leading-snug transition hover:bg-pb-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pb-accent ${
        cont ? 'border-dashed bg-transparent text-pb-muted' : 'bg-pb-surface'
      } ${dim ? 'opacity-[0.22]' : ''}`}
      style={{ borderLeftColor: typeColor(job.job_type), borderLeftStyle: 'solid' }}
    >
      <span>
        {job.name}
        {b.recurs ? ' ↻' : ''}
        {!owners.length && <NoOwnerFlag />}
        {flag && (
          <span className={`ml-1 inline-block rounded-full px-[7px] py-px align-[1px] text-[11px] ${flag.className}`}>{flag.label}</span>
        )}
      </span>
      <small className="mt-[3px] block text-[11.5px] text-pb-muted">
        {job.job_type}
        {cont ? ' · continues' : ''}
      </small>
      <small className="mt-[3px] block text-[11.5px] text-pb-muted">
        Who owns: <OwnersText owners={owners} limit={3} />
      </small>
      <small className="mt-[3px] block text-[11.5px] text-pb-muted">Who tracks: {(b.tracked_by ?? []).join(', ')}</small>
    </button>
  );
}

// The stage x work area matrix. A job's tile is solid where it starts and
// dashed in the stages it continues into. Filters dim tiles, as in the prototype.
export default function JobsMapTab({
  jobs,
  framework,
  onOpenJob,
}: {
  jobs: JobRow[];
  framework: PlaybookFramework | undefined;
  onOpenJob: (code: string) => void;
}) {
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [pmuOnly, setPmuOnly] = useState(false);

  const stages = framework?.stages ?? [];
  const areas = framework?.areas ?? [];
  const typeList = framework?.types ?? [];
  if (!stages.length || !areas.length) return <p className="text-sm text-pb-muted">This playbook has no jobs map.</p>;

  const query = q.trim().toLowerCase();
  const matches = (j: JobRow) => {
    if (types.size && !types.has(j.job_type)) return false;
    if (pmuOnly && !(j.body.owners ?? []).includes('PMU')) return false;
    if (query && !`${j.job_code} ${j.name} ${j.body.intended_result ?? ''}`.toLowerCase().includes(query)) return false;
    return true;
  };

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs"
          aria-label="Search jobs"
          className="max-w-[320px] flex-[1_1_220px] rounded-md border border-pb-line bg-pb-surface px-3 py-2 text-[15px] outline-none focus:border-pb-accent"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by job type">
          {typeList.map((t) => {
            const on = types.has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(t)) next.delete(t);
                    else next.add(t);
                    return next;
                  })
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] ${
                  on ? 'border-pb-accent bg-pb-accent-soft' : 'border-pb-line bg-pb-surface'
                }`}
              >
                <span aria-hidden className="h-[9px] w-[9px] rounded-full" style={{ background: typeColor(t) }} />
                {t}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={pmuOnly}
          onClick={() => setPmuOnly((v) => !v)}
          className={`rounded-full border px-2.5 py-1 text-[13px] ${
            pmuOnly ? 'border-pb-accent bg-pb-accent-soft' : 'border-pb-line bg-pb-surface'
          }`}
        >
          PMU owns
        </button>
      </div>

      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-pb-muted">
        <span>Solid tile: where the job starts</span>
        <span>Dashed tile: the job continues in this stage</span>
        <span>↻ the job recurs across build rounds</span>
        <span>Who owns: the roles that own the job’s checklist items, with PMU in bold. Who tracks: PMU tracks every job.</span>
        <span>“PMU owns” shows only the jobs where PMU is an owner. The Nodal Officer is a separate role from PMU.</span>
      </p>

      <div className="overflow-x-auto rounded-lg border border-pb-line bg-pb-surface">
        <div className="grid min-w-[1070px]" style={{ gridTemplateColumns: `150px repeat(${stages.length}, minmax(230px, 1fr))` }}>
          <div className="sticky top-0 border-b border-pb-line bg-pb-surface px-3.5 py-3" />
          {stages.map((s) => (
            <div key={s.name} className="sticky top-0 border-b border-pb-line bg-pb-surface px-3.5 py-3">
              <b className="block font-serif text-base">{s.name}</b>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-pb-muted">{s.info}</span>
            </div>
          ))}
          {areas.map((a, ai) => {
            const last = ai === areas.length - 1;
            return (
              <div key={a.name} className="contents">
                <div className={`border-r border-pb-line bg-pb-bg p-3.5 ${last ? '' : 'border-b border-b-pb-line-soft'}`}>
                  <b className="block text-sm">{a.name}</b>
                  <span className="mt-[3px] block text-xs leading-snug text-pb-muted">{a.info}</span>
                </div>
                {stages.map((s) => (
                  <div
                    key={s.name}
                    className={`flex min-h-[90px] flex-col gap-[7px] border-l border-pb-line-soft p-2.5 ${
                      last ? '' : 'border-b border-b-pb-line-soft'
                    }`}
                  >
                    {jobs
                      .filter((j) => j.work_area === a.name && j.stages.includes(s.name))
                      .map((j) => (
                        <Tile key={j.job_code} job={j} cont={j.stages[0] !== s.name} dim={!matches(j)} onOpen={onOpenJob} />
                      ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mx-0.5 mt-3 max-w-[90ch] text-[13px] text-pb-muted">
        Stage, work area and job type placements are a first mapping of the playbook’s content onto the jobs framework.
        Where the content gives no timing, the placement is an assumption.
      </p>
    </div>
  );
}
