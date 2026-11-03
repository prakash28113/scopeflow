-- Rollback for quote numbers (20261118000000_quote_numbers.sql). Removes the numbering; quotes
-- render without a number again. Safe to re-run.
begin;
drop trigger if exists scope_snapshots_number_quote on public.scope_snapshots;
drop function if exists public._number_quote();
drop function if exists public._next_quote_number(uuid, date);
drop index if exists public.projects_owner_quote_number_idx;
alter table public.projects drop column if exists quote_number;
alter table public.profiles drop column if exists quote_seq, drop column if exists quote_fy;
commit;
