"""python3 run_migration53.py - migration-53-recorder-placeholder-settled (05-Oct-2026, the owner's finding on staging: line 1,
event altered, Receipt 191 of 05-Oct-2026, GUID "<company GUID>-00000000" (the add-on's placeholder), MasterID 0, AlterID 0,
no body, held "waiting for the entry's details ..." although FinCom's copy holds exactly one live Receipt 191 of 05-Oct-2026,
GUID ...000066c6, AlterID 54391, from a Day Book; and tally_sync_cursor.recorder_max_alter at 51986, raised by lines that 51 /
52 later put back to 'held'). On throwaway PostgreSQL (pg_stand, port 30530; never a real database), built 32 -> ... -> 51 ->
52 in staging's order, then 53 (twice).
  1. THE RULE (tally_recorder_line): a held created / altered / imported line WITHOUT a body whose GUID is the placeholder or
     none, with a type, a number and a date, is 'duplicate' - "the copy holds <type> <no> of <date> already (GUID <g>, AlterID
     <a>, from a Day Book or another line)" - when the copy holds EXACTLY ONE live entry of the book under its company with the
     same type (any case, trimmed), number (trimmed, cut to 60) and date, at an AlterID above the book's starting point
     (tally_sync_cursor.last_voucher_alterid, recorded: start_at); no starting point: never. Unnumbered lines never; two fits
     never; an entry at or below the starting point never; a deleted entry never; a line whose ids did not belong together
     (idsMismatch) never; FinCom's short line never; a MasterID that makes another entry's GUID never.
     CORRECTION (bounded: received before 06-Oct-2026 00:00 India time): exactly line 1 of staging's (and here a line of
     another case); lines 4 (Receipt 192) and 17 (Receipt 212: no entry yet) stay held; the same words as the function.
     RELEASE: a Day Book stored later holding the entry makes such a line 'duplicate' (also when its type / number differ only
     in case or spaces: the day release finds it).
  2. recorder_max_alter: recomputed once as the max AlterID of the book's lines that ended applied / duplicate / stale and
     whose ids belong together (the GUID's last 8 hex digits are the MasterID, or the body is Tally's entry under the GUID);
     null when none. The functions raise it only from such lines (apply, the day release, the owner's release, the short
     retry, a held delete applied with its entry); no function puts a settled line back to 'held' (only 51's and 52's
     corrections did), so none can leave it raised.
RED: before the file exists it stops at the first check; with an empty file (M53_FILE) the checks of the rule fail."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql")]
M53 = os.environ.get("M53_FILE") or os.path.join(SQLDIR, "migration-53-recorder-placeholder-settled.sql")
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
B, B2, D1 = "f79e4bc3-871d-4482-874d-71c5fb2a1b33", "f79e4bc3-871d-4482-874d-000000000053", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
B3 = "f79e4bc3-871d-4482-874d-0000000053a3"                                                   # review M1: a book of its own (its settled lines count)
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"                                                   # GARG SHEKHAR & COMPANY's company GUID
FG = "0d8a1c2e-1111-2222-3333-444455556666"                                                   # another company's GUID (an entry synced or imported from it)
PH = CG + "-00000000"
G = lambda mid: CG + "-%08x" % mid                                                            # the GUID a MasterID makes
START = 50000                                                                                 # the book's starting point (tally_sync_cursor.last_voucher_alterid)
WAIT = "waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book"
W53 = "the copy holds %s %s of %s already (GUID %s, AlterID %s, from a Day Book or another line)"

text = open(M53).read() if os.path.exists(M53) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M53))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "53: begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok("delete from" not in low, "53: no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", low) and not re.search(r"\btruncate\b", low), "53: add-only (no drop, no truncate)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "53: names no real database")

def sline(lid, ev, og, mid, alt, no, day, saved="2026-10-05T02:30:00.000Z", **kw):
    x = {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.2.2", "vch_no": no, "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alt, "saved_at": saved,
         "vch_date": day, "vch_type": "Receipt", "master_id": mid, "object_guid": og, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY"}
    x.update(kw); return x
def V(guid, alter, no, day, party="", typ="Receipt"):
    return {"guid": guid, "alter": alter, "type": typ, "no": no, "party": party, "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": day}
def LN(guid, party, amt): return [[guid, "Cash", -amt, "", None, []], [guid, party, amt, "", None, []]]
def body(guid, alter, no, day, party, amt): return {"vouchers": [V(guid, alter, no, day, party)], "lines": LN(guid, party, amt)}

db = pg_stand.start(30530)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines, book=B): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(book), q(D1), js(lines)))
def states(r): return [(x.get("state"), x.get("why")) for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else r
def day(d, vouchers, lines, book=B): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def row(lid, book=B): return (db.rows("select id, state, coalesce(held_why, '') as why, md5(coalesce(body::text, '-')) as bm, md5(coalesce(payload::text, '-')) as pm, xmin::text as xm from tally_recorder_lines where book_id = %s and line_id = %s order by id desc limit 1" % (q(book), q(lid))) or [{}])[0]
def sw(lid, book=B): r = row(lid, book); return (r.get("state"), r.get("why"))
def rmax(book=B): return db.one("select coalesce(recorder_max_alter::text, 'null') from tally_sync_cursor where book_id = %s" % q(book))
def prosrc(sig): return db.one("select prosrc from pg_proc where oid = %s::regprocedure" % q("public." + sig)) or ""
def tb(book=B): return db.one("select to_char(coalesce(sum(amount), 0), 'FM999999990.00') from tally_ledger_day where book_id = %s" % q(book))
def books_ok(tag): ok(all(tb(k) == "0.00" for k in (B, B2)), "%s: the trial balance 0.00 on both books" % tag)
# what the recompute must give: the settled lines whose ids belong together (written here independently of the migration)
RECOMPUTE = """select coalesce(max(r.alter_id)::text, 'null') from tally_recorder_lines r where r.book_id = %s and r.state in ('applied', 'duplicate', 'stale')
  and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') and r.alter_id is not null and r.alter_id < 1000000000000000
  and nullif(r.object_guid, '') is not null and r.object_guid !~ '-0{8}$'
  and (exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.body->'vouchers') = 'array' then r.body->'vouchers' else '[]'::jsonb end) e where e->>'guid' = r.object_guid)
       or (r.object_guid ~ '-[0-9A-Fa-f]{8}$' and coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
           and lower(right(r.object_guid, 8)) = lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0')))"""
def expect(book=B): return db.one(RECOMPUTE % q(book))

REPLACED = ["tally_recorder_line(uuid, uuid, jsonb, bigint)", "tally_recorder_apply(uuid, uuid, uuid, jsonb)", "tally_recorder_release_day(uuid, date)",
            "tally_recorder_release_held(bigint)", "tally_recorder_short_retry(uuid, uuid, jsonb)"]
KEEP = ["tally_ingest_delete(uuid, text, bigint, boolean, text)", "tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb, boolean)",
        "tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)", "tally_days_recorder_release()", "tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text)"]
ROLES = ("public", "anon", "authenticated", "service_role")
def privs(sig): return tuple(db.one("select has_function_privilege(%s, %s, 'execute')" % (q(r), q("public." + sig))) for r in ROLES[1:])
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31'),
                                                                                                  (%(B2)s, %(F)s, 'c2', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31'),
                                                                                                  (%(B3)s, %(F)s, 'c3', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.2.2');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}'), ('c2', %(F)s, 'GARG SHEKHAR & COMPANY (2)', '{"choices": {}}'), ('c3', %(F)s, 'GARG SHEKHAR & COMPANY (3)', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "B2": q(B2), "B3": q(B3), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # book B has a starting point; book B2 none recorded
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s);"
           "insert into tally_sync_cursor (book_id, firm_id) values (%s, %s);"
           "insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG), q(B2), q(F), q(B3), q(F), START, q(CG)))
    print("== before 53 (52's functions): the copy as on staging, then the lines")
    # the copy: 05-Oct-2026 from a Day Book (stored before the lines came, as on staging)
    D5 = [V(G(0x66c6), 54391, "191", "2026-10-05", "Party 191"),
          V(G(0x66d0), 54392, "195", "2026-10-05", "Party 195a"), V(G(0x66d1), 54393, "195", "2026-10-05", "Party 195b"),     # two fits
          V(G(0x66d2), 49000, "196", "2026-10-05", "Party 196"),                                                              # at or below the starting point
          V(G(0x66d3), 54394, "", "2026-10-05", "Party U"),                                                                   # unnumbered
          V(G(0x66d4), 54395, "197", "2026-10-05", "Party 197"),                                                              # (a line received on 06-Oct)
          V(G(0x66d5), 54396, "198", "2026-10-05", "Party 198"),                                                              # (a line whose ids did not belong together)
          V(G(0x66d6), 54397, "199", "2026-10-05", "Party 199"),                                                              # (a line of another case and spaces)
          V(G(0x66d7), 54398, "200", "2026-10-05", "Party 200"),                                                              # (deleted below)
          V(G(0x66e0), 54399, "201", "2026-10-05", "Party 201"),                                                              # (a MasterID making another GUID)
          V(G(0x66e1), 54400, "202", "2026-10-05", "Party 202")]                                                              # (FinCom's short line)
    day("2026-10-05", D5, sum([LN(v["guid"], v["party"], 10 + i) for i, v in enumerate(D5)], []))
    day("2026-10-05", D5, sum([LN(v["guid"], v["party"], 10 + i) for i, v in enumerate(D5)], []), book=B2)
    db.sql("update tally_vouchers set deleted_at = now() where guid = %s" % q(G(0x66d7)))
    L1 = sline("1", "altered", PH, "0", 0, "191", "2026-10-05")                        # staging's line 1
    L4 = sline("4", "created", PH, "0", 0, "192", "2026-10-05")                        # staging's line 4: no copy entry
    L17 = sline("17", "altered", PH, "0", 0, "212", "2026-10-06")                      # staging's line 17: none yet
    X2 = sline("x-two", "altered", PH, "0", 0, "195", "2026-10-05")
    X3 = sline("x-start", "altered", PH, "0", 0, "196", "2026-10-05")
    X4 = sline("x-unnumbered", "altered", PH, "0", 0, "", "2026-10-05")
    X5 = sline("x-late", "altered", PH, "0", 0, "197", "2026-10-05")
    X6 = sline("x-mismatch", "altered", "", "0", 0, "198", "2026-10-05", idsMismatch=True)
    X7 = sline("x-case", "created", PH, "0", 0, " 199 ", "2026-10-05", vch_type="receipt ")
    X8 = sline("x-deleted", "altered", PH, "0", 0, "200", "2026-10-05")
    X9 = sline("x-master", "created", PH, "30583", 0, "201", "2026-10-05")             # MasterID 0x7777: another GUID than ...66e0
    X10 = sline("x-short", "altered", PH, "0", 0, "202", "2026-10-05", fid="FC-NONE", short=True)
    X11 = sline("x-body", "altered", PH, "0", 0, "191", "2026-10-05", vouchers=[V(G(0x66c6), 54391, "191", "2026-10-05", "Party 191")], lines=LN(G(0x66c6), "Party 191", 10))
    LINES = [L1, L4, L17, X2, X3, X4, X5, X6, X7, X8, X9, X10]
    got = states(apply(LINES))
    ok([s for s, _ in got] == ["held"] * len(LINES), "52: every one of these lines held (%s)" % [s for s, _ in got])
    ok(got[0] == ("held", WAIT), "52: staging's line 1 held \"%s\" (%s)" % (WAIT, got[0][1]))
    got2 = states(apply([dict(L1, line_id="b2-1")], book=B2))
    ok(got2 and got2[0][0] == "held", "52: the same line on a book without a starting point: held (%s)" % (got2,))
    db.sql("update tally_recorder_lines set received_at = '2026-10-05 12:00:00+05:30'; update tally_recorder_lines set received_at = '2026-10-06 09:00:00+05:30' where line_id = 'x-late'")
    # 2. recorder_max_alter: lines that settled under 52, one later put back to 'held' (as 51's / 52's corrections did)
    D1o = [V(G(0x6502), 51600, "502", "2026-10-01", "P502"), V(G(0x6503), 51450, "503", "2026-10-01", "P503"), V(FG + "-0000aaaa", 51950, "504", "2026-10-01", "P504"),
           V(G(0x6504), 51986, "505", "2026-10-01", "P505")]
    day("2026-10-01", D1o, sum([LN(v["guid"], v["party"], 100 + i) for i, v in enumerate(D1o)], []))
    got = states(apply([dict(sline("p-app", "created", G(0x6501), str(0x6501), 51500, "501", "2026-10-01"), **body(G(0x6501), 51500, "501", "2026-10-01", "P501", 99)),
                        sline("p-dup", "altered", G(0x6502), str(0x6502), 51600, "502", "2026-10-01"),
                        sline("p-stale", "altered", G(0x6503), str(0x6503), 51400, "503", "2026-10-01"),
                        sline("p-bad", "altered", FG + "-0000aaaa", "999", 51950, "504", "2026-10-01"),
                        sline("p-reheld", "altered", G(0x6504), str(0x6504), 51986, "505", "2026-10-01")]))
    ok([s for s, _ in got] == ["applied", "duplicate", "stale", "duplicate", "duplicate"], "52: the settled lines applied / duplicate / stale / duplicate (ids not together) / duplicate (%s)" % [s for s, _ in got])
    ok(rmax() == "51986", "52: recorder_max_alter raised to 51986 (%s)" % rmax())
    db.sql("update tally_recorder_lines set state = 'held', held_why = 'put back to held by a correction' where line_id = 'p-reheld'")
    db.sql("update tally_sync_cursor set recorder_max_alter = 999 where book_id = %s" % q(B2))
    # review M1 (book B3): Receipt 401 altered in Tally with its body, applied at 54650 (received 13:00); altered AGAIN, the add-on
    # failed: a placeholder altered line (13:30) - the copy holds the OLDER version (54650, not above the settled line's 54650)
    day("2026-10-04", [V(G(0x6800), 54500, "401", "2026-10-04", "P401"), V(G(0x6801), 54510, "402", "2026-10-04", "P402")], LN(G(0x6800), "P401", 40) + LN(G(0x6801), "P402", 41), book=B3)
    got = states(apply([dict(sline("m1-body", "altered", G(0x6800), str(0x6800), 54650, "401", "2026-10-04"), **body(G(0x6800), 54650, "401", "2026-10-04", "P401", 45))], book=B3))
    ok(got and got[0][0] == "applied", "M1: the first alteration of Receipt 401, with its body: applied at 54650 (%s)" % (got,))
    got = states(apply([sline("m1-ph", "altered", PH, "0", 0, "401", "2026-10-04")], book=B3))
    ok(got and got[0][0] == "held", "M1 under 52: the second alteration's placeholder line held (%s)" % (got,))
    db.sql("update tally_recorder_lines set received_at = '2026-10-05 13:00:00+05:30' where line_id = 'm1-body'; update tally_recorder_lines set received_at = '2026-10-05 13:30:00+05:30' where line_id = 'm1-ph';"
           "update tally_recorder_lines set received_at = '2026-10-05 07:55:00+05:30' where line_id = '1'")
    # and Receipt 402: a placeholder altered line received BEFORE any settled line of B3 (07:00): the rule as for line 1
    apply([sline("m1-first", "altered", PH, "0", 0, "402", "2026-10-04")], book=B3)
    db.sql("update tally_recorder_lines set received_at = '2026-10-05 07:00:00+05:30' where line_id = 'm1-first'")
    m1pre = row("m1-ph", B3)
    pre = {k: row(k) for k in ("1", "4", "17", "x-two", "x-start", "x-unnumbered", "x-late", "x-mismatch", "x-case", "x-deleted", "x-master", "x-short")}
    books_ok("before 53")
    print("== migration 53")
    keep = {s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in KEEP}
    old = {s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in REPLACED}
    pv0 = {s: privs(s) for s in REPLACED}
    rr = psql_text(text); ok(rr.returncode == 0, "migration-53 runs (1) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    if rr.returncode: raise SystemExit("cannot go on without the migration")
    mid1 = {k: row(k) for k in pre}; cur1 = (rmax(), rmax(B2), db.one("select xmin::text from tally_sync_cursor where book_id = %s" % q(B)))
    rr = psql_text(text); ok(rr.returncode == 0, "migration-53 runs (2) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    ok({k: row(k) for k in pre} == mid1 and (rmax(), rmax(B2), db.one("select xmin::text from tally_sync_cursor where book_id = %s" % q(B))) == cur1, "run twice: the second run changes no row (lines: state, words, body, payload, xmin; the cursor's xmin)")
    ok({s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in KEEP} == keep, "53 leaves the other functions as they were (%s)" % ", ".join(s.split("(")[0] for s in KEEP))
    ok(all(hashlib.md5(prosrc(s).encode()).hexdigest() != old[s] for s in REPLACED), "53 replaces: %s" % ", ".join(s.split("(")[0] for s in REPLACED))
    bodies = re.findall(r"create or replace function public\.(\w+)\((.*?)\)\s*returns.*?\$function\$(.*?)\$function\$", text, re.S)
    sig = lambda args: ", ".join(re.sub(r"^\s*p_\w+\s+", "", a).strip() for a in args.split(",")) if args.strip() else ""
    ok(sorted("%s(%s)" % (n, sig(a)) for n, a, _ in bodies) == sorted(REPLACED + ["tally_recorder_ids_together(bigint)"]), "the functions in the file: the five replaced (same arguments) and tally_recorder_ids_together(bigint) (%s)" % sorted("%s(%s)" % (n, sig(a)) for n, a, _ in bodies))
    md5s = {}
    for name, args, src in bodies:
        rp = "public.%s(%s)" % (name, sig(args))
        rw = (db.rows("select md5(prosrc) as m, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where oid = %s::regprocedure" % q(rp)) or [{}])[0]
        md5s[rp] = rw.get("m")
        ok(rw.get("m") == hashlib.md5(src.encode()).hexdigest() and rw.get("prosecdef") == "t" and rw.get("conf", "").replace(" ", "") == "search_path=public,pg_temp", "md5(prosrc) of %s = %s (the file's text); security definer, search_path = public, pg_temp" % (rp, rw.get("m")))
    ok({s: privs(s) for s in REPLACED} == pv0, "the grants of the five replaced functions as before 53 (%s)" % {s.split("(")[0]: privs(s) for s in REPLACED})
    def pv(who, sg):
        try: return db.one("select has_function_privilege('%s', 'public.%s', 'execute')" % (who, sg))
        except RuntimeError: return None
    ok([pv(w, "tally_recorder_line(uuid, uuid, jsonb, bigint)") for w in ("anon", "authenticated", "service_role")] == ["f", "f", "f"], "tally_recorder_line granted to nobody (as 50, 51, 52)")
    ok([pv(w, "tally_recorder_ids_together(bigint)") for w in ("anon", "authenticated", "service_role")] == ["f", "f", "f"], "tally_recorder_ids_together granted to nobody")
    l52 = open(os.path.join(SQLDIR, "migration-52-recorder-duplicate-needs-same-entry.sql")).read()
    f52 = re.search(r"\$function\$(.*?)\$function\$", l52, re.S).group(1)
    f53 = dict((n, s) for n, a, s in bodies).get("tally_recorder_line", "")
    gone = [ln for ln in f52.split("\n") if ln not in f53.split("\n")]
    ok(gone == [] and len(f53.split("\n")) > len(f52.split("\n")), "tally_recorder_line keeps every line of 52's text (53 only adds lines) (%s)" % gone)
    print("== 1. the correction")
    now = {k: row(k) for k in pre}
    W1 = W53 % ("Receipt", "191", "05-Oct-2026", G(0x66c6), 54391)
    ok((now["1"]["state"], now["1"]["why"]) == ("duplicate", W1), "staging's line 1: 'duplicate', \"%s\" (%s)" % (W1, now["1"]["why"]))
    WC = W53 % ("Receipt", "199", "05-Oct-2026", G(0x66d6), 54397)
    ok((now["x-case"]["state"], now["x-case"]["why"]) == ("duplicate", WC), "type 'receipt ' and number ' 199 ' against the copy's Receipt 199: 'duplicate' (%s)" % (now["x-case"]["why"],))
    for k, w in (("4", "line 4 (Receipt 192: no entry in the copy)"), ("17", "line 17 (Receipt 212: none yet)"), ("x-two", "two live Receipt 195 of 05-Oct"), ("x-start", "the entry at AlterID 49000, below the starting point 50000"),
                 ("x-unnumbered", "an unnumbered line"), ("x-late", "a line received on 06-Oct (beyond the correction)"), ("x-mismatch", "a line whose ids did not belong together (idsMismatch)"),
                 ("x-deleted", "the entry deleted"), ("x-master", "a MasterID making another GUID than the entry's"), ("x-short", "FinCom's short line")):
        ok(now[k]["state"] == "held" and now[k]["xm"] == pre[k]["xm"], "%s: stays held, untouched (%s)" % (w, sw(k)))
    ok(db.one("select count(*) from tally_recorder_lines where held_why like 'the copy holds % already (GUID %, AlterID %, from a Day Book or another line)'") == "3", "exactly three rows changed (line 1, the one of another case, and review M1's line received before any settled line)")
    ok(all(now[k]["pm"] == pre[k]["pm"] for k in pre), "payloads unchanged")
    ok(sw("b2-1", B2)[0] == "held", "the book without a starting point: line 1's twin stays held (%s)" % (sw("b2-1", B2),))
    ok(sw("m1-ph", B3)[0] == "held" and row("m1-ph", B3)["xm"] == m1pre["xm"], "review M1: an altered placeholder line whose entry the copy holds only at the AlterID of a settled line received before it (54650): stays held, untouched (%s)" % (sw("m1-ph", B3),))
    ok(sw("m1-first", B3) == ("duplicate", W53 % ("Receipt", "402", "04-Oct-2026", G(0x6801), 54510)), "review M1: one received before any settled line of its book: 'duplicate' (%s)" % (sw("m1-first", B3),))
    print("== 1. the rule on new lines (the function)")
    got = states(apply([dict(L1, line_id="1-again"), dict(X2, line_id="x-two-again"), dict(X3, line_id="x-start-again"), dict(X4, line_id="x-unnumbered-again"), dict(X9, line_id="x-master-again"), X11]))
    ok(got[0] == ("duplicate", W1), "line 1 sent again: 'duplicate' at once (%s)" % (got[0],))
    ok([s for s, _ in got[1:5]] == ["held"] * 4, "two fits / below the starting point / unnumbered / another MasterID: held (%s)" % [s for s, _ in got[1:5]])
    ok(got[5][0] == "held", "a placeholder line WITH a body: not this rule (held as 52: never an entry under the placeholder) (%s)" % (got[5],))
    got = states(apply([dict(L1, line_id="b2-1-again")], book=B2))
    ok(got[0][0] == "held", "no starting point recorded: held (%s)" % (got,))
    got = states(apply([sline("m1-again", "altered", PH, "0", 0, "401", "2026-10-04")], book=B3))
    ok(got[0][0] == "held", "review M1, the function: the second alteration's placeholder line sent again: held (the copy is not above the settled 54650) (%s)" % (got,))
    got = states(apply([sline("m1-created", "created", PH, "0", 0, "401", "2026-10-04")], book=B3))
    ok(got[0][0] == "duplicate", "review M1: 'created' unchanged (%s)" % (got,))
    day("2026-10-04", [V(G(0x6800), 54700, "401", "2026-10-04", "P401"), V(G(0x6801), 54510, "402", "2026-10-04", "P402")], LN(G(0x6800), "P401", 47) + LN(G(0x6801), "P402", 41), book=B3)
    ok(sw("m1-ph", B3)[0] == "duplicate" and sw("m1-again", B3)[0] == "duplicate", "review M1: a Day Book bringing Receipt 401 at 54700 (above 54650): the held placeholder lines 'duplicate' (%s, %s)" % (sw("m1-ph", B3), sw("m1-again", B3)))
    print("== 1. the release path: a Day Book stored later")
    ok(sw("17")[0] == "held", "line 17 held before its Day Book")
    got = states(apply([sline("x-later", "altered", PH, "0", 0, " 301", "2026-10-06", vch_type="RECEIPT")]))
    ok(got[0][0] == "held", "a line for RECEIPT ' 301' of 06-Oct: held (no entry yet) (%s)" % (got,))
    D6 = [V(G(0x6700), 54500, "212", "2026-10-06", "Party 212"), V(G(0x6701), 54501, "301", "2026-10-06", "Party 301")]
    day("2026-10-06", D6, LN(G(0x6700), "Party 212", 50) + LN(G(0x6701), "Party 301", 60))
    s17 = sw("17")
    ok(s17[0] == "duplicate" and s17[1].startswith("the copy holds Receipt 212 of 06-Oct-2026 already (GUID %s, AlterID 54500" % G(0x6700)), "line 17: the Day Book of 06-Oct holding Receipt 212 makes it 'duplicate' (%s)" % (s17,))
    ok(sw("x-later") == ("duplicate", W53 % ("Receipt", "301", "06-Oct-2026", G(0x6701), 54501)), "type / number differing only in case and spaces: the day release finds it, 'duplicate' (%s)" % (sw("x-later"),))
    books_ok("after the release")
    print("== 2. recorder_max_alter")
    ok(cur1[0] == "51600" and cur1[0] == expect(), "recomputed: 51600 (the applied 51500 with its body, the duplicate 51600 and the stale 51400 whose GUIDs are their MasterIDs; not the 51950 of a GUID that is not its MasterID's, not the re-held 51986) (%s; expected %s)" % (cur1[0], expect()))
    ok(cur1[1] == "null", "a book with no settled line whose ids belong together: null (was 999) (%s)" % cur1[1])
    got = states(apply([sline("q-bad", "altered", FG + "-0000bbbb", "998", 53000, "601", "2026-10-02")]))
    ok(got[0][0] == "held" and rmax() == "51600", "a line for an entry not in the copy: held, nothing raised (%s, %s)" % (got, rmax()))
    day("2026-10-02", [V(FG + "-0000bbbb", 53000, "601", "2026-10-02", "P601")], LN(FG + "-0000bbbb", "P601", 70))
    got = states(apply([sline("q-bad2", "altered", FG + "-0000bbbb", "998", 53000, "601", "2026-10-02")]))
    ok(got[0][0] == "duplicate" and rmax() == "51600", "a 'duplicate' line whose GUID is not its MasterID's (another company's prefix): never raises it (%s, %s)" % (got, rmax()))
    got = states(apply([dict(sline("q-good", "created", G(0x6505), str(0x6505), 52000, "602", "2026-10-02"), **body(G(0x6505), 52000, "602", "2026-10-02", "P602", 80))]))
    ok(got[0][0] == "applied" and rmax() == "52000", "an applied line with Tally's body: raises it to 52000 (%s, %s)" % (got, rmax()))
    got = states(apply([sline("q-del", "deleted", FG + "-0000dddd", "996", 53500, "603", "2026-10-03")]))
    ok(got[0][0] == "held" and rmax() == "52000", "a delete of an entry not in the copy: held (%s, %s)" % (got, rmax()))
    day("2026-10-03", [V(FG + "-0000dddd", 53400, "603", "2026-10-03", "P603")], LN(FG + "-0000dddd", "P603", 90))
    ok(sw("q-del")[0] == "applied" and rmax() == "52000", "the day release applies that delete; its GUID is not its MasterID's: never raised (52's release_day raised it to 53500) (%s, %s)" % (sw("q-del"), rmax()))
    # no function puts a settled line back to 'held': the owner's release refuses it, a day stored again leaves it
    good = row("q-good")
    rel = j("select tally_recorder_release_held(%s)::text" % good["id"], OWNER)
    day("2026-10-02", [V(FG + "-0000bbbb", 53000, "601", "2026-10-02", "P601"), V(G(0x6505), 52000, "602", "2026-10-02", "P602")], LN(FG + "-0000bbbb", "P601", 70) + LN(G(0x6505), "P602", 80))
    ok("_error" in rel and "not held" in rel["_error"] and row("q-good")["state"] == "applied" and rmax() == "52000", "a settled line is never re-held by a function: the owner's release refuses it, its Day Book stored again leaves it applied (%s)" % (rel.get("_error", rel)[:120] if isinstance(rel, dict) else rel,))
    ok(rmax() == expect(), "the column equals the recompute after all of this (%s = %s)" % (rmax(), expect()))
    for fn in ("tally_recorder_apply", "tally_recorder_release_day", "tally_recorder_release_held", "tally_recorder_short_retry", "tally_recorder_line"):
        src = dict((n, s) for n, a, s in bodies).get(fn, "")
        ok(len(re.findall(r"update tally_sync_cursor set recorder_max_alter", src)) >= 1 and all("tally_recorder_ids_together(" in src[max(0, m.start() - 600):m.start()] for m in re.finditer(r"update tally_sync_cursor set recorder_max_alter", src)),
           "%s: every raise has the check within the lines before it" % fn)
    books_ok("the end")
    print("\n  md5(prosrc) of 53's functions (after applying on the stand):")
    for k, v in md5s.items(): print("    %-60s %s" % (k, v))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
