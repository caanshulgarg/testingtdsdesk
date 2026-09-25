"""python3 run_vms2b_ui.py - the input register and 2B screens with VMS's own February and March 2026 2B."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
files = [os.path.join(DATA, "returns_R2B_07AADCV3366N1ZU_%s.json" % p) for p in ("022026", "032026")]
if not all(os.path.exists(f) for f in files): print("  (VMS 2B files not here; skipped)\n\nall passed"); sys.exit(0)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8137), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8137/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""([bk, js]) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books);
      js.forEach(j => { const t = GST2B.fromJson(j); S.books.twoBs[t.gstin + "|" + t.period] = t; }); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "inreg"; S.gstYm = "202602"; S.gstReg = "07"; render(); }""", [books, [json.load(open(f)) for f in files]])
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(5000)
    t = pg.inner_text("#app")
    ok("Input register, Feb 2026" in t and "In 2B, not in the books" in t, "February's register with 2B status")
    cnt = pg.evaluate("[...document.querySelectorAll('#app table.bk-table.compact tbody tr')].filter(r => r.cells.length > 6 && r.cells[r.cells.length - 1].innerText.split('\\n')[0].trim() === 'In 2B').length")
    ok(cnt >= 100, "matched bills say In 2B (%d)" % cnt)
    ok("Credit in 2B not taken" in t, "chip: credit in 2B, booked without taking it")
    ok("Booked and reversed" in t, "Explore Marketing's booked-and-reversed bills shown as such")
    ok("booked without credit: Journal" in t and "Hyatt Regency Delhi" in t and "take the credit" in t, "Asian Hotels 571732: booked without credit, take it")
    ok("place of supply in another state" in t, "out-of-state hotels: not available, expensing is right")
    pg.screenshot(path=OUT + "/vms2b-feb-register.png", full_page=True)
    pg.select_option('select[data-inregscope]', "year"); pg.wait_for_timeout(6000)
    pg.select_option('select[data-inregf]', "Booked more than once"); pg.wait_for_timeout(4000); t = pg.inner_text("#app")
    ok("SUTARA" in t.upper() and "Booked 2 times" in t, "the whole year, filtered: the bill booked twice (Sutara no. 21, January)")
    pg.select_option('select[data-inregscope]', "month"); pg.wait_for_timeout(3000)
    pg.select_option('select[data-inregf]', ""); pg.click('button[data-gstpart="r2b"]'); pg.wait_for_timeout(5000)
    pg.click('button[data-r2tab="only2b"]'); pg.wait_for_timeout(3000); t = pg.inner_text("#app")
    ok("booked without credit" in t, "2B screen, in 2B only: says where it is booked without credit")
    pg.screenshot(path=OUT + "/vms2b-feb-only2b.png", full_page=False)
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
