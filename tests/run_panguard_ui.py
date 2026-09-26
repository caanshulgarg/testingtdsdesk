"""python3 run_panguard_ui.py - another business's data is refused (day book, 2B, filed GSTR-1, PDFs); the GSTIN and PAN
of a client must agree; "Remove Tally data and all GST work" clears it all and keeps TDS."""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8148), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
f2b = os.path.join(DATA, "returns_R2B_07AADCV3366N1ZU_032026.json"); fday = os.path.join(DATA, "DayBook.xml")
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8148/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    # as it happened: Garg Shekhar & Company, holding VMS's books and GST work
    pg.evaluate("""([bk, j2b]) => { const c = newCompany({name: "Garg Shekhar & Company", gstin: "09AANFG3202D1ZR", pan: "AANFG3202D"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}, challans: [{id: "ch1", date: "20250607", tax: 1000}], salary: [{name: "x"}]});
      S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books);
      const t = GST2B.fromJson(j2b); S.books.twoBs[t.gstin + "|" + t.period] = t; S.books.gstSet = {"07": {portalUser: "u"}}; S.books.gstFiled = {"07": {"202603": {r3b: "2026-04-20"}}};
      S.books.gstVault = [{id: "gvx", reg: "07", form: "r3b", per: "202603", name: "a.pdf", size: 3}]; window.__bk = S.books; S.booksTab = "import"; render(); }""", [books, json.load(open(f2b))])
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(2500)
    t = pg.inner_text("#app")
    ok("not this client’s PAN (AANFG3202D)" in t and "07AADCV3366N1ZU" in t, "the books held are flagged: they are for VMS's GSTINs, not the client's PAN")
    pg.click('button[data-act="booksWipe"]'); pg.wait_for_timeout(600)
    ok("Remove Tally data and all GST work?" in pg.inner_text("#confirmBox") and "Kept:" in pg.inner_text("#confirmBox"), "asks first, saying what goes and what stays")
    pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(2500)
    left = pg.evaluate("({v: (S.books.vouchers || []).length, t: Object.keys(S.books.twoBs || {}).length, s: !!S.books.gstSet, f: !!S.books.gstFiled, g: (S.books.gstVault || []).length, l: !!S.books.ledInfo, m: !!S.books.meta, ch: (S.books.challans || []).length, sal: (S.books.salary || []).length})")
    ok(left == {"v": 0, "t": 0, "s": False, "f": False, "g": 0, "l": False, "m": False, "ch": 1, "sal": 1}, "everything read from Tally and all GST work removed; TDS challans and salary kept: %s" % left)
    ok("Remove Tally data and all GST work" not in pg.inner_text("#app") and "not this client" not in pg.inner_text("#app"), "nothing left to remove")
    # VMS's day book, brought in again, is refused
    pg.set_input_files("#booksIn", fday); pg.wait_for_timeout(15000)
    ok("is not this client’s" in pg.inner_text("body") and "AADCV3366N" in pg.inner_text("body") and pg.evaluate("(S.books.vouchers || []).length") == 0, "VMS's day book is refused: its PAN is not the client's")
    if pg.locator('[data-cbx="yes"]').count(): pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(500)
    # and VMS's 2B
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'r2b'; render()"); pg.wait_for_timeout(1500)
    pg.evaluate("() => { window.__t = []; const o = window.toast; window.toast = m => { window.__t.push(m); }; }")
    pg.set_input_files("#twoBIn", f2b); pg.wait_for_timeout(2500)
    ok(pg.evaluate("Object.keys(S.books.twoBs || {}).length") == 0 and any("another PAN" in m for m in pg.evaluate("window.__t")), "VMS's 2B is refused: " + (pg.evaluate("window.__t") or [""])[-1])
    # the client's own GSTIN and PAN must agree
    pg.evaluate("S.tab = 'settings'; render()"); pg.wait_for_timeout(1500)
    pg.fill('input[data-c="gstin"]', "09AADCV3366N1ZQ"); pg.press('input[data-c="gstin"]', "Tab"); pg.wait_for_timeout(800)
    ok(any("PAN is AADCV3366N" in m and "AANFG3202D" in m for m in pg.evaluate("window.__t")), "a GSTIN whose PAN differs from the client's PAN is pointed out")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
