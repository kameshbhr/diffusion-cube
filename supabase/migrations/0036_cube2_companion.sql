-- Cube 2.0: adopter conversations, per-member job states, the daily usage
-- counter, and the anonymous conversation view for contributors.
-- See docs/design/cube2-plan.md sections 2 and 4.
--
-- Conversations and messages use generic names (no playbook prefix) so they
-- can later serve a pathway too. Contributor chats are never stored.

-- ---------------------------------------------------------------------------
-- Job states: a reflection of what the adopter said, not a tracker.
-- No row = not discussed (no marker is shown).
-- ---------------------------------------------------------------------------

create table if not exists public.member_job_states (
  member_id uuid not null references public.playbook_members (id) on delete cascade,
  job_code text not null,
  state text not null check (state in ('discussed', 'in_progress', 'done', 'skipped')),
  note text not null default '' check (char_length(note) <= 300),
  set_by text not null check (set_by in ('cube', 'user')),
  updated_at timestamptz not null default now(),
  primary key (member_id, job_code)
);

-- A user's own correction is never overwritten by Cube: an update from Cube
-- onto a row the user set is silently skipped (so an upsert just no-ops).
create or replace function public.protect_user_job_state()
returns trigger
language plpgsql
as $$
begin
  if old.set_by = 'user' and new.set_by = 'cube' then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists member_job_states_protect_user on public.member_job_states;
create trigger member_job_states_protect_user
  before update on public.member_job_states
  for each row execute function public.protect_user_job_state();

alter table public.member_job_states enable row level security;

