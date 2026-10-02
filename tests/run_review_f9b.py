"""python3 run_review_f9b.py - the review of build f9b59b7 (02-Oct-2026), items 6, 7, 11, 12, 14, 15 and 17, on Testing
AAD's books: a saved MIS run from other books or older working is worked out again (its figures not shown meanwhile), GST
worked out to pay from the 3B working and paid from the bank; bank lines whose vouchers are no longer in Tally are not
In Tally; an audit run that no longer fits is not shown (Run again), "Last run on … (run by hand)"; Sales has its three
tabs at the top; one entry count with what is left out; a supplier with a Tally ledger is not "new"; an owner clears a
wrong GSTIN with a reason.
Uses tests/data/books-cache.json and gst-cache.json (client data, not in git).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_review_f9b.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8205), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books, gst = gstfix.load()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8205/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(gstfix.SETUP, [books, gst]); pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render()"); pg.wait_for_timeout(500)
    E = lambda js, *a: pg.evaluate(js, *a)

    # 6. MIS: a saved run from before is worked out again on open; its old figures are not shown
    E("""() => { S.books.mis = {last: {at: '2026-10-01T05:00:00Z', how: 'run now', from: '20250401', to: '20260331', code: '1FB42BF2', recv: {sum: {owe: 11061126.26}}, comp: {gst: []}}}; S.view = 'company'; S.tab = 'books'; S.booksTab = 'mis'; render(); }""")
    pg.wait_for_timeout(2500)
    r = E("(() => { const r = S.books.mis.last; return {code: r.code, basis: r.basis === MIS.basis(), owe: r.recv.sum.owe, dpo: r.dpo, gst: r.comp.gst.slice(0, 2).map(x => [x.ym, x.due, x.pay])}; })()")
    ok(r["code"] != "1FB42BF2" and r["basis"] and r["owe"] == 11197404.38, "6. the saved run of 01-Oct (1FB42BF2) is worked out again on open: owed to you 1,11,97,404.38 (%s)" % r["owe"])
    ok(r["gst"][0] == ["202504", 306818.25, 200000] and r["gst"][1][2] == 160400, "6. GST: worked out to pay from the 3B working (Apr 3,06,818.25), paid from the bank (Apr 2,00,000, May 1,60,400) (%s)" % r["gst"])
    ok(r["dpo"] is None and "days of purchases" not in pg.inner_text("#app"), "6. no 'days of purchases' (no purchases of goods)")

    # 11. audit: a run that no longer fits is not shown, on Audit or Reports; "Last run on … (run by hand)"
    E("""() => { S.books.audit = {st: {}, last: {at: '2026-10-01T00:00:00Z', how: 'run now', from: '20250401', to: '20260331', vouchers: 2675, findings: [{id: 'x', sev: 'high', title: 'Old finding', amount: 5, area: 'gst'}], notes: [], errors: []}}; S.booksTab = 'audit'; render(); }""")
    pg.wait_for_timeout(700)
    t = pg.inner_text("#app")
    ok("Old finding" not in t and "Run again" in t and "worked out before the books or FinCom" in t, "11. an audit run from older working: its findings are not shown, Run again")
    E("() => { S.booksTab = 'reports'; S.rptOpen = null; render(); }"); pg.wait_for_timeout(900)
    ok(pg.locator("#app [data-rpt-audit-stale]").count() >= 1 or "no longer fits the books" in pg.inner_text("#app"), "11. Reports does not show its figures either")
    E("() => { Audit.run('20250401', '20260331'); S.booksTab = 'audit'; render(); }"); pg.wait_for_timeout(900)
    t = pg.inner_text("#app")
    ok("Last run on " in t and "(run by hand)" in t and "Last run run now" not in t, "11. 'Last run on … (run by hand)', not 'Last run run now on'")

    # 14. one entry count, with what is left out
    ok("2,675 entries (66 Optional and 13 cancelled not counted)" in t, "14. the audit's period: 2,675 entries (66 Optional and 13 cancelled not counted)")
    yc = E("RPT.yearCount('2025')")
    ok(yc["n"] == 2675 and "66 Optional and 13 cancelled" in yc["text"], "14. Reports counts the same 2,675 (%s)" % yc["text"])

    # 15. a supplier with a Tally ledger is not "new"
    s15 = E("""(() => { const led = Object.keys(S.books.gstins || {})[0], g = S.books.gstins[led];
      return {led, byGst: supplierInTally({vendorName: 'Something else', vendorGstin: g}), byName: supplierInTally({vendorName: led.toUpperCase()}), none: supplierInTally({vendorName: 'No Such Supplier Pvt Ltd'})}; })()""")
    ok(s15["byGst"] == s15["led"] and s15["byName"] == s15["led"] and s15["none"] == "", "15. a supplier is found in Tally by GSTIN or name (%s); an unknown one is new" % s15["led"])

    # 7. bank lines whose vouchers are no longer in Tally
    E("""() => { const b = {cid: S.coId, stmts: [{id: 's1', acctId: 'a1', bank: 'HDFC', from: '2026-04-01', to: '2026-09-30'}], cur: 's1', filter: 'done', sel: new Set(), keys: {}, books: {}, rules: [], wrules: [], newLed: [], ledgers: {list: [{name: 'HDFC BANK', group: 'Bank Accounts'}, {name: 'Rent', group: 'Indirect Expenses'}], importedAt: new Date().toISOString(), live: true}, q: '', limit: 100, loading: false, grouped: false, showSettings: false, pendingRule: null, busy: '', createFor: null, sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: [],
        rows: Array.from({length: 6}, (_, i) => ({id: 's1-' + i, fp: 'f' + i, date: '2026-04-0' + (i + 1), debit: 1000 + i, credit: 0, bal: 0, narr: 'NEFT ' + i, dec: {}, ledger: 'Rent', state: i < 4 ? 'sent' : 'intally', balOk: true, why: [], sentAt: '2026-09-27T10:30:16Z', postedVia: 'bridge',
          tally: i < 4 ? {at: '2026-09-27T10:30:16Z', guid: 'g' + i, number: String(690 + i), vchDate: '2026040' + (i + 1)} : null}))};
      CO().bankAccounts = [{id: 'a1', bank: 'HDFC', ledger: 'HDFC BANK'}]; S.bank = b;
      TCloud.on = () => true; TCloud.has = () => true; TCloud.book = () => ({book: 'bk', daysAt: '2026-10-01T10:44:08Z', state: {doneTo: '20261001', skipped: ['20260930', '20261001']}});
      Cloud.api = async (u) => /tally_vouchers/.test(u) ? [{guid: 'g0', cancelled: false}] : /tally_lines/.test(u) && /2026-04-05/.test(u) ? [{ledger: 'HDFC BANK', amount: 1004}] : []; }""")
    n = E("TallyProof.checkBank(S.coId, true)")
    tc = E("tabCounts(B().rows)")
    ok(n == 4 and tc["done"] == 2 and tc["gone"] == 4 and tc["ready"] == 4, "7. In Tally: only the 2 lines still among Tally's entries; 4 no longer there go back under Post to Tally (%s)" % {k: tc[k] for k in ("done", "ready", "gone")})
    E("() => { S.tab = 'bank'; render(); }"); pg.wait_for_timeout(800)
    E("() => { B().filter = 'ready'; render(); }"); pg.wait_for_timeout(500)
    ok(pg.locator("#app [data-bank-gone]").count() == 1 and "Not in Tally any more" in pg.inner_text("#app"), "7. they are marked 'Not in Tally any more', with 'post them again'")
    E("() => bankRepostGone()"); pg.wait_for_timeout(300)
    ok(E("tabCounts(B().rows)")["post"] == 4, "7. post them again: back to ready")

    # 12. Sales: the three tabs at the top, also before the first invoice
    E("() => { S.tab = 'sales'; render(); }"); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-sales-tabs] button").count() == 3 and "Post to Tally" in pg.inner_text("#app [data-sales-tabs]"), "12. Sales: To review · Post to Tally · In Tally at the top")

    # 17. an owner clears a wrong GSTIN, with a reason
    E("() => { S.account = Object.assign(S.account || {}, {me: {role: 'owner'}}); S.tab = 'settings'; render(); }"); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-clear-ids] button").count() >= 1, "17. Client setup offers 'Clear a wrong GSTIN…' to an owner")
    pg.click('#app [data-clear-ids] button:has-text("GSTIN")'); pg.wait_for_timeout(300)
    pg.click('.cbx button[data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator(".cbx").count() == 1 and E("CO().gstin") != "", "17. not without a reason")
    pg.fill(".cbx #cbxWhy", "GSTIN is Garg Shekhar's, not this client's"); pg.click('.cbx button[data-cbx="yes"]'); pg.wait_for_timeout(500)
    ok(E("CO().gstin") == "" and E("CO().idsCleared[0].reason") == "GSTIN is Garg Shekhar's, not this client's", "17. cleared, with the reason kept")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
