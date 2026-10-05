"""python3 run_bridge_per_user_ui.py - FinCom Bridge 2.3.0: one bridge for each Windows user on a shared Windows server (NW144:
anshul, ravi and meena each run their own Tally in their own Windows session; each user's bridge is its own computer key).
  1. The Tally page: one line per bridge, "<PC> · <Windows user>", with its Tally's port, the company open and the data
     folder; an owner's "Changes only" switch per bridge (tally_bridge_changes_only) and the member link (tally_member_bridge_link);
     a staff member sees the states, no switch.
  2. The Post confirm step names the bridge: computer · Windows user · company · data folder. A staff member linked to his
     own bridge posts through it (tally_post_enqueue_to with it as the target); an owner may pick another bridge, and the
     posting is queued for the one picked.
  3. Changes only: such a bridge is never offered on the Post screen, and a member linked to it posts through the main
     bridge as before (no target).
  4. The owner's conditions (Fix 2, Fix 3): "Release this bridge's identity" (owners: tally_bridge_reset with why); a
     computer key refused a bridge id shows FinCom's words on its own line; the owner's bell has ONE alert naming the
     computer and Windows user that tried (Mark read: tally_bridge_alert_read); the cloud's nobody-can-post words reach
     the person posting as they are; the target goes with its computer (p_device).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bridge_per_user_ui.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8279), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OWNER, RAVI, MEENA = "u-owner", "u-ravi", "u-meena"
def dev(i, user, tport, folder, bid):
    b = {"at": "ago:0.3", "version": "2.3.0", "computer": "NW144", "user": user, "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["ZZ CO"],
         "port": 9100 + tport - 9000, "tallyPort": tport, "dataFolder": folder}
    return {"id": i, "name": "NW144 · " + user, "revoked": False, "last_seen": "ago:0.3", "version": "2.3.0", "main_bridge": None, "created_at": "2026-10-01T00:00:00Z",
            "info": {"computer": "NW144", "user": user, "beat": {"at": "ago:0.3", "every": 30, "tally": True, "tallyState": "open", "open": ["ZZ CO"]}, "bridges": {bid: b}}}
DA, DR, DM = "d0000000-0000-4000-8000-0000000000a1", "d0000000-0000-4000-8000-0000000000a2", "d0000000-0000-4000-8000-0000000000a3"
BA, BR, BM = "go-aaaa000001", "go-bbbb000002", "go-cccc000003"
DEVS = [dev(DA, "anshul", 9000, "C:\\Users\\Public\\TallyPrime\\data", BA), dev(DR, "ravi", 9001, "D:\\TallyData\\Ravi", BR), dev(DM, "meena", 9002, "D:\\TallyData\\Meena", BM)]
MEMBERS = [{"user_id": OWNER, "name": "Anshul", "role": "owner", "active": True}, {"user_id": RAVI, "name": "Ravi", "role": "staff", "active": True}, {"user_id": MEENA, "name": "Meena", "role": "staff", "active": True}]
SETUP = """([devs, prefs, links, members, role, me, balerts]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  window.__devs = fix(devs); window.__prefs = prefs; window.__links = links; window.__balerts = balerts || []; window.__calls = [];
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = members;
  Cloud.sess = () => ({user_id: me, access_token: "t"});
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_bridge_prefs/.test(path)) return copy(window.__prefs);
    if (/^tally_member_bridges/.test(path)) return copy(window.__links);
    if (/^tally_bridge_alerts/.test(path)) return copy(window.__balerts);
    if (/^tally_companies/.test(path)) return [{company: "ZZ CO", client_id: "c-zz", device_id: devs[0].id, gstin: "", last_seen: ago(1)}];
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return fn.startsWith("tally_post_enqueue") ? {ok: true, id: a.p_id, company: "ZZ CO"} : {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = ""; S.postTarget = {};
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; navHome("clients");
}"""
# the Post confirm step for client ZZ (posts to ZZ CO): opened, read, a bridge picked (or not), Post pressed; then the
# posting queued through CloudPost.run (its row answered done at once)
CONFIRM = """async ([pick]) => {
  const co = {id: "c-zz", name: "ZZ", postTo: "ZZ CO"};
  const rows = [{kind: "bill", id: "b1", no: "INV-1", party: "Party", xml: "<VOUCHER VCHTYPE=\\"Purchase\\"><DATE>20261001</DATE><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><NARRATION>TDSDesk:b1</NARRATION></VOUCHER>", e: {id: "b1", x: {}}}];
  const p = postPreview(co, rows);
  await new Promise(r => setTimeout(r, 300));
  const box = document.getElementById("confirmBox");
  const sel = box.querySelector("[data-post-target-pick]");
  const out = {words: (box.querySelector("[data-post-target-words]") || {}).textContent || "", target: (box.querySelector("[data-post-target]") || {getAttribute: () => null}).getAttribute("data-post-target"),
    options: sel ? [...sel.options].map(o => o.value) : null};
  if (pick && sel){ sel.value = pick; sel.dispatchEvent(new Event("change")); out.after = box.querySelector("[data-post-target-words]").textContent; out.targetAfter = box.querySelector("[data-post-target]").getAttribute("data-post-target"); }
  box.querySelector('[data-cbx="yes"]').click();
  out.posted = await p;
  CloudPost.row = async (id) => ({id, status: "done", results: [], n: 1});
  CloudPost.sleep = () => Promise.resolve();
  window.__calls = [];
  try { await CloudPost.run("c-zz", {company: "ZZ CO", vouchers: [{id: "b1", xml: "<VOUCHER/>"}]}); } catch (e){ out.err = String(e && e.message || e); }
  out.enq = window.__calls.filter(c => c[0].startsWith("tally_post_enqueue")).map(c => [c[0], c[1].p_target || null]);
  out.dev = (window.__calls.find(c => c[0] === "tally_post_enqueue_to") || [null, {}])[1].p_device || null;
  return out;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.3.0", "url": "https://x/s.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8279/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    def tally_page(prefs, links, role, me, balerts=None, devs=None):
        E(SETUP, [devs or DEVS, prefs, links, MEMBERS, role, me, balerts or []]); pg.wait_for_timeout(500)
        pg.locator('#side button[aria-label="Tally"]').first.click(); pg.wait_for_timeout(1500)
    # ---- 1. the Tally page, as the owner
    tally_page([{"device_id": DM, "bridge_id": BM, "changes_only": True}], [{"user_id": RAVI, "device_id": DR, "bridge_id": BR}, {"user_id": MEENA, "device_id": DM, "bridge_id": BM}], "owner", OWNER)
    lines = pg.locator("#app [data-computers] [data-computer]")
    ok(lines.count() == 3, "1. one line per Windows user's bridge on NW144 (%d)" % lines.count())
    lr = txt('#app [data-computer="%s"]' % DR)
    ok("NW144" in lr and "ravi" in lr and pg.get_attribute('#app [data-computer="%s"]' % DR, "data-bridge-user") == "ravi", "1. ravi's line: NW144 · ravi (%s)" % lr[:120])
    w = txt('#app [data-computer="%s"] [data-bridge-where]' % DR)
    ok(w == "Tally port 9001 · ZZ CO · data folder D:\\TallyData\\Ravi", "1. its Tally port, company and data folder (%s)" % w)
    ok("Posts for: Ravi" in txt('#app [data-computer="%s"] [data-member-link]' % DR), "1. ravi's bridge posts for Ravi (linked by the owner)")
    lm = txt('#app [data-computer="%s"] [data-changes-only]' % DM)
    ok("Changes only: never posts" in lm and pg.locator('#app [data-computer="%s"] [data-changes-only][data-changes-on]' % DM).count() == 1, "1. meena's bridge: Changes only (%s)" % lm)
    ok("Reads and posts" in txt('#app [data-computer="%s"] [data-changes-only]' % DR), "1. ravi's bridge reads and posts")
    pg.click('#app [data-computer="%s"] [data-changes-only-switch]' % DR); pg.wait_for_timeout(300)
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(500)
    c = [x for x in E("window.__calls") if x[0] == "tally_bridge_changes_only"]
    ok(c and c[-1][1] == {"p_device": DR, "p_bridge": BR, "p_on": True}, "1. the owner switches ravi's bridge to changes only (asked first): %s" % c)
    pg.select_option('#app [data-computer="%s"] [data-member-link-pick]' % DA, OWNER); pg.wait_for_timeout(500)
    c = [x for x in E("window.__calls") if x[0] == "tally_member_bridge_link"]
    ok(c and c[-1][1] == {"p_user": OWNER, "p_device": DA, "p_bridge": BA}, "1. the owner links himself to his own bridge: %s" % c)
    # ---- 2. the Post confirm step, as the owner: names the bridge; another may be picked; changes only never offered
    tally_page([{"device_id": DM, "bridge_id": BM, "changes_only": True}], [{"user_id": RAVI, "device_id": DR, "bridge_id": BR}, {"user_id": MEENA, "device_id": DM, "bridge_id": BM}], "owner", OWNER)
    r = E(CONFIRM, [BR])
    ok(r["words"] == "NW144 · anshul · ZZ CO · C:\\Users\\Public\\TallyPrime\\data", "2. the confirm step names computer · Windows user · company · data folder (%s)" % r["words"])
    ok(r["options"] is not None and BM not in r["options"] and set(r["options"]) == {BA, BR}, "3. the owner's picker offers the bridges that may post, never meena's (changes only) (%s)" % r["options"])
    ok(r.get("after") == "NW144 · ravi · ZZ CO · D:\\TallyData\\Ravi" and r.get("targetAfter") == BR, "2. picking ravi's bridge names it (%s)" % r.get("after"))
    ok(r["posted"] is True and r["enq"] == [["tally_post_enqueue_to", BR]] and r.get("dev") == DR, "2. the posting is queued for ravi's bridge, named with its computer (%s %s %s)" % (r["enq"], r.get("dev"), r.get("err", "")))
    # as Ravi (staff, linked to his own bridge): his bridge named, no picker, queued for it
    tally_page([{"device_id": DM, "bridge_id": BM, "changes_only": True}], [{"user_id": RAVI, "device_id": DR, "bridge_id": BR}, {"user_id": MEENA, "device_id": DM, "bridge_id": BM}], "staff", RAVI)
    ok(pg.locator("#app [data-changes-only-switch]").count() == 0 and pg.locator("#app [data-member-link-pick]").count() == 0 and "Changes only: never posts" in txt('#app [data-computer="%s"]' % DM),
       "1. staff see the states, no switch and no link")
    r = E(CONFIRM, [None])
    ok(r["words"] == "NW144 · ravi · ZZ CO · D:\\TallyData\\Ravi" and r["options"] is None and r["enq"] == [["tally_post_enqueue_to", BR]], "2. Ravi's posting goes through his own bridge, named; no picker (%s | %s)" % (r["words"], r["enq"]))
    # as Meena (staff, linked to her changes-only bridge): never offered it; the computer's main bridge as before (no target)
    tally_page([{"device_id": DM, "bridge_id": BM, "changes_only": True}], [{"user_id": RAVI, "device_id": DR, "bridge_id": BR}, {"user_id": MEENA, "device_id": DM, "bridge_id": BM}], "staff", MEENA)
    r = E(CONFIRM, [None])
    ok("meena" not in r["words"] and r["enq"] == [["tally_post_enqueue", None]], "3. Meena's bridge is changes only: not offered, her posting goes as before (%s | %s)" % (r["words"], r["enq"]))
    # ---- 4. the owner's conditions: release, the refused key's line, the bell, the cloud's words
    import copy as _c
    devs2 = _c.deepcopy(DEVS)
    W = "This computer key cannot use bridge %s: it belongs to NW144 · anshul. Ask the firm's owner." % BA
    devs2.append({"id": "d0000000-0000-4000-8000-0000000000a9", "name": "NW144 · durgesh", "revoked": False, "last_seen": "ago:0.2", "version": "2.3.0", "main_bridge": None, "created_at": "2026-10-02T00:00:00Z",
                  "info": {"idRefused": {"bridge": BA, "words": W, "at": "ago:0.2"}}})
    BAL = [{"id": 7, "bridge_id": BA, "device_id": "d0000000-0000-4000-8000-0000000000a9", "tried_computer": "NW144", "tried_user": "durgesh", "words": W, "at": "ago:0.2", "last_at": "ago:0.2", "read_at": None}]
    tally_page([], [], "owner", OWNER, BAL, devs2)
    ok(W in txt('#app [data-id-refused="d0000000-0000-4000-8000-0000000000a9"]'), "4. the refused computer key's own line shows FinCom's words (%s)" % txt('#app [data-id-refused]')[:160])
    pg.click('#app [data-computer="%s"] [data-release-identity="%s"]' % (DA, BA)); pg.wait_for_timeout(300)
    pg.fill("#releaseWhy", "durgesh copied the settings"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    c = [x for x in E("window.__calls") if x[0] == "tally_bridge_reset"]
    ok(c and c[-1][1] == {"p_bridge": BA, "p_why": "durgesh copied the settings"}, "4. the owner releases the bridge's identity, with why (%s)" % c)
    E("render()"); pg.wait_for_timeout(300)
    bell = E("AlertHub.list().filter(x => x.key.startsWith('bridgeid:')).map(x => x.text)")
    ok(bell == ["NW144 · durgesh tried to use bridge %s, which belongs to another computer; FinCom refused it." % BA], "4. ONE bell alert for the owner naming the computer and Windows user that tried (%s)" % bell)
    E("AlertHub.list().find(x => x.key.startsWith('bridgeid:')).act.run()"); pg.wait_for_timeout(400)
    ok([x for x in E("window.__calls") if x[0] == "tally_bridge_alert_read"] == [["tally_bridge_alert_read", {"p_id": 7}]], "4. Mark read: tally_bridge_alert_read")
    tally_page([], [], "staff", RAVI, BAL, devs2)
    ok(pg.locator("#app [data-release-identity]").count() == 0 and E("AlertHub.list().filter(x => x.key.startsWith('bridgeid:')).length") == 0, "4. staff: no release button, no such alert")
    # the cloud's words when nobody can post reach the person as they are
    WN = "Nobody can post into ZZ CO just now: the only computer that has it open (NW144 · meena) is set to Changes only. Open the company in Tally on a computer that may post (NW144 · anshul), or ask the owner to switch Changes only off for that bridge."
    E("""(w) => { TCloud.rpc = async (fn, a) => { window.__calls.push([fn, a]); return fn.startsWith("tally_post_enqueue") ? {ok: false, error: w} : {ok: true}; }; }""", WN)
    msg = E("CloudPost.run('c-zz', {company: 'ZZ CO', vouchers: [{id: 'b2', xml: '<VOUCHER/>'}]}).then(() => '', e => e.message || String(e))")
    ok(msg == WN, "4. the nobody-can-post words reach the person posting as they are (%s)" % msg[:120])
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:300]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
raise SystemExit(1 if fails else 0)
