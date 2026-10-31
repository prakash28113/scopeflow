-- =====================================================================
-- ScopeFlow — core schema
--
-- Security model
--   * Every table has Row Level Security enabled.
--   * The `authenticated` role may only SELECT rows it owns (directly or
--     via the parent project). It has no direct INSERT/UPDATE/DELETE.
--   * All writes go through SECURITY DEFINER functions that check
--     auth.uid() and enforce the project state machine.
--   * The `anon` role can read nothing. Clients reach their project only
--     through portal_* functions, which require a share token. Tokens are
--     generated here (244 random bits), returned once, and only their
--     SHA-256 hash and expiry are stored. Nothing recoverable is kept.
--   * Approval records, scope snapshots and the activity log are
--     immutable: UPDATE is always rejected by trigger, and DELETE is
--     only possible as a cascade from deleting the parent project/account.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.project_status as enum
  ('draft', 'awaiting_approval', 'changes_requested', 'active', 'completed', 'cancelled');
create type public.decision as enum ('approved', 'rejected');
create type public.revision_kind as enum ('revision', 'new_work');
create type public.revision_status as enum ('open', 'resolved', 'converted');
create type public.change_order_status as enum ('sent', 'approved', 'rejected', 'withdrawn');
create type public.pricing_type as enum ('fixed', 'hourly');
create type public.milestone_status as enum ('pending', 'paid');
create type public.actor_type as enum ('freelancer', 'client', 'system');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text not null,
  full_name        text check (char_length(full_name) <= 120),
  business_name    text check (char_length(business_name) <= 120),
  default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  onboarded_at     timestamptz,
  -- In-app notifications: client activity newer than this is unread.
  notifications_seen_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  email      text not null check (email = lower(email)
                                  and char_length(email) <= 254
                                  and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company    text check (char_length(company) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, email)
);

create table public.projects (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  client_id             uuid not null references public.clients (id) on delete restrict,
  title                 text not null check (char_length(title) between 1 and 160),
  summary               text check (char_length(summary) <= 4000),
  currency              char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Original agreed budget (minor units). Locked once the scope is approved.
  budget_cents          bigint not null check (budget_cents between 0 and 100000000000),
  -- Sum of approved change orders. Maintained only by portal_decide_change_order.
  approved_extras_cents bigint not null default 0 check (approved_extras_cents >= 0),
  start_date            date,
  due_date              date,
  -- Calendar days added by approved change orders.
  extra_days            integer not null default 0 check (extra_days >= 0),
  status                public.project_status not null default 'draft',
  approved_at           timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index projects_owner_idx on public.projects (owner_id, status);

create table public.deliverables (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  position           integer not null check (position > 0),
  title              text not null check (char_length(title) between 1 and 160),
  description        text check (char_length(description) <= 2000),
  revisions_included integer not null check (revisions_included between 0 and 50),
  created_at         timestamptz not null default now(),
  unique (project_id, position)
);

create table public.scope_snapshots (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  version      integer not null check (version > 0),
  data         jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  unique (project_id, version)
);

create table public.share_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- SHA-256 of the token. The token itself is never stored.
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '181 days')
);
create unique index share_links_one_active_idx
  on public.share_links (project_id) where revoked_at is null;

create table public.scope_decisions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  snapshot_id  uuid not null unique references public.scope_snapshots (id) on delete cascade,
  decision     public.decision not null,
  comment      text check (char_length(comment) <= 4000),
  client_name  text not null check (char_length(client_name) between 1 and 120),
  content_hash text not null,
  user_agent   text check (char_length(user_agent) <= 500),
  ip_address   text check (char_length(ip_address) <= 64),
  created_at   timestamptz not null default now()
);

create table public.revision_requests (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  deliverable_id  uuid references public.deliverables (id) on delete cascade,
  kind            public.revision_kind not null,
  description     text not null check (char_length(description) between 1 and 4000),
  requested_by    text not null check (char_length(requested_by) between 1 and 120),
  -- Decided by the system at request time and never changed.
  in_scope        boolean not null,
  revision_number integer,
  status          public.revision_status not null default 'open',
  resolution_note text check (char_length(resolution_note) <= 2000),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  check ((kind = 'revision') = (deliverable_id is not null)),
  check ((revision_number is not null) = in_scope)
);
create index revision_requests_project_idx on public.revision_requests (project_id, created_at desc);

create table public.change_orders (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  number              integer not null check (number > 0),
  revision_request_id uuid references public.revision_requests (id) on delete set null,
  title               text not null check (char_length(title) between 1 and 160),
  description         text check (char_length(description) <= 4000),
  pricing_type        public.pricing_type not null,
  hours               numeric(8, 2) check (hours > 0 and hours <= 10000),
  hourly_rate_cents   bigint check (hourly_rate_cents between 0 and 100000000),
  amount_cents        bigint not null check (amount_cents between 0 and 100000000000),
  additional_days     integer not null default 0 check (additional_days between 0 and 365),
  status              public.change_order_status not null default 'sent',
  decided_at          timestamptz,
  work_completed_at   timestamptz,
  created_at          timestamptz not null default now(),
  unique (project_id, number),
  check ((pricing_type = 'hourly') = (hours is not null and hourly_rate_cents is not null))
);

