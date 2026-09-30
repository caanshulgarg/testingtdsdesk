"""python3 run_keep_round.py - bridge 1.14.4, step 3 of the Tally plan: the daily update brings only what changed
(entries with a higher change number), and compares every month's list of entries with Tally's once a day, so an
entry deleted in an old month is found even when Tally's change counter does not move. What it finds reaches the cloud."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keepround")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, re, glob, collections
sys.path.insert(0, HERE)
import fake_tally, fake_cloud
fake_tally.start(); fake_cloud.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": "23:59", "KeepLightMin": -1, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30,
           "KeepIdleMin": 1, "KeepFrom": "20260101", "KeepFakeOffice": False, "KeepRunMin": 15, "KeepSharePct": 100, "KeepNightSharePct": 100,
           "CloudLinksSec": 5, "CloudStateSec": 5}, open(CFG, "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(fn, secs=180, step=1.0):
    t = time.time()
    while time.time() - t < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None
CO = fake_tally.COMPANY
def call(path, body=None):
    key = json.load(open(CFG, encoding="utf-8-sig")).get("Key", "")
    rq = urllib.request.Request("http://127.0.0.1:9100" + path, data=json.dumps(body).encode() if body is not None else None,
                                headers={"X-Bridge-Key": key, "Origin": "https://staging.fincom.live", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(rq, timeout=60).read())
def log(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
def sdir(): return [d for d in glob.glob(_os.path.join(BRUN, "sync", "*")) if _os.path.isdir(d)][0]
def kept(day):
    f = _os.path.join(sdir(), "days", day + ".xml")
    return open(f, encoding="utf-8").read() if _os.path.exists(f) else ""
def update_now():
    n = log().count("Update from Tally: done")
    call("/keep?company=" + urllib.parse.quote(CO), {"now": True})
    return until(lambda: log().count("Update from Tally: done") > n, 900, 3)
guid = lambda p: re.search(r"<GUID>([^<]*)</GUID>", p).group(1)
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    ok(call("/status")["sessions"], "bridge up")
    call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY}); fake_cloud.LINKS[CO] = "client-1"
    # a first run (the first copy); runs again until the company is in step
    for i in range(4):
        update_now()
        st = json.load(open(_os.path.join(sdir(), "keep.json"), encoding="utf-8-sig"))
        if st.get("phase") == "live" and st.get("roundAt"): break
    ok(st.get("phase") == "live", "the first copy made through Update now: " + str(st.get("phase")))
    ok(until(lambda: all((CO, d) in fake_cloud.DAYS for d in sorted(set(d for d, _ in fake_tally.V if d >= "20260101"))), 120, 2), "every day is in the cloud")
    # changes in Tally: an edit in March, a new entry in March, and a deletion in January that does not move Tally's counter
    fake_tally.CTRL["delete_bumps"] = False
    jan = [p for d, p in fake_tally.V if d == "20260112"]; mar = [p for d, p in fake_tally.V if d == "20260316"]
    g_del, g_edit = guid(jan[0]), guid(mar[0])
    fake_tally.delete(g_del); fake_tally.edit_amount(g_edit, 2); fake_tally.add_copy(g_edit, "20260317", "zz-new-entry-0001")
    # a new day: in the tests the day's round is started again by clearing the note of today's round
    kf = _os.path.join(sdir(), "keep.json"); st = json.load(open(kf, encoding="utf-8-sig")); st["roundAt"] = ""; st["roundFrom"] = ""; json.dump(st, open(kf, "w"))
    n0 = len(fake_tally.LOG)
    ok(update_now(), "the next daily update ran and finished")
    k = collections.Counter(x[0] for x in fake_tally.LOG[n0:])
    print("   Tally was asked:", dict(k))
    ok("<GUID>%s</GUID>" % g_del not in kept("20260112") and "<GUID>%s</GUID>" % g_del not in fake_cloud.DAYS.get((CO, "20260112"), ""), "an entry deleted in January (Tally's counter did not move) is gone from the copy and the cloud")
    ok(fake_cloud.DAYS.get((CO, "20260316"), "") == kept("20260316") and "<GUID>%s</GUID>" % g_edit in kept("20260316") and kept("20260316") != "", "the edited entry's day is read again and sent")
    ok("zz-new-entry-0001" in fake_cloud.DAYS.get((CO, "20260317"), ""), "the new entry reached the cloud")
    ok(k["DayBook"] <= 12, "only the changed days were read again (%d day book reads)" % k["DayBook"])
    ok(k["TDSDeskKeepList"] >= 9, "every month was compared with Tally's list (%d list reads)" % k["TDSDeskKeepList"])
    # the same day again: the round is done, so a second Update now is short
    n1 = len(fake_tally.LOG)
    ok(update_now(), "a second Update now on the same day finished")
    k2 = collections.Counter(x[0] for x in fake_tally.LOG[n1:])
    ok(k2["TDSDeskKeepList"] <= 3 and k2["DayBook"] == 0, "and did not check every month again: " + str(dict(k2)))
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
