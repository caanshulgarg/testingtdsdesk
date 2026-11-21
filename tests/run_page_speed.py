"""python3 run_page_speed.py - next-fix-pagespeed (21-Nov-2026; the owner: "app and pages should be fast"). Measured on made-up
books of 50 clients, the large one with 20,000 bank lines, 20,000 ledgers and 20,000 entries (the scripts and figures are
in the branch's report). Each part below is one slowdown found there, held to its fix, with the answer the same as before:

  A. Ledgers.books (src/js/58) on books with no ledger masters' details (ledInfo; books from the cloud copy or a day book
     with only the groups): the cache key's count was made again at every ask (a new {} each time never matched the one
     kept), so opening a client with 20,000 ledgers counted 20,000 names for each of its ~20,000 ledger look-ups (232 s of
     one task). Now counted once a task, as with ledInfo: the same list, a name added in place seen at the next task.

  I. Bank on a client switch (FINCOM-APP-STAGING-Y: 2.3 s, one frame): a receipt was matched to the open sales invoices by
     trying every invoice, then, with no one invoice of its amount, every two invoices of each customer (a customer of 1,200
     invoices: 720,000 sums for each receipt). Now the invoices are put by amount once a run (app/src/lib/salesMatch.js, in
     its place in the React app): the same invoices found and chosen for every line (held here to the earlier search, kept
     in this test word for word), the page opened quickly.

Made-up books only (seeded here; no client's name or figure). Run on the React build: app/dist-test, or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("PS_PORT") or 8615)
ONLY = os.environ.get("PS_ONLY", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 20); go(); })"
LT = "() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({type: 'longtask', buffered: true}); }"
# the main thread's long tasks from t0 on: their total, the longest
LTS = "(t0) => { const l = window.__lt.filter((x) => x[0] >= t0 - 5); return [Math.round(l.reduce((a, x) => a + x[1], 0)), Math.round(l.reduce((a, x) => Math.max(a, x[1]), 0))]; }"

# a client with books of nL ledgers (their groups only: no ledInfo) and a few entries
BOOKS = """async ([nL, name]) => {
  const c = newCompany({name, gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  const under = {'Made Up Bank': 'Bank Accounts', 'Sales': 'Sales Accounts', 'Rent': 'Indirect Expenses'}, groups = {'Sundry Creditors': 'Current Liabilities', 'Sundry Debtors': 'Current Assets', 'Bank Accounts': 'Current Assets', 'Current Assets': '', 'Current Liabilities': '', 'Sales Accounts': '', 'Indirect Expenses': ''};
  for (let i = 0; i < nL; i++) under['Made Up Ledger ' + i] = i % 3 ? 'Sundry Creditors' : 'Sundry Debtors';
  const V = []; for (let i = 0; i < 200; i++) V.push({id: 'e' + i, date: '202505' + String(1 + i % 28).padStart(2, '0'), no: String(i + 1), type: 'Payment', party: 'Made Up Ledger ' + i, narr: '', ent: [{l: 'Made Up Ledger ' + i, a: -1000 - i}, {l: 'Made Up Bank', a: 1000 + i}]});
  S.books = {loading: false, cid: c.id, vouchers: V, map: {}, groups, under, meta: {from: V[0].date, to: V[V.length - 1].date, company: 'MADE UP CO'}, alloc: {}, challans: [], misCfg: {freq: 'off'}, auditCfg: {freq: 'off'}};
  await saveBooks(); Store.saveCompany(c); return c.id; }"""

def part_a(br):
    print("A. Ledgers.books on books with no ledInfo: counted once a task")
    pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY); pg.evaluate(LT)
    cid = pg.evaluate(BOOKS, [3000, "Made Up Ledgers Client"])
    pg.evaluate("(cid) => { S.coId = cid; S.view = 'company'; }", cid)
    r = pg.evaluate("""(cid) => { const u = S.books.under, k0 = Object.keys; let n = 0;
      Object.keys = function (o) { if (o === u) n++; return k0.apply(this, arguments); };
      let l; try { for (let i = 0; i < 400; i++) l = Ledgers.books(cid); } finally { Object.keys = k0; }
      const want = k0(u).filter((x) => !S.books.groups[x]).sort();
      return {n, len: l.length, same: JSON.stringify(l.map((x) => [x.name, x.group])) === JSON.stringify(want.map((x) => [x, u[x]])), ledInfo: 'ledInfo' in S.books}; }""", cid)
    ok(not r["ledInfo"] and r["n"] <= 2, "400 asks in one task: the ledger names read %d time(s), at most twice: counted once, listed once (was: at every ask)" % r["n"])
    ok(r["same"] and r["len"] == 3003, "the same list as before: every ledger with its group, sorted (%d)" % r["len"])
    # a name put in place: seen at the next task, as before
    r2 = pg.evaluate("""(cid) => new Promise((res) => { const a = Ledgers.books(cid).length; S.books.under['Made Up Ledger New'] = 'Sundry Creditors';
      const same = Ledgers.books(cid).length; setTimeout(() => res([a, same, Ledgers.books(cid).length, Ledgers.books(cid).some((x) => x.name === 'Made Up Ledger New')]), 0); })""", cid)
    ok(r2[2] == r2[0] + 1 and r2[3], "a ledger added in place to the books is in the list at the next task (%r)" % r2)
    # opening a client of 12,000 such ledgers: the whole opening's long tasks within 6 s (was: 31 s at 8,000, 232 s at 20,000)
    big = pg.evaluate(BOOKS, [12000, "Made Up Big Client"])
    pg.goto("about:blank"); pg.goto(URL + "#/today"); pg.evaluate(READY); pg.evaluate(LT); pg.wait_for_timeout(1500)
    t0 = pg.evaluate("() => performance.now()")
    pg.evaluate("(cid) => { openCompany(cid); }", big)
    pg.wait_for_function("() => S.books && S.books.cid === S.coId && !S.books.loading && Ledgers.books(S.coId).length > 12000", timeout=120000)
    pg.wait_for_timeout(2500)
    lt = pg.evaluate(LTS, t0)
    ok(lt[0] < 6000, "opening a client of 12,000 ledgers with no ledInfo: %d ms of long tasks, the longest %d ms (within 6,000)" % (lt[0], lt[1]))
    pg.close()

# a client with nL ledgers, a statement of nB lines, the account's ledger not confirmed (the Bank page asks for it)
BANK = """async ([nL, nB]) => {
  const c = newCompany({name: 'Made Up Bank Client ' + nL, gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  c.bankAccounts = [{id: 'a1', bank: 'Made Up Bank', acct: '0001'}];
  const leds = [{name: 'Made Up Bank', group: 'Bank Accounts'}, {name: 'Made Up Cash', group: 'Cash-in-Hand'}];
  for (let i = 0; i < nL; i++) leds.push({name: 'Made Up Ledger ' + i, group: i % 3 ? 'Sundry Creditors' : 'Sundry Debtors'});
  leds.push({name: 'Made Up Ledger With The Longest Name Of All', group: 'Sundry Creditors'});
  const rows = Array.from({length: nB}, (_, i) => ({id: 's1-' + i, fp: 'fp' + i, date: '2025-05-' + String(1 + i % 28).padStart(2, '0'), debit: 100 + i, credit: 0, bal: 0, narr: 'NEFT DR MADE UP LEDGER ' + i, dec: {name: 'Made Up Ledger ' + i, mode: 'NEFT', utr: 'U' + i}, ledger: 'Made Up Ledger ' + i, state: 'ready', balOk: true, why: []}));
  await BankDB.set('stmts:' + c.id, [{id: 's1', acctId: 'a1', bank: 'Made Up Bank', acct: '0001', from: '2025-05-01', to: '2025-05-28', opening: 0, closing: 0, n: nB, counts: countStates(rows)}]);
  await BankDB.set('stmt:' + c.id + ':s1', rows);
  await BankDB.set('ledgers:' + c.id, {list: leds, importedAt: new Date().toISOString(), live: true});
  Store.saveCompany(c); return c.id; }"""
SEL = '#app select[aria-label="Tally ledger for this bank account"]'
def part_b(br):
    print("B. the ledger lists to choose from: a long one filled when it is used")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY)
    small = pg.evaluate(BANK, [300, 60]); big = pg.evaluate(BANK, [20000, 2000])
    pg.goto("about:blank"); pg.goto(URL + "#/today"); pg.evaluate(READY); pg.evaluate(LT); pg.wait_for_timeout(1000)
    # a short list (303 ledgers): every one at once, as before
    pg.evaluate("(cid) => openCompany(cid).then(() => goClient('bank'))", small)
    pg.wait_for_selector(SEL, timeout=30000); pg.wait_for_timeout(800)
    r = pg.evaluate("(s) => { const e = document.querySelector(s); return [e.options.length, e.innerHTML === ledgerOptions('', BANK_GROUPS)]; }", SEL)
    ok(r[0] == 304 and r[1], "303 ledgers: the list holds every one at once, as before (%d options)" % r[0])
    # the long list: the Bank page opened, its long tasks
    pg.evaluate("() => navHome('today')"); pg.wait_for_timeout(800)
    t0 = pg.evaluate("() => performance.now()")
    pg.evaluate("(cid) => { openCompany(cid).then(() => goClient('bank')); }", big)
    pg.wait_for_selector(SEL, timeout=120000); pg.wait_for_timeout(3000)
    lt = pg.evaluate(LTS, t0)
    ok(lt[0] < 4000, "20,003 ledgers: the Bank page opened with %d ms of long tasks, the longest %d ms (within 4,000; was 22 s)" % (lt[0], lt[1]))
    r = pg.evaluate("(s) => { const e = document.querySelector(s); return [e.options.length, e.value, Math.round(e.getBoundingClientRect().width), [...e.options].map((o) => o.text)]; }", SEL)
    ok(r[0] <= 3 and r[1] == "" and "Made Up Ledger With The Longest Name Of All" in r[3], "before it is used: the choice and the longest name only (%d options: %r)" % (r[0], r[3][:4]))
    pg.focus(SEL); pg.wait_for_timeout(300)
    f = pg.evaluate("(s) => { const e = document.querySelector(s); return [e.options.length, e.innerHTML === ledgerOptions('', BANK_GROUPS), Math.round(e.getBoundingClientRect().width), e.value]; }", SEL)
    ok(f[0] == 20004 and f[1], "focused: every ledger, in the same order and groups as before (%d options)" % f[0])
    ok(abs(f[2] - r[2]) <= 6, "as wide before and after it is filled (%d px, %d px)" % (r[2], f[2]))
    pg.select_option(SEL, "Made Up Bank"); pg.wait_for_timeout(500)
    v = pg.evaluate("(s) => { const e = document.querySelector(s); return [e.value, e.options.length, [...e.options].filter((o) => o.selected).map((o) => o.text)]; }", SEL)
    ok(v[0] == "Made Up Bank" and v[2] == ["Made Up Bank"], "a ledger chosen: shown as chosen (%r)" % v)
    pg.click('#app [data-bank-ledger-confirm]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("(cid) => (CO(cid).bankAccounts[0] || {}).ledger", big) == "Made Up Bank", "and Confirm keeps it on the account, as before")
    # typing in the statement's search: each key drawn within 1.5 s (was 5-13 s)
    q = pg.locator('#app input[aria-label="Search the statement"]')
    if q.count():
        q.first.click(); t0 = pg.evaluate("() => performance.now()")
        for ch in "ledger 1": pg.keyboard.type(ch); pg.wait_for_timeout(80)
        pg.wait_for_timeout(1500); lt = pg.evaluate(LTS, t0)
        ok(lt[1] < 1500, "typing in the search: the longest task %d ms (within 1,500), %d ms in all" % (lt[1], lt[0]))
    else: ok(False, "the statement's search box")
    # Client setup > Bank: its ledger lists
    t0 = pg.evaluate("() => performance.now()")
    pg.evaluate("() => { S.step = null; S.tab = 'bankset'; render(); }"); pg.wait_for_timeout(2500)
    lt = pg.evaluate(LTS, t0)
    n = pg.evaluate("() => [...document.querySelectorAll('#app select')].map((e) => e.options.length).filter((n) => n > 1000).length")
    ok(lt[0] < 2000 and n == 0, "Client setup > Bank: %d ms of long tasks (within 2,000; was 5 s), no list filled before it is used" % lt[0])
    m = pg.evaluate("() => { const e = [...document.querySelectorAll('#app select')].find((x) => x.options.length && x.options[0].text.includes('Choose a Tally ledger')); if (!e) return null; const was = e.value, n0 = e.options.length; e.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); return [n0, e.options.length, was === e.value, e.innerHTML === ledgerOptions(was, undefined)]; }")
    ok(m and m[0] <= 3 and m[1] > 20000 and m[2] and m[3], "a ledger list there pressed with the mouse: every ledger, the choice kept (%r)" % (m,))
    pg.close()

TROWS = "() => document.querySelectorAll('#app table[data-list=\\'txn-bank\\'] tbody tr:not([data-lt-grow])').length"
TFOOT = "() => { const f = document.querySelector('#app table[data-list=\\'txn-bank\\'] tfoot'); return f ? f.innerText.replace(/\\s+/g, ' ').trim() : ''; }"
def part_c(br):
    print("C. long lists: drawn as they are scrolled to")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY)
    small = pg.evaluate(BANK, [300, 450]); big = pg.evaluate(BANK, [300, 20000])
    pg.goto("about:blank"); pg.goto(URL + "#/today"); pg.evaluate(READY); pg.evaluate(LT); pg.wait_for_timeout(1000)
    def txn(cid):
        pg.evaluate("(cid) => openCompany(cid).then(() => goClient('bank'))", cid); pg.wait_for_function("(cid) => S.bank && S.bank.cid === cid && !S.bank.loading", arg=cid, timeout=60000)
        pg.wait_for_timeout(1500); t0 = pg.evaluate("() => performance.now()")
        pg.evaluate("() => { S.txnQ = ''; goClient('txn'); txnTabGo('bank'); }"); pg.wait_for_selector("#app table[data-list='txn-bank']", timeout=60000); pg.wait_for_timeout(2000)
        return pg.evaluate(LTS, t0)
    txn(small)
    ok(pg.evaluate(TROWS) == 450 and "450 lines" in pg.evaluate(TFOOT), "450 lines: every one drawn at once, as before (%d rows; %s)" % (pg.evaluate(TROWS), pg.evaluate(TFOOT)[:60]))
    lt = txn(big)
    n0 = pg.evaluate(TROWS); foot = pg.evaluate(TFOOT)
    want = pg.evaluate("() => { const r = txnFiltered(txnRowsBank()); return [r.length, money(r2(r.reduce((a, x) => a + num(x.total), 0)))]; }")
    ok(lt[0] < 1500, "20,000 lines: Transactions opened with %d ms of long tasks, the longest %d ms (within 1,500; was 1 s, 2 s a key)" % (lt[0], lt[1]))
    ok(n0 == 300 and ("%d lines" % want[0]) in foot.replace(",", ""), "300 rows drawn, the foot counts all %d lines (%s)" % (want[0], foot[:80]))
    ok(want[1] in foot, "the foot's total is of every line (%s)" % want[1])
    h = pg.evaluate("() => { const g = document.querySelector('#app [data-lt-grow]'); const f = g && g.parentElement.firstElementChild; return g ? [Math.round(g.getBoundingClientRect().height), Math.round((g.getBoundingClientRect().top - f.getBoundingClientRect().top) / 300 * (20000 - 300))] : null; }")
    ok(h and abs(h[0] - h[1]) <= h[1] * 0.01, "the rows not drawn yet stood for by one row as tall as they are (%r)" % (h,))
    # the search: typed with every key drawn quickly, the same lines found
    box = pg.locator('#app input[aria-label="Find a transaction"]'); box.click(); t0 = pg.evaluate("() => performance.now()")
    for ch in "ledger 1": pg.keyboard.type(ch); pg.wait_for_timeout(80)
    pg.wait_for_timeout(1500); lt = pg.evaluate(LTS, t0)
    want = pg.evaluate("() => txnFiltered(txnRowsBank()).length")
    ok(lt[1] < 400, "typing in the search: the longest task %d ms (within 400; was 2 s a key), %d ms in all" % (lt[1], lt[0]))
    ok(("%d lines" % want) in pg.evaluate(TFOOT).replace(",", "") and pg.evaluate(TROWS) == min(300, want), "the search finds the same %d lines, the foot counts them" % want)
    pg.evaluate("() => { S.txnQ = ''; render(); }"); pg.wait_for_timeout(1500)
    # scrolled to: more rows come; to the end: every one, the last line last
    pg.evaluate("() => { const g = document.querySelector('#app [data-lt-grow]'); if (g) g.scrollIntoView(); }"); pg.wait_for_timeout(1200)
    n1 = pg.evaluate(TROWS)
    ok(n1 > n0, "scrolled to the end of what is drawn: more rows (%d, then %d)" % (n0, n1))
    for _ in range(200):
        if not pg.evaluate("() => !!document.querySelector('#app [data-lt-grow]')"): break
        pg.evaluate("() => { const g = document.querySelector('#app [data-lt-grow]'); if (g) g.scrollIntoView(); }"); pg.wait_for_timeout(120)
    ok(pg.evaluate(TROWS) == 20000, "scrolled on to the end: all 20,000 lines drawn (%d)" % pg.evaluate(TROWS))
    last = pg.evaluate("() => { const r = [...document.querySelectorAll('#app table[data-list=\\'txn-bank\\'] tbody tr')].pop(); return r ? r.cells[0].innerText.trim() : ''; }")
    ok(last == "20000", "the last row is line 20,000 (%s)" % last)
    pg.close()

def part_d(br):
    import gzip, glob
    print("D. sizes; the date boxes' calendar in its own file")
    gz = lambda f: len(gzip.compress(open(f, "rb").read(), 6))
    lg = gz(os.path.join(SITE, "legacy.js")); mg = sum(gz(f) for f in glob.glob(os.path.join(SITE, "assets", "index-*.js")))
    ok(lg <= 599744, "legacy.js: %d bytes gzip, no more than staging-next's 599,744" % lg)
    ok(mg <= 262713, "the first file: %d bytes gzip, no more than staging-next's 262,713" % mg)
    first = "".join(open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(SITE, "assets", "index-*.js")))
    cal = glob.glob(os.path.join(SITE, "assets", "calendar-*.js"))
    ok(cal and "Previous month" not in first and "Previous month" in open(cal[0], encoding="utf-8").read(), "the calendar is in its own file, not the first one")
    ok(cal and os.path.basename(cal[0]) in open(os.path.join(SITE, "sw.js"), encoding="utf-8").read(), "and the service worker keeps that file (it opens offline)")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY)
    bid = pg.evaluate("""async () => { const c = newCompany({name: 'Made Up Dates Client', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      await openCompany(c.id); const e = newEntry('Manual entry'); Object.assign(e.x, {vendorName: 'Made Up Supplier', invoiceNo: 'D/1', invoiceDate: '2026-07-01', taxable: 1000, total: 1000});
      S.data[c.id].entries[e.id] = e; goClient('bills'); revOpen(e.id); return e.id; }""")
    pg.wait_for_timeout(1500)
    btn = pg.locator('#app [data-datebox] button.datebox-cal').first
    btn.click(); pg.wait_for_selector(".datebox-pop [role=gridcell]", timeout=15000)
    cell = pg.locator('.datebox-pop [role=gridcell][aria-label*="15 July 2026"]')
    ok(cell.count() == 1, "the calendar opens on the bill's month (July 2026)")
    if cell.count(): cell.dispatch_event("click"); pg.wait_for_timeout(600)
    v = pg.evaluate("(id) => [D().entries[id].x.invoiceDate, (document.querySelector('#app [data-datebox] input') || {}).value]", bid)
    ok(v[0] == "2026-07-15" and v[1] == "15-Jul-2026", "a day picked: the bill's date and its box say 15-Jul-2026 (%r)" % v)
    pg.close()

def part_e(br):
    print("E. Sales: each invoice's sales ledger")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY)
    cid = pg.evaluate(BANK, [20000, 10])
    pg.evaluate("""async (cid) => { const L = (await BankDB.get('ledgers:' + cid)); L.list.push({name: 'Sales', group: ''});
      await BankDB.set('ledgers:' + cid, L);
      const sl = []; for (let i = 0; i < 1500; i++) sl.push(newInvoice({number: 'S/' + i, date: '2025-05-' + String(1 + i % 28).padStart(2, '0'), customerName: 'Made Up Ledger ' + i, taxable: 1000, cgst: 25, sgst: 25, total: 1050, items: [{rate: [5, 12, 18, 28][i % 4], taxable: 1000}]}, 'upload', {customerLedger: 'Made Up Ledger ' + i, status: 'review', needsMap: true}));
      await BankDB.set('sales:' + cid, sl); }""", cid)
    pg.goto("about:blank"); pg.goto(URL + "#/today"); pg.evaluate(READY); pg.evaluate(LT); pg.wait_for_timeout(1000)
    pg.evaluate("(cid) => openCompany(cid).then(() => loadBank(cid))", cid); pg.wait_for_timeout(2500)
    t0 = pg.evaluate("() => performance.now()")
    pg.evaluate("() => { goClient('sales'); }"); pg.wait_for_function("() => S.sales && !S.sales.loading", timeout=60000); pg.wait_for_timeout(2500)
    lt = pg.evaluate(LTS, t0)
    ok(lt[0] < 1700, "Sales opened: %d ms of long tasks, the longest %d ms (within 1,700; 1,741 on staging-next)" % (lt[0], lt[1]))
    # the ledger for each rate, local and inter-state, as the plain search over every ledger gives it
    r = pg.evaluate("""() => { const plain = (rate, inter) => { const keep = ledInKept; ledInKept = []; try { return salesLedgerFor(rate, inter); } finally { ledInKept = keep; } };
      const out = []; for (const rate of [0, 5, 12, 18, 28]) for (const inter of [false, true]) out.push([rate, inter, salesLedgerFor(rate, inter), plain(rate, inter)]); return out; }""")
    ok(all(x[2] == x[3] for x in r) and any(x[2] == "Sales" for x in r), "each rate's sales ledger the same as worked out afresh (%r)" % [(x[0], x[1], x[2]) for x in r][:6])
    t = pg.evaluate("() => { const t = performance.now(); for (let i = 0; i < 1500; i++) salesLedgerFor(5, false); return performance.now() - t; }")
    ok(t < 150, "1,500 invoices' sales ledger worked out in %d ms (within 150)" % t)
    pg.close()

def part_f(br):
    print("F. a long list printed: every row")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY)
    cid = pg.evaluate(BANK, [300, 1200])
    pg.goto("about:blank"); pg.goto(URL + "#/today"); pg.evaluate(READY); pg.wait_for_timeout(800)
    pg.evaluate("(cid) => openCompany(cid).then(() => goClient('bank'))", cid); pg.wait_for_function("(cid) => S.bank && S.bank.cid === cid && !S.bank.loading", arg=cid, timeout=60000); pg.wait_for_timeout(1000)
    pg.evaluate("() => { S.txnQ = ''; goClient('txn'); txnTabGo('bank'); }"); pg.wait_for_selector("#app table[data-list='txn-bank']", timeout=60000); pg.wait_for_timeout(1500)
    ok(pg.evaluate(TROWS) == 300, "1,200 lines: 300 drawn on the page (%d)" % pg.evaluate(TROWS))
    n = pg.evaluate("() => { window.dispatchEvent(new Event('beforeprint')); return document.querySelectorAll('#app table[data-list=\\'txn-bank\\'] tbody tr:not([data-lt-grow])').length; }")
    ok(n == 1200, "printed with the browser's Print (beforeprint): all 1,200 rows drawn (%d)" % n)
    pg.evaluate("() => window.dispatchEvent(new Event('afterprint'))"); pg.wait_for_timeout(500)
    ok(pg.evaluate(TROWS) == 300, "after the print: 300 again (%d)" % pg.evaluate(TROWS))
    pg.emulate_media(media="print"); pg.wait_for_timeout(300)
    n = pg.evaluate(TROWS)
    pg.emulate_media(media="screen"); pg.wait_for_timeout(300)
    ok(n == 1200 and pg.evaluate(TROWS) == 300, "a browser that only turns the print media on: all 1,200 drawn, then 300 (%d, %d)" % (n, pg.evaluate(TROWS)))
    h = pg.evaluate("""() => { const t = document.querySelector('#app table[data-list=\\'txn-bank\\']'); t.parentElement.id = 'psPrintWrap'; let got = '';
      const pv = window.printView; window.printView = (title, html) => { got = html; }; try { printTable('psPrintWrap', 'Made up'); } finally { window.printView = pv; }
      return (got.match(/<tr[ >]/g) || []).length; }""")
    ok(h >= 1201, "printTable of the box around it: every row in what is printed (%d rows)" % h)
    pg.wait_for_timeout(500)
    ok(pg.evaluate(TROWS) == 300, "and the page draws 300 again after it (%d)" % pg.evaluate(TROWS))
    # far down the list, one line taken out: the rows drawn stay
    for _ in range(30):
        if pg.evaluate(TROWS) >= 600: break
        pg.evaluate("() => { const g = document.querySelector('#app [data-lt-grow]'); if (g) g.scrollIntoView(); }"); pg.wait_for_timeout(150)
    n0 = pg.evaluate(TROWS)
    n1 = pg.evaluate("() => { S.bank.rows.splice(5, 1); render(); return document.querySelectorAll('#app table[data-list=\\'txn-bank\\'] tbody tr:not([data-lt-grow])').length; }")
    ok(n0 >= 600 and n1 >= n0 - 1, "a line taken out far down the list: the rows drawn stay (%d, then %d)" % (n0, n1))
    pg.evaluate("() => { S.txnQ = 'ledger 11'; render(); }"); pg.wait_for_timeout(500)
    want = pg.evaluate("() => txnFiltered(txnRowsBank()).length")
    ok(pg.evaluate(TROWS) == min(300, want), "another search: from the top again (%d of %d)" % (pg.evaluate(TROWS), want))
    pg.close()

def part_g(br):
    import glob
    print("G. the calendar's file not there")
    cal = os.path.basename((glob.glob(os.path.join(SITE, "assets", "calendar-*.js")) or ["calendar-x.js"])[0])
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    asked = []
    pg.on("request", lambda r: asked.append(r.url) if "/assets/calendar-" in r.url else None)
    pg.goto(URL); pg.evaluate(READY); pg.wait_for_timeout(4000)
    ok(any(cal in u for u in asked), "fetched ahead once the page is idle, before any calendar is opened (%d asks)" % len(asked))
    ctx.close()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    ctx.route("**/assets/calendar-*", lambda r: r.abort("internetdisconnected"))
    pg.goto(URL); pg.evaluate(READY)
    bid = pg.evaluate("""async () => { const c = newCompany({name: 'Made Up Dates Client', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      await openCompany(c.id); const e = newEntry('Manual entry'); Object.assign(e.x, {vendorName: 'Made Up Supplier', invoiceNo: 'D/1', invoiceDate: '2026-07-01', taxable: 1000, total: 1000});
      S.data[c.id].entries[e.id] = e; goClient('bills'); revOpen(e.id); window.__stay = 1; return e.id; }""")
    pg.wait_for_timeout(1500)
    pg.locator('#app [data-datebox] button.datebox-cal').first.click(); pg.wait_for_timeout(2500)
    ok(pg.evaluate("() => window.__stay === 1"), "FinCom is not reloaded for it")
    ok(pg.locator(".datebox-pop [data-cal-failed]").count() == 1, "the calendar's place says it could not be loaded")
    box = pg.locator('#app [data-datebox] input').first; box.fill("15-07-2026"); box.press("Enter"); pg.wait_for_timeout(600)
    ok(pg.evaluate("(id) => D().entries[id].x.invoiceDate", bid) == "2026-07-15", "a date typed still goes in (%s)" % pg.evaluate("(id) => D().entries[id].x.invoiceDate", bid))
    # the line back: the calendar opened again shows (no reload needed)
    ctx.unroute("**/assets/calendar-*")
    btn = pg.locator('#app [data-datebox] button.datebox-cal').first
    if pg.locator(".datebox-pop").count(): btn.dispatch_event("click"); pg.wait_for_timeout(300)
    btn.dispatch_event("click")
    try: pg.wait_for_selector(".datebox-pop [role=gridcell]", timeout=10000)
    except Exception: pass
    ok(pg.locator(".datebox-pop [role=gridcell]").count() > 0 and pg.evaluate("() => window.__stay === 1"), "the file reachable again: the calendar opened again shows, without a reload")
    ok(pg.evaluate("() => [...document.querySelectorAll('link[rel=stylesheet][href*=\\'/calendar-\\']')].some((l) => !!l.sheet)"), "with its styles")
    ctx.close()

def part_h(br):
    print("H. a long ledger list filled once: later ledgers in it")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY)
    cid = pg.evaluate(BANK, [3000, 30])
    pg.goto("about:blank"); pg.goto(URL + "#/today"); pg.evaluate(READY); pg.wait_for_timeout(800)
    pg.evaluate("(cid) => openCompany(cid).then(() => goClient('bank'))", cid); pg.wait_for_selector(SEL, timeout=60000); pg.wait_for_timeout(800)
    pg.focus(SEL); pg.wait_for_timeout(200)
    n0 = pg.evaluate("(s) => document.querySelector(s).options.length", SEL)
    pg.evaluate("() => { document.activeElement.blur(); S.bank.newLed = (S.bank.newLed || []).concat([{name: 'Made Up Ledger Created Here', group: 'Sundry Creditors'}]); render(); }"); pg.wait_for_timeout(500)
    pg.focus(SEL); pg.wait_for_timeout(200)
    r = pg.evaluate("(s) => { const e = document.querySelector(s); return [e.options.length, [...e.options].some((o) => o.value === 'Made Up Ledger Created Here'), e.innerHTML === ledgerOptions('', BANK_GROUPS)]; }", SEL)
    ok(n0 > 3000 and r[1] and r[2], "a ledger created here: in the list the next time it is used (%d, then %r)" % (n0, r[:2]))
    pg.evaluate("() => { document.activeElement.blur(); S.bank.newLed = S.bank.newLed.concat([{name: 'Made Up Ledger Created Here With A Name Longer Than Any', group: 'Sundry Creditors'}]); render(); }"); pg.wait_for_timeout(500)
    short = pg.evaluate("(s) => document.querySelector(s).options.length", SEL)
    pg.dispatch_event(SEL, "mousedown"); pg.wait_for_timeout(200)
    r = pg.evaluate("(s) => { const e = document.querySelector(s); return [e.options.length, e.innerHTML === ledgerOptions('', BANK_GROUPS)]; }", SEL)
    ok(short <= 3 and r[1], "its short form drawn again (%d options) and pressed: every ledger again (%d)" % (short, r[0]))
    pg.close()

# the earlier search for a receipt's sales invoice (0d6212fc0's matchSalesInvoice), word for word: what the lighter one must give
PLAIN_SALES = """(row, invs, taken) => {
  const amt = row.credit;
  const cands = invs.filter(v => !taken.has(v.id) && (!v.x.date || v.x.date <= row.date));
  const score = v => Math.max(nameSim(row.dec.name, v.x.customerName), nameSim(row.dec.name, v.customerLedger));
  let hits = cands.filter(v => Math.abs(num(v.x.total) - amt) <= 1).map(v => ({inv: [v], sim: score(v)}));
  if (!hits.length){
    const byCust = new Map();
    cands.forEach(v => { const k = v.customerLedger; (byCust.get(k) || byCust.set(k, []).get(k)).push(v); });
    byCust.forEach(list => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (Math.abs(num(list[i].x.total) + num(list[j].x.total) - amt) <= 1) hits.push({inv: [list[i], list[j]], sim: score(list[i])}); });
  }
  if (!hits.length) return null;
  hits.sort((a, b2) => b2.sim - a.sim);
  const h = hits[0];
  if (h.sim < 0.45 && hits.length > 1) return null;
  if (h.sim < 0.3 && row.dec.name) return null;
  return {inv: h.inv, strong: h.sim >= 0.6};
}"""
# a client of 3,000 ledgers, 1,600 open sales invoices (1,200 of one customer; 100 with no date or dated in the month),
# a statement of 2,000 lines: 500 receipts not
# yet booked (most the sum of two invoices of a customer, some of one invoice, some of none), the rest booked payments
SALES_BANK = """async ([nR]) => {
  let s = 5; const R = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }, pad = (x) => String(x).padStart(2, '0');
  const c = newCompany({name: 'Made Up Receipts Client', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  c.bankAccounts = [{id: 'a1', bank: 'Made Up Bank', acct: '0001', ledger: 'Made Up Bank'}];
  const leds = [{name: 'Made Up Bank', group: 'Bank Accounts'}];
  for (let i = 0; i < 3000; i++) leds.push({name: 'Made Up Customer ' + i, group: i % 3 ? 'Sundry Creditors' : 'Sundry Debtors'});
  const sl = []; for (let i = 0; i < 1500; i++) { const p = i < 1200 ? 'Made Up Customer 0' : 'Made Up Customer ' + (1 + i % 90);
    sl.push(newInvoice({number: 'S/' + i, date: '2025-04-' + pad(1 + i % 28), customerName: p, taxable: 5000, cgst: 450, sgst: 450, total: i < 1200 ? 5900 + i * 7 : 3000 + Math.round(R() * 9000) + (i % 2 ? .5 : 0)}, 'upload', {customerLedger: p, status: i % 5 ? 'ready' : 'review'})); }
  // 100 more: half with no date, half dated in the statement's month (after some of its receipts)
  for (let i = 1500; i < 1600; i++) { const p = 'Made Up Customer ' + (1 + i % 90);
    sl.push(newInvoice({number: 'S/' + i, date: i % 2 ? '' : '2025-05-' + pad(1 + i % 28), customerName: p, taxable: 2000, cgst: 0, sgst: 0, total: 2000 + i * 3 + .25}, 'upload', {customerLedger: p, status: 'ready'})); }
  // receipts at an invoice's amount (or a pair's) exactly a rupee off, and just past it: EDGE[i % 50]
  const EDGE = {10: [1, 1], 20: [1, -1], 30: [1, 1.01], 40: [1, -1.01], 15: [2, 1], 25: [2, -1], 35: [2, 1.01], 45: [2, -1.01]};
  const rows = []; let bal = 1e7;
  for (let i = 0; i < 2000; i++) { const inn = i < nR, k = i % 10, ed = inn && EDGE[i % 50]; let cu = k < 6 ? 'Made Up Customer 0' : 'Made Up Customer ' + (1 + Math.floor(R() * 90));
    let amt = !inn ? 500 + i : k === 9 ? 3 + i * 0.37 : k === 8 ? sl[1200 + Math.floor(R() * 400)].x.total : Math.round(12000 + R() * 8000);
    if (ed && ed[0] === 1) { const v = sl[1200 + Math.floor(R() * 400)]; cu = v.customerLedger; amt = v.x.total + ed[1]; }
    if (ed && ed[0] === 2) { cu = 'Made Up Customer 0'; amt = sl[Math.floor(R() * 1200)].x.total + sl[Math.floor(R() * 1200)].x.total + ed[1]; }
    bal += inn ? amt : -amt;
    rows.push({id: 's1-' + i, fp: 'fp' + i, date: '2025-05-' + pad(1 + i % 28), debit: inn ? 0 : amt, credit: inn ? amt : 0, bal: r2(bal), narr: (inn ? 'NEFT CR ' : 'NEFT DR ') + cu.toUpperCase() + ' UTR' + i,
      dec: {name: k === 7 ? '' : cu, mode: 'NEFT', utr: 'UTR' + i}, ledger: inn ? '' : 'Made Up Customer ' + (1 + i % 90), state: inn ? 'attention' : 'ready', balOk: true, why: inn ? ['No ledger found for this party.'] : []}); }
  await BankDB.set('stmts:' + c.id, [{id: 's1', acctId: 'a1', bank: 'Made Up Bank', acct: '0001', from: '2025-05-01', to: '2025-05-28', opening: 1e7, closing: rows[rows.length - 1].bal, n: rows.length, counts: countStates(rows)}]);
  await BankDB.set('stmt:' + c.id + ':s1', rows);
  await BankDB.set('ledgers:' + c.id, {list: leds, importedAt: new Date().toISOString(), live: true});
  await BankDB.set('sales:' + c.id, sl);
  Store.saveCompany(c); return c.id; }"""
# each line's suggestion: what the Bank page shows and keeps
SUGG = "(rows) => rows.map((r) => [r.id, r.state, r.ledger, r.level, r.source, r.srcLabel, (r.why || []).toString(), r.billRef, (r.salesIds || []).join(',')])"
def part_i(br):
    print("I. Bank on a client switch: receipts matched to sales invoices")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.goto(URL); pg.evaluate(READY)
    other = pg.evaluate(BANK, [300, 60]); cid = pg.evaluate(SALES_BANK, [500])
    pg.goto("about:blank"); pg.goto(URL + "#/today"); pg.evaluate(READY); pg.evaluate(LT); pg.wait_for_timeout(1000)
    pg.evaluate("(cid) => openCompany(cid).then(() => goClient('bank'))", other); pg.wait_for_function("(cid) => S.bank && S.bank.cid === cid && !S.bank.loading", arg=other, timeout=60000); pg.wait_for_timeout(1500)
    # switched to the client: its statement opened, its 500 receipts suggested
    t0 = pg.evaluate("() => performance.now()")
    pg.evaluate("(cid) => { openCompany(cid).then(() => goClient('bank')); }", cid)
    pg.wait_for_function("(cid) => S.bank && S.bank.cid === cid && !S.bank.loading && S.bank.rows.length === 2000 && !S.bank.rows.some((r) => r.state === 'attention' && !(r.why || []).length)", arg=cid, timeout=120000)
    pg.wait_for_timeout(2500)
    lt = pg.evaluate(LTS, t0)
    ok(pg.evaluate("() => matchSalesInvoice.light === true"), "the lighter search is the one the app uses")
    ok(lt[1] < 2000, "switched to a client of 500 receipts and 1,600 sales invoices: the longest task %d ms (within 2,000; 1,468 ms on staging-next), %d ms in all" % (lt[1], lt[0]))
    # the suggestions: the same as the earlier search gives, line by line
    r = pg.evaluate("""([plain, sugg]) => { const b = S.bank, open = () => b.rows.filter((r) => r.credit).map((r) => Object.assign(JSON.parse(JSON.stringify(r)), {state: 'attention', ledger: '', userSet: false}));
      const run = (f) => { const rows = open(), keep = window.matchSalesInvoice; if (f) window.matchSalesInvoice = f; let ms; try { const t = performance.now(); suggestAll(rows); ms = performance.now() - t; } finally { window.matchSalesInvoice = keep; } return [eval(sugg)(rows), ms]; };
      const [now, ms] = run(null), [was, msWas] = run((0, eval)('(' + plain + ')'));
      const shown = eval(sugg)(b.rows.filter((r) => r.credit));
      const edge = {10: '+1', 20: '-1', 30: '+1.01', 40: '-1.01', 15: 'pair +1', 25: 'pair -1', 35: 'pair +1.01', 45: 'pair -1.01'}, edges = {};
      now.forEach((x) => { const e = edge[Number(x[0].split('-')[1]) % 50]; if (e) { edges[e] = edges[e] || [0, 0]; edges[e][0]++; if (x[4] === 'sales') edges[e][1]++; } });
      return {edges, same: JSON.stringify(now) === JSON.stringify(was), shownSame: JSON.stringify(shown) === JSON.stringify(was), n: now.length, sales: now.filter((x) => x[4] === 'sales').length, pairs: now.filter((x) => x[8].includes(',')).length, ms: Math.round(ms), msWas: Math.round(msWas),
        diff: now.map((x, i) => JSON.stringify(x) === JSON.stringify(was[i]) ? null : [x, was[i]]).filter(Boolean).slice(0, 2)}; }""", [PLAIN_SALES, SUGG])
    ok(r["same"] and r["shownSame"] and r["sales"] > 100 and r["pairs"] > 50, "every receipt's suggestion the same as the earlier search's (%d lines, %d to sales invoices, %d to two; shown on the page the same: %s) %s" % (r["n"], r["sales"], r["pairs"], r["shownSame"], r["diff"] or ""))
    e = r["edges"]
    ok(all(e.get(k, [0, 0])[0] >= 10 for k in ["+1", "-1", "+1.01", "-1.01", "pair +1", "pair -1", "pair +1.01", "pair -1.01"]) and e["+1"][1] and e["-1"][1] and e["pair +1"][1] and e["pair -1"][1],
       "receipts a rupee off an invoice or a pair, and just past it, among them (lines, to sales invoices: %r)" % e)
    ok(r["ms"] * 3 <= r["msWas"] and r["ms"] < 2000, "suggesting the 500 receipts: %d ms, at least 3 times quicker than the earlier search's %d ms (and within 2,000)" % (r["ms"], r["msWas"]))
    pg.close()

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for k, f in [("A", part_a), ("B", part_b), ("C", part_c), ("D", part_d), ("E", part_e), ("F", part_f), ("G", part_g), ("H", part_h), ("I", part_i)]:
            if not ONLY or k in ONLY: f(br)
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % "; ".join(errors[:3]))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
