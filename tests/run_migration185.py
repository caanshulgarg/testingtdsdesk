"""python3 tests/run_migration185.py - server/mis-run/migration-185-mis-timer-address.sql (13-Nov-2026, branch
next-sec-db): the timer of the scheduled MIS reports calls this project's own address from Vault, and a signed-in person
reads only the open row of app_settings. On a throwaway PostgreSQL (pg_stand, port 31885 unless PG185_PORT; never a real
database), with stand-ins for pg_cron (run_migration157's), pg_net (the call is written down, nothing is sent) and Vault
(zoho_stand's); made-up addresses and keys only. The job is first made as migration 100 makes it (its command cut from
100's file), at 157's minutes.
  0. the file: one transaction, lock_timeout 10 s; add-only (one policy; no table, row, function or job dropped; no
     schedule named); names no real database; its md5
  1. runs, and a second time (the second changes nothing)
  2. the job: the same id, minutes and state; its command reads no table for the address; every other job untouched
  3. run as the timer runs it: one call, to Vault's address + /functions/v1/mis-run, with the key and body as before, only
     when a schedule is due; the address in app_settings changed to another host: the call still goes to the project's
  4. app_settings: a member reads the row 'signup' only; the platform administrator every row; the service role and a
     SECURITY DEFINER reader every row; anon nothing more than before
  5. Vault without fincom_project_url, or with one that is not https://host: the job is left as it was (said, no error)
  6. no pg_cron: the file runs, the policy is made
RED_WITHOUT_185=1: the same checks without running 185 (2, 3 and 4 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
import zoho_stand as Z
M100 = os.path.join(ROOT, "server", "mis-run", "migration-100-mis-schedules.sql")
M185 = os.path.join(ROOT, "server", "mis-run", "migration-185-mis-timer-address.sql")
RED = os.environ.get("RED_WITHOUT_185") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M185).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M185), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(code.count("begin;") == 1 and code.count("commit;") == 1 and code.strip().startswith("begin;") and code.strip().endswith("commit;")
   and "set local lock_timeout = '10s';" in code, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\b|\btruncate\b|delete\s+from|create\s+(table|index|trigger|or replace)|alter\s+(table|policy|function)|\binsert\s+into\b|\bupdate\s+[a-z_.]+\s+set\b|\brevoke\b|\bgrant\b", code)
   and len(re.findall(r"create policy", code)) == 1, "add-only: one policy; nothing dropped, no table, row or function changed")
ok("cron.unschedule" not in code and "cron.schedule" not in code and "schedule :=" not in code and len(re.findall(r"cron\.alter_job\(job_id := j\.jobid, command := cmd\)", code)) == 1,
   "the job's command changed in place: no job removed or added, no schedule named")
ok("app_settings" not in re.search(r"\$job\$(.*?)\$job\$", text, re.S).group(1), "the job's command names no setting")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", text.lower()), "names no real database")

OLD = re.search(r"perform cron\.schedule\('mis-run-due', '\*/15 \* \* \* \*', \$c\$(.*?)\$c\$\);", open(M100).read(), re.S).group(1)
HOME, AWAY, KEY = "https://made-up-project.example", "https://elsewhere.example", "made-up-timer-key-0185"
F, U, ADMIN = "99999999-9999-4999-8999-999999990185", "aaaaaaaa-0185-4000-8000-000000000001", "aaaaaaaa-0185-4000-8000-000000000002"
q = lambda s: "'" + str(s).replace("'", "''") + "'"
SETUP = Z.part(os.path.join(HERE, "run_migration157.py"), "CRON") + Z.VAULT + """
grant usage on schema public, auth to anon, authenticated, service_role; alter role service_role bypassrls;
grant select on members to authenticated;
create schema net;
create table net.calls (id bigserial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds int);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $f$
  insert into net.calls (url, headers, body, timeout_milliseconds) values (url, headers, body, timeout_milliseconds) returning id $f$;
