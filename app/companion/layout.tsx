import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AccessGateMessage from '@/components/AccessGateMessage';
import { isCube2 } from '@/lib/flags';
import { getViewer } from '@/lib/companion-v2/server';

// Cube 2.0 companion. Only exists when NEXT_PUBLIC_CUBE_VERSION=2. Not in
// proxy.ts's public list, so a signed-out visitor is sent to /login first.
export default async function CompanionLayout({ children }: { children: React.ReactNode }) {
  if (!isCube2) notFound();

  const { email, approved, isAdmin } = await getViewer();

  if (!approved) {
    return (
      <AppShell email={email} adoptions={[]} isAdmin={isAdmin}>
        <AccessGateMessage
          eyebrow="100 Pathways · Companion"
          heading="Your account is almost ready"
          body="Your account has been created but isn't active yet. You'll be able to use the companion as soon as it is."
        />
      </AppShell>
    );
  }

  return (
    <AppShell email={email} adoptions={[]} isAdmin={isAdmin}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-pb-bg text-pb-ink">{children}</div>
    </AppShell>
  );
}
