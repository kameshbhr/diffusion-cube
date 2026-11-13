-- Cube connector: team know-how captured from Claude and, later, other
-- channels (cube-connector/). Contract: cube-claude-kit/connector-contract.md
-- (version 2).
--
-- Every note belongs to one use case and links to any number of that use
-- case's journeys (lived experiences). A playbook may later be built from a
-- use case's notes, but nothing here can change a playbook.
--
-- Access: only the connector server reads and writes these tables, with the
-- service role. RLS is on with no policies, and anon/authenticated have no
-- grants, so the Cube app's own users can't reach them with the anon key.
-- The server sets the author from the signed-in token; Claude never does.
--
-- Version 1 of this migration (adoption_id, cube_members) held no notes, so
-- its objects are dropped and recreated rather than migrated.

drop function if exists public.cube_search_notes(text, text, text[], text, text, timestamptz, timestamptz, text, int);
drop function if exists public.cube_team_activity(text, timestamptz);
drop table if exists public.cube_note_journeys, public.cube_notes, public.cube_questions, public.cube_members cascade;
drop function if exists public.cube_notes_set_search_tsv();

-- Earlier drafts of this version had journey_members and a role on
-- use_case_members; both are gone (members belong to a use case only).
drop table if exists public.journey_members cascade;
do $$
begin
  if to_regclass('public.use_case_members') is not null then
    alter table public.use_case_members drop column if exists role;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who and what
-- ---------------------------------------------------------------------------

create table if not exists public.use_cases (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 200),
  description text,
  created_at timestamptz not null default now()
);

-- One lived experience of a use case, e.g. "Bihar DC, 2026".
create table if not exists public.journeys (
  id uuid primary key default gen_random_uuid(),
  use_case_id uuid not null references public.use_cases (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  organisation text,
  period_start date,
  period_end date,
  status text not null default 'active',
  -- For later: the Cube 1.0 published pathway written up from this journey.
  -- No foreign key yet.
  pathway_id uuid,
  created_at timestamptz not null default now(),
  unique (use_case_id, name)
);

create index if not exists journeys_use_case_idx on public.journeys (use_case_id);

-- Who belongs to a use case (assigned by an admin; SQL seed for the pilot).
-- A member can write about any of the use case's journeys, or a general note,
-- so membership isn't tied to a journey. Curators are not recorded here: a
-- playbook's curators are its contributors (playbook_members.member_role =
-- 'contributor'), and through playbooks.use_case_id they belong to that
-- playbook's use case.
create table if not exists public.use_case_members (
  use_case_id uuid not null references public.use_cases (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%@%'),
  added_at timestamptz not null default now(),
  primary key (use_case_id, email)
);

create index if not exists use_case_members_email_idx on public.use_case_members (email);

-- Filled in on a person's first tool call after connecting (sign-in happens in
-- the Cube app, which can't write these tables). Phone is for matching other
-- channels later.
create table if not exists public.cube_people (
  email text primary key check (email = lower(email)),
  name text,
  phone text,
  first_connected_at timestamptz not null default now()
);

-- A use case may have several playbooks (e.g. for different contexts), or
-- none yet. Nullable: playbooks made before use cases existed keep working
-- unchanged.
alter table public.playbooks
  add column if not exists use_case_id uuid references public.use_cases (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

create table if not exists public.cube_notes (
  id uuid primary key default gen_random_uuid(),

  -- Origin: set once by the channel, never changed (trigger below).
  use_case_id uuid not null references public.use_cases (id) on delete restrict,
  raw_text text not null check (length(btrim(raw_text)) between 1 and 8000),
  channel text not null check (channel in ('claude', 'whatsapp', 'email', 'web', 'meeting', 'import')),
  source text not null default 'conversation' check (source in ('conversation', 'nudge', 'document')),
  source_ref text check (source_ref is null or length(source_ref) <= 500),
  external_id text check (external_id is null or length(external_id) <= 500),
  occurred_at timestamptz,
  author_email text not null check (author_email = lower(author_email)),
  author_name text,
  created_at timestamptz not null default now(),

  -- Structured: written by the server's Claude API call; can be redone.
  note_type text check (note_type in ('learned', 'did', 'stuck')),
  title text check (title is null or length(btrim(title)) between 1 and 200),
  situation text,
  what_was_done text,
  how text,
  outcome text check (outcome in ('worked', 'did_not_work', 'mixed', 'too_early')),
  why text,
  what_to_do_next_time text,
  open_question text,
  topics text[] not null default '{}',
  structured_at timestamptz,

  -- Status: the server sets 'unstructured' and 'new'; Cube and the curator
  -- set the rest.
  status text not null default 'unstructured'
    check (status in ('unstructured', 'new', 'approved', 'superseded', 'disputed')),

  search_tsv tsvector,

  -- A message or meeting is saved once per channel.
  unique (channel, external_id)
);

create index if not exists cube_notes_use_case_created_idx on public.cube_notes (use_case_id, created_at desc);
create index if not exists cube_notes_author_idx on public.cube_notes (author_email, created_at desc);
create index if not exists cube_notes_search_idx on public.cube_notes using gin (search_tsv);
create index if not exists cube_notes_unstructured_idx on public.cube_notes (created_at) where status = 'unstructured';

-- Full-text vector, kept by a trigger (array_to_string isn't immutable, so a
-- generated column can't use it). Title and topics weigh most, then the raw
-- note, then the structured fields.
create or replace function public.cube_notes_set_search_tsv()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(coalesce(new.topics, '{}'), ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.raw_text, '')), 'B') ||
    setweight(to_tsvector('english',
      concat_ws(' ', new.situation, new.what_was_done, new.how, new.why,
                     new.what_to_do_next_time, new.open_question)), 'C');
  return new;
end;
$$;

drop trigger if exists cube_notes_search_tsv on public.cube_notes;
create trigger cube_notes_search_tsv
  before insert or update on public.cube_notes
  for each row execute function public.cube_notes_set_search_tsv();

-- Origin columns never change once saved.
create or replace function public.cube_notes_keep_origin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.use_case_id, new.raw_text, new.channel, new.source, new.source_ref,
      new.external_id, new.occurred_at, new.author_email, new.author_name, new.created_at)
     is distinct from
     (old.use_case_id, old.raw_text, old.channel, old.source, old.source_ref,
      old.external_id, old.occurred_at, old.author_email, old.author_name, old.created_at) then
    raise exception 'A note''s origin fields can''t be changed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists cube_notes_keep_origin on public.cube_notes;
