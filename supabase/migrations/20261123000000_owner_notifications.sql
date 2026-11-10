-- =====================================================================
-- T2-12: tell the freelancer by email when their client acts.
--
--   When a client approves the scope, asks for changes, or approves / declines a change order
--   (through the private link), one short email is queued for the account owner. Never for the
--   client. The "notify" Edge Function sends what's queued (Brevo); if it can't, the client's
--   action has still gone through, because queueing happens in a trigger that swallows its own
--   errors and sending happens afterwards, outside the transaction.
--
--   profiles.notify_prefs   per-type on/off, default on (a missing key means on)
--   owner_emails            the queue; no direct access for anyone but the service role
--   set_notification_prefs  Settings → Notifications
--   notify_claim / notify_mark   the Edge Function's two calls (service role only)
--
-- Not included: "client viewed an invoice". The portal has no invoice-viewed event, and adding
-- one means a new public endpoint or changing portal_view; left for a decision.
-- (20261119000000 is left free for the AI layer.) Safe to re-run.
-- Rollback: supabase/rollback/20261123000000_owner_notifications_down.sql
-- =====================================================================
begin;

alter table public.profiles add column if not exists notify_prefs jsonb not null default '{}'::jsonb;

create table if not exists public.owner_emails (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        text not null check (kind in ('scope_approved', 'changes_requested', 'change_order_decided')),
  event       text not null check (char_length(event) <= 60),
  actor_name  text check (char_length(actor_name) <= 200),
  summary     text not null check (char_length(summary) <= 500),
  created_at  timestamptz not null default now(),
  attempts    integer not null default 0,
  sent_at     timestamptz,
  last_error  text check (char_length(last_error) <= 300)
);
create index if not exists owner_emails_unsent_idx on public.owner_emails (created_at) where sent_at is null;

alter table public.owner_emails enable row level security;
revoke all on public.owner_emails from public, anon, authenticated;

-- Queues an email for the owner when a client's action lands in the project's timeline.
create or replace function public._queue_owner_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := case new.event
    when 'scope.approved' then 'scope_approved'
    when 'scope.rejected' then 'changes_requested'
    when 'revision.requested' then 'changes_requested'
    when 'change_order.approved' then 'change_order_decided'
    when 'change_order.rejected' then 'change_order_decided'
  end;
  v_owner uuid;
  v_on boolean;
begin
  if new.actor <> 'client' or v_kind is null then
    return new;
  end if;
  begin
    select p.owner_id, coalesce((pr.notify_prefs ->> v_kind)::boolean, true)
      into v_owner, v_on
      from public.projects p join public.profiles pr on pr.id = p.owner_id
     where p.id = new.project_id;
    if v_owner is not null and v_on then
      insert into public.owner_emails (owner_id, project_id, kind, event, actor_name, summary)
      values (v_owner, new.project_id, v_kind, new.event, left(new.actor_name, 200), left(new.summary, 500));
    end if;
  exception when others then
    -- An email is never a reason for the client's action to fail.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists activity_log_owner_email on public.activity_log;
create trigger activity_log_owner_email after insert on public.activity_log
  for each row execute function public._queue_owner_email();

-- Settings → Notifications: { "scope_approved": true, "changes_requested": false, ... }
create or replace function public.set_notification_prefs(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  k text;
  v_out jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Choose which emails to get' using errcode = '22023';
  end if;
  foreach k in array array['scope_approved', 'changes_requested', 'change_order_decided'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'boolean' then
        raise exception 'Choose on or off' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(k, p -> k);
    end if;
  end loop;
  update public.profiles set notify_prefs = notify_prefs || v_out where id = v_uid
  returning notify_prefs into v_out;
  return v_out;
end;
$$;

-- The Edge Function takes a few queued emails (each at most 5 tries, and only for 2 days)…
create or replace function public.notify_claim(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  with picked as (
    select e.id from public.owner_emails e
     where e.sent_at is null and e.attempts < 5 and e.created_at > now() - interval '2 days'
     order by e.created_at
     limit least(greatest(coalesce(p_limit, 10), 1), 25)
     for update skip locked
  ), bumped as (
    update public.owner_emails e set attempts = e.attempts + 1
      from picked where e.id = picked.id
    returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'kind', b.kind, 'event', b.event, 'actor_name', b.actor_name, 'summary', b.summary,
           'project_id', b.project_id, 'project_title', p.title,
           'to_email', pr.email, 'to_name', coalesce(nullif(pr.full_name, ''), pr.business_name)) order by b.created_at), '[]'::jsonb)
    into v_out
    from bumped b
    join public.projects p on p.id = b.project_id
    join public.profiles pr on pr.id = b.owner_id;
  return v_out;
end;
$$;

-- …and says how each one went.
create or replace function public.notify_mark(p_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.owner_emails
     set sent_at = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'failed'), 300) end
   where id = p_id and sent_at is null;
$$;

revoke all on function public._queue_owner_email(), public.set_notification_prefs(jsonb),
  public.notify_claim(integer), public.notify_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_notification_prefs(jsonb) to authenticated;
grant execute on function public.notify_claim(integer), public.notify_mark(uuid, boolean, text) to service_role;

commit;
