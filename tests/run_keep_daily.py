"""python3 run_keep_daily.py - bridge 1.14.6: through the working day nothing asks Tally by itself.
  - status checks (FinCom's page, the Connector) are answered without asking Tally;
  - the copier reads Tally only once a day at the set time, or when someone presses Update now; then it stops;
  - a check a person asks for (fresh=1) does ask Tally."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keepdaily")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, collections, glob, datetime
sys.path.insert(0, HERE)
import fake_tally
fake_tally.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
# the clock (CI 06-Oct-2026 ran this across midnight with the time at 23:59: the copier then ran by itself). The daily
# time is 12 hours from now, and today's update is noted as done before the bridge starts (the usual state through a
# working day): then the day's update is not due during the test whatever the hour - its time later today is hours
# away, or its time earlier today is done - nor just after a midnight (the update due then is the one already done)
AT = (datetime.datetime.now() + datetime.timedelta(hours=12)).strftime("%H:%M")
LASTRUN = _os.path.join(BRUN, "sync", "keep-lastrun.txt")
_os.makedirs(_os.path.dirname(LASTRUN), exist_ok=True)
open(LASTRUN, "w").write(datetime.date.today().strftime("%Y%m%d"))
_os.utime(LASTRUN, (time.time() - 86400, time.time() - 86400)); SEEDED = _os.path.getmtime(LASTRUN)
def dates_now():                                 # the date now and the day before: a run noted just before a midnight
    d = datetime.date.today(); return {d.strftime("%Y%m%d"), (d - datetime.timedelta(days=1)).strftime("%Y%m%d")}
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": AT, "KeepLightMin": -1, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepIdleMin": 1,
           "KeepFrom": "20260915", "KeepFakeOffice": False, "KeepRunMin": 5}, open(CFG, "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def call(path, body=None):
    key = json.load(open(CFG, encoding="utf-8-sig")).get("Key", "")
    rq = urllib.request.Request("http://127.0.0.1:9100" + path, data=json.dumps(body).encode() if body is not None else None,
                                headers={"X-Bridge-Key": key, "Origin": "https://staging.fincom.live", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(rq, timeout=60).read())
def logtext(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
def kinds(since): return collections.Counter(k for k, a, b in fake_tally.LOG[since:])
try:
    t = time.time()
    while time.time() - t < 60:
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: time.sleep(1)
    s0 = call("/status")                         # the first ever: nothing known yet, so Tally is asked once
    co = s0["sessions"][0]["companies"][0]["name"] if s0["sessions"] and s0["sessions"][0]["companies"] else ""
    ok(co, "the first check learns which company is open: " + co)
    time.sleep(3)
    n0 = len(fake_tally.LOG); t0 = time.time(); answers = []
    while time.time() - t0 < 75:                 # FinCom and the Connector checking, far more often than they do
        answers.append(call("/status")); call("/keep?company=" + urllib.parse.quote(co)); time.sleep(2)
    k = kinds(n0)
    print("   Tally was asked:", dict(k))
    ok(len(answers) > 20 and all(a.get("ok") and a["sessions"][0]["ok"] and a["sessions"][0]["companies"] for a in answers), "%d status checks answered, Tally shown as open with its company" % len(answers))
    ok(sum(k.values()) == 0, "and Tally was asked nothing at all in those 75 seconds (%d requests)" % sum(k.values()))
    ok("Update from Tally" not in logtext(), "the copier did not run: its time (%s) has not come" % AT)
    # a person asks: fresh=1 asks Tally
    n1 = len(fake_tally.LOG); call("/status?fresh=1")
    ok(kinds(n1)["TDSDeskCompanies"] == 1, "a check a person asks for does ask Tally (once)")
    # Update now
    n2 = len(fake_tally.LOG)
    ks = call("/keep?company=" + urllib.parse.quote(co), {"now": True})
    ok(ks.get("schedule") == "daily" and ks.get("dailyAt") == AT, "FinCom is told: once a day at %s (%s, %s)" % (AT, ks.get("schedule"), ks.get("dailyAt")))
    t = time.time()
    while time.time() - t < 300 and "Update from Tally: done" not in logtext(): time.sleep(2)
    ok("Update from Tally: done" in logtext(), "Update now: the copier ran and finished by itself")
    ok(kinds(n2)["DayBook"] + kinds(n2)["TDSDeskKeepList"] > 0, "it read Tally while it ran: " + str(dict(kinds(n2))))
    last = open(LASTRUN).read().strip() if _os.path.exists(LASTRUN) else ""
    # written again by this run (the note from before the start was given a time a day back), with the date of now or,
    # just after a midnight, the day before
    ok(last in dates_now() and _os.path.getmtime(LASTRUN) != SEEDED and not _os.path.exists(_os.path.join(BRUN, "sync", "keep-now.txt")), "today's run is noted, and the request cleared (%s)" % last)
    time.sleep(5); n3 = len(fake_tally.LOG); time.sleep(40)
    ok(sum(kinds(n3).values()) == 0, "after it, Tally is left alone (%d requests in 40 s)" % sum(kinds(n3).values()))
    ks = call("/keep?company=" + urllib.parse.quote(co))
    ok(not ks.get("running"), "and the copier is no longer running")
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
