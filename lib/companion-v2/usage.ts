// SERVER-ONLY. Daily caps on model calls per person (bump_companion_usage,
// migration 0036). COMPANION_DAILY_MESSAGE_CAP covers readers' chat and the
// notes they save from it (structuring is a model call);
// COMPANION_DAILY_CONTRIBUTOR_CAP covers curators' playbook chat.

export function dailyCap(role: 'adopter' | 'contributor'): number {
  const raw = role === 'adopter' ? process.env.COMPANION_DAILY_MESSAGE_CAP : process.env.COMPANION_DAILY_CONTRIBUTOR_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : role === 'adopter' ? 60 : 40;
}
