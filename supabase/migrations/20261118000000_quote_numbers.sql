-- QA retest 3, FX-008: quotes get a number like invoices (QT-2026-27-001, per Indian financial year).
-- The number is given when the quote is first sent to the client and stays the same for every later
-- version of that quote. Quotes already sent get numbers in the order they were first sent.

alter table public.profiles
  add column if not exists quote_seq integer not null default 0 check (quote_seq >= 0),
  add column if not exists quote_fy text check (quote_fy is null or quote_fy ~ '^\d{4}-\d{2}$');
alter table public.projects
  add column if not exists quote_number text check (quote_number is null or char_length(quote_number) <= 40);
create unique index if not exists projects_owner_quote_number_idx on public.projects (owner_id, quote_number) where quote_number is not null;

-- The next quote number for an account (locks the counter, skips any number already used).
create or replace function public._next_quote_number(p_owner uuid, p_day date)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_fy text := public._financial_year(p_day);
  o public.profiles;
  v_number text;
begin
  update public.profiles
     set quote_seq = case when quote_fy = v_fy then quote_seq + 1 else 1 end,
         quote_fy = v_fy
   where id = p_owner
  returning * into o;
  v_number := format('QT-%s-%s', v_fy, lpad(o.quote_seq::text, 3, '0'));
  while exists (select 1 from public.projects where owner_id = p_owner and quote_number = v_number) loop
    update public.profiles set quote_seq = quote_seq + 1 where id = p_owner returning * into o;
    v_number := format('QT-%s-%s', v_fy, lpad(o.quote_seq::text, 3, '0'));
  end loop;
  return v_number;
end;
$$;

-- When a version is sent (a snapshot is saved), the quote gets its number if it doesn't have one.
create or replace function public._number_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  select * into v from public.projects where id = new.project_id for update;
  if found and v.quote_number is null then
    update public.projects set quote_number = public._next_quote_number(v.owner_id, public._today_india())
     where id = v.id;
  end if;
  return new;
end;
$$;
drop trigger if exists scope_snapshots_number_quote on public.scope_snapshots;
create trigger scope_snapshots_number_quote after insert on public.scope_snapshots
  for each row execute function public._number_quote();

-- Quotes already sent: numbered in the order they were first sent, per financial year.
do $$
declare
  r record;
begin
  for r in
    select p.id, p.owner_id, (min(s.created_at) at time zone 'Asia/Kolkata')::date as first_sent
      from public.projects p join public.scope_snapshots s on s.project_id = p.id
     where p.quote_number is null
     group by p.id, p.owner_id
     order by p.owner_id, min(s.created_at)
  loop
    update public.projects set quote_number = public._next_quote_number(r.owner_id, r.first_sent) where id = r.id;
  end loop;
end;
$$;

revoke all on function public._next_quote_number(uuid, date), public._number_quote() from public, anon, authenticated;
