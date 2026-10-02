"""python3 run_post_jobs_dismiss.py - the postings in FinCom's cloud on Post to Tally (request of 02-Oct-2026): a failed
posting whose entries a later posting put in reads "Posted later at 07:51" and is dismissed by FinCom (the server checks
it again); Dismiss on a failed or cancelled posting (kept, with who and when); finished postings of the last 7 days,
the rest under "Show older and dismissed"; Retry only while something is left to send ("Nothing left to send"
otherwise); no Refresh: a change from the live connection reads the list again.
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
    Object.assign({}, base, {id: "j-hid", status: "failed", message: "Ledger missing", created_at: t(30), updated_at: t(30), entry_ids: ["b8"], results: [], dismissed_at: t(20), dismissed_by: "u-1", dismiss_note: "Dismissed"}),
    Object.assign({}, base, {id: "j-oldfail", status: "failed", message: "Old failure, never dealt with", created_at: t(480), updated_at: t(480), entry_ids: ["b7"], results: []})];
  window.__reads = 0; window.__rpc = [];
  TCloud.on = () => true; TCloud.has = () => true;
  TCloud.restAll = async (u) => { window.__reads++; window.__url = u; return JSON.parse(JSON.stringify(window.__jobs)); };
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
    box = "#app [data-post-jobs]"
    ok(pg.locator(box).count() == 1, "the list of postings in FinCom's cloud is on Post to Tally")
    ok("entry_ids" in E("window.__url") and "dismissed_at" in E("window.__url"), "the list reads the entries' ids and the dismissing (migration-26)")
    st = lambda jid: E("(id) => { const r = document.querySelector('#app [data-job=\"' + id + '\"]'); return r ? r.getAttribute('data-job-state') + ' | ' + r.innerText.replace(/\\s+/g, ' ') : ''; }", jid)
    # 2. posted later
    f1 = st("j-fail1"); late = E("fmtTime(window.__jobs[0].updated_at)")
    ok(f1.startswith("later") and ("Posted later at " + late) in f1 and "Retry" not in f1 and "Failed" not in f1,
       "2. a failed posting whose bill went in later reads 'Posted later at %s', not 'Failed · Retry' (%s)" % (late, f1[:110]))
    # request of 02-Oct-2026 (item 10): every finished posting can be dismissed, the 'Posted later' one and a done one too
    ok(pg.locator('#app [data-job="j-fail1"] [data-dismiss]').count() == 1 and pg.locator('#app [data-job="j-late"] [data-dismiss]').count() == 1,
       "10. Dismiss on the 'Posted later' posting and on a done one, as on a failed one")
    ok(["tally_post_dismiss", {"p_id": "j-fail1", "p_auto": True}] in E("window.__rpc") and not any(r[1].get("p_id") != "j-fail1" and r[1].get("p_auto") for r in E("window.__rpc")),
       "2. and FinCom dismisses it by itself (only that one; the server checks every entry again)")
    # 4. nothing left to send
    n1 = st("j-nothing")
    ok("nothing left to send" in n1 and "Nothing left to send" in n1 and pg.locator('#app [data-job="j-nothing"] [data-retry]').count() == 0 and pg.locator('#app [data-job="j-nothing"] [data-dismiss]').count() == 1,
       "4. every entry already in Tally: 'Nothing left to send', no Retry, Dismiss offered (%s)" % n1[:120])
    l1 = st("j-left")
    ok(l1.startswith("cancelled") and pg.locator('#app [data-job="j-left"] [data-retry]').count() == 1 and "1 of 2 still to send" in l1 and pg.locator('#app [data-job="j-left"] [data-dismiss]').count() == 1,
       "4. a cancelled posting with one of two entries still to send: Retry and Dismiss (%s)" % l1[:120])
    # 3. the last 7 days; older and dismissed ones under the link
    ok(st("j-old") == "" and st("j-hid") == "", "3. a posting finished 10 days ago and one dismissed by hand are not in the list")
    o1 = st("j-oldfail")
    ok(o1.startswith("failed") and "Retry" in o1, "3. an older failure never dealt with, with something left to send, stays in the list (%s)" % o1[:80])
    lk = pg.inner_text("#app [data-jobs-all]")
    ok(lk == "Show older and dismissed (2)", "3. 'Show older and dismissed (2)' (%s)" % lk)
    # 5. no Refresh
    ok(pg.locator(box + ' button:has-text("Refresh")').count() == 0, "5. no Refresh button")
    # 1. Dismiss: kept, who and when
    pg.click('#app [data-job="j-left"] [data-dismiss]'); pg.wait_for_timeout(800)
    ok(["tally_post_dismiss", {"p_id": "j-left", "p_auto": False}] in E("window.__rpc") and st("j-left") == "", "1. Dismiss asks the server to dismiss it, and the row leaves the list")
    ok(pg.inner_text("#app [data-jobs-all]") == "Show older and dismissed (3)", "1. it is counted under 'Show older and dismissed'")
    pg.click("#app [data-jobs-all]"); pg.wait_for_timeout(500)
    h = st("j-left"); hid = st("j-hid")
    ok(h.startswith("dismissed") and "Dismissed by Anshul" in h and st("j-old").startswith("done") and hid.startswith("dismissed") and "Show in the list again" in hid,
       "1, 3. the full history shows the dismissed ones (who and when) and older ones (%s)" % h[:140])
    ok(pg.inner_text("#app [data-jobs-all]") == "Show only the last 7 days", "3. and the link goes back")
    pg.click('#app [data-job="j-hid"] [data-undismiss]'); pg.wait_for_timeout(500)
    ok(["tally_post_undismiss", {"p_id": "j-hid"}] in E("window.__rpc"), "1. a dismissed posting can be put back in the list")
    # 5. live: a change to a posting reads the list again by itself
    E("() => { window.__jobs.find(x => x.id === 'j-oldfail').status = 'done'; window.__jobs.find(x => x.id === 'j-oldfail').results = [{id: 'b7', ok: true}]; }")
    before = E("window.__reads")
    E("() => { Live.postsTopic = 'realtime:fincom-posts-x'; Live.got({topic: 'realtime:fincom-posts-x', event: 'postgres_changes', payload: {data: {record: {id: 'j-oldfail'}}}}); }")
    pg.wait_for_timeout(1500)
    ok(E("window.__reads") == before + 1 and st("j-oldfail").startswith("done"), "5. a change to a posting from the live connection reads the list again and the row changes (%s)" % st("j-oldfail")[:60])
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
