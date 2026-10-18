"""python3 run_stale_chunk.py - a tab opened before a publish, asking for a screen's file (a lazy chunk) the publish
replaced (18-Oct-2026: Sentry FINCOM-APP-STAGING-1 "Importing a module script failed" x3 from the owner's browser right
after a publish; his Day Book upload then did nothing). FinCom reloads ONCE, saying "FinCom was updated; reloading…", and
the screen opens on the new build; a build whose screen files are gone for good reloads once and then says so, never a loop
(src/staleChunk.js: the guard is the build's id in sessionStorage).
How: the React test build (app/dist-test, or TDSDESK_SITE) served as it was ("old"); the screens' files the page has not
fetched yet are held. Then "the publish": a copy of the build in which every lazy chunk has a new name (as a new build's
hashes would) and a new build id; the held requests answer 404 (the old files are gone) and every later request is served
from the copy. Each file is sent with Cache-Control: no-store (as a publish's new index.html and entry are fetched fresh).
  TDSDESK_SITE=../app/dist-test python3 run_stale_chunk.py"""
import os, re, json, shutil, tempfile, threading, functools, http.server, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("STALE_PORT") or 8391)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# ---------------------------------------------------------------- the build, and "the publish"
index = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
ASSETS = os.path.join(SITE, "assets")
js = sorted(f for f in os.listdir(ASSETS) if f.endswith(".js"))
LAZY = [f for f in js if f not in index]                        # not named by index.html: fetched later (screens, parts)
SETTINGS = [f for f in LAZY if f.startswith("Settings-")]
old_build = json.load(open(os.path.join(SITE, "build.json")))["build"]
new_build = old_build[:-3] + ("aaa" if not old_build.endswith("aaa") else "bbb")
ok(len(LAZY) >= 8 and SETTINGS, "the build: %d of %d script files are lazy (fetched after the first page), Settings among them (%s)" % (len(LAZY), len(js), SETTINGS[:1]))
NEW = tempfile.mkdtemp(prefix="fincom-stale-")
shutil.copytree(SITE, NEW, dirs_exist_ok=True)
REN = {f: f[:-3] + "-p2.js" for f in LAZY}
for root, _, files in os.walk(NEW):
    for f in files:
        p = os.path.join(root, f)
        if not re.search(r"\.(js|html|json|css)$", f): continue
        t = open(p, encoding="utf-8", errors="surrogateescape").read(); t0 = t
        for a, b in REN.items(): t = t.replace(a, b)
        t = t.replace(old_build, new_build)
        if t != t0: open(p, "w", encoding="utf-8", errors="surrogateescape").write(t)
for a, b in REN.items(): os.rename(os.path.join(NEW, "assets", a), os.path.join(NEW, "assets", b))

ST = {"phase": "old", "gone": False, "served": [], "held": 0}
FLIP = threading.Event()
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
    def translate_path(self, path):
        root = NEW if ST["phase"] == "new" else SITE
        rel = path.split("?")[0].split("#")[0].lstrip("/")
        return os.path.join(root, rel or "index.html")
    def do_GET(self):
        name = self.path.split("?")[0].rsplit("/", 1)[-1]
        if ST["phase"] == "old" and name in LAZY:
            ST["held"] += 1
            FLIP.wait(60)                                    # held until the publish: then the old file is gone
            ST["served"].append((name, 404)); return self.send_error(404)
        if ST["gone"] and (name in LAZY or name in REN.values()):
            ST["served"].append((name, 404)); return self.send_error(404)
        ST["served"].append((name, 200 if os.path.isfile(self.translate_path(self.path)) else 404))
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H)
srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
INIT = """(() => { try { if (!localStorage.getItem("tdsdesk-test:cloud")) localStorage.setItem("tdsdesk-test:cloud", JSON.stringify({gate: false})); } catch (e) {} })()"""

def open_app(pg):
    pg.goto(URL); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    for _ in range(60):
        if pg.evaluate("typeof S === 'object' && !!S.firm && !!document.querySelector('#app .react-host')"): break
        pg.wait_for_timeout(250)

