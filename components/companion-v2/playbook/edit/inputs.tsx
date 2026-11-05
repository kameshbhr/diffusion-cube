'use client';

// Small form inputs for the playbook edit forms.

import { useId, useState } from 'react';
import type { JobTask, OverviewEntry } from '@/lib/companion-v2/types';

export const inputCls =
  'w-full rounded-md border border-pb-line bg-pb-surface px-3 py-2 text-[14px] text-pb-ink outline-none focus:border-pb-accent';
const smallBtn = 'rounded-md border border-pb-line bg-pb-surface px-2 py-1 text-xs text-pb-muted hover:text-pb-ink disabled:opacity-40';

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] font-medium text-pb-ink">
        {label}
      </label>
      {hint && <p className="text-xs text-pb-muted">{hint}</p>}
      {children(id)}
    </div>
  );
}

export function TextField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label} hint={hint}>{(id) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />}</Field>;
}

export function TextArea({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className={inputCls} />}
    </Field>
  );
}

/** A list of text, one item per line. */
export function LinesField({ label, hint, value, onChange, rows = 4 }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  return (
    <Field label={label} hint={hint ?? 'One item per line.'}>
      {(id) => (
        <textarea
          id={id}
          value={value.join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n'))}
          rows={Math.max(rows, value.length + 1)}
          className={inputCls}
        />
      )}
    </Field>
  );
}

/**
 * A short list of names, comma separated. The box keeps exactly what was
 * typed (no reformatting while typing); the list is split on commas.
 */
export function NamesField({ label, hint, value, onChange }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void }) {
  const [raw, setRaw] = useState(() => value.join(', '));
  return (
    <Field label={label} hint={hint ?? 'Separate names with commas.'}>
      {(id) => (
        <input
          id={id}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            onChange(e.target.value.split(','));
          }}
          className={inputCls}
        />
      )}
    </Field>
  );
}

/** Clean a lines/names list for saving: trim, drop empties. */
export const cleanList = (v: string[]) => v.map((x) => x.trim()).filter(Boolean);

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function RowControls({ index, count, onMove, onRemove }: { index: number; count: number; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="flex gap-1">
      <button type="button" className={smallBtn} onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
        ↑
      </button>
      <button type="button" className={smallBtn} onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down">
        ↓
      </button>
      <button type="button" className={smallBtn} onClick={onRemove} aria-label="Remove">
        Remove
      </button>
    </div>
  );
}

/** Checklist items: stage, timing, owner and text per row. */
export function TasksEditor({ value, onChange }: { value: JobTask[]; onChange: (v: JobTask[]) => void }) {
  const set = (i: number, patch: Partial<JobTask>) => onChange(value.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-pb-ink">Checklist items</p>
      {value.map((t, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-pb-line-soft bg-pb-bg p-2.5">
          <div className="grid gap-1.5 sm:grid-cols-3">
            <input aria-label={`Item ${i + 1} stage`} placeholder="Stage (e.g. Stage 3)" value={t.stage} onChange={(e) => set(i, { stage: e.target.value })} className={inputCls} />
            <input aria-label={`Item ${i + 1} timing`} placeholder="Timing (e.g. Weeks 4–5)" value={t.timing} onChange={(e) => set(i, { timing: e.target.value })} className={inputCls} />
            <input aria-label={`Item ${i + 1} owner`} placeholder="Owner" value={t.owner} onChange={(e) => set(i, { owner: e.target.value })} className={inputCls} />
          </div>
          <textarea aria-label={`Item ${i + 1} text`} placeholder="What to do" value={t.text} onChange={(e) => set(i, { text: e.target.value })} rows={2} className={inputCls} />
          <RowControls index={i} count={value.length} onMove={(d) => onChange(move(value, i, d))} onRemove={() => onChange(value.filter((_, k) => k !== i))} />
        </div>
      ))}
      <button type="button" className={smallBtn} onClick={() => onChange([...value, { stage: '', timing: '', owner: '', text: '' }])}>
        + Add a checklist item
      </button>
    </div>
  );
}

/** Labelled entries (Context, Purpose, Credits…): text, or a list (one per line). */
export function EntriesEditor({ label, value, onChange }: { label: string; value: OverviewEntry[]; onChange: (v: OverviewEntry[]) => void }) {
  const set = (i: number, e: OverviewEntry) => onChange(value.map((x, k) => (k === i ? e : x)));
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-pb-ink">{label}</p>
      {value.map((e, i) => {
        const isList = Array.isArray(e.items);
        return (
          <div key={i} className="space-y-1.5 rounded-md border border-pb-line-soft bg-pb-bg p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label={`Entry ${i + 1} label`} placeholder="Label" value={e.label} onChange={(ev) => set(i, { ...e, label: ev.target.value })} className={`${inputCls} flex-1`} />
              <label className="flex items-center gap-1.5 text-xs text-pb-muted">
                <input
                  type="checkbox"
                  checked={isList}
                  onChange={(ev) =>
                    set(
                      i,
                      ev.target.checked
                        ? { label: e.label, items: (e.value ?? '').split('\n').filter(Boolean), ...(e.note ? { note: e.note } : {}) }
                        : { label: e.label, value: (e.items ?? []).join(' ') }
                    )
                  }
                />
                A list
              </label>
            </div>
            {isList ? (
              <>
                <textarea
                  aria-label={`Entry ${i + 1} items`}
                  placeholder="One item per line"
                  value={(e.items ?? []).join('\n')}
                  onChange={(ev) => set(i, { ...e, items: ev.target.value.split('\n') })}
                  rows={Math.max(3, (e.items ?? []).length + 1)}
                  className={inputCls}
                />
                <input
                  aria-label={`Entry ${i + 1} note`}
                  placeholder="A note under the list (optional)"
                  value={e.note ?? ''}
                  onChange={(ev) => set(i, { ...e, note: ev.target.value })}
                  className={inputCls}
                />
              </>
            ) : (
              <textarea aria-label={`Entry ${i + 1} text`} value={e.value ?? ''} onChange={(ev) => set(i, { ...e, value: ev.target.value })} rows={2} className={inputCls} />
            )}
            <RowControls index={i} count={value.length} onMove={(d) => onChange(move(value, i, d))} onRemove={() => onChange(value.filter((_, k) => k !== i))} />
          </div>
        );
      })}
      <button type="button" className={smallBtn} onClick={() => onChange([...value, { label: '', value: '' }])}>
        + Add an entry
      </button>
    </div>
  );
}

/** Entries cleaned for saving: trimmed, empty list items dropped, empty notes removed. */
export function cleanEntries(v: OverviewEntry[]): OverviewEntry[] {
  return v
    .filter((e) => e.label.trim())
    .map((e) =>
      Array.isArray(e.items)
        ? { label: e.label.trim(), items: cleanList(e.items), ...(e.note?.trim() ? { note: e.note.trim() } : {}) }
        : { label: e.label.trim(), value: (e.value ?? '').trim() }
    );
}
