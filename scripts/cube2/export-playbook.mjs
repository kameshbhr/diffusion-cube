// Exports the playbook prototype HTML into the checked-in seed JSON.
//
//   node scripts/cube2/export-playbook.mjs <playbook.html> <out.json> [--slug <slug>]
//
// The HTML keeps all its data in one inline <script> (JOBS, OVERVIEW, PHASES,
// RULES, ROLES, PMU, WHEN, TASKS, OWNERS) plus enrichment loops that attach
// when/tasks/owners to each job. We run that script in a node:vm sandbox with
// a do-nothing DOM, stopping before the final DOM wiring, then read the
// globals back. Purpose / Based on / Credits are hard-coded markup inside
// purposeHtml(), basisHtml() and creditsHtml(), so those are called and their
// <dt>/<dd> pairs parsed.
//
// One-time use: after the first seed the database is the source of truth and
// the HTML is frozen. Exits non-zero if any check fails.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { serializePlaybook } from '../../lib/companion-v2/playbook-json.mjs';

const args = process.argv.slice(2);
const [htmlPath, outPath] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--slug');
const slugIdx = args.indexOf('--slug');
const slug = slugIdx > -1 ? args[slugIdx + 1] : 'low-resource-language';
if (!htmlPath || !outPath) {
  console.error('Usage: node scripts/cube2/export-playbook.mjs <playbook.html> <out.json> [--slug <slug>]');
  process.exit(2);
}

const html = readFileSync(htmlPath, 'utf8');

// ---------- run the data script ----------
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('No inline <script> found.');
let script = scriptMatch[1];
// Everything from the first top-level DOM wiring call onward only renders UI.
const wiringAt = script.search(/^document\./m);
if (wiringAt > -1) script = script.slice(0, wiringAt);

// A DOM stand-in: any property read or call returns itself, so stray
// references during evaluation cannot throw.
const dom = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : dom),
  apply: () => dom,
});
const ctx = vm.createContext({ document: dom, window: dom, history: dom, location: dom, console });
vm.runInContext(script, ctx, { filename: htmlPath });

const G = (name) => {
  const v = vm.runInContext(`typeof ${name} === 'undefined' ? undefined : ${name}`, ctx);
  if (v === undefined) throw new Error(`Global ${name} not found in the HTML script.`);
  // Copy out of the sandbox realm so instanceof/Array.isArray behave normally.
  return JSON.parse(JSON.stringify(v));
};

const NS = G('NS');
const JOBS = G('JOBS');
const OVERVIEW = G('OVERVIEW');
const PHASES = G('PHASES');
const RULES = G('RULES');
const ROLES = G('ROLES');
const PMU = G('PMU');
const TASKS = G('TASKS');
const STAGES = G('STAGES');
const STAGE_INFO = G('STAGE_INFO');
const AREAS = G('AREAS');
const TYPES = G('TYPES');
const callHtml = (fn) => vm.runInContext(`${fn}()`, ctx);

