-- =====================================================================
-- Turns SOLO199 on: Solo monthly, Rs 300 off each of the first 3 payments (Rs 199, then Rs 499), first 50 accounts.
-- The discount is the Razorpay Offer below (created in the Razorpay dashboard, live mode). No test-mode offer exists,
-- so the code is refused in test mode. Prices and Razorpay plans are not touched. Safe to re-run.
-- Switch it off at any time:  update public.promo_codes set active = false where code = 'SOLO199';
-- Rollback: supabase/rollback/20261127000001_promo_solo199_down.sql
-- =====================================================================
begin;

insert into public.promo_codes (code, plan_id, billing_interval, discount_cents, discount_cycles, max_uses, offer_id_live, created_at)
values ('SOLO199', 'solo', 'month', 30000, 3, 50, 'offer_U26pZCE687GpDs', timestamptz '2026-11-19 17:00:00+00')
on conflict (code) do nothing;

commit;
