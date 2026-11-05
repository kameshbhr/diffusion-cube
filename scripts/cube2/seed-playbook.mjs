// Seeds one playbook (structured JSON + source document) into Supabase.
//
//   node --env-file=.env.local scripts/cube2/seed-playbook.mjs \
//     --json content/playbooks/low-resource-language.json \
//     --source content/playbooks/low-resource-language.source.md \
//     [--slug <slug>] [--force] [--prune]
//
// Uses the service-role key (bypasses RLS). Run against a NON-PRODUCTION
// project first.
//
// After the first seed the database is the source of truth. Re-seeding an
// existing playbook needs --force and OVERWRITES every live contributor edit
// (overview, roles, sequence, jobs and the source document); there is no
// history. Back up first with scripts/cube2/export-db.mjs.
//
// --slug overrides the JSON's slug (e.g. a second "test-playbook" for access
// tests). --prune deletes jobs in the database that are not in the JSON.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SOURCE_TOKEN_CAP = 100_000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

const jsonPath = arg('json');
const sourcePath = arg('source');
if (!jsonPath || !sourcePath) {
  console.error('Usage: seed-playbook.mjs --json <file> --source <md> [--slug <slug>] [--force] [--prune]');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file).');
  process.exit(2);
}

const playbook = JSON.parse(readFileSync(jsonPath, 'utf8'));
const sourceDoc = readFileSync(sourcePath, 'utf8');
const slug = arg('slug') ?? playbook.slug;

// ---------- refuse bad content before touching the database ----------
const problems = [];
if (/\bonly\s+for\s+author\b/i.test(sourceDoc)) problems.push('The source document contains "Only for Author" text.');
if (/\bonly\s+for\s+author\b/i.test(JSON.stringify(playbook))) problems.push('The playbook JSON contains "Only for Author" text.');
const credits = JSON.stringify(playbook.overview?.credits ?? []);
if (!credits.includes('CC BY 4.0') || !credits.includes('EkStep')) {
  problems.push('The overview credits must keep "CC BY 4.0" and "EkStep".');
}
if (!Array.isArray(playbook.jobs) || playbook.jobs.length === 0) problems.push('The JSON has no jobs.');
if (problems.length) {
  for (const p of problems) console.error(`Refusing to seed: ${p}`);
  process.exit(1);
}

// ---------- size of the source document ----------
const approxTokens = Math.round(sourceDoc.length / 4);
let exactTokens = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const res = await new Anthropic().messages.countTokens({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: sourceDoc }],
    });
    exactTokens = res.input_tokens;
  } catch (e) {
    console.warn(`(Could not count tokens exactly: ${e.message})`);
  }
}
const tokens = exactTokens ?? approxTokens;
console.log(
  `Source document: ${sourceDoc.length.toLocaleString()} characters, ` +
    `${exactTokens != null ? `${exactTokens.toLocaleString()} tokens` : `~${approxTokens.toLocaleString()} tokens (estimate)`}, ` +
    `${Math.round((tokens / SOURCE_TOKEN_CAP) * 100)}% of the ${SOURCE_TOKEN_CAP.toLocaleString()}-token cap.`
);
if (tokens > SOURCE_TOKEN_CAP * 0.8) console.warn('WARNING: the source document is above 80% of the cap.');

// ---------- write ----------
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: existing, error: findErr } = await db.from('playbooks').select('id').eq('slug', slug).maybeSingle();
if (findErr) throw findErr;
if (existing && !flag('force')) {
  console.error(
    `Playbook "${slug}" already exists. Re-seeding overwrites every live edit; ` +
      'back it up with export-db.mjs, then re-run with --force.'
  );
  // exitCode, not process.exit(): exiting while the Supabase client still
  // holds open handles can crash Node on Windows (libuv assertion, exit 127).
  process.exitCode = 1;
} else {
  await seed();
}

async function seed() {

const row = {
  slug,
  title: playbook.title,
  description: playbook.description ?? '',
  overview: playbook.overview,
  roles: playbook.roles,
  sequence: playbook.sequence,
  source_doc: sourceDoc,
  updated_at: new Date().toISOString(),
  updated_by: null,
};

const { data: saved, error: upErr } = await db
  .from('playbooks')
  .upsert(row, { onConflict: 'slug' })
  .select('id')
  .single();
if (upErr) throw upErr;
const playbookId = saved.id;

const jobRows = playbook.jobs.map((j) => ({
  playbook_id: playbookId,
  job_code: j.job_code,
  name: j.name,
  stages: j.stages ?? [],
  work_area: j.work_area ?? '',
  job_type: j.job_type ?? '',
  position: j.position ?? null,
  body: j.body ?? {},
  updated_at: row.updated_at,
}));
const { error: jobsErr } = await db.from('playbook_jobs').upsert(jobRows, { onConflict: 'playbook_id,job_code' });
if (jobsErr) throw jobsErr;

if (flag('prune')) {
  const keep = new Set(jobRows.map((j) => j.job_code));
  const { data: inDb, error } = await db.from('playbook_jobs').select('job_code').eq('playbook_id', playbookId);
  if (error) throw error;
  const extra = inDb.map((r) => r.job_code).filter((c) => !keep.has(c));
  if (extra.length) {
    const { error: delErr } = await db
      .from('playbook_jobs')
      .delete()
      .eq('playbook_id', playbookId)
      .in('job_code', extra);
    if (delErr) throw delErr;
    console.log(`Pruned ${extra.length} job(s): ${extra.join(', ')}`);
  }
}

const { count } = await db
  .from('playbook_jobs')
  .select('*', { count: 'exact', head: true })
  .eq('playbook_id', playbookId);
console.log(
  `${existing ? 'Re-seeded' : 'Seeded'} "${slug}" (${playbookId}): ${count} jobs, ` +
    `${playbook.roles.length} roles, ${playbook.sequence.phases.length} phases, ${playbook.sequence.rules.length} rules.`
);
}
