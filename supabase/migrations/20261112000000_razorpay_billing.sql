-- =====================================================================
-- ScopeFlow — paid plans through Razorpay subscriptions.
--
--   Prices move to Indian rupees (UPI AutoPay and Indian cards only work in INR):
--     Solo   ₹499 / month or ₹4,999 / year
--     Studio ₹999 / month or ₹9,999 / year
--   plans.purchasable stays false here; the release turns it on per plan only when live
--   Razorpay keys are configured (scripts/ci/release.mjs).
--
--   provider_plans     Razorpay plan ids per ScopeFlow plan, interval, price and mode (test/live).
--                      A price change creates a new Razorpay plan; existing subscribers keep theirs.
--   billing_checkouts  Every Razorpay subscription ScopeFlow created, and for whom. Webhooks are
--                      matched to an account through this table only (never through payload notes).
--
-- All billing functions run only as service_role (the "billing" Edge Function), after the
-- webhook signature or the user's session has been verified there.
-- Safe to re-run. Rollback: supabase/rollback/20261112000000_razorpay_billing_down.sql
-- =====================================================================

update public.plans set currency = 'INR', monthly_price_cents = 49900, annual_price_cents = 499900 where id = 'solo';
update public.plans set currency = 'INR', monthly_price_cents = 99900, annual_price_cents = 999900 where id = 'studio';
update public.plans set currency = 'INR' where id = 'free';
alter table public.plans alter column currency set default 'INR';

create table if not exists public.provider_plans (
  provider          text not null check (provider = 'razorpay'),
  mode              text not null check (mode in ('test', 'live')),
  plan_id           text not null references public.plans (id) check (plan_id <> 'free'),
  billing_interval  text not null check (billing_interval in ('month', 'year')),
  amount_cents      integer not null check (amount_cents > 0),
  currency          char(3) not null,
  provider_plan_id  text not null unique check (char_length(provider_plan_id) <= 200),
  created_at        timestamptz not null default now(),
  primary key (provider, mode, plan_id, billing_interval, amount_cents, currency)
);

create table if not exists public.billing_checkouts (
  provider_subscription_id text primary key check (char_length(provider_subscription_id) <= 200),
  provider                 text not null check (provider = 'razorpay'),
  mode                     text not null check (mode in ('test', 'live')),
  owner_id                 uuid not null references public.profiles (id) on delete cascade,
  plan_id                  text not null references public.plans (id) check (plan_id <> 'free'),
  billing_interval         text not null check (billing_interval in ('month', 'year')),
  amount_cents             integer not null check (amount_cents > 0),
  currency                 char(3) not null,
  created_at               timestamptz not null default now()
);
create index if not exists billing_checkouts_owner_idx on public.billing_checkouts (owner_id, created_at desc);

alter table public.provider_plans    enable row level security;
alter table public.billing_checkouts enable row level security;
revoke all on public.provider_plans, public.billing_checkouts from public, anon, authenticated;
grant select, insert on public.provider_plans, public.billing_checkouts to service_role;

