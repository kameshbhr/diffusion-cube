-- Cube 2.0 (branch cube-2): playbooks, their jobs, and per-playbook members.
-- See docs/design/cube2-plan.md section 2.
--
-- After the first seed the database is the source of truth for a playbook.
-- Contributors never write these tables directly: every content change goes
-- through save_playbook() below, which checks for a concurrent edit and
-- writes everything in one transaction.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title text not null,
  description text not null default '',
  -- {purpose, context, based_on, maturity_flags, credits: [{label, value|items, note?}], outcomes[], insights[]}
  overview jsonb not null default '{}'::jsonb,
  -- [{name, group, description, example, see, owner_keys[], playbook_names[]}]
  roles jsonb not null default '[]'::jsonb,
  -- {phases: [{name, when, text, jobs[]}], rules: [{rule, why}], framework: {...}}
  sequence jsonb not null default '{}'::jsonb,
  -- The living source document (markdown), loaded whole into the prompt.
  source_doc text not null default '',
  listed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.playbook_jobs (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  -- Fixed once created: member_job_states keys on it.
  job_code text not null check (job_code ~ '^[A-Za-z][A-Za-z0-9_-]*$'),
  name text not null check (name <> ''),
  stages text[] not null default '{}',
  work_area text not null default '',
  job_type text not null default '',
  -- Order of first appearance in the sequence (lower = earlier).
  position int,
  -- {intended_result, why_it_matters, when, how_summary[], tasks[{stage,timing,owner,text}],
  --  roles{owns,does,reviews,enables}, owners[], tracked_by[], owner_note, gaps[],
  --  maturity{flag,note}|null, recurs}
  body jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (playbook_id, job_code)
);

create index if not exists playbook_jobs_playbook_position_idx
  on public.playbook_jobs (playbook_id, position);

create table if not exists public.playbook_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  member_role text not null default 'adopter' check (member_role in ('adopter', 'contributor')),
  -- The user's role in the adoption project. Only PMU for now; stored per
  -- member so more roles can be added later.
  project_role text not null default 'PMU',
  created_at timestamptz not null default now(),
  unique (user_id, playbook_id)
);

create index if not exists playbook_members_playbook_idx
  on public.playbook_members (playbook_id, member_role);

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so RLS policies can call them without
-- recursing into playbook_members' own policies.
--
-- Both also require an approved account (at least one user_roles row, as
-- /api/chat checks), so revoking a user's roles also ends their playbook
-- access at the database, not only in the page layout.
-- is_playbook_member additionally requires the playbook to be listed, unless
-- the caller contributes to it: an adopter keeps no access to an unlisted one.
-- ---------------------------------------------------------------------------

create or replace function public.is_playbook_member(p_playbook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.playbook_members m
    join public.playbooks p on p.id = m.playbook_id
    where m.playbook_id = p_playbook_id
      and m.user_id = auth.uid()
      and (p.listed or m.member_role = 'contributor')
      and exists (select 1 from public.user_roles r where r.user_id = auth.uid())
  );
$$;

create or replace function public.is_playbook_contributor(p_playbook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.playbook_members m
    where m.playbook_id = p_playbook_id
      and m.user_id = auth.uid()
      and m.member_role = 'contributor'
      and exists (select 1 from public.user_roles r where r.user_id = auth.uid())
  );
$$;

