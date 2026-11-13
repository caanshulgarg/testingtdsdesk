"""python3 run_undo_posted.py - item 5 of the state-machine review (owner-approved): Undo, delete/restore and the bulk
buttons never bring an entry that is posted to Tally (or found in Tally) back to an earlier state, so it cannot be posted
twice. Made-up client, lines, invoices and bills. Checked, for each kind:
  bank lines   - accepted, then posted (the bridge, or the XML file), then Undo: still posted, with its Tally voucher, and
                 the words "1 line is already in Tally and was left as it is."; bulk Confirm / Ignore / Restore on a mixed
                 selection touch only the lines they may (never sent, in Tally; Confirm never an ignored line, nor a
                 ledger that is not in Tally); one line's buttons refuse a line in Tally; the un-post paths (Take back
                 from Tally, posted again after it went from Tally, Undo of an automatic entry) leave the same fields;
                 Undo of a queued automatic entry whose posting can no longer be cancelled leaves it as it is
  sales        - confirmed, then posted, then Undo: still posted; bulk Confirm / Ignore / Delete skip posted, In Tally (and
                 Confirm ignored); the row buttons refuse posted / In Tally invoices
  purchase     - a posted bill deleted and restored comes back approved, still posted, on its supplier's totals; unapply
                 refuses a posted bill; No entry refuses a posted bill and removes the cloud document only after the
                 Undo has passed; the un-post paths (Take back, Post again, Not in Tally) leave the same fields; the bar
                 says what tallyStateOf says (In Tally / In Tally, not confirmed / Not in Tally any more); a bill whose
                 posting is still being checked or sent cannot be undone; Undo of a queued automatic entry reads the
                 posting's status when the cancel is refused (cancelled: undone; taken: left)
  Deleted in Tally - reads only say "still there" (the words name the reads that failed and those that found nothing); the
                 owner's "I checked in Tally: not there" goes to tally_post_owner_release(p_job, p_id, p_why) (migration
                 174; without it the server's words, kept under Post to Tally > Errors); a member's ask on a bill posted
                 through the bridge only is settled by the owner without the cloud, or dismissed
  queued here    - a posting this page queued (postMarkNew), marked, then taken back / undone automatically / deleted in
                 Tally: that posting is old, never marked again; a Retry of it is refused
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_undo_posted.py"""
import os, threading, functools, http.server, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8374), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

BANK = r"""async () => {
  const G = "ZZ Undo Traders", BK = "Undo Bank", PARTY = "Sundry Receipts";
  const c = newCompany({name: G, gstin: "09AAKFG1234C1Z5"}); c.tallyName = G; c.bankAccounts = [{id: "a1", bank: "Undo Bank", acct: "1111", ledger: BK}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const row = (id, o) => Object.assign({id, fp: "fp-" + id, date: "2026-01-05", debit: 0, credit: 500, narr: "NEFT CR " + id, dec: {name: "CUST " + id, mode: "NEFT"}, ledger: PARTY, state: "suggested", balOk: true, userSet: false}, o || {});
  const posted = (id) => row(id, {state: "sent", sentAt: "2026-01-06T10:00:00Z", postedVia: "bridge", postVerified: true, postByReply: false, checking: false, tallyRef: "R-" + id, tallyHow: "posted",
    tally: {guid: "g-" + id, masterId: "77", vchType: "Receipt", vchDate: "20260105", at: "2026-01-06T10:00:00Z", by: "me", company: G}});
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Undo Bank", acct: "1111", from: "2026-01-01", to: "2026-01-31"}], cur: "s1",
    rows: [row("u1"), row("u2"), row("u3", {state: "attention", ledger: ""}),
      row("m1"), row("m2", {state: "ignored", prevState: "suggested"}), posted("m3"), row("m4", {state: "intally", tallyIdx: 3}),
      row("n1", {date: "2026-01-20", credit: 777, state: "intally", prevState: "suggested", tallyIdx: 0, tallyKey: "tg-1", tallyHow: "same amount and date", tallyRef: "Receipt · 11"}),
      row("o1", {date: "2026-01-22", credit: 888, state: "intally", tallyHow: "posted by FinCom earlier"}),
      row("o3", {date: "2026-01-26", credit: 555, state: "intally", tallyIdx: 2, tallyKey: "tg-o3", tallyHow: "same amount and date"}),
      row("o2", {date: "2026-01-23", credit: 999, state: "intally", tallyHow: "posted by FinCom on 23-Jan-2026"}), row("c1", {date: "2026-01-25", credit: 333, state: "ready"}), row("f1", {date: "2026-01-24", credit: 444, state: "intally", prevState: "ready", tallyKey: "tg-9", tallyHow: "found in Tally when reconciling", tallyRef: "Receipt · 31"}), row("m5", {state: "attention", ledger: ""}), row("m6", {ledger: "Not A Ledger"}),
      posted("p1"), posted("p2"), posted("p3"), posted("p4")],
    rules: [], wrules: [], ledgers: {list: [{name: BK, group: "Bank Accounts"}, {name: PARTY, group: "Sundry Debtors"}], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {},
    filter: "all", grouped: false, showSettings: false, q: "", limit: 500, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  S.bank.books.a1 = {entries: [{date: "2026-01-20", debit: 777, credit: 0, party: "Cust n1", vt: "Receipt", vn: "11", narr: "", inst: "", guid: "tg-1"},
    {date: "2026-01-21", debit: 777, credit: 0, party: "Cust n1", vt: "Receipt", vn: "12", narr: "", inst: "", guid: "tg-2"},
    {date: "2026-01-26", debit: 555, credit: 0, party: "Cust o3", vt: "Receipt", vn: "13", narr: "TDSDesk:" + fpHash("fp-o3").toUpperCase(), inst: "", guid: "tg-o3"}], importedAt: new Date().toISOString()};
  window.__audit = []; const a0 = window.auditEvent; window.auditEvent = (k, t, c) => { window.__audit.push(k + ": " + t); return a0 && a0(k, t, c); };
  S.bank.postedTags[fpHash("fp-o2")] = "2026-01-23T10:00:00Z"; S.bank.postedTags[fpHash("fp-f1")] = "tally:2026-01-24T10:00:00Z";
  ["p1", "p2", "p3", "p4", "m3"].forEach(id => { S.bank.postedTags[fpHash("fp-" + id)] = "2026-01-06T10:00:00Z"; });
  window.ensureTallyCompany = async () => G; window.syncLedgersFromTally = async () => true; window.syncBankBookFromTally = async () => true; window.checkBankBalance = async () => null;
  window.__toasts = []; const t0 = window.toast; window.toast = (m, o) => { window.__toasts.push(String(m)); return t0 && t0(m, o); };
  return c.id;
}"""
R = "(id) => { const r = B().rows.find(x => x.id === id); return r && {state: r.state, guid: r.tally && r.tally.guid, ledger: r.ledger, tallyIdx: r.tallyIdx}; }"
FIELDS = "['sentAt', 'postVerified', 'postByReply', 'tally', 'postedVia', 'tallyRef', 'tallyHow', 'goneFromTally', 'checking', 'postError', 'tallyIdx']"

