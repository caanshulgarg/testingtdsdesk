"""python3 run_fresh_browser.py - server-books (review of 01-Oct-2026): a client opened on another computer showed nil
everywhere, because the day book lived in the first browser only. Now the books come from the cloud copy on opening the
client, with no button and no upload. Two browsers:
  - "the first computer": the books already in the browser (tests/data/books-cache.json, the staging copy of Testing AAD);
  - "another computer": a fresh browser with empty storage, signed in to the firm; FinCom's cloud is a stand-in here that
    gives the same books, day by day, as staging keeps them (Tally's XML, gzipped).
The fresh browser must show the MIS profit of FY 2025-26 (1,13,14,193.29, as Tally) and the same TDS and GST figures.
A day book chosen while the cloud is unreachable waits in the browser and goes up on its own the next time the client
is opened. Needs tests/data/books-cache.json (local only, never committed); skipped without it.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_fresh_browser.py"""
import os, re, json, gzip, threading, functools, http.server, time
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json"))
if not os.path.exists(CACHE):
    print("skipped: no tests/data/books-cache.json (built from staging, kept out of git)"); raise SystemExit(0)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8167), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
books = json.load(open(CACHE))
GSTIN = "09AANFG3202D1ZR"; PROFIT = 11314193.29
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def wait_for(pg, js, t=120):
    s = time.time()
    while time.time() - s < t:
        try:
            if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return True
        except Exception: pass
        time.sleep(0.4)
    return False
# ---------- the cloud's day files: each entry as Tally's day book gives it (cloud_books.py)
import sys; sys.path.insert(0, HERE); import cloud_books
by_day, LED, GRP = cloud_books.build(books)
DAYS = sorted(by_day); AT = "2026-10-01T07:00:00+00:00"
calls = {"storage": 0, "upload": []}
UP = {"down": False}
def route(r):
    u = urlparse(r.request.url); path = u.path
    q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0])
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    if path.endswith("/rpc/tally_status"):
        return j([{"book": "bk1", "company": "GARG SHEKHAR & COMPANY", "from": "2025-04-01", "openAsOn": "2025-03-31", "ledgersAt": "2026-10-01T06:00:00Z", "daysAt": AT,
                   "state": {"phase": "live", "seen": "2026-10-01T07:00:00"}, "days": len(DAYS), "entries": len(books["vouchers"]), "to": "2026-03-31"}])
    if path.endswith("/rpc/tally_days_list"): return j([{"day": d, "n": len(by_day[d]), "at": AT} for d in DAYS][off:off + 1000])
    if "/storage/v1/object/authenticated/tally-days/" in path:
        d = path.rsplit("/", 1)[1][:8]; calls["storage"] += 1
        return r.fulfill(status=200, content_type="application/gzip", body=gzip.compress(("<ENVELOPE><BODY><DATA>" + "".join(by_day.get(d, [])) + "</DATA></BODY></ENVELOPE>").encode("utf-8")))
    if path.endswith("/tally_ledgers"): return j(LED[off:off + 1000])
    if path.endswith("/tally_groups"): return j(GRP[off:off + 1000])
    if path.endswith("/functions/v1/tally-ingest"):
        if UP["down"]: return j({"error": "FinCom's cloud is not reachable (test)"}, 503)
        b = json.loads(r.request.post_data or "{}"); calls["upload"].append([x["day"] for x in b.get("days") or []])
        return j({"ok": True, "done": [x["day"] for x in b.get("days") or []]})
    return j([])
# the same questions asked of both browsers: MIS for FY 2025-26, TDS and GST for each month
FIGURES = """() => { const b = S.books, ms = GSTR.months(), r = b.mis && b.mis.last;
  const tds = TDS.rows().map(x => Object.entries(x).filter(([k, v]) => typeof v === 'number' || typeof v === 'string').sort().map(([k, v]) => k + '=' + v).join('|')).sort();
  const gst = ms.map(ym => [ym, GSTR.sum(GSTR.outward(ym, '')), GSTR.sum(GSTR.inward(ym, ''))]);
  return {n: b.vouchers.length, pbt: r ? r.pl.pbt.t : null, sales: r ? r.sales.total : null, tds, gst: JSON.stringify(gst)}; }"""
def run_mis(pg):
    pg.evaluate("() => { S.booksTab = 'mis'; S.misRange = {from: '2025-04-01', to: '2026-03-31'}; render(); }"); pg.wait_for_timeout(800)
    pg.click('section:has(> h3:text-is("MIS")) button:text-is("Run now")')
    wait_for(pg, "S.books.mis && S.books.mis.last && S.books.mis.last.from === '20250401' && S.books.mis.last.to === '20260331'", 60); pg.wait_for_timeout(800)
def client(pg):
    pg.evaluate("""(g) => { const c = newCompany({name: "Testing AAD", gstin: g}); c.id = "cmufksrrqjub2g"; c.tallyName = "GARG SHEKHAR & COMPANY"; S.companies[c.id] = c;
      S.data[c.id] = {parties: {}, entries: {}, loaded: true}; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false; }""", GSTIN)
