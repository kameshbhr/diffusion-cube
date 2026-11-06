// Builds the companion-v2 system prompt as content blocks, stable prefix
// first so prompt caching can reuse it across turns and users:
//
//   1. instructions (content/companion-v2.md)          ┐ cached together:
//   2. the structured playbook, rendered as markdown   │ cache_control on 3
//   3. the source document                             ┘
//   4. resources (asset titles, descriptions, jobs)      not cached: changes often
//   5. this user's facts (role, context, job states)     not cached: per user/turn
//
// Rendering is deterministic (fixed order, no timestamps or ids that vary per
// request) so the cached prefix is byte-identical until a contributor edits
// the playbook or the source document.

import { readFile } from 'fs/promises';
import path from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  AssetRow,
  CompanionContext,
  JobRow,
  JobStateRow,
  OverviewEntry,
  PlaybookRow,
} from './types';
import { CONTEXT_KEYS } from './types';
import { tagFor } from './jobs';

const NS = 'Not stated';
const ADOPTER_PROMPT_FILE = path.join(process.cwd(), 'content', 'companion-v2.md');

export async function loadAdopterInstructions(): Promise<string> {
  return (await readFile(ADOPTER_PROMPT_FILE, 'utf-8')).trim();
}

/** Hidden first turn, never stored or shown: lets Cube open the conversation. */
export function kickoffMessage(hasContext: boolean): string {
  return hasContext
    ? '[The person has started a new conversation. You already know their situation from "What we know so far". Greet them in one short sentence and ask what they would like to work on now. In the block, suggest two or three questions about their likely next steps, from what we know and their job states.]'
    : '[The person has just opened the companion for the first time. Greet them in one or two short sentences, say in one line what you can help with, then ask your first question about their situation.]';
}

const MATURITY_LABEL: Record<string, string> = {
  thin: 'Thin evidence',
  judg: 'Estimate',
  check: 'Needs check',
};

function entryLines(entries: OverviewEntry[] | undefined): string[] {
  const out: string[] = [];
  for (const e of entries ?? []) {
    if (e.items?.length) {
      out.push(`- ${e.label}:`);
      for (const item of e.items) out.push(`  - ${item}`);
      if (e.note) out.push(`  (${e.note})`);
    } else {
      out.push(`- ${e.label}: ${e.value ?? ''}`);
    }
  }
  return out;
}

function list(items: string[] | undefined): string[] {
  return (items ?? []).map((x) => `- ${x}`);
}

