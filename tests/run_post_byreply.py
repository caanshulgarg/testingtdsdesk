"""python3 run_post_byreply.py - FinCom Bridge 2.1.8 posts by Tally's reply and never reads back (owner, 04-Oct-2026).
A posted entry's result is {ok: true, byReply: true, verified: false, vchId (one voucher a request) | batchEnd + batchN,
state: "posted", ...}; the job "done", "Posted 1 of 1 (Tally's reply)". Before this round the app never marked such a bill
posted ("In Tally, not yet read back", under Errors) and nothing marked a bill whose posting finished while the page was not
waiting. Checked:
(a) Post on a bill whose posting comes back by Tally's reply: exportedAt, postByReply, e.tally.vch = 26303, billInTally,
    no postUnconfirmed / postError, not under attention, the drawer's "Sent to Tally" stamp and "Posted to Tally: voucher id
    26303", the run line "1 in Tally (Tally's reply)", postWord "Posted to Tally (Tally's reply)", tallyStateOf "In Tally";
(b) a batch of 3 (batchN 3, batchEnd 1300, no vchId): each bill marked "batch ending Tally id 1300", none with a vch;
(c) reconcile: a finished posting of the cloud for a bill never touched here is marked by CloudJobs.load (the job's company,
    sentAt, by = who pressed Post), a second load changes nothing, a needsReview result is not marked, a bank line of the
    open statement is marked sent; one toast "N postings marked from Tally's reply";
(d) Post (the button, postAllToTally for the bill, the legacy postBillsToTally()) sends none of the marked bills again;
(e) bank: postBankToTally with a byReply ok result (CloudPost.run stubbed): the line is sent, with r.tally.vch, no postError.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_byreply.py"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8274), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async () => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional"); choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY");
  const t = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.__t = t;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.email = "me@firm.in"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}, {user_id: "u-2", name: "Ravi Staff"}, {user_id: "u-me", name: "Me Here", email: "me@firm.in"}];
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY", daysAt: new Date().toISOString(), state: {doneTo: "20261001", skipped: []}}]};
  const G = "GARG SHEKHAR & COMPANY";
  window.__jobs = [];
  window.__postIds = [];
  window.__leds = ["Alpha Consultants", "Batch One Co", "Batch Two Co", "Batch Three Co", "Cloud Only Co", "Review Co", "Professional Charges", "TDS Payable - Professional", "Office Rent", "HDFC BANK"].map(n => ({name: n, parent: /Charges|Rent/.test(n) ? "Indirect Expenses" : /TDS/.test(n) ? "Duties & Taxes" : /BANK/.test(n) ? "Bank Accounts" : "Sundry Creditors", chain: []}));
  TCloud.restAll = async (u) => /^tally_post_ids/.test(u) ? JSON.parse(JSON.stringify(window.__postIds)) : /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : /tally_ledgers/.test(u) ? JSON.parse(JSON.stringify(window.__leds)) : [];
  // FinCom's cloud: tally_post_enqueue makes the job row; the Tally computer (bridge 2.1.8) finishes it at once, by Tally's
  // reply: one voucher -> its exact id (vchId); several -> the batch's last id (batchEnd, batchN), no id for each
  window.__rpc = [];
  window.__reply = (ids, at) => ids.map((id, i) => Object.assign({id, ok: true, byReply: true, verified: false, state: "posted", vchDate: "20261001", vchType: "Journal", sentAt: at, created: 1, altered: 0, exceptions: 0, ignored: 0,
    company: G, message: "Posted (Tally's reply)"}, ids.length === 1 ? {vchId: "26303", batchN: 1, batchEnd: "26303", lastVchId: "26303"} : {batchN: ids.length, batchEnd: "1300", lastVchId: "1300"}));
  TCloud.rpc = async (fn, a) => {
    if (fn === "tally_post_enqueue" && a && a.p_payload && (a.p_payload.vouchers || []).length){
      const ids = a.p_payload.vouchers.map(v => v.id), at = new Date().toISOString();
      window.__jobs.unshift({id: a.p_id, client_id: a.p_client, company: G, status: "done", done: ids.length, n: ids.length, message: "Posted " + ids.length + " of " + ids.length + " (Tally's reply)", checking: false,
        created_by: "u-me", created_at: at, updated_at: at, entry_ids: ids, results: window.__reply(ids, at), items: ids.map(id => ({id, state: "posted"}))});
      window.__rpc.push([fn, {p_id: a.p_id, p_client: a.p_client, ids}]); CloudJobs.changed(); return {ok: true}; }
    window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    if (fn === "tally_vouchers_in") return [];
    return /^tally_(want_update|post_dismiss|post_undismiss|post_record)$/.test(fn) ? {ok: true} : null; };
  Cloud.api = async (p) => { const m = /tally_post_jobs\\?.*id=eq\\.([^&]+)/.exec(p); return m ? JSON.parse(JSON.stringify(window.__jobs.filter(j => j.id === m[1]))) : []; };
  CloudJobs.list = null; CloudJobs.at = 0; CloudJobs.tried = {};
  window.__dev = {id: "d-1", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", beat: {at: new Date().toISOString(), every: 30, tally: true, tallyState: "open",
    paused: false, notAnsweringSince: "", updating: false, lastRead: t(10), open: [G], companies: [{name: G, open: true, at: t(10), lastRead: t(10)}]}}};
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [window.__dev], cos: [{company: G, client_id: c.id, device_id: "d-1"}]};
  PostCheck.due = () => false;
  await openCompany(c.id);
  window.__mk = (id, n, no, amt) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[S.coId].entries[e.id] = e; approve(e); e.approvedAt = t(400); return e; };
  window.__mk("b1", "Alpha Consultants", "A/1", 30000);
  TallyProof.at[c.id] = Date.now(); TallyProof.check = async () => 0;
  window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  refreshStats(c.id); goStep("post", "bills");
  await new Promise(r => setTimeout(r, 500));
  S.bank.loading = false;
  window.autoPostTo = async () => {};
  await CloudJobs.load(true);
  render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8274/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); pg.wait_for_timeout(1200)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").replace("’", "'").strip() if pg.locator(sel).count() else ""
    def tab(name):
        pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(300)
    def press_post(sel="#app [data-post-main]"):
        pg.click(sel); pg.wait_for_timeout(700)
        if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]')
        for i in range(30):
            pg.wait_for_timeout(300)
            if not E("!!(S.billPost && S.billPost.busy)") and not pg.locator('#confirmBox [data-cbx="yes"]').count(): break
        pg.wait_for_timeout(1200)
    enq_ids = lambda: [i for f, a in E("window.__rpc") if f == "tally_post_enqueue" for i in a.get("ids", [])]
    ST = """(id) => { const e = D().entries[id]; return {exp: !!e.exportedAt, by: e.postByReply === true, vch: e.tally && e.tally.vch != null ? String(e.tally.vch) : null,
      batchEnd: e.tally && e.tally.batchEnd != null ? String(e.tally.batchEnd) : null, batchN: e.tally && e.tally.batchN, company: e.tally && e.tally.company, at: e.tally && e.tally.at, who: e.tally && e.tally.by,
      inT: billInTally(e), unc: !!e.postUnconfirmed, err: e.postError || "", bucket: postBucket(e, {jobs: postJobStates(S.coId)}), state: tallyStateOf(e)[1]}; }"""
    # ---------------------------------------------------------------- (a) one bill, posted by Tally's reply
    tab("topost")
    ok(txt("#app [data-post-main]") == "Post 1 to Tally", "(a) one bill ready: Post 1 to Tally (%s)" % txt("#app [data-post-main]"))
    press_post()
    ok(enq_ids() == ["b1"], "(a) Post: one tally_post_enqueue for A/1 (%s)" % enq_ids())
    s = E(ST, "b1")
    ok(s["exp"] and s["by"] and s["vch"] == "26303" and s["inT"], "(a) A/1 marked posted by Tally's reply: exportedAt, postByReply, e.tally.vch 26303, billInTally (%s)" % s)
    ok(not s["unc"] and s["err"] == "" and s["bucket"] == "intally" and s["state"] == "In Tally", "(a) no postUnconfirmed, no postError, not under attention, 'In Tally' (%s)" % s)
    ok(s["who"] == "Me Here" and s["company"] == "GARG SHEKHAR & COMPANY", "(a) the mark names the company and who pressed Post (%s / %s)" % (s["who"], s["company"]))
    rl = txt("#app [data-post-result]")
    ok("1 in Tally (Tally's reply)" in rl and "not yet read back" not in rl and "failed" not in rl, "(a) the run line: '1 in Tally (Tally's reply)' (%s)" % rl)
    ok(E("postWord({ok: true, byReply: true, verified: false, vchId: '26303'})").replace("’", "'") == "Posted to Tally (Tally's reply)", "(a) postWord: 'Posted to Tally (Tally's reply)' (%s)" % E("postWord({ok: true, byReply: true, verified: false})"))
    ok("b1" not in E("Array.from(document.querySelectorAll('#app [data-post-panel] [data-bill-row]')).map(r => r.getAttribute('data-bill-row'))") and E("postCounts(S.coId).attention") == 0,
       "(a) A/1 not under To post or Errors; nothing needs attention (%s)" % E("postCounts(S.coId)"))
    E("() => { S.tab = 'invoices'; S.reviewTable = false; S.filter = 'approved'; S.selected = 'b1'; S.drawerOpen = true; render(); }"); pg.wait_for_timeout(600)
    stamp, line = txt("#app .stampmark"), txt("#app [data-posted-line]")
    ok("Sent to Tally" in stamp and line.startswith("Posted to Tally: voucher id 26303") and "· GARG SHEKHAR & COMPANY ·" in line and "· by Me Here" in line,
       "(a) the drawer: 'Sent to Tally' and 'Posted to Tally: voucher id 26303 · …' (%s | %s)" % (stamp, line))
    E("() => goStep('post', 'bills')"); pg.wait_for_timeout(500)
    # ---------------------------------------------------------------- (b) a batch of 3
    E("""() => { window.__mk("t1", "Batch One Co", "T/1", 1000); window.__mk("t2", "Batch Two Co", "T/2", 2000); window.__mk("t3", "Batch Three Co", "T/3", 3000); window.__rpc = []; refreshStats(S.coId); render(); }""")
    pg.wait_for_timeout(400); tab("topost")
    press_post()
    ok(sorted(enq_ids()) == ["t1", "t2", "t3"], "(b) Post 3: one posting of the three (%s)" % enq_ids())
    bs = [E(ST, i) for i in ("t1", "t2", "t3")]
    ok(all(x["exp"] and x["by"] and x["inT"] and x["batchEnd"] == "1300" and x["batchN"] == 3 and x["vch"] is None and not x["unc"] and x["err"] == "" for x in bs),
       "(b) each bill marked by Tally's reply, batch ending 1300 (3), none with a voucher id (%s)" % bs)
    E("() => { S.tab = 'invoices'; S.reviewTable = false; S.filter = 'approved'; S.selected = 't2'; S.drawerOpen = true; render(); }"); pg.wait_for_timeout(600)
    line = txt("#app [data-posted-line]")
    ok(line.startswith("Posted to Tally, batch ending Tally id 1300") and "voucher id" not in line, "(b) the drawer: 'Posted to Tally, batch ending Tally id 1300' (%s)" % line)
    E("() => goStep('post', 'bills')"); pg.wait_for_timeout(500)
    ok("3 in Tally (Tally's reply)" in txt("#app [data-post-result]"), "(b) the run line: '3 in Tally (Tally's reply)' (%s)" % txt("#app [data-post-result]"))
    # ---------------------------------------------------------------- (c) reconcile from a finished posting of the cloud
    E("""() => { window.__mk("c1", "Cloud Only Co", "C/1", 4000); window.__mk("c2", "Review Co", "R/1", 5000);
      const co = CO(), b = B(); co.bankAccounts = [{id: "ba1", bank: "HDFC", last4: "1111", ledger: "HDFC BANK"}]; choiceConfirm(co, "bank:ba1", "HDFC BANK");
      b.stmts = [{id: "s1", acctId: "ba1", bank: "HDFC", acct: "1111", from: "2026-07-01", to: "2026-07-31", opening: 0, closing: 0}]; b.cur = "s1";
      b.rows = [{id: "s1-0", fp: "q0", date: "2026-07-02", narr: "NEFT DR OFFICE RENT JULY", debit: 1000, credit: 0, ledger: "Office Rent", state: "ready", userSet: true, dec: {name: "Office Rent"}},
                {id: "s1-1", fp: "q1", date: "2026-07-03", narr: "NEFT DR OFFICE RENT AUG", debit: 1200, credit: 0, ledger: "Office Rent", state: "ready", userSet: true, dec: {name: "Office Rent"}}];
      const now = new Date().toISOString(); Ledgers.take(S.coId, {list: window.__leds.map(l => ({name: l.name, group: l.parent})), src: "file", at: now, srcAt: now});
      refreshStats(S.coId); window.__rpc = []; window.__toasts = []; render(); }""")
    pg.wait_for_timeout(400)
    s = E(ST, "c1")
    ok(not s["exp"] and s["bucket"] == "ready", "(c) C/1 approved, never sent from here: ready (%s)" % s["bucket"])
    E("""() => { const G = "GARG SHEKHAR & COMPANY";
      window.__jobs.unshift({id: "jRc", client_id: S.coId, company: G, status: "done", done: 2, n: 2, message: "Posted 2 of 2 (Tally's reply)", checking: false, created_by: "u-2",
        created_at: "2026-10-04T05:00:00Z", updated_at: "2026-10-04T05:00:40Z", entry_ids: ["c1"], results: [{id: "c1", ok: true, byReply: true, verified: false, vchId: "26310", batchN: 1, batchEnd: "26310", lastVchId: "26310",
          state: "posted", vchDate: "20260701", vchType: "Journal", sentAt: "2026-10-04T05:00:30Z", created: 1}], items: [{id: "c1", state: "posted"}]});
      window.__jobs.unshift({id: "jRv", client_id: S.coId, company: G, status: "failed", done: 0, n: 1, message: "Posted 0 of 1; 1 needs review", checking: false, created_by: "u-2",
        created_at: "2026-10-04T05:01:00Z", updated_at: "2026-10-04T05:01:40Z", entry_ids: ["c2"], results: [{id: "c2", ok: false, needsReview: true, accepted: true, message: "Tally's reply: exceptions 1", exceptions: 1}], items: [{id: "c2", state: "needs_review"}]});
      window.__jobs.unshift({id: "jBk", client_id: S.coId, company: G, status: "done", done: 1, n: 1, message: "Posted 1 of 1 (Tally's reply)", checking: false, created_by: "u-1",
        created_at: "2026-10-04T05:02:00Z", updated_at: "2026-10-04T05:02:40Z", entry_ids: ["s1-1"], results: [{id: "s1-1", ok: true, byReply: true, verified: false, vchId: "26311", batchN: 1, batchEnd: "26311",
          state: "posted", vchDate: "20260703", vchType: "Payment", sentAt: "2026-10-04T05:02:30Z", created: 1}], items: [{id: "s1-1", state: "posted"}]}); }""")
    E("() => CloudJobs.load(true)"); pg.wait_for_timeout(800)
    s = E(ST, "c1")
    ok(s["exp"] and s["by"] and s["vch"] == "26310" and s["inT"] and s["company"] == "GARG SHEKHAR & COMPANY" and s["at"] == "2026-10-04T05:00:30Z" and s["who"] == "Ravi Staff",
       "(c) after CloudJobs.load: C/1 marked posted, voucher id 26310, the job's company, sentAt, by Ravi Staff (%s)" % s)
    ok(E("D().entries.c1.exportedAt") == "2026-10-04T05:00:30Z", "(c) exportedAt is when it was sent (%s)" % E("D().entries.c1.exportedAt"))
    s2 = E(ST, "c2")
    ok(not s2["exp"] and not s2["by"] and not s2["inT"], "(c) the needsReview one (ok false) is not marked (%s)" % s2)
    r1 = E("(() => { const r = B().rows.find(x => x.id === 's1-1'); return {st: r.state, by: r.postByReply === true, vch: r.tally && String(r.tally.vch), who: r.tally && r.tally.by, err: r.postError || ''}; })()")
    ok(r1["st"] == "sent" and r1["by"] and r1["vch"] == "26311" and r1["who"] == "Anshul" and r1["err"] == "", "(c) the bank line in the job marked sent, Tally id 26311, by Anshul (%s)" % r1)
    ok(E("B().rows.find(x => x.id === 's1-0').state") == "ready", "(c) the other bank line stays ready")
    tt = [t for t in E("window.__toasts") if "marked from Tally" in t.replace("’", "'")]
    ok(len(tt) == 1 and re.match(r"^2 postings marked from Tally's reply", tt[0].replace("’", "'")), "(c) one toast: '2 postings marked from Tally's reply' (%s)" % tt)
    snap = E("JSON.stringify([D().entries.c1, D().entries.c2, B().rows])")
    E("() => { window.__toasts = []; return CloudJobs.load(true); }"); pg.wait_for_timeout(800)
    ok(E("JSON.stringify([D().entries.c1, D().entries.c2, B().rows])") == snap and not [t for t in E("window.__toasts") if "marked from Tally" in t.replace("’", "'")],
       "(c) a second load changes nothing and says nothing")
    ok(not [f for f, a in E("window.__rpc") if f == "tally_post_enqueue"], "(c) the reconcile queued nothing")
    # round 17: opening the client marks a bill whose posting the cloud finished while it was not open (CloudJobs loaded already)
    E("() => { S.view = 'home'; S.tab = 'dash'; render(); }"); pg.wait_for_timeout(300)
    E("""() => { window.__mk("c3", "Opened Later Co", "O/1", 3000); { const e3 = D().entries.c3; if (e3.status !== "approved"){ e3.status = "approved"; e3.approvedAt = new Date().toISOString(); Store.saveEntry(S.coId, e3); } }
      window.__jobs.unshift({id: "jOp", client_id: S.coId, company: "GARG SHEKHAR & COMPANY", status: "done", done: 1, n: 1, message: "Posted 1 of 1 (Tally's reply)", checking: false, created_by: "u-2",
        created_at: "2026-10-04T05:03:00Z", updated_at: "2026-10-04T05:03:40Z", entry_ids: ["c3"], results: [{id: "c3", ok: true, byReply: true, verified: false, vchId: "26312", batchN: 1, batchEnd: "26312",
          state: "posted", vchDate: "20260701", vchType: "Journal", sentAt: "2026-10-04T05:03:30Z", created: 1}], items: [{id: "c3", state: "posted"}]});
      CloudJobs.list = window.__jobs.map(j => JSON.parse(JSON.stringify(j))); }""")
    ok(not E(ST, "c3")["exp"] and E("D().entries.c3.status") == "approved", "(c) O/1 approved, not marked before the client is opened")
    E("() => openCompany(S.coId)"); pg.wait_for_timeout(800)
    s3 = E(ST, "c3")
    ok(s3["exp"] and s3["by"] and s3["vch"] == "26312" and s3["inT"], "(c) opening the client marks O/1 posted by Tally's reply, voucher id 26312 (%s)" % s3)
    ok(not [f for f, a in E("window.__rpc") if f == "tally_post_enqueue"], "(c) opening the client queued nothing")
    E("() => goStep('post', 'bills')"); pg.wait_for_timeout(500)
    # ---------------------------------------------------------------- (d) a second Post is refused for the marked bills
    E("() => { window.__rpc = []; render(); }"); pg.wait_for_timeout(300)
    tab("topost")
    if pg.locator("#app [data-post-main]").count() and not pg.locator("#app [data-post-main]").is_disabled(): press_post()
    E("() => postAllToTally({kind: 'bill', id: 'b1'})"); pg.wait_for_timeout(600)
    E("() => postAllToTally({kind: 'bill', id: 'c1'})"); pg.wait_for_timeout(600)
    E("() => postBillsToTally().catch(() => {})"); pg.wait_for_timeout(2500)
    sent_again = [i for i in enq_ids() if i in ("b1", "t1", "t2", "t3", "c1")]
    ok(not sent_again, "(d) Post, postAllToTally and the legacy postBillsToTally() send none of the marked bills again (%s)" % enq_ids())
    ok("c2" not in enq_ids(), "(d) nor the one whose posting needs review (%s)" % enq_ids())
    # ---------------------------------------------------------------- (e) bank: a byReply ok result through postBankToTally
    E("""() => { window.ensureTallyCompany = async () => "GARG SHEKHAR & COMPANY"; window.syncLedgersFromTally = async () => true; window.tallyCall = async () => ({vouchers: []});
      B().ledgers.live = true; B().ledgers.importedAt = new Date().toISOString();
      CloudPost.run = async (cid, payload) => { window.__cpRun = payload.vouchers.map(v => v.id); const at = new Date().toISOString();
        return {ok: true, company: "GARG SHEKHAR & COMPANY", viaCloud: true, checking: false, job: {id: "jBank", status: "done", message: "Posted 1 of 1 (Tally's reply)"},
          results: payload.vouchers.map(v => ({id: v.id, ok: true, byReply: true, verified: false, vchId: "26320", batchN: 1, batchEnd: "26320", state: "posted", vchDate: "20260702", vchType: "Payment", sentAt: at, created: 1}))}; }; }""")
    E("() => postBankToTally(['s1-0'])"); pg.wait_for_timeout(1500)
    r0 = E("(() => { const r = B().rows.find(x => x.id === 's1-0'); const rep = B().postReport || {}; return {st: r.state, by: r.postByReply === true, vch: r.tally && String(r.tally.vch), err: r.postError || '', chk: !!r.checking, posted: rep.posted, failed: (rep.failed || []).map(f => f.msg)}; })()")
    ok(E("window.__cpRun || []") == ["s1-0"], "(e) the bank line went through Bridge.post to the cloud (%s)" % E("window.__cpRun || []"))
    ok(r0["st"] == "sent" and r0["by"] and r0["vch"] == "26320" and r0["err"] == "" and not r0["chk"] and r0["posted"] == 1 and not r0["failed"],
       "(e) a byReply ok result: the line is sent, r.tally.vch 26320, no postError, nothing failed (%s)" % r0)
    # round 18 (owner, 04-Oct-2026: reading is prospective only): bridge 2.1.9 refuses /vouchers with ReadDays off. The
    # posting's pre-check for bills already in Tally then says "check not possible" and the posting goes on (FinCom's own
    # checks stand: its records and the id lock); it never fails the posting
    E("""() => { window.__mk("f1", "Alpha Consultants", "F/1", 1500); window.__tcOld = window.tallyCall; window.__postedIds = [];
      window.tallyCall = async (co, path) => { if (/^\/vouchers/.test(path)) throw new Error("Reading entries from Tally is off on this computer (FinCom reads entries only as they change; history comes from the Day Book upload)."); return window.__tcOld(co, path); };
      window.__bpOld = Bridge.post; Bridge.post = async (p) => { window.__postedIds = p.vouchers.map(v => v.id);
        return {ok: true, company: p.company, results: p.vouchers.map(v => ({id: v.id, ok: true, byReply: true, verified: false, vchId: "26400", batchN: 1, batchEnd: "26400", state: "posted", created: 1}))}; }; }""")
    E("() => postBillsToTally(['f1'])"); pg.wait_for_timeout(1200)
    rf = E("(() => ({ids: window.__postedIds, err: (S.billPost && S.billPost.error) || '', exp: !!D().entries.f1.exportedAt, note: (S.billPost && S.billPost.checkNote) || ''}))()")
    E("() => { window.tallyCall = window.__tcOld; Bridge.post = window.__bpOld; }")
    ok(rf["ids"] == ["f1"] and not rf["err"] and rf["exp"], "(f) with reading off on the bridge, the pre-check is skipped and the bill is posted (%s)" % rf)
    ok("could not be checked" in rf["note"], "(f) and the result says the check against Tally could not be made (%s)" % rf["note"])
    # round 17 (follow-up): the line posted by Tally's reply is done (not left on Ready), and the bank balance check does
    # not count it as "sent by the bridge, not read back" (the part that waits for a read after the posting stays)
    rt = E("(() => { const r = B().rows.find(x => x.id === 's1-0'); const q = Object.assign({}, r, {sentAt: ''}); return {tab: bankTabOf(r), nrb: bankNotReadBack([q], S.coId).length}; })()")
    ok(rt["tab"] == "done" and rt["nrb"] == 0, "(e) the line posted by Tally's reply is under Done, and not counted as not read back (%s)" % rt)
    # round 18 (owner, 04-Oct-2026: reading is prospective only): bridge 2.1.9's /ledgerlines answers from its copy; for dates
    # the copy does not hold it says so (readDays false, a note, no entries). That is "not checked", never "not in Tally":
    # (g1) the bank pre-check marks no posted line as gone, posts the ready line and says the check was not made;
    # (g2) the double-entry check does not say "All clear" and is not remembered as done; (g3) reading the bank book
    # from Tally keeps the bank book it had
    E("""() => { const b = B(); b.rows.push({id: "s1-2", fp: "q2", date: "2026-07-04", narr: "NEFT DR OFFICE RENT SEP", debit: 1300, credit: 0, ledger: "Office Rent", state: "ready", userSet: true, balOk: true, dec: {name: "Office Rent"}});
      b.gone = null; b.tallyLook = null; lsDel(wideCheckKey()); window.__cpRun = []; b.books[curStmt().acctId] = {entries: [{date: "2026-07-03", debit: 1200, credit: 0}], file: "kept", importedAt: "2026-10-01T00:00:00Z"};
      window.__paths = []; window.tallyCall = async (co, path) => (window.__paths.push(path), /^\/(ledgerlines|vouchers)/.test(path)) ? {ok: true, via: "copy", vouchers: [], readDays: false,
        note: "the copy here does not cover 20260619-20261004 for this ledger (no day file); reading entries from Tally is off on this computer, history comes from the Day Book upload"} : {vouchers: []}; }""")
    E("() => postBankToTally(['s1-2'])"); pg.wait_for_timeout(1500)
    g1 = E("(() => { const b = B(), r = b.rows.find(x => x.id === 's1-2'), r1 = b.rows.find(x => x.id === 's1-1'), rep = b.postReport || {}; return {gone: b.gone ? b.gone.ids : null, st: r.state, s1: r1.state, sent: window.__cpRun, note: rep.checkNote || '', wide: !!lsGet(wideCheckKey()), dup: !!S.dupFind}; })()")
    ok(not g1["gone"] and g1["s1"] == "sent", "(g1) a copy that does not cover the dates marks no posted line as no longer in Tally (%s)" % g1)
    ok(g1["sent"] == ["s1-2"] and g1["st"] == "sent" and not g1["dup"], "(g1) the ready line is posted (%s)" % g1)
    ok("could not be checked" in g1["note"] and not g1["wide"], "(g1) the report says Tally could not be checked, and the once-per-statement check is not taken as done (%s)" % g1)
    E("() => { S.view = 'company'; S.tab = 'bank'; render(); }"); pg.wait_for_timeout(300)
    E("() => findTallyDuplicates()"); pg.wait_for_timeout(800)
    g2 = E("(() => ({nc: (S.dupFind && S.dupFind.notChecked) || '', wide: !!lsGet(wideCheckKey()), txt: (document.querySelector('#app') || document.body).innerText}))()")
    ok(g2["nc"] and not g2["wide"], "(g2) the double-entry check says it was not made, and is not remembered as done (%s)" % {k: g2[k] for k in ("nc", "wide")})
    ok("All clear" not in g2["txt"] and "not checked" in g2["txt"].lower(), "(g2) the screen does not say All clear; it says not checked")
    E("() => { S.dupFind = null; }")
    g3 = E("(async () => { const n = await syncBankBookFromTally(true); const bk = B().books[curStmt().acctId]; return {n, file: bk && bk.file, len: bk && bk.entries.length}; })()")
    ok(g3["file"] == "kept" and g3["len"] == 1, "(g3) reading the bank book from Tally keeps the bank book it had (%s)" % g3)
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
