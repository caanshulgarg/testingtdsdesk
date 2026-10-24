"""python3 run_migration100.py - migration-100-mis-schedules (22-Oct-2026, ROUND 105 B6, branch next-mis-schedule; NOT run on
staging) on a throwaway PostgreSQL (pg_stand, port 31000 unless PG100_PORT; never a real database), with Storage, pg_cron,
pg_net and Vault made plain (their tables and functions only):
  0. the file: one transaction, lock_timeout 10 s; add-only (nothing dropped but a policy or trigger it makes again, no
     "delete from", no truncate, no table altered but to turn row-level security on); names no real database; md5 printed
  1. runs, and runs a second time; the bucket mis-reports (private) and the timer mis-run-due (every 15 minutes, only when
     a schedule is due and the address is set in app_settings, with the platform's cron key) are there once
  2. grants are explicit: a member (authenticated) may read, add and change schedules and read runs, nothing more; anon
     nothing; the service role everything; mis_take only for the service role
  3. row-level security: a member reads only the firm's schedules and runs; staff and owners add and change them for their
     own firm only; a look-only member reads but cannot add or change; nobody deletes a schedule
  4. the checks: a rule, period, recipient address or member id that is not one is refused
  5. the next run in IST: daily (today if the time is still ahead, else tomorrow), weekly on the weekday, monthly on the
     day (the 31st in a short month is its last day), and worked out again when the rule or "on" changes; off: none
  6. mis_take: takes what is due, moves each on to its next time in the same statement (taken again at once: nothing);
     a schedule turned off is never taken
  7. the bucket's policy: a member reads only files under the firm's own folder
RED_WITHOUT_100=1: the same checks without running the file (1 to 7 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M100 = os.path.join(HERE, "..", "server", "mis-run", "migration-100-mis-schedules.sql")
RED = os.environ.get("RED_WITHOUT_100") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M100).read() if os.path.exists(M100) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M100), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = re.findall(r"\bdrop\s+(\w+)", code)
ok(all(d in ("policy", "trigger") for d in drops) and "delete from" not in code and "truncate" not in code
   and not re.search(r"\balter\s+table\b(?!\s+public\.mis_\w+\s+enable row level security)", code), "add-only (drops only of the policies and trigger it makes again: %s)" % sorted(set(drops)))
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database (the address comes from app_settings)")

STAND = r"""
create extension if not exists pgcrypto;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select on storage.objects, storage.buckets to authenticated;
create schema if not exists cron;
create table if not exists cron.job (jobname text primary key, schedule text, command text);
create or replace function cron.schedule(job_name text, sched text, cmd text) returns bigint language sql as $$
  insert into cron.job values (job_name, sched, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create schema if not exists net;
create table if not exists net.calls (url text, headers jsonb, body jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$
  insert into net.calls (url, headers, body) values (url, headers, body) returning 1::bigint $$;
create schema if not exists vault;
create table if not exists vault.secrets (name text primary key, secret text);
create or replace view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
insert into vault.secrets values ('gst_cron_key', 'k-123') on conflict do nothing;
create table if not exists public.app_settings (name text primary key, value jsonb, updated_at timestamptz default now());
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
"""
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
STAFF, OWN2, LOOK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "cccccccc-cccc-cccc-cccc-cccccccccccc"
db = pg_stand.start(int(os.environ.get("PG100_PORT") or 31000))
def err(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
def one(s, uid=None):
    try: return db.one(s, uid)
    except RuntimeError as e: return "ERROR " + str(e)[:300]
AS = lambda role: "set role %s; " % role
try:
    db.sql(STAND + "insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'staff'), ('%s', '%s', 'owner'), ('%s', '%s', 'readonly');" % (F1, F2, STAFF, F1, OWN2, F2, LOOK, F1)
           + " grant usage on schema auth to authenticated, service_role; grant select on members to authenticated, service_role; grant select on firms to authenticated, service_role;")
    print("== 1. runs twice")
    if not RED:
        e1 = err(text); e2 = err(text)
        ok(not e1 and not e2, "the file runs, and runs again" + (": " + (e1 or e2)[:300] if e1 or e2 else ""))
    ok(one("select count(*) from information_schema.tables where table_name in ('mis_schedules', 'mis_runs')") == "2", "the two tables")
    ok(one("select count(*)::text || ':' || coalesce(bool_and(not public)::text, 'x') from storage.buckets where id = 'mis-reports'") == "1:true", "the bucket mis-reports, private, once")
    job = db.rows("select schedule, command from cron.job where jobname = 'mis-run-due'")
    ok(len(job) == 1 and job[0]["schedule"] == "*/15 * * * *" and "app_settings where name = 'mis_run'" in job[0]["command"] and "gst_cron_key" in job[0]["command"] and "next_run <= now()" in job[0]["command"],
       "the timer: every 15 minutes, the address from app_settings, the platform's cron key, only when due")
    print("== 2. grants")
    priv = lambda role, t: one("select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t)) or ""
    ok(priv("authenticated", "mis_schedules") == "INSERT,SELECT,UPDATE" and priv("authenticated", "mis_runs") == "SELECT", "a member: read, add, change schedules; read runs (%s / %s)" % (priv("authenticated", "mis_schedules"), priv("authenticated", "mis_runs")))
    ok(priv("anon", "mis_schedules") in ("", None) and priv("anon", "mis_runs") in ("", None), "anon: nothing")
    ok("DELETE" in priv("service_role", "mis_runs") and "INSERT" in priv("service_role", "mis_runs") and "UPDATE" in priv("service_role", "mis_schedules"), "the service role: everything")
    ok(one("select has_function_privilege('authenticated', 'public.mis_take(int, timestamptz)', 'execute')::text") == "false" and one("select has_function_privilege('service_role', 'public.mis_take(int, timestamptz)', 'execute')::text") == "true", "mis_take: the service role only")
    print("== 3. row-level security")
    ins = lambda firm, cid, rule="{\"freq\":\"daily\",\"time\":\"09:00\"}", period="lastMonth", rec='{"members":[],"emails":["director@client.example"]}': (
        "insert into public.mis_schedules (firm_id, client_id, report_id, report_name, rule, period, recipients) values ('%s', '%s', 'm1', 'Monthly MIS', '%s', '%s', '%s')" % (firm, cid, rule, period, rec))
    e = err(AS("authenticated") + ins(F1, "c-a"), STAFF)
    ok(not e, "staff add a schedule for their firm" + (": " + e[:200] if e else ""))
    ok(not err(AS("authenticated") + ins(F2, "c-b"), OWN2), "an owner of another firm adds one for theirs")
    ok("row-level security" in err(AS("authenticated") + ins(F2, "c-x"), STAFF), "nobody adds one for another firm")
    ok("row-level security" in err(AS("authenticated") + ins(F1, "c-y"), LOOK), "a look-only member cannot add one")
    ok(one(AS("authenticated") + "select string_agg(client_id, ',') from public.mis_schedules", STAFF) == "c-a" and one(AS("authenticated") + "select string_agg(client_id, ',') from public.mis_schedules", LOOK) == "c-a", "each member reads only the firm's schedules (look-only too)")
    err(AS("authenticated") + "update public.mis_schedules set enabled = false", LOOK)
    err(AS("authenticated") + "update public.mis_schedules set enabled = false", OWN2)
    ok(one("select count(*) from public.mis_schedules where not enabled") == "1" and one("select client_id from public.mis_schedules where not enabled") == "c-b", "a look-only member changes nothing; an owner turns off only their firm's")
    ok("permission denied" in err(AS("authenticated") + "delete from public.mis_schedules", STAFF), "nobody deletes a schedule (it is turned off)")
    ok("permission denied" in err(AS("authenticated") + "insert into public.mis_runs (firm_id, client_id, status) values ('%s', 'c-a', 'ok')" % F1, STAFF), "a member cannot write a run")
    db.sql("insert into public.mis_runs (firm_id, client_id, status) values ('%s', 'c-a', 'ok'), ('%s', 'c-b', 'failed')" % (F1, F2))
    ok(one(AS("authenticated") + "select string_agg(client_id, ',') from public.mis_runs", STAFF) == "c-a", "a member reads only the firm's runs")
    print("== 4. the checks")
    bad = [err(ins(F1, "c-1", rule='{"freq":"hourly","time":"09:00"}')), err(ins(F1, "c-2", rule='{"freq":"daily","time":"25:00"}')), err(ins(F1, "c-3", rule='{"freq":"weekly","time":"09:00","weekday":"8"}')),
           err(ins(F1, "c-4", rule='{"freq":"monthly","time":"09:00","day":"32"}')), err(ins(F1, "c-5", period="nextYear")), err(ins(F1, "c-6", rec='{"members":[],"emails":["not an address"]}')),
           err(ins(F1, "c-7", rec='{"members":["me"],"emails":[]}'))]
    ok(all("check" in b for b in bad), "a wrong rule, time, weekday, day, period, address or member is refused (%d of %d)" % (sum("check" in b for b in bad), len(bad)))
    print("== 5. the next run (IST)")
    nr = lambda rule, after: one("select to_char(public.mis_next_run('%s'::jsonb, '%s'::timestamptz) at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')" % (rule, after))
    cases = [('{"freq":"daily","time":"09:00"}', "2026-10-22 08:00+05:30", "2026-10-22 09:00"), ('{"freq":"daily","time":"09:00"}', "2026-10-22 09:00+05:30", "2026-10-23 09:00"),
             ('{"freq":"daily","time":"07:30"}', "2026-10-22 01:00+00", "2026-10-22 07:30"), ('{"freq":"daily","time":"07:30"}', "2026-10-22 03:00+00", "2026-10-23 07:30"),
             ('{"freq":"weekly","time":"08:31","weekday":"1"}', "2026-10-22 10:00+05:30", "2026-10-26 08:31"), ('{"freq":"weekly","time":"18:00","weekday":"4"}', "2026-10-22 10:00+05:30", "2026-10-22 18:00"),
             ('{"freq":"weekly","time":"08:00","weekday":"4"}', "2026-10-22 10:00+05:30", "2026-10-29 08:00"),
             ('{"freq":"monthly","time":"10:00","day":"1"}', "2026-10-22 10:00+05:30", "2026-11-01 10:00"), ('{"freq":"monthly","time":"10:00","day":"31"}', "2026-11-05 10:00+05:30", "2026-11-30 10:00"),
             ('{"freq":"monthly","time":"10:00","day":"31"}', "2027-02-01 10:00+05:30", "2027-02-28 10:00"), ('{"freq":"monthly","time":"23:59","day":"22"}', "2026-10-22 23:00+05:30", "2026-10-22 23:59")]
    got = [nr(r, a) for r, a, _ in cases]
    ok(got == [w for _, _, w in cases], "daily, weekly and monthly, in IST: %s" % got)
    ok(one("select next_run is not null from public.mis_schedules where client_id = 'c-a'") == "t" and one("select next_run is null from public.mis_schedules where client_id = 'c-b'") == "t", "a schedule's next run is set when added; turned off: none")
    db.sql("update public.mis_schedules set enabled = true, rule = '{\"freq\":\"monthly\",\"time\":\"08:45\",\"day\":\"1\"}' where client_id = 'c-b'")
    ok(one("select to_char(next_run at time zone 'Asia/Kolkata', 'DD HH24:MI') from public.mis_schedules where client_id = 'c-b'") == "01 08:45", "worked out again when the rule changes or it is turned on")
    print("== 6. mis_take")
    db.sql("update public.mis_schedules set next_run = now() - interval '1 minute'")
    db.sql("update public.mis_schedules set enabled = false where client_id = 'c-b'")
    db.sql("update public.mis_schedules set next_run = now() - interval '1 minute' where client_id = 'c-b'")    # off, though due: never taken
    t1 = db.rows(AS("service_role") + "select client_id, next_run > now() as moved from public.mis_take(10)")
    t2 = one(AS("service_role") + "select count(*) from public.mis_take(10)")
    ok([r["client_id"] for r in t1] == ["c-a"] and t1[0]["moved"] == "t" and t2 == "0", "takes what is due once, moved on to its next time; an off schedule never: %s, then %s" % (t1, t2))
    ok("permission denied" in err(AS("authenticated") + "select * from public.mis_take(1)", STAFF), "a member cannot take schedules")
    print("== 8. mis_cloud_gst: the server's GST working, read as a member of the schedule's firm; the service role only")
    db.sql("create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('fincom.uid', true), ''))::uuid $$;"
           "create or replace function public.tally_gst_summary(p_client text, p_from date, p_to date) returns jsonb language sql stable as $$ select jsonb_build_object('client', p_client, 'firm', public.my_firm(), 'from', p_from) $$;")
    sid = one("select id from public.mis_schedules where client_id = 'c-a'")
    g = one(AS("service_role") + "select public.mis_cloud_gst('%s', '2026-09-01', '2026-09-30')::text" % sid)
    ok('"firm": "%s"' % F1 in g and '"client": "c-a"' in g, "the working read for the schedule's own firm and client: %s" % g[:120])
    ok("permission denied" in err(AS("authenticated") + "select public.mis_cloud_gst('%s', '2026-09-01', '2026-09-30')" % sid, STAFF), "a member cannot call it")
    print("== 7. the bucket's policy")
    db.sql("insert into storage.objects (bucket_id, name) values ('mis-reports', '%s/c-a/1-mis.xlsx'), ('mis-reports', '%s/c-b/2-mis.xlsx'), ('other', '%s/x.txt')" % (F1, F2, F1))
    ok(one(AS("authenticated") + "select string_agg(name, ',') from storage.objects", STAFF) == "%s/c-a/1-mis.xlsx" % F1, "a member reads only the firm's folder of mis-reports")
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
