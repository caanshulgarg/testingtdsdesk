"""python3 run_keep_hold.py - Tally comes first: the copier waits while Tally is busy with its user, rests after a slow read,
and stops when the bridge that started it stops."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keephold")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, glob
sys.path.insert(0, HERE)
import fake_tally
fake_tally.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
base = {"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30, "KeepIdleMin": 1,
        "KeepFrom": "20260301", "KeepSharePct": 90, "KeepNightSharePct": 90, "KeepTargetSec": 2, "KeepNightTargetSec": 2, "KeepTooLongSec": 3,
        "KeepFakeHold": "someone is working in Tally"}
def cfg(**k):
    c = dict(base); c.update(k); json.dump(c, open(CFG, "w")); time.sleep(0.2)
cfg()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def logtext(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
def reads(): return sum(1 for k, a, b in fake_tally.LOG if k == "DayBook")
def worker_pid():
    try: return int(open(_os.path.join(BRUN, "sync", "keep.pid")).read().strip() or 0)
    except Exception: return 0
def alive(p):
    try: os.kill(p, 0); return True
    except Exception: return False
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
try:
    t = time.time()
    while time.time() - t < 60:
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: time.sleep(1)
    t = time.time()
    while time.time() - t < 90 and not worker_pid(): time.sleep(1)
    ok(worker_pid() > 0, "the copier started")
    time.sleep(25)
    ok(reads() == 0, "while someone works in Tally, the copier reads nothing (%d day book reads)" % reads())
    ok("waiting, someone is working in Tally" in logtext(), "the log says why it waits")
    # Tally free again, but slow: every day book read takes 4 s (over the 3 s limit for one read)
    fake_tally.CTRL["daybook_delay"] = 4
    cfg(KeepFakeHold="")
    t = time.time()
    while time.time() - t < 90 and "left alone for" not in logtext(): time.sleep(1)
    ok(reads() >= 1, "once Tally is free, the copy goes on (%d reads)" % reads())
    ok("left alone for" in logtext(), "after a slow read, Tally is left alone for a while")
    n = reads(); time.sleep(20)
    ok(reads() == n, "and no more reads meanwhile (%d then %d)" % (n, reads()))
    ks = [json.load(open(f, encoding="utf-8-sig")) for f in glob.glob(_os.path.join(BRUN, "sync", "*", "keep.json"))]
    ok(ks and int(ks[0].get("slice", 9)) == 1, "the next reads are one day at a time: slice %s" % (ks[0].get("slice") if ks else None))
    # the bridge stops: the copier stops too
    wp = worker_pid()
    br.kill(); br.wait(10)
    t = time.time()
    while time.time() - t < 40 and alive(wp): time.sleep(1)
    ok(not alive(wp), "when the bridge stops, the copier stops too")
finally:
    try: br.kill(); br.wait(10)
    except Exception: pass
    p = worker_pid()
    if p and alive(p):
        try: os.kill(p, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
