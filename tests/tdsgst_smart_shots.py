"""python3 tdsgst_smart_shots.py SITE OUTDIR PORT [group] - screenshots of the TDS and GST checks of 10-Oct-2026 (branch
tdsgst-smart) in docs/ui-pass/tdsgst-smart/after: desktop (1400) and phone (390), light and dark, on the fixture books
with a few faults planted (a 194C rate to a company, a deduction made late, a buyer GSTIN with a wrong check digit, a
quarter marked filed). Group 2 adds the year's tie-out, the limits tracker, certificate limits and a correction."""
import sys, os, json
WT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WT); os.chdir(WT)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
import functools, threading, http.server
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
group = sys.argv[4] if len(sys.argv) > 4 else "1"
os.makedirs(out, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
PLANT = """() => { const b = S.books;
  b.pans = Object.assign({}, b.pans, {'Peregrine Tent Works': 'AABCP1234Q', 'Nightjar Sound & Light Co': 'AABFN1234Q', 'Juniper Legal Associates': 'AAFFJ1234Q'});
  b.vouchers.push({id: 'zz-bill', date: '20250610', no: 'KM/1', type: 'Journal', party: 'Kestrel Movers', ent: [{l: 'Freight Charges', a: -50000}, {l: 'Kestrel Movers', a: 50000}]});
  b.vouchers.push({id: 'zz-tds', date: '20250805', no: 'JV/9', type: 'Journal', party: 'Kestrel Movers', ent: [{l: 'Kestrel Movers', a: -1000}, {l: 'TDS ON CONTRACT 194C', a: 1000}]});
  const v = b.vouchers.find(v => (v.no || v.ref) === 'LFE/25-26/001'); if (v) v.gstin = '07AAJFQ3158R1ZJ';
  b.tdsFiled = {'2025-26|Q1|26Q': {on: '2025-07-25', token: '123456789012345', at: new Date().toISOString(), by: 'this computer'}};
  render(); }"""
STATES = [
 ("tds-year-2025-26", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsView='year'; S.tdsQ='';"),
 ("tds-26q-2025-26-q2-checks", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsQ='Q2'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='checks';"),
 ("tds-26q-2025-26-q1-file", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsQ='Q1'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='file';"),
 ("tds-26q-2025-26-q3-file", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsQ='Q3'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='file';"),
 ("gst-year-2025-26", "S.booksTab='gst'; S.gstReg='07'; S.gstYm='202603'; S.gstView='year'; S.gstPart='r1';"),
 ("gst-r1-202504-checks", "S.booksTab='gst'; S.gstReg='07'; S.gstYm='202504'; S.gstView='return'; S.gstPart='r1'; S.gstSub='summary';"),
]
if group == "2":
    STATES += [
     ("tds-certs", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsView='certs';"),
     ("tds-26q-2025-26-q1-checks", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsQ='Q1'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='checks';"),
    ]
PHONE = ("tds-year-2025-26", "tds-26q-2025-26-q2-checks", "tds-26q-2025-26-q1-file", "gst-year-2025-26", "tds-certs")
with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ["light", "dark"]:
        for w, tag in [(1400, ""), (390, "-phone")]:
            pg = br.new_page(viewport={"width": w, "height": 1000}, color_scheme=scheme)
            pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
            pg.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); }", scheme)
            pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600); pg.evaluate(CHALLANS); pg.evaluate(PLANT)
            if group == "2":
                pg.evaluate("() => { if (window.__plant2) window.__plant2(); }")
            for name, js in STATES:
                if tag and name not in PHONE: continue
                pg.evaluate("() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); S.gstSeen = ''; " + js + " S.gstSeen = (S.gstReg||'') + '|' + GSTSet.typeOf(S.gstYm||'', S.gstReg||''); render(); window.scrollTo(0, 0); }")
                pg.wait_for_timeout(700)
                pg.screenshot(path=os.path.join(out, name + tag + "-" + scheme + ".png"), full_page=True)
            pg.close()
    br.close()
srv.shutdown(); print("shots in", out)
