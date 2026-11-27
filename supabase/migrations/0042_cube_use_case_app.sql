-- Use cases as the primary entity, stages 2-7 (docs/design/cube-usecase-plan.md).
-- Run after 0041.
--
--   1. Access functions the app's own session can use: a person's level on
--      a use case (read | write | curate) from the allowlist and open_to_all.
--   2. The playbook access functions (is_playbook_member,
--      is_playbook_contributor) now mean read and curate on the playbook's
--      use case, so every row rule built on them (playbooks, jobs, assets,
--      asset files, save_playbook, the Digest) follows the allowlist.
--   2b. People are stored by user id, never by email or name: notes,
--      documents, unanswered questions and the connector's usage log. Email
--      stays only on the allowlist. Names are looked up when shown, for
--      curators and admins only.
--   3. Conversations belong to a person and a use case, not a playbook
--      membership, and are either a reader's or a curator's chat. A turn's
--      unanswered question is also logged in cube_questions.
--   4. Curators browse a use case's conversations (anonymous, as before).
--   5. The Digest reads every conversation of the use case, curators'
--      included, plus connector searches aimed at this use case alone and
--      questions logged through Claude. Other searches are only counted.
--   6. Clean-up: job markers (member_job_states), playbook memberships
--      (playbook_members) and the playbook's own detailed guidance column
--      (playbooks.source_doc, copied into documents by 0041) are dropped.

-- ---------------------------------------------------------------------------
-- 1. Access
-- ---------------------------------------------------------------------------

-- The signed-in person's verified email, lower case; null if unverified.
create or replace function public.cube_auth_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(btrim(u.email)) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

-- The signed-in person's access to a use case: 'read', 'write', 'curate',
-- or null. Needs an approved account (at least one role), as the app does.
create or replace function public.cube_use_case_access(p_use_case_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.user_roles r where r.user_id = auth.uid()) then null
    else coalesce(
      (select m.access from public.use_case_members m
       where m.use_case_id = p_use_case_id and m.email = public.cube_auth_email()),
      (select 'read' from public.use_cases u where u.id = p_use_case_id and u.open_to_all)
    )
  end;
$$;

-- Whether the signed-in person has at least p_level on the use case.
create or replace function public.cube_can(p_use_case_id uuid, p_level text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_position(array['read', 'write', 'curate'], public.cube_use_case_access(p_use_case_id))
      >= array_position(array['read', 'write', 'curate'], p_level),
    false
  );
$$;

-- Every use case the signed-in person can read, with their access.
create or replace function public.cube_my_use_cases()
returns table (use_case_id uuid, access text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, a.access
  from public.use_cases u
  cross join lateral (select public.cube_use_case_access(u.id) as access) a
  where a.access is not null;
$$;

-- ---------------------------------------------------------------------------
-- 2. Playbook access follows the use case
-- ---------------------------------------------------------------------------

create or replace function public.is_playbook_member(p_playbook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.cube_can(p.use_case_id, 'read') from public.playbooks p where p.id = p_playbook_id), false);
$$;

create or replace function public.is_playbook_contributor(p_playbook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.cube_can(p.use_case_id, 'curate') from public.playbooks p where p.id = p_playbook_id), false);
$$;

drop policy if exists "Approved users can view listed playbooks" on public.playbooks;
drop policy if exists "Readers can view their use case's playbook" on public.playbooks;
create policy "Readers can view their use case's playbook"
  on public.playbooks for select
  using (public.is_playbook_member(id));

-- ---------------------------------------------------------------------------
-- 2b. People are stored by user id
-- ---------------------------------------------------------------------------
-- Activity records who did it by auth user id: notes (author_id), documents
-- (added_by), unanswered questions (asked_by) and the connector's usage log
-- (user_id). Email stays only on the allowlist (use_case_members), which
-- grants access before someone has an account. Names are looked up when
-- shown (cube_person_names), and only curators and admins see them.
--
-- Deleting an account removes the person's questions and usage-log rows;
-- their notes and documents stay, with no author.

