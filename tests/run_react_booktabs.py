"""python3 run_react_booktabs.py - the Books tabs other than TDS and GST in React, with the books in tests/data: Tally
ledgers (a meaning set, confirmed and undone, the find box, confirm the shown, the posting ledgers), and more as they
move. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_booktabs.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8158), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8158/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "ledgers"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    # Tally ledgers
    pend = lambda: pg.evaluate("LedMaster.pending(S.books).length")
    n0 = pend()
    ok(n0 > 0 and pg.locator("#lmTable tbody tr").count() == n0, "Tally ledgers: the %d to confirm are listed" % n0)
    row = pg.locator("#lmTable tbody tr").first; name = row.get_attribute("data-key")
    row.locator("td.ac button").click(); pg.wait_for_timeout(400)
    ok(pend() == n0 - 1 and pg.evaluate("S.books.map[%s].ok" % json.dumps(name)), "Confirm: %s confirmed, one fewer to confirm" % name)
    pg.click('nav[aria-label="Ledgers"] button:has-text("Confirmed")'); pg.wait_for_timeout(400)
    pg.locator('#lmTable tr[data-key=%s] button:text-is("✓ confirmed")' % json.dumps(name)).click(); pg.wait_for_timeout(400)
    ok(pend() == n0 and not pg.evaluate("S.books.map[%s].ok" % json.dumps(name)), "✓ confirmed, clicked: undone")
    pg.click('nav[aria-label="Ledgers"] button:has-text("Other ledgers")'); pg.wait_for_timeout(400)
    other = pg.locator("#lmTable tbody tr").first.get_attribute("data-key")
    box = pg.locator('input[aria-label="Find a ledger"]'); box.click(); pg.keyboard.type(other[:8], delay=15); pg.wait_for_timeout(600)
    ok(pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find a ledger" and pg.locator("#lmTable tbody tr").count() >= 1, "the find box filters as typed, keeping the cursor")
    pg.select_option('select[aria-label="What %s is"]' % other, "tds_payable"); pg.wait_for_timeout(500)
    m = pg.evaluate("S.books.map[%s]" % json.dumps(other))
    ok(m["what"] == "tds_payable" and m["ok"], "an other ledger made a TDS ledger: kept, and confirmed as the user's own choice")
    box.fill(""); pg.click('nav[aria-label="Ledgers"] button:has-text("TDS and TCS")'); pg.wait_for_timeout(400)
    sec = pg.locator('input[aria-label="Section of %s"]' % other); sec.fill("194j"); sec.press("Tab"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.books.map[%s].section" % json.dumps(other)) == "194J", "its section typed, kept in capitals")
    pg.click('nav[aria-label="Ledgers"] button:has-text("To confirm")'); pg.wait_for_timeout(400)
    pg.click('button:has-text("Confirm the")'); pg.wait_for_timeout(600)
    ok(pend() == 0 and "Every GST and TDS ledger is confirmed." in pg.inner_text("#app"), "Confirm the shown: nothing left to confirm")
    pg.click('nav[aria-label="Ledgers"] button:has-text("What FinCom posts to")'); pg.wait_for_timeout(400)
    ok("What FinCom posts bills to" in pg.inner_text("#app"), "What FinCom posts to: the posting ledgers")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
