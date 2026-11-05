// Playbook patches: the one format for every change to a playbook, whether it
// comes from a contributor's edit form (Slice 4b) or from Cube in "Update with
// Cube" (Slice 4d). Pure functions, no I/O and only type imports, so the app,
// the diff screen and scripts/cube2/check-patch.mjs all run the same code.
//
//   applyOps(snapshot, ops)  -> the playbook after the ops, plus a result per op
//   checkGuards(snapshot)    -> content rules (CC BY 4.0 credits, no "Only for Author")
//   toSave(base, next)       -> the arguments for save_playbook()
//
// The database re-checks the guards inside save_playbook(); these are for
// instant feedback. Each op either applies fully or fails with a reason and
// changes nothing; failed ops are skipped, never half-applied.

import type {
  JobBody,
  JobRow,
  JobTask,
  OverviewEntry,
  PlaybookOverview,
  PlaybookPhase,
  PlaybookRole,
  PlaybookRule,
  PlaybookSequence,
} from './types';

// ---------------------------------------------------------------------------
// Snapshot and ops
// ---------------------------------------------------------------------------

export interface PlaybookContent {
  title: string;
  description: string;
  overview: PlaybookOverview;
  roles: PlaybookRole[];
  sequence: PlaybookSequence;
  source_doc: string;
}

export interface Snapshot {
  playbook: PlaybookContent;
  jobs: JobRow[];
}

/** Job fields a whole-field edit may set. Job codes and placement are fixed. */
export const JOB_FIELDS = [
  'name',
  'intended_result',
  'why_it_matters',
  'when',
  'how_summary',
  'tasks',
  'roles',
  'owners',
  'tracked_by',
  'owner_note',
  'gaps',
  'maturity',
  'recurs',
] as const;
export type JobField = (typeof JOB_FIELDS)[number];

/** List fields that also take item ops. */
export const JOB_LIST_FIELDS = ['how_summary', 'gaps', 'tasks'] as const;
export type JobListField = (typeof JOB_LIST_FIELDS)[number];

export const OVERVIEW_FIELDS = [
  'title',
  'description',
  'purpose',
  'context',
  'based_on',
  'outcomes',
  'insights',
  'maturity_flags',
  'credits',
] as const;
export type OverviewField = (typeof OVERVIEW_FIELDS)[number];

export const SEQUENCE_FIELDS = ['milestones', 'milestones_note', 'note'] as const;
export type SequenceField = (typeof SEQUENCE_FIELDS)[number];

type ListItem = string | JobTask;

export type PatchOp =
  | { op: 'job.set'; job: string; field: JobField; value: unknown }
  | { op: 'job.add'; job: string; value: { name: string; body?: JobBody; position?: number | null; stages?: string[]; work_area?: string; job_type?: string } }
  | { op: 'job.remove'; job: string }
  | { op: 'job.append'; job: string; field: JobListField; item: ListItem }
  | { op: 'job.remove_item'; job: string; field: JobListField; index: number; expect: string }
  | { op: 'job.replace_item'; job: string; field: JobListField; index: number; expect: string; item: ListItem }
  | { op: 'overview.set'; field: OverviewField; value: unknown }
  | { op: 'sequence.set'; field: SequenceField; value: unknown }
  | { op: 'role.set'; name: string; value: PlaybookRole }
  | { op: 'role.add'; value: PlaybookRole }
  | { op: 'role.remove'; name: string }
  | { op: 'phase.set'; index: number; value: PlaybookPhase }
  /** after: null = at the start, missing = at the end, else after that step. */
  | { op: 'phase.add'; after?: number | null; value: PlaybookPhase }
  | { op: 'phase.remove'; index: number }
  | { op: 'rules.set'; value: PlaybookRule[] }
  | { op: 'source.replace_section'; heading: string; text: string }
  | { op: 'source.append_to_section'; heading: string; text: string }
  | { op: 'source.add_section'; after_heading: string | null; heading: string; text: string }
  | { op: 'source.replace'; find: string; replace: string }
  | { op: 'source.insert_after'; find: string; text: string }
  | { op: 'source.append'; text: string }
  /** The whole source document. From the Source document editor only; never proposed by Cube. */
  | { op: 'source.set'; value: string };

