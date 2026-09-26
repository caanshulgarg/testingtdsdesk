"""python3 run_gst134_ui.py - build 134: one GSTIN at a time, 3B payment of tax, the input register, GSTR-1 JSON rate by rate."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8136), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8136/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "g9"; S.gstYm = "202603"; S.gstReg = ""; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(3000)
    t = pg.inner_text("#app"); open(OUT + "/b134-g9.txt", "w").write(t)
    ok(pg.evaluate("S.gstReg") == "07" and "Both registrations" not in t, "one GSTIN at a time: the company's own chosen, no 'both'")
    ok("GSTR-9 for 2025-26, 07AADCV3366N1ZU" in t and "PAID THROUGH ITC: IGST" in t.upper(), "GSTR-9 opens without choosing, with table 9 in its columns")
    ok("no 2B brought in for this year" in t and "6B 6B" not in t, "8A/8D say no 2B instead of a false difference; 6B label once")
    pg.screenshot(path=OUT + "/b134-gst9.png", full_page=True)
    pg.click('button[data-gstpart="r3b"]'); pg.wait_for_timeout(2500); t = pg.inner_text("#app")
    ok("6.1 PAYMENT OF TAX" in t.upper() and "Credit carried to next month" in t, "3B shows payment of tax and credit carried")
    ok("-20,59,779" not in t, "no negative tax payable")
    rc = pg.evaluate("GSTR.threeB('202603','07').rcmOut"); ok(rc["igst"] > 0, "3.1(d) has the reverse charge in March: " + str(rc))
    pg.select_option('select[data-gstym]', "202504"); pg.wait_for_timeout(2500)
    ok("typed in GST settings" in pg.inner_text("#app") and pg.locator('input[data-gstopen]').count() == 0, "the first month points to GST settings for the credit ledger balance")
    before = pg.evaluate("GSTR.threeB('202504','09').pay.cash.igst + GSTR.threeB('202504','09').pay.cash.cgst")
    pg.evaluate("S.tab = 'gstset'; S.gsetReg = '09'; render()"); pg.wait_for_timeout(2500)
    ok("GST settings" in pg.inner_text("#app") and "Filing type" in pg.inner_text("#app"), "Client setup \u2192 GST: the settings for each GSTIN")
    pg.fill('input[data-gset="open"][data-ghead="cgst"][data-greg="09"]', "500000"); pg.press('input[data-gset="open"][data-ghead="cgst"][data-greg="09"]', "Tab"); pg.wait_for_timeout(2500)
    after = pg.evaluate("GSTR.threeB('202504','09').pay.cash.igst + GSTR.threeB('202504','09').pay.cash.cgst")
    ok(pg.evaluate("S.books.gstOpen['09'].cgst") == 500000 and after < before, "an opening balance typed in settings reduces cash payable: %s to %s" % (before, after))
    pg.screenshot(path=OUT + "/gst-settings.png", full_page=False)
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(2000)
    pg.select_option('select[data-gstym]', "202603"); pg.wait_for_timeout(1500)
    pg.click('button[data-gstpart="inreg"]'); pg.wait_for_timeout(3000); t = pg.inner_text("#app")
    ok("Input register, Mar 2026" in t and "they agree." in t, "input register for the month ties to 3B table 4")
    ok("Reverse charge" in t and "2B not brought in" in t, "kinds and 2B status shown")
    pg.screenshot(path=OUT + "/b134-inreg.png", full_page=False)
    pg.select_option('select[data-inregscope]', "year"); pg.wait_for_timeout(5000); t = pg.inner_text("#app")
    ok("the year Apr 2025 to Mar 2026" in t and "they agree." in t, "the whole year ties to the twelve 3Bs")
    pg.select_option('select[data-inregf]', "Reverse charge"); pg.wait_for_timeout(3000); t = pg.inner_text("#app")
    ok("GYANESH SHARMA" in t, "filter by kind: the reverse-charge rent journals")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => window.__saved.push(n); }")
    pg.click('button[data-act="inregExcel"]'); pg.wait_for_timeout(5000)
    ok(any("Input-register-07AADCV3366N1ZU" in n for n in pg.evaluate("window.__saved")), "input register as Excel")
    j = pg.evaluate("GSTR.toJson('202603','07',{plain:true})")
    inv = [i for s in j.get("b2b", []) for i in s["inv"] if i["inum"] == "VMS/DL/25-26/695"]
    ok(inv and sorted(x["itm_det"]["rt"] for x in inv[0]["itms"]) == [5, 18], "the two-rate invoice goes out as two items, 5% and 18%")
    rates = set(x["itm_det"]["rt"] for s in j.get("b2b", []) for i in s["inv"] for x in i["itms"])
    ok(rates <= {0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40}, "every rate in the JSON is a GST rate: " + str(sorted(rates)))
    ok("hsn_b2b" in j.get("hsn", {}) and all("rt" in h for h in j["hsn"]["hsn_b2b"]), "HSN summary with its rate, B2B and B2C apart")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
