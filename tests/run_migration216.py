"""python3 tests/run_migration216.py - server/tally-cloud/migration-216-beat-light.sql (DRAFT, not applied anywhere), on a
throwaway PostgreSQL (pg_stand, port 55716 unless PG216_PORT; data under /tmp/fincom-m216 unless PG216_TMP; never a real
database), with migration 146's tally_work_claim and the columns of tally_recorder_lines as on staging. Made-up lines only.
  0. the name guard: a tally_work_claim that is not 146's, or a tally_held_light of something else: stopped, nothing changed
  1. tally_held_light: this bridge's own held and fetching lines (any event, any age; not another bridge's, not applied),
     the followed books' held lines (created/altered/imported, 30 days), the ":resolved" rows of both; light columns only
     (no body or payload beyond "has entries" and waitLedgers); the same fingerprint twice; seen = fp: {same} and no rows;
     a line changing, a line coming, a month locked: a new fingerprint; only the service role
  2. tally_work_claim: a claim this bridge holds with over half its time left is kept as it is (no new row version) and
     still its; renewed once under half; another bridge never takes a live claim; an expired one it takes
  3. grants: tally_held_light and tally_work_claim the service role's only
  4. run twice: no error
M216_SKIP=1: 2 on migration 146's tally_work_claim (the claim written again at every call: it fails)"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ["TMPDIR"] = os.environ.get("PG216_TMP") or "/tmp/fincom-m216"
import shutil as _sh; os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o755); _sh.chown(os.environ["TMPDIR"], "postgres", "postgres")
if not os.access("/tmp", os.W_OK) or os.stat("/tmp").st_mode & 0o002 == 0: os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
import pg_stand
ROOT = os.path.dirname(HERE)
M = os.environ.get("M216_FILE") or os.path.join(ROOT, "server", "tally-cloud", "migration-216-beat-light.sql")
SKIP = os.environ.get("M216_SKIP") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def raises(fn):
    try: fn(); return None
    except RuntimeError as e: return str(e)
F = "f1000000-0000-0000-0000-000000000216"
DA, DB = "d1000000-0000-0000-0000-000000000216", "d2000000-0000-0000-0000-000000000216"
GA, GB = "go-aaaaaa216216", "go-bbbbbb216216"
B1, B2, B3 = "b1000000-0000-0000-0000-000000000216", "b2000000-0000-0000-0000-000000000216", "b3000000-0000-0000-0000-000000000216"
SR = "set fincom.role = 'service_role';\n"
TABLES = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('fincom.role', true), '') $$;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table tally_recorder_lines (id bigserial primary key, firm_id uuid, client_id text, book_id uuid, device_id uuid, bridge text, pc text, tally_user text, company_guid text,
  company text, line_id text, event text, object_guid text, master_id text, alter_id bigint, vch_type text, vch_no text, vch_date date, saved_at timestamptz,
  received_at timestamptz default now(), applied_at timestamptz, state text, held_why text, ledgers jsonb, payload jsonb, body jsonb, save_ms numeric, released_at timestamptz, released_by uuid);
create table tally_month_locks (book_id uuid, month date, unlocked_at timestamptz);
create table tally_links (firm_id uuid, book_id uuid, state text);
create table tally_bridge_ids (firm_id uuid, bridge_id text, device_id uuid);
create or replace function tally_bridge_device(p_firm uuid, p_bridge text) returns uuid language sql stable as $$ select device_id from tally_bridge_ids where firm_id = p_firm and bridge_id = p_bridge $$;
"""
def m146_claims(db):
    s = open(os.path.join(ROOT, "server", "tally-cloud", "migration-146-reads-follow-company.sql")).read()
    i = s.index("create table if not exists public.tally_work_claims"); j = s.index(";", s.index("create index if not exists tally_work_claims_live")) + 1
    db.sql(s[i:j])
    i = s.index("create or replace function public.tally_work_claim("); j = s.index("end $function$;", i) + len("end $function$;")
    db.sql(s[i:j])
