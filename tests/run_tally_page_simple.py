"""python3 run_tally_page_simple.py - the simpler Tally page (FinCom 2.3.5; the owner: "tally option is so confusing that i am
also not able to connect properly").
  - one card per computer and Windows user, each with ONE plain status line: "Connected · Tally open: GARG SHEKHAR (port
    9005) · last entry 2 min ago"; when something is wrong the line names the problem and the ONE thing that fixes it
    (an owner's button when there is one: Resume reading, Make this the main bridge, Download FinCom Bridge);
  - a 3-step guide at the top until the first Tally company is linked to a client: Install bridge -> Connect -> Link
    company, each ticked when done (a computer key exists; a bridge's heartbeat was seen; a company linked);
  - everything else under More (per card: requests, stop reading, changes source, trial tools, PostOnly and posting
    settings, members; for the page: versions, stop on all computers, every bridge heard from, this browser's connection
    with its steps (numbered once), the connection history, the install help);
  - staff see no owner button, More open or not; times in IST, never a bare 14:05.
Options: --shots DIR  saves the page's screenshots (owner, More closed and open; the guide; staff) into DIR.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_page_simple.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the firm's computers as tally_devices keeps them (made-up): times are "ago:<minutes>"
def dev(n, comp, user, at="ago:0.5", tally="open", opened=("GARG SHEKHAR",), port=9005, rec_at="ago:2", beat=None, version="2.3.4"):
    i = "d0000000-0000-4000-8000-00000000000%d" % n
    b = {"at": at, "version": version, "computer": comp, "user": user, "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally,
         "open": list(opened), "tallyPort": port, "dataFolder": "C:\\Users\\Public\\TallyPrime\\Data",
         "reqs": {"day": "TODAY", "last": {"kind": "vouchers", "ms": 1234, "at": "ago:2"}, "longest": {"kind": "ledgers", "ms": 8400, "at": "ago:120"}, "over20": 0, "n": 41},
         "postOnly": ["GARG SHEKHAR"], "recorder": {co: {"seen": True, "lastAt": rec_at} for co in opened}}
    bt = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False}
    bt.update(beat or {}); b.update({k: v for k, v in (beat or {}).items() if k in ("readStopped", "paused")})
    info = {"computer": comp, "user": user, "beat": bt, "bridges": {"go-%d" % n: b}}
    return {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": version, "main_bridge": "go-%d" % n, "info": info, "created_at": "2026-09-01T00:00:00Z",
            "post_only": ["GARG SHEKHAR"], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}
OK_DEV = dev(1, "NWS144", "anshul")
DEVS = [OK_DEV,
    dev(2, "LAPTOP", "ravi", at="ago:180"),
    dev(3, "FRONTDESK", "tally", tally="closed", opened=()),
    dev(4, "TALLYSRV", "meena", beat={"readStopped": {"by": "fincom", "reason": "Tally hangs on the bank ledger", "at": "ago:40"}})]
D1, D2, D3, D4 = [d["id"] for d in DEVS]
STOPS = [{"id": 7, "device_id": D4, "action": "stop", "reason": "Tally hangs on the bank ledger", "stopped_at": "ago:40", "cleared_at": None}]
LINKED = [{"company": "GARG SHEKHAR", "client_id": "c-1", "device_id": D1, "gstin": "", "last_seen": "ago:1"}]
UNLINKED = [{"company": "GARG SHEKHAR", "client_id": None, "device_id": D1, "gstin": "", "last_seen": "ago:1"}]
SETUP = """([devs, stops, companies, role]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  window.__devs = fix(devs); window.__stops = fix(stops); window.__companies = fix(companies); window.__calls = [];
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_read_stops/.test(path)) return copy(window.__stops);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    if (/^tally_recorder_lines/.test(path)) return copy(window.__lines || []);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {}; navHome("tally");
}"""
# Sync activity's flow (the owner: "in tally sync there is a yellow field coming all the time"): lines Tally sent, as
# tally_recorder_lines keeps them. ENDED: the bridge gave up, a person must upload that day's Day Book; FRESH: still
# being fetched (received a few minutes ago); NEW: under 2 minutes, nothing to say yet
ENDED_WHY = "Tally did not give this entry when asked again; upload that day's Day Book to settle it"
def rline(i, company, day, state="held", why=ENDED_WHY, rec="ago:600", d=D1):
    return {"id": i, "client_id": "CID", "book_id": "b1", "device_id": d, "pc": "NWS144", "company": company, "line_id": "L%d" % i, "event": "created", "object_guid": "g-%d" % i,
            "alter_id": 900 + i, "vch_type": "Sales", "vch_no": str(i), "vch_date": day, "saved_at": rec, "received_at": rec, "applied_at": None, "state": state, "held_why": why, "ledgers": []}
ENDED = [rline(1, "GARG SHEKHAR", "2026-10-07"), rline(2, "GARG SHEKHAR", "2026-10-07"), rline(3, "GARG SHEKHAR", "2026-10-07"),
         rline(4, "GARG SHEKHAR", "2026-10-06", why="deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it"),
         rline(5, "ABC LTD", "2026-10-07", why="the entry is larger than FinCom takes in one line; upload that day's Day Book to settle it")]
FRESH = [rline(11, "GARG SHEKHAR", "2026-10-08", state="received", why=None, rec="ago:5")]
NEW = [rline(21, "GARG SHEKHAR", "2026-10-08", state="received", why=None, rec="ago:0.5")]
SYNC = """(lines) => { let c = Object.values(S.companies).find(x => x.name === "ZZ Test Client");
  if (!c){ c = newCompany({name: "ZZ Test Client", gstin: ""}); c.tallyName = "GARG SHEKHAR"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  window.__lines = JSON.parse(JSON.stringify(lines), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v).map(l => Object.assign(l, {client_id: c.id}));
  Rec.act = {}; S.syncClient = ""; S.syncFilter = "all"; S.view = "home"; S.tallyTab = "activity"; navHome("tally"); return c.id; }"""
# review of f0f1531f: every reason the bridge (bridge-go) and the cloud (server/tally-cloud, migration 60 and before) can
# give a waiting line -> what will actually happen. "" = being fetched (settles by itself); any other kind = Needs you,
# with its one action. Sync activity and the bell (AlertHub.oursHeld) use the one classifier (Rec.needKind)
KINDS = [
    # the cloud (tally_recorder_ingest, migration 60)
    ("held", "waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book", ""),
    ("held", "no entry body on the line: waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book", ""),
    ("held", "FinCom posting 77 matched; no entry body (its posted XML could not be read): waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book", ""),
    ("held", "FinCom posting 77 matched; changed in Tally after posting: the next full line or Day Book upload applies it", ""),
    ("held", "FinCom id 4521 matches no posting of this firm", ""),
    ("held", "FinCom id 4521 is matched to another Tally entry (GUID abcd-1) already: held, never a second entry", "dupid"),
    ("held", "no entry GUID on the line (only the add-on's placeholder): FinCom cannot tell which entry was deleted, so this line is never applied by itself; uploading the Day Book for 07-Oct-2026 brings that day up to date", "daybook"),
    ("held", "no entry GUID on the line (only the add-on's placeholder): FinCom cannot tell which entry was cancelled, so this line is never applied by itself; no date on the line either: it stays held, and nothing in FinCom's books changes for it", "daybook"),
    ("held", "no entry GUID on the line: FinCom cannot tell which entry was deleted, so this line is never applied by itself; uploading the Day Book for 07-Oct-2026 brings that day up to date", "daybook"),
    ("held", "no GUID on the line: held, never a new row", "masters"),
    ("held", "the add-on named entry Sales 5 of 07-Oct-2026, but GUID g-1 is Sales 9 of 06-Oct-2026 in the copy; held until FinCom Bridge sends this entry as Tally gives it", ""),
    ("held", "the add-on's ids did not belong together (GUID g-2 is another entry's); held until FinCom Bridge 2.2.2 sends the entry as Tally gives it", ""),
    ("held", "the Day Book for 07-Oct-2026 stored after this change was not complete (40 of 42 entries); the entry is not in FinCom's copy, and this line is applied by itself once a complete Day Book for that day is uploaded", "daybook"),
    ("held", "the entry is not in FinCom's copy yet; it is applied by itself once a complete Day Book for 07-Oct-2026 is uploaded", "daybook"),
    ("held", "month locked: 2026-04", "locked"),
    ("held", "a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it", ""),
    ("held", "a ledger change without its AlterID: the next ledger list applies it", ""),
    ("held", "a ledger named ABC is in the copy already: a merge is left to the next ledger list", ""),
    ("held", "ledger lines applied by the next ledger list", ""),
    ("held", "unknown ledger: not in the copy, so nothing to mark deleted; the next ledger list from FinCom Bridge brings the ledgers up to date", ""),
    ("held", "unknown ledger: not in the copy", ""),
    ("held", "unknown entry: not in the copy (the next day read decides)", ""),
    ("held", "rename not made: duplicate key", "other"),
    ("held", "not renamed", "other"),
    # FinCom Bridge (its heldWhy, carried as held_why)
    ("held", "waiting: Tally busy; FinCom asks again at 14:05", ""),
    ("held", "waiting: Tally took longer than 2 s; FinCom asks again at 14:05", ""),
    ("held", "waiting: Tally busy (reading the entries saved before it); FinCom asks again at 14:05", ""),
    ("held", "waiting: FinCom is posting to Tally; FinCom asks again at 14:05", ""),
    ("held", "waiting: Tally has not shown this new entry yet; FinCom asks again at 14:05", ""),
    ("held", "this computer's Tally could not be asked whether it was deleted here (waiting: Tally busy; FinCom asks again at 14:05); not sent as a deletion: held", ""),
    ("held", "this computer's Tally could not be asked whether it was cancelled here (the line has no MasterID or no date); not sent as a cancellation: held", "daybook"),
    ("held", "Tally did not give this entry after 20 tries; upload that day's Day Book to settle it", "daybook"),
    ("held", "Tally did not give this entry when asked again; upload that day's Day Book to settle it", "daybook"),
    ("held", "Tally did not answer in time for this entry when asked again; upload that day's Day Book to settle it", "daybook"),
    ("held", "the entry is larger than FinCom takes in one line; upload that day's Day Book to settle it", "daybook"),
    ("held", "deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it", "daybook"),
    ("held", "the line has no date, so Tally cannot be asked for its entry", "daybook"),
    ("held", "the line has no MasterID, so Tally cannot be asked for its entry", "daybook"),
    ("held", "the entry was not read from Tally: Tally busy", ""),
    ("held", "the entry was not read from Tally: reading from Tally is stopped on this computer (Tally hangs on the bank ledger)", "readstop"),
    ("held", "waiting: reading from Tally is stopped from FinCom (bank ledger); FinCom asks again at 14:05", "readstop"),
    ("held", "the company's starting point is not recorded yet, so its entries are not taken from Tally", "baseline"),
    ("held", "this computer's Tally could not be asked whether it was deleted here (no starting point recorded for this company); not sent as a deletion: held", "baseline"),
    ("held", "the ledger was not read from Tally in time; FinCom takes it from the next ledger list", ""),
    # FinCom 2.4.1 (the owner, 09-Oct-2026): 'baseline' only for "starting point not recorded"; another data location of the
    # company: an owner chooses on the Tally page (migration 71; run_data_sources_ui.py)
    ("held", "Tally's voucher with that MasterID is not a change after the starting point", "other"),
    ("held", "saved in another data location of GARG SHEKHAR (\u2461, PC-2); FinCom reads \u2460. Choose on the Tally page.", "othersrc"),
    ("held", "not found by its type and number (asked 3 times)", "other"),
    ("held", None, "other"),
    ("received", None, ""), ("queued", None, ""),
]
OWNER_HOOKS = ["data-read-stop", "data-read-resume", "data-read-stop-all", "data-read-resume-all", "data-release-hold", "data-release-unhold", "data-release-rollback",
    "data-release-rollback-clear", "data-release-withdraw", "data-trial-tools-switch", "data-recorder-source-pick", "data-ps-edit", "data-changes-only-switch",
    "data-make-main", "data-release-identity", "data-member-link-pick", "data-baseline-clear"]
def main():
    srv = http.server.ThreadingHTTPServer(("localhost", 8391), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
            body=json.dumps({"setup": {"version": "2.3.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.3.4.exe", "sha256": "ab" * 32}})))
        pg.goto("http://localhost:8391/"); pg.wait_for_timeout(2500)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        card = lambda d: '#app [data-computer="%s"]' % d
        line = lambda d: txt(card(d) + " [data-status-line]")
        def scene(devs, companies, role="owner", stops=STOPS):
            E(SETUP, [devs, stops, companies, role]); pg.wait_for_timeout(1800)
        def shot(name):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
        def open_all():
            E("() => document.querySelectorAll('#app [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"); pg.wait_for_timeout(500)

        # ---- 1. the guide: nothing yet -> Install bridge is the step to do, with its download; nothing ticked
        scene([], [])
        g = "#app [data-tally-guide]"
        ok(pg.locator(g).count() == 1 and pg.locator(g + " [data-guide-step]").count() == 3, "guide: three steps while no company is linked")
        steps = E("() => [...document.querySelectorAll('#app [data-tally-guide] [data-guide-step]')].map(e => [e.getAttribute('data-guide-step'), e.hasAttribute('data-done'), e.innerText.trim()])")
        ok([s[0] for s in steps] == ["install", "connect", "link"], "guide: Install bridge -> Connect -> Link company (%s)" % [s[0] for s in steps])
        ok(not any(s[1] for s in steps), "guide: nothing ticked yet")
        ok(pg.locator(g + ' [data-guide-step="install"] [data-bridge-download]').count() == 1 and "2.3.4" in txt(g + ' [data-guide-step="install"] [data-bridge-download]'), "guide: step 1 has the download (%s)" % txt(g + ' [data-guide-step="install"]')[:120])
        ok(pg.locator(g + ' [data-guide-step="connect"] [data-guide-connect-slot]').count() == 1, "guide: step 2 has the mount point for the new connect flow")
        ok(pg.locator("#app [data-bridge-card]").count() == 0 and pg.locator("#app [data-install-help]").count() == 0, "install help (fingerprint, PowerShell, SmartScreen) is under More, not on the page")
        shot("guide-empty")
        # step 2 points to today's connect section: it opens the page's More with this browser's connection
        pg.click(g + ' [data-guide-step="connect"] [data-guide-connect]'); pg.wait_for_timeout(600)
        ok(pg.locator("#app [data-connect-section]").count() == 1 and pg.locator("#app [data-connect-section]").is_visible(), "guide: Connect opens today's connect section")
        # the numbering of "Connect this browser to FinCom Bridge" is written once (was "1. 1.")
        lis = E("() => [...document.querySelectorAll('#app ol.setup > li')].map(li => li.innerText.trim())")
        ok(len(lis) == 3 and not [x for x in lis if re.match(r"^\d+\.", x)], "connect steps: no doubled numbering (%s)" % [x[:30] for x in lis])
        shot("guide-connect-open")

        # ---- 2. a bridge heard from, no company linked: Install and Connect ticked, Link company to do
        scene([OK_DEV], UNLINKED)
        steps = E("() => [...document.querySelectorAll('#app [data-tally-guide] [data-guide-step]')].map(e => [e.getAttribute('data-guide-step'), e.hasAttribute('data-done')])")
        ok(steps == [["install", True], ["connect", True], ["link", False]], "guide: Install and Connect ticked, Link company not (%s)" % steps)
        ok(pg.locator('#app [data-tally-guide] [data-guide-step="link"] [data-guide-link]').count() == 1, "guide: Link company has its one button")
        shot("guide-link")
        # a company linked: the guide goes
        scene([OK_DEV], LINKED)
        ok(pg.locator("#app [data-tally-guide]").count() == 0, "guide: gone once a company is linked")

        # ---- 3. one card per computer + Windows user, ONE status line each
        scene(DEVS, LINKED)
        ok(pg.locator("#app [data-computer]").count() == 4, "one card per computer and Windows user (%d)" % pg.locator("#app [data-computer]").count())
        ok(all(pg.locator(card(d) + " [data-status-line]").count() == 1 for d in (D1, D2, D3, D4)), "each card: exactly one status line")
        ok(all("\n" not in line(d) for d in (D1, D2, D3, D4)), "each status line is one line of words (%s)" % [line(d) for d in (D1, D2, D3, D4)])
        l1 = line(D1)
        ok(re.match(r"^Connected · Tally open: GARG SHEKHAR \(port 9005\) · last entry 2 min ago$", l1) is not None, "all well: %r" % l1)
        ok(pg.get_attribute(card(D1) + " [data-status-line]", "data-level") == "ok" and pg.locator(card(D1) + " [data-status-line] button").count() == 0, "all well: green, nothing to press")
        ok("NWS144" in txt(card(D1)) and "anshul" in txt(card(D1)), "the card names the computer and the Windows user")
        # problems: the problem and the one thing that fixes it
        l2, l3, l4 = line(D2), line(D3), line(D4)
        ok(l2.startswith("Offline since ") and " IST" in l2 and "LAPTOP" in l2 and "sign in to Windows as ravi" in l2 and pg.get_attribute(card(D2) + " [data-status-line]", "data-level") == "bad", "offline: the problem and the fix (%s)" % l2)
        ok(l3.startswith("Connected · Tally not open") and "Open TallyPrime and the company on FRONTDESK" in l3 and pg.get_attribute(card(D3) + " [data-status-line]", "data-level") == "warn", "Tally not open: the fix (%s)" % l3)
        ok("Reading stopped from FinCom: Tally hangs on the bank ledger" in l4 and pg.locator(card(D4) + " [data-status-line] button").count() == 1 and txt(card(D4) + " [data-status-line] button") == "Resume reading",
           "stopped from FinCom: the owner's one action, Resume reading (%s)" % l4)
        ok(all(pg.locator(card(d) + " [data-status-line] button").count() <= 1 for d in (D1, D2, D3, D4)), "never more than one action on a line")
        ok(not re.search(r"(?<![\d-])\d{2}:\d{2}(?! IST)", pg.inner_text("#app [data-computers]")), "no bare 14:05: every time in IST")
        shot("owner-cards")
        # ---- 4. More hides the rest, and shows it
        hidden = ["Posting settings", "Trial tools on this computer", "Changes come from", "Last request", "Posts only to", "Stop reading on this computer"]
        page = pg.inner_text("#app")
        ok(not [w for w in hidden if w in page], "More closed: none of the rest on the page (%s)" % [w for w in hidden if w in page])
        ok(pg.locator("#app [data-release], #app [data-read-stop-all], #app [data-bridges], #app [data-pane=\"tally-history\"], #app [data-bridge-card]").count() == 0,
           "page More closed: versions, stop on all, every bridge, connection history and the install help hidden")
        pg.click(card(D1) + " [data-more-toggle]"); pg.wait_for_timeout(400)
        c1 = txt(card(D1))
        ok(all(w in c1 for w in hidden), "card More open: the rest is there (%s)" % [w for w in hidden if w not in c1])
        ok(pg.locator(card(D1) + " [data-ps-edit]").count() == 1 and pg.locator(card(D1) + " [data-trial-tools-switch]").count() == 1 and pg.locator(card(D1) + " [data-recorder-source-pick]").count() == 1
           and pg.locator(card(D1) + " [data-read-stop]").count() == 1, "card More: the owner's buttons work as before (Edit, trial tools, changes source, stop reading)")
        ok("Posting settings" not in txt(card(D2)), "the other cards stay closed")
        pg.click(card(D1) + " [data-more-toggle]"); pg.wait_for_timeout(400)
        ok("Posting settings" not in txt(card(D1)), "card More: closes again")
        pg.click("#app [data-page-more] > [data-more-toggle]"); pg.wait_for_timeout(600)
        ok(pg.locator("#app [data-read-stop-all]").count() == 1 and pg.locator("#app [data-bridges]").count() == 1 and pg.locator("#app [data-pane=\"tally-history\"]").count() == 1
           and pg.locator("#app [data-bridge-card]").count() == 1 and pg.locator("#app [data-install-help]").count() == 1, "page More open: stop on all computers, every bridge, connection history, the install help")
        shot("owner-more-open")
        pg.click("#app [data-page-more] > [data-more-toggle]"); pg.wait_for_timeout(400)
        ok(pg.locator("#app [data-bridges]").count() == 0, "page More: closes again")
        # the owner's buttons still call what they called
        pg.click(card(D4) + " [data-status-line] [data-read-resume]"); pg.wait_for_timeout(500)
        ok([c for c in E("window.__calls") if c[0] == "tally_read_resume"], "Resume reading calls tally_read_resume (%s)" % E("window.__calls"))
        # the old bridge on a computer: the problem and its one action, the download
        old = dev(5, "OLDPC", "tally"); old["info"]["bridges"] = {}; old["main_bridge"] = None
        scene([OK_DEV, old], LINKED)
        l5 = E("() => { const e = [...document.querySelectorAll('#app [data-computer]')].find(x => x.innerText.includes('OLDPC')); const s = e && e.querySelector('[data-status-line]'); return s ? s.innerText.trim() : ''; }")
        ok(l5.startswith("Needs FinCom Bridge") and E("() => { const e = [...document.querySelectorAll('#app [data-computer]')].find(x => x.innerText.includes('OLDPC')); return e ? e.querySelectorAll('[data-status-line] [data-bridge-download]').length : -1; }") == 1,
           "an older bridge: Needs FinCom Bridge, with the download (%s)" % l5)

        # ---- 5. staff: the same lines, no owner button anywhere, More open or not
        scene(DEVS, LINKED, role="member")
        ok(line(D1) == l1 and "Reading stopped from FinCom" in line(D4) and pg.locator(card(D4) + " [data-status-line] button").count() == 0 and "owner" in line(D4), "staff: the same lines; the stop names who can resume it (%s)" % line(D4))
        open_all()
        ok(pg.locator("#app [data-page-more] [data-bridges]").count() == 1 and "Posting settings" in txt(card(D1)), "staff: More opens too")
        found = [h for h in OWNER_HOOKS if pg.locator("#app [%s]" % h).count()]
        ok(not found, "staff: no owner button (%s)" % found)
        shot("staff-more-open")
        # ---- 5b. the one classifier: every reason -> kind; the bell agrees (AlertHub.oursHeld == being fetched)
        got = E("(rows) => rows.map(([st, why]) => { const l = {state: st, held_why: why, object_guid: 'g-1', event: 'created'}; return [Rec.needKind(l), AlertHub.oursHeld(l)]; })", [[k[0], k[1]] for k in KINDS])
        bad = [(k[1], k[2], g[0]) for k, g in zip(KINDS, got) if g[0] != k[2]]
        ok(not bad, "every held reason -> the right kind (%d rows; wrong: %s)" % (len(KINDS), bad))
        dis = [k[1] for k, g in zip(KINDS, got) if g[1] != (g[0] == "")]
        ok(not dis, "the bell and the page never disagree (%s)" % dis)
        # each Needs-you kind on the page: one sentence, ONE action, the right one
        mk = lambda i, why, day="2026-10-07": rline(i, "GARG SHEKHAR", day, why=why)
        scene(DEVS, LINKED)
        E(SYNC, [mk(31, "FinCom id 4521 is matched to another Tally entry (GUID abcd-1) already: held, never a second entry"),
                 mk(32, "the entry was not read from Tally: reading from Tally is stopped on this computer (Tally hangs on the bank ledger)", "2026-10-06"),
                 mk(33, "month locked: 2026-04", "2026-04-12"), mk(34, "no GUID on the line: held, never a new row", "2026-10-05"),
                 mk(35, "the company's starting point is not recorded yet, so its entries are not taken from Tally", "2026-10-04"),
                 mk(36, "waiting: Tally busy; FinCom asks again at 14:05", "2026-10-03")]); pg.wait_for_timeout(1800)
        G = lambda k: '#app [data-sync-needs] [data-needs-group^="%s|"]' % k
        acts = E("() => [...document.querySelectorAll('#app [data-sync-needs] [data-needs-group]')].map(g => [g.getAttribute('data-needs-group').split('|')[0], [...g.querySelectorAll('button:not([data-alert-clear])')].map(b => b.getAttribute('data-needs-act') + ':' + b.innerText.trim()), g.querySelectorAll('[data-alert-clear]').length])")
        ok(sorted(a[0] for a in acts) == ["baseline", "dupid", "locked", "masters", "readstop"] and all(len(a[1]) == 1 for a in acts), "each kind its group, ONE action each (%s)" % acts)
        ok(all(a[2] == 1 for a in acts), "each group: its Clear besides its ONE action (next-alerts-clear, 08-Oct-2026: hides the notification only) (%s)" % [a[2] for a in acts])
        A = {a[0]: a[1] for a in acts}
        ok(A.get("dupid") == ["daybook:Upload the Day Book for 07-Oct-2026"] and "double posting" in txt(G("dupid") + " [data-needs-text]"), "FinCom id on two entries: check Tally for a double posting, then the Day Book (%s)" % txt(G("dupid")))
        ok(A.get("readstop") == ["resume:Resume reading"] and "stopped" in txt(G("readstop") + " [data-needs-text]"), "reading stopped: the owner's Resume reading, not Apply now (%s)" % A.get("readstop"))
        ok(A.get("locked") == ["tieout:Open Tie-out"], "a locked month: Open Tie-out (unlock it there) (%s)" % A.get("locked"))
        ok(A.get("masters") == ["masters:Open From Tally"], "a ledger line with no GUID: read the ledgers from Tally (%s)" % A.get("masters"))
        ok(A.get("baseline") == ["tally:Open the Tally page"], "no starting point: the Tally page (%s)" % A.get("baseline"))
        ok(E("() => [...document.querySelectorAll('#app [data-sync-fetching-line]')].map(e => e.getAttribute('data-sync-fetching-line'))") == ["36"], "waiting: Tally busy: being fetched")
        E("() => { window.__calls = []; }"); pg.click(G("readstop") + " button:not([data-alert-clear])"); pg.wait_for_timeout(500)
        ok([c for c in E("window.__calls") if c[0] == "tally_read_resume" and c[1].get("p_device") == D1], "Resume reading asks tally_read_resume for that computer (%s)" % E("window.__calls"))
        scene(DEVS, LINKED, role="member")
        E(SYNC, [mk(32, "the entry was not read from Tally: reading from Tally is stopped on this computer (x)")]); pg.wait_for_timeout(1800)
        ok(pg.locator(G("readstop") + " button:not([data-alert-clear])").count() == 0 and "owner" in txt(G("readstop")), "staff: no Resume (only its Clear), the words say an owner resumes it (%s)" % txt(G("readstop")))
        # ---- 5c. a reads-only bridge says Tally's state too; the guide leaves a way to connect another computer
        ro = dev(6, "RO-PC", "tally", tally="closed", opened=()); ro["main_bridge"] = "go-other"
        scene([ro], LINKED)
        l6 = line(ro["id"])
        ok("reads only" in l6 and "Tally not open" in l6, "a reads-only bridge: Tally not open said too (%s)" % l6)
        scene([OK_DEV], LINKED)
        ok(pg.locator("#app [data-tally-guide]").count() == 0 and pg.locator("#app [data-guide-again]").count() == 1, "linked: the guide folds to 'Connect another computer'")
        pg.click("#app [data-guide-again]"); pg.wait_for_timeout(500)
        ok(pg.locator("#app [data-tally-guide]").count() == 1 and pg.locator('#app [data-tally-guide] [data-guide-step="install"] [data-bridge-download]').count() == 1, "Connect another computer: the steps again, with the download")
        # ---- 6. Sync activity: one clear flow. Only ended lines -> "Needs you", one group per company and day, each with
        # the Day Book upload; no "waiting" box
        scene(DEVS, LINKED)
        cid = E(SYNC, ENDED); pg.wait_for_timeout(1800)
        ok(pg.locator("#app [data-sync-waiting]").count() == 0, "ended lines: no 'waiting over 2 minutes' box")
        nd = "#app [data-sync-needs]"
        ok(pg.locator(nd).count() == 1 and "warn" in (pg.get_attribute(nd, "class") or ""), "ended lines: one 'Needs you' box, yellow")
        groups = E("() => [...document.querySelectorAll('#app [data-sync-needs] [data-needs-group]')].map(g => [g.getAttribute('data-needs-group'), g.querySelector('[data-needs-text]').innerText.trim(), g.querySelectorAll('button:not([data-alert-clear])').length, g.querySelectorAll('[data-alert-clear]').length])")
        want = {"GARG SHEKHAR · 07-Oct-2026: 3 entries could not be read from Tally — upload the Day Book for 07-Oct-2026",
                "GARG SHEKHAR · 06-Oct-2026: 1 entry could not be read from Tally — upload the Day Book for 06-Oct-2026",
                "ABC LTD · 07-Oct-2026: 1 entry could not be read from Tally — upload the Day Book for 07-Oct-2026"}
        ok(len(groups) == 3 and {g[1] for g in groups} == want, "one plain sentence per company and day (%s)" % [g[1] for g in groups])
        ok(all(g[2] == 1 and g[3] == 1 for g in groups) and pg.locator(nd + " [data-needs-daybook]").count() == 3, "each group: ONE action, the Day Book upload (besides its Clear, 08-Oct-2026: hides the notification only)")
        ok(txt(nd + " [data-needs-daybook]") == "Upload the Day Book for 07-Oct-2026" or "Upload the Day Book for" in txt(nd + " [data-needs-daybook]"), "the action says which day (%s)" % txt(nd + " [data-needs-daybook]"))
        ok(pg.locator("#app [data-sync-fetching]").count() == 0, "ended lines: nothing 'being fetched'")
        shot("sync-needs-you")
        pg.click(nd + ' [data-needs-group^="daybook|GARG SHEKHAR|2026-10-06"] [data-needs-daybook]'); pg.wait_for_timeout(1500)
        ok(E("[S.view, S.coId, S.dbFrom, S.dbTo]") == ["company", cid, "2026-10-06", "2026-10-06"], "the action opens the client's Day Book upload for that day (%s)" % E("[S.view, S.coId, S.dbFrom, S.dbTo]"))
        # a fresh line (still being fetched): quiet, no yellow, no 'Needs you'
        E(SYNC, FRESH); pg.wait_for_timeout(1800)
        fe = "#app [data-sync-fetching]"
        ok(pg.locator(fe).count() == 1 and "warn" not in (pg.get_attribute(fe, "class") or "") and "being fetched" in txt(fe), "a fresh line: a quiet 'being fetched' (%s)" % txt(fe))
        ok(pg.locator("#app [data-sync-needs], #app [data-sync-waiting], #app [data-sync-activity] .bk-alert.warn").count() == 0, "a fresh line: no yellow box")
        # a line of a minute ago, or none: no box at all
        E(SYNC, NEW); pg.wait_for_timeout(1800)
        ok(pg.locator("#app [data-sync-needs], #app [data-sync-fetching], #app [data-sync-waiting]").count() == 0, "a line under 2 minutes: nothing said")
        E(SYNC, []); pg.wait_for_timeout(1800)
        ok(pg.locator("#app [data-sync-needs], #app [data-sync-fetching], #app [data-sync-waiting]").count() == 0, "nothing waiting: no box")
        # ---- 7. saves FinCom could not store (bridge 2.4.0, next-outbox; the coordinator, 08-Oct-2026: "nothing lost", shown):
        # the bridge keeps a line FinCom keeps answering 'failed' and sends it every 30 minutes; the beat says how many, since
        # when and the oldest's day (tally_devices.info.beat.recorderStuck). Needs you, through the one classifier (daybook)
        sd = dev(1, "NWS144", "anshul", beat={"recorderStuck": [{"company": "GARG SHEKHAR", "n": 2, "since": "2026-10-08T09:15:00", "day": "2026-10-07"}]})
        scene([sd], LINKED)
        cid = E(SYNC, []); pg.wait_for_timeout(1800)
        sg = E("() => [...document.querySelectorAll('#app [data-sync-needs] [data-needs-group]')].map(g => [g.getAttribute('data-needs-group'), g.querySelector('[data-needs-text]').innerText.trim(), [...g.querySelectorAll('button')].map(b => b.getAttribute('data-needs-act'))])")
        want = "GARG SHEKHAR · 07-Oct-2026: 2 saves from NWS144 could not be stored in FinCom since 09:15; FinCom keeps trying \u2014 if it continues, upload the Day Book for 07-Oct-2026"
        ok(len(sg) == 1 and sg[0][1] == want and sg[0][2] == ["daybook"], "saves FinCom could not store: Needs you, one sentence, the Day Book upload (%s)" % sg)
        ok(E("() => Rec.needKind(Rec.stuckRow({n: 2}))") == "daybook" and not E("() => AlertHub.oursHeld(Rec.stuckRow({n: 2}))"), "the one classifier: daybook (Needs you), the bell agrees")
        pg.click('#app [data-sync-needs] [data-needs-daybook]'); pg.wait_for_timeout(1500)
        ok(E("[S.view, S.coId, S.dbFrom, S.dbTo]") == ["company", cid, "2026-10-07", "2026-10-07"], "the action opens the client's Day Book upload for that day (%s)" % E("[S.view, S.coId, S.dbFrom, S.dbTo]"))
        scene([dev(1, "NWS144", "anshul", beat={"recorderStuck": []})], LINKED)
        E(SYNC, []); pg.wait_for_timeout(1800)
        ok(pg.locator("#app [data-sync-needs]").count() == 0, "none left: nothing said")
        ok(not errors, "no page errors " + str(errors[:2]))
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
