"""python3 run_migration60.py - migration-60-recorder-lows (06-Oct-2026, FinCom Bridge 2.3.1: the owner's report of 08:05, "a
delete or cancel of an entry that was never in FinCom settles as nothing to remove", and the migration-50 review's R3-L1, R3-L2,
R3-L3). On throwaway PostgreSQL (pg_stand, port 30600 unless PG60_PORT; never a real database), built 32 -> ... -> 55 -> 56 in
staging's order, then 60 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from' anywhere, add-only, no real
     database named; one function, tally_recorder_line: 56's text with only lines marked "60" changed; security definer,
     search_path public, pg_temp; granted to nobody; run twice, its text is the same.
  1. THE OWNER: a delete and a cancel of an entry FinCom's copy never had: 'applied', "nothing to remove"; no entry made.
  2. R3-L1: such a line with no AlterID stays held (in plain words); a delete under the placeholder GUID is held, twice
     without an error (before 60 the second broke the call on applied_once).
  3. R3-L2: a create late below a cancel applied for its GUID: applied and cancelled again; below a delete: 'stale', no entry.
  4. R3-L3: a GUID-less delete with no date promises no Day Book; with a date it names the day.
  5. unchanged: a delete of an entry the copy holds is applied (the entry deleted); the same unknown delete twice: 'duplicate'.
Prints md5(prosrc) of tally_recorder_line before and after 60.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, hashlib, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql")]
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

text = open(M60).read() if os.path.exists(M60) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M60))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\b", low) and "create table" not in low, "0. add-only (no drop, truncate, table change)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_recorder_line"], "0. one function replaced: tally_recorder_line (%s)" % FNS)
m56 = open(os.path.join(SQLDIR, "migration-56-keep-fields.sql")).read()
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
L56 = block(m56, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
L60 = block(text, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
hunks, cur = [], None
for d in difflib.unified_diff(L56.split("\n"), L60.split("\n"), lineterm="", n=0):
    if d.startswith("@@"): cur = []; hunks.append(cur)
    elif cur is not None and d[:1] in "+-" and not d.startswith(("+++", "---")): cur.append(d)
unmarked = [h for h in hunks if not any(re.search(r"--.*\b60\b", x) for x in h if x.startswith("+"))]
ok(L56 != L60 and not unmarked, "0. tally_recorder_line is 56's text but %d changed places, each marked '60' (unmarked: %s)" % (len(hunks), unmarked[:1]))
ok(L60.rstrip().endswith("revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;"), "0. granted to nobody, as in 56")

db = pg_stand.start(int(os.environ.get("PG60_PORT") or 30600))
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
    before = prosrc()
    print("  tally_recorder_line prosrc md5 under 56: %s" % before)
    for i in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "60 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
        if i == 1: after1 = prosrc()
    after = prosrc()
    print("  tally_recorder_line prosrc md5 under 60: %s" % after)
    ok(after != before and after == after1, "0. 60 replaces the line's text, the same both runs")
    ok(db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure") == "true search_path=public, pg_temp", "0. security definer, search_path public, pg_temp")
    ok(all(can(r) in ("f", "false", False) for r in ("anon", "authenticated", "service_role")), "0. granted to nobody (%s)" % [can(r) for r in ("anon", "authenticated", "service_role")])

    print("== 1. the owner: an entry FinCom never had")
    r = res(apply([L("o-del", "deleted", 900, 60001), L("o-can", "cancelled", 901, 60002)]))
    ok([x[0] for x in r] == ["applied", "applied"] and r[0][1].startswith("nothing to remove") and "nothing to delete" in r[0][1] and "nothing to cancel" in r[1][1], "1. a delete and a cancel of an entry never in FinCom: applied, 'nothing to remove' (%s)" % r)
    ok(vrow(900) is None and vrow(901) is None, "1. no entry made for them")
    r = res(apply([L("o-del-again", "deleted", 900, 60001)]))
    ok(r[0][0] == "duplicate", "5. the same delete again (another computer): 'duplicate' (%s)" % r)

    print("== 2. R3-L1")
    r = res(apply([L("n-alt", "deleted", 902, None)]))
    ok(r[0][0] == "held" and "has no AlterID" in r[0][1], "2. a delete of an entry never in FinCom with no AlterID: held, in plain words (%s)" % r)
    r1 = res(apply([L("ph-1", "deleted", 0, 60003, guid=CG + "-00000000")]))
    r2 = res(apply([L("ph-2", "deleted", 0, 60003, guid=CG + "-00000000")]))
    ok(r1[0][0] == "held" and r2[0][0] == "held" and "placeholder" in r1[0][1], "2. a placeholder delete, twice: held both times, no error (%s %s)" % (r1, r2))

    print("== 3. R3-L2")
    r = res(apply([L("c-can", "cancelled", 903, 60010)]))
    ok(r[0][0] == "applied", "3. a cancel first (nothing to cancel): applied (%s)" % r)
    r = res(apply([L("c-cre", "created", 903, 60005, body=True)]))
    v = vrow(903)
    ok(r[0][0] == "applied" and "then cancelled" in r[0][1] and v is not None and v["cancelled"] == "true" and v["deleted"] == "false",
       "3. its create, late and below the cancel: applied, then cancelled again (%s %s)" % (r, v))
    r = res(apply([L("d-del", "deleted", 904, 60020)]))
    r2 = res(apply([L("d-cre", "created", 904, 60015, body=True)]))
    ok(r[0][0] == "applied" and r2[0][0] == "stale" and vrow(904) is None, "3. below a delete: 'stale', no entry (%s %s %s)" % (r, r2, vrow(904)))

    print("== 4. R3-L3")
    r = res(apply([L("g-nodate", "deleted", 905, 60030, d="", guid="")]))
    ok(r[0][0] == "held" and "no date on the line either" in r[0][1] and "Day Book" not in r[0][1], "4. GUID-less, no date: held, no Day Book promised (%s)" % r)
    r = res(apply([L("g-date", "deleted", 906, 60031, guid="")]))
    ok(r[0][0] == "held" and "uploading the Day Book for 03-Oct-2026" in r[0][1], "4. GUID-less with a date: names the day (%s)" % r)

    print("== 5. unchanged")
    r = res(apply([L("k-cre", "created", 907, 60040, body=True)]))
    r2 = res(apply([L("k-del", "deleted", 907, 60041)]))
    v = vrow(907)
    ok(r[0][0] == "applied" and r2[0][0] == "applied" and "nothing to remove" not in r2[0][1] and v and v["deleted"] == "true", "5. a delete of an entry the copy holds: applied, deleted (%s %s %s)" % (r, r2, v))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
