"""python3 run_bank_live_parts.py - staging, 26-Oct-2026 11:43: a statement moved to a client (bank_stmt, bank_rows ':0'
300 rows and ':1' 141 rows, bank_meta, and the client row with the account's confirmed ledger) was damaged 4 s later by
the owner's browser: ':1' sent back with 123 rows, and the client saved without its choice "bank:<account>" and with the
account's ledger blank.
  1. records coming in live, each applied as it arrives (Realtime: one row each, not one after another), ':1' before
     ':0': the statement here has all 441 lines in order, and nothing of the statement is sent back;
  2. ':1' alone (':0' not here yet): no line packed into the wrong place, no rows sent from a statement held only in
     part; ':0' coming later completes it;
  3. a client copy here older than the one this computer last took from the server (another tab, a copy saved from an
     old object): a save keeps the choice and the account's ledger the server gained; a choice this computer removed
     is still removed.
A stand-in for the firm account inside the page. Made-up records only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_live_parts.py"""
import os, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8413
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# a browser holding an older copy of the client (no bank account), in step with the server as it was; the stand-in server
SETUP = """async (cid) => {
  const F = 'f0000000-0000-0000-0000-00000000000f'; window.__sent = [];
  Cloud.st.firm = F; Cloud.on = () => true; if (typeof LocalOwner === 'object') LocalOwner.mayPush = () => true;
  const old = newCompany({name: 'ITSEasy Solutions', gstin: ''}); old.id = cid; old.bankAccounts = [];
  S.companies[cid] = old; S.data[cid] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(old);
  const snap = cloudSnapshot().find(r => r.kind === 'client' && r.id === cid);
  window.__srv = JSON.parse(JSON.stringify(snap.data));
  const m = Cloud.marks(); m['client|' + cid + '|' + cid] = fpHash(JSON.stringify(snap.data)); Cloud.setMarks(m); await ClientBase.set(cid, snap.data);
  Cloud.api = async (path, opts) => { const me = (opts || {}).method || 'GET';
    if (me !== 'GET') { const body = JSON.parse(JSON.stringify(opts.body)); window.__sent.push({path, body});
      if (path.startsWith('clients?')) { window.__srv = body.data; return [{data: body.data}]; } return null; }
    if (path.startsWith('clients?firm_id')) return [{data: JSON.parse(JSON.stringify(window.__srv)), updated_at: 'x', deleted: false}];
    if (path.startsWith('records?select=') && path.includes('client_id=eq.')) return JSON.parse(JSON.stringify(Object.values(window.__recs || {})));
    return []; };
  S.coId = cid; S.view = 'company'; S.tab = 'bank'; S.bank = null; render();
}"""
# the moved statement: 441 lines in two parts, the account and its confirmed ledger on the client
RECS = """(cid) => {
  const sid = 'stmv1', rows = Array.from({length: 441}, (_, i) => ({id: sid + '-' + i, fp: 'f' + i, date: '2025-04-' + String(1 + i % 28).padStart(2, '0'), debit: 100 + i, credit: 0, balance: null, narr: 'LINE ' + i, state: 'attention', ledger: ''}));
  const acc = {id: 'bamv1', acct: '167105000331', bank: 'ICICI Bank', ifsc: 'ICIC0001671', last4: '0331', ledger: 'ICICI Bank A/c'};
  const cl = JSON.parse(JSON.stringify(window.__srv)); cl.bankAccounts = [acc];
  cl.choices = Object.assign({}, cl.choices, {'bank:bamv1': {at: '2026-10-24T10:17:03.961Z', by: 'owner', state: 'confirmed', value: 'ICICI Bank A/c'}});
  const R = {
    client: {kind: 'client', id: cid, client_id: cid, data: cl},
    stmt: {kind: 'bank_stmt', id: cid + ':' + sid, client_id: cid, data: {id: sid, n: 441, acctId: 'bamv1', bank: 'ICICI Bank', acct: '167105000331', ifsc: 'ICIC0001671', fileName: 'Its Bank 25-26.xlsx', hash: 'h441', from: '2025-04-01', to: '2026-03-31'}},
    r0: {kind: 'bank_rows', id: cid + ':' + sid + ':0', client_id: cid, data: {rows: rows.slice(0, 300)}},
    r1: {kind: 'bank_rows', id: cid + ':' + sid + ':1', client_id: cid, data: {rows: rows.slice(300)}},
    meta: {kind: 'bank_meta', id: cid, client_id: cid, data: {keys: Object.fromEntries(rows.map(r => ['bamv1|' + r.fp, sid])), rules: [], newLed: [], hist: {rows: {}}}}};
  window.__R = R; window.__recs = {stmt: R.stmt, r0: R.r0, r1: R.r1, meta: R.meta};
}"""
LIVE = """async (order) => { await Promise.all(order.map(k => Live.rec(k === 'client' ? 'clients' : 'records', Object.assign({updated_by: 'u-other', updated_at: new Date().toISOString()}, window.__R[k])))); }"""
SEQ = """async (order) => { for (const k of order) await cloudApply([Object.assign({updated_at: new Date().toISOString()}, window.__R[k])]); }"""
LOCAL = """(cid) => BankDB.get('stmt:' + cid + ':stmv1').then(r => (r || []).map(x => +x.id.split('-')[1]))"""
SENT_ROWS = """() => window.__sent.filter(s => s.path.startsWith('records?')).flatMap(s => s.body).filter(b => b.kind === 'bank_rows').map(b => [b.id, b.data.rows.length])"""
SENT_CLIENT = """() => window.__sent.filter(s => s.path.startsWith('clients?')).map(s => s.body.data)"""

