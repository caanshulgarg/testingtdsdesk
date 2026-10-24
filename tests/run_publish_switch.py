"""python3 run_publish_switch.py - 24-Oct-2026 (Sentry FINCOM-APP-STAGING-3 / -4 / -5, the owner's Mac Safari on
staging.fincom.live/review/, right after each publish: "FinCom did not open in 20 s", the last one "error loading script
legacy.js", stage "no program", the page the service worker's kept copy (kept: true, sw: true); after Safari was quit
it opened, after the next publish it failed again).
What happened: the worker (app/sw/sw.js) gave the kept page of the older build when the page itself took more than 4 s;
that page's build check (index.html) found the newer build and asked for it by ?v=<build>, and the worker waited for that
request with no end. When it hung, the old page stayed with its program held back (in Safari its scripts' loads were
also cancelled by the swap: "error loading script legacy.js"), until Safari was quit. And a legacy.js that did not come
was never asked again.
Two builds of the React test build: A (app/dist-test as it is) and B (a copy with a new build id and a new legacy.js), served
in turn from one address with GitHub Pages' headers (Cache-Control: max-age=600), the service worker on:
  1. a tab open on A with its worker; the server switched to B; the page's requests hang once (a request that never
     answers, as Safari's did): a new tab opens FinCom on build B within 20 s, never the older build's page;
  1b. the page asked for by its build (?v=B), that request hanging: B within 20 s;
  2. legacy.js does not come the first few times (the line drops): the page asks again past the worker and opens;
  3. legacy.js never comes: the page clears FinCom's kept files (worker and caches) and reloads ONCE, says
     "FinCom is refreshing its files…" on the way, then "FinCom did not open" with one button "Reload FinCom", and does
     not reload again by itself; the button does the clean-up and one reload.
Chromium only here (no WebKit on this machine).
  flock /tmp/fincom-app.lock python3 tests/run_publish_switch.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, re, sys, json, time, shutil, tempfile, threading, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("SWITCH_PORT") or 8377)
URL = "http://localhost:%d/" % PORT
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# ---------------------------------------------------------------- build A, and build B (the publish)
TMP = tempfile.mkdtemp(prefix="fincom-switch-")
A, B = os.path.join(TMP, "A"), os.path.join(TMP, "B")
shutil.copytree(SITE, A, ignore=shutil.ignore_patterns("*.map", "bridge-go"))
shutil.copytree(A, B)
IDA = json.load(open(os.path.join(A, "build.json")))["build"]
IDB = IDA[:-3] + ("bbb" if not IDA.endswith("bbb") else "ccc")
HA = re.search(r"legacy\.js\?v=([0-9a-f]{12})", open(os.path.join(A, "index.html")).read()).group(1)
HB = ("%012x" % (int(HA, 16) ^ 0xabcdef))[-12:]
# a new build's files have new names (their hashes)
REN = {f: re.sub(r"\.(js|css)$", r"Z.\1", f) for f in os.listdir(os.path.join(B, "assets")) if re.search(r"\.(js|css)$", f)}
for f, g in REN.items(): os.rename(os.path.join(B, "assets", f), os.path.join(B, "assets", g))
ORDER = sorted(REN, key=len, reverse=True)
for root, _d, files in os.walk(B):
    for f in files:
        if not re.search(r"\.(html|js|json)$", f): continue
        p = os.path.join(root, f); t = open(p, encoding="utf-8", errors="surrogateescape").read()
        u = t.replace(IDA, IDB).replace("legacy.js?v=" + HA, "legacy.js?v=" + HB)
        for f0 in ORDER:
            if f0 in u: u = u.replace(f0, REN[f0])
        if f == "legacy.js" and root == B: u = u + "\n;window.__zzLegacy='B';\n"
        if u != t: open(p, "w", encoding="utf-8", errors="surrogateescape").write(u)
with open(os.path.join(A, "legacy.js"), "a") as fh: fh.write("\n;window.__zzLegacy='A';\n")

# ---------------------------------------------------------------- the server (GitHub Pages' headers)
DIR = [A]
HANG = {"plain": 0, "v": 0}          # the next N requests for the page (plain / by its build) never answer (60 s)
SLOW = [0.0]
LEGACY_FAIL = [0]                    # the next N requests for legacy.js are dropped (-1: every one)
seen = []
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "max-age=600")
        super().end_headers()
    def do_GET(self):
        path, _, q = self.path.partition("?")
        seen.append(self.path)
        if path in ("/", "/index.html"):
            kind = "v" if re.search(r"(^|&)v=", q) else "plain"
            if HANG[kind] > 0:
                HANG[kind] -= 1; time.sleep(60); return
            if SLOW[0]: time.sleep(SLOW[0])
        if path == "/legacy.js" and LEGACY_FAIL[0]:
            if LEGACY_FAIL[0] > 0: LEGACY_FAIL[0] -= 1
            self.close_connection = True; return            # the line dropped: no answer at all
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), lambda *a, **k: H(*a, directory=DIR[0], **k)); srv.daemon_threads = True; srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()

INIT = ("try{localStorage.setItem('fincom.sw','on');if(!localStorage.getItem('tdsdesk-test:cloud'))localStorage.setItem('tdsdesk-test:cloud',JSON.stringify({gate:false}))}catch(e){}"
        # each document this tab loaded: its build and whether it was the worker's kept copy
        ";try{new MutationObserver(function(){var d=document.querySelector('[data-stale-reload]');if(d&&d.textContent){try{var o=sessionStorage.getItem('zz-said')||'';if(o.indexOf(d.textContent)<0)sessionStorage.setItem('zz-said',o+'|'+d.textContent)}catch(e){}}}).observe(document,{childList:true,subtree:true,characterData:true})}catch(e){}"
        ";document.addEventListener('DOMContentLoaded',function(){try{var t=(document.getElementById('fincom-boot')||{}).textContent||'';"
        "var b=t.indexOf(%r)>=0?'A':t.indexOf(%r)>=0?'B':'?';sessionStorage.setItem('zz-docs',(sessionStorage.getItem('zz-docs')||'')+' '+b+(document.documentElement.hasAttribute('data-boot-kept')?'(kept)':''))}catch(e){}})") % (IDA, IDB)
def build_of(pg):
    try: t = pg.evaluate("() => (document.getElementById('fincom-boot') || {}).textContent || ''")
    except Exception: return None
    return "A" if IDA in t else "B" if IDB in t else "?"
def drawn(pg, ms):
    try: pg.wait_for_function("() => !!document.querySelector('#app .react-host')", timeout=ms); return True
    except Exception: return False
def docs(pg):
    try: return (pg.evaluate("sessionStorage.getItem('zz-docs') || ''") or "").split()
    except Exception: return ["?"]
STUCK = "() => { const d = document.querySelector('[data-boot-stuck]'); return d ? d.innerText.replace(/\\s+/g, ' ') : ''; }"

def returning_browser(br):
    """a browser that has opened build A before: its worker installed and in charge, A's files kept"""
    DIR[0] = A; HANG.update(plain=0, v=0); SLOW[0] = 0; LEGACY_FAIL[0] = 0
    ctx = br.new_context(viewport={"width": 1280, "height": 760}); ctx.add_init_script(INIT)
    pg = ctx.new_page(); pg.goto(URL); drawn(pg, 30000)
    pg.evaluate("() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 20000))])")
    pg.wait_for_timeout(1500); pg.reload(); drawn(pg, 30000); pg.wait_for_timeout(5000)
    return ctx, pg

