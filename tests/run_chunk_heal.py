"""python3 run_chunk_heal.py - a screen's file (a lazy chunk) that does not come, on the CURRENT build (round 90, 19-Oct-2026:
Sentry FINCOM-APP-STAGING-1, the owner's Mac, Safari 26.6.2, release fincom-app-006adb4da, route client/books: "This page
could not be loaded (Importing a module script failed.). Reload FinCom", again after every reload). FinCom heals itself:
  (i)   the service worker holds a broken copy (a 404 page) of the Books file -> the books page opens by itself (one
        reload at most); the worker (app/sw/sw.js) never serves a broken kept copy, keeps only real script/style/font
        answers, and retries a file once when the line drops;
  (ii)  the Books file fails every time -> FinCom tries again in the page, refreshes its files ONCE ("FinCom is refreshing
        its files…"), then says so with "Reload FinCom" and "Open without saved files"; never a loop;
  (iii) the Books file fails at its own address, a fresh ask comes (a passing failure, or the browser keeping the failure)
        -> healed in the page by the loader's "?retry=" ask, no reload;
  (iv)  each failure leaves a Sentry breadcrumb (category chunk) and the tag chunk = the file's name (Sentry stubbed).
How: the React test build (app/dist-test, or TDSDESK_SITE) served with Cache-Control: no-store; the Books file's answers
are set per scene (503, the line dropped, or served); the service worker is turned on for localhost (fincom.sw = on).
  TDSDESK_SITE=../app/dist-test python3 run_chunk_heal.py"""
import os, re, json, threading, http.server, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("HEAL_PORT") or 8393)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

ASSETS = os.path.join(SITE, "assets")
BOOKS = [f for f in os.listdir(ASSETS) if re.match(r"^Books-[\w-]+\.js$", f)][0]
GST = [f for f in os.listdir(ASSETS) if re.match(r"^Gst-[\w-]+\.js$", f)][0]
ok(bool(BOOKS and GST), "the build: the Books file is %s" % BOOKS)

# per file: "fail" (503 every time), "once" (503 the first time), "plain" (503 at its own address, served when asked with
# "?retry="), "drop" (the line dropped the first time), None (served)
ST = {"mode": {}, "hits": {}, "served": []}
FAKE = "fake-Abc123.js"                                     # answered 200 text/html (as a site's "not found" page would be)
DROPS = int(os.environ.get("HEAL_DROPS") or 1)                 # the line dropped this many times in a row
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
    def translate_path(self, path):
        rel = path.split("?")[0].split("#")[0].lstrip("/")
        return os.path.join(SITE, rel or "index.html")
    def do_GET(self):
        name = self.path.split("?")[0].rsplit("/", 1)[-1]
        n = ST["hits"][name] = ST["hits"].get(name, 0) + 1
        m = ST["mode"].get(name)
        if name == FAKE:
            b = b"<!doctype html><title>Not here</title>"; self.send_response(200); self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        if m == "fail" or (m == "once" and n == 1) or (m == "plain" and "retry=" not in self.path):
            ST["served"].append((self.path, 503)); return self.send_error(503)
        if m == "drop" and n <= DROPS:
            ST["served"].append((self.path, 0)); self.close_connection = True; return
        ST["served"].append((self.path, 200))
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H)
srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
INIT = """(() => { try { if (!localStorage.getItem("tdsdesk-test:cloud")) localStorage.setItem("tdsdesk-test:cloud", JSON.stringify({gate: false})); } catch (e) {} })()"""
SW_ON = """(() => { try { localStorage.setItem("fincom.sw", "on"); } catch (e) {} })()"""
# Sentry stubbed: the breadcrumbs and tags FinCom hands to Sentry reach the test (and survive a reload)
NOTE = """(() => { const look = () => { const n = document.querySelector('[data-stale-reload]'); if (n && n.textContent) { try { sessionStorage.setItem('heal:note', n.textContent); } catch (e) {} } };
  new MutationObserver(look).observe(document, {childList: true, subtree: true, characterData: true}); })()"""