with sync_playwright() as p:
    br = p.chromium.launch()
    def fresh():
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        return pg

    print("== 1. live, each row applied as it arrives, ':1' before ':0'")
    for n, order in enumerate([["stmt", "client", "r1", "r0", "meta"], ["r1", "r0", "stmt", "meta", "client"], ["client", "stmt", "r0", "r1", "meta"]]):
        pg = fresh(); cid = "zzmv%d" % n
        pg.evaluate(SETUP, cid); pg.wait_for_timeout(1200); pg.evaluate(RECS, cid)
        pg.evaluate(LIVE, order); pg.wait_for_timeout(2500)
        loc = pg.evaluate(LOCAL, cid)
        ok(loc == list(range(441)), "%s: all 441 lines here, in order (%d, first after 299: %s)" % (",".join(order), len(loc), loc[299:301]))
        pg.evaluate("cloudPush()"); pg.wait_for_timeout(600)
        sent = pg.evaluate(SENT_ROWS)
        ok(all(x[1] == (300 if x[0].endswith(":0") else 141) for x in sent), "%s: no part of the statement sent back short (%s)" % (",".join(order), sent))
        pg.close()

    print("== 2. ':1' alone, then ':0'")
    pg = fresh(); cid = "zzmv9"
    pg.evaluate(SETUP, cid); pg.wait_for_timeout(1200); pg.evaluate(RECS, cid)
    pg.evaluate("window.__recs = {}")      # the firm account has nothing more to give (no self-heal fills the gap)
    pg.evaluate(SEQ, ["client", "stmt", "r1"]); pg.wait_for_timeout(1500)
    loc = pg.evaluate(LOCAL, cid)
    ok(not loc or loc[0] == 0, "':1' alone: its lines are not packed into the first places (%s)" % loc[:3])
    pg.evaluate("cloudPush()"); pg.wait_for_timeout(600)
    ok(pg.evaluate(SENT_ROWS) == [], "a statement held only in part: none of its rows sent (%s)" % pg.evaluate(SENT_ROWS))
    pg.evaluate(SEQ, ["r0"]); pg.wait_for_timeout(1500)
    loc = pg.evaluate(LOCAL, cid)
    ok(loc == list(range(441)), "':0' then: all 441 lines, in order (%d)" % len(loc))
    pg.close()

    print("== 3. a client copy here older than the server's last copy taken here")
    pg = fresh(); cid = "zzmvc"
    pg.evaluate(SETUP, cid); pg.wait_for_timeout(1000); pg.evaluate(RECS, cid)
    pg.evaluate("(cid) => { S.coId = null; S.view = 'home'; S.bank = null; }", cid)
    # the server gained the account and its confirmed ledger; this computer took that copy (its base and mark), but the
    # copy now here is the older one (another tab, an old object saved)
    pg.evaluate("""async (cid) => { const cl = window.__R.client.data; window.__srv = JSON.parse(JSON.stringify(cl)); await ClientBase.set(cid, cl);
      const m = Cloud.marks(); m['client|' + cid + '|' + cid] = fpHash(JSON.stringify(cl)); Cloud.setMarks(m); S.companies[cid].roundOff = 'x9'; }""", cid)
    pg.evaluate("cloudPush()"); pg.wait_for_timeout(600)
    sent = pg.evaluate(SENT_CLIENT)
    last = sent[-1] if sent else pg.evaluate("() => window.__srv")
    ok(((last.get("choices") or {}).get("bank:bamv1") or {}).get("value") == "ICICI Bank A/c", "the choice the server gained is kept (%s)" % (last.get("choices") or {}).get("bank:bamv1"))
    ok([a.get("ledger") for a in last.get("bankAccounts") or []] == ["ICICI Bank A/c"], "and the account with its ledger (%s)" % last.get("bankAccounts"))
    ok(last.get("roundOff") == "x9", "the change made here goes too (%s)" % last.get("roundOff"))
    # a choice removed here (choiceForget) is removed on the server
    pg.evaluate("""async (cid) => { window.__sent = []; const co = S.companies[cid] = fixCompany(JSON.parse(JSON.stringify(window.__srv)));
      const m = Cloud.marks(); m['client|' + cid + '|' + cid] = fpHash(JSON.stringify(cloudClientView(co))); Cloud.setMarks(m); await ClientBase.set(cid, window.__srv);
      choiceGuess(co, 'gst:igst', 'IGST Input', 'test'); Store.saveCompany(co); }""", cid)
    pg.evaluate("cloudPush()"); pg.wait_for_timeout(600)
    ok(((pg.evaluate("() => window.__srv").get("choices") or {}).get("gst:igst") or {}).get("value") == "IGST Input", "a choice made here is sent")
    pg.evaluate("(cid) => { window.__sent = []; choiceForget(S.companies[cid], 'gst:igst'); }", cid)
    pg.evaluate("cloudPush()"); pg.wait_for_timeout(600)
    ok("gst:igst" not in (pg.evaluate("() => window.__srv").get("choices") or {}), "a choice removed here is removed there (%s)" % (pg.evaluate("() => window.__srv").get("choices") or {}).get("gst:igst"))
    pg.close()
    br.close()
errors = [e for e in errors if "ResizeObserver" not in e]
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
