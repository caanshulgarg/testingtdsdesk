"""python3 run_migration118.py - server/console/migration-118-console-foundation.sql (27-Oct-2026, branch next-console-p1,
the console's phase 1; NOT run on staging: the owner runs it). On a throwaway PostgreSQL (pg_stand, port 31118 unless
PG118_PORT; never a real database), with stand-ins for Supabase's auth tables and FinCom's firm tables and made-up firms:
  0. the file: one transaction, lock_timeout 10 s; add-only (no table or column dropped, no "delete from" but the
     sign-out-everywhere's own of auth.sessions, no truncate); names no real database; md5
  1. runs, and runs a second time (the same function texts afterwards)
  2. grants: console_admins and console_audit with row-level security on and no policy; the service role only (audit:
     select and insert, never update or delete); anon and authenticated nothing on any table or function
  3. console_audit is append-only: update, delete and truncate refused, for the service role and the table's owner
  4. admins: add an existing login by email (unknown email, a bad role, an admin twice refused); set a role; nobody
     changes their own role or removes themselves; the last active owner can be neither demoted nor removed, by the
     functions or by a direct update or delete; a removed admin is kept (active false) and can be added again; every
     change writes one audit row with before and after in the same transaction, a refused one writes none; a caller who
     is not an active owner is refused by the functions themselves
  5. the read functions: dashboard counts; firms list (search, paging, owner email, members, clients, plan, last
     activity); a firm (members with roles, clients count, never a client's name); users list (search, firm, role,
     two-step, active filters); a user (factors, firm, sessions count); audit list (filters; Billing and Support see
     their own and their role's rows only)
  6. console_signout_all ends that login's sessions only
RED_WITHOUT_118=1: the same checks without running the file (1 to 6 fail)."""
import os, re, sys, hashlib, json as _json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "console", "migration-118-console-foundation.sql")
RED = os.environ.get("RED_WITHOUT_118") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = re.findall(r"\bdrop\s+(\w+)", code)
ok(all(d in ("trigger", "policy") for d in drops) and not re.search(r"drop\s+(table|column|function|view)", code), "nothing dropped but triggers re-made on its own tables (%s)" % sorted(set(drops)))
ok(set(re.findall(r"delete from ([\w.]+)", code)) == {"auth.sessions"} and "truncate table" not in code and "truncate public" not in code, "the only delete: sign-out-everywhere's of auth.sessions")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")
ok("insert into public.console_admins" not in code.split("create or replace function public.console_admin_add")[0], "no seed row: the owner's admin row is a separate statement")

