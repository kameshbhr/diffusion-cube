-- Pilot setup for the Cube connector (connector-contract.md, "Pilot setup").
-- Run in the DEVELOPMENT project's SQL editor after migration 0038. Replace
-- the names and emails; emails must be lower-case.

-- One use case.
insert into public.use_cases (name, description)
values ('Test use case', 'For testing the Cube connector')
on conflict (name) do nothing;

-- Its journeys (one team's lived experience each).
insert into public.journeys (use_case_id, name, organisation, period_start)
select u.id, j.name, j.organisation, current_date
from public.use_cases u,
     (values ('Test journey A', 'Team A'),
             ('Test journey B', 'Team B')) as j(name, organisation)
where u.name = 'Test use case'
on conflict (use_case_id, name) do nothing;

-- Members of the use case. A member can write about any of its journeys, or a
-- general note.
insert into public.use_case_members (use_case_id, email)
select u.id, m.email
from public.use_cases u,
     (values ('person.one@ekstep.org'),
             ('person.two@ekstep.org')) as m(email)
where u.name = 'Test use case'
on conflict do nothing;

-- Curators: a playbook's contributors are its curators, and through
-- playbooks.use_case_id they curate (and belong to) that use case.
-- Here, a test playbook hidden from the Companion (listed = false) ...
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
