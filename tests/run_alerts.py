"""python3 run_alerts.py - round 20 (d.1): Tally's alerts (migration 47: tally_alerts, kind gap | silent | summary, RLS
read by the firm; tally_alert_read(p_id) marks one read). On the Tally page (Computers): a list, unread first, newest
first, each with its words and, for an owner or staff, Mark read -> tally_alert_read(p_id). On a client's pages: a line for
each of that client's unread alerts, with Mark read. The table missing (42P01) or a column missing (42703): nothing shown,
no error.
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
    rows = pg.locator("#app [data-alerts] [data-alert]")
    ids = lambda: [rows.nth(i).get_attribute("data-alert") for i in range(rows.count())]
    # ---- the Tally page, owner
    zz, abc = E(SETUP, ["owner", DEVS, ALERTS, "", ""]); pg.wait_for_timeout(1800)
    asked = [a for a in E("window.__asked") if a.startswith("tally_alerts")]
    ok(asked and "firm_id=eq.f-1" in asked[-1] and "order=at.desc" in asked[-1], "the Tally page reads tally_alerts for the firm, newest first (%s)" % asked[-1:])
    ok(pg.locator("#app [data-alerts]").count() == 1, "the Tally page has the alerts list")
    ok(ids() == ["1", "4", "2", "3", "5"], "unread first, newest first, then the read ones newest first (%s)" % ids())
    un = [rows.nth(i).get_attribute("data-alert") for i in range(rows.count()) if rows.nth(i).get_attribute("data-alert-unread") is not None]
    ok(un == ["1", "4", "2"], "the unread ones are marked unread (%s)" % un)
    a1 = txt('#app [data-alerts] [data-alert="1"]')
    ok("ZZ TEST: up to 12 changes not received since 10:05" in a1 and "ZZ Test Client" in a1, "an alert: its words and the client (%s)" % a1)
    ok("Silent today: NWS144" in txt('#app [data-alerts] [data-alert="2"]'), "a silent alert's words (%s)" % txt('#app [data-alerts] [data-alert="2"]'))
    ok(pg.locator('#app [data-alerts] [data-alert="1"] [data-alert-read]').count() == 1 and pg.locator('#app [data-alerts] [data-alert="3"] [data-alert-read]').count() == 0,
       "owner: Mark read on an unread alert, none on a read one")
    pg.click('#app [data-alerts] [data-alert="1"] [data-alert-read]'); pg.wait_for_timeout(900)
    ok(["tally_alert_read", {"p_id": 1}] in E("window.__calls"), "Mark read -> tally_alert_read(p_id) (%s)" % E("window.__calls"))
    ok(ids()[:2] == ["4", "2"] and rows.nth(0).get_attribute("data-alert-unread") is not None and pg.locator('#app [data-alerts] [data-alert="1"][data-alert-unread]').count() == 0,
       "read now: it moves down among the read ones (%s)" % ids())
    # the RPC refused: its words, the alert stays unread
    E("() => { window.__rpcFail = 'Only a member of the firm can mark an alert read.'; }")
    pg.click('#app [data-alerts] [data-alert="4"] [data-alert-read]'); pg.wait_for_timeout(900)
    ok("Only a member of the firm can mark an alert read" in txt("#app [data-alerts-msg]") and pg.locator('#app [data-alerts] [data-alert="4"][data-alert-unread]').count() == 1,
       "a refusal is said in its own words (%s)" % txt("#app [data-alerts-msg]"))
    # ---- staff read and mark read too
    E(SETUP, ["staff", DEVS, ALERTS, "", ""]); pg.wait_for_timeout(1800)
    ok(ids() == ["1", "4", "2", "3", "5"] and pg.locator("#app [data-alerts] [data-alert-read]").count() == 3, "staff: the same list, Mark read on each unread one")
    pg.click('#app [data-alerts] [data-alert="2"] [data-alert-read]'); pg.wait_for_timeout(900)
    ok(["tally_alert_read", {"p_id": 2}] in E("window.__calls"), "staff: Mark read -> tally_alert_read (%s)" % E("window.__calls"))
    # ---- a client's pages: that client's unread alerts only
    E(SETUP, ["owner", DEVS, ALERTS, "", "zz"]); pg.wait_for_timeout(1800)
    cl = pg.locator("#app [data-client-alert]")
    cids = [cl.nth(i).get_attribute("data-client-alert") for i in range(cl.count())]
    ok(cids == ["1"], "ZZ Test Client: its one unread alert (not ABC's, not its read one) (%s)" % cids)
    ok("ZZ TEST: up to 12 changes not received since 10:05" in txt('#app [data-client-alert="1"]'), "the line has the alert's words (%s)" % txt('#app [data-client-alert="1"]'))
    pg.click('#app [data-client-alert="1"] [data-alert-read]'); pg.wait_for_timeout(900)
    ok(["tally_alert_read", {"p_id": 1}] in E("window.__calls") and pg.locator("#app [data-client-alert]").count() == 0, "Mark read on the client's page: the line goes (%s)" % E("window.__calls"))
    E("() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-client-alert]").count() == 0, "on the client's books too: nothing unread left")
    E(SETUP, ["staff", DEVS, ALERTS, "", "abc"]); pg.wait_for_timeout(1800)
    ok([cl.nth(i).get_attribute("data-client-alert") for i in range(cl.count())] == ["4"] and pg.locator('#app [data-client-alert="4"] [data-alert-read]').count() == 1,
       "ABC Client, staff: its unread alert with Mark read")
    # ---- the table or a column missing: nothing, no error
    for miss in ["relation \"public.tally_alerts\" does not exist (42P01)", "column tally_alerts.read_at does not exist (42703)"]:
        E(SETUP, ["owner", DEVS, ALERTS, miss, ""]); pg.wait_for_timeout(1800)
        page = txt("#app")
        ok(pg.locator("#app [data-alerts]").count() == 0 and "42P01" not in page and "42703" not in page and "does not exist" not in page and pg.locator("#app [data-computer]").count() == 1,
           "%s: no alerts list, no error, the page as before" % miss.split("(")[-1].rstrip(")"))
        E(SETUP, ["owner", DEVS, ALERTS, miss, "zz"]); pg.wait_for_timeout(1500)
        ok(pg.locator("#app [data-client-alert]").count() == 0 and "does not exist" not in txt("#app"), "%s: nothing on the client's page" % miss.split("(")[-1].rstrip(")"))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