-- A display name per user id: the account's name, else its email.
create or replace function public.cube_person_names(p_user_ids uuid[])
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id,
         coalesce(nullif(btrim(u.raw_user_meta_data->>'name'), ''),
                  nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
                  lower(u.email))
  from auth.users u
  where u.id = any (p_user_ids);
$$;

-- Notes --------------------------------------------------------------------

alter table public.cube_notes
  add column if not exists author_id uuid references auth.users (id) on delete set null;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cube_notes' and column_name = 'author_email') then
    update public.cube_notes n set author_id = u.id
    from auth.users u
    where lower(u.email) = n.author_email and n.author_id is null;
  end if;
end;
$$;

-- Origin columns never change once saved. author_id isn't one: it becomes
-- null when the author's account is deleted.
create or replace function public.cube_notes_keep_origin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.use_case_id, new.raw_text, new.channel, new.source, new.source_ref,
      new.external_id, new.occurred_at, new.created_at)
     is distinct from
     (old.use_case_id, old.raw_text, old.channel, old.source, old.source_ref,
      old.external_id, old.occurred_at, old.created_at) then
    raise exception 'A note''s origin fields can''t be changed.' using errcode = 'check_violation';
  end if;
  if new.author_id is not null and new.author_id is distinct from old.author_id then
    raise exception 'A note''s author can''t be changed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop function if exists public.cube_search_notes(text, text, uuid, uuid, text, text, text, timestamptz, timestamptz, text, int);
drop function if exists public.cube_recent_notes(text, timestamptz, timestamptz, uuid, uuid, text, int);
drop function if exists public.cube_save_note_raw(text, text, uuid, uuid[], text, text, text, text, text, timestamptz);
drop function if exists public.cube_search_passages(text, extensions.vector, uuid[], int, uuid, text, text, text, text, timestamptz, timestamptz);
drop function if exists public.cube_team_activity(uuid, timestamptz);
drop function if exists public.cube_document_list();

alter table public.cube_notes drop column if exists author_email, drop column if exists author_name;
create index if not exists cube_notes_author_id_idx on public.cube_notes (author_id, created_at desc);

