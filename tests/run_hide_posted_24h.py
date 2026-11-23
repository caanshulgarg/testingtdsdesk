"""python3 run_hide_posted_24h.py - the owner (23-Nov-2026): "Posted entries in tally should be removed after 24 hours from
the purchase, bank and sales page.. it should remain in transaction only."
On Purchase, Bank and Sales (classic and the new look) an entry Tally confirmed more than 24 hours ago is in no list, tab
or count; one posted in the last 24 hours is; one not confirmed (in a Tally file, gone from Tally, held, to review) is
always there, whatever its age; a confirmed one with no time kept (older data) counts as older. Each list ends with
"Posted entries older than 24 hours are in Transactions →", which opens the matching register, and the register lists
every entry. Display only: the bank lines, the bills and the invoices are all still there, and the bank balance check,
its totals and its matching with Tally read every line. Made-up data, offline.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_hide_posted_24h.py
Screenshots (desktop 1366x768 and phone 390, deviceScaleFactor 2) go to TDSDESK_SHOTS when set."""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("HIDE24_PORT") or 8763)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
NL_ON = "try { localStorage.setItem('fincom:newlook:local', 'on'); } catch (e) {}"
# one made-up client: 8 bank lines, 7 purchase bills, 5 sales invoices; h(n) is n hours ago
SETUP = """async () => {
  const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  const c = newCompany({name: "Sample Traders LLP", gstin: "09AAKFS1234C1Z5"}); c.tallyName = "Sample Traders LLP";
  c.bankAccounts = [{id: "a1", bank: "Sample Bank", acct: "0099", ledger: "Sample Bank"}];
  S.companies[c.id] = c; c.stats = {};
  const bill = (id, st, more) => Object.assign({id, status: st, createdAt: h(400), fileName: id + ".pdf", natureId: "contract", uncertain: [],
    x: {vendorName: "Vendor " + id.toUpperCase(), invoiceNo: "INV-" + id, invoiceDate: "2026-10-0" + (id.length % 9 + 1), taxable: 1000, cgst: 90, sgst: 90, total: 1180}}, more || {});
  const entries = {
    b1: bill("b1", "approved", {exportedAt: h(2), postedVia: "bridge", postVerified: true, tally: {at: h(2), company: "Sample Traders LLP"}}),   // posted 2 hours ago: shown
    b2: bill("b2", "approved", {exportedAt: h(25), postedVia: "bridge", postVerified: true, tally: {at: h(25), company: "Sample Traders LLP"}}), // 25 hours ago: hidden
    b3: bill("b3", "approved", {exportedAt: h(72), postedVia: "bridge", postVerified: false}),                                                  // sent 3 days ago, not confirmed: shown
    b4: bill("b4", "draft"),                                                                                                                       // to review, old: shown
    b5: bill("b5", "duplicate"),                                                                                                                   // held: shown
    b6: bill("b6", "approved", {exportedAt: h(30), postByReply: true}),                                                                         // Tally's reply, 30 hours ago: hidden
    b7: bill("b7", "approved", {exportedAt: h(50), postVerified: true, tally: {at: h(50), byOwner: "Made-up Owner", byOwnerAt: h(50)}})};       // marked by a person, not Tally: shown
  S.data[c.id] = {parties: {}, entries, loaded: true};
  await openCompany(c.id);
  // the bank statement: each line's running balance agrees
  const L = [["r0", "sent", {tally: {guid: "g0", at: h(2)}, sentAt: h(2)}],          // in Tally, 2 hours ago: shown under Posted
    ["r1", "sent", {tally: {guid: "g1", at: h(25)}, sentAt: h(25)}],                 // in Tally, 25 hours ago: hidden
    ["r2", "intally", {tallyHow: "found in Tally when reconciling"}],               // already in Tally, no time kept: hidden
    ["r3", "sent", {sentAt: h(48)}],                                                  // in a Tally file, not found in Tally: shown
    ["r4", "attention", {}], ["r5", "ready", {}], ["r6", "ignored", {}],
    ["r7", "sent", {tally: {guid: "g7", at: h(40)}, sentAt: h(40), goneFromTally: h(10)}]];   // no longer in Tally: shown
  let bal = 50000;
  const rows = L.map(([id, state, more], i) => { const out = i % 2 === 0, amt = 1000 + i * 111; bal += out ? -amt : amt;
    return Object.assign({id, fp: "fp" + id, date: "2026-10-" + String(10 + i), debit: out ? amt : 0, credit: out ? 0 : amt, balance: bal, bal,
      narr: (out ? "NEFT DR PARTY" : "NEFT CR PARTY") + i + " UTR" + (500 + i), dec: {name: "PARTY" + i, mode: "NEFT", utr: "UTR" + (500 + i)},
      ledger: state === "attention" ? "" : "Party " + i, state, balOk: true, why: []}, more); });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Sample Bank", acct: "0099", from: "2026-10-10", to: "2026-10-17", opening: 50000, closing: bal, badRows: 0, summaryOk: true}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: rows.map((r) => ({name: "Party " + rows.indexOf(r), group: "Sundry Creditors"})).concat([{name: "Sample Bank", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true},
    newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "",
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  await loadSales(c.id);
  const inv = (id, status, more) => Object.assign({id, status, addedAt: h(300), source: "created", customerLedger: "Customer " + id,
    x: {number: "SI-" + id, date: "2026-10-2" + id.slice(1), customerName: "Customer " + id.toUpperCase(), taxable: 2000, cgst: 180, sgst: 180, total: 2360, items: []}}, more || {});
  SL().list = [inv("s1", "posted", {postedAt: h(2)}),       // posted, Tally confirmed, 2 hours ago: shown
    inv("s2", "posted", {postedAt: h(25)}),                   // 25 hours ago: hidden
    inv("s3", "intally", {postNote: "Already in Tally"}),     // already in Tally, no time kept: hidden
    inv("s4", "posted", {postedAt: h(72), postedVia: "file"}),// in a Tally file only, not confirmed by Tally: shown
    inv("s5", "review")];                                     // to review: shown
  window.__cid = c.id;
  S.tab = "bank"; S.step = null; render(); }"""

