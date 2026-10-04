"""python3 run_sync_activity.py - phase 2, H49/H50/H51: the Tally page in three tabs, Computers (as before), Sync activity
(new) and Everything sent (the post log). Sync activity reads tally_recorder_lines (migration 44) for the firm, newest
first, 200 at most (one client's when opened from a client): time saved in Tally, the entry (voucher type, number and date,
or the ledger's name), the action, the PC, when it reached FinCom's cloud, the state (applied / duplicate / held: why /
failed: why / waiting) and the ledger check (not checked yet). Filters: Waiting (held or received), Mismatch (none yet),
Today. A strip at the top: the lines waiting over 2 minutes with the reason (the PC offline, Tally closed there, or the
line's held_why). An owner has Apply now on a held line (tally_recorder_release_held(p_line)). New lines come in live
(Live, src/js/54: tally_recorder_lines on a channel of its own). Without the table: "not available until migration 44 runs".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sync_activity.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8292), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
D1, D2, D3 = "d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002", "d0000000-0000-4000-8000-000000000003"
def dev(i, comp, at="ago:0.3", state="open"):
    b = {"at": at, "version": "2.1.9", "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": state == "open", "tallyState": state, "open": ["ZZ TEST"] if state == "open" else []}
    bt = {"at": at, "every": 30, "tally": state == "open", "tallyState": state, "open": b["open"], "paused": False}
    return {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": "2.1.9", "main_bridge": "go-" + i, "info": {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}, "created_at": "2026-09-01T00:00:00Z"}
DEVS = [dev(D1, "NWS144"), dev(D2, "OFFICEPC", at="ago:30"), dev(D3, "TALLYSRV", state="closed")]
def line(i, d, pc, event, state, rec, saved=None, why=None, vt="Sales", no="12", day="2026-10-03", ledgers=None, cid="CID"):
    return {"id": i, "client_id": cid, "book_id": "b1", "device_id": d, "pc": pc, "company": "ZZ TEST", "line_id": "L" + str(i), "event": event, "object_guid": "g-%d" % i, "alter_id": 500 + i,
            "vch_type": None if event.startswith("ledger") else vt, "vch_no": None if event.startswith("ledger") else no, "vch_date": None if event.startswith("ledger") else day,
            "saved_at": saved or rec, "received_at": rec, "applied_at": rec if state == "applied" else None, "state": state, "held_why": why, "ledgers": ledgers or []}
LINES = [
    line(101, D1, "NWS144", "created", "applied", "ago:0.5", "ago:0.6"),
    line(102, D1, "NWS144", "altered", "held", "ago:10", why="month locked: 2026-04", vt="Payment", no="7", day="2026-04-12"),
    line(103, D2, "OFFICEPC", "created", "received", "ago:20", vt="Receipt", no="3"),
    line(104, D1, "NWS144", "ledger_renamed", "duplicate", "ago:30", ledgers=[{"name": "ABC Traders Pvt Ltd", "guid": "x"}]),
    line(105, D1, "NWS144", "deleted", "failed", "ago:1500", why="no such entry", vt="Journal", no="9"),
    line(106, D3, "TALLYSRV", "created", "received", "ago:5", vt="Sales", no="13"),
    line(107, D1, "NWS144", "created", "received", "ago:1", vt="Sales", no="14")]
SETUP = """async ([role, devs, lines, old]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  let c = Object.values(S.companies).find(x => x.name === "ZZ Test Client");
  if (!c){ c = newCompany({name: "ZZ Test Client", gstin: ""}); c.tallyName = "ZZ TEST"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  window.__devs = fix(devs); window.__lines = fix(lines).map(l => Object.assign(l, {client_id: l.client_id === "CID" ? c.id : l.client_id})); window.__calls = []; window.__asked = []; window.__old = old || ""; window.__fail = null;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-anshul", name: "Anshul"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    window.__asked.push(path);
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_recorder_lines/.test(path)){
      if (window.__old) throw new Error(window.__old);
      const m = /client_id=eq\\.([^&]+)/.exec(path);
      return copy(window.__lines.filter(l => !m || l.client_id === decodeURIComponent(m[1])));
    }
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, copy(a || {})]); if (window.__fail) throw new Error(window.__fail);
    if (fn === "tally_recorder_release_held") return {ok: true, line_id: "L" + a.p_line, state: "applied", why: null};
    return {ok: true}; };
  TLight.refresh = function(){ return Promise.resolve(); }; TLight.st = {at: Date.now(), busy: false, by: {}, devs: copy(window.__devs), cos: [{company: "ZZ TEST", client_id: c.id, device_id: devs[0].id}]};
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  if (typeof Rec === "object"){ Rec.act = {}; Rec.silent = {}; }
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; S.tallyTab = ""; S.syncClient = "";
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1500, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.9", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.9.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8292/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    hm = lambda m: E("(m) => tallyHm(Date.now() - m * 60000)", m)
    cid = E(SETUP, ["owner", DEVS, LINES, ""]); pg.wait_for_timeout(300)
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    tabs = pg.locator("#app [data-tally-tab]")
    ok([tabs.nth(i).inner_text().strip() for i in range(tabs.count())] == ["Computers", "Sync activity", "Everything sent"], "the Tally page: Computers, Sync activity, Everything sent (%s)" % [tabs.nth(i).inner_text() for i in range(tabs.count())])
    ok(pg.locator("#app [data-computers]").count() == 1 and pg.locator("#app [data-sync-activity]").count() == 0, "Computers first: today's content (one line a computer)")
    pg.click('#app [data-tally-tab="sent"]'); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-computers]").count() == 0 and E("S.tallyTab") == "sent", "Everything sent: the post log on a tab of its own")
    pg.click('#app [data-tally-tab="activity"]'); pg.wait_for_timeout(1200)
    asked = [a for a in E("window.__asked") if a.startswith("tally_recorder_lines")]
    ok(asked and "order=received_at.desc" in asked[-1] and "limit=200" in asked[-1] and "firm_id=eq.f-1" in asked[-1] and "client_id=eq" not in asked[-1], "Sync activity reads tally_recorder_lines for the firm, newest first, 200 (%s)" % (asked[-1:] or ""))
    rows = pg.locator("#app [data-sync-line]")
    ids = [rows.nth(i).get_attribute("data-sync-line") for i in range(rows.count())]
    ok(ids == ["101", "107", "106", "102", "103", "104", "105"], "every line, newest first (%s)" % ids)
    r = lambda i: txt('#app [data-sync-line="%d"]' % i)
    r1 = r(101)
    ok("Sales 12" in r1 and "03-Oct-2026" in r1 and "created" in r1 and "NWS144" in r1 and "applied" in r1 and "not checked" in r1 and hm(0.6) in r1, "a line: saved time, Sales 12 · 03-Oct-2026, created, NWS144, applied, not checked (%s)" % r1)
    ok("held: month locked: 2026-04" in r(102) and "Payment 7" in r(102) and "altered" in r(102), "held, with why (%s)" % r(102))
    ok("ABC Traders Pvt Ltd" in r(104) and "ledger renamed" in r(104) and "duplicate" in r(104), "a ledger line: the ledger's name, ledger renamed, duplicate (%s)" % r(104))
    ok("failed: no such entry" in r(105) and "deleted" in r(105), "failed, with why (%s)" % r(105))
    ok("waiting" in r(103), "received, not applied yet: waiting (%s)" % r(103))
    # ---- the strip: waiting over 2 minutes, with the reason
    st = txt("#app [data-sync-waiting]")
    wl = pg.locator("#app [data-sync-waiting] [data-sync-waiting-line]")
    wids = sorted(wl.nth(i).get_attribute("data-sync-waiting-line") for i in range(wl.count()))
    ok(wids == ["102", "103", "106"], "the strip: the lines received or held over 2 minutes ago, not the one of a minute ago (%s)" % wids)
    ok("OFFICEPC is offline" in txt('#app [data-sync-waiting-line="103"]') and "Tally is closed on TALLYSRV" in txt('#app [data-sync-waiting-line="106"]') and "month locked: 2026-04" in txt('#app [data-sync-waiting-line="102"]'),
       "each with its reason: the PC offline, Tally closed there, the held why (%s)" % st)
    # ---- filters
    pg.click('#app [data-sync-filter="waiting"]'); pg.wait_for_timeout(400)
    ids = [rows.nth(i).get_attribute("data-sync-line") for i in range(rows.count())]
    ok(ids == ["107", "106", "102", "103"], "Waiting: held or received only (%s)" % ids)
    pg.click('#app [data-sync-filter="mismatch"]'); pg.wait_for_timeout(400)
    ok(rows.count() == 0 and "No mismatch" in txt("#app [data-sync-activity]"), "Mismatch: the filter is there, nothing in it yet (%s)" % txt("#app [data-sync-empty]"))
    pg.click('#app [data-sync-filter="today"]'); pg.wait_for_timeout(400)
    ids = [rows.nth(i).get_attribute("data-sync-line") for i in range(rows.count())]
    ok("105" not in ids and "101" in ids, "Today: yesterday's line left out (%s)" % ids)
    pg.click('#app [data-sync-filter="all"]'); pg.wait_for_timeout(400)
    # ---- Apply now (owner) on a held line
    ok(pg.locator("#app [data-sync-release]").count() == 1 and pg.locator('#app [data-sync-line="102"] [data-sync-release]').count() == 1, "owner: Apply now on the held line only")
    pg.click('#app [data-sync-line="102"] [data-sync-release]'); pg.wait_for_timeout(800)
    ok(["tally_recorder_release_held", {"p_line": 102}] in E("window.__calls"), "Apply now -> tally_recorder_release_held(p_line) (%s)" % E("window.__calls"))
    ok("applied" in txt("#app [data-sync-msg]"), "the answer is said (%s)" % txt("#app [data-sync-msg]"))
    E("() => { window.__fail = 'line 102 is held: month locked: 2026-04'; }")
    pg.click('#app [data-sync-line="102"] [data-sync-release]'); pg.wait_for_timeout(800)
    ok("month locked: 2026-04" in txt("#app [data-sync-msg]"), "a refusal in its own words (%s)" % txt("#app [data-sync-msg]"))
    E("() => { window.__fail = null; }")
    # ---- live: a new line arrives on the recorder channel
    E("""() => { Live.recorderTopic = 'realtime:fincom-recorder-f-1'; Live.got({topic: 'realtime:fincom-recorder-f-1', event: 'postgres_changes', payload: {data: {type: 'INSERT', table: 'tally_recorder_lines', record: {id: 108, client_id: S.coId || Object.keys(S.companies)[0], book_id: 'b1', device_id: '%s', pc: 'NWS144', company: 'ZZ TEST', event: 'created', vch_type: 'Sales', vch_no: '15', vch_date: '2026-10-04', saved_at: new Date().toISOString(), received_at: new Date().toISOString(), state: 'applied', held_why: null, ledgers: []}}}}); }""" % D1)
    pg.wait_for_timeout(500)
    ids = [rows.nth(i).get_attribute("data-sync-line") for i in range(rows.count())]
    ok(ids[:1] == ["108"] and "Sales 15" in r(108), "live: a new line shows at the top at once (%s)" % ids[:3])
    # ---- staff: the lines, no Apply now
    E(SETUP, ["staff", DEVS, LINES, ""]); pg.wait_for_timeout(300); E("() => { navHome('tally'); S.tallyTab = 'activity'; render(); }"); pg.wait_for_timeout(1200)
    ok(rows.count() == 7 and pg.locator("#app [data-sync-release]").count() == 0, "staff: the lines, no Apply now")
    # ---- one client's lines, opened from the client
    E("(id) => Rec.openActivity(id)", cid); pg.wait_for_timeout(1200)
    asked = [a for a in E("window.__asked") if a.startswith("tally_recorder_lines")]
    ok(E("S.homeTab") == "tally" and E("S.tallyTab") == "activity" and ("client_id=eq." + cid) in asked[-1], "opened from a client: the Tally page's Sync activity, that client's lines (%s)" % asked[-1:])
    # ---- without the table (migration 44 not run)
    E(SETUP, ["owner", DEVS, LINES, "Could not find the table 'public.tally_recorder_lines' in the schema cache (PGRST205)"]); pg.wait_for_timeout(300)
    E("() => { navHome('tally'); S.tallyTab = 'activity'; render(); }"); pg.wait_for_timeout(1200)
    ok("not available until migration 44 runs" in txt("#app [data-sync-activity]") and rows.count() == 0, "without the table: 'not available until migration 44 runs' (%s)" % txt("#app [data-sync-activity]")[:160])
    E(SETUP, ["owner", DEVS, LINES, "column tally_recorder_lines.held_why does not exist (42703)"]); pg.wait_for_timeout(300)
    E("() => { navHome('tally'); S.tallyTab = 'activity'; render(); }"); pg.wait_for_timeout(1200)
    ok("not available until migration 44 runs" in txt("#app [data-sync-activity]"), "a 42703: the same words")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
