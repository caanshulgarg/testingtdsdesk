"""python3 run_keep_slowbal.py - a Tally that is slow to work out balances, a copier left from an older bridge, and a Tally
that does not answer in time:
  - an older copier is stopped and this version's started;
  - opening balances: five ledgers tried; when that is slow, every balance is read once at a quiet time, the day book
    copy going on meanwhile;
  - a Tally that timed out is not asked again at once (no pile-up of requests)."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keepslowbal")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(_os.path.join(BRUN, "sync"), exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, glob
sys.path.insert(0, HERE)
import fake_tally
fake_tally.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
PWSH = os.environ.get("PWSH", "/opt/pwsh/pwsh")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
base = {"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30, "KeepIdleMin": 1,
        "KeepFrom": "20260301", "KeepSharePct": 90, "KeepNightSharePct": 90, "KeepTargetSec": 2, "KeepNightTargetSec": 2, "KeepTooLongSec": 30,
        "KeepFakeOffice": True, "KeepFakeIdleSec": 120}
def cfg(**k):
    c = dict(base); c.update(k); json.dump(c, open(CFG, "w")); time.sleep(0.2)
cfg()
fake_tally.CTRL["bal_delay"] = 4
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def logtext(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
def count(kind): return sum(1 for k, a, b in fake_tally.LOG if k == kind)
def worker_pid():
    try: return int(open(_os.path.join(BRUN, "sync", "keep.pid")).read().strip() or 0)
    except Exception: return 0
def alive(p):
    try: os.kill(p, 0); return True
    except Exception: return False
def wait(cond, sec):
    t = time.time()
    while time.time() - t < sec and not cond(): time.sleep(1)
    return cond()
# a copier left running by an older bridge (it wrote no version)
old = subprocess.Popen([PWSH, "-NoProfile", "-Command", "Start-Sleep 600"])
open(_os.path.join(BRUN, "sync", "keep.pid"), "w").write(str(old.pid))
br = subprocess.Popen([PWSH, "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
try:
    wait(lambda: old.poll() is not None, 90)
    ok(old.poll() is not None, "the copier of an older bridge is stopped")
    ok(wait(lambda: worker_pid() not in (0, old.pid) and alive(worker_pid()), 40), "and this version's copier started")
    ok(wait(lambda: "at a quiet time" in logtext(), 90), "five ledgers' balances were slow, so the rest wait for a quiet time")
    ok(count("TDSDeskKeepBal") == 1, "only that one small balance read so far (%d)" % count("TDSDeskKeepBal"))
    ok(wait(lambda: count("DayBook") >= 2, 60), "the day book copy goes on meanwhile (%d reads)" % count("DayBook"))
    time.sleep(8)
    ok(count("TDSDeskKeepBal") == 1, "still no balance reads while someone was at the computer recently")
    # nobody at the computer for a long while: a quiet time
    cfg(KeepFakeIdleSec=99999)
    ok(wait(lambda: count("TDSDeskKeepBal") >= 2, 60), "at a quiet time, every opening balance is read")
    ok(wait(lambda: "opening balances read" in logtext(), 30), "and written for FinCom")
    ok(count("TDSDeskKeepBal") == 2, "in one read (%d reads in all)" % count("TDSDeskKeepBal"))
    bf = glob.glob(_os.path.join(BRUN, "sync", "*", "balances.json"))
    n = len(json.load(open(bf[0], encoding="utf-8-sig"))["ledgers"]) if bf else 0
    ok(n == len(fake_tally.L), "every ledger has its opening: %d of %d" % (n, len(fake_tally.L)))
    # a Tally that does not answer in time: not asked again and again
    fake_tally.CTRL["all_delay"] = 6
    t0 = time.time(); n0 = len(fake_tally.LOG); time.sleep(60)
    n1 = len(fake_tally.LOG) - n0
    import collections; print("   kinds:", dict(collections.Counter(k for k, a, b in fake_tally.LOG[n0:])))
    fake_tally.CTRL["all_delay"] = 0
    nc = sum(1 for k, a, b in fake_tally.LOG[n0:] if k == "TDSDeskCompanies")
    ok(nc <= 6, "a Tally that timed out is not asked again at once: %d company-list requests in a minute" % nc)
    ok("is busy and did not answer" in logtext(), "and the bridge says Tally is busy")
finally:
    for p in (br,):
        try: p.kill(); p.wait(10)
        except Exception: pass
    for p in (worker_pid(), old.pid):
        if p and alive(p):
            try: os.kill(p, 9)
            except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
