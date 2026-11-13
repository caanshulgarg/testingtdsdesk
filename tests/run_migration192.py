"""python3 run_migration192.py - migration-192-gst-portal-read-guard (13-Nov-2026, branch next-sec-client): a client's saved
GST portal password is given only right after the person's own two-step code, and only a few a minute. On throwaway
PostgreSQL (pg_stand, port 31192; never a real database), with Supabase's default grants, Vault stood in (gst_helper_stand),
auth.jwt() and auth.mfa_factors stood in, migration 93, then 192 twice. Checks:
  0. the file: one transaction, lock_timeout 10 s, add-only (no drop, no truncate, no 'delete from', no table altered), no
     real database named; it needs 93 and says so; it runs twice.
  1. grants: the read as 93 gave it (signed-in users, never anon); the new function executable by no signed-in user.
  2. no fresh two-step, no password: a sign-in with no code (aal1), a code given 11 minutes ago, a token whose only stamp
     is the password's, a stamp from the future, an amr that is not a list; the answer says need 'two_step' (the page asks
     for the code) and carries no password; a person who never turned two-step on is told to turn it on. Nothing is logged
     as a read.
  3. a code given in the last 10 minutes: the owner, and a staff member the owner allowed, get the password; each read logged.
  4. 93's rules are kept: a staff member not allowed, a viewer and another firm get nothing, with a fresh code too; the
     refusal logged.
  5. the limit: 5 reads in a minute, the 6th refused and logged ('read: too many'), at most 3 such lines a minute however
     many more are tried; a minute later it reads again; 40 in an hour, then refused; another person's reads are not counted.
Prints the file's md5. RED_WITHOUT_192=1: the same checks on 93 alone (2 and 5 fail, and 0-1 for the file)."""
import os, re, sys, json, time, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
from gst_helper_stand import VAULT
M93 = os.path.join(HERE, "..", "server", "gst-browser", "migration-93-gst-portal-login.sql")
M192 = os.environ.get("M192_FILE") or os.path.join(HERE, "..", "server", "gst-browser", "migration-192-gst-portal-read-guard.sql")
RED = os.environ.get("RED_WITHOUT_192") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, STAFF2, VIEW, OTHER, NOMFA = ("55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "47474747-4747-4747-4747-474747474747",
                                            "33333333-3333-3333-3333-333333333333", "66666666-6666-6666-6666-666666666666", "22222222-2222-2222-2222-222222222222")
G = "07AABCF1234K1Z5"
PW = "Fx#S3cret-pass-0101"

text = open(M192).read() if os.path.exists(M192) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M192))
if not text:
    print("\n1 FAILED"); raise SystemExit(1)
print("  md5 %s  %s" % (hashlib.md5(text.encode()).hexdigest(), os.path.basename(M192)))
code = "\n".join(l.split("--")[0] for l in text.splitlines()).lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(not re.search(r"\bdrop\b|\btruncate\b|delete from|alter table", code), "0. add-only (no drop, no truncate, no 'delete from', no table altered)")
ok(not re.search(r"supabase\.co|project[_ ]ref", code), "0. names no real database")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)", code))) == ["gst_portal_login_read", "gst_portal_two_step_at"] and len(re.findall(r"create index if not exists", code)) == 1,
   "0. it makes one new function and one index, and replaces gst_portal_login_read only")

db = pg_stand.start(31192)
def jwt(aal="aal2", totp=60, password=3600, amr=None):
    """a token's claims: the second step given `totp` seconds ago (None: never), the password `password` seconds ago"""
    now = int(time.time())
    a = amr if amr is not None else ([{"method": "totp", "timestamp": now - totp}] if totp is not None else []) + [{"method": "password", "timestamp": now - password}]
    return json.dumps({"aal": aal, "amr": a})
FRESH = jwt()
def psql(sql, uid=None, role=None, claims=None):
    pre = ("set fincom.uid = '%s';\n" % uid if uid else "") + ("set fincom.jwt = %s;\n" % q(claims) if claims else "") + ("set role %s;\n" % role if role else "")
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
                       input=pre + sql, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())
def call(uid, fn, *args, claims=FRESH):
    good, out = psql("select public.%s(%s)::text;" % (fn, ", ".join(args)), uid, "authenticated", claims)
    return json.loads(out.splitlines()[-1]) if good else {"sqlerror": out}
