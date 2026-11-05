// Shared bits of the contributor Playbook view (a React port of
// docs/design/low-resource-language-ai-adoption-playbook.html). Contributors
// see the framework placement (work area, job type, stage) here; adopters
// never do.

import type { JobRow, OverviewEntry } from '@/lib/companion-v2/types';

export const NS = 'Not stated';

/** Left-border / dot colour per job type, as in the prototype. */
export const TYPE_COLOR: Record<string, string> = {
  Discover: 'var(--color-pb-discover)',
  Decide: 'var(--color-pb-decide)',
  Deliver: 'var(--color-pb-deliver)',
  Operate: 'var(--color-pb-operate)',
};
export const typeColor = (t: string) => TYPE_COLOR[t] ?? 'var(--color-pb-line)';

export const MATURITY_FLAG: Record<string, { label: string; className: string }> = {
  thin: { label: 'Thin', className: 'bg-pb-thin-bg text-pb-thin-ink' },
  judg: { label: 'Estimate', className: 'bg-pb-judg-bg text-pb-judg-ink' },
  check: { label: 'Needs check', className: 'bg-pb-check-bg text-pb-check-ink' },
};

/** A small "Edit" button for a card, section or item (contributors only). */
export function EditButton({ onClick, label = 'Edit', ariaLabel }: { onClick: () => void; label?: string; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex-none rounded-md border border-pb-line bg-pb-surface px-2 py-0.5 text-xs font-medium text-pb-accent transition hover:border-pb-accent"
    >
      ✎ {label}
    </button>
  );
}

export function Card({
  title,
  wide,
  onEdit,
  children,
}: {
  title: string;
  wide?: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-pb-line bg-pb-surface px-5 py-[18px] ${wide ? 'md:col-span-2' : ''}`}>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <h2 className="font-serif text-[19px] font-bold text-pb-ink">{title}</h2>
        {onEdit && <EditButton onClick={onEdit} ariaLabel={`Edit ${title}`} />}
      </div>
      {children}
    </div>
  );
}

/** The prototype's dl.kv: label column and value column, stacked on phones. */
export function KV({ entries }: { entries: OverviewEntry[] }) {
  return (
    <dl className="grid gap-x-3.5 gap-y-0.5 md:grid-cols-[minmax(110px,32%)_1fr] md:gap-y-2">
      {entries.map((e, i) => (
        <div key={`${e.label}-${i}`} className="contents">
          <dt className="text-[13.5px] text-pb-muted">{e.label}</dt>
          <dd className="mb-2.5 md:mb-0">
            {e.items ? (
              <>
                <ul className="list-disc space-y-1 pl-[18px]">
                  {e.items.map((x, k) => (
                    <li key={k}>{x}</li>
                  ))}
                </ul>
                {e.note && <p className="mt-2 text-[13.5px] text-pb-muted">{e.note}</p>}
              </>
            ) : (
              e.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Bullets({ items }: { items: string[] | undefined }) {
  return (
    <ul className="list-disc space-y-1.5 pl-[18px]">
      {(items ?? []).map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

/** A small job chip that opens the drawer (the prototype's .jb). */
export function JobChip({ job, onOpen }: { job: JobRow; onOpen: (code: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(job.job_code)}
      className="rounded-[5px] border border-l-4 border-pb-line bg-pb-surface px-2.5 py-1 text-left text-[13px] text-pb-ink transition hover:bg-pb-accent-soft focus-visible:outline-2 focus-visible:outline-pb-accent"
      style={{ borderLeftColor: typeColor(job.job_type) }}
    >
      {job.name}
    </button>
  );
}

/** Owners with PMU in bold; the first `limit` and "+N" when shortened. */
export function OwnersText({ owners, limit }: { owners: string[]; limit?: number }) {
  if (!owners.length) return <span className="italic">{NS}</span>;
  const shown = limit ? owners.slice(0, limit) : owners;
  return (
    <>
      {shown.map((o, i) => (
        <span key={o}>
          {i > 0 && ', '}
          {o === 'PMU' ? <strong className="font-semibold text-pb-ink">PMU</strong> : o}
        </span>
      ))}
      {limit && owners.length > limit ? ` +${owners.length - limit}` : ''}
    </>
  );
}

export function NoOwnerFlag() {
  return (
    <span className="ml-1 inline-block rounded-full bg-pb-check-bg px-[7px] py-px align-[1px] text-[11px] text-pb-check-ink">
      No owner named
    </span>
  );
}