SALES = r"""() => {
  const cid = S.coId;
  const iv = (id, st) => ({id, status: st, source: "upload", fileName: id + ".pdf", x: {number: "S/" + id, date: "2026-07-01", customerName: "Alpha Retail", customerGstin: "", pos: "09", taxable: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0, total: 1180, items: []},
    customerLedger: "Alpha Retail", problems: [], ledgerIssues: []});
  const n2 = Object.assign(iv("n2", "intally"), {postNote: "Already in Tally", tallyMatch: {key: "sv-1", date: "2026-07-01", number: "S/n2", amount: 1180}});
  S.sales = {cid, loading: false, list: [n2, iv("v1", "review"), iv("m1", "review"), iv("m2", "ignored"), iv("m3", "intally"), iv("m4", "posted")], cfg: Object.assign({}, SALES_CFG_DEFAULT),
    filter: "all", q: "", sel: new Set(), sticky: new Set(), busy: "", openId: null, view: "list", draft: null, undo: null, hist: {}};
  window.__mi0 = window.__mi0 || window.mapInvoice; window.mapInvoice = (v) => { v.problems = v.problems || []; v.ledgerIssues = v.ledgerIssues || []; };
  return 1;
}"""
SV = "(id) => (SL().list.find(v => v.id === id) || {}).status || 'gone'"

