-- =====================================================================
-- ScopeFlow — AI suggestions: daily allowance and audit history.
--
--   * ai_requests: one row per AI request (which task, which project, which provider answered,
--     whether it worked). No prompts or answers are stored: the AI only suggests, and the
--     freelancer's confirmed edits go through the normal functions and activity log.
--   * ai_begin(): called by the Worker with the user's own token before any model call. Checks the
--     project belongs to the caller (context isolation), enforces the daily allowance and starts the
--     audit row. ai_finish() closes it. ai_remaining() shows what's left today.
--   * The allowance protects the free Workers AI quota shared by everyone: 30 requests per account
--     per day (India time).
--
-- Safe to re-run. Rollback: supabase/rollback/20261119000000_ai_requests_down.sql
-- =====================================================================

create table if not exists public.ai_requests (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  task        text not null check (task in ('scope_draft', 'change_impact', 'assistant')),
  project_id  uuid references public.projects (id) on delete set null,
  provider    text check (char_length(provider) <= 80),
  ok          boolean,
  day         date not null default ((now() at time zone 'Asia/Kolkata')::date),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ai_requests_owner_day_idx on public.ai_requests (owner_id, day);

alter table public.ai_requests enable row level security;
drop policy if exists "own AI requests" on public.ai_requests;
create policy "own AI requests" on public.ai_requests for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ai_requests from public, anon, authenticated;
grant select on public.ai_requests to authenticated;

create or replace function public._ai_daily_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

create or replace function public.ai_remaining()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_used integer;
begin
  select count(*) into v_used from public.ai_requests where owner_id = v_uid and day = public._today_india();
  return greatest(public._ai_daily_limit() - v_used, 0);
end;
$$;

create or replace function public.ai_begin(p_task text, p_project_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_used integer;
  v_id uuid;
begin
  if p_task is null or p_task not in ('scope_draft', 'change_impact', 'assistant') then
    raise exception 'Unknown AI task' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id and owner_id = v_uid) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  -- One request at a time per account is enough to count fairly.
  perform pg_advisory_xact_lock(hashtextextended('ai:' || v_uid::text, 0));
  select count(*) into v_used from public.ai_requests where owner_id = v_uid and day = public._today_india();
  if v_used >= public._ai_daily_limit() then
    raise exception 'You''ve used today''s % AI suggestions. They reset at midnight (India time).', public._ai_daily_limit()
      using errcode = 'P0001', hint = 'limit';
  end if;
  insert into public.ai_requests (owner_id, task, project_id) values (v_uid, p_task, p_project_id) returning id into v_id;
  return jsonb_build_object('id', v_id, 'remaining', public._ai_daily_limit() - v_used - 1);
end;
$$;

create or replace function public.ai_finish(p_id uuid, p_provider text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_requests
     set provider = left(p_provider, 80), ok = coalesce(p_ok, false), finished_at = now()
   where id = p_id and owner_id = public._uid() and finished_at is null;
end;
$$;

revoke all on function public._ai_daily_limit(), public.ai_remaining(), public.ai_begin(text, uuid), public.ai_finish(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.ai_remaining(), public.ai_begin(text, uuid), public.ai_finish(uuid, text, boolean) to authenticated;
