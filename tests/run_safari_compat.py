"""17-Oct-2026 (owner: Mac Safari stuck on "Opening FinCom"). Safari before 16.4 refuses a whole script that holds a regex
look-behind, so nothing started. Checks, on the React build (app/dist-test or TDSDESK_SITE):
1. no built .js file (legacy.js, every chunk) holds a look-behind (?<= / (?<! ;
2. guard.js adds the newer helpers Safari 14-15.3 lacks, and the built code is written down to Safari 14 (no `??=`, `||=`,
   class static blocks, `#x in`);
3. the app opens with those helpers removed before anything loads (as on Safari 15);
4. when the program fails to load, "FinCom did not open" with Reload shows instead of the frame for ever;
5. a browser below the floor is told plainly (update Safari / use Chrome) instead of a blank page."""
import os, re, sys, glob, threading, functools, http.server
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8000 + (os.getpid() % 900)
fails = []
def ok(c, w):
    print(("ok   " if c else "FAIL ") + w)
    if not c: fails.append(w)

files = [f for f in glob.glob(os.path.join(SITE, "**", "*.js"), recursive=True) if "/bridge-go/" not in f]
ok(len(files) > 3, "built scripts found (%d)" % len(files))
for f in files:
    s = open(f, encoding="utf8", errors="replace").read()
    rel = os.path.relpath(f, SITE)
    ok("(?<=" not in s and "(?<!" not in s, "%s: no regex look-behind" % rel)
    if rel in ("guard.js", "oldcheck.js"): continue
    for pat, what in ((r"\?\?=", "??="), (r"\|\|=", "||="), (r"&&=", "&&="), (r"\bstatic\s*\{", "class static block")):
        ok(not re.search(pat, s), "%s: no %s (Safari 14 cannot read it)" % (rel, what))
g = open(os.path.join(SITE, "guard.js"), encoding="utf8").read()
for k in ('"at"', '"findLast"', '"toSorted"', '"toReversed"', '"toSpliced"', '"hasOwn"', "structuredClone"):
    ok(k in g, "guard.js adds %s where missing" % k)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
OLD = """for (const [o, k] of [[Array.prototype,'at'],[String.prototype,'at'],[Array.prototype,'findLast'],[Array.prototype,'findLastIndex'],
  [Array.prototype,'toSorted'],[Array.prototype,'toReversed'],[Array.prototype,'toSpliced'],[Array.prototype,'with'],[Object,'hasOwn']]) { try { delete o[k]; } catch (e) {} }
try { delete window.structuredClone; } catch (e) {} window.__errs = []; addEventListener('error', e => window.__errs.push(String(e.message)));"""
with sync_playwright() as p:
    b = p.chromium.launch()
    # 3. Safari-15-like: the helpers removed; the app still opens (the sign-in page or the app, not the frame)
    pg = b.new_page(); pg.add_init_script(OLD)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(5000)
    ok(pg.locator("[data-boot-part]").count() == 0, "without the newer helpers the app still opens (frame gone)")
    ok(pg.evaluate("[].at && [].toSorted && typeof structuredClone === 'function'") is True, "guard.js put the helpers back")
    errs = pg.evaluate("window.__errs")
    ok(not errs, "no script error on open without the helpers %s" % (errs[:3] if errs else ""))
    pg.close()
    # 4. the program fails to load: the note shows after 20 s
    pg = b.new_page(); pg.route(re.compile(r".*/legacy\.js.*"), lambda r: r.fulfill(status=200, content_type="text/javascript", body="var x = /(?<=a/ ;"))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(3000)
    ok(pg.locator("[data-boot-stuck]").count() == 0, "no note while it may still be loading")
    pg.wait_for_timeout(19000)
    note = pg.locator("[data-boot-stuck]")
    ok(note.count() == 1 and "FinCom did not open" in note.inner_text() and "Reload" in note.inner_text(), "the program did not start: 'FinCom did not open' with Reload shows")
    ok(note.count() == 1 and "Chrome" in note.inner_text(), "the note names the way out (update / Chrome)")
    pg.close()
    # 5. below the floor: told plainly
    pg = b.new_page(); pg.add_init_script("delete Promise.allSettled;")
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    t = pg.inner_text("body")
    ok("isn't supported" in t and "update Safari" in t, "an older browser is told: update Safari or use Chrome")
    pg.close()
    b.close()
srv.shutdown()
print("FAILED: %d" % len(fails) if fails else "ALL OK")
sys.exit(1 if fails else 0)
