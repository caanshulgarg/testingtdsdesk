"""python3 run_page_speed.py - next-fix-pagespeed (21-Nov-2026; the owner: "app and pages should be fast"). Measured on made-up
books of 50 clients, the large one with 20,000 bank lines, 20,000 ledgers and 20,000 entries (the scripts and figures are
in the branch's report). Each part below is one slowdown found there, held to its fix, with the answer the same as before:

  A. Ledgers.books (src/js/58) on books with no ledger masters' details (ledInfo; books from the cloud copy or a day book
     with only the groups): the cache key's count was made again at every ask (a new {} each time never matched the one
     kept), so opening a client with 20,000 ledgers counted 20,000 names for each of its ~20,000 ledger look-ups (232 s of
     one task). Now counted once a task, as with ledInfo: the same list, a name added in place seen at the next task.

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

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for k, f in [("A", part_a), ("B", part_b), ("C", part_c), ("D", part_d), ("E", part_e)]:
            if not ONLY or k in ONLY: f(br)
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % "; ".join(errors[:3]))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
