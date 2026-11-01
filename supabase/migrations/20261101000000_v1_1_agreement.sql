-- =====================================================================
-- ScopeFlow v1.1 — clearer agreements, approval timeline, retry-safe revisions.
--
--   * projects.exclusions / terms / extra_revision_cents: part of the scope the
--     client approves (copied into each scope snapshot and its fingerprint);
--     editable only while the scope is unlocked, through save_project.
--   * "Viewed": portal_view records the first time a client opens a scope
--     version awaiting a decision, as an immutable activity_log event.
--   * Revision requests: optional client request id makes retries idempotent;
--     a unique index guarantees each included revision number is used once.
--
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE.
-- Backward compatible: new columns are nullable; save_project keeps them when a
-- v1.0 client omits them; portal_request_revision still accepts v1.0 calls.
-- Rollback: supabase/rollback/20261101000000_v1_1_agreement_down.sql
-- =====================================================================

alter table public.projects
  add column if not exists exclusions text check (char_length(exclusions) <= 4000),
  add column if not exists terms text check (char_length(terms) <= 4000),
  add column if not exists extra_revision_cents bigint check (extra_revision_cents between 0 and 100000000000);

alter table public.revision_requests
  add column if not exists client_request_id uuid;

create unique index if not exists revision_requests_client_request_once
  on public.revision_requests (project_id, client_request_id)
  where client_request_id is not null;

create unique index if not exists revision_requests_number_once
  on public.revision_requests (deliverable_id, revision_number)
  where in_scope;

create unique index if not exists activity_scope_viewed_once
  on public.activity_log ((metadata ->> 'snapshot_id'))
  where event = 'scope.viewed';

-- The request id is part of what a client submitted: immutable like the rest.
create or replace function public._guard_revision_classification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.project_id, new.deliverable_id, new.kind, new.description, new.requested_by,
      new.in_scope, new.revision_number, new.created_at, new.client_request_id)
     is distinct from
     (old.project_id, old.deliverable_id, old.kind, old.description, old.requested_by,
      old.in_scope, old.revision_number, old.created_at, old.client_request_id) then
    raise exception 'Revision request details are immutable' using errcode = '42501';
  end if;
  return new;
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
    'exclusions', p.exclusions,
    'terms', p.terms,
    'extra_revision_cents', p.extra_revision_cents,
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
    insert into public.projects (owner_id, client_id, title, summary, currency, budget_cents, start_date, due_date,
                                 exclusions, terms, extra_revision_cents)
    values (v_uid, v_client_id,
            trim(p ->> 'title'),
            nullif(trim(coalesce(p ->> 'summary', '')), ''),
            upper(p ->> 'currency'),
            (p ->> 'budget_cents')::bigint,
            nullif(p ->> 'start_date', '')::date,
            nullif(p ->> 'due_date', '')::date,
            nullif(trim(coalesce(p ->> 'exclusions', '')), ''),
            nullif(trim(coalesce(p ->> 'terms', '')), ''),
            nullif(p ->> 'extra_revision_cents', '')::bigint)
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
           -- Backward compatible: a client that doesn't send these keys (v1.0 app) keeps them.
           exclusions = case when p ? 'exclusions' then nullif(trim(coalesce(p ->> 'exclusions', '')), '') else exclusions end,
           terms = case when p ? 'terms' then nullif(trim(coalesce(p ->> 'terms', '')), '') else terms end,
           extra_revision_cents = case when p ? 'extra_revision_cents' then nullif(p ->> 'extra_revision_cents', '')::bigint
                                       else extra_revision_cents end,
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

create or replace function public.portal_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  v public.projects;
  v_owner public.profiles;
  v_client public.clients;
  v_snap public.scope_snapshots;
