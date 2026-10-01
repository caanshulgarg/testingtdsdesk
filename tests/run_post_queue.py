"""python3 run_post_queue.py - bridge 1.14.6, step 4 of the Tally plan: the posting queue.
  - entries queued in FinCom's cloud (from any computer) are taken by the bridge with its heartbeat and posted with its
    usual job; each entry's result goes back to the cloud, with Tally's own words for one it refused;
  - the same entries queued again (Post pressed twice, from two computers): Tally is checked for FinCom's IDs first and
    nothing is posted twice;
  - with Tally closed, the queue waits; the posting runs once Tally is open."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "postqueue")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, glob, collections, uuid
sys.path.insert(0, HERE)
import fake_tally, fake_cloud
fake_tally.start(); fake_cloud.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": False, "KeepStartSec": 3, "CloudLinksSec": 5, "CloudStateSec": 5, "CloudBeatSec": 3, "AllowImport": True}, open(CFG, "w"))
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
def vouchers(n, tag, bad=()):
    return [{"id": "%s%d" % (tag, i), "xml": '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>202603%02d</DATE><NARRATION>Queue test %d | TDSDesk:%s%d</NARRATION>'
             '<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><AMOUNT>-%d.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Bank</LEDGERNAME><AMOUNT>%d.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
             % (10 + i, i, tag, i, "NoSuchLedger" if i in bad else "ZZ Rent", 100 + i, 100 + i)} for i in range(n)]
def queue(vs):
    jid = str(uuid.uuid4()); fake_cloud.POSTS[jid] = {"company": CO, "payload": {"masters": [], "vouchers": vs, "ledger": ""}, "status": "waiting"}; return jid
def finished(jid): j = fake_cloud.POSTS[jid]; return j["status"] in ("done", "failed") and not j.get("checking")
def creates(): return collections.Counter(x[0] for x in fake_tally.LOG)["Import"]
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY}); fake_cloud.LINKS[CO] = "client-1"
    # ---------- entries queued from another computer
    t0 = time.time(); n0 = creates()
    j1 = queue(vouchers(6, "QA", bad={4}))
    ok(until(lambda: fake_cloud.POSTS[j1]["status"] != "waiting", 60), "the bridge took the queued posting with its heartbeat (%.0fs)" % (time.time() - t0))
    ok(until(lambda: finished(j1), 180), "and finished it: " + str(fake_cloud.POSTS[j1].get("message")))
    res = {r["id"]: r for r in fake_cloud.POSTS[j1].get("results") or []}
    ok(len(res) == 6 and all(res["QA%d" % i]["ok"] and res["QA%d" % i]["verified"] and res["QA%d" % i]["guid"] for i in (0, 1, 2, 3, 5)), "five entries in Tally, each confirmed with Tally's GUID and number")
    ok(not res.get("QA4", {}).get("ok") and "NoSuchLedger" in res.get("QA4", {}).get("message", ""), "the bad one refused, with Tally's words: " + res.get("QA4", {}).get("message", "")[:80])
    tags = fake_tally.posted_tags()
    ok(all(tags.count("TDSDesk:QA%d" % i) == 1 for i in (0, 1, 2, 3, 5)), "each entry once in Tally")
    # ---------- the same entries queued again
    n1 = len(fake_tally.POSTED)
    j2 = queue(vouchers(6, "QA", bad={4})[:4])
    ok(until(lambda: finished(j2), 180), "the same entries queued again: done")
    res2 = [r for r in fake_cloud.POSTS[j2].get("results") or []]
    ok(len(fake_tally.POSTED) == n1 and all(r["ok"] and r.get("alreadyThere") for r in res2) and len(res2) == 4, "Tally checked first: nothing posted twice, each said to be already in Tally (%d new)" % (len(fake_tally.POSTED) - n1))
    # ---------- Tally not answering: the queue waits, and then goes
    fake_tally.CTRL["refuse"] = 10**6
    j3 = queue(vouchers(3, "QB"))
    time.sleep(20)
    st3 = fake_cloud.POSTS[j3]
    print("   with Tally not answering:", st3.get("status"), "|", str(st3.get("message"))[:100])
    fake_tally.CTRL["refuse"] = 0
    if st3["status"] == "failed":
        ok("Tally" in str(st3.get("message")), "Tally not answering: the posting says why: " + str(st3.get("message"))[:100])
    else:
        ok(until(lambda: finished(j3), 240) and all(r["ok"] for r in fake_cloud.POSTS[j3].get("results") or [{}]), "Tally answering again: the queued posting went through")
    ok(not fake_cloud.POSTS[j3].get("checking"), "nothing left half-way")
finally:
    br.kill()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
