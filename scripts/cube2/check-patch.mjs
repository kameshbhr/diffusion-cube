// Assertion checks for lib/companion-v2/patch.ts against the seed playbook.
//
//   node scripts/cube2/check-patch.mjs
//
// Needs Node 22.18+ / 24 (runs the .ts module directly; patch.ts has only
// type imports). Prints PASS/FAIL per check and exits 1 on any failure.

import { readFileSync } from 'node:fs';
import { applyOps, checkGuards, checkWarnings, isEmptySave, listOps, toSave } from '../../lib/companion-v2/patch.ts';

const seed = JSON.parse(readFileSync(new URL('../../content/playbooks/low-resource-language.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../../content/playbooks/low-resource-language.source.md', import.meta.url), 'utf8');
const base = {
  playbook: {
    title: seed.title,
    description: seed.description,
    overview: seed.overview,
    roles: seed.roles,
    sequence: seed.sequence,
    source_doc: source,
  },
  jobs: seed.jobs,
};

let pass = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};
const job = (s, code) => s.jobs.find((j) => j.job_code === code);
const run = (ops) => applyOps(base, ops);

// ---------- job.set ----------
{
  const { next, results } = run([{ op: 'job.set', job: 'S4', field: 'when', value: '2–3 months' }]);
  ok('job.set changes one field', results[0].ok && job(next, 'S4').body.when === '2–3 months');
  ok('...and nothing else', JSON.stringify(job(next, 'S5')) === JSON.stringify(job(base, 'S5')));
  ok('base snapshot is not mutated', job(base, 'S4').body.when !== '2–3 months');
  const save = toSave(base, next);
  ok('toSave sends only the changed job', save.jobs.length === 1 && save.jobs[0].job_code === 'S4' && !Object.keys(save.playbook).length && !save.removed.length);
}
ok('job.set unknown job fails', !run([{ op: 'job.set', job: 'ZZ9', field: 'when', value: 'x' }]).results[0].ok);
ok('job.set non-whitelisted field fails', !run([{ op: 'job.set', job: 'S4', field: 'work_area', value: 'x' }]).results[0].ok);
ok('job.set wrong type fails', !run([{ op: 'job.set', job: 'S4', field: 'gaps', value: 'not a list' }]).results[0].ok);
ok('job.set empty name fails', !run([{ op: 'job.set', job: 'S4', field: 'name', value: '  ' }]).results[0].ok);

// ---------- item ops ----------
{
  const before = job(base, 'S4').body.gaps.length;
  const { next, results } = run([{ op: 'job.append', job: 'S4', field: 'gaps', item: 'Who signs off the plan.' }]);
  ok('job.append adds one item at the end', results[0].ok && job(next, 'S4').body.gaps.length === before + 1 && job(next, 'S4').body.gaps.at(-1) === 'Who signs off the plan.');
}
{
  const t0 = job(base, 'P1').body.tasks[0];
  const r = run([{ op: 'job.remove_item', job: 'P1', field: 'tasks', index: 0, expect: t0.text }]);
  ok('job.remove_item with matching expect works', r.results[0].ok && job(r.next, 'P1').body.tasks.length === job(base, 'P1').body.tasks.length - 1);
  const stale = run([{ op: 'job.remove_item', job: 'P1', field: 'tasks', index: 0, expect: 'something else' }]);
  ok('job.remove_item with a stale expect fails', !stale.results[0].ok && /changed/.test(stale.results[0].error));
  const rep = run([{ op: 'job.replace_item', job: 'P1', field: 'tasks', index: 0, expect: t0.text, item: { ...t0, timing: 'Week 2' } }]);
  ok('job.replace_item replaces in place', rep.results[0].ok && job(rep.next, 'P1').body.tasks[0].timing === 'Week 2');
  ok('job.replace_item rejects a bad task', !run([{ op: 'job.replace_item', job: 'P1', field: 'tasks', index: 0, expect: t0.text, item: { text: 'x' } }]).results[0].ok);
  ok('item op out of range fails', !run([{ op: 'job.remove_item', job: 'P1', field: 'gaps', index: 99, expect: '' }]).results[0].ok);
}