create table public.change_order_decisions (
  id              uuid primary key default gen_random_uuid(),
  change_order_id uuid not null unique references public.change_orders (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  decision        public.decision not null,
  comment         text check (char_length(comment) <= 4000),
  client_name     text not null check (char_length(client_name) between 1 and 120),
  -- Exact terms the client saw and agreed to.
  terms           jsonb not null,
  user_agent      text check (char_length(user_agent) <= 500),
  ip_address      text check (char_length(ip_address) <= 64),
  created_at      timestamptz not null default now()
);

create table public.milestones (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  position        integer not null check (position > 0),
  title           text not null check (char_length(title) between 1 and 200),
  amount_cents    bigint not null check (amount_cents between 1 and 100000000000),
  due_date        date,
  status          public.milestone_status not null default 'pending',
  paid_at         timestamptz,
  payment_note    text check (char_length(payment_note) <= 500),
  change_order_id uuid unique references public.change_orders (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (project_id, position),
  check ((status = 'paid') = (paid_at is not null))
);

create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  actor       public.actor_type not null,
  actor_name  text,
  event       text not null,
  summary     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default clock_timestamp()
);
create index activity_log_project_idx on public.activity_log (project_id, created_at desc);

-- Private beta gate. While this table has any rows, only these emails can
-- sign up. Managed by the admin in the Supabase dashboard; invisible to the API.
create table public.beta_allowlist (
  email      text primary key check (email = lower(email) and char_length(email) <= 254),
  note       text,
  created_at timestamptz not null default now()
);
create index activity_log_client_idx on public.activity_log (created_at desc) where actor = 'client';

-- ---------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------
create or replace function public._forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% records are immutable', tg_table_name using errcode = '42501';
  end if;
  -- DELETE is only allowed as a cascade after the parent project is gone.
  if exists (select 1 from public.projects where id = old.project_id) then
    raise exception '% records are immutable', tg_table_name using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger scope_snapshots_immutable before update or delete on public.scope_snapshots
  for each row execute function public._forbid_mutation();
create trigger scope_decisions_immutable before update or delete on public.scope_decisions
  for each row execute function public._forbid_mutation();
create trigger change_order_decisions_immutable before update or delete on public.change_order_decisions
  for each row execute function public._forbid_mutation();
create trigger activity_log_immutable before update or delete on public.activity_log
  for each row execute function public._forbid_mutation();

-- Change order terms can never change after creation; only status fields move.
create or replace function public._guard_change_order_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.project_id, new.number, new.title, new.description, new.pricing_type, new.hours,
      new.hourly_rate_cents, new.amount_cents, new.additional_days, new.created_at)
     is distinct from
     (old.project_id, old.number, old.title, old.description, old.pricing_type, old.hours,
      old.hourly_rate_cents, old.amount_cents, old.additional_days, old.created_at) then
    raise exception 'Change order terms are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger change_orders_terms_immutable before update on public.change_orders
  for each row execute function public._guard_change_order_terms();

-- Revision scope classification is decided once by the system.
create or replace function public._guard_revision_classification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.project_id, new.deliverable_id, new.kind, new.description, new.requested_by,
      new.in_scope, new.revision_number, new.created_at)
     is distinct from
     (old.project_id, old.deliverable_id, old.kind, old.description, old.requested_by,
      old.in_scope, old.revision_number, old.created_at) then
    raise exception 'Revision request details are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger revision_requests_guard before update on public.revision_requests
  for each row execute function public._guard_revision_classification();

-- ---------------------------------------------------------------------
-- New auth user -> profile
-- ---------------------------------------------------------------------
create or replace function public._handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.beta_allowlist)
     and not exists (select 1 from public.beta_allowlist where email = lower(coalesce(new.email, ''))) then
    raise exception 'ScopeFlow is in private beta. This email is not on the invite list.'
      using errcode = '42501';
  end if;
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public._handle_new_user();

-- ---------------------------------------------------------------------
-- Row Level Security (read access only; writes go through functions)
-- ---------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.clients                enable row level security;
alter table public.projects               enable row level security;
alter table public.deliverables           enable row level security;
alter table public.scope_snapshots        enable row level security;
alter table public.share_links            enable row level security;
alter table public.scope_decisions        enable row level security;
alter table public.revision_requests      enable row level security;
alter table public.change_orders          enable row level security;
alter table public.change_order_decisions enable row level security;
alter table public.milestones             enable row level security;
alter table public.activity_log           enable row level security;
alter table public.beta_allowlist         enable row level security;

create policy "own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own clients" on public.clients
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "own projects" on public.projects
  for select to authenticated using (owner_id = (select auth.uid()));

-- Child tables: visible when the parent project is visible.
create policy "own deliverables" on public.deliverables for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own snapshots" on public.scope_snapshots for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own share links" on public.share_links for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own scope decisions" on public.scope_decisions for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own revision requests" on public.revision_requests for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own change orders" on public.change_orders for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own change order decisions" on public.change_order_decisions for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own milestones" on public.milestones for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "own activity" on public.activity_log for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- Internal helpers (not executable by API roles)
-- ---------------------------------------------------------------------
create or replace function public._uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  return v;
end;
$$;

