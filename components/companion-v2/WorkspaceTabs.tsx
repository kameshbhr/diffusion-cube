'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { confirmLeave } from '@/lib/companion-v2/leave-warning';
import type { UseCaseAccess } from '@/lib/use-case-access';

interface Props {
  slug: string;
  access: UseCaseAccess;
  hasPlaybook: boolean;
}

// Tabs of a use case, by the person's access (docs/design/cube-usecase-plan.md):
//   everyone          Converse, View Jobs (when there's a playbook)
//   write and curate  + Documents
//   curate            + Playbook, Assets, Digest (with a playbook)
export default function WorkspaceTabs({ slug, access, hasPlaybook }: Props) {
  const pathname = usePathname();
  const base = `/companion/${slug}`;
  const curator = access === 'curate' && hasPlaybook;

  const tabs = [
    { href: base, label: 'Converse', exact: true },
    // Curators see every job in the Playbook tab; View Jobs is everyone else's.
    ...(hasPlaybook && !curator ? [{ href: `${base}/jobs`, label: 'View Jobs' }] : []),
    ...(curator
      ? [
          { href: `${base}/playbook`, label: 'Playbook' },
          { href: `${base}/assets`, label: 'Assets' },
        ]
      : []),
    ...(access !== 'read' ? [{ href: `${base}/documents`, label: 'Documents' }] : []),
    // The raw conversations sit behind the Digest ("Browse all conversations").
    ...(curator ? [{ href: `${base}/digest`, label: 'Digest', also: [`${base}/conversations`] }] : []),
  ] as { href: string; label: string; exact?: boolean; also?: string[] }[];

  return (
    <nav aria-label="Workspace" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : [t.href, ...(t.also ?? [])].some((h) => pathname?.startsWith(h));
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              if (!active && !confirmLeave()) e.preventDefault();
            }}
            className={`whitespace-nowrap border-b-[3px] px-3 py-2.5 text-sm font-medium transition ${
              active
                ? 'border-pb-accent text-pb-ink'
                : 'border-transparent text-pb-muted hover:text-pb-ink'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
