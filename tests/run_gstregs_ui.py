"""python3 run_gstregs_ui.py - GSTINs added in GST settings (PAN-checked); each GSTIN's settings on their own, with the
question "this GSTIN only, all, or those ticked"; the GST tab working with no Tally day book at all."""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8149), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8149/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""() => { const c = newCompany({name: "Garg Shekhar & Company", gstin: "09AANFG3202D1ZR", pan: "AANFG3202D"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.loadingCo = false;
      S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: null, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}}; window.__bk = S.books;
      window.__t = []; window.toast = m => { window.__t.push(m); }; S.tab = "gstset"; render(); }""")
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("GST registrations" in t and "09AANFG3202D1ZR" in t and "Uttar Pradesh" in t and "Client setup" in t, "no day book: GST settings open, the client's own GSTIN listed from Client setup")
    ok("Settings of 09AANFG3202D1ZR" in t and pg.locator('select[data-gset="einv"][data-greg="09"]').count() == 1, "its settings are shown")
    last = lambda: (pg.evaluate("window.__t") or [""])[-1]
    def add(g):
        pg.fill("input[data-gregnew]", g); pg.click("button[data-gregadd]"); pg.wait_for_timeout(700)
    add("07AADCV3366N1ZU"); ok("PAN AADCV3366N" in last() and "AANFG3202D" in last() and "07AADCV3366N1ZU" not in pg.evaluate("GSTR.gstins(S.books)"), "another business's GSTIN is refused: " + last())
    add("07AANFG3202D1ZA"); ok("check character" in last(), "a mistyped GSTIN is refused: " + last())
    add("09AANFG3202D2Z" + pg.evaluate("gstinCheckChar('09AANFG3202D2Z0')")); ok("already has a GSTIN in Uttar Pradesh" in last(), "a second GSTIN in the same state: " + last())
    g07 = "07AANFG3202D1Z" + pg.evaluate("gstinCheckChar('07AANFG3202D1Z0')"); g27 = "27AANFG3202D1Z" + pg.evaluate("gstinCheckChar('27AANFG3202D1Z0')")
    add(g07); ok(g07 in pg.evaluate("GSTR.gstins(S.books)") and "added" in last() and "Delhi" in last(), "the client's Delhi GSTIN is added: " + last())
    add(g27.lower()); ok(g27 in pg.evaluate("GSTR.gstins(S.books)"), "typed in small letters, taken as capitals")
    t = pg.inner_text("#app")
    ok("Settings of " + g27 in t and pg.locator("select[data-gsetreg]").count() == 1 and pg.locator("section.dash-card h3:has-text('Settings of')").count() == 1, "one GSTIN's settings at a time, the one just added, with a chooser")
    pg.select_option("select[data-gsetreg]", "09"); pg.wait_for_timeout(700)
    ok("Settings of 09AANFG3202D1ZR" in pg.inner_text("#app"), "the chooser shows another GSTIN's settings")
    # a change: asked, only this GSTIN by default
    pg.select_option('select[data-gset="einv"][data-greg="09"]', "no"); pg.wait_for_timeout(600)
    box = pg.inner_text("#confirmBox")
    ok("Apply to which GSTINs?" in box and pg.is_checked('input[name="gapto"][value="one"]') and g07 in box and g27 in box, "asked: only this GSTIN (chosen), all, or those ticked")
    pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(700)
    ok(pg.evaluate("[GSTSet.einvMode('09'), GSTSet.einvMode('07'), GSTSet.einvMode('27')]") == ["no", "auto", "auto"], "kept for this GSTIN only")
    # all of them
    pg.check('input[data-gset="r37"][data-greg="09"]'); pg.wait_for_timeout(600); pg.check('input[name="gapto"][value="all"]'); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(700)
    ok(pg.evaluate("['09','07','27'].map(r => !!(S.books.rule37On || {})[r])") == [True, True, True] and "3 GSTINs" in last(), "rule 37 on for all three")
    # those ticked
    pg.select_option('select[data-gset="basis"][data-greg="09"]', "books"); pg.wait_for_timeout(600)
    pg.check('[data-gapto="27"]'); ok(pg.is_checked('input[name="gapto"][value="some"]'), "ticking a GSTIN chooses \"those ticked\"")
    pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(700)
    ok(pg.evaluate("['09','07','27'].map(r => (S.books.itcBasis || {})[r] || '2b')") == ["books", "2b", "books"], "credit basis for this GSTIN and Maharashtra, not Delhi")
    # cancelled: nothing changes, the screen shows it as it was
    pg.select_option('select[data-gset="pmt"][data-greg="09"]', "self"); pg.wait_for_timeout(600); pg.click('[data-cbx="no"]'); pg.wait_for_timeout(700)
    ok(pg.evaluate("GSTSet.peek('09').pmt || 'fixed'") == "fixed" and pg.input_value('select[data-gset="pmt"][data-greg="09"]') == "fixed", "cancelled: not saved, and shown as before")
    # filing type, for the ticked one
    pg.select_option('select[data-gset="type"][data-greg="09"]', "qrmp"); pg.click('button[data-gsetadd="09"]'); pg.wait_for_timeout(600)
    pg.check('[data-gapto="07"]'); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(700)
    ok(pg.evaluate("['09','07','27'].map(r => GSTSet.history(r).length)") == [1, 1, 0], "filing type set for this GSTIN and Delhi")
    pg.evaluate("window.scrollTo(0, 0)"); pg.click('button[data-gsetuser="09"]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("document.activeElement.dataset.gset") == "puser" and pg.evaluate("document.activeElement.dataset.greg") == "09", "\"type it\" beside the GSTIN goes to its username box")
    pg.evaluate("S.account = {email: 'a@b.c', firm: {plan: {name: 'Starter', includes: []}, balance: 0}}; render()"); pg.wait_for_timeout(500)
    ok("[object Object]" not in pg.inner_text("body") and "Starter" in pg.inner_text("body"), "the firm's plan shows by its name")
    pg.evaluate("S.account = null; render()")
    # typing survives the screen being redrawn in the background (as when signed in to the firm account)
    pg.click('input[data-gset="puser"][data-greg="09"]'); pg.keyboard.type("garg"); pg.evaluate("render()"); pg.keyboard.type("x"); pg.evaluate("render()")
    ok(pg.input_value('input[data-gset="puser"][data-greg="09"]') == "gargx" and pg.evaluate("document.activeElement.dataset.gset") == "puser", "the username keeps what is typed and the cursor when the screen is redrawn")
    pg.fill('input[data-gset="puser"][data-greg="09"]', "")
    # the username stays per GSTIN, without a question
    pg.fill('input[data-gset="puser"][data-greg="09"]', "gargup"); pg.press('input[data-gset="puser"][data-greg="09"]', "Tab"); pg.wait_for_timeout(600)
    ok(pg.locator("#confirmBox .cbx").count() == 0 and pg.evaluate("[GSTSet.peek('09').portalUser, GSTSet.peek('07').portalUser || '']") == ["gargup", ""], "portal username: this GSTIN's own, no question")
    pg.screenshot(path=OUT + "/gstregs-settings.png", full_page=True)
    kept = pg.evaluate("async () => { let got = null; const o = Books.save; Books.save = async (cid, x) => { got = x; }; await saveBooks(); Books.save = o; return (got.gstRegs || []).map(r => r.gstin); }")
    ok(kept == [g07, g27], "the GSTINs added are saved with the books: %s" % kept)
    # the GST tab with no day book
    pg.evaluate("S.tab = 'books'; S.booksTab = 'gst'; S.gstReg = '09'; render()"); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("09AANFG3202D1ZR" in t and "Quarterly (QRMP)" in t and "portal user gargup" in t, "GST tab: the GSTIN, its filing type and portal user are shown")
    ok(pg.locator('[data-gstpart]').all_inner_texts() == ["2B", "Returns filed"] and "No Tally day book here yet" in t, "without a day book: 2B and Returns filed, and why the rest needs the day book")
    ok(pg.locator("#twoBIn").count() + pg.locator("text=Fetch 2B from the portal").count() >= 1, "2B can be brought in or fetched")
    ok(pg.locator("select[data-gstym] option").count() > 0 and pg.locator("select[data-gstreg] option").count() == 3, "months of the year and the three GSTINs to choose from")
    pg.click('[data-gstpart="vault"]'); pg.wait_for_timeout(1000)
    ok("Bring in" in pg.inner_text("#app") or "PDF" in pg.inner_text("#app"), "Returns filed opens")
    pg.screenshot(path=OUT + "/gstregs-gsttab.png", full_page=False)
    pg.click("[data-gotogstset]"); pg.wait_for_timeout(1000)
    ok(pg.evaluate("S.tab") == "gstset" and "Settings of 09AANFG3202D1ZR" in pg.inner_text("#app"), "the link goes to that GSTIN's settings")
    # remove one added here
    pg.click('button[data-gregdel="%s"]' % g27); pg.wait_for_timeout(500); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(700)
    ok(g27 not in pg.evaluate("GSTR.gstins(S.books)") and pg.locator('button[data-gregdel="09AANFG3202D1ZR"]').count() == 0, "an added GSTIN can be removed; the one from Client setup cannot")
    # a client with no GSTIN at all
    pg.evaluate("""() => { const c = newCompany({name: "No GST Co", pan: "AANFG3202D"}); S.companies[c.id] = c; S.coId = c.id; S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: null, alloc: {}, challans: []}; window.__bk = S.books; S.tab = 'books'; S.booksTab = 'gst'; render(); }""")
    pg.wait_for_timeout(800); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    ok("Add the client’s GSTIN in" in pg.inner_text("#app"), "no GSTIN: the GST tab says to add one in GST settings")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
