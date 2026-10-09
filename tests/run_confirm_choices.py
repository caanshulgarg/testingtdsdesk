"""python3 run_confirm_choices.py - review 18-21 (02-Oct-2026): "confirm once, keep, show only when needed".
  (a) a bank account's Tally ledger chosen and confirmed: one line "Tally ledger: HDFC BANK · Change" after a reload, a new
      statement uploaded, a ledger list still loading, a sync; and in another browser (a fresh context whose only data comes
      from a stand-in cloud serving the client row and statement the first browser sent), after signing in there;
      "HDFC BANK is no longer in Tally. Choose again" only once a complete ledger list lacks it; Change asks, keeps who/when;
  (b) a sync with an older copy never blanks a confirmed choice: an older client row applied (cloudApply), and a browser
      holding an older copy pushing through cloudPushClient against a stand-in server;
  (c) a guessed choice is not used for posting: bank lines, the Tally company (postTo "auto") and a bill's TDS ledger from
      Client setup each wait, with one line saying why, and nothing is sent; auto-matching never overwrites a confirmed one;
  (d) every settings page shows the shared footer (Not saved yet / Save / Saved · time · who), a change is a draft until
      Save, and leaving with unsaved changes asks "Save your changes?" (Save / Don't save / Stay), also on closing the tab.
Uses Testing AAD's books for the books pages (tests/data, not in git).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_confirm_choices.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8261), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

LEDGERS = [["HDFC BANK", "Bank Accounts"], ["ICICI BANK", "Bank Accounts"], ["Office Rent", "Indirect Expenses"], ["Kashi IT Solutions", "Sundry Creditors"],
           ["Bank Charges", "Indirect Expenses"], ["TDS Payable - Professional", "Duties & Taxes"], ["Professional Charges", "Indirect Expenses"]]
# browser A: a client with a bank account whose Tally ledger is not chosen yet, its statement kept in this browser
SETUP = """async (leds) => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  c.bankAccounts = [{id: "ba1", bank: "HDFC Bank", last4: "1234", acct: "50100001231234", ifsc: "HDFC0000001", ledger: ""}];
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c);
  const rows = [["2026-04-02", "NEFT DR OFFICE RENT APRIL", 25000, 0], ["2026-04-05", "UPI KASHI IT SOLUTIONS", 11800, 0], ["2026-04-09", "NEFT CR CUSTOMER", 0, 50000]].map((x, i) => ({
    id: "s1-" + i, fp: "fp" + i, date: x[0], narr: x[1], debit: x[2], credit: x[3], balance: 100000, dec: decodeNarr(x[1], c.name), state: "attention", ledger: "", userSet: false}));
  const st = {id: "s1", fileName: "hdfc-apr.csv", hash: "h1", bank: "HDFC Bank", acctId: "ba1", acct: "50100001231234", ifsc: "HDFC0000001", from: "2026-04-01", to: "2026-04-30", opening: 100000, closing: 113200, n: 3, uploadedAt: new Date().toISOString()};
  const now = new Date().toISOString(), list = leds.map(([name, group]) => ({name, group}));
  await BankDB.set("stmts:" + c.id, [st]); await BankDB.set("stmt:" + c.id + ":s1", rows);
  await BankDB.set("ledgers:" + c.id, {list, importedAt: now, srcAt: now, src: "cloud", live: true});
  await openCompany(c.id); S.tab = "bank"; await loadBank(c.id);
  Ledgers.take(c.id, {list, src: "cloud", at: now, srcAt: now});
  render(); return c.id; }"""
OPEN_BANK = """async (cid) => { await openCompany(cid); S.tab = "bank"; await loadBank(cid); render(); }"""
# a stand-in for the firm's server: GET a client row, a PATCH only when updated_at still matches, POST new rows
SERVER = """(rows) => {
  window.__srv = rows || {}; window.__tick = 0;
  const stamp = () => "2026-10-02T09:" + String(10 + (++window.__tick)).padStart(2, "0") + ":00.000000+00:00";
  Cloud.on = () => true; Cloud.st.firm = "F1"; Cloud.st.email = Cloud.st.email || "";
  Cloud.api = async (p, o) => { o = o || {};
    if (/^clients\\?firm_id/.test(p)){
      const id = decodeURIComponent((p.match(/&id=eq\\.([^&]+)/) || [])[1] || ""), row = window.__srv[id];
      if (!o.method || o.method === "GET") return row ? [{data: JSON.parse(JSON.stringify(row.data)), updated_at: row.updated_at, deleted: false}] : [];
      if (o.method === "PATCH"){ const want = decodeURIComponent((p.match(/&updated_at=eq\\.([^&]+)/) || [])[1] || ""); if (!row || row.updated_at !== want) return [];
        Object.assign(row, JSON.parse(JSON.stringify(o.body)), {updated_at: stamp()}); return [{data: JSON.parse(JSON.stringify(row.data)), updated_at: row.updated_at}]; }
    }
    if (/^clients/.test(p) && o.method === "POST"){ [].concat(o.body).forEach(b => { window.__srv[b.id] = Object.assign(JSON.parse(JSON.stringify(b)), {updated_at: stamp()}); }); return null; }
    if (/^clients\\?select=/.test(p)) return Object.entries(window.__srv).map(([id, r]) => ({id, data: JSON.parse(JSON.stringify(r.data)), deleted: false, updated_at: r.updated_at}));
    if (/^records\\?select=/.test(p)) return window.__recs || [];
    return [];
  };
}"""
PUSH = """async (cid) => { const co = S.companies[cid]; const r = {kind: "client", id: cid, data: JSON.parse(JSON.stringify(co)), hash: fpHash(JSON.stringify(co))};
  return await cloudPushClient(r, async (table, rows) => Cloud.api(table, {method: "POST", body: rows})); }"""

with sync_playwright() as p:
    br = p.chromium.launch()
    # ---------------------------------------------------------------- (a) browser A: choose, confirm, reload, upload
    ctxA = br.new_context(viewport={"width": 1440, "height": 950}); pg = ctxA.new_page(); pg.on("pageerror", lambda e: errors.append("A: " + str(e)))
    E = lambda js, *a: pg.evaluate(js, *a)
    pg.goto("http://localhost:8261/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = E(SETUP, LEDGERS); pg.wait_for_timeout(800)
    app = lambda: pg.inner_text("#app")
    sel = '#app select[aria-label="Tally ledger for this bank account"]'
    ok(pg.locator(sel).count() == 1 and "Which Tally ledger is this bank account?" in app(), "a new bank account: which Tally ledger it is, asked")
    ok("Posting waits: this bank account’s Tally ledger is not chosen." in pg.inner_text("#app [data-bank-noledger]"), "posting waits, one line: not chosen")
    pg.select_option(sel, "HDFC BANK"); pg.wait_for_timeout(300)
    ok(E("choiceState(CO(), 'bank:ba1')") == "" and "Not saved yet" in pg.inner_text("#app [data-bank-ledger]"), "picked, not confirmed yet: “Not saved yet”, nothing kept")
    # leaving with the pick unconfirmed asks; Stay keeps the page and the pick
    E("goTab('dash')"); pg.wait_for_timeout(500)
    ok(pg.locator("#confirmBox [data-leave-ask]").is_visible() and "Save your changes?" in pg.inner_text("#confirmBox"), "leaving the page with the pick unconfirmed asks “Save your changes?”")
    pg.click('#confirmBox [data-leave="stay"]'); pg.wait_for_timeout(800)
    ok(E("S.tab") == "bank" and pg.locator(sel).count() == 1 and E("Drafts.picks['bankled:' + S.coId + ':ba1']") == "HDFC BANK", "Stay: back on the bank page, the pick still there")
    pg.click("#app [data-bank-ledger-confirm]"); pg.wait_for_timeout(500)
    ch = E("CO().choices['bank:ba1']")
    ok(ch and ch["value"] == "HDFC BANK" and ch["state"] == "confirmed" and ch["by"] == "this computer" and ch["at"], "Confirm: kept in the client's choices, confirmed, by this computer, with the time (%s)" % ch)
    line = pg.inner_text("#app [data-bank-ledger]").replace("\n", " ")
    ok(pg.locator(sel).count() == 0 and line.startswith("Tally ledger: HDFC BANK · Change"), "the chooser is replaced by one line: '%s'" % line[:60])
    ok(pg.locator("#app [data-bank-noledger]").count() == 0 and E("CO().bankAccounts[0].ledger") == "HDFC BANK", "posting no longer waits; the account's old field kept in step")
    # reload: the line, never “Choose a Tally ledger”, also while the ledger list is not loaded yet
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E("() => { Ledgers.st = {}; }"); E(OPEN_BANK, cid); pg.wait_for_timeout(800)
    E("() => { Ledgers.st = {}; Ledgers.busy[S.coId] = Promise.resolve(); B().ledgers = {list: [], importedAt: ''}; render(); }"); pg.wait_for_timeout(300)
    ok(pg.locator(sel).count() == 0 and pg.inner_text("#app [data-bank-ledger]").startswith("Tally ledger: HDFC BANK") and "Choose a Tally ledger" not in app(),
       "after a reload, with the ledger list still loading: the confirmed line, no chooser")
    ok("no longer in Tally" not in app(), "an empty or loading list never says the ledger is gone")
    # a complete list without it: asked again, saying why
    E("""(leds) => { delete Ledgers.busy[S.coId]; const now = new Date().toISOString(); Ledgers.take(S.coId, {list: leds.filter(l => l[0] !== 'HDFC BANK').map(([name, group]) => ({name, group})), src: 'file', at: now, srcAt: now}); render(); }""", LEDGERS); pg.wait_for_timeout(300)
    ok("HDFC BANK is no longer in Tally. Choose again." in app() and pg.locator(sel).count() == 1, "a complete list without the ledger: “HDFC BANK is no longer in Tally. Choose again.”")
    ok("no longer in Tally" in pg.inner_text("#app [data-bank-noledger]"), "and posting waits, saying so")
    E("""(leds) => { const now = new Date().toISOString(); Ledgers.take(S.coId, {list: leds.map(([name, group]) => ({name, group})), src: 'file', at: now, srcAt: now}); render(); }""", LEDGERS); pg.wait_for_timeout(300)
    ok(pg.inner_text("#app [data-bank-ledger]").startswith("Tally ledger: HDFC BANK"), "back in the list: the line again")
    # a new statement of the same account (its account number not readable): the same account, the ledger kept
    up = E("""async () => { window.charge = async () => true; const csv = "Date,Narration,Withdrawal,Deposit,Balance\\n01/05/2026,NEFT DR OFFICE RENT MAY,25000,,88200\\n03/05/2026,NEFT CR CUSTOMER MAY,,40000,128200\\n";
      const f = new File([csv], "hdfc-may.csv", {type: "text/csv"}); await uploadStatements([f]); render();
      return {stmts: B().stmts.length, accs: CO().bankAccounts.length, acct: curStmt().acctId, msg: Array.from(document.querySelectorAll('.toast, #toast')).map(t => t.innerText).join(' | ')}; }""")
    pg.wait_for_timeout(600)
    ok(up["stmts"] == 2 and up["accs"] == 1 and up["acct"] == "ba1", "a new statement uploaded: the same bank account (%s)" % up)
    ok(pg.locator(sel).count() == 0 and pg.inner_text("#app [data-bank-ledger]").startswith("Tally ledger: HDFC BANK") and "Choose the Tally ledger" not in up["msg"], "and its ledger is kept: no chooser")
    # Change opens the chooser at once (spec K9, round 2: nothing changes until the new one is confirmed), and the change
    # records who and when, with what it was
    pg.click("#app [data-bank-ledger-change]"); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx").count() == 0 and pg.locator(sel).count() == 1, "Change opens the chooser, no question first")
    pg.select_option(sel, "ICICI BANK"); pg.click("#app [data-bank-ledger-confirm]"); pg.wait_for_timeout(400)
    ch = E("CO().choices['bank:ba1']")
    ok(ch["value"] == "ICICI BANK" and ch["prev"]["value"] == "HDFC BANK" and ch["by"] == "this computer", "changed: the new ledger confirmed, the old one kept as prev (%s)" % {k: ch[k] for k in ("value", "prev")})
    pg.click("#app [data-bank-ledger-change]"); pg.wait_for_timeout(200)
    pg.select_option(sel, "HDFC BANK"); pg.click("#app [data-bank-ledger-confirm]"); pg.wait_for_timeout(400)
    # auto-matching never overwrites it: the ledger list changes, the bank account's guess is not applied
    E("() => { ledgersChanged(S.coId); render(); }"); pg.wait_for_timeout(300)
    ok(E("choiceGet(CO(), 'bank:ba1').value") == "HDFC BANK" and E("choiceGuess(CO(), 'bank:ba1', 'ICICI BANK', 'test')") is False, "auto-matching cannot overwrite the confirmed ledger")
    # what this browser sends: the client row (merged into the stand-in server) and the statement records
    E(SERVER, {}); E("() => { S.companies[S.coId].name = S.companies[S.coId].name; }")
    E(PUSH, cid)
    srv_rows = E("window.__srv"); recs = E("""() => cloudSnapshot().filter(r => r.kind === 'bank_stmt' || r.kind === 'bank_rows' || r.kind === 'bank_meta').map(r => ({kind: r.kind, id: r.id, client_id: r.client_id, data: r.data, deleted: false, updated_at: '2026-10-02T09:00:00Z'}))""")
    row = srv_rows[cid]["data"]
    ok(row["choices"]["bank:ba1"]["value"] == "HDFC BANK" and row["choices"]["bank:ba1"]["state"] == "confirmed" and row["bankAccounts"][0]["ledger"] == "HDFC BANK", "the server's client row carries the confirmed choice and the account")
    # ---------------------------------------------------------------- (b) older copies
    older = E("""(cid) => { const o = JSON.parse(JSON.stringify(S.companies[cid])); delete o.choices; delete o.bankAccounts; o.name = 'Testing AAD'; return o; }""", cid)
    E("""async ([cid, old]) => { await cloudApply([{kind: 'client', id: cid, client_id: cid, data: old, deleted: false, updated_at: '2026-10-01T00:00:00Z'}]); render(); }""", [cid, older]); pg.wait_for_timeout(400)
    ok(E("choiceGet(CO(), 'bank:ba1').value") == "HDFC BANK" and E("choiceGet(CO(), 'bank:ba1').state") == "confirmed" and E("(CO().bankAccounts || []).find(a => a.id === 'ba1').ledger") == "HDFC BANK",
       "(b) an older client row applied (no choices, no bank accounts): the confirmed ledger and its account stay")
    ok(pg.inner_text("#app [data-bank-ledger]").startswith("Tally ledger: HDFC BANK"), "(b) and the bank page still shows the line")
    # a guess arriving in a copy never replaces a confirmed choice; a newer confirmed one does
    g = E("""async (cid) => { const o = JSON.parse(JSON.stringify(S.companies[cid])); o.choices['bank:ba1'] = {value: 'ICICI BANK', state: 'guessed', by: 'FinCom', at: '2026-12-01T00:00:00Z'}; o.bankAccounts[0].ledger = 'ICICI BANK';
      await cloudApply([{kind: 'client', id: cid, client_id: cid, data: o, deleted: false, updated_at: '2026-10-03T00:00:00Z'}]); return choiceGet(S.companies[cid], 'bank:ba1').value + '/' + S.companies[cid].bankAccounts[0].ledger; }""", cid)
    ok(g == "HDFC BANK/HDFC BANK", "(b) a later guess in a copy coming in does not replace the confirmed choice (%s)" % g)
    ctxA.close()

    # ---------------------------------------------------------------- (a) browser B: signed in elsewhere, data only from the cloud
    ctxB = br.new_context(viewport={"width": 1440, "height": 950}); pb = ctxB.new_page(); pb.on("pageerror", lambda e: errors.append("B: " + str(e)))
    pb.goto("http://localhost:8261/"); pb.wait_for_timeout(2500); pb.click('button[data-act="useOffline"]'); pb.wait_for_timeout(800)
    EB = lambda js, *a: pb.evaluate(js, *a)
    ok(EB("Object.keys(S.companies).length") == 0, "browser B starts with nothing of the firm")
    EB(SERVER, srv_rows); EB("(recs) => { window.__recs = recs; }", recs)
    EB("""async () => { Cloud.setCfg({lastPull: ''}); await cloudPull(); }"""); pb.wait_for_timeout(500)
    ok(EB("Object.keys(S.companies)") == [cid], "browser B: the client came from the cloud")
    EB(OPEN_BANK, cid); pb.wait_for_timeout(800)
    EB("() => { Ledgers.st = {}; render(); }"); pb.wait_for_timeout(300)
    selB = pb.locator('#app select[aria-label="Tally ledger for this bank account"]')
    ok(selB.count() == 0 and pb.inner_text("#app [data-bank-ledger]").startswith("Tally ledger: HDFC BANK") and "Choose a Tally ledger" not in pb.inner_text("#app"),
       "(a) browser B, before any ledger list: “Tally ledger: HDFC BANK · Change”, no chooser")
    ok(EB("bankLedgerReady(CO(), accountFor(curStmt()))") == "HDFC BANK" and pb.locator("#app [data-bank-noledger]").count() == 0, "(a) browser B: posting may use it")
    # (b) browser B holds an older copy (from before the choice) and pushes a change of its own: the server keeps the choice
    EB("""(cid) => { const o = JSON.parse(JSON.stringify(S.companies[cid])); delete o.choices; o.bankAccounts = [Object.assign({}, o.bankAccounts[0], {ledger: ''})];
      S.companies[cid] = o; return ClientBase.set(cid, JSON.parse(JSON.stringify(o))); }""", cid)
    EB("(cid) => { S.companies[cid].roundOff = 'Round Off A/c'; }", cid)
    EB(PUSH, cid)
    srv2 = EB("window.__srv")[cid]["data"]
    ok(srv2["choices"]["bank:ba1"]["value"] == "HDFC BANK" and srv2["choices"]["bank:ba1"]["state"] == "confirmed" and srv2["roundOff"] == "Round Off A/c",
       "(b) a browser with an older copy pushes through cloudPushClient: its change goes in, the confirmed choice stays")
    ok(EB("choiceGet(S.companies['%s'], 'bank:ba1').value" % cid) == "HDFC BANK" and EB("S.companies['%s'].bankAccounts[0].ledger" % cid) == "HDFC BANK", "(b) and that browser's copy takes it back")
    # no base kept yet (the first save after the change): the server's choice stands too
    EB("""async (cid) => { const o = JSON.parse(JSON.stringify(S.companies[cid])); delete o.choices; o.bankAccounts[0].ledger = ''; S.companies[cid] = o; await BankDB.set('cbase:' + cid, null); ClientBase.seeded.delete(cid); }""", cid)
    EB(PUSH, cid)
    ok(EB("window.__srv")[cid]["data"]["choices"]["bank:ba1"]["value"] == "HDFC BANK", "(b) with no base kept, an older copy does not blank it either")

    # ---------------------------------------------------------------- (c) a guessed choice is not used for posting
    EB("""() => { const co = CO(); co.bankAccounts.push({id: 'ba2', bank: 'ICICI', last4: '9911', ledger: ''}); choiceGuess(co, 'bank:ba2', 'ICICI BANK', 'its name fits');
      const b = B(); b.stmts.push({id: 's9', acctId: 'ba2', bank: 'ICICI', acct: '9911', from: '2026-05-01', to: '2026-05-31', opening: 0, closing: 0});
      b.cur = 's9'; b.rows = [{id: 's9-0', fp: 'q0', date: '2026-05-02', narr: 'NEFT DR OFFICE RENT', debit: 1000, credit: 0, ledger: 'Office Rent', state: 'ready', userSet: true, dec: {name: 'Office Rent'}}];
      const now = new Date().toISOString(); Ledgers.take(S.coId, {list: [['ICICI BANK', 'Bank Accounts'], ['HDFC BANK', 'Bank Accounts'], ['Office Rent', 'Indirect Expenses'], ['Alpha Consultants', 'Sundry Creditors'], ['Professional Charges', 'Indirect Expenses'], ['TDS Payable - Professional', 'Duties & Taxes']].map(([name, group]) => ({name, group})), src: 'file', at: now, srcAt: now}); render(); }""")
    pb.wait_for_timeout(400)
    why = pb.inner_text("#app [data-bank-noledger]")
    ok("guessed, not confirmed" in why and "ICICI BANK" in why, "(c) a guessed bank ledger: posting waits, one line saying why (%s)" % why.strip()[:90])
    ok(pb.locator("#app [data-bank-ledger][data-state=guessed]").count() == 1 and "FinCom’s guess: ICICI BANK" in pb.inner_text("#app [data-bank-ledger]"), "(c) the guess is shown, with Confirm")
    res = EB("""async () => { window.__posted = []; window.ensureTallyCompany = async () => 'GARG SHEKHAR & COMPANY'; window.syncLedgersFromTally = async () => true; window.tallyCall = async () => ({vouchers: []});
      B().ledgers.live = true; B().ledgers.importedAt = new Date().toISOString(); window.__realPost = Bridge.post; Bridge.post = async (pl) => { window.__posted.push(pl); return {ok: true, results: []}; };
      await postBankToTally(); return {posted: window.__posted.length, msg: Array.from(document.querySelectorAll('.toast, #toast')).map(t => t.innerText).join(' | ')}; }""")
    ok(res["posted"] == 0 and "guessed, not confirmed" in res["msg"], "(c) posting the bank lines: nothing sent, the reason said (%s)" % res["msg"][:100])
    # the Tally company found by FinCom (postToBy auto): a guess; posting is refused until it is confirmed
    pt = EB("""async () => { const co = CO(); co.postTo = ''; co.postToBy = ''; if (co.choices) delete co.choices.postTo; choiceGuess(co, 'postTo', 'GARG SHEKHAR & COMPANY', 'the one Tally company linked');
      const why = postToProblem(co, 'GARG SHEKHAR & COMPANY'); Bridge.st = Object.assign({}, Bridge.st, {open: []});
      const e = newEntry('Manual entry'); Object.assign(e.x, {vendorName: 'Alpha Consultants', invoiceNo: 'A/0', invoiceDate: '2026-06-01', taxable: 1000, total: 1000});
      e.natureId = 'none'; e.partyLedger = 'Alpha Consultants'; e.expenseLedger = 'Professional Charges'; e.expenseUserSet = true; D().entries[e.id] = e; approve(e);
      const j = await window.__realPost.call(Bridge, {company: 'GARG SHEKHAR & COMPANY', client: co.id, masters: [], vouchers: [{id: e.id, xml: voucherXml(e, co)}]}).catch(x => ({err: String(x && x.message || x)}));
      return {by: co.postToBy, state: choiceState(co, "postTo"), why, notAllowed: !!(j && j.notAllowed)}; }""")
    ok(pt["by"] == "auto" and pt["state"] == "guessed" and pt["why"].startswith("Confirm the Tally company") and pt["notAllowed"], "(c) postTo found by FinCom: guessed; posting refused with one line (%s)" % pt["why"][:110])
    pt2 = EB("""() => { const co = CO(); autoPostTo(co, true); choiceConfirm(co, 'postTo', 'GARG SHEKHAR & COMPANY'); const a = postToProblem(co, 'GARG SHEKHAR & COMPANY'); co.postTo = ''; co.postToBy = 'auto';
      const kept = choiceGet(co, 'postTo'); fixCompany(co); return {a, kept: kept.value + '/' + kept.state, back: co.postTo}; }""")
    ok(pt2["a"] == "" and pt2["kept"] == "GARG SHEKHAR & COMPANY/confirmed" and pt2["back"] == "GARG SHEKHAR & COMPANY", "(c) once confirmed it is used; a stray write of the old field does not undo it (%s)" % pt2)
    # a bill whose TDS ledger comes from Client setup, where it is only guessed: posting waits, one line
    bill = EB("""async () => { const co = CO(); S.tab = 'export'; co.tdsLedgers.professional = 'TDS Payable - Professional'; if (co.choices) delete co.choices['tds:professional'];
      const e = newEntry('Manual entry'); Object.assign(e.x, {vendorName: 'Alpha Consultants', invoiceNo: 'A/1', invoiceDate: '2026-07-01', taxable: 100000, total: 100000});
      e.natureId = 'professional'; e.partyLedger = 'Alpha Consultants'; e.expenseLedger = 'Professional Charges'; e.expenseUserSet = true; D().entries[e.id] = e; approve(e);
      const tl = (e.snapshot.lines || []).find(l => l.role === 'tds') || {};
      window.__posted = []; window.loadBank = async () => {}; Bridge.post = async (pl) => { window.__posted.push(pl); return {ok: true, results: []}; };
      await postBillsToTally({ids: [e.id]}); return {status: e.status, ck: tl.ck, why: tl.why, posted: window.__posted.length, stop: (S.postStop || {}).msg || ''}; }""")
    ok(bill["status"] == "approved" and bill["ck"] == "tds:professional" and bill["posted"] == 0 and bill["stop"].startswith("Posting waits: the TDS ledger “TDS Payable - Professional” comes from Client setup"),
       "(c) a bill whose TDS ledger is a Client setup guess: approved, not sent, one line (%s)" % bill["stop"][:110])
    EB("() => { goStep('post', 'bills'); }"); pb.wait_for_timeout(600)
    ok(pb.locator("#app [data-not-allowed][data-guessed]").count() == 1 and "a ledger is not confirmed" in pb.inner_text("#app [data-not-allowed]"), "(c) the Post page says why, in one line, with the way to Client setup")
    ctxB.close()

    # ---------------------------------------------------------------- (d) the shared footer on every settings page, and leaving asks
    import gstfix
    books, gst = gstfix.load()
    ctxC = br.new_context(viewport={"width": 1440, "height": 950}); pc = ctxC.new_page(); pc.on("pageerror", lambda e: errors.append("C: " + str(e)))
    pc.goto("http://localhost:8261/"); pc.wait_for_timeout(2500); pc.click('button[data-act="useOffline"]'); pc.wait_for_timeout(800)
    EC = lambda js, *a: pc.evaluate(js, *a)
    foot = lambda: pc.locator("#app [data-confirm-foot]")
    EC("navHome('rules')"); pc.wait_for_timeout(400)
    for tab in ["firm", "account", "plan", "bridge", "tcloud", "postlog", "gstapi", "rates", "reading", "ai"]:
        EC("(t) => { S.settingsTab = t; render(); }", tab); pc.wait_for_timeout(250)
        ok(foot().count() == 1 and pc.locator("#app .setsaved").count() == 0, "Settings → %s: the shared footer (and no “saved as you make them”)" % tab)
    cidC = EC(gstfix.SETUP, [books, gst]); pc.wait_for_timeout(1200); EC("S.books = window.__bk; render()"); pc.wait_for_timeout(400)
    for tab in ["settings", "cotally", "cotds", "deductees", "gstset", "bankset", "bankrules", "coclosed"]:
        EC("(t) => { S.tab = t; render(); }", tab); pc.wait_for_timeout(700 if tab in ("gstset", "bankset", "bankrules") else 300)
        ok(foot().count() >= 1, "Client setup → %s: the shared footer" % tab)
    EC("() => { S.tab = 'books'; S.booksTab = 'ledgers'; render(); }"); pc.wait_for_timeout(800)
    # 2.4.1 (the owner's decision, Cause B): the Tally ledgers page has no footer and no drafts; each step is saved at once
    ok(pc.locator('#app [data-ledpage]').count() == 1 and pc.locator('#app [data-confirm-foot="books:ledgers"]').count() == 0, "Tally ledgers: no Save footer (each step saved at once)")
    EC("() => { S.tab = 'books'; S.booksTab = 'fs'; S.fsTab = 'map'; render(); }"); pc.wait_for_timeout(2500)
    ok(pc.locator('#app [data-confirm-foot="books:fs-map"]').count() == 1, "Accounts → Mapping: the shared footer")
    EC("() => { S.booksTab = 'mis'; render(); }"); pc.wait_for_timeout(1500)
    EC("document.querySelectorAll('#app details').forEach(d => d.open = true)"); pc.wait_for_timeout(200)
    ok(pc.locator('#app [data-confirm-foot="books:mis-settings"]').count() == 1, "MIS settings: the shared footer")
    EC("() => { S.booksTab = 'audit'; S.auditTab = 'find'; render(); }"); pc.wait_for_timeout(1500)
    EC("document.querySelectorAll('#app details').forEach(d => d.open = true)"); pc.wait_for_timeout(200)
    ok(pc.locator('#app [data-confirm-foot="books:audit-settings"]').count() == 1, "Audit settings: the shared footer")
    # GST settings (in Client setup → GST): a change is a draft; leaving asks; Don't save puts it back
    EC("() => { S.tab = 'gstset'; render(); }"); pc.wait_for_timeout(1200)
    before = EC("(S.books.gstEst ? 'on' : 'off')")
    pc.click('#app input[aria-label="Show FinCom’s estimate"]'); pc.wait_for_timeout(300)
    ok("Not saved yet" in pc.inner_text('#app [data-confirm-foot="setup:gstset"]'), "GST settings: a tick is “Not saved yet”")
    held = EC("Drafts.hold('books:' + S.coId)")
    ok(held is True, "and the books' saving waits for Save")
    EC("goTab('cotally')"); pc.wait_for_timeout(500)
    ok(pc.locator("#confirmBox [data-leave-ask]").is_visible() and "GST" in pc.inner_text("#confirmBox"), "leaving GST settings with a change asks, naming the section")
    pc.click('#confirmBox [data-leave="drop"]'); pc.wait_for_timeout(500)
    ok(EC("(S.books.gstEst ? 'on' : 'off')") == before and EC("S.tab") == "cotally", "Don't save: the tick is put back, and the page changes")
    # Tally: GST ledgers guessed by auto-matching show “guessed, confirm”; Save confirms what was typed
    EC("() => { const co = CO(); choiceGuess(co, 'gst:cgst', 'INPUT CGST', 'matched in Tally'); render(); }"); pc.wait_for_timeout(300)
    ok(pc.locator('#app [data-choice="gst:cgst"][data-choice-state="guessed"]').count() == 1, "a guessed GST ledger is shown as “guessed, confirm”")
    pc.click('#app [data-choice-confirm="gst:cgst"]'); pc.wait_for_timeout(300)
    ok(EC("choiceState(CO(), 'gst:cgst')") == "confirmed" and EC("!!CO().gstPin.cgst") and pc.locator('#app [data-choice="gst:cgst"][data-choice-state="confirmed"]').count() == 1, "Confirm beside it: confirmed (and pinned for every bill)")
    ok(EC("choiceGuess(CO(), 'gst:cgst', 'INPUT IGST', 'x')") is False and EC("CO().gst.cgst") == "INPUT CGST", "auto-matching cannot change it now")
    box = pc.locator('#app label:has-text("Input SGST") input'); box.fill("Input SGST 9%"); pc.wait_for_timeout(200)
    ok("Not saved yet" in pc.inner_text('#app [data-confirm-foot="setup:cotally"]') and EC("Drafts.hold('client:' + S.coId)") is True, "typing a GST ledger: a draft; the client's saving waits")
    snap = EC("cloudSnapshot().find(r => r.kind === 'client').data.gst.sgst")
    ok(snap != "Input SGST 9%", "and the cloud is sent the saved value, not the draft (%s)" % snap)
    ok(EC("(() => { const e = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(e); return e.defaultPrevented; })()") is True, "closing the tab with unsaved changes asks too (beforeunload)")
    EC("goTab('cotds')"); pc.wait_for_timeout(500)
    pc.click('#confirmBox [data-leave="save"]'); pc.wait_for_timeout(500)
    rec = EC("(CO().saved || {})['setup:cotally']")
    ok(EC("S.tab") == "cotds" and EC("CO().gst.sgst") == "Input SGST 9%" and EC("choiceState(CO(), 'gst:sgst')") == "confirmed" and rec and rec["by"] == "this computer", "Save in the question: saved, confirmed, with who and when (%s)" % rec)
    EC("goTab('cotally')"); pc.wait_for_timeout(400)
    ok(pc.inner_text('#app [data-confirm-foot="setup:cotally"]').startswith("Saved · "), "the footer then says “Saved · <time> · this computer”")
    ctxC.close()
    ok(not errors, "no page errors %s" % errors[:3])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
