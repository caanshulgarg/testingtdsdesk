"""python3 run_reports_ui.py - Reports, Look up, Letters, closed periods and getting started, in a browser, on made-up books."""
import json, os, sys, subprocess, tempfile, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8141), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
tmp = os.path.join(tempfile.gettempdir(), "fincom-demo-books.json")
subprocess.run([sys.executable, os.path.join(HERE, "..", "build", "landing", "demo", "make_demo_books.py"), tmp], check=True, capture_output=True)
books = json.load(open(tmp))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """(bk) => {
  S.storeKind = "db";
  const c = newCompany({name: "Aarohi Textiles Pvt Ltd", gstin: "09AAHCA7732L1Z4"}); c.id = "c_demo"; c.tallyName = "Aarohi Textiles Pvt Ltd"; S.companies[c.id] = c;
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id});
  S.books.map = Books.mapLedgers(bk.vouchers, {});
  // opening balances as Tally would give them: nothing before the year, so every ledger opens at zero
  const led = {}; Object.keys(bk.under).forEach(n => { led[n] = {open: 0, close: 0, parent: bk.under[n]}; });
  S.books.tb = {from: "20250401", to: "20260331", at: new Date().toISOString(), led};
  window.__bk = S.books; render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("window.open = (u) => { window.__opened = (window.__opened || []).concat([String(u)]); return {document: {write(){}, close(){}}, focus(){}, print(){}}; };")
    pg.goto("http://localhost:8141/"); pg.wait_for_timeout(2000)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(SETUP, books); pg.wait_for_timeout(700)
    pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(400)
    t = pg.inner_text("#app")
    # ---------- getting started, and the question box
    ok("Getting Aarohi Textiles Pvt Ltd ready" in t, "the dashboard shows the getting-started list")
    ok("Read the books from Tally" in t and "done" in t, "steps done and to do are counted")
    ok(pg.locator("#dashAsk").count() == 1, "the dashboard has the question box")
    ok(pg.locator('#side .side-link:has-text("Reports")').count() == 1 and pg.locator('#side .side-link:has-text("Look up")').count() == 1 and pg.locator('#side .side-link:has-text("Letters")').count() == 1, "the side menu has Reports, Look up and Letters")
    # ---------- Reports
    pg.click('#side .side-link:has-text("Reports")'); pg.wait_for_timeout(800)
    t = pg.inner_text("#app")
    ok("How the business is doing" in t and "Customers and suppliers" in t and "Bank and cash" in t and "GST" in t and "Audit and accounts" in t, "Reports shows every area")
    ok(pg.locator(".rpt-area .fc-chart svg rect").count() > 20, "the areas carry charts")
    ok(pg.locator(".rpt-link").count() >= 30, "every report is listed")
    ok("2025-26" in t, "the year is chosen from the books")
    ok(pg.inner_text("#top") .find("Reports") >= 0 if pg.locator("#top").count() else True, "the page title says Reports")
    pg.fill("#rptQ", "ageing"); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("Receivables ageing" in t and "Payables ageing" in t and "How the business is doing" not in t, "finding a report by name")
    pg.fill("#rptQ", ""); pg.wait_for_timeout(400)
    pg.click('.rpt-link:has(b:text-is("Receivables ageing"))'); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.booksTab") == "mis" and pg.evaluate("S.misTab") == "recv" and pg.evaluate("!!(S.books.mis && S.books.mis.last)"), "a report opens its screen with the MIS worked out")
    # ---------- Look up: a ledger
    pg.click('#side .side-link:has-text("Look up")'); pg.wait_for_timeout(600)
    ok(pg.evaluate("document.activeElement && document.activeElement.id") == "lkAsk", "the question box has the focus")
    pg.fill("#lkAsk", "HDFC bank for August 2025"); pg.keyboard.press("Enter"); pg.wait_for_timeout(900)
    r = pg.evaluate("({kind: S.lk.kind, led: S.lk.led, from: S.lk.from, to: S.lk.to, rows: S.lk.res && S.lk.res.rows.length, open: S.lk.res && S.lk.res.open, close: S.lk.res && S.lk.res.close})")
    ok(r["kind"] == "ledger" and r["led"] == "HDFC Bank Current Account" and r["from"] == "20250801" and r["to"] == "20250831", "plain words understood: " + json.dumps(r))
    ok(r["rows"] and r["rows"] > 5 and r["open"] is not None, "the bank account for August, with its opening balance")
    # the running balance adds up
    chk = pg.evaluate("""() => { const r = S.lk.res; let run = r.open; for (const v of r.rows) run = Math.round((run + v.dr - v.cr) * 100) / 100; return [run, r.close]; }""")
    ok(abs(chk[0] - chk[1]) < 0.01, "opening plus debits less credits is the closing balance")
    # the closing for August is the opening for September
    pg.evaluate("S.lk.from = '20250901'; S.lk.to = '20250930';"); pg.click('button:text-is("Show")'); pg.wait_for_timeout(700)
    ok(abs(pg.evaluate("S.lk.res.open") - chk[1]) < 0.01, "August's closing is September's opening")
    t = pg.inner_text("#app")
    ok("Opening balance" in t and "Total" in t, "the ledger shows opening, entries and totals")
    pg.locator("tr.lk-v").first.click(); pg.wait_for_timeout(400)
    ok(pg.locator("tr.lk-sub .lk-in tr").count() >= 2, "an entry opens to show both sides")
    other = pg.locator("tr.lk-sub button.linkbtn").nth(1).inner_text()
    pg.locator("tr.lk-sub button.linkbtn").nth(1).click(); pg.wait_for_timeout(700)
    ok(pg.evaluate("S.lk.led") == other and pg.evaluate("S.lk.res.kind") == "ledger", "clicking a ledger in an entry opens that ledger (" + other + ")")
    # a trial balance on a date, which must agree
    pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter"); pg.wait_for_timeout(1000)
    tb = pg.evaluate("({kind: S.lk.res.kind, dr: S.lk.res.dr, cr: S.lk.res.cr, n: S.lk.res.rows.length})")
    ok(tb["kind"] == "tb" and tb["n"] > 20 and abs(tb["dr"] - tb["cr"]) < 1, "trial balance on 31 March 2026 agrees: " + json.dumps(tb))
    # a party's open bills
    pg.fill("#lkAsk", "Raj Fabrics open bills"); pg.keyboard.press("Enter"); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.lk.kind") == "bills" and pg.evaluate("S.lk.led") == "Raj Fabrics", "open bills of a named party")
    # a group, month by month
    pg.fill("#lkAsk", "sundry debtors month by month this year"); pg.keyboard.press("Enter"); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.lk.kind") == "monthly" and pg.evaluate("S.lk.grp") == "Sundry Debtors" and pg.locator(".lk-res .fc-chart rect").count() >= 12, "a group month by month, with a chart")
    # find by amount
    amt = pg.evaluate("Math.abs(S.books.vouchers.find(v => v.type === 'Sales').ent[0].a)")
    pg.click('.lk-kinds button:text-is("Find entries")'); pg.wait_for_timeout(300)
    pg.fill('input[aria-label="Words, a number or an amount"]', str(int(amt)) if amt == int(amt) else str(amt)); pg.evaluate("S.lk.from = '20250401'; S.lk.to = '20260331';"); pg.click('button:text-is("Show")'); pg.wait_for_timeout(600)
    ok(pg.evaluate("S.lk.res.rows.length") >= 1, "finding an entry by its amount")
    pg.click('.lk-res button:text-is("Excel")'); pg.wait_for_timeout(1500)
    ok(not errors, "no page errors so far")
    ok(len(pg.evaluate("LK.recent()")) >= 4, "look-ups are remembered")
    # the / key opens Look up from anywhere in the client
    pg.evaluate("S.tab = 'dash'; render();"); pg.wait_for_timeout(300); pg.locator("body").click(position={"x": 700, "y": 900}); pg.keyboard.press("/"); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.booksTab") == "lookup" and pg.evaluate("S.tab") == "books", "the / key opens Look up")
    # ---------- Letters: confirmations
    pg.click('#side .side-link:has-text("Letters")'); pg.wait_for_timeout(800)
    t = pg.inner_text("#app")
    ok("Balance confirmations" in t and "Dues reminders" in t, "the Letters page")
    ok(pg.evaluate("S.ltr.asOn") == "20260331", "confirmations default to the year end")
    n = pg.locator(".ltr-t tbody tr").count()
    ok(n > 5, "parties with a balance on 31 March 2026: " + str(n))
    pg.locator('.ltr-t input[type=email]').first.fill("accounts@party.example"); pg.wait_for_timeout(1000)
    first = pg.locator(".ltr-t tbody tr").first.locator("button.linkbtn").inner_text()
    ok(pg.evaluate("S.books.letters.contacts[%s].email" % json.dumps(first)) == "accounts@party.example", "an email typed is kept for the party")
    pg.locator(".ltr-t tbody tr").first.locator('button:text-is("Email")').click(); pg.wait_for_timeout(400)
    opened = pg.evaluate("window.__opened || []")
    ok(any(u.startswith("mailto:accounts%40party.example") and "Confirmation%20of%20balance" in u for u in opened), "Email opens the user's own mail with the letter written")
    ok(pg.evaluate("!!S.books.letters.conf['20260331'][%s].sentAt" % json.dumps(first)), "the letter is marked as sent")
    pg.click('.ltr-bar button:nth-child(2)'); pg.wait_for_timeout(300)
    html = pg.evaluate("LTR.confirmRows().rows.slice(0, 2).map(r => LTR.confirmHtml(r)).join('')")
    ok("Confirmation of balance as on 31 Mar 2026" in html or "Confirmation of balance as on" in html, "the letter has its subject")
    ok("please sign and return" in html and "Statement of your account" in html, "the letter carries the reply slip and the statement of account")
    pg.click('.ltr-bar button.primary'); pg.wait_for_timeout(500)
    ok(pg.evaluate("Object.values(S.books.letters.conf['20260331']).filter(s => s.via === 'printed').length") >= n - 1, "printing marks each letter")
    pg.locator('select[aria-label^="Reply from "]').first.select_option("differs"); pg.wait_for_timeout(400)
    pg.locator('input[aria-label="Their balance"]').first.fill("1000"); pg.wait_for_timeout(1400)
    ok("difference" in pg.inner_text(".ltr-t"), "a reply with a different figure shows the difference")
    # ---------- reminders
    pg.click('.lk-kinds button:text-is("Dues reminders")'); pg.wait_for_timeout(700)
    rows = pg.locator(".ltr-t tbody tr").count()
    ok(rows >= 1, "customers with overdue bills: " + str(rows))
    pg.check('label.chk:has-text("MSMED") input'); pg.wait_for_timeout(400)
    txt = pg.evaluate("LTR.remindText(LTR.remindRows()[0]).body")
    ok("MSMED Act" in txt and "Total overdue" in txt, "the reminder lists the bills, and the MSMED Act line when asked")
    pg.select_option('select[aria-label="Tone"]', "final"); pg.wait_for_timeout(300)
    ok("Final reminder" in pg.evaluate("LTR.remindText(LTR.remindRows()[0]).subject"), "the tone changes the words")
    # ---------- closed periods
    pg.evaluate("S.tab = 'coclosed'; render();"); pg.wait_for_timeout(500)
    ok("Closed periods" in pg.inner_text("#app"), "Client setup has closed periods")
    pg.fill("[data-cpto]", "2025-06-30"); pg.dispatch_event("[data-cpto]", "change"); pg.wait_for_timeout(300)
    pg.evaluate("S.books.gstFiled = {'09': {'202508': {r1: '2025-09-11', r3b: '2025-09-20'}}}; ClosedP.set(CO(), 'tdsFiled', {'2025-26|Q2': '2025-10-30'});")
    w = pg.evaluate("[ClosedP.note('2025-06-15'), ClosedP.note('2025-08-10'), ClosedP.note('2025-09-10', true), ClosedP.note('2025-09-10', false), ClosedP.note('2025-11-01')]")
    ok(w[0] and "closed up to" in w[0][0], "a date in closed books: " + str(w[0]))
    ok(w[1] and "GSTR-3B for" in w[1][0], "a month with 3B filed: " + str(w[1]))
    ok(w[2] and "TDS return for Q2 2025-26" in w[2][0] and not w[3], "a TDS entry in a quarter filed, and not one without TDS")
    ok(not w[4], "an open month is not flagged")
    # posting: the warning, and holding back
    res = pg.evaluate("""async () => {
      Bridge.st.version = '1.12.9'; Bridge.st.open = [{name: 'Aarohi Textiles Pvt Ltd', from: '20250401'}];
      let sent = null; Bridge.postChecked = async (pl) => { sent = pl; return {ok: true, results: pl.vouchers.map(v => ({id: v.id, ok: true}))}; };
      const v = d => ({id: 'v' + d, xml: '<VOUCHER VCHTYPE="Purchase"><DATE>' + d + '</DATE><VOUCHERNUMBER>' + d + '</VOUCHERNUMBER></VOUCHER>'});
      const p = Bridge.post({company: 'Aarohi Textiles Pvt Ltd', masters: [], vouchers: [v('20250610'), v('20251105')]});
      await new Promise(r => setTimeout(r, 400));
      const box = document.getElementById('confirmBox'), shown = box && box.style.display === 'flex' ? box.innerText : '';
      box.querySelector('[data-cbx="no"]').click();
      const out = await p;
      return {shown, sent: sent ? sent.vouchers.map(x => x.id) : [], results: out.results.map(r => [r.id, r.ok, r.held || false])};
    }""")
    ok("Post into a closed period?" in res["shown"] and "closed up to" in res["shown"], "posting into a closed period asks first")
    ok(res["sent"] == ["v20251105"] and ["v20250610", False, True] in res["results"], "holding back sends only the open-period entry: " + json.dumps(res))
    res2 = pg.evaluate("""async () => {
      let sent = null; Bridge.postChecked = async (pl) => { sent = pl; return {ok: true, results: pl.vouchers.map(v => ({id: v.id, ok: true}))}; };
      const p = Bridge.post({company: 'Aarohi Textiles Pvt Ltd', masters: [], vouchers: [{id: 'a', xml: '<VOUCHER VCHTYPE="Purchase"><DATE>20250610</DATE></VOUCHER>'}]});
      await new Promise(r => setTimeout(r, 400)); document.querySelector('#confirmBox [data-cbx="yes"]').click(); await p;
      return sent ? sent.vouchers.length : 0; }""")
    ok(res2 == 1, "choosing to post sends it")
    # ---------- keyboard shortcuts
    pg.evaluate("S.tab = 'dash'; render();"); pg.wait_for_timeout(300); pg.locator("body").click(position={"x": 700, "y": 900}); pg.keyboard.press("?"); pg.wait_for_timeout(300)
    ok("Keyboard shortcuts" in pg.inner_text("#confirmBox"), "? shows the shortcuts")
    pg.keyboard.press("Escape")
    # ---------- phone width: nothing runs off the side
    pg.set_viewport_size({"width": 390, "height": 900}); pg.evaluate("S.tab = 'books'; S.booksTab = 'reports'; render();"); pg.wait_for_timeout(600)
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 392, "Reports fits a phone")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
