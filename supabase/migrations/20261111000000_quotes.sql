-- =====================================================================
-- ScopeFlow — Quotes: validity, quantity × unit price, saved templates.
--
--   * projects.valid_until (optional): the last day a quote is open. Part of the scope the client
--     approves (and its fingerprint). It can't be sent once passed, and the client can't approve
--     it afterwards (they can still ask for changes). "Passed" means past that date everywhere
--     on Earth (UTC−12), so a client in any time zone gets the whole day.
--   * deliverables priced per unit: pricing_type 'unit' with quantity × unit price (rate_cents)
--     and an optional unit name ("posts"). The database computes the amount, like hourly lines.
--   * scope_templates: the freelancer's own reusable starting points (summary, deliverables,
--     prices, exclusions, terms). Private to the owner; written only through save_template /
--     delete_template.
--
-- Safe to re-run. Rollback: supabase/rollback/20261111000000_quotes_down.sql
-- =====================================================================

alter table public.projects
  add column if not exists valid_until date check (valid_until >= date '2000-01-01');

alter table public.deliverables
  add column if not exists quantity numeric(10, 2) check (quantity > 0 and quantity <= 100000),
  add column if not exists unit_label text check (char_length(unit_label) between 1 and 24);

alter table public.deliverables drop constraint if exists deliverables_pricing_type_check;
alter table public.deliverables add constraint deliverables_pricing_type_check
  check (pricing_type in ('fixed', 'hourly', 'unit'));
alter table public.deliverables drop constraint if exists deliverables_pricing_complete;
alter table public.deliverables add constraint deliverables_pricing_complete check (
  (pricing_type is null) = (amount_cents is null)
  and coalesce(pricing_type = 'hourly', false) = (hours is not null)
  and coalesce(pricing_type = 'unit', false) = (quantity is not null)
  and coalesce(pricing_type in ('hourly', 'unit'), false) = (rate_cents is not null)
  and (unit_label is null or pricing_type = 'unit'));

-- Today's date in the last time zone on Earth to reach it (UTC−12).
create or replace function public._today_anywhere()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Etc/GMT+12')::date $$;

-- A quote whose validity has passed can't be sent, and can't be approved.
create or replace function public._check_quote_validity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_until date;
begin
  if tg_table_name = 'scope_snapshots' then
    v_until := nullif(new.data ->> 'valid_until', '')::date;
    if v_until < public._today_anywhere() then
      raise exception 'This quote''s "valid until" date has passed. Edit the scope and choose a later date before sending.'
        using errcode = '22023';
    end if;
  elsif new.decision = 'approved' then
    select nullif(s.data ->> 'valid_until', '')::date into v_until from public.scope_snapshots s where s.id = new.snapshot_id;
    if v_until < public._today_anywhere() then
      raise exception 'This quote was valid until %. Ask for an updated quote, or request changes.', to_char(v_until, 'FMDD Mon YYYY')
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scope_snapshots_quote_validity on public.scope_snapshots;
create trigger scope_snapshots_quote_validity before insert on public.scope_snapshots
  for each row execute function public._check_quote_validity();
drop trigger if exists scope_decisions_quote_validity on public.scope_decisions;
create trigger scope_decisions_quote_validity before insert on public.scope_decisions
  for each row execute function public._check_quote_validity();

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
    'valid_until', p.valid_until,
    'pricing', public._quote_totals(p.id),
    'client', jsonb_build_object('name', c.name, 'company', c.company, 'email', c.email),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'revisions_included', d.revisions_included, 'due_date', d.due_date,
               'pricing_type', d.pricing_type, 'hours', d.hours, 'rate_cents', d.rate_cents,
               'quantity', d.quantity, 'unit_label', d.unit_label,
               'amount_cents', d.amount_cents) order by d.position)
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
  v_priced integer;
  v_type text;
  v_hours numeric(8, 2);
  v_qty numeric(10, 2);
  v_unit text;
  v_rate bigint;
  v_amount bigint;
  v_quote jsonb;
  v_milestones jsonb := coalesce(p -> 'milestones', '[]'::jsonb);
