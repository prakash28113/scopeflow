-- =====================================================================
-- T2-13: how many accounts get as far as sending an approval link.
--
-- "Activated" = the account has created at least one client approval link (send scope).
-- Admin only, from the Supabase SQL editor:
--   select * from public.admin_activation();
-- One row per sign-up week (India time), newest first, plus an "all" row.
-- Counts only; no names or emails. (20261119000000 is left free for the AI layer.) Safe to re-run.
-- Rollback: supabase/rollback/20261124000000_activation_down.sql
-- =====================================================================
begin;

create or replace function public.admin_activation()
returns table (signup_week text, signed_up bigint, added_client bigint, wrote_scope bigint, activated bigint, logged_request bigint, activated_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
with a as (
  select p.id,
         to_char(date_trunc('week', p.created_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as wk,
         exists (select 1 from public.clients c where c.owner_id = p.id) as has_client,
         exists (select 1 from public.projects pr where pr.owner_id = p.id) as has_project,
         exists (select 1 from public.share_links l join public.projects pr on pr.id = l.project_id where pr.owner_id = p.id) as has_link,
         exists (select 1 from public.revision_requests r join public.projects pr on pr.id = r.project_id where pr.owner_id = p.id) as has_request
    from public.profiles p
), g as (
  select coalesce(wk, 'all') as wk, grouping(wk) as is_total,
         count(*) as n,
         count(*) filter (where has_client) as c,
         count(*) filter (where has_project) as s,
         count(*) filter (where has_link) as l,
         count(*) filter (where has_request) as r
    from a
   group by grouping sets ((wk), ())
)
select wk, n, c, s, l, r, case when n = 0 then 0 else round(100.0 * l / n, 1) end
  from g
 order by is_total desc, wk desc;
$$;

revoke all on function public.admin_activation() from public, anon, authenticated, service_role;

commit;
