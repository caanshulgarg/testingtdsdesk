-- Rollback of migration 145 (corp_documents). NOT a migration: run by hand only if 145 has to be taken back.
-- The table holds the documents people made: refused while it has rows unless, after keeping a copy
-- (select * from corp_documents), the person sets for this session:  set fincom.corp_rollback = 'drop-with-rows';
-- Without the table the documents page says it is not set up on FinCom's server and takes no edit (store.js: a missing
-- table is said for that part). The function dropped below is also the lock on FINAL documents. Safe to run twice.
begin;
set local lock_timeout = '10s';
do $$
begin
  if to_regclass('public.corp_documents') is not null then
    if exists (select 1 from public.corp_documents) and coalesce(current_setting('fincom.corp_rollback', true), '') <> 'drop-with-rows' then
      raise exception 'corp_documents has % rows: keep a copy first, then set fincom.corp_rollback = ''drop-with-rows''', (select count(*) from public.corp_documents);
    end if;
    drop table public.corp_documents;
  end if;
end $$;
drop function if exists public.corp_documents_touch();
commit;
