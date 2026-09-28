# The PDF, Excel and OCR readers load from this site's own assets (no outside addresses) and work.
import os, threading, functools, http.server, base64
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8161), functools.partial(H, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(c, m):
    print(("ok  " if c else "FAIL ") + m)
    if not c: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    outside = []
    pg.on("request", lambda r: outside.append(r.url) if not r.url.startswith(("http://localhost:8161", "data:", "blob:")) and "fonts.g" not in r.url else None)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));")
    # a key saved by an older build is wiped at start-up
    pg.goto("http://localhost:8161/"); pg.wait_for_timeout(800)
    pg.evaluate("""() => { localStorage.setItem('tdsdesk-test:api', JSON.stringify({key: 'sk-ant-old', model: 'm1'})); localStorage.setItem('tdsdesk-test:gvision', JSON.stringify({key: 'AIzaOLD'})); }""")
    pg.reload(); pg.wait_for_timeout(2500)
    k = pg.evaluate("() => [localStorage.getItem('tdsdesk-test:api'), localStorage.getItem('tdsdesk-test:gvision')]")
    check(k[1] is None and "sk-ant" not in (k[0] or "") and "m1" in (k[0] or ""), "stored keys wiped, model choice kept " + str(k))
    check(pg.evaluate("() => !!document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')"), "page carries a Content-Security-Policy")
    pdf64 = open(os.path.join(SITE, "assets", "sample-pdf.txt")).read().strip()
    r = pg.evaluate("""async (b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const f = new File([bytes], "s.pdf", {type: "application/pdf"});
      const doc = await getPdf(f); const pages = await pdfTextPages(f);
      const page = await doc.getPage(1); const vp = page.getViewport({scale: 1});
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await page.render({canvasContext: c.getContext("2d"), viewport: vp}).promise;
      return {n: doc.numPages, ver: pdfjsLib.version, text: JSON.stringify(pages).length, w: c.width};
    }""", pdf64)
    check(r["ver"].startswith("4.10"), "pdf.js version " + r["ver"])
    check(r["n"] >= 1 and r["text"] > 20 and r["w"] > 100, "PDF opened, text read and page drawn " + str(r))
    x = pg.evaluate("""async () => {
      await ensureXlsx();
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Date","Amount"],["01-04-2026",1500.5]]), "S");
      const out = XLSX.write(wb, {type: "array", bookType: "xlsx"});
      const back = XLSX.read(out, {type: "array"});
      return {ver: XLSX.version, cell: back.Sheets.S.B2.v};
    }""")
    check(x["ver"] == "0.20.3" and x["cell"] == 1500.5, "Excel reader " + str(x))
    o = pg.evaluate("""async () => {
      const eng = await getOcr(); if (!eng) return {err: S.ocrError, b: S.ocrBuiltInError};
      const c = document.createElement("canvas"); c.width = 900; c.height = 200;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 200); g.fillStyle = "#000"; g.font = "bold 48px Arial"; g.fillText("INVOICE TOTAL 4520", 30, 120);
      const r = await eng.recognize(c, "7"); return {kind: eng.kind, text: r.text};
    }""")
    check(o.get("kind") == "built-in" and "4520" in (o.get("text") or ""), "OCR from own copy " + str(o))
    check(not [u for u in outside if "cdnjs" in u or "jsdelivr" in u], "no library loaded from other sites: " + str([u for u in outside if "cdn" in u]))
    check(not pg.evaluate("() => window.__csp"), "no CSP violations " + str(pg.evaluate("() => window.__csp")))
    check(not errs, "no page errors " + str(errs[:3]))
    b.close()
print(("%d failed" % len(fails)) if fails else "all passed")
