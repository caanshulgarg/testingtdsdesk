"""python3 run_amend_ui.py - bring in a filed GSTR-1 JSON, change the books, and work the Amendments screen."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8125), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}, accept_downloads=True)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8125/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => {
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      LedMaster.refresh(S.books); LedMaster.confirm(S.books, LedMaster.pending(S.books).map(x => x[0]), true); window.__bk = S.books; S.booksTab = "gst"; S.gstPart = "amend"; S.gstYm = "202508"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    # the June return as it was filed, written to a file and brought in through the button
    jun = pg.evaluate("JSON.stringify(GSTR.toJson('202506', '07', {plain: true}))")
    open(os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")), "GSTR1_june_filed.json"), "w").write(jun)
    pg.set_input_files("#filedIn", os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")), "GSTR1_june_filed.json")); pg.wait_for_timeout(1000)
    t = pg.inner_text("#app")
    ok("brought in" in t and "Jun 2025" in t, "filed June return brought in and listed")
    ok("Nothing to amend" in t, "nothing to amend while the books match")
    # change the books: one invoice up 10%, one removed
    pg.evaluate("""() => { const vs = S.books.vouchers.filter(v => GSTR.ym(v.date) === '202506' && Books.isSale(v) && v.gstin && GSTR.regOf(v) === '07' && !/CREDIT/i.test(v.type));
      vs[0].ent.forEach(e => { e.a = Math.round(e.a * 110) / 100; }); const gone = vs[1]; S.books.vouchers = S.books.vouchers.filter(v => v !== gone); window.__nos = [vs[0].no, gone.no]; render(); }""")
    pg.wait_for_timeout(600)
    t = pg.inner_text("#app"); nos = pg.evaluate("window.__nos")
    ok(nos[0] in t and nos[1] in t, "both changed invoices listed: " + ", ".join(nos))
    ok("filed, but no longer in the books" in t, "removed invoice explained")
    pg.screenshot(path=OUT + "/amend.png", full_page=True)
    # leave the removed one
    sel = pg.locator('select[data-amendact]').nth(1)
    sel.select_option("skip"); pg.wait_for_timeout(400)
    ok(list(pg.evaluate("Object.values(S.books.amendFix)")) == ["skip"], "choice kept")
    # the JSON for August has the amendment and not the one left alone
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => blob.text().then(t => window.__saved.push([n, t])); }")
    pg.click('button[data-act="gstJson"] >> nth=0'); pg.wait_for_timeout(800)
    saved = pg.evaluate("window.__saved")
    ok(saved and saved[0][0].startswith("GSTR1_07"), "JSON downloaded: " + (saved[0][0] if saved else ""))
    j = json.loads(saved[0][1]) if saved else {}
    b2ba = [i for g in j.get("b2ba", []) for i in g["inv"]]
    ok(any(i["oinum"] == nos[0] for i in b2ba) and not any(i["oinum"] == nos[1] for i in b2ba), "b2ba has the amended invoice only")
    ok(pg.evaluate("Object.keys(S.books.filed).length") == 2, "the August download is kept as a filed copy")
    # GSTR-1 tab tile, then September shows nothing pending for June
    pg.evaluate("S.gstPart = 'r1'; S.gstYm = '202508'; render();"); pg.wait_for_timeout(500)
    ok("Earlier months to amend" in pg.inner_text("#app"), "GSTR-1 screen points to the amendments")
    pg.evaluate("S.gstPart = 'amend'; S.gstYm = '202509'; render();"); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok(nos[0] not in t.split("To report in")[1], "September: June's amendment already reported in August")
    ok(nos[1] in t.split("To report in")[1], "the one left alone is still there to decide")
    # June's own check
    pg.evaluate("S.gstYm = '202506'; render();"); pg.wait_for_timeout(500)
    ok("the books against the return filed" in pg.inner_text("#app").lower(), "June shows the books against its own return")
    # 'not filed' takes a copy out
    pg.evaluate("S.gstYm = '202509'; render();"); pg.wait_for_timeout(300)
    pg.locator('input[data-filednot]').nth(1).check(); pg.wait_for_timeout(400)
    ok(nos[0] in pg.inner_text("#app").split("To report in")[1], "marking August 'not filed' brings June's amendment back")
    bad = pg.evaluate("""() => { const bad = []; GSTR.months().forEach(m => ['07', '09', ''].forEach(r => ['r1', 'amend'].forEach(pt => {
      S.gstYm = m; S.gstReg = r; S.gstPart = pt; try { render(); } catch (e) { bad.push(m + r + pt + ': ' + e.message); } }))); return bad; }""")
    ok(not bad, "every month and registration renders" + ("" if not bad else ": " + "; ".join(bad[:3])))
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
