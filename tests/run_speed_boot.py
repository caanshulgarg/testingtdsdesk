"""python3 run_speed_boot.py - next-speed-2 (the speed plan of 22-Nov-2026, #8 and #10), on the React build (app/dist-test, or
TDSDESK_SITE), made-up data only, the cloud never reached (every request to it refused):
  #10 the other screens' files (screens/lazy.js preloadScreens) are fetched only once someone is signed in: on the sign-in
      page none of them for 15 s (before: two at a time from the first second, on the same line as the sign-in); once a
      sign-in is there, they come as before;
  #8  a newer build named by build.json while the page is open: the calm bar "A new version of FinCom is ready" as
      before, and that build's first-page files (its program legacy.js?v=, the app's entry and styles) fetched quietly
      before Reload is pressed, one at a time, so Reload opens it from this computer; the page itself is not reloaded."""
import os, re, sys, json, time, shutil, tempfile, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("BOOT_PORT", "8741"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ROOT = tempfile.mkdtemp(prefix="fincom-boot-")
WEB = os.path.join(ROOT, "site"); shutil.copytree(SITE, WEB)
NEW = {"id": None}
page0 = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
entry = re.search(r'<script type="module" crossorigin src="\./(assets/index-[\w-]+\.js)"', page0).group(1)
css = re.search(r'<link rel="stylesheet" crossorigin href="\./(assets/index-[\w-]+\.css)"', page0).group(1)
# the newer build: the same files under new names (its page names them)
shutil.copy(os.path.join(WEB, entry), os.path.join(WEB, "assets/index-ZZNEW001.js"))
shutil.copy(os.path.join(WEB, css), os.path.join(WEB, "assets/index-ZZNEW001.css"))
seen = []
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        seen.append(self.path)
        if self.path.startswith("/build.json") and NEW["id"]:
            b = json.dumps({"build": NEW["id"]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        if NEW["id"] and re.match(r"^/(index\.html)?\?v=" + NEW["id"] + r"$", self.path):
            h = re.sub(r"legacy\.js\?v=\w+", "legacy.js?v=zznew0000001", page0).replace(entry, "assets/index-ZZNEW001.js").replace(css, "assets/index-ZZNEW001.css")
            h = re.sub(r"mw[a-z0-9]+-[0-9a-f]{6}", NEW["id"], h)
            b = h.encode(); self.send_response(200); self.send_header("Content-Type", "text/html"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(H, directory=WEB))
threading.Thread(target=srv.serve_forever, daemon=True).start()
screens = lambda: [p for p in seen if re.match(r"^/assets/(Settings|Tally|Books|Gst|TdsReturn|Bank|Clients|Help)-[\w-]+\.js", p)]
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context()
        ctx.route(re.compile(r"https://.*supabase\.co/.*"), lambda r: r.abort("connectionrefused"))
        ctx.route(re.compile(r"https://.*sentry\.io/.*"), lambda r: r.fulfill(status=200, body="{}"))
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        print("== #10 the other screens' files only once signed in")
        del seen[:]
        pg.goto("http://localhost:%d/" % PORT)
        pg.wait_for_selector('[data-act="cloudSignIn"]', timeout=60000)
        # (the first page counts as drawn after 10 s at most, main.jsx firstPage)
        pg.wait_for_timeout(15000)
        ok(not screens(), "10. the sign-in page: no other screen's file fetched in 15 s (%s)" % screens()[:4])
        # a sign-in comes (as Cloud.signIn keeps it): the screens' files follow
        pg.evaluate("() => localStorage.setItem('tdsdesk-test:cloudsess', JSON.stringify({access_token: 'zz-made-up', refresh_token: 'zz', at: Date.now(), expires_in: 3600, email: 'zz@zz.test', user_id: 'u-zz'}))")
        pg.wait_for_timeout(8000)
        ok(len(screens()) >= 2, "10. signed in: the screens' files come (%d)" % len(screens()))
        pg.evaluate("() => localStorage.removeItem('tdsdesk-test:cloudsess')")
        print("== #8 a newer build: its first files fetched before Reload")
        pg.goto("about:blank"); pg.goto("http://localhost:%d/" % PORT)
        pg.wait_for_selector('[data-act="cloudSignIn"]', timeout=60000); pg.wait_for_timeout(2000)
        pg.evaluate("() => { window.__same = 1; }")
        NEW["id"] = "mwzznew001-abcdef"; del seen[:]
        pg.wait_for_timeout(6000)
        pg.evaluate("() => window.dispatchEvent(new Event('focus'))")
        pg.wait_for_selector("[data-new-version]", timeout=15000)
        ok("A new version of FinCom is ready" in pg.inner_text("[data-new-version]"), "8. the calm bar, as before")
        t0 = time.time()
        want = ["/legacy.js?v=zznew0000001", "/assets/index-ZZNEW001.js", "/assets/index-ZZNEW001.css"]
        while time.time() - t0 < 15 and not all(w in seen for w in want): time.sleep(0.3)
        ok(all(w in seen for w in want), "8. the new build's program, entry and styles fetched before Reload (%s)" % [w for w in want if w not in seen])
        ok(pg.evaluate("() => window.__same === 1"), "8. the page itself not reloaded")
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(ROOT, ignore_errors=True)
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
