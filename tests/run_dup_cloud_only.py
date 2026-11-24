"""python3 run_dup_cloud_only.py - the duplicate check before posting reads only FinCom's cloud copy of Tally (the owner,
23-Nov-2026, next-dup-cloud-only). FinCom never reads Tally before posting: no /vouchers, /ledgerlines or /tags request to
FinCom Bridge here. The check asks FinCom's copy (CloudTally: tally_vouchers_in, as from any other computer):
"It should flow" (the owner, 23-Nov-2026 ~20:25 IST, superseding "warn + Post anyway"):
  - the copy shows the same entry already in Tally: marked In Tally quietly, with Tally's number, not posted; no warning,
    no "Post anyway";
  - everything else posts; the copy with no data for the day, not there, or not answering: posted, no note and no
    warning in the result (a sales invoice's own panel keeps one small line);
  - nothing stops or holds the batch.
Sales (Post to Tally and Post one by one), bank lines and purchase bills, each with: no data, a match, the copy
unreachable, and a mixed batch. Made-up data only.
Run on the React build: TDSDESK_SITE=../app/dist-test DUPC_PORT=8967 python3 run_dup_cloud_only.py
(DUPC_SHOTS=<dir>: a screenshot of a mixed sales batch, deviceScaleFactor 2)"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PORT = int(os.environ.get("DUPC_PORT") or 8967)
SHOTS = os.environ.get("DUPC_SHOTS", "")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

NOTE = "Not checked for duplicates: FinCom's copy of Tally did not answer."
READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
# the outside calls: FinCom Bridge here live (every call recorded: none may read Tally), FinCom's cloud copy as
# window.__cloud says (has: a copy for this client; fail: it does not answer; vouchers: what it holds), Bridge.post
# answering each voucher posted by Tally's reply
STUB = """() => { window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  window.ensureTallyCompany = async () => "ZZ Test Dup Traders"; window.syncLedgersFromTally = async () => true; window.checkBankBalance = async () => null;
  window.tallyVia = () => "bridge"; window.__sent = []; window.__bcalls = []; window.__ccalls = [];
  Object.assign(Bridge.st, {state: "up", version: "2.5.19", tallyUp: true, open: [{name: "ZZ Test Dup Traders", port: 9000}], allowImport: true});
  Bridge.on = () => true; Bridge.up = () => true; Bridge.openFor = () => ({name: "ZZ Test Dup Traders", port: 9000});
  Bridge.call = async (url) => { window.__bcalls.push(String(url)); return {ok: true, vouchers: []}; };
  window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []};
  TCloud.on = () => true; TCloud.has = () => !!window.__cloud.has;
  TCloud.book = () => window.__cloud.has ? {book: "bk-zz", from: "2026-04-01", to: "2026-11-30", company: "ZZ Test Dup Traders", daysAt: window.__cloud.at, state: {seen: window.__cloud.at}} : null;
  CloudTally.call = async (co, url) => { window.__ccalls.push(String(url)); if (window.__cloud.fail) throw {code: "cloud", message: "Failed to fetch"};
    return {ok: true, via: "cloud", vouchers: JSON.parse(JSON.stringify(window.__cloud.vouchers))}; };
  Bridge.post = async (p) => { window.__sent.push(p.vouchers.map(v => v.id)); return {ok: true, company: "ZZ Test Dup Traders",
    results: p.vouchers.map(v => ({id: v.id, ok: true, byReply: true, verified: false, created: 1}))}; }; }"""
RESET = "() => { window.__sent = []; window.__bcalls = []; window.__ccalls = []; window.__toasts = []; }"
TALLY_READS = "() => window.__bcalls.filter(u => /^\\/(vouchers|ledgerlines|tags|ledgervouchers|daybook)\\b/.test(u))"
last = lambda A: A.evaluate("() => window.__toasts.slice(-1)[0] || ''")

# ---- sales
GST = """() => { const mk = (b) => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; };
  return {up: mk('09AAACZ1234Q1Z'), k: mk('27AAACK5678P1Z'), m: mk('27AAACM9012R1Z'), up2: mk('27AAACZ1234Q1Z')}; }"""
LED = [["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"], ["Output IGST", "Duties & Taxes"]]
SETL = """([leds, g]) => { const cid = SL() ? SL().cid : CO().id, list = leds.map(([name, group, gk]) => ({name, group, gstin: gk ? g[gk] : ""}));
  Ledgers.st[cid] = {list, parents: {}, at: new Date().toISOString(), srcAt: new Date().toISOString(), src: "cloud", file: "", book: "", cloudAt: ""};
  if (S.bank && S.bank.cid === cid) S.bank.ledgers = {list, importedAt: new Date().toISOString(), live: true}; Ledgers.ver++; }"""
ADD = """([n, d, cg, tot]) => { const s = SL(), t = tot || 1180; const v = newInvoice({number: n, date: d, sellerGstin: CO().gstin, customerName: "Kappa Retail", customerGstin: cg, pos: "27", taxable: r2(t / 1.18),
  cgst: 0, sgst: 0, igst: r2(t - r2(t / 1.18)), cess: 0, total: t, items: []}, "upload"); s.list.push(v); mapInvoice(v); return v.id; }"""
NEWCO = """(g) => { const c = newCompany({name: "ZZ Test Dup Traders", gstin: g.up}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }"""
SST = "() => SL().list.map(v => ({n: v.x.number, st: v.status, match: (v.tallyMatch && v.tallyMatch.number) || '', copy: (v.copyCheck && v.copyCheck.note) || ''}))"
# the words of the old hold (the owner, 16-Nov-2026, superseded 23-Nov-2026): never on the posting path again
DUPW = ["Post duplicate anyway", "Post again anyway?"]
NODUP = lambda t: not any(w in t for w in DUPW)
QUIET = lambda t: NOTE not in t and "Looks already" not in t and "Post anyway" not in t and NODUP(t) and "Checked against" not in t
PAGE = "() => document.querySelector('#app').innerText + ' | ' + window.__toasts.join(' | ') + ' | ' + JSON.stringify(SL().list.map(v => [v.problems || [], v.postError || ''])) + ' | ' + JSON.stringify((SL().oneByOne || {}).rows || [])"
def sv(n, d="20261102", amt="1180.00", typ="Sales", party="Kappa Retail", gstin="", cmp=""):
    return "{guid: 'g-%s', masterId: '%s', date: '%s', %s%s%snumber: '%s', party: '%s', cancelled: 'No', entries: [{ledger: '%s', amount: '-%s'}]}" % (n, n, d, ("type: '%s', " % typ) if typ else "", ("partyGstin: '%s', " % gstin) if gstin else "", ("cmpGstin: '%s', " % cmp) if cmp else "", n, party, party, amt)
def sfresh(A, *nos, d="2026-11-02"):
    A.evaluate("() => { SL().list = []; SL().dupSkipped = []; SL().oneByOne = null; }"); A.evaluate(RESET)
    return [A.evaluate(ADD, [n, d, G["k"], 0]) for n in nos]

# ---- bank: a statement of made-up lines, the bank ledger confirmed
BANK = """async () => {
  const BK = "Zeta Bank", RCPT = "Sundry Receipts";
  const c = newCompany({name: "ZZ Test Dup Bank", gstin: "09AAKFZ1234C1Z5"}); c.tallyName = "ZZ Test Dup Traders"; c.bankAccounts = [{id: "a1", bank: "Zeta Bank", acct: "0001", ledger: BK}];
  choiceConfirm(c, "bank:a1", BK); choiceConfirm(c, "postTo", "ZZ Test Dup Traders");
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  await openCompany(c.id); S.tab = "bank";
  window.__bankRows = (n) => Array.from({length: n}, (_, i) => ({id: "s1-" + i, fp: "fp-dup-" + i, date: "2026-09-0" + (2 + i), debit: 0, credit: 2000 + 100 * i, narr: "NEFT CR CUSTOMER " + i,
    dec: {name: "CUSTOMER " + i, mode: "NEFT"}, ledger: RCPT, state: "ready", balOk: true, userSet: true}));
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Zeta Bank", acct: "0001", from: "2026-09-01", to: "2026-09-30"}], cur: "s1", rows: window.__bankRows(3), rules: [], wrules: [],
    ledgers: {list: [{name: BK, group: "Bank Accounts"}, {name: RCPT, group: "Sundry Debtors"}], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "ready", grouped: false,
    showSettings: false, q: "", limit: 500, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  try { localStorage.setItem(wideCheckKey(), String(Date.now())); } catch (e){}
  render(); return c.id; }"""
def bv(no, d, amt): return "{guid: 'gb-%s', masterId: '%s', date: '%s', type: 'Receipt', number: '%s', party: 'Sundry Receipts', narration: 'by hand', cancelled: 'No', entries: [{ledger: 'Zeta Bank', amount: '-%s'}, {ledger: 'Sundry Receipts', amount: '%s'}]}" % (no, no, d, no, amt, amt)
BST = "() => B().rows.map(r => ({id: r.id, st: r.state, err: r.postError || ''}))"
def bfresh(A, n=3):
    A.evaluate("(n) => { const b = B(); b.rows = window.__bankRows(n); b.postedTags = {}; b.postReport = null; b.tallyLook = null; b.books = {}; S.dupFind = null; }", n); A.evaluate(RESET)

# ---- purchase bills: approved bills of made-up suppliers
BILLS = """async () => {
  const c = newCompany({name: "ZZ Test Dup Bills", gstin: "09AANFZ3202D1ZR"}); c.tallyName = "ZZ Test Dup Traders";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional"); choiceConfirm(c, "postTo", "ZZ Test Dup Traders");
  await openCompany(c.id);
  const leds = ["Alpha Consultants", "Beta Consultants", "Gamma Consultants", "Professional Charges", "TDS Payable - Professional"];
  const now = new Date().toISOString(); Ledgers.take(c.id, {list: leds.map(n => ({name: n, group: /Charges/.test(n) ? "Indirect Expenses" : /TDS/.test(n) ? "Duties & Taxes" : "Sundry Creditors"})), src: "file", at: now, srcAt: now});
  window.__bill = (id, n, no, amt) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[S.coId].entries[e.id] = e; approve(e); return e; };
  window.postReconcile = () => 0; window.postJobStates = () => new Map(); window.remoteIdTrial = () => false; window.autoPostTo = async () => {};
  refreshStats(c.id); goStep("post", "bills"); render(); return c.id; }"""
def billv(no, party, amt): return "{guid: 'gp-%s', masterId: '1%s', date: '20260701', type: 'Journal', number: 'J-%s', reference: '%s', party: '%s', cancelled: 'No', entries: [{ledger: '%s', amount: '%s'}]}" % (no, len(no), no, no, party, party, amt)
EST = "(ids) => ids.map(id => { const e = D().entries[id]; return {id, sent: !!e.exportedAt, note: e.postNote || '', vch: e.tallyVchNo || ''}; })"
def billfresh(A, *spec):
    A.evaluate("() => { Object.keys(D().entries).forEach(k => delete D().entries[k]); S.billPost = null; }"); A.evaluate(RESET)
    for s in spec: A.evaluate("([id, n, no, amt]) => { window.__bill(id, n, no, amt); }", list(s))
    A.evaluate("() => { refreshStats(S.coId); render(); }")

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2); A = ctx.new_page(); A.on("pageerror", lambda e: errors.append(str(e)))
    A.goto("http://localhost:%d/" % PORT); A.wait_for_timeout(2500); A.evaluate(READY); A.wait_for_timeout(800)
    G = A.evaluate(GST)
    A.evaluate(NEWCO, G); A.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G]); A.evaluate(STUB)
    ok(A.evaluate("() => typeof DUP_NOT_CHECKED === 'string' && DUP_NOT_CHECKED") == NOTE, "the note's words (%s)" % A.evaluate("() => typeof DUP_NOT_CHECKED"))

    print("SALES 1. the copy has no data for the day: posted, Tally never read")
    sfresh(A, "ZS/1", "ZS/2")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate(SST)
    ok([x["st"] for x in st] == ["posted", "posted"], "both posted (%s)" % st)
    ok(A.evaluate(TALLY_READS) == [] and len(A.evaluate("() => window.__ccalls")) >= 1, "FinCom's copy asked, Tally not read (%s | %s)" % (A.evaluate("() => window.__bcalls"), A.evaluate("() => window.__ccalls")))
    ok(last(A).startswith("2 posted to Tally") and NOTE not in last(A), "the result: 2 posted, no note (%s)" % last(A))

    print("   the copy's last read old: posted, nothing said in the result; one small line on its panel")
    sfresh(A, "ZS/0")
    A.evaluate("() => { window.__cloud.at = new Date(Date.now() - 3 * 3600000).toISOString(); }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate(SST)
    ok(st[0]["st"] == "posted" and st[0]["copy"].startswith("Checked against FinCom's copy of Tally, last updated ") and QUIET(last(A)), "posted, the line on it, the result quiet (%s | %s)" % (st, last(A)))
    A.evaluate("() => { window.__cloud.at = new Date().toISOString(); }")

    print("SALES 2. the copy has the same invoice: In Tally quietly, with Tally's number; the other posted")
    sfresh(A, "ZS/3", "ZS/4")
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/3") + "]; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate(SST); sent = A.evaluate("() => window.__sent")
    ok([x["st"] for x in st] == ["intally", "posted"] and sent == [[A.evaluate("() => SL().list[1].id")]], "ZS/3 In Tally (not sent), ZS/4 posted (%s, sent %s)" % (st, sent))
    ok(st[0]["match"] == "ZS/3", "with Tally's number (%s)" % st[0]["match"])
    ok(A.evaluate(TALLY_READS) == [] and QUIET(last(A)) and last(A).startswith("1 posted to Tally"), "Tally not read; the result quiet (%s)" % last(A))
    A.evaluate("() => { SL().filter = 'all'; SL().openId = null; render(); }"); A.wait_for_timeout(500)
    ok("Post anyway" not in A.inner_text("#app") and "Looks already in Tally" not in A.inner_text("#app"), "no warning and no Post anyway on the page")

    print("SALES 3. the copy cannot be read: posted, nothing said; one small line on each invoice's panel")
    for label, cl in [("no copy", "{has: false, fail: false, at: '', vouchers: []}"), ("the copy does not answer", "{has: true, fail: true, at: new Date().toISOString(), vouchers: []}")]:
        sfresh(A, "ZS/5", "ZS/6")
        A.evaluate("() => { window.__cloud = " + cl + "; }")
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
        st = A.evaluate(SST)
        ok([x["st"] for x in st] == ["posted", "posted"] and A.evaluate(TALLY_READS) == [], label + ": both posted, Tally not read (%s)" % st)
        ok(QUIET(last(A)) and last(A).startswith("2 posted to Tally"), label + ": the result quiet (%s)" % last(A))
        ok(all(x["copy"] == NOTE for x in st), label + ": the line kept on each invoice (%s)" % st)
    A.evaluate("() => { SL().filter = 'done'; SL().openId = null; render(); }"); A.wait_for_timeout(500)
    ok(A.locator("[data-sales-copy]").count() == 0, "nothing on the rows")
    A.evaluate("() => { SL().openId = SL().list[0].id; render(); }"); A.wait_for_timeout(500)
    ok(A.locator("[data-sales-copy-note]").count() == 1 and NOTE in A.inner_text("[data-sales-copy-note]"), "the small line on the invoice's own panel")
    A.evaluate("() => { SL().openId = null; SL().filter = 'all'; render(); window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")

    print("SALES 4. a mixed batch: one found, one not, one with nothing for its day; nothing holds the batch")
    ids = sfresh(A, "ZS/7", "ZS/8")
    ids.append(A.evaluate(ADD, ["ZS/9", "2026-11-20", G["k"], 0]))
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/7") + ", " + sv("ZX/1") + "]; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate(SST)
    ok([x["st"] for x in st] == ["intally", "posted", "posted"] and st[0]["match"] == "ZS/7", "ZS/7 In Tally, ZS/8 and ZS/9 posted (%s)" % st)
    ok(A.evaluate("() => window.__sent") == [ids[1:]] and QUIET(last(A)), "the two sent together, the result quiet (%s | %s)" % (A.evaluate("() => window.__sent"), last(A)))
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        A.evaluate("() => { SL().filter = 'done'; SL().openId = null; render(); }"); A.wait_for_timeout(600)
        A.screenshot(path=os.path.join(SHOTS, "sales-mixed-batch-flows.png"))
        A.evaluate("() => { SL().filter = 'all'; render(); }")

    print("SALES 5. Post one by one: the same rule")
    ids = sfresh(A, "ZS/10", "ZS/11")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/10") + "]; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(700)
    st = A.evaluate(SST)
    ok([x["st"] for x in st] == ["intally", "posted"] and A.evaluate(TALLY_READS) == [] and QUIET(last(A)), "one by one: ZS/10 In Tally, ZS/11 posted, Tally not read, quiet (%s | %s)" % (st, last(A)))
    ids = sfresh(A, "ZS/12")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__cloud = {has: true, fail: true, at: new Date().toISOString(), vouchers: []}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(700)
    ok(A.evaluate(SST)[0]["st"] == "posted" and QUIET(last(A)), "one by one, the copy does not answer: posted, quiet (%s)" % last(A))
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")

    print("SALES 6. the copy has the same number of another amount: not the same entry, so posted; never held")
    ids = sfresh(A, "ZS/20", "ZS/21")
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/20", amt="999.00") + "]; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate(SST); sent = A.evaluate("() => window.__sent")
    ok([x["st"] for x in st] == ["posted", "posted"] and sent == [ids], "ZS/20 (₹999 in the copy, ₹1,180 here) and ZS/21 both posted (%s, sent %s)" % (st, sent))
    ok(last(A).startswith("2 posted to Tally") and QUIET(last(A)), "the result: 2 posted, nothing else (%s)" % last(A))
    A.evaluate("() => { SL().filter = 'all'; SL().openId = SL().list[0].id; render(); }"); A.wait_for_timeout(500)
    ok(NODUP(A.evaluate(PAGE)), "no “Post duplicate anyway” or “Post again anyway?” anywhere (%s)" % A.evaluate(PAGE)[:300])
    A.evaluate("() => { SL().openId = null; render(); }")
    print("   the same with Post one by one")
    ids = sfresh(A, "ZS/22")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/22", amt="999.00") + "]; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(700)
    st = A.evaluate(SST)
    ok(st[0]["st"] == "posted" and A.evaluate("() => window.__sent") == [ids] and NODUP(A.evaluate(PAGE)), "one by one: posted, never held (%s | %s)" % (st, A.evaluate(PAGE)[:300]))

    print("SALES 7. the same entry is the same number, amount and financial year")
    sfresh(A)
    ids = [A.evaluate(ADD, ["ZS/23", "2026-04-01", G["k"], 0])]
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/23", d="20260331") + "]; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate(SST)
    ok(st[0]["st"] == "posted" and A.evaluate("() => window.__sent") == [ids], "ZS/23 of 01-Apr-2026, the copy's ZS/23 of 31-Mar-2026 (another year): posted (%s)" % st)
    sfresh(A, "ZS/24")
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/24", d="20261103") + "]; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate(SST)
    ok(st[0]["st"] == "intally" and A.evaluate("() => window.__sent") == [], "ZS/24, the copy's of the same year and amount: In Tally, not sent (%s)" % st)
    ok(last(A).startswith("1 already in Tally") and "These invoices are already in Tally" not in last(A) and QUIET(last(A)), "the result says what happened (%s)" % last(A))

    print("SALES 8. FinCom's own posted invoice: the same entry In Tally quietly; another amount posted")
    ids = sfresh(A, "ZS/25", "ZS/26")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'posted'; })", ids)
    a = A.evaluate(ADD, ["ZS/25", "2026-11-02", G["k"], 0]); b = A.evaluate(ADD, ["ZS/26", "2026-11-02", G["k"], 999])
    A.evaluate("() => { window.__cloud.vouchers = []; SL().filter = 'all'; render(); }"); A.wait_for_timeout(300)
    ok(NODUP(A.evaluate(PAGE)) and A.evaluate("(ids) => ids.map(id => SL().list.find(v => v.id === id).status)", [a, b]) == ["ready", "ready"], "before posting: both Ready, no hold (%s)" % A.evaluate(SST))
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate("(ids) => ids.map(id => SL().list.find(v => v.id === id).status)", [a, b])
    ok(st == ["intally", "posted"] and A.evaluate("() => window.__sent") == [[b]] and NODUP(A.evaluate(PAGE)), "ZS/25 (₹1,180 as posted) In Tally, ZS/26 (₹999 against ₹1,180) posted (%s, sent %s)" % (st, A.evaluate("() => window.__sent")))
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")

    print("SALES 9. Not that entry on a match with FinCom's own posted invoice: Post then posts it")
    box = lambda: A.inner_text("#confirmBox").replace("\n", " ") if A.locator("#confirmBox .cbx").count() else ""
    ID = "(id) => SL().list.find(v => v.id === id)"
    for label, copy in [("the copy empty", ""), ("the copy holding FinCom's own posting", "ZS/30")]:
        ids = sfresh(A, "ZS/30")
        A.evaluate("(ids) => ids.forEach(id => { SL().list.find(v => v.id === id).status = 'posted'; })", ids)
        a = A.evaluate(ADD, ["ZS/30", "2026-11-02", G["k"], 0])
        A.evaluate("() => { window.__cloud.vouchers = [" + (sv(copy) if copy else "") + "]; }")
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
        ok(A.evaluate("(id) => SL().list.find(v => v.id === id).status", a) == "intally" and A.evaluate("() => window.__sent") == [], label + ": the same entry first In Tally (%s)" % A.evaluate(SST))
        A.evaluate("(id) => salesRowAct('nottally', id)", a); A.wait_for_timeout(500)
        for i in range(2):
            if A.locator('#confirmBox [data-cbx="yes"]').count(): A.click('#confirmBox [data-cbx="yes"]'); A.wait_for_timeout(400)
        ok(A.evaluate("(id) => SL().list.find(v => v.id === id).status", a) == "review", label + ": Not that entry: back to To review (%s)" % A.evaluate(SST))
        A.evaluate("(id) => salesRowAct('confirm', id)", a); A.wait_for_timeout(200)
        A.evaluate(RESET); A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
        ok(A.evaluate("(id) => SL().list.find(v => v.id === id).status", a) == "posted" and A.evaluate("() => window.__sent") == [[a]], label + ": confirmed and posted, actually sent (%s, sent %s, %s)" % (A.evaluate(SST), A.evaluate("() => window.__sent"), last(A)))
        A.evaluate("() => { SL().cfg.notTally = {}; }")
    A.evaluate("() => { window.__cloud.vouchers = []; }")

    print("SALES 10. the same entry is also the exact voucher type and the same customer")
    for label, v in [("another customer", sv("ZS/40", party="Omega Stores")),
                     ("no type in the copy", sv("ZS/40", typ="")), ("a Credit Note of that number", sv("ZS/40", typ="Credit Note"))]:
        ids = sfresh(A, "ZS/40")
        A.evaluate("() => { window.__cloud.vouchers = [" + v + "]; }")
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
        ok(A.evaluate(SST)[0]["st"] == "posted" and A.evaluate("() => window.__sent") == [ids], label + ": posted (%s)" % A.evaluate(SST))
    print("   FinCom's own: another customer, or another type of the same number, posts")
    ids = sfresh(A, "ZS/41", "ZS/42")
    A.evaluate("(ids) => { const [p, q] = ids.map(id => SL().list.find(v => v.id === id)); p.status = 'posted'; p.customerLedger = 'Omega Stores'; p.x.customerGstin = ''; q.status = 'posted'; q.x.noteKind = 'credit'; }", ids)
    a = A.evaluate(ADD, ["ZS/41", "2026-11-02", G["k"], 0]); b = A.evaluate(ADD, ["ZS/42", "2026-11-02", G["k"], 0])
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    st = A.evaluate("(ids) => ids.map(id => SL().list.find(v => v.id === id).status)", [a, b])
    ok(st == ["posted", "posted"] and A.evaluate("() => window.__sent") == [[a, b]], "ZS/41 (posted to another customer) and ZS/42 (a credit note of that number posted) both posted (%s)" % st)
    print("   the GSTIN when both have one: the same GSTIN under another ledger name is the same customer")
    ids = sfresh(A, "ZS/43")
    A.evaluate("(ids) => { const p = SL().list.find(v => v.id === ids[0]); p.status = 'posted'; p.customerLedger = 'Kappa Retail (Mumbai)'; }", ids)
    a = A.evaluate(ADD, ["ZS/43", "2026-11-02", G["k"], 0])
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    ok(A.evaluate("(id) => SL().list.find(v => v.id === id).status", a) == "intally" and A.evaluate("() => window.__sent") == [], "the same GSTIN: In Tally (%s)" % A.evaluate(SST))

    print("SALES 13. both with a GSTIN and the same one: any Sales-class type is the same type; else the exact type")
    SST1 = "(id) => { const v = SL().list.find(v => v.id === id); return v.status + (v.tallyMatch && v.tallyMatch.type ? ' ' + v.tallyMatch.type : ''); }"
    def one(n, cg, copy, d="2026-11-02"):
        sfresh(A); a = A.evaluate(ADD, [n, d, cg, 0])
        # (a customer with no GSTIN is matched by name, not sure: a person sets its ledger, so it is Ready)
        if not cg: A.evaluate("(id) => { const v = SL().list.find(v => v.id === id); v.userLedger = true; mapInvoice(v); }", a)
        A.evaluate("() => { window.__cloud.vouchers = [" + copy + "]; }")
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
        return a, A.evaluate(SST1, a), A.evaluate("() => window.__sent")
    a, st, sent = one("ZS/70", G["k"], sv("ZS/70", typ="Sales UP"))
    ok(st == "intally Sales UP" and sent == [], "cloud copy: 'Sales' here, 'Sales UP' in the copy, the same GSTIN: In Tally, not sent (%s, sent %s)" % (st, sent))
    a, st, sent = one("ZS/71", G["k"], sv("ZS/71", typ="Sales UP", gstin=G["k"]))
    ok(st == "intally Sales UP" and sent == [], "cloud copy: the same GSTIN on the copy's voucher itself: In Tally (%s)" % st)
    a, st, sent = one("ZS/72", "", sv("ZS/72", typ="Sales UP"))
    ok(st == "posted" and sent == [[a]], "cloud copy: no GSTIN on the invoice, 'Sales UP' against 'Sales': posted (%s, sent %s)" % (st, sent))
    a, st, sent = one("ZS/73", "", sv("ZS/73", typ="Sales UP", party="Lambda Stores"))
    ok(st == "posted" and sent == [[a]], "cloud copy: neither with a GSTIN, another type: posted (%s)" % st)
    a, st, sent = one("ZS/74", G["k"], sv("ZS/74", typ="Sales UP", party="Mu Traders", gstin=G["m"]))
    ok(st == "posted" and sent == [[a]], "cloud copy: another GSTIN: posted (%s)" % st)
    a, st, sent = one("ZS/75", G["k"], sv("ZS/75", typ="Credit Note"))
    ok(st == "posted" and sent == [[a]], "cloud copy: a Credit Note of that number, the same GSTIN: never the sale, posted (%s)" % st)
    a, st, sent = one("ZS/76", G["k"], sv("ZS/76", typ="Sales Return"))
    ok(st == "posted" and sent == [[a]], "cloud copy: a Sales Return of that number: posted (%s)" % st)
    a, st, sent = one("ZS/77", G["k"], sv("ZS/77", typ="Sales UP", amt="1182.00"))
    ok(st == "posted" and sent == [[a]], "cloud copy: 'Sales UP', the same GSTIN, ₹2 off: posted (%s)" % st)
    a, st, sent = one("ZS/78", G["k"], sv("ZS/78", typ="Sales UP", amt="1180.90"))
    ok(st == "intally Sales UP", "cloud copy: 'Sales UP', the same GSTIN, 90 paise off: In Tally (%s)" % st)
    a, st, sent = one("ZS/79", G["k"], sv("ZS/79", typ="Sales UP", d="20260331"), d="2026-04-01")
    ok(st == "posted" and sent == [[a]], "cloud copy: 'Sales UP', the same GSTIN, another financial year: posted (%s)" % st)
    a, st, sent = one("ZS/80", G["k"], sv("ZS/81", typ="Sales UP"))
    ok(st == "posted" and sent == [[a]], "cloud copy: 'Sales UP', the same GSTIN, another number: posted (%s)" % st)
    print("   FinCom's own: an invoice In Tally as 'Sales UP', another 'Sales' invoice of that number")
    def own(n, cg, mine="Sales UP", note=False, mg=None):
        ids = sfresh(A, n)
        A.evaluate("([id, t, note, g]) => { const p = SL().list.find(v => v.id === id); p.status = 'intally'; p.tallyMatch = {key: 'k-' + id, number: p.x.number, type: t, date: '20261102'}; if (note) p.x.noteKind = 'credit'; if (g !== null) p.x.customerGstin = g; }", [ids[0], mine, note, mg])
        a = A.evaluate(ADD, [n, "2026-11-02", cg, 0])
        # (a customer with no GSTIN is matched by name, not sure: a person sets its ledger, so it is Ready)
        if not cg: A.evaluate("(id) => { const v = SL().list.find(v => v.id === id); v.userLedger = true; mapInvoice(v); }", a)
        A.evaluate("() => { window.__cloud.vouchers = []; }")
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
        return a, A.evaluate("(id) => SL().list.find(v => v.id === id).status", a), A.evaluate("() => window.__sent")
    a, st, sent = own("ZS/90", G["k"])
    ok(st == "intally" and sent == [], "FinCom's own: the same GSTIN: In Tally, not sent (%s, sent %s)" % (st, sent))
    a, st, sent = own("ZS/91", "")
    ok(st == "posted" and sent == [[a]], "FinCom's own: no GSTIN on the new invoice: the exact type, posted (%s)" % st)
    a, st, sent = own("ZS/92", G["k"], mg="")
    ok(st == "posted" and sent == [[a]], "FinCom's own: no GSTIN on the one In Tally: the exact type, posted (%s)" % st)
    a, st, sent = own("ZS/93", G["k"], mg=G["m"])
    ok(st == "posted" and sent == [[a]], "FinCom's own: another GSTIN: posted (%s)" % st)
    a, st, sent = own("ZS/94", G["k"], mine="Credit Note", note=True)
    ok(st == "posted" and sent == [[a]], "FinCom's own: a credit note of that number, the same GSTIN: posted (%s)" % st)
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")

    print("SALES 14. never a note, a return, a Journal or a receipt by any word of its type; several registrations: the exact type")
    for i, t in enumerate(["Sales CN", "Sales DN", "Sales Journal", "Sales Advance Receipt", "Sales Credit Note", "Debit Sales", "Sales Returns", "Payment Sales"]):
        a, st, sent = one("ZS/10%d" % i, G["k"], sv("ZS/10%d" % i, typ=t))
        ok(st == "posted" and sent == [[a]], "cloud copy: '%s', the same GSTIN: never the sale, posted (%s)" % (t, st))
    a, st, sent = one("ZS/110", G["k"], sv("ZS/110", typ="Sales UP", cmp=G["up"]))
    ok(st == "intally Sales UP", "cloud copy: 'Sales UP' issued from the client's own GSTIN, one registration: In Tally (%s)" % st)
    def one_s(n, cp, seller=None):
        sfresh(A); a = A.evaluate(ADD, [n, "2026-11-02", G["k"], 0])
        if seller: A.evaluate("([id, g]) => { const v = SL().list.find(v => v.id === id); v.x.sellerGstin = g; mapInvoice(v); }", [a, seller])
        A.evaluate("() => { window.__cloud.vouchers = [" + cp + "]; }")
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
        return a, A.evaluate(SST1, a), A.evaluate("() => window.__sent")
    a, st, sent = one_s("ZS/111", sv("ZS/111", typ="Sales UP", cmp=G["up2"]), seller=G["up"])
    ok(st == "posted" and sent == [[a]], "cloud copy: 'Sales UP' issued from another GSTIN than the invoice's: the exact type, posted (%s)" % st)
    a, st, sent = one_s("ZS/112", sv("ZS/112", typ="Sales", cmp=G["up2"]), seller=G["up"])
    ok(st == "intally Sales", "cloud copy: the exact type stays the same entry, whatever the GSTIN it was issued from (%s)" % st)
    A.evaluate("(g) => { CO().otherGstins = g; }", G["up2"])
    a, st, sent = one("ZS/113", G["k"], sv("ZS/113", typ="Sales UP"))
    ok(st == "posted" and sent == [[a]], "cloud copy: the client with two registrations, 'Sales UP' against 'Sales': the exact type, posted (%s)" % st)
    a, st, sent = one("ZS/114", G["k"], sv("ZS/114", typ="Sales"))
    ok(st == "intally Sales", "cloud copy: two registrations, the exact type: In Tally (%s)" % st)
    a, st, sent = own("ZS/115", G["k"])
    ok(st == "posted" and sent == [[a]], "FinCom's own: two registrations, 'Sales UP' In Tally against 'Sales': posted (%s)" % st)
    A.evaluate("() => { CO().otherGstins = ''; }")
    ids = sfresh(A, "ZS/116")
    A.evaluate("([id, g]) => { const p = SL().list.find(v => v.id === id); p.status = 'intally'; p.x.sellerGstin = g; p.tallyMatch = {key: 'k-' + id, number: p.x.number, type: 'Sales UP', date: '20261102'}; }", [ids[0], G["up2"]])
    a = A.evaluate(ADD, ["ZS/116", "2026-11-02", G["k"], 0])
    A.evaluate("([id, g]) => { const v = SL().list.find(v => v.id === id); v.x.sellerGstin = g; mapInvoice(v); window.__cloud.vouchers = []; }", [a, G["up"]])
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    ok(A.evaluate("(id) => SL().list.find(v => v.id === id).status", a) == "posted", "FinCom's own: another seller GSTIN, 'Sales UP' against 'Sales': posted (%s)" % A.evaluate(SST1, a))

    print("SALES 11. the duplicate check's line on the invoice: the info tone, not amber")
    sfresh(A, "ZS/50")
    A.evaluate("() => { window.__cloud = {has: true, fail: true, at: new Date().toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    A.evaluate("() => { SL().filter = 'done'; SL().openId = SL().list[0].id; render(); }"); A.wait_for_timeout(500)
    tone = A.evaluate("""() => { const n = document.querySelector('[data-sales-copy-note]'), p = document.createElement('div'); p.className = 'bk-alert'; n.parentElement.appendChild(p);
      const w = getComputedStyle(p).backgroundColor; p.remove(); const i = document.createElement('span'); i.style.color = 'var(--info-soft)'; document.body.appendChild(i); const want = getComputedStyle(i).color; i.remove();
      return {bg: getComputedStyle(n).backgroundColor, amber: w, want}; }""")
    ok(tone["bg"] != tone["amber"] and tone["bg"] == tone["want"], "the line's fill is the info tone, not the amber notice (%s)" % tone)
    if SHOTS: A.screenshot(path=os.path.join(SHOTS, "sales-copy-note-info.png"))
    A.evaluate("() => { SL().openId = null; render(); window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")

    print("SALES 12. an In Tally row: Open and Not this Tally entry fit, at desk and phone width")
    sfresh(A, "ZS/60", "ZS/61")
    A.evaluate("() => { window.__cloud.vouchers = [" + sv("ZS/60") + "]; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(700)
    for w in (1440, 390):
        A.set_viewport_size({"width": w, "height": 900})
        A.evaluate("() => { SL().filter = 'done'; SL().openId = null; render(); }"); A.wait_for_timeout(700)
        fit = A.evaluate("""() => { const tr = Array.from(document.querySelectorAll('#app table.bk-table tbody tr')).find(r => /ZS\\/60/.test(r.innerText)); if (!tr) return {none: true};
          const wrap = tr.closest('.bk-tablewrap').getBoundingClientRect(), vw = document.documentElement.clientWidth;
          const bs = Array.from(tr.querySelectorAll('button')).filter(b => /^(Open|Not this Tally entry)$/.test(b.innerText.trim()));
          return {words: bs.map(b => b.innerText.trim()), out: bs.filter(b => { const r = b.getBoundingClientRect(); return r.right > Math.min(wrap.right, vw) + 0.5 || r.left < wrap.left - 0.5 || b.scrollWidth > b.clientWidth + 1; }).map(b => b.innerText.trim()),
            scroll: document.documentElement.scrollWidth > vw}; }""")
        ok(fit.get("words") and sorted(fit["words"]) == ["Not this Tally entry", "Open"] and not fit["out"] and not fit["scroll"], "width %d: both buttons whole, inside the table (%s)" % (w, fit))
        if SHOTS: A.screenshot(path=os.path.join(SHOTS, "sales-intally-row-%d.png" % w), full_page=True)
    A.set_viewport_size({"width": 1440, "height": 900})
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; SL().filter = 'all'; render(); }")

    print("BANK 1. the copy has no data for those days: posted, Tally never read")
    A.evaluate(BANK); A.wait_for_timeout(800); A.evaluate(STUB)
    bfresh(A)
    A.evaluate("() => postBankToTally()"); A.wait_for_timeout(900)
    st = A.evaluate(BST)
    ok([x["st"] for x in st] == ["sent"] * 3, "all three posted (%s)" % st)
    ok(A.evaluate(TALLY_READS) == [] and len(A.evaluate("() => window.__ccalls")) >= 1, "FinCom's copy asked, Tally not read (%s | %s)" % (A.evaluate("() => window.__bcalls"), A.evaluate("() => window.__ccalls")))

    print("BANK 2. the copy has one line: In Tally quietly, with Tally's voucher; the others posted (a mixed batch)")
    bfresh(A)
    A.evaluate("() => { window.__cloud.vouchers = [" + bv("R-77", "20260903", "2100.00") + "]; }")
    A.evaluate("() => postBankToTally()"); A.wait_for_timeout(900)
    st = A.evaluate(BST); sent = A.evaluate("() => window.__sent")
    ok([x["st"] for x in st] == ["sent", "intally", "sent"] and sent == [["s1-0", "s1-2"]], "the line found In Tally, the other two posted (%s, sent %s)" % (st, sent))
    ok("R-77" in A.evaluate("() => B().rows[1].tallyRef || ''"), "with Tally's number (%s)" % A.evaluate("() => B().rows[1].tallyRef"))
    rep = A.evaluate("() => B().postReport")
    ok(not rep.get("checkNote") and A.evaluate(TALLY_READS) == [], "no note, Tally not read (%s)" % rep)
    A.evaluate("() => { B().filter = 'all'; render(); }"); A.wait_for_timeout(600)
    ok("Post anyway" not in A.inner_text("#app") and "Looks already in Tally" not in A.inner_text("#app"), "no warning on the page")

    print("BANK 3. the copy cannot be read: posted, nothing said")
    for label, cl in [("no copy", "{has: false, fail: false, at: '', vouchers: []}"), ("the copy does not answer", "{has: true, fail: true, at: new Date().toISOString(), vouchers: []}")]:
        bfresh(A, 2)
        A.evaluate("() => { window.__cloud = " + cl + "; }")
        A.evaluate("() => postBankToTally()"); A.wait_for_timeout(900)
        st = A.evaluate(BST)
        ok([x["st"] for x in st] == ["sent", "sent"] and A.evaluate(TALLY_READS) == [], label + ": posted, Tally not read (%s)" % st)
        ok(not A.evaluate("() => B().postReport.checkNote") and NOTE not in A.inner_text("#app"), label + ": nothing said (%s)" % A.evaluate("() => B().postReport"))
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")

    print("BILLS 1. the copy has no data: posted, Tally never read")
    A.evaluate(BILLS); A.wait_for_timeout(900); A.evaluate(STUB)
    billfresh(A, ("p1", "Alpha Consultants", "A/1", 30000), ("p2", "Beta Consultants", "B/1", 20000))
    A.evaluate("() => postBillsToTally()"); A.wait_for_timeout(900)
    st = A.evaluate(EST, ["p1", "p2"])
    ok([x["sent"] for x in st] == [True, True], "both posted (%s)" % st)
    ok(A.evaluate(TALLY_READS) == [] and len(A.evaluate("() => window.__ccalls")) >= 1, "FinCom's copy asked, Tally not read (%s | %s)" % (A.evaluate("() => window.__bcalls"), A.evaluate("() => window.__ccalls")))

    print("BILLS 2. the copy has the same bill: In Tally quietly, with Tally's number; the others posted (a mixed batch)")
    billfresh(A, ("p3", "Alpha Consultants", "A/2", 30000), ("p4", "Beta Consultants", "B/2", 20000), ("p5", "Gamma Consultants", "C/2", 10000))
    A.evaluate("() => { window.__cloud.vouchers = [" + billv("A/2", "Alpha Consultants", "27000.00") + "]; }")
    A.evaluate("() => postBillsToTally()"); A.wait_for_timeout(900)
    st = A.evaluate(EST, ["p3", "p4", "p5"]); sent = A.evaluate("() => window.__sent")
    ok([x["sent"] for x in st] == [True, True, True] and sent == [["p4", "p5"]], "A/2 not sent, the other two posted (%s, sent %s)" % (st, sent))
    ok(st[0]["note"] == "Already in Tally" and st[0]["vch"] == "J-A/2", "A/2 In Tally, with Tally's number (%s)" % st[0])
    ok(A.evaluate(TALLY_READS) == [] and not A.evaluate("() => S.billPost.checkNote"), "Tally not read, no note")
    ok("Post anyway" not in A.inner_text("#app") and "Looks already in Tally" not in A.inner_text("#app"), "no warning on the page")

    print("BILLS 3. the copy cannot be read: posted, nothing said")
    for k, (label, cl) in enumerate([("no copy", "{has: false, fail: false, at: '', vouchers: []}"), ("the copy does not answer", "{has: true, fail: true, at: new Date().toISOString(), vouchers: []}")]):
        billfresh(A, ("p6", "Alpha Consultants", "A/3%d" % k, 30000))
        A.evaluate("() => { window.__cloud = " + cl + "; }")
        A.evaluate("() => postBillsToTally()"); A.wait_for_timeout(900)
        ok(A.evaluate(EST, ["p6"])[0]["sent"] and A.evaluate(TALLY_READS) == [], label + ": posted, Tally not read (%s | %s)" % (A.evaluate("() => window.__toasts"), A.evaluate("() => window.__sent")))
        ok(not A.evaluate("() => (S.billPost || {}).checkNote") and QUIET(last(A)), label + ": nothing said (%s)" % last(A))

    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
