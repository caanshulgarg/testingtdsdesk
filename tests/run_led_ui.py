"""python3 run_led_ui.py - the Tally ledgers tab: bring in the masters, confirm, change, and the return files wait until done."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8127), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8127/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => {
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      window.__bk = S.books; S.booksTab = "import"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    pg.set_input_files("#mastersIn", os.path.join(os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")), "Master.xml")); pg.wait_for_timeout(12000)
    ok(pg.evaluate("Object.keys(S.books.ledInfo || {}).length") > 2000, "masters read: what Tally says about each ledger is kept")
    pg.evaluate("S.booksTab = 'ledgers'; S.lmView = ''; render();"); pg.wait_for_timeout(600)
    t = pg.inner_text("#app"); pend = pg.evaluate("LedMaster.pending(S.books).length")
    ok(pend > 40 and "confirm once for this client" in t, "Tally ledgers tab opens on the %d to confirm" % pend)
    pg.screenshot(path=OUT + "/led-pending.png", full_page=False)
    # GST screen shows the banner and will not make the JSON
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'r1'; S.gstYm = '202506'; S.gstReg = '07'; render();"); pg.wait_for_timeout(600)
    ok("still to be confirmed" in pg.inner_text("#app"), "GST screen: banner while ledgers wait")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-act="gstJson"]'); pg.wait_for_timeout(600)
    ok(pg.evaluate("window.__saved.length") == 0 and pg.evaluate("S.booksTab") == "ledgers", "GSTR-1 JSON waits and takes you to the ledgers")
    # change CONTROL A/C to GST: counts as confirmed at once
    pg.fill("#ledq", "CONTROL A/C 07 IGST"); pg.wait_for_timeout(700)
    pg.select_option('select[data-lmwhat="CONTROL A/C 07 IGST INPUT"]', "gst"); pg.wait_for_timeout(500)
    m = pg.evaluate("JSON.stringify(S.books.map['CONTROL A/C 07 IGST INPUT'])")
    ok('"what":"gst"' in m and '"ok":true' in m and '"tax":"IGST"' in m, "a choice made by hand is confirmed: " + m[:120])
    pg.fill("#ledq", ""); pg.wait_for_timeout(700)
    # a section for TDS PAYABLE CURRENT
    pg.fill("#ledq", "TDS PAYABLE CURRENT"); pg.wait_for_timeout(700)
    ok(pg.evaluate("document.querySelector('select[data-lmwhat=\"TDS PAYABLE CURRENT\"]').value") == "tds_clearing", "TDS PAYABLE CURRENT offered as a TDS clearing account")
    pg.fill("#ledq", ""); pg.wait_for_timeout(700)
    # confirm one guess with the button, then the rest shown
    first = pg.locator("button[data-lmok]").first; nm = first.get_attribute("data-lmok"); first.click(); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.books.map[%s].ok" % json.dumps(nm)) is True, "Confirm button: " + nm)
    pg.click('button[data-act="lmConfirmShown"]'); pg.wait_for_timeout(600)
    ok(pg.evaluate("LedMaster.pending(S.books).length") == 0, "confirm the rest shown: none left")
    # other ledgers: add one as GST
    pg.click('button[data-lmview="other"] >> nth=0'); pg.wait_for_timeout(500)
    pg.fill("#ledq", "SHORT AND EXCESS"); pg.wait_for_timeout(700)
    pg.select_option('select[data-lmwhat="SHORT AND EXCESS"]', "gst_setoff"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.books.map['SHORT AND EXCESS'].what") == "gst_setoff", "an ordinary ledger added to the GST master")
    pg.fill("#ledq", ""); pg.wait_for_timeout(500)
    pg.click('button[data-lmview="gst"] >> nth=0'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + "/led-gst.png", full_page=False)
    # now the JSON is made
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'r1'; render();"); pg.wait_for_timeout(500)
    ok("still to be confirmed" not in pg.inner_text("#app"), "banner gone once all are confirmed")
    pg.click('button[data-act="gstJson"]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("window.__saved.length") == 1, "GSTR-1 JSON made once ledgers are confirmed")
    # UP registration now has its own ITC
    itc = pg.evaluate("GSTR.threeB('202506', '09').itc")
    ok(itc["cgst"] > 0, "UP (09) June ITC comes from its own ledgers: CGST %s" % itc["cgst"])
    bad = pg.evaluate("""() => { const bad = []; ['pending', 'gst', 'tds', 'done', 'other'].forEach(v => { S.booksTab = 'ledgers'; S.lmView = v; try { render(); } catch (e) { bad.push(v + ': ' + e.message); } }); return bad; }""")
    ok(not bad, "every view renders" + ("" if not bad else ": " + "; ".join(bad)))
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
