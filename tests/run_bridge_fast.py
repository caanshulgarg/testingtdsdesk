"""python3 run_bridge_fast.py - bridge 1.15.0 (branch fast-sync, staging download only):
  - woken at once: FinCom's database sends "post" or "update" on this computer's own Realtime channel (the heartbeat's
    answer names it). "Post to Tally" reaches the bridge in 2 seconds or less, and the posting is taken at once; Update now
    (and Send ledgers and groups now) starts at once. The heartbeat is set to 10 minutes here, so nothing else could;
  - an entry made in Tally reaches FinCom's cloud within 2 minutes: every 60 seconds (as installed) the bridge asks
    Tally only its two change counters, and when one moved the changed entries are read and sent;
  - Tally untouched: only the counters are asked, nothing is read.
The bridge (TDSBridge.ps1) runs with PowerShell 7 against the stand-in Tally (made-up books), the stand-in cloud
(fake_cloud.py) and a stand-in Realtime (fake_ws.py). Needs PowerShell 7 (PWSH, default /opt/pwsh/pwsh). About 5 minutes."""
import os as _os, shutil as _sh, sys
HERE = _os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, HERE)
import make_fake_books
_os.environ["TDSDESK_DATA"] = make_fake_books.main(_os.path.join(HERE, "out", "fakebooks"))
BRUN = _os.path.join(HERE, "out", "bridgefast")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, time, subprocess, urllib.request, urllib.parse, re, glob, collections, uuid
import fake_tally, fake_cloud, fake_ws
fake_tally.start(); fake_cloud.start(); fake_ws.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
TOPIC = "tb-" + "e" * 64
fake_cloud.CTRL["wake"] = {"url": "ws://127.0.0.1:%d/realtime/v1/websocket" % fake_ws.PORT, "key": "anon-key", "topic": TOPIC}
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": "23:59", "KeepLightMin": 0, "KeepStartSec": 5, "KeepCycleSec": 3,
           "KeepBudgetSec": 30, "KeepIdleMin": 1, "KeepFrom": "20260301", "KeepFakeOffice": False, "KeepRunMin": 15, "KeepSharePct": 100, "KeepNightSharePct": 100,
           "CloudLinksSec": 5, "CloudStateSec": 5, "CloudBeatSec": 600, "AllowImport": True}, open(CFG, "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(fn, secs=180, step=0.2):
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
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    ok("1.15.0" in json.dumps(call("/status")), "bridge 1.15.0 runs")
    call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY}); fake_cloud.LINKS[CO] = "client-1"
    ok(until(lambda: fake_ws.joined(TOPIC), 60) and until(lambda: "Wake-up channel: connected" in log(), 20), "the bridge joins its own wake-up channel, named in the heartbeat's answer")
    ok(call("/status").get("wake", {}).get("joined") is True, "and its status says so (for FinCom and support)")
    # Update now, through the channel (the heartbeat is 10 minutes away)
    t0 = time.time(); n = fake_ws.broadcast(TOPIC, "update")
    t_upd = until(lambda: "Woken by FinCom: Update now" in log() and time.time() - t0, 10, 0.1)
    ok(n == 1 and t_upd and t_upd <= 2, "Update now reached the Tally computer in %.1f s" % (t_upd or 99))
    ok(until(lambda: "Update from Tally: asked for now" in log(), 30), "and the update started")
    for i in range(3):
        until(lambda: log().count("Update from Tally: done") > i, 600, 2)
        st = json.load(open(_os.path.join(sdir(), "keep.json"), encoding="utf-8-sig"))
        if st.get("phase") == "live": break
        fake_ws.broadcast(TOPIC, "update")
    ok(st.get("phase") == "live" and st.get("cv") is not None, "the first copy made, with Tally's change counters kept (%s, %s)" % (st.get("cv"), st.get("cm")))
    ok(until(lambda: all((CO, d) in fake_cloud.DAYS for d in set(d for d, _ in fake_tally.V if d >= "20260301")), 120, 2), "every day is in the cloud")
    until(lambda: not call("/keep?company=" + urllib.parse.quote(CO)).get("running"), 120, 2)
    # Post to Tally: queued in the cloud, the wake-up sent: the bridge takes it at once
    vs = [{"id": "fast1", "xml": '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>20260315</DATE><NARRATION>fast | TDSDesk:fast1</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Rent</LEDGERNAME><AMOUNT>-150.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Bank</LEDGERNAME><AMOUNT>150.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'}]
    jid = str(uuid.uuid4()); fake_cloud.POSTS[jid] = {"company": CO, "payload": {"masters": [], "vouchers": vs, "ledger": ""}, "status": "waiting"}
    t0 = time.time(); fake_ws.broadcast(TOPIC, "post")
    t_post = until(lambda: fake_cloud.POSTS[jid]["status"] != "waiting" and time.time() - t0, 10, 0.05)
    ok(t_post and t_post <= 2, "Post to Tally reached the bridge, and it took the posting, in %.2f s" % (t_post or 99))
    ok(until(lambda: fake_cloud.POSTS[jid]["status"] == "done" and not fake_cloud.POSTS[jid].get("checking"), 90, 0.5), "the posting is done (%s)" % fake_cloud.POSTS[jid].get("message"))
    until(lambda: not call("/keep?company=" + urllib.parse.quote(CO)).get("running"), 180, 2)
    # an entry changed in Tally during the day: in the cloud within 2 minutes, with only the counters asked meanwhile
    time.sleep(70)                                        # a quiet minute first: nothing changed, nothing read
    n0 = len(fake_tally.LOG); time.sleep(65)
    quiet = collections.Counter(x[0] for x in fake_tally.LOG[n0:])
    ok(quiet["TDSDeskKeepCo"] >= 1 and quiet["DayBook"] == 0 and quiet["TDSDeskKeepList"] == 0, "nothing changed in Tally: only its change counters are asked, every minute (%s)" % dict(quiet))
    p = [p for d, p in fake_tally.V if d == "20260310"][0]; g = guid(p)
    n1 = len(fake_tally.LOG); t0 = time.time(); fake_tally.edit_amount(g, 3)
    newp = [p2 for d, p2 in fake_tally.V if d == "20260310" and guid(p2) == g][0]
    amt = re.findall(r"<AMOUNT>(-?[\d.]+)</AMOUNT>", newp)[0]
    t_in = until(lambda: amt in fake_cloud.DAYS.get((CO, "20260310"), "") and "<AMOUNT>" + amt not in p and time.time() - t0, 150, 1)
    ok(t_in and t_in < 120, "an entry changed in Tally is in FinCom's cloud in %.0f s" % (t_in or 999))
    k = collections.Counter(x[0] for x in fake_tally.LOG[n1:])
    print("    Tally was asked meanwhile:", dict(k))
    ok("Tally changed (" in log() and k["DayBook"] <= 2, "found by the change counters, and only the changed entries' day read")
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
