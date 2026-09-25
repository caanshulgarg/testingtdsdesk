"""python3 run_fs_ui.py - the Accounts tab in a browser."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))
DATA = os.environ.get("TDSDESK_DATA", os.path.join(HERE, "data")); OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8136), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8136/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.booksTab = "import"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
    pg.evaluate("""() => { const led = {}; Object.entries(S.books.ledInfo).forEach(([n, i]) => { led[n] = {open: i.ob || 0, close: 0, parent: i.group}; }); S.books.tb = {from: "20250401", to: "20260331", at: new Date().toISOString(), led}; S.booksTab = "fs"; render(); }""")
    pg.wait_for_timeout(500)
    ok("Financial statements" in pg.inner_text("#app") and "Run now" in pg.inner_text("#app"), "Accounts tab with year and Run now")
    pg.click('button[data-act="fsRun"]'); pg.wait_for_timeout(3000)
    t = pg.inner_text("#app")
    ok("The balance sheet tallies" in t and "Schedule III" in t and "Statement of Profit and Loss" in t, "Schedule III statements, tallied")
    ok("Negative on the balance sheet" in t, "a negative line is flagged")
    pg.screenshot(path=OUT + "/fs.png", full_page=False)
    pg.click('button[data-fstab="map"]'); pg.wait_for_timeout(600)
    sel = pg.locator("select[data-fsmap]").first; l = sel.get_attribute("data-fsmap")
    sel.select_option("oca"); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.books.fs.map[%s]" % json.dumps(l)) == "oca" and "by hand" in pg.inner_text("#app"), "a ledger placed by hand: " + l)
    pg.click('button[data-fsunmap="%s"]' % l.replace('"', '\\"')); pg.wait_for_timeout(2500)
    ok(l not in pg.evaluate("Object.keys(S.books.fs.map)"), "and back to the rule")
    pg.click('button[data-fstab="st"]'); pg.wait_for_timeout(400)
    pg.select_option("select[data-fskind]", "nc"); pg.wait_for_timeout(300); pg.click('button[data-act="fsRun"]'); pg.wait_for_timeout(3000)
    ok("Owners' funds" in pg.inner_text("#app") and "Non-Corporate" in pg.inner_text("#app"), "the non-corporate format")
    with ctx.expect_page() as pop:
        pg.click('button[data-act="fsPdf"]')
    rp = pop.value; rp.wait_for_timeout(700); ok("Balance Sheet" in rp.inner_text("body"), "as PDF"); rp.pdf(path=OUT + "/fs.pdf"); rp.close()
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-act="fsExcel"]'); pg.wait_for_timeout(3000)
    ok(any("financial-statements" in n for n in pg.evaluate("window.__saved")), "as Excel")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
