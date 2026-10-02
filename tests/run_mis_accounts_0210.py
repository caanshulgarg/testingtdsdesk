"""python3 run_mis_accounts_0210.py - the review of 02-Oct-2026, MIS and Accounts, on Testing AAD's books (FY 2025-26):
receivables against the ledger balances (a Difference column and a line at the top), GST by month without Optional or
cancelled entries and with worked out / paid under their own headings, ratios never negative, cash flow receipts on their
own lines with opening and closing cash, the Accounts format from the entity type, and the Mapping tab in pages.
Uses tests/data/books-cache.json and gst-cache.json (client data, not in git).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_mis_accounts_0210.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8213), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books, gst = gstfix.load()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the server's tally_gst_summary for May-2025 (read from staging, leaving Optional and cancelled entries out): output tax
SERVER_MAY_OUT = 272033.16
OPTIONAL_LYALLPUR_TAX = 468000          # three Optional invoices of 06-May-2025: 1,44,000 + 1,44,000 + 1,80,000

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8213/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate(gstfix.SETUP, [books, gst]); pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render()"); pg.wait_for_timeout(500)
    E = lambda js, *a: pg.evaluate(js, *a)
    E("() => { MIS.run('20250401', '20260331'); }")
    app = lambda: pg.inner_text("#app")

    # 1. receivables: the headline is the ledger balances; the ageing splits it; a Difference column and a line at the top
    a = E("""(() => { const r = S.books.mis.last, P = Parties.position('20260331'), f = n => r.recv.rows.find(p => p.party === n) || {};
      return {owed: r.owed.r, P: P.owed, owe: r.recv.sum.owe, rows: ['AAR ESS EXIM PRIVATE LIMITED', 'Salesify Marketing LLP', 'LYALLPUR UNIFORMS PRIVATE LIMITED'].map(n => [f(n).total, f(n).tally, f(n).diff]),
        differ: r.recv.sum.differ.map(x => x.party)}; })()""")
    ok(a["owed"] == 11197404.38 and a["P"] == a["owed"] and a["owe"] == a["owed"], "1. owed to you 1,11,97,404.38 at 31-Mar-2026: the ledger balances (Parties.position), and the ageing splits the same figure")
    ok(a["rows"] == [[639340, 684421.54, 45081.54], [568400, 749600, 181200], [391000, 526891.92, 135891.92]], "1. AAR ESS EXIM 6,39,340 vs 6,84,421.54, Salesify 5,68,400 vs 7,49,600, Lyallpur 3,91,000 vs 5,26,891.92: differences 45,081.54, 1,81,200, 1,35,891.92 (%s)" % a["rows"])
    ok(all(n in a["differ"] for n in ["AAR ESS EXIM PRIVATE LIMITED", "Salesify Marketing LLP", "LYALLPUR UNIFORMS PRIVATE LIMITED"]), "1. the three are among the %d parties whose ledger and bills differ" % len(a["differ"]))
    E("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'mis'; S.misTab = 'recv'; S.misQ = ''; S.misF = ''; render(); }"); pg.wait_for_timeout(900)
    heads = [h.lower() for h in pg.locator("#misAge thead th").evaluate_all("hs => hs.map(h => h.textContent)")]
    ok("difference" in heads and "ledger balance" in heads, "1. Receivables has Ledger balance and Difference columns")
    ok(pg.locator("#app [data-mis-differ]").count() == 1 and "do not agree" in pg.inner_text("#app [data-mis-differ]"), "1. a line at the top: the ledger balances that do not agree with the bills")
    ok("1,11,97,404.38" in pg.inner_text("#app [data-mis-owed]") and "not bill-wise" in pg.inner_text("#app [data-mis-owed]"), "1. owed to you 1,11,97,404.38 (ledger balances) at the top, with the part not bill-wise")
    row = pg.locator('#misAge tr[data-key="AAR ESS EXIM PRIVATE LIMITED"] td[data-diff]').inner_text()
    ok(row == "45,081.54", "1. AAR ESS EXIM's Difference: 45,081.54 (%s)" % row)
    E("() => { S.misTab = 'summary'; render(); }"); pg.wait_for_timeout(500)
    ok("1,11,97,404.38" in pg.inner_text("#app .dash-tiles >> nth=1"), "1. the Summary's Owed to you tile: 1,11,97,404.38")

    # 2. GST by month: no Optional or cancelled entries, the server's figure
    g = E("""(() => { const r = S.books.mis.last, may = r.comp.gst.find(x => x.ym === '202505');
      const withOpt = Math.round(S.books.vouchers.filter(v => v.date.startsWith('202505') && !v.cancel && v.ent.some(e => Audit.under(e.l, /^sales accounts$/i))).reduce((a, v) => a + v.ent.filter(e => /^OUTPUT (CGST|SGST|IGST)/.test(e.l)).reduce((s, e) => s + e.a, 0), 0) * 100) / 100;
      return {out: may.out, withOpt}; })()""")
    ok(g["out"] == SERVER_MAY_OUT, "2. May-2025 output tax %s = the server's tally_gst_summary 2,72,033.16 (not 7,40,033)" % g["out"])
    ok(abs(g["withOpt"] - g["out"] - OPTIONAL_LYALLPUR_TAX) < 0.01, "2. the three Optional Lyallpur invoices (tax 4,68,000) are what is left out")
    cx = E("""(() => { const v = S.books.vouchers.find(v => v.date.startsWith('202505') && !v.opt && !v.cancel && Books.isSale(v));
      const c = JSON.parse(JSON.stringify(v)); c.cancel = true; c.no = c.no + '-X'; S.books.vouchers.push(c);
      const out = MIS.compliance('20250501', '20250531').gst[0].out; S.books.vouchers.pop(); return out; })()""")
    ok(cx == SERVER_MAY_OUT, "2. a cancelled sale is left out of the month's output tax (%s)" % cx)
    rp = E("(() => { const g = RPT.data().comp.gst.find(x => x.ym === '202505'); return g && g.out; })()") if E("typeof RPT === 'object' && !!RPT.range && !!RPT.range()") else SERVER_MAY_OUT
    ok(rp == SERVER_MAY_OUT, "2. Reports shows the same May-2025 output tax (%s)" % rp)

    # 3. worked out to pay and paid from the bank, each under its own heading
    c = E("S.books.mis.last.comp.gst.map(x => [x.ym, x.due, x.pay])")
    pays = [x[2] for x in c]
    ok(pays == [200000, 160400, 0, 0, 4600, 170000, 367380, 0, 0, 0, 457786, 0] and round(sum(pays), 2) == 1360166, "3. paid from the bank: Apr 2,00,000, May 1,60,400, ... total 13,60,166 (%s)" % pays)
    E("() => { S.misTab = 'comp'; render(); }"); pg.wait_for_timeout(600)
    t = pg.locator("#app table >> nth=0")
    hd = t.locator("thead th").evaluate_all("hs => hs.map(h => h.textContent)")
    may = t.locator("tbody tr >> nth=1").locator("td").all_inner_texts()
    ok(hd[5] == "Worked out to pay" and hd[6] == "Paid from the bank" and may[6].replace(".00", "") == "1,60,400", "3. the GST table: May-2025 paid 1,60,400 under Paid from the bank (%s)" % may)
    due_may = E("INR.format(S.books.mis.last.comp.gst[1].due)")
    ok(may[5] == due_may and may[5] != may[6], "3. and the 3B working's cash payable %s under Worked out to pay" % may[5])
    # review of 02-Oct-2026: reverse charge was counted twice in "worked out to pay" (Apr-2025: 3,06,818.25, 4,860 =
    # 2 x 2,430 over output less credit); now each row adds up: output - credit + reverse charge + credit carried
    apr = E("S.books.mis.last.comp.gst[0]")
    rows_add = E("S.books.mis.last.comp.gst.every(x => Math.abs(x.out - x.itc + x.rcm + x.carry - x.due) < 0.01)")
    ok(apr["due"] == 304388.25 and apr["rcm"] == 2430 and apr["carry"] == 0 and rows_add and "reverse charge" in hd[3].lower(),
       "3. Apr-2025: 3,09,522.81 - 7,564.56 + reverse charge 2,430 = 3,04,388.25 worked out to pay; every month adds up (%s)" % apr)
    # the cash flow's GST line by the same rule as "paid from the bank" (13,60,166), the 10,080 of input IGST on its own
    cf = E("(() => { const c = MIS.cashActual('20250401', '20260331'), f = l => (c.rows.find(x => x.lab === l) || {t: null}).t; return [f('GST'), f('Input GST paid with bills'), Object.values((c.rows.find(x => x.lab === 'Expenses paid') || {m: {}}).m).some(v => v > 0), f('Expenses refunded or recovered')]; })()")
    ok(cf[0] == -1360166 and cf[1] == -10080 and not cf[2] and cf[3] == 15326.52, "5. cash flow: GST paid 13,60,166 as Compliance, input IGST 10,080 apart, no month of Expenses paid positive, refunds 15,326.52 on their own line (%s)" % cf)

    # 7, 15 (review of 02-Oct-2026): each fixed asset once, in its note. 7 was "an expense ledger in credit is other income,
    # flagged" (other expenses 26,80,192.03 with Written Off Expenses 32,23,694.87 under other income); the owner's rule
    # (MIS.plRule) replaced it: a credit is set off in its own head, and only a head that ends in credit sends the rest to
    # other income, the head then nil. The owner's figures for FY 2025-26:
    fsd = E("""(() => { const d = FS.build('2025'), h = FS.html(d); return {pl: d.pl, inc: d.inc, exp: d.exp, pbt: d.pbt, sum: d.plSum, set: d.plSet,
      wo: (d.plDet.exp || []).find(x => x[0] === 'Written Off Expenses'), adv: (d.plDet.emp || []).find(x => x[0] === 'Advance'), woOth: (d.plDet.oth || []).some(x => x[0] === 'Written Off Expenses'),
      note: /data-fs-excess="exp"><td class="note">Excess credit in Other expenses<\/td><td class="n">5,43,549.56</.test(h),
      crm: (h.match(/CRM Software/g) || []).length, tally: (h.match(/Tally Software/g) || []).length, comp: (h.match(/>Computer</g) || []).length}; })()""")
    P = fsd["pl"]
    ok(P["emp"] == 7341847.08 and fsd["adv"] == ["Advance", -5000, "expense ledger with a credit balance"], "7. employee benefits 73,41,847.08: Advance -5,000 set off inside the head, flagged (%s, %s)" % (P["emp"], fsd["adv"]))
    ok(P["fin"] == 178965.39, "7. finance costs 1,78,965.39 (%s)" % P["fin"])
    ok(P["exp"] == 0 and fsd["sum"]["exp"]["dr"] == 2680192.03 and fsd["sum"]["exp"]["cr"] == 3223741.59 and fsd["sum"]["exp"]["moved"] == 543549.56 and fsd["wo"] == ["Written Off Expenses", -3223694.87, "expense ledger with a credit balance"] and not fsd["woOth"],
       "7. other expenses nil: 26,80,192.03 less credits 32,23,741.59 (Written Off Expenses -32,23,694.87 flagged, in the head) (%s)" % fsd["sum"].get("exp"))
    ok(P["oth"] == 543549.56 and fsd["set"]["oth"] == [["Excess credit in Other expenses", 543549.56, "exp"]] and fsd["note"], "7. other income 5,43,549.56, its note saying it is the excess credit in other expenses (%s)" % fsd["set"].get("oth"))
    ok(fsd["inc"] == 18835005.76 and fsd["exp"] == 7520812.47 and fsd["pbt"] == 11314193.29, "7. total income 1,88,35,005.76, total expenses 75,20,812.47, profit 1,13,14,193.29 (%s, %s, %s)" % (fsd["inc"], fsd["exp"], fsd["pbt"]))
    ok(fsd["crm"] == 1 and fsd["tally"] == 1 and fsd["comp"] == 1, "15. CRM Software, Tally Software and Computer each once in the notes (%s)" % fsd)
    misx = E("""(() => { const r = S.books.mis.last, H = r.pl.heads, f = (k, l) => ((H[k] || {led: []}).led.find(x => x.l === l) || {}), C = r.p2.cc;
      return {t: Object.fromEntries(['emp', 'fin', 'exp', 'dir', 'oth'].map(k => [k, (H[k] || {t: 0}).t])), inc: r.pl.income.t, pbt: r.pl.pbt.t, wo: [f('exp', 'Written Off Expenses').t, f('exp', 'Written Off Expenses').flag], woOth: !!f('oth', 'Written Off Expenses').l,
        ex: f('oth', 'Excess credit in Other expenses').t, cc: [Math.round((C.rows.reduce((a, z) => a + z.inc, 0) + C.un.inc) * 100) / 100, Math.round((C.rows.reduce((a, z) => a + z.exp, 0) + C.un.exp) * 100) / 100]}; })()""")
    ok(misx["t"] == {"emp": 7341847.08, "fin": 178965.39, "exp": 0, "dir": 0, "oth": 543549.56} and misx["inc"] == 18835005.76 and misx["pbt"] == 11314193.29, "7. MIS the same: employee 73,41,847.08, finance 1,78,965.39, other and direct expenses nil, other income 5,43,549.56 (%s)" % misx["t"])
    ok(misx["wo"] == [-3223694.87, "expense ledger with a credit balance"] and not misx["woOth"] and misx["ex"] == 543549.56, "7. MIS: Written Off Expenses flagged in other expenses, the excess 5,43,549.56 in other income (%s)" % misx)
    ok(misx["cc"] == [18835005.76, 7520812.47], "7. cost centres, allocated or not, agree with the profit and loss: income 1,88,35,005.76, expenses 75,20,812.47 (%s)" % misx["cc"])
    # the forecast: March's TDS 13,681.88 is due on 30 April (week 5), not 7 April (week 1)
    fc = E("(() => { const W = S.books.mis.last.p2.fc.weeks; return [W[0].out, W[4].out, W.flatMap(w => w.items.filter(z => z.what === 'TDS').map(z => [z.d, z.amt]))[0]]; })()")
    ok(fc == [21307.16, 16041.88, ["20260430", -13681.88]], "7. forecast: week 1 out 21,307.16 (was 34,989.04), March's TDS 13,681.88 on 30 April in week 5 (%s)" % fc)

    # 4. ratios: never negative; not meaningful where they cannot be worked out; no days of purchases without purchases
    rl = E("Object.fromEntries(S.books.mis.last.p2.ratios.list.map(x => [x[0], x[1]]))")
    cr, qr = rl.get("Current ratio"), rl.get("Quick ratio")
    ok(isinstance(cr, (int, float)) and cr > 0 and isinstance(qr, (int, float)) and qr > 0, "4. current ratio %s and quick ratio %s times: positive, not -11.17" % (cr, qr))
    ok(rl.get("Working capital", 0) > 0, "4. working capital %s, positive, with the ratio" % rl.get("Working capital"))
    ok("Days of purchases you owe" not in rl, "4. no 'days of purchases' for a client with no purchases")
    nm = E("""(() => { const r = S.books.mis.last; const L = MIS.ratios(r, {'HDFC BANK': -5000, 'OUTPUT CGST': -800}).list; return [L.find(x => x[0] === 'Current ratio')[1], L.find(x => x[0] === 'Quick ratio')[1]]; })()""")
    ok(nm == ["not meaningful", "not meaningful"], "4. with no current liabilities (a tax ledger in debit is an asset): 'not meaningful', not a ratio (%s)" % nm)
    E("() => { S.misTab = 'ratios'; render(); }"); pg.wait_for_timeout(500)
    ok("-11." not in app() and "Days of purchases" not in app(), "4. the Ratios tab: no negative current ratio, no days of purchases")

    # 5. cash flow: receipts on their own lines; opening + net = closing
    cf = E("""(() => { const C = S.books.mis.last.p2.cash, f = l => C.rows.find(x => x.lab === l) || {m: {}};
      return {refund: f('Refunds and receipts from suppliers').m['202602'], tax: f('Tax refunds').t, posPaid: C.rows.filter(x => x.lab === 'Paid to suppliers' || x.lab === 'Income tax').some(x => Object.values(x.m).some(v => v > 0)),
        net: f('Refunds and receipts from suppliers').m['202602'] + (f('Paid to suppliers').m['202602'] || 0), open: C.open, close: C.close, sum: C.net, ties: C.ties}; })()""")
    ok(round(cf["net"], 2) == 4850089 and cf["refund"] > 0, "5. Feb-2026: received from suppliers %s on Refunds and receipts from suppliers (with what was paid: the +48,50,089 shown before)" % cf["refund"])
    ok(cf["tax"] == 928480, "5. Tax refunds 9,28,480 on its own line")
    ok(not cf["posPaid"], "5. no receipt left on Paid to suppliers or Income tax")
    ok(cf["open"] is not None and round(cf["open"] + cf["sum"], 2) == cf["close"] and cf["ties"], "5. cash and bank: opening %s + net %s = closing %s" % (cf["open"], cf["sum"], cf["close"]))
    E("() => { S.misTab = 'cash'; render(); }"); pg.wait_for_timeout(600)
    ok(pg.locator('#app tr[data-cf="open"]').count() == 1 and pg.locator('#app tr[data-cf="close"]').count() == 1 and pg.locator('#app [data-cf-ties="yes"]').count() == 1, "5. the Cash flow tab: opening and closing cash and bank, and the check that they tie")
    ok("Refunds and receipts from suppliers" in app() and "Tax refunds" in app(), "5. and the two lines")

    # 6. Accounts: the format from the entity type (the PAN's fourth letter), changeable in Client setup
    ok(E("[CO().pan, FS.entityOf().code, FS.cfg(S.books).kind]") == ["AANFG3202D", "F", "nc"], "6. PAN AANFG3202D: a firm, so the ICAI non-corporate format")
    ok(E("['C', 'F', 'P', 'H', 'A', 'B', 'T', 'L', 'J', 'G'].map(k => FS.entityOf({pan: 'AAA' + k + 'A1234A'}).code).join('')") == "CFPHABTLJG", "6. each fourth letter: F firm, C company, P individual, H HUF, A AOP, B BOI, T trust, L local authority, J juridical person, G government")
    E("() => { S.booksTab = 'fs'; S.fsTab = 'st'; S.fsRun = null; S.fsFy = '2025'; render(); }"); pg.wait_for_timeout(4000)
    ok("Non-Corporate" in app() and pg.locator('select[aria-label="Format"]').input_value() == "nc" and pg.get_attribute("#app [data-fs-entity]", "data-fs-entity") == "F", "6. Accounts opens in the ICAI non-corporate format, saying the entity type is a firm (from the PAN)")
    E("toggleSetup()"); pg.wait_for_timeout(600)
    ok(pg.locator('select[aria-label="Entity type"]').count() == 1 and "From the PAN: Firm or LLP" in pg.locator('select[aria-label="Entity type"]').inner_text(), "6. Client setup: Entity type, from the PAN by default")
    pg.select_option('select[aria-label="Entity type"]', "C"); pg.wait_for_timeout(400)
    ok(E("[CO().entity, FS.cfg(S.books).kind]") == ["C", "co"], "6. changed to a company: Schedule III")
    pg.select_option('select[aria-label="Entity type"]', ""); pg.wait_for_timeout(400)
    ok(E("[CO().entity, FS.cfg(S.books).kind]") == ["", "nc"], "6. back to the PAN: the non-corporate format")

    # 7. the Mapping tab, a page at a time
    E("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'fs'; S.fsTab = 'map'; S.fsQ = ''; S.fsPage = 0; render(); }"); pg.wait_for_timeout(2500)
    n = pg.locator("#app tr[data-key]").count()
    total = int(pg.inner_text("#app .revfilter .note").split(" ")[0])
    ok(total > 300 and n == 50 and pg.locator("#app [data-fs-pager]").count() >= 1, "7. Mapping: %d ledgers, %d drawn at a time, with pages" % (total, n))
    first = pg.locator("#app tr[data-key]").first.get_attribute("data-key")
    pg.locator("#app [data-fs-pager] button:text-is('Next')").first.click(); pg.wait_for_timeout(600)
    ok(pg.locator("#app tr[data-key]").first.get_attribute("data-key") != first and "page 2 of" in app(), "7. Next: the second page")
    pg.fill("#fsq", "Salesify"); pg.wait_for_timeout(800)
    keys = pg.locator("#app tr[data-key]").evaluate_all("rs => rs.map(r => r.dataset.key)")
    ok(keys and all("salesify" in k.lower() for k in keys), "7. a search shows the ledgers it finds, from the first page (%s)" % keys)

    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
