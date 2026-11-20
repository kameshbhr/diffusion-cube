-- Pilot setup for the Cube connector (connector-contract.md, "Pilot setup").
-- Run in the DEVELOPMENT project's SQL editor after migrations 0038 and 0039.
-- Replace the names and emails; emails must be lower-case.
--
-- Access (0039):
--   read   on the use case's allowlist (use_case_members, read or write
--          access), or the use case is open_to_all
--   write  on the allowlist with access = 'write'
-- Curating a playbook gives no access to its use case: add curators to the
-- allowlist like anyone else.

-- One use case, with what it is for. The metadata fields are optional; new
-- notes and uploaded documents add to them (the latest source wins on a
-- conflict).
insert into public.use_cases (name, description, objective, problem, users, sector, open_to_all)
values ('Test use case', 'For testing the Cube connector',
        'Test objective', 'Test problem', 'Test users', 'Test sector', false)
on conflict (name) do nothing;

-- Its journeys (one team's lived experience each). organisation is the
-- adopter's name.
insert into public.journeys (use_case_id, name, organisation, geography, period_start)
select u.id, j.name, j.organisation, j.geography, current_date
from public.use_cases u,
     (values ('Test journey A', 'Team A', 'District A'),
             ('Test journey B', 'Team B', 'District B')) as j(name, organisation, geography)
where u.name = 'Test use case'
on conflict (use_case_id, name) do nothing;

-- The allowlist. 'write' can add notes and search; 'read' can only search and
-- read. A member can write about any of the use case's journeys, or a general
-- note.
insert into public.use_case_members (use_case_id, email, access)
select u.id, m.email, m.access
from public.use_cases u,
     (values ('person.one@ekstep.org', 'write'),
             ('person.two@ekstep.org', 'read'),
             ('curator@ekstep.org', 'write')) as m(email, access)
where u.name = 'Test use case'
on conflict (use_case_id, email) do update set access = excluded.access;

-- To let everyone who can use the connector read a use case (writing still
-- needs the allowlist):
-- update public.use_cases set open_to_all = true where name = 'Test use case';

-- Curators: a playbook's contributors are its curators. That is for updating
-- the playbook only; it gives no access to the use case's notes (the curator
-- above is on the allowlist for that). Here, a test playbook hidden from the
-- Companion (listed = false) ...
insert into public.playbooks (slug, title, listed, use_case_id)
select 'connector-test', 'Connector test playbook', false, u.id
from public.use_cases u
where u.name = 'Test use case'
on conflict (slug) do nothing;

-- ... and its curator, who must already have a Cube account. (Contributors
-- can also be added in the Cube admin panel, "Playbook contributors".)
insert into public.playbook_members (user_id, playbook_id, member_role)
select u.id, p.id, 'contributor'
from auth.users u, public.playbooks p
where lower(u.email) = 'curator@ekstep.org' and p.slug = 'connector-test'
on conflict (user_id, playbook_id) do update set member_role = 'contributor';

-- To link an existing playbook instead:
-- update public.playbooks set use_case_id = (select id from public.use_cases where name = 'Test use case')
-- where slug = '<playbook slug>';

-- Existing members from 0038 got access = 'write' by default. To make one
-- read-only:
-- update public.use_case_members set access = 'read'
-- where email = '<email>' and use_case_id = (select id from public.use_cases where name = 'Test use case');
