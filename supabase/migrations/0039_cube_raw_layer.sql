-- Cube raw layer (raw-layer-spec.md): every document and every note stored as
-- passages that can be searched by keyword and by meaning, a per-use-case
-- allowlist, and descriptive metadata on use cases and journeys.
--
--   raw_sources           one row per uploaded document (Cube admin, Documents)
--   raw_source_journeys   optional journey links for a document, like notes'
--   raw_source_passages   everything searchable: a document gives many
--                         passages, a note gives one
--
-- Embeddings are 384-dim gte-small vectors from the `embed` Edge Function
-- (supabase/functions/embed). A passage is saved first without one, so
-- keyword search works at once; "Embed pending" fills them in later.
--
-- Access (enforced by the connector on every call, and here in the save
-- function):
--   read   on the use case's allowlist (use_case_members, read or write),
--          or the use case is open_to_all
--   write  on the allowlist with access = 'write'
-- Curators (a playbook's contributors) no longer get use-case access from
-- that: they're added to the allowlist like anyone else.
--
-- Same lockdown as 0038: RLS on, no policies, service role only.
--
-- Do NOT apply main's 0042 alongside this: it drops published_pathways.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Allowlist and metadata
-- ---------------------------------------------------------------------------

alter table public.use_case_members
  add column if not exists access text not null default 'write' check (access in ('read', 'write'));

alter table public.use_cases
  add column if not exists open_to_all boolean not null default false,
  add column if not exists objective text,
  add column if not exists problem text,
  add column if not exists users text,
  add column if not exists sector text,
  add column if not exists metadata_updated_at timestamptz;

-- The adopter's name is the existing `organisation` column.
alter table public.journeys
  add column if not exists geography text,
  add column if not exists scale_achieved text,
  add column if not exists impact_achieved text,
  add column if not exists metadata_updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table if not exists public.raw_sources (
  id uuid primary key default gen_random_uuid(),
  use_case_id uuid not null references public.use_cases (id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 300),
  content_hash text not null,
  full_text text not null,
  added_by_email text not null check (added_by_email = lower(added_by_email)),
  created_at timestamptz not null default now(),
  unique (use_case_id, content_hash)
);

create table if not exists public.raw_source_journeys (
  source_id uuid not null references public.raw_sources (id) on delete cascade,
  journey_id uuid not null references public.journeys (id) on delete restrict,
  primary key (source_id, journey_id)
);

create index if not exists raw_source_journeys_journey_idx on public.raw_source_journeys (journey_id);

-- Every journey linked to a document must belong to the document's use case.
create or replace function public.raw_source_journeys_same_use_case()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.raw_sources s
    join public.journeys j on j.use_case_id = s.use_case_id
    where s.id = new.source_id and j.id = new.journey_id
  ) then
    raise exception 'Journey % is not in this document''s use case.', new.journey_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists raw_source_journeys_same_use_case on public.raw_source_journeys;
create trigger raw_source_journeys_same_use_case
  before insert or update on public.raw_source_journeys
  for each row execute function public.raw_source_journeys_same_use_case();

-- ---------------------------------------------------------------------------
-- Passages
-- ---------------------------------------------------------------------------

create table if not exists public.raw_source_passages (
  id uuid primary key default gen_random_uuid(),
  use_case_id uuid not null references public.use_cases (id) on delete restrict,
  source_id uuid references public.raw_sources (id) on delete cascade,
  note_id uuid references public.cube_notes (id) on delete cascade,
  chunk_index int not null default 0 check (chunk_index >= 0),
  text text not null check (length(btrim(text)) > 0),
  fts tsvector,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  check (num_nonnulls(source_id, note_id) = 1),
  -- A note gives exactly one passage; a document's passages are numbered.
  unique (note_id),
  unique (source_id, chunk_index)
);

create index if not exists raw_source_passages_use_case_idx on public.raw_source_passages (use_case_id);
create index if not exists raw_source_passages_fts_idx on public.raw_source_passages using gin (fts);
create index if not exists raw_source_passages_embedding_idx
  on public.raw_source_passages using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists raw_source_passages_pending_idx
  on public.raw_source_passages (created_at) where embedding is null;

-- Keeps fts up to date, and takes use_case_id from the document or note, so a
-- passage can never sit in a different use case from what it came from.
create or replace function public.raw_source_passages_prepare()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_id is not null then
    select s.use_case_id into new.use_case_id from public.raw_sources s where s.id = new.source_id;
  elsif new.note_id is not null then
    select n.use_case_id into new.use_case_id from public.cube_notes n where n.id = new.note_id;
  end if;
  new.fts := to_tsvector('english', coalesce(new.text, ''));
  return new;
end;
$$;

drop trigger if exists raw_source_passages_prepare on public.raw_source_passages;
create trigger raw_source_passages_prepare
  before insert or update of text, source_id, note_id, use_case_id on public.raw_source_passages
  for each row execute function public.raw_source_passages_prepare();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Use cases a person can READ: on the allowlist (read or write), or open to
