"""python3 run_cloud_e2e.py - the bridge sends its copy to FinCom's cloud: nothing before the computer is connected and
the company linked; then every day and the ledgers; later only what changed; with the cloud down, nothing is lost."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "cloudrun")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, urllib.error, re, glob
sys.path.insert(0, HERE)
import fake_tally, fake_cloud
fake_tally.start(); fake_cloud.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
FROM = "20260301"
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30, "KeepCheckEvery": 4, "KeepIdleMin": 1,
           "KeepFrom": FROM, "KeepSharePct": 100, "KeepNightSharePct": 100, "CloudLinksSec": 5, "CloudStateSec": 5, "CloudBatchKB": 400}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
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
def sync_dir(): return [d for d in glob.glob(_os.path.join(BRUN, "sync", "*")) if _os.path.isdir(d)]
def man():
    d = sync_dir()
    f = _os.path.join(d[0], "manifest.json") if d else ""
    return json.load(open(f, encoding="utf-8-sig")) if f and _os.path.exists(f) else None
def call(path, body=None):
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    req = urllib.request.Request("http://127.0.0.1:9100" + path, data=(json.dumps(body).encode() if body is not None else None),
                                 headers={"X-Bridge-Key": key, "Origin": "https://caanshulgarg.github.io", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
def day_files(): return sorted(_os.path.basename(f)[:8] for f in glob.glob(_os.path.join(sync_dir()[0], "days", "*.xml")))
def log(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    ok(until(lambda: (man() or {}).get("phase") == "live", 300), "the company is kept in step first (no cloud yet)")
    ok(not fake_cloud.CALLS, "nothing goes to the cloud before this computer is connected")
    # ---------- connect this computer
    try: call("/cloudlink", {"url": "https://evil.example.com/x", "key": fake_cloud.KEY}); ok(False, "a strange cloud address refused")
    except urllib.error.HTTPError as e: ok(True, "a cloud address that is not FinCom's is refused")
    r = call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY})
    ok(r.get("connected") and r.get("firm") == "ZZ TEST FIRM", "this computer is connected to the firm: " + json.dumps(r))
    cfg = open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig").read()
    ok(fake_cloud.KEY not in cfg or "plain:" in cfg, "the key is kept protected on Windows (here, outside Windows, marked plain)")
    ok(until(lambda: CO in fake_cloud.LINKS, 60), "the cloud is told which companies this computer has")
    time.sleep(8)
    ok(not fake_cloud.DAYS and not fake_cloud.LEDGERS, "nothing of a company goes before it is linked to a client in FinCom")
    # ---------- linked: everything kept goes, the ledgers first
    fake_cloud.CTRL["badgz"] = {"20260305"}          # a day Windows' gzip gets wrong: sent again as plain text
    fake_cloud.LINKS[CO] = "client-1"
    want = day_files()
    ok(until(lambda: all((CO, d) in fake_cloud.DAYS for d in want), 240, 2), "once linked, every day kept goes to the cloud: %d of %d" % (sum(1 for d in want if (CO, d) in fake_cloud.DAYS), len(want)))
    ok(CO in fake_cloud.LEDGERS and len(fake_cloud.LEDGERS[CO]["ledgers"]) > 500 and fake_cloud.LEDGERS[CO]["from"] == FROM, "the ledgers and opening balances go too (%d)" % len((fake_cloud.LEDGERS.get(CO) or {}).get("ledgers", [])))
    same = all(fake_cloud.DAYS[(CO, d)] == open(_os.path.join(sync_dir()[0], "days", d + ".xml"), encoding="utf-8").read() for d in want)
    ok(same, "each day arrives exactly as kept")
    mar = sum(len(re.findall(r"<VOUCHER\b", t)) for (c, d), t in fake_cloud.DAYS.items() if d.startswith("202603"))
    ok(mar == sum(1 for d, p in fake_tally.V if d.startswith("202603")), "March in the cloud has every entry: %d" % mar)
    big = max(n for k, n in fake_cloud.CALLS if k == "days")
    ok(big < 400 * 1024 * 1.5, "sent a little at a time: the largest call was %d KB" % (big // 1024))
    ok((CO, "20260305") in fake_cloud.DAYS and "go again as plain text" in "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log"))), "a day the cloud could not open went again as plain text, and arrived")
    ok(until(lambda: (fake_cloud.STATE.get(CO) or {}).get("phase") == "live", 60), "the copy's state goes too: " + json.dumps(fake_cloud.STATE.get(CO))[:120])
    # ---------- a change in Tally: only that day goes again
    n0 = len(fake_cloud.SENT)
    g = re.search(r"<GUID>([^<]*)</GUID>", [p for d, p in fake_tally.V if d == "20260310"][0]).group(1)
    fake_tally.edit_amount(g, 2)
    ok(until(lambda: ("20260310" in [d for c, d in fake_cloud.SENT[n0:]]) and "<GUID>%s</GUID>" % g in fake_cloud.DAYS[(CO, "20260310")] and fake_cloud.DAYS[(CO, "20260310")] == open(_os.path.join(sync_dir()[0], "days", "20260310.xml"), encoding="utf-8").read(), 120, 2),
       "an entry changed in Tally: its day goes to the cloud again")
    ok(len(set(d for c, d in fake_cloud.SENT[n0:])) <= 3, "and only the days that changed: " + ", ".join(sorted(set(d for c, d in fake_cloud.SENT[n0:]))))
    # ---------- the cloud down: the day waits on disk, then goes
    fake_cloud.CTRL["down"] = True
    n1 = len(fake_cloud.SENT)
    g2 = re.search(r"<GUID>([^<]*)</GUID>", [p for d, p in fake_tally.V if d == "20260312"][0]).group(1)
    fake_tally.edit_amount(g2, 3)
    qf = _os.path.join(sync_dir()[0], "cloud-out.txt")
    ok(until(lambda: "20260312" in open(qf).read(), 120, 2), "with the cloud down, the changed day waits in the queue on disk")
    ok(until(lambda: "nothing is lost" in log(), 60), "the log says the cloud did not answer and nothing is lost")
    fake_cloud.CTRL["down"] = False
    ok(until(lambda: ("20260312" in [d for c, d in fake_cloud.SENT[n1:]]), 200, 2), "when the cloud is back, the day goes")
    ok(until(lambda: "20260312" not in open(qf).read(), 60), "and leaves the queue")
    st = call("/keep?company=" + urllib.parse.quote(CO))
    ok(st.get("cloud", {}).get("connected") and "status" in st.get("cloud", {}), "the bridge's status tells FinCom about the cloud: " + json.dumps(st.get("cloud"))[:160])
    # ---------- the key revoked in FinCom
    fake_cloud.CTRL["revoked"] = True
    fake_tally.edit_amount(g, 0.5)
    ok(until(lambda: "not valid" in log(), 120, 2), "a key revoked in FinCom: the bridge says so and sends nothing")
    r = call("/cloudlink", {"off": True})
    ok(r.get("connected") is False, "and this computer can be disconnected from FinCom")
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
