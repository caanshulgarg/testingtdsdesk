"""python3 run_migration_grants.py - migration-97-explicit-grants (20-Oct-2026, ROUND 101, branch next-grants) and the rule
that every table a migration makes in public carries its own grants. From 30-Oct-2026 Supabase no longer gives anon,
authenticated and service_role automatic privileges on new tables, views and sequences in public; this builds a fresh
database the way the live project's go-live, a Supabase branch or a rehearsal copy would get one, on a throwaway
PostgreSQL (pg_stand, port 30971; never a real database):
  0. the file: one transaction, GRANTs only (no revoke, nothing dropped, no "delete from", default privileges untouched),
     every relation of the staging snapshot (tests/fixtures/staging-grants-20261020.json) named except
     _bankscrub_baseline_20261013 (left out until the owner decides), names no real database.
  1. the stand: Supabase's roles (anon, authenticated, service_role) with NO privileges anywhere in public and no default
     privileges for them (Supabase from 30-Oct-2026); the tables made before migration 32 as the other stands make them.
  2. the migrations in docs/MIGRATION-ORDER.md's order for a fresh database (32 .. 74 as run_migration_order's "fresh"
     order, then 75, 77 .. 96), each must run; then stand-ins for the snapshot's tables made before the migrations
     (firms, clients, records, ...: they are on every real database already); then 97, twice.
  3. after it, the privileges of anon / authenticated / service_role on EVERY relation of the snapshot equal staging's
     (MAINTAIN only compared on PostgreSQL 17 or later: pg_stand is 16).
  4. no table, view or sequence in public is left without service_role privileges. A migration file in server/ that this
     test does not know yet runs after 97 (as on a real database) and must pass this too: a new table without grants in
     its own file fails here.
RED_WITHOUT_97=1: the same checks without running 97 (3 and 4 fail)."""
import os, re, sys, json, glob, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
import zoho_stand as Z            # part(), VAULT (Vault made plain for 75), psql_file()
import console_chain_stand as CHAIN_STAND   # staging's billing / assistant / pg_cron shapes the console's migrations lean on
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SERVER = os.path.join(ROOT, "server")
M97 = os.path.join(SERVER, "security", "migration-97-explicit-grants.sql")
SNAP = json.load(open(os.path.join(HERE, "fixtures", "staging-grants-20261020.json")))
REL = SNAP["relations"]; SKIP = set(SNAP["_about"]["left_out_of_migration_97"])
RED = os.environ.get("RED_WITHOUT_97") == "1"
ROLES = ("anon", "authenticated", "service_role")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the tables made before migration 32, as the other stands make them (the rest are stand-ins, step 2)
BEFORE = ["gst-taxpro/schema.sql", "gst-taxpro/migration-16-tax-accuracy.sql", "books-sync/migration.sql", "support/migration.sql"]
# docs/MIGRATION-ORDER.md, a fresh database: 32 -> 33 -> 35 -> 34 (reviewed) -> 36 -> 36b -> 37 -> ... -> 60 -> 68 -> 70 -> 61
# -> 62 -> 67 -> 63 -> 64 -> 65 -> 66 (run_migration_order.py's "fresh" order), then the table's later rows in order
CHAIN = ["tally-cloud/migration-%s.sql" % x for x in (
    "32-sync-safety", "33-ledger-lists", "35-bridge-control", "34-ledger-safety", "36-ledger-rename", "36b-post-acceptance", "37-follow-ups",
    "38-post-followups", "39-rename-map-empty-day", "40-states-carried", "41-day-counts", "42-empty-day-second-read", "43-posting-reply",
    "44-recorder", "45-bulk-posting", "46-trial-tools", "47-recorder-queue-alerts", "48-day-cache-once", "49-post-row-flags",
    "50-recorder-held", "51-recorder-ids-mismatch", "52-recorder-duplicate-needs-same-entry", "53-recorder-placeholder-settled",
    "54-post-target-bridge", "55-settle-and-lease", "56-keep-fields", "57-entry-details", "58-lows", "59-ledger-aliases", "60-recorder-lows",
    "68-alert-dismissals", "70-alert-dismissals-tighten", "61-privileges", "62-tds-rate-worked-out", "67-recorder-renumbered",
    "63-recorder-repeat", "64-pages-live", "65-selfchecks", "66-recorder-masters", "72-gst-type", "73-tds-fields", "74-payroll")] + [
    "zoho-books/migration-75-zoho-books.sql", "assistant/migration-77-assistant.sql", "assistant/migration-78-audit.sql",
    "assistant/migration-79-reports.sql", "tally-cloud/migration-80-challan-register.sql", "assistant/migration-81-depreciation.sql",
    "assistant/migration-82-assistant-default-on.sql", "assistant/migration-83-certificates.sql", "assistant/migration-84-assistant-uploads.sql",
    "assistant/migration-85-asst-span.sql", "assistant/migration-86-asst-span-books.sql", "assistant/migration-87-rls-initplan.sql",
    "assistant/migration-88-ledger-names.sql", "tally-cloud/migration-89-ledger-fetch.sql", "tally-cloud/migration-90-ledger-fetch-speed.sql",
    "tally-cloud/migration-91-book-start.sql", "tally-cloud/migration-92-settle-unnamed-deletes.sql", "gst-browser/migration-93-gst-portal-login.sql",
    "gst-taxpro/migration-94-gst-filing.sql", "gst-2b-match/migration-95-gst-2b-match.sql", "assistant/migration-96-assistant-monthly-cap.sql"]