export type OpResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

class OpError extends Error {}
const fail = (msg: string): never => {
  throw new OpError(msg);
};

const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isTask = (v: unknown): v is JobTask =>
  !!v && typeof v === 'object' && ['stage', 'timing', 'owner', 'text'].every((k) => isStr((v as Record<string, unknown>)[k]));
const isEntryList = (v: unknown): v is OverviewEntry[] =>
  Array.isArray(v) &&
  v.every(
    (e) =>
      e &&
      typeof e === 'object' &&
      isStr((e as OverviewEntry).label) &&
      ((e as OverviewEntry).value === undefined || isStr((e as OverviewEntry).value)) &&
      ((e as OverviewEntry).items === undefined || isStrList((e as OverviewEntry).items))
  );

/** The text an item op compares with `expect`: the string itself, or a task's text. */
export function itemText(item: unknown): string {
  if (isStr(item)) return item;
  if (isTask(item)) return item.text;
  return '';
}

function checkJobField(field: string, value: unknown): void {
  switch (field) {
    case 'name':
      if (!isStr(value) || !value.trim()) fail('A job needs a name.');
      return;
    case 'intended_result':
    case 'why_it_matters':
    case 'when':
    case 'owner_note':
      if (!isStr(value)) fail(`"${field}" must be text.`);
      return;
    case 'how_summary':
    case 'gaps':
    case 'owners':
    case 'tracked_by':
      if (!isStrList(value)) fail(`"${field}" must be a list of text.`);
      return;
    case 'tasks':
      if (!Array.isArray(value) || !value.every(isTask)) fail('Checklist items need a stage, timing, owner and text.');
      return;
    case 'roles': {
      const r = value as Record<string, unknown>;
      if (!r || typeof r !== 'object' || Array.isArray(r) || !['owns', 'does', 'reviews', 'enables'].every((k) => r[k] === undefined || isStr(r[k])))
        fail('"roles" must have owns, does, reviews and enables as text.');
      return;
    }
    case 'maturity': {
      if (value === null) return;
      const m = value as Record<string, unknown>;
      if (!m || typeof m !== 'object' || !isStr(m.note) || !(m.flag === null || ['thin', 'judg', 'check'].includes(m.flag as string)))
        fail('"maturity" needs a flag (thin, judg, check or none) and a note.');
      return;
    }
    case 'recurs':
      if (typeof value !== 'boolean') fail('"recurs" must be true or false.');
      return;
    default:
      fail(`"${field}" can't be edited.`);
  }
}

function checkRole(v: unknown): asserts v is PlaybookRole {
  const r = v as PlaybookRole;
  if (!r || typeof r !== 'object' || !isStr(r.name) || !r.name.trim() || !isStr(r.group) || !isStr(r.description))
    fail('A role needs a name, a group and a description.');
  if (r.owner_keys !== undefined && !isStrList(r.owner_keys)) fail('Owner names must be a list of text.');
  if (r.playbook_names !== undefined && !isStrList(r.playbook_names)) fail('Playbook names must be a list of text.');
}

function checkPhase(v: unknown, codes: Set<string>): asserts v is PlaybookPhase {
  const p = v as PlaybookPhase;
  if (!p || typeof p !== 'object' || !isStr(p.name) || !p.name.trim() || !isStr(p.when) || !isStr(p.text) || !isStrList(p.jobs))
    fail('A step needs a name, a "when", a description and a list of jobs.');
  const unknown = p.jobs.filter((c) => !codes.has(c));
  if (unknown.length) fail(`Unknown job code(s) in the step: ${unknown.join(', ')}.`);
  const dupes = p.jobs.filter((c, i) => p.jobs.indexOf(c) !== i);
  if (dupes.length) fail(`A job is listed twice in the step: ${[...new Set(dupes)].join(', ')}.`);
}

