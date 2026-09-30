"""python3 run_priority.py - bridge 1.14.2:
  - FinCom first: while the copier is reading Tally, FinCom's requests (posting, a check someone asked for) go ahead;
    the copier waits between its reads, so FinCom's requests follow one another with nothing of the copier between them;
  - "Tally not responding since HH:MM": when Tally stops answering, the status says since when, until it answers again."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "priority")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, glob
sys.path.insert(0, HERE)
import fake_tally
fake_tally.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 6, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": "23:59", "KeepStartSec": 3, "KeepCycleSec": 3, "KeepIdleMin": 1,
           "KeepFrom": "20260301", "KeepFakeOffice": False, "KeepRunMin": 6}, open(CFG, "w"))
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
    # the copier busy with an update, each of its reads slow
    fake_tally.CTRL["all_delay"] = 1.0
    call("/keep?company=" + urllib.parse.quote(co), {"now": True})
    t = time.time()
    while time.time() - t < 60 and "first copy from" not in logtext() and "Keeping " + co not in logtext(): time.sleep(1)
    time.sleep(8)
    n0 = len(fake_tally.LOG)
    for d in ["20260310", "20260311", "20260312", "20260313", "20260314"]:
        call("/daybook?company=" + urllib.parse.quote(co) + "&from=" + d + "&to=" + d, timeout=180, raw=True)
    seq = fake_tally.LOG[n0:]
    mine = [i for i, (k, a, b) in enumerate(seq) if k == "DayBook" and a in ("20260310", "20260311", "20260312", "20260313", "20260314") and a == b]
    between = [seq[i] for i in range(mine[0], mine[-1] + 1) if i not in mine] if mine else ["none"]
    print("   requests at Tally from the first to the last of FinCom's:", [k for k, a, b in seq[mine[0]:mine[-1] + 1]] if mine else seq)
    ok(len(mine) == 5 and not between, "FinCom's five requests went one after another, the copier waiting meanwhile (%d of the copier's in between)" % len(between))
    fake_tally.CTRL["all_delay"] = 0
    t = time.time()
    while time.time() - t < 400 and "Update from Tally: done" not in logtext(): time.sleep(2)
    ok("Update from Tally: done" in logtext(), "and the copier finished its update afterwards")
    # Tally stops answering
    fake_tally.CTRL["all_delay"] = 12
    time.sleep(35)                                 # the company list asked a moment ago is kept 30 s
    try: call("/status?fresh=1", timeout=60)
    except Exception: pass
    st = call("/status")
    ok(st.get("tallyStuck") and st["tallyStuck"].get("since"), "Tally not answering: the status says since when: %s" % (st.get("tallyStuck"),))
    fake_tally.CTRL["all_delay"] = 0
    time.sleep(125)                                # the bridge leaves a Tally that timed out alone for a while first
    call("/daybook?company=" + urllib.parse.quote(co) + "&from=20260321&to=20260321", timeout=60, raw=True)
    ok(not call("/status").get("tallyStuck"), "Tally answering again: the message goes")
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