# SQL files in server/ that are not in the chain, and why (a file not here and not in the chain is NEW: it runs after 97)
KNOWN = set(BEFORE) | {
    # before migration 32: on every real database long ago; the stands make their tables (BEFORE, step 1) or stand-ins
    "tally-cloud/migration.sql", "tally-cloud/staging-apply-13-14.sql", "tally-cloud/golive/migration-13-golive.sql",
    "gst-taxpro/golive/migration-16-golive.sql", "gst-taxpro/golive/schema-golive.sql", "security/restore-2026-10-01-clients.sql",
    "security/checks/tables-without-policies.sql",
    "books-sync/migration-12-live-items.sql",          # leans on the base tables (records); its client_book_items_history is a stand-in
    "books-sync/migration-17-trash.sql",               # its client_trash is not on staging (not in the snapshot)
    # staging-only cron schedules (no tables)
    "zoho-books/migration-75b-zoho-cron-staging.sql", "gst-2b-match/migration-95b-gst-2b-match-cron-staging.sql",
    # this file
    "security/migration-97-explicit-grants.sql"}
KNOWN |= {os.path.relpath(p, SERVER) for p in glob.glob(os.path.join(SERVER, "security", "migration-*.sql"))
          if int(re.search(r"migration-(\d+)", p).group(1)) < 32}
KNOWN |= {os.path.relpath(p, SERVER) for p in glob.glob(os.path.join(SERVER, "tally-cloud", "migration-*.sql"))
          if int(re.search(r"migration-(\d+)", p).group(1)) < 32}
KNOWN |= {os.path.relpath(p, SERVER) for p in glob.glob(os.path.join(SERVER, "tally-cloud", "migration-50-parts", "*.sql"))}   # 50, in parts
ALL = sorted(os.path.relpath(p, SERVER) for p in glob.glob(os.path.join(SERVER, "**", "*.sql"), recursive=True))
def num(f):
    m = re.search(r"migration-(\d+)", f); return (int(m.group(1)) if m else 10 ** 6, f)
NEW = sorted((f for f in ALL if f not in KNOWN and f not in CHAIN), key=num)

# 0. the file
text = open(M97).read() if os.path.exists(M97) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M97), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(bool(text), "0. server/security/migration-97-explicit-grants.sql is there")
ok(code.count("begin;") == 1 and code.count("commit;") == 1 and code.strip().startswith("begin;") and code.strip().endswith("commit;"), "0. one transaction")
ok(not re.search(r"\brevoke\b|\bdrop\b|delete\s+from|alter\s+default\s+privileges|\balter\s+table\b|\bcreate\b", code),
   "0. GRANTs only: no revoke, nothing dropped, no \"delete from\", default privileges and tables left as they are")
named = set(re.findall(r"to_regclass\('public\.([a-z0-9_]+)'\)", code))
ok(named == set(REL) - SKIP, "0. every relation of the snapshot is named (%d), %s left out%s" % (len(named), ", ".join(sorted(SKIP)),
   "" if named == set(REL) - SKIP else ": missing %s, extra %s" % (sorted(set(REL) - SKIP - named)[:8], sorted(named - (set(REL) - SKIP))[:8])))
