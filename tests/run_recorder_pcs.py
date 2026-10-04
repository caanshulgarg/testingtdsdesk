"""python3 run_recorder_pcs.py - phase 2, F36 + N102 (is each PC recording Tally's changes?), J64 (silent today) and H52
(Tally not responding). From the heartbeat (tally_devices.info.bridges[id].recorder = {<company>: {seen, lastAt}}, FinCom
Bridge 2.1.9 on): the Tally page says per company on each computer "recording · last line <time>" or "not recording", and a
computer with a company open whose recorder is not seen says "Tally changes are not being recorded on <PC>"; the same red
banner at the top of the pages of a client whose company that is. No word at all while no bridge reports a recorder (before
2.1.9). tally_recorder_silent(p_firm) -> "Silent today: <PC> (Tally open since <time>, no recorder line)" for owner and staff.
beat.notAnsweringSince with reqs.last -> "Tally not responding on <PC> since <time>, last request <kind> <seconds>".
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
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    hm = lambda m: E("(m) => tallyHm(Date.now() - m * 60000)", m)
    hmIn = lambda text, m: any(hm(x) in text for x in (m, m + 1))
    E(SETUP, ["owner", DEVS, SILENT, "", ""]); pg.wait_for_timeout(1800)
    comp = lambda d: '#app [data-computer="%s"]' % d
    # ---- F36: per company on each computer
    zz = txt(comp(D1) + ' [data-recorder-co="ZZ TEST"]'); abc = txt(comp(D1) + ' [data-recorder-co="ABC LTD"]')
    ok(zz.startswith("ZZ TEST: recording") and "last line" in zz and hmIn(zz, 3), "NWS144, ZZ TEST: recording · last line <time> (%s)" % zz)
    ok(abc.startswith("ABC LTD: not recording"), "NWS144, ABC LTD: not recording (%s)" % abc)
    off = txt(comp(D1) + " [data-recorder-off]")
    ok(off == "Tally changes are not being recorded on NWS144", "the computer's line: 'Tally changes are not being recorded on NWS144' (%s)" % off)
    ok(pg.locator(comp(D2) + " [data-recorder-co], " + comp(D2) + " [data-recorder-off]").count() == 0, "TALLYSRV (a bridge before 2.1.9, no recorder word): nothing said")
    ok(pg.locator(comp(D3) + " [data-recorder-off]").count() == 0, "ACCTS2: its recorder not seen for ZZ TEST, but the company is not open there: no 'not being recorded'")
    # ---- H52
    nr = txt(comp(D3) + " [data-not-responding]")
    ok(nr.startswith("Tally not responding on ACCTS2 since ") and hmIn(nr, 12) and nr.endswith(", last request vouchers 24.1 s"), "H52: 'Tally not responding on ACCTS2 since <time>, last request vouchers 24.1 s' (%s)" % nr)
    ok(pg.locator(comp(D1) + " [data-not-responding]").count() == 0, "H52: not on a computer whose Tally answers")
    # ---- J64
    ok(["tally_recorder_silent", {"p_firm": "f-1"}] in E("window.__calls"), "J64: tally_recorder_silent(p_firm) asked (%s)" % E("window.__calls"))
    sl = txt("#app [data-recorder-silent]")
    ok(sl.startswith("Silent today: TALLYSRV (Tally open since ") and hmIn(sl, 300) and sl.endswith(", no recorder line)"), "J64: 'Silent today: TALLYSRV (Tally open since <time>, no recorder line)' (%s)" % sl)
    E(SETUP, ["staff", DEVS, SILENT, "", ""]); pg.wait_for_timeout(1800)
    ok(txt("#app [data-recorder-silent]").startswith("Silent today: TALLYSRV"), "J64: staff see it too")
    ok(txt(comp(D1) + " [data-recorder-off]") == "Tally changes are not being recorded on NWS144", "F36: staff see the computer's line too")
    E(SETUP, ["owner", DEVS, SILENT, "Could not find the function public.tally_recorder_silent(p_firm) in the schema cache (PGRST202)", ""]); pg.wait_for_timeout(1800)
    ok(pg.locator("#app [data-recorder-silent]").count() == 0 and pg.locator("#app [data-computer]").count() == 3, "J64: the function missing: nothing said, the page as before")
    # ---- the banner on a client's pages
    E(SETUP, ["owner", DEVS, SILENT, "", "abc"]); pg.wait_for_timeout(1500)
    bn = txt("#app [data-recorder-banner]")
    ok(bn == "Tally changes are not being recorded on NWS144", "ABC Client (ABC LTD open on NWS144, not recorded): the red banner at the top of its pages (%s)" % bn)
    ok("bad" in (pg.get_attribute("#app [data-recorder-banner]", "class") or "") or pg.locator("#app .bad [data-recorder-banner], #app [data-recorder-banner] .bad").count() > 0, "the banner is red")
    E("() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(800)
    ok(txt("#app [data-recorder-banner]") == "Tally changes are not being recorded on NWS144", "the same banner on the client's books")
    E(SETUP, ["owner", DEVS, SILENT, "", "zz"]); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-recorder-banner]").count() == 0, "ZZ Test Client (recorded on NWS144): no banner")
    # no bridge reports a recorder at all (every bridge before 2.1.9): no banner, no word on the Tally page
    OLD = [dev(D1, "NWS144", ["ZZ TEST", "ABC LTD"]), dev(D2, "TALLYSRV", ["OTHER CO"])]
    E(SETUP, ["owner", OLD, {"ok": True, "silent": []}, "", "abc"]); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-recorder-banner]").count() == 0, "bridges before 2.1.9: no banner")
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-recorder-co], #app [data-recorder-off], #app [data-recorder-silent]").count() == 0, "bridges before 2.1.9: nothing on the Tally page")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
