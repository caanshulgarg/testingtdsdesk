"""python3 run_tally_clicks.py - every click about Tally works (15-Oct-2026; the owner: "please make sure every click regarding
Tally works").
Every button, link, menu, tick and choice box on the Tally page (Connect Tally, the computers' lines, Reading, the clients'
table, and the Advanced fold opened with each computer's Details) and at every Tally entry point elsewhere (the top bar's
sign, its hover card and its panel, the client's chip, the Clients list chip, Today's not-linked line, Getting ready,
Client setup -> Tally with its More menu and posting tick, Settings -> Books in the cloud, Sync activity and Everything
sent with their "<- Tally"), clicked one at a time from a fresh scene, as an owner and as staff, in the owner's scene
(paused, Tally not answering, a client not linked) and in an all-connected scene. For each click:
  - no page error;
  - something happens: the page, tab, step or fold changes, a question is asked (answered Yes, with its boxes filled), a
    call goes out (RPC spy, the bridge's wake, a read of the computers, doAct, Update now, a toast), or the page's words
    change; a download is the setup's link (not followed);
  - the expected effect where there is one (next-tally-suvit: Add as client / Link on a company's row -> tally_company_link,
    Sync now -> Update now, Today's not-linked line -> the client's Tally card): Link -> tally_company_link, Check again -> the wake and a read, Resume ->
    tally_read_resume, Unlink -> its question then tally_company_link with no client, Hold / Roll back / Stop reading ->
    their question then their RPC, Update now -> tallyUpdateNow;
  - staff see no owner-only control and no owner-only RPC goes out.
A control with no effect is a dead button: the test fails and names it. The full list of what was clicked and what
happened is printed. All made up in the page (the RPC spies of run_tally_page_clean.py); no Tally, no staging.
The four rounds (owner / staff x the two scenes) run side by side, each in its own browser (--part N runs one).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_clicks.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
import run_tally_page_clean as C
PORT = 8431
# the four rounds (owner and staff, each in the owner's scene and all connected) run side by side, each in its own browser
# and port (--part N), so the whole test takes a quarter of the time
PARTS = [("owner", "owner's scene"), ("owner", "all connected"), ("staff", "owner's scene"), ("staff", "all connected")]
PART = int(sys.argv[sys.argv.index("--part") + 1]) if "--part" in sys.argv else -1
if PART >= 0: PORT += 1 + PART
fails, errors, done = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OWNER_RPC = {"tally_read_resume", "tally_read_stop", "tally_release_hold", "tally_release_unhold", "tally_release_rollback", "tally_release_rollback_clear",
             "tally_release_withdraw", "tally_device_trial_tools", "tally_device_recorder_source", "tally_device_post_settings", "tally_bridge_changes_only",
             "tally_bridge_make_main", "tally_baseline_clear", "tally_bridge_release_identity", "tally_member_link"}
# the spies: every call the page can make, counted (installed after each scene)
SPY = """() => {
  window.__fx = []; const fx = (k, a) => window.__fx.push([k, a]);
  const wrap = (name) => { const f = window[name]; if (typeof f !== 'function' || f.__spy) return; const g = function(...a){ fx(name, JSON.stringify(a).slice(0, 120)); return f.apply(this, a); }; g.__spy = 1; window[name] = g; };
  ['doAct', 'tallyUpdateNow', 'openConnectTally', 'tallyLinkClient', 'toast', 'openCompany', 'goClient', 'navHome', 'askConfirm', 'goStep'].forEach(wrap);
  if (!TCloud.__spied) { TCloud.__spied = 1; const m = TCloud.refreshPane.bind(TCloud); TCloud.refreshPane = function(){ fx('refreshPane', ''); return m(); }; }
}"""
STATE = """() => { const yes = document.querySelector('#confirmBox [data-cbx="yes"]'); const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }; return {view: S.view, home: S.homeTab, ttab: S.tallyTab, tab: S.tab, co: S.coId, step: S.step || '', guide: JSON.stringify(S.tallyGuide || {}),
  more: JSON.stringify(S.tallyMore || {}), panel: !!S.tallyPanel, set: S.settingsTab || '', hash: location.hash, confirm: vis(yes), selects: [...document.querySelectorAll('select')].map(x => x.value).join('|') + '/' + [...document.querySelectorAll('input[type=checkbox]')].map(x => x.checked ? 1 : 0).join(''),
  calls: (window.__calls || []).length, wakes: (window.__wakes || []).length, reads: window.__reads || 0, fx: (window.__fx || []).length,
  text: (document.querySelector('#app') || document.body).innerText.length + ':' + ((document.querySelector('#app') || document.body).innerText.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)),
  details: [...document.querySelectorAll('details')].filter(d => d.open).length}; }"""
# the controls of an area, each with a stable name (its tag, its first data- attribute, its words) and its kind
LIST = """(scope) => { const root = document.querySelector(scope); if (!root) return [];
  const els = [...root.querySelectorAll('button, a[href], select, input[type=checkbox], summary, label.btn')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden') || e.tagName === 'SUMMARY'; }).filter(e => !e.closest('#confirmBox'));
  const name = (e) => { const d = [...e.attributes].map(a => a.name).filter(n => n.startsWith('data-') && !['data-state', 'data-level', 'data-arc', 'data-click-me'].includes(n));
    const t = (e.innerText || e.getAttribute('aria-label') || '').replace(/[\u25b2\u25bc]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 50);
    return e.tagName.toLowerCase() + (d.length ? '[' + d[0] + (e.getAttribute(d[0]) ? '=' + e.getAttribute(d[0]).slice(0, 40) : '') + ']' : '') + ' ' + JSON.stringify(t); };
  const seen = {}; return els.map(e => { const n = name(e); seen[n] = (seen[n] || 0) + 1; return {name: n, nth: seen[n] - 1, tag: e.tagName, here: e.getAttribute('aria-selected') === 'true', dl: e.hasAttribute('download') || /FinComBridge-Setup/.test(e.getAttribute('href') || ''),
    href: e.getAttribute('href') || '', disabled: !!e.disabled, file: !!e.querySelector('input[type=file]'), options: e.tagName === 'SELECT' ? [...e.options].map(o => o.value) : []}; }); }"""
FIND = """([scope, name, nth]) => { const root = document.querySelector(scope); if (!root) return false;
  const els = [...root.querySelectorAll('button, a[href], select, input[type=checkbox], summary, label.btn')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden') || e.tagName === 'SUMMARY'; }).filter(e => !e.closest('#confirmBox'));
  const nm = (e) => { const d = [...e.attributes].map(a => a.name).filter(n => n.startsWith('data-') && !['data-state', 'data-level', 'data-arc', 'data-click-me'].includes(n));
    const t = (e.innerText || e.getAttribute('aria-label') || '').replace(/[\u25b2\u25bc]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 50);
    return e.tagName.toLowerCase() + (d.length ? '[' + d[0] + (e.getAttribute(d[0]) ? '=' + e.getAttribute(d[0]).slice(0, 40) : '') + ']' : '') + ' ' + JSON.stringify(t); };
  let hits = els.filter(e => nm(e) === name);
  // a control whose words change by themselves (Update now -> Reading now...): found again by its data- hook
  if (!hits[nth] && /\[/.test(name)) { const hook = name.split(' ')[0]; hits = els.filter(e => nm(e).split(' ')[0] === hook); }
  const e = hits[nth]; if (!e) return false;
  // a control inside a folded part (a closed <details>) is reached as a person does: the fold opened first
  if (e.tagName !== 'SUMMARY') { let d = e.closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); } }
  document.querySelectorAll('[data-click-me]').forEach(x => x.removeAttribute('data-click-me')); e.setAttribute('data-click-me', '1'); return true; }"""
# what a control must do, where it is known (its name's start -> the check)
def expect(name, d, calls, fx):
    rpc = [c[0] for c in calls]; fxn = [f[0] for f in fx]
    if "[data-guide-link=" in name: return "tally_company_link" in rpc, "Link -> tally_company_link"
    if "[data-check-again]" in name and "Check again" in name: return d["wakes"] > 0 or d["reads"] > 0 or "refreshPane" in fxn, "Check again -> the wake and a read"
    if "[data-read-resume=" in name or "[data-pc-resume=" in name or "[data-read-resume-line]" in name: return "tally_read_resume" in rpc, "Resume -> tally_read_resume"
    if "[data-tally-link-unlink]" in name: return "tally_company_link" in rpc and d["asked"], "Unlink -> asked, then tally_company_link (no client)"
    if "[data-release-hold]" in name: return "tally_release_hold" in rpc and d["asked"], "Hold -> asked, then tally_release_hold"
    if "[data-release-rollback]" in name: return "tally_release_rollback" in rpc and d["asked"], "Roll back -> asked, then tally_release_rollback"
    if "[data-read-stop-all]" in name or "[data-read-stop=" in name: return "tally_read_stop" in rpc and d["asked"], "Stop reading -> asked, then tally_read_stop"
    if "[data-update-now]" in name: return "tallyUpdateNow" in fxn or "doAct" in fxn, "Update now -> tallyUpdateNow"
    # next-tally-suvit: Add as client / Link on a company's row: the link (tally_company_link); Sync now: Update now
    if "[data-tco-act=" in name or "[data-tco-relink]" in name: return "tally_company_link" in rpc, "Add as client / Link -> tally_company_link"
    if "[data-tco-sync-now=" in name or "[data-tally-sync-now=" in name: return "tallyUpdateNow" in fxn or "doAct" in fxn or "tally_want_update" in rpc, "Sync now -> Update now"
    # Today's not-linked line: the client's own Tally card (its companies in Tally, each with Link)
    if "[data-not-linked-open=" in name: return d["view"] == "company" and d["tab"] == "cotally", "-> the client's Tally card"
    if "[data-open-connect" in name or "[data-client-link=" in name: return '"step"' in d["guide"] and d["home"] == "tally", "-> Connect Tally"
    return None, ""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(C.Q, directory=C.SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        pg.on("dialog", lambda dlg: dlg.dismiss())
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
            body=json.dumps({"setup": {"version": "2.4.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.4.exe", "sha256": "ab" * 32}})))
        pg.route("**/FinComBridge-Setup-*", lambda r: r.fulfill(status=200, body="setup"))
        pg.route("http://localhost:1/**", lambda r: r.abort())
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        allc = C.dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.4.4")
        SCENES = {
            "owner's scene": lambda: ([C.PAUSED, C.OLD], C.companies(), C.DAYBOOK),
            "all connected": lambda: ([allc], C.companies(linked=("GB TEXCOAT", "ABC TRADERS", "garg shekhar & company"), seen=("VMS EVENTS",), d=allc["id"]), []),
        }
        ids = {}
        def scene(sc, role):
            devs, cos, lines = SCENES[sc]()
            E("() => { S.listSort = {}; if (TCloud.pane) { TCloud.pane.gs = {}; TCloud.pane.rp = {}; TCloud.pane.ctl = {}; } S.tallyPanel = false; }")
            ids.update(E(C.SETUP, [devs, cos, list(lines), role, C.CLIENTS, True])); E(SPY); pg.wait_for_timeout(1000)
        # the places: how to get there from a fresh scene, and the part of the page whose controls are clicked
        G = lambda: ids["garg shekhar & company"]; T = lambda: ids["GB TEXCOAT"]
        def at_tally(): pass
        def at_fold(): E("() => { S.tallyMore = {page: true}; render(); }"); pg.wait_for_timeout(500); E("() => document.querySelectorAll('#app [data-advanced] [data-more-toggle][aria-expanded=\"false\"]').forEach(b => b.click())"); pg.wait_for_timeout(500)
        def at_client(cid, tab):
            def go():
                E("([c, t]) => { S.tallyGuide = {}; openCompany(c); S.view = 'company'; S.tab = t; S.step = null; render(); }", [cid(), tab]); pg.wait_for_timeout(900)
            return go
        def at_home(tab): return lambda: (E("(t) => navHome(t)", tab), pg.wait_for_timeout(900))
        def at_panel(cid):
            def go():
                at_client(cid, "dash")(); E("() => doAct('tallyPanel')"); pg.wait_for_timeout(600)
            return go
        def at_hover(cid):
            def go():
                at_client(cid, "dash")(); pg.hover("#cobar [data-tally-sign]"); pg.wait_for_timeout(300)
            return go
        def at_tcloud(): E("() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'tcloud'; render(); }"); pg.wait_for_timeout(1500)
        def at_tab(t): return lambda: (E("(t) => { S.tallyTab = t; Rec.act.at = 0; render(); }", t), pg.wait_for_timeout(1200))
        PLACES = [
            ("the Tally page", at_tally, "#app"),
            ("Advanced (opened, each computer's Details)", at_fold, "#app [data-advanced]"),
            ("Sync activity", at_tab("activity"), "#app nav.sbar"),
            ("Everything sent", at_tab("sent"), "#app nav.sbar"),
            ("top bar sign (not linked client)", at_client(G, "dash"), "#cobar .tsign-wrap"),
            ("top bar sign's hover card", at_hover(G), "#cobar .tsign-pop"),
            ("top bar Tally panel", at_panel(T), ".tallypanel"),
            ("client chip (not linked)", at_client(G, "dash"), "#cobar .tbar-h"),
            ("client chip (linked)", at_client(T, "dash"), "#cobar .tbar-h"),
            ("Clients list chips", at_home("clients"), "#app table[data-list=\"clients\"]"),
            ("Today's not-linked line", at_home("today"), "#app [data-not-linked-line]"),
            ("Getting ready (not linked client)", at_client(G, "dash"), "#app [data-onb-step=\"link\"]"),
            ("Client setup -> Tally (not linked)", at_client(G, "cotally"), "#app [data-tally-link]"),
            ("Client setup -> Tally (linked)", at_client(T, "cotally"), "#app [data-tally-link]"),
            ("Settings -> Books in the cloud", at_tcloud, "#app .setbody"),
        ]
        total = dead = 0
        for role, sc in [PARTS[PART]]:
            if True:
                print("\n== %s, %s" % (role, sc))
                for place, go, scope in PLACES:
                    scene(sc, role); go()
                    ctrls = E(LIST, scope)
                    if place == "Advanced (opened, each computer's Details)":
                        hooks = [h for h in C.OWNER_HOOKS if role == "staff" and pg.locator("#app [%s]" % h).count()]
                        ok(not hooks, "%s, %s: staff see no owner control (%s)" % (role, sc, hooks))
                    if role == "staff" and place == "the Tally page":
                        hooks = [h for h in C.OWNER_HOOKS if pg.locator("#app [%s]" % h).count()]
                        ok(not hooks, "%s, %s: staff see no owner control on the page (%s)" % (role, sc, hooks))
                    if not ctrls: print("  -    %s: nothing to click here" % place); continue
                    for c in ctrls:
                        if c["disabled"]: print("  -    %s: %s is greyed out (not pressable)" % (place, c["name"])); continue
                        if c["here"]:
                            line = "%s: %s -> the page already open (its tab marked)" % (place, c["name"]); ok(True, line); done.append(("%s/%s" % (role, sc), line)); continue
                        scene(sc, role); go()
                        if not E(FIND, [scope, c["name"], c["nth"]]):
                            # the same control in another row, gone because an earlier click's answer is still on screen: its first one was clicked
                            if c["nth"] > 0: print("  -    %s: %s (row %d) is the same control as row 1, clicked above" % (place, c["name"], c["nth"] + 1)); continue
                            ok(False, "%s: %s could not be found again" % (place, c["name"])); continue
                        total += 1
                        el = pg.locator("[data-click-me]")
                        if c["dl"]:
                            good = "FinComBridge-Setup-2.4.4.exe" in c["href"] or "bridge-go" in c["href"]
                            line = "%s: %s -> downloads the setup (%s)" % (place, c["name"], c["href"][:60]); ok(good, line); done.append(("%s/%s" % (role, sc), line)); continue
                        if c["href"].startswith("http") and "localhost:%d" % PORT not in c["href"]:
                            line = "%s: %s -> a link out (%s), not followed" % (place, c["name"], c["href"][:60]); ok(True, line); done.append(("%s/%s" % (role, sc), line)); continue
                        b = E(STATE); e0 = len(errors); calls0 = len(E("window.__calls || []")); fx0 = len(E("window.__fx || []"))
                        chooser = []
                        if c["tag"] == "SELECT" and len([o for o in c["options"] if o]) <= 1 and not [o for o in c["options"] if not o]:
                            line = "%s: %s -> one choice only (nothing to change)" % (place, c["name"]); ok(True, line); done.append(("%s/%s" % (role, sc), line)); continue
                        if c["file"]:
                            try:
                                with pg.expect_file_chooser(timeout=5000) as fc: el.click(force=True)
                                chooser.append(fc.value)
                            except Exception as ex: print("  note file picker: %s" % str(ex)[:100])
                            pg.wait_for_timeout(300)
                        elif c["tag"] == "SELECT":
                            cur = E("() => document.querySelector('[data-click-me]').value")
                            opts = [o for o in c["options"] if o and o != cur]
                            if opts: el.select_option(opts[-1])
                            pg.wait_for_timeout(700)
                        else:
                            try: el.click(timeout=5000)
                            except Exception: el.dispatch_event("click")
                            pg.wait_for_timeout(700)
                        asked = E(STATE)["confirm"]
                        if asked:
                            E("""() => document.querySelectorAll('#confirmBox input').forEach(i => { if (i.type === 'checkbox') return; i.value = i.id === 'rollbackVersion' ? '2.4.1' : /code/i.test(i.id) ? '123456' : 'test'; i.dispatchEvent(new Event('input', {bubbles: true})); })""")
                            if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]')
                            pg.wait_for_timeout(900)
                        a = E(STATE); calls = E("window.__calls || []")[calls0:]; fx = E("window.__fx || []")[fx0:]
                        a["asked"] = asked
                        changed = [k for k in ("view", "home", "ttab", "tab", "co", "step", "guide", "more", "panel", "set", "hash", "details", "selects") if a[k] != b[k]]
                        what = []
                        if changed: what.append("changed " + ",".join(changed))
                        if asked: what.append("asked first")
                        if calls: what.append("called " + ",".join(sorted(set(x[0] for x in calls))))
                        if a["wakes"] > b["wakes"]: what.append("woke the bridge")
                        if a["reads"] > b["reads"]: what.append("read the computers")
                        acts = [f[0] + ("(" + f[1][:40] + ")" if f[0] in ("doAct", "openConnectTally", "goClient", "navHome") else "") for f in fx if f[0] not in ("toast",)]
                        if acts: what.append("ran " + ",".join(dict.fromkeys(acts)))
                        toasts = [f[1][:60] for f in fx if f[0] == "toast"]
                        if toasts: what.append("said " + toasts[0])
                        if chooser: what.append("opened the file picker")
                        if not what and a["text"] != b["text"]: what.append("the page's words changed")
                        errs = errors[e0:]
                        line = "%s: %s -> %s" % (place, c["name"], "; ".join(what) or "NOTHING")
                        good = bool(what) and not errs
                        exp, exw = expect(c["name"], a, calls, fx)
                        if exp is False: good = False; line += "   [expected: %s]" % exw
                        if role == "staff":
                            own = [x[0] for x in calls if x[0] in OWNER_RPC]
                            if own: good = False; line += "   [staff ran an owner-only call: %s]" % own
                        if errs: line += "   [page error: %s]" % errs[0][:120]
                        if not what: dead += 1
                        ok(good, line); done.append(("%s/%s" % (role, sc), line))
                        if asked and E(STATE)["confirm"]:
                            if pg.locator('#confirmBox [data-cbx="no"]').count(): pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(300)
        print("\n%d controls clicked, %d dead" % (total, dead))
        ok(total > 40 and dead == 0, "every Tally control does something (%d clicked, %d dead)" % (total, dead))
        ok(not [e for e in errors if "localhost:1" not in e], "no page errors %s" % errors[:3])
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

def all_parts():
    import subprocess
    procs = [subprocess.Popen([sys.executable, os.path.abspath(__file__), "--part", str(i)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) for i in range(len(PARTS))]
    outs = [pr.communicate()[0] for pr in procs]
    bad = 0
    for (role, sc), out, pr in zip(PARTS, outs, procs):
        print(out.rstrip()); bad += pr.returncode != 0
    n = sum(int(m.group(1)) for out in outs for m in [re.search(r"(\d+) controls clicked", out)] if m)
    print("\n%d controls clicked in all (owner and staff, the owner's scene and all connected)" % n)
    print("\nall passed" if not bad and n > 200 else "\nFAILED: %d rounds" % bad); raise SystemExit(1 if bad or n <= 200 else 0)

if __name__ == "__main__":
    main() if PART >= 0 else all_parts()
