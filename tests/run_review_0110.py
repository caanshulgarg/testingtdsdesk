"""python3 run_review_0110.py - review of 01-Oct-2026 with made-up data: the dashboard's "Link the Tally company" done
for a client linked in the cloud while its Tally computer is off; Transactions shows a fade and an arrow at the right
edge while more columns wait (a Mac hides the scroll bar); MIS ageing on balance (a supplier with a debit balance is an
advance; ages add up; no negative days). Offline. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_review_0110.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8165), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => { const c = newCompany({name: "ZZ Link Co", gstin: "09AANFG3202D1ZR"}); c.tallyName = "ZZ LINK CO"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  for (let i = 0; i < 12; i++){ const e = newEntry("b" + i + ".pdf"); Object.assign(e.x, {vendorName: "A Rather Long Supplier Name Private Limited " + i, invoiceNo: "INV/2026-27/" + (1000 + i), invoiceDate: "2026-09-1" + (i % 10), taxable: 1000 * (i + 1), total: 1180 * (i + 1)}); S.data[c.id].entries[e.id] = e; Store.saveEntry(c.id, e); }
  Store.saveCompany(c); return c.id; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1050, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8165/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(SETUP); pg.evaluate("(c) => openCompany(c)", cid); pg.wait_for_timeout(800)
    # 4. linked in the cloud, the Tally computer off: the step is done
    step = lambda: pg.evaluate("(c) => ONB.steps(S.companies[c]).find(s => s.id === 'link').done", cid)
    ok(step() is False, "4. not linked anywhere: Link the Tally company is still to do")
    pg.evaluate("(c) => { TCloud.st[c] = {books: [{book: 'bk1', from: '2025-04-01', company: 'ZZ LINK CO'}], at: Date.now()}; Bridge.on = () => false; }", cid)
    ok(step() is True, "4. linked in Books in the cloud while the Tally computer is off: the step is ticked")
    pg.evaluate("(c) => { delete TCloud.st[c]; TLight.st.cos = [{client_id: c, company: 'ZZ LINK CO'}]; }", cid)
    ok(step() is True, "4. and from the cloud's list of linked companies too")
    # 5. Transactions at 1,050 px: a fade and an arrow at the right edge while columns wait; the arrow scrolls; at the end it goes
    pg.evaluate("() => goClient('txn')"); pg.wait_for_timeout(800)
    more = lambda: pg.evaluate("(() => { const w = document.querySelector('#app .txnwrap'); return {cue: !!document.querySelector('#app .txnscroll.more .txn-more'), left: w.scrollLeft, room: w.scrollWidth - w.clientWidth}; })()")
    m0 = more()
    ok(m0["room"] > 0 and m0["cue"], "5. more columns than fit: a fade and an arrow show at the right edge (%d px hidden)" % m0["room"])
    fade = pg.evaluate("getComputedStyle(document.querySelector('#app .txnscroll.more'), '::after').backgroundImage")
    ok("gradient" in fade, "5. the fade is drawn")
    pg.click("#app .txn-more"); pg.wait_for_timeout(700)
    ok(more()["left"] > 0, "5. the arrow scrolls to the hidden columns (%d px)" % more()["left"])
    pg.evaluate("() => { const w = document.querySelector('#app .txnwrap'); w.scrollLeft = w.scrollWidth; }"); pg.wait_for_timeout(400)
    ok(not more()["cue"], "5. at the right end, the arrow and fade go")
    pg.set_viewport_size({"width": 1600, "height": 900}); pg.wait_for_timeout(500)
    pg.evaluate("() => { const w = document.querySelector('#app .txnwrap'); w.scrollLeft = 0; }"); pg.wait_for_timeout(300)
    pg.evaluate("() => { ['vch', 'no', 'amts', 'doc', 'status'].forEach(k => { if (txnColShown(k)) txnColToggle(k); }); }"); pg.wait_for_timeout(500)
    m1 = more(); ok(m1["room"] <= 2 and not m1["cue"], "5. with every column in view, no arrow and no fade (%d px hidden)" % m1["room"])
    # 3c/3d with made-up books: a supplier paid in advance, and an old bill partly paid on account
    r = pg.evaluate("""() => {
      const V = (id, date, type, ent) => ({id, date, type, no: id, party: ent[0].l, narr: "", cancel: false, opt: false, ent});
      const vs = [
        V("p1", "20260105", "Purchase", [{l: "ZZ Old Supplier", a: 100000, b: [["B-1", "New Ref", 100000]]}, {l: "Purchases", a: -100000}]),
        V("p2", "20260901", "Purchase", [{l: "ZZ Old Supplier", a: 20000, b: [["B-2", "New Ref", 20000]]}, {l: "Purchases", a: -20000}]),
        V("p3", "20260910", "Payment", [{l: "ZZ Old Supplier", a: -70000, b: [["", "On Account", -70000]]}, {l: "ZZ Bank", a: 70000}]),
        V("p4", "20260912", "Payment", [{l: "ZZ Advance Supplier", a: -50000, b: [["ADV", "Advance", -50000]]}, {l: "ZZ Bank", a: 50000}]),
        V("s1", "20260915", "Sales", [{l: "ZZ Customer", a: -11800, b: [["S-1", "New Ref", -11800]]}, {l: "Sales", a: 10000}, {l: "Output IGST", a: 1800}])];
      S.books = {cid: S.coId, loading: false, vouchers: vs, meta: {from: "20260101", to: "20260930"}, challans: [], alloc: {},
        under: {"ZZ Old Supplier": "Sundry Creditors", "ZZ Advance Supplier": "Sundry Creditors", "ZZ Customer": "Sundry Debtors", "Purchases": "Purchase Accounts", "Sales": "Sales Accounts", "ZZ Bank": "Bank Accounts", "Output IGST": "Duties & Taxes"},
        groups: {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Bank Accounts": "Current Assets", "Duties & Taxes": "Current Liabilities"}};
      S.books.map = Books.mapLedgers(vs, {});
      const A = MIS.ageing("20260930", "p", null), r = MIS.run("20260101", "20260930", "test");
      const by = Object.fromEntries(A.rows.map(p => [p.party, {net: p.net, nb: p.nb, und: p.und, adv: p.advance, b: p.b}]));
      return {by, owe: A.sum.owe, adv: A.sum.advance, nb: A.sum.nb, und: A.sum.und, dpo: r.dpo, oldB: A.sum.b}; }""")
    old = r["by"].get("ZZ Old Supplier", {})
    ok(abs(old.get("net", 0) - 50000) < 0.01 and abs(sum(old.get("nb", [])) + old.get("und", 0) - 50000) < 0.01, "3d. a supplier owed 1,20,000 in bills, 70,000 paid on account: owed 50,000, and its ages add up to 50,000 (%s)" % old.get("nb"))
    ok(old.get("nb", [0] * 5)[0] == 20000 and abs(old.get("nb", [0] * 5)[4] - 30000) < 0.01 and sum(old.get("nb", [0] * 5)[1:4]) == 0,
       "3d. the payment on account settles the oldest bill first: 20,000 under 30 days, and 30,000 of the 5-Jan bill over 180 days")
    adv = r["by"].get("ZZ Advance Supplier", {})
    ok(adv.get("adv") == 50000 and sum(adv.get("nb", [1])) == 0, "3c. a supplier paid 50,000 in advance: an advance to suppliers of 50,000, nothing owed")
    ok(abs(r["owe"] - 50000) < 0.01 and abs(r["adv"] - 50000) < 0.01 and abs(sum(r["nb"]) + r["und"] - r["owe"]) < 0.01, "3c/3d. in all: owed 50,000, advanced 50,000, the ages add up to what is owed")
    ok(r["oldB"][3] + r["oldB"][4] > r["owe"], "3d. (the bills alone put %.0f over 90 days, more than the 50,000 owed: what the review saw)" % (r["oldB"][3] + r["oldB"][4]))
    ok(r["dpo"] is None or r["dpo"] >= 0, "3c. days of purchases never below nought (%s)" % r["dpo"])
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
