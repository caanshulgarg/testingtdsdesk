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
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
