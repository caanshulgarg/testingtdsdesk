"""python3 tests/run_migration215.py - server/tally-cloud/migration-215-db-load.sql and migration-215-indexes.sql (DRAFTS,
not applied anywhere), on a throwaway PostgreSQL (pg_stand, port 55715 unless PG215_PORT; its data dir under TMPDIR,
/tmp/fincom-m215 unless PG215_TMP; never a real database). public.records as staging has it, with its triggers (touch_row,
inbox_guard as on staging; migration 19's sync guard), and the tables tally_read_view reads, with stand-ins for the
functions it calls (tally_read_serving, STABLE as on staging, counts its calls). Made-up firms, books and lines only.
  0. the name guard: a records_skip_same that is not 215's, or a tally_read_view that is not migration 196's: stopped,
     nothing changed
  1. records: the same record saved again (the app's upsert, its keys in another order) writes nothing: no new row
     version, updated_at not moved; a real change, a deletion and a restore are written as before (the delete and
     restore stamps); sync_guard still keeps a firm's data from an empty save; inbox_guard still keeps an inbox status
  2. tally_read_view: the same answer as migration 196's, with the serving bridges worked out once a linked book
     (196: several times a book)
  3. grants: records_skip_same executable by nobody; tally_read_view by authenticated and service_role, not anon
  4. run twice: no error, one trigger
  5. the indexes file: both built, valid; the beat's held-lines read uses the new index
M215_SKIP=1: the checks of 1-2 without the migration (they fail: what it fixes)"""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ["TMPDIR"] = os.environ.get("PG215_TMP") or "/tmp/fincom-m215"   # the postgres user must reach it (not under /tmp/claude-0)
import shutil as _sh; os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o755); _sh.chown(os.environ["TMPDIR"], "postgres", "postgres")
if not os.access("/tmp", os.W_OK) or os.stat("/tmp").st_mode & 0o002 == 0: os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
import pg_stand
ROOT = os.path.dirname(HERE)
M = os.environ.get("M215_FILE") or os.path.join(ROOT, "server", "tally-cloud", "migration-215-db-load.sql")
IX = os.path.join(ROOT, "server", "tally-cloud", "migration-215-indexes.sql")
SKIP = os.environ.get("M215_SKIP") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def raises(fn):
    try: fn(); return None
    except RuntimeError as e: return str(e)
F1, F2 = "f1000000-0000-0000-0000-000000000215", "f2000000-0000-0000-0000-000000000215"
U1, U2 = "aaaaaaaa-0000-0000-0000-000000000215", "bbbbbbbb-0000-0000-0000-000000000215"
D1, D2 = "d1000000-0000-0000-0000-000000000215", "d2000000-0000-0000-0000-000000000215"
B = ["b%d000000-0000-0000-0000-000000000215" % i for i in range(1, 6)]

TABLES = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create table if not exists clients (firm_id uuid not null, id text not null, name text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), updated_by uuid, primary key (firm_id, id));
-- as on staging (23-Nov-2026)
create table if not exists records (firm_id uuid not null, client_id text, kind text not null, id text not null, data jsonb, updated_at timestamptz default now(), updated_by uuid,
  deleted boolean default false, primary key (firm_id, kind, id));
create index if not exists records_pull_idx on records (firm_id, updated_at);
create index if not exists records_client_idx on records (firm_id, client_id, kind);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create or replace function public.touch_row() returns trigger language plpgsql set search_path to '' as $f$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $f$;
create trigger records_touch before insert or update on public.records for each row execute function public.touch_row();
create or replace function public.inbox_guard() returns trigger language plpgsql set search_path to '' as $f$
begin
  if old.kind = 'inbox' then
    if (new.deleted and not old.deleted) or new.data = '{}'::jsonb or new.data is null then return old; end if;
    if coalesce(new.data->>'status', '') not in ('waiting', 'read', 'ignored') then
      new.data := jsonb_set(new.data, '{status}', coalesce(old.data->'status', '"waiting"'::jsonb));
    end if;
  end if;
  return new;
