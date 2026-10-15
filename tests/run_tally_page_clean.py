"""python3 run_tally_page_clean.py - the calm Tally page and its ONE place to connect (15-Oct-2026; the owner: "all these
fields are coming in tally linking.. many of them are not useful.. clean it and make this user friendly"; "why we need gb
texcoat info.. check how Biz Analyst and other providers are providing these things"; "I have opened Tally but it is not
connected. I don't know how to connect even"; "multiple pages of Tally connection.. multiple places to connect.. need a
very simple connection guide").
  0. Connect Tally, the one place to connect and link: four steps ticked from the beat (install; Tally answering; a
     company open with reading on, paused said with how to resume; every client linked, a picker of the companies seen,
     the same GSTIN on top), each with one action, and Check again (the existing wake and a fresh read). All done: one
     green line, "Connected · <company> open in Tally · last entry <time>", and All good when nothing else needs him.
  1. One line per computer heard in the last 7 days: online and last heard, Tally, reading, version, "Update to 2.4.4"
     only when older. The old bridge is under Advanced.
  2. No Day Book counts on this page (they stay on the client's own Tally card).
  3. One table: Client · Tally company · Linked · Last entry received; Link opens the guide's step 4 with that client.
  4. ONE closed "Advanced (for support)" fold: every bridge, versions, stop on all, history, this browser's own bridge
     connect, install again, each computer's details, Sync activity and Everything sent.
  5. Every former entry point (the top bar's sign and its panel, the client's chip and Tally card, the Clients list chip,
     Today's not-linked line, Getting ready, Settings → Books in the cloud, the per-computer "Seen, not linked", Add
     client) lands on the guide at the right step, and none of them links or connects on its own.
  Staff see no owner button; a phone 390 wide never scrolls sideways.
Options: --shots DIR  saves the owner's scene (desktop 1440 and phone 390, light).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_page_clean.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8417
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the firm's computers as tally_devices keeps them (made-up; as run_tally_page_simple.py): times are "ago:<minutes>"
PORTS = [{"port": 9002, "ok": False, "skipped": False, "n": 0, "error": "", "state": "closed"},
         {"port": 2929, "ok": False, "skipped": True, "n": 0, "error": "Tally of Windows session 0", "state": ""},
         {"port": 3254, "ok": False, "skipped": True, "n": 0, "error": "Tally of Windows session 0", "state": ""}]
def dev(n, comp, user, at="ago:0.5", tally="open", opened=("GB TEXCOAT",), version="2.4.1", beat=None, ports=None, rec=("GB TEXCOAT", "ABC TRADERS"), cos=None):
    i = "d0000000-0000-4000-8000-00000000000%d" % n
    b = {"at": at, "version": version, "computer": comp, "user": user, "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally,
         "open": list(opened), "tallyPort": 9002, "dataFolder": "C:\\Users\\Public\\TallyPrime\\Data",
         "reqs": {"day": "TODAY", "last": {"kind": "vouchers", "ms": 1234, "at": "ago:2"}, "over20": 0, "n": 41},
         "recorder": {co: {"seen": True, "lastAt": "ago:7"} for co in set(opened) | set(rec)}}
    bt = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False,
          "ports": ports if ports is not None else [{"port": 9002, "ok": tally == "open", "skipped": False, "n": len(opened), "error": "", "state": tally}],
          "companies": cos if cos is not None else [{"name": co, "open": True, "phase": "live", "waiting": 0, "lastRead": "ago:30"} for co in opened]}
    bt.update(beat or {}); b.update({k: v for k, v in (beat or {}).items() if k in ("readStopped", "paused")})
    info = {"computer": comp, "user": user, "beat": bt, "bridges": {"go-%d" % n: b}}
    return {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": version, "main_bridge": "go-%d" % n, "info": info, "created_at": "2026-09-01T00:00:00Z",
            "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}
# the owner's scene: NWS144 (anshul) on 2.4.1, online, reading paused, his Tally not answering on 9002 (2929 and 3254 are
# Windows session 0's); an older bridge last heard 13 days ago (02-Oct)
PAUSED = dev(1, "NWS144", "anshul", tally="closed", opened=(), beat={"paused": True}, ports=PORTS, rec=(),
             cos=[{"name": "GB TEXCOAT", "open": False, "phase": "live", "waiting": 0, "lastRead": "2026-10-10T10:28:00+05:30"}])
OLD = {"id": "d0000000-0000-4000-8000-000000000009", "name": "OLDPC", "revoked": False, "last_seen": "ago:18720", "version": "1.15.0", "main_bridge": None,
       "info": {"computer": "OLDPC", "user": "tally", "beat": {"at": "ago:18720", "version": "1.15.0", "tally": False, "tallyState": "closed", "open": []}}, "created_at": "2026-09-01T00:00:00Z"}
D1 = PAUSED["id"]
# the clients: garg shekhar & company not linked; GB TEXCOAT and ABC TRADERS linked on NWS144 (each with entries that need
# that day's Day Book); VMS EVENTS seen in Tally, linked to nobody
CLIENTS = ["garg shekhar & company", "GB TEXCOAT", "ABC TRADERS"]
def companies(linked=("GB TEXCOAT", "ABC TRADERS"), seen=("VMS EVENTS",), d=D1):
    return [{"company": c, "client_id": "NAME:" + c, "device_id": d, "gstin": "", "last_seen": "ago:1"} for c in linked] + \
           [{"company": c, "client_id": None, "device_id": d, "gstin": "", "last_seen": "ago:1"} for c in seen]
WHY = "Tally did not give this entry when asked again; upload that day's Day Book to settle it"
def held(i, client):
    return {"id": i, "client_id": "NAME:" + client, "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": client, "line_id": "L%d" % i, "event": "created", "object_guid": "g-%d" % i,
            "alter_id": 900 + i, "vch_type": "Sales", "vch_no": str(i), "vch_date": "2026-10-10", "saved_at": "ago:600", "received_at": "ago:600", "applied_at": None, "state": "held", "held_why": WHY, "ledgers": []}
DAYBOOK = [held(i, "GB TEXCOAT") for i in range(1, 63)] + [held(100 + i, "ABC TRADERS") for i in range(3)]
SETUP = """([devs, companies, lines, role, clients, onlyMine]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  // the firm's clients: these three only (the others are set aside, so "All good" means what it says)
  if (onlyMine) Object.values(S.companies).forEach(c => { if (!clients.includes(c.name)) delete S.companies[c.id]; });
  const ids = {};
  clients.forEach(n => { let c = Object.values(S.companies).find(x => x.name === n);
    if (!c){ c = newCompany({name: n, gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
    ids[n] = c.id; });
  const cid = (v) => typeof v === "string" && v.startsWith("NAME:") ? ids[v.slice(5)] : v;
  window.__devs = fix(devs); window.__calls = []; window.__reads = 0; window.__wakes = [];
  window.__companies = fix(companies).map(x => Object.assign(x, {client_id: cid(x.client_id)}));
  window.__lines = fix(lines).map(l => Object.assign(l, {client_id: cid(l.client_id)}));
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) { window.__reads++; return copy(window.__devs); }
    if (/^tally_read_stops/.test(path)) return [];
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    if (/^tally_recorder_lines/.test(path)) return copy(window.__lines);
    if (/^tally_bridge_releases/.test(path)) return [{version: "2.4.4", pilot_started_at: ago(600), held_at: null, withdrawn_at: null}];
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  if (typeof TCloudUp === "object") TCloudUp.post = async (body) => { window.__wakes.push(body); return {}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.companies = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs.filter(d => !d.revoked); TLight.st.cos = window.__companies; TLight.st.stops = [];
  Rec.act = {rows: window.__lines, at: Date.now()};
  document.body.classList.add("is-test"); S.firm.firmName = "ABC";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {}; S.tallyFocus = ""; S.tallyGuide = {}; navHome("tally");
  return ids;
}"""
OWNER_HOOKS = ["data-read-stop", "data-read-resume", "data-read-stop-all", "data-read-resume-all", "data-release-hold", "data-release-unhold", "data-release-rollback",
    "data-release-rollback-clear", "data-release-withdraw", "data-trial-tools-switch", "data-recorder-source-pick", "data-ps-edit", "data-changes-only-switch",
    "data-make-main", "data-release-identity", "data-member-link-pick", "data-baseline-clear", "data-reparse", "data-pc-resume"]
FOLD = ["[data-bridge-card]", "[data-install-help]", "[data-connect-section]", '[data-pane="tally-history"]', "[data-release]", "[data-bridges]", "[data-read-stop-all]",
        "[data-client-lines]", "[data-bridge-ps]", "[data-bridge-sha]"]

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme="light"); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.4.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
            return pg
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        n = lambda sel: pg.locator(sel).count()
        page = lambda: pg.inner_text("#app")
        def scene(devs, cos, lines=(), role="owner", only=True):
            ids = E(SETUP, [devs, cos, list(lines), role, CLIENTS, only]); pg.wait_for_timeout(1800); return ids
        def fold(open_it=True):
            if (n("#app [data-advanced] [data-bridge-more]") > 0) != open_it:
                pg.click("#app [data-advanced] > [data-more-toggle]"); pg.wait_for_timeout(700)
        def shot(name, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
        def steps():
            return E("() => [...document.querySelectorAll('#app [data-connect-guide] [data-connect-step]')].map(e => [e.getAttribute('data-connect-step'), e.hasAttribute('data-done')])")

        # ---- 1. the owner's scene
        ids = scene([PAUSED, OLD], companies(), DAYBOOK)
        G = ids["garg shekhar & company"]
        body = page()
        ok(n("#app [data-advanced]") == 1 and n("#app [data-advanced] [data-bridge-more]") == 0 and "Advanced (for support)" in body, "one Advanced (for support) fold, closed")
        inside = [s for s in FOLD if n("#app " + s)]
        ok(not inside, "fold closed: install, this browser's connect, history, versions, every bridge, clients' lines all inside it (%s)" % inside)
        ok(not [w for w in ["127.0.0.1", "PowerShell", "Fingerprint", "Every bridge FinCom has heard from", "Connection history", "Roll back", "Hold version", "Stop reading on all computers", "Bridge key", "6-digit"] if w in body],
           "fold closed: none of its words on the page")
        ok(n("#app [data-tally-tab]") == 0 and "Sync activity" not in body and "Everything sent" not in body, "no tabs on the page: Sync activity and Everything sent are in the fold")
        ok("in three steps" not in body and n("#app [data-tally-guide]") == 0, "no old three-steps guide (%s)" % [l for l in body.split("\n") if "three steps" in l])
        # 0. the guide
        gd = "#app [data-connect-guide]"
        ok(n(gd) == 1 and txt(gd).startswith("Connect Tally"), "one Connect Tally guide")
        ok(steps() == [["install", True], ["tally", False], ["company", False], ["link", False]], "the steps tick from the beat: installed only (%s)" % steps())
        gt = txt(gd)
        ok("Open TallyPrime on NWS144, signed in as anshul." in gt and "F1 (Help) \u2192 Settings \u2192 Connectivity" in gt and "Both" in gt
           and "choose any free port from 9000 to 9999 (9002 is usual). Each Windows user on the same computer who runs Tally at the same time needs a different number. FinCom finds the port by itself." in gt,
           "step 2: the plain words, any free port, the one found here suggested (%s)" % gt[:400])
        ok("Reading is paused on NWS144." in gt and "right-click the FinCom icon near the clock \u2192 Resume background reading" in gt
           and "While paused, FinCom does not read Tally in the background; entries saved in Tally still come in, and postings still work." in gt, "step 3: paused, the tray's own words, what a pause stops")
        ok("garg shekhar & company is not linked." in gt and E("() => (document.querySelector('#app [data-guide-client]') || {}).value") == G
           and E("() => [...document.querySelectorAll('#app [data-guide-company] option')].map(o => o.value)") == ["VMS EVENTS"], "step 4: the client not linked and the companies seen (%s)" % gt[-200:])
        ok(n(gd + " [data-check-again]") == 1 and n(gd + " [data-bridge-download]") == 0, "one Check again; installed: no download in the guide")
        r0 = E("window.__reads"); pg.click(gd + " [data-check-again]"); pg.wait_for_timeout(1200)
        ok(E("window.__reads") > r0 and [w for w in E("window.__wakes") if w.get("kind") == "wake"], "Check again wakes the bridge (the existing wake) and reads the computers again (%s)" % E("window.__wakes"))
        # 1. the computers: only those heard in 7 days
        lines = E("() => [...document.querySelectorAll('#app [data-pc-line]')].map(e => [e.getAttribute('data-pc-line'), e.innerText.replace(/\\s+/g, ' ').trim()])")
        ok(len(lines) == 1 and lines[0][0] == D1 and "OLDPC" not in body and "Older bridge" not in body, "one line per computer heard in 7 days; the old bridge is not on the page (%s)" % lines)
        l1 = lines[0][1] if lines else ""
        ok("NWS144" in l1 and "anshul" in l1 and re.search(r"Online, last heard \d\d:\d\d IST", l1) and "Tally not open" in l1 and "Reading paused (tray: Resume background reading)" in l1 and "FinCom Bridge 2.4.1" in l1,
           "the computer line: online and last heard, Tally, reading, version (%s)" % l1)
        up = "#app [data-pc-line=\"%s\"] [data-pc-update]" % D1
        ok(n(up) == 1 and txt(up) == "Update to 2.4.4" and "2.4.4" in (pg.get_attribute(up, "href") or ""), "an older bridge: Update to 2.4.4, the one download (%s)" % txt(up))
        # Reading: one row a company the beat reports
        rd = lambda: E("() => [...document.querySelectorAll('#app [data-reading] [data-reading-row]')].map(e => [e.getAttribute('data-reading-row'), e.getAttribute('data-reading-kind'), [...e.querySelectorAll('td')].map(t => t.innerText.trim())])")
        ok(txt("#app [data-reading-head]") == "Reading: 0 companies live, 0 waiting for Tally, 0 stopped, 1 paused" and rd() and rd()[0][0] == "GB TEXCOAT" and "Paused" in rd()[0][2]
           and "10-Oct 10:28" in rd()[0][2] and "NWS144 (anshul)" in rd()[0][2], "Reading: paused, the company, the computer, the last entry 10-Oct 10:28 (%s | %s)" % (txt("#app [data-reading-head]"), rd()))
        ok("While paused, FinCom does not read Tally in the background" in txt("#app [data-reading]"), "Reading: what a pause stops, said once there")
        # 2. nothing said twice, no Day Book counts
        body = page()
        once = ["Reading is paused on NWS144", "Update to 2.4.4", "garg shekhar & company is not linked", "Open TallyPrime on NWS144", "Connect Tally"]
        ok(all(body.count(w) == 1 for w in once), "each problem's words once on the page (%s)" % [(w, body.count(w)) for w in once])
        gone = ["Day Book", "entries of", "Install FinCom Bridge 2.4.4", "Update now", "Tally not open on NWS144", "Seen, not linked", "Clients not linked", "Needs you"]
        ok(not [w for w in gone if w in body], "no Day Book counts, no Update now per client, nothing said twice (%s)" % [w for w in gone if w in body])
        ok(n("#app [data-all-good]") == 0, "something needs him: no All good")
        # 3. the clients table
        tb = "#app [data-tally-clients]"
        heads = E("() => [...document.querySelectorAll('#app [data-tally-clients] thead th')].map(e => e.innerText.trim())")
        ok(n(tb) == 1 and [h for h in heads if h] == ["Client", "Tally company", "Linked", "Last entry received"], "one table: Client, Tally company, Linked, Last entry received (%s)" % heads)
        rows = E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tally-clients] [data-client-row]')].map(e => [e.getAttribute('data-client-row'), [...e.querySelectorAll('td')].map(t => t.innerText.trim())]))")
        gb = rows.get(ids["GB TEXCOAT"], [])
        ok(len(rows) == 3 and "GB TEXCOAT" in gb and "Linked" in gb and any(re.match(r"^\d\d-[A-Z][a-z]{2} \d\d:\d\d$", c) for c in gb), "a linked client: its company, Linked, the last entry like 10-Oct 10:28 (%s)" % gb)
        ok("Not linked" in rows.get(G, []) and n(tb + " [data-client-link]") == 1 and n(tb + " td .btn") == 1, "the one action: Link for the client not linked; nothing for the others (%s)" % rows.get(G))
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "desktop: no sideways scroll")
        shot("after-desktop-1440")
        # Link in the table: the guide's step 4 with that client
        E("() => window.scrollTo(0, 0)"); pg.click(tb + " [data-client-link=\"%s\"]" % G); pg.wait_for_timeout(900)
        ok(E("[S.view, S.homeTab, (S.tallyGuide || {}).step, (S.tallyGuide || {}).cid]") == ["home", "tally", 4, G] and n('#app [data-connect-step="link"][data-open]') == 1
           and E("() => document.querySelector('#app [data-guide-client]').value") == G, "Link: the guide's step 4, that client chosen (%s)" % E("[S.view, S.homeTab, S.tallyGuide]"))
        # linking in step 4: the same tally_company_link as before, and the client's Tally name
        pg.click("#app [data-guide-link]"); pg.wait_for_timeout(1500)
        lk = [c for c in E("window.__calls") if c[0] == "tally_company_link"]
        ok(lk and lk[-1][1].get("p_company") == "VMS EVENTS" and lk[-1][1].get("p_client") == G and E("(c) => S.companies[c].tallyName", G) == "VMS EVENTS", "step 4's Link: tally_company_link and the Tally name (%s)" % lk)
        # the fold, opened: everything else, nothing removed
        ids = scene([PAUSED, OLD], companies(), DAYBOOK)
        fold(True)
        missing = [s for s in FOLD if s not in ('[data-install-help]',) and not n("#app [data-advanced] " + s)]
        ok(not missing, "fold open: install again, this browser's connect, history, versions, stop on all, every bridge, clients' lines (%s)" % missing)
        ok(n("#app [data-advanced] [data-bridges] [data-bridge-row]") >= 2 and "Older bridge" in txt("#app [data-advanced] [data-bridges]"), "fold: every bridge heard from, the old one too")
        ok(n('#app [data-advanced] [data-tally-tab="activity"]') == 1 and n('#app [data-advanced] [data-tally-tab="sent"]') == 1, "fold: Sync activity and Everything sent")
        ok(n('#app [data-advanced] [data-computer="%s"]' % D1) == 1 and n("#app [data-advanced] [data-release-hold]") == 1 and n("#app [data-advanced] [data-release-rollback]") == 1,
           "fold: each computer's details, Hold version, Roll back")
        pg.click('#app [data-advanced] [data-tally-tab="activity"]'); pg.wait_for_timeout(900)
        ok(n("#app [data-sync-activity]") == 1 and n('#app [data-tally-tab="computers"]') == 1, "Sync activity opens, with the way back")
        pg.click('#app [data-tally-tab="computers"]'); pg.wait_for_timeout(700)
        ok(n("#app [data-pc-line]") == 1, "back on the Tally page")
        fold(False)
        # the Day Book need stays on the client's own page (Client setup -> Tally: its Tally card)
        E("(c) => { openCompany(c); S.tab = 'cotally'; render(); }", ids["GB TEXCOAT"]); pg.wait_for_timeout(1200)
        ok("Day Book" in txt("#app [data-tally-link]"), "the Day Book need is on the client's own Tally card (%s)" % txt("#app [data-tally-link]")[:160])

        # ---- 2. the guide in each state
        def guide_scene(d, cos=None):
            scene([d], cos if cos is not None else companies(d=d["id"])); return d["id"]
        d = guide_scene(dev(2, "NWS144", "anshul", at="ago:90", tally="closed", opened=()))
        ok(steps() == [["install", True], ["tally", False], ["company", False], ["link", False]] and "FinCom Bridge on NWS144 is offline" in txt("#app [data-connect-guide]")
           and "Offline" in txt("#app [data-pc-line=\"%s\"]" % d), "offline: installed, the rest not; step 2 says it is offline (%s)" % steps())
        d = guide_scene(dev(3, "NWS144", "anshul", tally="open", opened=()))
        ok(steps() == [["install", True], ["tally", True], ["company", False], ["link", False]] and "Reading is paused" not in page() and "Leave TallyPrime open on a company" in txt("#app [data-connect-guide]"),
           "Tally answering, no company: two ticked (%s)" % steps())
        d = guide_scene(dev(4, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), beat={"paused": True}))
        ok(steps()[2] == ["company", False] and "Reading is paused on NWS144." in txt("#app [data-connect-guide]"), "a company open, reading paused: step 3 not done, how to resume (%s)" % steps())
        d = guide_scene(dev(5, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), beat={"readStopped": {"by": "fincom", "reason": "Tally hangs", "at": "ago:4"}}))
        sp = '#app [data-connect-step="company"]'
        ok("Reading stopped" in txt(sp) and n(sp + " [data-read-resume]") == 1, "stopped from FinCom: step 3 with the owner's Resume (%s)" % txt(sp))
        pg.click(sp + " [data-read-resume]"); pg.wait_for_timeout(600)
        ok([c for c in E("window.__calls") if c[0] == "tally_read_resume"], "Resume calls tally_read_resume")
        d = guide_scene(dev(6, "NWS144", "anshul", tally="open", opened=("VMS EVENTS",)), companies(seen=("VMS EVENTS",), d="d0000000-0000-4000-8000-000000000006"))
        ok(steps() == [["install", True], ["tally", True], ["company", True], ["link", False]], "a company open, a client not linked: three ticked (%s)" % steps())
        # same GSTIN on top of step 4's list
        E("""(c) => { S.companies[c].gstin = '09AANFG3202D1ZR'; window.__companies.push({company: 'GARG SHEKHAR', client_id: null, device_id: 'd0000000-0000-4000-8000-000000000006', gstin: '09AANFG3202D1ZR', last_seen: new Date().toISOString(), linked_at: new Date(Date.now() - 3600e3).toISOString()});
            TCloud.pane.devices = null; TCloud.pane.at = 0; TLight.st.cos = window.__companies; render(); }""", G); pg.wait_for_timeout(1800)
        opts = E("() => [...document.querySelectorAll('#app [data-guide-company] option')].map(o => o.innerText)")
        ok(opts and opts[0].startswith("GARG SHEKHAR (same GSTIN)"), "step 4: the company with the client's GSTIN on top (%s)" % opts)
        # all well: the guide is one green line, All good
        d6 = dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.4.4")
        d = guide_scene(d6, companies(linked=("GB TEXCOAT", "ABC TRADERS", "garg shekhar & company"), seen=(), d=d6["id"]))
        gl = txt('#app [data-connect-guide="done"]')
        ok(n("#app [data-connect-step]") == 0 and re.search(r"Connected \u00b7 GB TEXCOAT open in Tally \u00b7 last entry \d\d:\d\d IST", gl), "all four done: one green line (%s)" % gl)
        ok(n("#app [data-all-good]") == 1 and "All good" in gl and n("#app [data-needs-you]") == 0, "nothing needs him: All good")
        pl = txt("#app [data-pc-line=\"%s\"]" % d)
        ok("Connected" in pl and "Reading on" in pl and "FinCom Bridge 2.4.4" in pl and "Update to" not in pl, "all well: the line says connected, reading on, the version, no update (%s)" % pl)
        # ---- Reading in each state
        def rscene(d, lines=()):
            scene([d], companies(d=d["id"]), lines)
            return rd()
        live3 = dev(8, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), rec=("GB TEXCOAT",), cos=[{"name": "GB TEXCOAT", "open": True, "phase": "live", "waiting": 0, "lastRead": "ago:30"},
            {"name": "ABC TRADERS", "open": False, "phase": "live", "waiting": 0, "lastRead": "2026-10-10T10:28:00+05:30"}, {"name": "VMS EVENTS", "open": False, "phase": "", "waiting": 0, "lastRead": ""}])
        today = [dict(held(300 + i, "GB TEXCOAT"), state="applied", received_at="ago:5", device_id=live3["id"]) for i in range(4)]
        rows = rscene(live3, today)
        ok(txt("#app [data-reading-head]") == "Reading: 1 company live, 2 waiting for Tally, 0 stopped", "Reading: the one line on top (%s)" % txt("#app [data-reading-head]"))
        k = {r[0]: r for r in rows}
        ok(k.get("GB TEXCOAT", [0, 0, []])[1] == "live" and "Reading live" in k["GB TEXCOAT"][2] and re.match(r"\d\d-[A-Z][a-z]{2} \d\d:\d\d", k["GB TEXCOAT"][2][3]), "Reading live, its last entry (%s)" % k.get("GB TEXCOAT"))
        ok("Waiting: Tally company not open" in k.get("ABC TRADERS", [0, 0, []])[2] and "10-Oct 10:28" in k["ABC TRADERS"][2], "Waiting: Tally company not open, last entry from its last read (%s)" % k.get("ABC TRADERS"))
        heads = E("() => [...document.querySelectorAll('#app [data-reading] thead th')].map(e => e.innerText.trim())")
        ok("Received today" in heads and k["GB TEXCOAT"][2][heads.index("Received today")] == "4", "Received today: from Sync activity's lines this page holds (%s %s)" % (heads, k["GB TEXCOAT"][2]))
        pg.click("#app [data-reading-activity]"); pg.wait_for_timeout(900)
        ok(E("S.tallyTab") == "activity" and n("#app [data-sync-activity]") == 1, "See every entry received: Sync activity")
        rows = rscene(dev(9, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), cos=[{"name": "GB TEXCOAT", "open": True, "phase": "live", "waiting": 5, "lastRead": "ago:30"}]))
        ok(rows and rows[0][1] == "catching" and "Catching up: 5 to fetch" in rows[0][2], "Catching up: 5 to fetch (%s)" % rows)
        rows = rscene(dev(5, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), beat={"readStopped": {"by": "fincom", "reason": "Tally hangs", "at": "ago:4"}}))
        ok(rows and rows[0][1] == "stopped" and "Stopped: Tally hangs" in rows[0][2] and txt("#app [data-reading-head]").endswith("1 stopped"), "Stopped from FinCom: its reason (%s)" % rows)
        rows = rscene(dev(4, "RANJEET-PC", "ranjeet", version="2.3.0", tally="open", opened=("GB TEXCOAT",), beat={"readStopped": {"by": "self", "reason": "a request to Tally (TDSDeskCompanies) took 21.2 s", "at": "ago:30"}}))
        ok(rows and rows[0][1] == "stopped" and "Stopped: a request to Tally (TDSDeskCompanies) took 21.2 s" in rows[0][2], "Stopped by the bridge itself (2.3.0): its reason (%s)" % rows)
        # nothing installed: step 1 with the one download
        scene([], [])
        ok(steps() == [["install", False], ["tally", False], ["company", False], ["link", False]] and n('#app [data-connect-step="install"] [data-bridge-download]') == 1
           and "2.4.4" in txt('#app [data-connect-step="install"] [data-bridge-download]') and n("#app [data-all-good]") == 0, "nothing installed: step 1 with the download (%s)" % steps())

        # ---- 5. every former entry point lands on the guide, at the right step; none links or connects on its own
        ids = scene([dev(8, "NWS144", "anshul", tally="open", opened=("VMS EVENTS",))], companies(seen=("VMS EVENTS",), d="d0000000-0000-4000-8000-000000000008"), only=False)
        G = ids["garg shekhar & company"]
        E("() => { window.__calls = []; }")
        def landed(label, step, cid=None):
            g = E("[S.view, S.homeTab, S.tallyTab, S.tallyGuide || {}]")
            good = g[0] == "home" and g[1] == "tally" and g[2] == "computers" and g[3].get("step") == step and (cid is None or g[3].get("cid") == cid) and n("#app [data-connect-guide]") == 1
            ok(good, "%s: lands on Connect Tally, step %s%s (%s)" % (label, step or "first not done", " with the client" if cid else "", g))
        def at_client(tab="cotally"):
            E("(c) => { S.tallyGuide = {}; openCompany(c); S.tab = '%s'; render(); }" % tab, G); pg.wait_for_timeout(1200)
        LINKERS = '[data-tally-link-to], [data-tally-link-picker], select[data-card-link], select[aria-label^="Client for"], [data-act="bridgeConnect"], [data-connect-section]'
        # the client's Tally card (Client setup -> Tally)
        at_client()
        ok(n("#app [data-tally-link]") == 1 and n("#app " + LINKERS.replace(", ", ", #app ")) == 0 and n('#app [data-tally-link] [data-open-connect="4"]') == 1,
           "the client's Tally card: a pointer, nothing to link with (%s)" % txt("#app [data-tally-link]")[:120])
        pg.click('#app [data-tally-link] [data-open-connect]'); pg.wait_for_timeout(900); landed("the client's Tally card", 4, G)
        # the client's chip on its title line, and the top bar's sign
        at_client("dash")
        chip = '#app [data-tally-chip], #cobar [data-tally-chip]'
        if n(chip):
            pg.click(chip.split(", ")[0] if n(chip.split(", ")[0]) else chip.split(", ")[1]); pg.wait_for_timeout(900); landed("the client's Tally chip", 4, G)
        else:
            ok(False, "the client's Tally chip is on its page")
        at_client("dash")
        pg.click('[data-tally-sign]'); pg.wait_for_timeout(900); landed("the top bar's Tally sign", 4, G)
        # Getting ready's Link to Tally step
        at_client("dash")
        gr = '#app [data-onb-step="link"] button'
        if n(gr):
            pg.click(gr); pg.wait_for_timeout(900); landed("Getting ready's Link to Tally", 4, G)
        else:
            ok(n('#app [data-onb-step="link"]') == 0, "Getting ready: its link step is not shown here")
        # the Overview's Tally line
        at_client("dash")
        if n('#app [data-tally-link-line] [data-open-connect]'):
            pg.click('#app [data-tally-link-line] [data-open-connect]'); pg.wait_for_timeout(900); landed("the Overview's Tally line", 4, G)
        # the Clients list chip
        E("() => { S.tallyGuide = {}; navHome('clients'); }"); pg.wait_for_timeout(1200)
        cc = '#app [data-tally-chip-at="clients"][data-tally-chip="unlinked"]'
        ok(n(cc) >= 1, "the Clients list: a chip for the client not linked")
        if n(cc): pg.click(cc + " >> nth=0"); pg.wait_for_timeout(900); landed("the Clients list chip", 4)
        # Today's not-linked line
        E("() => { S.tallyGuide = {}; navHome('today'); }"); pg.wait_for_timeout(1200)
        tl = '#app [data-not-linked-open]'
        ok(n(tl) >= 1, "Today: the not-linked line")
        if n(tl): pg.click(tl + " >> nth=0"); pg.wait_for_timeout(900); landed("Today's not-linked line", 4)
        # Settings -> Books in the cloud
        E("() => { S.tallyGuide = {}; doAct('goTcloud'); }"); pg.wait_for_timeout(1500)
        ok(n('#app select[aria-label^="Client for"]') == 0 and n('#app [data-open-connect="4"]') >= 1, "Books in the cloud: no Link here, a pointer to Connect Tally")
        if n('#app [data-open-connect="4"]'): pg.click('#app [data-open-connect="4"] >> nth=0'); pg.wait_for_timeout(900); landed("Books in the cloud", 4)
        # the top bar's panel: Open Connect Tally (was Connect this computer: the browser's own bridge)
        E("() => { S.tallyGuide = {}; doAct('tallyConnect'); }"); pg.wait_for_timeout(900); landed("the top bar's panel", 0)
        ok(n("#app [data-connect-section]") == 0, "this browser's own bridge connect stays in the closed Advanced fold")
        # the per-computer "Seen, not linked" (Advanced -> each computer)
        fold(True)
        sn = '#app [data-advanced] [data-card-seen]'
        ok(n(sn) == 1 and n(sn + " select") == 0 and n(sn + " [data-open-connect]") == 1, "a computer's 'Seen, not linked': a pointer, no Link… box")
        if n(sn + " [data-open-connect]"): pg.click(sn + " [data-open-connect]"); pg.wait_for_timeout(900); landed("a computer's Seen, not linked", 4)
        fold(False)
        # Add client with its Tally company chosen: the guide's step 4 with both chosen, nothing linked yet
        E("""() => { S.tallyGuide = {}; const f = {name: 'NEW CLIENT', gstin: '', tallyCompany: 'VMS EVENTS', postOnly: false};
            return saveNewCompany(f); }""")
        pg.wait_for_timeout(1500)
        if E("Object.values(S.companies).some(c => c.name === 'NEW CLIENT')"):
            nc = E("Object.values(S.companies).find(c => c.name === 'NEW CLIENT').id")
            landed("Add client with a Tally company", 4, nc)
            ok(E("() => document.querySelector('#app [data-guide-company]').value") == "VMS EVENTS", "Add client: its Tally company chosen in step 4")
        ok(not [c for c in E("window.__calls") if c[0] in ("tally_company_link",)], "none of the entry points linked anything on its own (%s)" % E("window.__calls"))
        # ---- 3. staff: no owner button, fold open or not
        scene([PAUSED, OLD], companies(), DAYBOOK, role="staff")
        found = [h for h in OWNER_HOOKS if n("#app [%s]" % h)]
        fold(True)
        E("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"); pg.wait_for_timeout(600)
        found += [h for h in OWNER_HOOKS if n("#app [%s]" % h)]
        ok(n("#app [data-advanced] [data-bridges]") == 1 and not found, "staff: the fold opens, no owner button anywhere (%s)" % found)

        # ---- 4. phone 390: no sideways scroll
        pg.close(); pg = open_page(390, 844)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        scene([PAUSED, OLD], companies(), DAYBOOK)
        ok(n("#app [data-pc-line]") == 1, "phone: the page drawn")
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "phone 390: no sideways scroll (%s)" % E("() => [document.documentElement.scrollWidth, window.innerWidth]"))
        shot("after-phone-390")
        ok(not errors, "no page errors " + str(errors[:2]))
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