// ---------- job add / remove ----------
{
  const place = { stages: ['Scale'], work_area: 'Institution', job_type: 'Operate', position: 41 };
  const r = run([{ op: 'job.add', job: 'X1', value: { name: 'A new job', body: { when: 'Later' }, ...place } }]);
  ok('job.add adds a job tracked by PMU', r.results[0].ok && job(r.next, 'X1')?.body.tracked_by?.[0] === 'PMU');
  ok('job.add duplicate code fails', !run([{ op: 'job.add', job: 'S4', value: { name: 'dup' } }]).results[0].ok);
  ok('job.add bad code fails', !run([{ op: 'job.add', job: '', value: { name: 'x' } }]).results[0].ok);
  const rm = run([{ op: 'job.remove', job: 'E10' }]);
  ok('job.remove drops the job and its sequence references', rm.results[0].ok && !job(rm.next, 'E10') && !rm.next.playbook.sequence.phases.some((p) => p.jobs.includes('E10')));
  const save = toSave(base, rm.next);
  ok('toSave lists the removed job and the changed sequence', save.removed.includes('E10') && 'sequence' in save.playbook);
}

// ---------- overview / roles / phases / rules / sequence ----------
ok('overview.set outcomes', run([{ op: 'overview.set', field: 'outcomes', value: ['One'] }]).next.playbook.overview.outcomes.length === 1);
ok('overview.set rejects bad entries', !run([{ op: 'overview.set', field: 'context', value: [{ nolabel: 1 }] }]).results[0].ok);
ok('overview.set title', run([{ op: 'overview.set', field: 'title', value: 'New title' }]).next.playbook.title === 'New title');
{
  const r0 = base.playbook.roles[0];
  ok('role.set renames a role', run([{ op: 'role.set', name: r0.name, value: { ...r0, name: 'Renamed' } }]).next.playbook.roles[0].name === 'Renamed');
  ok('role.add duplicate fails', !run([{ op: 'role.add', value: r0 }]).results[0].ok);
  ok('role.remove', run([{ op: 'role.remove', name: r0.name }]).next.playbook.roles.length === base.playbook.roles.length - 1);
}
{
  const p0 = base.playbook.sequence.phases[0];
  ok('phase.set with an unknown job fails', !run([{ op: 'phase.set', index: 0, value: { ...p0, jobs: ['ZZ9'] } }]).results[0].ok);
  ok('phase.add after step 1', run([{ op: 'phase.add', after: 0, value: { ...p0, name: 'New step' } }]).next.playbook.sequence.phases[1].name === 'New step');
  ok('phase.remove', run([{ op: 'phase.remove', index: 0 }]).next.playbook.sequence.phases.length === base.playbook.sequence.phases.length - 1);
}
ok('rules.set trims and keeps reasons', run([{ op: 'rules.set', value: [{ rule: ' A ', why: ' B ' }] }]).next.playbook.sequence.rules[0].why === 'B');
ok('rules.set rejects an empty rule', !run([{ op: 'rules.set', value: [{ rule: '', why: '' }] }]).results[0].ok);
ok('sequence.set milestones_note', run([{ op: 'sequence.set', field: 'milestones_note', value: 'x' }]).next.playbook.sequence.milestones_note === 'x');

