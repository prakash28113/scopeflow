-- T1-04: a paid plan switches on only once money is captured.
--
-- Before: process_razorpay_event activated the plan when Razorpay reported the subscription as
-- 'authenticated' (mandate set up, first charge not yet taken) as well as 'active'.
-- Now: first activation needs status 'active', or a captured payment for that subscription
-- (subscription.charged / payment.captured). 'authenticated' returns 'pending' and changes nothing.
--
-- Unchanged: one effect per Razorpay event id, the owner comes only from billing_checkouts, test
-- and live stay apart, renewals, grace period, cancellation. No price, plan or limit is touched.
-- Returns: applied | pending | ignored | duplicate | unknown_subscription.
-- 20261119000000 is left free for the AI layer (PR #36). Safe to re-run.
begin;
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
  -- A payment names its subscription only sometimes; an event without one matches no checkout.
  v_sub_id text := coalesce(v_sub ->> 'id', v_pay ->> 'subscription_id');
  v_status text := v_sub ->> 'status';
  v_captured boolean := coalesce(v_pay ->> 'status' = 'captured', false);
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

  -- The mandate is set up but no money has been taken yet: noted (in billing_events), no paid features.
  if v_type = 'subscription.authenticated'
     or (v_type in ('subscription.activated', 'subscription.resumed') and v_status = 'authenticated') then
    return 'pending';
  end if;

  if v_type in ('subscription.activated', 'subscription.charged', 'subscription.resumed', 'payment.captured') then
    -- Paid access starts only when Razorpay says the subscription is active, or a payment for it
    -- was captured. 'authenticated' alone (mandate set up, nothing charged) never grants it.
    if v_type = 'payment.captured' then
      if not v_captured then
        return 'ignored';
      end if;
      -- A bare payment event carries no period: keep the one already running for this
      -- subscription, otherwise one billing interval from now.
      v_end := coalesce(v_end,
        case when s.provider_subscription_id = v_sub_id and s.status = 'active' and s.current_period_end > now() then s.current_period_end end,
        now() + case c.billing_interval when 'year' then interval '1 year' else interval '1 month' end);
    elsif v_type = 'subscription.charged' then
      if not (v_status = 'active' or v_captured) then
        return case when v_status = 'authenticated' then 'pending' else 'ignored' end;
      end if;
    elsif v_status is distinct from 'active' then
      return 'ignored';
    end if;
    if v_end is null then
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
    if v_type in ('subscription.charged', 'payment.captured') and v_captured then
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

revoke all on function public.process_razorpay_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_razorpay_event(text, text, jsonb) to service_role;
commit;