/** The structured playbook as compact markdown. No framework placements. */
export function renderPlaybook(playbook: PlaybookRow, jobs: JobRow[]): string {
  const o = playbook.overview ?? {};
  const phases = playbook.sequence?.phases ?? [];
  const rules = playbook.sequence?.rules ?? [];
  const nameByCode = new Map(jobs.map((j) => [j.job_code, j.name]));
  const L: string[] = [];

  L.push(`# The playbook: ${playbook.title}`, '', playbook.description, '');

  L.push('## Overview', '', '### Purpose', ...entryLines(o.purpose), '');
  L.push('### Where this playbook applies', ...entryLines(o.context), '');
  L.push('### Outcomes it can enable', ...list(o.outcomes), '');
  L.push('### Key insights across the jobs', ...list(o.insights), '');
  L.push('### How well supported it is', ...entryLines(o.maturity_flags), '');
  L.push('### Based on', ...entryLines(o.based_on), '');
  L.push('### Credits', ...entryLines(o.credits), '');

  L.push('## Roles', '');
  for (const r of playbook.roles ?? []) {
    let line = `- **${r.name}** (${r.group}): ${r.description}`;
    if (r.example) line += ` ${r.example}`;
    if (r.see) line += ` ${r.see}`;
    L.push(line);
  }
  L.push('');

  L.push('## The sequence, in order', '');
  phases.forEach((p, i) => {
    L.push(`### ${i + 1}. ${p.name} (${p.when})`, p.text);
    const named = p.jobs.map((c) => `${nameByCode.get(c) ?? c} [${c}]`);
    if (named.length) L.push(`Jobs in this step: ${named.join('; ')}`);
    L.push('');
  });

  if (playbook.sequence?.note) L.push('### About these steps and timings', playbook.sequence.note, '');

  if (playbook.sequence?.milestones?.length) {
    L.push('## Milestones (targets)', ...entryLines(playbook.sequence.milestones));
    if (playbook.sequence.milestones_note) L.push(playbook.sequence.milestones_note);
    L.push('');
  }

  L.push('## Hard rules', '');
  for (const r of rules) L.push(`- ${r.rule}${r.why ? ` Why: ${r.why}` : ''}`);
  L.push('');

  // Owns / Tracks at a glance for each project role that tracks jobs (PMU for
  // now). Derived from the owners and tracked_by lists, so the model can answer
  // "what do I own and what do I only track" by lookup instead of recall.
  const trackingRoles = [...new Set(jobs.flatMap((j) => j.body?.tracked_by ?? []))].sort();
  for (const role of trackingRoles) {
    const owns = jobs.filter((j) => tagFor(j.body ?? {}, role) === 'Owns');
    const tracks = jobs.filter((j) => tagFor(j.body ?? {}, role) === 'Tracks');
    const line = (j: JobRow) => {
      const others = (j.body?.owners ?? []).filter((o) => o !== role);
      return `- ${j.name} [${j.job_code}]${others.length ? ` (with ${others.join(', ')})` : ''}`;
    };
    const trackLine = (j: JobRow) => {
      const owners = j.body?.owners ?? [];
      return `- ${j.name} [${j.job_code}]: owned by ${owners.length ? owners.join(', ') : 'nobody named in the playbook'}`;
    };
    L.push(
      `## What the ${role} owns and what it only tracks (complete lists, in sequence order)`,
      '',
      `The ${role} owns ${owns.length} jobs, usually together with others:`,
      ...owns.map(line),
      '',
      `The ${role} tracks the other ${tracks.length} jobs, which someone else owns:`,
      ...tracks.map(trackLine),
      ''
    );
  }

  L.push(
    '## The jobs, in sequence order',
    '',
    'Each job has a code in square brackets, for the response block only. Never show codes to the person.',
    ''
  );
  for (const j of jobs) {
    const b = j.body ?? {};
    const owners = b.owners ?? [];
    const pmu = tagFor(b, 'PMU');
    L.push(`### ${j.name} [${j.job_code}]`);
    L.push(`- When: ${b.when || NS}`);
    L.push(`- Who owns: ${owners.length ? owners.join(', ') : 'The playbook names no owner.'}`);
    L.push(`- Who tracks: ${(b.tracked_by ?? []).join(', ') || NS}`);
    if (pmu) L.push(`- PMU: ${pmu === 'Owns' ? 'owns this job' : 'tracks this job'}. ${b.owner_note ?? ''}`.trimEnd());
    L.push(`- Intended result: ${b.intended_result || NS}`);
    L.push(`- Why it matters: ${b.why_it_matters || NS}`);
    if (b.how_summary?.length) L.push('- How, in short:', ...b.how_summary.map((h) => `  - ${h}`));
    if (b.tasks?.length) {
      L.push('- Checklist tasks (guidance, from the district checklist):');
      for (const t of b.tasks) {
        const when = [t.stage, t.timing].filter(Boolean).join(', ') || 'timing not stated';
        L.push(`  - ${when}; owner ${t.owner || NS}: ${t.text}`);
      }
    }
    const r = b.roles;
    if (r) {
      L.push(
        `- Roles as written: owns ${r.owns || NS}; does ${r.does || NS}; reviews ${r.reviews || NS}; enables ${r.enables || NS}`
      );
    }
    if (b.gaps?.length) L.push('- Gaps:', ...b.gaps.map((g) => `  - ${g}`));
    if (b.maturity && (b.maturity.flag || b.maturity.note)) {
      const label = b.maturity.flag ? MATURITY_LABEL[b.maturity.flag] ?? b.maturity.flag : 'Note';
      L.push(`- How well supported: ${label}. ${b.maturity.note}`.trimEnd());
    }
    if (b.recurs) L.push('- Recurs in each build round.');
    L.push('');
  }

  return L.join('\n').trim();
}

