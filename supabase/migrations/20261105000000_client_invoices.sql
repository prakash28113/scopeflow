-- =====================================================================
-- ScopeFlow — Invoices for clients.
--
--   * Invoice details on the freelancer's profile: business address, GSTIN and an
--     invoice-number prefix; billing address and GSTIN on clients.
--   * client_invoices: one invoice per payment milestone (including change-order
--     milestones), created only through create_invoice(). Numbers come from a per-account
--     counter taken under a row lock, so they are unique and never reused.
--     The invoice keeps a snapshot of seller, buyer and amounts, so later edits to the
--     profile or client never change an issued invoice. Issued invoices are immutable;
--     the only change allowed is voiding (the number is kept, never reissued).
--   * Amounts: the invoice total is the milestone amount the client agreed to. When a
--     tax rate is chosen, the total is treated as tax-inclusive and split into taxable
--     value + tax (optionally shown as CGST + SGST halves).
--   * portal_view lists the project's live invoices for the client.
--
-- Safe to re-run. Rollback: supabase/rollback/20261105000000_client_invoices_down.sql
-- =====================================================================

alter table public.profiles
  add column if not exists business_address text check (char_length(business_address) <= 500),
  add column if not exists gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  add column if not exists invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  add column if not exists invoice_seq integer not null default 0 check (invoice_seq >= 0);

alter table public.clients
  add column if not exists billing_address text check (char_length(billing_address) <= 500),
  add column if not exists gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

create table if not exists public.client_invoices (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  milestone_id  uuid references public.milestones (id) on delete set null,
  number        text not null check (char_length(number) between 3 and 40),
  issue_date    date not null,
  due_date      date,
  currency      text not null,
  description   text not null check (char_length(description) between 1 and 400),
  amount_cents  bigint not null check (amount_cents > 0),
  tax_label     text check (char_length(tax_label) <= 20),
  tax_bps       integer not null default 0 check (tax_bps between 0 and 10000),
  tax_split     boolean not null default false,
  taxable_cents bigint not null check (taxable_cents >= 0),
  tax_cents     bigint not null check (tax_cents >= 0),
  seller        jsonb not null,
  buyer         jsonb not null,
  notes         text check (char_length(notes) <= 1000),
  voided_at     timestamptz,
  void_reason   text check (char_length(void_reason) <= 300),
  created_at    timestamptz not null default now(),
  unique (owner_id, number),
  check (taxable_cents + tax_cents = amount_cents),
  check (due_date is null or due_date >= issue_date)
);
create index if not exists client_invoices_project_idx on public.client_invoices (project_id);
-- At most one live (not voided) invoice per milestone.
create unique index if not exists client_invoices_one_live_per_milestone
  on public.client_invoices (milestone_id) where voided_at is null;

-- Issued invoices are immutable; only voiding (once) is allowed. Deletes only by cascade.
create or replace function public._invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.projects where id = old.project_id) then
      raise exception 'Invoices cannot be deleted; void them instead' using errcode = '42501';
    end if;
    return old;
  end if;
  -- A removed payment unlinks its invoice (on delete set null); nothing else changes.
  if new.milestone_id is null and (to_jsonb(new) - 'milestone_id') = (to_jsonb(old) - 'milestone_id') then
    return new;
  end if;
  -- Voiding, once: only voided_at / void_reason may be set.
  if old.voided_at is null and new.voided_at is not null
     and (to_jsonb(new) - 'voided_at' - 'void_reason') = (to_jsonb(old) - 'voided_at' - 'void_reason') then
    return new;
  end if;
  raise exception 'Issued invoices cannot be changed; void it and create a new one' using errcode = '42501';
end;
$$;
drop trigger if exists client_invoices_guard on public.client_invoices;
create trigger client_invoices_guard before update or delete on public.client_invoices
  for each row execute function public._invoice_guard();

alter table public.client_invoices enable row level security;
drop policy if exists "own client invoices" on public.client_invoices;
create policy "own client invoices" on public.client_invoices
  for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.client_invoices from public, anon, authenticated;
grant select on public.client_invoices to authenticated;

-- ------------------------------------------------------------------ invoice details
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

-- ------------------------------------------------------------------ create / void
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

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.client_invoices;
begin
  select * into i from public.client_invoices
   where id = p_invoice_id and owner_id = public._uid()
   for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if i.voided_at is not null then
    raise exception 'This invoice is already void' using errcode = '22023';
  end if;
  update public.client_invoices
     set voided_at = now(), void_reason = nullif(left(trim(coalesce(p_reason, '')), 300), '')
   where id = i.id;
  perform public._log(i.project_id, 'freelancer', null, 'invoice.voided',
    format('Invoice %s voided', i.number), jsonb_build_object('invoice_id', i.id));
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

revoke all on function public.set_invoice_details(jsonb), public.update_client_billing(uuid, jsonb),
  public.create_invoice(uuid, jsonb), public.void_invoice(uuid, text), public._invoice_guard()
  from public, anon, authenticated;
grant execute on function public.set_invoice_details(jsonb), public.update_client_billing(uuid, jsonb),
  public.create_invoice(uuid, jsonb), public.void_invoice(uuid, text) to authenticated;
