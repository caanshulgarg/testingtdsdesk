"""python3 run_led2_ui.py - ledger master phase 2 in a browser: posting ledgers, templates across clients, copies at filing."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books_data import DATA, CACHE, FIXTURE, GSTIN, GSTIN09, COMPANY
# the ledgers these steps use: the real client's, or the fixture's (tests/fixtures/books)
GM = "202507" if FIXTURE else "202506"   # a month with invoices to registered customers (the fixture's June has none on 07)
CTRL, CLEAR, PLAIN, TDS194C = (("07 IGST INPUT PROVISIONAL", "TDS Payable - Month End", "Sundry Balances Written Off", "TDS ON CONTRACT 194C") if FIXTURE else
                               ("CONTROL A/C 07 IGST INPUT", "TDS PAYABLE CURRENT", "SHORT AND EXCESS", "TDS ON CONTRACT 194C 2%"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8133), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(CACHE)); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def open_client(pg, name, bk):
    pg.evaluate("""([name, bk]) => { const c = newCompany({name, gstin: "@GSTIN@", tallyName: "@CO@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.booksTab = "import"; render(); }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY), [name, bk])
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8133/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    open_client(pg, "ZZ TEST A (VMS books)", books)
    # FinCom 2.4.1: "What FinCom posts bills to" is no longer a tab of the ledgers page (the owner's decision); what it showed
    # is read from LedMaster.posting, the same rows
    pg.evaluate("S.booksTab = 'ledgers'; render();"); pg.wait_for_timeout(500)
    ok(pg.evaluate("LedMaster.posting(S.books, CO()).every(x => !x.from)"), "before confirming: nothing from the master")
    # FinCom 2.4.1: Confirm all (where FinCom and its check agree), then each row's Confirm
    if pg.locator("#app [data-led-confirm-agree]").count(): pg.click("#app [data-led-confirm-agree]"); pg.wait_for_timeout(500)
    while pg.locator("#app [data-led-table] tbody tr [data-led-confirm]").count():
        pg.locator("#app [data-led-table] tbody tr [data-led-confirm]").first.click(); pg.wait_for_timeout(300)
    pg.wait_for_timeout(500)
    co = pg.evaluate("JSON.stringify({gst: CO().gst, tds: CO().tdsLedgers, ro: CO().roundOff})")
    print("   posting after confirming: " + co[:300])
    ok('"cgst":"07 CGST INPUT"' in co and '"igst":"07 IGST INPUT"' in co, "empty posting ledgers filled from the confirmed master (Delhi input ledgers)")
    ok('"contractor":%s' % json.dumps(TDS194C) in co, "contractor TDS: the 194C ledger at the rule's rate, the most used")
    ok(pg.evaluate("LedMaster.posting(S.books, CO()).some(x => x.from && x.from === x.now)"), "each posting slot and where it comes from (the master's, the same)")
    # set one by hand elsewhere, then use the master's (lmPost, what the tab's "Use it" did)
    pg.evaluate("CO().gst.sgst = 'Input SGST'; render();"); pg.wait_for_timeout(300)
    ok(pg.evaluate("CO().gst.sgst") == "Input SGST", "a slot set by hand is kept")
    pg.evaluate("lmPost('gst.sgst')"); pg.wait_for_timeout(300)
    ok(pg.evaluate("CO().gst.sgst") == "07 SGST INPUT", "a slot set by hand is kept until 'Use it'")
    # a return made, then a ledger changed: the banner names the return
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); S.booksTab = 'gst'; S.gstPart = 'r1'; S.gstYm = '" + GM + "'; S.gstReg = '07'; render(); }")
    pg.click('button:has-text("Download GSTR-1 JSON")'); pg.wait_for_timeout(800)
    ok(pg.evaluate("(S.books.ledSnaps || []).length") == 1, "a copy of the master kept with the GSTR-1 JSON")
    pg.evaluate("S.booksTab = 'ledgers'; S.ledQ = %s; render();" % json.dumps(CTRL[:-6])); pg.wait_for_timeout(500)
    pg.click('#app [data-led-change=%s]' % json.dumps(CTRL)); pg.wait_for_timeout(300)   # 2.4.0: Change opens the choices
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)   # 2.4.1: a confirmed ledger used in entries asks once
    pg.select_option('select[aria-label="What %s is"]' % CTRL, "gst"); pg.wait_for_timeout(500)
    pg.evaluate("() => { const d = document.querySelector('#app details[data-led-notices]'); if (d) d.open = true; }"); pg.wait_for_timeout(200)   # 2.4.1: in Other notices
    t = pg.inner_text("#app")
    ok("changed after returns were made from them" in t and ("GSTR-1 " + pg.evaluate("GSTR.label(%s)" % json.dumps(GM)) + " 07") in t, "changing a ledger after filing names the return made before")
    pg.screenshot(path=OUT + "/led-changed.png", full_page=False)
    # a second client: the first client's confirmations are the guesses
    open_client(pg, "ZZ TEST B (same books)", books)
    pg.evaluate("S.booksTab = 'ledgers'; S.ledQ = ''; render();"); pg.wait_for_timeout(500)
    why = pg.evaluate("S.books.map[%s].why + ' | ' + S.books.map[%s].what + ' | ' + S.books.map[%s].why" % (json.dumps(CLEAR), json.dumps(CTRL), json.dumps(CTRL)))
    ok("confirmed this way for 1 other client" in why and "| gst |" in why, "second client: guessed as the first client confirmed, still to confirm: " + why[:120])
    ok(pg.evaluate("LedMaster.pending(S.books).length") > 0, "nothing counts as confirmed for the second client until it is confirmed there")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
