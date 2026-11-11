"""python3 run_mis_speed.py - MIS on made-up books of a large client's size (next-mis-speed, 09-Nov-2026: a client with
4,191 ledgers and 3,539 vouchers held Chrome in "Page Unresponsive" on its MIS page). The books: tests/mis_big_books.py
(about 4,190 ledgers in 157 groups, 3,700 vouchers with bills, openings and parties; written to tests/out/mis-big once),
Tally's balances for the year with 963 ledgers off. On the React build (app/dist-test):
  1. the ledger list matched again when the books come (ledgersChanged: 20 s in one task before, the masters counted at
     every exactLedger) and opening MIS with its run out of date, Run now and every tab: no task over 300 ms;
  2. the figures as before the change (result code 34B4A78C, sales, profit, owed, the 963 ledgers off Tally);
  3. Run now: a second click while a run is pending is ignored; a client changed during the run stops it, and nothing is
     written to either client's books;
  4. FinCom's cloud copy (Tally's closings blank): no "differ from Tally" line at all.
Under the lock: flock /tmp/fincom-app.lock python3 tests/run_mis_speed.py (MIS_SPEED_MAX to change the 300 ms)"""
import os, sys, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
DATA = os.path.join(HERE, "out", "mis-big")
MAX = int(os.environ.get("MIS_SPEED_MAX") or 300)
if not os.path.exists(os.path.join(DATA, "Master.xml")): subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), DATA], check=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8466), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async () => {
  try { Live.stop(); } catch (e) {}
  const c = newCompany({name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3"});
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  const get = async u => new Blob([await (await fetch(u)).arrayBuffer()], {type: "text/xml"});
  const ms = await Books.importMasters(await get("/__big/Master.xml")), db = await Books.importDayBook(await get("/__big/DayBook.xml"));
  const b = Object.assign({loading: false, challans: [], alloc: {}}, {vouchers: db.vouchers, meta: db.meta}, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans});
  b.map = Books.mapLedgers(b.vouchers, {}); S.books = b; LedMaster.refresh(b);
  S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "import"; render();
  // Tally's own balances for the year: every ledger, 963 of them off by a made-up amount
  const from = "20250401", to = "20260331", mv = MIS.moves(from, to), names = Object.keys(ms.info).sort(); let k = 0;
  TallyRead.balances(b, {ledgers: names.map((n, i) => { const op = ms.info[n].ob || 0, off = (i % 4 === 1 && k < 963) ? (k++, 100 + (i % 37) * 11) : 0;
    return {name: n, parent: ms.info[n].group, open: String(op), close: String(Math.round((op + ((mv[n] || {}).t || 0) + off) * 100) / 100)}; })}, from, to);
  S.misRange = {from: "2025-04-01", to: "2026-03-31"};
  return {vouchers: b.vouchers.length, ledgers: names.length, cid: c.id};
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({type: 'longtask', buffered: true}); } catch (e) {}")
    pg.route("**/__big/*", lambda route: route.fulfill(path=os.path.join(DATA, route.request.url.rsplit("/", 1)[1]), content_type="text/xml"))
    pg.goto("http://localhost:8466/"); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    info = pg.evaluate(SETUP); pg.wait_for_timeout(3000)
    print("books: %d vouchers, %d ledgers" % (info["vouchers"], info["ledgers"]))
    def step(name, js, wait=2500):
        pg.evaluate("window.__lt = []")
        pg.evaluate("() => new Promise(res => setTimeout(() => { (" + js + ")(); res(); }, 0))"); pg.wait_for_timeout(wait)
        lt = pg.evaluate("window.__lt.slice()"); worst = max(lt) if lt else 0
        ok(worst <= MAX, "%s: longest task %d ms (%s)" % (name, worst, lt[:6]))
    print("\n1. No task over %d ms" % MAX)
    step("the ledger list matched again (ledgersChanged)", "() => ledgersChanged(%r)" % info["cid"])
    step("Run now (none worked out yet)", "() => { S.misTab = 'summary'; S.booksTab = 'mis'; render(); document.querySelector('section[data-mis-head] button.primary').click(); }", 4000)
    ok(pg.evaluate("!!(S.books.mis && S.books.mis.last)"), "the run is there")
    step("MIS opened with its run out of date", "() => { S.booksTab = 'import'; render(); S.books.mis.last.basis = 'x'; S.booksTab = 'mis'; render(); }", 5000)
    for t in ["pl", "recv", "pay", "sales", "purch", "cash", "ratios", "regs", "cc", "budget", "comp", "summary"]: step("tab " + t, "() => misTabGo('%s')" % t)
    print("\n2. The figures as before")
    f = pg.evaluate("(({code, sales, pl, recv, pay, control}) => ({code, sales: sales.total, pbt: pl.pbt.t, owed: recv.sum.owe, owe: pay.sum.owe, n: control && control.n, amt: control && control.amt}))(S.books.mis.last)")
    ok(f == {"code": "34B4A78C", "sales": 115825858, "pbt": 76728852, "owed": 175748856.78, "owe": 52316134.18, "n": 963, "amt": 286787}, "result code 34B4A78C, sales 11,58,25,858, profit 7,67,28,852, owed 17,57,48,856.78 / 5,23,16,134.18, 963 ledgers off Tally by 2,86,787: %s" % f)
    ok("963 ledgers differ from Tally by ₹2,86,787.00" in pg.inner_text("#app"), "the line under the head says so")
    print("\n3. Run now: one at a time, and only for the books it began on")
    r = pg.evaluate("""() => new Promise(res => {
      const A = S.books, at = A.mis.last.at, real = MIS.runIn, saves = []; let runs = 0;   // next-speed-render: the run is MIS.runIn's steps
      MIS.runIn = function(){ runs++; return real.apply(this, arguments); };
      const save = Books.save; Books.save = function(cid, x){ saves.push([cid, Object.keys(x || {}).length]); return save.apply(this, arguments); };
      const btn = () => document.querySelector('section[data-mis-head] button.primary');
      btn().click(); btn().click();                      // a second click while the first run is pending: ignored
      setTimeout(() => res({runs, saves, again: MIS._again, how: A.mis.last.how, changed: A.mis.last.at !== at}), 3000);
      window.__restore = () => { MIS.runIn = real; Books.save = save; };
    })""")
    pg.evaluate("window.__restore()")
    ok(r["runs"] == 1 and r["changed"] and not r["again"] and len(r["saves"]) == 1, "two clicks: one run, one save, MIS._again cleared (%s)" % {k: r[k] for k in ("runs", "saves", "again", "changed")})
    r = pg.evaluate("""() => new Promise(res => {
      const A = S.books, at = A.mis.last.at, real = MIS.runIn, saves = []; let runs = 0;   // next-speed-render: the run is MIS.runIn's steps
      MIS.runIn = function(){ runs++; return real.apply(this, arguments); };
      const save = Books.save; Books.save = function(cid, x){ saves.push(cid); return save.apply(this, arguments); };
      const c2 = newCompany({name: "Wrenfield Made-up Traders LLP", gstin: "07AAJFW1234K1Z5"}); S.companies[c2.id] = c2; S.data[c2.id] = {parties: {}, entries: {}, loaded: true};
      const B = {cid: c2.id, loading: false, vouchers: [], meta: {}, challans: [], alloc: {}};
      // the client changed during the run: at the end of its first task (the GST workings), before the next
      const g = MIS.gst3b; let sw = 0;
      MIS.gst3b = function(){ if (!sw++) queueMicrotask(() => { S.books = B; S.coId = c2.id; render(); }); return g.apply(this, arguments); };
      document.querySelector('section[data-mis-head] button.primary').click();
      setTimeout(() => { res({runs, saves, sw: sw > 0, bMis: !!B.mis, aSame: A.mis.last.at === at, again: MIS._again, still: S.books === B, cidA: A.cid, cidB: B.cid}); MIS.gst3b = g; MIS.runIn = real; Books.save = save; S.books = A; S.coId = A.cid; render(); }, 3000);
    })""")
    ok(r["sw"] and r["runs"] == 0 and not r["bMis"] and r["cidB"] not in r["saves"] and r["cidA"] not in r["saves"] and r["aSame"] and r["still"] and not r["again"],
       "client changed during the run: it stops; nothing written to either client's books (%s)" % r)
    print("\n4. FinCom's cloud copy: no line about Tally")
    pg.evaluate("() => { const t = S.books.tb; t.src = 'copy'; Object.values(t.led).forEach(x => { x.close = 0; }); S.books.mis.last.basis = 'x'; render(); }"); pg.wait_for_timeout(5000)
    txt = pg.inner_text("#app")
    ok(pg.evaluate("S.books.mis.last.control") is None and "differ from Tally" not in txt and "agrees with Tally" not in txt and "through the bridge" not in txt, "no check and no line when Tally's closings are not known")
    ok(not errors, "no page error %s" % errors[:2])
    br.close()
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
