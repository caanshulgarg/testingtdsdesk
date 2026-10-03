"""python3 run_post_tabs.py - Post to Tally in three tabs (plan piped-moseying-frost, item 1b): To post / Posted / Errors.
  To post: Ready to post (and what is on its way), the note of other entries ready;
  Posted:  the postings of FinCom's cloud that went through (CloudJobs.history), newest first, not folded away;
  Errors:  Needs your attention, the entries sent when Tally stopped answering ("Checking whether it reached Tally"),
           and the ones Tally refused.
Checked: each tab's rows and count (the counts are postCounts, the same as the step bar's badges and the dashboard); the
tab with work opens by itself (Errors when there are any); a posting moves To post -> Posted as FinCom's cloud updates
it (a made-up job update); one Tally refuses lands in Errors; one whose outcome is unknown is in Errors with "Checking
whether it reached Tally"; no entry is in two tabs; the tab chosen is kept for the client; status line on top always.
Round 5 (03-Oct): an owner settles an entry Tally accepted but nobody confirmed (Mark posted / Not in Tally — release, each
asking for its text; staff see the words); a bill not found in Tally whose id the cloud still holds says an owner can
release it here (C6).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_tabs.py"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8271), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async () => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional"); choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY");
  const c2 = newCompany({name: "Other Client", gstin: "09AAAPZ1234A1Z5"}); S.companies[c2.id] = c2; S.data[c2.id] = {parties: {}, entries: {}, loaded: true}; c2.stats = {};
  window.__c2 = c2.id;
  const t = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.__t = t;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}];
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY", daysAt: new Date().toISOString(), state: {doneTo: "20261001", skipped: []}}]};
  const G = "GARG SHEKHAR & COMPANY";
  // the postings in FinCom's cloud:
  //   jC done (old2 in Tally): Posted; jD failed, nothing of it here: Errors (Retry, Dismiss);
  //   jU still running, u1 sent when Tally stopped answering (state unknown): Errors, "Checking whether it reached Tally";
  //   jX done, x1 refused by Tally (item failed): Errors
  window.__jobs = [
    {id: "jC", client_id: c.id, company: G, status: "done", done: 1, n: 1, message: "1 of 1 sent to Tally", created_at: t(300), updated_at: t(299), entry_ids: ["old2"], results: [{id: "old2", ok: true, verified: true}], items: [{id: "old2", state: "in_tally"}]},
    {id: "jD", client_id: c.id, company: G, status: "failed", done: 0, n: 1, message: "Ledger 'Professional Fees' does not exist", created_at: t(120), updated_at: t(119), entry_ids: ["old3"], results: []},
    {id: "jU", client_id: c.id, company: G, status: "running", done: 0, n: 1, message: "Checking whether it reached Tally", created_at: t(6), updated_at: t(5), entry_ids: ["u1"],
      results: [{id: "u1", ok: false, outcomeUnknown: true, state: "unknown", message: "Checking whether it reached Tally"}], items: [{id: "u1", state: "unknown", reason: "Checking whether it reached Tally", outcomeUnknown: true}]},
    {id: "jX", client_id: c.id, company: G, status: "done", done: 0, n: 1, message: "0 of 1 sent to Tally", created_at: t(30), updated_at: t(29), entry_ids: ["x1"],
      results: [{id: "x1", ok: false, message: "Voucher date is outside the period of the company"}], items: [{id: "x1", state: "failed", reason: "Voucher date is outside the period of the company"}]}];
  // tally_post_ids (migration-32; released_at from migration-37): the FinCom ids the cloud holds for the client's postings.
  // jD's old3 and jX's x1 were released (the job failed / the bridge said not in Tally); a row with live=true is still held
  window.__postIds = [{job_id: "jD", fincom_id: "old3", entry_id: "old3", live: false, released_at: t(118), released_why: "job failed"},
    {job_id: "jX", fincom_id: "x1", entry_id: "x1", live: false, released_at: t(28), released_why: "refused: Voucher date is outside the period of the company"}];
  window.__postIdsFail = "";
  TCloud.restAll = async (u) => { if (/^tally_post_ids/.test(u)){ if (window.__postIdsFail) throw new Error(window.__postIdsFail); window.__idsAsked = (window.__idsAsked || []).concat([u]); return JSON.parse(JSON.stringify(window.__postIds)); }
    return /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : []; };
  window.__rpc = [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    return /^tally_(want_update|post_enqueue|post_dismiss|post_undismiss|post_record)$/.test(fn) ? {ok: true} : null; };
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
  // approved a while ago (before the postings of the cloud that name them)
  const old = {approvedAt: t(400)};
  mk("r1", "Alpha Consultants", "A/1", 100000, old); mk("r2", "Kashi IT Solutions", "K/7", 20000, old);
  mk("u1", "Unknown Outcome Co", "U/1", 5000, old); mk("x1", "Refused Co", "X/1", 7000, old);
  // FA/ELEC/013: posted, then not found in the cloud copy: needs attention
  mk("fa", "FINGATE ADVISORY", "FA/ELEC/013", 25535, {approvedAt: t(400), exportedAt: "2026-09-29T03:58:55Z", postVerified: true, postedVia: "bridge", goneFromTally: "2026-10-02T10:04:00Z",
    tally: {at: "2026-09-29T03:58:55Z", guid: "g-66b4", vchDate: "20260701", vchType: "Journal", company: G}});
  // in Tally already: on no tab
  mk("in1", "Done Co", "D/1", 7000, {approvedAt: t(400), exportedAt: "2026-09-20T03:00:00Z", postVerified: true, postedVia: "bridge", tally: {at: "2026-09-20T03:00:00Z", guid: "g-1", vchDate: "20260701"}});
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
    pg.goto("http://localhost:8271/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); pg.wait_for_timeout(1200)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    num = lambda t: int((re.findall(r"\d+", t or "") or ["-1"])[0])
    TABS = ("topost", "posted", "errors")
    def tab(name):
        pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(300)
    def on():
        return E("(document.querySelector('#app [data-post-tabs] [aria-selected=\"true\"]') || {getAttribute: () => ''}).getAttribute('data-post-tab')")
    def badge(name):
        return num(txt('#app [data-post-tabs] [data-post-tab="%s"] [data-tab-n]' % name))
    def bills_in(name):
        tab(name)
        return sorted(E("Array.from(document.querySelectorAll('#app [data-post-panel] [data-bill-row]')).map(r => r.getAttribute('data-bill-row'))"))
    def entries_posted():
        tab("posted")
        return sorted(E("Array.from(document.querySelectorAll('#app [data-post-panel=\"posted\"] [data-job]')).flatMap(r => (r.getAttribute('data-entries') || '').split(' ').filter(Boolean))"))
    # ---- three tabs, the status line above them
    ok(pg.locator("#app [data-post-tabs] [data-post-tab]").count() == 3 and [E("(el => el.textContent)(document.querySelectorAll('#app [data-post-tab]')[%d])" % i).split(" ")[0] for i in range(3)] == ["To", "Posted", "Errors"],
       "three tabs: To post, Posted, Errors (%s)" % txt("#app [data-post-tabs]"))
    ok(E("(() => { const l = document.querySelector('#app [data-post-line]'), t = document.querySelector('#app [data-post-tabs]'); return !!(l && t && (l.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)); })()"),
       "the status line stays on top, above the tabs")
    # ---- the tab with work opens by itself: Errors
    ok(on() == "errors", "Errors opens by itself when there are errors (%s)" % on())
    # ---- each tab's rows
    errs = bills_in("errors")
    ok(errs == ["fa", "u1", "x1"], "Errors: FA/ELEC/013 (needs attention), the unknown one and the refused one (%s)" % errs)
    u1 = txt('#app [data-post-panel="errors"] [data-bill-row="u1"]')
    ok("Posted, not yet confirmed — checking whether it reached Tally" in u1 and pg.locator('#app [data-post-panel="errors"] [data-bill-row="u1"]').get_attribute("data-attn-kind") == "unknown",
       "Errors: the entry Tally took but the bridge could not confirm says 'Posted, not yet confirmed — checking whether it reached Tally' (%s)" % u1[:120])
    ok(pg.locator('#app [data-post-panel="errors"] [data-bill-row="u1"] button[data-post-again], #app [data-post-panel="errors"] [data-bill-row="u1"] button[data-retry-bill]').count() == 0,
       "Errors: no way to post the unknown one again while it is looked for")
    x1 = txt('#app [data-post-panel="errors"] [data-bill-row="x1"]')
    ok("Voucher date is outside the period" in x1 and pg.locator('#app [data-post-panel="errors"] [data-bill-row="x1"]').get_attribute("data-attn-kind") == "refused",
       "Errors: the one Tally refused, with Tally's reason (%s)" % x1[:120])
    ok(pg.locator('#app [data-post-panel="errors"] [data-job="jD"] [data-retry]').count() == 1, "Errors: the posting still failed (jD), with Retry (its id old3 is released in tally_post_ids)")
    ok(pg.locator('#app [data-post-panel="errors"] [data-bill-row="x1"] [data-post-again]').count() == 1, "Errors: the refused one (x1, released) has Post again")
    asked = E("window.__idsAsked || []")
    ok(asked and all("job_id=in.(" in u and "released_at" in u for u in asked[:1]), "tally_post_ids read for the client's postings (%s)" % asked[:1])
    ok(pg.locator('#app [data-post-panel="errors"] li').evaluate_all("ls => ls.every(l => l.querySelectorAll(':scope > .acts button').length <= 2)"), "Errors: at most two buttons a row")
    top = bills_in("topost")
    ok(top == ["r1", "r2"] and txt("#app [data-post-main]") == "Post 2 to Tally", "To post: the two ready bills, Post 2 to Tally (%s)" % top)
    tab("posted")
    hist = E("Array.from(document.querySelectorAll('#app [data-post-panel=\"posted\"] [data-job]')).map(r => r.getAttribute('data-job'))")
    ok(hist == ["jC"] and pg.locator("#app [data-post-panel='posted'] details").count() == 0 and "Posted" in txt('#app [data-post-panel="posted"] [data-job="jC"]'),
       "Posted: the posting that went through, shown (not folded under History) (%s)" % hist)
    # ---- counts: postCounts, the step bar's badges and the dashboard
    pc = E("postCounts(S.coId)")
    ok([badge(t) for t in TABS] == [pc["ready"], 1, pc["attention"]] and pc == {"ready": 2, "attention": 4},
       "tab counts from postCounts: To post %d, Posted %d, Errors %d (%s)" % (badge("topost"), badge("posted"), badge("errors"), pc))
    step_n = num(E("(document.querySelector('nav.sbar [data-step=post] [data-step-n]') || {}).textContent || ''"))
    attn_n = num(E("(document.querySelector('nav.sbar [data-step=post] [data-attn-n]') || {}).textContent || ''"))
    ok(step_n == badge("topost") and attn_n == badge("errors"), "the step bar's badges are the tabs' counts (%d, %d)" % (step_n, attn_n))
    ok(num(E("tallyStatus(CO()).short")) == badge("topost"), "the header chip says the same (%s)" % E("tallyStatus(CO()).short"))
    # ---- no entry in two tabs
    seen = {t: (bills_in(t) if t != "posted" else entries_posted()) for t in TABS}
    allids = [i for t in TABS for i in seen[t]]
    ok(len(allids) == len(set(allids)) and "in1" not in allids and set(allids) >= {"r1", "r2", "fa", "u1", "x1"}, "every entry in exactly one tab (%s)" % seen)
    # ---- the chosen tab is kept for the client
    tab("posted"); E("() => { goStep('review', 'bills'); }"); pg.wait_for_timeout(300); E("() => { goStep('post', 'bills'); }"); pg.wait_for_timeout(400)
    ok(on() == "posted", "the tab chosen is kept when the client's page is opened again (%s)" % on())
    E("(id) => openCompany(id).then(() => goStep('post', 'bills'))", E("window.__c2")); pg.wait_for_timeout(700)
    ok(on() == "topost", "another client with nothing in error opens on To post (%s)" % on())
    E("(id) => openCompany(id).then(() => goStep('post', 'bills'))", cid); pg.wait_for_timeout(700)
    ok(on() == "posted", "and back to the first client: its own tab again (%s)" % on())
    # ---- a posting moving To post -> Posted, live (FinCom's cloud updates the job)
    tab("topost")
    E("""() => { window.__jobs.unshift({id: "jN", client_id: S.coId, company: "GARG SHEKHAR & COMPANY", status: "running", done: 0, n: 1, message: "Posting", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      entry_ids: ["r1"], results: [], items: [{id: "r1", state: "sending"}]}); CloudJobs.changed(); }""")
    pg.wait_for_timeout(1500)
    ok(bills_in("topost") == ["r2"] and "On its way to Tally: A/1" in txt("#app [data-post-sending]") and badge("topost") == 1,
       "a posting going on: A/1 leaves the table, 'On its way to Tally: A/1', To post 1 (%s)" % txt("#app [data-post-sending]"))
    E("""() => { const j = window.__jobs[0]; j.status = "done"; j.done = 1; j.message = "1 of 1 sent to Tally"; j.updated_at = new Date().toISOString();
      j.results = [{id: "r1", ok: true, verified: true, vchNumber: "A/1"}]; j.items = [{id: "r1", state: "in_tally"}]; CloudJobs.changed(); }""")
    pg.wait_for_timeout(1500)
    tp, po = bills_in("topost"), entries_posted()
    hist = E("Array.from(document.querySelectorAll('#app [data-post-panel=\"posted\"] [data-job]')).map(r => r.getAttribute('data-job'))")
    ok(tp == ["r2"] and "r1" in po and hist[0] == "jN" and pg.locator("#app [data-post-sending]").count() == 0 and badge("posted") == 2,
       "done: A/1 is under Posted, newest first, and not under To post (%s | %s | %s)" % (tp, po, hist))
    # ---- refused: lands in Errors
    E("""() => { window.__jobs.unshift({id: "jR", client_id: S.coId, company: "GARG SHEKHAR & COMPANY", status: "running", done: 0, n: 1, message: "Posting", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      entry_ids: ["r2"], results: [], items: [{id: "r2", state: "sending"}]}); CloudJobs.changed(); }""")
    pg.wait_for_timeout(1500)
    E("""() => { const j = window.__jobs[0]; j.status = "failed"; j.message = "Tally refused 1 entry"; j.updated_at = new Date().toISOString();
      j.results = [{id: "r2", ok: false, message: "Ledger 'Kashi IT Solutions' does not exist"}]; j.items = [{id: "r2", state: "failed", reason: "Ledger 'Kashi IT Solutions' does not exist"}]; CloudJobs.changed(); }""")
    pg.wait_for_timeout(1500)
    errs, tp = bills_in("errors"), bills_in("topost")
    tab("errors"); r2t = txt('#app [data-post-panel="errors"] [data-bill-row="r2"]')
    ok("r2" in errs and "r2" not in tp and "does not exist" in r2t and pg.locator('#app [data-post-panel="errors"] [data-job="jR"] [data-bill-row="r2"]').count() == 1,
       "refused: K/7 is under Errors with Tally's words (inside its failed posting), not under To post (%s | %s | %s)" % (errs, tp, r2t[:100]))
    # item 7: Post again / Retry only once the entry's FinCom id is released (tally_post_ids.live = false or released_at);
    # until the bridge has said so, the words "Waiting for the bridge to confirm it is not in Tally" and no button
    E("""() => { window.__postIds.push({job_id: "jR", fincom_id: "r2", entry_id: "r2", live: true, released_at: null, released_why: null}); PostIds.load(S.coId, true); }"""); pg.wait_for_timeout(600)
    jr = txt('#app [data-post-panel="errors"] [data-job="jR"]')
    ok("Waiting for the bridge to confirm it is not in Tally" in jr and pg.locator('#app [data-post-panel="errors"] [data-job="jR"] [data-retry], #app [data-post-panel="errors"] [data-job="jR"] [data-post-again]').count() == 0,
       "7. the id still held: 'Waiting for the bridge to confirm it is not in Tally', no Retry, no Post again (%s)" % jr[:160])
    E("""() => { const r = window.__postIds.find(x => x.fincom_id === "r2"); r.live = false; r.released_at = new Date().toISOString(); r.released_why = "not in Tally"; PostIds.load(S.coId, true); }"""); pg.wait_for_timeout(600)
    jr = txt('#app [data-post-panel="errors"] [data-job="jR"]')
    ok("Waiting for the bridge" not in jr and pg.locator('#app [data-post-panel="errors"] [data-job="jR"] [data-retry]').count() == 1, "7. released by the bridge: Retry is back (%s)" % jr[:120])
    # round 14c (C3): Retry refused (the cloud's answer): the refusal is on the row, not a toast only; Retry stays for another try
    E("""() => { window.__rpc1 = TCloud.rpc; TCloud.rpc = async (fn, a) => { if (fn === "tally_post_enqueue") throw new Error("Only the firm's owner may queue a posting again"); return window.__rpc1(fn, a); }; }""")
    pg.click('#app [data-post-panel="errors"] [data-job="jR"] [data-retry]'); pg.wait_for_timeout(900)
    jr = txt('#app [data-post-panel="errors"] [data-job="jR"]')
    ok(pg.locator('#app [data-post-panel="errors"] [data-job="jR"] [data-retry-why]').count() == 1 and "Retry not possible: Only the firm's owner may queue a posting again" in jr and pg.locator('#app [data-post-panel="errors"] [data-job="jR"] [data-retry]').count() == 1,
       "C3. Retry refused: 'Retry not possible: <the cloud's words>' on the row, Retry still there (%s)" % jr[-160:])
    E("() => { TCloud.rpc = window.__rpc1; }")
    # tally_post_ids unreadable (RLS, an older cloud): as before, the buttons shown
    E("""() => { window.__postIdsFail = "permission denied for table tally_post_ids (42501)"; PostIds.load(S.coId, true); }"""); pg.wait_for_timeout(600)
    ok(pg.locator('#app [data-post-panel="errors"] [data-job="jR"] [data-retry]').count() == 1 and E("PostIds.readable") is False, "7. tally_post_ids unreadable: today's behaviour, Retry shown")
    E("""() => { window.__postIdsFail = ""; PostIds.readable = null; PostIds.load(S.coId, true); }"""); pg.wait_for_timeout(600)
    tab("topost")
    ok(txt("#app [data-post-empty]") == "Nothing waiting to post" and pg.locator("#app [data-post-main]").count() == 0, "To post: nothing waiting, no Post button")
    pc = E("postCounts(S.coId)")
    ok(badge("errors") == pc["attention"] and badge("topost") == pc["ready"] == 0, "the counts follow (%s)" % pc)
    seen = {t: (bills_in(t) if t != "posted" else entries_posted()) for t in TABS}
    allids = [i for t in TABS for i in seen[t]]
    ok(len(allids) == len(set(allids)), "still every entry in one tab only (%s)" % seen)
    # ---- the unknown one found in Tally: it leaves Errors
    E("""() => { const j = window.__jobs.find(x => x.id === "jU"); j.status = "done"; j.done = 1; j.updated_at = new Date().toISOString(); j.results = [{id: "u1", ok: true, verified: true, sameId: true}];
      j.items = [{id: "u1", state: "in_tally"}]; CloudJobs.changed(); }""")
    pg.wait_for_timeout(1500)
    ok("u1" not in bills_in("errors") and "u1" in entries_posted(), "the unknown one found in Tally: off Errors, under Posted")
    # ---- 03-Oct-2026 (owner's report): after a posting ended failed (one entry Tally took but the bridge could not confirm),
    # Post for a DIFFERENT bill did nothing on the page and queued nothing. Every press of Post must end in one of two
    # visible results: a job row ("Sent to Tally") or a named row on the Errors tab (what happened, what to do), never silence.
    E("""() => {
      const G = "GARG SHEKHAR & COMPANY", t = window.__t;
      // the Tally computer's ledgers in the cloud copy, so the bills' ledgers are known here
      window.__leds = ["Alpha Consultants", "Kashi IT Solutions", "New Bill Co", "Second Bill Co", "Third Bill Co", "Professional Charges", "TDS Payable - Professional"].map(n => ({name: n, parent: /Charges/.test(n) ? "Indirect Expenses" : /TDS/.test(n) ? "Duties & Taxes" : "Sundry Creditors", chain: []}));
      TCloud.restAll = async (u) => /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : /tally_ledgers/.test(u) ? JSON.parse(JSON.stringify(window.__leds)) : [];
      // FinCom's cloud: tally_post_enqueue makes the job row; the Tally computer finishes it at once (every entry verified)
      const rpc0 = TCloud.rpc;
      TCloud.rpc = async (fn, a) => { if (fn === "tally_post_enqueue" && a && a.p_payload && (a.p_payload.vouchers || []).length){ const ids = a.p_payload.vouchers.map(v => v.id);
          window.__jobs.unshift({id: a.p_id, client_id: a.p_client, company: G, status: "done", done: ids.length, n: ids.length, message: ids.length + " of " + ids.length + " sent to Tally", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            entry_ids: ids, results: ids.map(id => ({id, ok: true, verified: true, vchNumber: "V/" + id})), items: ids.map(id => ({id, state: "in_tally"}))}); window.__rpc.push([fn, {p_id: a.p_id, p_client: a.p_client, ids}]); CloudJobs.changed(); return {ok: true}; }
        if (fn === "tally_vouchers_in") return [];
        return rpc0(fn, a); };
      Cloud.api = async (p) => { const m = /tally_post_jobs\\?.*id=eq\\.([^&]+)/.exec(p); return m ? JSON.parse(JSON.stringify(window.__jobs.filter(j => j.id === m[1]))) : []; };
      window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
      Ledgers.st[S.coId] = null; delete Ledgers.busy[S.coId];
      const mk = (id, n, no, amt) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
        e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[S.coId].entries[e.id] = e; approve(e); e.approvedAt = t(400); return e; };
      mk("n1", "New Bill Co", "N/1", 30000); mk("n2", "Second Bill Co", "N/2", 40000); mk("n3", "Third Bill Co", "N/3", 50000);
      refreshStats(S.coId); render(); }""")
    pg.wait_for_timeout(500)
    tab("topost")
    ok(pg.locator('#app [data-post-panel="errors"], #app [data-post-tabs] [data-post-tab="errors"].bad').count() >= 1 and badge("errors") >= 1 and badge("topost") == 3, "an earlier failed posting is on the list (Errors %d) and three new bills are ready" % badge("errors"))
    def press_post(sel="#app [data-post-main]"):
        pg.click(sel); pg.wait_for_timeout(700)
        if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]')
        for i in range(30):
            pg.wait_for_timeout(300)
            if not E("!!(S.billPost && S.billPost.busy)") and not pg.locator('#confirmBox [data-cbx="yes"]').count(): break
        pg.wait_for_timeout(500)
    # 1. the plain press: a job row is made (the fake cloud sees the insert) and the bill is under Posted
    E("() => { window.__rpc = []; }")
    press_post()
    enq = [a for f, a in E("window.__rpc") if f == "tally_post_enqueue"]
    ok(len(enq) == 1 and sorted(enq[0]["ids"]) == ["n1", "n2", "n3"] and enq[0]["p_client"] == cid, "Post with an earlier failed posting on the list: tally_post_enqueue makes the job row (%s)" % enq)
    ok("in Tally (verified)" in txt("#app [data-post-result]") and set(entries_posted()) >= {"n1", "n2", "n3"}, "and the three bills are under Posted (%s)" % txt("#app [data-post-result]")[:80])
    # 2. the cause found by reading the path (src/js/59 postAllToTally, src/js/24 postBillsToTally): anything thrown before
    # the preview (the voucher's XML, the preview's own HTML) was an unhandled rejection: no dialog, no job, no message
    E("""() => { window.__vx = window.voucherXml; window.voucherXml = () => { throw new TypeError("Cannot read properties of undefined (reading 'lines')"); };
      const mk = (id, n, no, amt) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
        e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[S.coId].entries[e.id] = e; approve(e); e.approvedAt = window.__t(400); return e; };
      mk("n4", "New Bill Co", "N/4", 1000); refreshStats(S.coId); window.__rpc = []; render(); }""")
    pg.wait_for_timeout(400); tab("topost")
    press_post()
    row = txt('#app [data-post-panel="errors"] [data-attn-kind="post-refused"]')
    ok(on() == "errors" and pg.locator('#app [data-post-panel="errors"] [data-attn-kind="post-refused"]').count() == 1, "an error thrown on the way to Tally: the Errors tab opens with a named row (%s)" % row[:160])
    ok("TypeError" in row and "reading 'lines'" in row and ("What to do" in row or "what to do" in row.lower()) and "Nothing was sent" in row,
       "the row names the error, what happened (nothing was sent) and what to do (%s)" % row[:200])
    ok(not [a for f, a in E("window.__rpc") if f == "tally_post_enqueue"] and not E("!!(S.billPost && S.billPost.busy)") and E("!document.querySelector('#app [data-post-main]') || !document.querySelector('#app [data-post-main]').disabled"),
       "nothing was queued, the page is not left busy, and Post can be pressed again")
    # the same for an error thrown after "Loading ledgers" (postBillsToTally, before its own try): it used to leave the page busy for good
    E("""() => { window.voucherXml = window.__vx; window.__cb = window.autoMapCompanyLedgers; window.autoMapCompanyLedgers = () => { throw new RangeError("Invalid array length"); }; window.__rpc = []; render(); }""")
    tab("topost"); press_post()
    row = txt('#app [data-post-panel="errors"] [data-attn-kind="post-refused"]')
    ok(on() == "errors" and "RangeError" in row and not E("!!(S.billPost && S.billPost.busy)"), "an error after 'Loading ledgers': the named row, the page not left busy (%s)" % row[:160])
    E("() => { window.autoMapCompanyLedgers = window.__cb; }")
    # the row goes when the next posting works
    tab("topost"); E("() => { window.__rpc = []; }"); press_post()
    enq = [a for f, a in E("window.__rpc") if f == "tally_post_enqueue"]
    ok(len(enq) == 1 and enq[0]["ids"] == ["n4"] and pg.locator('#app [data-attn-kind="post-refused"]').count() == 0, "the next press posts, and the error row goes (%s)" % enq)
    # 3. a gate's refusal is a row too, never silence: the Tally company this client may post to is not confirmed
    E("""() => { const co = CO(); co.choices = Object.assign({}, co.choices || {}); window.__pt = co.choices.postTo; co.choices.postTo = Object.assign({}, co.choices.postTo || {}, {state: "guess"});
      const mk = (id, n, no, amt) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
        e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[S.coId].entries[e.id] = e; approve(e); e.approvedAt = window.__t(400); return e; };
      mk("n5", "New Bill Co", "N/5", 1000); refreshStats(S.coId); window.__rpc = []; render(); }""")
    tab("topost")
    # round 14c (C3): the gate's words (postToProblem) are beside the disabled Post button, not only in a toast or after a press
    why = txt("#app [data-post-why]")
    ok(pg.locator("#app [data-post-main]").count() == 1 and pg.locator("#app [data-post-main]").is_disabled() and "Confirm the Tally company" in why and not [a for f, a in E("window.__rpc") if f == "tally_post_enqueue"],
       "a gate's refusal (the Tally company not confirmed) is said beside the disabled Post button, nothing queued (%s)" % why[:120])
    E("() => { CO().choices.postTo = window.__pt; S.postStop = null; render(); }")
    # 4. an entry Tally took but the bridge could not confirm: "Posted, not yet confirmed — checking whether it reached Tally", no Retry or Post again
    E("""() => { window.__jobs.unshift({id: "jK", client_id: S.coId, company: "GARG SHEKHAR & COMPANY", status: "failed", done: 0, n: 1, message: "1 entry sent to Tally; could not confirm it", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      entry_ids: ["n5"], results: [{id: "n5", ok: false, outcomeUnknown: true, message: "Tally took it; not read back"}], items: [{id: "n5", state: "unknown", reason: "Tally took it; not read back"}]}); CloudJobs.changed(); }""")
    pg.wait_for_timeout(1500); tab("errors")
    k = txt('#app [data-post-panel="errors"] [data-bill-row="n5"]')
    ok("Posted, not yet confirmed — checking whether it reached Tally" in k and pg.locator('#app [data-post-panel="errors"] [data-bill-row="n5"] button').count() == 0,
       "Errors: 'Posted, not yet confirmed — checking whether it reached Tally', no button (%s)" % k[:160])
    # ---- round 5 (S3): an owner can settle an entry Tally accepted but nobody confirmed: "Mark posted (voucher no.)" ->
    # tally_post_job_mark_posted(job, id, vch, note), "Not in Tally — release (reason)" -> tally_post_id_release_owner(job, id,
    # why); both ask for the text first. A staff member sees the words only. A cloud without migration 36b says so.
    N5 = '#app [data-post-panel="errors"] [data-bill-row="n5"]'
    E("() => { S.account = {me: {role: 'staff'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400); tab("errors")
    ok("Posted, not yet confirmed" in txt(N5) and pg.locator(N5 + " button").count() == 0, "S3. a staff member: the words only, no button")
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400); tab("errors")
    ok(pg.locator(N5 + " [data-mark-posted]").count() == 1 and pg.locator(N5 + " [data-release-owner]").count() == 1 and "Mark posted" in txt(N5 + " [data-mark-posted]") and "release" in txt(N5 + " [data-release-owner]"),
       "S3. an owner: 'Mark posted (voucher no.)' and 'Not in Tally — release (reason)' (%s)" % txt(N5)[-120:])
    E("() => { window.__rpc = []; window.__toasts = []; }")
    pg.click(N5 + " [data-mark-posted]"); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox input#markVch").count() == 1, "S3. Mark posted asks for the voucher no. first")
    pg.fill("#confirmBox input#markVch", "26298"); pg.fill("#confirmBox input#markNote", "seen in the Day Book")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"]
    ok(calls == [["tally_post_job_mark_posted", {"p_job": "jK", "p_id": "n5", "p_vch": "26298", "p_note": "seen in the Day Book"}]], "S3. tally_post_job_mark_posted(job, id, voucher, note) (%s)" % calls)
    pg.click(N5 + " [data-release-owner]"); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox input#releaseWhy").count() == 1, "S3. release asks why first")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox input#releaseWhy").count() == 1 and pg.locator("#confirmBox .cbx-err").count() == 1 and not [c for c in E("window.__rpc") if c[0] == "tally_post_id_release_owner"], "S3. no reason: not sent, the box says so")
    pg.fill("#confirmBox input#releaseWhy", "not in Tally on 03-Oct"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__rpc") if c[0] == "tally_post_id_release_owner"]
    ok(calls == [["tally_post_id_release_owner", {"p_job": "jK", "p_id": "n5", "p_why": "not in Tally on 03-Oct"}]], "S3. tally_post_id_release_owner(job, id, why) (%s)" % calls)
    E("() => { window.__rpc0 = TCloud.rpc; TCloud.rpc = async (fn, a) => { if (/tally_post_id_release_owner|tally_post_job_mark_posted/.test(fn)) throw new Error('Could not find the function public.' + fn + ' in the schema cache (PGRST202)'); return window.__rpc0(fn, a); }; window.__toasts = []; }")
    pg.click(N5 + " [data-release-owner]"); pg.wait_for_timeout(300); pg.fill("#confirmBox input#releaseWhy", "x"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    ok(any("not ready for this yet (migration 36b)" in t for t in E("window.__toasts")), "S3. a cloud without migration 36b: 'FinCom's cloud is not ready for this yet (migration 36b)' (%s)" % E("window.__toasts")[-2:])
    E("() => { TCloud.rpc = window.__rpc0; }")
    # F11 (round 7): the buttons are for owners alone (the cloud accepts only an active owner), not a superadmin who is not
    # one; Mark posted needs the voucher number
    E("() => { S.account = {superadmin: true, me: {role: 'staff'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400); tab("errors")
    ok(pg.locator(N5 + " [data-mark-posted]").count() == 0, "F11. a superadmin who is not an owner of the firm: no buttons")
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; window.__rpc = []; render(); }"); pg.wait_for_timeout(400); tab("errors")
    pg.click(N5 + " [data-mark-posted]"); pg.wait_for_timeout(300); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox input#markVch").count() == 1 and pg.locator("#confirmBox .cbx-err").count() == 1 and not [c for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"], "F11. Mark posted without the voucher number: not sent, the box says so")
    pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(300)
    # ---- round 5 (C6): a bill posted, read afresh and not found, whose id FinCom's cloud still holds: it used to say
    # "Waiting for the bridge…" for good (nothing releases the id of a finished posting). Now: "Posted, not yet confirmed.
    # If it is not in Tally, an owner can release it here." with the owner's two buttons; a staff member sees the words
    E("""() => { window.__jobs.push({id: "jF", client_id: S.coId, company: "GARG SHEKHAR & COMPANY", status: "done", done: 1, n: 1, message: "1 of 1 sent to Tally", created_at: "2026-09-29T03:58:50Z", updated_at: "2026-09-29T03:58:56Z",
        entry_ids: ["fa"], results: [{id: "fa", ok: true, verified: true, guid: "g-66b4"}], items: [{id: "fa", state: "in_tally"}]});
      window.__postIds.push({job_id: "jF", fincom_id: "fa", entry_id: "fa", live: true, released_at: null, released_why: null});
      TCloud.restAll = async (u) => /^tally_post_ids/.test(u) ? JSON.parse(JSON.stringify(window.__postIds)) : /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : /tally_ledgers/.test(u) ? JSON.parse(JSON.stringify(window.__leds)) : [];
      PostIds.readable = null;
      PostCheck.st["fa"] = {busy: false, at: Date.now(), ok: true, found: null, readAt: new Date().toISOString(), why: "", via: "cloud"};
      CloudJobs.changed(); PostIds.load(S.coId, true); }"""); pg.wait_for_timeout(1500); tab("errors")
    FA = '#app [data-post-panel="errors"] [data-bill-row="fa"]'
    fa = txt(FA)
    ok(pg.locator(FA).get_attribute("data-attn-state") == "notfound" and "Posted, not yet confirmed. If it is not in Tally, an owner can release it here." in fa and "Waiting for the bridge" not in fa and pg.locator(FA + " [data-post-again]").count() == 0,
       "C6. the bill not found in Tally whose id is still held: 'Posted, not yet confirmed. If it is not in Tally, an owner can release it here.', no Post again (%s)" % fa[-160:])
    ok(pg.locator(FA + " [data-mark-posted]").count() == 1 and pg.locator(FA + " [data-release-owner]").count() == 1, "C6. the owner's two buttons are there too")
    E("() => { window.__rpc = []; }"); pg.click(FA + " [data-release-owner]"); pg.wait_for_timeout(300); pg.fill("#confirmBox input#releaseWhy", "not in the Day Book"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__rpc") if c[0] == "tally_post_id_release_owner"]
    ok(calls == [["tally_post_id_release_owner", {"p_job": "jF", "p_id": "fa", "p_why": "not in the Day Book"}]], "C6. release names the posting that holds the id (jF) (%s)" % calls)
    E("""() => { const r = window.__postIds.find(x => x.fincom_id === "fa"); r.live = false; r.released_at = new Date().toISOString(); r.released_by = "owner"; PostIds.load(S.coId, true); }"""); pg.wait_for_timeout(800)
    ok(pg.locator(FA + " [data-post-again]").count() == 1 and pg.locator(FA + " [data-release-owner]").count() == 0, "C6. released: Post again is back, the owner's buttons go")
    E("() => { S.account = {me: {role: 'staff'}, firm: {name: 'Firm'}}; const r = window.__postIds.find(x => x.fincom_id === 'fa'); r.live = true; r.released_at = null; PostIds.load(S.coId, true); }"); pg.wait_for_timeout(800)
    fa = txt(FA)
    ok("an owner can release it here" in fa and pg.locator(FA + " button[data-release-owner], " + FA + " button[data-mark-posted], " + FA + " [data-post-again]").count() == 0, "C6. a staff member: the words, no button (%s)" % fa[-120:])
    # ---- round 11 (owner item 6): an entry verified in Tally and deleted there by hand since. On the POSTED tab, each
    # entry of a finished posting is listed under it; an owner sees "Not in Tally — release (reason)" there too (the same
    # box and validation as on Errors) -> tally_post_id_release_owner(job, id, why); staff see nothing extra. Released:
    # the entry says so and the button goes (Post again comes back on Errors by the postIdReleased gating)
    JF = '#app [data-post-panel="posted"] [data-job="jF"]'
    tab("posted")
    ok(pg.locator(JF).count() == 1 and pg.locator(JF + " [data-posted-entry='fa']").count() == 1, "P6. Posted: the finished posting jF lists its entry fa (%s)" % txt(JF)[:120])
    ok(pg.locator(JF + " [data-release-owner]").count() == 0 and pg.locator("#app [data-post-panel='posted'] button[data-release-owner], #app [data-post-panel='posted'] button[data-mark-posted]").count() == 0,
       "P6. a staff member: nothing extra on Posted")
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; window.__rpc = []; render(); }"); pg.wait_for_timeout(400); tab("posted")
    ok(pg.locator(JF + " [data-posted-entry='fa'] [data-release-owner]").count() == 1 and "release" in txt(JF + " [data-release-owner]") and pg.locator(JF + " [data-mark-posted]").count() == 0,
       "P6. an owner: 'Not in Tally — release (reason)' on the Posted row's entry, no Mark posted (%s)" % txt(JF)[-120:])
    pg.click(JF + " [data-posted-entry='fa'] [data-release-owner]"); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox input#releaseWhy").count() == 1, "P6. it asks why first")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox input#releaseWhy").count() == 1 and pg.locator("#confirmBox .cbx-err").count() == 1 and not [c for c in E("window.__rpc") if c[0] == "tally_post_id_release_owner"], "P6. no reason: not sent, the box says so")
    pg.fill("#confirmBox input#releaseWhy", "deleted in Tally by hand"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__rpc") if c[0] == "tally_post_id_release_owner"]
    ok(calls == [["tally_post_id_release_owner", {"p_job": "jF", "p_id": "fa", "p_why": "deleted in Tally by hand"}]], "P6. tally_post_id_release_owner(job, id, why) from Posted (%s)" % calls)
    E("""() => { const r = window.__postIds.find(x => x.fincom_id === "fa"); r.live = false; r.released_at = new Date().toISOString(); r.released_by = "owner"; PostIds.load(S.coId, true); }"""); pg.wait_for_timeout(800); tab("posted")
    ok(pg.locator(JF + " [data-posted-entry='fa'][data-post-released]").count() == 1 and pg.locator(JF + " [data-release-owner]").count() == 0 and "released" in txt(JF + " [data-posted-entry='fa']").lower(),
       "P6. released: the entry says so, the button goes (%s)" % txt(JF + " [data-posted-entry='fa']"))
    tab("errors")
    ok(pg.locator(FA + " [data-post-again]").count() == 1 and pg.locator(FA + " [data-release-owner]").count() == 0, "P6. and Post again is back on Errors for fa")
    tab("posted")
    ok(pg.locator("#app [data-post-panel='posted'] [data-job='jC'] [data-posted-entry='old2']").count() == 1 and pg.locator("#app [data-post-panel='posted'] [data-job='jC'] [data-release-owner], #app [data-post-panel='posted'] [data-job='jC'] [data-post-released]").count() == 0,
       "P6. an older posting whose id the cloud never held (jC, old2): the entry listed, nothing to release, not called released")
    # ---- round 14c (C5a): a failed posting whose bill was deleted in FinCom since: no Retry, the row says why, and
    # CloudJobs.retry makes no tally_post_enqueue call
    E("""() => { const e = newEntry("Manual entry"); e.id = "del1"; Object.assign(e.x, {vendorName: "Gone Co", vendorGstin: "", invoiceNo: "G/1", invoiceDate: "2026-07-01", taxable: 900, total: 900});
      e.natureId = "professional"; e.partyLedger = "Gone Co"; e.expenseLedger = "Professional Charges"; S.data[S.coId].entries[e.id] = e; approve(e); e.approvedAt = window.__t(400);
      e.status = "deleted"; e.deleted = {at: "2026-10-02T09:30:00Z", by: "Anshul", reason: "uploaded twice", status: "approved"};
      window.__jobs.unshift({id: "jDel", client_id: S.coId, company: "GARG SHEKHAR & COMPANY", status: "failed", done: 0, n: 1, message: "Tally did not answer", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        entry_ids: ["del1"], results: [{id: "del1", ok: false, message: "Tally did not answer"}], items: [{id: "del1", state: "failed", reason: "Tally did not answer"}]});
      window.__rpc = []; CloudJobs.changed(); }"""); pg.wait_for_timeout(1500); tab("errors")
    JD = '#app [data-post-panel="errors"] [data-job="jDel"]'
    jd = txt(JD); want = "Retry not possible: this bill was deleted in FinCom on " + E("fmtDate('2026-10-02')") + " (uploaded twice). Restore it first."
    ok(pg.locator(JD).count() == 1 and pg.locator(JD + " [data-retry]").count() == 0 and pg.locator(JD + " [data-retry-why]").count() == 1 and want in jd,
       "C5a. a deleted bill's failed posting: no Retry, '%s' (%s)" % (want, jd[-200:]))
    E("() => CloudJobs.retry(window.__jobs.find(j => j.id === 'jDel'))"); pg.wait_for_timeout(600)
    ok(not [c for c in E("window.__rpc") if c[0] == "tally_post_enqueue"], "C5a. CloudJobs.retry on it makes no tally_post_enqueue call")
    # ---- round 14c (C7, owner item 4): "Send a FinCom reference id (REMOTEID) with each voucher (test)", owner only, off
    # by default, kept on the client; on, the voucher XML carries REMOTEID="<the entry's FinCom id>"; nothing else changes
    RB = '#app [data-remoteid-test] input[type="checkbox"]'
    tab("topost")
    ok(pg.locator(RB).count() == 1 and not pg.is_checked(RB) and "Send a FinCom reference id (REMOTEID) with each voucher (test)" in txt("#app [data-remoteid-test]"),
       "C7. an owner sees the tick box, off by default (%s)" % txt("#app [data-remoteid-test]"))
    xml_off = E("voucherXml(D().entries['r2'], CO())")
    ok("REMOTEID" not in xml_off and "TDSDesk:r2" in xml_off, "C7. off: no REMOTEID in the voucher XML (the TDSDesk tag as before)")
    pg.click(RB); pg.wait_for_timeout(400)
    xml_on = E("voucherXml(D().entries['r2'], CO())")
    ok(pg.is_checked(RB) and E("CO().postRemoteId === true") and re.search(r'<VOUCHER [^>]*REMOTEID="r2"[^>]*>', xml_on) is not None and xml_on.replace(' REMOTEID="r2"', "") == xml_off,
       "C7. on: the VOUCHER tag carries REMOTEID=\"r2\" and nothing else changes (%s)" % xml_on[:100])
    pg.click(RB); pg.wait_for_timeout(400)
    ok(not pg.is_checked(RB) and E("voucherXml(D().entries['r2'], CO())") == xml_off, "C7. off again: the XML as before")
    E("() => { S.account = {me: {role: 'staff'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(300); tab("topost")
    ok(pg.locator(RB).count() == 0, "C7. a staff member: no tick box")
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; render(); }")
    # Tally's reply per posting (created / altered / exceptions / ignored and the message), so a second import of the
    # same REMOTEID can be read as CREATED, ALTERED, COMBINED or IGNORED
    E("""() => { window.__jobs.unshift({id: "jT", client_id: S.coId, company: "GARG SHEKHAR & COMPANY", status: "done", done: 1, n: 1, message: "1 of 1 sent to Tally", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      entry_ids: ["in1"], results: [{id: "in1", ok: true, verified: true, created: 0, altered: 1, exceptions: 0, ignored: 0, message: "Altered in Tally: it existed already"}], items: [{id: "in1", state: "in_tally"}]}); CloudJobs.changed(); }"""); pg.wait_for_timeout(1500); tab("posted")
    rp = txt('#app [data-post-panel="posted"] [data-job="jT"] [data-post-reply]')
    ok("created 0" in rp and "altered 1" in rp and "exceptions 0" in rp and "ignored 0" in rp and "Altered in Tally: it existed already" in rp,
       "C7. the Posted row says Tally's reply: created 0 · altered 1 · exceptions 0 · ignored 0 · the message (%s)" % rp)
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
