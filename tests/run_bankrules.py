"""python3 run_bankrules.py - a written bank rule never changes a line a person set by hand (review of 01-Oct-2026): not
on "Apply to this statement", not when a rule is made from a line, changed, paused or moved. Lines no one touched still
follow the rules. Offline, a made-up statement. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bankrules.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8168), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# six NEFT payments to AMAZON: r0 set by hand to Office Expenses, r1 set aside by hand, r2 accepted by hand, r3-r5 untouched
SETUP = """() => {
  const c = newCompany({name: "ZZ Rules Co", gstin: ""}); c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", ledger: "ICICI Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const rows = Array.from({length: 6}, (_, i) => ({id: "r" + i, fp: "fp" + i, date: "2026-04-0" + (i + 1), debit: 1000 + i, credit: 0, bal: 0, balOk: true,
    narr: "NEFT DR AMAZON SELLER UTR" + i, dec: {name: "AMAZON SELLER", mode: "NEFT"}, ledger: i === 2 ? "Purchases" : "", state: i === 2 ? "suggested" : "attention", why: []}));
  const names = ["Office Expenses", "Purchases", "Amazon Seller", "Courier", "ICICI Bank"];
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-04-01", to: "2026-04-06", opening: 0, closing: 0, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: names.map(n => ({name: n, group: "Indirect Expenses"})), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100,
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
ROWS = "() => B().rows.map(r => [r.id, r.ledger || '', r.state, !!r.userSet])"
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8168/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    # by hand: a ledger on r0, r1 set aside, r2's suggestion accepted
    pg.evaluate("() => bankRowAct('ignore', 'r1')"); pg.evaluate("() => bankRowAct('accept', 'r2')")
    pg.evaluate("() => { setLedgerFor([bankRow('r0')], 'Office Expenses', 'pick'); }")   # (the same party's other open lines follow; r3-r5 are reset below)
    pg.evaluate("() => { B().rows.filter(r => !['r0','r1','r2'].includes(r.id)).forEach(r => { r.ledger = ''; r.state = 'attention'; r.userSet = false; r.source = ''; }); }")   # setLedgerFor's 'same party follows' undone, so r3-r5 are untouched
    hand = lambda: {r[0]: r for r in pg.evaluate(ROWS) if r[0] in ("r0", "r1", "r2")}
    before = hand()
    ok(before["r0"][1:] == ["Office Expenses", "ready", True] and before["r1"][2:] == ["ignored", True] and before["r2"][1:] == ["Purchases", "ready", True], "three lines set by hand: a ledger chosen, one set aside, one accepted")
    # a rule that matches every line: AMAZON -> Amazon Seller
    pg.evaluate("() => { const r = newRule({name: 'Amazon', when: {text: [{op: 'has', v: 'amazon'}], dir: 'any', amtMin: '', amtMax: '', modes: [], acNo: '', account: 'any', from: '', to: ''}}); r.then.ledger = 'Amazon Seller'; clientRules().unshift(r); window.__rid = r.id; }")
    steps = [("Apply to this statement", "() => bankClick({dataset: {act: 'ruleRunNow'}})"),
             ("the rule paused and used again", "() => { ruleAct('toggle', window.__rid); ruleAct('toggle', window.__rid); }"),
             ("the rule moved down and up", "() => { const r2 = newRule({name: 'Courier', when: {text: [{op: 'has', v: 'zzz'}], dir: 'any', amtMin: '', amtMax: '', modes: [], acNo: '', account: 'any', from: '', to: ''}}); r2.then.ledger = 'Courier'; clientRules().push(r2); ruleAct('down', window.__rid); ruleAct('up', window.__rid); }"),
             ("the rule changed (to Courier)", "() => { const r = clientRules().find(x => x.id === window.__rid); r.then.ledger = 'Courier'; saveRules('client'); runRules(null, {force: true}); }")]
    for name, js in steps:
        pg.evaluate(js); pg.wait_for_timeout(300)
        ok(hand() == before, "rules applied again after " + name + ": the three lines set by hand are as they were")
    rest = [r for r in pg.evaluate(ROWS) if r[0] in ("r3", "r4", "r5")]
    ok(all(r[1] == "Courier" and r[2] == "ready" and not r[3] for r in rest), "the lines no one touched follow the rule as it is now (" + ", ".join(r[0] + ": " + r[1] for r in rest) + ")")
    # a rule made from a line ("Rule" on the line) applies to the others, not to the hand-set ones
    pg.evaluate("() => { const r = newRule({name: 'Amazon 2', when: {text: [{op: 'has', v: 'amazon seller'}], dir: 'any', amtMin: '', amtMax: '', modes: [], acNo: '', account: 'any', from: '', to: ''}}); r.then.ledger = 'Purchases'; clientRules().unshift(r); runRules(null, {force: true}); }")
    ok(hand() == before and all(r[1] == "Purchases" for r in pg.evaluate(ROWS) if r[0] in ("r3", "r4", "r5")), "a new rule at the top: the untouched lines take it, the hand-set lines keep theirs")
    # Undo after setting a line by hand gives the line back to the rules
    pg.evaluate("() => { setLedgerFor([bankRow('r3')], 'Office Expenses', 'pick'); }")
    ok(pg.evaluate("bankRow('r3').userSet") is True, "a line set by hand is marked as the person's choice")
    ok("Your own choices are never overwritten by a rule" in pg.evaluate("(() => { B().filter = 'rules'; render(); return document.getElementById('app').innerText; })()"), "the Rules tab still says so, and now it holds")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
