-- =====================================================================
-- ScopeFlow — Requests received outside ScopeFlow, and adding clients directly.
--
--   * revision_requests.source / received_on: where a request came from (the client link,
--     or WhatsApp, a call, email or a meeting, logged by the freelancer) and when.
--   * log_client_request(): the freelancer logs a request the client made elsewhere. It goes
--     through the same scope check as the client link (included round, or beyond the limit /
--     new work → needs a change order), under the same project lock, so counts stay exact.
--     Optional client_request_id makes a double tap harmless.
--   * create_client(): add a client without creating a project (plan limits apply).
--   * portal_view shows the client where each request came from.
--
-- Safe to re-run. Rollback: supabase/rollback/20261109000000_outside_requests_down.sql
-- =====================================================================

alter table public.revision_requests
  add column if not exists source text not null default 'portal'
    check (source in ('portal', 'whatsapp', 'call', 'email', 'meeting', 'other')),
  add column if not exists received_on date;

create or replace function public.log_client_request(p_project_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  c public.clients;
  v_kind public.revision_kind := coalesce(nullif(p ->> 'kind', ''), 'revision')::public.revision_kind;
  v_desc text := nullif(left(trim(coalesce(p ->> 'description', '')), 4000), '');
  v_source text := coalesce(nullif(p ->> 'source', ''), 'other');
  v_on date := coalesce(nullif(p ->> 'received_on', '')::date, current_date);
  v_req uuid := nullif(p ->> 'client_request_id', '')::uuid;
  v_del public.deliverables;
  v_used integer := 0;
  v_in_scope boolean := false;
  v_number integer;
  v_id uuid;
  v_summary text;
  v_prior public.revision_requests;
  v_via text;
begin
  v := public._owned_project(p_project_id);
  -- Same lock as client requests: concurrent requests are counted one at a time.
  perform 1 from public.projects where id = v.id for update;
  if v_req is not null then
    select * into v_prior from public.revision_requests where project_id = v.id and client_request_id = v_req;
    if found then
      return jsonb_build_object('ok', true, 'in_scope', v_prior.in_scope, 'revision_number', v_prior.revision_number, 'duplicate', true);
    end if;
  end if;
  if v.status <> 'active' then
    raise exception 'Requests can be logged while the project is in progress' using errcode = '55000';
  end if;
  if v_desc is null then
    raise exception 'Describe what the client asked for' using errcode = '22023';
  end if;
  if v_source not in ('whatsapp', 'call', 'email', 'meeting', 'other') then
    raise exception 'Choose how the request arrived' using errcode = '22023';
  end if;
  if v_on > current_date + 1 or v_on < (v.approved_at at time zone 'UTC')::date - 1 then
    raise exception 'The date must be between the scope approval and today' using errcode = '22023';
  end if;
  if (select count(*) from public.revision_requests where project_id = v.id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many requests in the last hour. Please try again later.' using errcode = '55000';
  end if;
  select * into c from public.clients where id = v.client_id;
  v_via := case v_source when 'whatsapp' then 'WhatsApp' when 'call' then 'a call' when 'email' then 'email'
                         when 'meeting' then 'a meeting' else 'outside ScopeFlow' end;

  if v_kind = 'revision' then
    select * into v_del from public.deliverables where id = nullif(p ->> 'deliverable_id', '')::uuid and project_id = v.id;
    if not found then
      raise exception 'Choose a deliverable from this project' using errcode = '22023';
    end if;
    select count(*) into v_used from public.revision_requests
     where deliverable_id = v_del.id and kind = 'revision' and in_scope;
    v_in_scope := v_used < v_del.revisions_included;
    if v_in_scope then
      v_number := v_used + 1;
      v_summary := format('Revision %s of %s for "%s" (by %s, logged by you)', v_number, v_del.revisions_included, v_del.title, v_via);
    else
      v_summary := format('Revision for "%s" beyond the %s included (by %s, logged by you) — needs a change order',
                          v_del.title, v_del.revisions_included, v_via);
    end if;
  else
    v_summary := format('New work outside the original scope (by %s, logged by you) — needs a change order', v_via);
  end if;

  insert into public.revision_requests (project_id, deliverable_id, kind, description, requested_by,
                                        in_scope, revision_number, client_request_id, source, received_on)
  values (v.id, case when v_kind = 'revision' then v_del.id end, v_kind, v_desc, left(c.name, 120),
          v_in_scope, v_number, v_req, v_source, v_on)
  returning id into v_id;

  perform public._log(v.id, 'freelancer', null, 'revision.logged', v_summary,
    jsonb_build_object('revision_request_id', v_id, 'in_scope', v_in_scope, 'source', v_source));
  return jsonb_build_object('ok', true, 'in_scope', v_in_scope, 'revision_number', v_number,
                            'revisions_included', v_del.revisions_included);
end;
$$;

create or replace function public.create_client(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_name text := nullif(left(trim(coalesce(p ->> 'name', '')), 120), '');
  v_email text := lower(trim(coalesce(p ->> 'email', '')));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Client name is required' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email' using errcode = '22023';
  end if;
  if exists (select 1 from public.clients where owner_id = v_uid and email = v_email) then
    raise exception 'You already have a client with this email' using errcode = '23505';
  end if;
  perform public._check_plan_limits(v_uid, false, v_email);
  insert into public.clients (owner_id, name, email, company, phone)
  values (v_uid, v_name, v_email,
          nullif(left(trim(coalesce(p ->> 'company', '')), 120), ''),
          nullif(left(trim(coalesce(p ->> 'phone', '')), 40), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------------ client page
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
    -- How to pay: shown to the client only for rupee projects with a UPI ID set.
    'payment', case when v.currency = 'INR' and v_owner.upi_id is not null then jsonb_build_object(
      'upi_id', v_owner.upi_id,
      'payee_name', coalesce(v_owner.business_name, v_owner.full_name)) end,
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
               'progress', d.progress, 'progress_updated_at', d.progress_updated_at,
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
               'resolution_note', r.resolution_note, 'created_at', r.created_at,
               'source', r.source, 'received_on', r.received_on)
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
               'status', m.status, 'paid_at', m.paid_at, 'paid_cents', m.paid_cents,
               'invoice_number', (select i.number from public.client_invoices i
                                   where i.milestone_id = m.id and i.voided_at is null)) order by m.position)
        from public.milestones m where m.project_id = v.id), '[]'::jsonb) end,
    -- Invoices the freelancer issued for this project (void ones are hidden).
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'number', i.number, 'issue_date', i.issue_date, 'due_date', i.due_date,
               'currency', i.currency, 'description', i.description, 'amount_cents', i.amount_cents,
               'tax_label', i.tax_label, 'tax_bps', i.tax_bps, 'tax_split', i.tax_split,
               'taxable_cents', i.taxable_cents, 'tax_cents', i.tax_cents,
               'seller', i.seller, 'buyer', i.buyer, 'notes', i.notes,
               'paid', coalesce((select mm.status = 'paid' from public.milestones mm where mm.id = i.milestone_id), false),
               'paid_cents', coalesce((select mm.paid_cents from public.milestones mm where mm.id = i.milestone_id), 0),
               'paid_at', (select mm.paid_at from public.milestones mm where mm.id = i.milestone_id))
             order by i.issue_date, i.number)
        from public.client_invoices i
       where i.project_id = v.id and i.voided_at is null), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.log_client_request(uuid, jsonb), public.create_client(jsonb) from public, anon, authenticated;
grant execute on function public.log_client_request(uuid, jsonb), public.create_client(jsonb) to authenticated;
