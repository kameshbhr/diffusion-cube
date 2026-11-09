-- Cube 2.0: the contributor Digest (docs/design/cube2-plan.md section 9).
--
-- The Digest tab shows numbers computed here and an AI-written digest of what
-- adopters asked. Everything goes through security definer functions that
-- check can_run_digest() for the caller, cover adopters only, and never return
-- a member id, user id, name or email: people are run-local numbers.
--
-- Every permission check in the digest code uses can_run_digest(), never
-- is_playbook_contributor() directly, so allowing admins later is a one-line
-- change here.

-- ---------------------------------------------------------------------------
-- Permission
-- ---------------------------------------------------------------------------

create or replace function public.can_run_digest(p_playbook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_playbook_contributor(p_playbook_id);
$$;

revoke execute on function public.can_run_digest(uuid) from public, anon;
grant execute on function public.can_run_digest(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Stored digests: one per playbook per period (7 or 30 days), overwritten on
-- regenerate, no history. The payload holds conversation ids and run-local
-- person labels (U1, U2), never a user id, member id, name or email.
-- Readable by those who can run the digest; written only by save_digest().
-- ---------------------------------------------------------------------------

create table if not exists public.playbook_digests (
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  period_days int not null check (period_days in (7, 30)),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  generated_at timestamptz not null default now(),
  primary key (playbook_id, period_days)
);

alter table public.playbook_digests enable row level security;

drop policy if exists "Digest readers can view digests" on public.playbook_digests;
create policy "Digest readers can view digests"
  on public.playbook_digests for select
  using (public.can_run_digest(playbook_id));

-- Select only. No insert, update or delete for any signed-in user.
revoke all on public.playbook_digests from anon, authenticated;
grant select on public.playbook_digests to authenticated;
grant all on public.playbook_digests to service_role;

-- The lease: one generation at a time per playbook (across both periods).
-- run_id identifies the run holding it, so a run whose lease expired can't
-- release or overwrite a newer run's lease. No direct access at all.
create table if not exists public.playbook_digest_runs (
  playbook_id uuid primary key references public.playbooks (id) on delete cascade,
  run_id uuid not null,
  running_until timestamptz not null
);

alter table public.playbook_digest_runs enable row level security;
revoke all on public.playbook_digest_runs from anon, authenticated;
grant all on public.playbook_digest_runs to service_role;

-- ---------------------------------------------------------------------------
-- Numbers for the Digest tab (computed when it opens; never by the model).
-- A conversation counts once it has at least one user message, so one with
-- only Cube's opening message is not counted. Returns null for callers who
-- can't run the digest, or an unknown period.
--
-- Most discussed jobs (till date): per job, the distinct conversations in
-- which it was openJob, or in focusJobs, of an assistant reply that answers
-- a user message (the reply right after a user message; kickoff replies have
-- none before them).
-- ---------------------------------------------------------------------------

create or replace function public.contributor_digest_stats(p_playbook_id uuid, p_days int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with conv as (
    select c.id, c.member_id
    from public.companion_conversations c
    join public.playbook_members m on m.id = c.member_id
    where c.playbook_id = p_playbook_id
      and m.member_role = 'adopter'
      and exists (
        select 1 from public.companion_messages um
        where um.conversation_id = c.id and um.role = 'user'
      )
  ),
  user_msgs as (
    select msg.conversation_id, conv.member_id, msg.created_at
    from public.companion_messages msg
    join conv on conv.id = msg.conversation_id
    where msg.role = 'user'
  ),
  ordered as (
    select msg.conversation_id, msg.role, msg.ui,
           -- A user message sorts before a reply with the same timestamp.
           lag(msg.role) over (
             partition by msg.conversation_id order by msg.created_at, (msg.role = 'assistant')
           ) as prev_role
    from public.companion_messages msg
    join conv on conv.id = msg.conversation_id
  ),
  replies as (
    select conversation_id, ui from ordered
    where role = 'assistant' and prev_role = 'user' and jsonb_typeof(ui) = 'object'
  ),
  mentions as (
    select r.conversation_id, f.value as job_code
    from replies r
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(r.ui->'focusJobs') = 'array' then r.ui->'focusJobs' else '[]'::jsonb end
    ) as f(value)
    union
    select r.conversation_id, r.ui->>'openJob'
    from replies r
    where jsonb_typeof(r.ui->'openJob') = 'string'
  ),
  job_counts as (
    select j.job_code, j.name, j.position, count(distinct mn.conversation_id) as conversations
    from mentions mn
    join public.playbook_jobs j on j.playbook_id = p_playbook_id and j.job_code = mn.job_code
    group by j.job_code, j.name, j.position
  )
  select case
    when not public.can_run_digest(p_playbook_id) or p_days not in (7, 30) then null
    else jsonb_build_object(
      'users_total', (select count(distinct member_id) from conv),
      'users_period', (select count(distinct member_id) from user_msgs
                       where created_at >= now() - make_interval(days => p_days)),
      'conversations_total', (select count(*) from conv),
      'conversations_period', (select count(distinct conversation_id) from user_msgs
                               where created_at >= now() - make_interval(days => p_days)),
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object('job', job_code, 'name', name, 'conversations', conversations)
                         order by conversations desc, position nulls last, job_code)
        from (select * from job_counts order by conversations desc, position nulls last, job_code limit 10) top
      ), '[]'::jsonb),
      -- Conversations that still exist, so a stored digest can drop deleted ones.
      'conversation_ids', coalesce((select jsonb_agg(id) from conv), '[]'::jsonb)
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- The digest model's input for one period: the newest 400 adopter messages
-- (their own words only, never Cube's replies) and the gap entries Cube
-- recorded. Each row carries a run-local person number, never a member id.
-- ---------------------------------------------------------------------------

create or replace function public.contributor_digest_input(p_playbook_id uuid, p_days int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with conv as (
    select c.id, c.member_id
    from public.companion_conversations c
    join public.playbook_members m on m.id = c.member_id
    where c.playbook_id = p_playbook_id and m.member_role = 'adopter'
  ),
  -- Numbered in random order on every call, so a number means nothing
  -- outside this one result and can't follow a person across runs.
  people as (
    select member_id, row_number() over (order by random()) as person
    from (select distinct member_id from conv) d
  ),
  -- Only the user's own words and the gap of each reply; never Cube's text.
  period_msgs as (
    select msg.id, msg.conversation_id, msg.role,
           case when msg.role = 'user' then msg.content end as content,
           case when msg.role = 'assistant' and jsonb_typeof(msg.ui) = 'object' then msg.ui->'gap' end as gap,
           msg.created_at, pe.person
    from public.companion_messages msg
    join conv on conv.id = msg.conversation_id
    join people pe on pe.member_id = conv.member_id
    where msg.created_at >= now() - make_interval(days => p_days)
  ),
  newest as (
    select * from period_msgs where role = 'user' order by created_at desc limit 400
  )
  select case
    when not public.can_run_digest(p_playbook_id) or p_days not in (7, 30) then null
    else jsonb_build_object(
      'messages_total', (select count(*) from period_msgs where role = 'user'),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'conversation_id', conversation_id, 'person', person,
          'created_at', created_at, 'content', left(content, 1000)
        ) order by created_at)
        from newest
      ), '[]'::jsonb),
      'gaps', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'conversation_id', conversation_id, 'person', person,
          'created_at', created_at, 'gap', gap
        ) order by created_at)
        from period_msgs
        where role = 'assistant' and jsonb_typeof(gap) = 'object'
      ), '[]'::jsonb)
    )
  end;
