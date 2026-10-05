"""python3 run_tally_entry_fetch_off.py - the owner's condition 4 (05-Oct-2026): the Tally page shows when FinCom Bridge's
2-second rule has switched the entry fetch off for a company on a computer, with the time Tally took and how to switch it
back on. The bridge (2.2.0) sends recorderBodyFetch / recorderSourceB / recorderSourceC in its heartbeat; tally-ingest
keeps them on the bridge's entry as info.bridges[id].recorderOff {bodies, B, C} (run_main_bridge_server.py checks that).
Checked here, offline with FinCom's cloud made up in the page:
  - per computer, one line per company switched off: "Entry fetch switched off for <company>: Tally took 3.4 s at 14:05
    IST (limit 2 s). To switch it back on: ..." (Tally's change list and month slices the same, with their own names);
  - the owner is told to change "Changes come from" to another choice, wait one minute and set it back; staff are told
    the owner does that; no button (words only);
  - nothing when nothing is off;
  - the bell: one alert per switched-off company, once; it clears itself when the bridge no longer says it.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_entry_fetch_off.py"""
import os, re, sys, threading, functools, http.server, datetime, copy
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
ist = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
AT = ist.strftime("%Y-%m-%dT%H:%M:%S")      # the bridge's local time (IST), no zone
HM = ist.strftime("%H:%M") + " IST"
CO, CO2 = "GARG SHEKHAR & COMPANY", "ZZ TEST"
OFF = {"bodies": {CO: {"off": True, "seconds": 3.4, "at": AT, "why": "Tally took 3.4 s for one entry"}},
       "B": {CO2: {"off": True, "seconds": 2.6, "at": AT, "why": "Tally took 2.6 s for its change list"}},
       "C": {CO2: {"off": True, "seconds": 5.0, "at": AT, "why": "Tally took 5 s for a month"}}}
def devOff(off):
    d = dev(recording=True)
    d["info"]["bridges"]["go-1"]["open"] = [CO, CO2]; d["info"]["beat"]["open"] = [CO, CO2]
    if off: d["info"]["bridges"]["go-1"]["recorderOff"] = copy.deepcopy(off)
    return d
BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return null;
  if (!document.querySelector('[data-alerts-panel]')) b.click();
  const items = [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'), sev: e.getAttribute('data-sev'),
    text: (e.querySelector('[data-alert-text]') || {innerText: ''}).innerText.trim(), fix: (e.querySelector('[data-alert-fix]') || {innerText: ''}).innerText.trim(),
    details: (e.querySelector('[data-alert-details]') || {textContent: ''}).textContent.trim()}));
  return {count: (b.querySelector('[data-bell-count]') || {innerText: '0'}).innerText.trim(), items}; }"""
CLOSE = "() => { S.alertsOpen = false; render(); }"
OWNER_WORDS = 'To switch it back on: change "Changes come from" for this computer to another choice, wait one minute, then set it back.'
STAFF_WORDS = 'To switch it back on: the owner changes "Changes come from" for this computer to another choice, waits one minute, then sets it back.'
srv = http.server.ThreadingHTTPServer(("localhost", 8361), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8361/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(devs, role):
        E(SETUP, [{"devs": devs, "alerts": [], "gap": None}, role]); E("() => navHome('tally')"); pg.wait_for_timeout(1500)
        E("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); }"); pg.wait_for_timeout(900)
    lines = lambda: E("() => [...document.querySelectorAll('#app [data-computer] [data-recorder-off]')].map(e => ({kind: e.getAttribute('data-off-kind'), co: e.getAttribute('data-off-co'), text: e.innerText.replace(/\\s+/g, ' ').trim(), btn: e.querySelectorAll('button').length}))")
    # ---- 1. the owner: one line per company switched off, per method
    scene([devOff(OFF)], "owner")
    L = lines(); body = [x for x in L if x["kind"] == "bodies"]
    t = body[0]["text"] if body else ""
    ok(len(body) == 1 and t.startswith("Entry fetch switched off for %s: Tally took 3.4 s at %s (limit 2 s)." % (CO, HM)),
       "the line: company, seconds, the time in IST and the limit (%s)" % t)
    ok(OWNER_WORDS in t and body[0]["btn"] == 0, "the owner: change 'Changes come from', wait a minute, set it back; words only, no button (%s)" % t)
    b = [x for x in L if x["kind"] == "B"]; c = [x for x in L if x["kind"] == "C"]
    ok(len(b) == 1 and b[0]["text"].startswith("Tally's change list switched off for %s: Tally took 2.6 s at %s (limit 2 s)." % (CO2, HM)), "Tally's change list, its own plain name (%s)" % (b[0]["text"] if b else L))
    ok(len(c) == 1 and c[0]["text"].startswith("Month slices switched off for %s: Tally took 5 s at %s (limit 2 s)." % (CO2, HM)), "month slices, its own plain name (%s)" % (c[0]["text"] if c else L))
    ok(len(L) == 3, "one line per company and method, nothing more (%d)" % len(L))
    ok(not re.search(r"recorderBodyFetch|recorderSource|bodies|seconds:", pg.inner_text("#app")), "plain words: no field names on the page")
    # ---- 2. the bell: one alert per switched-off company, once
    bl = E(BELL) or {"items": []}
    offs = [x for x in bl["items"] if x["key"].startswith("off:")]
    ok(len(offs) == 3 and len({x["key"] for x in offs}) == 3, "the bell: one alert per switched-off company and method (%s)" % [x["text"] for x in offs])
    g = [x for x in offs if CO in x["text"]]
    g = g[0] if g else {"text": "", "fix": "", "sev": "", "details": ""}
    ok(any(x["text"].startswith("FinCom's reading of Tally's change list is switched off for ZZ TEST") for x in offs) and any(x["text"].startswith("FinCom's reading by month slices is switched off for ZZ TEST") for x in offs),
       "the bell's words for Tally's change list and month slices (%s)" % [x["text"] for x in offs])
    ok(g["text"].startswith("FinCom's entry fetch is switched off for %s" % CO) and "3.4 s" in g["text"] and "2 s" in g["text"] and "Changes come from" in g["fix"] and g["sev"] == "warn",
       "its words: what, how long Tally took, the limit; the fix: 'Changes come from' (%s | %s)" % (g["text"], g["fix"]))
    ok("NWS144" in g["details"] and "NWS144" not in g["text"], "the computer behind details (%s)" % g["details"])
    E(CLOSE)
    E("() => { AlertHub.refresh(true); render(); }"); pg.wait_for_timeout(1200)
    bl = E(BELL) or {"items": []}
    ok(len([x for x in bl["items"] if x["key"].startswith("off:")]) == 3, "read again: still one each, not repeated")
    E(CLOSE)
    # ---- 3. staff: the same line, the owner does it
    scene([devOff(OFF)], "member")
    L = lines(); body = [x for x in L if x["kind"] == "bodies"]
    t = body[0]["text"] if body else ""
    ok(len(body) == 1 and t.startswith("Entry fetch switched off for %s: Tally took 3.4 s at %s (limit 2 s)." % (CO, HM)) and STAFF_WORDS in t and OWNER_WORDS not in t and body[0]["btn"] == 0,
       "staff: the same line; the owner changes 'Changes come from' (%s)" % t)
    # ---- 4. the bridge no longer says it: the line and the alert go by themselves
    scene([devOff(OFF)], "owner")
    E("""() => { const strip = (d) => { delete d.info.bridges['go-1'].recorderOff; return d; };
      window.__w.devs = window.__w.devs.map(strip); TLight.st.devs = TLight.st.devs.map(strip); TCloud.pane.devices = TCloud.pane.devices.map(strip);
      AlertHub.refresh(true); render(); }""")
    pg.wait_for_timeout(1500)
    ok(pg.locator('#app [data-computer="%s"]' % D1).count() == 1 and len(lines()) == 0, "the entry gone from the beat: no line (%s)" % lines())
    bl = E(BELL) or {"items": []}
    ok(not [x for x in bl["items"] if x["key"].startswith("off:")], "and the bell's alert cleared itself (%s)" % [x["text"][:50] for x in bl["items"]])
    E(CLOSE)
    # ---- 5. nothing off (an older bridge): nothing shown
    scene([devOff(None)], "owner")
    ok(pg.locator('#app [data-computer="%s"]' % D1).count() == 1 and len(lines()) == 0 and "switched off" not in pg.inner_text("#app"), "nothing off: the computer's line, nothing switched off shown")
    bl = E(BELL) or {"items": []}
    ok(not [x for x in bl["items"] if x["key"].startswith("off:")], "and nothing in the bell")
    E(CLOSE)
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
