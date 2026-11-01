-- =====================================================================
-- ScopeFlow — UPI payment details.
--
--   * profiles.upi_id: the freelancer's UPI ID (e.g. name@okbank), set in Settings.
--   * portal_view shows it to the client on rupee projects, so they can pay a
--     milestone from their UPI app. ScopeFlow never handles the money; the
--     freelancer still marks the payment as received.
--
-- Safe to re-run. Rollback: supabase/rollback/20261104000000_upi_payments_down.sql
-- =====================================================================

alter table public.profiles
  add column if not exists upi_id text
  check (upi_id ~ '^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,63}$');

create or replace function public.set_payment_details(p_upi_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := nullif(trim(coalesce(p_upi_id, '')), '');
begin
  if v is not null and v !~ '^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,63}$' then
    raise exception 'Enter a UPI ID like yourname@okbank' using errcode = '22023';
  end if;
  update public.profiles set upi_id = v, updated_at = now() where id = public._uid();
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

revoke all on function public.set_payment_details(text) from public, anon, authenticated;
grant execute on function public.set_payment_details(text) to authenticated;
