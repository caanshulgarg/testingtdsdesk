"""python3 run_migration112.py - migration-112-auth-rate-limits (26-Oct-2026, branch next-sec-pkce; NOT run on staging) on a
throwaway PostgreSQL (pg_stand, port 31112 unless PG112_PORT; never a real database):
  0. the file: one transaction, lock_timeout 10 s; add-only (nothing dropped, no table altered but to turn row-level
     security on, the only "delete" the sweep's of its own old rows); names no real database; md5
  1. runs, and runs a second time (once with a stand-in pg_cron: the sweep job made once; once without: nothing asked of it)
  2. grants are explicit: the service role uses the table and the four functions; anon and authenticated nothing
  3. auth_rate_hit: allows max tries per key within the window, then refuses without counting; keys and buckets apart;
     the window slides; two connections taking the last try at once: one gets it
  4. auth_rate_count / auth_rate_add (sign-in failures per address); auth_rate_sweep removes rows older than 2 days only
  5. what is kept is a hash: a key that is not 64 hex characters is refused
RED_WITHOUT_112=1: the same checks without running the file (1 to 5 fail)."""
import os, re, sys, hashlib, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "security", "migration-112-auth-rate-limits.sql")
RED = os.environ.get("RED_WITHOUT_112") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\s+", code) and "truncate" not in code and re.findall(r"delete from ([\w.]+)", code) == ["public.auth_rate_hits"]
   and not re.search(r"\balter\s+table\b(?!\s+public\.auth_rate_hits\s+enable row level security)", code), "add-only: nothing dropped, the only delete the sweep's of its own table")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")
ok(all(("grant execute on function public.%s" % f) in code for f in ("auth_rate_hit", "auth_rate_count", "auth_rate_add", "auth_rate_sweep")), "grants explicit for each function")

STAND = r"""
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
"""
# a stand-in for pg_cron (the extension is not on the stand): cron.job and cron.schedule as the migration uses them
CRON = r"""
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
"""
H = lambda s: hashlib.sha256(s.encode()).hexdigest()
db = pg_stand.start(int(os.environ.get("PG112_PORT") or 31112))
try:
    db.sql(STAND)
    one = db.one
    SR = "set role service_role; "
    print("== 1. runs, twice")
    try:
        if not RED: db.sql(text)
        ran1 = True
    except Exception as e: ran1 = False; print("    " + str(e)[:300])
    ok(ran1 and one("select to_regclass('public.auth_rate_hits')::text") == "auth_rate_hits", "runs on a database without pg_cron (no sweep job asked for)")
    db.sql(CRON)
    try:
        if not RED: db.sql(text); db.sql(text)
        ran2 = True
    except Exception as e: ran2 = False; print("    " + str(e)[:300])
    ok(ran2 and one("select count(*) from cron.job where jobname = 'auth-rate-sweep'") == "1", "runs twice more with pg_cron: the hourly sweep job made once")
    ok(one("select command from cron.job where jobname = 'auth-rate-sweep'") == "select public.auth_rate_sweep()", "the job calls auth_rate_sweep()")

    print("== 2. grants")
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    FNS = ["public.auth_rate_hit(text,text,integer,integer)", "public.auth_rate_count(text,text,integer)", "public.auth_rate_add(text,text)", "public.auth_rate_sweep()"]
    try:
        ok(all(fx("service_role", f) == "true" for f in FNS), "the service role calls the four functions")
        ok(all(fx(r, f) == "false" for r in ("anon", "authenticated") for f in FNS), "anon and authenticated call none of them")
        tp = lambda role: one("select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where grantee = '%s' and table_name = 'auth_rate_hits'" % role) or ""
        ok(tp("anon") == "" and tp("authenticated") == "" and all(p in tp("service_role") for p in ("DELETE", "INSERT", "SELECT")), "the table: service role only (%s)" % tp("service_role"))
        ok(one("select relrowsecurity::text from pg_class where relname = 'auth_rate_hits'") == "true", "row-level security on (no policy: nobody but the service role)")
    except Exception as e: ok(False, "grants: " + str(e)[:200])

    print("== 3. auth_rate_hit")
    try:
        hit = lambda b, k, mx=3, w=600: one(SR + "select public.auth_rate_hit('%s', '%s', %d, %d)::text" % (b, H(k), mx, w))
        r = [hit("signup-ip", "1.2.3.4") for _ in range(5)]
        ok(r == ["true", "true", "true", "false", "false"], "3 per window: the 4th and 5th refused (%s)" % r)
        ok(one("select count(*) from public.auth_rate_hits where bucket = 'signup-ip'") == "3", "a refused try is not counted")
        ok(hit("signup-ip", "5.6.7.8") == "true" and hit("signup-email", "1.2.3.4") == "true", "another key, another bucket: counted apart")
        db.sql("update public.auth_rate_hits set at = now() - interval '11 minutes' where bucket = 'signup-ip' and key = '%s' and id = (select min(id) from public.auth_rate_hits where key = '%s')" % (H("1.2.3.4"), H("1.2.3.4")))
        ok(hit("signup-ip", "1.2.3.4") == "true" and hit("signup-ip", "1.2.3.4") == "false", "the window slides: one try older than 10 minutes frees one")
        # two connections at once for the last try
        db.sql("insert into public.auth_rate_hits (bucket, key) select 'race', '%s' from generate_series(1, 4)" % H("r"))
        out = []
        def take(): out.append(one(SR + "select public.auth_rate_hit('race', '%s', 5, 600)::text" % H("r")))
        ts = [threading.Thread(target=take) for _ in range(6)]; [t.start() for t in ts]; [t.join() for t in ts]
        ok(out.count("true") == 1 and one("select count(*) from public.auth_rate_hits where bucket = 'race'") == "5", "six connections for the last try: exactly one gets it (%s)" % sorted(out))
        try: one(SR + "select public.auth_rate_hit('x', '%s', 1, 999999)" % H("x")); bad = False
        except Exception: bad = True
        ok(bad, "a window longer than 2 days is refused")
    except Exception as e: ok(False, "auth_rate_hit: " + str(e)[:200])

    print("== 4. count, add, sweep")
    try:
        for _ in range(4): db.sql(SR + "select public.auth_rate_add('signin-fail-ip', '%s')" % H("9.9.9.9"))
        ok(one(SR + "select public.auth_rate_count('signin-fail-ip', '%s', 900)" % H("9.9.9.9")) == "4", "failures from one address counted (4)")
        db.sql("insert into public.auth_rate_hits (bucket, key, at) values ('old', '%s', now() - interval '3 days'), ('old', '%s', now() - interval '47 hours')" % (H("o"), H("o")))
        n = one(SR + "select public.auth_rate_sweep()")
        ok(n == "1" and one("select count(*) from public.auth_rate_hits where bucket = 'old'") == "1", "the sweep removes rows older than 2 days only (%s removed)" % n)
        ok(one(SR + "select public.auth_rate_count('signin-fail-ip', '%s', 900)" % H("9.9.9.9")) == "4", "and leaves the recent ones")
    except Exception as e: ok(False, "count/add/sweep: " + str(e)[:200])

    print("== 5. only hashes are kept")
    try:
        try: db.sql(SR + "select public.auth_rate_add('signup-email', 'asha@new.test')"); refused = False
        except Exception: refused = True
        ok(refused, "an email in the clear is refused (the key must be a SHA-256)")
    except Exception as e: ok(False, "hash check: " + str(e)[:200])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
