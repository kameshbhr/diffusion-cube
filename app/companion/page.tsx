import Link from 'next/link';
import { listUseCases } from '@/lib/companion-v2/server';

export const metadata = { title: 'Companion | 100 Pathways' };

const ACCESS_LABEL = { read: 'Read', write: 'Write', curate: 'Curate' } as const;

// The "Companion" nav item: the use cases the person can read (on the
// allowlist, or open to all). Each may have a playbook.
export default async function CompanionHome() {
  const useCases = await listUseCases();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8 sm:py-14">
      <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-pb-accent">Companion</h1>

      {useCases.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-pb-line bg-pb-surface px-5 py-6 text-sm text-pb-muted">
          You don&apos;t have access to any use case yet. Please contact the admin.
        </p>
      ) : (
        <ul className="mt-10 flex flex-col gap-4">
          {useCases.map((u) => (
            <li key={u.id}>
              <Link
                href={`/companion/${u.slug}?c=new`}
                prefetch={false}
                className="group block rounded-xl border border-pb-line bg-pb-surface p-5 shadow-[0_1px_2px_rgba(20,30,45,0.04)] transition hover:border-pb-accent hover:shadow-[0_6px_24px_rgba(20,30,45,0.08)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-serif text-xl font-bold text-pb-ink">{u.name}</h2>
                  <span className="flex flex-shrink-0 gap-1.5 pt-1 text-[11px] font-medium">
                    {u.hasPlaybook && <span className="rounded-full bg-pb-accent-soft px-2 py-0.5 text-pb-accent">Playbook</span>}
                    <span className="rounded-full border border-pb-line px-2 py-0.5 text-pb-muted">{ACCESS_LABEL[u.access]}</span>
                  </span>
                </div>
                {u.description && <p className="mt-2 text-sm leading-relaxed text-pb-muted">{u.description}</p>}
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-pb-accent">
                  Open
                  <span aria-hidden className="transition group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
