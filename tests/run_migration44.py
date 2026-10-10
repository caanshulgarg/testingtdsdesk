"""python3 run_migration44.py - migration-44-recorder (04-Oct-2026, phase 2: the Tally change recorder). Staging's order on a
throwaway PostgreSQL (pg_stand): 32 -> 33 -> 35 -> 34 (first) -> 36b -> 37 -> 36 -> 38 -> 39 -> 40 -> 41 -> 42 -> 43, made-up
rows, then 44 twice. First, run_migration43.py's own checks are run again with 44 applied right after 43 (its file and rows
untouched: a copy of its text whose psql_file runs 44 after each run of 43), so every rule of 43's tally_ingest_day (marking,
empty reads, the cap, tally_days) still holds on 44's text (owner item 95: one entry path). Then:
(1) tally_ingest_entries(book, vouchers, lines): the service role's; tally_ingest_day calls it; a voucher moved between days
rebuilds both days; (2) tally_ingest_delete(book, guid, alter, cancel, source): deleted (deleted_at) or cancelled (cancelled,
not deleted), versions with lines kept first, the day's cache rebuilt, an older AlterID stale, an unknown GUID held;
(3)/(4) tally_recorder_lines and tally_recorder_apply(firm, book, device, lines): created / altered / imported through the
entry path, a version per AlterID, the same change twice (or from a second computer) 'duplicate' and applied once, an older
AlterID 'stale', a FinCom posting coming back matched by its id (origin fincom, tally_post_ids.matched_at, one row), a ledger
rename through tally_ledger_rename (the lines follow), ledger_created / ledger_altered held for the next ledger list,
ledger_deleted soft through the guard (held when the guard keeps it), an unknown event or a bad line 'failed' without failing
the batch; (5) tally_month_locks, the owner's tally_month_lock / tally_month_unlock / tally_recorder_release_held: a line in a
locked month held, a day of a locked month refused 'month locked' storing nothing (the day path too), the release applying it
after the unlock; (6) tally_tieouts and tally_tieout_save (members save, the owner ticks); owner item 8 (an entry uploaded first and
recorded after, and the reverse: one row per book and Tally GUID, versions kept, the same AlterID 'duplicate', no GUID held);
the starting point (tally_start_point: kept once per book on tally_sync_cursor, reset with needs_baseline by a new GUID);
a PC without the add-on (tally_sync_cursor.recorder_max_alter / gap, tally_recorder_gap_check: up to N changes not received since the
last match, cleared by the lines or an uploaded day, a restore needs_baseline never a gap; tally_recorder_silent: Tally open
today and no line for a working day, Mon-Sat 09:00-19:00 IST); (7) the ten functions of the audit given a fixed search_path by ALTER FUNCTION (their text unchanged)
and tally_device_post_settings' '(% given)'; (8) every table created by 32-44 has row level security, every function of
32-44 a fixed search_path; RLS: another firm sees no row. The file runs twice and a third time over used tables.
RED (before 44): run with SKIP44=1: the checks of the new functions and tables fail."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql")]
M44 = os.environ.get("M44_FILE") or os.path.join(SQLDIR, "migration-44-recorder.sql")
SKIP44 = os.environ.get("SKIP44") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]

# ---------------------------------------------------------------- 0. run_migration43.py's checks with 44 applied after 43
if os.environ.get("SKIP43RUN") != "1":
    print("== run_migration43.py with migration-44 applied after 43 (43's day rules on 44's tally_ingest_day)")
    p43 = os.path.join(HERE, "run_migration43.py"); src = open(p43).read()
    hook = "db = pg_stand.start(55450)\n"
    assert hook in src, "run_migration43.py changed: the hook line is gone"
    src = src.replace(hook, hook + "_pf = None\n", 1)
    src = src.replace("def as_user(uid, stmt):", "_pf, psql_file = psql_file, (lambda path: (lambda r: _pf(%r) if r.returncode == 0 and path == M43 and %r else r)(_pf(path)))\ndef as_user(uid, stmt):" % (M44, not SKIP44), 1)
    r = subprocess.run([sys.executable, "-"], input="__file__ = %r\n" % p43 + src, capture_output=True, text=True)
    out = r.stdout + r.stderr
    n_ok, n_fail = out.count("  ok   "), out.count("  FAIL ")
    for l in out.splitlines():
        if "FAIL" in l or "Traceback" in l or "Error" in l: print("    | " + l)
    ok(r.returncode == 0 and n_fail == 0 and n_ok >= 60, "0. run_migration43.py passes with 44 applied after 43 (%d ok, %d failed)" % (n_ok, n_fail))

SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
SCHEMA_X = part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X")
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333"
B1, B9 = "11111111-1111-1111-1111-111111111111", "19999999-1111-1111-1111-111111111111"
B2, B3 = "12222222-1111-1111-1111-111111111111", "13333333-1111-1111-1111-111111111111"
D1, D2, D3 = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002", "d3000000-0000-0000-0000-000000000003"
GROUPS = [["Current Assets", ""], ["Cash-in-hand", "Current Assets"], ["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]
LEDGERS = [["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"], ["Capital", "Capital Account", "1000"], ["Old Unused", "Indirect Expenses", "0"]]
def V(guid, alter, day=None, narr="", cancel=False, no=None, fid=None):
    v = {"guid": guid, "alter": alter, "type": "Sales", "no": no or guid.upper(), "party": "", "narr": narr, "cancel": cancel, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": fid}
    if day: v["day"] = day
    return v
L = lambda guid, ledger, amount, bills=None: [guid, ledger, amount, "", None, bills or []]
def RL(lid, event, guid, alter, day=None, vouchers=None, lines=None, **kw):
    x = {"line_id": lid, "event": event, "saved_at": "2026-10-04T10:00:00+05:30", "pc": "NWS144", "user": "anshul", "company_guid": "cg-1", "company": "ZZ CO", "bridge": "go-1",
         "object_guid": guid, "master_id": "77", "alter_id": alter, "vch_type": "Sales", "vch_no": "S1", "vch_date": day, "ledgers": [{"name": "Sales", "guid": "g-sales"}], "save_ms": 12.5}
    if vouchers is not None: x["vouchers"] = vouchers
    if lines is not None: x["lines"] = lines
    x.update(kw); return x
def entry(lid, event, guid, alter, day, amt=10, narr="", fid=None, ledger="Sales", **kw):
    return RL(lid, event, guid, alter, day, [V(guid, alter, day, narr, fid=fid)], [L(guid, ledger, amt), L(guid, "Cash", -amt)], **kw)
db = pg_stand.start(55451)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def as_user(uid, stmt):
    try: return True, db.one("set fincom.role = 'authenticated'; set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def j(s):
    try: return json.loads(db.one(s) or "{}")
    except RuntimeError as e: return {"_error": str(e)[-300:]}
def jn(s):
    try: return db.one(s)
    except RuntimeError as e: return "ERROR " + str(e)[-200:]
apply = lambda lines, dev=D1, book=B1: j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(book), q(dev), js(lines)))
st = lambda r: {x.get("line_id"): x.get("state") for x in (r.get("results") or [])}
why = lambda r, lid: next((x.get("why") or "" for x in (r.get("results") or []) if x.get("line_id") == lid), "")
vrow = lambda g, b=B1: (db.rows("select day, alter_id, deleted_at, cancelled, origin, fincom_id, narration from tally_vouchers where book_id = %s and guid = %s" % (q(b), q(g))) or [{}])[0]
nvers = lambda g: int(db.one("select count(*) from tally_voucher_versions where book_id = %s and tally_guid = %s" % (q(B1), q(g))))
cache = lambda d, led="Sales": db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and day = %s and ledger = %s and merged_into is null" % (q(B1), q(d), q(led)))
nlines = lambda: int(db.one("select count(*) from tally_recorder_lines"))
fdef = lambda sig: jn("select pg_get_functiondef(%s::regprocedure)" % q("public." + sig)) or ""
AUDIT = ["tally_fincom_id(jsonb)", "tally_post_bool(text)", "tally_post_accept_text(text)", "tally_post_id_match(text,text,text)", "tally_post_result_accepted(jsonb)", "tally_post_result_taken(jsonb)",
         "tally_post_result_confirmed(jsonb)", "tally_post_job_settle(text,boolean,jsonb,jsonb,jsonb)", "tally_ledger_marks_frozen()", "tally_control_kept()"]
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(T)s, %(F2)s, 'Them', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B1)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%(B9)s, %(F2)s, 'c9', 'THEIR CO', '2026-04-01', '2026-03-31'), (%(B2)s, %(F)s, 'c2', 'ZZ TWO', '2026-04-01', '2026-03-31'), (%(B3)s, %(F)s, 'c3', 'ZZ THREE', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.2.0'), (%(D2)s, %(F)s, 'NWS145', 'h2', '2.2.0'), (%(D3)s, %(F2)s, 'THEIRS', 'h3', '2.2.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "T": q(OTHER), "B1": q(B1), "B9": q(B9), "B2": q(B2), "B3": q(B3), "D1": q(D1), "D2": q(D2), "D3": q(D3)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(B1), js(LEDGERS), js(GROUPS)))
    db.sql("update tally_ledgers set tally_guid = 'g-' || lower(replace(name, ' ', '-')) where book_id = %s" % q(B1))
    # a day read: two entries on 2026-05-02 (one with Rent), one on 2026-06-05
    j("select tally_ingest_day(%s, '2026-05-02', %s, %s, 2, 5, 100)::text" % (q(B1), js([V("d1", 5), V("d2", 5)]), js([L("d1", "Sales", 10), L("d1", "Cash", -10), L("d2", "Rent", -7), L("d2", "Cash", 7)])))
    j("select tally_ingest_day(%s, '2026-06-05', %s, %s, 1, 5, 100)::text" % (q(B1), js([V("j1", 5)]), js([L("j1", "Sales", 30), L("j1", "Cash", -30)])))
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values ('00000001-0000-0000-0000-000000000000', %s, 'c1', 'ZZ CO', %s, 1, 'done')"
           % (q(F), q(json.dumps({"vouchers": [{"id": "P1", "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:P1</NARRATION></VOUCHER>"}]}))))
    sigs = lambda: {x["sig"]: x["src"] for x in db.rows("select p.oid::regprocedure::text as sig, md5(prosrc) as src from pg_proc p where pronamespace = 'public'::regnamespace")}
    src_before = sigs()
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_days", "tally_post_ids", "tally_post_jobs", "tally_ledgers", "tally_devices", "tally_voucher_versions", "tally_ledger_day"]}
    before = counts()
    if SKIP44: print("  (SKIP44: migration-44 not applied; the checks below are expected to FAIL)")
    else:
        for i in (1, 2):
            r = psql_file(M44); ok(r.returncode == 0, "migration-44 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on without the migration")
        ok(counts() == before, "nothing deleted or added by the migration (%s)" % {k: (before[k], v) for k, v in counts().items() if before[k] != v})
    body = open(M44).read().lower() if os.path.exists(M44) else ""
    code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    code2 = re.sub(r"delete from tally_(bills|lines) \w where \w\.book_id = p_book and \w\.guid = any\(sent\);|delete from tally_ledger_day t where t\.book_id = p_book and t\.day = any\(p_days\);", "", code)
    ok(body != "" and code2.count("delete from") == 0 and not any(w in code2 for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop constraint", "drop index", "truncate table", "truncate public"]) and code.strip().startswith("begin;") and code.strip().endswith("commit;"),
       "the file drops and deletes nothing (the entry path's re-send deletes and the cache rebuild aside); one transaction")
    ok(body != "" and all(re.match(r"alter table (if exists )?public\.\w+ (add column if not exists|enable row level security)", m.group(0)) for m in re.finditer(r"alter table[^;]*;", code)), "every alter table adds a column if missing or turns row level security on")
    ok(body != "" and all("set search_path = public, pg_temp" in m.group(0) for m in re.finditer(r"alter function[^;]*;", code)) and len(re.findall(r"alter function", code)) >= 10, "every alter function only sets the search_path (%d)" % len(re.findall(r"alter function", code)))
    ok(all(w in body for w in ["tally_ingest_entries", "supersedes 43", "item 95", "tally_ingest_delete", "tally_recorder_lines", "duplicate", "month lock", "tally_tieout", "search_path", "% given", "partial unique"]),
       "the header names the entry path, the delete, the recorder lines and duplicates, the month locks, the tie-outs, the search_path fixes and the % fix")
    # ---------------------------------------------------------------- 1. one entry path
    e8 = fdef("tally_ingest_day(uuid,date,jsonb,jsonb,integer,bigint,integer,boolean)")
    ok("tally_ingest_entries(" in e8 and "live entries: confirm by a second empty read" in e8 and "empty day with%" in e8 and "however old" in e8 and "not emptied then tally_days.n" in e8,
       "1. the 8-argument tally_ingest_day calls tally_ingest_entries and keeps 43's day rules")
    ok("null::boolean" in fdef("tally_ingest_day(uuid,date,jsonb,jsonb,integer,bigint,integer)"), "1. the 7-argument wrapper is untouched")
    ok(jn("select has_function_privilege('authenticated', 'tally_ingest_entries(uuid, jsonb, jsonb)', 'execute')") == "f" and jn("select has_function_privilege('service_role', 'tally_ingest_entries(uuid, jsonb, jsonb)', 'execute')") == "t", "1. tally_ingest_entries: the service role's alone")
    good, out = as_user(STAFF, "select tally_ingest_entries(%s, '[]'::jsonb, '[]'::jsonb)::text" % q(B1))
    ok(not good, "1. a signed-in person cannot call it (%s)" % out[-60:])
    r = j("select tally_ingest_entries(%s, %s, %s)::text" % (q(B1), js([V("e1", 3, "2026-05-03")]), js([L("e1", "Sales", 5), L("e1", "Cash", -5)])))
    ok(r.get("ok") is True and vrow("e1").get("day") == "2026-05-03" and cache("2026-05-03") == "5" and r.get("touched") == ["2026-05-03"], "1. entries: an entry with its own day, its lines, the day's cache (%s)" % r)
    r = j("select tally_ingest_entries(%s, %s, %s)::text" % (q(B1), js([V("e1", 4, "2026-05-04")]), js([L("e1", "Sales", 6), L("e1", "Cash", -6)])))
    ok(vrow("e1").get("day") == "2026-05-04" and cache("2026-05-03") == "0" and cache("2026-05-04") == "6" and sorted(r.get("touched") or []) == ["2026-05-03", "2026-05-04"] and nvers("e1") == 2,
       "1. moved to another day: both days' cache rebuilt, a version per AlterID (%s)" % r.get("touched"))
    r = j("select tally_ingest_day(%s, '2026-05-02', %s, %s, 2, 6, 100)::text" % (q(B1), js([V("d1", 6), V("d2", 5)]), js([L("d1", "Sales", 11), L("d1", "Cash", -11), L("d2", "Rent", -7), L("d2", "Cash", 7)])))
    ok(r.get("ok") is True and r.get("sent") == 2 and r.get("marked") == 0 and cache("2026-05-02") == "11" and r.get("touched") == ["2026-05-02"], "1. the day path through the shared function: upserted, cache rebuilt (%s)" % r)
    # ---------------------------------------------------------------- 3/4. the recorder
    n0 = nlines()
    r = apply([entry("L1", "created", "r1", 10, "2026-05-10", 100)])
    ok(st(r) == {"L1": "applied"} and vrow("r1").get("origin") == "tally" and vrow("r1").get("alter_id") == "10" and cache("2026-05-10") == "100", "4. created: applied through the entry path, origin tally, the cache (%s, %s)" % (st(r), r.get("_error", "")))
    row = (db.rows("select firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, object_guid, master_id, alter_id, vch_type, vch_no, vch_date, saved_at, received_at, applied_at, state, ledgers::text as ledgers, payload::text as payload, save_ms from tally_recorder_lines order by id desc limit 1") or [{}])[0] if nlines() > n0 else {}
    ok(row.get("firm_id") == F and row.get("client_id") == "c1" and row.get("device_id") == D1 and row.get("pc") == "NWS144" and row.get("tally_user") == "anshul" and row.get("company_guid") == "cg-1" and row.get("line_id") == "L1" and row.get("event") == "created"
       and row.get("alter_id") == "10" and row.get("vch_date") == "2026-05-10" and row.get("saved_at") and row.get("received_at") and row.get("applied_at") and row.get("state") == "applied" and row.get("save_ms") == "12.5" and "Sales" in row.get("ledgers", "") and row.get("bridge") == "go-1",
       "3. the line kept: firm, client, book, device, pc, user, company GUID, line id, event, AlterID, date, saved/received/applied, state, ledgers, save_ms (%s)" % {k: row.get(k) for k in ("state", "save_ms", "vch_date")})
    r = apply([entry("L1", "created", "r1", 10, "2026-05-10", 100)])
    ok(st(r) == {"L1": "duplicate"} and nvers("r1") == 1 and cache("2026-05-10") == "100", "4. the same line again: duplicate, nothing changes (%s)" % st(r))
    r = apply([entry("L1b", "created", "r1", 10, "2026-05-10", 100)], dev=D2)
    ok(st(r) == {"L1b": "duplicate"} and "line" in why(r, "L1b"), "3. the same change from a second computer: duplicate, applied once (%s: %s)" % (st(r), why(r, "L1b")))
    ok(int(db.one("select count(*) from tally_recorder_lines where object_guid = 'r1' and alter_id = 10 and event = 'created'")) == 3 and db.one("select count(*) from tally_recorder_lines where object_guid = 'r1' and state = 'applied'") == "1", "3. every arrival kept (3 rows), one applied")
    r = apply([entry("L2", "altered", "r1", 11, "2026-05-10", 120)])
    ok(st(r) == {"L2": "applied"} and vrow("r1").get("alter_id") == "11" and nvers("r1") == 2 and cache("2026-05-10") == "120" and db.one("select lines is not null from tally_voucher_versions where tally_guid = 'r1' and alter_id = 10") == "t",
       "4. altered: applied, the old version kept with its lines, a version for the new AlterID (%s)" % st(r))
    r = apply([entry("L3", "altered", "r1", 9, "2026-05-10", 999)])
    ok(st(r) == {"L3": "stale"} and cache("2026-05-10") == "120" and vrow("r1").get("alter_id") == "11", "4. an older AlterID: stale, nothing changes (%s %s)" % (st(r), why(r, "L3")))
    r = apply([RL("L3b", "imported", "r2", 3, "2026-05-11", [V("r2", 3, "2026-05-11")], [L("r2", "Sales", 40), L("r2", "Cash", -40)])])
    ok(st(r) == {"L3b": "applied"} and cache("2026-05-11") == "40", "4. imported: through the entry path (%s)" % st(r))
    r = apply([RL("L3c", "created", "r3", 1, "2026-05-12")])
    ok(st(r) == {"L3c": "held"} and "next day read" in why(r, "L3c") and vrow("r3") == {}, "4. a created line without the entry's body: held for the next day read (%s)" % why(r, "L3c"))
    r = apply([RL("L4", "deleted", "r1", 12, "2026-05-10")])
    ok(st(r) == {"L4": "applied"} and vrow("r1").get("deleted_at") and cache("2026-05-10") == "0" and nvers("r1") >= 2, "2. deleted: deleted_at set, the day's cache rebuilt, versions kept (%s)" % st(r))
    r = apply([RL("L5", "cancelled", "r2", 4, "2026-05-11")])
    v2 = vrow("r2")
    ok(st(r) == {"L5": "applied"} and v2.get("cancelled") == "t" and not v2.get("deleted_at") and cache("2026-05-11") == "0", "2. cancelled: cancelled true, NOT deleted, the cache leaves it out (%s)" % v2)
    r = apply([RL("L6", "deleted", "no-such", 5, "2026-05-10"), entry("L7", "created", "r4", 2, "2026-05-13", 13)])
    ok(st(r) == {"L6": "held", "L7": "applied"} and "unknown" in why(r, "L6"), "2. an unknown GUID: held, the batch goes on (%s %s)" % (st(r), why(r, "L6")))
    r = apply([RL("L8", "deleted", "r4", 1, "2026-05-13")])
    ok(st(r) == {"L8": "stale"} and not vrow("r4").get("deleted_at"), "2. a delete with an older AlterID: stale, not deleted (%s)" % st(r))
    r = apply([RL("L9", "renamed_in_space", "r4", 3, "2026-05-13"), {"line_id": "L10", "event": "created", "object_guid": "bad", "alter_id": 1, "vch_date": "2026-05-13", "vouchers": [{"guid": "bad", "alter": 1, "day": "2026-05-13"}], "lines": [["bad", "Sales", "not a number"]]}, entry("L11", "created", "r5", 1, "2026-05-14", 14)])
    ok(st(r) == {"L9": "failed", "L10": "failed", "L11": "applied"} and vrow("bad") == {} and cache("2026-05-14") == "14", "4. an unknown event and a bad line: failed, the rest applied (%s; %s)" % (st(r), why(r, "L10")[:60]))
    # a FinCom posting coming back
    r = apply([entry("L12", "created", "tg-1", 1, "2026-05-15", 50, narr="Bill | TDSDesk:P1", fid="P1")])
    v = vrow("tg-1"); pid = (db.rows("select matched_at, matched_vch from tally_post_ids where fincom_id = 'P1'") or [{}])[0]
    ok(st(r) == {"L12": "applied"} and v.get("origin") == "fincom" and v.get("fincom_id") == "P1" and pid.get("matched_at") and pid.get("matched_vch") == "S1", "4. a FinCom posting coming back: matched by its id, origin fincom, tally_post_ids.matched_at (%s, %s)" % (v, pid))
    r = apply([entry("L13", "created", "tg-1", 1, "2026-05-15", 50, narr="Bill | TDSDesk:P1", fid="P1")], dev=D2)
    ok(st(r) == {"L13": "duplicate"} and db.one("select count(*) from tally_vouchers where fincom_id = 'P1'") == "1", "4. and from a second computer: not duplicated (one row)")
    # ledgers
    r = apply([RL("L14", "ledger_renamed", "g-rent", 2, None, **{"from": "Rent", "to": "Rent Paid"})])
    ok(st(r) == {"L14": "applied"} and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Rent Paid' and tally_guid = 'g-rent'" % q(B1)) == "1" and db.one("select count(*) from tally_lines where ledger = 'Rent Paid'") == "1"
       and db.one("select renamed_at is not null from tally_ledgers where name = 'Rent Paid'") == "t", "4. ledger_renamed: tally_ledger_rename (renamed_at, the lines follow) (%s %s)" % (st(r), why(r, "L14")))
    r = apply([RL("L15", "ledger_created", "g-new", 1, None, name="New Ledger"), RL("L16", "ledger_altered", "g-sales", 3, None, name="Sales")])
    ok(st(r) == {"L15": "held", "L16": "held"} and "next ledger list" in why(r, "L15"), "4. ledger_created / ledger_altered: held, applied by the next ledger list (%s)" % why(r, "L15"))
    r = apply([RL("L17", "ledger_deleted", "g-old-unused", 2, None, name="Old Unused"), RL("L18", "ledger_deleted", "g-sales", 4, None, name="Sales"), RL("L19", "ledger_deleted", "g-nobody", 1, None, name="Nobody")])
    ok(st(r) == {"L17": "applied", "L18": "held", "L19": "held"} and db.one("select deleted_at is not null from tally_ledgers where name = 'Old Unused'") == "t" and db.one("select deleted_at is null from tally_ledgers where name = 'Sales'") == "t"
       and "entries" in why(r, "L18"), "4. ledger_deleted: soft-deleted, kept by the guard when it has entries (held), unknown held (%s; %s)" % (st(r), why(r, "L18")))
    good, out = as_user(OWNER, "select tally_recorder_apply(%s, %s, %s, '[]'::jsonb)::text" % (q(F), q(B1), q(D1)))
    ok(not good, "4. tally_recorder_apply: the service role's (%s)" % out[-60:])
    ok("_error" in apply([], book=B9), "4. a book of another firm: refused")
    # ---------------------------------------------------------------- 5. month locks
    good, out = as_user(STAFF, "select tally_month_lock('c1', '2026-06-15', 'tied')::text")
    ok(not good and "owner" in out, "5. a staff member cannot lock a month (%s)" % out[-60:])
    good, out = as_user(OWNER, "select tally_month_lock('c1', '2026-06-15', 'tied out with Tally')::text"); r = json.loads(out) if good else {}
    ok(good and r.get("ok") is True and db.one("select count(*) from tally_month_locks where month = '2026-06-01' and book_id = %s and unlocked_at is null and locked_by = %s" % (q(B1), q(OWNER))) == "1", "5. the owner locks June (the first of the month kept) (%s)" % (r or out[-80:]))
    good, out = as_user(OWNER, "select tally_month_lock('c1', '2026-06-01', 'again')::text")
    ok(good and json.loads(out).get("already") is True and db.one("select count(*) from tally_month_locks where unlocked_at is null") == "1", "5. locked again: already")
    good, out = as_user(OTHER, "select tally_month_lock('c1', '2026-06-01', 'x')::text")
    ok(not good or json.loads(out).get("books") == 0, "5. another firm's owner locks nothing of ours (%s)" % out[-60:])
    k = counts(); dday = (db.rows("select n, alter_max, at from tally_days where book_id = %s and day = '2026-06-05'" % q(B1)) or [{}])[0]
    r = j("select tally_ingest_day(%s, '2026-06-05', %s, %s, 1, 9, 100)::text" % (q(B1), js([V("j1", 9)]), js([L("j1", "Sales", 99), L("j1", "Cash", -99)])))
    ok(str(r.get("refused", "")).startswith("month locked") and counts() == k and vrow("j1").get("alter_id") == "5" and cache("2026-06-05") == "30" and (db.rows("select n, alter_max, at from tally_days where book_id = %s and day = '2026-06-05'" % q(B1)) or [{}])[0] == dday,
       "5. the day path: a day of a locked month stores nothing, answered refused 'month locked' (%s)" % r.get("refused"))
    r = j("select tally_ingest_day(%s, '2026-06-06', '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % q(B1))
    ok(str(r.get("refused", "")).startswith("month locked") and db.one("select count(*) from tally_days where book_id = %s and day = '2026-06-06'" % q(B1)) == "0", "5. an empty read of a locked month: refused, nothing recorded (%s)" % r.get("refused"))
    r = j("select tally_ingest_entries(%s, %s, %s)::text" % (q(B1), js([V("j9", 1, "2026-06-09")]), js([L("j9", "Sales", 1), L("j9", "Cash", -1)])))
    ok(r.get("locked") is True and vrow("j9") == {}, "5. tally_ingest_entries itself refuses a locked month (the shared rule)")
    r = j("select tally_ingest_entries(%s, %s, %s)::text" % (q(B1), js([V("e1", 9, "2026-06-09")]), js([L("e1", "Sales", 1), L("e1", "Cash", -1)])))
    ok(r.get("locked") is True and vrow("e1").get("day") == "2026-05-04", "5. an entry moved INTO a locked month: refused")
    r = apply([entry("L20", "altered", "j1", 9, "2026-06-05", 99), RL("L21", "deleted", "j1", 10, "2026-06-05"), entry("L22", "created", "r6", 1, "2026-05-16", 16)])
    ok(st(r) == {"L20": "held", "L21": "held", "L22": "applied"} and "month locked" in why(r, "L20") and cache("2026-06-05") == "30" and not vrow("j1").get("deleted_at"), "5. lines in a locked month held, not applied; May applied (%s)" % st(r))
    r = apply([entry("L20", "altered", "j1", 9, "2026-06-05", 99)], dev=D2)
    ok(st(r) == {"L20": "duplicate"}, "5. a held line arriving again: duplicate (the held one is released, not this)")
    held_id = db.one("select id from tally_recorder_lines where line_id = 'L20' and state = 'held'")
    good, out = as_user(OWNER, "select tally_recorder_release_held(%s)::text" % held_id); r = json.loads(out) if good else {}
    ok(good and r.get("state") == "held" and "month locked" in str(r.get("why")) and cache("2026-06-05") == "30", "5. a release while the month is locked: still held (%s)" % (r or out[-80:]))
    good, out = as_user(STAFF, "select tally_month_unlock('c1', '2026-06-01', 'x')::text")
    ok(not good and "owner" in out, "5. a staff member cannot unlock")
    good, out = as_user(OWNER, "select tally_month_unlock('c1', '2026-06-01', 'a late bill')::text")
    ok(good and json.loads(out).get("ok") is True and db.one("select count(*) from tally_month_locks where month = '2026-06-01' and unlocked_at is not null and unlocked_by = %s" % q(OWNER)) == "1", "5. the owner unlocks: the lock row kept with unlocked_at / unlocked_by")
    good, out = as_user(STAFF, "select tally_recorder_release_held(%s)::text" % held_id)
    ok(not good and "owner" in out, "5. a staff member cannot release a held line")
    good, out = as_user(OWNER, "select tally_recorder_release_held(%s)::text" % held_id); r = json.loads(out) if good else {}
    ok(good and r.get("state") == "applied" and cache("2026-06-05") == "99" and vrow("j1").get("alter_id") == "9" and db.one("select state || '/' || (released_by = %s)::text from tally_recorder_lines where id = %s" % (q(OWNER), held_id)) == "applied/true",
       "5. after the unlock the owner's release applies it (released_by kept) (%s)" % (r or out[-80:]))
    good, out = as_user(OWNER, "select tally_recorder_release_held(%s)::text" % held_id)
    ok(not good and "not held" in out, "5. releasing a line not held is refused (%s)" % out[-60:])
    good, out = as_user(OTHER, "select tally_recorder_release_held(%s)::text" % held_id)
    ok(not good, "5. another firm's owner cannot release our line")
    r = j("select tally_ingest_day(%s, '2026-06-05', %s, %s, 1, 10, 100)::text" % (q(B1), js([V("j1", 10)]), js([L("j1", "Sales", 31), L("j1", "Cash", -31)])))
    ok("refused" not in r and cache("2026-06-05") == "31", "5. unlocked: the day path applies again")
    # ---------------------------------------------------------------- 6. tie-outs
    fig = {"receivables": 1000.5, "payables": 500, "cash_bank": 200, "profit": 50, "tb_total": 0}
    good, out = as_user(STAFF, "select tally_tieout_save('c1', '2026-05-20', %s, %s, null)::text" % (js(fig), js({"receivables": 1000.5, "payables": 500, "cashBank": 200, "profit": 50, "tb": 0})))
    t = (db.rows("select month, receivables, payables, cash_bank, profit, tb_total, fincom::text as fincom, ticked_at, book_id from tally_tieouts where client_id = 'c1'") or [{}])[0]
    ok(good and t.get("month") == "2026-05-01" and t.get("receivables") == "1000.5" and t.get("cash_bank") == "200" and t.get("book_id") == B1 and "cashBank" in t.get("fincom", "") and not t.get("ticked_at"), "6. a member saves Tally's figures and FinCom's five (%s)" % (t or out[-80:]))
    good, out = as_user(STAFF, "select tally_tieout_save('c1', '2026-05-01', %s, null, true)::text" % js(fig))
    ok(not good and "owner" in out, "6. ticking is the owner's (%s)" % out[-60:])
    good, out = as_user(OWNER, "select tally_tieout_save('c1', '2026-05-01', %s, null, true)::text" % js(fig))
    ok(good and db.one("select ticked_by from tally_tieouts where client_id = 'c1'") == OWNER, "6. the owner ticks (%s)" % out[-60:])
    good, out = as_user(STAFF, "select tally_tieout_save('c1', '2026-05-01', %s, null, null)::text" % js(dict(fig, profit=60)))
    ok(not good and "ticked" in out, "6. a ticked month's figures are not changed by a member (%s)" % out[-60:])
    good, out = as_user(STAFF, "select tally_tieout_save('c1', '2026-05-01', %s, null, null)::text" % js({"profit": "fifty"}))
    ok(not good and "number" in out, "6. a figure that is not a number is refused (%s)" % out[-60:])
    good, out = as_user(OTHER, "select count(*) from tally_tieouts")
    ok(good and out == "0", "6. another firm sees no tie-out")
    # ---------------------------------------------------------------- owner item 8: one row per (book, Tally's GUID), whichever path comes first
    r = j("select tally_ingest_day(%s, '2026-05-21', %s, %s, 1, 5, 100)::text" % (q(B1), js([V("G8", 5)]), js([L("G8", "Sales", 80), L("G8", "Cash", -80)])))
    o8 = vrow("G8").get("origin")
    tb = lambda: db.one("select round(coalesce(sum(closing), 0), 2) from tally_balances where book_id = %s" % q(B1))
    tb8 = tb(); cash8 = cache("2026-05-21", "Cash")
    r = apply([entry("I8a", "altered", "G8", 7, "2026-05-21", 85)])
    ok(st(r) == {"I8a": "applied"} and db.one("select count(*) from tally_vouchers where book_id = %s and guid = 'G8'" % q(B1)) == "1" and vrow("G8").get("alter_id") == "7" and vrow("G8").get("origin") == o8 == "tally" and cache("2026-05-21") == "85"
       and db.one("select lines::text from tally_voucher_versions where tally_guid = 'G8' and alter_id = 5") == json.dumps([["Cash", -80, "", None, []], ["Sales", 80, "", None, []]]).replace("[[", "[[").replace(", ", ", "),
       "8. uploaded day book (G8, AlterID 5) then the recorder's altered (AlterID 7): one row, version 5 kept with its lines, the new lines applied, origin unchanged (%s %s)" % (st(r), db.one("select lines::text from tally_voucher_versions where tally_guid = 'G8' and alter_id = 5")))
    ok(tb() == tb8 == "0.00" and cash8 == "-80" and cache("2026-05-21", "Cash") == "-85" and cache("2026-05-21") == "85" and db.one("select count(*) from tally_lines where guid = 'G8'") == "2",
       "8. the trial balance the same before and after (the altered entry balanced: %s / %s); the cache: the old amounts gone (-80), the new in (-85 / 85)" % (tb8, tb()))
    j("select tally_ingest_day(%s, '2026-05-22', %s, %s, 1, 5, 100)::text" % (q(B1), js([V("G9", 5)]), js([L("G9", "Sales", 90), L("G9", "Cash", -90)])))
    k = counts(); vv = vrow("G9")
    r = apply([entry("I9", "created", "G9", 5, "2026-05-22", 90)])
    ok(st(r) == {"I9": "duplicate"} and counts() == k and vrow("G9") == vv and "AlterID" in why(r, "I9"), "8. the recorder reporting an uploaded entry at the same AlterID: duplicate, nothing changes (%s)" % why(r, "I9"))
    r = apply([entry("I10", "created", "G10", 5, "2026-05-23", 70)])
    r2 = j("select tally_ingest_day(%s, '2026-05-23', %s, %s, 1, 5, 100)::text" % (q(B1), js([V("G10", 5)]), js([L("G10", "Sales", 70), L("G10", "Cash", -70)])))
    ok(st(r) == {"I10": "applied"} and "refused" not in r2 and db.one("select count(*) from tally_vouchers where book_id = %s and guid = 'G10'" % q(B1)) == "1" and nvers("G10") == 1 and cache("2026-05-23") == "70" and vrow("G10").get("origin") == "tally",
       "8. the reverse order (the recorder first, the day book after): harmless, one row, one version (%s)" % st(r))
    # the same day book uploaded twice (owner, 04-Oct): the same rows, no new versions, the same figures; then one entry changed
    up = lambda vs, ls: j("select tally_ingest_day(%s, '2026-05-25', %s, %s, %d, %d, 200)::text" % (q(B1), js(vs), js(ls), len(vs), max(v["alter"] for v in vs)))
    VS = [V("U1", 5), V("U2", 6)]; LS = [L("U1", "Sales", 25), L("U1", "Cash", -25), L("U2", "Sales", 26), L("U2", "Cash", -26)]
    snap = lambda: (db.one("select count(*) from tally_vouchers where book_id = %s" % q(B1)), db.one("select count(*) from tally_voucher_versions where book_id = %s" % q(B1)),
                    db.one("select string_agg(ledger || '=' || amount::text, ',' order by ledger) from tally_ledger_day where book_id = %s and day = '2026-05-25'" % q(B1)), tb(),
                    db.one("select string_agg(guid || ':' || alter_id || ':' || coalesce(deleted_at::text, '-'), ',' order by guid) from tally_vouchers where book_id = %s and day = '2026-05-25'" % q(B1)))
    r1 = up(VS, LS); s1 = snap(); r2 = up(VS, LS); s2 = snap()
    ok("refused" not in r1 and "refused" not in r2 and s1 == s2 and s1[2] == "Cash=-51,Sales=51" and s1[3] == "0.00", "U. the same day book uploaded twice: the same rows, no new version rows, the same ledger-day figures and trial balance (%s)" % (s2,))
    r3 = up([V("U1", 5), V("U2", 9)], [L("U1", "Sales", 25), L("U1", "Cash", -25), L("U2", "Sales", 36), L("U2", "Cash", -36)]); s3 = snap()
    ok(s3[0] == s2[0] and int(s3[1]) == int(s2[1]) + 1 and s3[2] == "Cash=-61,Sales=61" and s3[3] == "0.00" and vrow("U2").get("alter_id") == "9"
       and "26" in (db.one("select lines::text from tally_voucher_versions where tally_guid = 'U2' and alter_id = 6") or "") and nvers("U2") == 2,
       "U. a second upload with one entry's AlterID and amount changed: that row updated in place, its old version (AlterID 6) kept with its lines, one new version (%s)" % (s3,))
    k = counts(); r = apply([RL("I11", "created", None, 3, "2026-05-24", [V("", 3, "2026-05-24")], [L("", "Sales", 3)]), RL("I12", "altered", "", 3, "2026-05-24")])
    ok(st(r) == {"I11": "held", "I12": "held"} and counts() == k and "GUID" in why(r, "I11"), "8. a line with no GUID: held, never a new row (%s)" % why(r, "I11"))
    # ---------------------------------------------------------------- the starting point (owner's change of 04-Oct: reading is prospective)
    sp = lambda g, v, m: j("select tally_start_point(%s, %s, %s, %s, %s, %s, 'go-1')::text" % (q(F), q(B1), "null" if g is None else q(g), v, m, q(D1)))
    cur = lambda: (db.rows("select company_guid, last_voucher_alterid, last_master_alterid, start_guid, start_at, state from tally_sync_cursor where book_id = %s" % q(B1)) or [{}])[0]
    r = sp("cg-1", 26400, 900); c = cur()
    ok(r.get("ok") is True and r.get("set") is True and c.get("last_voucher_alterid") == "26400" and c.get("last_master_alterid") == "900" and c.get("start_guid") == "cg-1" and c.get("start_at") and c.get("state") == "ok", "S. the bridge's starting point kept on the cursor once (%s)" % c)
    r = sp("cg-1", 100, 5); r2 = sp("cg-1", 99999, 99999); c = cur()
    ok(r.get("set") is False and r2.get("set") is False and c.get("last_voucher_alterid") == "26400" and c.get("last_master_alterid") == "900", "S. a later point (lower or higher) never changes it: once per book, never lowered (%s)" % c)
    r = sp("cg-2", 50, 7); c = cur()
    ok(r.get("set") is True and c.get("last_voucher_alterid") == "50" and c.get("start_guid") == "cg-2" and c.get("state") == "needs_baseline", "S. a new company GUID: the point reset, needs_baseline as today (%s)" % c)
    ok(jn("select has_function_privilege('authenticated', 'tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text)', 'execute')") == "f", "S. tally_start_point: the service role's")
    # ---------------------------------------------------------------- a PC without the add-on: the gap (owner, 04-Oct)
    gapc = lambda dev, alt, at: j("select tally_recorder_gap_check(%s, %s, %s, %s)::text" % (q(B2), q(dev), alt, q(at)))
    cur2 = lambda: (db.rows("select last_voucher_alterid, recorder_max_alter, recorder_last_at, gap::text as gap, gap_at, last_match_at, state, start_at from tally_sync_cursor where book_id = %s" % q(B2)) or [{}])[0]
    j("select tally_start_point(%s, %s, 'cg-b2', 40, 10, %s, 'go-a')::text" % (q(F), q(B2), q(D1)))
    r = apply([entry("A50", "created", "a50", 50, "2026-05-02", 5)], book=B2)
    c = cur2()
    ok(st(r) == {"A50": "applied"} and c.get("recorder_max_alter") == "50" and c.get("recorder_last_at"), "G1. the highest change number from every PC's lines kept on the cursor (%s)" % c.get("recorder_max_alter"))
    apply([entry("A45", "created", "a45", 45, "2026-05-02", 5)], book=B2)
    ok(cur2().get("recorder_max_alter") == "50", "G1. never lowered by a lower line")
    r = gapc(D1, 50, "2026-10-04T10:00:00+05:30")
    ok(r.get("ok") is True and r.get("gap") is None and cur2().get("last_match_at"), "G2. a check that matches (50): no gap, last_match_at set (%s)" % r)
    r = gapc(D2, 53, "2026-10-04T10:05:00+05:30"); c = cur2(); g = json.loads(c.get("gap") or "{}")
    ok(r.get("missing") == 3 and g.get("missing") == 3 and g.get("tally_altvchid") == 53 and g.get("recorder_max") == 50 and g.get("start_point") == 40 and str(g.get("since", "")).startswith("2026-10-04T04:30:00") and c.get("gap_at") and D1 in (g.get("by_device") or {}) and "up to 3 changes not received since" in str(g.get("words")) and g.get("missingMax") == 3,
       "G3. PC B says 53, the lines reached 50: gap {missing 3 (up to 3 changes: an upper bound), since the last match, by_device} (%s)" % g)
    r = apply([entry("A53", "created", "a53", 53, "2026-05-03", 5)], book=B2)
    r = gapc(D2, 53, "2026-10-04T10:20:00+05:30"); c = cur2()
    ok(r.get("gap") is None and not c.get("gap") and not c.get("gap_at") and c.get("last_match_at", "").startswith("2026-10-04 04:50"), "G4. A's lines up to 53 arrive: the next check clears the gap (%s)" % c.get("last_match_at"))
    r = gapc(D2, 56, "2026-10-04T11:00:00+05:30")
    ok(r.get("missing") == 3, "G5. Tally moves on to 56 unrecorded: a gap of 3")
    j("select tally_ingest_day(%s, '2026-05-04', %s, %s, 1, 56, 100)::text" % (q(B2), js([V("u56", 56)]), js([L("u56", "Sales", 1), L("u56", "Cash", -1)])))
    r = gapc(D2, 56, "2026-10-04T11:10:00+05:30")
    ok(r.get("gap") is None and not cur2().get("gap"), "G5. the owner uploads those days (a day read with AlterID 56): the check clears the gap (%s)" % r)
    r = gapc(D2, 30, "2026-10-04T11:20:00+05:30"); c = cur2()
    ok(r.get("gap") is None and r.get("needsBaseline") is True and c.get("state") == "needs_baseline" and not c.get("gap"), "G6. a number below the starting point (a restore): needs_baseline as today, never a gap (%s)" % c.get("state"))
    r = j("select tally_recorder_gap_check(%s, %s, 70, now())::text" % (q(B3), q(D1)))
    c3 = (db.rows("select last_voucher_alterid, start_at, gap from tally_sync_cursor where book_id = %s" % q(B3)) or [{}])[0]
    ok(r.get("startRecorded") is True and r.get("gap") is None and c3.get("last_voucher_alterid") == "70" and c3.get("start_at") and not c3.get("gap"), "G7. no starting point yet: the check records it, no gap (%s)" % c3)
    ok(jn("select has_function_privilege('authenticated', 'tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)', 'execute')") == "f", "G8. tally_recorder_gap_check: the service role's")
    # J64: a silent PC: Tally open today, no recorder line for a working day
    D4 = "d4000000-0000-0000-0000-000000000004"
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version) values (%s, %s, 'NWS146', 'h4', '2.2.0')" % (q(D4), q(F)))
    db.sql("""update tally_devices set created_at = now() - interval '4 days', info = jsonb_build_object('beat', jsonb_build_object('at', now(), 'tally', true)) where id in (%s, %s);""" % (q(D1), q(D4)))
    good, out = as_user(OWNER, "select tally_recorder_silent(%s)::text" % q(F)); r = json.loads(out) if good else {}
    sil = {x.get("device"): x for x in r.get("silent") or []}
    ok(good and D4 in sil and D1 not in sil and float(sil[D4].get("workingHours") or 0) >= 10, "J64. a PC with Tally open today and no line for a working day is listed; the one recording is not (%s)" % (r or out[-80:]))
    db.sql("update tally_devices set info = jsonb_build_object('beat', jsonb_build_object('at', now() - interval '3 days', 'tally', true)) where id = %s" % q(D4))
    good, out = as_user(OWNER, "select tally_recorder_silent(%s)::text" % q(F))
    ok(good and D4 not in {x.get("device") for x in json.loads(out).get("silent") or []}, "J64. Tally not open today: not listed")
    good, out = as_user(OTHER, "select tally_recorder_silent(%s)::text" % q(F))
    ok(not good, "J64. another firm cannot ask (%s)" % out[-60:])
    ok(jn("select round(tally_working_hours('2026-10-03 08:00+05:30', '2026-10-05 10:30+05:30'), 2)") == "11.50", "J64. working hours Mon-Sat 09:00-19:00 IST: Sat 10 h + Sun 0 + Mon 1.5 h = 11.5 (%s)" % jn("select tally_working_hours('2026-10-03 08:00+05:30', '2026-10-05 10:30+05:30')"))
    # ---------------------------------------------------------------- R. the database review's fixes (docs/reviews/migration-44-review.md)
    B4, B5 = "14444444-1111-1111-1111-111111111111", "15555555-1111-1111-1111-111111111111"
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c4', 'ZZ FOUR', '2026-04-01', '2026-03-31'), (%s, %s, 'c5', 'ZZ FIVE', '2026-04-01', '2026-03-31') on conflict do nothing" % (q(B4), q(F), q(B5), q(F)))
    db.sql("insert into clients (id, firm_id, name, data) values ('c4', %s, 'ZZ4', '{}') on conflict do nothing" % q(F))
    apply4 = lambda lines, dev=D1: apply(lines, dev=dev, book=B4)
    cur4 = lambda b=B4: (db.rows("select last_voucher_alterid, recorder_max_alter, gap::text as gap, state, start_at from tally_sync_cursor where book_id = %s" % q(b)) or [{}])[0]
    lrow4 = lambda lid: (db.rows("select id, state, held_why, alter_id, released_at, coalesce(jsonb_array_length(body->'vouchers'), -1) as nv, coalesce(jsonb_array_length(body->'lines'), -1) as nl, body->'lines' as lines from tally_recorder_lines where book_id = %s and line_id = %s order by id desc limit 1" % (q(B4), q(lid))) or [{}])[0]
    j("select tally_ingest_day(%s, '2026-05-20', %s, %s, 1, 5, 100)::text" % (q(B4), js([V("m1", 5, "2026-05-20")]), js([L("m1", "Sales", 50), L("m1", "Cash", -50)])))
    # M1: a held line without a body does not make the same change with a body a duplicate
    r = apply4([RL("M1a", "altered", "m1", 7, "2026-05-20")])
    ok(st(r) == {"M1a": "held"} and "no entry body" in why(r, "M1a"), "R-M1. a line without the entry's body: held (%s)" % st(r))
    r = apply4([entry("M1b", "altered", "m1", 7, "2026-05-20", 70)], dev=D2)
    ok(st(r) == {"M1b": "applied"} and vrow("m1", B4).get("alter_id") == "7" and lrow4("M1b").get("nv") == "1" and db.one("select count(*) from tally_recorder_lines where book_id = %s and object_guid = 'm1' and alter_id = 7 and state = 'applied'" % q(B4)) == "1",
       "R-M1. the same change then sent with its body (another PC): applied, not duplicate; the body kept; one applied row (%s: %s)" % (st(r), why(r, "M1b")))
    r = apply4([entry("M1c", "altered", "m1", 8, "2026-05-20", 80)]); r2 = apply4([RL("M1d", "altered", "m1", 8, "2026-05-20")], dev=D2)
    ok(st(r) == {"M1c": "applied"} and st(r2) == {"M1d": "duplicate"}, "R-M1. the reverse order (body first, then without): the second is duplicate (%s %s)" % (st(r), st(r2)))
    # L1: the stored body keeps only the line's own voucher and its lines
    r = apply4([RL("L1a", "created", "m2", 2, "2026-05-21", [V("m2", 2, "2026-05-21"), V("zz-other", 2, "2026-05-21")], [L("m2", "Sales", 21), L("m2", "Cash", -21), L("zz-other", "Sales", 9), L("zz-other", "Cash", -9)])])
    lr = lrow4("L1a")
    ok(st(r) == {"L1a": "applied"} and lr.get("nv") == "1" and lr.get("nl") == "2" and "zz-other" not in str(lr.get("lines")) and vrow("zz-other", B4) == {}, "R-L1. a line carrying two vouchers stores one in body (its own, with its 2 lines) (%s)" % {k: lr.get(k) for k in ("nv", "nl")})
    # L2 / L9: a held, failed or out-of-bounds AlterID never raises recorder_max_alter
    mx0 = cur4().get("recorder_max_alter")
    r = apply4([RL("L2a", "created", "m-huge", 999999999999, "2026-05-22"), RL("L2b", "exploded", "m-bad", 999999999998, "2026-05-22")])
    ok(st(r) == {"L2a": "held", "L2b": "failed"} and mx0 == "8" and cur4().get("recorder_max_alter") == mx0, "R-L2. a held line with AlterID 999999999999 (and a failed one): recorder_max_alter stays %s (%s)" % (mx0, cur4().get("recorder_max_alter")))
    r = apply4([RL("L9a", "created", "m-big", 10 ** 16, "2026-05-22")])
    ok(not lrow4("L9a").get("alter_id") and cur4().get("recorder_max_alter") == mx0, "R-L9. an AlterID of 10^16 (past Tally's range): stored as unknown, not the cursor's (%s)" % lrow4("L9a").get("alter_id"))
    # L3: a release refused because the month is still locked is not stamped released
    good, out = as_user(OWNER, "select tally_month_lock('c4', '2026-06-01', 'tied')::text")
    r = apply4([entry("L3a", "created", "m3", 1000, "2026-06-03", 3)])
    hid = lrow4("L3a").get("id")
    ok(good and st(r) == {"L3a": "held"} and cur4().get("recorder_max_alter") == mx0, "R-L3. a line of a locked month: held, recorder_max_alter not raised by it (%s)" % st(r))
    good, out = as_user(OWNER, "select tally_recorder_release_held(%s)::text" % hid); r = json.loads(out) if good else {}
    ok(good and r.get("state") == "held" and not lrow4("L3a").get("released_at"), "R-L3. a release while the month is locked: still held, released_at NOT set (%s)" % lrow4("L3a").get("released_at"))
    as_user(OWNER, "select tally_month_unlock('c4', '2026-06-01', 'x')::text")
    good, out = as_user(OWNER, "select tally_recorder_release_held(%s)::text" % hid); r = json.loads(out) if good else {}
    ok(good and r.get("state") == "applied" and lrow4("L3a").get("released_at") and cur4().get("recorder_max_alter") == "1000", "R-L3. after the unlock the release applies it: released_at set, recorder_max_alter raised to its AlterID (%s)" % (r or out[-80:]))
    # L4: a ledger_deleted line is the ledger list's, as the header says (not releasable)
    lid18 = db.one("select id from tally_recorder_lines where line_id = 'L18' and state = 'held'")
    good, out = as_user(OWNER, "select tally_recorder_release_held(%s)::text" % lid18); r = json.loads(out) if good else {}
    ok(good and r.get("ok") is False and r.get("state") == "held" and "ledger list" in str(r.get("why")) and db.one("select state from tally_recorder_lines where id = %s" % lid18) == "held", "R-L4. a held ledger_deleted line: not released (the ledger list's) (%s)" % (r or out[-80:]))
    # M2: ALTVCHID 0 (or less) is unknown: never a starting point, never a rewind
    j("select tally_start_point(%s, %s, 'cg-4', 40, 1, %s, 'go-1')::text" % (q(F), q(B4), q(D1)))
    c0 = cur4(); r = j("select tally_recorder_gap_check(%s, %s, 0, now())::text" % (q(B4), q(D2))); c1 = cur4()
    ok(r.get("ok") is True and r.get("gap") is None and r.get("unknown") is True and not r.get("needsBaseline") and c1.get("state") == "ok" and c1 == c0, "R-M2. a check with ALTVCHID 0 after a starting point: unknown, state ok, the cursor unchanged (%s; %s)" % (r, c1.get("state")))
    r = j("select tally_recorder_gap_check(%s, %s, 0, now())::text" % (q(B5), q(D1)))
    ok(r.get("unknown") is True and not r.get("startRecorded") and not cur4(B5).get("start_at"), "R-M2. a check with ALTVCHID 0 and no starting point: none recorded (%s)" % r)
    r = j("select tally_start_point(%s, %s, 'cg-5', 0, 0, %s, 'go-1')::text" % (q(F), q(B5), q(D1)))
    ok("_error" in r and not cur4(B5).get("start_at"), "R-M2. tally_start_point with ALTVCHID 0: refused, no starting point (%s)" % str(r)[-80:])
    r = j("select tally_start_point(%s, %s, 'cg-5', 1000000000000000, 0, %s, 'go-1')::text" % (q(F), q(B5), q(D1)))
    ok("_error" in r and not cur4(B5).get("start_at"), "R-L9. tally_start_point with ALTVCHID 10^15: refused (%s)" % str(r)[-80:])
    # L6: tally_working_hours is nobody's to call directly, also under Supabase's default privileges
    if not SKIP44:
        db.sql("grant execute on function public.tally_working_hours(timestamptz, timestamptz) to authenticated")
        r6 = psql_file(M44)
        good, out = as_user(OWNER, "select count(*) from jsonb_array_elements(tally_recorder_silent(%s)->'silent')" % q(F))
        ok(r6.returncode == 0 and jn("select has_function_privilege('authenticated', 'tally_working_hours(timestamptz, timestamptz)', 'execute')") == "f" and good,
           "R-L6. tally_working_hours revoked from authenticated (Supabase's default grant simulated); tally_recorder_silent still answers (%s)" % (out[-60:] if not good else out))
    # ---------------------------------------------------------------- 7. search_path, the % fix
    src_after = sigs()
    for s in AUDIT:
        conf = jn("select coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = %s::regprocedure" % q("public." + s))
        ok("search_path=public, pg_temp" in conf and src_before.get(s) == src_after.get(s), "7. %s: search_path fixed, its text unchanged (%s)" % (s, conf))
    ps = fdef("tally_device_post_settings(uuid,jsonb,integer,integer)")
    ok("(% given)" in ps and "%s given" not in ps, "7. tally_device_post_settings: '(% given)'")
    good, out = as_user(OWNER, "select tally_device_post_settings(%s::uuid, null, 600, null)::text" % q(D1))
    ok(not good and "(600 given)" in out, "7. the refusal reads '(600 given)' (%s)" % out[-70:])
    # ---------------------------------------------------------------- 8. RLS on every table of 32-44, search_path on every function
    allf = FILES + [os.path.join(SQLDIR, "migration-34-ledger-safety.sql"), M44]
    tbls = sorted(set(t for p in allf if os.path.exists(p) for t in re.findall(r"(?i)create table if not exists public\.(\w+)", open(p).read())))
    rls = {x["relname"]: x["relrowsecurity"] for x in db.rows("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")}
    ok({"tally_recorder_lines", "tally_month_locks", "tally_tieouts"} <= set(tbls) and all(rls.get(t) == "t" for t in tbls), "8. every table created by 32-44 has row level security (%d: %s)" % (len(tbls), [t for t in tbls if rls.get(t) != "t"]))
    fns = sorted(set(n for p in allf if os.path.exists(p) for n in re.findall(r"(?i)function\s+public\.(\w+)\s*\(", open(p).read())))
    bad = [x["sig"] for x in db.rows("select p.oid::regprocedure::text as sig, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc p where pronamespace = 'public'::regnamespace and proname = any(array[%s])" % ",".join(q(n) for n in fns)) if "search_path" not in x["conf"]]
    ok(len(fns) >= 60 and not bad, "8. every function of 32-44 has a fixed search_path (%d names; without: %s)" % (len(fns), bad))
    for t in ("tally_recorder_lines", "tally_month_locks", "tally_tieouts"):
        g1, o1 = as_user(OWNER, "select count(*) from %s" % t); g2, o2 = as_user(OTHER, "select count(*) from %s" % t)
        ok(g1 and g2 and int(o1) > 0 and o2 == "0", "8. %s: the firm reads its rows (%s), another firm none (%s)" % (t, o1, o2))
        g3, o3 = as_user(OWNER, "update %s set firm_id = firm_id" % t)
        ok(not g3, "8. %s: nobody writes it directly (%s)" % (t, o3[-50:]))
    for fn, args in [("tally_ingest_entries", "uuid, jsonb, jsonb"), ("tally_ingest_delete", "uuid, text, bigint, boolean, text"), ("tally_recorder_apply", "uuid, uuid, uuid, jsonb"), ("tally_month_lock", "text, date, text"), ("tally_month_unlock", "text, date, text"),
                     ("tally_recorder_release_held", "bigint"), ("tally_tieout_save", "text, date, jsonb, jsonb, boolean"), ("tally_start_point", "uuid, uuid, text, bigint, bigint, uuid, text"), ("tally_recorder_gap_check", "uuid, uuid, bigint, timestamptz"), ("tally_recorder_silent", "uuid")]:
        d = fdef("%s(%s)" % (fn, args.replace(" ", "")))
        ok("SECURITY DEFINER" in d and "pg_temp" in d, "%s: security definer, search_path public, pg_temp" % fn)
    for fn, args, who in [("tally_ingest_delete", "uuid, text, bigint, boolean, text", "f"), ("tally_recorder_apply", "uuid, uuid, uuid, jsonb", "f"), ("tally_month_lock", "text, date, text", "t"), ("tally_month_unlock", "text, date, text", "t"),
                          ("tally_recorder_release_held", "bigint", "t"), ("tally_tieout_save", "text, date, jsonb, jsonb, boolean", "t")]:
        ok(jn("select has_function_privilege('authenticated', '%s(%s)', 'execute')" % (fn, args)) == who and jn("select has_function_privilege('anon', '%s(%s)', 'execute')" % (fn, args)) == "f", "%s: %s" % (fn, "granted to signed-in people (the owner / member check is inside)" if who == "t" else "the service role's"))
    if not SKIP44:
        k = counts(); n = nlines(); r = psql_file(M44); ok(r.returncode == 0 and counts() == k and nlines() == n, "migration-44 runs a third time over used tables")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
