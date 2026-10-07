"""python3 run_tally_slow_company.py - FinCom Bridge 2.3.2 (issue 232, the owner's requirement c of 07-Oct-2026): on a
large company Tally takes over 2 seconds to find one entry. The bridge then stops asking Tally for that company's entries
(the mark "entry fetch stopped: over 2 s", kept until a newer bridge is installed). Its beat carries the companies in
recorderBodyFetch, and tally-ingest keeps them on the bridge's own entry as recorderOff.bodies {company: {off, seconds, at,
why}} (cleanOffs, no cloud change). The Tally page says it on the computer's card in plain words, one line per company:
  "<company>: FinCom has stopped asking Tally for this company's entries, because finding one entry took Tally longer than
   2 seconds (since 07-Oct 10:05). New entries wait as held lines; upload that day's Day Book to settle them. This lifts
   when a faster FinCom Bridge is installed."
  - the owner and staff see the same line; there is nothing to press for it;
  - the time is the one the bridge wrote (its computer's clock), as "07-Oct 10:05";
  - an older bridge's recorderOff (2.2.x's 2-second switch-off, lifted by 2.3.1) is still never shown;
  - no line when the bridge names no company; no field names on the page.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_slow_company.py"""
import os, re, sys, threading, functools, http.server, copy
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
CO, CO2 = "IX DESIGNS PRIVATE LIMITED", "GARG SHEKHAR & COMPANY"
WHY = "finding one entry took Tally longer than 2 s: stopped 2 times, on 2 separate occasions while Tally answered other requests in time"
def line(co, since):
    return (co + ": FinCom has stopped asking Tally for this company's entries, because finding one entry took Tally longer than 2 seconds (since " + since +
            "). New entries wait as held lines; upload that day's Day Book to settle them. This lifts when a faster FinCom Bridge is installed.")
def devSlow(bodies=None, version="2.3.2"):
    d = dev(recording=True)
    b = d["info"]["bridges"]["go-1"]; bt = d["info"]["beat"]
    b["open"] = [CO, CO2]; bt["open"] = [CO, CO2]; b["version"] = version; d["version"] = version
    if bodies is not None: b["recorderOff"] = {"bodies": copy.deepcopy(bodies)}
    return d
ONE = {CO: {"off": True, "seconds": 2, "at": "2026-10-07T10:05:00+05:30", "why": WHY}}
TWO = {CO: {"off": True, "seconds": 2, "at": "2026-10-07T10:05:00+05:30", "why": WHY},
       "ZZ BIG TEST": {"off": True, "seconds": 2, "at": "2026-10-06T23:41:09+05:30", "why": WHY}}
OLD = {CO2: {"off": True, "seconds": 3.4, "at": "2026-10-05T12:14:00", "why": "Tally took 3.4 s for one entry"}}
srv = http.server.ThreadingHTTPServer(("localhost", 8367), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8367/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(devs, role):
        E(SETUP, [{"devs": devs, "alerts": [], "gap": None}, role])
        E("() => navHome('tally')"); pg.wait_for_timeout(1500)
        E("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); render(); }"); pg.wait_for_timeout(900)
    lines = lambda: E("() => [...document.querySelectorAll('#app [data-computer=\"%s\"] [data-slow-company]')].map(e => [e.getAttribute('data-slow-company'), e.innerText.trim()])" % D1)
    # ---- 1. a 2.3.2 bridge that stopped asking for one company: the line on the computer's card, in plain words
    scene([devSlow(ONE)], "owner")
    ls = lines()
    ok(ls == [[CO, line(CO, "07-Oct 10:05")]], "the owner sees the company's line on the computer's card (%s)" % ls)
    ok(pg.locator('#app [data-computer="%s"] [data-slow-companies] button' % D1).count() == 0, "nothing to press for it")
    page = pg.inner_text("#app")
    ok(not re.search(r"recorderOff|recorderBodyFetch|timesOver|lastMs|seconds:", page), "plain words: no field names on the page")
    # ---- 2. staff see the same
    scene([devSlow(ONE)], "member")
    ls = lines()
    ok(ls == [[CO, line(CO, "07-Oct 10:05")]], "staff see the same line (%s)" % ls)
    # ---- 3. two companies: one line each, in order
    scene([devSlow(TWO)], "owner")
    ls = lines()
    ok(ls == [[CO, line(CO, "07-Oct 10:05")], ["ZZ BIG TEST", line("ZZ BIG TEST", "06-Oct 23:41")]], "one line per company (%s)" % ls)
    # ---- 4. an older bridge's switch-off (2.2.x recorderOff, lifted by 2.3.1) is never shown
    for v in ("2.3.1", "2.2.4"):
        scene([devSlow(OLD, version=v)], "owner")
        ok(lines() == [] and "FinCom has stopped asking Tally" not in pg.inner_text("#app"), "a %s bridge's old switch-off is not shown" % v)
    # ---- 5. a 2.3.2 bridge naming no company: nothing
    scene([devSlow(None)], "owner")
    ok(lines() == [] and pg.locator('#app [data-slow-companies]').count() == 0, "no company named: no line")
    scene([devSlow({})], "owner")
    ok(lines() == [], "an empty list: no line")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
