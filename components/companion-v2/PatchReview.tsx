'use client';

import { useMemo, useState } from 'react';
import { diffLines, diffWords, type Change } from 'diff';
import { createClient } from '@/lib/supabase/client';
import { applyOps, checkGuards, checkSize, checkWarnings, isEmptySave, toSave, type OpResult, type PatchOp, type Snapshot } from '@/lib/companion-v2/patch';
import { beforeAfter, editableKey, opLabel } from '@/lib/companion-v2/patch-display';
import { savePlaybook } from '@/lib/companion-v2/save';
import type { Contradiction } from '@/lib/companion-v2/playbook-patch';

export type { Contradiction };

interface Props {
  playbookId: string;
  /** updated_at exactly as loaded; save_playbook rejects the save if it moved. */
  baseUpdatedAt: string;
  base: Snapshot;
  ops: PatchOp[];
  contradictions?: Contradiction[];
  /** Shown above the list, e.g. Cube's summary of the proposal. */
  summary?: string;
  /** Called after a successful save with the new updated_at and the ops that were applied. */
  onApplied: (newUpdatedAt: string, applied: PatchOp[]) => void;
  onDiscard: () => void;
  discardLabel?: string;
  /** Apply waits (e.g. while the page reloads after another save). */
  disabled?: boolean;
  /** Replaces the full-page reload after a stale save (e.g. a refresh that keeps the chat). */
  onReload?: () => void;
  /** Indexes of ops that another part of a large upload also changes. */
  overlaps?: number[];
}

const CONTEXT_LINES = 3;

/** Word diff for one-line text, line diff (unchanged runs folded) otherwise. */
function DiffText({ before, after }: { before: string; after: string }) {
  const oneLine = !before.includes('\n') && !after.includes('\n') && before.length + after.length < 2400;
  // Line diffs compare text ending in a newline, so an unchanged last line
  // isn't shown as removed and re-added when lines are appended after it.
  const nl = (s: string) => (s.endsWith('\n') ? s : `${s}\n`);
  const parts: Change[] = oneLine ? diffWords(before, after) : diffLines(nl(before), nl(after));
  if (oneLine) {
    return (
      <p className="whitespace-pre-wrap rounded-md bg-pb-bg px-3 py-2 text-sm leading-relaxed">
        {parts.map((p, i) =>
          p.added ? (
            <ins key={i} className="rounded-sm bg-pb-deliver/15 text-pb-deliver no-underline">
              {p.value}
            </ins>
          ) : p.removed ? (
            <del key={i} className="rounded-sm bg-pb-check-bg text-pb-check-ink">
              {p.value}
            </del>
          ) : (
            <span key={i}>{p.value}</span>
          )
        )}
      </p>
    );
  }
  return (
    <div className="max-h-[420px] overflow-auto rounded-md bg-pb-bg py-1.5 font-mono text-[12.5px] leading-relaxed">
      {parts.map((p, i) => {
        const lines = p.value.replace(/\n$/, '').split('\n');
        if (!p.added && !p.removed) {
          if (lines.length <= CONTEXT_LINES * 2 + 1) return lines.map((l, k) => <Line key={`${i}-${k}`} kind=" " text={l} />);
          return [
            ...(i > 0 ? lines.slice(0, CONTEXT_LINES).map((l, k) => <Line key={`${i}-a${k}`} kind=" " text={l} />) : []),
            <div key={`${i}-gap`} className="px-3 py-0.5 text-pb-muted">
              … {lines.length - (i > 0 ? CONTEXT_LINES : 0) - (i < parts.length - 1 ? CONTEXT_LINES : 0)} unchanged lines …
            </div>,
            ...(i < parts.length - 1 ? lines.slice(-CONTEXT_LINES).map((l, k) => <Line key={`${i}-b${k}`} kind=" " text={l} />) : []),
          ];
        }
        return lines.map((l, k) => <Line key={`${i}-${k}`} kind={p.added ? '+' : '-'} text={l} />);
      })}
    </div>
  );
}

