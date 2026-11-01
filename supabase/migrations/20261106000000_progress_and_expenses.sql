-- =====================================================================
-- ScopeFlow — Project progress and expenses.
--
--   * deliverables.progress: not_started → in_progress → delivered, set by the freelancer
--     after approval through set_deliverable_progress() (logged in the project timeline).
--     The client page shows each deliverable's status.
--   * expenses: a simple private log (date, category, amount, optional project) that the
--     Analytics page uses to show profit per month. Owner-only; written through functions.
--
-- Safe to re-run. Rollback: supabase/rollback/20261106000000_progress_and_expenses_down.sql
-- =====================================================================

alter table public.deliverables
  add column if not exists progress text not null default 'not_started'
    check (progress in ('not_started', 'in_progress', 'delivered')),
  add column if not exists progress_updated_at timestamptz;

create or replace function public.set_deliverable_progress(p_deliverable_id uuid, p_progress text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deliverables;
  v public.projects;
  v_label text := case p_progress when 'not_started' then 'not started' when 'in_progress' then 'in progress' when 'delivered' then 'delivered' end;
begin
  if v_label is null then
    raise exception 'Choose not started, in progress or delivered' using errcode = '22023';
  end if;
  select dd.* into d from public.deliverables dd
    join public.projects pp on pp.id = dd.project_id
   where dd.id = p_deliverable_id and pp.owner_id = public._uid()
   for update of dd;
  if not found then
    raise exception 'Deliverable not found' using errcode = 'P0002';
  end if;
  select * into v from public.projects where id = d.project_id;
  if v.approved_at is null then
    raise exception 'Track progress once the client has approved the scope' using errcode = '22023';
  end if;
  if v.status in ('completed', 'cancelled') then
    raise exception 'This project is closed' using errcode = '22023';
  end if;
  if d.progress = p_progress then
    return;
  end if;
  update public.deliverables set progress = p_progress, progress_updated_at = now() where id = d.id;
  perform public._log(v.id, 'freelancer', null, 'deliverable.progress',
    format('%s marked %s', d.title, v_label), jsonb_build_object('deliverable_id', d.id, 'progress', p_progress));
end;
$$;

-- ------------------------------------------------------------------ expenses
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  project_id   uuid references public.projects (id) on delete set null,
  spent_on     date not null check (spent_on >= date '2000-01-01'),
  category     text not null check (category in ('software', 'equipment', 'contractors', 'travel', 'marketing', 'office', 'fees', 'taxes', 'other')),
  description  text check (char_length(description) <= 200),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  created_at   timestamptz not null default now()
);
create index if not exists expenses_owner_date_idx on public.expenses (owner_id, spent_on desc);

alter table public.expenses enable row level security;
drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.expenses from public, anon, authenticated;
grant select on public.expenses to authenticated;

create or replace function public.add_expense(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_project uuid := nullif(p ->> 'project_id', '')::uuid;
  v_date date := nullif(p ->> 'spent_on', '')::date;
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint;
  v_currency text := upper(nullif(trim(coalesce(p ->> 'currency', '')), ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_date is null or v_date > current_date + 1 then
    raise exception 'Enter the date of the expense (not in the future)' using errcode = '22023';
  end if;
  if v_amount is null or v_amount < 1 then
    raise exception 'Enter an amount greater than zero' using errcode = '22023';
  end if;
  if v_project is not null and not exists (select 1 from public.projects where id = v_project and owner_id = v_uid) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_currency is null then
    select coalesce(default_currency, 'INR') into v_currency from public.profiles where id = v_uid;
  end if;
  insert into public.expenses (owner_id, project_id, spent_on, category, description, amount_cents, currency)
  values (v_uid, v_project, v_date, coalesce(nullif(p ->> 'category', ''), 'other'),
          nullif(left(trim(coalesce(p ->> 'description', '')), 200), ''), v_amount, v_currency)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.expenses where id = p_expense_id and owner_id = public._uid();
  if not found then
    raise exception 'Expense not found' using errcode = 'P0002';
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
               'status', m.status, 'paid_at', m.paid_at,
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
               'paid_at', (select mm.paid_at from public.milestones mm where mm.id = i.milestone_id))
             order by i.issue_date, i.number)
        from public.client_invoices i
       where i.project_id = v.id and i.voided_at is null), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.set_deliverable_progress(uuid, text), public.add_expense(jsonb), public.delete_expense(uuid)
  from public, anon, authenticated;
grant execute on function public.set_deliverable_progress(uuid, text), public.add_expense(jsonb), public.delete_expense(uuid)
  to authenticated;
