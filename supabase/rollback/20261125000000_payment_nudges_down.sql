-- Rollback for 20261125000000_payment_nudges.sql: drops the nudge record and the follow-up link.
-- Follow-ups created by a nudge stay as ordinary follow-ups. Safe to re-run.
begin;
drop function if exists public.record_nudge(uuid, jsonb);
drop table if exists public.nudges;
drop index if exists public.follow_ups_one_open_per_invoice;
alter table public.follow_ups drop column if exists invoice_id;
commit;
