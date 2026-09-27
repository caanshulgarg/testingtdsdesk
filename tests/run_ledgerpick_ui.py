"""python3 run_ledgerpick_ui.py - the ledger box on a bank line: "create" is listed first, Enter or a click takes a ledger, and the list closes."""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8154), functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test")))); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => {
  const c = newCompany({name: "GARG SHEKHAR & COMPANY", gstin: "09AAKFG1234C1Z5"}); c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", ledger: "ICICI Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const parties = ["DIPTI VATS", "PAYUAMAZON", "BHARATKOSH", "PERFEKT SENSE DIGITA", "CLOUD WIZARD CONSULTING", "AMAZON GROCERIES", "CCAPROTEAN", "NAVNEET TENDER DSC"];
  const states = ["ready","ready","ready","attention","suggested","sent","intally","ready"];
  let bal = 250000;
  const rows = Array.from({length: 24}, (_, i) => { const out = i % 3 !== 1; const amt = [2000, 28788, 2970, 1000, 100000, 5.9, 16200, 1482][i % 8] * (1 + (i % 5) / 10);
    bal += out ? -amt : amt;
    return {id: "r" + i, fp: "fp" + i, date: "2026-04-" + String(1 + i).padStart(2, "0"), debit: out ? r2(amt) : 0, credit: out ? 0 : r2(amt), bal: r2(bal),
      narr: (out ? "NEFT DR " : "NEFT CR ") + parties[i % 8] + " UTR" + (100000 + i), dec: {name: parties[i % 8], mode: "NEFT", utr: "UTR" + (100000 + i)},
      ledger: states[i % 8] === "attention" ? "" : parties[i % 8], state: states[i % 8], balOk: true, why: states[i % 8] === "attention" ? ["No ledger found for this party."] : []}; });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-04-01", to: "2026-04-24", opening: 250000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "ICICI Bank", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "",
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8154/"); pg.wait_for_timeout(1500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(500)
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    rid = pg.evaluate("B().rows.find(r => r.state === 'attention').id")
    sel = "[data-bled='%s']" % rid
    shown = lambda: pg.evaluate("(() => { const b = document.getElementById('acBox'); return !!b && b.style.display !== 'none'; })()")
    pg.click(sel); pg.fill(sel, ""); pg.type(sel, "DIPT", delay=30); pg.wait_for_timeout(300)
    items = pg.evaluate("Array.from(document.querySelectorAll('#acBox .aci')).map(e => e.innerText)")
    ok(shown() and items and items[0].startswith("+ Create ledger") and any("DIPTI VATS" in x for x in items[1:]), "typing: the list opens, with 'Create ledger' first (%s)" % items[:3])
    ok(pg.evaluate("document.querySelector('#acBox .aci.on').innerText").startswith("DIPTI VATS"), "the best match below it is the one Enter takes")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(700)
    ok(not shown(), "Enter: the ledger is taken and the list closes")
    ok(pg.evaluate("B().rows.find(r => r.id === '%s').ledger" % rid) == "DIPTI VATS", "and the line has the ledger")
    rid2 = pg.evaluate("(B().rows.find(r => ['attention','suggested'].includes(r.state) && document.querySelector('[data-bled=\"' + r.id + '\"]')) || {}).id")
    ok(bool(rid2), "another line to try a click on (%s; states %s)" % (rid2, pg.evaluate("B().rows.map(r => r.state).join(',')")))
    if rid2:
        sel2 = "[data-bled='%s']" % rid2
        pg.click(sel2); pg.fill(sel2, ""); pg.type(sel2, "BHARAT", delay=30); pg.wait_for_timeout(300)
        pg.click("#acBox .aci:not(:first-child)"); pg.wait_for_timeout(700)
        ok(not shown() and pg.evaluate("B().rows.find(r => r.id === '%s').ledger" % rid2) == "BHARATKOSH", "a click on a ledger: taken, and the list closes")
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
