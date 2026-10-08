"""python3 run_bridges_page.py - the Tally page with FinCom Bridge as the only bridge (02-Oct-2026, the owner's decision):
before any bridge is heard from, one card with one button (Download FinCom Bridge), its fingerprint, direct link and
PowerShell command, and nothing of the older bridges (Connector, Tally Bridge, 1.15, .bat files, 2.0.0); once FinCom
Bridge is heard from, one line a computer (computer, Windows user, version, state with what to do) and the rest under
Details (every bridge heard from, Make this the main bridge, this computer's connection); a computer with only an older
bridge says to install FinCom Bridge, with the card; the hidden #/tally/bridge-1.15 shows bridge 1.15.0's setup.
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
OLD = ("Connector", "Tally Bridge", "1.15", "1.14", "Start-TDS-Bridge", "Setup-FinCom-Bridge", "TDSBridge", "2.0.0", "bridge window")
SETUP = """(devs) => {
  const now = new Date(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  window.__calls = [];
  TCloud.on = () => true; TCloud.refreshPane = async () => { render(); };
  TCloud.pane.at = Date.now(); TCloud.pane.err = ""; TCloud.pane.busy = ""; TCloud.pane.devices = fix(devs);
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, a]); TCloud.pane.devices[0].main_bridge = a.p_bridge; return {ok: true}; };
  document.body.classList.add("is-test");
  S.tallyOld = false; S.view = "home"; S.homeTab = "tally"; render();
}"""
NWS_BOTH = [{"id": "d-1", "name": "Office computer", "revoked": False, "last_seen": "ago:1", "version": "1.15.0", "main_bridge": None, "info": {"computer": "NWS144", "user": "anshul",
    "beat": {"at": "ago:1", "version": "1.15.0", "tally": False, "tallyState": "closed", "open": []},
    "bridges": {"v1": {"at": "ago:1", "version": "1.15.0", "computer": "NWS144", "user": "anshul", "mode": "main", "tally": False, "tallyState": "closed", "open": []},
                "go-3fa9c1d2e4b7": {"at": "ago:0.5", "version": "2.1.0", "computer": "NWS144", "user": "anshul", "mode": "test", "runMode": "user", "tally": True, "tallyState": "open", "open": ["Testing AAD"]}}}},
  {"id": "d-2", "name": "Server", "revoked": False, "last_seen": "ago:600", "version": "1.15.0", "info": {"computer": "TALLYSRV", "user": "tally1",
    "beat": {"at": "ago:600", "version": "1.15.0", "tally": True, "open": ["X"]}}}]
NWS_NEW = [{"id": "d-1", "name": "Office computer", "revoked": False, "last_seen": "ago:0.5", "version": "2.1.1", "main_bridge": "go-3fa9c1d2e4b7", "info": {"computer": "NWS144", "user": "anshul",
    "bridges": {"go-3fa9c1d2e4b7": {"at": "ago:0.5", "version": "2.1.1", "computer": "NWS144", "user": "anshul", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["ZZ TEST", "Testing AAD"]}}}}]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.1", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.1.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8203/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    # 1. nothing heard from yet: one card, one button
    E(SETUP, []); pg.wait_for_timeout(1500)
    card = "#app [data-bridge-card]"
    # 2.3.5: the three steps lead, step 1 with the download; the install card (fingerprint, link, PowerShell, the help when
    # Windows blocks it) is under the page's More
    GD = '#app [data-tally-guide] [data-guide-step="install"] [data-bridge-download]'
    ok(pg.locator(card).count() == 0 and pg.locator(GD).count() == 1 and pg.inner_text(GD) == "Download FinCom Bridge 2.1.1", "1. the steps: Install FinCom Bridge, with its download")
    pg.click("#app [data-bridge-details]"); pg.wait_for_timeout(500)
    ok(pg.locator(card).count() == 1, "1. one FinCom Bridge card, under More")
    ok(pg.locator(card + " a.btn, " + card + " button").count() == 1 and pg.inner_text(card + " [data-bridge-download]") == "Download FinCom Bridge 2.1.1",
       "1. with one button: Download FinCom Bridge 2.1.1")
    ok(pg.inner_text(card + " [data-bridge-sha]") == "ab" * 32 and pg.locator(card + " [data-bridge-link]").count() == 1 and "Invoke-WebRequest" in pg.inner_text(card + " [data-bridge-ps]"),
       "1. its fingerprint, direct link and PowerShell command beside it")
    t = pg.inner_text("#app")
    ok(not [x for x in OLD if x in t], "2. nothing of the older bridges on the page (%s)" % [x for x in OLD if x in t])
    ok("without an administrator" in pg.inner_text(card), "4. it says: just for you, without an administrator")
    # 5. FinCom Bridge heard from: one line, the rest under More
    E(SETUP, NWS_NEW); pg.wait_for_timeout(1200)
    pg.click("#app [data-bridge-details]"); pg.wait_for_timeout(500)   # fold the page's More again
    ln = pg.inner_text("#app [data-bridge-lines]")
    ok(pg.locator("#app [data-bridge-line]").count() == 1 and all(x in ln for x in ("NWS144", "anshul", "FinCom Bridge 2.1.1", "Connected", "Tally open: ZZ TEST, Testing AAD")),
       "5. one line: NWS144 · anshul · FinCom Bridge 2.1.1 · Connected · Tally open: the companies (%s)" % ln.replace("\n", " "))
    ok(pg.locator(card).count() == 0 and pg.locator("#app [data-bridges]").count() == 0 and pg.locator("#app [data-bridge-details]").count() == 1,
       "5. no card and no table: the download and the details behind More")
    t = pg.inner_text("#app")
    ok(not [x for x in OLD if x in t], "2. nothing of the older bridges (%s)" % [x for x in OLD if x in t])
    pg.click("#app [data-bridge-details]"); pg.wait_for_timeout(500)
    ok(pg.locator("#app [data-bridges] tbody tr").count() == 1 and "FinCom Bridge on this computer" in pg.inner_text("#app [data-bridge-more]") and pg.locator(card).count() == 1,
       "5. More: every bridge heard from, this computer's connection, and the download again")
    # offline: the line says what to do
    E("() => { TCloud.pane.devices[0].info.bridges['go-3fa9c1d2e4b7'].at = new Date(Date.now() - 3600000).toISOString(); render(); }"); pg.wait_for_timeout(500)
    st = pg.inner_text("#app [data-bridge-line]")
    ok("Offline since" in st and "sign in to Windows as anshul" in st and "Test connection" in st, "5. offline: since when, and what to do (%s)" % st.replace("\n", " "))
    # 1.15.0 still main beside a 2.1.0 test install, and a computer with only 1.15.0
    E(SETUP, NWS_BOTH); pg.wait_for_timeout(1200)
    lines = pg.locator("#app [data-bridge-line]")
    # 2.3.5: the card names the computer and the bridge; its status line says the problem and the one fix
    l1 = pg.inner_text('#app [data-computer]:has([data-bridge-line="go-3fa9c1d2e4b7"])'); l2 = pg.inner_text('#app [data-computer]:has([data-bridge-line="v1"])')
    ok(lines.count() == 2 and "FinCom Bridge 2.1.0" in l1 and "reads only" in l1 and "Older bridge" in l2 and "TALLYSRV" in l2 and "Needs FinCom Bridge" in l2 and "Install it on TALLYSRV" in l2,
       "a line a computer: NWS144's FinCom Bridge reads only; TALLYSRV has an older bridge: install FinCom Bridge (%s | %s)" % (l1.replace("\n", " "), l2.replace("\n", " ")))
    ok(pg.locator('#app [data-bridge-line="v1"] [data-bridge-download]').count() == 1, "a computer with only an older bridge: its line has the download")
    t = pg.inner_text("#app")
    ok(not [x for x in OLD if x in t], "2. the older bridges are named only 'Older bridge' (%s)" % [x for x in OLD if x in t])
    pg.click('#app [data-bridge-lines] [data-make-main="go-3fa9c1d2e4b7"]'); pg.wait_for_timeout(400)
    pg.click('.cbx button[data-cbx="yes"]'); pg.wait_for_timeout(800)
    ok(["tally_bridge_make_main", {"p_device": "d-1", "p_bridge": "go-3fa9c1d2e4b7"}] in E("window.__calls"), "Make this the main bridge (asked first), from the line")
    # Windows blocks it: the help, folded under the card (under the page's More)
    if not pg.locator(card).count(): pg.click("#app [data-bridge-details]"); pg.wait_for_timeout(500)
    pg.click(card + " details summary"); pg.wait_for_timeout(300)
    h = pg.inner_text("#app [data-install-help]")
    ok(all(x in h for x in ("Windows protected your PC", "More info", "Run anyway", "install.log")), "the help when Windows blocks the download or the setup, under the card")
    # 3. the hidden fallback
    pg.goto("http://localhost:8203/#/tally/bridge-1.15"); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E("() => Route.apply('#/tally/bridge-1.15')"); pg.wait_for_timeout(800)
    ob = pg.inner_text("#app [data-old-bridge]") if pg.locator("#app [data-old-bridge]").count() else ""
    ok("Bridge 1.15.0 (fallback)" in ob and "Download the bridge 1.15.0 setup" in ob and E("location.hash") == "#/tally/bridge-1.15", "3. #/tally/bridge-1.15 shows bridge 1.15.0's setup (%s)" % ob[:80].replace("\n", " "))
    E("() => navHome('clients')"); pg.wait_for_timeout(400); E("() => navHome('tally')"); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-old-bridge]").count() == 0 and E("location.hash") == "#/tally", "3. the Tally page in the sidebar is the normal one again")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
