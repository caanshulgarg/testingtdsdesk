"""python3 run_migration191.py - migration-191-rate-take (13-Nov-2026, branch next-sec-server).
auth_rate_take counts n more for a bucket and key only when they fit under the maximum, in one call.
On a throwaway PostgreSQL (pg_stand, port 31891 unless PG191_PORT; never a real database), with migration 112 as it
is, then 191 (twice). Made-up keys only.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only, names no real database, explicit grants, runs twice.
  1. n that fit are counted and the answer is true; n that do not fit: false and nothing counted; keys and buckets
     apart; the window slides.
  2. eight connections at once, each asking for 3 of the last 5 places: exactly one gets them.
  3. what cannot be meant (n below 1, a window over 2 days, a key that is not a SHA-256) is refused.
  4. the service role runs it; anon and authenticated do not.
  5. (guard) migration 112's own functions answer as before.
RED_WITHOUT_191=1: the same checks without the file (they fail; (guard) checks hold what stays as it was)."""
import os, re, sys, hashlib, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SEC = os.path.join(HERE, "..", "server", "security")
M = os.environ.get("M191_FILE") or os.path.join(SEC, "migration-191-rate-take.sql")
RED = os.environ.get("RED_WITHOUT_191") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text: print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
SIG = "public.auth_rate_take(text, text, integer, integer, integer)"
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    ok(not re.search(r"\b(drop|truncate|delete from|alter table|create table)\b", code) and re.findall(r"create or replace function public\.(\w+)", code) == ["auth_rate_take"], "0. add-only: one new function")
    ok(not re.search(r"supabase\.co|\.supabase\.|https?://", low), "0. names no real database")
    ok(("revoke execute on function %s from public, anon, authenticated;" % SIG) in code and ("grant execute on function %s to service_role;" % SIG) in code, "0. grants explicit")
H = lambda s: hashlib.sha256(s.encode()).hexdigest()
db = pg_stand.start(int(os.environ.get("PG191_PORT") or 31891))
def run(s):
    try: db.sql(s); return ""
    except RuntimeError as e: return str(e)[-300:]
def one(s):
    try: return db.one(s)
    except RuntimeError as e: return "error: " + str(e)[-200:]
SR = "set role service_role; "
take = lambda b, k, n, mx=5, w=600: one(SR + "select public.auth_rate_take('%s', '%s', %d, %d, %d)::text" % (b, k if len(k) == 64 else H(k), n, mx, w))
count = lambda b, k: one("select count(*) from public.auth_rate_hits where bucket = '%s' and key = '%s'" % (b, H(k)))
try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
              grant usage on schema public to anon, authenticated, service_role;""")
    db.sql(open(os.path.join(SEC, "migration-112-auth-rate-limits.sql")).read())
    if text:
        ok(run(text) == "", "0. the file runs")
        ok(run(text) == "", "0. and runs a second time")
    print("== 1. n at a time")
    r = [take("mail-firm", "firm-a", 3), take("mail-firm", "firm-a", 3), take("mail-firm", "firm-a", 2), take("mail-firm", "firm-a", 1)]
    ok(r == ["true", "false", "true", "false"] and count("mail-firm", "firm-a") == "5", "1. 5 at most: 3 taken, 3 more refused and not counted, 2 taken, then none (%s, %s rows)" % (r, count("mail-firm", "firm-a")))
    ok(take("mail-firm", "firm-b", 5) == "true" and take("other", "firm-a", 5) == "true", "1. another key and another bucket are counted apart")
    run("update public.auth_rate_hits set at = now() - interval '11 minutes' where bucket = 'mail-firm' and key = '%s' and id in (select id from public.auth_rate_hits where bucket = 'mail-firm' and key = '%s' order by id limit 2)" % (H("firm-a"), H("firm-a")))
    ok(take("mail-firm", "firm-a", 3) == "false" and take("mail-firm", "firm-a", 2) == "true", "1. the window slides: two places older than it are free again")
    print("== 2. at once")
    out = []
    def go(): out.append(take("race", "r", 3))
    ts = [threading.Thread(target=go) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
    ok(out.count("true") == 1 and count("race", "r") == "3", "2. eight connections, each for 3 of 5 places: exactly one gets them (%s, %s rows)" % (sorted(out), count("race", "r")))
    print("== 3. refused")
    bad = [take("x", "k", 0), take("x", "k", -1), take("x", "k", 1, 0), take("x", "k", 1, 5, 999999), take("x", "not-a-hash-" + "z" * 53, 1)]
    ok(all(b.startswith("error") for b in bad) and count("x", "k") == "0", "3. n below 1, a maximum below 1, a window over 2 days, a key that is not a SHA-256: refused, nothing counted")
    print("== 4. grants")
    errs = [run("set role %s; select public.auth_rate_take('x', '%s', 1, 5, 600);" % (role, H("k"))) for role in ("anon", "authenticated")]
    ok(all("permission denied" in e for e in errs), "4. anon and authenticated cannot run it (%s)" % [e[-40:] for e in errs])
    ok(take("x", "k", 1) == "true", "4. the service role runs it")
    print("== 5. migration 112's own")
    ok(one(SR + "select public.auth_rate_hit('g', '%s', 1, 600)::text" % H("g")) == "true" and one(SR + "select public.auth_rate_hit('g', '%s', 1, 600)::text" % H("g")) == "false"
       and one(SR + "select public.auth_rate_count('g', '%s', 600)::text" % H("g")) == "1", "5. (guard) auth_rate_hit and auth_rate_count as before")
except RuntimeError as e:
    ok(False, "stopped: " + str(e).strip().splitlines()[0][:160])
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
