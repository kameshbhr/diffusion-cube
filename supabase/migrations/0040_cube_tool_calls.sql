-- Cube connector usage log: one row per tool call, for a usage dashboard
-- (who uses the connector, which tools, for which use cases, what they search
-- for, and whether it found anything).
--
-- Written by the connector (cube-connector/src/usage.ts) after every call,
-- including refused ones. Logging never blocks a tool call: if the insert
-- fails, the call still answers.
--
-- Search text (`query`) is people's own words and may name individuals or
-- local details. It is kept for 90 days and then blanked by
-- cube_purge_tool_call_queries(); the rest of the row (counts) stays. The
-- purge is scheduled daily with pg_cron where it's available (see the end of
-- this file); otherwise run `select public.cube_purge_tool_call_queries();`
-- from time to time.
--
-- Same lockdown as 0038/0039: RLS on, no policies, service role only.

create table if not exists public.cube_tool_calls (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now(),
  -- The caller's email (lower case). For a refused sign-in, the token's email
  -- if it has one, else 'user:<supabase user id>'.
  email text not null,
  tool text not null,
  -- The use case(s) the call was about: the one given or saved to, else every
  -- use case the caller could read at the time.
  use_case_ids uuid[] not null default '{}',
  -- What was searched for or asked (cube_search_notes' query,
  -- cube_log_question's question). Note text is not copied here: it's in
  -- cube_notes. Blanked after 90 days.
  query text check (query is null or length(query) <= 2000),
  -- Other inputs worth counting (filters, source_id and chunk range, ...).
  params jsonb not null default '{}',
  -- How many items came back (results, notes, passages, questions, people);
  -- 0 means nothing was found. Null when it doesn't apply.
  result_count int,
  ok boolean not null,
  -- For a failed or refused call, the message the caller saw (short).
  error text check (error is null or length(error) <= 500),
  duration_ms int
);

create index if not exists cube_tool_calls_called_at_idx on public.cube_tool_calls (called_at desc);
create index if not exists cube_tool_calls_email_idx on public.cube_tool_calls (email, called_at desc);
create index if not exists cube_tool_calls_tool_idx on public.cube_tool_calls (tool, called_at desc);
create index if not exists cube_tool_calls_use_cases_idx on public.cube_tool_calls using gin (use_case_ids);

-- Blanks search text older than 90 days. Returns how many rows it changed.
create or replace function public.cube_purge_tool_call_queries()
returns int
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  update public.cube_tool_calls
  set query = null
  where query is not null and called_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down: service role only
-- ---------------------------------------------------------------------------

alter table public.cube_tool_calls enable row level security;
revoke all on public.cube_tool_calls from anon, authenticated;
grant all on public.cube_tool_calls to service_role;

revoke execute on function public.cube_purge_tool_call_queries() from public, anon, authenticated;
grant execute on function public.cube_purge_tool_call_queries() to service_role;

-- ---------------------------------------------------------------------------
-- Daily purge with pg_cron, where the project has it. If pg_cron can't be
-- enabled here, this only prints a notice: schedule the purge another way.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available (%); schedule cube_purge_tool_call_queries() another way.', sqlerrm;
    return;
  end;
  if exists (select 1 from cron.job where jobname = 'cube-purge-tool-call-queries') then
    perform cron.unschedule('cube-purge-tool-call-queries');
  end if;
  perform cron.schedule('cube-purge-tool-call-queries', '30 20 * * *', 'select public.cube_purge_tool_call_queries()');
end;
$$;
