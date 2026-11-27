import Link from 'next/link';
import WorkspaceTabs from '@/components/companion-v2/WorkspaceTabs';
import { getWorkspace } from '@/lib/companion-v2/server';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // 404s if the person can't read this use case.
  const { useCase, access, playbook } = await getWorkspace(slug);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-pb-line bg-pb-surface">
        <div className="mx-auto w-full max-w-5xl px-4 pt-3 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <h1 className="font-serif text-lg font-bold leading-snug text-pb-ink sm:text-xl">{useCase.name}</h1>
            <Link
              href="/companion"
              className="mt-1 flex-shrink-0 whitespace-nowrap text-xs text-pb-muted transition hover:text-pb-accent"
            >
              ← All use cases
            </Link>
          </div>
          <div className="mt-1">
            <WorkspaceTabs slug={useCase.slug} access={access} hasPlaybook={playbook !== null} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-8">{children}</div>
    </div>
  );
}