# 19-Oct-2026: each call is also kept in the page (window.__healLog), read straight by the test: in CI the binding's calls
# (the page -> the test, delivered later) could still be on their way when (iii) looked, and the list read empty
STUB = """(() => {
  const log = window.__healLog = [];
  const sink = (x) => { try { log.push(x); } catch (e) {} try { if (typeof window.__healSink === "function") window.__healSink(JSON.stringify(x)); } catch (e) {} };
  const crumb = (category, step, data) => sink({crumb: category, step, data});
  const tag = (k, v) => sink({tag: k, value: v});
  Object.defineProperty(window, "__fincomCrumb", {configurable: true, get: () => crumb, set: () => {}});
  Object.defineProperty(window, "__fincomTag", {configurable: true, get: () => tag, set: () => {}});
})()"""
GO_BOOKS = """() => { let c = Object.values(S.companies || {}).find(x => x.name === 'HEAL TEST CO');
  if (!c) { c = newCompany({name: 'HEAL TEST CO'}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  S.view = 'company'; S.coId = c.id; S.loadingCo = false; goClient('books:tds'); }"""
# the TDS page of a client without books yet: its words are in the Books file
BOOKS_OPEN = """() => { const h = document.querySelector('#app'); return !!h && !h.querySelector('[data-lazy-failed]') && /TDS is worked out from the day book/.test(h.innerText); }"""

def ready(pg, t=60):
    for _ in range(t):
        try:
            if pg.evaluate("typeof S === 'object' && !!S.firm && !!document.querySelector('#app .react-host')"): return True
        except Exception: pass
        pg.wait_for_timeout(250)
    return False
def open_app(pg, first=True):
    if first: pg.goto(URL)
    pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    ready(pg)
def books(pg):
    try: pg.evaluate(GO_BOOKS)
    except Exception: return False
    for _ in range(40):
        try:
            if pg.evaluate(BOOKS_OPEN) or pg.locator("[data-lazy-failed]").count(): break
        except Exception: pass
        pg.wait_for_timeout(250)
    try: return pg.evaluate(BOOKS_OPEN)
    except Exception: return False
def settle(pg, loads, ms=6000):
    """wait until no load came for ms (a reload by itself shows as a new load)"""
    t0 = time.time()
    while time.time() - t0 < 25:
        pg.wait_for_timeout(500)
        if (time.time() - max(t0, loads[-1] if loads else 0)) * 1000 > ms: break

def scene(br, sw=False):
    ctx = br.new_context(viewport={"width": 1366, "height": 860}); ctx.add_init_script(INIT); ctx.add_init_script(STUB); ctx.add_init_script(NOTE)
    if sw: ctx.add_init_script(SW_ON)
    sink = []
    ctx.expose_function("__healSink", lambda s: sink.append(json.loads(s)))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    loads = []; pg.on("load", lambda: loads.append(time.time()))
    said = []
    pg.on("console", lambda m: None)
    return ctx, pg, loads, sink

