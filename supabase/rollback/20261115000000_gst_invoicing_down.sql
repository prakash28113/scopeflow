-- Rollback for GST and invoicing fixes (20261115000000_gst_invoicing.sql).
-- Restores the previous functions and removes the new columns. Kept: corrected activity-log and blog
-- text, change orders' amounts (incl. any tax already agreed), and invoices already issued. Safe to re-run.
begin;
drop trigger if exists projects_unarchive_client on public.projects;
drop function if exists public._unarchive_client();
drop function if exists public.add_payment(uuid, jsonb);
drop function if exists public.archive_client(uuid, boolean);
drop function if exists public.delete_client(uuid);
create or replace function public.record_payment(p_milestone_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.milestones;
  v public.projects;
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint;
  v_date date := coalesce(nullif(p ->> 'paid_on', '')::date, current_date);
  v_method text := coalesce(nullif(p ->> 'method', ''), 'other');
  v_id uuid;
begin
  select * into m from public.milestones where id = p_milestone_id for update;
  if not found then
    raise exception 'Milestone not found' using errcode = 'P0002';
  end if;
  v := public._owned_project(m.project_id);
  if v.status not in ('active', 'completed') then
    raise exception 'Payments can be recorded once the client has approved the scope' using errcode = '55000';
  end if;
  if v_amount is null or v_amount < 1 then
    raise exception 'Enter an amount greater than zero' using errcode = '22023';
  end if;
  if v_amount > m.amount_cents - m.paid_cents then
    raise exception 'That is more than the % still due on this payment', m.amount_cents - m.paid_cents using errcode = '22023';
  end if;
  if v_date > current_date + 1 then
    raise exception 'The payment date can''t be in the future' using errcode = '22023';
  end if;
  if v_date < date '2000-01-01' then
    raise exception 'Enter the date the payment was received' using errcode = '22023';
  end if;
  insert into public.payments (owner_id, project_id, milestone_id, amount_cents, paid_on, method, reference)
  values (v.owner_id, v.id, m.id, v_amount, v_date, v_method, nullif(left(trim(coalesce(p ->> 'reference', '')), 200), ''))
  returning id into v_id;
  m := public._sync_milestone(m.id);
  if m.status = 'paid' then
    perform public._log(v.id, 'freelancer', null, 'milestone.paid',
      format('Payment recorded: %s', m.title),
      jsonb_build_object('milestone_id', m.id, 'amount_cents', v_amount, 'payment_id', v_id, 'paid_on', v_date));
  else
    perform public._log(v.id, 'freelancer', null, 'payment.partial',
      format('Part payment recorded: %s (%s of %s received)', m.title, m.paid_cents, m.amount_cents),
      jsonb_build_object('milestone_id', m.id, 'amount_cents', v_amount, 'payment_id', v_id, 'paid_on', v_date));
  end if;
  return v_id;
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

create or replace function public.portal_decide_change_order(
  p_token text, p_change_order_id uuid, p_decision public.decision,
  p_client_name text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  v public.projects;
  v_name text := public._clean_name(p_client_name);
  v_comment text := nullif(left(trim(coalesce(p_comment, '')), 4000), '');
  co public.change_orders;
  v_terms jsonb;
  v_pos integer;
begin
  select * into g from public._portal_gate(p_token, true, true);
  if g.o_error is not null then
    return public._portal_error(g.o_error);
  end if;
  v := g.o_project;
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

  -- Public response: only what the client UI needs. No internal identifiers.
  return jsonb_build_object('ok', true, 'decision', p_decision, 'number', co.number);
end;
$$;

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
               'due_date', d.due_date,
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

create or replace function public._check_plan_limits(p_owner uuid, p_new_project boolean, p_client_email text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_projects integer;
  v_clients integer;
begin
  -- Serialize creations per account so two tabs can't both slip past a limit.
  perform 1 from public.profiles where id = p_owner for update;
  v_plan := public._effective_plan(p_owner);

  if p_new_project and v_plan.max_active_projects is not null then
    select count(*) into v_projects from public.projects
     where owner_id = p_owner and status in ('draft', 'awaiting_approval', 'changes_requested', 'active');
    if v_projects >= v_plan.max_active_projects then
      raise exception 'Your % plan includes % active projects, and you have %. Complete or cancel a project, or see plans to get more.',
        v_plan.name, v_plan.max_active_projects, v_projects
        using errcode = 'SF402', hint = 'plan_limit:active_projects',
              detail = jsonb_build_object('limit', v_plan.max_active_projects, 'used', v_projects, 'plan', v_plan.id)::text;
    end if;
  end if;

  if v_plan.max_clients is not null and p_client_email <> ''
     and not exists (select 1 from public.clients where owner_id = p_owner and email = p_client_email) then
    select count(*) into v_clients from public.clients where owner_id = p_owner;
    if v_clients >= v_plan.max_clients then
      raise exception 'Your % plan includes % clients, and you have %. Use an existing client, or see plans to get more.',
        v_plan.name, v_plan.max_clients, v_clients
        using errcode = 'SF402', hint = 'plan_limit:clients',
              detail = jsonb_build_object('limit', v_plan.max_clients, 'used', v_clients, 'plan', v_plan.id)::text;
    end if;
  end if;
end;
$$;

create or replace function public._plan_usage(p_owner uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'active_projects', (select count(*) from public.projects
                         where owner_id = p_owner and status in ('draft', 'awaiting_approval', 'changes_requested', 'active')),
    'clients', (select count(*) from public.clients where owner_id = p_owner));
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

create or replace function public.set_invoice_details(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text := nullif(left(trim(coalesce(p ->> 'business_address', '')), 500), '');
  v_gstin text := nullif(upper(replace(coalesce(p ->> 'gstin', ''), ' ', '')), '');
  v_prefix text := upper(nullif(trim(coalesce(p ->> 'invoice_prefix', '')), ''));
begin
  if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Enter a valid 15-character GSTIN, like 36ABCDE1234F1Z5' using errcode = '22023';
  end if;
  if v_prefix is not null and v_prefix !~ '^[A-Z0-9]{1,8}$' then
    raise exception 'Use up to 8 letters or numbers for the invoice prefix' using errcode = '22023';
  end if;
  update public.profiles
     set business_address = v_address,
         gstin = v_gstin,
         invoice_prefix = coalesce(v_prefix, 'INV'),
         updated_at = now()
   where id = public._uid();
end;
$$;

create or replace function public.update_client_billing(p_client_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gstin text := nullif(upper(replace(coalesce(p ->> 'gstin', ''), ' ', '')), '');
begin
  if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Enter a valid 15-character GSTIN, like 36ABCDE1234F1Z5' using errcode = '22023';
  end if;
  update public.clients
     set billing_address = nullif(left(trim(coalesce(p ->> 'billing_address', '')), 500), ''),
         gstin = v_gstin,
         updated_at = now()
   where id = p_client_id and owner_id = public._uid();
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.create_invoice(p_milestone_id uuid, p jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  m public.milestones;
  v public.projects;
  c public.clients;
  o public.profiles;
  v_issue date := coalesce(nullif(p ->> 'issue_date', '')::date, current_date);
  v_due date := nullif(p ->> 'due_date', '')::date;
  v_tax_bps integer := coalesce(nullif(p ->> 'tax_bps', '')::integer, 0);
  v_tax_label text;
  v_split boolean := coalesce((p ->> 'tax_split')::boolean, false);
  v_notes text := nullif(left(trim(coalesce(p ->> 'notes', '')), 1000), '');
  v_seq integer;
  v_number text;
  v_taxable bigint;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select mm.* into m from public.milestones mm
    join public.projects pp on pp.id = mm.project_id
   where mm.id = p_milestone_id and pp.owner_id = v_uid
   for update of mm;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  select * into v from public.projects where id = m.project_id;
  if v.approved_at is null then
    raise exception 'Invoices can be created once the client has approved the scope' using errcode = '22023';
  end if;
  if exists (select 1 from public.client_invoices where milestone_id = m.id and voided_at is null) then
    raise exception 'This payment already has an invoice' using errcode = '23505';
  end if;
  -- The issue date is the freelancer's local "today" (±1 day for time zones).
  if v_issue not between current_date - 1 and current_date + 1 then
    raise exception 'The invoice date must be today' using errcode = '22023';
  end if;
  if v_due is not null and (v_due < v_issue or v_due > v_issue + 365) then
    raise exception 'The due date must be on or after the invoice date, within a year' using errcode = '22023';
  end if;
  if v_tax_bps not between 0 and 10000 then
    raise exception 'Tax rate must be between 0 and 100%%' using errcode = '22023';
  end if;
  v_tax_label := case when v_tax_bps = 0 then null
                      else coalesce(nullif(left(trim(coalesce(p ->> 'tax_label', '')), 20), ''), v.tax_label, 'Tax') end;
  v_split := v_split and v_tax_bps > 0;

  select * into c from public.clients where id = v.client_id;
  -- Numbering: lock this account's counter so simultaneous invoices get distinct numbers.
  update public.profiles set invoice_seq = invoice_seq + 1
   where id = v_uid
  returning * into o;
  v_seq := o.invoice_seq;
  v_number := format('%s-%s-%s', o.invoice_prefix, to_char(v_issue, 'YYYY'), lpad(v_seq::text, 3, '0'));

  -- Tax-inclusive split: taxable = total ÷ (1 + rate), rounded to the nearest paisa/cent.
  v_taxable := round(m.amount_cents * 10000.0 / (10000 + v_tax_bps));

  insert into public.client_invoices (
    owner_id, project_id, milestone_id, number, issue_date, due_date, currency, description,
    amount_cents, tax_label, tax_bps, tax_split, taxable_cents, tax_cents, seller, buyer, notes)
  values (
    v_uid, v.id, m.id, v_number, v_issue, v_due, v.currency,
    left(format('%s — %s', v.title, m.title), 400),
    m.amount_cents, v_tax_label, v_tax_bps, v_split, v_taxable, m.amount_cents - v_taxable,
    jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(o.business_name, o.full_name, o.email),
      'person', case when o.business_name is not null then o.full_name end,
      'email', o.email, 'address', o.business_address, 'gstin', o.gstin,
      'upi_id', case when v.currency = 'INR' then o.upi_id end)),
    jsonb_strip_nulls(jsonb_build_object(
      'name', c.name, 'company', c.company, 'email', c.email,
      'address', c.billing_address, 'gstin', c.gstin)),
    v_notes)
  returning id into v_id;

  perform public._log(v.id, 'freelancer', null, 'invoice.issued',
    format('Invoice %s issued for %s', v_number, m.title), jsonb_build_object('invoice_id', v_id));
  return v_id;
end;
$$;

drop function if exists public._clean_gstin(text);
drop function if exists public._clean_state(text);
drop function if exists public._gst_state_name(text);
drop function if exists public._money(bigint, text);
drop function if exists public._financial_year(date);
drop function if exists public._today_india();
alter table public.change_orders disable trigger change_orders_terms_immutable;
alter table public.change_orders drop column if exists subtotal_cents, drop column if exists tax_bps,
  drop column if exists tax_label, drop column if exists tax_cents;
alter table public.change_orders enable trigger change_orders_terms_immutable;
alter table public.client_invoices drop column if exists sac_code, drop column if exists place_of_supply;
alter table public.clients drop column if exists state_code, drop column if exists archived_at;
alter table public.profiles drop column if exists state_code, drop column if exists sac_code, drop column if exists invoice_fy;
alter table public.profiles alter column default_currency set default 'USD';
commit;
