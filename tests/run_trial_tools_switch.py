"""python3 run_trial_tools_switch.py - round 19 (the owner's decision, 04-Oct): "Trial tools on this computer", per computer
on the Tally page (All clients -> Tally), owner only. The line says the state from tally_devices.trial_tools (migration 46;
default off); an owner's switch calls tally_device_trial_tools(p_device, p_on) and the page reads it back; staff see the
state only, no switch; without the column (42703) the line says "not available until migration 46 runs" and has no switch;
the RPC missing says the same in plain words.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_trial_tools_switch.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8293), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def dev(i, comp, trial=None):
    at = "ago:0.5"
    b = {"at": at, "version": "2.1.10", "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["GARG SHEKHAR & COMPANY"]}
    bt = {"at": at, "every": 30, "tally": True, "tallyState": "open", "open": ["GARG SHEKHAR & COMPANY"], "paused": False}
    d = {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": "2.1.10", "main_bridge": "go-" + i, "created_at": "2026-09-01T00:00:00Z",
         "info": {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}}
    if trial is not None: d["trial_tools"] = trial
    return d
D1, D2 = "d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002"
DEVS = [dev(D1, "NWS144", False), dev(D2, "TALLYSRV", True)]
SETUP = """([devs, stops, releases, role, extra]) => {
  extra = extra || {};
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  window.__fix = fix; window.__devs = fix(devs); window.__stops = fix(stops); window.__releases = fix(releases);
  window.__calls = []; window.__fail = null; window.__asked = [];
  window.__cursors = fix(extra.cursors || []); window.__books = fix(extra.books || []); window.__companies = fix(extra.companies || []); window.__old = !!extra.old;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = extra.members || [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    window.__asked.push(path);
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_read_stops/.test(path)) return copy(window.__stops);
    // an older cloud (before migration 37): no withdrawn_* columns, and tally_sync_cursor cannot be read by members
    if (/^tally_bridge_releases/.test(path)){ if (window.__old && /withdrawn/.test(path)) throw new Error("column tally_bridge_releases.withdrawn_at does not exist (42703)"); return copy(window.__releases); }
    if (/^tally_sync_cursor/.test(path)){ if (window.__old) throw new Error("permission denied for table tally_sync_cursor (42501)"); return copy(window.__cursors); }
    if (/^tally_books/.test(path)) return copy(window.__books);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (window.__fail) throw new Error(window.__fail); return {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; navHome("clients");
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.10", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.10.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8293/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    # FinCom 2.3.5, the simpler Tally page: the rest of a computer's card (and of the page) is under More; open them all
    more = lambda: (pg.evaluate("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"), pg.wait_for_timeout(500))
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    TT = lambda d: '#app [data-computer="%s"] [data-trial-tools]' % d
    SW = lambda d: TT(d) + " [data-trial-tools-switch]"
    side = pg.locator('#side button[aria-label="Tally"]')
    def page(role):
        E(SETUP, [DEVS, [], [], role]); pg.wait_for_timeout(500); side.first.click(); pg.wait_for_timeout(1500); more()
    page("owner")
    ok(pg.locator("#app [data-computer]").count() == 2, "two computers on the Tally page")
    t1, t2 = txt(TT(D1)), txt(TT(D2))
    ok("Trial tools on this computer" in t1 and "off" in t1, "owner: NWS144 says 'Trial tools on this computer: off' (%s)" % t1)
    ok("Trial tools on this computer" in t2 and "on" in t2.replace("Trial tools on this computer", ""), "owner: TALLYSRV says on (%s)" % t2)
    ok(pg.locator(SW(D1)).count() == 1 and pg.locator(SW(D2)).count() == 1, "owner: a switch on each computer")
    ok(any(("trial_tools" in a) for a in E("window.__asked") if a.startswith("tally_devices")), "the page reads tally_devices.trial_tools (%s)" % [a for a in E("window.__asked") if a.startswith("tally_devices")])
    pg.click(SW(D1)); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__calls") if c[0] == "tally_device_trial_tools"]
    ok(calls == [["tally_device_trial_tools", {"p_device": D1, "p_on": True}]], "owner: switching NWS144 on calls tally_device_trial_tools(p_device, p_on true) (%s)" % calls)
    E("() => { window.__calls = []; }")
    pg.click(SW(D2)); pg.wait_for_timeout(800)
    calls = [c for c in E("window.__calls") if c[0] == "tally_device_trial_tools"]
    ok(calls == [["tally_device_trial_tools", {"p_device": D2, "p_on": False}]], "owner: switching TALLYSRV off calls it with p_on false (%s)" % calls)
    # the RPC missing (migration 46 not run): plain words
    E("() => { window.__calls = []; window.__fail = 'Could not find the function public.tally_device_trial_tools(p_device, p_on) in the schema cache (PGRST202)'; }")
    pg.click(SW(D1)); pg.wait_for_timeout(800)
    ok("not available until migration 46 runs" in txt("#app [data-control-err]"), "owner: the RPC missing says 'not available until migration 46 runs' (%s)" % txt("#app [data-control-err]"))
    E("() => { window.__fail = null; }")
    # staff: the state, no switch
    page("staff")
    ok("Trial tools on this computer" in txt(TT(D1)) and "off" in txt(TT(D1)) and pg.locator(SW(D1)).count() == 0 and pg.locator(SW(D2)).count() == 0, "staff: the state only, no switch (%s)" % txt(TT(D1)))
    # the column missing (migration 46 not run): words, no switch; the rest of the page as before
    page("owner")
    E("""() => { window.__api0 = Cloud.api; Cloud.api = async (path) => { if (/^tally_devices/.test(path) && /trial_tools/.test(path)) throw new Error("column tally_devices.trial_tools does not exist (42703)"); return window.__api0(path); }; TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.busy = ''; }""")
    side.first.click(); pg.wait_for_timeout(300); E("() => TCloud.refreshPane()"); pg.wait_for_timeout(1200); more()
    ok(pg.locator("#app [data-computer]").count() == 2 and "not available until migration 46 runs" in txt(TT(D1)) and pg.locator(SW(D1)).count() == 0,
       "without the column: two computers still, 'not available until migration 46 runs', no switch (%s)" % txt(TT(D1)))
    # guard (a): the read test (Tally page -> Details -> Check my Tally -> Test reading entries) is the owner's only
    RT = "#app [data-read-test]"
    def details(role):
        page(role)
        E("""() => { Bridge.up = () => true; Bridge.on = () => true; Bridge.blocked = () => false; const c0 = Bridge.cfg(); Bridge.cfg = () => Object.assign({}, c0, {key: 'k'}); Bridge.st = Object.assign(Bridge.st || {}, {state: 'ok', tallyUp: true, open: [{name: 'GARG SHEKHAR & COMPANY'}], sessions: []});
          window.__bc = []; Bridge.call = async (u) => { window.__bc.push(u); return {tests: []}; }; render(); }"""); pg.wait_for_timeout(300)
        # 2.3.5: Details is the page's More (it may be open already: it stays open while FinCom is)
        if pg.locator("#app [data-bridge-details]").count() and not pg.locator("#app [data-bridge-more]").count(): pg.click("#app [data-bridge-details]"); pg.wait_for_timeout(500)
    details("owner")
    ok(pg.locator(RT).count() >= 1 and "Test reading entries" in txt(RT), "owner: 'Test reading entries' under Details (%d)" % pg.locator(RT).count())
    details("staff")
    ok(pg.locator(RT).count() == 0, "staff: no read test (%d)" % pg.locator(RT).count())
    E("() => { doAct('bridgeReadTest'); }"); pg.wait_for_timeout(300)
    ok(E("window.__bc") == [] and not E("S.readTest && S.readTest.busy"), "staff: the read test's action does nothing (%s)" % E("window.__bc"))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