create trigger cube_notes_keep_origin
  before update on public.cube_notes
  for each row execute function public.cube_notes_keep_origin();

-- ---------------------------------------------------------------------------
-- Note ↔ journey links
-- ---------------------------------------------------------------------------

create table if not exists public.cube_note_journeys (
  note_id uuid not null references public.cube_notes (id) on delete cascade,
  journey_id uuid not null references public.journeys (id) on delete restrict,
  primary key (note_id, journey_id)
);

create index if not exists cube_note_journeys_journey_idx on public.cube_note_journeys (journey_id);

-- Every journey linked to a note must belong to the note's use case.
create or replace function public.cube_note_journeys_same_use_case()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.cube_notes n
    join public.journeys j on j.use_case_id = n.use_case_id
    where n.id = new.note_id and j.id = new.journey_id
  ) then
    raise exception 'Journey % is not in this note''s use case.', new.journey_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists cube_note_journeys_same_use_case on public.cube_note_journeys;
create trigger cube_note_journeys_same_use_case
  before insert or update on public.cube_note_journeys
  for each row execute function public.cube_note_journeys_same_use_case();

-- ---------------------------------------------------------------------------
-- Questions the Cube couldn't answer
-- ---------------------------------------------------------------------------

create table if not exists public.cube_questions (
  id uuid primary key default gen_random_uuid(),
  use_case_id uuid not null references public.use_cases (id) on delete restrict,
  question text not null check (length(btrim(question)) between 1 and 2000),
  asked_by_email text not null check (asked_by_email = lower(asked_by_email)),
  asked_by_name text,
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);

create index if not exists cube_questions_open_idx
  on public.cube_questions (use_case_id, created_at desc) where not resolved;

