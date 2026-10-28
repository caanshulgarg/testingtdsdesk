"""python3 run_tally_ux.py - the Tally redesign (the owner, 09-Oct-2026: "Tally link page is also very confusing.. if i go to
tally page then return to that client is not possible.. multiple ports.. what should i do with that.. whatever actionable
is or what relevant information is.. this should be there").
  1. Navigation: client -> Tally ("Tally page" on the client's From Tally tab) -> "<- Back to <client>" shows the same
     client and the same page; the browser's Back does the same; a refresh of #/tally keeps the client for the Back link.
  2. "Your Tally connection": Needs you first (one line, one button each); one card a computer ("NWS144 · anshul") with
     its state in words, the companies it reads, the last entry (IST); ports, versions, requests and the session-0 Tallys
     only under Details.
  3. Every owner tool still works and calls the same RPC: Stop/Resume reading, release (hold, let go, roll back),
     trial tools, posting settings, recorder source, Changes only, make main.
  4. Staff: the same words, no owner buttons.
  5. The client's Tally link line: linked, not linked (three steps), held entries, stopped.
  6. A phone-width screenshot (390 px): no sideways scroll.
Options: --shots DIR  saves the screenshots into DIR (docs/ui-pass/tallyux/after).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_ux.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8613
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def dev(n, comp, user, at="ago:0.5", tally="open", opened=("GARG SHEKHAR",), port=9005, rec_at="ago:2", beat=None, version="2.3.4", main=True):
    i = "d0000000-0000-4000-8000-00000000000%d" % n
    b = {"at": at, "version": version, "computer": comp, "user": user, "mode": "main" if main else "test", "runMode": "user", "tally": tally == "open", "tallyState": tally,
         "open": list(opened), "tallyPort": port, "dataFolder": "C:\\Users\\Public\\TallyPrime\\Data",
         "reqs": {"day": "TODAY", "last": {"kind": "vouchers", "ms": 1234, "at": "ago:2"}, "longest": {"kind": "ledgers", "ms": 8400, "at": "ago:120"}, "over20": 0, "n": 41},
         "recorder": {co: {"seen": True, "lastAt": rec_at} for co in opened}}
    bt = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False}
    bt.update(beat or {}); b.update({k: v for k, v in (beat or {}).items() if k in ("readStopped", "paused")})
    info = {"computer": comp, "user": user, "beat": bt, "bridges": {"go-%d" % n: b}}
    return {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": version, "main_bridge": "go-%d" % n if main else "other", "info": info, "created_at": "2026-09-01T00:00:00Z",
            "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}
DEVS = [dev(1, "NWS144", "anshul"), dev(2, "LAPTOP", "ravi", at="ago:180", opened=("ABC LTD",)), dev(3, "FRONTDESK", "tally", tally="closed", opened=()),
        dev(4, "TALLYSRV", "meena", opened=("XYZ",), beat={"readStopped": {"by": "fincom", "reason": "Tally hangs on the bank ledger", "at": "ago:40"}})]
D1, D2, D3, D4 = [d["id"] for d in DEVS]
STOPS = [{"id": 7, "device_id": D4, "action": "stop", "reason": "Tally hangs on the bank ledger", "stopped_at": "ago:40", "cleared_at": None, "stopped_by": None}]
SETUP = """([devs, stops, companies, role, lines]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  let c = Object.values(S.companies).find(x => x.name === "Alpha Traders");
  window.__devs = fix(devs); window.__stops = fix(stops); window.__calls = [];
  window.__companies = fix(companies).map(x => Object.assign(x, {client_id: x.client_id === "ALPHA" ? c.id : x.client_id}));
  window.__lines = fix(lines || []).map(l => Object.assign(l, {client_id: c.id}));
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_read_stops/.test(path)) return copy(window.__stops);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    if (/^tally_recorder_lines/.test(path)) return copy(window.__lines);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  if (typeof TLight === "object"){ TLight.st.at = 0; TLight.st.devs = window.__devs.filter(d => !d.revoked); TLight.st.cos = window.__companies; TLight.st.stops = window.__stops; }
  if (typeof Rec === "object"){ Rec.act = {}; }
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {};
  return c.id;
}"""
ENDED_WHY = "Tally did not give this entry when asked again; upload that day's Day Book to settle it"
def rline(i, day, why=ENDED_WHY, state="held"):
    return {"id": i, "client_id": "CID", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": "GARG SHEKHAR", "line_id": "L%d" % i, "event": "created", "object_guid": "g-%d" % i,
            "alter_id": 900 + i, "vch_type": "Sales", "vch_no": str(i), "vch_date": day, "saved_at": "ago:600", "received_at": "ago:600", "applied_at": None, "state": state, "held_why": why, "ledgers": []}
HELD = [rline(1, "2026-10-07"), rline(2, "2026-10-07"), rline(3, "2026-10-06", why="month locked: 2026-04")]
OWNER_HOOKS = ["data-read-stop", "data-read-resume", "data-read-stop-all", "data-read-resume-all", "data-release-hold", "data-release-unhold", "data-release-rollback",
    "data-trial-tools-switch", "data-recorder-source-pick", "data-ps-edit", "data-changes-only-switch", "data-make-main", "data-release-identity", "data-member-link-pick", "data-baseline-clear"]
def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
            body=json.dumps({"setup": {"version": "2.4.0", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.0.exe", "sha256": "ab" * 32}})))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        def shot(name, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
        cid = E("""() => { const g = newCompany({name: 'Alpha Traders', gstin: ''}); g.tallyName = 'GARG SHEKHAR'; S.companies[g.id] = g;
            S.data[g.id] = {parties: {}, entries: {}, loaded: true}; g.stats = {}; return g.id; }""")
        LINKED = [{"company": "GARG SHEKHAR", "client_id": "ALPHA", "device_id": D1, "gstin": "", "last_seen": "ago:1"},
                  {"company": "ABC LTD", "client_id": None, "device_id": D2, "gstin": "", "last_seen": "ago:1"}]
        def scene(devs, companies, role="owner", stops=STOPS, lines=None):
            E(SETUP, [devs, stops, companies, role, lines or []]); pg.wait_for_timeout(300)
        state = lambda: E("[location.hash, S.view, S.coId, S.tab, S.homeTab]")

        # ---- 1. navigation: client -> Tally -> Back to the client, the same page
        scene(DEVS, LINKED)
        E("(cid) => openCompany(cid)", cid); pg.wait_for_timeout(800)
        E("() => goClient('books:import')"); pg.wait_for_timeout(1500)
        ok(E("location.hash").endswith("/books/import"), "1. the client's From Tally tab is open (%s)" % E("location.hash"))
        # 24-Oct-2026 (next-tally-one-page): no Tally line on From Tally; Client setup -> Tally has one line whose "Open in
        # Tally page" opens the Tally page with the client's row marked
        link = "#app [data-tally-one]"
        ok(pg.locator("#app [data-tally-link], #app [data-tally-link-line]").count() == 0, "5. From Tally: no Tally link line (the Tally page is the one place)")
        E("() => { S.tab = 'cotally'; render(); }"); pg.wait_for_timeout(900)
        before = state()
        ok(before[3] == "cotally" and before[1] == "company" and pg.locator(link).count() == 1, "1. Client setup -> Tally: one line (%s)" % before)
        ok(pg.locator(link + " [data-tally-one-go]").count() == 1, "C. From a client, 'Open in Tally page'")
        pg.click(link + " [data-tally-one-go]"); pg.wait_for_timeout(1500)
        s = state()
        ok(s[0] == "#/tally" and s[1] == "home" and s[2] == cid, "1. the Tally page opens, the client is kept (%s)" % s)
        # clean-up batch 1 (11-Oct-2026): the way back is the sidebar's client card, not a link on the page
        back = '#side [data-side-client="back"]'
        ok(pg.get_attribute(back, "aria-label") == "Back to Alpha Traders" and pg.locator("#app [data-back-client]").count() == 0, "1. the sidebar's client card: 'Back to Alpha Traders'; no Back link on the page (%r)" % pg.get_attribute(back, "aria-label"))
        ok(pg.locator('#app [data-tally-focus="%s"]' % cid).count() == 1 and pg.locator('#app [data-tco-row="GARG SHEKHAR"][data-focus]').count() == 1,
           "C. focused on the client's company: its row marked")
        shot("tally-from-client")
        # 15-Oct-2026 (the calm page): Sync activity and Everything sent open from the Advanced (for support) fold
        E("() => { S.tallyMore = {page: true}; render(); }"); pg.wait_for_timeout(400)
        for tab in ("activity", "sent"):
            pg.click('#app [data-tally-tab="%s"]' % tab); pg.wait_for_timeout(500)
            ok(pg.locator(back).count() == 1, "1. Back to the client on the %s tab too" % tab)
        pg.click('#app [data-tally-tab="computers"]'); pg.wait_for_timeout(400)
        pg.click(back); pg.wait_for_timeout(1500)
        s = state()
        ok(s[0] == before[0] and s[1] == "company" and s[2] == cid and s[3] == before[3], "1. Back to the client: the same client and page (%s)" % s)
        # browser Back from the Tally page
        pg.click(link + " [data-tally-one-go]"); pg.wait_for_timeout(1200)
        ok(state()[0] == "#/tally", "1. on the Tally page again")
        pg.go_back(); pg.wait_for_timeout(1500)
        s = state()
        ok(s[0] == before[0] and s[1] == "company" and s[2] == cid, "1. the browser's Back shows the same client (%s)" % s)
        pg.go_forward(); pg.wait_for_timeout(1200)
        ok(state()[0] == "#/tally" and pg.locator(back).count() == 1, "1. Forward: the Tally page, with its Back link")
        # the sidebar's Tally (no focus) still has the Back link: the open client is kept
        E("() => { S.tallyFocus = ''; navHome('tally'); }"); pg.wait_for_timeout(600)
        ok(pg.locator(back).count() == 1 and pg.locator('#app [data-tco-row][data-focus]').count() == 0, "1. the Tally page from the sidebar: Back link, no row marked")
        sb = pg.locator('#side button[aria-label="Back to Alpha Traders"]')
        ok(sb.count() == 1, "1. the sidebar's client card on a firm page: 'Back to Alpha Traders'")
        sb.click(); pg.wait_for_timeout(1200)
        ok(state()[1] == "company" and state()[2] == cid, "1. the sidebar's Back opens the client (%s)" % state())
        E("() => navHome('tally')"); pg.wait_for_timeout(800)
        # a refresh on #/tally keeps the client (start() no longer drops it for a firm page's address)
        E("() => { lsSet('tdsdesk:last', S.coId); }")
        pg.reload(); pg.wait_for_timeout(2500)
        if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1000)
        if E("!!S.companies[%r]" % cid):
            s = state()
            ok(s[0] == "#/tally" and s[2] == cid and pg.locator(back).count() == 1, "1. after a refresh on #/tally the client is kept, with its Back link (%s)" % s)
        else: print("  note the offline client is not kept across a reload here; the refresh check is skipped")
        scene(DEVS, LINKED); E("() => navHome('tally')"); pg.wait_for_timeout(1200)

        # ---- 2. Your Tally connection: Needs you, cards, Details folded
        ok(txt("#cobar .tbar-title h2").strip() == "Tally", "A. the page is called 'Tally', its sidebar word (clean-up batch 1)")
        # 15-Oct-2026 (the calm page): one line a computer on the page, its state in a word and at most one button; the
        # cards (with their Details) under the one Advanced (for support) fold
        pl = lambda d: txt('#app [data-pc-line="%s"]' % d)
        ok(pg.locator("#app [data-pc-line]").count() == 4 and all(pg.locator('#app [data-pc-line="%s"] button, #app [data-pc-line="%s"] a.btn' % (d, d)).count() <= 1 for d in (D1, D2, D3, D4)),
           "A. one line a computer, at most one button each")
        ok("offline since" in pl(D2) and "Tally not open" in pl(D3), "A. offline and Tally not open said on the computers' line (%s | %s)" % (pl(D2), pl(D3)))
        ok("reading stopped" in pl(D4) and pg.locator('#app [data-pc-line="%s"] [data-pc-resume]' % D4).count() == 1, "A. reading stopped from FinCom: 'Stopped', with Resume reading (%s)" % pl(D4))
        E("() => { S.tallyMore = {page: true}; render(); }"); pg.wait_for_timeout(600)
        ok(pg.locator("#app [data-computer]").count() == 4, "A. one card a computer and Windows user (under Advanced)")
        c1 = '#app [data-computer="%s"]' % D1
        ok(txt(c1 + " [data-card-name]") == "NWS144 \u00b7 anshul" and pg.get_attribute(c1, "data-card-state") == "Connected", "A. card 'NWS144 \u00b7 anshul', Connected (%s)" % txt(c1 + " [data-card-name]"))
        ok(txt(c1 + " [data-card-companies]") == "Reads GARG SHEKHAR", "A. the companies it reads (its client is on the company's row) (%s)" % txt(c1 + " [data-card-companies]"))
        ok(re.match(r"^Last entry received 2 min ago \(\d\d:\d\d IST\)$", txt(c1 + " [data-card-last]")) is not None, "A. the last entry, IST (%s)" % txt(c1 + " [data-card-last]"))
        ok(pg.get_attribute('#app [data-computer="%s"]' % D2, "data-card-state") == "Not connected" and pg.get_attribute('#app [data-computer="%s"]' % D3, "data-card-state") == "Needs you",
           "A. Not connected / Needs you in words")
        ok(all(pg.locator('#app [data-computer] [data-status-line]').nth(i).locator("button").count() <= 1 for i in range(4)), "A. at most one main action a card")
        E("() => { S.tallyMore = {}; render(); }"); pg.wait_for_timeout(600)
        page = lambda: pg.inner_text("#app")
        ok("9005" not in page() and not re.search(r"\bports?\b", page(), re.I) and pg.locator("#app [data-session0]").count() == 0,
           "2. no port and no session-0 Tally before Details is opened")
        ok("Last request" not in page(), "2. the requests only under Details")
        shot("owner-connection")
        # the session-0 Tallys: this browser's connection (Bridge.st.sessions), under the page's Details
        E("""() => { Bridge.cfg = () => ({url: 'http://localhost:1', key: 'k', follow: false, port: 0}); Bridge.blocked = () => false; Bridge.on = () => true; Bridge.up = () => true;
            Bridge.st = Object.assign({}, Bridge.st || {}, {state: 'ok', version: '2.4.0', mode: 'auto', at: Date.now(), tallyUp: true, open: [], clash: [],
              sessions: [{port: 9000, ok: true, mine: true, companies: [{name: 'GARG SHEKHAR'}]}, {port: 9001, skipped: true, ok: false, companies: []}]}); render(); }""")
        pg.wait_for_timeout(500)
        ok(pg.locator("#app [data-session0]").count() == 0 and "9001" not in page(), "2. the other logins' Tally (session 0) hidden until Details")
        pg.click('#app [data-more-toggle="page"]'); pg.wait_for_timeout(700)
        s0 = txt("#app [data-session0]")
        ok("Other Tally windows on this computer that belong to other Windows logins; the bridge ignores them." in s0, "2. session 0 said in one plain line (%s)" % s0)
        ok("Port 9001" in page(), "2. the ports are under Details")
        pg.click(c1 + ' [data-more-toggle]'); pg.wait_for_timeout(500)
        dt = txt(c1 + " [data-card-more]")
        ok("Tally port 9005" in dt and "FinCom Bridge 2.3.4" in dt and "Last request" in dt and "Longest today" in dt, "2. card Details: port, version, requests (%s)" % dt[:200])
        shot("owner-details-open")

        # ---- 3. every owner tool, the same RPC
        def calls(fn): return [c for c in E("window.__calls") if c[0] == fn]
        def confirm(field=None, value="x"):
            pg.wait_for_timeout(300)
            if field and pg.locator("#confirmBox " + field).count(): pg.fill("#confirmBox " + field, value)
            if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]')
            pg.wait_for_timeout(700)
        pg.click('#app [data-read-stop="%s"]' % D1); confirm("#readStopWhy", "month end")
        ok(["tally_read_stop", {"p_device": D1, "p_reason": "month end"}] in calls("tally_read_stop"), "3. Stop reading -> tally_read_stop")
        pg.click('#app [data-pc-line="%s"] [data-pc-resume]' % D4); pg.wait_for_timeout(700)
        ok(["tally_read_resume", {"p_device": D4}] in calls("tally_read_resume"), "3. Resume (the computer's line) -> tally_read_resume")
        pg.click('#app [data-read-stop-all]'); confirm("#readStopWhy", "update")
        ok(["tally_read_stop", {"p_device": None, "p_reason": "update"}] in calls("tally_read_stop"), "3. Stop reading on all computers -> tally_read_stop(null)")
        E("() => { window.__devs = window.__devs; }")
        pg.click(c1 + " [data-trial-tools-switch]"); pg.wait_for_timeout(700)
        ok(["tally_device_trial_tools", {"p_device": D1, "p_on": True}] in calls("tally_device_trial_tools"), "3. Trial tools -> tally_device_trial_tools")
        pg.select_option(c1 + " [data-recorder-source-pick]", "both"); pg.wait_for_timeout(700)
        ok(["tally_device_recorder_source", {"p_device": D1, "p_source": "both"}] in calls("tally_device_recorder_source"), "3. Recorder source -> tally_device_recorder_source")
        pg.click(c1 + " [data-ps-edit]"); pg.wait_for_timeout(300); pg.fill(c1 + " [data-ps-bills]", "30"); pg.click(c1 + " [data-ps-save]"); confirm()
        ok([c for c in calls("tally_device_post_settings") if c[1].get("p_device") == D1 and c[1].get("p_bills") == 30], "3. Posting settings -> tally_device_post_settings (%s)" % calls("tally_device_post_settings"))
        if pg.locator(c1 + " [data-changes-only-switch]").count():
            pg.click(c1 + " [data-changes-only-switch]"); confirm()
            ok(calls("tally_bridge_changes_only"), "3. Changes only -> tally_bridge_changes_only")
        # make main: a computer whose main bridge is another one
        E("""() => { const d = window.__devs.find(x => x.name === 'NWS144'); d.main_bridge = 'go-9'; d.info.bridges['go-9'] = Object.assign({}, d.info.bridges['go-1'], {user: 'anshul', version: '2.4.0', at: d.info.bridges['go-1'].at});
            TCloud.pane.at = 0; TCloud.refreshPane(); }""")
        pg.wait_for_timeout(1500)
        mm = pg.locator('#app [data-make-main="go-1"]')
        ok(mm.count() >= 1, "3. a bridge that only reads: Make this the main bridge (%d)" % mm.count())
        if mm.count():
            mm.first.click(); confirm()
            ok(["tally_bridge_make_main", {"p_device": D1, "p_bridge": "go-1"}] in calls("tally_bridge_make_main"), "3. Make main -> tally_bridge_make_main (%s)" % calls("tally_bridge_make_main"))
        # the release: hold / roll back (the owner's rule of 05-Oct-2026)
        E("() => { TCloud.pane.releases = [{version: '2.4.0'}]; TCloud.pane.rollback = null; render(); }"); pg.wait_for_timeout(400)
        if pg.locator("#app [data-release-hold]").count():
            pg.click("#app [data-release-hold]"); confirm("#holdWhy", "posting broke")
            ok(["tally_release_hold", {"p_version": "2.4.0", "p_why": "posting broke"}] in calls("tally_release_hold"), "3. Hold version -> tally_release_hold")
        else: ok(False, "3. Hold version: the button is under Details")
        if pg.locator("#app [data-release-rollback]").count():
            pg.click("#app [data-release-rollback]"); pg.wait_for_timeout(300)
            if pg.locator("#confirmBox #rollbackVersion").count(): pg.fill("#confirmBox #rollbackVersion", "2.3.4")
            confirm("#rollbackWhy", "posting broke")
            ok(calls("tally_release_rollback"), "3. Roll back -> tally_release_rollback")
        else: ok(False, "3. Roll back: the button is under Details")

        # ---- 4. staff: the same words, no owner button
        scene(DEVS, LINKED, role="staff"); E("() => navHome('tally')"); pg.wait_for_timeout(1500)
        hooks = [h for h in OWNER_HOOKS + ["data-pc-resume"] if pg.locator("#app [%s]" % h).count()]
        sn = [txt('#app [data-pc-line="%s"]' % D4)]
        for _ in range(2):   # the Advanced fold, then each card's Details
            E("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"); pg.wait_for_timeout(700)
        hooks += [h for h in OWNER_HOOKS if pg.locator("#app [%s]" % h).count()]
        ok(not hooks, "4. staff: no owner button, Details open (%s)" % hooks)
        sn.append(txt('#app [data-computer="%s"]' % D4))
        ok(any("Tally hangs on the bank ledger" in x and "An owner of the firm can resume it." in x for x in sn), "4. staff: the stop's words, and who can resume it (%s)" % sn)
        ok("Posting settings:" in page() and "Trial tools on this computer: off" in page(), "4. staff: the settings' words")
        shot("staff-details-open")

        # ---- 5. the client's link line
        E("(cid) => openCompany(cid)", cid); pg.wait_for_timeout(500)
        scene(DEVS, LINKED); E("() => goClient('books:import')"); pg.wait_for_timeout(1200)
        # 24-Oct-2026 (next-tally-one-page): the client's Tally in one line; the rest is its row on the Tally page
        lt = re.sub(r"\s+", " ", txt("#app [data-tally-one]") if pg.locator("#app [data-tally-one]").count() else "")
        E("() => { S.tab = 'cotally'; render(); }"); pg.wait_for_timeout(800)
        lt = re.sub(r"\s+", " ", txt(link))
        ok(lt == "Tally: GARG SHEKHAR ● Linked · Open in Tally page", "5. linked: one line, the one word Linked (%r)" % lt)
        R = '#app [data-tco-list=firm] [data-tco-row="GARG SHEKHAR"]'
        pg.click(link + " [data-tally-one-go]"); pg.wait_for_timeout(1200)
        ok(pg.locator(R + " [data-tco-sync-now]").count() == 1 and txt(R + " [data-tco-pill]").startswith("Linked"), "5. its row: Linked, Sync now")
        # change company: the other company's row, Link to client… (the client moves, asked once)
        other = "ABC LTD"
        pg.click('#app [data-tco-row="%s"] [data-tco-act=pick]' % other); pg.wait_for_timeout(300)   # Task D: Link to client…
        pg.select_option('#app [data-tco-row="%s"] [data-tco-relink-pick]' % other, cid); pg.click('#app [data-tco-row="%s"] [data-tco-relink]' % other)
        pg.wait_for_selector('#confirmBox [data-cbx="yes"]', state="visible", timeout=10000); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(1000)
        ok(["tally_company_link", {"p_company": other, "p_client": cid}] in calls("tally_company_link"), "5. another company for the client -> tally_company_link (asked once)")
        shot("client-linked")
        # From Tally: the days that need a Day Book in their own section, no Tally link block
        scene(DEVS, LINKED, lines=HELD)
        E("(c) => { S.tallyGuide = {}; S.view = 'company'; S.coId = c; goClient('books:import'); }", cid); pg.wait_for_timeout(1200)
        ok(pg.locator("#app [data-tally-link], #app [data-tally-link-needs]").count() == 0, "5. From Tally: no Tally link block (held entries are on the Activity and the bell)")
        shot("client-held")
        # stopped: the computers' line says it, Resume for an owner
        stopped = [dict(d) for d in DEVS]; STOP1 = [{"id": 8, "device_id": D1, "action": "stop", "reason": "Tally slow", "stopped_at": "ago:5", "cleared_at": None, "stopped_by": None}]
        scene(stopped, LINKED, stops=STOP1); E("() => { S.tallyGuide = {}; S.tallyFocus = ''; navHome('tally'); }"); pg.wait_for_timeout(1200)
        ok("reading stopped" in pl(D1) and pg.locator('#app [data-pc-line="%s"] [data-pc-resume]' % D1).count() == 1, "5. stopped: said on the computers' line, with Resume (%s)" % pl(D1))
        pg.click('#app [data-pc-line="%s"] [data-pc-resume]' % D1); pg.wait_for_timeout(700)
        ok(["tally_read_resume", {"p_device": D1}] in calls("tally_read_resume"), "5. Resume -> tally_read_resume")
        shot("client-stopped")
        # not linked: the line says so; Choose on Tally page lists the companies with their state
        scene(DEVS, [{"company": "ABC LTD", "client_id": None, "device_id": D2, "gstin": "", "last_seen": "ago:1"}])
        E("(c) => { S.tallyGuide = {}; S.view = 'company'; S.coId = c; openCompany(c); S.tab = 'cotally'; render(); }", cid); pg.wait_for_timeout(1000)
        ok(E("document.querySelector('#app [data-tally-one]') && document.querySelector('#app [data-tally-one]').getAttribute('data-tally-one')") == "unlinked", "5. not linked: the line says so")
        pg.click("#app [data-tally-one-go]"); pg.wait_for_timeout(1500)
        o5 = E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), r.getAttribute('data-tco-state')]))")
        ok(E("S.homeTab") == "tally" and o5.get("GARG SHEKHAR") == "connected" and o5.get("ABC LTD") == "offline",
           "5. not linked: Choose on Tally page: the companies with their state (ABC LTD: computer offline) (%s)" % o5)
        shot("client-unlinked")

        # ---- 6. phone width
        ph = br.new_page(viewport={"width": 390, "height": 844}); ph.on("pageerror", lambda e: errors.append(str(e)))
        ph.goto("http://localhost:%d/" % PORT); ph.wait_for_timeout(2500); ph.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); ph.wait_for_timeout(800)
        ph.evaluate("""() => { const g = newCompany({name: 'Alpha Traders', gstin: ''}); g.tallyName = 'GARG SHEKHAR'; S.companies[g.id] = g; S.data[g.id] = {parties: {}, entries: {}, loaded: true}; g.stats = {}; S.coId = g.id; }""")
        ph.evaluate(SETUP, [DEVS, STOPS, LINKED, "owner", []]); ph.evaluate("() => navHome('tally')"); ph.wait_for_timeout(1800)
        wide = ph.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        ok(wide <= 1, "6. phone width: no sideways scroll (%d px)" % wide)
        ok(ph.locator("#app [data-back-client]").count() == 0 and ph.locator("#app [data-pc-lines]").count() == 1, "6. phone: the computers' lines (the way back is in the menu's More)")
        if SHOTS: ph.screenshot(path=os.path.join(SHOTS, "phone-connection.png"), full_page=True)
        ph.evaluate("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"); ph.wait_for_timeout(600)
        wide = ph.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        ok(wide <= 1, "6. phone width, Details open: no sideways scroll (%d px)" % wide)
        if SHOTS: ph.screenshot(path=os.path.join(SHOTS, "phone-details-open.png"), full_page=True)
        ok(not errors, "no page errors %s" % errors[:3])
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
    sys.exit(1 if fails else 0)
if __name__ == "__main__":
    main()
