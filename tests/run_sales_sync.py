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
import os, re, subprocess, threading, functools, http.server
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
  return {up: mk('09AAACZ1234Q1Z'), k: mk('09AAACK5678P1Z'), l: mk('09AAACL5678P1Z'), dl: mk('07AAACL5678P1Z')}; }"""
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
MARK = "() => { const m = Cloud.marks(); cloudSnapshot().forEach(r => { m[cloudKey(r)] = fpHash(JSON.stringify(r.data)); }); Cloud.setMarks(m); }"
CHANGES = "() => cloudChanges().changes.filter(r => /^sales/.test(r.kind)).map(r => ({kind: r.kind, id: r.id, client_id: r.client_id, data: r.data, deleted: false}))"
TAX = """(n) => { const v = SL().list.find(v => v.x.number === n); return {st: v.status, tax: salesLines(v).filter(l => l.role === 'tax').map(l => l.ledger), ask: (v.taxAsk || []).map(a => a.cands)}; }"""

# staging-next's (0c4dcbdaa) salesVoucherXml, salesLines, salesTotals, isInterState and taxLedgerPick, under names of their own
def old_fns():
    src = subprocess.run(["git", "show", "0c4dcbdaa:src/js/25-sales.js"], cwd=os.path.dirname(os.path.abspath(__file__)), capture_output=True, text=True).stdout
    names = ["salesVoucherXml", "salesLines", "salesTotals", "isInterState", "taxLedgerPick"]
    out = [m.group(0) for n in names for m in [re.search(r"\nfunction " + n + r"\(.*?(?=\n(?:function |const |let |/\*|// ))", src, re.S)] if m]
    code = "\n".join(out)
    for n in names: code = re.sub(r"\b" + n + r"\(", n + "_old(", code)
    return code if len(out) == len(names) else ""

with sync_playwright() as p:
    br = p.chromium.launch()
    def open_page():
        ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(READY); pg.wait_for_timeout(800)
        return ctx, pg
    ctxA, A = open_page(); ctxB, B = open_page()
    G = A.evaluate(GST)

    print("1. two computers: looked at again where the ledger list is; only blanks filled; the rest a view of this computer")
    cid = A.evaluate(NEWCO, G); A.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G])
    for n, cg, cn in [("S/1", G["k"], "Kappa Retail"), ("S/2", G["l"], "Lambda Stores"), ("S/3", G["k"], "Kappa Retail"), ("S/4", G["k"], "Kappa Retail"), ("S/5", G["k"], "Kappa Retail"), ("S/6", G["k"], "Kappa Retail")]: A.evaluate(ADD, [n, cg, cn, 1000])
    st = A.evaluate("() => SL().list.map(v => v.status)")
    ok(st == ["ready"] * 6, "computer A, with the ledger list: all six Ready (%s)" % st)
    # as a computer without the ledger list saved them: S/1 with no customer ledger; S/2 its CGST set by a person; S/3
    # posted; S/4 its customer ledger set; S/5 a customer ledger picked earlier (not the GSTIN's); S/6 moved back to review
    rows = A.evaluate("""() => { const s = SL(), stale = v => { v.status = 'review'; v.ledgerIssues = ['Tally ledger list not loaded']; v.taxPicks = []; v.taxAsk = []; };
      s.list.forEach(stale);
      Object.assign(s.list[0], {customerLedger: '', custSource: '', custSure: false});
      s.list[1].taxLedgers = {cgst_18: 'Output CGST Spare'};
      Object.assign(s.list[2], {status: 'posted', postedAt: '2026-10-06T10:00:00.000Z', customerLedger: 'Lambda Stores', userLedger: true, custSource: 'Set by you', ledgerIssues: []});
      Object.assign(s.list[4], {customerLedger: 'Mu Old Party', custSource: 'Name match', custSure: true});
      s.list[5].heldBack = true;
      saveSales();
      return cloudSnapshot().filter(r => ['client', 'sales', 'sales_cfg'].includes(r.kind) && r.client_id === s.cid).map(r => Object.assign({deleted: false, updated_at: new Date().toISOString()}, JSON.parse(JSON.stringify(r)))); }""")
    ok(len([r for r in rows if r["kind"] == "sales"]) == 6, "the rows the cloud would carry: the client, the settings, six invoices (%d)" % len(rows))
    B.evaluate("async (rows) => { await cloudApply(rows); }", rows); B.wait_for_timeout(500)
    ok(B.evaluate("(cid) => !!S.companies[cid]", cid), "computer B has the client from the synced rows")
    B.evaluate("(cid) => openCompany(cid).then(() => loadBank(cid))", cid); B.wait_for_timeout(500)
    saved0 = B.evaluate("(cid) => BankDB.get('sales:' + cid).then(l => l.map(v => v.status))", cid)
    ok(saved0 == ["review"] * 2 + ["posted"] + ["review"] * 3, "B's own copy as synced: the stale To review (%s)" % saved0)
    # only the client's one list (Ledgers.st), not the one the customer match reads: nothing looked at
    B.evaluate("([leds, g]) => { const list = leds.map(([name, group, gk]) => ({name, group, gstin: gk ? g[gk] : ''})); Ledgers.st[CO().id] = {list, parents: {}, at: '', srcAt: '', src: 'cloud', file: '', book: '', cloudAt: ''}; S.bank.ledgers = {list: [], importedAt: ''}; Ledgers.ver++; }", [LED + [["Mu Old Party", "Sundry Debtors"]], G])
    B.evaluate("(cid) => { S.tab = 'sales'; S.step = null; return loadSales(cid); }", cid); B.wait_for_timeout(600)
    ok(B.evaluate("() => !SL().remapKey && salesRemapWaiting() === false"), "only the cloud's list held, not the bank's copy the customer match reads: not looked at")
    B.evaluate(SETL.replace("SL() ? SL().cid : CO().id", "CO().id"), [LED + [["Mu Old Party", "Sundry Debtors"]], G])
    B.evaluate(MARK)
    B.evaluate("(cid) => loadSales(cid).then(() => render())", cid); B.wait_for_timeout(1200)
    st = B.evaluate("() => SL().list.map(v => [v.x.number, v.status, v.customerLedger])")
    ok([x[1] for x in st] == ["ready", "ready", "posted", "ready", "ready", "review"], "on opening: S/1 S/2 S/4 S/5 Ready, S/6 (moved back by a person) To review, S/3 posted (%s)" % st)
    ok(st[0][2] == "Kappa Retail", "S/1's blank customer ledger filled (%s)" % st[0][2])
    ok(st[4][2] == "Mu Old Party", "S/5's customer ledger picked earlier is never replaced (%s)" % st[4][2])
    ok(B.evaluate("() => salesLines(SL().list[1]).find(l => l.kind === 'cgst').ledger") == "Output CGST Spare", "the CGST ledger set by a person stays")
    ok(B.evaluate("() => [SL().list[2].customerLedger, SL().list[2].postedAt]") == ["Lambda Stores", "2026-10-06T10:00:00.000Z"], "the posted invoice is not touched")
    B.wait_for_timeout(900)
    saved = B.evaluate("(cid) => BankDB.get('sales:' + cid).then(l => l.map(v => [v.status, v.customerLedger]))", cid)
    ok([x[0] for x in saved] == ["ready", "review", "posted", "review", "review", "review"] and saved[0][1] == "Kappa Retail", "kept: only S/1, whose blank was filled; the others' new status is this computer's view (%s)" % saved)
    sent = B.evaluate(CHANGES)
    ok([r["id"].split(":")[1] for r in sent] == [B.evaluate("() => SL().list[0].id")], "sent: S/1 only (%s)" % [r["data"]["x"]["number"] for r in sent])
    B.evaluate(MARK)
    B.evaluate("(cid) => { SL().remapKey = null; salesRemapWaiting(); }", cid)
    ok(B.evaluate(CHANGES) == [], "looked at again: nothing more to send")
    # the same fill coming undone from the other computer is not sent again
    back = [r for r in rows if r["kind"] == "sales" and r["data"]["x"]["number"] == "S/1"]
    B.evaluate("async (rows) => { await cloudApply(rows); }", back); B.wait_for_timeout(1200)
    ok(B.evaluate("() => SL().list[0].customerLedger") == "Kappa Retail" and B.evaluate(CHANGES) == [], "S/1 blank again from the other computer: filled here for the view, not sent again")
    # S/6, moved back to review by a person, stays so through mapInvoice too
    B.evaluate("() => mapInvoice(SL().list[5])")
    ok(B.evaluate("() => SL().list[5].status") == "review", "\"moved back to review\" stays To review through mapInvoice")
    # the list comes later: looked at then
    B.evaluate("(cid) => { S.bank.ledgers = {list: [], importedAt: ''}; delete Ledgers.st[cid]; Ledgers.ver++; return loadSales(cid); }", cid); B.wait_for_timeout(600)
    st0 = B.evaluate("() => SL().list.map(v => v.status)")
    B.evaluate(SETL, [LED + [["Mu Old Party", "Sundry Debtors"]], G]); B.evaluate("(cid) => ledgersChanged(cid)", cid); B.wait_for_timeout(400)
    st1 = B.evaluate("() => SL().list.map(v => v.status)")
    ok(st0[3] == "review" and st1[3] == "ready", "a ledger list that comes in later: looked at then (%s → %s)" % (st0, st1))
    ms = B.evaluate("""() => { const s = SL(), v0 = s.list[3]; for (let i = 0; i < 5000; i++){ const v = JSON.parse(JSON.stringify(v0)); v.id = 'bulk' + i; v.x.number = 'B/' + i; v.status = 'review'; s.list.push(v); }
      s.remapKey = null; const t = performance.now(); salesRemapWaiting(); const ms = performance.now() - t; s.list = s.list.filter(v => !/^bulk/.test(v.id)); return ms; }""")
    ok(ms < 4000, "5,000 invoices looked at again in %d ms" % ms)

    print("1b. two computers with different ledger lists: no flip-flop")
    C2 = A.evaluate(NEWCO.replace("ZZ Test Sync Traders", "ZZ Test Two Lists"), G); A.wait_for_timeout(600)
    A.evaluate(SETL, [LED, G])
    A.evaluate(ADD, ["T/1", G["l"], "Lambda Stores", 500]); A.evaluate(ADD, ["T/2", G["k"], "Kappa Retail", 700])
    A.evaluate("() => saveSales()"); A.wait_for_timeout(700)
    first = A.evaluate("(cid) => cloudSnapshot().filter(r => ['client', 'sales', 'sales_cfg'].includes(r.kind) && r.client_id === cid).map(r => Object.assign({deleted: false}, JSON.parse(JSON.stringify(r))))", C2)
    A.evaluate(MARK)
    B.evaluate("async (rows) => { await cloudApply(rows); }", first); B.wait_for_timeout(400)
    B.evaluate("(cid) => openCompany(cid).then(() => loadBank(cid))", C2); B.wait_for_timeout(400)
    # B's list: no "Lambda Stores", another party of that GSTIN instead
    B.evaluate(SETL.replace("SL() ? SL().cid : CO().id", "CO().id"), [[x for x in LED if x[0] != "Lambda Stores"] + [["Lambda Stores (Old)", "Sundry Debtors", "l"]], G])
    B.evaluate("(cid) => { S.tab = 'sales'; return loadSales(cid); }", C2); B.wait_for_timeout(900)
    B.evaluate(MARK)
    sends = []
    for rnd in range(3):
        ca = A.evaluate(CHANGES); A.evaluate(MARK)
        if ca: B.evaluate("async (rows) => { await cloudApply(rows); }", ca); B.wait_for_timeout(700)
        cb = B.evaluate(CHANGES); B.evaluate(MARK)
        if cb: A.evaluate("async (rows) => { await cloudApply(rows); }", cb); A.wait_for_timeout(700)
        sends.append([len(ca), len(cb)])
    a1 = A.evaluate("() => SL().list.map(v => [v.status, v.customerLedger])"); b1 = B.evaluate("() => SL().list.map(v => [v.status, v.customerLedger])")
    ok(sends == [[0, 0]] * 3, "three syncs: nothing sent either way (%s)" % sends)
    ok(a1 == [["ready", "Lambda Stores"], ["ready", "Kappa Retail"]] and b1[0] == ["review", "Lambda Stores"], "A keeps Ready, B shows its own view (Lambda Stores not in its list) and never replaces it (%s / %s)" % (a1, b1))
    for P in (A, B): P.evaluate("(cid) => openCompany(cid).then(() => loadBank(cid)).then(() => { S.tab = 'sales'; S.step = null; return loadSales(cid); })", cid); P.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G]); B.evaluate(SETL, [LED, G])

    print("2. Post never silent")
    B.evaluate(TOASTS)
    r = B.evaluate("() => { const k = S.sales; S.sales = null; const a = [salesAct('salesPost'), salesAct('salesSettings')]; S.sales = k; const t = window.__toasts.slice(); window.__toasts = []; return [a, t]; }")
    ok(r == [[True, False], ["Sales list still loading. Try again in a moment."]], "a Post click before the Sales list is loaded: says so; other actions stay quiet (%s)" % r)
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
      data: {cfg: Object.assign({}, SALES_CFG_DEFAULT, {ledgers: {sales_18: 'Sales Account 2'}}), hist: {}, cfgAt: {'ledgers/sales_18': new Date(Date.now() + 1000).toISOString()}}}])""", cid); A.wait_for_timeout(900)
    c = A.evaluate("() => SL().cfg.ledgers")
    ok(c.get("sales_18") == "Sales Account 2" and c.get("roundOff") == "Round Off", "a ledger changed later there: taken, entry by entry (%s)" % c)
    # saving here with an empty value never wipes what the browser keeps from the other computer
    m = A.evaluate("""() => salesCfgMerge({ledgers: {a: 'X'}, voucherType: 'Sales UP', _at: {}}, {ledgers: {}, voucherType: ''}, {})""")
    ok(m["ledgers"] == {"a": "X"} and m["voucherType"] == "Sales UP", "the merge: empty or missing on one side keeps the other's (%s)" % m)
    m = A.evaluate("""() => salesCfgMerge({ledgers: {a: 'X'}, _at: {'ledgers/a': '2026-01-01'}}, {ledgers: {}}, {'ledgers/a': '2026-02-01'})""")
    ok(m["ledgers"] == {}, "a ledger cleared on purpose later there: cleared (%s)" % m)

    m = A.evaluate("""() => { const now = Date.now(), t = d => new Date(now + d).toISOString();
      return [salesCfgMerge({terms: 'A', _at: {terms: t(180000)}}, {terms: 'B'}, {terms: '2999-01-01T00:00:00.000Z'}).terms,
        salesCfgMerge({terms: 'A', _at: {terms: t(-60000)}}, {terms: 'B'}, {terms: '2999-01-01T00:00:00.000Z'}).terms,
        salesCfgMerge({voucherType: 'Sales UP'}, {voucherType: 'Sales'}, {}).voucherType, salesCfgMerge({voucherType: 'Sales'}, {voucherType: 'Sales UP'}, {}).voucherType,
        salesCfgMerge({next: 7}, {next: 3}, {}).next, salesCfgMerge({next: 2}, {next: 9}, {}).next]; }""")
    # the next number corrected down (a typo, 1000 for 58): the newer change wins, here and across two computers
    nx = A.evaluate("""async (cid) => { const s = SL(); s.cfg.next = 1000; saveSales({cfg: true}); await salesCfgQ; await new Promise(r => setTimeout(r, 5));
      s.cfg.next = 58; saveSales({cfg: true}); await salesCfgQ; const here = [s.cfg.next, (await BankDB.get('salescfg:' + cid)).next];
      const there = salesCfgMerge({next: 1000, _at: {next: new Date(Date.now() - 60000).toISOString()}}, {next: 58}, {next: s.cfgAt.next});
      const back = salesCfgMerge({next: 58, _at: {next: s.cfgAt.next}}, {next: 1000}, {next: new Date(Date.now() - 60000).toISOString()});
      return here.concat([there.next, back.next]); }""", cid)
    ok(nx == [58, 58, 58, 58], "next set to 1000 then corrected to 58: 58 here, in this browser, and on the other computer either way (%s)" % nx)
    ok(m == ["A", "B", "Sales UP", "Sales UP", 7, 9], "a time far ahead counts as now; with no times a set value beats the default; the next number is the higher (%s)" % m)
    # the series' next number taken on another computer while a draft was open: the next free one
    n = A.evaluate("""() => { const s = SL(); s.list = []; s.cfg.series = 'ZT/'; s.cfg.next = 1; s.cfg.pad = 3; startDraft(); const d = s.draft, was = d.x.number;
      const other = newInvoice({number: was, date: d.x.date, customerName: 'Kappa Retail', total: 100, taxable: 100}, 'created'); other.status = 'posted'; s.list.push(other);
      Object.assign(d.x, {customerName: 'Kappa Retail', pos: '09'}); d.x.items = [{desc: 'Widget', hsn: '', qty: 1, unit: 'Nos', rate: 100, disc: 0, taxable: 0, gstRate: 18}];
      const v = saveDraft(); return [was, (s.list.find(o => o.id !== other.id) || {x: {}}).x.number, s.cfg.next]; }""")
    ok(n[0] == "ZT/001" and n[1] == "ZT/002" and n[2] == 3, "a number used on another computer meanwhile: this invoice takes the next one (%s)" % n)
    A.evaluate("() => { SL().view = 'list'; SL().draft = null; SL().list = []; render(); }")

    print("4. one registration, ledgers tagged for another state")
    A.evaluate("() => { SL().list = []; SL().cfg.ledgers = {}; SL().cfg.taxPick = {}; saveSales({cfg: true}); return salesCfgQ; }")
    A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
                      ["OUTPUT CGST @9% (DL)", "Duties & Taxes"], ["OUTPUT SGST @9% (DL)", "Duties & Taxes"]], G])
    A.evaluate(ADD, ["D/1", G["k"], "Kappa Retail", 1000])
    d = A.evaluate(TAX, "D/1")
    ok(d["st"] == "review" and d["tax"] == ["", ""] and d["ask"] == [["OUTPUT CGST @9% (DL)"], ["OUTPUT SGST @9% (DL)"]], "a 09 client, only \"(DL)\" ledgers: not picked, offered (%s)" % d)
    A.evaluate("() => { SL().filter = 'review'; render(); }"); A.wait_for_timeout(400)
    A.evaluate("() => { const a = SL().list[0].taxAsk; a.forEach(x => salesPickTax(x.ck, x.cands[0])); }")
    d = A.evaluate(TAX, "D/1")
    ok(d["tax"] == ["OUTPUT CGST @9% (DL)", "OUTPUT SGST @9% (DL)"] and d["st"] == "ready", "chosen with one click: set, Ready (%s)" % d)
    A.evaluate("() => { SL().list = []; SL().cfg.taxPick = {}; saveSales({cfg: true}); return salesCfgQ; }")
    A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
                      ["OUTPUT CGST @9% (DL)", "Duties & Taxes"], ["OUTPUT SGST @9% (DL)", "Duties & Taxes"], ["Output CGST", "Duties & Taxes"], ["Output SGST", "Duties & Taxes"]], G])
    A.evaluate(ADD, ["D/2", G["k"], "Kappa Retail", 1000])
    d = A.evaluate(TAX, "D/2")
    ok(d["tax"] == ["Output CGST", "Output SGST"] and d["st"] == "ready", "with plain ledgers too: the plain ones, never \"(DL)\" (%s)" % d)
    A.evaluate("() => { SL().list = []; SL().cfg.taxPick = {}; saveSales({cfg: true}); return salesCfgQ; }")
    A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
                      ["OUTPUT CGST @9% (UP)", "Duties & Taxes"], ["OUTPUT SGST @9% (UP)", "Duties & Taxes"]], G])
    A.evaluate(ADD, ["D/3", G["k"], "Kappa Retail", 1000])
    d = A.evaluate(TAX, "D/3")
    ok(d["tax"] == ["OUTPUT CGST @9% (UP)", "OUTPUT SGST @9% (UP)"], "its own state's \"(UP)\": picked as before (%s)" % d)
    # a person's choice first, before the one ledger at the rate
    A.evaluate("() => { SL().list = []; SL().cfg.taxPick = {cgst_9: 'Output CGST'}; saveSales({cfg: true}); return salesCfgQ; }")
    A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"],
                      ["Output CGST 9%", "Duties & Taxes"], ["Output CGST", "Duties & Taxes"], ["Output SGST 9%", "Duties & Taxes"]], G])
    A.evaluate(ADD, ["H/1", G["k"], "Kappa Retail", 1000])
    d = A.evaluate(TAX, "H/1")
    ok(d["tax"] == ["Output CGST", "Output SGST 9%"], "the CGST chosen by you beats the one 9%% ledger (%s)" % d)
    print("5. clearly tagged only; untagged as on staging-next, the posting XML byte for byte")
    tags = A.evaluate("() => ['OUTPUT CGST @9% (DL)', 'Output CGST (Delhi)', 'Output CGST 9% - Delhi', 'Output CGST 9% DN', 'Output SGST DD', 'Output IGST PY', 'Output CGST TS', 'Output CGST 9% KA', 'Output IGST 18% (18)', 'Output IGST (27)', 'Output CGST 9% (DN)', 'Output CGST (JV)', 'Output CGST (Daman)', 'Output CGST (26)'].map(ledgerClearTag)")
    ok(tags == ["07", "07", "07", "", "", "", "", "", "", "27", "", "", "26", "26"], "clear tags: in brackets or a full name after a separator; bare words never (%s)" % tags)
    old = old_fns()
    ok(bool(old), "staging-next's functions found")
    A.evaluate("(code) => { (0, eval)(code); }", old)
    cases = [[["Output CGST 9% DN", "Duties & Taxes"], ["Output SGST 9% DN", "Duties & Taxes"], ["Output CGST 6%", "Duties & Taxes"], ["Output SGST 6%", "Duties & Taxes"]],
             [["Output CGST", "Duties & Taxes"], ["Output SGST", "Duties & Taxes"], ["Output IGST", "Duties & Taxes"]],
             [["Output CGST 9%", "Duties & Taxes"], ["Output SGST 9%", "Duties & Taxes"], ["Output CGST 2.5%", "Duties & Taxes"], ["Output SGST 2.5%", "Duties & Taxes"], ["Output IGST 18%", "Duties & Taxes"]],
             [["Output CGST 9% (DN)", "Duties & Taxes"], ["Output SGST 9% (DN)", "Duties & Taxes"], ["Output CGST 6% (CN)", "Duties & Taxes"]],
             [["CGST Payable 9 DN", "Duties & Taxes"], ["SGST Payable 9 DN", "Duties & Taxes"], ["CGST Payable", "Duties & Taxes"], ["SGST Payable", "Duties & Taxes"]]]
    for i, leds in enumerate(cases):
        A.evaluate("() => { SL().list = []; SL().cfg.taxPick = {}; SL().cfg.ledgers = {}; saveSales({cfg: true}); return salesCfgQ; }")
        A.evaluate(SETL, [[["Kappa Retail", "Sundry Debtors", "k"], ["Lambda Stores", "Sundry Debtors", "l"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"]] + leds, G])
        A.evaluate(ADD, ["X/%d" % i, G["k"], "Kappa Retail", 1000])
        A.evaluate("([n, g]) => { const s = SL(); const v = newInvoice({number: n, date: '2026-10-05', customerName: 'Lambda Stores', customerGstin: g, pos: '07', taxable: 1000, cgst: 0, sgst: 0, igst: 180, cess: 0, total: 1180, items: []}, 'upload'); s.list.push(v); mapInvoice(v); }", ["Y/%d" % i, G["dl"]])
        same = A.evaluate("""() => { const co = CO(); return SL().list.map(v => [salesVoucherXml(v, co) === salesVoucherXml_old(v, co), JSON.stringify(['cgst', 'sgst', 'igst'].map(k => taxLedgerPick(k, 18, v))) === JSON.stringify(['cgst', 'sgst', 'igst'].map(k => taxLedgerPick_old(k, 18, v)))]); }""")
        ok(same == [[True, True], [True, True]], "untagged case %d (%s): the picks and the XML as on staging-next (%s)" % (i + 1, leds[0][0], same))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
