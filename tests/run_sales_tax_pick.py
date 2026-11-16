"""python3 run_sales_tax_pick.py - the output GST ledgers of a sales invoice, picked by the state of the client's own
registration the invoice is issued from (next-fix-igst-pick, 16-Nov-2026: a client registered in two states keeps one
plain output IGST ledger and others tagged by state, and 20 of 21 invoices stayed red, "IGST output ledger not set").
Made-up books: three output IGST ledgers (plain, one named for Maharashtra, one tagged KA), CGST tagged by state code,
SGST by abbreviation and name; the client registered in 27 and 29.
  1. an inter-state invoice from the 27 GSTIN: the Maharashtra IGST ledger, "picked by state 27 Maharashtra" on hover;
     from the 29 GSTIN: the KA ledger; within Karnataka from 29: CGST 29 and SGST Karnataka, no "another state" problem,
     the voucher's company GSTIN the invoice's own; a branch seen with a GSTIN tells the next invoice of that branch;
  2. no own GSTIN and the registration not known: the only untagged IGST ledger;
  3. a ledger's own GSTIN in the Tally master tells its state;
  4. ambiguous (only state ledgers, the registration not known): not ready, nothing guessed; a one-click choice on the
     bar and on the row; one click sets every waiting invoice of the client, remembered for the next; a posted invoice
     and a customer ledger set by a person are never changed; the voucher type stays the screen's;
  5. a sheet's "our GSTIN" and branch columns are read onto the invoice.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sales_tax_pick.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PORT = int(os.environ.get("TAXPICK_PORT") or 8163)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

LEDGERS = [["Kappa Retail", "Sundry Debtors"], ["Lambda Stores", "Sundry Debtors"], ["Mu Traders", "Sundry Debtors"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
           ["Output IGST", "Duties & Taxes"], ["IGST Output - Maharashtra", "Duties & Taxes"], ["Output IGST KA", "Duties & Taxes"],
           ["Output CGST", "Duties & Taxes"], ["Output CGST 27", "Duties & Taxes"], ["Output CGST 29", "Duties & Taxes"],
           ["Output SGST - MH", "Duties & Taxes"], ["Output SGST Karnataka", "Duties & Taxes"], ["Input IGST", "Duties & Taxes"]]
SETL = """(leds) => { S.bank.ledgers = {list: leds.map(([name, group, gstin]) => ({name, group, gstin: gstin || ""})), importedAt: new Date().toISOString(), live: true}; S.bank.newLed = []; Ledgers.ver++; }"""
ADD = """([n, own, cg, cname, t, inter, extra]) => { const s = SL();
  const v = newInvoice(Object.assign({number: n, date: "2026-10-05", sellerGstin: own, customerName: cname, customerGstin: cg, pos: cg.slice(0, 2), taxable: t,
    igst: inter ? r2(t * .18) : 0, cgst: inter ? 0 : r2(t * .09), sgst: inter ? 0 : r2(t * .09), cess: 0, total: r2(t * 1.18), items: []}, extra || {}), "upload");
  s.list.push(v); mapInvoice(v); return v.id; }"""
GET = """(n) => { const v = SL().list.find(v => v.x.number === n); const L = salesLines(v).filter(l => l.role === "tax");
  return {st: v.status, tax: L.map(l => l.ledger), why: L.map(l => l.why || ""), issues: (v.problems || []).concat(v.ledgerIssues || []), cust: v.customerLedger, src: v.custSource || ""}; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E, W = pg.evaluate, pg.wait_for_timeout
    G = E("""() => { const mk = (b) => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; };
      return {mh: mk('27AAACZ1234Q1Z'), ka: mk('29AAACZ1234Q1Z'), dl: mk('07AAACK5678P1Z'), dl2: mk('07AAACL5678P1Z'), ka2: mk('29AAACM5678P1Z')}; }""")
    cid = E("""(g) => { const c = newCompany({name: "ZZ Test Traders", gstin: g.mh}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }""", G)
    W(800)
    E(SETL, [l + [G["dl"]] if l[0] == "Kappa Retail" else l + [G["dl2"]] if l[0] == "Lambda Stores" else l + [G["ka2"]] if l[0] == "Mu Traders" else l for l in LEDGERS])
    # the client's second registration (GST settings keeps it with the books)
    E("""(g) => { S.books = S.books && S.books.cid === CO().id ? S.books : Object.assign(S.books || {}, {cid: CO().id}); S.books.gstRegs = (S.books.gstRegs || []).concat([{gstin: g.ka}]); }""", G)
    ok(sorted(E("salesOwnStates()")) == ["27", "29"], "the client's registrations: 27 and 29 (%s)" % E("salesOwnStates()"))

    print("1. picked by the state of the invoice's own GSTIN")
    E(ADD, ["A/1", G["mh"], G["dl"], "Kappa Retail", 10000, True])
    a = E(GET, "A/1")
    ok(a["tax"] == ["IGST Output - Maharashtra"] and a["st"] == "ready", "from the 27 GSTIN to Delhi: IGST Output - Maharashtra, ready (%s)" % a)
    ok("picked by state 27 Maharashtra" in a["why"][0], "the reason: %s" % a["why"])
    E(ADD, ["B/1", G["ka"], G["dl"], "Kappa Retail", 20000, True])
    b = E(GET, "B/1")
    ok(b["tax"] == ["Output IGST KA"] and b["st"] == "ready" and "29 Karnataka" in b["why"][0], "from the 29 GSTIN: Output IGST KA (abbreviation), ready (%s)" % b)
    xml = E("salesVoucherXml(SL().list.find(v => v.x.number === 'B/1'), CO())")
    ok("<CMPGSTIN>" + G["ka"] + "</CMPGSTIN>" in xml and 'VCHTYPE="Sales"' in xml and "<LEDGERNAME>Output IGST KA</LEDGERNAME>" in xml, "its voucher: the 29 company GSTIN, a Sales voucher, the KA ledger")
    E(ADD, ["C/1", G["ka"], G["ka2"], "Mu Traders", 5000, False, {"branch": "Bengaluru"}])
    c = E(GET, "C/1")
    ok(c["tax"] == ["Output CGST 29", "Output SGST Karnataka"] and not c["issues"] and c["st"] == "ready", "within Karnataka from 29: CGST by its code, SGST by its state name, no problem (%s)" % c)
    E(ADD, ["C/2", "", G["dl"], "Kappa Retail", 7000, True, {"branch": "Bengaluru"}])
    c2 = E(GET, "C/2")
    ok(c2["tax"] == ["Output IGST KA"] and "Bengaluru" in c2["why"][0], "no GSTIN on the invoice, its branch seen with the 29 GSTIN: Output IGST KA (%s)" % c2)
    E(ADD, ["A/2", G["mh"], G["mh"][:2] + "AAACQ9999R1Z" + "X", "Walk-in", 1000, False])
    a2 = E("(n) => salesLines(SL().list.find(v => v.x.number === n)).filter(l => l.role === 'tax').map(l => l.ledger)", "A/2")
    ok(a2 == ["Output CGST 27", "Output SGST - MH"], "within Maharashtra from 27: CGST 27, SGST - MH (%s)" % a2)

    print("2. the only untagged ledger")
    E(ADD, ["D/1", "", G["dl"], "Kappa Retail", 3000, True])
    d = E(GET, "D/1")
    ok(d["tax"] == ["Output IGST"] and d["st"] == "ready" and "not tagged" in d["why"][0], "no own GSTIN, two registrations, no branch: the one untagged IGST ledger (%s)" % d)

    print("3. a ledger's GSTIN in the Tally master")
    E(SETL, [["Kappa Retail", "Sundry Debtors", G["dl"]], ["Lambda Stores", "Sundry Debtors", G["dl2"]], ["Sales Account", "Sales Accounts"], ["Output IGST (B)", "Duties & Taxes", G["ka"]], ["Output IGST (A)", "Duties & Taxes", G["mh"]]])
    E("() => SL().list.forEach(mapInvoice)")
    ok(E(GET, "B/1")["tax"] == ["Output IGST (B)"] and E(GET, "A/1")["tax"] == ["Output IGST (A)"], "no state in the names: each by the GSTIN on its master (%s, %s)" % (E(GET, "B/1")["tax"], E(GET, "A/1")["tax"]))

    print("4. ambiguous: a one-click choice, never a guess")
    E(SETL, [l + [G["dl"]] if l[0] == "Kappa Retail" else l + [G["dl2"]] if l[0] == "Lambda Stores" else l for l in LEDGERS if l[0] != "Output IGST"])
    E("() => { const s = SL(); s.list.filter(v => v.x.number !== 'B/1').forEach(v => { if (v.x.number === 'A/1'){ v.status = 'posted'; v.postedAt = new Date().toISOString(); } }); s.list.forEach(mapInvoice); }")
    E(ADD, ["E/1", "", G["dl"], "Kappa Retail", 4000, True])
    E(ADD, ["E/2", "", G["dl2"], "Lambda Stores", 6000, True])
    E("() => { const v = SL().list.find(v => v.x.number === 'E/2'); v.customerLedger = 'Kappa Retail'; v.userLedger = true; v.custSource = 'Set by you'; mapInvoice(v); }")
    e1, e2 = E(GET, "E/1"), E(GET, "E/2")
    ok(e1["tax"] == [""] and e1["st"] == "review" and any("IGST output ledger not set" in i for i in e1["issues"]), "no own GSTIN, only state ledgers: not set, To review (%s)" % e1)
    ok(E("salesLines(SL().list.find(v => v.x.number === 'E/1')).find(l => l.role === 'tax').cands") == ["IGST Output - Maharashtra", "Output IGST KA"], "the candidates: the two state ledgers")
    E("() => { SL().filter = 'review'; render(); }"); W(500)
    bar = pg.locator("#app .actionbar [data-tax-choice]")
    ok(bar.count() == 1 and bar.locator("[data-tax-pick]").count() == 2 and "3 invoices" in bar.inner_text(), "the bar: one choice, its two ledgers as buttons, for the 3 invoices waiting (D/1 too) (%s)" % (bar.inner_text() if bar.count() else ""))
    row = pg.locator('#app tr:has-text("E/1") [data-tax-pick]')
    ok(row.count() == 2, "the row: the same two buttons (%d)" % row.count())
    ok(E("SL().list.filter(v => ['E/1', 'E/2'].includes(v.x.number) && v.status === 'ready').length") == 0, "nothing chosen: neither invoice is ready to post")
    posted0 = E("JSON.stringify(SL().list.find(v => v.x.number === 'A/1'))")
    pg.click('#app tr:has-text("E/1") [data-tax-pick="IGST Output - Maharashtra"]'); W(500)
    e1, e2 = E(GET, "E/1"), E(GET, "E/2")
    ok(e1["tax"] == ["IGST Output - Maharashtra"] and e2["tax"] == ["IGST Output - Maharashtra"] and e1["st"] == "ready", "one click: every waiting invoice takes it (%s, %s)" % (e1, e2))
    ok(E(GET, "D/1")["tax"] == ["IGST Output - Maharashtra"], "D/1 too")
    ok("chosen by you" in e1["why"][0], "the reason: %s" % e1["why"])
    ok(e2["cust"] == "Kappa Retail" and e2["src"] == "Set by you", "the customer ledger a person set stands (%s)" % e2)
    ok(E("JSON.stringify(SL().list.find(v => v.x.number === 'A/1'))") == posted0, "the posted invoice is not touched")
    ok(pg.locator("#app .actionbar [data-tax-choice]").count() == 0, "the bar's choice is gone")
    ok(E("Object.values(SL().cfg.taxPick || {})") == ["IGST Output - Maharashtra"], "remembered for the client (%s)" % E("SL().cfg.taxPick"))
    E(ADD, ["E/3", "", G["dl"], "Kappa Retail", 900, True])
    ok(E(GET, "E/3")["tax"] == ["IGST Output - Maharashtra"], "the next such invoice takes the choice")
    ok(E(GET, "B/1")["tax"] == ["Output IGST KA"], "an invoice whose registration is known is still picked by its state")
    E("() => { SL().filter = 'ready'; render(); }"); W(400)
    tip = pg.locator('#app tr:has-text("B/1") [data-tax-led]')
    ok(tip.count() == 1 and "Output IGST KA" in tip.inner_text() and "picked by state 29 Karnataka" in (tip.get_attribute("title") or ""), "the row shows the ledger picked, the reason on hover (%s)" % (tip.get_attribute("title") if tip.count() else ""))

    print("5. a sheet's own-GSTIN and branch columns")
    E("() => registersLoad()")
    docs = E("""(g) => SheetFmt.apply({map: {no: "vchno", date: "date", party: "customer", gstin: "gstin", owngstin: "ourgstin", branch: "branch", taxable: "taxable", igst: "igst", total: "total"}, transforms: {date: "dmy"}},
      [["Date", "Vch No", "Customer", "GSTIN", "Our GSTIN", "Branch", "Taxable", "IGST", "Total"], ["05-10-2026", "S/9", "Kappa Retail", g.dl, g.ka, "Bengaluru", 100, 18, 118]], 0, CO(), "sales")
      .map(d => [d.own, d.branch])""", G)
    ok(docs == [[G["ka"], "Bengaluru"]], "read from the sheet (%s)" % docs)
    r = E("""(g) => { const r = SheetPost.toSales(SheetFmt.apply({map: {no: "vchno", date: "date", party: "customer", gstin: "gstin", owngstin: "ourgstin", taxable: "taxable", igst: "igst", total: "total"}, transforms: {date: "dmy"}},
      [["Date", "Vch No", "Customer", "GSTIN", "Our GSTIN", "Taxable", "IGST", "Total"], ["05-10-2026", "S/9", "Kappa Retail", g.dl, g.ka, 100, 18, 118]], 0, CO(), "sales"), CO().id, "s.xlsx");
      const v = SL().list.find(v => v.x.number === "S/9"); return [v.x.sellerGstin, salesLines(v).filter(l => l.role === "tax").map(l => l.ledger)]; }""", G)
    ok(r == [G["ka"], ["Output IGST KA"]], "the invoice made from it: its own GSTIN, the KA ledger (%s)" % r)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
