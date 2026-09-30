"""python3 run_react_home.py - the home screens in React: Clients (add a client, find, open), Today, Inbox.
Offline (this browser only), made-up clients; no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_home.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8152), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1300, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8152/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate("S.view = 'home'; S.homeTab = 'clients'; render()"); pg.wait_for_timeout(500)
    app = lambda: pg.inner_text("#app")
    ok("No clients yet" in app() and "0 clients" in app(), "Clients, empty: says so")
    ok(pg.locator('#app [role=button][aria-label="Upload invoices for any client"]').count() == 1, "the upload box for any client")
    # add a client through the form
    pg.click('#app button:has-text("Add client")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("document.activeElement.id") == "ncName", "Add client: the name field has the cursor")
    pg.fill("#ncName", "ZZ Gamma Industries"); pg.fill('input[placeholder="09AAACG1111A1Z5"]', "09AANFG3202D1ZX")
    pg.click('#app button:has-text("Add and open")'); pg.wait_for_timeout(600)
    ok(pg.evaluate("Object.keys(S.companies).length") == 0 and "check digit" in pg.inner_text("#toast"), "a GSTIN with a wrong check digit is refused")
    ok(pg.input_value("#ncName") == "ZZ Gamma Industries", "and what was typed stays")
    pg.fill('input[placeholder="09AAACG1111A1Z5"]', "09AANFG3202D1ZR"); pg.click('#app input[type=checkbox]')
    pg.click('#app button:has-text("Add and open")'); pg.wait_for_timeout(1500)
    co = pg.evaluate("Object.values(S.companies)[0] || null")
    ok(co and co["name"] == "ZZ Gamma Industries" and co["gstin"] == "09AANFG3202D1ZR" and co["tallyName"] == "ZZ Gamma Industries" and co["turnover10cr"] is True, "added: name, GSTIN, Tally name defaults to the name, turnover")
    ok(pg.evaluate("S.view") == "company" and pg.evaluate("S.coId") == co["id"], "and opened")
    # a second client, then the list
    pg.evaluate("() => { const c = newCompany({name: 'ZZ Delta Foods', gstin: '', tallyName: 'Delta Foods (Tally)'}); c.stats = {drafts: 3, check: 1, waiting: 2}; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; }")
    pg.click('#side .side-link:has-text("All clients")'); pg.wait_for_timeout(700)
    ok("2 clients" in app() and pg.locator("#app table.data tbody tr").count() == 2, "Clients: both in the list")
    ok("Tally: Delta Foods (Tally)" in app(), "a Tally name that differs is shown under the client")
    pg.fill('input[placeholder="Name, GSTIN or Tally name"]', "delta"); pg.wait_for_timeout(300)
    ok(pg.locator("#app table.data tbody tr").count() == 1 and "ZZ Delta Foods" in app(), "Find a client narrows the list")
    pg.evaluate("render()"); pg.wait_for_timeout(300)
    ok(pg.input_value('input[placeholder="Name, GSTIN or Tally name"]') == "delta" and pg.locator("#app table.data tbody tr").count() == 1, "the search stays through a redraw")
    pg.fill('input[placeholder="Name, GSTIN or Tally name"]', "nothing like it"); pg.wait_for_timeout(300)
    ok("No client matches" in app(), "no match: says so")
    pg.fill('input[placeholder="Name, GSTIN or Tally name"]', ""); pg.wait_for_timeout(300)
    pg.click('#app tr:has-text("ZZ Delta Foods")'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("CO().name") == "ZZ Delta Foods", "a click on the row opens the client")
    # Today
    # made-up counts (opening a client works them out again from its bills, which here are none)
    pg.evaluate("Object.assign(Object.values(S.companies).find(c => c.name === 'ZZ Delta Foods').stats, {drafts: 3, check: 1, waiting: 2}); S.view = 'home'; S.homeTab = 'today'; render()"); pg.wait_for_timeout(500)
    t = app()
    ok("What needs doing" in t and pg.locator("#app .metric").count() == 4, "Today: four counts")
    ok(pg.inner_text('#app .metric:has-text("To review") b') == "3" and pg.inner_text('#app .metric:has-text("To post") b') == "2", "the counts add up the clients")
    ok(pg.locator('#app tbody tr').first.inner_text().startswith("ZZ Delta Foods"), "the client with most to do comes first")
    pg.click('#app tbody tr:has-text("ZZ Delta Foods") td:nth-child(3) button'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("S.view") == "company" and pg.evaluate("CO().name") == "ZZ Delta Foods" and pg.evaluate("S.tab") == "invoices", "a count opens that client at the right step")
    pg.evaluate("S.view = 'home'; S.homeTab = 'today'; render()"); pg.wait_for_timeout(400)
    pg.click('#app .metric:has-text("To read")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.homeTab") == "inbox" and "Nothing waiting" in app(), "To read opens the Inbox; nothing waiting")
    pg.screenshot(path=OUT + "/react-home.png")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
