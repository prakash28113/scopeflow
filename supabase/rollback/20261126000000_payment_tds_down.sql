-- Rollback for 20261126000000_payment_tds.sql: restores _sync_milestone, record_payment and
-- portal_view exactly as before, puts milestones back to cash-only totals and drops the TDS columns.
-- TDS-only payment rows (amount 0) are removed, since the old rule needs at least 1. Safe to re-run.
begin;

create or replace function public._sync_milestone(p_milestone_id uuid)
returns public.milestones
language plpgsql
set search_path = ''
as $$
declare
  m public.milestones;
  v_paid bigint;
  v_last date;
  v_ref text;
begin
  select coalesce(sum(amount_cents), 0), max(paid_on) into v_paid, v_last from public.payments where milestone_id = p_milestone_id;
  select reference into v_ref from public.payments where milestone_id = p_milestone_id order by paid_on desc, created_at desc limit 1;
  update public.milestones
     set paid_cents = v_paid,
         status = case when v_paid >= amount_cents then 'paid'::public.milestone_status else 'pending'::public.milestone_status end,
         -- Noon UTC on the day received: shows as that same date in every time zone from UTC−11 to UTC+11.
         paid_at = case when v_paid >= amount_cents then (v_last::timestamp + interval '12 hours') at time zone 'UTC' end,
         payment_note = case when v_paid >= amount_cents then v_ref end
   where id = p_milestone_id
  returning * into m;
  return m;
end;
$$;

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

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'tds_cents') then
    delete from public.payments where amount_cents = 0;
  end if;
end $$;
alter table public.payments drop constraint if exists payments_amount_cents_check;
alter table public.payments drop constraint if exists payments_tds_cents_check;
alter table public.payments drop column if exists tds_cents;
alter table public.payments add constraint payments_amount_cents_check check (amount_cents between 1 and 100000000000);
alter table public.milestones drop constraint if exists milestones_tds_cents_check;
alter table public.milestones drop column if exists tds_cents;
-- Cash-only totals and status again.
update public.milestones m
   set paid_cents = coalesce((select sum(x.amount_cents) from public.payments x where x.milestone_id = m.id), 0);
select public._sync_milestone(m.id) from public.milestones m;

commit;
