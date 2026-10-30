"""python3 run_prefetch_quiet.py - a screen's file fetched AHEAD (preloadScreens, src/screens/lazy.js) that does not come
is not the page failing (30-Oct-2026, Sentry FINCOM-APP-STAGING-1: Safari 26.6.2 on the Bank tab, release
fincom-app-e7d5733ce, chunk Books-CI64TVHg.js, unhandled, mechanism setTimeout; the file WAS on the site). The person
was on Bank; the Books file, fetched ahead in the background, failed on the line; FinCom treated that as the page's own
failure: it reloaded the Bank page by itself (the first time in the tab) and threw the error to Sentry (after that).
Now: a file fetched ahead that does not come leaves a breadcrumb only (category chunk, step "prefetch_failed"): no
reload, no error thrown, nothing said; the screen asks for its file again when it is opened, and only then the usual
heal runs (asked once more, one refresh, then "This page could not be loaded": run_lazy_fail.py, run_chunk_heal.py).
The React build (app/dist-test, or TDSDESK_SITE); the Books file is answered 503.
  TDSDESK_SITE=../app/dist-test python3 run_prefetch_quiet.py"""
import os, re, json, time, threading, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("PREFETCH_PORT") or 8395)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

BOOKS = [f for f in os.listdir(os.path.join(SITE, "assets")) if re.match(r"^Books-[\w-]+\.js$", f)][0]
HITS = {"books": 0}
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
    def translate_path(self, path):
        return os.path.join(SITE, path.split("?")[0].split("#")[0].lstrip("/") or "index.html")
    def do_GET(self):
        if self.path.split("?")[0].rsplit("/", 1)[-1] == BOOKS:
            HITS["books"] += 1; return self.send_error(503)
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H)
srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
INIT = """(() => { try { if (!localStorage.getItem("tdsdesk-test:cloud")) localStorage.setItem("tdsdesk-test:cloud", JSON.stringify({gate: false})); } catch (e) {} })()"""
STUB = """(() => { const log = window.__pfLog = [];
  const crumb = (category, step, data) => log.push({crumb: category, step, data});
  Object.defineProperty(window, "__fincomCrumb", {configurable: true, get: () => crumb, set: () => {}});
  Object.defineProperty(window, "__fincomTag", {configurable: true, get: () => () => {}, set: () => {}}); })()"""
GO_BOOKS = """() => { let c = Object.values(S.companies || {}).find(x => x.name === 'PREFETCH TEST CO');
  if (!c) { c = newCompany({name: 'PREFETCH TEST CO'}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  S.view = 'company'; S.coId = c.id; S.loadingCo = false; goClient('books:tds'); }"""
def ev(pg, x, d=None):
    try: return pg.evaluate(x)
    except Exception: return d
def signin(pg):
    if ev(pg, "() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"):
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1366, "height": 860}); ctx.add_init_script(INIT); ctx.add_init_script(STUB)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        loads = []; pg.on("load", lambda: loads.append(time.time()))
        pg.goto(URL); pg.wait_for_timeout(2500); signin(pg)
        # the first page (not Books); the screens' files are fetched ahead once it is drawn: wait for the Books asks
        t0 = time.time()
        while time.time() - t0 < 20 and HITS["books"] < 2: pg.wait_for_timeout(250)
        pg.wait_for_timeout(5000)                          # the retry, and any refresh or throw, would have come by now
        ok(HITS["books"] >= 1, "the Books file was fetched ahead and failed (%d asks)" % HITS["books"])
        ok(len(loads) == 1, "no reload of the page the person is on (%d loads)" % len(loads))
        ok(not [e for e in errors if re.search(r"module|page file not loaded", e, re.I)], "no error thrown for Sentry (%s)" % errors[:2])
        ok(not ev(pg, "!!document.querySelector('[data-stale-reload]')"), "nothing said ('FinCom is refreshing its files…' not shown)")
        steps = [x["step"] for x in (ev(pg, "window.__pfLog || []", []) or []) if x.get("crumb") == "chunk"]
        ok("prefetch_failed" in steps and "refresh" not in steps and "failed" not in steps, "a breadcrumb only: %s" % steps)
        ok(ev(pg, "sessionStorage.getItem('fincom:stale-reload')") in (None, ""), "the once-per-build refresh is still unspent")
        # the person opens Books: now it is the page's failure, and the usual heal runs (asked again, ONE refresh)
        asks0 = HITS["books"]; ev(pg, GO_BOOKS)
        t0 = time.time()
        while time.time() - t0 < 25 and len(loads) < 2: pg.wait_for_timeout(250)
        ok(HITS["books"] > asks0, "opening Books asks for its file again (%d -> %d)" % (asks0, HITS["books"]))
        ok(len(loads) == 2, "and then FinCom refreshes once, as before (%d loads)" % len(loads))
        br.close()
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