def open_new_tab(ctx, url=URL, within=20000):
    pg = ctx.new_page(); errs = []; loads = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # each load of the tab: a request for the page itself (a load cut short before it was read in full counts too)
    pg.on("request", lambda r: loads.append(r.url) if r.is_navigation_request() and r.frame == pg.main_frame else None)
    t0 = time.time()
    try: pg.goto(url, wait_until="commit", timeout=max(within, 1000) + 2000)
    except Exception: pass
    good = drawn(pg, max(100, within - int((time.time() - t0) * 1000)))
    return pg, good, round(time.time() - t0, 1), errs, loads

with sync_playwright() as p:
    br = p.chromium.launch()
    try:
        print("1. a publish while a tab is open on A; the page's request hangs once: a new tab opens B within 20 s")
        ctx, pgA = returning_browser(br)
        ok(pgA.evaluate("!!navigator.serviceWorker.controller") and build_of(pgA) == "A", "build A open, served by its worker (%s)" % build_of(pgA))
        DIR[0] = B; HANG.update(plain=1, v=1)
        pg, good, secs, errs, loads = open_new_tab(ctx)
        ok(good and build_of(pg) == "B", "the new tab: FinCom on build B within 20 s (%s, %s s, documents %s)" % (build_of(pg), secs, docs(pg)))
        ok(not any(d.startswith("A") for d in docs(pg)), "the older build's page was never given (documents %s)" % docs(pg))
        ok(not pg.evaluate(STUCK), "no \"FinCom did not open\" note")
        ok(pg.evaluate("window.__zzLegacy") == "B", "B's program runs (%s)" % pg.evaluate("window.__zzLegacy"))
        ctx.close()

        print("1b. the page asked for by its build (?v=B), that request hanging: B within 20 s")
        ctx, pgA = returning_browser(br)
        DIR[0] = B; HANG.update(v=1)
        pg, good, secs, errs, loads = open_new_tab(ctx, URL + "?v=" + IDB)
        ok(good and build_of(pg) == "B", "FinCom on build B within 20 s (%s, %s s, documents %s)" % (build_of(pg), secs, docs(pg)))
        ctx.close()

        print("2. legacy.js does not come the first times (the line drops): one refresh, and FinCom opens")
        for label, returning in (("a first open (no worker yet)", False), ("a returning browser after a publish (its worker in charge)", True)):
            if returning:
                ctx, _pgA = returning_browser(br); DIR[0] = B; LEGACY_FAIL[0] = 3   # the worker's two tries and the page's own
            else:
                DIR[0] = A; LEGACY_FAIL[0] = 2; ctx = br.new_context(); ctx.add_init_script(INIT)
            pg, good, secs, errs, loads = open_new_tab(ctx)
            pg.wait_for_timeout(1000)
            ok(good, label + ": FinCom opens within 20 s (%s s, loads %d, documents %s)" % (secs, len(loads), docs(pg)))
            ok(len(loads) <= 2, label + ": at most one refresh (%d loads)" % len(loads))
            ok(not pg.evaluate(STUCK), label + ": no \"FinCom did not open\" note")
            LEGACY_FAIL[0] = 0; ctx.close()

        print("3. legacy.js never comes: one clean-up and reload, then the note with \"Reload FinCom\"; no loop")
        ctx, _pgA = returning_browser(br)
        DIR[0] = B; LEGACY_FAIL[0] = -1
        pg, good, secs, errs, loads = open_new_tab(ctx, within=1)
        t0 = time.time()
        while time.time() - t0 < 15:
            try:
                if pg.evaluate(STUCK): break
            except Exception: pass
            pg.wait_for_timeout(100)
        said = [x for x in (pg.evaluate("sessionStorage.getItem('zz-said') || ''") or "").split("|") if x]
        note = pg.evaluate(STUCK)
        ok("FinCom did not open" in note, "the note comes, well before the 20 s watch (%s s): %r" % (round(time.time() - t0, 1), note[:60]))
        ok("FinCom is refreshing its files…" in said, "on the way: \"FinCom is refreshing its files…\" (%s)" % said)
        btns = pg.locator("[data-boot-stuck] button")
        ok(btns.count() == 1 and btns.first.inner_text().strip() == "Reload FinCom", "one button, \"Reload FinCom\" (%s)" % [btns.nth(i).inner_text() for i in range(btns.count())])
        ok(len(loads) == 2, "one clean-up reload by itself (%d loads)" % len(loads))
        ok(pg.evaluate("navigator.serviceWorker.getRegistrations().then((r) => r.length)") == 0, "FinCom's worker unregistered")
        ok(pg.evaluate("caches.keys().then((k) => k.filter((x) => x.startsWith('fincom-')).length)") == 0, "its caches deleted")
        pg.wait_for_timeout(8000)
        ok(len(loads) == 2, "no loop: still 2 loads 8 s later (%d)" % len(loads))
        btns.first.click(); pg.wait_for_timeout(5000)
        ok(len(loads) == 3, "the button: one reload (%d loads)" % len(loads))
        pg.wait_for_timeout(5000)
        ok(len(loads) == 3 and "FinCom did not open" in pg.evaluate(STUCK), "and the note again, no loop (%d loads)" % len(loads))
        LEGACY_FAIL[0] = 0
        pg.locator("[data-boot-stuck] button").first.click(); pg.wait_for_timeout(1500)
        ok(drawn(pg, 20000) and build_of(pg) == "B", "the line back: the button opens FinCom on B")
        ctx.close()
    finally:
        br.close(); srv.shutdown(); shutil.rmtree(TMP, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
