"""python3 run_lazy_fail.py - a page's program file that does not load (16-Oct-2026: the owner's TDS page on Safari showed
"This page could not be loaded" with nothing in the console and nothing in Sentry). Now: the reason goes to the console
(and, being thrown, to Sentry's handler), FinCom reloads itself ONCE (a browser holding an older copy gets the new one),
and never loops. The React build (app/dist-test) or TDSDESK_SITE; the Books screens' file is blocked."""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("LAZY_FAIL_PORT") or 8361)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page()
        logs, navs, perr = [], [], []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
        pg.on("pageerror", lambda e: perr.append(str(e)[:200]))
        pg.on("framenavigated", lambda f: navs.append(f.url) if f == pg.main_frame else None)
        pg.route("**/assets/Books-*.js", lambda r: r.abort())
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(9000)
        said = [l for l in logs if "could not be loaded" in l]
        ok(len(said) >= 1 and said[0].startswith("error"), "the reason is written to the console (%s)" % (said[:1],))
        ok(len(perr) >= 1, "the error is thrown, so Sentry's handler sees it (%d)" % len(perr))
        ok(len(navs) == 2, "FinCom reloaded itself once, and only once (%d loads)" % len(navs))
        pg.wait_for_timeout(4000)
        ok(len(navs) == 2, "no reload loop after more seconds (%d loads)" % len(navs))
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