/** Placement of a new job on the contributor's jobs map, checked against the framework. */
function checkPlacement(s: Snapshot, v: { stages?: unknown; work_area?: unknown; job_type?: unknown; position?: unknown }): void {
  if (v.position !== undefined && v.position !== null && !Number.isInteger(v.position)) fail('The position must be a whole number.');
  if (v.stages !== undefined && !isStrList(v.stages)) fail('Stages must be a list of text.');
  const fw = s.playbook.sequence.framework;
  if (!fw) return;
  const stages = (v.stages as string[] | undefined) ?? [];
  if (!stages.length) fail('A new job needs at least one stage, or it won’t appear on the jobs map.');
  const known = new Set(fw.stages.map((x) => x.name));
  const bad = stages.filter((x) => !known.has(x));
  if (bad.length) fail(`Unknown stage(s): ${bad.join(', ')}.`);
  if (!fw.areas.some((a) => a.name === v.work_area)) fail(`Unknown work area "${String(v.work_area ?? '')}".`);
  if (!fw.types.includes(String(v.job_type ?? ''))) fail(`Unknown job type "${String(v.job_type ?? '')}".`);
}

function getJob(s: Snapshot, code: string): JobRow {
  const j = s.jobs.find((x) => x.job_code === code);
  if (!j) fail(`There is no job "${code}".`);
  return j as JobRow;
}

function getList(job: JobRow, field: JobListField): ListItem[] {
  const list = (job.body[field] ?? []) as ListItem[];
  if (!Array.isArray(list)) fail(`"${field}" is not a list.`);
  return list;
}

function checkItem(field: JobListField, item: unknown): void {
  if (field === 'tasks' ? !isTask(item) : !isStr(item) || !item.trim())
    fail(field === 'tasks' ? 'A checklist item needs a stage, timing, owner and text.' : 'The item is empty.');
}

function checkIndex(list: unknown[], index: number, expect: string, field: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) fail(`There is no item ${index + 1} in "${field}".`);
  if (itemText(list[index]).trim() !== (expect ?? '').trim())
    fail(`Item ${index + 1} in "${field}" has changed since this change was proposed.`);
}

// ---------- source document sections ----------

interface Heading {
  line: number;
  level: number;
  text: string;
}

function headings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    const m = !fenced && l.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (m) out.push({ line: i, level: m[1].length, text: l.trim() });
  });
  return out;
}

