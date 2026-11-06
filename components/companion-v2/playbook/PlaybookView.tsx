'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { serializePlaybook } from '@/lib/companion-v2/playbook-json.mjs';
import type { JobRow, PlaybookRow } from '@/lib/companion-v2/types';
import OverviewTab from './OverviewTab';
import RolesTab from './RolesTab';
import JobsMapTab from './JobsMapTab';
import SequenceTab from './SequenceTab';
import JobDrawer from './JobDrawer';
import EditDialog from './edit/EditDialog';
import {
  JobEditForm,
  MilestonesForm,
  NewJobForm,
  OVERVIEW_TITLES,
  OverviewForm,
  PhaseForm,
  RoleForm,
  RulesForm,
  StagesNoteForm,
  type OverviewSection,
} from './edit/forms';
import { EditButton } from './shared';
import { showToast } from '@/lib/toast';
import type { PatchOp, Snapshot } from '@/lib/companion-v2/patch';

type EditTarget =
  | { kind: 'overview'; section: OverviewSection }
  | { kind: 'job'; code: string }
  | { kind: 'newJob' }
  | { kind: 'role'; name: string | null }
  | { kind: 'phase'; index: number | null; after?: number }
  | { kind: 'rules' }
  | { kind: 'milestones' }
  | { kind: 'stagesNote' };

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
  const router = useRouter();
  const pathname = usePathname();
  // An open edit keeps the playbook and updated_at it was opened with, so a
  // refresh landing meanwhile can't change the form's base under it (the
  // save then fails as stale instead of silently reverting someone's change).
  const [edit, setEdit] = useState<{ target: EditTarget; base: Snapshot; updatedAt: string } | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const base: Snapshot = useMemo(
    () => ({
      playbook: {
        title: playbook.title,
        description: playbook.description,
        overview: playbook.overview ?? {},
        roles: playbook.roles ?? [],
        sequence: playbook.sequence ?? {},
        source_doc: playbook.source_doc ?? '',
      },
      jobs,
    }),
    [playbook, jobs]
  );
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

  // No new edit while the page is reloading after a save.
  const openEdit = (target: EditTarget) => {
    if (refreshing) return;
    setEdit({ target, base, updatedAt: playbook.updated_at });
  };

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

  return (
    <div className="text-[15px] leading-[1.55] text-pb-ink">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-7 gap-y-3">
        <p className="max-w-[62ch] text-pb-muted">{playbook.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {refreshing && (
            <span role="status" className="text-xs text-pb-muted">
              Updating…
            </span>
          )}
          <EditButton label="Edit title and description" onClick={() => openEdit({ kind: 'overview', section: 'header' })} />
          <button
            type="button"
            onClick={downloadJson}
            className="rounded-lg border border-pb-line bg-pb-surface px-3 py-1.5 transition hover:border-pb-accent"
            title="A backup of the playbook in the format the seed script accepts"
          >
            Download playbook as JSON
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
        {tab === 'overview' && <OverviewTab overview={playbook.overview} onEdit={(section) => openEdit({ kind: 'overview', section })} />}
        {tab === 'roles' && (
          <RolesTab roles={playbook.roles} jobs={jobs} onOpenJob={openJobDrawer} onEdit={(name) => openEdit({ kind: 'role', name })} />
        )}
        {tab === 'map' && (
          <JobsMapTab
            jobs={jobs}
            framework={playbook.sequence?.framework}
            onOpenJob={openJobDrawer}
            onAddJob={() => openEdit({ kind: 'newJob' })}
          />
        )}
        {tab === 'sequence' && (
          <SequenceTab sequence={playbook.sequence ?? {}} jobs={jobs} onOpenJob={openJobDrawer} onEdit={(t) => openEdit(t)} />
        )}
      </div>

      {openJob && !edit && (
        <JobDrawer
          key={openJob.job_code}
          job={openJob}
          onClose={closeDrawer}
          onEdit={() => openEdit({ kind: 'job', code: openJob.job_code })}
        />
      )}

      {edit && (
        <EditDialog
          title={editTitle(edit.target, edit.base)}
          playbookId={playbook.id}
          baseUpdatedAt={edit.updatedAt}
          base={edit.base}
          onClose={() => setEdit(null)}
          onApplied={(_newUpdatedAt, applied) => {
            setEdit(null);
            // The open job was removed: close its drawer.
            if (openCode && applied.some((o) => o.op === 'job.remove' && o.job === openCode)) closeDrawer();
            showToast('Saved. The change is live.');
            // Reload the page data (and the new updated_at) from the server;
            // edit buttons wait until it lands.
            startRefresh(() => router.refresh());
          }}
          form={(onReview: (ops: PatchOp[]) => void, onCancel: () => void) => renderForm(edit.target, edit.base, onReview, onCancel)}
        />
      )}
    </div>
  );
}

function editTitle(e: EditTarget, base: Snapshot): string {
  switch (e.kind) {
    case 'overview':
      return OVERVIEW_TITLES[e.section];
    case 'job':
      return base.jobs.find((j) => j.job_code === e.code)?.name ?? 'Job';
    case 'newJob':
      return 'A new job';
    case 'role':
      return e.name ?? 'A new role';
    case 'phase':
      return e.index !== null ? base.playbook.sequence.phases?.[e.index]?.name ?? 'Step' : 'A new step';
    case 'rules':
      return 'Hard rules';
    case 'milestones':
      return 'Milestones';
    case 'stagesNote':
      return 'Note on the stages';
  }
}

function renderForm(e: EditTarget, base: Snapshot, onReview: (ops: PatchOp[]) => void, onCancel: () => void) {
  const p = { base, onReview, onCancel };
  switch (e.kind) {
    case 'overview':
      return <OverviewForm {...p} section={e.section} />;
    case 'job': {
      const job = base.jobs.find((j) => j.job_code === e.code);
      return job ? <JobEditForm {...p} job={job} /> : null;
    }
    case 'newJob':
      return <NewJobForm {...p} />;
    case 'role':
      return <RoleForm {...p} role={e.name ? base.playbook.roles.find((r) => r.name === e.name) ?? null : null} />;
    case 'phase':
      return <PhaseForm {...p} index={e.index} after={e.after} />;
    case 'rules':
      return <RulesForm {...p} />;
    case 'milestones':
      return <MilestonesForm {...p} />;
    case 'stagesNote':
      return <StagesNoteForm {...p} />;
  }
}
