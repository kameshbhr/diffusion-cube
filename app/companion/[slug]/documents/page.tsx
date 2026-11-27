import { notFound } from 'next/navigation';
import AdminDocumentsPanel from '@/components/AdminDocumentsPanel';
import { getWorkspace } from '@/lib/companion-v2/server';

// Documents: add PDF or Word documents to this use case, so Cube (in the app
// and through Claude) can search them alongside the team's notes. For people
// with write or curate access; 404 for everyone else.
export default async function DocumentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { useCase, access } = await getWorkspace(slug);
  if (access === 'read') notFound();

  return (
    <div>
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-pb-muted">
        Add reports, guides and other documents about this use case. Their text becomes searchable straight away, by keyword
        first and by meaning once embedded. Documents can&apos;t be edited or removed here yet.
      </p>
      <AdminDocumentsPanel lockedUseCaseId={useCase.id} />
    </div>
  );
}