-- ---------------------------------------------------------------------------
-- Lock down: service role only
-- ---------------------------------------------------------------------------

alter table public.use_cases enable row level security;
alter table public.journeys enable row level security;
alter table public.use_case_members enable row level security;
alter table public.cube_people enable row level security;
alter table public.cube_notes enable row level security;
alter table public.cube_note_journeys enable row level security;
alter table public.cube_questions enable row level security;

revoke all on public.use_cases, public.journeys, public.use_case_members,
  public.cube_people, public.cube_notes, public.cube_note_journeys, public.cube_questions
  from anon, authenticated;
grant all on public.use_cases, public.journeys, public.use_case_members,
  public.cube_people, public.cube_notes, public.cube_note_journeys, public.cube_questions
  to service_role;

-- ---------------------------------------------------------------------------
-- Curators: a playbook's contributors (assigned in the Cube admin panel's
-- "Playbook contributors"). playbook_members holds user ids, so these match
-- them to emails through auth.users. Security definer, because the service
-- role can't read auth.users directly; execute is granted to service_role
-- only.
-- ---------------------------------------------------------------------------

-- Playbooks (linked to a use case) that this person curates.
create or replace function public.cube_curated_playbooks(p_email text)
returns table (playbook_id uuid, use_case_id uuid, title text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.id, p.use_case_id, p.title
  from public.playbook_members pm
  join public.playbooks p on p.id = pm.playbook_id
  join auth.users u on u.id = pm.user_id
  where pm.member_role = 'contributor'
    and p.use_case_id is not null
    and lower(u.email) = lower(btrim(p_email));
$$;

-- Everyone who curates a playbook of this use case.
create or replace function public.cube_use_case_curators(p_use_case_id uuid)
returns table (email text, playbooks text[])
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(u.email), array_agg(distinct p.title order by p.title)
  from public.playbook_members pm
  join public.playbooks p on p.id = pm.playbook_id
  join auth.users u on u.id = pm.user_id
  where pm.member_role = 'contributor'
    and p.use_case_id = p_use_case_id
    and u.email is not null
  group by lower(u.email);
$$;

-- ---------------------------------------------------------------------------
-- A person's use cases: their memberships, and those of the playbooks they
-- curate.
-- ---------------------------------------------------------------------------

create or replace function public.cube_use_case_ids_for(p_email text)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select m.use_case_id
  from public.use_case_members m
  where m.email = lower(btrim(p_email))
  union
  select c.use_case_id
  from public.cube_curated_playbooks(p_email) c;
$$;

-- ---------------------------------------------------------------------------
-- save_note, steps 1 and 2 (the contract's shared save function). Every
-- channel calls this: it checks membership and journeys, then inserts the raw
-- note as 'unstructured' with its journey links, in one transaction. The
-- channel's code then structures it (step 3) and calls cube_apply_structure.
--
-- Saving the same (channel, external_id) again returns the existing note
-- with already_saved = true, so a resent WhatsApp message isn't saved twice.
-- ---------------------------------------------------------------------------

create or replace function public.cube_save_note_raw(
  p_author_email text,
  p_author_name text,
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
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_author_email));
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

  -- Step 1: the author belongs to the use case ...
  if not exists (select 1 from public.cube_use_case_ids_for(v_email) u where u = p_use_case_id) then
    raise exception 'You can only add notes to a use case you belong to.' using errcode = 'insufficient_privilege';
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
                                 occurred_at, author_email, author_name)
  values (p_use_case_id, btrim(p_raw_text), p_channel, coalesce(p_source, 'conversation'),
          nullif(btrim(p_source_ref), ''), p_external_id, p_occurred_at, v_email, nullif(btrim(p_author_name), ''))
  returning id into v_id;

  insert into public.cube_note_journeys (note_id, journey_id)
  select v_id, g.id from unnest(v_journeys) as g(id);

  return query select v_id, false;
end;
$$;