AUTH = r"""
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz,
  email_confirmed_at timestamptz default now(), banned_until timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, friendly_name text, factor_type text, status text, created_at timestamptz default now());
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
alter table firms add column if not exists plan_id uuid, add column if not exists balance numeric default 0, add column if not exists active boolean default true,
  add column if not exists created_at timestamptz default now(), add column if not exists low_balance_warn numeric default 500, add column if not exists period_start date;
alter table members add column if not exists email text;
create table if not exists plans (id uuid primary key, name text, monthly_fee numeric, includes jsonb, active boolean default true);
create table if not exists wallet_entries (id bigserial primary key, firm_id uuid, at timestamptz default now(), kind text, code text, qty numeric, amount numeric, balance_after numeric, note text, ref text, by_user uuid);
create table if not exists activity (id bigserial primary key, firm_id uuid, user_id uuid, client_id text, what text, detail text, at timestamptz default now());
create table if not exists clients (id text, firm_id uuid, name text, gstin text, deleted boolean default false);
create table if not exists platform_admins (user_id uuid primary key);
create table if not exists tally_devices (id uuid primary key default gen_random_uuid(), firm_id uuid, name text, last_seen timestamptz, version text, revoked boolean default false);
create table if not exists tally_post_jobs (id uuid primary key default gen_random_uuid(), firm_id uuid, client_id text, status text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists assistant_usage (firm_id uuid, day date, calls integer, cost_inr numeric, primary key (firm_id, day));
"""
U = lambda n: "00000000-0000-4000-8000-%012d" % n
OWNER, OWNER2, BILL, SUP, VIEW, NOBODY = U(1), U(2), U(3), U(4), U(5), U(6)
A1, A2, B1, C1 = U(11), U(12), U(13), U(14)          # firm logins
F1, F2 = U(101), U(102)
P1, P2 = U(201), U(202)
FIX = r"""
insert into auth.users (id, email, last_sign_in_at) values
 ('%(O)s', 'anshul@fincom.live', now()), ('%(O2)s', 'second@fincom.live', now()), ('%(B)s', 'bill@fincom.live', now() - interval '40 days'),
 ('%(S)s', 'sup@fincom.live', now()), ('%(V)s', 'view@fincom.live', null), ('%(N)s', 'nobody@fincom.live', null),
 ('%(A1)s', 'owner@abc.test', now() - interval '1 day'), ('%(A2)s', 'staff@abc.test', now() - interval '10 days'),
 ('%(B1)s', 'owner@gsc.test', now() - interval '20 days'), ('%(C1)s', 'off@gsc.test', null);
insert into auth.mfa_factors (user_id, factor_type, status, friendly_name) values ('%(A1)s', 'totp', 'verified', 'phone'), ('%(A2)s', 'totp', 'unverified', 'x');
insert into auth.sessions (user_id) values ('%(A1)s'), ('%(A1)s'), ('%(A2)s');
insert into plans values ('%(P1)s', 'Pay as you go', 0, '{}'), ('%(P2)s', 'Monthly, all included', 4000, '{}');
insert into firms (id, name, plan_id, balance, created_at) values ('%(F1)s', 'ABC Associates', '%(P1)s', 1000, now() - interval '30 days'), ('%(F2)s', 'Garg Shekhar & Co', '%(P2)s', 175, now() - interval '2 days');
insert into members (user_id, firm_id, name, email, role, active) values ('%(A1)s', '%(F1)s', 'Asha', 'owner@abc.test', 'owner', true),
 ('%(A2)s', '%(F1)s', 'Ravi', 'staff@abc.test', 'staff', true), ('%(B1)s', '%(F2)s', 'Bina', 'owner@gsc.test', 'owner', true), ('%(C1)s', '%(F2)s', 'Chand', 'off@gsc.test', 'readonly', false);
insert into clients (id, firm_id, name) values ('c1', '%(F1)s', 'SECRET CLIENT ONE'), ('c2', '%(F1)s', 'SECRET CLIENT TWO'), ('c3', '%(F1)s', 'GONE'), ('c4', '%(F2)s', 'SECRET THREE');
update clients set deleted = true where id = 'c3';
insert into activity (firm_id, user_id, client_id, what, detail, at) values ('%(F1)s', '%(A1)s', 'c1', 'post.voucher', 'SECRET CLIENT ONE detail', now() - interval '1 hour');
insert into tally_devices (firm_id, name, last_seen) values ('%(F1)s', 'PC1', now() - interval '1 minute'), ('%(F2)s', 'PC2', now() - interval '2 hours');
insert into tally_post_jobs (firm_id, status, updated_at) values ('%(F1)s', 'failed', now()), ('%(F1)s', 'failed', now() - interval '3 days'), ('%(F1)s', 'done', now());
insert into assistant_usage values ('%(F1)s', (now() at time zone 'Asia/Kolkata')::date, 7, 12.5), ('%(F2)s', (now() at time zone 'Asia/Kolkata')::date - 1, 9, 3);
insert into wallet_entries (firm_id, kind, code, qty, amount) values ('%(F1)s', 'charge', 'claude', 1, -3), ('%(F1)s', 'charge', 'vision', 2, -2), ('%(F1)s', 'charge', 'bill', 1, -2);
""" % {"O": OWNER, "O2": OWNER2, "B": BILL, "S": SUP, "V": VIEW, "N": NOBODY, "A1": A1, "A2": A2, "B1": B1, "C1": C1, "F1": F1, "F2": F2, "P1": P1, "P2": P2}

