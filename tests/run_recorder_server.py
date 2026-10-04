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
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql")]
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
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    def rpc(name, a):
        if name in ("tally_recorder_apply", "tally_start_point", "tally_recorder_gap_check"):
            FS.ARGS.setdefault(name, []).append(a)
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
    ok(st(r) == {"L9": "held", "L10": "failed", "L11": "held"} and "month locked" in str(res.get("L9", {}).get("why")) and vrow("v4") == {} and "GUID" in str(res.get("L11", {}).get("why")),
       "a locked month: held; an unknown event: failed; no GUID: held, never a new row (%s)" % st(r))
    ok(db.one("select count(*) from tally_recorder_lines where line_id = 'L10'") == "0" and r.get("applied") == 0 and r.get("held") == 2 and r.get("failed") == 1, "the unknown event is not stored; the counts answered")
    # ---- the gap: PC A's lines reach 50 (start 40); PC B says 53 without the add-on
    c, r = rec([line("L12", "created", "v6", 50, amt=5)])
    beat = lambda key, bridge, alt, seen, at: call({"kind": "beat", "version": "2.2.0", "bridge": bridge, "tally": True, "open": ["ZZ CO"],
                                                    "companies": [{"name": "ZZ CO", "open": True, "altvchid": alt, "altmstid": 9, "at": at, "recorderSeen": seen, "recorderLastAt": "2026-10-04T10:00:00+05:30" if seen else ""}]}, key)
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
finally:
    if fn: fn.terminate()
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