with sync_playwright() as p:
    br = p.chromium.launch()

    # ---- (i) the service worker holds a broken copy of the Books file
    print("(i) the service worker holds a broken copy (404 page) of the Books file")
    ST.update({"mode": {}, "hits": {}, "served": []})
    ctx, pg, loads, sink = scene(br, sw=True)
    open_app(pg)
    for _ in range(60):
        if pg.evaluate("!!(navigator.serviceWorker && navigator.serviceWorker.controller)"): break
        pg.wait_for_timeout(250)
    ctl = pg.evaluate("!!(navigator.serviceWorker && navigator.serviceWorker.controller)")
    ok(ctl, "the service worker runs the page")
    # the worker's own rules, asked straight
    ST["mode"][GST] = "drop"; ST["hits"][GST] = 0          # (asked with ?line=drop: not a kept copy, the line's answer)
    r = pg.evaluate("""async ([f, fake]) => {
      const out = {};
      try { const a = await fetch('./assets/' + fake); out.fake = a.status; } catch (e) { out.fake = 'error'; }
      await new Promise((ok) => setTimeout(ok, 400));
      out.fakeKept = !!(await caches.match(new URL('./assets/' + fake, location.href).href, {ignoreVary: true}));
      try { const g = await fetch('./assets/' + f + '?line=drop', {cache: 'no-store'}); out.drop = g.status; } catch (e) { out.drop = 'error: ' + e.message; }
      return out; }""", [GST, FAKE])
    ok(r["fake"] == 200 and not r["fakeKept"], "an answer that is not a script (200 text/html) is not kept by the worker (%s)" % r)
    ok(r["drop"] == 200, "the line dropped for a file: the worker asks again (past the browser's cache) and the file comes (%s; %d asks)" % (r["drop"], ST["hits"].get(GST, 0)))
    ST["mode"].pop(GST, None)
    # the broken copy, in every one of FinCom's caches
    planted = pg.evaluate("""async (f) => { const u = new URL('./assets/' + f, location.href).href;
      let ks = (await caches.keys()).filter(k => k.startsWith('fincom-'));
      if (!ks.length) ks = ['fincom-files:' + new URL('./', location.href).pathname];
      for (const k of ks) { const c = await caches.open(k); await c.put(u, new Response('<!doctype html>Not found', {status: 404, headers: {'Content-Type': 'text/html'}})); }
      const hit = await caches.match(u, {ignoreVary: true}); return {ks, status: hit && hit.status}; }""", BOOKS)
    ok(planted["status"] == 404, "a broken copy (404) of %s is in %s" % (BOOKS, planted["ks"]))
    st = pg.evaluate("async (f) => { try { const a = await fetch('./assets/' + f); return a.status; } catch (e) { return 'error'; } }", BOOKS)
    ok(st == 200, "the worker does not serve the broken copy: the file comes from the line (%s)" % st)
    pg.evaluate("""async (f) => { const u = new URL('./assets/' + f, location.href).href;   /* planted again (the line's copy may have replaced one) */
      for (const k of (await caches.keys()).filter(k => k.startsWith('fincom-'))) { const c = await caches.open(k); await c.put(u, new Response('Not found', {status: 404, headers: {'Content-Type': 'text/html'}})); } }""", BOOKS)
    n0 = len(loads)
    pg.reload(); open_app(pg, first=False)
    opened = books(pg); settle(pg, loads)
    if not pg.evaluate(BOOKS_OPEN): open_app(pg, first=False); opened = books(pg)
    ok(opened, "the books page opens by itself%s" % ("" if opened else ": " + (pg.inner_text("[data-lazy-failed]") if pg.locator("[data-lazy-failed]").count() else "(not drawn)")))
    ok(len(loads) - n0 <= 2, "one reload at most besides ours (%d loads)" % (len(loads) - n0))
    ctx.close()

    # ---- (ii) the Books file fails every time: refreshed once, then said with two ways out; never a loop
    print("(ii) the Books file fails every time")
    ST.update({"mode": {BOOKS: "fail"}, "hits": {}, "served": []})
    ctx, pg, loads, sink = scene(br)
    pg.goto(URL)
    note = ""
    for _ in range(150):
        try: note = pg.evaluate("sessionStorage.getItem('heal:note') || ''")
        except Exception: note = ""
        if note: break
        pg.wait_for_timeout(100)
    ok(note == "FinCom is refreshing its files…", "said while refreshing: %s" % note)
    settle(pg, loads); open_app(pg, first=False)
    books(pg); settle(pg, loads, 4000)
    ok(len(loads) == 2, "the first open and ONE refresh by itself (%d loads)" % len(loads))
    ok(pg.evaluate("sessionStorage.getItem('fincom:stale-reload')") not in (None, ""), "the guard holds this build")
    msg = pg.inner_text("[data-lazy-failed]") if pg.locator("[data-lazy-failed]").count() else "(nothing)"
    ok("This page could not be loaded" in msg, "then said: %s" % msg[:160])
    b1 = pg.locator("[data-lazy-failed] button", has_text="Reload FinCom").count()
    b2 = pg.locator("[data-lazy-failed] button", has_text="Open without saved files").count()
    ok(b1 == 1 and b2 == 1, "with 'Reload FinCom' and 'Open without saved files' (%d, %d)" % (b1, b2))
    hits0 = ST["hits"].get(BOOKS, 0)
    ok(hits0 >= 2 and hits0 <= 6, "the Books file asked for again in the page before each reload (%d asks)" % hits0)
    n0 = len(loads)
    if b2: pg.locator("[data-lazy-failed] button", has_text="Open without saved files").click()
    settle(pg, loads, 5000); open_app(pg, first=False); books(pg); settle(pg, loads, 5000)
    ok(len(loads) - n0 == 1, "'Open without saved files' reloads once, then no more (%d)" % (len(loads) - n0))
    ok(pg.locator("[data-lazy-failed]").count() >= 1, "and says so again (no loop)")
    crumbs = [x for x in sink if x.get("crumb") == "chunk"]
    tags = [x for x in sink if x.get("tag") == "chunk"]
    # (iv) the Sentry breadcrumb and tag carry the file's name
    print("(iv) Sentry: the breadcrumb and tag carry the file's name")
    ok(any((c.get("data") or {}).get("file") == BOOKS for c in crumbs), "a breadcrumb (category chunk) names %s: %s" % (BOOKS, [(c["step"], (c.get("data") or {}).get("file")) for c in crumbs][:6]))
    ok(any(t.get("value") == BOOKS for t in tags), "the tag chunk = %s (%s)" % (BOOKS, [t.get("value") for t in tags][:3]))
    steps = [c["step"] for c in crumbs]
    ok("retry" in steps and "refresh" in steps and "failed" in steps, "the steps: tried again, refreshed, then said (%s)" % steps)
    ctx.close()

    # ---- (iii) the Books file fails once: healed in the page, no reload
    # 19-Oct-2026: "plain", not "once": with "once", which of the page's asks for the file (Vite's modulepreload of it, or
    # the import) took the one failure was a race; in CI the list of breadcrumbs read empty though the file was asked
    # twice (the failure not the import's, or the crumbs still on their way). Now the import fails whatever the order,
    # only the retry comes, and the breadcrumb is waited for (the page's own log, up to 15 s)
    print("(iii) the Books file fails at its address; the retry comes")
    ST.update({"mode": {BOOKS: "plain"}, "hits": {}, "served": []})
    ctx, pg, loads, sink = scene(br)
    open_app(pg)
    opened = books(pg); settle(pg, loads, 4000)
    ok(opened, "the books page opens")
    ok(len(loads) == 1, "healed in the page: no reload (%d loads)" % len(loads))
    asks = [(s, c) for s, c in ST["served"] if s.split("?")[0].endswith("/" + BOOKS)]
    plain = [c for s, c in asks if "retry=" not in s]; retry = [c for s, c in asks if "retry=" in s]
    ok(plain and all(c == 503 for c in plain) and retry == [200], "the Books file: failed at its address (%s), asked again once in the page (%s)" % (plain, retry))
    # waited for (up to 15 s), not read once: from the page's own log, else what the binding has delivered
    def healed_crumbs():
        try: got = pg.evaluate("JSON.stringify(window.__healLog || [])")
        except Exception: got = "[]"
        cs = [x for x in json.loads(got) if x.get("crumb") == "chunk"]
        cs = cs if len(cs) >= len([x for x in sink if x.get("crumb") == "chunk"]) else [x for x in sink if x.get("crumb") == "chunk"]
        return cs
    crumbs = healed_crumbs()
    for _ in range(60):
        if any(c["step"] == "healed" and (c.get("data") or {}).get("file") == BOOKS for c in crumbs): break
        pg.wait_for_timeout(250); crumbs = healed_crumbs()
    ok(any(c["step"] == "healed" and (c.get("data") or {}).get("file") == BOOKS for c in crumbs), "breadcrumb: healed %s (%s)" % (BOOKS, [c["step"] for c in crumbs]))
    ctx.close()

    other = [e for e in errors if not re.search(r"dynamically imported module|Importing a module script failed|page file not loaded|error loading dynamically", e)]
    ok(not other, "no other page errors %s" % other[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
