"""python3 run_ledger_delete_guid.py - (07-Oct-2026, branch next-masterhook, the coordinator's open question 1) how FinCom's
cloud applies a recorder line ledger_deleted, on throwaway PostgreSQL (pg_stand, port 30660 unless PGLD_PORT; never a real
database) built as run_migration60.py builds it (32 -> ... -> 58), then 60 (today's tally_recorder_line).
The rule (unchanged; this test pins it): a ledger is marked deleted ONLY when the line's GUID is the GUID FinCom holds
for that ledger (tally_ledgers.tally_guid). A name-only match is never applied: the line is held with words.
  1. a Stock Item's delete sent as ledger_deleted (2.3.x does so: its line names no type) whose NAME is a ledger's name and
     whose GUID is the stock item's: held, the ledger NOT deleted.
  2. a ledger_deleted line without a GUID, naming a ledger: held, the ledger NOT deleted.
  3. the ledger's own GUID: applied, the ledger marked deleted."""
import os, re, sys, json, hashlib, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql")]
M60 = os.environ.get("M60_FILE") or os.path.join(SQLDIR, "migration-60-recorder-lows.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, D1 = "f79e4bc3-871d-4482-874d-000000000060", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
G = lambda mid: CG + "-%08x" % mid
START = 50000

text = open(M60).read()
db = pg_stand.start(int(os.environ.get("PGLD_PORT") or 30660))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def res(r): return [(x.get("state"), x.get("why") or "") for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else [("error", json.dumps(r)[:400])]
def V(mid, alter, no, d, party):
    return {"guid": G(mid), "alter": alter, "type": "Sales", "no": no, "party": party, "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def L(lid, ev, mid, alter, d="20261003", no=None, guid=None, body=False):
    g = G(mid) if guid is None else guid
    x = {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.3.1", "vch_no": no or str(mid), "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter, "saved_at": "2026-10-06T05:00:00.000Z",
         "vch_date": d, "vch_type": "Sales", "master_id": str(mid), "object_guid": g, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY"}
    if body:
        x["vouchers"] = [V(mid, alter, no or str(mid), "2026-10-03", "Spike Customer")]
        x["lines"] = [[G(mid), "Spike Customer", -118.0, "", None, []], [G(mid), "Sales GST 18%", 100.0, "", None, []], [G(mid), "CGST Output 9%", 9.0, "", None, []], [G(mid), "SGST Output 9%", 9.0, "", None, []]]
    return x
def vrow(mid): return (db.rows("select coalesce(cancelled, false)::text as cancelled, (deleted_at is not null)::text as deleted, alter_id::text as alter_id from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(mid)))) or [None])[0]
def prosrc(): return db.one("select md5(prosrc) from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure")
def can(role): return db.one("select has_function_privilege(%s, 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)', 'execute')" % q(role))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG)))
    r = psql_text(text)
    ok(r.returncode == 0, "60 runs: %s" % r.stderr[-300:])
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, tally_guid) values (%s, %s, 'Cement', 'Sundry Creditors', 0, %s), (%s, %s, 'Store', 'Indirect Expenses', 0, %s)" % (q(B), q(F), q(G(700)), q(B), q(F), q(G(701))))
    def LD(lid, name, guid, mid):
        return {"pc": "NWS144", "user": "TALLY User", "event": "ledger_deleted", "bridge": "go-2.3.2", "ledgers": [], "line_id": lid, "alter_id": None, "saved_at": "2026-10-07T05:00:00.000Z",
                "master_id": str(mid), "object_guid": guid, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY", "name": name, "parent": "Primary"}
    deleted = lambda n: db.one("select (deleted_at is not null)::text from tally_ledgers where book_id = %s and name = %s" % (q(B), q(n)))
    print("== 1. a stock item's delete under a ledger's name")
    r = res(apply([LD("d-si", "Cement", G(2592), 2592)]))
    ok(r[0][0] == "held" and deleted("Cement") == "false", "1. held, the ledger Cement not deleted (%s)" % r)
    print("== 2. no GUID")
    r = res(apply([LD("d-ng", "Store", None, 2593)]))
    ok(r[0][0] == "held" and deleted("Store") == "false", "2. held, the ledger Store not deleted (%s)" % r)
    print("== 3. the ledger's own GUID")
    r = res(apply([LD("d-ok", "Cement", G(700), 700)]))
    ok(r[0][0] == "applied" and deleted("Cement") == "true", "3. applied, Cement marked deleted (%s)" % r)
finally:
    db.stop()
print("\nFAILED: %d" % len(fails) if fails else "\nALL OK")
raise SystemExit(1 if fails else 0)