begin
  select * into g from public._portal_gate(p_token, false, false);
  if g.o_error is not null then
    return public._portal_error(g.o_error);
  end if;
  v := g.o_project;
  select * into v_owner from public.profiles where id = v.owner_id;
  select * into v_client from public.clients where id = v.client_id;
  select * into v_snap from public.scope_snapshots
   where project_id = v.id order by version desc limit 1;

  -- Approval timeline: note the first time the client opens a scope version that is
  -- still waiting for a decision. Once per version (unique index), never repeated.
  if v_snap.id is not null and v.status = 'awaiting_approval'
     and not exists (select 1 from public.scope_decisions where snapshot_id = v_snap.id) then
    insert into public.activity_log (project_id, actor, actor_name, event, summary, metadata)
    values (v.id, 'client', v_client.name, 'scope.viewed',
            format('Client opened scope v%s', v_snap.version),
            jsonb_build_object('snapshot_id', v_snap.id, 'version', v_snap.version))
    on conflict ((metadata ->> 'snapshot_id')) where event = 'scope.viewed' do nothing;
  end if;

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
      'id', v_snap.id, 'version', v_snap.version, 'data', v_snap.data #- '{client,email}',
      'content_hash', v_snap.content_hash, 'created_at', v_snap.created_at,
      'decision', (select jsonb_build_object('decision', d.decision, 'comment', d.comment,
                                             'client_name', d.client_name, 'created_at', d.created_at)
                     from public.scope_decisions d where d.snapshot_id = v_snap.id)) end,
    'deliverables', case when v.approved_at is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'revisions_included', d.revisions_included,
               'revisions_used', (select count(*) from public.revision_requests r
                                   where r.deliverable_id = d.id and r.kind = 'revision' and r.in_scope),
               'revisions_extra', (select count(*) from public.revision_requests r
                                    where r.deliverable_id = d.id and r.kind = 'revision' and not r.in_scope))
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

-- New optional parameter: replace the v1.0 signature (old calls still match via the default).
drop function if exists public.portal_request_revision(text, public.revision_kind, uuid, text, text);
create or replace function public.portal_request_revision(
  p_token text, p_kind public.revision_kind, p_deliverable_id uuid,
  p_description text, p_client_name text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  v public.projects;
  v_name text := public._clean_name(p_client_name);
  v_desc text := nullif(left(trim(coalesce(p_description, '')), 4000), '');
  v_del public.deliverables;
  v_used integer := 0;
  v_in_scope boolean := false;
  v_number integer;
  v_id uuid;
  v_summary text;
  v_prior public.revision_requests;
begin
  select * into g from public._portal_gate(p_token, true, true);
  if g.o_error is not null then
    return public._portal_error(g.o_error);
  end if;
  v := g.o_project;

  -- Retries of the same submission (double tap, network retry) return the original
  -- result instead of using up another revision. The project row is locked above, so
  -- this check and the insert below can't interleave with a concurrent request.
  if p_request_id is not null then
    select * into v_prior from public.revision_requests
     where project_id = v.id and client_request_id = p_request_id;
    if found then
      return jsonb_build_object('ok', true, 'in_scope', v_prior.in_scope, 'revision_number', v_prior.revision_number,
                                'revisions_included', (select revisions_included from public.deliverables
                                                        where id = v_prior.deliverable_id),
                                'duplicate', true);
    end if;
  end if;

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
                                        in_scope, revision_number, client_request_id)
  values (v.id, case when p_kind = 'revision' then v_del.id end, p_kind, v_desc, v_name,
          v_in_scope, v_number, p_request_id)
  returning id into v_id;

  perform public._log(v.id, 'client', v_name, 'revision.requested', v_summary,
    jsonb_build_object('revision_request_id', v_id, 'in_scope', v_in_scope));

  -- Public response: only what the client UI needs. No internal identifiers.
  return jsonb_build_object('ok', true, 'in_scope', v_in_scope, 'revision_number', v_number,
                            'revisions_included', v_del.revisions_included);
end;
$$;

revoke all on function public.portal_request_revision(text, public.revision_kind, uuid, text, text, uuid) from public;
grant execute on function public.portal_request_revision(text, public.revision_kind, uuid, text, text, uuid) to anon, authenticated;