create or replace function public._owned_project(p_id uuid)
returns public.projects
language plpgsql
set search_path = ''
as $$
declare
  v public.projects;
begin
  select * into v from public.projects
   where id = p_id and owner_id = public._uid()
   for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function public._log(
  p_project uuid, p_actor public.actor_type, p_actor_name text,
  p_event text, p_summary text, p_meta jsonb default '{}'::jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.activity_log (project_id, actor, actor_name, event, summary, metadata)
  values (p_project, p_actor, p_actor_name, p_event, p_summary, coalesce(p_meta, '{}'::jsonb));
$$;

create or replace function public._hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- 32 bytes from two v4 UUIDs (pg_strong_random): 244 random bits, base64url, 43 chars.
create or replace function public._new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(decode(
           replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
           'hex'), 'base64'), '+/', '-_'), '=');
$$;

create or replace function public._portal_project(p_token text, p_lock boolean)
returns public.projects
language plpgsql
set search_path = ''
as $$
declare
  v public.projects;
  v_link public.share_links;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'This link is invalid or has been revoked' using errcode = '28000';
  end if;
  select s.* into v_link from public.share_links s
   where s.token_hash = public._hash_token(p_token) and s.revoked_at is null;
  if not found then
    raise exception 'This link is invalid or has been revoked' using errcode = '28000';
  end if;
  if v_link.expires_at <= now() then
    raise exception 'This link has expired. Ask your freelancer for a new one.' using errcode = '28000';
  end if;
  if p_lock then
    select * into v from public.projects where id = v_link.project_id for update;
  else
    select * into v from public.projects where id = v_link.project_id;
  end if;
  return v;
end;
$$;

-- Approver metadata for audit records, taken from the HTTP request as seen by
-- Supabase's API gateway (PostgREST exposes it as request.headers). The browser
-- can't supply these values through function arguments.
create or replace function public._request_meta()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  if h is null then
    return jsonb_build_object('ua', null, 'ip', null);
  end if;
  return jsonb_build_object(
    'ua', left(h ->> 'user-agent', 500),
    'ip', left(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip',
                        nullif(trim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), '')), 64));
end;
$$;

create or replace function public._clean_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Please enter your name' using errcode = '22023';
  end if;
  return left(trim(p_name), 120);
end;
$$;

create or replace function public._build_scope(p_project_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'title', p.title,
    'summary', p.summary,
    'currency', p.currency,
    'budget_cents', p.budget_cents,
    'start_date', p.start_date,
    'due_date', p.due_date,
    'client', jsonb_build_object('name', c.name, 'company', c.company, 'email', c.email),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'revisions_included', d.revisions_included) order by d.position)
        from public.deliverables d where d.project_id = p.id), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', m.title, 'amount_cents', m.amount_cents, 'due_date', m.due_date)
             order by m.position)
        from public.milestones m where m.project_id = p.id), '[]'::jsonb)
  )
  from public.projects p
  join public.clients c on c.id = p.client_id
  where p.id = p_project_id;
$$;

