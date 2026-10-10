"""python3 run_golive_cron.py - the go-live copies of the three files whose pg_cron jobs named staging's address
(docs/GO-LIVE.md 1.1): server/tally-cloud/golive/migration-13-golive.sql, server/gst-taxpro/golive/schema-golive.sql and
server/gst-taxpro/golive/migration-16-golive.sql. On a throwaway PostgreSQL (pg_stand) with stand-ins for Vault, pg_net and
pg_cron (the real pgmq when it is installed, as run_migration47.py does); never on staging or live.
Checks: without the Vault secret fincom_project_url, or with staging's address in it, each copy refuses and leaves nothing;
with it set, each copy runs TWICE cleanly; the jobs are scheduled once each; no job's command holds a project address; run,
each job calls the configured address (and follows the secret when it changes); and the copies end with the same functions,
columns and job commands (address aside) as the originals run once on a second database."""
import os, re, sys, subprocess, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..", "server")
COPIES = [("schema", "gst-taxpro/schema.sql", "gst-taxpro/golive/schema-golive.sql"),
          ("13", "tally-cloud/migration-13-fast-sync.sql", "tally-cloud/golive/migration-13-golive.sql"),
          ("16", "gst-taxpro/migration-16-tax-accuracy.sql", "gst-taxpro/golive/migration-16-golive.sql")]
STAGING = "qbocskaiewaxqcvaunzc"
ADDR = "https://abcdefghijklmnopqrst.supabase.co"      # a made-up project address
ADDR2 = "https://zyxwvutsrqponmlkjihg.supabase.co"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

STANDINS = r"""
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
-- Vault stand-in (the secret kept plain: nothing secret here)
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$
  insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null) returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
-- pg_net stand-in: every call is written down
create schema if not exists net;
create table if not exists net.calls (id bigserial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds integer);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
begin
  if url is null then raise exception 'net.http_post: url is null'; end if;
  insert into net.calls (url, headers, body, timeout_milliseconds) values (url, headers, body, timeout_milliseconds); return currval('net.calls_id_seq');
end $$;
-- pg_cron stand-in (1.6: schedule by name replaces a job of that name)
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin delete from cron.job where jobname = job_name; return found; end $$;
-- Realtime stand-in
create schema if not exists realtime;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$ select $$;
do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;
-- the tables 13 alters, as on staging (only the columns it touches)
create table if not exists public.tally_devices (id uuid primary key, firm_id uuid, name text, revoked boolean default false, want_update_at timestamptz);
create table if not exists public.tally_post_jobs (id uuid primary key default gen_random_uuid(), firm_id uuid, device_id uuid, status text, taken_at timestamptz, updated_at timestamptz, message text);
insert into firms (id, name) values ('99999999-9999-9999-9999-999999999999', 'Test firm') on conflict do nothing;
insert into tally_devices (id, firm_id, name) values ('d1000000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 'PC-1'),
  ('d1000000-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999999', 'PC-2') on conflict do nothing;
"""
def setup(port):
    db = pg_stand.start(port)
    db.sql(STANDINS)
    try:
        db.sql("create extension if not exists pgmq;"); print("== pgmq: the real extension")
    except RuntimeError:
        s = open(os.path.join(HERE, "run_migration47.py")).read(); i = s.index('SCHEMA47 = r"""') + 15
        stand = re.search(r"-- pgmq stand-in \{.*?-- \} pgmq stand-in\n", s[i:s.index('"""', i)], re.S).group(0)
        db.sql(stand); print("== pgmq: the stand-in from run_migration47.py")
    return db
def run_file(db, path):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def state(db):
    funcs = db.rows("select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1")
    cols = db.rows("select table_name || '.' || column_name || ' ' || data_type || ' ' || coalesce(column_default, '') as c from information_schema.columns where table_schema = 'public' order by 1")
    jobs = db.rows("select jobname, schedule, command from cron.job order by 1")
    return funcs, cols, jobs
def norm(cmd):
    return cmd.replace("'https://%s.supabase.co/functions/v1/" % STAGING, "<ADDR>'/functions/v1/").replace(
        "(select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/", "<ADDR>'/functions/v1/")

for _, orig, copy in COPIES:
    t = open(os.path.join(ROOT, copy)).read()
    ok(not re.search(r"https://[a-z0-9]{20}\.supabase\.co", t), copy + ": names no project address")
    ok("fincom_project_url" in t, copy + ": reads the address from Vault (fincom_project_url)")

