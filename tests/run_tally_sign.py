"""python3 run_tally_sign.py - the top bar's one Tally sign (owner's spec H, 04-Oct-2026):
  - round 3 (05-Oct-2026, part 2): the sign says WHICH computer: "Tally connected on this computer" only when the bridge
    here answers (127.0.0.1), "Tally connected through Office computer (NWS144)" (tally_devices' name, the beat's Windows
    name), "through 2 computers" (names on a click), "Tally not connected. Last seen on <computer> at <time IST>",
    "Tally is open on <computer> with a different company"; on a phone the dot and the computer's name, never
    "connected" alone;
  - two states: a green dot (connected), a red dot (not connected); connected only when FinCom Bridge
    on a computer of the firm is online (its heartbeat recent) AND Tally is open there with THIS client's company;
  - the detail on hover and on a click: which computer, which company, the last contact (dd-Mon-yyyy HH:MM IST), and
    when disconnected the reason and the fix, one for each: the bridge not running, Tally closed, no company open, a
    different company open, no internet on that computer;
  - no "live" and no cloud sign; "Saving…" while saving, "Not saved: <reason>" in red on a failure, nothing when saved;
  - "N to check in Tally" is now "N entries need review", a link to Post to Tally → Errors, hidden at zero.
Offline, a made-up client, the React test build (app/dist-test)."""
import os, re, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8247), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
iso = lambda sec: (datetime.datetime.utcnow() - datetime.timedelta(seconds=sec)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
IST = re.compile(r"\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST")
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8247/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""() => { const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "TESTING AAD"; S.companies[c.id] = c;
      S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; render(); return c.id; }""")
    pg.wait_for_timeout(500)
    ok(pg.evaluate("typeof tallySign") == "function", "tallySign() decides the sign (src/js/49-tally-cloud.js)")
    # a Tally computer of the firm (the cloud's heartbeat), and this computer's bridge (off unless said)
    setup = """(a) => { const [cid, beat, local] = a; TCloud.on = () => true; TLight.refresh = () => {}; TLight.st.at = Date.now();
      TLight.st.devs = beat ? [{id: "d1", name: "OFFICE-PC", last_seen: beat.at, info: {computer: "OFFICE-PC", beat}}] : [];
      TLight.st.cos = [{company: "TESTING AAD", client_id: cid, device_id: "d1"}]; for (const k in BeatSeen) delete BeatSeen[k];
      if (local){ Bridge.on = () => true; Bridge.up = () => local.state === "ok"; Bridge.st = Object.assign({sessions: [], open: [], at: Date.now()}, local); Bridge.okAt = Date.now(); }
      else { Bridge.on = () => false; Bridge.up = () => false; Bridge.st = {state: "off", sessions: [], open: [], at: Date.now()}; }
      render(); return tallySign(S.companies[cid]); }"""
    beat = lambda **k: dict({"at": iso(5), "every": 30, "tally": True, "tallyState": "open", "companies": [], "open": ["TESTING AAD"], "computer": "OFFICE-PC"}, **k)
    def top():
        b = pg.locator("#cobar [data-tally-sign]")
        return (b.get_attribute("data-tally-sign"), b.inner_text().strip(), b.get_attribute("title") or "") if b.count() == 1 else (None, "", "")
    # 1. connected
    s = pg.evaluate(setup, [cid, beat(), None]); pg.wait_for_timeout(300)
    st, txt, title = top()
    ok(s["on"] is True and st == "on" and txt == "Tally connected through OFFICE-PC", "connected: the bridge's heartbeat 5 s ago, Tally open with TESTING AAD, through which computer: “%s”" % txt)
    dot = pg.evaluate("getComputedStyle(document.querySelector('#cobar [data-tally-sign] .tsign-dot')).backgroundColor")
    ok(dot == "rgb(21, 128, 61)", "a green dot (%s)" % dot)
    ok("OFFICE-PC" in title and "TESTING AAD" in title and IST.search(title), "hover: computer, company and the last contact in IST (%s)" % title[:140])
    pg.click("#cobar [data-tally-sign]"); pg.wait_for_timeout(300)
    d = pg.inner_text("[data-tally-detail]") if pg.locator("[data-tally-detail]").count() else ""
    ok("OFFICE-PC" in d and "TESTING AAD" in d and IST.search(d), "a click shows the same detail in plain words (%s)" % d.replace("\n", " / ")[:160])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ok(pg.evaluate("[S.tallyPanel, S.view]") == [False, "company"], "Esc closes the Tally panel and stays with the client")
    s = pg.evaluate(setup, [cid, beat(tallyState="busy"), None])
    ok(s["on"] is True, "Tally busy with the company open is still connected (no flicker)")
    # 2. disconnected, each reason with its fix
    cases = [
        ("bridge", [cid, beat(at=iso(400)), None], "not running", "FinCom Bridge"),
        ("tally", [cid, beat(tally=False, tallyState="closed", open=[]), None], "closed", "Open TallyPrime"),
        ("nocompany", [cid, beat(open=[]), None], "no company", "Open TESTING AAD"),
        ("othercompany", [cid, beat(open=["MASTERCAD SOLUTIONS"]), None], "MASTERCAD SOLUTIONS", "Open TESTING AAD"),
        ("internet", [cid, beat(at=iso(400)), {"state": "ok", "computer": "OFFICE-PC", "tallyState": "open", "tallyUp": True, "beat": {"every": 30, "last": "", "missedSince": iso(380), "on": True}}], "internet", "internet"),
    ]
    for code, args, why, fix in cases:
        s = pg.evaluate(setup, args); pg.wait_for_timeout(600)
        st, txt, title = top()
        want = "Tally is open on OFFICE-PC with a different company" if code == "othercompany" else "Tally not connected"
        ok(s["on"] is False and s["code"] == code and st == "off" and txt.startswith(want), "%s: “%s…” (%s; %s %s %s)" % (code, want, s.get("reason", ""), s.get("code"), st, txt))
        ok(why.lower() in (s.get("reason") or "").lower() and fix.lower() in (s.get("fix") or "").lower(), "%s: the reason says “%s” and the fix “%s” (%s | %s)" % (code, why, fix, s.get("reason"), s.get("fix")))
        ok(why.lower() in title.lower() and fix.lower() in title.lower(), "%s: reason and fix on hover (%s)" % (code, title[-160:]))
        ok("OFFICE-PC" in s.get("computer", "") and (code == "bridge" or IST.search(s.get("at", "") or "") or code == "internet"), "%s: which computer (%s), last contact %s" % (code, s.get("computer"), s.get("at")))
    dot = pg.evaluate("getComputedStyle(document.querySelector('#cobar [data-tally-sign] .tsign-dot')).backgroundColor")
    ok(dot == "rgb(185, 28, 28)", "a red dot (%s)" % dot)
    pg.click("#cobar [data-tally-sign]"); pg.wait_for_timeout(300)
    d = pg.inner_text("[data-tally-detail]") if pg.locator("[data-tally-detail]").count() else ""
    ok("internet" in d.lower() and "OFFICE-PC" in d, "a click: the reason and the fix in the panel (%s)" % d.replace("\n", " / ")[:160])
    pg.evaluate("() => { S.tallyPanel = false; render(); }")
    s = pg.evaluate(setup, [cid, None, None])
    ok(s["on"] is False and s["code"] == "bridge", "no Tally computer at all: disconnected, the bridge is not running (%s)" % s.get("reason"))
    # only two states, whatever the old status said
    states = set(pg.evaluate("""(cid) => { const out = []; for (const b of [null, {at: new Date().toISOString(), every: 30, tallyState: 'busy', open: ['TESTING AAD']}]) { TLight.st.devs = b ? [{id: 'd1', name: 'OFFICE-PC', info: {beat: b}}] : []; render(); out.push(document.querySelector('#cobar [data-tally-sign]').innerText.trim()); } return out; }""", cid))
    ok(all(x.startswith(("Tally connected through", "Tally connected on this computer", "Tally not connected", "Tally is open on")) for x in states), "only the two states, each naming the computer (%s)" % states)
    # ---- round 3, part 2: which computer
    two = """(a) => { const [cid, devs, local] = a; TCloud.on = () => true; TLight.refresh = () => {}; TLight.st.at = Date.now(); TLight.st.devs = devs;
      TLight.st.cos = [{company: "TESTING AAD", client_id: cid, device_id: devs[0] ? devs[0].id : null}]; for (const k in BeatSeen) delete BeatSeen[k];
      if (local){ Bridge.on = () => true; Bridge.up = () => local.state === "ok"; Bridge.st = Object.assign({sessions: [], open: [], at: Date.now()}, local); Bridge.okAt = Date.now(); }
      else { Bridge.on = () => false; Bridge.up = () => false; Bridge.st = {state: "off", sessions: [], open: [], at: Date.now()}; }
      S.tallyPanel = false; render(); return tallySign(S.companies[cid]); }"""
    d = lambda i, name, pc, **k: {"id": i, "name": name, "last_seen": iso(5), "info": {"computer": pc, "beat": beat(computer=pc, **k)}}
    # this computer: the bridge here answers on 127.0.0.1 with the company open
    s = pg.evaluate(two, [cid, [d("d1", "Office computer", "NWS144")], {"state": "ok", "computer": "NWS144", "tallyState": "open", "tallyUp": True, "open": [{"name": "TESTING AAD"}]}]); pg.wait_for_timeout(300)
    st, txt, title = top()
    ok(txt == "Tally connected on this computer", "the bridge here answers: “Tally connected on this computer” (%s)" % txt)
    # another device (the owner's Mac: no bridge here), connected through the office computer
    s = pg.evaluate(two, [cid, [d("d1", "Office computer", "NWS144")], None]); pg.wait_for_timeout(300)
    st, txt, title = top()
    ok(txt == "Tally connected through Office computer (NWS144)", "another device: “Tally connected through Office computer (NWS144)” (%s)" % txt)
    # "this computer" is never guessed: a bridge set up here that does not answer
    s = pg.evaluate(two, [cid, [d("d1", "Office computer", "NWS144")], {"state": "down", "computer": "NWS144"}]); pg.wait_for_timeout(300)
    st, txt, title = top()
    ok("this computer" not in txt and txt == "Tally connected through Office computer (NWS144)", "a bridge here that does not answer: still through Office computer, never “this computer” (%s)" % txt)
    # two computers
    s = pg.evaluate(two, [cid, [d("d1", "Office computer", "NWS144"), d("d2", "Accounts desk", "NWS210")], None]); pg.wait_for_timeout(300)
    st, txt, title = top()
    ok(txt == "Tally connected through 2 computers", "two computers: “Tally connected through 2 computers” (%s)" % txt)
    pg.click("#cobar [data-tally-sign]"); pg.wait_for_timeout(300)
    dd = pg.inner_text("[data-tally-detail]") if pg.locator("[data-tally-detail]").count() else ""
    ok("Office computer (NWS144)" in dd and "Accounts desk (NWS210)" in dd and "TESTING AAD" in dd and IST.search(dd), "a click: both computers, the company and the last contact (%s)" % dd.replace("\n", " / ")[:200])
    pg.evaluate("() => { S.tallyPanel = false; render(); }")
    # none: last seen, the reason and the fix on a click
    s = pg.evaluate(two, [cid, [dict(d("d1", "Office computer", "NWS144", at=iso(900)), last_seen=iso(900))], None]); pg.wait_for_timeout(300)
    st, txt, title = top()
    ok(re.match(r"Tally not connected\. Last seen on Office computer \(NWS144\) at \d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST$", txt), "none: “Tally not connected. Last seen on Office computer (NWS144) at <time IST>” (%s)" % txt)
    pg.click("#cobar [data-tally-sign]"); pg.wait_for_timeout(300)
    dd = pg.inner_text("[data-tally-detail]") if pg.locator("[data-tally-detail]").count() else ""
    ok("not running" in dd and "start FinCom Bridge" in dd, "a click: the reason and the fix (%s)" % dd.replace("\n", " / ")[:200])
    pg.evaluate("() => { S.tallyPanel = false; render(); }")
    # another company open
    s = pg.evaluate(two, [cid, [d("d1", "Office computer", "NWS144", open=["MASTERCAD SOLUTIONS"])], None]); pg.wait_for_timeout(300)
    st, txt, title = top()
    ok(txt == "Tally is open on Office computer (NWS144) with a different company" and st == "off", "a different company: “Tally is open on Office computer (NWS144) with a different company” (%s)" % txt)
    # a phone: the dot and the computer's name
    pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(300)
    s = pg.evaluate(two, [cid, [d("d1", "Office computer", "NWS144")], None]); pg.wait_for_timeout(400)
    st, txt, title = top()
    ok(txt == "Office computer (NWS144)" and st == "on", "a phone, connected: the green dot and “Office computer (NWS144)” (%s)" % txt)
    s = pg.evaluate(two, [cid, [dict(d("d1", "Office computer", "NWS144", at=iso(900)), last_seen=iso(900))], None]); pg.wait_for_timeout(400)
    st, txt, title = top()
    ok(txt == "Office computer (NWS144)" and st == "off" and "connected" not in txt.lower(), "a phone, not connected: the red dot and the computer's name, never “connected” alone (%s)" % txt)
    pg.set_viewport_size({"width": 1366, "height": 768}); pg.wait_for_timeout(300)
    # posting says the same before Post: bank and sales, and the shared words for the posting preview
    s = pg.evaluate(two, [cid, [d("d1", "Office computer", "NWS144")], None]); pg.wait_for_timeout(300)
    ok(pg.evaluate("(cid) => postThroughWords(S.companies[cid])", cid) == "This will post through Office computer (NWS144).", "before Post: “This will post through Office computer (NWS144).” (postThroughWords)")
    # 3. saving
    pg.evaluate(setup, [cid, beat(), None])
    hdr = lambda: pg.inner_text("#cobar")
    ok("live" not in hdr().lower().split() and "☁" not in hdr(), "no “live” and no cloud sign in the top bar")
    def sv_(x):
        pg.evaluate("""(s) => { Cloud.on = () => true; Cloud.st = Object.assign({state: "ok", email: "a@b.c", lastSync: Date.now()}, s.cloud || {}); Live.sv = s.sv; Live.st = "live"; render(); }""", x); pg.wait_for_timeout(500)
        return pg.evaluate("() => { const e = document.querySelector('#cobar [data-save]'); return e ? [e.getAttribute('data-save'), e.innerText.trim(), getComputedStyle(e).color] : null; }")
    r = sv_({"sv": {"state": "saved", "at": 1}})
    ok(r is None and "Saved" not in hdr() and "live" not in hdr().lower().split(), "all saved: nothing shown (%s)" % (r,))
    r = sv_({"sv": {"state": "saving", "at": 1}})
    ok(r and r[1] == "Saving…", "while saving: “Saving…” (%s)" % (r,))
    r = sv_({"sv": {"state": "error", "at": 1, "err": "duplicate key value violates unique constraint \"bill_items_pkey\""}})
    ok(r and r[1].startswith("Not saved: ") and "duplicate key" not in r[1] and "pkey" not in r[1] and r[2] == "rgb(185, 28, 28)", "a failure: “Not saved: <reason>” in red, in plain words (%s)" % (r,))
    r = sv_({"sv": {"state": "offline", "at": 1, "err": "Failed to fetch"}})
    ok(r and r[1].startswith("Not saved: ") and "internet" in r[1] and "Failed to fetch" not in r[1], "offline: “Not saved: …internet…” (%s)" % (r,))
    pg.evaluate("() => { Cloud.on = () => false; Live.sv = {state: '', at: 0}; render(); }")
    # 4. entries that need review
    pg.evaluate("() => { window.__ptc = window.postTabCounts; }")
    def rv(_, n):
        pg.evaluate("(n) => { window.postTabCounts = () => ({topost: 0, posted: 0, errors: n}); render(); }", n); pg.wait_for_timeout(500)
        return pg.evaluate("() => { const e = document.querySelector('#cobar [data-review-link]'); return e ? e.innerText.trim() : null; }")
    ok(rv(0, 6) == "6 entries need review", "six on Post to Tally → Errors: “6 entries need review”")
    ok(rv(0, 1) == "1 entry needs review", "one: “1 entry needs review”")
    ok("to check in Tally" not in hdr(), "no “to check in Tally” any more")
    pg.click("#cobar [data-review-link]"); pg.wait_for_timeout(500)
    ok(pg.evaluate("[S.tab, (S.postTabs || {})[S.coId]]") == ["export", "errors"], "the link opens Post to Tally on its Errors tab (%s)" % pg.evaluate("[S.tab, (S.postTabs || {})[S.coId]]"))
    pg.evaluate("() => goClient('dash')")
    ok(rv(0, 0) is None, "none: hidden")
    pg.evaluate("() => { window.postTabCounts = window.__ptc; render(); }")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
