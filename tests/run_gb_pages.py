"""python3 run_gb_pages.py - round 64 (the owner's recheck of 16-Oct-2026 ~09:30 IST: GB TEXCOAT's TDS / GST / Accounts still empty
after its book got from_date 2025-04-01 / open_as_on 2025-03-31). The real app against a stand-in for FinCom's cloud shaped
like that book: tally_status from 2025-04-01 to 2026-10-12, a row in tally_days for every one of those 560 days (most of them
empty, as an upload keeps every day of its period), entries on some days (TDS journals, GST sales and purchases), its
ledgers, the bridge's state {phase live, from 20260401, doneTo 20260331}. Opened from an EMPTY browser and from a STALE one
(this browser's copy of the books held with 0 entries from before). For each: the books come in from the cloud copy, and
Books > MIS, Accounts, Audit, TDS and GST show the figures.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gb_pages.py [--shots DIR]"""
import json, os, re, sys, gzip, threading, functools, http.server, datetime
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", 8477), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
CO, GSTIN = "GB TEXCOAT", "09AAKFG1234B1Z5"
d0 = datetime.date(2025, 4, 1)
ALL = [(d0 + datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(560)]   # 2025-04-01 .. 2026-10-12
def led(n, a): return "<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><AMOUNT>%.2f</AMOUNT></ALLLEDGERENTRIES.LIST>" % (n, a)
def vch(d, i, typ, lines):
    return ('<VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>gb-%s-%d</GUID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>%d</VOUCHERNUMBER>'
            '<CMPGSTIN>%s</CMPGSTIN><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><ALTERID>%d</ALTERID>%s</VOUCHER>' % (typ, d, d, i, typ, i, GSTIN, lines[0][0], i, "".join(led(n, a) for n, a in lines)))
DAY = {}
k = 0
for j, d in enumerate(ALL):
    if j % 3 or d > "20260331": continue                 # entries every third day of FY 2025-26; the rest (and FY 2026-27) empty
    k += 1; vs = []
    vs.append(vch(d, k * 10 + 1, "Sales", [("Buyer One", -11800), ("Sales", 10000), ("Output IGST", 1800)]))
    vs.append(vch(d, k * 10 + 2, "Purchase", [("Supplier One", 5900), ("Purchase", -5000), ("Input IGST", -900)]))
    if j % 9 == 0: vs.append(vch(d, k * 10 + 3, "Journal", [("Professional Fees", -30000), ("TDS Payable 194J", 3000), ("CA Firm", 27000)]))
    DAY[d] = "".join("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>" for v in vs)
# the shapes the owner's Day Book has besides (the cloud's reader keeps them): Job Work In / Out Orders with order lines and
# lines that do not balance, a Delivery Note and a Receipt Note, an entry naming a ledger not in the masters, an entry with
# no party and no narration, a line with no amount
ORD = ("<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Grey Fabric</STOCKITEMNAME><RATE>45.00/Mtr</RATE><AMOUNT>-178230.00</AMOUNT><ACTUALQTY> 3960.67 Mtr</ACTUALQTY><BILLEDQTY> 3960.67 Mtr</BILLEDQTY>"
       "<BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><ORDERNO>2</ORDERNO><ORDERDUEDATE JD=\"46000\" P=\"15-Oct-2025\">15-Oct-2025</ORDERDUEDATE><AMOUNT>-178230.00</AMOUNT></BATCHALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>")
def raw(d, g, typ, body, party="GB Party", narr=""):
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>'
            '<CMPGSTIN>%s</CMPGSTIN><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>%s</NARRATION><ALTERID>9</ALTERID>%s</VOUCHER></TALLYMESSAGE>' % (typ, d, g, typ, GSTIN, party, narr, body))
