"""python3 tdsgst_makeover_shots.py SITE OUTDIR PORT [before|after] - screenshots of the TDS & GST makeover (round 46,
11-Oct-2026) for docs/ui-pass/tdsgst-makeover/{before,after}: desktop (1440) and phone (390), light and dark, on the
fixture books (tests/fixtures/books, and the same a year on), the date fixed at 11-Oct-2026.
  before: the TDS year, the GST year, a return (Form 140 Q1 2026-27), Today and Clients, as the build before had them.
  after:  the same, and the new places: Compliance, TDS Returns, 26AS & AIS, TDS Checks, GST 2B & ITC, a return's
          summary card."""
import sys, os, json
WT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WT); os.chdir(WT)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
import functools, threading, http.server
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
which = sys.argv[4] if len(sys.argv) > 4 else "after"
os.makedirs(out, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
FX = os.path.join(WT, "fixtures")

CLIENTS = """async () => {
  const b = S.books; b.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-08-05', token: '123456789012345'}}; b.gstFiled = {'07': {'202608': {r3b: '2026-09-25'}}};
  b.portalFiled = {'07|r1|202608': {arn: 'AA070826000001', dof: '2026-09-10'}}; await saveBooks();
  const mk = (name, gstin) => { const c = newCompany({name, gstin}); S.companies[c.id] = c; return c.id; };
  const a = mk('Saffron Caterers', '27AAACB1234C1Z5'), q = mk('Tulip Florists', '29AAACQ1234C1Z1');
  await Books.save(a, {cid: a, gstFiled: {'27': {'202609': {r1: '2026-10-09'}}}});
  await Books.save(q, {cid: q, gstSet: {'29': {filing: [{from: '202604', type: 'qrmp'}]}}, gstFiled: {'29': {'202604': {iff: '2026-05-12'}}}});
}"""
CO = "() => { S.view = 'company'; S.coId = window.__cid; S.tab = 'books'; S.booksTab = '%s'; %s render(); }"

with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ["light", "dark"]:
        for w, tag in [(1440, ""), (390, "-phone")]:
            ctx = br.new_context(viewport={"width": w, "height": 1000}, color_scheme=scheme); pg = ctx.new_page()
            pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
            pg.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); window.__dueToday = '2026-10-11'; }", scheme)
            pg.add_style_tag(content="tbody tr{content-visibility:visible!important}")
            pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; window.__cid = S.coId; render();"); pg.wait_for_timeout(600); pg.evaluate(CHALLANS)
            pg.evaluate(CLIENTS); pg.wait_for_timeout(300)
            def shot(name):
                pg.evaluate("() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); window.scrollTo(0, 0); }"); pg.wait_for_timeout(400)
                pg.screenshot(path=os.path.join(out, name + tag + "-" + scheme + ".png"), full_page=True)
            def go(js, wait=700): pg.evaluate(js); pg.wait_for_timeout(wait)
            go("navHome('today')", 1800); shot("today")
            go("navHome('clients')"); shot("clients")
            if which == "after": go("navHome('compliance')", 1800); shot("compliance")
            go(CO % ("tds", "S.tdsView = 'year'; S.tdsFy = '2026-27'; S.tdsQ = ''; S.tdsPickForm = '';")); shot("tds-returns" if which == "after" else "tds")
            go(CO % ("tds", "S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsPickForm = '26Q'; S.tdsTab = '';")); shot("tds-return-summary-card" if which == "after" else "tds-return")
            go(CO % ("tds", "S.tdsView = 'recon'; S.tdsFy = '2025-26';")); shot("tds-26as")
            if which == "after":
                go(CO % ("tds", "S.tdsView = 'challans'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1';")); shot("tds-challans")
                go(CO % ("tds", "S.tdsView = 'checks'; S.tdsFy = '2026-27'; S.tdsCheck = 'tieout';")); shot("tds-checks")
            go(CO % ("gst", "S.gstReg = '07'; S.gstYm = '202603'; S.gstView = 'year'; S.gstPart = ''; S.gstSub = '';")); shot("gst-returns" if which == "after" else "gst")
            go(CO % ("gst", "S.gstReg = '07'; S.gstYm = '202603'; S.gstView = 'return'; S.gstPart = 'r3b'; S.gstSub = ''; S.gstSeen = '';")); shot("gst-return")
            if which == "after":
                go(CO % ("gst", "S.gstReg = '07'; S.gstYm = '202603'; S.gstView = 'return'; S.gstPart = 'r2b'; S.gstSub = ''; S.gstSeen = '';")); shot("gst-2b-itc")
            ctx.close()
    br.close()
srv.shutdown(); print("shots in", out)
