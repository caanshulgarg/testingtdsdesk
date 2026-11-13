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
     left "not set": Ready to post; the voucher as it goes to Tally is a Sales voucher (the screen's type, whatever the
     sheet's Voucher Type column says: the owner, 13-Nov-2026); Post is enabled and posts
     once (the masters the person asked for with it); a second Post posts nothing;
  4. the same layout again: no AI; the invoices already here are not added again;
  5. Post disabled says why, with a button to where it is set; set there, the rows clear at once;
  6. a layout saved with the old, wrong columns: the next upload shows the mapping again, corrected, with no AI;
  7. Purchase: the same, with the purchase ledger, the supplier in a sub-group of Sundry Creditors; posted as Purchase;
  8. credit and debit notes: the kind of each row by what the type column says (or, with no such column, a negative
     total), shown in the panel before anything is added; Sales: Credit Note / Debit Note; Purchase: Debit Note, every
     line reversed; the same type asked of Tally in the already-booked check, a note matched only to a note;
  9. the sheet uploaded again over invoices still waiting (review of cf58b7cc9): another party's or another amount's
     invoice of the same number is never written over (it is a new invoice); a ledger a person set is never replaced;
     a Ready invoice whose ledger the upload changed goes back to To review;
 10. Purchase as Journal (the owner, 13-Nov-2026): the panel's "Post as: Purchase / Journal" starts at the client's own
     setting for its bills (Journal there: Journal) and is kept in that setting; chosen Journal, the bill goes as the
     bills' own journal voucher (balanced, the party credited with its bill reference); a return is still a Debit Note;
     a second Post posts nothing, and a journal of that reference already in Tally is found;
 11. held for a person (re-review of d8281e4ea): a negative amount in a sheet whose Type column does not call it a
     return, and "Purchase Return" on a sales sheet, wait in To review with the reason said, never turned positive;
     "Edit type" on the held row sets what it is, there; the sheet uploaded again with its Type put right puts the held
     row right in place (by number, date and party: nothing deleted by hand, nothing added twice);
 12. the final review of ca68ea1ae: two rows of one number (an invoice, and a negative row its Type does not explain):
     the sheet uploaded twice leaves the held row as it is (the other row never rewrites it), the corrected sheet puts
     it right; "Edit type" does nothing to a row that is not held or is approved / posted, and a held bill is not
     approved until its type is set; a return carries no TDS (a 1,00,000 professional-fees return: TDS 0); the client's
     own name for its purchase voucher type is kept when Journal is chosen and chosen back.
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
    ["Purchase of Goods (UP)", "Purchase UP"], ["Dev Packaging", "Creditors UP"], ["Rent Received", "Indirect Incomes"], ["Cash", "Cash-in-Hand"], ["ICICI Bank", "Bank Accounts"]];
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
    ok("sledger" in (E("window.__ai[0].fields") or []) and "vchtype" not in (E("window.__ai[0].fields") or []), "the AI is offered the sales / purchase ledger as a field of its own; the voucher type is not asked for (the screen's is used)")
    ok(field("salesledger") == "sledger", "the Sales Ledger column is the sales ledger, not the party's (%s)" % field("salesledger"))
    ok(field("vouchertype") == "doctype", "the Voucher Type column only tells the kind of document (%s)" % field("vouchertype"))
    ok(field("customername") == "party" and field("vchno") == "no" and field("invoiceamount") == "total", "the rest as the AI read it")
    opts = pg.locator('#app select[data-sheet-field="salesledger"] option').all_inner_texts() if pg.locator('#app select[data-sheet-field="salesledger"]').count() else []
    ok(any("Sales ledger" in o for o in opts) and any("Party" in o and "ledger" in o for o in opts) and any("Voucher type" in o for o in opts), "the fields offered: the sales ledger, the party's ledger and the voucher type, each its own (%s)" % [o for o in opts if "edger" in o or "oucher" in o])
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    fm = E("(CO().sheetFormats || []).filter(f => !f.deleted).map(f => f.map)")
    ok(len(fm) == 1 and fm[0].get("sledger") == "salesledger" and fm[0].get("doctype") == "vouchertype" and "ledger" not in fm[0], "saved so (%s)" % fm)

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

    print("3. the invoices: every ledger set, Ready to post, a Sales voucher; Post posts once")
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
    ok(sorted(set(E("[...document.querySelectorAll('#app [data-sheet-vt]')].map(x => x.innerText)") or ["closed"])) in (["Sales"], ["closed"]) and 'VCHTYPE="Sales"' in xml and "<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>" in xml and "Sales UP" not in xml and "<LEDGERNAME>Consulting Income (A)</LEDGERNAME>" in xml and "<LEDGERNAME>Output IGST</LEDGERNAME>" in xml,
       "the voucher as it goes to Tally: a Sales voucher (the sheet says “Sales UP”: never used), with the sheet's ledgers")
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
    ok(len(enq) == 1 and len(enq[0]["vouchers"]) == 4 and all('VCHTYPE="Sales"' in v["xml"] for v in enq[0]["vouchers"]), "posted through the existing path: one posting, four Sales vouchers (%s; %s)" % (len(enq), E("window.__toasts")[-2:]))
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
    E("""() => { const co = CO(), f = co.sheetFormats.find(x => !x.deleted); f.map = Object.assign({}, f.map, {ledger: f.map.sledger}); delete f.map.sledger; delete f.v;   // (as saved before 13-Nov-2026: not yet checked by a person since)
      window.__old = f.id; SL().list = []; saveSales(); render(); }"""); W(300)
    upload("sales_owner_shape.xlsx", "#salesIn")
    ok(step() == "map" and len(E("window.__ai")) == 1, "the mapping is shown again by itself, without the AI (%s, %d calls)" % (step(), len(E("window.__ai"))))
    note = pg.inner_text("#app [data-sheet-remap]") if pg.locator("#app [data-sheet-remap]").count() else ""
    ok("Sales Ledger" in note and "not" in note and "customer" in note.lower(), "and says why: the Sales Ledger column was read as the customer's ledger (%s)" % note)
    ok(field("salesledger") == "sledger" and field("vouchertype") == "doctype", "corrected: the sales ledger")
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    fs = E("CO().sheetFormats.map(f => [f.id === window.__old, !!f.deleted, f.deleted ? f.deleted.why : '', f.map.sledger || ''])")
    ok(len(fs) == 2 and [True, True, "mapped again", ""] in fs and [False, False, "", "salesledger"] in fs, "saved: the old layout put aside (kept), the corrected one in its place (%s)" % fs)
    ok(step() == "check" and len(qids()) == 0, "and the sheet read by it")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(800)
    st = E("SL().list.map(v => [v.status, (v.ledgerIssues || []).length, (salesVoucherXml(v, CO()).match(/VCHTYPE=\"([^\"]*)\"/) || [])[1]])")
    ok(len(st) == 4 and all(x == ["ready", 0, "Sales"] for x in st), "the four invoices Ready to post again (%s)" % st)
    E("SheetImport.close()"); W(300)
    # a layout that maps the column as a voucher type (saved so for a while) still reads, and still posts as Sales
    E("""() => { const f = CO().sheetFormats.find(x => !x.deleted); f.map = Object.assign({}, f.map, {vchtype: f.map.doctype}); delete f.map.doctype; SL().list = []; saveSales(); render(); }"""); W(300)
    upload("sales_owner_shape.xlsx", "#salesIn")
    ok(step() == "check" and E("SheetImport.st() && SheetImport.st().how") == "known" and len(E("window.__ai")) == 1, "a layout that maps a voucher-type column still reads, with no AI and nothing asked again (%s)" % step())
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(800)
    st = E("SL().list.map(v => (salesVoucherXml(v, CO()).match(/VCHTYPE=\"([^\"]*)\"/) || [])[1])")
    ok(st == ["Sales"] * 4, "and its invoices post as Sales (%s)" % st)
    E("() => { const f = CO().sheetFormats.find(x => !x.deleted); f.map = Object.assign({}, f.map, {doctype: f.map.vchtype}); delete f.map.vchtype; SheetImport.close(); }"); W(300)

    print("7. Purchase: the purchase ledger, the supplier in a sub-group; posted as Purchase")
    n0 = len(E("window.__ai"))
    E("() => goStep('review', 'bills')"); W(600)
    upload("purchase_owner_shape.xlsx", "#fileIn")
    ok(step() == "map" and len(E("window.__ai")) == n0 + 1, "a new layout: FinCom's AI asked once")
    ok(field("purchaseledger") == "sledger" and field("vouchertype") == "doctype" and field("suppliername") == "party", "the Purchase Ledger column is the purchase ledger, Voucher Type the kind of document (%s, %s)" % (field("purchaseledger"), field("vouchertype")))
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    qs = qids()
    ok([q[0] for q in qs] == ["party:esha"], "asked: only the supplier not in Tally; Dev Packaging (under Creditors UP) and the purchase ledger are found (%s)" % qs)
    pa = lambda: pg.locator("#app [data-sheet-postas]").input_value() if pg.locator("#app [data-sheet-postas]").count() else None
    vt7 = lambda: sorted(set(E("[...document.querySelectorAll('#app [data-sheet-vt]')].map(x => x.innerText)")))
    ok(E("CO().voucherType") == "Journal" and pa() == "Journal" and vt7() == ["Journal"] and pg.locator("#app [data-sheet-postas-note]").count() == 0,
       "Post as: the client's own setting for its bills is Journal, so the switch starts at Journal and the rows say Journal (%s, %s, %s)" % (E("CO().voucherType"), pa(), vt7()))
    if pa(): pg.select_option("#app [data-sheet-postas]", "Purchase"); W(300)
    note = pg.inner_text("#app [data-sheet-postas-note]") if pg.locator("#app [data-sheet-postas-note]").count() else ""
    ok(pa() == "Purchase" and vt7() == ["Purchase"] and E("billVt(CO())") == "Purchase" and E("CO().voucherType") == "Journal" and "also changes it for bills of this client" in note, "Purchase chosen: the rows say Purchase, it is kept in the client's setting, and the panel says it changes the bills too (%s)" % note)
    if pg.locator('#app [data-sheet-q="party:esha"]').count(): answer("party:esha", "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    bills = E("Object.values(D().entries).filter(e => e.readMode === 'sheet').map(e => [e.x.invoiceNo, e.partyLedger, e.expenseLedger, vchTypeOf(e, CO()), e.status])")
    ok(sorted(bills) == [["DP/501", "Dev Packaging", "Purchase of Goods (UP)", "Purchase", "draft"], ["ET/77", "Esha Traders", "Purchase of Goods (UP)", "Purchase", "draft"]],
       "the bills: the supplier (found, created), the sheet's purchase ledger; a Purchase voucher as chosen (the sheet says “Purchase UP”: never used) (%s)" % bills)
    W(600)
    bills2 = E("Object.values(D().entries).filter(e => e.readMode === 'sheet').map(e => [e.x.invoiceNo, e.partyLedger, e.expenseLedger])")
    ok(sorted(bills2) == [b[:3] for b in sorted(bills)], "and they stay so when the books are looked at again (%s)" % bills2)
    px = E("""() => { const co = CO(), e = Object.values(D().entries).find(e => e.readMode === 'sheet' && e.x.invoiceNo === 'DP/501'); if (!e) return {xml: "", why: "no bill"};
      e.natureId = "none"; approve(e); return {xml: e.status === "approved" ? voucherXml(e, co) : "", why: e.status + " " + JSON.stringify((e.snapshot || {}).lines || compute(e, S.coId).missing || "")}; }""")
    ok('VCHTYPE="Purchase"' in px["xml"] and "Purchase UP" not in px["xml"] and "<LEDGERNAME>Purchase of Goods (UP)</LEDGERNAME>" in px["xml"] and "Dev Packaging" in px["xml"] and "<LEDGERNAME>Input CGST</LEDGERNAME>" in px["xml"],
       "approved, the voucher as it goes to Tally: Purchase, the purchase ledger, the input GST ledger from its sub-group (%s)" % (px["why"][:400] if 'VCHTYPE="Purchase"' not in px["xml"] or "Input CGST" not in px["xml"] else "ok"))
    E("() => goStep('review', 'bills')"); W(500)
    upload("purchase_owner_shape.xlsx", "#fileIn")
    ok(len(E("window.__ai")) == n0 + 1 and step() == "check" and E("SheetImport.st() && SheetImport.st().how") == "known", "the same layout again: no AI")
    for q in qids(): answer(q[0], "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(800)
    res = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
    ok("0 added" in res and "2 held as duplicates" in res, "the same bills again: held as duplicates, never twice (%s)" % res)

    print("8. credit and debit notes: by the kind of row, shown before Post; the screen's voucher types")
    vts = lambda: E("Object.fromEntries([...document.querySelectorAll('#app [data-sheet-vt]')].map(x => [x.getAttribute('data-sheet-vt'), x.innerText]))")
    vtx = "(x) => (x.match(/VCHTYPE=\"([^\"]*)\"/) || [])[1]"
    # -- Purchase, a type column: a return, our debit note (DN, DBN) and the supplier's credit note are all a Debit Note
    E("() => goStep('review', 'bills')"); W(500)
    upload("purchase_notes.xlsx", "#fileIn")
    ok(step() == "check" and E("SheetImport.st() && SheetImport.st().how") == "known", "Purchase notes: the saved layout reads the sheet")
    ok(vts() == {"DP/601": "Purchase", "DP/PR1": "Debit Note", "DP/DN1": "Debit Note", "DP/DBN1": "Debit Note", "DP/CN1": "Debit Note"}, "the panel shows each row's kind before anything is added: the bill Purchase; “Purchase Return”, “Debit Note”, “dbn”, “Credit Note” each a Debit Note (%s)" % vts())
    for q in qids(): answer(q[0], "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    pn = E("""() => { const co = CO(); return Object.values(D().entries).filter(e => e.readMode === 'sheet' && /^DP\/(6|PR|DN|DBN|CN)/.test(e.x.invoiceNo)).map(e => { e.natureId = "none"; if (e.status === "draft") approve(e);
      const x = e.status === "approved" ? voucherXml(e, co) : "", m = x.match(/<LEDGERNAME>Dev Packaging<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>(\w+)</);
      return [e.x.invoiceNo, vchTypeOf(e, co), (x.match(/VCHTYPE="([^"]*)"/) || [])[1] || e.status, m ? m[1] : "", e.x.total]; }).sort(); }""")
    ok(pn == [["DP/601", "Purchase", "Purchase", "No", 1180], ["DP/CN1", "Debit Note", "Debit Note", "Yes", 354], ["DP/DBN1", "Debit Note", "Debit Note", "Yes", 59], ["DP/DN1", "Debit Note", "Debit Note", "Yes", 118], ["DP/PR1", "Debit Note", "Debit Note", "Yes", 236]],
       "the bills: Purchase with the supplier credited; each note a Debit Note with every line reversed (the supplier debited), amounts positive (%s)" % pn)
    # -- Purchase, no type column: a negative total is a note
    E("() => goStep('review', 'bills')"); W(500)
    n1 = len(E("window.__ai"))
    upload("purchase_negative.xlsx", "#fileIn")
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    ok(vts() == {"DP/701": "Purchase", "DP/702": "Debit Note"}, "no type column: the row with a negative total is a Debit Note, the other a Purchase (%s)" % vts())
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    pn = E("Object.values(D().entries).filter(e => /^DP\\/70/.test(e.x.invoiceNo)).map(e => [e.x.invoiceNo, vchTypeOf(e, CO()), e.x.taxable, e.x.igst, e.x.total]).sort()")
    ok(pn == [["DP/701", "Purchase", 1000, 180, 1180], ["DP/702", "Debit Note", 400, 72, 472]], "and its amounts are taken positive (%s)" % pn)
    pu = E("() => { const e = Object.values(D().entries).find(e => e.x.invoiceNo === 'DP/702'); return decodeURIComponent(PostCheck.vouchersUrl(CO(), 'T', e)); }")
    ok("Purchase" in pu and "Debit Note" in pu and "Journal" in pu, "the already-booked check asks Tally for Purchase, Journal and Debit Note vouchers (%s)" % pu[-60:])
    # -- Sales, a type column
    E("(id) => { S.tab = 'sales'; S.step = null; SL().list = []; saveSales(); render(); }", cid); W(600)
    upload("sales_notes.xlsx", "#salesIn")
    ok(step() == "check" and E("SheetImport.st() && SheetImport.st().how") == "known", "Sales notes: the saved layout reads the sheet")
    want = {"UP/26-27/0011": "Sales", "CN/26-27/01": "Credit Note", "SR/26-27/02": "Credit Note", "CRN/26-27/03": "Credit Note", "DN/26-27/01": "Debit Note", "DBN/26-27/02": "Debit Note"}
    ok(vts() == want, "the panel shows each row's kind: “Sales UP” Sales; “Credit Note”, “Sales Return”, “crn” Credit Note; “Debit Note”, “DBN” Debit Note (%s)" % vts())
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    sn = E("""SL().list.map(v => { const x = salesVoucherXml(v, CO()), m = x.match(/<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>\s*<AMOUNT>(-?[\d.]+)</), d = x.match(/<ISDEEMEDPOSITIVE>(\w+)<\/ISDEEMEDPOSITIVE>\s*<ISPARTYLEDGER>Yes/);
      return [v.x.number.replace(" (CN)", ""), (x.match(/VCHTYPE="([^"]*)"/) || [])[1], d ? d[1] : "", v.x.total, v.status]; })""")
    ok(sorted(sn) == sorted([["UP/26-27/0011", "Sales", "Yes", 1180, "ready"], ["CN/26-27/01", "Credit Note", "No", 590, "ready"], ["SR/26-27/02", "Credit Note", "No", 236, "ready"], ["CRN/26-27/03", "Credit Note", "No", 118, "ready"],
        ["DN/26-27/01", "Debit Note", "Yes", 354, "ready"], ["DBN/26-27/02", "Debit Note", "Yes", 118, "ready"]]), "the vouchers: Sales and Debit Note debit the customer, a Credit Note credits it; amounts positive; all Ready (%s)" % sn)
    # the already-booked check: the same types asked of Tally; a note is matched to a note, an invoice never to a note
    chk = E("""async () => { const tv = window.tallyVia, tc = window.tallyCall; let url = "";
      const cn = SL().list.find(v => /^CN\//.test(v.x.number)), inv = SL().list.find(v => v.x.number === "UP/26-27/0011"), dn = SL().list.find(v => /^DN\//.test(v.x.number));
      window.tallyVia = () => true; window.tallyCall = async (co, u) => { url = decodeURIComponent(u); return {vouchers: [{number: cn.x.number, type: "Credit Note", date: "20261013", amount: 590, guid: "g1"},
        {number: inv.x.number, type: "Credit Note", date: "20261012", amount: 1180, guid: "g2"}, {number: dn.x.number, type: "Sales", date: "20261016", amount: 354, guid: "g3"}]}; };
      try { await salesCheckTally(SL().list.filter(v => v.status === "ready")); } finally { window.tallyVia = tv; window.tallyCall = tc; }
      const r = {url, cn: cn.status, inv: inv.status, dn: dn.status}; [cn, inv, dn].forEach(v => { if (v.status === "intally"){ v.status = "ready"; delete v.tallyMatch; } }); return r; }""")
    types = (chk["url"].split("types=")[-1].split("&")[0]).split(",") if chk["url"] else []
    ok(sorted(types) == ["Credit Note", "Debit Note", "Sales"], "the already-booked check asks Tally for Sales, Credit Note and Debit Note vouchers (%s)" % types)
    ok(chk["cn"] == "intally" and chk["inv"] == "ready" and chk["dn"] == "ready", "a Credit Note of that number in Tally sets the credit note aside; an invoice or a debit note is not taken for another kind's voucher (%s)" % chk)
    # -- Sales, no type column: a negative total is a credit note
    E("() => { SheetImport.close(); SL().list = []; saveSales(); render(); }"); W(400)
    upload("sales_negative.xlsx", "#salesIn")
    if step() == "map": pg.click("#app [data-sheet-save]"); W(800)
    ok(vts() == {"UP/26-27/0021": "Sales", "UP/26-27/0022": "Credit Note"}, "no type column: the row with a negative total is a Credit Note (%s)" % vts())
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    sn = E("SL().list.map(v => [v.x.number.replace(' (CN)', ''), (salesVoucherXml(v, CO()).match(/VCHTYPE=\"([^\"]*)\"/) || [])[1], v.x.taxable, v.x.igst, v.x.total, v.status]).sort()")
    ok(sn == [["UP/26-27/0021", "Sales", 1000, 180, 1180, "ready"], ["UP/26-27/0022", "Credit Note", 400, 72, 472, "ready"]], "and its amounts are taken positive (%s)" % sn)
    E("SheetImport.close()"); W(200)

    print("9. the sheet again over waiting invoices: never another invoice's, never a person's ledger; a changed Ready one to review")
    E("() => { SL().list = []; saveSales(); render(); }"); W(300)
    upload("sales_owner_shape.xlsx", "#salesIn")
    for q in qids(): answer(q[0], "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    ok(E("SL().list.map(v => v.status)") == ["ready"] * 4, "four invoices from the sheet, waiting (%s)" % E("SL().list.map(v => v.status)"))
    E("""() => { const g = (n) => SL().list.find(v => v.x.number === "UP/26-27/000" + n);
      // 1: another customer's invoice of the same number and date (H1: the party differs)
      Object.assign(g(1).x, {customerName: "Chitra Foods"}); Object.assign(g(1), {customerLedger: "Chitra Foods (Lucknow)", userLedger: true, salesLedgers: {18: "Consulting Income (B)"}, id: "keep1"});
      // 4: the same customer and number, another amount (H1: the total differs)
      Object.assign(g(4).x, {taxable: 1000, cgst: 90, sgst: 90, total: 1180}); Object.assign(g(4), {salesLedgers: {18: "Consulting Income (B)"}, id: "keep4"});
      // 2: the person chose the customer ledger on the Sales page (its mark: "Set by you"), in any group (Cash), and a sales ledger: theirs stand
      Object.assign(g(2), {customerLedger: "Cash", userLedger: true, custSource: "Set by you", salesLedgers: {18: "Consulting Income (B)"}, status: "ready"});
      // 3: a Ready invoice whose customer FinCom had only matched (not a person's): the upload sets it (M2: back to To review)
      Object.assign(g(3), {customerLedger: "Asha Textiles Pvt Ltd", userLedger: false, custSure: true, status: "ready"});
      saveSales(); render(); }"""); W(300)
    upload("sales_owner_shape.xlsx", "#salesIn")
    for q in qids(): answer(q[0], "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    res = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
    L = E("SL().list.map(v => ({id: v.id, no: v.x.number, name: v.x.customerName, total: v.x.total, cust: v.customerLedger, sl: Object.values(v.salesLedgers || {}).join(), st: v.status, p: (v.problems || []).join()}))")
    one = lambda f: ([v for v in L if f(v)] or [{"cust": "", "sl": "", "st": "", "name": "", "total": 0, "p": ""}])[0]
    k1, k4 = one(lambda v: v["id"] == "keep1"), one(lambda v: v["id"] == "keep4")
    ok(k1["cust"] == "Chitra Foods (Lucknow)" and k1["sl"] == "Consulting Income (B)" and k1["name"] == "Chitra Foods", "H1: another customer's invoice of the same number and date is not written over (%s)" % k1)
    ok(k4["total"] == 1180 and k4["sl"] == "Consulting Income (B)", "H1: nor one of the same customer with another total (%s)" % k4)
    ok("2 added" in res and "2 already here" in res and len(L) == 6, "the sheet's two are new invoices; the two that are the same are not added again (%s; %d here)" % (res, len(L)))
    n1 = one(lambda v: v["no"] == "UP/26-27/0001" and v["id"] != "keep1"); n4 = one(lambda v: v["no"] == "UP/26-27/0004" and v["id"] != "keep4")
    ok(n1["cust"] == "Asha Textiles Pvt Ltd" and n1["total"] == 1180 and n4["total"] == 3540 and "already exists" in n1["p"] and n1["st"] == "review", "the new ones carry the sheet's figures and say the number already exists: To review, never posted by themselves (%s)" % [n1, n4])
    v2 = one(lambda v: v["no"] == "UP/26-27/0002")
    ok(v2["cust"] == "Cash" and v2["sl"] == "Consulting Income (B)" and v2["st"] == "ready", "M2: the customer ledger a person set (“Set by you”, whatever its group: Cash) and their sales ledger are not replaced (%s)" % v2)
    v3 = one(lambda v: v["no"] == "UP/26-27/0003")
    ok(v3["cust"] == "Bharat Tools LLP" and v3["st"] == "review", "M2: a Ready invoice whose ledger the upload changed goes back to To review (%s)" % v3)
    E("SheetImport.close()"); W(200)

    print("10. Purchase as Journal: chosen on the panel, the bills' own journal voucher; never posted twice")
    E("() => { SheetImport.close(); S.tab = null; goStep('review', 'bills'); }"); W(600)
    upload("purchase_journal.xlsx", "#fileIn")
    ok(step() == "check" and pa() == "Purchase", "the choice made before is remembered for the client: Purchase (%s)" % pa())
    if pa(): pg.select_option("#app [data-sheet-postas]", "Journal"); W(300)
    ok(pa() == "Journal" and E("billVt(CO())") == "Journal" and vts() == {"DP/801": "Journal", "DP/802": "Journal", "DP/PR8": "Debit Note"} and pg.locator("#app [data-sheet-postas-note]").count() == 1,
       "Journal chosen: the rows say Journal, the return still Debit Note; kept in the client's setting, and said (%s)" % vts())
    for q in qids(): answer(q[0], "create")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    oth = E("Object.values(D().entries).filter(e => /^DP\\/(5|6|7)0/.test(e.x.invoiceNo) && !e.noteKind && e.status !== 'duplicate').map(e => [e.x.invoiceNo, vchTypeOf(e, CO())]).sort()")
    ok(oth == [["DP/501", "Journal"], ["DP/601", "Journal"], ["DP/701", "Journal"]], "the client's other bills waiting follow the same setting: bills and sheets agree (%s)" % oth)
    APPROVE = """(no) => { const co = CO(), e = Object.values(D().entries).find(e => e.x.invoiceNo === no); e.natureId = "none"; if (e.status === "draft") approve(e);
      (e.snapshot.lines || []).forEach(l => { const ck = l.ck || (/^Client setup/.test(l.why || "") ? (l.role === "gst" && l.head ? "gst:" + l.head.toLowerCase() : "") : ""); if (ck && l.ledger) choiceConfirm(co, ck, l.ledger); });
      const x = voucherXml(e, co), amts = [...x.matchAll(/<ALLLEDGERENTRIES\.LIST>\s*<LEDGERNAME>([^<]*)<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>(\w+)<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map(m => [m[1], m[2], Number(m[3])]);
      return {id: e.id, type: (x.match(/VCHTYPE="([^"]*)"/) || [])[1], name: (x.match(/<VOUCHERTYPENAME>([^<]*)</) || [])[1], lines: amts, sum: Math.round(amts.reduce((a, l) => a + l[2], 0) * 100) / 100,
        ref: /<BILLALLOCATIONS\.LIST>\s*<NAME>([^<]*)</.test(x) ? x.match(/<BILLALLOCATIONS\.LIST>\s*<NAME>([^<]*)</)[1] : "", note: vchTypeOf(e, co)}; }"""
    j1 = E(APPROVE, "DP/801")
    L = {l[0]: l for l in j1["lines"]}
    ok(j1["type"] == "Journal" and j1["name"] == "Journal", "the voucher as it goes to Tally is a Journal (%s)" % j1["type"])
    ok(j1["sum"] == 0 and L.get("Dev Packaging", [0, "", 0])[1:] == ["No", 2360] and L.get("Purchase of Goods (UP)", [0, "", 0])[1:] == ["Yes", -2000] and L.get("Input CGST", [0, "", 0])[1:] == ["Yes", -180] and L.get("Input SGST", [0, "", 0])[1:] == ["Yes", -180] and j1["ref"] == "DP/801",
       "the bills' own journal: Dr the purchase ledger 2,000 and input CGST / SGST 180 each, Cr the party 2,360 with its bill reference; balanced (%s, ref %s)" % (j1["lines"], j1["ref"]))
    r8 = E(APPROVE, "DP/PR8")
    ok(r8["type"] == "Debit Note" and r8["sum"] == 0 and {l[0]: l[1] for l in r8["lines"]}.get("Dev Packaging") == "Yes", "the return is still a Debit Note, the party debited (%s)" % r8["type"])
    E("""(id) => { Object.values(D().entries).forEach(e => { if (e.readMode === 'sheet' && e.status === 'approved' && e.id !== id){ e.status = 'draft'; e.snapshot = null; } });
      Ledgers.st[S.coId] = null; delete Ledgers.busy[S.coId]; window.__enq.length = 0; refreshStats(S.coId); S.postTabs[S.coId] = "topost"; goStep("post", "bills"); }""", j1["id"]); W(900)
    def post_bills():
        if not pg.locator("#app [data-post-main]").count() or not pg.locator("#app [data-post-main]").is_enabled(): return
        pg.click("#app [data-post-main]"); W(800)
        for i in range(30):
            if pg.locator('#confirmBox [data-cbx="yes"]').count() and pg.locator('#confirmBox [data-cbx="yes"]').is_visible(): pg.click('#confirmBox [data-cbx="yes"]')
            W(300)
            if not E("!!(S.billPost && S.billPost.busy)") and not (pg.locator('#confirmBox [data-cbx="yes"]').count() and pg.locator('#confirmBox [data-cbx="yes"]').is_visible()): break
    post_bills()
    enq = E("window.__enq")
    ok(len(enq) == 1 and [v["id"] for v in enq[0]["vouchers"]] == [j1["id"]] and 'VCHTYPE="Journal"' in enq[0]["vouchers"][0]["xml"], "Post: one posting, the Journal voucher (%s; %s)" % (len(enq), (E("window.__toasts") or [])[-2:]))
    E("""() => { S.postTabs[S.coId] = "topost"; goStep("post", "bills"); }"""); W(600)
    post_bills(); E("() => postBillsToTally()"); W(1200)
    ok(len(E("window.__enq")) == 1, "a second Post posts nothing: the journal is not sent twice (%d)" % len(E("window.__enq")))
    # a journal of that reference and party already in Tally (posted from elsewhere): found by reference, as a bill's is
    j2 = E(APPROVE, "DP/802")
    found = E("""(id) => { const e = D().entries[id], co = CO();
      const vs = [{type: "Journal", number: "77", reference: "DP/802", party: "Dev Packaging", date: "20261025", amount: 1180, guid: "gj", narration: ""}, {type: "Journal", number: "78", reference: "ZZ/1", party: "Dev Packaging", date: "20261025", amount: 1180, guid: "other"}];
      return {url: decodeURIComponent(PostCheck.vouchersUrl(co, "T", e)), r: JSON.stringify(PostCheck.match(e, vs) || null).slice(0, 300)}; }""", j2["id"])
    ok("Journal" in found["url"].split("types=")[-1] and "gj" in found["r"], "the already-booked check asks Tally for Journal vouchers and finds the journal by its reference (%s; %s)" % (found["url"][-70:], found["r"][:160]))

    print("11. held for a person: a negative amount the Type column does not explain; Purchase Return on Sales")
    E("(id) => { S.tab = 'sales'; S.step = null; SL().list = []; SL().filter = 'review'; saveSales(); render(); }", cid); W(600)
    upload("sales_held.xlsx", "#salesIn")
    hold = E("Object.fromEntries([...document.querySelectorAll('#app [data-sheet-hold]')].map(x => [x.getAttribute('data-sheet-vt'), x.innerText]))")
    ok(sorted(hold) == ["UP/26-27/0031", "UP/26-27/0032"] and "Negative amount: is this a return? Set it in the Type column" in hold.get("UP/26-27/0031", "") and "Purchase Return" in hold.get("UP/26-27/0032", "") and vts().get("UP/26-27/0033") == "Sales",
       "the panel says which rows wait for a person and why; “Non-returnable” is a plain Sales invoice (%s)" % hold)
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    hs = E("Object.fromEntries(SL().list.map(v => [v.x.number, [v.status, (v.problems || [])[0] || '', v.x.total, v.x.noteKind || '']]))")
    ok(hs.get("UP/26-27/0031") == ["review", "Negative amount: is this a return? Set it in the Type column", -472, ""], "the negative invoice waits in To review with the plain reason, its amount as the sheet has it: not turned positive, not a credit note by itself (%s)" % hs.get("UP/26-27/0031"))
    ok((hs.get("UP/26-27/0032") or ["", "", 0, ""])[0] == "review" and "credit note or a debit note" in (hs.get("UP/26-27/0032") or ["", ""])[1] and hs.get("UP/26-27/0033") == ["ready", "", 118, ""], "“Purchase Return” on Sales waits too; the plain invoice is Ready (%s)" % [hs.get("UP/26-27/0032"), hs.get("UP/26-27/0033")])
    E("() => { SheetImport.close(); SL().list = SL().list.filter(v => v.status !== 'ready'); render(); }"); W(400)
    wt = pg.inner_text("#app [data-post-why]") if pg.locator("#app [data-post-why]").count() else ""
    ok("2 invoices need a correction" in wt, "and Post says why nothing is ready (%s)" % wt)
    # Edit type on the held row, there
    id32 = E("SL().list.find(v => v.x.number === 'UP/26-27/0032').id")
    ok(pg.locator("#app select[data-edit-type]").count() == 2, "each held row has “Edit type” (%d)" % pg.locator("#app select[data-edit-type]").count())
    if pg.locator('#app select[data-edit-type="%s"]' % id32).count(): pg.select_option('#app select[data-edit-type="%s"]' % id32, "debit"); W(400)
    v32 = E("(id) => { const v = SL().list.find(v => v.id === id); return [v.x.noteKind, v.x.total, v.hold || '', v.status, (v.problems || []).length, (salesVoucherXml(v, CO()).match(/VCHTYPE=\"([^\"]*)\"/) || [])[1]]; }", id32)
    ok(v32 == ["debit", 354, "", "ready", 0, "Debit Note"], "Edit type → Debit Note: the row is a debit note, held no more, Ready (%s)" % v32)
    # the sheet again with its Type column put right: the held row is put right in place
    id31 = E("SL().list.find(v => v.x.number === 'UP/26-27/0031').id")
    upload("sales_held_fixed.xlsx", "#salesIn")
    ok(pg.locator("#app [data-sheet-hold]").count() == 0, "the corrected sheet holds nothing")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    res = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
    L = E("SL().list.map(v => [v.id, v.x.number, v.x.noteKind || '', v.x.total, v.hold || '', v.status])")
    v31 = ([x for x in L if x[0] == id31] or [[]])[0]
    ok(v31[1:] == ["UP/26-27/0031 (CN)", "credit", 472, "", "ready"] and len(L) == 3 and "1 held before, now put right" in res and "1 added" in res and "1 already here" in res,
       "the held invoice itself becomes the credit note (the same row: nothing deleted by hand, nothing twice); the one set by Edit type is already here (%s; %s)" % (v31, res))
    E("SheetImport.close()"); W(200)
    E("() => { S.tab = null; goStep('review', 'bills'); }"); W(600)
    upload("purchase_held.xlsx", "#fileIn")
    hold = E("[...document.querySelectorAll('#app [data-sheet-hold]')].map(x => x.innerText)")
    ok(len(hold) == 2 and "Negative amount" in hold[0], "Purchase: the negative bills their Type column calls “Purchase UP” are held the same way (%s)" % hold)
    ok(pg.locator("#app [data-sheet-panel] select[data-edit-type]").count() == 2, "and the panel's held rows have “Edit type” too")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    hb = E("""() => { const e = Object.values(D().entries).find(e => e.x.invoiceNo === 'DP/901'); if (!e) return null; e.natureId = "none"; try { approve(e); } catch (x){}
      return [e.x.total, e.noteKind || "", e.readNote || "", e.status, (e.uncertain || []).join()]; }""")
    ok(hb and hb[0] == -472 and hb[1] == "" and "Negative amount: is this a return?" in hb[2] and hb[3] == "draft", "the bill keeps the sheet's figure, says the reason, and cannot be approved as it is (%s)" % hb)
    # Edit type on the held bill, and the sheet again with its Type put right
    id902 = E("Object.values(D().entries).find(e => e.x.invoiceNo === 'DP/902').id")
    E("() => { SheetImport.close(); goStep('review', 'bills'); }"); W(500)
    E("(id) => { S.filter = 'draft'; S.selected = id; S.drawerOpen = true; render(); }", id902); W(700)
    ok(pg.locator('#app select[data-edit-type="%s"]' % id902).count() == 1, "the held bill has “Edit type”")
    if pg.locator('#app select[data-edit-type="%s"]' % id902).count(): pg.select_option('#app select[data-edit-type="%s"]' % id902, "credit"); W(400)
    else: E("(id) => billSetKind(id, 'credit')", id902)
    E("() => { S.drawerOpen = false; S.selected = null; render(); }"); W(300)
    b902 = E("(id) => { const e = D().entries[id]; return [e.noteKind || '', e.x.total, e.hold || '', vchTypeOf(e, CO()), e.tdsSkip || '']; }", id902)
    ok(b902 == ["credit", 118, "", "Debit Note", "note"], "Edit type → Debit Note (a return): the bill is one, its amount positive, held no more (%s)" % b902)
    id901 = E("Object.values(D().entries).find(e => e.x.invoiceNo === 'DP/901').id")
    E("() => goStep('review', 'bills')"); W(400)
    upload("purchase_held_fixed.xlsx", "#fileIn")
    if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
    res = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
    b = E("Object.values(D().entries).filter(e => /^DP\\/90/.test(e.x.invoiceNo) && e.status !== 'duplicate').map(e => [e.id, e.x.invoiceNo, e.noteKind || '', e.x.total, e.hold || '', e.status]).sort((a, b) => a[1].localeCompare(b[1]))")
    ok(len(b) == 2 and b[0] == [id901, "DP/901", "credit", 472, "", "draft"] and "1 held before, now put right" in res, "the corrected sheet puts the held bill right in place; the other is not added twice (%s; %s)" % (b, res))
    E("SheetImport.close()"); W(200)

    print("12. the final review: one number on two rows; Edit type's guards; no TDS on a return; the client's own type name")
    # -- Sales: UP/X/1 1,180 and UP/X/1 -472 (its Type says only "Sales UP")
    E("(id) => { S.tab = 'sales'; S.step = null; SL().list = []; SL().filter = 'review'; saveSales(); render(); }", cid); W(600)
    def up_sales(name):
        upload(name, "#salesIn")
        if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
        r = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
        E("SheetImport.close()"); W(200)
        return r
    rows = lambda: E("SL().list.map(v => [v.id, v.x.number, v.x.noteKind || '', v.x.total, !!v.hold]).sort((a, b) => b[3] - a[3])")
    up_sales("sales_repro.xlsx")
    r0 = rows()
    ok(len(r0) == 2 and r0[0][1:] == ["UP/X/1", "", 1180, False] and r0[1][1:] == ["UP/X/1", "", -472, True], "the two rows of UP/X/1: the invoice of 1,180, and the negative row held (%s)" % [x[1:] for x in r0])
    res = up_sales("sales_repro.xlsx")
    ok(rows() == r0 and "0 added" in res and "2 already here" in res and "put right" not in res, "the same sheet again: the held row is as it was (the 1,180 row does not rewrite it), nothing added (%s; %s)" % ([x[1:] for x in rows()], res))
    # Edit type does nothing to a row that is not held, or is not waiting
    g = E("""() => { const inv1 = SL().list.find(v => !v.hold), held = SL().list.find(v => v.hold); salesSetKind(inv1.id, "credit"); const a = [inv1.x.noteKind || "", inv1.x.number];
      held.status = "posted"; salesSetKind(held.id, "credit"); const b = [held.x.noteKind || "", held.x.total, !!held.hold]; held.status = "review"; return [a, b]; }"""); W(300)
    ok(g == [["", "UP/X/1"], ["", -472, True]], "Edit type does nothing to an invoice that is not held, nor to one already posted (%s)" % g)
    res = up_sales("sales_repro_fixed.xlsx")
    r1 = rows()
    ok(len(r1) == 2 and r1[0] == r0[0] and r1[1] == [r0[1][0], "UP/X/1 (CN)", "credit", 472, False] and "1 held before, now put right" in res and "1 already here" in res,
       "the corrected sheet: the held row itself becomes the credit note of 472; the invoice of 1,180 is untouched (%s; %s)" % ([x[1:] for x in r1], res))
    # -- Purchase: QP/2 1,180 and QP/2 -472; a 1,00,000 professional-fees bill and its return
    E("() => { S.tab = null; goStep('review', 'bills'); }"); W(600)
    def up_bills(name):
        upload(name, "#fileIn")
        for q in qids(): answer(q[0], "create")
        if pg.locator("#app [data-sheet-add]:not([disabled])").count(): pg.click("#app [data-sheet-add]"); W(900)
        r = pg.inner_text("#app [data-sheet-result]") if pg.locator("#app [data-sheet-result]").count() else ""
        E("SheetImport.close()"); W(200)
        return r
    qp = lambda ids=None: E("(ids) => Object.values(D().entries).filter(e => /^QP\\//.test(e.x.invoiceNo) && (ids ? ids.includes(e.id) : (e.hold || e.status !== 'duplicate'))).map(e => [e.id, e.x.invoiceNo, e.noteKind || '', e.x.total, !!e.hold, e.tdsSkip || '']).sort((a, b) => a[1].localeCompare(b[1]) || b[3] - a[3])", ids)
    up_bills("purchase_repro.xlsx")
    q0 = qp(); qids0 = [x[0] for x in q0]
    ok([x[1:] for x in q0] == [["QP/1", "", 118000, False, ""], ["QP/2", "", 1180, False, ""], ["QP/2", "", -472, True, ""], ["QP/R1", "credit", 118000, False, "note"]], "the bills: QP/2 of 1,180 and its negative row held; the return marked as carrying no TDS (%s)" % [x[1:] for x in q0])
    tds = E("""() => { const co = CO(); return ["QP/1", "QP/R1"].map(no => { const e = Object.values(D().entries).find(e => e.x.invoiceNo === no && e.status === "draft"); e.natureId = "professional"; const p = compute(e, S.coId);
      return [no, Math.round(num(p.tds)), vchTypeOf(e, co)]; }); }""")
    ok(len(tds) == 2 and tds[0][1] > 0 and tds[1][1] == 0 and tds[1][2] == "Debit Note", "professional fees of 1,00,000: the bill has TDS (%s), its return (a Debit Note) TDS 0 (%s)" % (tds[0][1] if tds else "", tds))
    held = [x for x in q0 if x[4]]
    hid = held[0][0] if held else ""
    na = E("""(id) => { const e = D().entries[id]; if (!e) return null; const keep = Object.assign({}, e.x); ["taxable", "igst", "total"].forEach(f => { e.x[f] = Math.abs(e.x[f]); }); e.natureId = "none";
      const miss = (compute(e, S.coId).missing || []).join("; "); try { approve(e); } catch (x){} const st = e.status; Object.assign(e.x, keep); return [st, miss]; }""", hid)
    ok(na and na[0] != "approved" and "its type" in na[1], "a held bill is not approved until its type is set, even with its amount typed positive (%s)" % na)
    res = up_bills("purchase_repro.xlsx")
    ok(qp(qids0) == q0 and "0 added" in res and "put right" not in res, "the same sheet again: the held bill is as it was (the 1,180 row does not rewrite it), nothing added (%s; %s)" % ([x[1:] for x in qp(qids0)], res))
    res = up_bills("purchase_repro_fixed.xlsx")
    q1 = qp(qids0)
    was = [x for x in q1 if x[0] == hid]
    ok(len(q1) == 4 and was and was[0][1:] == ["QP/2", "credit", 472, False, "note"] and [x for x in q1 if x[1] == "QP/2" and x[3] == 1180] == [x for x in q0 if x[1] == "QP/2" and x[3] == 1180] and "1 held before, now put right" in res,
       "the corrected sheet: the held bill itself becomes the return of 472 (no TDS on it); the bill of 1,180 is untouched (%s; %s)" % ([x[1:] for x in q1], res))
    g = E("""(id) => { const e = D().entries[id]; const st = e.status; e.hold = "x"; e.status = "approved"; billSetKind(id, "bill"); const a = [e.noteKind || "", e.tdsSkip || ""]; e.status = st; delete e.hold; return a; }""", hid)
    ok(g == ["credit", "note"], "Edit type does nothing to an approved bill (%s)" % g)
    # -- the client's own name for its purchase voucher type
    E("() => { const co = CO(); co.voucherType = 'Purchase GST'; delete co.postAs; goStep('review', 'bills'); }"); W(400)
    upload("purchase_journal.xlsx", "#fileIn")
    a = [pa(), vts().get("DP/801"), vts().get("DP/PR8")]
    if pa(): pg.select_option("#app [data-sheet-postas]", "Journal"); W(300)
    b = [pa(), vts().get("DP/801"), E("CO().voucherType"), E("billVt(CO())")]
    if pa(): pg.select_option("#app [data-sheet-postas]", "Purchase"); W(300)
    c = [pa(), vts().get("DP/801"), E("CO().voucherType"), E("billVt(CO())"), E("CO().postAs || null")]
    ok(a == ["Purchase", "Purchase GST", "Debit Note"] and b == ["Journal", "Journal", "Purchase GST", "Journal"] and c == ["Purchase", "Purchase GST", "Purchase GST", "Purchase GST", None],
       "a client whose own type is “Purchase GST”: Purchase posts as it; Journal chosen leaves the name alone; Purchase chosen back posts as it again (%s %s %s)" % (a, b, c))
    E("() => { SheetImport.close(); CO().voucherType = 'Journal'; delete CO().postAs; }"); W(200)
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
