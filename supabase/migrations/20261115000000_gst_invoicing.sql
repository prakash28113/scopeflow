-- =====================================================================
-- ScopeFlow — GST and invoicing fixes (QA fix list v1, batch 1).
--
--   Change orders carry tax like the quote: the price entered is before tax; the project's
--   GST rate applies (editable), and amount_cents is what the client pays. Contract totals,
--   payment milestones and invoices therefore all use the same tax basis.         (FX-001)
--   add_payment(): after approval, schedule the part of the contract no payment covers,
--   so it can be invoiced.                                                         (FX-002)
--   Tax invoices print a SAC code and the place of supply; the business and client states
--   decide CGST+SGST (same state) or IGST (different states), with an override.    (FX-003, 006)
--   Clients can be archived (or deleted when unused); archived clients don't count toward
--   the Free plan's limit.                                                          (FX-004)
--   Money in the activity log reads ₹5,000, not 500000 (existing entries corrected). (FX-005)
--   New accounts default to INR.                                                   (FX-009)
--   Invoice dates are India dates; numbers follow the financial year (INV-2026-27-001).
--                                                                                  (FX-014, 017)
--
-- Safe to re-run. Rollback: supabase/rollback/20261115000000_gst_invoicing_down.sql
-- =====================================================================

-- ------------------------------------------------------------------ helpers
create or replace function public._today_india()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- "2026-27" for any date from 1 April 2026 to 31 March 2027.
create or replace function public._financial_year(p date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when extract(month from p) >= 4
              then format('%s-%s', extract(year from p)::int, lpad(((extract(year from p)::int + 1) % 100)::text, 2, '0'))
              else format('%s-%s', extract(year from p)::int - 1, lpad((extract(year from p)::int % 100)::text, 2, '0')) end;
$$;

-- Money for messages: ₹1,24,000 (Indian grouping), $1,240.50, €80. Whole amounts drop ".00".
create or replace function public._money(p_cents bigint, p_currency text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_neg boolean := p_cents < 0;
  v_abs bigint := abs(coalesce(p_cents, 0));
  v_units bigint := v_abs / 100;
  v_frac integer := (v_abs % 100)::integer;
  v_digits text := v_units::text;
  v_grouped text;
  v_symbol text := case upper(coalesce(p_currency, '')) when 'INR' then '₹' when 'USD' then '$' when 'EUR' then '€'
                                                         when 'GBP' then '£' when 'AUD' then 'A$' when 'CAD' then 'C$'
                                                         when 'SGD' then 'S$' when 'AED' then 'AED ' else upper(coalesce(p_currency, '')) || ' ' end;
begin
  if upper(coalesce(p_currency, '')) = 'INR' and char_length(v_digits) > 3 then
    -- Last three digits, then groups of two: 1,24,000.
    v_grouped := right(v_digits, 3);
    v_digits := left(v_digits, char_length(v_digits) - 3);
    while char_length(v_digits) > 2 loop
      v_grouped := right(v_digits, 2) || ',' || v_grouped;
      v_digits := left(v_digits, char_length(v_digits) - 2);
    end loop;
    v_grouped := v_digits || ',' || v_grouped;
  else
    v_grouped := regexp_replace(v_digits, '(\d)(?=(\d{3})+$)', '\1,', 'g');
  end if;
  return (case when v_neg then '-' else '' end) || v_symbol || v_grouped
         || case when v_frac = 0 then '' else '.' || lpad(v_frac::text, 2, '0') end;
end;
$$;

-- GST state and union territory codes (as in GSTINs), and their names.
create or replace function public._gst_state_name(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when '01' then 'Jammu and Kashmir' when '02' then 'Himachal Pradesh' when '03' then 'Punjab'
    when '04' then 'Chandigarh' when '05' then 'Uttarakhand' when '06' then 'Haryana' when '07' then 'Delhi'
    when '08' then 'Rajasthan' when '09' then 'Uttar Pradesh' when '10' then 'Bihar' when '11' then 'Sikkim'
    when '12' then 'Arunachal Pradesh' when '13' then 'Nagaland' when '14' then 'Manipur' when '15' then 'Mizoram'
    when '16' then 'Tripura' when '17' then 'Meghalaya' when '18' then 'Assam' when '19' then 'West Bengal'
    when '20' then 'Jharkhand' when '21' then 'Odisha' when '22' then 'Chhattisgarh' when '23' then 'Madhya Pradesh'
    when '24' then 'Gujarat' when '26' then 'Dadra and Nagar Haveli and Daman and Diu' when '27' then 'Maharashtra'
    when '29' then 'Karnataka' when '30' then 'Goa' when '31' then 'Lakshadweep' when '32' then 'Kerala'
    when '33' then 'Tamil Nadu' when '34' then 'Puducherry' when '35' then 'Andaman and Nicobar Islands'
    when '36' then 'Telangana' when '37' then 'Andhra Pradesh' when '38' then 'Ladakh' when '97' then 'Other Territory'
    when '96' then 'Outside India' end;
$$;

-- A valid state code, or null ('' clears).
create or replace function public._clean_state(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(trim(coalesce(p, '')), '');
begin
  if v is null then
    return null;
  end if;
  if public._gst_state_name(v) is null then
    raise exception 'Choose a state from the list' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public._clean_gstin(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(upper(replace(coalesce(p, ''), ' ', '')), '');
begin
  if v is not null and v !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Enter a valid 15-character GSTIN, like 36ABCDE1234F1Z5' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ------------------------------------------------------------------ columns
alter table public.profiles alter column default_currency set default 'INR';
alter table public.profiles
  add column if not exists state_code text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  add column if not exists sac_code text check (sac_code is null or sac_code ~ '^[0-9]{4,8}$'),
  add column if not exists invoice_fy text check (invoice_fy is null or invoice_fy ~ '^[0-9]{4}-[0-9]{2}$');
alter table public.clients
  add column if not exists state_code text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  add column if not exists archived_at timestamptz;
alter table public.client_invoices
  add column if not exists sac_code text check (sac_code is null or sac_code ~ '^[0-9]{4,8}$'),
  add column if not exists place_of_supply text check (place_of_supply is null or char_length(place_of_supply) <= 80);

alter table public.change_orders
  add column if not exists subtotal_cents bigint check (subtotal_cents between 0 and 100000000000),
  add column if not exists tax_bps integer not null default 0 check (tax_bps between 0 and 10000),
  add column if not exists tax_label text check (char_length(tax_label) <= 24),
  add column if not exists tax_cents bigint not null default 0 check (tax_cents >= 0);
-- Existing change orders were priced without tax: their whole amount is the subtotal.
alter table public.change_orders disable trigger change_orders_terms_immutable;
update public.change_orders set subtotal_cents = amount_cents where subtotal_cents is null;
alter table public.change_orders enable trigger change_orders_terms_immutable;

-- Tax terms are locked with the rest of a change order's terms.
create or replace function public._guard_change_order_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.project_id, new.number, new.title, new.description, new.pricing_type, new.hours,
      new.hourly_rate_cents, new.amount_cents, new.additional_days, new.created_at,
      new.subtotal_cents, new.tax_bps, new.tax_label, new.tax_cents)
     is distinct from
     (old.project_id, old.number, old.title, old.description, old.pricing_type, old.hours,
      old.hourly_rate_cents, old.amount_cents, old.additional_days, old.created_at,
      old.subtotal_cents, old.tax_bps, old.tax_label, old.tax_cents) then
    raise exception 'Change order terms are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Starting a project for an archived client brings the client back.
create or replace function public._unarchive_client()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.clients set archived_at = null, updated_at = now()
   where id = new.client_id and archived_at is not null;
  return new;
end;
$$;
drop trigger if exists projects_unarchive_client on public.projects;
create trigger projects_unarchive_client after insert on public.projects
  for each row execute function public._unarchive_client();

-- ------------------------------------------------------------------ functions
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
  v_date date := coalesce(nullif(p ->> 'paid_on', '')::date, public._today_india());
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
    raise exception 'That is more than the % still due on this payment', public._money(m.amount_cents - m.paid_cents, v.currency) using errcode = '22023';
  end if;
  if v_date > public._today_india() + 1 then
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
      format('Part payment recorded: %s (%s of %s received)', m.title, public._money(m.paid_cents, v.currency), public._money(m.amount_cents, v.currency)),
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
  -- GST/tax: the project's rate and label unless the freelancer changes them for this change order.
  v_tax_bps integer := coalesce(nullif(p ->> 'tax_bps', '')::integer, v.tax_bps, 0);
  v_tax_label text;
  v_subtotal bigint;
  v_tax bigint;
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

  if v_tax_bps not between 0 and 10000 then
    raise exception 'Tax must be between 0%% and 100%%' using errcode = '22023';
  end if;
  v_tax_label := case when v_tax_bps = 0 then null
                      else coalesce(nullif(left(trim(coalesce(p ->> 'tax_label', '')), 24), ''), v.tax_label, 'GST') end;
  -- The price entered is before tax; the change order's amount is what the client pays (incl. tax),
  -- on the same basis as the approved quote's total.
  v_subtotal := v_amount;
  v_tax := round(v_subtotal * v_tax_bps / 10000.0)::bigint;
  v_amount := v_subtotal + v_tax;

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
                                    pricing_type, hours, hourly_rate_cents, amount_cents, additional_days,
                                    subtotal_cents, tax_bps, tax_label, tax_cents)
  values (v.id, v_number, v_rr, trim(p ->> 'title'),
          nullif(trim(coalesce(p ->> 'description', '')), ''),
          v_type, v_hours, v_rate, v_amount, v_days, v_subtotal, v_tax_bps, v_tax_label, v_tax)
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
    'amount_cents', co.amount_cents, 'additional_days', co.additional_days, 'currency', v.currency,
    'subtotal_cents', co.subtotal_cents, 'tax_bps', co.tax_bps, 'tax_label', co.tax_label, 'tax_cents', co.tax_cents);

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
               'subtotal_cents', c.subtotal_cents, 'tax_bps', c.tax_bps, 'tax_label', c.tax_label, 'tax_cents', c.tax_cents,
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
               'sac_code', i.sac_code, 'place_of_supply', i.place_of_supply,
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
     and not exists (select 1 from public.clients where owner_id = p_owner and email = p_client_email and archived_at is null) then
    -- Archived clients don't count (like completed and cancelled projects).
    select count(*) into v_clients from public.clients where owner_id = p_owner and archived_at is null;
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
    'clients', (select count(*) from public.clients where owner_id = p_owner and archived_at is null));
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
  if exists (select 1 from public.clients where owner_id = v_uid and email = v_email and archived_at is null) then
    raise exception 'You already have a client with this email' using errcode = '23505';
  end if;
  -- An archived client with this email comes back (within the plan's limit) instead of a duplicate.
  if exists (select 1 from public.clients where owner_id = v_uid and email = v_email) then
    perform public._check_plan_limits(v_uid, false, v_email);
    update public.clients
       set archived_at = null, name = v_name, updated_at = now(),
           company = coalesce(nullif(left(trim(coalesce(p ->> 'company', '')), 120), ''), company),
           phone = coalesce(nullif(left(trim(coalesce(p ->> 'phone', '')), 40), ''), phone),
           state_code = coalesce(public._clean_state(p ->> 'state_code'), state_code)
     where owner_id = v_uid and email = v_email
    returning id into v_id;
    return v_id;
  end if;
  perform public._check_plan_limits(v_uid, false, v_email);
  insert into public.clients (owner_id, name, email, company, phone, billing_address, gstin, state_code)
  values (v_uid, v_name, v_email,
          nullif(left(trim(coalesce(p ->> 'company', '')), 120), ''),
          nullif(left(trim(coalesce(p ->> 'phone', '')), 40), ''),
          nullif(left(trim(coalesce(p ->> 'billing_address', '')), 500), ''),
          public._clean_gstin(p ->> 'gstin'),
          public._clean_state(p ->> 'state_code'))
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
  v_sac text := nullif(regexp_replace(coalesce(p ->> 'sac_code', ''), '\s', '', 'g'), '');
begin
  if v_sac is not null and v_sac !~ '^[0-9]{4,8}$' then
    raise exception 'Enter the SAC as 4 to 8 digits, like 998391' using errcode = '22023';
  end if;
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
         sac_code = case when p ? 'sac_code' then v_sac else sac_code end,
         -- The business state: chosen, or read from the GSTIN's first two digits.
         state_code = case when p ? 'state_code' or v_gstin is not null
                           then coalesce(public._clean_state(p ->> 'state_code'), left(v_gstin, 2)) else state_code end,
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
         state_code = case when p ? 'state_code' or v_gstin is not null
                           then coalesce(public._clean_state(p ->> 'state_code'), left(v_gstin, 2)) else state_code end,
         updated_at = now()
   where id = p_client_id and owner_id = public._uid();
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ------------------------------------------------------------------ invoices
-- Same as before, plus: India date; financial-year numbering; tax defaults to what the client agreed
-- for this payment; SAC code and place of supply; CGST+SGST vs IGST from the states (overridable).
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
  co public.change_orders;
  o public.profiles;
  v_issue date := public._today_india();
  v_due date := nullif(p ->> 'due_date', '')::date;
  v_tax_bps integer;
  v_tax_label text;
  v_split boolean;
  v_notes text := nullif(left(trim(coalesce(p ->> 'notes', '')), 1000), '');
  v_sac text := nullif(regexp_replace(coalesce(p ->> 'sac_code', ''), '\s', '', 'g'), '');
  v_seller_state text;
  v_pos text;
  v_fy text;
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
  if v_due is not null and (v_due < v_issue or v_due > v_issue + 365) then
    raise exception 'The due date must be on or after the invoice date, within a year' using errcode = '22023';
  end if;
  if m.change_order_id is not null then
    select * into co from public.change_orders where id = m.change_order_id;
  end if;
  -- The amount already includes the tax the client agreed to (the quote's or the change order's).
  v_tax_bps := coalesce(nullif(p ->> 'tax_bps', '')::integer, case when co.id is not null then co.tax_bps else v.tax_bps end, 0);
  if v_tax_bps not between 0 and 10000 then
    raise exception 'Tax rate must be between 0 and 100%%' using errcode = '22023';
  end if;
  v_tax_label := case when v_tax_bps = 0 then null
                      else coalesce(nullif(left(trim(coalesce(p ->> 'tax_label', '')), 20), ''),
                                    case when co.id is not null then co.tax_label end, v.tax_label, 'GST') end;
  if v_sac is not null and v_sac !~ '^[0-9]{4,8}$' then
    raise exception 'Enter the SAC as 4 to 8 digits, like 998391' using errcode = '22023';
  end if;

  select * into c from public.clients where id = v.client_id;
  select * into o from public.profiles where id = v_uid;
  v_sac := coalesce(v_sac, o.sac_code);
  -- Place of supply for services: the client's state when known, otherwise the business's.
  v_seller_state := coalesce(o.state_code, left(o.gstin, 2));
  v_pos := coalesce(c.state_code, left(c.gstin, 2), v_seller_state);
  v_split := case when p ? 'tax_split' then coalesce((p ->> 'tax_split')::boolean, false)
                  else v_seller_state is not null and v_pos = v_seller_state end;
  v_split := v_split and v_tax_bps > 0;

  -- Numbering per financial year (1 April to 31 March); lock the counter for simultaneous invoices.
  v_fy := public._financial_year(v_issue);
  update public.profiles
     set invoice_seq = case when invoice_fy = v_fy then invoice_seq + 1 else 1 end,
         invoice_fy = v_fy
   where id = v_uid
  returning * into o;
  v_number := format('%s-%s-%s', o.invoice_prefix, v_fy, lpad(o.invoice_seq::text, 3, '0'));
  -- Never reuse a number (e.g. after the prefix was changed back): take the next free one.
  while exists (select 1 from public.client_invoices where owner_id = v_uid and number = v_number) loop
    update public.profiles set invoice_seq = invoice_seq + 1 where id = v_uid returning * into o;
    v_number := format('%s-%s-%s', o.invoice_prefix, v_fy, lpad(o.invoice_seq::text, 3, '0'));
  end loop;

  -- Tax-inclusive split: taxable = total ÷ (1 + rate), rounded to the nearest paisa/cent.
  v_taxable := round(m.amount_cents * 10000.0 / (10000 + v_tax_bps));

  insert into public.client_invoices (
    owner_id, project_id, milestone_id, number, issue_date, due_date, currency, description,
    amount_cents, tax_label, tax_bps, tax_split, taxable_cents, tax_cents, seller, buyer, notes,
    sac_code, place_of_supply)
  values (
    v_uid, v.id, m.id, v_number, v_issue, v_due, v.currency,
    left(format('%s — %s', v.title, m.title), 400),
    m.amount_cents, v_tax_label, v_tax_bps, v_split, v_taxable, m.amount_cents - v_taxable,
    jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(o.business_name, o.full_name, o.email),
      'person', case when o.business_name is not null then o.full_name end,
      'email', o.email, 'address', o.business_address, 'gstin', o.gstin,
      'state', case when v_seller_state is not null then format('%s (%s)', public._gst_state_name(v_seller_state), v_seller_state) end,
      'upi_id', case when v.currency = 'INR' then o.upi_id end)),
    jsonb_strip_nulls(jsonb_build_object(
      'name', c.name, 'company', c.company, 'email', c.email,
      'address', c.billing_address, 'gstin', c.gstin,
      'state', case when coalesce(c.state_code, left(c.gstin, 2)) is not null
                    then format('%s (%s)', public._gst_state_name(coalesce(c.state_code, left(c.gstin, 2))), coalesce(c.state_code, left(c.gstin, 2))) end)),
    v_notes,
    v_sac,
    case when v_pos is not null then format('%s (%s)', public._gst_state_name(v_pos), v_pos) end)
  returning id into v_id;

  perform public._log(v.id, 'freelancer', null, 'invoice.issued',
    format('Invoice %s issued for %s', v_number, m.title), jsonb_build_object('invoice_id', v_id));
  return v_id;
