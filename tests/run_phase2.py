"""python3 run_phase2.py - review of 30 Sep 2026, phase 2 (security and screens), checked the way a user would see them.
Offline, a made-up client; the firm account and its functions are stood in for. No client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_phase2.py"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(H, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8172), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
BASE = "http://localhost:8172/"
SETUP = """() => { const c = newCompany({name: "ZZ Phase Two", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  const mk = (n, no, d, amt) => { const e = newEntry(n + ".pdf"); Object.assign(e.x, {vendorName: n, invoiceNo: no, invoiceDate: d, taxable: amt, total: amt}); e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; return e.id; };
  const a = mk("Alpha Consultants", "A/1", "2026-09-19", 100000), b = mk("Beta Traders", "B/7", "2026-09-20", 20000);
  Store.saveCompany(c); Object.values(S.data[c.id].entries).forEach(e => Store.saveEntry(c.id, e));
  return [c.id, a, b]; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    app = lambda: pg.inner_text("#app"); top = lambda: pg.inner_text("#cobar")
    cid, a, b = pg.evaluate(SETUP)
    # 31. one date format
    ok(pg.evaluate("[fmtDate('2026-09-19'), fmtDateTime(new Date(2026, 8, 30, 21, 32))]") == ["19-Sep-2026", "30-Sep-2026 21:32"], "31. dates read 19-Sep-2026, and 30-Sep-2026 21:32 with the time")
    # 25. page links: a bill has its own address, which survives a refresh
    pg.evaluate("(a) => openCompany(a[0]).then(() => { goStep('review', 'bills'); S.reviewTable = false; S.selected = a[1]; render(); })", [cid, a]); pg.wait_for_timeout(900)
    link = pg.evaluate("location.hash")
    ok(link == "#/c/%s/bill/%s" % (cid, a), "25. an open bill has its own address (" + link + ")")
    ok(pg.locator('#app label:has-text("Supplier name")').count() == 1, "35. the bill's field is called Supplier name")
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("[S.coId, S.tab, S.selected]") == [cid, "invoices", a] and "Alpha Consultants" in pg.inner_text("#app .detail h2"), "25. Refresh opens the same bill")
    pg.evaluate("() => goClient('txn')"); pg.wait_for_timeout(600)
    ok(pg.evaluate("location.hash").endswith("/txn/bills"), "25. Transactions has its own address")
    pg.go_back(); pg.wait_for_timeout(900)
    ok(pg.evaluate("S.selected") == a, "25. Back returns to the bill")
    # 33. keys: J/K move between bills, Ctrl+Enter approves
    pg.click("#app .detail h2"); pg.keyboard.press("j"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.selected") == b, "33. J: the next bill")
    pg.keyboard.press("k"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.selected") == a, "33. K: the previous bill")
    pg.keyboard.press("Control+a"); pg.wait_for_timeout(300)
    ok(pg.evaluate("(a) => D().entries[a].status", a) == "draft", "33. Ctrl+A no longer approves (it is the browser's Select all)")
    miss = pg.evaluate("(a) => compute(D().entries[a]).missing", a)
    pg.keyboard.press("Control+Enter"); pg.wait_for_timeout(600)
    st = pg.evaluate("(a) => D().entries[a].status", a)
    ok(st == "approved" or (miss and st == "draft"), "33. Ctrl+Enter approves the bill on screen (" + st + (", still needs " + ", ".join(miss) if miss else "") + ")")
    ok("Ctrl+Enter" in pg.evaluate("KEYS.map(k => k[0]).join(' ')") and "J or K" in pg.evaluate("KEYS.map(k => k[0]).join(' ')"), "33. the ? list shows Ctrl+Enter and J/K")
    # 24. soft delete with a reason, restore
    pg.evaluate("(b) => { S.filter = 'draft'; S.selected = b; render(); }", b); pg.wait_for_timeout(500)
    pg.click('#app .detail button:has-text("Delete")'); pg.wait_for_timeout(300)
    pg.click('#confirmBox button[data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx-err").count() == 1 and pg.evaluate("(b) => D().entries[b].status", b) == "draft", "24. Delete asks why, and waits for a reason")
    pg.fill("#delWhy", "not this client's bill"); pg.click('#confirmBox button[data-cbx="yes"]'); pg.wait_for_timeout(500)
    e = pg.evaluate("(b) => D().entries[b]", b)
    ok(e["status"] == "deleted" and e["deleted"]["reason"] == "not this client's bill" and e["deleted"]["by"], "24. the bill is kept as deleted, with who and why")
    ok("Deleted (1)" in app(), "24. a Deleted filter lists it")
    pg.click('#app button:has-text("Deleted (1)")'); pg.wait_for_timeout(300); pg.click("#app .queue li button"); pg.wait_for_timeout(400)
    ok("not this client's bill" in app() and pg.locator('#app button:text-is("Restore")').count() == 1, "24. opened under Deleted: the reason and a Restore button")
    pg.click('#app button:text-is("Restore")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("(b) => D().entries[b].status", b) == "draft" and pg.evaluate("(b) => !!D().entries[b].restored", b), "24. Restore puts it back to To review")
    pg.evaluate("() => { Cloud.on = () => true; S.account = {me: {role: 'staff'}}; render(); }"); pg.wait_for_timeout(300)
    ok(not pg.evaluate("canDeleteBills()") and pg.locator('#app .detail button:has-text("Delete")').count() == 0, "24. only the owner may delete: no Delete for staff")
    pg.evaluate("() => { S.account = {me: {role: 'owner'}}; S.firm.firmName = ''; S.firmSetupLater = false; render(); }"); pg.wait_for_timeout(500)
    # 32. firm details at an owner's first sign-in; ₹ on amounts
    ok(pg.locator(".firmsetup-scrim").count() == 1 and "Your firm’s details" in pg.inner_text(".firmsetup-scrim"), "32. an owner with no firm name is asked for the firm's details")
    pg.fill('.firmsetup-scrim input[aria-label="Firm name"]', "Garg Shekhar & Company"); pg.fill('.firmsetup-scrim textarea', "Kanpur"); pg.click('.firmsetup-scrim button:text-is("Save")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("[S.firm.firmName, S.firm.firmAddress]") == ["Garg Shekhar & Company", "Kanpur"] and pg.locator(".firmsetup-scrim").count() == 0 and "Garg Shekhar" in top(), "32. saved: the name in the header, the address kept")
    pg.evaluate("() => { S.account = {me: {role: 'owner'}, firm: {balance: 499999912, plan: {name: 'Pro'}}}; render(); }"); pg.wait_for_timeout(400)
    ok("₹49,99,99,912.00" in pg.inner_text("header.top .firmbtn"), "32. the credit shows with ₹ (" + pg.inner_text("header.top .firmbtn").replace("\n", " ") + ")")
    # 27 and 26. the page's main button; the header at 1024 px
    pg.evaluate("() => goClient('books:letters')"); pg.wait_for_timeout(700)
    ok("New confirmation" in top() and "Upload bills" not in top() and "+ Upload" in top(), "27. Letters: New confirmation, and + Upload in the top bar")
    pg.evaluate("() => goClient('books:reports')"); pg.wait_for_timeout(700)
    ok("Refresh books" in top() and "Upload bills" not in top(), "27. Reports: Refresh books")
    pg.evaluate("() => goClient('bank')"); pg.wait_for_timeout(900)
    ok("Upload statement" in top(), "27. Bank: Upload statement")
    pg.set_viewport_size({"width": 1024, "height": 800})
    pg.evaluate("() => { goClient('books'); S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(700)
    overlap = pg.evaluate("""() => { const h = document.querySelector('header.top .tbar-title h2'), btns = [...document.querySelectorAll('header.top button')];
      const r = h.getBoundingClientRect(); return btns.filter(b => { const q = b.getBoundingClientRect(); return q.width && !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom); }).map(b => b.textContent); }""")
    ok(not overlap and pg.evaluate("document.querySelector('header.top .tbar-title h2').scrollWidth <= document.querySelector('header.top .tbar-title h2').clientWidth + 1"),
       "26. at 1024 px the title is whole and no button covers it (" + str(overlap) + ")")
    # 29. the sidebar stays in the window
    pg.evaluate("() => goClient('txn')"); pg.wait_for_timeout(600); pg.mouse.wheel(0, 2000); pg.wait_for_timeout(300)
    ok(pg.evaluate("document.querySelector('#side .side-co').getBoundingClientRect().top") >= 0, "29. scrolled down, the sidebar and the client name stay in view")
    pg.set_viewport_size({"width": 1400, "height": 900})
    # 30. Transactions: Excel, columns, the first columns kept
    ok(pg.locator('#app button:text-is("Excel")').count() == 1 and pg.locator("#app .txntbl th.stick1").count() == 1, "30. Transactions: Excel export and the first columns kept in view")
    pg.click('#app .colpick summary'); pg.click('#app .colpick label:has-text("Voucher") input'); pg.wait_for_timeout(300)
    ok(pg.locator('#app .txntbl th:has-text("Voucher")').count() == 0, "30. a column switched off from Columns")
    with pg.expect_download() as dl: pg.click('#app button:text-is("Excel")')
    ok(dl.value.suggested_filename.endswith(".xlsx"), "30. Excel gives an .xlsx file (" + dl.value.suggested_filename + ")")
    # 29. the firm's menu on the firm's pages
    pg.evaluate("() => navHome('clients')"); pg.wait_for_timeout(500)
    side = pg.inner_text("#side")
    ok(all(w in side for w in ["Clients", "People", "Plan and credit", "Tally", "Settings"]) and "Purchase" not in side, "29. on the firm's pages the sidebar is the firm's menu")
    # 21. sign-in: the lockout message, a link to set one's own password
    pg.evaluate("""() => { window.__f = window.fetch; window.fetch = async (u, o) => /functions\\/v1\\/signin/.test(String(u))
      ? new Response(JSON.stringify({ok: false, error: "Too many wrong passwords. Try again after 18:05, or ask the firm's owner to unlock you."}), {status: 423}) : window.__f(u, o); }""")
    err = pg.evaluate("Cloud.signInCall('a@b.in', 'wrong').then(() => '', e => e.message)")
    ok("Too many wrong passwords" in err, "21. five wrong passwords: the sign-in says the account is locked and until when")
    pg.goto("about:blank"); pg.goto(BASE + "#access_token=tok&refresh_token=ref&expires_in=3600&type=invite"); pg.wait_for_timeout(2500)
    ok("Welcome to FinCom" in app() and pg.locator("#spw1").count() == 1 and pg.evaluate("location.hash") == "", "21. an invite link opens “choose your password” and is taken off the address")
    pg.fill("#spw1", "short"); pg.fill("#spw2", "short"); pg.click('button:has-text("Save and continue")'); pg.wait_for_timeout(300)
    ok("10 characters or more" in app(), "21. a short password is refused")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
