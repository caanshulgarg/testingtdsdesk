"""python3 run_bridgejobs.py - bridge 1.12: posting as a background job. Fast; the bridge answers while posting; a retried
request never posts twice; Tally slow, answering late, stuck or refusing: retried without duplicates; the worker killed
part-way: resumed, nothing sent twice; two postings to one Tally wait for each other."""
import os, sys, json, time, shutil, subprocess, threading, urllib.request, urllib.error, re, uuid, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BRUN = os.path.join(HERE, "out", "bridgejobs"); shutil.rmtree(BRUN, ignore_errors=True); os.makedirs(BRUN)
shutil.copy(os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), BRUN); shutil.copy(os.path.join(HERE, "fake.json"), BRUN)
json.dump({"TallyTimeoutSec": 8, "LogFile": os.path.join(BRUN, "tds-bridge.log")}, open(os.path.join(BRUN, "tds-bridge.config.json"), "w"))
import fake_tally
srv = fake_tally.start(); T = fake_tally
os.environ["TDSBRIDGE_FAKE"] = os.path.join(BRUN, "fake.json")
p = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)
def call(path, body=None, t=30):
    req = urllib.request.Request("http://127.0.0.1:9100" + path, data=json.dumps(body).encode() if body is not None else None, headers={"X-Bridge-Key": KEY, "Content-Type": "application/json", "Origin": "https://caanshulgarg.github.io"})
    return json.loads(urllib.request.urlopen(req, timeout=t).read())
def vouchers(n, tag, day="20250615"):
    return [{"id": "%s-%d" % (tag, i), "xml": '<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>%s</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>Bill %d TDSDesk:%s-%d</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' % (day, i, tag, i)} for i in range(n)]
def wait(jid, t=300, every=0.25):
    t0 = time.time()
    while time.time() - t0 < t:
        j = call("/jobs?id=" + jid)
        if j["status"] in ("failed", "interrupted") or (j["status"] == "done" and not j.get("checking")): return j
        time.sleep(every)
    return j
