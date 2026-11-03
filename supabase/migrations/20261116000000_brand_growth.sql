-- Brand & growth (claude-prompt-brand-growth v1.1).
--   * Owner's surname spelled "Mummidisetty" everywhere (reverses the batch-1 guess).
--   * Default SAC 998314 (IT design and development services), editable per business.
--   * Expenses, analytics and the approval-record PDF are Solo/Studio features. Free accounts keep
--     what they already created, read-only.
--   * Where sign-ups come from: UTM tags and referrer saved once on the profile, counted in an
--     admin-only view.

-- ------------------------------------------------------------------ name and SAC
update public.blog_posts set author_name = replace(author_name, 'Mummidisetti', 'Mummidisetty')
 where author_name like '%Mummidisetti%';
update public.profiles set full_name = replace(full_name, 'Mummidisetti', 'Mummidisetty')
 where email = 'prakashmummidisetti@gmail.com' and full_name like '%Mummidisetti%';

alter table public.profiles alter column sac_code set default '998314';
update public.profiles set sac_code = '998314' where sac_code is null;

-- ------------------------------------------------------------------ plan features
-- True when the account's current plan includes a feature from plans.features ("analytics", "exports", …).
create or replace function public._has_feature(p_owner uuid, p_feature text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((public._effective_plan(p_owner)).features ->> p_feature = 'true', false);
$$;

create or replace function public._require_feature(p_owner uuid, p_feature text, p_what text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_price text;
begin
  if not public._has_feature(p_owner, p_feature) then
    select public._money(monthly_price_cents, currency) into v_price from public.plans where id = 'solo';
    raise exception '% % available on Solo, %/month.', p_what,
                    case when p_what ~ 's$' then 'are' else 'is' end, coalesce(v_price, '₹499')
      using errcode = 'P0001', hint = 'plan_feature:' || p_feature;
  end if;
end;
$$;

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
  perform public._require_feature(v_uid, 'analytics', 'Expenses');
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
  perform public._require_feature(public._uid(), 'analytics', 'Expenses');
  delete from public.expenses where id = p_expense_id and owner_id = public._uid();
  if not found then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
end;
$$;

-- my_plan also says which features the plan includes, so the app can show them as locked.
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
    'features', jsonb_build_object('analytics', coalesce(eff.features ->> 'analytics' = 'true', false),
                                   'exports', coalesce(eff.features ->> 'exports' = 'true', false)),
    'usage', public._plan_usage(v_uid),
    'early_access', (select jsonb_build_object('plan', e.plan_id, 'billing_interval', e.billing_interval, 'created_at', e.created_at)
                       from public.early_access_requests e where e.owner_id = v_uid));
end;
$$;

-- ------------------------------------------------------------------ sign-up source
alter table public.profiles
  add column if not exists signup_utm_source text check (signup_utm_source is null or char_length(signup_utm_source) <= 100),
  add column if not exists signup_utm_medium text check (signup_utm_medium is null or char_length(signup_utm_medium) <= 100),
  add column if not exists signup_utm_campaign text check (signup_utm_campaign is null or char_length(signup_utm_campaign) <= 100),
  add column if not exists signup_referrer text check (signup_referrer is null or char_length(signup_referrer) <= 300);

-- Saved once, from the first visit (kept in the browser for 30 days). Later calls change nothing.
create or replace function public.set_signup_source(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  clean text := '[^A-Za-z0-9 ._~:/?#@!$&''()*+,;=%-]';
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.profiles
     set signup_utm_source = nullif(left(trim(regexp_replace(coalesce(p ->> 'utm_source', ''), clean, '', 'g')), 100), ''),
         signup_utm_medium = nullif(left(trim(regexp_replace(coalesce(p ->> 'utm_medium', ''), clean, '', 'g')), 100), ''),
         signup_utm_campaign = nullif(left(trim(regexp_replace(coalesce(p ->> 'utm_campaign', ''), clean, '', 'g')), 100), ''),
         signup_referrer = nullif(left(trim(regexp_replace(coalesce(p ->> 'referrer', ''), clean, '', 'g')), 300), '')
   where id = v_uid
     and signup_utm_source is null and signup_utm_medium is null
     and signup_utm_campaign is null and signup_referrer is null;
end;
$$;

-- Admin only, from the Supabase SQL editor:  select * from public.admin_signup_sources();
-- Sign-ups and paying accounts by where they came from. (A function, not a view: views in public
-- would be readable through the API.)
create or replace function public.admin_signup_sources()
returns table (source text, medium text, campaign text, signups bigint, paid bigint)
language sql
stable
security definer
set search_path = ''
as $$
select coalesce(p.signup_utm_source,
                nullif(regexp_replace(p.signup_referrer, '^https?://(www\.)?([^/:?#]+).*$', '\2'), p.signup_referrer),
                '(direct)') as source,
       coalesce(p.signup_utm_medium, '') as medium,
       coalesce(p.signup_utm_campaign, '') as campaign,
       count(*) as signups,
       -- Paying through Razorpay; complimentary plans (no provider subscription) aren't counted.
       count(*) filter (where s.plan_id is not null and s.plan_id <> 'free' and s.provider_subscription_id is not null
                          and (   (s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now()))
                               or (s.status = 'past_due' and s.grace_until > now())
                               or (s.status = 'cancelled' and s.current_period_end > now()))) as paid
  from public.profiles p
  left join public.subscriptions s on s.owner_id = p.id
 group by 1, 2, 3
 order by 4 desc, 1;
$$;

-- ------------------------------------------------------------------ blog: one page per search result
-- Published posts need their own title and description, so search results can tell them apart.
create or replace function public._blog_unique_meta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' then
    if exists (select 1 from public.blog_posts b where b.status = 'published' and b.id <> new.id
                and lower(trim(b.title)) = lower(trim(new.title))) then
      raise exception 'Another published post already has this title. Give this one its own title.' using errcode = '22023';
    end if;
    if exists (select 1 from public.blog_posts b where b.status = 'published' and b.id <> new.id
                and lower(trim(b.description)) = lower(trim(new.description))) then
      raise exception 'Another published post already has this summary. Give this one its own summary.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists blog_posts_unique_meta on public.blog_posts;
create trigger blog_posts_unique_meta before insert or update of title, description, status on public.blog_posts
  for each row execute function public._blog_unique_meta();

-- ------------------------------------------------------------------ permissions
revoke all on function public.admin_signup_sources() from public, anon, authenticated, service_role;
revoke all on function public._blog_unique_meta(), public._has_feature(uuid, text), public._require_feature(uuid, text, text),
  public.set_signup_source(jsonb), public.add_expense(jsonb), public.delete_expense(uuid), public.my_plan()
  from public, anon, authenticated;
grant execute on function public.set_signup_source(jsonb), public.add_expense(jsonb), public.delete_expense(uuid),
  public.my_plan() to authenticated;
