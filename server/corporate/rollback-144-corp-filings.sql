-- Rollback of migration 144 (corp_filings). NOT a migration: run by hand only if 144 has to be taken back.
-- The table holds what people recorded (the forms' progress and SRNs): refused while it has rows unless, after keeping a
-- copy (select * from corp_filings), the person sets for this session:  set fincom.corp_rollback = 'drop-with-rows';
-- Without the table the app keeps e-Forms on each computer (store.js: a missing table is not an error). Safe to run twice.
begin;
set local lock_timeout = '10s';
do $$
begin
  if to_regclass('public.corp_filings') is not null then
    if exists (select 1 from public.corp_filings) and coalesce(current_setting('fincom.corp_rollback', true), '') <> 'drop-with-rows' then
      raise exception 'corp_filings has % rows: keep a copy first, then set fincom.corp_rollback = ''drop-with-rows''', (select count(*) from public.corp_filings);
    end if;
    drop table public.corp_filings;
  end if;
end $$;
drop function if exists public.corp_filings_touch();
commit;
