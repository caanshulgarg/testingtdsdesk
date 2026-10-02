"""python3 run_balances_copy.py - balances from FinCom's copy (owner's decision of 02-Oct-2026). FinCom Bridge 2.1.4 asks
Tally for no balance (its /balances, /tb and /ledgerbalance answer only from its own copy, and on most companies with an
error), so every balance FinCom shows is worked out from FinCom's cloud copy (openings plus entries): the view
tally_balances (migration-32) when the cloud has it, else the cloud's trial balance and ledger functions (tally_tb,
tally_ledger). Checked here, offline, with the cloud's functions stubbed and the bridge answering nothing:
  - Look up (the trial balance, a ledger, a group): from the copy, with "Balance from FinCom's copy · books as of <time>",
    the source called "FinCom's copy" (no "from Tally", no "Tally, live"), and never an error, also when the copy has no
    answer;
  - the books' opening balances: from the copy (the view's openings, else the ledger masters'), with the same line;
  - the bank check after a posting: "Posted · balance not yet checked" until the entries posted are read back (confirmed
    in Tally and in the copy), then the balance from the copy with the line, by itself; never an error;
  - the bridge is never asked for a balance.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_balances_copy.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8241), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LINE = "Balance from FinCom's copy · books as of"

# the cloud copy of a small book: four ledgers, Tally's signs (a debit is negative). Trial balance on 31-Mar-2026 totals nil
SETUP = """async () => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", ledger: "ICICI Bank"}];
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  S.books = {cid: c.id, loading: false, challans: [], alloc: {}, vouchers: [], meta: {}, groups: {}, under: {}};
  window.__readAt = new Date(Date.now() - 10 * 60000).toISOString();
  const book = () => [{from: "2025-04-01", to: "2026-03-31", book: "bk1", company: "GARG SHEKHAR & COMPANY", entries: 2754, state: {readAt: window.__readAt}}];
  window.__rpc = []; window.__rest = []; window.__bridge = []; window.__view = true; window.__ledgerNone = false;
  Cloud.on = () => true; Cloud.st.firm = {id: "f-1"}; Cloud.st.members = [];
  TCloud.st[c.id] = {at: Date.now(), books: book()};
  const V = [{ledger: "ICICI Bank", parent: "Bank Accounts", open: -350458.92, closing: -276467.36},
             {ledger: "Cash", parent: "Cash-in-hand", open: -14873.75, closing: -34873.75},
             {ledger: "AAR ESS EXIM PRIVATE LIMITED", parent: "Sundry Debtors", open: -45081.54, closing: -684421.54},
             {ledger: "Capital Account", parent: "Capital Account", open: 410414.21, closing: 995762.65}];
  TCloud.restAll = async (u) => { window.__rest.push(u);
    if (/^tally_balances/.test(u)){ if (!window.__view) throw {message: "relation \\"public.tally_balances\\" does not exist (42P01) 404"}; return V.map(r => Object.assign({last_day: "2026-03-31"}, r)); }
    if (/^tally_ledgers/.test(u)) return V.map(r => ({name: r.ledger, parent: r.parent, open: r.open}));
    return []; };
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_status") return book();
    if (fn === "tally_tb") return V.map(r => ({ledger: r.ledger, parent: r.parent, open: r.open, movement: r.closing - r.open, closing: r.closing}));
    if (fn === "tally_ledger"){ if (window.__ledgerNone) return {none: true}; const r = V.find(x => x.ledger === a.p_ledger) || {open: 0, closing: 0};
      return {open: a.p_from > "2026-03-31" ? r.closing : r.open, lines: [["20250415", "Receipt", "7", "AAR ESS EXIM PRIVATE LIMITED", "", r.closing - r.open, "g1"]], company: "GARG SHEKHAR & COMPANY", from: "2025-04-01", to: "2026-03-31"}; }
    if (fn === "tally_period") return V.map(r => ({ledger: r.ledger, parent: r.parent, open: r.open, dr: r.closing < r.open ? r.open - r.closing : 0, cr: r.closing > r.open ? r.closing - r.open : 0}));
    if (fn === "tally_monthly") return [];
    return null; };
  TCloud.rpcAll = async (fn, a) => (await TCloud.rpc(fn, a)) || [];
  Cloud.api = async (path) => { window.__rest.push(path); return []; };
  // the bridge answers nothing; any balance asked of it is noted
  Bridge.call = async (p) => { window.__bridge.push(String(p)); throw new Error("the bridge was asked: " + p); };
  window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  render();
  return c.id;
}"""

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8241/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    cid = pg.evaluate(SETUP); pg.wait_for_timeout(500)
    E = lambda js, *a: pg.evaluate(js, *a)
    app = lambda: pg.inner_text("#app")
    hm = E("tallyHm(window.__readAt)")
    ok(E("copyLine(S.coId)") == LINE + " " + hm, "the line: \"%s %s\"" % (LINE, hm))

    # 1. Look up: the trial balance on 31-Mar-2026, from the view (the copy holds entries up to that day)
    E("() => { S.booksTab = 'lookup'; render(); }"); pg.wait_for_timeout(400)
    E("async () => { const x = LK.st(); Object.assign(x, {kind: 'tb', asOn: '20260331', src: ''}); await LK.run('auto'); }"); pg.wait_for_timeout(500)
    r = E("({src: S.lk.res.src, n: S.lk.res.rows.length, dr: S.lk.res.dr, cr: S.lk.res.cr, line: S.lk.res.line})")
    ok(r["src"] == "cloud" and r["n"] == 4 and r["dr"] == r["cr"] == 995762.65, "1. Look up, trial balance: from FinCom's copy, 4 ledgers, debits = credits = 9,95,762.65 (%s)" % r)
    ok(any(u.startswith("tally_balances") for u in E("window.__rest")), "1. worked out from the view tally_balances")
    t = app()
    ok(LINE in t and pg.locator("#app [data-copy-line]").count() >= 1, "1. the answer carries \"%s …\"" % LINE)
    ok("from FinCom's copy" in t and "from Tally" not in t and "Tally, live" not in t and "Read again" not in t, "1. the source is called FinCom's copy; no \"from Tally\" or \"Tally, live\"")
    # no view on this cloud (migration-32 not applied): the trial balance function
    E("async () => { window.__view = false; TCloud.hasView = null; window.__rpc = []; S.lk.res = null; await LK.run('auto'); }"); pg.wait_for_timeout(400)
    ok(E("TCloud.hasView") is False and any(f == "tally_tb" for f, _ in E("window.__rpc")) and E("S.lk.res.src") == "cloud" and E("S.lk.res.dr") == 995762.65,
       "1. without the view: tally_tb, the same figures (%s)" % E("S.lk.res.dr"))
    # a ledger
    E("async () => { const x = LK.st(); Object.assign(x, {kind: 'ledger', led: 'ICICI Bank', from: '20250401', to: '20260331', src: ''}); await LK.run('auto'); }"); pg.wait_for_timeout(400)
    r = E("({src: S.lk.res.src, open: S.lk.res.open, close: S.lk.res.close})")
    ok(r["src"] == "cloud" and r["open"] == 350458.92 and r["close"] == 276467.36 and LINE in app(), "1. Look up, a ledger: opening 3,50,458.92 Dr, closing 2,76,467.36 Dr, from the copy, with the line (%s)" % r)
    radio = pg.locator("#app .lk-src button").all_inner_texts()
    ok(radio[:1] == ["FinCom's copy"], "1. the choice of source reads \"FinCom's copy\" (%s)" % radio)
    # a group
    E("async () => { const x = LK.st(); Object.assign(x, {kind: 'group', grp: 'Sundry Debtors', from: '20250401', to: '20260331', src: ''}); await LK.run('auto'); }"); pg.wait_for_timeout(400)
    ok(E("S.lk.res.src") == "cloud" and E("S.lk.res.close") == 684421.54 and LINE in app(), "1. Look up, a group: Sundry Debtors 6,84,421.54 Dr from the copy, with the line")
    # the copy has no answer: said on the answer, never an error
    E("async () => { window.__ledgerNone = true; const x = LK.st(); Object.assign(x, {kind: 'ledger', led: 'ICICI Bank', src: ''}); x.res = null; await LK.run('auto'); window.__ledgerNone = false; }"); pg.wait_for_timeout(400)
    t = app()
    ok(E("!!(S.lk.res && S.lk.res.empty)") and LINE in t and pg.locator("#app [data-copy-none]").count() == 1, "1. no answer in the copy yet: the answer says so, with the line")
    ok(not any(("could not" in m.lower() or "error" in m.lower()) for m in E("window.__toasts")) and "Could not" not in t, "1. and no error anywhere (%s)" % E("window.__toasts"))

    # 2. the books' opening balances: from the copy (the view's openings), with the line
    E("async () => { window.__view = true; TCloud.hasView = null; await TallyRead.openings(S.books, S.coId, '20250401', '20260331'); S.booksTab = 'import'; render(); }"); pg.wait_for_timeout(500)
    tb = E("({src: S.books.tb.src, n: Object.keys(S.books.tb.led).length, icici: S.books.tb.led['ICICI Bank'].open, line: S.books.tb.line})")
    ok(tb["src"] == "copy" and tb["n"] == 4 and tb["icici"] == -350458.92 and tb["line"].startswith(LINE), "2. opening balances from FinCom's copy: 4 ledgers, ICICI Bank 3,50,458.92 Dr (%s)" % tb)
    step = pg.inner_text("#app .dash-card >> nth=0")
    ok("4 ledgers, from FinCom's copy" in step and LINE in step and "read from Tally" not in step, "2. Books → Setting up, step 2: \"4 ledgers, from FinCom's copy\" with the line (%s)" % step[step.find("2. Opening"):][:160].replace("\n", " "))
    au = E("Audit.balances('20250401', '20260331').src")
    ok("FinCom's copy" in au, "2. the audit and MIS say where the openings came from: " + au)
    # no copy in the cloud: the openings here stay, no error
    E("async () => { const keep = TCloud.st[S.coId]; TCloud.st[S.coId] = {at: Date.now(), books: []}; const rpc = TCloud.rpc; TCloud.rpc = async (fn, a) => fn === 'tally_status' ? [] : rpc(fn, a); window.__o = await TallyRead.openings(S.books, S.coId, '20250401', '20260331'); TCloud.rpc = rpc; TCloud.st[S.coId] = keep; }")
    ok(E("window.__o") is None and E("Object.keys(S.books.tb.led).length") == 4, "2. without a copy in the cloud: the openings here stay as they are, no error")

    # 3. the bank check after a posting
    E("""() => { const now = new Date().toISOString(); window.__sentAt = now;
      const rows = [{id: "r0", fp: "fp0", date: "2026-03-28", debit: 0, credit: 10000, narr: "NEFT CR AAR ESS", dec: {name: "AAR ESS EXIM PRIVATE LIMITED", mode: "NEFT"}, ledger: "AAR ESS EXIM PRIVATE LIMITED", state: "sent", sentAt: now, postedVia: "bridge", postVerified: false, checking: true, balOk: true, why: []},
                    {id: "r1", fp: "fp1", date: "2026-03-30", debit: 5000, credit: 0, narr: "NEFT DR RENT", dec: {name: "Rent", mode: "NEFT"}, ledger: "Rent", state: "sent", sentAt: now, postedVia: "bridge", postVerified: false, checking: true, balOk: true, why: []},
                    {id: "r2", fp: "fp2", date: "2026-03-31", debit: 1000, credit: 0, narr: "CHARGES", dec: {name: "Bank Charges", mode: "OTH"}, ledger: "Bank Charges", state: "intally", balOk: true, why: []}];
      S.tab = "bank";
      S.bank = {cid: S.coId, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-03-28", to: "2026-03-31", opening: 272467.36, closing: 276467.36, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
        ledgers: {list: [{name: "ICICI Bank", group: "Bank Accounts"}, {name: "AAR ESS EXIM PRIVATE LIMITED", group: "Sundry Debtors"}, {name: "Rent", group: "Indirect Expenses"}, {name: "Bank Charges", group: "Indirect Expenses"}], importedAt: new Date().toISOString(), live: true},
        newLed: [], keys: {}, books: {}, filter: "all", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
      window.__rpc = []; render(); }"""); pg.wait_for_timeout(600)
    res = E("checkBankBalance()"); pg.wait_for_timeout(400)
    box = pg.inner_text(".bk-balbox") if pg.locator(".bk-balbox").count() else ""
    ok(res and res.get("pending") == 2 and "Posted · balance not yet checked" in box, "3. posted, not read back yet: \"Posted · balance not yet checked\" (%s)" % box[:120].replace("\n", " "))
    ok(not any(f == "tally_ledger" for f, _ in E("window.__rpc")), "3. and no balance is worked out before the read-back")
    # read back in Tally, but the copy last read Tally before the posting: still waiting
    E("() => { B().rows.forEach(r => { if (r.state === 'sent'){ r.postVerified = true; r.checking = false; } }); }")
    res = E("checkBankBalance()"); pg.wait_for_timeout(300)
    ok(res.get("pending") == 2 and "Posted · balance not yet checked" in pg.inner_text(".bk-balbox"), "3. confirmed in Tally but not in FinCom's copy yet: still \"balance not yet checked\"")
    # the copy reads Tally after the posting: checked by itself, from the copy, with the line
    E("() => { window.__readAt = new Date(Date.now() + 1000).toISOString(); TCloud.st[S.coId].books[0].state.readAt = window.__readAt; render(); }")
    done = False
    for i in range(40):
        pg.wait_for_timeout(500)
        if E("!!(curStmt().tallyBal && curStmt().tallyBal.how === 'copy' && !B().balBusy)"): done = True; break
    tb = E("curStmt().tallyBal")
    box = pg.inner_text(".bk-balbox")
    ok(done and tb.get("tClose") == 276467.36 and tb.get("diff") == 0, "3. read back: the balance from FinCom's copy by itself, 2,76,467.36 Dr, agrees with the statement (%s)" % ({k: tb.get(k) for k in ("tClose", "diff", "pending", "notYet")}))
    ok("The books agree with the bank" in box and LINE in box and "Posted · balance not yet checked" not in box, "3. the box: \"The books agree with the bank\" and \"%s …\" (%s)" % (LINE, box[:160].replace("\n", " ")))
    ok(any(f == "tally_ledger" and a.get("p_ledger") == "ICICI Bank" and a.get("p_from") == "2026-04-01" for f, a in E("window.__rpc")) or any(u.startswith("tally_balances") for u in E("window.__rest")),
       "3. worked out from the copy: ICICI Bank's balance at the end of 31-Mar-2026")
    # the copy cannot answer: said, never an error
    E("() => { window.__ledgerNone = true; TCloud.hasView = false; }")
    res = E("checkBankBalance()"); pg.wait_for_timeout(300)
    box = pg.inner_text(".bk-balbox")
    ok(res.get("notYet") and "Balance not yet checked" in box and "could not" not in box.lower() and pg.locator(".bk-balbox.bad").count() == 0, "3. the copy has no answer yet: \"Balance not yet checked\", not an error (%s)" % box[:140].replace("\n", " "))
    E("() => { window.__ledgerNone = false; }")
    # an old result with Tally's error (from an earlier build) is not shown as an error either
    E("() => { curStmt().tallyBal = {at: Date.now(), error: 'Tally closed'}; render(); }"); pg.wait_for_timeout(300)
    box = pg.inner_text(".bk-balbox")
    ok("could not be read" not in box and "Tally closed" not in box and "Balance not yet checked" in box, "3. an old check with Tally's error: \"Balance not yet checked\"")
    ok("Check again" in box or "Check with FinCom's copy" in box, "3. the button checks with FinCom's copy (no \"Check with Tally\")")

    # 4. the bridge was never asked for a balance
    asked = E("window.__bridge")
    ok(not [u for u in asked if any(k in u for k in ("/balances", "/tb", "/ledgerbalance", "balances.json"))], "4. the bridge was never asked for a balance (%s)" % asked)
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\n%d checks failed" % len(fails) if fails else "\nall checks passed")
raise SystemExit(1 if fails else 0)
