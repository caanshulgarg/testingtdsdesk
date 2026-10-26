"""python3 run_bank_heal.py - owner, 26-Oct-2026: a client's Bank page showed "No bank statement yet" while the statement
(441 lines, two row parts) was in the firm account, and uploading the file again was refused as already uploaded, after
it had been read and charged each time (staging: four charges of 441 lines, 08:46-08:51 UTC, and no new statement).
  1. a browser whose bank storage was lost while its sync marks say it has everything: opening the client's Bank page
     brings the statement back from the cloud (one query, this client's bank records only) and opens it, 441 lines;
  2. the row fingerprints kept but the statement lost, the cloud not answering when the page opened: uploading the same
     file brings the statement back first and opens it, "This statement is already in FinCom - opened it.", no charge,
     no empty statement made;
  3. the same file uploaded on ANOTHER client's page (that client has no such account; the account is the first client's):
     the first client's statement is opened, with the message naming it; nothing is charged; the page is never left empty;
  4. a genuinely new statement still uploads (its lines, one charge);
  5. a statement deleted in the firm account stays deleted when the rest comes back; nothing on the server changes.
A stand-in for the firm account inside the page (records, charge_usage). Made-up statements only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_heal.py"""
import os, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8411
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def statement(n, start, bal0, tag):
    lines = ["ICICI Bank,,,,,", "Account Number: 167105000331,,,,,", "IFSC: ICIC0001671,,,,,",
             "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance"]
    bal, d = bal0, start
    for i in range(n):
        out = i % 3 != 1; amt = 1000 + (i * 37) % 9000 + 0.5
        bal = round(bal - amt if out else bal + amt, 2)
        lines.append("%s,%s %s %s/%05d,,%s,%s,%.2f" % (d.strftime("%d/%m/%Y"), "NEFT DR" if out else "NEFT CR", tag, "PARTY%d" % (i % 23), i,
                                                     "%.2f" % amt if out else "", "" if out else "%.2f" % amt, bal))
        if i % 2: d += datetime.timedelta(days=1)
    return "\n".join(lines) + "\n"
CSV1 = statement(441, datetime.date(2025, 4, 1), 5000000, "ITS")
CSV2 = statement(40, datetime.date(2026, 4, 1), 3000000, "NEW")
FIRM = "f0000000-0000-0000-0000-00000000000f"

STUB = """(firm) => {
  const db = window.__db = {}; window.__q = []; window.__charges = []; window.__toasts = []; window.__down = false;
  Cloud.st.firm = firm; Cloud.on = () => true; S.account = {firm: {balance: 1e6}};
  if (typeof LocalOwner === 'object') LocalOwner.mayPush = () => true;
  const t0 = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); return t0.apply(this, arguments); };
  Cloud.rpc = async (fn, a) => { if (fn === 'charge_usage') { window.__charges.push(a); return {ok: true, balance: 1e6}; } return null; };
  Cloud.api = async (path, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (path.startsWith('records?on_conflict') && m === 'POST') { opts.body.forEach(r => { db[r.kind + '|' + r.client_id + '|' + r.id] = JSON.parse(JSON.stringify(r)); }); return null; }
    if (path.startsWith('records?') && m === 'PATCH') return null;
    if (path.startsWith('records?select=') && path.includes('client_id=eq.')) {
      window.__q.push(path); if (window.__down) throw new Error('Failed to fetch');
      const cid = decodeURIComponent(path.split('client_id=eq.')[1].split('&')[0]);
      return Object.values(db).filter(r => r.client_id === cid && /^bank_/.test(r.kind)).map(r => JSON.parse(JSON.stringify(r)));
    }
    return [];
  };
}"""
SETUP = """() => {
  const a = newCompany({name: "its easy", gstin: ""}); a.id = "zzheal1"; a.bankAccounts = [{id: "bazz1", bank: "ICICI Bank", acct: "167105000331", ifsc: "ICIC0001671", last4: "0331", ledger: "ICICI Bank A/c"}];
  const b = newCompany({name: "ITSEasy Solutions Pvt Ltd", gstin: ""}); b.id = "zzheal2"; b.bankAccounts = [];
  [a, b].forEach(c => { S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); });
}"""
# what this browser keeps of a client's bank, lost (Safari's storage eviction, a cleared site), the sync marks kept
LOSE = """async ([cid, keepKeys]) => {
  const st = (await BankDB.get('stmts:' + cid)) || [];
  for (const s of st) await BankDB.del('stmt:' + cid + ':' + s.id);
  await BankDB.del('stmts:' + cid);
  if (!keepKeys) for (const k of ['keys', 'rules', 'newled', 'hist']) await BankDB.del(k + ':' + cid);
  S.bank = null; if (window.bankHeal) bankHeal.done = {};
}"""
OPEN = """(cid) => { S.coId = cid; S.view = "company"; S.tab = "bank"; S.bank = null; render(); }"""
UPLOAD = """([csv, name]) => uploadStatements([new File([csv], name, {type: 'text/csv'})])"""

