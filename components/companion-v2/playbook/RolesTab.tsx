'use client';

import { useMemo, useState } from 'react';
import type { JobRow, PlaybookRole } from '@/lib/companion-v2/types';
import { JobChip, NS } from './shared';

const PMU_ROLE = 'Project Management Unit (PMU)';

function jobsOwnedBy(jobs: JobRow[], keys: string[]) {
  return jobs.filter((j) => (j.body.owners ?? []).some((o) => keys.includes(o)));
}

function jobsNamedIn(jobs: JobRow[], names: string[]) {
  if (!names.length) return [];
  return jobs.filter((j) => {
    const r = j.body.roles ?? {};
    const text = [r.owns, r.does, r.reviews, r.enables].filter((x) => x && x !== NS).join(' ');
    return names.some((n) => text.includes(n));
  });
}

/** Roles from the playbook, plus owners named in the checklist that no role card covers. */
function allRoles(roles: PlaybookRole[], jobs: JobRow[]): PlaybookRole[] {
  const known = new Set(roles.flatMap((r) => r.owner_keys ?? []));
  const extra = [...new Set(jobs.flatMap((j) => j.body.owners ?? []))].filter((o) => !known.has(o));
  return [
    ...roles,
    ...extra.map((o) => ({
      name: o,
      group: 'Named in the checklist',
      description: 'Named as an owner in the DC checklist. Not described as a role in the playbook.',
      example: '',
      see: '',
      owner_keys: [o],
      playbook_names: [],
    })),
  ];
}

export default function RolesTab({
  roles,
  jobs,
  onOpenJob,
}: {
  roles: PlaybookRole[];
  jobs: JobRow[];
  onOpenJob: (code: string) => void;
}) {
  const [group, setGroup] = useState('All');
  const [q, setQ] = useState('');
  const everyone = useMemo(() => allRoles(roles, jobs), [roles, jobs]);
  const groups = useMemo(() => ['All', ...new Set(everyone.map((r) => r.group))], [everyone]);
  const pmuOwned = jobs.filter((j) => (j.body.owners ?? []).includes('PMU'));
  const pmuTracked = jobs.filter((j) => (j.body.tracked_by ?? []).includes('PMU'));

  const query = q.trim().toLowerCase();
  const shown = everyone.filter(
    (r) => (group === 'All' || r.group === group) && (!query || `${r.name} ${r.description}`.toLowerCase().includes(query))
  );

  return (
    <div>
      <div className="mb-4 rounded-[10px] border border-pb-line bg-pb-accent-soft px-5 py-[18px]">
        <h2 className="mb-1.5 font-serif text-xl font-bold text-pb-ink">PMU tracks every job</h2>
        <p className="max-w-[75ch]">
          PMU is responsible for tracking all the jobs. It owns the jobs where the DC checklist names PxD, PMU or the Nodal
          Officer’s team as the owner. The Nodal Officer is a separate role, so jobs the Nodal Officer owns are tracked by
          PMU, not owned.
        </p>
        <div className="my-2.5 flex flex-wrap gap-[22px] text-[13.5px] text-pb-muted">
          <span>
            <b className="block font-serif text-2xl leading-tight text-pb-ink">{pmuOwned.length}</b>jobs PMU owns
          </span>
          <span>
            <b className="block font-serif text-2xl leading-tight text-pb-ink">{pmuTracked.length}</b>jobs PMU tracks
          </span>
        </div>
        <details className="border-t border-pb-line pt-2">
          <summary className="cursor-pointer text-[13px] font-medium">Show the jobs PMU owns</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pmuOwned.map((j) => (
              <JobChip key={j.job_code} job={j} onOpen={onOpenJob} />
            ))}
          </div>
        </details>
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search roles"
          aria-label="Search roles"
          className="max-w-[320px] flex-[1_1_220px] rounded-md border border-pb-line bg-pb-surface px-3 py-2 text-[15px] outline-none focus:border-pb-accent"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter roles by group">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
              className={`rounded-full border px-2.5 py-1 text-[13px] transition ${
                group === g ? 'border-pb-accent bg-pb-accent-soft' : 'border-pb-line bg-pb-surface'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {shown.length ? (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {shown.map((r) => {
            const owned = r.owner_keys?.length ? jobsOwnedBy(jobs, r.owner_keys) : [];
            const ownedCodes = new Set(owned.map((j) => j.job_code));
            const named = jobsNamedIn(jobs, r.playbook_names ?? []).filter((j) => !ownedCodes.has(j.job_code));
            return (
              <article
                key={r.name}
                className={`flex flex-col gap-2 rounded-[10px] border bg-pb-surface px-[18px] py-4 ${
                  r.name === PMU_ROLE ? 'border-pb-accent' : 'border-pb-line'
                }`}
              >
                <div className="text-[11.5px] uppercase tracking-[0.04em] text-pb-muted">{r.group}</div>
                <h3 className="font-serif text-base font-bold">{r.name}</h3>
                <p>{r.description}</p>
                {r.example && <p className="text-[13px] text-pb-muted">{r.example}</p>}
                {r.see && <p className="text-[13px] text-pb-muted">{r.see}</p>}
                {owned.length > 0 && (
                  <details className="border-t border-pb-line-soft pt-2">
                    <summary className="cursor-pointer text-[13px] font-medium">
                      Owns {owned.length} job{owned.length > 1 ? 's' : ''} in the checklist
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {owned.map((j) => (
                        <JobChip key={j.job_code} job={j} onOpen={onOpenJob} />
                      ))}
                    </div>
                  </details>
                )}
                {named.length > 0 && (
                  <details className="border-t border-pb-line-soft pt-2">
                    <summary className="cursor-pointer text-[13px] font-medium">
                      Named in the playbook for {named.length} more job{named.length > 1 ? 's' : ''}
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {named.map((j) => (
                        <JobChip key={j.job_code} job={j} onOpen={onOpenJob} />
                      ))}
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="text-[13px] text-pb-muted">No roles match.</p>
      )}
    </div>
  );
}
