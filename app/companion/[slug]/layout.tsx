import Link from 'next/link';
import WorkspaceTabs from '@/components/companion-v2/WorkspaceTabs';
import { canRunDigest, getWorkspace } from '@/lib/companion-v2/server';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Joins the caller as an adopter (PMU) on first open; 404s if not visible.
  const { playbook, member } = await getWorkspace(slug);
  const canDigest = await canRunDigest(playbook.id);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-pb-line bg-pb-surface">
        <div className="mx-auto w-full max-w-5xl px-4 pt-3 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <h1 className="font-serif text-lg font-bold leading-snug text-pb-ink sm:text-xl">{playbook.title}</h1>
            <Link
              href="/companion"
              className="mt-1 flex-shrink-0 whitespace-nowrap text-xs text-pb-muted transition hover:text-pb-accent"
            >
              ← All playbooks
            </Link>
          </div>
          <div className="mt-1">
            <WorkspaceTabs slug={playbook.slug} isContributor={member.member_role === 'contributor'} canDigest={canDigest} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-8">{children}</div>
    </div>
  );
}