-- all. Redefined from 0038, where it also included curated playbooks' use
-- cases; cube_recent_notes and cube_search_notes use it, so they follow.
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
  select u.id
  from public.use_cases u
  where u.open_to_all;
$$;

-- Use cases a person can WRITE to: on the allowlist with write access.
create or replace function public.cube_writable_use_case_ids(p_email text)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select m.use_case_id
  from public.use_case_members m
  where m.email = lower(btrim(p_email))
    and m.access = 'write';
$$;

-- save_note, steps 1 and 2: as in 0038, except the author needs write access.
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

  -- Step 1: the author can write to the use case ...
  if not exists (select 1 from public.cube_writable_use_case_ids(v_email) u where u = p_use_case_id) then
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
                                 occurred_at, author_email, author_name)
  values (p_use_case_id, btrim(p_raw_text), p_channel, coalesce(p_source, 'conversation'),
          nullif(btrim(p_source_ref), ''), p_external_id, p_occurred_at, v_email, nullif(btrim(p_author_name), ''))
  returning id into v_id;

  insert into public.cube_note_journeys (note_id, journey_id)
  select v_id, g.id from unnest(v_journeys) as g(id);

  return query select v_id, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Search: reciprocal-rank fusion of full-text and vector rankings (the
-- pattern of main's 0042 match_pathway_units). A null p_embedding ranks by
-- full text alone (the fallback when the embed function is down). Full-text
-- ORs the query's words, so a long natural question still matches.
--
-- The note-only filters (journey aside) leave document passages out when
-- any is set. A journey filter keeps notes and documents linked to it. Every
-- filter is applied before ranking, so the limit counts matching passages.
-- ---------------------------------------------------------------------------

create or replace function public.cube_search_passages(
  p_query text,
  p_embedding extensions.vector(384),
  p_use_case_ids uuid[],
  p_limit int default 10,
  p_journey_id uuid default null,
  p_note_type text default null,
  p_outcome text default null,
  p_status text default null,
  p_author_email text default null,
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
      and (num_nonnulls(p_note_type, p_outcome, p_status, p_author_email) = 0
           or (p.note_id is not null
               and (p_note_type is null or nt.note_type = p_note_type)
               and (p_outcome is null or nt.outcome = p_outcome)
               and (p_status is null or nt.status = p_status)
               and (p_author_email is null or nt.author_email = lower(btrim(p_author_email)))))
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

-- "Embed pending": a passage for every note that doesn't have one yet (notes
-- saved before this migration, or whose passage insert failed). Returns how
-- many were added.
create or replace function public.cube_add_missing_note_passages()
returns int
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.raw_source_passages (use_case_id, note_id, chunk_index, text)
  select n.use_case_id, n.id, 0, n.raw_text
  from public.cube_notes n
  where not exists (select 1 from public.raw_source_passages p where p.note_id = n.id)
  on conflict (note_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The Documents page's list: each document with its passage counts and
-- journeys.
create or replace function public.cube_document_list()
returns table (
  id uuid,
  use_case_id uuid,
  title text,
  added_by_email text,
  created_at timestamptz,
  passages bigint,
  pending bigint,
  journeys text[]
)
language sql
stable
set search_path = public
as $$
  select s.id, s.use_case_id, s.title, s.added_by_email, s.created_at,
         (select count(*) from public.raw_source_passages p where p.source_id = s.id),
         (select count(*) from public.raw_source_passages p where p.source_id = s.id and p.embedding is null),
         coalesce((select array_agg(j.name order by j.name)
                   from public.raw_source_journeys l join public.journeys j on j.id = l.journey_id
                   where l.source_id = s.id), '{}')
  from public.raw_sources s
  order by s.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Lock down: service role only
-- ---------------------------------------------------------------------------

alter table public.raw_sources enable row level security;
alter table public.raw_source_journeys enable row level security;
alter table public.raw_source_passages enable row level security;

revoke all on public.raw_sources, public.raw_source_journeys, public.raw_source_passages from anon, authenticated;
grant all on public.raw_sources, public.raw_source_journeys, public.raw_source_passages to service_role;

revoke execute on function public.raw_source_journeys_same_use_case() from public, anon, authenticated;
revoke execute on function public.raw_source_passages_prepare() from public, anon, authenticated;
revoke execute on function public.cube_use_case_ids_for(text) from public, anon, authenticated;
revoke execute on function public.cube_writable_use_case_ids(text) from public, anon, authenticated;
revoke execute on function public.cube_save_note_raw(text, text, uuid, uuid[], text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.cube_search_passages(text, extensions.vector, uuid[], int, uuid, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.cube_add_missing_note_passages() from public, anon, authenticated;
revoke execute on function public.cube_document_list() from public, anon, authenticated;

grant execute on function public.cube_use_case_ids_for(text) to service_role;
grant execute on function public.cube_writable_use_case_ids(text) to service_role;
grant execute on function public.cube_save_note_raw(text, text, uuid, uuid[], text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.cube_search_passages(text, extensions.vector, uuid[], int, uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.cube_add_missing_note_passages() to service_role;
grant execute on function public.cube_document_list() to service_role;
