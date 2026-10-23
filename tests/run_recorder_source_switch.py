"""python3 run_recorder_source_switch.py - round 20 (d.3, d.4): "Changes come from: the add-on / Tally's change list /
both", per computer on the Tally page, from tally_devices.recorder_source (migration 47; addon | alterid | both, default
addon). An owner picks it -> tally_device_recorder_source(p_device, p_source) and the page reads it back; staff see the
value only; without the column (42703) nothing is shown and the rest of the page stays; the RPC missing is said in plain
words. And (d.4) Sync activity: a line the cloud queued (state "queued", the drain fills the state later) says "queued".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_recorder_source_switch.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8343), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def dev(i, comp, src=None):
    at = "ago:0.5"
    b = {"at": at, "version": "2.2.0", "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["ZZ TEST"]}
    bt = {"at": at, "every": 30, "tally": True, "tallyState": "open", "open": ["ZZ TEST"], "paused": False}
    d = {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": "2.2.0", "main_bridge": "go-" + i, "created_at": "2026-09-01T00:00:00Z",
         "info": {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}}
    if src is not None: d["recorder_source"] = src
    return d
D1, D2, D3 = "d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002", "d0000000-0000-4000-8000-000000000003"
DEVS = [dev(D1, "NWS144", "addon"), dev(D2, "TALLYSRV", "alterid"), dev(D3, "ACCTS2", "both")]
LINES = [{"id": 201, "client_id": "CID", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": "ZZ TEST", "line_id": "L201", "event": "created", "object_guid": "g", "alter_id": 900,
          "vch_type": "Sales", "vch_no": "21", "vch_date": "2026-10-04", "saved_at": "ago:0.4", "received_at": "ago:0.3", "applied_at": None, "state": "queued", "held_why": None, "ledgers": []},
         {"id": 202, "client_id": "CID", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": "ZZ TEST", "line_id": "L202", "event": "created", "object_guid": "h", "alter_id": 901,
          "vch_type": "Sales", "vch_no": "22", "vch_date": "2026-10-04", "saved_at": "ago:0.2", "received_at": "ago:0.1", "applied_at": "ago:0.1", "state": "applied", "held_why": None, "ledgers": []}]
SETUP = """([devs, role, lines]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  let c = Object.values(S.companies).find(x => x.name === "ZZ Test Client");
  if (!c){ c = newCompany({name: "ZZ Test Client", gstin: ""}); c.tallyName = "ZZ TEST"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  window.__devs = fix(devs); window.__lines = fix(lines || []).map(l => Object.assign(l, {client_id: c.id})); window.__calls = []; window.__fail = null; window.__asked = []; window.__noCol = false;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    window.__asked.push(path);
    if (/^tally_devices/.test(path)){ if (window.__noCol && /recorder_source/.test(path)) throw new Error("column tally_devices.recorder_source does not exist (42703)"); return copy(window.__devs); }
    if (/^tally_recorder_lines/.test(path)) return copy(window.__lines);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (window.__fail) throw new Error(window.__fail);
    if (fn === "tally_device_recorder_source"){ const d = window.__devs.find(x => x.id === a.p_device); if (d) d.recorder_source = a.p_source; return {ok: true}; }
    return {ok: true}; };
  TLight.refresh = function(){ return Promise.resolve(); }; TLight.st = {at: Date.now(), busy: false, by: {}, devs: copy(window.__devs), cos: []};
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = ""; TCloud.pane.ctl = null;
  if (typeof Rec === "object"){ Rec.act = {}; Rec.silent = {}; }
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; S.tallyTab = ""; S.syncClient = ""; navHome("clients");
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.2.0", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.2.0.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8343/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    # FinCom 2.3.5, the simpler Tally page: the rest of a computer's card (and of the page) is under More; open them all
    more = lambda: (pg.evaluate("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"), pg.wait_for_timeout(500))
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    RS = lambda d: '#app [data-computer="%s"] [data-recorder-source]' % d
    PICK = lambda d: RS(d) + " select[data-recorder-source-pick]"
    side = pg.locator('#side button[aria-label="Tally"]')
    def page(role, lines=None):
        E(SETUP, [DEVS, role, lines]); pg.wait_for_timeout(500); side.first.click(); pg.wait_for_timeout(1500); more()
    page("owner")
    ok(pg.locator("#app [data-computer]").count() == 3, "three computers on the Tally page")
    t1, t2, t3 = txt(RS(D1)), txt(RS(D2)), txt(RS(D3))
    ok("Changes come from" in t1, "owner: NWS144 has the line 'Changes come from' (%s)" % t1)
    vals = [pg.eval_on_selector(PICK(d), "s => s.value") if pg.locator(PICK(d)).count() else None for d in (D1, D2, D3)]
    ok(vals == ["addon", "alterid", "both"], "owner: each computer's pick shows its value (%s)" % vals)
    opts = pg.eval_on_selector_all(PICK(D1) + " option", "os => os.map(o => [o.value, o.textContent.trim()])") if pg.locator(PICK(D1)).count() else []
    ok(opts == [["addon", "the add-on"], ["alterid", "Tally’s change list"], ["both", "both"]] or opts == [["addon", "the add-on"], ["alterid", "Tally's change list"], ["both", "both"]],
       "the three choices: the add-on / Tally's change list / both (%s)" % opts)
    ok(any("recorder_source" in a for a in E("window.__asked") if a.startswith("tally_devices")), "the page reads tally_devices.recorder_source (%s)" % [a for a in E("window.__asked") if a.startswith("tally_devices")])
    if pg.locator(PICK(D1)).count():
        pg.select_option(PICK(D1), "alterid"); pg.wait_for_timeout(900)
    calls = [c for c in E("window.__calls") if c[0] == "tally_device_recorder_source"]
    ok(calls == [["tally_device_recorder_source", {"p_device": D1, "p_source": "alterid"}]], "owner: picking Tally's change list on NWS144 calls tally_device_recorder_source(p_device, p_source) (%s)" % calls)
    v1 = pg.eval_on_selector(PICK(D1), "s => s.value") if pg.locator(PICK(D1)).count() else None
    ok(v1 == "alterid", "the page reads it back: NWS144 now Tally's change list (%s)" % v1)
    E("() => { window.__calls = []; }")
    if pg.locator(PICK(D2)).count():
        pg.select_option(PICK(D2), "both"); pg.wait_for_timeout(900)
    calls = [c for c in E("window.__calls") if c[0] == "tally_device_recorder_source"]
    ok(calls == [["tally_device_recorder_source", {"p_device": D2, "p_source": "both"}]], "owner: TALLYSRV to both (%s)" % calls)
    # the RPC missing: plain words
    E("() => { window.__fail = 'Could not find the function public.tally_device_recorder_source(p_device, p_source) in the schema cache (PGRST202)'; }")
    if pg.locator(PICK(D3)).count():
        pg.select_option(PICK(D3), "addon"); pg.wait_for_timeout(900)
    ok("not available until migration 47 runs" in txt("#app [data-control-err]"), "owner: the RPC missing says 'not available until migration 47 runs' (%s)" % txt("#app [data-control-err]"))
    # staff: the value only
    page("staff")
    s1, s2, s3 = txt(RS(D1)), txt(RS(D2)), txt(RS(D3))
    ok(s1 == "Changes come from: the add-on" and s2 in ("Changes come from: Tally’s change list", "Changes come from: Tally's change list") and s3 == "Changes come from: both",
       "staff: the value in words (%s | %s | %s)" % (s1, s2, s3))
    ok(pg.locator("#app [data-recorder-source-pick]").count() == 0, "staff: no pick")
    # no value on the row (null): the add-on, the default
    E("() => { window.__devs.forEach(d => { d.recorder_source = null; }); TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.refreshPane(); }"); pg.wait_for_timeout(1200)
    ok(txt(RS(D2)) == "Changes come from: the add-on", "no value: the add-on, the default (%s)" % txt(RS(D2)))
    # the column missing (migration 47 not run): nothing, the rest of the page as before
    page("owner")
    E("() => { window.__noCol = true; TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.busy = ''; TCloud.refreshPane(); }"); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-computer]").count() == 3 and pg.locator("#app [data-recorder-source]").count() == 0 and "42703" not in txt("#app"),
       "without the column: three computers still, no 'Changes come from', no error")
    ok(pg.locator("#app [data-trial-tools]").count() == 3, "the trial tools lines stay")
    # ---- d.4: Sync activity shows a queued line as queued
    page("owner", LINES)
    E("() => { S.tallyTab = 'activity'; Rec.act.at = 0; render(); }"); pg.wait_for_timeout(1500)
    q = txt('#app [data-sync-line="201"] [data-sync-state]')
    ok(q == "Received, waiting in FinCom's queue", "Sync activity: a line the cloud queued says so in the owner's words of 05-Oct-2026 (%s)" % q)
    ok(txt('#app [data-sync-line="202"] [data-sync-state]') == "Entered in the books", "an applied line: Entered in the books (%s)" % txt('#app [data-sync-line="202"] [data-sync-state]'))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
