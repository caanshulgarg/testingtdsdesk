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
  6. Round 63 (16-Oct-2026): six steps (+ Import ledgers, Bring in this year's entries) with a strip on top; step 5's
     ledgers-only wake (one call), the moving bar and the time, "1,240 ledgers imported ✓", nothing in 10 minutes: Try
     again and the masters file (a Master.xml marks step 5 done with its count; upload_ledgers declared complete, the
     book's own dates, no opening from the file); step 6's three lines and Open Upload; step 3 says the number of
     companies open, never their names; step 4 is the client worked on, every company open offered (one of another
     client "will move", asked first); 100 companies and 100 clients stay compact with type-to-search; a port change
     (9002 -> 9500) keeps the client linked everywhere.
  8. 26-Oct-2026 (next-tally-port): step 2 is Set Tally's port (run_tally_port_step.py), between Install and Open.
  7. 23-Oct-2026 (next-tally-suvit, Suvit's flow; the owner: "don't need extra steps in connection"): the guide is three
     steps (Install FinCom Bridge, Open your company in TallyPrime, Add as client / Link), ticked from the beats and the
     links; linking, the ledgers and this year's entries live on Companies in Tally's rows (Add as client / Link to
     <client>, the first sync's wake once, the bar and the time, "Ledgers 1,240 ✓ · Entries …", 10 minutes: Try again
     and the masters file, the reply that nobody was asked, ⋯ Upload older entries (Day Book), ⋯ Not this client); every
     entry point lands on the client's Tally card (its companies with Link) or on Companies in Tally.
Options: --shots DIR  saves the owner's scene (desktop 1440 and phone 390, light) and the guide's steps 5 and 6.
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
# 17-Oct-2026: an ask to load, update or turn on FinCom's add-on (TDL) or recorder, in any words the page used
ADDON_ASK = re.compile(r"\b(load|loaded|update|turn on|switch on|enable|install)\b[^.\n]{0,60}\b(add-on|addon|TDLs?|recorder)\b"
                       r"|\b(add-on|addon|TDLs?|recorder)\b[^.\n]{0,40}\b(not loaded|not recording|load|update|turn on)\b|not recording|Manage Local TDLs", re.I)
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
def book(name, ledgers=True, days=True):
    return [{"book": "bk-" + name, "company": name, "from": "2026-04-01", "openAsOn": "2026-03-31", "ledgersAt": "ago:600" if ledgers else None,
             "daysAt": "ago:600" if days else None, "days": 190 if days else 0, "entries": 4000 if days else 0, "to": "TODAY" if days else None, "state": {}}]
HELD_ALL = {c: book(c) for c in ["garg shekhar & company", "GB TEXCOAT", "ABC TRADERS"]}
# a ledger masters file (Tally: List of Accounts, Alt+E, XML): two groups and three ledgers
MASTERS = ("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>"
           "<TALLYMESSAGE><GROUP NAME=\"Sundry Creditors\"><PARENT>Current Liabilities</PARENT></GROUP></TALLYMESSAGE>"
           "<TALLYMESSAGE><LEDGER NAME=\"Cash\"><PARENT>Cash-in-Hand</PARENT><OPENINGBALANCE>-5000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>"
           "<TALLYMESSAGE><LEDGER NAME=\"Rent\"><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>"
           "<TALLYMESSAGE><LEDGER NAME=\"VMS EVENTS\"><PARENT>Sundry Creditors</PARENT><PARTYGSTIN>09AANFG3202D1ZR</PARTYGSTIN></LEDGER></TALLYMESSAGE>"
           "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
DAYBOOK = [held(i, "GB TEXCOAT") for i in range(1, 63)] + [held(100 + i, "ABC TRADERS") for i in range(3)]
SETUP = """([devs, companies, lines, role, clients, onlyMine, books]) => {
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
  // round 63: each client's book in the cloud (tally_status) and its ledgers (tally_ledgers), by the client's name
  window.__books = {}; Object.entries(fix(books || {})).forEach(([n, b]) => { window.__books[ids[n]] = b; });
  window.__ledgers = {}; window.__wakeAns = {ok: true, woken: 1, debounced: 0, asked: 1};
  Object.keys(TCloud.st).forEach(k => delete TCloud.st[k]); Ledgers.st = {}; S.ledImp = null; S.ledFile = null;
  S.tallyFold = {};
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) { window.__reads++; return copy(window.__devs); }
    if (/^tally_read_stops/.test(path)) return [];
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    if (/^tally_recorder_lines/.test(path)) return copy(window.__lines);
    if (/^tally_ledgers/.test(path)) { const m = /book_id=eq\.([^&]+)/.exec(path); return copy((window.__ledgers || {})[m ? decodeURIComponent(m[1]) : ""] || []); }
    if (/^tally_bridge_releases/.test(path)) return [{version: "2.4.4", pilot_started_at: ago(600), held_at: null, withdrawn_at: null}];
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    // as over the network: answered on a later turn (an answer in the same turn would starve the page's timers)
    if (fn === "tally_status") { await new Promise(r => setTimeout(r, 5)); return copy(window.__books[a.p_client] || []); }
    return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  if (typeof TCloudUp === "object") TCloudUp.post = async (body) => { window.__wakes.push(body); return body && body.kind === "wake" && body.what === "ledgers" ? copy(window.__wakeAns) : {}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.companies = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs.filter(d => !d.revoked); TLight.st.cos = window.__companies; TLight.st.stops = [];
  Rec.act = {rows: window.__lines, at: Date.now()};
  document.body.classList.add("is-test"); S.firm.firmName = "ABC";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {}; S.tallyFocus = ""; S.tallyGuide = {}; S.coId = null; navHome("tally");
  return ids;
}"""
OWNER_HOOKS = ["data-read-stop", "data-read-resume", "data-read-stop-all", "data-read-resume-all", "data-release-hold", "data-release-unhold", "data-release-rollback",
    "data-release-rollback-clear", "data-release-withdraw", "data-trial-tools-switch", "data-recorder-source-pick", "data-ps-edit", "data-changes-only-switch",
    "data-make-main", "data-release-identity", "data-member-link-pick", "data-baseline-clear", "data-reparse", "data-pc-resume"]
FOLD = ["[data-bridge-card]", "[data-install-help]", "[data-connect-section]", '[data-pane="tally-history"]', "[data-release]", "[data-bridges]", "[data-read-stop-all]",
        "[data-bridge-ps]", "[data-bridge-sha]"]   # round 66: the outdated "Clients' Tally" lines ([data-client-lines]) are gone

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h, scheme="light"):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme=scheme); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.4.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            return pg
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        n = lambda sel: pg.locator(sel).count()
        page = lambda: pg.inner_text("#app")
        def scene(devs, cos, lines=(), role="owner", only=True, books=None):
            ids = E(SETUP, [devs, cos, list(lines), role, CLIENTS, only, books or {}]); pg.wait_for_timeout(1800); return ids
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
        ok(n("#app [data-advanced]") == 1 and n("#app [data-advanced] [data-bridge-more]") == 0 and "Help & support" in body, "one Help & support fold, closed")
        inside = [s for s in FOLD if n("#app " + s)]
        ok(not inside, "fold closed: install, this browser's connect, history, versions, every bridge, clients' lines all inside it (%s)" % inside)
        ok(not [w for w in ["127.0.0.1", "PowerShell", "Fingerprint", "Every bridge FinCom has heard from", "Connection history", "Roll back", "Hold version", "Stop reading on all computers", "Bridge key", "6-digit"] if w in body],
           "fold closed: none of its words on the page")
        ok(n("#app [data-tally-tab]") == 0 and "Sync activity" not in body and "Everything sent" not in body, "no tabs on the page: Sync activity and Everything sent are in the fold")
        ok("in three steps" not in body and n("#app [data-tally-guide]") == 0, "no old three-steps guide (%s)" % [l for l in body.split("\n") if "three steps" in l])
        # 0. the guide (23-Oct-2026, next-tally-suvit: Suvit's three steps; linking, the ledgers and the entries are the rows
        # of Companies in Tally)
        # 24-Oct-2026 (next-tally-one-page): companies are linked, so no steps: one line of the computers instead
        gd = "#app [data-connect-guide]"
        # next-tally-smart: a computer connected: no steps; ONE status card for it ("NWS144 · anshul · FinCom Bridge 2.4.1 · Paused")
        card = re.sub(r"\s+", " ", txt("#app [data-status-card]"))
        ok(n("#app [data-connect-step]") == 0 and n("#app [data-status-card]") == 1 and card.startswith("NWS144 · anshul") and "Paused" in card,
           "a computer connected: no steps; the one status card, Paused (%s)" % card[:120])
        # the owner, 28-Oct-2026 ("show only currently opened Tally"): VMS EVENTS was seen once, not open, not linked: not on the
        # page; under Help & support › Every company seen, Not linked · not open in Tally now, the picker (Task D: no Add as client)
        ok(n('#app [data-tco-list=firm] [data-tco-row="VMS EVENTS"]') == 0 and "VMS EVENTS" not in body, "VMS EVENTS (seen, not open, not linked): not on the page")
        pg.click("#app [data-advanced] [data-bridge-details]"); pg.wait_for_timeout(700)
        vr = E("() => { const r = document.querySelector('#app [data-advanced] [data-tco-list=all] [data-tco-row=\"VMS EVENTS\"]'); return r ? [r.getAttribute('data-tco-state'), r.innerText.replace(/\\s+/g, ' '), r.querySelectorAll('select[data-tco-act=pick]').length] : null; }")
        ok(vr and vr[0] == "notopen" and "Not linked · not open in Tally now" in vr[1] and vr[2] == 1 and "Add as client" not in vr[1],
           "Help & support › Every company seen: VMS EVENTS, Not linked · not open in Tally now, the picker (Task D: no Add as client) (%s)" % vr)
        pg.click("#app [data-advanced] [data-bridge-details]"); pg.wait_for_timeout(500)
        # 1. the computers: only those heard in 7 days (the card is this computer's; the old bridge is under Help & support)
        lines = E("() => [...document.querySelectorAll('#app [data-pc-line]')].map(e => [e.getAttribute('data-pc-line'), e.innerText.replace(/\\s+/g, ' ').trim()])")
        ok(len(lines) == 1 and lines[0][0] == D1 and "OLDPC" not in body and "Older bridge" not in body, "one computer heard in 7 days: the card is its; the old bridge is not on the page (%s)" % lines)
        up = "#app [data-status-card] [data-pc-update]"
        ok(n(up) == 1 and txt(up) == "Update to 2.4.4" and "2.4.4" in (pg.get_attribute(up, "href") or ""), "an older bridge: Update to 2.4.4, the one download (%s)" % txt(up))
        # 2. nothing said twice, no Day Book counts
        body = page()
        once = ["Update to 2.4.4", "Reading is paused"]
        ok(all(body.count(w) == 1 for w in once), "each problem's words once on the page (%s)" % [(w, body.count(w)) for w in once])
        gone = ["needs its Day Book", "entries waiting", "entries of", "Install FinCom Bridge 2.4.4", "Update now", "Tally not open on NWS144", "Seen, not linked", "Clients not linked", "Needs you", "Clients and their Tally company"]
        ok(not [w for w in gone if w in body], "no Day Book counts, no Update now per client, nothing said twice (%s)" % [w for w in gone if w in body])
        ok(n("#app [data-all-good]") == 0, "something needs him: no All good")
        # round 66: the reading table and the clients' table are in Help & support (closed by default): open it
        ok(n("#app [data-reading]") == 0 and n("#app [data-tally-clients]") == 0, "round 66: fold closed: no reading table, no clients' table on the page")
        pg.click("#app [data-advanced] [data-bridge-details]"); pg.wait_for_timeout(700)
        # Reading: one row a company the beat reports
        rd = lambda: E("() => [...document.querySelectorAll('#app [data-reading] [data-reading-row]')].map(e => [e.getAttribute('data-reading-row'), e.getAttribute('data-reading-kind'), [...e.querySelectorAll('td')].map(t => t.innerText.trim())])")
        ok(txt("#app [data-reading-head]") == "Reading: 0 companies live, 0 waiting for Tally, 0 stopped, 1 paused" and rd() and rd()[0][0] == "GB TEXCOAT" and "Paused" in rd()[0][2]
           and "10-Oct 10:28" in rd()[0][2] and "NWS144 (anshul)" in rd()[0][2], "Reading: paused, the company, the computer, the last entry 10-Oct 10:28 (%s | %s)" % (txt("#app [data-reading-head]"), rd()))
        ok("While paused, FinCom does not read Tally in the background" in txt("#app [data-reading]"), "Reading: what a pause stops, said once there")
        ok(n("#app [data-reading][data-folded]") == 1 and n('#app [data-show-all="reading"]') == 0, "Reading: folded; its one row (paused) above the fold, so no Show all")
        # 3. the clients' table is gone (24-Oct-2026: the list is the one place); a client not linked: the list for it
        ok(n("#app [data-tally-clients]") == 0 and n("#app [data-client-link]") == 0, "no clients' table, even with Help & support open")
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "desktop: no sideways scroll")
        shot("after-desktop-1440")
        E("(c) => openConnectTally(4, c)", G); pg.wait_for_timeout(900)
        ok(E("[S.view, S.homeTab, (S.tallyGuide || {}).step, (S.tallyGuide || {}).cid]") == ["home", "tally", 4, G] and n('#app [data-tco-for="%s"]' % G) == 1,
           "a pointer: Companies in Tally for that client (%s)" % E("[S.view, S.homeTab, S.tallyGuide]"))
        # (next-tally-smart: for a client named, every company, the open ones first, so one not open now can be linked too)
        ok(txt('#app [data-tco-list=firm] [data-tco-row="VMS EVENTS"] [data-tco-act]') == "Link to garg shekhar & company" and all(t == "Move here" for t in E("() => [...document.querySelectorAll(\"#app [data-tco-list=firm] [data-tco-linked]:not([data-tco-linked='']) [data-tco-act]\")].map(b => b.innerText.trim())")),
           "his scene: the company seen (not open) is offered, 'Link to garg shekhar & company'; the linked ones show their client and 'Move here' (%s)" % txt('#app [data-tco-list=firm]')[:200])
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
        # the Day Book upload stays on the client's own Books › From Tally
        E("(c) => { openCompany(c); S.tab = 'books'; S.booksTab = 'import'; render(); }", ids["GB TEXCOAT"]); pg.wait_for_timeout(1200)
        ok(n("#app [data-up-drop]") == 1 and n("#app [data-tally-link]") == 0, "Books › From Tally: the Day Book upload, no Tally card")

        # ---- 2. the status card in each state (next-tally-smart: a computer connected shows no steps; the card says the one
        # problem and its one action)
        def guide_scene(d, cos=None):
            scene([d], cos if cos is not None else companies(linked=(), d=d["id"])); return d["id"]
        card = lambda: re.sub(r"\s+", " ", txt("#app [data-status-card]"))
        d = guide_scene(dev(2, "NWS144", "anshul", at="ago:90", tally="closed", opened=()))
        ok(steps() == [] and n("#app [data-tsc-need=offline]") == 1 and "NWS144 (anshul) is not connected" in card(), "offline: no steps; the card says it is not connected (%s)" % card()[:140])
        d = guide_scene(dev(3, "NWS144", "anshul", tally="open", opened=()))
        ok(steps() == [] and "Reading is paused" not in page() and n("#app [data-tsc-need=noco]") == 1 and "Open your company in TallyPrime" in card(), "Tally answering, no company: open your company (%s)" % card()[:140])
        d = guide_scene(dev(4, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), beat={"paused": True}))
        ok(n("#app [data-tsc-need=paused]") == 1 and "Reading is paused here" in card() and "Resume background reading" in card(), "a company open, reading paused: how to resume (%s)" % card()[:160])
        d = guide_scene(dev(5, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), beat={"readStopped": {"by": "fincom", "reason": "Tally hangs", "at": "ago:4"}}))
        sp = '#app [data-status-card]'
        ok("Reading stopped" in txt(sp) and n(sp + " [data-read-resume]") == 1, "stopped from FinCom: the card with the owner's Resume (%s)" % txt(sp)[:140])
        pg.click(sp + " [data-read-resume]"); pg.wait_for_timeout(600)
        ok([c for c in E("window.__calls") if c[0] == "tally_read_resume"], "Resume calls tally_read_resume")
        D6 = "d0000000-0000-4000-8000-000000000006"
        d = guide_scene(dev(6, "NWS144", "anshul", tally="open", opened=("VMS EVENTS", "GARG SHEKHAR", "GB TEXCOAT")), companies(linked=(), seen=("VMS EVENTS",), d=D6))
        ok(steps() == [] and "Tally open: 3 companies" in card() and "VMS EVENTS" not in card(), "three companies open: the card says the number open, never their names (%s)" % card()[:120])
        rs = E("() => [...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), r.getAttribute('data-tco-state'), r.querySelectorAll('select[data-tco-act=pick]').length])")
        ok(sorted(r[0] for r in rs) == ["GARG SHEKHAR", "GB TEXCOAT", "VMS EVENTS"] and all(r[1] == "connected" for r in rs) and dict((r[0], r[2]) for r in rs)["GB TEXCOAT"] == 1 and n('#app [data-tco-row="GB TEXCOAT"] [data-tco-pre]:not([data-tco-pre=""])') == 1,
           "Open in Tally now: every company open, Connected; GB TEXCOAT, a client already: the picker with it chosen (%s)" % rs)
        # the client a pointer names: the same GSTIN on top, Link to it
        E("""(c) => { S.companies[c].gstin = '09AANFG3202D1ZR'; window.__companies.push({company: 'GARG SHEKHAR', client_id: null, device_id: 'd0000000-0000-4000-8000-000000000006', gstin: '09AANFG3202D1ZR', last_seen: new Date().toISOString(), linked_at: new Date(Date.now() - 3600e3).toISOString()});
            TCloud.pane.devices = null; TCloud.pane.at = 0; TLight.st.cos = window.__companies; openConnectTally(4, c); }""", G); pg.wait_for_timeout(1800)
        top = E("() => (document.querySelector('#app [data-tco-list=firm] [data-tco-row]') || {getAttribute: () => ''}).getAttribute('data-tco-row')")
        ok(top == "GARG SHEKHAR" and n('#app [data-tco-row="GARG SHEKHAR"][data-why="gstin"]') == 1, "a pointer for garg shekhar & company: the company with its GSTIN on top (%s)" % top)
        E("() => { window.__calls = []; }"); pg.click('#app [data-tco-list=firm] [data-tco-row="VMS EVENTS"] [data-tco-act=link]'); pg.wait_for_timeout(1500)
        lk = [c for c in E("window.__calls") if c[0] == "tally_company_link"]
        ok(lk and lk[-1][1].get("p_company") == "VMS EVENTS" and lk[-1][1].get("p_client") == G and E("(c) => S.companies[c].tallyName", G) == "VMS EVENTS",
           "Link to garg shekhar & company: tally_company_link and the Tally name (%s)" % lk)
        ok([w for w in E("window.__wakes") if w.get("what") == "ledgers" and w.get("client") == G], "and its first sync starts by itself (the ledgers wake)")
        # all well: the guide is one green line, All good
        d6 = dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.4.4")
        d = d6["id"]; scene([d6], companies(linked=("GB TEXCOAT", "ABC TRADERS", "garg shekhar & company"), seen=(), d=d6["id"]), books=HELD_ALL)
        gl = card()
        ok(n("#app [data-connect-step]") == 0 and gl.startswith("NWS144 · anshul · FinCom Bridge 2.4.4 Connected"), "linked, all well: no steps; the card 'NWS144 · anshul · FinCom Bridge 2.4.4 · Connected' (%s)" % gl[:120])
        ok(n("#app [data-all-good]") == 1 and n("#app [data-needs-you]") == 0, "nothing needs him: All good, no Needs you")
        ok("Update to" not in gl and n("#app [data-tsc-need]") == 0, "all well: no update, no problem line (%s)" % gl[:120])
        pg.wait_for_timeout(1500)
        held_l = txt('#app [data-tco-row="GB TEXCOAT"] [data-tco-sync=held]')
        ok(re.match(r"Ledgers [\d,]+ \u00b7 Entries Apr\u2013\w{3} 2026$", held_l) or held_l.startswith("Ledgers"), "a linked company's row: what FinCom holds (%s)" % held_l)
        fold(True); pg.click("#app [data-guide-again]"); pg.wait_for_timeout(700)
        ok(n("#app [data-connect-step]") == 4 and n("#app [data-guide-hide]") == 1, "Help & support › Connect another computer: the four steps again, with Hide the steps")
        pg.click("#app [data-guide-hide]"); pg.wait_for_timeout(500)
        ok(n("#app [data-connect-step]") == 0 and n("#app [data-status-card]") == 1, "Hide the steps: the card alone again")
        fold(False)
        # ---- 17-Oct-2026 (the owner: "why it is asking to update add on.. pls remove that option.. include this automatically
        # in 2.4.5.. it should not ask the clients"): the add-on not recording on a computer whose bridge is older than 2.2.0:
        # no ask anywhere on the page (the guide, the computer's line, Help & support, its details) to load, update or turn
        # on the add-on, TDL or recorder; the computer's details say one neutral fact
        doff = dev(8, "NWS145", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.1.9")
        doff["info"]["bridges"]["go-8"]["recorder"] = {"GB TEXCOAT": {"seen": False, "lastAt": ""}}
        scene([doff], companies(linked=("GB TEXCOAT", "ABC TRADERS"), seen=(), d=doff["id"]))
        ok(n('#app [data-connect-step="addon"]') == 0 and n('#app [data-strip-step="addon"]') == 0 and n("#app [data-addon-off], #app [data-addon-how]") == 0,
           "no add-on step in Connect Tally, no 'Add-on not loaded' line")
        fold(True)
        tg = '#app [data-computer="%s"] [data-more-toggle]' % doff["id"]
        if n(tg): pg.click(tg); pg.wait_for_timeout(600)
        body = page()
        ok(not ADDON_ASK.search(body), "no visible ask to load, update or turn on the add-on, TDL or recorder (%s)" % [m.group(0) for m in ADDON_ASK.finditer(body)][:3])
        ok(txt('#app [data-computer="%s"] [data-recorder]' % doff["id"]) == "Add-on lines last received: none in 7 days",
           "Help & support, the computer's details: one neutral fact (%s)" % txt('#app [data-computer="%s"] [data-recorder]' % doff["id"]))
        fold(False)
        # ---- the first sync (was round 63's steps 5 and 6): on the company's row, after Add as client or Link: the ledgers
        # wake (one call), the moving bar and the time, then "Ledgers 1,240 ✓ · Entries …"; nothing in 10 minutes: Try again
        # and the masters file; the reply that nobody was asked stops it at once with the reason; days missing: the row's ⋯
        # Upload older entries (Day Book) opens Books › From Tally's upload
        five = {"garg shekhar & company": book("garg shekhar & company"), "ABC TRADERS": book("ABC TRADERS"), "GB TEXCOAT": book("GB TEXCOAT", ledgers=False, days=False)}
        d6 = dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.4.4")
        unl = companies(linked=("ABC TRADERS", "garg shekhar & company"), seen=("GB TEXCOAT",), d=d6["id"])
        ids = scene([d6], unl, books=five); T = ids["GB TEXCOAT"]
        row5 = '#app [data-tco-list=firm] [data-tco-row="GB TEXCOAT"]'
        ok(n(row5 + " select[data-tco-act=pick]") == 1 and E("(s) => document.querySelector(s + ' [data-tco-act]').getAttribute('data-tco-pre')", row5) == T, "GB TEXCOAT open, the client of that name not linked: the picker, GB TEXCOAT chosen (%s)" % txt(row5))
        def link5():
            pg.click(row5 + " [data-tco-act=pick]"); pg.wait_for_timeout(250); pg.click(row5 + " [data-tco-relink]")
        E("() => { window.__wakes = []; window.__calls = []; }")
        link5(); pg.wait_for_timeout(1500)
        wk = [w for w in E("window.__wakes") if w.get("kind") == "wake"]
        ok(wk == [{"kind": "wake", "what": "ledgers", "client": T}], "Link: the ledgers-only wake, one call (%s)" % wk)
        ok(n(row5 + " [data-tco-sync=running] .tco-bar") == 1 and txt(row5 + " [data-tco-sync-words]").startswith("Reading ledgers from Tally\u2026"), "while reading: the moving bar (26-Oct-2026: the ledgers' one bar) (%s)" % txt(row5 + " [data-tco-sync]"))
        ok(not [c for c in E("window.__calls") if c[0] in ("tally_update_now", "tally_want_update")], "not the full Update now")
        shot("row-first-sync-reading")
        E("""(t) => { window.__books[t] = [Object.assign(window.__books[t][0], {ledgersAt: new Date().toISOString(), days: 190, to: new Date().toISOString().slice(0, 10), entries: 4000})];
            window.__ledgers['bk-GB TEXCOAT'] = Array.from({length: 1240}, (_, i) => ({name: 'Ledger ' + (i + 1), parent: 'Sundry Creditors'})); }""", T)
        pg.wait_for_selector(row5 + " [data-tco-sync=done]", timeout=25000)
        ok(re.match(r"^1,240 ledgers from Tally \u2713 \u00b7 \d\d:\d\d$", txt(row5 + " [data-tco-sync=done]")) is not None,
           "the ledgers arrive: '1,240 ledgers from Tally \u2713 \u00b7 16:20', one line (26-Oct-2026) (%s)" % txt(row5 + " [data-tco-sync]"))
        shot("row-first-sync-done")
        # no progress for 3 minutes (26-Oct-2026; was 10 minutes)
        ids = scene([d6], unl, books=five); T = ids["GB TEXCOAT"]
        link5(); pg.wait_for_timeout(1000)
        E("(t) => { S.tcoSync[t].at = Date.now() - 11 * 60000; }", T); pg.wait_for_timeout(11500)
        lt = txt(row5 + " [data-tco-sync=stuck]")
        ok(lt.startswith("No progress from Tally in 3 minutes: keep GB TEXCOAT open in TallyPrime") and n(row5 + " .tco-bar") == 0 and n(row5 + " [data-tco-sync-again]") == 1 and n(row5 + " [data-tco-masters]") == 1,
           "no progress for 3 minutes: the bar stops: keep it open in TallyPrime, Try again, the masters file (%s)" % lt)
        E("() => { window.__wakes = []; }"); pg.click(row5 + " [data-tco-sync-again]"); pg.wait_for_timeout(800)
        ok(len([w for w in E("window.__wakes") if w.get("what") == "ledgers"]) == 1, "Try again: the wake once more")
        # the masters file
        E("(t) => { S.tcoSync[t].at = Date.now() - 11 * 60000; S.tcoSync[t].late = true; render(); }", T); pg.wait_for_timeout(600)
        with pg.expect_file_chooser(timeout=5000) as fc: pg.click(row5 + " [data-tco-masters]")
        ok(fc.value is not None, "Or upload the masters file: opens the file picker")
        E("() => { window.__wakes = []; }")
        fc.value.set_files(files=[{"name": "Master.xml", "mimeType": "text/xml", "buffer": MASTERS.encode("utf-8")}]); pg.wait_for_timeout(2500)
        up = [w for w in E("window.__wakes") if w.get("kind") == "upload_ledgers"]
        ok(len(up) == 1 and up[0]["complete"] is True and up[0]["count"] == 3 and up[0]["from"] == "20260401" and up[0]["openAsOn"] == "20260331"
           and [l[0] for l in up[0]["ledgers"]] == ["Cash", "Rent", "VMS EVENTS"] and all(l[2] == "0" for l in up[0]["ledgers"]),
           "the cloud: upload_ledgers declared complete with its count, the book's own dates, no opening from the file (%s)" % [(k, v) for k, v in (up[0] if up else {}).items() if k != "groups"])
        ok(txt(row5 + " [data-tco-sync]").startswith("3 ledgers from Tally \u2713"), "the row: '3 ledgers from Tally \u2713' from the file (26-Oct-2026: the ledgers' one bar) (%s)" % txt(row5 + " [data-tco-sync]"))
        # the reply that nobody was asked: stopped at once with the reason
        for ans, why, words in (({"ok": True, "woken": 0, "debounced": 0, "asked": 0}, "woken 0", "No computer with Tally was asked"),
                                (None, "not started", "FinCom Bridge did not read GB TEXCOAT\u2019s ledgers: background reading is paused in the tray")):
            ids = scene([d6], unl, books=five); T = ids["GB TEXCOAT"]
            if ans: E("(a) => { window.__wakeAns = a; }", ans)
            else: E("() => { window.__askT = window.__askT || Ledgers.askTally; Ledgers.askTally = async (cid) => ({cid, via: 'bridge', ans: {ok: true, started: false, why: 'background reading is paused in the tray (Update now still reads the ledger list)'}}); }")
            link5(); pg.wait_for_timeout(1500)
            st = txt(row5 + ' [data-tco-sync=stuck][data-tco-stuck="error"]')
            ok(st.startswith(words) and n(row5 + " .tco-bar") == 0 and n(row5 + " [data-tco-sync-again]") == 1, "the reply '%s': stopped at once with the reason, Try again (%s)" % (why, st))
            if why == "woken 0": shot("row-first-sync-nobody")
        E("() => { if (window.__askT) Ledgers.askTally = window.__askT; }")
        # days missing: the row's ⋯ Upload older entries (Day Book) opens From Tally's upload
        ids = scene([d6], companies(linked=("GB TEXCOAT", "ABC TRADERS"), seen=(), d=d6["id"]), books=dict(five, **{"GB TEXCOAT": book("GB TEXCOAT", ledgers=True, days=False)})); T = ids["GB TEXCOAT"]
        pg.wait_for_timeout(1500)
        pg.click('#app [data-tco-row="GB TEXCOAT"] [data-tco-more] summary'); pg.wait_for_timeout(300)
        ok(n('#app [data-tco-row="GB TEXCOAT"] [data-tco-daybook]') == 1, "this year's days not in FinCom: ⋯ Upload older entries (Day Book)")
        pg.click('#app [data-tco-row="GB TEXCOAT"] [data-tco-daybook]'); pg.wait_for_timeout(1800)
        ok(E("[S.view, S.coId, S.tab, S.booksTab]") == ["company", T, "books", "import"] and n("#app [data-up-drop]") == 1, "Upload older entries: Books \u2192 From Tally's upload of that client (%s)" % E("[S.view, S.coId, S.tab, S.booksTab]"))
        ids = scene([d6], companies(linked=("GB TEXCOAT", "ABC TRADERS"), seen=(), d=d6["id"]), books=HELD_ALL); pg.wait_for_timeout(1500)
        pg.click('#app [data-tco-row="GB TEXCOAT"] [data-tco-more] summary'); pg.wait_for_timeout(300)
        ok(n('#app [data-tco-row="GB TEXCOAT"] [data-tco-daybook]') == 0, "this year's days in FinCom: no Day Book under ⋯")
        if SHOTS:
            for scheme, w, h, name in (("dark", 1440, 900, "list-desktop-dark"), ("light", 390, 844, "list-phone-light")):
                pg2 = open_page(w, h, scheme); pg2.evaluate(SETUP, [[d6], unl, [], "owner", CLIENTS, True, five]); pg2.wait_for_timeout(1800)
                pg2.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True); pg2.close()
        # ---- 100 companies open and 100 clients: the guide gives the count only and stays compact; the list finds one by
        # typing; linking works
        many = ["CO %03d" % i for i in range(1, 101)]; mclients = ["CLIENT %03d" % i for i in range(1, 101)]
        dm = dev(7, "NWS144", "anshul", tally="open", opened=tuple(many), version="2.4.4")
        ids = E(SETUP, [[dm], [{"company": c, "client_id": None, "device_id": dm["id"], "gstin": "", "last_seen": "ago:1"} for c in many], [], "owner", mclients, True, {}]); pg.wait_for_timeout(2500)
        ok("Tally open: 100 companies" in txt("#app [data-status-card]"), "100 open: the card says the count only (%s)" % txt("#app [data-status-card]")[:120])
        names = E("() => (document.querySelector('#app [data-status-card]').innerText.match(/CO \\d{3}/g) || []).length")
        ok(names == 0, "100 open: no company's name on the card (%d)" % names)
        h = E("() => document.querySelector('#app [data-status-card]').getBoundingClientRect().height")
        ok(h < 300, "100 companies, 100 clients: the card stays compact (%d px high)" % h)
        pcl = E("() => [...document.querySelectorAll('#app [data-pc-line]')].map(e => e.innerText).join(' ')")
        ok("CO 050" not in pcl, "100 open: the computers' line names no company (%s)" % pcl[:160])
        c42 = ids["CLIENT 042"]
        E("(c) => openConnectTally(4, c)", c42); pg.wait_for_timeout(1200)
        ok(n("#app [data-tco-list=firm] [data-tco-q]") == 1, "100: the list has type-to-search")
        pg.fill("#app [data-tco-list=firm] [data-tco-q]", "co 057"); pg.wait_for_timeout(300)
        rr = E("() => [...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => r.getAttribute('data-tco-row'))")
        ok(rr == ["CO 057"], "100 companies: typing 'co 057' finds it (%s)" % rr)
        E("() => { window.__calls = []; }"); pg.click('#app [data-tco-row="CO 057"] [data-tco-act=link]'); pg.wait_for_timeout(1200)
        ok([c for c in E("window.__calls") if c[0] == "tally_company_link"] == [["tally_company_link", {"p_company": "CO 057", "p_client": c42}]], "100: Link links CLIENT 042 to CO 057 (%s)" % E("window.__calls"))
        shot("list-100-companies")
        # ---- a company linked to another client: its row's ⋯ Not this client moves it, by the person's own choice
        ids = scene([d6], companies(linked=("GB TEXCOAT",), seen=(), d=d6["id"]), books=HELD_ALL)
        G2 = ids["garg shekhar & company"]
        pg.click('#app [data-tco-row="GB TEXCOAT"] [data-tco-more] summary'); pg.wait_for_timeout(300)
        pg.click('#app [data-tco-row="GB TEXCOAT"] [data-tco-not-this]'); pg.wait_for_timeout(300)
        pg.select_option('#app [data-tco-row="GB TEXCOAT"] [data-tco-relink-pick]', G2)
        E("() => { window.__calls = []; }"); pg.click('#app [data-tco-row="GB TEXCOAT"] [data-tco-relink]')
        pg.wait_for_selector('#confirmBox [data-cbx="yes"]', state="visible", timeout=10000); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(1200)   # it moves: asked once
        ok([c for c in E("window.__calls") if c[0] == "tally_company_link"][:1] == [["tally_company_link", {"p_company": "GB TEXCOAT", "p_client": G2}]], "Not this client: tally_company_link moves it (%s)" % E("window.__calls"))
        # ---- the Tally port changes (9002 -> 9500, the same company open): the client stays linked
        dp = dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.4.4")
        ids = scene([dp], companies(linked=("GB TEXCOAT", "ABC TRADERS", "garg shekhar & company"), seen=(), d=dp["id"]))
        T = ids["GB TEXCOAT"]
        def linked_everywhere(label):
            E("(c) => { S.tallyGuide = {}; openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", T); pg.wait_for_timeout(1200)
            # next-tally-icon: the header's one Tally icon says the client's word
            sign = E("() => (document.querySelector('header.top [data-tally-icon]') || {getAttribute: () => ''}).getAttribute('data-tally-icon')")
            E("() => navHome('clients')"); pg.wait_for_timeout(1000)
            chip = E("(c) => { const r = [...document.querySelectorAll('#app table[data-list=\"clients\"] tr')].find(t => t.innerText.startsWith('GB TEXCOAT')); const ch = r && r.querySelector('[data-tally-chip]'); return ch ? [ch.getAttribute('data-tally-chip'), ch.getAttribute('data-tally-pill')] : ''; }", T)
            E("() => { S.tallyGuide = {}; navHome('tally'); }"); pg.wait_for_timeout(1200)
            rw = E("() => { const r = document.querySelector('#app [data-tco-row=\"GB TEXCOAT\"]'); return r ? [r.getAttribute('data-tco-state'), r.getAttribute('data-tco-linked'), r.querySelectorAll('[data-tco-act]').length] : null; }")
            t2 = E("""() => { const a = document.querySelector('#app').cloneNode(true); a.querySelectorAll('[data-advanced], details, [data-connect-guide]').forEach(e => e.remove()); return a.innerText; }""")
            ok(sign == "linked" and chip == ["connected", "connected"] and rw == ["connected", T, 0] and not re.search(r"\bport\b|9500|9002", t2, re.I),
               "%s: still linked and Connected: the top bar (%s), the Clients chip (%s), its row (%s); no re-link asked, no port words" % (label, sign, chip, rw))
        linked_everywhere("port 9002")
        E("""() => { window.__devs.forEach(d => { d.info.beat.ports = [{port: 9500, ok: true, skipped: false, n: 1, error: '', state: 'open'}]; d.info.beat.tallyPort = 9500;
            Object.values(d.info.bridges).forEach(b => { b.tallyPort = 9500; }); });
            TLight.st.devs = JSON.parse(JSON.stringify(window.__devs)); TLight.st.at = Date.now(); TCloud.pane.devices = null; TCloud.pane.at = 0; render(); }"""); pg.wait_for_timeout(1800)
        linked_everywhere("the port moved to 9500")
        # ---- Reading in each state
        def rscene(d, lines=()):
            scene([d], companies(d=d["id"]), lines)
            fold(True)   # round 66: the reading table is in Help & support
            if n('#app [data-show-all="reading"][aria-expanded="false"]'): pg.click('#app [data-show-all="reading"]'); pg.wait_for_timeout(400)
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
        ok(steps() == [["install", False], ["port", False], ["open", False], ["add", False]] and n('#app [data-firstlink] [data-fl-step="download"] [data-bridge-download]') == 1
           and "2.4.4" in txt('#app [data-firstlink] [data-fl-step="download"] [data-bridge-download]') and n("#app [data-all-good]") == 0, "nothing installed: the four steps, step 1 with the download (%s)" % steps())

        # ---- 5. every former entry point lands on the one place to link a client: its own Tally card (the companies in Tally
        # it may be, each with Link) or Companies in Tally; none links or connects on its own
        ids = scene([dev(8, "NWS144", "anshul", tally="open", opened=("VMS EVENTS",))], companies(seen=("VMS EVENTS",), d="d0000000-0000-4000-8000-000000000008"), only=False)
        G = ids["garg shekhar & company"]
        E("() => { window.__calls = []; }")
        def landed(label, step, cid=None):
            g = E("[S.view, S.homeTab, S.tallyTab, S.tallyGuide || {}]")
            good = g[0] == "home" and g[1] == "tally" and g[2] == "computers" and g[3].get("step") == step and (cid is None or g[3].get("cid") == cid) and n("#app [data-tco-list=firm]") == 1
            ok(good, "%s: lands on Companies in Tally%s (%s)" % (label, " for the client" if cid else "", g))
        # 24-Oct-2026 (next-tally-one-page): every pointer of a client not linked lands on Companies in Tally for that client
        def card(label):
            g = E("[S.view, S.homeTab, (S.tallyGuide || {}).cid]")
            ok(g == ["home", "tally", G] and n('#app [data-tco-list=firm] [data-tco-row="VMS EVENTS"] [data-tco-act=link]') == 1, "%s: lands on Companies in Tally for the client, its companies with Link (%s)" % (label, g))
        def at_client(tab="cotally"):
            E("(c) => { S.tallyGuide = {}; openCompany(c); S.tab = '%s'; render(); }" % tab, G); pg.wait_for_timeout(1200)
        LINKERS = '[data-tally-link-to], [data-tally-link-picker], select[data-card-link], select[aria-label^="Client for"], [data-act="bridgeConnect"], [data-connect-section]'
        # the client's Tally card (Client setup -> Tally): the rows with Link, nothing else to link with
        at_client(); pg.wait_for_timeout(600)
        ok(n("#app [data-tally-link]") == 0 and n("#app [data-tally-one]") == 1 and n("#app " + LINKERS.replace(", ", ", #app ")) == 0, "Client setup → Tally: one line, nothing to link with (%s)" % txt("#app [data-tally-one]")[:120])
        pg.click("#app [data-tally-one-go]"); pg.wait_for_timeout(1200); card("Client setup's Tally line")
        # next-tally-icon (27-Oct-2026): no chip on the title line; the header's one Tally icon. Its popover's "Open Tally page"
        # lands on Companies in Tally for the client
        at_client("dash")
        ok(n("#cobar [data-tally-chip]") == 0 and n("header.top [data-tally-icon]") == 1, "no Tally chip on the title line; the header's one Tally icon")
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top [data-tally-pop-page]", timeout=15000)
        pg.click("header.top [data-tally-pop-page]"); pg.wait_for_timeout(1200); card("the Tally icon's Open Tally page")
        at_client("dash")
        # next-tally-firstlink (the owner: "it should be above, on the Tally icon"): VMS EVENTS is open in Tally and no
        # client's, so the icon carries the badge; next-tally-icon: its popover links it in place ([Link], VMS EVENTS listed)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(400)
        ok(n('header.top [data-tally-pop] [data-tally-pop-pick] option[value="VMS EVENTS"]') == 1 and n("header.top [data-tally-pop-act=link]") == 1 and n("[data-tally-badge]") == 0 and not E("!!S.tallyPanel"),
           "the header's Tally icon (a company open, not linked: no badge, Task D): the client's popover offers Link, VMS EVENTS in its list, no side panel (%s)" % E("[S.view, S.homeTab, !!S.tallyPanel]"))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        # Getting ready's Link to Tally step
        at_client("dash")
        gr = '#app [data-onb-step="link"] button'
        if n(gr):
            pg.click(gr); pg.wait_for_timeout(1200)
            ok(E("[S.view, S.homeTab]") == ["home", "tally"] or E("[S.view, S.tab]") == ["company", "cotally"], "Getting ready's Link to Tally: the place to link (%s)" % E("[S.view, S.homeTab, S.tab]"))
        else:
            ok(n('#app [data-onb-step="link"]') == 0, "Getting ready: its link step is not shown here")
        # the Overview's Tally line
        at_client("dash")
        if n('#app [data-tally-link-line] [data-tally-link-choose-go]'):
            pg.click('#app [data-tally-link-line] [data-tally-link-choose-go]'); pg.wait_for_timeout(1200); card("the Overview's Tally line")
        # the Clients list chip
        E("() => { S.tallyGuide = {}; navHome('clients'); }"); pg.wait_for_timeout(1200)
        cc = '#app [data-tally-chip-at="clients"][data-tally-chip="unlinked"]'
        ok(n(cc) >= 1, "the Clients list: a chip for the client not linked")
        if n(cc): pg.click(cc + " >> nth=0"); pg.wait_for_timeout(1200); card("the Clients list chip")
        # Today's not-linked line
        E("() => { S.tallyGuide = {}; navHome('today'); }"); pg.wait_for_timeout(1200)
        tl = '#app [data-not-linked-go]'
        ok(n(tl) == 1, "Today: the not-linked chip")
        if n(tl): pg.click(tl); pg.wait_for_timeout(1200); ok(E("[S.view, S.homeTab]") == ["home", "tally"] and n("#app [data-tco-list=firm]") == 1, "Today's chip: Companies in Tally")
        # Settings -> Books in the cloud
        E("() => { S.tallyGuide = {}; doAct('goTcloud'); }"); pg.wait_for_timeout(1500)
        ok(n('#app select[aria-label^="Client for"]') == 0 and n('#app [data-open-connect="4"]') >= 1, "Books in the cloud: no Link here, a pointer to Companies in Tally")
        if n('#app [data-open-connect="4"]'): pg.click('#app [data-open-connect="4"] >> nth=0'); pg.wait_for_timeout(900); landed("Books in the cloud", 4)
        # the top bar's panel: Open Connect Tally (was Connect this computer: the browser's own bridge)
        E("() => { S.tallyGuide = {}; doAct('tallyConnect'); }"); pg.wait_for_timeout(900); landed("the top bar's panel", 0)
        ok(n("#app [data-connect-section]") == 0, "this browser's own bridge connect stays in the closed Advanced fold")
        # the per-computer "Seen, not linked" (Advanced -> each computer)
        fold(True)
        sn = '#app [data-advanced] [data-card-seen]'
        ok(n(sn) == 0 and n("#app [data-advanced] select[aria-label^='Client for']") == 0, "Help & support: no 'Seen, not linked', no Link… box (the list is the one place)")
        fold(False)
        ok(not [c for c in E("window.__calls") if c[0] in ("tally_company_link",)], "none of the entry points linked anything on its own (%s)" % E("window.__calls"))
        # Add client with its Tally company picked (23-Oct-2026, next-fix-tally-link: Pick from Tally): the person's own
        # choice, so it is linked at once, and the new client's Tally card opens (it was: the guide's step 4, Link there)
        E("""() => { S.tallyGuide = {}; window.__calls = []; const f = {name: 'NEW CLIENT', gstin: '', tallyCompany: 'VMS EVENTS', postOnly: false};
            return saveNewCompany(f); }""")
        pg.wait_for_timeout(1500)
        if E("Object.values(S.companies).some(c => c.name === 'NEW CLIENT')"):
            nc = E("Object.values(S.companies).find(c => c.name === 'NEW CLIENT').id")
            ok(E("[S.view, S.tab, S.coId]") == ["company", "cotally", nc] and [c for c in E("window.__calls") if c[0] == "tally_company_link"] == [["tally_company_link", {"p_company": "VMS EVENTS", "p_client": nc}]],
               "Add client with a Tally company picked: linked to it at once, its Tally card opens (%s %s)" % (E("[S.view, S.tab]"), E("window.__calls")))
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
