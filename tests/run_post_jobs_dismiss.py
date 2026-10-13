"""python3 run_post_jobs_dismiss.py - the postings in FinCom's cloud on Post to Tally (request of 02-Oct-2026, second
pass of the same day): only a posting still failed, with something left to send, is under "Needs your attention", with
Retry and Dismiss; everything else is History, hidden behind "History (N)": a failed posting whose entries a later
posting put in is one line with it, "Posted 07:51 (second try)", without the old error (FinCom also dismisses it by
itself; the server checks it again); a successful posting never has Dismiss; one dismissed by hand is in History with who
dismissed it, and can be put back; no Refresh: a change from the live connection reads the list again.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_jobs_dismiss.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8226), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => {
  const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); c.postTo = "ZZ TEST"; S.companies[c.id] = c; S.coId = c.id; S.view = "company";
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  const mk = (id, inv, extra) => { const e = newEntry(inv + ".pdf"); e.id = id;
    e.x = Object.assign(e.x || {}, {vendorName: "FINGATE ADVISORY", invoiceNo: inv, invoiceDate: "2026-07-01", total: 23600, taxable: 20000});
    e.status = "approved"; Object.assign(e, extra || {}); S.data[c.id].entries[id] = e; return e; };
  mk("b1", "FA/2026-27/101", {status: "draft"}); mk("b3", "FA/2026-27/103", {status: "draft"});
  // b2: put in Tally another way (on the Tally computer itself), confirmed
  mk("b2", "FA/2026-27/102", {exportedAt: "2026-10-02T02:00:00Z", postVerified: true, postedVia: "bridge", tally: {guid: "g-2", vchDate: "20260701"}});
  const t = (h) => new Date(Date.now() - h * 3600000).toISOString(), c0 = c.id;
  const base = {client_id: c0, company: "ZZ TEST", created_by: "u-1", done: 0, n: 1, dismissed_at: null, dismissed_by: null, dismiss_note: null, dismiss_auto: false};
  window.__jobs = [
    Object.assign({}, base, {id: "j-late", status: "done", done: 1, message: "1 of 1 sent to Tally", created_at: t(3), updated_at: t(2.9), entry_ids: ["b1"], results: [{id: "b1", ok: true, verified: true, kind: "voucher", vchNumber: "FA/2026-27/101"}]}),
    Object.assign({}, base, {id: "j-fail1", status: "failed", message: "Tally did not answer", created_at: t(3.5), updated_at: t(3.4), entry_ids: ["b1"], results: []}),
    Object.assign({}, base, {id: "j-nothing", status: "failed", message: "Tally did not show ZZ TEST", created_at: t(5), updated_at: t(4.9), entry_ids: ["b2"], results: []}),
    Object.assign({}, base, {id: "j-left", status: "cancelled", message: "Cancelled", created_at: t(6), updated_at: t(5.9), entry_ids: ["b3", "b2"], n: 2, results: []}),
    Object.assign({}, base, {id: "j-old", status: "done", done: 1, message: "1 of 1 sent to Tally", created_at: t(240), updated_at: t(240), entry_ids: ["b9"], results: [{id: "b9", ok: true}]}),
    Object.assign({}, base, {id: "j-hid", status: "failed", message: "Tally did not show ZZ TEST for two minutes. Open it in TallyPrime and post again.", created_at: t(30), updated_at: t(30), entry_ids: ["b8"], results: [], dismissed_at: t(20), dismissed_by: "u-1", dismiss_note: "Dismissed"}),
    Object.assign({}, base, {id: "j-oldfail", status: "failed", message: "Old failure, never dealt with", created_at: t(480), updated_at: t(480), entry_ids: ["b7"], results: []})];
  window.__reads = 0; window.__rpc = [];
  TCloud.on = () => true; TCloud.has = () => true;
  // round 4: the page also reads tally_post_ids (item 7); only the postings list is counted and kept here
  TCloud.restAll = async (u) => { if (!/tally_post_jobs/.test(u)) return []; window.__reads++; window.__url = u; return JSON.parse(JSON.stringify(window.__jobs)); };
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, a]); if (fn === "tally_post_dismiss" && !a.p_auto){ const j = window.__jobs.find(x => x.id === a.p_id); j.dismissed_at = new Date().toISOString(); j.dismissed_by = "u-1"; j.dismiss_note = "Dismissed"; } return {ok: true}; };
  Cloud.st.members = [{user_id: "u-1", name: "Anshul"}]; CloudJobs.list = null; CloudJobs.at = 0; CloudJobs.tried = {};
  refreshStats(c.id); goStep("post"); render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8226/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(SETUP); pg.wait_for_timeout(1500)
    E = lambda js, *a: pg.evaluate(js, *a)
    att = "#app [data-post-attention]"
    # the page in three tabs (plan item 1b): Needs your attention is under Errors, History is the Posted tab
    def go_tab(name):
        pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(250)
    def st(jid):
        go_tab("errors"); return _st(jid)
    def hs(jid):
        go_tab("posted"); return _hs(jid)
    _st = lambda jid: E("(id) => { const r = document.querySelector('#app [data-post-attention] [data-job=\"' + id + '\"]'); return r ? r.innerText.replace(/\\s+/g, ' ') : ''; }", jid)
    _hs = lambda jid: E("(id) => { const r = document.querySelector('#app [data-post-history] [data-job=\"' + id + '\"]'); return r ? r.getAttribute('data-hist-state') + ' | ' + r.textContent.replace(/\\s+/g, ' ') : ''; }", jid)
    ok(pg.get_attribute('#app [data-post-tab][aria-selected="true"]', "data-post-tab") == "errors", "postings still failed: the Errors tab opens by itself")
    ok("entry_ids" in E("window.__url") and "dismissed_at" in E("window.__url"), "the list reads the entries' ids and the dismissing (migration-26)")
    # the owner's spec of 04-Oct-2026: one row an entry, in one tab. Dismiss is gone (Hide and Remove instead), so a failed
    # posting dismissed by hand (j-hid) is still under Errors; a stopped posting whose entry went in another way is not
    ent = lambda t: (go_tab(t), E("(t) => Array.from(document.querySelectorAll('#app [data-post-panel=\"' + t + '\"] [data-entry-row]')).map(r => r.getAttribute('data-row-key'))", t))[1]
    errs = ent("errors")
    ok(sorted(errs) == ["j-hid:b8", "j-oldfail:b7"], "only the entries still not posted are under Errors, one row each (%s)" % errs)
    ok("Tally said: Old failure, never dealt with" in st("j-oldfail") and pg.locator('#app [data-post-attention] [data-job="j-oldfail"] [data-retry]').count() == 0,
       "an older failure never dealt with stays until someone decides, with Tally's words; words FinCom does not know: no Post again until read (%s)" % st("j-oldfail")[:160])
    ok("The company is not open in Tally" in st("j-hid") and pg.locator('#app [data-post-attention] [data-job="j-hid"] [data-retry]').count() == 1, "a posting dismissed by hand before: still under Errors (Hide or Remove take it off the list), with Post again")
    ok(pg.locator("#app [data-dismiss]").count() == 0, "no Dismiss on the page")
    posted = ent("posted")
    ok(sorted(posted) == ["j-late:b1", "j-old:b9", "local:b2"] and pg.inner_text('#app [data-post-tab="posted"] [data-tab-n]') == "3", "Posted (3): b1 (put in by the later posting), b2 (in Tally another way), b9 (%s)" % posted)
    ok("Tally did not answer" not in pg.inner_text("#app [data-post-history]") and pg.locator('#app [data-job="j-fail1"]').count() == 0 and pg.locator('#app [data-job="j-nothing"]').count() == 0 and pg.locator('#app [data-job="j-left"]').count() == 0,
       "a failed posting finished by a later one, and ones whose entries are in Tally another way or back in review: no row")
    ok(["tally_post_dismiss", {"p_id": "j-fail1", "p_auto": True}] in E("window.__rpc") and not any(r[1].get("p_id") != "j-fail1" and r[1].get("p_auto") for r in E("window.__rpc")),
       "and FinCom dismisses it by itself (only that one; the server checks every entry again)")
    ok(pg.locator('#app button:has-text("Refresh")').count() == 0, "no Refresh button")
    # Post again: the same posting again under its id
    go_tab("errors")
    pg.click('#app [data-post-attention] [data-job="j-hid"] [data-retry]'); pg.wait_for_timeout(500)
    ok(any(r[0] == "tally_post_enqueue" and r[1]["p_id"] == "j-hid" for r in E("window.__rpc")), "Post again (Retry) queues the same posting again under its id")
    # live: a change to a posting reads the list again by itself
    E("() => { window.__jobs.find(x => x.id === 'j-oldfail').status = 'done'; window.__jobs.find(x => x.id === 'j-oldfail').results = [{id: 'b7', ok: true}]; }")
    before = E("window.__reads")
    E("() => { Live.postsTopic = 'realtime:fincom-posts-x'; Live.got({topic: 'realtime:fincom-posts-x', event: 'postgres_changes', payload: {data: {record: {id: 'j-oldfail'}}}}); }")
    pg.wait_for_timeout(1500)
    ok(E("window.__reads") > before and st("j-oldfail") == "" and "j-oldfail:b7" in ent("posted"), "a change from the live connection reads the list again: the posting done now leaves Errors for Posted")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
