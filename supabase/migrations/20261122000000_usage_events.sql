-- =====================================================================
-- T2-11: two counts for later reading, with nothing personal in them.
--
--   limit_hit      (detail: active_projects | clients)   a Free account met a plan limit
--   checkout_open  (detail: limit | pricing | plan)      someone pressed Upgrade and Razorpay opened
--
-- usage_events holds only the account id, the event, one of the fixed details above and the time:
-- no names, emails, amounts or free text. Private to the owner; written only through
-- log_usage_event(). The owner of ScopeFlow reads totals in the SQL editor:
--   select * from public.admin_usage_counts();
--
-- (20261119000000 is left free for the AI layer.) Safe to re-run.
-- Rollback: supabase/rollback/20261122000000_usage_events_down.sql
-- =====================================================================
begin;

create table if not exists public.usage_events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  event       text not null check (event in ('limit_hit', 'checkout_open')),
  detail      text not null,
  created_at  timestamptz not null default now(),
  check ((event = 'limit_hit' and detail in ('active_projects', 'clients'))
      or (event = 'checkout_open' and detail in ('limit', 'pricing', 'plan')))
);
create index if not exists usage_events_owner_idx on public.usage_events (owner_id, created_at desc);
create index if not exists usage_events_event_idx on public.usage_events (event, created_at desc);

alter table public.usage_events enable row level security;
drop policy if exists "own usage events" on public.usage_events;
create policy "own usage events" on public.usage_events for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.usage_events from public, anon, authenticated;
grant select on public.usage_events to authenticated;

-- Records one event for the signed-in account. Quietly does nothing past 50 a day per account.
create or replace function public.log_usage_event(p_event text, p_detail text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not ((p_event = 'limit_hit' and p_detail in ('active_projects', 'clients'))
       or (p_event = 'checkout_open' and p_detail in ('limit', 'pricing', 'plan'))) then
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  if (select count(*) from public.usage_events where owner_id = v_uid and created_at > now() - interval '1 day') >= 50 then
    return false;
  end if;
  insert into public.usage_events (owner_id, event, detail) values (v_uid, p_event, p_detail);
  return true;
end;
$$;

-- Admin only, from the Supabase SQL editor:  select * from public.admin_usage_counts();
create or replace function public.admin_usage_counts()
returns table (event text, detail text, last_7_days bigint, last_30_days bigint, all_time bigint, accounts bigint)
language sql
stable
security definer
set search_path = ''
as $$
select e.event, e.detail,
       count(*) filter (where e.created_at > now() - interval '7 days'),
       count(*) filter (where e.created_at > now() - interval '30 days'),
       count(*),
       count(distinct e.owner_id)
  from public.usage_events e
 group by 1, 2
 order by 1, 2;
$$;

revoke all on function public.admin_usage_counts() from public, anon, authenticated, service_role;
revoke all on function public.log_usage_event(text, text) from public, anon, authenticated;
grant execute on function public.log_usage_event(text, text) to authenticated;

commit;
