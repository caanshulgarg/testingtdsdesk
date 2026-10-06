"""python3 run_tally_entry_fetch_off.py - FinCom Bridge 2.3.1, the owner's last change (06-Oct-2026): "A slow or unanswered
request never switches reading off and never turns the entry fetch off for a company." The Tally page says it in plain
words and offers nothing to press:
  - a 2.3.1 bridge's beat carries tallyRetry {words, at, next, tries} (tally-ingest keeps it on the bridge's entry and the
    beat): the computer's line reads "Tally did not answer in time at 12:14; trying again by itself at 12:15", with no
    Resume button; the bell has one alert with the same words ("Nothing to do"), which goes by itself once the bridge no
    longer says it;
  - the old "switched off for <company> ... change 'Changes come from'" lines (2.2.0's recorderOff, still on an older
    bridge's entry) are never shown, on the page or in the bell;
  - a 2.3.0 bridge that stopped reading by itself is said in plain words (it reads again once 2.3.1 is on it), with no
    Resume button for anyone (the computer key's member included);
  - the owner's stop from FinCom is as before: Stopped from FinCom, and the owner's Resume reading.
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
WORDS = "Tally did not answer in time at 12:14; trying again by itself at 12:15"
OFF = {"bodies": {CO: {"off": True, "seconds": 3.4, "at": AT, "why": "Tally took 3.4 s for one entry"}},
       "B": {CO2: {"off": True, "seconds": 2.6, "at": AT, "why": "Tally took 2.6 s for its change list"}}}
def devOff(off=None, retry=False, self_stop=False, fincom=False):
    d = dev(recording=True)
    b = d["info"]["bridges"]["go-1"]; bt = d["info"]["beat"]
    b["open"] = [CO, CO2]; bt["open"] = [CO, CO2]; b["version"] = "2.3.1"
    if off: b["recorderOff"] = copy.deepcopy(off)
    if retry:
        r = {"words": WORDS, "at": AT, "next": AT, "tries": 2}
        b["tallyRetry"] = copy.deepcopy(r); bt["tallyRetry"] = copy.deepcopy(r)
    if self_stop:
        rs = {"by": "self", "reason": "Tally has not answered since 12:10 (over 2 minutes of requests not answered)", "at": AT}
        b["readStopped"] = copy.deepcopy(rs); bt["readStopped"] = copy.deepcopy(rs); b["version"] = "2.3.0"
    if fincom:
        rs = {"by": "fincom", "reason": "Stopped by the owner from FinCom", "at": AT}
        b["readStopped"] = copy.deepcopy(rs); bt["readStopped"] = copy.deepcopy(rs)
    return d
BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return null;
  if (!document.querySelector('[data-alerts-panel]')) b.click();
  const items = [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'), sev: e.getAttribute('data-sev'),
    text: (e.querySelector('[data-alert-text]') || {innerText: ''}).innerText.trim(), fix: (e.querySelector('[data-alert-fix]') || {innerText: ''}).innerText.trim(),
    details: (e.querySelector('[data-alert-details]') || {textContent: ''}).textContent.trim()}));
  return {count: (b.querySelector('[data-bell-count]') || {innerText: '0'}).innerText.trim(), items}; }"""
