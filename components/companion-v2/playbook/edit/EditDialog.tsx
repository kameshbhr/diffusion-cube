'use client';

import { useEffect, useRef, useState } from 'react';
import type { PatchOp, Snapshot } from '@/lib/companion-v2/patch';
import PatchReview from '../../PatchReview';

interface Props {
  title: string;
  playbookId: string;
  baseUpdatedAt: string;
  base: Snapshot;
  /** Renders the form; it calls onReview with the ops it built. */
  form: (onReview: (ops: PatchOp[]) => void, onCancel: () => void) => React.ReactNode;
  onClose: () => void;
  onApplied: (newUpdatedAt: string, applied: PatchOp[]) => void;
}

// A modal with two steps: the form, then the diff and Apply screen. Nothing is
// saved until Apply. Esc or Cancel closes without saving (after a check if
// there is a reviewed change waiting).
export default function EditDialog({ title, playbookId, baseUpdatedAt, base, form, onClose, onApplied }: Props) {
  const [ops, setOps] = useState<PatchOp[] | null>(null);
  // Whatever opened the dialog, captured before any effect moves focus inside
  // it, so focus can go back there on close.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  const openerRef = useRef(opener);
  // Anything typed or added in the form counts as unsaved work.
  const [dirty, setDirty] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const unsavedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    unsavedRef.current = dirty || !!ops;
    onCloseRef.current = onClose;
  }, [dirty, ops, onClose]);

  const unsaved = dirty || !!ops;
  const closeIfConfirmed = () => {
    if (!unsaved || window.confirm('Close without saving? Your changes here will be lost.')) onClose();
  };

  // Focus the first review card when reviewing, and the first field when back.
  useEffect(() => {
    const root = ops ? reviewRef.current : formRef.current;
    root?.querySelector<HTMLElement>('input, textarea, select')?.focus();
  }, [ops]);

  useEffect(() => {
    const back = openerRef.current;
    const scroller = panelRef.current?.closest<HTMLElement>('[data-scroll-root]') ?? null;
    const prev = scroller?.style.overflowY ?? '';
    if (scroller) scroller.style.overflowY = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!unsavedRef.current || window.confirm('Close without saving? Your changes here will be lost.')) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      );
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
      back?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-0 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
      <div className="fixed inset-0 bg-[rgba(10,15,22,0.45)]" aria-hidden />
      <div ref={panelRef} className="relative w-full max-w-2xl rounded-none bg-pb-surface text-pb-ink shadow-[0_10px_40px_rgba(20,30,45,0.18)] sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-pb-line px-5 py-4">
          <div>
            <p className="text-xs text-pb-muted">{ops ? 'Review your changes' : 'Edit'}</p>
            <h2 id="edit-dialog-title" className="font-serif text-lg font-bold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeIfConfirmed}
            className="rounded-md border border-pb-line bg-pb-bg px-2.5 py-1.5 text-sm"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">
          {/* The form stays mounted (hidden) during review, so "Back" keeps edits. */}
          <div
            ref={formRef}
            hidden={!!ops}
            onInput={() => setDirty(true)}
            onClickCapture={(e) => {
              const b = (e.target as HTMLElement).closest('button');
              if (b && !['Review changes', 'Cancel'].includes(b.textContent?.trim() ?? '')) setDirty(true);
            }}
          >
            {form((o) => setOps(o), closeIfConfirmed)}
          </div>
          {ops && (
            <div ref={reviewRef}>
            <PatchReview
              playbookId={playbookId}
              baseUpdatedAt={baseUpdatedAt}
              base={base}
              ops={ops}
              onApplied={onApplied}
              onDiscard={() => setOps(null)}
              discardLabel="Back to the form"
            />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
