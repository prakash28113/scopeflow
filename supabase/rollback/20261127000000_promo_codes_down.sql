-- Rollback for 20261127000000_promo_codes.sql: removes promo codes and their use records.
-- Subscriptions already bought with a code keep their Razorpay discount; nothing else changes. Safe to re-run.
begin;
drop function if exists public.billing_apply_promo(uuid, text, text, text, text, boolean);
drop table if exists public.promo_redemptions;
drop table if exists public.promo_codes;
commit;
