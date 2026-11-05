// "Update with Cube": the <playbook_patch> block at the end of a contributor
// reply, and the uploaded-file chunking. Same pattern as ui-action.ts and
// lib/grid-update.ts: parse, strip while streaming, then keep only what is
// valid. No React and only type imports, so scripts/cube2/check-patch.mjs can
// run it directly.
//
// The model never writes anything: the ops it proposes go to the diff screen
// (PatchReview), where the contributor ticks, edits, applies or discards them.

import type { PatchOp, Snapshot } from './patch';

export interface Contradiction {
  topic: string;
  existing: string;
  incoming: string;
  source?: string;
}

/** A change Cube proposed that this screen won't offer, with the reason. */
export interface RefusedOp {
  op: string;
  reason: string;
}

export interface ProposedPatch {
  summary: string;
  question: string | null;
  ops: PatchOp[];
  contradictions: Contradiction[];
  refused: RefusedOp[];
}

const OPEN = '<playbook_patch';
const TEXT_OPEN = '<patch_text';
const BLOCK = /<playbook_patch>([\s\S]*?)<\/playbook_patch>/;
// Long text travels outside the JSON, so markdown with quotes needs no escaping:
//   "text": {"block": 1}   …   <patch_text id="1">markdown</patch_text>
const TEXT_BLOCK = /<patch_text id="(\d+)">\n?([\s\S]*?)\n?<\/patch_text>/g;

/** Replaces every {"block": N} in the parsed JSON with the text of block N. */
function fillBlocks(v: unknown, blocks: Map<string, string>): unknown {
  if (Array.isArray(v)) return v.map((x) => fillBlocks(x, blocks));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === 'block' && (typeof o.block === 'number' || typeof o.block === 'string')) {
      // A missing block stays as it is; applyOps then reports the change as incomplete.
      return blocks.get(String(o.block)) ?? v;
    }
    return Object.fromEntries(keys.map((k) => [k, fillBlocks(o[k], blocks)]));
  }
  return v;
}