create policy "Users manage their own job states"
  on public.member_job_states for all
  using (exists (select 1 from public.playbook_members m where m.id = member_job_states.member_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.playbook_members m where m.id = member_job_states.member_id and m.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Conversations and messages (adopters only)
-- ---------------------------------------------------------------------------

create table if not exists public.companion_conversations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.playbook_members (id) on delete cascade,
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  -- What Cube knows about the adopter's situation (stage, location, what's
  -- done, their part). Copied into a new conversation on "Start a new
  -- conversation".
  context jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companion_conversations_member_idx
  on public.companion_conversations (member_id, updated_at desc);
create index if not exists companion_conversations_playbook_idx
  on public.companion_conversations (playbook_id, updated_at desc);

create table if not exists public.companion_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.companion_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- The parsed <ui_action> of an assistant message, so job cards re-render.
  ui jsonb,
  -- clock_timestamp so a user message and its reply, inserted in one
  -- transaction, still sort in order.
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists companion_messages_conversation_idx
  on public.companion_messages (conversation_id, created_at);

alter table public.companion_conversations enable row level security;
alter table public.companion_messages enable row level security;

-- Columns are qualified with the table name: playbook_members also has a
-- playbook_id, so an unqualified one would compare m.playbook_id to itself.
create policy "Users manage their own conversations"
  on public.companion_conversations for all
  using (exists (
    select 1 from public.playbook_members m
    where m.id = companion_conversations.member_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.playbook_members m
    where m.id = companion_conversations.member_id
      and m.user_id = auth.uid()
      and m.playbook_id = companion_conversations.playbook_id
  ));

create policy "Users manage messages in their own conversations"
  on public.companion_messages for all
  using (exists (
    select 1 from public.companion_conversations c
    join public.playbook_members m on m.id = c.member_id
    where c.id = companion_messages.conversation_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.companion_conversations c
    join public.playbook_members m on m.id = c.member_id
    where c.id = companion_messages.conversation_id and m.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- record_companion_turn: stores one completed turn atomically. SECURITY
-- INVOKER, so RLS still applies. Either the whole turn is stored (messages,
-- context patch, job states) or, on any error, nothing is.
-- p_user_text is null for the hidden first-visit kickoff turn.
-- p_context_patch: only the keys in companion_context_keys() are kept.
-- p_job_updates: [{job, state, note}]. An entry with an unknown job code (not
-- a job of this playbook) or a state outside the four allowed is skipped, so
-- one bad entry from the model never costs the user their turn.
-- ---------------------------------------------------------------------------

-- The only context keys stored and shown to contributors (spec: stage,
-- location, what's done so far, the adopter's part).
create or replace function public.companion_context_keys()
returns text[]
language sql
immutable
as $$ select array['stage', 'location', 'done', 'role_note'] $$;

create or replace function public.filter_companion_context(p jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end)
  where key = any (public.companion_context_keys());
$$;

create or replace function public.record_companion_turn(
  p_conversation_id uuid,
  p_user_text text,
  p_assistant_text text,
  p_ui jsonb default null,
  p_context_patch jsonb default '{}'::jsonb,
  p_job_updates jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member uuid;
  v_playbook uuid;
  v_u jsonb;
begin
  select member_id, playbook_id into v_member, v_playbook
  from public.companion_conversations
  where id = p_conversation_id;

  if v_member is null then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;

  if p_user_text is not null then
    insert into public.companion_messages (conversation_id, role, content)
    values (p_conversation_id, 'user', p_user_text);
  end if;

  insert into public.companion_messages (conversation_id, role, content, ui)
  values (p_conversation_id, 'assistant', p_assistant_text, p_ui);

  update public.companion_conversations
  set context = context || public.filter_companion_context(p_context_patch),
      updated_at = now()
  where id = p_conversation_id;

  for v_u in
    select value from jsonb_array_elements(
      case when jsonb_typeof(p_job_updates) = 'array' then p_job_updates else '[]'::jsonb end
    )
  loop
    continue when jsonb_typeof(v_u) <> 'object'
      or coalesce(v_u->>'state', '') not in ('discussed', 'in_progress', 'done', 'skipped')
      or not exists (
        select 1 from public.playbook_jobs j
        where j.playbook_id = v_playbook and j.job_code = v_u->>'job'
      );
    insert into public.member_job_states (member_id, job_code, state, note, set_by)
    values (v_member, v_u->>'job', v_u->>'state', left(coalesce(v_u->>'note', ''), 300), 'cube')
    on conflict (member_id, job_code) do update set
      state = excluded.state,
      note = excluded.note,
      set_by = 'cube';
  end loop;
end;
$$;

revoke execute on function public.record_companion_turn(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.record_companion_turn(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily usage counter (cost guard). The chat handler calls
-- bump_companion_usage() before every model call; it counts the call and
-- returns whether the user is still within the cap. Counted at call time,
-- so failed turns and direct API calls count too.
-- ---------------------------------------------------------------------------

create table if not exists public.companion_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('adopter', 'contributor')),
  day date not null default ((now() at time zone 'utc')::date),
  count int not null default 0,
  primary key (user_id, role, day)
);

alter table public.companion_usage enable row level security;

create policy "Users can view their own usage"
  on public.companion_usage for select
  using (user_id = auth.uid());

create or replace function public.bump_companion_usage(p_role text, p_cap int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_role not in ('adopter', 'contributor') then
    raise exception 'bad_role' using errcode = '22023';
  end if;

  insert into public.companion_usage (user_id, role, day, count)
  values (auth.uid(), p_role, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, role, day) do update set count = public.companion_usage.count + 1
  returning count into v_count;

  return v_count <= p_cap;
end;
$$;

revoke execute on function public.bump_companion_usage(text, int) from public, anon;
grant execute on function public.bump_companion_usage(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous conversation access for contributors. Both functions check the
-- caller contributes to the playbook the conversation belongs to, cover only
-- adopter members, label every adopter "User", and never return a user id,
-- name or email.
-- ---------------------------------------------------------------------------

create or replace function public.contributor_list_conversations(p_playbook_id uuid)
returns table (
  conversation_id uuid,
  label text,
  context jsonb,
  started_at timestamptz,
  updated_at timestamptz,
  message_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    'User'::text,
    public.filter_companion_context(c.context),
    c.started_at,
    c.updated_at,
    (select count(*) from public.companion_messages msg where msg.conversation_id = c.id)
  from public.companion_conversations c
  join public.playbook_members m on m.id = c.member_id
  where c.playbook_id = p_playbook_id
    and m.member_role = 'adopter'
    and public.is_playbook_contributor(p_playbook_id)
  order by c.updated_at desc;
$$;

create or replace function public.contributor_get_conversation(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'conversation_id', c.id,
    'playbook_id', c.playbook_id,
    'label', 'User',
    'context', public.filter_companion_context(c.context),
    'started_at', c.started_at,
    'updated_at', c.updated_at,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object('role', msg.role, 'content', msg.content, 'created_at', msg.created_at)
        order by msg.created_at
      )
      from public.companion_messages msg
      where msg.conversation_id = c.id
    ), '[]'::jsonb),
    'job_states', coalesce((
      select jsonb_agg(
        jsonb_build_object('job', s.job_code, 'state', s.state, 'note', s.note,
                           'set_by', s.set_by, 'updated_at', s.updated_at)
        order by s.job_code
      )
      from public.member_job_states s
      where s.member_id = c.member_id
    ), '[]'::jsonb)
  )
  from public.companion_conversations c
  join public.playbook_members m on m.id = c.member_id
  where c.id = p_conversation_id
    and m.member_role = 'adopter'
    and public.is_playbook_contributor(c.playbook_id);
$$;

revoke execute on function public.contributor_list_conversations(uuid) from public, anon;
revoke execute on function public.contributor_get_conversation(uuid) from public, anon;
grant execute on function public.contributor_list_conversations(uuid) to authenticated;
grant execute on function public.contributor_get_conversation(uuid) to authenticated;

-- Explicit table grants (see 0034). RLS still decides which rows.
grant select, insert, update, delete on public.member_job_states, public.companion_conversations,
  public.companion_messages to authenticated;
grant select on public.companion_usage to authenticated;
grant all on public.member_job_states, public.companion_conversations, public.companion_messages,
  public.companion_usage to service_role;
