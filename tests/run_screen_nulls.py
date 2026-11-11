"""python3 run_screen_nulls.py - Reports and Look up never show the error box on books with unusual data (the owner,
11-Nov-2026, a client linked to Tally: Reports "Cannot read properties of null (reading 'fy')", Look up "Cannot read
properties of undefined (reading 'map')").

  Reports: books with entries but no dates in their record (meta.from / meta.to empty, null or missing): the years come
           from the entries' own dates; with no dated entry either, one plain line instead of the year;
  Look up: an answer of each kind with a list missing (rows, groups, a group's rows, an entry's lines, noMaster), the
           ledger names with no list, groups or under, and a list of recent questions that is not a list: drawn, never
           the error box; an answer that cannot be drawn at all is said in its place and the question stays usable.
Run on the React build (app/dist-test, or TDSDESK_SITE)."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("NULLS_PORT") or 8379)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
books = json.load(open(CACHE))
SEED = """(books) => { S.firm.firmName = "Test Firm of Accountants";
  const c = newCompany({name: "Test Traders Private Limited", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c; c.stats = {};
  S.data[c.id] = {parties: {}, entries: {}, loaded: true}; S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  const b = Object.assign({loading: false, challans: [], alloc: {}}, books, {cid: c.id}); S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books);
  refreshStats(c.id); render(); return c.id; }"""
GUARD = "() => [...document.querySelectorAll('#app [data-guard], #app [data-lk-part-error]')].map((e) => e.innerText.slice(0, 200))"
# each case from a page drawn afresh (the screen's error box, once shown, stays until the page is drawn again)
FRESH = "() => { goClient('dash'); }"

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(1500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
        pg.wait_for_timeout(600); pg.evaluate(SEED, books); pg.wait_for_timeout(1200)
        meta = pg.evaluate("() => JSON.stringify({from: S.books.meta.from, to: S.books.meta.to})")

        print("Reports, books with no dates in their record")
        for name, js in [("from and to empty", "S.books.meta.from = ''; S.books.meta.to = '';"), ("from and to null", "S.books.meta.from = null; S.books.meta.to = null;"),
                         ("no meta at all", "delete S.books.meta;"), ("only from missing", "S.books.meta.from = null;"),
                         ("brought from FinCom's cloud, no from/to", "S.books.meta = {cloud: {book: 'b1', at: '2026-11-11T08:00:00Z'}, at: '2026-11-11T08:00:00Z'};")]:
            pg.evaluate(FRESH); pg.wait_for_timeout(300)
            pg.evaluate("(m) => { S.books.meta = Object.assign({}, JSON.parse(m)); " + js + " S.rptFy = null; S.rxView = null; goClient('books:reports'); }", meta); pg.wait_for_timeout(1500)
            g = pg.evaluate(GUARD)
            ok(not g and pg.locator("#app select[aria-label=Year]").count() == 1, "%s: drawn with its year chooser, no error box (%s)" % (name, g))
        pg.evaluate(FRESH); pg.wait_for_timeout(300)
        pg.evaluate("(m) => { S.books.meta = JSON.parse(m); S.books.meta.from = null; S.books.meta.to = null; S._v0 = S.books.vouchers; S.books.vouchers = S.books.vouchers.map((v) => Object.assign({}, v, {date: ''})); goClient('books:reports'); }", meta); pg.wait_for_timeout(1500)
        g = pg.evaluate(GUARD)
        ok(not g and pg.locator("#app [data-rpt-noyear]").count() == 1, "no dates anywhere: one plain line, no error box (%s)" % g)
        pg.evaluate("(m) => { S.books.vouchers = S._v0; S.books.meta = JSON.parse(m); RPT._span = null; render(); }", meta)

        print("Look up, lists missing")
        pg.evaluate("() => { S.lk = null; goClient('books:lookup'); }"); pg.wait_for_timeout(1200)
        ok(not pg.evaluate(GUARD), "Look up opens")
        cases = [
            ("ledger without rows", {"kind": "ledger", "src": "books", "led": "Cash", "from": "20250401", "to": "20260331", "open": 0, "close": 0, "dr": 0, "cr": 0}),
            ("group without rows", {"kind": "group", "src": "books", "grp": "Sundry Debtors", "from": "20250401", "to": "20260331", "dr": 0, "cr": 0}),
            ("trial balance without groups", {"kind": "tb", "src": "cloud", "asOn": "20260331", "rows": [], "dr": 0, "cr": 0}),
            ("trial balance, a group without rows", {"kind": "tb", "src": "cloud", "asOn": "20260331", "rows": [], "groups": [{"g": "Capital Account", "dr": 0, "cr": 0}], "dr": 0, "cr": 0}),
            ("months without rows", {"kind": "monthly", "src": "cloud", "led": "Cash", "from": "20250401", "to": "20260331", "dr": 0, "cr": 0}),
            ("bills without rows", {"kind": "bills", "src": "books", "led": "", "asOn": "20260331", "total": 0}),
            ("entries without rows", {"kind": "find", "src": "cloud", "q": "x", "from": "20250401", "to": "20260331", "total": 0}),
            ("an entry without its lines, opened", {"kind": "find", "src": "cloud", "q": "x", "from": "20250401", "to": "20260331", "total": 5, "n": 1, "rows": [{"id": "g1", "date": "20250501", "type": "Journal", "party": "A", "amt": 5}]}),
        ]
        for name, r in cases:
            pg.evaluate(FRESH); pg.wait_for_timeout(300); pg.evaluate("() => goClient('books:lookup')"); pg.wait_for_timeout(600)
            pg.evaluate("(r) => { const x = LK.st(); x.kind = r.kind; x.res = Object.assign({title: 'T'}, r); x.open = {g1: true}; render(); }", r); pg.wait_for_timeout(500)
            g = pg.evaluate(GUARD)
            ok(not g and pg.locator("#app .lk-res").count() == 1, "%s: drawn, no error box (%s)" % (name, g))
        pg.evaluate("() => { const x = LK.st(); x.res = {kind: 'ledger', title: 'T', get rows() { throw new TypeError('a broken answer'); }}; render(); }"); pg.wait_for_timeout(500)
        g = pg.evaluate("() => [...document.querySelectorAll('#app [data-lk-part-error]')].map((e) => e.innerText.slice(0, 200))")
        ok(len(g) == 1 and pg.locator("#app [data-guard]").count() == 0 and pg.locator("#lkAsk").count() == 1, "an answer that cannot be drawn: said in its place, the question still there (%s)" % g)
        for name, nm in [("no list, groups or under", "{}"), ("a list and under, no groups", "{leds: ['Cash'], under: {Cash: 'Cash-in-Hand'}}"), ("a list that is not a list", "{leds: {a: 1}, under: {}, groups: {}}")]:
            pg.evaluate(FRESH); pg.wait_for_timeout(300)
            pg.evaluate("() => { LK.st().res = null; LK.names = Object.assign({cid: S.coId, at: Date.now(), src: 'cloud'}, " + nm + "); goClient('books:lookup'); }"); pg.wait_for_timeout(600)
            for k in ["ledger", "group", "monthly", "find"]:
                pg.evaluate("(k) => { LK.st().kind = k; render(); }", k); pg.wait_for_timeout(200)
            ok(not pg.evaluate(GUARD), "ledger names, %s: Look up and each of its question's forms drawn (%s)" % (name, pg.evaluate(GUARD)))
        print("Look up and Reports, books from FinCom's cloud with no from/to and a names answer without groups")
        pg.evaluate(FRESH); pg.wait_for_timeout(300)
        pg.evaluate("() => { S.books.meta = {cloud: {book: 'b1', at: '2026-11-11T08:00:00Z'}, at: '2026-11-11T08:00:00Z'}; LK.names = {cid: S.coId, at: Date.now(), src: 'cloud', leds: ['Cash'], under: {Cash: ''}}; S.lk = null; goClient('books:lookup'); }"); pg.wait_for_timeout(1200)
        ok(not pg.evaluate(GUARD) and pg.locator("#lkAsk").count() == 1, "Look up drawn (%s)" % pg.evaluate(GUARD))
        pg.locator("button:text-is('Show')").first.click(); pg.wait_for_timeout(1200)
        ok(not pg.evaluate(GUARD), "and a question shown (%s)" % pg.evaluate(GUARD))
        pg.evaluate("() => { S.rptFy = null; goClient('books:reports'); }"); pg.wait_for_timeout(1500)
        ok(not pg.evaluate(GUARD) and pg.locator("#app select[aria-label=Year]").count() == 1, "Reports drawn with its year (%s)" % pg.evaluate(GUARD))
        pg.evaluate("(m) => { S.books.meta = JSON.parse(m); LK.names = null; render(); }", meta)
        pg.evaluate("() => { goClient('books:lookup'); }"); pg.wait_for_timeout(400)
        pg.evaluate("() => { LK.names = null; localStorage.setItem(LK.recentKey(), JSON.stringify({length: 2})); render(); }"); pg.wait_for_timeout(500)
        ok(not pg.evaluate(GUARD), "a list of recent questions that is not a list: drawn")
        pg.evaluate("() => { localStorage.setItem(LK.recentKey(), JSON.stringify([null, 'x', {kind: 'ledger', label: 'Cash'}])); render(); }"); pg.wait_for_timeout(500)
        ok(not pg.evaluate(GUARD) and pg.locator("#app .lk-recent button").count() == 1, "recent questions with bad items: the good one shown")
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to fetch" not in e and "broken answer" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
