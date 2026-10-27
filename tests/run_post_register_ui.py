"""python3 run_post_register_ui.py - Post to Tally, the bill's stamp and postReconcile read FinCom's posting register (migration
111, src/js/98-post-register.js), on the React build (TDSDESK_SITE=../app/dist-test):
  1. the tabs and their counts read the register: a bill whose posting the bridge reported as Tally's reply (the page alone would
     call it posted) is under Errors when the register says needs_review, with Tally's words and the two actions; one the bridge
     reported needing review is under In Tally when the register says the recorder found it; one Tally refused is under Errors.
     One count: the tab badges, postCounts and the rows agree.
  2. a bank line (no bill here) that needs review shows Tally's words and the two actions by its FinCom id
     (tally_post_register_mark_posted / tally_post_register_release); a bill's Mark posted goes to 55's RPC as before.
  3. the bill's "Posted to Tally" stamp reads the register (its MasterID), and shows none for a bill the register does not
     have in Tally, whatever the bill itself keeps.
  4. postReconcile marks a bill posted only from a record in Tally.
  5. a cloud without the register (the table missing): every one of these as before."""
import os, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8311), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async () => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional"); choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY");
  const t = (m) => new Date(Date.now() - m * 60000).toISOString();
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}, {user_id: "u-2", name: "Ravi"}];
  S.account = {me: {user_id: "u-1", role: "owner", name: "Anshul"}};
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY", daysAt: new Date().toISOString(), state: {doneTo: "20261001", skipped: []}}]};
  const G = "GARG SHEKHAR & COMPANY";
  const ok1 = (id, end) => ({id, ok: true, byReply: true, verified: false, created: 1, batchN: 1, batchEnd: end, vchId: end, sentAt: t(20), company: G});
  // what the bridge reported in each posting
  window.__jobs = [
    {id: "jA", client_id: c.id, company: G, status: "done", n: 1, created_at: t(60), updated_at: t(59), entry_ids: ["pa"], results: [ok1("pa", "777")], items: [{id: "pa", state: "posted"}]},
    {id: "jB", client_id: c.id, company: G, status: "done", n: 1, created_at: t(50), updated_at: t(49), entry_ids: ["pb"],
      results: [{id: "pb", ok: false, needsReview: true, accepted: true, created: 1, exceptions: 1, batchN: 2, batchEnd: "905", message: "Tally's reply: created 1 of 2"}], items: [{id: "pb", state: "needs_review"}]},
    {id: "jC", client_id: c.id, company: G, status: "done", n: 1, created_at: t(40), updated_at: t(39), entry_ids: ["pc"], results: [ok1("pc", "801")], items: [{id: "pc", state: "posted"}]},
    {id: "jK", client_id: c.id, company: G, status: "done", n: 1, created_at: t(30), updated_at: t(29), entry_ids: ["bank-17"], results: [ok1("bank-17", "990")], items: [{id: "bank-17", state: "posted"}]}];
  // what FinCom's posting register says (migration 111)
  const reg = (fid, state, more) => Object.assign({fincom_id: fid, entry_id: fid, kind: "bill", company: G, state, master_id: null, id_inferred: false, vch_type: "Journal", vch_no: "", vch_date: "2026-07-01", amount: 1000,
    tally_words: null, job_id: "j" + fid.slice(1, 2).toUpperCase(), source: "reply", changed_by: null, changed_at: t(10), queued_at: t(60), sent_at: t(59), settled_at: t(10)}, more || {});
  window.__reg = [
    reg("pa", "needs_review", {tally_words: "Tally's reply: created 2 of 3, exceptions 1: Ledger 'P72 Missing Ledger' does not exist!"}),
    reg("pb", "in_tally", {master_id: "905", source: "recorder"}),
    reg("pc", "refused", {job_id: "jC", tally_words: "Tally's reply: created 0 of 1, exceptions 1: Ledger 'Rent' does not exist!"}),
    reg("bank-17", "needs_review", {job_id: "jK", kind: "bank", vch_type: "Payment", tally_words: "Tally's reply: created 40 of 41, exceptions 1: Ledger 'Software' does not exist!"})];
  window.__regFail = "";
  window.__regAsked = [];
  TCloud.restAll = async (u) => {
    if (/^tally_post_register/.test(u)){ window.__regAsked.push(u); if (window.__regFail) throw new Error(window.__regFail); return JSON.parse(JSON.stringify(window.__reg)); }
    return /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : []; };
  window.__rpc = [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    return /^tally_(post_register_mark_posted|post_register_release|post_job_mark_posted|post_settle_ask|post_enqueue)$/.test(fn) ? {ok: true} : null; };
  Cloud.api = async () => [];
  CloudJobs.list = null; CloudJobs.at = 0; CloudJobs.tried = {};
  window.__dev = {id: "d-1", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", beat: {at: new Date().toISOString(), every: 30, tally: true, tallyState: "open",
    paused: false, notAnsweringSince: "", updating: false, lastRead: t(10), open: [G], companies: [{name: G, open: true, at: t(10), lastRead: t(10)}]}}};
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [window.__dev], cos: [{company: G, client_id: c.id, device_id: "d-1"}]};
  PostCheck.due = () => false;
  await openCompany(c.id);
  const mk = (id, n, no, amt, extra) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; approve(e); Object.assign(e, extra || {}); return e; };
  const old = {approvedAt: t(400)};
  mk("r1", "Alpha Consultants", "A/1", 100000, old);
  // pa: this browser marked it posted from the bridge's reply (voucher id 777): the register says needs review
  mk("pa", "Partial Batch Co", "PA/1", 5000, {approvedAt: t(400), exportedAt: t(58), postByReply: true, postedVia: "bridge", tally: {vch: "777", at: t(58), company: G, by: "Anshul"}});
  mk("pb", "Recorder Found Co", "PB/1", 6000, old);
  mk("pc", "Refused Co", "PC/1", 7000, old);
  TallyProof.at[c.id] = Date.now(); TallyProof.check = async () => 0;
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
    pg.goto("http://localhost:8311/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); pg.wait_for_timeout(1500)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    num = lambda t: int((re.findall(r"\d+", t or "") or ["-1"])[0])
    def tab(name): pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(350)
    def badge(name): return num(txt('#app [data-post-tabs] [data-post-tab="%s"] [data-tab-n]' % name))
    def rows(name):
        tab(name)
        return sorted(E("Array.from(document.querySelectorAll('#app [data-post-panel] [data-entry-row]')).map(r => (r.querySelector('[data-bill-row]') || r).getAttribute('data-bill-row') || r.getAttribute('data-row-key').split(':').pop())"))
    E("PostReg.load(S.coId, true)"); pg.wait_for_timeout(800)
    if pg.locator(".firmsetup-scrim button:has-text('Later')").count(): pg.click(".firmsetup-scrim button:has-text('Later')"); pg.wait_for_timeout(400)
    if os.environ.get("DBG"): print("DIALOG:", E("Array.from(document.querySelectorAll('[role=dialog], [data-state=open]')).map(d => d.className + ': ' + (d.innerText || '').slice(0, 300))"))
    ok(E("window.__regAsked.length > 0 && /client_id=eq\\./.test(window.__regAsked[0])") and E("postRegOn(S.coId)"), "the register is read for the client (%s)" % E("window.__regAsked[0] || ''")[:90])

    # ---------------------------------------------------------------- 1. tabs and counts from the register
    errs, posted = rows("errors"), rows("posted")
    tab("topost"); top = sorted(E("Array.from(document.querySelectorAll('#app [data-post-panel=topost] [data-post-row]')).map(r => r.getAttribute('data-post-row'))"))
    ok(errs == ["bank-17", "pa", "pc"], "1. Errors: pa (the register: needs review, though the bridge said Tally's reply), pc (refused) and the bank line (%s)" % errs)
    ok(posted == ["pb"], "1. In Tally: pb (the recorder found it, though the bridge's reply needed review) (%s)" % posted)
    ok(top == ["r1"], "1. Ready to post: r1 alone (%s)" % top)
    c = E("postCounts(S.coId)")
    ok(badge("errors") == 3 == c["attention"] and badge("topost") == 1 == c["ready"], "1. one count: the tab badges and postCounts agree (errors %d / %s, ready %d)" % (badge("errors"), c, badge("topost")))
    ok(E("postBucket(D().entries.pa, {jobs: postJobStates(S.coId)})") == "review" and E("postBucket(D().entries.pb, {jobs: postJobStates(S.coId)})") == "intally",
       "1. postBucket reads the register (pa review, pb intally)")
    tab("errors")
    PA = '#app [data-post-panel="errors"] [data-entry-row][data-row-key$=":pa"]'
    t = txt(PA)
    ok(t.startswith("Needs review") and "P72 Missing Ledger" in t and "Tally id 777" not in t and pg.locator(PA).get_attribute("data-reg") == "needs_review", "1. pa: 'Needs review' with Tally's words (%s)" % t[:200])
    ok(pg.locator(PA + " [data-mark-posted]").count() == 1 and pg.locator(PA + " [data-release-owner]").count() == 1 and pg.locator(PA + " [data-post-again]").count() == 0,
       "1. pa: the two actions (Mark posted, Not in Tally – post again), no Post again")
    PC = '#app [data-post-panel="errors"] [data-entry-row][data-row-key$=":pc"]'
    ok("Rent" in txt(PC) and pg.locator(PC).get_attribute("data-reg") == "refused", "1. pc: refused, with the ledger Tally named (%s)" % txt(PC)[:160])
    tab("posted")
    PB = '#app [data-post-panel="posted"] [data-entry-row][data-row-key$=":pb"]'
    ok(txt(PB).startswith("Posted, matched with Tally") and "Tally id 905" in txt(PB), "1. pb: In Tally, matched by FinCom (Tally id 905) (%s)" % txt(PB)[:200])

    # ---------------------------------------------------------------- 2. the bank line and the actions
    tab("errors")
    BK = '#app [data-post-panel="errors"] [data-entry-row][data-row-key$=":bank-17"]'
    t = txt(BK)
    ok("Software" in t and pg.locator(BK + ' [data-reg-action="mark"]').count() == 1 and pg.locator(BK + ' [data-reg-action="release"]').count() == 1,
       "2. the bank line needing review: Tally's words and the two actions (%s)" % t[:200])
    pg.click(BK + ' [data-reg-action="mark"]'); pg.wait_for_timeout(400)
    pg.fill("#confirmBox input#regVch", "2447"); pg.fill("#confirmBox input#regNote", "seen in the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(900)
    calls = [a for f, a in E("window.__rpc") if f == "tally_post_register_mark_posted"]
    ok(calls == [{"p_fincom_id": "bank-17", "p_vch": "2447", "p_note": "seen in the Day Book"}], "2. Mark posted of the bank line: tally_post_register_mark_posted by its FinCom id (%s)" % calls)
    pg.click(BK + ' [data-reg-action="release"]'); pg.wait_for_timeout(400)
    pg.fill("#confirmBox input#regWhy", "not in the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(900)
    calls = [a for f, a in E("window.__rpc") if f == "tally_post_register_release"]
    ok(calls == [{"p_fincom_id": "bank-17", "p_why": "not in the Day Book"}], "2. Not in Tally of the bank line: tally_post_register_release (the bridge looks first) (%s)" % calls)
    pg.click(PA + " [data-mark-posted]"); pg.wait_for_timeout(400)
    pg.fill("#confirmBox input#markVch", "26298"); pg.fill("#confirmBox input#markNote", "seen in the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(900)
    calls = [a for f, a in E("window.__rpc") if f == "tally_post_job_mark_posted"]
    ok(calls and calls[-1].get("p_job") == "jA" and calls[-1].get("p_id") == "pa" and calls[-1].get("p_vch") == "26298", "2. a bill's Mark posted: 55's RPC on its posting, as before (%s)" % calls)

    # ---------------------------------------------------------------- 3. the bill's stamp
    def stamp(id):
        E("(id) => { S.tab = 'invoices'; S.reviewTable = false; S.filter = 'approved'; S.selected = id; S.drawerOpen = true; render(); }", id); pg.wait_for_timeout(900)
        return txt("#app [data-posted-line]"), E("(id) => { const m = postMarkFor(S.coId, id, D().entries[id]); return m && m.register || null; }", id)
    s_pb, r_pb = stamp("pb")
    ok(s_pb.startswith("Posted to Tally: voucher id 905") and r_pb == "recorder", "3. pb's stamp from the register: Tally id 905, the recorder's (%s | %s)" % (s_pb, r_pb))
    s_pa, r_pa = stamp("pa")
    ok(s_pa == "" and "777" not in txt("#app"), "3. pa: no 'Posted to Tally' stamp (the register needs review), whatever the bill kept (%s)" % s_pa)
    ok(E("postMarkFor(S.coId, 'pa', D().entries.pa)") is None, "3. postMarkFor('pa') is null from the register")
    E("() => goStep('post', 'bills')"); pg.wait_for_timeout(500)

    # ---------------------------------------------------------------- 4. postReconcile
    n = E("postReconcile(S.coId, true)")     # the page ran it already when it opened: nothing more to mark
    st = E("() => ({pb: !!D().entries.pb.exportedAt, pa: !!D().entries.pa.exportedAt, pc: !!D().entries.pc.exportedAt, pbVch: (D().entries.pb.tally || {}).masterId || ''})")
    ok(n == 0 and st["pb"] and not st["pc"] and st["pbVch"] == "905", "4. postReconcile (run as the page opened) marked pb (in Tally by the register, MasterID 905) and not pc (refused) (%s %s)" % (n, st))

    # ---------------------------------------------------------------- 5. no register: as before
    E("() => { window.__regFail = 'relation \"public.tally_post_register\" does not exist (42P01)'; PostReg.readable = null; PostReg.by = {}; }")
    E("PostReg.load(S.coId, true)"); pg.wait_for_timeout(600); E("render()"); pg.wait_for_timeout(500)
    ok(E("PostReg.readable") is False and E("postRegStates(S.coId)") is None, "5. the table missing: the register is off")
    ok(E("postJobStates(S.coId).get('pa').st") == "posted" and E("postBucket(D().entries.pc, {jobs: postJobStates(S.coId)})") != "refused", "5. the tabs decide from the postings as before (pa posted by the bridge's reply)")
    s_pa, r_pa = stamp("pa")
    ok(s_pa.startswith("Posted to Tally: voucher id 777") and r_pa is None, "5. pa's stamp from the bill as before (%s)" % s_pa)
    ok(not errors, "no page error (%s)" % errors[:2])
    br.close()
srv.shutdown()
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
