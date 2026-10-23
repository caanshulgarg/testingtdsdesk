"""python3 shots_colour.py OUTDIR - screenshots of Dashboard, Purchase, Reports, MIS and TDS & GST in light and dark, on
Testing AAD's books (tests/data, kept out of git), for approving the colour scheme. Writes PNGs only."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8231), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
BILLS = """() => { const cid = S.coId, d = S.data[cid];
  const mk = (id, inv, vendor, total, st, extra) => { const e = newEntry(inv + ".pdf"); e.id = id;
    e.x = Object.assign(e.x || {}, {vendorName: vendor, invoiceNo: inv, invoiceDate: "2025-09-12", total, taxable: Math.round(total / 1.18)}); e.status = st; Object.assign(e, extra || {}); d.entries[id] = e; };
  mk("s1", "FA/2025-26/081", "FINGATE ADVISORY SERVICES PVT LTD", 23600, "draft");
  mk("s2", "INV-4412", "MASTERCAD SOLUTIONS", 118000, "draft");
  mk("s3", "CN-17", "SALESIFY TECHNOLOGIES", -5900, "draft");
  mk("s4", "B/2209", "LYALLPUR TRADERS", 47200, "approved", {approvedAt: "2025-09-15T05:00:00Z"});
  refreshStats(cid); }"""
SHOTS = [("dashboard", "() => { S.tab = 'dash'; S.step = null; render(); }"),
         ("purchase", "() => { S.tab = 'invoices'; S.filter = 'draft'; S.reviewTable = true; S.step = null; render(); }"),
         ("reports", "() => { S.tab = 'books'; S.booksTab = 'reports'; render(); }"),
         ("mis", "() => { S.tab = 'books'; S.booksTab = 'mis'; S.misTab = 'summary'; render(); }"),
         ("tds-gst", "() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }")]
with sync_playwright() as p:
    br = p.chromium.launch()
    for theme in ("light", "dark"):
        pg = br.new_page(viewport={"width": 1440, "height": 900}, color_scheme=theme)
        pg.goto("http://localhost:8231/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate(gstfix.SETUP, list(gstfix.load())); pg.wait_for_timeout(1500)
        pg.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); }", theme)
        pg.evaluate(BILLS)
        for name, js in SHOTS:
            pg.evaluate(js); pg.wait_for_timeout(name == "mis" and 6000 or 2500)
            if name == "mis" and pg.locator("#app button:has-text('Run now')").count():
                pg.locator("#app button:has-text('Run now')").first.click(); pg.wait_for_timeout(9000)
            f = os.path.join(OUT, "%s-%s.png" % (name, theme)); pg.screenshot(path=f); print(f)
        pg.close()
    br.close()