db = setup(30491)
try:
    print("== without the secret, then with staging's address: each copy refuses and leaves nothing")
    before = state(db)
    for label, _, copy in COPIES:
        r = run_file(db, os.path.join(ROOT, copy))
        ok(r.returncode != 0 and "fincom_project_url" in r.stderr, "%s refuses without the secret" % label)
    db.sql("select vault.create_secret('https://%s.supabase.co', 'fincom_project_url', 'test')" % STAGING)
    for label, _, copy in COPIES:
        r = run_file(db, os.path.join(ROOT, copy))
        ok(r.returncode != 0 and "names staging" in r.stderr, "%s refuses staging's address" % label)
    db.sql("update vault.secrets set secret = 'https://abc.example.com/' where name = 'fincom_project_url'")
    r = run_file(db, os.path.join(ROOT, COPIES[1][2])); ok(r.returncode != 0, "13 refuses an address that is not https://<project id>.supabase.co")
    ok(state(db) == before and db.one("select count(*) from vault.secrets where name <> 'fincom_project_url'") == "0", "nothing was made by the refused runs (no job, table, function or key)")

    print("== with the secret set: schema, 13 and 16, each twice")
    db.sql("update vault.secrets set secret = '%s' where name = 'fincom_project_url'" % ADDR)
    tokens = None
    for label, _, copy in COPIES:
        for n in (1, 2):
            r = run_file(db, os.path.join(ROOT, copy))
            ok(r.returncode == 0, "%s run %d: clean%s" % (label, n, "" if r.returncode == 0 else " -- " + r.stderr[-400:]))
            if label == "13":
                t = db.rows("select id, wake_token from tally_devices order by id")
                if n == 1: tokens = t; ok(all(x["wake_token"] for x in t), "13 gave every device a wake token")
                else: ok(t == tokens, "13's second run left the wake tokens as they were")
    jobs = {r["jobname"]: r for r in db.rows("select jobname, schedule, command from cron.job")}
    ok(sorted(jobs) == ["gst-daily", "gst-taxpro-refresh", "tally-post-requeue", "tally-work"], "the four jobs, once each: %s" % sorted(jobs))
    ok(all(not re.search(r"supabase\.co|https?://", j["command"]) for j in jobs.values()), "no job's command holds an address")
    ok(db.one("select count(*) from vault.secrets where name in ('tally_work_key', 'gst_cron_key')") == "2", "the two keys made once (tally_work_key, gst_cron_key)")
    ok(db.one("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tally_jobs'") == "1", "tally_jobs in the realtime publication once")

    print("== the jobs, run: they call the configured address")
    db.sql("select pgmq.send('tally_work', '{\"x\":1}'::jsonb)")
    db.sql("insert into gst_sessions (firm_id, gstin, username, expires_at) values ('99999999-9999-9999-9999-999999999999', '27AAAAA0000A1Z5', 'u', now() + interval '1 hour')")
    for name, path in (("tally-work", "/functions/v1/tally-ingest"), ("gst-taxpro-refresh", "/functions/v1/gst-taxpro"), ("gst-daily", "/functions/v1/gst-taxpro")):
        db.sql("truncate net.calls"); db.sql(jobs[name]["command"])
        calls = db.rows("select url, headers::text as h from net.calls")
        ok(len(calls) == 1 and calls[0]["url"] == ADDR + path, "%s calls %s" % (name, calls[0]["url"] if calls else "nothing"))
        key = "tally_work_key" if name == "tally-work" else "gst_cron_key"
        ok(calls and db.one("select decrypted_secret from vault.decrypted_secrets where name = '%s'" % key) in calls[0]["h"], "%s sends its key (%s)" % (name, key))
    db.sql("select public.tally_post_requeue()"); ok(True, "tally-post-requeue's function runs")
    db.sql("update vault.secrets set secret = '%s' where name = 'fincom_project_url'" % ADDR2); db.sql("truncate net.calls"); db.sql(jobs["tally-work"]["command"])
    ok(db.one("select url from net.calls") == ADDR2 + "/functions/v1/tally-ingest", "the address is read at each run (a changed secret is followed)")
    copies_state = state(db)
finally:
    db.stop()

print("== the originals, once, on a second database: the same functions, columns and jobs (address aside)")
db2 = setup(30492)
try:
    for label, orig, _ in COPIES:
        r = run_file(db2, os.path.join(ROOT, orig)); ok(r.returncode == 0, "original %s runs%s" % (label, "" if r.returncode == 0 else " -- " + r.stderr[-300:]))
    of, oc, oj = state(db2); cf, cc, cj = copies_state
    ok(of == cf, "the same public functions, text for text (%d)" % len(of))
    ok(oc == cc, "the same public columns (%d)" % len(oc))
    ok([(j["jobname"], j["schedule"], norm(j["command"])) for j in oj] == [(j["jobname"], j["schedule"], norm(j["command"])) for j in cj], "the same jobs and schedules; the commands differ only in where the address comes from")
finally:
    db2.stop()

print("\n%d check(s) failed" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
