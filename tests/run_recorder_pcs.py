"""python3 run_recorder_pcs.py - phase 2, F36 + N102 (is each PC recording Tally's changes?), J64 (silent today) and H52
(Tally not responding). From the heartbeat (tally_devices.info.bridges[id].recorder = {<company>: {seen, lastAt}}, FinCom
Bridge 2.1.9 on): the Tally page says per company on each computer "recording · last line <time>" or "not recording". Since
round 3 of the UI pass (05-Oct-2026) the warnings are in the bell in the top bar, one per problem, the computer behind
"details" (run_alerts_one_place.py): a client whose company a computer keeps open without recording it -> one amber alert
for that client (no banner on its pages); tally_recorder_silent(p_firm) -> information "No change recorded today on one
computer"; beat.notAnsweringSince -> "Tally is not answering on one computer since <time>". No word at all while no bridge
reports a recorder (before 2.1.9).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_recorder_pcs.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8294), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
D1, D2, D3 = "d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002", "d0000000-0000-4000-8000-000000000003"
def dev(i, comp, opened, recorder=None, beat=None):
    b = {"at": "ago:0.3", "version": "2.1.9" if recorder is not None else "2.1.8", "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": opened}
    if recorder is not None: b["recorder"] = recorder
    bt = {"at": "ago:0.3", "every": 30, "tally": True, "tallyState": "open", "open": opened, "paused": False}
    bt.update(beat or {})
    if "reqs" in (beat or {}): b["reqs"] = beat["reqs"]
    return {"id": i, "name": comp, "revoked": False, "last_seen": "ago:0.3", "version": b["version"], "main_bridge": "go-" + i, "info": {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}, "created_at": "2026-09-01T00:00:00Z"}
DEVS = [dev(D1, "NWS144", ["ZZ TEST", "ABC LTD"], {"ZZ TEST": {"seen": True, "lastAt": "ago:3"}, "ABC LTD": {"seen": False}}),
        dev(D2, "TALLYSRV", ["OTHER CO"]),
        dev(D3, "ACCTS2", [], {"ZZ TEST": {"seen": False}}, {"notAnsweringSince": "ago:12", "reqs": {"day": "TODAY", "last": {"kind": "vouchers", "ms": 24100, "at": "ago:12"}, "longest": {"kind": "vouchers", "ms": 24100, "at": "ago:12"}, "over20": 1, "n": 4}})]
SILENT = {"ok": True, "silent": [{"device": D2, "name": "TALLYSRV", "lastLineAt": None, "tallyOpenAt": "ago:300", "workingHours": 11}]}
SETUP = """async ([role, devs, silent, rpcFail, open]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  const mk = (name, tn) => { let c = Object.values(S.companies).find(x => x.name === name); if (!c){ c = newCompany({name, gstin: ""}); c.tallyName = tn; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; } return c; };
  const zz = mk("ZZ Test Client", "ZZ TEST"), abc = mk("ABC Client", "ABC LTD");
  window.__devs = fix(devs); window.__silent = fix(silent); window.__calls = []; window.__rpcFail = rpcFail || "";
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const cos = [{company: "ZZ TEST", client_id: zz.id, device_id: devs[0].id}, {company: "ABC LTD", client_id: abc.id, device_id: devs[0].id}];
  Cloud.api = async (p) => { if (/^tally_devices/.test(p)) return copy(window.__devs); if (/^tally_companies/.test(p)) return copy(cos); return []; };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, copy(a || {})]); if (fn === "tally_recorder_silent"){ if (window.__rpcFail) throw new Error(window.__rpcFail); return copy(window.__silent); } return null; };
  TLight.refresh = function(){ return Promise.resolve(); }; TLight.st = {at: Date.now(), busy: false, by: {}, devs: copy(window.__devs), cos};
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  if (typeof Rec === "object"){ Rec.silent = {}; Rec.gaps = {}; }
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm"; S.tallyOld = false; S.tallyTab = "";
  if (open){ const c = open === "abc" ? abc : zz; if (S.view !== "company" || S.coId !== c.id) await openCompany(c.id); S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}}; goClient("dash"); }
  else navHome("tally");
  return [zz.id, abc.id];
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1500, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.1.9", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.1.9.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8294/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    # FinCom 2.3.5, the simpler Tally page: the rest of a computer's card (and of the page) is under More; open them all
    more = lambda: (pg.evaluate("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"), pg.wait_for_timeout(500))
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    hm = lambda m: E("(m) => tallyHm(Date.now() - m * 60000)", m)
    hmIn = lambda text, m: any(hm(x) in text for x in (m, m + 1))
    E(SETUP, ["owner", DEVS, SILENT, "", ""]); pg.wait_for_timeout(1800); more()
    comp = lambda d: '#app [data-computer="%s"]' % d
    # ---- F36: per company on each computer
    zz = txt(comp(D1) + ' [data-recorder-co="ZZ TEST"]'); abc = txt(comp(D1) + ' [data-recorder-co="ABC LTD"]')
    ok(zz.startswith("ZZ TEST: recording") and "last line" in zz and hmIn(zz, 3), "NWS144, ZZ TEST: recording · last line <time> (%s)" % zz)
    ok(abc.startswith("ABC LTD: not recording"), "NWS144, ABC LTD: not recording (%s)" % abc)
    BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return []; if (!document.querySelector('[data-alerts-panel]')) b.click();
      const r = [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'), sev: e.getAttribute('data-sev'), text: (e.querySelector('[data-alert-text]') || {}).innerText || '',
        fix: (e.querySelector('[data-alert-fix]') || {}).innerText || '', details: (e.querySelector('[data-alert-details]') || {}).textContent || ''})); S.alertsOpen = false; render(); return r; }"""
    ok(pg.locator("#app [data-recorder-off], #app [data-not-responding], #app [data-recorder-silent]").count() == 0 and "not being recorded" not in txt("#app"), "the Tally page: the computers' state, no warnings printed (they are in the bell)")
    items = E(BELL)
    abc_ = [x for x in items if x["text"].startswith("ABC Client:")]
    ok(len(abc_) == 1 and abc_[0]["sev"] == "warn" and "not recording" in abc_[0]["text"] and "NWS144" in abc_[0]["details"] and "NWS144" not in abc_[0]["text"], "F36: ABC LTD open on NWS144, not recorded: one amber alert for ABC Client, the computer behind details (%s)" % abc_)
    ok(not [x for x in items if x["text"].startswith("ZZ Test Client:")], "ZZ TEST is recorded: no alert for it")
    # ---- H52
    nr = [x for x in items if "not answering" in x["text"]]
    ok(len(nr) == 1 and hmIn(nr[0]["text"], 12) and "ACCTS2" in nr[0]["details"], "H52: 'Tally is not answering on one computer since <time>', ACCTS2 behind details (%s)" % nr)
    # ---- J64
    ok(["tally_recorder_silent", {"p_firm": "f-1"}] in E("window.__calls"), "J64: tally_recorder_silent(p_firm) asked (%s)" % E("window.__calls"))
    sl = [x for x in items if "No change recorded today" in x["text"]]
    ok(len(sl) == 1 and sl[0]["sev"] == "info" and "TALLYSRV" in sl[0]["details"], "J64: silent today, as information, TALLYSRV behind details (%s)" % sl)
    E(SETUP, ["staff", DEVS, SILENT, "", ""]); pg.wait_for_timeout(1800); more()
    items = E(BELL)
    ok([x for x in items if "No change recorded today" in x["text"]] and [x for x in items if x["text"].startswith("ABC Client:")], "J64, F36: staff see them too")
    E(SETUP, ["owner", DEVS, SILENT, "Could not find the function public.tally_recorder_silent(p_firm) in the schema cache (PGRST202)", ""]); pg.wait_for_timeout(1800); more()
    ok(not [x for x in E(BELL) if "No change recorded today" in x["text"]] and pg.locator("#app [data-computer]").count() == 3 and "PGRST202" not in txt("#app"), "J64: the function missing: nothing said, the page as before")
    # ---- a client's pages: no banner (the bell has it)
    E(SETUP, ["owner", DEVS, SILENT, "", "abc"]); pg.wait_for_timeout(1500); more()
    ok(pg.locator("#app [data-recorder-banner]").count() == 0 and "not being recorded" not in txt("#app") and "not recording" not in txt("#app"), "ABC Client's pages: no banner")
    E("() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(800)
    ok(pg.locator("#app [data-alert-line]").count() == 1 and "not recording" in txt("#app [data-alert-line]"), "ABC Client's books: the one slim line (%s)" % txt("#app [data-alert-line]"))
    # no bridge reports a recorder at all (every bridge before 2.1.9): no alert, no word on the Tally page
    OLD = [dev(D1, "NWS144", ["ZZ TEST", "ABC LTD"]), dev(D2, "TALLYSRV", ["OTHER CO"])]
    E(SETUP, ["owner", OLD, {"ok": True, "silent": []}, "", "abc"]); pg.wait_for_timeout(1500); more()
    ok(not [x for x in E(BELL) if "not recording" in x["text"]], "bridges before 2.1.9: no alert")
    E("() => navHome('tally')"); pg.wait_for_timeout(1500); more()
    ok(pg.locator("#app [data-recorder-co], #app [data-recorder-off], #app [data-recorder-silent]").count() == 0, "bridges before 2.1.9: nothing on the Tally page")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
