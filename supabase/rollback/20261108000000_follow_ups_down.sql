-- Rollback for follow-up reminders (20261108000000_follow_ups.sql).
-- ⚠ Deletes every follow-up reminder. Safe to re-run.
begin;
drop function if exists public.add_follow_up(jsonb), public.set_follow_up_done(uuid, boolean), public.delete_follow_up(uuid);
drop table if exists public.follow_ups;
commit;
