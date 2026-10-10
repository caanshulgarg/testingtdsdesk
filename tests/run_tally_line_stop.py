"""python3 run_tally_line_stop.py - the per-client Tally line when FinCom has stopped reading on the client's computer
(plan piped-moseying-frost, round 4, item 25). A stop from FinCom (tally_read_stops for the computer, or for all computers;
the computer's info.readStop) shows on every client of that computer, in place of "Tally open on NWS144 … Update now":
  "Reading stopped by <name> at <time>: <reason> · Resume" (Resume for owners only; it calls tally_read_resume for the
  computer, or for all computers when the stop is for all). Update now, while stopped, does nothing and says
  "Reading is stopped by <name> (<reason>); resume it on the Tally page". On the Post page the second line says the same.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_line_stop.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8277), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
DEV = "d0000000-0000-4000-8000-000000000001"
SETUP = """async ([role]) => {
  const c = newCompany({name: "ZZ Test Client", gstin: ""}); c.tallyName = "ZZ TEST"; choiceConfirm(c, "postTo", "ZZ TEST");
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  const o = newCompany({name: "Other Client", gstin: ""}); o.tallyName = "OTHER CO";
  S.companies[o.id] = o; S.data[o.id] = {parties: {}, entries: {}, loaded: true}; o.stats = {};
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  window.__read = ago(20);
  window.__rpc = []; window.__toasts = []; window.__stops = []; window.__keep = [];
  const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  Cloud.on = () => true; Cloud.st.firm = {id: "f-1"}; Cloud.st.members = [{user_id: "u-anshul", name: "Anshul"}, {user_id: "u-neha", email: "neha@fincom.in"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); return /^tally_(want_update|read_resume)$/.test(fn) ? {ok: true} : null; };
  TCloud.on = () => true;
  const copy = (x) => JSON.parse(JSON.stringify(x));
  window.__beat = () => ({at: new Date().toISOString(), every: 30, tally: true, tallyState: "open", paused: false, notAnsweringSince: "",
    lastRead: window.__read, companies: [{name: "ZZ TEST", open: true, at: window.__read, lastRead: window.__read}, {name: "OTHER CO", open: true, at: window.__read, lastRead: window.__read}], open: ["ZZ TEST", "OTHER CO"]});
  window.__dev = {id: "%s", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", user: "tally", beat: window.__beat()}};
  window.__cos = [{company: "ZZ TEST", client_id: c.id, device_id: window.__dev.id}, {company: "OTHER CO", client_id: o.id, device_id: window.__dev.id}];
  Cloud.api = async (p) => { if (/^tally_devices/.test(p)) return [copy(window.__dev)]; if (/^tally_read_stops/.test(p)) return copy(window.__stops); return []; };
  TCloud.restAll = async (u) => /^tally_companies/.test(u) ? copy(window.__cos) : Cloud.api(u);
  TCloudUp.post = async () => ({ok: true, woken: 1});
  // keepNow (the bridge here) is not reached in this test: the stop is checked before it
  LK.keepSet = async (o, m) => { window.__keep.push(o); return {ok: true}; };
  TLight.st = {at: 0, busy: false, by: {}, devs: [], cos: []};
  await TLight.refresh();
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  await openCompany(c.id);
  goStep("post", "bills");
  return [c.id, o.id];
}""" % DEV
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8277/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    hm = lambda m: E("(m) => tallyHm(Date.now() - m * 60000)", m)
    refresh = lambda: (E("async () => { TLight.st.at = 0; await TLight.refresh(); render(); }"), pg.wait_for_timeout(500))
    cid, oid = E(SETUP, ["owner"]); pg.wait_for_timeout(900)
    # the line as before while nothing is stopped
    pl = lambda: txt("#app [data-post-line]")
    ok(pl().startswith("Posting into ZZ TEST · Connected · Tally open on NWS144") and "Update now" in pl(), "no stop: the line as before (%s)" % pl())
    # ---- FinCom stopped reading on the computer (tally_read_stops, with who and when; the beat's readStop too)
    E("""() => { window.__stops = [{id: 7, device_id: window.__dev.id, action: "stop", reason: "Tally hangs on the bank ledger", stopped_at: new Date(Date.now() - 40 * 60000).toISOString(), stopped_by: "u-anshul", cleared_at: null, cleared_by: null}];
      window.__dev.info.readStop = {by: "fincom", reason: "Tally hangs on the bank ledger", at: new Date(Date.now() - 40 * 60000).toISOString()}; }""")
    refresh()
    l = E("(id) => tallyLine(S.companies[id])", cid)
    ok(l and l["state"] == "stopped" and l["text"] in ["Reading stopped by Anshul at %s: Tally hangs on the bank ledger" % hm(m) for m in (40, 41)], "tallyLine: state stopped, 'Reading stopped by <name> at <time>: <reason>' (%s)" % l)
    E("() => { S.homeTab = 'tally'; navHome('tally'); }"); pg.wait_for_timeout(1200)
    cl = lambda c: txt('#app [data-client-line="%s"]' % c)
    ok(any(("Reading stopped by Anshul at %s: Tally hangs on the bank ledger" % hm(m)) in cl(cid) for m in (40, 41)) and ("Reading stopped by Anshul" in cl(oid)), "Tally page: every client of that computer says so (%s | %s)" % (cl(cid), cl(oid)))
    ok(pg.locator('#app [data-client-line="%s"] [data-update-now]' % cid).count() == 0 and txt('#app [data-client-line="%s"] [data-read-resume-line]' % cid) == "Resume", "the line has Resume, not Update now (owner)")
    pg.click('#app [data-client-line="%s"] [data-read-resume-line]' % cid); pg.wait_for_timeout(600)
    ok(["tally_read_resume", {"p_device": DEV}] in E("window.__rpc"), "Resume -> tally_read_resume(p_device) for the computer (%s)" % E("window.__rpc"))
    # Update now, while stopped: nothing is asked, the toast says who and why
    E("() => { window.__rpc = []; window.__toasts = []; window.__keep = []; tallyUpdateNow(S.companies['%s'].id); }" % oid); pg.wait_for_timeout(400)
    ok(not E("window.__rpc") and not E("window.__keep") and E("window.__toasts") == ["Reading is stopped by Anshul (Tally hangs on the bank ledger); resume it on the Tally page"],
       "Update now (another client of the computer): nothing asked, 'Reading is stopped by <name> (<reason>); resume it on the Tally page' (%s)" % E("window.__toasts"))
    E("() => { window.__rpc = []; window.__toasts = []; window.__keep = []; tallyUpdateNow(S.coId); }"); pg.wait_for_timeout(400)
    ok(not E("window.__rpc") and not E("window.__keep") and E("window.__toasts") and E("window.__toasts")[0].startswith("Reading is stopped by Anshul"), "Update now for the open client (keepNow's way): refused the same way, the bridge here not asked")
    # the other callers of keepNow (TopBar "Refresh books", FromTally "Update now", Books): the same refusal, the bridge here not asked
    E("() => { window.__rpc = []; window.__toasts = []; window.__keep = []; doAct('keepNow'); }"); pg.wait_for_timeout(400)
    ok(not E("window.__rpc") and not E("window.__keep") and E("window.__toasts") and E("window.__toasts")[0].startswith("Reading is stopped by Anshul"), "doAct('keepNow') (Refresh books, FromTally's Update now): refused the same way (%s)" % E("window.__toasts"))
    # the Post page's second line
    E("async (id) => { await openCompany(id); goStep('post', 'bills'); }", cid); pg.wait_for_timeout(700)
    pp = txt("#app [data-post-problem]")
    ok(pg.get_attribute("#app [data-post-problem]", "data-post-problem") == "stopped" and any(pp.startswith("Reading stopped by Anshul at %s: Tally hangs on the bank ledger" % hm(m)) for m in (40, 41)) and "Tally page" in pp, "Post page: the second line says it, and where to resume (%s)" % pp)
    # ---- a stop for all computers: Resume resumes all
    E("""() => { window.__stops = [{id: 8, device_id: null, action: "stop", reason: "Bridge update", stopped_at: new Date(Date.now() - 2 * 60000).toISOString(), stopped_by: "u-neha", cleared_at: null, cleared_by: null}]; delete window.__dev.info.readStop; }""")
    refresh()
    E("() => { navHome('tally'); }"); pg.wait_for_timeout(1200)
    ok(any(("Reading stopped by neha@fincom.in at %s: Bridge update" % hm(m)) in cl(cid) for m in (2, 3)), "a stop for all computers: said with who and when (%s)" % cl(cid))
    E("() => { window.__rpc = []; }"); pg.click('#app [data-client-line="%s"] [data-read-resume-line]' % cid); pg.wait_for_timeout(600)
    ok(["tally_read_resume", {"p_device": None}] in E("window.__rpc"), "Resume on an all-computers stop -> tally_read_resume(null)")
    # ---- a member: the words, no Resume; Update now refused the same way
    cid, oid = E(SETUP, ["member"]); pg.wait_for_timeout(600)
    E("""() => { window.__stops = [{id: 7, device_id: window.__dev.id, action: "stop", reason: "Tally hangs on the bank ledger", stopped_at: new Date(Date.now() - 40 * 60000).toISOString(), stopped_by: "u-anshul", cleared_at: null, cleared_by: null}]; }""")
    refresh(); E("() => { navHome('tally'); }"); pg.wait_for_timeout(1200)
    ok("Reading stopped by Anshul" in cl(cid) and pg.locator('#app [data-client-line="%s"] [data-read-resume-line], #app [data-client-line="%s"] [data-update-now]' % (cid, cid)).count() == 0, "a member: the words, no Resume, no Update now (%s)" % cl(cid))
    # ---- no tally_read_stops rows readable (before migration-35): the beat's readStop alone, without a name
    E("""() => { Cloud.api = async (p) => { if (/^tally_devices/.test(p)) return [JSON.parse(JSON.stringify(window.__dev))]; if (/^tally_read_stops/.test(p)) throw new Error("relation public.tally_read_stops does not exist"); return []; };
      TCloud.pane.stops = []; TCloud.pane.noControl = true;   // the Tally page read nothing either on that cloud
      window.__dev.info.readStop = {by: "fincom", reason: "Tally hangs on the bank ledger", at: new Date(Date.now() - 40 * 60000).toISOString()}; }""")
    refresh()
    l = E("(id) => tallyLine(S.companies[id])", cid)
    # the minute may tick over between the stop's time stamp and this check: either minute is right
    ok(l and l["state"] == "stopped" and l["text"] in ["Reading stopped from FinCom at %s: Tally hangs on the bank ledger" % hm(m) for m in (40, 41)], "older cloud: the beat's readStop alone: 'Reading stopped from FinCom at <time>: <reason>' (%s)" % l)
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
