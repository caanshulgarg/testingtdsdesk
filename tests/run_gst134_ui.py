"""python3 run_gst134_ui.py - build 134: one GSTIN at a time, 3B payment of tax, the input register, GSTR-1 JSON rate by rate.
On a real client's export (tests/data with Master.xml) it checks VMS's books as before; with the made-up books
(tests/fixtures/books, books_data.FIXTURE) it checks the figures worked out by hand in EXPECTED.md ("GST: the Delhi
registration's returns")."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books_data import DATA, CACHE, FIXTURE, GSTIN, COMPANY
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8136), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(CACHE)); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8136/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "@NAME@", gstin: "@GSTIN@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "@TAB@"; S.gstPart = "g9"; S.gstYm = "202603"; S.gstReg = ""; render(); }""".replace("@NAME@", "ZZ TEST (" + COMPANY + ")" if FIXTURE else "ZZ TEST (VMS books)").replace("@GSTIN@", GSTIN if FIXTURE else "07AADCV3366N1ZU").replace("@TAB@", "import" if FIXTURE else "gst"), books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600 if FIXTURE else 3000)
    if FIXTURE:   # the made-up books' masters: their GST ledgers by registration and the parties' GSTINs
        pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
        pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'g9'; S.gstYm = '202603'; S.gstReg = ''; render();"); pg.wait_for_timeout(3000)
    G = GSTIN if FIXTURE else "07AADCV3366N1ZU"
    t = pg.inner_text("#app"); open(OUT + "/b134-g9.txt", "w").write(t)
    ok(pg.evaluate("S.gstReg") == "07" and "Both registrations" not in t, "one GSTIN at a time: the company's own chosen, no 'both'")
    ok("GSTR-9 for 2025-26, " + G in t and "PAID THROUGH ITC: IGST" in t.upper(), "GSTR-9 opens without choosing, with table 9 in its columns")
    ok("no 2B brought in for this year" in t and "6B 6B" not in t, "8A/8D say no 2B instead of a false difference; 6B label once")
    pg.screenshot(path=OUT + "/b134-gst9.png", full_page=True)
    # the fixture opens 3B on Nov-2025: a month with reverse charge paid in cash (Jan to Mar 2026) does not draw, FINDING 6
    # in EXPECTED.md, checked at the end
    if FIXTURE: pg.evaluate("S.gstYm = '202511'; render();"); pg.wait_for_timeout(800)
    pg.click('nav[aria-label="GST"] button[data-part="r3b"]'); pg.wait_for_timeout(2500); t = pg.inner_text("#app")
    ok("6.1 PAYMENT OF TAX" in t.upper() and "Credit carried to next month" in t, "3B shows payment of tax and credit carried")
    if FIXTURE:   # EXPECTED.md: no month of the Delhi registration has a negative cash payment
        neg = pg.evaluate("GSTR.months().filter(m => ['igst', 'cgst', 'sgst', 'cess'].some(h => GSTR.threeB(m, '07').pay.cash[h] < 0))")
        ok(not neg, "no negative tax payable in any month (%s)" % neg)
    else: ok("-20,59,779" not in t, "no negative tax payable")
    rc = pg.evaluate("GSTR.threeB('202603','07').rcmOut"); ok(rc["igst"] > 0, "3.1(d) has the reverse charge in March: " + str(rc))
    if FIXTURE:   # EXPECTED.md: Mar-2026, 07: the advocate's IGST 7,200 on 40,000 and the godown rent's CGST and SGST 1,800 each on 20,000
        ok([rc["taxable"], rc["igst"], rc["cgst"], rc["sgst"]] == [60000, 7200, 1800, 1800], "fixture: 3.1(d) in March on 60,000: IGST 7,200, CGST 1,800, SGST 1,800, as worked out by hand")
    pg.select_option('select[aria-label=Month]', "202504"); pg.wait_for_timeout(2500)
    ok("typed in GST settings" in pg.inner_text("#app") and pg.locator('input[data-gstopen]').count() == 0, "the first month points to GST settings for the credit ledger balance")
    # the UP registration's first month with tax: VMS's April; the fixture's June (CGST 4,500 less credit 1,800 = 2,700 in cash)
    YM09 = "202506" if FIXTURE else "202504"
    before = pg.evaluate("GSTR.threeB('%s','09').pay.cash.igst + GSTR.threeB('%s','09').pay.cash.cgst" % (YM09, YM09))
    pg.evaluate("S.tab = 'gstset'; S.gsetReg = '09'; render()"); pg.wait_for_timeout(2500)
    ok("GST settings" in pg.inner_text("#app") and "Filing type" in pg.inner_text("#app"), "Client setup \u2192 GST: the settings for each GSTIN")
    pg.fill('section[data-greg="09"] input[aria-label="Opening CGST"]', "500000"); pg.press('section[data-greg="09"] input[aria-label="Opening CGST"]', "Tab"); pg.wait_for_timeout(2500)
    after = pg.evaluate("GSTR.threeB('%s','09').pay.cash.igst + GSTR.threeB('%s','09').pay.cash.cgst" % (YM09, YM09))
    ok(pg.evaluate("S.books.gstOpen['09'].cgst") == 500000 and after < before, "an opening balance typed in settings reduces cash payable: %s to %s" % (before, after))
    if FIXTURE: ok([before, after] == [2700, 0], "fixture: Jun-2025, 09: CGST in cash 2,700 before, nil once the opening credit of 5,00,000 is carried to June (%s)" % [before, after])
    pg.screenshot(path=OUT + "/gst-settings.png", full_page=False)
    pg.click('#app [data-confirm-foot="setup:gstset"] [data-cfm="save"]'); pg.wait_for_timeout(500)   # review 18 (02-Oct-2026): saved with Save
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(2000)
    if FIXTURE: pg.click('nav[aria-label="GST"] button[data-part="inreg"]'); pg.wait_for_timeout(1500)   # March's 3B does not draw (FINDING 6): the register first
    pg.select_option('select[aria-label=Month]', "202603"); pg.wait_for_timeout(1500)
    pg.click('nav[aria-label="GST"] button[data-part="inreg"]'); pg.wait_for_timeout(3000); t = pg.inner_text("#app")
    ok("Input register, Mar-2026" in t and "they agree." in t, "input register for the month ties to 3B table 4")
    if FIXTURE:   # EXPECTED.md: the advocate (IGST 7,200) and March's rent journal (CGST 1,800 + SGST 1,800): 10,800 = 3B table 4
        ir = pg.evaluate("(() => { const s = GSTR.inward('202603', '07'), t = GSTR.threeB('202603', '07'); return [s.reduce((a, r) => a + r.igst + r.cgst + r.sgst, 0), t.rcmIn ? t.rcmIn.igst + t.rcmIn.cgst + t.rcmIn.sgst : null, s.map(r => r.party).sort()]; })()")
        ok(ir[0] == 10800 and ir[2] == ["Keshav Rathore, Advocate", "Rukmini Sethuraman"], "fixture: March's register 10,800 from the advocate and the landlord, by hand (%s)" % ir)
    ok("Reverse charge" in t and "2B not brought in" in t, "kinds and 2B status shown")
    pg.screenshot(path=OUT + "/b134-inreg.png", full_page=False)
    pg.select_option('select[aria-label="Period"]', "year"); pg.wait_for_timeout(5000); t = pg.inner_text("#app")
    ok("the year Apr-2025 to Mar-2026" in t and "they agree." in t, "the whole year ties to the twelve 3Bs")
    pg.select_option('select[aria-label="Show"]', "Reverse charge"); pg.wait_for_timeout(3000); t = pg.inner_text("#app")
    if FIXTURE: ok("Rukmini Sethuraman" in t and "Keshav Rathore, Advocate" in t and "Ashvattha Transport Co" in t and "Juniper Legal Associates" not in t, "fixture: filter by kind: the reverse-charge rent journals, the advocate and the transporter, and no one else")
    else: ok("GYANESH SHARMA" in t, "filter by kind: the reverse-charge rent journals")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => window.__saved.push(n); }")
    pg.click('.gf-ctl button:has-text("Excel")'); pg.wait_for_timeout(5000)
    ok(any("Input-register-" + G in n for n in pg.evaluate("window.__saved")), "input register as Excel")
    j = pg.evaluate("GSTR.toJson('202603','07',{plain:true})")
    inv = [i for s in j.get("b2b", []) for i in s["inv"] if i["inum"] == ("LFE/25-26/016" if FIXTURE else "VMS/DL/25-26/695")]
    ok(inv and sorted(x["itm_det"]["rt"] for x in inv[0]["itms"]) == [5, 18], "the two-rate invoice goes out as two items, 5% and 18%")
    if FIXTURE:   # EXPECTED.md: LFE/25-26/016, 1,00,000 at 5% (CGST 2,500 + SGST 2,500) and 50,000 at 18% (CGST 4,500 + SGST 4,500)
        ok(sorted([x["itm_det"]["rt"], x["itm_det"]["txval"], x["itm_det"]["camt"], x["itm_det"]["samt"]] for x in inv[0]["itms"]) == [[5, 100000, 2500, 2500], [18, 50000, 4500, 4500]], "fixture: the two items as worked out by hand")
    rates = set(x["itm_det"]["rt"] for s in j.get("b2b", []) for i in s["inv"] for x in i["itms"])
    ok(rates <= {0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40}, "every rate in the JSON is a GST rate: " + str(sorted(rates)))
    ok("hsn_b2b" in j.get("hsn", {}) and all("rt" in h for h in j["hsn"]["hsn_b2b"]), "HSN summary with its rate, B2B and B2C apart")
    if FIXTURE:   # EXPECTED.md: 998596 at 18% on 1,00,000 (Orchid Lane's IGST 9,000; Wisteria's CGST and SGST 4,500 each); 6304 at 5% on 1,00,000
        ok(sorted([h["hsn_sc"], h["rt"], h["txval"], h["iamt"], h["camt"], h["samt"]] for h in j["hsn"]["hsn_b2b"]) == [["6304", 5, 100000, 0, 2500, 2500], ["998596", 18, 100000, 9000, 4500, 4500]] and not j["hsn"].get("hsn_b2c"),
           "fixture: the HSN summary for March, B2B only, as worked out by hand")
    if FIXTURE:
        # FINDING 6 (EXPECTED.md): GSTF.journal's ledger finder calls itself without end when the month has reverse charge paid
        # in cash and no ledger is mapped as a reverse-charge payable (the fixture's "07 RCM CGST PAYABLE" is read as a
        # set-off ledger, "GST PAYABLE" being tested before "RCM"); the 3B screen then cannot be drawn. Fails until fixed
        pg.evaluate("S.gstPart = 'r3b'; S.gstYm = '202603'; S.gstReg = '07'; render();"); pg.wait_for_timeout(3000); t = pg.inner_text("#app")
        ok("could not be shown" not in t and "6.1 PAYMENT OF TAX" in t.upper(), "FINDING 6: the 3B for Mar-2026 (reverse charge 10,800 paid in cash) draws")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
