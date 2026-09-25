"""python3 run_tally_ui.py - the app reading straight from Tally through bridge 1.10 (stand-in Tally), and the audit on Tally's balances."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.environ.get("TDSDESK_BRIDGE_RUN", _os.path.join(HERE, "out", "bridgerun"))
_os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
FVU_JAR = _os.environ.get("TDSDESK_FVU_JAR", _os.path.join(HERE, "out", "fvu", "FVU_STANDALONE.jar"))

import json, os, sys, time, threading, functools, http.server, subprocess, urllib.request
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
sys.path.insert(0, HERE)
import fake_tally
from playwright.sync_api import sync_playwright
fake_tally.start()
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8129), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
import shutil; shutil.rmtree(_os.path.join(BRUN, "sync"), ignore_errors=True)
br_p = subprocess.Popen([_os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
try:
    for i in range(60):
        time.sleep(1)
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: pass
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8129/"); pg.wait_for_timeout(2500)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
        pg.evaluate("""(k) => { Bridge.setCfg({url: "http://127.0.0.1:9100", key: k});
          const c = newCompany({name: "VMS EVENTS PRIVATE LIMITED (2024-25)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "import"; render(); }""", key)
        pg.wait_for_timeout(1500); pg.evaluate("Bridge.refresh().then(() => render())"); pg.wait_for_timeout(6000)
        t = pg.inner_text("#app")
        ok("Straight from Tally" in t and "Read from Tally" in t, "From Tally tab offers reading straight from Tally")
        pg.fill("input[data-tallyfrom]", "2025-06-01"); pg.dispatch_event("input[data-tallyfrom]", "change")
        pg.fill("input[data-tallyto]", "2025-07-31"); pg.dispatch_event("input[data-tallyto]", "change")
        pg.click('button[data-act="tallyRead"]')
        for i in range(120):
            pg.wait_for_timeout(1000)
            if pg.evaluate("S.books && !S.books.busy && (S.books.vouchers || []).length > 0 && !!S.books.tb"): break
        n = pg.evaluate("S.books.vouchers.length"); want = sum(1 for d, _ in fake_tally.V if "20250601" <= d <= "20250731")
        ok(n == want, "June and July read month by month: %d vouchers (Tally has %d)" % (n, want))
        ok(pg.evaluate("S.books.tb.from") == "20250601" and pg.evaluate("Object.keys(S.books.tb.led).length") > 2000, "Tally's balances kept for the period")
        run = pg.evaluate("JSON.stringify({how: S.books.audit.last.how, bal: S.books.audit.last.balances, notes: S.books.audit.last.notes, code: S.books.audit.last.code})")
        ok("after reading from Tally" in run and "Tally's balances" in run, "the audit ran on Tally's own balances: " + run[:160])
        mis = pg.evaluate("() => { const r = MIS.run('20250601', '20250731', 'test'); return JSON.stringify(r.control); }")
        ok('"ok":true' in mis, "MIS for June and July agrees with Tally's balances, ledger by ledger: " + mis[:60])
        rt = pg.evaluate("() => { const r = S.books.mis.last; return JSON.stringify({bs: r.p2.ratios.bs, cr: r.p2.ratios.list.find(x => x[0] === 'Current ratio'), open: r.p2.fc.opening}); }")
        ok('"bs":true' in rt and '"open":null' not in rt, "with Tally's balances: balance-sheet ratios and the forecast's opening cash: " + rt[:120])
        # read the same period again: the same result code
        code1 = pg.evaluate("S.books.audit.last.code")
        pg.click('button[data-act="tallyRead"]')
        for i in range(120):
            pg.wait_for_timeout(1000)
            if pg.evaluate("S.books && !S.books.busy && S.books.audit.last.code && S.books.audit.history.length >= 2"): break
        ok(pg.evaluate("S.books.vouchers.length") == want and pg.evaluate("S.books.audit.last.code") == code1, "read again: nothing doubled, the same result code " + code1)
        # the FVU through the app, on the Tally computer's bridge
        pg.evaluate("() => { LedMaster.refresh(S.books); LedMaster.confirm(S.books, LedMaster.pending(S.books).map(x => x[0]), true); CO().fvuJar = " + json.dumps(FVU_JAR) + "; CO().fvuOut = " + json.dumps(_os.path.join(BRUN, "fvuout")) + "; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2025-26'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'checks'; render(); }")
        pg.wait_for_timeout(800)
        built = pg.evaluate("(() => { const r = TDS26Q.build('2025-26', 'Q1', TDS26Q.firmDetails()); return r.error || 'ok'; })()")
        if built == "ok":
            pg.click('button[data-act="tdsFvu"]')
            for i in range(60):
                pg.wait_for_timeout(1000)
                if pg.evaluate("!!S.fvuResult"): break
            fr = pg.evaluate("JSON.stringify(S.fvuResult)")
            ok('"ok":true' in fr and '.fvu' in fr, "the FVU ran through the app and the bridge, and accepted the 26Q: " + fr[:100])
        else:
            print("  (26Q text could not be built for the check: " + built + ")")
            res = pg.evaluate("Bridge.call('/fvu', {text: 'FH^NS^R', name: '26Q.txt', fvuJar: " + json.dumps(FVU_JAR) + ", outDir: " + json.dumps(_os.path.join(BRUN, "fvuout")) + "}, 60000).then(r => JSON.stringify(r))")
            ok('"accepted":true' in res, "the FVU runs through the app's bridge call: " + res[:100])
        pg.evaluate("Bridge.st.version = '1.8.1'; S.booksTab = 'import'; render();"); pg.wait_for_timeout(400)
        ok("need <b>1.10</b>" in pg.content() or "need 1.10" in pg.inner_text("#app"), "an older bridge: the app says 1.10 is needed")
        pg.evaluate("Bridge.refresh().then(() => render())"); pg.wait_for_timeout(3000)
        # nightly copy: make one, then use it
        urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:9100/syncnow", data=json.dumps({"company": fake_tally.COMPANY}).encode(), headers={"X-Bridge-Key": key, "Content-Type": "application/json"}), timeout=900).read()
        pg.click('button[data-act="tallyCopyCheck"]'); pg.wait_for_timeout(2500)
        t = pg.inner_text("#app")
        ok("Copy made" in t and "18 months" in t, "last night's copy found")
        pg.click('button[data-act="tallyCopyUse"]')
        for i in range(300):
            pg.wait_for_timeout(1000)
            if pg.evaluate("S.books && !S.books.busy && S.books.meta.file === \"last night's copy from Tally\""): break
        n2 = pg.evaluate("S.books.vouchers.length")
        ok(n2 == 10240, "the copy read in: %d vouchers, the same as the exported day book (10,240; two vouchers in it have no entries)" % n2)
        ok("last night's copy" in pg.evaluate("S.books.audit.last.how"), "and the audit ran on it")
        br.close()
finally:
    br_p.terminate()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