/** Raw JSON of the block (with text blocks filled in), or null if it is missing or not valid JSON. */
export function parsePatchBlock(text: string): unknown | null {
  const match = text.match(BLOCK);
  if (!match) return null;
  // Tolerate a code fence around the JSON.
  const body = match[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const blocks = new Map<string, string>();
  for (const m of text.matchAll(TEXT_BLOCK)) blocks.set(m[1], m[2]);
  return blocks.size ? fillBlocks(parsed, blocks) : parsed;
}

/** Cuts at the first block tag, so nothing that is still streaming shows. */
export function stripPatchBlock(text: string): string {
  const cuts = [text.indexOf(OPEN), text.indexOf(TEXT_OPEN)].filter((i) => i > -1);
  if (cuts.length) return text.slice(0, Math.min(...cuts)).trim();
  for (const tag of [OPEN, TEXT_OPEN]) {
    for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
      if (text.endsWith(tag.slice(0, n))) return text.slice(0, text.length - n).trimEnd();
    }
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Which changes Cube may propose
// ---------------------------------------------------------------------------

/**
 * Every op Cube may propose. Removing a job or a step, and replacing the whole
 * source document, are left to the forms and the editor, where the
 * contributor does them on purpose.
 */
export const MODEL_OPS: ReadonlySet<string> = new Set([
  'job.set',
  'job.add',
  'job.append',
  'job.remove_item',
  'job.replace_item',
  'overview.set',
  'sequence.set',
  'role.set',
  'role.add',
  'role.remove',
  'phase.set',
  'phase.add',
  'rules.set',
  'source.replace_section',
  'source.append_to_section',
  'source.add_section',
  'source.replace',
  'source.insert_after',
  'source.append',
]);

const LIST_FIELDS = ['how_summary', 'gaps', 'tasks'];
const MAX_OPS = 60;
const MAX_CONTRADICTIONS = 30;
const TEXT_MAX = 2000;

const sortedJson = (list: unknown[]) => list.map((x) => JSON.stringify(x)).sort().join('\n');

/** Why Cube may not propose this op here, or null if it may. */
export function modelOpProblem(op: unknown, base: Snapshot): string | null {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return 'This isn’t a change.';
  const o = op as Record<string, unknown>;
  const name = o.op;
  if (typeof name !== 'string') return 'This change has no type.';
  if (name === 'job.remove') return 'Removing a job is done on the Playbook screen (open the job, then Edit).';
  if (name === 'phase.remove') return 'Removing a step is done on the Playbook screen (Sequence tab).';
  if (name === 'source.set') return 'Cube doesn’t replace the whole source document; edit it on the Source document screen.';
  if (!MODEL_OPS.has(name)) return `Unknown change "${name}".`;
  // A whole-list job.set may only clear or reorder; items change one at a time.
  if (name === 'job.set' && typeof o.field === 'string' && LIST_FIELDS.includes(o.field) && Array.isArray(o.value) && o.value.length) {
    const job = base.jobs.find((j) => j.job_code === o.job);
    const current = (job?.body as Record<string, unknown> | undefined)?.[o.field];
    if (!job || !Array.isArray(current)) return null; // applyOps reports the error
    if (current.length !== o.value.length || sortedJson(current) !== sortedJson(o.value))
      return 'A whole list can only be cleared or reordered here; Cube should add, change or remove its items one at a time.';
  }
  return null;
}

const str = (v: unknown, max = TEXT_MAX) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Keeps what is valid: a summary, at most one question, the ops Cube may
 * propose (the rest are listed as refused), and well-formed contradictions.
 * Whether each op applies is checked later by applyOps in the diff screen.
 */
export function sanitizePatch(raw: unknown, base: Snapshot): ProposedPatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ops: PatchOp[] = [];
  const refused: RefusedOp[] = [];
  for (const op of Array.isArray(r.ops) ? r.ops.slice(0, MAX_OPS) : []) {
    const problem = modelOpProblem(op, base);
    if (problem) refused.push({ op: String((op as { op?: unknown })?.op ?? 'unknown'), reason: problem });
    else ops.push(op as PatchOp);
  }
  if (Array.isArray(r.ops) && r.ops.length > MAX_OPS)
    refused.push({ op: 'more', reason: `Only the first ${MAX_OPS} changes are shown. Ask Cube for the rest (attach any files again).` });

  const contradictions: Contradiction[] = [];
  for (const c of Array.isArray(r.contradictions) ? r.contradictions.slice(0, MAX_CONTRADICTIONS) : []) {
    if (!c || typeof c !== 'object') continue;
    const x = c as Record<string, unknown>;
    const item = { topic: str(x.topic, 200), existing: str(x.existing), incoming: str(x.incoming), source: str(x.source, 200) || undefined };
    if (item.topic && (item.existing || item.incoming)) contradictions.push(item);
  }

  return {
    summary: str(r.summary),
    question: str(r.question) || null,
    ops,
    contradictions,
    refused,
  };
}

// ---------------------------------------------------------------------------
// Overlaps between parts of a large upload
// ---------------------------------------------------------------------------

/** What an op changes, as a key; two ops with the same key touch the same thing. */
export function opTargetKey(op: PatchOp): string {
  const o = op as unknown as Record<string, unknown>;
  switch (op.op) {
    case 'job.set':
    case 'job.append':
    case 'job.remove_item':
    case 'job.replace_item':
      return `job:${op.job}:${op.field}`;
    case 'job.add':
    case 'job.remove':
      return `job:${op.job}`;
    case 'overview.set':
      return `overview:${op.field}`;
    case 'sequence.set':
      return `sequence:${op.field}`;
    case 'role.set':
    case 'role.remove':
      return `role:${op.name}`;
    case 'role.add':
      return `role:${(op.value as { name?: string })?.name ?? ''}`;
    case 'phase.set':
    case 'phase.remove':
      return `phase:${op.index}`;
    case 'phase.add':
      return 'phases';
    case 'rules.set':
      return 'rules';
    case 'source.replace_section':
    case 'source.append_to_section':
      return `source:${String(o.heading ?? '').trim()}`;
    case 'source.add_section':
      return `source:${String(o.heading ?? '').trim()}`;
    default:
      return `source:${op.op}:${String(o.find ?? '')}`;
  }
}

/**
 * Indexes of ops whose target is also changed by an op from another part of
 * the upload. partOf[i] is the part op i came from.
 */
export function overlappingOps(ops: PatchOp[], partOf: number[]): number[] {
  const parts = new Map<string, Set<number>>();
  ops.forEach((op, i) => {
    const k = opTargetKey(op);
    if (!parts.has(k)) parts.set(k, new Set());
    parts.get(k)!.add(partOf[i]);
  });
  return ops.map((_, i) => i).filter((i) => (parts.get(opTargetKey(ops[i]))?.size ?? 0) > 1);
}

// ---------------------------------------------------------------------------
// Uploaded files, split into parts that fit one request
// ---------------------------------------------------------------------------

export interface UploadedText {
  name: string;
  text: string;
}

/** Most files one request carries (the route's limit). */
export const MAX_FILES_PER_PART = 10;
/** Characters of file text per request (about 30k tokens). */
export const CHUNK_CHARS = 120_000;
/** Most file text one update takes, in all parts together. */
export const MAX_UPLOAD_CHARS = 600_000;

/** Splits text into pieces of at most `max` characters, at headings, then paragraphs, then lines. */
export function splitText(text: string, max = CHUNK_CHARS): string[] {
  if (text.length <= max) return [text];
  const levels = [/\n(?=#{1,3} )/, /\n\s*\n/, /\n/];
  const pack = (pieces: string[], sep: string): string[] => {
    const out: string[] = [];
    let cur = '';
    for (const p of pieces) {
      const next = cur ? cur + sep + p : p;
      if (next.length <= max) cur = next;
      else {
        if (cur) out.push(cur);
        cur = p;
      }
    }
    if (cur) out.push(cur);
    return out;
  };
  const split = (t: string, level: number): string[] => {
    if (t.length <= max) return [t];
    if (level >= levels.length) {
      const out: string[] = [];
      for (let i = 0; i < t.length; i += max) out.push(t.slice(i, i + max));
      return out;
    }
    const sep = level === 1 ? '\n\n' : '\n';
    const pieces = t.split(levels[level]).flatMap((p) => split(p, level + 1));
    return pack(pieces, sep);
  };
  return split(text, 0);
}

/**
 * Packs the files into parts of at most `max` characters each. A file larger
 * than a part is split and its pieces are named "name (part 2 of 3)". Small
 * files share a part.
 */
export function chunkFiles(files: UploadedText[], max = CHUNK_CHARS): UploadedText[][] {
  const pieces: UploadedText[] = [];
  for (const f of files) {
    const parts = splitText(f.text, max);
    parts.forEach((t, i) => pieces.push({ name: parts.length > 1 ? `${f.name} (part ${i + 1} of ${parts.length})` : f.name, text: t }));
  }
  const chunks: UploadedText[][] = [];
  let cur: UploadedText[] = [];
  let size = 0;
  for (const p of pieces) {
    if (cur.length && (size + p.text.length > max || cur.length >= MAX_FILES_PER_PART)) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** A rough token count for showing sizes (about 4 characters per token). */
export const approxTokens = (chars: number) => Math.ceil(chars / 4);