-- Links a journey the server inferred from the note's text, only if the note
-- has no journey yet (a note whose author named journeys is left alone). The
-- link trigger still checks the journey is in the note's use case.
create or replace function public.cube_link_inferred_journey(p_note_id uuid, p_journey_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.cube_note_journeys l where l.note_id = p_note_id) then
    return false;
  end if;
  insert into public.cube_note_journeys (note_id, journey_id) values (p_note_id, p_journey_id)
  on conflict do nothing;
  return true;
end;
$$;

-- Step 4: write the structured fields. An 'unstructured' note becomes 'new';
-- a note the curator already reviewed keeps its status when re-structured.
create or replace function public.cube_apply_structure(
  p_note_id uuid,
  p_note_type text,
  p_title text,
  p_situation text,
  p_what_was_done text,
  p_how text,
  p_outcome text,
  p_why text,
  p_what_to_do_next_time text,
  p_open_question text,
  p_topics text[]
)
returns void
language sql
set search_path = public
as $$
  update public.cube_notes set
    note_type = p_note_type,
    title = p_title,
    situation = p_situation,
    what_was_done = p_what_was_done,
    how = p_how,
    outcome = p_outcome,
    why = p_why,
    what_to_do_next_time = p_what_to_do_next_time,
    open_question = p_open_question,
    topics = coalesce(p_topics, '{}'),
    structured_at = now(),
    status = case when status = 'unstructured' then 'new' else status end
  where id = p_note_id;
$$;

-- ---------------------------------------------------------------------------
-- Search (version 1: Postgres full-text plus filters), scoped to the caller's
-- use cases.
--
-- Words are OR-ed, not AND-ed, so a note matches if it shares any meaningful
-- word with the question; ranking puts notes that share more words first.
-- "-word" exclusions are dropped first (OR-ing a negation would match almost
-- everything). Quoted phrases still match as phrases. Falls back to a plain
-- substring match on title/raw text when the query has no searchable words.
-- ---------------------------------------------------------------------------

create or replace function public.cube_search_notes(
  p_caller_email text,
  p_query text,
  p_use_case_id uuid default null,
  p_journey_id uuid default null,
  p_note_type text default null,
  p_outcome text default null,
  p_status text default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_author_email text default null,
  p_limit int default 10
)
returns setof public.cube_notes
language plpgsql
stable
set search_path = public
as $$
declare
  v_tsq tsquery;
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 30);
  v_query text := regexp_replace(coalesce(p_query, ''), '(^|\s)-("[^"]*"|\S+)', ' ', 'g');
  -- Escape LIKE wildcards so the fallback is a literal substring match.
  v_like text := '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_scope uuid[] := array(select public.cube_use_case_ids_for(p_caller_email));
begin
  begin
    v_tsq := replace(websearch_to_tsquery('english', v_query)::text, ' & ', ' | ')::tsquery;
  exception when others then
    v_tsq := plainto_tsquery('english', v_query);
  end;

  return query
    select n.* from public.cube_notes n
    where n.use_case_id = any (v_scope)
      and (p_use_case_id is null or n.use_case_id = p_use_case_id)
      and (p_journey_id is null or exists (
            select 1 from public.cube_note_journeys l where l.note_id = n.id and l.journey_id = p_journey_id))
      and (case when v_tsq is null or numnode(v_tsq) = 0
                then (n.title ilike v_like or n.raw_text ilike v_like)
                else n.search_tsv @@ v_tsq end)
      and (p_note_type is null or n.note_type = p_note_type)
      and (p_outcome is null or n.outcome = p_outcome)
      and (p_status is null or n.status = p_status)
      and (p_since is null or n.created_at >= p_since)
      and (p_until is null or n.created_at < p_until)
      and (p_author_email is null or n.author_email = lower(btrim(p_author_email)))
    order by (case when v_tsq is null or numnode(v_tsq) = 0 then 0
                   else ts_rank_cd(n.search_tsv, v_tsq) end) desc,
             n.created_at desc
    limit v_limit;
end;
$$;

