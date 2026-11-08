"""python3 run_tally_buttons.py - every Tally button ends in something visible (next-buttons, 08-Nov-2026; the owner: "no
button will go unworked — check Tally, connect, bring books, update or anything — everything should work").
For each action on the Tally page (the connection card, the six steps, each row's main button, More ▾ and what it opens,
Advanced) and the Tally buttons elsewhere (the top bar's Tally popover, Books › From Tally), it is clicked and, within 5 s,
words or a change show beside it: done, asked (what happens and when), or why not with the one thing to do. Each in the
failure modes that matter to it: FinCom's cloud not reached, not ready (a migration missing), refusing, not allowing (a
viewer), never answering; no Tally computer picking queued work up in 2 minutes ("Not started: <why>"); a double click
(asked once). No page error and no unhandled promise rejection anywhere. Made-up firm, login, clients and companies only
(the stand-in cloud of run_tally_simple.py / run_tally_progress.py); nothing is sent anywhere.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_buttons.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_BUTTONS_PORT", "9583"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.8", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.8.exe", "sha256": "cd" * 32}}
PC = "SRV01"; UA = PC + "\\made-up-a"
KES, ORBIT, ACME, NIMB, NEWC = "Kestrel Textiles", "Orbit Space", "Acme Traders", "Nimbus Events", "Heron Paper"
KESC, ORB, ACO, NIC, NEWCO = "KESTREL TEXTILES", "ORBIT SPACE", "ACME TRADERS 2025-26", "NIMBUS EVENTS", "HERON PAPER"
# the stand-in cloud's failures, by RPC (or "*"): net (not reached), missing (no such function), denied (a viewer), refuse
# ({ok: false}), hang (never answers); window.__fail = {} is all well
FAIL = """() => { if (window.__failOn) return; window.__failOn = true; window.__fail = {}; const rpc = TCloud.rpc, crpc = Cloud.rpc;
  const wrap = (f) => async (fn, a) => { const m = window.__fail[fn] || window.__fail['*'];
    if (m === 'net') throw new TypeError('Failed to fetch');
    if (m === 'missing') throw new Error('PGRST202: Could not find the function public.' + fn + ' in the schema cache');
    if (m === 'denied') throw new Error('not allowed');
    if (m === 'refuse') { window.__calls.push([fn, a]); return {ok: false, error: 'Made-up refusal'}; }
    if (m === 'hang') { window.__calls.push([fn, a]); return new Promise((y) => { (window.__hangs = window.__hangs || []).push(() => y(f(fn, a))); }); }
    return f(fn, a); };
  TCloud.rpc = wrap(rpc); Cloud.rpc = wrap(crpc); }"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.add_init_script("window.__rej = []; window.addEventListener('unhandledrejection', (e) => { window.__rej.push(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)); });")
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        TB = "#app [data-tsm-table]"
        R = lambda name: TB + ' tr[data-tsm-row="%s"]' % name
        L = lambda name: TB + ' tr[data-tpt-light-of="%s"]' % name
        def mains(name): return E("(s) => [...document.querySelectorAll(s + ' [data-tpt-main]')].map(b => b.getAttribute('data-tpt-main'))", R(name))
        def calls(prefix): return [c for c in E("() => window.__calls || []") if c[0].startswith(prefix)]
        def more(name):
            if not n(L(name)): pg.click(R(name) + " [data-tpt-open]"); pg.wait_for_timeout(600)
        def less(name):
            if n(L(name)): pg.click(R(name) + " [data-tpt-open]"); pg.wait_for_timeout(300)
        # within ms, the selector shows text matching rx (visible); its text, or "" when it never did
        def seen(sel, rx=r"\S", ms=5000):
            try:
                pg.wait_for_function("([s, rx]) => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null && new RegExp(rx).test(e.innerText.replace(/\\s+/g, ' ').trim()))", arg=[sel, rx], timeout=ms)
                return E("([s, rx]) => ([...document.querySelectorAll(s)].find(e => e.offsetParent !== null && new RegExp(rx).test(e.innerText.replace(/\\s+/g, ' ').trim())) || {innerText: ''}).innerText.replace(/\\s+/g, ' ').trim()", [sel, rx])
            except Exception: return ""
        rej0 = [0]
        def no_rejections(what):
            r = E("() => window.__rej.slice()"); new = r[rej0[0]:]; rej0[0] = len(r)
            ok(not new, "%s: no unhandled promise rejection (%s)" % (what, new[:2]))
        def fail(m): E("(m) => { window.__fail = m; }", m)
        def age(prefix, ms=130000): E("([p, ms]) => { const S_ = FCTallyBtn.SAID; Object.keys(S_).forEach(k => { if (k.startsWith(p)) S_[k].at -= ms; }); render(); }", [prefix, ms])
        def forget(prefix): E("(p) => { const S_ = FCTallyBtn.SAID; Object.keys(S_).forEach(k => { if (k.startsWith(p)) delete S_[k]; }); render(); }", prefix)
        # bridge 2.5.10: the bridge's own acknowledgement arrives in a beat (FinCom's broadcast, TLight.beatIn), as the cloud keeps it
        def acks(lst): E("([d, l]) => { TLight.beatIn({device: d, beat: {pickups: l}}); render(); }", [dA["id"], lst])
        def ack(state, kind="period", company=ORB, taken="2026-11-08T05:11:00Z", book="bk-" + ORBIT, **more):
            a = {"company": company, "book": book, "guid": "g-" + company, "kind": kind, "chosenAt": "2026-11-08T05:10:00Z", "takenAt": taken, "state": state, "day": "20261001",
                 "login": "made-up-a", "bridge": "go-7", "seen": "2026-11-08T05:12:30Z"}
            if state == "started": a.update(pickedAt="2026-11-08T10:42:00+05:30", pickedUtc="2026-11-08T05:12:00Z")
            else: a.update(code="typing", words="someone is working in Tally; reading starts once Tally has been left alone for a minute", at="2026-11-08T05:12:10Z")
            a.update(more); return a
        def confirm(yes=True):
            try: pg.wait_for_selector("#confirmBox [data-cbx]", timeout=3000)
            except Exception: return False
            pg.click('#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")); return True

        # the scene (run_tally_progress.py's): one Tally computer online, this login's bridge; Kestrel, Orbit, Nimbus open;
        # Acme open nowhere; Heron Paper open in Tally, no client linked to it (a client of its name exists)
        up = {"port": 9039, "ok": True, "skipped": False, "n": 4, "error": "", "reason": "open"}
        beat = {"bridgePort": 9101, "windowsUser": UA}
        dA = T.dev(7, PC, "made-up-a", tally="open", opened=(KESC, ORB, NIC, NEWCO), version="2.5.8", rec=(KESC, ORB, NIC), beat=beat, ports=[up])
        cos = [{"company": KESC, "client_id": "NAME:" + KES, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
               {"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
               {"company": ACO, "client_id": "NAME:" + ACME, "device_id": dA["id"], "gstin": "", "last_seen": "ago:3000"},
               {"company": NIC, "client_id": "NAME:" + NIMB, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
               {"company": NEWCO, "client_id": None, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"}]
        books = {KES: T.book(KES), ORBIT: T.book(ORBIT), ACME: T.book(ACME), NIMB: T.book(NIMB, ledgers=False, days=False)}
        ids = E(T.SETUP, [[dA], cos, [], "owner", [KES, ORBIT, ACME, NIMB, NEWC], True, books])
        cid = lambda nm: ids[nm]
        E("() => { window.__linksApi = false; }")
        E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {"9101": TS.ping(9101, True, UA, version="2.5.8", bridgeId="go-7")}); E(TS.FORGET); E(TS.MINE, ["", "", ""])
        E("""() => { window.__ledgers = {'bk-Kestrel Textiles': Array.from({length: 900}, (_, i) => ({name: 'L' + i})), 'bk-Orbit Space': Array.from({length: 438}, (_, i) => ({name: 'L' + i})),
            'bk-Acme Traders': Array.from({length: 120}, (_, i) => ({name: 'L' + i}))};
          window.__groups = {'bk-Kestrel Textiles': 48, 'bk-Orbit Space': 52, 'bk-Acme Traders': 30}; window.__sum = [];
          const api = Cloud.api;
          Cloud.api = async (p, o) => { const m = /book_id=eq\\.([^&]+)/.exec(p), bk = m ? decodeURIComponent(m[1]) : '';
            if (/^tally_groups\\?/.test(p)) return Array.from({length: window.__groups[bk] || 0}, (_, i) => ({name: 'G' + i}));
            if (/^tally_ledger_rounds\\?/.test(p)) return [];
            return api(p, o); };
          TCloud.restAll = (u) => Cloud.api(u);
          const rpc = TCloud.rpc;
          TCloud.rpc = async (fn, a) => { if (fn === 'tally_fetch_summary') return {ok: true, books: JSON.parse(JSON.stringify(window.__sum))};
            if (/^tally_period_|^tally_fill_request|^tally_device_period_fetch|^tally_check_request|^tally_want_update/.test(fn)) { window.__calls.push([fn, a]); return {ok: true}; }
            return rpc(fn, a); }; }""")
        E(FAIL)
        E("() => { navHome('clients'); }"); pg.wait_for_timeout(500)
        E("() => { Object.values(TCloud.st || {}).forEach(s => { if (s) delete s.ledN; }); S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
        pg.wait_for_timeout(3500)
        SUM = """([rows]) => { window.__sum = rows; if (window.tfxRefresh) window.tfxRefresh(); render(); }"""
        E(SUM, [[{"book": "bk-" + nm, "client": cid(nm), "company": co, "from": "2026-04-01", "devices": [{"id": dA["id"], "fetchOn": True}]} for nm, co in ((KES, KESC), (ORBIT, ORB), (ACME, ACO))]])
        pg.wait_for_timeout(1500); no_rejections("the page opened")

        print("== 1. the connection card: Check again, How to connect, the six steps' Check again")
        pg.click("#app [data-tsm-top-check]")
        ok(seen("#app [data-tsm-top] [data-tsm-top-check]", r"^Checking…$", 1500) or seen("#app [data-tsm-top-checked]", r"^Checked ", 1500), "1. Check again: 'Checking…' at once")
        ok(seen("#app [data-tsm-top-checked]", r"^Checked \d\d:\d\d", 12000), "1. Check again: 'Checked HH:MM: …' beside it (%s)" % txt("#app [data-tsm-top-checked]"))
        no_rejections("1. Check again")
        # (every part it asks failing: the words all the same)
        # (the cloud not reached, the computers' read never answering: TLight.refresh catches its own failures, so it hangs here)
        fail({"*": "net"}); E("() => { window.__tl0 = TLight.refresh; window.__rp0 = TCloud.refreshPane; TLight.refresh = () => new Promise(() => {}); TCloud.refreshPane = () => new Promise(() => {}); }")
        E("() => { const b = document.querySelector('#app [data-tsm-top-check]'); b.click(); b.click(); }")
        ok(seen("#app [data-tsm-top-checked]", r"^Checked \d\d:\d\d", 15000), "1. Check again with FinCom not reached: still the words (%s)" % txt("#app [data-tsm-top-checked]"))
        E("() => { TLight.refresh = window.__tl0; TCloud.refreshPane = window.__rp0; }"); fail({})
        no_rejections("1. Check again, FinCom not reached, a double click")
        pg.click("#app [data-tsm-steps-link]")
        ok(seen("#app [data-tsm-guide]", r"\S", 3000) != "" and n("#app [data-tsm-guide] [data-tsm-step]") == 6, "1. How to connect: the six steps under the card (%d)" % n("#app [data-tsm-guide] [data-tsm-step]"))
        if n("#app [data-tsm-guide] [data-tsm-recheck]"):
            pg.click("#app [data-tsm-guide] [data-tsm-recheck]")
            ok(seen("#app [data-tsm-guide] [data-checked]", r"^Checked ", 12000), "1. the steps' Check again: its words (%s)" % txt("#app [data-tsm-guide] [data-checked]"))
        pg.click("#app [data-tsm-steps-link]"); pg.wait_for_timeout(400)
        ok(n("#app [data-tsm-guide]") == 0 or txt("#app [data-tsm-steps-link]") == "How to connect", "1. Hide how to connect: the steps fold away")
        no_rejections("1. the six steps")

        print("== 2. Update now, Bring masters, Check again on a row")
        ok(mains(ORBIT) == ["update"], "2. Orbit: Update now (%s)" % mains(ORBIT))
        pg.click(R(ORBIT) + " [data-tsm-update]")
        st = seen(R(ORBIT) + " .tpt-state", r"Updating|Waiting for Tally|Asking Tally|Not (started|updated)", 5000)
        ok(st != "", "2. Update now: the row says it is updating, within 5 s (%s)" % st)
        pg.click(R(ORBIT) + ' [data-tpt-main]', timeout=1500) if n(R(ORBIT) + ' [data-tpt-main]:not([disabled])') else None   # (a second click: nothing more)
        # nothing reported in 2 minutes, the bridge beating with the company open (an older bridge reports no progress):
        # waiting, never "Not started"
        E("(c) => { const m = window.FCRunState[c], x = (S.tcoSync || {})[c]; if (m) m.at -= 130000; if (x) { x.at -= 130000; x.prog = null; x.late = false; x.err = ''; x.end = 0; } render(); }", cid(ORBIT))
        pg.wait_for_timeout(1500)
        ok(not re.search(r"Not started", txt(R(ORBIT) + " .tpt-state")) and txt(R(ORBIT) + " [data-tpt-state]") in ("Updating", "Waiting for Tally"),
           "2. Update now, no progress reported in 2 minutes but the bridge beats with it open: still updating, not 'Not started' (%s)" % txt(R(ORBIT) + " .tpt-state"))
        # evidence: no bridge of the firm heard (its beats 10 minutes old): Not started, with why
        E("() => { window.__devs0 = JSON.parse(JSON.stringify(TLight.st.devs)); TLight.st.devs.forEach(d => { const t = new Date(Date.now() - 600000).toISOString(); d.last_seen = t; if (d.info && d.info.beat) d.info.beat.at = t; }); render(); }")
        late = seen(R(ORBIT) + " [data-tpt-why]", r"^Not (started|updated)", 8000)
        ok(late != "", "2. Update now, no bridge heard and nothing in 2 minutes: 'Not started: <why>' (%s)" % (late or txt(R(ORBIT) + " .tpt-state")))
        E("() => { TLight.st.devs = window.__devs0; render(); }")
        no_rejections("2. Update now")
        # FinCom not reached: said in the row, never a silent row
        E("(c) => { delete window.FCRunState[c]; if (S.tcoSync) delete S.tcoSync[c]; window.__up0 = TCloudUp.post; TCloudUp.post = () => Promise.reject(new TypeError('Failed to fetch')); window.__lk0 = Ledgers.askTally; Ledgers.askTally = () => Promise.reject(new TypeError('Failed to fetch')); render(); }", cid(KES))
        fail({"*": "net"}); pg.wait_for_timeout(400)
        if mains(KES) == ["update"]:
            pg.click(R(KES) + " [data-tsm-update]")
            w = seen(R(KES) + " .tpt-state", r"Updating|Waiting|Asking|Not (started|updated)|Could not", 5000)
            ok(w != "", "2. Update now, FinCom not reached: words in the row within 5 s (%s)" % w)
            w2 = seen(R(KES) + " [data-tpt-why]", r"^Not updated", 12000)
            ok(w2 != "", "2. Update now, FinCom not reached: 'Not updated: …' (%s)" % w2)
        else: ok(False, "2. Kestrel: Update now expected (%s)" % mains(KES))
        fail({}); E("() => { TCloudUp.post = window.__up0; Ledgers.askTally = window.__lk0; }")
        no_rejections("2. Update now, FinCom not reached")
        ok(mains(NIMB) == ["masters"], "2. Nimbus: Bring masters (%s)" % mains(NIMB))
        pg.click(R(NIMB) + ' [data-tpt-main="masters"]')
        ok(seen(R(NIMB) + " .tpt-state, " + R(NIMB) + " [data-tpg-masters]", r"Updating|Waiting|Reading|Asking|Not (started|updated)", 5000) != "", "2. Bring masters: the row says it reads (%s)" % txt(R(NIMB) + " .tpt-state"))
        ok(pg.is_disabled(R(NIMB) + " [data-tpt-main]") is False or bool(pg.get_attribute(R(NIMB) + " [data-tpt-main]", "title")), "2. Bring masters while reading: off with its reason in the title (%s)" % pg.get_attribute(R(NIMB) + " [data-tpt-main]", "title"))
        no_rejections("2. Bring masters")
        ok(mains(ACME) == ["again"], "2. Acme (open nowhere): Check again (%s)" % mains(ACME))
        pg.click(R(ACME) + ' [data-tpt-main="again"]')
        ok(seen(R(ACME) + ' [data-tpt-main="again"]', r"^Checking…$", 1500) != "" or seen(R(ACME) + " [data-checked]", r"^Checked", 1500) != "", "2. Check again (row): 'Checking…' at once")
        ok(seen(R(ACME) + " [data-checked]", r"^Checked ", 15000) != "", "2. Check again (row): its words in the row (%s)" % txt(R(ACME) + " [data-checked]"))
        ok(txt(R(ACME) + " [data-tpt-why]") != "", "2. Check again (row): why the company is not read stays in view (%s)" % txt(R(ACME) + " [data-tpt-why]"))
        no_rejections("2. Check again on a row")

        print("== 3. Bring books: asked, Not started after 2 minutes, every failure, a double click")
        E("(c) => { (TCloud.st[c].books || []).forEach(b => { b.to = '2026-10-12'; }); if (window.FCRunState) delete window.FCRunState[c]; if (S.tcoSync) delete S.tcoSync[c]; render(); }", cid(ORBIT)); pg.wait_for_timeout(900)
        ok(mains(ORBIT) == ["books"], "3. Orbit, days behind: Bring books (%s)" % mains(ORBIT))
        E("() => { window.__calls = []; }")
        E("(s) => { const b = document.querySelector(s); b.click(); b.click(); }", R(ORBIT) + ' [data-tpt-main="books"]')   # (a double click)
        w = seen(R(ORBIT) + ' [data-said="books"]', r"^(Asked|Queued)", 5000)
        ok(w != "", "3. Bring books: what happens and when, beside it within 5 s (%s)" % w)
        ok(len(calls("tally_period_choose")) == 1, "3. Bring books, a double click: asked once (%s)" % calls("tally_period_choose"))
        if w.startswith("Asked"):
            age("books:")
            lw = seen(R(ORBIT) + ' [data-said="books"][data-said-state="late"]', r"^Not started: ", 8000)
            ok(lw != "", "3. Bring books, no Tally computer on it in 2 minutes: 'Not started: <why>' (%s)" % (lw or txt(R(ORBIT) + ' [data-said="books"]')))
            ok(not re.search(r"SRV01|made-up-a|9101|9039|port ", lw), "3. Not started: no computer's name, login or port (%s)" % lw)
            # (once the pull moves: the line goes, the Entries cell says how far)
            forget("books:")
        for mode, rx, what in (("net", r"^Couldn’t reach FinCom", "FinCom not reached"), ("missing", r"not ready for this yet", "a migration missing"),
                               ("denied", r"^Only an owner or staff", "not allowed"), ("refuse", r"^Not started: Made-up refusal\.$", "refused")):
            fail({"tally_period_choose_lean": mode, "tally_period_choose": mode}); forget("books:")
            pg.click(R(ORBIT) + ' [data-tpt-main="books"]')
            w = seen(R(ORBIT) + ' [data-said="books"]', rx, 5000)
            ok(w != "", "3. Bring books, %s: said in plain words within 5 s (%s)" % (what, w or txt(R(ORBIT) + " .tpt-act")))
        fail({"tally_period_choose_lean": "hang"}); forget("books:")
        pg.click(R(ORBIT) + ' [data-tpt-main="books"]')
        ok(seen(R(ORBIT) + ' [data-tpt-main="books"]', r"^Starting…$", 2000) != "" and seen(R(ORBIT) + ' [data-said="books"]', r"Working…", 2000) != "", "3. Bring books, FinCom never answering: 'Starting…' at once")
        ok(seen(R(ORBIT) + ' [data-said="books"][data-said-state="slow"]', r"^Still waiting for FinCom…$", 26000) != "", "3. Bring books, FinCom slow: 'Still waiting for FinCom…' after 20 s (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
        n0 = len(calls("tally_period_choose"))
        pg.click(R(ORBIT) + ' [data-tpt-main="books"]', force=True, timeout=1500)
        ok(pg.is_disabled(R(ORBIT) + ' [data-tpt-main="books"]') and len(calls("tally_period_choose")) == n0, "3. Bring books, still waiting: the button held, no second request (%d)" % len(calls("tally_period_choose")))
        fail({}); E("() => { (window.__hangs || []).splice(0).forEach(f => f()); }")
        ok(seen(R(ORBIT) + ' [data-said="books"]', r"^(Asked|Queued)", 5000) != "", "3. Bring books, the late answer: said when it comes (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
        forget("books:")
        # (migration 135's skip of held days: the new pull counted at once; never "started" by that alone)
        E(SUM, [[{"book": "bk-" + ORBIT, "client": cid(ORBIT), "company": ORB, "from": "2026-04-01", "devices": [{"id": dA["id"], "fetchOn": True}]}]])
        E("""(c) => { window.__choose0 = TCloud.rpc; const r0 = TCloud.rpc; TCloud.rpc = async (fn, a) => { if (/^tally_period_choose/.test(fn)) { window.__calls.push([fn, a]);
            window.__sum = window.__sum.map(b => b.client === c ? Object.assign({}, b, {pull: {fy: '20260401', part: 'year', state: 'going', x: 0, y: 2600, counting: true, countedDays: 40, yearDays: 222, chosenAt: new Date().toISOString(), pace: true}}) : b);
            return {ok: true}; } return r0(fn, a); }; }""", cid(ORBIT))
        pg.click(R(ORBIT) + ' [data-tpt-main="books"]')
        ok(seen(R(ORBIT) + ' [data-said="books"]', r"^Asked", 5000) != "", "3. Bring books, held days counted at once: 'Asked: …' (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
        pg.wait_for_timeout(2500); age("books:")
        ok(seen(R(ORBIT) + ' [data-said="books"][data-said-state="late"]', r"^Not started: ", 8000) != "", "3. Bring books, only held days counted in 2 minutes: still 'Not started: <why>' (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
        E("(c) => { window.__sum = window.__sum.map(b => b.client === c ? Object.assign({}, b, {pull: Object.assign({}, b.pull, {countedDays: 45})}) : b); if (window.tfxRefresh) window.tfxRefresh(); render(); }", cid(ORBIT))
        pg.wait_for_timeout(2500)
        ok(n(R(ORBIT) + ' [data-said="books"]') == 0, "3. Bring books, the count moves past the first seen: the line goes (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
        E("() => { TCloud.rpc = window.__choose0; }")
        fail({}); forget("books:")
        E(SUM, [[{"book": "bk-" + nm, "client": cid(nm), "company": co, "from": "2026-04-01", "devices": [{"id": dA["id"], "fetchOn": True}]} for nm, co in ((KES, KESC), (ORBIT, ORB), (ACME, ACO))]]); pg.wait_for_timeout(1500)
        no_rejections("3. Bring books")
        print("== 3b. Bring books: the bridge's own acknowledgement (bridge 2.5.10)")
        if mains(ORBIT) == ["books"]:
            # an acknowledgement already there before the press (an earlier hand-out): never this press's
            acks([ack("refused", taken="2026-11-08T04:00:00Z", code="posting", words="a posting into Tally goes first; reading follows by itself")]); forget("books:")
            pg.click(R(ORBIT) + ' [data-tpt-main="books"]')
            ok(seen(R(ORBIT) + ' [data-said="books"][data-said-state="asked"]', r"^Asked", 5000) != "", "3b. Bring books, an older acknowledgement only: 'Asked: …' (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
            acks([ack("started")])
            w = seen(R(ORBIT) + ' [data-said="books"][data-said-ack="started"]', r"^Started at 10:42 IST on made-up-a’s Tally\.$", 6000)
            ok(w != "", "3b. Bring books, the bridge took it: 'Started at 10:42 IST on made-up-a’s Tally.' at once (%s)" % (w or txt(R(ORBIT) + ' [data-said="books"]')))
            age("books:")
            ok(seen(R(ORBIT) + ' [data-said="books"][data-said-ack="started"]', r"^Started at ", 6000) != "", "3b. Bring books, started: never 'Not started' after 2 minutes (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
            forget("books:")
            pg.click(R(ORBIT) + ' [data-tpt-main="books"]')
            ok(seen(R(ORBIT) + ' [data-said="books"]', r"^Asked", 5000) != "", "3b. pressed again: 'Asked: …' (the earlier started one is not this press's) (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
            acks([ack("refused", taken="2026-11-08T05:20:00Z")])
            w = seen(R(ORBIT) + ' [data-said="books"][data-said-state="refused"]', r"^Not started: someone is working in Tally; reading starts once Tally has been left alone for a minute\.$", 6000)
            ok(w != "", "3b. Bring books, the bridge could not start: 'Not started: <its own reason>' at once (%s)" % (w or txt(R(ORBIT) + ' [data-said="books"]')))
            ok(not re.search(r"SRV01|9101|9039|port ", w), "3b. its reason: no computer's name or port (%s)" % w)
            acks([ack("started", taken="2026-11-08T05:20:00Z", pickedUtc="2026-11-08T05:21:00Z")])
            ok(seen(R(ORBIT) + ' [data-said="books"][data-said-ack="started"]', r"^Started at 10:51 IST on made-up-a’s Tally\.$", 6000) != "", "3b. then it started: 'Started at 10:51 IST …' (%s)" % txt(R(ORBIT) + ' [data-said="books"]'))
            # an acknowledgement of another kind or company: not this one's; with none, the inference as before
            forget("books:"); pg.click(R(ORBIT) + ' [data-tpt-main="books"]'); seen(R(ORBIT) + ' [data-said="books"]', r"^Asked", 5000)
            acks([ack("started", taken="2026-11-08T05:30:00Z", kind="check"), ack("started", company=KESC, book="bk-" + KES, taken="2026-11-08T05:30:00Z"), ack("started", company=ORB, book="", taken="2026-11-08T05:31:00Z")])
            pg.wait_for_timeout(1200); age("books:")
            lw = seen(R(ORBIT) + ' [data-said="books"][data-said-state="late"]', r"^Not started: ", 8000)
            ok(lw != "" and "made-up-a" not in lw, "3b. no acknowledgement of this work: the inference after 2 minutes, as before (%s)" % (lw or txt(R(ORBIT) + ' [data-said="books"]')))
            forget("books:"); acks([])
        else: ok(False, "3b. Orbit: Bring books expected (%s)" % mains(ORBIT))
        no_rejections("3b. Bring books, acknowledged")

        print("== 4. Bring missing days, Turn on for this computer")
        E("""(c) => { window.__gapWas = Rec.gapFor; Rec.gapFor = (x) => x === c ? [{gap: {since: new Date(Date.now() - 3 * 86400e3).toISOString(), missing: 4}}] : [];
          (TCloud.st[c].books || []).forEach(b => { b.days = 0; b.to = null; b.daysAt = null; }); render(); }""", cid(ORBIT)); pg.wait_for_timeout(2500)
        ok(mains(ORBIT) == ["bring"], "4. days missing, reading older entries on: Bring missing days (%s)" % mains(ORBIT))
        if mains(ORBIT) == ["bring"]:
            E("() => { window.__calls = []; }")
            # (fills of earlier in the day: 5 days done already; this ask queues 2 more)
            E("""(c) => { window.__fill = {total: 5, done: 5, waiting: 0}; const r0 = TCloud.rpc; window.__fillRpc0 = r0;
              TCloud.rpc = async (fn, a) => { if (fn === 'tally_check_ask_status') return {ok: true, asks: [], books: [{book: 'bk-Orbit Space', client: c, fill: JSON.parse(JSON.stringify(window.__fill))}]};
                if (fn === 'tally_fill_request') { window.__calls.push([fn, a]); window.__fill = {total: 7, done: 5, waiting: 2}; return {ok: true, queued: 2, fill: JSON.parse(JSON.stringify(window.__fill))}; } return r0(fn, a); };
              if (window.tfxRefresh) window.tfxRefresh(); }""", cid(ORBIT)); pg.wait_for_timeout(1500)
            E("(s) => { const b = document.querySelector(s); b.click(); b.click(); }", R(ORBIT) + ' [data-tpt-main="bring"]')
            w = seen(R(ORBIT) + ' [data-said="bring"]', r"^(Asked|Queued|Nothing new)", 5000)
            ok(w != "", "4. Bring missing days: what happens and when, within 5 s (%s)" % w)
            ok(len(calls("tally_fill_request")) == 1, "4. Bring missing days, a double click: asked once (%s)" % len(calls("tally_fill_request")))
            if w.startswith("Asked"):
                pg.wait_for_timeout(1500); age("fill:")
                ok(seen(R(ORBIT) + ' [data-said="bring"]', r"^Not started: ", 8000) != "", "4. Bring missing days, earlier fills done but none of this one in 2 minutes: 'Not started: <why>' (%s)" % txt(R(ORBIT) + ' [data-said="bring"]'))
                E("() => { window.__fill = {total: 7, done: 6, waiting: 1}; if (window.tfxRefresh) window.tfxRefresh(); }"); pg.wait_for_timeout(2500)
                ok(seen(R(ORBIT) + ' [data-said="bring"]', r"^Bringing the missing days", 6000) != "", "4. Bring missing days, one more day done: 'Bringing …' (%s)" % txt(R(ORBIT) + ' [data-said="bring"]'))
                E("() => { window.__fill = {total: 7, done: 6, waiting: 0, upload: 1}; if (window.tfxRefresh) window.tfxRefresh(); }"); pg.wait_for_timeout(2500)
                ok(seen(R(ORBIT) + ' [data-said="bring"]', r"^1 day needs a Day Book upload", 6000) != "", "4. Bring missing days, a day Tally could not send: handled, '1 day needs a Day Book upload' (%s)" % txt(R(ORBIT) + ' [data-said="bring"]'))
            E("() => { TCloud.rpc = window.__fillRpc0; if (window.tfxRefresh) window.tfxRefresh(); render(); }"); pg.wait_for_timeout(2000)
            # bridge 2.5.10: the bridge's own acknowledgement of the missing days (kind fill)
            forget("fill:"); pg.click(R(ORBIT) + ' [data-tpt-main="bring"]')
            if seen(R(ORBIT) + ' [data-said="bring"]', r"^Asked", 5000):
                acks([ack("refused", kind="fill", taken="2026-11-08T06:00:00Z", code="posting", words="a posting into Tally goes first; reading follows by itself")])
                ok(seen(R(ORBIT) + ' [data-said="bring"][data-said-state="refused"]', r"^Not started: a posting into Tally goes first; reading follows by itself\.$", 6000) != "",
                   "4. Bring missing days, the bridge could not start: 'Not started: <its reason>' (%s)" % txt(R(ORBIT) + ' [data-said="bring"]'))
                acks([ack("started", kind="fill", taken="2026-11-08T06:00:00Z", pickedUtc="2026-11-08T06:01:00Z")])
                ok(seen(R(ORBIT) + ' [data-said="bring"][data-said-ack="started"]', r"^Started at 11:31 IST on made-up-a’s Tally\.", 6000) != "",
                   "4. Bring missing days, the bridge took them: 'Started at 11:31 IST on made-up-a’s Tally.' (%s)" % txt(R(ORBIT) + ' [data-said="bring"]'))
            else: ok(False, "4. Bring missing days pressed again: 'Asked' (%s)" % txt(R(ORBIT) + ' [data-said="bring"]'))
            forget("fill:"); acks([])
            for mode, rx in (("denied", r"^Only an owner or staff"), ("net", r"^Couldn’t reach FinCom"), ("refuse", r"^Not asked: Made-up refusal\.$")):
                fail({"tally_fill_request": mode}); forget("fill:")
                pg.click(R(ORBIT) + ' [data-tpt-main="bring"]')
                ok(seen(R(ORBIT) + ' [data-said="bring"]', rx, 5000) != "", "4. Bring missing days, %s: said (%s)" % (mode, txt(R(ORBIT) + ' [data-said="bring"]')))
            fail({}); forget("fill:")
        no_rejections("4. Bring missing days")
        E(SUM, [[{"book": "bk-" + ORBIT, "client": cid(ORBIT), "company": ORB, "from": "2026-04-01", "devices": [{"id": dA["id"], "fetchOn": False}]}]]); pg.wait_for_timeout(2500)
        ok(mains(ORBIT) == ["turnon"], "4. reading older entries off, an owner: Turn on for this computer (%s)" % mains(ORBIT))
        if mains(ORBIT) == ["turnon"]:
            fail({"tally_device_period_fetch": "refuse"})
            pg.click(R(ORBIT) + ' [data-tpt-main="turnon"]')
            ok(seen(R(ORBIT) + ' [data-said="turnon"]', r"^Not turned on: Made-up refusal\.$", 5000) != "", "4. Turn on, refused: said (the old code threw in its own success handler) (%s)" % txt(R(ORBIT) + " .tpt-act"))
            fail({}); forget("turnon:")
            pg.click(R(ORBIT) + ' [data-tpt-main="turnon"]')
            ok(seen(R(ORBIT) + ' [data-said="turnon"]', r"^Turned on", 5000) != "", "4. Turn on: 'Turned on: …' (%s)" % txt(R(ORBIT) + " .tpt-act"))
            E(SUM, [[{"book": "bk-" + ORBIT, "client": cid(ORBIT), "company": ORB, "from": "2026-04-01", "devices": [{"id": dA["id"], "fetchOn": True}]}]]); pg.wait_for_timeout(2500)
            ok(mains(ORBIT) != ["turnon"] and n(R(ORBIT) + ' [data-said="turnon"]') == 1 and txt(R(ORBIT) + ' [data-said="turnon"]').startswith("Turned on"),
               "4. Turn on: once on, the row's button changes and 'Turned on …' stays, once (%s | %s)" % (mains(ORBIT), txt(R(ORBIT) + " .tpt-act")))
        no_rejections("4. Turn on for this computer")
        E("() => { Rec.gapFor = window.__gapWas; }")

        print("== 5. Pause / Resume / Stop of Bring books")
        E(SUM, [[{"book": "bk-" + KES, "client": cid(KES), "company": KESC, "from": "2026-04-01", "devices": [{"id": dA["id"], "fetchOn": True}],
                  "pull": {"fy": "20260401", "part": "year", "state": "going", "x": 300, "y": 2600, "etaMin": 12, "rate": 100, "chosenAt": "2026-11-08T03:00:00Z", "pace": True}}]])
        E("(c) => { if (window.FCRunState) delete window.FCRunState[c]; if (S.tcoSync) delete S.tcoSync[c]; render(); }", cid(KES)); pg.wait_for_timeout(1500)
        ok(mains(KES) == ["pause"], "5. Bring books going: Pause is the row's button (%s)" % mains(KES))
        if mains(KES) == ["pause"]:
            fail({"tally_period_pause": "refuse"})
            pg.click(R(KES) + ' [data-tpt-main="pause"]')
            ok(seen(R(KES) + ' [data-said="pull"]', r"^Not done: Made-up refusal\.$", 5000) != "", "5. Pause, refused: said (%s)" % txt(R(KES) + " .tpt-act"))
            fail({"tally_period_pause": "net"})
            pg.click(R(KES) + ' [data-tpt-main="pause"]')
            ok(seen(R(KES) + ' [data-said="pull"]', r"^Couldn’t reach FinCom", 5000) != "", "5. Pause, FinCom not reached: said (%s)" % txt(R(KES) + " .tpt-act"))
            fail({})
            pg.click(R(KES) + ' [data-tpt-main="pause"]')
            ok(seen(R(KES) + ' [data-said="pull"]', r"^Paused\.", 5000) != "", "5. Pause: 'Paused. …' (%s)" % txt(R(KES) + " .tpt-act"))
            more(KES)
            if n(L(KES) + " [data-tpg-stop]"):
                pg.click(L(KES) + " [data-tpg-stop]")
                ok(seen(L(KES) + ' [data-said="pull"]', r"^Stopped\.", 5000) != "", "5. Stop (under More): 'Stopped. …' (%s)" % txt(L(KES)))
            less(KES)
        no_rejections("5. Pause / Stop")
        E(SUM, [[]])

        print("== 6. More ▾ and what it opens; Unlink; the Link pickers")
        more(ORBIT)
        ok(n(L(ORBIT)) == 1 and txt(R(ORBIT) + " [data-tpt-open]") == "Less ▴", "6. More ▾ opens the light row, Less ▴")
        pg.click(L(ORBIT) + " [data-tpt-history]")
        ok(seen(L(ORBIT) + ' [data-tpt-part="history"]', r"\S", 5000) != "", "6. Update history: opens with its rows or why (%s)" % txt(L(ORBIT) + ' [data-tpt-part="history"]')[:100])
        pg.click(L(ORBIT) + " [data-tpg-another-year]")
        ok(seen(L(ORBIT) + ' [data-tpt-part="year"]', r"\S", 5000) != "", "6. Bring another year: never an empty box (%s)" % txt(L(ORBIT) + ' [data-tpt-part="year"]')[:120])
        E(SUM, [[{"book": "bk-" + ORBIT, "client": cid(ORBIT), "company": ORB, "from": "2025-04-01", "devices": [{"id": dA["id"], "fetchOn": True}]}]]); pg.wait_for_timeout(1500)
        if n(L(ORBIT) + " [data-older-start]"):
            E("() => { window.__calls = []; }")
            pg.click(L(ORBIT) + " [data-older-start]")
            w = seen(L(ORBIT) + ' [data-said="older"]', r"^Asked: FinCom brings FY ", 5000)
            ok(w != "", "6. Bring another year › Start: what happens and when (%s)" % w)
            age("older:")
            ok(seen(L(ORBIT) + ' [data-said="older"]', r"^Not started: ", 8000) != "", "6. Start, nothing picked up in 2 minutes: 'Not started: <why>' (%s)" % txt(L(ORBIT) + ' [data-said="older"]'))
            fail({"tally_period_choose_lean": "missing", "tally_period_choose": "missing"}); forget("older:")
            pg.click(L(ORBIT) + " [data-older-start]")
            ok(seen(L(ORBIT) + ' [data-said="older"]', r"not ready for this yet", 5000) != "", "6. Start, a migration missing: said (%s)" % txt(L(ORBIT) + ' [data-said="older"]'))
            fail({}); forget("older:")
        else: ok(False, "6. Bring another year: its Start (%s)" % txt(L(ORBIT) + ' [data-tpt-part="year"]')[:120])
        pg.click(L(ORBIT) + " [data-tpt-daybook]")
        ok(seen(L(ORBIT) + ' [data-tpt-part="daybook"]', r"Day Book", 3000) != "", "6. Upload a Day Book file: the drop box (%s)" % txt(L(ORBIT) + ' [data-tpt-part="daybook"]'))
        pg.click(L(ORBIT) + " [data-tpt-details]")
        ok(seen(L(ORBIT) + " [data-tsm-details]", r"\S", 3000) != "" and txt(L(ORBIT) + " [data-tpt-details]") == "Hide answers", "6. Answers: the answers, Hide answers")
        pg.click(L(ORBIT) + " [data-tpt-details]"); pg.wait_for_timeout(300)
        # Unlink: asked first; no: nothing changes; yes: said
        pg.click(L(ORBIT) + " [data-tpt-unlink]")
        ok(confirm(False), "6. Unlink: asked first")
        pg.wait_for_timeout(400); ok(not n(L(ORBIT) + ' [data-said="unlink"]'), "6. Unlink, no: nothing said, nothing changed")
        fail({"tally_company_link": "net", "tally_link_client": "net", "tally_company_unlink": "net"})
        pg.click(L(ORBIT) + " [data-tpt-unlink]"); confirm(True)
        w = seen(R(ORBIT) + " ~ tr [data-said=\"unlink\"], " + L(ORBIT) + ' [data-said="unlink"], #toast, .toast', r"\S", 6000)
        ok(w != "" or "Not linked" in txt(R(ORBIT)), "6. Unlink, FinCom not reached: said (%s)" % w)
        fail({}); less(ORBIT)
        no_rejections("6. More ▾")
        # Connect (a company open here, a client of its name): the link, then the row is the client's
        row_new = TB + ' tr[data-tsm-row="%s"]' % NEWCO
        if n(row_new) == 0: row_new = R(NEWC)
        if n(row_new + " [data-tpt-main]"):
            mm = E("(s) => document.querySelector(s + ' [data-tpt-main]').getAttribute('data-tpt-main')", row_new)
            pg.click(row_new + " [data-tpt-main]")
            if mm == "link":
                ok(seen(row_new + " [data-tsm-row-pick]", r"\S", 3000) != "", "6. Link: the client picker opens")
                ok(bool(pg.get_attribute(row_new + " [data-tco-relink]", "title")) or not pg.is_disabled(row_new + " [data-tco-relink]"), "6. the picker's Link off until a client is chosen, and says so")
            else:
                w = seen(TB + ' [data-said="link"], ' + R(NEWC) + " .tpt-state", r"Linked|Not linked|Updating|Waiting|Connected", 6000)
                ok(w != "", "6. Connect: linked, or why not (%s)" % w)
        else: ok(False, "6. Heron Paper: a Connect / Link button (%s)" % txt(TB)[:200])
        no_rejections("6. Connect / Link")

        print("== 7. Advanced (for support): Check every client, the owner's release actions")
        pg.click("#app [data-tpt-advanced]"); pg.wait_for_timeout(800)
        ok(n("#app [data-tsm-check]") == 1, "7. Advanced opens: Check every client for changes in Tally")
        fail({"tally_check_request": "net"})
        pg.click("#app [data-tsm-check]")
        ok(seen('#app [data-said="check-all"]', r"not asked: Couldn’t reach FinCom|nothing to compare", 12000) != "", "7. Check every client, FinCom not reached: said beside it (%s)" % txt('#app [data-said="check-all"]'))
        fail({}); forget("checkall")
        pg.click("#app [data-tsm-check]")
        ok(seen('#app [data-said="check-all"]', r"^(Checking \d|The Tally computer is asked|Tally checked)", 12000) != "", "7. Check every client: what it asked (%s)" % txt('#app [data-said="check-all"]'))
        no_rejections("7. Check every client")
        if n("#app [data-release-hold]"):
            pg.click("#app [data-release-hold]")
            ok(confirm(False), "7. Hold version: asked first (with why)")
        no_rejections("7. Advanced")

        print("== 8. Stop posting (this computer's bridge holds a posting)")
        E("""() => { window.__bc0 = Bridge.call; window.__bon = Bridge.on; window.__bup = Bridge.up; Bridge.on = () => true; Bridge.up = () => true;
          Bridge.st = Object.assign({}, Bridge.st || {}, {keepWait: {reason: 'posting', words: 'Waiting: a posting into Tally is going on.'}});
          window.__jobs = [{id: 'job-made-up-1', company: 'KESTREL TEXTILES', status: 'running'}]; window.__cancelFail = true;
          Bridge.call = async (p, b) => { if (p === '/jobs') return {jobs: JSON.parse(JSON.stringify(window.__jobs))};
            if (p === '/jobs/cancel') { if (window.__cancelFail === 'said') throw new Error('made-up job is already done');
              // bridge 2.5.10: a refusal as Bridge.call throws it ({code, message}: the bridge's words), another login's bridge as its own code
              if (window.__cancelFail && window.__cancelFail.words) throw {code: 'bridge', message: window.__cancelFail.words};
              if (window.__cancelFail === 'atTally') { window.__jobs = []; return {ok: true, code: 'postingNow', stopAsked: true, words: 'being posted right now — the part at Tally now finishes first and nothing after it is sent; wait for it to finish, then check Tally'}; }
              if (window.__cancelFail === 'other') throw {code: 'bridge_other_user', message: 'The FinCom Bridge at http://127.0.0.1:9100 is another Windows user’s on this computer'};
              if (window.__cancelFail) throw new TypeError('Failed to fetch'); window.__jobs = []; return {ok: true}; } return window.__bc0(p, b); };
          if (window.FCStuckJobs) { window.FCStuckJobs.at = 0; window.FCStuckJobs.list = null; } render(); }""")
        pg.evaluate("() => window.scrollTo(0, 0)")
        if seen("#app [data-stuck-jobs]", r"Waiting for a posting", 6000):
            pg.click("#app [data-stuck-jobs] [data-stuck-see]"); pg.click("#app [data-stuck-jobs] [data-stuck-cancel]"); confirm(True)
            ok(seen("#app [data-stuck-said]", r"^Not stopped: FinCom Bridge on this computer did not answer", 5000) != "", "8. Stop posting, the bridge not answering: said (%s)" % txt("#app [data-stuck-said]"))
            E("() => { window.__cancelFail = 'said'; }")
            pg.click("#app [data-stuck-jobs] [data-stuck-cancel]"); confirm(True)
            ok(seen("#app [data-stuck-said]", r"^Not stopped: FinCom Bridge said: made-up job is already done\.$", 5000) != "", "8. Stop posting, the bridge refusing: its own answer said (%s)" % txt("#app [data-stuck-said]"))
            # bridge 2.5.10: each refusal's own words (jobs.go cancelWords)
            for words in ("already sent to Tally — it may be in Tally; check Tally before posting it again",
                          "not this computer's posting — FinCom Bridge here has no posting with that number", "not found (already finished) — nothing of it is left to stop here"):
                E("(w) => { window.__cancelFail = {words: w}; }", words)
                pg.click("#app [data-stuck-jobs] [data-stuck-cancel]"); confirm(True)
                ok(seen("#app [data-stuck-said]", "^Not stopped: FinCom Bridge said: " + re.escape(words) + r"\.$", 5000) != "", "8. Stop posting refused, its words: %s (%s)" % (words[:40], txt("#app [data-stuck-said]")))
            # review of 2.5.10 (4): stopped while a part is at Tally: the stop taken (200), the bridge's words said
            E("() => { window.__cancelFail = 'atTally'; }")
            pg.click("#app [data-stuck-jobs] [data-stuck-cancel]"); confirm(True)
            ok(seen("#app [data-stuck-said]", r"^Stop asked\. FinCom Bridge said: being posted right now — the part at Tally now finishes first", 5000) != "", "8. Stop posting while a part is at Tally: 'Stop asked. FinCom Bridge said: being posted right now …' (%s)" % txt("#app [data-stuck-said]"))
            E("() => { window.__jobs = [{id: 'job-made-up-1', company: 'KESTREL TEXTILES', status: 'running'}]; window.FCStuckJobs.at = 0; window.FCStuckJobs.list = null; if (window.FCStuckJobs.saids) delete window.FCStuckJobs.saids['job-made-up-1']; render(); }")
            seen("#app [data-stuck-jobs]", r"Waiting for a posting", 6000)
            if not n("#app [data-stuck-jobs] [data-stuck-cancel]"): pg.click("#app [data-stuck-jobs] [data-stuck-see]")
            E("() => { window.__cancelFail = 'other'; }")
            pg.click("#app [data-stuck-jobs] [data-stuck-cancel]"); confirm(True)
            w = seen("#app [data-stuck-said]", r"^Not stopped: FinCom Bridge said: not allowed from this login", 5000)
            ok(w != "" and "9100" not in w, "8. Stop posting from another login's bridge: 'not allowed from this login' (%s)" % (w or txt("#app [data-stuck-said]")))
            E("() => { window.__cancelFail = false; }")
            pg.click("#app [data-stuck-jobs] [data-stuck-cancel]"); confirm(True)
            ok(seen("#app [data-stuck-said]", r"^Stopped\.", 5000) != "", "8. Stop posting: 'Stopped. …', also once the list is empty (%s)" % txt("#app [data-stuck-said]"))
        else: ok(False, "8. the posting line shows (%s)" % txt("#app [data-tsm-top]")[:200])
        E("() => { Bridge.call = window.__bc0; Bridge.on = window.__bon; Bridge.up = window.__bup; if (Bridge.st) delete Bridge.st.keepWait; render(); }")
        no_rejections("8. Stop posting")

        print("== 8b. the bridge stopped answering, or back by itself (bridge 2.5.10)")
        # (both lists the page reads: TLight's and the Tally pane's, the newer beat of each computer counts)
        E("""() => { window.__devs1 = JSON.parse(JSON.stringify(TLight.st.devs)); window.__pdevs1 = TCloud.pane && TCloud.pane.devices ? JSON.parse(JSON.stringify(TCloud.pane.devices)) : null;
          const t = new Date(Date.now() - 25 * 60000).toISOString();
          [].concat(TLight.st.devs || [], (TCloud.pane && TCloud.pane.devices) || []).forEach(d => { d.last_seen = t; d.info = Object.assign({}, d.info, {beat: Object.assign({}, (d.info || {}).beat, {at: t})}); }); render(); }""")
        hm = E("() => new Date(Date.now() - 25 * 60000 + 5.5 * 3600e3).toISOString().slice(11, 16)")
        w = seen("#app [data-tsm-top] [data-tsm-top-title], #app [data-tsm-top] [data-tsm-top-stopped]", r"^FinCom Bridge on the office Tally computer stopped answering at " + hm + " IST", 6000)
        ok(w != "", "8b. every bridge silent 25 minutes: the top line says so, with the time (%s)" % (w or txt("#app [data-tsm-top]")[:200]))
        top = txt("#app [data-tsm-top]")
        ok("Check that the office Tally computer is on" in top and not re.search(r"SRV01|made-up-a|9101", top), "8b. what to do; no computer's name or login in the top line (%s)" % top[:300])
        E("() => { S.tallyMore = Object.assign({}, S.tallyMore || {}, {support: true}); render(); }")
        ws = seen("#app [data-tsm-support-stopped]", r"^FinCom Bridge on \S+ stopped answering at ", 8000)
        ok(ws != "" and "office Tally computer" not in ws, "8b. Advanced names the computer (%s)" % ws)
        E("() => { S.tallyMore = Object.assign({}, S.tallyMore || {}, {support: false}); render(); }")
        E("""() => { TLight.st.devs = JSON.parse(JSON.stringify(window.__devs1)); const now = new Date().toISOString(), back = new Date(Date.now() - 5 * 60000).toISOString();
          if (window.__pdevs1 && TCloud.pane) TCloud.pane.devices = JSON.parse(JSON.stringify(window.__pdevs1));
          TLight.st.devs.forEach(d => { d.last_seen = now; d.info = Object.assign({}, d.info, {beat: Object.assign({}, (d.info || {}).beat, {at: now}),
            lastStop: {at: new Date(Date.now() - 9 * 60000).toISOString(), back, why: 'stall', log: 'olderEntries', bridge: 'go-7'}}); }); render(); }""")
        hb = E("() => new Date(Date.now() - 5 * 60000 + 5.5 * 3600e3).toISOString().slice(11, 16)")
        ok(seen("#app [data-tsm-top-back]", r"^FinCom Bridge restarted itself at " + hb + r" IST after its heartbeat stopped moving\.$", 6000) != "", "8b. back by itself: 'FinCom Bridge restarted itself at HH:MM IST after …' (%s)" % txt("#app [data-tsm-top]")[:300])
        ok(n("#app [data-tsm-top-stopped]") == 0 and not re.search(r"stopped answering", txt("#app [data-tsm-top]")), "8b. heard now: no stopped line")
        E("() => { TLight.st.devs = window.__devs1; if (window.__pdevs1 && TCloud.pane) TCloud.pane.devices = window.__pdevs1; render(); }")
        no_rejections("8b. the bridge stopped answering")

        print("== 9. a viewer: every button off says why")
        E("() => { S.account.me.role = 'viewer'; render(); }"); pg.wait_for_timeout(800)
        vn = E("(s) => [...document.querySelectorAll(s + ' tr[data-tsm-kind=client] [data-tpt-note]')].map(e => e.innerText.trim())", TB)
        ok(vn and all(v == "View only: an owner or staff of the firm makes changes." for v in vn), "9. a viewer: each row says why there is no button (%s)" % vn[:2])
        E("() => { S.account.me.role = 'owner'; render(); }"); pg.wait_for_timeout(500)

        print("== 10. the top bar's Tally popover: Update now")
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", cid(ORBIT)); pg.wait_for_timeout(1500)
        if n("header.top [data-tally-icon]"):
            pg.click("header.top [data-tally-icon]")
            pop = "header.top [data-tally-pop]"
            if seen(pop + " [data-tally-pop-word]", r"\S", 8000):
                acts = E("(s) => [...document.querySelectorAll(s + ' [data-tally-pop-act]')].map(b => b.getAttribute('data-tally-pop-act'))", pop)
                if acts:
                    E("() => { window.__updWas = window.tallyUpdateNow; window.tallyUpdateNow = () => {}; }")
                    pg.click(pop + " [data-tally-pop-act=%s]" % acts[0])
                    ok(seen(pop + " [data-tally-pop-msg], " + pop + " [data-tally-pop-busy]", r"\S", 5000) != "", "10. the popover's %s: its words in the popover (%s)" % (acts[0], txt(pop + " [data-tally-pop-msg]")))
                    E("() => { window.tallyUpdateNow = window.__updWas; }")
                else: ok(True, "10. the popover has no action in this state (%s)" % txt(pop)[:100])
            else: ok(False, "10. the popover opens")
        else: ok(False, "10. the Tally icon in the top bar")
        no_rejections("10. the popover")

        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        if n("header.top [data-tally-pop]"): pg.click("#app", position={"x": 5, "y": 400}); pg.wait_for_timeout(300)
        print("== 11. Books › From Tally: Update now")
        E("() => { S.books = Object.assign({}, S.books || {}, {vouchers: [{date: '20261001', type: 'Sales', no: '1'}], meta: {}}); S.tab = 'books'; S.booksTab = 'import'; render(); }"); pg.wait_for_timeout(1500)
        if n("#app [data-up-status] ~ [data-update-now], #app .up-status [data-update-now]"):
            fail({"tally_want_update": "net"})
            pg.click("#app .up-status [data-update-now]")
            w = seen("#app [data-update-said]", r"\S", 5000)
            ok(w != "", "11. From Tally's Update now: its result beside it (%s)" % w)
            fail({})
        else: print("  note: Books › From Tally has no Update now in this scene (no linked client books here)")
        no_rejections("11. From Tally")

        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails)); [print("  - " + f) for f in fails]
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
