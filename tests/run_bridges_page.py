"""python3 run_bridges_page.py - the Tally page (review of 02-Oct-2026): every bridge FinCom has heard from (computer,
Windows user, version, test or main, last seen, Tally, companies open), "Make this the main bridge" next to a bridge in
test mode (asked first, then tally_bridge_make_main), the old 2.0.0 shown with what to do, the steps with pictures when
Windows blocks the download or the setup, and an install log dropped on the page sent to FinCom support.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bridges_page.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8203), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => {
  const now = new Date(), ago = m => new Date(now - m * 60000).toISOString();
  window.__calls = [];
  TCloud.on = () => true; TCloud.refreshPane = async () => { render(); };
  TCloud.pane.at = Date.now(); TCloud.pane.err = ""; TCloud.pane.busy = "";
  TCloud.pane.devices = [
    {id: "d-1", name: "Office computer", revoked: false, last_seen: ago(1), version: "1.15.0", main_bridge: null, info: {computer: "NWS144", user: "anshul",
      beat: {at: ago(1), version: "1.15.0", tally: false, tallyState: "closed", open: []},
      bridges: {v1: {at: ago(1), version: "1.15.0", computer: "NWS144", user: "anshul", mode: "main", tally: false, tallyState: "closed", open: []},
                "go-3fa9c1d2e4b7": {at: ago(0.5), version: "2.1.0", computer: "NWS144", user: "anshul", mode: "test", runMode: "user", tally: true, tallyState: "open", open: ["Testing AAD", "Mastercad Solutions"]}}}},
    {id: "d-2", name: "Server", revoked: false, last_seen: ago(600), version: "1.15.0", info: {computer: "TALLYSRV", user: "tally1",
      beat: {at: ago(600), version: "1.15.0", tally: true, open: ["X"]}, shadow: {at: ago(600), version: "2.0.0", tally: true, open: ["X"]}}}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, a]); TCloud.pane.devices[0].main_bridge = a.p_bridge; return {ok: true}; };
  TCloudUp.post = async (body, who) => { window.__calls.push(["post", body.kind, body.name, body.text.length]); return {ok: true, path: "f/web/x-install.log"}; };
  document.body.classList.add("is-test");
  S.view = "home"; S.homeTab = "tally"; render();
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    # a build that ships no bridge (the default): the Tally page says 2.1.0 is being tested
    pg.goto("http://localhost:8203/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1500)
    ok("New bridge 2.1.0 is being tested; keep using bridge 1.15.0 for now." in pg.inner_text("#app [data-bridge-testing]") and pg.locator("#app a[download^=FinComBridge]").count() == 0,
       "no bridge download: 'New bridge 2.1.0 is being tested; keep using bridge 1.15.0 for now.'")
    # a build that ships one (FINCOM_SHIP_BRIDGE=1): its download, and the help when Windows blocks it
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.0", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.0.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8203/"); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1500)
    rows = pg.locator("#app [data-bridges] tbody tr")
    ok(rows.count() == 4, "four bridges listed: 2.1.0 and 1.15.0 on NWS144, 1.15.0 and the old 2.0.0 on TALLYSRV (%d)" % rows.count())
    go = pg.inner_text('#app [data-bridge-row="go-3fa9c1d2e4b7"]')
    ok(all(x in go for x in ("NWS144", "anshul", "FinCom Bridge 2.1.0", "just for this user", "Test: reads only", "online", "Tally open", "Testing AAD, Mastercad Solutions")),
       "2.1.0: NWS144, anshul, version, just for this user, test mode, online, Tally open, the companies open (%s)" % go.replace("\n", " | "))
    v1 = pg.inner_text('#app [data-bridge-row="v1"] >> nth=0')
    ok("Main: reads and posts" in v1 and "Bridge 1.15.0" in v1 and "Tally not seen" in v1, "1.15.0: the main bridge, Tally not seen (%s)" % v1.replace("\n", " | "))
    old = pg.inner_text('#app [data-bridge-row="old"]')
    ok("TALLYSRV" in old and "offline" in old and "Update it to 2.1 or later" in old, "the old 2.0.0 in test mode: offline, says to update it first")
    ok(pg.locator("#app [data-make-main]").count() == 1, "one button: Make this the main bridge, next to the bridge in test mode that can switch")
    pg.click('#app [data-make-main="go-3fa9c1d2e4b7"]'); pg.wait_for_timeout(400)
    t = pg.inner_text(".cbx")
    ok("FinCom Bridge 2.1.0" in t and "NWS144" in t and "stops posting at once" in t, "asked first: what changes, and that 1.15.0 stops posting")
    pg.click('.cbx button[data-cbx="yes"]'); pg.wait_for_timeout(800)
    calls = pg.evaluate("window.__calls")
    ok(["tally_bridge_make_main", {"p_device": "d-1", "p_bridge": "go-3fa9c1d2e4b7"}] in calls, "then tally_bridge_make_main for that computer and bridge")
    go = pg.inner_text('#app [data-bridge-row="go-3fa9c1d2e4b7"]'); v1 = pg.inner_text('#app [data-bridge-row="v1"] >> nth=0')
    ok("Main: reads and posts" in go and "Test: reads only" in v1 and pg.locator("#app [data-make-main]").count() == 0, "2.1.0 is now the main bridge; 1.15.0 reads only")
    # Windows blocks the download or the setup: the steps with pictures
    h = pg.inner_text("#app [data-install-help]")
    ok(all(x in h for x in ("Windows protected your PC", "More info", "Run anyway", "Just for me", "Keep anyway", "install.log")) and pg.locator("#app [data-install-help] svg").count() == 3,
       "SmartScreen (More info, Run anyway), the browser's Keep anyway, User Account Control (No, Just for me), with three pictures")
    pg.set_input_files("#app [data-install-log] input[type=file]", files=[{"name": "install.log", "mimeType": "text/plain", "buffer": b"2026-10-02 10:00:00  Install: the folder could not be written"}])
    pg.wait_for_timeout(800)
    calls = pg.evaluate("window.__calls")
    ok(["post", "install_log", "install.log", 61] in calls and "Sent install.log to FinCom support" in pg.inner_text("#app [data-install-log-sent]"), "an install log dropped on the page is sent, with its reference")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
