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
        ok(all(n(R(nm) + " [data-tpt-open]") == 1 for nm in (KES, ORBIT, ACME, NIMB)), "2. each client its Details")
        ok(n("#app [data-tpg-now]") == 0, "1. nothing coming in: no 'Coming in from Tally now'")
        E("(c) => { window.__fs = 0; }", 0)
        pg.click(R(NIMB) + ' [data-tpt-main="masters"]'); pg.wait_for_timeout(800)
        ok(E("(c) => !!(window.FCRunState && window.FCRunState[c])", cid(NIMB)), "2. Bring ledgers & groups: the masters' read asked (the Update now of From Tally)")

        print("== 1. Coming in from Tally now")
        E("""([c, b]) => { S.tcoSync = S.tcoSync || {}; S.tcoSync[c] = {at: Date.now(), via: 'bridge', company: 'KESTREL TEXTILES', prog: {read: 7560, of: 12195}};
          window.__sum = window.__sum.filter(x => x.book !== b).concat([{book: b, client: c, company: 'KESTREL TEXTILES', from: '2026-04-01', devices: [{id: 'd', fetchOn: true}], pull: {fy: '20260401', part: 'year', state: 'going', x: 1304, y: 2651, etaMin: 12, rate: 113, chosenAt: new Date(Date.now() - 1800000).toISOString(), pace: true}}]);
          if (window.tfxRefresh) window.tfxRefresh(); render(); }""", [cid(KES), "bk-Kestrel Textiles"]); pg.wait_for_timeout(2500)
        now = "#app [data-tpg-now]"
        ok(n(now) == 1 and txt(now + " h3") == "Coming in from Tally now · " + KES and "Masters always go first" in txt(now), "1. the panel, for the client being read (%s)" % txt(now + " h3"))
        mw = txt(now + " [data-tpg-step=masters]")
        ok("Ledgers: 7,560 of 12,195 (62%)" in mw and "groups: 148" in mw and pg.get_attribute(now + " [data-tpg-step=masters] [role=progressbar]", "aria-valuenow") == "62" and "Reading" in txt(now + " [data-tpg-step=masters] [data-tpg-badge]"),
           "1. Step 1 · Masters: Reading, 7,560 of 12,195 (62%%), its bar, groups (%s)" % mw)
        ew = txt(now + " [data-tpg-step=entries]")
        ok("After masters · 1,304 of 2,651" in ew and "Paused for masters" in ew and "goes on by itself after masters" in ew and "about 12 min left" in ew and "113 entries a minute" in ew,
           "1. Step 2 · Entries: after masters, 1,304 of 2,651, time left, rate (%s)" % ew)
        ok(txt(R(KES) + " [data-tpg-masters]").startswith("Reading · 7,560 of 12,195") and txt(R(KES) + " [data-tpg-entries]").startswith("After masters · 1,304 of 2,651"),
           "2. Kestrel's row: Reading · 7,560 of 12,195 / After masters · 1,304 of 2,651 (%s | %s)" % (txt(R(KES) + " [data-tpg-masters]"), txt(R(KES) + " [data-tpg-entries]")))
        shot("tally-progress-desktop.png", 1360, 1100)
        E("() => { window.__calls = []; }")
        pg.click(now + " [data-tpg-pause]"); pg.wait_for_timeout(800)
        pg.click(now + " [data-tpg-stop]"); pg.wait_for_timeout(800)
        cl = [c[0] for c in E("() => window.__calls") if c[0].startswith("tally_period")]
        pz = [c[1] for c in E("() => window.__calls") if c[0] == "tally_period_pause"]
        ok(cl == ["tally_period_pause", "tally_period_cancel"] and pz and pz[0].get("p_pause") is True and pz[0].get("p_book") == "bk-Kestrel Textiles", "1. Pause and Stop from the Tally page (%s %s)" % (cl, pz))
        # the bridge waits (its keepWait), nothing read yet
        E("""([c, w]) => { S.tcoSync[c] = {at: Date.now(), via: 'bridge', company: 'KESTREL TEXTILES'}; const d = window.__devs[0]; d.info.beat.keepWait = {reason: 'userInTally', words: w, since: new Date().toISOString()};
          TLight.st.devs = JSON.parse(JSON.stringify(window.__devs)); TCloud.pane.devices = TLight.st.devs; render(); }""", [cid(KES), WAIT]); pg.wait_for_timeout(2500)
        mw = txt(now + " [data-tpg-step=masters]")
        ok(WAIT in mw and "Waiting" in txt(now + " [data-tpg-step=masters] [data-tpg-badge]"), "1. masters waiting: the bridge's own words (%s)" % mw)

        print("== 3. Details inside the Tally page")
        E("""() => { const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          window.__rounds['bk-Orbit Space'] = [
            {round_id: 'r3', started_at: t(1), last_seen_at: t(0.2), rows_received: 120, rows_read: null, complete: null, batches: 1},
            {round_id: 'r2', started_at: t(40), last_seen_at: t(39), rows_received: 4, rows_read: 438, complete: true, batches: 1},
            {round_id: 'r1', started_at: t(600), last_seen_at: t(598), rows_received: 438, rows_read: 438, complete: true, batches: 3}]; }""")
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(2000)
        D = "#app [data-tpg-details]"
        ok(n(D) == 1 and txt(D + " [data-tpg-d-name]") == ORBIT and n(TB) == 0 and n("#app [data-tsm-top]") == 1, "3. Details in the Tally page (the top line stays, the table gives way)")
        ok(txt(D + " [data-tpg-d-ledgers]") == "120 of 438 · reading now" and txt(D + " [data-tpg-d-groups]") == "52", "3. Masters: ledgers reading now, 120 of 438 (the last whole list's total), groups 52 (%s | %s)" % (txt(D + " [data-tpg-d-ledgers]"), txt(D + " [data-tpg-d-groups]")))
        ok(txt(D + " [data-tpg-d-badge]") == "Reading now", "3. the Masters badge: Reading now while a round reads (%s)" % txt(D + " [data-tpg-d-badge]"))
        ok(txt(D + " [data-tpg-d-whole]").endswith("· 438 ledgers") and "every 10 min while open" in txt(D + " [data-tpg-d-light]"), "3. whole list last read, changes checked (%s | %s)" % (txt(D + " [data-tpg-d-whole]"), txt(D + " [data-tpg-d-light]")))
        ok(n(D + " [data-tpg-bring]") == 1, "3. Bring ledgers & groups there")
        mk = E("() => [...document.querySelectorAll('#app [data-tpg-month]')].map(e => e.getAttribute('data-tpg-month'))")
        ok(len(mk) == 12 and mk[0] == "in" and "later" in mk, "3. Entries: the year's 12 months, Apr in FinCom, months ahead pale (%s)" % mk)
        ok(n(D + " [data-older-entries]") == 1 and n(D + " [data-older-fy]") == 1, "3. Bring books (another year, Start) inside the details")
        hist = E("() => [...document.querySelectorAll('#app [data-tpg-history] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()))")
        res = [h[3] for h in hist if len(h) == 4]
        ok("Reading · 120 of 438" in res and "4 new or changed" in res and "Whole list read · 438 ledgers" in res and [h[2] for h in hist if len(h) == 4][:3] == ["Read", "Changes check", "Whole list"],
           "3. the Update history from tally_ledger_rounds: reading now, a changes check, a whole list (%s)" % hist)
        shot("tally-progress-details.png", 1360, 1100)
        # Kestrel's details: Bring books' line and the bridge's wait in the history
        pg.click(D + " [data-tpg-back]"); pg.wait_for_timeout(800)
        ok(n(D) == 0 and n(TB) == 1, "3. ‹ Tally: back to the table")
        E("() => { window.__sum.find(x => x.pull).pull.state = 'paused'; if (window.tfxRefresh) window.tfxRefresh(); }"); pg.wait_for_timeout(1500)
        pg.click(R(KES) + " [data-tpt-open]"); pg.wait_for_timeout(2000)
        hist = E("() => [...document.querySelectorAll('#app [data-tpg-history] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()))")
        ok(any(h[1] == "Masters" and h[2] == "FinCom Bridge" and WAIT in h[3] for h in hist if len(h) == 4) and any(h[2] == "Bring books" and h[3].startswith("Paused at 1,304 of 2,651") for h in hist if len(h) == 4),
           "3. history: the bridge's wait, Bring books paused at 1,304 of 2,651 (%s)" % hist)
        ok(n(D + " [data-tpg-resume]") == 1 and n(D + " [data-tpg-stop]") == 1, "3. Entries: Resume and Stop in the details")
        pg.click(D + " [data-tpg-back]"); pg.wait_for_timeout(600)

        print("== 4. a phone")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(800)
        sw = E("() => document.documentElement.scrollWidth")
        ok(sw <= 390, "4. no sideways scroll (%d px)" % sw)
        ok(E("(s) => { const r = document.querySelector(s); return !!r && getComputedStyle(r).display === 'grid'; }", R(ORBIT)) and n(R(ORBIT) + " .tpt-masters") == 1, "4. a row is a card, with Masters and Entries")
        pg.set_viewport_size({"width": 1440, "height": 900})
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