-- save_note, steps 1 and 2: as in 0039, with the author's user id. Their
-- email (for the allowlist check) is read from the account, not stored.
create or replace function public.cube_save_note_raw(
  p_author_id uuid,
  p_use_case_id uuid,
  p_journey_ids uuid[],
  p_raw_text text,
  p_channel text,
  p_source text default 'conversation',
  p_source_ref text default null,
  p_external_id text default null,
  p_occurred_at timestamptz default null
)
returns table (note_id uuid, already_saved boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_journeys uuid[] := coalesce((select array_agg(distinct x) from unnest(p_journey_ids) as x where x is not null), '{}');
  v_existing uuid;
  v_id uuid;
begin
  if p_use_case_id is null then
    raise exception 'A use case is required.' using errcode = 'check_violation';
  end if;

  if p_external_id is not null then
    select n.id into v_existing from public.cube_notes n
    where n.channel = p_channel and n.external_id = p_external_id;
    if v_existing is not null then
      return query select v_existing, true;
      return;
    end if;
  end if;

  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = p_author_id and u.email_confirmed_at is not null;

  -- Step 1: the author can write to the use case ...
  if v_email is null
     or not exists (select 1 from public.cube_writable_use_case_ids(v_email) w where w = p_use_case_id) then
    raise exception 'You don''t have access to this use case. Please contact the admin.' using errcode = 'insufficient_privilege';
  end if;

  -- ... and every journey given is in it.
  if exists (
    select 1 from unnest(v_journeys) as g(id)
    where not exists (select 1 from public.journeys j where j.id = g.id and j.use_case_id = p_use_case_id)
  ) then
    raise exception 'Every journey must belong to the note''s use case.' using errcode = 'check_violation';
  end if;

  -- Step 2: insert the raw note and its links.
  insert into public.cube_notes (use_case_id, raw_text, channel, source, source_ref, external_id,
                                 occurred_at, author_id)
  values (p_use_case_id, btrim(p_raw_text), p_channel, coalesce(p_source, 'conversation'),
          nullif(btrim(p_source_ref), ''), p_external_id, p_occurred_at, p_author_id)
  returning id into v_id;

  insert into public.cube_note_journeys (note_id, journey_id)
  select v_id, g.id from unnest(v_journeys) as g(id);

  return query select v_id, false;
end;
$$;

-- Notes in a date range, newest first, in the given use cases (the caller's
-- readable ones, worked out by the connector). p_author_id: only that
-- person's notes.
create or replace function public.cube_recent_notes(
  p_use_case_ids uuid[],
  p_since timestamptz,
  p_until timestamptz default null,
  p_journey_id uuid default null,
  p_author_id uuid default null,
  p_limit int default 50
)
returns setof public.cube_notes
language sql
stable
set search_path = public
as $$
  select n.* from public.cube_notes n
  where n.use_case_id = any (p_use_case_ids)
    and (p_journey_id is null or exists (
          select 1 from public.cube_note_journeys l where l.note_id = n.id and l.journey_id = p_journey_id))
    and n.created_at >= p_since
    and (p_until is null or n.created_at < p_until)
    and (p_author_id is null or n.author_id = p_author_id)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Search: as in 0039, with p_author_id in place of p_author_email.
create or replace function public.cube_search_passages(
  p_query text,
  p_embedding extensions.vector(384),
  p_use_case_ids uuid[],
  p_limit int default 10,
  p_journey_id uuid default null,
  p_note_type text default null,
  p_outcome text default null,
  p_status text default null,
  p_author_id uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table (
  passage_id uuid,
  kind text,
  note_id uuid,
  source_id uuid,
  source_title text,
  chunk_index int,
  text text,
  use_case_id uuid,
  created_at timestamptz,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with
  q as (
    select case
      when coalesce(btrim(p_query), '') = '' then null
      else nullif(replace(plainto_tsquery('english', p_query)::text, '&', '|'), '')::tsquery
    end as tsq,
    least(greatest(coalesce(p_limit, 10), 1), 30) as n
  ),
  candidates as (
    select p.id, p.note_id, p.source_id, s.title as s_title, p.chunk_index, p.text, p.use_case_id,
           coalesce(nt.created_at, s.created_at, p.created_at) as at_time, p.fts, p.embedding
    from public.raw_source_passages p
    left join public.raw_sources s on s.id = p.source_id
    left join public.cube_notes nt on nt.id = p.note_id
    where p.use_case_id = any (p_use_case_ids)
      and (p_since is null or coalesce(nt.created_at, s.created_at, p.created_at) >= p_since)
      and (p_until is null or coalesce(nt.created_at, s.created_at, p.created_at) < p_until)
      and (p_journey_id is null
           or exists (select 1 from public.cube_note_journeys l where l.note_id = p.note_id and l.journey_id = p_journey_id)
           or exists (select 1 from public.raw_source_journeys l where l.source_id = p.source_id and l.journey_id = p_journey_id))
      and (num_nonnulls(p_note_type, p_outcome, p_status, p_author_id) = 0
           or (p.note_id is not null
               and (p_note_type is null or nt.note_type = p_note_type)
               and (p_outcome is null or nt.outcome = p_outcome)
               and (p_status is null or nt.status = p_status)
               and (p_author_id is null or nt.author_id = p_author_id)))
  ),
  full_text as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as rank_ix
    from candidates c, q
    where q.tsq is not null and c.fts @@ q.tsq
    order by rank_ix
    limit (select n * 2 from q)
  ),
  semantic as (
    select c.id, row_number() over (order by c.embedding <=> p_embedding) as rank_ix
    from candidates c
    where p_embedding is not null and c.embedding is not null
    order by rank_ix
    limit (select n * 2 from q)
  )
  select
    c.id,
    case when c.note_id is not null then 'note' else 'document' end,
    c.note_id, c.source_id, c.s_title, c.chunk_index, c.text, c.use_case_id, c.at_time,
    coalesce(1.0 / (50 + ft.rank_ix), 0.0) + coalesce(1.0 / (50 + sm.rank_ix), 0.0) as score
  from candidates c
  left join full_text ft on ft.id = c.id
  left join semantic sm on sm.id = c.id
  where ft.id is not null or sm.id is not null
  order by score desc, c.at_time desc
  limit (select n from q);
$$;

-- Team activity, for curators (the connector checks): one row per person on
-- the use case's allowlist, including people with no notes.
create or replace function public.cube_team_activity(
  p_use_case_id uuid,
  p_since timestamptz
)
returns table (
  name text,
  email text,
  access text,
  journeys text[],
  notes_in_period bigint,
  last_note_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with people as (
    select m.email, m.access, u.id as user_id
    from public.use_case_members m
    left join auth.users u on lower(u.email) = m.email
    where m.use_case_id = p_use_case_id
  )
  select
    (select pn.name from public.cube_person_names(array[p.user_id]) pn),
    p.email,
    p.access,
    coalesce((select array_agg(distinct j.name order by j.name)
              from public.cube_notes n
              join public.cube_note_journeys l on l.note_id = n.id
              join public.journeys j on j.id = l.journey_id
              where n.use_case_id = p_use_case_id and n.author_id = p.user_id), '{}'),
    (select count(*) from public.cube_notes n
     where n.use_case_id = p_use_case_id and n.author_id = p.user_id and n.created_at >= p_since),
    (select max(n.created_at) from public.cube_notes n
     where n.use_case_id = p_use_case_id and n.author_id = p.user_id)
  from people p
  order by 5 desc, p.email;
$$;

-- People's names now come from their accounts (cube_person_names).
drop table if exists public.cube_people;

-- Documents ----------------------------------------------------------------

alter table public.raw_sources
  add column if not exists added_by uuid references auth.users (id) on delete set null;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'raw_sources' and column_name = 'added_by_email') then
    update public.raw_sources s set added_by = u.id
    from auth.users u
    where lower(u.email) = s.added_by_email and s.added_by is null;
  end if;
end;
$$;

alter table public.raw_sources drop column if exists added_by_email;

-- The Documents page's list: each document with who added it (a user id;
-- the page shows a name to curators and admins only), its passage counts and
-- journeys.
create or replace function public.cube_document_list()
returns table (
  id uuid,
  use_case_id uuid,
  title text,
  added_by uuid,
  created_at timestamptz,
  passages bigint,
  pending bigint,
  journeys text[]
)
language sql
stable
set search_path = public
as $$
  select s.id, s.use_case_id, s.title, s.added_by, s.created_at,
         (select count(*) from public.raw_source_passages p where p.source_id = s.id),
         (select count(*) from public.raw_source_passages p where p.source_id = s.id and p.embedding is null),
         coalesce((select array_agg(j.name order by j.name)
                   from public.raw_source_journeys l join public.journeys j on j.id = l.journey_id
                   where l.source_id = s.id), '{}')
  from public.raw_sources s
  order by s.created_at desc;
$$;

-- Unanswered questions -------------------------------------------------------

alter table public.cube_questions
  add column if not exists asked_by uuid references auth.users (id) on delete cascade;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cube_questions' and column_name = 'asked_by_email') then
    update public.cube_questions q set asked_by = u.id
    from auth.users u
    where lower(u.email) = q.asked_by_email and q.asked_by is null;
  end if;
end;
$$;

alter table public.cube_questions drop column if exists asked_by_email, drop column if exists asked_by_name;

-- The connector's usage log ----------------------------------------------------

alter table public.cube_tool_calls
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cube_tool_calls' and column_name = 'email') then
    update public.cube_tool_calls t set user_id = u.id
    from auth.users u
    where t.user_id is null
      and (lower(u.email) = t.email or t.email = 'user:' || u.id::text);
    -- Rows of accounts that no longer exist can't be tied to anyone: dropped.
    delete from public.cube_tool_calls where user_id is null;
  end if;
end;
$$;

alter table public.cube_tool_calls drop column if exists email;
alter table public.cube_tool_calls alter column user_id set not null;
create index if not exists cube_tool_calls_user_idx on public.cube_tool_calls (user_id, called_at desc);

-- ---------------------------------------------------------------------------
-- 3. Conversations belong to a person and a use case
-- ---------------------------------------------------------------------------

alter table public.companion_conversations
  add column if not exists use_case_id uuid references public.use_cases (id) on delete cascade,
  add column if not exists user_id uuid references auth.users (id) on delete cascade,
  -- Which chat: a reader's (Converse for read and write) or a curator's (the
  -- playbook chat). Each chat lists and resumes only its own kind.
  add column if not exists kind text not null default 'reader' check (kind in ('reader', 'curator'));

drop policy if exists "Users manage their own conversations" on public.companion_conversations;
drop policy if exists "Users delete their own conversations" on public.companion_conversations;
drop policy if exists "Users manage messages in their own conversations" on public.companion_messages;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'companion_conversations' and column_name = 'member_id') then
    update public.companion_conversations c
    set use_case_id = p.use_case_id, user_id = m.user_id,
        kind = case when m.member_role = 'contributor' then 'curator' else 'reader' end
    from public.playbook_members m
    join public.playbooks p on p.id = m.playbook_id
    where m.id = c.member_id and c.use_case_id is null;
    alter table public.companion_conversations drop column member_id;
    alter table public.companion_conversations drop column playbook_id;
  end if;