end $f$;
create trigger inbox_guard before update on public.records for each row execute function public.inbox_guard();
"""
# what tally_read_view reads (its columns as on staging), and stand-ins for the functions it calls
VIEW_TABLES = """
create table if not exists tally_links (firm_id uuid, book_id uuid primary key, client_id text, device_id uuid, company_guid text, company_name text, state text, data_loc text);
create table if not exists tally_companies (firm_id uuid, company text, book_id uuid, client_id text, last_seen timestamptz);
create table if not exists tally_month_locks (book_id uuid, month date, unlocked_at timestamptz);
create table if not exists tally_recorder_lines (id bigserial primary key, firm_id uuid, client_id text, book_id uuid, device_id uuid, bridge text, company_guid text, company text,
  line_id text, event text, object_guid text, master_id text, alter_id bigint, vch_type text, vch_no text, vch_date date, received_at timestamptz default now(), state text,
  held_why text, payload jsonb, body jsonb);
create index if not exists tally_recorder_lines_firm on tally_recorder_lines (firm_id, received_at desc);
create index if not exists tally_recorder_lines_state on tally_recorder_lines (book_id, state);
create table if not exists serving_fix (book_id uuid primary key, srv jsonb);
create sequence if not exists serving_calls;
create or replace function tally_read_serving(p_firm uuid, p_book uuid) returns jsonb language plpgsql stable as $f$
begin perform nextval('serving_calls'); return coalesce((select srv from serving_fix where book_id = p_book), '[]'::jsonb); end $f$;
create or replace function tally_read_heard(p_device uuid) returns timestamptz language sql stable as $f$ select '2026-11-23T10:00:00Z'::timestamptz $f$;
create or replace function tally_fetch_on(p_device uuid) returns boolean language sql stable as $f$ select p_device = 'd1000000-0000-0000-0000-000000000215'::uuid $f$;
"""
def seed_view(db):
    db.sql("insert into members (user_id, firm_id, name, role, active) values ('%s', '%s', 'Made Up Owner', 'owner', true), ('%s', '%s', 'Other Firm', 'owner', true);" % (U1, F1, U2, F2))
    sv = lambda d, b, v="2.5.19": {"device": d, "bridge": b, "version": v, "at": "2026-11-23T09:59:00Z"}
    links, comps, srv, lines = [], [], [], []
    for i, b in enumerate(B):
        links.append("('%s', '%s', 'c%d', '%s', 'GUID-%d', 'Made Up Co %d', 'linked')" % (F1, b, i, D1, i, i))
        comps.append("('%s', 'Made Up Co %d', '%s', 'c%d')" % (F1, i, b, i))
    links.append("('%s', 'b9000000-0000-0000-0000-000000000215', 'c9', '%s', 'GUID-9', 'Unlinked Co', 'unlinked')" % (F1, D1))
    links.append("('%s', 'b8000000-0000-0000-0000-000000000215', 'x1', '%s', 'GUID-8', 'Other Firm Co', 'linked')" % (F2, D2))
    # books 0-2 served (book 0 by two bridges), 3-4 by nothing
    srv = [(B[0], [sv(D1, "go-aaaaaa"), sv(D2, "go-bbbbbb", "2.3.1")]), (B[1], [sv(D2, "go-bbbbbb")]), (B[2], [sv(D1, "go-aaaaaa", "2.2.0")])]
    n = 0
    for i, b in enumerate(B[:3]):
        for j, (dev, br, st, ev, mid, why, age) in enumerate([
                (D2, "go-cccccc", "held", "created", "101", "", 1), (D2, "go-cccccc", "fetching", "altered", "102", "", 2),
                (D1, "go-aaaaaa", "held", "created", "103", "", 1),          # its own serving bridge: not asked again
                (D2, "go-cccccc", "held", "deleted", "104", "", 1),          # a delete: not asked
                (D2, "go-cccccc", "held", "created", "105", "waiting for the ledger X", 1),
                (D2, "go-cccccc", "held", "created", "106", "FinCom does not ask Tally for this company''s entries", 12),
                (D2, "go-cccccc", "held", "created", "107", "", 12),         # older than 7 days, not slow words
                (D2, "go-cccccc", "applied", "created", "108", "", 1),
                (D2, "go-cccccc", "held", "created", "109", "", 1)]):     # resolved below
            n += 1
            lines.append("('%s', '%s', '%s', '%s', 'GUID-%d', 'Made Up Co %d', 'L%d-%d', '%s', '%s', now() - interval '%d days', '%s', '%s', '2026-10-0%d')" % (F1, b, dev, br, i, i, i, j, ev, mid, age, st, why, 1 + j % 9))
        lines.append("('%s', '%s', '%s', 'go-cccccc', 'GUID-%d', 'Made Up Co %d', 'L%d-8:resolved', 'created', '109', now(), 'applied', '', '2026-10-01')" % (F1, b, D2, i, i, i))
    db.sql("insert into tally_links (firm_id, book_id, client_id, device_id, company_guid, company_name, state) values " + ", ".join(links) + ";"
           "insert into tally_companies (firm_id, company, book_id, client_id) values " + ", ".join(comps) + ";"
           "insert into serving_fix values " + ", ".join("('%s', '%s'::jsonb)" % (b, json.dumps(s)) for b, s in srv) + ";"
           "insert into tally_month_locks values ('%s', '2026-10-01', null);" % B[2] +
           "insert into tally_recorder_lines (firm_id, book_id, device_id, bridge, company_guid, company, line_id, event, master_id, received_at, state, held_why, vch_date) values " + ", ".join(lines) + ";")

def m196(db):
    s = open(os.path.join(ROOT, "server", "tally-cloud", "migration-196-recorder-no-held.sql")).read()
    i = s.index("create or replace function public.tally_read_view()"); j = s.index("end $function$;", i) + len("end $function$;")
    db.sql(s[i:j])
def view(db, uid=U1):
    calls0 = int(db.one("select last_value + (case when is_called then 0 else -1 end) from serving_calls"))
    out = json.loads(db.one("select public.tally_read_view()::text", uid))
    return out, int(db.one("select last_value from serving_calls")) - calls0
def ver(db, f, k, i):
    r = db.rows("select xmin::text x, updated_at::text u, data::text d, deleted::text del, deleted_at::text da, restored_at::text ra from records where firm_id = '%s' and kind = '%s' and id = '%s'" % (f, k, i))
    return r[0] if r else None
UPSERT = """insert into records (firm_id, kind, id, client_id, data, deleted) select * from json_to_recordset('%s') as x(firm_id uuid, kind text, id text, client_id text, data jsonb, deleted boolean)
 on conflict (firm_id, kind, id) do update set client_id = excluded.client_id, data = excluded.data, deleted = excluded.deleted, firm_id = excluded.firm_id, id = excluded.id, kind = excluded.kind;"""
def upsert(db, rows, uid=U1): db.sql(UPSERT % json.dumps(rows).replace("'", "''"), uid)

db = pg_stand.start(int(os.environ.get("PG215_PORT") or 55715))
try:
    SQL = open(M).read()
    db.sql(TABLES)
    db.sql(pg_stand.migration_body(os.path.join(ROOT, "server", "security", "migration-19-sync-guard.sql")))
    db.sql(VIEW_TABLES); m196(db); seed_view(db)
    # 0. guards
    if not SKIP:
        db.sql("create function public.records_skip_same() returns int language sql as 'select 1';")
        r = raises(lambda: db.sql(SQL)); ok(r and "records_skip_same" in r and "Nothing was changed" in r, "0. a records_skip_same of something else: stopped (%s)" % (r or "ran")[-120:].strip())
        db.sql("drop function public.records_skip_same();")
        db.sql("create or replace function public.tally_read_view() returns jsonb language sql stable as $$ select '{}'::jsonb $$;")
        r = raises(lambda: db.sql(SQL)); ok(r and "changed since migration 196" in r, "0. a tally_read_view that is not 196's: stopped")
        ok(db.one("select count(*) from pg_trigger where tgname = 'zz_records_skip_same'") == "0", "0. nothing was made")
        db.sql("drop function public.tally_read_view();"); m196(db)
    old, old_calls = view(db)
    if not SKIP: db.sql(SQL)
    # 1. records
    print("== 1. records")
    entry = {"id": "e1", "party": "MADE UP TRADERS", "billNo": "7", "amount": 1180, "lines": [{"ledger": "Made Up Purchase", "amt": 1000}]}
    upsert(db, [{"firm_id": F1, "kind": "entry", "id": "e1", "client_id": "c1", "data": entry, "deleted": False}])
    v1 = ver(db, F1, "entry", "e1")
    reordered = {k: entry[k] for k in sorted(entry, reverse=True)}
    upsert(db, [{"firm_id": F1, "kind": "entry", "id": "e1", "client_id": "c1", "data": reordered, "deleted": False}])
    v2 = ver(db, F1, "entry", "e1")
    ok(v2["x"] == v1["x"] and v2["u"] == v1["u"], "1. the same record saved again (its keys in another order): no new row version, updated_at not moved (%s -> %s)" % (v1["x"], v2["x"]))
    db.sql("update records set data = data where firm_id = '%s' and kind = 'entry' and id = 'e1'" % F1, U1)
    ok(ver(db, F1, "entry", "e1")["x"] == v1["x"], "1. a plain update to the same data: nothing written")
    changed = dict(entry, billNo="8")
    upsert(db, [{"firm_id": F1, "kind": "entry", "id": "e1", "client_id": "c1", "data": changed, "deleted": False}])
    v3 = ver(db, F1, "entry", "e1")
    ok(v3["x"] != v1["x"] and json.loads(v3["d"])["billNo"] == "8" and v3["u"] != v1["u"], "1. a real change is written, updated_at moved on")
    upsert(db, [{"firm_id": F1, "kind": "entry", "id": "e1", "client_id": "c2", "data": changed, "deleted": False}])
    ok(ver(db, F1, "entry", "e1")["x"] != v3["x"], "1. the client changed alone is written")
    db.sql("update records set deleted = true, delete_reason = 'removed in the app' where firm_id = '%s' and kind = 'entry' and id = 'e1'" % F1, U1)
    v4 = ver(db, F1, "entry", "e1")
    ok(v4["del"] == "true" and v4["da"], "1. a deletion is written, stamped (sync_guard)")
    db.sql("update records set deleted = true, delete_reason = 'removed in the app' where firm_id = '%s' and kind = 'entry' and id = 'e1'" % F1, U1)
    ok(ver(db, F1, "entry", "e1")["x"] == v4["x"], "1. deleted again with the same reason: nothing written")
    db.sql("update records set deleted = false where firm_id = '%s' and kind = 'entry' and id = 'e1'" % F1, U1)
    v5 = ver(db, F1, "entry", "e1")
    ok(v5["del"] == "false" and v5["ra"], "1. a restore is written, stamped")
    firm = {"firmName": "Made Up & Co", "rules": [1, 2]}
    upsert(db, [{"firm_id": F1, "kind": "firm", "id": "firm", "client_id": "", "data": firm, "deleted": False}])
    vf = ver(db, F1, "firm", "firm")
    upsert(db, [{"firm_id": F1, "kind": "firm", "id": "firm", "client_id": "", "data": {}, "deleted": False}])
    vf2 = ver(db, F1, "firm", "firm")
    ok(json.loads(vf2["d"]) == firm and vf2["x"] == vf["x"], "1. an empty firm record: sync_guard keeps the data (and nothing is written)")
    ok(db.one("select count(*) from sync_refused where kind = 'firm'") == "1", "1. ... the refusal still logged")
    upsert(db, [{"firm_id": F1, "kind": "inbox", "id": "i1", "client_id": "", "data": {"status": "read", "file": "made-up.pdf"}, "deleted": False}])
    vi = ver(db, F1, "inbox", "i1")
    db.sql("update records set data = jsonb_set(data, '{status}', '\"bogus\"') where firm_id = '%s' and kind = 'inbox' and id = 'i1'" % F1, U1)
    ok(json.loads(ver(db, F1, "inbox", "i1")["d"])["status"] == "read" and ver(db, F1, "inbox", "i1")["x"] == vi["x"], "1. an inbox status moved back: inbox_guard keeps it (nothing written)")
    upsert(db, [{"firm_id": F2, "kind": "entry", "id": "e1", "client_id": "c1", "data": entry, "deleted": False}], U2)
    ok(json.loads(ver(db, F1, "entry", "e1")["d"])["billNo"] == "8", "1. another firm's record of the same id is its own")
    # 2. tally_read_view
    print("== 2. tally_read_view")
    new, new_calls = view(db)
    key = lambda o: json.dumps(sorted(o.get("books", []), key=lambda b: b["book"]), sort_keys=True)
    ok(new.get("ok") and key(new) == key(old), "2. the same answer as migration 196's (%d books)" % len(new.get("books", [])))
    books = {b["book"]: b for b in new.get("books", [])}
    ok(sorted(books.get(B[0], {}).get("reask", [])) and len(books[B[0]]["reask"]) >= 2, "2. book 0's held lines of a bridge not serving it are asked again (%s)" % books.get(B[0], {}).get("reask"))
    ok(books.get(B[3], {}).get("reask") == [] and books.get(B[2], {}).get("fetchOn") is True, "2. a book nothing serves asks nothing; fetchOn from the serving computer")
    nlinked = 5
    ok(new_calls == nlinked, "2. the serving bridges worked out once a linked book: %d calls for %d books (196: %d)" % (new_calls, nlinked, old_calls))
    r = raises(lambda: db.one("select public.tally_read_view()")); ok(r and "not allowed" in r, "2. no firm: not allowed")
    o2, _ = view(db, U2); ok(len(o2["books"]) == 1, "2. another firm sees its own book only")
    if not SKIP:
        # 3. grants
        print("== 3. grants")
        g = lambda role, fn: db.one("select has_function_privilege('%s', '%s', 'execute')" % (role, fn))
        ok(all(g(r, "public.records_skip_same()") == "f" for r in ("anon", "authenticated", "service_role")) and db.one("select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname = 'records_skip_same' and a.grantee = 0") == "0",
           "3. records_skip_same: executable by nobody (anon, authenticated, service_role, public)")
        ok(g("authenticated", "public.tally_read_view()") == "t" and g("service_role", "public.tally_read_view()") == "t" and g("anon", "public.tally_read_view()") == "f", "3. tally_read_view: authenticated and service_role, not anon")
        ok(db.one("select prosecdef::text || array_to_string(proconfig, ',') from pg_proc where proname = 'records_skip_same'") == "truesearch_path=public, pg_temp", "3. records_skip_same: security definer, search_path public, pg_temp")
        # 4. twice
        print("== 4. run twice")
        r = raises(lambda: db.sql(SQL)); ok(r is None, "4. a second run: no error (%s)" % (r or "")[-120:])
        ok(db.one("select count(*) from pg_trigger where tgrelid = 'records'::regclass and tgname = 'zz_records_skip_same'") == "1", "4. one trigger")
        ok(db.one("select tgname from pg_trigger where tgrelid = 'records'::regclass and not tgisinternal and tgtype & 16 = 16 order by tgname desc limit 1") == "zz_records_skip_same", "4. it is the last BEFORE UPDATE trigger of records")
        # 5. the indexes file
        print("== 5. indexes")
        for line in open(IX):
            if line.strip() and not line.startswith("--"): db.sql(line)
        ok(db.one("select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname in ('tally_recorder_lines_firm_line', 'tally_recorder_lines_held_bridge') and i.indisvalid") == "2", "5. both indexes built and valid")
        db.sql("insert into tally_recorder_lines (firm_id, book_id, device_id, bridge, line_id, event, state, received_at) select '%s', '%s', '%s', 'go-dddddd', 'X' || g, 'created', 'applied', now() - (g || ' minutes')::interval from generate_series(1, 20000) g; analyze tally_recorder_lines;" % (F1, B[4], D1))
        plan = "\n".join(r["QUERY PLAN"] for r in db.rows("explain select line_id, payload from tally_recorder_lines where firm_id = '%s' and device_id = '%s' and bridge = 'go-cccccc' and state = any('{held,fetching}') and event = any('{created,altered,imported}') and received_at > now() - interval '7 days' order by received_at limit 400" % (F1, D2)))
        ok("tally_recorder_lines_held_bridge" in plan, "5. the beat's held-lines read uses tally_recorder_lines_held_bridge (%s)" % plan.split("\n")[0][:80])
        plan = "\n".join(r["QUERY PLAN"] for r in db.rows("explain select id from tally_recorder_lines where firm_id = '%s' and line_id = any('{L0-1:resolved,L0-2:resolved}')" % F1))
        ok("tally_recorder_lines_firm_line" in plan, "5. the ':resolved' read by line id uses tally_recorder_lines_firm_line")
        r = raises(lambda: db.sql(SQL)); ok(r is None, "5. migration 215 runs again after its indexes (they are its own)")
finally:
    db.stop()
    _sh.rmtree(os.path.join(os.environ["TMPDIR"], "fincom-pg-%d" % db.port), ignore_errors=True)
print("FAILED: %d" % len(fails) if fails else "ALL OK")
sys.exit(1 if fails else 0)
