"""python3 run_autopost_ui.py - Post automatically in the browser (the React build, offline, a made-up client; a stand-in
bridge in the page answers as FinCom Bridge does: each voucher's FinCom id, its own duplicate check, /unpost by Tally's id):
  1. the setting: off by default; staff cannot switch it on or raise a limit (and see why), can switch it off; the owner
     switches it on (asked once), the hold "Post at once" (0) unless raised; every change logged; All clients
  2. bank: a line that copies a person's approval posts by itself through the usual posting (the bridge's job, the
     FinCom id in the voucher, the postings log "auto (rule …)"); the chip "Auto · rule: BHARATKOSH → MCA EXPENSE" with its
     hover; the lines that wait say why ("Not auto: …"): Cloud Wizard's receipts after guesses (first time), Suspense,
     over the limit; the filter Waiting for me (the default) / Posted automatically
  3. who decided: the automatic line is remembered as "auto" (never a precedent), a person's line as "hand"
  4. two browsers at once (two tabs of the same browser): each line posted once; a second run posts nothing again
  5. undo after posting (the bridge here): /unpost by Tally's id, the line back as waiting, the party paused; the next
     line of that party waits ("paused after a change"), and goes again after an approval by hand
  6. the hold (raised to 15 minutes): "Auto · posting at …"; Undo takes it out, nothing sent
  7. Tally closed (the cloud queue): queued, Undo of one entry cancels the posting and queues the rest again, posted once
     when Tally opens; the Post page's run card with Undo per entry and per run
  8. a bill that copies the person's earlier bill of the same GSTIN is approved (TDS worked out afresh) and posted by itself
     (approvedHow "auto", never a precedent); its chip; a person's edit pauses the supplier
  9. Today: one line; the bell: one notification of the day; the limit per day stops what would pass it
 10. a phone's width: the chip and the filter wrap, no sideways scroll
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_autopost_ui.py   (screenshots: TDSDESK_OUT/autopost-*.png)"""
import os, threading, functools, http.server, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8293), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the stand-in bridge: Tally keeps the FinCom ids it was given (its duplicate check), /unpost deletes by Tally's id
BRIDGE = """() => {
  const G = "GARG SHEKHAR & COMPANY";
  window.__tally = {byId: {}, posts: [], unposts: [], n: 0};
  Bridge.on = () => true; Bridge.up = () => true; Bridge.blocked = () => false;
  Bridge.st = Object.assign(Bridge.st || {}, {tallyUp: true, version: "2.4.5", open: [{name: G, port: 9000, from: "20250401"}], allowImport: true});
  Bridge.openFor = () => ({name: G, port: 9000, from: "20250401"}); Bridge.refresh = async () => {};
  let last = null;
  Bridge.call = async (path, body) => {
    if (path === "/jobs" && body){
      const results = (body.vouchers || []).map(v => {
        const tag = (String(v.xml).match(/TDSDesk:([^<\\s]+)/) || [])[1] || v.id, had = __tally.byId[tag];
        if (had) return {id: v.id, ok: false, message: "Already in Tally (voucher no. " + had.no + ")", vchNumber: had.no};
        const no = String(++__tally.n), guid = "guid-" + no; __tally.byId[tag] = {no, guid, xml: v.xml}; __tally.posts.push({id: v.id, tag, xml: v.xml});
        return {id: v.id, ok: true, verified: true, guid, masterId: "m" + no, vchNumber: no, vchType: /<VOUCHER[^>]*VCHTYPE="([^"]*)"/.exec(v.xml) ? /<VOUCHER[^>]*VCHTYPE="([^"]*)"/.exec(v.xml)[1] : "Payment", vchDate: (/<DATE>(\\d{8})<\\/DATE>/.exec(v.xml) || [])[1] || "", company: G};
      }).concat((body.masters || []).map(m => ({id: m.id, ok: true, existed: true})));
      last = {status: "done", done: results.length, total: results.length, results}; return last;
    }
    if (/^\\/jobs\\?id=/.test(path)) return last;
    if (path === "/unpost"){ __tally.unposts.push(body); Object.keys(__tally.byId).forEach(k => { if (__tally.byId[k].guid === body.guid) delete __tally.byId[k]; }); return {ok: true}; }
    if (/^\\/ledgers/.test(path)) return {ok: true, ledgers: (B() ? B().ledgers.list : []), groups: []};
    if (/^\\/(ledgerlines|vouchers)/.test(path)) return {ok: true, vouchers: []};
    return {ok: true};
  };
}"""
SETUP = """(o) => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  if (o && o.id){ delete S.companies[c.id]; c.id = o.id; }
  S.firm.firmName = S.firm.firmName || "GARG SHEKHAR & COMPANY"; S.firm.firmAddress = S.firm.firmAddress || "Noida";
  c.bankAccounts = [{id: "a1", bank: "HDFC", acct: "50200044416060", last4: "6060", ledger: "HDFC Bank"}];
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY"); choiceConfirm(c, "bank:a1", "HDFC Bank");
  S.coId = c.id; S.view = "company"; S.tab = "bank";
  const L = ["MCA EXPENSE", "Office Expenses", "Suspense", "Bank Charges", "CLOUD WIZARD CONSULTING PRIVATE LIMITED", "Printing & Stationery", "Printastigo", "Dipti Vats Imprest", "HDFC Bank", "Professional Fee"];
  const groups = {"MCA EXPENSE": "Indirect Expenses", "Office Expenses": "Indirect Expenses", "Suspense": "Suspense A/c", "Bank Charges": "Indirect Expenses", "HDFC Bank": "Bank Accounts", "Printing & Stationery": "Indirect Expenses", "Professional Fee": "Indirect Expenses"};
  let n = 0;
  const row = (o) => Object.assign({id: "r" + (++n), fp: "a1|" + o.date + "|" + (o.debit || 0) + "|" + (o.credit || 0) + "|" + n, debit: 0, credit: 0, balOk: true, why: [], userSet: false, source: "", state: "suggested", ledger: ""}, o);
  const BK = {key: "name:bharatkosh", name: "BHARATKOSH", mode: "OTHER"}, CW = {key: "name:cloudwizardconsulting", name: "CLOUD WIZARD CONSULTING PVT LTD", mode: "CHARGES"}, MK = {key: "name:muskan", name: "Mus kan", mode: "IMPS"};
  // an earlier statement, posted: a person's approvals (by hand, and a person's saved rule) and FinCom's guesses
  const old = [
    row({date: "2026-04-03", debit: 1000, narr: "SZ0IP6Q0XDIQK0/BHARATKOSH", dec: BK, ledger: "MCA EXPENSE", state: "sent", source: "rule", vtype: "Payment"}),
    row({date: "2026-04-07", credit: 16200, narr: "50200016049160-TPT-FEES-CLOUD WIZARD CONSULTING PVT LTD", dec: CW, ledger: "Bank Charges", state: "sent", source: "history", vtype: "Receipt"}),
    row({date: "2026-05-06", credit: 16200, narr: "50200016049160-TPT-FEES-CLOUD WIZARD CONSULTING PVT LTD", dec: CW, ledger: "Bank Charges", state: "sent", source: "history", vtype: "Receipt"}),
    row({date: "2026-04-08", debit: 25000, narr: "MMT/IMPS/6 251114394 21/BULD78 172781/Mus kan/CNRB0 002", dec: MK, ledger: "Suspense", state: "sent", source: "you", userSet: true, vtype: "Payment"}),
    row({date: "2026-04-09", debit: 1716, narr: "UPI-DIPTI VATS-9557578961@YBL-PUNB0033300-610303341716", dec: {key: "upi:9557578961@ybl", name: "DIPTI VATS", upi: "9557578961@ybl", mode: "UPI"}, ledger: "Dipti Vats Imprest", state: "sent", source: "you", userSet: true, vtype: "Payment"})];
  // the new statement: what came in today
  const now = [
    row({date: "2026-10-22", debit: 1000, narr: "SB0HCURB2HRMQG/BHARATKOSH", dec: BK, ledger: "MCA EXPENSE", source: "rule", srcLabel: "Saved rule"}),
    row({date: "2026-10-22", credit: 16200, narr: "50200016049160-TPT-RETAINERSEP26-CLOUD WIZARD CONSULTING PVT", dec: CW, ledger: "Bank Charges", source: "history", srcLabel: "History"}),
    row({date: "2026-10-22", debit: 25000, narr: "MMT/IMPS/6 251114394 21/BULD78 172781/Mus kan/CNRB0 002", dec: MK, ledger: "Suspense", source: "history"}),
    row({date: "2026-10-22", debit: 1716, narr: "UPI-DIPTI VATS-9557578961@YBL-PUNB0033300-629303341716", dec: {key: "upi:9557578961@ybl", name: "DIPTI VATS", upi: "9557578961@ybl", mode: "UPI"}, ledger: "Dipti Vats Imprest", source: "history"}),
    row({date: "2026-10-22", debit: 8850, narr: "NEFT-SUVIT FINTECH PRIVATE LIMITED-UTIB0000", dec: {key: "name:suvitfintech", name: "SUVIT FINTECH PRIVATE LIMITED", mode: "NEFT"}, ledger: "", state: "attention"})];
  BankDB.set("stmt:" + c.id + ":s0", old);
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s0", acctId: "a1", bank: "HDFC", acct: "50200044416060", from: "2026-04-01", to: "2026-09-30"}, {id: "s1", acctId: "a1", bank: "HDFC", acct: "50200044416060", from: "2026-10-01", to: "2026-10-22"}], cur: "s1", rows: now, rules: [], wrules: [],
    ledgers: {list: L.map(x => ({name: x, group: groups[x] || "Sundry Creditors"})), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "",
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: [], checkBeforePost: false};
  lsSet(wideCheckKey(), String(Date.now()));
  Store.saveCompany(c);
  render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 950})
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8293/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); E(BRIDGE); pg.wait_for_timeout(500)
    app = lambda: pg.inner_text("#app")
    shot = lambda name: pg.screenshot(path=os.path.join(OUT, "autopost-" + name + ".png"), full_page=False)

    print("== 1. the setting")
    ok(E("loadAutoPost().then(ap => JSON.stringify(ap.cfg(CO())))") == json.dumps({"on": False, "bank": True, "bills": True, "billsNoGstin": False, "bankAmounts": "exact", "perEntry": 50000, "perDay": None, "holdMin": 0, "whoOn": "owner", "whoUndo": "owner+staff"}, separators=(",", ":")),
       "off by default, hold 0 (“Post at once”)")
    E("S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'autopost'; render()"); pg.wait_for_timeout(1500)
    ok(pg.locator("[data-autopost-settings]").count() == 1 and "Post automatically" in pg.inner_text(".setnav"), "Settings → Post automatically, next to AI help")
    ok("off" in pg.inner_text('.setnav button[aria-current="page"]'), "its status: off")
    # staff: cannot switch it on
    E("S.account = {me: {role: 'staff', email: 'staff@fincomindia.in'}, firm: null}; render()"); pg.wait_for_timeout(500)
    ok(pg.locator("[data-ap-on]").is_disabled() and pg.locator("[data-ap-owner-only]").count() == 1, "staff: the switch is the owner's (“Only the firm’s owner can switch it on”)")
    r = E("loadAutoPost().then(ap => ap.save(CO(Object.keys(S.companies)[0]), {on: true}))")
    ok(r["ok"] is False and "Only the firm’s owner can switch it on" in r["why"], "and the app refuses it from staff: " + r.get("why", ""))
    # the owner switches it on, with "any amount within the limit" (as the replay measured), and a daily limit
    E("S.account = {me: {role: 'owner', email: 'anshul@fincomindia.in'}, firm: null}; render()"); pg.wait_for_timeout(500)
    pg.check("[data-ap-on]"); pg.select_option("[data-ap-amounts]", "within"); pg.fill("[data-ap-per-day]", "500000"); pg.wait_for_timeout(200)
    shot("settings-draft")
    pg.click("[data-ap-save]"); pg.wait_for_timeout(500)
    ok(pg.locator("#confirmBox").count() == 1 and "by itself" in pg.inner_text("#confirmBox") and "undo any entry" in pg.inner_text("#confirmBox"), "switching on asks once: “Posts to … by itself. You can undo any entry.”")
    pg.click('#confirmBox button:has-text("Switch it on")'); pg.wait_for_timeout(600)
    c = E("JSON.stringify(CO(Object.keys(S.companies)[0]).choices.autopost)")
    ok('"on":true' in c and '"perDay":500000' in c and '"holdMin":0' in c and '"by":"this computer"' in c or '"on":true' in c, "saved, with who and when: " + c[:160])
    ok(pg.locator("[data-ap-log] tbody tr").count() == 1 and "Switched on for Testing AAD" in pg.inner_text("[data-ap-log]"), "the change is in the log: " + pg.inner_text("[data-ap-log] tbody")[:140])
    ok("on" in pg.inner_text('[data-ap-all] tr[data-ap-client="%s"]' % cid) and "on for 1 of 1" in pg.inner_text('.setnav button[aria-current="page"]'), "All clients, and the status: on for 1 of 1 clients")
    shot("settings")
    # staff: may switch off and tighten; not raise
    E("S.account = {me: {role: 'staff', email: 'staff@fincomindia.in'}, firm: null}")
    r = E("loadAutoPost().then(ap => ap.save(CO('%s'), Object.assign({}, ap.cfg(CO('%s')), {perEntry: 100000})))" % (cid, cid))
    ok(r["ok"] is False and "raise the limit per entry" in r["why"], "staff cannot raise the limit: " + r["why"])
    r = E("loadAutoPost().then(ap => ap.save(CO('%s'), Object.assign({}, ap.cfg(CO('%s')), {perEntry: 40000})))" % (cid, cid))
    ok(r["ok"] is True, "staff can lower it")
    r = E("loadAutoPost().then(ap => ap.save(CO('%s'), Object.assign({}, ap.cfg(CO('%s')), {on: false})))" % (cid, cid))
    ok(r["ok"] is True and E("CO('%s').choices.autopost.value.on" % cid) is False, "staff can switch it off")
    E("S.account = {me: {role: 'owner', email: 'anshul@fincomindia.in'}, firm: null}")
    E("loadAutoPost().then(ap => ap.save(CO('%s'), Object.assign({}, ap.cfg(CO('%s')), {on: true, perEntry: 50000})))" % (cid, cid))
    ok(E("CO('%s').autopostLog.length" % cid) == 4 and E("CO('%s').autopostLog.map(l => l.role).join(',')" % cid) == "owner,staff,staff,owner", "every change logged with the person's role (4)")

    print("== 2. bank: posted by itself through the usual posting")
    E("openCompany('%s').then(() => { S.tab = 'bank'; goStep('review', 'bank'); })" % cid); pg.wait_for_timeout(1200)
    E("S.bank.loading = false; render()"); pg.wait_for_timeout(300)
    if E("!S.bank || S.bank.cid !== '%s' || S.bank.rows.length !== 5" % cid):
        E(SETUP.replace("const c = newCompany", "const c0 = CO(); const c = c0 || newCompany").replace("S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};", "").replace('choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY"); choiceConfirm(c, "bank:a1", "HDFC Bank");', ""))
        pg.wait_for_timeout(400)
    res = E("loadAutoPost().then(ap => ap.tick(S.coId, 'test')).then(r => JSON.stringify(r))")
    pg.wait_for_timeout(800)
    rows = E("JSON.stringify(B().rows.map(r => [r.dec.name, r.state, r.ledger, r.auto ? r.auto.rule : '', r.autoWhy || '']))")
    print("     run: " + res + "\n     rows: " + rows)
    bk = E("(() => { const r = B().rows.find(r => /BHARATKOSH/.test(r.narr)); return {state: r.state, auto: !!r.auto, rule: r.auto && r.auto.rule, ledger: r.ledger}; })()")
    ok(bk["state"] == "sent" and bk["auto"] and bk["rule"] == "B1" and bk["ledger"] == "MCA EXPENSE", "BHARATKOSH ₹1,000 copies the person's rule: posted by itself to MCA EXPENSE (B1): %s" % bk)
    dv = E("(() => { const r = B().rows.find(r => /DIPTI/.test(r.narr)); return {state: r.state, rule: r.auto && r.auto.rule}; })()")
    ok(dv["state"] == "sent" and dv["rule"] == "B1", "DIPTI VATS (UPI handle, set by hand before): posted by itself")
    posts = E("JSON.stringify(__tally.posts.map(p => [p.id, p.tag]))")
    ok(E("__tally.posts.length") == 2 and E("__tally.posts.every(p => /TDSDesk:/.test(p.xml))"), "through the bridge's job, each voucher with FinCom's id (TDSDesk:…): %s" % posts)
    why = E("Object.fromEntries(B().rows.filter(r => !r.auto).map(r => [r.dec.name, r.autoWhy]))")
    ok(why.get("CLOUD WIZARD CONSULTING PVT LTD") == "first time for this party", "Cloud Wizard's receipt after FinCom's guesses waits: “first time for this party” (%s)" % why.get("CLOUD WIZARD CONSULTING PVT LTD"))
    ok("Suspense is never posted by itself" in (why.get("Mus kan") or ""), "the Suspense line waits: %s" % why.get("Mus kan"))
    ok(why.get("SUVIT FINTECH PRIVATE LIMITED") == "first time for this party", "a new party waits")
    log = E("S.firm.postLog.slice(-2).map(l => l.by + ' | ' + l.auto)")
    ok(all(l.startswith("auto (rule; set by") for l in log), "the postings log says “auto (rule; set by …)”: %s" % log)
    E("bankTabGo('done')"); pg.wait_for_timeout(400)
    chip = pg.locator('#app table.bk-table [data-ap-chip="B1"]').first
    ok(chip.count() == 1 and "Auto · rule: BHARATKOSH → MCA EXPENSE" in chip.inner_text(), "the chip: “Auto · rule: BHARATKOSH → MCA EXPENSE”")
    chip.hover(); pg.wait_for_timeout(300)
    tip = pg.locator('#app table.bk-table [data-ap-chip="B1"] .ap-tip').first
    ok(tip.is_visible() and "Posted automatically" in tip.inner_text() and "Copied from your approval of 03-Apr-2026" in tip.inner_text(), "its hover: when, the rule and the approval it copied: " + tip.inner_text().replace("\n", " ")[:160])
    shot("bank-intally-hover")
    E("bankTabGo('review')"); pg.wait_for_timeout(400)
    ok(pg.locator("#app [data-ap-filter=bank] button.on").inner_text().startswith("Waiting for me"), "the filter under the tabs: Waiting for me by default")
    ok(pg.locator("#app [data-ap-why]").count() >= 2 and "Not auto: first time for this party" in app(), "each waiting line says why it was not posted by itself")
    shot("bank-waiting")
    pg.click('#app [data-ap-filter=bank] button:has-text("Posted automatically")'); pg.wait_for_timeout(400)
    n = pg.locator("#app table.bk-table tbody tr").count()
    ok(n == 2 and "2 today" in pg.inner_text("#app [data-ap-filter=bank]") and pg.locator("#app [data-ap-runline]").count() == 1, "Posted automatically: the 2 lines, “2 today”, Undo this run")
    shot("bank-auto")

    print("== 3. who decided")
    E("learnRows(B().rows.filter(r => r.auto), 'sent')")
    hs = E("JSON.stringify(Object.values(B().hist.rows).map(h => h.h))")
    ok(hs == '["auto","auto"]', "automatic lines are remembered as “auto” (never a precedent): %s" % hs)
    r = E("(() => { const r = B().rows.find(r => /SUVIT/.test(r.narr)); setLedgerFor([r], 'Office Expenses'); return [B().hist.rows[r.fp].h, B().hist.rows[r.fp].by, r.decidedBy]; })()")
    ok(r[0] == "hand" and r[1] and r[2], "a line a person sets is remembered as “hand”, with who: %s" % r)

    print("== 4. two browsers at once; a second run")
    before = E("__tally.posts.length")
    E("loadAutoPost().then(ap => ap.tick(S.coId, 'again'))"); pg.wait_for_timeout(1200)
    ok(E("__tally.posts.length") == before, "a second run posts nothing again")
    pg2 = ctx.new_page(); pg2.on("pageerror", lambda e: errors.append("tab 2: " + str(e)))
    pg3 = ctx.new_page(); pg3.on("pageerror", lambda e: errors.append("tab 3: " + str(e)))
    for q in (pg2, pg3):
        q.goto("http://localhost:8293/"); q.wait_for_timeout(2500)
        if q.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): q.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); q.wait_for_timeout(800)
        q.evaluate(SETUP, {"id": "c-race"}); q.evaluate(BRIDGE)
        q.evaluate("(() => { const co = CO(); co.choices.autopost = {value: {on: true, bank: true, bills: true, bankAmounts: 'within', perEntry: 50000, holdMin: 0}, state: 'confirmed'}; B().rows.forEach(r => { r.fp = 'race|' + r.id; }); })()")
    outs = [None, None]
    def go(i, q):
        outs[i] = q.evaluate("loadAutoPost().then(ap => ap.tick(S.coId, 'race')).then(() => __tally.posts.map(p => p.id))")
    import threading as th
    ts = [th.Thread(target=go, args=(0, pg2)), th.Thread(target=go, args=(1, pg3))]
    # Playwright's sync API is not thread-safe: the two runs are started together from the pages themselves instead
    pg2.evaluate("window.__go = () => loadAutoPost().then(ap => ap.tick(S.coId, 'race'))"); pg3.evaluate("window.__go = () => loadAutoPost().then(ap => ap.tick(S.coId, 'race'))")
    pg2.evaluate("setTimeout(() => window.__go(), 300)"); pg3.evaluate("setTimeout(() => window.__go(), 300)"); pg2.wait_for_timeout(3000)
    p2, p3 = pg2.evaluate("__tally.posts.map(p => p.id)"), pg3.evaluate("__tally.posts.map(p => p.id)")
    ok(len(p2) + len(p3) == 2 and not (set(p2) & set(p3)), "two tabs at the same moment: each line posted once (%s / %s)" % (p2, p3))
    pg2.close(); pg3.close()

    print("== 5. undo after posting (the bridge on this computer)")
    E("S.apView = {bank: 'auto'}; bankTabGo('done')"); pg.wait_for_timeout(400)
    rid = E("B().rows.find(r => /BHARATKOSH/.test(r.narr)).id")
    pg.click('#app table.bk-table [data-ap-undo="%s"]' % rid); pg.wait_for_timeout(500)
    ok(pg.locator("#confirmBox").count() == 1 and "Remove this entry from Tally?" in pg.inner_text("#confirmBox"), "Undo of a line in Tally asks, as Take it back does")
    pg.click('#confirmBox button:has-text("Remove it")'); pg.wait_for_timeout(900)
    r = E("(() => { const r = B().rows.find(r => r.id === '%s'); return {state: r.state, auto: !!r.auto, undone: !!r.autoUndone, ledger: r.ledger}; })()" % rid)
    ok(E("__tally.unposts.length") == 1 and E("__tally.unposts[0].guid").startswith("guid-") and r["state"] in ("suggested", "attention") and not r["auto"] and r["undone"], "deleted from Tally by its id (/unpost), the line back as waiting: %s" % r)
    pz = E("JSON.stringify(CO().autopostPause)")
    ok("name:bharatkosh|out" in pz, "the party's rule is paused: " + pz[:120])
    ok("rule paused" in pg.inner_text("#toast"), "the message: " + pg.inner_text("#toast")[:140])
    shot("bank-undone")
    E("""B().rows.push(Object.assign({}, B().rows.find(r => r.id === '%s'), {id: 'rB2', fp: 'a1|2026-10-23|1000|0|99', date: '2026-10-23', narr: 'SC1HCURB2HRMQG/BHARATKOSH', state: 'suggested', userSet: false, source: 'rule', autoUndone: null, autoWhy: undefined})); render()""" % rid)
    E("loadAutoPost().then(ap => ap.tick(S.coId, 'paused'))"); pg.wait_for_timeout(1000)
    ok(E("B().rows.find(r => r.id === 'rB2').state") == "suggested" and "paused after a change" in (E("B().rows.find(r => r.id === 'rB2').autoWhy") or ""), "the next line of that party waits: " + str(E("B().rows.find(r => r.id === 'rB2').autoWhy")))
    ok(E("B().rows.find(r => r.id === '%s').autoWhy" % rid) and "took the automatic entry back" in E("B().rows.find(r => r.id === '%s').autoWhy" % rid), "the line taken back never goes by itself again")
    # a person approves one by hand: the rule resumes
    E("(() => { const r = B().rows.find(r => r.id === '%s'); setLedgerFor([r], 'MCA EXPENSE'); r.state = 'sent'; r.sentAt = new Date(Date.now() + 1000).toISOString(); })()" % rid)
    ok(E("B().rows.find(r => r.id === 'rB2').userSet") is True, "(the person's ledger also set the party's other open line: theirs now)")
    E("""B().rows.push(Object.assign({}, B().rows.find(r => r.id === 'rB2'), {id: 'rB3', fp: 'a1|2026-10-23|1000|0|97', narr: 'SD1HCURB2HRMQG/BHARATKOSH', state: 'suggested', userSet: false, source: 'rule', autoWhy: undefined})); render()""")
    E("loadAutoPost().then(ap => ap.tick(S.coId, 'resume'))"); pg.wait_for_timeout(1200)
    ok(E("B().rows.find(r => r.id === 'rB3').state") == "sent", "after an approval by hand, the party's next line goes by itself again (%s)" % E("JSON.stringify([B().rows.find(r => r.id === 'rB3').state, B().rows.find(r => r.id === 'rB3').autoWhy, B().rows.filter(r => /BHARATKOSH/.test(r.narr)).map(r => [r.id, r.state, r.vtype, r.userSet, r.source, (r.splits||[]).length, r.tdsAtPay])])"))

    print("== 6. the hold (raised to 15 minutes)")
    E("loadAutoPost().then(ap => ap.save(CO(), Object.assign({}, ap.cfg(CO()), {holdMin: 15})))")
    E("""B().rows.push(Object.assign({}, B().rows.find(r => /DIPTI/.test(r.narr)), {id: 'rD2', fp: 'a1|2026-10-23|1716|0|98', date: '2026-10-23', state: 'suggested', auto: null, autoWhy: undefined, tally: null, sentAt: ''})); render()""")
    E("loadAutoPost().then(ap => ap.tick(S.coId, 'hold'))"); pg.wait_for_timeout(1000)
    h = E("(() => { const r = B().rows.find(r => r.id === 'rD2'); return {state: r.state, hold: !!r.autoHold, auto: !!r.auto}; })()")
    ok(h["hold"] and not h["auto"] and h["state"] == "suggested" and E("__tally.posts.length") == 3, "it waits in the hold: nothing sent yet (%s)" % h)
    E("S.apView = {bank: 'auto'}; bankTabGo('review')"); pg.wait_for_timeout(400)
    ok("Auto · posting at" in pg.inner_text('#app tr:has([data-ap-undo="rD2"]) .ap-tip') or "Auto · posting at" in pg.inner_text('#app tr:has([data-ap-undo="rD2"])'), "its chip says when it goes (“Auto · posting at …”)")
    pg.click('#app [data-ap-undo="rD2"]'); pg.wait_for_timeout(700)
    h = E("(() => { const r = B().rows.find(r => r.id === 'rD2'); return {state: r.state, hold: !!r.autoHold, undone: !!r.autoUndone}; })()")
    ok(not h["hold"] and h["undone"] and E("__tally.posts.length") == 3, "Undo in the hold takes it out; nothing reached Tally (%s)" % h)
    E("loadAutoPost().then(ap => ap.save(CO(), Object.assign({}, ap.cfg(CO()), {holdMin: 0})))")

    print("== 7. Tally closed: the cloud queue")
    if pg.locator('[role=dialog] button:has-text("Later")').count(): pg.click('[role=dialog] button:has-text("Later")'); pg.wait_for_timeout(400)
    QUEUE = """() => {
      const co = CO(); window.__q = {enq: [], cancel: [], st: {}};
      Bridge.on = () => false; Bridge.up = () => false;
      Cloud.on = () => true; Cloud.st.firm = ""; TCloud.on = () => true; TCloud.has = () => true; TCloud.status = async () => {};
      TCloud.st[co.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY"}]};
      TCloud.book = () => ({company: "GARG SHEKHAR & COMPANY", book: "bk1"}); TCloud.postTargetFor = () => ""; TCloud.restAll = async () => [];
      TCloud.rpc = async (fn, a) => { if (fn === "tally_post_enqueue"){ __q.enq.push(a); __q.st[a.p_id] = {status: "waiting", payload: a.p_payload}; return {ok: true}; }
        if (fn === "tally_post_cancel"){ __q.cancel.push(a.p_id); if (__q.st[a.p_id]) __q.st[a.p_id].status = "cancelled"; return {ok: true}; } if (fn === "tally_vouchers_in") return []; return {ok: true}; };
      CloudPost.row = async (id) => { const j = __q.st[id]; if (!j) return null; const vs = j.payload.vouchers || [];
        return {id, status: j.status, n: vs.length, done: j.status === "done" ? vs.length : 0, company: "GARG SHEKHAR & COMPANY", message: j.status === "cancelled" ? "Cancelled" : "",
          results: j.status === "done" ? vs.map((v, i) => ({id: v.id, ok: true, verified: true, guid: "qguid-" + v.id, vchNumber: "Q" + i})) : []}; };
    }"""
    E(QUEUE)
    # two parties a person approved by hand earlier (CCAPROTEAN, ZOMATO); three new lines of theirs
    E("""(() => { const row = (o) => Object.assign({balOk: true, why: [], vtype: 'Payment', credit: 0, autoWhy: undefined}, o);
      const CC = {key: 'upi:ccaprotean@hdfc', name: 'CCAPROTEAN', upi: 'ccaprotean@hdfc', mode: 'UPI'}, ZO = {key: 'upi:zomato@hdfc', name: 'ZOMATO', upi: 'zomato@hdfc', mode: 'UPI'};
      B().rows.push(row({id: 'pCC', fp: 'a1|2026-09-02|107|0|1', date: '2026-09-02', debit: 107, narr: '114480959285/CCAPROTEAN', dec: CC, ledger: 'Office Expenses', state: 'sent', userSet: true, source: 'you'}),
        row({id: 'pZO', fp: 'a1|2026-09-03|450|0|1', date: '2026-09-03', debit: 450, narr: 'UPI-ZOMATO-zomato@hdfc', dec: ZO, ledger: 'Office Expenses', state: 'sent', userSet: true, source: 'you'}),
        row({id: 'rQ1', fp: 'a1|2026-10-24|107|0|1', date: '2026-10-24', debit: 107, narr: '114480959999/CCAPROTEAN', dec: CC, ledger: 'Office Expenses', state: 'suggested', source: 'history'}),
        row({id: 'rQ2', fp: 'a1|2026-10-24|107|0|2', date: '2026-10-24', debit: 107, narr: '114480959998/CCAPROTEAN', dec: CC, ledger: 'Office Expenses', state: 'suggested', source: 'history'}),
        row({id: 'rQ3', fp: 'a1|2026-10-24|450|0|3', date: '2026-10-24', debit: 450, narr: 'UPI-ZOMATO-zomato@hdfc-2', dec: ZO, ledger: 'Office Expenses', state: 'suggested', source: 'history'}));
      render(); })()""")
    E("(() => { window.__run = loadAutoPost().then(ap => ap.tick(S.coId, 'queue')); return 1; })()"); pg.wait_for_timeout(3500)
    q = E("({enq: __q.enq.length, ids: __q.enq.length ? __q.enq[0].p_payload.vouchers.map(v => v.id) : [], rows: ['rQ1','rQ2','rQ3'].map(id => { const r = B().rows.find(r => r.id === id); return [r.state, !!r.auto]; })})")
    ok(q["enq"] == 1 and sorted(q["ids"]) == ["rQ1", "rQ2", "rQ3"] and all(s == ["ready", True] for s in q["rows"]), "Tally closed: the three go to the cloud queue, as today (%s)" % q)
    E("S.apView = {bank: 'auto'}; bankTabGo('ready')"); pg.wait_for_timeout(500)
    ok("Queued automatically" in pg.inner_text('#app tr:has([data-ap-undo="rQ1"]) .ap-tip'), "the chip says it is queued")
    shot("bank-queued")
    pg.click('#app [data-ap-undo="rQ1"]'); pg.wait_for_timeout(5000)
    q = E("({cancel: __q.cancel.length, enq: __q.enq.length, second: __q.enq.length > 1 ? __q.enq[1].p_payload.vouchers.map(v => v.id) : [], r1: B().rows.find(r => r.id === 'rQ1').state, r1auto: !!B().rows.find(r => r.id === 'rQ1').auto})")
    ok(q["cancel"] == 1 and q["enq"] == 2 and sorted(q["second"]) == ["rQ2", "rQ3"] and q["r1"] in ("suggested", "attention") and not q["r1auto"], "Undo of one queued entry: the posting cancelled, the other two queued again under a new posting (%s)" % q)
    E("__q.st[__q.enq[1].p_id].status = 'done'"); pg.wait_for_timeout(5000)
    q = E("['rQ2','rQ3'].map(id => B().rows.find(r => r.id === id).state)")
    ok(q == ["sent", "sent"], "when Tally opens, the two are posted, once: %s" % q)
    E("goStep('post', 'bills'); S.postTabs = Object.assign({}, S.postTabs, {[S.coId]: 'posted'}); render()"); pg.wait_for_timeout(1500)
    ok(pg.locator("[data-ap-run]").count() >= 2 and "Automatic run" in app() and pg.locator("[data-ap-undo-run]").count() >= 1, "Post to Tally → Posted: a card per automatic run, with Undo of the whole run")
    ok(pg.locator("[data-ap-runs] tr.undone").count() >= 2, "the entries undone are shown struck through in their run")
    shot("post-runs")
    # undo of an entry in Tally on a computer without the bridge
    rq = E("B().rows.find(r => r.id === 'rQ2').id")
    pg.click('[data-ap-runs] [data-ap-undo="%s"]' % rq); pg.wait_for_timeout(800)
    ok(pg.locator("[data-ap-msg]").count() == 1 and "only on the Tally computer" in pg.inner_text("[data-ap-msg]") and E("!!B().rows.find(r => r.id === 'rQ2').auto.undoWanted"), "without the bridge here: says it can be taken back only on the Tally computer, and marks it for there")
    shot("post-runs-nobridge")

    print("== 8. a purchase bill")
    E(BRIDGE); E("Cloud.on = () => false; TCloud.on = () => false")
    r = E("""(() => {
      const c = CO(); c.choices.autopost.value.bills = true;
      const mk = (no, date, amt) => { const e = newEntry("Manual entry"); e.id = "b-" + no.replace(/\\W/g, ""); Object.assign(e.x, {vendorName: "PRINTASTIGO", vendorGstin: "07AXWPT2445D1Z2", vendorPan: "AXWPT2445D", invoiceNo: no, invoiceDate: date, taxable: amt, total: amt, items: [{hsn: "48201020", taxable: amt}]});
        e.natureId = "goods"; e.partyLedger = "Printastigo"; e.expenseLedger = "Printing & Stationery"; e.readMode = "free (PDF text)"; e.fileHash = "fh" + no.replace(/\\W/g, "") + "p1"; S.data[c.id].entries[e.id] = e; return e; };
      const p = mk("PT/1098", "2026-08-25", 1400); approve(p);
      Object.assign(p, {exportedAt: "2026-09-25T10:00:00Z", postVerified: true, tally: {guid: "g-p", vchType: "Purchase", vchDate: "20260825"}});
      const e = mk("PT/1144", "2026-10-20", 1652);
      return [p.approvedHow, p.approvedBy];
    })()""")
    ok(r[0] == "hand" and r[1], "a bill a person approves is kept with who and how (“hand”): %s" % r)
    E("S.tab = 'review'; S.filter = 'draft'; goStep('review', 'bills'); render()"); pg.wait_for_timeout(800)
    E("loadAutoPost().then(ap => ap.tick(S.coId, 'bill'))"); pg.wait_for_timeout(2500)
    b = E("(() => { const e = D().entries['b-PT1144']; return {status: e.status, how: e.approvedHow, auto: e.auto && e.auto.rule, exported: !!e.exportedAt, from: e.autoFrom, why: e.autoWhy || '', tds: e.snapshot && e.snapshot.tds}; })()")
    ok(b["status"] == "approved" and b["how"] == "auto" and b["auto"] == "P1" and b["exported"] and b["from"] == "b-PT1098", "the bill copying the person's PT/1098 (same GSTIN, ledgers, HSN): approved and posted by itself (%s)" % b)
    ok(E("__tally.posts.some(p => p.id === 'b-PT1144' && /TDSDesk:b-PT1144/.test(p.xml))"), "through the same posting, with FinCom's id")
    E("S.filter = 'approved'; S.selected = 'b-PT1144'; render()"); pg.wait_for_timeout(600)
    ok(pg.locator('[data-bill-auto] [data-ap-chip="P1"]').count() == 1 and "PRINTASTIGO 07AXWPT2445D1Z2" in pg.inner_text("[data-bill-auto]") and "Open the bill it copied" in pg.inner_text("[data-bill-auto]"), "the bill shows its chip, the bill it copied and Undo")
    shot("purchase-auto")
    ok(E("loadAutoPost().then(ap => { const idx = ap.billCheck(Object.assign({}, D().entries['b-PT1144'], {id: 'probe', status: 'draft', auto: null, fileHash: 'zz'}), {cfg: ap.cfg(CO()), entries: Object.fromEntries(Object.entries(D().entries).filter(([k]) => k !== 'b-PT1098')), env: ap.env(S.coId)}); return idx.why; })") == "first bill of this supplier",
       "an automatic bill is never a precedent")

    print("== 9. Today, the bell, the daily limit")
    E("navHome('today')"); pg.wait_for_timeout(1000)
    ok(pg.locator("[data-ap-today]").count() == 1 and "posted automatically today" in pg.inner_text("[data-ap-today]"), "Today: one line: " + (pg.inner_text("[data-ap-today]") if pg.locator("[data-ap-today]").count() else ""))
    shot("today")
    al = E("AlertHub.list().filter(a => /^autopost:/.test(a.key)).map(a => a.text + ' | ' + a.fix)")
    ok(len(al) == 1 and al[0].startswith("Posted automatically today:"), "the bell: one notification of the day: %s" % al)
    E("S.alertsOpen = true; render()"); pg.wait_for_timeout(500)
    shot("bell")
    E("AlertClear.clear(AlertHub.list().filter(a => /^autopost:/.test(a.key)))"); pg.wait_for_timeout(300)
    ok(E("AlertHub.list().filter(a => /^autopost:/.test(a.key)).length") == 0, "Clear: the notification goes (the entries stay)")
    E("S.alertsOpen = false; render()")
    # the daily limit: a client whose day is nearly used up
    r = E("""loadAutoPost().then(async ap => { const co = CO(); ap.save(co, Object.assign({}, ap.cfg(co), {perDay: 3000}));
      const base = B().rows.find(r => r.id === 'pZO');
      ['rL1', 'rL2'].forEach((id, i) => B().rows.push(Object.assign({}, base, {id, fp: 'a1|2026-10-25|450|0|' + i, date: '2026-10-25', narr: base.narr + 'L' + i, state: 'suggested', auto: null, autoUndone: null, autoWhy: undefined, tally: null, sentAt: '', userSet: false, source: 'history'})));
      S.coId = B().cid; await ap.tick(S.coId, 'limit'); return ['rL1', 'rL2'].map(id => { const r = B().rows.find(r => r.id === id); return [r.state, r.autoWhy || '']; }); })""")
    ok(any(x[1] == "over the daily limit for today" for x in r), "the daily total: what would pass it waits (“over the daily limit for today”): %s" % r)

    print("== 10. a phone's width")
    pg.set_viewport_size({"width": 390, "height": 844}); E("openCompany(B().cid).then(() => { goStep('review', 'bank'); S.apView = {bank: 'waiting'}; render(); })"); pg.wait_for_timeout(1200)
    sw = E("[document.documentElement.scrollWidth, window.innerWidth]")
    ok(sw[0] <= sw[1] + 1 and pg.locator("#app [data-ap-filter=bank]").count() == 1, "the filter and chips wrap, no sideways scroll (%s)" % sw)
    shot("phone")
    real = [e for e in errors if "supabase" not in e.lower() and "Failed to fetch" not in e]
    ok(not real, "no page errors: %s" % real[:3])
    br.close()
print("\n%d FAILED" % len(fails) if fails else "\nall passed")
import sys; sys.exit(1 if fails else 0)
