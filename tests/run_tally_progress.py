"""python3 run_tally_progress.py [--shots DIR] - everything Tally from the Tally page (next-tally-progress, 07-Nov-2026; the
owner: "the Tally page needs more redesign… I don't want to do anything elsewhere"; the approved design: tallyprog Main /
Client). Made-up firm, login, clients and companies only (the stand-in cloud of run_tally_simple.py).
  1. Coming in from Tally now: hidden while nothing moves; Step 1 · Masters reading "7,560 of 12,195 (62%)" with its bar;
     waiting in the bridge's own words; Step 2 · Entries after masters ("After masters · 1,304 of 2,651"), Pause and Stop
     there (tally_period_pause / tally_period_cancel); "Masters always go first".
  2. The table: Client · Tally company | Connection | Masters | Entries | Action; "✓ 438 ledgers · 52 groups", "✓ Up to
     date", "Up to <day> · N days to bring", "Not brought in yet"; masters missing: Bring ledgers & groups (the masters'
     read), each client's Details.
  3. Details inside the Tally page: Masters (ledgers, groups, whole list last read, changes checked), Entries (12 months,
     Bring books), the Update history from tally_ledger_rounds (a whole list, a changes check, one reading now with its
     total from the last whole list), Bring books' line, the bridge's wait; ‹ Tally back.
  4. a phone (390 px): no sideways scroll, the row a card with Masters and Entries.
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
            os.makedirs(SHOTS, exist_ok=True); pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(600)
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

        print("== 2. the table")
        heads = E("() => [...document.querySelectorAll('#app [data-tsm-table] thead th')].map(e => e.innerText.trim())")
        ok(heads == ["Client · Tally company", "Connection", "Masters (ledgers & groups)", "Entries", "Action"], "2. the columns (%s)" % heads)
        ok(txt(R(ORBIT) + " [data-tpt-co]") == ORB, "2. the Tally company under the client (%s)" % txt(R(ORBIT) + " .tpt-client"))
        mo = txt(R(ORBIT) + " [data-tpg-masters]")
        ok((pg.get_attribute(R(ORBIT) + " [data-tpg-masters]", "data-tpg-masters") == "done") and mo.startswith("✓ 438 ledgers · 52 groups") and "updated " in mo, "2. Orbit: ✓ 438 ledgers · 52 groups · updated HH:MM (%s)" % mo)
        eo = txt(R(ORBIT) + " [data-tpg-entries]")
        ok(eo.startswith("✓ Up to date"), "2. Orbit's entries: ✓ Up to date (%s)" % eo)
        ea = txt(R(ACME) + " [data-tpg-entries]")
        ok(re.match(r"Up to 12-Oct \d+ days to bring", ea), "2. Acme: Up to 12-Oct · N days to bring (%s)" % ea)
        mn = txt(R(NIMB) + " [data-tpg-masters]")
        ok(mn.startswith("Not brought in yet") and n(R(NIMB) + ' [data-tpt-main="masters"]') == 1 and txt(R(NIMB) + ' [data-tpt-main="masters"]') == "Bring ledgers & groups",
           "2. Nimbus: masters not brought in yet, Bring ledgers & groups (%s | %s)" % (mn, txt(R(NIMB) + " .tpt-act")))
        ok(all(n(R(nm) + " [data-tpt-open]") == 1 and txt(R(nm) + " [data-tpt-open]") == "▾" for nm in (KES, ORBIT, ACME, NIMB)), "2. each client its ▾ (details here)")
        ok(n("#app [data-tpg-now]") == 0, "1. nothing coming in: no 'Coming in from Tally now'")
        E("(c) => { window.__fs = 0; }", 0)
        pg.click(R(NIMB) + ' [data-tpt-main="masters"]'); pg.wait_for_timeout(800)
        ok(E("(c) => !!(window.FCRunState && window.FCRunState[c])", cid(NIMB)), "2. Bring ledgers & groups: the masters' read asked (the Update now of From Tally)")

        print("== 1. Coming in from Tally now")
        E("""([c, b]) => { S.tcoSync = S.tcoSync || {}; S.tcoSync[c] = {at: Date.now(), via: 'bridge', company: 'KESTREL TEXTILES', prog: {read: 7560, of: 12195}};
          window.__sum = window.__sum.filter(x => x.book !== b).concat([{book: b, client: c, company: 'KESTREL TEXTILES', from: '2026-04-01', devices: [{id: 'd', fetchOn: true}], pull: {fy: '20260401', part: 'year', state: 'going', x: 1304, y: 2651, etaMin: 12, rate: 113, chosenAt: new Date(Date.now() - 1800000).toISOString(), pace: true}}]);
          if (window.tfxRefresh) window.tfxRefresh(); S.tsm = Object.assign(S.tsm || {}); delete S.tsm.client; render(); }""", [cid(KES), "bk-Kestrel Textiles"]); pg.wait_for_timeout(2500)
        now = "#app [data-tpg-now]"; NL = now + ' [data-tpg-nl="%s"]' % cid(KES)
        ok(n(now) == 1 and txt(now + " h3") == "Coming in from Tally now" and "Masters always go first" in txt(now) and E("() => [...document.querySelectorAll('#app [data-tpg-now] [data-tpg-nl]')].map(e => e.getAttribute('data-tpg-nl'))") == [cid(KES), cid(NIMB)],
           "1. the panel: one line each client being read (Kestrel; Nimbus, its ledgers asked above) (%s)" % txt(now)[:160])
        mw, ew = txt(NL + " [data-tpg-nl-masters]"), txt(NL + " [data-tpg-nl-entries]")
        ok(txt(NL + " .tpg-nl-name") == KES and mw == "Masters · reading 7,560 of 12,195 ledgers" and pg.get_attribute(NL + " [data-tpg-nl-masters] [role=progressbar]", "aria-valuenow") == "62", "1. Masters: its bar, 7,560 of 12,195 ledgers (%s)" % mw)
        ok(ew == "Entries · after masters 1,304 of 2,651 · ~12 min" and n(NL + " [data-tpg-nl-entries] [role=progressbar]") == 1, "1. Entries: after masters, its bar, 1,304 of 2,651 · ~12 min (%s)" % ew)
        ok("left" not in mw and "slow" not in txt(now), "1. no masters time left, no 'ledgers slow in Tally' (no data for them)")
        ok(txt(R(KES) + " [data-tpg-masters]").startswith("Reading · 7,560 of 12,195") and txt(R(KES) + " [data-tpg-entries]").startswith("After masters · 1,304 of 2,651"),
           "2. Kestrel's row: Reading · 7,560 of 12,195 / After masters · 1,304 of 2,651 (%s | %s)" % (txt(R(KES) + " [data-tpg-masters]"), txt(R(KES) + " [data-tpg-entries]")))
        ok(n('#app [data-tpg-drow="%s"]' % cid(KES)) == 1 and n("#app [data-tpg-drow]") == 1 and txt(R(KES) + " [data-tpt-open]") == "Hide details ▴", "2. the client being read: its details open under its row, by default")
        dl = "#app [data-tpg-dl-head]"
        ok(n(dl + " [data-tpg-download]") == 1 and txt(dl + " [data-tpg-latest]") == "Latest bridge 2.5.5 · for Windows, no admin needed" and txt(dl + " [data-tpg-download]") == "Download FinCom Bridge",
           "1. top right: Download FinCom Bridge, the latest version, for Windows, no admin needed (%s)" % txt(dl))
        ok(txt("#app [data-tsm-steps-link]") == "6 steps ▾" and n("#app [data-tsm-top-check]") == 1, "1. the connection card: Check again, 6 steps ▾ (%s)" % txt("#app [data-tsm-top]")[:120])
        E("""() => { const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          window.__rounds['bk-Kestrel Textiles'] = [{round_id: 'k1', started_at: t(2), last_seen_at: t(0.2), rows_received: 7560, rows_read: null, complete: null, batches: 4}]; }""")
        shot("tally-progress-desktop.png", 1360, 1500)
        E("() => { window.__calls = []; }")
        pg.click(NL + " [data-tpg-pause]"); pg.wait_for_timeout(800)
        pg.click(NL + " [data-tpg-stop]"); pg.wait_for_timeout(800)
        cl = [c[0] for c in E("() => window.__calls") if c[0].startswith("tally_period")]
        pz = [c[1] for c in E("() => window.__calls") if c[0] == "tally_period_pause"]
        ok(cl == ["tally_period_pause", "tally_period_cancel"] and pz and pz[0].get("p_pause") is True and pz[0].get("p_book") == "bk-Kestrel Textiles", "1. Pause and Stop on the line (%s %s)" % (cl, pz))
        E("""([c, w]) => { S.tcoSync[c] = {at: Date.now(), via: 'bridge', company: 'KESTREL TEXTILES'}; const d = window.__devs[0]; d.info.beat.keepWait = {reason: 'userInTally', words: w, since: new Date().toISOString()};
          TLight.st.devs = JSON.parse(JSON.stringify(window.__devs)); TCloud.pane.devices = TLight.st.devs; render(); }""", [cid(KES), WAIT]); pg.wait_for_timeout(2500)
        mw = txt(NL + " [data-tpg-nl-masters]")
        ok(mw.startswith("Masters · waiting") and WAIT in mw, "1. masters waiting: the bridge's own words (%s)" % mw)

        print("== 3. details under the row")
        E("""() => { const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          window.__rounds['bk-Orbit Space'] = [
            {round_id: 'r3', started_at: t(1), last_seen_at: t(0.2), rows_received: 120, rows_read: null, complete: null, batches: 1},
            {round_id: 'r2', started_at: t(40), last_seen_at: t(39), rows_received: 4, rows_read: 438, complete: true, batches: 1},
            {round_id: 'r1', started_at: t(600), last_seen_at: t(598), rows_received: 438, rows_read: 438, complete: true, batches: 3}]; }""")
        v0 = E("() => [S.view, location.hash]")
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(2000)
        D = '#app [data-tpg-drow="%s"] [data-tpg-details]' % cid(ORBIT)
        ok(n(D) == 1 and n("#app [data-tpg-drow]") == 1 and n(TB) == 1 and E("() => [S.view, location.hash]") == v0, "3. Orbit's details under its row, one open at a time, the page stays (%s)" % E("() => [S.view, location.hash]"))
        ok([e for e in E("(s) => [...document.querySelectorAll(s + ' > [data-tpg-d], ' + s + ' > [data-tpg-history]')].map(x => x.getAttribute('data-tpg-d') || 'history')", D)] == ["masters", "entries", "history"]
           and E("(s) => getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').length", D) == 3, "3. three cards side by side: Masters, Entries, Update history")
        ok(txt(D + " [data-tpg-d-ledgers]") == "120 of 438" and txt(D + " [data-tpg-d-groups]") == "52", "3. Masters: 120 of 438 reading now (the last whole list's total), groups 52 (%s | %s)" % (txt(D + " [data-tpg-d-ledgers]"), txt(D + " [data-tpg-d-groups]")))
        ok(txt(D + " [data-tpg-d-whole]").endswith("· 438 ledgers") and "every 10 min while open" in txt(D + " [data-tpg-d-light]") and n(D + " [data-tpg-bring]") == 1, "3. whole list last read, changes checked, Bring ledgers & groups (%s)" % txt(D + " [data-tpg-d-whole]"))
        mk = E("() => [...document.querySelectorAll('#app [data-tpg-month]')].map(e => e.getAttribute('data-tpg-month'))")
        ok(len(mk) == 12 and mk[0] == "in" and "later" in mk, "3. Entries: the year's 12 months (%s)" % mk)
        hist = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-h]')].map(r => [r.querySelector('[data-tpg-h-what]').innerText, r.querySelector('[data-tpg-h-res]').innerText])", D)
        res = [h[1] for h in hist]
        ok("Reading · 120 of 438" in res and "4 new or changed" in res and "Whole list read · 438 ledgers" in res and hist[0][0].endswith("Masters · Read"), "3. the Update history from tally_ledger_rounds (%s)" % hist)
        shot("tally-progress-details.png", 1360, 1500)
        # Bring books (this year) and Bring another year, here
        E("() => { window.__calls = []; const rpc = TCloud.rpc; TCloud.rpc = async (fn, a) => { if (/^tally_period_choose/.test(fn)) { window.__calls.push([fn, a]); return {ok: true}; } return rpc(fn, a); }; }")
        pg.click(D + " [data-tpg-bring-books]"); pg.wait_for_timeout(800)
        bb = [c for c in E("() => window.__calls") if c[0].startswith("tally_period_choose")]
        ok(bb and bb[0][0] == "tally_period_choose_lean" and bb[0][1].get("p_book") == "bk-Orbit Space" and bb[0][1].get("p_part") == "year", "3. Bring books: this year's missing days asked (%s)" % bb)
        pg.click(D + " [data-tpg-another-year]"); pg.wait_for_timeout(600)
        ok(n(D + " [data-older-entries] [data-older-fy]") == 1, "3. Bring another year: the year to choose, here")
        # a Day Book file dropped here: From Tally's own reading, for this client, on this page
        E("""() => { window.__tf = []; window.__tfWas = [window.tallyFiles, window.tallyBooksReady];
          window.tallyBooksReady = async (c) => ({ok: true}); window.tallyFiles = async (fs) => { window.__tf.push({cid: S.coId, view: S.view, n: fs.length, name: fs[0] && fs[0].name}); S.tallyUp = {cid: S.coId, busy: false, lines: [{ok: true, text: 'Read: 12 entries (made-up).'}]}; }; }""")
        co0 = E("() => S.coId")
        pg.set_input_files(D + " [data-tpg-drop-file]", files=[{"name": "daybook-made-up.xml", "mimeType": "text/xml", "buffer": b"<ENVELOPE></ENVELOPE>"}]); pg.wait_for_timeout(1200)
        tf = E("() => window.__tf")
        ok(tf and tf[0]["cid"] == cid(ORBIT) and tf[0]["view"] == "home" and tf[0]["name"] == "daybook-made-up.xml" and E("() => S.coId") == co0 and E("() => [S.view, location.hash]") == v0,
           "3. a Day Book file dropped here: read for this client, on this page (%s)" % tf)
        ok("Read: 12 entries (made-up)." in txt(D + " [data-tpg-drop-say]"), "3. its lines said under the box (%s)" % txt(D + " [data-tpg-drop-say]"))
        E("() => { [window.tallyFiles, window.tallyBooksReady] = window.__tfWas; }")
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(600)
        ok(n("#app [data-tpg-drow]") == 0, "3. Hide details: closed")
        # Kestrel's: Bring books paused, the bridge's wait, in its history
        E("() => { window.__sum.find(x => x.pull).pull.state = 'paused'; if (window.tfxRefresh) window.tfxRefresh(); }"); pg.wait_for_timeout(1500)
        pg.click(R(KES) + " [data-tpt-open]"); pg.wait_for_timeout(2000)
        DK = '#app [data-tpg-drow="%s"]' % cid(KES)
        hist = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-h]')].map(r => [r.querySelector('[data-tpg-h-what]').innerText, r.querySelector('[data-tpg-h-res]').innerText])", DK)
        ok(any("Masters · FinCom Bridge" in h[0] and WAIT in h[1] for h in hist) and any("Bring books" in h[0] and h[1].startswith("Paused at 1,304 of 2,651") for h in hist), "3. history: the bridge's wait, Bring books paused (%s)" % hist)
        ok(n(DK + " [data-tpg-resume]") == 1 and n(DK + " [data-tpg-stop]") == 1, "3. Entries: Resume and Stop there")

        print("== 4. a phone")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(800)
        sw = E("() => document.documentElement.scrollWidth")
        ok(sw <= 390, "4. no sideways scroll (%d px)" % sw)
        ok(E("(s) => { const r = document.querySelector(s); return !!r && getComputedStyle(r).display === 'grid'; }", R(ORBIT)) and n(R(ORBIT) + " .tpt-masters") == 1, "4. a row is a card, with Masters and Entries")
        ok(E("(s) => { const d = document.querySelector(s + ' [data-tpg-details]'); return !!d && getComputedStyle(d).gridTemplateColumns.split(' ').length === 1; }", DK), "4. the details: the three cards stacked")
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
