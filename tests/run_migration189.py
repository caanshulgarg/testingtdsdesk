"""python3 run_migration189.py - migration-189-signin-attempts (13-Nov-2026, branch next-sec-server).
Wrong passwords are counted where Supabase Auth checks the password (its "password verification attempt" hook); the
wait belongs to one email from one address, grows, and ends by itself.
On a throwaway PostgreSQL (pg_stand, port 31189 unless PG189_PORT; never a real database), with the lockout pieces of
migration 3 as they are, then 189 (twice). Made-up emails only.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only, names no real database, explicit grants, runs twice.
  1. one address and one email: 4 wrong passwords, no wait; the 5th: 30 s, then 60 s, 2 min, 5 min, 15 min at most; a try
     during a wait is refused without being counted; after 15 minutes without a failure the count starts again.
  2. the wait is the address's own: the same email from another address is not held; a right password ends the pair's count.
  3. the hook: a wrong password is counted for the account; after 10 counted checks in 15 minutes a check without the
     sign-in function's pass is refused with one message, the password right or wrong, and every refused check is
     counted; a login with no email on record gets the same; a pass is the pair's own, lasts ten seconds and serves
     one check; begin, fail and the hook take one advisory lock per email.
  4. the owner's unlock (auth_lockout_clear) ends every wait and count of that email.
  5. nothing kept in the clear (emails and addresses as SHA-256); anon and authenticated can run or read none of it.
RED_WITHOUT_189=1: the same checks without the file (they fail; (guard) checks hold what stays as it was)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SEC = os.path.join(HERE, "..", "server", "security")
M = os.environ.get("M189_FILE") or os.path.join(SEC, "migration-189-signin-attempts.sql")
RED = os.environ.get("RED_WITHOUT_189") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text: print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
FNS = ["auth_lockout_clear", "auth_password_attempt_hook", "auth_signin_begin", "auth_signin_fail", "auth_signin_key", "auth_signin_ok", "auth_signin_sweep", "auth_signin_wait"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    dels = sorted(set(re.findall(r"delete from (\S+)", code)))
    ok(not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.auth_signin_fails enable row level security;", "alter table public.auth_signin_pass enable row level security;"]
       and dels == ["public.auth_signin_fails", "public.auth_signin_pass"], "0. add-only: two new tables, deletes only of their own rows (%s %s)" % (alters, dels))
    ok(not re.search(r"supabase\.co|\.supabase\.|https?://", low), "0. names no real database")
    ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text))) == FNS, "0. the functions")
    ok(all(re.search(r"revoke (all|execute) on function public\.%s\([^)]*\) from public, anon, authenticated;" % f, text) for f in FNS), "0. every function taken from public, anon and authenticated")

db = pg_stand.start(int(os.environ.get("PG189_PORT") or 31189))
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-300:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def run(s):
    try: db.sql(s); return ""
    except RuntimeError as e: return str(e)[-300:]
IP1, IP2 = "a1" * 32, "b2" * 32
A, B = "asha@firm.test", "Ravi@Firm.test"
UA, UB = "11111111-1111-4111-8111-000000000189", "22222222-2222-4222-8222-000000000189"
begin = lambda e, ip: j("select public.auth_signin_begin(%s, %s)::text" % (q(e), q(ip)))
fail = lambda e, ip: j("select public.auth_signin_fail(%s, %s)::text" % (q(e), q(ip)))
done = lambda e, ip: run("select public.auth_signin_ok(%s, %s);" % (q(e), q(ip)))
hook = lambda uid, valid: j("select public.auth_password_attempt_hook(%s::jsonb)::text" % q(json.dumps({"user_id": uid, "valid": valid})))
def age(secs, where="true"): return run("update public.auth_signin_fails set at = at - make_interval(secs => %d) where %s; update public.auth_signin_pass set until = until - make_interval(secs => %d);" % (secs, where, secs))
try:
    m3 = open(os.path.join(SEC, "migration-3-phase2.sql")).read()
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
                         if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
              create table if not exists auth.users (id uuid primary key, email text);
              insert into auth.users values (%s, %s), (%s, %s);""" % (q(UA), q(A), q(UB), q(B)))
    db.sql(m3[m3.index("create table if not exists public.auth_lockout"):m3.index("-- Custom access token hook")])
    if text:
        ok(run(text) == "", "0. the file runs")
        ok(run(text) == "", "0. and runs a second time")
    # ---- 1. one address, one email: the wait grows and ends by itself
    print("== 1. one email from one address")
    seen = []
    for i in range(4):
        b = begin(A, IP1); f = fail(A, IP1); seen.append((b.get("allowed"), f.get("fails"), f.get("wait_s")))
    ok(seen == [(True, 1, 0), (True, 2, 0), (True, 3, 0), (True, 4, 0)], "1. four wrong passwords: each tried, no wait (%s)" % seen)
    waits = []
    for i in range(5):
        b = begin(A, IP1)
        if b.get("allowed") is not True: waits.append(("refused", b)); break
        f = fail(A, IP1); waits.append(f.get("wait_s"))
        held = begin(A, IP1)
        n0 = db.one("select count(*) from public.auth_signin_fails") if text else None
        held2 = begin(A, IP1)
        if not (held.get("allowed") is False and 0 < int(held.get("wait_s") or 0) <= int(f.get("wait_s") or 0) and held.get("until") and held2.get("allowed") is False and db.one("select count(*) from public.auth_signin_fails") == n0):
            waits.append(("not held", held)); break
        age(int(f.get("wait_s") or 0) + 1, "true") if i < 4 else None
    ok(waits[:4] == [30, 60, 120, 300], "1. the 5th wrong password and on: wait 30 s, 60 s, 2 min, 5 min; a try during the wait is refused and not counted (%s)" % waits)
    ok(all(isinstance(w, int) and w <= 900 for w in waits) and len(waits) >= 5, "1. never more than 15 minutes (%s)" % waits[4:])
    age(901)
    b = begin(A, IP1)
    ok(b.get("allowed") is True and b.get("fails") == 0, "1. 15 minutes without a failure: tried again, counted from none (%s)" % b)
    done(A, IP1)
    # ---- 2. the wait belongs to the address
    print("== 2. another address, and a right password")
    for i in range(5): begin(A, IP1); fail(A, IP1)
    b1, b2, bcase = begin(A, IP1), begin(A, IP2), begin(" ASHA@Firm.Test ", IP1)
    ok(b1.get("allowed") is False and b2.get("allowed") is True and b2.get("fails") == 0, "2. the address that failed waits; the same email from another address is tried at once (%s / %s)" % (b1, b2))
    ok(bcase.get("allowed") is False, "2. the email in another case, or with spaces, is the same email")
    ok(begin(B, IP1).get("allowed") is True, "2. another email from the waiting address is tried (the address's own count is the function's)")
    fail(A, IP2); done(A, IP2)
    ok(db.one("select count(*) from public.auth_signin_fails where ip_key = %s" % q(IP2)) == "0" and int(db.one("select count(*) from public.auth_signin_fails where ip_key = %s" % q(IP1)) or 0) >= 5, "2. a right password ends that pair's count, not another address's")
    bad = begin(A, "not-a-hash")
    ok("_error" in bad, "2. an address is taken only as a SHA-256")
    run("delete from public.auth_signin_fails; delete from public.auth_signin_pass;") if text else None
    # ---- 3. the hook
    print("== 3. Auth's password hook")
    CONT = {"decision": "continue"}
    ok(hook(UB, True) == CONT and hook(UB, False) == CONT, "3. a right password goes on; a wrong one goes on to Auth's own refusal")
    ok(db.one("select count(*) from public.auth_signin_fails where ip_key = ''") == "1", "3. the wrong one is counted for the account, whichever way it came")
    for i in range(8): hook(UB, False)
    ok(hook(UB, True) == CONT, "3. nine wrong in 15 minutes: a right password still goes on")
    hook(UB, False)
    r = hook(UB, True)
    ok(r.get("decision") == "reject" and r.get("should_logout_user") is False and "wrong passwords" in str(r.get("message")) and B.lower() not in json.dumps(r).lower(), "3. ten wrong: a check without the sign-in function's pass is refused (%s)" % r)
    n0 = db.one("select count(*) from public.auth_signin_fails where ip_key = ''") if text else None
    w = hook(UB, False)
    ok(w == r and text and db.one("select count(*) from public.auth_signin_fails where ip_key = ''") == str(int(n0) + 1), "3. a wrong password then gets the same answer as a right one, and is still counted")
    n1 = db.one("select count(*) from public.auth_signin_fails where ip_key = ''") if text else None
    ok(hook(UB, True) == r and text and db.one("select count(*) from public.auth_signin_fails where ip_key = ''") == str(int(n1) + 1), "3. every refused check is counted, the password right or wrong")
    ok(hook(UA, True) == CONT, "3. another account is not held")
    b = begin(B, IP2)
    ok(b.get("allowed") is True and hook(UB, True) == CONT, "3. through the sign-in function (its pass): the right password is taken")
    ok(hook(UB, True) == r and hook(UB, False) == r, "3. a pass serves one check: the next one, right or wrong, is refused")
    done(B, IP2)
    begin(B, IP2)
    ok(hook(UB, False) == CONT and hook(UB, True) == r, "3. a wrong password uses the pass up too (Auth refuses it in its own words)")
    begin(B, IP2); fail(B, IP2)
    ok(hook(UB, True) == r, "3. a wrong password through the function ends its pass")
    begin(B, IP1); begin(B, IP2); fail(B, IP1)
    ok(db.one("select count(*) from public.auth_signin_pass where ip_key = %s" % q(IP2)) == "1" and db.one("select count(*) from public.auth_signin_pass where ip_key = %s" % q(IP1)) == "0" if text else False, "3. a pass is the pair's own: another address's failure does not end it")
    ok(hook(UB, True) == CONT and db.one("select count(*) from public.auth_signin_pass") == "0" if text else False, "3. and one check uses it up")
    done(B, IP2); begin(B, IP2)
    age(11, "false")
    ok(hook(UB, True) == r, "3. a pass lasts ten seconds")
    begin(B, IP1); begin(B, IP2)
    ok(hook(UB, True) == CONT and hook(UB, True) == CONT and hook(UB, True) == r, "3. two addresses' passes: two checks")
    age(901)
    ok(hook(UB, True) == CONT, "3. 15 minutes on: the account's count has ended by itself")
    ok(hook("33333333-3333-4333-8333-000000000189", True) == CONT and hook("", False) == CONT, "3. (guard) a login it does not know: left to Auth")
    UX = "44444444-4444-4444-8444-000000000189"
    for i in range(10): hook(UX, False)
    ok(hook(UX, True) == r and hook(UX, False) == r and hook(UB, True) == CONT, "3. a login with no email on record: counted under its id, and past the count it gets the same answer")
    ok("44444444" not in json.dumps(db.rows("select * from public.auth_signin_fails")) if text else False, "3. and its id is kept only as a SHA-256")
    lock = re.findall(r"pg_advisory_xact_lock\(hashtextextended\(([^,]+), 0\)\)", text)
    ok(len(lock) == 3 and len(set(lock)) == 1, "3. begin, fail and the hook take one advisory lock, per email (%s)" % set(lock))
    # ---- 4. the owner's unlock
    print("== 4. the owner's unlock")
    for i in range(10): hook(UA, False)
    for i in range(6): begin(A, IP1); fail(A, IP1)
    run("insert into public.auth_lockout (email, fails, locked_until) values (%s, 5, now() + interval '10 minutes') on conflict (email) do update set locked_until = excluded.locked_until;" % q(A))
    held = (begin(A, IP1).get("allowed") is False, hook(UA, True).get("decision") == "reject")
    e = run("select public.auth_lockout_clear(%s, %s::uuid);" % (q(" Asha@FIRM.test"), q(UB)))
    ok(held == (True, True) and e == "" and hook(UA, True) == CONT and begin(A, IP1).get("allowed") is True, "4. unlock ends the address's wait and the account's count (%s %s)" % (held, e))
    ok(db.one("select locked_until is null and unlocked_by = %s::uuid from public.auth_lockout where email = %s" % (q(UB), q(A))) == "t", "4. (guard) and the old lock, with who unlocked")
    # ---- 5. hashes and grants
    print("== 5. nothing in the clear, nothing for anon or authenticated")
    dump = json.dumps(db.rows("select * from public.auth_signin_fails") + db.rows("select * from public.auth_signin_pass")) if text else A
    ok("firm.test" not in dump.lower(), "5. no email kept in the clear")
    for role in ("anon", "authenticated"):
        errs = [run("set role %s; %s" % (role, s)) for s in ("select public.auth_signin_begin('x@y.test', '%s');" % IP1, "select public.auth_signin_fail('x@y.test', '%s');" % IP1, "select public.auth_signin_ok('x@y.test', '%s');" % IP1,
                "select public.auth_lockout_clear('x@y.test', null);", "select public.auth_password_attempt_hook('{}'::jsonb);", "select public.auth_signin_sweep();", "select * from public.auth_signin_fails;", "select * from public.auth_signin_pass;")]
        ok(all("permission denied" in e for e in errs), "5. %s: none of it (%s)" % (role, [e[-40:] for e in errs if "permission denied" not in e]))
    ok(run("set role service_role; select public.auth_signin_begin('x@y.test', '%s'); select public.auth_signin_fail('x@y.test', '%s'); select public.auth_signin_ok('x@y.test', '%s'); select public.auth_signin_sweep();" % (IP1, IP1, IP1)) == "", "5. the service role (the functions) runs them")
    ok(run("set role supabase_auth_admin; select public.auth_password_attempt_hook('{}'::jsonb);") == "" and "permission denied" in run("set role supabase_auth_admin; select public.auth_signin_begin('x@y.test', '%s');" % IP1), "5. Supabase Auth runs the hook, and only the hook")
    run("insert into public.auth_signin_fails (email_key, at) values (repeat('c', 64), now() - interval '3 days'), (repeat('d', 64), now());")
    ok(j("select public.auth_signin_sweep()::text") == 1 and db.one("select count(*) from public.auth_signin_fails where email_key = repeat('d', 64)") == "1", "5. the sweep removes rows older than 2 days only")
except RuntimeError as e:
    ok(False, "stopped: " + str(e).strip().splitlines()[0][:160])
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
