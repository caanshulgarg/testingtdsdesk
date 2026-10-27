"""python3 tdsgst_round2_shots.py SITE OUTDIR PORT [groups] - screenshots of TDS/GST round 2 (11-Oct-2026) for
docs/ui-pass/tdsgst-round2/after: desktop (1400) and phone (390), light and dark, on the fixture books.
  groups (default "123"): 1 the due list on Today; 2 26AS and AIS, TRACES files, a return's TRACES defaults; 3 supplier
  health. The files and 2B are those of run_26as_recon.py, run_traces_files.py and run_supplier_health.py."""
import sys, os, json
WT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WT); os.chdir(WT)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
import functools, threading, http.server
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
groups = sys.argv[4] if len(sys.argv) > 4 else "123"
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

with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ["light", "dark"]:
        for w, tag in [(1400, ""), (390, "-phone")]:
            ctx = br.new_context(viewport={"width": w, "height": 1000}, color_scheme=scheme); pg = ctx.new_page()
            pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
            pg.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); window.__dueToday = '2026-10-11'; }", scheme)
            # rows off screen are drawn only when scrolled to (content-visibility): drawn for a full-page picture
            pg.add_style_tag(content="tbody tr{content-visibility:visible!important}")
            pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600); pg.evaluate(CHALLANS)
            shot = lambda name: (pg.evaluate("() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); window.scrollTo(0, 0); }"), pg.wait_for_timeout(300),
                                 pg.screenshot(path=os.path.join(out, name + tag + "-" + scheme + ".png"), full_page=True))
            if "1" in groups:
                pg.evaluate(CLIENTS); pg.evaluate("navHome('today')"); pg.wait_for_timeout(1800)
                shot("today-due-list")
                pg.evaluate("() => { S.view = 'company'; S.tab = 'books'; render(); }"); pg.wait_for_timeout(400)
            if "2" in groups:
                from tdsgst_round2_data import BOOKS as AS_BOOKS
                pg.evaluate(AS_BOOKS); pg.wait_for_timeout(400)
                pg.set_input_files('#app [data-upload="as26"] input[type=file]', os.path.join(FX, "tds-26as", "client-26as-2025-26.txt")); pg.wait_for_timeout(1200)
                pg.set_input_files('#app [data-upload="as26"] input[type=file]', os.path.join(FX, "tds-26as", "deductee-26as-AAJFJ1234K-2025-26.txt")); pg.wait_for_timeout(1200)
                pg.evaluate("() => { S.booksTab = 'tds'; S.tdsFy = '2025-26'; S.tdsView = 'recon'; render(); }"); pg.wait_for_timeout(600)
                shot("tds-26as-recon")
                pg.evaluate("() => { S.tdsView = 'traces'; render(); }"); pg.wait_for_timeout(500)
                pg.set_input_files('#app [data-upload="traces"] input[type=file]', [os.path.join(FX, "traces", "jr-26q-q3-2025-26.txt"), os.path.join(FX, "traces", "conso-26q-q3-2025-26.txt")]); pg.wait_for_timeout(1800)
                shot("tds-traces-files")
                pg.evaluate("() => { S.booksTab = 'tds'; S.tdsFy = '2025-26'; S.tdsQ = 'Q3'; S.tdsForm = '26Q'; S.tdsPickForm = '26Q'; S.tdsView = 'return'; S.tdsTab = 'checks'; render(); }"); pg.wait_for_timeout(600)
                shot("tds-26q-q3-checks-traces-defaults")
            if "3" in groups:
                from tdsgst_round2_data import SETUP as SUP_SETUP, TWOB
                pg.evaluate(SUP_SETUP, TWOB); pg.wait_for_timeout(800)
                shot("gst-supplier-health")
            ctx.close()
    br.close()
srv.shutdown(); print("shots in", out)
