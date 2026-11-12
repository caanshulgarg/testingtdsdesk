"""python3 tests/run_hang_add_client.py - "Page blocked" in a click on Add client's "Add and open" (FINCOM-APP-STAGING-K, event
40d5469c, staging 12-Nov-2026 11:08 UTC: 2,134 ms in React's click handler, DIV.onclick, script index-*.js function WM:
react-dom's dispatchDiscreteEvent, i.e. any click React handles; the last click "button" on home/clients 2 s before, the
page then client/dash and, 2 s later, client/cotally, the report's route).
The click (Clients.jsx AddClient's save -> saveNewCompany, src/js/27) saved the client, opened it (openCompany: the
client's dashboard drawn, the whole page) and then drew the page again on its Tally card (S.tab = "cotally"; render()):
then the dashboard's drawing opened the client's books (Ledgers.watch -> openBooks: drawn again): three drawings of the
whole page in one click, two of them never seen. Now the client opens on its Tally card (openCompany's tab): two. Made-up books only (the fixture's large client copied 14 times, 51,758 entries, as run_hang_gst_year.py makes them,
left open as a person's last client) and 300 more made-up clients. Checks:
  1. from GST › Year of the large client, then the Clients page: Add client, a made-up name, "Add and open": the page is
     drawn on the Tally card and once more as the books start to open, never on the dashboard (it was dash, dash, Tally
     card), the click's longest frame within ADD_MS (default 200 at full speed);
  2. the new client is open on its Tally card (client/cotally, its address), saved with its name, the toast says it was
     added, the Clients list has it; the Tally card drawn is the one a fresh drawing draws;
  3. a second client added the same way from the Today page's Clients: the same.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_ADD_PORT") or 8337)
ADD_MS = int(os.environ.get("ADD_MS") or 200)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangadd-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "site"))
big = os.environ.get("BIG_DIR")
if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
    big = os.path.join(root, "bigxml")
    subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")
MORE = """() => { for (let i = 0; i < 300; i++){ const o = newCompany({name: "ZZ Made Up Client " + String(i).padStart(3, "0") + (i % 3 ? " Traders" : " Pvt Ltd"), gstin: ""}); S.companies[o.id] = o; D(o.id).loaded = true;
  o.stats = {drafts: i % 5, check: i % 7, records: 10}; } render(); return Object.keys(S.companies).length; }"""
INSTR = """() => { window.__dr = []; const r = window.render; window.render = function(){ window.__dr.push(S.view + '/' + S.tab); return r.apply(this, arguments); };
  window.addEventListener('click', () => { window.__drClick = window.__dr.slice(); });
  window.__lf = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lf.push(Math.round(e.duration)))).observe({type: 'long-animation-frame'}); }"""
CARD = "() => { const a = document.querySelector('#app'); return a ? a.innerText.replace(/\\s+/g, ' ').slice(0, 4000) : ''; }"

def add(pg, name, start_js, label):
    pg.evaluate(start_js); pg.wait_for_timeout(2500)
    pg.evaluate("() => FinComNav.go(() => navHome('clients'))"); pg.wait_for_timeout(1500)
    pg.click("[data-add-client]"); pg.wait_for_timeout(500)
    pg.fill("#ncName", name); pg.wait_for_timeout(400)
    pg.evaluate("() => { window.__dr = []; window.__drClick = null; window.__lf = []; }")
    pg.click("text=Add and open"); pg.wait_for_timeout(2000)
    # the drawings made by the click itself (window's own click listener runs after React's)
    m = pg.evaluate("() => ({dr: window.__drClick || [], lf: window.__lf.slice()})")
    longest = max(m["lf"] or [0])
    st = pg.evaluate("""(n) => { const c = Object.values(S.companies).find(x => x.name === n); return {id: c && c.id, open: S.view + '/' + S.tab, co: S.coId, hash: location.hash,
      toast: (document.getElementById('toast') || {}).innerText || '', listed: sortedCompanies().some(x => x.name === n)}; }""", name)
    ok(m["dr"] == ["company/cotally", "company/cotally"] and longest <= ADD_MS,
       "%s: drawn in the click %s (on the Tally card, then once more as its books start to open: Ledgers.watch), never its dashboard, the longest frame %d ms (at most %d)" % (label, m["dr"][:4], longest, ADD_MS))
    card = pg.evaluate(CARD); pg.evaluate("() => render()"); pg.wait_for_timeout(400)
    ok(st["id"] and st["co"] == st["id"] and st["open"] == "company/cotally" and st["id"] in st["hash"] and "cotally" in st["hash"] and (name + " added") in st["toast"] and st["listed"] and card == pg.evaluate(CARD),
       "   the new client open on its Tally card (%s, %s), the toast %r, in the list, the card as a fresh drawing" % (st["open"], st["hash"], st["toast"][:60]))

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        n = pg.evaluate(MORE); pg.wait_for_timeout(1000)
        ok(seed["n"] > 50000 and n > 300, "large made-up books: %d entries, %d made-up clients" % (seed["n"], n))
        pg.evaluate(INSTR)
        GST = "() => { S.view = 'company'; S.coId = %r; S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }" % seed["cid"]
        add(pg, "ZZ Newly Added Client One", GST, "1. GST › Year, then Clients, Add and open")
        add(pg, "ZZ Newly Added Client Two", "() => FinComNav.go(() => navHome('today'))", "3. Today, then Clients, Add and open")
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
