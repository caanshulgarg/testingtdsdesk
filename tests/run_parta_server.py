"""python3 run_parta_server.py - (06-Oct-2026, FinCom Bridge 2.3.1 part A: "item invoices enter complete") tally-ingest's
kind "recorder_lines" through the real cloud function (server/tally-cloud/index.ts) under Deno, against the stand-in for
Supabase (fake_supabase.py) whose recorder functions are answered by a throwaway PostgreSQL (pg_stand, port 30576) built in
staging's order 32 -> ... -> 56 -> 57. The bodies are the part A fixtures (bridge-go/testdata/typed-like-7.1/partA-*.xml,
typed as TallyPrime 7.1 answers; NOT captured from a real Tally), sent as the bridge sends an entry's body (the line's xml).
Checks (the owner's accuracy rules of 06-Oct-2026: "an entry applies only if its lines total zero; item lines' taxable value
plus tax must equal the ledger lines for that invoice; bill-wise and cost centre allocations must add up to their line's
amount; if any check fails, hold the line with plain words; never apply part of an entry"):
  1. the sales invoice with two items at 18% and 5%: applied; its item lines (item, qty, unit, rate, taxable, HSN, GST rate,
     CGST / SGST), the e-invoice IRN and acknowledgement and the e-way bill number stored; no check notes.
  2. the bank payment with a UTR, the payment with TDS, the journal with cost centres: applied with their details.
  3. the owner's rule after review (06-Oct-2026): an entry is HELD only when its ledger lines do not total zero; every other
     mismatch APPLIES the entry with a plain-words note (tally_vouchers.check_notes, and the line's payload checkNotes for
     Sync activity): freight carrying GST with no item line, a round-off line, a discount line, a tax-inclusive item value, a
     bill-wise detail not adding up to its line; lines not totalling zero: held, nothing applied.
  2b. one sales invoice with 50 items (partA-sales-50-items.xml): applied with its 50 item lines.
  4. a delete line for an entry never in FinCom's copy: settles by itself, "nothing to remove ...", kept visible.
  5. the owner's "full" (06-Oct-2026: "let blanks through for every field the 2.3.1 request fetches in full; keep the guard
     only for lines from a bridge older than 2.3.1 that did not ask for the field"): a body the bridge marks "full": true
     (its 2.3.1 entry request fetched party GSTIN, place of supply, ref, ref date, company GSTIN and the lines' HSN and rate)
     with a blank GSTIN and HSN blanks the stored values; the same body without the marker (a 2.3.0 bridge) keeps them
     (migration 56's keep); a Day Book upload is as before (authoritative: what it says is stored, blanks too).
The Deno function listens on port 30579 (Deno.serve wrapped by a one-line module in a temporary folder) and the stand-in on
30578, so this test runs beside the others. Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, re, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading, tempfile, gzip, base64
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FIXDIR = os.path.join(HERE, "..", "bridge-go", "testdata", "typed-like-7.1")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
                                           "migration-56-keep-fields.sql", "migration-57-entry-details.sql")]
FN_PORT, FS.PORT = 30579, 30578
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, BOOK, OWNER = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", "55555555-5555-5555-5555-555555555555"
DA, KA = "d1000000-0000-0000-0000-000000000001", "fcd_" + "a" * 48
GA = {"id": "go-aaaaaa231231", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.3.1"}
CG = "226fb516-9d2d-45ad-ad78-304d86b64500"
G = lambda mid: CG + "-%08x" % mid
fx = lambda f: open(os.path.join(FIXDIR, f)).read()
db = pg_stand.start(30576)
fn, tmp = None, tempfile.mkdtemp(prefix="fincom-parta-")
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'); insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'FinCom Spike Co', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(A)s, %(F)s, 'PC-A', 'ha', '2.3.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(FIRM), "O": q(OWNER), "B": q(BOOK), "A": q(DA)})
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    def rpc(name, a):
        if name in ("tally_recorder_apply", "tally_start_point", "tally_recorder_gap_check", "tally_recorder_short_held", "tally_recorder_short_retry", "tally_recorder_enqueue", "tally_recorder_send", "tally_ingest_day"):
            FS.ARGS.setdefault(name, []).append(a)
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))))
            except RuntimeError as e: raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": "FinCom Spike Co", "client_id": "c1", "book_id": BOOK})
    FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-A", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.1"})
    FS.start()
    wrap = os.path.join(tmp, "serve.ts")
    open(wrap, "w").write("const s = Deno.serve; (Deno as any).serve = (h: any) => s({ port: %d, hostname: \"127.0.0.1\" }, h);\nawait import(%s);\n"
                          % (FN_PORT, json.dumps("file://" + os.path.abspath(os.path.join(SQLDIR, "index.ts")))))
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", wrap], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    URL = "http://127.0.0.1:%d/" % FN_PORT
    def call(body, key=KA):
        rq = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    for i in range(240):
        try: urllib.request.urlopen(URL, timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    else: raise SystemExit("the function did not start: " + "".join(log)[-1500:])
    def line(lid, mid, alter, vtype, xml=None, event="created"):
        x = {"line_id": lid, "event": event, "saved_at": "2026-10-06T10:00:00+05:30", "pc": "PC-A", "user": "anshul", "company_guid": CG, "object_guid": G(mid), "master_id": str(mid),
             "alter_id": alter, "vch_type": vtype, "vch_no": (re.search(r"<VOUCHERNUMBER>([^<]*)<", xml or "") or [None, str(mid)])[1], "vch_date": "20261002", "ledgers": [], "save_ms": 8}
        if xml is not None: x["xml"] = xml
        return x
    rec = lambda lines: call({"kind": "recorder_lines", "company": "FinCom Spike Co", "version": "2.3.1", "bridge": GA, "lines": lines})
    res = lambda r: {x.get("line_id"): x for x in (r.get("results") or [])}
    one = lambda s: db.one(s)
    vrow = lambda g: (db.rows("select irn, irn_ack_no, coalesce(irn_ack_date::text, '') as ack, eway_no, check_notes::text as checks, gstin, pos, ref, coalesce(ref_date::text, '') as ref_date from tally_vouchers where book_id = %s and guid = %s" % (q(BOOK), q(g))) or [{}])[0]
    items = lambda g: [tuple(r.values()) for r in db.rows("select item, qty::text, unit, rate::text, taxable::text, hsn, gst_rate::text, cgst::text, sgst::text, igst::text from tally_item_lines where book_id = %s and guid = %s and gone_at is null order by line_no" % (q(BOOK), q(g)))]

    print("== 1. the sales invoice, two items at 18% and 5%")
    c, r = rec([line("A1", 21, 41, "Sales", fx("partA-sales-two-rates.xml"))])
    ok(c == 200 and res(r).get("A1", {}).get("state") == "applied", "applied (%s %s)" % (c, res(r).get("A1")))
    it = items(G(21))
    N = lambda t: tuple(float(x) if i in (1, 3, 4, 6, 7, 8, 9) else x for i, x in enumerate(t))
    ok([N(t) for t in it] == [("Widget A", 10.0, "Nos", 200.0, 2000.0, "8471", 18.0, 180.0, 180.0, 0.0), ("Rice B", 20.0, "Kg", 50.0, 1000.0, "1006", 5.0, 25.0, 25.0, 0.0)],
       "its two item lines: item, qty, unit, rate, taxable, HSN, GST rate, CGST / SGST per line, IGST none (%s)" % it)
    v = vrow(G(21))
    ok(v.get("irn", "").startswith("a5c12dca") and v.get("irn_ack_no") == "112610020345678" and v.get("ack") == "2026-10-02" and v.get("eway_no") == "381001234567" and v.get("checks") == "[]",
       "the e-invoice IRN and acknowledgement, the e-way bill number; no check notes (%s)" % v)
    ok(v.get("gstin") == "07AAJFQ3158R1ZH" and v.get("pos") == "Delhi" and v.get("ref") == "PO-88" and v.get("ref_date") == "2026-09-30", "party GSTIN, place of supply, reference and its date stored from the live route (%s)" % v)
    ok(one("select coalesce(sum(amount), 0) from tally_lines where book_id = %s and guid = %s" % (q(BOOK), q(G(21)))) in ("0", "0.00"), "its ledger lines total zero")

    print("== 2. bank payment with a UTR, payment with TDS, journal with cost centres")
    c, r = rec([line("A2", 27, 47, "Payment", fx("partA-bank-payment-utr.xml")), line("A3", 25, 45, "Payment", fx("partA-payment-tds.xml")), line("A4", 26, 46, "Journal", fx("partA-journal-cost-centres.xml"))])
    st = {k: x.get("state") for k, x in res(r).items()}
    ok(st == {"A2": "applied", "A3": "applied", "A4": "applied"}, "all three applied (%s)" % st)
    ok(one("select count(*) from tally_bank_allocs where book_id = %s and guid = %s and gone_at is null and instrument_no <> ''" % (q(BOOK), q(G(27)))) == "1", "the bank line's UTR stored")
    ok(int(one("select count(*) from tally_tds_lines where book_id = %s and guid = %s and gone_at is null" % (q(BOOK), q(G(25))))) >= 1, "the TDS details stored")
    ok(int(one("select count(*) from tally_cost_allocs where book_id = %s and guid = %s and gone_at is null" % (q(BOOK), q(G(26))))) >= 2, "the cost centre allocations stored")

    print("== 2b. one invoice with 50 items")
    c, r = rec([line("A8", 28, 48, "Sales", fx("partA-sales-50-items.xml"))])
    ok(res(r).get("A8", {}).get("state") == "applied" and one("select count(*) from tally_item_lines where book_id = %s and guid = %s and gone_at is null" % (q(BOOK), q(G(28)))) == "50",
       "applied with its 50 item lines (%s)" % res(r).get("A8"))

    print("== 3. the owner's accuracy rule (06-Oct-2026, after review): HELD only when the lines do not total zero; every other mismatch APPLIES with a note")
    SALE = fx("partA-sales-two-rates.xml")
    def le(name, amount, debit):
        return ('<ALLLEDGERENTRIES.LIST><LEDGERNAME TYPE="String">%s</LEDGERNAME><ISDEEMEDPOSITIVE TYPE="Logical">%s</ISDEEMEDPOSITIVE>'
                '<AMOUNT TYPE="Amount">%s</AMOUNT><BILLALLOCATIONS.LIST>      </BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>\n     ' % (name, "Yes" if debit else "No", amount))
    def sale(mid, party=None, cgst=None, extra="", item_amt=None):
        x = SALE.replace(G(21), G(mid)).replace("> 41</ALTERID>", "> %d</ALTERID>" % (mid + 30))
        if party: x = x.replace('<AMOUNT TYPE="Amount">-3410.00</AMOUNT>', '<AMOUNT TYPE="Amount">%s</AMOUNT>' % party, 1).replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>%s</AMOUNT>" % party, 1)
        if cgst: x = x.replace('<AMOUNT TYPE="Amount">205.00</AMOUNT>', '<AMOUNT TYPE="Amount">%s</AMOUNT>' % cgst[0], 1).replace('<AMOUNT TYPE="Amount">205.00</AMOUNT>', '<AMOUNT TYPE="Amount">%s</AMOUNT>' % cgst[1], 1)
        if extra: x = x.replace("<ALLINVENTORYENTRIES.LIST>", extra + "<ALLINVENTORYENTRIES.LIST>", 1)
        if item_amt: x = x.replace('<RATE TYPE="Rate">200.00/Nos</RATE>\n      <AMOUNT TYPE="Amount">2000.00</AMOUNT>', '<RATE TYPE="Rate">236.00/Nos</RATE>\n      <AMOUNT TYPE="Amount">%s</AMOUNT>' % item_amt, 1)
        return x
    notes = lambda g: json.loads(one("select check_notes::text from tally_vouchers where book_id = %s and guid = %s" % (q(BOOK), q(g))) or "null")
    nlines = lambda g: int(one("select count(*) from tally_lines where book_id = %s and guid = %s" % (q(BOOK), q(g))))
    total = lambda g: float(one("select coalesce(sum(amount), 0) from tally_lines where book_id = %s and guid = %s" % (q(BOOK), q(g))))
    cases = [
        ("freight carrying GST, no item line for it", "A5", 49, sale(49, party="-3528.00", cgst=("214.00", "214.00"), extra=le("Freight Outward", "100.00", False)), "the GST worked out on the items"),
        ("a round-off line", "A6", 50, sale(50, party="-3410.40", extra=le("Round Off", "0.40", False)), None),
        ("a discount line", "A12", 53, sale(53, party="-3310.00", extra=le("Discount Allowed", "-100.00", True)), None),
        ("a tax-inclusive item value (worked-out tax and the item's ledger line differ)", "A13", 54, sale(54, item_amt="2360.00"), "taxable value"),
        ("a bill-wise detail not adding up to its line", "A14", 55, SALE.replace(G(21), G(55)).replace("> 41</ALTERID>", "> 85</ALTERID>").replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>-3000.00</AMOUNT>", 1), "bill-wise details"),
    ]
    for what, lid, mid, x, word in cases:
        c, r = rec([line(lid, mid, mid + 30, "Sales", x)])
        st_ = res(r).get(lid, {})
        nt = notes(G(mid)) or []
        ok(st_.get("state") == "applied" and nlines(G(mid)) >= 4 and abs(total(G(mid))) < 0.005 and one("select count(*) from tally_vouchers where guid = %s and deleted_at is null" % q(G(mid))) == "1",
           "%s: APPLIED, its lines in the books totalling zero (%s; %s lines)" % (what, st_, nlines(G(mid))))
        if word:
            ok(any(word in n for n in nt) and one("select (payload->'checkNotes' is not null)::text from tally_recorder_lines where line_id = %s" % q(lid)) == "true",
               "%s: the mismatch kept as a note for a person (check_notes and the line's payload): %s" % (what, nt))
    print("== 3b. lines not totalling zero: HELD, nothing applied")
    bad = SALE.replace(G(21), G(56)).replace('<AMOUNT TYPE="Amount">205.00</AMOUNT>', '<AMOUNT TYPE="Amount">215.00</AMOUNT>', 1)
    c, r = rec([line("A15", 56, 86, "Sales", bad)])
    x = res(r).get("A15", {})
    ok(x.get("state") == "held" and "do not add up" in str(x.get("why")), "an entry whose lines do not total zero: held with plain words (%s)" % x.get("why"))
    ok(one("select count(*) from tally_vouchers where guid = %s" % q(G(56))) == "0" and one("select count(*) from tally_lines where guid = %s" % q(G(56))) == "0"
       and one("select count(*) from tally_item_lines where guid = %s" % q(G(56))) == "0", "nothing of it applied (no entry, no line, no item line)")
    ok(bool(x.get("why")) and one("select held_why from tally_recorder_lines where line_id = 'A15'") == x.get("why"), "the words kept on the line (held_why)")

    print("== 4. a delete of an entry never in FinCom's copy")
    c, r = rec([line("A7", 77, 60, "Sales", None, "deleted")])
    x = res(r).get("A7", {})
    ok(x.get("state") == "applied" and "nothing to remove" in str(x.get("why") or one("select coalesce(held_why, '') || coalesce(payload->>'why', '') from tally_recorder_lines where line_id = 'A7'")),
       "settles by itself: nothing to remove (%s)" % x)
    ok(one("select count(*) from tally_recorder_lines where line_id = 'A7'") == "1", "the line kept, visible")

    print("== 5. the owner's \"full\": a 2.3.1 body passes blanks as sent; a 2.3.0 body keeps them; a Day Book as before")
    GST = '<PARTYGSTIN TYPE="String">07AAJFQ3158R1ZH</PARTYGSTIN>'
    def body(alt, blank):
        x = fx("partA-sales-two-rates.xml").replace("> 41</ALTERID>", "> %d</ALTERID>" % alt)
        if blank: x = re.sub(r'(<GSTHSNNAME TYPE="String">)[^<]*(</GSTHSNNAME>)', r"\1\2", x.replace(GST, '<PARTYGSTIN TYPE="String"></PARTYGSTIN>'))
        return x
    hsn = lambda: sorted((r["ledger"], r["hsn"] or "") for r in db.rows("select ledger, hsn from tally_lines where book_id = %s and guid = %s" % (q(BOOK), q(G(21)))))
    h0 = hsn()
    ok(vrow(G(21)).get("gstin") == "07AAJFQ3158R1ZH" and any(h for _, h in h0), "before: the sales invoice holds its GSTIN and a line HSN (%s)" % h0)
    c, r = rec([line("A9", 21, 42, "Sales", body(42, True), "altered")])
    ok(res(r).get("A9", {}).get("state") == "applied" and vrow(G(21)).get("gstin") == "07AAJFQ3158R1ZH" and hsn() == h0,
       "a body without the marker (a 2.3.0 bridge) with a blank GSTIN and HSN: applied, the stored GSTIN and HSN kept (%s; %s)" % (res(r).get("A9"), hsn()))
    c, r = rec([dict(line("A10", 21, 43, "Sales", body(43, True), "altered"), full=True)])
    ok(res(r).get("A10", {}).get("state") == "applied" and vrow(G(21)).get("gstin") == "" and not any(h for _, h in hsn()),
       "a 2.3.1 body marked full with a blank GSTIN and HSN: applied, the stored GSTIN and HSN blank as Tally has them (%s; %s; %s)" % (res(r).get("A10"), vrow(G(21)).get("gstin"), hsn()))
    ok(one("select count(*) from tally_recorder_lines where line_id = 'A10' and body->'vouchers'->0->>'full' = 'true'") == "1"
       and one("select count(*) from tally_recorder_lines where line_id = 'A9' and body->'vouchers'->0 ? 'full'") == "0", "the marker on the 2.3.1 body only (A10 full, A9 none)")
    c, r = rec([dict(line("A11", 21, 44, "Sales", None, "altered"), full=True)])
    ok(one("select count(*) from tally_recorder_lines where line_id = 'A11' and body->'vouchers'->0 ? 'full'") == "0", "the marker without a body: nothing marked")
    day = lambda x: call({"kind": "days", "version": "2.3.1", "bridge": GA, "company": "FinCom Spike Co", "days": [{"day": "20261002", "n": 1, "gz": base64.b64encode(gzip.compress(x.encode())).decode()}]})
    c, r = day(body(45, False))
    ok(c == 200 and vrow(G(21)).get("gstin") == "07AAJFQ3158R1ZH" and hsn() == h0, "a Day Book with the GSTIN and HSN: stored as before (%s; %s)" % (c, vrow(G(21)).get("gstin")))
    c, r = day(body(46, True))
    ok(c == 200 and vrow(G(21)).get("gstin") == "" and not any(h for _, h in hsn()), "a Day Book with them blank: blank, as before (authoritative) (%s; %s)" % (c, hsn()))
finally:
    if fn: fn.terminate()
    db.stop(); shutil.rmtree(tmp, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
