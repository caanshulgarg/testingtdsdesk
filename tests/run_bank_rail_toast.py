"""python3 run_bank_rail_toast.py - the message at the bottom (the toast) on the Bank page beside the bank's rail (html.bk-rail,
parts/bank/Rail.jsx): on a desktop it sat at left 12px, under the 72px rail, cut off, and its foot under the bar at the
foot of the page ("Posting waits…"). It must start right of the rail and end above the bar.
Offline, a made-up statement. Screenshot (deviceScaleFactor 2, 1440 wide) into SHOTS. UI_PORT (8495)."""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("UI_PORT") or 8495)
SHOTS = os.environ.get("SHOTS", "")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => {
  const c = newCompany({name: "ZZ Rail Client"}); c.bankAccounts = [{id: "a1", bank: "ZZ Bank", acct: "0001", ledger: "ZZ Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const rows = [0, 1, 2].map(i => ({id: "r" + i, fp: "fp" + i, date: "2026-09-0" + (i + 1), debit: 100 * (i + 1), credit: 0, balance: 1000 - 100 * (i + 1), narr: "UPI to ZZ Shop " + i, dec: {name: "ZZ Shop", mode: "UPI"}, ledger: "", state: "attention", balOk: true, why: []}));
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ZZ Bank", acct: "0001", from: "2026-09-01", to: "2026-09-03", opening: 1000, closing: 400, totDr: 600, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: [{name: "ZZ Bank", group: "Bank Accounts"}], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "",
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2); pg = ctx.new_page()
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1500)
    ok(pg.evaluate("document.documentElement.classList.contains('bk-rail')"), "the Bank page shows its rail (html.bk-rail)")
    pg.evaluate("() => toast('zz-statement.csv: 3 transactions. Choose the Tally ledger for this bank account.')"); pg.wait_for_timeout(500)
    rail = pg.evaluate("(() => { const r = document.querySelector('.bkr'); return r ? r.getBoundingClientRect().right : 72; })()")
    left = pg.evaluate("document.getElementById('toast').getBoundingClientRect().left")
    ok(left >= rail, "the message starts right of the rail (left %.0f, rail ends at %.0f)" % (left, rail))
    bottom = pg.evaluate("document.getElementById('toast').getBoundingClientRect().bottom")
    bar = pg.evaluate("(() => { const a = document.querySelector('.actionbar'); return a ? a.getBoundingClientRect().top : innerHeight; })()")
    ok(pg.locator(".actionbar").count() == 1 and "Posting waits" in pg.inner_text(".actionbar"), "the bar at the foot says posting waits")
    ok(bottom <= bar, "the message ends above the bar at the foot (bottom %.0f, bar starts at %.0f)" % (bottom, bar))
    # no new body:has(...) rule for it: the offsets come from CSS variables
    ok(pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--toast-left').trim()") == "84px", "the rail gives the message its left offset (--toast-left)")
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "bank-rail-toast.png"))
    br.close()
print("\n%d failed" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