// ---------- markup helpers ----------
const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
const text = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Parses <dt>Label</dt><dd>…</dd> pairs into [{label, value?, items?, note?}]. */
function parseKv(markup) {
  const out = [];
  const re = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
  let m;
  while ((m = re.exec(markup))) {
    const label = text(m[1]);
    const dd = m[2];
    const ul = dd.match(/<ul>([\s\S]*?)<\/ul>/);
    if (ul) {
      const items = [...ul[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => text(x[1]));
      const rest = text(dd.replace(ul[0], ''));
      const entry = { label, items };
      if (rest) entry.note = rest;
      out.push(entry);
    } else {
      out.push({ label, value: text(dd) });
    }
  }
  return out;
}

// ---------- title / description from the page header ----------
const h1 = text(html.match(/<header class="top">[\s\S]*?<h1>([\s\S]*?)<\/h1>/)[1]);
const description = text(html.match(/<header class="top">[\s\S]*?<\/h1>\s*<p>([\s\S]*?)<\/p>/)[1]);
const title = h1.replace(/:\s*playbook$/i, '').trim();

// ---------- overview ----------
const overview = {
  purpose: parseKv(callHtml('purposeHtml')),
  context: OVERVIEW.context.map(([label, value]) => ({ label, value })),
  based_on: parseKv(callHtml('basisHtml')),
  outcomes: OVERVIEW.outcomes,
  insights: OVERVIEW.insights,
  maturity_flags: OVERVIEW.maturity.flags.map(([label, value]) => ({ label, value })),
  credits: parseKv(callHtml('creditsHtml')),
};

// ---------- roles ----------
const roles = ROLES.map((r) => ({
  name: r.n,
  group: r.g,
  description: r.d,
  example: r.e || '',
  see: r.see || '',
  owner_keys: r.k || [], // names used in jobs' owners lists
  playbook_names: r.m || [], // names to look for in a job's "roles as written"
}));

// ---------- sequence ----------
const sequence = {
  phases: PHASES.map((p) => ({ name: p.n, when: p.w, text: p.t, jobs: p.jobs })),
  rules: RULES.map(([rule, why]) => ({ rule, why: why || '' })),
  // Framework placement, used only by the contributor's Jobs map. Never shown to adopters.
  framework: {
    not_stated: NS,
    stages: STAGES.map((name) => ({ name, info: STAGE_INFO[name] })),
    areas: AREAS.map(([name, info]) => ({ name, info })),
    types: TYPES,
  },
};

// ---------- jobs ----------
// position = order of first appearance in the sequence.
const firstSeen = [];
for (const p of PHASES) for (const id of p.jobs) if (!firstSeen.includes(id)) firstSeen.push(id);

const jobs = JOBS.map((j) => ({
  job_code: j.id,
  name: j.name,
  position: firstSeen.indexOf(j.id) + 1 || null,
  stages: j.stages,
  work_area: j.area,
  job_type: j.type,
  body: {
    intended_result: j.result,
    why_it_matters: j.why,
    when: j.when,
    // Decision 2: the HTML's "how" bullets are the short how, as they are.
    how_summary: j.how,
    tasks: j.tasks.map((t) => ({ stage: t.s, timing: t.w, owner: t.o, text: t.t })),
    roles: j.roles,
    owners: j.owners,
    tracked_by: j.trackedBy,
    owner_note: j.pmu?.n ?? NS,
    gaps: j.gaps,
    maturity: j.mat ? { flag: j.mat.flag ?? null, note: j.mat.note ?? '' } : null,
    recurs: !!j.recurs,
  },
}));

const playbook = { slug, title, description, overview, roles, sequence, jobs };

// ---------- checks ----------
const problems = [];
const info = [];
const codes = new Set(jobs.map((j) => j.job_code));
const taskLinks = jobs.reduce((n, j) => n + j.body.tasks.length, 0);

info.push(
  `Counts: ${jobs.length} jobs, ${roles.length} roles, ${sequence.phases.length} phases, ` +
    `${sequence.rules.length} rules, ${TASKS.length} checklist rows (${taskLinks} task-to-job links).`
);
const expect = { jobs: 40, roles: 23, phases: 14, rules: 12, rows: 139 };
if (jobs.length !== expect.jobs) problems.push(`Expected ${expect.jobs} jobs.`);
if (roles.length !== expect.roles) problems.push(`Expected ${expect.roles} roles.`);
if (sequence.phases.length !== expect.phases) problems.push(`Expected ${expect.phases} phases.`);
if (sequence.rules.length !== expect.rules) problems.push(`Expected ${expect.rules} rules.`);
if (TASKS.length !== expect.rows) problems.push(`Expected ${expect.rows} checklist rows.`);

const unknownPhaseCodes = sequence.phases.flatMap((p) => p.jobs.filter((c) => !codes.has(c)).map((c) => `${c} (${p.name})`));
if (unknownPhaseCodes.length) problems.push(`Unknown job codes in phases: ${unknownPhaseCodes.join(', ')}`);

const unknownTaskCodes = TASKS.flatMap((t) => t[0].split(',').filter((c) => !codes.has(c)));
if (unknownTaskCodes.length) problems.push(`Unknown job codes in checklist rows: ${[...new Set(unknownTaskCodes)].join(', ')}`);

const noPhase = jobs.filter((j) => !j.position).map((j) => j.job_code);
if (noPhase.length) problems.push(`Jobs in no phase: ${noPhase.join(', ')}`);

const unknownOwnerCodes = Object.keys(G('OWNERS')).filter((c) => !codes.has(c));
if (unknownOwnerCodes.length) problems.push(`OWNERS has unknown job codes: ${unknownOwnerCodes.join(', ')}`);

const noOwner = jobs.filter((j) => !j.body.owners.length);
info.push(`Jobs with no owner named (${noOwner.length}): ${noOwner.map((j) => `${j.job_code} ${j.name}`).join('; ') || 'none'}`);
const noTasks = jobs.filter((j) => !j.body.tasks.length);
info.push(`Jobs with no checklist tasks (${noTasks.length}): ${noTasks.map((j) => `${j.job_code} ${j.name}`).join('; ') || 'none'}`);

const owns = jobs.filter((j) => j.body.owners.includes('PMU'));
info.push(`PMU owns ${owns.length} jobs: ${owns.map((j) => j.job_code).join(', ')}. PMU tracks all ${jobs.length}.`);
// The HTML's hand-written PMU tags are overwritten by the owners-derived rule; report any disagreement.
const tagMismatch = jobs.filter((j) => PMU[j.job_code] && (PMU[j.job_code].r === 'Owns') !== j.body.owners.includes('PMU'));
if (tagMismatch.length) {
  info.push(
    `Hand-written PMU tag differs from the owners list (owners list wins): ` +
      tagMismatch.map((j) => `${j.job_code} hand=${PMU[j.job_code].r}`).join(', ')
  );
}
const noTracked = jobs.filter((j) => !j.body.tracked_by.includes('PMU'));
if (noTracked.length) problems.push(`Jobs not tracked by PMU: ${noTracked.map((j) => j.job_code).join(', ')}`);

const creditsText = JSON.stringify(overview.credits);
if (!creditsText.includes('CC BY 4.0')) problems.push('Credits do not contain "CC BY 4.0".');
if (!creditsText.includes('EkStep')) problems.push('Credits do not contain "EkStep".');
if (/\bonly\s+for\s+author\b/i.test(JSON.stringify(playbook))) problems.push('Playbook contains "Only for Author" text.');

for (const [k, v] of Object.entries(overview)) {
  if (!Array.isArray(v) || !v.length) problems.push(`Overview section "${k}" is empty.`);
}

// ---------- write ----------
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, serializePlaybook(playbook));

console.log(`Wrote ${outPath}`);
for (const line of info) console.log(`  ${line}`);
if (problems.length) {
  console.error('\nCHECKS FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
