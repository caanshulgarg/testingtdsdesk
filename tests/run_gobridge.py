"""python3 run_gobridge.py - the Go bridge (bridge-go, 2.0.0) as it is installed:
  1. test mode beside bridge 1.15.0 (PowerShell) in the same folder: the Go bridge starts from 1.15.0's copy, reads
     Tally itself and sends to the cloud marked "shadow" (compared, never kept), and never posts: a posting woken on the
     shared channel is taken by 1.15.0 only, and entered in Tally once; postings through the Go bridge are refused;
     FinComBridge compare finds the two copies the same;
  2. sole mode (1.15.0 gone): the Go bridge takes over 1.15.0's copy, pairing and settings on port 9100 without reading
     the year again; with FinCom's cloud down a changed day waits in the outbox, survives the bridge being killed, and
     goes when the cloud is back; a posting queued in the cloud reaches it at once through the wake-up channel.
Stand-in Tally (made-up books), cloud and Realtime. Needs PowerShell 7 (PWSH) and Go. About 8 minutes."""
import os as _os, shutil as _sh, sys, json, time, subprocess, urllib.request, urllib.parse, re, glob, uuid
HERE = _os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, HERE)
import make_fake_books
_os.environ["TDSDESK_DATA"] = make_fake_books.main(_os.path.join(HERE, "out", "fakebooks"))
import fake_tally, fake_cloud, fake_ws
GO = _os.environ.get("GOBRIDGE") or _os.path.join(HERE, "out", "fbridge")
if not _os.environ.get("GOBRIDGE"):
    subprocess.run(["go", "build", "-o", GO, "."], cwd=_os.path.join(HERE, "..", "bridge-go"), check=True, env=dict(_os.environ, GOTOOLCHAIN="local"))
H = _os.path.join(HERE, "out", "gobridge"); _sh.rmtree(H, ignore_errors=True); _os.makedirs(H)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(H, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(H, "fake.json"))
_os.environ["TDSBRIDGE_FAKE"] = _os.path.join(H, "fake.json")
fake_tally.start(); fake_cloud.start(); fake_ws.start()
TOPIC = "tb-" + "f" * 64
fake_cloud.CTRL["wake"] = {"url": "ws://127.0.0.1:%d/realtime/v1/websocket" % fake_ws.PORT, "key": "anon-key", "topic": TOPIC}
CO = fake_tally.COMPANY; fake_cloud.LINKS[CO] = "client-1"
PSCFG, GOCFG = _os.path.join(H, "tds-bridge.config.json"), _os.path.join(H, "go-bridge.config.json")
FAST = {"TallyTimeoutSec": 20, "KeepInStep": True, "KeepSchedule": "daily", "KeepDailyAt": "23:59", "KeepLightMin": 0, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30,
        "KeepIdleMin": 1, "KeepFrom": "20260301", "KeepFakeOffice": False, "KeepRunMin": 15, "KeepSharePct": 100, "KeepNightSharePct": 100, "KeepWatchSec": 20,
        "CloudLinksSec": 5, "CloudStateSec": 5, "CloudBeatSec": 15, "AllowImport": True, "GentleMs": 0}
