"""python3 run_tds_empty.py - round 65 (the owner's GB TEXCOAT, 16-Oct-2026): the TDS page when the books ARE in but hold no TDS.
GB TEXCOAT's books: entries 1-Apr-2025 to 12-Oct-2026, a ledger "TDS194J Professional" under group "TDS" with no entries,
and "Tds Receivable FY 25-26" under Loans & Advances (TDS deducted by its customers, not by the client). The TDS page said
"TDS is worked out from the day book ... once either is in [Bring in from Tally]", as if the Day Book were missing. Now:
  - books in, no TDS: "No TDS deducted in GB TEXCOAT's books (01-Apr-2025 to 12-Oct-2026)." and "TDS ledgers with no
    entries: TDS194J Professional" (not the receivable); the salary import kept, no "Bring in from Tally";
  - the "should have deducted" check (TDSWatch.missed): CA Firm's professional fees past the 194J limit with no TDS, with
    the TDS due;
  - no entries at all: the old wording and "Bring in from Tally".
A fresh browser, TDS opened directly (goClient("books:tds")), against a stand-in for FinCom's cloud (as run_gb_pages).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tds_empty.py [--shots DIR]"""
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
srv = http.server.ThreadingHTTPServer(("localhost", 8479), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
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
    if j % 3 and d != ALL[-1]: continue                 # entries every third day, 1-Apr-2025 to the last day 12-Oct-2026
    k += 1; vs = []
    vs.append(vch(d, k * 10 + 1, "Sales", [("Buyer One", -11800), ("Sales", 10000), ("Output IGST", 1800)]))
    vs.append(vch(d, k * 10 + 2, "Purchase", [("Supplier One", 5900), ("Purchase", -5000), ("Input IGST", -900)]))
    # professional fees credited to the CA firm with no TDS (past the 194J limit of 50,000 a year): "should have deducted"
    if j % 9 == 0: vs.append(vch(d, k * 10 + 3, "Journal", [("CA Firm", 30000), ("Professional Fees", -30000)]))
    # a customer pays less its TDS: the client's TDS receivable, not TDS the client deducted
    if j % 9 == 3: vs.append(vch(d, k * 10 + 4, "Receipt", [("Buyer One", 10000), ("Bank", -9800), ("Tds Receivable FY 25-26", -200)]))
    DAY[d] = "".join("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>" for v in vs)
# the shapes the owner's Day Book has besides (the cloud's reader keeps them): Job Work In / Out Orders with order lines and
# lines that do not balance, a Delivery Note and a Receipt Note, an entry naming a ledger not in the masters, an entry with
# no party and no narration, a line with no amount
ORD = ("<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Grey Fabric</STOCKITEMNAME><RATE>45.00/Mtr</RATE><AMOUNT>-178230.00</AMOUNT><ACTUALQTY> 3960.67 Mtr</ACTUALQTY><BILLEDQTY> 3960.67 Mtr</BILLEDQTY>"
       "<BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><ORDERNO>2</ORDERNO><ORDERDUEDATE JD=\"46000\" P=\"15-Oct-2025\">15-Oct-2025</ORDERDUEDATE><AMOUNT>-178230.00</AMOUNT></BATCHALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>")
def raw(d, g, typ, body, party="GB Party", narr=""):
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>'
            '<CMPGSTIN>%s</CMPGSTIN><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>%s</NARRATION><ALTERID>9</ALTERID>%s</VOUCHER></TALLYMESSAGE>' % (typ, d, g, typ, GSTIN, party, narr, body))
NV = {d: len(re.findall(r"<VOUCHER\b", DAY.get(d, ""))) for d in ALL}
LED = [("Capital", "Capital Account", 500000), ("Bank", "Bank Accounts", -400000), ("Buyer One", "Sundry Debtors", -100000), ("Supplier One", "Sundry Creditors", 0),
       ("Sales", "Sales Accounts", 0), ("Purchase", "Purchase Accounts", 0), ("Output IGST", "Duties & Taxes", 0), ("Input IGST", "Duties & Taxes", 0),
       ("Professional Fees", "Indirect Expenses", 0), ("TDS194J Professional", "TDS", 0), ("Tds Receivable FY 25-26", "Loans & Advances (Asset)", 0), ("CA Firm", "Sundry Creditors", 0)]
