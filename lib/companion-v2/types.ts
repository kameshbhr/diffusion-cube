// Shapes of the Cube 2.0 playbook data as stored in Supabase (migrations
// 0034-0036) and produced by lib/companion-v2/playbook-json.mjs.

export interface OverviewEntry {
  label: string;
  value?: string;
  items?: string[];
  note?: string;
}

export interface PlaybookOverview {
  purpose?: OverviewEntry[];
  context?: OverviewEntry[];
  based_on?: OverviewEntry[];
  outcomes?: string[];
  insights?: string[];
  maturity_flags?: OverviewEntry[];
  credits?: OverviewEntry[];
}

export interface PlaybookRole {
  name: string;
  group: string;
  description: string;
  example?: string;
  see?: string;
  owner_keys?: string[];
  playbook_names?: string[];
}

export interface PlaybookPhase {
  name: string;
  when: string;
  text: string;
  jobs: string[];
}

export interface PlaybookRule {
  rule: string;
  why: string;
}

export interface PlaybookFramework {
  not_stated: string;
  stages: { name: string; info: string }[];
  areas: { name: string; info: string }[];
  types: string[];
}

export interface PlaybookSequence {
  phases?: PlaybookPhase[];
  rules?: PlaybookRule[];
  /** Target milestones (3, 6, 12 months): targets, not reported results. */
  milestones?: OverviewEntry[];
  milestones_note?: string;
  /** A note about where the sequence and its timings come from. */
  note?: string;
  framework?: PlaybookFramework; // contributor jobs map only; never sent to the model
}

export interface PlaybookRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  overview: PlaybookOverview;
  roles: PlaybookRole[];
  sequence: PlaybookSequence;
  source_doc: string;
  updated_at: string;
}

export interface JobTask {
  stage: string;
  timing: string;
  owner: string;
  text: string;
}

export interface JobBody {
  intended_result?: string;
  why_it_matters?: string;
  when?: string;
  how_summary?: string[];
  tasks?: JobTask[];
  roles?: { owns?: string; does?: string; reviews?: string; enables?: string };
  owners?: string[];
  tracked_by?: string[];
  owner_note?: string;
  gaps?: string[];
  maturity?: { flag: 'thin' | 'judg' | 'check' | null; note: string } | null;
  recurs?: boolean;
}

export interface JobRow {
  job_code: string;
  name: string;
  position: number | null;
  stages: string[];
  work_area: string;
  job_type: string;
  body: JobBody;
}

export interface AssetRow {
  id: string;
  title: string;
  kind: 'file' | 'link';
  url: string | null;
  storage_path: string | null;
  description: string;
  job_codes: string[];
}

export type JobState = 'discussed' | 'in_progress' | 'done' | 'skipped';
export const JOB_STATES: readonly JobState[] = ['discussed', 'in_progress', 'done', 'skipped'];

export interface JobStateRow {
  job_code: string;
  state: JobState;
  note: string;
  set_by: 'cube' | 'user';
}

/** The only context keys stored (mirrors companion_context_keys() in 0036). */
export const CONTEXT_KEYS = ['stage', 'location', 'done', 'role_note'] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];
export type CompanionContext = Partial<Record<ContextKey, string>>;

/** The validated <ui_action> block of one assistant reply. */
export interface UiAction {
  focusJobs: string[];
  openJob: string | null;
  showAssets: string[];
  context: CompanionContext;
  jobUpdates: { job: string; state: JobState; note: string }[];
}

/** What the client sends to /api/chat for mode "companion-v2". */
export interface CompanionV2Request {
  mode: 'companion-v2';
  role: 'adopter' | 'contributor';
  playbookId: string;
  conversationId?: string;
  /** The new user message; the server reads the history from the database. */
  message?: string;
  focusJob?: string;
  kickoff?: boolean;
}
