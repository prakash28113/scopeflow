-- Rollback for 20261127000001_promo_solo199.sql: removes the SOLO199 code. Subscriptions already bought with it keep their discount. Safe to re-run.
begin;
delete from public.promo_codes where code = 'SOLO199';
commit;
