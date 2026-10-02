"""python3 run_post_tabs.py - Post to Tally in three tabs (plan piped-moseying-frost, item 1b): To post / Posted / Errors.
  To post: Ready to post (and what is on its way), the note of other entries ready;
  Posted:  the postings of FinCom's cloud that went through (CloudJobs.history), newest first, not folded away;
  Errors:  Needs your attention, the entries sent when Tally stopped answering ("Checking whether it reached Tally"),
           and the ones Tally refused.
Checked: each tab's rows and count (the counts are postCounts, the same as the step bar's badges and the dashboard); the
tab with work opens by itself (Errors when there are any); a posting moves To post -> Posted as FinCom's cloud updates
it (a made-up job update); one Tally refuses lands in Errors; one whose outcome is unknown is in Errors with "Checking
whether it reached Tally"; no entry is in two tabs; the tab chosen is kept for the client; status line on top always.
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
  TCloud.restAll = async (u) => /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : [];
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
    ok("Checking whether it reached Tally" in u1 and pg.locator('#app [data-post-panel="errors"] [data-bill-row="u1"]').get_attribute("data-attn-kind") == "unknown",
       "Errors: the entry sent when Tally stopped answering says 'Checking whether it reached Tally' (%s)" % u1[:120])
    ok(pg.locator('#app [data-post-panel="errors"] [data-bill-row="u1"] button[data-post-again], #app [data-post-panel="errors"] [data-bill-row="u1"] button[data-retry-bill]').count() == 0,
       "Errors: no way to post the unknown one again while it is looked for")
    x1 = txt('#app [data-post-panel="errors"] [data-bill-row="x1"]')
    ok("Voucher date is outside the period" in x1 and pg.locator('#app [data-post-panel="errors"] [data-bill-row="x1"]').get_attribute("data-attn-kind") == "refused",
       "Errors: the one Tally refused, with Tally's reason (%s)" % x1[:120])
    ok(pg.locator('#app [data-post-panel="errors"] [data-job="jD"] [data-retry]').count() == 1, "Errors: the posting still failed (jD), with Retry")
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
    ok("r2" in errs and "r2" not in tp and "does not exist" in txt('#app [data-post-panel="errors"] [data-bill-row="r2"]'), "refused: K/7 is under Errors with Tally's words, not under To post (%s | %s)" % (errs, tp))
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
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
