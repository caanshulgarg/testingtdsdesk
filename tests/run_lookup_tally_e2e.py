"""python3 run_lookup_tally_e2e.py - Look up through the real bridge against a stand-in Tally: ledger names come from Tally,
the trial balance is one light read, asking again does not touch Tally, and a ledger is read straight from Tally."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "lookuprun")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, threading, functools, http.server, subprocess, urllib.request
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
sys.path.insert(0, HERE)
import fake_tally
from playwright.sync_api import sync_playwright
fake_tally.start()
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8143), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
json.dump({"TallyTimeoutSec": 20}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
br_p = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails, errors = [], []
def wait_for(pg, js, timeout=120):
    t = time.time()
    while time.time() - t < timeout:
        if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return True
        time.sleep(0.25)
    return False
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CO = fake_tally.COMPANY
SETUP = """([k, name]) => { Bridge.setCfg({url: "http://127.0.0.1:9100", key: k});
  const c = newCompany({name, gstin: "07AADCV3366N1ZU"}); c.tallyName = name; S.companies[c.id] = c; S.coId = c.id; S.view = "company";
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  // an old copy of the books in FinCom, with a ledger that is no longer in Tally
  S.books = {cid: c.id, loading: false, vouchers: [{id: "old1", date: "20240405", type: "Journal", no: "1", party: "", narr: "", ent: [{l: "OLD LEDGER FROM LAST YEAR", a: -100}, {l: "Cash", a: 100}]}],
    meta: {from: "20240405", to: "20240405", at: "2025-01-01T00:00:00Z"}, under: {"OLD LEDGER FROM LAST YEAR": "Indirect Expenses"}, map: {}, challans: [], alloc: {}};
  S.tab = "books"; S.booksTab = "lookup"; render(); return c.id; }"""
try:
    for i in range(60):
        time.sleep(1)
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: pass
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8143/"); pg.wait_for_timeout(2000)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate(SETUP, [key, CO]); pg.evaluate("Bridge.refresh()"); pg.wait_for_timeout(1500)
        ok(pg.evaluate("Bridge.st.version") == "1.12.11", "bridge 1.12.11 running")
        ok(pg.evaluate("LK.live()"), "Look up sees Tally live")
        pg.evaluate("render()"); pg.wait_for_timeout(4000)
        names = pg.evaluate("FC.ledgers()")
        ok(len(names) == len(fake_tally.L), "ledger names while typing come from Tally: %d of %d" % (len(names), len(fake_tally.L)))
        ok("OLD LEDGER FROM LAST YEAR" not in names, "the old ledger from the books read earlier is not offered")
        ok(pg.locator("#lkLeds option").count() == len(fake_tally.L), "the list under the ledger box is Tally's")
        ok(pg.evaluate("LK.useTally(Object.assign({}, S.lk, {kind: 'tb'}), 'auto')"), "Tally is the source by default when the bridge is connected")
        # the trial balance: one light read
        fake_tally.REQS.clear()
        t0 = time.time()
        pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
        wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
        secs = time.time() - t0
        r = pg.evaluate("({src: S.lk.res.src, dr: S.lk.res.dr, cr: S.lk.res.cr, n: S.lk.res.rows.length})")
        ok(r["src"] == "tally" and r["n"] > 20, "trial balance read from Tally: %d ledgers in %.1fs" % (r["n"], secs))
        mv = fake_tally.amounts_until("20260331"); held = sum(ob + mv.get(n.replace("&amp;", "&"), mv.get(n, 0)) for n, p_, ob in fake_tally.L)
        ok(abs((r["dr"] - r["cr"]) + held) < 1, "the trial balance is exactly what this Tally holds (its sample books are off by %.2f themselves)" % held)
        ok(fake_tally.REQS.get("TDSDeskTB", 0) == 1 and not fake_tally.REQS.get("TDSDeskBalances") and not fake_tally.REQS.get("DayBook"), "Tally was asked once, lightly: " + json.dumps(fake_tally.REQS))
        # asking again does not touch Tally
        fake_tally.REQS.clear()
        pg.click('[data-lk="show"]'); pg.wait_for_timeout(800)
        ok(sum(fake_tally.REQS.values()) == 0, "asking again comes from the ten-minute copy, not Tally: " + json.dumps(fake_tally.REQS))
        ok("read at" in pg.inner_text(".lk-res"), "the answer says when it was read")
        pg.click('[data-lk="fresh"]'); wait_for(pg, "!S.lk.busy"); pg.wait_for_timeout(300)
        ok(fake_tally.REQS.get("TDSDeskTB", 0) == 1, "Read again asks Tally once more")
        # a ledger straight from Tally
        bank = "ICICI BANK ACCOUNT-3812"
        fake_tally.REQS.clear()
        pg.fill("#lkAsk", bank.lower() + " for august 2025"); pg.keyboard.press("Enter")
        wait_for(pg, "S.lk.res && S.lk.res.kind === 'ledger' && !S.lk.busy")
        lr = pg.evaluate("({src: S.lk.res.src, led: S.lk.res.led, from: S.lk.res.from, rows: S.lk.res.rows.length, open: S.lk.res.open, close: S.lk.res.close, dr: S.lk.res.dr, cr: S.lk.res.cr})")
        ok(lr["src"] == "tally" and lr["led"] == bank and lr["from"] == "20250801" and lr["rows"] > 10, "the ledger is read from Tally, with its entries: " + json.dumps({k: lr[k] for k in ("led", "rows")}))
        ok(abs(lr["open"] + lr["dr"] - lr["cr"] - lr["close"]) < 1, "opening plus entries is Tally's closing")
        ok(not fake_tally.REQS.get("DayBook") and not fake_tally.REQS.get("TDSDeskBalances"), "no day book and no full balances for one ledger: " + json.dumps(fake_tally.REQS))
        # a group from Tally: two light reads, then from the copy
        fake_tally.REQS.clear()
        pg.click('[data-lkkind="group"]'); pg.fill('[data-lkf="grp"]', "Sundry Debtors"); pg.evaluate("S.lk.from = '20250401'; S.lk.to = '20260331';")
        pg.click('[data-lk="show"]'); wait_for(pg, "S.lk.res && S.lk.res.kind === 'group' && !S.lk.busy")
        g = pg.evaluate("({src: S.lk.res.src, n: S.lk.res.rows.length})")
        ok(g["src"] == "tally" and g["n"] > 0 and fake_tally.REQS.get("TDSDeskTB", 0) <= 2, "a group from Tally in at most two light reads: %d ledgers, %s" % (g["n"], json.dumps(fake_tally.REQS)))
        # the books can still be chosen
        pg.click('[data-lksrc="books"]'); pg.wait_for_timeout(200)
        ok(pg.evaluate("S.lk.src") == "books", "the books read into FinCom can be chosen instead")
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
        br.close()
finally:
    br_p.terminate()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
