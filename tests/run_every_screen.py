"""python3 run_every_screen.py - every screen opens without the error box (the owner, 11-Nov-2026: Look up showed "This part
of the page could not be shown" after the one-screen parts moved out of legacy.js into their screens' files).

Opened in the page, one after another as a person would (the sidebar, then each screen's own tabs), for:
  A. a client with its books read in (the fixture books), not signed in, no bridge;
  B. a client with no books;
  C. the client with books, on a phone's width;
and on each screen, then on each tab of it (every [role=tab] and part button the screen draws):
  - no error box (Guard's [data-guard]) and no screen whose file failed ([data-lazy-failed]);
  - no page error and no "could not be drawn" in the console;
  - a screen reached from another (Look up, a client's sub-pages, Settings' sections, drill-downs) has a "← Back" that
    returns to the screen it was opened from (or, with no history, to its parent).
Run on the React build (app/dist-test, or TDSDESK_SITE)."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("EVERY_PORT") or 8377)
ONLY = os.environ.get("EVERY_ONLY", "")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
books = json.load(open(CACHE))

SEED = """([books, withBooks]) => { S.firm.firmName = "Test Firm of Accountants";
  const c = newCompany({name: "Test Traders Private Limited", gstin: "07AAGCL4827M1Z3"}); c.tan = "DELT12345A"; S.companies[c.id] = c; c.stats = {};
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  if (withBooks) { const b = Object.assign({loading: false, challans: [], alloc: {}}, books, {cid: c.id}); S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books); }
  else S.books = {cid: c.id, loading: false, vouchers: [], ledgers: [], challans: [], alloc: {}, map: {}};
  refreshStats(c.id); Store.saveFirm(); Store.saveCompany(c);
  if (withBooks && typeof saveBooks === "function") saveBooks(); render(); return c.id; }"""

# the screens, as the app's own navigation opens them (goClient, navHome, goSettings; src/js/27). [name, js, parent]:
# parent is the screen "← Back" returns to with no history (None: a top-level screen, no Back needed)
CLIENT = [["Overview", "goClient('dash')", None], ["Inbox", "goClient('inbox')", None], ["Transactions", "goClient('txn')", None],
  ["Purchase", "goClient('bills')", None], ["Bank", "goClient('bank')", None], ["Sales", "goClient('sales')", None],
  ["Post to Tally", "goClient('post')", None]] + [["Books " + t, "goClient('books:%s')" % t, None] for t in
  ["import", "tds", "gst", "recon", "reports", "mis", "mymis", "fs", "audit", "tieout", "lookup", "letters", "ledgers", "corp", "corp-forms", "corp-docs", "corp-aoc4"]] + \
  [["Client setup " + t, "S.step = null; S.tab = '%s'; render()" % t, None] for t in
  ["settings", "cotally", "cotds", "deductees", "gstset", "bankset", "bankrules", "coclosed", "cosheets", "coremove"]]
HOME = [["Today", "navHome('today')"], ["Compliance", "navHome('compliance')"], ["Clients", "navHome('clients')"], ["Tally", "navHome('tally')"],
  ["Integrations", "navHome('integrations')"], ["Help", "navHome('help')"], ["Inbox (all clients)", "navHome('inbox')"], ["Settings", "goSettings(null)"],
  ["Settings account", "goSettings('account')"], ["Settings plan", "goSettings('plan')"], ["Settings closed", "goSettings('closed')"]]

ERR_JS = """() => ({guard: [...document.querySelectorAll('[data-guard]')].map((e) => e.innerText.slice(0, 300)),
  lazy: document.querySelectorAll('[data-lazy-failed]').length, caught: (window.__drawn || []).splice(0)})"""
# Guard logs "[FinCom] <part> could not be drawn: <error>" (app/src/Guard.jsx); kept here with the error's own words
WATCH = """() => { window.__drawn = []; const e = console.error; console.error = function (...a) {
  try { if (String(a[0]).includes('could not be drawn')) window.__drawn.push(String(a[0]) + ' ' + String(a[1] && (a[1].stack || a[1].message || a[1])).slice(0, 600)); } catch (x) {} return e.apply(this, a); }; }"""

def start(pg):
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    pg.wait_for_timeout(600); pg.evaluate(WATCH)

def settle(pg, ms=900):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('[data-loading-page], .react-loading')", timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(250)

def check(pg, where, perr):
    st = pg.evaluate(ERR_JS); pe = [e for e in perr if "supabase" not in e.lower() and "Failed to fetch" not in e]; perr.clear()
    bad = st["guard"] or st["lazy"] or st["caught"] or pe
    ok(not bad, where + ("" if not bad else ": " + " | ".join((st["caught"] or []) + pe + st["guard"] + (["a screen's file failed"] if st["lazy"] else []))[:900]))
    return not bad

# the screen's own tabs (every role=tab and every part button), clicked one by one; their labels first, the page redrawn
TABS_JS = """() => [...document.querySelectorAll('#app main [role=tab], #app main nav [data-part], #app main [data-settings-sec]')].filter((b) => b.offsetParent)
  .map((b) => (b.getAttribute('data-part') ? '[data-part="' + b.getAttribute('data-part') + '"]' : null) || b.innerText.trim()).filter(Boolean).slice(0, 24)"""
def tabs(pg, where, perr):
    try: labels = pg.evaluate(TABS_JS)
    except Exception: labels = []
    for l in labels:
        loc = pg.locator("#app main " + l) if l.startswith("[") else pg.locator("#app main [role=tab]", has_text=l)
        if not loc.count(): continue
        try: loc.first.click(timeout=3000)
        except Exception: continue
        settle(pg, 500); check(pg, where + " > " + l.replace("[data-part=", "part ").rstrip("]"), perr)

HASH = "() => Route.of()"
# the header's "← Back" (app/src/parts/back.jsx): there, and it returns to the page it was opened from
def back_check(pg, where, before):
    btn = pg.locator("header.top [data-back-page]")
    if not btn.count() or not btn.first.is_visible(): ok(False, where + ": a visible ← Back in the page header"); return
    btn.first.click(); settle(pg, 500)
    ok(pg.evaluate(HASH) == before, where + ": ← Back returns to the page before (%s, wanted %s)" % (pg.evaluate(HASH), before))

# a client's books as some arrive from FinCom's cloud (the owner's client, 11-Nov-2026): no dates in their record and a
# ledger names answer without its groups
ODD = "() => { if (!S.books) return; S.books.meta = {cloud: {book: 'b1', at: '2026-11-11T08:00:00Z'}, at: '2026-11-11T08:00:00Z'}; LK.names = {cid: S.coId, at: Date.now(), src: 'cloud', leds: ['Cash'], under: {Cash: ''}}; render(); }"

def run(br, name, with_books, phone=False, odd=False):
    print(name)
    ctx = br.new_context(viewport={"width": 390, "height": 844} if phone else {"width": 1440, "height": 900}, accept_downloads=True)
    pg = ctx.new_page(); perr = []
    pg.on("pageerror", lambda e: perr.append("page error: " + str(e)))
    start(pg); cid = pg.evaluate(SEED, [books, with_books]); settle(pg, 1500)
    if odd: pg.evaluate(ODD); settle(pg, 300)
    check(pg, name + ": the client's Overview", perr)
    for label, js, _ in CLIENT:
        if ONLY and ONLY not in label: continue
        pg.evaluate("() => goClient('dash')"); settle(pg, 300)
        before = pg.evaluate(HASH)
        pg.evaluate("() => { " + js + "; }"); settle(pg)
        if pg.evaluate(HASH) == before: continue    # (a page this client does not have: Corporate for a firm that is not a company)
        if check(pg, name + ": " + label, perr):
            back_check(pg, name + ": " + label, before)
            if not phone: pg.evaluate("() => { " + js + "; }"); settle(pg); tabs(pg, name + ": " + label, perr)
    for label, js in HOME:
        if ONLY and ONLY not in label: continue
        pg.evaluate("() => navHome('today')"); settle(pg, 300)
        before = pg.evaluate(HASH)
        pg.evaluate("() => { " + js + "; }"); settle(pg)
        if check(pg, name + ": " + label, perr):
            if pg.evaluate(HASH) != before: back_check(pg, name + ": " + label, before)
            if not phone: pg.evaluate("() => { " + js + "; }"); settle(pg); tabs(pg, name + ": " + label, perr)
    if not phone and not ONLY:
        # with no step back in this tab (a page opened from a link, or a reload): the page above it
        for h, up in [("#/c/%s/books/lookup" % cid, "#/c/%s/dash" % cid), ("#/c/%s/books/reports" % cid, "#/c/%s/dash" % cid), ("#/c/%s/dash" % cid, "#/clients"),
                      ("#/settings/plan", "#/settings"), ("#/compliance", "#/today")]:
            pg.goto("about:blank"); pg.goto(URL + h); pg.wait_for_timeout(1500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof S === 'object' && S && S.firm && typeof Route === 'object' && Route.ready) ? r() : setTimeout(go, 50); go(); })")
            if odd: pg.evaluate(ODD)
            settle(pg); pg.evaluate(WATCH)
            check(pg, name + ": opened at " + h.replace(cid, "<client>"), perr)
            back_check(pg, name + ": opened at " + h.replace(cid, "<client>") + ", no history", up)
        # the error box: "← Back" to the page before, and Reload
        pg.evaluate("() => goClient('dash')"); settle(pg, 300); before = pg.evaluate(HASH)
        pg.evaluate("() => { window.__rr = LK.st; LK.st = () => { throw new Error('a test of the error box'); }; goClient('books:lookup'); }"); settle(pg)
        box = pg.locator("#app [data-guard]")
        ok(box.count() == 1 and box.locator("[data-guard-back]").count() == 1 and box.locator("[data-guard-reload]").count() == 1, name + ": the error box has ← Back and Reload")
        pg.evaluate("() => { LK.st = window.__rr; }")
        if box.locator("[data-guard-back]").count(): box.locator("[data-guard-back]").click(); settle(pg, 500)
        ok(pg.evaluate(HASH) == before and pg.locator("#app [data-guard]").count() == 0, name + ": the error box's ← Back returns to the page before (%s)" % pg.evaluate(HASH))
        pg.evaluate("() => { window.__drawn = []; }"); perr.clear()
    ctx.close()


try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        run(br, "A. a client with books", True)
        run(br, "B. a client with no books", False)
        run(br, "C. a client with books, on a phone", True, phone=True)
        run(br, "D. books from FinCom's cloud with no dates in their record, a names answer without groups", True, odd=True)
        br.close()
finally:
    srv.shutdown()
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
