// Exports a playbook from the database through the shared serializer, so the
// output can be compared byte-for-byte with the checked-in seed files, or kept
// as a backup before a forced re-seed.
//
//   node --env-file=.env.local scripts/cube2/export-db.mjs --slug <slug> [--out <dir>]
//
// Writes <dir>/<slug>.json and <dir>/<slug>.source.md (default dir: current
// directory). Uses the service-role key, read-only.
//
// Round-trip check right after seeding (expect no output):
//   git diff --no-index content/playbooks/low-resource-language.json <dir>/low-resource-language.json
//   git diff --no-index content/playbooks/low-resource-language.source.md <dir>/low-resource-language.source.md

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { serializePlaybook } from '../../lib/companion-v2/playbook-json.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const slug = arg('slug');
const outDir = arg('out') ?? '.';
if (!slug) {
  console.error('Usage: export-db.mjs --slug <slug> [--out <dir>]');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file).');
  process.exit(2);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: pb, error } = await db
  .from('playbooks')
  .select('id, slug, title, description, overview, roles, sequence, source_doc')
  .eq('slug', slug)
  .maybeSingle();
if (error) throw error;
if (!pb) {
  console.error(`No playbook with slug "${slug}".`);
  // exitCode, not process.exit(): exiting while the Supabase client still
  // holds open handles crashes Node on Windows (libuv assertion, exit 127).
  process.exitCode = 1;
} else {
  await exportPlaybook(pb);
}

async function exportPlaybook(pb) {
const { data: jobs, error: jobsErr } = await db
  .from('playbook_jobs')
  .select('job_code, name, position, stages, work_area, job_type, body')
  .eq('playbook_id', pb.id);
if (jobsErr) throw jobsErr;

const json = serializePlaybook({
  slug: pb.slug,
  title: pb.title,
  description: pb.description,
  overview: pb.overview,
  roles: pb.roles,
  sequence: pb.sequence,
  jobs,
});

mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, `${slug}.json`);
const mdPath = join(outDir, `${slug}.source.md`);
writeFileSync(jsonPath, json);
writeFileSync(mdPath, pb.source_doc);
console.log(`Wrote ${jsonPath} (${jobs.length} jobs) and ${mdPath}.`);
}
