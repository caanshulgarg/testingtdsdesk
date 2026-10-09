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
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
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
        before = state()
        ok(before[0].endswith("/books/import") and before[1] == "company", "1. the client's From Tally tab is open (%s)" % before)
        link = "#app [data-tally-link]"
        ok(pg.locator(link).count() == 1, "5. From Tally: the client's Tally link line is there")
        ok(pg.locator(link + " [data-tally-link-page]").count() == 1, "C. From a client, a 'Tally page' link")
        pg.click(link + " [data-tally-link-page]"); pg.wait_for_timeout(1500)
        s = state()
        ok(s[0] == "#/tally" and s[1] == "home" and s[2] == cid, "1. the Tally page opens, the client is kept (%s)" % s)
        back = "#app [data-back-client]"
        ok(txt(back) == "\u2190 Back to Alpha Traders", "1. '\u2190 Back to Alpha Traders' on the Tally page (%r)" % txt(back))
        ok(pg.locator('#app [data-tally-focus="%s"]' % cid).count() == 1 and pg.locator('#app [data-computer="%s"][data-focus]' % D1).count() == 1,
           "C. focused on the client's computer and company (%s)" % txt('#app [data-tally-focus]'))
        ok("GARG SHEKHAR" in txt('#app [data-tally-focus]') and "NWS144" in txt('#app [data-tally-focus]'), "C. the focus line names the company and the computer")
        shot("tally-from-client")
        for tab in ("activity", "sent"):
            pg.click('#app [data-tally-tab="%s"]' % tab); pg.wait_for_timeout(500)
            ok(pg.locator(back).count() == 1, "1. Back to the client on the %s tab too" % tab)
        pg.click('#app [data-tally-tab="computers"]'); pg.wait_for_timeout(400)
        pg.click(back); pg.wait_for_timeout(1500)
        s = state()
        ok(s[0] == before[0] and s[1] == "company" and s[2] == cid and s[3] == "books", "1. Back to the client: the same client and page (%s)" % s)
        # browser Back from the Tally page
        pg.click(link + " [data-tally-link-page]"); pg.wait_for_timeout(1200)
        ok(state()[0] == "#/tally", "1. on the Tally page again")
        pg.go_back(); pg.wait_for_timeout(1500)
        s = state()
        ok(s[0] == before[0] and s[1] == "company" and s[2] == cid, "1. the browser's Back shows the same client (%s)" % s)
        pg.go_forward(); pg.wait_for_timeout(1200)
        ok(state()[0] == "#/tally" and pg.locator(back).count() == 1, "1. Forward: the Tally page, with its Back link")
        # the sidebar's Tally (no focus) still has the Back link: the open client is kept
        E("() => { S.tallyFocus = ''; navHome('tally'); }"); pg.wait_for_timeout(600)
        ok(pg.locator(back).count() == 1 and pg.locator('#app [data-tally-focus]').count() == 0, "1. the Tally page from the sidebar: Back link, no focus line")
        sb = pg.locator('#side button[aria-label="\u2190 Back to Alpha Traders"]')
        ok(sb.count() == 1, "1. the sidebar's first item on a firm page: '\u2190 Back to Alpha Traders'")
        sb.click(); pg.wait_for_timeout(1200)
        ok(state()[1] == "company" and state()[2] == cid, "1. the sidebar's Back opens the client (%s)" % state())
        E("() => navHome('tally')"); pg.wait_for_timeout(800)
        # a refresh on #/tally keeps the client (start() no longer drops it for a firm page's address)
        E("() => { lsSet('tdsdesk:last', S.coId); }")
        pg.reload(); pg.wait_for_timeout(2500)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
        if E("!!S.companies[%r]" % cid):
            s = state()
            ok(s[0] == "#/tally" and s[2] == cid and pg.locator(back).count() == 1, "1. after a refresh on #/tally the client is kept, with its Back link (%s)" % s)
        else: print("  note the offline client is not kept across a reload here; the refresh check is skipped")
        scene(DEVS, LINKED); E("() => navHome('tally')"); pg.wait_for_timeout(1200)

        # ---- 2. Your Tally connection: Needs you, cards, Details folded
        ok(txt("#cobar h1, #cobar .title, #cobar") .find("Your Tally connection") >= 0, "A. the page is called 'Your Tally connection'")
        needs = E("() => [...document.querySelectorAll('#app [data-needs-you] li')].map(li => [li.getAttribute('data-need'), li.innerText.replace(/\\s+/g, ' ').trim(), li.querySelectorAll('button, a.btn').length])")
        kinds = [n[0] for n in needs]
        ok(set(kinds) >= {"offline", "tally", "stopped"} and all(n[2] <= 1 for n in needs), "A. Needs you: offline, Tally not open, stopped; at most one button each (%s)" % needs)
        ok(any(n[0] == "tally" and n[1].startswith("Tally is not open on FRONTDESK (tally)") for n in needs), "A. 'Tally is not open on FRONTDESK (tally)'")
        ok(any(n[0] == "stopped" and "Tally hangs on the bank ledger" in n[1] and n[1].endswith("Resume") for n in needs), "A. 'Reading stopped ... : Resume'")
        ok(pg.locator("#app [data-computer]").count() == 4, "A. one card a computer and Windows user")
        c1 = '#app [data-computer="%s"]' % D1
        ok(txt(c1 + " [data-card-name]") == "NWS144 \u00b7 anshul" and pg.get_attribute(c1, "data-card-state") == "Connected", "A. card 'NWS144 \u00b7 anshul', Connected (%s)" % txt(c1 + " [data-card-name]"))
        ok(txt(c1 + " [data-card-companies]") == "Reads GARG SHEKHAR (Alpha Traders \u203a)", "A. the companies it reads, with the client's link (%s)" % txt(c1 + " [data-card-companies]"))
        ok(re.match(r"^Last entry received 2 min ago \(\d\d:\d\d IST\)$", txt(c1 + " [data-card-last]")) is not None, "A. the last entry, IST (%s)" % txt(c1 + " [data-card-last]"))
        ok(pg.get_attribute('#app [data-computer="%s"]' % D2, "data-card-state") == "Not connected" and pg.get_attribute('#app [data-computer="%s"]' % D3, "data-card-state") == "Needs you",
           "A. Not connected / Needs you in words")
        ok(all(pg.locator('#app [data-computer] [data-status-line]').nth(i).locator("button").count() <= 1 for i in range(4)), "A. at most one main action a card")
        page = lambda: pg.inner_text("#app")
        ok("9005" not in page() and "port" not in page().lower().replace("ports and windows sessions", "") and pg.locator("#app [data-session0]").count() == 0,
           "2. no port and no session-0 Tally before Details is opened")
        ok("FinCom Bridge 2.3.4" not in page() and "Last request" not in page(), "2. the version and the requests only under Details")
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
        pg.click('#app [data-need-computer="%s"] [data-need-act="resume"]' % D4); pg.wait_for_timeout(700)
        ok(["tally_read_resume", {"p_device": D4}] in calls("tally_read_resume"), "3. Resume (Needs you) -> tally_read_resume")
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
        E("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"); pg.wait_for_timeout(700)
        hooks = [h for h in OWNER_HOOKS if pg.locator("#app [%s]" % h).count()]
        ok(not hooks, "4. staff: no owner button, Details open (%s)" % hooks)
        sn = E("() => [...document.querySelectorAll('#app [data-needs-you] li')].map(li => li.innerText.replace(/\\s+/g, ' ').trim())")
        ok(any("Tally hangs on the bank ledger" in x and "An owner of the firm can resume it." in x for x in sn), "4. staff: the stop's words, and who can resume it (%s)" % sn)
        ok("Posting settings:" in page() and "Trial tools on this computer: off" in page(), "4. staff: the settings' words")
        shot("staff-details-open")

        # ---- 5. the client's link line
        E("(cid) => openCompany(cid)", cid); pg.wait_for_timeout(500)
        scene(DEVS, LINKED); E("() => goClient('books:import')"); pg.wait_for_timeout(1200)
        lt = txt(link + " [data-tally-link-text]")
        ok(re.match(r"^Linked to GARG SHEKHAR on NWS144 \u00b7 last entry \d\d:\d\d IST \u00b7 Connected$", lt) is not None, "5. linked: one line (%r)" % lt)
        ok(pg.locator(link + " [data-update-now]").count() == 1 and pg.locator(link + " [data-tally-link-change]").count() == 1, "5. linked: Update now and Change company")
        ok(pg.locator("#app [data-upload-page] [data-update-now]").count() == 1, "5. From Tally: Update now once (on the link line)")
        pg.click(link + " [data-tally-link-change]"); pg.wait_for_timeout(300)
        opts = E("() => [...document.querySelectorAll('#app [data-tally-link-pick] option')].map(o => o.value)")
        ok("ABC LTD" in opts and "GARG SHEKHAR" in opts, "5. Change company offers the companies seen (%s)" % opts)
        pg.select_option("#app [data-tally-link-pick]", "ABC LTD"); pg.wait_for_timeout(800)
        ok(["tally_company_link", {"p_company": "ABC LTD", "p_client": cid}] in calls("tally_company_link"), "5. Change company -> tally_company_link (the same as Settings)")
        shot("client-linked")
        # held entries: that day's Day Book (and one other held line)
        scene(DEVS, LINKED, lines=HELD)
        E("() => { Rec.act.at = 0; if (Rec.actLoad) Rec.actLoad(); AlertHub.refresh(true); }"); pg.wait_for_timeout(2000); E("() => render()"); pg.wait_for_timeout(500)
        nd = E("() => [...document.querySelectorAll('#app [data-tally-link-needs] li')].map(li => [li.getAttribute('data-tally-need'), li.innerText.replace(/\\s+/g, ' ').trim()])")
        ok(not any(n[0] == "daybook" for n in nd) and pg.locator("#app [data-need-days]").count() == 1 and any(n[0] == "held" and n[1].endswith("See them") for n in nd),
           "5. From Tally: held entries one line with See them; the days that need a Day Book in their own section, not twice (%s)" % nd)
        shot("client-held")
        # Client setup -> Tally says the Day Book line too (From Tally lists the days in its own section instead)
        E("() => { S.tab = 'cotally'; render(); }"); pg.wait_for_timeout(800)
        nd2 = E("() => [...document.querySelectorAll('#app [data-tally-link-needs] li')].map(li => [li.getAttribute('data-tally-need'), li.innerText.replace(/\\s+/g, ' ').trim()])")
        ok(any(n[0] == "daybook" and n[1].endswith("Upload") for n in nd2), "5. Client setup -> Tally: the Day Book line with Upload (%s)" % nd2)
        shot("client-setup-held")
        E("() => goClient('books:import')"); pg.wait_for_timeout(1000)
        # stopped: the line says it, Resume for an owner
        stopped = [dict(d) for d in DEVS]; STOP1 = [{"id": 8, "device_id": D1, "action": "stop", "reason": "Tally slow", "stopped_at": "ago:5", "cleared_at": None, "stopped_by": None}]
        scene(stopped, LINKED, stops=STOP1); render_wait = pg.wait_for_timeout(800); E("() => render()"); pg.wait_for_timeout(500)
        lt = txt(link + " [data-tally-link-text]")
        ok("Reading stopped" in lt and "Tally slow" in lt and pg.locator(link + " [data-read-resume-line]").count() == 1 and pg.locator(link + " [data-update-now]").count() == 0, "5. stopped: said, with Resume (%r)" % lt)
        pg.click(link + " [data-read-resume-line]"); pg.wait_for_timeout(700)
        ok(["tally_read_resume", {"p_device": D1}] in calls("tally_read_resume"), "5. Resume on the link line -> tally_read_resume")
        shot("client-stopped")
        # not linked: three steps
        scene(DEVS, [{"company": "ABC LTD", "client_id": None, "device_id": D2, "gstin": "", "last_seen": "ago:1"}]); E("() => render()"); pg.wait_for_timeout(600)
        ok(E("document.querySelector('#app [data-tally-link]') && document.querySelector('#app [data-tally-link]').getAttribute('data-tally-link')") == "unlinked"
           and pg.locator("#app [data-tally-link-steps] li").count() == 3, "5. not linked: three numbered steps (%s)" % txt(link))
        shot("client-unlinked")
        # Client setup -> Tally: the same line at the top
        scene(DEVS, LINKED); E("() => { S.tab = 'cotally'; render(); }"); pg.wait_for_timeout(800)
        ok(pg.locator("#app [data-tally-link]").count() == 1 and "Linked to GARG SHEKHAR on NWS144" in txt(link), "5. Client setup -> Tally: the link line (%s)" % txt(link)[:80])
        shot("client-setup-tally")

        # ---- 6. phone width
        ph = br.new_page(viewport={"width": 390, "height": 844}); ph.on("pageerror", lambda e: errors.append(str(e)))
        ph.goto("http://localhost:%d/" % PORT); ph.wait_for_timeout(2500); ph.click('button[data-act="useOffline"]'); ph.wait_for_timeout(800)
        ph.evaluate("""() => { const g = newCompany({name: 'Alpha Traders', gstin: ''}); g.tallyName = 'GARG SHEKHAR'; S.companies[g.id] = g; S.data[g.id] = {parties: {}, entries: {}, loaded: true}; g.stats = {}; S.coId = g.id; }""")
        ph.evaluate(SETUP, [DEVS, STOPS, LINKED, "owner", []]); ph.evaluate("() => navHome('tally')"); ph.wait_for_timeout(1800)
        wide = ph.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        ok(wide <= 1, "6. phone width: no sideways scroll (%d px)" % wide)
        ok(ph.locator("#app [data-back-client]").count() == 1 and ph.locator("#app [data-needs-you]").count() == 1, "6. phone: Back link and Needs you")
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
