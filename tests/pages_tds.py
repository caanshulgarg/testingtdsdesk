"""python3 pages_tds.py SITE OUT.json [PORT] - every TDS page of the books in tests/data, as text, into OUT.json.
Run it on two builds and compare, to see that a change (a screen moved to React, say) shows the same thing:
  python3 pages_tds.py ../site-test live.json 8170 && python3 pages_tds.py ../app/dist-test react.json 8171
  python3 -c "import json; a=json.load(open('live.json'))['pages']; b=json.load(open('react.json'))['pages']; print([k for k in a if a[k]!=b.get(k)])"
"""
import json, os, sys, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8170
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
res, errors = {}, []
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "tds"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    # two challans so the challan pages have something
    pg.evaluate("""() => { const r = TDS.rows()[0]; if (!r) return; S.books.challans = [{id: "chA", bsr: "0240020", serial: "00979", date: r.date, tax: 5000, interest: 0}, {id: "chB", bsr: "0510308", serial: "12345", date: r.date, tax: 1200, interest: 20}]; TDS.autoAllocate(); render(); }""")
    def grab(name):
        pg.wait_for_timeout(250)
        t = pg.evaluate("document.getElementById('app').innerText")
        res[name] = re.sub(r"\s+", " ", t.replace("? How this tab works", "")).strip()
    fys = pg.evaluate("tdsYears(S.books, TDS.rows())")
    for fy in fys:
        pg.evaluate("(fy) => { S.tdsFy = fy; S.tdsView = 'year'; render(); }", fy); grab(fy + "/year")
        for q in ["Q1", "Q2", "Q3", "Q4"]:
            for form, tabs in [("26Q", ["challans", "deductees", "deductions", "checks"]), ("24Q", ["employees", "challans", "annex2", "checks"])]:
                for tab in tabs:
                    pg.evaluate("([fy, q, form, tab]) => { S.tdsFy = fy; S.tdsQ = q; S.tdsForm = form; S.tdsView = 'return'; S.tdsTab = tab; S.tdsOpen = ''; S.chOpen = ''; render(); }", [fy, q, form, tab]); grab("%s/%s/%s/%s" % (fy, q, form, tab))
            # a deductee and a challan opened, a filter and a sort
            pg.evaluate("([fy, q]) => { S.tdsFy = fy; S.tdsQ = q; S.tdsForm = '26Q'; S.tdsView = 'return'; S.tdsTab = 'deductees'; const r = TDS.rows().find(x => x.fy === fy && x.q === q); S.tdsOpen = r ? (Certs.validPan(r.pan) ? r.pan : 'name:' + normName(r.party)) : ''; render(); }", [fy, q]); grab("%s/%s/deductee-open" % (fy, q))
            pg.evaluate("() => { S.tdsTab = 'challans'; S.chOpen = 'chA'; render(); }"); grab("%s/%s/challan-open" % (fy, q))
            pg.evaluate("() => { S.tdsTab = 'deductions'; S.tdsFl = {deductions: {pan: 'yes'}}; S.tdsSort = {deductions: {k: 'tds', d: -1}}; render(); }"); grab("%s/%s/deductions-filtered" % (fy, q))
            pg.evaluate("() => { S.tdsFl = {}; S.tdsSort = {}; }")
        pg.evaluate("(fy) => { S.tdsFy = fy; S.tdsView = 'certs'; render(); }", fy); grab(fy + "/certs")
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
