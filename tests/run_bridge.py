"""Run bridge 1.11.0 under PowerShell against the stand-in Tally, and call the new addresses."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.environ.get("TDSDESK_BRIDGE_RUN", _os.path.join(HERE, "out", "bridgerun"))
_os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
FVU_JAR = _os.environ.get("TDSDESK_FVU_JAR", _os.path.join(HERE, "out", "fvu", "FVU_STANDALONE.jar"))

import sys, os, json, time, subprocess, urllib.request, re
sys.path.insert(0, HERE)
import fake_tally
srv = fake_tally.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
for f in ["tds-bridge.config.json"]:
    if _os.path.exists(_os.path.join(BRUN, f)): os.remove(_os.path.join(BRUN, f))
p = subprocess.Popen([_os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=BRUN)
import threading
OUT_LINES = []
threading.Thread(target=lambda: [OUT_LINES.append(l.decode("utf-8", "replace")) for l in iter(p.stdout.readline, b"")], daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); (None if c else fails.append(w))
try:
    for i in range(60):
        time.sleep(1)
        if _os.path.exists(_os.path.join(BRUN, "tds-bridge.config.json")):
            try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
            except Exception: pass
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    def get(path, raw=False, body=None, t=300):
        req = urllib.request.Request("http://127.0.0.1:9100" + path, data=(json.dumps(body).encode() if body else None), headers={"X-Bridge-Key": key, "Origin": "https://caanshulgarg.github.io", "Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=t); d = r.read().decode("utf-8")
        return (d, r.headers.get("Content-Type")) if raw else json.loads(d)
    ping = json.loads(urllib.request.urlopen("http://127.0.0.1:9100/ping").read())
    ok(ping["version"] == "1.11.0", "bridge 1.11.0 answers")
    # connecting: only TDS Desk's own pages, and only with the code shown in the bridge window
    def raw(path, origin=None, key=None):
        h = {}
        if origin: h["Origin"] = origin
        if key: h["X-Bridge-Key"] = key
        try: r = urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:9100" + path, headers=h), timeout=10); return r.status, dict(r.headers), json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e: return e.code, dict(e.headers), json.loads(e.read() or b"{}")
    code = next((m.group(1) for l in OUT_LINES for m in [re.search(r"type the code\s+(\d{6})", l)] if m), None)
    ok(code is not None, "the bridge window shows a 6-digit connect code")
    st_, hd, j = raw("/pair?code=" + (code or ""), origin="https://evil.example")
    ok(st_ == 403 and "key" not in j and "Access-Control-Allow-Origin" not in hd, "another web page is refused, even with the right code, and cannot read the answer")
    st_, hd, j = raw("/pair", origin="https://caanshulgarg.github.io")
    ok(st_ == 403 and j.get("needCode") and "key" not in j, "TDS Desk without the code: asked for it, no key")
    st_, hd, j = raw("/pair?code=000000" if code != "000000" else "/pair?code=111111", origin="https://caanshulgarg.github.io")
    ok(st_ == 403 and "not the code" in j.get("error", ""), "a wrong code: refused")
    st_, hd, j = raw("/pair?code=" + (code or ""), origin="https://caanshulgarg.github.io")
    ok(st_ == 200 and j.get("key") == key and hd.get("Access-Control-Allow-Origin") == "https://caanshulgarg.github.io", "TDS Desk with the right code gets the key")
    st_, hd, j = raw("/pair?code=" + (code or ""), origin="https://caanshulgarg.github.io")
    ok(st_ == 403 and "key" not in j, "the code works once; connecting again needs the bridge started again")
    st_, hd, j = raw("/companies", origin="https://evil.example", key=key)
    ok(st_ == 403 and "Access-Control-Allow-Origin" not in hd, "another web page is refused even with the key")
    st_, hd, j = raw("/companies", origin="http://localhost:8150", key=key)
    ok(st_ == 200 and hd.get("Access-Control-Allow-Origin") == "http://localhost:8150", "TDS Desk run from this computer (localhost) is answered")
    co = urllib.parse.quote(fake_tally.COMPANY)
    st = get("/companies"); ok(any(c["name"] == fake_tally.COMPANY for c in st["companies"]), "company seen in the stand-in Tally")
    t0 = time.time(); x, ct = get("/daybook?company=%s&from=20250601&to=20250630" % co, raw=True)
    n = x.count("</VOUCHER>"); want = sum(1 for d, _ in fake_tally.V if "20250601" <= d <= "20250630")
    ok(n == want and "text/xml" in ct, "June day book: %d vouchers, as in Tally (%d), %.1f MB in %.1fs" % (n, want, len(x) / 1e6, time.time() - t0))
    open(_os.path.join(BRUN, "june.xml"), "w").write(x)
    try: get("/daybook?company=%s&from=20250401&to=20251231" % co, raw=True); ok(False, "long period refused")
    except urllib.error.HTTPError as e: ok("three months" in e.read().decode(), "more than three months at a time is refused")
    b = get("/balances?company=%s&from=20250401&to=20260331" % co)
    ok(b["ok"] and len(b["ledgers"]) > 2000 and b["openAsOn"] == "20250331", "balances: %d ledgers, opening as on %s" % (len(b["ledgers"]), b["openAsOn"]))
    t0 = time.time(); m = get("/syncnow", body={"company": fake_tally.COMPANY}, t=900)
    ok(len(m["months"]) >= 12 and m["from"] == "20250401", "copy now: %d months from %s in %.0fs" % (len(m["months"]), m["from"], time.time() - t0))
    s = get("/synced?company=%s" % co); ok(s["company"] == fake_tally.COMPANY and len(s["months"]) == len(m["months"]), "the copy's list is read back")
    f, ct = get("/syncfile?company=%s&file=daybook-202506.xml" % co, raw=True); ok(f.count("</VOUCHER>") == want, "a month of the copy is read back")
    # the FVU: only with the bridge key; errors come back as a list, a good file gives the .fvu
    try:
        urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:9100/fvu", data=b'{"text":"x"}', headers={"Content-Type": "application/json", "Origin": "https://caanshulgarg.github.io"}), timeout=10); ok(False, "FVU without the key refused")
    except urllib.error.HTTPError as e: ok(e.code == 401, "FVU without the bridge key is refused (%d)" % e.code)
    good = get("/fvu", body={"text": "FH^NS^R^...^valid", "name": "26Q_Q1.txt", "fvuJar": FVU_JAR, "outDir": _os.path.join(BRUN, "fvuout")}, t=120)
    ok(good["ok"] and good["accepted"] and good["fvu"].endswith("return.fvu"), "a good file: accepted, .fvu made in its own folder " + good["folder"][-15:])
    bad = get("/fvu", body={"text": "FH^BAD^line", "name": "../../evil.txt", "fvuJar": FVU_JAR, "outDir": _os.path.join(BRUN, "fvuout")}, t=120)
    ok(bad["ok"] and not bad["accepted"] and "Invalid PAN" in bad["errors"] and bad["input"].endswith("/evil.txt"), "a bad file: the FVU's errors come back; a name with folders in it is cut to the file name")
    mj = get("/fvu", body={"text": "x", "fvuJar": "/nowhere/FVU.jar"})
    ok(mj["ok"] is False and "was not found" in mj["error"], "FVU not installed: said plainly (the app shows the message)")
    try: get("/syncfile?company=%s&file=..%%2F..%%2Ftds-bridge.config.json" % co, raw=True); ok(False, "path escape refused")
    except urllib.error.HTTPError: ok(True, "only the copy's own files can be read")
finally:
    p.terminate(); p.wait(5)
# the nightly run, as the scheduled task starts it
r = subprocess.run([_os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1"), "-Sync"], capture_output=True, text=True, cwd=BRUN, timeout=900)
lr = json.load(open(_os.path.join(BRUN, "sync", "last-run.json"), encoding="utf-8-sig"))
ok(fake_tally.COMPANY in lr["done"] and not lr["failed"], "the nightly run copies every open company and stops: " + r.stdout.strip().splitlines()[-1])
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
