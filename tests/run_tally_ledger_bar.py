"""python3 run_tally_ledger_bar.py - the ledgers' import bar (24-Oct-2026, next-tally-firstlink; the owner: "Automatic
master ledger import is also not working.. I asked in 2.4.5 for a smart bar like 34 out of 342 completed.. currently it
runs and after some time it fails"). Staging showed the ledgers arriving in about a second (tally_ledger_rounds complete,
tally_ledger_progress done) while the bar waited for this year's entries too and, after 10 minutes, said it failed.
Stub cloud (as run_tally_suvit.py) with tally_period_status's ledger = the bridge's progress (2.4.5 ledger_progress):
  1. Add as client: the bar is the ledgers' own: "Reading ledgers from Tally… 34 of 342 ledgers", its width 10%.
  2. The read ends (progress done, the book's ledger time moves), no entries of this year: "342 ledgers imported ✓ at
     16:20 IST · this year's entries come in by themselves" — done, never "failed", even past 10 minutes.
  3. A fast 1-second read that sent only the changed ledgers (171 read, 26 received): done at the first look; an EARLIER
     read's "done" (there before the click) never counts.
  4. The progress call lost: the book's ledger time alone ends it, with the cloud's count.
  5. Nothing comes: after 30 seconds the plain reason from the computer's beat (the company not open in Tally on NWS144;
     Tally not open; NWS144 offline; reading paused); after 10 minutes the same reason with Try again.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_ledger_bar.py [--shots DIR]"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
import run_tally_suvit as SV
SITE = SV.SITE
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8659
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = SV.SETUP.replace('if (fn === "tally_period_status") return {};',
    'if (fn === "tally_period_status") return window.__lp ? {ok: true, pull: null, ledger: JSON.parse(JSON.stringify(window.__lp))} : {ok: true, pull: null, ledger: null};')
SETUP = SETUP.replace("window.__devs = fix(devs);", "window.__fix = fix; window.__devs = fix(devs);")
assert SETUP != SV.SETUP and "window.__fix = fix" in SETUP
VMS, GSC = SV.VMS, SV.GSC
NOBOOK_DAYS = lambda name, led_at: [{"book": "bk-" + name, "company": name, "from": "", "to": "", "days": 0, "openAsOn": "", "ledgersAt": led_at, "entries": 0}]

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(SV.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.4.5", "url": "https://x/s.exe", "sha256": "ab" * 32}})))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        SV.GST[0] = SV.VMS_GST[:14] + E("(g) => gstinCheckChar(g)", SV.VMS_GST[:14] + "0")
        E("""() => { const g = newCompany({name: 'Garg Shekhar & Company', gstin: '09AANFG3202D1ZR'}); S.companies[g.id] = g; S.data[g.id] = {parties: {}, entries: {}, loaded: true}; g.stats = {};
            Store.saveCompany(g); window.__ids = {GS: g.id}; }""")
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        R = lambda co: '#app [data-tco-list=firm] [data-tco-row="%s"]' % co
        def shot(name):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            for w, h in ((1440, 900), (390, 844)):
                pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(300)
                el = pg.locator(R(VMS)) if pg.locator(R(VMS)).count() else pg.locator("#app")
                el.screenshot(path=os.path.join(SHOTS, "ledgers-%s-%d.png" % (name, w)))
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(200)
        def scene(devs=None, lp=None):
            E(SETUP, [[SV.dev()] if devs is None else devs, SV.cos(), {}, {}]); E("(lp) => { window.__lp = lp; }", lp); pg.wait_for_timeout(200)
            E("() => { S.tallyGuide = {}; S.tallyTab = 'computers'; navHome('tally'); }"); pg.wait_for_timeout(1000)
        now_lp = lambda rnd, read, of, done, ago_s=0: E("([r, a, o, d, s]) => { window.__lp = {round: r, read: a, of: o, done: d, at: new Date(Date.now() - s * 1000).toISOString()}; }", [rnd, read, of, done, ago_s])
        def add_vms():
            pg.click(R(VMS) + " [data-tco-act]"); pg.wait_for_timeout(1200)
            ids = E("(n) => Object.values(S.companies).filter(c => !c.deleted && c.tallyName === n).map(c => c.id)", VMS)
            # the link makes the client's book in the cloud (tally_books, no ledgers yet): what tally_status then gives
            if ids: E("(c) => { window.__books[c] = window.__fix(%s); }" % json.dumps(NOBOOK_DAYS("VMS", None)), ids[0])
            return ids[0] if ids else ""
        sync = lambda: txt(R(VMS) + " [data-tco-sync]")
        state = lambda: E("(s) => (document.querySelector(s + ' [data-tco-sync]') || {getAttribute: () => ''}).getAttribute('data-tco-sync')", R(VMS))

        # ---- 1. the bar is the ledgers' own, with the bridge's count
        scene(lp=None)
        cid = add_vms()
        ok(bool(cid) and state() == "running", "1. Add as client: the first sync runs (%s)" % state())
        now_lp("r1", 34, 342, False); pg.wait_for_timeout(10800)
        s = sync()
        ok("Reading ledgers from Tally… 34 of 342 ledgers" in s, "1. 'Reading ledgers from Tally… 34 of 342 ledgers' (%s)" % s)
        pct = E("(s) => (document.querySelector(s + ' [data-tco-pct]') || {getAttribute: () => ''}).getAttribute('data-tco-pct')", R(VMS))
        w = E("(s) => { const i = document.querySelector(s + ' .tco-bar i'); return i ? Math.round(100 * i.getBoundingClientRect().width / i.parentElement.getBoundingClientRect().width) : -1; }", R(VMS))
        ok(pct == "10" and 8 <= w <= 12, "1. the bar is 10%% wide (34 of 342): %s%% / %s%%" % (pct, w))
        ok(E("(s) => document.querySelector(s + ' .tco-bar').getAttribute('aria-valuenow')", R(VMS)) == "34", "1. its aria-valuenow is 34")
        shot("1-reading-34-of-342")
        # ---- 2. done; no entries of this year: done all the same, never failed
        now_lp("r1", 342, 342, True)
        E("(c) => { window.__books[c] = %s; window.__ledn['bk-VMS'] = 342; }" % json.dumps(NOBOOK_DAYS("VMS", "ago:0")), cid)
        E("(c) => { window.__books[c] = window.__fix(window.__books[c]); }", cid)
        try: pg.wait_for_selector(R(VMS) + " [data-tco-sync=done]", timeout=15000); dn = True
        except Exception: dn = False
        s = sync()
        ok(dn and re.match(r"^342 ledgers imported ✓ at \d\d:\d\d IST · this year’s entries come in by themselves", s) is not None, "2. '342 ledgers imported ✓ at 16:20 IST · this year’s entries come in by themselves' (%s)" % s)
        ok(pg.locator(R(VMS) + " .tco-sync.bad").count() == 0, "2. not a failure (no red line)")
        E("(c) => { S.tcoSync[c].at = Date.now() - 12 * 60000; render(); }", cid); pg.wait_for_timeout(600)
        ok(state() == "done", "2. still done past 10 minutes (%s)" % state())
        shot("2-done-342")
        # ---- 3. a fast 1-second read with only the changed ledgers sent; an earlier read's done never counts
        scene(lp={"round": "r0", "read": 171, "of": 171, "done": True, "at": "2026-10-24T10:00:11Z"})
        E("() => { Object.values(S.companies).filter(c => c.tallyName === '%s').forEach(c => { c.deleted = true; }); render(); }" % VMS); pg.wait_for_timeout(400)
        cid = add_vms()
        pg.wait_for_timeout(10800)
        ok(state() == "running", "3. an earlier read's 'done' (there before the click) does not end it (%s)" % state())
        now_lp("r2", 171, 171, True)   # the new round: read 171, sent 26 (only the changed): the bridge says done with 171
        E("(c) => { window.__books[c] = window.__fix(%s); window.__ledn['bk-VMS'] = 171; }" % json.dumps(NOBOOK_DAYS("VMS", "ago:0")), cid)
        try: pg.wait_for_selector(R(VMS) + " [data-tco-sync=done]", timeout=13000); dn = True
        except Exception: dn = False
        ok(dn and sync().startswith("171 ledgers imported ✓"), "3. a 1-second read that sent only the changed ledgers counts as done: '171 ledgers imported ✓' (%s)" % sync())
        # ---- 4. the progress call lost: the ledger time alone ends it, with the cloud's count
        scene(lp=None)
        E("() => { Object.values(S.companies).filter(c => c.tallyName === '%s').forEach(c => { c.deleted = true; }); render(); }" % VMS); pg.wait_for_timeout(400)
        cid = add_vms()
        E("(c) => { window.__books[c] = window.__fix(%s); window.__ledn['bk-VMS'] = 2169; }" % json.dumps(NOBOOK_DAYS("VMS", "ago:0")), cid)
        try: pg.wait_for_selector(R(VMS) + " [data-tco-sync=done]", timeout=13000); dn = True
        except Exception: dn = False
        ok(dn and sync().startswith("2,169 ledgers imported ✓"), "4. no progress kept, the ledger time moved: '2,169 ledgers imported ✓' (%s)" % sync())
        # ---- 5. nothing comes: the plain reason from the beat
        def stalled(devs, want, name):
            scene(devs=devs, lp=None)
            E("() => { Object.values(S.companies).filter(c => c.tallyName === '%s').forEach(c => { c.deleted = true; }); render(); }" % VMS); pg.wait_for_timeout(400)
            c = add_vms()
            E("(c) => { S.tcoSync[c].at = Date.now() - 40000; }", c); pg.wait_for_timeout(12500)
            w = txt(R(VMS) + " [data-tco-sync-why]")
            ok(state() == "running" and want in w, "5. %s: '%s' (%s)" % (name, want, w))
            return c
        cid = stalled([SV.dev(opened=(GSC,))], VMS + " is not open in Tally on NWS144: open it in TallyPrime", "the company not open")
        shot("5-why-not-open")
        E("(c) => { S.tcoSync[c].at = Date.now() - 11 * 60000; }", cid); pg.wait_for_timeout(12500)   # (the poll's timer starts again with the new start)
        lt = txt(R(VMS) + " [data-tco-sync=late]")
        ok(lt.startswith("Ledgers not received in 10 minutes: " + VMS + " is not open in Tally on NWS144") and pg.locator(R(VMS) + " [data-tco-sync-again]").count() == 1,
           "5. at 10 minutes: the same reason, with Try again (%s)" % lt)
        shot("5-late")
        stalled([SV.dev(opened=(), tally="closed")], "Tally is not open on NWS144", "Tally closed")
        stalled([SV.dev(at="ago:45")], "FinCom Bridge on NWS144 is offline", "the computer offline")
        d = SV.dev(); d["info"]["beat"]["paused"] = True
        stalled([d], "Reading is paused on NWS144", "reading paused")
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
