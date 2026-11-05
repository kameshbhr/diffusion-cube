'use client';

import { useEffect, useRef } from 'react';
import type { JobRow } from '@/lib/companion-v2/types';
import { MATURITY_FLAG, NS, NoOwnerFlag, OwnersText, typeColor } from './shared';

// Checklist items PMU does itself (as in the prototype's isPmuOwner).
const PMU_OWNER = /PxD|PMU|Nodal Officer['’]s team/i;

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-[18px]">
      <h3 className="mb-1.5 font-serif text-[15px] font-bold">{title}</h3>
      {children}
    </div>
  );
}

// The prototype's job drawer, read-only. Edit controls come in Slice 4b.
export default function JobDrawer({ job, onClose }: { job: JobRow; onClose: () => void }) {
  const b = job.body;
  const owners = b.owners ?? [];
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Once per open: focus Close, trap Tab, Esc closes, lock the page behind,
  // return focus to whatever opened the drawer.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const scroller = panelRef.current?.closest<HTMLElement>('[data-scroll-root]') ?? null;
    const prev = scroller?.style.overflowY ?? '';
    if (scroller) scroller.style.overflowY = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current();
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (scroller) scroller.style.overflowY = prev;
      opener?.focus?.();
    };
  }, []);

  const stageTxt = job.stages.length > 1 ? `${job.stages[0]} to ${job.stages[job.stages.length - 1]}` : job.stages[0];
  const flag = b.maturity?.flag ? MATURITY_FLAG[b.maturity.flag] : null;
  const roles = b.roles ?? {};

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="pb-drawer-title">
      <div className="absolute inset-0 bg-[rgba(10,15,22,0.45)]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="relative flex h-full w-full max-w-[560px] animate-fade-in flex-col bg-pb-surface text-pb-ink shadow-[0_10px_40px_rgba(20,30,45,0.18)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-pb-line px-5 pb-3 pt-[18px]">
          <div>
            <div className="mb-1 text-[13px] text-pb-muted">
              {job.job_code} · {job.work_area}
            </div>
            <h2 id="pb-drawer-title" className="font-serif text-[21px] font-bold leading-snug">
              {job.name}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex-none rounded-md border border-pb-line bg-pb-bg px-2.5 py-1.5 text-sm"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-10 pt-4 text-[15px] leading-relaxed">
          <div className="mb-3.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pb-line px-2.5 py-1 text-[13px]">
              <span aria-hidden className="h-[9px] w-[9px] rounded-full" style={{ background: typeColor(job.job_type) }} />
              {job.job_type}
            </span>
            {stageTxt && <span className="rounded-full border border-pb-line px-2.5 py-1 text-[13px]">{stageTxt}</span>}
            {b.recurs && <span className="rounded-full border border-pb-line px-2.5 py-1 text-[13px]">↻ Recurs across rounds</span>}
            {!owners.length && <NoOwnerFlag />}
          </div>

          <Sec title="Intended result">
            <p>{b.intended_result || NS}</p>
          </Sec>
          <Sec title="Why it matters">
            <p className={!b.why_it_matters || b.why_it_matters === NS ? 'italic text-pb-muted' : ''}>{b.why_it_matters || NS}</p>
          </Sec>
          <Sec title="When">
            <p>{b.when || NS}</p>
          </Sec>
          <Sec title="How it’s done">
            <ul className="list-disc space-y-1.5 pl-[18px]">
              {(b.how_summary ?? []).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </Sec>

          {!!b.tasks?.length && (
            <Sec title="Checklist items">
              <p className="mb-1 text-[13px] text-pb-muted">From the DC meeting checklist, with the owner and timing given there.</p>
              <ul>
                {b.tasks.map((t, i) => (
                  <li key={i} className="border-t border-pb-line-soft py-2 first:border-t-0">
                    {PMU_OWNER.test(t.owner) && (
                      <span className="mr-1 inline-block rounded-full bg-pb-accent-soft px-[7px] py-px text-[11px] text-pb-accent">PMU</span>
                    )}
                    {t.text}
                    <small className="mt-0.5 block text-[12.5px] text-pb-muted">
                      {t.owner} · {[t.stage, t.timing].filter(Boolean).join(', ') || 'Timing not stated'}
                    </small>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          <Sec title="Who owns and who tracks">
            <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-pb-muted">Who owns</dt>
              <dd>
                <OwnersText owners={owners} />
              </dd>
              <dt className="text-pb-muted">Who tracks</dt>
              <dd>{(b.tracked_by ?? []).join(', ') || NS}</dd>
            </dl>
            <p className="mt-2 text-[13px] text-pb-muted">{b.owner_note || NS}</p>
          </Sec>

          <details className="mt-[18px]">
            <summary className="cursor-pointer text-[15px] font-semibold">Roles as written in the playbook</summary>
            <dl className="mt-2 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-sm">
              {(['owns', 'does', 'reviews', 'enables'] as const).map((k) => {
                const v = roles[k] || NS;
                return (
                  <div key={k} className="contents">
                    <dt className="capitalize text-pb-muted">{k}</dt>
                    <dd className={v === NS ? 'italic text-pb-muted' : ''}>{v}</dd>
                  </div>
                );
              })}
            </dl>
          </details>

          <Sec title="Gaps">
            <div className="mt-1.5 rounded-md bg-pb-thin-bg py-2.5 pl-4 pr-3.5">
              {b.gaps?.length ? (
                <ul className="list-disc space-y-1 pl-4">
                  {b.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              ) : (
                <p>None recorded.</p>
              )}
            </div>
          </Sec>

          {b.maturity && (flag || b.maturity.note) && (
            <Sec title="Maturity">
              <div className="rounded-md border border-pb-line-soft bg-pb-bg px-3.5 py-2.5 text-sm">
                {flag && (
                  <span className={`mr-1.5 inline-block rounded-full px-[7px] py-px text-[11px] ${flag.className}`}>{flag.label}</span>
                )}
                {b.maturity.note}
              </div>
            </Sec>
          )}
        </div>
      </div>
    </div>
  );
}