// ---------- source document ----------
{
  const h = '### 4.2 — Budget Categories to Plan For';
  const r = run([{ op: 'source.replace_section', heading: h, text: 'NEW BUDGET TEXT' }]);
  const doc = r.next.playbook.source_doc;
  const sec = doc.slice(doc.indexOf(h), doc.indexOf('### 4.3'));
  ok('replace_section keeps the heading and replaces the body', r.results[0].ok && sec.includes('NEW BUDGET TEXT') && sec.split('\n').filter(Boolean).length === 2);
  ok('...and leaves the next section alone', doc.includes('### 4.3') && doc.indexOf('### 4.3') > doc.indexOf('NEW BUDGET TEXT'));
  const ap = run([{ op: 'source.append_to_section', heading: h, text: 'APPENDED' }]).next.playbook.source_doc;
  ok('append_to_section adds at the end of the section', ap.indexOf('APPENDED') < ap.indexOf('### 4.3') && ap.indexOf('APPENDED') > ap.indexOf(h));
  ok('missing heading fails', !run([{ op: 'source.replace_section', heading: '## Nope', text: 'x' }]).results[0].ok);
  const dupDoc = { ...base, playbook: { ...base.playbook, source_doc: '## A\n\nx\n\n## A\n\ny\n' } };
  ok('duplicate heading fails', !applyOps(dupDoc, [{ op: 'source.replace_section', heading: '## A', text: 'z' }]).results[0].ok);
  const add = run([{ op: 'source.add_section', after_heading: h, heading: '### 4.2a — Extra', text: 'More.' }]).next.playbook.source_doc;
  ok('add_section goes after the named section', add.indexOf('### 4.2a — Extra') > add.indexOf(h) && add.indexOf('### 4.2a — Extra') < add.indexOf('### 4.3'));
  ok('add_section with an existing heading fails', !run([{ op: 'source.add_section', after_heading: null, heading: h, text: 'x' }]).results[0].ok);
  ok('replace with text found once works', run([{ op: 'source.replace', find: 'Cluster 1 — The Case', replace: 'Cluster 1 — The Case!' }]).results[0].ok);
  ok('replace with missing text fails', !run([{ op: 'source.replace', find: 'not in the document at all', replace: 'x' }]).results[0].ok);
  ok('replace with repeated text fails', !run([{ op: 'source.replace', find: 'the', replace: 'x' }]).results[0].ok);
  ok('replace handles $ in the replacement literally', run([{ op: 'source.replace', find: 'Cluster 1 — The Case', replace: 'costs $& and $1' }]).next.playbook.source_doc.includes('costs $& and $1'));
}

// ---------- sequencing of ops ----------
{
  const r = run([
    { op: 'job.set', job: 'S4', field: 'when', value: 'A' },
    { op: 'job.set', job: 'ZZ9', field: 'when', value: 'B' },
    { op: 'job.set', job: 'S5', field: 'when', value: 'C' },
  ]);
  ok('a failing op in the middle is skipped, the others apply', r.results[0].ok && !r.results[1].ok && r.results[2].ok && job(r.next, 'S5').body.when === 'C');
}

// ---------- listOps (what forms send) ----------
{
  const tasks = job(base, 'P1').body.tasks;
  const added = { stage: 'Stage 0', timing: 'Week 1', owner: 'PMU', text: 'A new task.' };
  const a = listOps('P1', 'tasks', tasks, [...tasks, added]);
  ok('adding one task gives a single job.append', a.length === 1 && a[0].op === 'job.append');
  const edited = tasks.map((x, i) => (i === 2 ? { ...x, timing: 'Week 9' } : x));
  const e = listOps('P1', 'tasks', tasks, edited);
  ok('editing one task gives one job.replace_item', e.length === 1 && e[0].op === 'job.replace_item' && e[0].index === 2 && e[0].expect === tasks[2].text);
  const r = listOps('P1', 'tasks', tasks, tasks.filter((_, i) => i !== 1 && i !== 4));
  ok('removing two tasks gives two remove_item, highest first', r.length === 2 && r.every((o) => o.op === 'job.remove_item') && r[0].index === 4 && r[1].index === 1);
  ok('...and applying them gives the edited list', JSON.stringify(job(applyOps(base, r).next, 'P1').body.tasks) === JSON.stringify(tasks.filter((_, i) => i !== 1 && i !== 4)));
  const swapped = [tasks[1], tasks[0], ...tasks.slice(2)];
  const s = listOps('P1', 'tasks', tasks, swapped);
  ok('a reorder gives one whole-list job.set', s.length === 1 && s[0].op === 'job.set');
  ok('no change gives no ops', listOps('P1', 'tasks', tasks, tasks).length === 0);
  ok('clearing gives job.set []', listOps('P1', 'gaps', ['a'], [])[0].op === 'job.set');
}