BIG = {"vouchers": [{"guid": "g-%d" % i, "narr": "MADE UP " * 40} for i in range(30)]}
def seed(db):
    rows = []
    def add(lid, dev, br, book, ev, st, days, why="", body=None, payload=None):
        rows.append("('%s', '%s', '%s', '%s', 'MADE UP CO', 'cg-1', '%s', '%s', '101', 'Sales', '7', '2026-10-06', now() - interval '%s days', '%s', '%s', %s, %s)" % (
            F, book, dev, br, lid, ev, days, st, why.replace("'", "''"), "'%s'::jsonb" % json.dumps(body) if body is not None else "null", "'%s'::jsonb" % json.dumps(payload) if payload is not None else "null"))
    add("O1", DA, GA, B1, "created", "held", 1, "waiting for the ledger X", BIG, {"waitLedgers": ["MADE UP LEDGER"], "fid": "B-1", "big": "x" * 3000})
    add("O2", DA, GA, B1, "altered", "fetching", 40, "the entry was not read from Tally", None, {"fid": "B-2"})
    add("O3", DA, GA, B1, "deleted", "held", 2)
    add("O4", DA, GA, B1, "created", "applied", 1)                       # applied: not listed
    add("O5", DA, "go-cccccc216216", B1, "created", "held", 1)          # another bridge of the same key: not its own
    add("O2:resolved", DA, GA, B1, "altered", "held", 1, "the entry's details from Tally are incomplete", None)
    add("F1", DB, GB, B2, "created", "held", 3)                          # another computer's, a followed book
    add("F2", DB, GB, B2, "created", "held", 31)                         # older than 30 days
    add("F3", DB, GB, B2, "deleted", "held", 3)                          # a delete: not followed
    add("F4", DB, GB, B3, "created", "held", 3)                          # a book not followed
    add("F1:resolved", DB, GB, B2, "created", "applied", 2, "", BIG)
    db.sql("insert into tally_recorder_lines (firm_id, book_id, device_id, bridge, company, company_guid, line_id, event, master_id, vch_type, vch_no, vch_date, received_at, state, held_why, body, payload) values " + ", ".join(rows) + ";")
def light(db, seen="", books=(B2,), dev=DA, br=GA, role=True):
    return json.loads(db.one(("" if not role else SR) + "select public.tally_held_light('%s', '%s', '%s', array[%s]::uuid[], '%s')::text" % (F, dev, br, ",".join("'%s'" % b for b in books), seen)))
def claim(db, units, dev=DA, br=GA, ttl=600):
    return json.loads(db.one(SR + "select to_json(public.tally_work_claim('%s', '%s', 'held', array[%s]::text[], '%s', '%s', %d))::text" % (F, B2, ",".join("'%s'" % u for u in units), dev, br, ttl)))
def xmin(db, unit): return db.one("select xmin::text from tally_work_claims where book_id = '%s' and kind = 'held' and unit = '%s'" % (B2, unit))