$$;

-- Current journey states per job (till date), aggregated across adopters.
create or replace function public.contributor_job_state_counts(p_playbook_id uuid)
returns table (job_code text, state text, people bigint)
language sql
stable
security definer
set search_path = public
as $$
  -- The permission check runs once (a scalar subquery), not per row.
  select s.job_code, s.state, count(*)
  from public.member_job_states s
  join public.playbook_members m on m.id = s.member_id
  where m.playbook_id = p_playbook_id
    and m.member_role = 'adopter'
    and (select public.can_run_digest(p_playbook_id))
  group by s.job_code, s.state;
$$;

-- ---------------------------------------------------------------------------
-- Lease and save. A run claims the lease (5 minutes), and either saves the
-- digest (which also releases it) or releases it on failure. A run that
-- dies (tab closed, function timeout) simply lets the lease expire.
-- ---------------------------------------------------------------------------

-- Returns the run id, or null when another run holds an unexpired lease.
create or replace function public.claim_digest_run(p_playbook_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_run uuid;
begin
  if not public.can_run_digest(p_playbook_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  insert into public.playbook_digest_runs (playbook_id, run_id, running_until)
  values (p_playbook_id, gen_random_uuid(), now() + interval '5 minutes')
  on conflict (playbook_id) do update
    set run_id = excluded.run_id, running_until = excluded.running_until
    where public.playbook_digest_runs.running_until < now()
  returning run_id into v_run;

  return v_run;
end;
$$;

-- Stores the digest only for the run that holds the lease (or held it and
-- wasn't replaced), then releases it. Returns false if the run was replaced.
create or replace function public.save_digest(p_playbook_id uuid, p_period_days int, p_run_id uuid, p_payload jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.can_run_digest(p_playbook_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_period_days not in (7, 30) then
    raise exception 'bad_period' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 1048576 then
    raise exception 'bad_payload' using errcode = '22023';
  end if;

  delete from public.playbook_digest_runs
  where playbook_id = p_playbook_id and run_id = p_run_id;
  if not found then
    return false;
  end if;

  insert into public.playbook_digests (playbook_id, period_days, payload, generated_at)
  values (p_playbook_id, p_period_days, p_payload, now())
  on conflict (playbook_id, period_days) do update
    set payload = excluded.payload, generated_at = excluded.generated_at;
  return true;
end;
$$;

-- Releases the lease after a failed run so Retry works at once. Never touches
-- the stored digest.
create or replace function public.release_digest_run(p_playbook_id uuid, p_run_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.can_run_digest(p_playbook_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.playbook_digest_runs
  where playbook_id = p_playbook_id and run_id = p_run_id;
end;
$$;

revoke execute on function public.contributor_digest_stats(uuid, int) from public, anon;
revoke execute on function public.contributor_digest_input(uuid, int) from public, anon;
revoke execute on function public.contributor_job_state_counts(uuid) from public, anon;
revoke execute on function public.claim_digest_run(uuid) from public, anon;
revoke execute on function public.save_digest(uuid, int, uuid, jsonb) from public, anon;
revoke execute on function public.release_digest_run(uuid, uuid) from public, anon;
grant execute on function public.contributor_digest_stats(uuid, int) to authenticated;
grant execute on function public.contributor_digest_input(uuid, int) to authenticated;
grant execute on function public.contributor_job_state_counts(uuid) to authenticated;
grant execute on function public.claim_digest_run(uuid) to authenticated;
grant execute on function public.save_digest(uuid, int, uuid, jsonb) to authenticated;
grant execute on function public.release_digest_run(uuid, uuid) to authenticated;