-- Notes in a date range, newest first, scoped to the caller's use cases.
create or replace function public.cube_recent_notes(
  p_caller_email text,
  p_since timestamptz,
  p_until timestamptz default null,
  p_use_case_id uuid default null,
  p_journey_id uuid default null,
  p_author_email text default null,
  p_limit int default 50
)
returns setof public.cube_notes
language sql
stable
set search_path = public
as $$
  select n.* from public.cube_notes n
  where n.use_case_id in (select public.cube_use_case_ids_for(p_caller_email))
    and (p_use_case_id is null or n.use_case_id = p_use_case_id)
    and (p_journey_id is null or exists (
          select 1 from public.cube_note_journeys l where l.note_id = n.id and l.journey_id = p_journey_id))
    and n.created_at >= p_since
    and (p_until is null or n.created_at < p_until)
    and (p_author_email is null or n.author_email = lower(btrim(p_author_email)))
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- Team activity: one row per person in a use case (its members and the
-- curators of its playbooks), including people with zero notes.
-- ---------------------------------------------------------------------------

create or replace function public.cube_team_activity(
  p_use_case_id uuid,
  p_since timestamptz
)
returns table (
  name text,
  email text,
  journeys text[],
  notes_in_period bigint,
  last_note_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with people as (
    select m.email from public.use_case_members m where m.use_case_id = p_use_case_id
    union
    select c.email from public.cube_use_case_curators(p_use_case_id) c
  )
  select
    coalesce(cp.name, (select n2.author_name from public.cube_notes n2
                       where n2.author_email = p.email and n2.author_name is not null
                       order by n2.created_at desc limit 1)) as name,
    p.email,
    -- The journeys this person has written about in this use case.
    coalesce((select array_agg(distinct j.name order by j.name)
              from public.cube_notes n
              join public.cube_note_journeys l on l.note_id = n.id
              join public.journeys j on j.id = l.journey_id
              where n.use_case_id = p_use_case_id and n.author_email = p.email), '{}') as journeys,
    (select count(*) from public.cube_notes n
     where n.use_case_id = p_use_case_id and n.author_email = p.email and n.created_at >= p_since) as notes_in_period,
    (select max(n.created_at) from public.cube_notes n
     where n.use_case_id = p_use_case_id and n.author_email = p.email) as last_note_at
  from people p
  left join public.cube_people cp on cp.email = p.email
  order by notes_in_period desc, p.email;
$$;

-- ---------------------------------------------------------------------------
-- Functions: service role only
-- ---------------------------------------------------------------------------

revoke execute on function public.cube_notes_set_search_tsv() from public, anon, authenticated;
revoke execute on function public.cube_notes_keep_origin() from public, anon, authenticated;
revoke execute on function public.cube_note_journeys_same_use_case() from public, anon, authenticated;
revoke execute on function public.cube_curated_playbooks(text) from public, anon, authenticated;
revoke execute on function public.cube_use_case_curators(uuid) from public, anon, authenticated;
revoke execute on function public.cube_use_case_ids_for(text) from public, anon, authenticated;
revoke execute on function public.cube_save_note_raw(text, text, uuid, uuid[], text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.cube_link_inferred_journey(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cube_apply_structure(uuid, text, text, text, text, text, text, text, text, text, text[]) from public, anon, authenticated;
revoke execute on function public.cube_search_notes(text, text, uuid, uuid, text, text, text, timestamptz, timestamptz, text, int) from public, anon, authenticated;
revoke execute on function public.cube_recent_notes(text, timestamptz, timestamptz, uuid, uuid, text, int) from public, anon, authenticated;
revoke execute on function public.cube_team_activity(uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.cube_curated_playbooks(text) to service_role;
grant execute on function public.cube_use_case_curators(uuid) to service_role;
grant execute on function public.cube_use_case_ids_for(text) to service_role;
grant execute on function public.cube_save_note_raw(text, text, uuid, uuid[], text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.cube_link_inferred_journey(uuid, uuid) to service_role;
grant execute on function public.cube_apply_structure(uuid, text, text, text, text, text, text, text, text, text, text[]) to service_role;
grant execute on function public.cube_search_notes(text, text, uuid, uuid, text, text, text, timestamptz, timestamptz, text, int) to service_role;
grant execute on function public.cube_recent_notes(text, timestamptz, timestamptz, uuid, uuid, text, int) to service_role;
grant execute on function public.cube_team_activity(uuid, timestamptz) to service_role;
