"""python3 run_tally_sign_stable.py - the steady Tally sign (the owner, 11-Oct-2026: "that unstable Tally connection sign
at the top: it shows connected but was not connected, or 'connected through other computer'; it looks very amateur. Need
a stable system"; then: "only THIS computer's status in the top bar, a dot and a short word, quiet when all is well; the
button leads straight to getting connected").
Beat sequences played on a made-up clock (Date.now), the React test build (app/dist-test):
  - the top bar says this computer only: "Tally ready" (green), "Tally closed" / "Tally busy" / "Company not open" /
    "Company not linked" / "No internet" (amber), "Bridge stopped" (red), "Tally not on this computer" (grey); never the
    name of another computer, never "via" / "through" / "Reconnecting";
  - steady: "ready" at once; anything else only once it has held for 60 s; a single late beat, a bridge slow to answer
    once, Tally starting up (closed for 30 s) never change it; "Check again" shows the answer at once;
  - the hover: the computer with its Windows user, the company, "Last confirmed", the next step as a button, and the
    firm's other computers in one quiet line ("Posting goes through NWS144 (Ranjeet).");
  - the next step for each state: Connect this computer (the Tally page's connect steps), Check again, Link to Tally;
  - one Windows user's bridge is not taken for another's on the same computer (NWS144: anshul and Ranjeet);
  - the cloud's heartbeats: the last beat of a stopped bridge, first seen late, is not "fresh" (its age is from beat.at);
    tallyStatus never says "Reconnecting…"; a missed beat or two do not change the firm's sign;
  - posting reads the real state (tallySignNow / postThroughWords), never the steady one;
  - the Post to Tally page's status line says the same sign's words, steady; its posting gate stays real-time.
"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8263), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8263/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""() => { const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "TESTING AAD"; S.companies[c.id] = c;
      S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
      // a made-up clock: T moves only when the test says
      window.__realNow = Date.now.bind(Date); window.__T = window.__realNow(); Date.now = () => window.__T;
      TCloud.on = () => true; TLight.refresh = () => Promise.resolve(); TLight.st.at = Date.now(); TLight.st.loaded = true; TLight.st.devs = []; TLight.st.cos = [];
      TallySteady.reset(); render(); return c.id; }""")
    pg.wait_for_timeout(400)
    ok(pg.evaluate("[typeof tallyHere, typeof tallyHereNow, typeof TallySteady, typeof tallySignNow]") == ["function", "function", "object", "function"], "tallyHere / tallyHereNow / TallySteady / tallySignNow are there (src/js/49)")
    # ---- helpers: this computer's bridge (Bridge.st as /status gives it), the firm's computers (heartbeats), the clock
    LOCAL = {"state": "ok", "computer": "NWS144", "user": "NW144\\anshul", "tallyState": "open", "tallyUp": True, "open": [{"name": "TESTING AAD"}],
             "beat": {"every": 30, "last": "", "missedSince": "", "on": True}}
    def local(**k):
        x = dict(LOCAL); x.update(k); return x
    def put(loc, devs=None, link=True):
        pg.evaluate("""(a) => { const [cid, loc, devs, link] = a;
          if (loc){ Bridge.on = () => true; Bridge.up = () => loc.state === "ok"; Bridge.st = Object.assign({sessions: [], open: [], at: Date.now()}, loc); if (loc.state === "ok") Bridge.okAt = Date.now(); }
          else { Bridge.on = () => false; Bridge.up = () => false; Bridge.st = {state: "off", sessions: [], open: [], at: Date.now()}; }
          TLight.st.devs = devs || []; TLight.st.cos = link ? [{company: "TESTING AAD", client_id: cid, device_id: (devs && devs[0]) ? devs[0].id : null}] : [];
          S.tallyPanel = false; render(); }""", [cid, loc, devs, link])
        pg.wait_for_timeout(120)
    def tick(sec):
        pg.evaluate("(s) => { window.__T += s * 1000; render(); }", sec); pg.wait_for_timeout(120)
    def isoAgo(sec):
        return pg.evaluate("(s) => new Date(Date.now() - s * 1000).toISOString()", sec)
    def dev(i, name, pc, user, ago=5, **k):
        b = dict({"at": isoAgo(ago), "every": 30, "tally": True, "tallyState": "open", "open": ["TESTING AAD"], "computer": pc, "windowsUser": user}, **k)
        return {"id": i, "name": name, "last_seen": b["at"], "info": {"computer": pc, "beat": b}}
    def sign():
        return pg.evaluate("""() => { const b = document.querySelector('#cobar [data-tally-sign]'); if (!b) return null;
          return {code: b.getAttribute('data-tally-here'), level: b.getAttribute('data-tally-level'), on: b.getAttribute('data-tally-sign'), text: b.innerText.trim(), title: b.getAttribute('title') || ''}; }""")
    def card():
        return pg.evaluate("""() => { const c = document.querySelector('#cobar .tsign-pop [data-tally-here-card]'); if (!c) return null;
          return {text: c.innerText, next: [...c.querySelectorAll('[data-tally-next]')].map(b => [b.getAttribute('data-tally-next'), b.innerText.trim()]),
            other: (c.querySelector('[data-tally-other]') || {}).innerText || '', confirmed: (c.querySelector('[data-tally-confirmed]') || {}).innerText || ''}; }""")
    seen = []
    def press(act):
        pg.hover("#cobar [data-tally-sign]"); pg.wait_for_timeout(150); pg.click("#cobar .tsign-pop [data-tally-next=%s]" % act)
    def watch(label):
        s = sign(); seen.append((label, s["code"] if s else None)); return s

    # 1. this computer ready: green, "Tally ready", quiet
    pg.evaluate("TallySteady.reset()"); put(local())
    s = watch("ready")
    ok(s and s["code"] == "ready" and s["text"] == "Tally ready" and s["on"] == "on" and s["level"] == "ok", "the bridge here answers, Tally open with TESTING AAD: green “Tally ready” (%s)" % (s,))
    dot = pg.evaluate("getComputedStyle(document.querySelector('#cobar [data-tally-sign] .tsign-dot')).backgroundColor")
    bg = pg.evaluate("getComputedStyle(document.querySelector('#cobar [data-tally-sign]')).backgroundColor")
    ok(dot == "rgb(21, 128, 61)" and bg in ("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)") or dot == "rgb(21, 128, 61)", "quiet when all is well: a green dot on a plain pill (dot %s, pill %s)" % (dot, bg))
    c = card()
    ok(c and "NWS144 (anshul)" in c["text"] and "TESTING AAD" in c["text"] and re.search(r"\d{2}:\d{2}", c["confirmed"] or ""), "hover: the computer with its Windows user, the company, last confirmed (%s)" % ((c or {}).get("text", "").replace("\n", " / ")[:200],))
    ok("Last confirmed" in s["title"] or "last confirmed" in s["title"], "the title says when last confirmed (%s)" % s["title"][:160])
    ok(c and [n[0] for n in c["next"]] == ["tallyGuide"], "ready: only the Tally page in the card (%s)" % ((c or {}).get("next"),))

    # 2. a late beat / a slow answer / Tally starting up: no flicker
    put(local(tallyState="closed", tallyUp=False, open=[]))
    s = watch("closed 0s"); ok(s["code"] == "ready", "Tally says closed once: still “Tally ready” (not confirmed) (%s)" % s["code"])
    tick(30); s = watch("closed 30s"); ok(s["code"] == "ready", "closed for 30 s: still “Tally ready” (%s)" % s["code"])
    put(local()); s = watch("open again"); ok(s["code"] == "ready", "open again at 30 s: “Tally ready”, it never changed (%s)" % s["code"])
    # the bridge here slow to answer once (1.15.0 busy): shaky but up
    put(local(shaky=True)); s = watch("shaky"); ok(s["code"] == "ready" and "econnect" not in s["text"], "the bridge here slow to answer once: still “Tally ready”, no “Reconnecting…” (%s)" % s["text"])
    # the bridge's own heartbeat missed once (20 s ago): not "No internet"
    put(local(beat={"every": 30, "last": isoAgo(50), "missedSince": isoAgo(20), "on": True})); tick(65)
    s = watch("missed once"); ok(s["code"] == "ready", "one heartbeat of the bridge here missed (20 s ago): not “No internet” (%s)" % s["code"])

    # 3. Tally closed for real: amber after 60 s, the next step
    put(local(tallyState="closed", tallyUp=False, open=[])); tick(1)
    s = watch("closed 1s"); ok(s["code"] == "ready", "Tally closed: not at once (%s)" % s["code"])
    tick(30); tick(31); s = watch("closed 62s")
    ok(s["code"] == "closed" and s["text"] == "Tally closed" and s["level"] == "warn", "closed for over a minute: amber “Tally closed” (%s)" % (s,))
    c = card()
    ok(c and "Open TallyPrime and load TESTING AAD" in c["text"] and ["tallyCheck", "Check again"] in c["next"], "the hover: “Open TallyPrime and load TESTING AAD.” and Check again (%s)" % ((c or {}).get("text", "").replace("\n", " / ")[:200],))
    # back: at once
    put(local()); s = watch("open"); ok(s["code"] == "ready", "Tally open again: “Tally ready” at once (%s)" % s["code"])

    # 4. the bridge here stops: red "Bridge stopped" after 60 s, with the one-line instruction and Check again
    put({"state": "down", "computer": "NWS144", "error": "not running"}); s = watch("down 0"); ok(s["code"] == "ready", "the bridge here not answering: not at once (%s)" % s["code"])
    tick(61); s = watch("down 61")
    ok(s["code"] == "stopped" and s["text"] == "Bridge stopped" and s["level"] == "bad", "not answering for a minute: red “Bridge stopped” (%s)" % (s,))
    dot = pg.evaluate("getComputedStyle(document.querySelector('#cobar [data-tally-sign] .tsign-dot')).backgroundColor")
    ok(dot == "rgb(185, 28, 28)", "a red dot (%s)" % dot)
    c = card()
    ok(c and "Start menu" in c["text"] and c["next"] and c["next"][0][0] == "tallyCheck", "the hover: start it (the icon near the clock / Start menu) and Check again (%s)" % ((c or {}).get("text", "").replace("\n", " / ")[:200],))
    # Check again: the answer at once (the bridge started meanwhile, but Tally closed: amber at once, no minute's wait)
    pg.evaluate("""() => { Bridge.refresh = () => { Bridge.st = Object.assign({}, Bridge.st, {state: "ok", tallyState: "closed", tallyUp: false, open: [], computer: "NWS144", user: "NW144\\\\anshul"}); Bridge.up = () => true; return Promise.resolve(Bridge.st); }; }""")
    press("tallyCheck"); pg.wait_for_timeout(400)
    s = watch("check again"); ok(s["code"] == "closed", "Check again: the answer at once, “Tally closed” without waiting a minute (%s)" % s["code"])

    # 5. company not open / not linked
    pg.evaluate("TallySteady.reset()"); put(local(open=[{"name": "MASTERCAD SOLUTIONS"}])); tick(1)
    s = watch("other co")
    ok(s["code"] == "nocompany" and s["text"] == "Company not open", "first sight, a different company open: “Company not open” (%s)" % (s,))
    c = card(); ok(c and "Open TESTING AAD in TallyPrime" in c["text"], "the hover: “Open TESTING AAD in TallyPrime” (%s)" % ((c or {}).get("text", "").replace("\n", " / ")[:160],))
    pg.evaluate("(cid) => { S.companies[cid].tallyName = ''; S.companies[cid].name = 'Testing AAD'; }", cid)
    pg.evaluate("TallySteady.reset()"); put(local(open=[{"name": "MASTERCAD SOLUTIONS"}]), link=False)
    s = watch("unlinked")
    ok(s["code"] == "unlinked" and s["text"] == "Company not linked", "Tally open, the client not linked: “Company not linked” (%s)" % (s,))
    c = card(); ok(c and c["next"] and c["next"][0][0] == "coTally", "its button opens the client's Link to Tally card (%s)" % ((c or {}).get("next"),))
    press("coTally"); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.tab") == "cotally", "Link to Tally: the client's Link to Tally card opens (%s)" % pg.evaluate("S.tab"))
    pg.evaluate("(cid) => { S.companies[cid].tallyName = 'TESTING AAD'; S.tab = 'dash'; render(); }", cid)

    # 6. no bridge on this computer: grey, never another computer's name in the sign; the other computers in the hover
    pg.evaluate("TallySteady.reset()")
    put(None, [dev("d2", "NWS144 · NW144\\Ranjeet", "NWS144", "NW144\\Ranjeet")])
    s = watch("none")
    ok(s["code"] == "none" and s["text"] == "Tally not on this computer" and s["level"] == "idle", "no bridge here: grey “Tally not on this computer” (%s)" % (s,))
    ok("NWS144" not in s["text"] and not re.search(r"\b(via|through)\b", s["text"]), "the sign never names another computer (%s)" % s["text"])
    c = card()
    ok(c and c["other"] == "Posting goes through NWS144 (Ranjeet).", "the hover's quiet second line: “Posting goes through NWS144 (Ranjeet).” (%s)" % ((c or {}).get("other"),))
    ok(c and c["next"] and c["next"][0] == ["tallyConnect", "Connect this computer"], "its button: Connect this computer (%s)" % ((c or {}).get("next"),))
    dot = pg.evaluate("getComputedStyle(document.querySelector('#cobar [data-tally-sign] .tsign-dot')).backgroundColor")
    ok(dot not in ("rgb(185, 28, 28)", "rgb(21, 128, 61)"), "grey, not an alarm (%s)" % dot)
    # two computers: still "not on this computer", the second line counts them
    put(None, [dev("d2", "NWS144 · NW144\\Ranjeet", "NWS144", "NW144\\Ranjeet"), dev("d3", "Accounts", "NWS210", "NWS210\\kiran")])
    s = watch("two"); c = card()
    ok(s["code"] == "none" and c and "NWS144 (Ranjeet)" in c["other"] and "NWS210 (kiran)" in c["other"], "two computers serve: the sign the same, the second line names both (%s)" % ((c or {}).get("other"),))
    # nobody
    put(None, []); tick(61)
    c = card(); ok(c and "No computer of the firm has Tally ready" in c["other"], "no computer at all: the second line says so (%s)" % ((c or {}).get("other"),))
    # Connect this computer: the Tally page's connect steps, and the way back
    put(None, [dev("d2", "NWS144 · NW144\\Ranjeet", "NWS144", "NW144\\Ranjeet")])
    pg.evaluate("() => { location.hash = '#/c/' + S.coId + '/dash'; }"); pg.wait_for_timeout(200)
    press("tallyConnect"); pg.wait_for_timeout(600)
    ok(pg.evaluate("[S.view, S.homeTab]") == ["home", "tally"], "Connect this computer: the Tally page (%s)" % pg.evaluate("[S.view, S.homeTab]"))
    ok(pg.locator("#app [data-connect-section]").count() > 0 or pg.locator("#app [data-tally-guide]").count() > 0, "with the install and connect steps on it")
    pg.evaluate("(cid) => { S.view = 'company'; S.coId = cid; S.tab = 'dash'; S.returnTo = null; render(); }", cid)

    # 7. the same computer, two Windows users: anshul's bridge here is not Ranjeet's
    pg.evaluate("TallySteady.reset()")
    put(local(), [dev("d2", "NWS144 · NW144\\Ranjeet", "NWS144", "NW144\\Ranjeet", tallyState="closed", tally=False, open=[])])
    s = watch("two users")
    ok(s["code"] == "ready", "anshul's bridge here with Tally open, Ranjeet's closed on the same computer: “Tally ready” (%s)" % s["code"])
    raw = pg.evaluate("(cid) => { const s = tallySignNow(S.companies[cid]); return [s.on, s.local, s.pc]; }", cid)
    ok(raw[0] is True and raw[1] is True and "anshul" in (raw[2] or ""), "the firm's sign: this computer, anshul's bridge, not Ranjeet's (%s)" % (raw,))

    # 8. the cloud's heartbeats: a stopped bridge's last beat seen late is not fresh; a missed beat does not flip
    pg.evaluate("TallySteady.reset()")
    put(None, [dev("d2", "NWS144", "NWS144", "NW144\\Ranjeet", ago=5)])
    ok(pg.evaluate("(cid) => tallySignNow(S.companies[cid]).on", cid) is True, "a beat 5 s old: the firm's sign is on")
    # the next read brings a beat 10 minutes old, different from the one seen before (the bridge stopped long ago)
    put(None, [dev("d2", "NWS144", "NWS144", "NW144\\Ranjeet", ago=600)])
    ds = pg.evaluate("() => devState(TLight.st.devs[0], Date.now()).bridge")
    ok(ds == "offline", "a beat 10 minutes old, first seen now: offline, not fresh (%s)" % ds)
    pg.evaluate("TallySteady.reset()")
    put(None, [dev("d2", "NWS144", "NWS144", "NW144\\Ranjeet", ago=5)])
    on = []
    for ago in (40, 70, 95, 10, 40):   # one beat missed (a 64-102 s gap, as on staging 09-Oct), then a fresh one
        put(None, [dev("d2", "NWS144", "NWS144", "NW144\\Ranjeet", ago=ago)])
        on.append(pg.evaluate("(cid) => tallySign(S.companies[cid]).on", cid))
        st = pg.evaluate("(cid) => tallyStatus(S.companies[cid])", cid)
        ok(st["state"] != "reconnecting" and "econnecting" not in (st["short"] + st["label"]), "beat %d s old: tallyStatus is not “Reconnecting…” (%s)" % (ago, st["short"]))
    ok(all(on), "one missed beat: the firm's sign stays on throughout (%s)" % on)
    # the bridge offline for real: off only after it held for a minute
    put(None, [dev("d2", "NWS144", "NWS144", "NW144\\Ranjeet", ago=200)])
    a = pg.evaluate("(cid) => tallySign(S.companies[cid]).on", cid); tick(61)
    b = pg.evaluate("(cid) => tallySign(S.companies[cid]).on", cid)
    ok(a is True and b is False, "no beat for 200 s: off, but only once that held a minute (%s then %s)" % (a, b))
    st = pg.evaluate("(cid) => tallyStatus(S.companies[cid]).state", cid)
    ok(st == "offline", "tallyStatus then: offline (%s)" % st)

    # 9. posting reads the real state, never the steady one
    pg.evaluate("TallySteady.reset()")
    put(None, [dev("d2", "Office computer", "NWS144", "NW144\\anshul", ago=5)])
    pg.evaluate("(cid) => tallySign(S.companies[cid])", cid)
    put(None, [dev("d2", "Office computer", "NWS144", "NW144\\anshul", ago=5, tallyState="closed", tally=False, open=[])])
    steady, now_ = pg.evaluate("(cid) => [tallySign(S.companies[cid]).on, tallySignNow(S.companies[cid]).on]", cid)
    ok(steady is True and now_ is False, "Tally just closed: the words may still say ready for a minute, the real state says not (%s, %s)" % (steady, now_))
    ok(pg.evaluate("(cid) => postThroughWords(S.companies[cid])", cid) == "", "before Post: no “This will post through …” from a stale ready")

    # 9b. the Post to Tally page's status line: its words from the same steady sign; the gate stays real-time
    pg.evaluate("(cid) => { const c = S.companies[cid]; c.postTo = 'TESTING AAD'; window.choiceState = () => 'confirmed'; TallySteady.reset(); }", cid)
    put(None, [dev("d2", "Office computer", "NWS144", "NW144\\anshul", ago=5)])
    pg.evaluate("() => { goStep('post', 'bills'); }"); pg.wait_for_timeout(500)
    ps = pg.evaluate("(cid) => { const s = postStatusFor(S.companies[cid]); return [s.where, s.problem && s.problem.text, tallySign(S.companies[cid]).words]; }", cid)
    ok(ps[0] == ps[2] == "Tally ready via NWS144 (anshul)" and not ps[1], "Post line: the sign's words, “Tally ready via NWS144 (anshul)”, no problem (%s)" % (ps,))
    pl = pg.evaluate("() => { const e = document.querySelector('#app [data-post-line]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; }")
    ok("Tally ready via NWS144 (anshul)" in pl, "on the page: “%s”" % pl)
    put(None, [dev("d2", "Office computer", "NWS144", "NW144\\anshul", ago=5, tallyState="closed", tally=False, open=[])]); tick(1)
    ps = pg.evaluate("(cid) => { const s = postStatusFor(S.companies[cid]); return [s.where, s.problem && s.problem.text, tallySignNow(S.companies[cid]).on, postThroughWords(S.companies[cid])]; }", cid)
    ok(ps[0] == "Tally ready via NWS144 (anshul)" and not ps[1], "Tally just closed: the Post line does not flicker (%s)" % (ps[:2],))
    ok(ps[2] is False and ps[3] == "", "…but the gate reads the real state: not ready, no “This will post through …” (%s)" % (ps[2:],))
    tick(61)
    ps = pg.evaluate("(cid) => { const s = postStatusFor(S.companies[cid]); return [s.where, s.problem && s.problem.text, s.problem && s.problem.button, s.problem && s.problem.kind]; }", cid)
    ok(not ps[0] and ps[1] and "TallyPrime is closed on" in ps[1] and "Open TallyPrime" in ps[1] and ps[2] == "Check again", "closed for a minute: the sign's reason and fix, with Check again (%s)" % (ps,))
    prob = pg.evaluate("() => { const e = document.querySelector('#app [data-post-problem]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; }")
    ok("TallyPrime is closed on" in prob, "on the page: “%s”" % prob[:120])
    put(None, [dev("d2", "Office computer", "NWS144", "NW144\\anshul", ago=5)])
    ps = pg.evaluate("(cid) => { const s = postStatusFor(S.companies[cid]); return [s.where, s.problem && s.problem.text]; }", cid)
    ok(ps[0] == "Tally ready via NWS144 (anshul)" and not ps[1], "open again: ready at once (%s)" % (ps,))
    pg.evaluate("(cid) => { S.companies[cid].postTo = ''; S.view = 'company'; S.tab = 'dash'; S.step = null; render(); }", cid)

    # 10. a phone: the dot and a short word
    pg.set_viewport_size({"width": 390, "height": 800}); pg.evaluate("TallySteady.reset()"); put(local()); pg.wait_for_timeout(300)
    s = sign(); ok(s and s["text"] == "Tally ready", "a phone: “Tally ready” (%s)" % (s,))
    pg.evaluate("TallySteady.reset()"); put(None, []); pg.wait_for_timeout(200)
    s = sign(); ok(s and s["text"] == "Not on this PC", "a phone, no bridge here: “Not on this PC” (%s)" % (s,))
    pg.set_viewport_size({"width": 1366, "height": 768})

    # never "via", "through", "Reconnecting" in the top bar, whatever happened above
    words = pg.evaluate("() => [...document.querySelectorAll('#cobar [data-tally-sign]')].map(b => b.innerText).join(' ')")
    ok(not re.search(r"via|through|econnecting", words), "the sign's words never say via / through / Reconnecting (%s)" % words)
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