create table mis_schedules (id bigserial primary key, firm_id uuid, enabled boolean default true, next_run timestamptz);
create table app_settings (name text primary key, value jsonb);
alter table app_settings enable row level security;
create policy settings_read on app_settings for select to authenticated using (true);
grant select on app_settings to anon, authenticated; grant select, insert, update, delete on app_settings to service_role;
create table platform_admins (user_id uuid primary key);
create or replace function is_superadmin() returns boolean language sql stable security definer set search_path = public as $f$ select exists (select 1 from platform_admins where user_id = auth.uid()) $f$;
create or replace function signup_info() returns jsonb language sql stable security definer set search_path = public as $f$ select value from app_settings where name = 'signup' $f$;
create or replace function t_setting(p text) returns jsonb language sql stable security definer set search_path = public as $f$ select value from app_settings where name = p $f$;
insert into firms values (%(F)s, 'Made-up Firm'); insert into members values (%(U)s, %(F)s, 'Made-up Member', 'staff', true); insert into platform_admins values (%(A)s);
insert into app_settings values ('signup', '{"open": true}'), ('mis_run', %(row)s), ('rustdesk', '{"host": "made-up.example"}');
select vault.create_secret(%(key)s, 'gst_cron_key'); select vault.create_secret(%(home)s, 'fincom_project_url');
select cron.schedule('made-up-other', '* * * * *', 'select 1');
select cron.schedule('mis-run-due', '9-59/15 * * * *', %(old)s);
select cron.schedule('gst-share-engine', '*/10 * * * *', 'select made_up()');
""" % dict(F=q(F), U=q(U), A=q(ADMIN), row=q(json.dumps({"url": HOME + "/functions/v1/mis-run"})), key=q(KEY), home=q(HOME), old=q(OLD))
JOBS = "select jobid, jobname, schedule, command, active from cron.job order by jobid"
def run_file(db):
    try: db.sql(text); return ""
    except RuntimeError as x: return str(x)
def fire(db):
    """as pg_cron does: the job's command, as it stands; -> the calls it made"""
    db.sql("truncate net.calls;")
    db.sql(db.rows("select command from cron.job where jobname = 'mis-run-due'")[0]["command"] + ";")
    return db.rows("select url, headers::text as headers, body::text as body, timeout_milliseconds as t from net.calls order by id")
