-- Migration 220, part 2: FinCom Books' timers (23-Nov-2026, branch next-books-p1). A DRAFT, NOT run anywhere.
-- Run AFTER migration-220-fincom-books.sql. Database-only jobs (pg_cron; no edge function, no call to Tally):
--   fincom-books-catchup   every 3 minutes: mirrors what the copy changed (owner decision 23-Nov-2026: within 10 minutes)
--                          and builds new books (fb_mirror_catchup_run: a transaction per book and chunk, at most 5,000 entries a run)
--   fincom-books-tieout    nightly at 02:17 India time (20:47 UTC): the tie-out of every enrolled book against the copy
--                          (D21; "Not in step" warns only, D18). The part against Tally's own figures waits for the new
--                          bridge read (TODO D16, bridge 2.5.19): it runs in the bridge's idle window, not here
--   fincom-books-selfcheck nightly at 02:43 India time (21:13 UTC): the edit log's triggers and chain (a failure turns the
--                          book read-only), and the day's anchor
-- cron.schedule with the same name replaces the job, so this is safe to run twice. To stop them:
-- select cron.unschedule('fincom-books-catchup'); select cron.unschedule('fincom-books-tieout'); select cron.unschedule('fincom-books-selfcheck');
begin;
set local lock_timeout = '10s';

do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'migration 220 cron: pg_cron is not here: nothing scheduled';
  elsif to_regprocedure('public.fb_tieout_all()') is null then
    raise exception 'migration 220 cron: run migration-220-fincom-books.sql first';
  else
    perform cron.schedule('fincom-books-catchup', '*/3 * * * *', 'call public.fb_mirror_catchup_run(5000)');
    perform cron.schedule('fincom-books-tieout', '47 20 * * *', 'select public.fb_tieout_all()');
    perform cron.schedule('fincom-books-selfcheck', '13 21 * * *', 'select public.fb_selfcheck_all()');
  end if;
end $cron$;

commit;
