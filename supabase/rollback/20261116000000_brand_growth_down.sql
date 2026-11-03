-- Rollback for brand & growth (20261116000000_brand_growth.sql).
-- Restores the previous expense and plan functions and removes the sign-up source columns and view.
-- Kept: the corrected surname and the SAC codes already saved. Safe to re-run.
begin;
drop trigger if exists blog_posts_unique_meta on public.blog_posts;
drop function if exists public._blog_unique_meta();
drop function if exists public.admin_signup_sources();
drop function if exists public.set_signup_source(jsonb);
alter table public.profiles
  drop column if exists signup_utm_source,
  drop column if exists signup_utm_medium,
  drop column if exists signup_utm_campaign,
  drop column if exists signup_referrer;
alter table public.profiles alter column sac_code drop default;
create or replace function public.add_expense(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_project uuid := nullif(p ->> 'project_id', '')::uuid;
  v_date date := nullif(p ->> 'spent_on', '')::date;
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint;
  v_currency text := upper(nullif(trim(coalesce(p ->> 'currency', '')), ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_date is null or v_date > current_date + 1 then
    raise exception 'Enter the date of the expense (not in the future)' using errcode = '22023';
  end if;
  if v_amount is null or v_amount < 1 then
    raise exception 'Enter an amount greater than zero' using errcode = '22023';
  end if;
  if v_project is not null and not exists (select 1 from public.projects where id = v_project and owner_id = v_uid) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_currency is null then
    select coalesce(default_currency, 'INR') into v_currency from public.profiles where id = v_uid;
  end if;
  insert into public.expenses (owner_id, project_id, spent_on, category, description, amount_cents, currency)
  values (v_uid, v_project, v_date, coalesce(nullif(p ->> 'category', ''), 'other'),
          nullif(left(trim(coalesce(p ->> 'description', '')), 200), ''), v_amount, v_currency)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.expenses where id = p_expense_id and owner_id = public._uid();
  if not found then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.my_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  s public.subscriptions;
  eff public.plans;
begin
  select * into s from public.subscriptions where owner_id = v_uid;
  eff := public._effective_plan(v_uid);
  return jsonb_build_object(
    'plan', coalesce(s.plan_id, 'free'),
    'status', coalesce(s.status, 'free'),
    'effective_plan', eff.id,
    'billing_interval', s.billing_interval,
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', coalesce(s.cancel_at_period_end, false),
    'grace_until', s.grace_until,
    'limits', jsonb_build_object('active_projects', eff.max_active_projects, 'clients', eff.max_clients,
                                 'team_members', eff.max_team_members),
    'usage', public._plan_usage(v_uid),
    'early_access', (select jsonb_build_object('plan', e.plan_id, 'billing_interval', e.billing_interval, 'created_at', e.created_at)
                       from public.early_access_requests e where e.owner_id = v_uid));
end;
$$;

drop function if exists public._require_feature(uuid, text, text);
drop function if exists public._has_feature(uuid, text);
revoke all on function public.add_expense(jsonb), public.delete_expense(uuid), public.my_plan() from public, anon;
grant execute on function public.add_expense(jsonb), public.delete_expense(uuid), public.my_plan() to authenticated;
commit;