/** The one heading whose line matches exactly (whitespace-trimmed). */
function findHeading(lines: string[], heading: string): { h: Heading; end: number } {
  const all = headings(lines);
  const want = heading.trim();
  const hits = all.filter((h) => h.text === want);
  if (!hits.length) fail(`The heading "${want}" isn't in the source document.`);
  if (hits.length > 1) fail(`The heading "${want}" appears ${hits.length} times; make it unique first.`);
  const h = hits[0];
  const next = all.find((x) => x.line > h.line && x.level <= h.level);
  return { h, end: next ? next.line : lines.length };
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

const trimBlock = (t: string) => t.replace(/^\n+|\s+$/g, '');

/** Every text field a source op uses must be a string (a model may omit one). */
type SourceOp = Exclude<Extract<PatchOp, { op: `source.${string}` }>, { op: 'source.set' }>;

function checkSourceOp(op: SourceOp): void {
  const r = op as unknown as Record<string, unknown>;
  const need: Record<string, string[]> = {
    'source.replace_section': ['heading', 'text'],
    'source.append_to_section': ['heading', 'text'],
    'source.add_section': ['heading', 'text'],
    'source.replace': ['find', 'replace'],
    'source.insert_after': ['find', 'text'],
    'source.append': ['text'],
  };
  for (const k of need[op.op] ?? []) if (!isStr(r[k])) fail(`This change is missing its "${k}".`);
  if (op.op === 'source.add_section' && r.after_heading !== null && !isStr(r.after_heading))
    fail('This change is missing where to put the new section.');
}

function applySource(doc: string, op: SourceOp): string {
  checkSourceOp(op);
  const lines = doc.split('\n');
  switch (op.op) {
    case 'source.replace_section': {
      const { h, end } = findHeading(lines, op.heading);
      const body = trimBlock(op.text);
      if (headings(body.split('\n')).some((x) => x.text === h.text))
        fail('The new text repeats the section heading; give only the text under the heading.');
      // Blank lines are tidied only where the new text joins the document.
      const head = lines.slice(0, h.line + 1).join('\n');
      const tail = lines.slice(end).join('\n').replace(/^\n+/, '');
      return `${head}\n\n${body}\n${tail ? `\n${tail}` : ''}`;
    }
    case 'source.append_to_section': {
      const { end } = findHeading(lines, op.heading);
      const before = lines.slice(0, end).join('\n').replace(/\s+$/, '');
      const after = lines.slice(end).join('\n');
      return `${before}\n\n${trimBlock(op.text)}\n${after ? `\n${after}` : ''}`;
    }
    case 'source.add_section': {
      if (!/^#{1,6}\s+\S/.test(op.heading.trim())) fail('The new heading must start with # characters, e.g. "## Funding".');
      if (headings(lines).some((h) => h.text === op.heading.trim())) fail(`The heading "${op.heading.trim()}" already exists.`);
      const block = `${op.heading.trim()}\n\n${trimBlock(op.text)}\n`;
      if (op.after_heading === null) return `${doc.replace(/\s+$/, '')}\n\n${block}`;
      const { end } = findHeading(lines, op.after_heading);
      const before = lines.slice(0, end).join('\n').replace(/\s+$/, '');
      const after = lines.slice(end).join('\n');
      return `${before}\n\n${block}${after ? `\n${after}` : ''}`;
    }
    case 'source.replace': {
      const n = countOccurrences(doc, op.find);
      if (!op.find) fail('The text to find is empty.');
      if (n === 0) fail("The text to replace isn't in the source document (it may have changed).");
      if (n > 1) fail(`The text to replace appears ${n} times; it must appear exactly once.`);
      return doc.replace(op.find, () => op.replace);
    }
    case 'source.insert_after': {
      const n = countOccurrences(doc, op.find);
      if (!op.find) fail('The text to find is empty.');
      if (n === 0) fail("The text to insert after isn't in the source document (it may have changed).");
      if (n > 1) fail(`The text to insert after appears ${n} times; it must appear exactly once.`);
      return doc.replace(op.find, () => `${op.find}${op.text}`);
    }
    case 'source.append':
      return `${doc.replace(/\s+$/, '')}\n\n${trimBlock(op.text)}\n`;
  }
}

// ---------------------------------------------------------------------------
// applyOps
// ---------------------------------------------------------------------------

function applyOne(s: Snapshot, op: PatchOp, removedInPatch: Set<string>): void {
  const codes = () => new Set(s.jobs.map((j) => j.job_code));
  switch (op.op) {
    case 'job.set': {
      const job = getJob(s, op.job);
      if (!(JOB_FIELDS as readonly string[]).includes(op.field)) fail(`"${op.field}" can't be edited.`);
      checkJobField(op.field, op.value);
      if (op.field === 'name') job.name = (op.value as string).trim();
      else (job.body as Record<string, unknown>)[op.field] = clone(op.value);
      return;
    }
    case 'job.add': {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(op.job)) fail('A job code must start with a letter and use only letters, numbers, - or _.');
      if (codes().has(op.job)) fail(`A job "${op.job}" already exists.`);
      // Re-using a code removed in the same change would attach adopters'
      // markers for the old job to the new one.
      if (removedInPatch.has(op.job)) fail(`"${op.job}" is removed in this change; give the new job a different code.`);
      if (!isStr(op.value?.name) || !op.value.name.trim()) fail('A new job needs a name.');
      checkPlacement(s, op.value);
      const body = clone(op.value.body ?? {});
      for (const [k, v] of Object.entries(body)) if (v !== undefined) checkJobField(k, v);
      s.jobs.push({
        job_code: op.job,
        name: op.value.name.trim(),
        position: op.value.position ?? null,
        stages: op.value.stages ?? [],
        work_area: op.value.work_area ?? '',
        job_type: op.value.job_type ?? '',
        body: { tracked_by: ['PMU'], owners: [], ...body },
      });
      return;
    }
    case 'job.remove': {
      getJob(s, op.job);
      s.jobs = s.jobs.filter((j) => j.job_code !== op.job);
      // Also take it out of every step of the sequence.
      for (const p of s.playbook.sequence.phases ?? []) p.jobs = p.jobs.filter((c) => c !== op.job);
      return;
    }
    case 'job.append': {
      if (!(JOB_LIST_FIELDS as readonly string[]).includes(op.field)) fail(`"${op.field}" isn't a list.`);
      const job = getJob(s, op.job);
      checkItem(op.field, op.item);
      (job.body as Record<string, unknown>)[op.field] = [...getList(job, op.field), clone(op.item)];
      return;
    }
    case 'job.remove_item': {
      if (!(JOB_LIST_FIELDS as readonly string[]).includes(op.field)) fail(`"${op.field}" isn't a list.`);
      const job = getJob(s, op.job);
      const list = getList(job, op.field);
      checkIndex(list, op.index, op.expect, op.field);
      (job.body as Record<string, unknown>)[op.field] = list.filter((_, i) => i !== op.index);
      return;
    }
    case 'job.replace_item': {
      if (!(JOB_LIST_FIELDS as readonly string[]).includes(op.field)) fail(`"${op.field}" isn't a list.`);
      const job = getJob(s, op.job);
      const list = getList(job, op.field);
      checkIndex(list, op.index, op.expect, op.field);
      checkItem(op.field, op.item);
      (job.body as Record<string, unknown>)[op.field] = list.map((x, i) => (i === op.index ? clone(op.item) : x));
      return;
    }
    case 'overview.set': {
      const f = op.field;
      if (!(OVERVIEW_FIELDS as readonly string[]).includes(f)) fail(`"${f}" isn't part of the overview.`);
      if (f === 'title' || f === 'description') {
        if (!isStr(op.value) || (f === 'title' && !op.value.trim())) fail(`The ${f} must be text.`);
        s.playbook[f] = (op.value as string).trim();
      } else if (f === 'outcomes' || f === 'insights') {
        if (!isStrList(op.value)) fail(`"${f}" must be a list of text.`);
        s.playbook.overview[f] = clone(op.value as string[]);
      } else {
        if (!isEntryList(op.value)) fail(`"${f}" must be a list of labelled entries.`);
        s.playbook.overview[f] = clone(op.value as OverviewEntry[]);
      }
      return;
    }
    case 'sequence.set': {
      if (op.field === 'milestones') {
        if (!isEntryList(op.value)) fail('Milestones must be a list of labelled entries.');
        s.playbook.sequence.milestones = clone(op.value as OverviewEntry[]);
      } else if (op.field === 'milestones_note' || op.field === 'note') {
        if (!isStr(op.value)) fail('The note must be text.');
        s.playbook.sequence[op.field] = op.value as string;
      } else fail(`"${(op as { field: string }).field}" isn't part of the sequence.`);
      return;
    }
    case 'role.set': {
      checkRole(op.value);
      const i = s.playbook.roles.findIndex((r) => r.name === op.name);
      if (i < 0) fail(`There is no role "${op.name}".`);
      if (op.value.name !== op.name && s.playbook.roles.some((r) => r.name === op.value.name))
        fail(`A role "${op.value.name}" already exists.`);
      s.playbook.roles[i] = clone(op.value);
      return;
    }
    case 'role.add': {
      checkRole(op.value);
      if (s.playbook.roles.some((r) => r.name === op.value.name)) fail(`A role "${op.value.name}" already exists.`);
      s.playbook.roles.push(clone(op.value));
      return;
    }
    case 'role.remove': {
      if (!s.playbook.roles.some((r) => r.name === op.name)) fail(`There is no role "${op.name}".`);
      s.playbook.roles = s.playbook.roles.filter((r) => r.name !== op.name);
      return;
    }
    case 'phase.set': {
      const phases = (s.playbook.sequence.phases ??= []);
      if (!Number.isInteger(op.index) || !phases[op.index]) fail(`There is no step ${op.index + 1}.`);
      checkPhase(op.value, codes());
      phases[op.index] = clone(op.value);
      return;
    }
    case 'phase.add': {
      const phases = (s.playbook.sequence.phases ??= []);
      checkPhase(op.value, codes());
      // after: null = at the start; missing = at the end; otherwise after that step.
      const after = op.after === undefined ? (phases.length ? phases.length - 1 : null) : op.after;
      if (after !== null && (!Number.isInteger(after) || !phases[after])) fail(`There is no step ${Number(after) + 1}.`);
      phases.splice(after === null ? 0 : after + 1, 0, clone(op.value));
      return;
    }
    case 'phase.remove': {
      const phases = s.playbook.sequence.phases ?? [];
      if (!Number.isInteger(op.index) || !phases[op.index]) fail(`There is no step ${op.index + 1}.`);
      phases.splice(op.index, 1);
      return;
    }
    case 'rules.set': {
      if (!Array.isArray(op.value) || !op.value.every((r) => r && isStr(r.rule) && r.rule.trim() && isStr(r.why ?? '')))
        fail('Each hard rule needs its text (and an optional reason).');
      s.playbook.sequence.rules = op.value.map((r) => ({ rule: r.rule.trim(), why: (r.why ?? '').trim() }));
      return;
    }
    case 'source.replace_section':
    case 'source.append_to_section':
    case 'source.add_section':
    case 'source.replace':
    case 'source.insert_after':
    case 'source.append':
      s.playbook.source_doc = applySource(s.playbook.source_doc, op);
      return;
    case 'source.set':
      if (!isStr(op.value)) fail('The source document must be text.');
      s.playbook.source_doc = op.value;
      return;
    default:
      fail(`Unknown change "${(op as { op: string }).op}".`);
  }
}

/**
 * Applies the ops in order to a copy of the snapshot. An op that fails changes
 * nothing and is reported; the others still apply.
 */
export function applyOps(snapshot: Snapshot, ops: PatchOp[]): { next: Snapshot; results: OpResult[] } {
  let s = clone(snapshot);
  const results: OpResult[] = [];
  const removedInPatch = new Set<string>();
  for (const op of ops) {
    const trial = clone(s);
    try {
      applyOne(trial, op, removedInPatch);
      s = trial;
      if (op.op === 'job.remove') removedInPatch.add(op.job);
      results.push({ ok: true });
    } catch (err) {
      results.push({ ok: false, error: err instanceof OpError ? err.message : `This change couldn't be applied (${String(err)}).` });
    }
  }
  return { next: s, results };
}

// ---------------------------------------------------------------------------
// Content guards (mirrors save_playbook in migration 0034)
// ---------------------------------------------------------------------------

export const ONLY_FOR_AUTHOR = /\bonly[\s ]+for[\s ]+author\b/i;

export function checkGuards(s: Snapshot): string[] {
  const problems: string[] = [];
  const credits = JSON.stringify(s.playbook.overview.credits ?? []);
  if (!credits.includes('CC BY 4.0') || !credits.includes('EkStep'))
    problems.push('The credits must keep the CC BY 4.0 licence and the attribution to EkStep.');
  const all = JSON.stringify(s.playbook) + JSON.stringify(s.jobs);
  if (ONLY_FOR_AUTHOR.test(all) || ONLY_FOR_AUTHOR.test(s.playbook.source_doc))
    problems.push('Content marked "Only for Author" can\'t be published in the playbook or the source document.');
  if (!s.playbook.title.trim()) problems.push('The playbook needs a title.');
  return problems;
}

/** The source document is loaded whole into Cube's prompt; this is its budget, in tokens. */
export const SOURCE_TOKEN_CAP = 100_000;
/** A rough token count (about 4 characters per token). */
export const sourceTokens = (doc: string) => Math.ceil(doc.length / 4);

/**
 * Blocks a change that makes the source document longer than its budget. A
 * document already over it can still be shortened.
 */
export function checkSize(base: Snapshot, next: Snapshot): string[] {
  const after = sourceTokens(next.playbook.source_doc);
  if (after <= SOURCE_TOKEN_CAP || after <= sourceTokens(base.playbook.source_doc)) return [];
  return [
    `This would make the source document about ${after.toLocaleString("en")} tokens, over the ${SOURCE_TOKEN_CAP.toLocaleString("en")} Cube can read whole. Shorten it first, or leave some of these changes out.`,
  ];
}

/**
 * Soft warnings: allowed, but probably not intended. Shown in the diff
 * screen; they don't block Apply.
 */
export function checkWarnings(base: Snapshot, next: Snapshot): string[] {
  const out: string[] = [];
  const untracked = next.jobs.filter(
    (j) => !(j.body.tracked_by ?? []).includes('PMU') && (base.jobs.find((b) => b.job_code === j.job_code)?.body.tracked_by ?? ['PMU']).includes('PMU')
  );
  if (untracked.length)
    out.push(
      `PMU no longer tracks: ${untracked.map((j) => j.name).join(', ')}. ${untracked.length === 1 ? 'It' : 'They'} will disappear from the PMU’s Jobs screen.`
    );
  return out;
}

// ---------------------------------------------------------------------------
// What to save
// ---------------------------------------------------------------------------

export interface SaveArgs {
  playbook: Partial<PlaybookContent>;
  jobs: JobRow[];
  removed: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only what changed: playbook keys, full rows of changed or new jobs, removed codes. */
export function toSave(base: Snapshot, next: Snapshot): SaveArgs {
  const playbook: Partial<PlaybookContent> = {};
  for (const k of ['title', 'description', 'overview', 'roles', 'sequence', 'source_doc'] as const) {
    if (!same(base.playbook[k], next.playbook[k])) (playbook as Record<string, unknown>)[k] = next.playbook[k];
  }
  const before = new Map(base.jobs.map((j) => [j.job_code, j]));
  const jobs = next.jobs.filter((j) => !same(before.get(j.job_code), j));
  const nextCodes = new Set(next.jobs.map((j) => j.job_code));
  const removed = base.jobs.map((j) => j.job_code).filter((c) => !nextCodes.has(c));
  return { playbook, jobs, removed };
}

export const isEmptySave = (a: SaveArgs) => !Object.keys(a.playbook).length && !a.jobs.length && !a.removed.length;

// ---------------------------------------------------------------------------
// From an edited list to the smallest ops (forms use this)
// ---------------------------------------------------------------------------

/**
 * The ops that turn `before` into `after` for a job's list field:
 * - items added at the end -> one job.append each
 * - same length, some items changed -> job.replace_item each
 * - some items deleted, the rest unchanged and in order -> job.remove_item
 *   each (highest index first, so earlier indexes stay valid)
 * - anything else (reorder, mixed changes, cleared) -> one whole-list job.set
 */
export function listOps(job: string, field: JobListField, before: ListItem[], after: ListItem[]): PatchOp[] {
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (eq(before, after)) return [];
  if (!after.length) return [{ op: 'job.set', job, field, value: [] }];

  if (after.length > before.length && before.every((x, i) => eq(x, after[i])))
    return after.slice(before.length).map((item) => ({ op: 'job.append', job, field, item }));

  if (after.length === before.length) {
    const changed = before.map((x, i) => i).filter((i) => !eq(before[i], after[i]));
    // Every changed slot must be a real edit, not a swap with another slot.
    const isSwap = changed.some((i) => before.some((x, k) => k !== i && eq(x, after[i])));
    if (!isSwap)
      return changed.map((i) => ({ op: 'job.replace_item', job, field, index: i, expect: itemText(before[i]), item: after[i] }));
  }

  if (after.length < before.length) {
    // Is `after` = `before` with some items taken out?
    const removed: number[] = [];
    let k = 0;
    for (let i = 0; i < before.length; i++) {
      if (k < after.length && eq(before[i], after[k])) k++;
      else removed.push(i);
    }
    if (k === after.length)
      return removed.reverse().map((i) => ({ op: 'job.remove_item', job, field, index: i, expect: itemText(before[i]) }));
  }

  return [{ op: 'job.set', job, field, value: after }];
}
