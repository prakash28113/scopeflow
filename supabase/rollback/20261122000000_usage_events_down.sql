-- Rollback for 20261122000000_usage_events.sql: removes the usage counts. Safe to re-run.
begin;
drop function if exists public.admin_usage_counts();
drop function if exists public.log_usage_event(text, text);
drop table if exists public.usage_events;
commit;