def page(br, w=1366, h=768, nl=False, phone=False):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=phone, has_touch=phone)
    if nl: ctx.add_init_script(NL_ON)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1500)
    return ctx, pg
def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))
def go(pg, js, ms=900): pg.evaluate("() => { " + js + " }"); pg.wait_for_timeout(ms)
ST = lambda k: '#app nav.statebar [data-state="%s"]' % k
STN = lambda pg, k: pg.inner_text(ST(k) + " [data-state-n]") if pg.locator(ST(k)).count() else ""
LINE = "Posted entries older than 24 hours are in Transactions"
BANKROWS = "#app table.bk-table tbody tr[data-rid]"

def bank_checks(pg, look):
    go(pg, "goClient('bank'); bankTabGo('done');")
    ok(STN(pg, "intally") == "1" and pg.evaluate("bankStates().intally") == 1, look + "Bank: Posted counts 1, the line posted 2 hours ago (not the 25-hour one, nor the one already in Tally with no time)")
    ids = pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS)
    ok(ids == ["r0"], look + "Bank: Posted lists only the line posted 2 hours ago: %s" % ids)
    go(pg, "bankTabGo('ready');")
    ids = pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS)
    ok(set(ids) == {"r3", "r5", "r7"}, look + "Bank: Ready to post keeps the unconfirmed old lines (in a Tally file 2 days ago, gone from Tally): %s" % ids)
    go(pg, "bankTabGo('review');")
    ok(pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS) == ["r4"] and STN(pg, "review") == "1", look + "Bank: To do keeps the old line with no ledger")
    ok(pg.evaluate("(() => { B().filter = 'all'; const v = bankVisibleRows().map(r => r.id); B().filter = 'review'; return v.join(); })()") == "r0,r3,r4,r5,r6,r7", look + "Bank: the All view leaves out only the two confirmed old lines")
    ok(LINE in pg.inner_text("#app") and pg.locator("#app [data-old-posted='bank']").count() == 1, look + "Bank: the line under the list")
    # in sight, not under the bar at the foot or outside the table's box: the link itself is what is at its place
    seen = pg.evaluate("(() => { const el = document.querySelector('#app [data-old-posted-go]'); if (!el) return false; el.scrollIntoView({block: 'nearest'}); const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!at && (at === el || el.contains(at)); })()")
    ok(seen, look + "Bank: the line is in sight (nothing over it)")
    go(pg, "bankTabGo('review');", 500)
    ok(pg.inner_text("#app [data-f-count]").startswith("1 of 6"), look + "Bank: the filter bar counts 1 of 6, the two old posted lines not counted: %r" % pg.inner_text("#app [data-f-count]")[:12])
    return pg.inner_text("#app [data-old-posted='bank']") if pg.locator("#app [data-old-posted='bank']").count() else ""

