"""python3 run_vendorrecon_e2e.py - a vendor's ledger (their books, Dr balances) against the party's ledger in the stand-in
Tally through the real bridge: matched entries, a bill missing on their side, a payment missing in Tally, a different amount,
a different opening balance, where the balances first move apart, and the Excel files for this and the bank reconciliation."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "vendorrun")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, threading, functools, http.server, subprocess, urllib.request, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
sys.path.insert(0, HERE)
import fake_tally
from playwright.sync_api import sync_playwright
fake_tally.start()
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8135), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
json.dump({"TallyTimeoutSec": 20}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
br_p = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LED, FROM, TO = ("Peregrine Tent Works" if fake_tally._bd.FIXTURE else "A S EVENTS"), "20250401", "20251231"   # a supplier with two bills in the period
# the party's entries in Tally (payable +: a credit to the vendor)
lines = []
for d, p in fake_tally.V:
    if "<LEDGERNAME>%s</LEDGERNAME>" % LED not in p: continue
    m = re.search(r"<LEDGERNAME>%s</LEDGERNAME>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>" % re.escape(LED), p, re.S)
    num = (re.search(r"<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>", p) or [0, ""])[1]
    vt = (re.search(r"<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>", p) or [0, ""])[1]
    lines.append((d, float(m.group(1)), num, vt))
ob = [x for x in fake_tally.L if x[0] == LED][0][2]
before = sum(a for d, a, _, _ in lines if d < FROM)
t_open = round(ob + before, 2)
inp = [x for x in lines if FROM <= x[0] <= TO]
def vendor_csv(path, open_bal, rows):
    bal = open_bal; out = ["Date,Particulars,Debit,Credit,Balance", "01/04/2025,Opening Balance,,,%.2f %s" % (abs(open_bal), "Dr" if open_bal >= 0 else "Cr")]
    for d, a, narr in rows:
        bal += a
        out.append("%s/%s/%s,%s,%s,%s,%.2f %s" % (d[6:8], d[4:6], d[:4], narr, "%.2f" % a if a > 0 else "", "%.2f" % -a if a < 0 else "", abs(bal), "Dr" if bal >= 0 else "Cr"))
    open(path, "w").write("\n".join(out) + "\n")
bills = [x for x in inp if x[1] > 0]
drop = bills[0]                      # a bill the vendor does not show
change = bills[1]                    # a bill the vendor shows with another amount
rows = []
for d, a, n, vt in inp:
    if (d, a, n) == drop[:3]: continue
    rows.append((d, round(a * 1.05, 2) if (d, a, n) == change[:3] else a, "%s %s" % (vt, n)))
extra_pay = ("20250920", -12345.0, "NEFT payment received UTR99887766")
rows.append(extra_pay); rows.sort(key=lambda x: x[0])
CSV1 = _os.path.join(BRUN, "vendor-ledger.csv"); vendor_csv(CSV1, t_open, rows)
CSV2 = _os.path.join(BRUN, "vendor-ledger-open.csv"); vendor_csv(CSV2, t_open + 1000, rows)
try:
    for i in range(60):
        time.sleep(1)
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: pass
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(accept_downloads=True, viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8135/"); pg.wait_for_timeout(2000)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate("""(k) => { Bridge.setCfg({url: "http://127.0.0.1:9100", key: k}); /* FinCom 2.3.0 sends nothing to a bridge that has not proved itself; the PowerShell bridge 1.15.0 run here cannot, so this end-to-end test of posting takes it as proved */ Bridge.ensureProven = async () => true; 
          const c = newCompany({name: "@CO@", gstin: "@GSTIN@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "invoices"; render(); }""".replace("@CO@", fake_tally.COMPANY).replace("@GSTIN@", fake_tally._bd.GSTIN), key)
        pg.evaluate("Bridge.refresh()"); pg.wait_for_timeout(1500)
        pg.evaluate("syncLedgersFromTally(true)"); pg.evaluate("render()"); pg.wait_for_timeout(300)
        # 02-Oct-2026 (FinCom Bridge 2.1.4 asks Tally for no balance): the ledger's balance comes from FinCom's copy, stood
        # in here by the stand-in Tally's balance on the day, as the copy would hold it
        pg.evaluate("""() => { TCloud.ledgerAt = async (cid, led, to) => { const nx = isoToTally(addDays(Audit.iso(to), 1));
          const j = await Bridge.call('/ledgerbalance?company=' + encodeURIComponent(CO().name) + '&from=' + nx + '&to=' + nx + '&ledger=' + encodeURIComponent(led) + Bridge.pinQ(), null, 60000); return -r2(num(j.open)); }; }""")
        ok(pg.locator('button[title^="Match a vendor"]').count() == 1, "the purchase page has 'Reconcile a vendor ledger'")
        pg.click('button[title^="Match a vendor"]'); pg.wait_for_timeout(300)
        opts = pg.evaluate("Array.from(document.querySelectorAll('#vrLedgers option')).map(o => o.value)")
        ok(LED in opts, "the vendor's ledger can be chosen by typing (a list of %d Tally ledgers, creditors first)" % len(opts))
        pg.fill('input[aria-label="Vendor ledger in Tally"]', LED); pg.fill('input[aria-label="From"]', "2025-04-01"); pg.fill('input[aria-label="Up to"]', "2025-12-31")
        pg.set_input_files('input[aria-label="Vendor’s ledger file"]', CSV1); pg.wait_for_timeout(300)
        pg.click('.vrec button:text-is("Reconcile")')
        for i in range(120):
            pg.wait_for_timeout(500)
            if pg.evaluate("!!(S.vrec && S.vrec.res) || !!(S.vrec && !S.vrec.busy && document.getElementById('toast').textContent.includes('Could not'))"): break
        R = pg.evaluate("S.vrec.res && {pairs: S.vrec.res.pairs.length, onlyV: S.vrec.res.onlyV.length, onlyT: S.vrec.res.onlyT.length, differ: S.vrec.res.differ.length, openDiff: S.vrec.res.openDiff, un: S.vrec.res.unexplained, sides: S.vrec.res.sides, t: S.vrec.res.tClose, v: S.vrec.res.vClose, first: (S.vrec.res.timeline[0] || {}).date}")
        print("   ", R, "Tally lines in period:", len(inp))
        ok(R and R["onlyT"] == 1 and R["onlyV"] == 1 and R["differ"] == 1 and R["pairs"] == len(inp) - 2, "matched all but three: a bill missing on the vendor's side, a payment missing in Tally, a different amount")
        ok(R and R["openDiff"] == 0 and R["un"] == 0, "opening balances agree, and nothing is left unexplained (%s)" % R)
        ok(R and "vendor's books" in R["sides"], "the vendor's file is read as their books (their debit is a bill to us)")
        first = min(drop[0], change[0], extra_pay[0])
        ok(R and R["first"] == "%s-%s-%s" % (first[:4], first[4:6], first[6:]), "it says where the balances first move apart: %s" % (R and R["first"]))
        if os.environ.get("SHOT"): pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=os.environ["SHOT"], full_page=True)
        t = pg.inner_text(".vrec")
        ok("first move apart" in t and "In the vendor" in t and "In Tally, not in the vendor" in t and "Same document, different amount" in t, "the page shows the statement and the three lists")
        with pg.expect_download() as dl: pg.click('.vrec button:text-is("Download Excel")')
        f = dl.value; path = f.path()
        ok(f.suggested_filename.endswith(".xlsx") and _os.path.getsize(path) > 2000, "the reconciliation downloads as Excel (%s)" % f.suggested_filename)
        # the same, with another opening balance on the vendor's side
        pg.set_input_files('input[aria-label="Vendor’s ledger file"]', CSV2); pg.wait_for_timeout(300); pg.click('.vrec button:text-is("Reconcile")')
        for i in range(120):
            pg.wait_for_timeout(500)
            if pg.evaluate("!!(S.vrec && S.vrec.res)"): break
        R2 = pg.evaluate("S.vrec.res && {openDiff: S.vrec.res.openDiff, un: S.vrec.res.unexplained}")
        ok(R2 and R2["openDiff"] == 1000 and R2["un"] == 0 and "opening balances differ" in pg.inner_text(".vrec"), "a different opening balance is named as such (%s)" % R2)
        br.close()
finally:
    br_p.kill()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
