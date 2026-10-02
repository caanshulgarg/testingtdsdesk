"""python3 run_tally_computers.py - All clients -> Tally: one line a computer (plan piped-moseying-frost, item 14).
Each line: the bridge's version, its last request to Tally (kind, time taken, when) and its longest today, from the
heartbeat (info.beat.reqs / info.bridges[id].reqs), and the reading state: Reading / Paused / Stopped by itself: <why> /
Stopped from FinCom: <why> / Offline since ... . An owner has Stop reading on this computer, Stop reading on all
computers, Resume reading, Try version X on this computer and Approve version X for all computers (X: the setup on this
site, assets/bridge-go/latest.json); a member sees none of them. Each button calls its RPC (migration-35) with the right
arguments; a refusal is shown in plain words, and an older cloud without the RPCs says FinCom's cloud is not ready.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_computers.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8273), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the firm's computers as tally_devices keeps them (made-up): times are "ago:<minutes>"
def dev(i, comp, beat=None, extra=None, at="ago:0.5", version="2.1.4"):
    b = {"at": at, "version": version, "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["ZZ TEST"]}
    bt = {"at": at, "every": 30, "tally": True, "tallyState": "open", "open": ["ZZ TEST"], "paused": False}
    bt.update(beat or {}); b.update({k: v for k, v in (beat or {}).items() if k in ("reqs", "readStopped", "paused")})
    info = {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}
    info.update(extra or {})
    return {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": version, "main_bridge": "go-" + i, "info": info, "created_at": "2026-09-01T00:00:00Z"}
REQS = {"day": "TODAY", "last": {"kind": "vouchers", "ms": 1234, "at": "ago:2"}, "longest": {"kind": "ledgers", "ms": 8400, "at": "ago:120"}, "over20": 0, "n": 41}
DEVS = [
    dev("d0000000-0000-4000-8000-000000000001", "NWS144", {"reqs": REQS}),
    dev("d0000000-0000-4000-8000-000000000002", "TALLYSRV", {"paused": True, "reqs": {"day": "TODAY", "last": {"kind": "probe", "ms": 40, "at": "ago:1"}, "longest": {"kind": "probe", "ms": 90, "at": "ago:30"}, "over20": 0, "n": 3}}),
    dev("d0000000-0000-4000-8000-000000000003", "ACCTS2", {"readStopped": {"by": "self", "reason": "A request took 24 s (ledgers 696-699)", "at": "ago:15"},
        "reqs": {"day": "TODAY", "last": {"kind": "ledgers", "ms": 24100, "at": "ago:15"}, "longest": {"kind": "ledgers", "ms": 24100, "at": "ago:15"}, "over20": 1, "n": 9}}),
    dev("d0000000-0000-4000-8000-000000000004", "FRONTDESK", {"readStopped": {"by": "fincom", "reason": "Tally hangs on the bank ledger", "at": "ago:40"}},
        {"readStop": {"by": "fincom", "reason": "Tally hangs on the bank ledger", "at": "ago:40"}}),
    dev("d0000000-0000-4000-8000-000000000005", "LAPTOP", {}, None, at="ago:180", version="2.1.3")]
D1, D2, D3, D4, D5 = [d["id"] for d in DEVS]
STOPS = [{"id": 7, "device_id": D4, "action": "stop", "reason": "Tally hangs on the bank ledger", "stopped_at": "ago:40", "cleared_at": None}]
SETUP = """([devs, stops, releases, role]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  window.__fix = fix; window.__devs = fix(devs); window.__stops = fix(stops); window.__releases = fix(releases);
  window.__calls = []; window.__fail = null;
  Cloud.on = () => true; Cloud.st.firm = "f-1";
  TCloud.on = () => true;
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) return JSON.parse(JSON.stringify(window.__devs));
    if (/^tally_read_stops/.test(path)) return JSON.parse(JSON.stringify(window.__stops));
    if (/^tally_bridge_releases/.test(path)) return JSON.parse(JSON.stringify(window.__releases));
    return [];
  };
  TCloud.restAll = async () => [];
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (window.__fail) throw new Error(window.__fail); return {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; navHome("clients");
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.5", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.5.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8273/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    line = lambda d: txt('#app [data-computer="%s"]' % d)
    E(SETUP, [DEVS, STOPS, [], "owner"]); pg.wait_for_timeout(600)
    # ---- reachable as All clients -> Tally
    side = pg.locator('#side button[aria-label="Tally"]')
    ok(E("S.view") == "home" and E("S.homeTab") == "clients" and side.count() >= 1, "All clients has Tally in its menu")
    side.first.click(); pg.wait_for_timeout(1500)
    ok(E("S.homeTab") == "tally" and E("location.hash") == "#/tally" and pg.locator("#app [data-computers]").count() == 1, "All clients -> Tally: the page with one line a computer (%s)" % E("location.hash"))
    ok(pg.locator("#app [data-computer]").count() == 5, "one line a computer (%d)" % pg.locator("#app [data-computer]").count())
    hm = lambda m: E("(m) => tallyHm(Date.now() - m * 60000)", m)
    # ---- each state
    l1 = line(D1)
    ok("NWS144" in l1 and "FinCom Bridge 2.1.4" in l1 and "Reading" in l1 and pg.get_attribute('#app [data-computer="%s"]' % D1, "data-read-state") == "reading", "Reading: NWS144, version 2.1.4 (%s)" % l1)
    ok(("Last request: vouchers 1.2 s at %s" % hm(2)) in l1 and ("Longest today: ledgers 8.4 s at %s" % hm(120)) in l1, "the last request (kind, time, when) and the longest today (%s)" % l1)
    l2 = line(D2)
    ok("Paused" in l2 and pg.get_attribute('#app [data-computer="%s"]' % D2, "data-read-state") == "paused", "Paused (beat.paused) (%s)" % l2)
    l3 = line(D3)
    ok("Stopped by itself: A request took 24 s (ledgers 696-699)" in l3 and pg.get_attribute('#app [data-computer="%s"]' % D3, "data-read-state") == "selfstop" and "1 over 20 s" in l3,
       "Stopped by itself, with its reason, and the requests over 20 s (%s)" % l3)
    l4 = line(D4)
    ok("Stopped from FinCom: Tally hangs on the bank ledger" in l4 and pg.get_attribute('#app [data-computer="%s"]' % D4, "data-read-state") == "fincomstop", "Stopped from FinCom, with its reason (%s)" % l4)
    l5 = line(D5)
    ok("Offline since" in l5 and pg.get_attribute('#app [data-computer="%s"]' % D5, "data-read-state") == "offline" and "FinCom Bridge 2.1.3" in l5, "Offline since ... (%s)" % l5)
    # ---- the owner's buttons
    sel = lambda s: pg.locator("#app " + s)
    ok(sel('[data-read-stop="%s"]' % D1).count() == 1 and sel('[data-read-stop="%s"]' % D2).count() == 1 and sel('[data-read-resume="%s"]' % D3).count() == 1 and sel('[data-read-resume="%s"]' % D4).count() == 1
       and sel('[data-read-stop="%s"]' % D4).count() == 0 and sel("[data-read-stop-all]").count() == 1, "owner: Stop reading on a computer reading, Resume reading on one stopped, Stop reading on all computers")
    ok(txt('#app [data-read-stop="%s"]' % D1) == "Stop reading on this computer" and txt("#app [data-read-stop-all]") == "Stop reading on all computers" and txt('#app [data-read-resume="%s"]' % D4) == "Resume reading",
       "the buttons' words")
    ok(txt('#app [data-release-pilot="%s"]' % D1) == "Try version 2.1.5 on this computer" and txt("#app [data-release-approve]") == "Approve version 2.1.5 for all computers",
       "release: Try version 2.1.5 on this computer, Approve version 2.1.5 for all computers")
    # Stop reading on this computer: asked with a reason, then tally_read_stop(p_device, p_reason)
    sel('[data-read-stop="%s"]' % D1).click(); pg.wait_for_timeout(400)
    pg.fill("#confirmBox #readStopWhy", "Tally slow at month end"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_read_stop", {"p_device": D1, "p_reason": "Tally slow at month end"}] in E("window.__calls"), "Stop reading on this computer -> tally_read_stop(p_device, p_reason) (%s)" % E("window.__calls"))
    sel("[data-read-stop-all]").click(); pg.wait_for_timeout(400)
    pg.fill("#confirmBox #readStopWhy", "Bridge update"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_read_stop", {"p_device": None, "p_reason": "Bridge update"}] in E("window.__calls"), "Stop reading on all computers -> tally_read_stop(null, reason)")
    sel('[data-read-resume="%s"]' % D4).click(); pg.wait_for_timeout(600)
    ok(["tally_read_resume", {"p_device": D4}] in E("window.__calls"), "Resume reading -> tally_read_resume(p_device)")
    sel('[data-release-pilot="%s"]' % D1).click(); pg.wait_for_timeout(400)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_release_pilot", {"p_version": "2.1.5", "p_device": D1}] in E("window.__calls"), "Try version 2.1.5 on this computer -> tally_release_pilot(p_version, p_device)")
    # a refusal, in plain words: approve before a working day on the pilot
    E("() => { window.__fail = 'the pilot of 2.1.5 on NWS144 has not run a working day yet: it started 02-Oct 09:10; approve after 03-Oct 05:10'; }")
    sel("[data-release-approve]").click(); pg.wait_for_timeout(400)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    err = txt("#app [data-control-err]")
    ok(["tally_release_approve", {"p_version": "2.1.5"}] in E("window.__calls") and "has not run a working day yet" in err and "approve after 03-Oct 05:10" in err,
       "Approve version 2.1.5 for all computers -> tally_release_approve(p_version); refused: the reason shown (%s)" % err)
    # the cloud without migration-35
    E("() => { window.__fail = 'Could not find the function public.tally_read_stop(p_device, p_reason) in the schema cache'; }")
    sel('[data-read-stop="%s"]' % D2).click(); pg.wait_for_timeout(400)
    pg.fill("#confirmBox #readStopWhy", "x"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    err = txt("#app [data-control-err]")
    ok(err.startswith("FinCom’s cloud is not ready for this yet") or err.startswith("FinCom's cloud is not ready for this yet"), "an older cloud: 'FinCom's cloud is not ready for this yet' (%s)" % err)
    E("() => { window.__fail = null; }")
    # ---- every computer stopped from FinCom: only Resume reading on all computers
    E(SETUP, [DEVS, STOPS + [{"id": 8, "device_id": None, "action": "stop", "reason": "Bridge update", "stopped_at": "ago:1", "cleared_at": None}], [], "owner"]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    l1 = line(D1)
    ok("Stopped from FinCom: Bridge update" in l1 and sel("[data-read-resume]").count() == 0 and sel("[data-read-resume-all]").count() == 1 and sel("[data-read-stop]").count() == 0,
       "all computers stopped: every line says so, and only Resume reading on all computers (%s)" % l1)
    sel("[data-read-resume-all]").click(); pg.wait_for_timeout(600)
    ok(["tally_read_resume", {"p_device": None}] in E("window.__calls"), "Resume reading on all computers -> tally_read_resume(null)")
    # ---- a release in pilot, then approved
    E(SETUP, [DEVS, [], [{"version": "2.1.5", "pilot_device": D1, "pilot_started_at": "ago:300", "approved_at": None}], "owner"]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    ok("Version 2.1.5 on trial on NWS144" in txt("#app [data-release]") and sel("[data-release-pilot]").count() == 0, "a pilot going on: said, and no second pilot (%s)" % txt("#app [data-release]"))
    E(SETUP, [DEVS, [], [{"version": "2.1.5", "pilot_device": D1, "pilot_started_at": "ago:2000", "approved_at": "ago:10"}], "owner"]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    ok("Version 2.1.5 is approved for all computers" in txt("#app [data-release]") and sel("[data-release-approve]").count() == 0, "approved: said, no button (%s)" % txt("#app [data-release]"))
    # ---- a member: the lines, no buttons
    E(SETUP, [DEVS, STOPS, [], "member"]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-computer]").count() == 5 and "Stopped from FinCom: Tally hangs on the bank ledger" in line(D4), "a member sees the lines")
    ok(sel("[data-read-stop], [data-read-stop-all], [data-read-resume], [data-read-resume-all], [data-release-pilot], [data-release-approve]").count() == 0, "a member sees none of the owner's buttons")
    # ---- live: a beat passed on by FinCom's cloud changes the line at once
    E("""() => TLight.beatIn({device: '%s', beat: {at: new Date().toISOString(), bridge: 'go-%s', paused: false, readStopped: {by: 'self', reason: 'Tally did not answer for 2 minutes', at: new Date().toISOString()},
      reqs: {day: new Date().toISOString().slice(0, 10), last: {kind: 'probe', ms: 120000, at: new Date().toISOString()}, longest: {kind: 'probe', ms: 120000, at: new Date().toISOString()}, over20: 1, n: 5}}})""" % (D2, D2))
    pg.wait_for_timeout(400)
    ok("Stopped by itself: Tally did not answer for 2 minutes" in line(D2), "a beat passed on at once: the line follows (%s)" % line(D2))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