def wait(pg, js, t=15000):
    try: pg.wait_for_function("() => { try { return !!(" + js + "); } catch (e) { return false; } }", timeout=t); return True
    except Exception: return False

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(STUB, FIRM); pg.evaluate(SETUP)
    A, B2 = "zzheal1", "zzheal2"
    app = lambda: pg.inner_text("#app")
    toasts = lambda: pg.evaluate("window.__toasts")
    charges = lambda: pg.evaluate("window.__charges.length")

    print("== 0. the statement uploaded on this computer and sent to the firm account")
    pg.evaluate(OPEN, A); wait(pg, "B() && B().cid === 'zzheal1' && !B().loading")
    pg.evaluate(UPLOAD, [CSV1, "Its Bank 25-26.csv"]); wait(pg, "B().stmts.length === 1 && !B().busy")
    sid = pg.evaluate("B().stmts[0].id")
    ok(pg.evaluate("B().rows.length") == 441 and charges() == 1, "441 lines read, charged once (%s, %s)" % (pg.evaluate("B().rows.length"), charges()))
    pg.wait_for_timeout(1200); pg.evaluate("cloudPush()"); pg.wait_for_timeout(500)
    kinds = sorted(pg.evaluate("Object.values(__db).filter(r => r.client_id === 'zzheal1').map(r => r.kind + ':' + r.id.split(':').slice(2).join(''))"))
    ok(kinds == ["bank_meta:", "bank_rows:0", "bank_rows:1", "bank_stmt:"], "in the firm account: the statement, two row parts and the row keys (%s)" % kinds)
    ok(pg.evaluate("(k) => { const m = Cloud.marks(); return !!m[k]; }", "bank_stmt|%s|%s:%s" % (A, A, sid)), "and this browser's sync marks say it has them")
    server0 = pg.evaluate("JSON.stringify(__db)")

    print("== 1. this browser's bank storage lost, the marks kept: the Bank page brings the statement back")
    pg.evaluate(LOSE, [A, False]); pg.evaluate("window.__q = []")
    pg.evaluate(OPEN, A); wait(pg, "B() && B().cid === 'zzheal1' && !B().loading && B().rows.length", 10000); pg.wait_for_timeout(500)
    ok(pg.evaluate("B().stmts.length") == 1 and pg.evaluate("B().cur") == sid and pg.evaluate("B().rows.length") == 441, "the statement is open again: %s statement(s), %s lines" % (pg.evaluate("B().stmts.length"), pg.evaluate("B().rows.length")))
    ok("No bank statement yet" not in app() and "441 entries" in app(), "the page shows it, not the empty drop zone")
    q = pg.evaluate("window.__q")
    ok(len(q) == 1 and "client_id=eq.zzheal1" in q[0] and "bank_stmt" in q[0], "one query, this client's bank records only (%s)" % q)
    ok(pg.evaluate("(sid) => BankDB.get('stmt:zzheal1:' + sid).then(r => (r || []).length)", sid) == 441 and len(pg.evaluate("BankDB.get('keys:zzheal1').then(k => Object.keys(k || {}))")) == 441,
       "kept in this browser again: the 441 lines and their row keys")
    pg.evaluate(OPEN, A); wait(pg, "B() && !B().loading && B().rows.length"); pg.wait_for_timeout(300)
    ok(len(pg.evaluate("window.__q")) == 1, "opened again: nothing missing, no query")

    print("== 2. the row keys kept, the statement lost, the cloud not answering on opening: the same file uploaded")
    pg.evaluate(LOSE, [A, True]); pg.evaluate("window.__down = true; window.__q = []; window.__toasts = []")
    pg.evaluate(OPEN, A); wait(pg, "B() && B().cid === 'zzheal1' && !B().loading"); pg.wait_for_timeout(500)
    pg.evaluate("window.__down = false"); c0 = charges()
    pg.evaluate(UPLOAD, [CSV1, "Its Bank 25-26.csv"]); wait(pg, "!B().busy && B().rows.length", 10000); pg.wait_for_timeout(500)
    ok(pg.evaluate("B().stmts.length") == 1 and pg.evaluate("B().cur") == sid and pg.evaluate("B().rows.length") == 441, "the statement is back and open, no empty one made (%s statements, %s lines)" % (pg.evaluate("B().stmts.map(s => s.n)"), pg.evaluate("B().rows.length")))
    ok(any("This statement is already in FinCom" in t and "opened it" in t for t in toasts()), "said: This statement is already in FinCom - opened it (%s)" % toasts()[-2:])
    ok(charges() == c0, "nothing charged (%d -> %d)" % (c0, charges()))
    ok("No bank statement yet" not in app(), "the page is not left empty")
    pg.evaluate("window.__toasts = []"); c0 = charges()
    pg.evaluate(UPLOAD, [CSV1, "Its Bank 25-26.csv"]); pg.wait_for_timeout(1500)
    ok(any("already in FinCom" in t for t in toasts()) and charges() == c0 and pg.evaluate("B().stmts.length") == 1, "the same file once more: opened, said so, nothing charged (%s)" % toasts()[-1:])

    print("== 3. the same file on another client's page (the account is the first client's)")
    pg.evaluate("window.__toasts = []"); c0 = charges()
    pg.evaluate(OPEN, B2); wait(pg, "B() && B().cid === 'zzheal2' && !B().loading"); pg.wait_for_timeout(300)
    ok("No bank statement yet" in app(), "the other client: no statement of its own")
    pg.evaluate(UPLOAD, [CSV1, "Its Bank 25-26.csv"]); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.coId") == A and pg.evaluate("B().cid") == A and pg.evaluate("B().cur") == sid and pg.evaluate("B().rows.length") == 441, "the first client's statement is opened (%s, %s)" % (pg.evaluate("S.coId"), pg.evaluate("B() && B().cid")))
    ok(any("already in FinCom" in t and "its easy" in t for t in toasts()), "said where it is (%s)" % toasts()[-1:])
    ok(charges() == c0 and "No bank statement yet" not in app(), "nothing charged, the page not left empty (%d -> %d)" % (c0, charges()))
    # the first client's storage lost too: brought back from the cloud, then opened
    pg.evaluate(LOSE, [A, True]); pg.evaluate("window.__toasts = []"); pg.evaluate(OPEN, B2); wait(pg, "B() && B().cid === 'zzheal2' && !B().loading")
    pg.evaluate(UPLOAD, [CSV1, "Its Bank 25-26.csv"]); pg.wait_for_timeout(2500)
    ok(pg.evaluate("B().cid") == A and pg.evaluate("B().rows.length") == 441 and any("already in FinCom" in t for t in toasts()) and charges() == c0,
       "the first client's copy lost here too: brought back and opened, nothing charged (%s)" % toasts()[-1:])

    print("== 4. a genuinely new statement still uploads")
    pg.evaluate(OPEN, A); wait(pg, "B() && B().cid === 'zzheal1' && !B().loading && B().rows.length"); c0 = charges()
    pg.evaluate(UPLOAD, [CSV2, "Its Bank 26-27.csv"]); wait(pg, "B().stmts.length === 2 && !B().busy")
    sid2 = pg.evaluate("B().stmts.length > 1 ? B().stmts[1].id : ''")
    ok(sid2 and pg.evaluate("B().cur") == sid2 and pg.evaluate("B().rows.length") == 40 and charges() == c0 + 1, "a new statement: 40 lines, one charge (%s, %d)" % (pg.evaluate("B().rows.length"), charges() - c0))
    pg.wait_for_timeout(1200); pg.evaluate("cloudPush()"); pg.wait_for_timeout(500)

    print("== 5. a statement deleted in the firm account stays deleted")
    # deleted on another computer: the server's flag, this browser's mark 'gone'
    pg.evaluate("""(sid2) => { const k = 'bank_stmt|zzheal1|zzheal1:' + sid2; __db[k].deleted = true;
      const mk = __db['bank_meta|zzheal1|zzheal1'].data.keys; Object.keys(mk).forEach(f => { if (mk[f] === sid2) delete mk[f]; }); const m = Cloud.marks(); m[k] = 'gone'; Cloud.setMarks(m); }""", sid2)
    server1 = pg.evaluate("JSON.stringify(__db)")
    pg.evaluate(LOSE, [A, False]); pg.evaluate("window.__q = []")
    pg.evaluate(OPEN, A); wait(pg, "B() && B().cid === 'zzheal1' && !B().loading && B().rows.length", 10000); pg.wait_for_timeout(500)
    ok([s["id"] for s in pg.evaluate("B().stmts")] == [sid] and pg.evaluate("B().rows.length") == 441, "the live statement is back, the deleted one is not (%s)" % pg.evaluate("B().stmts.map(s => s.id)"))
    ok(pg.evaluate("(s) => BankDB.get('stmt:zzheal1:' + s).then(r => r === undefined)", sid2), "the deleted statement's lines are not written back")
    ok(all(v == sid for v in pg.evaluate("BankDB.get('keys:zzheal1').then(k => Object.values(k || {}))")), "only the live statement's row keys come back")
    pg.wait_for_timeout(1200); pg.evaluate("cloudPush()"); pg.wait_for_timeout(500)
    after = pg.evaluate("Object.fromEntries(Object.entries(__db).map(([k, r]) => [k, !!r.deleted]))")
    ok(after == pg.evaluate("(s) => Object.fromEntries(Object.entries(JSON.parse(s)).map(([k, r]) => [k, !!r.deleted]))", server1), "the server's records: the same ones, nothing deleted or undeleted (%s)" % after)
    br.close()
errors = [e for e in errors if "ResizeObserver" not in e]
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