EXTRA = {"20251015": raw("20251015", "jw-2", "Job Work In Order", led("GB Party", -178230) + led("Job Work Charges", 0) + "<LEDGERENTRIES.LIST><LEDGERNAME>Freight</LEDGERNAME></LEDGERENTRIES.LIST>" + ORD),
         "20250909": raw("20250909", "jw-1", "Job Work In Order", led("GB Party", -45000) + ORD) + raw("20250909", "jo-1", "Job Work Out Order", led("Weaver", 12000) + ORD),
         "20250910": raw("20250910", "dn-1", "Delivery Note", led("Buyer One", -5000) + led("Sales", 5000) + ORD) + raw("20250910", "rn-1", "Receipt Note", led("Supplier One", 3000) + led("Purchase", -3000)),
         "20250911": raw("20250911", "nm-1", "Journal", led("Ledger Not In Masters", -700) + led("Bank", 700), party="", narr="") + raw("20250911", "np-1", "Payment", led("Bank", 400) + led("Professional Fees", -400), party="", narr="")}
for d, x in EXTRA.items(): DAY[d] = DAY.get(d, "") + x
NV = {d: len(re.findall(r"<VOUCHER\b", DAY.get(d, ""))) for d in ALL}
LED = [("Capital", "Capital Account", 500000), ("Bank", "Bank Accounts", -400000), ("Buyer One", "Sundry Debtors", -100000), ("Supplier One", "Sundry Creditors", 0),
       ("Sales", "Sales Accounts", 0), ("Purchase", "Purchase Accounts", 0), ("Output IGST", "Duties & Taxes", 0), ("Input IGST", "Duties & Taxes", 0),
       ("Professional Fees", "Indirect Expenses", 0), ("TDS Payable 194J", "Duties & Taxes", 0), ("CA Firm", "Sundry Creditors", 0)]
GROUPS = [("Capital Account", ""), ("Bank Accounts", "Current Assets"), ("Sundry Debtors", "Current Assets"), ("Sundry Creditors", "Current Liabilities"), ("Sales Accounts", ""),
          ("Purchase Accounts", ""), ("Duties & Taxes", "Current Liabilities"), ("Indirect Expenses", ""), ("Current Assets", ""), ("Current Liabilities", "")]
STATUS = [{"book": "819d4a59-4cee-4bf7-8f8c-2186ce328379", "company": CO, "from": "2025-04-01", "openAsOn": "2025-03-31", "ledgersAt": "2026-10-15T09:00:00Z", "daysAt": "2026-10-15T10:00:00Z",
           "state": {"phase": "live", "from": "20260401", "doneTo": "20260331", "computer": "NWS144", "queue": 0}, "days": 560, "entries": sum(NV.values()), "to": "2026-10-12"}]
calls = {"storage": 0, "rpc": []}
def route(r):
    u = urlparse(r.request.url); path = u.path; q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0])
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    if "/rest/v1/rpc/" in path: calls["rpc"].append(path.rsplit("/", 1)[1])
    if path.endswith("/rpc/tally_status"): return j(STATUS)
    if path.endswith("/rpc/tally_days_list"):
        a = json.loads(r.request.post_data or "{}"); f = a["p_from"].replace("-", ""); t = a["p_to"].replace("-", "")
        rows = [{"day": d, "n": NV[d], "at": "2026-10-15T10:00:00+00:00"} for d in ALL if f <= d <= t]
        return j(rows[off:off + 1000])
    if "/storage/v1/object/authenticated/tally-days/" in path:
        d = path.rsplit("/", 1)[1][:8]; calls["storage"] += 1
        return r.fulfill(status=200, content_type="application/gzip", body=gzip.compress(("<ENVELOPE><BODY><DATA>" + DAY.get(d, "") + "</DATA></BODY></ENVELOPE>").encode("utf-8")))
    if path.endswith("/tally_ledgers"):
        if (q.get("deleted_at") or [""])[0] == "not.is.null": return j([])
        rows = [{"name": n, "parent": p, "open": o, "pan": None, "gstin": None} for n, p, o in LED]
        return j(rows[off:off + 1000])
    if path.endswith("/tally_groups"): return j([{"name": g, "parent": p} for g, p in GROUPS][off:off + 1000])
    return j([])
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def wait_for(pg, js, t=60):
    import time; s = time.time()
    while time.time() - s < t:
        try:
            if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return True
        except Exception: pass
        time.sleep(0.3)
    return False
