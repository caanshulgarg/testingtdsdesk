"""python3 run_recorder_server.py - (04-Oct-2026, phase 2: the Tally change recorder, migration 44) tally-ingest's kinds
"recorder_lines", "start_point" and the beat's per-company change numbers, through the real cloud function
(server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py), whose recorder functions
(tally_recorder_apply, tally_start_point, tally_recorder_gap_check) are answered by a throwaway PostgreSQL (pg_stand) built
in staging's order 32 -> ... -> 43 -> 44: what the database keeps is checked there.
Checks: an unlinked company is refused (409); created (the add-on's XML read with parse.js) -> an entry in tally_vouchers,
origin tally; altered -> the old version kept; deleted -> deleted_at; cancelled -> cancelled, not deleted; the same line
twice -> duplicate; a FinCom posting coming back (TDSDesk:<id>) -> matched by its FinCom id, origin fincom, one row from two
computers; a ledger rename line -> tally_ledger_rename (renamed_at, the lines follow); a locked month -> held; an unknown event
-> failed, not stored; a line with no GUID -> held, never a new row; the starting point kept once; the gap: PC A's lines reach 50
(start 40), PC B's beat says 53 with recorderSeen false -> gap {missing 3 (up to: an upper bound), since the last match}, B's recorder state kept in
info.bridges; A's lines up to 53 -> the next beat clears it; a number below the starting point -> needs_baseline, never a gap.
Migration 45 (docs/recorder-bulk-posting.md 3 and 4): posts_update carrying window {a0, a1, vouchersCreated, mastersCreated}
on the job's last update -> tally_post_window_save (a bad window: not stored, a log line, the update still answered); start
1000, a job of 100 accepted, window 1000..1100, no recorder line, the beat says 1100 -> no gap. A job of 500 accepted bills with
payload XML, 500 SHORT lines (company_guid, object_guid, master_id, alter_id, fid, event, saved_at) -> tally-ingest fetches the
posted XML (tally_post_xml_for), reads it with parse.js with the line's GUID and AlterID -> 500 applied, 500 matched, 500 entries
with their lines, 0 held; again -> 500 duplicate; the day book of that day (kind days) -> still 500, versions kept, the trial
balance unchanged; a short line whose FinCom id (here in its narration) matches nothing -> held.
The review of 45 (docs/reviews/migration-45-review.md): M1 the window's company GUID (window.guid) kept; H2 a short 'altered'
line never built from the posting (no XML fetched), held, the copy unchanged; L8 a cancelled job's or a late update's window
never saved; M6 a short line held before its posting's acceptance is applied once by posts_update's acceptance.
Round 19 (the beat's two shapes): a 2.1.9 beat (startPoint / changeNumbers top-level only, companies []) records the starting
point with its GUID (tally_start_point once, not every beat) and the banner's recorderSeen; the next beat 2 higher with no
recorder line -> 'up to 2 changes not received since <the bridge's IST time>'; FinCom's posting with a window still subtracted;
a 2.1.10 beat (companies[] with guid / altvchid, read first) the same; a failed gap check logged with the company and the
error; the bridge's own beat (tests/fixtures/beat-2.1.10.json, when bridge-go has written it) records a starting point per
open company with a GUID.
Review 46 (docs/reviews/migration-46-review.md, Fixed; 46 now in the order): H1 two PCs with a same-named company of
different GUIDs, beats alternating: the starting point never moves, needs_baseline, the other company answered otherCompany
with no gap check (logged once), no false gap on the real company; a start without a GUID then a GUID: stamped, not moved, the
gap kept. M1 tally_book_for once per company in the window over 10 beats. M2 a check time ahead of now taken as now (a restore
then flagged). L2 the check's time from changeNumbers.at only. L3 only the bridge's exact zone-less form read as IST.
Round 20 (migration 47; docs/cloud-recorder-plan.md 1): more than 50 full lines in one request (bodies read with parse.js; short
lines' bodies built as before) go on the queue as one message (tally_recorder_enqueue) and are answered {queued: n} at once;
50 or fewer, or short lines only, are applied directly as before; the drain (tally_recorder_drain) applies the message in
order; a cloud without 47 applies them directly. The beat answers recorderSource (tally_devices.recorder_source; left out
without the column or for another value). The bridge's own recorder_lines body (tests/fixtures/recorder-lines-2.2.0.json, when
bridge-go has written it) is fed through.
Migration 51 (FinCom Bridge 2.2.2; the order now 32 -> ... -> 47 -> 48 -> 49 -> 50 -> 51): a created line with no XML, idsMismatch
true, lineGuid <company GUID>-00006346 (an entry the copy holds) and heldWhy -> held, never duplicate, held_why = heldWhy, the
payload keeping idsMismatch / lineGuid / heldWhy; a heldWhy over 300 characters cut to 300; idsMismatch "yes" (not true) not
kept; a normal line unchanged (no new keys). 50's words for a line with no GUID: "waiting for the entry's details ...".
FinCom Bridge 2.2.2: the beat answers heldLines (this computer's held lines of the last 7 days, created / altered / imported,
the company still linked to the book, the month not locked, oldest first, at most 200: line_id, company, company_guid, event,
master_id, vch_type, vch_no, vch_date) and leaves the field out when there are none; from 06-Oct-2026 this bridge's only.
06-Oct-2026 (NWS144 lines 4, 17, 18): a real TallyPrime 7.1's typed voucher XML is read (applied with its body); the beat answers
refetch, at most 20 of this bridge's own held lines (same key AND bridge id) without a body or with a placeholder GUID, never
another user's bridge or computer; "<line id>:resolved" with Tally's typed body is applied once and the held line 'replaced'.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand, csv
csv.field_size_limit(1 << 30)     # the posted XML of 500 entries is one field (tally_post_xml_for)
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql",
                                           "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql",
                                           "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, BOOK, OWNER = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", "55555555-5555-5555-5555-555555555555"
DA, DB_ = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002"
KA, KB = "fcd_" + "a" * 48, "fcd_" + "b" * 48
GA = {"id": "go-aaaaaa111111", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.2.0"}
GB = {"id": "go-bbbbbb222222", "computer": "PC-B", "user": "ravi", "mode": "main", "runMode": "user", "version": "2.2.0"}
db = pg_stand.start(55452)
fn = None
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))      # pgmq, pg_cron, Storage and tally_jobs as migration 47 needs them
    db.sql("""insert into firms values (%(F)s, 'Firm'); insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(A)s, %(F)s, 'PC-A', 'ha', '2.2.0'), (%(D)s, %(F)s, 'PC-B', 'hb', '2.2.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(FIRM), "O": q(OWNER), "B": q(BOOK), "A": q(DA), "D": q(DB_)})
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.one("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s::jsonb, %s::jsonb)::text" % (q(BOOK), q(json.dumps([["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"], ["Capital", "Capital Account", "1000"]])),
                                                                                                   q(json.dumps([["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]))))
    db.sql("update tally_ledgers set tally_guid = 'g-' || lower(name) where book_id = %s" % q(BOOK))
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values ('00000001-0000-0000-0000-000000000000', %s, 'c1', 'ZZ CO', %s, 1, 'done')"
           % (q(FIRM), q(json.dumps({"vouchers": [{"id": "P1", "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:P1</NARRATION></VOUCHER>"}]}))))
    # the stand-in answers the recorder's functions from the database
    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, list) and name_is_array[0]: return "array[%s]::text[]" % ",".join(q(x) for x in v) if v else "'{}'::text[]"
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    name_is_array = [False]
    def rpc(name, a):
        if name in ("tally_recorder_apply", "tally_start_point", "tally_recorder_gap_check", "tally_post_window_save", "tally_post_xml_for", "tally_post_id_accept_reply", "tally_post_id_accept", "tally_recorder_short_held", "tally_recorder_short_retry", "tally_recorder_enqueue", "tally_recorder_send"):
            FS.ARGS.setdefault(name, []).append(a)
            name_is_array[0] = name == "tally_post_xml_for"
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))))
            except RuntimeError as e: raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": "c1", "book_id": BOOK})
    for did, key, name in ((DA, KA, "PC-A"), (DB_, KB, "PC-B")):
        FS.T["tally_devices"].append({"id": did, "firm_id": FIRM, "name": name, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.2.0"})
    FS.start()
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body, key=KA):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    def xml(guid, alter, date, amt, narr="Sale", ledger="Sales", cancel=False):
        return ('<VOUCHER REMOTEID="%s" VCHTYPE="Sales" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-%s</VOUCHERNUMBER>'
                '<NARRATION>%s</NARRATION><ISCANCELLED>%s</ISCANCELLED><ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST>'
                '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') % (guid, date, guid, alter, guid, narr, "Yes" if cancel else "No", ledger, amt, -amt)
    def line(lid, event, guid, alter, date="20260510", amt=None, **kw):
        x = {"line_id": lid, "event": event, "saved_at": "2026-10-04T10:00:00+05:30", "pc": "PC-A", "user": "anshul", "company_guid": "cg-1", "object_guid": guid, "master_id": "9",
             "alter_id": alter, "vch_type": "Sales", "vch_no": "S-" + str(guid), "vch_date": date, "ledgers": [{"name": "Sales", "guid": "g-sales"}], "save_ms": 8}
        if amt is not None: x["xml"] = xml(guid, alter, date, amt, **{k: v for k, v in kw.items() if k in ("narr", "ledger", "cancel")})
        x.update({k: v for k, v in kw.items() if k not in ("narr", "ledger", "cancel")}); return x
    rec = lambda lines, key=KA, bridge=GA: call({"kind": "recorder_lines", "company": "ZZ CO", "version": "2.2.0", "bridge": bridge, "lines": lines}, key)
    st = lambda r: {x.get("line_id"): x.get("state") for x in (r.get("results") or [])}
    vrow_b = lambda b, g: (db.rows("select day, alter_id, deleted_at, cancelled, origin, fincom_id from tally_vouchers where book_id = %s and guid = %s" % (q(b), q(g))) or [{}])[0]
    vrow = lambda g: (db.rows("select day, alter_id, deleted_at, cancelled, origin, fincom_id from tally_vouchers where book_id = %s and guid = %s" % (q(BOOK), q(g))) or [{}])[0]
    # ---- refused for an unlinked company
    c, r = call({"kind": "recorder_lines", "company": "NOT LINKED", "lines": [line("x", "created", "g0", 1)]})
    ok(c == 409 and r.get("notLinked") is True, "an unlinked company: recorder_lines refused (409)")
    c, r = call({"kind": "start_point", "company": "NOT LINKED", "altvchid": 1})
    ok(c == 409 and r.get("notLinked") is True, "an unlinked company: start_point refused (409)")
    # ---- the starting point
    c, r = call({"kind": "start_point", "company": "ZZ CO", "guid": "cg-1", "altvchid": 40, "altmstid": 9, "at": "2026-10-04T09:00:00+05:30", "bridge": GA})
    ok(c == 200 and r.get("set") is True and r.get("startVoucher") == 40, "start_point: kept (%s)" % r)
    c, r = call({"kind": "start_point", "company": "ZZ CO", "guid": "cg-1", "altvchid": 45, "altmstid": 9, "bridge": GA})
    ok(c == 200 and r.get("set") is False and r.get("startVoucher") == 40, "start_point: once per book (%s)" % r.get("startVoucher"))
    # ---- created, altered, deleted, cancelled, duplicate
    c, r = rec([line("L1", "created", "v1", 41, amt=100)])
    v = vrow("v1")
    ok(c == 200 and r.get("ok") is True and st(r) == {"L1": "applied"} and v.get("origin") == "tally" and v.get("day") == "2026-05-10" and v.get("alter_id") == "41", "created: the entry in tally_vouchers, origin tally (%s %s)" % (c, r))
    ok(db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and day = '2026-05-10' and ledger = 'Sales'" % q(BOOK)) == "100", "created: the ledger-day cache from the XML's lines (parse.js)")
    lrow = (db.rows("select pc, tally_user, bridge, save_ms, payload::text as payload, vch_date from tally_recorder_lines where line_id = 'L1'") or [{}])[0]
    ok(lrow.get("pc") == "PC-A" and lrow.get("bridge") == GA["id"] and lrow.get("save_ms") == "8" and "xmlBytes" in lrow.get("payload", "") and "<VOUCHER" not in lrow.get("payload", "") and lrow.get("vch_date") == "2026-05-10",
       "the line kept with pc, bridge, save_ms; the payload bounded (the XML's size, not the XML) (%s)" % {k: lrow.get(k) for k in ("pc", "save_ms")})
    c, r = rec([line("L2", "altered", "v1", 42, amt=120)])
    ok(st(r) == {"L2": "applied"} and vrow("v1").get("alter_id") == "42" and db.one("select count(*) from tally_voucher_versions where tally_guid = 'v1'") == "2" and db.one("select lines::text from tally_voucher_versions where tally_guid = 'v1' and alter_id = 41").count("100") == 2,
       "altered: the version of AlterID 41 kept with its lines, a version for 42 (%s)" % st(r))
    c, r = rec([line("L2", "altered", "v1", 42, amt=120)])
    ok(st(r) == {"L2": "duplicate"} and db.one("select count(*) from tally_voucher_versions where tally_guid = 'v1'") == "2", "the same line twice: duplicate")
    c, r = rec([line("L3", "created", "v2", 43, amt=30), line("L4", "deleted", "v1", 44)])
    ok(st(r) == {"L3": "applied", "L4": "applied"} and vrow("v1").get("deleted_at") and not vrow("v2").get("deleted_at"), "deleted: deleted_at set (%s)" % st(r))
    c, r = rec([line("L5", "cancelled", "v2", 45)])
    v = vrow("v2")
    ok(st(r) == {"L5": "applied"} and v.get("cancelled") == "t" and not v.get("deleted_at"), "cancelled: cancelled true, NOT deleted (%s)" % v)
    # ---- a FinCom posting coming back
    c, r = rec([line("L6", "created", "tg1", 46, amt=50, narr="Bill 7 | TDSDesk:P1")])
    v = vrow("tg1")
    ok(st(r) == {"L6": "applied"} and v.get("fincom_id") == "P1" and v.get("origin") == "fincom" and db.one("select matched_at is not null from tally_post_ids where fincom_id = 'P1'") == "t", "a FinCom posting coming back: matched by its FinCom id, origin fincom (%s)" % v)
    c, r = rec([dict(line("L6", "created", "tg1", 46, amt=50, narr="Bill 7 | TDSDesk:P1"), pc="PC-B")], KB, GB)
    ok(st(r) == {"L6": "duplicate"} and db.one("select count(*) from tally_vouchers where fincom_id = 'P1'") == "1", "the same posting from PC B: not duplicated (one row)")
    # ---- a ledger rename
    c, r = rec([line("L7", "created", "v3", 47, amt=7, ledger="Rent"), line("L8", "ledger_renamed", "g-rent", 3, **{"from": "Rent", "to": "Rent Paid", "vch_date": None})])
    ok(st(r) == {"L7": "applied", "L8": "applied"} and db.one("select renamed_at is not null from tally_ledgers where book_id = %s and name = 'Rent Paid'" % q(BOOK)) == "t" and db.one("select count(*) from tally_lines where ledger = 'Rent Paid'") == "1",
       "a ledger rename line: tally_ledger_rename (renamed_at, the lines follow) (%s)" % (r.get("results"),))
    # ---- a locked month, an unknown event, no GUID
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month, locked_by) values (%s, 'c1', %s, '2026-06-01', %s)" % (q(FIRM), q(BOOK), q(OWNER)))
    c, r = rec([line("L9", "created", "v4", 48, "20260610", amt=9), line("L10", "exploded", "v5", 49), line("L11", "created", "", 49, amt=1)])
    res = {x["line_id"]: x for x in r.get("results") or []}
    ok(st(r) == {"L9": "held", "L10": "failed", "L11": "held"} and "month locked" in str(res.get("L9", {}).get("why")) and vrow("v4") == {} and "waiting for the entry's details from FinCom Bridge" in str(res.get("L11", {}).get("why")) and db.one("select count(*) from tally_vouchers where guid = ''") == "0",
       "a locked month: held; an unknown event: failed; no GUID: held (50's words: waiting for the entry's details), never a new row (%s)" % st(r))
    ok(db.one("select count(*) from tally_recorder_lines where line_id = 'L10'") == "0" and r.get("applied") == 0 and r.get("held") == 2 and r.get("failed") == 1, "the unknown event is not stored; the counts answered")
    # ---- the gap: PC A's lines reach 50 (start 40); PC B says 53 without the add-on
    c, r = rec([line("L12", "created", "v6", 50, amt=5)])
    beat = lambda key, bridge, alt, seen, at: call({"kind": "beat", "version": "2.2.0", "bridge": bridge, "tally": True, "open": ["ZZ CO"],
                                                    "companies": [{"name": "ZZ CO", "open": True, "altvchid": alt, "altmstid": 9, "at": at, "recorderSeen": seen, "recorderLastAt": "2026-10-04T10:00:00+05:30" if seen else ""}],
                                                    "changeNumbers": {"ZZ CO": {"altvchid": alt, "at": at}}}, key)     # review 46 L2: the check's time from changeNumbers.at only
    cur = lambda: (db.rows("select gap::text as gap, last_match_at, state, recorder_max_alter from tally_sync_cursor where book_id = %s" % q(BOOK)) or [{}])[0]
    c, r = beat(KA, GA, 50, True, "2026-10-04T10:00:00+05:30")
    ok(c == 200 and not cur().get("gap") and cur().get("last_match_at"), "PC A's beat (50, the add-on there): no gap, the match noted (%s)" % cur())
    c, r = beat(KB, GB, 53, False, "2026-10-04T10:05:00+05:30")
    g = json.loads(cur().get("gap") or "{}"); devB = next(d for d in FS.T["tally_devices"] if d["id"] == DB_)
    ok(c == 200 and g.get("missing") == 3 and str(g.get("since", "")).startswith("2026-10-04T04:30:00") and "up to 3 changes not received since" in str(g.get("words")), "PC B's beat (53): gap {missing 3 (up to: an upper bound), since the last match} (%s)" % g)
    recB = ((devB.get("info") or {}).get("bridges") or {}).get(GB["id"], {}).get("recorder")
    ok(recB == {"ZZ CO": {"seen": False, "lastAt": ""}}, "PC B's recorder state kept in info.bridges[id].recorder (%s)" % recB)
    ok(((r.get("recorder") or {}).get("ZZ CO") or {}).get("missing") == 3, "the beat's answer carries the gap per company (%s)" % r.get("recorder"))
    c, r = rec([line("L13", "created", "v7", 51, amt=1), line("L14", "altered", "v7", 53, amt=2)])
    c, r = beat(KB, GB, 53, False, "2026-10-04T10:20:00+05:30")
    ok(not cur().get("gap") and str(cur().get("last_match_at")).startswith("2026-10-04 04:50") and (r.get("recorder") or {}).get("ZZ CO", {}).get("gap") is None, "A's lines up to 53 arrive: the next check clears the gap (%s)" % cur())
    c, r = beat(KB, GB, 30, False, "2026-10-04T10:30:00+05:30")
    ok(cur().get("state") == "needs_baseline" and not cur().get("gap"), "a number below the starting point (a restore): needs_baseline, never a gap (%s)" % cur().get("state"))
    # ---- the database review's fixes (docs/reviews/migration-44-review.md)
    # M2: ALTVCHID 0 is unknown: no gap check at all, nothing on the cursor; start_point refuses it (400, no RPC)
    db.sql("update tally_sync_cursor set state = 'ok', state_why = null where book_id = %s" % q(BOOK))
    n_gap, n_sp, c0 = len(FS.ARGS.get("tally_recorder_gap_check", [])), len(FS.ARGS.get("tally_start_point", [])), cur()
    c, r = beat(KB, GB, 0, False, "2026-10-04T10:40:00+05:30")
    ok(c == 200 and len(FS.ARGS.get("tally_recorder_gap_check", [])) == n_gap and cur() == c0 and "ZZ CO" not in (r.get("recorder") or {}), "R-M2. a beat with altvchid 0: no gap check, the cursor unchanged (state %s)" % cur().get("state"))
    c, r = call({"kind": "start_point", "company": "ZZ CO", "guid": "cg-1", "altvchid": 0, "bridge": GA})
    ok(c == 400 and len(FS.ARGS.get("tally_start_point", [])) == n_sp, "R-M2. start_point with altvchid 0: refused 400, never a starting point (%s)" % c)
    # L9: a start_point number past Tally's range is a 400, never a 500
    c, r = call({"kind": "start_point", "company": "ZZ CO", "guid": "cg-1", "altvchid": 1e30, "bridge": GA})
    ok(c == 400 and len(FS.ARGS.get("tally_start_point", [])) == n_sp, "R-L9. start_point with altvchid 1e30: refused 400 (%s)" % c)
    # L1: an add-on XML with two vouchers: the line's body keeps its own voucher alone
    x2 = line("L15", "created", "v8", 60, amt=8)
    x2["xml"] = x2["xml"] + xml("v9-other", 61, "20260510", 9)
    c, r = rec([x2])
    b = (db.rows("select jsonb_array_length(body->'vouchers') as nv, body->'vouchers'->0->>'guid' as g, body->'lines'::text as lines from tally_recorder_lines where line_id = 'L15'") or [{}])[0]
    ok(st(r) == {"L15": "applied"} and b.get("nv") == "1" and b.get("g") == "v8" and "v9-other" not in str(b.get("lines")) and vrow("v9-other") == {}, "R-L1. a 2-voucher XML: the body stores 1 voucher (its own) (%s)" % b)
    # M3: a day of a locked month is answered 'locked' (not done), logged as held; after the unlock it applies once
    import base64
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month, locked_by) values (%s, 'c1', %s, '2026-07-01', %s)" % (q(FIRM), q(BOOK), q(OWNER)))
    real_rpc = FS.rpc
    def rpc2(name, a):
        if name == "tally_ingest_day":
            FS.ARGS.setdefault(name, []).append(a)
            return json.loads(db.one("select public.tally_ingest_day(%s)::text" % ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items())))
        return real_rpc(name, a)
    FS.rpc = rpc2
    day = {"day": "20260702", "b64": base64.b64encode(xml("dy1", 62, "20260702", 11).encode()).decode()}
    c, r = call({"kind": "days", "company": "ZZ CO", "days": [day]})
    lk = r.get("locked") or []
    ok(c == 200 and r.get("done") == [] and [x.get("day") for x in lk] == ["20260702"] and "month locked" in str(lk[0].get("why") if lk else "") and vrow("dy1") == {},
       "R-M3. a day of a locked month: answered under locked, not done; nothing stored (%s)" % {k: r.get(k) for k in ("done", "locked", "bad")})
    ok(any(b.get("day") == "20260702" and b.get("locked") is True for b in r.get("bad") or []), "R-M3. and in bad (locked: true), so a bridge that knows only done / bad drops it with the words, never resending it for ever")
    time.sleep(0.5)
    dl = [l for l in log if "20260702" in l or "2026-07-02" in l]
    ok(any("locked month" in l for l in dl) and not any("nothing marked deleted" in l for l in dl), "R-M3. logged as a day of a locked month kept, not 'nothing marked deleted' (%s)" % [l.strip()[:160] for l in dl])
    db.sql("update tally_month_locks set unlocked_at = now() where month = '2026-07-01'")
    c, r = call({"kind": "days", "company": "ZZ CO", "days": [day]})
    ok(c == 200 and r.get("done") == ["20260702"] and not r.get("locked") and vrow("dy1").get("day") == "2026-07-02" and db.one("select count(*) from tally_vouchers where guid = 'dy1'") == "1", "R-M3. after the unlock the day sent again applies once (%s)" % {k: r.get(k) for k in ("done", "locked")})

    # ---------------------------------------------------------------- migration 45: bulk posting with the recorder loaded
    B2, B3 = "12222222-1111-1111-1111-111111111111", "13333333-1111-1111-1111-111111111111"
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ TWO', '2026-04-01', '2026-03-31'), (%s, %s, 'c1', 'ZZ SIX', '2026-04-01', '2026-03-31')" % (q(B2), q(FIRM), q(B3), q(FIRM)))
    FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "ZZ TWO", "client_id": "c1", "book_id": B2}, {"firm_id": FIRM, "company": "ZZ SIX", "client_id": "c1", "book_id": B3}]
    def vxml(fid, n, day="20260814", amt=100, guid=None, alter=None, vno=None):
        extra = ("<GUID>%s</GUID>\n<ALTERID>%d</ALTERID>\n" % (guid, alter) if guid else "") + ("<VOUCHERNUMBER>%s</VOUCHERNUMBER>\n" % vno if vno else "")
        return ('<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>%s</DATE>\n<EFFECTIVEDATE>%s</EFFECTIVEDATE>\n%s<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>\n'
                '<REFERENCE>INV-%d</REFERENCE>\n<REFERENCEDATE>%s</REFERENCEDATE>\n<PARTYLEDGERNAME>Supplier</PARTYLEDGERNAME>\n<NARRATION>Bill %d | TDSDesk:%s</NARRATION>\n'
                '<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>Rent</LEDGERNAME>\n<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<AMOUNT>-%d.00</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n'
                '<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>Supplier</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>%d.00</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n</VOUCHER>\n') % (day, day, extra, n, day, n, fid, amt, amt)
    def post_job(jid, company, fids, status):
        payload = {"vouchers": [{"id": f, "xml": vxml(f, i + 1)} for i, f in enumerate(fids)], "masters": [], "ledger": ""}
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, taken_at) values (%s, %s, 'c1', %s, %s, %s::jsonb, %d, %s, now())"
               % (q(jid), q(FIRM), q(company), q(DA), q(json.dumps(payload)), len(fids), q(status)))
        FS.T["tally_post_jobs"].append({"id": jid, "firm_id": FIRM, "client_id": "c1", "company": company, "device_id": DA, "payload": payload, "n": len(fids), "status": status, "checking": False, "results": [], "items": []})
    # 3. the posting window
    c, r = call({"kind": "beat", "version": "2.2.0", "bridge": GA, "tally": True, "open": ["ZZ TWO"], "companies": [{"name": "ZZ TWO", "open": True, "altvchid": 1000, "at": "2026-10-04T11:00:00+05:30"}]})
    ok(c == 200 and ((r.get("recorder") or {}).get("ZZ TWO") or {}).get("startRecorded") is True, "45-3. ZZ TWO's starting point 1000 from the beat (%s)" % r.get("recorder"))
    db.sql("update tally_sync_cursor set start_guid = 'cg-2' where book_id = %s" % q(B2))     # ZZ TWO's company GUID (a read or start_point gives it)
    def one_(sql):
        try: return db.one(sql)
        except RuntimeError as e: return "ERROR " + str(e)[:120]
    J3 = "00000003-0000-0000-0000-000000000003"
    fids3 = ["W%03d" % i for i in range(100)]
    post_job(J3, "ZZ TWO", fids3, "running")
    upd = lambda jid, results, **kw: call(dict({"kind": "posts_update", "id": jid, "status": "done", "done": len(results), "message": "Posted", "results": results, "bridge": GA}, **kw))
    res3 = [{"id": f, "ok": True, "byReply": True, "created": 1, "vchId": str(5000 + i), "batchN": 50, "kind": "voucher"} for i, f in enumerate(fids3)]
    c, r = upd(J3, res3, window={"a0": 1000, "a1": 1100, "vouchersCreated": 100, "mastersCreated": 0, "guid": "cg-2"})
    wrow = (db.rows("select book_id, device_id, a0, a1, created_vch, created_mst from tally_post_windows where job_id = %s" % q(J3)) or [{}])[0]
    ok(c == 200 and r.get("ok") is True and wrow == {"book_id": B2, "device_id": DA, "a0": "1000", "a1": "1100", "created_vch": "100", "created_mst": "0"}, "45-3. posts_update's window stored per book (%s, %s)" % (r, wrow))
    ok(db.one("select count(*) from tally_post_ids where job_id = %s and accepted_at is not null" % q(J3)) == "100", "45-3. the 100 accepted (tally_post_id_accept_reply)")
    ok(one_("select company_guid from tally_post_windows where job_id = %s" % q(J3)) == "cg-2", "M1. the window keeps the company GUID the bridge read (window.guid) (%s)" % one_("select company_guid from tally_post_windows where job_id = %s" % q(J3)))
    c, r = call({"kind": "beat", "version": "2.2.0", "bridge": GA, "tally": True, "open": ["ZZ TWO"], "companies": [{"name": "ZZ TWO", "open": True, "altvchid": 1100}], "changeNumbers": {"ZZ TWO": {"altvchid": 1100, "at": "2026-10-04T11:30:00+05:30"}}})
    cur2 = (db.rows("select gap::text as gap, last_match_at from tally_sync_cursor where book_id = %s" % q(B2)) or [{}])[0]
    ok(c == 200 and ((r.get("recorder") or {}).get("ZZ TWO") or {}).get("gap") is None and ((r.get("recorder") or {}).get("ZZ TWO") or {}).get("missing") == 0 and not cur2.get("gap") and str(cur2.get("last_match_at")).startswith("2026-10-04 06:00"),
       "45-3. posting 100 with no recorder line, the beat says 1100: no gap flag, last_match_at set (%s; %s)" % (r.get("recorder"), cur2))
    J3b = "00000003-0000-0000-0000-00000000003b"
    post_job(J3b, "ZZ TWO", ["WB1"], "running")
    n_win, n_log = db.one("select count(*) from tally_post_windows"), len(log)
    c, r = upd(J3b, [{"id": "WB1", "ok": True, "byReply": True, "created": 1}], window={"a0": 1100, "a1": 1e16, "vouchersCreated": 1, "mastersCreated": 0})
    time.sleep(0.3)
    ok(c == 200 and r.get("ok") is True and db.one("select count(*) from tally_post_windows") == n_win and any("window" in l for l in log[n_log:]), "45-3. a window out of bounds: not stored, a log line, the update answered (%s)" % [l.strip()[:120] for l in log[n_log:]])
    # 4. 500 posted entries, 500 short lines
    N = 500
    J4 = "00000004-0000-0000-0000-000000000004"
    fids4 = ["S%03d" % i for i in range(N)]
    post_job(J4, "ZZ SIX", fids4, "done")
    db.sql("update tally_post_ids set accepted_at = now() where job_id = %s" % q(J4))
    shorts = [{"line_id": "s%d" % i, "event": "created", "saved_at": "2026-10-04T12:00:00+05:30", "company_guid": "cg-6", "object_guid": "gs-%d" % i, "master_id": str(9000 + i), "alter_id": 2001 + i, "fid": fids4[i]} for i in range(N)]
    rec6 = lambda lines, key=KA, bridge=GA: call({"kind": "recorder_lines", "company": "ZZ SIX", "version": "2.2.0", "bridge": bridge, "lines": lines}, key)
    nv6 = lambda: int(db.one("select count(*) from tally_vouchers where book_id = %s" % q(B3)))
    tb6 = lambda: {x["ledger"]: x["s"] for x in db.rows("select ledger, sum(amount)::text as s from tally_ledger_day where book_id = %s group by ledger order by 1" % q(B3))}
    c, r = rec6(shorts)
    m6 = (db.rows("select count(*) filter (where matched_at is not null) as at, count(*) filter (where matched_guid like 'gs-%%' and matched_mid ~ '^9[0-9]{3}$' and matched_alter between 2001 and 2500) as ids from tally_post_ids where job_id = " + q(J4)) or [{}])[0]
    ok(c == 200 and r.get("applied") == N and r.get("held") == 0 and r.get("duplicate") == 0 and r.get("failed") == 0, "45-4. 500 short lines: 500 applied, 0 held, 0 duplicate (%s)" % {k: r.get(k) for k in ("applied", "held", "duplicate", "failed")})
    ok(m6 == {"at": "500", "ids": "500"}, "45-4. 500 matched on tally_post_ids (matched_at, GUID, MasterID, AlterID) (%s)" % m6)
    v6 = (db.rows("select count(*) as n, count(*) filter (where origin = 'fincom' and fincom_id like 'S%%' and day = '2026-08-14' and alter_id between 2001 and 2500 and guid like 'gs-%%') as good from tally_vouchers where book_id = " + q(B3)) or [{}])[0]
    ok(v6 == {"n": "500", "good": "500"} and db.one("select count(*) from tally_lines where book_id = %s" % q(B3)) == "1000", "45-4. 500 entries built from FinCom's posted XML (parse.js), with the line's GUID and AlterID; 1000 lines (%s)" % v6)
    tb0 = tb6(); ver0 = db.one("select count(*) from tally_voucher_versions where book_id = %s" % q(B3))
    c, r = rec6(shorts)
    ok(r.get("duplicate") == N and r.get("applied") == 0 and nv6() == N, "45-4. the same 500 again: 500 duplicate, still 500 entries (%s)" % {k: r.get(k) for k in ("applied", "duplicate", "held")})
    dayx = "".join(vxml(fids4[i], i + 1, guid="gs-%d" % i, alter=2001 + i, vno="J-%d" % (i + 1)) for i in range(N))
    c, r = call({"kind": "days", "company": "ZZ SIX", "days": [{"day": "20260814", "b64": base64.b64encode(dayx.encode()).decode(), "n": N}]})
    ok(c == 200 and r.get("done") == ["20260814"] and nv6() == N and db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(B3)) == "500", "45-4. the day book of that day uploaded: still 500 entries (%s)" % {k: r.get(k) for k in ("done", "bad")})
    ok(db.one("select count(*) from tally_voucher_versions where book_id = %s" % q(B3)) == ver0 == "500" and tb6() == tb0 and tb0.get("Rent") == "-50000", "45-4. versions kept (500), the trial balance unchanged (%s)" % tb6())
    c, r = rec6([{"line_id": "nar1", "event": "created", "company_guid": "cg-6", "object_guid": "gz-1", "master_id": "1", "alter_id": 3001, "narration": "Bill | TDSDesk:NOSUCH9", "saved_at": "2026-10-04T12:00:00+05:30"}])
    ok(st(r) == {"nar1": "held"} and "FinCom id NOSUCH9 matches no posting of this firm" in str((r.get("results") or [{}])[0].get("why")) and vrow("gz-1") == {}, "45-4. a short line whose FinCom id (in its narration) matches nothing: held with words, no entry (%s)" % r.get("results"))
    c, r = rec6([{"line_id": "bad1", "event": "created", "object_guid": "gz-2", "alter_id": 3002, "fid": "bad id with spaces"}])
    ok(st(r) == {"bad1": "held"} and vrow("gz-2") == {}, "45-4. a FinCom id outside the bounds is no FinCom id: no body, held (%s)" % r.get("results"))
    # ---- the database review of 45 (docs/reviews/migration-45-review.md)
    # H2 (G10): a short 'altered' line is never built from FinCom's posted XML; held, the copy unchanged, shown by the gap check
    nx = len(FS.ARGS.get("tally_post_xml_for", []))
    c, r = rec6([{"line_id": "alt0", "event": "altered", "saved_at": "2026-10-04T12:30:00+05:30", "company_guid": "cg-6", "object_guid": "gs-0", "master_id": "9000", "alter_id": 2600, "fid": fids4[0]}])
    res = (r.get("results") or [{}])[0]
    ok(st(r) == {"alt0": "held"} and "changed in Tally after posting" in str(res.get("why")) and len(FS.ARGS.get("tally_post_xml_for", [])) == nx and db.one("select alter_id from tally_vouchers where book_id = %s and guid = 'gs-0'" % q(B3)) == "2001"
       and db.one("select count(*) from tally_voucher_versions where book_id = %s and alter_id = 2600" % q(B3)) == "0",
       "H2. a short 'altered' line of a posted entry: no body from the posting (no XML fetched), held 'changed in Tally after posting', the copy at 2001 (%s; xml calls %d -> %d; copy %s)" % (res, nx, len(FS.ARGS.get("tally_post_xml_for", [])), db.one("select alter_id from tally_vouchers where book_id = %s and guid = 'gs-0'" % q(B3))))
    # L8: the window is saved only after the update's own checks: a cancelled job's, a late (lower seq) update's never
    J8 = "00000008-0000-0000-0000-000000000008"
    post_job(J8, "ZZ TWO", ["WC1"], "cancelled")
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J8))
    nw, ns = db.one("select count(*) from tally_post_windows"), len(FS.ARGS.get("tally_post_window_save", []))
    c, r = upd(J8, [{"id": "WC1", "ok": True, "byReply": True, "created": 1}], window={"a0": 1200, "a1": 1201, "vouchersCreated": 1, "mastersCreated": 0, "guid": "cg-2"})
    ok(r.get("cancelled") is True and db.one("select count(*) from tally_post_windows") == nw and len(FS.ARGS.get("tally_post_window_save", [])) == ns, "L8. a cancelled job's update with a window: answered cancelled, no window saved (%s)" % r)
    J9 = "00000009-0000-0000-0000-000000000009"
    post_job(J9, "ZZ TWO", ["WD1"], "running")
    next(x for x in FS.T["tally_post_jobs"] if x["id"] == J9)["seq"] = 5
    c, r = upd(J9, [{"id": "WD1", "ok": True, "byReply": True, "created": 1}], seq=3, window={"a0": 1300, "a1": 1301, "vouchersCreated": 1, "mastersCreated": 0, "guid": "cg-2"})
    ok(r.get("stale") is True and db.one("select count(*) from tally_post_windows where job_id = %s" % q(J9)) == "0", "L8. a late update (seq 3 after 5) with a window: stale, no window saved (%s)" % r)
    # M6: a short line that arrives before its posting's acceptance is held; the acceptance (posts_update) applies it once
    B7 = "14444444-1111-1111-1111-111111111111"
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ SEVEN', '2026-04-01', '2026-03-31')" % (q(B7), q(FIRM)))
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ SEVEN", "client_id": "c1", "book_id": B7})
    J7 = "00000007-0000-0000-0000-000000000007"
    post_job(J7, "ZZ SEVEN", ["R1", "R2"], "running")
    c, r = call({"kind": "recorder_lines", "company": "ZZ SEVEN", "version": "2.2.0", "bridge": GA, "lines": [{"line_id": "r1", "event": "created", "saved_at": "2026-10-04T12:40:00+05:30", "company_guid": "cg-7", "object_guid": "gr-1", "master_id": "71", "alter_id": 7001, "fid": "R1", "vch_date": "20260814"}]})
    held = st(r) == {"r1": "held"} and "matches no posting of this firm" in str((r.get("results") or [{}])[0].get("why"))
    c, r = upd(J7, [{"id": "R1", "ok": True, "byReply": True, "created": 1, "vchId": "7101", "batchN": 2, "kind": "voucher"}, {"id": "R2", "ok": True, "byReply": True, "created": 1, "vchId": "7102", "batchN": 2, "kind": "voucher"}])
    lr = (db.rows("select state, count(*) over () as n from tally_recorder_lines where book_id = %s and line_id = 'r1'" % q(B7)) or [{}])[0]
    v7 = (db.rows("select origin, fincom_id, alter_id, (select count(*) from tally_lines l where l.book_id = v.book_id and l.guid = v.guid) as nl from tally_vouchers v where book_id = %s and guid = 'gr-1'" % q(B7)) or [{}])[0]
    ok(held and c == 200 and r.get("ok") is True and lr == {"state": "applied", "n": "1"} and v7 == {"origin": "fincom", "fincom_id": "R1", "alter_id": "7001", "nl": "2"}
       and db.one("select matched_guid from tally_post_ids where job_id = %s and fincom_id = 'R1'" % q(J7)) == "gr-1",
       "M6. a short line before its posting's acceptance: held; posts_update's acceptance retries it: the same line applied once, the entry built from the posted XML, the posting matched (%s; %s; %s)" % (held, lr, v7))

    # ---------------------------------------------------------------- round 19: the beat's change numbers in both shapes
    # 2.1.9 sends them top-level only: startPoint {company: {altvchid, altmstid, at, guid}} and changeNumbers {company:
    # {altvchid, altmstid, at, recorderSeen, recorderLastAt}}, its companies[] without them (bridge-go/cloud.go beatBody); 2.1.10
    # also puts {guid, altvchid, altmstid, recorderSeen} in companies[] for every open company. The bridge's times carry no zone
    # (Windows local time, IST): read as +05:30
    B9, B10 = "19999999-2222-2222-2222-222222222222", "1aaaaaaa-2222-2222-2222-222222222222"
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ NINE', '2026-04-01', '2026-03-31'), (%s, %s, 'c1', 'ZZ TEN', '2026-04-01', '2026-03-31')" % (q(B9), q(FIRM), q(B10), q(FIRM)))
    FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "ZZ NINE", "client_id": "c1", "book_id": B9}, {"firm_id": FIRM, "company": "ZZ TEN", "client_id": "c1", "book_id": B10}]
    G9, G10 = dict(GA, version="2.1.9"), dict(GA, version="2.1.10")
    cur19 = lambda b: (db.rows("select start_at is not null as started, start_guid, last_voucher_alterid as sv, gap::text as gap, last_match_at from tally_sync_cursor where book_id = %s" % q(b)) or [{}])[0]
    nsp = lambda b: len([a for a in FS.ARGS.get("tally_start_point", []) if a.get("p_book") == b])
    recA = lambda bridge: (((next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("bridges") or {}).get(bridge["id"]) or {}).get("recorder") or {}
    def beat9(alt, at):
        return call({"kind": "beat", "version": "2.1.9", "bridge": G9, "tally": True, "tallyState": "open", "open": ["ZZ NINE"], "paused": True, "companies": [],
                     "startPoint": {"ZZ NINE": {"altvchid": 200, "altmstid": 30, "at": "2026-10-04T15:40:00", "guid": "cg-9"}},
                     "changeNumbers": {"ZZ NINE": {"altvchid": alt, "altmstid": 30, "at": at, "recorderSeen": False, "recorderLastAt": ""}}})
    c, r = beat9(200, "2026-10-04T15:40:00")
    k = cur19(B9)
    ok(c == 200 and k.get("started") == "t" and k.get("start_guid") == "cg-9" and k.get("sv") == "200" and not k.get("gap") and nsp(B9) == 1,
       "19-1. a 2.1.9 beat (startPoint / changeNumbers top-level, companies []): the starting point recorded (200, GUID cg-9), no gap (%s; start_point calls %d)" % (k, nsp(B9)))
    ok(recA(G9).get("ZZ NINE") == {"seen": False, "lastAt": ""}, "19-1. recorderOf reads changeNumbers' recorderSeen (the banner) (%s)" % recA(G9))
    c, r = beat9(202, "2026-10-04T15:50:00")
    g = json.loads(cur19(B9).get("gap") or "{}")
    ok(c == 200 and g.get("missing") == 2 and "up to 2 changes not received since 04-Oct-2026 15:40" in str(g.get("words")) and ((r.get("recorder") or {}).get("ZZ NINE") or {}).get("missing") == 2,
       "19-2. the next 2.1.9 beat says 202, no recorder line: 'up to 2 changes not received since 04-Oct-2026 15:40' (the bridge's time read as IST) (%s)" % g.get("words"))
    ok(nsp(B9) == 1, "19-2. tally_start_point called once, not every beat (%d calls)" % nsp(B9))
    # 45's behaviour kept: FinCom's posting of 10 (window 202..212 in this book's company GUID) is subtracted
    J19 = "00000019-0000-0000-0000-000000000019"
    fids19 = ["N%02d" % i for i in range(10)]
    post_job(J19, "ZZ NINE", fids19, "running")
    c, r = upd(J19, [{"id": f, "ok": True, "byReply": True, "created": 1, "vchId": str(9100 + i), "batchN": 10, "kind": "voucher"} for i, f in enumerate(fids19)], window={"a0": 202, "a1": 212, "vouchersCreated": 10, "mastersCreated": 0, "guid": "cg-9"})
    c, r = beat9(212, "2026-10-04T16:00:00")
    g = json.loads(cur19(B9).get("gap") or "{}")
    ok(c == 200 and g.get("missing") == 2 and g.get("accounted") == 10 and "up to 2 changes not received since 04-Oct-2026 15:40" in str(g.get("words")),
       "19-3. FinCom's posting of 10 (window 202..212) subtracted: still up to 2, accounted 10 (%s)" % {k_: g.get(k_) for k_ in ("missing", "accounted", "words")})
    # 2.1.10: companies[] carries the numbers (read first); the top-level fields too, for compatibility
    def beat10(alt, at, top=True, seen=False):
        b = {"kind": "beat", "version": "2.1.10", "bridge": G10, "tally": True, "tallyState": "open", "open": ["ZZ TEN"], "paused": True,
             "companies": [{"name": "ZZ TEN", "open": True, "at": at, "phase": "", "waiting": 0, "lastRead": "", "guid": "cg-10", "altvchid": alt, "altmstid": 4, "recorderSeen": seen}]}
        if top: b.update({"startPoint": {"ZZ TEN": {"altvchid": 300, "altmstid": 4, "at": "2026-10-04T15:40:00", "guid": "cg-10"}},
                          "changeNumbers": {"ZZ TEN": {"altvchid": alt, "altmstid": 4, "at": at, "recorderSeen": not seen, "recorderLastAt": ""}}})
        return call(b)
    c, r = beat10(300, "2026-10-04T15:40:00")
    k = cur19(B10)
    ok(c == 200 and k.get("started") == "t" and k.get("start_guid") == "cg-10" and k.get("sv") == "300" and not k.get("gap") and nsp(B10) == 1,
       "19-4. a 2.1.10 beat (companies[] with guid / altvchid): the starting point recorded (300, GUID cg-10) (%s)" % k)
    ok(recA(G10).get("ZZ TEN") == {"seen": False, "lastAt": ""}, "19-4. recorderOf: companies[] first (seen false there, true top-level) (%s)" % recA(G10))
    c, r = beat10(302, "2026-10-04T15:55:00", top=False)
    g = json.loads(cur19(B10).get("gap") or "{}")
    ok(c == 200 and g.get("missing") == 2 and "up to 2 changes not received since 04-Oct-2026 15:40" in str(g.get("words")) and nsp(B10) == 1,
       "19-5. the next 2.1.10 beat (companies[] only) says 302: 'up to 2 changes not received since ...'; start_point not called again (%s)" % g.get("words"))
    # a failed call is logged with words (the company and the error), never swallowed
    real19 = FS.rpc
    def busy(name, a):
        if name == "tally_recorder_gap_check": raise RuntimeError("the database is busy (test)")
        return real19(name, a)
    FS.rpc = busy
    n_log = len(log)
    c, r = beat10(302, "2026-10-04T16:05:00", top=False)
    time.sleep(0.5); FS.rpc = real19
    said = [l.strip() for l in log[n_log:] if "tally_recorder_gap_check" in l]
    ok(c == 200 and len(said) == 1 and "ZZ TEN" in said[0] and "busy" in said[0], "19-6. a failed gap check: the beat answered, one log line with the company and the error (%s)" % said)
    # the bridge's own beat (bridge-go writes tests/fixtures/beat-2.1.10.json): fed as it is, each company linked to a book
    FIX = os.path.join(HERE, "fixtures", "beat-2.1.10.json")
    if os.path.exists(FIX):
        fb = json.load(open(FIX)); fb["kind"] = "beat"; fb.pop("shadow", None)
        fb["bridge"] = dict(fb.get("bridge") or {}, id=GA["id"]) if isinstance(fb.get("bridge"), dict) else G10
        want = [x for x in (fb.get("companies") or []) if isinstance(x, dict) and x.get("guid") and (x.get("altvchid") or 0) > 0]
        for i, x in enumerate(want):
            bid = "1bbbbbbb-2222-2222-2222-%012d" % i
            db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', %s, '2026-04-01', '2026-03-31') on conflict do nothing" % (q(bid), q(FIRM), q(x["name"])))
            FS.T["tally_companies"].append({"firm_id": FIRM, "company": x["name"], "client_id": "c1", "book_id": bid})
        c, r = call(fb)
        got = [(x["name"], cur19("1bbbbbbb-2222-2222-2222-%012d" % i)) for i, x in enumerate(want)]
        ok(c == 200 and want and all(k_.get("started") == "t" and k_.get("start_guid") == x["guid"] for (_, k_), x in zip(got, want)),
           "19-7. the bridge's real 2.1.10 beat (tests/fixtures/beat-2.1.10.json): a starting point for each open company with a GUID (%s)" % got)
    else:
        print("  (19-7: tests/fixtures/beat-2.1.10.json not there yet: the bridge's own beat is not fed)")

    # ---------------------------------------------------------------- review 46 (docs/reviews/migration-46-review.md, Fixed)
    def newbook(bid, name):
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', %s, '2026-04-01', '2026-03-31')" % (q(bid), q(FIRM), q(name)))
        FS.T["tally_companies"].append({"firm_id": FIRM, "company": name, "client_id": "c1", "book_id": bid})
    def b10(key, cos, extra=None, bridge=None):
        b = {"kind": "beat", "version": "2.1.10", "bridge": bridge or (G10 if key == KA else dict(GB, version="2.1.10")), "tally": True, "tallyState": "open", "open": [x["name"] for x in cos], "paused": True, "companies": cos}
        if extra: b.update(extra)
        return call(b, key)
    co = lambda name, guid, alt, **kw: dict({"name": name, "open": True, "at": "", "guid": guid, "altvchid": alt, "altmstid": 1}, **kw)
    curR = lambda b: (db.rows("select company_guid, start_guid, last_voucher_alterid as sv, start_at, state, gap->>'missing' as missing, last_match_at, abs(extract(epoch from last_match_at - now())) < 120 as match_now from tally_sync_cursor where book_id = %s" % q(b)) or [{}])[0]
    ngc = lambda b, dv=None: len([a for a in FS.ARGS.get("tally_recorder_gap_check", []) if a.get("p_book") == b and (dv is None or a.get("p_device") == dv)])
    # H1: two PCs with a same-named company of different GUIDs, beats alternating
    BF = "1fffffff-2222-2222-2222-222222222222"; newbook(BF, "ZZ FORGE")
    n_log = len(log)
    c, r = b10(KA, [co("ZZ FORGE", "cg-A", 1000)]); k0 = curR(BF)
    seen = []
    for key, g_, v_ in ((KB, "cg-B", 40), (KA, "cg-A", 1003), (KB, "cg-B", 41), (KA, "cg-A", 1003), (KB, "cg-B", 42)):
        c, r = b10(key, [co("ZZ FORGE", g_, v_)]); seen.append((key, (r.get("recorder") or {}).get("ZZ FORGE")))
    k = curR(BF)
    ok(k.get("sv") == "1000" and k.get("start_guid") == "cg-A" and k.get("start_at") == k0.get("start_at") and k.get("state") == "needs_baseline",
       "R46-H1. PC-A cg-A 1000, PC-B same name cg-B 40..42, beats alternating: the starting point never moves (1000, cg-A), needs_baseline (%s)" % k)
    ansB = [a for key, a in seen if key == KB]; ansA = [a for key, a in seen if key == KA]
    ok(all(a and a.get("otherCompany") is True and a.get("needsBaseline") is True and a.get("missing") == 0 and a.get("gap") is None for a in ansB) and ngc(BF, DB_) == 0,
       "R46-H1. PC-B's answers: otherCompany, needsBaseline, no gap check made for the other company (%s; gap checks from PC-B %d)" % (ansB, ngc(BF, DB_)))
    ok(all(a and a.get("missing") == 3 for a in ansA) and k.get("missing") == "3", "R46-H1. PC-A's 1003 against its own 1000: up to 3, no false gap (%s)" % ansA)
    time.sleep(0.3)
    said = [l.strip() for l in log[n_log:] if "another company" in l and "ZZ FORGE" in l]
    ok(len(said) == 1 and "cg-B" in said[0], "R46-H1. the other company logged once, not every beat (%s)" % said)
    # H1: a start recorded without a GUID, then a GUID: stamped, not moved, the open gap kept
    BN = "1f0fffff-2222-2222-2222-222222222222"; newbook(BN, "ZZ NOGUID")
    b10(KA, [co("ZZ NOGUID", "", 500)]); c, r = b10(KA, [co("ZZ NOGUID", "", 520)]); k0 = curR(BN)
    c, r = b10(KA, [co("ZZ NOGUID", "cg-N", 520)]); k = curR(BN)
    ok(k0.get("start_guid") in (None, "") and k0.get("missing") == "20" and k.get("sv") == "500" and k.get("start_guid") == "cg-N" and k.get("start_at") == k0.get("start_at")
       and ((r.get("recorder") or {}).get("ZZ NOGUID") or {}).get("missing") == 20 and k.get("state") == "ok",
       "R46-H1. a start recorded without a GUID (500, up to 20), then the GUID cg-N: stamped, not moved, still up to 20 (%s)" % k)
    # M1: tally_book_for once per company within the window (5 min linked, 1 min unlinked), not every beat
    BM1, BM2 = "1e1eeeee-2222-2222-2222-222222222222", "1e2eeeee-2222-2222-2222-222222222222"; newbook(BM1, "ZZ MEMO 1"); newbook(BM2, "ZZ MEMO 2")
    BOOKFOR = []
    realM = FS.rpc
    def countbf(name, a):
        if name == "tally_book_for": BOOKFOR.append(a.get("p_company"))
        return realM(name, a)
    FS.rpc = countbf
    for i in range(10):
        b10(KA, [co("ZZ MEMO 1", "cg-m1", 700 + i), co("ZZ MEMO 2", "cg-m2", 800), co("ZZ MEMO UNLINKED", "cg-mu", 900)])
    FS.rpc = realM
    per = {n: BOOKFOR.count(n) for n in ("ZZ MEMO 1", "ZZ MEMO 2", "ZZ MEMO UNLINKED")}
    ok(per == {"ZZ MEMO 1": 1, "ZZ MEMO 2": 1, "ZZ MEMO UNLINKED": 1} and ngc(BM1) == 10, "R46-M1. 10 beats: one tally_book_for per company (linked and not), the gap check every beat (%s; gap checks %d)" % (per, ngc(BM1)))
    # M2: a check time more than 5 minutes ahead of the server's now is taken as now; a restore below the match is then flagged
    BK = "1d1ddddd-2222-2222-2222-222222222222"; newbook(BK, "ZZ CLK")
    cn = lambda alt, at: {"changeNumbers": {"ZZ CLK": {"altvchid": alt, "at": at}}}
    b10(KA, [co("ZZ CLK", "cg-K", 10)], cn(10, "2026-10-04T09:00:00"))
    db.sql("update tally_sync_cursor set recorder_max_alter = 12, recorder_last_at = now() where book_id = %s" % q(BK))
    c, r = b10(KA, [co("ZZ CLK", "cg-K", 12)], cn(12, "2027-10-04T16:00:00")); k = curR(BK)
    ok(k.get("match_now") == "t", "R46-M2. a check time a year ahead (the PC's clock) is taken as now: last_match_at %s" % k.get("last_match_at"))
    c, r = b10(KA, [co("ZZ CLK", "cg-K", 11)], cn(11, ""))
    ok(((r.get("recorder") or {}).get("ZZ CLK") or {}).get("needsBaseline") is True and curR(BK).get("state") == "needs_baseline",
       "R46-M2. then a restore to 11 (below the match of 12): needs_baseline, not 'behind' (%s)" % (r.get("recorder") or {}).get("ZZ CLK"))
    # L2: the check's time from changeNumbers.at only, never companies[].at (the company's last update)
    BT = "1ddddddd-2222-2222-2222-222222222222"; newbook(BT, "ZZ AT")
    b10(KA, [co("ZZ AT", "cg-T", 10, at="2026-09-01T09:00:00")]); b10(KA, [co("ZZ AT", "cg-T", 10, at="2026-09-01T09:00:00")])
    k = curR(BT)
    ok(k.get("match_now") == "t", "R46-L2. companies[].at (01-Sep, the last update) is not the check's time: last_match_at now (%s)" % k.get("last_match_at"))
    # L3: only the bridge's exact 2006-01-02T15:04:05 gets +05:30; another zone-less form is not read (now)
    BL = "1dcddddd-2222-2222-2222-222222222222"; newbook(BL, "ZZ FORM")
    cl = lambda alt, at: {"changeNumbers": {"ZZ FORM": {"altvchid": alt, "at": at}}}
    b10(KA, [co("ZZ FORM", "cg-F", 10)], cl(10, "2026-10-04T09:00:00"))
    ok(db.one("select to_char(last_match_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from tally_sync_cursor where book_id = %s" % q(BL)) == "2026-10-04 03:30",
       "R46-L3. the bridge's form 2026-10-04T09:00:00 read as IST (03:30 UTC)")
    for form in ("2026-10-04 09:00:00", "2026-10-04", "04-10-2026 09:00", "2026-10-04T09:00", "2026-10-04T09:00:00.123"):
        db.sql("update tally_sync_cursor set last_match_at = '2026-01-01' where book_id = %s" % q(BL))
        b10(KA, [co("ZZ FORM", "cg-F", 10)], cl(10, form))
        ok(curR(BL).get("match_now") == "t", "R46-L3. a zone-less time in another form (%r): not read, taken as now (%s)" % (form, curR(BL).get("last_match_at")))
    b10(KA, [co("ZZ FORM", "cg-F", 10)], cl(10, "2026-10-04T09:00:00+05:30"))
    ok(db.one("select to_char(last_match_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from tally_sync_cursor where book_id = %s" % q(BL)) == "2026-10-04 03:30", "R46-L3. a time with its zone read as it says")
    # ---------------------------------------------------------------- round 20 (migration 47): the recorder queue; the beat's recorderSource
    BQ = "1a0aaaaa-2222-2222-2222-222222222222"; newbook(BQ, "ZZ QUEUE")
    recq = lambda lines, key=KA: call({"kind": "recorder_lines", "company": "ZZ QUEUE", "version": "2.2.0", "bridge": GA, "lines": lines}, key)
    queued_calls = lambda: [a for a in FS.ARGS.get("tally_recorder_send", []) if a.get("p_queue")] + FS.ARGS.get("tally_recorder_enqueue", [])
    nq = lambda: len(queued_calls())
    qst = lambda prefix: [(x["line_id"], x["state"]) for x in db.rows("select line_id, state from tally_recorder_lines where book_id = %s and line_id like %s order by id" % (q(BQ), q(prefix + "%")))]
    vq = lambda g: (db.rows("select alter_id, deleted_at from tally_vouchers where book_id = %s and guid = %s" % (q(BQ), q(g))) or [{}])[0]
    n0 = nq()
    c, r = recq([line("D%02d" % i, "created", "qd-%d" % i, 3000 + i, amt=10 + i) for i in range(50)])
    ok(c == 200 and r.get("applied") == 50 and not r.get("queued") and nq() == n0 and len(qst("D")) == 50, "20. 50 full lines: applied directly, as before (%s)" % {k: r.get(k) for k in ("applied", "queued")})
    shorts = [{"line_id": "H%02d" % i, "event": "created", "saved_at": "2026-10-04T12:00:00+05:30", "company_guid": "cg-q", "object_guid": "qh-%d" % i, "master_id": str(i), "alter_id": 3100 + i, "fid": "NOPOST%02d" % i} for i in range(60)]
    c, r = recq(shorts)
    ok(c == 200 and r.get("held") == 60 and not r.get("queued") and nq() == n0, "20. 60 short lines (FinCom's own entries, no body of their own): applied directly (held: no posting) (%s)" % {k: r.get(k) for k in ("held", "queued")})
    many = [line("Q%02d" % i, "created", "qq-%d" % i, 4000 + i, amt=5 + i) for i in range(60)] + [line("Q60", "altered", "qq-0", 4100, amt=99), line("Qbad", "exploded", "qq-x", 1)]
    t0 = time.time(); c, r = recq(many); took = time.time() - t0
    res = {x.get("line_id"): x.get("state") for x in r.get("results") or []}
    ok(c == 200 and r.get("ok") is True and r.get("queued") == 61 and r.get("failed") == 1 and nq() == n0 + 1 and qst("Q") == [] and res.get("Q00") == "queued" and res.get("Qbad") == "failed",
       "20. 61 full lines (and a bad one): one message on the queue, answered {queued: 61} at once (%.2f s), the bad line failed, nothing applied yet (%s)" % (took, {k: r.get(k) for k in ("queued", "failed", "applied")}))
    sent = (queued_calls() or [{}])[-1]
    ok(sent.get("p_book") == BQ and sent.get("p_device") == DA and len(sent.get("p_lines") or []) == 61 and (sent["p_lines"][0].get("vouchers") or [{}])[0].get("guid") == "qq-0" and "xml" not in sent["p_lines"][0]
       and (sent["p_lines"][0].get("lines") or [[None]])[0][0] == "qq-0", "20. the message holds the cleaned lines with their bodies read (parse.js), not the XML")
    d = json.loads(db.one("select tally_recorder_drain(20000)::text"))
    ok(d.get("done") == 1 and qst("Q") == [("Q%02d" % i, "applied") for i in range(60)] + [("Q60", "applied")] and vq("qq-0").get("alter_id") == "4100"
       and db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = 'Sales'" % q(BQ)) == str(sum(10 + i for i in range(50)) + sum(5 + i for i in range(1, 60)) + 99),
       "20. the drain applies the message in order (Q00..Q59, then Q60 altering qq-0), the day cache follows (%s)" % d)
    ok(db.one("select count(*) from pgmq.a_tally_recorder") == "1" and db.one("select count(*) from pgmq.q_tally_recorder") == "0", "20. the message archived")
    real20 = FS.rpc
    def no47(name, a):
        if name in ("tally_recorder_enqueue", "tally_recorder_send"): raise RuntimeError("Could not find the function public.%s(p_book, p_device, p_firm, p_lines) in the schema cache" % name)
        return real20(name, a)
    FS.rpc = no47; n_log = len(log)
    c, r = recq([line("F%02d" % i, "created", "qf-%d" % i, 5000 + i, amt=1) for i in range(55)])
    FS.rpc = real20
    time.sleep(0.2)
    ok(c == 200 and r.get("applied") == 55 and not r.get("queued") and any("migration 47" in l for l in log[n_log:]), "20. a cloud without 47 (no queue): 55 full lines applied directly, said in the log (%s)" % {k: r.get(k) for k in ("applied", "queued")})
    devA = next(x for x in FS.T["tally_devices"] if x["id"] == DA)
    beat20 = lambda: call({"kind": "beat", "version": "2.2.0", "bridge": GA, "tally": True, "open": []})
    devA["recorder_source"] = "both"; c, r = beat20()
    ok(c == 200 and r.get("recorderSource") == "both", "20. the beat answers recorderSource from tally_devices.recorder_source ('both') (%s)" % r.get("recorderSource"))
    devA["recorder_source"] = "alterid"; c, r = beat20()
    ok(r.get("recorderSource") == "alterid", "20. ... 'alterid'")
    devA.pop("recorder_source"); c, r = beat20()
    ok(c == 200 and "recorderSource" not in r, "20. a cloud without the column: recorderSource left out of the answer")
    devA["recorder_source"] = "nonsense"; c, r = beat20(); devA.pop("recorder_source")
    ok("recorderSource" not in r, "20. a value that is not addon, alterid or both: left out")
    FX = os.path.join(HERE, "fixtures", "recorder-lines-2.2.0.json")
    if os.path.exists(FX):
        fx = json.load(open(FX)); body = fx.get("body", fx) if isinstance(fx, dict) else {"lines": fx}
        body = dict(body); body.setdefault("kind", "recorder_lines"); body.setdefault("bridge", GA)
        if body.get("company") and not any(x["company"] == body["company"] for x in FS.T["tally_companies"]):
            newbook("1a1aaaaa-2222-2222-2222-222222222222", body["company"])
        body.setdefault("company", "ZZ QUEUE")
        n = len(body.get("lines") or [])
        c, r = call(body, KA)
        states = [x.get("state") for x in r.get("results") or []]
        ok(c == 200 and n > 0 and len(states) == n and all(s_ in ("applied", "held", "duplicate", "stale", "failed", "queued") for s_ in states) and (r.get("queued") == n - states.count("failed") or not r.get("queued")),
           "20. the bridge's own recorder_lines body (tests/fixtures/recorder-lines-2.2.0.json, %d lines): every line answered (%s)" % (n, {k: r.get(k) for k in ("applied", "held", "duplicate", "stale", "failed", "queued")}))
        if r.get("queued"):
            d = json.loads(db.one("select tally_recorder_drain(20000)::text")); ok(d.get("done") == 1, "20. ... and the drain applies it (%s)" % d)
    else:
        print("  (20: tests/fixtures/recorder-lines-2.2.0.json not there yet: the bridge's own body is not fed)")

    # ---------------------------------------------------------------- round 21 (docs/reviews/migration-47-48-review.md H1): a book's order through tally-ingest
    BO = "1a2aaaaa-2222-2222-2222-222222222222"; newbook(BO, "ZZ ORDER")
    reco = lambda lines: call({"kind": "recorder_lines", "company": "ZZ ORDER", "version": "2.2.0", "bridge": GA, "lines": lines}, KA)
    ostate = lambda: [(x["line_id"], x["state"]) for x in db.rows("select line_id, state from tally_recorder_lines where book_id = %s order by id" % q(BO))]
    b10(KA, [co("ZZ ORDER", "cg-o", 7999)])                      # the starting point
    db.sql("""create or replace function public.test_boom() returns trigger language plpgsql as $$ begin
                if new.line_id = 'O00' and new.state = 'received' then raise exception 'boom (test)' using errcode = 'XX001'; end if; return new; end $$;
              create trigger test_boom before insert on public.tally_recorder_lines for each row execute function public.test_boom();""")
    c1, r1 = reco([line("O%02d" % i, "created", "qo-%d" % i, 8000 + i, amt=1 + i) for i in range(61)])
    c2, r2 = reco([line("O%02d" % i, "created", "qo-%d" % i, 8000 + i, amt=1) for i in range(61, 64)])
    ok(c1 == 200 and r1.get("queued") == 61 and c2 == 200 and r2.get("queued") == 3 and ostate() == [],
       "R21-H1. 61 full lines queued; then 3 lines of the same company while that message is pending: queued behind it, never applied before it (%s / %s)" % ({k: r1.get(k) for k in ("queued", "applied")}, {k: r2.get(k) for k in ("queued", "applied")}))
    for i in range(5):
        db.one("select tally_recorder_drain(5000)::text"); db.sql("update pgmq.q_tally_recorder set vt = now() - interval '1 second'")
    db.sql("drop trigger test_boom on public.tally_recorder_lines")
    os_ = ostate()
    ok(os_ == [("O%02d" % i, "failed") for i in range(61)] + [("O%02d" % i, "applied") for i in range(61, 64)],
       "R21-H1. the queued message fails 5 times: its 61 lines 'failed' with words, then the 3 behind applied (%s ... %s)" % (os_[:1], os_[-4:]))
    c, r = b10(KA, [co("ZZ ORDER", "cg-o", 8063)])
    ans = (r.get("recorder") or {}).get("ZZ ORDER") or {}
    ok(c == 200 and ans.get("missing") == 61 and "queued send" in str((ans.get("gap") or {}).get("words")), "R21-H1. the beat says 8063 (the recorder's highest too): still up to 61 not received, never a silent match (%s)" % {k: ans.get(k) for k in ("missing",)})
    ok(db.one("select count(*) from tally_alerts where kind = 'gap' and book_id = %s and device_id = %s and words like '%%61 changes%%not applied%%'" % (q(BO), q(DA))) == "1",
       "R21-H1. a 'gap' alert for ZZ ORDER from PC-A the moment the send failed")
    # ---------------------------------------------------------------- migration 51 (FinCom Bridge 2.2.2): idsMismatch / lineGuid / heldWhy kept
    BI, CGI = "51000000-0000-0000-0000-000000000051", "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
    GI = CGI + "-00006346"
    newbook(BI, "ZZ IDS")
    reci = lambda lines: call({"kind": "recorder_lines", "company": "ZZ IDS", "version": "2.2.2", "bridge": dict(GA, version="2.2.2"), "lines": lines})
    lrow51 = lambda lid: (db.rows("select state, coalesce(held_why, '') as why, payload::text as payload from tally_recorder_lines where book_id = %s and line_id = %s order by id desc limit 1" % (q(BI), q(lid))) or [{}])[0]
    pl = lambda lid: json.loads(lrow51(lid).get("payload") or "{}")
    nI = lambda: db.one("select count(*) from tally_vouchers where book_id = %s" % q(BI))
    c, r = reci([line("I0", "created", GI, 9001, "20260812", amt=500, company_guid=CGI, master_id="25414")])
    ok(c == 200 and st(r) == {"I0": "applied"} and vrow_b(BI, GI).get("alter_id") == "9001", "51. the copy holds the entry of GUID ...-00006346 (%s)" % st(r))
    HW = "Tally's voucher with MasterID 25683 is a Payment of 12-Aug-2026, not this Journal of 01-Oct-2026"
    n0 = nI()
    c, r = reci([line("I1", "created", "", None, "20261001", company_guid=CGI, master_id="25683", vch_type="Journal", vch_no="J-1", idsMismatch=True, lineGuid=GI, heldWhy=HW)])
    lr, p1 = lrow51("I1"), pl("I1")
    ok(c == 200 and st(r) == {"I1": "held"} and lr.get("state") == "held" and lr.get("why") == HW and nI() == n0 and vrow_b(BI, GI).get("alter_id") == "9001",
       "51-1. idsMismatch true, lineGuid ...-00006346 (the copy holds it), no XML: held (never duplicate), held_why = the bridge's heldWhy, the copy unchanged (%s; %r)" % (st(r), lr.get("why")))
    ok(p1.get("idsMismatch") is True and p1.get("lineGuid") == GI and p1.get("heldWhy") == HW, "51-1. the payload keeps idsMismatch / lineGuid / heldWhy (%s)" % {k: p1.get(k) for k in ("idsMismatch", "lineGuid", "heldWhy")})
    long_ = "x" * 280 + " the bridge's reason goes on and on past three hundred characters" + "y" * 100
    c, r = reci([line("I2", "created", "", None, "20261001", company_guid=CGI, master_id="25684", vch_type="Journal", vch_no="J-2", idsMismatch="yes", lineGuid=GI, heldWhy=long_)])
    lr, p2 = lrow51("I2"), pl("I2")
    ok(c == 200 and lr.get("state") == "held" and p2.get("heldWhy") == long_[:300] and len(lr.get("why", "")) == 300 and lr.get("why") == long_[:300],
       "51-2. a heldWhy over 300 characters: cut to 300 (payload %d, held_why %d)" % (len(p2.get("heldWhy") or ""), len(lr.get("why", ""))))
    ok("idsMismatch" not in p2 and p2.get("lineGuid") == GI, "51-2. idsMismatch \"yes\" (not true): not kept (%s)" % {k: p2.get(k) for k in ("idsMismatch", "lineGuid")})
    c, r = reci([line("I3", "created", CGI + "-00006400", 9002, "20261002", amt=40, company_guid=CGI, master_id="25600")])
    p3 = pl("I3")
    ok(c == 200 and st(r) == {"I3": "applied"} and not any(k in p3 for k in ("idsMismatch", "lineGuid", "heldWhy")),
       "51-3. a normal line: unchanged, applied, no new keys in its payload (%s)" % sorted(p3))
    # 2.2.2 second review L-C: a line carrying lineFid (the bridge moved a copied FinCom id there) never takes fid from its
    # narration's "TDSDesk:<id>"; lineFid kept (80 characters, the FinCom id's characters); a bad lineFid is dropped
    c, r = reci([line("I4", "created", "", None, "20261003", company_guid=CGI, master_id="25690", vch_type="Journal", vch_no="J-4", narration="TDSDesk:fin9 | rent", lineFid="fin9")])
    p4 = pl("I4")
    ok(c == 200 and "fid" not in p4 and "short" not in p4 and p4.get("lineFid") == "fin9",
       "L-C. lineFid fin9 with TDSDesk:fin9 in the narration: no fid taken from the narration, not short, lineFid kept (%s)" % {k: p4.get(k) for k in ("fid", "short", "lineFid")})
    c, r = reci([line("I5", "created", "", None, "20261003", company_guid=CGI, master_id="25691", vch_type="Journal", vch_no="J-5", narration="x", lineFid="bad id!")])
    ok(c == 200 and "lineFid" not in pl("I5"), "L-C. a lineFid outside the FinCom id's characters: not kept (%s)" % pl("I5").get("lineFid"))
    # ---------------------------------------------------------------- 06-Oct-2026, NWS144 line 18: a real TallyPrime 7.1's typed XML
    # Receipt 213 (created, GUID ...-00006729, MasterID 26409, AlterID 54493) sent with Tally's voucher as bridge 2.2.4 sends it
    # (the element of FinComVoucherByMaster's answer, typed: <DATE TYPE="Date">, <ALTERID TYPE="Number"> 54493</ALTERID>,
    # <LEDGERNAME TYPE="String">, <AMOUNT TYPE="Amount">, a bill-wise Agst Ref): stored WITH its body and applied, never held
    # "waiting for the entry's details" with body {}
    tx = open(os.path.join(HERE, "..", "bridge-go", "testdata", "typed-like-7.1", "receipt-213-by-master.xml")).read()
    tx = tx[tx.index("<VOUCHER REMOTEID"):tx.index("</VOUCHER>", tx.index("<VOUCHER REMOTEID")) + 10]
    G213 = CGI + "-00006729"
    c, r = reci([{"line_id": "T213", "event": "created", "saved_at": "2026-10-06T05:50:00+05:30", "pc": "NWS144", "user": "TALLY User", "company_guid": CGI, "object_guid": G213,
                  "master_id": "26409", "alter_id": 54493, "vch_type": "Receipt", "vch_no": "213", "vch_date": "20261006", "xml": tx,
                  "ledgers": [{"name": "Salesify Marketing LLP", "guid": ""}, {"name": "Cash", "guid": ""}]}])
    b213 = json.loads((db.rows("select body::text as b from tally_recorder_lines where book_id = %s and line_id = 'T213'" % q(BI)) or [{}])[0].get("b") or "{}")
    v213 = (b213.get("vouchers") or [{}])[0]
    ok(c == 200 and st(r) == {"T213": "applied"} and len(b213.get("vouchers") or []) == 1 and v213.get("no") == "213" and v213.get("day") == "2026-10-06" and v213.get("alter") == 54493,
       "typed. Receipt 213 with a real TallyPrime 7.1's typed XML (%d characters): applied, its body stored (one voucher, 213 of 06-Oct-2026, AlterID 54493) (%s; %s)" % (len(tx), st(r), v213))
    l213 = sorted([(x[1], x[2], json.dumps(x[5])) for x in (b213.get("lines") or [])])
    ok(l213 == [("Cash", -59000, "[]"), ("Salesify Marketing LLP", 59000, json.dumps([["GSC/2026-27/118", "Agst Ref", 59000, None]]))],
       "typed. its two lines with their signs, the Agst Ref bill on the party's line (%s)" % l213)
    ok(vrow_b(BI, G213).get("alter_id") == "54493" and vrow_b(BI, G213).get("origin") == "tally", "typed. the entry is in the copy (tally_vouchers, AlterID 54493) (%s)" % vrow_b(BI, G213))
    # ---------------------------------------------------------------- FinCom Bridge 2.2.2: the beat answers heldLines
    # the stand-in serves tables from memory: the database's recorder lines and month locks copied in as they are now
    FS.T["tally_recorder_lines"] = [dict(r, device_id=r["device_id"] or None) for r in db.rows(
        "select id, line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date::text as vch_date, book_id::text as book_id, firm_id::text as firm_id, "
        "device_id::text as device_id, bridge, state, to_char(received_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as received_at from tally_recorder_lines order by id")]
    FS.T["tally_month_locks"] = [dict(r, unlocked_at=r["unlocked_at"] or None) for r in db.rows("select book_id::text as book_id, month::text as month, unlocked_at::text as unlocked_at from tally_month_locks")]
    old_ = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 8 * 86400))
    FS.T["tally_recorder_lines"] += [
        {"line_id": "H-OLD", "company": "ZZ IDS", "company_guid": CGI, "event": "created", "master_id": "1", "vch_type": "Journal", "vch_no": "J-9", "vch_date": "2026-10-01",
         "book_id": BI, "firm_id": FIRM, "device_id": DA, "bridge": GA["id"], "state": "held", "received_at": old_},
        {"line_id": "H-B", "company": "ZZ IDS", "company_guid": CGI, "event": "created", "master_id": "2", "vch_type": "Journal", "vch_no": "J-8", "vch_date": "2026-10-01",
         "book_id": BI, "firm_id": FIRM, "device_id": DB_, "bridge": GB["id"], "state": "held", "received_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())},
        {"line_id": "I1:resolved", "company": "ZZ IDS", "company_guid": CGI, "event": "created", "master_id": "25683", "vch_type": "Journal", "vch_no": "J-1", "vch_date": "2026-10-01",
         "book_id": BI, "firm_id": FIRM, "device_id": DA, "bridge": GA["id"], "state": "held", "received_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}]
    c, r = call({"kind": "beat", "version": "2.2.2", "bridge": dict(GA, version="2.2.2"), "tally": True, "open": []})
    hl = r.get("heldLines") or []
    got_ids = [x.get("line_id") for x in hl]
    ok(c == 200 and "I1" in got_ids and "I2" in got_ids and "H-OLD" not in got_ids and "H-B" not in got_ids and "I1:resolved" not in got_ids and "L9" not in got_ids,
       "2.2.2. the beat answers heldLines: this computer's held lines of the last 7 days (I1, I2), not another computer's, not older, not a :resolved one, not a locked month (%s)" % got_ids)
    i1 = next((x for x in hl if x.get("line_id") == "I1"), {})
    ok(set(i1) == {"line_id", "company", "company_guid", "event", "master_id", "vch_type", "vch_no", "vch_date"} and i1.get("master_id") == "25683" and i1.get("vch_date") == "20261001"
       and i1.get("event") == "created" and i1.get("company") == "ZZ IDS" and len(hl) <= 200,
       "2.2.2. each held line: line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date (yyyymmdd), nothing else (%s)" % i1)
    at_ = {x["line_id"]: x["received_at"] for x in FS.T["tally_recorder_lines"]}
    ok([at_[x] for x in got_ids] == sorted(at_[x] for x in got_ids), "2.2.2. oldest first (%s)" % got_ids)
    FS.T.pop("tally_recorder_lines", None)
    c2, r2 = call({"kind": "beat", "version": "2.2.2", "bridge": dict(GA, version="2.2.2"), "tally": True, "open": []})
    ok(c2 == 200 and "heldLines" not in r2, "2.2.2. no held lines: the field left out, the beat answered (%s)" % c2)
    # ---------------------------------------------------------------- 06-Oct-2026 (the owner: "the bridge must ask again for held lines of
    # its own user and settle them"): the beat answers refetch, at most 20 of THIS bridge's own held lines (the same computer key
    # AND the same bridge id) whose body is missing or whose GUID is a placeholder: line_id, company, company_guid, event,
    # master_id, vch_type, vch_no, vch_date. The bridge asks its own Tally again and sends "<line id>:resolved" with Tally's
    # GUID, AlterID and body; the database replaces the held line and applies the entry once (migrations 50-52)
    GC = dict(GB, id="go-cccccc333333", computer="PC-A", user="other")      # another Windows user's bridge on PC-A's key
    reci2 = lambda lines, key=KA, bridge=GA: call({"kind": "recorder_lines", "company": "ZZ IDS", "version": "2.3.1", "bridge": dict(bridge, version="2.3.1"), "lines": lines}, key)
    G18 = CGI + "-0000672a"
    base = {"saved_at": "2026-10-06T05:50:00+05:30", "pc": "NWS144", "user": "TALLY User", "company_guid": CGI, "ledgers": []}
    c, r = reci2([dict(base, line_id="R18", event="created", object_guid=G18, master_id="26410", alter_id=54494, vch_type="Receipt", vch_no="214", vch_date="20261006"),
                  dict(base, line_id="R4", event="altered", object_guid=CGI + "-00000000", master_id="26312", alter_id=0, vch_type="Receipt", vch_no="192", vch_date="20261005"),
                  dict(base, line_id="R17", event="created", object_guid="", master_id="", alter_id=None, vch_type="Receipt", vch_no="212", vch_date="20261005",
                       heldWhy="not found by its type and number (asked 3 times)")])
    ok(c == 200 and st(r) == {"R18": "held", "R4": "held", "R17": "held"}, "refetch. lines like staging's 18 (no body), 4 (placeholder GUID, AlterID 0) and 17 (no GUID, no MasterID): held (%s)" % st(r))
    c, r = reci2([dict(base, line_id="RX", event="created", object_guid=CGI + "-0000672b", master_id="26411", alter_id=54495, vch_type="Receipt", vch_no="215", vch_date="20261006")], KA, GC)
    c2, r2 = reci2([dict(base, line_id="RY", event="created", object_guid=CGI + "-0000672c", master_id="26412", alter_id=54496, vch_type="Receipt", vch_no="216", vch_date="20261006")], KB, GB)
    ok(st(r) == {"RX": "held"} and st(r2) == {"RY": "held"}, "refetch. another user's bridge on the same key (RX) and another computer (RY): held too (%s %s)" % (st(r), st(r2)))
    def mem_rows():
        FS.T["tally_recorder_lines"] = [dict(r, device_id=r["device_id"] or None, body=json.loads(r["body"]) if r["body"] else None, object_guid=r["object_guid"] or None) for r in db.rows(
            "select id, line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date::text as vch_date, book_id::text as book_id, firm_id::text as firm_id, "
            "device_id::text as device_id, bridge, state, object_guid, body::text as body, to_char(received_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as received_at from tally_recorder_lines order by id")]
    mem_rows()
    c, r = call({"kind": "beat", "version": "2.3.1", "bridge": dict(GA, version="2.3.1"), "tally": True, "open": []})
    rf = r.get("refetch") or []
    ids = [x.get("line_id") for x in rf]
    ok(c == 200 and {"R18", "R4", "R17"} <= set(ids) and not {"RX", "RY", "T213", "I3", "R18:resolved"} & set(ids) and len(rf) <= 20,
       "refetch. the beat answers this bridge's own held lines without a body or with a placeholder GUID (R18, R4, R17); never another user's bridge (RX) or computer (RY), never an applied line (%s)" % ids)
    r4 = next((x for x in rf if x.get("line_id") == "R4"), {}); r17 = next((x for x in rf if x.get("line_id") == "R17"), {})
    ok(set(r4) == {"line_id", "company", "company_guid", "event", "master_id", "vch_type", "vch_no", "vch_date"} and r4.get("master_id") == "26312" and r4.get("event") == "altered"
       and r4.get("vch_date") == "20261005" and r17.get("master_id") == "" and r17.get("vch_no") == "212" and r17.get("vch_type") == "Receipt",
       "refetch. each row: line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date (R4 %s; R17 %s)" % (r4, r17))
    c, r = call({"kind": "beat", "version": "2.3.1", "bridge": dict(GC, version="2.3.1"), "tally": True, "open": []})
    idc = [x.get("line_id") for x in (r.get("refetch") or [])]
    ok(c == 200 and "RX" in idc and not {"R18", "R4", "R17"} & set(idc), "refetch. the other user's bridge on the same key gets its own line only (%s)" % idc)
    now_ = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    FS.T["tally_recorder_lines"] += [{"id": 90000 + i, "line_id": "M%02d" % i, "company": "ZZ IDS", "company_guid": CGI, "event": "created", "master_id": str(30000 + i), "vch_type": "Journal",
                                      "vch_no": "", "vch_date": "2026-10-05", "book_id": BI, "firm_id": FIRM, "device_id": DA, "bridge": GA["id"], "state": "held", "object_guid": None, "body": None,
                                      "received_at": now_} for i in range(25)]
    c, r = call({"kind": "beat", "version": "2.3.1", "bridge": dict(GA, version="2.3.1"), "tally": True, "open": []})
    ok(c == 200 and len(r.get("refetch") or []) == 20 and len(r.get("heldLines") or []) > 20, "refetch. at most 20 a beat (%d; heldLines %d)" % (len(r.get("refetch") or []), len(r.get("heldLines") or [])))
    # the bridge's answer for R18: "R18:resolved" with Tally's own GUID, AlterID and (typed) body -> applied, R18 replaced, once
    x18 = tx.replace("-00006729", "-0000672a").replace("> 26409<", "> 26410<").replace("> 54493<", "> 54494<").replace("<VOUCHERNUMBER>213<", "<VOUCHERNUMBER>214<")
    n0 = nI()
    c, r = reci2([dict(base, line_id="R18:resolved", event="created", object_guid=G18, master_id="26410", alter_id=54494, vch_type="Receipt", vch_no="214", vch_date="20261006", xml=x18)])
    s18 = (db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where book_id = %s and line_id = 'R18'" % q(BI)) or [{}])[0]
    ok(c == 200 and st(r) == {"R18:resolved": "applied"} and s18.get("state") == "replaced" and s18.get("why", "").startswith("replaced by line ") and int(nI()) == int(n0) + 1 and vrow_b(BI, G18).get("alter_id") == "54494",
       "refetch. R18:resolved with Tally's typed body: applied, R18 'replaced', the entry in the copy once (%s; %s; %s -> %s)" % (st(r), s18, n0, nI()))
    c, r = reci2([dict(base, line_id="R18:resolved", event="created", object_guid=G18, master_id="26410", alter_id=54494, vch_type="Receipt", vch_no="214", vch_date="20261006", xml=x18)])
    ok(c == 200 and st(r).get("R18:resolved") in ("duplicate",) and int(nI()) == int(n0) + 1, "refetch. the same :resolved line again: duplicate, applied once (%s)" % st(r))
    mem_rows()
    c, r = call({"kind": "beat", "version": "2.3.1", "bridge": dict(GA, version="2.3.1"), "tally": True, "open": []})
    ids = [x.get("line_id") for x in (r.get("refetch") or [])]
    ok(c == 200 and "R18" not in ids and "R4" in ids, "refetch. once replaced, R18 is not asked for again (%s)" % ids)
    FS.T.pop("tally_recorder_lines", None)
finally:
    if fn: fn.terminate()
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
