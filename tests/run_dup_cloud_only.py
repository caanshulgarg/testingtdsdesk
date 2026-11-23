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
  return {up: mk('09AAACZ1234Q1Z'), k: mk('27AAACK5678P1Z')}; }"""
LED = [["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"], ["Output IGST", "Duties & Taxes"]]
SETL = """([leds, g]) => { const cid = SL() ? SL().cid : CO().id, list = leds.map(([name, group, gk]) => ({name, group, gstin: gk ? g[gk] : ""}));
  Ledgers.st[cid] = {list, parents: {}, at: new Date().toISOString(), srcAt: new Date().toISOString(), src: "cloud", file: "", book: "", cloudAt: ""};
  if (S.bank && S.bank.cid === cid) S.bank.ledgers = {list, importedAt: new Date().toISOString(), live: true}; Ledgers.ver++; }"""
ADD = """([n, d, cg, tot]) => { const s = SL(), t = tot || 1180; const v = newInvoice({number: n, date: d, customerName: "Kappa Retail", customerGstin: cg, pos: "27", taxable: r2(t / 1.18),
  cgst: 0, sgst: 0, igst: r2(t - r2(t / 1.18)), cess: 0, total: t, items: []}, "upload"); s.list.push(v); mapInvoice(v); return v.id; }"""
NEWCO = """(g) => { const c = newCompany({name: "ZZ Test Dup Traders", gstin: g.up}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }"""
SST = "() => SL().list.map(v => ({n: v.x.number, st: v.status, match: (v.tallyMatch && v.tallyMatch.number) || '', copy: (v.copyCheck && v.copyCheck.note) || ''}))"
QUIET = lambda t: NOTE not in t and "Looks already" not in t and "anyway" not in t.lower() and "Checked against" not in t
def sv(n, d="20261102", amt="1180.00"): return "{guid: 'g-%s', masterId: '%s', date: '%s', type: 'Sales', number: '%s', party: 'Kappa Retail', cancelled: 'No', entries: [{ledger: 'Kappa Retail', amount: '-%s'}]}" % (n, n, d, n, amt)
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
