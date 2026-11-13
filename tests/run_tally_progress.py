"""python3 run_tally_progress.py [--shots DIR] - everything Tally from the Tally page, the simpler page (next-tally-simple2,
07-Nov-2026; the owner's approved "Tally simple page v4"). Made-up firm, login, clients and companies only (the stand-in
cloud of run_tally_simple.py).
  2. The table: Client · Tally company | Masters | Entries | Action; "Tally: <COMPANY>" on every row; Masters "✓ Up to date ·
     438 ledgers · 52 groups · Updated <when>", "Not brought yet · 0 ledgers in FinCom · TDS and GST need these"; Entries
     "✓ Up to date · Last entry <when>", "Up to 12-Oct-2026 · N days to bring", "Not brought yet · Comes after masters"; ONE
     main button a row (Update from Tally, Check again + "Open it in Tally first", Bring masters); no filter chips, no "Coming in
     from Tally now" panel.
  1. Masters reading in the row ("Reading now", its bar, "Reading masters from Tally: 7,560 of 12,195 ledgers… · 148
     groups"), Entries "Next, after
     masters" with its bar; the row's button Pause, Stop under More (tally_period_pause / tally_period_cancel); waiting in
     the bridge's own words; the title and Download FinCom Bridge <version>; the connection card's How to connect.
  3. More ▾: one light row (one open at a time): Entries in FinCom: <range>, Update history from tally_ledger_rounds
     (read only once opened), Bring another year, the Day Book drop box, Answers, Unlink; Bring books as the row's button
     when days are missing; paused: Resume, Stop under More, the history's wait and pause.
  4. a phone (390 px): no sideways scroll, each row a stacked card, its light row inside the screen.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_progress.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_PROGRESS_PORT", "9577"))
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else ''
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.5", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.5.exe", "sha256": "cd" * 32}}
PC = "SRV01"; UA = PC + "\\made-up-a"
KES, ORBIT, ACME, NIMB = "Kestrel Textiles", "Orbit Space", "Acme Traders", "Nimbus Events"
KESC, ORB, ACO, NIC = "KESTREL TEXTILES", "ORBIT SPACE", "ACME TRADERS 2025-26", "NIMBUS EVENTS"
WAIT = "Waiting: someone is working in Tally on this computer. Reading starts once Tally has had no typing or clicks for 15 s."

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2 if SHOTS else 1); pg.on("pageerror", lambda e: errors.append(str(e)))
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
        def shot(name, w, h):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True); pg.set_viewport_size({"width": w, "height": h}); pg.evaluate("() => window.scrollTo(0, 0)"); pg.wait_for_timeout(600)
            pg.screenshot(path=os.path.join(SHOTS, name), full_page=True); pg.set_viewport_size({"width": 1440, "height": 900})

        up = {"port": 9039, "ok": True, "skipped": False, "n": 3, "error": "", "reason": "open"}
        beat = {"bridgePort": 9101, "windowsUser": UA}
        dA = T.dev(7, PC, "made-up-a", tally="open", opened=(KESC, ORB, NIC), version="2.5.5", rec=(KESC, ORB, NIC), beat=beat, ports=[up])
        cos = [{"company": KESC, "client_id": "NAME:" + KES, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
               {"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
               {"company": ACO, "client_id": "NAME:" + ACME, "device_id": dA["id"], "gstin": "", "last_seen": "ago:3000"},
               {"company": NIC, "client_id": "NAME:" + NIMB, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"}]
        A_PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.5", bridgeId="go-7")}
        acme = T.book(ACME); acme[0]["to"] = "2026-10-12"
        books = {KES: T.book(KES), ORBIT: T.book(ORBIT), ACME: acme, NIMB: T.book(NIMB, ledgers=False, days=False)}
        ids = E(T.SETUP, [[dA], cos, [], "owner", [KES, ORBIT, ACME, NIMB], True, books])
        E("() => { window.__linksApi = false; }")
        E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, A_PINGS); E(TS.FORGET); E(TS.MINE, ["", "", ""])
        # the cloud: each book's ledgers and groups (counts), the rounds of the ledgers' reads, Bring books' summary
        E("""() => { window.__ledgers = {'bk-Kestrel Textiles': Array.from({length: 7560}, (_, i) => ({name: 'L' + i})), 'bk-Orbit Space': Array.from({length: 438}, (_, i) => ({name: 'L' + i})),
            'bk-Acme Traders': Array.from({length: 120}, (_, i) => ({name: 'L' + i}))};
          window.__groups = {'bk-Kestrel Textiles': 148, 'bk-Orbit Space': 52, 'bk-Acme Traders': 30}; window.__rounds = {}; window.__sum = [];
          const api = Cloud.api;
          Cloud.api = async (p, o) => { const m = /book_id=eq\\.([^&]+)/.exec(p), bk = m ? decodeURIComponent(m[1]) : '';
            if (/^tally_groups\\?/.test(p)) { window.__groupsAsked = window.__groupsAsked || {}; window.__groupsAsked[bk] = (window.__groupsAsked[bk] || 0) + 1; await new Promise(r => setTimeout(r, 300)); }
            if (/^tally_groups\\?/.test(p)) return Array.from({length: window.__groups[bk] || 0}, (_, i) => ({name: 'G' + i}));
            if (/^tally_ledger_rounds\\?/.test(p)) { window.__roundsAsked = (window.__roundsAsked || 0) + 1; return JSON.parse(JSON.stringify(window.__rounds[bk] || [])); }
            return api(p, o); };
          TCloud.restAll = (u) => Cloud.api(u);
          const rpc = TCloud.rpc;
          TCloud.rpc = async (fn, a) => { if (fn === 'tally_fetch_summary') return {ok: true, books: JSON.parse(JSON.stringify(window.__sum))};
            if (fn === 'tally_period_pause' || fn === 'tally_period_cancel') { window.__calls.push([fn, a]); return {ok: true}; }
            return rpc(fn, a); }; }""")
        # (the counts read while the page opened, before this stand-in: read again)
        E("() => { navHome('clients'); }"); pg.wait_for_timeout(500)
        E("() => { Object.values(TCloud.st || {}).forEach(s => { if (s) delete s.ledN; }); const G = window.FCGroupCounts || {}; Object.keys(G).forEach(k => delete G[k]); S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
        pg.wait_for_timeout(3500)
        cid = lambda nm: ids[nm]
        E("(c) => { window.__sum = [{book: 'bk-Orbit Space', client: c, company: 'ORBIT SPACE', from: '2026-04-01', devices: [{id: 'd', fetchOn: true}]}]; if (window.tfxRefresh) window.tfxRefresh(); }", cid(ORBIT))

        L = lambda name: TB + ' tr[data-tpt-light-of="%s"]' % name
        def mains(name): return E("(s) => [...document.querySelectorAll(s + ' [data-tpt-main]')].map(b => b.getAttribute('data-tpt-main'))", R(name))
        def calls(prefix): return [c for c in E("() => window.__calls || []") if c[0].startswith(prefix)]
        def more(name):
            if not n(L(name)): pg.click(R(name) + " [data-tpt-open]"); pg.wait_for_timeout(700)

        print("== 2. the table (next-tally-simple2: Client · Tally company | Masters | Entries | Action)")
        heads = E("() => [...document.querySelectorAll('#app [data-tsm-table] thead th')].map(e => (e.firstChild && e.firstChild.nodeType === 3 ? e.firstChild.textContent : e.textContent).trim())")
        # (next-tally-filters2: the state, In Tally and Last entry their own columns)
        ok(heads == ["Client · Tally company", "State", "In Tally", "Masters", "Entries", "Last entry", "Action"], "2. the columns (%s)" % heads)
        ok(txt("#app [data-tsm-table] [data-tpt-title]") == "Clients · 4" and n("#app [data-tsm-table] [data-tpt-say]") == 0,
           "2. 'Clients · 4', masters always come first (%s | %s)" % (txt("#app [data-tsm-table] [data-tpt-title]"), txt("#app [data-tsm-table] [data-tpt-say]")))
        cos_ = {KES: KESC, ORBIT: ORB, ACME: ACO, NIMB: NIC}
        ok(all(txt(R(nm) + " .tpt-co-line") == co and txt(R(nm) + " [data-tpt-co]") == co for nm, co in cos_.items()),
           "2. every row: its Tally company under the client (%s)" % [txt(R(nm) + " .tpt-co-line") for nm in cos_])
        ok(n("#app [data-tsm-filter]") == 0 and n("#app .tsm-filters") == 0, "2. no filter chips")
        ok(n("#app [data-tpg-now]") == 0 and "Coming in from Tally now" not in txt("#app [data-tally-simple]") and n("#app [data-tpg-details]") == 0, "2. no 'Coming in from Tally now' panel, no detail cards")
        mo = txt(R(ORBIT) + " [data-tpg-masters]")
        ok(pg.get_attribute(R(ORBIT) + " [data-tpg-masters]", "data-tpg-masters") == "done" and re.match(r"✓ Up to date 438 ledgers · 52 groups Updated (today|yesterday|\d+-\w{3}) \d\d:\d\d$", mo),
           "2. Masters, up to date: ✓ Up to date · 438 ledgers · 52 groups · Updated <when> (%s)" % mo)
        eo = txt(R(ORBIT) + " [data-tpg-entries]")
        ok(re.match(r"✓ Up to date Last entry (today|yesterday|\d+-\w{3}) \d\d:\d\d$", eo), "2. Entries, up to date: ✓ Up to date · Last entry <when> (%s)" % eo)
        ok(mains(ORBIT) == ["update"] and txt(R(ORBIT) + ' [data-tpt-main]') == "Update from Tally", "2. Orbit: Update from Tally (%s)" % mains(ORBIT))
        ea = txt(R(ACME) + " [data-tpg-entries]")
        ok(re.match(r"Up to 12-Oct-2026 \d+ days to bring$", ea), "2. Entries behind: Up to 12-Oct-2026 · N days to bring (%s)" % ea)
        ok(n(R(ACME) + ".tpt-need") == 1 and txt(R(ACME) + " [data-tpt-state]") in ("Not open in Tally", "Not open in Tally on the server") and mains(ACME) == ["again"] and txt(R(ACME) + " [data-tpt-main]") == "Check again"
           and txt(R(ACME) + " [data-tpt-note]") == "Open it in Tally first", "2. Acme (open nowhere, the firm's bridge online): shaded, Not open in Tally, Check again, Open it in Tally first (%s)" % txt(R(ACME) + " .tpt-act"))
        mn = txt(R(NIMB) + " [data-tpg-masters]")
        ok(pg.get_attribute(R(NIMB) + " [data-tpg-masters]", "data-tpg-masters") == "none" and mn == "Not brought yet 0 ledgers in FinCom TDS and GST need these" and "bad" in (pg.get_attribute(R(NIMB) + " [data-tpg-mw]", "class") or ""),
           "2. Masters, never read: red Not brought yet · 0 ledgers in FinCom · TDS and GST need these (%s)" % mn)
        ok(txt(R(NIMB) + " [data-tpg-entries]") == "Not brought yet Comes after masters", "2. Entries before masters: Not brought yet · Comes after masters (%s)" % txt(R(NIMB) + " [data-tpg-entries]"))
        ok(mains(NIMB) == ["masters"] and txt(R(NIMB) + ' [data-tpt-main="masters"]') == "Bring masters", "2. Nimbus: Bring masters (the old Bring ledgers & groups) (%s)" % txt(R(NIMB) + " .tpt-act"))
        ok(all(len(mains(nm)) == 1 for nm in (KES, ORBIT, ACME, NIMB)), "2. one main button a row (%s)" % [mains(nm) for nm in (KES, ORBIT, ACME, NIMB)])
        ok(all(txt(R(nm) + " [data-tpt-open]") == "More ▾" for nm in (KES, ORBIT, ACME, NIMB)) and n(TB + " tr[data-tpt-light]") == 0, "2. each row its More ▾, all closed")
        pg.click(R(NIMB) + ' [data-tpt-main="masters"]'); pg.wait_for_timeout(800)
        ok(E("(c) => !!(window.FCRunState && window.FCRunState[c])", cid(NIMB)), "2. Bring masters: the masters' read asked (the Update from Tally of From Tally)")
        nm_ = txt(R(NIMB) + " [data-tpg-masters]")
        ok(pg.get_attribute(R(NIMB) + " [data-tpg-masters]", "data-tpg-masters") in ("reading", "waiting") and "group" not in nm_, "2 (review 1). a first masters read: no '· N groups' before FinCom holds them (%s)" % nm_)
        ok(txt(R(NIMB) + " [data-tpt-state]") in ("Updating", "Waiting for Tally") and n(R(NIMB) + " .tpt-why") == 0 and mains(NIMB) == ["reading"],
           "2 (review 5). the State cell just '● Updating', the read's words only in the Masters cell (%s | %s)" % (txt(R(NIMB) + " .tpt-st"), nm_))
        # (review 5) "on the server" only once the look on this computer has found no bridge, never while it still looks
        E("() => { window.__cfg0 = Bridge.cfg; const L = FCTallySimple.LOCALB; window.__lb0 = {list: L.list, busy: L.busy, cut: L.cut, blocked: L.blocked}; Bridge.cfg = () => ({}); Object.assign(L, {list: null, busy: true}); render(); }"); pg.wait_for_timeout(300)
        sa = [E("() => FCTallySimple.placeOf()"), txt(R(ACME) + " [data-tpt-state]")]
        E("() => { Object.assign(FCTallySimple.LOCALB, {list: [], busy: false, cut: false, blocked: false}); render(); }"); pg.wait_for_timeout(300)
        sb = [E("() => FCTallySimple.placeOf()"), txt(R(ACME) + " [data-tpt-state]")]
        E("() => { Bridge.cfg = window.__cfg0; Object.assign(FCTallySimple.LOCALB, window.__lb0); render(); }"); pg.wait_for_timeout(300)
        ok(sa == ["unknown", "Not open in Tally"] and sb == ["laptop", "Not open in Tally on the server"], "2 (review 5). still looking: 'Not open in Tally'; no bridge here: '… on the server' (%s %s)" % (sa, sb))

        print("== 1. masters read, entries after masters: in the row itself")
        E("""([c, b]) => { S.tcoSync = S.tcoSync || {}; S.tcoSync[c] = {at: Date.now(), via: 'bridge', company: 'KESTREL TEXTILES', prog: {read: 7560, of: 12195}};
          window.__sum = window.__sum.filter(x => x.book !== b).concat([{book: b, client: c, company: 'KESTREL TEXTILES', from: '2026-04-01', devices: [{id: 'd', fetchOn: true}], pull: {fy: '20260401', part: 'year', state: 'going', x: 1304, y: 2651, etaMin: 12, rate: 113, chosenAt: new Date(Date.now() - 1800000).toISOString(), pace: true}}]);
          if (window.tfxRefresh) window.tfxRefresh(); render(); }""", [cid(KES), "bk-Kestrel Textiles"]); pg.wait_for_timeout(2500)
        mk, ek = txt(R(KES) + " [data-tpg-masters]"), txt(R(KES) + " [data-tpg-entries]")
        ok(pg.get_attribute(R(KES) + " [data-tpg-masters]", "data-tpg-masters") == "reading" and mk == "Reading now Reading masters from Tally: 7,560 of 12,195 ledgers… · 148 groups" and pg.get_attribute(R(KES) + " [data-tpg-masters] [role=progressbar]", "aria-valuenow") == "62",
           "1. Masters reading: Reading now, its bar (62), Reading masters from Tally: 7,560 of 12,195 ledgers… · 148 groups (%s)" % mk)
        ok(ek == "Next, after masters 1,304 of 2,651 · about 12 min" and n(R(KES) + " [data-tpg-entries] [role=progressbar]") == 1, "1. Entries: Next, after masters, its bar, 1,304 of 2,651 · about 12 min (%s)" % ek)
        ok("left" not in mk and "slow" not in txt(R(KES)), "1. no masters time left, no 'ledgers slow in Tally' (no data for them)")
        ok(mains(KES) == ["reading"] and txt(R(KES) + " [data-tpt-main]") == "Reading…" and pg.is_disabled(R(KES) + " [data-tpt-main]"),
           "1 (review 4). masters read, entries only waiting: the row's button the disabled Reading… (%s)" % mains(KES))
        dl = "#app [data-tpg-dl-head]"
        ok(n(dl + " .tpg-title") == 0 and n("#app h2.tpg-title") == 0 and n(dl + " [data-tpg-download]") == 1 and txt(dl + " [data-tpg-download]") == "Download FinCom Bridge 2.5.5"
           and re.match(r"assets/bridge-go/FinComBridge-Setup-2\.5\.5\.exe\?v=cdcdcdcdcdcd$", pg.get_attribute(dl + " [data-tpg-download]", "href") or ""),
           "1 (review 6). no second 'Tally' title; the dark Download FinCom Bridge 2.5.5 (its fingerprinted link) (%s | %s)" % (txt(dl), pg.get_attribute(dl + " [data-tpg-download]", "href")))
        ok(E("(s) => { const h = document.querySelector(s).getBoundingClientRect(), b = document.querySelector(s + ' [data-tpg-download]').getBoundingClientRect(); return Math.abs(h.right - b.right) <= 2 && b.left > h.left + h.width / 2; }", dl),
           "1 (review 6). the Download right-aligned")
        # (the owner's Mac, 08-Nov-2026) the Download never under the sticky top bar, the page scrolled a little or a lot
        DLV = """(y) => { window.scrollTo(0, y); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) || 0, b = document.querySelector('#app [data-tpg-download]').getBoundingClientRect();
          r({y: Math.round(window.scrollY), head: Math.round(h), top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight}); }))); }"""
        for y in (60, 500):
            v = E(DLV, y)
            ok(v["y"] > 0 and v["head"] > 0 and v["top"] >= v["head"] - 1 and v["bottom"] <= v["vh"], "1 (owner's Mac). scrolled %d px: the Download fully below the top bar (%s)" % (y, v))
            if SHOTS and y == 60: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "tally-progress-scrolled.png"))
        E("() => window.scrollTo(0, 0)")
        ok(txt("#app [data-tsm-steps-link]") == "How to connect" and n("#app [data-tsm-top] [data-tsm-top-check]") == 1, "1. the connection card: How to connect, Check again (%s)" % txt("#app [data-tsm-top]")[:120])
        E("""() => { const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          window.__rounds['bk-Kestrel Textiles'] = [{round_id: 'k1', started_at: t(2), last_seen_at: t(0.2), rows_received: 7560, rows_read: null, complete: null, batches: 4}]; }""")
        more(ORBIT); shot("tally-progress-desktop.png", 1360, 1200); pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(400)
        E("() => { window.__calls = []; }")
        more(KES)
        ok(n(L(KES) + " [data-tpg-stop]") == 1 and n(L(KES) + " [data-tpg-pause]") == 1, "1 (review 4). More: Pause and Stop while the masters are read first")
        pg.click(L(KES) + " [data-tpg-pause]"); pg.wait_for_timeout(800)
        pg.click(L(KES) + " [data-tpg-stop]"); pg.wait_for_timeout(800)
        cl = [c[0] for c in calls("tally_period")]
        pz = [c[1] for c in calls("tally_period_pause")]
        ok(cl == ["tally_period_pause", "tally_period_cancel"] and pz and pz[0].get("p_pause") is True and pz[0].get("p_book") == "bk-Kestrel Textiles", "1. Pause and Stop under More (%s %s)" % (cl, pz))
        ok(n(L(KES) + " [data-tpt-masters-more]") == 1, "1 (review 2). More: Bring masters too while Bring books runs")
        E("""([c, w]) => { S.tcoSync[c] = {at: Date.now(), via: 'bridge', company: 'KESTREL TEXTILES'}; const d = window.__devs[0]; d.info.beat.keepWait = {reason: 'userInTally', words: w, since: new Date().toISOString()};
          TLight.st.devs = JSON.parse(JSON.stringify(window.__devs)); TCloud.pane.devices = TLight.st.devs; render(); }""", [cid(KES), WAIT]); pg.wait_for_timeout(2500)
        mw = txt(R(KES) + " [data-tpg-masters]")
        ok(mw.startswith("Waiting") and WAIT in mw and pg.get_attribute(R(KES) + " [data-tpg-masters]", "data-tpg-masters") == "waiting", "1. masters waiting: the bridge's own words (%s)" % mw)

        print("== 3. More ▾: one light row under the row")
        E("""() => { const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          window.__rounds['bk-Orbit Space'] = [
            {round_id: 'r3', started_at: t(1), last_seen_at: t(0.2), rows_received: 120, rows_read: null, complete: null, batches: 1},
            {round_id: 'r2', started_at: t(40), last_seen_at: t(39), rows_received: 4, rows_read: 438, complete: true, batches: 1},
            {round_id: 'r1', started_at: t(600), last_seen_at: t(598), rows_received: 438, rows_read: 438, complete: true, batches: 3}]; }""")
        v0 = E("() => [S.view, location.hash]"); r0 = E("() => window.__roundsAsked || 0")
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(1200)
        ok(n(L(ORBIT)) == 1 and n(TB + " tr[data-tpt-light]") == 1 and txt(R(ORBIT) + " [data-tpt-open]") == "Less ▴" and E("() => [S.view, location.hash]") == v0,
           "3. More ▾ opens one light row under Orbit, one open at a time (Kestrel's closed), Less ▴, the page stays")
        ok(E("() => window.__roundsAsked || 0") == r0, "3. the history is not read until it is opened")
        lt = txt(L(ORBIT) + " .tpt-light-links")
        ok(re.match(r"Entries in FinCom: Apr 2026 – today ", lt) and all(w in lt for w in ("Bring another year", "Upload a Day Book file", "Update history", "Unlink")) and n(L(ORBIT) + " [data-tpg-stop]") == 0,
           "3. the light row: Entries in FinCom: Apr 2026 – today · Bring another year · Upload a Day Book file · Update history · Unlink; no Stop (nothing reading) (%s)" % lt)
        pg.click(L(ORBIT) + " [data-tpt-history]"); pg.wait_for_timeout(1500)
        hist = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-h]')].map(r => [r.querySelector('[data-tpg-h-what]').innerText, r.querySelector('[data-tpg-h-res]').innerText])", L(ORBIT))
        res = [h[1] for h in hist]
        ok("Reading · 120 of 438" in res and "4 new or changed" in res and "Whole list read · 438 ledgers" in res and hist[0][0].endswith("Masters · Read"), "3. Update history, inline, from tally_ledger_rounds (%s)" % hist)
        shot("tally-progress-more.png", 1360, 1200)
        pg.click(L(ORBIT) + " [data-tpg-another-year]"); pg.wait_for_timeout(600)
        ok(n(L(ORBIT) + " [data-older-entries] [data-older-fy]") == 1, "3. Bring another year: the year to choose, inline")
        pg.click(L(ORBIT) + " [data-tpt-daybook]"); pg.wait_for_timeout(600)
        ok(n(L(ORBIT) + " [data-tpg-drop]") == 1 and txt(L(ORBIT) + " [data-tpg-drop]") == "Or drop a Day Book file here" and n(L(ORBIT) + " input[type=file][data-tpg-drop-file]") == 1,
           "3. Upload a Day Book file: the Day Book drop box, inline (%s)" % txt(L(ORBIT) + " [data-tpg-drop]"))
        pg.click(L(ORBIT) + " [data-tpt-details]"); pg.wait_for_timeout(500)
        ok(all(n(L(ORBIT) + ' [data-tsm-details] [data-tsm-col="%s"]' % k) == 1 for k in ("c", "o", "l", "e", "do")), "3. Answers: Linked, Open now, Ledgers, Entries, What to do")
        ok(n(L(ORBIT) + " [data-tpt-unlink]") == 1, "3. Unlink there")
        # (review 2) Bring masters under More: the masters alone read again (runPress without the entries' Update from Tally)
        E("(c) => { window.__upd = []; window.__updWas = window.tallyUpdateNow; window.tallyUpdateNow = (x) => { window.__upd.push(x); }; if (window.FCRunState) delete window.FCRunState[c]; S.tcoSync = S.tcoSync || {}; delete S.tcoSync[c]; render(); }", cid(ORBIT)); pg.wait_for_timeout(300)
        ok(txt(L(ORBIT) + " [data-tpt-masters-more]") == "Bring masters" and mains(ORBIT) == ["update"], "3 (review 2). More: Bring masters (the row's button Update from Tally)")
        pg.click(L(ORBIT) + " [data-tpt-masters-more]"); pg.wait_for_timeout(800)
        ok(E("(c) => !!(window.FCRunState && window.FCRunState[c])", cid(ORBIT)) and E("() => window.__upd") == [], "3 (review 2). Bring masters: the masters' read asked, no entries asked (%s)" % E("() => window.__upd"))
        E("(c) => { window.tallyUpdateNow = window.__updWas; if (window.FCRunState) delete window.FCRunState[c]; delete S.tcoSync[c]; render(); }", cid(ORBIT)); pg.wait_for_timeout(300)
        ok(E("(b) => window.__groupsAsked[b] || 0", "bk-Orbit Space") <= 2, "3 (review B2). the groups' count of a book asked once at a time, not once per part (%s)" % E("(b) => window.__groupsAsked[b] || 0", "bk-Orbit Space"))
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(600)
        ok(n(TB + " tr[data-tpt-light]") == 0 and txt(R(ORBIT) + " [data-tpt-open]") == "More ▾", "3. Less ▴: closed")
        # Bring books: the row's one button when this year's days are missing (and its masters are in)
        E("(c) => { (TCloud.st[c].books || []).forEach(b => { b.to = '2026-10-12'; }); render(); }", cid(ORBIT)); pg.wait_for_timeout(800)
        ok(mains(ORBIT) == ["books"] and txt(R(ORBIT) + " [data-tpt-main]") == "Bring books" and txt(R(ORBIT) + " [data-tpg-entries]").startswith("Up to 12-Oct-2026"), "3. entries behind: Bring books (%s)" % mains(ORBIT))
        E("() => { window.__calls = []; const rpc = TCloud.rpc; TCloud.rpc = async (fn, a) => { if (/^tally_period_choose/.test(fn)) { window.__calls.push([fn, a]); return {ok: true}; } return rpc(fn, a); }; }")
        pg.click(R(ORBIT) + " [data-tpt-main]"); pg.wait_for_timeout(800)
        bb = calls("tally_period_choose")
        ok(bb and bb[0][0] == "tally_period_choose_lean" and bb[0][1].get("p_book") == "bk-Orbit Space" and bb[0][1].get("p_part") == "year", "3. Bring books: this year's missing days asked (%s)" % bb)
        more(ORBIT)
        ok(n(L(ORBIT) + " [data-tpt-update-more]") == 1, "3. More: Update from Tally too, when the row's button is another")
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(300)
        E("(c) => { (TCloud.st[c].books || []).forEach(b => { b.to = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }); render(); }", cid(ORBIT))
        # (the owner's Fingate row, 08-Nov-2026; review of next-tally-simple3) days missing, an upload as the row's action. The
        # upload stays the button where it is the only way; one exception: a computer has the company with reading older
        # entries off, and an owner can turn it on (Turn on for this computer is the button; others: the upload and a note)
        E("""(c) => { window.__gapWas = Rec.gapFor; Rec.gapFor = (x) => x === c ? [{gap: {since: new Date(Date.now() - 3 * 86400e3).toISOString(), missing: 4}}] : [];
          window.__orbBooks = JSON.parse(JSON.stringify(TCloud.st[c].books || [])); (TCloud.st[c].books || []).forEach(b => { b.days = 0; b.to = null; b.daysAt = null; });
          const sm = window.__sum.find(x => x.client === c) || {devices: []}; window.__orbDevs = JSON.parse(JSON.stringify(sm.devices)); sm.devices.forEach(d => { d.fetchOn = false; });
          if (window.tfxRefresh) window.tfxRefresh(); render(); }""", cid(ORBIT)); pg.wait_for_timeout(3000)
        ok(mains(ORBIT) == ["turnon"] and txt(R(ORBIT) + " [data-tpt-main]") == "Turn on for this computer" and n(R(ORBIT) + " [data-tpt-note]") == 0,
           "3 (Fingate, review). reading older entries off, an owner: Turn on for this computer is the button (%s | %s)" % (mains(ORBIT), txt(R(ORBIT) + " .tpt-act")))
        more(ORBIT); pg.click(L(ORBIT) + " [data-tpt-details]"); pg.wait_for_timeout(600)
        ok(n(L(ORBIT) + ' [data-tsm-col="do"] [data-tsm-act="upload"]') == 1 and n(L(ORBIT) + " [data-tpt-daybook]") == 1,
           "3 (Fingate, review). the upload still there for an owner: in Answers, Upload a Day Book file under More (%s)" % txt(L(ORBIT) + ' [data-tsm-col="do"]'))
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(300)
        pg.click(R(ORBIT) + ' [data-tpt-main="turnon"]'); pg.wait_for_timeout(800)
        to = calls("tally_device_period_fetch")
        ok(to and to[-1][1].get("p_on") is True and to[-1][1].get("p_device"), "3 (Fingate, review). Turn on for this computer: tally_device_period_fetch, on (%s)" % to)
        E("(c) => { (window.__sum.find(x => x.client === c) || {devices: []}).devices.forEach(d => { d.fetchOn = false; }); S.account.me.role = 'staff'; if (window.tfxRefresh) window.tfxRefresh(); render(); }", cid(ORBIT)); pg.wait_for_timeout(1500)
        ok(mains(ORBIT) == ["upload"] and txt(R(ORBIT) + " [data-tpt-main]") == "Upload Day Book"
           and txt(R(ORBIT) + " [data-tpt-note]") == "Reading older entries is off for the computer that has this company: an owner can turn it on",
           "3 (Fingate, review). not an owner: Upload Day Book, and the note that an owner can turn reading on (%s)" % txt(R(ORBIT) + " .tpt-act"))
        E("(c) => { S.account.me.role = 'owner'; (window.__sum.find(x => x.client === c) || {}).devices = []; if (window.tfxRefresh) window.tfxRefresh(); render(); }", cid(ORBIT)); pg.wait_for_timeout(1500)
        ok(mains(ORBIT) == ["upload"] and txt(R(ORBIT) + " [data-tpt-main]") == "Upload Day Book" and n(R(ORBIT) + " [data-tpt-note]") == 0,
           "3 (Fingate, review). no computer has the company: Upload Day Book is the button, never Bring books (%s)" % txt(R(ORBIT) + " .tpt-act"))
        # (review) held lines and a held day: the upload is the button even with the company open on a live bridge
        E("""(c) => { (window.__sum.find(x => x.client === c) || {}).devices = window.__orbDevs; window.__ah0 = {heldFor: AlertHub.heldFor, heldDay: AlertHub.heldDay}; window.__nk0 = Rec.needKind; const d = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
          AlertHub.heldFor = (ids) => ids.includes(c) ? [{cid: c, day: d, kind: 'daybook'}] : []; AlertHub.heldDay = (l) => l.day; Rec.needKind = (l) => l.kind || '';
          if (window.tfxRefresh) window.tfxRefresh(); render(); }""", cid(ORBIT)); pg.wait_for_timeout(1500)
        ok(mains(ORBIT) == ["upload"] and txt(R(ORBIT) + " [data-tpt-main]") == "Upload Day Book" and "Upload that day" in txt(R(ORBIT) + " .tpt-st"),
           "3 (Fingate, review). a held day, the company open on a live bridge: Upload Day Book is the button (%s | %s)" % (mains(ORBIT), txt(R(ORBIT) + " .tpt-st")))
        # (review) the held day's note stays in view while a read runs (Update from Tally pressed: the run's words)
        E("""(c) => { S.tcoSync = S.tcoSync || {}; S.tcoSync[c] = {at: Date.now(), via: 'bridge', company: 'ORBIT SPACE', prog: {read: 40, of: 438}}; }""", cid(ORBIT))
        E("(c) => { if (window.FCRunState) window.FCRunState[c] = {at: S.tcoSync[c].at}; render(); }", cid(ORBIT)); pg.wait_for_timeout(1200)
        hs = [txt(R(ORBIT) + " [data-tpt-state]"), txt(R(ORBIT) + " [data-tpt-held]")]
        ok(hs[0] in ("Updating", "Waiting for Tally") and hs[1] == "Tally could not send these entries. Upload that day’s Day Book.",
           "3 (review). a read running: the held day's note stays (%s)" % hs)
        E("""(c) => { Object.assign(AlertHub, window.__ah0); Rec.needKind = window.__nk0; delete S.tcoSync[c]; if (window.FCRunState) delete window.FCRunState[c];
          Rec.gapFor = window.__gapWas; TCloud.st[c].books = window.__orbBooks; (window.__sum.find(x => x.client === c) || {}).devices = window.__orbDevs;
          (window.__sum.find(x => x.client === c) || {devices: []}).devices.forEach(d => { d.fetchOn = true; }); S.tsm.details = {}; if (window.tfxRefresh) window.tfxRefresh(); render(); }""", cid(ORBIT)); pg.wait_for_timeout(2000)
        # (review) Bring books asked and waiting: why, in the Entries cell (reading older entries off on the computer)
        E("""() => { const sm = window.__sum.find(x => x.pull); window.__pull0 = JSON.parse(JSON.stringify(sm)); sm.devices.forEach(d => { d.fetchOn = false; }); sm.pull.state = 'going';
          window.__kSync = S.tcoSync[sm.client]; delete S.tcoSync[sm.client]; if (window.tfxRefresh) window.tfxRefresh(); render(); }"""); pg.wait_for_timeout(1500)
        ew = txt(R(KES) + " [data-tpg-ewait]")
        ok(pg.get_attribute(R(KES) + " [data-tpg-entries]", "data-tpg-entries") == "going" and ew == "Waiting: reading older entries is off for the Tally computer that has this company.",
           "3 (review). Bring books waiting: why, in the Entries cell (%s | %s)" % (pg.get_attribute(R(KES) + " [data-tpg-entries]", "data-tpg-entries"), ew))
        # bridge 2.5.11: waiting for Tally to be free, but the company's computer's bridge can't reach its Tally: the real reason
        OFFW = "Your TallyPrime is open but its connection is off: in TallyPrime press F1 → Settings → Connectivity, set 'TallyPrime acts as' to Both, keep the port, press Ctrl+A to save, then reopen TallyPrime."
        BEATS = "[window.__devs, TLight.st.devs, TCloud.pane.devices].forEach(L => (L || []).forEach(d => { if (d && d.id === id && d.info && d.info.beat) f(d.info.beat); }))"
        E("""([id, w]) => { const sm = window.__sum.find(x => x.pull); sm.devices = [{id, fetchOn: true}]; sm.pull.state = 'going'; sm.pull.pace = false;
          const f = (b) => { b.at = new Date().toISOString(); b.tallyWhy = 'connection off'; b.tallyConnectSay = w; }; %s;
          if (window.tfxRefresh) window.tfxRefresh(); render(); }""" % BEATS, [dA["id"], OFFW]); pg.wait_for_timeout(1500)
        ew = txt(R(KES) + " [data-tpg-ewait]")
        ok(ew == "FinCom Bridge can’t reach your Tally: " + OFFW, "3 (2.5.11). waiting, the bridge can't reach the company's Tally: the bridge's words, not 'Waiting for Tally to be free' (%s)" % ew)
        E("""([id]) => { const f = (b) => { b.tallyConnectSay = ''; b.tallyWhy = 'no Tally running in this login'; }; %s; if (window.tfxRefresh) window.tfxRefresh(); render(); }""" % BEATS, [dA["id"]]); pg.wait_for_timeout(1200)
        ew = txt(R(KES) + " [data-tpg-ewait]")
        ok(ew == "FinCom Bridge can’t reach your Tally: TallyPrime is not open in its Windows login.", "3 (2.5.11). no words from the bridge: its reason in plain words (%s)" % ew)
        E("""([id]) => { const f = (b) => { b.tallyWhy = ''; }; %s; if (window.tfxRefresh) window.tfxRefresh(); render(); }""" % BEATS, [dA["id"]]); pg.wait_for_timeout(1200)
        ew = txt(R(KES) + " [data-tpg-ewait]")
        ok(ew.startswith("Waiting for Tally to be free"), "3 (2.5.11). Tally reachable, only busy: 'Waiting for Tally to be free' as before (%s)" % ew)
        E("""() => { const sm = window.__sum.find(x => x.pull); Object.assign(sm, window.__pull0); if (window.__kSync) S.tcoSync[sm.client] = window.__kSync; if (window.tfxRefresh) window.tfxRefresh(); }"""); pg.wait_for_timeout(1500)
        # Kestrel's: Bring books paused, the bridge's wait, in its history
        E("() => { window.__sum.find(x => x.pull).pull.state = 'paused'; if (window.tfxRefresh) window.tfxRefresh(); }"); pg.wait_for_timeout(1500)
        ok(mains(KES) == ["resume"] and txt(R(KES) + " [data-tpt-main]") == "Resume" and txt(R(KES) + " [data-tpg-entries]").startswith("Paused"), "3. paused: Resume, Entries Paused (%s | %s)" % (mains(KES), txt(R(KES) + " [data-tpg-entries]")))
        more(KES); pg.click(L(KES) + " [data-tpt-history]"); pg.wait_for_timeout(2000)
        hist = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-h]')].map(r => [r.querySelector('[data-tpg-h-what]').innerText, r.querySelector('[data-tpg-h-res]').innerText])", L(KES))
        ok(any("Masters · FinCom Bridge" in h[0] and WAIT in h[1] for h in hist) and any("Bring books" in h[0] and h[1].startswith("Paused at 1,304 of 2,651") for h in hist), "3. history: the bridge's wait, Bring books paused (%s)" % hist)
        ok(n(L(KES) + " [data-tpg-stop]") == 1 and n(L(KES) + " [data-tpg-resume]") == 0 and n(L(KES) + " [data-tpt-masters-more]") == 1, "3. More: Stop and Bring masters (Resume is the row's button)")
        # the masters read done: Bring books going is Pause (the row's button); stopped: Bring books again (review 3)
        E("""(c) => { S.tcoSync[c] = {at: Date.now() - 60000, via: 'bridge', company: 'KESTREL TEXTILES', end: Date.now()}; if (window.FCRunState) delete window.FCRunState[c];
          [window.__devs, TLight.st.devs, TCloud.pane.devices].forEach(L => (L || []).forEach(d => { if (d && d.info && d.info.beat) delete d.info.beat.keepWait; }));
          window.__sum.find(x => x.pull).pull.state = 'going'; if (window.tfxRefresh) window.tfxRefresh(); render(); }""", cid(KES)); pg.wait_for_timeout(1800)
        ok(mains(KES) == ["pause"] and txt(R(KES) + " [data-tpt-main]") == "Pause" and txt(R(KES) + " [data-tpg-entries]").startswith("Bringing now"), "3. entries running (masters done): Pause is the row's button (%s | %s)" % (mains(KES), txt(R(KES) + " [data-tpg-entries]")))
        E("() => { window.__sum.find(x => x.pull).pull.state = 'stopped'; if (window.tfxRefresh) window.tfxRefresh(); render(); }"); pg.wait_for_timeout(1800)
        ok(mains(KES) == ["books"] and txt(R(KES) + " [data-tpt-main]") == "Bring books" and txt(R(KES) + " [data-tpg-entries]").startswith("Stopped"), "3 (review 3). Bring books stopped: Bring books again, not Update from Tally (%s | %s)" % (mains(KES), txt(R(KES) + " [data-tpg-entries]")))

        print("== 3b (review B1)")
        # B1: the ledgers' count not read: "—", never "0 ledgers"
        E("""(c) => { const st = TCloud.st[c]; window.__ledN = st.ledN; delete st.ledN; window.__lstat = Ledgers.status; Ledgers.status = () => ({n: 0}); render(); }""", cid(ACME)); pg.wait_for_timeout(300)
        b1 = txt(R(ACME) + " [data-tpg-masters]")
        ok(b1.startswith("✓ Up to date — ledgers · 30 groups") and "0 ledgers" not in b1, "3b (B1). the count not known yet: '— ledgers', never '0 ledgers' (%s)" % b1)
        E("() => { Ledgers.status = window.__lstat; }")

        print("== 4. a phone")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(800)
        sw = E("() => document.documentElement.scrollWidth")
        ok(sw <= 390, "4. no sideways scroll (%d px)" % sw)
        dp = E("() => { const h = document.querySelector('#app .tpg-dl-head'); return h ? getComputedStyle(h).position : ''; }")
        ok(dp == "static", "4 (review). a phone: the Download row scrolls with the page, not kept under the top bar (%s)" % dp)
        ok(E("(s) => { const r = document.querySelector(s); return !!r && getComputedStyle(r).display === 'grid'; }", R(ORBIT)) and n(R(ORBIT) + " .tpt-masters") == 1, "4. a row is a stacked card, with Masters and Entries")
        ok(E("(s) => { const a = document.querySelector(s + ' .tpt-client'), b = document.querySelector(s + ' .tpt-masters'); return !!a && !!b && b.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 1; }", R(ORBIT)), "4. Masters under the client, not beside it")
        ok(n(L(KES)) == 1 and E("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.right <= 390 && r.left >= 0; }", L(KES)), "4. the light row a part of the card, inside the screen")
        hs = E("() => [...document.querySelectorAll('#app [data-tsm-table] [data-tpt-main]')].map(b => Math.round(b.getBoundingClientRect().height))")
        ok(hs and min(hs) >= 44, "4. each main button at least 44 px (%s)" % hs)
        if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.wait_for_timeout(400); pg.screenshot(path=os.path.join(SHOTS, "tally-progress-phone.png"), full_page=True)
        pg.set_viewport_size({"width": 1440, "height": 900})
        print("== 5 (the owner's Mac: 'showing blank'). No bridge on this computer: the page draws within 1 s, from the cloud")
        for mode in ("unreachable", "never answers"):
            p2 = br.new_page(viewport={"width": 1440, "height": 900}); p2.on("pageerror", lambda e: errors.append(str(e)))
            p2.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
            held = []
            if mode == "unreachable": p2.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
            else: p2.route("http://127.0.0.1:*/**", lambda r: held.append(r))   # (Safari's mixed-content hold, a firewall: never settles)
            p2.goto("http://localhost:%d/" % PORT); p2.wait_for_timeout(2500)
            p2.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); p2.wait_for_timeout(800)
            E2 = lambda js, *a: p2.evaluate(js, *a)
            o1 = T.dev(5, "NW144", "made-up-o1", tally="open", opened=(ORB,), version="2.5.5", rec=(ORB,), beat={"bridgePort": 9101, "windowsUser": "NW144\\made-up-o1"}, ports=[up])
            E2("() => { window.__t0 = performance.now(); }")
            E2(T.SETUP, [[o1], [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": o1["id"], "gstin": "", "last_seen": "ago:0.5"}], [], "owner", [ORBIT], True, {ORBIT: T.book(ORBIT)}])
            try:
                p2.wait_for_function("""() => document.querySelector('#app [data-tsm-table] tr[data-tsm-row] [data-tpg-masters]') && document.querySelector('#app [data-tpg-download]') && document.querySelector('#app [data-tsm-top]')
                  ? (window.__t1 = window.__t1 || performance.now()) : false""", polling="raf", timeout=8000); drew = True
            except Exception: drew = False
            ms = E2("() => Math.round((window.__t1 || 1e9) - window.__t0)")
            ok(drew and ms <= 1000, "5. the local bridge %s: the Tally page drawn in %d ms (table, masters, Download, top line)" % (mode, ms))
            p2.wait_for_timeout(6000)
            top = re.sub(r"\s+", " ", p2.inner_text("#app [data-tsm-top]")) if p2.locator("#app [data-tsm-top]").count() else ""
            ok("No bridge on this computer" in top and p2.locator("#app [data-tpg-download]").count() == 1, "5. %s: the local check says No bridge on this computer, Download stays (%s)" % (mode, top[:160]))
            for r in held:
                try: r.abort()
                except Exception: pass
            p2.unroute_all(behavior="ignoreErrors"); p2.close()
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
