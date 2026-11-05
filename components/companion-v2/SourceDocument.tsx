'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WikiMarkdown from '@/components/WikiMarkdown';
import PatchReview from './PatchReview';
import { showToast } from '@/lib/toast';
import { useLeaveWarning } from '@/lib/companion-v2/leave-warning';
import { SOURCE_TOKEN_CAP as TOKEN_CAP, type PatchOp, type Snapshot } from '@/lib/companion-v2/patch';
const approxTokens = (chars: number) => Math.ceil(chars / 4);

interface Props {
  slug: string;
  playbookId: string;
  base: Snapshot;
  updatedAt: string;
}

const WARN_AT = 0.8;

function SizeMeter({ chars }: { chars: number }) {
  const tokens = approxTokens(chars);
  const share = tokens / TOKEN_CAP;
  const tone = share > 1 ? 'bg-pb-check-ink' : share >= WARN_AT ? 'bg-pb-thin-ink' : 'bg-pb-accent';
  const text = share > 1 ? 'text-pb-check-ink' : share >= WARN_AT ? 'text-pb-thin-ink' : 'text-pb-muted';
  return (
    <div className="min-w-[220px] flex-1 sm:max-w-xs">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-pb-line-soft"
        role="meter"
        aria-label="Size of the source document"
        aria-valuemin={0}
        aria-valuemax={TOKEN_CAP}
        aria-valuenow={Math.min(tokens, TOKEN_CAP)}
      >
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <p className={`mt-1 text-xs ${text}`}>
        About {tokens.toLocaleString('en')} of {TOKEN_CAP.toLocaleString('en')} tokens
        {share > 1 ? ': too long for Cube to read whole. Shorten it before saving.' : share >= WARN_AT ? ': getting close to the limit.' : '.'}
      </p>
    </div>
  );
}

// Source document: read it, edit it as markdown (with a diff before saving),
// or update it from files through Update with Cube.
export default function SourceDocument({ slug, playbookId, base, updatedAt }: Props) {
  const router = useRouter();
  const doc = base.playbook.source_doc;
  // Editing keeps the document and updated_at it started from, so a refresh
  // landing meanwhile can't change the base under it (the save fails as stale).
  const [edit, setEdit] = useState<{ draft: string; base: Snapshot; updatedAt: string } | null>(null);
  const [review, setReview] = useState<PatchOp[] | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const changed = edit !== null && edit.draft !== edit.base.playbook.source_doc;
  // Over the budget and longer than before (a document already over it can still shrink).
  const overCap =
    edit !== null && approxTokens(edit.draft.length) > TOKEN_CAP && edit.draft.length > edit.base.playbook.source_doc.length;

  useLeaveWarning(changed);

  // Focus the editor when editing starts or the review closes.
  const editing = edit !== null;
  const reviewing = review !== null;
  useEffect(() => {
    if (editing && !reviewing) textareaRef.current?.focus();
  }, [editing, reviewing]);

  const headingCount = useMemo(() => doc.split('\n').filter((l) => /^#{1,6}\s/.test(l)).length, [doc]);

  function cancel() {
    if (changed && !window.confirm('Stop editing? Your changes here will be lost.')) return;
    setEdit(null);
    setReview(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <SizeMeter chars={(edit ? edit.draft : doc).length} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {refreshing && (
            <span role="status" className="text-xs text-pb-muted">
              Updating…
            </span>
          )}
          {!edit && (
            <>
              <button
                type="button"
                onClick={() => setEdit({ draft: doc, base, updatedAt })}
                disabled={refreshing}
                className="rounded-lg bg-pb-accent px-3.5 py-1.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                Edit
              </button>
              <Link
                href={`/companion/${slug}/update?from=files`}
                className="rounded-lg border border-pb-line bg-pb-surface px-3 py-1.5 transition hover:border-pb-accent"
              >
                Update from files
              </Link>
            </>
          )}
        </div>
      </div>

      {!edit && (
        <article className="rounded-xl border border-pb-line bg-pb-surface px-5 py-6 text-[15px] leading-relaxed text-pb-ink sm:px-8 [&_li]:my-0.5 [&_p]:my-2">
          {doc.trim() ? <WikiMarkdown markdown={doc} /> : <p className="text-pb-muted">The source document is empty.</p>}
          {headingCount === 0 && doc.trim() && (
            <p className="mt-4 text-xs text-pb-muted">This document has no headings, so Cube can only change it in small pieces.</p>
          )}
        </article>
      )}

      {edit && !review && (
        <div className="space-y-3">
          <p className="text-sm text-pb-muted">
            Markdown: start a line with <code>##</code> or <code>###</code> for a heading. Keep the headings unique; Cube finds
            sections by them. Never paste content marked “Only for Author”.
          </p>
          <textarea
            ref={textareaRef}
            value={edit.draft}
            onChange={(e) => setEdit({ ...edit, draft: e.target.value })}
            aria-label="Source document (markdown)"
            spellCheck
            className="h-[65vh] w-full resize-y rounded-xl border border-pb-line bg-pb-surface px-4 py-3 font-mono text-[13px] leading-relaxed text-pb-ink outline-none focus:border-pb-accent"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setReview([{ op: 'source.set', value: edit.draft }])}
              disabled={!changed || overCap}
              className="rounded-lg bg-pb-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Review changes
            </button>
            <button type="button" onClick={cancel} className="text-sm text-pb-muted hover:text-pb-ink">
              Cancel
            </button>
            {!changed && <span className="text-xs text-pb-muted">No changes yet.</span>}
          </div>
        </div>
      )}

      {edit && review && (
        <div className="rounded-xl border border-pb-line bg-pb-surface p-4">
          <PatchReview
            playbookId={playbookId}
            baseUpdatedAt={edit.updatedAt}
            base={edit.base}
            ops={review}
            discardLabel="Back to editing"
            onDiscard={() => setReview(null)}
            onApplied={() => {
              setReview(null);
              setEdit(null);
              showToast('Saved. The source document is live.');
              startRefresh(() => router.refresh());
            }}
          />
        </div>
      )}
    </div>
  );
}
