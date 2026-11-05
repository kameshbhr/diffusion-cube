// How patch ops are described and shown in the diff screen: a plain label per
// op and its before/after as readable text. No React here.

import type { PatchOp, Snapshot } from './patch';
import type { JobRow, JobTask, OverviewEntry, PlaybookPhase, PlaybookRole, PlaybookRule } from './types';

export const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  intended_result: 'What it achieves',
  why_it_matters: 'Why it matters',
  when: 'When',
  how_summary: 'How, in short',
  tasks: 'Checklist items',
  roles: 'Roles as written',
  owners: 'Who owns',
  tracked_by: 'Who tracks',
  owner_note: 'Note on who owns',
  gaps: 'Gaps',
  maturity: 'Maturity',
  recurs: 'Recurs across rounds',
  title: 'Title',
  description: 'Description',
  purpose: 'Purpose',
  context: 'Context',
  based_on: 'Based on',
  outcomes: 'Outcomes',
  insights: 'Key insights',
  maturity_flags: 'Maturity flags',
  credits: 'Credits',
  milestones: 'Milestones',
  milestones_note: 'Milestones note',
  note: 'Note on the stages',
};

const isTask = (v: unknown): v is JobTask => !!v && typeof v === 'object' && 'text' in (v as object) && 'owner' in (v as object);
const isEntry = (v: unknown): v is OverviewEntry => !!v && typeof v === 'object' && 'label' in (v as object);
const isRule = (v: unknown): v is PlaybookRule => !!v && typeof v === 'object' && 'rule' in (v as object);
const isPhase = (v: unknown): v is PlaybookPhase => !!v && typeof v === 'object' && 'jobs' in (v as object) && 'when' in (v as object);
const isRole = (v: unknown): v is PlaybookRole => !!v && typeof v === 'object' && 'group' in (v as object) && 'description' in (v as object);
const isJob = (v: unknown): v is JobRow => !!v && typeof v === 'object' && 'job_code' in (v as object) && 'body' in (v as object);