end;
$$;

delete from public.companion_conversations where use_case_id is null or user_id is null;
alter table public.companion_conversations alter column use_case_id set not null;
alter table public.companion_conversations alter column user_id set not null;
alter table public.companion_conversations alter column user_id set default auth.uid();

create index if not exists companion_conversations_user_idx
  on public.companion_conversations (user_id, use_case_id, updated_at desc);
create index if not exists companion_conversations_use_case_idx
  on public.companion_conversations (use_case_id, updated_at desc);

-- People see and can always delete their own conversations (messages go with
-- them); starting or changing one, and its messages, need read access to the
-- use case.
drop policy if exists "Users see their own conversations" on public.companion_conversations;
drop policy if exists "Users start conversations they can read" on public.companion_conversations;
drop policy if exists "Users update their own conversations" on public.companion_conversations;

create policy "Users see their own conversations"
  on public.companion_conversations for select
  using (user_id = auth.uid());

create policy "Users delete their own conversations"
  on public.companion_conversations for delete
  using (user_id = auth.uid());

create policy "Users start conversations they can read"
  on public.companion_conversations for insert
  with check (user_id = auth.uid() and public.cube_can(use_case_id, 'read'));

create policy "Users update their own conversations"
  on public.companion_conversations for update
  using (user_id = auth.uid() and public.cube_can(use_case_id, 'read'))
  with check (user_id = auth.uid() and public.cube_can(use_case_id, 'read'));

