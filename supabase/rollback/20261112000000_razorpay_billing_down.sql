-- Rollback for Razorpay billing (20261112000000_razorpay_billing.sql).
-- Removes the billing functions and Razorpay records and restores the US-dollar prices.
-- Subscriptions, their audit trail, billing events and invoices are kept. Safe to re-run.
begin;
drop function if exists public.process_razorpay_event(text, text, jsonb);
drop function if exists public.billing_mark_cancelling(uuid, text);
drop function if exists public.billing_current_subscription(uuid);
drop function if exists public.billing_record_checkout(uuid, text, text, text, text, integer, text);
drop function if exists public.billing_save_provider_plan(text, text, text, integer, text, text);
drop function if exists public.billing_prepare_checkout(uuid, text, text, text, boolean);
drop table if exists public.billing_checkouts;
drop table if exists public.provider_plans;
alter table public.plans alter column currency set default 'USD';
update public.plans set currency = 'USD', purchasable = false where id = 'free';
update public.plans set currency = 'USD', monthly_price_cents = 900, annual_price_cents = 9000, purchasable = false where id = 'solo';
update public.plans set currency = 'USD', monthly_price_cents = 1900, annual_price_cents = 19000, purchasable = false where id = 'studio';
commit;
