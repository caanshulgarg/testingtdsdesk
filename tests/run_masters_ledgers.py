"""python3 run_masters_ledgers.py - the ledger masters uploaded on Books are the client's ledger list everywhere (the owner,
25-Oct-2026, Testing AAD: "I have already uploaded masters xml.. still it is asking again"). Testing AAD has no book in
FinCom's cloud copy and no bridge; its 1,111 ledgers were only in the books (ledInfo, under). Checks, on a made-up client
whose ledgers are only in its books:
  1. the one ledger list (Ledgers.list, hasLedgerList, exactLedger, the search acMatches) is the books' masters;
  2. the bill page's party and expense boxes offer them, and a supplier's bill gets its party ledger by name;
  3. the bank page does not ask for the ledger list;
  4. opening a client with no list opens its books for their masters (Ledgers.watch);
  5. a later read from FinCom's cloud copy (or the bridge) is taken over them, and is not replaced by them afterwards;
  6. with no masters either, nothing is made up (the list is empty, the bank page asks for it).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_masters_ledgers.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8167), functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))))
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# a client whose ledgers are only in its books, as Books -> From Tally's masters upload leaves them (bringMastersFile)
SETUP = """(masters) => {
  const c = newCompany({name: "MASTERS ONLY CO", gstin: "09AANFG3202D1ZR"});
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "invoices";
  S.data[c.id] = S.data[c.id] || {entries: {}, parties: {}};
  S.data[c.id].entries = S.data[c.id].entries || {}; S.data[c.id].parties = S.data[c.id].parties || {};
  const ledInfo = {}, under = {};
  if (masters) [["Kumkum Raghav", "Sundry Creditors", "09ABCPR1234K1Z5"], ["Kashi IT Solutions", "Sundry Creditors", ""], ["Repair and Maintenance", "Indirect Expenses", ""],
    ["Office Expenses", "Indirect Expenses", ""], ["Input CGST 9%", "Duties & Taxes", ""], ["Input SGST 9%", "Duties & Taxes", ""], ["ICICI Bank", "Bank Accounts", ""], ["Professional Fee", "Sales Accounts", ""]]
    .forEach(([n, g, gst]) => { ledInfo[n] = {group: g, gstin: gst}; under[n] = g; });
  if (masters) under["Sundry Creditors"] = "Current Liabilities";
  S.books = {cid: c.id, loading: false, vouchers: [], map: {}, challans: [], alloc: {}, pans: {}, gstins: {}, ledInfo, under,
    groups: masters ? {"Sundry Creditors": "Current Liabilities"} : {}, ledInfoAt: masters ? "2026-10-09T09:57:28.989Z" : ""};
  render();
  return c.id;
}"""
BANK = """() => { const c = CO(); c.bankAccounts = [{id: "a1", bank: "ICICI Bank", acct: "123405001234", last4: "1234", ledger: "ICICI Bank"}];
  const rows = [{id: "m1", fp: "fpm1", date: "2026-10-05", debit: 15000, credit: 0, balance: 1000, narr: "MMT/IMPS/528114093821/BULD80088625/KumkumRagh/SBIN0004321", ref: "", balOk: true, state: "attention", ledger: "", userSet: false}];
  rows.forEach((r) => { r.dec = decodeNarr(r.narr, c.name); });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI Bank", acct: "123405001234", from: "2026-10-05", to: "2026-10-05", opening: 16000, closing: 1000, totDr: 0, totCr: 0, badRows: 0, summaryOk: true}],
    cur: "s1", rows, rules: [], wrules: [], ledgers: {list: [], importedAt: ""}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100,
    pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  choiceConfirm(c, "bank:a1", "ICICI Bank"); suggestAll(rows); S.tab = "bank"; render(); }"""
BILL = """([id, x]) => { const e = newEntry(id + '.pdf'); e.id = id; Object.assign(e.x, x); S.data[S.coId].entries[id] = e; billAutoLedgers(e, S.coId);
  S.tab = 'invoices'; S.filter = 'draft'; S.reviewTable = false; S.selected = id; S.step = null; render(); return e.id; }"""

def start(p):
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8167/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    return br, pg

with sync_playwright() as p:
    br, pg = start(p); E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP, True); pg.wait_for_timeout(800)
    # ---- 1. the one list
    ok(E("Ledgers.list().length") == 8 and E("hasLedgerList()"), "the books' 8 ledgers are the client's ledger list (%d)" % E("Ledgers.list().length"))
    ok(E("Ledgers.list().every(l => l.name !== 'Sundry Creditors')"), "a group of the masters is not a ledger")
    ok(E("exactLedger('kumkum raghav')") == "Kumkum Raghav" and E("ledgerInfo('Kumkum Raghav').group") == "Sundry Creditors", "exactLedger and its group (Sundry Creditors)")
    ok(E("Ledgers.ids(S.coId, 'Kumkum Raghav').gstin") == "09ABCPR1234K1Z5", "with its GSTIN from the masters")
    ok(E("acMatches('kashi', 'party').map(x => x.l.name)")[:1] == ["Kashi IT Solutions"], "the search finds Kashi IT Solutions in a party box")
    exp = E("acMatches('', 'expense').map(x => x.l.name)")
    ok("Repair and Maintenance" in exp and "Professional Fee" not in exp, "an expense box offers the expense ledgers, not a sales ledger (%s)" % exp[:4])
    # ---- 2. the bill page
    E(BILL, ["b1", {"vendorName": "KUMKUM RAGHAV", "vendorGstin": "09ABCPR1234K1Z5", "invoiceNo": "KR/7", "invoiceDate": "2026-10-10", "taxable": 1000, "cgst": 90, "sgst": 90, "igst": 0, "total": 1180, "description": "Repairs"}])
    pg.wait_for_timeout(1200)
    ok(E("S.data[S.coId].entries.b1.partyLedger") == "Kumkum Raghav", "a bill from Kumkum Raghav gets the party ledger from the masters (%s)" % E("S.data[S.coId].entries.b1.partyFrom"))
    box = '#app input[data-e="expenseLedger"]'
    ok(pg.locator(box).count() == 1, "the bill page shows its expense ledger box")
    if pg.locator(box).count():
        pg.fill(box, "repair"); pg.wait_for_timeout(400)
        items = E("Array.from(document.querySelectorAll('#acBox .aci')).map(e => e.innerText)")
        ok(any("Repair and Maintenance" in x for x in items), "typing 'repair' in the bill's expense box offers Repair and Maintenance (%s)" % items[:3])
        pg.keyboard.press("Escape")
    st = pg.inner_text("#app [data-led-status]") if pg.locator("#app [data-led-status]").count() else ""
    ok("8 ledgers" in st, "the bill's ledger status line counts them (%s)" % st.replace("\n", " ")[:80])
    # ---- 3. the bank page
    E(BANK); pg.wait_for_timeout(1500)
    body = pg.inner_text("#app")
    ok("Bring in the Tally ledger list" not in body, "the bank page does not ask for the ledger list")
    ok(E("bankRow('m1').ledger") == "Kumkum Raghav" and E("bankRow('m1').state") == "suggested", "and suggests Kumkum Raghav for “KumkumRagh”")
    # ---- 5. a later cloud read wins, and stays
    E("() => Ledgers.take(S.coId, {list: [{name: 'Kumkum Raghav', group: 'Sundry Creditors'}, {name: 'New In Tally', group: 'Sundry Debtors'}], src: 'cloud', srcAt: '2026-10-20T00:00:00Z', at: new Date().toISOString(), book: 'bk1'})")
    ok(E("Ledgers.list().map(l => l.name).join('|')") == "Kumkum Raghav|New In Tally", "a read from FinCom's cloud copy is taken over the masters (%s)" % E("Ledgers.list().length"))
    E("() => { S.books.ledInfo = Object.assign({}, S.books.ledInfo, {'Another': {group: 'Sundry Debtors'}}); S.books.ledInfoAt = '2026-10-25T00:00:00Z'; render(); }"); pg.wait_for_timeout(300)
    ok(E("Ledgers.list().length") == 2 and E("exactLedger('New In Tally')") == "New In Tally", "and masters uploaded afterwards do not replace a list read from Tally")
    br.close()

    # ---- 4. opening a client with no list opens its books; 6. no masters: nothing made up
    br, pg = start(p); E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP, True)
    E("() => { S.books = null; Ledgers.seen[S.coId] = 0; Ledgers.watch(S.coId); }"); pg.wait_for_timeout(300)
    ok(E("!!(S.books && S.books.cid === S.coId)"), "a client with no ledger list: its books are opened, for their masters")
    br.close()
    br, pg = start(p); E = lambda js, *a: pg.evaluate(js, *a)
    E(SETUP, False); E(BANK); pg.wait_for_timeout(1500)
    ok(E("Ledgers.list().length") == 0 and not E("hasLedgerList()") and "Bring in the Tally ledger list" in pg.inner_text("#app"), "no masters either: no list, and the bank page asks for it")
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