function Line({ kind, text }: { kind: '+' | '-' | ' '; text: string }) {
  const cls =
    kind === '+' ? 'bg-pb-deliver/10 text-pb-deliver' : kind === '-' ? 'bg-pb-check-bg text-pb-check-ink' : 'text-pb-ink';
  return (
    <div className={`whitespace-pre-wrap px-3 ${cls}`}>
      <span aria-hidden className="mr-2 select-none opacity-60">
        {kind}
      </span>
      <span className="sr-only">{kind === '+' ? 'Added: ' : kind === '-' ? 'Removed: ' : ''}</span>
      {text || ' '}
    </div>
  );
}

function asEditable(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

// The diff and Apply screen: one card per change with an include checkbox,
// the before/after diff, an inline editor for the proposed value, and any
// error. Apply runs one save_playbook() call; nothing is saved otherwise.
export default function PatchReview({
  playbookId,
  baseUpdatedAt,
  base,
  ops,
  contradictions,
  summary,
  onApplied,
  onDiscard,
  discardLabel = 'Discard',
  disabled = false,
  overlaps = [],
  onReload,
}: Props) {
  const [include, setInclude] = useState<boolean[]>(() => ops.map(() => true));
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  // The ops as the contributor has adjusted them; a bad edit is reported per op.
  const effective = useMemo(
    () =>
      ops.map((op, i): { op: PatchOp; parseError?: string } => {
        const key = editableKey(op);
        if (!key || edits[i] === undefined) return { op };
        const original = (op as Record<string, unknown>)[key];
        if (typeof original === 'string') return { op: { ...op, [key]: edits[i] } as PatchOp };
        try {
          return { op: { ...op, [key]: JSON.parse(edits[i]) } as PatchOp };
        } catch {
          return { op, parseError: 'This edit isn’t valid. Check the brackets and quotes.' };
        }
      }),
    [ops, edits]
  );

  // One pass in order, as Apply will run them: each card's before/after is the
  // playbook just before and just after its op, after the earlier included
  // ops. An unticked op is previewed at its place but not carried forward.
  const preview = useMemo(() => {
    let s = base;
    const cards: { result: OpResult | null; before: Snapshot; after: Snapshot }[] = [];
    for (let i = 0; i < effective.length; i++) {
      const e = effective[i];
      const before = s;
      if (e.parseError) {
        cards.push({ result: null, before, after: before });
        continue;
      }
      const { next, results } = applyOps(s, [e.op]);
      if (include[i] && results[0].ok) s = next;
      cards.push({ result: include[i] ? results[0] : null, before, after: results[0].ok ? next : before });
    }
    const applied = effective.filter((e, i) => include[i] && !e.parseError && cards[i].result?.ok).map((e) => e.op);
    return {
      next: s,
      cards,
      perOp: cards.map((c) => c.result),
      applied,
      save: toSave(base, s),
      guards: [...checkGuards(s), ...checkSize(base, s)],
      warnings: checkWarnings(base, s),
    };
  }, [base, effective, include]);

  const applicable = preview.perOp.filter((r) => r?.ok).length;
  const blocked = preview.guards.length > 0 || isEmptySave(preview.save) || applicable === 0;

  async function apply() {
    setSaving(true);
    setSaveError(null);
    const outcome = await savePlaybook(createClient(), playbookId, baseUpdatedAt, preview.save);
    setSaving(false);
    if (outcome.ok) onApplied(outcome.updatedAt, preview.applied);
    else {
      setSaveError(outcome.message);
      setStale(outcome.kind === 'stale');
    }
  }

  return (
    <div className="space-y-4">
      {summary && <p className="text-[15px] leading-relaxed text-pb-ink">{summary}</p>}

      {!!contradictions?.length && (
        <div className="rounded-lg border border-pb-check-bg bg-pb-check-bg/50 px-4 py-3">
          <h3 className="mb-1.5 text-sm font-semibold text-pb-check-ink">Where the new material disagrees with the playbook</h3>
          <ul className="space-y-2 text-sm">
            {contradictions.map((c, i) => (
              <li key={i}>
                <b>{c.topic}.</b> The playbook says: {c.existing} The new material says: {c.incoming}
                {c.source ? <span className="text-pb-muted"> ({c.source})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-3">
        {ops.map((op, i) => {
          const eff = effective[i];
          const result = preview.perOp[i];
          const key = editableKey(op);
          const card = preview.cards[i];
          const { before, after } = beforeAfter(eff.op, card.before, card.after);
          const failed = (include[i] && result && !result.ok) || eff.parseError;
          return (
            <li
              key={i}
              className={`rounded-lg border bg-pb-surface px-4 py-3 ${failed ? 'border-pb-check-ink/40' : 'border-pb-line'} ${
                include[i] ? '' : 'opacity-60'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <label className="flex items-start gap-2.5 text-sm font-medium text-pb-ink">
                  <input
                    type="checkbox"
                    checked={include[i]}
                    onChange={(e) => setInclude((prev) => prev.map((v, k) => (k === i ? e.target.checked : v)))}
                    className="mt-0.5 h-4 w-4 accent-[var(--color-pb-accent)]"
                  />
                  <span>{opLabel(op, base)}</span>
                </label>
                {key && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editing === i) setEditing(null);
                      else {
                        setEditing(i);
                        setEdits((prev) => (prev[i] === undefined ? { ...prev, [i]: asEditable((op as Record<string, unknown>)[key]) } : prev));
                      }
                    }}
                    className="text-xs text-pb-accent underline-offset-2 hover:underline"
                  >
                    {editing === i ? 'Done editing' : 'Edit this change'}
                  </button>
                )}
              </div>

              <div className="mt-2">
                <DiffText before={before} after={after} />
              </div>

              {editing === i && key && (
                <textarea
                  value={edits[i] ?? ''}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [i]: e.target.value }))}
                  rows={Math.min(14, Math.max(3, (edits[i] ?? '').split('\n').length + 1))}
                  aria-label={`Edit: ${opLabel(op, base)}`}
                  className="mt-2 w-full rounded-md border border-pb-line bg-pb-surface px-3 py-2 font-mono text-[12.5px] outline-none focus:border-pb-accent"
                />
              )}

              {overlaps.includes(i) && (
                <p className="mt-2 rounded-md bg-pb-thin-bg px-3 py-1.5 text-xs text-pb-thin-ink">
                  Another part of the files also changes this. Changes apply in order, so a later one may replace this one.
                </p>
              )}
              {eff.parseError && <p className="mt-2 text-sm text-pb-check-ink">{eff.parseError}</p>}
              {include[i] && result && !result.ok && <p className="mt-2 text-sm text-pb-check-ink">{result.error}</p>}
            </li>
          );
        })}
      </ol>

      {preview.warnings.map((w) => (
        <p key={w} className="rounded-md bg-pb-thin-bg px-3 py-2 text-sm text-pb-thin-ink">
          {w}
        </p>
      ))}
      {preview.guards.map((g) => (
        <p key={g} role="alert" className="rounded-md bg-pb-check-bg px-3 py-2 text-sm text-pb-check-ink">
          {g}
        </p>
      ))}
      {saveError && (
        <div role="alert" className="rounded-md bg-pb-check-bg px-3 py-2 text-sm text-pb-check-ink">
          <p>{saveError}</p>
          {stale && (
            <button type="button" onClick={() => (onReload ? onReload() : window.location.reload())} className="mt-1.5 font-medium underline underline-offset-2">
              {onReload ? 'Load the latest playbook, then apply again' : 'Reload now (your unsaved changes here are lost)'}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-pb-line pt-3">
        <button
          type="button"
          onClick={apply}
          disabled={blocked || saving || disabled}
          className="rounded-lg bg-pb-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Applying…' : applicable === ops.length ? 'Apply' : `Apply ${applicable} of ${ops.length}`}
        </button>
        <button type="button" onClick={onDiscard} disabled={saving} className="text-sm text-pb-muted hover:text-pb-ink">
          {discardLabel}
        </button>
        <span className="text-xs text-pb-muted">Changes go live as soon as you apply them. There is no undo.</span>
      </div>
    </div>
  );
}
