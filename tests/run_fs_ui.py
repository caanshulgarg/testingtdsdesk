"""python3 run_fs_ui.py - the Financial statements page (was the Accounts tab) in a browser, on the books of tests/data or the
made-up books: the statements drawn and tallied, a ledger's code by hand and back, the Loan given tick, the non-corporate
format, the downloads. Run on the React build (the default): TDSDESK_SITE=../app/dist-test python3 run_fs_ui.py"""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books_data import DATA, CACHE, FIXTURE, GSTIN, GSTIN09, COMPANY
HERE = os.path.dirname(os.path.abspath(__file__)); SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8136), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE)); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8136/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "@GSTIN@", tallyName: "@CO@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.booksTab = "import"; render(); }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY), books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
    pg.evaluate("""() => { const led = {}; Object.entries(S.books.ledInfo).forEach(([n, i]) => { led[n] = {open: i.ob || 0, close: 0, parent: i.group}; }); S.books.tb = {from: "20250401", to: "20260331", at: new Date().toISOString(), led}; S.booksTab = "fs"; S.fsTab = ""; render(); }""")
    pg.wait_for_timeout(2500)
    ok(pg.locator("#app [data-fin-head] select[aria-label=Year]").count() == 1 and pg.locator('#app table[data-fin-table="bs"]').count() == 1, "Financial statements: the year and the balance sheet, drawn at once")
    t = pg.inner_text("#app")
    ok("Balance sheet as at" in t and "Shareholders' funds" in t, "Schedule III balance sheet")
    tot = pg.locator('#app tr[data-fin-total] td:nth-child(3)').evaluate_all("xs => xs.map(x => x.innerText.trim())")
    # the balance sheet tallies and every check reads 0 (on the made-up books the depreciation is credited to the assets
    # themselves, with no accumulated-depreciation ledger: FinSt still puts the year's 60,000 in the P&L and in Note 8 / 34)
    why = pg.evaluate("(() => { const d = FinSt.build(fsYearNow(), {unit: 1, dec: 2}); return d.checks.filter(c => c.value).map(c => c.key + ' ' + c.value); })()")
    chip = pg.locator('#app [data-fin-tab="checks"] .sbar-n')
    ok(len(tot) == 2 and tot[0] == tot[1] and not why and chip.count() == 0, "the balance sheet tallies (%s), every check 0 (%s)" % (tot, why))
    pg.screenshot(path=OUT + "/fs.png", full_page=False)
    pg.click('#app nav.fin-tabs [data-fin-tab="tb"]'); pg.wait_for_timeout(1200)
    l = pg.locator('#app table[data-fin-table="tb"] button[data-fin-codebtn]').first.get_attribute("data-fin-codebtn")
    pg.click('#app button[data-fin-codebtn=%s]' % json.dumps(l)); pg.wait_for_timeout(300); pg.click('#app [data-fin-pick] button[data-fin-code="12K"]'); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.books.fs.map[%s]" % json.dumps(l)) == "12K" and "By hand" in pg.inner_text('#app tr[data-key=%s]' % json.dumps(l)), "a ledger given a code by hand: " + l)
    pg.click('#app button[data-fin-codebtn=%s]' % json.dumps(l)); pg.wait_for_timeout(300); pg.click('#app [data-fin-pick] button:text-is("Back to suggested")'); pg.wait_for_timeout(1500)
    ok(l not in pg.evaluate("Object.keys(S.books.fs.map)"), "and back to the suggested code")
    if FIXTURE:
        # round 4 (03-Oct-2026), item 26: a ledger under Loans & Advances (Asset) gets a tick "Loan given (investing)", a
        # per-ledger choice (co.choices["flow:<ledger>"] = loan_given) confirmed by the person; the cash flow then puts it
        # under investing, Loans given. No other ledger has the tick (now a column of the trial balance)
        pg.fill("#finq", "Ravi Menon"); pg.wait_for_timeout(800)
        box = pg.locator('input[aria-label="Loan given (investing): Loan to Staff - Ravi Menon"]')
        ok(box.count() == 1 and not box.is_checked() and pg.locator('#app table[data-fin-table="tb"] tbody tr[data-key]').count() == 1, "the Loans & Advances (Asset) ledger has a Loan given tick, unticked")
        pg.fill("#finq", "Printing"); pg.wait_for_timeout(800)
        ok(pg.locator('input[aria-label^="Loan given (investing): "]').count() == 0, "a ledger of another group has no tick")
        pg.fill("#finq", "Ravi Menon"); pg.wait_for_timeout(800)
        box.check(); pg.wait_for_timeout(900)
        c = pg.evaluate("(CO().choices || {})['flow:Loan to Staff - Ravi Menon']")
        ok(bool(c) and c["value"] == "loan_given" and c["state"] == "confirmed" and bool(c["by"]) and bool(c["at"]), "ticked: co.choices['flow:Loan to Staff - Ravi Menon'] = loan_given, confirmed, by whom and when (%s)" % c)
        ok(pg.evaluate("MIS.flowHead('Loan to Staff - Ravi Menon').slice(0, 2)") == ["inv", "Loans given"] and box.is_checked(), "the cash flow puts it under investing, Loans given")
        box.uncheck(); pg.wait_for_timeout(900)
        ok(pg.evaluate("!(CO().choices || {})['flow:Loan to Staff - Ravi Menon']") and pg.evaluate("MIS.flowHead('Loan to Staff - Ravi Menon')[1]") == "Loans and advances (asset)", "unticked: the choice forgotten, back to operating")
        pg.fill("#finq", ""); pg.wait_for_timeout(500)
    pg.click('#app nav.fin-tabs [data-fin-tab="bs"]'); pg.wait_for_timeout(400)
    pg.click("#app [data-fin-details-open]"); pg.wait_for_timeout(600)
    pg.select_option('#app [data-detail="finInputs"] select[aria-label="Format"]', "nc"); pg.wait_for_timeout(1500)
    pg.click('#app [data-detail="finInputs"] button:text-is("Done")'); pg.wait_for_timeout(600)
    ok(any(w in pg.inner_text("#app") for w in ["Owners' funds", "Partners' funds", "Proprietor's funds"]) and pg.evaluate("FS.cfg(S.books).kind") == "nc", "the non-corporate format")
    pg.evaluate("() => { window.__calls = []; window.FinXlsx = {download: (fy, o) => window.__calls.push(['xlsx', fy, o])}; window.FinPdf = {open: (fy, o) => window.__calls.push(['pdf', fy, o])}; }")
    pg.click('#app [data-fin-dl="pdf"]'); pg.click('#app [data-fin-dl="xlsx"]'); pg.wait_for_timeout(500)
    ok([c[0] for c in pg.evaluate("window.__calls")] == ["pdf", "xlsx"], "as PDF and Excel (the writers called)")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
