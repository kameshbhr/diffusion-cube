'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { stageKey, tagFor } from '@/lib/companion-v2/jobs';
import { JOB_STATES, type JobRow, type JobState, type JobStateRow } from '@/lib/companion-v2/types';
import { showToast } from '@/lib/toast';
import AssetLink, { type AssetLinkData } from './AssetLink';
import { STATE_LABEL } from './StateMarker';

interface Props {
  slug: string;
  memberId: string;
  projectRole: string;
  job: JobRow;
  assets: AssetLinkData[];
  state: JobStateRow | null;
  /** "stage 3" -> the plain title of that step, for checklist rows. */
  stepTitles: Map<string, string>;
  onStateChange: (row: JobStateRow | null) => void;
  onClose: () => void;
}

const NS = 'Not stated';
const MATURITY: Record<string, string> = {
  thin: 'The evidence for this job is thin.',
  judg: 'Parts of this job are estimates, not documented from a project.',
  check: 'Some figures here still need checking.',
};
// Checklist items the PMU does itself (as in the playbook prototype).
const PMU_OWNER = /PxD|PMU|Nodal Officer['’]s team/i;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-pb-line-soft py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-pb-muted">{title}</h3>
      {children}
    </section>
  );
}

// Job detail, opened from the Jobs list (?open=CODE). Checklist tasks are
// guidance only, with no status. The person's own state and note are theirs
// to set; Cube never overrides them.
export default function JobSheet({ slug, memberId, projectRole, job, assets, state, stepTitles, onStateChange, onClose }: Props) {
  const b = job.body;
  const tag = tagFor(b, projectRole);
  const owners = b.owners ?? [];
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const [draftState, setDraftState] = useState<JobState | ''>(state?.state ?? '');
  const [draftNote, setDraftNote] = useState(state?.note ?? '');
  const [saving, setSaving] = useState(false);
  // A marker Cube set can be saved as-is to make it the person's own.
  const dirty =
    draftState !== (state?.state ?? '') || draftNote.trim() !== (state?.note ?? '') || state?.set_by === 'cube';

  // Once per open: focus Close, keep Tab inside the sheet, Esc closes, and
  // focus goes back to whatever opened the sheet.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    // Lock the page behind the sheet (it scrolls in the companion's own
    // container, not the body).
    const scroller = panelRef.current?.closest<HTMLElement>('[data-scroll-root]') ?? null;
    const prevOverflow = scroller?.style.overflowY ?? '';
    if (scroller) scroller.style.overflowY = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (scroller) scroller.style.overflowY = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    try {
      if (!draftState) {
        const { error } = await supabase.from('member_job_states').delete().eq('member_id', memberId).eq('job_code', job.job_code);
        if (error) throw error;
        onStateChange(null);
        setDraftNote('');
      } else {
        const row = {
          member_id: memberId,
          job_code: job.job_code,
          state: draftState,
          note: draftNote.trim().slice(0, 300),
          set_by: 'user' as const,
        };
        const { error } = await supabase.from('member_job_states').upsert(row, { onConflict: 'member_id,job_code' });
        if (error) throw error;
        onStateChange({ job_code: job.job_code, state: row.state, note: row.note, set_by: 'user' });
      }
      showToast('Saved.');
    } catch (err) {
      console.error('[jobs] could not save the state:', err);
      showToast("Couldn't save. Please try again.", 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="job-sheet-title">
      <div className="absolute inset-0 bg-pb-ink/30" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="relative flex h-full w-full max-w-xl animate-fade-in flex-col bg-pb-surface shadow-[0_10px_40px_rgba(20,30,45,0.18)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-pb-line px-5 py-4">
          <div>
            <h2 id="job-sheet-title" className="font-serif text-lg font-bold leading-snug text-pb-ink">
              {job.name}
            </h2>
            {tag && (
              <p className="mt-1 text-xs text-pb-muted">
                <span
                  className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    tag === 'Owns' ? 'bg-pb-accent text-white' : 'bg-pb-accent-soft text-pb-accent'
                  }`}
                >
                  {tag}
                </span>
                {tag === 'Owns' ? `The ${projectRole} owns this job` : `The ${projectRole} tracks this job`}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-pb-muted transition hover:bg-pb-bg hover:text-pb-ink"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 text-[15px] leading-relaxed text-pb-ink">
          <Section title="What it achieves">
            <p>{b.intended_result || NS}</p>
          </Section>
          <Section title="Why it matters">
            <p className={b.why_it_matters && b.why_it_matters !== NS ? '' : 'italic text-pb-muted'}>{b.why_it_matters || NS}</p>
          </Section>
          <Section title="When">
            <p>{b.when || NS}</p>
          </Section>
          {!!b.how_summary?.length && (
            <Section title="How, in short">
              <ul className="list-disc space-y-1 pl-5">
                {b.how_summary.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Who owns and who tracks">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-pb-muted">Who owns</dt>
              <dd>
                {owners.length ? (
                  owners.map((o, i) => (
                    <span key={o}>
                      {i > 0 && ', '}
                      {o === projectRole ? <strong className="font-semibold">{o}</strong> : o}
                    </span>
                  ))
                ) : (
                  <span className="italic text-pb-muted">No owner is named in the playbook.</span>
                )}
              </dd>
              <dt className="text-pb-muted">Who tracks</dt>
              <dd>{(b.tracked_by ?? []).join(', ') || NS}</dd>
            </dl>
            {b.owner_note && b.owner_note !== NS && <p className="mt-2 text-sm text-pb-muted">{b.owner_note}</p>}
          </Section>

          {!!b.tasks?.length && (
            <Section title="Checklist">
              <p className="mb-2 text-xs text-pb-muted">From the district checklist. A guide to what this job involves, not a to-do list.</p>
              <ul className="space-y-2.5">
                {b.tasks.map((t, i) => {
                  const mine = PMU_OWNER.test(t.owner) && projectRole === 'PMU';
                  return (
                    <li key={i} className={`rounded-lg px-3 py-2 text-sm ${mine ? 'bg-pb-accent-soft' : 'bg-pb-bg'}`}>
                      <p>{t.text}</p>
                      <p className="mt-1 text-xs text-pb-muted">
                        {[t.stage && (stepTitles.get(stageKey(t.stage)) ?? t.stage), t.timing]
                          .filter(Boolean)
                          .join(' · ') || 'Timing not stated'}
                        {' · '}
                        {mine ? <strong className="font-semibold text-pb-accent">{t.owner || NS}</strong> : t.owner || NS}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {b.roles && (
            <Section title="Who is involved">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {(['owns', 'does', 'reviews', 'enables'] as const).map((k) => {
                  const v = b.roles?.[k] || NS;
                  return (
                    <div key={k} className="contents">
                      <dt className="capitalize text-pb-muted">{k}</dt>
                      <dd className={v === NS ? 'italic text-pb-muted' : ''}>{v}</dd>
                    </div>
                  );
                })}
              </dl>
            </Section>
          )}

          {!!b.gaps?.length && (
            <Section title="What the playbook doesn't cover yet">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {b.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </Section>
          )}

          {b.maturity && (b.maturity.flag || b.maturity.note) && (
            <Section title="How well supported">
              <p className="text-sm">
                {b.maturity.flag ? `${MATURITY[b.maturity.flag] ?? ''} ` : ''}
                {b.maturity.note}
              </p>
            </Section>
          )}

          {assets.length > 0 && (
            <Section title="Resources">
              <ul className="space-y-2">
                {assets.map((a) => (
                  <li key={a.id} className="text-sm">
                    <AssetLink asset={a} className="font-medium text-pb-accent underline-offset-2 hover:underline" />
                    {a.description && <p className="mt-0.5 text-xs text-pb-muted">{a.description}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Where you are with this">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Your state for this job">
              {[{ v: '' as const, label: 'No marker' }, ...JOB_STATES.map((s) => ({ v: s, label: STATE_LABEL[s] }))].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={draftState === o.v}
                  onClick={() => setDraftState(o.v)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    draftState === o.v
                      ? 'border-pb-accent bg-pb-accent-soft text-pb-accent'
                      : 'border-pb-line text-pb-muted hover:text-pb-ink'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {draftState && (
              <input
                type="text"
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                maxLength={300}
                placeholder="A short note, in your words (optional)"
                aria-label="Note"
                className="mt-3 w-full rounded-lg border border-pb-line bg-pb-surface px-3 py-2 text-sm outline-none focus:border-pb-accent"
              />
            )}
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-lg bg-pb-accent px-3.5 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {state && (
                <span className="text-xs text-pb-muted">
                  {state.set_by === 'user'
                    ? 'Set by you. Cube won’t change it.'
                    : 'From your conversation with Cube. Save to make it yours, and Cube won’t change it.'}
                </span>
              )}
            </div>
          </Section>
        </div>

        <div className="border-t border-pb-line px-5 py-3">
          <Link
            href={`/companion/${slug}?job=${encodeURIComponent(job.job_code)}`}
            className="block rounded-lg bg-pb-accent px-4 py-2.5 text-center text-sm font-medium text-white transition hover:opacity-90"
          >
            Ask Cube about this job
          </Link>
        </div>
      </div>
    </div>
  );
}
