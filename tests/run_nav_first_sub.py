"""python3 run_nav_first_sub.py - next-nav-first-sub (04-Nov-2026; the owner: "When at the bank page, side bar flips then
submenu open after hovering over menu.. if click to main menu then it should reach to first submenu"). Offline, a made-up
client and statement (no real client):
  1. the Bank page's slim rail: a click on each main item opens that section's first page (Home -> Today, Clients -> All
     clients, Bank -> Bank statements, Purchase -> Bills to review, Sales -> Invoices, Transactions -> Purchase register,
     GST -> GSTR-1, TDS -> Returns, Reports -> Financial statements, Settings -> Firm settings, Help -> Help), and the
     menu then shows that page as the current one; no flyout is left open;
  2. Enter on a main item does the same; Space and the arrows still open the flyout (the other pages) and stay on Bank;
     hover still opens the flyout;
  3. a touch screen (no hover): a tap on a main item opens its first page;
  4. the open sidebar on another page (a client's Overview, then the firm's Today): a click and Enter on each item open
     its page, lit as the current one.
RED before the change: a click or Enter on a rail item only opened its flyout. Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_nav_first_sub.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8531
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

# a made-up client with a made-up statement of 30 lines
SETUP = """() => {
  const c = newCompany({name: "SAMPLE NAV TRADERS PVT LTD", gstin: "27AAACS0000A1Z5"}); c.bankAccounts = [{id: "a1", bank: "SAMPLE BANK", acct: "0001", ledger: "Sample Bank A/c"}];
  c.choices = {"bank:a1": {value: "Sample Bank A/c", state: "confirmed", by: "you", at: new Date().toISOString()}};
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const parties = ["ONE SUPPLIES", "TWO SERVICES", "THREE LOGISTICS"];
  let bal = 500000;
  const rows = Array.from({length: 30}, (_, i) => { const out = i % 3 !== 1, amt = 1000 + i * 37; bal += out ? -amt : amt;
    return {id: "r" + i, fp: "fp" + i, date: "2026-05-" + String(1 + (i % 28)).padStart(2, "0"), debit: out ? amt : 0, credit: out ? 0 : amt, balance: r2(bal),
      narr: "NEFT DR-" + parties[i % 3] + " REF " + (700000 + i), dec: {name: parties[i % 3], mode: "NEFT", utr: "REF" + (700000 + i)}, ledger: "", state: "attention", balOk: true, why: [], srcLabel: ""}; });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "SAMPLE BANK", acct: "0001", from: "2026-05-01", to: "2026-05-28", opening: 500000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "Sample Bank A/c", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {},
    filter: "all", grouped: false, showSettings: false, q: "", limit: 300, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
BACK = "() => { S.alertsOpen = false; S.addingCo = false; S.step = null; if (typeof closeSwitcher === 'function') closeSwitcher(); S.view = 'company'; goClient('bank'); if (B()) B().filter = 'all'; render(); }"
DASH = "() => { S.alertsOpen = false; S.addingCo = false; S.step = null; S.view = 'company'; goClient('dash'); render(); }"
VIS = "(s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }"
# the items lit as the current page: the sidebar's, or the rail's on the Bank page
LIT = "(() => { const s = [...document.querySelectorAll('#side .side-link[aria-current=page]')].filter(e => e.offsetParent !== null).map(e => e.dataset.side); if (s.length) return s; return [...document.querySelectorAll('.bkr [data-rail][aria-current=page]')].map(e => 'rail:' + e.dataset.rail); })()"
ANYFLY = "!!document.querySelector('[data-rail-flyout]')"

# each rail item: its first page, and the menu item lit there
FIRST = [
    ("home", "S.view === 'home' && S.homeTab === 'today'", "Today"),
    ("clients", "S.view === 'home' && S.homeTab === 'clients'", "Clients"),
    ("bank", "S.view === 'company' && S.tab === 'bank' && B().filter !== 'rules' && !!document.querySelector('#app [data-bank-grid]')", "rail:bank"),
    ("purchase", "S.view === 'company' && S.tab === 'invoices'", "Purchase"),
    ("sales", "S.view === 'company' && S.tab === 'sales'", "Sales"),
    ("txn", "S.tab === 'txn' && txnTab() === 'bills'", "Transactions"),
    ("gst", "S.tab === 'books' && booksTab() === 'gst' && S.gstView === 'return' && (S.gstPart === 'r1' || !gstParts(S.books).parts.some((x) => x[0] === 'r1'))", "GST"),
    ("tds", "S.tab === 'books' && booksTab() === 'tds' && S.tdsView === 'year'", "TDS"),
    ("reports", "S.tab === 'books' && booksTab() === 'fs'", "Statements"),
    ("settings", "S.view === 'home' && S.homeTab === 'rules' && !S.settingsTab", "Settings"),
    ("help", "S.view === 'home' && S.homeTab === 'help'", "Help"),
]
# the open sidebar: a client's items (from its Overview), then the firm's (from Today)
CLIENT_SIDE = ["Overview", "Purchase", "Bank", "Sales", "Transactions", "TDS", "GST", "Reconciliations", "From Tally", "Reports", "MIS", "My MIS",
               "Statements", "Audit", "Look up", "Letters", "Client setup", "Clients", "Help"]
FIRM_SIDE = ["Today", "Compliance", "Clients", "Tally", "Integrations", "Settings", "Help"]

def start(br, **kw):
    ctx = br.new_context(**kw)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1200)
    return ctx, pg

