-- Rollback for 20261120000000_billing_activation_needs_payment.sql: restores process_razorpay_event
-- exactly as 20261112000000_razorpay_billing.sql defined it. Safe to re-run.
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

revoke all on function public.process_razorpay_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_razorpay_event(text, text, jsonb) to service_role;
commit;