-- ---------------------------------------------------------------------
-- Freelancer API
-- ---------------------------------------------------------------------
create or replace function public.complete_onboarding(
  p_full_name text, p_business_name text, p_currency text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_full_name is null or char_length(trim(p_full_name)) = 0 then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  update public.profiles
     set full_name = left(trim(p_full_name), 120),
         business_name = nullif(left(trim(coalesce(p_business_name, '')), 120), ''),
         default_currency = upper(p_currency),
         onboarded_at = coalesce(onboarded_at, now()),
         updated_at = now()
   where id = public._uid();
end;
$$;

-- Create (p_project_id = null) or edit a project whose scope is not locked.
create or replace function public.save_project(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_project public.projects;
  v_client_id uuid;
  v_item jsonb;
  v_pos integer;
  v_deliverables jsonb := coalesce(p -> 'deliverables', '[]'::jsonb);
  v_milestones jsonb := coalesce(p -> 'milestones', '[]'::jsonb);
begin
  if jsonb_typeof(v_deliverables) <> 'array'
     or jsonb_array_length(v_deliverables) not between 1 and 50 then
    raise exception 'Add between 1 and 50 deliverables' using errcode = '22023';
  end if;
  if jsonb_typeof(v_milestones) <> 'array' or jsonb_array_length(v_milestones) > 50 then
    raise exception 'Add at most 50 payment milestones' using errcode = '22023';
  end if;

  if p_project_id is not null then
    v_project := public._owned_project(p_project_id);
    if v_project.status not in ('draft', 'changes_requested') then
      raise exception 'The scope is locked. Use a change order to modify an approved project.'
        using errcode = '55000';
    end if;
  end if;

  insert into public.clients (owner_id, name, email, company)
  values (v_uid,
          trim(p -> 'client' ->> 'name'),
          lower(trim(p -> 'client' ->> 'email')),
          nullif(trim(coalesce(p -> 'client' ->> 'company', '')), ''))
  on conflict (owner_id, email) do update
     set name = excluded.name, company = excluded.company, updated_at = now()
  returning id into v_client_id;

  if p_project_id is null then
    insert into public.projects (owner_id, client_id, title, summary, currency, budget_cents, start_date, due_date)
    values (v_uid, v_client_id,
            trim(p ->> 'title'),
            nullif(trim(coalesce(p ->> 'summary', '')), ''),
            upper(p ->> 'currency'),
            (p ->> 'budget_cents')::bigint,
            nullif(p ->> 'start_date', '')::date,
            nullif(p ->> 'due_date', '')::date)
    returning * into v_project;
    perform public._log(v_project.id, 'freelancer', null, 'project.created', 'Project created');
  else
    update public.projects
       set client_id = v_client_id,
           title = trim(p ->> 'title'),
           summary = nullif(trim(coalesce(p ->> 'summary', '')), ''),
           currency = upper(p ->> 'currency'),
           budget_cents = (p ->> 'budget_cents')::bigint,
           start_date = nullif(p ->> 'start_date', '')::date,
           due_date = nullif(p ->> 'due_date', '')::date,
           updated_at = now()
     where id = p_project_id
    returning * into v_project;
    delete from public.deliverables where project_id = v_project.id;
    delete from public.milestones where project_id = v_project.id;
    perform public._log(v_project.id, 'freelancer', null, 'project.updated', 'Scope edited');
  end if;

  v_pos := 0;
  for v_item in select value from jsonb_array_elements(v_deliverables) loop
    v_pos := v_pos + 1;
    insert into public.deliverables (project_id, position, title, description, revisions_included)
    values (v_project.id, v_pos,
            trim(v_item ->> 'title'),
            nullif(trim(coalesce(v_item ->> 'description', '')), ''),
            (v_item ->> 'revisions_included')::integer);
  end loop;

  v_pos := 0;
  for v_item in select value from jsonb_array_elements(v_milestones) loop
    v_pos := v_pos + 1;
    insert into public.milestones (project_id, position, title, amount_cents, due_date)
    values (v_project.id, v_pos,
            trim(v_item ->> 'title'),
            (v_item ->> 'amount_cents')::bigint,
            nullif(v_item ->> 'due_date', '')::date);
  end loop;

  return v_project.id;
end;
$$;

create or replace function public.delete_draft_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
begin
  if v.status <> 'draft' or exists (select 1 from public.scope_snapshots where project_id = v.id) then
    raise exception 'Only drafts that were never sent can be deleted. Cancel the project instead.'
      using errcode = '55000';
  end if;
  delete from public.projects where id = v.id;
end;
$$;

-- Internal: revoke any active link and create a new one. Returns the raw
-- token exactly once; only its hash is stored.
create or replace function public._issue_link(p_project_id uuid, p_days integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_token text := public._new_token();
  v_expires timestamptz;
  v_had_link boolean;
begin
  if p_days is null or p_days not between 1 and 180 then
    raise exception 'Link validity must be between 1 and 180 days' using errcode = '22023';
  end if;
  update public.share_links set revoked_at = now()
   where project_id = p_project_id and revoked_at is null;
  v_had_link := found;
  insert into public.share_links (project_id, token_hash, expires_at)
  values (p_project_id, public._hash_token(v_token), now() + make_interval(days => p_days))
  returning expires_at into v_expires;
  perform public._log(p_project_id, 'freelancer', null,
    case when v_had_link then 'link.rotated' else 'link.created' end,
    case when v_had_link then 'New client link created; the previous link no longer works'
         else 'Client link created' end,
    jsonb_build_object('expires_at', v_expires));
  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

create or replace function public.rotate_share_link(p_project_id uuid, p_expires_in_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
begin
  if v.status = 'cancelled' then
    raise exception 'This project is cancelled' using errcode = '55000';
  end if;
  return public._issue_link(v.id, p_expires_in_days);
end;
$$;

create or replace function public.revoke_share_link(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
begin
  update public.share_links set revoked_at = now()
   where project_id = v.id and revoked_at is null;
  if found then
    perform public._log(v.id, 'freelancer', null, 'link.revoked', 'Client link revoked');
  end if;
end;
$$;

create or replace function public.send_scope(p_project_id uuid, p_link_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
  v_data jsonb;
  v_hash text;
  v_version integer;
  v_id uuid;
  v_link jsonb;
begin
  if v.status not in ('draft', 'changes_requested') then
    raise exception 'This scope has already been sent' using errcode = '55000';
  end if;
  if not exists (select 1 from public.deliverables where project_id = v.id) then
    raise exception 'Add at least one deliverable before sending' using errcode = '22023';
  end if;

  v_data := public._build_scope(v.id);
  v_hash := encode(sha256(convert_to(v_data::text, 'UTF8')), 'hex');
  select coalesce(max(version), 0) + 1 into v_version
    from public.scope_snapshots where project_id = v.id;

  insert into public.scope_snapshots (project_id, version, data, content_hash)
  values (v.id, v_version, v_data, v_hash)
  returning id into v_id;

  update public.projects set status = 'awaiting_approval', updated_at = now() where id = v.id;
  perform public._log(v.id, 'freelancer', null, 'scope.sent',
    format('Scope v%s sent to client for approval', v_version),
    jsonb_build_object('snapshot_id', v_id, 'version', v_version, 'content_hash', v_hash));

  -- Make sure the client has a working link; a new one is returned only if created now.
  if not exists (select 1 from public.share_links
                  where project_id = v.id and revoked_at is null and expires_at > now()) then
    v_link := public._issue_link(v.id, p_link_days);
  end if;

  return jsonb_build_object('snapshot_id', v_id, 'version', v_version, 'content_hash', v_hash,
                            'link', v_link);
end;
$$;

-- Pull a sent scope back for editing before the client decides.
create or replace function public.recall_scope(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
begin
  if v.status <> 'awaiting_approval' then
    raise exception 'Only a scope awaiting approval can be recalled' using errcode = '55000';
  end if;
  update public.projects set status = 'draft', updated_at = now() where id = v.id;
  perform public._log(v.id, 'freelancer', null, 'scope.recalled', 'Scope recalled for editing');
end;
$$;

create or replace function public.resolve_revision(p_revision_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.revision_requests;
  v public.projects;
begin
  select * into r from public.revision_requests where id = p_revision_id;
  if not found then
    raise exception 'Revision request not found' using errcode = 'P0002';
  end if;
  v := public._owned_project(r.project_id);
  if r.status <> 'open' then
    raise exception 'This request is not open' using errcode = '55000';
  end if;
  update public.revision_requests
     set status = 'resolved', resolved_at = now(),
         resolution_note = nullif(left(trim(coalesce(p_note, '')), 2000), '')
   where id = r.id;
  perform public._log(v.id, 'freelancer', null, 'revision.resolved', 'Revision request marked as done',
    jsonb_build_object('revision_request_id', r.id));
end;
$$;

create or replace function public.create_change_order(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
  v_type public.pricing_type := (p ->> 'pricing_type')::public.pricing_type;
  v_hours numeric(8, 2);
  v_rate bigint;
  v_amount bigint;
  v_days integer := coalesce((p ->> 'additional_days')::integer, 0);
  v_rr uuid := nullif(p ->> 'revision_request_id', '')::uuid;
  v_number integer;
  v_id uuid;
begin
  if v.status <> 'active' then
    raise exception 'Change orders can only be proposed on active projects' using errcode = '55000';
  end if;

  if v_type = 'fixed' then
    v_amount := (p ->> 'amount_cents')::bigint;
    if v_amount is null then
      raise exception 'Enter a price' using errcode = '22023';
    end if;
  else
    v_hours := (p ->> 'hours')::numeric(8, 2);
    v_rate := (p ->> 'hourly_rate_cents')::bigint;
    if v_hours is null or v_rate is null then
      raise exception 'Enter hours and an hourly rate' using errcode = '22023';
    end if;
    -- Authoritative price calculation (half-up to the nearest minor unit).
    v_amount := round(v_hours * v_rate)::bigint;
  end if;

  if v_rr is not null then
    update public.revision_requests set status = 'converted'
     where id = v_rr and project_id = v.id and status = 'open';
    if not found then
      raise exception 'That revision request is not open on this project' using errcode = '55000';
    end if;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.change_orders where project_id = v.id;

  insert into public.change_orders (project_id, number, revision_request_id, title, description,
                                    pricing_type, hours, hourly_rate_cents, amount_cents, additional_days)
  values (v.id, v_number, v_rr, trim(p ->> 'title'),
          nullif(trim(coalesce(p ->> 'description', '')), ''),
          v_type, v_hours, v_rate, v_amount, v_days)
  returning id into v_id;

  perform public._log(v.id, 'freelancer', null, 'change_order.sent',
    format('Change order #%s proposed: %s', v_number, trim(p ->> 'title')),
    jsonb_build_object('change_order_id', v_id, 'amount_cents', v_amount, 'additional_days', v_days));
  return v_id;
end;
$$;

create or replace function public.withdraw_change_order(p_change_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  co public.change_orders;
  v public.projects;
begin
  select * into co from public.change_orders where id = p_change_order_id;
  if not found then
    raise exception 'Change order not found' using errcode = 'P0002';
  end if;
  v := public._owned_project(co.project_id);
  if co.status <> 'sent' then
    raise exception 'Only a pending change order can be withdrawn' using errcode = '55000';
  end if;
  update public.change_orders set status = 'withdrawn', decided_at = now() where id = co.id;
  if co.revision_request_id is not null then
    update public.revision_requests set status = 'open'
     where id = co.revision_request_id and status = 'converted';
  end if;
  perform public._log(v.id, 'freelancer', null, 'change_order.withdrawn',
    format('Change order #%s withdrawn', co.number), jsonb_build_object('change_order_id', co.id));
end;
$$;

create or replace function public.complete_change_order_work(p_change_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  co public.change_orders;
  v public.projects;
begin
  select * into co from public.change_orders where id = p_change_order_id;
  if not found then
    raise exception 'Change order not found' using errcode = 'P0002';
  end if;
  v := public._owned_project(co.project_id);
  if co.status <> 'approved' or co.work_completed_at is not null then
    raise exception 'Only approved, unfinished change orders can be completed' using errcode = '55000';
  end if;
  update public.change_orders set work_completed_at = now() where id = co.id;
  perform public._log(v.id, 'freelancer', null, 'change_order.completed',
    format('Work for change order #%s delivered', co.number), jsonb_build_object('change_order_id', co.id));
end;
$$;

create or replace function public.set_milestone_paid(p_milestone_id uuid, p_paid boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.milestones;
  v public.projects;
begin
  select * into m from public.milestones where id = p_milestone_id;
  if not found then
    raise exception 'Milestone not found' using errcode = 'P0002';
  end if;
  v := public._owned_project(m.project_id);
  if v.status not in ('active', 'completed') then
    raise exception 'Payments can be recorded once the client has approved the scope' using errcode = '55000';
  end if;
  if p_paid then
    if m.status = 'paid' then
      raise exception 'Milestone is already marked as paid' using errcode = '55000';
    end if;
    update public.milestones
       set status = 'paid', paid_at = now(),
           payment_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
     where id = m.id;
    perform public._log(v.id, 'freelancer', null, 'milestone.paid',
      format('Payment recorded: %s', m.title),
      jsonb_build_object('milestone_id', m.id, 'amount_cents', m.amount_cents));
  else
    if m.status <> 'paid' then
      raise exception 'Milestone is not marked as paid' using errcode = '55000';
    end if;
    update public.milestones set status = 'pending', paid_at = null, payment_note = null where id = m.id;
    perform public._log(v.id, 'freelancer', null, 'milestone.unpaid',
      format('Payment mark reverted: %s', m.title),
      jsonb_build_object('milestone_id', m.id, 'amount_cents', m.amount_cents));
  end if;
end;
$$;

create or replace function public.complete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
begin
  if v.status <> 'active' then
    raise exception 'Only active projects can be completed' using errcode = '55000';
  end if;
  if exists (select 1 from public.change_orders where project_id = v.id and status = 'sent') then
    raise exception 'Resolve pending change orders first' using errcode = '55000';
  end if;
  update public.projects set status = 'completed', completed_at = now(), updated_at = now() where id = v.id;
  perform public._log(v.id, 'freelancer', null, 'project.completed', 'Project marked as completed');
end;
$$;

create or replace function public.cancel_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
begin
  if v.status in ('completed', 'cancelled') then
    raise exception 'This project is already closed' using errcode = '55000';
  end if;
  update public.projects set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v.id;
  update public.change_orders set status = 'withdrawn', decided_at = now()
   where project_id = v.id and status = 'sent';
  perform public._log(v.id, 'freelancer', null, 'project.cancelled', 'Project cancelled');
end;
$$;

-- ---------------------------------------------------------------------
-- Client portal API (token-gated; callable without an account)
-- ---------------------------------------------------------------------
create or replace function public.portal_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._portal_project(p_token, false);
  v_owner public.profiles;
  v_client public.clients;
  v_snap public.scope_snapshots;
begin
  select * into v_owner from public.profiles where id = v.owner_id;
  select * into v_client from public.clients where id = v.client_id;
  select * into v_snap from public.scope_snapshots
   where project_id = v.id order by version desc limit 1;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'title', v.title, 'status', v.status, 'currency', v.currency,
      'budget_cents', v.budget_cents, 'approved_extras_cents', v.approved_extras_cents,
      'start_date', v.start_date, 'due_date', v.due_date, 'extra_days', v.extra_days,
      'approved_at', v.approved_at),
    'freelancer', jsonb_build_object(
      'name', coalesce(v_owner.business_name, v_owner.full_name, 'Your freelancer')),
    'client', jsonb_build_object('name', v_client.name, 'company', v_client.company),
    'snapshot', case when v_snap.id is null then null else jsonb_build_object(
      'id', v_snap.id, 'version', v_snap.version, 'data', v_snap.data,
      'content_hash', v_snap.content_hash, 'created_at', v_snap.created_at,
      'decision', (select jsonb_build_object('decision', d.decision, 'comment', d.comment,
                                             'client_name', d.client_name, 'created_at', d.created_at)
                     from public.scope_decisions d where d.snapshot_id = v_snap.id)) end,
    'deliverables', case when v.approved_at is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'revisions_included', d.revisions_included,
               'revisions_used', (select count(*) from public.revision_requests r
                                   where r.deliverable_id = d.id and r.kind = 'revision' and r.in_scope))
             order by d.position)
        from public.deliverables d where d.project_id = v.id), '[]'::jsonb) end,
    'revision_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'kind', r.kind, 'description', r.description,
               'deliverable_title', d.title, 'in_scope', r.in_scope,
               'revision_number', r.revision_number, 'status', r.status,
               'resolution_note', r.resolution_note, 'created_at', r.created_at)
             order by r.created_at desc)
        from public.revision_requests r
        left join public.deliverables d on d.id = r.deliverable_id
       where r.project_id = v.id), '[]'::jsonb),
    'change_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'number', c.number, 'title', c.title, 'description', c.description,
               'pricing_type', c.pricing_type, 'hours', c.hours,
               'hourly_rate_cents', c.hourly_rate_cents, 'amount_cents', c.amount_cents,
               'additional_days', c.additional_days, 'status', c.status,
               'created_at', c.created_at, 'decided_at', c.decided_at,
               'work_completed_at', c.work_completed_at,
               'decision', (select jsonb_build_object('client_name', x.client_name, 'comment', x.comment,
                                                      'created_at', x.created_at)
                              from public.change_order_decisions x where x.change_order_id = c.id))
             order by c.number desc)
        from public.change_orders c
       where c.project_id = v.id and c.status <> 'withdrawn'), '[]'::jsonb),
    'milestones', case when v.approved_at is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', m.title, 'amount_cents', m.amount_cents, 'due_date', m.due_date,
               'status', m.status, 'paid_at', m.paid_at) order by m.position)
        from public.milestones m where m.project_id = v.id), '[]'::jsonb) end
  );
