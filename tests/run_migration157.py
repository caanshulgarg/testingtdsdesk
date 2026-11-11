"""python3 run_migration157.py - server/tally-cloud/migration-157-cron-housekeeping.sql (11-Nov-2026, the reliability
audit, cloud items C5 and C10; the owner's decision of 11-Nov-2026: trim the old job logs, stagger the jobs that start
together at minute 0). On a throwaway PostgreSQL (pg_stand, port 31157 unless PG157_PORT; never a real database) with a
stand-in for pg_cron (cron.job, cron.job_run_details, cron.schedule, cron.alter_job as pg_cron names them). Made-up
rows only. Written before the file. Checks:
  0. the file: one transaction, lock_timeout 10 s; names no real database; the ONLY delete is from
     cron.job_run_details; no drop, truncate, alter table, update or insert; no job unscheduled; one procedure, nobody
     but its owner may call it; nothing is trimmed by running the file itself.
  1. the trim: rows that ended more than 14 days ago go, in batches (each its own commit, at most p_batches a run);
     rows of the last 14 days, and rows that never started, stay; a second run removes nothing more.
  2. the daily job is there once (also after the second run of the file) and calls the procedure.
  3. the eight jobs that met at minute 0 keep their name, command and frequency, only the minute moves; the new
     minutes never meet each other; a job the owner already moved, a job of another name and the every-minute job are
     left as they are; the second run changes nothing.
  4. a database without pg_cron: the file still runs (nothing scheduled)."""
