"""python3 run_sales_tax_pick.py - the output GST ledgers of a sales invoice, picked by the state of the client's own
registration the invoice is issued from (next-fix-igst-pick, 16-Nov-2026: a client registered in two states keeps one
plain output IGST ledger and others tagged by state, and 20 of 21 invoices stayed red, "IGST output ledger not set").
Made-up books: three output IGST ledgers (plain, one named for Maharashtra, one tagged KA), CGST tagged by state code in context ((27), Code 29),
SGST by abbreviation and name; the client registered in 27 and 29.
  1. an inter-state invoice from the 27 GSTIN: the Maharashtra IGST ledger, "picked by state 27 Maharashtra" on hover;
     from the 29 GSTIN: the KA ledger; within Karnataka from 29: CGST 29 and SGST Karnataka, no "another state" problem,
     the voucher's company GSTIN the invoice's own; a branch seen with a GSTIN tells the next invoice of that branch;
  2. no own GSTIN and the registration not known: the only untagged IGST ledger;
  3. a ledger's own GSTIN in the Tally master tells its state;
  4. ambiguous: not ready, nothing guessed. The registration not known (several in the client setup): asked on each
     invoice's row, nothing kept for the client. Two ledgers of the invoice's known state: a one-click choice on the bar
     and the row, kept for the client and that state, every waiting invoice of it set at once; a posted invoice and a
     customer ledger set by a person are never changed. A branch seen with two states, and a seller GSTIN of another
     PAN, tell nothing;
  5. a sheet's "our GSTIN" and branch columns are read onto the invoice;
  6. (reviews of 2f8b825a7 and aec7142b3) numbers that are rates are not states: "Output IGST 18 / 12 / plain" for an Assam client,
     "Output CGST 14", "Output IGST Sales 12", "Output IGST FY 2026-27"; a one-registration client's rate-wise ledgers
     stay rate-wise; "UT GST" is no state, "J&K" and "Jammu & Kashmir" are.
  6a-c. ("05", a rate in the middle) a number in doubt is only offered; each ledger tagged on its own ("18% (Code 29)"
     is 29, never posted from 07); a setting or choice without a state never beats a state match; a client with one
     registration is picked as before 2f8b825a7, never a ledger of another rate;
  7. "Other GSTINs" keeps only real GSTINs of the client's PAN;
  8. (round 3) a GSTIN of the client's PAN not set up is "not the client's"; the client's GSTIN as set up always is, its
     check digit aside; with several registrations, Sales settings' ledger is used where none is tagged for the state,
     and offered where the state is not known.
Books alone never make a client multi-state: its client setup's GSTINs ("Other GSTINs") do.
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
           ["Output CGST", "Duties & Taxes"], ["Output CGST (27)", "Duties & Taxes"], ["Output CGST Code 29", "Duties & Taxes"],
           ["Output SGST - MH", "Duties & Taxes"], ["Output SGST Karnataka", "Duties & Taxes"], ["Input IGST", "Duties & Taxes"]]
SETL = """(leds) => { S.bank.ledgers = {list: leds.map(([name, group, gstin]) => ({name, group, gstin: gstin || ""})), importedAt: new Date().toISOString(), live: true}; S.bank.newLed = []; Ledgers.ver++; }"""
ADD = """([n, own, cg, cname, t, inter, extra]) => { const s = SL(), R = ((extra || {}).gst || 18) / 100; extra = Object.assign({}, extra); delete extra.gst;
  const v = newInvoice(Object.assign({number: n, date: "2026-10-05", sellerGstin: own, customerName: cname, customerGstin: cg, pos: cg.slice(0, 2), taxable: t,
    igst: inter ? r2(t * R) : 0, cgst: inter ? 0 : r2(t * R / 2), sgst: inter ? 0 : r2(t * R / 2), cess: 0, total: r2(t * (1 + R)), items: []}, extra), "upload");
  s.list.push(v); mapInvoice(v); return v.id; }"""
GET = """(n) => { const v = SL().list.find(v => v.x.number === n); const L = salesLines(v).filter(l => l.role === "tax");
  return {st: v.status, tax: L.map(l => l.ledger), why: L.map(l => l.why || ""), issues: (v.problems || []).concat(v.ledgerIssues || []), cust: v.customerLedger, src: v.custSource || ""}; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E, W = pg.evaluate, pg.wait_for_timeout
    G = E("""() => { const mk = (b) => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; };
      return {mh: mk('27AAACZ1234Q1Z'), ka: mk('29AAACZ1234Q1Z'), dl: mk('07AAACK5678P1Z'), dl2: mk('07AAACL5678P1Z'), ka2: mk('29AAACM5678P1Z'),
        as: mk('18AAACZ1234Q1Z'), mn: mk('14AAACZ1234Q1Z'), ar: mk('12AAACZ1234Q1Z'), kao: mk('29AAACY1234Q1Z'),
        as27: mk('27AAACZ1234Q1Z'), mn27: mk('27AAACZ1234Q1Z'), ar27: mk('27AAACZ1234Q1Z'), dl27: mk('07AAACZ1234Q1Z'), dl29: mk('29AAACZ1234Q1Z'),
        mhbad: (() => { const g = mk('27AAACZ1234Q1Z'); return g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A'); })(),
        kabad: (() => { const g = mk('29AAACZ1234Q1Z'); return g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A'); })()}; }""")
    cid = E("""(g) => { const c = newCompany({name: "ZZ Test Traders", gstin: g.mh}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }""", G)
    W(800)
    E(SETL, [l + [G["dl"]] if l[0] == "Kappa Retail" else l + [G["dl2"]] if l[0] == "Lambda Stores" else l + [G["ka2"]] if l[0] == "Mu Traders" else l for l in LEDGERS])
    # a registration only in the loaded books does not make the client multi-state (review of 2f8b825a7: the choice key
    # must not depend on what is loaded); the client setup's "Other GSTINs" does
    E("""(g) => { S.books = S.books && S.books.cid === CO().id ? S.books : Object.assign(S.books || {}, {cid: CO().id}); S.books.gstRegs = (S.books.gstRegs || []).concat([{gstin: g.ka}]); }""", G)
    ok(E("salesOwnStates()") == ["27"], "books alone: one registration (%s)" % E("salesOwnStates()"))
    E("(g) => { CO().otherGstins = g.ka; }", G)
    ok(sorted(E("salesOwnStates()")) == ["27", "29"], "the client setup's GSTINs: 27 and 29 (%s)" % E("salesOwnStates()"))

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
    ok(c["tax"] == ["Output CGST Code 29", "Output SGST Karnataka"] and not c["issues"] and c["st"] == "ready", "within Karnataka from 29: CGST by its code, SGST by its state name, no problem (%s)" % c)
    E(ADD, ["C/2", "", G["dl"], "Kappa Retail", 7000, True, {"branch": "Bengaluru"}])
    c2 = E(GET, "C/2")
    ok(c2["tax"] == ["Output IGST KA"] and "Bengaluru" in c2["why"][0], "no GSTIN on the invoice, its branch seen with the 29 GSTIN: Output IGST KA (%s)" % c2)
    E(ADD, ["A/2", G["mh"], G["mh"][:2] + "AAACQ9999R1Z" + "X", "Walk-in", 1000, False])
    a2 = E("(n) => salesLines(SL().list.find(v => v.x.number === n)).filter(l => l.role === 'tax').map(l => l.ledger)", "A/2")
    ok(a2 == ["Output CGST (27)", "Output SGST - MH"], "within Maharashtra from 27: CGST (27), SGST - MH (%s)" % a2)

    print("2. the only untagged ledger; the state not known is always asked")
    E(ADD, ["D/1", "", G["dl"], "Kappa Retail", 3000, True])
    d = E(GET, "D/1")
    ok(d["tax"] == [""] and d["st"] == "review" and E("SL().list.find(v => v.x.number === 'D/1').taxAsk[0].unknown") is True,
       "no own GSTIN, two registrations, no branch: asked, never the untagged \"Output IGST\" by itself (re-review 3) (%s)" % d)
    E(SETL, [l + [G["dl"]] if l[0] == "Kappa Retail" else l for l in LEDGERS if l[0] != "Output IGST KA"])
    E(ADD, ["2901", G["ka"], G["dl"], "Kappa Retail", 3000, True])
    d2 = E(GET, "2901")
    ok(d2["tax"] == ["Output IGST"] and d2["st"] == "ready" and "not tagged" in d2["why"][0], "from 29, no ledger tagged 29: the one untagged IGST ledger (%s)" % d2)
    E("() => { SL().list = SL().list.filter(v => v.x.number !== '2901'); }")
    E(SETL, [l + [G["dl"]] if l[0] == "Kappa Retail" else l + [G["dl2"]] if l[0] == "Lambda Stores" else l + [G["ka2"]] if l[0] == "Mu Traders" else l for l in LEDGERS])

    print("3. a ledger's GSTIN in the Tally master")
    E(SETL, [["Kappa Retail", "Sundry Debtors", G["dl"]], ["Lambda Stores", "Sundry Debtors", G["dl2"]], ["Sales Account", "Sales Accounts"], ["Output IGST (B)", "Duties & Taxes", G["ka"]], ["Output IGST (A)", "Duties & Taxes", G["mh"]]])
    E("() => SL().list.forEach(mapInvoice)")
    ok(E(GET, "B/1")["tax"] == ["Output IGST (B)"] and E(GET, "A/1")["tax"] == ["Output IGST (A)"], "no state in the names: each by the GSTIN on its master (%s, %s)" % (E(GET, "B/1")["tax"], E(GET, "A/1")["tax"]))

    print("4. ambiguous: a one-click choice, never a guess")
    E(SETL, [l + [G["dl"]] if l[0] == "Kappa Retail" else l + [G["dl2"]] if l[0] == "Lambda Stores" else l for l in LEDGERS if l[0] != "Output IGST"])
    E("() => { const s = SL(); s.list.forEach(v => { if (v.x.number === 'A/1'){ v.status = 'posted'; v.postedAt = new Date().toISOString(); } }); s.list.forEach(mapInvoice); }")
    E(ADD, ["E/1", "", G["dl"], "Kappa Retail", 4000, True])
    E(ADD, ["E/2", "", G["dl2"], "Lambda Stores", 6000, True])
    e1 = E(GET, "E/1")
    ok(e1["tax"] == [""] and e1["st"] == "review" and any("IGST output ledger not set" in i for i in e1["issues"]), "no own GSTIN, two registrations, only state ledgers: not set, To review (%s)" % e1)
    ok(E("salesLines(SL().list.find(v => v.x.number === 'E/1')).find(l => l.role === 'tax').cands") == ["IGST Output - Maharashtra", "Output IGST KA"], "the candidates: the two state ledgers")
    E("() => { SL().filter = 'review'; render(); }"); W(500)
    ok(pg.locator("#app .actionbar [data-tax-choice]").count() == 0 and pg.locator('#app .actionbar [data-tax-unknown="3"]').count() == 1,
       "the state not known: no choice for the client on the bar; it says 3 invoices are from an unknown GSTIN (D/1, E/1, E/2) (%s)" % pg.inner_text("#app .actionbar"))
    row = pg.locator('#app tr:has-text("E/1") [data-tax-pick]')
    ok(row.count() == 2, "the row: its two candidates as buttons (%d)" % row.count())
    posted0 = E("JSON.stringify(SL().list.find(v => v.x.number === 'A/1'))")
    pg.click('#app tr:has-text("E/1") [data-tax-pick="IGST Output - Maharashtra"]'); W(500)
    e1, e2, d1 = E(GET, "E/1"), E(GET, "E/2"), E(GET, "D/1")
    ok(e1["tax"] == ["IGST Output - Maharashtra"] and e1["st"] == "ready" and "on this invoice" in e1["why"][0], "a click on the row: that invoice only (%s)" % e1)
    ok(e2["tax"] == [""] and d1["tax"] == [""] and not E("SL().cfg.taxPick"), "the others still asked, nothing kept for the client (no \"@?\") (%s %s %s)" % (e2["tax"], d1["tax"], E("SL().cfg.taxPick")))
    E(ADD, ["E/3", "", G["dl"], "Kappa Retail", 900, True])
    ok(E(GET, "E/3")["tax"] == [""], "the next unknown-state invoice is asked again")

    print("4b. ambiguous within a known state: one click for the client and that state")
    E(SETL, [l + [G["dl"]] if l[0] == "Kappa Retail" else l + [G["dl2"]] if l[0] == "Lambda Stores" else l for l in LEDGERS if l[0] != "Output IGST"] + [["Output IGST MH (old)", "Duties & Taxes"]])
    E("() => SL().list.forEach(mapInvoice)")
    E(ADD, ["F/1", G["mh"], G["dl"], "Kappa Retail", 4000, True])
    E(ADD, ["F/2", G["mh"], G["dl2"], "Lambda Stores", 6000, True])
    E("() => { const v = SL().list.find(v => v.x.number === 'F/2'); v.customerLedger = 'Kappa Retail'; v.userLedger = true; v.custSource = 'Set by you'; mapInvoice(v); }")
    E("() => { SL().filter = 'review'; render(); }"); W(500)
    bar = pg.locator('#app .actionbar [data-tax-choice="igst_18@27"]')
    ok(bar.count() == 1 and bar.locator("[data-tax-pick]").count() == 2 and "2 invoices" in bar.inner_text(), "the bar: Output IGST for 27, two MH ledgers, 2 invoices (%s)" % (bar.inner_text() if bar.count() else pg.inner_text("#app .actionbar")))
    ok(E("SL().list.filter(v => /^F\\//.test(v.x.number) && v.status === 'ready').length") == 0, "nothing chosen: neither is ready to post")
    pg.click('#app .actionbar [data-tax-choice="igst_18@27"] [data-tax-pick="IGST Output - Maharashtra"]'); W(500)
    f1, f2 = E(GET, "F/1"), E(GET, "F/2")
    ok(f1["tax"] == ["IGST Output - Maharashtra"] and f2["tax"] == ["IGST Output - Maharashtra"] and f1["st"] == "ready" and "chosen by you for 27 Maharashtra" in f1["why"][0], "one click: both 27 invoices (%s, %s)" % (f1, f2))
    ok(f2["cust"] == "Kappa Retail" and f2["src"] == "Set by you", "the customer ledger a person set stands (%s)" % f2)
    ok(E("JSON.stringify(SL().list.find(v => v.x.number === 'A/1'))") == posted0, "the posted invoice is not touched")
    ok(E("SL().cfg.taxPick") == {"igst_18@27": "IGST Output - Maharashtra"}, "kept for the client and state 27 (%s)" % E("SL().cfg.taxPick"))
    E(ADD, ["F/3", G["mh"], G["dl"], "Kappa Retail", 900, True])
    ok(E(GET, "F/3")["tax"] == ["IGST Output - Maharashtra"] and E(GET, "E/2")["tax"] == [""], "the next 27 invoice takes it; an unknown-state one does not")
    ok(E(GET, "B/1")["tax"] == ["Output IGST KA"], "a 29 invoice is still picked by its state")
    E("() => { SL().filter = 'ready'; render(); }"); W(400)
    tip = pg.locator('#app tr:has-text("B/1") [data-tax-led]')
    ok(tip.count() == 1 and "Output IGST KA" in tip.inner_text() and "picked by state 29 Karnataka" in (tip.get_attribute("title") or ""), "the row shows the ledger picked, the reason on hover (%s)" % (tip.get_attribute("title") if tip.count() else ""))

    print("4c. a branch seen with two states; a seller GSTIN not the client's")
    E(ADD, ["G/1", G["mh"], G["dl"], "Kappa Retail", 100, True, {"branch": "Pune"}])
    E(ADD, ["G/2", G["ka"], G["dl"], "Kappa Retail", 100, True, {"branch": "Pune"}])
    E(ADD, ["G/3", "", G["dl"], "Kappa Retail", 100, True, {"branch": "Pune"}])
    ok(E("SL().cfg.regBy['b:pune']") == "*" and E(GET, "G/3")["tax"] == [""] and E("SL().list.find(v => v.x.number === 'G/3').taxAsk[0].unknown") is True, "branch Pune seen with 27 and 29: unknown, asked (%s)" % E("SL().cfg.regBy"))
    E(ADD, ["H/1", G["ka2"], G["dl"], "Kappa Retail", 100, True])
    h = E(GET, "H/1")
    ok(h["tax"] == [""] and any("seller GSTIN" in i for i in h["issues"]), "another PAN's 29 GSTIN as the seller: not used for the pick, and said (%s)" % h)

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

    print("6. rates are not states (review of 2f8b825a7, re-review of aec7142b3)")
    tags = E("""() => ["Output IGST 18", "Output IGST (27)", "Output IGST - 27 MH", "Output IGST State 29", "Output IGST 27", "Output IGST FY 2026-27", "Output UT GST", "Output IGST J&K", "IGST Jammu & Kashmir", "Output IGST (18)", "Output IGST 18% (Code 29)", "Output IGST Branch 05"].map(n => ledgerStateTag({name: n}))""")
    ok(tags == ["", "27", "27", "29", "", "", "", "01", "01", "", "29", ""], "the state tags, each ledger on its own: a rate, (27), - 27 MH, State 29, a bare 27, a year, UT GST, J&K, Jammu & Kashmir, (18), 18%% (Code 29), Branch 05 (%s)" % tags)
    ri = E("""() => ["Output IGST Branch 05", "Output IGST 05", "Output IGST 5", "Output IGST 18 Sales", "Output IGST Sales 12", "Output IGST 18% (Code 29)", "Output CGST 14", "Output IGST @ 12"].map(n => { const r = ledgerRateInfo(n); return [r.rates, r.doubt]; })""")
    ok(ri == [[[], True], [[], True], [[5], False], [[], True], [[12], False], [[18], False], [[14], False], [[12], False]],
       "the rates read: not Branch 05, not 05 (leading zero), 5 at the end, 18 in the middle only a doubt, Sales 12, 18%% beside Code 29, CGST 14, @ 12 (%s)" % ri)
    def client(gstin, others, leds, setl=None):
        E("([g, o, sl]) => { CO().gstin = g; CO().pan = g.slice(2, 12); CO().otherGstins = o; SL().list = []; SL().cfg.taxPick = {}; SL().cfg.regBy = {}; SL().cfg.ledgers = sl || {}; }", [gstin, others, setl])
        E(SETL, [["Kappa Retail", "Sundry Debtors", G["dl"]], ["Walk-in", "Sundry Debtors"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"]] + [[n, "Duties & Taxes"] for n in leds])
    T = lambda n: E(GET, n)["tax"]
    C = lambda n: E("(n) => (SL().list.find(v => v.x.number === n).taxAsk[0] || {}).cands || null", n)
    print("6a. several registrations: by the rate, then the state")
    client(G["as"], G["as27"], ["Output IGST 18", "Output IGST 12", "Output IGST"])
    for n, r in [("R/18", 18), ("R/12", 12), ("R/5", 5)]: E(ADD, [n, G["as"], G["dl"], "Kappa Retail", 1000, True, {"gst": r}])
    ok([T("R/18"), T("R/12"), T("R/5")] == [["Output IGST 18"], ["Output IGST 12"], ["Output IGST"]], "an Assam (18) client, also in 27: 18%% → IGST 18, 12%% → IGST 12 (not Assam), 5%% → the plain one (%s)" % [T("R/18"), T("R/12"), T("R/5")])
    client(G["mn"], G["mn27"], ["Output CGST 14", "Output CGST 9", "Output CGST", "Output SGST"])
    for n, r in [("M/28", 28), ("M/18", 18), ("M/5", 5)]: E(ADD, [n, G["mn"], "", "Walk-in", 1000, False, {"gst": r}])
    ok([T("M/28")[0], T("M/18")[0], T("M/5")[0]] == ["Output CGST 14", "Output CGST 9", "Output CGST"], "a Manipur (14) client: CGST 14 is half of 28%%, not Manipur (%s)" % [T("M/28"), T("M/18"), T("M/5")])
    client(G["ar"], G["ar27"], ["Output IGST Sales 12", "Output IGST Sales 18"])
    for n, r in [("P/18", 18), ("P/12", 12)]: E(ADD, [n, G["ar"], G["dl"], "Kappa Retail", 1000, True, {"gst": r}])
    ok([T("P/18"), T("P/12")] == [["Output IGST Sales 18"], ["Output IGST Sales 12"]], "an Arunachal (12) client: Output IGST Sales 12 / 18 by the rate (%s)" % [T("P/18"), T("P/12")])
    client(G["mh"], G["ka"], ["Output IGST FY 2026-27", "Output IGST"])
    E(ADD, ["Y/1", G["mh"], G["dl"], "Kappa Retail", 1000, True])
    y = E(GET, "Y/1")
    ok(y["tax"] == [""] and C("Y/1") and len(C("Y/1")) == 2, "a 27 invoice and an \"FY 2026-27\" ledger: not read as state 27, asked (%s)" % y)
    client(G["mh"], G["ka"], ["Output IGST Branch 05", "Output IGST 18%"])
    E(ADD, ["B5/1", G["mh"], G["dl"], "Kappa Retail", 1000, True, {"gst": 5}])
    ok(T("B5/1") == [""] and C("B5/1") == ["Output IGST Branch 05"], "a 5%% invoice: \"Branch 05\" is no 5%% ledger and, its number in doubt, only offered (%s)" % C("B5/1"))
    client(G["dl27"], G["dl29"], ["Output IGST 18% (Code 29)", "Output IGST 12%"])
    E(ADD, ["Z/1", G["dl27"], G["ka2"], "Kappa Retail", 1000, True])
    ok(T("Z/1") == [""] and C("Z/1") is None, "a 07 invoice at 18%%: \"Output IGST 18%% (Code 29)\" is still 29, never posted for 07 (%s)" % C("Z/1"))
    print("6b. a choice or setting without a state never beats a state match")
    client(G["mh"], G["ka"], ["Output IGST", "IGST Output - Maharashtra", "Output IGST KA"], {"igst": "Output IGST"})
    E("() => { SL().cfg.taxPick = {igst_18: 'Output IGST', igst: 'Output IGST'}; }")
    E(ADD, ["S6/1", G["ka"], G["dl"], "Kappa Retail", 1000, True])
    E(ADD, ["S6/2", G["mh"], G["dl"], "Kappa Retail", 1000, True])
    E(ADD, ["S6/3", "", G["dl"], "Kappa Retail", 1000, True])
    ok([T("S6/1"), T("S6/2"), T("S6/3")] == [["Output IGST KA"], ["IGST Output - Maharashtra"], [""]], "Sales settings' plain IGST and a plain kept choice: the state's own ledger wins; the state not known is asked (%s)" % [T("S6/1"), T("S6/2"), T("S6/3")])
    print("6c. one registration: as before 2f8b825a7, never another rate")
    client(G["mh"], "", ["Output IGST 5%", "Output IGST 12% Karnataka"])
    E(ADD, ["O/2", "", G["dl"], "Kappa Retail", 1000, True])
    ok(T("O/2") == [""] and C("O/2") is None, "27 only, an 18%% invoice, \"5%%\" and \"12%% Karnataka\": not set, nothing of another rate offered (%s)" % C("O/2"))
    client(G["mh"], "", ["Output IGST 5%", "Output IGST 12% Maharashtra"])
    E(ADD, ["O/1", "", G["dl"], "Kappa Retail", 1000, True])
    ok(T("O/1") == [""] and C("O/1") is None, "27 only, \"5%%\" and \"12%% Maharashtra\": not set (was \"12%% Maharashtra\") (%s)" % T("O/1"))
    client(G["as"], "", ["Output IGST 18", "Output IGST 12", "Output IGST"])
    E(ADD, ["Q/1", "", G["dl"], "Kappa Retail", 1000, True])
    ok(T("Q/1") == [""] and C("Q/1") == ["Output IGST 18", "Output IGST"], "an Assam client with one registration: not set as before; offered the 18 and the plain one, never 12 (%s)" % C("Q/1"))
    client(G["kao"], "", ["Output IGST 18%", "Output IGST 12%", "Output IGST KA"])
    for n, r in [("K/18", 18), ("K/12", 12)]: E(ADD, [n, "", G["dl"], "Kappa Retail", 1000, True, {"gst": r}])
    ok([T("K/18"), T("K/12")] == [["Output IGST 18%"], ["Output IGST 12%"]], "one registration, rate-wise ledgers and a state one: rate-wise as before (%s)" % [T("K/18"), T("K/12")])
    client(G["mh"], "", ["Output IGST", "IGST Output - Maharashtra"])
    E(ADD, ["Q/2", "", G["dl"], "Kappa Retail", 1000, True])
    ok(T("Q/2") == [""] and C("Q/2") == ["Output IGST", "IGST Output - Maharashtra"], "one registration, a plain and a state-named ledger: not set as before, both offered (%s)" % C("Q/2"))

    print("7. Other GSTINs: only real GSTINs of the client's PAN")
    client(G["mh"], "", ["Output IGST"])
    kept = E("""(g) => { CO().otherGstins = [g.ka, g.ka2, g.kabad].join(", "); coCommit("otherGstins"); return CO().otherGstins; }""", G)
    ok(kept == G["ka"], "another PAN's and a bad check digit dropped on saving (%s)" % kept)
    E("""(g) => { CO().otherGstins = [g.ka2, g.kabad].join(", "); }""", G)
    ok(E("salesOwnStates()") == ["27"] and not E("(g) => salesIsOwn(g.kabad)", G) and not E("(g) => salesIsOwn(g.ka2)", G) and not E("(g) => salesIsOwn(g.ka)", G),
       "typed in by other means: still not the client's; a 29 GSTIN of its PAN not listed is not its own either (%s)" % E("salesOwnStates()"))

    print("8. round 3: the same PAN alone is not enough; the client's own GSTIN always is; Sales settings with several")
    client(G["mh"], "", ["Output IGST"])
    E(ADD, ["U/1", G["ka"], G["dl"], "Kappa Retail", 1000, True])
    u = E(GET, "U/1"); xml = E("salesVoucherXml(SL().list[0], CO())")
    ok(u["st"] == "review" and any("seller GSTIN" in i for i in u["issues"]) and "<CMPGSTIN>" + G["mh"] + "</CMPGSTIN>" in xml,
       "27 only, an invoice from the PAN's 29 GSTIN (a GSTR-1 of it): \"not the client's\", not ready, CMPGSTIN 27 (%s)" % u["issues"])
    client(G["mhbad"], "", ["Output IGST"])
    E(ADD, ["U/2", G["mhbad"], G["dl"], "Kappa Retail", 1000, True])
    u2 = E(GET, "U/2")
    ok(not any("seller GSTIN" in i for i in u2["issues"]) and E("(g) => salesIsOwn(g.mhbad)", G) and E("salesOwnStates()") == ["27"],
       "the client's GSTIN as set up, its check digit wrong: the invoice from it is the client's own (%s)" % u2["issues"])
    client(G["mh"], G["ka"], [], {"igst": "Tax Output Inter-state"})
    E(SETL, [["Kappa Retail", "Sundry Debtors", G["dl"]], ["Sales Account", "Sales Accounts"], ["Tax Output Inter-state", "Duties & Taxes"]])
    E(ADD, ["V/1", G["ka"], G["dl"], "Kappa Retail", 1000, True])
    E(ADD, ["8802", "", G["dl"], "Kappa Retail", 1000, True])
    ok(T("V/1") == ["Tax Output Inter-state"] and T("8802") == [""] and C("8802") == ["Tax Output Inter-state"],
       "27+29, Sales settings' IGST the only one: used for a 29 invoice as before; offered for one of unknown state (%s, %s)" % (T("V/1"), C("8802")))
    client(G["mh"], G["ka"], ["Output IGST KA"], {"igst": "Tax Output Inter-state"})
    E(SETL, [["Kappa Retail", "Sundry Debtors", G["dl"]], ["Sales Account", "Sales Accounts"], ["Tax Output Inter-state", "Duties & Taxes"], ["Output IGST KA", "Duties & Taxes"]])
    E(ADD, ["V/3", G["mh"], G["dl"], "Kappa Retail", 1000, True])
    E(ADD, ["V/4", G["ka"], G["dl"], "Kappa Retail", 1000, True])
    ok(T("V/3") == ["Tax Output Inter-state"] and T("V/4") == ["Output IGST KA"], "none tagged 27: the settings ledger; 29: its own ledger first (%s, %s)" % (T("V/3"), T("V/4")))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