create policy "Users manage messages in their own conversations"
  on public.companion_messages for all
  using (exists (
    select 1 from public.companion_conversations c
    where c.id = companion_messages.conversation_id and c.user_id = auth.uid()
      and public.cube_can(c.use_case_id, 'read')
  ))
  with check (exists (
    select 1 from public.companion_conversations c
    where c.id = companion_messages.conversation_id and c.user_id = auth.uid()
      and public.cube_can(c.use_case_id, 'read')
  ));

-- Questions logged from a web conversation point back to it, and go with it;
-- the connector's have none.
alter table public.cube_questions
  add column if not exists conversation_id uuid references public.companion_conversations (id) on delete cascade;

-- One completed turn, stored at once. No job markers any more; an unanswered
-- question (the reply's gap) is also logged in cube_questions, so curators
-- see web and connector questions in one list.
drop function if exists public.record_companion_turn(uuid, text, text, jsonb, jsonb, jsonb);

create or replace function public.record_companion_turn(
  p_conversation_id uuid,
  p_user_text text,
  p_assistant_text text,
  p_ui jsonb default null,
  p_context_patch jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_use_case uuid;
  v_user uuid;
  v_question text;
begin
  select use_case_id, user_id into v_use_case, v_user
  from public.companion_conversations
  where id = p_conversation_id;

  if v_use_case is null or v_user is distinct from auth.uid() or not public.cube_can(v_use_case, 'read') then
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

  v_question := left(btrim(case when jsonb_typeof(p_ui->'gap') = 'object' then p_ui->'gap'->>'question' end), 2000);
  if coalesce(v_question, '') <> '' then
    insert into public.cube_questions (use_case_id, question, asked_by, conversation_id)
    values (v_use_case, v_question, v_user, p_conversation_id);
  end if;
end;
$$;

revoke execute on function public.record_companion_turn(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_companion_turn(uuid, text, text, jsonb, jsonb) to authenticated;

-- The signed-in person's own recent conversations, for the sidebar: each with
-- its use case and first message. Only the kind the use case opens for them
-- now (a curator of a use case with a playbook gets the curator chat), so a
-- listed conversation always opens. (Use cases themselves are service-role
-- only, so the browser can't read them directly.)
create or replace function public.my_companion_conversations(p_limit int default 30)
returns table (
  conversation_id uuid,
  updated_at timestamptz,
  use_case_id uuid,
  use_case_slug text,
  use_case_name text,
  first_message text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.updated_at, u.id, u.slug, u.name,
         (select m.content from public.companion_messages m
          where m.conversation_id = c.id and m.role = 'user'
          order by m.created_at limit 1)
  from public.companion_conversations c
  join public.use_cases u on u.id = c.use_case_id
  where c.user_id = auth.uid()
    and public.cube_can(c.use_case_id, 'read')
    and c.kind = case
      when public.cube_can(c.use_case_id, 'curate')
           and exists (select 1 from public.playbooks p where p.use_case_id = c.use_case_id)
        then 'curator'
      else 'reader'
    end
  order by c.updated_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke execute on function public.my_companion_conversations(int) from public, anon;
grant execute on function public.my_companion_conversations(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Curators browse a use case's conversations (everyone labelled "User")
-- ---------------------------------------------------------------------------

drop function if exists public.contributor_list_conversations(uuid);
drop function if exists public.contributor_get_conversation(uuid);

create or replace function public.use_case_conversations(p_use_case_id uuid)
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
  select c.id, 'User'::text, public.filter_companion_context(c.context), c.started_at, c.updated_at,
         (select count(*) from public.companion_messages msg where msg.conversation_id = c.id)
  from public.companion_conversations c
  where c.use_case_id = p_use_case_id
    and (select public.cube_can(p_use_case_id, 'curate'))
  order by c.updated_at desc;
$$;

create or replace function public.use_case_conversation(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'conversation_id', c.id,
    'use_case_id', c.use_case_id,
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
    ), '[]'::jsonb)
  )
  from public.companion_conversations c
  where c.id = p_conversation_id
    and public.cube_can(c.use_case_id, 'curate');
$$;

revoke execute on function public.use_case_conversations(uuid) from public, anon;
revoke execute on function public.use_case_conversation(uuid) from public, anon;
grant execute on function public.use_case_conversations(uuid) to authenticated;
grant execute on function public.use_case_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Digest: curators of the playbook's use case; web conversations of
--    everyone plus the connector (searches and questions logged through
--    Claude). Connector entries share the conversation id 'connector'.
--    A connector search belongs to this use case only when it searched this
--    use case alone. Searches across several use cases, or none, are only
--    counted (connector_other_searches_period), never read or summarised.
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

drop function if exists public.contributor_job_state_counts(uuid);

create or replace function public.contributor_digest_stats(p_playbook_id uuid, p_days int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with uc as (
    select p.use_case_id as id from public.playbooks p where p.id = p_playbook_id
  ),
  conv as (
    select c.id, c.user_id
    from public.companion_conversations c, uc
    where c.use_case_id = uc.id
      and exists (
        select 1 from public.companion_messages um
        where um.conversation_id = c.id and um.role = 'user'
      )
  ),
  user_msgs as (
    select msg.conversation_id, conv.user_id, msg.created_at
    from public.companion_messages msg
    join conv on conv.id = msg.conversation_id
    where msg.role = 'user'
  ),
  ordered as (
    select msg.conversation_id, msg.role, msg.ui,
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
  ),
  period_searches as (
    select t.user_id, t.result_count, t.use_case_ids
    from public.cube_tool_calls t
    where t.tool = 'cube_search_notes' and t.ok
      and t.called_at >= now() - make_interval(days => p_days)
  ),
  searches as (
    select s.user_id, s.result_count
    from period_searches s, uc
    where s.use_case_ids = array[uc.id]
  ),
  other_searches as (
    select 1
    from period_searches s, uc
    where cardinality(s.use_case_ids) = 0
       or (cardinality(s.use_case_ids) > 1 and uc.id = any (s.use_case_ids))
  )
  select case
    when not public.can_run_digest(p_playbook_id) or p_days not in (7, 30) then null
    else jsonb_build_object(
      'users_total', (select count(distinct user_id) from conv),
      'users_period', (select count(distinct user_id) from user_msgs
                       where created_at >= now() - make_interval(days => p_days)),
      'conversations_total', (select count(*) from conv),
      'conversations_period', (select count(distinct conversation_id) from user_msgs
                               where created_at >= now() - make_interval(days => p_days)),
      'connector_searches_period', (select count(*) from searches),
      'connector_people_period', (select count(distinct user_id) from searches),
      'connector_found_nothing_period', (select count(*) from searches where result_count = 0),
      'connector_other_searches_period', (select count(*) from other_searches),
      'notes_period', (select count(*) from public.cube_notes n, uc
                       where n.use_case_id = uc.id and n.created_at >= now() - make_interval(days => p_days)),
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object('job', job_code, 'name', name, 'conversations', conversations)
                         order by conversations desc, position nulls last, job_code)
        from (select * from job_counts order by conversations desc, position nulls last, job_code limit 10) top
      ), '[]'::jsonb),
      -- Conversations that still exist, so a stored digest can drop deleted
      -- ones. 'connector' stands for everything that came through Claude.
      'conversation_ids', coalesce((select jsonb_agg(id::text) from conv), '[]'::jsonb) || '["connector"]'::jsonb
    )
  end;
$$;

-- The digest model's input for one period: the newest 400 things people
-- asked (their own messages to Cube in the app, and their searches through
-- Claude, aimed at this use case alone), and the questions Cube couldn't
-- answer in either. Each row carries a run-local person number (one per
-- account across both), never an id.
create or replace function public.contributor_digest_input(p_playbook_id uuid, p_days int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with uc as (
    select p.use_case_id as id from public.playbooks p where p.id = p_playbook_id
  ),
  conv as (
    select c.id, c.user_id
    from public.companion_conversations c, uc
    where c.use_case_id = uc.id
  ),
  web_msgs as (
    select msg.id::text as id, msg.conversation_id::text as conversation_id, conv.user_id, msg.role,
           case when msg.role = 'user' then msg.content end as content,
           case when msg.role = 'assistant' and jsonb_typeof(msg.ui) = 'object' then msg.ui->'gap' end as gap,
           msg.created_at
    from public.companion_messages msg
    join conv on conv.id = msg.conversation_id
    where msg.created_at >= now() - make_interval(days => p_days)
  ),
  connector_searches as (
    select 'S' || t.id as id, 'connector' as conversation_id, t.user_id, 'user' as role,
           '[searched through Claude] ' || t.query as content, null::jsonb as gap, t.called_at as created_at
    from public.cube_tool_calls t, uc
    where t.tool = 'cube_search_notes' and t.ok and t.query is not null
      and t.use_case_ids = array[uc.id]
      and t.called_at >= now() - make_interval(days => p_days)
  ),
  connector_gaps as (
    select 'Q' || q.id as id, 'connector' as conversation_id, q.asked_by as user_id, 'assistant' as role,
           null::text as content,
           jsonb_build_object('kind', 'not_covered', 'question', q.question, 'job', null, 'topic', 'asked through Claude') as gap,
           q.created_at
    from public.cube_questions q, uc
    where q.use_case_id = uc.id and q.conversation_id is null
      and q.created_at >= now() - make_interval(days => p_days)
  ),
  period_msgs as (
    select * from web_msgs union all select * from connector_searches union all select * from connector_gaps
  ),
  -- Numbered in random order on every call, so a number means nothing
  -- outside this one result and can't follow a person across runs.
  people as (
    select user_id, row_number() over (order by random()) as person
    from (select distinct user_id from period_msgs) d
  ),
  numbered as (
    select pm.*, pe.person from period_msgs pm join people pe on pe.user_id is not distinct from pm.user_id
  ),
  newest as (
    select * from numbered where role = 'user' and content is not null order by created_at desc limit 400
  )
  select case
    when not public.can_run_digest(p_playbook_id) or p_days not in (7, 30) then null
    else jsonb_build_object(
      'messages_total', (select count(*) from numbered where role = 'user' and content is not null),
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
        from numbered
        where role = 'assistant' and jsonb_typeof(gap) = 'object'
      ), '[]'::jsonb)
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Clean-up
-- ---------------------------------------------------------------------------

-- save_playbook without job markers or the detailed guidance (now a document).
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
    updated_at  = v_now,
    updated_by  = auth.uid()
  where id = p_playbook_id;

  if coalesce(array_length(p_removed_jobs, 1), 0) > 0 then
    delete from public.playbook_jobs
    where playbook_id = p_playbook_id and job_code = any (p_removed_jobs);
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

  select coalesce(overview->'credits', '[]'::jsonb)::text into v_credits
  from public.playbooks where id = p_playbook_id;

  if position('CC BY 4.0' in v_credits) = 0 or position('EkStep' in v_credits) = 0 then
    raise exception 'credits_attribution_missing' using errcode = 'P0422';
  end if;

  if exists (
    select 1 from public.playbooks
    where id = p_playbook_id
      and concat_ws(' ', title, description, overview::text, roles::text, sequence::text)
          ~* '\monly[\s ]+for[\s ]+author\M'
  ) or exists (
    select 1 from public.playbook_jobs
    where playbook_id = p_playbook_id
      and concat_ws(' ', name, body::text) ~* '\monly[\s ]+for[\s ]+author\M'
  ) then
    raise exception 'only_for_author_content' using errcode = 'P0423';
  end if;

  return v_now;
end;
$$;

drop table if exists public.member_job_states cascade;
drop function if exists public.protect_user_job_state() cascade;
drop table if exists public.playbook_members cascade;
alter table public.playbooks drop column if exists source_doc;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.cube_auth_email() from public, anon;
revoke execute on function public.cube_use_case_access(uuid) from public, anon;
revoke execute on function public.cube_can(uuid, text) from public, anon;
grant execute on function public.cube_auth_email() to authenticated, service_role;
grant execute on function public.cube_use_case_access(uuid) to authenticated, service_role;
grant execute on function public.cube_can(uuid, text) to authenticated, service_role;

revoke execute on function public.cube_my_use_cases() from public, anon;
grant execute on function public.cube_my_use_cases() to authenticated;

-- Section 2b's functions: the connector and the app's server (service role) only.
revoke execute on function public.cube_person_names(uuid[]) from public, anon, authenticated;
revoke execute on function public.cube_save_note_raw(uuid, uuid, uuid[], text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.cube_recent_notes(uuid[], timestamptz, timestamptz, uuid, uuid, int) from public, anon, authenticated;
revoke execute on function public.cube_search_passages(text, extensions.vector, uuid[], int, uuid, text, text, text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.cube_team_activity(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.cube_document_list() from public, anon, authenticated;
grant execute on function public.cube_person_names(uuid[]) to service_role;
grant execute on function public.cube_save_note_raw(uuid, uuid, uuid[], text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.cube_recent_notes(uuid[], timestamptz, timestamptz, uuid, uuid, int) to service_role;
grant execute on function public.cube_search_passages(text, extensions.vector, uuid[], int, uuid, text, text, text, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.cube_team_activity(uuid, timestamptz) to service_role;
grant execute on function public.cube_document_list() to service_role;
