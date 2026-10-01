"""python3 run_keep_posted.py - bridge 1.14.6:
  - an entry posted from FinCom goes into the copy and to the cloud from what was posted (with Tally's GUID and change
    number from the check after posting): Tally is not read again for it during the day;
  - in the evening that day is read once, exactly as Tally keeps it;
  - the evening update when no company is open in Tally is not lost: it runs the next time one is open."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keepposted")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, re, glob, collections, datetime
sys.path.insert(0, HERE)
import fake_tally, fake_cloud
fake_tally.start(); fake_cloud.start()
fake_tally.CTRL["posted_alter"] = True
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": "23:59", "KeepLightMin": -1, "KeepStartSec": 5, "KeepCycleSec": 3,
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
def sync(): return _os.path.join(BRUN, "sync")
def sdir(): return [d for d in glob.glob(_os.path.join(sync(), "*")) if _os.path.isdir(d)][0]
def kept(day):
    f = _os.path.join(sdir(), "days", day + ".xml")
    return open(f, encoding="utf-8").read() if _os.path.exists(f) else ""
def running(): return call("/keep?company=" + urllib.parse.quote(CO)).get("running")
def kinds(n): return collections.Counter(x[0] for x in fake_tally.LOG[n:])
today = datetime.date.today().strftime("%Y%m%d"); yday = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y%m%d")
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY}); fake_cloud.LINKS[CO] = "client-1"
    for i in range(3):
        call("/keep?company=" + urllib.parse.quote(CO), {"now": True})
        until(lambda: log().count("Update from Tally: done") > i, 900, 3)
        if json.load(open(_os.path.join(sdir(), "keep.json"), encoding="utf-8-sig")).get("phase") == "live": break
    ok(json.load(open(_os.path.join(sdir(), "keep.json"), encoding="utf-8-sig")).get("phase") == "live", "the first copy made")
    until(lambda: not running(), 120, 2)
    # ---------- a posting from FinCom
    n0 = len(fake_tally.LOG)
    xml = '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>20260311</DATE><NARRATION>Rent March TDSDesk:zz-rent-1</NARRATION><PARTYLEDGERNAME>ZZ Landlord</PARTYLEDGERNAME>' \
          '<ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Rent</LEDGERNAME><AMOUNT>-5000.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Bank</LEDGERNAME><AMOUNT>5000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
    r = call("/import", {"company": CO, "masters": [], "vouchers": [{"id": "p1", "xml": xml}]})
    res = (r.get("results") or [{}])[0]
    ok(res.get("ok") and res.get("verified") and res.get("guid"), "posted and found in Tally by the usual check: " + json.dumps({k: res.get(k) for k in ("ok", "verified", "guid", "vchNumber")}))
    g = res.get("guid", "")
    ok(until(lambda: ("<GUID>%s</GUID>" % g) in fake_cloud.DAYS.get((CO, "20260311"), ""), 90, 2), "the posted entry reached the cloud")
    ok(until(lambda: "Tally not read" in log(), 30), "put in the copy from what was posted: " + (re.findall(r"[^\n]*Tally not read[^\n]*", log()) or [""])[0][20:])
    until(lambda: not running(), 60, 2); time.sleep(3)
    k = kinds(n0); print("   Tally was asked after the posting:", dict(k))
    ok(k["DayBook"] == 0, "the day was not read from Tally again for it (%d day book reads)" % k["DayBook"])
    t = kept("20260311")
    ok(t.count("<GUID>%s</GUID>" % g) == 1 and "ZZ Rent" in t and "<ALTERID>" in t.split("<GUID>%s</GUID>" % g)[1][:40], "the copy holds it once, with Tally's GUID and change number")
    ok(len(re.findall(r"<VOUCHER\b", t)) == sum(1 for d, _ in fake_tally.V if d == "20260311") + 1, "and the day's other entries are all still there")
    # ---------- the evening: that day read once as Tally keeps it
    n1 = len(fake_tally.LOG)
    call("/keep?company=" + urllib.parse.quote(CO), {"now": True})
    ok(until(lambda: "posted from FinCom read as Tally keeps them" in log(), 300, 3), "the evening update reads the posted day once, as Tally keeps it")
    until(lambda: not running(), 300, 2)
    ok(kinds(n1)["DayBook"] >= 1 and kept("20260311").count("<GUID>%s</GUID>" % g) == 1 and fake_cloud.DAYS.get((CO, "20260311")) == kept("20260311"), "and the copy and the cloud agree with Tally, the entry once")
    # ---------- the evening update with no company open in Tally
    fake_tally.CTRL["no_company"] = True; time.sleep(35)        # the list of open companies is kept for 30 s
    open(_os.path.join(sync(), "keep-lastrun.txt"), "w").write(yday)
    cfg = json.load(open(CFG, encoding="utf-8-sig")); cfg["KeepDailyAt"] = "00:00"; json.dump(cfg, open(CFG, "w"))
    call("/keep", {"dailyAt": "00:00"})
    ok(until(lambda: "not finished (Tally or the company not open" in log(), 240, 3), "at the update's time no company is open: it says so, and does not count as done")
    ok(open(_os.path.join(sync(), "keep-lastrun.txt")).read().strip() == yday, "today's update is still to do")
    fake_tally.CTRL["no_company"] = False; time.sleep(35)
    os.remove(_os.path.join(sync(), "keep-tried.txt"))          # as if 30 minutes had passed
    ok(until(lambda: open(_os.path.join(sync(), "keep-lastrun.txt")).read().strip() == today, 400, 3), "the company open again: the update runs then, and is done for today")
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
