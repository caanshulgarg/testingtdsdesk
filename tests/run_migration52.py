"""python3 run_migration52.py - migration-52-recorder-duplicate-needs-same-entry (05-Oct-2026, the owner's finding on staging:
lines 5 and 7 'duplicate' against GUIDs ...6345 / ...6346, which in the copy are Journals of 01-Sep-2026 (one FA/ELEC/019),
while the lines say Journal FA/2026-27/140 and FA/ELEC/024 of 01-Oct-2026: October journals made by duplicating September
ones, the add-on's pre line carrying the source's GUID / MasterID / AlterID, all consistent with each other). On throwaway
PostgreSQL (pg_stand, port 30520; never a real database), built 32 -> ... -> 50 -> 51 in staging's order, then 52 (twice).
  RULE: a line is never 'duplicate' of, applied as an alteration of, deleted / cancelled against, or replaced by an entry whose
  type, date, or number (when both have one) differ from the line's. Without a body: held, "the add-on named entry <type> <no>
  of <date>, but GUID <g> is <type> <no> of <date> in the copy; held until FinCom Bridge sends this entry as Tally gives it";
  a line whose body is another entry than the line names: held the same ("in the entry sent with the line").
  CORRECTION (bounded: received before 06-Oct-2026 00:00 India time): 'duplicate' rows whose payload's type / date / number
  differ from the copy's entry at their GUID -> held with those words: exactly lines 5 and 7 (and an unnumbered one here); a
  true duplicate (same type, date, number) and an empty-number line against an empty-number entry of the same type and date
  stay 'duplicate'; a row received on 06-Oct stays.
  RELEASE: line 5 replaced when its new entry arrives with its body from another line (50's type + number + date rule, through
  51's guards); line 7 not replaced by the September entry's alteration (and a held delete of it never applied with it); an
  unnumbered one only by its ":resolved" line. A FinCom posting later ALTERED in Tally (a full altered line with its body)
  is applied as an alteration.
THE DECISION ON 52: (a) a genuine alteration in Tally to another date and number (the body Tally's own under the line's GUID,
  naming what the line names) is applied, both days' cache right; (b) 2.2.0's September-under-October line (the body the
  source's content) stays held; (c) a body whose own GUID is not the line's: held.
THE REVIEW OF 52: H (S1) a FinCom short line whose body (built from the posting) has the posted number while Tally numbered it
  otherwise: applied, "FinCom posting ... matched" as in 51; M1 (S2) an intermediate altered line without a body that changed
  the number, held, is replaced by the later applied line of the same GUID (and a Day Book bringing a newer version makes it
  'stale'); M2 (S3) a late old line (AlterID below the copy's) 'stale' as in 51; M3 (S4) a delete carrying the entry's newer
  number / date while the copy is behind (its AlterID above the copy's) applied as in 51, held when not above; M4 (S5) a true
  duplicate whose entry was renumbered later stays 'duplicate' under the correction; L1 (S6) types compared in any case.
RED: before the file exists it stops at the first check; with an empty file the checks of the rule fail."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql")]
M52 = os.environ.get("M52_FILE") or os.path.join(SQLDIR, "migration-52-recorder-duplicate-needs-same-entry.sql")
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

text = open(M52).read() if os.path.exists(M52) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M52))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "52: begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok("delete from" not in low, "52: no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", low) and not re.search(r"\btruncate\b", low), "52: add-only (no drop, no truncate)")

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

db = pg_stand.start(30520)
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

W = "the add-on named entry %s, but GUID %s is %s %s; held until FinCom Bridge sends this entry as Tally gives it"
def JV(guid, alter, no, day, party="", fid=None, narr=""):
    return {"guid": guid, "alter": alter, "type": "Journal", "no": no, "party": party, "narr": narr, "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": fid, "day": day}
def jbody(guid, alter, no, day, party, amt, **kw): return {"vouchers": [JV(guid, alter, no, day, party, **kw)], "lines": LN(guid, party, amt)}
def jl(lid, ev, og, mid, alt, no, day, **kw): return dict(sline(lid, ev, og, mid, alt, no, day, vch_type="Journal"), **kw)
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
    # the copy as on staging: September journals
    day("2026-09-01", [JV(G(0x6345), 51985, "", "2026-09-01", "Asset A"), JV(G(0x6346), 51986, "FA/ELEC/019", "2026-09-01", "Asset B"), JV(G(0x6347), 51987, "FA/ELEC/020", "2026-09-01", "Asset C")],
        LN(G(0x6345), "Asset A", 100) + LN(G(0x6346), "Asset B", 200) + LN(G(0x6347), "Asset C", 300))
    day("2026-09-02", [JV(G(0x6348), 51988, "", "2026-09-02", "Asset D")], LN(G(0x6348), "Asset D", 400))
    day("2026-09-03", [JV(G(0x6349), 51989, "", "2026-09-03", "Asset E")], LN(G(0x6349), "Asset E", 500))
    books_ok("the September copy")
    print("== before 52 (51's tally_recorder_line)")
    L5 = jl("l5", "created", G(0x6345), "25413", 51985, "FA/2026-27/140", "2026-10-01")
    L7 = jl("l7", "created", G(0x6346), "25414", 51986, "FA/ELEC/024", "2026-10-01")
    T1 = jl("t1", "altered", G(0x6347), "25415", 51987, "FA/ELEC/020", "2026-09-01")     # a true duplicate
    T2 = jl("t2", "altered", G(0x6348), "25416", 51988, "", "2026-09-02")                # empty number against an empty-number entry, same type and date
    U1 = jl("u1", "created", G(0x6349), "25417", 51989, "", "2026-10-03")                # unnumbered, another date
    LT = jl("late7", "created", G(0x6347), "25415", 51987, "FA/ELEC/030", "2026-10-01")  # received on 06-Oct: beyond the correction
    got = states(apply([L5, L7, T1, T2, U1, LT]))
    ok([s for s, _ in got] == ["duplicate"] * 6, "51: lines 5 and 7 (and the others) 'duplicate' against September's journals (%s)" % [s for s, _ in got])
    # review M4 (S5): a true duplicate before 52, its entry renumbered later (a Day Book at a higher AlterID)
    day("2026-09-15", [JV(G(0x7005), 100, "E1", "2026-09-15", "P5")], LN(G(0x7005), "P5", 50))
    ok(states(apply([jl("s5", "altered", G(0x7005), "28677", 100, "E1", "2026-09-15")]))[0][0] == "duplicate", "S5 before 52: a true duplicate")
    day("2026-09-15", [JV(G(0x7005), 150, "E2", "2026-09-15", "P5")], LN(G(0x7005), "P5", 50))
    db.sql("update tally_recorder_lines set received_at = '2026-10-05 08:00:00+05:30'; update tally_recorder_lines set received_at = '2026-10-06 09:00:00+05:30' where line_id = 'late7'")
    s5pre = row("s5")
    pre = {k: row(k) for k in ("l5", "l7", "t1", "t2", "u1", "late7")}
    books_ok("before 52")
    print("== migration 52")
    l51 = prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)")
    keep = {s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in ("tally_recorder_apply(uuid, uuid, uuid, jsonb)", "tally_recorder_release_day(uuid, date)", "tally_ingest_delete(uuid, text, bigint, boolean, text)",
                                                                     "tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb, boolean)", "tally_recorder_release_held(bigint)")}
    rr = psql_text(text); ok(rr.returncode == 0, "migration-52 runs (1) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    if rr.returncode: raise SystemExit("cannot go on without the migration")
    mid1 = {k: row(k) for k in pre}
    rr = psql_text(text); ok(rr.returncode == 0, "migration-52 runs (2) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    ok({k: row(k) for k in pre} == mid1, "run twice: the second run changes no row (state, words, body, payload, xmin)")
    ok({s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in keep} == keep and prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)") != l51, "52 replaces tally_recorder_line only")
    bodies = re.findall(r"create or replace function public\.(\w+)\((.*?)\)\s*returns.*?\$function\$(.*?)\$function\$", text, re.S)
    sig = lambda args: ", ".join(re.sub(r"^\s*p_\w+\s+", "", a).strip() for a in args.split(",")) if args.strip() else ""
    ok(sorted((n, sig(a)) for n, a, _ in bodies) == [("tally_recorder_line", "uuid, uuid, jsonb, bigint")], "the functions in the file: tally_recorder_line (same arguments)")
    md5s = {}
    for name, args, src in bodies:
        rp = "public.%s(%s)" % (name, sig(args))
        rw = (db.rows("select md5(prosrc) as m, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where oid = %s::regprocedure" % q(rp)) or [{}])[0]
        md5s[rp] = rw.get("m")
        ok(rw.get("m") == hashlib.md5(src.encode()).hexdigest() and rw.get("prosecdef") == "t" and rw.get("conf", "").replace(" ", "") == "search_path=public,pg_temp", "md5(prosrc) of %s = %s (the file's text); security definer, search_path = public, pg_temp" % (rp, rw.get("m")))
    pv = lambda who, sg: db.one("select has_function_privilege('%s', 'public.%s', 'execute')" % (who, sg))
    ok([pv(w, "tally_recorder_line(uuid, uuid, jsonb, bigint)") for w in ("anon", "authenticated", "service_role")] == ["f", "f", "f"], "tally_recorder_line granted to nobody (as 50, 51)")
    print("== the correction")
    now = {k: row(k) for k in pre}
    W5 = W % ("Journal FA/2026-27/140 of 01-Oct-2026", G(0x6345), "Journal of 01-Sep-2026", "in the copy")
    W7 = W % ("Journal FA/ELEC/024 of 01-Oct-2026", G(0x6346), "Journal FA/ELEC/019 of 01-Sep-2026", "in the copy")
    WU = W % ("Journal of 03-Oct-2026", G(0x6349), "Journal of 03-Sep-2026", "in the copy")
    ok((now["l5"]["state"], now["l5"]["why"]) == ("held", W5), "line 5: held, \"%s\" (%s)" % (W5, now["l5"]["why"]))
    ok((now["l7"]["state"], now["l7"]["why"]) == ("held", W7), "line 7: held, \"%s\" (%s)" % (W7, now["l7"]["why"]))
    ok((now["u1"]["state"], now["u1"]["why"]) == ("held", WU), "an unnumbered line of another date: held (%s)" % now["u1"]["why"])
    ok(all(now[k]["bm"] == pre[k]["bm"] and now[k]["pm"] == pre[k]["pm"] and now[k]["rel"] == "" for k in pre), "body and payload unchanged; released_at untouched")
    ok(all(now[k]["state"] == "duplicate" and now[k]["xm"] == pre[k]["xm"] for k in ("t1", "t2", "late7")), "the true duplicate, the empty-number one of the same type and date, and the row received on 06-Oct stay 'duplicate', untouched")
    ok(row("s5")["state"] == "duplicate" and row("s5")["xm"] == s5pre["xm"], "M4 (S5): a true duplicate whose entry was renumbered later (AlterID 150 above the line's 100) stays 'duplicate', untouched (%s)" % (sw("s5"),))
    ok(db.one("select count(*) from tally_recorder_lines where held_why like 'the add-on named entry %'") == "3", "exactly three rows changed (lines 5, 7 and the unnumbered one)")
    books_ok("after 52")
    print("== the rule on new lines")
    got = states(apply([jl("n1", "created", G(0x6345), "25413", 51985, "FA/2026-27/141", "2026-10-02"),
                        jl("n-del", "deleted", G(0x6346), "25414", 51986, "FA/ELEC/025", "2026-10-01"),     # its AlterID not above the copy's
                        jl("n-ph", "created", PH, "25415", 0, "FA/ELEC/026", "2026-10-01"),
                        dict(jl("n-body", "altered", G(0x6346), "25414", 51999, "FA/ELEC/024", "2026-10-01"), **jbody(G(0x6346), 51999, "FA/ELEC/019", "2026-09-01", "Asset B", 250)),     # 2.2.0: September's content, the line says October
                        dict(jl("n-body2", "altered", G(0x6347), "25415", 51999, "FA/ELEC/020", "2026-09-01"), **jbody(G(0x6347), 51999, "FA/ELEC/032", "2026-10-01", "Asset C", 350))]))
    ok(got[0] == ("held", W % ("Journal FA/2026-27/141 of 02-Oct-2026", G(0x6345), "Journal of 01-Sep-2026", "in the copy")), "no body, by GUID: held, never 'duplicate' (%s)" % (got[0],))
    ok(got[1] == ("held", W % ("Journal FA/ELEC/025 of 01-Oct-2026", G(0x6346), "Journal FA/ELEC/019 of 01-Sep-2026", "in the copy")) and vch(G(0x6346)).get("deleted") == "f", "a delete naming another entry than the copy's at its GUID: held, nothing deleted (%s)" % (got[1],))
    ok(got[2] == ("held", W % ("Journal FA/ELEC/026 of 01-Oct-2026", G(0x6347), "Journal FA/ELEC/020 of 01-Sep-2026", "in the copy")), "the placeholder, by the GUID its MasterID makes: held, never 'duplicate' (%s)" % (got[2],))
    ok(got[3] == ("held", W % ("Journal FA/ELEC/024 of 01-Oct-2026", G(0x6346), "Journal FA/ELEC/019 of 01-Sep-2026", "in the entry sent with the line")) and vch(G(0x6346)).get("alter_id") == "51986",
       "(b) 2.2.0's September-under-October line (the body September's content, the line October's): held, never applied (%s)" % (got[3],))
    ok(got[4] == ("held", W % ("Journal FA/ELEC/020 of 01-Sep-2026", G(0x6347), "Journal FA/ELEC/032 of 01-Oct-2026", "in the entry sent with the line")) and vch(G(0x6347)).get("alter_id") == "51987", "a body that is another entry than the line names: held (%s)" % (got[4],))
    books_ok("the rule")
    print("== release")
    got = states(apply([dict(jl("l6:resolved", "created", G(25700), "25700", 52010, "FA/2026-27/140", "2026-10-01"), **jbody(G(25700), 52010, "FA/2026-27/140", "2026-10-01", "Asset F", 600))]))
    ok(got[0][0] == "applied" and sw("l5") == ("replaced", "replaced by line %s (the entry's details arrived)" % row("l6:resolved")["id"]), "line 6's resolved line brings Journal FA/2026-27/140 of 01-Oct under Tally's new GUID: line 5 'replaced' (%s)" % (sw("l5"),))
    ok(sw("l7")[0] == "held", "line 7 still held")
    got = states(apply([dict(jl("sep-alter", "altered", G(0x6346), "25414", 52000, "FA/ELEC/019", "2026-09-01"), **jbody(G(0x6346), 52000, "FA/ELEC/019", "2026-09-01", "Asset B", 210))]))
    ok(got[0][0] == "applied" and sw("l7")[0] == "held" and sw("n-del")[0] == "held" and vch(G(0x6346)).get("deleted") == "f",
       "September's FA/ELEC/019 altered (its own line): applied; line 7 not replaced by it; the held delete naming FA/ELEC/025 not applied with it (%s, %s, %s)" % (got, sw("l7")[0], sw("n-del")[0]))
    got = states(apply([dict(jl("l8:resolved", "created", G(25710), "25710", 52011, "FA/ELEC/024", "2026-10-01"), **jbody(G(25710), 52011, "FA/ELEC/024", "2026-10-01", "Asset G", 700))]))
    ok(got[0][0] == "applied" and sw("l7") == ("replaced", "replaced by line %s (the entry's details arrived)" % row("l8:resolved")["id"]), "line 7's own entry FA/ELEC/024 of 01-Oct arrives: line 7 'replaced' (%s)" % (sw("l7"),))
    got = states(apply([dict(jl("x-u", "created", G(25720), "25720", 52012, "", "2026-10-03"), **jbody(G(25720), 52012, "", "2026-10-03", "Asset H", 800))]))
    ok(got[0][0] == "applied" and sw("u1")[0] == "held", "unnumbered: another line's Journal of 03-Oct does not replace it (%s)" % (sw("u1"),))
    got = states(apply([dict(jl("u1:resolved", "created", G(25730), "25730", 52013, "", "2026-10-03"), **jbody(G(25730), 52013, "", "2026-10-03", "Asset I", 900))]))
    ok(got[0][0] == "applied" and sw("u1") == ("replaced", "replaced by line %s (the entry's details arrived)" % row("u1:resolved")["id"]), "unnumbered: replaced by its \":resolved\" line (%s)" % (sw("u1"),))
    day("2026-09-01", [JV(G(0x6345), 51985, "", "2026-09-01", "Asset A"), JV(G(0x6346), 52000, "FA/ELEC/019", "2026-09-01", "Asset B"), JV(G(0x6347), 51987, "FA/ELEC/020", "2026-09-01", "Asset C")],
        LN(G(0x6345), "Asset A", 100) + LN(G(0x6346), "Asset B", 210) + LN(G(0x6347), "Asset C", 300))
    ok(sw("n1")[0] == "held" and sw("n-ph")[0] == "held" and sw("n-del")[0] == "held" and vch(G(0x6346)).get("deleted") == "f", "01-Sep's Day Book stored again: the held lines naming other entries stay held, nothing deleted")
    # the decision on 52: a genuine alteration that changes the date and number, its body Tally's own under the line's GUID, applies
    got = states(apply([dict(jl("sep-redate", "altered", G(0x6346), "25414", 52300, "FA/ELEC/019A", "2026-09-02"), **jbody(G(0x6346), 52300, "FA/ELEC/019A", "2026-09-02", "Asset B", 220))]))
    v6 = vch(G(0x6346))
    ok(got[0][0] == "applied" and (v6.get("day"), v6.get("vno"), v6.get("alter_id"), v6.get("deleted")) == ("2026-09-02", "FA/ELEC/019A", "52300", "f")
       and db.one("select count(*) from tally_voucher_versions where book_id = %s and tally_guid = %s" % (q(B), q(G(0x6346)))) not in ("0", "1"),
       "(a) FA/ELEC/019 of 01-Sep altered in Tally to FA/ELEC/019A of 02-Sep, the body its own GUID ...6346: applied, the copy shows 02-Sep / FA/ELEC/019A, versions kept (%s, %s)" % (got, v6))
    ok(db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = 'Asset B' and day = '2026-09-01'" % q(B)) == "0"
       and db.one("select sum(amount) from tally_ledger_day where book_id = %s and ledger = 'Asset B' and day = '2026-09-02'" % q(B)) == "220", "(a) the day cache: Asset B left 01-Sep, 220 on 02-Sep")
    books_ok("(a) the alteration across days")
    got = states(apply([dict(jl("n-otherguid", "altered", G(0x6347), "25415", 52200, "FA/ELEC/020", "2026-09-01"), **jbody(G(0x6399), 52200, "FA/ELEC/020", "2026-09-01", "Asset C", 330))]))
    ok(got[0][0] == "held" and vch(G(0x6347)).get("alter_id") == "51987" and vch(G(0x6399)) == {}, "(c) a body whose own GUID is not the line's: held, nothing applied (%s)" % (got,))
    rel = j("select tally_recorder_release_held(%s)::text" % row("n1")["id"], OWNER)
    ok(rel.get("state") == "held", "an owner's release of such a line: still held (%s)" % rel.get("state"))
    books_ok("release")
    print("== a FinCom posting later altered in Tally")
    J = "00000052-0000-0000-0000-000000000001"
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, results, taken_at) values (%s, %s, 'c1', 'GARG SHEKHAR & COMPANY', %s, '{\"vouchers\": []}', 1, 'done', '[]', now());"
           "insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live, accepted_at) values (%s, 'c1', 'FC-52', %s, 'e52', true, now())" % (q(J), q(F), q(D1), q(F), q(J)))
    got = states(apply([dict(jl("fc-c", "created", G(25800), "25800", 52100, "FC/52", "2026-10-04", fid="FC-52"), **jbody(G(25800), 52100, "FC/52", "2026-10-04", "Asset J", 1000, fid="FC-52", narr="TDSDesk:FC-52"))]))
    ok(got == [("applied", "FinCom posting FC-52 matched")], "FinCom's posting comes back created: applied, matched (%s)" % got)
    got = states(apply([dict(jl("fc-a", "altered", G(25800), "25800", 52101, "FC/52", "2026-10-04", fid="FC-52"), **jbody(G(25800), 52101, "FC/52", "2026-10-04", "Asset J", 1100, fid="FC-52", narr="TDSDesk:FC-52"))]))
    ok(got == [("applied", "FinCom posting FC-52 matched")] and vch(G(25800)).get("alter_id") == "52101"
       and db.one("select amount from tally_lines where book_id = %s and guid = %s and ledger = 'Asset J'" % (q(B), q(G(25800)))) == "1100",
       "altered later in Tally, a full altered line with its body: applied as an alteration (AlterID 52101, the new amount), never 'duplicate' or 'short' (%s)" % got)
    books_ok("FinCom posting altered")
    print("== the review of 52")
    J = "00000052-0000-0000-0000-0000000000a1"
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, results, taken_at) values (%s, %s, 'c1', 'GARG SHEKHAR & COMPANY', %s, '{\"vouchers\": []}', 1, 'done', '[]', now());"
           "insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live, accepted_at) values (%s, 'c1', 'FC-S1', %s, 'eS1', true, now())" % (q(J), q(F), q(D1), q(F), q(J)))
    got = states(apply([dict(jl("s1", "created", G(0x7001), "28673", 200, "TALLY/9", "2026-10-04", fid="FC-S1", short=True), **jbody(G(0x7001), 200, "FC/1", "2026-10-04", "P1", 10, fid="FC-S1", narr="TDSDesk:FC-S1"))]))
    ok(got == [("applied", "FinCom posting FC-S1 matched")] and vch(G(0x7001)).get("alter_id") == "200", "H (S1): a short line, Tally's number TALLY/9, the posted body's FC/1: applied, matched, as in 51 (%s)" % got)
    day("2026-09-10", [JV(G(0x7002), 100, "N1", "2026-09-10", "P2")], LN(G(0x7002), "P2", 20))
    got = states(apply([jl("a1", "altered", G(0x7002), "28674", 110, "N2", "2026-09-10")]))
    ok(got[0][0] == "held", "M1 (S2): an intermediate altered line without a body, N1 -> N2 (AlterID 110 above the copy's 100): held (%s)" % got)
    got = states(apply([dict(jl("a2", "altered", G(0x7002), "28674", 120, "N3", "2026-09-10"), **jbody(G(0x7002), 120, "N3", "2026-09-10", "P2", 25))]))
    ok(got[0][0] == "applied" and sw("a1") == ("replaced", REPLACED % row("a2")["id"]), "M1 (S2): the later line of that GUID applied (N3, AlterID 120): the intermediate one 'replaced' (%s)" % (sw("a1"),))
    day("2026-09-11", [JV(G(0x7008), 100, "Q1", "2026-09-11", "P8")], LN(G(0x7008), "P8", 80))
    apply([jl("a3", "altered", G(0x7008), "28680", 110, "Q2", "2026-09-11")])
    day("2026-09-11", [JV(G(0x7008), 120, "Q3", "2026-09-11", "P8")], LN(G(0x7008), "P8", 85))
    ok(sw("a3")[0] == "stale", "M1: such a line when a Day Book brings a newer version (AlterID 120): 'stale' (%s)" % (sw("a3"),))
    day("2026-09-12", [JV(G(0x7003), 130, "M2", "2026-09-12", "P3")], LN(G(0x7003), "P3", 30))
    got = states(apply([jl("s3", "altered", G(0x7003), "28675", 120, "M1", "2026-09-12")]))
    ok(got == [("stale", "AlterID 120 is older than the 130 held")], "M2 (S3): a late old line (AlterID 120 below the copy's 130, another number): 'stale' as in 51 (%s)" % got)
    day("2026-09-13", [JV(G(0x7004), 100, "D1", "2026-09-13", "P4")], LN(G(0x7004), "P4", 40))
    got = states(apply([jl("s4", "deleted", G(0x7004), "28676", 140, "D2", "2026-09-14")]))
    ok(got[0][0] == "applied" and vch(G(0x7004)).get("deleted") == "t", "M3 (S4): a delete carrying the entry's newer number and date (AlterID 140 above the copy's 100): applied as in 51 (%s)" % got)
    day("2026-09-16", [JV(G(0x7006), 100, "C1", "2026-09-16", "P6")], LN(G(0x7006), "P6", 60))
    got = states(apply([jl("s6", "altered", G(0x7006), "28678", 100, "C1", "2026-09-16", vch_type="journal ")]))
    ok(got[0][0] == "duplicate", "L1 (S6): type 'journal ' against 'Journal': the same entry, 'duplicate' (%s)" % got)
    books_ok("the review of 52")
    print("\n  md5(prosrc) of 52's functions (after applying on the stand):")
    for k, v in md5s.items(): print("    %-60s %s" % (k, v))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
