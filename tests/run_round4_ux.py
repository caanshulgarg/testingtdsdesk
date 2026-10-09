"""python3 run_round4_ux.py - round 4 of the UI pass (09-Oct-2026, the owner: "check complete ui and ux"). Checks the
fixes of that round on the React test build (app/dist-test), offline, the made-up client of shots_ui_pass.py:
  1. a way back to the open client from the firm's pages (Clients, Today, Inbox, Settings, Help), desktop and phone:
     "Back to <client>" in the side menu, which opens that client;
  2. no heading that repeats the page title (Help, the firm's Inbox);
  3. plain words: no "office automation" on the inboxes; Transactions says "uploaded <date>", not "up <date>";
  4. Purchase -> To review: the tick column is "Book TDS", so only one column is called "TDS";
  5. the About line's time says IST; Look up's example question has no slash date, and that date is understood;
  6. Sign in: the "Keep me signed in" tick box is an ordinary small box beside its words;
  7. Dashboard: the "Getting <client> ready" steps keep their text readable (the button under the words, not squeezing them)."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
# shots_ui_pass's made-up client and pages, read from its source (importing it would start its own web server on a fixed port)
import re, types, ast
_src = open(os.path.join(HERE, "shots_ui_pass.py")).read()
U = types.SimpleNamespace(SEED=re.search(r'SEED = """(.*?)"""', _src, re.S).group(1))
_ns = {}; exec(re.search(r"(HOME = .*?\n\])\n", _src, re.S).group(1), _ns); U.PAGES = _ns["PAGES"]
def _books():
    try:
        import gstfix; return list(gstfix.load())
    except Exception: return None
U.books = _books
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8253), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errs = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

APP = "() => document.getElementById('app').innerText"
BACK = '#side .side-link:has-text("Back to Testing AAD")'

def start(pg):
    pg.goto("http://localhost:8253/"); pg.wait_for_timeout(2500)
    return pg

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1366, "height": 768})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    start(pg)
    # 6. sign in: the tick box
    box = pg.locator('input[data-cloud="keep"]')
    if box.count():
        b = box.bounding_box(); lab = pg.locator('label:has(input[data-cloud="keep"])').bounding_box()
        ok(b and b["width"] <= 24 and b["height"] <= 24, "Sign in: the Keep me signed in box is a small tick box (%s)" % b)
        ok(b and lab and abs((b["y"] + b["height"] / 2) - (lab["y"] + 12)) < 14, "Sign in: the box sits beside its words, on the first line")
    else: ok(False, "Sign in: the Keep me signed in box is on the page")
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate(U.SEED, None); pg.wait_for_timeout(1000)

    # 1. back to the client from each firm page
    for name, js in [("Clients", "navHome('clients')"), ("Today", "navHome('today')"), ("Inbox", "navHome('inbox')"), ("Settings", "goSettings(null)"), ("Help", "navHome('help')")]:
        pg.evaluate("() => { goClient('sales'); }"); pg.wait_for_timeout(500)
        pg.evaluate("() => { " + js + "; }"); pg.wait_for_timeout(500)
        ok(pg.locator(BACK).count() == 1, name + ": the side menu has Back to Testing AAD")
        if pg.locator(BACK).count():
            pg.click(BACK); pg.wait_for_timeout(800)
            ok(pg.evaluate("() => S.view") == "company" and "Sales" in pg.inner_text("header.top"), name + ": Back to Testing AAD opens the client where you left it (Sales)")
    pg.evaluate("() => { goClient('dash'); }"); pg.wait_for_timeout(500)
    ok(pg.locator(BACK).count() == 0, "inside the client there is no Back to the client")

    # 2. no heading repeating the title
    pg.evaluate("() => navHome('help')"); pg.wait_for_timeout(600)
    ok(pg.locator('#app h1:text-is("Help"), #app h2:text-is("Help"), #app h3:text-is("Help")').count() == 0, "Help: no second Help heading under the title")
    pg.evaluate("() => navHome('inbox')"); pg.wait_for_timeout(600)
    ok(pg.locator('#app h1:text-is("Inbox"), #app h2:text-is("Inbox")').count() == 0, "Inbox (firm): no second Inbox heading under the title")
    # 3. plain words
    ok("office automation" not in pg.evaluate(APP), "Inbox (firm): no 'office automation'")
    pg.evaluate("() => { goClient('inbox'); }"); pg.wait_for_timeout(600)
    ok("office automation" not in pg.evaluate(APP), "Inbox (client): no 'office automation'")
    pg.evaluate("() => { goClient('txn'); }"); pg.wait_for_timeout(900)
    t = pg.evaluate(APP)
    ok(re.search(r"uploaded \d{2}-[A-Z][a-z]{2}-\d{4}", t) and not re.search(r"\bup \d{2}-", t), "Transactions: 'uploaded 09-Oct-2026', not 'up 09-Oct-2026'")
    # 4. one TDS column
    pg.evaluate("() => { goClient('bills'); }"); pg.wait_for_timeout(900)
    heads = [h.strip().upper() for h in pg.locator("#app table thead th").all_inner_texts()]
    ok(heads.count("TDS") == 1 and "BOOK TDS" in heads, "Purchase To review: one column called TDS and the tick column called Book TDS (%s)" % heads)
    # 5. IST and the look up example
    pg.evaluate("() => goSettings(null)"); pg.wait_for_timeout(600)
    ab = pg.inner_text("[data-about]")
    ok(re.search(r"\d{2}:\d{2} IST", ab), "Settings: the About line's time says IST (%s)" % ab)
    pg.evaluate("() => { goClient('books:lookup'); }"); pg.wait_for_timeout(900)
    ph = pg.get_attribute("#lkAsk", "placeholder") or ""
    ok(ph and not re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", ph) and re.search(r"\d{2}-[A-Z][a-z]{2}-\d{4}", ph), "Look up: the example question's date is like 31-Mar-2026 (%s)" % ph)
    d = pg.evaluate("() => LK.dateIn('trial balance as on 31-Mar-2026')")
    ok(d and d.get("asOn") == "20260331", "Look up: 'as on 31-Mar-2026' is understood (%s)" % d)
    old = [pg.evaluate("(q) => LK.dateIn(q)", q) for q in ["trial balance as on 31/03/2026", "from 01-04-2025 to 30-09-2025", "sales in march"]]
    ok(old[0] and old[0].get("asOn") == "20260331" and old[1] and old[1].get("from") == "20250401" and old[1].get("to") == "20250930", "Look up: the dates it understood before still read the same (%s)" % old[:2])
    # 7. dashboard steps
    pg.evaluate("() => { goClient('dash'); }"); pg.wait_for_timeout(900)
    narrow = pg.evaluate("""() => [...document.querySelectorAll('#app .onb-list li')].filter(s => s.offsetParent && s.querySelector('button')).map(s => { const t = s.querySelector('b'); return t ? Math.round(t.getBoundingClientRect().width) : 999; })""")
    ok(narrow and min(narrow) >= 150, "Dashboard: each setup step's words have room (%s px)" % narrow)

    # 1 (phone). back to the client from the firm's pages on a phone
    ph = br.new_page(viewport={"width": 390, "height": 844}); start(ph)
    ph.click('button[data-act="useOffline"]'); ph.wait_for_timeout(1000); ph.evaluate(U.SEED, None); ph.wait_for_timeout(800)
    ph.evaluate("() => navHome('clients')"); ph.wait_for_timeout(600)
    ok(ph.locator(BACK).count() == 1 and ph.locator(BACK).is_visible(), "phone, Clients: Back to Testing AAD is in the bottom menu")
    if ph.locator(BACK).count():
        ph.locator(BACK).click(); ph.wait_for_timeout(800)
        ok(ph.evaluate("() => S.view") == "company", "phone: it opens the client")
    # 8 (phone). a tile's amount on one line (Reports with the books of tests/data, and the Dashboard's tiles)
    ph.evaluate(U.SEED, U.books()); ph.wait_for_timeout(800)
    for pgname in ["books:reports", "dash"]:
        ph.evaluate("(t) => { S.view = 'company'; goClient(t); }", pgname); ph.wait_for_timeout(1500)
        lines = ph.evaluate("""() => [...document.querySelectorAll('#app .dash-tiles .dtile b')].filter(b => b.offsetParent && /\\d/.test(b.innerText)).map(b => [b.innerText, +(b.getBoundingClientRect().height / parseFloat(getComputedStyle(b).fontSize)).toFixed(2)])""")
        ok(all(n < 1.9 for _, n in lines), "phone, %s: each tile's amount on one line (%s)" % (pgname, lines[:4]))
        wide = ph.evaluate("() => [...document.querySelectorAll('#app .dash-tiles .dtile b')].filter(b => b.offsetParent && b.getBoundingClientRect().right > b.parentElement.getBoundingClientRect().right - 8).map(b => b.innerText)")
        ok(not wide, "phone, %s: no tile's amount is cut off (%s)" % (pgname, wide))
    br.close()

ok(not errs, "no page errors (%s)" % errs[:2])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
