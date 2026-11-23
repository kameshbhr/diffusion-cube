-- Use cases as the primary entity, stage 1 (docs/design/cube-usecase-plan.md).
--
--   1. Access gets a third level: read | write | curate. `curate` replaces
--      the playbook contributor: write, plus editing the playbook and assets,
--      plus the Digest.
--   2. Every use case gets a URL name (slug).
--   3. One playbook per use case, and every playbook has one. A playbook with
--      no use case gets a new use case named after it, with the playbook's
--      slug.
--   4. Playbook members move onto the use case allowlist: contributors as
--      `curate`, adopters as `read`. Nobody is ever lowered.
--   5. Each playbook's detailed guidance (source_doc) is copied in as a
--      document of its use case, cut into passages without embeddings (press
--      "Embed pending" afterwards).
--   6. The connector's curator functions read `curate` instead of
--      playbook_members.
--
-- playbook_members, member_job_states, playbooks.source_doc and their row
-- rules stay for now: the web app keeps using them until stages 2-3, and
-- they're dropped in stage 7. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Access levels
-- ---------------------------------------------------------------------------

alter table public.use_case_members drop constraint if exists use_case_members_access_check;
alter table public.use_case_members
  add constraint use_case_members_access_check check (access in ('read', 'write', 'curate'));

-- ---------------------------------------------------------------------------
-- 2-3. Slugs, and one use case per playbook
-- ---------------------------------------------------------------------------

alter table public.use_cases add column if not exists slug text;

-- A playbook without a use case gets its own, named after it.
insert into public.use_cases (name, description, slug)
select p.title, nullif(p.description, ''), p.slug
from public.playbooks p
where p.use_case_id is null
on conflict (name) do nothing;

update public.playbooks p
set use_case_id = u.id
from public.use_cases u
where p.use_case_id is null and u.name = p.title;

-- Remaining use cases: a slug from the name, made unique with part of the id.
update public.use_cases u
set slug = coalesce(nullif(btrim(regexp_replace(lower(u.name), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'use-case')
where u.slug is null;

update public.use_cases u
set slug = u.slug || '-' || left(u.id::text, 6)
where exists (select 1 from public.use_cases o where o.slug = u.slug and o.id < u.id);

alter table public.use_cases alter column slug set not null;
alter table public.use_cases drop constraint if exists use_cases_slug_key;
alter table public.use_cases add constraint use_cases_slug_key unique (slug);
alter table public.use_cases drop constraint if exists use_cases_slug_check;
alter table public.use_cases add constraint use_cases_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]*$');

-- Fails here, naming the use case, if two playbooks share one: unlink one first.
alter table public.playbooks alter column use_case_id set not null;
alter table public.playbooks drop constraint if exists playbooks_use_case_id_key;
alter table public.playbooks add constraint playbooks_use_case_id_key unique (use_case_id);

-- ---------------------------------------------------------------------------
-- 4. Playbook members onto the allowlist
-- ---------------------------------------------------------------------------

insert into public.use_case_members (use_case_id, email, access)
select p.use_case_id,
       lower(btrim(u.email)),
       case when bool_or(pm.member_role = 'contributor') then 'curate' else 'read' end
from public.playbook_members pm
join public.playbooks p on p.id = pm.playbook_id
join auth.users u on u.id = pm.user_id
where u.email is not null and u.email like '%@%'
group by p.use_case_id, lower(btrim(u.email))
on conflict (use_case_id, email) do update
  set access = case
    when excluded.access = 'curate' then 'curate'
    else public.use_case_members.access
  end;

-- ---------------------------------------------------------------------------
-- 5. Detailed guidance → a document of the use case
-- ---------------------------------------------------------------------------

-- Passages of at most 1,600 characters, built from whole paragraphs where
-- they fit; a longer paragraph is cut at a space. (The app's chunkText also
-- overlaps passages; for authored markdown, paragraph breaks are enough.)
do $$
declare
  pb record;
  v_text text;
  v_source uuid;
  v_index int;
  v_buf text;
  v_para text;
  v_cut int;
  c_max constant int := 1600;
begin
  for pb in
    select p.title, p.use_case_id, p.source_doc from public.playbooks p where btrim(p.source_doc) <> ''
  loop
    v_text := btrim(replace(pb.source_doc, E'\r\n', E'\n'));
    insert into public.raw_sources (use_case_id, title, content_hash, full_text, added_by_email)
    values (pb.use_case_id, left(pb.title || ' – detailed guidance', 300),
            encode(sha256(convert_to(v_text, 'UTF8')), 'hex'), v_text, 'migration@cube')
    on conflict (use_case_id, content_hash) do nothing
    returning id into v_source;
    continue when v_source is null; -- already copied

    v_index := 0;
    v_buf := '';
    foreach v_para in array regexp_split_to_array(v_text, E'\n[ \t]*\n') loop
      v_para := btrim(v_para);
      continue when v_para = '';
      -- Flush the buffer when this paragraph won't fit with it.
      if v_buf <> '' and length(v_buf) + 2 + length(v_para) > c_max then
        insert into public.raw_source_passages (source_id, chunk_index, text) values (v_source, v_index, v_buf);
        v_index := v_index + 1;
        v_buf := '';
      end if;
      -- A paragraph longer than a passage is cut at a space.
      while length(v_para) > c_max loop
        v_cut := c_max - strpos(reverse(left(v_para, c_max)), ' ');
        if v_cut < c_max / 2 then v_cut := c_max; end if;
        insert into public.raw_source_passages (source_id, chunk_index, text)
        values (v_source, v_index, btrim(left(v_para, v_cut)));
        v_index := v_index + 1;
        v_para := btrim(substr(v_para, v_cut + 1));
      end loop;
      v_buf := case when v_buf = '' then v_para else v_buf || E'\n\n' || v_para end;
    end loop;
    if v_buf <> '' then
      insert into public.raw_source_passages (source_id, chunk_index, text) values (v_source, v_index, v_buf);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Access functions
-- ---------------------------------------------------------------------------

-- Write: on the allowlist with write or curate.
create or replace function public.cube_writable_use_case_ids(p_email text)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select m.use_case_id
  from public.use_case_members m
  where m.email = lower(btrim(p_email))
    and m.access in ('write', 'curate');
$$;

-- The playbooks this person curates: those of use cases where they have
-- curate. (0038 read playbook_members contributors through auth.users.)
create or replace function public.cube_curated_playbooks(p_email text)
returns table (playbook_id uuid, use_case_id uuid, title text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.use_case_id, p.title
  from public.use_case_members m
  join public.playbooks p on p.use_case_id = m.use_case_id
  where m.email = lower(btrim(p_email))
    and m.access = 'curate';
$$;

-- Everyone with curate on this use case, with its playbook's title.
create or replace function public.cube_use_case_curators(p_use_case_id uuid)
returns table (email text, playbooks text[])
language sql
stable
security invoker
set search_path = public
as $$
  select m.email,
         coalesce((select array_agg(p.title) from public.playbooks p where p.use_case_id = m.use_case_id), '{}')
  from public.use_case_members m
  where m.use_case_id = p_use_case_id
    and m.access = 'curate';
$$;