export function renderAssets(assets: AssetRow[], jobs: JobRow[]): string {
  const nameByCode = new Map(jobs.map((j) => [j.job_code, j.name]));
  if (!assets.length) return '# Resources\n\nThere are no resources yet.';
  const L = ['# Resources', '', 'Offer one only when it fits the job being discussed. Use the id only in the response block.', ''];
  for (const a of [...assets].sort((x, y) => x.title.localeCompare(y.title))) {
    const tags = a.job_codes.map((c) => `${nameByCode.get(c) ?? c} [${c}]`).join('; ');
    L.push(`- id ${a.id}: **${a.title}** (${a.kind === 'link' ? 'link' : 'file'}). ${a.description || 'No description.'}`);
    L.push(`  Jobs: ${tags || 'general, not tied to a job'}`);
  }
  return L.join('\n');
}

const STATE_LABEL: Record<string, string> = {
  discussed: 'discussed',
  in_progress: 'in progress',
  done: 'done',
  skipped: 'skipped',
};

export function renderUserFacts(opts: {
  projectRole: string;
  context: CompanionContext;
  jobStates: JobStateRow[];
  jobs: JobRow[];
  focusJob?: string | null;
}): string {
  const nameByCode = new Map(opts.jobs.map((j) => [j.job_code, j.name]));
  const L = ['# This person', '', `- Their role in the project: ${opts.projectRole}`];

  const known = CONTEXT_KEYS.filter((k) => opts.context[k]);
  L.push('', '## What we know so far');
  if (!known.length) L.push('Nothing recorded yet. If you have not yet asked about their situation in this conversation, get to know it first.');
  const labels: Record<string, string> = {
    stage: 'Where they are',
    location: 'Where the work is',
    done: 'Already done',
    role_note: 'Their part',
  };
  for (const k of known) L.push(`- ${labels[k]}: ${opts.context[k]}`);

  L.push('', '## Job states they have told us about');
  if (!opts.jobStates.length) L.push('None yet.');
  for (const s of opts.jobStates) {
    const who = s.set_by === 'user' ? ' (set by the person themself; do not change it)' : '';
    L.push(`- ${nameByCode.get(s.job_code) ?? s.job_code} [${s.job_code}]: ${STATE_LABEL[s.state]}${s.note ? `, "${s.note}"` : ''}${who}`);
  }

  if (opts.focusJob && nameByCode.has(opts.focusJob)) {
    L.push(
      '',
      `## This message`,
      `They opened the chat from the job "${nameByCode.get(opts.focusJob)}" [${opts.focusJob}] and want to talk about it.`
    );
  }
  return L.join('\n');
}

const CONTRIBUTOR_PROMPT_FILE = path.join(process.cwd(), 'content', 'companion-v2-contributor.md');

export async function loadContributorInstructions(): Promise<string> {
  return (await readFile(CONTRIBUTOR_PROMPT_FILE, 'utf-8')).trim();
}

/**
 * The contributor's system prompt: instructions, the playbook as its exact
 * canonical JSON (the field names and list positions the patch ops use), and
 * the source document. All three are cached together; a saved edit changes
 * the text, so the cache refreshes itself.
 */
export function buildContributorSystem(parts: {
  instructions: string;
  playbookJson: string;
  sourceDoc: string;
}): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: parts.instructions },
    { type: 'text', text: `# The playbook (current, exact JSON)\n\n${parts.playbookJson}` },
    {
      type: 'text',
      text: `# The source document (current)\n\n${parts.sourceDoc.trim() || '(empty)'}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

export function buildSystemBlocks(parts: {
  instructions: string;
  playbookText: string;
  sourceDoc: string;
  assetsText: string;
  userText: string;
}): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: parts.instructions },
    { type: 'text', text: parts.playbookText },
    {
      type: 'text',
      text: `# The source document\n\n${parts.sourceDoc.trim() || '(empty)'}`,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: parts.assetsText },
    { type: 'text', text: parts.userText },
  ];
}
