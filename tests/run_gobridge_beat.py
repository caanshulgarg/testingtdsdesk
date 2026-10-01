"""python3 run_gobridge_beat.py - the Go bridge's heartbeat and a busy Tally (review of 01-Oct-2026: FinCom's status went
between connected and disconnected while the bridge was busy with Tally; its calls came about once a minute, with gaps
of up to 2.5 minutes):
  - the heartbeat goes every CloudBeatSec seconds on its own, also while Tally takes 40 s to answer and the bridge is
    copying, posting and answering FinCom: no gap longer than one beat and a little;
  - a slow Tally is reported "busy" (open, its companies kept), never closed or offline, in the heartbeat and in /status,
    and /status answers at once; the log says it once, and again when Tally answers;
  - FinCom's cloud unreachable: the bridge says "reconnecting", and offline only after three missed beats.
Stand-in Tally (made-up books), cloud and Realtime; the Go bridge (GOBRIDGE, or built here). About 4 minutes."""
import os as _os, shutil as _sh, sys, json, time, subprocess, urllib.request, threading, uuid, re
HERE = _os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, HERE)
import make_fake_books
_os.environ["TDSDESK_DATA"] = make_fake_books.main(_os.path.join(HERE, "out", "fakebooks"))
import fake_tally, fake_cloud, fake_ws
GO = _os.environ.get("GOBRIDGE") or _os.path.join(HERE, "out", "fbridge")
if not _os.environ.get("GOBRIDGE"):
    subprocess.run(["go", "build", "-o", GO, "."], cwd=_os.path.join(HERE, "..", "bridge-go"), check=True, env=dict(_os.environ, GOTOOLCHAIN="local"))
H = _os.path.join(HERE, "out", "gobeat"); _sh.rmtree(H, ignore_errors=True); _os.makedirs(H)
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(H, "fake.json")); _os.environ["TDSBRIDGE_FAKE"] = _os.path.join(H, "fake.json")
fake_tally.start(); fake_cloud.start(); fake_ws.start()
CO = fake_tally.COMPANY; fake_cloud.LINKS[CO] = "client-1"
EVERY = 5
CFG = _os.path.join(H, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepSchedule": "continuous", "KeepFrom": "20260301", "KeepFakeOffice": False, "KeepStartSec": 3, "KeepCycleSec": 3,
           "KeepSharePct": 100, "KeepNightSharePct": 100, "CloudBeatSec": EVERY, "CloudLinksSec": 5, "GentleMs": 0, "AllowImport": True}, open(CFG, "w"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(fn, secs=120, step=0.5):
    t = time.time()
    while time.time() - t < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None
def call(path, body=None, timeout=120):
    key = json.load(open(CFG, encoding="utf-8-sig"))["Key"]
    rq = urllib.request.Request("http://127.0.0.1:9100" + path, data=json.dumps(body).encode() if body is not None else None, headers={"X-Bridge-Key": key, "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(rq, timeout=timeout).read())
def log(): return open(_os.path.join(H, "tds-bridge.log"), encoding="utf-8", errors="replace").read()
def gaps(t0, t1):
    ts = [b["_t"] for b in fake_cloud.BEATS if t0 <= b["_t"] <= t1]
    return ts, max([b - a for a, b in zip(ts, ts[1:])] or [99])
br = subprocess.Popen([GO, "run", "--config", CFG], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=H)
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2), 30)
    call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY})
    ok(until(lambda: len(fake_cloud.BEATS) >= 3, 40), "the heartbeat goes on its own (every %d s here, 30 s as installed)" % EVERY)
    t0 = time.time(); time.sleep(4 * EVERY); ts, g = gaps(t0, time.time())
    ok(g <= EVERY + 2, "steady: %d beats in %d s, the longest gap %.1f s" % (len(ts), 4 * EVERY, g))
    ok(fake_cloud.BEATS[-1].get("tallyState") == "open" and fake_cloud.BEATS[-1].get("every") == EVERY, "each beat says Tally is open, and how often it comes")
    print("Tally becomes slow (40 s to answer; the bridge gives up after 20 s), while the bridge copies, posts and FinCom reads:")
    fake_tally.CTRL["all_delay"] = 40
    t0 = time.time()
    threading.Thread(target=lambda: call("/keep", {"now": True}), daemon=True).start()
    threading.Thread(target=lambda: call("/daybook?company=" + urllib.parse.quote(CO) + "&from=20260301&to=20260305", timeout=200), daemon=True).start()
    jid = str(uuid.uuid4())
    threading.Thread(target=lambda: call("/jobs", {"jobId": jid, "company": CO, "vouchers": [{"id": "busy1", "xml": '<VOUCHER VCHTYPE="Payment"><DATE>20260320</DATE><NARRATION>TDSDesk:busy1</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Bank</LEDGERNAME><AMOUNT>1.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Printing</LEDGERNAME><AMOUNT>-1.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'}]}), daemon=True).start()
    worst, states, closed = 0.0, set(), False
    end = time.time() + 70
    while time.time() < end:
        s0 = time.time(); st = call("/status", timeout=10); worst = max(worst, time.time() - s0)
        states.add(st["tally"]["state"])
        if st["tally"]["state"] == "closed" or not any(s.get("ok") and s.get("companies") for s in st["sessions"]): closed = True
        time.sleep(2)
    ts, g = gaps(t0, time.time())
    ok(g <= EVERY + 2, "the heartbeat kept going while Tally was slow: %d beats in 70 s, the longest gap %.1f s" % (len(ts), g))
    bs = [b.get("tallyState") for b in fake_cloud.BEATS if b["_t"] >= t0]
    ok("busy" in bs and "closed" not in bs and all(b.get("tally") for b in fake_cloud.BEATS if b["_t"] >= t0), "the heartbeat says Tally busy (open), never closed (%s)" % sorted(set(bs)))
    ok("busy" in states and not closed, "FinCom's /status: Tally busy with its companies kept, never not open (%s)" % sorted(states))
    ok(worst < 2, "and /status answered at once all along (slowest %.2f s)" % worst)
    ok(log().count("is busy (no answer in time)") == 1, "the log says it once, not at every try")
    fake_tally.CTRL["all_delay"] = 0
    ok(until(lambda: call("/status")["tally"]["state"] == "open", 150, 2), "Tally quick again: open")
    ok(until(lambda: "answers again (it was busy for" in log(), 60), "and the log says when it answered again")
    print("FinCom's cloud cannot be reached:")
    fake_cloud.CTRL["down"] = True; t0 = time.time()
    ok(until(lambda: call("/tray/status").get("reconnecting") and call("/tray/status").get("online"), 3 * EVERY), "first: reconnecting (still counted online)")
    t_off = until(lambda: not call("/tray/status").get("online") and time.time() - t0, 120, 1)
    ok(t_off and t_off >= 3 * EVERY, "offline only after three missed beats (%.0f s; %d s a beat here)" % (t_off or 0, EVERY))
    ok(log().count("FinCom could not be reached") == 1, "said once in the log; tried again quietly")
    fake_cloud.CTRL["down"] = False
    ok(until(lambda: call("/tray/status").get("online") and not call("/tray/status").get("reconnecting"), 3 * EVERY), "the cloud back: online again at the next beat")
finally:
    br.kill()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
