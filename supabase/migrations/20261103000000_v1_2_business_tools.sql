-- =====================================================================
-- ScopeFlow v1.2 — business tools.
--
--   * Itemised quotes: each deliverable can be priced (fixed, or hours × rate),
--     with an optional discount and tax (e.g. GST). The database computes the
--     total and sets the project budget; the line items and totals are part of
--     the locked scope version the client approves.
--   * Client profiles: phone and private notes (never shown to the client),
--     edited through update_client().
--
-- Safe to re-run. Backward compatible: new columns are nullable; a client that
-- doesn't send discount/tax keeps the saved values.
-- Rollback: supabase/rollback/20261103000000_v1_2_business_tools_down.sql
-- =====================================================================

alter table public.deliverables
  add column if not exists pricing_type text check (pricing_type in ('fixed', 'hourly')),
  add column if not exists hours numeric(8, 2) check (hours > 0 and hours <= 10000),
  add column if not exists rate_cents bigint check (rate_cents between 0 and 100000000),
  add column if not exists amount_cents bigint check (amount_cents between 0 and 100000000000);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deliverables_pricing_complete') then
    alter table public.deliverables add constraint deliverables_pricing_complete check (
      (pricing_type is null) = (amount_cents is null)
      and coalesce(pricing_type = 'hourly', false) = (hours is not null and rate_cents is not null));
  end if;
end $$;

alter table public.projects
  add column if not exists discount_bps integer check (discount_bps between 0 and 10000),
  add column if not exists tax_bps integer check (tax_bps between 0 and 10000),
  add column if not exists tax_label text check (char_length(tax_label) <= 24);

alter table public.clients
  add column if not exists phone text check (char_length(phone) <= 40),
  add column if not exists notes text check (char_length(notes) <= 4000);

-- Quote totals for a project, or null when its deliverables aren't priced.
-- Rounding: half away from zero at each step (discount, then tax on the discounted amount).
create or replace function public._quote_totals(p_project_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with lines as (
    select count(*) as n, count(amount_cents) as priced, coalesce(sum(amount_cents), 0) as subtotal
      from public.deliverables where project_id = p_project_id
  ), p as (
    select coalesce(discount_bps, 0) as d, coalesce(tax_bps, 0) as t, tax_label from public.projects where id = p_project_id
  ), calc as (
    select l.subtotal, p.d, p.t, p.tax_label,
           round(l.subtotal * p.d / 10000.0)::bigint as discount
      from lines l, p where l.n > 0 and l.priced = l.n
  )
  select jsonb_build_object(
           'subtotal_cents', subtotal,
           'discount_bps', d, 'discount_cents', discount,
           'tax_label', tax_label, 'tax_bps', t,
           'tax_cents', round((subtotal - discount) * t / 10000.0)::bigint,
           'total_cents', subtotal - discount + round((subtotal - discount) * t / 10000.0)::bigint)
    from calc;
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
    'pricing', public._quote_totals(p.id),
    'client', jsonb_build_object('name', c.name, 'company', c.company, 'email', c.email),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'revisions_included', d.revisions_included,
               'pricing_type', d.pricing_type, 'hours', d.hours, 'rate_cents', d.rate_cents,
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
                                 exclusions, terms, extra_revision_cents, discount_bps, tax_bps, tax_label)
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
            nullif(left(trim(coalesce(p ->> 'tax_label', '')), 24), ''))
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
    v_hours := null; v_rate := null; v_amount := null;
    if v_type = 'fixed' then
      v_amount := (v_item ->> 'amount_cents')::bigint;
    elsif v_type = 'hourly' then
      v_hours := (v_item ->> 'hours')::numeric(8, 2);
      v_rate := (v_item ->> 'rate_cents')::bigint;
      v_amount := round(v_hours * v_rate)::bigint;   -- same rounding as change orders
    elsif v_type is not null then
      raise exception 'Unknown pricing type' using errcode = '22023';
    end if;
    insert into public.deliverables (project_id, position, title, description, revisions_included,
                                     pricing_type, hours, rate_cents, amount_cents)
    values (v_project.id, v_pos,
            trim(v_item ->> 'title'),
            nullif(trim(coalesce(v_item ->> 'description', '')), ''),
            (v_item ->> 'revisions_included')::integer,
            v_type, v_hours, v_rate, v_amount);
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

-- Client profile: name, company, phone and private notes. Email stays the client's identity.
create or replace function public.update_client(p_client_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
begin
  perform 1 from public.clients where id = p_client_id and owner_id = v_uid for update;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if char_length(trim(coalesce(p ->> 'name', ''))) = 0 then
    raise exception 'Client name is required' using errcode = '22023';
  end if;
  update public.clients
     set name = left(trim(p ->> 'name'), 120),
         company = nullif(left(trim(coalesce(p ->> 'company', '')), 120), ''),
         phone = nullif(left(trim(coalesce(p ->> 'phone', '')), 40), ''),
         notes = nullif(left(trim(coalesce(p ->> 'notes', '')), 4000), ''),
         updated_at = now()
   where id = p_client_id;
end;
$$;

revoke all on function public.update_client(uuid, jsonb), public._quote_totals(uuid) from public, anon, authenticated;
grant execute on function public.update_client(uuid, jsonb) to authenticated;
