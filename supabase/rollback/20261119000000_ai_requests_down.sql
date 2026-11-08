-- Rollback for 20261119000000_ai_requests.sql: removes the AI allowance functions and the AI audit
-- history. No project data is touched.
begin;
drop function if exists public.ai_finish(uuid, text, boolean), public.ai_begin(text, uuid), public.ai_remaining(), public._ai_daily_limit() cascade;
drop table if exists public.ai_requests cascade;
commit;
