"""python3 run_sales_sync.py - Sales on two computers (next-fix-sales-sync, 16-Nov-2026: one computer said Ready, the
other To review, for the same uploaded invoices; "Post to Tally" did nothing on one; Sales settings with empty ledgers
from one computer wiped the other's; a state-09 client's CGST taken as a ledger tagged "(DL)"). Made-up data only.
  1. two browsers sharing the synced rows: an invoice saved "To review" by a computer without the ledger list comes to
     the other, which has the list (the cloud copy): on opening Sales it is mapped again, Ready, and saved so; a posted
     invoice and a GST ledger set by a person are not touched; a list that comes in later maps them then;
  2. a Post click that throws ends in a message ("Posting failed: …"), the bar not left busy; a Tally company not found
     says so;
  3. Sales settings merged key by key: a copy with empty ledgers (or none) never wipes the ledgers set here; a setting
     changed later on the other computer wins, entry by entry;
  4. one registration (09) and only ledgers tagged "(DL)": offered as a one-click choice, never picked by themselves;
     untagged ledgers picked as before.
Run on the React build: TDSDESK_SITE=../app/dist-test SYNC_PORT=8955 python3 run_sales_sync.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PORT = int(os.environ.get("SYNC_PORT") or 8167)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
GST = """() => { const mk = (b) => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; };
  return {up: mk('09AAACZ1234Q1Z'), k: mk('09AAACK5678P1Z'), l: mk('09AAACL5678P1Z')}; }"""
LED = [["Kappa Retail", "Sundry Debtors", "k"], ["Lambda Stores", "Sundry Debtors", "l"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
       ["Output CGST", "Duties & Taxes"], ["Output SGST", "Duties & Taxes"], ["Output CGST Spare", "Current Liabilities"]]
# the ledger list as the cloud copy holds it (Ledgers.st: the client's one list), and the bank's copy
SETL = """([leds, g]) => { const cid = SL() ? SL().cid : CO().id, list = leds.map(([name, group, gk]) => ({name, group, gstin: gk ? g[gk] : ""}));
  Ledgers.st[cid] = {list, parents: {}, at: new Date().toISOString(), srcAt: new Date().toISOString(), src: "cloud", file: "", book: "", cloudAt: ""};
  if (S.bank && S.bank.cid === cid) S.bank.ledgers = {list, importedAt: new Date().toISOString(), live: true}; Ledgers.ver++; }"""
ADD = """([n, cg, cname, t]) => { const s = SL(); const v = newInvoice({number: n, date: "2026-10-05", customerName: cname, customerGstin: cg, pos: "09", taxable: t,
  cgst: r2(t * 0.09), sgst: r2(t * 0.09), igst: 0, cess: 0, total: r2(t * 1.18), items: []}, "upload"); s.list.push(v); mapInvoice(v); return v.id; }"""
NEWCO = """(g) => { const c = newCompany({name: "ZZ Test Sync Traders", gstin: g.up}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }"""
TOASTS = "() => { window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); }; }"
TAX = """(n) => { const v = SL().list.find(v => v.x.number === n); return {st: v.status, tax: salesLines(v).filter(l => l.role === 'tax').map(l => l.ledger), ask: (v.taxAsk || []).map(a => a.cands)}; }"""

with sync_playwright() as p:
    br = p.chromium.launch()
    def open_page():
        ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(READY); pg.wait_for_timeout(800)
        return ctx, pg
    ctxA, A = open_page(); ctxB, B = open_page()
    G = A.evaluate(GST)

    print("1. two computers: a status saved without the ledger list is worked out again where the list is")
    cid = A.evaluate(NEWCO, G); A.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G])
    for n, cg, cn in [("S/1", G["k"], "Kappa Retail"), ("S/2", G["l"], "Lambda Stores"), ("S/3", G["k"], "Kappa Retail")]: A.evaluate(ADD, [n, cg, cn, 1000])
    st = A.evaluate("() => SL().list.map(v => v.status)")
    ok(st == ["ready", "ready", "ready"], "computer A, with the ledger list: all three Ready (%s)" % st)
    # S/1 and S/2 as a computer without the ledger list saved them (To review, "Tally ledger list not loaded"); S/2's CGST
    # set by a person; S/3 posted
    rows = A.evaluate("""() => { const s = SL();
      s.list.slice(0, 2).forEach(v => { v.status = 'review'; v.ledgerIssues = ['Tally ledger list not loaded']; v.taxPicks = []; v.taxAsk = []; v.customerLedger = ''; v.custSource = ''; v.custSure = false; });
      s.list[1].taxLedgers = {cgst_18: 'Output CGST Spare'};
      Object.assign(s.list[2], {status: 'posted', postedAt: '2026-10-06T10:00:00.000Z', customerLedger: 'Lambda Stores', userLedger: true, custSource: 'Set by you'});
      saveSales();
      return cloudSnapshot().filter(r => ['client', 'sales', 'sales_cfg'].includes(r.kind) && r.client_id === s.cid).map(r => Object.assign({deleted: false, updated_at: new Date().toISOString()}, JSON.parse(JSON.stringify(r)))); }""")
    ok(len([r for r in rows if r["kind"] == "sales"]) == 3, "the rows the cloud would carry: the client, the settings, three invoices (%d)" % len(rows))
    # computer B: the same rows come in (the sync's own apply), then the cloud copy's ledger list, then Sales is opened
    B.evaluate("async (rows) => { await cloudApply(rows); }", rows); B.wait_for_timeout(500)
    ok(B.evaluate("(cid) => !!S.companies[cid]", cid), "computer B has the client from the synced rows")
    B.evaluate("(cid) => openCompany(cid).then(() => loadBank(cid))", cid); B.wait_for_timeout(500)
    saved0 = B.evaluate("(cid) => BankDB.get('sales:' + cid).then(l => l.map(v => v.status))", cid)
    ok(saved0 == ["review", "review", "posted"], "B's own copy as synced: the stale To review (%s)" % saved0)
    B.evaluate(SETL.replace("SL() ? SL().cid : CO().id", "CO().id"), [LED, G])
    B.evaluate("(cid) => { S.tab = 'sales'; S.step = null; return loadSales(cid).then(() => render()); }", cid); B.wait_for_timeout(1200)
    st = B.evaluate("() => SL().list.map(v => [v.x.number, v.status, v.customerLedger])")
    ok([x[1] for x in st] == ["ready", "ready", "posted"], "on opening, with the list from the cloud copy: S/1 and S/2 Ready, S/3 still posted (%s)" % st)
    ok(B.evaluate("() => salesLines(SL().list[1]).find(l => l.kind === 'cgst').ledger") == "Output CGST Spare", "the CGST ledger set by a person stays")
    ok(B.evaluate("() => [SL().list[2].customerLedger, SL().list[2].postedAt]") == ["Lambda Stores", "2026-10-06T10:00:00.000Z"], "the posted invoice is not touched")
    B.wait_for_timeout(900)
    saved = B.evaluate("(cid) => BankDB.get('sales:' + cid).then(l => l.map(v => v.status))", cid)
    ok(saved == ["ready", "ready", "posted"], "and saved so, for the cloud (%s)" % saved)
    # nothing changed: nothing saved again
    n0 = B.evaluate("() => SALES_REV")
    B.evaluate("(cid) => loadSales(cid)", cid); B.wait_for_timeout(600)
    ok(B.evaluate("() => SALES_REV") - n0 == 1, "opened again with nothing changed: not saved again (only the load counted)")
    # the list comes later: To review on opening, Ready once it is here
    B.evaluate("""(cid) => { SL().list.slice(0, 2).forEach(v => { v.status = 'review'; v.ledgerIssues = ['Tally ledger list not loaded']; }); saveSales(); }""", cid); B.wait_for_timeout(700)
    B.evaluate("(cid) => { delete Ledgers.st[cid]; S.bank.ledgers = {list: [], importedAt: ''}; Ledgers.ver++; }", cid)
    B.evaluate("(cid) => loadSales(cid)", cid); B.wait_for_timeout(600)
    B.evaluate("(cid) => { delete Ledgers.st[cid]; S.bank.ledgers = {list: [], importedAt: ''}; Ledgers.ver++; }", cid)
    st0 = B.evaluate("() => SL().list.map(v => v.status)")
    B.evaluate(SETL, [LED, G]); B.evaluate("(cid) => ledgersChanged(cid)", cid); B.wait_for_timeout(400)
    st1 = B.evaluate("() => SL().list.map(v => v.status)")
    ok(st1 == ["ready", "ready", "posted"], "a ledger list that comes in later: mapped then (%s → %s)" % (st0, st1))
    # 5,000 invoices mapped again in one go: no work for each pair of them
    ms = B.evaluate("""() => { const s = SL(), v0 = s.list[0]; for (let i = 0; i < 5000; i++){ const v = JSON.parse(JSON.stringify(v0)); v.id = 'bulk' + i; v.x.number = 'B/' + i; v.status = 'review'; s.list.push(v); }
      s.remapKey = null; const t = performance.now(); salesRemapWaiting(); const ms = performance.now() - t; s.list = s.list.filter(v => !/^bulk/.test(v.id)); return ms; }""")
    ok(ms < 4000, "5,000 invoices mapped again in %d ms" % ms)

    print("2. Post never silent")
    B.evaluate(TOASTS)
    B.evaluate("() => { window.__etc = window.ensureTallyCompany; window.ensureTallyCompany = async () => { throw new Error('the bridge did not answer'); }; }")
    B.evaluate("() => salesAct('salesPost')"); B.wait_for_timeout(600)
    t = B.evaluate("() => window.__toasts")
    ok(any(x.startswith("Posting failed: the bridge did not answer") for x in t) and not B.evaluate("() => SL().busy"), "a Post click that throws: \"Posting failed: …\", not left busy (%s)" % t)
    B.evaluate("() => { window.ensureTallyCompany = window.__etc; window.__toasts = []; TCloud.on = () => true; TCloud.status = async () => []; Bridge.on = () => false; }")
    B.evaluate("() => salesAct('salesPost')"); B.wait_for_timeout(600)
    t = B.evaluate("() => window.__toasts")
    ok(any("not open on any computer" in x for x in t), "no bridge here, no Tally company in the cloud: said so (%s)" % t)
    B.evaluate("() => { SL().list.forEach(v => { if (v.status === 'ready') v.status = 'review'; v.problems = ['CGST and SGST differ: check: the sheet']; }); render(); }"); B.wait_for_timeout(400)
    wt = B.inner_text("#app [data-post-why]") if B.locator("#app [data-post-why]").count() else ""
    ok("CGST and SGST differ: check: the sheet" in wt, "the disabled Post button's reason in full, colons and all (%s)" % wt)

    print("3. Sales settings merged key by key")
    A.evaluate("() => { SL().cfg.ledgers = Object.assign({}, SL().cfg.ledgers, {sales_18: 'Sales Account', roundOff: 'Round Off'}); SL().cfg.terms = 'Ours'; saveSales({cfg: true}); }"); A.wait_for_timeout(500)
    # a computer that never set the ledgers (an older copy, no times) sends empty ledgers and no round-off
    A.evaluate("""(cid) => cloudApply([{kind: 'sales_cfg', id: cid, client_id: cid, deleted: false, updated_at: new Date().toISOString(),
      data: {cfg: Object.assign({}, SALES_CFG_DEFAULT, {ledgers: {}, terms: ''}), hist: {}}}])""", cid); A.wait_for_timeout(900)
    c = A.evaluate("() => [SL().cfg.ledgers, SL().cfg.terms]")
    ok(c[0].get("sales_18") == "Sales Account" and c[0].get("roundOff") == "Round Off" and c[1] == "Ours", "an empty copy from another computer wipes nothing (%s)" % c)
    kept = A.evaluate("(cid) => BankDB.get('salescfg:' + cid).then(c => c.ledgers)", cid)
    ok(kept.get("sales_18") == "Sales Account", "kept in this browser too (%s)" % kept)
    # the other computer changes one ledger later: it wins for that entry; the rest stay
    A.evaluate("""(cid) => cloudApply([{kind: 'sales_cfg', id: cid, client_id: cid, deleted: false, updated_at: new Date().toISOString(),
      data: {cfg: Object.assign({}, SALES_CFG_DEFAULT, {ledgers: {sales_18: 'Sales Account 2'}}), hist: {}, cfgAt: {'ledgers/sales_18': '2999-01-01T00:00:00.000Z'}}}])""", cid); A.wait_for_timeout(900)
    c = A.evaluate("() => SL().cfg.ledgers")
    ok(c.get("sales_18") == "Sales Account 2" and c.get("roundOff") == "Round Off", "a ledger changed later there: taken, entry by entry (%s)" % c)
    # saving here with an empty value never wipes what the browser keeps from the other computer
    m = A.evaluate("""() => salesCfgMerge({ledgers: {a: 'X'}, voucherType: 'Sales UP', _at: {}}, {ledgers: {}, voucherType: ''}, {})""")
    ok(m["ledgers"] == {"a": "X"} and m["voucherType"] == "Sales UP", "the merge: empty or missing on one side keeps the other's (%s)" % m)
    m = A.evaluate("""() => salesCfgMerge({ledgers: {a: 'X'}, _at: {'ledgers/a': '2026-01-01'}}, {ledgers: {}}, {'ledgers/a': '2026-02-01'})""")
    ok(m["ledgers"] == {}, "a ledger cleared on purpose later there: cleared (%s)" % m)

    print("4. one registration, ledgers tagged for another state")
    A.evaluate("() => { SL().list = []; SL().cfg.ledgers = {}; SL().cfg.taxPick = {}; }")
    A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
                      ["OUTPUT CGST @9% (DL)", "Duties & Taxes"], ["OUTPUT SGST @9% (DL)", "Duties & Taxes"]], G])
    A.evaluate(ADD, ["D/1", G["k"], "Kappa Retail", 1000])
    d = A.evaluate(TAX, "D/1")
    ok(d["st"] == "review" and d["tax"] == ["", ""] and d["ask"] == [["OUTPUT CGST @9% (DL)"], ["OUTPUT SGST @9% (DL)"]], "a 09 client, only \"(DL)\" ledgers: not picked, offered (%s)" % d)
    A.evaluate("() => { SL().filter = 'review'; render(); }"); A.wait_for_timeout(400)
    A.evaluate("() => { const a = SL().list[0].taxAsk; a.forEach(x => salesPickTax(x.ck, x.cands[0])); }")
    d = A.evaluate(TAX, "D/1")
    ok(d["tax"] == ["OUTPUT CGST @9% (DL)", "OUTPUT SGST @9% (DL)"] and d["st"] == "ready", "chosen with one click: set, Ready (%s)" % d)
    A.evaluate("() => { SL().list = []; SL().cfg.taxPick = {}; }")
    A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
                      ["OUTPUT CGST @9% (DL)", "Duties & Taxes"], ["OUTPUT SGST @9% (DL)", "Duties & Taxes"], ["Output CGST", "Duties & Taxes"], ["Output SGST", "Duties & Taxes"]], G])
    A.evaluate(ADD, ["D/2", G["k"], "Kappa Retail", 1000])
    d = A.evaluate(TAX, "D/2")
    ok(d["tax"] == ["Output CGST", "Output SGST"] and d["st"] == "ready", "with plain ledgers too: the plain ones, never \"(DL)\" (%s)" % d)
    A.evaluate("() => { SL().list = []; SL().cfg.taxPick = {}; }")
    A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
                      ["OUTPUT CGST @9% (UP)", "Duties & Taxes"], ["OUTPUT SGST @9% (UP)", "Duties & Taxes"]], G])
    A.evaluate(ADD, ["D/3", G["k"], "Kappa Retail", 1000])
    d = A.evaluate(TAX, "D/3")
    ok(d["tax"] == ["OUTPUT CGST @9% (UP)", "OUTPUT SGST @9% (UP)"], "its own state's \"(UP)\": picked as before (%s)" % d)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
