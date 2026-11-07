-- Rollback of migration 143 (corp_profiles). NOT a migration: run by hand only if 143 has to be taken back.
-- The table holds what people typed (company profiles). So this refuses while it has rows, unless the person running it
-- has kept a copy and says so for this session:  set fincom.corp_rollback = 'drop-with-rows';
-- (select * from corp_profiles, saved, first). Without the table the app keeps Corporate's profile on each computer and
-- says the firm's copy is not shared (store.js: a missing table is not an error). Safe to run twice.
begin;
set local lock_timeout = '10s';
do $$
begin
  if to_regclass('public.corp_profiles') is not null then
    if exists (select 1 from public.corp_profiles) and coalesce(current_setting('fincom.corp_rollback', true), '') <> 'drop-with-rows' then
      raise exception 'corp_profiles has % rows: keep a copy first, then set fincom.corp_rollback = ''drop-with-rows''', (select count(*) from public.corp_profiles);
    end if;
    drop table public.corp_profiles;
  end if;
end $$;
drop function if exists public.corp_profiles_touch();
commit;