ok(not any(s in code for s in SKIP), "0. %s is not in the file" % ", ".join(sorted(SKIP)))
ok("qbocskaiewaxqcvaunzc" not in text and "supabase.co" not in text, "0. names no real database")
print("  ..   migration files new to this test (they run after 97): %s" % (", ".join(NEW) or "none"))

STAND_SCHEMA = (Z.part(os.path.join(HERE, "run_migration33.py"), "SCHEMA") + "\n" + Z.part(os.path.join(HERE, "run_migration35.py"), "SCHEMA") + "\n"
    + Z.part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X") + "\n" + Z.part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47") + "\n"
    + "create table if not exists clients (id text, firm_id uuid, name text, data jsonb default '{}', deleted boolean default false, tally_name text default '', gstin text default '', pan text default '', primary key (firm_id, id));\n"
    + Z.VAULT + "\n"
    # what 16 leans on: pg_cron's unschedule
    + "create or replace function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$;\n")
# Supabase from 30-Oct-2026: nothing in public is given to anon, authenticated or service_role by default. Plain PostgreSQL
# gives them nothing already; the stand also takes back what its own stand-in tables were given, so every privilege
# compared below comes from the migrations themselves.
NEW_SUPABASE = """
do $$ declare r text; begin foreach r in array array['anon', 'authenticated', 'service_role'] loop
  if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if; end loop; end $$;
alter role service_role bypassrls;
-- Supabase's own: the Auth admin role and auth's tables the later migrations read (116's sign-in hook, the console's 118+)
do $$ begin if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz,
  email_confirmed_at timestamptz default now(), banned_until timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, friendly_name text, factor_type text, status text, created_at timestamptz default now());
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
"""
ACL = """select c.relname as name, case c.relkind when 'S' then 'sequence' when 'v' then 'view' else 'table' end as kind, r.ro,
  coalesce((select string_agg(lower(a.privilege_type), ',' order by lower(a.privilege_type)) from aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
            where g.rolname = r.ro), '') as privs
  from pg_class c cross join (values ('anon'), ('authenticated'), ('service_role')) r(ro)
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') order by 1, 3"""

