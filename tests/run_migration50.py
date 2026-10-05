"""python3 run_migration50.py - migration-50-recorder-held (05-Oct-2026, the owner's blocker on staging: book f79e4bc3, GARG
SHEKHAR & COMPANY, four recorder lines held with words promising "the next day read", which never comes: reading is
prospective only). On throwaway PostgreSQL (pg_stand, port 30500; never a real database), built in staging's order 32 -> 33
-> 35 -> 34 (as run on staging) -> 36b -> 37 -> 36 -> 38 -> ... -> 47 -> 48 -> 49, then 50 (twice).
THE FOUR LINES, shaped exactly as staging's (read there with SELECT on 05-Oct-2026), sent through tally_recorder_apply BEFORE
50 (48's text), come out held with staging's very words; then 50 runs and:
  3. THE WORDS: no held line says "day read". No body (line 1 Receipt 191, line 4 Receipt 192: event altered, alter_id 0, the
     add-on's placeholder GUID "<company GUID>-00000000") -> "waiting for the entry's details from FinCom Bridge (it asks Tally
     again on its next run); or upload this day's Day Book"; an unknown entry deleted / cancelled (line 2 Receipt 189, line 3
     Receipt 190) -> "the entry is not in FinCom's copy yet; it is applied by itself once the Day Book for <date> is uploaded";
     the rows already held get the new words from 50 itself; a month locked -> as before. No string in the functions 50
     carries says "day read".
  4b. RELEASE BY ITSELF after a Day Book day is stored (tally_ingest_day; 50 adds a trigger on tally_days, the functions that
     hold "delete from" are not touched): the day 01-Oct-2026 holding Receipt 189 -> 189 marked deleted, line 2 applied; the
     day 05-Oct-2026 holding Receipt 190 and Receipt 192 -> 190 cancelled (not deleted), line 3 applied, line 4 'duplicate'
     (the copy holds Receipt 192 of that day under the company's GUID), line 1 still held (191 not in the day).
  4a. RELEASE BY ITSELF when the entry's details arrive: bridge 2.2.1's resolved line for 191 (line_id = line 1's +
     ":resolved", event created, the real GUID <company GUID>-<8-hex MasterID>, its AlterID and body) -> applied, 191 in
     tally_vouchers with its lines, the ledger-day cache of 05-Oct updated, and line 1 'replaced' with "replaced by line <id>
     (the entry's details arrived)". A held line of a real GUID without a body, followed by that GUID applied at a higher
     AlterID -> 'replaced'. Never a voucher under a placeholder GUID.
  A delete of an entry not in the copy whose day is stored AFTER the line came (the Day Book made after Tally deleted it):
     applied, "nothing to delete"; a cancel the same: still held, with words that say what releases it.
  The trial balance (sum of tally_ledger_day.amount) 0.00 after every step, and the cache equal to the one computed afresh.
  The file: begin; set local lock_timeout = '10s'; commit; NO "delete from" anywhere (comments too); no drop / truncate; the
  state CHECK widened by its EXACT old text only (a different CHECK stops the file with words, nothing changed); runs twice;
  every function security definer, search_path = public, pg_temp; grants: tally_ingest_delete the service role's, the line,
  the day release and the trigger function nobody's; md5(prosrc) of each = the file's text between its $function$ marks
  (printed for the report); tally_ingest_day and tally_ingest_entries (the "delete from" texts) unchanged; 48's
  tally_recorder_line and 44's tally_ingest_delete carried with only the lines of the changes removed.
THE REVIEW OF 50 (docs/reviews/migration-50-review.md), each finding a check from the reviewer's scenarios: H1 (E2a short read,
E2b unvouched empty file, E3 an old file re-read: the delete stays held; a complete newer Day Book: "nothing to delete"; a later
create with a lower AlterID: 'stale'; a held delete applied when a create brings its entry); M1 (E1a two Receipts 500, a
MasterID's own GUID only, E1e a Day Book's other Receipt 503, E1d an 'altered' placeholder of an old version, E1c no company
GUID); M2 (only the lines a day can release, no rewrite (xmin), E4 the 601st line, one day with 3,000 held lines timed with and
without the triggers; M50_PERF=1 also times 365 days with 3,000 held lines); L1 (a statement timeout inside the release: the day
stored, the line left held, the next store releases it); L2 (an error keeps the line held, said once); L3; L4; L5; L6 (statement
triggers; one UPDATE of two days).
RED (before 50): the file is missing. RED (before the review's fixes): tdd/r51.1.red."""
import os, re, sys, json, hashlib, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql")]
M50 = os.environ.get("M50_FILE") or os.path.join(SQLDIR, "migration-50-recorder-held.sql")
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
B, D1 = "f79e4bc3-871d-4482-874d-71c5fb2a1b33", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"     # staging's book and computer
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"                                                   # GARG SHEKHAR & COMPANY's company GUID
PH = CG + "-00000000"
NOBODY = "waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book"
UNKNOWN = "the entry is not in FinCom's copy yet; it is applied by itself once the Day Book for %s is uploaded"
NOTHING = "nothing to delete: the Day Book for %s, complete and made after this change (its AlterIDs reach %s), does not hold the entry"
CANCEL_NOT = "the Day Book for %s, complete and made after this change, does not hold this entry; it is applied by itself once a Day Book holding it is uploaded"
NOGUID_DEL = "no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date"
ERRSUF = " (a try to apply it by itself met an error: "
OLD_NOBODY, OLD_UNKNOWN = "no entry body on the line: the next day read applies it", "unknown entry: not in the copy (the next day read decides)"

text = open(M50).read() if os.path.exists(M50) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M50))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "50: begin; set local lock_timeout = '10s'; ... commit;")
ok("delete from" not in low, "50: no 'delete from' anywhere in the file (comments included): Claude may run it on staging")
ok(not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema)\b", low) and not re.search(r"\btruncate\b", low), "50: add-only (no drop of a table, function, policy, column or index; no truncate)")

