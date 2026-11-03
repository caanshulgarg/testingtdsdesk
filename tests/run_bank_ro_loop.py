"""python3 run_bank_ro_loop.py - Sentry FINCOM-APP-STAGING-E (02/03-Nov-2026, Safari 26.6.2, client/bank): "… with …",
an onerror with no stack. The browser's own words were "ResizeObserver loop completed with undelivered notifications."
(the scrubber keeps only "with"): the spacious Bank layout's ResizeObservers (the page's box, the header, the bar at the
foot, the parts above the table) called fill() inside their callback, and fill() sets --bk-fill, which changes the height of
the very boxes they watch, in the same frame. Offline, a made-up statement (no real client):
  1. on the Bank page, the window's height and width changing, a filter row wrapping, the drawer and Compact: no
     "ResizeObserver loop" error reaches window.onerror (what Sentry's global handler reports);
  2. the table's box still fills the window after each change (fill() still runs, a frame later).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_ro_loop.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = 8531
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# window.onerror's messages, from before the app's first script (what Sentry's globalHandlersIntegration sees)
LISTEN = "window.__errs = []; window.addEventListener('error', (e) => { window.__errs.push(String(e.message || '')); }, true);"
SETUP = """() => {
  const c = newCompany({name: "DEMO TRADERS PVT LTD", gstin: "27AAACD0000A1Z5"}); c.bankAccounts = [{id: "a1", bank: "DEMO BANK", acct: "0001", ledger: "Demo Bank A/c"}];
  c.choices = {"bank:a1": {value: "Demo Bank A/c", state: "confirmed", by: "you", at: new Date().toISOString()}};
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const parties = ["ALPHA SUPPLIES", "BETA SERVICES PVT LTD", "GAMMA LOGISTICS", "DELTA OFFICE RENT"];
  const st = ["attention", "suggested", "ready", "sent"];
  let bal = 500000;
  const rows = Array.from({length: 60}, (_, i) => { const out = i % 3 !== 1, amt = 1000 + (i * 137) % 9000; bal += out ? -amt : amt; const s = st[i % 4];
    return {id: "r" + i, fp: "fp" + i, date: "2026-05-" + String(1 + (i % 28)).padStart(2, "0"), debit: out ? amt : 0, credit: out ? 0 : amt, balance: r2(bal),
      narr: "NEFT DR-" + parties[i % 4] + " INVOICE " + (500 + i), dec: {name: parties[i % 4], mode: "NEFT", utr: "REF" + (900000 + i)},
      ledger: s === "attention" ? "" : parties[i % 4], state: s, sentAt: s === "sent" ? "2026-05-30T10:00:00Z" : undefined, balOk: true, why: [], srcLabel: "Learnt"}; });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "DEMO BANK", acct: "0001", from: "2026-05-01", to: "2026-05-28", opening: 500000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "Demo Bank A/c", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {},
    filter: "all", grouped: false, showSettings: false, q: "", limit: 300, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
RO = "() => window.__errs.filter((m) => /ResizeObserver/.test(m))"
# the table's box reaches down to the bar at the foot (within a few px), as fill() makes it
FILLS = """() => { const box = document.querySelector('#app .bk-space .bk-tablewrap'); const v = document.documentElement.style.getPropertyValue('--bk-fill');
  return !!box && !!v && Math.abs(parseFloat(v) - box.getBoundingClientRect().height) < 4; }"""

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page(); pg.add_init_script(LISTEN)
    W = pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); pg.evaluate(OPEN); W(800); pg.evaluate(SETUP); W(1200)
    ok(pg.evaluate("() => document.documentElement.classList.contains('bk-spacious') && !!document.querySelector('#app [data-bank-grid]')"), "the Bank page in its spacious layout")
    ok(pg.evaluate(FILLS), "the table's box fills the window")
    # the window changing size, as a Mac's window does when dragged or zoomed: each step is a new size for #app, the header
    # and the rows above the table, all watched
    for (w, h) in [(1440, 700), (1100, 820), (900, 640), (1280, 1000), (1024, 760), (1440, 900)]:
        pg.set_viewport_size({"width": w, "height": h}); W(250)
    ok(pg.evaluate(FILLS), "after the window's size changes, the table's box still fills the window")
    # the filter row wrapping (a search, a chip) and the rows above the table changing height
    pg.fill("#app input[type=search]", "ALPHA"); W(400); pg.fill("#app input[type=search]", ""); W(400)
    # Compact and back (every row's height), a line's drawer
    for sel in ['#app [data-density="compact"]', '#app [data-density="comfortable"]']:
        if pg.locator(sel).count(): pg.click(sel); W(300)
    if pg.locator("#app [data-bank-grid] tbody tr td").count():
        pg.locator("#app [data-bank-grid] tbody tr").first.locator("td").nth(1).click(); W(400); pg.keyboard.press("Escape"); W(300)
    for (w, h) in [(1366, 768), (1440, 900)]:
        pg.set_viewport_size({"width": w, "height": h}); W(250)
    # what stands above the table changing height without the window changing (the one-line header wrapping, as its words
    # do in Safari's fonts, a notice coming or going): the case that raised the error (reproduced in Chromium too)
    for pad in ["30px", "", "12px", ""]:
        pg.evaluate("(p) => { document.querySelector('#app .bk-space > .bs-head').style.paddingBottom = p; }", pad); W(300)
        ok(pg.evaluate(FILLS), "the header %s: the table's box fills what the window leaves" % ("taller" if pad else "back"))
    pg.evaluate("() => { const b = document.querySelector('#app .bk-space > .bs-bar'); if (b) b.style.paddingTop = '24px'; }"); W(300)
    pg.evaluate("() => { const b = document.querySelector('#app .bk-space > .bs-bar'); if (b) b.style.paddingTop = ''; }"); W(300)
    ro = pg.evaluate(RO)
    ok(not ro, "no 'ResizeObserver loop' error reaches window.onerror (Sentry FINCOM-APP-STAGING-E)" + ("" if not ro else ": %d, %s" % (len(ro), ro[0])))
    ok(pg.evaluate(FILLS), "and the table's box still fills the window at the end")
    br.close()
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
