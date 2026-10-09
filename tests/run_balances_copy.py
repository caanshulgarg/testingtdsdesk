"""python3 run_balances_copy.py - balances from FinCom's copy (owner's decision of 02-Oct-2026). FinCom Bridge 2.1.4 asks
Tally for no balance (its /balances, /tb and /ledgerbalance answer only from its own copy, and on most companies with an
error), so every balance FinCom shows is worked out from FinCom's cloud copy (openings plus entries): the view
tally_balances (migration-32) is the source (on a date inside the copy, its openings plus tally_period's entries to the
date); only a cloud without the view (an older environment) uses the trial balance and ledger functions (tally_tb,
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
  window.__rpc = []; window.__rest = []; window.__bridge = []; window.__view = true; window.__ledgerNone = false; window.__balOn = false;
  Cloud.on = () => true; Cloud.st.firm = {id: "f-1"}; Cloud.st.members = [];
  TCloud.st[c.id] = {at: Date.now(), books: book()};
  const V = [{ledger: "ICICI Bank", parent: "Bank Accounts", open: -350458.92, closing: -276467.36},
             {ledger: "Cash", parent: "Cash-in-hand", open: -14873.75, closing: -34873.75},
             {ledger: "AAR ESS EXIM PRIVATE LIMITED", parent: "Sundry Debtors", open: -45081.54, closing: -684421.54},
             {ledger: "Capital Account", parent: "Capital Account", open: 410414.21, closing: 995762.65}];
  // a ledger deleted in Tally: kept in the cloud with deleted_at (migration-32), nil figures, still in the view
  const DEL = {ledger: "Old Deleted Ledger", parent: "Sundry Creditors", open: 0, closing: 0};
  window.__noDel = false;
  TCloud.restPages = async (u) => { window.__rest.push(u);
    if (/^tally_balances/.test(u)){ if (!window.__view) throw {message: "relation \\"public.tally_balances\\" does not exist (42P01) 404"}; return V.concat([DEL]).map(r => Object.assign({last_day: "2026-03-31"}, r)); }
    if (/^tally_ledgers/.test(u)){
      if (/deleted_at/.test(u) && window.__noDel) throw new Error("column tally_ledgers.deleted_at does not exist");
      if (/deleted_at=not\.is\.null/.test(u)) return [{name: DEL.ledger}];
      const all = V.concat(/deleted_at=is\.null/.test(u) ? [] : [DEL]);
      return all.map(r => ({name: r.ledger, parent: r.parent, open: r.open})); }
    return []; };
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_status") return book();
    if (fn === "tally_tb") return V.map(r => ({ledger: r.ledger, parent: r.parent, open: r.open, movement: r.closing - r.open, closing: r.closing}));
    if (fn === "tally_ledger"){ if (window.__ledgerNone) return {none: true}; const r = V.find(x => x.ledger === a.p_ledger) || {open: 0, closing: 0};
      return {open: a.p_from > "2026-03-31" ? r.closing : r.open, lines: [["20250415", "Receipt", "7", "AAR ESS EXIM PRIVATE LIMITED", "", r.closing - r.open, "g1"]], company: "GARG SHEKHAR & COMPANY", from: "2025-04-01", to: "2026-03-31"}; }
    // migration-37: tally_balances_on(p_book, p_as_on), one request for a date inside the copy; absent on an older cloud
    if (fn === "tally_balances_on"){ if (!window.__balOn) throw new Error("Could not find the function public.tally_balances_on(p_book, p_as_on) in the schema cache (PGRST202)");
      return V.map(r => ({ledger: r.ledger, parent: r.parent, primary_group: "", open: r.open, movement: r.closing - r.open, closing: r.closing})); }
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
    # the owner's finding of 05-Oct-2026: the time says what it is (the copy's readAt: the bridge's last read in Tally)
    ok(E("copyLine(S.coId)") == LINE + " " + hm + " (the bridge's last read of this company in Tally)", "the line: \"%s %s (the bridge's last read of this company in Tally)\"" % (LINE, hm))

    # 1. Look up: the trial balance on 31-Mar-2026, from the view (the copy holds entries up to that day)
    E("() => { S.booksTab = 'lookup'; render(); }"); pg.wait_for_timeout(400)
    E("async () => { const x = LK.st(); Object.assign(x, {kind: 'tb', asOn: '20260331', src: ''}); await LK.run('auto'); }"); pg.wait_for_timeout(500)
    r = E("({src: S.lk.res.src, n: S.lk.res.rows.length, dr: S.lk.res.dr, cr: S.lk.res.cr, line: S.lk.res.line})")
    ok(r["src"] == "cloud" and r["n"] == 4 and r["dr"] == r["cr"] == 995762.65, "1. Look up, trial balance: from FinCom's copy, 4 ledgers, debits = credits = 9,95,762.65 (%s)" % r)
    ok(any(u.startswith("tally_balances") for u in E("window.__rest")), "1. worked out from the view tally_balances")
    t = app()
    ok(LINE in t and pg.locator("#app [data-copy-line]").count() >= 1, "1. the answer carries \"%s …\"" % LINE)
    # round 14 (03-Oct-2026): the owner's current-year note ("Current year not yet read from Tally; figures incomplete.",
    # [data-books-year-note]) is not a source label; the check leaves it out
    t_src = t.replace("Current year not yet read from Tally; figures incomplete.", "")
    ok("from FinCom's copy" in t_src and "from Tally" not in t_src and "Tally, live" not in t_src and "Read again" not in t_src, "1. the source is called FinCom's copy; no \"from Tally\" or \"Tally, live\"")
    # a date inside the copy (before its last day): the view's openings plus the entries to the date (tally_period from the
    # book's first day); tally_tb is not asked while the view is there
    E("async () => { window.__rpc = []; window.__rest = []; const x = LK.st(); Object.assign(x, {kind: 'tb', asOn: '20260215', src: ''}); x.res = null; await LK.run('auto'); }"); pg.wait_for_timeout(500)
    r = E("({src: S.lk.res.src, n: S.lk.res.rows.length, dr: S.lk.res.dr, cr: S.lk.res.cr, rpc: window.__rpc.map(z => z[0]), per: (window.__rpc.find(z => z[0] === 'tally_period') || [0, {}])[1]})")
    ok(r["src"] == "cloud" and r["n"] == 4 and r["dr"] == r["cr"] == 995762.65 and "tally_tb" not in r["rpc"] and r["per"].get("p_from") == "2025-04-01" and r["per"].get("p_to") == "2026-02-15" and any(u.startswith("tally_balances") for u in E("window.__rest")),
       "1. a date inside the copy (15-Feb-2026): the view's openings plus tally_period from 01-Apr-2025, never tally_tb (%s)" % r)
    # with migration-37's function: one request, tally_balances_on(p_book, p_as_on), no tally_period; the same figures
    E("async () => { window.__balOn = true; TCloud.hasBalOn = null; window.__rpc = []; window.__rest = []; const x = LK.st(); Object.assign(x, {kind: 'tb', asOn: '20260215', src: ''}); x.res = null; await LK.run('auto'); }"); pg.wait_for_timeout(500)
    r = E("({src: S.lk.res.src, n: S.lk.res.rows.length, dr: S.lk.res.dr, cr: S.lk.res.cr, rpc: window.__rpc.map(z => z[0]), on: (window.__rpc.find(z => z[0] === 'tally_balances_on') || [0, {}])[1]})")
    ok(r["src"] == "cloud" and r["n"] == 4 and r["dr"] == r["cr"] == 995762.65 and r["rpc"].count("tally_balances_on") == 1 and "tally_period" not in r["rpc"] and "tally_tb" not in r["rpc"]
       and r["on"] == {"p_book": "bk1", "p_as_on": "2026-02-15"} and not any(u.startswith("tally_balances?") for u in E("window.__rest")),
       "1. with tally_balances_on (migration-37): one request for the date, no view read, no tally_period (%s)" % r)
    E("async () => { window.__balOn = false; TCloud.hasBalOn = null; window.__rpc = []; const x = LK.st(); x.res = null; await LK.run('auto'); }"); pg.wait_for_timeout(500)
    r = E("({dr: S.lk.res.dr, rpc: window.__rpc.map(z => z[0]), on: TCloud.hasBalOn})")
    ok(r["dr"] == 995762.65 and "tally_period" in r["rpc"] and r["on"] is False, "1. the function missing (an older cloud): the view plus tally_period again, the same figures (%s)" % r)
    E("() => { LK.st().asOn = '20260331'; }")
    # no view on this cloud (migration-32 not applied): the trial balance function
    E("async () => { window.__view = false; TCloud.hasView = null; window.__rpc = []; S.lk.res = null; await LK.run('auto'); }"); pg.wait_for_timeout(400)
    ok(E("TCloud.hasView") is False and any(f == "tally_tb" for f, _ in E("window.__rpc")) and E("S.lk.res.src") == "cloud" and E("S.lk.res.dr") == 995762.65,
       "1. without the view: tally_tb, the same figures (%s)" % E("S.lk.res.dr"))
    # a ledger
    E("async () => { const x = LK.st(); Object.assign(x, {kind: 'ledger', led: 'ICICI Bank', from: '20250401', to: '20260331', src: ''}); await LK.run('auto'); }"); pg.wait_for_timeout(400)
    r = E("({src: S.lk.res.src, open: S.lk.res.open, close: S.lk.res.close})")
    ok(r["src"] == "cloud" and r["open"] == 350458.92 and r["close"] == 276467.36 and LINE in app(), "1. Look up, a ledger: opening 3,50,458.92 Dr, closing 2,76,467.36 Dr, from the copy, with the line (%s)" % r)
    # smart moves round 1 (09-Oct-2026): the source is under Look up's More
    E("() => document.querySelectorAll('#app details[data-lk-more]').forEach(d => { d.open = true; })"); pg.wait_for_timeout(200)
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
    # 2.4.0 (the upload page simpler): From Tally shows no balance, only whether opening balances are still to come
    step = pg.inner_text("#app [data-upload-page]")
    ok("opening balances not uploaded" not in step and "read from Tally" not in step, "2. Books → From Tally: the openings from the copy count as there, nothing said of Tally (%s)" % pg.inner_text("#app [data-up-status]"))
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

    # 5. ledgers deleted in Tally (tally_ledgers.deleted_at, migration-32) are left out of every read of the cloud's list
    d = E("""async () => { TCloud.hasDel = null; TCloud._del = null; TCloud.hasView = null; window.__view = true; window.__rest = [];
      const names = (await TCloud.restAll('tally_ledgers?select=name,parent&merged_into=is.null&book_id=eq.bk1')).map(r => r.name);
      const view = (await TCloud.viewRows(TCloud.book(S.coId))).map(r => r.ledger);
      const lc = (await Ledgers.readCloud(S.coId, TCloud.book(S.coId))).list.map(l => l.name);
      return {names, view, lc, asked: window.__rest.slice(0, 1)}; }""")
    ok("Old Deleted Ledger" not in d["names"] and "Old Deleted Ledger" not in d["view"] and "Old Deleted Ledger" not in d["lc"] and len(d["lc"]) == 4 and "deleted_at=is.null" in d["asked"][0],
       "5. a ledger deleted in Tally is not in the cloud's ledger list, the ledger chooser's list or the balances (%s)" % d["asked"])
    d = E("""async () => { window.__noDel = true; TCloud.hasDel = null; TCloud._del = null; TCloud.hasView = null;
      const names = (await TCloud.restAll('tally_ledgers?select=name,parent&merged_into=is.null&book_id=eq.bk1')).map(r => r.name);
      const view = (await TCloud.viewRows(TCloud.book(S.coId))).length; window.__noDel = false; return {n: names.length, hasDel: TCloud.hasDel, view}; }""")
    ok(d["n"] == 5 and d["hasDel"] is False and d["view"] == 5, "5. a cloud without the column (migration-32 not applied): read as before, no error (%s)" % d)

    # 6. a bill's ledger chooser opened with a list older than the last posting: the list is asked for again, once per opening
    E("""() => { window.__wake = []; const old = new Date(Date.now() - 3600000).toISOString();
      TCloudUp.post = async (body, who) => { window.__wake.push(JSON.parse(JSON.stringify(body))); return {ok: true, woken: 1, debounced: false}; };
      Ledgers.st[S.coId] = {list: [{name: "ICICI Bank", group: "Bank Accounts"}], at: old, srcAt: old, src: "cloud", book: "bk1", cloudAt: old};
      S.bank.ledgers.importedAt = old; S.bank.ledgers.srcAt = old; S.bank.rows.forEach(r => { r.state = 'ready'; });
      const e = newEntry("Manual entry"); e.exportedAt = new Date(Date.now() - 60000).toISOString(); S.data[S.coId].entries[e.id] = e;
      const mk = (fk) => { const i = document.createElement('input'); i.type = 'text'; i.dataset.e = 'partyLedger'; i.dataset.fk = fk; i.dataset.ac = '1'; i.id = fk; document.body.appendChild(i); return i; };
      mk('e:partyLedgerT1'); const o = document.createElement('button'); o.id = 'outside'; document.body.appendChild(o); }""")
    pg.focus("#e\\:partyLedgerT1"); pg.wait_for_timeout(300)
    pg.keyboard.type("ICI"); pg.wait_for_timeout(300)
    w = E("window.__wake")
    ok(w == [{"kind": "wake", "what": "ledgers", "client": cid}], "6. the chooser opened, list older than the last posting: FinCom's cloud wakes the Tally computer for the ledgers, once while typing (%s)" % w)
    pg.focus("#outside"); pg.wait_for_timeout(200); pg.focus("#e\\:partyLedgerT1"); pg.wait_for_timeout(300)
    ok(len(E("window.__wake")) == 2, "6. opened again: asked again (once per opening)")
    # with the bridge here serving the company: the bridge's own route
    E("""() => { window.__wake = []; window.__bridge = []; window.bridgeLive = () => true; Bridge.openFor = () => ({name: 'GARG SHEKHAR & COMPANY'});
      Bridge.call = async (p, body) => { window.__bridge.push([String(p), body]); return {ok: true, started: true}; }; }""")
    pg.focus("#outside"); pg.wait_for_timeout(200); pg.focus("#e\\:partyLedgerT1"); pg.wait_for_timeout(300)
    b = E("window.__bridge")
    ok(b and b[0][0] == "/ledgers/refresh" and b[0][1].get("company") == "GARG SHEKHAR & COMPANY" and not E("window.__wake"), "6. with the bridge here: POST /ledgers/refresh for the company (%s)" % b)
    # a list read after the last posting: not asked
    E("() => { window.__bridge = []; const now = new Date().toISOString(); Ledgers.st[S.coId].srcAt = now; Ledgers.st[S.coId].at = now; S.bank.ledgers.srcAt = now; S.bank.ledgers.importedAt = now; }")
    pg.focus("#outside"); pg.wait_for_timeout(200); pg.focus("#e\\:partyLedgerT1"); pg.wait_for_timeout(300)
    ok(E("window.__bridge") == [], "6. a list read since the last posting: nothing asked")
    E("() => { window.__bridge = []; }")

    # 4. the bridge was never asked for a balance
    asked = E("window.__bridge")
    ok(not [u for u in asked if any(k in u for k in ("/balances", "/tb", "/ledgerbalance", "balances.json"))], "4. the bridge was never asked for a balance (%s)" % asked)
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\n%d checks failed" % len(fails) if fails else "\nall checks passed")
raise SystemExit(1 if fails else 0)
