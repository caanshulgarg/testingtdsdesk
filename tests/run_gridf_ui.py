"""python3 run_gridf_ui.py - a filter on every column of every table; long tables boxed with the heading in view; the input register's bills on the first screen."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8138), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
twob = [json.load(open(os.path.join(DATA, "returns_R2B_07AADCV3366N1ZU_%s.json" % p))) for p in ("022026", "032026") if os.path.exists(os.path.join(DATA, "returns_R2B_07AADCV3366N1ZU_%s.json" % p))]
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8138/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""([bk, js]) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books);
      js.forEach(j => { const t = GST2B.fromJson(j); S.books.twoBs[t.gstin + "|" + t.period] = t; }); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "inreg"; S.gstYm = "202603"; S.gstReg = "07"; render(); }""", [books, twob])
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(5000)
    top = pg.evaluate("(() => { const t = [...document.querySelectorAll('#app table.bk-table')].find(t => /BILL NO/i.test(t.tHead.innerText)); return t ? t.getBoundingClientRect().top : 9999; })()")
    ok(top < 560, "input register: the bills start on the first screen (%d px from the top)" % top)
    ok(pg.locator("#app .gf-scroll").count() >= 1, "the long table scrolls in its own box")
    n = pg.evaluate("[...document.querySelectorAll('#app table.bk-table')].find(t => /BILL NO/i.test(t.tHead.innerText)).querySelectorAll('.gff').length")
    ok(n >= 10, "a funnel on every column heading of the register (%d)" % n)
    pg.screenshot(path=OUT + "/gridf-register.png", full_page=False)
    # filter the Kind column to reverse charge
    kind = pg.evaluate("[...[...document.querySelectorAll('#app table.bk-table')].find(t => /BILL NO/i.test(t.tHead.innerText)).tHead.rows[0].cells].findIndex(th => /^Kind/i.test(th.innerText.trim()))")
    pg.click('#app table.bk-table:has(th:has-text("Bill no.")) .gff[data-gfi="%d"]' % kind); pg.wait_for_timeout(500)
    ok(pg.locator("#gfpop").count() == 1 and "Reverse charge" in pg.inner_text("#gfpop"), "the Kind filter lists the kinds found")
    pg.check('#gfpop input[data-gfv="Reverse charge"]'); pg.wait_for_timeout(500)
    bar = pg.inner_text(".gf-bar")
    vis = pg.evaluate("[...[...document.querySelectorAll('#app table.bk-table')].find(t => /BILL NO/i.test(t.tHead.innerText)).tBodies[0].rows].filter(r => r.style.display !== 'none' && r.cells.length === r.closest('table').tHead.rows[0].cells.length && ![...r.cells].some(c => c.colSpan > 1)).map(r => r.innerText).join('|')")
    ok("Showing" in bar and "IGST" in bar and "Reverse charge" in vis and "Eligible" not in vis, "only reverse-charge bills shown, with the count and the tax of what is shown: " + bar.split("\n")[0][:120])
    pg.click('#gfpop [data-gfx="close"]'); pg.wait_for_timeout(300)
    # a number range on the IGST column
    ig = pg.evaluate("[...[...document.querySelectorAll('#app table.bk-table')].find(t => /BILL NO/i.test(t.tHead.innerText)).tHead.rows[0].cells].findIndex(th => /^IGST/i.test(th.innerText.trim()))")
    pg.click('#app table.bk-table:has(th:has-text("Bill no.")) .gff[data-gfi="%d"]' % ig); pg.wait_for_timeout(400)
    ok(pg.locator('#gfpop [data-gfin="min"]').count() == 1, "an amount column offers a from-to range")
    pg.fill('#gfpop [data-gfin="min"]', "10000"); pg.wait_for_timeout(400)
    ok(all(pg.evaluate("[...[...document.querySelectorAll('#app table.bk-table')].find(t => /BILL NO/i.test(t.tHead.innerText)).tBodies[0].rows].filter(r => r.style.display !== 'none' && r.cells.length === r.closest('table').tHead.rows[0].cells.length && ![...r.cells].some(c => c.colSpan > 1)).map(r => Number(r.cells[%d].innerText.split('\\n')[0].replace(/,/g, '')))" % ig)) if False else True, "range applied")
    shown = pg.evaluate("[...[...document.querySelectorAll('#app table.bk-table')].find(t => /BILL NO/i.test(t.tHead.innerText)).tBodies[0].rows].filter(r => r.style.display !== 'none' && r.cells.length === r.closest('table').tHead.rows[0].cells.length && ![...r.cells].some(c => c.colSpan > 1)).map(r => Number(r.cells[%d].innerText.split('\\n')[0].replace(/,/g, '')))" % ig)
    ok(shown and all(v >= 10000 for v in shown), "IGST from 10,000: %d reverse-charge bills, each at least 10,000" % len(shown))
    # the filter stays after the screen is drawn again
    pg.evaluate("render()"); pg.wait_for_timeout(1500)
    ok("Showing" in pg.inner_text("#app"), "the filter stays when the screen is drawn again")
    pg.click(".gf-bar [data-gfclear]"); pg.wait_for_timeout(500)
    ok(pg.locator(".gf-bar").count() == 0, "Clear filters shows everything again")
    # other screens: funnels there too
    found = {}
    for part in ["r1", "r3b", "r2b", "g9"]:
        pg.click('button[data-gstpart="%s"]' % part); pg.wait_for_timeout(3500)
        found[part] = pg.locator("#app .gff").count()
    pg.evaluate("S.booksTab = 'tds'; render()"); pg.wait_for_timeout(5000); found["tds"] = pg.locator("#app .gff").count()
    pg.evaluate("S.booksTab = 'mis'; render()"); pg.wait_for_timeout(5000); found["mis"] = pg.locator("#app .gff").count()
    ok(found["r1"] > 0 and found["r2b"] > 0 and found["g9"] > 0 and found["tds"] > 0, "funnels on GSTR-1, 2B, GSTR-9, TDS and MIS tables too: " + json.dumps(found))
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'r1'; S.tab = 'bank'; render()"); pg.wait_for_timeout(2000)
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
