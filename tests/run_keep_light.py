"""python3 run_keep_light.py - bridge 1.14.4: entries appear during the day too.
  - a light check every KeepLightMin minutes (30 on real computers): Tally's change counters, and when they moved, only
    the changed entries' days; no month checks (those stay with the evening update);
  - right after FinCom posts to Tally, a light check runs at once (within a minute), so the posted entry reaches the cloud;
  - Update now pressed on another computer reaches the Tally computer through the cloud's heartbeat answer."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keeplight")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, re, glob, collections
sys.path.insert(0, HERE)
import fake_tally, fake_cloud
fake_tally.start(); fake_cloud.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": "23:59", "KeepLightMin": 3, "KeepStartSec": 5, "KeepCycleSec": 3,
           "KeepBudgetSec": 30, "KeepIdleMin": 1, "KeepFrom": "20260201", "KeepFakeOffice": False, "KeepRunMin": 15, "KeepSharePct": 100, "KeepNightSharePct": 100,
           "CloudLinksSec": 5, "CloudStateSec": 5, "CloudBeatSec": 5, "AllowImport": True}, open(CFG, "w"))
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
    return json.loads(urllib.request.urlopen(rq, timeout=120).read())
def log(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
def sdir(): return [d for d in glob.glob(_os.path.join(BRUN, "sync", "*")) if _os.path.isdir(d)][0]
guid = lambda p: re.search(r"<GUID>([^<]*)</GUID>", p).group(1)
def cloud_has(day, text): return text in fake_cloud.DAYS.get((CO, day), "")
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY}); fake_cloud.LINKS[CO] = "client-1"
    # the first copy: Update now asked through the cloud, as from another computer
    fake_cloud.CTRL["want"] = True
    ok(until(lambda: "Update from Tally: asked for now" in log(), 90), "Update now pressed on another computer reaches the Tally computer through the cloud")
    for i in range(3):
        until(lambda: log().count("Update from Tally: done") > i, 900, 3)
        st = json.load(open(_os.path.join(sdir(), "keep.json"), encoding="utf-8-sig"))
        if st.get("phase") == "live": break
        call("/keep?company=" + urllib.parse.quote(CO), {"now": True})
    ok(st.get("phase") == "live", "the first copy made")
    ok(until(lambda: all((CO, d) in fake_cloud.DAYS for d in set(d for d, _ in fake_tally.V if d >= "20260201")), 120, 2), "every day is in the cloud")
    # during the day: an entry edited in Tally reaches the cloud with the next light check (every 3 min here)
    p = [p for d, p in fake_tally.V if d == "20260310"][0]; g = guid(p)
    n0 = len(fake_tally.LOG); t0 = time.time(); fake_tally.edit_amount(g, 3)
    kept = lambda: open(_os.path.join(sdir(), "days", "20260310.xml"), encoding="utf-8").read()
    ok(until(lambda: fake_cloud.DAYS.get((CO, "20260310")) == kept() and kept() != p and re.search(r"<GUID>%s</GUID>" % g, kept()) and log().count("Light check of Tally: done") >= 1 and fake_cloud.DAYS[(CO, "20260310")] != "", 300, 3),
       "an entry edited in Tally during the day reached the cloud by itself in %.0fs, with a light check" % (time.time() - t0))
    time.sleep(8)
    k = collections.Counter(x[0] for x in fake_tally.LOG[n0:])
    print("   Tally was asked:", dict(k))
    ok(k["DayBook"] <= 2 and k["TDSDeskKeepList"] <= 4, "the light check read only what changed; no month checks")
    ok("Update from Tally: done" in log() and log().count("Update from Tally: asked") <= 3, "and it is not the evening update")
    # a posting from FinCom: a light check at once. (The stand-in Tally lists a copied entry as the new one.)
    until(lambda: not call("/keep?company=" + urllib.parse.quote(CO)).get("running"), 120, 2)
    lc = log().count("Light check of Tally: done")
    fake_tally.add_copy(g, "20260311", "zz-posted-0001")
    t1 = time.time()
    r = call("/import", {"company": CO, "masters": [], "vouchers": [{"id": "p1", "xml": '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>20260311</DATE><NARRATION>posted from FinCom</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>100</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'}]})
    ok(r.get("ok") is not False, "the posting went to Tally: " + json.dumps(r)[:120])
    ok(until(lambda: cloud_has("20260311", "zz-posted-0001"), 150, 2) and time.time() - t1 < 110, "after posting, the new entry reached the cloud in %.0fs (not waiting for the 3-minute check)" % (time.time() - t1))
    ok(until(lambda: log().count("Light check of Tally: done") > lc, 60), "through a light check started by the posting")
    ks = call("/keep?company=" + urllib.parse.quote(CO))
    ok(ks.get("lightAt"), "FinCom is told when Tally was last checked: " + str(ks.get("lightAt")))
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
