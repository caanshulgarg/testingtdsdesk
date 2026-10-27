"""python3 run_migration124.py - server/push-send/migration-124-device-tokens.sql (27-Oct-2026, branch next-mobile; the phone
app's push tokens; NOT run on staging) on a throwaway PostgreSQL (pg_stand, port 31240 unless PG124_PORT; never a real
database), with made-up firms:
  0. the file: one transaction, lock_timeout 10 s; add-only (nothing dropped, deleted, truncated; alter only to turn on
     row-level security); names no real database; explicit grants; md5 printed
  1. runs, and runs a second time
  2. device_token_save: a member's phone is kept with their user and firm; saved again it is the same row, seen again
     (last_seen moves); a bad platform or token, a person signed out and a person in no firm are refused
  3. reads: a member reads their own phones (not the token); another member of the same firm and another firm read none;
     anon reads nothing; nobody but the service role writes the table directly
  4. a token signed in by someone else (the phone changed hands) moves to them; device_token_forget only forgets the
     person's own phone
  5. at most 10 phones in use a person (the ones not heard from longest put aside, 'too_many')
  6. the service role reads the tokens (the push-send function's read)
RED_WITHOUT_124=1: the same checks without running the file (1 to 6 fail)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "push-send", "migration-124-device-tokens.sql")
RED = os.environ.get("RED_WITHOUT_124") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = re.findall(r"\bdrop\s+(\w+)", code)
alters = re.findall(r"alter\s+table\s+([\w.]+)\s+(\w+(?:\s+\w+)?)", code)
ok(not drops and "delete from" not in code and "truncate" not in code and all(a[1] == "enable row" for a in alters), "add-only (drops: %s; alters: %s)" % (sorted(set(drops)), sorted(set(a[1] for a in alters))))
ok(not re.search(r"supabase\.co|https?://|project[_ ]ref", text.lower()), "names no real database")
ok("revoke all on public.device_tokens from public, anon, authenticated;" in text and "grant select, insert, update, delete on public.device_tokens to service_role;" in text
   and "grant execute on function public.device_token_save(text, text, text) to authenticated;" in text and "grant execute on function public.device_token_forget(text) to authenticated;" in text, "explicit grants")
ok(len(re.findall(r"security definer set search_path = public, pg_temp", text)) == 2, "both functions security definer, search_path public, pg_temp")

STAND = r"""
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on members, firms to authenticated, service_role;
"""
F1, F2 = "11111111-1111-1111-1111-111111111124", "22222222-2222-2222-2222-222222222124"
OWN, STAFF, OTHER, LONER = ("aaaaaaaa-aaaa-aaaa-aaaa-%012d" % i for i in range(1, 5))
TOK = lambda n: "fcm-token-%04d-" % n + "x" * 40
db = pg_stand.start(int(os.environ.get("PG124_PORT") or 31240))
def err(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
def one(s, uid=None):
    try: return db.one(s, uid)
    except RuntimeError as e: return "ERROR " + str(e)[:300]
def as_(role="authenticated"): return "set role %s; " % role
save = lambda uid, plat, tok, ver="'1.0.0'": one(as_() + "select device_token_save('%s', '%s', %s)::text" % (plat, tok, ver), uid)
try:
    db.sql(STAND + "insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'owner'), ('%s', '%s', 'staff'), ('%s', '%s', 'owner');"
           % (F1, F2, OWN, F1, STAFF, F1, OTHER, F2))
    print("== 1. runs twice")
    if not RED:
        e1 = err(text); e2 = err(text)
        ok(not e1 and not e2, "the file runs, and runs again" + (": " + (e1 or e2)[:400] if e1 or e2 else ""))
    print("== 2. device_token_save")
    r = save(OWN, "android", TOK(1))
    ok('"ok": true' in str(r), "the owner's phone saved (%s)" % r)
    ok(one("select user_id || '/' || firm_id || '/' || platform || '/' || app_version from device_tokens where token = '%s'" % TOK(1)) == "%s/%s/android/1.0.0" % (OWN, F1), "kept with the user, the firm, android, the app's version")
    first = one("select last_seen from device_tokens where token = '%s'" % TOK(1))
    r2 = save(OWN, "android", TOK(1), "null")
    ok(one("select count(*) from device_tokens") == "1" and str(r2).find(str(one("select id from device_tokens where token = '%s'" % TOK(1)))) >= 0, "saved again: the same row")
    ok(one("select (last_seen > '%s')::text || '/' || app_version from device_tokens where token = '%s'" % (first, TOK(1))) == "true/1.0.0", "seen again (last_seen moves), the version kept when none is sent")
    ok("Unknown phone platform" in str(save(OWN, "windows", TOK(2))), "a platform other than android or ios refused")
    ok("Not a push token" in str(save(OWN, "ios", "short")) and "Not a push token" in str(save(OWN, "ios", "has space " + "y" * 30)), "a short token or one with spaces refused")
    ok("Sign in to the firm account first" in str(one(as_() + "select device_token_save('ios', '%s')::text" % TOK(3))), "nobody signed in: refused")
    ok("not a member of a firm" in str(save(LONER, "ios", TOK(3))), "a person in no firm: refused")
    ok("permission denied" in str(one(as_("anon") + "select device_token_save('ios', '%s')::text" % TOK(3))), "anon cannot call it")
    print("== 3. reads")
    ok(one(as_() + "select count(*) || '/' || max(platform) from public.device_tokens", OWN) == "1/android", "the owner reads their own phone")
    ok("permission denied" in str(one(as_() + "select token from public.device_tokens", OWN)) and "permission denied" in str(one(as_() + "select user_id from public.device_tokens", OWN)), "never the token or the user column")
    ok(one(as_() + "select count(*) from public.device_tokens", STAFF) == "0", "another member of the same firm reads none")
    ok(one(as_() + "select count(*) from public.device_tokens", OTHER) == "0", "another firm reads none")
    ok("permission denied" in str(one(as_("anon") + "select count(*) from public.device_tokens")), "anon reads nothing")
    ok("permission denied" in err(as_() + "insert into public.device_tokens (user_id, firm_id, platform, token) values ('%s', '%s', 'ios', '%s')" % (STAFF, F1, TOK(9)), STAFF)
       and "permission denied" in err(as_() + "update public.device_tokens set disabled_at = now()", OWN) and "permission denied" in err(as_() + "delete from public.device_tokens", OWN), "no direct insert, update or delete by a member")
    print("== 4. a phone changing hands; forget")
    save(OTHER, "android", TOK(1))
    ok(one("select user_id || '/' || firm_id from device_tokens where token = '%s'" % TOK(1)) == "%s/%s" % (OTHER, F2) and one("select count(*) from device_tokens") == "1", "signed in by someone else: the token moves to them (one row)")
    ok('"forgotten": 0' in str(one(as_() + "select device_token_forget('%s')::text" % TOK(1), OWN)) and one("select coalesce(disabled_why, '-') from device_tokens where token = '%s'" % TOK(1)) == "-", "the earlier person cannot forget it")
    ok('"forgotten": 1' in str(one(as_() + "select device_token_forget('%s')::text" % TOK(1), OTHER)) and one("select disabled_why from device_tokens where token = '%s'" % TOK(1)) == "signed_out", "its person's sign-out forgets it ('signed_out')")
    save(OTHER, "android", TOK(1))
    ok(one("select coalesce(disabled_why, '-') from device_tokens where token = '%s'" % TOK(1)) == "-", "signed in again: in use again")
    print("== 5. at most 10 phones a person")
    for n in range(10, 21): save(STAFF, "ios" if n % 2 else "android", TOK(n))
    ok(one("select count(*) from device_tokens where user_id = '%s' and disabled_at is null" % STAFF) == "10", "10 in use")
    ok(one("select token from device_tokens where user_id = '%s' and disabled_why = 'too_many'" % STAFF) == TOK(10), "the one not heard from longest put aside ('too_many')")
    print("== 6. the service role")
    ok(one(as_("service_role") + "select count(token) from public.device_tokens where firm_id = '%s' and disabled_at is null" % F1) == "10", "reads the firm's tokens in use")
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