def landed(E, cond):
    return E("() => { try { return !!(%s); } catch (e) { return false; } }" % cond)

def rail_round(pg, how, shot=None):
    E, W = pg.evaluate, pg.wait_for_timeout
    for (k, cond, lit) in FIRST:
        E(BACK); W(700)
        if not E(VIS, ".bkr[data-bank-rail]"): ok(False, "%s: the rail on the Bank page" % how); return
        if shot and k == "home": pg.screenshot(path=shot)
        sel = '.bkr [data-rail="%s"]' % k
        if how == "click": pg.click(sel)
        elif how == "Enter": pg.focus(sel); W(150); pg.keyboard.press("Enter")
        else: pg.tap(sel)
        W(900)
        got = E(LIT)
        ok(landed(E, cond) and lit in (got or []) and not E(ANYFLY), "%s %s -> its first page, lit as current (%s)" % (how, k, got))

with sync_playwright() as p:
    br = p.chromium.launch()
    shot = os.environ.get("NAV_SHOT", "")
    ctx, pg = start(br, viewport={"width": 1440, "height": 900})
    E, W = pg.evaluate, pg.wait_for_timeout

    print("1. the rail on the Bank page: a click opens the first page")
    ok(E(VIS, ".bkr[data-bank-rail]") and not E(VIS, "#side"), "Bank: the slim rail")
    rail_round(pg, "click", shot)

    print("2. the keyboard; hover")
    rail_round(pg, "Enter")
    E(BACK); W(700)
    pg.focus('.bkr [data-rail="gst"]'); W(150); pg.keyboard.press(" "); W(300)
    ok(E(VIS, '[data-rail-flyout="gst"]') and E("document.activeElement && document.activeElement.dataset.railSub") == "gst:GSTR-1" and landed(E, "S.tab === 'bank'"),
       "Space on GST: its flyout, on its first page, still on Bank")
    pg.keyboard.press("ArrowDown"); W(100); pg.keyboard.press("Enter"); W(900)
    ok(landed(E, "S.tab === 'books' && booksTab() === 'gst' && S.gstView === 'return'"), "then ArrowDown, Enter: that flyout page")
    E(BACK); W(700)
    pg.hover('.bkr [data-rail="tds"]'); W(250)
    ok(E(VIS, '[data-rail-flyout="tds"]') and landed(E, "S.tab === 'bank'"), "hover TDS: its flyout, still on Bank")
    pg.hover('.bkr [data-rail="bank"]'); W(250)
    ok(E("(() => { const e = document.querySelector('[data-rail-flyout=bank] [aria-current=page]'); return e && e.dataset.railSub; })()") == "bank:Bank statements",
       "the Bank flyout lights Bank statements, the page shown")
    pg.mouse.move(900, 500); W(400)
    ctx.close()

    print("3. a touch screen: a tap opens the first page")
    ctx, pg = start(br, viewport={"width": 1024, "height": 768}, has_touch=True)
    rail_round(pg, "tap")
    ctx.close()

    print("4. the open sidebar on another page")
    ctx, pg = start(br, viewport={"width": 1440, "height": 900})
    E, W = pg.evaluate, pg.wait_for_timeout
    for how in ("click", "Enter"):
        for name in CLIENT_SIDE:
            E(DASH); W(600)
            sel = '#side .side-link[data-side="%s"]' % name
            if not E(VIS, sel): ok(False, "%s: %s in the sidebar" % (how, name)); continue
            if how == "click": pg.click(sel)
            else: pg.focus(sel); pg.keyboard.press("Enter")
            W(900)
            got = E(LIT) or []
            ok(name in got or (name == "Bank" and "rail:bank" in got), "%s %s (a client's sidebar) -> its page, lit (%s)" % (how, name, got))
        for name in FIRM_SIDE:
            E("() => { navHome('today'); }"); W(600)
            sel = '#side .side-link[data-side="%s"]' % name
            if not E(VIS, sel): ok(False, "%s: %s in the firm's sidebar" % (how, name)); continue
            if how == "click": pg.click(sel)
            else: pg.focus(sel); pg.keyboard.press("Enter")
            W(900)
            got = E(LIT) or []
            ok(name in got, "%s %s (the firm's sidebar) -> its page, lit (%s)" % (how, name, got))
    ctx.close()
    br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d fail(s)" % len(fails))
sys.exit(1 if fails else 0)
