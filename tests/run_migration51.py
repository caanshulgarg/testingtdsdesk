"""python3 run_migration51.py - migration-51-recorder-ids-mismatch (05-Oct-2026). FinCom Bridge 2.2.2 found that the
add-on's GUID and MasterID do not always belong to the same entry (NWS144: MasterID 25682 written with the GUID ...6345,
which is MasterID 25413's entry). 50 then marked such lines 'duplicate' because the copy holds the entry the WRONG GUID
names. 2.2.2 sends per line idsMismatch (true when the add-on's GUID was not the line's MasterID's; object_guid is then ""
unless Tally gave the entry), lineGuid (the add-on's GUID, words only) and heldWhy (the bridge's plain reason for a line
without the entry's body). On throwaway PostgreSQL (pg_stand, port 30510; never a real database), built in staging's order
32 -> 33 -> 35 -> 34 (as run on staging) -> 36b -> 37 -> 36 -> 38 -> ... -> 49 -> 50, then 51 (twice). Checks:
  0. before 51 (50's text): the staging-like lines come out 'duplicate', and each idsMismatch line too (GUID, MasterID,
     type+number+date lookups; a body at the copy's AlterID): the wrong verdicts 51 corrects.
  1. idsMismatch: never 'duplicate' on any lookup. Without a body: 'held', held_why = heldWhy if given, else "the add-on's ids
     did not belong together (GUID <lineGuid> is another entry's); held until FinCom Bridge 2.2.2 sends the entry as Tally
     gives it"; with a body: applied by Tally's GUID (also at the AlterID the copy holds). A line without the flag whose GUID
     is not its MasterID's and has no body (an older bridge's) is the same. A Day Book stored, an owner's release: still held.
  2. any line without a body: heldWhy given -> held_why is it; 50's release rules kept (a Day Book holding the MasterID's
     entry -> 'duplicate'; a later line of the GUID applied -> 'replaced').
  3. the correction: the rows stored 'duplicate' whose own payload has object_guid's last 8 hex digits <> payload master_id in
     hex (both there, master_id > 0, not the placeholder -00000000) -> 'held', "marked duplicate on 05-Oct-2026 on a GUID that
     was not this entry's (<guid>); held until FinCom Bridge 2.2.2 sends the entry as Tally gives it", body and payload
     unchanged, released_at / released_by untouched; exactly 25682/...6345, 25683/...6346, 25684/...6332 (and one on the
     proof book); 25413/...00006345 and a placeholder stay 'duplicate'; an 'applied' mismatched row untouched; run twice:
     nothing more changes.
  4. a later line carrying the entry, line_id = the held line's + ":resolved", replaces it ('replaced') for the re-held rows
     and the 2.2.2 held lines, whether it ends applied or 'duplicate' (the copy holding Tally's entry already).
  REVIEW of 51 (f1ea268): M the inferred mismatch only for a GUID under the line's own company GUID (an entry from Tally sync or
     an XML import keeps another company's prefix and its own source MasterID: genuine), and the correction likewise and
     bounded to rows received on or before 05-Oct-2026 (IST); L1 a ":resolved" line ending 'stale' replaces too; L2 a held
     flagged delete / cancel replaced by the later delete / cancel applied under Tally's GUID (its ":resolved" line, or the
     GUID its MasterID makes under its company): nothing deleted on a guess; L3 the replace guard reads idsMismatch in any case;
     L4 a matched short line keeps 50's words, heldWhy appended.
  The file: begin; set local lock_timeout = '10s'; commit; no "delete from" (comments too); no drop / truncate; every function
  security definer, search_path = public, pg_temp, granted to nobody as 50's tally_recorder_line; md5(prosrc) = the file's
  text between its $function$ marks (printed). The trial balance 0.00 and the day cache equal to one computed afresh.
RED: before the file exists, it stops at the first check (python3 run_migration51.py)."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql")]
M51 = os.environ.get("M51_FILE") or os.path.join(SQLDIR, "migration-51-recorder-ids-mismatch.sql")
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
B, B2, D1 = "f79e4bc3-871d-4482-874d-71c5fb2a1b33", "f79e4bc3-871d-4482-874d-000000000051", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"                                                   # GARG SHEKHAR & COMPANY's company GUID
FG = "0d8a1c2e-1111-2222-3333-444455556666"                                                   # another company's GUID (an entry synced or imported from it)
PH = CG + "-00000000"
G = lambda mid: CG + "-%08x" % mid                                                            # the GUID a MasterID makes
MARKED = "marked duplicate on 05-Oct-2026 on a GUID that was not this entry's (%s); held until FinCom Bridge 2.2.2 sends the entry as Tally gives it"
MISMATCH = "the add-on's ids did not belong together (GUID %s is another entry's); held until FinCom Bridge 2.2.2 sends the entry as Tally gives it"
REPLACED = "replaced by line %s (the entry's details arrived)"

text = open(M51).read() if os.path.exists(M51) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M51))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "51: begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok("delete from" not in low, "51: no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", low) and not re.search(r"\btruncate\b", low), "51: add-only (no drop, no truncate)")

def sline(lid, ev, og, mid, alt, no, day, saved="2026-10-05T02:30:00.000Z", **kw):
    x = {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.2.2", "vch_no": no, "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alt, "saved_at": saved,
         "vch_date": day, "vch_type": "Receipt", "master_id": mid, "object_guid": og, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY"}
    x.update(kw); return x
def V(guid, alter, no, party="", day=None):
    v = {"guid": guid, "alter": alter, "type": "Receipt", "no": no, "party": party, "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None}
    if day: v["day"] = day
    return v
def LN(guid, party, amt): return [[guid, "Cash", -amt, "", None, []], [guid, party, amt, "", None, []]]
def body(guid, alter, no, party, amt, day): return {"vouchers": [V(guid, alter, no, party, day)], "lines": LN(guid, party, amt)}

db = pg_stand.start(30510)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines, book=B): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(book), q(D1), js(lines)))
def states(r): return [(x.get("state"), x.get("why")) for x in r.get("results", [])] if isinstance(r, dict) else r
def day(d, vouchers, lines, book=B): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def row(lid, book=B): return (db.rows("select id, state, coalesce(held_why, '') as why, md5(coalesce(body::text, '-')) as bm, md5(coalesce(payload::text, '-')) as pm, xmin::text as xm, coalesce(released_at::text, '') as rel, coalesce(released_by::text, '') as relby from tally_recorder_lines where book_id = %s and line_id = %s order by id desc limit 1" % (q(book), q(lid))) or [{}])[0]
def sw(lid, book=B): r = row(lid, book); return (r.get("state"), r.get("why"))
def vch(g, book=B): return (db.rows("select alter_id, vno, day, deleted_at is not null as deleted from tally_vouchers where book_id = %s and guid = %s" % (q(book), q(g))) or [{}])[0]
def tb(book=B): return db.one("select to_char(coalesce(sum(amount), 0), 'FM999999990.00') from tally_ledger_day where book_id = %s" % q(book))
def fresh_ok(book=B):
    a = db.one("""select md5(coalesce(string_agg(concat_ws(',', ledger, day, amount, n), '|' order by ledger, day), '')) from (select l.ledger, l.day, sum(l.amount) as amount, count(*) as n
                  from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid where l.book_id = %s and v.deleted_at is null and not v.cancelled and not v.optional group by l.ledger, l.day) x""" % q(book))
    b = db.one("select md5(coalesce(string_agg(concat_ws(',', ledger, day, amount, n), '|' order by ledger, day), '')) from tally_ledger_day where book_id = %s and amount <> 0" % q(book))
    return a == b
def books_ok(tag): ok(all(tb(k) == "0.00" and fresh_ok(k) for k in (B, B2)), "%s: the trial balance 0.00 on both books; the ledger-day cache equals the one computed afresh" % tag)
def prosrc(sig): return db.one("select prosrc from pg_proc where oid = %s::regprocedure" % q("public." + sig)) or ""
# the copy of 04-Oct-2026: MasterIDs 25413 (GUID ...6345), 25414 (...6346), 25394 (...6332) as Tally has them
D4 = "2026-10-04"
DAY4 = ([V(G(25413), 70000, "345", "Debtor A"), V(G(25414), 70001, "346", "Debtor B"), V(G(25394), 70002, "332", "Debtor C")],
        LN(G(25413), "Debtor A", 100) + LN(G(25414), "Debtor B", 200) + LN(G(25394), "Debtor C", 300))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31'),
                                                                                                  (%(B2)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.2.2');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "B2": q(B2), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    day(D4, *DAY4); day(D4, *DAY4, book=B2)
    books_ok("the copy of 04-Oct")
    # ---------------------------------------------------------------- 0. before 51: 50's wrong verdicts
    print("== before 51 (50's tally_recorder_line)")
    X1 = sline("x1", "altered", G(0x6345), "25682", 70000, "601", D4)       # staging: MasterID 25682 written with ...6345 (25413's)
    X2 = sline("x2", "altered", G(0x6346), "25683", 70001, "602", D4)       # 25683 with ...6346 (25414's)
    X3 = sline("x3", "created", G(0x6332), "25684", 70002, "603", D4)       # 25684 with ...6332 (25394's)
    K1 = sline("k1", "altered", G(0x6345), "25413", 70000, "345", D4)       # the GUID is its MasterID's: a true duplicate
    P1 = sline("p1", "created", PH, "25414", 0, "346", D4)                  # the placeholder, MasterID 25414: a true duplicate
    A1 = dict(sline("a1", "created", G(0x6399), "25600", 70010, "604", "2026-10-02"), **body(G(0x6399), 70010, "604", "Debtor D", 50, "2026-10-02"))   # applied, ids not together
    day("2026-10-01", [V(FG + "-00001234", 70003, "801", "Debtor I")], LN(FG + "-00001234", "Debtor I", 60))     # an imported entry: another company's GUID prefix
    F1 = sline("f1", "altered", FG + "-00001234", "25750", 70003, "801", "2026-10-01")   # its GUID's hex is the SOURCE company's MasterID: genuine, not a mismatch
    LT = sline("late1", "altered", G(0x6346), "25760", 70001, "802", D4)                 # a mismatch received after 05-Oct-2026 (IST): beyond the correction
    got = states(apply([X1, X2, X3, K1, P1, A1, F1, LT]))
    f1_why = got[6][1]
    ok([s for s, _ in got] == ["duplicate"] * 5 + ["applied"] + ["duplicate"] * 2, "50: the staging-like lines 25682/...6345, 25683/...6346, 25684/...6332 'duplicate' (wrong), 25413/...6345 and the placeholder 'duplicate', the bodied one applied (%s)" % got)
    # the proof book: each idsMismatch line as 2.2.2 sends it, through 50
    PM1 = sline("pm1", "altered", G(0x6345), "25686", 70000, "701", D4, idsMismatch=True, lineGuid=G(0x6345))                               # by GUID
    PM2 = sline("pm2", "created", "", "25413", None, "702", D4, idsMismatch=True, lineGuid=G(0x6399))                                        # by MasterID
    PM3 = sline("pm3", "created", "", "0", None, "345", D4, idsMismatch=True, lineGuid=G(0x6346))                                            # by type + number + date
    PM4 = dict(sline("pm4", "altered", G(25413), "25413", 70000, "345", D4, idsMismatch=True, lineGuid=G(0x6332)), **body(G(25413), 70000, "345", "Debtor A", 100, D4))   # Tally's entry, the copy's AlterID
    got = states(apply([PM1, PM2, PM3, PM4], book=B2))
    ok([s for s, _ in got] == ["duplicate"] * 4, "50: every idsMismatch line 'duplicate' on some lookup (GUID, MasterID, type+number+date, the copy's AlterID) (%s)" % got)
    # the arrival times as on staging (never the test machine's clock)
    db.sql("update tally_recorder_lines set received_at = '2026-10-05 08:00:00+05:30'; update tally_recorder_lines set received_at = '2026-10-06 09:00:00+05:30' where line_id = 'late1'")
    pre = {k: row(k) for k in ("x1", "x2", "x3", "k1", "p1", "a1", "f1", "late1")}
    pre2 = {k: row(k, B2) for k in ("pm1", "pm2", "pm3", "pm4")}
    books_ok("before 51")
    # ---------------------------------------------------------------- 51, twice
    print("== migration 51")
    l50 = prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)")
    keep = {s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in ("tally_recorder_apply(uuid, uuid, uuid, jsonb)", "tally_recorder_release_day(uuid, date)", "tally_ingest_delete(uuid, text, bigint, boolean, text)",
                                                                     "tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb, boolean)", "tally_recorder_release_held(bigint)")}
    rr = psql_text(text); ok(rr.returncode == 0, "migration-51 runs (1) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    if rr.returncode: raise SystemExit("cannot go on without the migration")
    mid1 = {k: row(k) for k in pre}; mid2 = {k: row(k, B2) for k in pre2}
    rr = psql_text(text); ok(rr.returncode == 0, "migration-51 runs (2) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    ok({k: row(k) for k in pre} == mid1 and {k: row(k, B2) for k in pre2} == mid2, "run twice: the second run changes no row (state, words, body, payload, xmin)")
    ok({s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in keep} == keep and prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)") != l50,
       "51 replaces tally_recorder_line only (apply, release_day, ingest_delete, ingest_day, ingest_entries, release_held unchanged)")
    bodies = re.findall(r"create or replace function public\.(\w+)\((.*?)\)\s*returns.*?\$function\$(.*?)\$function\$", text, re.S)
    sig = lambda args: ", ".join(re.sub(r"^\s*p_\w+\s+", "", a).strip() for a in args.split(",")) if args.strip() else ""
    names = sorted((n, sig(a)) for n, a, _ in bodies)
    ok(names == [("tally_recorder_line", "uuid, uuid, jsonb, bigint")], "the functions in the file: tally_recorder_line (same arguments) (%s)" % names)
    md5s = {}
    for name, args, src in bodies:
        rp = "public.%s(%s)" % (name, sig(args))
        rw = (db.rows("select md5(prosrc) as m, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where oid = %s::regprocedure" % q(rp)) or [{}])[0]
        fm = hashlib.md5(src.encode()).hexdigest(); md5s[rp] = rw.get("m")
        ok(rw.get("m") == fm and rw.get("prosecdef") == "t" and rw.get("conf", "").replace(" ", "") == "search_path=public,pg_temp", "md5(prosrc) of %s = %s (the file's text); security definer, search_path = public, pg_temp" % (rp, rw.get("m")))
    pv = lambda who, sg: db.one("select has_function_privilege('%s', 'public.%s', 'execute')" % (who, sg))
    ok([pv(w, "tally_recorder_line(uuid, uuid, jsonb, bigint)") for w in ("anon", "authenticated", "service_role")] == ["f", "f", "f"], "tally_recorder_line granted to nobody (as 50)")
    # ---------------------------------------------------------------- 3. the correction
    print("== 3. the correction of 50's wrong verdicts")
    now = {k: row(k) for k in pre}
    ok({k: (v["state"], v["why"]) for k, v in now.items() if k in ("x1", "x2", "x3")} == {"x1": ("held", MARKED % G(0x6345)), "x2": ("held", MARKED % G(0x6346)), "x3": ("held", MARKED % G(0x6332))},
       "25682/...6345, 25683/...6346, 25684/...6332: held, \"marked duplicate on 05-Oct-2026 on a GUID that was not this entry's (<guid>); ...\" (%s)" % {k: now[k]["why"] for k in ("x1", "x2", "x3")})
    ok(all(now[k]["bm"] == pre[k]["bm"] and now[k]["pm"] == pre[k]["pm"] and now[k]["rel"] == "" and now[k]["relby"] == "" for k in pre), "body and payload unchanged; released_at / released_by untouched")
    ok((now["k1"]["state"], now["p1"]["state"], now["a1"]["state"]) == ("duplicate", "duplicate", "applied") and all(now[k]["xm"] == pre[k]["xm"] for k in ("k1", "p1", "a1")),
       "25413/...00006345 (its own GUID) and the placeholder keep 'duplicate'; the applied mismatched row untouched (not rewritten)")
    ok(now["f1"]["state"] == "duplicate" and now["f1"]["xm"] == pre["f1"]["xm"], "review M: a GUID under another company's prefix (synced / imported) with a different local MasterID keeps 'duplicate' (%s)" % now["f1"]["state"])
    ok(now["late1"]["state"] == "duplicate" and now["late1"]["xm"] == pre["late1"]["xm"], "review M: a mismatched 'duplicate' received after 05-Oct-2026 (IST) is beyond the correction (%s)" % now["late1"]["state"])
    now2 = {k: row(k, B2) for k in pre2}
    ok({k: v["state"] for k, v in now2.items()} == {"pm1": "held", "pm2": "duplicate", "pm3": "duplicate", "pm4": "duplicate"} and now2["pm1"]["why"] == MARKED % G(0x6345),
       "the proof book: only the row whose payload GUID is not its MasterID's re-held (GUID ''-lines and Tally's own pair keep their verdict) (%s)" % {k: v["state"] for k, v in now2.items()})
    ok(db.one("select count(*) from tally_recorder_lines where held_why like 'marked duplicate on 05-Oct-2026%'") == "4", "exactly four rows changed in all")
    books_ok("after 51")
    # ---------------------------------------------------------------- 1. idsMismatch: never 'duplicate'
    print("== 1. idsMismatch lines")
    HW = "Tally gave no entry for MasterID 25686 (asked 3 times)"
    NM = [sline("n-m1", "altered", G(0x6345), "25686", 70000, "701", D4, idsMismatch=True, lineGuid=G(0x6345), heldWhy=HW),
          sline("n-m2", "created", "", "25413", None, "702", D4, idsMismatch=True, lineGuid=G(0x6399)),
          sline("n-m3", "created", "", "0", None, "345", D4, idsMismatch=True, lineGuid=G(0x6346)),
          dict(sline("n-m4", "altered", G(25413), "25413", 70000, "345", D4, idsMismatch=True, lineGuid=G(0x6332)), **body(G(25413), 70000, "345", "Debtor A", 100, D4)),
          dict(sline("n-m5", "created", G(25712), "25712", 70020, "705", "2026-10-02", idsMismatch=True, lineGuid=G(0x6345)), **body(G(25712), 70020, "705", "Debtor E", 70, "2026-10-02")),
          sline("n-m6", "deleted", "", "25686", 70030, "701", D4, idsMismatch=True, lineGuid=G(0x6345)),
          sline("n-d1", "altered", G(0x6345), "25690", 70000, "706", D4)]     # an older bridge's line: no flag, its GUID not its MasterID's, no body
    got = states(apply(NM))
    ok(got[0] == ("held", HW), "by GUID (the copy holds ...6345 at that AlterID), no body, heldWhy given: held with the bridge's words (%s)" % (got[0],))
    ok(got[1] == ("held", MISMATCH % G(0x6399)), "by MasterID (25413's entry in the copy), no body: held with the plain words naming lineGuid (%s)" % (got[1],))
    ok(got[2] == ("held", MISMATCH % G(0x6346)), "by type + number + date (Receipt 345 of 04-Oct in the copy), no body: held (%s)" % (got[2],))
    ok(got[3][0] == "applied" and vch(G(25413)).get("alter_id") == "70000", "with a body (Tally's entry) at the AlterID the copy holds: applied by Tally's GUID, never 'duplicate' (%s)" % (got[3],))
    ok(got[4][0] == "applied" and vch(G(25712)).get("vno") == "705", "with a body, a new entry: applied by Tally's GUID, in the copy (%s, %s)" % (got[4], vch(G(25712))))
    ok(got[5] == ("held", MISMATCH % G(0x6345)), "a delete with the ids not together: held, nothing deleted (%s)" % (got[5],))
    ok(got[6] == ("held", MISMATCH % G(0x6345)), "an older bridge's line, no flag, GUID ...6345 with MasterID 25690, no body: held, not 'duplicate' (%s)" % (got[6],))
    ok(not any(s == "duplicate" for s, _ in got), "none of them 'duplicate'")
    got = states(apply([dict(F1, line_id="f2")]))
    ok(got == [("duplicate", f1_why)], "review M: a new line with another company's GUID prefix behaves exactly as under 50 (%s)" % got)
    books_ok("idsMismatch lines")
    # ---------------------------------------------------------------- 2. heldWhy on any line without a body; 50's release kept
    print("== 2. heldWhy on a line without a body")
    HW2, HW3 = "Tally did not give this entry yet (asked 2 of 20 times)", "Tally's entry could not be read for this change (asked 1 of 20 times)"
    got = states(apply([sline("n-h1", "created", "", "25720", None, "707", "2026-10-03", heldWhy=HW2), sline("n-h2", "altered", G(25728), "25728", 70050, "708", "2026-10-03", heldWhy=HW3),
                        sline("n-h3", "created", "", "25730", None, "709", "2026-10-03")]))
    ok(got == [("held", HW2), ("held", HW3), ("held", "waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book")],
       "no body: held_why = heldWhy when given (no GUID; a real GUID), else 50's words (%s)" % got)
    day("2026-10-03", [V(G(25720), 70040, "707", "Debtor F")], LN(G(25720), "Debtor F", 80))
    ok(sw("n-h1")[0] == "duplicate", "50's release kept: the 03-Oct Day Book holding MasterID 25720's entry -> 'duplicate' (%s)" % (sw("n-h1"),))
    got = states(apply([dict(sline("n-h2b", "altered", G(25728), "25728", 70050, "708", "2026-10-03"), **body(G(25728), 70050, "708", "Debtor G", 90, "2026-10-03"))]))
    ok(got[0][0] == "applied" and sw("n-h2") == ("replaced", REPLACED % row("n-h2b")["id"]), "50's release kept: the same GUID's line with its body applied -> the held one 'replaced' (%s)" % (sw("n-h2"),))
    books_ok("heldWhy")
    # ---------------------------------------------------------------- the mismatched held lines stay held when a Day Book comes, or an owner releases
    print("== a Day Book of 04-Oct stored again; an owner's release")
    w_before = {k: sw(k) for k in ("x1", "x2", "x3", "n-m1", "n-m2", "n-m3", "n-d1")}
    day(D4, *DAY4)
    ok({k: sw(k) for k in w_before} == w_before, "04-Oct's Day Book (holding ...6345, ...6346, ...6332 and Receipt 345) stored: every mismatched line still held, its words kept (%s)" % {k: sw(k)[0] for k in w_before})
    rel = j("select tally_recorder_release_held(%s)::text" % row("x1")["id"], OWNER)
    ok(rel.get("state") == "held" and sw("x1") == ("held", MARKED % G(0x6345)), "an owner's release of 25682's re-held line: still held, its words kept (%s)" % rel)
    rel = j("select tally_recorder_release_held(%s)::text" % row("n-m2")["id"], OWNER)
    ok(rel.get("state") == "held" and sw("n-m2") == ("held", MISMATCH % G(0x6399)), "an owner's release of a 2.2.2 mismatched line: still held (%s)" % rel)
    books_ok("released again")
    # ---------------------------------------------------------------- 4. the line that carries the entry: ":resolved" replaces it
    print("== 4. the entry as Tally gives it (line_id + \":resolved\")")
    day("2026-10-06", [V(G(25683), 70101, "602", "Debtor X2")], LN(G(25683), "Debtor X2", 20))     # the copy holds 25683's entry already
    ok(sw("x2")[0] == "held", "the Day Book holding 25683's own entry does not touch 25683's re-held line (its stored GUID is another's) (%s)" % (sw("x2"),))
    R = [dict(sline("x1:resolved", "created", G(25682), "25682", 70100, "601", "2026-10-05"), **body(G(25682), 70100, "601", "Debtor X1", 10, "2026-10-05")),
         dict(sline("x2:resolved", "altered", G(25683), "25683", 70101, "602", "2026-10-06"), **body(G(25683), 70101, "602", "Debtor X2", 20, "2026-10-06")),
         dict(sline("x3:resolved", "created", G(25684), "25684", 70102, "603", "2026-10-05", idsMismatch=True, lineGuid=G(0x6332)), **body(G(25684), 70102, "603", "Debtor X3", 30, "2026-10-05")),
         dict(sline("n-m2:resolved", "created", G(25413), "25413", 70000, "345", D4), **body(G(25413), 70000, "345", "Debtor A", 100, D4)),
         dict(sline("n-m3:resolved", "created", G(25740), "25740", 70110, "345", "2026-10-05"), **body(G(25740), 70110, "345", "Debtor H", 40, "2026-10-05"))]
    got = states(apply(R))
    ok([s for s, _ in got] == ["applied", "duplicate", "applied", "duplicate", "applied"], "the resolved lines: applied, or 'duplicate' where the copy holds Tally's entry at that AlterID (%s)" % got)
    rep = {k: sw(k) for k in ("x1", "x2", "x3", "n-m2", "n-m3")}
    ok(rep == {k: ("replaced", REPLACED % row(k + ":resolved")["id"]) for k in rep}, "each held line replaced by its \":resolved\" line: the three re-held rows and two 2.2.2 lines (%s)" % rep)
    ok(vch(G(25682)).get("vno") == "601" and vch(G(25684)).get("vno") == "603" and vch(G(0x6345)).get("vno") == "345" and vch(G(0x6346)).get("vno") == "346",
       "the entries in the copy under Tally's GUIDs; 25413's and 25414's entries untouched")
    ok(sw("n-m1")[0] == "held" and sw("n-d1")[0] == "held", "lines without their \":resolved\" line stay held")
    ok(db.one("select count(*) from tally_vouchers where guid ~ '-0{8}$'") == "0", "never an entry under the placeholder GUID")
    books_ok("resolved")
    # ---------------------------------------------------------------- the review of 51: L1 - L4
    print("== review L1: a \":resolved\" line ending 'stale'")
    got = states(apply([sline("n-m7", "created", "", "25770", None, "810", "2026-10-07", idsMismatch=True, lineGuid=G(0x6345))]))
    day("2026-10-07", [V(G(25770), 70200, "810", "Debtor J")], LN(G(25770), "Debtor J", 15))
    ok(got == [("held", MISMATCH % G(0x6345))] and sw("n-m7")[0] == "held", "a flagged line, its entry's Day Book stored: still held (%s)" % (sw("n-m7"),))
    got = states(apply([dict(sline("n-m7:resolved", "altered", G(25770), "25770", 70150, "810", "2026-10-07"), **body(G(25770), 70150, "810", "Debtor J", 15, "2026-10-07"))]))
    ok(got[0][0] == "stale" and sw("n-m7") == ("replaced", REPLACED % row("n-m7:resolved")["id"]), "its \":resolved\" line older than the copy's version: 'stale', and the held line replaced (%s, %s)" % (got, sw("n-m7")))
    print("== review L2: a held flagged delete / cancel")
    got = states(apply([sline("n-m8", "cancelled", "", "25780", 70305, "811", "2026-10-08", idsMismatch=True, lineGuid=G(0x6346))]))
    ok(got == [("held", MISMATCH % G(0x6346))], "a flagged cancel: held (%s)" % got)
    day("2026-10-08", [V(G(25686), 70290, "701", "Debtor K"), V(G(25780), 70295, "811", "Debtor L")], LN(G(25686), "Debtor K", 25) + LN(G(25780), "Debtor L", 35))
    ok(sw("n-m6")[0] == "held" and sw("n-m8")[0] == "held" and vch(G(25686)).get("deleted") == "f", "the Day Book holding their MasterIDs' entries: both still held, nothing deleted on a guess")
    got = states(apply([sline("n-m6b", "deleted", G(25686), "25686", 70300, "701", "2026-10-08"), sline("n-m8:resolved", "cancelled", G(25780), "25780", 70310, "811", "2026-10-08")]))
    ok([s for s, _ in got] == ["applied", "applied"] and vch(G(25686)).get("deleted") == "t", "the later delete / cancel under Tally's GUID applied (%s)" % got)
    ok(sw("n-m6") == ("replaced", "replaced by line %s (the deletion came with the entry's own GUID)" % row("n-m6b")["id"]) and sw("n-m8") == ("replaced", "replaced by line %s (the cancellation came with the entry's own GUID)" % row("n-m8:resolved")["id"]),
       "the held flagged delete replaced by the delete under the GUID its MasterID makes; the cancel by its \":resolved\" line (%s, %s)" % (sw("n-m6"), sw("n-m8")))
    books_ok("L2")
    print("== review L3: idsMismatch in any case")
    got = states(apply([sline("n-m9", "created", "", "25790", None, "812", "2026-10-09", idsMismatch="True", lineGuid=G(0x6332))]))
    ok(got == [("held", MISMATCH % G(0x6332))], "idsMismatch \"True\": held as a flagged line (%s)" % got)
    got = states(apply([dict(sline("n-other", "created", G(25790), "25790", 70320, "812", "2026-10-09"), **body(G(25790), 70320, "812", "Debtor M", 45, "2026-10-09"))]))
    ok(got[0][0] == "applied" and sw("n-m9")[0] == "held", "the line applied under the GUID its MasterID makes (not its \":resolved\" line) does not replace it (%s)" % (sw("n-m9"),))
    books_ok("L3")
    print("== review L4: a matched short line keeps 50's words, heldWhy appended")
    J = "00000051-0000-0000-0000-000000000001"
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, results, taken_at) values (%s, %s, 'c1', 'GARG SHEKHAR & COMPANY', %s, '{\"vouchers\": []}', 1, 'done', '[]', now());"
           "insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live, accepted_at) values (%s, 'c1', 'FC-51', %s, 'e51', true, now())" % (q(J), q(F), q(D1), q(F), q(J)))
    HW4 = "Tally's entry could not be read after the change (asked 1 of 20 times)"
    got = states(apply([sline("s1", "altered", G(25800), "25800", 70400, "820", D4, fid="FC-51", short=True, heldWhy=HW4)]))
    ok(got == [("held", "FinCom posting FC-51 matched; changed in Tally after posting: the next full line or Day Book upload applies it; " + HW4)], "50's words for a matched short line, the bridge's after them (%s)" % got)
    books_ok("L4")
    print("\n  md5(prosrc) of 51's functions (after applying on the stand):")
    for k, v in md5s.items(): print("    %-60s %s" % (k, v))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
