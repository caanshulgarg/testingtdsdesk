"""python3 pages_books.py SITE OUT.json [PORT] - the Books tabs other than TDS and GST (From Tally, Tally ledgers, MIS,
Accounts, Audit) with the books in tests/data, as text, into OUT.json, for comparing two builds (see pages_gst.py)."""
import json, os, sys, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8185
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
res, errors = {}, []
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append("same key: " + m.text[:120]) if "same key" in m.text else None)
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "import"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    def grab(name, wait=300):
        pg.wait_for_timeout(wait)
        res[name] = re.sub(r"\s+", " ", pg.evaluate("document.getElementById('app').innerText")).strip()
    # From Tally: as brought in, with parts, a trial balance and dates chosen, and with nothing
    pg.evaluate("() => { S.booksTab = 'import'; render(); }"); grab("import")
    pg.evaluate("() => { S.books.meta = Object.assign({}, S.books.meta, {parts: [{from: '20250401', to: '20250930', n: 1200, file: 'db1.xml', at: '2026-01-02T10:00:00Z', bridge: 'filled', cloud: 'in the cloud'}, {from: '20251101', to: '20260331', n: 900, file: 'db2.xml', at: '2026-01-03T10:00:00Z'}]}); S.books.tb = {source: 'tb.xml', led: {A: 1, B: 2}, openAsOn: '20250331'}; S.books.ledInfoAt = '2026-01-04T00:00:00Z'; S.books.ledInfo = {A: {}, B: {}}; S.dbFrom = '2025-10-01'; S.tbOn = '2025-03-31'; render(); }"); grab("import-parts")
    pg.evaluate("() => { S.tallyCopy = {time: '03:00', at: '2026-01-05T02:00:00', from: '20250401', to: '20260104', months: ['1','2'], schedule: {on: true, next: '2026-01-06 03:00'}}; render(); }"); grab("import-copy")
    # Tally ledgers: each list, a search, a ledger's meaning changed, a TDS ledger, and what FinCom posts to
    for v in ["pending", "gst", "tds", "done", "other", "post"]:
        pg.evaluate("(v) => { S.booksTab = 'ledgers'; S.lmView = v; S.ledQ = ''; render(); }", v); grab("led-" + v)
    pg.evaluate("() => { S.lmView = 'gst'; S.ledQ = 'igst'; render(); }"); grab("led-find")
    pg.evaluate("() => { const n = Object.keys(S.books.map).find(k => LedMaster.isGst(S.books.map[k].what)); if (n){ const m = S.books.map[n]; m.side = 'output'; m.byHand = true; m.ok = true; S.books.mapV = (S.books.mapV || 0) + 1; } S.ledQ = ''; render(); }"); grab("led-changed")
    pg.evaluate("() => { const n = Object.keys(S.books.map).find(k => !LedMaster.taxLike(k, S.books.map[k], (S.books.ledInfo || {})[k])); if (n){ const m = S.books.map[n]; LedMaster.applyWhat(m, 'tds_payable'); m.section = '194J'; m.rate = 10; m.ok = true; } S.lmView = 'tds'; render(); }"); grab("led-tds")
    # Audit: not run yet, run for the year, an area, a finding opened with a status and note, related parties, the 3CD draft
    pg.evaluate("() => { S.booksTab = 'audit'; S.auditTab = 'find'; S.books.audit = null; S.books.stale = {}; render(); }"); grab("audit-none")
    pg.evaluate("() => { const dr = Audit.defaultRange(S.books); Audit.run(dr.from, dr.to, 'by hand'); S.books.audit.last.at = '2026-01-10T10:00:00.000Z'; render(); }"); grab("audit-run", 800)
    pg.evaluate("() => { const f = S.books.audit.last.findings[0]; if (f){ S.auditOpen = f.id; S.auditArea = f.area; const au = S.books.audit; au.st = au.st || {}; au.st[f.id] = {s: 'pass', note: 'to reverse', at: '2026-01-10'}; } render(); }"); grab("audit-open")
    pg.evaluate("() => { S.auditArea = ''; S.auditSt = 'open'; S.auditOpen = ''; render(); }"); grab("audit-status")
    pg.evaluate("() => { S.auditSt = ''; S.auditTab = 'rel'; S.books.auditRel = [{name: Object.keys(S.books.map)[0], relation: 'Director'}]; render(); }"); grab("audit-rel")
    pg.evaluate("() => { S.auditTab = '3cd'; render(); }"); grab("audit-3cd")
    pg.evaluate("() => { S.auditTab = 'find'; render(); }")
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
