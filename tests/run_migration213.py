"""python3 tests/run_migration213.py - server/security/migration-213-optional-off.sql (DRAFT, not applied anywhere), on a
throwaway PostgreSQL (pg_stand, port 55613 unless PG213_PORT; its data dir under TMPDIR; never a real database), with
public.clients as the app writes it, the triggers staging has on it (migrations 19 sync guard and 30 keep keys) and
Supabase's default grants. Made-up clients only.
  0. the name guard: a table optional_off_213 that is not 213's stops it, nothing changed; no clients table stops it
  1. every live client with createOptional true is turned off, stamped createOptionalAt, updated_at moved on (browsers
     pull it); staging's clients_touch makes updated_by NULL on the changed clients (the SQL editor has no auth.uid());
     the old value logged in optional_off_213; nothing else in data changes; bankOptional never changed (it was never
     on by default); off or missing untouched; a client that chose it with the new build (stamped) left on; soft-deleted
     clients left out
  2. run twice: nothing more changes; a client ticked on again after the run stays on
  3. grants: anon, authenticated, service_role and public have no right on optional_off_213; RLS on
  4. the undo at the foot of the file puts the old value back, stamped with the undo's own time"""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ["TMPDIR"] = os.environ.get("PG213_TMP") or "/tmp/fincom-m213"   # the postgres user must reach it (not under /tmp/claude-0)