def dup_tags(): c = collections.Counter(T.posted_tags()); return [k for k, v in c.items() if v > 1]
try:
    for i in range(60):
        time.sleep(1)
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: pass
    KEY = json.load(open(os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    CO = T.COMPANY
    ok(json.loads(urllib.request.urlopen("http://127.0.0.1:9100/ping").read())["version"] == "1.12.5", "bridge 1.12.5")
    # 1. a batch of 100: handed over at once; the bridge answers while it posts; every entry created once and found in Tally
    jid = str(uuid.uuid4()); t0 = time.time()
    j = call("/jobs", {"jobId": jid, "company": CO, "masters": [{"id": "led:Rent", "xml": '<LEDGER NAME="Rent" ACTION="Create"><PARENT>Indirect Expenses</PARENT></LEDGER>'}], "vouchers": vouchers(100, "A")})
    ok(time.time() - t0 < 5 and j["id"] == jid and j["total"] == 101, "the batch is handed over at once (%.1fs): job %s, %d items" % (time.time() - t0, jid[:8], j["total"]))
    T.CTRL["delay"] = 0.05
    mid = []
    for i in range(40):
        time.sleep(0.25); t1 = time.time()
        s = call("/status", t=10); mid.append((time.time() - t1, s.get("jobs") or []))
        if any(x.get("done", 0) > 20 for x in (s.get("jobs") or [])): break
    ok(mid and max(d for d, _ in mid) < 3 and any(jobs for _, jobs in mid), "while posting the bridge answers status in %.2fs at most, and says a posting is running (%s)" % (max(d for d, _ in mid), (mid[-1][1] or [{}])[0].get("message", "")))
    # sending finishes first (TDS Desk is told at once); the read-back follows
    sent_at = None
    while time.time() - t0 < 300:
        j0 = call("/jobs?id=" + jid)
        if j0["status"] == "done": sent_at = (time.time() - t0, j0.get("checking")); break
        time.sleep(0.1)
    r = wait(jid); took = time.time() - t0
    ok(sent_at and sent_at[0] <= took, "the job says 'done' as soon as everything is sent (%.1fs), with the read-back after (checking: %s, all done %.1fs)" % (sent_at[0], sent_at[1], took))
    okN = sum(1 for x in r["results"] if x["ok"]); ver = sum(1 for x in r["results"] if x.get("verified") is True)
    ok(r["status"] == "done" and okN == 101 and len([t for t in T.posted_tags() if t.startswith("TDSDesk:A-")]) == 100, "100 vouchers and a ledger: all created, each once (%d ok, %d found in Tally), %.1fs, %.0f ms a voucher" % (okN, ver, took, 1000 * took / 101))
    ok(ver == 100, "every voucher read back from Tally")
    n0 = len(T.POSTED)
    again = call("/jobs", {"jobId": jid, "company": CO, "vouchers": vouchers(100, "A")})
    time.sleep(2)
    ok(again["id"] == jid and again["status"] == "done" and len(T.POSTED) == n0, "the same batch sent again (a retried request): the same job comes back, nothing posted again")
    T.CTRL["delay"] = 0
    # 2. Tally creates the entry but answers too late: found in Tally, not sent again
    T.CTRL.update(hang_after=1, hang_sec=12)
    jid = str(uuid.uuid4()); call("/jobs", {"jobId": jid, "company": CO, "vouchers": vouchers(5, "B")}); r = wait(jid, 200)
    tb = [t for t in T.posted_tags() if t.startswith("TDSDesk:B-")]
    ok(r["status"] == "done" and all(x["ok"] for x in r["results"]) and len(tb) == 5 and not dup_tags(), "Tally answered late: the entry is found in Tally and not sent again (%d created for 5)" % len(tb))
    ok(any("late" in (x.get("message") or "") for x in r["results"]), "and it says so: " + next((x["message"] for x in r["results"] if "late" in (x.get("message") or "")), "?"))
    # 3. Tally stuck before creating: tried again, created once
    T.CTRL.update(hang_before=1, hang_sec=12)
    jid = str(uuid.uuid4()); call("/jobs", {"jobId": jid, "company": CO, "vouchers": vouchers(5, "C")}); r = wait(jid, 200)
    tc = [t for t in T.posted_tags() if t.startswith("TDSDesk:C-")]
    ok(r["status"] == "done" and all(x["ok"] for x in r["results"]) and len(tc) == 5 and not dup_tags(), "Tally stuck before creating: tried again, each created once (%d for 5)" % len(tc))
    # 4. Tally closes the connection: tried again
    T.CTRL.update(refuse=2)
    jid = str(uuid.uuid4()); call("/jobs", {"jobId": jid, "company": CO, "vouchers": vouchers(5, "D")}); r = wait(jid, 200)
    td = [t for t in T.posted_tags() if t.startswith("TDSDesk:D-")]
    ok(r["status"] == "done" and all(x["ok"] for x in r["results"]) and len(td) == 5 and not dup_tags(), "Tally dropped the connection twice: tried again, all 5 created once")
    # 5. the worker killed while Tally was still answering a batch it had already made (computer restarted):
    #    interrupted; resumed, the batch is found in Tally, nothing sent twice
    T.CTRL.update(hang_after=1, hang_sec=6)
    jid = str(uuid.uuid4()); call("/jobs", {"jobId": jid, "company": CO, "vouchers": vouchers(30, "E")})
    for i in range(80):
        time.sleep(0.25); s = call("/jobs?id=" + jid)
        if len([t for t in T.posted_tags() if t.startswith("TDSDesk:E-")]) >= 10 and s.get("pid"): break
    before = len([t for t in T.posted_tags() if t.startswith("TDSDesk:E-")])
    subprocess.run(["kill", "-9", str(s["pid"])])
    time.sleep(7); s = call("/jobs?id=" + jid)
    ok(s["status"] == "interrupted" and "Resume" in s["message"], "the posting process killed after %d of 30: shown as interrupted" % before)
    T.CTRL["delay"] = 0
    call("/jobs/resume", {"id": jid}); r = wait(jid, 200)
    te = [t for t in T.posted_tags() if t.startswith("TDSDesk:E-")]
    ok(r["status"] == "done" and len(set(x["id"] for x in r["results"])) == 30 and all(x["ok"] for x in r["results"]) and len(te) == 30 and not dup_tags(),
       "resumed: all 30 in Tally, each once (%d created, %d found already there)" % (len(te), sum(1 for x in r["results"] if x.get("alreadyThere"))))
    ok(sum(1 for x in r["results"] if x.get("alreadyThere")) >= 10, "the batch Tally made before the stop was found there, not sent again")
    # 7. a bad entry among good ones: the good ones go in the fast way, the bad one gets Tally's own reason
    bad = vouchers(10, "H"); bad[4]["xml"] = bad[4]["xml"].replace("<LEDGERNAME>Rent</LEDGERNAME>", "<LEDGERNAME>NoSuchLedger</LEDGERNAME>")
    jid = str(uuid.uuid4()); call("/jobs", {"jobId": jid, "company": CO, "vouchers": bad}); r = wait(jid)
    rb = {x["id"]: x for x in r["results"]}
    ok(sum(1 for x in r["results"] if x["ok"]) == 9 and not rb["H-4"]["ok"] and "NoSuchLedger" in rb["H-4"]["message"] and len([t for t in T.posted_tags() if t.startswith("TDSDesk:H-")]) == 9 and not dup_tags(),
       "one bad entry in ten: nine in Tally, the bad one refused with Tally's reason: " + rb["H-4"]["message"][:60])
    # 6. two postings to one Tally at once: the second waits; both complete, no duplicates
    T.CTRL["delay"] = 0.05
    j1, j2 = str(uuid.uuid4()), str(uuid.uuid4())
    call("/jobs", {"jobId": j1, "company": CO, "vouchers": vouchers(20, "F")}); call("/jobs", {"jobId": j2, "company": CO, "vouchers": vouchers(20, "G")})
    time.sleep(1.5); s2 = call("/jobs?id=" + j2)
    r1, r2 = wait(j1), wait(j2)
    ok(r1["status"] == r2["status"] == "done" and len([t for t in T.posted_tags() if t[8] in "FG"]) == 40 and not dup_tags(), "two postings at once: both done, 40 created, none twice (second meanwhile: %s)" % s2["message"])
    ok(call("/jobs")["jobs"] == [], "no posting left running")
finally:
    p.terminate(); p.wait(5)
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
