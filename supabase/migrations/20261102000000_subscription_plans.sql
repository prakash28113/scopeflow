-- =====================================================================
-- ScopeFlow — subscription plans, Phase 1 (limits and records; no payments).
--
--   plans                 Free / Solo / Studio definitions: prices, limits, features.
--                         Public read (pricing page); changed only by migrations.
--   subscriptions         One row per account. Readable by its owner only; written
--                         only by admin_set_plan() (SQL editor) or, later, by a
--                         verified payment webhook through process_billing_event().
--   subscription_changes  Immutable audit trail of every plan/status change.
--   billing_events        Provider events, unique per provider event id (replays ignored).
--   invoices              Billing history shown to the owner (empty until payments exist).
--   early_access_requests "Join early access" interest in paid plans.
--
-- Limits are enforced inside save_project. Existing projects, approvals, change orders,
-- payments and client links are never limited, on any plan, before or after a downgrade.
-- Safe to re-run. Rollback: supabase/rollback/20261102000000_subscription_plans_down.sql
-- =====================================================================

create table if not exists public.plans (
  id                   text primary key check (id in ('free', 'solo', 'studio')),
  name                 text not null,
  position             integer not null,
  currency             char(3) not null default 'USD',
  monthly_price_cents  integer not null check (monthly_price_cents >= 0),
  annual_price_cents   integer not null check (annual_price_cents >= 0),
  max_active_projects  integer check (max_active_projects > 0),   -- null = unlimited
  max_clients          integer check (max_clients > 0),           -- null = unlimited
  max_team_members     integer not null default 1 check (max_team_members >= 1),
  features             jsonb not null default '{}'::jsonb,
  -- Can it be bought right now? False until payment processing is live and verified.
  purchasable          boolean not null default false
);

insert into public.plans (id, name, position, monthly_price_cents, annual_price_cents, max_active_projects, max_clients, max_team_members, features, purchasable)
values
  ('free',   'Free',   1,    0,     0, 2,    5,    1, '{"templates":"starter","quotes":1,"exports":false,"analytics":false,"white_label":false}', false),
  ('solo',   'Solo',   2,  900,  9000, null, null, 1, '{"templates":"full","quotes":null,"exports":true,"analytics":true,"white_label":false}', false),
  ('studio', 'Studio', 3, 1900, 19000, null, null, 3, '{"templates":"full_shared","quotes":null,"exports":true,"analytics":true,"white_label":true}', false)
on conflict (id) do update set
  name = excluded.name, position = excluded.position, monthly_price_cents = excluded.monthly_price_cents,
  annual_price_cents = excluded.annual_price_cents, max_active_projects = excluded.max_active_projects,
  max_clients = excluded.max_clients, max_team_members = excluded.max_team_members,
  features = excluded.features, purchasable = excluded.purchasable;

create table if not exists public.subscriptions (
  owner_id                 uuid primary key references public.profiles (id) on delete cascade,
  plan_id                  text not null default 'free' references public.plans (id),
  status                   text not null default 'free'
                           check (status in ('free', 'trialing', 'active', 'past_due', 'cancelled', 'expired')),
  billing_interval         text check (billing_interval in ('month', 'year')),
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  grace_until              timestamptz,
  provider                 text check (char_length(provider) <= 40),
  provider_customer_id     text check (char_length(provider_customer_id) <= 200),
  provider_subscription_id text check (char_length(provider_subscription_id) <= 200),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- A free row is always the Free plan; a paid status always names a paid plan.
  check ((status = 'free') = (plan_id = 'free') or status in ('expired', 'cancelled'))
);

create table if not exists public.subscription_changes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  from_plan   text,
  to_plan     text not null,
  from_status text,
  to_status   text not null,
  source      text not null check (source in ('signup', 'backfill', 'admin', 'provider')),
  reference   text check (char_length(reference) <= 300),
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists subscription_changes_owner_idx on public.subscription_changes (owner_id, created_at desc);

