'use client';

import { useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import StateMarker from './StateMarker';
import AssetLink, { type AssetLinkData } from './AssetLink';
import JobSheet from './JobSheet';
import { phaseTitle, shortWhen, stageTitles, tagFor } from '@/lib/companion-v2/jobs';
import type { JobRow, JobStateRow, PlaybookPhase } from '@/lib/companion-v2/types';

interface Props {
  slug: string;
  memberId: string;
  projectRole: string;
  jobs: JobRow[];
  phases: PlaybookPhase[];
  assets: AssetLinkData[];
  assetJobs: Record<string, string[]>;
  initialStates: JobStateRow[];
}

function Owners({ owners, role }: { owners: string[]; role: string }) {
  if (!owners.length) return <span className="italic text-pb-muted">No owner named in the playbook</span>;
  return (
    <>
      {owners.map((o, i) => (
        <span key={o}>
          {i > 0 && ', '}
          {o === role ? <strong className="font-semibold text-pb-ink">{o}</strong> : o}
        </span>
      ))}
    </>
  );
}

// Adopter Jobs screen: every job for the user's role, in sequence order,
// grouped under the step where it first appears. No framework labels.
export default function JobsView({ slug, memberId, projectRole, jobs, phases, assets, assetJobs, initialStates }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openCode = searchParams.get('open');

  const [onlyMine, setOnlyMine] = useState(false);
  const [states, setStates] = useState<Record<string, JobStateRow>>(() =>
    Object.fromEntries(initialStates.map((s) => [s.job_code, s]))
  );

  // A job appears for a role when the role owns or tracks it.
  const visible = useMemo(
    () =>
      jobs.filter((j) => {
        const tag = tagFor(j.body, projectRole);
        return onlyMine ? tag === 'Owns' : tag !== null;
      }),
    [jobs, onlyMine, projectRole]
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

  const ownsCount = jobs.filter((j) => tagFor(j.body, projectRole) === 'Owns').length;
  const trackedCount = jobs.filter((j) => tagFor(j.body, projectRole) !== null).length;
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
          Every job in this adoption, in the order they usually happen. As the {projectRole}, you track{' '}
          {trackedCount === jobs.length ? 'all of them' : `${trackedCount} of them`} and own {ownsCount}.
        </p>
        <div role="group" aria-label="Which jobs to show" className="inline-flex rounded-full border border-pb-line bg-pb-surface p-0.5 text-sm">
          {[
            { v: false, label: 'All jobs' },
            { v: true, label: 'Only mine' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={onlyMine === o.v}
              onClick={() => setOnlyMine(o.v)}
              className={`rounded-full px-3.5 py-1 transition ${
                onlyMine === o.v ? 'bg-pb-accent text-white' : 'text-pb-muted hover:text-pb-ink'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
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
                const tag = tagFor(j.body, projectRole);
                const state = states[j.job_code];
                return (
                  <li key={j.job_code}>
                    <button
                      type="button"
                      onClick={() => setOpen(j.job_code)}
                      className="block w-full px-4 py-3 text-left transition hover:bg-pb-accent-soft/40 focus-visible:bg-pb-accent-soft/40"
                    >
                      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <span className="text-[15px] font-medium text-pb-ink">{j.name}</span>
                        <span className="flex items-center gap-3">
                          {state && <StateMarker state={state.state} byUser={state.set_by === 'user'} />}
                          {tag && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                tag === 'Owns' ? 'bg-pb-accent text-white' : 'bg-pb-accent-soft text-pb-accent'
                              }`}
                            >
                              {tag}
                            </span>
                          )}
                        </span>
                      </span>
                      {j.body.when && (
                        <span className="mt-0.5 block text-[13px] leading-snug text-pb-muted">{shortWhen(j.body.when)}</span>
                      )}
                      <span className="mt-1 grid gap-0.5 text-xs leading-snug text-pb-muted sm:grid-cols-[auto_1fr] sm:gap-x-2">
                        <span className="font-medium text-pb-muted">Who owns</span>
                        <span>
                          <Owners owners={j.body.owners ?? []} role={projectRole} />
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
          memberId={memberId}
          projectRole={projectRole}
          job={openJob}
          assets={assets.filter((a) => (assetJobs[a.id] ?? []).includes(openJob.job_code))}
          state={states[openJob.job_code] ?? null}
          onStateChange={(row) =>
            setStates((prev) => {
              const next = { ...prev };
              if (row) next[openJob.job_code] = row;
              else delete next[openJob.job_code];
              return next;
            })
          }
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