db = pg_stand.start(int(os.environ.get("PG185_PORT") or 31885))
try:
    db.sql(SETUP)
    before = db.rows(JOBS)
    print("== 1. runs")
    if not RED:
        e = run_file(db); first = db.rows(JOBS); e = e or run_file(db)
        ok(not e, "runs, and a second time" + (": " + e[-400:] if e else ""))
        ok(db.rows(JOBS) == first, "the second run changes nothing")
    print("== 2. the job")
    after = db.rows(JOBS)
    b, a = {r["jobname"]: r for r in before}, {r["jobname"]: r for r in after}
    m0, m1 = b["mis-run-due"], a["mis-run-due"]
    ok(len(after) == len(before) == 3 and all(a[n] == b[n] for n in b if n != "mis-run-due"), "no job added or removed; the other jobs untouched")
    ok((m1["jobid"], m1["schedule"], m1["active"]) == (m0["jobid"], "9-59/15 * * * *", m0["active"]), "mis-run-due: the same id, minutes (%s) and state" % m1["schedule"])
    ok("app_settings" not in m1["command"] and "fincom_project_url" in m1["command"] and "/functions/v1/mis-run" in m1["command"], "its address: Vault's fincom_project_url, no setting read")
    ok("gst_cron_key" in m1["command"] and "next_run <= now()" in m1["command"] and '{"action":"due"}' in m1["command"] and "timeout_milliseconds := 30000" in m1["command"], "the key, the body, the wait and the due test as before")
    print("== 3. run as the timer runs it")
    ok(fire(db) == [], "no schedule due: no call")
    db.sql("insert into mis_schedules (firm_id, enabled, next_run) values (%s, true, now() - interval '1 minute'), (%s, false, now() - interval '1 hour');" % (q(F), q(F)))
    c = fire(db)
    ok(len(c) == 1 and c[0]["url"] == HOME + "/functions/v1/mis-run" and json.loads(c[0]["headers"]).get("x-cron-key") == KEY and json.loads(c[0]["body"]) == {"action": "due"} and c[0]["t"] == "30000",
       "a schedule due: one call to %s with the key and body" % (c[0]["url"] if c else "?"))
    db.sql("set role service_role; update app_settings set value = %s where name = 'mis_run';" % q(json.dumps({"url": AWAY + "/x"})))
    c = fire(db)
    ok(len(c) == 1 and c[0]["url"] == HOME + "/functions/v1/mis-run", "the setting's address changed to another host: the call goes to %s" % (c[0]["url"] if c else "nowhere"))
    db.sql("delete from app_settings where name = 'mis_run';")
    c = fire(db)
    ok(len(c) == 1 and c[0]["url"] == HOME + "/functions/v1/mis-run", "the setting's row gone: the report still goes out (%d call)" % len(c))
    db.sql("insert into app_settings values ('mis_run', %s);" % q(json.dumps({"url": HOME + "/functions/v1/mis-run"})))
    print("== 4. app_settings")
    names = lambda pre: sorted(r["name"] for r in db.rows(pre + " select name from app_settings"))
    ok(names("set role authenticated; set fincom.uid = %s;" % q(U)) == ["signup"], "a member reads: %s" % names("set role authenticated; set fincom.uid = %s;" % q(U)))
    ok(names("set role authenticated; set fincom.uid = %s;" % q(ADMIN)) == ["mis_run", "rustdesk", "signup"], "the platform administrator reads every row")
    ok(names("set role service_role;") == ["mis_run", "rustdesk", "signup"], "the service role reads every row")
    ok(names("set role anon;") == [], "anon reads no row")
    ok(json.loads(db.one("set role anon; select signup_info()")) == {"open": True} and "made-up.example" in db.one("set role authenticated; set fincom.uid = %s; select t_setting('rustdesk')::text" % q(U)),
       "signup_info and a SECURITY DEFINER reader answer as before")
    pol = db.rows("select policyname, permissive, cmd, roles::text as roles from pg_policies where tablename = 'app_settings' order by 1")
    ok([p["policyname"] for p in pol] == (["settings_read"] if RED else ["app_settings_open_rows", "settings_read"]) and (RED or (pol[0]["permissive"], pol[0]["cmd"]) == ("RESTRICTIVE", "SELECT")),
       "the read policy that was there is kept; one restrictive policy added: %s" % [(p["policyname"], p["permissive"]) for p in pol])
    print("== 5. Vault not ready")
    if not RED:
        for what, sql in (("no fincom_project_url", "delete from vault.secrets where name = 'fincom_project_url';"),
                          ("a fincom_project_url with a slash at its end", "select vault.create_secret(%s, 'fincom_project_url');" % q(HOME + "/")),
                          ("no gst_cron_key", "update vault.secrets set secret = %s where name = 'fincom_project_url'; delete from vault.secrets where name = 'gst_cron_key';" % q(HOME))):
            db.sql(sql + "update cron.job set command = %s where jobname = 'mis-run-due';" % q(OLD))
            e = run_file(db)
            ok(not e and db.rows(JOBS) == before, "%s: the job is left as it was, no error" % what)
        db.sql("select vault.create_secret(%s, 'gst_cron_key');" % q(KEY))
        e = run_file(db)
        ok(not e and "app_settings" not in db.rows(JOBS)[1]["command"], "both there again: the file run again changes the job")
    print("== 6. no pg_cron")
    if not RED:
        db.sql("alter schema cron rename to cron_away; drop policy app_settings_open_rows on app_settings;")
        e = run_file(db)
        ok(not e and db.one("select count(*) from pg_policies where tablename = 'app_settings' and policyname = 'app_settings_open_rows'") == "1", "the file runs; the policy is made" + (": " + e[-300:] if e else ""))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
