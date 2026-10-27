"""python3 run_ui_standards.py - the owner's standards for every page (spec K, 04-Oct-2026), checked on each page of
shots_ui_pass.py at 1366 x 768:
  - no "TDSDesk", "React", internal ids (the client's and the bills' ids, job ids), commit stamps or build numbers on the
    screen; the build stamp only in the small About line (Settings);
  - amounts in Indian form with two decimals (1,25,000.00), right-aligned in tables; never 1,250,000;
  - dates as 04-Oct-2026: no 2026-10-04, 04/10/2026 or "4 Oct 2026" on the screen;
  - no sideways scrolling at 1366 x 768 (nothing sticks out past the right edge unless inside its own scroll box);
  - every disabled button says why: on hover (its title) and beside it in plain sight;
  - at most one primary (filled) button on a page;
  - the four colours of meaning are CSS tokens: --st-done (green), --st-attention (amber), --st-failed (red), --st-waiting (grey);
  - a part of a page that fails to draw says so in plain words, not the raw error.
Round 2 (K5, K6, K7, of 04-Oct-2026):
  - every table on a page is a list on the one shared table (app/src/parts/ListTable.jsx, <table data-list>) or is marked
    a statement (data-statement: a balance sheet, a return's tables, a form), whose rows keep the law's or the form's order;
  - on every list: the columns in one order (date, number, party, amount, status, then the rest), the header stays in
    view (sticky), each of those headers sorts on a click with an arrow showing which, a count and the totals at the
    foot, and an empty list says what to do next;
  - time stamps in IST (04-Oct-2026 14:05 IST) also on a computer whose clock is not on Indian time; no bare 14:05;
  - while data loads (a request held open) the page shows "Loading…" or a skeleton, never a blank area.
Offline, the made-up client of shots_ui_pass.py, the React test build (app/dist-test)."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import shots_ui_pass as U
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8249), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the page's visible words, without the About line, the test build's banner, and what is typed in boxes
TEXT = """() => { const hide = [...document.querySelectorAll('[data-about], .test-banner, #fincomBanner, script, style')]; const was = hide.map(h => h.style.display); hide.forEach(h => { h.style.display = 'none'; });
  const t = [document.getElementById('cobar'), document.getElementById('app'), document.getElementById('side')].map(e => e ? e.innerText : '').join('\\n'); hide.forEach((h, i) => { h.style.display = was[i]; }); return t; }"""
WIDE = """() => { const W = window.innerWidth, out = [];
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of document.querySelectorAll('#app *, #cobar *')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1 && !clipped(el)) out.push((el.tagName + '.' + el.className).slice(0, 40) + ' ' + Math.round(r.right)); }
  return {scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, out: out.slice(0, 4)}; }"""
DISABLED = """(sel) => [...document.querySelectorAll(sel)].filter(b => b.offsetParent !== null).map(b => {
  const why = (b.getAttribute('title') || '').trim(), n = b.nextElementSibling;
  const beside = n && n.classList.contains('why-note') && n.offsetParent !== null && n.innerText.trim();
  const around = b.parentElement ? b.parentElement.innerText.replace(b.innerText, '') : '';
  let marked = false; for (let q = b.parentElement, k = 0; q && k < 2; q = q.parentElement, k++) { if (q.querySelector('[data-why]')) marked = true; }
  let near = false; for (let q = b.parentElement, k = 0; q && k < 2; q = q.parentElement, k++) { if (why.length > 8 && (q.innerText || '').replace(b.innerText, '').includes(why.slice(0, 25))) near = true; }
  return {b: b.innerText.trim().slice(0, 40), why, ok: !!why && (!!beside || marked || near)}; }).filter(x => !x.ok)"""
PRIMARY = """(sel) => [...document.querySelectorAll(sel)].filter(b => b.offsetParent !== null && !b.closest('[role=dialog], .modal, #modal')).map(b => b.innerText.trim().slice(0, 30) || b.outerHTML.slice(0, 90))"""
# amounts in tables: the cells of a column whose head names money
AMOUNTS = """() => { const out = [];
  for (const t of document.querySelectorAll('#app table')) { if (!t.offsetParent) continue;
    const heads = [...t.querySelectorAll('thead tr:last-child th')].map(h => h.innerText.trim().toLowerCase());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => {
      if (!/amount|value|taxable|total|₹|balance|debit|credit|tds|gst|withdraw|deposit/.test(heads[i] || '') || /rate|%|section|gstin|limit|type|ledger|return|status|period|vs/.test(heads[i] || '')) return;
      const s = td.innerText.trim().split('\\n')[0]; if (!/\\d/.test(s) || /^\\d+$/.test(s) || /\\d{1,2}[-\\/][A-Za-z0-9]{2,3}[-\\/]\\d{2,4}/.test(s) || /[a-z]{3,}/i.test(s.replace(/\\b(Dr|Cr)\\b/g, ''))) return;
      out.push({s, ok: /^[-−–]?₹?[-−–]?(\\d{1,2},)?(\\d{2},)*\\d{1,3}\\.\\d{2}( Dr| Cr)?$/.test(s), right: /right|end/.test(getComputedStyle(td).textAlign)}); })); }
  return out; }"""

# ---- round 2: the lists (K6) -------------------------------------------------------------------------------------
# rank of a column's role: a tick box first, then date, number, party, amount, status, then the rest, actions last
LISTS = """() => { const R = {pick: 0, row: 0, date: 1, number: 2, party: 3, amount: 4, status: 5, '': 6, act: 7};
  return [...document.querySelectorAll('#app table')].filter(t => t.offsetParent && !t.closest('[role=dialog], .modal, #confirmBox, .drawer, .tdetail')).map(t => {
    const list = t.hasAttribute('data-list'), stmt = !!t.closest('[data-statement]');
    const ths = [...t.querySelectorAll('thead tr:last-child th')];
    const roles = ths.map(h => h.getAttribute('data-role') || ''), labels = ths.map(h => ((h.querySelector('.gfl') || h).innerText || '').trim());
    const rows = [...t.tBodies].flatMap(b => [...b.rows]).filter(r => r.offsetParent);
    const foot = t.querySelector('tfoot[data-list-foot]');
    const sticky = ths.length > 0 && ths.every(h => getComputedStyle(h).position === 'sticky');
    const sortable = ths.filter((h, i) => ['date', 'number', 'party', 'amount', 'status'].includes(roles[i])).every(h => h.querySelector('button.lt-sort'));
    let order = true; for (let i = 1; i < roles.length; i++) if (R[roles[i]] < R[roles[i - 1]]) order = false;
    const amountsN = ths.filter((h, i) => roles[i] === 'amount').every(h => h.classList.contains('n'));
    const dateOk = labels.filter((l, i) => roles[i] === 'date').every(l => /date|when|on\b|deposited|received|made|taken|seen|updated|month|period|sent|booked|written|deducted|opened|added|removed|kept|from|run|last/i.test(l));
    return {name: t.getAttribute('data-list') || (t.className + ' | ' + labels.slice(0, 4).join('/')).slice(0, 70), list, stmt, roles, labels, rows: rows.length,
      foot: foot ? foot.innerText.replace(/\s+/g, ' ').trim() : null, sticky, sortable, order, amountsN, dateOk, hasAmount: roles.includes('amount')}; }); }"""
EMPTIES = """() => [...document.querySelectorAll('#app [data-list-empty]')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\s+/g, ' ').trim())"""
NEXT = re.compile(r"\b(use|add|upload|open|choose|import|run|create|connect|bring|drop|click|press|tick|refresh|read|go to|set up|send|make|start|clear|type|ask|wait)\b", re.I)
# a header click: the rows of that column in order, the arrow and aria-sort on it
SORT = """(name) => { const t = document.querySelector('#app table[data-list="' + name + '"]'); if (!t) return null;
  const ths = [...t.querySelectorAll('thead tr:last-child th')]; const pick = ['party', 'number', 'date', 'amount'].map(r => ths.findIndex(h => h.getAttribute('data-role') === r && h.querySelector('button.lt-sort'))).find(i => i >= 0);
  if (pick === undefined) return null; const th = ths[pick];
  return {i: pick, role: th.getAttribute('data-role')}; }"""
CELLS = """([name, i]) => { const t = document.querySelector('#app table[data-list="' + name + '"]'); const th = t.querySelectorAll('thead tr:last-child th')[i];
  return {sort: th.getAttribute('aria-sort'), arrow: (th.querySelector('.lt-ar') || {innerText: ''}).innerText.trim(),
    vals: [...t.tBodies[0].rows].map(r => r.cells[i] ? r.cells[i].getAttribute('data-sort') : null)}; }"""
def in_order(vals, desc=False):
    def key(v):
        try: return (0, float(v), "")
        except (TypeError, ValueError): return (0 if v not in (None, "") else 1, 0, str(v or "").lower())
    ks = [key(v) for v in vals if v not in (None, "")]
    return all((ks[i] >= ks[i - 1]) if not desc else (ks[i] <= ks[i - 1]) for i in range(1, len(ks)))
sorted_seen = set()
def list_checks(pg, name):
    ls = pg.evaluate(LISTS)
    loose = [l["name"] for l in ls if not l["list"] and not l["stmt"]]
    ok(not loose, "%s: every table is a list on the shared table or marked a statement (%s)" % (name, loose[:3]))
    for l in [x for x in ls if x["list"]]:
        n = "%s / %s" % (name, l["name"])
        ok(l["order"], "%s: columns in the one order, date, number, party, amount, status, then the rest (%s)" % (n, list(zip(l["labels"], l["roles"]))))
        ok(l["sticky"], "%s: the header stays in view (sticky)" % n)
        ok(l["sortable"], "%s: the date, number, party, amount and status headers sort on a click" % n)
        ok(l["amountsN"] and l["dateOk"], "%s: the amount columns are right-aligned and the date column is a date (%s)" % (n, l["labels"]))
        if l["rows"]:
            f = l["foot"] or ""
            ok(re.search(r"\b\d[\d,]* [a-z]", f) and (not l["hasAmount"] or re.search(r"\d\.\d\d", f)), "%s: a count and the totals at the foot (%s)" % (n, f[:80]))
        if l["rows"] >= 2 and l["name"] not in sorted_seen:
            sorted_seen.add(l["name"]); s = pg.evaluate(SORT, l["name"])
            if s:
                th = pg.locator('#app table[data-list="%s"] thead tr:last-child th >> nth=%d' % (l["name"], s["i"])).locator("button.lt-sort")
                th.click(); pg.wait_for_timeout(350); a = pg.evaluate(CELLS, [l["name"], s["i"]])
                th.click(); pg.wait_for_timeout(350); d = pg.evaluate(CELLS, [l["name"], s["i"]])
                ok(a["sort"] == "ascending" and a["arrow"] in ("▲", "↑") and in_order(a["vals"]) and d["sort"] == "descending" and d["arrow"] in ("▼", "↓") and in_order(d["vals"], True),
                   "%s: a click on %s sorts up, again down, with an arrow (%s %s / %s %s)" % (n, s["role"], a["sort"], a["arrow"], d["sort"], d["arrow"]))
                pg.evaluate("(n) => { if (S.listSort) delete S.listSort[n]; render(); }", l["name"]); pg.wait_for_timeout(250)
    for e in pg.evaluate(EMPTIES):
        ok(len(e) > 15 and NEXT.search(e), "%s: an empty list says what to do next (%s)" % (name, e[:90]))
# times: a bare 14:05 with no IST after it
BARE_TIME = re.compile(r"(?<![\d:.])(?:[01]\d|2[0-3]):[0-5]\d(?![\d:])(?!\s*IST)")

# lists with made-up rows (the made-up client of shots_ui_pass.py has none on these pages)
MORE = [
    ("sales-list", """(cid) => { goClient('sales'); }"""),
    ("sales-list-rows", """(cid) => { const s = SL(); const mk = (id, d, no, cu, tot, st) => ({id, status: st, source: 'created', x: {date: d, number: no, customerName: cu, taxable: r2(tot / 1.18), cgst: r2(tot * 0.09 / 1.18), sgst: r2(tot * 0.09 / 1.18), igst: 0, cess: 0, total: tot}, customerLedger: cu});
      s.list = [mk('v1', '2026-09-03', 'INV-7', 'ZED TRADERS', 11800, 'review'), mk('v2', '2026-09-01', 'INV-12', 'ALPHA LTD', 59000, 'review'), mk('v3', '2026-09-02', 'INV-9', 'MANGO & CO', 2360, 'review')]; s.filter = 'review'; render(); }"""),
    ("bank-list", """(cid) => { const c = CO(cid); c.bankAccounts = [{id: 'a1', bank: 'ICICI', acct: '0214', ledger: 'ICICI Bank'}]; goClient('bank');
      const parties = ['DIPTI VATS', 'BHARATKOSH', 'ALPHA LTD', 'ZED TRADERS'];
      const rows = parties.map((p, i) => ({id: 'r' + i, fp: 'fp' + i, date: '2026-09-0' + (4 - i), debit: i % 2 ? 0 : 1000 * (i + 1), credit: i % 2 ? 2500 * i : 0, bal: 0, narr: 'NEFT ' + p + ' UTR' + (100 + i), dec: {name: p, mode: 'NEFT', utr: 'UTR' + (100 + i)}, ledger: '', state: 'attention', balOk: true, why: ['No ledger found for this party.']}));
      S.bank = Object.assign(S.bank || {}, {cid, loading: false, stmts: [{id: 's1', acctId: 'a1', bank: 'ICICI', acct: '0214', from: '2026-09-01', to: '2026-09-04', opening: 0, closing: 0}], cur: 's1', rows, rules: [], wrules: [],
        ledgers: {list: [{name: 'ICICI Bank', group: 'Bank Accounts'}], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: 'review', grouped: false, showSettings: false, q: '', limit: 100, pendingRule: null, busy: '',
        createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []}); render(); }"""),
    ("in-tally-log", """(cid) => { S.firm.postLog = [{at: '2026-10-04T08:35:00Z', co: cid, what: 'bill', ref: 'B/2209', party: 'LYALLPUR TRADERS', amount: 47200, tally: {vchType: 'Purchase', masterId: 81, company: 'Testing AAD'}, by: 'Anshul'},
      {at: '2026-10-03T06:00:00Z', co: cid, what: 'bill', ref: 'A/17', party: 'ALPHA LTD', amount: 1180, tally: {vchType: 'Purchase', masterId: 80, company: 'Testing AAD'}, by: 'Anshul'}]; S.view = 'company'; goStep('done', 'bills'); }"""),
    ("unsorted-inbox", """(cid) => { S.inbox = {u1: {id: 'u1', fileName: 'bill-a.pdf', createdAt: '2026-10-04T05:00:00Z', j: {vendorName: 'ZED TRADERS', buyerName: 'SOMEONE ELSE', totalAmount: 1180, invoiceNo: 'Z-1', invoiceDate: '2026-09-10'}, note: 'Billed to a GSTIN of no client'},
      u2: {id: 'u2', fileName: 'bill-b.pdf', createdAt: '2026-10-03T05:00:00Z', j: {vendorName: 'ALPHA LTD', buyerName: 'OTHER CO', totalAmount: 5900, invoiceNo: 'A-9', invoiceDate: '2026-09-11'}, note: 'Billed to a GSTIN of no client'}}; navHome('inbox'); }"""),
    ("transactions-sales", """(cid) => { goClient('txn'); txnTabGo('sales'); }"""),
    ("purchase-deleted", """(cid) => { S.view = 'company'; goClient('bills'); S.filter = 'deleted'; render(); }"""),
    # with the books (tests/data), the lists of the TDS return and of GST
    ("tds-return-deductions", """(cid) => { if (!S.books || !(S.books.vouchers || []).length) return; const by = {}; TDS.rows().forEach(r => { const k = r.fy + '|' + r.q; by[k] = (by[k] || 0) + 1; });
      const e = Object.entries(by).sort((a, b) => b[1] - a[1])[0]; if (!e) return; const [fy, q] = e[0].split('|'); tdsGo(fy, q, '26Q'); tdsTabGo('deductions'); }"""),
    ("tds-return-deductees", """(cid) => { if (S.tdsFy) tdsTabGo('deductees'); }"""),
    ("gst-2b", """(cid) => { if (!S.books || !(S.books.vouchers || []).length) return; goClient('books:gst'); gstPartGo('r2b'); }"""),
    ("gst-input-register", """(cid) => { if (!S.books || !(S.books.vouchers || []).length) return; gstPartGo('inreg'); }"""),
    ("gst-itc-follow-up", """(cid) => { if (!S.books || !(S.books.vouchers || []).length) return; gstPartGo('follow'); }"""),
    ("gst-filed-vs-books", """(cid) => { if (!S.books || !(S.books.vouchers || []).length) return; gstPartGo('recon'); }"""),
]

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8249/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    cid = pg.evaluate(U.SEED, U.books()); pg.wait_for_timeout(1200)
    ids = pg.evaluate("(cid) => [cid].concat(Object.keys(S.data[cid].entries).filter(k => k.length > 6))", cid)
    pg.evaluate("(cid) => { const e = newEntry('raw-id.pdf'); e.x.vendorName = 'ZZ RAW ID CHECK'; e.x.invoiceNo = 'R-1'; e.x.invoiceDate = '2026-09-20'; e.x.total = 1180; S.data[cid].entries[e.id] = e; refreshStats(cid); }", cid)
    ids = pg.evaluate("(cid) => [cid].concat(Object.keys(S.data[cid].entries).filter(k => k.length > 6))", cid)
    tok = pg.evaluate("() => ['--st-done', '--st-attention', '--st-failed', '--st-waiting'].map(k => getComputedStyle(document.documentElement).getPropertyValue(k).trim())")
    ok(all(tok), "the colours of meaning are tokens: --st-done, --st-attention, --st-failed, --st-waiting (%s)" % tok)
    for name, js in U.PAGES:
        try: pg.evaluate(js)
        except Exception as e: ok(False, "%s: opens (%s)" % (name, str(e)[:80])); continue
        pg.wait_for_timeout(1300)
        t = pg.evaluate(TEXT)
        bad = [w for w in ("TDSDesk", "TDSDESK", "React") if w in t] + [i for i in ids if i in t]
        bad += re.findall(r"\bbuild \d+\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-", t)
        ok(not bad, "%s: no internal names, ids or build stamps (%s)" % (name, bad[:4]))
        west = re.findall(r"\b\d{1,3},\d{3},\d{3}\b", t)
        ok(not west, "%s: amounts in Indian form, never 1,250,000 (%s)" % (name, west[:3]))
        dates = re.findall(r"\b20\d\d-\d\d-\d\d\b|\b\d{1,2}/\d{1,2}/20\d\d\b|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec) 20\d\d\b", t)
        ok(not dates, "%s: dates as 04-Oct-2026 (%s)" % (name, dates[:3]))
        w = pg.evaluate(WIDE)
        ok(w["scroll"] <= 0 and not w["out"], "%s: no sideways scrolling at 1366 x 768 (%s)" % (name, w))
        # the Post to Tally page's own content is the other helper's (spec K: every page except it): its top bar only
        own = name == "post-to-tally"
        d = pg.evaluate(DISABLED, "#cobar button[disabled]" if own else "#app button[disabled], #cobar button[disabled]")
        ok(not d, "%s: every disabled button says why, on hover and beside it (%s)" % (name, d[:3]))
        pr = pg.evaluate(PRIMARY, "#cobar .btn.primary" if own else "#app .btn.primary, #cobar .btn.primary")
        ok(len(pr) <= 1, "%s: one primary button at most (%s)" % (name, pr))
        am = [] if own else pg.evaluate(AMOUNTS)
        badam = [a["s"] for a in am if not a["ok"]][:3]; left = [a["s"] for a in am if not a["right"]][:3]
        ok(not badam and not left, "%s: table amounts like 1,25,000.00 and right-aligned (%d checked; %s; left: %s)" % (name, len(am), badam, left))
        if not own:
            list_checks(pg, name)
            # round 3 (05-Oct-2026): no banner, notice or warning takes more than one row (the alerts are in the bell)
            tall = pg.evaluate("""() => [...document.querySelectorAll('#app .bk-alert, #app .bk-warn, #app .banner, #app .bk-setup, #app [data-notice-line], #app [data-alert-line]')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 40).map(e => e.innerText.replace(/\\s+/g, ' ').slice(0, 60))""")
            ok(not tall, "%s: every notice one row (%s)" % (name, tall[:2]))
            bare = BARE_TIME.findall(t)
            ok(not bare, "%s: time stamps say IST (%s)" % (name, bare[:3]))
    # the lists that are empty for the made-up client: some made-up rows, then the same checks
    for name, js in MORE:
        try: pg.evaluate(js, cid)
        except Exception as e: ok(False, "%s: opens (%s)" % (name, str(e)[:80])); continue
        pg.wait_for_timeout(1300)
        list_checks(pg, name)
        t = pg.evaluate(TEXT); bare = BARE_TIME.findall(t)
        ok(not bare, "%s: time stamps say IST (%s)" % (name, bare[:3]))
    # ---- one primary in every state of the books (CI on ad53eb7: with the copy empty, "Read the books from Tally" came
    # up as a second primary on Reports and Look up): each books page with the copy read, then with the copy empty
    def fresh_books():
        b = U.books()
        if b: return b
        import json, books_data   # the made-up books (tests/fixtures/books) when tests/data is not here
        return [json.load(open(books_data.CACHE)), {"map": {}, "twoBs": {}, "gstSet": {}, "itcTrack": {}}]
    FRESH = """([books, cid]) => { const [bk, g] = books; S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid});
      S.books.map = Books.mapLedgers(bk.vouchers, {}); Object.entries(g.map || {}).forEach(([l, m]) => { S.books.map[l] = Object.assign({n: l}, m); });
      S.books.twoBs = g.twoBs || {}; S.books.gstSet = {"09": g.gstSet || {}}; S.books.itcTrack = {"09": g.itcTrack || {}}; LedMaster.refresh(S.books); S.gstReg = "09"; render(); }"""
    EMPTY = """([books, cid]) => { S.books = {cid, loading: false, vouchers: [], meta: {}, challans: [], alloc: {}, map: {}}; render(); }"""
    BOOK_PAGES = [n for n in ("reports", "look-up", "letters", "mis", "accounts", "audit", "tds", "tds-gst", "from-tally-daybook") if n in dict(U.PAGES)]
    fb = fresh_books()
    for state, js in (("copy read", FRESH), ("copy empty", EMPTY)):
        for name in BOOK_PAGES:
            pg.evaluate(dict(U.PAGES)[name]); pg.wait_for_timeout(400)
            pg.evaluate(js, [fb, cid]); pg.wait_for_timeout(900)
            pr = pg.evaluate(PRIMARY, "#app .btn.primary, #cobar .btn.primary")
            prompt = pg.locator('#app button:has-text("Read the books from Tally")').count()
            ok(len(pr) <= 1 and (not prompt or pr == ["Read the books from Tally"]), "%s, %s: one primary at most, the prompt to read the books being it when shown (%s)" % (name, state, pr))
            if state == "copy empty" and name in ("reports", "look-up"):
                ok(prompt >= 1, "%s, copy empty: it asks to read the books from Tally" % name)
    pg.evaluate(FRESH, [fb, cid]); pg.wait_for_timeout(300)
    # the About line holds the build stamp
    pg.evaluate("() => goSettings(null)"); pg.wait_for_timeout(800)
    ab = pg.locator("[data-about]")
    ok(ab.count() == 1 and "FinCom" in ab.inner_text() and re.search(r"\d{2}-[A-Z][a-z]{2}-\d{4}", ab.inner_text()), "Settings: a small About line with the build (%s)" % (ab.inner_text() if ab.count() else ""))
    side = pg.inner_text("#side")
    ok("Build" not in side, "the sidebar no longer shows the build stamp")
    # messages: the common raw errors from the database, the network and Tally in plain words (what, why, what to do);
    # anything else a plain sentence with the raw words only behind "details"
    raw = ["duplicate key value violates unique constraint \"bill_items_pkey\"", "Failed to fetch", "JWT expired", "new row violates row-level security policy for table \"entries\"",
           "Could not find Ledger 'Rent Payable'", "Voucher totals do not match!", "TypeError: Cannot read properties of undefined (reading 'waiting')", "The bridge answered with error 502.", "PGRST301: zz"]
    m = pg.evaluate("(xs) => xs.map(x => plainError(x))", raw)
    for r, x in zip(raw, m):
        ok(x and x["text"] and r not in x["text"] and not re.search(r"pkey|JWT|PGRST|TypeError|row-level|error 502", x["text"]) and x["text"].endswith("."), "plain words for “%s”: %s" % (r[:40], x and x["text"]))
    ok(m[4]["text"].find("Rent Payable") >= 0, "Tally's missing ledger is named: " + m[4]["text"])
    ok(pg.evaluate("plainError('Saved 3 bills.')") is None, "a message already in plain words is left as it is")
    ok(m[6]["details"] and "Cannot read" in m[6]["details"], "the raw words kept for “details”")
    pg.evaluate("() => toast('Could not save: duplicate key value violates unique constraint \"x_pkey\"')"); pg.wait_for_timeout(200)
    tt = pg.inner_text("#toast")
    ok("pkey" not in tt and "duplicate key" not in tt and "details" in tt.lower(), "a toast with a raw error: plain words and a details link (%s)" % tt.replace("\n", " / "))
    # ---- round 2: times in IST (K5) on a computer whose clock is not on Indian time ----
    ny = br.new_context(viewport={"width": 1366, "height": 768}, timezone_id="America/New_York"); q = ny.new_page(); q.on("pageerror", lambda e: errors.append(str(e)))
    q.goto("http://localhost:8249/"); q.wait_for_timeout(2500); q.click('button[data-act="useOffline"]'); q.wait_for_timeout(1000)
    cid2 = q.evaluate(U.SEED, None); q.wait_for_timeout(800)
    f = q.evaluate("() => [fmtDateTime(Date.UTC(2026, 9, 4, 8, 35)), fmtTime(Date.UTC(2026, 9, 4, 8, 35)), fmtDateTime('2026-10-04T08:35:00Z'), fmtDateTime('2026-10-04 14:05:00'), fmtDateTime('2026-10-04'), fmtDateTime(new Date(Date.UTC(2026, 9, 3, 20, 0))), fmtDateTime(null)]")
    ok(f == ["04-Oct-2026 14:05 IST", "14:05 IST", "04-Oct-2026 14:05 IST", "04-Oct-2026 14:05 IST", "04-Oct-2026", "04-Oct-2026 01:30 IST", "—"],
       "one formatter for times, in IST whatever this computer's clock (a computer on New York time): %s" % f)
    q.evaluate(dict(MORE)["in-tally-log"], cid2); q.wait_for_timeout(1200)
    lt = q.inner_text("#app")
    ok("04-Oct-2026 14:05 IST" in lt and "03-Oct-2026 11:30 IST" in lt, "In Tally: the time each entry was sent, in IST (New York computer)")
    # ---- round 2: never a blank area while data loads (K7): a request held open, then "Loading…" or a skeleton ----
    HOLD = "() => { window.__held = new Promise(() => {}); }"
    cases = [
        ("opening a client", "(cid) => { S.loadingCo = true; S.view = 'company'; S.coId = cid; render(); }", "(cid) => { S.loadingCo = false; render(); }"),
        ("sales", "(cid) => { S.loadingCo = false; window.__bget = window.__bget || BankDB.get; BankDB.get = () => __held; S.sales = null; S.bank = null; goClient('sales'); }", None),
        ("bank", "(cid) => { S.bank = null; goClient('bank'); }", None),
        ("transactions, bank", "(cid) => { S.bank = null; goClient('txn'); txnTabGo('bank'); }", None),
        ("transactions, sales", "(cid) => { S.sales = null; S.bank = null; goClient('txn'); txnTabGo('sales'); }", "(cid) => { BankDB.get = window.__bget; S.sales = null; S.bank = null; render(); }"),
        ("books, reports", "(cid) => { window.__books = S.books; S.books = {cid, loading: true}; goClient('books:reports'); }", None),
        ("books, look up", "(cid) => { S.books = {cid, loading: true}; goClient('books:lookup'); }", None),
        ("GST settings", "(cid) => { S.books = {cid, loading: true}; goClient('books:gst'); }", "(cid) => { S.books = window.__books; render(); }"),
        ("In Tally, the postings", "(cid) => { S.firm.postLog = []; window.__cjl = CloudJobs.load; CloudJobs.load = () => {}; CloudJobs.busy = true; goStep('done', 'bills'); }", "(cid) => { CloudJobs.load = window.__cjl; CloudJobs.busy = false; render(); }"),
        ("help tickets", "(cid) => { window.__sup = [SUP.load, SUP.on]; SUP.load = () => __held; SUP.on = () => true; const s = SUP.st(); s.list = null; s.loading = false; s.tab = 'tickets'; s.open = null; s.newOpen = false; navHome('help'); }", "(cid) => { [SUP.load, SUP.on] = window.__sup; render(); }"),
    ]
    q.evaluate(HOLD)
    LOADING = """() => { const a = document.getElementById('app'); const l = [...a.querySelectorAll('[data-loading]')].filter(e => e.offsetParent);
      return {loading: l.length > 0 && l.some(e => /Loading/.test(e.innerText)), skel: l.some(e => e.querySelector('.skel')), text: a.innerText.trim().slice(0, 120)}; }"""
    for what, js, undo in cases:
        try: q.evaluate(js, cid2)
        except Exception as e: ok(False, "while %s loads: opens (%s)" % (what, str(e)[:100])); continue
        q.wait_for_timeout(700); r = q.evaluate(LOADING)
        ok(r["loading"] and r["skel"], "while %s loads: “Loading…” and a skeleton, not a blank area (%s)" % (what, r["text"][-90:].replace("\n", " / ")))
        if undo: q.evaluate(undo, cid2); q.wait_for_timeout(300)
    ny.close()
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