begin
  if jsonb_typeof(v_deliverables) <> 'array'
     or jsonb_array_length(v_deliverables) not between 1 and 50 then
    raise exception 'Add between 1 and 50 deliverables' using errcode = '22023';
  end if;
  if jsonb_typeof(v_milestones) <> 'array' or jsonb_array_length(v_milestones) > 50 then
    raise exception 'Add at most 50 payment milestones' using errcode = '22023';
  end if;

  -- Itemised quote: every deliverable priced, or none.
  select count(*) into v_priced from jsonb_array_elements(v_deliverables) e
   where nullif(e.value ->> 'pricing_type', '') is not null;
  if v_priced not in (0, jsonb_array_length(v_deliverables)) then
    raise exception 'Price every deliverable, or none of them' using errcode = '22023';
  end if;
  if coalesce((p ->> 'discount_bps')::integer, 0) not between 0 and 10000
     or coalesce((p ->> 'tax_bps')::integer, 0) not between 0 and 10000 then
    raise exception 'Discount and tax must be between 0%% and 100%%' using errcode = '22023';
  end if;
  if nullif(p ->> 'valid_until', '') is not null and (p ->> 'valid_until')::date < public._today_anywhere() then
    raise exception 'The quote''s "valid until" date has passed. Choose a later date.' using errcode = '22023';
  end if;

  -- Plan limits (server-side; the page only explains them). Editing existing work is never limited.
  perform public._check_plan_limits(v_uid, p_project_id is null, lower(trim(coalesce(p -> 'client' ->> 'email', ''))));

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
                                 exclusions, terms, extra_revision_cents, discount_bps, tax_bps, tax_label, valid_until)
    values (v_uid, v_client_id,
            trim(p ->> 'title'),
            nullif(trim(coalesce(p ->> 'summary', '')), ''),
            upper(p ->> 'currency'),
            (p ->> 'budget_cents')::bigint,
            nullif(p ->> 'start_date', '')::date,
            nullif(p ->> 'due_date', '')::date,
            nullif(trim(coalesce(p ->> 'exclusions', '')), ''),
            nullif(trim(coalesce(p ->> 'terms', '')), ''),
            nullif(p ->> 'extra_revision_cents', '')::bigint,
            nullif(p ->> 'discount_bps', '')::integer,
            nullif(p ->> 'tax_bps', '')::integer,
            nullif(left(trim(coalesce(p ->> 'tax_label', '')), 24), ''),
            nullif(p ->> 'valid_until', '')::date)
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
           discount_bps = case when p ? 'discount_bps' then nullif(p ->> 'discount_bps', '')::integer else discount_bps end,
           tax_bps = case when p ? 'tax_bps' then nullif(p ->> 'tax_bps', '')::integer else tax_bps end,
           tax_label = case when p ? 'tax_label' then nullif(left(trim(coalesce(p ->> 'tax_label', '')), 24), '') else tax_label end,
           valid_until = case when p ? 'valid_until' then nullif(p ->> 'valid_until', '')::date else valid_until end,
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
    v_type := nullif(v_item ->> 'pricing_type', '');
    v_hours := null; v_rate := null; v_amount := null; v_qty := null; v_unit := null;
    if v_type = 'fixed' then
      v_amount := (v_item ->> 'amount_cents')::bigint;
    elsif v_type = 'hourly' then
      v_hours := (v_item ->> 'hours')::numeric(8, 2);
      v_rate := (v_item ->> 'rate_cents')::bigint;
      v_amount := round(v_hours * v_rate)::bigint;   -- same rounding as change orders
    elsif v_type = 'unit' then
      -- Quantity × unit price, e.g. 10 posts × ₹500. Same rounding as hourly.
      v_qty := (v_item ->> 'quantity')::numeric(10, 2);
      v_rate := (v_item ->> 'rate_cents')::bigint;
      v_unit := nullif(left(trim(coalesce(v_item ->> 'unit_label', '')), 24), '');
      v_amount := round(v_qty * v_rate)::bigint;
    elsif v_type is not null then
      raise exception 'Unknown pricing type' using errcode = '22023';
    end if;
    insert into public.deliverables (project_id, position, title, description, revisions_included,
                                     pricing_type, hours, rate_cents, amount_cents, due_date, quantity, unit_label)
    values (v_project.id, v_pos,
            trim(v_item ->> 'title'),
            nullif(trim(coalesce(v_item ->> 'description', '')), ''),
            (v_item ->> 'revisions_included')::integer,
            v_type, v_hours, v_rate, v_amount,
            nullif(v_item ->> 'due_date', '')::date, v_qty, v_unit);
  end loop;

  -- An itemised quote sets the budget: the database computes it, never the browser.
  v_quote := public._quote_totals(v_project.id);
  if v_quote is not null then
    update public.projects set budget_cents = (v_quote ->> 'total_cents')::bigint where id = v_project.id;
  end if;

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

-- ------------------------------------------------------------------ saved templates
create table if not exists public.scope_templates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists scope_templates_owner_name_idx on public.scope_templates (owner_id, lower(name));

alter table public.scope_templates enable row level security;
drop policy if exists "own templates" on public.scope_templates;
create policy "own templates" on public.scope_templates for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.scope_templates from public, anon, authenticated;
grant select on public.scope_templates to authenticated;

-- Saves a scope as a named template; saving with the same name replaces it.
create or replace function public.save_template(p_name text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_name text := nullif(left(trim(coalesce(p_name, '')), 60), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Give the template a name' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data -> 'deliverables') is distinct from 'array'
     or jsonb_array_length(p_data -> 'deliverables') not between 1 and 50 then
    raise exception 'A template needs between 1 and 50 deliverables' using errcode = '22023';
  end if;
  if octet_length(p_data::text) > 65536 then
    raise exception 'This template is too large to save' using errcode = '54000';
  end if;
  if not exists (select 1 from public.scope_templates where owner_id = v_uid and lower(name) = lower(v_name))
     and (select count(*) from public.scope_templates where owner_id = v_uid) >= 50 then
    raise exception 'You have 50 saved templates. Delete one first.' using errcode = '54000';
  end if;
  insert into public.scope_templates (owner_id, name, data)
  values (v_uid, v_name, p_data)
  on conflict (owner_id, lower(name)) do update set name = excluded.name, data = excluded.data, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.scope_templates where id = p_template_id and owner_id = public._uid();
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.save_template(text, jsonb), public.delete_template(uuid), public._today_anywhere(),
  public._check_quote_validity() from public, anon, authenticated;
grant execute on function public.save_template(text, jsonb), public.delete_template(uuid) to authenticated;