-- ---------------------------------------------------------------------
-- Checkout (called by the Edge Function for a signed-in user)
-- ---------------------------------------------------------------------
-- What to charge, or a plain reason why this account can't start a checkout now.
-- p_tester: test-mode checkouts are limited to the owner's testers (checked in the function).
create or replace function public.billing_prepare_checkout(p_owner uuid, p_plan text, p_interval text, p_mode text, p_tester boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_sub public.subscriptions;
  v_email text;
  v_name text;
  v_amount integer;
  v_provider_plan text;
begin
  if p_interval not in ('month', 'year') then
    raise exception 'Choose monthly or yearly billing' using errcode = '22023';
  end if;
  if p_mode not in ('test', 'live') then
    raise exception 'Unknown billing mode' using errcode = '22023';
  end if;
  select * into v_plan from public.plans where id = p_plan and id <> 'free';
  if not found then
    raise exception 'Choose a paid plan' using errcode = '22023';
  end if;
  if not (v_plan.purchasable or (p_mode = 'test' and p_tester)) then
    raise exception '% isn''t on sale yet.', v_plan.name using errcode = 'SF409';
  end if;
  select * into v_sub from public.subscriptions where owner_id = p_owner;
  if not found then
    raise exception 'No account' using errcode = 'P0002';
  end if;
  -- One paid subscription at a time: a running one must end (or be cancelled and run out) first.
  if (public._effective_plan(p_owner)).id <> 'free' and v_sub.provider is not null then
    raise exception 'You already have a paid plan. Cancel it on this page; when it ends you can choose another.' using errcode = 'SF409';
  end if;
  select email, coalesce(nullif(full_name, ''), business_name, '') into v_email, v_name from public.profiles where id = p_owner;
  v_amount := case when p_interval = 'month' then v_plan.monthly_price_cents else v_plan.annual_price_cents end;
  select provider_plan_id into v_provider_plan from public.provider_plans
   where provider = 'razorpay' and mode = p_mode and plan_id = v_plan.id and billing_interval = p_interval
     and amount_cents = v_amount and currency = v_plan.currency;
  return jsonb_build_object(
    'plan', v_plan.id, 'plan_name', v_plan.name, 'interval', p_interval,
    'amount_cents', v_amount, 'currency', v_plan.currency,
    'provider_plan_id', v_provider_plan, 'email', v_email, 'name', v_name);
end;
$$;

create or replace function public.billing_save_provider_plan(
  p_mode text, p_plan text, p_interval text, p_amount integer, p_currency text, p_provider_plan_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  insert into public.provider_plans (provider, mode, plan_id, billing_interval, amount_cents, currency, provider_plan_id)
  values ('razorpay', p_mode, p_plan, p_interval, p_amount, p_currency, p_provider_plan_id)
  on conflict (provider, mode, plan_id, billing_interval, amount_cents, currency) do nothing;
  -- Two checkouts racing: the first stored plan wins and both use it.
  select provider_plan_id into v_id from public.provider_plans
   where provider = 'razorpay' and mode = p_mode and plan_id = p_plan and billing_interval = p_interval
     and amount_cents = p_amount and currency = p_currency;
  return v_id;
end;
$$;

create or replace function public.billing_record_checkout(
  p_owner uuid, p_subscription_id text, p_mode text, p_plan text, p_interval text, p_amount integer, p_currency text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.billing_checkouts (provider_subscription_id, provider, mode, owner_id, plan_id, billing_interval, amount_cents, currency)
  values (p_subscription_id, 'razorpay', p_mode, p_owner, p_plan, p_interval, p_amount, p_currency);
$$;

-- The account's current Razorpay subscription (for cancelling), if it can still be cancelled.
create or replace function public.billing_current_subscription(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('subscription_id', s.provider_subscription_id, 'mode', c.mode,
                            'status', s.status, 'cancel_at_period_end', s.cancel_at_period_end)
    from public.subscriptions s
    join public.billing_checkouts c on c.provider_subscription_id = s.provider_subscription_id
   where s.owner_id = p_owner and s.provider = 'razorpay' and s.status in ('active', 'past_due');
$$;

-- After Razorpay accepted "cancel at the end of the period": paid access continues until then.
create or replace function public.billing_mark_cancelling(p_owner uuid, p_subscription_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.subscriptions set cancel_at_period_end = true, updated_at = now()
   where owner_id = p_owner and provider_subscription_id = p_subscription_id;
  insert into public.subscription_changes (owner_id, from_plan, to_plan, from_status, to_status, source, reference)
  select owner_id, plan_id, plan_id, status, status, 'provider', 'razorpay:cancel_requested ' || p_subscription_id
    from public.subscriptions where owner_id = p_owner and provider_subscription_id = p_subscription_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Webhook (called by the Edge Function after verifying Razorpay's signature)
-- ---------------------------------------------------------------------
-- Returns what happened: applied | ignored | duplicate | unknown_subscription.
-- Idempotent per Razorpay event id. Never grants access from a failure.
create or replace function public.process_razorpay_event(p_event_id text, p_mode text, p_event jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := p_event ->> 'event';
  v_sub jsonb := p_event #> '{payload,subscription,entity}';
  v_pay jsonb := p_event #> '{payload,payment,entity}';
  v_sub_id text := v_sub ->> 'id';
  c public.billing_checkouts;
  s public.subscriptions;
  v_end timestamptz := to_timestamp(nullif(v_sub ->> 'current_end', '')::double precision);
  v_start timestamptz := to_timestamp(nullif(v_sub ->> 'current_start', '')::double precision);
  v_ref text := 'razorpay:' || p_event_id;
  v_current boolean;
begin
  if p_event_id is null or char_length(p_event_id) > 200 or v_type is null then
    raise exception 'Malformed event' using errcode = '22023';
  end if;
  select * into c from public.billing_checkouts where provider_subscription_id = v_sub_id;
  insert into public.billing_events (provider, provider_event_id, event_type, owner_id, payload)
  values ('razorpay', p_event_id, left(v_type, 80), c.owner_id, p_event)
  on conflict (provider, provider_event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;
  if c.owner_id is null then
    return 'unknown_subscription';
  end if;
  -- Test-mode events never change a live account, and the other way round.
  if c.mode <> p_mode then
    return 'ignored';
  end if;

  select * into s from public.subscriptions where owner_id = c.owner_id for update;
  v_current := s.provider_subscription_id is null or s.provider_subscription_id = v_sub_id;

  if v_type in ('subscription.activated', 'subscription.charged', 'subscription.resumed') then
    if v_end is null or (v_sub ->> 'status') not in ('active', 'authenticated') then
      return 'ignored';
    end if;
    -- A newer subscription replaces an older one only once it is paid for.
    if not v_current and (public._effective_plan(c.owner_id)).id <> 'free' and s.status = 'active' then
      return 'ignored';
    end if;
    -- Never shorten paid access because events arrive out of order.
    if v_current and s.status = 'active' and s.current_period_end is not null and s.current_period_end > v_end then
      v_end := s.current_period_end;
    end if;
    perform public._set_subscription(c.owner_id, c.plan_id, 'active', c.billing_interval, v_end, null, 'provider', v_ref);
    update public.subscriptions
       set provider = 'razorpay', provider_subscription_id = v_sub_id,
           provider_customer_id = coalesce(v_sub ->> 'customer_id', provider_customer_id)
     where owner_id = c.owner_id;
    if v_type = 'subscription.charged' and v_pay is not null and v_pay ->> 'status' = 'captured' then
      insert into public.invoices (owner_id, provider, provider_invoice_id, amount_cents, currency, status, period_start, period_end, paid_at)
      values (c.owner_id, 'razorpay', coalesce(v_pay ->> 'invoice_id', v_pay ->> 'id'), (v_pay ->> 'amount')::bigint,
              upper(v_pay ->> 'currency'), 'paid', v_start, v_end,
              coalesce(to_timestamp(nullif(v_pay ->> 'created_at', '')::double precision), now()))
      on conflict (provider, provider_invoice_id) do nothing;
    end if;
    return 'applied';
  end if;

  if not v_current then
    return 'ignored';
  end if;
  if v_type = 'subscription.pending' then
    -- A renewal failed; Razorpay retries. Paid features stay on for a short grace period.
    if s.status in ('active', 'past_due') then
      perform public._set_subscription(c.owner_id, s.plan_id, 'past_due', s.billing_interval, s.current_period_end,
        coalesce(s.grace_until, now() + interval '7 days'), 'provider', v_ref);
      return 'applied';
    end if;
  elsif v_type = 'subscription.halted' then
    -- Retries exhausted: back to Free limits (nothing is deleted).
    if s.status in ('active', 'past_due') then
      perform public._set_subscription(c.owner_id, s.plan_id, 'expired', s.billing_interval, null, null, 'provider', v_ref);
      return 'applied';
    end if;
  elsif v_type = 'subscription.cancelled' then
    -- Paid access continues until the end of the period already paid for.
    if s.status in ('active', 'past_due') then
      perform public._set_subscription(c.owner_id, s.plan_id, 'cancelled', s.billing_interval,
        greatest(s.current_period_end, v_end), null, 'provider', v_ref);
      return 'applied';
    end if;
  elsif v_type = 'subscription.completed' then
    if s.status in ('active', 'past_due', 'cancelled') then
      perform public._set_subscription(c.owner_id, s.plan_id, 'cancelled', s.billing_interval, s.current_period_end, null, 'provider', v_ref);
      return 'applied';
    end if;
  end if;
  return 'ignored';
end;
$$;

revoke all on function
  public.billing_prepare_checkout(uuid, text, text, text, boolean),
  public.billing_save_provider_plan(text, text, text, integer, text, text),
  public.billing_record_checkout(uuid, text, text, text, text, integer, text),
  public.billing_current_subscription(uuid),
  public.billing_mark_cancelling(uuid, text),
  public.process_razorpay_event(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.billing_prepare_checkout(uuid, text, text, text, boolean),
  public.billing_save_provider_plan(text, text, text, integer, text, text),
  public.billing_record_checkout(uuid, text, text, text, text, integer, text),
  public.billing_current_subscription(uuid),
  public.billing_mark_cancelling(uuid, text),
  public.process_razorpay_event(text, text, jsonb)
  to service_role;
