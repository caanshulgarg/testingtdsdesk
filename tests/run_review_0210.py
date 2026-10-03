"""python3 run_review_0210.py - the review of 02-Oct-2026, items 5-19, on Testing AAD's books: the trial balance with
ledger names that carry line breaks, one set of receivables / payables / advances, the audit's year, bank lines not
matched to Tally, TDS and GST paid from the books, due dates from today, TDS ledgers kept as assets or expenses, the cloud
ledger list for Bank and Sales, the setup checklist, bank tabs at the top, Remove this client in More, the labels, one
build date, the firm's name, the per-user bridge text and the PowerShell command, and the old-browser message.
Uses tests/data/books-cache.json and gst-cache.json (client data, not in git).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_review_0210.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8202), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books, gst = gstfix.load()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

with sync_playwright() as p:
    br = p.chromium.launch()
    # 19. an old browser gets a message, not a blank page
    ctx = br.new_context(); ctx.add_init_script("delete window.Proxy;")
    pg = ctx.new_page(); pg.goto("http://localhost:8202/"); pg.wait_for_timeout(1500)
    t = pg.inner_text("body")
    ok("This browser isn't supported" in t and "Microsoft Edge" in t and "Invoke-WebRequest" in t and "FinComBridge-Setup-2.0.0.exe" in t, "19. an old browser: 'This browser isn't supported', Edge or Chrome, and the PowerShell command")
    ctx.close()

    pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8202/"); pg.wait_for_timeout(2500)
    ok("This browser isn't supported" not in pg.inner_text("body"), "19. a modern browser opens FinCom as before")
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    cid = pg.evaluate(gstfix.SETUP, [books, gst]); pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render()"); pg.wait_for_timeout(500)
    E = lambda js, *a: pg.evaluate(js, *a)

    # 5. a ledger whose master name ends in line breaks meets its entries; a trial balance that does not total zero is refused
    tb = E("""async () => { TCloud.rpcAll = async () => [{ledger: 'MCS Project Pvt Ltd\\r\\n', parent: 'Master Cad', closing: 6000}, {ledger: 'MCS Project Pvt Ltd', parent: '', closing: -37800},
        {ledger: 'RAKVIK TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;', parent: 'Rakesh Kumar', closing: -17550}, {ledger: 'RAKVIK TECHNOLOGIES PRIVATE LIMITED', parent: '', closing: -400}, {ledger: 'Capital', parent: 'Capital Account', closing: 49750}];
      TCloud.book = () => ({company: 'X'}); TCloud.age = () => ''; const r = await TCloud.tb(S.coId, '20260331');
      return {rows: r.rows.map(x => [x.l, x.bal, x.sub]), nm: r.noMaster.length, off: r.off, refused: r.refused}; }""")
    ok(len(tb["rows"]) == 3 and ["MCS Project Pvt Ltd", 31800, "Master Cad"] in tb["rows"] and ["RAKVIK TECHNOLOGIES PRIVATE LIMITED", 17950, "Rakesh Kumar"] in tb["rows"] and tb["nm"] == 0 and not tb["refused"],
       "5. MCS and RAKVIK meet their masters: one row each, with group and opening (%s)" % tb["rows"][:2])
    bad = E("(() => { const r = LK.tbShape({kind: 'tb', src: 'cloud', rows: [{l: 'A', top: 'X', sub: 'G', bal: 400}, {l: 'B', top: 'X', sub: '', bal: -38600, noMaster: true}, {l: 'C', top: 'Y', sub: 'G', bal: 0.0}]}); return [r.off, r.refused, r.noMaster.length]; })()")
    ok(bad[1] is True and bad[2] == 1, "5. a trial balance out by %s is refused, the ledger with no master named" % bad[0])
    E("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'lookup'; S.lk = {cid: S.coId, open: {}, kind: 'tb', asOn: '20260331', res: LK.tbShape({kind: 'tb', src: 'cloud', asOn: '20260331', rows: [{l: 'A', top: 'X', sub: 'G', bal: 400}, {l: 'B', top: 'X', sub: '', bal: -38600, noMaster: true}]})}; render(); }")
    pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-tb-refused]").count() == 1 and pg.locator("#app [data-tb-nomaster]").count() == 1, "5. Look up shows 'Not shown: this trial balance does not total zero', with the ledgers missing a master and Read the masters again")

    # 6. one set of figures: Parties.position = MIS = Reports = Letters
    f = E("""(() => { const P = Parties.position('20260331'), r = MIS.ageing('20260331', 'r'), q = MIS.ageing('20260331', 'p');
      return {P: [P.owed, P.custAdv, P.youOwe, P.supAdv], mis: [r.sum.owe, r.sum.advance, q.sum.owe, q.sum.advance]}; })()""")
    ok(f["P"] == f["mis"], "6. receivables, customer advances, payables and supplier advances: the same in Parties.position and MIS (%s)" % f["P"])
    ok(f["P"][2] == 195964.36 and f["P"][3] == 2984981.81, "6. you owe 1,95,964.36 and supplier advances 29,84,981.81, as the books (31-Mar-2026)")
    au = E("""(() => { const run = Audit.run('20250401', '20260331', 'test'); const g = k => (run.findings.find(x => x.id === 'balances:' + k) || {}).amount; return [g('drCr'), g('crDr')]; })()""")
    ok(au == [f["P"][1], f["P"][3]], "6. the audit's customer and supplier advances are the same figures (%s)" % au)

    # 7. the audit runs on the selected year (the last full year), and an old run that no longer fits the books says so
    dr = E("Audit.defaultRange(S.books)")
    ok(dr == {"from": "20250401", "to": "20260331"}, "7. the audit's default period: the last full year, FY 2025-26 (%s)" % dr)
    st = E("(() => { S.books.audit = {st: {}, last: {at: '2026-10-01T00:00:00Z', from: '20260401', to: '20260930', vouchers: 1231, findings: []}}; return Audit.stale(S.books.audit.last); })()")
    ok(st == {"was": 1231, "now": 0}, "7. a run kept for Apr-Sep 2026 on 1,231 entries is out of date: the books hold %s there" % (st or {}).get("now"))
    E("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'audit'; render(); }"); pg.wait_for_timeout(700)
    pg.wait_for_timeout(1500)
    rerun = E("[(S.books.audit.last || {}).vouchers, (S.books.audit.last || {}).from, !!Audit.stale(S.books.audit.last)]")
    ok(pg.locator("#app [data-audit-stale]").count() == 0 and rerun == [0, "20260401", False], "7. the audit page works the stale run out again by itself for its period, with no message to run again (%s)" % rerun)
    ok(pg.locator("#app select[aria-label='Audit year']").count() == 1, "7. the audit has a year to choose")

    # 9, 10. TDS and GST paid, from the books; book figures not called 3B
    c = E("(() => { const t = MIS.compliance('20250401', '20260331'); const s = (a, k) => Math.round(a.reduce((x, y) => x + (y[k] || 0), 0) * 100) / 100; return [s(t.tds, 'ded'), s(t.tds, 'dep'), s(t.gst, 'pay')]; })()")
    ok(c == [165637.82, 177761, 1360166], "9, 10. TDS deducted 1,65,637.82 and paid 1,77,761; GST paid in cash 13,60,166 (%s)" % c)

    # 11. due dates from today, by the filing type
    d = E("MIS.dues('20261002')")
    labels = [x[1] for x in d]
    ok(["20261013", "GSTR-1 for Q2 2026-27"] in d and ["20261024", "GSTR-3B and tax for Q2 2026-27"] in d and ["20261031", "TDS and TCS returns for Q2 2026-27"] in d and d[0][0] >= "20261002",
       "11. from 02-Oct-2026: GSTR-1 on the 13th and 3B on the 24th after the quarter, TDS returns 31-Oct (%s)" % labels[:4])
    ok(["20270430", "TDS and TCS deposit for Mar-2027"] in E("MIS.dues('20270410')"), "11. TDS for March is due on 30 April")
    ok(any(x[1].startswith("IFF for") for x in E("MIS.dues('20261105')")), "11. a quarterly filer's IFF in the quarter's first two months")

    # 12. TDS-named assets and expenses are not TDS payable
    g = E("""(() => { const i = {'TDS Magic Seva': {group: 'Loans & Advances (Asset)', taxType: 'Others'}, 'TDS Pentagon': {group: 'Loans & Advances (Asset)', taxType: 'Others'}, 'Intrest On TDS': {group: 'Indirect Expenses', taxType: 'Others'}};
      return Object.keys(i).map(n => LedMaster.propose(n, i[n], null, ['09']).what); })()""")
    ok(g == ["tds_receivable", "tds_receivable", "tds_interest"], "12. TDS Magic Seva and TDS Pentagon: TDS receivable; Intrest On TDS: interest, not TDS payable (%s)" % g)
    # round 4 (03-Oct-2026), item 28 on Testing AAD: the Loans (Liability) sub-groups "Anshul Garg" and "Ankit Garg" are not a
    # partner's by the rule (the only Capital Account ledger is "Capital", which names no one; neither sub-group says
    # Partner), so their ledgers stay on Loans; "Partner's Loan A/c" is a ledger directly under Loans (Liability), not a
    # sub-group, so it stays too. Nothing is flagged by a partner match
    h = E("""['Anshul Garg Loan', 'Anshul Garg Bajaj Loan A/c', 'Salary Ankit Garg', 'Ankit Garg Imprest', "Partner's Loan A/c", 'Yottacto'].map(l => MIS.flowHead(l).join('|'))""")
    ok(h == ["fin|Loans"] * 6, "28. Anshul Garg's and Ankit Garg's ledgers, Partner's Loan A/c and Yottacto all on Loans (%s)" % h)
    ok(E("MIS.flowNotes(CO()).filter(n => /partner/i.test(n.why)).length") == 0 and E("MIS.flowNotes(CO()).some(n => n.ledger === 'Salary Payable' && n.line === 'Salaries and staff')"), "28, 29. no partner note; Salary Payable's name note is there")

    # 8, 13, 15. Bank: cloud ledgers, In Tally only when matched, tabs at the top
    E("""() => { const c = CO(); c.bankAccounts = [{id: 'a1', bank: 'HDFC', acct: '1234', ledger: ''}];
      TCloud.on = () => true; TCloud.status = async () => {}; TCloud.has = () => true; TCloud.book = () => ({book: 'b1', company: 'GARG SHEKHAR & COMPANY'});
      TCloud.restAll = async (path) => /tally_ledgers/.test(path) ? [{name: 'HDFC BANK\\r\\n', parent: 'Bank Accounts'}, {name: 'HDFC BANK', parent: 'Bank Accounts'}, {name: 'Rent', parent: 'Indirect Expenses'}] : [];
      S.tab = 'bank'; S.bank = null; render(); }""")
    pg.wait_for_timeout(2500)
    led = E("(B() && B().ledgers.list || []).map(l => l.name)")
    ok(led == ["HDFC BANK", "Rent"], "13. Bank takes the ledger list from the cloud copy by itself, names as the entries use them, no import asked (%s)" % led)
    E("""() => { const b = B(); const rows = Array.from({length: 6}, (_, i) => ({id: 'r' + i, fp: 'f' + i, date: '2026-04-0' + (i + 1), debit: 100, credit: 0, bal: 0, narr: 'NEFT ' + i, dec: {}, ledger: 'Rent', state: i < 4 ? 'sent' : 'ready', balOk: true, why: [], sentAt: '2026-04-10'}));
      rows[0].tally = {guid: 'g1', number: '12'}; b.stmts = [{id: 's1', acctId: 'a1', bank: 'HDFC', acct: '1234', from: '2026-04-01', to: '2026-09-30', n: 6}]; b.cur = 's1'; b.rows = rows; b.filter = 'done'; render(); }""")
    pg.wait_for_timeout(800)
    tc = E("tabCounts(B().rows)")
    ok(tc["done"] == 1 and tc["ready"] == 5 and tc["post"] == 2 and tc["filed"] == 3, "8. only the line matched to a Tally voucher is In Tally; 3 sent in a file stay under Post to Tally, marked (%s)" % {k: tc[k] for k in ("done", "ready", "post", "filed")})
    y = E("(() => { const t = document.querySelector('#app .bk-tabs'); return t ? Math.round(t.getBoundingClientRect().top) : 9999; })()")
    ok(y < 260, "15. Bank step tabs at the top of the page (%d px from the top)" % y)

    # 14. setup checklist from what is done (cloud copy, opening balances, a bank account with its ledger)
    st = E("ONB.steps(CO()).map(s => [s.id, s.done])")
    ok(dict(st).get("opening") is True and dict(st).get("books") is True and dict(st).get("bridge") is True and dict(st).get("bank") is True,
       "14. checklist: books and opening balances read, bridge set up (cloud copy), bank done once its account has the ledger (HDFC BANK, linked from Tally) (%s)" % st)

    # 15. Remove this client: in More, behind the client's name
    E("() => { S.tab = 'settings'; render(); }"); pg.wait_for_timeout(700)
    ok(pg.locator("#app [data-more='client']").count() == 1 and pg.locator("#app .setnav button:has-text('Remove this client')").count() == 0, "15. Remove this client is in More, not in the setup sections")
    E("document.querySelector('#app [data-more=\"client\"]').open = true"); pg.click("#app [data-more='client'] button:has-text('Remove this client')"); pg.wait_for_timeout(400)
    ok(pg.locator("#cbxName").count() == 1, "15. it asks for the client's name"); pg.click('[data-cbx="no"]'); pg.wait_for_timeout(200)

    # 16. labels, and one build date
    E("() => { S.tab = 'books'; S.booksTab = 'reports'; S.rptFy = '2025'; render(); }"); pg.wait_for_timeout(1500)
    ok("for the year 2025-26" in pg.inner_text("#app") and "the year so far" not in pg.inner_text("#app .rpt-overview"), "16. a closed year says 'for the year', not 'the year so far'")
    ok(E("(() => { const r = MIS.run('20250401', '20260331'); return r.dpo; })()") is None, "16. no 'days of purchases' for a client with no purchases of goods")
    sv = pg.inner_text("#side [data-side-date]")
    ok("Build of" not in sv and sv.count("-2026") == 2, "16. sidebar: today and one build date (%s)" % sv.replace("\n", " / "))

    # 17. the firm's name from the firm account; never asked when it is there; never emptied by a sync
    E("() => { S.account = {firm: {name: 'Garg Shekhar& Company'}, me: {role: 'owner'}}; Cloud.on = () => true; S.firm.firmName = ''; }")
    ok(E("firmSetupDue()") is False, "17. the firm's name is not asked for when the firm account has one")
    m = E("(() => { S.firm = {firmName: 'GSC', firmAddress: '1 Road', firmLogo: 'data:x', rules: {a: 1}}; const f = firmMerge(S.firm, {firmName: '', firmAddress: '', firmLogo: '', rules: {}}); return [f.firmName, f.firmAddress, f.firmLogo, JSON.stringify(f.rules)]; })()")
    ok(m == ["Garg Shekhar& Company", "1 Road", "data:x", '{"a":1}'], "17. an empty firm record from a sync keeps the address, logo and rules; the name is the firm account's (%s)" % m)

    # 18, 19. the Tally page: per-user install, the direct link and the PowerShell command
    # (a build ships the bridge only with FINCOM_SHIP_BRIDGE=1: its update list is served here)
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.0", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.0.exe", "sha256": "ab" * 32}})))
    E("() => { navHome('tally'); }"); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("without an administrator" in t and pg.locator("#app [data-bridge-link]").count() == 1 and "Invoke-WebRequest" in pg.inner_text("#app [data-bridge-ps]") and "Tls12" in pg.inner_text("#app [data-bridge-ps]"),
       "18, 19. the Tally page: installs without an administrator, the direct link and the PowerShell command")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
