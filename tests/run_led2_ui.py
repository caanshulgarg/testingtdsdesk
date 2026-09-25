"""python3 run_led2_ui.py - ledger master phase 2 in a browser: posting ledgers, templates across clients, copies at filing."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8133), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def open_client(pg, name, bk):
    pg.evaluate("""([name, bk]) => { const c = newCompany({name, gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.booksTab = "import"; render(); }""", [name, bk])
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    pg.set_input_files("#mastersIn", os.path.join(os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")), "Master.xml")); pg.wait_for_timeout(12000)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8133/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    open_client(pg, "ZZ TEST A (VMS books)", books)
    pg.evaluate("S.booksTab = 'ledgers'; S.lmView = 'post'; render();"); pg.wait_for_timeout(500)
    ok("none confirmed" in pg.inner_text("#app"), "before confirming: nothing from the master")
    pg.evaluate("S.lmView = 'pending'; render();"); pg.wait_for_timeout(300)
    pg.click('button[data-act="lmConfirmShown"]'); pg.wait_for_timeout(800)
    co = pg.evaluate("JSON.stringify({gst: CO().gst, tds: CO().tdsLedgers, ro: CO().roundOff})")
    print("   posting after confirming: " + co[:300])
    ok('"cgst":"07 CGST INPUT"' in co and '"igst":"07 IGST INPUT"' in co, "empty posting ledgers filled from the confirmed master (Delhi input ledgers)")
    ok('"contractor":"TDS ON CONTRACT 194C 2%"' in co, "contractor TDS: the 194C ledger at the rule's rate, the most used")
    pg.evaluate("S.lmView = 'post'; render();"); pg.wait_for_timeout(400)
    ok("What TDS Desk posts bills to" in pg.inner_text("#app") and "same" in pg.inner_text("#app"), "the posting view shows each slot and where it comes from")
    pg.screenshot(path=OUT + "/led-post.png", full_page=False)
    # set one by hand elsewhere, then use the master's
    pg.evaluate("CO().gst.sgst = 'Input SGST'; render();"); pg.wait_for_timeout(300)
    pg.click('button[data-lmpost="gst.sgst"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("CO().gst.sgst") == "07 SGST INPUT", "a slot set by hand is kept until 'Use it'")
    # a return made, then a ledger changed: the banner names the return
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); S.booksTab = 'gst'; S.gstPart = 'r1'; S.gstYm = '202506'; S.gstReg = '07'; render(); }")
    pg.click('button[data-act="gstJson"]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("(S.books.ledSnaps || []).length") == 1, "a copy of the master kept with the GSTR-1 JSON")
    pg.evaluate("S.booksTab = 'ledgers'; S.lmView = 'gst'; S.ledQ = 'CONTROL A/C 07 IGST'; render();"); pg.wait_for_timeout(500)
    pg.select_option('select[data-lmwhat="CONTROL A/C 07 IGST INPUT"]', "gst"); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("changed after returns were made from them" in t and "GSTR-1 Jun 2025 07" in t, "changing a ledger after filing names the return made before")
    pg.screenshot(path=OUT + "/led-changed.png", full_page=False)
    # a second client: the first client's confirmations are the guesses
    open_client(pg, "ZZ TEST B (same books)", books)
    pg.evaluate("S.booksTab = 'ledgers'; S.lmView = 'pending'; S.ledQ = ''; render();"); pg.wait_for_timeout(500)
    why = pg.evaluate("S.books.map['TDS PAYABLE CURRENT'].why + ' | ' + S.books.map['CONTROL A/C 07 IGST INPUT'].what + ' | ' + S.books.map['CONTROL A/C 07 IGST INPUT'].why")
    ok("confirmed this way for 1 other client" in why and "| gst |" in why, "second client: guessed as the first client confirmed, still to confirm: " + why[:120])
    ok(pg.evaluate("LedMaster.pending(S.books).length") > 0, "nothing counts as confirmed for the second client until it is confirmed there")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
