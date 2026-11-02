"""python3 run_bank_deleted_reupload.py - a deleted statement uploaded again (owner, 01-Nov-2026: "If I delete any statement
then it should not show it duplicate if it is not posted.. if posted then warning and we should be able to upload and post
it to tally..").
Made-up rows only. Statement s1 (3 lines: 2 posted to Tally, 1 not) and s2 (1 line) are here; s1 is deleted. Checked:
(1) deleting keeps the fingerprints of s1's posted lines (hist.gone, with when they were posted) and drops s1's keys; the
    cloud's bank_meta copy carries them;
(2) uploading s1's lines again (bankNewRows): all 3 come in (none called a duplicate), a line of s2 (still in the list)
    is skipped as before;
(3) the same on another computer: the cloud's bank_meta applied there with stale keys still naming s1 (taken before the
    delete reached it) - the 3 lines still come in (a key counts only while its statement is in the list), and hist.gone
    arrives with the history;
(4) the new statement open: the 2 posted lines are marked "Already posted to Tally on <date> from a deleted statement",
    the header counts "2 posted before", a toast says so; the line never posted has no warning;
(5) posting asks once: postBankToTally shows "2 entries were posted before; post again?"; Cancel posts the other line
    only; Post again lets them through and is not asked again;
(6) forgetting the learnt history keeps the posted-before fingerprints.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_deleted_reupload.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8413), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = r"""async () => {
  const c = newCompany({name: "Sample Works Pvt Ltd", gstin: "09AAKFS1234C1Z5"}); c.bankAccounts = [{id: "a1", bank: "Demo Bank", acct: "9876", ledger: "Demo Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const acc = c.bankAccounts[0];
  const raw = (d, dr, cr, bal, narr) => ({date: d, valueDate: "", narr, ref: "", page: 1, debit: dr, credit: cr, balance: bal});
  window.__raw1 = () => [raw("2026-02-01", 500, 0, 9500, "NEFT DR ALPHA SUPPLIES"), raw("2026-02-02", 0, 800, 10300, "UPI/CR/4242/BETA BUYER/b@ok"), raw("2026-02-03", 120, 0, 10180, "IMPS DR GAMMA SERVICES")];
  window.__raw2 = () => [raw("2026-03-01", 75, 0, 10105, "NEFT DR DELTA STORES")];
  window.__acc = acc;
  const k1 = bankNewRows(window.__raw1(), acc, {}, [], "s1", c.name), k2 = bankNewRows(window.__raw2(), acc, {}, [], "s2", c.name);
  const r1 = k1.rows; r1[0].state = "sent"; r1[0].ledger = "Alpha Supplies"; r1[0].sentAt = "2026-02-10T10:00:00.000Z";
  r1[1].state = "sent"; r1[1].ledger = "Beta Buyer"; r1[1].sentAt = "2026-02-11T10:00:00.000Z";
  const keys = Object.assign({}, k1.nk, k2.nk);
  await BankDB.set("stmt:" + c.id + ":s1", r1); await BankDB.set("stmt:" + c.id + ":s2", k2.rows);
  S.bank = {cid: c.id, loading: false, cur: "s2", rows: k2.rows, rules: [], wrules: [], keys,
    stmts: [{id: "s1", acctId: "a1", bank: "Demo Bank", acct: "9876", from: "2026-02-01", to: "2026-02-03", n: 3, fileName: "feb.xlsx"},
            {id: "s2", acctId: "a1", bank: "Demo Bank", acct: "9876", from: "2026-03-01", to: "2026-03-01", n: 1, fileName: "mar.xlsx"}],
    ledgers: {list: [{name: "Demo Bank", group: "Bank Accounts"}], importedAt: new Date().toISOString()}, newLed: [], books: {}, filter: "review", grouped: false,
    showSettings: false, q: "", limit: 100, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  window.__staleKeys = Object.assign({}, keys);
  window.confirmTyped = async () => ({reason: "test"});
  render();
  return c.id;
}"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8413/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = pg.evaluate
    cid = E(SETUP); pg.wait_for_timeout(1200)
    E("(async () => deleteStatement('s1'))()"); pg.wait_for_timeout(1500)
    gone = E("B().hist.gone || {}")
    ok(len(gone) == 2 and sorted(gone.values()) == ["2026-02-10T10:00:00.000Z", "2026-02-11T10:00:00.000Z"], "(1) the 2 posted lines' fingerprints are kept, with when they were posted (%d)" % len(gone))
    ok(not any(v == "s1" for v in E("Object.values(B().keys)")) and E("B().stmts.map(s => s.id)") == ["s2"], "(1) s1's keys are dropped and s1 has left the list")
    meta = E("(cloudSnapshot().find(r => r.kind === 'bank_meta') || {}).data || {}")
    ok(len(((meta.get("hist") or {}).get("gone")) or {}) == 2, "(1) the cloud's bank_meta carries them with the history")
    up = E("(() => { const b = B(), x = bankNewRows(window.__raw1().concat(window.__raw2()), window.__acc, b.keys, b.stmts, 's3', 'Sample Works Pvt Ltd'); return {n: x.rows.length, dup: x.dupRows}; })()")
    ok(up == {"n": 3, "dup": 1}, "(2) the 3 lines of the deleted statement come in again; the line of s2 is skipped as a duplicate (%s)" % up)
    # (3) another computer: bank_meta with stale keys naming s1, applied and loaded
    E("""(async () => { const b = B(), cid = b.cid; await BankDB.set('stmts:' + cid, b.stmts);
      await cloudApplyBankMeta(cid, {data: {rules: [], newLed: [], keys: window.__staleKeys, hist: JSON.parse(JSON.stringify(b.hist))}}); S.bank = null; await loadBank(cid); })()"""); pg.wait_for_timeout(1500)
    ok(len(E("(B().hist && B().hist.gone) || {}")) == 2 and any(v == "s1" for v in E("Object.values(B().keys)")), "(3) on another computer: the history with hist.gone arrives, and the stale keys naming s1 too")
    up3 = E("(() => { const b = B(), x = bankNewRows(window.__raw1(), window.__acc, b.keys, b.stmts, 's3', 'Sample Works Pvt Ltd'); return {n: x.rows.length, dup: x.dupRows}; })()")
    ok(up3 == {"n": 3, "dup": 0}, "(3) and still all 3 lines come in: a key counts only while its statement is in the list (%s)" % up3)
    # (4) the new statement open
    E("""(() => { const b = B(), x = bankNewRows(window.__raw1(), window.__acc, b.keys, b.stmts, 's3', 'Sample Works Pvt Ltd'); Object.assign(b.keys, x.nk);
      b.stmts.push({id: 's3', acctId: 'a1', bank: 'Demo Bank', acct: '9876', from: '2026-02-01', to: '2026-02-03', n: 3, fileName: 'feb.xlsx'});
      b.cur = 's3'; b.rows = x.rows; b.filter = 'review'; render(); })()"""); pg.wait_for_timeout(900)
    marked = E("B().rows.map(r => !!r.goneSent)")
    ok(marked == [True, True, False], "(4) the 2 lines posted before are marked, the other is not (%s)" % marked)
    body = pg.inner_text("body")
    ok("Already posted to Tally on " in body and "from a deleted statement" in body, "(4) each such line says it was already posted to Tally on its date from a deleted statement")
    ok(E("document.querySelectorAll('[data-gone]').length") == 2, "(4) two lines carry the warning (%d)" % E("document.querySelectorAll('[data-gone]').length"))
    ok("2 posted before" in E("(document.querySelector('[data-gone-n]') || {}).innerText || ''"), "(4) the header counts 2 posted before")
    ok("already posted to Tally" in E("(document.getElementById('toast') || {}).innerText || ''"), "(4) a toast says so: %s" % E("(document.getElementById('toast') || {}).innerText || ''")[:120])
    # (5) posting asks once
    E("() => { B().rows.forEach(r => { r.ledger = 'Some Ledger'; r.state = 'ready'; }); window.__posted = []; window.ensureTallyCompany = async () => { window.__posted.push('reached'); return null; }; render(); }")
    E("() => { window.__ids = 'none'; const o = window.bankGoneAsk; window.bankGoneAsk = async (b, ids) => { const r = await o(b, ids); window.__ids = r; return r; }; postBankToTally(); }"); pg.wait_for_timeout(500)
    title = E("(document.querySelector('#confirmBox h2') || {}).innerText || ''")
    ok("2 entries were posted before; post again?" in title, "(5) posting asks: %s" % title)
    pg.click("#confirmBox [data-cbx=no]"); pg.wait_for_timeout(400)
    ids = E("window.__ids"); third = E("B().rows[2].id")
    ok(ids == [third] and E("window.__posted.length") == 1, "(5) Cancel posts the other line only (%s)" % ids)
    E("() => { window.__ids = 'none'; postBankToTally(); }"); pg.wait_for_timeout(500)
    pg.click("#confirmBox [data-cbx=yes]"); pg.wait_for_timeout(400)
    ok(E("window.__ids") is None and E("B().rows.filter(r => r.goneSent && r.goneSent.ok).length") == 2 and E("window.__posted.length") == 2, "(5) Post again lets all through (%s)" % E("window.__ids"))
    E("() => { window.__ids = 'none'; postBankToTally(); }"); pg.wait_for_timeout(500)
    ok(not E("(document.querySelector('#confirmBox h2') || {}).innerText || ''") and E("window.__posted.length") == 3, "(5) and is not asked again")
    # (6) forgetting the history keeps them
    E("() => { B().hist.rows = {x: {l: 'A'}}; window.askConfirm = async () => ({ok: true}); }")
    E("(async () => clearHistory())()"); pg.wait_for_timeout(500)
    ok(len(E("B().hist.gone || {}")) == 2 and not E("Object.keys(B().hist.rows).length"), "(6) forgetting the learnt history keeps the posted-before fingerprints")
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
