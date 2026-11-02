"""python3 run_bank_dec_heal.py - bank lines kept without their reading never break the Bank page (FINCOM-APP-STAGING-D,
31-Oct-2026: "TypeError: Cannot read properties of undefined" in the Particulars cell, bankParty(r) reading r.dec).
Cause: repairing a statement (src/js/21 fixBreaks) put copies of the re-read lines into the statement (spliceMissing) but
gave each its id, reading (dec) and state on the originals, so the lines kept (here and in the cloud's bank_rows) had none.
Made-up rows only. Checked:
(1) spliceMissing returns as `added` the very lines it put into the rows, so what fixBreaks fills in is what is kept;
(2) a statement holding lines with no id, dec or state (as kept by the old repair) opens: no page error, each such line is
    read (dec from its narration, state attention, an id of its own), its party shows in Particulars, and it is kept so
    (the statement's counts have no "undefined").
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_dec_heal.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8412), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SPLICE = r"""() => {
  // balances 1000 -> 900 -> (missing: -50 -> 850) -> 800; the line after the gap fails the running balance
  const rows = [
    {id: "s-0", fp: "a", date: "2026-01-02", debit: 100, credit: 0, balance: 900, narr: "UPI/DR/111/DEMO SHOP/x@y", balOk: true, dec: {mode: "UPI", name: "DEMO SHOP"}, state: "attention"},
    {id: "s-1", fp: "b", date: "2026-01-04", debit: 50, credit: 0, balance: 800, narr: "NEFT DR SAMPLE TRADERS", balOk: false, dec: {mode: "NEFT", name: "SAMPLE TRADERS"}, state: "attention"}];
  const found = [
    {date: "2026-01-02", debit: 100, credit: 0, balance: 900, narr: "UPI/DR/111/DEMO SHOP/x@y", page: 1},
    {date: "2026-01-03", debit: 50, credit: 0, balance: 850, narr: "IMPS DR TEST VENDOR", page: 1},
    {date: "2026-01-04", debit: 50, credit: 0, balance: 800, narr: "NEFT DR SAMPLE TRADERS", page: 1}];
  const m = spliceMissing(rows, found, "a1", {}, 1000);
  m.added.forEach((r, i) => Object.assign(r, {id: "s-fix-" + i, dec: decodeNarr(r.narr, "Demo Co"), state: "attention", ledger: "", userSet: false}));
  return {n: m.rows.length, added: m.added.length, same: m.added.every(a => m.rows.includes(a)), allDec: m.rows.every(r => r.dec && r.id && r.state)};
}"""

SETUP = r"""() => {
  const c = newCompany({name: "Demo Traders Pvt Ltd", gstin: "09AAKFD1234C1Z5"}); c.bankAccounts = [{id: "a1", bank: "Demo Bank", acct: "4321", ledger: "Demo Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const good = (i) => ({id: "s1-" + i, fp: "fp" + i, date: "2026-01-0" + (i + 1), debit: 100 + i, credit: 0, balance: 5000 - i, narr: "UPI/DR/12345/GOOD PARTY " + i + "/g@ok", dec: {mode: "UPI", name: "GOOD PARTY " + i}, state: "attention", ledger: "", userSet: false, balOk: true, page: 1});
  // as the old repair kept them: no id, dec, state, ledger
  const bare = (i, narr) => ({fp: "bare" + i, date: "2026-01-1" + i, debit: 0, credit: 200 + i, balance: 6000 + i, narr, balOk: true, noAmt: false, page: 2, ref: "", valueDate: ""});
  const rows = [good(0), good(1), bare(0, "NEFT CR MADEUP CUSTOMER LTD"), bare(1, "UPI/CR/99999/FAKE BUYER/f@ok/pay"), bare(2, "BY CASH DEPOSIT")];
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Demo Bank", acct: "4321", from: "2026-01-01", to: "2026-01-31", n: rows.length, fileName: "demo.xlsx"}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: [{name: "Demo Bank", group: "Bank Accounts"}], importedAt: new Date().toISOString()}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false,
    showSettings: false, q: "", limit: 100, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render();
  return c.id;
}"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8412/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = pg.evaluate
    s = E(SPLICE)
    ok(s["n"] == 3 and s["added"] == 1, "(1) the missing line is put back (%s)" % s)
    ok(s["same"] and s["allDec"], "(1) the lines added are the ones in the statement, so every line kept has its id, dec and state")
    E(SETUP); pg.wait_for_timeout(1500)
    rows = E("B().rows.map(r => ({id: r.id || '', mode: r.dec && r.dec.mode, state: r.state || ''}))")
    ok(all(r["id"] and r["mode"] and r["state"] for r in rows), "(2) each line without its reading is read as it loads (%s)" % rows)
    ok(len(set(r["id"] for r in rows)) == len(rows), "(2) each has an id of its own")
    ok(rows[2]["mode"] == "NEFT" and rows[3]["mode"] == "UPI" and rows[4]["mode"] == "CASH", "(2) read from the narration (%s)" % [r["mode"] for r in rows[2:]])
    body = pg.inner_text("body")
    ok("Cash deposit" in body and "GOOD PARTY 0" in body, "(2) the Bank table is drawn, the healed lines' parties in Particulars")
    E("() => saveBank({rows: true})"); pg.wait_for_timeout(1300)
    counts = E("B().stmts[0].counts || {}")
    ok("undefined" not in counts and sum(counts.values()) == 5, "(2) the statement's counts have no undefined (%s)" % counts)
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