# staging's four lines (tally_recorder_lines, book f79e4bc3, SELECT of 05-Oct-2026), as the bridge 2.2.0 sent them
def sline(lid, ev, og, mid, alt, no, day, saved):
    return {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-6b1ba45fbb1d", "vch_no": no, "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alt, "saved_at": saved,
            "vch_date": day, "vch_type": "Receipt", "master_id": mid, "object_guid": og, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY"}
L1 = sline("2f0e29505c1640f647c2c6fcd8faeae4", "altered", PH, "0", 0, "191", "2026-10-05", "2026-10-05T02:25:00.000Z")
L2 = sline("c38a0a8be856d0138162163c6076fed4", "deleted", CG + "-000066c1", "26305", 54386, "189", "2026-10-01", "2026-10-05T02:26:00.000Z")
L3 = sline("d8ab2b9f61a53ae49e91c5c5226bdaf6", "cancelled", CG + "-000066c5", "26309", 54390, "190", "2026-10-05", "2026-10-05T02:27:00.000Z")
L4 = sline("79bfbdacbc720ee0a17f66736ca6a42a", "altered", PH, "26312", 0, "192", "2026-10-05", "2026-10-05T02:34:00.000Z")
def V(guid, alter, no, party="", cancel=False, typ="Receipt"):
    return {"guid": guid, "alter": alter, "type": typ, "no": no, "party": party, "narr": "", "cancel": cancel, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None}
def LN(guid, party, amt): return [[guid, "Cash", -amt, "", None, []], [guid, party, amt, "", None, []]]

db = pg_stand.start(30500)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def as_user(uid, stmt):
    try: return True, db.one("set fincom.role = 'authenticated'; set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def day(d, vouchers, lines, n=None): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(d), js(vouchers), js(lines), len(vouchers) if n is None else n, max([v["alter"] for v in vouchers] + [0])))
def row(lid): return (db.rows("select id, state, coalesce(held_why, '') as why from tally_recorder_lines where line_id = %s order by id desc limit 1" % q(lid)) or [{}])[0]
def vch(g): return (db.rows("select alter_id, vno, day, cancelled, deleted_at is not null as deleted from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(g))) or [{}])[0]
def tb(): return db.one("select to_char(coalesce(sum(amount), 0), 'FM999999990.00') from tally_ledger_day where book_id = %s" % q(B))
def fresh_ok():
    a = db.one("""select md5(coalesce(string_agg(concat_ws(',', ledger, day, amount, n), '|' order by ledger, day), '')) from (select l.ledger, l.day, sum(l.amount) as amount, count(*) as n
                  from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid where l.book_id = %s and v.deleted_at is null and not v.cancelled and not v.optional group by l.ledger, l.day) x""" % q(B))
    b = db.one("select md5(coalesce(string_agg(concat_ws(',', ledger, day, amount, n), '|' order by ledger, day), '')) from tally_ledger_day where book_id = %s and amount <> 0" % q(B))
    return a == b
def books_ok(tag): ok(tb() == "0.00" and fresh_ok(), "%s: the trial balance %s; the ledger-day cache equals the one computed afresh from the live entries" % (tag, tb()))
def prosrc(sig): return db.one("select prosrc from pg_proc where oid = %s::regprocedure" % q("public." + sig)) or ""
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")     # as on staging (migration.sql:92; read there 05-Oct-2026)
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.2.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # the copy holds nothing after 31-Mar-2026 (staging: the 2025-26 Day Book)
    day("2026-03-31", [V(CG + "-00005000", 50000, "150", "Debtor A")], LN(CG + "-00005000", "Debtor A", 1000))
    books_ok("the 2025-26 copy")
    print("== staging's four lines through 48's tally_recorder_apply")
    r = apply([L1, L2, L3, L4])
    got = [(x.get("state"), x.get("why")) for x in r.get("results", [])]
    ok(got == [("held", OLD_NOBODY), ("held", OLD_UNKNOWN), ("held", OLD_UNKNOWN), ("held", OLD_NOBODY)], "before 50: held with staging's very words (%s)" % got)
    a48 = prosrc("tally_recorder_apply(uuid, uuid, uuid, jsonb)")
    # review L3: a delete without a GUID held by 48 with its words; 50 gives it words that say what happens to it
    r = apply([dict(sline("l3-del", "deleted", None, "0", 54395, "188", "2026-10-22", "2026-10-05T02:40:00.000Z"), object_guid=None)])
    ok([(x.get("state"), x.get("why")) for x in r.get("results", [])] == [("held", "no GUID on the line: held, never a new row")], "before 50: a delete without a GUID held with 48's words (%s)" % r.get("results"))
    l48 = prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)"); d44 = prosrc("tally_ingest_delete(uuid, text, bigint, boolean, text)")
    keep = {s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in ("tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb)", "tally_recorder_release_held(bigint)")}
    # ---------------------------------------------------------------- the state CHECK: by its exact text only
    print("== migration 50")
    old_chk = db.one("select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tally_recorder_lines'::regclass and conname = 'tally_recorder_lines_state_check'")
    db.sql("alter table tally_recorder_lines drop constraint tally_recorder_lines_state_check, add constraint tally_recorder_lines_state_check check (state in ('received', 'applied', 'duplicate', 'stale', 'held', 'failed', 'by hand'))")
    rb = psql_text(text)
    ok(rb.returncode != 0 and "nothing changed" in rb.stderr and prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)") == l48 and row(L1["line_id"]).get("why") == OLD_NOBODY,
       "a state CHECK not exactly as 44 made it: the file stops with words, nothing changed (%s)" % rb.stderr.strip()[-220:])
    db.sql("alter table tally_recorder_lines drop constraint tally_recorder_lines_state_check, add constraint tally_recorder_lines_state_check check (state in ('received', 'applied', 'duplicate', 'stale', 'held', 'failed'))")
    ok(db.one("select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tally_recorder_lines'::regclass and conname = 'tally_recorder_lines_state_check'") == old_chk, "(the CHECK put back exactly as 44 made it)")
    for i in (1, 2):
        rr = psql_text(text); ok(rr.returncode == 0, "migration-50 runs (%d) %s" % (i, rr.stderr.strip()[-600:] if rr.returncode else ""))
        if rr.returncode: raise SystemExit("cannot go on without the migration")
    chk = db.one("select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tally_recorder_lines'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%state%'")
    ok("'replaced'::text" in chk and "'held'::text" in chk and "'failed'::text" in chk and db.one("select count(*) from pg_constraint where conrelid = 'public.tally_recorder_lines'::regclass and contype = 'c'") == "1",
       "the state CHECK takes 'replaced' besides the six (one CHECK: %s)" % chk)
    ok({s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in keep} == keep, "tally_ingest_day, tally_ingest_entries (both forms: the 'delete from' texts) and tally_recorder_release_held unchanged by 50")
    # ---------------------------------------------------------------- the file's functions
    bodies = re.findall(r"create or replace function public\.(\w+)\((.*?)\)\s*returns.*?\$function\$(.*?)\$function\$", text, re.S)
    sig = lambda args: ", ".join(re.sub(r"^\s*p_\w+\s+", "", a).strip() for a in args.split(",")) if args.strip() else ""
    names = sorted((n, sig(a)) for n, a, _ in bodies)
    ok(names == sorted([("tally_recorder_line", "uuid, uuid, jsonb, bigint"), ("tally_ingest_delete", "uuid, text, bigint, boolean, text"), ("tally_recorder_release_day", "uuid, date"), ("tally_days_recorder_release", ""), ("tally_recorder_apply", "uuid, uuid, uuid, jsonb")]),
       "the functions in the file: tally_recorder_line and tally_ingest_delete replaced (same arguments), tally_recorder_release_day and the trigger function tally_days_recorder_release new (%s)" % names)
    md5s = {}
    for name, args, src in bodies:
        rp = "public.%s(%s)" % (name, sig(args))
        rw = (db.rows("select md5(prosrc) as m, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where oid = %s::regprocedure" % q(rp)) or [{}])[0]
        fm = hashlib.md5(src.encode()).hexdigest(); md5s[rp] = fm
        ok(rw.get("m") == fm and rw.get("prosecdef") == "t" and rw.get("conf", "").replace(" ", "") == "search_path=public,pg_temp", "md5(prosrc) of %s = %s; security definer, search_path = public, pg_temp" % (rp, fm))
    pv = lambda who, sg: db.one("select has_function_privilege('%s', 'public.%s', 'execute')" % (who, sg))
    gr = {sg: (pv("anon", sg), pv("authenticated", sg), pv("service_role", sg)) for sg in ("tally_ingest_delete(uuid, text, bigint, boolean, text)", "tally_recorder_line(uuid, uuid, jsonb, bigint)", "tally_recorder_release_day(uuid, date)", "tally_days_recorder_release()", "tally_recorder_apply(uuid, uuid, uuid, jsonb)")}
    ok(gr == {"tally_ingest_delete(uuid, text, bigint, boolean, text)": ("f", "f", "t"), "tally_recorder_line(uuid, uuid, jsonb, bigint)": ("f", "f", "f"), "tally_recorder_release_day(uuid, date)": ("f", "f", "f"), "tally_days_recorder_release()": ("f", "f", "f"), "tally_recorder_apply(uuid, uuid, uuid, jsonb)": ("f", "f", "t")},
       "grants as 44/48: tally_ingest_delete the service role's; the line, the day release and the trigger function nobody's (%s)" % gr)
    trg = db.rows("select tgname, (tgtype & 1) as row_level, tgoldtable, tgnewtable from pg_trigger where tgrelid = 'public.tally_days'::regclass and not tgisinternal order by tgname")
    ok([(x["tgname"], x["row_level"], x["tgnewtable"]) for x in trg] == [("tally_days_recorder_release_ins", "0", "new_days"), ("tally_days_recorder_release_upd", "0", "new_days")],
       "L6. two STATEMENT-level triggers on tally_days (after insert, after update), each with the transition table new_days: one release per statement (%s)" % trg)
    lits = [l for _, _, src in bodies for l in re.findall(r"'((?:[^']|'')*)'", src)]
    ok(not [l for l in lits if re.search(r"(?i)day read", l)], "no string in 50's functions says 'day read' (%s)" % [l for l in lits if re.search(r"(?i)day read", l)][:3])
    # 48's / 44's texts carried: only the lines of the changes removed
    def removed(a, b): return [l for l in difflib.ndiff(a.split("\n"), b.split("\n")) if l.startswith("- ")]
    l50, d50 = prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)"), prosrc("tally_ingest_delete(uuid, text, bigint, boolean, text)")
    rl, rd = removed(l48, l50), removed(d44, d50) + removed(a48, prosrc("tally_recorder_apply(uuid, uuid, uuid, jsonb)"))
    print("       tally_recorder_line: 48's %d lines, %d removed or changed, 50 has %d; tally_ingest_delete: 44's %d lines, %d removed or changed" % (len(l48.split("\n")), len(rl), len(l50.split("\n")), len(d44.split("\n")), len(rd)))
    allowed = re.compile(r"next day read|day read or another line|no GUID on the line|unknown ledger: not in the copy|frm text; dst text|elsif og is null and ev <> 'ledger_renamed'|if stt is null and og is not null then|"
                         r"c_found := coalesce\(c_found, false\);|sh_changed := is_short|if lk is not null then$|stt := res->>'state'; wy := res->>'why';|body = case when stt = 'duplicate'|"
                         r"no entry GUID: nothing|select \* into b from tally_books where book_id = p_book;|^-    where id = rid;$|and coalesce\(x->>'object_guid', ''\) <> '' and coalesce\(x->>'alter_id', ''\)")
    ok(rl and all(allowed.search(l) for l in rl) and all(allowed.search(l) for l in rd), "48's tally_recorder_line and 44's tally_ingest_delete carried: every line removed is one of the changes (%s)" % [l for l in rl + rd if not allowed.search(l)][:4])
    # ---------------------------------------------------------------- 3. the words of the rows already held
    print("== 3. the words")
    w = {k: row(x["line_id"]) for k, x in (("1", L1), ("2", L2), ("3", L3), ("4", L4))}
    ok({k: (v["state"], v["why"]) for k, v in w.items()} == {"1": ("held", NOBODY), "2": ("held", UNKNOWN % "01-Oct-2026"), "3": ("held", UNKNOWN % "05-Oct-2026"), "4": ("held", NOBODY)},
       "staging's four held lines say what releases them, from 50 itself (%s)" % {k: v["why"] for k, v in w.items()})
    ok(db.one("select count(*) from tally_recorder_lines where held_why ilike '%day read%'") == "0", "no line's words say 'day read'")
    r = apply([dict(L1, line_id="n-1", saved_at="2026-10-05T03:00:00Z"), sline("n-2", "deleted", CG + "-00007001", "28673", 54500, "300", "2026-10-03", "2026-10-05T03:01:00Z"),
               sline("n-3", "cancelled", CG + "-00007002", "28674", 54501, "301", "2026-10-03", "2026-10-05T03:02:00Z"), dict(L1, line_id="n-4", object_guid=None, vch_no="302")])
    got = [(x.get("state"), x.get("why")) for x in r.get("results", [])]
    ok(got == [("held", NOBODY), ("held", UNKNOWN % "03-Oct-2026"), ("held", UNKNOWN % "03-Oct-2026"), ("held", NOBODY)], "a new line: no body, an unknown delete / cancel, no GUID at all: the same words (%s)" % got)
    books_ok("held lines")
    # ---------------------------------------------------------------- 4b. a Day Book day stored: the held lines of that day run again
    print("== 4b. the Day Book days stored")
    a = day("2026-10-01", [V(CG + "-000066b0", 54370, "188", "Debtor B"), V(CG + "-000066c1", 54380, "189", "Debtor C")], LN(CG + "-000066b0", "Debtor B", 2500) + LN(CG + "-000066c1", "Debtor C", 4000))
    ok(a.get("ok") is True and a.get("sent") == 2, "the day 01-Oct-2026 stored through tally_ingest_day (%s)" % {k: a.get(k) for k in ("ok", "sent", "marked")})
    ok(vch(CG + "-000066c1").get("deleted") == "t" and vch(CG + "-000066b0").get("deleted") == "f" and row(L2["line_id"])["state"] == "applied",
       "Receipt 189 marked deleted by line 2, which is applied by itself (%s; %s)" % (vch(CG + "-000066c1"), row(L2["line_id"])))
    ok(row(L3["line_id"])["state"] == "held" and row(L1["line_id"])["why"] == NOBODY, "the lines of other days untouched")
    books_ok("01-Oct-2026 stored")
    a = day("2026-10-05", [V(CG + "-000066c5", 54385, "190", "Debtor D"), V(CG + "-000066c8", 54391, "192", "Debtor E")], LN(CG + "-000066c5", "Debtor D", 1500) + LN(CG + "-000066c8", "Debtor E", 700))
    ok(a.get("ok") is True and a.get("sent") == 2, "the day 05-Oct-2026 stored (%s)" % {k: a.get(k) for k in ("ok", "sent", "marked")})
    v190 = vch(CG + "-000066c5")
    ok(v190.get("cancelled") == "t" and v190.get("deleted") == "f" and row(L3["line_id"])["state"] == "applied", "Receipt 190 cancelled (not deleted) by line 3, applied by itself (%s; %s)" % (v190, row(L3["line_id"])))
    r4 = row(L4["line_id"])
    ok(r4["state"] == "duplicate" and "Receipt 192" in r4["why"] and CG + "-000066c8" in r4["why"], "line 4 (Receipt 192, placeholder GUID): the copy holds Receipt 192 of that day now: 'duplicate' (%s)" % r4)
    ok(row(L1["line_id"])["state"] == "held" and row(L1["line_id"])["why"] == NOBODY, "line 1 (Receipt 191, not in the day) still held, waiting for its details (%s)" % row(L1["line_id"]))
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and guid like %s" % (q(B), q("%-00000000"))) == "0", "never a voucher under the placeholder GUID")
    books_ok("05-Oct-2026 stored")
    # ---------------------------------------------------------------- 4a. bridge 2.2.1's resolved line for 191
    print("== 4a. the resolved line for Receipt 191")
    g191 = CG + "-000066c7"
    res = dict(sline(L1["line_id"] + ":resolved", "created", g191, "26311", 54392, "191", "2026-10-05", "2026-10-05T02:25:00.000Z"),
               vouchers=[dict(V(g191, 54392, "191", "Debtor F"), day="2026-10-05")], lines=LN(g191, "Debtor F", 3300))
    before = db.one("select coalesce(sum(amount), 0)::text from tally_ledger_day where book_id = %s and day = '2026-10-05' and ledger = 'Debtor F'" % q(B))
    r = apply([res])
    rid = row(res["line_id"])
    ok([x.get("state") for x in r.get("results", [])] == ["applied"], "the resolved line applied (%s)" % r.get("results"))
    r1 = row(L1["line_id"])
    ok(r1["state"] == "replaced" and r1["why"] == "replaced by line %s (the entry's details arrived)" % rid.get("id"), "line 1: 'replaced' by line %s (%s)" % (rid.get("id"), r1))
    v191 = vch(g191)
    ok(v191.get("vno") == "191" and v191.get("alter_id") == "54392" and v191.get("deleted") == "f" and db.one("select count(*) from tally_lines where book_id = %s and guid = %s" % (q(B), q(g191))) == "2",
       "Receipt 191 in tally_vouchers with its two lines (%s)" % v191)
    after = db.one("select coalesce(sum(amount), 0)::text from tally_ledger_day where book_id = %s and day = '2026-10-05' and ledger = 'Debtor F'" % q(B))
    ok(before == "0" and after == "3300", "the ledger-day total of 05-Oct-2026 updated (Debtor F %s -> %s)" % (before, after))
    ok(row(L4["line_id"])["state"] == "duplicate" and row("n-1")["state"] == "replaced", "line 4 left as it was; the other held line of Receipt 191 (n-1) replaced too")
    books_ok("191 arrived")
    # a real GUID held without a body, then that GUID applied at a higher AlterID
    gx = CG + "-000067aa"
    apply([sline("x-1", "created", gx, "26538", 54600, "193", "2026-10-05", "2026-10-05T04:00:00Z")])
    ok(row("x-1")["state"] == "held" and row("x-1")["why"] == NOBODY, "a real GUID without its body: held, waiting (%s)" % row("x-1"))
    apply([dict(sline("x-2", "altered", gx, "26538", 54601, "193", "2026-10-05", "2026-10-05T04:01:00Z"), vouchers=[dict(V(gx, 54601, "193", "Debtor G"), day="2026-10-05")], lines=LN(gx, "Debtor G", 900))])
    ok(row("x-2")["state"] == "applied" and row("x-1")["state"] == "replaced" and row("x-1")["why"] == "replaced by line %s (the entry's details arrived)" % row("x-2")["id"],
       "that GUID applied at a higher AlterID: the held line 'replaced' (%s)" % row("x-1"))
    books_ok("193 arrived")
    # ---------------------------------------------------------------- the day stored after a delete of an entry it does not hold
    print("== a Day Book made after the delete (the entry not in it)")
    a = day("2026-10-03", [V(CG + "-00007003", 54502, "303", "Debtor H")], LN(CG + "-00007003", "Debtor H", 100))
    n2, n3 = row("n-2"), row("n-3")
    ok(n2["state"] == "applied" and n2["why"] == NOTHING % ("03-Oct-2026", 54502), "an unknown delete whose day is stored complete and newer than it: applied, nothing to delete (%s)" % n2)
    ok(n3["state"] == "held" and n3["why"] == CANCEL_NOT % "03-Oct-2026",
       "an unknown cancel the same: still held, with what releases it (%s)" % n3)
    books_ok("03-Oct-2026 stored")
    # ---------------------------------------------------------------- the month lock: words as before; the day release leaves such a line to the owner
    as_user(OWNER, "select tally_month_lock('c1', '2026-11-01', 'closing')::text")
    apply([dict(sline("m-1", "created", CG + "-00008001", "32769", 54700, "400", "2026-11-02", "2026-10-05T05:00:00Z"), vouchers=[dict(V(CG + "-00008001", 54700, "400", "Debtor J"), day="2026-11-02")], lines=LN(CG + "-00008001", "Debtor J", 50))])
    ok(row("m-1")["state"] == "held" and row("m-1")["why"] == "month locked: 2026-11", "a locked month: held, 'month locked: 2026-11' as before (%s)" % row("m-1"))
    as_user(OWNER, "select tally_month_unlock('c1', '2026-11-01', 'open')::text")
    day("2026-11-02", [V(CG + "-00008002", 54701, "401", "Debtor K")], LN(CG + "-00008002", "Debtor K", 60))
    ok(row("m-1")["state"] == "held", "a line held for a locked month stays the owner's to release (the day release leaves it)")
    good, out = as_user(OWNER, "select tally_recorder_release_held(%s)::text" % row("m-1")["id"])
    ok(good and '"applied"' in (out or ""), "the owner's release applies it (%s)" % (out or "")[:160])
    books_ok("the owner's release")
    ok(db.one("select count(*) from tally_recorder_lines where held_why ilike '%day read%'") == "0", "at the end: no line's words say 'day read'")

    # ================================================================ the review of 50 (docs/reviews/migration-50-review.md)
    print("== review L3: a held delete without a GUID")
    ok(row("l3-del")["why"] == NOGUID_DEL % ("deleted", "22-Oct-2026"), "L3. the row held by 48 now says what happens to it (%s)" % row("l3-del")["why"])
    r = apply([dict(sline("l3-can", "cancelled", None, "0", 54396, "187", "2026-10-22", "2026-10-05T02:41:00.000Z"), object_guid=None)])
    ok([(x.get("state"), x.get("why")) for x in r.get("results", [])] == [("held", NOGUID_DEL % ("cancelled", "22-Oct-2026"))], "L3. a new cancel without a GUID: the same words (%s)" % r.get("results"))
    print("== review H1: 'nothing to delete' only on a complete Day Book made after the delete")
    apply([sline("e2a", "deleted", CG + "-0000a001", "40961", 64000, "620", "2026-10-08", "2026-10-05T06:00:00Z")])
    day("2026-10-08", [V(CG + "-0000a002", 64010, "621", "Debtor L")], LN(CG + "-0000a002", "Debtor L", 10), n=5)
    ok(row("e2a")["state"] == "held" and row("e2a")["why"] == UNKNOWN % "08-Oct-2026", "H1/E2a. a short read (1 of 5) does not make the delete 'nothing to delete': held (%s)" % row("e2a"))
    apply([sline("e2b", "deleted", CG + "-0000a101", "41217", 64100, "622", "2026-10-11", "2026-10-05T06:01:00Z")])
    e2b = day("2026-10-11", [], [], n=4)
    ok(row("e2b")["state"] == "held" and row("e2b")["why"] == UNKNOWN % "11-Oct-2026", "H1/E2b. an empty file the bridge counted 4 for (%s): held (%s)" % (e2b.get("refused"), row("e2b")))
    old_file = ([V(CG + "-0000a200", 64200, "623", "Debtor M")], LN(CG + "-0000a200", "Debtor M", 20))
    day("2026-10-09", *old_file)
    apply([sline("e3-del", "deleted", CG + "-0000a201", "41473", 64210, "611", "2026-10-09", "2026-10-05T06:02:00Z")])
    day("2026-10-09", *old_file)
    ok(row("e3-del")["state"] == "held" and row("e3-del")["why"] == UNKNOWN % "09-Oct-2026", "H1/E3. an old file read again (its AlterIDs reach 64200, the delete is 64210): held (%s)" % row("e3-del"))
    apply([dict(sline("e3-create", "created", CG + "-0000a201", "41473", 64205, "611", "2026-10-09", "2026-10-05T06:03:00Z"), pc="OTHERPC",
                vouchers=[dict(V(CG + "-0000a201", 64205, "611", "Debtor N"), day="2026-10-09")], lines=LN(CG + "-0000a201", "Debtor N", 30))])
    ok(row("e3-create")["state"] == "applied" and vch(CG + "-0000a201").get("deleted") == "t" and row("e3-del")["state"] == "applied",
       "H1/E3. the late create from another PC (AlterID 64205) brings the entry; the held delete (64210) is applied with it: Receipt 611 deleted, never live (%s; %s; %s)" % (row("e3-create"), row("e3-del"), vch(CG + "-0000a201")))
    day("2026-10-10", [V(CG + "-0000a300", 64300, "624", "Debtor O")], LN(CG + "-0000a300", "Debtor O", 40))
    apply([sline("h1-del", "deleted", CG + "-0000a301", "41729", 64290, "625", "2026-10-10", "2026-10-05T06:04:00Z")])
    ok(row("h1-del")["state"] == "applied" and row("h1-del")["why"] == NOTHING % ("10-Oct-2026", 64300), "H1. a complete Day Book whose AlterIDs reach past the delete: nothing to delete (%s)" % row("h1-del"))
    apply([dict(sline("h1-create", "created", CG + "-0000a301", "41729", 64280, "625", "2026-10-10", "2026-10-05T06:05:00Z"), pc="OTHERPC",
                vouchers=[dict(V(CG + "-0000a301", 64280, "625", "Debtor P"), day="2026-10-10")], lines=LN(CG + "-0000a301", "Debtor P", 50))])
    ok(row("h1-create")["state"] == "stale" and "64290" in row("h1-create")["why"] and vch(CG + "-0000a301") == {}, "H1. a later create of that GUID with a LOWER AlterID: 'stale', the deleted entry never revived (%s)" % row("h1-create"))
    books_ok("H1")
    print("== review M1: matching")
    day("2026-10-06", [V(CG + "-00009000", 63000, "500", "Debtor Q")], LN(CG + "-00009000", "Debtor Q", 60))
    apply([sline("e1a", "altered", PH, "0", 0, "500", "2026-10-06", "2026-10-05T06:10:00Z")])
    ok(row("e1a")["state"] == "held", "M1/E1a. a placeholder 'altered' Receipt 500 with no proof the copy has the change: held (%s)" % row("e1a"))
    apply([dict(sline("e1a-b", "created", CG + "-00009001", "36865", 63010, "500", "2026-10-06", "2026-10-05T06:11:00Z"), vouchers=[dict(V(CG + "-00009001", 63010, "500", "Debtor R"), day="2026-10-06")], lines=LN(CG + "-00009001", "Debtor R", 70))])
    ok(row("e1a-b")["state"] == "applied" and row("e1a")["state"] == "held", "M1/E1a. another Receipt 500 applied (two of that number now): the placeholder NOT replaced (%s)" % row("e1a"))
    apply([sline("m1-ph", "created", PH, "37000", 0, "510", "2026-10-07", "2026-10-05T06:12:00Z")])
    apply([dict(sline("m1-other", "created", CG + "-00009089", "37001", 63100, "510", "2026-10-07", "2026-10-05T06:13:00Z"), vouchers=[dict(V(CG + "-00009089", 63100, "510", "Debtor S"), day="2026-10-07")], lines=LN(CG + "-00009089", "Debtor S", 80))])
    ok(row("m1-ph")["state"] == "held", "M1. MasterID 37000 (GUID ...00009088): another entry of the same number (...00009089) does not replace it (%s)" % row("m1-ph"))
    apply([dict(sline("m1-own", "created", CG + "-00009088", "37000", 63101, "510", "2026-10-07", "2026-10-05T06:14:00Z"), vouchers=[dict(V(CG + "-00009088", 63101, "510", "Debtor T"), day="2026-10-07")], lines=LN(CG + "-00009088", "Debtor T", 90))])
    ok(row("m1-ph")["state"] == "replaced" and row("m1-ph")["why"] == "replaced by line %s (the entry's details arrived)" % row("m1-own")["id"], "M1. its own GUID (derived from the MasterID) replaces it (%s)" % row("m1-ph"))
    apply([sline("e1e", "created", PH, "37200", 0, "503", "2026-10-12", "2026-10-05T06:15:00Z"), sline("e1e-own", "created", PH, "37201", 0, "503", "2026-10-12", "2026-10-05T06:15:30Z")])
    day("2026-10-12", [V(CG + "-00009151", 63200, "503", "Debtor U")], LN(CG + "-00009151", "Debtor U", 100))
    ok(row("e1e")["state"] == "held" and row("e1e-own")["state"] == "duplicate" and CG + "-00009151" in row("e1e-own")["why"],
       "M1/E1e. a Day Book holding Receipt 503 under MasterID 37201: that placeholder 'duplicate', the one of MasterID 37200 still held (%s; %s)" % (row("e1e"), row("e1e-own")))
    apply([sline("e1d", "altered", PH, "20480", 0, "150", "2026-03-31", "2026-10-05T06:16:00Z")])
    ok(row("e1d")["state"] == "held" and row("e1d")["why"] == NOBODY, "M1/E1d. a placeholder 'altered' of Receipt 150 the copy holds at its OLD version (Day Book stored before the change): held, not 'duplicate' (%s)" % row("e1d"))
    apply([dict(sline("e1c", "created", None, "0", 0, "520", "2026-10-18", "2026-10-05T06:17:00Z"), object_guid=None, company_guid="")])
    apply([dict(sline("e1c-b", "created", CG + "-00009200", "37376", 63300, "520", "2026-10-18", "2026-10-05T06:18:00Z"), vouchers=[dict(V(CG + "-00009200", 63300, "520", "Debtor V"), day="2026-10-18")], lines=LN(CG + "-00009200", "Debtor V", 110))])
    ok(row("e1c")["state"] == "held", "M1/E1c. a line with no GUID and no company GUID is never matched (never null = null): held (%s)" % row("e1c"))
    books_ok("M1")
    print("== review L4: a placeholder never raises the AlterID received")
    day("2026-10-21", [V(CG + "-00009300", 63400, "530", "Debtor W")], LN(CG + "-00009300", "Debtor W", 120))
    mx0 = db.one("select recorder_max_alter from tally_sync_cursor where book_id = %s" % q(B))
    apply([sline("l4", "created", PH, "0", 99999, "530", "2026-10-21", "2026-10-05T06:20:00Z")])
    ok(row("l4")["state"] == "duplicate" and db.one("select recorder_max_alter from tally_sync_cursor where book_id = %s" % q(B)) == mx0, "L4. a placeholder line 'duplicate' with AlterID 99999: recorder_max_alter stays %s" % mx0)
    print("== review L2: an error in a re-run keeps the line held")
    gb = CG + "-0000b001"
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, held_why, body)
              values (%s, 'c1', %s, %s, 'l2', 'created', %s, 65000, 'Receipt', '600', '2026-10-13', 'held', %s, %s)""" % (q(F), q(B), q(D1), q(gb), q(NOBODY),
              js({"vouchers": [dict(V(gb, 65000, "600", "Debtor X"), day="2026-10-13")], "lines": [[gb, "Cash", "not a number", "", None, []]]})))
    a = day("2026-10-13", [V(gb, 64990, "600", "Debtor X")], LN(gb, "Debtor X", 130))
    ok(a.get("ok") is True and row("l2")["state"] == "held" and row("l2")["why"].startswith(NOBODY + ERRSUF), "L2. the re-run errors: the line stays held, its words kept with the error said (%s)" % row("l2"))
    a = day("2026-10-13", [V(gb, 64990, "600", "Debtor X")], LN(gb, "Debtor X", 130))
    ok(row("l2")["why"].count(ERRSUF) == 1, "L2. and again: the error said once, not piled up (%s)" % row("l2")["why"])
    books_ok("L2")
    print("== review L6: one statement over many days")
    day("2026-10-14", [V(CG + "-0000c001", 66100, "640", "Debtor Y")], LN(CG + "-0000c001", "Debtor Y", 140))
    day("2026-10-15", [V(CG + "-0000c002", 66110, "641", "Debtor Z")], LN(CG + "-0000c002", "Debtor Z", 150))
    for lid, g, d in (("l6-a", CG + "-0000c001", "2026-10-14"), ("l6-b", CG + "-0000c002", "2026-10-15")):
        db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, held_why, body)
                  values (%s, 'c1', %s, %s, %s, 'deleted', %s, 66200, 'Receipt', '6', %s, 'held', %s, '{}')""" % (q(F), q(B), q(D1), q(lid), q(g), q(d), q(UNKNOWN % d)))
    db.sql("update tally_days set bytes = bytes where book_id = %s and day in ('2026-10-14', '2026-10-15')" % q(B))
    ok(row("l6-a")["state"] == "applied" and row("l6-b")["state"] == "applied" and vch(CG + "-0000c001").get("deleted") == "t" and vch(CG + "-0000c002").get("deleted") == "t",
       "L6. one UPDATE of two days: both days' held deletes released by the statement trigger")
    books_ok("L6")
    print("== review M2: only the lines a day can release; no rewrite; no starvation")
    gin, gout = CG + "-0000d002", CG + "-0000d001"
    apply([sline("m2-out", "created", gout, "53249", 66000, "650", "2026-10-16", "2026-10-05T06:30:00Z"), sline("m2-in", "created", gin, "53250", 66010, "651", "2026-10-16", "2026-10-05T06:31:00Z")])
    x0 = {k: db.one("select xmin::text from tally_recorder_lines where line_id = %s" % q(k)) for k in ("m2-out", "m2-in")}
    day("2026-10-16", [V(gin, 66000, "651", "Debtor AA")], LN(gin, "Debtor AA", 160))
    x1 = {k: db.one("select xmin::text from tally_recorder_lines where line_id = %s" % q(k)) for k in ("m2-out", "m2-in")}
    ok(x0 == x1 and row("m2-in")["state"] == "held" and row("m2-out")["state"] == "held", "M2. a line the day cannot release is not run; a line run again that stays held is not rewritten (xmin %s -> %s)" % (x0, x1))
    gs = [CG + "-0000e%03x" % i for i in range(20)]
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, held_why, body)
              select %s, 'c1', %s, %s, 'e4-' || i, 'created', (%s::text[])[1 + i %% 20], 67000 + i, 'Receipt', '7', '2026-10-17', 'held', %s, '{}' from generate_series(1, 600) i""" % (q(F), q(B), q(D1), q("{" + ",".join(gs) + "}"), q(NOBODY)))
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, held_why, body)
              values (%s, 'c1', %s, %s, 'e4-del', 'deleted', %s, 68000, 'Receipt', '7', '2026-10-17', 'held', %s, '{}')""" % (q(F), q(B), q(D1), q(gs[5]), q(UNKNOWN % "17-Oct-2026")))
    day("2026-10-17", [V(g, 66500, "7%02d" % i, "Debtor AB") for i, g in enumerate(gs)], [l for g in gs for l in LN(g, "Debtor AB", 10)])
    ok(row("e4-del")["state"] == "applied" and vch(gs[5]).get("deleted") == "t", "M2/E4. the 601st held line (a delete the day holds) applied on the first store: no 500 window (%s)" % row("e4-del"))
    books_ok("E4")
    print("== review L1 and M2: one day with 3,000 held lines; a statement timeout inside the release")
    gt = [CG + "-0000f%03x" % i for i in range(20)]
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, held_why, body)
              select %s, 'c1', %s, %s, 'big-' || i, 'created', (%s::text[])[1 + i %% 20], 69000 + i, 'Receipt', '8', '2026-10-20', 'held', %s, '{}' from generate_series(1, 3000) i""" % (q(F), q(B), q(D1), q("{" + ",".join(gt) + "}"), q(NOBODY)))
    db.sql("analyze tally_recorder_lines; analyze tally_vouchers")     # as autovacuum keeps staging's statistics after a burst of rows
    big = ([V(g, 68500, "8%02d" % i, "Debtor AC") for i, g in enumerate(gt)], [l for g in gt for l in LN(g, "Debtor AC", 10)])
    def timed(sql):
        out = db.sql("\\timing on\n" + sql)
        return sum(float(m) for m in re.findall(r"Time: ([0-9.]+) ms", out))
    dsql = "select tally_ingest_day(%s, '2026-10-20', %s, %s, 20, 68500, 0)::text;" % (q(B), js(big[0]), js(big[1]))
    db.sql("alter table tally_days disable trigger tally_days_recorder_release_ins; alter table tally_days disable trigger tally_days_recorder_release_upd;")
    t_off = [timed(dsql) for _ in range(2)]
    db.sql("alter table tally_days enable trigger tally_days_recorder_release_ins; alter table tally_days enable trigger tally_days_recorder_release_upd;")
    t_on = [timed(dsql) for _ in range(2)]
    print("       one day, 20 entries, 3,000 held lines without a body whose GUIDs the day holds at an older version (none can change: not run): trigger off %s ms, on %s ms" % (["%.0f" % x for x in t_off], ["%.0f" % x for x in t_on]))
    ok(db.one("select count(*) from tally_recorder_lines where line_id like 'big-%' and state = 'held'") == "3000", "the 3,000 stay held")
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, held_why, body)
              values (%s, 'c1', %s, %s, 'big-del', 'deleted', %s, 72000, 'Receipt', '803', '2026-10-20', 'held', %s, '{}')""" % (q(F), q(B), q(D1), q(gt[3]), q(UNKNOWN % "20-Oct-2026")))
    hold = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-q", "-c",
                             "begin; select 1 from tally_recorder_lines where line_id = 'big-del' for update; select pg_sleep(4); commit;"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import time as _t; _t.sleep(0.8)
    try:
        a = j("set statement_timeout = '1500ms'; select tally_ingest_day(%s, '2026-10-20', %s, %s, 20, 68500, 0)::text" % (q(B), js(big[0]), js(big[1])))
    finally:
        hold.wait()
    ok(a.get("ok") is True and "_error" not in a and row("big-del")["state"] == "held", "L1. a statement timeout while the release waits on a line: caught and logged, the day stored all the same, the line left held (%s)" % str(a)[:200])
    day("2026-10-20", *big)
    ok(row("big-del")["state"] == "applied" and vch(gt[3]).get("deleted") == "t", "L1. the next store of that day releases it (%s)" % row("big-del"))
    books_ok("L1")
    rsrc = prosrc("tally_recorder_release_day(uuid, date)")
    ok("for update" in rsrc and "is distinct from 'held'" in rsrc and "limit 500" not in rsrc, "L5. each line is locked and re-checked still held before it runs again; M2: no fixed 500 window")
    if os.environ.get("M50_PERF"):
        print("== M2: 365 days, 3,000 held lines (M50_PERF)")
        db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, object_guid, master_id, alter_id, vch_type, vch_no, vch_date, state, held_why, body)
                  select %s, 'c1', %s, %s, 'yr-' || i, case when i %% 3 = 0 then 'deleted' else 'created' end,
                         case when i %% 3 = 1 then %s else %s || '-' || lpad(to_hex(900000 + i), 8, '0') end, case when i %% 3 = 1 then (800000 + i)::text else '0' end,
                         70000 + i, 'Receipt', 'Y' || i, date '2027-04-01' + (i %% 365), 'held', 'w', '{}' from generate_series(1, 3000) i""" % (q(F), q(B), q(D1), q(PH), q(CG)))
        db.sql("analyze tally_recorder_lines; analyze tally_vouchers")
        def year(tag):
            tot = 0.0
            for k in range(365):
                d = "%s" % (__import__("datetime").date(2027, 4, 1) + __import__("datetime").timedelta(days=k))
                gg = [CG + "-%08x" % (0x100000 + k * 20 + i) for i in range(20)]
                tot += timed("select tally_ingest_day(%s, %s, %s, %s, 20, 1, 0)::text;" % (q(B), q(d), js([V(g, 80000 + k, "D%d-%d" % (k, i), "Debtor YR") for i, g in enumerate(gg)]), js([l for g in gg for l in LN(g, "Debtor YR", 10)])))
            return tot
        y_on1 = year("on, first store")
        db.sql("alter table tally_days disable trigger tally_days_recorder_release_ins; alter table tally_days disable trigger tally_days_recorder_release_upd;")
        y_off = year("off, stored again")
        db.sql("alter table tally_days enable trigger tally_days_recorder_release_ins; alter table tally_days enable trigger tally_days_recorder_release_upd;")
        y_on = year("on, stored again")
        print("       365 days x 20 entries, 3,000 held lines (about 8 a day, each day's deletes run again and stay held): first store, trigger on %.0f ms (%.1f ms a day)" % (y_on1, y_on1 / 365))
        print("       the same days stored again: trigger off %.0f ms (%.1f ms a day), on %.0f ms (%.1f ms a day)" % (y_off, y_off / 365, y_on, y_on / 365))
    print("\n  md5(prosrc) of 50's functions:")
    for k, v in md5s.items(): print("    %-60s %s" % (k, v))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
