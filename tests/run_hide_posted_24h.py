"""python3 run_hide_posted_24h.py - the owner (23-Nov-2026): "Posted entries in tally should be removed after 24 hours from
the purchase, bank and sales page.. it should remain in transaction only."
On Purchase, Bank and Sales (classic and the new look) an entry Tally confirmed more than 24 hours ago is in no list, tab
or count; one posted in the last 24 hours is; one not confirmed (in a Tally file, gone from Tally, held, to review) is
always there, whatever its age; a confirmed one with no time kept (older data) counts as older. The time: the posting's;
a person's "mark posted", the mark's; one found already in Tally, when FinCom found it (matchedAt, set by the match and
kept when the same Tally entry is matched again). Each list ends with
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
    b7: bill("b7", "approved", {exportedAt: h(50), postVerified: true, tally: {at: h(50), byOwner: "Made-up Owner", byOwnerAt: h(50)}}),       // marked posted by a person 50 hours ago: hidden
    b8: bill("b8", "approved", {exportedAt: h(50), postVerified: true, tally: {at: h(50), byOwner: "Made-up Owner", byOwnerAt: h(3)}})};        // sent 50 hours ago, marked posted 3 hours ago: shown
  S.data[c.id] = {parties: {}, entries, loaded: true};
  await openCompany(c.id);
  // the bank statement: each line's running balance agrees
  const L = [["r0", "sent", {tally: {guid: "g0", at: h(2)}, sentAt: h(2)}],          // in Tally, 2 hours ago: shown under Posted
    ["r1", "sent", {tally: {guid: "g1", at: h(25)}, sentAt: h(25)}],                 // in Tally, 25 hours ago: hidden
    ["r2", "intally", {tallyHow: "found in Tally when reconciling"}],               // already in Tally, no time kept: hidden
    ["r3", "sent", {sentAt: h(48)}],                                                  // in a Tally file, not found in Tally: shown
    ["r4", "attention", {}], ["r5", "ready", {}], ["r6", "ignored", {}],
    ["r7", "sent", {tally: {guid: "g7", at: h(40)}, sentAt: h(40), goneFromTally: h(10)}],    // no longer in Tally: shown
    ["r8", "intally", {tallyHow: "found in Tally when reconciling", matchedAt: h(3)}]];        // found in Tally 3 hours ago: shown
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
    inv("s5", "review"),                                      // to review: shown
    inv("s6", "intally", {postNote: "Already in Tally", matchedAt: h(1)})];   // found in Tally an hour ago: shown
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
    ok(STN(pg, "intally") == "2" and pg.evaluate("bankStates().intally") == 2, look + "Bank: Posted counts 2: posted 2 hours ago, found in Tally 3 hours ago (not the 25-hour one, nor the one found with no time kept)")
    ids = pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS)
    ok(sorted(ids) == ["r0", "r8"], look + "Bank: Posted lists the line posted 2 hours ago and the one found in Tally 3 hours ago: %s" % ids)
    go(pg, "bankTabGo('ready');")
    ids = pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS)
    ok(set(ids) == {"r3", "r5", "r7"}, look + "Bank: Ready to post keeps the unconfirmed old lines (in a Tally file 2 days ago, gone from Tally): %s" % ids)
    go(pg, "bankTabGo('review');")
    ok(pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS) == ["r4"] and STN(pg, "review") == "1", look + "Bank: To do keeps the old line with no ledger")
    ok(pg.evaluate("(() => { B().filter = 'all'; const v = bankVisibleRows().map(r => r.id); B().filter = 'review'; return v.join(); })()") == "r0,r3,r4,r5,r6,r7,r8", look + "Bank: the All view leaves out only the two confirmed old lines")
    ok(LINE in pg.inner_text("#app") and pg.locator("#app [data-old-posted='bank']").count() == 1, look + "Bank: the line under the list")
    # in sight, not under the bar at the foot or outside the table's box: the link itself is what is at its place
    seen = pg.evaluate("(() => { const el = document.querySelector('#app [data-old-posted-go]'); if (!el) return false; el.scrollIntoView({block: 'nearest'}); const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!at && (at === el || el.contains(at)); })()")
    ok(seen, look + "Bank: the line is in sight (nothing over it)")
    go(pg, "bankTabGo('review');", 500)
    ok(pg.inner_text("#app [data-f-count]").startswith("1 of 7"), look + "Bank: the filter bar counts 1 of 7, the two old posted lines not counted: %r" % pg.inner_text("#app [data-f-count]")[:12])
    return pg.inner_text("#app [data-old-posted='bank']") if pg.locator("#app [data-old-posted='bank']").count() else ""

def balance_checks(pg, look):
    # display only: every line is there, and the checks read them all
    go(pg, "goClient('bank'); bankTabGo('done');")
    ok(pg.evaluate("B().rows.length") == 9 and "9 entries" in pg.inner_text("#app .bk-sub"), look + "Bank: the statement still has its 9 lines (9 entries in its heading)")
    ok("The statement adds up" in pg.inner_text("#app .bk-check"), look + "Bank: the running-balance check is unchanged: the statement adds up")
    chk = pg.evaluate("(() => { const rows = JSON.parse(JSON.stringify(B().rows)); const c = checkBalances(rows, {opening: 50000}); return {bad: c.bad, ok: rows.filter(r => r.balOk === true).length}; })()")
    ok(chk["bad"] == 0 and chk["ok"] == 9, look + "Bank: checkBalances over every line: 0 bad, all 9 agree (%s)" % chk)
    tc = pg.evaluate("tabCounts(B().rows)")
    ok(tc["inTally"] == 4 and tc["done"] == 2 and tc.get("old") == 2, look + "Bank: matched with Tally still counts all 4 matched lines; the Posted tab 2; 2 only in Transactions (%s)" % {k: tc.get(k) for k in ("inTally", "done", "old")})

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
        register_checks(pg, look + "Bank: ", "bank", 9)
        ok(pg.evaluate("txnRowsBank().map(r => r.id).sort().join()") == "r0,r1,r2,r3,r4,r5,r6,r7,r8", look + "Bank register: every line, the old posted ones too")
        shot(pg, ("nl-" if nl else "") + "bank-register-desktop")
        # ---- Purchase
        go(pg, "goClient('bills'); goState('intally', 'bills');", 1500)
        ok(STN(pg, "intally") == "2" and pg.evaluate("billStates().intally") == 2, look + "Purchase: In Tally counts 2 (posted 2 hours ago; marked posted by a person 3 hours ago): %s" % STN(pg, "intally"))
        rows = pg.evaluate("[...document.querySelectorAll('#app [data-entry-list=\"posted\"] .pe-list > li')].map(li => li.innerText)")
        ok(len(rows) == 2 and any("INV-b1" in r for r in rows) and any("INV-b8" in r for r in rows) and not any("INV-b2" in r or "INV-b6" in r or "INV-b7" in r for r in rows), look + "Purchase: In Tally lists b1 and b8, not b2 (25 hours), b6 (30 hours) or b7 (marked 50 hours ago)")
        ok(pg.locator("#app [data-old-posted='bills']").count() == 1 and LINE in pg.inner_text("#app [data-old-posted='bills']"), look + "Purchase: the line under the list")
        shot(pg, ("nl-" if nl else "") + "purchase-desktop")
        go(pg, "goState('errors', 'bills');", 1200)
        ok("INV-b3" in pg.inner_text("#app [data-post-panel='errors']"), look + "Purchase: the bill sent 3 days ago and never confirmed is still under Errors")
        go(pg, "goState('review', 'bills');", 1200)
        ok(STN(pg, "review") == "1" and STN(pg, "duplicate") == "1", look + "Purchase: To review 1 and Duplicates 1, whatever their age")
        go(pg, "S.step = null; S.tab = 'invoices'; S.filter = 'approved'; S.selected = null; render();", 900)
        q = pg.evaluate("[...document.querySelectorAll('#app ul.queue > li')].map(li => li.innerText).join('|')")
        ok("INV-b1" in q and "INV-b3" in q and "INV-b8" in q and "INV-b2" not in q and "INV-b6" not in q and "INV-b7" not in q, look + "Purchase: the approved bills' list leaves out only b2, b6 and b7: %s" % q)
        go(pg, "goState('intally', 'bills');", 1200)
        pg.click("#app [data-old-posted-go='bills']"); pg.wait_for_timeout(1200)
        register_checks(pg, look + "Purchase: ", "bills", 8)
        ok(pg.evaluate("txnRowsBills().map(r => r.id).sort().join()") == "b1,b2,b3,b4,b5,b6,b7,b8", look + "Purchase register: every bill")
        # ---- Sales
        go(pg, "goClient('sales'); salesTabGo('done');", 1200)
        ok(STN(pg, "intally") == "3" and pg.evaluate("salesCounts().done") == 3, look + "Sales: In Tally counts 3 (posted 2 hours ago, one only in a Tally file, one found in Tally an hour ago): %s" % STN(pg, "intally"))
        t = pg.inner_text("#app table.bk-table tbody")
        ok("SI-s1" in t and "SI-s4" in t and "SI-s6" in t and "SI-s2" not in t and "SI-s3" not in t, look + "Sales: In Tally lists s1, s4 and s6, not s2 (25 hours) or s3 (found in Tally, no time kept)")
        ok(pg.locator("#app [data-old-posted='sales']").count() == 1, look + "Sales: the line under the list")
        shot(pg, ("nl-" if nl else "") + "sales-desktop")
        go(pg, "salesTabGo('review');")
        ok("SI-s5" in pg.inner_text("#app table.bk-table tbody") and STN(pg, "review") == "1", look + "Sales: the invoice to review stays")
        pg.click("#app [data-old-posted-go='sales']"); pg.wait_for_timeout(1200)
        register_checks(pg, look + "Sales: ", "sales", 6)
        ok(pg.evaluate("SL().list.length") == 6, look + "Sales: every invoice is still kept")
        # nothing saved changed: the hiding is a view
        ok(pg.evaluate("[B().rows.filter(r => r.state === 'sent').length, Object.values(D().entries).filter(e => e.exportedAt).length, SL().list.filter(v => v.status === 'posted').length].join()") == "4,6,3", look + "the view changed nothing saved")
        # a match made now is timed (matchedAt) and listed for 24 hours; matched again to the same Tally entry, the first time stays
        m = pg.evaluate("""() => { const acc = CO().bankAccounts[0], b = B(), r5 = b.rows.find(r => r.id === "r5");
          b.books[acc.id] = {entries: [{date: r5.date, vt: "Receipt", vn: "R-15", party: "Party 5", debit: r5.credit, credit: 0, inst: "UTR505", narr: "made-up"}]};
          matchTallyBook(acc, b.rows); const at = r5.matchedAt; return [r5.state, Math.abs(Date.parse(at) - Date.now()) < 60000, at]; }""")
        ok(m[0] == "intally" and m[1], look + "Bank: a line found in Tally now gets the time it was found: %s" % m[:2])
        go(pg, "goClient('bank'); bankTabGo('done');")
        ok("r5" in pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS), look + "Bank: and is under Posted")
        m = pg.evaluate("""() => { const acc = CO().bankAccounts[0], r5 = B().rows.find(r => r.id === "r5"), old = new Date(Date.now() - 30 * 3600e3).toISOString();
          r5.matchedAt = old; matchTallyBook(acc, B().rows, true); render(); return [r5.state, r5.matchedAt === old]; }""")
        pg.wait_for_timeout(500)
        ok(m == ["intally", True] and "r5" not in pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid)" % BANKROWS), look + "Bank: matched again to the same entry keeps when it was first found (30 hours ago: off the page)")
        m = pg.evaluate("""() => { const v = SL().list.find(x => x.id === "s5"); v.dupBlock = {src: "tally", type: "Sales", number: "SI-s5", date: v.x.date, amount: 2360}; salesNearAnswer("s5");
          return [v.status, Math.abs(Date.parse(v.matchedAt) - Date.now()) < 60000]; }""")
        go(pg, "goClient('sales'); salesTabGo('done');", 1000)
        ok(m == ["intally", True] and "SI-s5" in pg.inner_text("#app table.bk-table tbody"), look + "Sales: an invoice found in Tally now (It is this invoice) is timed and under In Tally: %s" % m)
        ctx.close()
    # ---- review 3 (24-Nov-2026): what else reads the posted entries
    for nl in (False, True):
        look = "[review 3%s] " % (", new look" if nl else "")
        ctx, pg = page(br, nl=nl)
        H = "const h = (n) => new Date(Date.now() - n * 3600e3).toISOString(); "
        # 1. Bank, Posted tab, everything posted older than 24 hours: "Check they are still in Tally" is still offered
        go(pg, H + "const b = B(); b.rows.find(r => r.id === 'r0').tally.at = h(30); b.rows.find(r => r.id === 'r8').matchedAt = h(30); window.__br = [Bridge.on, Bridge.up]; Bridge.on = () => true; Bridge.up = () => true; goClient('bank'); bankTabGo('done');", 1200)
        tc = pg.evaluate("tabCounts(B().rows)")
        try: pg.get_by_role("button", name="Check they are still in Tally").wait_for(timeout=5000)   # (slow under load)
        except Exception: pass
        ok(tc["done"] == 0 and tc["old"] == 4 and pg.get_by_role("button", name="Check they are still in Tally").count() == 1, look + "Bank: every posted line older than 24 hours: Check they are still in Tally is still there (%s)" % {k: tc.get(k) for k in ("done", "old")})
        go(pg, "Bridge.on = window.__br[0]; Bridge.up = window.__br[1]; const b = B(); b.rows.find(r => r.id === 'r0').tally.at = new Date(Date.now() - 2 * 3600e3).toISOString(); b.rows.find(r => r.id === 'r8').matchedAt = new Date(Date.now() - 3 * 3600e3).toISOString(); render();", 600)
        # 2. the statement reloaded while Tally worked: a line found in Tally keeps when it was found
        m = pg.evaluate("""() => { const at = new Date().toISOString(), r = {id: "q1", state: "intally", matchedAt: at, tallyHow: "posted by FinCom earlier"}, q = {id: "q1", state: "ready"};
          if (typeof bankPostCarry !== "function") return "no bankPostCarry"; bankPostCarry([r], [q]); return [q.state, q.matchedAt === at]; }""")
        ok(m == ["intally", True], look + "Bank: the statement reloaded mid-post: the line's state and when it was found go onto the reloaded line: %s" % m)
        # 3. Post page code 2 (found in Tally): 24 hours from when FinCom found it, else from the posting
        m = pg.evaluate(H + """(() => { if (typeof postRowOld !== "function") return "no postRowOld";
          const e = {id: "b9", status: "approved", exportedAt: h(40), postVerified: true, tally: {at: h(40)}, x: {vendorName: "Vendor B9", invoiceNo: "INV-b9", invoiceDate: "2026-10-05", total: 1180}};
          const job = {id: "j9", client_id: window.__cid, status: "done", created_at: h(40), updated_at: h(40), entry_ids: ["b9"], results: [{id: "b9", ok: true, verified: true}]};
          const st2 = postStatus(e, job, {matched_at: h(2)}, [], {id: "b9"}), st2old = postStatus(e, job, {matched_at: h(30)}, [], {id: "b9"});
          return [st2.code, postRowOld({st: st2, e}), postRowOld({st: st2old, e}), postRowOld({st: {tab: "posted", code: 2, posted: h(2)}, e}), postRowOld({st: {tab: "posted", code: 2, posted: h(30)}, e})]; })()""")
        ok(m == [2, False, True, False, True], look + "Post: found in Tally (code 2) counts 24 hours from when it was found (2 h: listed, 30 h: not), else from the posting: %s" % m)
        # 4. the Posted count before the bills load: postings older than 24 hours are not counted; Invoices counts
        m = pg.evaluate(H + """(() => { const cid = window.__cid, keep = CloudJobs.list, d = S.data[cid];
          CloudJobs.list = [{id: "j1", client_id: cid, status: "done", created_at: h(2), updated_at: h(2), entry_ids: ["x1"], results: [{id: "x1", ok: true, verified: true}], n: 1},
            {id: "j2", client_id: cid, status: "done", created_at: h(30), updated_at: h(30), entry_ids: ["x2"], results: [{id: "x2", ok: true, verified: true}], n: 1}];
          perRenderClear && perRenderClear(); d.loaded = false; const pre = postTabCounts(cid).posted; d.loaded = true; CloudJobs.list = keep; perRenderClear && perRenderClear();
          return [pre, postTabCounts(cid).posted]; })()""".replace("perRenderClear && perRenderClear();", "(typeof perRenderClear === 'function' && perRenderClear());"))
        ok(m == [1, 2], look + "Post: the Posted count before the bills load leaves out the posting of 30 hours ago; after, the 2 bills of the last 24 hours: %s" % m)
        go(pg, "S.step = null; S.tab = 'invoices'; S.filter = 'approved'; S.selected = null; render();", 900)
        n = pg.evaluate("[...document.querySelectorAll('#app ul.queue > li')].length")
        ok(n == 3, look + "Purchase: the approved bills listed are the 3 not hidden: %s" % n)
        # 5. ticked lines that are now hidden are dropped, so nothing hidden is acted on
        go(pg, "goClient('bank'); bankTabGo('done'); const b = B(); b.sel.add('r0'); b.sel.add('r8'); bankLightRefresh && bankLightRefresh();", 600)
        m = pg.evaluate(H + "(() => { const b = B(); b.rows.find(r => r.id === 'r8').matchedAt = h(30); render(); return [...b.sel].sort().join(); })()")
        pg.wait_for_timeout(600)
        sel = pg.evaluate("[[...B().sel].sort().join(), bankSelected().map(r => r.id).join()]")
        ok(sel == ["r0", "r0"], look + "Bank: a ticked line that is now older than 24 hours is no longer ticked: %s" % sel)
        go(pg, "B().sel.clear(); goClient('sales'); salesTabGo('done'); const s = SL(); s.sel.add('s1'); s.sel.add('s6'); render();", 900)
        go(pg, H + "SL().list.find(v => v.id === 's6').matchedAt = h(30); render();", 900)
        sel = pg.evaluate("[...SL().sel].sort().join()")
        ok(sel == "s1" and "2 selected" not in pg.inner_text("#app"), look + "Sales: a ticked invoice that is now older than 24 hours is no longer ticked: %s" % sel)
        # 6. an Optional voucher in Tally still needs the person (make it regular in Tally): it stays, whatever its age
        # (review 5, 24-Nov-2026: anything still needing the person's action never hides)
        go(pg, H + "SL().sel.clear(); const v = SL().list.find(x => x.id === 's1'); v.postedOptional = true; v.postedAt = h(30); render();", 900)
        t = pg.inner_text("#app table.bk-table tbody") if pg.locator("#app table.bk-table tbody").count() else ""
        ok("SI-s1" in t and pg.evaluate("salesOld(SL().list.find(x => x.id === 's1'))") is False, look + "Sales: an Optional voucher posted 30 hours ago stays on the page (it must be made regular in Tally)")
        m = pg.evaluate(H + "[{status: 'intally', matchedAt: h(30), postedOptional: true, x: {}}, {status: 'posted', postedAt: h(30), postedOptional: true, x: {}}].map(salesOld)")
        ok(m == [False, False], look + "Sales: an Optional voucher found in Tally or posted, 30 hours ago: neither hides: %s" % m)
        # 7. once it is regular in Tally (Tally's read-back says not optional), it leaves 24 hours on like any other
        go(pg, "SL().list.find(x => x.id === 's1').postedOptional = false; render();", 900)
        t = pg.inner_text("#app table.bk-table tbody") if pg.locator("#app table.bk-table tbody").count() else ""
        ok("SI-s1" not in t and pg.evaluate("salesOld(SL().list.find(x => x.id === 's1'))") is True, look + "Sales: made regular in Tally (not optional any more), posted 30 hours ago: off the page")
        m = pg.evaluate(H + "[{status: 'intally', matchedAt: h(30), postedOptional: false, x: {}}, {status: 'intally', matchedAt: h(3), postedOptional: false, x: {}}].map(salesOld)")
        ok(m == [True, False], look + "Sales: found in Tally as a regular voucher: 30 hours ago hides, 3 hours ago stays: %s" % m)
        ctx.close()
    # ---- review 4 (24-Nov-2026): only the posted list hides; nothing that still needs the person's action hides
    QUEUE = "[...document.querySelectorAll('#app ul.queue > li')].map(li => li.innerText).join('|')"
    QN = "document.querySelectorAll('#app ul.queue > li').length"
    for nl in (False, True):
        look = "[review 4%s] " % (", new look" if nl else "")
        ctx, pg = page(br, nl=nl)
        H = "const h = (n) => new Date(Date.now() - n * 3600e3).toISOString(); "
        # 1. Purchase: Deleted, Duplicates and No entry list every bill they count, posted or not, and restore works
        go(pg, "goClient('bills'); const d = D().entries; softDeleteEntry(d.b2, 'Made-up reason'); d.b6.status = 'duplicate'; d.b7.status = 'rejected'; goState('deleted', 'bills');", 1500)
        q = pg.evaluate(QUEUE)
        ok("INV-b2" in q and pg.evaluate(QN) == 1 and STN(pg, "deleted") == "1", look + "Purchase: Deleted lists the bill posted 25 hours ago that was deleted (count %s, listed %r)" % (STN(pg, "deleted"), q))
        go(pg, "goState('duplicate', 'bills');", 1000)
        q = pg.evaluate(QUEUE)
        ok("INV-b5" in q and "INV-b6" in q and pg.evaluate(QN) == 2 and STN(pg, "duplicate") == "2", look + "Purchase: Duplicates lists both it counts, the posted one held too: %r" % q)
        go(pg, "goState('rejected', 'bills');", 1000)
        q = pg.evaluate(QUEUE)
        ok("INV-b7" in q and pg.evaluate(QN) == 1 and STN(pg, "rejected") == "1", look + "Purchase: No entry lists the posted bill marked no entry: %r" % q)
        go(pg, "goState('deleted', 'bills'); S.selected = 'b2'; render();", 1000)
        ok(pg.locator("#app button", has_text="Restore").count() >= 1, look + "Purchase: the deleted bill opens with its Restore button")
        go(pg, "billRestore('b2');", 800)
        ok(pg.evaluate("D().entries.b2.status") == "approved", look + "Purchase: Restore puts the posted bill back where it was")
        # clearSent: "They are under Deleted" stays true for bills posted more than 24 hours ago
        go(pg, H + "const d = D().entries; d.b6.status = 'approved'; d.b7.status = 'approved'; [d.b6, d.b7].forEach(e => { e.exportedAt = h(24 * 100); if (e.tally) e.tally.at = h(24 * 100); }); clearSent(); goState('deleted', 'bills');", 1500)
        q = pg.evaluate(QUEUE)
        ok("INV-b6" in q and "INV-b7" in q and pg.evaluate(QN) == 2 and STN(pg, "deleted") == "2", look + "Purchase: after clearing bills sent over 90 days ago, both are under Deleted as its message says: %r (count %s)" % (q, STN(pg, "deleted")))
        go(pg, "const d = D().entries; [d.b6, d.b7].forEach(e => { billRestore(e.id); });", 800)
        # 2. Purchase, Posted automatically view: a bill posted by itself more than 24 hours ago is not there
        go(pg, H + "const d = D().entries; d.b1.auto = {at: h(2), rule: 'x', key: 'k'}; d.b2.auto = {at: h(25), rule: 'x', key: 'k'}; S.apView = {bills: 'auto'}; S.step = null; S.tab = 'invoices'; S.filter = 'approved'; S.selected = null; render();", 1200)
        q = pg.evaluate(QUEUE)
        ok("INV-b1" in q and "INV-b2" not in q, look + "Purchase: Posted automatically lists the bill of 2 hours ago, not the one of 25 hours: %r" % q)
        # 3. Bank, Posted automatically view: the same, and so no Undo on a line not shown
        go(pg, H + "const b = B(); b.rows.find(x => x.id === 'r0').auto = {at: h(2), rule: 'x', key: 'k', dir: 'out'}; b.rows.find(x => x.id === 'r1').auto = {at: h(25), rule: 'x', key: 'k', dir: 'in'}; S.apView = {bank: 'auto'}; goClient('bank'); bankTabGo('done');", 1500)
        ids = pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid).sort()" % BANKROWS)
        ok(ids == ["r0"] and pg.locator("#app [data-ap-undo='r1']").count() == 0, look + "Bank: Posted automatically lists the line of 2 hours ago only, no Undo for the one of 25 hours: %s" % ids)
        # 4. Sticky rows: a line or invoice kept in place by a click is not kept once it is older than 24 hours
        go(pg, "S.apView = {}; const b = B(); b.sticky.add('r1'); b.sticky.add('r2'); render();", 1000)
        ids = pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid).sort()" % BANKROWS)
        ok(ids == ["r0", "r8"], look + "Bank: lines kept in place (sticky) but older than 24 hours are not listed: %s" % ids)
        go(pg, "B().sticky.clear(); goClient('sales'); salesTabGo('done'); const s = SL(); s.sticky.add('s2'); s.sticky.add('s3'); render();", 1200)
        t = pg.inner_text("#app table.bk-table tbody")
        ok("SI-s2" not in t and "SI-s3" not in t, look + "Sales: invoices kept in place (sticky) but older than 24 hours are not listed")
        go(pg, "SL().sticky.clear(); render();", 600)
        # 5. Sales: an invoice still in Tally whose IRN was cancelled keeps its red warning on the page, whatever its age;
        # so does one with a problem to fix, a posting queued, or a Tally error
        go(pg, "const v = SL().list.find(x => x.id === 's2'); v.x.irn = 'X1'; v.x.irnStatus = 'cancelled'; v.x.irnCancelInTally = true; const w = SL().list.find(x => x.id === 's3'); w.problems = ['Made-up problem to fix']; render();", 1000)
        t = pg.inner_text("#app table.bk-table tbody")
        m = pg.evaluate("['s2', 's3'].map(id => salesOld(SL().list.find(x => x.id === id)))")
        ok("SI-s2" in t and "SI-s3" in t and m == [False, False] and STN(pg, "intally") == "5", look + "Sales: the IRN-cancelled invoice and the one with a problem stay under In Tally, counted (%s, salesOld %s)" % (STN(pg, "intally"), m))
        # (the e-invoice part shows with the firm's GST API on and both GSTINs given: made-up ones)
        go(pg, "window.__gon = GSTAPI.on; GSTAPI.on = () => true; SL().list.find(x => x.id === 's2').x.customerGstin = '09AABCT1234E1Z2'; salesOpen('s2');", 900)
        ok(pg.locator("#app [data-irn-cancel-tally]").count() == 1, look + "Sales: it opens with its IRN-cancelled warning")
        go(pg, "salesAct('salesClose'); GSTAPI.on = window.__gon;", 500)
        m = pg.evaluate(H + "[{status: 'posted', postedAt: h(30), postJob: 'j1', x: {}}, {status: 'posted', postedAt: h(30), postError: 'Made-up error', x: {}}, {status: 'posted', postedAt: h(30), x: {}}].map(salesOld)")
        ok(m == [False, False, True], look + "Sales: a posting still queued or a Tally error keeps an old invoice; one with nothing to do leaves: %s" % m)
        # 6. Post to Tally: a row with an action to take ("Correct the Tally id") never leaves Posted
        m = pg.evaluate(H + """(() => [postRowOld({st: {tab: "posted", code: 3, posted: h(40), markedAt: h(30), action: {kind: "correctId", label: "Correct the Tally id"}, id: {suspect: true}}}),
          postRowOld({st: {tab: "posted", code: 1, posted: h(40), action: {kind: "correctId", label: "Correct the Tally id"}, id: {suspect: true}}}),
          postRowOld({st: {tab: "posted", code: 1, posted: h(40), action: null, id: {suspect: false}}}),
          postRowOld({st: {tab: "posted", code: 3, posted: h(40), markedAt: h(30), action: null}})])()""")
        ok(m == [False, False, True, True], look + "Post: Correct the Tally id keeps the row under Posted, whatever its age; with nothing to do it leaves: %s" % m)
        # 7. a bill a person marked as already in Tally (code 3) leaves 24 hours after the mark, like a confirmed one (kept)
        m = pg.evaluate(H + "[billOld({status: 'approved', exportedAt: h(50), postVerified: true, tally: {at: h(50), byOwner: 'X', byOwnerAt: h(30)}}), billOld({status: 'approved', exportedAt: h(50), postVerified: true, tally: {at: h(50), byOwner: 'X', byOwnerAt: h(3)}})]")
        ok(m == [True, False], look + "Purchase: marked already in Tally by a person: off the page 24 hours after the mark: %s" % m)
        ctx.close()
    # ---- review 6 (24-Nov-2026): one rule per kind, salesNeedsAction / billNeedsAction / bankNeedsAction (src/js/03):
    # anything whose page or panel still offers an action or a warning never hides, whatever its age (the review's probe)
    for nl in (False, True):
        look = "[review 6%s] " % (", new look" if nl else "")
        ctx, pg = page(br, nl=nl)
        H = "const h = (n) => new Date(Date.now() - n * 3600e3).toISOString(); "
        go(pg, "goClient('sales'); salesTabGo('done');", 1500)
        ok(pg.evaluate("['salesNeedsAction', 'billNeedsAction', 'bankNeedsAction'].map(n => typeof window[n]).join()") == "function,function,function", look + "the three rules are there")
        # Sales: s2, posted 25 hours ago, nothing to do: hides; each warning or action the panel shows keeps it
        CP = H + "const cp = (f) => { const v = JSON.parse(JSON.stringify(SL().list.find(x => x.id === 's2'))); v.x.customerGstin = '09AABCT1234E1Z2'; f(v); return salesOld(v); }; "
        m = pg.evaluate("() => { " + CP + """return {none: cp(v => {}), irnCancelInTally: cp(v => { v.x.irn = 'X'; v.x.irnStatus = 'cancelled'; v.x.irnCancelInTally = true; }),
          postJob: cp(v => { v.postJob = 'j1'; }), postError: cp(v => { v.postError = 'Made-up error'; }), refused: cp(v => { v.refused = {hint: 'x'}; }), needsCheck: cp(v => { v.needsCheck = true; }),
          problems: cp(v => { v.problems = ['Made-up problem']; }), ledgerIssues: cp(v => { v.ledgerIssues = ['Made-up ledger issue']; }), postedOptional: cp(v => { v.postedOptional = true; }),
          copyCheck: cp(v => { v.copyCheck = {at: h(30), note: 'Checked against a made-up copy'}; })}; }""")
        ok(m.pop("none") is True and not any(m.values()), look + "Sales: posted 25 hours ago hides; IRN cancelled while in Tally, a posting queued, Tally's error, refused, to check, a problem, a ledger issue, Optional, checked on FinCom's copy each keep it: %s" % m)
        # the e-invoice part (the firm's GST API on, the client's e-invoice user given: made-up). An action counts only when
        # the person can do it there: Make the IRN while its button is enabled (EINV.problems empty: rd makes the invoice
        # ready, with PIN codes and its item) and within the IRP's 30 days (EINV.irnLate)
        GON = "window.__gon = window.__gon || GSTAPI.on; GSTAPI.on = () => true; const g = String(CO().gstin).toUpperCase(); EINV.accounts[g] = {user: 'made-up'}; EINV.asked[g] = Date.now(); SL().cfg.address = 'Made-up Road, Lucknow 226001'; "
        IT = ("const it = (hsn, taxable, gstRate, more) => Object.assign({desc: 'Made-up item', hsn, qty: 1, rate: taxable, taxable, gstRate}, more || {}); "
              "const rd = (v) => { Object.assign(v.x, {date: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), address: 'Made-up Lane, Noida 201301', items: [it('8471', 2000, 18)]}); }; "
              "const irn = (v, items, more) => { Object.assign(v.x, {irn: 'I1', irnStatus: 'active', ackNo: '1', ackDt: h(30), ewayNo: '', items}, more || {}); }; ")
        m = pg.evaluate("() => { " + CP + GON + IT + """return {ready: cp(rd), blocked: cp(v => {}), late: cp(v => { rd(v); v.x.date = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10); }),
          intallyBlocked: cp(v => { v.status = 'intally'; v.matchedAt = h(30); }), cancel2h: cp(v => { Object.assign(v.x, {irn: 'I1', irnStatus: 'active', ackNo: '1', ackDt: h(2), ewayNo: 'E1'}); }),
          noGoods30h: cp(v => { Object.assign(v.x, {irn: 'I1', irnStatus: 'active', ackNo: '1', ackDt: h(30), ewayNo: ''}); }), withEwb30h: cp(v => { Object.assign(v.x, {irn: 'I1', irnStatus: 'active', ackNo: '1', ackDt: h(30), ewayNo: 'E1'}); }),
          cancelledReady: cp(v => { rd(v); Object.assign(v.x, {irn: 'I1', irnStatus: 'cancelled'}); }), cancelledBlocked: cp(v => { Object.assign(v.x, {irn: 'I1', irnStatus: 'cancelled'}); })}; }""")
        ok(m == {"ready": False, "blocked": True, "late": True, "intallyBlocked": True, "cancel2h": False, "noGoods30h": True, "withEwb30h": True, "cancelledReady": False, "cancelledBlocked": True},
           look + "Sales: Make the IRN keeps it only when enabled and within 30 days (ready: stays; blocked by its problems, or late: hides); Cancel the IRN of 2 hours keeps it; IRN of 30 hours with no goods or with its e-way bill hides; IRN cancelled: Make the IRN again keeps it only when enabled: %s" % m)
        # the e-way bill counts only when one is needed: goods (an HSN not starting with 99; a blank one counts) that bear GST,
        # worth over Rs 50,000 with GST and cess (EINV.ewbNeeded); never a credit or debit note; no GST under LUT to an SEZ
        m = pg.evaluate("() => { " + CP + GON + IT + """return {services: cp(v => irn(v, [it('998314', 90000, 18)])), goodsOver: cp(v => irn(v, [it('8471', 50000, 18)])),
          goodsAt: cp(v => irn(v, [it('8471', 50000, 0)])), goodsUnder: cp(v => irn(v, [it('8471', 30000, 18)])), mixedOver: cp(v => irn(v, [it('998314', 90000, 18), it('8471', 45000, 18)])),
          mixedUnder: cp(v => irn(v, [it('998314', 90000, 18), it('8471', 20000, 18)])), goodsOverWithEwb: cp(v => { irn(v, [it('8471', 50000, 18)]); v.x.ewayNo = 'E1'; }),
          creditNote: cp(v => irn(v, [it('8471', 60000, 18)], {noteKind: 'credit'})), debitNote: cp(v => irn(v, [it('8471', 60000, 18)], {noteKind: 'debit'})),
          sezLut45k: cp(v => irn(v, [it('8471', 45000, 18)], {supply: 'SEZWOP'})), sezWithTax45k: cp(v => irn(v, [it('8471', 45000, 18)], {supply: 'SEZWP'})),
          exempt0pct60k: cp(v => irn(v, [it('0701', 60000, 0)])), exemptFlag60k: cp(v => irn(v, [it('0701', 60000, 5, {exempt: true})])),
          invoiceCess: cp(v => irn(v, [it('2402', 40000, 12)], {cess: 8000})), noInvoiceCess: cp(v => irn(v, [it('2402', 40000, 12)])),
          hsnBlank60k: cp(v => irn(v, [it('', 60000, 18)])), qtyRate59k: cp(v => irn(v, [{desc: 'x', hsn: '8471', qty: 2, rate: 25000, gstRate: 18}])),
          discount47k: cp(v => irn(v, [{desc: 'x', hsn: '8471', qty: 1, rate: 60000, taxable: 40000, gstRate: 18}])), irnTypedNoItems: cp(v => irn(v, [], {irnStatus: '', ackDt: '', taxable: 100000, igst: 18000, total: 118000}))}; }""")
        ok(m == {"services": True, "goodsOver": False, "goodsAt": True, "goodsUnder": True, "mixedOver": False, "mixedUnder": True, "goodsOverWithEwb": True, "creditNote": True, "debitNote": True,
                 "sezLut45k": True, "sezWithTax45k": False, "exempt0pct60k": True, "exemptFlag60k": True, "invoiceCess": False, "noInvoiceCess": True, "hsnBlank60k": False, "qtyRate59k": False, "discount47k": True, "irnTypedNoItems": True},
           look + "Sales, an IRN of 30 hours and no e-way bill: only goods bearing GST worth over Rs 50,000 keep it (services, Rs 50,000 or under, notes, SEZ under LUT under the limit, exempt, a discount under it, no items: hide; blank HSN, qty x rate, the invoice's own cess count): %s" % m)
        m = pg.evaluate("() => { " + CP + "GSTAPI.on = window.__gon; return [cp(v => {}), cp(v => { Object.assign(v.x, {irn: 'I1', irnStatus: 'active', ackNo: '1', ackDt: h(2), ewayNo: ''}); })]; }")
        ok(m == [True, True], look + "Sales: the firm's GST API off (no e-invoice part on the panel): nothing offered, it hides: %s" % m)
        def listed_with(js, button):
            go(pg, H + GON + "const v = SL().list.find(x => x.id === 's2'); v.x.customerGstin = '09AABCT1234E1Z2'; " + js + " SL().openId = null; render();", 900)
            t = pg.inner_text("#app table.bk-table tbody") if pg.locator("#app table.bk-table tbody").count() else ""
            go(pg, "salesOpen('s2');", 900)
            n = pg.locator("#app [data-einv] button", has_text=button).count() if button else pg.locator("#app [data-einv] button").count()
            go(pg, "salesAct('salesClose');", 400)
            return "SI-s2" in t, n
        m = listed_with("", "Make the IRN")
        ok(m == (False, 1) and pg.evaluate("salesOpen('s2'), document.querySelector('#app [data-einv] button.primary').disabled") is True, look + "Sales: no IRN, its button disabled by the invoice's problems: off the page (the panel still shows it, disabled): %s" % (m,))
        go(pg, "salesAct('salesClose');", 400)
        m = listed_with("Object.assign(v.x, {date: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), address: 'Made-up Lane, Noida 201301', items: [{desc: 'Made-up item', hsn: '8471', qty: 1, rate: 2000, taxable: 2000, gstRate: 18}]});", "Make the IRN")
        ok(m == (True, 1) and pg.evaluate("salesOpen('s2'), document.querySelector('#app [data-einv] button.primary').disabled") is False, look + "Sales: no IRN yet, ready to make: listed, and its panel offers Make the IRN, enabled: %s" % (m,))
        go(pg, "salesAct('salesClose');", 400)
        m = listed_with("Object.assign(v.x, {irn: 'I1', irnStatus: 'active', ackNo: '1', ackDt: h(30), ewayNo: '', items: [{desc: 'Made-up item', hsn: '998314', qty: 1, rate: 90000, taxable: 90000, gstRate: 18}]});", "Make the e-way bill")
        ok(m == (False, 1), look + "Sales: services with an IRN and no e-way bill: off the page, its panel still offers Make the e-way bill: %s" % (m,))
        m = listed_with("v.x.items = [{desc: 'Made-up item', hsn: '8471', qty: 1, rate: 50000, taxable: 50000, gstRate: 18}];", "Make the e-way bill")
        ok(m == (True, 1), look + "Sales: goods over Rs 50,000 with an IRN and no e-way bill: listed, and its panel offers Make the e-way bill: %s" % (m,))
        m = listed_with("Object.assign(v.x, {ackDt: h(2), ewayNo: 'E1'});", "Cancel the IRN")
        ok(m == (True, 1), look + "Sales: an IRN of 2 hours: listed, and its panel offers Cancel the IRN: %s" % (m,))
        m = listed_with("Object.assign(v.x, {ackDt: h(30), ewayNo: 'E1'});", "")
        ok(m == (False, 0), look + "Sales: an IRN of 30 hours with its e-way bill: nothing offered, off the page: %s" % (m,))
        go(pg, "GSTAPI.on = window.__gon; const v = SL().list.find(x => x.id === 's2'); Object.assign(v.x, {irn: '', irnStatus: '', ackDt: '', ewayNo: '', customerGstin: '', items: [], address: '', date: '2026-10-22'}); SL().cfg.address = ''; render();", 500)
        # Bills: b6, Tally's reply 30 hours ago, nothing to do: hides; each warning or action keeps it
        m = pg.evaluate("() => { " + H + """const cp = (f) => { const e = JSON.parse(JSON.stringify(D().entries.b6)); f(e); return billOld(e); };
          return {none: cp(e => {}), postedOptional: cp(e => { e.postedOptional = true; }), ownerRelease: cp(e => { e.ownerRelease = {ask: true, by: 'Made-up Member', why: 'made-up'}; }),
            goneFromTally: cp(e => { e.goneFromTally = h(2); }), postError: cp(e => { e.postError = 'Made-up error'; }), postCheckFailed: cp(e => { e.postCheckFailed = {at: h(1), message: 'Could not check Tally'}; }),
            postUnconfirmed: cp(e => { e.postUnconfirmed = {at: h(1)}; }), notBill: cp(e => { e.docKind = 'proforma'; }), billedElsewhere: cp(e => { e.x.buyerGstin = '27AAAAA0000A1Z5'; })}; }""")
        ok(m.pop("none") is True and not any(m.values()), look + "Purchase: posted 30 hours ago hides; Optional, the owner's release, gone from Tally, Tally's error, a failed check, not confirmed, not a tax invoice, billed to another GSTIN (each a warning with its button on the bill) keep it: %s" % m)
        m = pg.evaluate("() => { " + H + """const cp = (f) => { const e = JSON.parse(JSON.stringify(D().entries.b6)); f(e); return billOld(e); };
          return [cp(e => { e.postAltered = true; }), cp(e => { e.docKind = 'proforma'; e.docOverride = true; }), cp(e => { e.x.buyerGstin = '27AAAAA0000A1Z5'; e.buyerOverride = true; }), cp(e => { e.x.buyerGstin = CO().gstin; })]; }""")
        ok(m == [True, True, True, True], look + "Purchase: altered in Tally (no warning on the bill), a paper taken as a tax invoice, a bill kept here, one billed to the client: hide: %s" % m)
        go(pg, "goClient('bills'); D().entries.b6.docKind = 'proforma'; S.step = null; S.tab = 'invoices'; S.filter = 'approved'; S.selected = 'b6'; render();", 1000)
        m = [pg.locator("#app .bigwarn button", has_text="It is a tax invoice").count(), "INV-b6" in pg.evaluate("[...document.querySelectorAll('#app ul.queue > li')].map(li => li.innerText).join('|')")]
        ok(m == [1, True], look + "Purchase: a posted paper that is not a tax invoice: its warning and button on the bill, and listed: %s" % m)
        go(pg, "delete D().entries.b6.docKind; S.selected = null; render();", 400)
        # ... and what Post to Tally shows for it from FinCom's cloud: a posting queued, a reply to review, a Tally id to correct
        m = pg.evaluate("() => { " + H + """const cid = window.__cid, keep = CloudJobs.list, e = D().entries.b6;
          const J = (st, res) => ({id: 'jx', client_id: cid, status: st, created_at: h(30), updated_at: h(30), entry_ids: ['b6'], results: res ? [res] : [], n: 1});
          const at = (list) => { CloudJobs.list = list; return billOld(e); };
          const out = [at([J('waiting')]), at([J('done', {id: 'b6', ok: false, needsReview: true, message: 'Made-up reply'})]),
            at([J('done', {id: 'b6', ok: true, verified: true, byOwner: 'Made-up Owner', vchNumber: 'INV-b6'})]), at([J('done', {id: 'b6', ok: true, verified: true})])];
          CloudJobs.list = keep; return out; }""")
        ok(m == [False, False, False, True], look + "Purchase: a posting queued, Tally's reply to review, a suspect Tally id (Correct the Tally id) keep it; posted with nothing to do hides: %s" % m)
        go(pg, H + "window.__keepJobs = CloudJobs.list; CloudJobs.list = [{id: 'jx', client_id: window.__cid, status: 'done', created_at: h(30), updated_at: h(30), entry_ids: ['b6'], results: [{id: 'b6', ok: true, verified: true, byOwner: 'Made-up Owner', vchNumber: 'INV-b6'}], n: 1}]; S.step = null; S.tab = 'invoices'; S.filter = 'approved'; S.selected = null; render();", 1000)
        q = pg.evaluate("[...document.querySelectorAll('#app ul.queue > li')].map(li => li.innerText).join('|')")
        ok("INV-b6" in q, look + "Purchase: the bill whose Tally id is to be corrected stays in the approved bills' list: %r" % q[:200])
        go(pg, "goState('intally', 'bills');", 1500)
        ok("INV-b6" in pg.inner_text("#app [data-post-panel='posted']") if pg.locator("#app [data-post-panel='posted']").count() else False, look + "Purchase: and under In Tally, with Correct the Tally id")
        go(pg, "CloudJobs.list = window.__keepJobs; render();", 500)
        # Bank: r1, posted 25 hours ago, nothing to do: hides; each warning or action keeps it
        m = pg.evaluate("() => { " + H + """const cp = (f) => { const r = JSON.parse(JSON.stringify(B().rows.find(x => x.id === 'r1'))); f(r); return bankOld(r); };
          return {none: cp(r => {}), postedOptional: cp(r => { r.postedOptional = true; }), postJob: cp(r => { r.postJob = 'job-x'; }), postError: cp(r => { r.postError = 'Made-up error'; }),
            postReview: cp(r => { r.postReview = {job: 'j', created: 0, n: 1}; }), checking: cp(r => { r.checking = true; }), goneFromTally: cp(r => { r.goneFromTally = h(2); })}; }""")
        ok(m.pop("none") is True and not any(m.values()), look + "Bank: posted 25 hours ago hides; Optional, a posting queued, Tally's error, to review, being checked, gone from Tally each keep it: %s" % m)
        m = pg.evaluate("() => { " + H + """const keep = CloudJobs.list, r = B().rows.find(x => x.id === 'r1');
          CloudJobs.list = [{id: 'jb', client_id: window.__cid, status: 'waiting', created_at: h(1), updated_at: h(1), entry_ids: ['r1'], results: [], n: 1}]; const a = bankOld(r); CloudJobs.list = keep; return [a, bankOld(r)]; }""")
        ok(m == [False, True], look + "Bank: a posting of FinCom's cloud still queued for the line keeps it: %s" % m)
        # a line Tally confirmed 25 hours ago with an older cloud posting that failed: it is in Tally, so that posting is not
        # its row (as for bills); a row the person removed or hid on Post to Tally, or of a posting dismissed, is not one to act on
        JOB = ("const keep = CloudJobs.list, r = B().rows.find(x => x.id === ID); CloudJobs.list = [{id: 'jf', client_id: window.__cid, status: 'failed', kind: 'bank', created_at: h(40), updated_at: h(40), attempts: 1, entry_ids: [ID], "
               "items: [{id: ID, state: 'failed', reason: 'Made-up refusal'}], results: [{id: ID, ok: false, message: 'Made-up refusal'}], message: 'Made-up refusal'}]; ")
        m = pg.evaluate("() => { " + H + JOB.replace("ID", "'r1'") + """const rows = (postEntryRows(window.__cid) || []).filter(x => x.id === 'r1').length, a = bankOld(r);
          CloudJobs.list = keep; return [rows, a]; }""")
        ok(m == [0, True], look + "Bank: a line in Tally (25 hours) whose older cloud posting failed: no Errors row for that posting, and it hides: %s" % m)
        m = pg.evaluate("() => { " + H + JOB.replace("ID", "'r5'") + """const k = 'jf:r5', rr = () => (postEntryRows(window.__cid) || []).some(x => x.key === k), on = () => postNeeds(window.__cid).has('bank:r5');
          const out = [rr(), on()]; PostFlags.removed.set(k, {by: 'me', at: h(1), why: 'made-up', attempts: 1}); out.push(on()); PostFlags.removed.delete(k);
          PostFlags.hide.add(k); out.push(on()); PostFlags.hide.delete(k); CloudJobs.list[0].dismissed_at = h(1); CloudJobs.list = CloudJobs.list.slice(); out.push(on()); CloudJobs.list = keep; return out; }""")
        ok(m == [True, True, False, False, False], look + "Bank: a refused posting's row counts until the person removes it, hides it, or the posting is dismissed: %s" % m)
        m = pg.evaluate("() => { " + H + """const r = B().rows.find(x => x.id === 'r1'), keep = CloudJobs.list; CloudJobs.list = [{id: 'jf', client_id: window.__cid, status: 'failed', kind: 'bank', created_at: h(40), updated_at: h(40), attempts: 1, entry_ids: ['r1'],
          items: [{id: 'r1', state: 'failed', reason: 'Made-up refusal'}], results: [{id: 'r1', ok: false, message: 'Made-up refusal'}], message: 'Made-up refusal'}]; PostFlags.removed.set('jf:r1', {by: 'me', at: h(1), why: 'made-up', attempts: 1});
          const a = bankOld(r); PostFlags.removed.delete('jf:r1'); CloudJobs.list = keep; return a; }""")
        ok(m is True, look + "Bank: and after its Post row is removed, it hides: %s" % m)
        go(pg, "B().rows.find(x => x.id === 'r1').postedOptional = true; goClient('bank'); bankTabGo('done');", 1200)
        ids = pg.evaluate("[...document.querySelectorAll('%s')].map(t => t.dataset.rid).sort()" % BANKROWS)
        ok("r1" in ids, look + "Bank: the Optional line posted 25 hours ago is under Posted: %s" % ids)
        go(pg, "B().rows.find(x => x.id === 'r1').postedOptional = false; render();", 500)
        # Transactions: the words
        m = pg.evaluate("[txnRowsSales().find(x => x.id === 's3').label, txnRowsSales().find(x => x.id === 's6').label, txnRowsBank().find(x => x.id === 'r3').label, txnRowsBank().find(x => x.id === 'r7').label]")
        ok(m == ["In Tally", "In Tally", "Not found in Tally", "Gone from Tally"], look + "Transactions: invoices found in Tally say In Tally; a bank line in a Tally file not found says Not found in Tally; one gone, Gone from Tally: %s" % m)
        m = pg.evaluate("(() => { const e = D().entries.b1; e.goneFromTally = new Date().toISOString(); const l = txnRowsBills().find(x => x.id === 'b1').label; delete e.goneFromTally; return l; })()")
        ok(m == "Gone from Tally", look + "Transactions: a bill gone from Tally says Gone from Tally: %s" % m)
        # Restore of a deleted bill posted more than 24 hours ago: the message says it is in Transactions, and no bill is left open
        go(pg, "window.__t = []; const t0 = window.toast; window.toast = (m, ...a) => { window.__t.push(String(m)); return t0(m, ...a); }; goClient('bills'); softDeleteEntry(D().entries.b2, 'Made-up reason'); goState('deleted', 'bills'); S.selected = 'b2'; render();", 1500)
        go(pg, "billRestore('b2');", 1200)
        m = pg.evaluate("[D().entries.b2.status, S.selected, window.__t.slice(-1)[0] || '', (document.querySelector('#app .detail') || {innerText: ''}).innerText.includes('INV-b2')]")
        ok(m[0] == "approved" and m[1] != "b2" and "Transactions" in m[2] and not m[3], look + "Purchase: a posted bill of 25 hours restored: its message says it is in Transactions, and it is not left open: %s" % m)
        go(pg, "softDeleteEntry(D().entries.b1, 'Made-up reason'); goState('deleted', 'bills'); S.selected = 'b1'; render();", 1200)
        go(pg, "billRestore('b1');", 1200)
        q = pg.evaluate("[...document.querySelectorAll('#app ul.queue > li')].map(li => li.innerText).join('|')")
        m = pg.evaluate("[D().entries.b1.status, S.selected, window.__t.slice(-1)[0] || '']")
        ok(m[1] == "b1" and m[2] == "Restored to In Tally." and "INV-b1" in q, look + "Purchase: a posted bill of 2 hours restored: listed and open where its message says: %s" % m)
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
