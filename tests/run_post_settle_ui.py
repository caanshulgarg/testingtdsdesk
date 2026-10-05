"""python3 run_post_settle_ui.py - the owner's decision B of 05-Oct-2026 (migration 55) on Post to Tally: any member of the
firm who may post (owner or staff) settles a posting whose result is uncertain; a reason is required; the name and time
are kept and shown.
  1. a staff member sees "It is in Tally: mark posted (Tally id)" and "Not in Tally – post again" on the entry Tally may
     have (a viewer sees the words only);
  2. Mark posted: the Tally id and a reason are required (the box says so; nothing sent without them), then
     tally_post_job_mark_posted(job, id, vch, reason);
  3. Not in Tally – post again: a reason required, then tally_post_settle_ask(job, id, why); nothing is released or sent
     from the page (the FinCom Bridge looks in Tally first);
  4. while the bridge has not looked (or Tally could not be asked), the row says so in plain words: who asked, when, why,
     what the bridge said; the "post again" button is not offered twice; Mark posted stays;
  5. marked posted: the row says by whom and when (tally_post_marks); released after the bridge found it not there: who
     said so and when.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_settle_ui.py"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8279), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
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
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}, {user_id: "u-2", name: "Ravi"}, {user_id: "u-3", name: "Vina"}];
  S.account = {me: {role: "staff", user_id: "u-2", name: "Ravi"}, firm: {name: "Firm"}};
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY", daysAt: new Date().toISOString(), state: {doneTo: "20261001", skipped: []}}]};
  const G = "GARG SHEKHAR & COMPANY";
  window.__jobs = [{id: "jK", client_id: c.id, company: G, status: "done", checking: false, done: 0, n: 1, message: "1 entry sent to Tally; no answer", created_at: t(30), updated_at: t(29),
    entry_ids: ["n5"], results: [{id: "n5", ok: false, outcomeUnknown: true, sent: true, message: "Tally took it; no answer came"}], items: [{id: "n5", state: "unknown", reason: "Tally took it; no answer came", outcomeUnknown: true}]}];
  window.__postIds = [{job_id: "jK", fincom_id: "n5", entry_id: "n5", live: true, released_at: null, released_why: null}];
  window.__marks = []; window.__checks = [];
  TCloud.restAll = async (u) => {
    if (/^tally_post_ids/.test(u)) return JSON.parse(JSON.stringify(window.__postIds));
    if (/^tally_post_marks/.test(u)) return JSON.parse(JSON.stringify(window.__marks));
    if (/^tally_post_checks/.test(u)) return JSON.parse(JSON.stringify(window.__checks));
    return /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : []; };
  window.__rpc = []; window.__toasts = [];
  const toast0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); try { toast0(m); } catch (e) {} };
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    if (fn === "tally_post_settle_ask") return {ok: true, check: 41, state: "waiting"};
    return /^tally_(want_update|post_enqueue|post_dismiss|post_undismiss|post_record|post_job_mark_posted)$/.test(fn) ? {ok: true} : null; };
  Cloud.api = async () => [];
  CloudJobs.list = null; CloudJobs.at = 0; CloudJobs.tried = {};
  window.__dev = {id: "d-1", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", beat: {at: new Date().toISOString(), every: 30, tally: true, tallyState: "open",
    paused: false, notAnsweringSince: "", updating: false, lastRead: t(10), open: [G], companies: [{name: G, open: true, at: t(10), lastRead: t(10)}]}}};
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [window.__dev], cos: [{company: G, client_id: c.id, device_id: "d-1"}]};
  PostCheck.due = () => false;
  await openCompany(c.id);
  const e = newEntry("Manual entry"); e.id = "n5"; Object.assign(e.x, {vendorName: "New Bill Co", vendorGstin: "", invoiceNo: "N/5", invoiceDate: "2026-07-01", taxable: 1000, total: 1000});
  e.natureId = "professional"; e.partyLedger = "New Bill Co"; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; approve(e); e.approvedAt = t(400);
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
    pg.goto("http://localhost:8279/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); pg.wait_for_timeout(1200)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    def tab(name):
        pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(300)
    def reload_all():
        E("() => { CloudJobs.changed(); PostIds.load(S.coId, true); PostMarks.load(S.coId, true); PostChecks.load(S.coId, true); }"); pg.wait_for_timeout(1200)
    N5 = '#app [data-post-panel="errors"] [data-bill-row="n5"]'
    tab("errors")
    # 1. a staff member sees the two buttons
    ok(pg.locator(N5 + " [data-mark-posted]").count() == 1 and txt(N5 + " [data-mark-posted]") == "It is in Tally: mark posted (Tally id)" and
       pg.locator(N5 + " [data-repost-check]").count() == 1 and txt(N5 + " [data-repost-check]") == "Not in Tally – post again" and "settles this here" not in txt(N5),
       "1. a staff member: 'It is in Tally: mark posted (Tally id)' and 'Not in Tally – post again' (%s)" % txt(N5)[-200:])
    E("() => { S.account = {me: {role: 'viewer', user_id: 'u-3'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400); tab("errors")
    ok(pg.locator(N5 + " .acts button").count() == 0 and "A member of the firm who may post settles this here." in txt(N5), "1. a viewer: the words only (%s)" % txt(N5)[-120:])
    E("() => { S.account = {me: {role: 'staff', user_id: 'u-2', name: 'Ravi'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400); tab("errors")
    # 2. Mark posted: the Tally id and a reason required
    pg.click(N5 + " [data-mark-posted]"); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox input#markVch").count() == 1 and pg.locator("#confirmBox input#markNote").count() == 1 and "Reason" in txt("#confirmBox"), "2. Mark posted asks for the Tally id and a reason")
    pg.fill("#confirmBox input#markVch", "26298"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx-err").count() == 1 and "where you saw it" in txt("#confirmBox .cbx-err").lower() and not [c for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"],
       "2. no reason: nothing sent, the box says so (%s)" % txt("#confirmBox .cbx-err"))
    pg.fill("#confirmBox input#markNote", "seen in the Day Book of 01-Jul"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"]
    ok(calls == [["tally_post_job_mark_posted", {"p_job": "jK", "p_id": "n5", "p_vch": "26298", "p_note": "seen in the Day Book of 01-Jul"}]], "2. tally_post_job_mark_posted(job, id, vch, reason) (%s)" % calls)
    # 3. Not in Tally - post again: a reason required; the check asked, nothing released from the page
    E("() => { window.__rpc = []; }")
    pg.click(N5 + " [data-repost-check]"); pg.wait_for_timeout(400)
    box = txt("#confirmBox")
    ok(pg.locator("#confirmBox input#releaseWhy").count() == 1 and "looks in GARG SHEKHAR & COMPANY in Tally for this entry" in box and "sent again, once" in box, "3. the box says the bridge looks in Tally first (%s)" % box[:240])
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx-err").count() == 1 and not E("window.__rpc").__len__(), "3. no reason: nothing sent, the box says so")
    pg.fill("#confirmBox input#releaseWhy", "not in the Day Book of 01-Jul"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__rpc") if c[0].startswith("tally_post")]
    ok(calls == [["tally_post_settle_ask", {"p_job": "jK", "p_id": "n5", "p_why": "not in the Day Book of 01-Jul"}]], "3. tally_post_settle_ask(job, id, why) and nothing else (no release, no posting) (%s)" % calls)
    ok(any("looks in GARG SHEKHAR & COMPANY in Tally first" in t for t in E("window.__toasts")), "3. the toast says the bridge looks first (%s)" % E("window.__toasts")[-1:])
    # 4. the check waits: said in plain words, with who asked and when
    E("() => { window.__checks = [{id: 41, job_id: 'jK', entry_id: 'n5', state: 'waiting', why: 'not in the Day Book of 01-Jul', asked_by: 'u-1', asked_at: window.__t(3), tries: 2, last_words: 'Tally is busy or did not answer within 2 s; looked in again by itself'}]; }")
    reload_all(); tab("errors")
    n5 = txt(N5)
    ok("Checking Tally before it is sent again: Tally is busy or did not answer within 2 s; looked in again by itself" in n5 and "Asked by Anshul on" in n5 and "(not in the Day Book of 01-Jul)" in n5 and "nothing is sent until the bridge finds it is not there" in n5,
       "4. the row: checking Tally first, the bridge's words, asked by Anshul, when and why (%s)" % n5[-320:])
    ok(pg.locator(N5 + " [data-repost-check]").count() == 0 and pg.locator(N5 + " [data-mark-posted]").count() == 1 and pg.locator(N5 + " [data-check-waiting]").count() == 1,
       "4. while it waits: no second 'post again', Mark posted stays")
    # 5. marked posted: by whom and when
    E("""() => { const j = window.__jobs[0]; j.status = 'done'; j.results = [{id: 'n5', ok: true, verified: true, vchNumber: '26298', byOwner: true, by: 'Anshul', byOwnerAt: window.__t(1)}]; j.items = [{id: 'n5', state: 'in_tally', byOwner: true, by: 'Anshul'}];
      window.__checks[0].state = 'found'; window.__marks = [{job_id: 'jK', entry_id: 'n5', action: 'posted', vch: '26298', note: 'Found in GARG SHEKHAR & COMPANY by the FinCom Bridge', by_user: 'u-1', at: window.__t(1)}]; }""")
    reload_all(); tab("posted")
    row = txt('#app [data-post-panel="posted"] [data-posted-entry="n5"]')
    ok("Marked posted by Anshul on" in row and "26298" in row, "5. Posted: 'Marked posted by Anshul on <time>' with the Tally id (%s)" % row[-200:])
    # released after the bridge found it not there: who said so and when
    E("""() => { const j = window.__jobs[0]; j.status = 'done'; j.results = [{id: 'n5', ok: false, verified: false, state: 'notfound', byOwner: true, by: 'Ravi', byOwnerAt: window.__t(1), reason: 'Not in Tally: released by Ravi on 05-Oct-2026 (not in the Day Book of 01-Jul (the FinCom Bridge looked in GARG SHEKHAR & COMPANY on 05-Oct-2026 21:00 IST: not there))'}];
      j.items = [{id: 'n5', state: 'notfound', byOwner: true, by: 'Ravi'}];
      window.__postIds[0].live = false; window.__postIds[0].released_at = window.__t(1); window.__postIds[0].released_by = 'owner'; window.__postIds[0].released_why = 'not in the Day Book of 01-Jul (the FinCom Bridge looked in GARG SHEKHAR & COMPANY on 05-Oct-2026 21:00 IST: not there)';
      const e = S.data[S.coId].entries.n5; e.exportedAt = window.__t(40); Store.saveEntry(S.coId, e);
      window.__checks[0].state = 'notfound'; window.__marks = [{job_id: 'jK', entry_id: 'n5', action: 'released', vch: null, note: window.__postIds[0].released_why, by_user: 'u-2', at: window.__t(1)}]; }""")
    reload_all(); tab("errors")
    n5 = txt(N5)
    ok("You said it is not in Tally on" in n5 and "(not in the Day Book of 01-Jul (the FinCom Bridge looked in GARG SHEKHAR & COMPANY on 05-Oct-2026 21:00 IST: not there))" in n5, "5. released: 'You said it is not in Tally on <time>' and that the bridge looked (%s)" % n5[-260:])
    ok(not errors, "no page errors (%s)" % errors[:2])
    br.close()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