json.dump(FAST, open(PSCFG, "w"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(fn, secs=180, step=0.5):
    t = time.time()
    while time.time() - t < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None
def call(port, cfg, path, body=None):
    key = json.load(open(cfg, encoding="utf-8-sig"))["Key"]
    rq = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode() if body is not None else None,
                                headers={"X-Bridge-Key": key, "Origin": "https://staging.fincom.live", "Content-Type": "application/json"})
    try: return json.loads(urllib.request.urlopen(rq, timeout=120).read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b"{}") | {"_code": e.code}
def text(f):
    try: return open(f, encoding="utf-8", errors="replace").read()
    except Exception: return ""
def go_log(): return text(_os.path.join(H, "go-bridge.log"))
def ps_up(): return urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read()
guid = lambda p: re.search(r"<GUID>([^<]*)</GUID>", p).group(1)
procs = {}
def run_ps():
    procs["ps"] = subprocess.Popen([_os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(H, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=H)
def run_go(cfg):
    procs["go"] = subprocess.Popen([GO, "run", "--config", cfg], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=H)
def kill(n):
    p = procs.pop(n, None)
    if p: p.kill(); p.wait()
    for f in glob.glob(_os.path.join(H, "*sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid and n == "ps" and pid != _os.getpid(): _os.kill(pid, 9)
        except Exception: pass
try:
    print("bridge 1.15.0 makes the copy (as installed today):")
    run_ps(); until(ps_up, 60)
    call(9100, PSCFG, "/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY})
    until(lambda: fake_ws.joined(TOPIC), 60)
    call(9100, PSCFG, "/keep", {"now": True})
    keepf = _os.path.join(H, "sync", fake_tally.COMPANY.replace("/", "_"), "keep.json")
    ok(until(lambda: json.load(open(keepf, encoding="utf-8-sig")).get("phase") == "live" and "Update from Tally: done" in text(_os.path.join(H, "tds-bridge.log")), 420, 2), "1.15.0: the copy is in step with Tally")
    ok(until(lambda: all((CO, d) in fake_cloud.DAYS for d in set(d for d, _ in fake_tally.V if d >= "20260301")), 180, 2), "1.15.0: every day is in the cloud")

    print("\n1. the Go bridge installed beside it, in test mode:")
    ps_cfg = json.load(open(PSCFG, encoding="utf-8-sig"))
    json.dump(dict(FAST, Mode="test", Port=9101, Key=ps_cfg["Key"], CloudUrl=ps_cfg["CloudUrl"], CloudKey=ps_cfg["CloudKey"], PsHome=H,
                   SyncDir=_os.path.join(H, "go-sync"), JobsDir=_os.path.join(H, "go-jobs"), LogFile=_os.path.join(H, "go-bridge.log")), open(GOCFG, "w"))
    run_go(GOCFG)
    ok(until(lambda: "started from bridge 1.15.0's copy of 1 company" in go_log(), 30), "it starts from 1.15.0's copy (nothing read for the whole year again)")
    st = call(9101, GOCFG, "/status")
    ok(st.get("allowImport") is False and "never posts" in st.get("readOnly", "") and st.get("testMode") is True, "its status says it never posts (FinCom does not offer it for posting)")
    r = call(9101, GOCFG, "/import", {"company": CO, "vouchers": []})
    ok(r.get("_code") == 502 and "never posts" in r.get("error", ""), "a posting sent to it is refused")
    r = call(9101, GOCFG, "/jobs", {"jobId": str(uuid.uuid4()), "company": CO, "vouchers": []})
    ok(r.get("_code") == 502 and "never posts" in r.get("error", ""), "a posting job too")
    ok(until(lambda: any(k == "beat" for k, _ in fake_cloud.SHADOW), 60), "its heartbeat reaches the cloud marked shadow (kept apart from 1.15.0's)")
    ok(until(lambda: "Wake-up channel: connected" in go_log() and sum(1 for c in fake_ws.CONNS if ("realtime:" + TOPIC) in c["topics"]) == 2, 60), "it joins the same wake-up channel as 1.15.0")
    # a posting queued in FinCom: 1.15.0 takes it; the Go bridge is woken too, and does not
    n0 = len(fake_tally.POSTED)
    vs = [{"id": "side1", "xml": '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>20260315</DATE><NARRATION>side | TDSDesk:side1</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-150.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Bank</LEDGERNAME><AMOUNT>150.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'}]
    jid = str(uuid.uuid4()); fake_cloud.POSTS[jid] = {"company": CO, "payload": {"masters": [], "vouchers": vs, "ledger": ""}, "status": "waiting"}
    fake_ws.broadcast(TOPIC, "post")
    ok(until(lambda: fake_cloud.POSTS[jid]["status"] == "done" and not fake_cloud.POSTS[jid].get("checking"), 120, 0.5), "a posting woken on the shared channel is done by 1.15.0 (%s)" % fake_cloud.POSTS[jid].get("message"))
    ok(until(lambda: "Not taken here" in go_log(), 10) and not any(k == "posts_take" for k, _ in fake_cloud.SHADOW), "the Go bridge, woken too, does not take it (never asks for postings)")
    time.sleep(5)
    ok(len(fake_tally.POSTED) == n0 + 1 and fake_tally.posted_tags().count("TDSDesk:side1") == 1, "the entry is in Tally once")
    # an entry changed in Tally: both bridges read it; the Go bridge's day is compared with 1.15.0's in the cloud
    p = [p for d, p in fake_tally.V if d == "20260310"][0]; g = guid(p); fake_tally.edit_amount(g, 4)
    ok(until(lambda: re.search(r"Shadow check: .*: [1-9]\d* day\(s\) the same as bridge 1.15.0", go_log()), 240, 2), "its day read after the change is the same as 1.15.0's in the cloud (shadow check)")
    ok(any(k == "days" for k, _ in fake_cloud.SHADOW) and fake_cloud.DAYS[(CO, "20260310")] == text(_os.path.join(H, "sync", CO.replace("/", "_"), "days", "20260310.xml")), "and the cloud keeps 1.15.0's day only (the Go bridge's was compared, not kept)")
    ok("STILL DIFFERENT" not in go_log(), "no day stays different")
    # the two copies compared, day by day
    until(lambda: json.load(open(_os.path.join(H, "go-sync", CO.replace("/", "_"), "keep.json"), encoding="utf-8-sig")).get("last", 0) >= json.load(open(keepf, encoding="utf-8-sig")).get("last", 0), 120, 2)
    time.sleep(10)
    cmp_ = subprocess.run([GO, "compare", "--config", GOCFG], capture_output=True, text=True, cwd=H)
    ok(cmp_.returncode == 0 and "RESULT: the same." in cmp_.stdout, "FinComBridge compare: the two copies are the same, day by day (%s)" % (re.search(r"days: [^\n]*", cmp_.stdout) or [""])[0])
    kill("go")

    print("\n2. the Go bridge as the only bridge (1.15.0 replaced):")
    kill("ps")
    ps_last = json.load(open(keepf, encoding="utf-8-sig")).get("last")
    n_daybook = sum(1 for x in fake_tally.LOG if x[0] == "DayBook")
    run_go(PSCFG)
    ok(until(ps_up, 30) and "2.0.0" in json.dumps(call(9100, PSCFG, "/status")), "it answers FinCom on port 9100 with 1.15.0's key: FinCom stays connected")
    st = call(9100, PSCFG, "/status")
    ok(st.get("allowImport") is True and not st.get("readOnly"), "it posts (the only bridge)")
    time.sleep(8)
    ok(sum(1 for x in fake_tally.LOG if x[0] == "DayBook") - n_daybook <= 1, "1.15.0's copy is taken over: the year is not read again")
    ok(until(lambda: fake_ws.joined(TOPIC), 60), "it joins the wake-up channel")
    # FinCom's cloud down: a change waits in the outbox, survives a kill, goes when the cloud is back
    fake_cloud.CTRL["down"] = True
    p = [p for d, p in fake_tally.V if d == "20260312"][0]; g = guid(p); fake_tally.edit_amount(g, 5)
    newp = [p2 for d, p2 in fake_tally.V if d == "20260312" and guid(p2) == g][0]
    amt = re.findall(r"<AMOUNT>(-?[\d.]+)</AMOUNT>", newp)[0]
    outf = _os.path.join(H, "sync", CO.replace("/", "_"), "cloud-out.txt")
    ok(until(lambda: "20260312" in text(outf), 180, 2), "with the cloud down, the changed day waits in the outbox (cloud-out.txt)")
    kill("go")
    ok("20260312" in text(outf), "the bridge killed: the day is still waiting on disk")
    fake_cloud.CTRL["down"] = False
    run_go(PSCFG); until(ps_up, 30)
    t0 = time.time()
    ok(until(lambda: amt in fake_cloud.DAYS.get((CO, "20260312"), ""), 180, 1), "started again with the cloud back: the day reaches the cloud (%.0f s)" % (time.time() - t0))
    ok(until(lambda: "20260312" not in text(outf), 30), "and leaves the outbox")
    # a posting queued in FinCom reaches it at once
    vs = [{"id": "sole1", "xml": vs[0]["xml"].replace("side1", "sole1")}]
    jid = str(uuid.uuid4()); fake_cloud.POSTS[jid] = {"company": CO, "payload": {"masters": [], "vouchers": vs, "ledger": ""}, "status": "waiting"}
    until(lambda: fake_ws.joined(TOPIC), 60)
    t0 = time.time(); fake_ws.broadcast(TOPIC, "post")
    t_take = until(lambda: fake_cloud.POSTS[jid]["status"] != "waiting" and time.time() - t0, 10, 0.05)
    ok(t_take and t_take <= 2, "Post to Tally reaches it and it takes the posting in %.2f s" % (t_take or 99))
    ok(until(lambda: fake_cloud.POSTS[jid]["status"] == "done" and not fake_cloud.POSTS[jid].get("checking"), 90, 0.5), "and posts it (%s)" % fake_cloud.POSTS[jid].get("message"))
    # the same posting handed out again (a cloud retry): found in Tally, not posted twice
    fake_cloud.POSTS[jid]["status"] = "waiting"; n1 = len(fake_tally.POSTED)
    fake_ws.broadcast(TOPIC, "post")
    time.sleep(8)
    ok(len(fake_tally.POSTED) == n1 and fake_tally.posted_tags().count("TDSDesk:sole1") == 1, "the same posting handed out again is not entered twice")
finally:
    for n in list(procs): kill(n)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