with sync_playwright() as p:
    br = p.chromium.launch()
    # ---------- the first computer: the books already here
    c1 = br.new_context(viewport={"width": 1400, "height": 1000}); pg1 = c1.new_page(); pg1.on("pageerror", lambda e: errors.append("1: " + str(e)))
    pg1.goto("http://localhost:8167/"); pg1.wait_for_timeout(2500); pg1.click('button[data-act="useOffline"]'); pg1.wait_for_timeout(1200)
    client(pg1)
    pg1.evaluate("""(bk) => { S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: S.coId});
      TallyRead.balances(S.books, {ledgers: Object.entries(bk.tb.led).map(([name, x]) => ({name, parent: x.parent, open: String(x.open), close: ""}))}, "20250401", "20260331");
      TallyRead.yearOpen && TallyRead.yearOpen(S.books); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); render(); }""", books)
    run_mis(pg1); first = pg1.evaluate(FIGURES)
    ok(abs((first["pbt"] or 0) - PROFIT) < 0.01, "the first computer: MIS profit for FY 2025-26 is 1,13,14,193.29 (%s)" % first["pbt"])
    # ---------- another computer: empty storage, signed in to the firm, the client opened; nothing pressed, nothing uploaded
    c2 = br.new_context(viewport={"width": 1400, "height": 1000}); pg2 = c2.new_page(); pg2.on("pageerror", lambda e: errors.append("2: " + str(e)))
    pg2.route(STAGE + "/**", route)
    pg2.goto("http://localhost:8167/"); pg2.wait_for_timeout(2500)
    ok(pg2.evaluate("async () => { const k = await IDBStore.prefix(''); return k.length; }") == 0 and pg2.evaluate("localStorage.length") <= 3, "the second browser starts with nothing kept")
    pg2.click('button[data-act="useOffline"]'); pg2.wait_for_timeout(1200)
    pg2.evaluate("""() => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600}); Cloud.st.firm = "efe13a47-f0fa-43be-a18c-bf32caa448ca"; Cloud.st.state = "on"; }""")
    client(pg2)
    pg2.evaluate("() => { S.books = null; S.booksTab = 'tds'; render(); }")
    saw_busy = wait_for(pg2, "(document.body.innerText.includes('from FinCom') && document.body.innerText.includes('cloud')) || (S.books && S.books.vouchers && S.books.vouchers.length > 0)", 30)
    ok(saw_busy, "opening the client brings the books in from the cloud copy, on its own")
    ok(wait_for(pg2, "S.books && S.books.meta && S.books.meta.cloud && S.books.vouchers.length > 0 && !S.books.busy", 180), "the books are in, with no button and no upload (%d day files fetched, 8 at a time)" % calls["storage"])
    ok(calls["storage"] == len(DAYS), "every day of the year fetched once: %d of %d" % (calls["storage"], len(DAYS)))
    t = pg2.inner_text("#app")
    ok("Read the books from Tally first" not in t, "the TDS tab shows the books, not “Read the books from Tally first”")
    run_mis(pg2); second = pg2.evaluate(FIGURES)
    ok(second["n"] == first["n"], "the same entries: %d and %d" % (second["n"], first["n"]))
    ok(abs((second["pbt"] or 0) - PROFIT) < 0.01, "another computer: MIS profit for FY 2025-26 is 1,13,14,193.29 (%s)" % second["pbt"])
    ok("1,13,14,193.29" in pg2.inner_text("#app"), "and the MIS page shows 1,13,14,193.29")
    ok(second["sales"] == first["sales"], "MIS sales the same on both: %s and %s" % (second["sales"], first["sales"]))
    ok(len(second["tds"]) > 0 and second["tds"] == first["tds"], "TDS: the same %d rows on both computers" % len(first["tds"]))
    if second["tds"] != first["tds"]:
        a, b = set(first["tds"]), set(second["tds"]); print("    only on the first:", list(a - b)[:2]); print("    only on the second:", list(b - a)[:2])
    ok(second["gst"] == first["gst"], "GST: GSTR-1 and the input register, month by month, the same on both")
    if second["gst"] != first["gst"]: print("    first:", first["gst"][:300]); print("    second:", second["gst"][:300])
    # ---------- opened again: nothing fetched again (this browser keeps a copy of each day)
    n0 = calls["storage"]
    pg2.evaluate("() => { S.books = null; TCloud.st = {}; S.lkFr = null; render(); }")
    wait_for(pg2, "S.books && S.books.meta && S.books.meta.cloud && !S.books.busy", 60); pg2.wait_for_timeout(1500)
    ok(calls["storage"] == n0, "opened again: no day fetched again (%d)" % (calls["storage"] - n0))
    # ---------- a day book chosen while the cloud cannot be reached waits here, and goes up on the next opening
    UP["down"] = True
    xml = "<ENVELOPE><BODY><DATA>" + "".join(by_day["20250401"]) + "</DATA></BODY></ENVELOPE>"
    pg2.evaluate("""async (x) => { const f = new File([x], "daybook-apr.xml", {type: "text/xml"}); await bringDayBookFile(f, "20250401", "20250401", {quiet: true}); }""", xml)
    wait_for(pg2, "!S.books.busy", 60); pg2.wait_for_timeout(1500)
    ok(pg2.evaluate("async () => (await TCloudUp.waiting(S.coId)).length") == 1 and not calls["upload"], "the cloud did not take it: the file waits in this browser, said so")
    UP["down"] = False
    pg2.evaluate("() => { S.books = null; TCloud.st = {}; S.lkFr = null; render(); }")
    ok(wait_for(pg2, "S.books && !S.books.busy && TCloudUp.live.size === 0", 60) and wait_for(pg2, "(async () => true)()", 5), "the client opened again")
    pg2.wait_for_timeout(2000)
    ok(calls["upload"] and calls["upload"][-1] == ["20250401"] and pg2.evaluate("async () => (await TCloudUp.waiting(S.coId)).length") == 0,
       "it went to FinCom's cloud on its own on opening the client, and waits no more (%s)" % calls["upload"])
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
