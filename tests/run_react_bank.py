"""python3 run_react_bank.py - the bank screen in React: the statement, its tabs, ticking lines, the bar at the bottom
with Undo, a line's ledger, grouping by party, search and "set them all", the menus. Offline, a made-up statement.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_bank.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8157), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# 24 lines of a made-up ICICI statement: some to review, some ready, some already in Tally (as run_ledgerpick_ui.py)
SETUP = """() => {
  const c = newCompany({name: "GARG SHEKHAR & COMPANY", gstin: "09AAKFG1234C1Z5"}); c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", ledger: "ICICI Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const parties = ["DIPTI VATS", "PAYUAMAZON", "BHARATKOSH", "PERFEKT SENSE DIGITA", "CLOUD WIZARD CONSULTING", "AMAZON GROCERIES", "CCAPROTEAN", "NAVNEET TENDER DSC"];
  const states = ["ready","ready","ready","attention","suggested","sent","intally","ready"];
  let bal = 250000;
  const rows = Array.from({length: 24}, (_, i) => { const out = i % 3 !== 1; const amt = [2000, 28788, 2970, 1000, 100000, 5.9, 16200, 1482][i % 8] * (1 + (i % 5) / 10);
    bal += out ? -amt : amt;
    return {id: "r" + i, fp: "fp" + i, date: "2026-04-" + String(1 + i).padStart(2, "0"), debit: out ? r2(amt) : 0, credit: out ? 0 : r2(amt), bal: r2(bal),
      narr: (out ? "NEFT DR " : "NEFT CR ") + parties[i % 8] + " UTR" + (100000 + i), dec: {name: parties[i % 8], mode: "NEFT", utr: "UTR" + (100000 + i)},
      ledger: states[i % 8] === "attention" ? "" : parties[i % 8], state: states[i % 8], tally: states[i % 8] === "sent" ? {guid: "g" + i} : undefined, balOk: true, why: states[i % 8] === "attention" ? ["No ledger found for this party."] : []}; });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-04-01", to: "2026-04-24", opening: 250000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "ICICI Bank", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "",
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8157/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(600)
    app = lambda: pg.inner_text("#app")
    bar = lambda: pg.inner_text("#app .actionbar")
    rows = lambda: pg.locator("#app table.bk-table tbody tr")
    tc = pg.evaluate("tabCounts(B().rows)")
    ok(pg.inner_text("#app .bk-title") == "ICICI Bank" and "24 entries" in pg.inner_text("#app .bk-sub"), "the statement: its Tally ledger and 24 entries")
    ok("The statement adds up" in pg.inner_text("#app .bk-check"), "the running-balance check")
    ok(rows().count() == tc["review"] and ("%d to review" % tc["review"]) in bar().replace("\n", " "), "To review: %d lines, and the bar says so" % tc["review"])
    pg.click('#app .bk-tabs button:has-text("Post to Tally")'); pg.wait_for_timeout(400)
    ok(rows().count() == tc["ready"] and pg.get_attribute('#app .bk-tabs button:has-text("Post to Tally")', "aria-selected") == "true", "Ready to post: %d lines" % tc["ready"])
    # ticking, with Shift for a run of lines
    pg.click('#app table.bk-table tbody tr >> nth=0 >> input[type=checkbox]')
    pg.click('#app table.bk-table tbody tr >> nth=3 >> input[type=checkbox]', modifiers=["Shift"]); pg.wait_for_timeout(400)
    ok(pg.evaluate("B().sel.size") == 4 and "4 selected" in bar(), "tick one, Shift-tick the fourth: four selected")
    ok(pg.locator("#app table.bk-table tbody tr.picked").count() == 4, "and the four lines are marked")
    pg.click('#app .actionbar button:has-text("Ignore")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("B().rows.filter(r => r.state === 'ignored').length") == 4 and "ignored" in bar(), "Ignore: four ignored, and the bar offers Undo")
    pg.click('#app .actionbar .bk-snack button:has-text("Undo")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("B().rows.filter(r => r.state === 'ignored').length") == 0, "Undo puts them back")
    pg.click('#app table.bk-table thead input[aria-label="Select all"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("B().sel.size") == rows().count(), "Select all: every line shown")
    pg.click('#app .actionbar button:has-text("Clear")'); pg.wait_for_timeout(300)
    ok(pg.evaluate("B().sel.size") == 0 and "to review" in bar(), "Clear")
    # a line to review: confirm a suggestion, a ledger typed that Tally does not have
    pg.click('#app .bk-tabs button:has-text("To review")'); pg.wait_for_timeout(300)
    sug = pg.evaluate("B().rows.find(r => r.state === 'suggested').id")
    pg.click('#app tr:has(input[data-bled="%s"]) button:has-text("Confirm")' % sug); pg.wait_for_timeout(400)
    ok(pg.evaluate("bankRow('%s').state" % sug) == "ready", "Confirm on a suggested line: ready")
    att = pg.evaluate("B().rows.find(r => r.state === 'attention').id")
    box = pg.locator('#app input[data-bled="%s"]' % att)
    box.fill("NO SUCH LEDGER"); box.press("Tab"); pg.wait_for_timeout(400)
    ok(pg.evaluate("bankRow('%s').ledger" % att) == "" and box.input_value() == "", "a name Tally does not have: refused, the box empties again")
    box.fill("CCAPROTEAN"); box.press("Tab"); pg.wait_for_timeout(500)
    ok(pg.evaluate("bankRow('%s').ledger" % att) == "CCAPROTEAN" and pg.evaluate("bankRow('%s').state" % att) == "ready", "a Tally ledger typed and left: the line is ready")
    pg.click('#app tr:has(input[data-bled="%s"]) button[aria-label="Ignore"]' % pg.evaluate("B().rows.find(r => ['attention','suggested'].includes(r.state)).id")); pg.wait_for_timeout(400)
    pg.click('#app .bk-tabs button:has-text("In Tally")'); pg.wait_for_timeout(300)
    ok(pg.locator('#app table.bk-table button:has-text("Restore")').count() >= 1 and "Ignored" in app(), "✕ ignores a line; it is under In Tally, with Restore")
    pg.click('#app table.bk-table tr:has-text("Ignored") button:has-text("Restore")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("B().rows.filter(r => r.state === 'ignored').length") == 0, "Restore")
    # search, and give every line found one ledger
    pg.click('#app .bk-tabs button:has-text("Post to Tally")'); pg.wait_for_timeout(300)
    pg.fill('#app input[aria-label="Search the statement"]', "DIPTI"); pg.wait_for_timeout(600)
    n = pg.evaluate("bankVisibleRows().length")
    ok(n >= 1 and rows().count() == n and ("%d entr" % n) in pg.inner_text('#app .bk-found:has-text("match")').replace("\n", " ") and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Search the statement", "search “DIPTI”: %d lines, the cursor stays in the box" % n)
    pg.fill('#app input[aria-label="Ledger for all found"]', "BHARATKOSH"); pg.click('#app .bk-found:has-text("match") button:has-text("Set all")'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx").is_visible(), "“Set all” asks first")
    pg.click('#confirmBox button[data-cbx="yes"]'); pg.wait_for_timeout(500)
    ok(pg.evaluate("bankVisibleRows().every(r => r.ledger === 'BHARATKOSH' || r.state === 'sent' || r.state === 'intally')"), "and every line found gets that ledger")
    pg.click('#app .bk-found:has-text("match") button:has-text("Clear")'); pg.wait_for_timeout(400)
    ok(pg.input_value('#app input[aria-label="Search the statement"]') == "" and pg.locator('#app .bk-found:has-text("match")').count() == 0, "Clear empties the search")
    # group by party
    pg.evaluate("B().rows.slice(0, 3).forEach(r => { r.state = 'attention'; r.ledger = ''; }); B().rows[0].dec.key = B().rows[1].dec.key = 'k-dipti'; render()")
    pg.click('#app .bk-tabs button:has-text("To review")'); pg.wait_for_timeout(300)
    pg.click('#app label:has-text("Group by party") input'); pg.wait_for_timeout(400)
    ok("ledger for all its entries" in app().lower() and rows().count() == pg.evaluate("bankGroups().length"), "Group by party: one line per party")
    g = pg.locator('#app input[data-gkey="k-dipti"]'); g.fill("DIPTI VATS")
    pg.click('#app tr:has(input[data-gkey="k-dipti"]) button:has-text("Apply")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("B().rows.filter(r => r.dec.key === 'k-dipti').every(r => r.ledger === 'DIPTI VATS')"), "Apply: both lines of that party get the ledger")
    pg.click('#app label:has-text("Group by party") input'); pg.wait_for_timeout(300)
    # menus and panels
    pg.click('#app .bk-menu summary'); pg.wait_for_timeout(200)
    ok(pg.locator('#app .bk-menu-list button:has-text("Reconcile with Tally")').count() == 0 and pg.locator('#app .bk-menu-list button:has-text("Download as Excel")').is_visible(), "More: without Tally, no Tally checks; the Excel download is there")
    pg.click('#app .bk-actions button:has-text("Settings")'); pg.wait_for_timeout(400)
    ok(pg.locator("#app .bk-panel").is_visible() and "Bank settings" in pg.inner_text("#app .bk-panel"), "Settings opens the (old) settings panel")
    pg.uncheck('#app .bk-panel label:has-text("Mark sure matches as Ready") input'); pg.wait_for_timeout(200)
    ok(pg.evaluate("CO().bankAuto") is False, "an automation choice is kept")
    pg.select_option('#app .bk-panel select[aria-label="Bank charges"]', "ICICI Bank"); pg.wait_for_timeout(300)
    ok(pg.evaluate("CO().bankLedgerNames.charges") == "ICICI Bank", "the ledger for bank charges chosen")
    # review 18 (02-Oct-2026): the panel's changes are saved with Save at its foot
    ok("Not saved yet" in pg.inner_text('#app [data-confirm-foot="bank:settings"]'), "review 18: not saved until Save")
    pg.click('#app [data-confirm-foot="bank:settings"] [data-cfm="save"]'); pg.wait_for_timeout(300)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ok(pg.locator("#app .bk-panel").count() == 0, "Esc closes it")
    pg.click('#app .bk-actions button:has-text("Settings")'); pg.wait_for_timeout(300)
    pg.mouse.click(5, 450); pg.wait_for_timeout(300)
    ok(pg.locator("#app .bk-panel").count() == 0, "a click outside closes it")
    # rules: paused, moved, deleted (asked first)
    pg.evaluate("""() => { const r = (w) => newRule({name: w, when: {text: [{op: 'has', v: w}], dir: 'out', amtMin: '', amtMax: '', modes: [], acNo: '', account: 'any', from: '', to: ''}, then: {action: 'set', ledger: 'DIPTI VATS', kind: '', vtype: '', tdsNature: '', tdsAtPay: false, splits: [], narr: '', ready: true}});
      clientRules().push(r('ONE'), r('TWO')); bankTabGo('rules'); }"""); pg.wait_for_timeout(300)
    ids = pg.evaluate("clientRules().map(r => r.id)")
    pg.click('tr[data-key="%s"] button:text-is("Pause")' % ids[0]); pg.wait_for_timeout(300)
    ok(pg.evaluate("clientRules()[0].off") is True, "a rule paused")
    pg.click('tr[data-key="%s"] button[title="Move up"]' % ids[1]); pg.wait_for_timeout(300)
    ok(pg.evaluate("clientRules().map(r => r.id)") == [ids[1], ids[0]], "a rule moved up")
    pg.click('tr[data-key="%s"] button:text-is("Delete")' % ids[0]); pg.wait_for_timeout(300)
    pg.click('#confirmBox button[data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("clientRules().map(r => r.id)") == [ids[1]], "a rule deleted, after asking")
    pg.evaluate("bankTabGo('review')"); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + "/react-bank.png")
    # the checks: the balance box closed, a line group shown, the reconciliation's ticks and Excel
    pg.evaluate("""() => { Bridge.on = () => true; Bridge.up = () => true; const st = curStmt(); st.tallyBal = {at: '2026-04-25T10:00:00Z', ledger: 'ICICI Bank', from: '2026-04-01', to: '2026-04-24', tClose: 4500, sClose: 5000, diff: 500, notIn: ['r0', 'r1'], notInEffect: -300, left: [], leftEffect: 0}; render(); }"""); pg.wait_for_timeout(300)
    pg.click('.bk-balbox button:text-is("Show these 2 lines")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("B().focus && B().focus.ids") == ["r0", "r1"] and "Showing 2 lines: not in Tally yet" in app(), "a group of lines shown from the balance check")
    pg.click('.bk-focus button:text-is("Show all lines")'); pg.wait_for_timeout(300)
    ok(pg.evaluate("B().focus") is None, "and all lines again")
    pg.click('.bk-balbox button[aria-label="Close"]'); pg.wait_for_timeout(300)
    ok(pg.locator(".bk-balbox").count() == 0, "the balance box closed")
    pg.evaluate("""() => { window.bankReconExcel = async () => { window.__rx = true; }; S.recon = {sid: curStmt().id, ledger: 'ICICI Bank', company: 'ZZ', from: '2026-04-01', to: '2026-04-24', pairs: 2, at: '2026-04-25T10:00:00Z', unexplained: 0, sClose: 1, tClose: 1, missing: [], extra: [0, 1], differ: [],
      T: [{date: '2026-04-02', type: 'Payment', number: '1', party: 'A', eff: -100}, {date: '2026-04-03', type: 'Receipt', number: '2', party: 'B', eff: 200}], dupOf: [], pick: new Set(), dEff: 0, openDiff: 0}; render(); }"""); pg.wait_for_timeout(300)
    pg.check('input[aria-label="Delete Payment 1"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("Array.from(S.recon.pick)") == [0] and "Delete the 1 ticked from Tally" in app(), "an entry ticked to delete from Tally")
    pg.click('.recon button:text-is("Download Excel")'); pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__rx") is True, "the reconciliation as Excel")
    pg.click('.recon button:text-is("Close")'); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.recon") is None, "and closed")
    # round 15 (B1): a bank line posted by bridge 2.1.8 keeps Tally's confirmation (r.tally.vch, or batchEnd for a batch)
    # and its posted state says it with the company, the time in IST and who pressed Post; an older line as before
    pg.evaluate("""() => { const b = B(); const r5 = b.rows.find(r => r.id === "r5"), r13 = b.rows.find(r => r.id === "r13");
      r5.tally = {guid: "g5", vch: 777, company: "ZZ TEST", at: "2026-10-03T08:35:00Z", by: "Anshul"}; r5.sentAt = "2026-10-03T08:35:10Z"; r5.postedVia = "bridge";
      r13.tally = {guid: "g13", batchEnd: 900, batchN: 50, company: "ZZ TEST", at: "2026-10-03T08:40:00Z", by: "Anshul"}; r13.sentAt = "2026-10-03T08:40:10Z"; r13.postedVia = "bridge";
      b.q = ""; b.filter = "done"; b.grouped = false; render(); }"""); pg.wait_for_timeout(500)
    row = lambda utr: pg.inner_text('#app table.bk-table tbody tr:has-text("%s")' % utr).replace("\n", " ") if pg.locator('#app table.bk-table tbody tr:has-text("%s")' % utr).count() else ""
    t5, t13, t21 = row("UTR100005"), row("UTR100013"), row("UTR100021")
    ok("Posted to Tally: voucher id 777" in t5 and "· ZZ TEST ·" in t5 and "03-Oct-2026 14:05 IST" in t5 and "· by Anshul" in t5 and pg.locator('#app tr:has-text("UTR100005") [data-posted-line]').count() == 1,
       "B1. a bank line with vchId: 'Posted to Tally: voucher id 777 · ZZ TEST · 03-Oct-2026 14:05 IST · by Anshul' (%s)" % t5[-150:])
    ok("Posted to Tally, batch ending Tally id 900" in t13 and "voucher id" not in t13 and "14:10 IST" in t13, "B1. a line of a batch: 'Posted to Tally, batch ending Tally id 900', no inferred id (%s)" % t13[-150:])
    ok("Posted to Tally" not in t21 and "In Tally" in t21 and pg.locator('#app tr:has-text("UTR100021") [data-posted-line]').count() == 0, "B1. an older posted line shows as before (%s)" % t21[-100:])
    # round 17a (owner, 04-Oct-2026): a line FinCom Bridge 2.1.8 posted by Tally's reply (it never reads back) with no id from
    # Tally: posted, never "not found in Tally yet"; round 17: bankMatched (src/js/22) takes postByReply, so it is under Done
    pg.evaluate("""() => { const r5 = B().rows.find(r => r.id === "r5"); window.__r5 = JSON.stringify(r5); r5.tally = {guid: ""}; r5.postByReply = true; r5.postVerified = false; r5.checking = false; r5.state = "sent"; B().filter = "done"; render(); }""")
    pg.wait_for_timeout(400); t5 = row("UTR100005")
    ok(("Posted to Tally (Tally's reply)" in t5 or "In Tally" in t5) and "not found in Tally" not in t5, "17a. a line posted by Tally's reply, no id: under Done as posted ('In Tally'), never 'not found in Tally yet' (%s)" % t5[-120:])
    pg.evaluate("() => { const b = B(), i = b.rows.findIndex(r => r.id === 'r5'); b.rows[i] = JSON.parse(window.__r5); b.filter = 'done'; render(); }"); pg.wait_for_timeout(300)
    # a second statement, and a bank account with no Tally ledger yet
    pg.evaluate("""() => { const b = B(); b.stmts.push({id: "s2", acctId: "a2", bank: "HDFC", acct: "9911", from: "2026-05-01", to: "2026-05-31", opening: 0, closing: 0});
      CO().bankAccounts.push({id: "a2", bank: "HDFC", last4: "9911", ledger: ""}); render(); }""")
    ok(pg.locator('#app select[aria-label="Statement"] option').count() == 2, "two statements: a list to choose from")
    pg.evaluate("B().cur = 's2'; B().rows = []; render()"); pg.wait_for_timeout(300)
    ok("Which Tally ledger is this bank account?" in app(), "a new account: which Tally ledger it is, asked")
    pg.evaluate("B().ledgers.list.push({name: 'HDFC Bank', group: 'Bank Accounts'}); render()"); pg.wait_for_timeout(200)
    pg.select_option('#app select[aria-label="Tally ledger for this bank account"]', "HDFC Bank"); pg.wait_for_timeout(400)
    # review 19 (02-Oct-2026): picked, then confirmed with Confirm; then one line instead of the question
    pg.click("#app [data-bank-ledger-confirm]"); pg.wait_for_timeout(400)
    ok(pg.evaluate("CO().bankAccounts.find(a => a.id === 'a2').ledger") == "HDFC Bank" and "Which Tally ledger" not in app() and "Tally ledger: HDFC Bank" in app(), "chosen and confirmed: kept, and the question goes")
    # no statement yet
    pg.evaluate("B().stmts = []; B().cur = null; render()"); pg.wait_for_timeout(300)
    ok("No bank statement yet" in app() and pg.locator("#bankDrop").count() == 1 and pg.locator("#app .actionbar").count() == 0, "no statement: the upload box, and no bar")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