BILLS = r"""async () => {
  const c = newCompany({name: "ZZ Bill Undo Co", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  await openCompany(c.id);
  const mk = (id, n, no, post) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: 1000, total: 1000});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e;
    if (post){ approve(e, {bulk: true}); Object.assign(e, {exportedAt: "2026-10-01T10:00:00Z", postedVia: "bridge", postedInto: "ZZ", postVerified: post === "verified", postByReply: false, tallyVchNo: "4521", postNote: "n", postError: "",
      tally: {at: "2026-10-01T10:00:00Z", guid: "g-" + id, vchType: "Purchase", vchDate: "20260701", company: "ZZ"}}); }
    return e; };
  mk("b1", "Posted Supplier", "B/1", "verified"); mk("b2", "Second Supplier", "B/2", "verified"); mk("b3", "Draft Supplier", "B/3", null); mk("b5", "Posted Five", "B/5", "verified");
  mk("u1", "Unpost One", "U/1", "verified"); mk("u2", "Unpost Two", "U/2", "verified"); mk("u3", "Unpost Three", "U/3", "verified"); mk("s1", "Sent Only", "S/1", "sent");
  mk("b6", "Being Checked", "B/6", null); approve(S.data[c.id].entries.b6, {bulk: true}); S.data[c.id].entries.b6.postUnconfirmed = {at: "2026-10-01T10:00:00Z", company: "ZZ"};
  mk("q1", "Still Sending", "Q/1", null); approve(S.data[c.id].entries.q1, {bulk: true});
  ["k1", "k2", "k3", "k4", "h1", "l1", "l2", "c6", "c7", "c8", "c9", "j1", "j2"].forEach((id, i) => mk(id, "Path Supplier " + id, "K/" + i, "verified"));
  mk("k5", "Control Supplier", "K/9", null); approve(S.data[c.id].entries.k5, {bulk: true});
  mk("g1", "Gone Supplier", "G/1", "verified"); S.data[c.id].entries.g1.goneFromTally = "2026-10-05T10:00:00Z";
  S.data[c.id].entries.b3.docPath = c.id + "/b3-doc.pdf";
  window.__removed = []; CloudDocs.remove = async (p) => { window.__removed.push(p); };
  window.__toasts = []; const t0 = window.toast; window.toast = (m, o) => { window.__toasts.push(String(m)); return t0 && t0(m, o); };
  refreshStats(c.id); goStep("review", "bills"); render();
  return c.id;
}"""
BF = "['exportedAt', 'postVerified', 'postByReply', 'tally', 'tallyVchNo', 'postNote', 'tallyCheck', 'postUnconfirmed', 'postError', 'postCheckFailed', 'goneFromTally', 'postedVia', 'postedInto', 'postAltered', 'postedOptional']"

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8374/"); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    def E(js, *a):
        try: return pg.evaluate(js, *a)
        except Exception as ex:
            ok(False, "the page threw: %s" % str(ex).split("\n")[0][:200]); return None
    W = pg.wait_for_timeout
    last = lambda: E("window.__toasts.length ? window.__toasts[window.__toasts.length - 1] : ''")

    print("== bank lines")
    cid = E(BANK); W(300)
    E("() => { bankRowAct('accept', 'u1'); }"); W(100)
    ok(E(R, "u1")["state"] == "ready" and E("!!B().undo"), "a line confirmed: ready, Undo offered")
    E("(cid) => { const r = B().rows.find(x => x.id === 'u1'); bankPosted(cid, r, {ok: true, verified: true, guid: 'g-u1', vchType: 'Receipt', vchDate: '20260105'}, 'ZZ Undo Traders', new Date().toISOString(), {quiet: true}); }", cid)
    E("() => { window.__toasts = []; undoBank(); render(); }"); W(400)
    r = E(R, "u1")
    ok(r["state"] == "sent" and r["guid"] == "g-u1", "posted through the bridge, then Undo: still posted, with its Tally voucher (%s)" % r)
    ok("1 line is already in Tally and was left as it is." in last(), "the words: %r" % last())
    E("() => { window.__toasts = []; bankRowAct('restore', 'u1'); }"); W(400)
    ok(last() == "This line is already in Tally, so it was left as it is. To post it again, press “Take it back” on the line first.", "one line's button on a posted line names the next step: %r" % last())
    E("() => { window.__toasts = []; bankRowAct('restore', 'f1'); }"); W(300)
    ok(last() == "This line is already in Tally, so it was left as it is. If it was matched to the wrong Tally entry, press “Not this Tally entry” on the line.", "on a line found in Tally: %r" % last())
    # the XML file marks the line sent the same way (exportBankXml)
    E("() => { bankRowAct('accept', 'u2'); const r = B().rows.find(x => x.id === 'u2'); r.state = 'sent'; r.sentAt = new Date().toISOString(); window.__toasts = []; undoBank(); }")
    ok(E(R, "u2")["state"] == "sent", "saved in an XML file for Tally, then Undo: still sent")
    # the undo of Set on every line showing (applyToVisible: rows, not snaps)
    E("() => { const r = B().rows.find(x => x.id === 'u3'); B().undo = {what: 'Set X on 1 entries', rows: [{id: 'u3', ledger: '', state: 'attention', userSet: false}]}; r.ledger = 'Sundry Receipts'; r.state = 'sent'; window.__toasts = []; undoBank(); }")
    ok(E(R, "u3")["state"] == "sent" and E(R, "u3")["ledger"] == "Sundry Receipts", "the undo of a ledger set on every line showing: a line since posted stays posted (%s)" % E(R, "u3"))

    E("() => { const b = B(); b.sel = new Set(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']); bulkAction('accept'); }"); W(100)
    st = {k: E(R, k)["state"] for k in ["m1", "m2", "m3", "m4", "m5", "m6"]}
    ok(st == {"m1": "ready", "m2": "ignored", "m3": "sent", "m4": "intally", "m5": "attention", "m6": "suggested"}, "bulk Confirm on a mixed selection: only the suggested line with a Tally ledger is confirmed (%s)" % st)
    E("() => { B().sel = new Set(['m3', 'm4', 'm5']); bulkAction('ignore'); }"); W(100)
    st = {k: E(R, k)["state"] for k in ["m3", "m4", "m5"]}
    ok(st == {"m3": "sent", "m4": "intally", "m5": "ignored"}, "bulk Ignore: the posted line and the line in Tally are left (%s)" % st)
    E("() => { B().sel = new Set(['m2', 'm4']); bulkAction('restore'); }"); W(100)
    ok(E(R, "m2")["state"] == "ready" and E(R, "m4")["state"] == "intally" and E(R, "m4")["tallyIdx"] == 3, "bulk Restore: the ignored line comes back, the line in Tally stays matched (%s, %s)" % (E(R, "m2"), E(R, "m4")))
    E("() => { B().undo = null; ['restore', 'ignore', 'accept', 'unready'].forEach(a => { bankRowAct(a, 'm4'); bankRowAct(a, 'm3'); }); }"); W(100)
    ok(E(R, "m4")["state"] == "intally" and E(R, "m3")["state"] == "sent" and E("B().undo") is None, "one line's Restore / Ignore / Confirm / Undo refuse a line in Tally or posted, with no Undo made (%s, %s)" % (E(R, "m4"), E(R, "m3")))

    # Not this Tally entry: a wrong match, remembered for the line
    box = lambda: pg.inner_text("#confirmBox").replace("\n", " ") if pg.locator("#confirmBox .cbx").count() else ""
    E("() => { window.__toasts = []; bankRowAct('nottally', 'o1'); }"); W(300)
    ok(not box() and E(R, "o1")["state"] == "intally", "never offered on a line FinCom posted (%r)" % last())
    S0 = "() => { B().postedTags[fpHash('fp-o3')] = 'tally:2026-01-26T10:00:00Z'; bankRowAct('nottally', 'o3'); }"
    E(S0); W(300)
    ok(not box() and E(R, "o3")["state"] == "intally", "nor on FinCom's own posting found again (tally: tag, its entry carries the line's TDSDesk tag)")
    E("() => { bankRowAct('nottally', 'o2'); }"); W(300)
    ok(not box() and E(R, "o2")["state"] == "intally", "nor on one whose tag says FinCom posted it")
    E("() => bankRowAct('nottally', 'f1')"); W(400)
    ok("Mark it as NOT that entry?" in box(), "offered on a line only found in Tally (its tag says tally:) (%r)" % box()[:120])
    pg.click('#confirmBox [data-cbx="yes"]'); W(400)
    ok(E(R, "f1")["state"] == "attention" and not E("!!B().postedTags[fpHash('fp-f1')]"), "the found-in-Tally tag is dropped with the match (%s)" % E(R, "f1"))
    E("() => bankRowAct('nottally', 'n1')"); W(400)
    ok("This bank line was matched to Tally entry" in box() and "Mark it as NOT that entry?" in box() and "777" in box() and "posting will put it in Tally twice" in box(), "Not this Tally entry asks first, naming the entry (%r)" % box()[:200])
    pg.click('#confirmBox [data-cbx="yes"]'); W(400)
    n1 = E("(() => { const r = B().rows.find(x => x.id === 'n1'); return {state: r.state, not: r.notTally, idx: r.tallyIdx === undefined ? null : r.tallyIdx, user: !!r.userSet}; })()")
    st0 = E("""async () => { const ap = await loadAutoPost(); const r = B().rows.find(x => x.id === 'n1'); const r2 = Object.assign({}, r, {prevState: undefined, userSet: false}); return ap.bankCheck(r2, {cfg: Object.assign({}, ap.DEF, {on: true}), idx: new Map(), env: {partyKey: () => '', exactLedger: (n) => n, ledgerInfo: () => null}}).stops.join('; '); }""")
    ok("not the Tally entry" in (st0 or ""), "Post automatically never takes a line marked not that entry (%r)" % st0)
    E("() => { suggestAll(B().rows.filter(x => x.id === 'n1')); }")
    ok(E(R, "n1")["state"] in ("attention", "suggested"), "suggestions afterwards never make it ready (%s)" % E(R, "n1"))
    E("() => { const r = B().rows.find(x => x.id === 'n1'); r.state = 'attention'; }")
    ok(n1["state"] == "attention" and not n1["user"] and "tg-1" in (n1["not"] or []) and n1["idx"] is None and any("n1" in a or "777" in a for a in E("window.__audit")), "marked not that entry: to attention (a person decides), not set by a person, the entry remembered on the line, audited (%s)" % n1)
    E("() => { const b = B(); matchTallyBook((CO(b.cid).bankAccounts || [])[0], b.rows, true); }")
    n1 = E("(() => { const r = B().rows.find(x => x.id === 'n1'); return {state: r.state, key: r.tallyKey}; })()")
    ok(n1["state"] == "intally" and n1["key"] == "tg-2", "a fresh read of Tally: matched to the other entry, never the excluded one (%s)" % n1)
    E("() => bankRowAct('nottally', 'n1')"); W(400); pg.click('#confirmBox [data-cbx="yes"]'); W(400)
    E("() => { const b = B(); matchTallyBook((CO(b.cid).bankAccounts || [])[0], b.rows, true); matchTallyBook((CO(b.cid).bankAccounts || [])[0], b.rows, false); }")
    rr = E("""() => { const b = B(), acc = (CO(b.cid).bankAccounts || [])[0]; const r = {id: 'n1b', fp: 'fp-n1', date: '2026-01-20', debit: 0, credit: 777, narr: 'NEFT CR n1', dec: {name: 'CUST n1', mode: 'NEFT'}, ledger: 'Sundry Receipts', state: 'suggested', balOk: true};
      matchTallyBook(acc, [r], true); return {state: r.state, nt: (r.notTally || []).length}; }""")
    ok(rr and rr["state"] == "suggested" and rr["nt"] >= 2, "the statement read again: the line keeps its excluded entries, not matched (%s)" % rr)
    ok(E(R, "n1")["state"] == "attention" and E("B().rows.find(x => x.id === 'n1').notTally.includes('tg-2')"), "both excluded: the line stays open through every read (%s)" % E(R, "n1"))
    # reconciling pairs a line with a Tally entry by amount and date: never with one excluded for it
    E("""async () => { const b = B(); b.rows.find(x => x.id === 'n1').ledger = 'Sundry Receipts'; window.tallyBankBalance = async () => ({});
      const c0 = Bridge.call; Bridge.call = async (u, ...a) => /^\/(ledgerlines|vouchers)/i.test(u) ? {vouchers: [{guid: 'tg-1', type: 'Receipt', number: '11', date: '20260120', entries: [{ledger: 'Undo Bank', amount: '-777'}, {ledger: 'Cust n1', amount: '777'}]},
        {guid: 'tg-c', type: 'Receipt', number: '15', date: '20260125', entries: [{ledger: 'Undo Bank', amount: '-333'}, {ledger: 'Cust c1', amount: '333'}]}]} : {};
      try { window.__rec = await reconcileBank({stay: true}); } catch (e){ window.__recErr = String(e && e.message || e); } Bridge.call = c0; }"""); W(300)
    E("""async () => { const b = B(), r = b.rows.find(x => x.id === 'c1'); r.state = 'ready'; delete r.tallyKey; r.notTally = ['2026-01-25|Receipt|15|333|0'];
      const c0 = Bridge.call; Bridge.call = async (u, ...a) => /^\\/(ledgerlines|vouchers)/i.test(u) ? {vouchers: [{guid: 'tg-c', type: 'Receipt', number: '15', date: '20260125', entries: [{ledger: 'Undo Bank', amount: '-333'}, {ledger: 'Cust c1', amount: '333'}]}]} : {};
      try { await reconcileBank({stay: true}); } catch (e){} Bridge.call = c0; }"""); W(300)
    ok(E(R, "c1")["state"] == "ready", "an entry excluded from a file-imported book (no GUID) is not paired by the bridge's read either (%s)" % E(R, "c1"))
    ok(E(R, "n1")["state"] != "intally", "reconcile: an excluded Tally entry is not paired with the line (%s)" % E(R, "n1"))
    # the un-post paths: Take back from Tally (unpost), posted again after it went from Tally (bankRepostGone), Undo of an automatic entry
    E("() => { window.unpostFromTally = async () => true; bankRowAct('unpost', 'p1'); }"); W(300)
    E("() => { B().rows.find(x => x.id === 'p2').goneFromTally = '2026-02-01T00:00:00Z'; bankRepostGone(); }"); W(200)
    E("() => { B().gone = {ids: ['p4']}; goneBack(); }"); W(200)
    E("""async () => { const r = B().rows.find(x => x.id === 'p3'); r.auto = {run: 'run1', key: 'k', dir: 'in', label: 'CUST p3', amt: 500, cid: ''}; r.autoPrev = {state: 'suggested', ledger: 'Sundry Receipts'};
      window.bridgeLive = () => true; const c0 = Bridge.call; Bridge.call = async (p, ...a) => p === '/unpost' ? {ok: true} : c0.call(Bridge, p, ...a);
      const ap = await loadAutoPost(); window.__ap = await ap.undo(S.coId, r, {noAsk: true}); Bridge.call = c0; }"""); W(300)
    f = E("(F) => ['p1', 'p2', 'p3', 'p4'].map(id => { const r = B().rows.find(x => x.id === id); const o = {}; F.forEach(k => { o[k] = r[k] === undefined ? null : r[k]; }); o.tag = !!B().postedTags[fpHash(r.fp)]; o.state = r.state; return o; })", json.loads(FIELDS.replace("'", '"')))
    same = lambda a, b: {k: v for k, v in a.items() if k != "state"} == {k: v for k, v in b.items() if k != "state"}
    ok(f[0]["state"] == "ready" and f[1]["state"] == "ready" and f[2]["state"] == "suggested" and same(f[0], f[1]) and same(f[0], f[2]) and f[3]["state"] == "ready" and same(f[0], f[3]) and f[0]["tally"] is None and not f[0]["tag"] and f[0]["postedVia"] == "bridge",
       "the four un-post paths (Take back, gone from Tally, back to Post to Tally, automatic undo) leave the same posting fields, cleared (postedVia kept, so an old cloud result is not marked again) (%s)" % f)
    # H2: a posting this page queued (postMarkNew), marked posted from its result, then taken back: never marked again by it
    E("""(cid) => { postMarkNew(cid, ['c1'], 'job-b1'); const t = new Date().toISOString();
      CloudJobs.list = [{id: 'job-b1', client_id: cid, status: 'done', created_at: t, updated_at: t, entry_ids: ['c1'], results: [{id: 'c1', ok: true, verified: true, guid: 'g-c1', vchType: 'Receipt', vchDate: '20260125'}]}]; postReconcile(cid, true); }""", cid)
    ok(E(R, "c1")["state"] == "sent", "queued here: marked posted from the cloud's result (%s)" % E(R, "c1"))
    E("() => { window.unpostFromTally = async () => true; bankRowAct('unpost', 'c1'); }"); W(300)
    E("(cid) => postReconcile(cid, true)", cid)
    ok(E(R, "c1")["state"] == "ready" and not E("B().rows.find(x => x.id === 'c1').postJobNew"), "queued here, then Take it back: that posting is old, the line stays ready (%s)" % E(R, "c1"))
    E("() => { CloudJobs.list = null; }")
    # Undo of a queued automatic entry whose posting the Tally computer has already taken
    E("""async () => { const r = B().rows.find(x => x.id === 'm1'); r.state = 'ready'; r.auto = {run: 'run2', job: '00000000-0000-0000-0000-000000000009', key: 'k2', dir: 'in', label: 'CUST m1', amt: 500, cid: ''};
      TCloud.rpc = async (fn) => fn === 'tally_post_cancel' ? {ok: false} : {ok: true}; CloudPost.row = async () => ({id: 'j', status: 'taken', results: []});
      const ap = await loadAutoPost(); window.__ap2 = await ap.undo(S.coId, r, {}); }"""); W(300)
    a2 = E("window.__ap2")
    ok(E(R, "m1")["state"] == "ready" and E("!!B().rows.find(x => x.id === 'm1').auto") and a2 and a2.get("ok") is False and "may already be in Tally" in (a2.get("why") or ""),
       "Undo of a queued entry the Tally computer has taken: left as it is, 'may already be in Tally' (%s)" % a2)
    E("""async () => { const r = B().rows.find(x => x.id === 'm1'); r.auto.job = '00000000-0000-0000-0000-000000000010'; CloudPost.row = async () => ({id: 'j', status: 'cancelled', results: []});
      const ap = await loadAutoPost(); window.__ap3 = await ap.undo(S.coId, r, {}); }"""); W(300)
    a3 = E("window.__ap3")
    ok(a3 and a3.get("ok") is True and E(R, "m1")["state"] in ("suggested", "attention"), "the cancel refused but the posting already cancelled: undone (%s)" % a3)

    print("== sales invoices")
    E(SALES)
    E("() => { salesRowAct('confirm', 'v1'); const v = SL().list.find(x => x.id === 'v1'); v.status = 'posted'; v.postedAt = new Date().toISOString(); v.postedVia = 'bridge'; window.__toasts = []; salesUndo(); }"); W(400)
    ok(E(SV, "v1") == "posted", "confirmed, then posted, then Undo: still posted (%s)" % E(SV, "v1"))
    ok("1 invoice is already in Tally and was left as it is." in last(), "the words: %r" % last())
    E("() => { SL().sel = new Set(['m1', 'm2', 'm3', 'm4']); salesBulk('confirm'); }"); W(100)
    st = {k: E(SV, k) for k in ["m1", "m2", "m3", "m4"]}
    ok(st == {"m1": "ready", "m2": "ignored", "m3": "intally", "m4": "posted"}, "bulk Confirm on a mixed selection: only the invoice to review (%s)" % st)
    E("() => { SL().sel = new Set(['m3', 'm4']); salesBulk('ignore'); SL().sel = new Set(['m3', 'm4']); salesBulk('delete'); }"); W(100)
    st = {k: E(SV, k) for k in ["m3", "m4"]}
    ok(st == {"m3": "intally", "m4": "posted"}, "bulk Ignore and Delete leave In Tally and posted invoices (%s)" % st)
    E("() => { SL().undo = null; ['restore', 'unready', 'ignore', 'confirm', 'delete'].forEach(a => { salesRowAct(a, 'm3'); salesRowAct(a, 'm4'); }); }"); W(100)
    ok(E(SV, "m3") == "intally" and E(SV, "m4") == "posted" and E("SL().undo") is None, "the row buttons refuse In Tally and posted invoices (%s, %s)" % (E(SV, "m3"), E(SV, "m4")))

    box = lambda: pg.inner_text("#confirmBox").replace("\n", " ") if pg.locator("#confirmBox .cbx").count() else ""
    E("() => salesRowAct('nottally', 'n2')"); W(400)
    ok("This invoice was matched to Tally entry" in box() and "Mark it as NOT that entry?" in box() and "posting will put it in Tally twice" in box(), "sales: Not this Tally entry asks first (%r)" % box()[:200])
    pg.click('#confirmBox [data-cbx="yes"]'); W(400)
    ok(E(SV, "n2") == "review" and E("SL().list.find(v => v.id === 'n2').notTally") == ["sv-1"], "sales: back to review (a person confirms it), the entry remembered (%s)" % E(SV, "n2"))
    E("""() => { const v = SL().list.find(x => x.id === 'n2'); const m1 = window.mapInvoice; window.mapInvoice = window.__mi0; const h = [hasLedgerList, ledgerProblems, invoiceProblems, customerLedgerFor];
      window.hasLedgerList = () => true; window.ledgerProblems = () => []; window.invoiceProblems = () => []; window.customerLedgerFor = () => ({ledger: 'Alpha Retail', sure: true, label: 'match'});
      try { mapInvoice(v); } finally { [window.hasLedgerList, window.ledgerProblems, window.invoiceProblems, window.customerLedgerFor] = h; window.mapInvoice = m1; } }""")
    ok(E(SV, "n2") == "review", "sales: working out the invoice again keeps it in review until a person sets its ledger (%s)" % E(SV, "n2"))
    E("""async () => { window.tallyVia = () => true; window.tallyCall = async () => ({vouchers: [{guid: 'sv-1', number: 'S/n2', date: '20260701'}]});
      await salesCheckTally(SL().list.filter(v => v.id === 'n2')); }""")
    ok(E(SV, "n2") == "review", "sales: the excluded voucher is not matched again")
    E("""async () => { const s = SL(), o = s.list.find(x => x.id === 'n2'); const v = JSON.parse(JSON.stringify(o)); v.id = 'n2b'; delete v.notTally; s.list.push(v);
      await salesCheckTally([v]); }""")
    ok(E(SV, "n2b") == "review", "sales: the invoice uploaded again keeps its excluded voucher")
    E("""async () => { window.tallyCall = async () => ({vouchers: [{guid: 'sv-1', number: 'S/n2', date: '20260701'}, {guid: 'sv-2', number: 'S/n2', date: '20260702'}]});
      await salesCheckTally(SL().list.filter(v => v.id === 'n2')); }""")
    ok(E(SV, "n2") == "intally" and E("SL().list.find(v => v.id === 'n2').tallyMatch.key") == "sv-2", "sales: another voucher of that number is matched")
    E("() => { const v = SL().list.find(x => x.id === 'm3'); delete v.tallyMatch; salesRowAct('nottally', 'm3'); }"); W(400)
    ok("every Tally voucher numbered S/m3" in box(), "sales matched before FinCom kept the voucher: the box says every voucher of that number is excluded (%r)" % box()[:260])
    pg.click('#confirmBox [data-cbx="no"]'); W(300)

    print("== purchase bills")
    cid = E(BILLS); W(800)
    box = lambda: pg.inner_text("#confirmBox").replace("\n", " ") if pg.locator("#confirmBox .cbx").count() else ""
    ytd = "(id) => { const e = D().entries[id], a = e.applied || (e.deleted && e.deleted.kept && e.deleted.kept.applied); const p = a && D().parties[a.partyId]; return p ? JSON.stringify(p.ytd) : ''; }"
    REFUSE = "This bill is posted to Tally. Delete it in Tally first, then press “Deleted in Tally” in the bar under this bill; after that you can delete it."
    for b in ("b1", "b6"):
        E("() => { window.__toasts = []; }"); E("billDelete('%s')" % b); W(400)
        ok(not box() and last() == REFUSE and E("D().entries['%s'].status" % b) == "approved", "deleting a posted bill (%s) is refused, no box (%r)" % (b, last()))
    E("(cid) => { window.__un2 = unapply(D().entries.b6, cid); }", cid)
    ok(E("D().entries.b6.status") == "approved" and E("window.__un2") is False, "unapply refuses a bill whose posting is being checked")
    E("(cid) => { const s0 = window.postSending; window.postSending = (c) => new Set(['q1']); window.__un3 = unapply(D().entries.q1, cid); window.__s0 = s0; }", cid)
    ok(E("D().entries.q1.status") == "approved" and E("window.__un3") is False, "unapply refuses a bill whose cloud posting is still running")
    E("(cid) => { window.__un = unapply(D().entries.b2, cid); }", cid)
    ok(E("D().entries.b2.status") == "approved" and E("!!D().entries.b2.applied") and E("window.__un") is False, "unapply refuses a bill sent to Tally")
    E("() => { S.selected = 'b5'; doAct('reject'); }"); W(200)
    ok(E("D().entries.b5.status") == "approved" and last() == "This bill is posted to Tally. Delete it in Tally first, then press “Deleted in Tally” in the bar under this bill; after that you can mark it No entry.", "No entry refuses a posted bill (%r)" % last())
    E("() => { S.selected = 'b3'; window.__removed = []; doAct('reject'); }"); W(600)
    ok(E("D().entries.b3.status") == "rejected" and E("window.__removed.length") == 0 and E("!!D().entries.b3.docPath"), "No entry: the cloud document is not removed while Undo is offered")
    pg.hover("#toast"); W(14000)
    ok(E("window.__removed.length") == 0 and pg.locator('#toast [data-toast-act="Undo"]').count() == 1, "the pointer on the message for 14 s: Undo still there, the document still kept")
    pg.click('#toast [data-toast-act="Undo"]'); W(300)
    E("() => toast('Something else.')"); W(400)
    ok(E("D().entries.b3.status") == "draft" and E("window.__removed.length") == 0 and E("!!D().entries.b3.docPath"), "Undo of No entry: the bill and its cloud document are back, nothing removed after the message goes")
    E("() => { S.selected = 'b3'; doAct('reject'); }"); W(600)
    other = pg.locator('#toast [data-toast-act]:not([data-toast-act="Undo"])')
    if other.count(): other.first.click()
    else: E("() => toast('Something else.')")
    W(400)
    ok(E("D().entries.b3.status") == "rejected" and E("window.__removed.length") == 1 and not E("D().entries.b3.docPath"), "No entry kept: the cloud document removed once another button of the message is pressed, or it has gone (%s)" % E("window.__removed"))
    # the three un-post paths
    E("""() => { window.unpostFromTally = async () => true; doAct('billUnpost'); }"""); W(500)
    pg.select_option("#unpostPick", "u1"); pg.click('#confirmBox [data-cbx="yes"]'); W(500)
    E("""async (cid) => { const e = D().entries.u2; PostCheck.live = async () => ({ok: true, found: null, readAt: new Date(Date.now() + 60000).toISOString()}); window.postAllToTally = async () => true; await PostCheck.repost(CO(cid), e); }""", cid); W(300)
    has_owner = E("typeof PostOwner === 'object'")
    if not has_owner:
        E("() => { S.view = 'company'; goStep('post'); render(); }"); W(2500)
        has_owner = E("typeof PostOwner === 'object'")
    if has_owner:
        E("(cid) => { window.__rp = PostOwner.release(cid, D().entries.u3, null); }", cid); W(500)
        pg.fill("#confirmBox #releaseWhy", "not in the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); W(500)
    f = E("(F) => ['u1', 'u2', 'u3'].map(id => { const e = D().entries[id], o = {}; F.forEach(k => { o[k] = e[k] === undefined || e[k] === '' || e[k] === false ? null : e[k]; }); return o; })", json.loads(BF.replace("'", '"')))
    ok(has_owner and f[0] == f[1] == f[2] and f[0]["exportedAt"] is None and f[0]["tally"] is None, "the three un-post paths leave the same fields, cleared (%s)" % f)
    # the bar says what tallyStateOf says
    bar = lambda: pg.inner_text("#app .actionbar") if pg.locator("#app .actionbar").count() else ""
    E("() => { goStep('review', 'bills'); S.filter = 'approved'; S.selected = 's1'; S.reviewTable = false; render(); }"); W(600)
    t = bar(); ok("In Tally, not confirmed" in t and "Undo approval" not in t, "a bill sent and not read back: 'In Tally, not confirmed' (%r)" % t[:120])
    E("() => { S.selected = 'b2'; render(); }"); W(400)
    t = bar(); ok("In Tally" in t and "not confirmed" not in t, "a bill read back in Tally: 'In Tally' (%r)" % t[:120])
    E("() => { S.selected = 'g1'; render(); }"); W(400)
    t = bar(); ok("Not in Tally any more" in t, "a bill gone from Tally: 'Not in Tally any more' (%r)" % t[:120])
    E("() => { S.selected = 'b6'; render(); }"); W(400)
    t = bar(); ok("Undo approval" not in t, "a bill whose posting is being checked: no Undo approval (%r)" % t[:120])
    E("() => { window.postSending = (c) => new Set(['q1']); S.selected = 'q1'; render(); }"); W(400)
    t = bar(); ok("Undo approval" not in t, "a bill whose cloud posting is running: no Undo approval (%r)" % t[:120])
    E("() => { window.postSending = window.__s0; render(); }"); W(400)
    t = bar(); ok("Undo approval" in t, "the same bill once nothing is sending: Undo approval (%r)" % t[:120])
    # Deleted in Tally: a stand for Tally as FinCom sees it: this computer's bridge (/vouchers read now, or refused when
    # reading entries is off; /ledgervouchers from its kept copy) and FinCom's cloud copy (TCloud.book: daysAt, doneTo,
    # skipped; tally_vouchers by GUID through TallyProof.live)
    E("""() => { window.__t = {mode: 'bridge', vouchers: [], refused: false, lv: [], book: null, guids: []};
      window.tallyVia = () => window.__t.mode; Bridge.on = () => window.__t.mode === 'bridge'; Bridge.up = () => true; const c0 = Bridge.call;
      Bridge.call = async (p, ...a) => { const T = window.__t;
        if (/^\/vouchers/.test(p)){ if (T.refused) throw new Error('Reading entries from Tally is off on this computer'); return {vouchers: T.vouchers}; }
        if (/^\/ledgervouchers/.test(p)) return {ok: true, rows: T.lv};
        if (p === '/unpost') return {ok: true};
        return c0.call(Bridge, p, ...a); };
      TCloud.on = () => window.__t.mode === 'cloud'; TCloud.has = () => true; TCloud.book = () => window.__t.book;
      TallyProof.live = async (path) => window.__t.guids.filter(g => path.includes(encodeURIComponent('"' + g + '"'))).map(g => ({guid: g, cancelled: false}));
      window.__posted = 0; window.postAllToTally = async () => { window.__posted++; }; }""")
    T = lambda js: E("() => { Object.assign(window.__t, %s); window.__toasts = []; }" % js)
    def press(bid):
        E("(id) => { S.selected = id; render(); }", bid); W(300)
        pg.click('#app .actionbar button:has-text("Deleted in Tally")'); W(900)
    st_of = lambda bid: E("(id) => { const e = D().entries[id]; return [e.status, !!e.exportedAt]; }", bid)
    NOTSURE = "FinCom could not find it, but cannot be sure it is gone ("
    E("() => { goStep('review', 'bills'); S.filter = 'approved'; S.selected = 'b5'; S.reviewTable = false; render(); }"); W(500)
    ok(pg.locator('#app .actionbar button:has-text("Deleted in Tally")').count() == 1, "a posted bill: “Deleted in Tally” in the bar under it")
    # any read that finds it: still there, the voucher named (the bridge's read, the bridge's kept entries, the cloud copy)
    T("{mode: 'bridge', vouchers: [{guid: 'g-b5', number: '4521', date: '20260701', type: 'Purchase', narration: 'TDSDesk:b5', entries: []}]}")
    press("b5")
    ok(st_of("b5") == ["approved", True] and "Tally still has it" in last() and "4521" in last(), "the bridge reads it in Tally: stays posted, the voucher named (%r)" % last())
    T("{refused: true, lv: [{date: '20260701', type: 'Purchase', other: 'Exp', dr: '', cr: '1000.00'}]}")
    press("l2")
    ok(st_of("l2") == ["approved", True] and "Tally still has it" in last(), "the bridge's kept entries of the party have it: stays posted (%r)" % last())
    T("{mode: 'cloud', guids: ['g-l1'], book: {book: 'bk1', daysAt: '2026-09-01T00:00:00Z', state: {doneTo: '20260101', skipped: []}}}")
    press("l1")
    ok(st_of("l1") == ["approved", True] and "Tally still has it" in last(), "the cloud copy has its GUID (whatever its last read): stays posted (%r)" % last())
    # nothing found: never released by itself, in each case a proof of absence once relied on
    cases = (("{mode: 'bridge', refused: false, vouchers: [], lv: []}", "an empty reply from Tally"),
             ("{mode: 'bridge', refused: false, vouchers: [{guid: 'new-guid', number: '9', date: '20260712', type: 'Purchase', narration: '', party: 'Someone Else', entries: []}], lv: []}", "a voucher re-created in Tally under another id"),
             ("{mode: 'bridge', refused: true, lv: []}", "reading entries off (an earlier-year company open, or ReadDays off)"),
             ("{mode: 'cloud', guids: [], book: {book: 'bk1', daysAt: '2026-11-01T00:00:00Z', state: {doneTo: '20261031', skipped: []}}}", "the cloud copy read after the posting, no GUID (book-wide daysAt)"),
             ("{mode: 'cloud', guids: [], book: {book: 'bk1', daysAt: '2026-09-01T00:00:00Z', state: {doneTo: '20261031', skipped: []}}}", "a stale cloud copy"))
    for js, what in cases:
        T(js); press("b5")
        ok(st_of("b5") == ["approved", True] and NOTSURE in last() and E("window.__posted") == 0, "%s: nothing released, '%s' (%r)" % (what, NOTSURE, last()))
    T("{mode: 'bridge', refused: true, lv: []}"); press("b5"); said_failed = last()
    T("{mode: 'bridge', refused: false, vouchers: [], lv: []}"); press("b5"); said_none = last()
    ok("could not read the FinCom Bridge’s read of Tally" in said_failed and "nothing found in the party’s ledger in Tally" in said_failed and "nothing found in the FinCom Bridge’s read of Tally" in said_none and "could not read" not in said_none,
       "the words say which reads failed and which found nothing (%r | %r)" % (said_failed, said_none))
    ok(E("postBucket(D().entries.b5, {})") == "intally", "and it reads as in Tally, as before")
    # a member: "Ask the owner to release" (a reason), to Post to Tally > Errors; nothing changes on the bill
    T("{mode: 'bridge', refused: false, vouchers: [], lv: []}")
    E("() => { S.account = {me: {role: 'staff'}, firm: {name: 'Firm'}}; }")
    press("c7")
    ask = pg.locator('#toast [data-toast-act="Ask the owner to release"]')
    ok(ask.count() == 1 and NOTSURE in last(), "a member: “Ask the owner to release”")
    if ask.count(): ask.click(); W(400)
    if box(): pg.fill("#confirmBox #deletedWhy", "not in the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); W(400)
    ok(st_of("c7") == ["approved", True] and E("!!(D().entries.c7.ownerRelease && D().entries.c7.ownerRelease.ask)"), "asked: still posted, waiting for the owner")
    for bid in ("c8", "c9"):
        press(bid)
        if pg.locator('#toast [data-toast-act="Ask the owner to release"]').count(): pg.locator('#toast [data-toast-act="Ask the owner to release"]').click(); W(400)
        if box(): pg.fill("#confirmBox #deletedWhy", "not in the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); W(400)
    ok(E("!!(D().entries.c8.ownerRelease && D().entries.c9.ownerRelease)") and any("bill_release_asked" in a for a in E("window.__audit || []") or []) or E("!!(D().entries.c8.ownerRelease && D().entries.c9.ownerRelease)"), "two more asks (bills posted through the bridge only)")
    # the owner: a fresh reason, the risk said, then released (the bridge's release, the cloud's id)
    E("""(cid) => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; window.__rpc = []; TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, a]); if (window.__no174) throw new Error("Could not find the function public." + fn + "(p_id, p_job, p_why) in the schema cache"); return {ok: true, owner: true}; };
      window.__no174 = true; CloudJobs.list = [{id: 'job-c', client_id: cid, status: 'done', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', entry_ids: ['c6', 'c7'], results: [{id: 'c6', ok: true, verified: true, guid: 'g6'}, {id: 'c7', ok: true, verified: true, guid: 'g7'}]}]; }""", cid)
    press("h1")
    btn = pg.locator('#toast [data-toast-act^="I checked in Tally: not there"]')
    ok(btn.count() == 1 and st_of("h1") == ["approved", True], "an owner: “I checked in Tally: not there – release”, nothing changed yet")
    if btn.count(): btn.click(); W(400)
    ok("it will be posted twice" in box() and pg.locator("#confirmBox #deletedWhy").count() == 1, "it asks a fresh reason and says the risk (%r)" % box()[:160])
    if box(): pg.fill("#confirmBox #deletedWhy", "looked in the Day Book myself"); pg.click('#confirmBox [data-cbx="yes"]'); W(500)
    h1 = E("(() => { const e = D().entries.h1; return {status: e.status, exp: e.exportedAt || null, rel: !!(e.release && e.release.at), mark: !!(e.deletedInTally && e.deletedInTally.at)}; })()")
    ok(h1 == {"status": "draft", "exp": None, "rel": True, "mark": True}, "the owner's word: back to To review, released once for the bridge, marked deleted in Tally (%s)" % h1)
    ap = E("""async () => { const ap = await loadAutoPost(); return ap.billCheck(D().entries.h1, {cfg: Object.assign({}, ap.DEF, {on: true}), entries: D().entries, env: {}}).stops.join('; '); }""")
    ok("deleted in Tally" in (ap or ""), "Post automatically never takes a bill marked deleted in Tally (%r)" % ap)
    E("() => { approve(D().entries.h1, {bulk: true}); }")
    ok(E("!!D().entries.h1.deletedInTally"), "approving it again keeps the mark")
    E("() => { setStatus(D().entries.h1, 'draft'); }")
    E("billDelete('h1')"); W(400)
    ok("Delete this bill?" in box(), "then it can be deleted (%r)" % box()[:80])
    pg.click('#confirmBox [data-cbx="no"]'); W(300)
    press("c6")
    if pg.locator('#toast [data-toast-act^="I checked in Tally: not there"]').count(): pg.locator('#toast [data-toast-act^="I checked in Tally: not there"]').click(); W(400)
    if box(): pg.fill("#confirmBox #deletedWhy", "deleted it"); pg.click('#confirmBox [data-cbx="yes"]'); W(600)
    rp = E("window.__rpc")
    sent = [x for x in rp if x[0] == "tally_post_owner_release"]
    ok(E("D().entries.c6.status") == "draft" and sent == [["tally_post_owner_release", {"p_job": "job-c", "p_id": "c6", "p_why": "deleted it"}]] and not [x for x in rp if x[0] == "tally_post_id_release_owner"],
       "a cloud posting: the owner's word goes to tally_post_owner_release(p_job, p_id, p_why) (migration 174), never to 55's tally_post_id_release_owner (%s)" % rp)
    ok(E("D().entries.c6.ownerRelease && D().entries.c6.ownerRelease.job") == "job-c" and "Could not find the function public.tally_post_owner_release" in last() and "Post to Tally › Errors" in last(),
       "a cloud without 174 refuses: the server's words, the release waits under Post to Tally › Errors (%r)" % last())
    E("() => { window.__no174 = false; }")
    E("() => { window.postSending = (c) => new Set(['b2']); S.selected = 'b2'; render(); }"); W(400)
    ok(pg.locator('#app .actionbar button:has-text("Deleted in Tally")').count() == 0, "no “Deleted in Tally” while its cloud posting is still sending")
    E("() => { window.postSending = window.__s0; render(); }")
    # B2: a release for the bridge on this computer
    ok(E("postReleased([D().entries.h1]).length") == 1 and E("postReleased([D().entries.h1])[0].id") == "h1", "the bill goes to the bridge as released once (postReleased)")
    src = open(os.path.join(HERE, "..", "src", "js", "24-tally-bridge.js")).read()
    ok("released: postReleased(todo)" in src and "released: postReleased(rows)" in src, "bills are passed as released like bank lines")
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; S.view = 'company'; goStep('post'); S.postTab = 'errors'; render(); }"); W(2500)
    E("() => { const b = document.querySelector('[data-post-tab=\"errors\"], [data-tab=\"errors\"]'); if (b) b.click(); }"); W(800)
    rb = pg.locator('[data-owner-release-btn="c7"]')
    ok(rb.count() == 1 and "Owner: release this bill" in rb.inner_text(), "Post to Tally > Errors: “Owner: release this bill” for the owner (%d)" % rb.count())
    if rb.count(): rb.click(); W(600)
    if box(): pg.fill("#confirmBox #deletedWhy", "checked the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); W(600)
    ok(["tally_post_owner_release", {"p_job": "job-c", "p_id": "c7", "p_why": "checked the Day Book"}] in E("window.__rpc") and not E("D().entries.c7.ownerRelease") and E("D().entries.c7.status") == "draft", "the owner's press (a fresh reason) releases it through tally_post_owner_release")
    n0 = len(E("window.__rpc"))
    rb = pg.locator('[data-owner-release-btn="c8"]')
    if rb.count(): rb.click(); W(600)
    if box(): pg.fill("#confirmBox #deletedWhy", "checked the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); W(600)
    ok(not E("D().entries.c8.ownerRelease") and E("D().entries.c8.status") == "draft" and E("!!D().entries.c8.release") and len(E("window.__rpc")) == n0,
       "a member's ask on a bill posted through the bridge only: the owner's release settles it, no call to FinCom's cloud (%s)" % E("window.__rpc")[n0:])
    dm = pg.locator('[data-owner-release-dismiss="c9"]')
    ok(dm.count() == 1, "the owner may dismiss a member's ask")
    if dm.count(): dm.click(); W(400)
    ok(not E("D().entries.c9.ownerRelease") and st_of("c9") == ["approved", True] and pg.locator('[data-owner-release-btn="c9"]').count() == 0, "dismissed: it stays posted, off Errors")
    E("() => { S.account = null; goStep('review', 'bills'); S.filter = 'approved'; S.reviewTable = false; render(); }"); W(500)
    # MED 1: the cloud's earlier posting of each bill is known when it is cleared (four paths); a later posting is marked
    E("""(cid) => { window.unpostFromTally = async () => true; CloudJobs.list = [{id: 'job-old', client_id: cid, status: 'done', created_at: '2026-10-01T10:00:00Z', updated_at: new Date(Date.now() + 3600000).toISOString(), entry_ids: ['k1', 'k2', 'k3', 'k4', 'k5'],
      results: ['k1', 'k2', 'k3', 'k4', 'k5'].map(id => ({id, ok: true, verified: true, guid: 'old-' + id}))}]; }""", cid)
    E("() => { doAct('billUnpost'); }"); W(500); pg.select_option("#unpostPick", "k1"); pg.click('#confirmBox [data-cbx="yes"]'); W(500)
    E("""async (cid) => { PostCheck.live = async () => ({ok: true, found: null, readAt: new Date(Date.now() + 60000).toISOString()}); await PostCheck.repost(CO(cid), D().entries.k2); }""", cid); W(300)
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; }")
    press("k3")
    if pg.locator('#toast [data-toast-act^="I checked in Tally: not there"]').count(): pg.locator('#toast [data-toast-act^="I checked in Tally: not there"]').click(); W(400)
    if box(): pg.fill("#confirmBox #deletedWhy", "deleted it"); pg.click('#confirmBox [data-cbx="yes"]'); W(600)
    E("() => { S.account = null; }")
    E("""async (cid) => { const e = D().entries.k4; e.auto = {run: 'r8', key: 'kk', label: 'K4', amt: 1000, cid: ''}; window.bridgeLive = () => true;
      const ap = await loadAutoPost(); await ap.undo(cid, e, {noAsk: true}); ['k3', 'k4'].forEach(id => approve(D().entries[id], {bulk: true})); }""", cid); W(300)
    n = E("(cid) => postReconcile(cid, true)", cid)
    st = E("['k1', 'k2', 'k3', 'k4', 'k5'].map(id => [D().entries[id].status, !!D().entries[id].exportedAt])")
    ok(st[:4] == [["approved", False]] * 4 and st[4] == ["approved", True], "the earlier cloud posting (updated since, by a release): not marked on the four cleared bills; marked on one never posted here (%s, %s)" % (st, n))
    bk = [E("(id) => postBucket(D().entries[id], {jobs: postJobStates(S.coId)})", k) for k in ["k1", "k2", "k3", "k4"]]
    ok(bk == ["ready", "ready", "ready", "ready"], "the four are ready to post again (%s)" % bk)
    E("""(cid) => { CloudJobs.list.push({id: 'job-new', client_id: cid, status: 'done', created_at: new Date(Date.now() + 1000).toISOString(), updated_at: new Date(Date.now() + 1000).toISOString(), entry_ids: ['k1'], results: [{id: 'k1', ok: true, verified: true, guid: 'new-k1'}]}); postReconcile(cid, true); }""", cid)
    ok(E("!!D().entries.k1.exportedAt") and E("D().entries.k1.tally.guid") == "new-k1", "a new cloud posting after the clear, finished while the page was closed: marked posted, not sent again")
    # H2: bills queued here (postMarkNew) and marked posted from the cloud's result, then undone automatically / deleted in
    # Tally by the owner: that posting is old, never marked on them again; a Retry of it is refused
    E("""(cid) => { ['j1', 'j2'].forEach(id => { const e = D().entries[id]; billClearPosting(e); ['postClearedJobs', 'postClearedMark', 'postedVia'].forEach(k => delete e[k]); });
      postMarkNew(cid, ['j1', 'j2'], 'job-q'); const t = new Date(Date.now() + 2000).toISOString();
      CloudJobs.list = [{id: 'job-q', client_id: cid, status: 'done', created_at: t, updated_at: t, entry_ids: ['j1', 'j2'], results: ['j1', 'j2'].map(id => ({id, ok: true, verified: true, guid: 'q-' + id, vchType: 'Purchase', vchDate: '20260701'}))}];
      postReconcile(cid, true); }""", cid)
    ok(E("['j1', 'j2'].every(id => !!D().entries[id].exportedAt)"), "queued here: both marked posted from the cloud's result")
    E("""async (cid) => { const e = D().entries.j1; e.auto = {run: 'r7', key: 'kj', label: 'J1', amt: 1000, cid: ''}; window.bridgeLive = () => true;
      const ap = await loadAutoPost(); await ap.undo(cid, e, {noAsk: true}); approve(e, {bulk: true}); }""", cid); W(300)
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; window.__rpc = []; }")
    press("j2")
    if pg.locator('#toast [data-toast-act^="I checked in Tally: not there"]').count(): pg.locator('#toast [data-toast-act^="I checked in Tally: not there"]').click(); W(400)
    if box(): pg.fill("#confirmBox #deletedWhy", "deleted it"); pg.click('#confirmBox [data-cbx="yes"]'); W(600)
    ok(["tally_post_owner_release", {"p_job": "job-q", "p_id": "j2", "p_why": "deleted it"}] in E("window.__rpc"), "the owner's word on a bill queued here: released for that posting (%s)" % E("window.__rpc"))
    E("() => { approve(D().entries.j2, {bulk: true}); S.account = null; }")
    E("(cid) => postReconcile(cid, true)", cid)
    st = E("['j1', 'j2'].map(id => [D().entries[id].status, !!D().entries[id].exportedAt, postBucket(D().entries[id], {jobs: postJobStates(S.coId)})])")
    ok(st == [["approved", False, "ready"], ["approved", False, "ready"]], "queued here, then AutoPost undo / Deleted in Tally: not marked posted again by that posting, ready to post (%s)" % st)
    # the cleared posting no longer holds j2 (released by the owner); a newer posting of it does, whatever its state
    ok(E("(cid) => billPostLive(D().entries.j2, cid)", cid) is False, "after the owner's Deleted in Tally: the cleared posting does not hold the bill")
    E("""(cid) => { const t = new Date(Date.now() + 5000).toISOString(); window.__pir = window.postIdReleased; window.postIdReleased = (id) => id === 'j2' ? false : undefined;
      CloudJobs.list.push({id: 'job-q2', client_id: cid, status: 'done', created_at: t, updated_at: t, entry_ids: ['j2'], items: [{id: 'j2', state: 'needs_review'}], results: [{id: 'j2', ok: false, needsReview: true, accepted: true}]}); }""", cid)
    lv = E("(cid) => [billPostLive(D().entries.j2, cid), unapply(D().entries.j2, cid), D().entries.j2.status]", cid)
    ok(lv == [True, False, "approved"], "a newer cloud posting of it needing review: posted again (no Undo approval, no No entry, no delete) (%s)" % lv)
    E("(cid) => { CloudJobs.list = CloudJobs.list.filter(j => j.id !== 'job-q2'); window.postIdReleased = window.__pir; }", cid)
    rf = E("(cid) => postRetryRefusal({id: 'job-q', client_id: cid, status: 'failed', entry_ids: ['j1']})", cid)
    ok("Retry not possible" in (rf or "") and "changed since" in (rf or ""), "a Retry of that posting is refused: its bill was changed since (%r)" % rf)
    rf2 = E("() => postRetryRefusal({id: 'job-x', client_id: 'another-client', status: 'failed', entry_ids: ['zz1']})")
    ok("open this client first" in (rf2 or ""), "a Retry for a client whose entries are not loaded here: refused (%r)" % rf2)
    E("() => { CloudJobs.list = []; }")
    # S1: whether a line is FinCom's own posting, for 5,000 lines against a book of 5,000 entries
    ms = E("""() => { const b = B(), book = []; for (let i = 0; i < 5000; i++) book.push({date: '2026-01-01', debit: i + 1, credit: 0, vt: 'Receipt', vn: String(i), narr: '', guid: 'pg-' + i});
      b.books.a1 = {entries: book}; const rows = book.map((t, i) => ({id: 'pr' + i, fp: 'pfp' + i, state: 'intally', tallyKey: 'pg-' + i})); const t0 = performance.now(); rows.forEach(bankOwnPost); return performance.now() - t0; }""")
    ok(ms is not None and ms < 400, "FinCom's own posting for 5,000 lines: %d ms" % (ms or -1))
    # Undo of an automatic bill in Tally whose id the cloud still holds: back to To review, not left approved
    E("""async (cid) => { const e = D().entries.u1; approve(e, {bulk: true}); Object.assign(e, {exportedAt: '2026-10-02T10:00:00Z', tally: {guid: 'g-au', vchType: 'Purchase', vchDate: '20260701', company: 'ZZ'}, auto: {run: 'r9', key: 'kb', label: 'Unpost One', amt: 1000, cid: ''}});
      window.postIdReleased = (id) => id === 'u1' ? false : undefined; window.bridgeLive = () => true; const c0 = Bridge.call; Bridge.call = async (p, ...a) => p === '/unpost' ? {ok: true} : c0.call(Bridge, p, ...a);
      const ap = await loadAutoPost(); window.__apb = await ap.undo(cid, e, {noAsk: true}); Bridge.call = c0; }""", cid); W(300)
    ok(E("window.__apb && window.__apb.ok") and E("D().entries.u1.status") == "draft", "automatic bill undone from Tally: back to To review (%s, %s)" % (E("window.__apb"), E("D().entries.u1.status")))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
