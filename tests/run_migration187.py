"""python3 tests/run_migration187.py - server/console/migration-187-console-last-used.sql (13-Nov-2026, branch
next-sec-db): the console's "last used" of each platform key read by named, fixed readings; 122's helper that took a text
runs nothing any more. On a throwaway PostgreSQL (pg_stand, port 31187 unless PG187_PORT; never a real database), made-up
rows only, with migration 122's own two functions first (cut from its file).
  0. the file: one transaction, lock_timeout 10 s; add-only (functions only, no table touched); names no real database;
     every text 122 passed to its helper is one of 187's fixed readings, word for word; its md5
  1. runs, and a second time
  2. the Keys page's answer (console_secret_last_used) is the same as 122's, key for key, with a table and two columns
     that are not on the database (null, never an error), and as the service role
  3. console_try_ts: answers null and runs nothing whatever it is given; the service role may not call it
  4. console_last_ts: a name only (a query, an unknown name, null: null and nothing run); only the database's owner
  5. grants: nothing for public, anon or authenticated on the three; the service role on console_secret_last_used only
RED_WITHOUT_187=1: the same checks without running 187 (3, 4 and 5 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M122 = os.path.join(ROOT, "server", "console", "migration-122-console-ops.sql")
M187 = os.path.join(ROOT, "server", "console", "migration-187-console-last-used.sql")
RED = os.environ.get("RED_WITHOUT_187") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
t122, text = open(M122).read(), open(M187).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M187), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(code.count("begin;") == 1 and code.count("commit;") == 1 and code.strip().startswith("begin;") and code.strip().endswith("commit;")
   and "set local lock_timeout = '10s';" in code, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\b|\btruncate\b|delete\s+from|create\s+(table|index|policy|trigger)|alter\s+|\binsert\s+into\b|\bupdate\s+[a-z_.]+\s+set\b", code)
   and len(re.findall(r"create or replace function", code)) == 3, "add-only: three functions (one new, two with their old arguments), nothing else")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", text.lower()), "names no real database")
f122 = lambda name: re.search(r"create or replace function public\.%s\(.*?\nend \$\$;" % name, t122, re.S).group(0)
old_used, old_try = f122("console_secret_last_used"), f122("console_try_ts")
passed = [x.replace("''", "'") for x in re.findall(r"console_try_ts\('((?:[^']|'')*)'\)", old_used)]
fixed = re.findall(r"then \$q\$(.*?)\$q\$", text)
ok(len(passed) == 18 and len(fixed) == 17 and set(passed) == set(fixed), "the %d texts 122 passed (%d different) are 187's %d fixed readings, word for word" % (len(passed), len(set(passed)), len(fixed)))
ok(re.findall(r"\bexecute\s+(?!on function)\S+", code) == ["execute q"] and len(re.findall(r"p_sql", code)) == 1, "one execute, of a fixed reading only; the text given to console_try_ts is never used")

SETUP = """
do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
grant usage on schema public to anon, authenticated, service_role;
create table wallet_entries (at timestamptz, code text); create table assistant_log (at timestamptz); create table assistant_usage (day date);
create table call_captions (created_at timestamptz);            -- no "at" column: that reading is null
create table call_transcripts (created_at timestamptz); create table mis_runs (created_at timestamptz, emailed int); create table call_invites (created_at timestamptz);
create table gst_returns (fetched_at timestamptz); create table gst_filing_log (at timestamptz); create table gst_sessions (updated_at timestamptz);
create table zoho_log (at timestamptz);                         -- no created_at; zoho_api_usage is not on this database
create table call_rooms (created_at timestamptz, started_at timestamptz);
insert into wallet_entries values ('2026-11-01 10:00+05:30', 'claude'), ('2026-11-02 11:00+05:30', 'vision'), ('2026-10-01 09:00+05:30', 'other');
insert into assistant_log values ('2026-11-03 12:00+05:30'); insert into assistant_usage values ('2026-11-05');
insert into call_captions values ('2026-11-04 08:00+05:30'); insert into mis_runs values ('2026-11-06 07:00+05:30', 0), ('2026-11-01 07:00+05:30', 2);
insert into call_invites values ('2026-10-20 15:00+05:30'); insert into gst_filing_log values ('2026-11-07 16:00+05:30');
insert into zoho_log values ('2026-11-08 17:00+05:30'); insert into call_rooms values ('2026-11-09 18:00+05:30', null);
-- something a text could reach: a function that leaves a mark
create table t_marks (at timestamptz default now(), who text);
create or replace function t_mark() returns timestamptz language plpgsql security definer set search_path = public as $f$ begin insert into t_marks (who) values (current_user); return now(); end $f$;
"""
def refused(db, sql):
    try: db.sql(sql); return ""
    except RuntimeError as e: return str(e)
db = pg_stand.start(int(os.environ.get("PG187_PORT") or 31187))
try:
    db.sql(SETUP); db.sql(old_try + "\n" + old_used)
    db.sql("revoke all on function console_try_ts(text), console_secret_last_used() from public; grant execute on function console_try_ts(text), console_secret_last_used() to service_role;")
    j0 = json.loads(db.one("select public.console_secret_last_used()"))
    print("== 1. runs")
    if not RED:
        e = ""
        try: db.sql(text); db.sql(text)
        except RuntimeError as x: e = str(x)
        ok(not e, "runs, and a second time" + (": " + e[-400:] if e else ""))
    print("== 2. the Keys page's answer")
    j1 = json.loads(db.one("set role service_role; select public.console_secret_last_used()"))
    ok(j1 == j0 and len(j1) == 9, "the same as 122's, key for key (%d keys), as the service role" % len(j1))
    ok(str(j1.get("claude", "")).startswith("2026-11-05T18:29:59") and str(j1.get("vision", "")).startswith("2026-11-02T05:30:00") and j1.get("fyn") is None
       and str(j1.get("resend", "")).startswith("2026-11-01T01:30:00") and j1.get("zoho") is not None and j1.get("groq") is not None,
       "claude %s, vision %s, resend %s; a missing table or column is null, never an error" % (j1.get("claude"), j1.get("vision"), j1.get("resend")))
    print("== 3. console_try_ts")
    v = db.one("select coalesce(public.console_try_ts('select public.t_mark()')::text, 'null')")
    n = db.one("select count(*) from t_marks")
    ok(v == "null" and n == "0", "given a text that would leave a mark: null, and no mark (%s, %s)" % (v, n))
    ok(db.one("select coalesce(public.console_try_ts('select now()')::text, 'null')") == "null", "given a harmless text: null too")
    e = refused(db, "set role service_role; select public.console_try_ts('select now()');")
    ok("permission denied" in e, "the service role may not call it")
    print("== 4. console_last_ts")
    if RED: ok(False, "console_last_ts is there")
    else:
        r = db.rows("select coalesce(public.console_last_ts('select public.t_mark()')::text, 'null') as a, coalesce(public.console_last_ts('nothing')::text, 'null') as b, coalesce(public.console_last_ts(null)::text, 'null') as c, "
                    "coalesce(public.console_last_ts('zoho_api_usage')::text, 'null') as d, public.console_last_ts('wallet_claude') is not null as e")[0]
        ok(r["a"] == "null" and r["b"] == "null" and r["c"] == "null" and db.one("select count(*) from t_marks") == "0", "a query, an unknown name, null: null and nothing run")
        ok(r["d"] == "null" and r["e"] == "t", "a reading whose table is not here: null; one that is: its time")
        e = refused(db, "set role service_role; select public.console_last_ts('wallet_claude');")
        ok("permission denied" in e, "the service role may not call it either (only through console_secret_last_used)")
    print("== 5. grants")
    g = {r["f"]: r["a"] for r in db.rows("select p.proname as f, coalesce((select string_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end, ',' order by 1) from aclexplode(p.proacl) a where a.grantee <> p.proowner), '') as a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('console_try_ts', 'console_last_ts', 'console_secret_last_used')")}
    ok(g == {"console_try_ts": "", "console_last_ts": "", "console_secret_last_used": "service_role"}, "the owner only on console_try_ts and console_last_ts; the service role on console_secret_last_used: %s" % g)
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