revoke execute on function public.is_playbook_member(uuid) from public, anon;
revoke execute on function public.is_playbook_contributor(uuid) from public, anon;
grant execute on function public.is_playbook_member(uuid) to authenticated;
grant execute on function public.is_playbook_contributor(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.playbooks enable row level security;
alter table public.playbook_jobs enable row level security;
alter table public.playbook_members enable row level security;

-- Any approved user (at least one role) sees listed playbooks, so the list
-- shows before they join. Contributors also see their own unlisted ones.
create policy "Approved users can view listed playbooks"
  on public.playbooks for select
  using (
    (listed and exists (select 1 from public.user_roles where user_id = auth.uid()))
    or public.is_playbook_contributor(id)
  );

-- Jobs are visible exactly when their playbook is (the subquery runs under
-- the playbooks policy above).
create policy "Users can view jobs of visible playbooks"
  on public.playbook_jobs for select
  using (exists (select 1 from public.playbooks p where p.id = playbook_jobs.playbook_id));

-- No insert/update/delete policies on playbooks or playbook_jobs: contributors
-- write only through save_playbook(); seeding uses the service role.

create policy "Users can view their own memberships"
  on public.playbook_members for select
  using (user_id = auth.uid());

-- Self-join as an adopter (PMU) on a listed playbook. Contributor rows are
-- created only by an admin through the service role.
create policy "Approved users can join a listed playbook as an adopter"
  on public.playbook_members for insert
  with check (
    user_id = auth.uid()
    and member_role = 'adopter'
    and project_role = 'PMU'
    and exists (select 1 from public.user_roles where user_id = auth.uid())
    and exists (select 1 from public.playbooks p where p.id = playbook_members.playbook_id and p.listed)
  );

-- ---------------------------------------------------------------------------
-- save_playbook: the single write path for playbook content.
--
-- One transaction: checks the caller is a contributor, locks the playbook row,
-- rejects a stale base (someone saved since the caller loaded), applies the
-- playbook keys present in p_playbook, upserts every job in p_jobs (full rows),
-- deletes p_removed_jobs, then runs the content guards. Any error rolls back
-- everything, so a failed save never leaves a half-applied edit.
--
-- Error codes the client maps to messages:
--   42501 forbidden                    not a contributor of this playbook
--   P0002 playbook_not_found
--   P0409 stale_playbook               reload and try again
--   P0422 credits_attribution_missing  credits must keep CC BY 4.0 and EkStep
--   P0423 only_for_author_content      "Only for Author" text is not allowed
-- ---------------------------------------------------------------------------

create or replace function public.save_playbook(
  p_playbook_id uuid,
  p_base_updated_at timestamptz,
  p_playbook jsonb default '{}'::jsonb,
  p_jobs jsonb default '[]'::jsonb,
  p_removed_jobs text[] default '{}'
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current timestamptz;
  v_now timestamptz := clock_timestamp();
  v_job jsonb;
  v_credits text;
begin
  if not public.is_playbook_contributor(p_playbook_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select updated_at into v_current
  from public.playbooks
  where id = p_playbook_id
  for update;

  if not found then
    raise exception 'playbook_not_found' using errcode = 'P0002';
  end if;

  if v_current is distinct from p_base_updated_at then
    raise exception 'stale_playbook' using errcode = 'P0409';
  end if;

  p_playbook := coalesce(p_playbook, '{}'::jsonb);

  update public.playbooks set
    title       = case when p_playbook ? 'title'       then p_playbook->>'title'       else title end,
    description = case when p_playbook ? 'description' then p_playbook->>'description' else description end,
    overview    = case when p_playbook ? 'overview'    then p_playbook->'overview'     else overview end,
    roles       = case when p_playbook ? 'roles'       then p_playbook->'roles'        else roles end,
    sequence    = case when p_playbook ? 'sequence'    then p_playbook->'sequence'     else sequence end,
    source_doc  = case when p_playbook ? 'source_doc'  then p_playbook->>'source_doc'  else source_doc end,
    updated_at  = v_now,
    updated_by  = auth.uid()
  where id = p_playbook_id;

  if coalesce(array_length(p_removed_jobs, 1), 0) > 0 then
    delete from public.playbook_jobs
    where playbook_id = p_playbook_id and job_code = any (p_removed_jobs);
    -- Members' states for a removed job go too, so they cannot reappear if
    -- the code is ever reused. (member_job_states is created in 0036;
    -- plpgsql resolves it when this runs, not when it is defined.)
    delete from public.member_job_states s
    using public.playbook_members m
    where m.id = s.member_id
      and m.playbook_id = p_playbook_id
      and s.job_code = any (p_removed_jobs);
  end if;

  for v_job in select value from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) loop
    insert into public.playbook_jobs
      (playbook_id, job_code, name, stages, work_area, job_type, position, body, updated_at)
    values (
      p_playbook_id,
      v_job->>'job_code',
      v_job->>'name',
      coalesce(array(select jsonb_array_elements_text(coalesce(v_job->'stages', '[]'::jsonb))), '{}'),
      coalesce(v_job->>'work_area', ''),
      coalesce(v_job->>'job_type', ''),
      (v_job->>'position')::int,
      coalesce(v_job->'body', '{}'::jsonb),
      v_now
    )
    on conflict (playbook_id, job_code) do update set
      name       = excluded.name,
      stages     = excluded.stages,
      work_area  = excluded.work_area,
      job_type   = excluded.job_type,
      position   = excluded.position,
      body       = excluded.body,
      updated_at = excluded.updated_at;
  end loop;

  -- Content guards, checked on the result of the save.
  select coalesce(overview->'credits', '[]'::jsonb)::text into v_credits
  from public.playbooks where id = p_playbook_id;

  if position('CC BY 4.0' in v_credits) = 0 or position('EkStep' in v_credits) = 0 then
    raise exception 'credits_attribution_missing' using errcode = 'P0422';
  end if;

  -- Whole words with any whitespace between them, so "only for authorised"
  -- does not trip it and a non-breaking space does not slip past it.
  if exists (
    select 1 from public.playbooks
    where id = p_playbook_id
      and concat_ws(' ', title, description, overview::text, roles::text, sequence::text, source_doc)
          ~* '\monly[\s\u00a0]+for[\s\u00a0]+author\M'
  ) or exists (
    select 1 from public.playbook_jobs
    where playbook_id = p_playbook_id
      and concat_ws(' ', name, body::text) ~* '\monly[\s\u00a0]+for[\s\u00a0]+author\M'
  ) then
    raise exception 'only_for_author_content' using errcode = 'P0423';
  end if;

  return v_now;
end;
$$;

revoke execute on function public.save_playbook(uuid, timestamptz, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.save_playbook(uuid, timestamptz, jsonb, jsonb, text[]) to authenticated;

-- Explicit table grants, so these tables work even on a project where new
-- tables are not exposed to the Data API automatically. RLS still decides
-- which rows each user can touch.
grant select on public.playbooks, public.playbook_jobs to authenticated;
grant select, insert on public.playbook_members to authenticated;
grant all on public.playbooks, public.playbook_jobs, public.playbook_members to service_role;
