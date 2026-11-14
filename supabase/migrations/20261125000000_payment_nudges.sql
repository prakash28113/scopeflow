-- =====================================================================
-- SF-HABIT-3 (N-03): record a payment nudge and set a check-in.
--
-- The freelancer sends the nudge from their own WhatsApp or email app; ScopeFlow sends nothing.
-- record_nudge() only notes that it happened: a row in nudges, a line in the project's timeline,
-- and one open follow-up per invoice, due 3 days later (India calendar), so Reminders brings the
-- invoice back if it's still unpaid.
--
--   nudges                 owner-only read; written only through record_nudge()
--   follow_ups.invoice_id  which invoice a follow-up is about (at most one open per invoice)
--
-- No link, token, phone number or message text is stored. Nothing is granted to anon.
-- (20261119000000 is left free for the AI layer.) Safe to re-run.
-- Rollback: supabase/rollback/20261125000000_payment_nudges_down.sql
-- =====================================================================
begin;

create table if not exists public.nudges (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  invoice_id  uuid not null references public.client_invoices (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  channel     text not null check (channel in ('whatsapp', 'email')),
  tone        text not null check (tone in ('gentle', 'firm')),
  created_at  timestamptz not null default now()
);
create index if not exists nudges_owner_idx on public.nudges (owner_id, created_at desc);
create index if not exists nudges_invoice_idx on public.nudges (invoice_id, created_at desc);

alter table public.nudges enable row level security;
drop policy if exists "own nudges" on public.nudges;
create policy "own nudges" on public.nudges for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.nudges from public, anon, authenticated;
grant select on public.nudges to authenticated;

alter table public.follow_ups add column if not exists invoice_id uuid references public.client_invoices (id) on delete cascade;
create unique index if not exists follow_ups_one_open_per_invoice on public.follow_ups (invoice_id) where done_at is null and invoice_id is not null;

create or replace function public.record_nudge(p_invoice_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_channel text := p ->> 'channel';
  v_tone text := p ->> 'tone';
  inv public.client_invoices;
  v_project public.projects;
  v_today date := public._today_india();
  v_due date;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_channel is null or v_channel not in ('whatsapp', 'email') or v_tone is null or v_tone not in ('gentle', 'firm') then
    raise exception 'Choose WhatsApp or email, gentle or firm' using errcode = '22023';
  end if;
  select * into inv from public.client_invoices where id = p_invoice_id and owner_id = v_uid;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  v_project := public._owned_project(inv.project_id); -- ownership again, and the row lock
  if inv.voided_at is not null then
    raise exception 'This invoice was voided' using errcode = '22023';
  end if;
  if (select count(*) from public.nudges where invoice_id = inv.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s 20 nudges for this invoice today. Try again tomorrow.' using errcode = '55000';
  end if;

  insert into public.nudges (owner_id, invoice_id, project_id, channel, tone)
  values (v_uid, inv.id, inv.project_id, v_channel, v_tone);

  perform public._log(inv.project_id, 'freelancer', null, 'invoice.nudged',
    format('Payment nudge sent (%s, %s) for %s', case v_channel when 'whatsapp' then 'WhatsApp' else 'email' end, v_tone, inv.number),
    jsonb_build_object('invoice_id', inv.id, 'channel', v_channel, 'tone', v_tone));

  -- One open check-in per invoice: the first nudge sets it, later nudges leave it be.
  select due_on into v_due from public.follow_ups where invoice_id = inv.id and done_at is null;
  if v_due is null then
    v_due := v_today + 3;
    insert into public.follow_ups (owner_id, project_id, invoice_id, due_on, note)
    values (v_uid, inv.project_id, inv.id, v_due,
            left(format('Check payment for %s (nudged %s)', inv.number, to_char(v_today, 'FMDD Mon')), 300));
  end if;

  return jsonb_build_object('ok', true, 'follow_up_due_on', v_due);
end;
$$;

revoke all on function public.record_nudge(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_nudge(uuid, jsonb) to authenticated;

commit;
