-- Rollback for 20261124000000_activation.sql. Safe to re-run.
begin;
drop function if exists public.admin_activation();
commit;