GROUPS = [("Capital Account", ""), ("Bank Accounts", "Current Assets"), ("Sundry Debtors", "Current Assets"), ("Sundry Creditors", "Current Liabilities"), ("Sales Accounts", ""),
          ("Purchase Accounts", ""), ("Duties & Taxes", "Current Liabilities"), ("Indirect Expenses", ""), ("TDS", "Duties & Taxes"), ("Loans & Advances (Asset)", "Current Assets"), ("Current Assets", ""), ("Current Liabilities", "")]
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
DIRECT = """async ([name, gstin]) => {
  Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600}); Cloud.st.firm = "f1"; Cloud.st.state = "on";
  const c = newCompany({name, gstin}); c.id = "c_gb"; c.tallyName = name; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  // the owner's way: the sidebar's client, then TDS (goClient("books:tds")): nothing of the books opened before
  S.coId = c.id; S.view = "company"; render(); goClient("books:tds");
}"""
EMPTY = [False]
def route_any(r):
    if EMPTY[0]:
        u = urlparse(r.request.url)
        return r.fulfill(status=200, content_type="application/json", body="[]")
    return route(r)
def fresh(br):
    ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(STAGE + "/**", route_any); pg.goto("http://localhost:8479/"); pg.wait_for_timeout(2000)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(DIRECT, [CO, GSTIN])
    return ctx, pg
with sync_playwright() as p:
    br = p.chromium.launch()
    # ---- the books are in (1-Apr-2025 to 12-Oct-2026) and hold no TDS
    ctx, pg = fresh(br)
    came = wait_for(pg, "S.books && S.books.cid === 'c_gb' && (S.books.vouchers || []).length > 0 && !S.books.busy", 90); pg.wait_for_timeout(2500)
    ok(came, "the books come in from the cloud copy (%d entries)" % pg.evaluate("S.books ? (S.books.vouchers || []).length : -1"))
    wait_for(pg, "document.querySelector('#app [data-tds-none]')", 15)
    body = pg.inner_text("#app")
    d1, d2 = pg.evaluate("[fmtDate(tallyDate('20250401')), fmtDate(tallyDate('20261012'))]")
    box = pg.evaluate("(() => { const x = document.querySelector('#app [data-tds-none]'); return x ? x.innerText : ''; })()")
    ok("once either is in" not in body and "worked out from the day book" not in body, "books in: not the 'TDS is worked out from the day book ... once either is in' wording (%s)" % body[:200].replace("\n", " "))
    ok(re.search(r"No TDS deducted in GB TEXCOAT.s books \(" + re.escape(d1) + " to " + re.escape(d2) + r"\)\.", box),
       "books in: 'No TDS deducted in GB TEXCOAT's books (%s to %s).' (%s)" % (d1, d2, box[:160].replace("\n", " ")))
    led = re.search(r"TDS ledgers with no entries: ([^\n]*)", box)
    ok(led and "TDS194J Professional" in led.group(1) and "Receivable" not in led.group(1), "the TDS ledger with no entries named, the customers' TDS receivable not (%s)" % (led.group(0) if led else box[:300]))
    miss = pg.evaluate("(() => [...document.querySelectorAll('#app [data-tds-none] [data-tds-missed] tr')].map(t => t.innerText.replace(/\\s+/g, ' ')))()")
    ok(any("CA Firm" in r and re.search(r"[1-9][\d,]*\.\d\d", r) for r in miss), "should have deducted: CA Firm's professional fees past the 194J limit, with the amounts (%s)" % miss[:3])
    btns = pg.evaluate("[...document.querySelectorAll('#app [data-tds-none] button')].map(b => b.innerText)")
    ok("Import salary for 24Q" in btns and "Bring in from Tally" not in btns, "the salary import kept, no 'Bring in from Tally' (%s)" % btns)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "tds-empty-books-in.png"), full_page=True)
    ctx.close()
    # ---- no entries at all: as before
    EMPTY[0] = True
    ctx, pg = fresh(br); pg.wait_for_timeout(4000)
    body = pg.inner_text("#app")
    btns = pg.evaluate("[...document.querySelectorAll('#app [data-list-empty] button')].map(b => b.innerText)")
    ok("once either is in" in body and "No TDS deducted" not in body and "Bring in from Tally" in btns and "Import salary for 24Q" in btns,
       "no entries at all: 'TDS is worked out from the day book ... [Bring in from Tally] [Import salary for 24Q]' as before (%s | %s)" % (body[:160].replace("\n", " "), btns))
    ctx.close()
    br.close()
if errors: print("page errors:", errors[:3])
if fails or errors: print("FAILED: %d" % (len(fails) + len(errors))); raise SystemExit(1)
print("all passed")
