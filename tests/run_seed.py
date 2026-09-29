"""python3 run_seed.py - a day book exported from Tally and chosen in FinCom becomes the bridge's copy: the bridge keeps it
day by day, knows it is done up to the file's end, and never reads that period from Tally itself; only changes follow."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "seed")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, subprocess, urllib.request, urllib.parse, glob, re
sys.path.insert(0, HERE)
import fake_tally
fake_tally.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
CFG = _os.path.join(BRUN, "tds-bridge.config.json")
json.dump({"TallyTimeoutSec": 20, "KeepInStep": False, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepIdleMin": 1, "KeepFrom": "20260301", "KeepFakeFilesFirst": True}, open(CFG, "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def call(path, body=None, ctype="application/json", raw=False):
    key = json.load(open(CFG, encoding="utf-8-sig")).get("Key", "")
    data = body.encode("utf-8") if isinstance(body, str) else (json.dumps(body).encode() if body is not None else None)
    rq = urllib.request.Request("http://127.0.0.1:9100" + path, data=data, headers={"X-Bridge-Key": key, "Origin": "https://staging.fincom.live", "Content-Type": ctype})
    t = urllib.request.urlopen(rq, timeout=120).read().decode("utf-8")
    return t if raw else json.loads(t)
def logtext(): return "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
try:
    t = time.time()
    while time.time() - t < 60:
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: time.sleep(1)
    co = call("/status")["sessions"][0]["companies"][0]["name"]
    # keeping in step on before any file: the bridge waits for the files, and reads nothing of the year from Tally
    call("/keep?company=" + urllib.parse.quote(co), {"on": True})
    nw = len(fake_tally.LOG)
    t = time.time()
    while time.time() - t < 60 and "waiting for the day book files" not in logtext(): time.sleep(1)
    time.sleep(8)
    ok("waiting for the day book files" in logtext(), "with no files yet, the bridge says it waits for the day book files")
    ok(not [k for k, a, b in fake_tally.LOG[nw:] if k in ("DayBook", "TDSDeskKeepBal", "TDSDeskKeepList")], "and asks Tally nothing of the year meanwhile")
    ks = call("/keep?company=" + urllib.parse.quote(co))
    ok(ks.get("mode") == "files" and not ks.get("phase"), "FinCom is told: the year comes from files, not copied yet (%s, %s)" % (ks.get("mode"), ks.get("phase")))
    # the file the person exported from Tally (Display > Day Book > Ctrl+E): here, March from the stand-in Tally
    xml = call("/daybook?company=" + urllib.parse.quote(co) + "&from=20260301&to=20260331", raw=True)
    vch = re.findall(r"<VOUCHER\b[\s\S]*?</VOUCHER>", xml)
    mx = max(int(a) for a in re.findall(r"<ALTERID>\s*(\d+)", xml))
    body = "<ENVELOPE><BODY><DATA>" + "".join("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>" for v in vch) + "</DATA></BODY></ENVELOPE>"
    n0 = len(fake_tally.LOG)
    r1 = call("/seed?company=" + urllib.parse.quote(co) + "&from=20260301&to=20260315", "".join(body.split("</TALLYMESSAGE>", 1)[0:0]) + "<ENVELOPE><BODY><DATA>" + "".join("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>" for v in vch if re.search(r"<DATE>202603(0[1-9]|1[0-5])</DATE>", v)) + "</DATA></BODY></ENVELOPE>", "text/plain; charset=utf-8")
    r2 = call("/seed?company=" + urllib.parse.quote(co) + "&from=20260316&to=20260331", "<ENVELOPE><BODY><DATA>" + "".join("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>" for v in vch if re.search(r"<DATE>202603(1[6-9]|2\d|3[01])</DATE>", v)) + "</DATA></BODY></ENVELOPE>", "text/plain; charset=utf-8")
    ok(r1.get("ok") and r2.get("ok") and r1["entries"] + r2["entries"] == len(vch), "the day book taken in two pieces: %s + %s of %d entries" % (r1.get("entries"), r2.get("entries"), len(vch)))
    ok(not [k for k, a, b in fake_tally.LOG[n0:] if k == "DayBook"], "Tally was asked nothing for it")
    d = glob.glob(_os.path.join(BRUN, "sync", "*", "days", "202603*.xml"))
    ok(len(d) == 31, "the copy has every day of March, one file a day (empty days kept empty): %d" % len(d))
    st = json.load(open(glob.glob(_os.path.join(BRUN, "sync", "*", "keep.json"))[0], encoding="utf-8-sig"))
    ok(st.get("seeded") and st.get("phase") == "check" and st.get("next") == "20260401" and int(st.get("last", 0)) == mx, "the copy knows it is done up to 31 March, and the last change number (%s, %s, %s)" % (st.get("phase"), st.get("next"), st.get("last")))
    man = call("/synced?company=" + urllib.parse.quote(co))
    ok(man.get("keep") and [m for m in man.get("months", []) if m["ym"] == "202603"], "FinCom sees March in the copy (the manifest)")
    # opening balances from a trial balance file: for the day before the copy starts, not another day
    wrong = call("/seedbal?company=" + urllib.parse.quote(co), json.dumps({"openAsOn": "20260315", "ledgers": [{"name": "X", "open": "-5"}]}), "application/json")
    ok(wrong.get("skipped") and "20260228" in wrong["skipped"], "balances for the wrong date are refused, saying which date is needed: " + str(wrong.get("skipped")))
    good = call("/seedbal?company=" + urllib.parse.quote(co), json.dumps({"openAsOn": "20260228", "ledgers": [{"name": n, "parent": "", "open": "-1"} for n, _, _ in fake_tally.L]}), "application/json")
    st2 = json.load(open(glob.glob(_os.path.join(BRUN, "sync", "*", "keep.json"))[0], encoding="utf-8-sig"))
    bj = json.load(open(glob.glob(_os.path.join(BRUN, "sync", "*", "balances.json"))[0], encoding="utf-8-sig"))
    ok(good.get("ledgers") == len(fake_tally.L) and not st2.get("openPending") and bj.get("source") == "trial balance file", "the opening balances are taken from the trial balance, and Tally will not be asked for them")
    # keeping in step switched on: the copier does not make a first copy of March; it checks it, lightly
    # the file ran to today: the days after March have no entries in the stand-in Tally
    import datetime as _dt
    call("/seed?company=" + urllib.parse.quote(co) + "&from=20260401&to=" + _dt.date.today().strftime("%Y%m%d"), "<ENVELOPE></ENVELOPE>", "text/plain")
    call("/keep?company=" + urllib.parse.quote(co), {"on": True})           # as FinCom switches it on
    n1 = len(fake_tally.LOG)
    t = time.time()
    while time.time() - t < 360 and "in step with Tally" not in logtext(): time.sleep(2)     # after the 2-minute pause that follows FinCom giving it the file
    big = [(a, b) for k, a, b in fake_tally.LOG[n1:] if k == "DayBook" and a <= "20260331" and (b > a)]
    ok("in step with Tally" in logtext(), "the copier checked March against Tally and is in step")
    ok(len(big) <= 3, "without making a first copy of March itself (%d day book reads of more than a day there)" % len(big))
    ok("taken from the day book file" in logtext(), "the log says the copy came from the file")
    ok(not [k for k, a, b in fake_tally.LOG[n1:] if k in ("TDSDeskKeepBal", "TDSDeskBalances")], "no balances asked of Tally: they came from the trial balance")
    # a company already kept in step the usual way is not overwritten by a file
    r3 = call("/seed?company=" + urllib.parse.quote(co) + "&from=20260301&to=20260301", "<ENVELOPE></ENVELOPE>", "text/plain")
    ok(r3.get("ok") and not r3.get("skipped"), "more of a file for a company that was started from a file is still taken")
finally:
    br.kill()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 9)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
