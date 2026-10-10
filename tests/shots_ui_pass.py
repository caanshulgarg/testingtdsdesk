"""python3 shots_ui_pass.py OUTDIR - a screenshot of every page at 1366 x 768 (the owner's UI pass of 04-Oct-2026), for
comparing before and after. Offline (this browser only), the made-up client "Testing AAD" with a few bills, a bank
statement and a sales invoice; Testing AAD's books from tests/data when that folder is there (kept out of git), else none.
Writes OUTDIR/<page>.png only. Run on the React build: TDSDESK_SITE=../app/dist-test python3 shots_ui_pass.py OUTDIR"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8241), H); threading.Thread(target=srv.serve_forever, daemon=True).start()

# the made-up client and its work (the same as run_ui_standards.py uses)
SEED = """(books) => { S.firm.firmName = "Garg Shekhar & Company";
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; c.stats = {};
  const d = S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  const mk = (id, inv, vendor, total, st, extra) => { const e = newEntry(inv + ".pdf"); e.id = id;
    e.x = Object.assign(e.x || {}, {vendorName: vendor, invoiceNo: inv, invoiceDate: "2026-09-12", total, taxable: Math.round(total / 1.18)}); e.status = st; Object.assign(e, extra || {}); d.entries[id] = e; };
  mk("s1", "FA/2026-27/081", "FINGATE ADVISORY SERVICES PVT LTD", 23600, "draft");
  mk("s2", "INV-4412", "MASTERCAD SOLUTIONS", 125000, "draft");
  mk("s3", "CN-17", "SALESIFY TECHNOLOGIES", -5900, "draft");
  mk("s4", "B/2209", "LYALLPUR TRADERS", 47200, "approved", {approvedAt: "2026-09-15T05:00:00Z"});
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  if (books){ const [bk, g] = books; S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id});
    S.books.map = Books.mapLedgers(bk.vouchers, {}); Object.entries(g.map).forEach(([l, m]) => { S.books.map[l] = Object.assign({n: l}, m); });
    S.books.twoBs = g.twoBs; S.books.gstSet = {"09": g.gstSet}; S.books.itcTrack = {"09": g.itcTrack}; LedMaster.refresh(S.books); S.gstReg = "09"; }
  refreshStats(c.id); render(); return c.id; }"""

HOME = lambda t: "() => { navHome('%s'); }" % t
CLIENT = lambda js: "() => { S.view = 'company'; " + js + " }"
PAGES = [
    ("home-clients", HOME("clients")), ("home-today", HOME("today")), ("home-inbox", HOME("inbox")), ("home-tally", HOME("tally")),
    ("home-settings", "() => { goSettings(null); }"), ("home-settings-bridge", "() => { goSettings('bridge'); }"), ("home-help", HOME("help")),
    ("dashboard", CLIENT("goClient('dash');")),
    ("purchase-review", CLIENT("goClient('bills');")),
    ("purchase-upload", CLIENT("S.tab = 'invoices'; goStep('collect', 'bills');")),
    ("purchase-in-tally", CLIENT("goStep('done', 'bills');")),
    ("post-to-tally", CLIENT("goStep('post', 'bills');")),
    ("bank", CLIENT("goClient('bank');")),
    ("sales", CLIENT("goClient('sales');")),
    ("client-inbox", CLIENT("goClient('inbox');")),
    ("transactions", CLIENT("goClient('txn');")),
    ("tds-gst", CLIENT("goClient('books:gst');")),
    ("from-tally-daybook", CLIENT("goClient('books:import');")),
    ("tds", CLIENT("goClient('books:tds');")),
    ("reports", CLIENT("goClient('books:reports');")),
    ("mis", CLIENT("goClient('books:mis');")),
    ("accounts", CLIENT("goClient('books:fs');")),
    ("audit", CLIENT("goClient('books:audit');")),
    ("look-up", CLIENT("goClient('books:lookup');")),
    ("letters", CLIENT("goClient('books:letters');")),
    ("client-setup", CLIENT("S.step = null; S.tab = 'settings'; render();")),
    ("client-setup-suppliers", CLIENT("S.step = null; S.tab = 'deductees'; render();")),
]

def books():
    try:
        sys.path.insert(0, HERE); import gstfix; return list(gstfix.load())
    except Exception: return None

if __name__ == "__main__":
    only = sys.argv[2:]
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768})
        pg.goto("http://localhost:8241/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
        pg.evaluate(SEED, books()); pg.wait_for_timeout(1500)
        for name, js in PAGES:
            if only and name not in only: continue
            try:
                pg.evaluate(js); pg.wait_for_timeout(1800); pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(250)
            except Exception as e: print("  (could not open %s: %s)" % (name, str(e)[:120]))
            f = os.path.join(OUT, name + ".png"); pg.screenshot(path=f); print(f)
        br.close()