CLOSE = "() => { S.alertsOpen = false; render(); }"
srv = http.server.ThreadingHTTPServer(("localhost", 8361), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8361/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(devs, role, mine=False):
        E(SETUP, [{"devs": devs, "alerts": [], "gap": None}, role])
        if mine:  # the computer key is this member's own (2.3.0's self-Resume was offered to its maker)
            E("() => { const me = TCloud.me(); [window.__w.devs, TLight.st.devs, TCloud.pane.devices].forEach(l => (l || []).forEach(d => { d.created_by = me; })); }")
        E("() => navHome('tally')"); pg.wait_for_timeout(1500)
        E("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); render(); }"); pg.wait_for_timeout(900)
    readText = lambda: E("() => { const e = document.querySelector('#app [data-computer=\"%s\"] [data-read-text]'); return e ? e.innerText.trim() : null; }" % D1)
    resumes = lambda: pg.locator('#app [data-computer="%s"] [data-read-resume]' % D1).count()
    offLines = lambda: pg.locator('#app [data-recorder-off]').count()
    # ---- 1. a 2.3.1 bridge trying again by itself: plain words, nothing to press; an older entry's switch-offs never shown
    scene([devOff(OFF, retry=True)], "owner")
    ok(readText() == WORDS, "the computer's line: the bridge's own words (%s)" % readText())
    ok(resumes() == 0 and pg.locator('#app [data-computer="%s"] [data-read-stop]' % D1).count() == 1, "no Resume reading for it (the owner's Stop is still offered)")
    page = pg.inner_text("#app")
    ok(offLines() == 0 and "switched off" not in page and "Changes come from\" for this computer" not in page and "To switch it back on" not in page,
       "no 'switched off ... Changes come from' words, though the entry still carries 2.2.0's recorderOff")
    ok(not re.search(r"recorderBodyFetch|recorderSource|tallyRetry|seconds:", page), "plain words: no field names on the page")
    bl = E(BELL) or {"items": []}
    pc = [x for x in bl["items"] if x["key"] == "pc:" + D1]
    ok(len(pc) == 1 and pc[0]["text"].startswith(WORDS + ".") and pc[0]["fix"].startswith("Nothing to do") and pc[0]["sev"] == "warn", "the bell: one alert in the same words, nothing to do (%s)" % pc)
    ok(not [x for x in bl["items"] if x["key"].startswith("off:") or "switched off" in x["text"]], "the bell: nothing switched off (%s)" % [x["text"][:60] for x in bl["items"]])
    E(CLOSE)
    # ---- 2. the same for staff
    scene([devOff(OFF, retry=True)], "member", mine=True)
    ok(readText() == WORDS and resumes() == 0 and offLines() == 0, "staff: the same words, nothing to press (%s)" % readText())
    # ---- 3. Tally answers in time again: the words and the alert go by themselves
    scene([devOff(retry=True)], "owner")
    E("""() => { const strip = (d) => { delete d.info.bridges['go-1'].tallyRetry; delete d.info.beat.tallyRetry; return d; };
      window.__w.devs = window.__w.devs.map(strip); TLight.st.devs = TLight.st.devs.map(strip); TCloud.pane.devices = TCloud.pane.devices.map(strip);
      AlertHub.refresh(true); render(); }""")
    pg.wait_for_timeout(1500)
    ok(readText() == "Reading", "back to normal: Reading (%s)" % readText())
    bl = E(BELL) or {"items": []}
    ok(not [x for x in bl["items"] if x["key"] == "pc:" + D1], "and the bell's alert cleared itself (%s)" % [x["text"][:50] for x in bl["items"]])
    E(CLOSE)
    # ---- 4. a 2.3.0 bridge that stopped by itself: plain words, no Resume for anyone (2.3.1 clears that stop when it starts)
    scene([devOff(self_stop=True)], "member", mine=True)
    t = readText() or ""
    ok(t.startswith("Tally did not answer in time at ") and "FinCom Bridge 2.3.1" in t and "Stopped by itself" not in pg.inner_text("#app"), "a 2.3.0 self-stop in plain words (%s)" % t)
    ok(resumes() == 0, "no Resume reading for the computer key's member")
    scene([devOff(self_stop=True)], "owner")
    ok(resumes() == 0, "nor for the owner")
    bl = E(BELL) or {"items": []}
    pc = [x for x in bl["items"] if x["key"] == "pc:" + D1]
    ok(len(pc) == 1 and pc[0]["text"].startswith("Tally did not answer in time") and "stopped reading Tally by itself" not in pc[0]["text"], "the bell's words (%s)" % pc)
    E(CLOSE)
    # ---- 5. the owner's stop from FinCom: as before
    scene([devOff(fincom=True)], "owner")
    t = readText() or ""
    ok(t.startswith("Stopped from FinCom") and resumes() == 1, "FinCom's stop: Stopped from FinCom and the owner's Resume reading (%s, %d)" % (t, resumes()))
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
