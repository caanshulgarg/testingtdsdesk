"""python3 run_lazy_fail.py - a page's program file that does not load (16-Oct-2026: the owner's TDS page on Safari showed
"This page could not be loaded" with nothing in the console and nothing in Sentry). Now: the reason goes to the console
(and, being thrown, to Sentry's handler), FinCom reloads itself ONCE (a browser holding an older copy gets the new one),
and never loops. The React build (app/dist-test) or TDSDESK_SITE; the Books screens' file is blocked.
19-Oct-2026 (round 90): the loader first asks once more in the page (the same file with "?retry=…", src/screens/lazy.js),
so the block covers that ask too (a glob on "Books-*.js" let it through and the page healed); and the waits are
conditions (up to 30 s), not a fixed 9 s: the retry and the refresh (clean-up, then reload) take their time.
30-Oct-2026: the Books page is OPENED (on the first open and again after the refresh): a file only fetched ahead in the
background that does not come is not the page failing any more (run_prefetch_quiet.py)."""
import os, re, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("LAZY_FAIL_PORT") or 8361)
fails = []
INIT = """(() => { try { if (!localStorage.getItem("tdsdesk-test:cloud")) localStorage.setItem("tdsdesk-test:cloud", JSON.stringify({gate: false})); } catch (e) {} })()"""
GO_BOOKS = """() => { if (!(typeof S === 'object' && S && S.firm && typeof goClient === 'function' && document.querySelector('#app .react-host'))) return false;
  if (typeof signInNeeded === 'function' && signInNeeded()) { doAct('useOffline'); return false; }
  let c = Object.values(S.companies || {}).find(x => x.name === 'LAZY TEST CO');
  if (!c) { c = newCompany({name: 'LAZY TEST CO'}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  S.view = 'company'; S.coId = c.id; S.loadingCo = false; goClient('books:tds'); return true; }"""
def books(pg):
    try: return pg.evaluate(GO_BOOKS)
    except Exception: return False                         # the page is reloading
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(); ctx.add_init_script(INIT); pg = ctx.new_page()
        logs, navs, perr = [], [], []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
        pg.on("pageerror", lambda e: perr.append(str(e)[:200]))
        seq = []                                           # the order: Books asks and page loads
        pg.on("load", lambda: (navs.append(pg.url), seq.append("load")))   # page loads only (opening Books changes the address's #)
        pg.on("request", lambda r: seq.append("retry" if "retry=" in r.url else "ask") if re.search(r"/assets/Books-[^/?#]*\.js", r.url) else None)
        pg.route(re.compile(r"/assets/Books-[^/?#]*\.js(\?[^#]*)?$"), lambda r: r.abort())   # the file, and its ?retry= ask
        pg.goto("http://localhost:%d/" % PORT)
        t0 = time.time()                                   # Books opened, its retry, ONE reload, Books opened there, its retry, then thrown
        opened = 0
        while time.time() - t0 < 40 and not (len(navs) >= 2 and perr and any("could not be loaded" in l for l in logs)):
            if opened < len(navs) and books(pg): opened = len(navs)
            pg.wait_for_timeout(250)
        pg.wait_for_timeout(1000)
        said = [l for l in logs if "could not be loaded" in l]
        ok(len(said) >= 1 and said[0].startswith("error"), "the reason is written to the console (%s)" % (said[:1],))
        ok(len(perr) >= 1, "the error is thrown, so Sentry's handler sees it (%d)" % len(perr))
        first = seq[:seq.index("load", 1)] if seq.count("load") >= 2 else seq
        ok("ask" in first and "retry" in first and first.index("ask") < first.index("retry"), "asked once more in the page before the reload (%s)" % seq)
        ok(len(navs) == 2, "FinCom reloaded itself once, and only once (%d loads)" % len(navs))
        pg.wait_for_timeout(6000)
        ok(len(navs) == 2, "no reload loop after more seconds (%d loads)" % len(navs))
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