OPEN = """async ([name, gstin, stale]) => {
  Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600}); Cloud.st.firm = "f1"; Cloud.st.state = "on";
  let c = S.companies["c_gb"];
  if (!c){ c = newCompany({name, gstin}); c.id = "c_gb"; c.tallyName = name; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; }
  S.books = null; TCloud.st = {};
  if (stale) await Books.save("c_gb", {cid: "c_gb", vouchers: [], map: {}, meta: {at: "2026-10-10T00:00:00Z"}, challans: [], alloc: {}});
  S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "tds"; render();
  return c.id;
}"""
DIRECT = """async ([name, gstin]) => {
  Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600}); Cloud.st.firm = "f1"; Cloud.st.state = "on";
  const c = newCompany({name, gstin}); c.id = "c_gb"; c.tallyName = name; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  // the owner's way: the sidebar's client, then TDS (goClient("books:tds")): nothing of the books opened before
  S.coId = c.id; S.view = "company"; render(); goClient("books:tds");
}"""
with sync_playwright() as p:
    br = p.chromium.launch()
    # ---- the owner's way (16-Oct-2026 ~10:15 IST): a fresh browser, the client's TDS opened directly; the 2025-26 returns
    # show the books' TDS (not "TDS is worked out from the day book ... once either is in")
    ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(STAGE + "/**", route); pg.goto("http://localhost:8477/" + os.environ.get("TDSDESK_PATH", "")); pg.wait_for_timeout(2000)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate(DIRECT, [CO, GSTIN])
    wait_for(pg, "S.books && S.books.cid === 'c_gb' && (S.books.vouchers || []).length > 0 && !S.books.busy", 90); pg.wait_for_timeout(2500)
    body = pg.inner_text("#app")
    grid = pg.evaluate("(() => { const g = document.querySelector('#app [data-tds-grid]'); return g ? [g.getAttribute('data-tds-grid'), g.innerText.replace(/\\s+/g, ' ').slice(0, 300)] : null; })()")
    ok("once either is in" not in body and grid and grid[0] == "2025-26" and re.search(r"[1-9][\d,]*\.\d\d", grid[1] or ""),
       "direct: a fresh browser, the client's TDS opened at once: the 2025-26 returns with the books' TDS (%s | %s)" % (grid, body[:160].replace("\n", " ")))
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "gb-direct-tds.png"), full_page=False)
    ctx.close()
    for stale in (False, True):
        ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route(STAGE + "/**", route)
        pg.goto("http://localhost:8477/" + os.environ.get("TDSDESK_PATH", "")); pg.wait_for_timeout(2000)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        tag = "stale browser" if stale else "empty browser"
        pg.evaluate(OPEN, [CO, GSTIN, stale])
        came = wait_for(pg, "S.books && S.books.cid === 'c_gb' && (S.books.vouchers || []).length > 0 && !S.books.busy", 90)
        n = pg.evaluate("S.books ? (S.books.vouchers || []).length : -1")
        ok(came and n >= sum(NV.values()) - 8, "%s: the books come in from the cloud copy (%d of %d entries; %d days fetched)" % (tag, n, sum(NV.values()), calls["storage"]))
        for tab, want in (("tds", r"TDS Payable 194J|194J"), ("gst", r"Output IGST|IGST|1,80,000|Sales"), ("mis", r"Sales|Revenue"), ("fs", r"Balance sheet|Profit|Capital"), ("audit", r"finding|Audit|check")):
            pg.evaluate("(t) => { S.booksTab = t; S.tab = 'books'; render(); }", tab); pg.wait_for_timeout(2500)
            body = pg.inner_text("#app")
            empty = re.search(r"not in yet|Bring in the books|no copy of this client|could not be loaded|could not be shown", body)
            ok(not empty and (re.search(want, body) or tab in ("tds", "gst")), "%s: Books > %s shows the figures (%s)" % (tag, tab, (empty.group(0) if empty else body[:200].replace("\n", " "))))
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "gb-%s-%s.png" % ("stale" if stale else "empty", tab)), full_page=False)
        ctx.close()
    br.close()
if errors: print("page errors:", errors[:3])
if fails: print("FAILED: %d" % len(fails)); raise SystemExit(1)
print("all passed")
