-- =====================================================================
-- ScopeFlow — Follow-up reminders.
--
--   * follow_ups: the freelancer's own reminders ("Call Dana about the final files"),
--     with a date and an optional project. Shown in the dashboard's Reminders when due.
--     Private to the owner; written only through the functions below.
--   * Automatic reminders (pending approvals, overdue invoices and payments, deadlines,
--     expiring client links) are worked out in the app from existing data: no new storage.
--
-- Safe to re-run. Rollback: supabase/rollback/20261108000000_follow_ups_down.sql
-- =====================================================================

create table if not exists public.follow_ups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete cascade,
  due_on      date not null check (due_on >= date '2000-01-01'),
  note        text not null check (char_length(note) between 1 and 300),
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists follow_ups_owner_due_idx on public.follow_ups (owner_id, due_on) where done_at is null;

alter table public.follow_ups enable row level security;
drop policy if exists "own follow-ups" on public.follow_ups;
create policy "own follow-ups" on public.follow_ups for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.follow_ups from public, anon, authenticated;
grant select on public.follow_ups to authenticated;

create or replace function public.add_follow_up(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._uid();
  v_project uuid := nullif(p ->> 'project_id', '')::uuid;
  v_due date := nullif(p ->> 'due_on', '')::date;
  v_note text := nullif(left(trim(coalesce(p ->> 'note', '')), 300), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'Write what to follow up on' using errcode = '22023';
  end if;
  if v_due is null or v_due < current_date - 1 or v_due > current_date + 730 then
    raise exception 'Pick a date from today up to two years ahead' using errcode = '22023';
  end if;
  if v_project is not null and not exists (select 1 from public.projects where id = v_project and owner_id = v_uid) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.follow_ups where owner_id = v_uid and done_at is null) >= 200 then
    raise exception 'You have 200 open follow-ups. Mark some as done first.' using errcode = '54000';
  end if;
  insert into public.follow_ups (owner_id, project_id, due_on, note)
  values (v_uid, v_project, v_due, v_note)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_follow_up_done(p_follow_up_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.follow_ups
     set done_at = case when p_done then coalesce(done_at, now()) end
   where id = p_follow_up_id and owner_id = public._uid();
  if not found then
    raise exception 'Follow-up not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.delete_follow_up(p_follow_up_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follow_ups where id = p_follow_up_id and owner_id = public._uid();
  if not found then
    raise exception 'Follow-up not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.add_follow_up(jsonb), public.set_follow_up_done(uuid, boolean), public.delete_follow_up(uuid)
  from public, anon, authenticated;
grant execute on function public.add_follow_up(jsonb), public.set_follow_up_done(uuid, boolean), public.delete_follow_up(uuid)
  to authenticated;