def balance_checks(pg, look):
    # display only: every line is there, and the checks read them all
    go(pg, "goClient('bank'); bankTabGo('done');")
    ok(pg.evaluate("B().rows.length") == 8 and "8 entries" in pg.inner_text("#app .bk-sub"), look + "Bank: the statement still has its 8 lines (8 entries in its heading)")
    ok("The statement adds up" in pg.inner_text("#app .bk-check"), look + "Bank: the running-balance check is unchanged: the statement adds up")
    chk = pg.evaluate("(() => { const rows = JSON.parse(JSON.stringify(B().rows)); const c = checkBalances(rows, {opening: 50000}); return {bad: c.bad, ok: rows.filter(r => r.balOk === true).length}; })()")
    ok(chk["bad"] == 0 and chk["ok"] == 8, look + "Bank: checkBalances over every line: 0 bad, all 8 agree (%s)" % chk)
    tc = pg.evaluate("tabCounts(B().rows)")
    ok(tc["inTally"] == 3 and tc["done"] == 1 and tc.get("old") == 2, look + "Bank: matched with Tally still counts all 3 matched lines; the Posted tab 1; 2 only in Transactions (%s)" % {k: tc.get(k) for k in ("inTally", "done", "old")})

def register_checks(pg, look, kind, want):
    got = pg.evaluate("[S.tab, txnTab(), document.querySelectorAll('#app table.txntbl tbody tr').length]")
    ok(got[0] == "txn" and got[1] == kind and got[2] == want, look + "the link opens the %s register, with all %d: %s" % (kind, want, got))