create table if not exists public.billing_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null check (char_length(provider) <= 40),
  provider_event_id text not null check (char_length(provider_event_id) <= 200),
  event_type        text not null check (char_length(event_type) <= 80),
  owner_id          uuid references public.profiles (id) on delete set null,
  payload           jsonb not null default '{}'::jsonb,
  received_at       timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  provider            text not null,
  provider_invoice_id text not null,
  amount_cents        bigint not null check (amount_cents >= 0),
  currency            char(3) not null,
  status              text not null check (status in ('paid', 'refunded', 'void')),
  period_start        timestamptz,
  period_end          timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (provider, provider_invoice_id)
);

create table if not exists public.early_access_requests (
  owner_id         uuid primary key references public.profiles (id) on delete cascade,
  plan_id          text not null references public.plans (id) check (plan_id <> 'free'),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Audit trail is append-only.
drop trigger if exists subscription_changes_immutable on public.subscription_changes;
create or replace function public._forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% records are immutable', tg_table_name using errcode = '42501';
  end if;
  -- DELETE only as a cascade when the account itself is deleted.
  if exists (select 1 from public.profiles where id = old.owner_id) then
    raise exception '% records are immutable', tg_table_name using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger subscription_changes_immutable before update or delete on public.subscription_changes
  for each row execute function public._forbid_change();

-- Row Level Security: owners read their own billing rows; plans are public; nobody writes via the API.
alter table public.plans                 enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.subscription_changes  enable row level security;
alter table public.billing_events        enable row level security;
alter table public.invoices              enable row level security;
alter table public.early_access_requests enable row level security;

drop policy if exists "plans are public" on public.plans;
create policy "plans are public" on public.plans for select to anon, authenticated using (true);
drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "own subscription changes" on public.subscription_changes;
create policy "own subscription changes" on public.subscription_changes for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "own invoices" on public.invoices;
create policy "own invoices" on public.invoices for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "own early access" on public.early_access_requests;
create policy "own early access" on public.early_access_requests for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.plans, public.subscriptions, public.subscription_changes, public.billing_events,
              public.invoices, public.early_access_requests from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.subscription_changes, public.invoices, public.early_access_requests to authenticated;
-- Provider identifiers stay server-side.
grant select (owner_id, plan_id, status, billing_interval, current_period_end, cancel_at_period_end, grace_until, created_at, updated_at)
  on public.subscriptions to authenticated;

-- Every account has a subscription row: new sign-ups get Free; existing accounts are backfilled.
create or replace function public._create_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (owner_id) values (new.id) on conflict (owner_id) do nothing;
  if found then
    insert into public.subscription_changes (owner_id, to_plan, to_status, source)
    values (new.id, 'free', 'free', 'signup');
  end if;
  return new;
end;
$$;
drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created after insert on public.profiles
  for each row execute function public._create_subscription();

with added as (
  insert into public.subscriptions (owner_id)
  select id from public.profiles
  on conflict (owner_id) do nothing
  returning owner_id
)
insert into public.subscription_changes (owner_id, to_plan, to_status, source)
select owner_id, 'free', 'free', 'backfill' from added;

-- ---------------------------------------------------------------------
-- Entitlements
-- ---------------------------------------------------------------------
-- The plan whose limits apply right now. Paid access requires a confirmed status:
--   active / trialing  → that plan, until current_period_end (if set)
--   past_due           → that plan only during grace_until, then Free
--   cancelled          → that plan until current_period_end, then Free
--   free / expired     → Free
create or replace function public._effective_plan(p_owner uuid)
returns public.plans
language sql
stable
set search_path = ''
as $$
  select pl.* from public.plans pl
   where pl.id = coalesce((
     select s.plan_id from public.subscriptions s
      where s.owner_id = p_owner
        and (   (s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now()))
             or (s.status = 'past_due' and s.grace_until > now())
             or (s.status = 'cancelled' and s.current_period_end > now()))
   ), 'free');
