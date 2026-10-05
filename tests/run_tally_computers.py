"""python3 run_tally_computers.py - All clients -> Tally: one line a computer (plan piped-moseying-frost, item 14).
Each line: the bridge's version, its last request to Tally (kind, time taken, when) and its longest today, from the
heartbeat (info.beat.reqs / info.bridges[id].reqs), and the reading state: Reading / Paused / Stopped by itself: <why> /
Stopped from FinCom: <why> / Offline since ... . An owner has Stop reading on this computer, Stop reading on all
computers, Resume reading, and (the owner's rule of 05-Oct-2026: new versions go to every computer by themselves, no
pilot, no approval) Hold version X, Let version X go, Roll back to <version>, Clear the rollback and Withdraw version X
(X: the setup on this site, assets/bridge-go/latest.json); a member sees none of them. Each button calls its RPC (migration-35) with the right
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
def dev(i, comp, beat=None, extra=None, at="ago:0.5", version="2.1.4", post=None):
    b = {"at": at, "version": version, "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["ZZ TEST"]}
    bt = {"at": at, "every": 30, "tally": True, "tallyState": "open", "open": ["ZZ TEST"], "paused": False}
    bt.update(beat or {}); b.update({k: v for k, v in (beat or {}).items() if k in ("reqs", "readStopped", "paused")})
    info = {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}
    info.update(extra or {})
    d = {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": version, "main_bridge": "go-" + i, "info": info, "created_at": "2026-09-01T00:00:00Z"}
    d.update(post or {})
    return d
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
# FinCom Bridge 2.1.6 posts only to the companies in its PostOnly setting; the heartbeat carries postOnly and tally-ingest
# keeps it on the bridge entry (info.bridges[id].postOnly). NWS144: one company; ACCTS2: two; the others: none ([] or absent)
DEVS[0]["info"]["bridges"]["go-" + D1]["postOnly"] = ["ZZ TEST"]
DEVS[1]["info"]["bridges"]["go-" + D2]["postOnly"] = []
DEVS[2]["info"]["bridges"]["go-" + D3]["postOnly"] = ["ZZ TEST", "ABC LTD"]
# round 15 (F3): the posting settings saved by an owner (tally_devices.post_only / post_batch_bills / post_batch_bank, migration
# 43) and the values the bridge APPLIED (info.beat.postOnly / postBatchBills / postBatchBank / settingsAt). NWS144: saved and
# applied agree; ACCTS2: saved 20 bills, the bridge still applies 10 (waiting); TALLYSRV: nothing saved, the bridge's defaults
DEVS[0].update({"post_only": ["ZZ TEST"], "post_batch_bills": 10, "post_batch_bank": 50, "post_settings_at": "ago:30", "post_settings_by": "u-1"})
DEVS[0]["info"]["beat"].update({"postOnly": ["ZZ TEST"], "postBatchBills": 10, "postBatchBank": 50, "settingsAt": "ago:30"})
DEVS[2].update({"post_only": ["ZZ TEST", "ABC LTD"], "post_batch_bills": 20, "post_batch_bank": 50, "post_settings_at": "ago:0.3", "post_settings_by": "u-1"})
DEVS[2]["info"]["beat"].update({"postOnly": ["ZZ TEST", "ABC LTD"], "postBatchBills": 10, "postBatchBank": 50, "settingsAt": "ago:5"})
DEVS[1]["info"]["beat"].update({"postOnly": [], "postBatchBills": 10, "postBatchBank": 50})
STOPS = [{"id": 7, "device_id": D4, "action": "stop", "reason": "Tally hangs on the bank ledger", "stopped_at": "ago:40", "cleared_at": None}]
SETUP = """([devs, stops, releases, role, extra]) => {
  extra = extra || {};
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  window.__fix = fix; window.__devs = fix(devs); window.__stops = fix(stops); window.__releases = fix(releases); window.__rollbacks = fix(extra.rollbacks || []);
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
    if (/^tally_bridge_releases/.test(path)){ if (window.__old && /withdrawn|held/.test(path)) throw new Error("column tally_bridge_releases.withdrawn_at does not exist (42703)"); return copy(window.__releases); }
    if (/^tally_bridge_rollbacks/.test(path)){ if (window.__old) throw new Error("relation tally_bridge_rollbacks does not exist (42P01)"); return copy(window.__rollbacks); }
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
    # the fixture times were set when the page loaded; if the minute turned since, the line shows the earlier minute
    # a time shown "N minutes ago": the fixture and the page read the clock seconds apart, so a minute either way
    inAny = lambda fmt, m, text: any((fmt % hm(x)) in text for x in (m - 1, m, m + 1))
    hmIn = lambda text, m: any(("at %s" % hm(x)) in text for x in (m - 1, m, m + 1))   # the fixture and the page read the clock seconds apart: a minute either way
    # ---- each state
    l1 = line(D1)
    ok("NWS144" in l1 and "FinCom Bridge 2.1.4" in l1 and "Reading" in l1 and pg.get_attribute('#app [data-computer="%s"]' % D1, "data-read-state") == "reading", "Reading: NWS144, version 2.1.4 (%s)" % l1)
    ok("Last request: vouchers 1.2 s" in l1 and hmIn(l1, 2) and "Longest today: ledgers 8.4 s" in l1 and hmIn(l1, 120), "the last request (kind, time, when) and the longest today (%s)" % l1)
    l2 = line(D2)
    ok("Paused" in l2 and pg.get_attribute('#app [data-computer="%s"]' % D2, "data-read-state") == "paused", "Paused (beat.paused) (%s)" % l2)
    l3 = line(D3)
    ok("Stopped by itself: A request took 24 s (ledgers 696-699)" in l3 and pg.get_attribute('#app [data-computer="%s"]' % D3, "data-read-state") == "selfstop" and "1 over 20 s" in l3,
       "Stopped by itself, with its reason, and the requests over 20 s (%s)" % l3)
    l4 = line(D4)
    ok("Stopped from FinCom: Tally hangs on the bank ledger" in l4 and pg.get_attribute('#app [data-computer="%s"]' % D4, "data-read-state") == "fincomstop", "Stopped from FinCom, with its reason (%s)" % l4)
    l5 = line(D5)
    ok("Offline since" in l5 and pg.get_attribute('#app [data-computer="%s"]' % D5, "data-read-state") == "offline" and "FinCom Bridge 2.1.3" in l5, "Offline since ... (%s)" % l5)
    # ---- 2.1.6: the bridge posts only to the companies in its PostOnly setting (info.bridges[id].postOnly, else info.beat.postOnly)
    ok("Posts only to: ZZ TEST" in l1 and "ABC LTD" not in l1, "PostOnly: a bridge restricted to ZZ TEST says Posts only to: ZZ TEST (%s)" % l1)
    ok("Posts only to" not in l2 and "Posts only to" not in l4 and "Posts only to" not in l5, "PostOnly: an empty or absent list says nothing")
    ok("Posts only to: ZZ TEST, ABC LTD" in l3, "PostOnly: two names, joined with a comma (%s)" % l3)
    # ---- round 15 (F3): Posting settings on the computer's line: the applied values (info.beat), the owner's editor,
    # Save -> tally_device_post_settings(p_device, p_post_only, p_bills, p_bank), "waiting for the bridge to apply" while
    # the saved values differ from the applied ones; a member sees the values only; without migration 43 the page says so
    PS = lambda d: '#app [data-computer="%s"] [data-post-settings]' % d
    ps1, ps2, ps3 = txt(PS(D1)), txt(PS(D2)), txt(PS(D3))
    ok(pg.locator(PS(D1)).count() == 1 and "Posting settings" in ps1 and "ZZ TEST" in ps1 and "10 bills per request" in ps1 and "50 bank lines per request" in ps1 and "waiting for the bridge" not in ps1,
       "F3. NWS144: Posting settings: posts only to ZZ TEST · 10 bills per request · 50 bank lines per request, applied (%s)" % ps1)
    ok("any company" in ps2 and "10 bills per request" in ps2 and "50 bank lines per request" in ps2 and "waiting" not in ps2, "F3. TALLYSRV: nothing saved: posts to any company, the bridge's 10 and 50 (%s)" % ps2)
    ok("10 bills per request" in ps3 and "20 bills" not in ps3.split("waiting")[0] and "waiting for the bridge to apply (within a minute)" in ps3 and pg.locator(PS(D3) + " [data-ps-waiting]").count() == 1,
       "F3. ACCTS2: the line shows the APPLIED 10 bills, and 'waiting for the bridge to apply (within a minute)' for the saved 20 (%s)" % ps3)
    ok("Posts only to: ZZ TEST, ABC LTD" in line(D3), "F3. the old 'Posts only to' display stays (the applied value)")
    ok(pg.locator(PS(D1) + " [data-ps-edit]").count() == 1, "F3. the owner has Edit")
    pg.click(PS(D1) + " [data-ps-edit]"); pg.wait_for_timeout(300)
    ok(pg.locator(PS(D1) + " input[data-ps-only]").count() == 1 and pg.locator(PS(D1) + " input[data-ps-bills]").count() == 1 and pg.locator(PS(D1) + " input[data-ps-bank]").count() == 1 and pg.locator(PS(D1) + " [data-ps-save]").count() == 1,
       "F3. the editor: Posts only to, bills per request, bank lines per request, Save")
    ok(pg.input_value(PS(D1) + " input[data-ps-only]") == "ZZ TEST" and pg.input_value(PS(D1) + " input[data-ps-bills]") == "10" and pg.input_value(PS(D1) + " input[data-ps-bank]") == "50", "F3. the editor starts from the saved values")
    pg.fill(PS(D1) + " input[data-ps-bills]", "600"); pg.click(PS(D1) + " [data-ps-save]"); pg.wait_for_timeout(300)
    ok(not [c for c in E("window.__calls") if c[0] == "tally_device_post_settings"] and "1 to 500" in txt(PS(D1)), "F3. 600 bills a request: refused here (1 to 500), nothing sent (%s)" % txt(PS(D1))[-80:])
    pg.fill(PS(D1) + " input[data-ps-only]", "ZZ TEST, ABC LTD , ZZ TEST"); pg.fill(PS(D1) + " input[data-ps-bills]", "25"); pg.fill(PS(D1) + " input[data-ps-bank]", "100"); pg.click(PS(D1) + " [data-ps-save]"); pg.wait_for_timeout(600)
    calls = [c for c in E("window.__calls") if c[0] == "tally_device_post_settings"]
    ok(calls == [["tally_device_post_settings", {"p_device": D1, "p_post_only": ["ZZ TEST", "ABC LTD"], "p_bills": 25, "p_bank": 100}]], "F3. Save -> tally_device_post_settings(p_device, p_post_only [names, trimmed, no repeats], p_bills, p_bank) (%s)" % calls)
    # review must-fix: a Save that did not touch the names box sends p_post_only null (the row's value, and an installer-set
    # PostOnly, stay); clearing a named list asks first and sends [] (any company) only on yes
    E("() => { window.__calls = []; }")
    pg.click(PS(D1) + " [data-ps-edit]"); pg.wait_for_timeout(300); pg.fill(PS(D1) + " input[data-ps-bills]", "30"); pg.click(PS(D1) + " [data-ps-save]"); pg.wait_for_timeout(600)
    calls = [c for c in E("window.__calls") if c[0] == "tally_device_post_settings"]
    ok(calls == [["tally_device_post_settings", {"p_device": D1, "p_post_only": None, "p_bills": 30, "p_bank": 50}]] and pg.locator("#confirmBox .cbx").count() == 0, "F3. a batch-size-only Save sends p_post_only null, no question (%s)" % calls)
    E("() => { window.__calls = []; }")
    pg.click(PS(D1) + " [data-ps-edit]"); pg.wait_for_timeout(300); pg.fill(PS(D1) + " input[data-ps-only]", ""); pg.click(PS(D1) + " [data-ps-save]"); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox .cbx").count() == 1 and "Posting to any company from this computer?" in pg.inner_text("#confirmBox") and not [c for c in E("window.__calls") if c[0] == "tally_device_post_settings"],
       "F3. clearing a named list asks 'Posting to any company from this computer?' before anything is sent (%s)" % pg.inner_text("#confirmBox").replace(chr(10), " ")[:120])
    pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(400)
    ok(not [c for c in E("window.__calls") if c[0] == "tally_device_post_settings"] and pg.locator(PS(D1) + " input[data-ps-only]").count() == 1, "F3. No: nothing sent, the editor stays open")
    pg.click(PS(D1) + " [data-ps-save]"); pg.wait_for_timeout(400); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    calls = [c for c in E("window.__calls") if c[0] == "tally_device_post_settings"]
    ok(len(calls) == 1 and calls[0][1]["p_post_only"] == [] and calls[0][1]["p_device"] == D1, "F3. Yes: an empty 'Posts only to' is sent as [] (any company) (%s)" % calls)
    # the RPC missing (migration 43 not run): plain words, not an error code
    E("() => { window.__calls = []; window.__fail = 'Could not find the function public.tally_device_post_settings(p_bank, p_bills, p_device, p_post_only) in the schema cache (PGRST202)'; }")
    pg.click(PS(D1) + " [data-ps-edit]"); pg.wait_for_timeout(300); pg.click(PS(D1) + " [data-ps-save]"); pg.wait_for_timeout(600)
    ok("not available until migration 43 runs" in txt("#app [data-control-err]") + txt(PS(D1)), "F3. the RPC missing: 'not available until migration 43 runs' (%s)" % (txt("#app [data-control-err]") or txt(PS(D1)))[-120:])
    E("() => { window.__fail = null; }")
    # a member: the values, no editor
    E(SETUP, [DEVS, STOPS, [], "member"]); pg.wait_for_timeout(600); side.first.click(); pg.wait_for_timeout(1200)
    ok(pg.locator(PS(D1)).count() == 1 and "10 bills per request" in txt(PS(D1)) and pg.locator(PS(D1) + " [data-ps-edit], " + PS(D1) + " input, " + PS(D1) + " [data-ps-save]").count() == 0, "F3. a member sees the values, no editor (%s)" % txt(PS(D1)))
    # the columns missing (migration 43 not run): the page still works, and says so
    E("""() => { window.__api0 = Cloud.api; Cloud.api = async (path) => { if (/^tally_devices/.test(path) && /post_only/.test(path)) throw new Error("column tally_devices.post_only does not exist (42703)"); return window.__api0(path); }; TCloud.pane.at = 0; }""")
    E(SETUP, [DEVS, STOPS, [], "owner"]); pg.wait_for_timeout(400)
    E("() => { Cloud.api = async (path) => { if (/^tally_devices/.test(path) && /post_only/.test(path)) throw new Error('column tally_devices.post_only does not exist (42703)'); window.__asked.push(path); if (/^tally_devices/.test(path)) return JSON.parse(JSON.stringify(window.__devs)); return []; }; TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.busy = ''; }")
    side.first.click(); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-computer]").count() == 5 and "not available until migration 43 runs" in txt(PS(D1)) and pg.locator(PS(D1) + " [data-ps-edit]").count() == 0 and "Posts only to: ZZ TEST" in line(D1),
       "F3. without the columns: one line a computer still, 'not available until migration 43 runs', the applied Posts only to stays (%s)" % txt(PS(D1)))
    E(SETUP, [DEVS, STOPS, [], "owner"]); pg.wait_for_timeout(300); side.first.click(); pg.wait_for_timeout(1200)
    # ---- the owner's buttons
    sel = lambda s: pg.locator("#app " + s)
    ok(sel('[data-read-stop="%s"]' % D1).count() == 1 and sel('[data-read-stop="%s"]' % D2).count() == 1 and sel('[data-read-resume="%s"]' % D3).count() == 1 and sel('[data-read-resume="%s"]' % D4).count() == 1
       and sel('[data-read-stop="%s"]' % D4).count() == 0 and sel("[data-read-stop-all]").count() == 1, "owner: Stop reading on a computer reading, Resume reading on one stopped, Stop reading on all computers")
    ok(txt('#app [data-read-stop="%s"]' % D1) == "Stop reading on this computer" and txt("#app [data-read-stop-all]") == "Stop reading on all computers" and txt('#app [data-read-resume="%s"]' % D4) == "Resume reading",
       "the buttons' words")
    ok(sel("[data-release-pilot], [data-release-approve]").count() == 0 and txt("#app [data-release-hold]") == "Hold version 2.1.5" and txt("#app [data-release-rollback]") == "Roll back to an earlier version",
       "A. no pilot and no approval: the owner has Hold version 2.1.5 and Roll back to an earlier version (%s)" % txt("#app [data-release]"))
    ok("goes to every computer by itself" in txt("#app [data-release]"), "A. the words: version 2.1.5 goes to every computer by itself (%s)" % txt("#app [data-release]"))
    # Stop reading on this computer: asked with a reason, then tally_read_stop(p_device, p_reason)
    sel('[data-read-stop="%s"]' % D1).click(); pg.wait_for_timeout(400)
    pg.fill("#confirmBox #readStopWhy", "Tally slow at month end"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_read_stop", {"p_device": D1, "p_reason": "Tally slow at month end"}] in E("window.__calls"), "Stop reading on this computer -> tally_read_stop(p_device, p_reason) (%s)" % E("window.__calls"))
    sel("[data-read-stop-all]").click(); pg.wait_for_timeout(400)
    pg.fill("#confirmBox #readStopWhy", "Bridge update"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_read_stop", {"p_device": None, "p_reason": "Bridge update"}] in E("window.__calls"), "Stop reading on all computers -> tally_read_stop(null, reason)")
    sel('[data-read-resume="%s"]' % D4).click(); pg.wait_for_timeout(600)
    ok(["tally_read_resume", {"p_device": D4}] in E("window.__calls"), "Resume reading -> tally_read_resume(p_device)")
    if sel("[data-release-hold]").count(): sel("[data-release-hold]").click(); pg.wait_for_timeout(400)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(not [c for c in E("window.__calls") if c[0] == "tally_release_hold"], "A. Hold without a reason: asked for one, nothing sent")
    if pg.locator("#confirmBox #holdWhy").count(): pg.fill("#confirmBox #holdWhy", "posting broke on NWS144"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_release_hold", {"p_version": "2.1.5", "p_why": "posting broke on NWS144"}] in E("window.__calls"), "A. Hold version 2.1.5 -> tally_release_hold(p_version, p_why)")
    if sel("[data-release-rollback]").count(): sel("[data-release-rollback]").click(); pg.wait_for_timeout(400)
    if pg.locator("#confirmBox #rollbackVersion").count():
        pg.fill("#confirmBox #rollbackVersion", "2.1.4"); pg.fill("#confirmBox #rollbackWhy", "posting broke"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_release_rollback", {"p_version": "2.1.4", "p_why": "posting broke"}] in E("window.__calls"), "A. Roll back to 2.1.4 -> tally_release_rollback(p_version, p_why)")
    # a refusal, in plain words
    E("() => { window.__fail = 'only an owner of the firm can hold a bridge version'; }")
    if sel("[data-release-hold]").count(): sel("[data-release-hold]").click(); pg.wait_for_timeout(400)
    if pg.locator("#confirmBox #holdWhy").count(): pg.fill("#confirmBox #holdWhy", "x"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    err = txt("#app [data-control-err]")
    ok("only an owner of the firm can hold a bridge version" in err.lower(), "A. refused: the reason shown (%s)" % err)
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
    # ---- A: a version held, then let go; a rollback standing, then cleared
    E(SETUP, [DEVS, [], [{"version": "2.1.5", "held_at": "ago:30", "held_by": "u-1", "held_why": "posting broke on NWS144", "withdrawn_at": None}], "owner"]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    rl = txt("#app [data-release]")
    ok("Version 2.1.5 is held" in rl and "posting broke on NWS144" in rl and sel("[data-release-hold]").count() == 0 and txt("#app [data-release-unhold]") == "Let version 2.1.5 go", "A. held: said with why; Let version 2.1.5 go (%s)" % rl)
    sel("[data-release-unhold]").click(); pg.wait_for_timeout(400)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(any(c[0] == "tally_release_unhold" and c[1].get("p_version") == "2.1.5" for c in E("window.__calls")), "A. Let it go -> tally_release_unhold")
    E(SETUP, [DEVS, [], [], "owner", {"rollbacks": [{"version": "2.1.4", "why": "posting broke", "set_by": "u-1", "set_at": "ago:20"}]}]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    rl = txt("#app [data-release]")
    ok("Rolled back to version 2.1.4" in rl and "posting broke" in rl and txt("#app [data-release-rollback-clear]") == "Clear the rollback", "A. a rollback standing: said, with Clear the rollback (%s)" % rl)
    sel("[data-release-rollback-clear]").click(); pg.wait_for_timeout(400)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(any(c[0] == "tally_release_rollback_clear" for c in E("window.__calls")), "A. Clear the rollback -> tally_release_rollback_clear")
    # ---- a member: the lines, no buttons
    E(SETUP, [DEVS, STOPS, [], "member"]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-computer]").count() == 5 and "Stopped from FinCom: Tally hangs on the bank ledger" in line(D4), "a member sees the lines")
    ok("Posts only to: ZZ TEST" in line(D1), "a member sees Posts only to: ZZ TEST too (information, not a control)")
    ok(sel("[data-read-stop], [data-read-stop-all], [data-read-resume], [data-read-resume-all], [data-release-pilot], [data-release-approve], [data-release-hold], [data-release-rollback]").count() == 0, "a member sees none of the owner's buttons")
    # ---- live: a beat passed on by FinCom's cloud changes the line at once
    E("""() => TLight.beatIn({device: '%s', beat: {at: new Date().toISOString(), bridge: 'go-%s', paused: false, readStopped: {by: 'self', reason: 'Tally did not answer for 2 minutes', at: new Date().toISOString()},
      reqs: {day: new Date().toISOString().slice(0, 10), last: {kind: 'probe', ms: 120000, at: new Date().toISOString()}, longest: {kind: 'probe', ms: 120000, at: new Date().toISOString()}, over20: 1, n: 5}}})""" % (D2, D2))
    pg.wait_for_timeout(400)
    ok("Stopped by itself: Tally did not answer for 2 minutes" in line(D2), "a beat passed on at once: the line follows (%s)" % line(D2))
    # ---- device-sent text (the stop's reason, a request's kind) is shown as text, never as HTML (security review, 2.1.5)
    dialogs = []; pg.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    XR, XK = "<img src=x onerror=alert(1)>", "<img src=y onerror=alert(2)>"
    E("""([d, xr, xk]) => TLight.beatIn({device: d, beat: {at: new Date().toISOString(), bridge: 'go-' + d, paused: false, readStopped: {by: 'self', reason: xr, at: new Date().toISOString()},
      reqs: {day: new Date().toISOString().slice(0, 10), last: {kind: xk, ms: 1500, at: new Date().toISOString()}, longest: {kind: xk, ms: 1500, at: new Date().toISOString()}, over20: 0, n: 2}}})""", [D2, XR, XK])
    pg.wait_for_timeout(600)
    l2 = line(D2)
    ok(("Stopped by itself: " + XR) in l2 and ("Last request: " + XK) in l2 and pg.locator('#app [data-computer="%s"] img' % D2).count() == 0 and not dialogs,
       "a reason and a request kind with HTML in them are shown as text (%s; dialogs %s)" % (l2, dialogs))
    # ---- round 4 (plan items 24, 23, 10): who and when, Withdraw version X, a fresh baseline
    MEMBERS = [{"user_id": "u-anshul", "name": "Anshul"}, {"user_id": "u-neha", "email": "neha@fincom.in"}]
    STOPS2 = [{"id": 7, "device_id": D4, "action": "stop", "reason": "Tally hangs on the bank ledger", "stopped_at": "ago:40", "stopped_by": "u-anshul", "cleared_at": None, "cleared_by": None},
              {"id": 6, "device_id": D2, "action": "stop", "reason": "Month end", "stopped_at": "ago:200", "stopped_by": "u-anshul", "cleared_at": "ago:100", "cleared_by": "u-neha"},
              {"id": 5, "device_id": None, "action": "resume", "reason": "", "stopped_at": "ago:300", "stopped_by": "u-neha", "cleared_at": None, "cleared_by": None}]
    REL = [{"version": "2.1.5", "pilot_device": D1, "pilot_started_at": "ago:300", "pilot_by": "u-anshul", "approved_at": None, "approved_by": None, "withdrawn_at": None, "withdrawn_by": None, "withdrawn_why": None}]
    BOOKS = [{"book_id": "b0000000-0000-4000-8000-000000000001", "client_id": "c1", "company": "ZZ TEST"}]
    COS = [{"company": "ZZ TEST", "client_id": "c1", "device_id": D1, "gstin": "", "last_seen": "ago:1", "linked_at": "ago:9000"}]
    CUR = [{"book_id": BOOKS[0]["book_id"], "state": "needs_baseline", "state_why": "AlterID went backwards (a restore in Tally?)", "state_at": "ago:50", "cleared_at": None, "cleared_by": None, "cleared_note": None}]
    X = {"members": MEMBERS, "books": BOOKS, "companies": COS, "cursors": CUR}
    E(SETUP, [DEVS, STOPS2, REL, "owner", X]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    l4, l2, l1 = line(D4), line(D2), line(D1)
    ok("Stopped by Anshul at" in l4 and hmIn(l4, 40) and ": Tally hangs on the bank ledger" in l4, "24. a computer stopped from FinCom: Stopped by <name> at <time>: <reason> (%s)" % l4)
    ok("Resumed by neha@fincom.in at" in l2 and hmIn(l2, 100), "24. a computer resumed: Resumed by <name> at <time>, the member's e-mail when there is no name (%s)" % l2)
    ok("Resumed by neha@fincom.in at" in l1 and hmIn(l1, 300), "24. a resume of all computers shows on a computer with no own stop or resume since (%s)" % l1)
    rel = txt("#app [data-release]")
    ok("Pilot started" not in rel and "Approve" not in rel, "A. no pilot or approval words any more (%s)" % rel)
    ok(txt("#app [data-release-withdraw]") == "Withdraw version 2.1.5", "23. owner: Withdraw version 2.1.5")
    sel("[data-release-withdraw]").click(); pg.wait_for_timeout(400)
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx-err").count() == 1 and not [c for c in E("window.__calls") if c[0] == "tally_release_withdraw"], "23. Withdraw without a reason: asked for one, nothing sent")
    pg.fill("#confirmBox #withdrawWhy", "Crashes on NWS144 at the bank ledger"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_release_withdraw", {"p_version": "2.1.5", "p_why": "Crashes on NWS144 at the bank ledger"}] in E("window.__calls"), "23. Withdraw version 2.1.5 -> tally_release_withdraw(p_version, p_why) (%s)" % E("window.__calls"))
    # withdrawn (after an approval): said with who, when and why; no Approve, no Withdraw; a new pilot is allowed
    REL_W = [dict(REL[0], approved_at="ago:10", approved_by="u-neha", withdrawn_at="ago:1", withdrawn_by="u-anshul", withdrawn_why="Crashes on NWS144 at the bank ledger")]
    E(SETUP, [DEVS, STOPS2, REL_W, "owner", X]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    rel = txt("#app [data-release]")
    ok(any(("Withdrawn by Anshul at %s: Crashes on NWS144 at the bank ledger" % hm(x)) in rel for x in (0, 1, 2)) and "withdrawn" in rel.lower(), "23. withdrawn: Withdrawn by <name> at <time>: <why> (%s)" % rel)
    ok(sel("[data-release-approve], [data-release-pilot], [data-release-withdraw]").count() == 0, "23. withdrawn: no Withdraw (and no pilot or approval)")
    REL_A = REL
    # 10. a company of the computer needing a fresh baseline
    bl = txt('#app [data-computer="%s"] [data-baseline="%s"]' % (D1, BOOKS[0]["book_id"]))
    ok(("ZZ TEST" in bl) and inAny("Needs a fresh baseline since %s: AlterID went backwards (a restore in Tally?)", 50, bl), "10. under the computer: <company>: Needs a fresh baseline since <time>: <why> (%s)" % bl)
    ok(txt('#app [data-baseline-clear="%s"]' % BOOKS[0]["book_id"]).startswith("Clear"), "10. owner: Clear (note)")
    sel('[data-baseline-clear="%s"]' % BOOKS[0]["book_id"]).click(); pg.wait_for_timeout(400)
    pg.fill("#confirmBox #baselineNote", "Tally restored from the 30-Sep backup; read it afresh"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(["tally_baseline_clear", {"p_book": BOOKS[0]["book_id"], "p_note": "Tally restored from the 30-Sep backup; read it afresh"}] in E("window.__calls"), "10. Clear -> tally_baseline_clear(p_book, p_note)")
    CUR_OK = [dict(CUR[0], state="ok", cleared_at="ago:0.5", cleared_by="u-anshul", cleared_note="Tally restored from the 30-Sep backup; read it afresh")]
    E(SETUP, [DEVS, STOPS2, REL, "owner", dict(X, cursors=CUR_OK)]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    bl = txt('#app [data-computer="%s"] [data-baseline="%s"]' % (D1, BOOKS[0]["book_id"]))
    ok(inAny("Cleared by Anshul at %s: Tally restored from the 30-Sep backup; read it afresh", 0.5, bl) and sel("[data-baseline-clear]").count() == 0, "10. afterwards: Cleared by <name> at <time>: <note>, no button (%s)" % bl)
    # a member sees the words, none of the buttons
    E(SETUP, [DEVS, STOPS2, REL_A, "member", X]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    ok(inAny("Stopped by Anshul at %s", 40, line(D4)) and "goes to every computer by itself" in txt("#app [data-release]") and "Needs a fresh baseline since" in txt('#app [data-baseline="%s"]' % BOOKS[0]["book_id"]),
       "a member sees who and when, the withdrawal and the baseline words")
    ok(sel("[data-release-withdraw], [data-baseline-clear]").count() == 0, "a member has no Withdraw and no Clear")
    # an older cloud (migration 37 not applied): the page works, and says FinCom's cloud is not ready for what it cannot do
    E(SETUP, [DEVS, STOPS2, REL, "owner", dict(X, old=True)]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    rel = txt("#app [data-release]")
    ok(pg.locator("#app [data-computer]").count() == 5 and "Stopped by Anshul" in line(D4), "older cloud: the lines, who and when still shown (%s)" % rel)
    nr = txt("#app [data-release] [data-not-ready]")
    ok(sel("[data-release-withdraw]").count() == 0 and nr.startswith("FinCom’s cloud is not ready for this yet"), "older cloud: no Withdraw; 'FinCom's cloud is not ready for this yet' (%s)" % nr)
    ok(sel("[data-baseline]").count() == 0 and not txt("#app [data-bridge-lines]").count("permission denied"), "older cloud: no baseline rows and no error from tally_sync_cursor")
    E("() => { window.__fail = 'Could not find the function public.tally_release_withdraw(p_version, p_why) in the schema cache'; }")
    E(SETUP, [DEVS, STOPS2, REL, "owner", X]); E("() => { window.__fail = 'Could not find the function public.tally_release_withdraw(p_version, p_why) in the schema cache'; }"); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    sel("[data-release-withdraw]").click(); pg.wait_for_timeout(400)
    pg.fill("#confirmBox #withdrawWhy", "x"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    err = txt("#app [data-control-err]")
    ok(err.startswith("FinCom’s cloud is not ready for this yet"), "the RPC missing: 'FinCom's cloud is not ready for this yet' (%s)" % err)
    E("() => { window.__fail = null; }")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
