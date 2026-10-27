"""python3 run_open_speed.py - the owner's target of 27-Oct-2026: "under 1 second". Measured on the built site, served
gzipped with the site's cache rules (the build's hashed files kept a year, the page and legacy.js asked again), the
service worker on (as on the site), a fast line (50 Mbit/s, 20 ms) and this machine's CPU (CPU=4: four times slower),
a client of 4,000 entries (ENTRIES=…):
  1. a first-ever open (nothing kept): the first screen drawn by the program and usable (the sign-in page; then the app
     without an account);
  2. a repeat open (the browser has opened this build before, the worker holds its files): the app's first page;
  3. page changes inside a client with its books in (Overview, Purchase, Bank, TDS, GST, Sales, MIS, back to Purchase):
     from the click to the page drawn with no "Loading" shape left;
Prints each time against 1 s; fails only past the CAP of each (a regression guard, not the target).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_open_speed.py"""
import os, sys, gzip, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8439
CAP = {"first": 4000, "repeat": 2500, "switch": 2500}
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
GZ = (".js", ".css", ".html", ".json", ".svg", ".txt")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        p = self.path.split("?")[0]
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if "/assets/" in p else "no-cache")
        super().end_headers()
    def do_GET(self):
        p = self.path.split("?")[0]
        full = self.translate_path(p if not p.endswith("/") else p + "index.html")
        if os.path.isfile(full) and full.endswith(GZ) and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(open(full, "rb").read(), 6)
            self.send_response(200); self.send_header("Content-Type", self.guess_type(full)); self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()

SEED = """(books) => { S.firm.firmName = "Garg Shekhar & Company";
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tan = "DELZ12345A"; S.companies[c.id] = c; c.stats = {};
  const d = S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  const b = Object.assign({loading: false, challans: [], alloc: {}}, books, {cid: c.id}); S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books);
  window.__bk = S.books; refreshStats(c.id); render(); return c.id; }"""
# from the call to the page drawn: two frames in a row with no page shape (".pg-skel") and no "Loading" state
SWITCH = """(js) => new Promise((done) => { const t0 = performance.now(); new Function(js)(); let calm = 0;
  const look = () => { const busy = document.querySelector('#app .pg-skel, #app [data-page-skeleton], #app .lt-loading');
    calm = busy ? 0 : calm + 1; if (calm >= 2 || performance.now() - t0 > 15000) done(Math.round(performance.now() - t0)); else requestAnimationFrame(look); };
  requestAnimationFrame(look); })"""
DRAWN = "() => typeof S === 'object' && !document.querySelector('[data-boot-part]') && !!document.querySelector('#app .react-host, #app button[data-act=useOffline]')"

CPU = float(os.environ.get("CPU", "1"))       # CPU=4: a slower laptop (Chrome's CPU slow-down, 4 times)
def line(ctx, pg):
    cdp = ctx.new_cdp_session(pg); cdp.send("Network.enable")
    if CPU > 1: cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU})
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 20, "downloadThroughput": 50e6 / 8, "uploadThroughput": 20e6 / 8})

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = "http://localhost:%d/" % PORT
    books = json.load(open(CACHE))
    # a client of a real size (staging's prefetch: 4,119 entries): the made-up year copied ENTRIES / 77 times
    base, n = books["vouchers"], int(os.environ.get("ENTRIES", "4000"))
    books["vouchers"] = [dict(v, id=v["id"] + "-%d" % k, no=str(v.get("no", "")) + ("/%d" % k if k else "")) for k in range(max(1, n // max(1, len(base)))) for v in base]
    res = {}
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_init_script("try { localStorage.setItem('fincom.sw', 'on'); } catch (e) {}")
        pg = ctx.new_page(); line(ctx, pg)
        # 1. first-ever open
        pg.goto(url, wait_until="commit")
        pg.wait_for_function(DRAWN, timeout=60000, polling="raf")
        res["first"] = pg.evaluate("() => Math.round(performance.now())")
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
        pg.wait_for_function("() => !!document.querySelector('#app .react-host')", timeout=30000)
        pg.wait_for_timeout(12000)          # idle: the worker installed, the other files kept
        # 2. repeat opens (three; the median)
        rep = []
        for _ in range(3):
            pg.goto(url, wait_until="commit")
            pg.wait_for_function(DRAWN, timeout=60000, polling="raf")
            rep.append(pg.evaluate("() => Math.round(performance.now())"))
            pg.wait_for_timeout(3000)
        res["repeat"] = sorted(rep)[1]
        sw = pg.evaluate("() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)")
        # 3. page changes inside a client
        pg.evaluate(SEED, books); pg.wait_for_timeout(2500)
        sw_times = {}
        for name, to in [("Overview", "dash"), ("Purchase", "bills"), ("Bank", "bank"), ("TDS", "books:tds"), ("GST", "books:gst"), ("Sales", "sales"), ("MIS", "books:mis"), ("Purchase again", "bills"), ("TDS again", "books:tds")]:
            sw_times[name] = pg.evaluate(SWITCH, "S.view = 'company'; S.books = window.__bk; goClient(%s);" % json.dumps(to))
            pg.wait_for_timeout(700)
        br.close()
    srv.shutdown()
    print("  (CPU slowed %gx; 50 Mbit/s, 20 ms; the worker in charge on the repeat opens: %s; %d entries in the books)" % (CPU, sw, len(books.get("vouchers") or [])))
    print("  first-ever open, the first screen drawn: %d ms %s" % (res["first"], "<= 1 s" if res["first"] <= 1000 else "OVER 1 s"))
    print("  repeat open, the app's first page: %d ms %s (each: %s)" % (res["repeat"], "<= 1 s" if res["repeat"] <= 1000 else "OVER 1 s", rep))
    for n, t in sw_times.items(): print("  page change, %s: %d ms %s" % (n, t, "<= 1 s" if t <= 1000 else "OVER 1 s"))
    ok(res["first"] <= CAP["first"], "first open within %d ms" % CAP["first"])
    ok(res["repeat"] <= CAP["repeat"], "repeat open within %d ms" % CAP["repeat"])
    ok(max(sw_times.values()) <= CAP["switch"], "every page change within %d ms" % CAP["switch"])
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
