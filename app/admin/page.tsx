import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin, type Role } from '@/lib/roles';
import AdminDashboard, { AdminUserRow } from '@/components/AdminDashboard';
import AdminPathwaysPanel, { AdminPathwayRow } from '@/components/AdminPathwaysPanel';
import AdminContributorRegistrationsPanel, {
  AdminContributorRegistrationRow,
} from '@/components/AdminContributorRegistrationsPanel';
import AdminPlaybookMembersPanel, { AdminPlaybookRow } from '@/components/AdminPlaybookMembersPanel';
import { isCube2 } from '@/lib/flags';

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    redirect('/');
  }

  const admin = createAdminClient();
  const [
    { data: usersData },
    { data: rolesData },
    { data: publishedSlugsData },
    { data: pathwaysData },
    { data: registrationsData },
  ] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from('user_roles').select('user_id, role'),
      admin.from('published_pathways').select('slug'),
      admin
        .from('pathways')
        .select('id, slug, title, sector, created_at, review_requested')
        .order('created_at', { ascending: false }),
      admin
        .from('contributor_registrations')
        .select('id, poc_name, poc_email, organisation_name, pathway_role, pathway_description, access_status, created_at')
        .order('created_at', { ascending: false }),
    ]);

  const publishedSlugSet = new Set((publishedSlugsData ?? []).map((p) => p.slug));

  // Cube 2.0 only: the playbook tables exist only where migrations 0034+ ran.
  let playbookRows: AdminPlaybookRow[] = [];
  if (isCube2) {
    const [{ data: playbooksData }, { data: contributorsData }] = await Promise.all([
      admin.from('playbooks').select('id, slug, title').order('title'),
      admin.from('playbook_members').select('playbook_id, user_id').eq('member_role', 'contributor'),
    ]);
    playbookRows = (playbooksData ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      contributorIds: (contributorsData ?? []).filter((m) => m.playbook_id === p.id).map((m) => m.user_id),
    }));
  }

  const registrationRows: AdminContributorRegistrationRow[] = (registrationsData ?? []).map((r) => ({
    id: r.id,
    pocName: r.poc_name ?? '',
    pocEmail: r.poc_email ?? '',
    organisationName: r.organisation_name ?? '',
    pathwayRole: r.pathway_role ?? '',
    pathwayDescription: r.pathway_description ?? '',
    accessStatus: r.access_status,
    createdAt: r.created_at,
  }));

  const pathwayRows: AdminPathwayRow[] = (pathwaysData ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    sector: p.sector ?? '',
    created_at: p.created_at,
    reviewRequested: p.review_requested ?? false,
    isPublished: publishedSlugSet.has(p.slug),
  }));

  const rolesByUser = new Map<string, Role[]>();
  for (const row of rolesData ?? []) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.role);
    rolesByUser.set(row.user_id, list);
  }

  const rows: AdminUserRow[] = (usersData?.users ?? [])
    .map((u) => ({
      id: u.id,
      email: u.email ?? '',
      name: (u.user_metadata?.name as string) ?? '',
      organization: (u.user_metadata?.organization as string) ?? '',
      roles: rolesByUser.get(u.id) ?? [],
    }))
    .sort((a, b) => a.roles.length - b.roles.length);

  return (
    <div className="min-h-screen bg-paper text-ink p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-xs text-ink-soft hover:text-coral transition-colors">
          ← Back
        </Link>
        <h1 className="font-display text-2xl font-medium text-navy mt-2 mb-1">Admin</h1>
        <p className="text-sm text-ink-soft mb-6">Approve signups and manage roles.</p>
        <AdminDashboard initialRows={rows} />

        <h2 className="font-display text-lg font-medium text-navy mt-10 mb-1">Contributor Registrations</h2>
        <p className="text-sm text-ink-soft mb-4">
          Approve to grant the Contributor role and let them start joining/creating pathways. Reject to turn them away.
        </p>
        <AdminContributorRegistrationsPanel initialRows={registrationRows} />

        <h2 className="font-display text-lg font-medium text-navy mt-10 mb-1">Pathways</h2>
        <p className="text-sm text-ink-soft mb-4">
          Review assembled pathway documents and publish them to the Explore library and Analyse corpus.
        </p>
        <AdminPathwaysPanel initialRows={pathwayRows} />

        {isCube2 && (
          <>
            <h2 className="font-display text-lg font-medium text-navy mt-10 mb-1">Playbook contributors</h2>
            <p className="text-sm text-ink-soft mb-4">
              Contributors can edit a playbook, its source document and assets, and read adopter conversations
              without names or emails. Adopters join playbooks themselves.
            </p>
            <AdminPlaybookMembersPanel
              initialPlaybooks={playbookRows}
              users={rows.filter((r) => r.email).map((r) => ({ id: r.id, email: r.email }))}
            />
          </>
        )}
      </div>
    </div>
  );
}
