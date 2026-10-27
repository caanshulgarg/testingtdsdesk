"""python3 run_tally_states.py - the Tally connection in FinCom (go-bridge, review of 01-Oct-2026: the status went
between connected and disconnected while the bridge was busy with Tally):
  - three parts, apart: Bridge (online / reconnecting / offline), Tally (open / busy / not open), Company (linked / not);
  - a heartbeat a little late: still online (the steady sign, 11-Oct-2026: no "Reconnecting…"); Offline only after three
    missed beats that held for a minute;
  - a busy Tally: "Connected – Tally busy", never offline or disconnected, also on this computer's bridge chip;
  - the bridge on this computer not answering for a moment (1.15.0 busy with Tally): still connected, offline only after
    two minutes;
  - Settings → Tally Bridge: the connection history of the last 24 hours.
Offline, a made-up client, the React test build (app/dist-test)."""
import os, sys, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8173), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
iso = lambda sec: (datetime.datetime.utcnow() - datetime.timedelta(seconds=sec)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8173/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""() => { const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return c.id; }""")
    # a Tally computer of the firm, beating every 30 s
    setup = """(a) => { const [cid, beat] = a; TCloud.on = () => true; TLight.refresh = () => {}; TLight.st.at = Date.now();
      TLight.st.devs = [{id: "d1", name: "OFFICE-PC", last_seen: beat.at, info: {beat, history: a[2] || []}}];
      TLight.st.cos = [{company: "TESTING AAD", client_id: cid}]; for (const k in BeatSeen) delete BeatSeen[k]; return tallyStatus(S.companies[cid]); }"""
    st = pg.evaluate(setup, [cid, {"at": iso(5), "every": 30, "tally": True, "tallyState": "open", "companies": [], "open": ["TESTING AAD"]}])
    ok(st["state"] == "ok" and st["parts"] == {"bridge": "online", "tally": "open", "company": "linked", "busySince": ""}, "a beat 5 s ago: Bridge online, Tally open, Company linked (%s)" % st["label"])
    st = pg.evaluate(setup, [cid, {"at": iso(20), "every": 30, "tally": True, "tallyState": "busy", "busySince": iso(200)[:19], "companies": [], "open": ["TESTING AAD"]}])
    ok(st["state"] == "busy" and st["label"] == "Connected – Tally busy" and st["parts"]["bridge"] == "online" and st["parts"]["tally"] == "busy", "Tally busy: “Connected – Tally busy”, the bridge still online")
    # the steady sign (11-Oct-2026): a late beat is not "Reconnecting…" any more: it stays online; offline once three beats
    # are missed AND that held for a minute (TallySteady); the beat's age is from its own time (beat.at)
    late = """(a) => { const [cid, ago, every] = a; TLight.st.devs[0].info.beat = Object.assign({}, TLight.st.devs[0].info.beat, {at: new Date(Date.now() - ago * 1000).toISOString(), every: every || 30}); return tallyStatus(S.companies[cid]); }"""
    pg.evaluate("TallySteady.reset()")
    st = pg.evaluate(setup, [cid, {"at": iso(1), "every": 30, "tally": True, "tallyState": "open", "companies": []}])
    for ago in (60, 90, 115):
        st = pg.evaluate(late, [cid, ago])
        ok(st["parts"]["bridge"] == "online" and "econnecting" not in st["label"] + st["short"], "no new beat for %d s (beats every 30 s): still online, no “Reconnecting…” (%s)" % (ago, st["label"]))
    st = pg.evaluate(late, [cid, 125])
    ok(st["parts"]["bridge"] == "online", "125 s: three beats missed, but not yet for a minute: still online (%s)" % st["label"])
    st = pg.evaluate("""(cid) => { const n = Date.now; const t = n() + 61000; Date.now = () => t; TLight.st.devs[0].info.beat.at = new Date(t - 186000).toISOString();
      const r = tallyStatus(S.companies[cid]); Date.now = n; return r; }""", cid)
    ok(st["state"] == "offline" and st["label"].startswith("Offline since"), "offline once that held a minute: “%s”" % st["label"])
    pg.evaluate("TallySteady.reset()")
    st = pg.evaluate(setup, [cid, {"at": iso(1), "every": 60, "tally": True, "companies": []}])
    st = pg.evaluate(late, [cid, 150, 60])
    ok(st["parts"]["bridge"] == "online", "bridge 1.15.0 (a beat every 60 s): 150 s without one is still online")
    # this computer's bridge: one status check not answered (1.15.0 busy with Tally) is not a lost bridge
    r = pg.evaluate("""async () => { Bridge.on = () => true; Bridge.st = {state: "ok", sessions: [], open: [], at: Date.now(), tallyUp: true, tallyState: "open"}; Bridge.okAt = Date.now() - 30000;
      Bridge.call = async () => { throw {code: "bridge_down", message: "The Tally Bridge did not answer in time."}; };
      await Bridge.refresh(false); clearTimeout(Bridge.again); const a = [Bridge.up(), !!Bridge.st.shaky, tallyHereNow(null).label];
      Bridge.okAt = Date.now() - 130000; await Bridge.refresh(false); clearTimeout(Bridge.again); return a.concat([Bridge.st.state]); }""")
    ok(r[0] and r[1] and "reconnecting" not in r[2].lower(), "this computer's bridge not answering for 30 s: still connected, no “reconnecting…” (the steady sign, 11-Oct-2026)")
    ok(r[3] == "down", "not answering for over two minutes: offline")
    chip = pg.evaluate("""() => { Bridge.st = {state: "ok", sessions: [], open: [], at: Date.now(), tallyUp: true, tallyState: "busy", busySince: "2026-10-01T12:40:00", stuck: {since: "2026-10-01T12:40:00"}}; const h = tallyHereNow(null); return [h.label, h.level]; }""")
    # 24-Oct-2026 (next-tally-one-page): the old sidebar chip (bridgeChip) is gone; the one Tally sign (tallyHereNow) says it
    ok(chip == ["Tally busy", "warn"], "Tally stuck on this computer: the sign says “Tally busy” (amber), not “not responding” (%s)" % chip)
    # Settings → FinCom Bridge: the three parts and the history
    hist = [{"kind": "bridge", "state": "online", "at": iso(20000)}, {"kind": "bridge", "state": "offline", "at": iso(9000), "to": iso(8800)},
            {"kind": "tally", "state": "busy", "at": iso(5000), "was": "open"}, {"kind": "tally", "state": "open", "at": iso(4800), "was": "busy"},
            {"kind": "company", "state": "closed", "name": "TESTING AAD", "at": iso(3000)}, {"kind": "tally", "state": "busy", "at": iso(100000), "was": "open"}]
    pg.evaluate("() => { Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now()}; Bridge.on = () => false; }")
    pg.evaluate(setup, [cid, {"at": iso(3), "every": 30, "tally": True, "tallyState": "busy", "busySince": iso(60)[:19], "companies": []}, hist])
    pg.evaluate("(cid) => openCompany(cid).then(() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'bridge'; render(); })", cid); pg.wait_for_timeout(1500)
    # Settings → FinCom Bridge is one line that opens its home: the Tally page's Advanced (for support), where this
    # computer's bridge and the connection history are (15-Oct-2026)
    if pg.locator('[data-home-go="bridge"]').count(): pg.click('[data-home-go="bridge"]'); pg.wait_for_timeout(1500)
    # round 66: the link opens the Tally page at its six steps; this computer's bridge is in Help & support (opened here)
    if pg.locator('#app [data-advanced] [data-bridge-details][aria-expanded="false"]').count(): pg.click('#app [data-advanced] [data-bridge-details]'); pg.wait_for_timeout(800)
    t = pg.inner_text("#app")
    ok(pg.locator('[data-part="bridge"][data-state="online"]').count() >= 1 and pg.locator('[data-part="tally"][data-state="busy"]').count() >= 1 and pg.locator('[data-part="company"][data-state="linked"]').count() >= 1,
       "Settings → FinCom Bridge: Bridge Online, Tally Busy, Company Linked, apart")
    hp = pg.locator('[data-pane="tally-history"]').inner_text() if pg.locator('[data-pane="tally-history"]').count() else ""
    ok("Connection history" in hp and "Bridge offline" in hp and "(3 min)" in hp and "Tally busy" in hp and "Closed in Tally: TESTING AAD" in hp, "the connection history: an offline spell with its length, Tally busy, a company closed")
    ok(pg.locator('[data-pane="tally-history"] tbody tr').count() == 5, "only the last 24 hours (an older event left out)")
    ok("Offline 1 time" in hp, "with a summary: offline once")
    top = pg.evaluate("() => { render(); return document.querySelector('[data-tally]') ? document.querySelector('[data-tally]').getAttribute('data-tally') : ''; }")
    ok(top in ("busy", "ok", "unlinked", "waiting"), "the top bar follows: %s, not offline" % top)
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