/** Any playbook value as readable lines of text (for diffing). */
export function toText(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return '(empty)';
    return v.map((x) => toText(x).split('\n').map((l, i) => (i === 0 ? `• ${l}` : `  ${l}`)).join('\n')).join('\n');
  }
  if (isTask(v)) return `${[v.stage, v.timing].filter(Boolean).join(', ') || 'Timing not stated'} · ${v.owner || 'Not stated'}: ${v.text}`;
  if (isEntry(v)) return v.items ? `${v.label}:\n${v.items.map((i) => `  - ${i}`).join('\n')}${v.note ? `\n  (${v.note})` : ''}` : `${v.label}: ${v.value ?? ''}`;
  if (isRule(v)) return v.why ? `${v.rule} (Why: ${v.why})` : v.rule;
  if (isPhase(v)) return `${v.name} (${v.when})\n${v.text}\nJobs: ${v.jobs.join(', ') || '(none)'}`;
  if (isRole(v))
    return [
      `${v.name} (${v.group})`,
      v.description,
      v.example ? `Example: ${v.example}` : '',
      v.see ? `See: ${v.see}` : '',
      v.owner_keys?.length ? `Owner names in the checklist: ${v.owner_keys.join(', ')}` : '',
      v.playbook_names?.length ? `Names in the playbook: ${v.playbook_names.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  if (isJob(v))
    return [`${v.name} [${v.job_code}]`, ...Object.entries(v.body).map(([k, x]) => `${FIELD_LABEL[k] ?? k}: ${toText(x)}`)].join('\n');
  const o = v as Record<string, unknown>;
  if ('flag' in o && 'note' in o) {
    const flag = { thin: 'Thin', judg: 'Estimate', check: 'Needs check' }[String(o.flag)] ?? 'No flag';
    return `${flag}: ${String(o.note ?? '')}`;
  }
  return Object.entries(o)
    .map(([k, x]) => `${k}: ${toText(x)}`)
    .join('\n');
}

const jobName = (s: Snapshot, code: string) => s.jobs.find((j) => j.job_code === code)?.name ?? code;

/** A plain label, e.g. "Design the data collection plan → When". */
export function opLabel(op: PatchOp, s: Snapshot): string {
  switch (op.op) {
    case 'job.set':
      return `${jobName(s, op.job)} → ${FIELD_LABEL[op.field] ?? op.field}`;
    case 'job.append':
      return `${jobName(s, op.job)} → ${FIELD_LABEL[op.field]}: add an item`;
    case 'job.remove_item':
      return `${jobName(s, op.job)} → ${FIELD_LABEL[op.field]}: remove item ${op.index + 1}`;
    case 'job.replace_item':
      return `${jobName(s, op.job)} → ${FIELD_LABEL[op.field]}: change item ${op.index + 1}`;
    case 'job.add':
      return `New job: ${op.value?.name ?? op.job}`;
    case 'job.remove':
      return `Remove job: ${jobName(s, op.job)}`;
    case 'overview.set':
      return op.field === 'title' || op.field === 'description' ? `Playbook ${FIELD_LABEL[op.field].toLowerCase()}` : `Overview → ${FIELD_LABEL[op.field]}`;
    case 'sequence.set':
      return `Sequence → ${FIELD_LABEL[op.field]}`;
    case 'role.set':
      return `Role: ${op.name}`;
    case 'role.add':
      return `New role: ${op.value?.name}`;
    case 'role.remove':
      return `Remove role: ${op.name}`;
    case 'phase.set':
      return `Step ${op.index + 1}: ${s.playbook.sequence.phases?.[op.index]?.name ?? ''}`;
    case 'phase.add':
      return `New step: ${op.value?.name}`;
    case 'phase.remove':
      return `Remove step ${op.index + 1}: ${s.playbook.sequence.phases?.[op.index]?.name ?? ''}`;
    case 'rules.set':
      return 'Hard rules';
    case 'source.replace_section':
      return `Source document → replace section "${op.heading.replace(/^#+\s*/, '')}"`;
    case 'source.append_to_section':
      return `Source document → add to section "${op.heading.replace(/^#+\s*/, '')}"`;
    case 'source.add_section':
      return `Source document → new section "${op.heading.replace(/^#+\s*/, '')}"`;
    case 'source.replace':
      return 'Source document → change wording';
    case 'source.insert_after':
      return 'Source document → insert text';
    case 'source.append':
      return 'Source document → add at the end';
  }
}

/** The value an op changes, read from a snapshot (before or after the op). */
export function opTarget(op: PatchOp, s: Snapshot): unknown {
  const job = (code: string) => s.jobs.find((j) => j.job_code === code);
  switch (op.op) {
    case 'job.set':
      return op.field === 'name' ? job(op.job)?.name : job(op.job)?.body[op.field];
    case 'job.append':
    case 'job.remove_item':
    case 'job.replace_item':
      return job(op.job)?.body[op.field];
    case 'job.add':
    case 'job.remove':
      return job(op.job) ?? null;
    case 'overview.set':
      return op.field === 'title' || op.field === 'description' ? s.playbook[op.field] : s.playbook.overview[op.field];
    case 'sequence.set':
      return s.playbook.sequence[op.field];
    case 'role.set':
      return s.playbook.roles.find((r) => r.name === op.name) ?? s.playbook.roles.find((r) => r.name === op.value?.name) ?? null;
    case 'role.add':
      return s.playbook.roles.find((r) => r.name === op.value?.name) ?? null;
    case 'role.remove':
      return s.playbook.roles.find((r) => r.name === op.name) ?? null;
    case 'phase.set':
      return s.playbook.sequence.phases?.[op.index] ?? null;
    case 'phase.add':
    case 'phase.remove':
      return (s.playbook.sequence.phases ?? []).map((p) => `${p.name} (${p.when})`);
    case 'rules.set':
      return s.playbook.sequence.rules ?? [];
    default:
      return s.playbook.source_doc;
  }
}

/** Which part of an op a contributor may edit in the diff screen. */
export function editableKey(op: PatchOp): 'value' | 'item' | 'text' | 'replace' | null {
  if ('value' in op && op.op !== 'job.add') return 'value';
  if ('item' in op) return 'item';
  if ('replace' in op) return 'replace';
  if ('text' in op) return 'text';
  return null;
}

/**
 * The before/after text a diff card shows for an op, given the snapshots just
 * before and after it. Steps that are added or removed show the whole step.
 */
export function beforeAfter(op: PatchOp, before: Snapshot, after: Snapshot): { before: string; after: string } {
  // Steps list their jobs by name, not code.
  const named = (p: PlaybookPhase | null | undefined, s: Snapshot) =>
    p ? toText({ ...p, jobs: p.jobs.map((c) => s.jobs.find((j) => j.job_code === c)?.name ?? c) }) : '(none)';
  if (op.op === 'phase.add') return { before: '(no such step yet)', after: named(op.value, after) };
  if (op.op === 'phase.remove') return { before: named(before.playbook.sequence.phases?.[op.index], before), after: '(removed)' };
  if (op.op === 'phase.set')
    return { before: named(before.playbook.sequence.phases?.[op.index], before), after: named(after.playbook.sequence.phases?.[op.index], after) };
  if (op.op === 'job.add') {
    const j = after.jobs.find((x) => x.job_code === op.job);
    const where = j ? `
Jobs map: ${j.work_area} · ${j.job_type} · ${j.stages.join(', ')}` : '';
    return { before: '(no such job yet)', after: j ? toText(j) + where : '(not added)' };
  }
  return { before: toText(opTarget(op, before)), after: toText(opTarget(op, after)) };
}
