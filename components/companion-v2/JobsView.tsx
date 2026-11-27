'use client';

import { useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import AssetLink, { type AssetLinkData } from './AssetLink';
import JobSheet from './JobSheet';
import { allOwners, phaseTitle, shortWhen, stageTitles } from '@/lib/companion-v2/jobs';
import type { JobRow, PlaybookPhase } from '@/lib/companion-v2/types';

interface Props {
  slug: string;
  jobs: JobRow[];
  phases: PlaybookPhase[];
  assets: AssetLinkData[];
  assetJobs: Record<string, string[]>;
}

const ALL = '';

// View Jobs: every job in sequence order, grouped under the step where it
// first appears, each with who owns and who tracks it. People filter by
// owner. No framework labels, no per-person roles or progress markers.
export default function JobsView({ slug, jobs, phases, assets, assetJobs }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openCode = searchParams.get('open');
  const [owner, setOwner] = useState(ALL);
  const owners = useMemo(() => allOwners(jobs), [jobs]);

  const visible = useMemo(
    () => (owner === ALL ? jobs : jobs.filter((j) => (j.body.owners ?? []).includes(owner))),
    [jobs, owner]
  );

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const byCode = new Map(visible.map((j) => [j.job_code, j]));
    const out: { phase: PlaybookPhase | null; jobs: JobRow[] }[] = [];
    for (const phase of phases) {
      const list: JobRow[] = [];
      for (const code of phase.jobs) {
        const job = byCode.get(code);
        if (job && !seen.has(code)) {
          seen.add(code);
          list.push(job);
        }
      }
      if (list.length) out.push({ phase, jobs: list });
    }
    const rest = visible.filter((j) => !seen.has(j.job_code));
    if (rest.length) out.push({ phase: null, jobs: rest });
    return out;
  }, [visible, phases]);

  const stepTitles = useMemo(() => stageTitles(phases), [phases]);
  const general = assets.filter((a) => !(assetJobs[a.id] ?? []).length);
  const openJob = openCode ? jobs.find((j) => j.job_code === openCode) ?? null : null;

  const setOpen = (code: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (code) params.set('open', code);
    else params.delete('open');
    const qs = params.toString();
    // Client-only URL update: opening or closing a job doesn't refetch the page.
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm leading-relaxed text-pb-muted">
          Every job in this adoption, in the order they usually happen, with who owns and who tracks each one.
        </p>
        {owners.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-pb-muted">
            Owned by
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="rounded-lg border border-pb-line bg-pb-surface px-2 py-1 text-sm text-pb-ink"
            >
              <option value={ALL}>Anyone</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mt-6 space-y-8">
        {groups.map(({ phase, jobs: list }, gi) => (
          <section key={phase?.name ?? 'other'} aria-labelledby={`phase-${gi}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
              <h2 id={`phase-${gi}`} className="font-serif text-base font-bold text-pb-ink">
                {phase ? phaseTitle(phase.name) : 'Other jobs'}
              </h2>
              {phase && <span className="text-xs text-pb-muted">{phase.when}</span>}
            </div>
            <ul className="divide-y divide-pb-line-soft overflow-hidden rounded-xl border border-pb-line bg-pb-surface">
              {list.map((j) => {
                const jobOwners = j.body.owners ?? [];
                return (
                  <li key={j.job_code}>
                    <button
                      type="button"
                      onClick={() => setOpen(j.job_code)}
                      className="block w-full px-4 py-3 text-left transition hover:bg-pb-accent-soft/40 focus-visible:bg-pb-accent-soft/40"
                    >
                      <span className="text-[15px] font-medium text-pb-ink">{j.name}</span>
                      {j.body.when && (
                        <span className="mt-0.5 block text-[13px] leading-snug text-pb-muted">{shortWhen(j.body.when)}</span>
                      )}
                      <span className="mt-1 grid gap-0.5 text-xs leading-snug text-pb-muted sm:grid-cols-[auto_1fr] sm:gap-x-2">
                        <span className="font-medium text-pb-muted">Who owns</span>
                        <span>
                          {jobOwners.length ? jobOwners.join(', ') : <span className="italic">No owner named in the playbook</span>}
                        </span>
                        <span className="font-medium text-pb-muted">Who tracks</span>
                        <span>{(j.body.tracked_by ?? []).join(', ') || 'Not stated'}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {!groups.length && (
          <p className="rounded-xl border border-dashed border-pb-line bg-pb-surface px-5 py-6 text-sm text-pb-muted">
            No jobs to show.
          </p>
        )}

        {general.length > 0 && (
          <section aria-labelledby="general-resources">
            <h2 id="general-resources" className="mb-2 font-serif text-base font-bold text-pb-ink">
              General resources
            </h2>
            <ul className="space-y-2 rounded-xl border border-pb-line bg-pb-surface px-4 py-3">
              {general.map((a) => (
                <li key={a.id} className="text-sm">
                  <AssetLink asset={a} className="font-medium text-pb-accent underline-offset-2 hover:underline" />
                  {a.description && <p className="mt-0.5 text-xs text-pb-muted">{a.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {openJob && (
        <JobSheet
          key={openJob.job_code}
          stepTitles={stepTitles}
          slug={slug}
          job={openJob}
          assets={assets.filter((a) => (assetJobs[a.id] ?? []).includes(openJob.job_code))}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
