"""python3 run_masters_states.py [--shots DIR] [--prefix NAME] - the Tally page's Masters line (next-fix-mastersread; the owner:
"how would I know whether ledgers or masters are being read — it is in the dark"). Made-up firm, login, clients and
companies only (the stand-in cloud of run_tally_simple.py / run_tally_progress.py). Each linked client's Masters line is
exactly one of four plain states:
  1. Reading from Tally now · 1,240 ledgers so far (a moving bar: no total known, none asked for)
  2. ✓ Up to date · 438 ledgers · 52 groups · Checked today HH:MM (item 8), or Not checked today: <why>
  3. Waiting: open <company> in your own Tally | Waiting: Tally is busy, it reads when typing stops
  4. Not read: <Tally's own words> (one line), only when a read failed (tally_books.state.trouble.why)
and for the failed first read (staging, a shared Windows server: Masters "Not brought yet", Entries "Bringing now ·
counting the year in Tally" with a 0 bar, "Nothing. It is coming in by itself."): Entries "Next, after masters · Starts
once the masters are in" with no bar, the row's button Bring masters, and what to do: the reason and "Open <company> in
your own Tally and press Bring masters."
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_masters_states.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("MASTERS_STATES_PORT", "9583"))
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else ''
PREFIX = sys.argv[sys.argv.index('--prefix') + 1] if '--prefix' in sys.argv else 'after'
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.16", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.16.exe", "sha256": "cd" * 32}}
PC = "SRV01"; UA = PC + "\\made-up-a"
ORBIT, ACME, KES, FAL, NIMB, LOTUS = "Orbit Space", "Acme Traders", "Kestrel Textiles", "Falcon Foods", "Nimbus Events", "Lotus Labs"
ORB, ACO, KESC, FALC, NIC, LOC = "ORBIT SPACE", "ACME TRADERS 2025-26", "KESTREL TEXTILES", "FALCON FOODS", "NIMBUS EVENTS", "LOTUS LABS"
# Tally's own words, as the bridge keeps them in the company's trouble (made up for a made-up company)
WHY = "Tally answered with an error for the group list: Could not set 'SVCurrentCompany' to 'FALCON FOODS'"
SAID = "Tally said: Could not set 'SVCurrentCompany' to 'FALCON FOODS'"   # (as the page says it: Tally's own words first)
BUSY = "someone is working in Tally on this computer. Reading starts once Tally has had no typing or clicks for 15 s."

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--disable-dev-shm-usage", "--disable-gpu"])
        ctx = br.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2, timezone_id="Asia/Kolkata")
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
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
        def shot(name, w, h, sel=None):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True); E("() => { if (!document.getElementById('shot-still')) { const st = document.createElement('style'); st.id = 'shot-still'; st.textContent = '#app .tpg-bar.indet i { animation: none !important; transform: translateX(80%); }'; document.head.appendChild(st); } }"); pg.set_viewport_size({"width": w, "height": h}); pg.evaluate("() => window.scrollTo(0, 0)"); pg.wait_for_timeout(700)
            if sel and n(sel): pg.locator(sel).first.screenshot(path=os.path.join(SHOTS, PREFIX + "-" + name))
            else: pg.screenshot(path=os.path.join(SHOTS, PREFIX + "-" + name), full_page=True)
            pg.set_viewport_size({"width": 1440, "height": 900})

        up = {"port": 9039, "ok": True, "skipped": False, "n": 5, "error": "", "reason": "open"}
        beat = {"bridgePort": 9101, "windowsUser": UA}
        opened = (ORB, KESC, FALC, NIC)
        cos_beat = [{"name": ORB, "open": True, "phase": "live", "waiting": 0, "lastRead": "ago:30"},
                    {"name": KESC, "open": True, "phase": "live", "waiting": 0, "lastRead": ""},
                    {"name": FALC, "open": True, "phase": "live", "waiting": 0, "lastRead": ""},
                    {"name": NIC, "open": True, "phase": "live", "waiting": 0, "lastRead": ""},
                    {"name": ACO, "open": False, "phase": "live", "waiting": 0, "lastRead": "ago:2900"}]
        dA = T.dev(7, PC, "made-up-a", tally="open", opened=opened, version="2.5.16", rec=opened, beat=beat, ports=[up], cos=cos_beat)
        def link(co, cl, seen="ago:0.5"): return {"company": co, "client_id": "NAME:" + cl, "device_id": dA["id"], "gstin": "", "last_seen": seen}
        cos = [link(ORB, ORBIT), link(ACO, ACME, "ago:3000"), link(KESC, KES), link(FALC, FAL), link(NIC, NIMB), link(LOC, LOTUS, "ago:3000")]
        A_PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.16", bridgeId="go-7")}
        acme = T.book(ACME); acme[0]["ledgersAt"] = "ago:2900"
        fal = T.book(FAL, ledgers=False, days=False); fal[0]["state"] = {"trouble": {"at": "ago:3", "why": WHY}}
        books = {ORBIT: T.book(ORBIT), ACME: acme, KES: T.book(KES, ledgers=False, days=False), FAL: fal, NIMB: T.book(NIMB, ledgers=False, days=False), LOTUS: T.book(LOTUS, ledgers=False, days=False)}
        clients = [ORBIT, ACME, KES, FAL, NIMB, LOTUS]
        ids = E(T.SETUP, [[dA], cos, [], "owner", clients, True, books])
        E("() => { window.__linksApi = false; }")
        E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, A_PINGS); E(TS.FORGET); E(TS.MINE, ["", "", ""])
        E("""() => { window.__ledgers = {'bk-Orbit Space': Array.from({length: 438}, (_, i) => ({name: 'L' + i})), 'bk-Acme Traders': Array.from({length: 120}, (_, i) => ({name: 'L' + i}))};
          window.__groups = {'bk-Orbit Space': 52, 'bk-Acme Traders': 30}; window.__sum = []; window.__prog = {};
          const api = Cloud.api;
          Cloud.api = async (p, o) => { const m = /book_id=eq\\.([^&]+)/.exec(p), bk = m ? decodeURIComponent(m[1]) : '';
            if (/^tally_groups\\?/.test(p)) return Array.from({length: window.__groups[bk] || 0}, (_, i) => ({name: 'G' + i}));
            if (/^tally_ledger_rounds\\?/.test(p)) return [];
            return api(p, o); };
          TCloud.restAll = (u) => Cloud.api(u);
          const rpc = TCloud.rpc;
          TCloud.rpc = async (fn, a) => { if (fn === 'tally_fetch_summary') return {ok: true, books: JSON.parse(JSON.stringify(window.__sum))};
            if (fn === 'tally_catchup_status') return null;
            if (fn === 'tally_period_status') { const v = window.__prog[a.p_book]; return {ok: true, pull: null, ledger: v ? Object.assign({}, v, v.now ? {at: new Date().toISOString()} : {}) : null}; }
            return rpc(fn, a); }; }""")
        E("() => { navHome('clients'); }"); pg.wait_for_timeout(500)
        cid = lambda nm: ids[nm]
        # Falcon: the staging case: Bring books asked (counting the year), the masters' read failed; Kestrel: masters
        # being read by the bridge itself (FinCom's cloud's progress, no total); Nimbus: the bridge waits for typing to stop
        E("""([f, k]) => { const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          window.__sum = [{book: 'bk-Falcon Foods', client: f, company: 'FALCON FOODS', from: '2026-04-01', devices: [{id: 'd', fetchOn: true}], pull: {fy: '20260401', part: 'year', state: 'going', x: 0, y: 0, counting: true, chosenAt: t(5)}}];
          window.__prog['bk-Kestrel Textiles'] = {round: 'k1', read: 1240, of: 0, done: false, now: true}; }""", [cid(FAL), cid(KES)])
        E("""(w) => { const d = window.__devs[0]; d.info.bridges['go-7'].keepWait = {reason: 'userInTally', words: w, since: new Date().toISOString()}; }""", BUSY)
        E("() => { Object.values(TCloud.st || {}).forEach(s => { if (s) delete s.ledN; }); const G = window.FCGroupCounts || {}; Object.keys(G).forEach(k => delete G[k]); S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
        pg.wait_for_timeout(4000)
        E("() => { if (window.tfxRefresh) window.tfxRefresh(); render(); }"); pg.wait_for_timeout(3500)
        M = lambda nm: txt(R(nm) + " [data-tpg-masters]")
        # (the progress read while the page opened, before this stand-in: read again within 20 s, as the page does)
        for _ in range(30):
            if M(KES).startswith("Reading"): break
            pg.wait_for_timeout(1000)
        st = lambda nm: pg.get_attribute(R(nm) + " [data-tpg-masters]", "data-tpg-masters") if n(R(nm) + " [data-tpg-masters]") else None
        for nm in clients: print("   %-17s %-8s | %s | %s" % (nm, st(nm), M(nm), txt(R(nm) + " [data-tpg-entries]")))

        print("== 2. Up to date: checked today, or not checked today and why (item 8)")
        mo = M(ORBIT)
        ok(st(ORBIT) == "done" and re.match(r"✓ Up to date 438 ledgers · 52 groups Checked today \d\d:\d\d$", mo), "2. Orbit: ✓ Up to date · 438 ledgers · 52 groups · Checked today HH:MM (%s)" % mo)
        ma = M(ACME)
        ok(st(ACME) == "done" and ma.endswith("Not checked today: open " + ACO + " in your own Tally"), "2. Acme, not open, read yesterday: Not checked today: open <company> in your own Tally (%s)" % ma)

        print("== 1. Reading from Tally now (a read nobody pressed here: FinCom's cloud's count, no total)")
        mk = M(KES)
        ok(st(KES) == "reading" and mk == "Reading from Tally now 1,240 ledgers so far", "1. Kestrel: Reading from Tally now · 1,240 ledgers so far (%s)" % mk)
        ok(n(R(KES) + " [data-tpg-masters] .tpg-bar.indet") == 1 and pg.get_attribute(R(KES) + " [data-tpg-masters] [role=progressbar]", "aria-valuenow") is None, "1. a moving bar, no made-up percentage")

        print("== 3. Waiting: what for")
        mn, ml = M(NIMB), M(LOTUS)
        ok(st(NIMB) == "waiting" and mn == "Waiting: Tally is busy, it reads when typing stops", "3. Nimbus: Waiting: Tally is busy, it reads when typing stops (%s)" % mn)
        ok(st(LOTUS) == "waiting" and mn != ml and ml == "Waiting: open " + LOC + " in your own Tally", "3. Lotus, open nowhere: Waiting: open <company> in your own Tally (%s)" % ml)
        ok(n(R(LOTUS) + " [data-tpg-masters] [role=progressbar]") == 0, "3. no bar while it waits for the company to be opened")

        print("== 4. Not read: Tally's own words; the entries wait; what to do")
        mf, ef = M(FAL), txt(R(FAL) + " [data-tpg-entries]")
        ok(st(FAL) == "why" and mf == "Not read: " + SAID, "4. Falcon: Not read: <Tally's own words> (%s)" % mf)
        ok(E("(s) => { const e = document.querySelector(s); return !!e && e.title === e.textContent && e.getBoundingClientRect().height <= 2 * parseFloat(getComputedStyle(e).lineHeight) + 2; }", R(FAL) + " [data-tpg-ms]"), "4. Tally's words in two lines at most, the whole of it on hover")
        ok(ef == "Next, after masters Starts once the masters are in" and n(R(FAL) + " [data-tpg-entries] [role=progressbar]") == 0 and "Bringing now" not in ef,
           "4 (item 5). Entries: Next, after masters, no bar, never 'Bringing now' (%s)" % ef)
        todo = txt(R(FAL) + " .tpt-why")
        ok("Nothing. It is coming in by itself." not in txt(R(FAL)) and SAID in todo and "Open “" + FALC + "” in your own Tally and press Bring masters." in todo,
           "4 (item 4). what to do: the reason and Open <company> in your own Tally and press Bring masters (%s)" % todo)
        ok(txt(R(FAL) + " [data-tpt-main]") == "Bring masters", "4. the row's button: Bring masters (%s)" % txt(R(FAL) + " [data-tpt-main]"))
        ok(all(st(nm) in ("done", "reading", "waiting", "why") for nm in clients), "every linked client: one of the four states (%s)" % [st(nm) for nm in clients])

        shot("tally-page.png", 1440, 1100)
        shot("falcon-row.png", 1440, 900, R(FAL))
        shot("phone.png", 390, 900)
        ok(not errors, "no page errors (%s)" % errors[:2])
        br.close()
    srv.shutdown()
    print("\n%d failure(s)" % len(fails))
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