end;
$$;

-- ------------------------------------------------------------------ payments after approval
-- Schedules (part of) the contract no payment covers yet, so it can be invoiced. The agreed
-- total doesn't change: only how it's split into payments.
create or replace function public.add_payment(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects := public._owned_project(p_project_id);
  v_title text := coalesce(nullif(left(trim(coalesce(p ->> 'title', '')), 200), ''), 'Balance payment');
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint;
  v_due date := nullif(p ->> 'due_date', '')::date;
  v_uncovered bigint;
  v_pos integer;
  v_id uuid;
begin
  if v.approved_at is null or v.status not in ('active', 'completed') then
    raise exception 'Payments can be added once the client has approved the scope' using errcode = '55000';
  end if;
  perform 1 from public.projects where id = v.id for update;
  select v.budget_cents + v.approved_extras_cents - coalesce(sum(amount_cents), 0)
    into v_uncovered from public.milestones where project_id = v.id;
  if v_amount is null or v_amount < 1 then
    raise exception 'Enter an amount greater than zero' using errcode = '22023';
  end if;
  if v_amount > v_uncovered then
    raise exception 'Only % of the contract isn''t covered by a payment yet', public._money(greatest(v_uncovered, 0), v.currency)
      using errcode = '22023';
  end if;
  if v_due is not null and v_due < public._today_india() - 365 then
    raise exception 'Enter a due date' using errcode = '22023';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.milestones where project_id = v.id;
  insert into public.milestones (project_id, position, title, amount_cents, due_date)
  values (v.id, v_pos, v_title, v_amount, v_due)
  returning id into v_id;
  perform public._log(v.id, 'freelancer', null, 'milestone.added',
    format('Payment added: %s (%s)', v_title, public._money(v_amount, v.currency)),
    jsonb_build_object('milestone_id', v_id, 'amount_cents', v_amount));
  return v_id;
end;
$$;

-- ------------------------------------------------------------------ clients: archive / delete
create or replace function public.archive_client(p_client_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  c public.clients;
begin
  select * into c from public.clients where id = p_client_id and owner_id = v_uid for update;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if p_archived then
    if exists (select 1 from public.projects where client_id = c.id and status in ('awaiting_approval', 'changes_requested', 'active')) then
      raise exception 'This client has a project in progress. Complete or cancel it first.' using errcode = '55000';
    end if;
    update public.clients set archived_at = coalesce(archived_at, now()), updated_at = now() where id = c.id;
  elsif c.archived_at is not null then
    -- Coming back counts toward the plan again.
    perform public._check_plan_limits(v_uid, false, '#restore#' || c.id::text);
    update public.clients set archived_at = null, updated_at = now() where id = c.id;
  end if;
end;
$$;

-- Deletes a client with no projects (e.g. added by mistake). Clients with history are archived instead.
create or replace function public.delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
begin
  if not exists (select 1 from public.clients where id = p_client_id and owner_id = v_uid) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.projects where client_id = p_client_id) then
    raise exception 'This client has projects, so their records are kept. Archive the client instead.' using errcode = '55000';
  end if;
  delete from public.clients where id = p_client_id and owner_id = v_uid;
end;
$$;

-- ------------------------------------------------------------------ corrections to existing data
-- FX-005: part-payment entries recorded with raw minor units ("500000 of 1000000 received").
alter table public.activity_log disable trigger activity_log_immutable;
update public.activity_log a
   set summary = format('%s (%s of %s received)', x.m[1],
                        public._money(x.m[2]::bigint, p.currency), public._money(x.m[3]::bigint, p.currency))
  from (select id, regexp_match(summary, '^(Part payment recorded: .*) \((\d+) of (\d+) received\)$') as m
          from public.activity_log where event = 'payment.partial') x,
       public.projects p
 where a.id = x.id and x.m is not null and p.id = a.project_id;
alter table public.activity_log enable trigger activity_log_immutable;

-- FX-064, 065, 067: blog text corrections (owner's name, one sentence, brand spelling).
update public.blog_posts set author_name = replace(author_name, 'Mummidisett' || 'y', 'Mummidisetti')
 where author_name like '%Mummidisett' || 'y%';
update public.profiles set full_name = replace(full_name, 'Mummidisett' || 'y', 'Mummidisetti')
 where email = 'prakashmummidisetti@gmail.com' and full_name like '%Mummidisett' || 'y%';
update public.blog_posts
   set body = replace(body,
         'Together they are how a ₹40,000 project quietly turns into ₹40,000 for twice the work.',
         'Together they are how a ₹40,000 project quietly turns into twice the work for the same ₹40,000.')
 where body like '%quietly turns into ₹40,000 for twice the work.%';
update public.blog_posts set body = regexp_replace(body, '\mScopeflow\M', 'ScopeFlow', 'g')
 where body ~ '\mScopeflow\M';

-- ------------------------------------------------------------------ permissions
revoke all on function public._today_india(), public._financial_year(date), public._money(bigint, text),
  public._gst_state_name(text), public._clean_state(text), public._clean_gstin(text), public._unarchive_client(),
  public.create_invoice(uuid, jsonb), public.add_payment(uuid, jsonb), public.archive_client(uuid, boolean),
  public.delete_client(uuid)
  from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, jsonb), public.add_payment(uuid, jsonb),
  public.archive_client(uuid, boolean), public.delete_client(uuid) to authenticated;
