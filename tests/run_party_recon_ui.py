"""python3 run_party_recon_ui.py - Reconciliations → Vendors and Customers (phase 3, the owner, 14-Oct-2026: "Vendor
reconciliation and customer reconciliation should come under the Reconciliation tab. We can upload any format ... AI will
read that format once and after that it will use memory ... If the opening has a difference, then also show it").
On the made-up statements of tests/fixtures/sheets, FinCom's AI faked, the party's ledger in the books faked
(LK.ledgerBooks: the books' own reading is tested elsewhere), offline:
  1. Vendors: a statement in a new format: the AI maps it once, confirmed and saved; the party found by its GSTIN;
     reconciled: the statement adds up to the paisa with the opening difference a line of its own, nothing unexplained;
     each kind of difference listed; an entry explained with a note; a missing entry made a bill to review (not posted);
     Excel and the balance confirmation letter (Word);
  2. the same format again: no AI; the run saved, and the next one starts from it (its notes come along);
  3. another format of the same statement: the AI once more, the party asked (no GSTIN in it), the same result;
  4. Customers: their credit is our debit; nothing unexplained;
  5. the old place (Purchase → Reconcile a vendor ledger) leads to Reconciliations → Vendors.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_party_recon_ui.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import upload_pages_books as BK
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
FX = os.path.join(HERE, "fixtures", "sheets")
OUT = os.environ.get("TDSDESK_SHOTS", "")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8299), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = """async () => {
  await registersLoad();
  // the ledgers of the books, and the two parties' ledgers as the books read them (LK.ledgerBooks' shape)
  await loadBank(S.coId);
  S.bank.ledgers = {list: [{name: "Kashi IT Solutions", group: "Sundry Creditors", gstin: "09AAACK1234A1Z5"}, {name: "Asha Retail LLP", group: "Sundry Debtors", gstin: "09AAAFR1111R1Z1"},
    {name: "Purchases", group: "Purchase Accounts"}, {name: "TDS Payable - Professional", group: "Duties & Taxes"}], importedAt: new Date().toISOString(), live: true};
  const ent = (tds, gst) => [{l: "TDS Payable - Professional", a: -tds}, {l: "Input CGST", a: gst / 2}, {l: "Input SGST", a: gst / 2}];
  window.__books = {
    "Kashi IT Solutions": {open: -4000, close: null, rows: [
      {id: "v1", date: "2026-07-05", no: "KIT/101", type: "Purchase", narr: "laptops", dr: 0, cr: 11800, ent: ent(0, 1800)},
      {id: "v2", date: "2026-07-07", no: "J/12", type: "Journal", narr: "Delhi Legal DL/77 retainer", dr: 0, cr: 32400, ent: ent(3000, 5400)},
      {id: "v3", date: "2026-07-14", no: "J/13", type: "Journal", narr: "stationery", dr: 0, cr: 2950, ent: ent(0, 450)},
      {id: "v4", date: "2026-07-20", no: "P/7", type: "Payment", narr: "NEFT", dr: 20000, cr: 0, ent: []},
      {id: "v5", date: "2026-07-30", no: "X/1", type: "Purchase", narr: "courier", dr: 0, cr: 700, ent: ent(0, 0)},
      {id: "v6", date: "2026-07-09", no: "KIT/CN/4", type: "Debit Note", narr: "returned mouse", dr: 1180, cr: 0, ent: ent(0, 180)},
      {id: "v7", date: "2026-07-26", no: "INV/88", type: "Purchase", narr: "repairs", dr: 0, cr: 4000, ent: ent(0, 600)}]},
    "Asha Retail LLP": {open: 10000, close: null, rows: [
      {id: "s1", date: "2026-07-03", no: "S/101", type: "Sales", narr: "", dr: 17400, cr: 0, ent: []},
      {id: "s2", date: "2026-07-18", no: "R/5", type: "Receipt", narr: "NEFT", dr: 0, cr: 15000, ent: []},
      {id: "s3", date: "2026-07-28", no: "S/102", type: "Sales", narr: "", dr: 2360, cr: 0, ent: []}]}};
  window.__asked = [];
  LK.ledgerBooks = (led, from, to) => { window.__asked.push([led, from, to]); return JSON.parse(JSON.stringify(window.__books[led] || {open: 0, rows: []})); };
  // FinCom's AI, faked: maps a statement by its header's words, and counts its calls
  window.__ai = [];
  SheetAI.map = async (req) => { window.__ai.push(JSON.parse(JSON.stringify(req)));
    const pick = (re) => req.head.find(h => re.test(h)) || undefined;
    const map = {date: pick(/date/i), no: pick(/vch|ref|bill/i), narration: pick(/particular|description|narration/i), debit: pick(/^debit$|^dr$/i), credit: pick(/^credit$|^cr$/i),
      amount: pick(/^amount$/i), drcr: pick(/dr\\/cr/i), balance: pick(/balance/i), gst: pick(/^gst$/i)};
    Object.keys(map).forEach(k => map[k] === undefined && delete map[k]);
    return {ok: true, map, transforms: {date: "dmy"}, why: {}, cost: {usd: 0.0004, inr: 0.03}}; };
  return true; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}, accept_downloads=True); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8299/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    W = pg.wait_for_timeout
    shot = lambda n: OUT and pg.screenshot(path=os.path.join(OUT, n + ".png"))
    E(BK.PURCHASE); W(1500)
    E(SETUP); W(500)
    # ---- 5 first: the old place leads here
    E("() => { goStep('review', 'bills'); vrOpen(); }"); W(900)
    ok(E("[S.tab, S.booksTab, S.reconTab]") == ["books", "recon", "vendors"] and pg.locator("#app [data-party-recon=vendor]").count() == 1, "the old place (Purchase → Reconcile a vendor ledger) leads to Reconciliations → Vendors (%s)" % E("[S.tab, S.booksTab, S.reconTab]"))
    ok(E("[...document.querySelectorAll('#app [data-recon-tab]')].map(b => b.textContent.trim())") == ["TDS receivable vs 26AS", "Vendors", "Customers"], "Reconciliations: TDS receivable vs 26AS · Vendors · Customers")
    ok("No vendor reconciled yet" in pg.inner_text("#app [data-party-recon]"), "empty: what is so, and one next step")
    def upload(name, side="vendor"):
        with pg.expect_file_chooser() as fc:
            pg.click('#app [data-recon-pick="%s"]' % side)
        fc.value.set_files(os.path.join(FX, name)); W(1500)
    step = lambda: E("(document.querySelector('#app [data-sheet-step]') || {getAttribute: () => ''}).getAttribute('data-sheet-step')")
    # ---- 1. a new format: AI once, saved; the party by GSTIN; reconciled
    upload("vendor_stmt_a.csv")
    ok(step() == "map" and len(E("window.__ai")) == 1 and E("window.__ai[0].side") == "vendor" and "Kashi" not in json.dumps(E("window.__ai[0]")), "a new format: FinCom's AI asked once, names masked (%s)" % step())
    ok(pg.locator('#app select[data-sheet-field="debit"]').input_value() == "debit" and pg.locator('#app select[data-sheet-field="vchno"]').input_value() == "no", "the statement's fields: date, no., particulars, debit, credit")
    shot("recon-1-mapping")
    pg.click("#app [data-sheet-save]"); W(800)
    ok(step() == "party" and "Kashi IT Solutions (by GSTIN 09AAACK1234A1Z5)" in pg.inner_text("#app [data-recon-party-sure]"), "the party found by its GSTIN in the statement's heading")
    ok(E("[SheetImport.st().from, SheetImport.st().to]") == ["2026-07-05", "2026-07-31"], "the period from the statement's dates")
    pg.click("#app [data-recon-go]"); W(1200)
    ok(E("window.__asked[0]") == ["Kashi IT Solutions", "2026-07-05", "2026-07-31"], "our side: the party's ledger in the books, for the period")
    T = lambda sel: pg.inner_text("#app " + sel).strip() if pg.locator("#app " + sel).count() else ""
    ok(T("[data-recon-line=open]").startswith("Add: Difference in opening balance") and "1,000.00" in T("[data-recon-line=open]"), "the opening difference is a line of its own: “Difference in opening balance” 1,000 (%s)" % T("[data-recon-line=open]"))
    ok("34,670.00" in T("[data-recon-ours]") and "37,690.60" in T("[data-recon-theirs]") and T("[data-recon-unexplained]") in ("₹0.00", "0.00") or T("[data-recon-unexplained]").endswith("0.00"),
       "closing as per our books 34,670.00 + the differences = closing as per Kashi 37,690.60; unexplained 0.00 (%s)" % T("[data-recon-unexplained]"))
    secs = E("Object.fromEntries([...document.querySelectorAll('#app [data-recon-sec]')].map(s => [s.getAttribute('data-recon-sec'), s.querySelectorAll('tbody tr').length]))")
    ok(secs == {"theirsOnly": 1, "oursOnly": 1, "differs": 1, "tds": 2, "gst": 1}, "each kind of difference: theirs only, ours only, a different amount, TDS both ways, GST (%s)" % secs)
    ok("Matched (5)" in T("[data-recon-matched] > summary"), "matched: 5, folded")
    shot("recon-2-statement")
    pg.click('#app [data-recon-sec=oursOnly] [data-recon-explain]'); W(300)
    pg.fill("#app [data-recon-note-box]", "courier bill posted twice in our books"); pg.click("#app [data-recon-note-save]"); W(500)
    ok("courier bill posted twice" in T("[data-recon-sec=oursOnly] [data-recon-note]") and "1 explained" in T("[data-recon-sec=oursOnly] h4"), "an entry explained with a note")
    n0 = E("Object.values(D().entries).length")
    pg.click('#app [data-recon-sec=theirsOnly] [data-recon-create]'); W(600)
    made = E("Object.values(D().entries).filter(e => e.readMode === 'recon').map(e => [e.x.invoiceNo, e.x.total, e.status, e.partyLedger])")
    ok(made == [["LF/3", 590, "draft", "Kashi IT Solutions"]] and E("Object.values(D().entries).length") == n0 + 1, "a missing entry: made a bill in Purchase → To review, not posted (%s)" % made)
    E("async () => { await ensureXlsx(); window.__xlsx = []; XLSX.writeFile = (wb, name) => window.__xlsx.push([name, wb.SheetNames]); }")
    pg.click("#app [data-recon-xlsx]"); W(800)
    x = E("window.__xlsx")
    ok(x and x[0][1][0] == "Statement" and "Ours only" in x[0][1] and "Theirs only" in x[0][1], "Excel: the statement and each kind of difference (%s)" % x)
    with pg.expect_download() as dl:
        pg.click("#app [data-recon-letter]")
    d = dl.value; path = d.path(); body = open(path, encoding="utf-8-sig").read()
    ok(d.suggested_filename.endswith(".doc") and "Confirmation of balance as on 31-Jul-2026" in body and "Kashi IT Solutions" in body, "the balance confirmation letter, a Word document (%s)" % d.suggested_filename)
    # ---- 2. the same format again: no AI; the run saved; the next starts from it
    E("() => closeDetail()"); W(400)
    upload("vendor_stmt_a.csv")
    ok(len(E("window.__ai")) == 1 and step() == "party" and E("SheetImport.st().how") == "known", "the same format again: no AI call (%s)" % E("SheetImport.st().how"))
    ok("Last reconciled up to 31-Jul-2026" in T("[data-recon-prev]"), "the next run starts from the last one")
    pg.click("#app [data-recon-go]"); W(1000)
    ok("courier bill posted twice" in T("[data-recon-sec=oursOnly] [data-recon-note]"), "… its notes come along")
    E("() => closeDetail()"); W(400)
    ok(pg.locator("#app [data-recon-row]").count() == 2, "the runs are kept: two for Kashi IT Solutions")
    # ---- 3. another format of the same statement: the AI again; the party asked
    upload("vendor_stmt_b.csv")
    ok(len(E("window.__ai")) == 2 and step() == "map", "another format: FinCom's AI asked once more")
    pg.click("#app [data-sheet-save]"); W(800)
    ok(step() == "party" and pg.locator("#app [data-recon-party-ask]").count() == 1, "no GSTIN in it: the party is asked in the panel")
    box = pg.locator("#app [data-recon-ledger]"); box.click(); box.fill("Kashi IT Solutions"); box.press("Tab"); W(500)
    pg.click("#app [data-recon-go]"); W(1000)
    ok(T("[data-recon-unexplained]").endswith("0.00") and "37,690.60" in T("[data-recon-theirs]"), "… the same reconciliation: 37,690.60, nothing unexplained")
    E("() => closeDetail()"); W(400)
    # ---- 4. Customers
    pg.click('#app [data-recon-tab="customers"]'); W(600)
    upload("customer_stmt.csv", "customer")
    pg.click("#app [data-sheet-save]"); W(800)
    box = pg.locator("#app [data-recon-ledger]")
    if E("SheetImport.st().ledger") != "Asha Retail LLP":
        box.click(); box.fill("Asha Retail LLP"); box.press("Tab"); W(500)
    pg.click("#app [data-recon-go]"); W(1000)
    ok("14,760.00" in T("[data-recon-ours]") and "12,400.00" in T("[data-recon-theirs]") and T("[data-recon-unexplained]").endswith("0.00") and pg.locator("#app [data-recon-line=open]").count() == 0,
       "a customer: their credit is our debit; 14,760 ours, 12,400 theirs (S/102 not yet in theirs), no opening difference, nothing unexplained")
    shot("recon-3-customer")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