def read(uid, client="c1", claims=FRESH): return call(uid, "gst_portal_login_read", q(client), q(G), claims=claims)
def run_file(t):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=t, capture_output=True, text=True)
def events(where="true"): return [(e["u"], e["a"], e["n"]) for e in db.rows("select user_id::text as u, action as a, note as n from gst_portal_login_events where %s order by id" % where)]
def forget(): db.sql("update gst_portal_login_events set at = at - interval '2 hours';")   # the stand's clock moved on: nothing counts any more
try:
    db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;")
    db.sql(VAULT)
    # Supabase Auth stood in: the token's claims (auth.jwt()) and the people's verified second steps (auth.mfa_factors)
    db.sql("""create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('fincom.jwt', true), ''), '{}')::jsonb $$;
      create table if not exists auth.mfa_factors (id uuid default gen_random_uuid(), user_id uuid, status text);""")
    db.sql("create or replace function public.my_firm() returns uuid language sql stable security definer set search_path to 'public' as $$ select firm_id from public.members where user_id = auth.uid() and active $$;")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(S2)s, %(F)s, 'Staff two', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true),
        (%(X)s, %(F2)s, 'Other', 'owner', true), (%(N)s, %(F)s, 'Staff without two-step', 'staff', true);
      insert into auth.mfa_factors (user_id, status) values (%(O)s, 'verified'), (%(S)s, 'verified'), (%(S2)s, 'verified'), (%(V)s, 'verified'), (%(X)s, 'verified'), (%(N)s, 'unverified');
      grant usage on schema public, auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated;
      grant select on members, firms to authenticated;""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "S2": q(STAFF2), "V": q(VIEW), "X": q(OTHER), "N": q(NOMFA)})
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;")
    if not RED:
        r = run_file(text)
        ok(r.returncode != 0 and "run 93 first" in (r.stderr or ""), "0. without migration 93 it stops and says so; nothing made")
    r = run_file(open(M93).read())
    if r.returncode: raise SystemExit("migration 93 did not run: " + r.stderr[-400:])
    s = call(OWNER, "gst_portal_login_save", q("c1"), q(G), q("fx_user"), q(PW), "array[%s, %s]::uuid[]" % (q(STAFF), q(NOMFA)))
    ok(s.get("ok") is True, "the stand: the owner saved a login and allowed two staff members (%s)" % s)
    for rnd in (1, 2):
        if RED: break
        r = run_file(text)
        ok(r.returncode == 0, "0. pass %d: migration 192 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    ok(db.one("select count(*) from gst_portal_logins") == "1" and db.one("select count(*) from vault.secrets") == "1", "0. the login and its secret are as they were")
    # 1. grants
    can = lambda role, fn: db.one("select has_function_privilege(%s, to_regprocedure(%s), 'execute')::text" % (q(role), q(fn)))
    ok(can("authenticated", "public.gst_portal_login_read(text, text)") == "true" and can("anon", "public.gst_portal_login_read(text, text)") == "false", "1. the read: signed-in users, never anon")
    ok(can("authenticated", "public.gst_portal_two_step_at()") == "false" and can("anon", "public.gst_portal_two_step_at()") == "false", "1. gst_portal_two_step_at is executable by no signed-in user and not by anon")
    ok(db.one("select prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = 'public.gst_portal_login_read(text, text)'::regprocedure") in ('true|search_path=""', "true|search_path="),
       "1. the read is still security definer with an empty search_path")
    # 2. no fresh two-step, no password
    now = int(time.time())
    stale = {"no code in this sign-in (aal1)": jwt(aal="aal1", totp=None), "aal1 although a stamp is there": jwt(aal="aal1", totp=30),
             "a code given 11 minutes ago": jwt(totp=660), "only the password's stamp": jwt(totp=None, password=5),
             "a stamp from the future": jwt(totp=-3600), "an amr that is not a list": json.dumps({"aal": "aal2", "amr": "totp"}),
             "amr entries that are words": json.dumps({"aal": "aal2", "amr": ["totp", "password"]}),
             "a stamp that is text": json.dumps({"aal": "aal2", "amr": [{"method": "totp", "timestamp": str(now)}]}), "no claims at all": "{}"}
    for what, claims in stale.items():
        r = read(OWNER, claims=claims)
        ok(r.get("ok") is False and r.get("need") == "two_step" and "password" not in r and PW not in json.dumps(r), "2. %s: no password, the answer asks for the two-step code (%s)" % (what, {k: v for k, v in r.items() if k != "password"}))
    r = read(NOMFA, claims=jwt(aal="aal1", totp=None))
    ok(r.get("ok") is False and "need" not in r and "Turn on two-step" in r.get("error", "") and "password" not in r, "2. a staff member who never turned two-step on is told to turn it on (%s)" % r.get("error"))
    ok(not [e for e in events() if e[1] == "read"], "2. none of these is logged as a read (%s)" % [e[1:] for e in events()])
    # 3. a fresh code
    r = read(OWNER)
    ok(r.get("ok") is True and r.get("password") == PW and r.get("username") == "fx_user", "3. the owner, a code given a minute ago: the password (for the one fill)")
    r = read(STAFF, claims=jwt(totp=590))
    ok(r.get("ok") is True and r.get("password") == PW, "3. the allowed staff member, a code given 9 min 50 s ago: the password")
    ok([e[:2] for e in events("action = 'read'")] == [(OWNER, "read"), (STAFF, "read")], "3. each read logged: who, what")
    # 4. 93's rules kept
    r2, r3, r4 = read(STAFF2), read(VIEW), read(OTHER)
    ok(r2.get("ok") is False and "not allowed" in r2.get("error", "") and r3.get("ok") is False and r4.get("ok") is False and "No GST portal login" in r4.get("error", "") and not any("password" in x for x in (r2, r3, r4)),
       "4. a staff member not allowed, a viewer and another firm's owner get nothing, with a fresh code too")
    ok([e for e in events("action = 'refused'")] == [(STAFF2, "refused", "read: not allowed"), (VIEW, "refused", "read: not allowed")], "4. the refusals logged as 93 logs them")
    # 5. the limit
    forget()
    got = [read(OWNER).get("ok") for _ in range(5)]
    six = read(OWNER)
    ok(got == [True] * 5 and six.get("ok") is False and "password" not in six and "Too many" in six.get("error", ""), "5. 5 reads in a minute, the 6th refused with no password (%s)" % six.get("error"))
    more = [read(OWNER).get("ok") for _ in range(6)]
    many = [e for e in events("at > now() - interval '1 minute'") if e[2] == "read: too many"]
    ok(more == [False] * 6 and len(many) == 3 and all(e[0] == OWNER for e in many), "5. 6 more tries all refused; the log holds 3 'read: too many' lines for that minute, not 7 (%d)" % len(many))
    r = read(STAFF)
    ok(r.get("ok") is True, "5. another person's reads are not counted: the allowed staff member still reads")
    db.sql("update gst_portal_login_events set at = at - interval '61 seconds';")
    r = read(OWNER)
    ok(r.get("ok") is True and r.get("password") == PW, "5. a minute later the owner reads again")
    forget()
    db.sql("insert into gst_portal_login_events (firm_id, client_id, gstin, user_id, action, at) select %s, 'c1', %s, %s, 'read', now() - interval '2 minutes' - (i || ' seconds')::interval from generate_series(1, 40) i;" % (q(F), q(G), q(OWNER)))
    r = read(OWNER)
    ok(r.get("ok") is False and "Too many" in r.get("error", ""), "5. 40 reads in the hour: the next refused")
    db.sql("update gst_portal_login_events set at = at - interval '1 hour';")
    ok(read(OWNER).get("ok") is True, "5. ... and read again once the hour has passed")
    # sent together: one person's calls are taken one at a time, so the count holds
    forget()
    procs = [subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-q", "-t", "-A"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(12)]
    for p in procs: p.stdin.write("set fincom.uid = '%s';\nset fincom.jwt = %s;\nset role authenticated;\nselect public.gst_portal_login_read('c1', %s)::text;\n" % (OWNER, q(FRESH), q(G))); p.stdin.close()
    outs = [json.loads((p.stdout.read().strip().splitlines() or ["{}"])[-1]) for p in procs]
    for p in procs: p.wait()
    ok(sum(1 for o in outs if o.get("ok") is True) == 5 and sum(1 for o in outs if PW in json.dumps(o)) == 5, "5. 12 reads sent together: 5 answered with the password, 7 refused (%d)" % sum(1 for o in outs if o.get("ok") is True))
    everything = db.one("select string_agg(t::text, ';') from gst_portal_login_events t") or ""
    ok(PW not in everything, "the password is in no log line")
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
