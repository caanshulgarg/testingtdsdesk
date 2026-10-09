"""python3 shots_group2.py SITE OUTDIR PORT - Arc UI step 3, group 2 (10-Oct-2026): the Purchase review table and a bill
open in its drawer (shots_ui_pass's made-up client), and a bank statement with work on it (run_react_bank.py's made-up
statement), at desktop (1366) and phone (390) width, light and dark. Each page gets the checks of shots_round4.py
(sideways scroll, cut-off text, WCAG contrast); writes OUTDIR/<width>-<scheme>-<page>.png and prints one line a page.
Reports, MIS, GST and TDS are in shots_arc_books.py."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE, OUT, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(OUT, exist_ok=True)
src = lambda f: open(os.path.join(HERE, f)).read()
CHECK = re.search(r'CHECK = """(.*?)"""', src("shots_round4.py"), re.S).group(1).replace("\\\\n", "\\n")
SEED = re.search(r'SEED = """(.*?)"""', src("shots_ui_pass.py"), re.S).group(1)
BANK = re.search(r'SETUP = """(.*?)"""', src("run_react_bank.py"), re.S).group(1)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
REVIEW = "() => { goStep('review', 'bills'); S.reviewTable = true; S.selected = null; S.drawerOpen = false; render(); }"
DRAWER = """() => { goStep('review', 'bills'); S.reviewTable = false; const e = Object.values(D().entries).find((x) => x.status === 'draft');
  if (e) { S.selected = e.id; S.drawerOpen = true; } render(); }"""
bad = 0
def check(pg, key, errs):
    global bad
    pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); window.scrollTo(0, 0); }"); pg.wait_for_timeout(300)
    c = pg.evaluate(CHECK); notes = []
    if errs: notes.append("errors %s" % errs[:2])
    if c["scroll"] > 0 or c["wide"]: notes.append("sideways %dpx %s" % (c["scroll"], c["wide"][:3]))
    if c["cut"]: notes.append("cut-off %s" % c["cut"][:3])
    if c["nlow"]: notes.append("contrast %d below WCAG AA, worst %s" % (c["nlow"], c["low"][:3]))
    pg.screenshot(path=os.path.join(OUT, key + ".png"))
    bad += bool(notes); print(key, "; ".join(notes) if notes else "ok")
with sync_playwright() as p:
    br = p.chromium.launch()
    for vw, vh, wn in [(1366, 768, "desk"), (390, 844, "phone")]:
        for sch in ["light", "dark"]:
            for name in ["purchase-table", "bill-drawer", "bank-statement"]:
                pg = br.new_page(viewport={"width": vw, "height": vh}, color_scheme=sch); errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
                if name == "bank-statement": pg.evaluate(BANK)
                else: pg.evaluate(SEED, None); pg.wait_for_timeout(1000); pg.evaluate(REVIEW if name == "purchase-table" else DRAWER)
                pg.wait_for_timeout(1500); errs.clear()
                check(pg, "%s-%s-%s" % (wn, sch, name), errs)
                pg.close()
    br.close()
print("pages with a finding:", bad)
