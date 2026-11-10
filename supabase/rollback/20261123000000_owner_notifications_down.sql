-- Rollback for 20261123000000_owner_notifications.sql: no more owner emails; queued ones are dropped.
-- Safe to re-run.
begin;
drop trigger if exists activity_log_owner_email on public.activity_log;
drop function if exists public._queue_owner_email();
drop function if exists public.notify_claim(integer);
drop function if exists public.notify_mark(uuid, boolean, text);
drop function if exists public.set_notification_prefs(jsonb);
drop table if exists public.owner_emails;
alter table public.profiles drop column if exists notify_prefs;
commit;
