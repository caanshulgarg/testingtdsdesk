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

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for k, f in [("A", part_a)]:
            if not ONLY or k in ONLY: f(br)
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % "; ".join(errors[:3]))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
