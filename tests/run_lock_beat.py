"""python3 run_lock_beat.py - bridge 1.14.3:
  - one request at a time to Tally, even when the bridge (FinCom's requests) and its copier both want it: the second
    waits its turn;
  - a heartbeat to the cloud every few minutes (Tally open, the companies, how many days wait), asking Tally nothing."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "lockbeat")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, glob, threading
sys.path.insert(0, HERE)
import fake_tally, fake_cloud
fake_tally.start(); fake_cloud.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 60, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": "23:59", "KeepStartSec": 3, "KeepCycleSec": 3, "KeepIdleMin": 1,
           "KeepFrom": "20260301", "KeepFakeOffice": False, "KeepRunMin": 4, "CloudBeatSec": 5, "CloudLinksSec": 5}, open(CFG, "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def call(path, body=None, timeout=120, raw=False):
    key = json.load(open(CFG, encoding="utf-8-sig")).get("Key", "")
    rq = urllib.request.Request("http://127.0.0.1:9100" + path, data=json.dumps(body).encode() if body is not None else None,
                                headers={"X-Bridge-Key": key, "Origin": "https://staging.fincom.live", "Content-Type": "application/json"})
    t = urllib.request.urlopen(rq, timeout=timeout).read()
    return t if raw else json.loads(t)
def logtext(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
try:
    t = time.time()
    while time.time() - t < 60:
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: time.sleep(1)
    co = call("/status?fresh=1")["sessions"][0]["companies"][0]["name"]
    # the heartbeat: once this computer is connected to the cloud
    call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY})
    t = time.time()
    while time.time() - t < 60 and not fake_cloud.BEATS: time.sleep(1)
    n0 = len(fake_tally.LOG)
    ok(fake_cloud.BEATS, "the bridge sends a heartbeat to the cloud")
    b = fake_cloud.BEATS[-1] if fake_cloud.BEATS else {}
    ok(b.get("tally") is True and co in (b.get("open") or []) and b.get("dailyAt") == "23:59", "it says Tally is open, with which company, and when the daily update runs: " + json.dumps({k: b.get(k) for k in ("tally", "open", "dailyAt")}))
    t = time.time()
    while time.time() - t < 30 and len(fake_cloud.BEATS) < 3: time.sleep(1)
    ok(len(fake_cloud.BEATS) >= 3 and len(fake_tally.LOG) == n0, "heartbeats keep coming (%d) and Tally is asked nothing for them (%d requests)" % (len(fake_cloud.BEATS), len(fake_tally.LOG) - n0))
    # one at a time: a slow Tally, the copier reading (Update now), and FinCom's requests at the same time
    fake_tally.CTRL["all_delay"] = 4
    fake_tally.INFLIGHT[1] = 0
    call("/keep?company=" + urllib.parse.quote(co), {"now": True})
    t = time.time()
    while time.time() - t < 60 and "Keeping " + co not in logtext(): time.sleep(1)
    errs = []
    def fincom(i):
        try: call("/status?fresh=1", timeout=180); call("/daybook?company=" + urllib.parse.quote(co) + "&from=20260310&to=20260310", timeout=180, raw=True)
        except Exception as e: errs.append(str(e))
    th = [threading.Thread(target=fincom, args=(i,)) for i in range(3)]
    [x.start() for x in th]; [x.join() for x in th]
    time.sleep(10)
    print("   most requests at Tally at once:", fake_tally.INFLIGHT[1])
    ok(fake_tally.INFLIGHT[1] == 1, "with the copier and FinCom both asking, Tally got one request at a time (most at once: %d)" % fake_tally.INFLIGHT[1])
    ok(not errs, "and FinCom's requests were answered, each in its turn" + ("" if not errs else ": " + errs[0][:200]))
    ok("waited" in logtext() and "for another FinCom request to finish first" in logtext(), "the log says when a request waited its turn")
    fake_tally.CTRL["all_delay"] = 0
    t = time.time()
    while time.time() - t < 300 and "Update from Tally: done" not in logtext(): time.sleep(2)
    ok("Update from Tally: done" in logtext(), "the update finished normally")
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
