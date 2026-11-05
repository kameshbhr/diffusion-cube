'use client';

// Edit forms for the contributor Playbook view. Each form only builds patch
// ops from what changed; the diff screen (PatchReview) shows them and applies
// them with one save_playbook() call.

import { useMemo, useState } from 'react';
import { JOB_LIST_FIELDS, listOps, type JobListField, type PatchOp, type Snapshot } from '@/lib/companion-v2/patch';
import type { JobBody, JobRow, JobTask, OverviewEntry, PlaybookPhase, PlaybookRole, PlaybookRule } from '@/lib/companion-v2/types';
import {
  EntriesEditor,
  LinesField,
  NamesField,
  RowControls,
  TasksEditor,
  TextArea,
  TextField,
  cleanEntries,
  cleanList,
  inputCls,
} from './inputs';

export interface FormProps {
  base: Snapshot;
  onReview: (ops: PatchOp[]) => void;
  onCancel: () => void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Actions({ onReview, onCancel, disabled, extra }: { onReview: () => void; onCancel: () => void; disabled?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-5 flex flex-wrap items-center gap-3 border-t border-pb-line bg-pb-surface px-5 py-3">
      <button
        type="button"
        onClick={onReview}
        disabled={disabled}
        className="rounded-lg bg-pb-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
      >
        Review changes
      </button>
      <button type="button" onClick={onCancel} className="text-sm text-pb-muted hover:text-pb-ink">
        Cancel
      </button>
      {extra && <span className="ml-auto">{extra}</span>}
    </div>
  );
}

const dangerBtn = 'text-sm text-pb-check-ink underline-offset-2 hover:underline';

function confirmRemove(what: string) {
  return window.confirm(`${what} This goes live as soon as you apply it, and there is no undo.`);
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

type JobDraft = {
  name: string;
  intended_result: string;
  why_it_matters: string;
  when: string;
  how_summary: string[];
  tasks: JobTask[];
  owners: string[];
  tracked_by: string[];
  owner_note: string;
  gaps: string[];
  flag: '' | 'thin' | 'judg' | 'check';
  maturityNote: string;
  recurs: boolean;
  roles: { owns: string; does: string; reviews: string; enables: string };
};

function draftOf(job: JobRow): JobDraft {
  const b = job.body;
  return {
    name: job.name,
    intended_result: b.intended_result ?? '',
    why_it_matters: b.why_it_matters ?? '',
    when: b.when ?? '',
    how_summary: b.how_summary ?? [],
    tasks: b.tasks ?? [],
    owners: b.owners ?? [],
    tracked_by: b.tracked_by ?? [],
    owner_note: b.owner_note ?? '',
    gaps: b.gaps ?? [],
    flag: (b.maturity?.flag ?? '') as JobDraft['flag'],
    maturityNote: b.maturity?.note ?? '',
    recurs: !!b.recurs,
    roles: { owns: b.roles?.owns ?? '', does: b.roles?.does ?? '', reviews: b.roles?.reviews ?? '', enables: b.roles?.enables ?? '' },
  };
}

/** The draft as stored values (cleaned), keyed by job field. */
function valuesOf(d: JobDraft): Record<string, unknown> {
  return {
    name: d.name.trim(),
    intended_result: d.intended_result.trim(),
    why_it_matters: d.why_it_matters.trim(),
    when: d.when.trim(),
    how_summary: cleanList(d.how_summary),
    // Fully empty rows are dropped; a row with only some fields filled is
    // caught by taskProblem() before review.
    tasks: d.tasks
      .map((t) => ({ stage: t.stage.trim(), timing: t.timing.trim(), owner: t.owner.trim(), text: t.text.trim() }))
      .filter((t) => t.text || t.stage || t.timing || t.owner),
    owners: cleanList(d.owners),
    tracked_by: cleanList(d.tracked_by),
    owner_note: d.owner_note.trim(),
    gaps: cleanList(d.gaps),
    maturity: d.flag || d.maturityNote.trim() ? { flag: d.flag || null, note: d.maturityNote.trim() } : null,
    recurs: d.recurs,
    roles: {
      owns: d.roles.owns.trim(),
      does: d.roles.does.trim(),
      reviews: d.roles.reviews.trim(),
      enables: d.roles.enables.trim(),
    },
  };
}

function JobFields({ d, set }: { d: JobDraft; set: (p: Partial<JobDraft>) => void }) {
  return (
    <div className="space-y-4">
      <TextField label="Name" value={d.name} onChange={(v) => set({ name: v })} />
      <TextArea label="Intended result" value={d.intended_result} onChange={(v) => set({ intended_result: v })} />
      <TextArea label="Why it matters" value={d.why_it_matters} onChange={(v) => set({ why_it_matters: v })} />
      <TextArea label="When" value={d.when} onChange={(v) => set({ when: v })} rows={2} />
      <LinesField label="How it’s done (the short how)" value={d.how_summary} onChange={(v) => set({ how_summary: v })} />
      <TasksEditor value={d.tasks} onChange={(v) => set({ tasks: v })} />
      <NamesField
        label="Who owns"
        hint="Comma separated. Put PMU first where PMU owns it. Leave empty if the checklist names no owner (the job is then flagged)."
        value={d.owners}
        onChange={(v) => set({ owners: v })}
      />
      <NamesField label="Who tracks" hint="Comma separated. PMU tracks every job." value={d.tracked_by} onChange={(v) => set({ tracked_by: v })} />
      <TextArea label="Note on who owns (shown with the Owns / Tracks tag)" value={d.owner_note} onChange={(v) => set({ owner_note: v })} rows={2} />
      <div className="grid gap-3 sm:grid-cols-2">
        {(['owns', 'does', 'reviews', 'enables'] as const).map((k) => (
          <TextField key={k} label={`Roles as written: ${k}`} value={d.roles[k]} onChange={(v) => set({ roles: { ...d.roles, [k]: v } })} />
        ))}
      </div>
      <LinesField label="Gaps" value={d.gaps} onChange={(v) => set({ gaps: v })} />
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="space-y-1 text-[13px] font-medium text-pb-ink">
          <span className="block">Maturity flag</span>
          <select value={d.flag} onChange={(e) => set({ flag: e.target.value as JobDraft['flag'] })} className={inputCls}>
            <option value="">No flag</option>
            <option value="thin">Thin</option>
            <option value="judg">Estimate</option>
            <option value="check">Needs check</option>
          </select>
        </label>
        <TextField label="Maturity note" value={d.maturityNote} onChange={(v) => set({ maturityNote: v })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={d.recurs} onChange={(e) => set({ recurs: e.target.checked })} />
        Recurs in each build round
      </label>
    </div>
  );
}

/** A checklist row needs its text once any of its fields is filled. */
function taskProblem(d: JobDraft): string | null {
  const bad = d.tasks.findIndex((t) => !t.text.trim() && (t.stage.trim() || t.timing.trim() || t.owner.trim()));
  return bad >= 0 ? `Checklist item ${bad + 1} needs its text (or clear the row).` : null;
}

export function JobEditForm({ base, job, onReview, onCancel }: FormProps & { job: JobRow }) {
  const [d, setD] = useState(() => draftOf(job));
  const set = (p: Partial<JobDraft>) => setD((prev) => ({ ...prev, ...p }));
  const before = useMemo(() => valuesOf(draftOf(job)), [job]);
  // List fields become item ops where possible (an added task is one
  // job.append, not a rewrite of the whole list); other fields are job.set.
  const ops = useMemo(() => {
    const after = valuesOf(d);
    const out: PatchOp[] = [];
    for (const k of Object.keys(after)) {
      if (same(before[k], after[k])) continue;
      if ((JOB_LIST_FIELDS as readonly string[]).includes(k)) {
        // Compare with the stored list, so item indexes and "expect" match it.
        const stored = (job.body[k as JobListField] ?? []) as (string | JobTask)[];
        out.push(...listOps(job.job_code, k as JobListField, stored, after[k] as (string | JobTask)[]));
      } else out.push({ op: 'job.set', job: job.job_code, field: k, value: after[k] } as PatchOp);
    }
    return out;
  }, [d, before, job]);
  const problem = taskProblem(d);

  const inSteps = (base.playbook.sequence.phases ?? []).filter((p) => p.jobs.includes(job.job_code)).length;
  return (
    <>
      <JobFields d={d} set={set} />
      {problem && <p className="mt-3 text-sm text-pb-check-ink">{problem}</p>}
      <Actions
        onReview={() => onReview(ops)}
        onCancel={onCancel}
        disabled={!ops.length || !!problem}
        extra={
          <button
            type="button"
            className={dangerBtn}
            onClick={() =>
              confirmRemove(
                `Remove "${job.name}" from the playbook? It is also taken out of ${inSteps} step${inSteps === 1 ? '' : 's'} of the sequence, and adopters’ markers for it are deleted.`
              ) && onReview([{ op: 'job.remove', job: job.job_code }])
            }
          >
            Remove this job
          </button>
        }
      />
    </>
  );
}

export function NewJobForm({ base, onReview, onCancel }: FormProps) {
  const fw = base.playbook.sequence.framework;
  const phases = base.playbook.sequence.phases ?? [];
  const [code, setCode] = useState('');
  const [area, setArea] = useState(fw?.areas[0]?.name ?? '');
  const [type, setType] = useState(fw?.types[0] ?? '');
  const [stages, setStages] = useState<string[]>(fw?.stages[0] ? [fw.stages[0].name] : []);
  const [step, setStep] = useState<number>(-1);
  const [d, setD] = useState<JobDraft>(() =>
    draftOf({ job_code: '', name: '', position: null, stages: [], work_area: '', job_type: '', body: { tracked_by: ['PMU'] } })
  );
  const set = (p: Partial<JobDraft>) => setD((prev) => ({ ...prev, ...p }));
  const codeTaken = base.jobs.some((j) => j.job_code === code.trim());

  const ops = (): PatchOp[] => {
    const v = valuesOf(d);
    const { name, ...body } = v;
    const maxPos = Math.max(0, ...base.jobs.map((j) => j.position ?? 0));
    const out: PatchOp[] = [
      {
        op: 'job.add',
        job: code.trim(),
        value: {
          name: name as string,
          body: body as JobBody,
          position: maxPos + 1,
          stages: (fw?.stages ?? []).map((s) => s.name).filter((s) => stages.includes(s)),
          work_area: area,
          job_type: type,
        },
      },
    ];
    if (step >= 0 && phases[step]) out.push({ op: 'phase.set', index: step, value: { ...phases[step], jobs: [...phases[step].jobs, code.trim()] } });
    return out;
  };

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <TextField label="Job code" hint="Fixed once created, e.g. S15. Not shown to adopters." value={code} onChange={setCode} />
        <label className="space-y-1 text-[13px] font-medium text-pb-ink">
          <span className="block">Add it to this step of the sequence</span>
          <select value={step} onChange={(e) => setStep(Number(e.target.value))} className={inputCls}>
            <option value={-1}>Not in a step (listed last)</option>
            {phases.map((p, i) => (
              <option key={i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {fw && (
          <>
            <label className="space-y-1 text-[13px] font-medium text-pb-ink">
              <span className="block">Work area (jobs map)</span>
              <select value={area} onChange={(e) => setArea(e.target.value)} className={inputCls}>
                {fw.areas.map((a) => (
                  <option key={a.name}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[13px] font-medium text-pb-ink">
              <span className="block">Job type (jobs map)</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                {fw.types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="text-[13px] font-medium text-pb-ink">Stages (jobs map)</legend>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {fw.stages.map((s) => (
                  <label key={s.name} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={stages.includes(s.name)}
                      onChange={(e) => setStages((prev) => (e.target.checked ? [...prev, s.name] : prev.filter((x) => x !== s.name)))}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </div>
      <JobFields d={d} set={set} />
      {taskProblem(d) && <p className="mt-3 text-sm text-pb-check-ink">{taskProblem(d)}</p>}
      {codeTaken && <p className="mt-3 text-sm text-pb-check-ink">A job with the code “{code.trim()}” already exists. Choose another code.</p>}
      {!!fw && !stages.length && <p className="mt-3 text-sm text-pb-check-ink">Pick at least one stage so the job appears on the jobs map.</p>}
      <Actions
        onReview={() => onReview(ops())}
        onCancel={onCancel}
        disabled={!code.trim() || codeTaken || !d.name.trim() || !!taskProblem(d) || (!!fw && !stages.length)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

export function RoleForm({ base, role, onReview, onCancel }: FormProps & { role: PlaybookRole | null }) {
  const blank: PlaybookRole = { name: '', group: '', description: '', example: '', see: '', owner_keys: [], playbook_names: [] };
  const [r, setR] = useState<PlaybookRole>(() => ({ ...blank, ...(role ?? {}) }));
  const set = (p: Partial<PlaybookRole>) => setR((prev) => ({ ...prev, ...p }));
  const groups = [...new Set(base.playbook.roles.map((x) => x.group))];
  const clean = (x: PlaybookRole): PlaybookRole => ({
    name: x.name.trim(),
    group: x.group.trim(),
    description: x.description.trim(),
    example: (x.example ?? '').trim(),
    see: (x.see ?? '').trim(),
    owner_keys: cleanList(x.owner_keys ?? []),
    playbook_names: cleanList(x.playbook_names ?? []),
  });
  const value = clean(r);
  const changed = !role || !same(clean({ ...blank, ...role }), value);
  return (
    <>
      <div className="space-y-4">
        <TextField label="Name" value={r.name} onChange={(v) => set({ name: v })} />
        <div className="space-y-1">
          <TextField label="Group" hint={`Existing groups: ${groups.join(', ')}`} value={r.group} onChange={(v) => set({ group: v })} />
        </div>
        <TextArea label="Description" value={r.description} onChange={(v) => set({ description: v })} />
        <TextArea label="Example" value={r.example ?? ''} onChange={(v) => set({ example: v })} rows={2} />
        <TextArea label="See also" value={r.see ?? ''} onChange={(v) => set({ see: v })} rows={2} />
        <NamesField
          label="Owner names in the checklist"
          hint="How this role is written in jobs’ Who owns lists (comma separated). Links the role card to the jobs it owns."
          value={r.owner_keys ?? []}
          onChange={(v) => set({ owner_keys: v })}
        />
        <NamesField
          label="Names in the playbook"
          hint="How this role is written in jobs’ “roles as written” (comma separated)."
          value={r.playbook_names ?? []}
          onChange={(v) => set({ playbook_names: v })}
        />
      </div>
      <Actions
        onReview={() => onReview(role ? [{ op: 'role.set', name: role.name, value }] : [{ op: 'role.add', value }])}
        onCancel={onCancel}
        disabled={!changed || !value.name || !value.group || !value.description}
        extra={
          role ? (
            <button
              type="button"
              className={dangerBtn}
              onClick={() => confirmRemove(`Remove the role "${role.name}"?`) && onReview([{ op: 'role.remove', name: role.name }])}
            >
              Remove this role
            </button>
          ) : null
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type OverviewSection = 'header' | 'purpose' | 'context' | 'based_on' | 'outcomes' | 'insights' | 'maturity_flags' | 'credits';

export const OVERVIEW_TITLES: Record<OverviewSection, string> = {
  header: 'Title and description',
  purpose: 'Purpose',
  context: 'Context',
  based_on: 'Based on',
  outcomes: 'Outcomes',
  insights: 'Key insights',
  maturity_flags: 'Maturity flags',
  credits: 'Credits',
};

export function OverviewForm({ base, section, onReview, onCancel }: FormProps & { section: OverviewSection }) {
  const o = base.playbook.overview;
  const [title, setTitle] = useState(base.playbook.title);
  const [description, setDescription] = useState(base.playbook.description);
  const [entries, setEntries] = useState<OverviewEntry[]>(() =>
    section === 'header' || section === 'outcomes' || section === 'insights' ? [] : (o[section] ?? [])
  );
  const [lines, setLines] = useState<string[]>(() => (section === 'outcomes' || section === 'insights' ? (o[section] ?? []) : []));

  const ops = (): PatchOp[] => {
    if (section === 'header') {
      const out: PatchOp[] = [];
      if (title.trim() !== base.playbook.title) out.push({ op: 'overview.set', field: 'title', value: title.trim() });
      if (description.trim() !== base.playbook.description) out.push({ op: 'overview.set', field: 'description', value: description.trim() });
      return out;
    }
    if (section === 'outcomes' || section === 'insights') {
      const v = cleanList(lines);
      return same(v, o[section] ?? []) ? [] : [{ op: 'overview.set', field: section, value: v }];
    }
    const v = cleanEntries(entries);
    return same(v, o[section] ?? []) ? [] : [{ op: 'overview.set', field: section, value: v }];
  };
  const pending = ops();

  return (
    <>
      {section === 'header' ? (
        <div className="space-y-4">
          <TextField label="Title" value={title} onChange={setTitle} />
          <TextArea label="Description" value={description} onChange={setDescription} rows={4} />
        </div>
      ) : section === 'outcomes' || section === 'insights' ? (
        <LinesField label={OVERVIEW_TITLES[section]} value={lines} onChange={setLines} rows={8} />
      ) : (
        <>
          {section === 'credits' && (
            <p className="mb-3 rounded-md bg-pb-accent-soft px-3 py-2 text-xs text-pb-accent">
              The credits must keep the CC BY 4.0 licence and the attribution to EkStep; a save without them is refused.
            </p>
          )}
          <EntriesEditor label={OVERVIEW_TITLES[section]} value={entries} onChange={setEntries} />
        </>
      )}
      <Actions onReview={() => onReview(pending)} onCancel={onCancel} disabled={!pending.length} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sequence: steps, milestones, notes, hard rules
// ---------------------------------------------------------------------------

export function PhaseForm({ base, index, after, onReview, onCancel }: FormProps & { index: number | null; after?: number | null }) {
  const phases = base.playbook.sequence.phases ?? [];
  const original = index !== null ? phases[index] : null;
  const [p, setP] = useState<PlaybookPhase>(() => original ?? { name: '', when: '', text: '', jobs: [] });
  const [filter, setFilter] = useState('');
  const set = (patch: Partial<PlaybookPhase>) => setP((prev) => ({ ...prev, ...patch }));
  const value: PlaybookPhase = { name: p.name.trim(), when: p.when.trim(), text: p.text.trim(), jobs: p.jobs };
  const changed = !original || !same(original, value);
  const shown = base.jobs.filter((j) => !filter.trim() || j.name.toLowerCase().includes(filter.trim().toLowerCase()) || p.jobs.includes(j.job_code));

  return (
    <>
      <div className="space-y-4">
        <TextField label="Name" hint="e.g. Stage 3: Scope definition, vendor selection and work order" value={p.name} onChange={(v) => set({ name: v })} />
        <TextField label="When" hint="e.g. Weeks 4–6" value={p.when} onChange={(v) => set({ when: v })} />
        <TextArea label="What happens in this step" value={p.text} onChange={(v) => set({ text: v })} rows={4} />
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-pb-ink">Jobs in this step ({p.jobs.length}), in order</legend>
          {p.jobs.length > 0 && (
            <ol className="space-y-1">
              {p.jobs.map((c, i) => (
                <li key={c} className="flex items-center justify-between gap-2 rounded-md bg-pb-bg px-2.5 py-1 text-sm">
                  <span>{base.jobs.find((j) => j.job_code === c)?.name ?? c}</span>
                  <RowControls
                    index={i}
                    count={p.jobs.length}
                    onMove={(d) => {
                      const k = i + d;
                      if (k < 0 || k >= p.jobs.length) return;
                      const next = [...p.jobs];
                      [next[i], next[k]] = [next[k], next[i]];
                      set({ jobs: next });
                    }}
                    onRemove={() => set({ jobs: p.jobs.filter((x) => x !== c) })}
                  />
                </li>
              ))}
            </ol>
          )}
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a job to add" aria-label="Find a job to add" className={inputCls} />
          <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-pb-line-soft p-2">
            {shown
              .filter((j) => !p.jobs.includes(j.job_code))
              .map((j) => (
                <button key={j.job_code} type="button" onClick={() => set({ jobs: [...p.jobs, j.job_code] })} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-pb-accent-soft">
                  + {j.name}
                </button>
              ))}
          </div>
        </fieldset>
      </div>
      <Actions
        onReview={() =>
          onReview(
            index !== null
              ? [{ op: 'phase.set', index, value }]
              : // after: undefined = at the end, -1 = at the start (null in the op).
                [{ op: 'phase.add', after: after === undefined || after === null ? phases.length - 1 : after < 0 ? null : after, value }]
          )
        }
        onCancel={onCancel}
        disabled={!changed || !value.name || !value.when}
        extra={
          index !== null ? (
            <button
              type="button"
              className={dangerBtn}
              onClick={() => confirmRemove(`Remove the step "${original?.name}"? Its jobs stay in the playbook.`) && onReview([{ op: 'phase.remove', index }])}
            >
              Remove this step
            </button>
          ) : null
        }
      />
    </>
  );
}

export function RulesForm({ base, onReview, onCancel }: FormProps) {
  const original = base.playbook.sequence.rules ?? [];
  const [rules, setRules] = useState<PlaybookRule[]>(original);
  const value = rules.map((r) => ({ rule: r.rule.trim(), why: (r.why ?? '').trim() })).filter((r) => r.rule);
  const set = (i: number, p: Partial<PlaybookRule>) => setRules((prev) => prev.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="space-y-1.5 rounded-md border border-pb-line-soft bg-pb-bg p-2.5">
            <textarea aria-label={`Rule ${i + 1}`} placeholder="The rule" value={r.rule} onChange={(e) => set(i, { rule: e.target.value })} rows={2} className={inputCls} />
            <input aria-label={`Rule ${i + 1} reason`} placeholder="Why (optional)" value={r.why ?? ''} onChange={(e) => set(i, { why: e.target.value })} className={inputCls} />
            <RowControls
              index={i}
              count={rules.length}
              onMove={(d) =>
                setRules((prev) => {
                  const k = i + d;
                  if (k < 0 || k >= prev.length) return prev;
                  const next = [...prev];
                  [next[i], next[k]] = [next[k], next[i]];
                  return next;
                })
              }
              onRemove={() => setRules((prev) => prev.filter((_, k) => k !== i))}
            />
          </div>
        ))}
        <button type="button" className="rounded-md border border-pb-line bg-pb-surface px-2 py-1 text-xs text-pb-muted hover:text-pb-ink" onClick={() => setRules((prev) => [...prev, { rule: '', why: '' }])}>
          + Add a rule
        </button>
      </div>
      <Actions onReview={() => onReview([{ op: 'rules.set', value }])} onCancel={onCancel} disabled={same(original, value)} />
    </>
  );
}

export function MilestonesForm({ base, onReview, onCancel }: FormProps) {
  const seq = base.playbook.sequence;
  const [entries, setEntries] = useState<OverviewEntry[]>(seq.milestones ?? []);
  const [note, setNote] = useState(seq.milestones_note ?? '');
  const ops = (): PatchOp[] => {
    const out: PatchOp[] = [];
    const v = cleanEntries(entries);
    if (!same(v, seq.milestones ?? [])) out.push({ op: 'sequence.set', field: 'milestones', value: v });
    if (note.trim() !== (seq.milestones_note ?? '')) out.push({ op: 'sequence.set', field: 'milestones_note', value: note.trim() });
    return out;
  };
  const pending = ops();
  return (
    <>
      <div className="space-y-4">
        <EntriesEditor label="Milestones" value={entries} onChange={setEntries} />
        <TextArea label="Note under the milestones" value={note} onChange={setNote} rows={2} />
      </div>
      <Actions onReview={() => onReview(pending)} onCancel={onCancel} disabled={!pending.length} />
    </>
  );
}

export function StagesNoteForm({ base, onReview, onCancel }: FormProps) {
  const [note, setNote] = useState(base.playbook.sequence.note ?? '');
  const changed = note.trim() !== (base.playbook.sequence.note ?? '');
  return (
    <>
      <TextArea label="Note under the stages" value={note} onChange={setNote} rows={4} />
      <Actions onReview={() => onReview([{ op: 'sequence.set', field: 'note', value: note.trim() }])} onCancel={onCancel} disabled={!changed} />
    </>
  );
}
