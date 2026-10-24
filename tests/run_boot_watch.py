"""python3 run_boot_watch.py - 24-Oct-2026 (Sentry FINCOM-APP-STAGING-3 / -4, "FinCom did not open in 20 s", Mac Safari,
/review/, also after the build was rolled back; the first one on 23-Oct from a guest's computer, the morning after calls
stage 1). The "FinCom did not open" note (public/oldcheck.js) looks only for the frame drawn before the program
(data-boot-part). The guest's page of a meeting (#/join, #/join/<code>, #join=<token>: src/calls/guest.jsx) is drawn in
place of FinCom and never removed that frame, so 20 s into every guest's page the note came up over the meeting and
the testing site reported the page as stuck, though it had opened.
  1. the join page, a meeting's link and an older guest link (not signed in): the guest's page is drawn, the frame is
     gone and no "did not open" note comes, nothing is reported;
  2. FinCom itself (the sign-in page): opens, no note;
  3. a page that really does not open (the program's script never comes): the note still comes, and says so.
The note's 20 s are shortened to 2.5 s here.
  flock /tmp/fincom-app.lock python3 tests/run_boot_watch.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("BOOT_WATCH_PORT") or 8592)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SHORT = ("(() => { const st = window.setTimeout; window.setTimeout = function (f, t) { const a = [].slice.call(arguments);"
         " if (t === 20000) a[1] = 2500; return st.apply(this, a); }; })()")
LOOK = """() => ({parts: document.querySelectorAll('[data-boot-part]').length, stuck: !!document.querySelector('[data-boot-stuck]'),
  guest: !!document.getElementById('fincom-guest'), signin: !!document.querySelector('.signin:not(.boot-signin), [data-signin]'), stage: window.__fincomStage || '',
  note: (document.querySelector('[data-boot-stuck]') || {}).textContent || ''})"""
with sync_playwright() as p:
    br = p.chromium.launch()
    def open_(h, block_legacy=False):
        pg = br.new_page(); errs = []; sent = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=401, body="{}"))
        pg.route("**/*.sentry.io/**", lambda r: (sent.append(r.request.post_data or ""), r.fulfill(status=200, body="{}")))
        if block_legacy: pg.route("**/legacy.js*", lambda r: r.abort())
        pg.add_init_script(SHORT)
        pg.goto("http://localhost:%d/%s" % (PORT, h)); pg.wait_for_timeout(4500)
        r = pg.evaluate(LOOK); pg.close()
        return r, errs, sent
    print("== 1. the guest's pages")
    for h, what in [("#/join", "the join page"), ("#/join/abc-defg-hjk", "a meeting's link"), ("#join=" + "a" * 43, "an older guest link")]:
        r, errs, _ = open_(h)
        ok(r["guest"], what + ": the guest's page is drawn")
        ok(r["parts"] == 0, what + ": the frame drawn before the program is gone (%d left)" % r["parts"])
        ok(not r["stuck"], what + ": no \"FinCom did not open\" note")
        ok(not errs, what + ": no page errors " + str(errs[:2]))
    print("== 2. FinCom itself")
    r, errs, _ = open_("")
    ok(r["parts"] == 0 and not r["stuck"] and not r["guest"], "the sign-in page opens, no note " + str(r))
    ok(not errs, "no page errors " + str(errs[:2]))
    ok(r["stage"] == "drawn", "the opening's last step is noted for a report (window.__fincomStage): " + r["stage"])
    print("== 3. a page that does not open")
    r, _, _ = open_("", block_legacy=True)
    ok(r["stuck"], "the program's script never came: the note still comes " + str(r["parts"]))
    ok("error loading script legacy.js" in r["note"], "and names the file that did not load: " + r["note"][-60:])
    br.close()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