$$;

create or replace function public._plan_usage(p_owner uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'active_projects', (select count(*) from public.projects
                         where owner_id = p_owner and status in ('draft', 'awaiting_approval', 'changes_requested', 'active')),
    'clients', (select count(*) from public.clients where owner_id = p_owner));
$$;

-- Raises SF402 with a plain explanation when creating something would exceed the plan.
create or replace function public._check_plan_limits(p_owner uuid, p_new_project boolean, p_client_email text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_projects integer;
  v_clients integer;
begin
  -- Serialize creations per account so two tabs can't both slip past a limit.
  perform 1 from public.profiles where id = p_owner for update;
  v_plan := public._effective_plan(p_owner);

  if p_new_project and v_plan.max_active_projects is not null then
    select count(*) into v_projects from public.projects
     where owner_id = p_owner and status in ('draft', 'awaiting_approval', 'changes_requested', 'active');
    if v_projects >= v_plan.max_active_projects then
      raise exception 'Your % plan includes % active projects, and you have %. Complete or cancel a project, or see plans to get more.',
        v_plan.name, v_plan.max_active_projects, v_projects
        using errcode = 'SF402', hint = 'plan_limit:active_projects',
              detail = jsonb_build_object('limit', v_plan.max_active_projects, 'used', v_projects, 'plan', v_plan.id)::text;
    end if;
  end if;

  if v_plan.max_clients is not null and p_client_email <> ''
     and not exists (select 1 from public.clients where owner_id = p_owner and email = p_client_email) then
    select count(*) into v_clients from public.clients where owner_id = p_owner;
    if v_clients >= v_plan.max_clients then
      raise exception 'Your % plan includes % clients, and you have %. Use an existing client, or see plans to get more.',
        v_plan.name, v_plan.max_clients, v_clients
        using errcode = 'SF402', hint = 'plan_limit:clients',
              detail = jsonb_build_object('limit', v_plan.max_clients, 'used', v_clients, 'plan', v_plan.id)::text;
    end if;
  end if;
end;
$$;

-- What the Plan & usage page shows.
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

-- "Join early access" for a paid plan (no payment, no plan change).
create or replace function public.join_early_access(p_plan text, p_interval text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
begin
  if p_plan not in ('solo', 'studio') then
    raise exception 'Choose Solo or Studio' using errcode = '22023';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'Choose monthly or yearly billing' using errcode = '22023';
  end if;
  insert into public.early_access_requests (owner_id, plan_id, billing_interval)
  values (v_uid, p_plan, p_interval)
  on conflict (owner_id) do update set plan_id = excluded.plan_id, billing_interval = excluded.billing_interval, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- Plan changes (not callable from the app)
-- ---------------------------------------------------------------------
create or replace function public._set_subscription(
  p_owner uuid, p_plan text, p_status text, p_interval text, p_period_end timestamptz,
  p_grace_until timestamptz, p_source text, p_reference text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  old public.subscriptions;
begin
  select * into old from public.subscriptions where owner_id = p_owner for update;
  if not found then
    raise exception 'No account %', p_owner using errcode = 'P0002';
  end if;
  update public.subscriptions
     set plan_id = p_plan, status = p_status, billing_interval = p_interval,
         current_period_end = p_period_end, grace_until = p_grace_until,
         cancel_at_period_end = (p_status = 'cancelled'), updated_at = now()
   where owner_id = p_owner;
  insert into public.subscription_changes (owner_id, from_plan, to_plan, from_status, to_status, source, reference)
  values (p_owner, old.plan_id, p_plan, old.status, p_status, p_source, left(p_reference, 300));
end;
$$;

-- For the owner, in the Supabase SQL editor only (testing, comps, support). No API role can run it.
create or replace function public.admin_set_plan(
  p_email text, p_plan text, p_status text,
  p_interval text default null, p_period_end timestamptz default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select id into v_owner from public.profiles where email = lower(trim(p_email));
  if v_owner is null then
    raise exception 'No account with email %', p_email using errcode = 'P0002';
  end if;
  perform public._set_subscription(v_owner, p_plan, p_status, p_interval, p_period_end,
    case when p_status = 'past_due' then now() + interval '7 days' end, 'admin', p_note);
end;
$$;

-- For a future payment webhook (service role only, after signature verification).
-- Idempotent: a provider event id is processed once; replays return false and change nothing.
-- Only a confirmed activation grants a paid plan; a failed payment never does.
create or replace function public.process_billing_event(
  p_provider text, p_event_id text, p_event_type text, p_owner uuid,
  p_plan text default null, p_interval text default null, p_period_end timestamptz default null,
  p_payload jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
begin
  insert into public.billing_events (provider, provider_event_id, event_type, owner_id, payload)
  values (p_provider, p_event_id, p_event_type, p_owner, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, provider_event_id) do nothing;
  if not found then
    return false;
  end if;

  select * into s from public.subscriptions where owner_id = p_owner;
  if not found then
    raise exception 'No account %', p_owner using errcode = 'P0002';
  end if;

  if p_event_type = 'subscription.activated' then
    if p_plan not in ('solo', 'studio') or p_interval not in ('month', 'year') or p_period_end is null then
      raise exception 'Activation needs a paid plan, interval and period end' using errcode = '22023';
    end if;
    perform public._set_subscription(p_owner, p_plan, 'active', p_interval, p_period_end, null, 'provider', p_provider || ':' || p_event_id);
  elsif p_event_type = 'payment.failed' then
    -- Only an already-paying account gets a short grace period; nobody gains access from a failure.
    if s.status in ('active', 'trialing') then
      perform public._set_subscription(p_owner, s.plan_id, 'past_due', s.billing_interval, s.current_period_end,
        now() + interval '7 days', 'provider', p_provider || ':' || p_event_id);
    end if;
  elsif p_event_type = 'subscription.cancelled' then
    if s.status in ('active', 'trialing', 'past_due') then
      perform public._set_subscription(p_owner, s.plan_id, 'cancelled', s.billing_interval, s.current_period_end,
        null, 'provider', p_provider || ':' || p_event_id);
    end if;
  elsif p_event_type = 'subscription.expired' then
    perform public._set_subscription(p_owner, s.plan_id, 'expired', null, null, null, 'provider', p_provider || ':' || p_event_id);
  end if;
  return true;
end;
$$;

-- save_project with plan limits (otherwise identical to v1.1).
create or replace function public.save_project(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_project public.projects;
  v_client_id uuid;
  v_item jsonb;
  v_pos integer;
  v_deliverables jsonb := coalesce(p -> 'deliverables', '[]'::jsonb);
  v_milestones jsonb := coalesce(p -> 'milestones', '[]'::jsonb);
begin
  if jsonb_typeof(v_deliverables) <> 'array'
     or jsonb_array_length(v_deliverables) not between 1 and 50 then
    raise exception 'Add between 1 and 50 deliverables' using errcode = '22023';
  end if;
  if jsonb_typeof(v_milestones) <> 'array' or jsonb_array_length(v_milestones) > 50 then
    raise exception 'Add at most 50 payment milestones' using errcode = '22023';
  end if;

  -- Plan limits (server-side; the page only explains them). Editing existing work is never limited.
  perform public._check_plan_limits(v_uid, p_project_id is null, lower(trim(coalesce(p -> 'client' ->> 'email', ''))));

  if p_project_id is not null then
    v_project := public._owned_project(p_project_id);
    if v_project.status not in ('draft', 'changes_requested') then
      raise exception 'The scope is locked. Use a change order to modify an approved project.'
        using errcode = '55000';
    end if;
  end if;

  insert into public.clients (owner_id, name, email, company)
  values (v_uid,
          trim(p -> 'client' ->> 'name'),
          lower(trim(p -> 'client' ->> 'email')),
          nullif(trim(coalesce(p -> 'client' ->> 'company', '')), ''))
  on conflict (owner_id, email) do update
     set name = excluded.name, company = excluded.company, updated_at = now()
  returning id into v_client_id;

  if p_project_id is null then
    insert into public.projects (owner_id, client_id, title, summary, currency, budget_cents, start_date, due_date,
                                 exclusions, terms, extra_revision_cents)
    values (v_uid, v_client_id,
            trim(p ->> 'title'),
            nullif(trim(coalesce(p ->> 'summary', '')), ''),
            upper(p ->> 'currency'),
            (p ->> 'budget_cents')::bigint,
            nullif(p ->> 'start_date', '')::date,
            nullif(p ->> 'due_date', '')::date,
            nullif(trim(coalesce(p ->> 'exclusions', '')), ''),
            nullif(trim(coalesce(p ->> 'terms', '')), ''),
            nullif(p ->> 'extra_revision_cents', '')::bigint)
    returning * into v_project;
    perform public._log(v_project.id, 'freelancer', null, 'project.created', 'Project created');
  else
    update public.projects
       set client_id = v_client_id,
           title = trim(p ->> 'title'),
           summary = nullif(trim(coalesce(p ->> 'summary', '')), ''),
           currency = upper(p ->> 'currency'),
           budget_cents = (p ->> 'budget_cents')::bigint,
           start_date = nullif(p ->> 'start_date', '')::date,
           due_date = nullif(p ->> 'due_date', '')::date,
           -- Backward compatible: a client that doesn't send these keys (v1.0 app) keeps them.
           exclusions = case when p ? 'exclusions' then nullif(trim(coalesce(p ->> 'exclusions', '')), '') else exclusions end,
           terms = case when p ? 'terms' then nullif(trim(coalesce(p ->> 'terms', '')), '') else terms end,
           extra_revision_cents = case when p ? 'extra_revision_cents' then nullif(p ->> 'extra_revision_cents', '')::bigint
                                       else extra_revision_cents end,
           updated_at = now()
     where id = p_project_id
    returning * into v_project;
    delete from public.deliverables where project_id = v_project.id;
    delete from public.milestones where project_id = v_project.id;
    perform public._log(v_project.id, 'freelancer', null, 'project.updated', 'Scope edited');
  end if;

  v_pos := 0;
  for v_item in select value from jsonb_array_elements(v_deliverables) loop
    v_pos := v_pos + 1;
    insert into public.deliverables (project_id, position, title, description, revisions_included)
    values (v_project.id, v_pos,
            trim(v_item ->> 'title'),
            nullif(trim(coalesce(v_item ->> 'description', '')), ''),
            (v_item ->> 'revisions_included')::integer);
  end loop;

  v_pos := 0;
  for v_item in select value from jsonb_array_elements(v_milestones) loop
    v_pos := v_pos + 1;
    insert into public.milestones (project_id, position, title, amount_cents, due_date)
    values (v_project.id, v_pos,
            trim(v_item ->> 'title'),
            (v_item ->> 'amount_cents')::bigint,
            nullif(v_item ->> 'due_date', '')::date);
  end loop;

  return v_project.id;
end;
$$;

revoke all on function public.my_plan(), public.join_early_access(text, text),
  public.admin_set_plan(text, text, text, text, timestamptz, text),
  public.process_billing_event(text, text, text, uuid, text, text, timestamptz, jsonb),
  public._effective_plan(uuid), public._plan_usage(uuid), public._check_plan_limits(uuid, boolean, text),
  public._set_subscription(uuid, text, text, text, timestamptz, timestamptz, text, text),
  public._create_subscription(), public._forbid_change()
  from public, anon, authenticated;
revoke all on function public.admin_set_plan(text, text, text, text, timestamptz, text) from service_role;
grant execute on function public.my_plan(), public.join_early_access(text, text) to authenticated;
grant execute on function public.process_billing_event(text, text, text, uuid, text, text, timestamptz, jsonb) to service_role;
