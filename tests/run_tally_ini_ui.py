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
def devs(ini, odt=None):
    d = dev(recording=True); b = d["info"]["bridges"]["go-1"]; bt = d["info"]["beat"]
    b["open"] = ["ZZ TEST"]; bt["open"] = ["ZZ TEST"]; b["version"] = "2.4.5"
    if ini is not None: bt["tallyIni"] = ini
    if odt is not None: bt["oldDaysTest"] = odt
    return [d]
srv = http.server.ThreadingHTTPServer(("localhost", 8364), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8364/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(ini, role="owner", odt=None, pf=False, missing=False, night=None):
        E(SETUP, [{"devs": devs(ini, odt), "alerts": [], "gap": None}, role])
        # ROUND 103 (1c): the computer's switch (tally_devices.period_fetch) as the cloud gives it; the owner's control call kept
        # ROUND 103 (evening): the computer's office hours (period_night_*), as the cloud gives them (none: the defaults)
        E("""([pf, missing, d1, night]) => { const api = Cloud.api; window.__pf = pf; window.__ctl = []; window.__night = night;
          Cloud.api = async (p) => { if (/^tally_devices\\?select=id,period_fetch/.test(p)) { if (missing) throw new Error('column tally_devices.period_fetch does not exist (42703)'); return [Object.assign({id: d1, period_fetch: window.__pf}, window.__night || {})]; } return api(p); };
          TCloud.control = async (fn, args, done) => { window.__ctl.push([fn, args]); if (fn === 'tally_device_period_fetch') window.__pf = !!args.p_on;
            if (fn === 'tally_device_period_night') window.__night = {period_night_from: args.p_from, period_night_to: args.p_to, period_night_sunday: args.p_sunday}; }; }""", [pf, missing, D1, night])
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
    # ROUND 103 (1c): reading older entries per computer: off by default; the owner switches it; staff see the state only
    pfl = lambda: E("() => { const e = document.querySelector('#app [data-computer] [data-card-more] [data-period-fetch]'); return e ? [e.getAttribute('data-period-fetch'), e.innerText.trim(), !!e.querySelector('[data-period-fetch-switch]')] : null; }")
    scene([], pf=False)
    v = pfl()
    ok(v and v[0] == "off" and v[1].startswith("Reading older entries on this computer: off") and v[2], "the owner: off, with Switch on (%s)" % v)
    pg.click('#app [data-period-fetch-switch]'); pg.wait_for_timeout(500)
    ok(E("window.__ctl") == [["tally_device_period_fetch", {"p_device": D1, "p_on": True}]], "Switch on: tally_device_period_fetch(p_on true) (%s)" % E("window.__ctl"))
    scene([], role="member", pf=True)
    v = pfl()
    ok(v and v[0] == "on" and not v[2], "staff: the state only, no button (%s)" % v)
    # ROUND 103 (the owner's decision of 21-Oct-2026, evening): the office hours, outside which the period is read faster
    nl = lambda: E("() => { const e = document.querySelector('#app [data-computer] [data-card-more] [data-period-night]'); return e ? [e.innerText.trim(), !!e.querySelector('[data-period-night-edit]')] : null; }")
    scene([], pf=True, night={"period_night_from": 20, "period_night_to": 8, "period_night_sunday": True})
    v = nl()
    ok(v and v[0].startswith("Faster reading of older entries outside office hours: 20:00 to 08:00 and all Sunday (India time)") and v[1], "the owner: the hours, with Change (%s)" % v)
    pg.click('#app [data-period-night-edit]'); pg.wait_for_timeout(300)
    pg.select_option('#app [data-period-night-from]', "21"); pg.select_option('#app [data-period-night-to]', "7"); pg.uncheck('#app [data-period-night-sunday]')
    pg.click('#app [data-period-night-save]'); pg.wait_for_timeout(600)
    ok(E("window.__ctl")[-1:] == [["tally_device_period_night", {"p_device": D1, "p_from": 21, "p_to": 7, "p_sunday": False}]], "Save: tally_device_period_night (%s)" % E("window.__ctl"))
    v = nl()
    ok(v and v[0].startswith("Faster reading of older entries outside office hours: 21:00 to 07:00 (India time)"), "the new hours shown (%s)" % v)
    scene([], pf=True)
    ok((nl() or [""])[0].startswith("Faster reading of older entries outside office hours: 20:00 to 08:00 and all Sunday"), "none kept yet: the defaults (%s)" % nl())
    scene([], role="member", pf=True, night={"period_night_from": 22, "period_night_to": 6, "period_night_sunday": False})
    v = nl()
    ok(v and "22:00 to 06:00" in v[0] and not v[1], "staff: the hours only, no Change (%s)" % v)
    scene([], pf=False)
    ok(nl() is None, "reading older entries off on the computer: no hours line")
    scene([], missing=True)
    ok(pfl() is None and nl() is None, "a cloud without the column: nothing of the switch")
    # ROUND 103 (1d): the tray's old-days test as the beat says it
    scene([], odt={"company": "ZZ TEST", "line": "0.21 s / 0.34 s / 0.18 s \u00b7 no freeze", "state": "done"})
    o = E("() => { const e = document.querySelector('#app [data-card-more] [data-old-days-test]'); return e ? [e.getAttribute('data-old-days-test'), e.innerText.trim()] : null; }")
    ok(o and o[0] == "ok" and o[1].startswith("Old-days test on ") and "0.21 s / 0.34 s / 0.18 s \u00b7 no freeze (ZZ TEST)" in o[1], "the old-days test line (%s)" % o)
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
