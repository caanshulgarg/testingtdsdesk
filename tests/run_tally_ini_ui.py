"""python3 run_tally_ini_ui.py - FinCom Bridge 2.4.5 (ROUND 102, the owner's change of 21-Oct-2026): the installer adds
FinCom's add-on line to each TallyPrime's tally.ini; a tally.ini that says "User TDL = No" is left untouched (the owner's
default, decision pending) and REPORTED in the beat for Help & support. The Tally page's Help & support fold, under the
computer's card Details, says so in plain words:
  - "tally.ini <path> says User TDL = No, so FinCom left it untouched: ..." for state usertdl-no;
  - a line added, or already there, says nothing;
  - a beat without tallyIni (an older bridge): nothing, no error.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_ini_ui.py
RED (before the change): no [data-tally-ini] line on the page."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
from alerts_seed import D1, dev, SETUP
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
P_NO, P_ADD = r"C:\Program Files\TallyPrime\tally.ini", r"C:\Program Files\TallyPrime 6\tally.ini"
def devs(ini):
    d = dev(recording=True); b = d["info"]["bridges"]["go-1"]; bt = d["info"]["beat"]
    b["open"] = ["ZZ TEST"]; bt["open"] = ["ZZ TEST"]; b["version"] = "2.4.5"
    if ini is not None: bt["tallyIni"] = ini
    return [d]
srv = http.server.ThreadingHTTPServer(("localhost", 8364), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8364/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(ini, role="owner"):
        E(SETUP, [{"devs": devs(ini), "alerts": [], "gap": None}, role])
        E("() => { S.tallyMore = {page: true}; navHome('tally'); }"); pg.wait_for_timeout(1200)
        E("() => TCloud.refreshPane()"); pg.wait_for_timeout(1200)
        E("() => document.querySelectorAll('#app [data-computer] [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"); pg.wait_for_timeout(500)
    lines = lambda: E("() => [...document.querySelectorAll('#app [data-computer] [data-card-more] [data-tally-ini]')].map(e => ({state: e.getAttribute('data-tally-ini'), words: e.innerText.trim()}))")
    scene([{"path": P_NO, "state": "usertdl-no", "why": "User TDL = No", "at": "2026-10-21T10:00:00Z"}, {"path": P_ADD, "state": "added", "why": "", "at": "2026-10-21T10:00:00Z"}])
    ls = lines()
    ok(len(ls) == 1 and ls[0]["state"] == "usertdl-no", "one line, for the tally.ini that says User TDL = No (%s)" % ls)
    ok(ls and ls[0]["words"] == "tally.ini " + P_NO + " says User TDL = No, so FinCom left it untouched: Tally does not load FinCom's add-on when it starts.", "its words (%s)" % (ls and ls[0]["words"]))
    ok(P_ADD not in pg.inner_text("#app"), "a line added says nothing")
    ok(not re.search(r"usertdl|tallyIni", pg.inner_text("#app")), "plain words: no field names")
    scene([{"path": P_NO, "state": "usertdl-no"}], role="member")
    ok(len(lines()) == 1, "staff see the same line")
    scene(None)
    ok(lines() == [] and pg.locator('#app [data-computer="%s"] [data-status-line]' % D1).count() == 1, "an older bridge's beat: nothing, the card as before")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
