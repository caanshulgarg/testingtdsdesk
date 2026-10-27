"""python3 run_alerts.py - round 20 (d.1): Tally's alerts (migration 47: tally_alerts, kind gap | silent | summary, RLS
read by the firm; tally_alert_read(p_id) marks one read). Since round 3 of the UI pass (05-Oct-2026) every alert is in the
bell in the top bar (run_alerts_one_place.py has the rest): the rows are read for the firm; a gap row shows only while its
book's gap is there (it clears itself, no Mark read); "silent today" is information; the daily summary keeps Mark read ->
tally_alert_read(p_id), for owner and staff, a refusal said in its words; no alert text on the pages. The table missing
(42P01) or a column missing (42703): nothing shown, no error.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_alerts.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8341), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
D1 = "d0000000-0000-4000-8000-000000000001"
def dev(i, comp):
    at = "ago:0.5"
    b = {"at": at, "version": "2.1.10", "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["ZZ TEST"]}
    bt = {"at": at, "every": 30, "tally": True, "tallyState": "open", "open": ["ZZ TEST"], "paused": False}
    return {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": "2.1.10", "main_bridge": "go-" + i, "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}}
DEVS = [dev(D1, "NWS144")]
def al(i, kind, at, words, cid=None, read=None, dev=None):
    return {"id": i, "firm_id": "f-1", "client_id": cid, "book_id": "b1" if cid else None, "device_id": dev, "kind": kind, "day": "TODAY", "words": words, "data": {},
            "at": at, "read_at": read, "read_by": "u-anshul" if read else None}
ALERTS = [
    al(1, "gap", "ago:5", "ZZ TEST: up to 12 changes not received since 10:05", cid="ZZ"),
    al(2, "silent", "ago:60", "Silent today: NWS144, Tally open with no recorder line", dev=D1),
    al(3, "summary", "ago:2", "Today: 140 lines, 2 held, no gap, 3 postings", read="ago:1"),
    al(6, "summary", "ago:1", "Today so far: 12 lines, none held"),
    al(4, "gap", "ago:30", "ABC LTD: up to 3 changes not received", cid="ABC"),
    al(5, "gap", "ago:90", "ZZ TEST: an older gap, read already", cid="ZZ", read="ago:80")]
SETUP = """async ([role, devs, alerts, missing, open]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  const mk = (name, tn) => { let c = Object.values(S.companies).find(x => x.name === name); if (!c){ c = newCompany({name, gstin: ""}); c.tallyName = tn; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; } return c; };
  const zz = mk("ZZ Test Client", "ZZ TEST"), abc = mk("ABC Client", "ABC LTD");
  window.__devs = fix(devs); window.__alerts = fix(alerts).map(a => Object.assign(a, {client_id: a.client_id === "ZZ" ? zz.id : a.client_id === "ABC" ? abc.id : a.client_id}));
  window.__calls = []; window.__asked = []; window.__missing = missing || ""; window.__rpcFail = "";
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-anshul", name: "Anshul"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (p) => {
    window.__asked.push(p);
    if (/^tally_devices/.test(p)) return copy(window.__devs);
    if (/^tally_alerts/.test(p)){ if (window.__missing) throw new Error(window.__missing); return copy(window.__alerts); }
    if (/^tally_sync_cursor/.test(p)) return copy(window.__cursor || []);
    if (/^tally_books/.test(p)) return [{book_id: "b1", client_id: zz.id, company: "ZZ TEST"}];
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, copy(a || {})]);
    if (fn === "tally_alert_read"){ if (window.__rpcFail) throw new Error(window.__rpcFail); const x = window.__alerts.find(r => r.id === a.p_id); if (x){ x.read_at = new Date().toISOString(); x.read_by = "u-anshul"; } return {ok: true}; }
    if (fn === "tally_recorder_silent") return {ok: true, silent: []};
    return null; };
  TLight.refresh = function(){ return Promise.resolve(); }; TLight.st = {at: Date.now(), busy: false, by: {}, devs: copy(window.__devs), cos: [{company: "ZZ TEST", client_id: zz.id, device_id: devs[0].id}]};
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  if (typeof Rec === "object"){ Rec.silent = {}; Rec.gaps = {}; Rec.alerts = {}; }
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm"; S.tallyOld = false; S.tallyTab = "";
  if (open){ const c = open === "abc" ? abc : zz; if (S.view !== "company" || S.coId !== c.id) await openCompany(c.id); S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}}; goClient("dash"); }
  else navHome("tally");
  return [zz.id, abc.id];
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1500, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.10", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.10.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8341/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    # ---- the Tally page, owner
    zz, abc = E(SETUP, ["owner", DEVS, ALERTS, "", ""]); pg.wait_for_timeout(1800)
    asked = [a for a in E("window.__asked") if a.startswith("tally_alerts")]
    ok(asked and "firm_id=eq.f-1" in asked[-1] and "order=at.desc" in asked[-1], "the Tally page reads tally_alerts for the firm, newest first (%s)" % asked[-1:])
    BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return []; if (!document.querySelector('[data-alerts-panel]')) b.click();
      return [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'), sev: e.getAttribute('data-sev'), text: e.innerText.replace(/\\s+/g, ' ').trim(), read: !!e.querySelector('[data-alert-read]')})); }"""
    shut = lambda: E("() => { S.alertsOpen = false; render(); }")
    items = E(BELL)
    keys = [x["key"] for x in items]
    ok(not [x for x in items if "changes not received" in x["text"] or "ZZ" in x["text"]], "no gap in the cursor: the gap rows have cleared themselves, nothing to mark read (%s)" % keys)
    sl = [x for x in items if "No change recorded today" in x["text"]]
    ok(len(sl) == 1 and sl[0]["sev"] == "info" and not sl[0]["read"], "the silent row: information, clearing itself (%s)" % sl)
    sm = [x for x in items if "Today so far" in x["text"]]
    ok(len(sm) == 1 and sm[0]["read"] and not [x for x in items if "140 lines" in x["text"]], "the unread summary with Mark read; the one read already is gone (%s)" % [x["text"][:40] for x in items])
    ok(pg.locator("#app [data-alerts], #app [data-client-alert]").count() == 0 and "Mark read" not in txt("#app"), "no alerts list on the Tally page any more: the bell holds them")
    pg.click('[data-alerts-panel] [data-alert-key="alert:6"] [data-alert-read]'); pg.wait_for_timeout(900)
    ok(["tally_alert_read", {"p_id": 6}] in E("window.__calls"), "Mark read -> tally_alert_read(p_id) (%s)" % E("window.__calls"))
    items = E(BELL)
    ok(not [x for x in items if "Today so far" in x["text"]], "read now: it leaves the bell")
    shut()
    # the RPC refused: its words, the alert stays
    E("() => { window.__rpcFail = 'Only a member of the firm can mark an alert read.'; window.__alerts.push({id: 7, firm_id: 'f-1', kind: 'summary', day: 'x', words: 'Another summary', data: {}, at: new Date().toISOString(), read_at: null}); Rec.alerts.at = 0; AlertHub.refresh(true); }"); pg.wait_for_timeout(1500)
    E(BELL); pg.click('[data-alerts-panel] [data-alert-key="alert:7"] [data-alert-read]'); pg.wait_for_timeout(900)
    ok("Only a member of the firm can mark an alert read" in txt("[data-alerts-msg]") and pg.locator('[data-alerts-panel] [data-alert-key="alert:7"]').count() == 1,
       "a refusal is said in its own words, the alert stays (%s)" % txt("[data-alerts-msg]"))
    shut()
    # ---- staff read and mark read too
    E(SETUP, ["staff", DEVS, ALERTS, "", ""]); pg.wait_for_timeout(1800)
    items = E(BELL)
    ok([x for x in items if "Today so far" in x["text"] and x["read"]], "staff: the summary with Mark read")
    pg.click('[data-alerts-panel] [data-alert-key="alert:6"] [data-alert-read]'); pg.wait_for_timeout(900)
    ok(["tally_alert_read", {"p_id": 6}] in E("window.__calls"), "staff: Mark read -> tally_alert_read (%s)" % E("window.__calls"))
    shut()
    # ---- a gap in the cursor for ZZ: ONE alert for ZZ (its two rows and the cursor), none for ABC (no gap there)
    E("() => { window.__cursor = [{book_id: 'b1', gap: {missing: 12, missingMax: 12, since: new Date(Date.now() - 3600e3).toISOString(), tally_altvchid: 512, recorder_max: 500}, gap_at: new Date().toISOString()}]; }")
    E(SETUP, ["owner", DEVS, ALERTS, "", "zz"]); pg.wait_for_timeout(1800)
    E("() => { window.__cursor = [{book_id: 'b1', gap: {missing: 12, missingMax: 12, since: new Date(Date.now() - 3600e3).toISOString(), tally_altvchid: 512, recorder_max: 500}, gap_at: new Date().toISOString()}]; AlertHub.refresh(true); }"); pg.wait_for_timeout(1500)
    items = E(BELL)
    zz_ = [x for x in items if x["text"].startswith("ZZ Test Client:")]
    ok(len(zz_) == 1 and "12 entries made in Tally" in zz_[0]["text"] and not zz_[0]["read"] and not [x for x in items if "ABC" in x["text"]], "the gap: one alert for ZZ Test Client, none for ABC (%s)" % [x["text"][:60] for x in items])
    shut()
    ok(pg.locator("#app [data-client-alert]").count() == 0 and "changes not received" not in txt("#app"), "nothing on the client's pages")
    # ---- the table or a column missing: nothing, no error
    for miss in ["relation \"public.tally_alerts\" does not exist (42P01)", "column tally_alerts.read_at does not exist (42703)"]:
        E("() => { window.__cursor = []; }")
        E(SETUP, ["owner", DEVS, ALERTS, miss, ""]); pg.wait_for_timeout(1800)
        page = txt("#app")
        items = E(BELL); shut()
        ok(not [x for x in items if x["key"].startswith("alert:")] and "42P01" not in page and "42703" not in page and "does not exist" not in page and pg.locator("#app [data-computer]").count() == 1,
           "%s: no alert rows, no error, the page as before" % miss.split("(")[-1].rstrip(")"))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
