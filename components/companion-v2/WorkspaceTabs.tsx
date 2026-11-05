'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { confirmLeave } from '@/lib/companion-v2/leave-warning';

interface Props {
  slug: string;
  isContributor: boolean;
}

// Adopters see two screens (Home, Jobs). Contributors also see their tools.
export default function WorkspaceTabs({ slug, isContributor }: Props) {
  const pathname = usePathname();
  const base = `/companion/${slug}`;

  const tabs = [
    { href: base, label: 'Home', exact: true },
    { href: `${base}/jobs`, label: 'Jobs' },
    ...(isContributor
      ? [
          { href: `${base}/playbook`, label: 'Playbook' },
          { href: `${base}/update`, label: 'Update with Cube' },
          { href: `${base}/source`, label: 'Source document' },
          { href: `${base}/assets`, label: 'Assets' },
          { href: `${base}/conversations`, label: 'Conversations' },
        ]
      : []),
  ];

  return (
    <nav aria-label="Workspace" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname?.startsWith(t.href);
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
