-- =====================================================================
-- Promo code at checkout: SOLO199 = Solo monthly at Rs 199 for the first 3 payments (Rs 300 off each),
-- then the normal Rs 499. First 50 accounts, one use per account.
--
-- The discount itself is a Razorpay Offer (created in the Razorpay dashboard: Flat Rs 300, "Limited number
-- of cycles" = 3, Solo monthly). This table only decides WHO may attach it: the code must be active, match
-- the plan and interval, still have uses left, and not have been used by this account. Plan prices, Razorpay
-- plan ids and amounts are not touched. Until a code row (with its offer id) exists, every code is refused.
-- A checkout that never leads to a paid invoice gives its use back after 2 hours.
-- Safe to re-run. Rollback: supabase/rollback/20261127000000_promo_codes_down.sql
-- =====================================================================
begin;

create table if not exists public.promo_codes (
  code             text primary key check (code ~ '^[A-Z0-9]{3,24}$'),
  plan_id          text not null references public.plans (id) check (plan_id <> 'free'),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  discount_cents   integer not null check (discount_cents > 0),
  discount_cycles  integer not null check (discount_cycles between 1 and 12),
  max_uses         integer not null check (max_uses > 0),
  offer_id_live    text check (offer_id_live is null or offer_id_live ~ '^offer_[A-Za-z0-9]{8,40}$'),
  offer_id_test    text check (offer_id_test is null or offer_id_test ~ '^offer_[A-Za-z0-9]{8,40}$'),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists public.promo_redemptions (
  code       text not null references public.promo_codes (code) on delete cascade,
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  mode       text not null check (mode in ('test', 'live')),
  created_at timestamptz not null default now(),
  primary key (code, owner_id)
);

alter table public.promo_codes       enable row level security;
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_codes, public.promo_redemptions from public, anon, authenticated;
grant select on public.promo_codes to service_role;
grant select, insert, update on public.promo_redemptions to service_role;

-- No code is created here. SOLO199 is added, with its Razorpay offer id, by one small migration once the
-- offer exists in the Razorpay dashboard (a restore skips rows a migration seeds, so the row is not seeded here).

-- Checks a code for this account and, when p_reserve is true, takes one of its uses.
-- Never raises for a bad code: answers { valid: false, reason } so the app can say why.
create or replace function public.billing_apply_promo(p_owner uuid, p_code text, p_plan text, p_interval text, p_mode text, p_reserve boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.promo_codes;
  v_plan public.plans;
  v_offer text;
  v_used integer;
  v_mine public.promo_redemptions;
  v_price integer;
begin
  if p_mode not in ('test', 'live') then
    raise exception 'Unknown billing mode' using errcode = '22023';
  end if;
  select * into c from public.promo_codes where code = upper(btrim(coalesce(p_code, '')));
  if not found or not c.active then
    return jsonb_build_object('valid', false, 'reason', 'That code isn''t valid.');
  end if;
  v_offer := case when p_mode = 'live' then c.offer_id_live else c.offer_id_test end;
  if v_offer is null then
    return jsonb_build_object('valid', false, 'reason', 'That code isn''t valid.');
  end if;
  if c.plan_id <> p_plan or c.billing_interval <> p_interval then
    return jsonb_build_object('valid', false, 'reason', 'That code works on Solo, billed monthly.');
  end if;
  select * into v_plan from public.plans where id = c.plan_id;
  v_price := v_plan.monthly_price_cents;
  if c.discount_cents >= v_price then
    return jsonb_build_object('valid', false, 'reason', 'That code isn''t valid.');
  end if;

  -- One at a time, so the last use can't be taken twice.
  perform pg_advisory_xact_lock(hashtext('promo:' || c.code));

  select * into v_mine from public.promo_redemptions where code = c.code and owner_id = p_owner;
  if found and exists (select 1 from public.invoices i where i.owner_id = p_owner and i.status = 'paid' and i.paid_at >= v_mine.created_at) then
    return jsonb_build_object('valid', false, 'reason', 'You''ve already used this code.');
  end if;

  -- A use counts once paid, or while its checkout is still fresh.
  select count(*) into v_used from public.promo_redemptions r
   where r.code = c.code and r.owner_id <> p_owner
     and (r.created_at > now() - interval '2 hours'
          or exists (select 1 from public.invoices i where i.owner_id = r.owner_id and i.status = 'paid' and i.paid_at >= r.created_at));
  if v_used >= c.max_uses then
    return jsonb_build_object('valid', false, 'reason', 'This code has been fully claimed.');
  end if;

  if p_reserve then
    insert into public.promo_redemptions (code, owner_id, mode) values (c.code, p_owner, p_mode)
    on conflict (code, owner_id) do update set created_at = now(), mode = excluded.mode;
  end if;
  return jsonb_build_object('valid', true, 'code', c.code, 'offer_id', v_offer,
    'discount_cents', c.discount_cents, 'cycles', c.discount_cycles, 'price_cents', v_price - c.discount_cents,
    'full_price_cents', v_price, 'currency', v_plan.currency);
end;
$$;

revoke all on function public.billing_apply_promo(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.billing_apply_promo(uuid, text, text, text, text, boolean) to service_role;

commit;
