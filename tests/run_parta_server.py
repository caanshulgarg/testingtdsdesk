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
  3. the same sales invoice with its CGST line 10 rupees more (the party line too, so the lines still total zero): held with
     plain words (the GST worked out on the items does not match the GST ledger lines), nothing of it applied (no entry, no
     line, no item line); a bill-wise detail that does not add up to its line: held the same way.
  2b. one sales invoice with 50 items (partA-sales-50-items.xml): applied with its 50 item lines.
  4. a delete line for an entry never in FinCom's copy: settles by itself, "nothing to remove ...", kept visible.
The Deno function listens on port 30579 (Deno.serve wrapped by a one-line module in a temporary folder) and the stand-in on
30578, so this test runs beside the others. Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, re, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading, tempfile
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
        if name in ("tally_recorder_apply", "tally_start_point", "tally_recorder_gap_check", "tally_recorder_short_held", "tally_recorder_short_retry", "tally_recorder_enqueue", "tally_recorder_send"):
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

    print("== 3. the accuracy checks hold the line with plain words; nothing of the entry applied")
    bad = fx("partA-sales-two-rates.xml").replace(G(21), G(49)).replace("<AMOUNT TYPE=\"Amount\">205.00</AMOUNT>", "<AMOUNT TYPE=\"Amount\">215.00</AMOUNT>", 1) \
        .replace("<AMOUNT TYPE=\"Amount\">-3410.00</AMOUNT>", "<AMOUNT TYPE=\"Amount\">-3420.00</AMOUNT>", 1).replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>-3420.00</AMOUNT>", 1)
    c, r = rec([line("A5", 49, 51, "Sales", bad)])
    x = res(r).get("A5", {})
    ok(x.get("state") == "held" and "the GST worked out on the items" in str(x.get("why")) and "nothing of it applied" in str(x.get("why")), "item tax not matching the GST ledger lines: held with plain words (%s)" % x.get("why"))
    ok(one("select count(*) from tally_vouchers where guid = %s" % q(G(49))) == "0" and one("select count(*) from tally_lines where guid = %s" % q(G(49))) == "0"
       and one("select count(*) from tally_item_lines where guid = %s" % q(G(49))) == "0", "nothing of the held entry applied (no entry, no line, no item line)")
    bill = fx("partA-sales-two-rates.xml").replace(G(21), G(50)).replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>-3000.00</AMOUNT>", 1)
    c, r = rec([line("A6", 50, 52, "Sales", bill)])
    x = res(r).get("A6", {})
    ok(x.get("state") == "held" and "bill-wise details" in str(x.get("why")) and one("select count(*) from tally_vouchers where guid = %s" % q(G(50))) == "0", "bill-wise not adding up to its line: held, nothing applied (%s)" % x.get("why"))
    ok(bool(x.get("why")) and one("select held_why from tally_recorder_lines where line_id = 'A6'") == x.get("why"), "the words kept on the line (held_why)")

    print("== 4. a delete of an entry never in FinCom's copy")
    c, r = rec([line("A7", 77, 60, "Sales", None, "deleted")])
    x = res(r).get("A7", {})
    ok(x.get("state") == "applied" and "nothing to remove" in str(x.get("why") or one("select coalesce(held_why, '') || coalesce(payload->>'why', '') from tally_recorder_lines where line_id = 'A7'")),
       "settles by itself: nothing to remove (%s)" % x)
    ok(one("select count(*) from tally_recorder_lines where line_id = 'A7'") == "1", "the line kept, visible")
finally:
    if fn: fn.terminate()
    db.stop(); shutil.rmtree(tmp, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
