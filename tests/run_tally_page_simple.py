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
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {}; navHome("tally");
}"""
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
        ok("Stopped from FinCom: Tally hangs on the bank ledger" in l4 and pg.locator(card(D4) + " [data-status-line] button").count() == 1 and txt(card(D4) + " [data-status-line] button") == "Resume reading",
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
        ok(line(D1) == l1 and "Stopped from FinCom" in line(D4) and pg.locator(card(D4) + " [data-status-line] button").count() == 0 and "owner" in line(D4), "staff: the same lines; the stop names who can resume it (%s)" % line(D4))
        open_all()
        ok(pg.locator("#app [data-page-more] [data-bridges]").count() == 1 and "Posting settings" in txt(card(D1)), "staff: More opens too")
        found = [h for h in OWNER_HOOKS if pg.locator("#app [%s]" % h).count()]
        ok(not found, "staff: no owner button (%s)" % found)
        shot("staff-more-open")
        ok(not errors, "no page errors " + str(errors[:2]))
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
