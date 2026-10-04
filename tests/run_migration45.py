"""python3 run_migration45.py - migration-45-bulk-posting (04-Oct-2026, docs/recorder-bulk-posting.md sections 3 and 4) on a
throwaway PostgreSQL (pg_stand), staging's order 32 -> ... -> 43 -> 44, made-up rows, then 45 twice. Never a real database.
First run_migration44.py's own checks are run again with 45 applied right after 44 (a file of 44 then 45 given as its M44_FILE),
so every rule of 44 (the gap check's unknown 0, below the start needs_baseline, the start recorded, the recorder's lines) holds.
Then:
 3. NO FALSE ALARM AFTER A BULK POSTING. tally_post_windows (RLS, the firm reads, nobody writes) filled by
    tally_post_window_save(firm, job, device, a0, a1, vouchers created, masters created) (service role; bounds 0..10^15, a1 not
    below a0, the job of this firm and computer; one row per job, a later save updates it). tally_recorder_gap_check: start
    1000, a job of 100 bills accepted (each created 1), window 1000..1100 created 100, no recorder line, ALTVCHID 1100 -> no
    gap, last_match_at set (and the next beat too); the same without a window (the fallback: accepted after the start, not
    matched) -> no gap, the next beat too; accepted BEFORE the start -> a gap of 100 (control); masters created by those
    postings -> 'of which up to k may be FinCom's own new ledgers'; window a1 1103 -> 'up to 3 changes not received during
    the posting of ...' with 'up to 3 changes not received since' kept; window plus 100 matched recorder lines -> never
    subtracted twice (1100: no gap; 1105: up to 5).
 4. NO DOUBLING. A job of 500 accepted bills with payload XML, 500 short lines (fid, the body built from the posting as
    tally-ingest does) -> 500 applied, 500 tally_post_ids matched (matched_at, matched_vch, matched_guid, matched_mid,
    matched_alter), 500 entries, 0 held, 0 duplicate; the same 500 again -> 500 duplicate, still 500; the day book of that day
    through tally_ingest_day by GUID -> still 500 entries, 500 versions, the trial balance per ledger unchanged. A short line
    whose FinCom id matches nothing (or another firm's) -> held 'FinCom id <id> matches no posting of this firm', no entry;
    a matched short line without a body -> stamped, held; the same FinCom id from another GUID -> held. tally_post_xml_for
    (firm, book, fids): the posted XML of the live accepted ids only.
 R. tally_recorder_lines in the supabase_realtime publication once (45 run twice).
 S. Every function of 45: security definer, search_path = public, pg_temp; grants as 44's pattern.
 G. The database review's scenarios (docs/reviews/migration-45-review.md), each by name: G1, G2, G2b (H1: the fallback counts
    only postings accepted after the server's time of the newest thing that set the baseline; match_at), G3, G4, G4g (M1: a
    window credits only below Tally's number, only what must be FinCom's, only for the book's company GUID), G5 (M2: vouchers
    only, the ledgers named), G6 (L1), G7 (M3: counts bounded by the payload, a finished job's window kept, a cancelled job's
    refused), G10 (H2: a short 'altered' line, or one for an entry the copy holds, held 'changed in Tally after posting', the
    copy unchanged, the gap check counts it), G12, L4 (a full line stamps only the live posting of this book's company), L10
    (below the last match read after it: needs_baseline), M6 (a held short line re-run on acceptance:
    tally_recorder_short_held / tally_recorder_short_retry), M4 (200,000 ids: 500 unknown ids under 2 s, 500 unmatched short
    lines under 5 s, the spelling rule kept). L2 (lock_timeout: 45 gives up behind a held lock), L6 (privileges under
    Supabase's default privileges) and the text holding no 'delete from' at all.
RED (before 45): SKIP45=1. ONLY=3 / 4 / G: that item alone."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand, csv
csv.field_size_limit(1 << 30)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql")]
M45 = os.environ.get("M45_FILE") or os.path.join(SQLDIR, "migration-45-bulk-posting.sql")
SKIP45 = os.environ.get("SKIP45") == "1"
ONLY = os.environ.get("ONLY", "")          # "3" or "4": that item's checks alone (the red runs)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
want = lambda item: not ONLY or ONLY == item

# ---------------------------------------------------------------- 0. run_migration44.py's checks with 45 applied after 44
if os.environ.get("SKIP44RUN") != "1" and not ONLY:
    print("== run_migration44.py with migration-45 applied after each run of 44 (44's rules hold on 45's texts)")
    p44 = os.path.join(HERE, "run_migration44.py"); src = open(p44).read()
    hook = "db = pg_stand.start(55451)\n"
    assert hook in src, "run_migration44.py changed: the hook line is gone"
    src = src.replace(hook, hook + "_pf = None\n", 1)
    k = src.index("\ndef as_user(uid, stmt):")     # its own def at the start of a line (not the text it hands run_migration43.py)
    src = src[:k] + "\n_pf, psql_file = psql_file, (lambda path: (lambda r: _pf(%r) if r.returncode == 0 and path == M44 and %r else r)(_pf(path)))" % (M45, not SKIP45) + src[k:]
    r = subprocess.run([sys.executable, "-"], input="__file__ = %r\n" % p44 + src, capture_output=True, text=True, env=dict(os.environ, SKIP43RUN="1"))
    out = r.stdout + r.stderr
    n_ok, n_fail = out.count("  ok   "), out.count("  FAIL ")
    for l in out.splitlines():
        if "FAIL" in l or "Traceback" in l: print("    | " + l[:300])
    ok(r.returncode == 0 and n_fail == 0 and n_ok >= 100, "0. run_migration44.py passes with 45 applied after 44 (%d ok, %d failed)" % (n_ok, n_fail))

F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, OTHER = "55555555-5555-5555-5555-555555555555", "33333333-3333-3333-3333-333333333333"
D1, D3 = "d1000000-0000-0000-0000-000000000001", "d3000000-0000-0000-0000-000000000003"
BK = {k: "%s0000000-1111-1111-1111-111111111111" % n for k, n in (("W", "a"), ("FB", "b"), ("PRE", "c"), ("MST", "d"), ("NF", "e"), ("M", "f"), ("S", "7"), ("X", "8"))}
CO = {"W": "ZZ WINDOW", "FB": "ZZ FALLBACK", "PRE": "ZZ BEFORE", "MST": "ZZ MASTERS", "NF": "ZZ NOT FULL", "M": "ZZ MATCHED", "S": "ZZ SIX", "X": "THEIR CO"}
JOB = lambda k: "%08d-0000-0000-0000-000000000001" % (["W", "FB", "PRE", "MST", "NF", "M", "S", "X", "S2", "S3"].index(k) + 1)
db = pg_stand.start(55453)
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
def vxml(fid, n, day="20260814", amt=100):
    # FinCom's posted voucher, as voucherXml (src/js/01) writes it: no GUID, no ALTERID (Tally gives them)
    return ('<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>%s</DATE>\n<EFFECTIVEDATE>%s</EFFECTIVEDATE>\n<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>\n'
            '<REFERENCE>INV-%d</REFERENCE>\n<REFERENCEDATE>%s</REFERENCEDATE>\n<PARTYLEDGERNAME>Supplier %d</PARTYLEDGERNAME>\n<NARRATION>Bill %d | TDSDesk:%s</NARRATION>\n'
            '<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>Rent</LEDGERNAME>\n<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<AMOUNT>-%d.00</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n'
            '<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>Supplier %d</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>%d.00</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n</VOUCHER>\n') % (day, day, n, day, n % 7, n, fid, amt, n % 7, amt)
def job(key, book_key, fids, status="done", accept=True, masters=0, results=None):
    jid = JOB(key)
    payload = {"vouchers": [{"id": f, "xml": vxml(f, i + 1)} for i, f in enumerate(fids)], "masters": [{"id": "m%d" % i, "xml": "<LEDGER NAME=\"New %d\"></LEDGER>" % i} for i in range(masters)]}
    res = results if results is not None else [{"id": f, "ok": True, "byReply": True, "created": 1, "kind": "voucher"} for f in fids] + [{"id": "m%d" % i, "ok": True, "created": 1, "kind": "master"} for i in range(masters)]
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, results, taken_at) values (%s, %s, 'c1', %s, %s, %s, %d, %s, %s, now())"
           % (q(jid), q(F if book_key != "X" else F2), q(CO[book_key]), q(D1 if book_key != "X" else D3), js(payload), len(fids) + masters, q(status), js(res)))
    if accept: db.sql("update tally_post_ids set accepted_at = now() where job_id = %s" % q(jid))
    return jid
gap = lambda k, alt, at="now()": j("select tally_recorder_gap_check(%s, %s, %s, %s)::text" % (q(BK[k]), q(D1), alt, at))
cur = lambda k: (db.rows("select last_voucher_alterid, recorder_max_alter, gap::text as gap, last_match_at, state, start_at from tally_sync_cursor where book_id = %s" % q(BK[k])) or [{}])[0]
def save(jid, a0, a1, v, m, firm=F, dev=D1, guid="cg-1"):
    # review M1: the window carries the company GUID the bridge read (8 arguments); the 7-argument form before the fix
    if jn("select count(*) from pg_proc where proname = 'tally_post_window_save' and pronargs = 8") == "1":
        return j("select tally_post_window_save(%s, %s, %s, %s, %s, %s, %s, %s)::text" % (q(firm), q(jid), q(dev), a0, a1, v, m, q(guid) if guid is not None else "null"))
    return j("select tally_post_window_save(%s, %s, %s, %s, %s, %s, %s)::text" % (q(firm), q(jid), q(dev), a0, a1, v, m))
cg = lambda k, g="cg-1": db.sql("update tally_sync_cursor set start_guid = %s where book_id = %s" % (q(g), q(BK[k])))     # the book's company GUID (a read or start_point gives it)
apply = lambda k, lines, dev=D1: j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(BK[k]), q(dev), js(lines)))
fdef = lambda sig: jn("select pg_get_functiondef(%s::regprocedure)" % q("public." + sig)) or ""
def V(guid, alter, day, fid, no=""):
    return {"guid": guid, "alter": alter, "type": "Journal", "no": no, "party": "Supplier", "narr": "Bill | TDSDesk:" + fid, "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": fid, "day": day}
def short(lid, guid, alter, fid, body=True, day="2026-08-14", amt=100, vch_no="", **kw):
    x = {"line_id": lid, "event": "created", "saved_at": "2026-10-04T10:00:00+05:30", "pc": "NWS144", "company_guid": "cg-1", "object_guid": guid, "master_id": "m-" + guid,
         "alter_id": alter, "fid": fid, "short": True, "vch_no": vch_no}
    if body:     # what tally-ingest builds from the posting's XML (parse.js), with the line's GUID and AlterID
        x["vouchers"] = [V(guid, alter, day, fid)]; x["lines"] = [[guid, "Rent", -amt, "", None, []], [guid, "Supplier", amt, "", None, []]]
    x.update(kw); return x
st = lambda r: {x.get("line_id"): x.get("state") for x in (r.get("results") or [])}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(T)s, %(F2)s, 'Them', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.2.0'), (%(D3)s, %(F2)s, 'THEIRS', 'h3', '2.2.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "T": q(OTHER), "D1": q(D1), "D3": q(D3)})
    for k, b in BK.items():
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', %s, '2026-04-01', '2026-03-31')" % (q(b), q(F if k != "X" else F2), q(CO[k])))
    db.sql("do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;")
    for path in FILES:
        r = psql_file(path)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_days", "tally_post_ids", "tally_post_jobs", "tally_recorder_lines", "tally_voucher_versions", "tally_ledger_day", "tally_sync_cursor"]}
    before = counts()
    if SKIP45: print("  (SKIP45: migration-45 not applied; the checks below are expected to FAIL)")
    else:
        fkdefs = []
        fk = lambda: db.rows("select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as d from pg_constraint where contype = 'f' and confrelid in ('public.tally_books'::regclass, 'public.tally_post_jobs'::regclass) and conrelid::regclass::text in ('tally_recorder_lines', 'tally_month_locks', 'tally_tieouts', 'tally_post_windows') order by 1, 2")
        for i in (1, 2):
            r = psql_file(M45); ok(r.returncode == 0, "migration-45 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
            fkdefs.append(fk())
        if r.returncode: raise SystemExit("cannot go on without the migration")
        ok(counts() == before, "nothing deleted or added by the migration")
    body = open(M45).read().lower() if os.path.exists(M45) else ""
    code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    code = re.sub(r"execute format\('alter table [^']*'", "execute format('(the restrict swap)'", code)     # the owner's RESTRICT swap (38's pattern): drop and re-add a foreign key
    if not ONLY:
        ok(body != "" and "delete from" not in code and not any(w in code for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop constraint", "drop index", "truncate table", "truncate public"]) and code.strip().startswith("begin;") and code.strip().endswith("commit;"),
           "the file drops and deletes nothing; one transaction")
        ok(body != "" and all(re.match(r"alter table (if exists )?public\.\w+ (add column if not exists|enable row level security)", m.group(0)) for m in re.finditer(r"alter table[^;]*;", code)), "every alter table adds a column if missing or turns row level security on")
        ok(body != "" and "delete from" not in body, "the file's text holds no 'delete from' anywhere (comments included)")
        ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", body, re.M) is not None, "L2. set local lock_timeout = '10s' at the top of the transaction (the swap never waits long on tally_books)")
        ok(all(w in body for w in ["runs after 44", "tally_post_windows", "fully accounted", "fallback", "never subtract", "short line", "matches no posting of this firm", "supabase_realtime"]), "the header names the order, the windows, the fallback, the short line and the publication")

    # ---------------------------------------------------------------- 3. no false alarm after a bulk posting
    if want("3"):
        print("== 3. no false alarm after a bulk posting")
        r = gap("W", 1000)
        ok(r.get("startRecorded") is True, "3. the book's starting point is 1000 (%s)" % r)
        cg("W")
        jw = job("W", "W", ["W%d" % i for i in range(100)])
        r = save(jw, 1000, 1100, 100, 0)
        ok(r.get("ok") is True and jn("select count(*) from tally_post_windows where job_id = %s and book_id = %s and a0 = 1000 and a1 = 1100 and created_vch = 100 and created_mst = 0 and device_id = %s" % (q(jw), q(BK["W"]), q(D1))) == "1",
           "3. the window stored per book: firm, book, job, device, a0 1000, a1 1100, 100 created (%s)" % r)
        r = gap("W", 1100); c = cur("W")
        ok(r.get("gap") is None and r.get("matched") is True and c.get("last_match_at") and not c.get("gap"), "3. ALTVCHID 1100 after the window, no recorder line: no gap, last_match_at set (%s)" % r)
        r = gap("W", 1100)
        ok(r.get("gap") is None, "3. the next beat at 1100: still no gap (%s)" % r)
        r = gap("W", 1104); g = r.get("gap") or {}
        ok(r.get("missing") == 4 and "up to 4 changes not received since" in str(g.get("words")), "3. four changes after the posting: up to 4 (%s)" % g.get("words"))
        # bounds and ownership
        n0 = jn("select count(*) from tally_post_windows")
        bad = [save(jw, -1, 1100, 100, 0), save(jw, 1000, 10**15, 100, 0), save(jw, 1100, 1000, 0, 0), save(jw, 1000, 1100, -5, 0), save(jw, 1000, 1100, 100, 0, firm=F2), save(jw, 1000, 1100, 100, 0, dev=D3)]
        ok(all(b.get("ok") is False and b.get("error") for b in bad) and jn("select count(*) from tally_post_windows") == n0 and jn("select a1 from tally_post_windows where job_id = %s" % q(jw)) == "1100",
           "3. out of bounds (below 0, 10^15, a1 below a0, a negative count), another firm's or computer's job: refused with words, nothing stored (%s)" % [b.get("error") for b in bad])
        r = save(jw, 1000, 1100, 100, 0)
        ok(r.get("ok") is True and jn("select count(*) from tally_post_windows where job_id = %s" % q(jw)) == "1", "3. one window per job: saved again, updated in place")
        # the fallback: no window
        gap("FB", 1000)
        job("FB", "FB", ["F%d" % i for i in range(100)])
        r = gap("FB", 1100); c = cur("FB")
        ok(r.get("gap") is None and c.get("last_match_at"), "3. the same without a window (fallback: 100 accepted after the start, not matched): no gap (%s)" % r)
        r = gap("FB", 1100)
        ok(r.get("gap") is None, "3. fallback, the next beat at 1100: no gap (the last match keeps the number reached) (%s)" % r)
        r = gap("FB", 1103); g = r.get("gap") or {}
        ok(r.get("missing") == 3 and "ledgers" not in str(g.get("words")), "3. fallback, 3 more changes: up to 3, no ledgers named (no masters created) (%s)" % g.get("words"))
        # control: postings accepted BEFORE the starting point are below it, never subtracted
        job("PRE", "PRE", ["P%d" % i for i in range(100)])
        gap("PRE", 1000)
        r = gap("PRE", 1100)
        ok(r.get("missing") == 100, "3. control: postings accepted before the start are not subtracted (up to 100) (%s)" % r.get("missing"))
        # masters created by the postings (fallback)
        gap("MST", 1000)
        job("MST", "MST", ["MS%d" % i for i in range(100)], masters=2)
        r = gap("MST", 1102); g = r.get("gap") or {}
        ok(r.get("missing") == 2 and "up to 2 changes not received since" in str(g.get("words")) and "of which up to 2 may be FinCom's own new ledgers" in str(g.get("words")),
           "3. fallback with 2 ledgers created by the posting: up to 2, 'of which up to 2 may be FinCom's own new ledgers' (%s)" % g.get("words"))
        # a window that does not fully account
        gap("NF", 1000)
        cg("NF")
        jn_ = job("NF", "NF", ["N%d" % i for i in range(100)])
        save(jn_, 1000, 1103, 100, 0)
        r = gap("NF", 1103); g = r.get("gap") or {}
        ok(r.get("missing") == 3 and "up to 3 changes not received since" in str(g.get("words")) and re.search(r"up to 3 changes not received during the posting of \d\d-\w{3}-\d{4} \d\d:\d\d", str(g.get("words"))),
           "3. window a1 1103 (100 created): 'up to 3 changes not received during the posting of <time IST>' (%s)" % g.get("words"))
        # window plus 100 matched recorder lines: never subtracted twice
        gap("M", 1000)
        cg("M")
        jm = job("M", "M", ["MM%d" % i for i in range(100)])
        save(jm, 1000, 1100, 100, 0)
        r = apply("M", [short("mm%d" % i, "gm-%d" % i, 1001 + i, "MM%d" % i) for i in range(100)])
        ok(r.get("applied") == 100 and jn("select count(*) from tally_post_ids where job_id = %s and matched_at is not null" % q(jm)) == "100" and cur("M").get("recorder_max_alter") == "1100",
           "3. 100 recorder lines of the posting matched; recorder_max_alter 1100 (%s)" % {k: r.get(k) for k in ("applied", "held", "failed")})
        r = gap("M", 1100)
        ok(r.get("gap") is None, "3. window plus 100 matched lines, ALTVCHID 1100: no gap (%s)" % r)
        r = gap("M", 1105)
        ok(r.get("missing") == 5, "3. window plus 100 matched lines, ALTVCHID 1105: up to 5, never subtracted twice (%s)" % r.get("missing"))
        # 44's gap check kept: unknown 0, below the start
        c0 = cur("W"); r = gap("W", 0)
        ok(r.get("unknown") is True and cur("W") == c0, "3. 44 kept: ALTVCHID 0 is unknown, the cursor untouched")
        r = gap("W", 900)
        ok(r.get("needsBaseline") is True and r.get("gap") is None and cur("W").get("state") == "needs_baseline", "3. 44 kept: below the start, needs_baseline, never a gap")
        ok(jn("select has_function_privilege('authenticated', 'tally_post_window_save(uuid, uuid, uuid, bigint, bigint, bigint, bigint, text)', 'execute')") == "f"
           and jn("select has_function_privilege('service_role', 'tally_post_window_save(uuid, uuid, uuid, bigint, bigint, bigint, bigint, text)', 'execute')") == "t", "3. tally_post_window_save: the service role's")

    # ---------------------------------------------------------------- 4. no doubling
    if want("4"):
        print("== 4. a posted entry lands on FinCom's entry")
        N = 500
        fids = ["S%03d" % i for i in range(N)]
        js_ = job("S", "S", fids)
        x = j("select tally_post_xml_for(%s, %s, %s)::text" % (q(F), q(BK["S"]), q("{" + ",".join(fids + ["NOPE"]) + "}")))
        posts = x.get("posts") or []
        ok(x.get("ok") is True and len(posts) == N and all("TDSDesk:" + p.get("fid") in (p.get("xml") or "") and p.get("job") == js_ for p in posts), "4. tally_post_xml_for: the posted XML of the 500 (none for an unknown id) (%d)" % len(posts))
        x2 = j("select tally_post_xml_for(%s, %s, '{S001}')::text" % (q(F2), q(BK["S"])))
        ok(not (x2.get("posts") or []), "4. tally_post_xml_for: another firm gets nothing (%s)" % x2)
        tb = lambda: {r["ledger"]: r["s"] for r in db.rows("select ledger, sum(amount)::text as s from tally_ledger_day where book_id = %s group by ledger order by 1" % q(BK["S"]))}
        nv = lambda: int(db.one("select count(*) from tally_vouchers where book_id = %s" % q(BK["S"])))
        lines = [short("s%d" % i, "gs-%d" % i, 2001 + i, fids[i], vch_no="J-%d" % (i + 1)) for i in range(N)]
        r = apply("S", lines)
        m = (db.rows("select count(*) filter (where matched_at is not null) as at, count(*) filter (where matched_guid = 'gs-' || substr(fincom_id, 2)::int::text) as g, count(*) filter (where matched_mid like 'm-gs-%%') as mid, count(*) filter (where matched_alter between 2001 and 2500) as alt, count(*) filter (where matched_vch like 'J-%%') as vch from tally_post_ids where job_id = " + q(js_)) or [{}])[0]
        ok(r.get("applied") == N and r.get("held") == 0 and r.get("duplicate") == 0 and r.get("failed") == 0, "4. 500 short lines: 500 applied, 0 held, 0 duplicate (%s)" % {k: r.get(k) for k in ("applied", "held", "duplicate", "failed")})
        ok(m == {"at": "500", "g": "500", "mid": "500", "alt": "500", "vch": "500"}, "4. 500 matched: matched_at, matched_guid, matched_mid, matched_alter, matched_vch on tally_post_ids (%s)" % m)
        ok(nv() == N and db.one("select count(*) from tally_vouchers where book_id = %s and origin = 'fincom' and fincom_id like 'S%%'" % q(BK["S"])) == "500", "4. 500 entries in the copy, origin fincom (%d)" % nv())
        tb0 = tb(); v0 = db.one("select count(*) from tally_voucher_versions where book_id = %s" % q(BK["S"]))
        r = apply("S", lines)
        ok(r.get("duplicate") == N and r.get("applied") == 0 and nv() == N, "4. the same 500 again: 500 duplicate, still 500 entries (%s)" % {k: r.get(k) for k in ("applied", "duplicate", "held")})
        r = apply("S", [dict(lines[0], line_id="pc2", pc="NWS145")])
        ok(st(r) == {"pc2": "duplicate"} and nv() == N, "4. the same line from a second PC: duplicate, one entry")
        # the day book of that day, by GUID, as Tally exports it (its own voucher numbers)
        dv = [{k: v for k, v in V("gs-%d" % i, 2001 + i, None, fids[i], no="J-%d" % (i + 1)).items() if k != "day"} for i in range(N)]
        dl = [l for i in range(N) for l in ([["gs-%d" % i, "Rent", -100, "", None, []], ["gs-%d" % i, "Supplier", 100, "", None, []]])]
        d = j("select tally_ingest_day(%s, '2026-08-14', %s, %s, %d, %d, 1000, null)::text" % (q(BK["S"]), js(dv), js(dl), N, 2000 + N))
        ok(d.get("ok") is True and d.get("marked") == 0 and nv() == N and db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(BK["S"])) == "500", "4. the day book upload of that day: still 500 entries, none marked (%s)" % {k: d.get(k) for k in ("ok", "marked", "sent", "_error")})
        ok(db.one("select count(*) from tally_voucher_versions where book_id = %s" % q(BK["S"])) == v0 == "500" and tb() == tb0 and tb0.get("Rent") == "-50000", "4. versions kept (500), the trial balance per ledger unchanged (%s)" % tb())
        # a full line of the same entry later: in place
        r = apply("S", [{"line_id": "full1", "event": "altered", "object_guid": "gs-1", "alter_id": 2600, "vch_date": "20260814", "vouchers": [V("gs-1", 2600, "2026-08-14", fids[1], no="J-2")],
                         "lines": [["gs-1", "Rent", -100, "", None, []], ["gs-1", "Supplier", 100, "", None, []]]}])
        ok(st(r) == {"full1": "applied"} and nv() == N and db.one("select alter_id from tally_vouchers where book_id = %s and guid = 'gs-1'" % q(BK["S"])) == "2600", "4. a full line of the same entry later: updated in place by GUID, still 500")
        # matches nothing; another firm's id; matched without a body; the same id from another GUID
        j("select 1")
        job("X", "X", ["THEIRS1"])
        r = apply("S", [short("u1", "gu-1", 3001, "NOSUCH"), short("u2", "gu-2", 3002, "THEIRS1")])
        res = {x["line_id"]: x for x in r.get("results") or []}
        ok(st(r) == {"u1": "held", "u2": "held"} and res["u1"]["why"] == "FinCom id NOSUCH matches no posting of this firm" and "THEIRS1 matches no posting of this firm" in res["u2"]["why"]
           and db.one("select count(*) from tally_vouchers where guid in ('gu-1', 'gu-2')") == "0", "4. a short line whose FinCom id matches nothing (or another firm's): held with words, never a new entry (%s)" % [res[k]["why"] for k in res])
        jb = job("S2", "S", ["T1", "T2"])
        r = apply("S", [short("t1", "gt-1", 3101, "T1", body=False)])
        ok(st(r) == {"t1": "held"} and "T1" in str((r.get("results") or [{}])[0].get("why")) and db.one("select matched_at is not null and matched_guid = 'gt-1' from tally_post_ids where fincom_id = 'T1'") == "t"
           and db.one("select count(*) from tally_vouchers where guid = 'gt-1'") == "0", "4. a matched short line without a body: stamped matched, held (%s)" % (r.get("results"),))
        r = apply("S", [short("t2", "gt-2", 3102, "T2"), short("t3", "gt-OTHER", 3103, "T2")])
        ok(st(r) == {"t2": "applied", "t3": "held"} and "gt-2" in str((r.get("results") or [{}, {}])[1].get("why")) and db.one("select count(*) from tally_vouchers where fincom_id = 'T2'") == "1",
           "4. the same FinCom id from another Tally GUID: held, never a second entry (%s)" % (r.get("results"),))
        job("S3", "S", ["U1"], accept=False)
        r = apply("S", [short("v1", "gv-1", 3201, "U1")])
        ok(st(r) == {"v1": "held"} and "matches no posting" in str((r.get("results") or [{}])[0].get("why")), "4. a posting not accepted by Tally: no match, held")
        ok(jn("select has_function_privilege('authenticated', 'tally_post_xml_for(uuid, uuid, text[])', 'execute')") == "f"
           and jn("select has_function_privilege('service_role', 'tally_post_xml_for(uuid, uuid, text[])', 'execute')") == "t", "4. tally_post_xml_for: the service role's")

    # ---------------------------------------------------------------- G. the database review's scenarios (docs/reviews/migration-45-review.md)
    if want("G"):
        print("== G. the review's scenarios: the gap check never under-counts; a changed FinCom entry is never rebuilt from the posting")
        import uuid as _u, time as _t
        def book(key):
            b = str(_u.uuid5(_u.NAMESPACE_DNS, "rv-" + key)); BK[key] = b; CO[key] = "RV " + key
            db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', %s, '2026-04-01', '2026-03-31')" % (q(b), q(F), q(CO[key])))
            return b
        def rjob(key, fids, accept=True, masters=0, accepted_at=None, status="done"):
            jid = str(_u.uuid5(_u.NAMESPACE_DNS, "rvjob-" + key + "-" + ",".join(fids[:2]) + str(len(fids)) + "-" + str(masters)))
            payload = {"vouchers": [{"id": f, "xml": vxml(f, i + 1)} for i, f in enumerate(fids)], "masters": [{"id": "m%d" % i, "xml": "<LEDGER/>"} for i in range(masters)]}
            res = [{"id": f, "ok": True, "created": 1, "kind": "voucher"} for f in fids] + [{"id": "m%d" % i, "ok": True, "created": 1, "kind": "master"} for i in range(masters)]
            db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, results, taken_at) values (%s, %s, 'c1', %s, %s, %s, %d, %s, %s, now())"
                   % (q(jid), q(F), q(CO[key]), q(D1), js(payload), len(fids) + masters, q(status), js(res)))
            if accept: db.sql("update tally_post_ids set accepted_at = %s where job_id = %s" % (accepted_at or "now()", q(jid)))
            return jid
        def person(key, lid, guid, alter, amt=10):
            v = {"guid": guid, "alter": alter, "type": "Journal", "no": "", "party": "X", "narr": "by hand", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": "", "day": "2026-08-14"}
            return apply(key, [{"line_id": lid, "event": "created", "object_guid": guid, "alter_id": alter, "vch_date": "20260814", "vouchers": [v], "lines": [[guid, "Rent", -amt, "", None, []], [guid, "Cash", amt, "", None, []]]}])
        gapat = lambda k, alt, at: j("select tally_recorder_gap_check(%s, %s, %s, %s)::text" % (q(BK[k]), q(D1), alt, at))
        words = lambda r: str((r.get("gap") or {}).get("words"))
        # H1: the fallback counts only postings accepted after the server's time of the last match / the newest arrival that raised the baseline
        book("G1"); gap("G1", 1000); rjob("G1", ["G1-%d" % i for i in range(100)])
        r = person("G1", "p1", "pg1", 1101)
        r = gap("G1", 1105)
        ok(r.get("missing") == 4 and r.get("gap") is not None and "up to 4 changes not received since" in words(r) and jn("select match_alter from tally_sync_cursor where book_id = %s" % q(BK["G1"])) in ("", None),
           "G1. 100 posted (no window) before a person's line received at 1101; beat 1105: up to 4, match_alter not set (%s)" % {k: r.get(k) for k in ("missing", "matched", "accounted")})
        r = gap("G1", 1106)
        ok(r.get("missing") == 5, "G1. and at 1106: up to 5 (%s)" % r.get("missing"))
        book("G2"); gap("G2", 1000); rjob("G2", ["G2-%d" % i for i in range(100)])
        r = gapat("G2", 1100, "now() - interval '2 minutes'")
        ok(r.get("matched") is True and jn("select match_at is not null and match_at > last_match_at from tally_sync_cursor where book_id = %s" % q(BK["G2"])) == "t",
           "G2. 100 posted, beat 1100 read by a PC 2 minutes behind: matched, match_at the server's time (%s)" % {k: r.get(k) for k in ("matched", "missing", "_error")})
        r = gap("G2", 1103)
        ok(r.get("missing") == 3, "G2. then 1103: up to 3, the 100 never subtracted a second time (%s)" % {k: r.get(k) for k in ("missing", "matched", "accounted")})
        book("G2b"); gap("G2b", 1000); db.sql("update tally_sync_cursor set start_at = now() - interval '10 seconds' where book_id = %s" % q(BK["G2b"]))
        rjob("G2b", ["G2b-%d" % i for i in range(50)], accepted_at="now() - interval '5 seconds'"); rjob("G2b", ["G2c-%d" % i for i in range(50)], accepted_at="now() - interval '0.5 second'")
        r = gapat("G2b", 1100, "now() - interval '1 second'")
        ok(r.get("matched") is True, "G2b. the beat read 1100 at T, the last batch accepted at T+0.5 s, the check at T+1 s: matched (%s)" % {k: r.get(k) for k in ("matched", "missing")})
        r = gap("G2b", 1103)
        ok(r.get("missing") == 3, "G2b. then 1103: up to 3, that batch not counted twice (%s)" % {k: r.get(k) for k in ("missing", "matched", "accounted")})
        # M1: a window credits at most Tally's current number, above the baseline, only what must be FinCom's, only for the book's company GUID
        book("G3"); gap("G3", 1000); cg("G3"); jw3 = rjob("G3", ["G3-%d" % i for i in range(100)])
        s3 = save(jw3, 1000, 1103, 100, 0)
        person("G3", "p3", "pg3", 1050)
        r = gap("G3", 1103)
        ok(s3.get("ok") is True and r.get("missing") == 3 and re.search(r"up to 3 changes not received during the posting of \d\d-\w{3}-\d{4} \d\d:\d\d", words(r)),
           "G3. window 1000..1103 (100 created, 3 by a person, one received at 1050), beat 1103: up to 3, 'during the posting' kept (%s; %s)" % (r.get("missing"), words(r)))
        book("G4"); gap("G4", 1000); cg("G4"); jw4 = rjob("G4", ["G4-%d" % i for i in range(100)])
        s4 = save(jw4, 5000, 5100, 100, 0)
        r = gap("G4", 1100)
        ok(s4.get("ok") is True and r.get("missing") == 100, "G4. a window 5000..5100 (above Tally's number: another company or a restore), 100 person changes, beat 1100: up to 100 (%s)" % {k: r.get(k) for k in ("missing", "matched", "accounted")})
        book("G4g"); gap("G4g", 1000); cg("G4g"); jw4g = rjob("G4g", ["G4g-%d" % i for i in range(100)])
        s4g = save(jw4g, 1000, 1100, 100, 0, guid="cg-OTHER")
        r = gap("G4g", 1100)
        ok(s4g.get("ok") is True and jn("select company_guid from tally_post_windows where job_id = %s" % q(jw4g)) == "cg-OTHER" and r.get("missing") == 100 and "cg-OTHER" in words(r),
           "G4g. a window of another company GUID (a same-named company): stored with its GUID, not counted, named (%s; %s)" % (r.get("missing"), words(r)[:160]))
        # M2: vouchers credited only; the ledgers named
        book("G5"); gap("G5", 1000); cg("G5"); jw5 = rjob("G5", [], masters=5)
        s5 = save(jw5, 1000, 1005, 0, 5)
        r = gap("G5", 1005)
        ok(s5.get("ok") is True and r.get("missing") == 5 and "of which up to 5 may be FinCom's own new ledgers" in words(r),
           "G5. a job creating 5 ledgers, window 1000..1005 (0 vouchers, 5 masters), beat 1005: up to 5, the ledgers named (%s; %s)" % (r.get("missing"), words(r)[:200]))
        # L1: a posted entry the copy held and then marked deleted is inside the baseline
        book("G6"); gap("G6", 1000); rjob("G6", ["G6-1"])
        db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, fincom_id, deleted_at) values (%s, %s, 'g6', '2026-08-14', 1001, 'G6-1', now())" % (q(BK["G6"]), q(F)))
        db.sql("update tally_sync_cursor set recorder_max_alter = 1002 where book_id = %s" % q(BK["G6"]))
        r = gap("G6", 1003)
        ok(r.get("missing") == 1, "G6. a posted entry read, deleted (1002 received), beat 1003: up to 1 (%s)" % {k: r.get(k) for k in ("missing", "matched", "accounted")})
        # M3: created counts bounded by the job's payload; a finished job's window kept as first saved; a cancelled job's refused
        book("G7"); gap("G7", 1000); cg("G7"); jw7 = rjob("G7", ["G7-%d" % i for i in range(100)])
        s7 = save(jw7, 1000, 5000, 1000000, 0); s7m = save(jw7, 1000, 5000, 100, 3)
        ok(s7.get("ok") is False and "more" in str(s7.get("error")) and s7m.get("ok") is False and jn("select count(*) from tally_post_windows where job_id = %s" % q(jw7)) == "0",
           "G7. 1,000,000 vouchers (or 3 masters) created for a 100-entry job: refused, nothing stored (%s; %s)" % (s7.get("error"), s7m.get("error")))
        r = gap("G7", 5000)
        ok(r.get("missing") == 3900, "G7. beat 5000: up to 3,900 (%s)" % r.get("missing"))
        s7a = save(jw7, 1000, 5000, 100, 0); s7b = save(jw7, 5000, 9000, 100, 0); s7c = save(jw7, 1000, 5000, 100, 0)
        ok(s7a.get("ok") is True and s7b.get("ok") is False and s7c.get("ok") is True and jn("select a0 || '..' || a1 from tally_post_windows where job_id = %s" % q(jw7)) == "1000..5000",
           "G7. the finished job's window: first save kept; other numbers refused; the same numbers again ok (%s)" % s7b.get("error"))
        jw7x = rjob("G7", ["G7x-1"], status="cancelled")
        s7x = save(jw7x, 6000, 6001, 1, 0)
        ok(s7x.get("ok") is False and jn("select count(*) from tally_post_windows where job_id = %s" % q(jw7x)) == "0", "G7. a cancelled job's window: refused (%s)" % s7x.get("error"))
        # H2: a short 'altered' line (or one for an entry the copy holds at another AlterID) is never rebuilt from the posting
        book("G10"); gap("G10", 2000); rjob("G10", ["A1"])
        r = apply("G10", [short("a1", "ga1", 2001, "A1")])
        r2 = apply("G10", [short("a2", "ga1", 2002, "A1", **{"event": "altered"})])
        res2 = (r2.get("results") or [{}])[0]
        cp = (db.rows("select alter_id from tally_vouchers where book_id = %s and guid = 'ga1'" % q(BK["G10"])) or [{}])[0]
        ok(st(r) == {"a1": "applied"} and res2.get("state") == "held" and "changed in Tally after posting" in str(res2.get("why")) and cp.get("alter_id") == "2001"
           and db.one("select count(*) from tally_voucher_versions where book_id = %s and alter_id = 2002" % q(BK["G10"])) == "0",
           "G10. a short 'altered' line of a matched FinCom entry: held 'changed in Tally after posting', the copy stays at 2001, no version 2002 (%s)" % res2)
        r3 = apply("G10", [short("a3", "ga1", 2003, "A1")])
        res3 = (r3.get("results") or [{}])[0]
        ok(res3.get("state") == "held" and "changed in Tally after posting" in str(res3.get("why")) and db.one("select alter_id from tally_vouchers where book_id = %s and guid = 'ga1'" % q(BK["G10"])) == "2001",
           "G10. a short 'created' line for an entry the copy holds at an older AlterID: held the same way (%s)" % res3)
        r = gap("G10", 2003)
        ok(r.get("missing") == 2, "G10. the held changes show in the gap check: beat 2003, up to 2 (%s)" % r.get("missing"))
        # G12: another book's posting (same firm): held, no XML
        book("G12a"); book("G12b"); rjob("G12b", ["C1"])
        r = apply("G12a", [short("x1", "gx1", 4001, "C1")])
        x = j("select tally_post_xml_for(%s, %s, '{C1}')::text" % (q(F), q(BK["G12a"])))
        ok(st(r) == {"x1": "held"} and "matches no posting of this firm" in str((r.get("results") or [{}])[0].get("why")) and not (x.get("posts") or []),
           "G12. the FinCom id of another book's posting: held, no XML (%s)" % x)
        # L4: a full line stamps only the live posting of this book's company
        book("L4"); book("L4o")
        jl4o = rjob("L4o", ["L4X"], status="failed", accept=False)
        jl4 = rjob("L4", ["L4X"], accept=False)
        r = apply("L4", [{"line_id": "f1", "event": "created", "object_guid": "gl4", "alter_id": 7001, "vch_date": "20260814", "vouchers": [V("gl4", 7001, "2026-08-14", "L4X")],
                          "lines": [["gl4", "Rent", -100, "", None, []], ["gl4", "Supplier", 100, "", None, []]]}])
        stamped = {x["job_id"]: x["g"] for x in db.rows("select job_id, coalesce(matched_guid, '-') as g from tally_post_ids where fincom_id = 'L4X'")}
        ok(st(r) == {"f1": "applied"} and stamped == {jl4: "gl4", jl4o: "-"},
           "L4. a full line with FinCom id L4X: the live posting of this book stamped, an old failed one of another company not (%s)" % stamped)
        # L10: below the last match's number (read after that match) is a restore: needs_baseline, never matched
        book("L10"); gap("L10", 1000); rjob("L10", ["L10-%d" % i for i in range(100)])
        r = gap("L10", 1100)
        r2 = gapat("L10", 1050, "now() - interval '1 hour'")
        c2 = cur("L10")
        r3 = gap("L10", 1050)
        ok(r.get("matched") is True and r2.get("matched") is not True and r2.get("needsBaseline") is not True and c2.get("state") != "needs_baseline"
           and r3.get("needsBaseline") is True and r3.get("matched") is not True and cur("L10").get("state") == "needs_baseline",
           "L10. matched at 1100; an older reading of 1050 (beats crossing): neither; a newer reading of 1050: needs_baseline (%s; %s)" % ({k: r2.get(k) for k in ("matched", "behind", "needsBaseline")}, {k: r3.get(k) for k in ("matched", "needsBaseline", "why")}))
        # M6: a short line held before its posting's acceptance is retried when the acceptance arrives
        book("M6"); jm6 = rjob("M6", ["Q1"], accept=False)
        r = apply("M6", [short("q1", "gq-1", 5001, "Q1", body=False)])
        held_ok = st(r) == {"q1": "held"} and "matches no posting of this firm" in str((r.get("results") or [{}])[0].get("why"))
        db.sql("update tally_post_ids set accepted_at = now() where job_id = %s" % q(jm6))
        h = j("select tally_recorder_short_held(%s, %s)::text" % (q(F), q(jm6)))
        hl = h.get("lines") or []
        ok(held_ok and len(hl) == 1 and hl[0].get("book") == BK["M6"] and (hl[0].get("line") or {}).get("fid") == "Q1" and (hl[0].get("line") or {}).get("object_guid") == "gq-1",
           "M6. a short line held 'matches no posting' before the acceptance; after it, tally_recorder_short_held finds it (%s)" % (h if not hl else hl[0].get("line", {}).get("fid")))
        if hl:
            ln = dict(hl[0]["line"], row=hl[0]["row"], vouchers=[V("gq-1", 5001, "2026-08-14", "Q1")], lines=[["gq-1", "Rent", -100, "", None, []], ["gq-1", "Supplier", 100, "", None, []]])
            r = j("select tally_recorder_short_retry(%s, %s, %s)::text" % (q(F), q(BK["M6"]), js([ln])))
            ok(st(r) == {"q1": "applied"} and db.one("select count(*) from tally_vouchers where book_id = %s and guid = 'gq-1' and fincom_id = 'Q1'" % q(BK["M6"])) == "1"
               and db.one("select state || ':' || count(*) over () from tally_recorder_lines where book_id = %s and line_id = 'q1'" % q(BK["M6"])) == "applied:1"
               and db.one("select matched_guid from tally_post_ids where job_id = %s" % q(jm6)) == "gq-1" and cur("M6").get("recorder_max_alter") == "5001",
               "M6. tally_recorder_short_retry with the body from the posting: the same row applied, one entry, the posting matched, its AlterID received (%s)" % r)
            r = j("select tally_recorder_short_retry(%s, %s, %s)::text" % (q(F), q(BK["M6"]), js([ln])))
            ok(st(r) == {"q1": "skipped"} and db.one("select count(*) from tally_vouchers where guid = 'gq-1'") == "1" and not (j("select tally_recorder_short_held(%s, %s)::text" % (q(F), q(jm6))).get("lines") or []),
               "M6. again: skipped (no longer held), nothing to retry (%s)" % r)
        ok(jn("select has_function_privilege('authenticated', 'tally_recorder_short_retry(uuid, uuid, jsonb)', 'execute')") == "f" and jn("select has_function_privilege('service_role', 'tally_recorder_short_retry(uuid, uuid, jsonb)', 'execute')") == "t"
           and jn("select has_function_privilege('authenticated', 'tally_recorder_short_held(uuid, uuid)', 'execute')") == "f" and jn("select has_function_privilege('service_role', 'tally_recorder_short_held(uuid, uuid)', 'execute')") == "t",
           "M6. tally_recorder_short_held / tally_recorder_short_retry: the service role's")
        # M4: the spelling-rule match through indexes: 200,000 ids, 500 unknown ids
        PB = book("PERF")
        db.sql("""alter table tally_post_ids disable trigger user;
insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, results, taken_at, created_at)
  select md5('pj' || g)::uuid, %(F)s, 'c1', case when g %% 4 = 0 then %(C)s else 'OTHER ' || (g %% 7) end, %(D)s, '{"vouchers": []}'::jsonb, 25, 'done', '[]'::jsonb, now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval
    from generate_series(1, 8000) g;
insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live, accepted_at)
  select %(F)s, 'c1', 'P' || g || '-' || k, md5('pj' || g)::uuid, 'e' || g || '-' || k, true, now() - (g || ' minutes')::interval from generate_series(1, 8000) g, generate_series(1, 25) k;
alter table tally_post_ids enable trigger user;
analyze tally_post_ids; analyze tally_post_jobs;""" % {"F": q(F), "D": q(D1), "C": q(CO["PERF"])})
        t0 = _t.time(); n = jn("set statement_timeout = '20s'; select jsonb_array_length(tally_post_xml_for(%s, %s, array(select 'NOSUCH-' || g from generate_series(1, 500) g))->'posts')" % (q(F), q(PB))); t1 = _t.time() - t0
        # the time bound is generous (CI runners are slower: 4.1 s there against 0.3 s here; without the indexes it was 167 s); what
        # proves the indexes is the plan of each spelling's lookup below (CI, 04-Oct)
        ok(n == "0" and t1 < 15, "M4. tally_post_xml_for with 500 unknown ids over %s ids: %.2f s (under 15 s; 167 s without the indexes) (%s)" % (db.one("select count(*) from tally_post_ids"), t1, str(n)[:120]))
        plans = {k: jn("explain select 1 from tally_post_ids p where p.firm_id = %s and p.live and %s" % (q(F), w)) for k, w in (
            ("entry", "p.entry_id = 'NOSUCH-1'"),
            ("fid_an", "regexp_replace(p.fincom_id, '[^A-Za-z0-9]', '', 'g') = 'NOSUCH1'"),
            ("entry_an", "regexp_replace(coalesce(p.entry_id, ''), '[^A-Za-z0-9]', '', 'g') = 'NOSUCH1'"))}
        ok(all("Index" in v and "Seq Scan on tally_post_ids" not in v for v in plans.values()),
           "M4. each spelling's lookup over 200,000 ids goes through an index, never a scan of the table (%s)" % {k: v.split("\n")[0][:90] for k, v in plans.items()})
        t0 = _t.time(); n = jn("set statement_timeout = '20s'; select (tally_recorder_apply(%s, %s, %s, %s)->>'held')" % (q(F), q(PB), q(D1), js([short("pf%d" % i, "gpf-%d" % i, 9001 + i, "NOSUCH.%d" % i, body=False) for i in range(500)]))); t1 = _t.time() - t0
        ok(n == "500" and t1 < 15, "M4. tally_recorder_apply with 500 unmatched short lines: %.2f s (under 15 s), 500 held (%s)" % (t1, str(n)[:120]))
        live = lambda fid: jn("select coalesce(string_agg(post_fid, ','), '-') from tally_post_live_for(%s, %s, %s)" % (q(F), q(PB), q(fid)))
        sp = {f: live(f) for f in ("P8-3", "P8_3", "e8.3", "e8-3", "P83", "P8-4", "NOSUCH", "P9-3", "--")}
        ok(sp == {"P8-3": "P8-3", "P8_3": "P8-3", "e8.3": "P8-3", "e8-3": "P8-3", "P83": "P8-3", "P8-4": "P8-4", "NOSUCH": "-", "P9-3": "-", "--": "-"},
           "M4. the spelling rule of 36b kept (exact, entry id, letters and digits of either; another company's id not this book's) (%s)" % sp)
        ok(jn("select count(*) from pg_indexes where tablename = 'tally_post_ids' and indexname in ('tally_post_ids_entry', 'tally_post_ids_fid_an', 'tally_post_ids_entry_an')") == "3", "M4. the three indexes on tally_post_ids")
    if not ONLY:
        # ---------------------------------------------------------------- R. the realtime publication
        ok(db.one("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tally_recorder_lines'") == "1", "R. tally_recorder_lines is in supabase_realtime, once (45 ran twice)")
        # ---------------------------------------------------------------- D. nothing is deleted: the foreign keys to tally_books restrict
        if not SKIP45:
            ok(fkdefs[0] == fkdefs[1] and len(fkdefs[0]) >= 5 and all("ON DELETE RESTRICT" in x["d"] for x in fkdefs[0]),
               "D. the foreign keys of tally_recorder_lines, tally_month_locks, tally_tieouts, tally_post_windows to tally_books / tally_post_jobs: ON DELETE RESTRICT, identical after two runs (%s)" % [(x["t"], x["d"]) for x in fkdefs[-1]])
        DB_ = {"lines": "e1000000-1111-1111-1111-111111111111", "lock": "e2000000-1111-1111-1111-111111111111", "tie": "e3000000-1111-1111-1111-111111111111"}
        for k, b in DB_.items():
            db.sql("insert into tally_books (book_id, firm_id, client_id, company) values (%s, %s, 'c-%s', 'ZZ DEL %s')" % (q(b), q(F), k, k))
        db.sql("insert into tally_recorder_lines (firm_id, book_id, event) values (%s, %s, 'created')" % (q(F), q(DB_["lines"])))
        db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month) values (%s, 'c-lock', %s, '2026-06-01')" % (q(F), q(DB_["lock"])))
        db.sql("insert into tally_tieouts (firm_id, client_id, book_id, month) values (%s, 'c-tie', %s, '2026-06-01')" % (q(F), q(DB_["tie"])))
        for k, b in DB_.items():
            try: db.sql("delete from tally_books where book_id = %s" % q(b)); gone = True
            except RuntimeError as e: gone = False; err = str(e)
            ok(not gone and db.one("select count(*) from tally_books where book_id = %s" % q(b)) == "1", "D. a book with a %s cannot be deleted (refused: %s)" % ({"lines": "recorder line", "lock": "month lock", "tie": "tie-out"}[k], "" if gone else err.strip().splitlines()[0][:90]))
        try: db.sql("delete from tally_post_jobs where id = %s" % q(JOB("W"))); gone = True
        except RuntimeError: gone = False
        ok(not gone, "D. a posting with a window cannot be deleted")
        # ---------------------------------------------------------------- S. security
        ok(db.one("select relrowsecurity from pg_class where relname = 'tally_post_windows'") == "t", "S. tally_post_windows: row level security on")
        g1, o1 = as_user(OWNER, "select count(*) from tally_post_windows"); g2, o2 = as_user(OTHER, "select count(*) from tally_post_windows")
        ok(g1 and g2 and int(o1) > 0 and o2 == "0", "S. tally_post_windows: the firm reads its rows (%s), another firm none (%s)" % (o1, o2))
        g3, o3 = as_user(OWNER, "update tally_post_windows set a1 = a1"); g4, o4 = as_user(OWNER, "insert into tally_post_windows (firm_id, book_id, job_id, a0, a1) values (%s, %s, %s, 1, 2)" % (q(F), q(BK["W"]), q(JOB("FB"))))
        ok(not g3 and not g4, "S. tally_post_windows: nobody writes it directly")
        fns = sorted(set(re.findall(r"function\s+public\.(\w+)\s*\(", body)))
        rows = db.rows("select proname, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where pronamespace = 'public'::regnamespace and proname = any(array[%s])" % ",".join(q(n) for n in fns)) if fns else []
        ok(len(fns) >= 5 and all(x["prosecdef"] == "t" and x["conf"].replace(" ", "") == "search_path=public,pg_temp" for x in rows), "S. every function of 45 (%s): security definer, search_path public, pg_temp" % fns)
        for fn, args in [("tally_post_live_for", "uuid, uuid, text"), ("tally_recorder_line", "uuid, uuid, jsonb, bigint")]:
            ok(all(jn("select has_function_privilege('%s', '%s(%s)', 'execute')" % (who, fn, args)) == "f" for who in ("anon", "authenticated", "service_role")), "S. %s: internal, granted to nobody" % fn)
        ok(jn("select has_function_privilege('authenticated', 'tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)', 'execute')") == "f" and jn("select has_function_privilege('service_role', 'tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)', 'execute')") == "t", "S. tally_recorder_gap_check: the service role's")
        ok(db.one("select count(*) from information_schema.columns where (table_name, column_name) in (('tally_post_ids', 'matched_guid'), ('tally_post_ids', 'matched_mid'), ('tally_post_ids', 'matched_alter'))") == "3", "S. tally_post_ids: matched_guid, matched_mid, matched_alter")
        if not SKIP45:
            # L2: a session holding a table 45 alters makes 45 give up after lock_timeout (all rolled back), never queue for ever
            import time as _t2
            hold = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-q", "-c",
                                     "begin; lock table public.tally_sync_cursor in access share mode; select pg_sleep(30); commit;"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _t2.sleep(1.5); t0 = _t2.time(); r = psql_file(M45); t1 = _t2.time() - t0
            hold.kill(); hold.wait(); db.sql("select pg_terminate_backend(pid) from pg_stat_activity where query like '%%pg_sleep(30)%%' and pid <> pg_backend_pid()")
            ok(r.returncode != 0 and "lock timeout" in (r.stderr or "") and t1 < 20, "L2. 45 while another session holds tally_sync_cursor: gives up after the lock timeout (%.1f s), nothing half-done (%s)" % (t1, (r.stderr or "").strip()[-120:]))
            # L6: under Supabase's default privileges (all to anon and authenticated), 45 leaves the members a read alone
            db.sql("grant all on public.tally_post_windows to anon, authenticated; grant all on sequence public.tally_post_windows_id_seq to anon, authenticated;")
            k = counts(); r = psql_file(M45)
            ok(r.returncode == 0 and counts() == k and db.one("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tally_recorder_lines'") == "1", "migration-45 runs a third time over used tables")
            pv = {x["grantee"]: x["p"] for x in db.rows("select grantee, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'tally_post_windows' and grantee in ('anon', 'authenticated') group by 1")}
            sq = jn("select has_sequence_privilege('anon', 'public.tally_post_windows_id_seq', 'usage') or has_sequence_privilege('authenticated', 'public.tally_post_windows_id_seq', 'usage')")
            ok(pv == {"authenticated": "SELECT"} and sq == "f", "L6. tally_post_windows under Supabase's defaults: authenticated SELECT only (no REFERENCES / TRIGGER), anon nothing, the sequence closed (%s, %s)" % (pv, sq))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