with sync_playwright() as p:
    br = p.chromium.launch()
    # ---- 1. the publish while the tab is open: one reload, then the screen opens on the new build
    ctx = br.new_context(viewport={"width": 1366, "height": 860}); ctx.add_init_script(INIT)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    loads = []; pg.on("load", lambda: loads.append(time.time()))
    open_app(pg)
    ok(ST["held"] >= 1, "the old build is open; its screens' files not fetched yet (%d asked for, held)" % ST["held"])
    pg.evaluate("() => navHome('rules')"); pg.wait_for_timeout(500)
    n0 = len(loads)
    ST["phase"] = "new"; FLIP.set()                        # the publish: the old lazy files are gone
    said = ""
    try: said = pg.wait_for_selector("[data-stale-reload]", timeout=5000).inner_text()
    except Exception as e: said = "(not shown: %s)" % str(e)[:80]
    ok(said == "FinCom was updated; reloading…", "said: %s" % said)
    for _ in range(80):
        if len(loads) > n0: break
        pg.wait_for_timeout(100)
    for _ in range(60):
        if pg.evaluate("typeof S === 'object' && !!S.firm && !!document.querySelector('#app .react-host')"): break
        pg.wait_for_timeout(250)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("() => { if (!(S.view === 'home' && S.homeTab === 'rules')) navHome('rules'); }")
    for _ in range(40):
        if pg.evaluate("!!document.querySelector('#app .react-host') && !document.querySelector('#app [data-lazy-failed]')") and any(n.startswith("Settings-") and n.endswith("-p2.js") and c == 200 for n, c in ST["served"]): break
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(3000)                              # nothing more comes
    ok(len(loads) - n0 == 1, "exactly one reload (%d)" % (len(loads) - n0))
    ok(pg.evaluate("sessionStorage.getItem('fincom:stale-reload')") == old_build, "the guard holds the build that reloaded (%s)" % pg.evaluate("sessionStorage.getItem('fincom:stale-reload')"))
    ok(any(n.startswith("Settings-") and n.endswith("-p2.js") and c == 200 for n, c in ST["served"]), "the new build's Settings file was fetched")
    ok(pg.evaluate("S.view === 'home' && S.homeTab === 'rules'") and not pg.locator("#app [data-lazy-failed]").count() and not pg.locator("[data-stale-reload]").count(),
       "the Settings screen opens on the new build: no 'could not be loaded', no reloading note")
    body = pg.inner_text("#app")
    ok(len(body) > 200 and "could not be loaded" not in body, "Settings drawn (%d characters)" % len(body))
    ctx.close()

    # ---- 2. a build whose screens' files are gone for good: one reload, then said, never a loop
    ST.update({"phase": "new", "gone": True, "served": []})
    ctx = br.new_context(viewport={"width": 1366, "height": 860}); ctx.add_init_script(INIT)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    loads = []; pg.on("load", lambda: loads.append(time.time()))
    open_app(pg)
    pg.evaluate("() => navHome('rules')")
    for _ in range(40):
        pg.wait_for_timeout(250)
        if pg.evaluate("!!document.querySelector('#app [data-lazy-failed]')"): break
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("() => { if (typeof navHome === 'function' && !(S.view === 'home' && S.homeTab === 'rules')) navHome('rules'); }")
    pg.wait_for_timeout(6000)
    ok(len(loads) == 2, "files gone for good: the first open and ONE reload, no more (%d loads)" % len(loads))
    ok(pg.locator("#app [data-lazy-failed]").count() >= 1, "then said: %s" % (pg.inner_text("#app [data-lazy-failed]") if pg.locator("#app [data-lazy-failed]").count() else "(nothing)"))
    ctx.close()
    # page errors: only the screen files' own failures (reported on purpose), nothing else
    other = [e for e in errors if not re.search(r"dynamically imported module|Importing a module script failed|page file not loaded|error loading dynamically", e)]
    ok(not other, "no other page errors %s" % other[:2])
    br.close()
srv.shutdown(); shutil.rmtree(NEW, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
