"""python3 run_keep_share.py - the bridge keeps its share of a slow Tally's time small while it makes the first copy."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keepshare")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, glob
sys.path.insert(0, HERE)
import fake_tally
fake_tally.start()
fake_tally.CTRL["daybook_delay"] = 1.5          # a slow Tally: every day book read takes 1.5 s or more
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30, "KeepIdleMin": 1,
           "KeepFrom": "20260301", "KeepSharePct": 10, "KeepNightSharePct": 10, "KeepSlowSec": 1}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
try:
    t = time.time()
    while time.time() - t < 60:
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: time.sleep(1)
    # wait until the day book reading starts, then watch two minutes of it
    t = time.time()
    while time.time() - t < 120 and not any(k == "DayBook" for k, a, b in fake_tally.LOG): time.sleep(1)
    t0 = time.time(); time.sleep(120); t1 = time.time()
    busy = sum(max(0, min(e, t1) - max(s, t0)) for s, e in list(fake_tally.BUSY))
    reads = sum(1 for k, a, b in fake_tally.LOG if k == "DayBook")
    ok(reads >= 2, "the first copy goes on while the share is kept small: %d day book reads" % reads)
    ok(busy / (t1 - t0) <= 0.16, "the bridge used %.0f%% of Tally's time over two minutes (limit 10%%, plus its small status checks)" % (100 * busy / (t1 - t0)))
    log = "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
    ok("Day Book" in log and "took" in log, "slow requests are written in the log with how long they took")
    lf = glob.glob(_os.path.join(BRUN, "sync", "keep-load.json"))
    ld = json.load(open(lf[0], encoding="utf-8-sig")) if lf else {}
    ok(ld.get("ports") and ld["ports"][0]["limitPct"] == 10, "the load file tells FinCom and the Connector the share and the limit: " + json.dumps(ld.get("ports")))
finally:
    br.terminate()
    try: (br_p if 'br_p' in dir() else br).wait(10)
    except Exception:
        try: (br_p if 'br_p' in dir() else br).kill()
        except Exception: pass
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 15)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
