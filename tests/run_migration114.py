"""python3 run_migration114.py - migration-114-revoke-api-grants (OWASP review 26-Oct-2026, branch next-sec-owasp; NOT run on
staging) on a throwaway PostgreSQL (pg_stand, port 31140 unless PG114_PORT; never a real database), with Supabase's
default privileges (every new table in public granted to anon, authenticated and service_role), as staging had them.
  0. the file: one transaction, lock_timeout 10 s; revokes and grants only (nothing created, altered, dropped or deleted)
  1. it runs, and runs a second time
  2. grants after it: anon and authenticated hold nothing on tally_period_pulls / tally_period_days /
     tally_ledger_progress / platform_secrets; anon nothing on platform_admins, authenticated keeps SELECT there;
     service_role keeps select, insert, update, delete on all five; authenticated holds SELECT only on platform_admins
  3. nothing else changed: a table it does not name keeps its default grants; RLS and the policy on platform_admins stay
  4. it runs on a database that lacks the tables (a fresh copy before 98)
RED_WITHOUT_114=1: the same checks without running the file (0 holds, 2 fails)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "security", "migration-114-revoke-api-grants.sql")
RED = os.environ.get("RED_WITHOUT_114") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\b(drop|create|alter|truncate|delete\s+from|update\s+public|insert\s+into)\b", code), "revokes and grants only")
ok(not re.search(r"supabase\.co|https?://|qbocskai", text.lower()), "names no real database")

T3 = ["tally_period_pulls", "tally_period_days", "tally_ledger_progress"]
STAND = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create table if not exists tally_period_pulls (id int primary key);
create table if not exists tally_period_days (id int primary key);
create table if not exists tally_ledger_progress (id int primary key);
create table if not exists platform_secrets (name text primary key, value text);
create table if not exists platform_admins (user_id uuid primary key, name text);
create table if not exists bystander (id int primary key);
alter table tally_period_pulls enable row level security; alter table tally_period_days enable row level security;
alter table tally_ledger_progress enable row level security; alter table platform_secrets enable row level security;
alter table platform_admins enable row level security; alter table bystander enable row level security;
create or replace function is_superadmin() returns boolean language sql stable as $$ select false $$;
do $$ begin if not exists (select 1 from pg_policies where tablename = 'platform_admins' and policyname = 'admins_read') then
  create policy admins_read on platform_admins for select to authenticated using (is_superadmin()); end if; end $$;
"""
def privs(role, table):
    return sorted(p for p in ["SELECT", "INSERT", "UPDATE", "DELETE"]
                  if db.one("select has_table_privilege('%s', 'public.%s', '%s')" % (role, table, p)) == "t")
def body(): return text[text.index("\nbegin;") + 1:]
db = pg_stand.start(int(os.environ.get("PG114_PORT") or 31140))
try:
    print("== 4. a database without the tables")
    if not RED:
        try: db.sql(body()); ok(True, "runs where none of the five tables exists")
        except RuntimeError as e: ok(False, "runs where none of the five tables exists: " + str(e)[-200:])
    db.sql(STAND)
    ok(privs("anon", "tally_period_pulls") == ["DELETE", "INSERT", "SELECT", "UPDATE"], "the stand: anon holds DML on tally_period_pulls, as staging did")
    print("== 1. it runs, twice")
    if not RED:
        for n in (1, 2):
            try: db.sql(body()); ok(True, "run %d" % n)
            except RuntimeError as e: ok(False, "run %d: %s" % (n, str(e)[-200:]))
    print("== 2. grants after it")
    for t in T3 + ["platform_secrets"]:
        ok(privs("anon", t) == [] and privs("authenticated", t) == [], "%s: anon and authenticated hold nothing" % t)
        ok(privs("service_role", t) == ["DELETE", "INSERT", "SELECT", "UPDATE"], "%s: service_role keeps select, insert, update, delete" % t)
    ok(privs("anon", "platform_admins") == [], "platform_admins: anon holds nothing")
    ok(privs("authenticated", "platform_admins") == ["SELECT"], "platform_admins: authenticated keeps SELECT only (its policy admins_read; no write a policy could open)")
    ok(privs("service_role", "platform_admins") == ["DELETE", "INSERT", "SELECT", "UPDATE"], "platform_admins: service_role keeps its grants")
    print("== 3. nothing else")
    ok(privs("anon", "bystander") == ["DELETE", "INSERT", "SELECT", "UPDATE"], "a table it does not name keeps its grants")
    ok(db.one("select count(*) from pg_class where relname in ('tally_period_pulls','tally_period_days','tally_ledger_progress','platform_secrets','platform_admins') and relrowsecurity") == "5", "RLS still on for all five")
    ok(db.one("select count(*) from pg_policies where tablename = 'platform_admins' and policyname = 'admins_read'") == "1", "admins_read kept")
finally:
    db.stop()
if RED: print("\nRED_WITHOUT_114: %d failed (2 is meant to fail)" % len(fails)); raise SystemExit(0 if fails else 1)
print("\nALL OK" if not fails else "\n%d FAILED" % len(fails)); raise SystemExit(1 if fails else 0)
