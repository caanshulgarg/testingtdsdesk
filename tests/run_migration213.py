"""python3 tests/run_migration213.py - server/security/migration-213-optional-off.sql (DRAFT, not applied anywhere), on a
throwaway PostgreSQL (pg_stand, port 55613 unless PG213_PORT; its data dir under TMPDIR; never a real database), with
public.clients as the app writes it, the triggers staging has on it (migrations 19 sync guard and 30 keep keys) and
Supabase's default grants. Made-up clients only.
  0. the name guard: a table optional_off_213 that is not 213's stops it, nothing changed; no clients table stops it
  1. every client with createOptional true is turned off, stamped createOptionalAt, updated_at moved on (browsers pull
     it); the old value logged in optional_off_213; nothing else in data changes; off or missing clients untouched; a
     client ticked on deliberately with the new build (createOptionalAt there already) left on
  2. run twice: nothing more changes; a client ticked on again after the run stays on
  3. grants: anon, authenticated, service_role and public have no right on optional_off_213; RLS on
  4. the undo at the foot of the file puts the old values back"""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ["TMPDIR"] = os.environ.get("PG213_TMP") or "/tmp/fincom-m213"   # the postgres user must reach it (not under /tmp/claude-0)
import shutil as _sh; os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o755); _sh.chown(os.environ["TMPDIR"], "postgres", "postgres")
if not os.access("/tmp", os.W_OK) or os.stat("/tmp").st_mode & 0o002 == 0: os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
import pg_stand
ROOT = os.path.dirname(HERE)
M = os.path.join(ROOT, "server", "security", "migration-213-optional-off.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def raises(fn):
    try: fn(); return None
    except RuntimeError as e: return str(e)
F1, F2 = "f1000000-0000-0000-0000-000000000213", "f2000000-0000-0000-0000-000000000213"
TABLES = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create table if not exists clients (firm_id uuid not null, id text not null, name text, gstin text, pan text, tally_name text, data jsonb, deleted boolean default false,
  updated_at timestamptz default now(), primary key (firm_id, id));
create table if not exists records (firm_id uuid not null, kind text not null, id text not null, client_id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(),
  primary key (firm_id, kind, id));
create table if not exists sync_refused_stub (x int);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
"""
SQL = open(M).read()
UNDO = "\n".join(l[5:] if l.startswith("--   ") else "" for l in SQL[SQL.index("-- UNDO"):].split("\n"))
def seed(db):
    db.sql("delete from clients;" + "".join(
        "insert into clients (firm_id, id, name, data, updated_at) values ('%s', '%s', '%s', '%s'::jsonb, '2026-11-01T00:00:00Z');" % (f, i, n, json.dumps(d))
        for f, i, n, d in [
            (F1, "c_on", "ZZ On Traders", {"name": "ZZ On Traders", "voucherType": "Purchase", "createOptional": True, "billwise": True, "gst": {"cgst": "Input CGST"}}),
            (F1, "c_off", "ZZ Off Traders", {"name": "ZZ Off Traders", "createOptional": False}),
            (F1, "c_none", "ZZ None Traders", {"name": "ZZ None Traders"}),
            (F1, "c_new", "ZZ Ticked Traders", {"name": "ZZ Ticked Traders", "createOptional": True, "createOptionalAt": "2026-11-23T05:00:00.000Z"}),
            (F2, "c_on", "ZZ Other Firm Same Id", {"name": "ZZ Other Firm Same Id", "createOptional": True}),
            (F2, "c_str", "ZZ Text Value", {"name": "ZZ Text Value", "createOptional": "true"}),
        ]))
def data(db, f, i): return json.loads(db.one("select data::text from clients where firm_id = '%s' and id = '%s'" % (f, i)))

db = pg_stand.start(int(os.environ.get("PG213_PORT") or 55613))
try:
    # 0. guards
    r = raises(lambda: db.sql(SQL)); ok(r and "public.clients is not on this database" in r, "no clients table: stopped (%s)" % (r or "ran")[-90:])
    db.sql(TABLES)
    db.sql(pg_stand.migration_body(os.path.join(ROOT, "server", "security", "migration-19-sync-guard.sql")))
    db.sql(pg_stand.migration_body(os.path.join(ROOT, "server", "security", "migration-30-client-keys-kept.sql")))
    seed(db)
    db.sql("create table public.optional_off_213 (x int);")
    r = raises(lambda: db.sql(SQL)); ok(r and "not this migration" in r and data(db, F1, "c_on")["createOptional"] is True, "a same-named table of something else: stopped, nothing changed")
    db.sql("drop table public.optional_off_213;")
    # 1. the run
    out = db._psql([], SQL)
    on = data(db, F1, "c_on")
    ok(on["createOptional"] is False and re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$", on.get("createOptionalAt", "")), "on -> off, stamped as the app writes times (%s)" % on.get("createOptionalAt"))
    ok({k: v for k, v in on.items() if k not in ("createOptional", "createOptionalAt")} == {"name": "ZZ On Traders", "voucherType": "Purchase", "billwise": True, "gst": {"cgst": "Input CGST"}}, "nothing else of the client's setup changed")
    ok(db.one("select updated_at > '2026-11-02' from clients where firm_id = '%s' and id = 'c_on'" % F1) == "t", "updated_at moved on (every browser pulls the new copy)")
    ok(data(db, F2, "c_on")["createOptional"] is False, "the other firm's client of the same id: off too")
    ok(data(db, F1, "c_off") == {"name": "ZZ Off Traders", "createOptional": False} and data(db, F1, "c_none") == {"name": "ZZ None Traders"}
       and db.one("select count(*) from clients where updated_at < '2026-11-02'") == "4", "clients off or with no value, and the ones left: untouched")
    ok(data(db, F1, "c_new")["createOptional"] is True, "ticked on deliberately with the new build (stamped before): left on")
    ok(data(db, F2, "c_str")["createOptional"] == "true", "a value that is not JSON true (made up here; Client setup writes only true or false): not touched")
    log = db.rows("select firm_id, client_id, old_value::text o, old_at::text a from optional_off_213 order by firm_id, client_id")
    ok([(x["client_id"], x["o"], x["a"]) for x in log] == [("c_on", "true", ""), ("c_on", "true", "")], "the old values logged, one row per client changed (%s)" % log)
    # 2. twice
    stamp = data(db, F1, "c_on")["createOptionalAt"]
    db.sql("update clients set data = data || '{\"createOptional\": true, \"createOptionalAt\": \"2026-11-24T09:00:00.000Z\"}'::jsonb where firm_id = '%s' and id = 'c_on'" % F2)
    db.sql(SQL)
    ok(data(db, F1, "c_on")["createOptionalAt"] == stamp and db.one("select count(*) from optional_off_213") == "2", "run again: nothing more changed or logged")
    ok(data(db, F2, "c_on")["createOptional"] is True, "a client ticked on again after the run stays on")
    # 3. grants
    g = db.rows("select grantee, privilege_type from information_schema.role_table_grants where table_name = 'optional_off_213' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')")
    ok(g == [], "no API role has any right on optional_off_213 (%s)" % g)
    ok(db.one("select relrowsecurity from pg_class where oid = 'public.optional_off_213'::regclass") == "t", "row-level security on")
    r = raises(lambda: db.sql("set role authenticated; select * from public.optional_off_213;"))
    ok(r and "permission denied" in r, "authenticated cannot read it")
    # 4. undo
    db.sql(UNDO)
    ok(data(db, F1, "c_on")["createOptional"] is True and data(db, F1, "c_on").get("createOptionalAt") is None, "the undo: the old value back (createOptionalAt null)")
    ok(data(db, F2, "c_on")["createOptionalAt"] == "2026-11-24T09:00:00.000Z", "the undo leaves a client changed since alone")
finally:
    db.stop()
    import shutil; shutil.rmtree(db.data, ignore_errors=True)
print(("%d FAILED" % len(fails)) if fails else "all passed")
sys.exit(1 if fails else 0)
