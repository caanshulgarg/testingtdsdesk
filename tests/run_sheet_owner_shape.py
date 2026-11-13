"""python3 run_sheet_owner_shape.py - a client's own Tally-style register on Sales and on Purchase, from the first upload
to the posting (next-fix-sheet-import, 13-Nov-2026: a sales sheet was read, every invoice stayed in To review, and
"Create it", "Map to a ledger…" and "Post to Tally" seemed to do nothing).
The files are made up (tests/fixtures/sheets/make_sheets.py), of that shape: a blank first row, the header on row 2
(Date, Customer Name, Voucher Type, Vch No., Sales Ledger, HSN, Taxable Amount, IGST, CGST, SGST, Invoice Amount), " -   "
where a tax is nil, a Total row, the client's own voucher type ("Sales UP"), and books that keep their sales ledgers,
their GST ledgers and some parties in sub-groups (Sales Local under Sales Accounts, GST Output under Duties & Taxes).
  1. Sales, the first time: FinCom's AI (faked, answering as it did: the Sales Ledger column as "ledger", Voucher Type as
     "doctype") is asked once; FinCom's rules put the two columns right (the sales ledger, Tally's voucher type); saved;
  2. the check step: a customer in a sub-group of Sundry Debtors is found; an unknown customer and an unknown sales ledger
     are asked; "Create it" makes the ledger (its group by its role), "Map to a ledger…" sets it;
  3. the invoices: the customer, the sheet's own sales ledger, the output GST ledgers found in their sub-group, nothing
     left "not set": Ready to post; the voucher as it goes to Tally is a "Sales UP" voucher; Post is enabled and posts
     once (the masters the person asked for with it); a second Post posts nothing;
  4. the same layout again: no AI; the invoices already here are not added again;
  5. Post disabled says why, with a button to where it is set; set there, the rows clear at once;
  6. a layout saved with the old, wrong columns: the next upload shows the mapping again, corrected, with no AI;
  7. Purchase: the same, with the purchase ledger, the supplier in a sub-group of Sundry Creditors, "Purchase UP".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sheet_owner_shape.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import upload_pages_books as BK
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
FX = os.path.join(HERE, "fixtures", "sheets")
PORT = int(os.environ.get("SHAPE_PORT") or 8298)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# FinCom's AI, faked: it answers as the real one did on 13-Nov-2026 (the ledger column as "ledger", the voucher type as
# "doctype"); FinCom's own rules must put the two right
FAKE_AI = """async () => { await registersLoad(); window.__ai = []; SheetAI.map = async (req) => { window.__ai.push(JSON.parse(JSON.stringify(req)));
  const pick = (re) => req.head.find(h => re.test(h)) || undefined;
  const map = {date: pick(/^date/i), no: pick(/vch no/i), party: pick(/customer name|supplier name/i), hsn: pick(/^hsn/i), taxable: pick(/taxable/i), igst: pick(/^igst/i), cgst: pick(/^cgst/i), sgst: pick(/^sgst/i),
    total: pick(/invoice amount/i), doctype: pick(/voucher type/i), ledger: pick(/(sales|purchase) ledger/i)};
  Object.keys(map).forEach(k => map[k] === undefined && delete map[k]);
  return {ok: true, map, transforms: {date: "ymd", groupByNo: false}, why: {}, cost: {usd: 0.0004, inr: 0.03, model: "claude-haiku-5-5"}}; }; }"""
# the client's ledgers as Tally keeps them: the sales, purchase and GST ledgers and some parties in sub-groups
LEDGERS = """() => { const L = [["Asha Textiles Pvt Ltd", "Debtors UP"], ["Chitra Foods (Lucknow)", "Sundry Debtors"], ["Consulting Income (A)", "Sales Local"], ["Consulting Income (B)", "Sales Local"],
    ["Output CGST", "GST Output"], ["Output SGST", "GST Output"], ["Output IGST", "GST Output"], ["Input CGST", "GST Input"], ["Input SGST", "GST Input"], ["Input IGST", "GST Input"],
    ["Purchase of Goods (UP)", "Purchase UP"], ["Dev Packaging", "Creditors UP"], ["Rent Received", "Indirect Incomes"], ["ICICI Bank", "Bank Accounts"]];
  S.bank.ledgers = {list: L.map(([name, group]) => ({name, group})), parents: {"Debtors UP": "Sundry Debtors", "Sales Local": "Sales Accounts", "GST Output": "Duties & Taxes", "GST Input": "Duties & Taxes",
    "Purchase UP": "Purchase Accounts", "Creditors UP": "Sundry Creditors"}, importedAt: new Date().toISOString(), live: true};
  S.bank.newLed = []; Ledgers.st[S.coId] = null; delete Ledgers.busy[S.coId]; }"""
# the cloud's queue, as run_sheet_import.py fakes it
QUEUE = """() => { const G = "GARG SHEKHAR & COMPANY"; const rpc0 = TCloud.rpc; window.__enq = [];
  TCloud.rpc = async (fn, a) => { if (fn === "tally_post_enqueue" && a && a.p_payload && (a.p_payload.vouchers || []).length){ const ids = a.p_payload.vouchers.map(v => v.id); window.__enq.push(JSON.parse(JSON.stringify(a.p_payload)));
      window.__jobs.unshift({id: a.p_id, client_id: a.p_client, company: G, status: "done", done: ids.length, n: ids.length, message: ids.length + " of " + ids.length + " sent to Tally", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        entry_ids: ids, results: ids.map(id => ({id, ok: true, verified: true, vchNumber: "V/" + id})), items: ids.map(id => ({id, state: "in_tally"}))}); CloudJobs.changed(); return {ok: true}; }
    if (fn === "tally_vouchers_in") return [];
    return rpc0(fn, a); };
  Cloud.api = async (p) => { const m = /tally_post_jobs\\?.*id=eq\\.([^&]+)/.exec(p); return m ? JSON.parse(JSON.stringify(window.__jobs.filter(j => j.id === m[1]))) : []; };
  window.syncLedgersFromTally = async () => {}; window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); }; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    W = pg.wait_for_timeout
    cid = E(BK.PURCHASE); W(1500)
    E(FAKE_AI); E(QUEUE)
    E("(id) => { S.tab = 'sales'; S.step = null; return loadSales(id).then(() => render()); }", cid); W(1200)
    E(LEDGERS); E("() => { ensureFileInputs(); SL().list = []; render(); }"); W(300)
    panel = lambda: pg.inner_text("#app [data-sheet-panel]") if pg.locator("#app [data-sheet-panel]").count() else ""
    step = lambda: E("(document.querySelector('#app [data-sheet-step]') || {getAttribute: () => ''}).getAttribute('data-sheet-step')")
    field = lambda col: pg.locator('#app select[data-sheet-field="%s"]' % col).input_value() if pg.locator('#app select[data-sheet-field="%s"]' % col).count() else None
    def upload(name, sel):
        E("() => { pickMode = 'company'; }")
        pg.set_input_files(sel, os.path.join(FX, name)); W(1800)
    def answer(qid, v, ledger=None):
        pg.click('#app [data-sheet-q="%s"] [data-sheet-a="%s"]' % (qid, v)); W(200)
        if ledger: E("([id, l]) => SheetImport.answer(id, 'map', l)", [qid, ledger]); W(200)
    qids = lambda: E("[...document.querySelectorAll('#app [data-sheet-q]')].map(q => [q.getAttribute('data-sheet-q'), q.getAttribute('data-sheet-q-kind'), q.innerText.split('\\n')[0]])")

    print("1. Sales, the first time: the AI once, the two columns put right, saved")
    upload("sales_owner_shape.xlsx", "#salesIn")
    ok(step() == "map" and len(E("window.__ai")) == 1, "a new layout: the mapping is shown, FinCom's AI asked once (%s, %s)" % (step(), len(E("window.__ai") or [])))
    ok("sledger" in (E("window.__ai[0].fields") or []) and "vchtype" in (E("window.__ai[0].fields") or []), "the AI is offered the sales / purchase ledger and Tally's voucher type as fields of their own")
    ok(field("salesledger") == "sledger", "the Sales Ledger column is the sales ledger, not the party's (%s)" % field("salesledger"))
    ok(field("vouchertype") == "vchtype", "the Voucher Type column is Tally's voucher type (%s)" % field("vouchertype"))
    ok(field("customername") == "party" and field("vchno") == "no" and field("invoiceamount") == "total", "the rest as the AI read it")
    opts = pg.locator('#app select[data-sheet-field="salesledger"] option').all_inner_texts() if pg.locator('#app select[data-sheet-field="salesledger"]').count() else []
    ok(any("Sales ledger" in o for o in opts) and any("Party" in o and "ledger" in o for o in opts) and any("Voucher type" in o for o in opts), "the fields offered: the sales ledger, the party's ledger and the voucher type, each its own (%s)" % [o for o in opts if "edger" in o or "oucher" in o])
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    fm = E("(CO().sheetFormats || []).filter(f => !f.deleted).map(f => f.map)")
    ok(len(fm) == 1 and fm[0].get("sledger") == "salesledger" and fm[0].get("vchtype") == "vouchertype" and "ledger" not in fm[0], "saved so (%s)" % fm)

    print("2. the check step: found in sub-groups; what is not in Tally is asked; Create it and Map work")
    docs = E("(SheetImport.st().docs || []).map(d => [d.no, d.date, d.taxable, d.igst, d.cgst, d.sgst, d.total, d.check.ok])")
    ok(docs == [["UP/26-27/0001", "2026-10-06", 1000, 180, 0, 0, 1180, True], ["UP/26-27/0002", "2026-10-07", 2000, 0, 180, 180, 2360, True], ["UP/26-27/0003", "2026-10-08", 500, 0, 0, 0, 500, True], ["UP/26-27/0004", "2026-10-09", 3000, 0, 270, 270, 3540, True]],
       "the blank first row, the dash cells and the Total row: 4 invoices, to the paisa (%s)" % docs)
    ok("a total row" in panel(), "the Total row left out, and said")
    qs = qids()
    ok(sorted(q[0] for q in qs) == ["party:bharat tools", "party:chitra foods", "sled:trainingincomenew"], "asked: the two customers not in Tally and the sales ledger not in Tally; Asha Textiles (under Debtors UP) is found (%s)" % qs)
    ok(any(q[1] == "sledger" and "Sales ledger" in q[2] and "Training Income New" in q[2] for q in qs), "the sales ledger's question says what it is")
    for q, v, l in [("party:bharat tools", "create", None), ("party:chitra foods", "map", "Chitra Foods (Lucknow)"), ("sled:trainingincomenew", "create", None)]:
        if pg.locator('#app [data-sheet-q="%s"]' % q).count(): answer(q, v, l)
    ok(pg.locator("#app [data-sheet-add]:not([disabled])").count() == 1, "answered: the invoices can be added")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    new = E("B().newLed.map(l => [l.name, l.group])")
    ok(sorted(new) == [["Bharat Tools LLP", "Sundry Debtors"], ["Training Income New", "Sales Accounts"]], "Create it: the customer under Sundry Debtors, the sales ledger under Sales Accounts, made in Tally with the posting (%s)" % new)

    print("3. the invoices: every ledger set, Ready to post, a Sales UP voucher; Post posts once")
    inv = E("""SL().list.map(v => ({no: v.x.number, st: v.status, cust: v.customerLedger, issues: (v.problems || []).concat(v.ledgerIssues || []), lines: salesLines(v).map(l => l.side + " " + l.ledger + " " + l.amt)}))""")
    by = {v["no"]: v for v in inv}
    g = lambda no: by.get(no, {"st": "", "cust": "", "issues": ["missing"], "lines": []})
    ok(len(inv) == 4 and all(not v["issues"] for v in inv), "nothing “not set” on any invoice (%s)" % [(v["no"], v["issues"]) for v in inv if v["issues"]])
    ok(g("UP/26-27/0001")["cust"] == "Asha Textiles Pvt Ltd" and g("UP/26-27/0002")["cust"] == "Bharat Tools LLP" and g("UP/26-27/0004")["cust"] == "Chitra Foods (Lucknow)", "the customers: found in a sub-group, created, mapped (%s)" % [v["cust"] for v in inv])
    ok(g("UP/26-27/0001")["lines"] == ["Dr Asha Textiles Pvt Ltd 1180", "Cr Consulting Income (A) 1000", "Cr Output IGST 180"], "the sheet's own sales ledger, and the output IGST ledger from its sub-group (%s)" % g("UP/26-27/0001")["lines"])
    ok(g("UP/26-27/0002")["lines"] == ["Dr Bharat Tools LLP 2360", "Cr Consulting Income (A) 2000", "Cr Output CGST 180", "Cr Output SGST 180"] and g("UP/26-27/0003")["lines"] == ["Dr Bharat Tools LLP 500", "Cr Consulting Income (B) 500"]
       and g("UP/26-27/0004")["lines"][1] == "Cr Training Income New 3000", "each invoice its own sales ledger; CGST and SGST from the sub-group (%s)" % [g("UP/26-27/0002")["lines"], g("UP/26-27/0003")["lines"], g("UP/26-27/0004")["lines"]])
    ok(all(v["st"] == "ready" for v in inv), "all four Ready to post (%s)" % [v["st"] for v in inv])
    xml = E("SL().list.length ? salesVoucherXml(SL().list[0], CO()) : ''")
    ok('VCHTYPE="Sales UP"' in xml and "<VOUCHERTYPENAME>Sales UP</VOUCHERTYPENAME>" in xml and "<LEDGERNAME>Consulting Income (A)</LEDGERNAME>" in xml and "<LEDGERNAME>Output IGST</LEDGERNAME>" in xml,
       "the voucher as it goes to Tally: a Sales UP voucher with the sheet's ledgers")
    E("() => { SheetImport.close(); SL().filter = 'ready'; render(); }"); W(500)
    btn = pg.locator("#app .bk-actionbar button.primary", has_text="Post to Tally")
    ok(btn.count() == 1 and btn.is_enabled() and "(4)" in btn.inner_text(), "Post to Tally is enabled (%s)" % (btn.inner_text() if btn.count() else "no button"))
    def post():
        if not (btn.count() and btn.is_enabled()): return
        btn.click(); W(600)
        for i in range(30):
            if pg.locator('#confirmBox [data-cbx="yes"]').count() and pg.locator('#confirmBox [data-cbx="yes"]').is_visible(): pg.click('#confirmBox [data-cbx="yes"]')
            W(300)
            if not E("SL().busy"): break
    post()
    enq = E("window.__enq")
    ok(len(enq) == 1 and len(enq[0]["vouchers"]) == 4 and all('VCHTYPE="Sales UP"' in v["xml"] for v in enq[0]["vouchers"]), "posted through the existing path: one posting, four Sales UP vouchers (%s; %s)" % (len(enq), E("window.__toasts")[-2:]))
    ms = sorted(m["id"] for m in (enq[0].get("masters") or [])) if enq else []
    mx = " ".join(m["xml"] for m in (enq[0].get("masters") or [])) if enq else ""
    ok(ms == ["led:Bharat Tools LLP", "led:Training Income New"] and "<PARENT>Sales Accounts</PARENT>" in mx and "<PARENT>Sundry Debtors</PARENT>" in mx, "with the two ledgers the person asked to create, each under its group (%s)" % ms)
    st = E("SL().list.map(v => v.status)")
    ok(all(s == "posted" for s in st), "the four are Posted (%s)" % st)
    E("() => { SL().filter = 'ready'; render(); }"); W(300)
    post(); E("() => postSalesToTally()"); W(800)
    ok(len(E("window.__enq")) == 1, "Post again: nothing is posted twice")

    print("4. the same layout again: no AI; the invoices already here are not added again")
    upload("sales_owner_shape.xlsx", "#salesIn")
    ok(len(E("window.__ai")) == 1 and step() == "check" and E("SheetImport.st().how") == "known", "read by the saved layout, no AI (%s, %s)" % (step(), E("SheetImport.st() && SheetImport.st().how")))
    ok(len(qids()) == 0, "nothing asked: every ledger is known now (%s)" % qids())
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(800)
    res = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
    ok("0 added" in res and "4 already here, not added again" in res and E("SL().list.length") == 4 and all(s == "posted" for s in E("SL().list.map(v => v.status)")), "not added again, the posted ones untouched (%s)" % res)
    E("SheetImport.close()"); W(300)

    print("5. Post disabled says why, with a button to where it is set")
    E("""() => { const mk = (n) => { const v = newInvoice({number: "W/" + n, date: "2026-10-1" + n, customerName: "Asha Textiles Pvt Ltd", taxable: 1000, igst: 180, total: 1180}, "upload"); SL().list.push(v); mapInvoice(v); };
      mk(1); mk(2); SL().filter = "review"; saveSales(); render(); }"""); W(500)
    iss = E("SL().list.filter(v => /^W\\//.test(v.x.number)).map(v => [v.status, v.ledgerIssues])")
    ok(all(x[0] == "review" and x[1] == ["sales ledger for 18% not set"] for x in iss), "two invoices with no sales ledger (two under Sales Accounts, none chosen): To review (%s)" % iss)
    ok(btn.count() == 1 and not btn.is_enabled(), "Post to Tally is disabled")
    why = pg.locator("#app [data-post-why]")
    wt = why.inner_text() if why.count() else ""
    ok("2 invoices need the sales ledger" in wt, "and says exactly why (%s)" % wt)
    if why.count() and why.locator("button").count(): why.locator("button").first.click(); W(500)
    ok(E("!!SL().showSettings") and "Tally ledgers" in pg.inner_text("#app"), "its button opens where the sales ledger is set (Sales settings → Tally ledgers)")
    E("() => { salesCfgLedger('sales_18_i', 'Consulting Income (A)'); }"); W(300)
    iss = E("SL().list.filter(v => /^W\\//.test(v.x.number)).map(v => [v.status, v.ledgerIssues])")
    ok(all(x[1] == [] for x in iss), "the ledger chosen there: “sales ledger not set” is gone from the rows at once (%s)" % iss)
    E("() => { salesClick({dataset: {act: 'salesSettingsClose'}}); }"); W(400)
    E("() => { SL().list.filter(v => /^W\\//.test(v.x.number)).forEach(v => { v.x.customerName = 'Nobody Known'; v.customerLedger = ''; v.userLedger = false; mapInvoice(v); }); render(); }"); W(400)
    wt = why.inner_text() if why.count() else ""
    ok("2 invoices need a customer ledger" in wt, "another reason, said the same way (%s)" % wt)
    E("() => { postSalesToTally(); }"); W(600)
    ok(any("ready" in t.lower() for t in E("window.__toasts")[-2:]), "Post asked for with nothing ready is answered, never silent (%s)" % E("window.__toasts")[-2:])
    E("() => { SL().list = SL().list.filter(v => !/^W\\//.test(v.x.number)); saveSales(); render(); }")

    print("6. a layout saved with the old columns: shown again, corrected, with no AI")
    E("""() => { const co = CO(), f = co.sheetFormats.find(x => !x.deleted); f.map = Object.assign({}, f.map, {ledger: f.map.sledger, doctype: f.map.vchtype}); delete f.map.sledger; delete f.map.vchtype; delete f.v;   // (as saved before 13-Nov-2026: not yet checked by a person since)
      window.__old = f.id; SL().list = []; saveSales(); render(); }"""); W(300)
    upload("sales_owner_shape.xlsx", "#salesIn")
    ok(step() == "map" and len(E("window.__ai")) == 1, "the mapping is shown again by itself, without the AI (%s, %d calls)" % (step(), len(E("window.__ai"))))
    note = pg.inner_text("#app [data-sheet-remap]") if pg.locator("#app [data-sheet-remap]").count() else ""
    ok("Sales Ledger" in note and "not" in note and "customer" in note.lower(), "and says why: the Sales Ledger column was read as the customer's ledger (%s)" % note)
    ok(field("salesledger") == "sledger" and field("vouchertype") == "vchtype", "corrected: the sales ledger, the voucher type")
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    fs = E("CO().sheetFormats.map(f => [f.id === window.__old, !!f.deleted, f.deleted ? f.deleted.why : '', f.map.sledger || ''])")
    ok(len(fs) == 2 and [True, True, "mapped again", ""] in fs and [False, False, "", "salesledger"] in fs, "saved: the old layout put aside (kept), the corrected one in its place (%s)" % fs)
    ok(step() == "check" and len(qids()) == 0, "and the sheet read by it")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(800)
    st = E("SL().list.map(v => [v.status, (v.ledgerIssues || []).length, v.x.vchType])")
    ok(len(st) == 4 and all(x == ["ready", 0, "Sales UP"] for x in st), "the four invoices Ready to post again (%s)" % st)
    E("SheetImport.close()"); W(300)

    print("7. Purchase: the purchase ledger, the supplier in a sub-group, Purchase UP")
    n0 = len(E("window.__ai"))
    E("() => goStep('review', 'bills')"); W(600)
    upload("purchase_owner_shape.xlsx", "#fileIn")
    ok(step() == "map" and len(E("window.__ai")) == n0 + 1, "a new layout: FinCom's AI asked once")
    ok(field("purchaseledger") == "sledger" and field("vouchertype") == "vchtype" and field("suppliername") == "party", "the Purchase Ledger column is the purchase ledger, Voucher Type Tally's voucher type (%s, %s)" % (field("purchaseledger"), field("vouchertype")))
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    qs = qids()
    ok([q[0] for q in qs] == ["party:esha"], "asked: only the supplier not in Tally; Dev Packaging (under Creditors UP) and the purchase ledger are found (%s)" % qs)
    if pg.locator('#app [data-sheet-q="party:esha"]').count(): answer("party:esha", "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    bills = E("Object.values(D().entries).filter(e => e.readMode === 'sheet').map(e => [e.x.invoiceNo, e.partyLedger, e.expenseLedger, e.vchType || '', e.status])")
    ok(sorted(bills) == [["DP/501", "Dev Packaging", "Purchase of Goods (UP)", "Purchase UP", "draft"], ["ET/77", "Esha Traders", "Purchase of Goods (UP)", "Purchase UP", "draft"]],
       "the bills: the supplier (found, created), the sheet's purchase ledger, its voucher type (%s)" % bills)
    W(600)
    bills2 = E("Object.values(D().entries).filter(e => e.readMode === 'sheet').map(e => [e.x.invoiceNo, e.partyLedger, e.expenseLedger])")
    ok(sorted(bills2) == [b[:3] for b in sorted(bills)], "and they stay so when the books are looked at again (%s)" % bills2)
    px = E("""() => { const co = CO(), e = Object.values(D().entries).find(e => e.readMode === 'sheet' && e.x.invoiceNo === 'DP/501'); if (!e) return {xml: "", why: "no bill"};
      e.natureId = "none"; approve(e); return {xml: e.status === "approved" ? voucherXml(e, co) : "", why: e.status + " " + JSON.stringify((e.snapshot || {}).lines || preview(e).missing || "")}; }""")
    ok('VCHTYPE="Purchase UP"' in px["xml"] and "<LEDGERNAME>Purchase of Goods (UP)</LEDGERNAME>" in px["xml"] and "Dev Packaging" in px["xml"] and "<LEDGERNAME>Input CGST</LEDGERNAME>" in px["xml"],
       "approved, the voucher as it goes to Tally: Purchase UP, the purchase ledger, the input GST ledger from its sub-group (%s)" % (px["why"][:400] if 'Purchase UP' not in px["xml"] or "Input CGST" not in px["xml"] else "ok"))
    E("() => goStep('review', 'bills')"); W(500)
    upload("purchase_owner_shape.xlsx", "#fileIn")
    ok(len(E("window.__ai")) == n0 + 1 and step() == "check" and E("SheetImport.st() && SheetImport.st().how") == "known", "the same layout again: no AI")
    for q in qids(): answer(q[0], "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(800)
    res = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
    ok("0 added" in res and "2 held as duplicates" in res, "the same bills again: held as duplicates, never twice (%s)" % res)
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
