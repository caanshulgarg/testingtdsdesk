"""python3 run_status_light.py - status checks cost Tally almost nothing: FinCom's, the Connector's and the copier's checks
share one answer, at most one small question to Tally each 30 s, and a company's GSTIN and PAN are asked once."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "statuslight")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, collections
sys.path.insert(0, HERE)
import fake_tally
fake_tally.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 5, "KeepIdleMin": 1, "KeepFrom": "20260301", "KeepFakeHold": "someone is working in Tally"},
          open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def status():
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig")).get("Key", "")
    rq = urllib.request.Request("http://127.0.0.1:9100/status", headers={"X-Bridge-Key": key, "Origin": "https://staging.fincom.live"})
    return json.loads(urllib.request.urlopen(rq, timeout=20).read())
try:
    t = time.time()
    while time.time() - t < 60:
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: time.sleep(1)
    time.sleep(8)
    n0 = len(fake_tally.LOG); t0 = time.time(); answers = []
    # two FinCom tabs and the Connector, checking every 2 seconds for a minute (far more often than they really do)
    while time.time() - t0 < 60:
        try: answers.append(status())
        except Exception as e: answers.append({"error": str(e)})
        time.sleep(2)
    kinds = collections.Counter(k for k, a, b in fake_tally.LOG[n0:])
    print("   Tally was asked:", dict(kinds))
    ok(len(answers) >= 25 and all(a.get("ok") for a in answers), "%d status checks answered" % len(answers))
    ok(kinds["TDSDeskCompanies"] <= 3, "and Tally was asked which companies are open only %d times in the minute (bridge and copier together)" % kinds["TDSDeskCompanies"])
    ok(kinds["TDSDeskCompanyInfo"] == 0, "a company's GSTIN and PAN are not asked again once known (%d)" % kinds["TDSDeskCompanyInfo"])
    ok(any(c.get("name") for a in answers[-1:] for s in a.get("sessions", []) for c in s.get("companies", [])), "the answer still names the company open in Tally")
    ok(_os.path.exists(_os.path.join(BRUN, "sync", "company-info.json")), "a company's details are remembered in a file (the copier and a restarted bridge use them too)")
finally:
    br.kill()
    try:
        pid = int(open(_os.path.join(BRUN, "sync", "keep.pid")).read().strip() or 0)
        if pid: os.kill(pid, 9)
    except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