db = pg_stand.start(int(os.environ.get("PG118_PORT") or 31118))
SR = "set role service_role; "
def try_sql(s):
    try: db.sql(s); return None
    except Exception as e: return str(e)
def one(q):
    try: return db.one(q)
    except Exception as e: return "ERR " + str(e)[:300]
try:
    db.sql(AUTH); db.sql(FIX)
    print("== 1. runs, twice")
    e1 = None if RED else try_sql(text)
    ok(e1 is None and one("select to_regclass('public.console_admins')::text") == "console_admins", "runs (%s)" % (e1 or "")[:200])
    src1 = one("select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'console\\_%'")
    e2 = None if RED else try_sql(text)
    ok(e2 is None and one("select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'console\\_%'") == src1 and src1, "runs a second time: the same function texts (%s)" % (e2 or "")[:200])
    FNS = [r["sig"] for r in db.rows("select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'console\\_%'")]
    ok(len(FNS) >= 12, "console functions: %d" % len(FNS))

    print("== 2. grants")
    for t in ("console_admins", "console_audit"):
        ok(one("select relrowsecurity::text from pg_class where relname = '%s'" % t) == "true", "%s: row-level security on" % t)
        ok(one("select count(*) from pg_policies where tablename = '%s'" % t) == "0", "%s: no policy (closed to signed-in people)" % t)
        tp = lambda role: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '-') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
        ok(tp("anon") == "-" and tp("authenticated") == "-", "%s: anon and authenticated nothing (%s / %s)" % (t, tp("anon"), tp("authenticated")))
        ok(tp("service_role") == ("DELETE,INSERT,SELECT,UPDATE" if t == "console_admins" else "INSERT,SELECT"), "%s: service role %s" % (t, tp("service_role")))
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    ok(FNS and all(fx("service_role", f) == "true" for f in FNS), "the service role calls every console function")
    ok(FNS and all(fx(r, f) == "false" for r in ("anon", "authenticated", "public") for f in FNS), "anon, authenticated and public call none")
    ok(FNS and one("select bool_and(prosecdef)::text from pg_proc where proname like 'console\\_%' and proname not like 'console\\_audit\\_guard%' and proname not like 'console\\_admins\\_guard%'") == "true", "the functions are security definer")
    ok(one("select bool_and(coalesce(array_to_string(proconfig, ',') like '%search_path=%', false))::text from pg_proc where proname like 'console\\_%'") == "true", "every function pins its search_path")

    print("== 4. admins")
    ok(try_sql("insert into public.console_admins (user_id, role) values ('%s', 'owner')" % OWNER) is None, "the owner's row (the separate statement)")
    AUD = lambda: int(one("select count(*) from public.console_audit") or 0) if not RED else -1
    n0 = AUD()
    call = lambda s: try_sql(SR + "select " + s)
    ok(call("public.console_admin_add('%s', 'nobody@nowhere.test', 'viewer', 'r', '1.2.3.4', 'ua')" % OWNER) is not None and AUD() == n0, "an email with no FinCom login: refused, no audit row")
    ok(call("public.console_admin_add('%s', 'bill@fincom.live', 'king', 'r', null, null)" % OWNER) is not None, "a role not in the list: refused")
    e = call("public.console_admin_add('%s', 'BILL@fincom.live', 'billing', 'helps with billing', '1.2.3.4', 'ua')" % OWNER)
    ok(e is None and one("select role || active::text from public.console_admins where user_id = '%s'" % BILL) == "billingtrue", "add an existing login by email (any case) as Billing %s" % (e or ""))
    ok(AUD() == n0 + 1 and one("select action || '|' || target_id || '|' || (after->>'role') || '|' || coalesce(before::text, 'null') || '|' || reason || '|' || ip from public.console_audit order by id desc limit 1") == "admins.add|%s|billing|null|helps with billing|1.2.3.4" % BILL, "one audit row: admins.add, after role, reason, ip")
    ok(call("public.console_admin_add('%s', 'bill@fincom.live', 'viewer', 'r', null, null)" % OWNER) is not None, "an admin added twice: refused")
    for em, r in (("sup@fincom.live", "support"), ("view@fincom.live", "viewer"), ("second@fincom.live", "owner")): call("public.console_admin_add('%s', '%s', '%s', 'r', null, null)" % (OWNER, em, r))
    ok(one("select count(*) from public.console_admins where active") == "5", "five admins")
    ok(call("public.console_admin_add('%s', 'nobody@fincom.live', 'viewer', 'r', null, null)" % SUP) is not None, "Support cannot add an admin (the function's own check)")
    ok(call("public.console_admin_set_role('%s', '%s', 'viewer', 'r', null, null)" % (BILL, SUP)) is not None, "Billing cannot change a role")
    n1 = AUD()
    ok(call("public.console_admin_set_role('%s', '%s', 'billing', 'demote me', null, null)" % (OWNER, OWNER)) is not None and AUD() == n1, "nobody changes their own role (no audit row)")
    ok(call("public.console_admin_remove('%s', '%s', 'leave', null, null)" % (OWNER, OWNER)) is not None, "nobody removes themselves")
    e = call("public.console_admin_set_role('%s', '%s', 'support', 'more help', null, null)" % (OWNER, VIEW))
    ok(e is None and one("select role from public.console_admins where user_id = '%s'" % VIEW) == "support", "set a role %s" % (e or ""))
    ok(one("select (before->>'role') || '>' || (after->>'role') from public.console_audit where action = 'admins.set_role' order by id desc limit 1") == "viewer>support", "its audit row: before viewer, after support")
    ok(call("public.console_admin_set_role('%s', '%s', 'billing', 'second owner down', null, null)" % (OWNER, OWNER2)) is None, "an owner demotes the other owner while two exist")
    n2 = AUD()
    ok(call("public.console_admin_set_role('%s', '%s', 'billing', 'x', null, null)" % (OWNER2, OWNER)) is not None, "a non-owner cannot demote the owner")
    ok(try_sql("update public.console_admins set role = 'viewer' where user_id = '%s'" % OWNER) is not None, "the last owner: a direct update to another role refused")
    ok(try_sql("update public.console_admins set active = false where user_id = '%s'" % OWNER) is not None, "the last owner: a direct switch-off refused")
    ok(try_sql("delete from public.console_admins where user_id = '%s'" % OWNER) is not None, "the last owner: a direct delete refused")
    ok(one("select role || active::text from public.console_admins where user_id = '%s'" % OWNER) == "ownertrue" and AUD() == n2, "the owner is still the active owner; no audit row for refusals")
    e = call("public.console_admin_remove('%s', '%s', 'left the team', null, null)" % (OWNER, BILL))
    ok(e is None and one("select active::text from public.console_admins where user_id = '%s'" % BILL) == "false", "remove: kept, switched off %s" % (e or ""))
    ok(one("select (before->>'active') || '>' || (after->>'active') from public.console_audit where action = 'admins.remove' order by id desc limit 1") == "true>false", "its audit row")
    e = call("public.console_admin_add('%s', 'bill@fincom.live', 'viewer', 'back again', null, null)" % OWNER)
    ok(e is None and one("select role || active::text from public.console_admins where user_id = '%s'" % BILL) == "viewertrue", "a removed admin can be added again %s" % (e or ""))
    lst = one(SR + "select public.console_admins_list()::text") or ""
    ok("anshul@fincom.live" in lst and '"role": "owner"' in lst and "bill@fincom.live" in lst, "admins list: emails and roles")

    print("== 3. append-only audit")
    nA = AUD()
    ok(try_sql(SR + "update public.console_audit set reason = 'x'") is not None, "service role: update refused")
    ok(try_sql(SR + "delete from public.console_audit") is not None, "service role: delete refused")
    ok(try_sql("update public.console_audit set reason = 'x'") is not None and try_sql("delete from public.console_audit") is not None, "the table's owner: update and delete refused (the trigger)")
    ok(try_sql("truncate public.console_audit") is not None, "truncate refused")
    ok(AUD() == nA and nA > 0, "rows unchanged (%d)" % nA)
    e = call("public.console_audit_add('%s', 'support', 'firm.get', 'firm', '%s', null, null, null, '9.9.9.9', 'Mozilla')" % (SUP, F1))
    ok(e is None and AUD() == nA + 1, "console_audit_add writes a view row %s" % (e or ""))
    ok(call("public.console_audit_add('%s', 'support', 'Bad Action!', null, null, null, null, null, null, null)" % SUP) is not None, "an action name out of shape: refused")

    print("== 5. read functions")
    d = one(SR + "select public.console_dashboard()::text") or ""
    import json
    try: D = json.loads(d)
    except Exception: D = {}
    ok(D.get("firms") == 2, "dashboard: firms 2 (%s)" % d[:300])
    ok(D.get("active_7d") == 1 and D.get("active_30d") == 3, "dashboard: firm people signed in within 7 days 1, 30 days 3")
    ok(sorted((x.get("plan"), x.get("n")) for x in D.get("by_plan", [])) == [("Monthly, all included", 1), ("Pay as you go", 1)], "dashboard: firms by plan")
    ok([x.get("name") for x in D.get("recent", [])][:2] == ["Garg Shekhar & Co", "ABC Associates"], "dashboard: recent sign-ups, newest first")
    ok(D.get("bridges_online") == 1 and D.get("bridges") == 2, "dashboard: bridges online 1 of 2")
    ok(D.get("failed_jobs_today") == 1, "dashboard: failed jobs today 1")
    ok(D.get("ai_calls_today") == 7 + 2, "dashboard: AI calls today 9 (assistant 7 + Claude and Vision charges 2)")
    ok("SECRET" not in d, "dashboard: no client names")
    fl = json.loads(one(SR + "select public.console_firms(null, 50, 0)::text") or "{}") if not RED else {}
    R = {r["name"]: r for r in fl.get("rows", [])}
    ok(fl.get("total") == 2 and R.get("ABC Associates", {}).get("owner_email") == "owner@abc.test", "firms: 2, owner email")
    a = R.get("ABC Associates", {})
    ok(a.get("members") == 2 and a.get("clients") == 2 and a.get("plan") == "Pay as you go" and float(a.get("balance", 0)) == 1000 and a.get("last_activity"), "firms: members 2, clients 2 (deleted left out), plan, balance, last activity")
    ok(R.get("Garg Shekhar & Co", {}).get("members") == 1, "firms: an inactive member is not counted")
    fs = json.loads(one(SR + "select public.console_firms('garg', 50, 0)::text") or "{}") if not RED else {}
    ok(fs.get("total") == 1 and fs["rows"][0]["name"] == "Garg Shekhar & Co", "firms: search by name")
    fs = json.loads(one(SR + "select public.console_firms('owner@abc', 50, 0)::text") or "{}") if not RED else {}
    ok(fs.get("total") == 1, "firms: search by owner email")
    fp = json.loads(one(SR + "select public.console_firms(null, 1, 1)::text") or "{}") if not RED else {}
    ok(fp.get("total") == 2 and len(fp.get("rows", [])) == 1, "firms: paging (limit 1, offset 1)")
    fs = json.loads(one(SR + "select public.console_firms('%%_x', 50, 0)::text") or "{}") if not RED else {}
    ok(fs.get("total") == 0, "firms: % and _ in a search are plain characters")
    g = one(SR + "select public.console_firm('%s')::text" % F1) or ""
    try: G = json.loads(g)
    except Exception: G = {}
    ok(G.get("name") == "ABC Associates" and G.get("clients") == 2 and len(G.get("members", [])) == 2, "firm: name, clients count, members")
    ok({m.get("email"): (m.get("role"), m.get("mfa")) for m in G.get("members", [])} == {"owner@abc.test": ("owner", True), "staff@abc.test": ("staff", False)}, "firm: members with roles and two-step")
    ok("SECRET" not in g and "detail" not in g, "firm: no client name, no activity detail")
    ok(G.get("recent") and G["recent"][0].get("what") == "post.voucher", "firm: recent activity (what and when)")
    ok(one(SR + "select coalesce(public.console_firm('%s')::text, 'null')" % U(999)) == "null", "firm: unknown id -> null")
    ul = json.loads(one(SR + "select public.console_users(null, null, null, null, null, 50, 0)::text") or "{}") if not RED else {}
    ok(ul.get("total") == 4, "users: the 4 firm logins")
    E = {r["email"]: r for r in ul.get("rows", [])}
    ok(E.get("owner@abc.test", {}).get("firm") == "ABC Associates" and E["owner@abc.test"].get("mfa") is True and E.get("staff@abc.test", {}).get("mfa") is False and E["owner@abc.test"].get("last_sign_in_at"), "users: firm, two-step (verified only), last sign-in")
    q = lambda *a: (json.loads(one(SR + "select public.console_users(%s, 50, 0)::text" % ", ".join(a)) or "{}") if not RED else {}).get("total")
    ok(q("'ravi'", "null", "null", "null", "null") == 1, "users: search by name")
    ok(q("null", "'%s'" % F2, "null", "null", "null") == 2, "users: one firm")
    ok(q("null", "null", "'owner'", "null", "null") == 2, "users: role owner")
    ok(q("null", "null", "null", "true", "null") == 1 and q("null", "null", "null", "false", "null") == 3, "users: two-step on 1, off 3")
    ok(q("null", "null", "null", "null", "false") == 1, "users: switched off 1")
    us = one(SR + "select public.console_user('%s')::text" % A1) or ""
    try: US = json.loads(us)
    except Exception: US = {}
    ok(US.get("email") == "owner@abc.test" and US.get("firm") == "ABC Associates" and US.get("sessions") == 2 and len(US.get("factors", [])) == 1 and US["factors"][0].get("type") == "totp", "user: email, firm, sessions, factors")
    ok("SECRET" not in us, "user: no client names")
    al = lambda who, role, extra="null, null, null, null, null": json.loads(one(SR + "select public.console_audit_list(%s, %s, %s, 200, 0)::text" % (who, role, extra)) or "{}") if not RED else {}
    allrows = al("null", "null")
    ok(allrows.get("total", 0) >= 8, "audit list: owner sees all (%s)" % allrows.get("total"))
    ok(al("null", "null", "'admins.set_role', null, null, null, null").get("total") == 2, "audit list: by action")
    ok(al("null", "null", "null, '%s', null, null, null" % SUP).get("total") == 1, "audit list: by who")
    ok(al("null", "null", "null, null, '%s', null, null" % F1).get("total") == 1, "audit list: by target")
    sup = al("'%s'" % SUP, "'support'")
    ok(sup.get("total") == 1 and all(r.get("who") == SUP or r.get("role") == "support" for r in sup.get("rows", [])), "audit list: Support sees its own and Support's rows only")
    ok(al("null", "null", "null, null, null, now() + interval '1 day', null").get("total") == 0, "audit list: from a date")
    ok("who_email" in json.dumps(allrows.get("rows", [{}])[0]), "audit list: who's email")

    print("== 6. sign out everywhere")
    n = one(SR + "select public.console_signout_all('%s')" % A1)
    ok(n == "2" and one("select count(*) from auth.sessions where user_id = '%s'" % A1) == "0" and one("select count(*) from auth.sessions where user_id = '%s'" % A2) == "1", "ends the 2 sessions of that login only (%s)" % n)

    print("== 7. switching off and on")
    AU = "set role authenticated; set fincom.uid = '%s'; "
    asu = lambda uid, q: one(AU % uid + q)
    ok(one("select count(*) from pg_proc where proname = 'can_write' and prosrc like '%firm_is_writable%'") == "1", "can_write() wrapped with firm_is_writable(), once (after two runs)")
    ok(fx("authenticated", "public.firm_is_writable()") == "true" and fx("anon", "public.firm_is_writable()") == "false" and fx("authenticated", "public.my_firm_status()") == "true", "firm_is_writable / my_firm_status: signed-in people, not anon")
    db.sql("grant select on public.members, public.firms to authenticated")
    v = asu(A1, "select public.can_write()::text")
    ok(v == "true", "before: ABC's owner can write (%s)" % v)
    ok(call("public.console_firm_set_status('%s', '%s', 'suspended', 'unpaid since Sept', null, null)" % (SUP, F1)) is not None, "Support cannot suspend a firm")
    e = call("public.console_firm_set_status('%s', '%s', 'suspended', 'unpaid since Sept', '1.1.1.1', 'ua')" % (OWNER, F1))
    ok(e is None and one("select status || '|' || status_reason || '|' || (status_by = '%s')::text from public.firms where id = '%s'" % (OWNER, F1)) == "suspended|unpaid since Sept|true", "the owner suspends ABC: status, reason, by %s" % (e or ""))
    ok(one("select action || '|' || (before->>'status') || '>' || (after->>'status') from public.console_audit order by id desc limit 1") == "firm.deactivate|active>suspended", "audit: firm.deactivate active > suspended")
    ok(asu(A1, "select public.can_write()::text") == "false" and asu(A2, "select public.can_write()::text") == "false", "suspended: can_write() false for its owner and staff")
    ok(asu(B1, "select public.can_write()::text") == "true", "another firm unaffected")
    ok(asu(A1, "select public.my_firm()::text") == F1, "suspended = read-only: my_firm() still answers (reads go on)")
    ok(json.loads(asu(A1, "select public.my_firm_status()::text") or "{}").get("reason") == "unpaid since Sept", "my_firm_status: the status and reason for the paused page")
    ok(try_sql("insert into public.tally_post_jobs (firm_id, status) values ('%s', 'waiting')" % F1) is not None, "suspended: no posting to Tally queued")
    db.sql("alter table public.tally_post_jobs disable trigger console_post_guard; insert into public.tally_post_jobs (id, firm_id, status) values ('%s', '%s', 'waiting'); alter table public.tally_post_jobs enable trigger console_post_guard" % (U(301), F1))
    db.sql("update public.tally_post_jobs set status = 'taken' where id = '%s'" % U(301))
    ok(one("select status from public.tally_post_jobs where id = '%s'" % U(301)) == "waiting", "suspended: the bridge takes no waiting posting (it waits)")
    ok(call("public.console_firm_set_status('%s', '%s', 'suspended', 'again', null, null)" % (OWNER, F1)) is not None, "the same status twice: refused")
    e = call("public.console_firm_set_status('%s', '%s', 'active', 'paid up', null, null)" % (OWNER, F1))
    ok(e is None and asu(A1, "select public.can_write()::text") == "true", "reactivated: writes again %s" % (e or ""))
    db.sql("update public.tally_post_jobs set status = 'taken' where id = '%s'" % U(301))
    ok(one("select status from public.tally_post_jobs where id = '%s'" % U(301)) == "taken", "reactivated: the waiting posting is taken")
    ok(one("select action from public.console_audit order by id desc limit 1") == "firm.reactivate", "audit: firm.reactivate")
    fl = json.loads(one(SR + "select public.console_firm('%s')::text" % F1) or "{}")
    ok(fl.get("status") == "active" and fl.get("status_by") == "anshul@fincom.live", "firm: status and who set it")

    # people
    db.sql("insert into auth.sessions (user_id) values ('%s'), ('%s')" % (A2, A2))
    ok(call("public.console_user_set_active('%s', '%s', false, 'left the firm', null, null)" % (VIEW, A2)) is None, "(VIEW is Support now) Support switches a person off")
    ok(one("select active::text || (console_off_at is not null)::text from public.members where user_id = '%s'" % A2) == "falsetrue" and one("select count(*) from auth.sessions where user_id = '%s'" % A2) == "0", "off: member row off (marked), signed out everywhere")
    ok(one("select action || '|' || (after->>'sessions_ended') from public.console_audit order by id desc limit 1") == "user.deactivate|3", "audit: user.deactivate, 3 sessions ended")
    ok(json.loads(one(SR + "select public.console_user('%s')::text" % A2) or "{}").get("switched_off") is True, "user: switched_off")
    ok(call("public.console_user_set_active('%s', '%s', false, 'x', null, null)" % (BILL, A1)) is not None, "Billing cannot switch a person off")
    ok(call("public.console_user_set_active('%s', '%s', false, 'x', null, null)" % (VIEW, OWNER)) is not None, "Support cannot switch off a console admin's login")
    ok(call("public.console_user_set_active('%s', '%s', false, 'x', null, null)" % (OWNER, OWNER)) is not None, "nobody switches themselves off")
    db.sql("update public.members set active = false where user_id = '%s'" % C1)
    e = call("public.console_user_set_active('%s', '%s', true, 'back', null, null)" % (VIEW, A2))
    ok(e is None and one("select active::text || (console_off_at is null)::text from public.members where user_id = '%s'" % A2) == "truetrue", "on again: the row the console switched off is restored %s" % (e or ""))
    call("public.console_user_set_active('%s', '%s', true, 'back', null, null)" % (VIEW, C1))
    ok(one("select active::text from public.members where user_id = '%s'" % C1) == "false", "a row the firm itself switched off stays off")

    # companies
    ok(call("public.console_company_set_status('%s', '%s', 'c1', 'deactivated', 'x', null, null)" % (BILL, F1)) is not None, "Billing cannot switch a company off")
    e = call("public.console_company_set_status('%s', '%s', 'c1', 'deactivated', 'client left', null, null)" % (VIEW, F1))
    ok(e is None and one("select status from public.clients where id = 'c1'") == "deactivated", "Support switches a company off %s" % (e or ""))
    ok(one("select action || '|' || target_id from public.console_audit order by id desc limit 1") == "company.deactivate|%s/c1" % F1, "audit: company.deactivate firm/client")
    ok(try_sql("insert into public.tally_post_jobs (firm_id, client_id, status) values ('%s', 'c1', 'waiting')" % F1) is not None, "no posting for a switched-off company")
    ok(try_sql("insert into public.tally_post_jobs (firm_id, client_id, status) values ('%s', 'c2', 'waiting')" % F1) is None, "another company of the firm posts")
    cl = json.loads(one(SR + "select public.console_companies(null, '%s', 50, 0)::text" % F1) or "{}")
    ok(cl.get("total") == 3 and {r["id"]: r["status"] for r in cl["rows"]}.get("c1") == "deactivated", "companies: a firm's, with status")
    cg = one(SR + "select public.console_company('%s', 'c1')::text" % F1) or ""
    ok('"status": "deactivated"' in cg and '"data"' not in cg, "company: status, never the books")
    ok(call("public.console_company_set_status('%s', '%s', 'c1', 'active', 'back', null, null)" % (VIEW, F1)) is None and one("select status from public.clients where id = 'c1'") == "active", "on again")
except Exception as e:
    ok(False, "the checks stopped: %s" % str(e)[:300])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
