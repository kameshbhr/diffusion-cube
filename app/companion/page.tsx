import Link from 'next/link';
import { listPlaybooks } from '@/lib/companion-v2/server';

export const metadata = { title: 'Companion | 100 Pathways' };

// The "Companion" nav item: the playbooks a user can open. Opening one goes to
// its workspace (and joins it on first open).
export default async function CompanionHome() {
  const playbooks = await listPlaybooks();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8 sm:py-14">
      <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-pb-accent">Companion</h1>

      {playbooks.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-pb-line bg-pb-surface px-5 py-6 text-sm text-pb-muted">
          There are no playbooks here yet.
        </p>
      ) : (
        <ul className="mt-10 flex flex-col gap-4">
          {playbooks.map((p) => (
            <li key={p.id}>
              {/* No prefetch: opening a playbook joins it, so only a real click should. */}
              <Link
                href={`/companion/${p.slug}?c=new`}
                prefetch={false}
                className="group block rounded-xl border border-pb-line bg-pb-surface p-5 shadow-[0_1px_2px_rgba(20,30,45,0.04)] transition hover:border-pb-accent hover:shadow-[0_6px_24px_rgba(20,30,45,0.08)]"
              >
                <h2 className="font-serif text-xl font-bold text-pb-ink">{p.title}</h2>
                {p.description && (
                  <p className="mt-2 text-sm leading-relaxed text-pb-muted">{p.description}</p>
                )}
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
