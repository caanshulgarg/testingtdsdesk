"""python3 run_bill_auto_ledgers.py - the review of 02-Oct-2026 (A1-A8): one ledger list for the whole app, read from
FinCom's cloud copy (1,110 ledgers) and never replaced by a shorter browser copy; the drop-down is a search ("kashi" finds
"Kashi IT Solutions"), an expense box never offers an income ledger; a bill whose supplier GSTIN matches a Tally ledger
gets its party, expense, GST and TDS ledgers by itself, each with why; GST ledgers by tax head (a ledger of another head is
refused, on the bill and in Client setup; scrambled Client setup values are put right); TDS ledgers by section.
Uses Testing AAD's books (tests/data/books-cache.json, gst-cache.json: client data, not in git) and a ledger list built
from them (the books' ledgers and groups, Kashi IT Solutions with its GSTIN, padded to the cloud copy's 1,110).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bill_auto_ledgers.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8207), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books, gst = gstfix.load()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the cloud copy's ledger list (tally_ledgers): every ledger the books name, with its group; Kashi IT Solutions with its
# GSTIN; ledgers without entries (as the cloud has 1,110) to make up the count
rows = {}
for v in books["vouchers"]:
    for e in v["ent"]: rows.setdefault(e["l"], {"name": e["l"], "parent": books["under"].get(e["l"], "")})
for n, g in books["under"].items(): rows.setdefault(n, {"name": n, "parent": g})
# Kashi IT Solutions as the cloud list has it today (no GSTIN column yet); its GSTIN comes from the books copy (ledInfo)
rows["Kashi IT Solutions"] = {"name": "Kashi IT Solutions", "parent": "Sundry Creditors"}
rows["Aadi Info Solutions Pvt. Ltd"] = {"name": "Aadi Info Solutions Pvt. Ltd", "parent": "Sundry Creditors"}
rows.setdefault("Advertisment Exp.", {"name": "Advertisment Exp.", "parent": "Indirect Expenses"})
i = 0
while len(rows) < 1110:
    i += 1; rows["Old Debtor %04d" % i] = {"name": "Old Debtor %04d" % i, "parent": "Sundry Debtors"}
ROWS = sorted(rows.values(), key=lambda r: r["name"])
GROUPS = [{"name": k, "parent": v} for k, v in books["groups"].items()]

CLOUD = """([rows, groups]) => {
  const cid = S.coId, bk = {book: 'bk-aad', from: '2025-04-01', to: '2026-03-31', ledgersAt: '2026-10-02T05:26:00Z', company: 'GARG SHEKHAR & COMPANY'};
  TCloud.on = () => true; TCloud.st[cid] = {books: [bk], at: Date.now()}; TCloud.status = async function(c){ return (this.st[c] || {}).books || []; };
  window.__rows = rows; window.__reads = 0;
  TCloud.restAll = async (p) => { if (/^tally_ledgers/.test(p)){ window.__reads++; return window.__rows; } return /^tally_groups/.test(p) ? groups : []; };
  Cloud.api = async () => [];
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8207/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(gstfix.SETUP, [books, gst]); pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render()"); pg.wait_for_timeout(500)
    E = lambda js, *a: pg.evaluate(js, *a)
    # the ledger masters as the books copy keeps them (staging client_book_items "ledInfo", "gstins", "pans")
    E("""(info) => { const b = S.books; b.ledInfo = Object.assign({}, info, {'Kashi IT Solutions': {group: 'Sundry Creditors', gstin: '09DEYPD8166R1Z5', panFrom: 'GSTIN'}, 'Aadi Info Solutions Pvt. Ltd': {group: 'Sundry Creditors'}});
      b.gstins = Object.assign({}, b.gstins, {'Kashi IT Solutions': '09DEYPD8166R1Z5'}); b.pans = Object.assign({}, b.pans, {'Kashi IT Solutions': 'DEYPD8166R'}); }""", gst["ledInfo"])
    # the scrambled Client setup of staging, and TDS defaults all on "TDS 94H"
    E("""() => { const co = CO(); co.gst = Object.assign(co.gst || {}, {cgst: 'INPUT CGST', sgst: 'INPUT IGST', igst: '07 IGST INPUT'});
      Object.assign(co.tdsLedgers, {goods: 'TDS 94H', director: 'TDS 94H', interest: 'TDS 94H', commission: 'TDS 94H'}); }""")

    # A1/A2. a shorter, older copy kept in this browser (as on staging), then the cloud copy of 1,110
    short = [{"name": r["name"], "group": r["parent"]} for r in ROWS[:600] if r["name"] != "Kashi IT Solutions"]
    E("""async (short) => { await BankDB.set('ledgers:' + S.coId, {list: short, importedAt: '2026-09-20T10:00:00Z', file: 'Tally (live)', live: true}); await loadBank(S.coId); }""", short)
    pg.wait_for_timeout(300)
    ok(E("Ledgers.list().length") == len(short) and E("exactLedger('Kashi IT Solutions')") is None, "before: the browser's copy of %d ledgers, without Kashi IT Solutions" % len(short))
    E(CLOUD, [ROWS, GROUPS])
    r = E("Ledgers.load(S.coId)")
    ok(r["ok"] and r["n"] == 1110 and E("Ledgers.list().length") == 1110 and E("S.bank.ledgers.list.length") == 1110, "the cloud copy is read when the client is linked: 1,110 ledgers, the bank's copy too (%s)" % r)
    ok(E("exactLedger('Kashi IT Solutions')") == "Kashi IT Solutions" and E("Ledgers.ids(S.coId, 'Kashi IT Solutions').gstin") == "09DEYPD8166R1Z5", "Kashi IT Solutions is a known ledger, with its GSTIN from the books copy")
    pg.wait_for_timeout(1200)
    saved = E("BankDB.get('ledgers:' + S.coId).then(x => (x.list || []).length)")
    ok(saved == 1110, "the browser's copy is replaced by the 1,110 (%s)" % saved)
    # a short list never replaces the longer one: a browser copy, or an older read
    E("(short) => Ledgers.fromBrowser(S.coId, {list: short, importedAt: '2026-10-02T09:00:00Z'})", short)
    t1 = E("(short) => Ledgers.take(S.coId, {list: short, src: 'cloud', srcAt: '2026-09-01T00:00:00Z', at: new Date().toISOString()})", short)
    E("(short) => { window.__rows = short.map(l => ({name: l.name, parent: l.group})); }", short)
    E("""() => { TCloud.st[S.coId].books[0].ledgersAt = '2026-09-01T00:00:00Z'; }""")
    r2 = E("Ledgers.load(S.coId, {force: true})")
    ok(t1 is False and E("Ledgers.list().length") == 1110 and E("S.bank.ledgers.list.length") == 1110, "a shorter, older list (browser copy or cloud read) never replaces the 1,110 (%s)" % r2)
    E("(rows) => { window.__rows = rows; TCloud.st[S.coId].books[0].ledgersAt = '2026-10-02T05:26:00Z'; }", ROWS)
    n0 = E("window.__reads"); E("Ledgers.load(S.coId)"); same = E("window.__reads") == n0
    E("() => { TCloud.st[S.coId].books[0].ledgersAt = '2026-10-02T06:00:00Z'; Ledgers.seen[S.coId] = 0; Ledgers.watch(S.coId); }"); pg.wait_for_timeout(500)
    ok(same and E("window.__reads") == n0 + 1, "read again only when the cloud's ledger time changes")

    # A6/A7. Client setup put right on opening the client: each GST head to a ledger of that head, TDS by section
    E("autoMapCompanyLedgers(CO())")
    g = E("CO().gst"); t = E("CO().tdsLedgers")
    ok(g["cgst"] == "INPUT CGST" and g["sgst"] == "INPUT SGST" and g["igst"] == "INPUT IGST", "scrambled Client setup GST put right: INPUT CGST / INPUT SGST / INPUT IGST (%s)" % {k: g[k] for k in ("cgst", "sgst", "igst")})
    ok(t["goods"] == "" and t["interest"] == "" and t["director"] == "TDS on Professional Fee 94J" and t["commission"] == "TDS 94H" and t["contractor"] == "TDS ON CONTRACT 94C" and t["rent_building"] == "TDS ON RENT 94I" and t["professional"] == "TDS on Professional Fee 94J",
       "TDS defaults by section: 194Q and 194A emptied (no ledger), director 194J, commission 194H kept, 194C/194-I/194J (%s)" % {k: t[k] for k in ("goods", "interest", "director", "commission", "contractor", "rent_building", "professional")})
    ok(E("gstLedgerCheck(S.coId, 'Input CGST 9%', 'SGST', 'gst').ok") is False and E("gstLedgerCheck(S.coId, 'OUTPUT CGST', 'CGST', 'gst').ok") is False and E("gstLedgerCheck(S.coId, 'Input SGST 9%', 'SGST', 'gst').ok") is True,
       "a GST ledger of another head, or an output one, never fits a head")

    # A3. the drop-down is a search
    m = lambda q, role: E("([q, r]) => acMatches(q, r).map(x => x.l.name)", [q, role])
    ok(m("kashi", "party")[:1] == ["Kashi IT Solutions"] and m("kashi i.t", "party")[:1] == ["Kashi IT Solutions"] and m("KASHI IT", "party")[:1] == ["Kashi IT Solutions"], "'kashi', 'kashi i.t' find Kashi IT Solutions")
    ok(m("jitin and co", "party")[:1] == ["Jitin & Co."] and m("jitin & co", "party")[:1] == ["Jitin & Co."], "'&' and 'and' are the same: Jitin & Co.")
    exp = m("professional", "expense"); allexp = E("acMatches('', 'expense').map(x => Ledgers.cls(S.coId, x.l.name))")
    incomes = E("Ledgers.list().filter(l => Ledgers.cls(S.coId, l.name) === 'income').map(l => l.name)")
    ok("Professional Fee" not in exp and "Legal and Professional Fee" in exp and not any(e2 in incomes for e2 in exp), "an expense box never lists an income ledger ('professional': %s)" % exp[:4])
    ok(allexp[0] in ("expense", "asset") and "income" not in allexp, "an expense box lists expense ledgers first (%s)" % allexp[:3])
    pty = E("acMatches('', 'party').slice(0, 5).map(x => Ledgers.cls(S.coId, x.l.name))")
    ok(all(c == "party" for c in pty), "a party box lists Sundry Creditors / Debtors first")

    # A4-A7. a bill from Kashi IT Solutions (KIS/335): every ledger by itself
    BILL = """([id, x, extra]) => { const e = newEntry(id + '.pdf'); e.id = id; Object.assign(e.x, x); Object.assign(e, extra || {});
      S.data[S.coId].entries[id] = e; billAutoLedgers(e, S.coId); return e.id; }"""
    E(BILL, ["kis335", {"vendorName": "KASHI I.T. SOLUTIONS", "vendorGstin": "09DEYPD8166R1Z5", "invoiceNo": "KIS/335", "invoiceDate": "2026-09-25", "taxable": 2000, "cgst": 180, "sgst": 180, "igst": 0, "total": 2360, "description": "Laptop repair and keyboard", "buyerGstin": "09AANFG3202D1ZR"}, {"natureId": "contractor"}])
    k = E("""(() => { const e = S.data[S.coId].entries.kis335, c = compute(e); return {party: e.partyLedger, from: e.partyFrom, exp: e.expenseLedger, expFrom: e.expenseFrom, lines: c.lines.map(l => [l.role, l.head || '', l.ledger, l.why || l.ask || '']), missing: c.missing}; })()""")
    gl = {l[1]: l for l in k["lines"] if l[0] == "gst"}
    ok(k["party"] == "Kashi IT Solutions" and k["from"] == "GSTIN 09DEYPD8166R1Z5 matches Kashi IT Solutions in Tally", "party: Kashi IT Solutions by GSTIN, never Aadi Info Solutions Pvt. Ltd (first of the creditors): '%s'" % k["from"])
    ok(k["exp"] == "Repair and Maintenance" and "for this supplier in Tally" in k["expFrom"], "expense: Repair and Maintenance, as booked before (%s)" % k["expFrom"])
    ok(gl["CGST"][2] == "Input CGST 9%" and gl["SGST"][2] == "Input SGST 9%" and "earlier bills" in gl["CGST"][3], "GST: Input CGST 9%% / Input SGST 9%%, as on this supplier's earlier bills (%s)" % gl)
    ok(not k["missing"], "nothing left to choose: approve is open (%s)" % k["missing"])

    # the bill on screen: why under each box, and the ledger list's status line
    E("() => { S.tab = 'invoices'; S.filter = 'draft'; S.reviewTable = false; S.selected = 'kis335'; S.step = null; render(); }"); pg.wait_for_timeout(1200)
    ok(pg.locator("#app [data-led-why=party]").count() == 1 and "GSTIN 09DEYPD8166R1Z5 matches Kashi IT Solutions in Tally" in pg.inner_text("#app [data-led-why=party]"), "the bill says why the party was picked")
    st = pg.inner_text("#app [data-led-status]") if pg.locator("#app [data-led-status]").count() else ""
    ok(pg.locator("#app [data-led-status]").count() >= 4 and st.startswith("1,110 ledgers from Tally · ") and "Refresh" in st, "under each ledger box: '%s'" % st.replace("\n", " "))
    ok("Used for CGST on this supplier" in pg.inner_text("#app [data-led-why='gst:cgst']"), "the GST line says why its ledger was picked")
    # the search box on screen
    pg.fill('#app input[data-e="partyLedger"]', "kashi i.t"); pg.wait_for_timeout(400)
    ok(pg.locator("#acBox .aci").count() >= 1 and "Kashi IT Solutions" in pg.inner_text("#acBox .aci >> nth=1"), "typing 'kashi i.t' in the party box offers Kashi IT Solutions")
    pg.keyboard.press("Escape")
    pg.fill('#app input[data-e="expenseLedger"]', "professional"); pg.wait_for_timeout(400)
    ac = E("AC.items.map(i => i.name)")
    ok("Legal and Professional Fee" in ac and "Professional Fee" not in ac, "the expense box offers Legal and Professional Fee, not the sales ledger Professional Fee (%s)" % ac[:5])
    pg.keyboard.press("Escape")

    # A3. an income ledger typed on a purchase bill is refused
    E("() => { const e = S.data[S.coId].entries.kis335; billSetText(e, 'expenseLedger', 'Professional Fee'); }")
    c = E("compute(S.data[S.coId].entries.kis335).missing")
    ok(any("Professional Fee" in m2 and "income ledger" in m2 for m2 in c), "'Professional Fee' (Sales Accounts) on a purchase bill: approve blocked (%s)" % c)
    E("() => { const e = S.data[S.coId].entries.kis335; billSetText(e, 'expenseLedger', ''); billAutoLedgers(e, S.coId); }")
    ok(E("S.data[S.coId].entries.kis335.expenseLedger") == "Repair and Maintenance", "emptied: picked by itself again")

    # A6. a GST ledger of another head is refused, on the bill and in Client setup
    E("() => billSetTaxLed(S.data[S.coId].entries.kis335, 'gst:cgst', 'INPUT IGST')")
    c = E("compute(S.data[S.coId].entries.kis335).missing")
    ok(any("INPUT IGST" in m2 and "IGST ledger, not CGST" in m2 for m2 in c), "INPUT IGST chosen for CGST: refused (%s)" % c)
    E("() => billSetTaxLed(S.data[S.coId].entries.kis335, 'gst:cgst', '')")
    E("() => { coSetText('gst.cgst', 'INPUT SGST'); coCommit('gst.cgst'); }"); pg.wait_for_timeout(300)
    ok(E("CO().gst.cgst") == "INPUT CGST" and "not CGST" in pg.inner_text("body"), "Client setup: INPUT SGST typed for CGST is refused, INPUT CGST kept")
    E("() => { coSetText('gst.igst', 'Input IGST 18%'); coCommit('gst.igst'); }")
    ok(E("CO().gst.igst") == "Input IGST 18%" and E("CO().gstPin.igst") is True, "Client setup: a ledger of the right head is taken as an override")
    E("() => { coSetText('gst.igst', ''); coCommit('gst.igst'); CO().gst.igst = 'INPUT IGST'; }")

    # A5. FA/ELEC/013 again: an electricity bill of Fingate, whose supplier record remembered "Advertisment Exp."
    E("""() => { const pid = 'p-AABCF1234K'; S.data[S.coId].parties[pid] = {id: pid, name: 'FINGATE ADVISORY SERVICES PRIVATE LIMITED', pan: 'AABCF1234K', ledgerName: '', expenseLedger: 'Advertisment Exp.', natureDefault: 'contractor', ytd: {}}; }""")
    E(BILL, ["elec013", {"vendorName": "FINGATE ADVISORY SERVICES PRIVATE LIMITED", "vendorPan": "AABCF1234K", "invoiceNo": "FA/ELEC/013", "invoiceDate": "2026-07-01", "taxable": 20000, "cgst": 1800, "sgst": 1800, "igst": 0, "total": 23600, "description": "Electricity charges for June 2026"},
              {"natureId": "contractor", "expenseLedger": "Advertisment Exp.", "partyLedger": "FINGATE ADVISORY SERVICES PRIVATE LIMITED"}])
    f = E("""(() => { const e = S.data[S.coId].entries.elec013, c = compute(e); return {party: e.partyLedger, from: e.partyFrom, exp: e.expenseLedger, expFrom: e.expenseFrom, gst: c.lines.filter(l => l.role === 'gst').map(l => l.ledger), tds: c.tdsLedger}; })()""")
    ok(f["party"] == "Fingate Advisory Services Limited" and f["exp"] == "Electricity Exp" and "electricity" in f["expFrom"], "FA/ELEC/013: Fingate's ledger, Electricity Exp (not Advertisment Exp.): %s" % f["expFrom"])
    ok(f["gst"] == ["Input CGST 9%", "Input SGST 9%"], "its GST as on Fingate's electricity bills: Input CGST 9%% / Input SGST 9%% (%s)" % f["gst"])
    E(BILL, ["rent081", {"vendorName": "FINGATE ADVISORY SERVICES PRIVATE LIMITED", "vendorPan": "AABCF1234K", "invoiceNo": "FA/2026-27/081", "invoiceDate": "2026-07-01", "taxable": 105000, "cgst": 9450, "sgst": 9450, "igst": 0, "total": 123900, "description": "Rent for July 2026", "rentMonths": 1},
              {"natureId": "rent_building"}])
    rr = E("""(() => { const e = S.data[S.coId].entries.rent081, c = compute(e); return {exp: e.expenseLedger, gst: c.lines.filter(l => l.role === 'gst').map(l => l.ledger), tds: c.tdsLedger, tdsAmt: c.tds}; })()""")
    ok(rr["exp"] == "Rent" and rr["gst"] == ["INPUT CGST", "INPUT SGST"] and rr["tds"] == "TDS ON RENT 94I" and rr["tdsAmt"] == 10500, "Fingate rent: Rent, INPUT CGST / INPUT SGST, TDS ON RENT 94I (%s)" % rr)

    # A7. TDS by section, never another section's
    sec = E("""(() => { const e = S.data[S.coId].entries.kis335, co = CO(); return ['professional', 'contractor', 'rent_building', 'commission', 'goods', 'technical'].map(id => [id, tdsLedgerFor(e, co, S.coId, ruleOf(id)).ledger]); })()""")
    sec = dict(sec)
    ok(sec["professional"] == "TDS on Professional Fee 94J" and sec["contractor"] == "TDS ON CONTRACT 94C" and sec["rent_building"] == "TDS ON RENT 94I" and sec["commission"] == "TDS 94H" and sec["goods"] == "" and sec["technical"] == "TDS on Professional Fee 94J(Technical)",
       "TDS by section: 194J, 194C, 194-I, 194H; 194Q has none (ask) (%s)" % sec)
    E("() => billSetTaxLed(S.data[S.coId].entries.rent081, 'tds', 'TDS ON CONTRACT 94C')")
    c = E("compute(S.data[S.coId].entries.rent081).missing")
    ok(any("section 194-C, not 194-I" in m2 for m2 in c), "a TDS ledger of another section on the bill: refused (%s)" % c)

    # A4. Tally's GSTIN (the cloud list, from migration 28) wins over the books copy's; the difference is said on the bill
    E("""() => { const k = window.__rows.find(r => r.name === 'Kashi IT Solutions'); k.gstin = '09DEYPD8166R1Z5'; k.pan = 'DEYPD8166R';
      S.books.ledInfo['Kashi IT Solutions'].gstin = '09DEYPD8166R2ZB'; S.books.gstins['Kashi IT Solutions'] = '09DEYPD8166R2ZB'; TCloud.st[S.coId].books[0].ledgersAt = '2026-10-02T07:00:00Z'; }""")
    E("Ledgers.load(S.coId)")
    E(BILL, ["kis336", {"vendorName": "Kashi IT Solutions", "vendorGstin": "09DEYPD8166R1Z5", "invoiceNo": "KIS/336", "invoiceDate": "2026-09-27", "taxable": 500, "cgst": 45, "sgst": 45, "total": 590, "description": "Mouse"}, {"natureId": "contractor"}])
    kk = E("(() => { const e = S.data[S.coId].entries.kis336; return [e.partyLedger, e.partyFrom, e.partyNote]; })()")
    ok(kk[0] == "Kashi IT Solutions" and kk[2] == "Tally now has GSTIN 09DEYPD8166R1Z5 for this ledger (books copy had 09DEYPD8166R2ZB)", "Tally's GSTIN used, the books copy's older one noted (%s)" % kk)

    # A4. a supplier with no ledger: left empty, said so; never a first-in-list ledger
    E(BILL, ["new1", {"vendorName": "Zed Unknown Traders", "vendorGstin": "", "invoiceNo": "Z-1", "invoiceDate": "2026-09-01", "taxable": 1000, "cgst": 90, "sgst": 90, "total": 1180, "description": "Sundries"}, {"natureId": "contractor"}])
    ok(E("S.data[S.coId].entries.new1.partyLedger") == "", "an unknown supplier: the party box is left empty")
    E("() => { S.selected = 'new1'; render(); }"); pg.wait_for_timeout(600)
    ok("No ledger found for this supplier: search or create" in pg.inner_text("#app [data-led-why=party]"), "and says 'No ledger found for this supplier: search or create'")

    # A6. no ledger of a head: approve waits, "Choose the IGST reverse charge input ledger"
    E(BILL, ["rcm1", {"vendorName": "Jitin & Co.", "invoiceNo": "6009", "invoiceDate": "2026-09-30", "taxable": 13500, "cgst": 0, "sgst": 0, "igst": 0, "total": 13500, "description": "Professional fee for September 2026"},
              {"natureId": "professional", "rcm": {"on": True, "cat": "other", "rate": 18, "inter": True}}])
    il = E("(() => { const e = S.data[S.coId].entries.rcm1, c = compute(e); return {exp: e.expenseLedger, lines: c.lines.filter(l => /rcm/.test(l.role)).map(l => [l.role, l.ledger, l.ask || l.why]), missing: c.missing}; })()")
    rin = [l for l in il["lines"] if l[0] == "rcm-in"][0]; rout = [l for l in il["lines"] if l[0] == "rcm-out"][0]
    ok(il["exp"] == "Legal and Professional Fee", "JITIN & CO.: Legal and Professional Fee, never the sales ledger Professional Fee (%s)" % il["exp"])
    ok(rin[1] == "" and rin[2] == "Choose the IGST reverse charge input ledger" and "the IGST reverse charge input ledger" in il["missing"] and rout[1] == "RCM Payable",
       "reverse charge IGST: no input ledger of that head in Tally: 'Choose the IGST reverse charge input ledger', approve waits; payable to RCM Payable (%s)" % il["lines"])
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
