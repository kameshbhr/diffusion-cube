import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/roles';
import AdminDocumentsPanel from '@/components/AdminDocumentsPanel';

// Cube raw layer (migration 0039): admins add documents to a use case, so the
// Cube connector can search them alongside the notes. Cube admins only.
export default async function AdminDocumentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAdmin(supabase, user?.email))) redirect('/');

  return (
    <div className="min-h-screen bg-paper text-ink p-4 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/admin" className="text-xs text-ink-soft hover:text-coral transition-colors">
          ← Admin
        </Link>
        <h1 className="font-display text-2xl font-medium text-navy mt-2 mb-1">Documents</h1>
        <p className="text-sm text-ink-soft mb-6">
          Add PDF or Word documents to a use case. Their text becomes searchable in the Cube connector straight away,
          by keyword first and by meaning once embedded.
        </p>
        <AdminDocumentsPanel />
      </div>
    </div>
  );
}
