"""python3 pages_gst.py SITE OUT.json [PORT] - the GST pages of the books in tests/data (every part, the first and the last
three months), as text, into OUT.json.
Run it on two builds and compare, to see that a change (a screen moved to React, say) shows the same thing:
  python3 pages_gst.py ../site-test live.json 8170 && python3 pages_gst.py ../app/dist-test react.json 8171
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
    def grab(name):
        pg.wait_for_timeout(250)
        t = pg.evaluate("document.getElementById('app').innerText")
        res[name] = re.sub(r"\s+", " ", t.replace("? How this tab works", "")).strip()
    pg.evaluate("() => { S.booksTab = 'gst'; render(); }"); pg.wait_for_timeout(500)
    months = pg.evaluate("GSTR.months()")
    parts = pg.evaluate("['r1','r3b','inreg','r2b','follow','adv','rev','amend','g9','g9c','vault','qtr','cmp08','gstr4']")
    for ym in months[:1] + months[-3:]:
        for part in parts:
            pg.evaluate("([ym, part]) => { S.gstYm = ym; S.gstPart = part; S.books.reco = null; render(); }", [ym, part]); grab("%s/%s/%s" % (ym, part, pg.evaluate("S.gstPart")))
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