import shutil as _sh; os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o755); _sh.chown(os.environ["TMPDIR"], "postgres", "postgres")
if not os.access("/tmp", os.W_OK) or os.stat("/tmp").st_mode & 0o002 == 0: os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
import pg_stand
ROOT = os.path.dirname(HERE)
M = os.environ.get("M213_FILE") or os.path.join(ROOT, "server", "security", "migration-213-optional-off.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def raises(fn):
    try: fn(); return None
    except RuntimeError as e: return str(e)
F1, F2 = "f1000000-0000-0000-0000-000000000213", "f2000000-0000-0000-0000-000000000213"
U1 = "aaaaaaaa-0000-0000-0000-000000000213"
TABLES = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create table if not exists clients (firm_id uuid not null, id text not null, name text, gstin text, pan text, tally_name text, data jsonb, deleted boolean default false,
  updated_at timestamptz default now(), updated_by uuid, primary key (firm_id, id));
create table if not exists records (firm_id uuid not null, kind text not null, id text not null, client_id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(),
  primary key (firm_id, kind, id));
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- as on staging (review of 23-Nov-2026): clients_touch stamps every update with its time and who
create or replace function clients_touch() returns trigger language plpgsql as $f$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $f$;
drop trigger if exists clients_touch on clients;
create trigger clients_touch before update on clients for each row execute function clients_touch();
"""
SQL = open(M).read()
UNDO = "\n".join(l[5:] if l.startswith("--   ") else "" for l in SQL[SQL.index("-- UNDO"):].split("\n"))
SEED = [
    (F1, "c_on", {"name": "ZZ On Traders", "voucherType": "Purchase", "createOptional": True, "billwise": True, "gst": {"cgst": "Input CGST"}}, False),
    (F1, "c_off", {"name": "ZZ Off Traders", "createOptional": False, "bankOptional": False}, False),
    (F1, "c_none", {"name": "ZZ None Traders"}, False),
    (F1, "c_new", {"name": "ZZ Ticked Traders", "createOptional": True, "createOptionalAt": "2026-11-23T05:00:00.000Z"}, False),
    (F1, "c_bank", {"name": "ZZ Bank Traders", "bankOptional": True, "bankAuto": False}, False),
    (F1, "c_both", {"name": "ZZ Both Traders", "createOptional": True, "bankOptional": True, "bankOptionalAt": "2026-11-23T06:00:00.000Z"}, False),
    (F1, "c_gone", {"name": "ZZ Removed Traders", "createOptional": True, "bankOptional": True}, True),
    (F2, "c_on", {"name": "ZZ Other Firm Same Id", "createOptional": True}, False),
    (F2, "c_str", {"name": "ZZ Text Value", "createOptional": "true"}, False),
]
def seed(db):
    db.sql("delete from clients;" + "".join(
        "insert into clients (firm_id, id, name, data, deleted, updated_at, updated_by) values ('%s', '%s', '%s', '%s'::jsonb, %s, '2026-11-01T00:00:00Z', '%s');" % (f, i, d["name"], json.dumps(d), "true" if g else "false", U1)
        for f, i, d, g in SEED))
def data(db, f, i): return json.loads(db.one("select data::text from clients where firm_id = '%s' and id = '%s'" % (f, i)))
ISO = r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$"
def rest(d): return {k: v for k, v in d.items() if k not in ("createOptional", "createOptionalAt", "bankOptional", "bankOptionalAt")}

db = pg_stand.start(int(os.environ.get("PG213_PORT") or 55613))
try:
    # 0. guards
    r = raises(lambda: db.sql(SQL)); ok(r and "public.clients is not on this database" in r, "no clients table: stopped")
    db.sql(TABLES)
    db.sql(pg_stand.migration_body(os.path.join(ROOT, "server", "security", "migration-19-sync-guard.sql")))
    db.sql(pg_stand.migration_body(os.path.join(ROOT, "server", "security", "migration-30-client-keys-kept.sql")))
    seed(db)
    db.sql("create table public.optional_off_213 (x int);")
    r = raises(lambda: db.sql(SQL)); ok(r and "not this migration" in r and data(db, F1, "c_on")["createOptional"] is True, "a same-named table of something else: stopped, nothing changed")
    db.sql("drop table public.optional_off_213;")
    # 1. the run
    db.sql(SQL)
    on = data(db, F1, "c_on")
    ok(on["createOptional"] is False and re.match(ISO, on.get("createOptionalAt", "")), "bills/sales on -> off, stamped as the app writes times (%s)" % on.get("createOptionalAt"))
    ok(rest(on) == rest(SEED[0][2]) and "bankOptional" not in on, "nothing else of the client's setup changed (no bank key added)")
    ok(db.one("select updated_at > '2026-11-02' from clients where firm_id = '%s' and id = 'c_on'" % F1) == "t", "updated_at moved on (every browser pulls the new copy)")
    ok(db.one("select count(*) from clients where updated_by = '%s'" % U1) == str(len(SEED) - 3) and db.one("select count(*) from clients where updated_by is null") == "3",
       "updated_by: NULL on the 3 changed clients (clients_touch, no signed-in person in the SQL editor), as it was on the rest")
    bk = data(db, F1, "c_bank")
    ok(bk == SEED[4][2], "bank entries on (ticked on purpose: never on by default): left as they are")
    both = data(db, F1, "c_both")
    ok(both["createOptional"] is False and both["bankOptional"] is True and both["bankOptionalAt"] == "2026-11-23T06:00:00.000Z", "bills and bank on: bills off, bank left")
    ok(data(db, F2, "c_on")["createOptional"] is False, "the other firm's client of the same id: off too")
    ok(data(db, F1, "c_gone") == SEED[6][2], "a soft-deleted client: left out")
    ok(data(db, F1, "c_off") == SEED[1][2] and data(db, F1, "c_none") == SEED[2][2] and data(db, F1, "c_new") == SEED[3][2] and data(db, F2, "c_str") == SEED[8][2]
       and db.one("select count(*) from clients where updated_at < '2026-11-02'") == "6", "off, missing, deliberately on, bank only, deleted and a text 'true': untouched")
    log = db.rows("select firm_id, client_id, setting, old_value::text o, old_at::text a from optional_off_213 order by firm_id, client_id, setting")
    ok([(x["client_id"], x["setting"], x["o"], x["a"]) for x in log] == [("c_both", "createOptional", "true", ""), ("c_on", "createOptional", "true", ""), ("c_on", "createOptional", "true", "")],
       "the old values logged, one row per client and setting changed (%s)" % [(x["client_id"], x["setting"]) for x in log])
    # 2. twice
    stamp = data(db, F1, "c_on")["createOptionalAt"]
    db.sql("update clients set data = data || '{\"createOptional\": true, \"createOptionalAt\": \"2026-11-24T09:00:00.000Z\"}'::jsonb where firm_id = '%s' and id = 'c_on'" % F2)
    db.sql(SQL)
    ok(data(db, F1, "c_on")["createOptionalAt"] == stamp and db.one("select count(*) from optional_off_213") == "3", "run again: nothing more changed or logged")
    ok(data(db, F2, "c_on")["createOptional"] is True, "a client ticked on again after the run stays on")
    # 3. grants
    g = db.rows("select grantee, privilege_type from information_schema.role_table_grants where table_name = 'optional_off_213' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')")
    ok(g == [], "no API role has any right on optional_off_213 (%s)" % g)
    ok(db.one("select relrowsecurity from pg_class where oid = 'public.optional_off_213'::regclass") == "t", "row-level security on")
    r = raises(lambda: db.sql("set role authenticated; select * from public.optional_off_213;"))
    ok(r and "permission denied" in r, "authenticated cannot read it")
    # 4. undo
    db.sql(UNDO)
    on, both = data(db, F1, "c_on"), data(db, F1, "c_both")
    ok(on["createOptional"] is True and both["createOptional"] is True and re.match(ISO, on.get("createOptionalAt") or "") and on["createOptionalAt"] > stamp,
       "the undo: the old value back, stamped with the undo's own time, newer than the run's (%s > %s)" % (on.get("createOptionalAt"), stamp))
    ok(data(db, F2, "c_on")["createOptionalAt"] == "2026-11-24T09:00:00.000Z", "the undo leaves a client changed since alone")
finally:
    db.stop()
    import shutil; shutil.rmtree(db.data, ignore_errors=True)
    try: os.rmdir(os.environ["TMPDIR"])
    except OSError: pass
print(("%d FAILED" % len(fails)) if fails else "all passed")
sys.exit(1 if fails else 0)
