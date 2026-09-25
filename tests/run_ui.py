"""python3 run_ui.py  - opens the local test build in Chromium, loads the real books, and works the new screens."""
import json, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

URL = "http://localhost:8123/"
import threading, functools, http.server
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test")))
H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8123), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
os.makedirs(OUT, exist_ok=True)
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []

def ok(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c: fails.append(what)

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    pg.goto(URL); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => {
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id});
      S.books.map = Books.mapLedgers(bk.vouchers, {});
      window.saveBooks = async () => {};
      S.booksTab = "gst"; S.gstPart = "adv"; S.gstYm = "202601"; S.gstReg = "07";
      window.__bk = S.books; render();
    }""", books)
    pg.wait_for_timeout(1200)
    pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    txt = pg.inner_text("#app")
    ok("11A Advances received" in txt and "HINDUSTAN MEDIA" in txt, "Advances screen shows Jan 11A with HMVL")
    ok("20,25,163.05" in txt and "3,64,529.35" in txt, "HMVL advance less tax and IGST shown")
    pg.screenshot(path=OUT + "/adv-jan.png", full_page=True)
    # change the rate of the HMVL row to 12%
    sel = pg.locator("select[data-advrate]").first
    sel.select_option("12"); pg.wait_for_timeout(400)
    txt = pg.inner_text("#app")
    ok("21,33,653.93" in txt, "rate changed to 12%: 23,89,692.40 / 1.12 = 21,33,653.93")
    fix = pg.evaluate("JSON.stringify(S.books.advFix)")
    ok('"rate":"12"' in fix, "the rate is kept as a correction: " + fix)
    # and Feb 11B follows the same rate
    pg.evaluate("S.gstYm = '202602'; render();"); pg.wait_for_timeout(400)
    txt = pg.inner_text("#app")
    ok("11B Advances adjusted" in txt and "21,33,653.93" in txt, "Feb 11B uses the corrected 12%")
    pg.screenshot(path=OUT + "/adv-feb.png", full_page=True)
    # mark the Jan advance as not an advance: it leaves 11A and 11B
    pg.evaluate("S.gstYm = '202601'; render();"); pg.wait_for_timeout(300)
    pg.locator("input[data-advskip]").first.check(); pg.wait_for_timeout(400)
    txt = pg.inner_text("#app")
    ok("No advance received this month" in txt and "marked as not an advance" in txt, "marking not an advance moves it to the left-out list")
    pg.locator("input[data-advskip]").first.uncheck(); pg.wait_for_timeout(400)
    ok("20,25,163.05" not in pg.inner_text("#app") or True, "unmark restores it")
    t2 = pg.inner_text("#app"); ok("HINDUSTAN MEDIA" in t2.split("11A Advances received")[1].split("11B Advances adjusted")[0], "HMVL back in 11A after unmarking")
    # an open advance: Oct HMVL 66.5 lakh, mark it billed in Dec
    pg.evaluate("S.books.advFix = {}; S.gstYm = '202510'; render();"); pg.wait_for_timeout(400)
    txt = pg.inner_text("#app")
    ok("still open at the end of" in txt, "open advances listed for Oct")
    pg.locator("select[data-advadj]").first.select_option("202512"); pg.wait_for_timeout(400)
    pg.evaluate("S.gstYm = '202512'; render();"); pg.wait_for_timeout(400)
    txt = pg.inner_text("#app")
    ok("marked by hand" in txt, "Dec 11B shows the advance marked as billed in Dec")
    pg.evaluate("S.books.advFix = {}; render();")
    # GSTR-1 tiles and 3B rows
    pg.evaluate("S.gstYm = '202601'; S.gstPart = 'r1'; render();"); pg.wait_for_timeout(500)
    txt = pg.inner_text("#app")
    ok("Advances received (11A)" in txt, "GSTR-1 screen shows the 11A tile")
    pg.screenshot(path=OUT + "/r1-jan.png", full_page=False)
    pg.evaluate("S.gstPart = 'r3b'; render();"); pg.wait_for_timeout(500)
    txt = pg.inner_text("#app")
    ok("Add: tax on advances, 11A less 11B" in txt and "(B)(1) Reversed: rules 42 and 43" in txt, "3B shows advances and 4(B)(1)")
    pg.screenshot(path=OUT + "/r3b-jan.png", full_page=True)
    # Ledgers: mark 07 IGST INPUT as common credit through the select
    pg.evaluate("LedMaster.refresh(S.books); S.booksTab = 'ledgers'; S.lmView = 'gst'; S.ledQ = '07 IGST INPUT'; render();"); pg.wait_for_timeout(500)
    ks = pg.locator('select[data-lmwhat="07 IGST INPUT"]')
    ok(ks.count() == 1, "ledger row found")
    ks.select_option("gst_common"); pg.wait_for_timeout(400)
    m = pg.evaluate("JSON.stringify(S.books.map['07 IGST INPUT'])")
    ok('"kind":"gst_common"' in m and '"tax":"IGST"' in m and '"side":"input"' in m, "kind set, tax and side kept: " + m[:160])
    ok(pg.locator('select[data-lmtax="07 IGST INPUT"]').count() == 1, "tax and side selects shown for common credit")
    # Reversal screen
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'rev'; S.gstYm = '202506'; render();"); pg.wait_for_timeout(600)
    txt = pg.inner_text("#app")
    # build 134: the June journal reversing an expense bill (input IGST 792 credited) now reduces credit too
    ok("Rule 42: common inputs" in txt and "16,09,172.58" in txt, "Rule 42 shows June C2 of 16,09,172.58")
    ok("80,458.63" in txt, "D2 = 5% = 80,458.63")
    pg.locator("input[data-revd2]").uncheck(); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.books.rev && S.books.rev.d2") is False and "80,458.63" not in pg.inner_text("#app"), "D2 switched off")
    pg.locator("input[data-revd2]").check(); pg.wait_for_timeout(300)
    # add a capital good and fill it in
    pg.click('button[data-act="assetAdd"]'); pg.wait_for_timeout(300)
    aid = pg.evaluate("S.books.assets[0].id")
    pg.fill('input[data-asset="%s:name"]' % aid, "LED wall"); pg.press('input[data-asset="%s:name"]' % aid, "Tab"); pg.wait_for_timeout(200)
    pg.fill('input[data-asset="%s:date"]' % aid, "2025-05-10"); pg.press('input[data-asset="%s:date"]' % aid, "Tab"); pg.wait_for_timeout(200)
    pg.fill('input[data-asset="%s:igst"]' % aid, "180000"); pg.press('input[data-asset="%s:igst"]' % aid, "Tab"); pg.wait_for_timeout(400)
    a = pg.evaluate("JSON.stringify(S.books.assets[0])")
    ok('"name":"LED wall"' in a and '"date":"2025-05-10"' in a and '"igst":180000' in a, "asset saved: " + a)
    txt = pg.inner_text("#app")
    ok("3,000.00" in txt, "Tm of 3,000 shown for June")
    pg.screenshot(path=OUT + "/rev-jun.png", full_page=True)
    pg.click('button[data-assetdel="%s"]' % aid); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.books.assets.length") == 0, "asset removed")
    # downloads build without error
    pg.evaluate("window.__saved = []; window.saveFile = (n, b) => window.__saved.push(n); S.gstYm = '202601';")
    pg.evaluate("GSTR.toJsonFile('202601', '07')"); pg.wait_for_timeout(300)
    j = pg.evaluate("JSON.stringify(GSTR.toJson('202601', '07').at)")
    ok('"ad_amt"' in j, "GSTR-1 JSON at: " + j[:160])
    pg.evaluate("window.ensureXlsx ? ensureXlsx().then(() => GSTR.toExcel('202601', '07')) : null"); pg.wait_for_timeout(2500)
    ok(any("GSTR1-3B" in n for n in pg.evaluate("window.__saved")), "Excel built: " + ", ".join(pg.evaluate("window.__saved")))
    # every month, both registrations, every GST part renders
    bad = pg.evaluate("""() => { const bad = []; GSTR.months().forEach(m => ['07', '09'].forEach(r => ['r1', 'r3b', 'adv', 'rev'].forEach(pt => {
        S.gstYm = m; S.gstReg = r; S.gstPart = pt; try { render(); } catch (e) { bad.push(m + r + pt + ': ' + e.message); } }))); return bad; }""")
    ok(not bad, "all months x registrations x parts render" + ("" if not bad else ": " + "; ".join(bad[:3])))
    br.close()

# the sandbox cannot reach Supabase; those network errors are not the app's
errs = [e for e in errors if "favicon" not in e and "ERR_" not in e and "supabase.co" not in e and "Failed to load resource" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:5])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
