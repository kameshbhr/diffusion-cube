// One serializer for the playbook JSON, so every producer writes byte-identical
// output for the same content:
//   - scripts/cube2/export-playbook.mjs (from the original HTML),
//   - scripts/cube2/export-db.mjs (from the database, round-trip check),
//   - the contributor's "Download playbook as JSON" button.
// Plain JavaScript (not TypeScript) so Node scripts can import it without a
// build step; the app imports it too (tsconfig has allowJs).
//
// The source document is NOT part of this JSON. It travels as its own
// markdown file, next to the JSON.

export const PLAYBOOK_JSON_VERSION = 1;

/** Key orders for every known object shape. Unknown keys go last, sorted. */
const ORDER = {
  playbook: ['version', 'slug', 'title', 'description', 'overview', 'roles', 'sequence', 'jobs'],
  overview: ['purpose', 'context', 'based_on', 'outcomes', 'insights', 'maturity_flags', 'credits'],
  entry: ['label', 'value', 'items', 'note'],
  role: ['name', 'group', 'description', 'example', 'see', 'owner_keys', 'playbook_names'],
  sequence: ['phases', 'rules', 'milestones', 'milestones_note', 'note', 'framework'],
  phase: ['name', 'when', 'text', 'jobs'],
  rule: ['rule', 'why'],
  framework: ['not_stated', 'stages', 'areas', 'types'],
  named: ['name', 'info'],
  job: ['job_code', 'name', 'position', 'stages', 'work_area', 'job_type', 'body'],
  body: [
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
  ],
  task: ['stage', 'timing', 'owner', 'text'],
  jobRoles: ['owns', 'does', 'reviews', 'enables'],
  maturity: ['flag', 'note'],
};

function ordered(obj, keys) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const k of keys) if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj).filter((k) => !keys.includes(k)).sort()) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

const list = (a, fn) => (Array.isArray(a) ? a.map(fn) : a);

function canonicalOverview(o) {
  const entry = (e) => ordered(e, ORDER.entry);
  const ov = ordered(o ?? {}, ORDER.overview);
  for (const k of ['purpose', 'context', 'based_on', 'maturity_flags', 'credits']) {
    if (k in ov) ov[k] = list(ov[k], entry);
  }
  return ov;
}

function canonicalSequence(s) {
  const seq = ordered(s ?? {}, ORDER.sequence);
  if ('phases' in seq) seq.phases = list(seq.phases, (p) => ordered(p, ORDER.phase));
  if ('rules' in seq) seq.rules = list(seq.rules, (r) => ordered(r, ORDER.rule));
  if ('milestones' in seq) seq.milestones = list(seq.milestones, (e) => ordered(e, ORDER.entry));
  if (seq.framework) {
    const fw = ordered(seq.framework, ORDER.framework);
    const named = (n) => ordered(n, ORDER.named);
    if ('stages' in fw) fw.stages = list(fw.stages, named);
    if ('areas' in fw) fw.areas = list(fw.areas, named);
    seq.framework = fw;
  }
  return seq;
}

function canonicalJob(j) {
  const job = ordered(j, ORDER.job);
  const body = ordered(job.body ?? {}, ORDER.body);
  if ('tasks' in body) body.tasks = list(body.tasks, (t) => ordered(t, ORDER.task));
  if (body.roles) body.roles = ordered(body.roles, ORDER.jobRoles);
  if (body.maturity) body.maturity = ordered(body.maturity, ORDER.maturity);
  job.body = body;
  return job;
}

/** Sort key for jobs: position, then job code (natural order: P2 before P10). */
function compareJobs(a, b) {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return String(a.job_code).localeCompare(String(b.job_code), 'en', { numeric: true });
}

/**
 * Returns the canonical playbook object: fixed key order, jobs sorted.
 * @param {{slug:string,title:string,description?:string,overview:object,roles:object[],sequence:object,jobs:object[]}} p
 */
export function canonicalPlaybook(p) {
  const out = ordered({ version: PLAYBOOK_JSON_VERSION, ...p }, ORDER.playbook);
  out.overview = canonicalOverview(p.overview);
  out.roles = list(p.roles ?? [], (r) => ordered(r, ORDER.role));
  out.sequence = canonicalSequence(p.sequence);
  out.jobs = [...(p.jobs ?? [])].sort(compareJobs).map(canonicalJob);
  return out;
}

/** The exact text written to disk / downloaded. */
export function serializePlaybook(p) {
  return JSON.stringify(canonicalPlaybook(p), null, 2) + '\n';
}
