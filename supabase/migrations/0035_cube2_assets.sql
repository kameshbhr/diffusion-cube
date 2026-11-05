-- Cube 2.0: reusable assets (files or links) tagged by job, plus the private
-- Storage bucket that holds the files. See docs/design/cube2-plan.md section 2.
--
-- The table is named `assets` (no playbook prefix) so it can later serve a
-- pathway too; a pathway_id column is added then.
--
-- Uploads go straight from the browser to Storage under the contributor's own
-- session; the storage.objects policies below are the enforcement. Path:
--   {playbook_id}/{asset_id}/{filename}

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  title text not null check (title <> ''),
  kind text not null check (kind in ('file', 'link')),
  storage_path text unique,
  url text,
  -- Cube sees only the title, this description and the job tags.
  description text not null default '',
  job_codes text[] not null default '{}',
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint assets_kind_target check (
    (kind = 'file' and storage_path is not null and url is null)
    or (kind = 'link' and url is not null and storage_path is null)
  ),
  -- Links are web links only (no javascript: or data: URLs).
  constraint assets_url_http check (url is null or url ~* '^https?://')
);

create index if not exists assets_playbook_idx on public.assets (playbook_id);

alter table public.assets enable row level security;

create policy "Members can view assets of their playbooks"
  on public.assets for select
  using (public.is_playbook_member(playbook_id));

create policy "Contributors can add assets"
  on public.assets for insert
  with check (public.is_playbook_contributor(playbook_id));

create policy "Contributors can update assets"
  on public.assets for update
  using (public.is_playbook_contributor(playbook_id))
  with check (public.is_playbook_contributor(playbook_id));

create policy "Contributors can delete assets"
  on public.assets for delete
  using (public.is_playbook_contributor(playbook_id));

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- 100 MB per file, any type. The project's global upload limit (Dashboard ->
-- Storage -> Settings) still caps this: 50 MB on the Free plan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', false, 104857600, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- First path segment as a playbook id; null (never an error) for any other
-- shape, so a malformed object name cannot break reads of the bucket.
create or replace function public.asset_playbook_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return (split_part(p_name, '/', 1))::uuid;
exception when others then
  return null;
end;
$$;

-- A file asset must point at a file in its own playbook's folder, so a
-- contributor to one playbook cannot attach another playbook's file.
alter table public.assets drop constraint if exists assets_path_in_playbook;
alter table public.assets add constraint assets_path_in_playbook
  check (kind <> 'file' or public.asset_playbook_id(storage_path) = playbook_id);

create policy "Playbook members can read asset files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'assets' and public.is_playbook_member(public.asset_playbook_id(name)));

create policy "Playbook contributors can upload asset files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'assets' and public.is_playbook_contributor(public.asset_playbook_id(name)));

create policy "Playbook contributors can update asset files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'assets' and public.is_playbook_contributor(public.asset_playbook_id(name)))
  with check (bucket_id = 'assets' and public.is_playbook_contributor(public.asset_playbook_id(name)));

create policy "Playbook contributors can delete asset files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'assets' and public.is_playbook_contributor(public.asset_playbook_id(name)));

-- Files with no assets row: left behind only if the clean-up after a failed
-- row insert itself failed. Contributor-only; the Assets screen offers to
-- remove them.
create or replace view public.asset_orphans
with (security_invoker = true)
as
select
  o.name as storage_path,
  public.asset_playbook_id(o.name) as playbook_id,
  o.created_at
from storage.objects o
where o.bucket_id = 'assets'
  and public.is_playbook_contributor(public.asset_playbook_id(o.name))
  and not exists (select 1 from public.assets a where a.storage_path = o.name);

revoke all on public.asset_orphans from anon;
grant select on public.asset_orphans to authenticated;

-- Explicit table grants (see 0034). RLS still decides which rows.
grant select, insert, update, delete on public.assets to authenticated;
grant all on public.assets to service_role;
