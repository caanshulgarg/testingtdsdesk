"""python3 run_migration66.py - migration-66-recorder-masters (07-Oct-2026, branch next-masterhook: the add-on's master
forms, heads only). On throwaway PostgreSQL (pg_stand, port 30620 unless PG66_PORT; never a real database), with pg_stand's
stand-in tables, then 66 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from', no drop, truncate or
     change of an existing table, no real database named; one new table, one new function (security definer, search_path
     public, pg_temp; executed by service_role only).
  1. a master_created and a master_altered line are kept with their heads; the same line again (another bridge): 'duplicate',
     kept once.
  2. a line of another event, or without a line id: 'failed' with words, not kept.
  3. another firm's book: refused, nothing kept.
  4. the firm reads its own rows only (RLS); nobody inserts directly.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M66 = os.environ.get("M66_FILE") or os.path.join(SQLDIR, "migration-66-recorder-masters.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
F, F2, OWNER, OTHER = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444"
B, B2, D1 = "f79e4bc3-871d-4482-874d-000000000062", "f79e4bc3-871d-4482-874d-000000000063", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"

text = open(M66).read() if os.path.exists(M66) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M66))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. one transaction")
ok(low.count("delete from") == 0 and not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\s+(table\s+)?public", low), "0. no delete, drop or truncate")
alters = re.findall(r"alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)", low)
ok(set(alters) <= {"tally_recorder_masters"}, "0. no existing table changed (alter table only on the new one: %s)" % alters)
ok(re.findall(r"create table if not exists public\.(\w+)", text) == ["tally_recorder_masters"], "0. one new table")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_recorder_masters_save"], "0. one new function (%s)" % FNS)
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")

db = pg_stand.start(int(os.environ.get("PG66_PORT") or 30620))
def run(sql): return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def save(lines, firm=F, book=B): return j("select tally_recorder_masters_save(%s, %s, %s, %s)::text" % (q(firm), q(book), q(D1), js(lines)))
def L(lid, ev, mt, name, mid="", alter=None, guid=""):
    return {"line_id": lid, "event": ev, "master_type": mt, "name": name, "parent": "Primary", "object_guid": guid, "master_id": mid, "alter_id": alter,
            "saved_at": "2026-10-07T05:00:00.000Z", "pc": "NWS144", "user": "TALLY User", "company_guid": CG, "company": "GARG SHEKHAR & COMPANY", "bridge": "go-x"}
try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      insert into firms values (%(F)s, 'Garg Shekhar & Company'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31'),
        (%(B2)s, %(F2)s, 'c9', 'OTHER', '2025-04-01', '2025-03-31');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "X": q(OTHER), "B": q(B), "B2": q(B2)})
    for i in (1, 2):
        r = run(text)
        ok(r.returncode == 0, "66 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    ok(db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.tally_recorder_masters_save(uuid, uuid, uuid, jsonb)'::regprocedure") == "true search_path=public, pg_temp", "0. security definer, search_path public, pg_temp")
    can = lambda r: db.one("select has_function_privilege(%s, 'public.tally_recorder_masters_save(uuid, uuid, uuid, jsonb)', 'execute')::text" % q(r))
    ok(can("service_role") == "true" and can("anon") == "false" and can("authenticated") == "false", "0. executed by service_role only (%s)" % [can(r) for r in ("service_role", "anon", "authenticated")])

    print("== 1. kept, heads only; the same line again: duplicate")
    r = save([L("m-1", "master_created", "Stock Item", "PD Item 1"), L("m-2", "master_altered", "Unit", "Nos", "2563", 41, CG + "-00000a03")])
    ok([x["state"] for x in r.get("results", [])] == ["kept", "kept"], "1. two lines kept (%s)" % r)
    row = db.rows("select event, master_type, name, parent, coalesce(object_guid, '') as g, master_id, coalesce(alter_id::text, '') as a, tally_user, pc, company_guid, client_id from tally_recorder_masters where book_id = %s order by id" % q(B))
    ok(len(row) == 2 and row[0]["event"] == "master_created" and row[0]["master_type"] == "Stock Item" and row[0]["g"] == "" and row[0]["a"] == "" and row[0]["client_id"] == "c1"
       and row[1]["master_type"] == "Unit" and row[1]["g"] == CG + "-00000a03" and row[1]["master_id"] == "2563" and row[1]["a"] == "41" and row[1]["tally_user"] == "TALLY User", "1. the rows (%s)" % row)
    r = save([L("m-2", "master_altered", "Unit", "Nos", "2563", 41)])
    ok([x["state"] for x in r.get("results", [])] == ["duplicate"] and db.one("select count(*) from tally_recorder_masters") == "2", "1. sent again: duplicate, kept once (%s)" % r)

    print("== 2. not a master line")
    r = save([L("v-1", "created", "", "x"), L("", "master_created", "Unit", "Box")])
    ok([(x["state"], bool(x["why"])) for x in r.get("results", [])] == [("failed", True), ("failed", True)] and db.one("select count(*) from tally_recorder_masters") == "2", "2. failed with words, not kept (%s)" % r)

    print("== 3. another firm's book")
    r = save([L("m-3", "master_created", "Godown", "PD Godown A")], firm=F, book=B2)
    ok(r.get("ok") is False and db.one("select count(*) from tally_recorder_masters") == "2", "3. refused (%s)" % r)

    print("== 4. RLS")
    db.sql("insert into tally_recorder_masters (firm_id, book_id, line_id, event) values (%s, %s, 'm-o', 'master_created')" % (q(F2), q(B2)))
    db.sql("grant usage on schema auth to authenticated; grant select on members to authenticated")     # the stand's my_firm(), as Supabase's
    mine = db.rows("set role authenticated; select line_id from tally_recorder_masters order by line_id", OWNER)
    ok([x["line_id"] for x in mine] == ["m-1", "m-2"], "4. the firm reads its own rows only (%s)" % mine)
    try:
        db.sql("set role authenticated; insert into tally_recorder_masters (firm_id, book_id, line_id, event) values (%s, %s, 'x', 'master_created')" % (q(F), q(B)), OWNER); w = False
    except RuntimeError: w = True
    ok(w, "4. a signed-in person cannot insert")
finally:
    db.stop()
print("\nFAILED: %d" % len(fails) if fails else "\nALL OK")
raise SystemExit(1 if fails else 0)