with sync_playwright() as p:
    br = p.chromium.launch()
    for nl in (False, True):
        look = "[new look] " if nl else "[classic] "
        print("== " + look)
        ctx, pg = page(br, nl=nl)
        # ---- Bank
        txt = bank_checks(pg, look)
        ok(txt.strip() == LINE + " →", look + "Bank: the line's words: %r" % txt.strip())
        shot(pg, ("nl-" if nl else "") + "bank-desktop")
        balance_checks(pg, look)
        pg.click("#app [data-old-posted-go='bank']"); pg.wait_for_timeout(1200)
        register_checks(pg, look + "Bank: ", "bank", 8)
        ok(pg.evaluate("txnRowsBank().map(r => r.id).sort().join()") == "r0,r1,r2,r3,r4,r5,r6,r7", look + "Bank register: every line, the old posted ones too")
        shot(pg, ("nl-" if nl else "") + "bank-register-desktop")
        # ---- Purchase
        go(pg, "goClient('bills'); goState('intally', 'bills');", 1500)
        ok(STN(pg, "intally") == "2" and pg.evaluate("billStates().intally") == 2, look + "Purchase: In Tally counts 2 (posted 2 hours ago, and one marked by a person): %s" % STN(pg, "intally"))
        rows = pg.evaluate("[...document.querySelectorAll('#app [data-entry-list=\"posted\"] .pe-list > li')].map(li => li.innerText)")
        ok(len(rows) == 2 and any("INV-b1" in r for r in rows) and any("INV-b7" in r for r in rows) and not any("INV-b2" in r or "INV-b6" in r for r in rows), look + "Purchase: In Tally lists b1 and b7, not b2 (25 hours) or b6 (30 hours)")
        ok(pg.locator("#app [data-old-posted='bills']").count() == 1 and LINE in pg.inner_text("#app [data-old-posted='bills']"), look + "Purchase: the line under the list")
        shot(pg, ("nl-" if nl else "") + "purchase-desktop")
        go(pg, "goState('errors', 'bills');", 1200)
        ok("INV-b3" in pg.inner_text("#app [data-post-panel='errors']"), look + "Purchase: the bill sent 3 days ago and never confirmed is still under Errors")
        go(pg, "goState('review', 'bills');", 1200)
        ok(STN(pg, "review") == "1" and STN(pg, "duplicate") == "1", look + "Purchase: To review 1 and Duplicates 1, whatever their age")
        go(pg, "S.step = null; S.tab = 'invoices'; S.filter = 'approved'; S.selected = null; render();", 900)
        q = pg.evaluate("[...document.querySelectorAll('#app ul.queue > li')].map(li => li.innerText).join('|')")
        ok("INV-b1" in q and "INV-b3" in q and "INV-b7" in q and "INV-b2" not in q and "INV-b6" not in q, look + "Purchase: the approved bills' list leaves out only b2 and b6: %s" % q)
        go(pg, "goState('intally', 'bills');", 1200)
        pg.click("#app [data-old-posted-go='bills']"); pg.wait_for_timeout(1200)
        register_checks(pg, look + "Purchase: ", "bills", 7)
        ok(pg.evaluate("txnRowsBills().map(r => r.id).sort().join()") == "b1,b2,b3,b4,b5,b6,b7", look + "Purchase register: every bill")
        # ---- Sales
        go(pg, "goClient('sales'); salesTabGo('done');", 1200)
        ok(STN(pg, "intally") == "2" and pg.evaluate("salesCounts().done") == 2, look + "Sales: In Tally counts 2 (posted 2 hours ago, and one only in a Tally file): %s" % STN(pg, "intally"))
        t = pg.inner_text("#app table.bk-table tbody")
        ok("SI-s1" in t and "SI-s4" in t and "SI-s2" not in t and "SI-s3" not in t, look + "Sales: In Tally lists s1 and s4, not s2 (25 hours) or s3 (already in Tally, no time)")
        ok(pg.locator("#app [data-old-posted='sales']").count() == 1, look + "Sales: the line under the list")
        shot(pg, ("nl-" if nl else "") + "sales-desktop")
        go(pg, "salesTabGo('review');")
        ok("SI-s5" in pg.inner_text("#app table.bk-table tbody") and STN(pg, "review") == "1", look + "Sales: the invoice to review stays")
        pg.click("#app [data-old-posted-go='sales']"); pg.wait_for_timeout(1200)
        register_checks(pg, look + "Sales: ", "sales", 5)
        ok(pg.evaluate("SL().list.length") == 5, look + "Sales: every invoice is still kept")
        # nothing saved changed: the hiding is a view
        ok(pg.evaluate("[B().rows.filter(r => r.state === 'sent').length, Object.values(D().entries).filter(e => e.exportedAt).length, SL().list.filter(v => v.status === 'posted').length].join()") == "4,5,3", look + "nothing saved changed")
        ctx.close()
    # ---- the phone
    for nl in (False, True):
        look = "[phone%s] " % (", new look" if nl else "")
        ctx, pg = page(br, 390, 844, nl=nl, phone=True)
        bank_checks(pg, look)
        pg.evaluate("() => { const el = document.querySelector('#app [data-old-posted]'); if (el) el.scrollIntoView({block: 'center'}); }"); pg.wait_for_timeout(300)
        sw = pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1")
        ok(sw, look + "no sideways scroll of the page")
        shot(pg, ("nl-" if nl else "") + "bank-phone")
        go(pg, "goClient('bills'); goState('intally', 'bills');", 1500)
        pg.evaluate("() => { const el = document.querySelector('#app [data-old-posted]'); if (el) el.scrollIntoView({block: 'center'}); }"); pg.wait_for_timeout(300)
        ok(pg.locator("#app [data-old-posted='bills']").count() == 1, look + "Purchase: the line")
        shot(pg, ("nl-" if nl else "") + "purchase-phone")
        go(pg, "goClient('sales'); salesTabGo('done');", 1200)
        pg.evaluate("() => { const el = document.querySelector('#app [data-old-posted]'); if (el) el.scrollIntoView({block: 'center'}); }"); pg.wait_for_timeout(300)
        ok(pg.locator("#app [data-old-posted='sales']").count() == 1, look + "Sales: the line")
        shot(pg, ("nl-" if nl else "") + "sales-phone")
        ctx.close()
    br.close()
ok(not errors, "no page errors: %s" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
srv.shutdown()
raise SystemExit(1 if fails else 0)