db = pg_stand.start(int(os.environ.get("PG97_PORT") or 30971))
try:
    # 1. the stand
    db.sql(STAND_SCHEMA)
    for f in BEFORE:
        rc, err = Z.psql_file(db, os.path.join(SERVER, f))
        ok(rc == 0, "1. before 32: %s runs%s" % (f, "" if rc == 0 else ": " + err[-300:]))
    db.sql(NEW_SUPABASE)
    pg17 = int(db.one("show server_version_num")) >= 170000
    left = int(db.one("select count(*) from pg_default_acl d where d.defaclnamespace = 'public'::regnamespace and exists (select 1 from aclexplode(d.defaclacl) a join pg_roles g on g.oid = a.grantee where g.rolname in ('anon', 'authenticated', 'service_role'))"))
    held = int(db.one("select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee where c.relnamespace = 'public'::regnamespace and g.rolname in ('anon', 'authenticated', 'service_role')"))
    ok(left == 0 and held == 0, "1. Supabase from 30-Oct-2026: no default privileges and no privileges in public for anon / authenticated / service_role (%d, %d)" % (left, held))
    before = {r["name"] for r in db.rows(ACL)}

    # 2. the migrations, then stand-ins for what was made before them, then 97 (twice), then any migration new to this test
    for f in CHAIN:
        rc, err = Z.psql_file(db, os.path.join(SERVER, f))
        ok(rc == 0, "2. %s runs%s" % (f, "" if rc == 0 else ": " + err[-400:]))
        if rc: raise SystemExit("cannot go on: %s failed" % f)
    made = {r["name"] for r in db.rows(ACL)} - before
    # the shapes staging's own tables have where the later migrations (the console's 118 to 125) lean on them: the console
    # tests' stand-ins, one source (console_chain_stand: billing's tables and old functions, pg_cron),
    # made idempotent for this stand (a table or column already here is kept). They are there before 97, as on staging
    # (their grants left out: every privilege compared comes from the migrations and 97)
    shape = lambda t: "\n".join(l for l in t.splitlines() if not l.strip().lower().startswith(("grant ", "revoke ")))
    idem = lambda t: re.sub(r"\badd column (?!if not exists)", "add column if not exists ", re.sub(r"\bcreate table (?!if not exists)", "create table if not exists ", t, flags=re.I), flags=re.I)
    for name, block in (("billing", CHAIN_STAND.BILLING), ("cron", CHAIN_STAND.OPS.CRON)):
        try: db.sql(idem(shape(block)))
        except Exception as e: ok(False, "2. staging's %s tables as the console's stand makes them: %s" % (name, str(e)[-300:]))
    have = {r["name"] for r in db.rows(ACL)}
    standins = sorted(n for n in REL if n not in have and n not in SKIP)
    # the tables the later migrations change, made as their own file makes them (one source), not as bare stand-ins
    REAL = {"tally_companies": ("tally-cloud/migration.sql", r"create table if not exists public\.tally_companies \(.*?\n\);")}
    for n, (f, rx) in REAL.items():
        if n in standins:
            m = re.search(rx, open(os.path.join(SERVER, f)).read(), re.S); assert m, "%s: no %s" % (f, n)
            db.sql(m.group(0)); standins.remove(n)
    for n in standins:
        db.sql(("create sequence if not exists public.%s;" if REL[n]["kind"] == "sequence" else "create table if not exists public.%s (id bigint);") % n)
    print("  ..   stand-ins for what was made before the migrations (%d): %s" % (len(standins), " ".join(standins)))
    ok(all(REL[n]["kind"] != "view" for n in standins), "2. no view needed a stand-in (tally_balances comes from 32/33)")
    if not RED:
        for i in (1, 2):
            rc, err = Z.psql_file(db, M97)
            ok(rc == 0, "2. migration-97 runs (pass %d)%s" % (i, "" if rc == 0 else ": " + err[-400:]))
    for f in NEW:
        rc, err = Z.psql_file(db, os.path.join(SERVER, f))
        ok(rc == 0, "2. %s (new to this test, after 97) runs%s" % (f, "" if rc == 0 else ": " + err[-400:] + " - add what it needs, or place it in CHAIN"))
        made |= {r["name"] for r in db.rows(ACL)} - have

    # 3. the privileges equal staging's
    got = {}
    for r in db.rows(ACL): got.setdefault(r["name"], {"kind": r["kind"]})[r["ro"]] = [p for p in r["privs"].split(",") if p]
    want = {n: {ro: [p for p in r[ro] if pg17 or p != "maintain"] for ro in ROLES} for n, r in REL.items() if n not in SKIP}
    missing = sorted(n for n in want if n not in got)
    ok(not missing, "3. every relation of the snapshot is on the stand (%d)%s" % (len(want), ": missing " + " ".join(missing) if missing else ""))
    diff = []
    for n in sorted(want):
        if n not in got: continue
        if got[n]["kind"] != REL[n]["kind"]: diff.append("%s is a %s, staging's a %s" % (n, got[n]["kind"], REL[n]["kind"]))
        for ro in ROLES:
            g, w = sorted(got[n].get(ro, [])), sorted(want[n][ro])
            if g != w: diff.append("%s/%s: %s, staging %s" % (n, ro, ",".join(g) or "-", ",".join(w) or "-"))
    ok(not diff, "3. anon / authenticated / service_role on all %d relations equal staging's (%s compared)%s"
       % (len(want), "MAINTAIN" if pg17 else "MAINTAIN not", ("; %d differ: " % len(diff)) + "; ".join(diff[:12]) if diff else ""))
    nt = sum(1 for n in want if REL[n]["kind"] != "sequence")
    ok(not diff and sum(1 for n in want if REL[n]["kind"] != "sequence" and want[n]["authenticated"]) == 95 and sum(1 for n in want if REL[n]["kind"] != "sequence" and want[n]["anon"]) == 40,
       "3. so %d tables and views: service_role on all, authenticated on 95, anon on 40 (staging: 120 / 96 / 41 with %s)" % (nt, ", ".join(sorted(SKIP))))

    # 4. nothing left without service_role
    bare = sorted(n for n, r in got.items() if not r.get("service_role"))
    bare_made = [n for n in bare if n in made or n in REL]
    ok(not bare_made, "4. no table, view or sequence the migrations made is left without service_role privileges%s"
       % (" (%d): %s" % (len(bare_made), " ".join(bare_made[:20])) if bare_made else ""))
    others = [n for n in bare if n not in bare_made]
    ok(not others, "4. nor anything else in public%s" % (": " + " ".join(others) if others else ""))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
