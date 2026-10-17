"""python3 run_fresh_publish.py A_DIR B_DIR - a newly published FinCom shows by itself (owner, 17-Oct-2026: he had to press
Ctrl+Shift+R to see a new build on staging.fincom.live/review/; his browser kept the old one).
Two React test builds (app/dist-test built twice, copied to A_DIR and B_DIR) are served in turn from the same address, with
the headers GitHub Pages sends (every file kept by the browser for 10 minutes), and the service worker on
(localStorage fincom.sw = "on"):
  1. a tab open on build A, A swapped for B on the server: within about a minute, with nothing done in the tab (no
     focus, no tab change), the calm bar "A new version of FinCom is ready · Reload" shows; nothing reloads by itself
     while the page is in use; its Reload brings build B;
  2. the same on the tab's return (focus / shown again): the bar within a few seconds;
  3. a returning browser (its service worker and its kept copy of A) opening FinCom after the swap, on a slow line
     where the page takes longer than the worker's 4 s wait: B is on screen after that one open, no hard reload.
  flock /tmp/fincom-app.lock python3 tests/run_fresh_publish.py /path/to/buildA /path/to/buildB"""
import os, sys, json, time, threading, http.server, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
A, B = sys.argv[1], sys.argv[2]
IDA, IDB = (json.load(open(os.path.join(d, "build.json")))["build"] for d in (A, B))
PORT = int(os.environ.get("FRESH_PORT") or 8371)
URL = "http://localhost:%d/" % PORT
DIR = [A]
SLOW = [0.0]     # seconds the page itself (index.html) takes: a slow line
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "max-age=600")      # what GitHub Pages sends for every file
        super().end_headers()
    def do_GET(self):
        p = self.path.split("?")[0]
        if SLOW[0] and (p == "/" or p.endswith(".html")): time.sleep(SLOW[0])
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), lambda *a, **k: H(*a, directory=DIR[0], **k))
threading.Thread(target=srv.serve_forever, daemon=True).start()

def build_of(pg):
    try:
        t = pg.evaluate("() => (document.getElementById('fincom-boot') || {}).textContent || ''")
    except Exception: return None
    return "A" if IDA in t else "B" if IDB in t else "?"
def drawn(pg, t=20):
    try: pg.wait_for_function("() => !!document.querySelector('#app .react-host')", timeout=t * 1000); return True
    except Exception: return False
BAR = "() => { const d = document.querySelector('[data-new-version]'); return d && d.getClientRects().length ? d.innerText.replace(/\\s+/g, ' ').trim() : null; }"

def returning_browser(br):
    """a browser that has opened build A before: its worker installed, the page served by it, A in its caches"""
    DIR[0] = A
    ctx = br.new_context(viewport={"width": 1280, "height": 760})
    ctx.add_init_script("try{localStorage.setItem('fincom.sw','on');if(!localStorage.getItem('tdsdesk-test:cloud'))localStorage.setItem('tdsdesk-test:cloud',JSON.stringify({gate:false}))}catch(e){}")
    # which build's app was drawn on each load of this tab (an old build drawn, then swapped, is a page that jumps)
    ctx.add_init_script("""(() => { const mo = new MutationObserver(() => { if (!document.querySelector('#app .react-host')) return; mo.disconnect();
      const t = (document.getElementById('fincom-boot') || {}).textContent || ''; const m = [%r, %r].find((x) => t.includes(x));
      try { sessionStorage.setItem('zz-drawn', (sessionStorage.getItem('zz-drawn') || '') + ' ' + (m || '?')); } catch (e) {} });
      document.addEventListener('DOMContentLoaded', () => mo.observe(document.getElementById('app') || document.body, {childList: true, subtree: true})); })()""" % (IDA, IDB))
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); drawn(pg)
    pg.evaluate("() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 20000))])")
    pg.wait_for_timeout(1500); pg.reload(); drawn(pg); pg.wait_for_timeout(6000)   # the page's own worker check (4 s after it is drawn) is over
    return ctx, pg, errs

with sync_playwright() as p:
    br = p.chromium.launch()
    try:
        print("1. an open tab, a new publish: the bar within about a minute, Reload brings it")
        ctx, pg, errs = returning_browser(br)
        ok(pg.evaluate("!!navigator.serviceWorker.controller") and build_of(pg) == "A", "build A open, served by its service worker (%s)" % build_of(pg))
        navs = []; pg.on("domcontentloaded", lambda _p: navs.append(pg.url))
        box = pg.evaluate("() => { const i = document.createElement('input'); i.id = 'zz-typing'; document.querySelector('#app').prepend(i); i.focus(); return true; }")
        pg.keyboard.type("half typed")
        DIR[0] = B; t0 = time.time(); seen = None
        while time.time() - t0 < 75:
            if pg.evaluate(BAR): seen = time.time() - t0; break
            pg.wait_for_timeout(1000)
        text = pg.evaluate(BAR) or ""
        ok(seen is not None, "the bar shows within about a minute of the publish, nothing done in the tab (%s s)" % (None if seen is None else round(seen)))
        ok(text.startswith("A new version of FinCom is ready") and "Reload" in text, "it says “A new version of FinCom is ready · Reload” (%r)" % text)
        ok(not navs and pg.evaluate("document.getElementById('zz-typing') && document.getElementById('zz-typing').value") == "half typed", "no reload by itself while someone types (what was typed stays)")
        if seen is not None:
            pg.click("[data-new-version] [data-new-version-go]")
            pg.wait_for_timeout(1500); drawn(pg); pg.wait_for_timeout(1500)
            ok(build_of(pg) == "B", "Reload brings build B (%s)" % build_of(pg))
        ok(not errs, "no page errors (%s)" % errs[:2])
        ctx.close()

        print("2. the tab comes back (focus): the bar within a few seconds")
        ctx, pg, errs = returning_browser(br)
        DIR[0] = B
        pg.evaluate("() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }")
        try: pg.wait_for_function(BAR, timeout=6000); s = True
        except Exception: s = False
        ok(s, "on the tab's return the bar shows (%r)" % pg.evaluate(BAR))
        ctx.close()

        print("3. a returning browser opens FinCom after the publish, on a slow line: B, without a hard reload")
        ctx, pg, errs = returning_browser(br)
        ok(build_of(pg) == "A", "build A opened here before (%s)" % build_of(pg))
        pg.evaluate("sessionStorage.removeItem('zz-drawn')"); pg.goto("about:blank")
        DIR[0] = B; SLOW[0] = 5.0
        navs = []; pg.on("domcontentloaded", lambda _p: navs.append(pg.url))
        pg.goto(URL, wait_until="commit"); pg.wait_for_timeout(16000); drawn(pg); pg.wait_for_timeout(1000)
        SLOW[0] = 0
        ok(build_of(pg) == "B", "one open after the publish shows build B (%s; page loads %s)" % (build_of(pg), navs))
        loads = navs
        drew = pg.evaluate("sessionStorage.getItem('zz-drawn') || ''")
        ok(IDA not in drew, "the old build's app is never drawn on that open (drawn: %s)" % drew.strip())
        ok(len(loads) <= 2, "at most one quiet swap before the program loads (%s)" % loads)
        ok(not pg.evaluate(BAR), "and no bar on it (it is the newest)")
        ctx.close()

        print("4. a returning browser on a good line: B on the first open")
        ctx, pg, errs = returning_browser(br)
        pg.goto("about:blank"); DIR[0] = B
        pg.goto(URL); drawn(pg); pg.wait_for_timeout(2500)
        ok(build_of(pg) == "B", "build B (%s)" % build_of(pg))
        ctx.close()
    finally:
        br.close(); srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
