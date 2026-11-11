-- migration-157-cron-housekeeping (11-Nov-2026, the reliability audit, cloud items C5 and C10). Written, NOT run yet:
-- the owner reads it and runs it. The owner's decision of 11-Nov-2026: trim the old job logs; stagger the jobs that
-- start together at minute 0.
-- Why: (C5) pg_cron writes one row to cron.job_run_details for every run of every job and never removes one: on
-- staging 309,042 rows, 107 MB of the 398 MB database (two jobs run every 30 s, one every minute: about 13,000 rows
-- a day; the oldest row is of 25-Sep-2026). (C10) every "*/n" schedule meets at minute 0: at 03:00:00 UTC of
-- 11-Nov-2026 nine jobs started in the same 50 ms, just before the database stopped answering for 36 minutes.
--
-- 1. The job log. THE ONLY ROWS THIS FILE'S CODE EVER DELETES ARE ROWS OF cron.job_run_details (pg_cron's own log
--    of past runs) THAT ENDED MORE THAN 14 DAYS AGO (never ended: started more than 14 days ago). No job, no book,
--    no other table.
--    - public.cron_run_details_trim(p_batch, p_batches): deletes such rows oldest first, p_batch rows at a time
--      (5,000 unless said; 20,000 at most), each batch in its own commit with a short rest after it, at most p_batches
--      batches a run (100 unless said): no long transaction, no lock held beyond a batch, the dead rows of one batch
--      free for autovacuum before the next. A row still running or never started is kept. It is a procedure with no
--      SET clause and not SECURITY DEFINER because it commits (as tally_recorder_drain_run, migration 47); nobody but
--      its owner (the role pg_cron runs jobs as) may call it.
--    - the job 'cron-run-details-trim', daily at 21:53 UTC (03:23 India time): calls it.
--    - the one-time trim of what has piled up (about 250,000 rows on staging) is that job's first night: about 50
--      batches of 5,000, a few seconds in all. Running this file trims nothing by itself (a procedure that commits
--      cannot be called inside this file's transaction). To trim at once after running the file, as its own statement
--      outside any transaction:   call public.cron_run_details_trim(5000, 100);
--    - the space: the deleted rows' pages are used again by new rows, so the table stops growing; it does not shrink
--      on disk by itself (that would take VACUUM FULL cron.job_run_details, which locks the table while it runs:
--      the owner's decision, not in this file).
-- 2. The minutes. The same jobs, the same commands, as often as before; only the minute moves, and only for a job
--    whose schedule is still the old one (a job moved by hand, or a database without the job: left as it is).
--      job (staging id)                 old                    new                      runs at minute
--      zoho-books-sync (13)             */5 * * * *            1-59/5 * * * *           1, 6, 11, ... 56
--      tally-alert-stopped (23)         */5 3-13 * * 1-6       3-59/5 3-13 * * 1-6      3, 8, 13, ... 58
--      tally-alert-gaps (9)             */10 * * * *           2-59/10 * * * *          2, 12, 22, 32, 42, 52
--      tally-post-register-settle (19)  */10 * * * *           7-59/10 * * * *          7, 17, 27, 37, 47, 57
--      gst-2b-match-queue (14)          */15 * * * *           4-59/15 * * * *          4, 19, 34, 49
--      mis-run-due (15)                 */15 * * * *           9-59/15 * * * *          9, 24, 39, 54
--      gst-taxpro-refresh (2)           */20 * * * *           5-59/20 * * * *          5, 25, 45
--      tally-alert-silent (10)          */30 3-13 * * 1-6      10-59/30 3-13 * * 1-6    10, 40
--    No two of these share a minute any more, and none of them meets gst-daily (minute 30), auth-rate-sweep (23) or
--    a nightly job. NOT moved: tally-post-requeue (4), the ninth job of 03:00:00: it runs every minute ("* * * * *"),
--    so it has no minute to move to; tally-work (3) and tally-recorder-drain (8) run every 30 seconds.
-- A database without pg_cron: the procedure is made, nothing is scheduled. Safe to run twice.
-- Tested: tests/run_migration157.py (a stand-in for pg_cron's tables and functions).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the job log
create or replace procedure public.cron_run_details_trim(p_batch integer default 5000, p_batches integer default 100)
language plpgsql as $procedure$
declare lim int := least(greatest(coalesce(p_batch, 5000), 1), 20000); most int := least(greatest(coalesce(p_batches, 100), 1), 1000); i int := 0; n bigint;
begin
  if to_regclass('cron.job_run_details') is null then return; end if;
  while i < most loop
    delete from cron.job_run_details where runid in (
      select d.runid from cron.job_run_details d where coalesce(d.end_time, d.start_time) < now() - interval '14 days' order by d.runid limit lim);
    get diagnostics n = row_count;
    commit;
    i := i + 1;
    exit when n < lim;
    perform pg_sleep(0.1);
  end loop;
end $procedure$;
revoke all on procedure public.cron_run_details_trim(integer, integer) from public, anon, authenticated, service_role;

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('cron-run-details-trim', '53 21 * * *', 'call public.cron_run_details_trim(5000, 100)');     -- 03:23 India time, daily
  else
    raise notice 'pg_cron is not here: cron-run-details-trim is not scheduled';
  end if;
end $do$;

-- ---------------------------------------------------------------- 2. the minutes
do $do$
declare r record; j record;
begin
  if to_regclass('cron.job') is null or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null then
    raise notice 'pg_cron is not here: no schedule moved';
    return;
  end if;
  for r in select * from (values
      ('zoho-books-sync',            '*/5 * * * *',       '1-59/5 * * * *'),
      ('tally-alert-stopped',        '*/5 3-13 * * 1-6',  '3-59/5 3-13 * * 1-6'),
      ('tally-alert-gaps',           '*/10 * * * *',      '2-59/10 * * * *'),
      ('tally-post-register-settle', '*/10 * * * *',      '7-59/10 * * * *'),
      ('gst-2b-match-queue',         '*/15 * * * *',      '4-59/15 * * * *'),
      ('mis-run-due',                '*/15 * * * *',      '9-59/15 * * * *'),
      ('gst-taxpro-refresh',         '*/20 * * * *',      '5-59/20 * * * *'),
      ('tally-alert-silent',         '*/30 3-13 * * 1-6', '10-59/30 3-13 * * 1-6')) v(name, old, new) loop
    for j in select c.jobid from cron.job c where c.jobname = r.name and c.schedule = r.old loop
      perform cron.alter_job(job_id := j.jobid, schedule := r.new);
      raise notice 'job % (%): % -> %', r.name, j.jobid, r.old, r.new;
    end loop;
  end loop;
end $do$;

commit;