end;
$$;

create or replace function public.portal_decide_scope(
  p_token text, p_snapshot_id uuid, p_decision public.decision,
  p_client_name text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._portal_project(p_token, true);
  v_snap public.scope_snapshots;
  v_name text := public._clean_name(p_client_name);
  v_comment text := nullif(left(trim(coalesce(p_comment, '')), 4000), '');
begin
  if v.status <> 'awaiting_approval' then
    raise exception 'This scope is not awaiting approval' using errcode = '55000';
  end if;
  select * into v_snap from public.scope_snapshots
   where project_id = v.id order by version desc limit 1;
  if v_snap.id is distinct from p_snapshot_id then
    raise exception 'A newer version of this scope exists. Refresh the page.' using errcode = '55000';
  end if;
  if p_decision = 'rejected' and v_comment is null then
    raise exception 'Please describe what needs to change' using errcode = '22023';
  end if;

  insert into public.scope_decisions (project_id, snapshot_id, decision, comment, client_name,
                                      content_hash, user_agent, ip_address)
  values (v.id, v_snap.id, p_decision, v_comment, v_name, v_snap.content_hash,
          public._request_meta() ->> 'ua', public._request_meta() ->> 'ip');

  if p_decision = 'approved' then
    update public.projects set status = 'active', approved_at = now(), updated_at = now() where id = v.id;
    perform public._log(v.id, 'client', v_name, 'scope.approved',
      format('Scope v%s approved by %s', v_snap.version, v_name),
      jsonb_build_object('snapshot_id', v_snap.id, 'content_hash', v_snap.content_hash));
  else
    update public.projects set status = 'changes_requested', updated_at = now() where id = v.id;
    perform public._log(v.id, 'client', v_name, 'scope.rejected',
      format('Scope v%s returned with changes by %s', v_snap.version, v_name),
      jsonb_build_object('snapshot_id', v_snap.id, 'comment', v_comment));
  end if;

  return jsonb_build_object('project_id', v.id, 'owner_id', v.owner_id, 'title', v.title,
                            'decision', p_decision, 'version', v_snap.version,
                            'client_name', v_name, 'comment', v_comment);
end;
$$;

create or replace function public.portal_request_revision(
  p_token text, p_kind public.revision_kind, p_deliverable_id uuid,
  p_description text, p_client_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._portal_project(p_token, true);
  v_name text := public._clean_name(p_client_name);
  v_desc text := nullif(left(trim(coalesce(p_description, '')), 4000), '');
  v_del public.deliverables;
  v_used integer := 0;
  v_in_scope boolean := false;
  v_number integer;
  v_id uuid;
  v_summary text;
begin
  if v.status <> 'active' then
    raise exception 'Requests can only be made while the project is in progress' using errcode = '55000';
  end if;
  if v_desc is null then
    raise exception 'Please describe the change you need' using errcode = '22023';
  end if;
  if (select count(*) from public.revision_requests
       where project_id = v.id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many requests in the last hour. Please try again later.' using errcode = '55000';
  end if;

  if p_kind = 'revision' then
    select * into v_del from public.deliverables where id = p_deliverable_id and project_id = v.id;
    if not found then
      raise exception 'Choose a deliverable from this project' using errcode = '22023';
    end if;
    -- Scope check: the project row is locked, so concurrent requests serialize here.
    select count(*) into v_used from public.revision_requests
     where deliverable_id = v_del.id and kind = 'revision' and in_scope;
    v_in_scope := v_used < v_del.revisions_included;
    if v_in_scope then
      v_number := v_used + 1;
      v_summary := format('Revision %s of %s requested for "%s"', v_number, v_del.revisions_included, v_del.title);
    else
      v_summary := format('Revision requested for "%s" beyond the %s included — needs a change order',
                          v_del.title, v_del.revisions_included);
    end if;
  else
    v_summary := 'New work requested outside the original scope — needs a change order';
  end if;

  insert into public.revision_requests (project_id, deliverable_id, kind, description, requested_by,
                                        in_scope, revision_number)
  values (v.id, case when p_kind = 'revision' then v_del.id end, p_kind, v_desc, v_name,
          v_in_scope, v_number)
  returning id into v_id;

  perform public._log(v.id, 'client', v_name, 'revision.requested', v_summary,
    jsonb_build_object('revision_request_id', v_id, 'in_scope', v_in_scope));

  return jsonb_build_object('id', v_id, 'project_id', v.id, 'owner_id', v.owner_id, 'title', v.title,
                            'in_scope', v_in_scope, 'revision_number', v_number,
                            'revisions_included', v_del.revisions_included,
                            'deliverable_title', v_del.title, 'summary', v_summary,
                            'client_name', v_name);
end;
$$;

create or replace function public.portal_decide_change_order(
  p_token text, p_change_order_id uuid, p_decision public.decision,
  p_client_name text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._portal_project(p_token, true);
  v_name text := public._clean_name(p_client_name);
  v_comment text := nullif(left(trim(coalesce(p_comment, '')), 4000), '');
  co public.change_orders;
  v_terms jsonb;
  v_pos integer;
begin
  if v.status <> 'active' then
    raise exception 'This project is not in progress' using errcode = '55000';
  end if;
  select * into co from public.change_orders
   where id = p_change_order_id and project_id = v.id for update;
  if not found then
    raise exception 'Change order not found' using errcode = 'P0002';
  end if;
  if co.status <> 'sent' then
    raise exception 'This change order is no longer awaiting a decision' using errcode = '55000';
  end if;

  v_terms := jsonb_build_object(
    'number', co.number, 'title', co.title, 'description', co.description,
    'pricing_type', co.pricing_type, 'hours', co.hours, 'hourly_rate_cents', co.hourly_rate_cents,
    'amount_cents', co.amount_cents, 'additional_days', co.additional_days, 'currency', v.currency);

  insert into public.change_order_decisions (change_order_id, project_id, decision, comment, client_name,
                                             terms, user_agent, ip_address)
  values (co.id, v.id, p_decision, v_comment, v_name, v_terms, public._request_meta() ->> 'ua', public._request_meta() ->> 'ip');

  update public.change_orders
     set status = case when p_decision = 'approved' then 'approved' else 'rejected' end::public.change_order_status,
         decided_at = now()
   where id = co.id;

  if p_decision = 'approved' then
    update public.projects
       set approved_extras_cents = approved_extras_cents + co.amount_cents,
           extra_days = extra_days + co.additional_days,
           updated_at = now()
     where id = v.id;
    if co.amount_cents > 0 then
      select coalesce(max(position), 0) + 1 into v_pos from public.milestones where project_id = v.id;
      insert into public.milestones (project_id, position, title, amount_cents, change_order_id)
      values (v.id, v_pos, format('Change order #%s: %s', co.number, co.title), co.amount_cents, co.id);
    end if;
    perform public._log(v.id, 'client', v_name, 'change_order.approved',
      format('Change order #%s approved by %s', co.number, v_name), v_terms);
  else
    if co.revision_request_id is not null then
      update public.revision_requests set status = 'open'
       where id = co.revision_request_id and status = 'converted';
    end if;
    perform public._log(v.id, 'client', v_name, 'change_order.rejected',
      format('Change order #%s declined by %s', co.number, v_name),
      jsonb_build_object('change_order_id', co.id, 'comment', v_comment));
  end if;

  return jsonb_build_object('project_id', v.id, 'owner_id', v.owner_id, 'title', v.title,
                            'decision', p_decision, 'number', co.number, 'change_order_title', co.title,
                            'client_name', v_name, 'comment', v_comment);
end;
$$;

-- ---------------------------------------------------------------------
-- In-app notifications and health check
-- ---------------------------------------------------------------------
create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.activity_log a
    join public.projects p on p.id = a.project_id
    join public.profiles pr on pr.id = p.owner_id
   where p.owner_id = auth.uid()
     and a.actor = 'client'
     and a.created_at > pr.notifications_seen_at;
$$;

create or replace function public.mark_notifications_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set notifications_seen_at = now() where id = auth.uid();
$$;

-- Used by the Worker's daily cron so the free project isn't paused for inactivity.
create or replace function public.health()
returns text
language sql
stable
set search_path = ''
as $$ select 'ok'::text $$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select on
  public.profiles, public.clients, public.projects, public.deliverables, public.scope_snapshots,
  public.scope_decisions, public.revision_requests, public.change_orders,
  public.change_order_decisions, public.milestones, public.activity_log
to authenticated;
-- Owners can see link status, never the hash.
grant select (id, project_id, created_at, expires_at, revoked_at) on public.share_links to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.complete_onboarding(text, text, text),
  public.save_project(uuid, jsonb),
  public.delete_draft_project(uuid),
  public.rotate_share_link(uuid, integer),
  public.revoke_share_link(uuid),
  public.send_scope(uuid, integer),
  public.recall_scope(uuid),
  public.resolve_revision(uuid, text),
  public.create_change_order(uuid, jsonb),
  public.withdraw_change_order(uuid),
  public.complete_change_order_work(uuid),
  public.set_milestone_paid(uuid, boolean, text),
  public.complete_project(uuid),
  public.cancel_project(uuid),
  public.unread_notification_count(),
  public.mark_notifications_seen()
to authenticated;

grant execute on function public.health() to anon, authenticated;

grant execute on function
  public.portal_view(text),
  public.portal_decide_scope(text, uuid, public.decision, text, text),
  public.portal_request_revision(text, public.revision_kind, uuid, text, text),
  public.portal_decide_change_order(text, uuid, public.decision, text, text)
to anon, authenticated;

-- Functions created later should not be callable by default.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