// ---------- review-fix checks ----------
ok('duplicate job in a step fails', !run([{ op: 'phase.set', index: 0, value: { ...base.playbook.sequence.phases[0], jobs: ['I1', 'I1'] } }]).results[0].ok);
ok('remove then re-add the same code fails', !run([{ op: 'job.remove', job: 'E10' }, { op: 'job.add', job: 'E10', value: { name: 'x', stages: ['Scale'], work_area: 'Ecosystem', job_type: 'Operate' } }]).results[1].ok);
ok('job.add with no stages fails', !run([{ op: 'job.add', job: 'X2', value: { name: 'x', stages: [], work_area: 'Ecosystem', job_type: 'Operate' } }]).results[0].ok);
ok('job.add with an unknown area fails', !run([{ op: 'job.add', job: 'X2', value: { name: 'x', stages: ['Scale'], work_area: 'Nope', job_type: 'Operate' } }]).results[0].ok);
ok('job.add with a fractional position fails', !run([{ op: 'job.add', job: 'X2', value: { name: 'x', stages: ['Scale'], work_area: 'Ecosystem', job_type: 'Operate', position: 1.5 } }]).results[0].ok);
ok('source.replace with no replacement fails', !run([{ op: 'source.replace', find: 'Cluster 1 — The Case' }]).results[0].ok);
ok('roles as an array fails', !run([{ op: 'job.set', job: 'S4', field: 'roles', value: ['x'] }]).results[0].ok);
ok('phase.add with no "after" goes at the end', run([{ op: 'phase.add', value: { ...base.playbook.sequence.phases[0], name: 'Last' } }]).next.playbook.sequence.phases.at(-1).name === 'Last');
{
  const doc = base.playbook.source_doc;
  const h = '### 4.2 — Budget Categories to Plan For';
  const out = run([{ op: 'source.replace_section', heading: h, text: 'X' }]).next.playbook.source_doc;
  const outside = (d) => d.slice(0, d.indexOf(h)) + d.slice(d.indexOf('### 4.3'));
  ok('replace_section leaves the rest of the document byte-for-byte', outside(out) === outside(doc));
  ok('replace_section text that repeats the heading fails', !run([{ op: 'source.replace_section', heading: h, text: `${h}\n\nX` }]).results[0].ok);
}
{
  const next = run([{ op: 'job.set', job: 'S4', field: 'tracked_by', value: [] }]).next;
  ok('dropping PMU from Who tracks gives a warning', checkWarnings(base, next).length === 1);
}

// ---------- guards ----------
ok('seed passes the guards', checkGuards(base).length === 0);
{
  const noCc = run([{ op: 'overview.set', field: 'credits', value: [{ label: 'Licence', value: 'All rights reserved' }] }]).next;
  ok('removing CC BY 4.0 is caught', checkGuards(noCc).some((p) => /CC BY 4\.0/.test(p)));
  const ofa = run([{ op: 'source.append', text: '## Only for   Author\n\nsecret' }]).next;
  ok('"Only for Author" (odd spacing) is caught', checkGuards(ofa).some((p) => /Only for Author/.test(p)));
  const fine = run([{ op: 'source.append', text: 'For use only for authorised staff.' }]).next;
  ok('"only for authorised staff" is allowed', checkGuards(fine).length === 0);
}
ok('no change gives an empty save', isEmptySave(toSave(base, run([]).next)));

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
