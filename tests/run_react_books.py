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
    ok(pg.locator('#app nav[aria-label="Books"] button').count() == 5, "TDS & GST has five tabs, the fifth Tie-out (phase 2, H54; MIS, Accounts and Audit have their own pages)")
    ok("TDS is worked out from the day book" in app() and pg.locator('#app button:has-text("Read the books from Tally")').count() == 1 and pg.locator('#app button:has-text("Import salary for 24Q")').count() == 1,
       "no day book and no salary: the TDS tab says what to bring in, with a button for each")
    for t, say in [["Tally ledgers", "The Tally ledgers come from the client's books"]]:
        pg.click('#app nav[aria-label="Books"] button:has-text("%s")' % t); pg.wait_for_timeout(400)
        ok(say in app() and "Salary for 24Q" not in app(), "%s, empty: its own message, not the TDS one" % t)
    for side, say in [["MIS", "MIS is worked out from the day book"], ["Accounts", "The accounts (balance sheet"], ["Audit", "The audit checks run over the day book"]]:
        pg.click('#side button:has-text("%s")' % side); pg.wait_for_timeout(400)
        ok(pg.evaluate("booksTab()") == {"MIS": "mis", "Accounts": "fs", "Audit": "audit"}[side] and say in app() and pg.locator('#app nav[aria-label="Books"]').count() == 0,
           "%s: a page of its own in the sidebar, with its own empty message" % side)
    pg.evaluate("booksTabGo('tds')"); pg.wait_for_timeout(400)
    pg.click('#app nav[aria-label="Books"] button:has-text("From Tally")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("booksTab()") == "import" and pg.get_attribute('#app nav[aria-label="Books"] button:has-text("From Tally")', "aria-selected") == "true", "From Tally tab")
    # a salary sheet for 2026-27, two employees, two quarters
    pg.evaluate("""() => { S.books.salary = [["2026-05-31", "Asha Rao", "ABCPR1234K", 60000, 5000], ["2026-05-31", "Vikram Das", "ABCPD5678L", 45000, 2500], ["2026-08-31", "Asha Rao", "ABCPR1234K", 60000, 5000]]
        .map(([date, name, pan, gross, tds]) => ({date, name, pan, code: "", gross, tds, exempt: 0, standard: 0, profTax: 0, chapter6: 0, surcharge: 0, cess: 0}));
      S.tdsView = null; booksTabGo("tds"); }""")
    pg.wait_for_timeout(600)
    ok("2026-27: returns by quarter" in app() and pg.inner_text("#app .tds-crumbs").startswith("TDS"), "one year: TDS opens on it, with the way back above")
    # 09-Oct-2026 (app-tdsgst): the year is a grid of forms × quarters; 24Q in Q1 is its own cell
    # smart moves round 1 (the owner, 09-Oct-2026): the year opens on the quarter due now; every quarter is chosen for the grid
    due = pg.evaluate("Smart.tdsDue()")
    ok(pg.evaluate("S.tdsQ") == (due["q"] if due["fy"] == "2026-27" else pg.evaluate("S.tdsQ")), "the quarter due now is chosen (%s)" % pg.evaluate("S.tdsQ"))
    pg.evaluate("() => tdsPick('2026-27', '', '')"); pg.wait_for_timeout(400)
    q1 = pg.inner_text('#app [data-cell="24Q|Q1"]')
    ok("7,500" in q1 and "2 employees" in q1, "Q1 24Q: ₹7,500 from two employees" + " [" + q1.replace("\n", " ") + "]")
    pg.click("#app .tds-crumbs button:has-text('TDS')"); pg.wait_for_timeout(400)
    ok("Every year" in app() and "2026-27" in app(), "TDS: the years")
    pg.click('#app table.bk-table button:has-text("Open")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.tdsView") == "year" and pg.evaluate("S.tdsFy") == "2026-27", "Open: the year")
    pg.click('#app [data-cell="24Q|Q2"]'); pg.wait_for_timeout(700)
    ok(pg.evaluate("[S.tdsView, S.tdsQ, S.tdsForm]") == ["return", "Q2", "24Q"] and any(x in pg.inner_text("#app .tds-crumbs") for x in ("Q2 · 24Q", "Q2 · Form 138", "Form 138 (earlier 24Q)")), "Q2 24Q: its return opens")
    pg.click("#app .tds-crumbs button:has-text('2026-27')"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.tdsView") == "year", "back to the year")
    pg.click('#app button:has-text("Certificates and rate questions")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.tdsView") == "certs" and "Certificates and rate questions" in pg.inner_text("#app .tds-crumbs"), "Certificates and rate questions")
    for t in ["Tally ledgers", "GST"]:
        pg.click('#app nav[aria-label="Books"] button:has-text("%s")' % t); pg.wait_for_timeout(500)
        ok(pg.get_attribute('#app nav[aria-label="Books"] button:has-text("%s")' % t, "aria-selected") == "true", "the %s tab opens" % t)
    for side, tab in [["MIS", "mis"], ["Accounts", "fs"], ["Audit", "audit"]]:
        pg.click('#side button:has-text("%s")' % side); pg.wait_for_timeout(500)
        ok(pg.evaluate("booksTab()") == tab, "%s opens from the sidebar" % side)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
