"""python3 run_gobridge_diff.py - the Go bridge (bridge-go, 2.0.0) against bridge 1.15.0 (PowerShell), side by side on the
same stand-in Tally (made-up books): every address FinCom calls is asked of both, and the answers compared after
leaving out what differs by nature (times, versions, the program's own folder). Posting is compared too (each posts
its own entries). Needs PowerShell 7 (PWSH, default /opt/pwsh/pwsh) and the Go bridge built (GOBRIDGE, or it is built
here with Go). About 3 minutes."""
import os as _os, shutil as _sh, sys, json, time, subprocess, urllib.request, urllib.parse, urllib.error, re, uuid
HERE = _os.path.dirname(_os.path.abspath(__file__)); sys.path.insert(0, HERE)
import make_fake_books
_os.environ["TDSDESK_DATA"] = make_fake_books.main(_os.path.join(HERE, "out", "fakebooks"))
import fake_tally
GO = _os.environ.get("GOBRIDGE") or _os.path.join(HERE, "out", "fbridge")
if not _os.environ.get("GOBRIDGE"):
    subprocess.run(["go", "build", "-o", GO, "."], cwd=_os.path.join(HERE, "..", "bridge-go"), check=True, env=dict(_os.environ, GOTOOLCHAIN="local"))
fake_tally.start()
CO = fake_tally.COMPANY
DIRS = {}
procs = []
def start(name, port, cmd):
    d = _os.path.join(HERE, "out", "gdiff-" + name); _sh.rmtree(d, ignore_errors=True); _os.makedirs(d)
    _sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(d, "fake.json"))
    json.dump({"Port": port, "KeepInStep": False, "TallyTimeoutSec": 20, "GentleMs": 0}, open(_os.path.join(d, "tds-bridge.config.json"), "w"))
    env = dict(_os.environ, TDSBRIDGE_FAKE=_os.path.join(d, "fake.json"))
    if name == "ps":
        _sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(d, "TDSBridge.ps1"))
        c = [_os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(d, "TDSBridge.ps1")]
    else:
        c = [GO, "run", "--config", _os.path.join(d, "tds-bridge.config.json")]
    procs.append(subprocess.Popen(c, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=d, env=env)); DIRS[name] = (d, port)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def call(name, path, body=None, raw=False, method=None):
    d, port = DIRS[name]
    key = json.load(open(_os.path.join(d, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    rq = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode() if body is not None else None, method=method,
                                headers={"X-Bridge-Key": key, "Origin": "https://staging.fincom.live", "Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(rq, timeout=120); t = r.read().decode("utf-8"); code = r.status; h = dict(r.headers)
    except urllib.error.HTTPError as e:
        t = e.read().decode("utf-8"); code = e.code; h = dict(e.headers)
    return code, (t if raw else (json.loads(t) if t.strip() else None)), h
VOLATILE = {"time", "ms", "version", "file", "updatedAt", "startedAt", "finishedAt", "pid", "impl", "testMode", "readOnly", "paused", "wake", "at", "user", "computer",
            "lightAt", "load", "cloud", "seen", "tallyStuck", "folder", "input", "bridge", "tallyState", "busy", "tally", "beat"}
def norm(v):
    if isinstance(v, dict): return {k: norm(x) for k, x in sorted(v.items()) if k not in VOLATILE}
    if isinstance(v, list): return [norm(x) for x in v]
    if isinstance(v, (int, float)) and not isinstance(v, bool): return float(v)
    return v
def first_diff(a, b, path=""):
    if type(a) != type(b): return "%s: %r vs %r" % (path or "(top)", str(a)[:80], str(b)[:80])
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b: return "%s.%s only in %s" % (path, k, "1.15.0" if k in a else "Go")
            d = first_diff(a[k], b[k], path + "." + k)
            if d: return d
        return None
    if isinstance(a, list):
        if len(a) != len(b): return "%s: %d items vs %d" % (path, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, "%s[%d]" % (path, i))
            if d: return d
        return None
    return None if a == b else "%s: %r vs %r" % (path, str(a)[:80], str(b)[:80])
def same(path, body=None, what=None, raw=False, fix=None):
    a, b = call("ps", path, body, raw), call("go", path, body, raw)
    if raw:
        good = a[0] == b[0] and a[1] == b[1]
        ok(good, "%s: the same (%d, %d bytes)%s" % (what or path, a[0], len(a[1]), "" if good else " - DIFFERENT: %d/%d bytes" % (len(a[1]), len(b[1]))))
        return a, b
    x, y = norm(a[1]), norm(b[1])
    if fix: x, y = fix(x), fix(y)
    d = None if a[0] == b[0] else "status %d vs %d" % (a[0], b[0])
    d = d or first_diff(x, y)
    ok(d is None, "%s: the same answer%s" % (what or path, "" if d is None else " - DIFFERENT " + d))
    return a, b
try:
    start("ps", 9100, None); start("go", 9101, None)
    for n in ("ps", "go"):
        for i in range(90):
            try: urllib.request.urlopen("http://127.0.0.1:%d/ping" % DIRS[n][1], timeout=2); break
            except Exception: time.sleep(1)
    q = urllib.parse.quote(CO)
    print("addresses FinCom reads:")
    same("/companies")
    same("/status?fresh=1", fix=lambda o: {k: o[k] for k in ("ok", "mode", "onlyMySession", "sessions", "allowImport", "jobs", "mySession")})
    same("/diagnose")
    same("/ledgers?company=" + q)
    same("/ledgernames?company=" + q)
    same("/tb?company=%s&to=20260331" % q)
    same("/daybook?company=%s&from=20260301&to=20260331" % q, raw=True, what="/daybook (March, as Tally exports it)")
    same("/balances?company=%s&from=20260301&to=20260331" % q)
    same("/balances?company=%s&from=20260301&to=20260331&open=1" % q, what="/balances, openings only")
    same("/vouchers?company=%s&from=20260301&to=20260331" % q)
    same("/vouchers?company=%s&from=20260301&to=20260331&ledger=ZZ%%20Bank" % q, what="/vouchers of one ledger")
    same("/ledgervouchers?company=%s&ledger=ZZ%%20Bank&from=20260301&to=20260331" % q)
    same("/ledgerlines?company=%s&ledger=ZZ%%20Bank&from=20260301&to=20260331" % q)
    same("/ledgerbalance?company=%s&ledger=ZZ%%20Bank&from=20260301&to=20260331" % q)
    same("/ledgerbalance?company=%s&ledger=Nowhere&from=20260301&to=20260331" % q, what="/ledgerbalance of a ledger not in Tally")
    same("/tags?company=%s&from=20260301&to=20260331" % q)
    same("/readtest?company=" + q, fix=lambda o: {**o, "from": "", "to": "", "tests": [{k: v for k, v in t.items() if k != "ms"} for t in o["tests"]]})
    same("/synced?company=" + q)
    same("/keep?company=" + q, fix=lambda o: {k: v for k, v in o.items() if k not in ("schedule",)})
    same("/jobs")
    same("/cloudlink")
    same("/daybook?company=%s&from=20250101&to=20260331" % q, what="/daybook of more than three months: refused")
    same("/daybook?company=Nobody&from=20260301&to=20260331", what="/daybook of a company not open: refused")
    same("/nowhere", what="an unknown address")
    print("connecting and the key:")
    for n in ("ps", "go"):
        d, port = DIRS[n]
        try: urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%d/companies" % port, headers={"X-Bridge-Key": "wrong"}), timeout=10); code = 200
        except urllib.error.HTTPError as e: code = e.code
        ok(code == 401, "%s: a wrong key is refused (401)" % n)
        try: urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%d/companies" % port, headers={"Origin": "https://evil.example"}), timeout=10); code = 200
        except urllib.error.HTTPError as e: code = e.code
        ok(code == 403, "%s: another web page is refused (403)" % n)
    print("posting (each bridge its own entries):")
    def vch(tag, amt, date="20260320"):
        return {"id": tag, "xml": '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>%s</DATE><NARRATION>diff | TDSDesk:%s</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-%s</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Bank</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' % (date, tag, amt, amt)}
    res = {}
    for n in ("ps", "go"):
        p = "d" + n
        body = {"company": CO, "masters": [{"id": p + "m1", "xml": '<LEDGER NAME="ZZ New %s" ACTION="Create"><NAME>ZZ New %s</NAME><PARENT>Indirect Expenses</PARENT></LEDGER>' % (n, n)}],
                "vouchers": [vch(p + "v1", "100.00"), vch(p + "v2", "200.00"), {"id": p + "bad", "xml": '<VOUCHER VCHTYPE="Payment"><DATE></DATE></VOUCHER>'},
                             {"id": p + "nl", "xml": vch(p + "nl", "5.00")["xml"].replace("Office Rent", "NoSuchLedger")}]}
        res[n] = call(n, "/import", body)
    def shape(r):
        return [(x.get("kind"), x.get("ok"), x.get("verified"), re.sub(r"d(ps|go)", "", x.get("message", ""))) for x in r[1]["results"]]
    ok(res["ps"][0] == res["go"][0] == 200 and shape(res["ps"]) == shape(res["go"]), "/import: the same result for each item (%s)" % shape(res["go"]))
    jobs = {}
    for n in ("ps", "go"):
        jid = str(uuid.uuid4()); p = "j" + n
        body = {"jobId": jid, "company": CO, "masters": [], "vouchers": [vch(p + str(i), "%d.00" % (10 + i)) for i in range(30)]}
        jobs[n] = (jid, call(n, "/jobs", body))
        again = call(n, "/jobs", body)
        ok(again[1]["id"] == jid, "%s: the same job number sent again gives the same job, not a second posting" % n)
    for n in ("ps", "go"):
        jid = jobs[n][0]
        for i in range(120):
            v = call(n, "/jobs?id=" + jid)[1]
            if v["status"] in ("done", "failed") and not v.get("checking"): break
            time.sleep(1)
        jobs[n] = v
    jp, jg = jobs["ps"], jobs["go"]
    ok(jp["status"] == jg["status"] == "done" and jp["done"] == jg["done"] == 30, "a posting job of 30 entries: done by both (%s / %s)" % (jp["message"], jg["message"]))
    ok(all(r.get("verified") is True for r in jg["results"]) and len({r["vchNumber"] for r in jg["results"]}) == 30, "Go: every entry found in Tally afterwards, each with its voucher number")
    tags = fake_tally.posted_tags()
    ok(len([t for t in tags if t.startswith("TDSDesk:jgo")]) == 30, "Go: each entry is in Tally once (30 tags)")
    # a posting resumed (or queued in the cloud) checks Tally first: nothing posted twice
    jid = str(uuid.uuid4()); n0 = len(fake_tally.POSTED)
    body = {"jobId": jid, "company": CO, "masters": [], "vouchers": [vch("jgo%d" % i, "%d.00" % (10 + i)) for i in range(30)], "checkFirst": True}
    call("go", "/jobs", body)
    for i in range(120):
        v = call("go", "/jobs?id=" + jid)[1]
        if v["status"] in ("done", "failed") and not v.get("checking"): break
        time.sleep(1)
    ok(v["status"] == "done" and all(r.get("alreadyThere") for r in v["results"]) and len(fake_tally.POSTED) == n0, "Go: the same entries posted again with checkFirst are found in Tally and not sent again (%s)" % v["message"])
    same("/tags?company=%s&from=20260301&to=20260331" % q, what="/tags after posting", fix=lambda o: {**o, "vouchers": len(o["vouchers"])})
    # unpost
    gv = [r for r in jg["results"]][0]
    u = call("go", "/unpost", {"company": CO, "guid": gv["guid"], "vchType": gv["vchType"], "vchDate": gv["vchDate"], "vchNumber": gv["vchNumber"], "masterId": gv["masterId"]})
    ok(u[1]["ok"] and u[1]["how"] == "GUID", "Go: an entry removed from Tally again (%s)" % u[1].get("how"))
finally:
    for p in procs: p.kill()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
