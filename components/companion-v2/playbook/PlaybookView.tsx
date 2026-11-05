'use client';

import { useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { serializePlaybook } from '@/lib/companion-v2/playbook-json.mjs';
import type { JobRow, PlaybookRow } from '@/lib/companion-v2/types';
import OverviewTab from './OverviewTab';
import RolesTab from './RolesTab';
import JobsMapTab from './JobsMapTab';
import SequenceTab from './SequenceTab';
import JobDrawer from './JobDrawer';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'roles', label: 'Roles' },
  { id: 'map', label: 'Jobs map' },
  { id: 'sequence', label: 'Sequence' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled; some browsers cancel otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Contributor Playbook view: a React port of the playbook HTML prototype
// (Overview, Roles, Jobs map, Sequence, and the job drawer). Read-only in
// Slice 4a; edit controls come in Slice 4b. ?tab= picks the tab and ?open=
// opens a job's drawer, so both can be linked to.
export default function PlaybookView({ playbook, jobs }: { playbook: PlaybookRow; jobs: JobRow[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'overview';
  const openCode = searchParams.get('open');
  const openJob = openCode ? jobs.find((j) => j.job_code === openCode) ?? null : null;

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      // Client-only URL update (useSearchParams follows history.replaceState):
      // switching tabs or opening the drawer doesn't refetch the page.
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams]
  );
  const openJobDrawer = useCallback((code: string) => setParam('open', code), [setParam]);
  const closeDrawer = useCallback(() => setParam('open', null), [setParam]);

  // Local date for the filename (not UTC).
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const downloadJson = () =>
    download(
      `${playbook.slug}-${date}.json`,
      serializePlaybook({
        slug: playbook.slug,
        title: playbook.title,
        description: playbook.description,
        overview: playbook.overview,
        roles: playbook.roles,
        sequence: playbook.sequence,
        jobs,
      }),
      'application/json'
    );
  const downloadSource = () => download(`${playbook.slug}-${date}.source.md`, playbook.source_doc, 'text/markdown');

  return (
    <div className="text-[15px] leading-[1.55] text-pb-ink">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-7 gap-y-3">
        <p className="max-w-[62ch] text-pb-muted">{playbook.description}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            onClick={downloadJson}
            className="rounded-lg border border-pb-line bg-pb-surface px-3 py-1.5 transition hover:border-pb-accent"
            title="A backup of the playbook in the format the seed script accepts"
          >
            Download playbook as JSON
          </button>
          <button
            type="button"
            onClick={downloadSource}
            className="rounded-lg border border-pb-line bg-pb-surface px-3 py-1.5 transition hover:border-pb-accent"
          >
            Download source document
          </button>
        </div>
      </div>

      <nav className="mb-[22px] flex gap-1 overflow-x-auto border-b border-pb-line" role="tablist" aria-label="Playbook sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`pb-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="pb-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = TABS.findIndex((x) => x.id === tab);
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              setParam('tab', next.id === 'overview' ? null : next.id);
              document.getElementById(`pb-tab-${next.id}`)?.focus();
            }}
            onClick={() => setParam('tab', t.id === 'overview' ? null : t.id)}
            className={`-mb-px whitespace-nowrap border-b-[3px] px-3.5 py-2.5 font-medium transition ${
              tab === t.id ? 'border-pb-accent text-pb-ink' : 'border-transparent text-pb-muted hover:text-pb-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div role="tabpanel" id="pb-panel" aria-labelledby={`pb-tab-${tab}`}>
        {tab === 'overview' && <OverviewTab overview={playbook.overview} />}
        {tab === 'roles' && <RolesTab roles={playbook.roles} jobs={jobs} onOpenJob={openJobDrawer} />}
        {tab === 'map' && <JobsMapTab jobs={jobs} framework={playbook.sequence?.framework} onOpenJob={openJobDrawer} />}
        {tab === 'sequence' && <SequenceTab sequence={playbook.sequence ?? {}} jobs={jobs} onOpenJob={openJobDrawer} />}
      </div>

      {openJob && <JobDrawer key={openJob.job_code} job={openJob} onClose={closeDrawer} />}
    </div>
  );
}