import os, re, sys, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.environ.get("M157_FILE") or os.path.join(HERE, "..", "server", "tally-cloud", "migration-157-cron-housekeeping.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
MOVES = [("gst-taxpro-refresh", "*/20 * * * *", "5-59/20 * * * *"), ("tally-alert-gaps", "*/10 * * * *", "2-59/10 * * * *"), ("tally-alert-silent", "*/30 3-13 * * 1-6", "10-59/30 3-13 * * 1-6"),
         ("zoho-books-sync", "*/5 * * * *", "1-59/5 * * * *"), ("gst-2b-match-queue", "*/15 * * * *", "4-59/15 * * * *"), ("mis-run-due", "*/15 * * * *", "9-59/15 * * * *"),
         ("tally-post-register-settle", "*/10 * * * *", "7-59/10 * * * *"), ("tally-alert-stopped", "*/5 3-13 * * 1-6", "3-59/5 3-13 * * 1-6")]
def minutes(sched):
    f = sched.split()[0]
    if f == "*": return set(range(60))
    rng, step = (f.split("/") + ["1"])[:2]
    a, b = (0, 59) if rng == "*" else [int(x) for x in rng.split("-")]
    return set(range(a, b + 1, int(step)))
CRON = r"""
create schema cron;
create table cron.job (jobid bigserial primary key, schedule text not null, command text not null, nodename text default 'localhost', nodeport int default 5432, database text default 'postgres', username text default 'postgres', active boolean default true, jobname text unique);
create table cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid int, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values ($1, $2, $3) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language plpgsql as $$
begin
  update cron.job j set schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command), active = coalesce(alter_job.active, j.active) where j.jobid = job_id;
  if not found then raise exception 'no such job'; end if;
end $$;
"""
text = open(M).read() if os.path.exists(M) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text: print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction, lock_timeout 10 s")
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    dels = re.findall(r"delete\s+from\s+([\w.]+)", code)
    ok(dels == ["cron.job_run_details"], "0. the only delete is from cron.job_run_details (%s)" % dels)
    ok(not re.search(r"\b(drop|truncate|insert|unschedule|vacuum)\b", code) and not re.search(r"\balter\s+table\b", code) and not re.search(r"\bupdate\s+\w", code), "0. no drop, truncate, alter table, update, insert or unschedule")
    ok(re.findall(r"create or replace (function|procedure) public\.(\w+)", code) == [("procedure", "cron_run_details_trim")], "0. one procedure, no function")
    ok(re.search(r"revoke all on procedure public\.cron_run_details_trim\(integer, integer\) from public, anon, authenticated, service_role;", text) is not None, "0. nobody but its owner may call the procedure")
    ok(not re.search(r"^\s*call\s", code, re.M), "0. the file itself trims nothing (no call outside the job's text)")
    for name, old, new in MOVES:
        ok(("'%s'" % name) in text and ("'%s'" % old) in text and ("'%s'" % new) in text, "0. the file names %s: %s -> %s" % (name, old, new))

db = pg_stand.start(int(os.environ.get("PG157_PORT") or 31157))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
try:
    db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;")
    if text:
        r = psql_text(text)
        ok(r.returncode == 0 and db.one("select to_regclass('cron.job') is null") in ("t", "true"), "4. without pg_cron the file runs and schedules nothing: %s" % r.stderr[-300:])
    db.sql(CRON)
    db.sql("insert into cron.job (jobname, schedule, command) values " + ", ".join("(%s, %s, %s)" % (q(n), q(o), q("select made_up_" + str(i) + "()")) for i, (n, o, _) in enumerate(MOVES))
           + ", ('tally-post-requeue', '* * * * *', 'select made_up_minute()'), ('made-up-other', '*/5 * * * *', 'select made_up_other()'), ('made-up-daily', '30 13 * * *', 'select made_up_daily()');")
    db.sql("update cron.job set schedule = '3-59/15 * * * *' where jobname = 'mis-run-due'")       # the owner moved this one already
    # the job log: 12,000 old rows, 500 of the last 14 days, 3 still running (no end), 2 never started, 1 started long ago and never ended
    db.sql("""insert into cron.job_run_details (jobid, status, start_time, end_time) select 1 + i % 5, 'succeeded', now() - interval '15 days' - i * interval '1 minute', now() - interval '15 days' - i * interval '1 minute' + interval '1 second' from generate_series(1, 12000) i;
      insert into cron.job_run_details (jobid, status, start_time, end_time) select 1 + i % 5, 'succeeded', now() - i * interval '40 minutes', now() - i * interval '40 minutes' + interval '1 second' from generate_series(1, 500) i;
      insert into cron.job_run_details (jobid, status, start_time, end_time) values (1, 'running', now() - interval '5 seconds', null), (2, 'running', now() - interval '1 day', null), (3, 'running', now() - interval '13 days 23 hours', null),
        (4, 'starting', null, null), (5, 'starting', null, null), (1, 'running', now() - interval '40 days', null),
        (2, 'succeeded', now() - interval '14 days' + interval '1 minute', now() - interval '14 days' + interval '2 minutes');""")
    before_jobs = db.rows("select jobid, jobname, schedule, command, active from cron.job order by jobid")
    if text:
        r = psql_text(text); ok(r.returncode == 0, "157 runs (first time): %s" % r.stderr[-300:])
    ok(db.one("select count(*) from cron.job_run_details") == "12507", "0. running the file trims nothing by itself")
    print("== 1. the trim")
    ex = lambda rl: db.one("select has_function_privilege(%s, 'public.cron_run_details_trim(integer, integer)', 'execute')" % q(rl))
    try: ok(all(ex(rl) in ("f", "false") for rl in ("anon", "authenticated", "service_role")), "1. anon, authenticated and service_role cannot call it")
    except RuntimeError as e: ok(False, "1. the procedure is there (%s)" % str(e)[-120:])
    r = psql_text("call public.cron_run_details_trim(1000, 3);")
    ok(r.returncode == 0 and db.one("select count(*) from cron.job_run_details") == "9507", "1. three batches of 1,000 and no more in one run (%s left) %s" % (db.one("select count(*) from cron.job_run_details"), r.stderr[-200:]))
    r = psql_text("begin; call public.cron_run_details_trim(1000, 3); commit;")
    ok(r.returncode != 0, "1. each batch is its own commit (the procedure refuses to run inside someone's transaction)")
    r = psql_text("call public.cron_run_details_trim();")
    left = db.rows("select count(*) n, count(*) filter (where end_time < now() - interval '14 days') old, count(*) filter (where end_time is null and start_time is null) never, count(*) filter (where end_time is null and start_time is not null) running from cron.job_run_details")[0]
    ok(r.returncode == 0 and left == {"n": "506", "old": "0", "never": "2", "running": "3"}, "1. all the old rows gone (also the one that started 40 days ago and never ended); the last 14 days, the running and the never-started stay (%s) %s" % (left, r.stderr[-200:]))
    psql_text("call public.cron_run_details_trim();")
    ok(db.one("select count(*) from cron.job_run_details") == "506", "1. a second run removes nothing more")
    if text:
        r = psql_text(text); ok(r.returncode == 0, "157 runs (second time): %s" % r.stderr[-300:])
    print("== 2. the daily job")
    tj = db.rows("select schedule, command, active from cron.job where jobname = 'cron-run-details-trim'")
    ok(len(tj) == 1 and re.fullmatch(r"\d+ \d+ \* \* \*", tj[0]["schedule"]) is not None and tj[0]["command"].startswith("call public.cron_run_details_trim("), "2. one daily job that calls the procedure (%s)" % tj)
    print("== 3. the minutes")
    after = {r["jobname"]: r for r in db.rows("select jobid, jobname, schedule, command, active from cron.job order by jobid")}
    was = {r["jobname"]: r for r in before_jobs}
    ok(all(after[n]["command"] == was[n]["command"] and after[n]["jobid"] == was[n]["jobid"] and after[n]["active"] == was[n]["active"] for n in was) and len(after) == len(was) + 1, "3. the same jobs, ids and commands; one job more (the trim)")
    for name, old, new in MOVES:
        if name == "mis-run-due": ok(after[name]["schedule"] == "3-59/15 * * * *", "3. %s, already moved by the owner, left as it is" % name); continue
        ok(after[name]["schedule"] == new and len(minutes(new)) == len(minutes(old)) and new.split()[1:] == old.split()[1:], "3. %s: %s -> %s (as often as before, only the minute)" % (name, old, after[name]["schedule"]))
    ok(after["tally-post-requeue"]["schedule"] == "* * * * *" and after["made-up-other"]["schedule"] == "*/5 * * * *" and after["made-up-daily"]["schedule"] == "30 13 * * *", "3. the every-minute job and jobs not named are left as they are")
    clash = [(a[0], b[0]) for i, a in enumerate(MOVES) for b in MOVES[i + 1:] if minutes(a[2]) & minutes(b[2])]
    ok(not clash and all(0 not in minutes(n) for _, _, n in MOVES), "3. no two of the moved jobs share a minute, none at minute 0 (%s)" % clash)
    tm = int(tj[0]["schedule"].split()[0]) if tj else -1
    ok(tm > 0 and all(tm not in minutes(n) for nme, _, n in MOVES if "3-13" not in n), "3. the trim's minute is none of theirs (%d)" % tm)
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