db = pg_stand.start(int(os.environ.get("PG216_PORT") or 55716))
try:
    SQL = open(M).read()
    db.sql(TABLES); m146_claims(db); seed(db)
    db.sql("insert into firms (id, name) values ('%s', 'Made Up Firm');" % F)
    db.sql("insert into tally_links values ('%s', '%s', 'linked'); insert into tally_bridge_ids values ('%s', '%s', '%s'), ('%s', '%s', '%s');" % (F, B2, F, GA, DA, F, GB, DB))
    if not SKIP:
        print("== 0. guards")
        db.sql("create or replace function public.tally_held_light(p_firm uuid, p_device uuid, p_bridge text, p_books uuid[], p_seen text) returns jsonb language sql as $$ select '{}'::jsonb $$;")
        r = raises(lambda: db.sql(SQL)); ok(r and "tally_held_light" in r and "Nothing was changed" in r, "a tally_held_light of something else: stopped")
        db.sql("drop function public.tally_held_light(uuid, uuid, text, uuid[], text);")
        db.sql("create or replace function public.tally_work_claim(p_firm uuid, p_book uuid, p_kind text, p_units text[], p_device uuid, p_bridge text, p_ttl integer) returns text[] language sql as $$ select '{}'::text[] $$;")
        r = raises(lambda: db.sql(SQL)); ok(r and "changed since migration 146" in r, "a tally_work_claim that is not 146's: stopped")
        ok(db.one("select count(*) from pg_proc where proname = 'tally_held_light'") == "0", "nothing was made")
        m146_claims(db)
        db.sql(SQL)
        print("== 1. tally_held_light")
        a = light(db)
        own = {r["line_id"]: r for r in a["own"]}; fol = {r["line_id"] for r in a["follow"]}; res = {r["line_id"]: r for r in a["resolved"]}
        ok(a["ok"] and not a["same"] and set(own) == {"O1", "O2", "O3", "O2:resolved"}, "own: this bridge's held and fetching lines, any event and age (%s)" % sorted(own))
        ok(fol == {"F1"}, "followed: the book's created/altered/imported held lines of 30 days (%s)" % sorted(fol))
        ok(set(res) == {"O2:resolved", "F1:resolved"}, "the ':resolved' rows of both, any state (%s)" % sorted(res))
        o1 = own["O1"]
        ok(o1["body"] == {"vouchers": [0]} and o1["payload"] == {"waitLedgers": ["MADE UP LEDGER"]} and own["O2"]["body"] is None and own["O2"]["payload"] is None,
           "light: a body as 'has entries' only, a payload as its waitLedgers only")
        ok(res["F1:resolved"]["body"] == {"vouchers": [0]} and len(json.dumps(a)) < 6000, "no body or payload text comes (%d bytes in all)" % len(json.dumps(a)))
        ok(set(o1) >= {"line_id", "company", "company_guid", "event", "master_id", "vch_type", "vch_no", "vch_date", "book_id", "received_at", "bridge", "device_id", "object_guid", "held_why", "state"},
           "each line with the columns the beat's rules read")
        ok([r["line_id"] for r in a["own"]] == sorted(own, key=lambda k: own[k]["received_at"]), "oldest first")
        b = light(db)
        ok(b["fp"] == a["fp"], "the same fingerprint twice")
        c = light(db, seen=a["fp"])
        ok(c == {"ok": True, "same": True, "fp": a["fp"]}, "seen = the fingerprint: {same} and nothing else (%s)" % list(c))
        db.sql("update tally_recorder_lines set held_why = 'waiting: FinCom asks again at 10:42' where line_id = 'O3'")
        f2 = light(db)["fp"]; ok(f2 != a["fp"], "a line's words changed: a new fingerprint")
        db.sql("update tally_recorder_lines set state = 'applied' where line_id = 'F1'")
        f3 = light(db)["fp"]; ok(f3 != f2, "a followed line applied: a new fingerprint")
        db.sql("insert into tally_month_locks values ('%s', '2026-10-01', null)" % B1)
        f4 = light(db)["fp"]; ok(f4 != f3, "a month locked: a new fingerprint")
        db.sql("insert into tally_recorder_lines (firm_id, book_id, device_id, bridge, line_id, event, state) values ('%s', '%s', '%s', '%s', 'O9', 'created', 'held')" % (F, B1, DA, GA))
        f5 = light(db)["fp"]; ok(f5 != f4, "a new held line: a new fingerprint")
        r = raises(lambda: light(db, role=False)); ok(r and "not allowed" in r, "not the service role: not allowed")
        ok(light(db, br="not-a-bridge") == {"ok": False}, "a bridge id not of the form: nothing")
    print("== 2. tally_work_claim")
    got = claim(db, ["L1", "L2"]); x1 = xmin(db, "L1")
    ok(sorted(got) == ["L1", "L2"], "claimed (%s)" % got)
    got = claim(db, ["L1", "L2"]); x2 = xmin(db, "L1")
    ok(sorted(got) == ["L1", "L2"], "asked again at the next beat: still this bridge's (%s)" % got)
    ok(x2 == x1, "...and not written again (row version %s -> %s)" % (x1, x2))
    ok(claim(db, ["L1"], dev=DB, br=GB) == [], "another bridge does not take a live claim")
    db.sql("update tally_work_claims set until = now() + interval '200 seconds' where unit = 'L1'"); x3 = xmin(db, "L1")
    ok(claim(db, ["L1"]) == ["L1"] and xmin(db, "L1") != x3 and db.one("select until > now() + interval '590 seconds' from tally_work_claims where unit = 'L1'") == "t", "under half its time left: renewed")
    db.sql("update tally_work_claims set until = now() - interval '1 second' where unit = 'L2'")
    ok(claim(db, ["L2"], dev=DB, br=GB) == ["L2"], "an expired claim: another bridge takes it")
    if not SKIP:
        print("== 3. grants")
        g = lambda role, fn: db.one("select has_function_privilege('%s', '%s', 'execute')" % (role, fn))
        for fn in ("public.tally_held_light(uuid, uuid, text, uuid[], text)", "public.tally_work_claim(uuid, uuid, text, text[], uuid, text, integer)"):
            ok(g("service_role", fn) == "t" and g("anon", fn) == "f" and g("authenticated", fn) == "f", fn.split("(")[0] + ": the service role only")
        ok(db.one("select prosecdef::text || array_to_string(proconfig, ',') from pg_proc where proname = 'tally_held_light'") == "truesearch_path=public, pg_temp", "tally_held_light: security definer, search_path public, pg_temp")
        print("== 4. twice")
        r = raises(lambda: db.sql(SQL)); ok(r is None, "a second run: no error (%s)" % (r or "")[-120:])
finally:
    db.stop()
    _sh.rmtree(os.path.join(os.environ["TMPDIR"], "fincom-pg-%d" % db.port), ignore_errors=True)
print("FAILED: %d" % len(fails) if fails else "ALL OK")
sys.exit(1 if fails else 0)
