-- =====================================================================
-- ScopeFlow — re-create the sign-up trigger after a restore
--
-- Supabase's documented backup (supabase db dump) does not include custom
-- triggers on its managed `auth` schema. ScopeFlow needs one: it creates each
-- user's profile and enforces the beta allowlist. Run this once on a project
-- restored from backup. Safe to run more than once.
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public._handle_new_user();

-- Check: should return exactly one row named on_auth_user_created.
select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
