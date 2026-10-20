"""python3 run_react_books.py - the books (TDS & GST) in React: the tabs, and TDS by year, then quarter, then the
return (a salary sheet brought in, no day book). Offline, a made-up client.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_books.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8163), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8163/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => { S.tab = "books"; S.booksTab = "tds"; S.step = null; render(); }); }""")
    pg.wait_for_timeout(1500)
    app = lambda: pg.inner_text("#app")
    # clean-up batch 1: TDS and GST are each a sidebar page (Returns); Audit its Tie-out (the Tally ledgers: on the TDS and GST pages)
    ok(pg.locator('#app nav[aria-label="Books"], #app nav[aria-label="From Tally"]').count() == 0 and pg.inner_text("#cobar .tbar-title h2") == "TDS", "TDS: a page of its own, titled TDS, no row of book tabs")
    ok("TDS is worked out from the day book" in app() and pg.locator('#app button:has-text("Bring in from Tally")').count() == 1 and pg.locator('#app button:has-text("Import salary for 24Q")').count() == 1,
       "no day book and no salary: the TDS tab says what to bring in, with a button for each")
    pg.evaluate("goClient('books:import')"); pg.wait_for_timeout(400)   # (t70: From Tally is reached from the Tally panel, not the sidebar)
    # ledger-confirm (14-Oct-2026): no Tally ledgers tab; the TDS and GST ledgers are on the TDS and GST pages
    ok(pg.locator('#app nav[aria-label="From Tally"] button:has-text("Tally ledgers")').count() == 0, "From Tally: no Tally ledgers tab")
    for side, say in [["MIS", "MIS is worked out from the day book"], ["Statements", "The financial statements are made"], ["Audit", "The audit checks run over the day book"]]:
        pg.click('#side button:has-text("%s")' % side); pg.wait_for_timeout(400)
        ok(pg.evaluate("booksTab()") == {"MIS": "mis", "Statements": "fs", "Audit": "audit"}[side] and say in app() and pg.locator('#app nav[aria-label="From Tally"]').count() == 0,
           "%s: a page of its own in the sidebar, with its own empty message" % side)
    pg.evaluate("booksTabGo('tds')"); pg.wait_for_timeout(400)
    pg.evaluate("goClient('books:import')"); pg.wait_for_timeout(500)
    ok(pg.evaluate("booksTab()") == "import", "From Tally: the books brought in")
    # a salary sheet for 2026-27, two employees, two quarters
    pg.evaluate("""() => { S.books.salary = [["2026-05-31", "Asha Rao", "ABCPR1234K", 60000, 5000], ["2026-05-31", "Vikram Das", "ABCPD5678L", 45000, 2500], ["2026-08-31", "Asha Rao", "ABCPR1234K", 60000, 5000]]
        .map(([date, name, pan, gross, tds]) => ({date, name, pan, code: "", gross, tds, exempt: 0, standard: 0, profTax: 0, chapter6: 0, surcharge: 0, cess: 0}));
      S.tdsView = null; booksTabGo("tds"); }""")
    pg.wait_for_timeout(600)
    # round 46: TDS opens on the year's grid; tds-layout (14-Oct-2026): the grid is the whole page, no TDS tabs above it
    ok(pg.locator("#app [data-tds-grid='2026-27']").count() == 1 and pg.locator('#app nav[aria-label="TDS"]').count() == 0, "one year: TDS opens on the year's grid, no tabs")
    # 09-Oct-2026 (app-tdsgst): the year is a grid of forms × quarters; 24Q in Q1 is its own cell
    # smart moves round 1 (the owner, 09-Oct-2026): the year opens on the quarter due now; every quarter is chosen for the grid
    due = pg.evaluate("Smart.tdsDue()")
    ok(pg.evaluate("S.tdsQ") == (due["q"] if due["fy"] == "2026-27" else pg.evaluate("S.tdsQ")), "the quarter due now is chosen (%s)" % pg.evaluate("S.tdsQ"))
    pg.evaluate("() => tdsPick('2026-27', '', '')"); pg.wait_for_timeout(400)
    q1 = pg.inner_text('#app [data-cell="24Q|Q1"]')
    # next-tds-clear: a cell is the return's status and its TDS (two lines)
    ok("7,500" in q1 and pg.get_attribute('#app [data-cell="24Q|Q1"]', "data-status") in ("prog", "ready"), "Q1 24Q: ₹7,500, with its status" + " [" + q1.replace("\n", " ") + "]")
    pg.click("#app [data-tds-bar] details.more > summary"); pg.click("#app [data-tds-more='years']"); pg.wait_for_timeout(400)
    ok("Every year" in app() and "2026-27" in app(), "TDS: the years")
    pg.click('#app table.bk-table button:has-text("Open")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.tdsView") == "year" and pg.evaluate("S.tdsFy") == "2026-27", "Open: the year")
    pg.click('#app [data-cell="24Q|Q2"]'); pg.wait_for_timeout(700)
    ok(pg.evaluate("[S.tdsView, S.tdsQ, S.tdsForm]") == ["return", "Q2", "24Q"] and "Form 138 (earlier 24Q) · Q2" in pg.inner_text("#app [data-return-title]"), "Q2 24Q: its return opens")
    pg.click("#app [data-return-card] .ret-back"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.tdsView") == "year", "back to the year")
    # tds-layout: the old Checks (certificates and rate questions) is a return's To fix
    pg.evaluate("() => Route.apply('#/c/' + S.coId + '/books/tds/2026-27/checks/rates')"); pg.wait_for_timeout(700)
    ok(pg.evaluate("[S.tdsView, S.tdsTab, S.tdsFix]") == ["return", "file", "rates"] and pg.locator("#app [data-certs]").count() == 1, "the old Checks address: a return's Validate & file, certificates and rate questions")
    pg.evaluate("booksTabGo('ledgers')"); pg.wait_for_timeout(500)
    ok(pg.evaluate("[booksTab(), S.tdsView]") == ["tds", "ledgers"] and pg.locator("#app [data-tax-ledgers]").count() == 1, "the old Tally ledgers tab opens the TDS page's Ledgers")
    pg.evaluate("() => { S.ledKind = ''; tdsNav('year'); }"); pg.wait_for_timeout(300)
    pg.click('#side button[data-side="GST"]'); pg.wait_for_timeout(500)
    ok(pg.evaluate("booksTab()") == "gst", "GST opens from the sidebar")
    for side, tab in [["MIS", "mis"], ["Statements", "fs"], ["Audit", "audit"]]:
        pg.click('#side button:has-text("%s")' % side); pg.wait_for_timeout(500)
        ok(pg.evaluate("booksTab()") == tab, "%s opens from the sidebar" % side)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
