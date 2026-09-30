"""python3 run_react_frame.py - the React frame: top bar, client switcher, firm menu, Tally panel, sidebar.
Offline (this browser only), two made-up clients; no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_frame.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8150), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1300, "height": 850}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8150/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate("""() => { S.firm.firmName = "ZZ Test Firm";
      for (const [n, g] of [["ZZ Alpha Traders", "09AANFG3202D1ZR"], ["ZZ Beta Works", ""]]){ const c = newCompany({name: n, gstin: g}); S.companies[c.id] = c; }
      S.view = "home"; S.homeTab = "clients"; render(); }""")
    pg.wait_for_timeout(800)
    top = lambda: pg.inner_text("#cobar")
    ok("Clients" in top() and "ZZ Test Firm" in top() and "Tally" in top(), "home: the top bar has the title, the firm and the Tally chip")
    ok("ZZ Test Firm" in pg.inner_text("#firmLine"), "the firm line under the brand")
    # the switcher: F3, type, arrows, Enter
    pg.keyboard.press("F3"); pg.wait_for_timeout(400)
    ok(pg.locator("#modal .sw").count() == 1 and not pg.evaluate("document.getElementById('modal').classList.contains('hidden')"), "F3 opens Select company")
    ok(pg.evaluate("document.activeElement.placeholder") == "Type a client name or GSTIN", "the search box has the cursor")
    ok(pg.locator("#modal li[role=option]").count() == 2, "both clients are listed")
    pg.keyboard.type("beta"); pg.wait_for_timeout(300)
    ok(pg.locator("#modal li[role=option]").count() == 1 and "ZZ Beta Works" in pg.inner_text("#modal"), "typing narrows the list")
    pg.keyboard.press("Backspace", delay=10); [pg.keyboard.press("Backspace") for _ in range(3)]; pg.wait_for_timeout(300)
    pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(200)
    sel = pg.inner_text('#modal li[aria-selected="true"]')
    pg.keyboard.press("Enter"); pg.wait_for_timeout(1500)
    name = sel.split("\n")[0].strip()
    ok(pg.evaluate("S.view") == "company" and name in pg.inner_text("#side .side-co"), "↓ then Enter opens the chosen client (" + name + "), named in the sidebar")
    ok(pg.evaluate("document.getElementById('modal').classList.contains('hidden')") and pg.locator("#modal .sw").count() == 0, "and the switcher closes")
    ok("Dashboard" in top(), "the client opens on its dashboard, named in the top bar")
    # Esc and a click outside close it
    pg.keyboard.press("Control+k"); pg.wait_for_timeout(300); pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ok(pg.locator("#modal .sw").count() == 0, "Ctrl+K opens it, Esc closes it")
    pg.click("#side .side-co"); pg.wait_for_timeout(300); pg.mouse.click(20, 800); pg.wait_for_timeout(300)
    ok(pg.locator("#modal .sw").count() == 0, "the sidebar's client button opens it, a click outside closes it")
    # the sidebar and the top bar move together
    pg.click('#side .side-link:has-text("Purchase")'); pg.wait_for_timeout(800)
    ok("Purchase bills" in top() and pg.locator("#cobar .sbar button").count() == 3, "Purchase: its title and the status tabs")
    pg.click('#cobar .sbar button:has-text("Ready to post")'); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.tab") == "export" and pg.get_attribute('#cobar .sbar button:has-text("Ready to post")', "aria-selected") == "true", "a status tab switches the step")
    pg.click('#side .side-link:has-text("Client setup")'); pg.wait_for_timeout(800)
    ok("Client setup" in top() and pg.locator('#cobar nav[aria-label="Client setup"] button').count() == 5, "Client setup: its five tabs")
    pg.click('#cobar nav[aria-label="Client setup"] button:has-text("GST")'); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.tab") == "gstset", "a setup tab opens it")
    pg.click('#cobar button:has-text("Back to the work")'); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.tab") == "invoices", "Back to the work")
    # the Tally panel and the firm menu
    pg.click("#cobar .tallychip"); pg.wait_for_timeout(400)
    ok(pg.locator(".tallypanel").count() == 1 and "Tally connection" in pg.inner_text(".tallypanel"), "the Tally chip opens the Tally panel")
    pg.click('.tallypanel button[aria-label="Close"]'); pg.wait_for_timeout(300)
    ok(pg.locator(".tallypanel").count() == 0, "and it closes")
    pg.click("#cobar .firmbtn"); pg.wait_for_timeout(400)
    ok(pg.locator(".firmmenu").count() == 1, "the firm button opens the firm menu")
    pg.screenshot(path=OUT + "/react-frame-menu.png")
    pg.click('.firmmenu button:has-text("Settings")'); pg.wait_for_timeout(800)
    ok(pg.locator(".firmmenu").count() == 0 and pg.evaluate("S.view") == "home" and "Settings" in top(), "Settings from the firm menu")
    pg.click('#side .side-link:has-text("All clients")'); pg.wait_for_timeout(800)
    ok("Clients" in top() and pg.evaluate("S.homeTab") == "clients", "All clients from the sidebar")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
