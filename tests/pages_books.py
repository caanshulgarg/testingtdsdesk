"""python3 pages_books.py SITE OUT.json [PORT] - the Books tabs other than TDS and GST (From Tally, Tally ledgers, MIS,
Accounts, Audit) with the books in tests/data, as text, into OUT.json, for comparing two builds (see pages_gst.py)."""
import json, os, sys, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8185
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
res, errors = {}, []
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append("same key: " + m.text[:120]) if "same key" in m.text else None)
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "import"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    def grab(name, wait=300):
        pg.wait_for_timeout(wait)
        res[name] = re.sub(r"\s+", " ", pg.evaluate("document.getElementById('app').innerText")).strip()
    # From Tally: as brought in, with parts, a trial balance and dates chosen, and with nothing
    pg.evaluate("() => { S.booksTab = 'import'; render(); }"); grab("import")
    pg.evaluate("() => { S.books.meta = Object.assign({}, S.books.meta, {parts: [{from: '20250401', to: '20250930', n: 1200, file: 'db1.xml', at: '2026-01-02T10:00:00Z', bridge: 'filled', cloud: 'in the cloud'}, {from: '20251101', to: '20260331', n: 900, file: 'db2.xml', at: '2026-01-03T10:00:00Z'}]}); S.books.tb = {source: 'tb.xml', led: {A: 1, B: 2}, openAsOn: '20250331'}; S.books.ledInfoAt = '2026-01-04T00:00:00Z'; S.books.ledInfo = {A: {}, B: {}}; S.dbFrom = '2025-10-01'; S.tbOn = '2025-03-31'; render(); }"); grab("import-parts")
    pg.evaluate("() => { S.tallyCopy = {time: '03:00', at: '2026-01-05T02:00:00', from: '20250401', to: '20260104', months: ['1','2'], schedule: {on: true, next: '2026-01-06 03:00'}}; render(); }"); grab("import-copy")
    pg.evaluate("() => { S.books.tbCheck = {ok: true, ledgers: 412, on: '20260331'}; render(); }"); grab("import-ready")
    pg.evaluate("() => { S.books.tbCheck = {ok: false, n: 12, on: '20260331', list: Array.from({length: 12}, (_, i) => ['Ledger ' + i, -1000 * i, -900 * i, 100 * i])}; S.tbCheckOn = '2026-03-31'; render(); }"); grab("import-mismatch")
    pg.evaluate("() => { S.books.tbCheck = {ok: false, n: 0, list: [], on: '20270101', why: 'The trial balance is as on 01 Jan 2027, outside the books here.'}; render(); }"); grab("import-why")
    # Tally ledgers: each list, a search, a ledger's meaning changed, a TDS ledger, and what FinCom posts to
    for v in ["pending", "gst", "tds", "done", "other", "post"]:
        pg.evaluate("(v) => { S.booksTab = 'ledgers'; S.lmView = v; S.ledQ = ''; render(); }", v); grab("led-" + v)
    pg.evaluate("() => { S.lmView = 'gst'; S.ledQ = 'igst'; render(); }"); grab("led-find")
    pg.evaluate("() => { const n = Object.keys(S.books.map).find(k => LedMaster.isGst(S.books.map[k].what)); if (n){ const m = S.books.map[n]; m.side = 'output'; m.byHand = true; m.ok = true; S.books.mapV = (S.books.mapV || 0) + 1; } S.ledQ = ''; render(); }"); grab("led-changed")
    pg.evaluate("() => { const n = Object.keys(S.books.map).find(k => !LedMaster.taxLike(k, S.books.map[k], (S.books.ledInfo || {})[k])); if (n){ const m = S.books.map[n]; LedMaster.applyWhat(m, 'tds_payable'); m.section = '194J'; m.rate = 10; m.ok = true; } S.lmView = 'tds'; render(); }"); grab("led-tds")
    # Audit: not run yet, run for the year, an area, a finding opened with a status and note, related parties, the 3CD draft
    pg.evaluate("() => { S.booksTab = 'audit'; S.auditTab = 'find'; S.books.audit = null; S.books.stale = {}; render(); }"); grab("audit-none")
    pg.evaluate("() => { const dr = Audit.defaultRange(S.books); Audit.run(dr.from, dr.to, 'by hand'); S.books.audit.last.at = '2026-01-10T10:00:00.000Z'; render(); }"); grab("audit-run", 800)
    pg.evaluate("() => { const f = S.books.audit.last.findings[0]; if (f){ S.auditOpen = f.id; S.auditArea = f.area; const au = S.books.audit; au.st = au.st || {}; au.st[f.id] = {s: 'pass', note: 'to reverse', at: '2026-01-10'}; } render(); }"); grab("audit-open")
    pg.evaluate("() => { S.auditArea = ''; S.auditSt = 'open'; S.auditOpen = ''; render(); }"); grab("audit-status")
    pg.evaluate("() => { S.auditSt = ''; S.auditTab = 'rel'; S.books.auditRel = [{name: Object.keys(S.books.map)[0], relation: 'Director'}]; render(); }"); grab("audit-rel")
    pg.evaluate("() => { S.auditTab = '3cd'; render(); }"); grab("audit-3cd")
    pg.evaluate("() => { S.auditTab = 'find'; render(); }")
    # MIS: before a run, each tab after a run, with rows opened, filters, a budget
    pg.evaluate("() => { S.booksTab = 'mis'; S.books.mis = null; S.misRange = null; S.misTab = 'summary'; S.books.stale = {}; render(); }"); grab("mis-none")
    pg.evaluate("() => { const dr = Audit.defaultRange(S.books); MIS.run(Audit.iso(dr.from), Audit.iso(dr.to), 'run now'); S.books.mis.last.at = '2026-01-10T10:00:00.000Z'; render(); }"); grab("mis-summary", 800)
    for t in ["pl", "recv", "pay", "sales", "purch", "cash", "ratios", "regs", "cc", "budget", "comp"]:
        pg.evaluate("(t) => { S.misTab = t; S.misQ = ''; S.misF = ''; render(); }", t); grab("mis-" + t)
    pg.evaluate("() => { S.misTab = 'pl'; S.misOpenHead = 'exp'; const H = S.books.mis.last.pl.heads.exp; S.misLed = H && H.led[0] ? H.led[0].l : ''; render(); }"); grab("mis-pl-open")
    pg.evaluate("() => { S.misTab = 'recv'; S.misLed = ''; const p = S.books.mis.last.recv.rows[0]; S.misOpen = p ? p.party : ''; render(); }"); grab("mis-recv-open")
    pg.evaluate("() => { S.misF = '90'; render(); }"); grab("mis-recv-90")
    pg.evaluate("() => { S.misF = ''; const p = S.books.mis.last.recv.rows[1]; S.misQ = p ? p.party.slice(0, 4) : 'a'; render(); }"); grab("mis-recv-q")
    pg.evaluate("() => { S.misTab = 'pay'; S.misQ = ''; const p = S.books.mis.last.pay.rows[0]; if (p){ S.books.msme = {[p.party]: 'Micro'}; const r = S.books.mis.last; MIS.run(r.from, r.to, r.how); S.books.mis.last.at = '2026-01-10T10:00:00.000Z'; } S.misF = 'msme'; render(); }"); grab("mis-pay-msme")
    pg.evaluate("() => { S.misTab = 'purch'; S.misF = ''; S.misQ = 'a'; render(); }"); grab("mis-purch-q")
    pg.evaluate("() => { S.misTab = 'cash'; S.misQ = ''; const x = S.books.mis.last.p2.cash.rows[0]; S.misCf = x ? x.sec + '|' + x.lab : ''; S.misWeek = 0; render(); }"); grab("mis-cash-open")
    pg.evaluate("() => { S.misTab = 'budget'; const r = S.books.mis.last, fy = Audit.fyStart(r.to).slice(0, 4); S.books.budget = {[fy]: {rev: {[fy + '04']: 100000, [fy + '05']: 120000}, exp: {[fy + '04']: 20000}}}; render(); }"); grab("mis-budget-filled")
    pg.evaluate("""() => { const r = S.books.mis.last, ms = r.pl.months; r.p2.cc = {read: true, cats: ['Primary', 'Sites'], cover: {inc: 80, exp: null}, un: {inc: 1200, exp: 300}, rows: [{name: 'Noida', cat: 'Sites', first: '20260405', last: '20260620', inc: 50000, exp: 60000, profit: -10000, margin: -20, led: {Rent: 40000, Salary: 20000}}, {name: 'Head office', cat: 'Primary', first: '20260401', last: '20260630', inc: 0, exp: 5000, profit: -5000, margin: null, led: {Power: 5000}}]};
      r.p2.regs = [{gstin: '09AANFG3202D1ZR', reg: 'UP', sales: 100000, purch: 40000, gstPay: 9000, months: ms, m: {[ms[0]]: {s: 60000}}}, {gstin: '07AANFG3202D1ZQ', reg: 'Delhi', sales: 50000, purch: 10000, gstPay: 4000, months: ms, m: {[ms[1]]: {s: 50000}}}]; S.misTab = 'regs'; render(); }"""); grab("mis-regs-two")
    pg.evaluate("() => { S.misTab = 'cc'; render(); }"); grab("mis-cc-rows")
    pg.evaluate("() => { S.misCc = 'Sites|Noida'; S.misCat = 'Sites'; render(); }"); grab("mis-cc-open")
    pg.evaluate("() => { S.misTab = 'summary'; S.misRange = {from: '2025-04-01', to: '2025-06-30'}; render(); }"); grab("mis-range")
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
