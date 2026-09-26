"""python3 run_staging_ui.py - the test site works on the staging database: a browser that signed in to live before is
moved over (the live address and its sign-in are forgotten); the live build keeps the live database."""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8151), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LIVE, STAGING = "https://nrtczucrlgalvtojwoes.supabase.co", "https://qbocskaiewaxqcvaunzc.supabase.co"
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page()
    pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=401, body="{}"))
    pg.goto("http://localhost:8151/site-test/index.html"); pg.wait_for_timeout(1500)
    pg.evaluate("""(u) => { localStorage.setItem('tdsdesk-test:cloud', JSON.stringify({url: u, key: 'old', email: 'a@b.in'})); localStorage.setItem('tdsdesk-test:cloudsess', JSON.stringify({access_token: 'live-token'})); }""", LIVE)
    pg.reload(); pg.wait_for_timeout(2000)
    c = pg.evaluate("Cloud.cfg()")
    ok(c["url"] == STAGING and c["key"].startswith("sb_publishable_Q--"), "the test site uses the staging database: " + c["url"])
    ok(pg.evaluate("localStorage.getItem('tdsdesk-test:cloudsess')") is None and c.get("email") == "a@b.in", "a sign-in from live is forgotten (sign in again on staging); the email is kept")
    pg.goto("http://localhost:8151/site/index.html"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("Cloud.cfg().url") == LIVE and not pg.evaluate("!!CLOUD_DEFAULT.lock"), "the live build keeps the live database")
    br.close()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
