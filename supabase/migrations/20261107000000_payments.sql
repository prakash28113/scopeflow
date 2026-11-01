-- =====================================================================
-- ScopeFlow — Payments done right: real dates, methods and partial payments.
--
--   * payments: one row per amount received against a payment milestone, with the date it
--     was actually received (not the day it was recorded), the method and a reference.
--     A milestone can be paid in parts; it becomes "paid" when the parts cover it.
--   * milestones.paid_cents: the running total, kept in step by the functions below
--     (never written directly). Status/paid_at stay as before, so existing screens work.
--   * Overpaying is refused, and the milestone row is locked while recording, so two
--     simultaneous payments can't push it past its amount.
--   * set_milestone_paid() keeps working (full remaining amount, today) for compatibility.
--   * Existing paid milestones are carried over as one payment each (method "other").
--
-- Safe to re-run. Rollback: supabase/rollback/20261107000000_payments_down.sql
-- =====================================================================

alter table public.milestones
  add column if not exists paid_cents bigint not null default 0 check (paid_cents >= 0);

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  paid_on      date not null check (paid_on >= date '2000-01-01'),
  method       text not null default 'other'
               check (method in ('upi', 'bank_transfer', 'cash', 'card', 'cheque', 'paypal', 'other')),
  reference    text check (char_length(reference) <= 200),
  created_at   timestamptz not null default now()
);
create index if not exists payments_milestone_idx on public.payments (milestone_id);
create index if not exists payments_owner_date_idx on public.payments (owner_id, paid_on desc);

alter table public.payments enable row level security;
drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.payments from public, anon, authenticated;
grant select on public.payments to authenticated;

-- Carry over milestones already marked paid (once).
insert into public.payments (owner_id, project_id, milestone_id, amount_cents, paid_on, method, reference)
select p.owner_id, m.project_id, m.id, m.amount_cents, m.paid_at::date, 'other', left(m.payment_note, 200)
  from public.milestones m
  join public.projects p on p.id = m.project_id
 where m.status = 'paid' and m.paid_at is not null
   and not exists (select 1 from public.payments x where x.milestone_id = m.id);
update public.milestones m
   set paid_cents = coalesce((select sum(x.amount_cents) from public.payments x where x.milestone_id = m.id), 0)
 where paid_cents is distinct from coalesce((select sum(x.amount_cents) from public.payments x where x.milestone_id = m.id), 0);

-- Recompute a milestone's total and status from its payments (caller holds the row lock).
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

create or replace function public.delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.payments;
  m public.milestones;
begin
  select * into x from public.payments where id = p_payment_id and owner_id = public._uid();
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  perform 1 from public.milestones where id = x.milestone_id for update;
  delete from public.payments where id = x.id;
  m := public._sync_milestone(x.milestone_id);
  perform public._log(x.project_id, 'freelancer', null, 'milestone.unpaid',
    format('Payment removed: %s', m.title),
    jsonb_build_object('milestone_id', m.id, 'amount_cents', x.amount_cents));
end;
$$;

-- Compatibility: "Mark paid" records the full remaining amount today; "Undo" removes all its payments.
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
  select * into m from public.milestones where id = p_milestone_id for update;
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
    perform public.record_payment(m.id, jsonb_build_object(
      'amount_cents', m.amount_cents - m.paid_cents, 'paid_on', current_date, 'method', 'other', 'reference', p_note));
  else
    if m.paid_cents = 0 then
      raise exception 'Milestone is not marked as paid' using errcode = '55000';
    end if;
    delete from public.payments where milestone_id = m.id;
    perform public._sync_milestone(m.id);
    perform public._log(v.id, 'freelancer', null, 'milestone.unpaid',
      format('Payment mark reverted: %s', m.title),
      jsonb_build_object('milestone_id', m.id, 'amount_cents', m.amount_cents));
  end if;
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

revoke all on function public.record_payment(uuid, jsonb), public.delete_payment(uuid), public._sync_milestone(uuid)
  from public, anon, authenticated;
grant execute on function public.record_payment(uuid, jsonb), public.delete_payment(uuid) to authenticated;
