-- Pilot setup for the Cube connector (connector-contract.md, "Pilot setup").
-- Run in the DEVELOPMENT project's SQL editor after migrations 0038-0042.
-- Replace the names and emails; emails must be lower-case.
--
-- Access (0039, 0041):
--   read    on the use case's allowlist (use_case_members, any access), or
--           the use case is open_to_all
--   write   on the allowlist with access = 'write' or 'curate'
--   curate  on the allowlist with access = 'curate': write, plus editing the
--           use case's playbook and assets, and the Digest
-- Each use case has a URL name (slug) and at most one playbook.

-- One use case, with what it is for. The metadata fields are optional; new
-- notes and uploaded documents add to them (the latest source wins on a
-- conflict).
insert into public.use_cases (name, slug, description, objective, problem, users, sector, open_to_all)
values ('Test use case', 'test-use-case', 'For testing the Cube connector',
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

-- The allowlist. A member can write about any of the use case's journeys, or
-- a general note.
insert into public.use_case_members (use_case_id, email, access)
select u.id, m.email, m.access
from public.use_cases u,
     (values ('person.one@ekstep.org', 'write'),
             ('person.two@ekstep.org', 'read'),
             ('curator@ekstep.org', 'curate')) as m(email, access)
where u.name = 'Test use case'
on conflict (use_case_id, email) do update set access = excluded.access;

-- To let everyone who can use the connector read a use case (writing still
-- needs the allowlist):
-- update public.use_cases set open_to_all = true where name = 'Test use case';

-- The use case's playbook, optional and at most one. Anyone who can read the
-- use case sees it in the Cube app; its curators (access = 'curate', above)
-- edit it. To link an existing playbook instead:
-- update public.playbooks set use_case_id = (select id from public.use_cases where name = 'Test use case')
-- where slug = '<playbook slug>';
insert into public.playbooks (slug, title, use_case_id)
select 'connector-test', 'Connector test playbook', u.id
from public.use_cases u
where u.name = 'Test use case'
on conflict (slug) do nothing;

-- To change someone's access:
-- update public.use_case_members set access = 'read'   -- or 'write', 'curate'
-- where email = '<email>' and use_case_id = (select id from public.use_cases where name = 'Test use case');
