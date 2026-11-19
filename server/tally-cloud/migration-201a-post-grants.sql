-- migration-201a-post-grants.sql (19-Nov-2026, branch next-fix-posttimeout). Found while applying 199-202 on staging.
--
-- Supabase's default privileges give anon and authenticated every privilege on a new table of the public schema. 201
-- revokes insert, update, delete, truncate, references and trigger from authenticated on tally_post_register_pending and
-- grants it 11 columns, but the table-level SELECT the default gave stayed: a member of the firm read every column of the
-- firm's rows (row security on), the vouchers' XML (vlist) and the posting's maps among them. And PostgreSQL 17's MAINTAIN
-- (VACUUM, ANALYZE, REINDEX, LOCK TABLE) stayed for anon and authenticated on the new tables of 199-202.
--   1. tally_post_register_pending: SELECT revoked from authenticated (which revokes its column grants too), then the 11
--      columns of 201 granted again: job_id, firm_id, since, cursor, total, dirty, passes, last_at, done_at, words,
--      failed_at (what the page reads). service_role keeps everything; anon has nothing (201).
--   2. MAINTAIN revoked from anon and authenticated on the new tables of 199-202 that exist (tally_post_self_settle,
--      tally_post_register_pending, tally_post_register_wants, tally_post_work_errors, tally_post_rechecks,
--      tally_post_recheck_plans): PostgreSQL 17 and later only (a no-op before: the privilege does not exist).
-- Add-only (grants only), one transaction, lock_timeout 10 s, safe twice. Runs after 201; run it again after 202 (its two
-- tables then exist too). Tested by tests/run_migration201a.py (RED_WITHOUT_201A=1 fails).
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.tally_post_register_pending') is null or to_regprocedure('public.tally_post_work_run(integer)') is null then
    raise exception 'migration 201a runs after 201 (199, 200, 201, then 201a, then 202 and 201a again)';
  end if;
end $$;

-- 1. the 11 columns only
revoke select on public.tally_post_register_pending from authenticated;
grant select (job_id, firm_id, since, cursor, total, dirty, passes, last_at, done_at, words, failed_at) on public.tally_post_register_pending to authenticated;

-- 2. PostgreSQL 17's MAINTAIN off the new tables that exist
do $$ declare t text; begin
  if current_setting('server_version_num')::int >= 170000 then
    foreach t in array array['tally_post_self_settle', 'tally_post_register_pending', 'tally_post_register_wants', 'tally_post_work_errors',
                             'tally_post_rechecks', 'tally_post_recheck_plans'] loop
      if to_regclass('public.' || t) is not null then
        execute format('revoke maintain on public.%I from anon, authenticated', t);
      end if;
    end loop;
  end if;
end $$;
commit;
