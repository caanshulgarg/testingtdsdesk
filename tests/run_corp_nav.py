"""python3 run_corp_nav.py - Corporate, phase 1 stage 1 (07-Nov-2026; the owner approved the designs "Corporate and
e-Forms" and "ROC documents"): a client's Corporate entry, after Statements, for companies only. Offline, two made-up
clients (no real client): a company (PAN with C as its fourth letter) and a partnership firm (F).
  1. the company's sidebar: Corporate right after Statements; the firm's sidebar: no Corporate (also when its entity type
     is chosen in Client setup: a firm set as "Company" gets it, a company set as "Firm or LLP" loses it);
  2. a click opens Corporate › Company profile (#/c/<client>/books/corp), lit as the current page, the top bar's title
     "Corporate"; its tabs Company profile · e-Forms · Resolutions & minutes each open their page and address
     (books/corp, books/corp-forms, books/corp-docs), Corporate stays lit;
  3. Refresh and Back keep the page; a firm opened at a Corporate address is told Corporate is for companies;
  4. the page's program is its own file: the app's first file (index-*.js) holds no Corporate screen, a Corporate-*.js file
     is fetched only when the page opens;
  5. a phone (390 wide): Corporate under More, the page never wider than the screen.
RED before stage 1: no Corporate entry. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_nav.py"""
import os, sys, glob, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CORP_PORT") or 8721)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
# two made-up clients: a company (PAN AABCK1234F: C) and a partnership firm (PAN AAFFL5678G: F)
SETUP = """() => {
  const a = newCompany({name: "Kestrel Textiles Private Limited", gstin: "07AABCK1234F1Z5"}); a.pan = "AABCK1234F";
  const b = newCompany({name: "Lantern Traders (made-up firm)", gstin: "27AAFFL5678G1Z2"}); b.pan = "AAFFL5678G";
  [a, b].forEach((c) => { S.companies[c.id] = c; Store.saveCompany(c); });
  S.coId = a.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; render(); return [a.id, b.id]; }"""
SIDE = "[...document.querySelectorAll('#side .side-link')].filter(e => e.offsetParent !== null).map(e => e.dataset.side)"
LIT = "[...document.querySelectorAll('#side .side-link[aria-current=page]')].filter(e => e.offsetParent !== null).map(e => e.dataset.side)"
TITLE = "(document.querySelector('.tbar-title h2') || {}).innerText || ''"

def open_client(pg, cid):
    pg.evaluate("(id) => openCompany(id).then(() => { S.tab = 'dash'; S.step = null; render(); })", cid); pg.wait_for_timeout(900)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    files = []
    pg.on("request", lambda r: files.append(r.url))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    co, firm = pg.evaluate(SETUP); pg.wait_for_timeout(1200)
    E, W = pg.evaluate, pg.wait_for_timeout

    print("1. the entry, for companies only")
    open_client(pg, co)
    side = E(SIDE)
    ok("Corporate" in side and "Statements" in side and side.index("Corporate") == side.index("Statements") + 1, "the company: Corporate right after Statements (%s)" % side)
    open_client(pg, firm)
    ok("Corporate" not in E(SIDE) and "Statements" in E(SIDE), "the firm: no Corporate (%s)" % E(SIDE))
    E("() => { CO().entity = 'C'; render(); }"); W(500)
    ok("Corporate" in E(SIDE), "a firm set as Company in Client setup gets Corporate")
    E("() => { CO().entity = ''; render(); }"); W(300)
    open_client(pg, co)
    E("() => { CO().entity = 'F'; render(); }"); W(500)
    ok("Corporate" not in E(SIDE), "a company set as Firm or LLP loses it")
    E("() => { CO().entity = ''; render(); }"); W(500)

    print("2. the page and its tabs")
    ok(not any("/Corporate-" in u for u in files), "no Corporate file fetched before the page is opened")
    pg.click('#side .side-link[data-side="Corporate"]'); W(1500)
    ok(E("S.tab === 'books' && booksTab() === 'corp'") and E("location.hash").endswith("/books/corp"), "Corporate opens Company profile (%s)" % E("location.hash"))
    ok(E(LIT) == ["Corporate"], "Corporate lit as the current page (%s)" % E(LIT))
    ok(E(TITLE) == "Corporate", "the top bar's title: Corporate (%s)" % E(TITLE))
    tabs = E("[...document.querySelectorAll('#app [data-corp-tab]')].map(e => e.innerText.trim())")
    ok(tabs == ["Company profile", "e-Forms", "Resolutions & minutes"], "the tabs (%s)" % tabs)
    ok(E("!!document.querySelector('#app [data-corp-page=profile]')"), "the profile page is shown")
    for k, page, addr in (("forms", "forms", "/books/corp-forms"), ("docs", "docs", "/books/corp-docs"), ("profile", "profile", "/books/corp")):
        pg.click('#app [data-corp-tab="%s"]' % k); W(900)
        ok(E("!!document.querySelector('#app [data-corp-page=%s]')" % page) and E("location.hash").endswith(addr) and E(LIT) == ["Corporate"],
           "tab %s: its page, address %s, Corporate lit (%s, %s)" % (k, addr, E("location.hash"), E(LIT)))
    ok(E("[...document.querySelectorAll('#app [data-corp-tab][aria-selected=true]')].map(e => e.dataset.corpTab)") == ["profile"], "the open tab is marked selected")

    print("3. Refresh and Back")
    pg.click('#app [data-corp-tab="forms"]'); W(900)
    pg.reload(); W(3500); E(OPEN); W(1500)
    ok(E("S.tab === 'books' && booksTab() === 'corp-forms'") and E("!!document.querySelector('#app [data-corp-page=forms]')"), "Refresh keeps e-Forms (%s)" % E("location.hash"))
    pg.go_back(); W(1500)
    ok(E("!!document.querySelector('#app [data-corp-page=profile]')"), "Back: Company profile again (%s)" % E("location.hash"))
    E("(id) => { location.hash = '#/c/' + id + '/books/corp'; }", firm); W(2000)
    ok(E("!!document.querySelector('#app [data-corp-not-company]')") and "for companies" in E("document.querySelector('#app').innerText"),
       "a firm at a Corporate address: told it is for companies")

    print("4. its own file")
    main = "".join(open(f, encoding="utf-8", errors="ignore").read() for f in glob.glob(os.path.join(SITE, "assets", "index-*.js")))
    ok("data-corp-page" not in main and "Resolutions & minutes" not in main, "the app's first file holds no Corporate screen")
    ok(any("/Corporate-" in u for u in files), "a Corporate-*.js file was fetched (%s)" % [u.rsplit("/", 1)[-1] for u in files if "Corporate" in u][:3])
    ok(glob.glob(os.path.join(SITE, "assets", "Corporate-*.js")) != [], "Corporate-*.js is in the build")
    ctx.close()

    print("5. a phone")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    co, firm = E(SETUP); W(1000)
    open_client(pg, co)
    pg.click("#side .side-more"); W(600)
    ok(E("!!document.querySelector('[data-side-sheet] .side-link[data-side=Corporate]')"), "Corporate is under More")
    pg.click('[data-side-sheet] .side-link[data-side="Corporate"]'); W(1500)
    ok(E("!!document.querySelector('#app [data-corp-page=profile]')"), "it opens the profile")
    wide = E("document.documentElement.scrollWidth")
    ok(wide <= 392, "the page is no wider than the screen (%s)" % wide)
    ctx.close()
    br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
