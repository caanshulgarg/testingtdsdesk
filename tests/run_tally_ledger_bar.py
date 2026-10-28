"""python3 run_tally_ledger_bar.py - the ledgers' ONE bar (26-Oct-2026; the owner: "ledgers stay automatic through the
bridge, but the progress must be a clear, smart bar"; first round 24-Oct-2026, next-tally-firstlink: "a smart bar like 34
out of 342 completed"). Stub cloud (as run_tally_suvit.py) with tally_period_status's ledger = the bridge's progress (2.4.5
ledger_progress), tally_ledger_rounds / tally_ledgers.renamed_at for today's later changes:
  1. reading: "Reading ledgers from Tally: 34 of 342 (10%)", a filled bar 10% wide; once two counts are seen, the time
     left ("· less than a minute left" / "· about N min left"); the masters XML as a fallback line under it.
  1b. the total not known yet: "Reading ledgers from Tally… 50 so far", the bar moving (no width).
  2. done: "342 ledgers from Tally ✓ · 16:20", green, one line; never failed, even past 10 minutes.
  3. a fast read that sent only the changed ledgers counts as done; an EARLIER read's "done" never counts.
  4. the progress call lost: the book's ledger time alone ends it, with the cloud's count.
  5. stuck: the computer's beat says why (the company not open, Tally closed, offline, reading paused, Tally busy): that
     reason in one line with Try again, no bar; no count for 3 minutes: "No progress from Tally in 3 minutes: ..." with Try
     again; Try again asks the ledgers again (the wake) and the bar runs again.
  6. Books › From Tally: the same bar while reading; done: "N ledgers from Tally ✓ · HH:MM" and today's changes, quietly:
     "3 new or changed ledgers and 1 rename from Tally today" (only when > 0).
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
SETUP = SETUP.replace("if (/^tally_devices/.test(path)) return copy(window.__devs);", "if (/^tally_devices/.test(path)) return copy(window.__devs);\n    if (/^tally_ledger_rounds/.test(path)) return copy((window.__chg || {}).rounds || []);\n    if (/^tally_ledgers\\?select=name&book_id=eq\\.[^&]+&renamed_at=gte\\./.test(path)) return copy((window.__chg || {}).ren || []);")
assert "tally_ledger_rounds" in SETUP
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
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
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
            # Task D: + New client inside the client picker. next-tally-smart: a company not open now is under Help & support ›
            # Every company seen (the open ones are the page's list)
            if not pg.locator(R(VMS)).count(): E("() => { S.tallyMore = {page: true}; render(); }"); pg.wait_for_timeout(600)
            RR = R(VMS) if pg.locator(R(VMS)).count() else '#app [data-tco-list=all] [data-tco-row="%s"]' % VMS
            pg.click(RR + " [data-tco-add-new]"); pg.wait_for_timeout(1200)
            ids = E("(n) => Object.values(S.companies).filter(c => !c.deleted && c.tallyName === n).map(c => c.id)", VMS)
            # the link makes the client's book in the cloud (tally_books, no ledgers yet): what tally_status then gives
            if ids: E("(c) => { window.__books[c] = window.__fix(%s); }" % json.dumps(NOBOOK_DAYS("VMS", None)), ids[0])
            return ids[0] if ids else ""
        sync = lambda: txt(R(VMS) + " [data-tco-sync]")
        words = lambda: txt(R(VMS) + " [data-tco-sync-words]")
        def shot_page(name):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            for w, h in ((1440, 900), (390, 844)):
                pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(300)
                pg.locator("#app [data-upload-page]").screenshot(path=os.path.join(SHOTS, "ledgers-%s-%d.png" % (name, w)))
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(200)
        state = lambda: E("(s) => (document.querySelector(s + ' [data-tco-sync]') || {getAttribute: () => ''}).getAttribute('data-tco-sync')", R(VMS))

        # ---- 1. reading: the count, the share, the bar; the time left once two counts are seen; the masters fallback
        scene(lp=None)
        cid = add_vms()
        ok(bool(cid) and state() == "running", "1. Add as client: the first sync runs (%s)" % state())
        now_lp("r1", 34, 342, False); pg.wait_for_timeout(10800)
        s = words()
        ok(s == "Reading ledgers from Tally: 34 of 342 (10%)", "1. 'Reading ledgers from Tally: 34 of 342 (10%%)', no time left after one count (%s)" % s)
        pct = E("(s) => (document.querySelector(s + ' [data-tco-pct]') || {getAttribute: () => ''}).getAttribute('data-tco-pct')", R(VMS))
        w = E("(s) => { const i = document.querySelector(s + ' .tco-bar i'); return i ? Math.round(100 * i.getBoundingClientRect().width / i.parentElement.getBoundingClientRect().width) : -1; }", R(VMS))
        ok(pct == "10" and 8 <= w <= 12, "1. a real filled bar, 10%% wide (34 of 342): %s%% / %s%%" % (pct, w))
        ok(E("(s) => document.querySelector(s + ' .tco-bar').getAttribute('aria-valuenow')", R(VMS)) == "34", "1. its aria-valuenow is 34")
        ok(txt(R(VMS) + " [data-tco-masters-line]") == "Or upload the masters XML (List of Accounts → Alt+E → XML)", "1. the masters XML as a fallback line (%s)" % txt(R(VMS) + " [data-tco-masters-line]"))
        now_lp("r1", 102, 342, False); pg.wait_for_timeout(10800)
        s = words()
        ok(re.match(r"^Reading ledgers from Tally: 102 of 342 \(30%\) · (less than a minute|about \d+ min) left$", s) is not None, "1. a second count: the time left from the rate (%s)" % s)
        shot("1-reading-102-of-342")
        # 1b. the total not known yet
        now_lp("r1", 150, 0, False); pg.wait_for_timeout(10800)
        s = words()
        ok(s == "Reading ledgers from Tally… 150 so far" and E("(s) => !document.querySelector(s + ' [data-tco-pct]') && !!document.querySelector(s + ' .tco-bar i:not(.det)')", R(VMS)),
           "1b. the total not known: 'Reading ledgers from Tally… 150 so far', the bar moving (%s)" % s)
        shot("1b-reading-unknown-total")
        # ---- 2. done; no entries of this year: done all the same, never failed
        now_lp("r1", 342, 342, True)
        E("(c) => { window.__books[c] = %s; window.__ledn['bk-VMS'] = 342; }" % json.dumps(NOBOOK_DAYS("VMS", "ago:0")), cid)
        E("(c) => { window.__books[c] = window.__fix(window.__books[c]); }", cid)
        try: pg.wait_for_selector(R(VMS) + " [data-tco-sync=done]", timeout=15000); dn = True
        except Exception: dn = False
        s = sync()
        ok(dn and re.match(r"^342 ledgers from Tally ✓ · \d\d:\d\d$", s) is not None, "2. '342 ledgers from Tally ✓ · 16:20', one line (%s)" % s)
        ok(pg.locator(R(VMS) + " .tco-sync.bad").count() == 0 and E("(s) => document.querySelector(s + ' [data-tco-sync=done]').classList.contains('ok')", R(VMS)), "2. green, not a failure")
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
        ok(dn and sync().startswith("171 ledgers from Tally ✓"), "3. a 1-second read that sent only the changed ledgers counts as done: '171 ledgers from Tally ✓' (%s)" % sync())
        # ---- 4. the progress call lost: the ledger time alone ends it, with the cloud's count
        scene(lp=None)
        E("() => { Object.values(S.companies).filter(c => c.tallyName === '%s').forEach(c => { c.deleted = true; }); render(); }" % VMS); pg.wait_for_timeout(400)
        cid = add_vms()
        E("(c) => { window.__books[c] = window.__fix(%s); window.__ledn['bk-VMS'] = 2169; }" % json.dumps(NOBOOK_DAYS("VMS", "ago:0")), cid)
        try: pg.wait_for_selector(R(VMS) + " [data-tco-sync=done]", timeout=13000); dn = True
        except Exception: dn = False
        ok(dn and sync().startswith("2,169 ledgers from Tally ✓"), "4. no progress kept, the ledger time moved: '2,169 ledgers from Tally ✓' (%s)" % sync())
        # ---- 5. stuck: the plain reason from the beat, with Try again, no bar
        def stalled(devs, want, name):
            scene(devs=devs, lp=None)
            E("() => { Object.values(S.companies).filter(c => c.tallyName === '%s').forEach(c => { c.deleted = true; }); render(); }" % VMS); pg.wait_for_timeout(400)
            c = add_vms()
            E("(c) => { S.tcoSync[c].at = Date.now() - 40000; S.tcoSync[c].moveAt = Date.now() - 40000; }", c); pg.wait_for_timeout(12500)
            w = txt(R(VMS) + " [data-tco-sync-why]")
            ok(state() == "stuck" and w.startswith(want) and pg.locator(R(VMS) + " [data-tco-sync-again]").count() == 1 and pg.locator(R(VMS) + " .tco-bar").count() == 0,
               "5. %s: '%s', Try again, no bar (%s)" % (name, want, w))
            return c
        cid = stalled([SV.dev(opened=(GSC,))], VMS + " is not open in Tally on NWS144: open it in TallyPrime", "the company not open")
        shot("5-stuck-not-open")
        stalled([SV.dev(opened=(), tally="closed")], "Tally is not open on NWS144", "Tally closed")
        stalled([SV.dev(at="ago:45")], "FinCom Bridge on NWS144 is offline", "the computer offline")
        d = SV.dev(); d["info"]["beat"]["paused"] = True
        stalled([d], "Reading is paused on NWS144", "reading paused")
        d = SV.dev(); d["info"]["beat"]["tallyState"] = "busy"
        stalled([d], "Tally is busy on NWS144", "Tally busy")
        # no count for 3 minutes, the beat says nothing wrong: stuck all the same (never a bar that runs for ever)
        scene(lp=None)
        E("() => { Object.values(S.companies).filter(c => c.tallyName === '%s').forEach(c => { c.deleted = true; }); render(); }" % VMS); pg.wait_for_timeout(400)
        cid = add_vms()
        now_lp("r5", 20, 342, False); pg.wait_for_timeout(10800)
        ok(state() == "running", "5. a count came: running (%s)" % state())
        E("(c) => { S.tcoSync[c].at = Date.now() - 200000; S.tcoSync[c].moveAt = Date.now() - 190000; }", cid); pg.wait_for_timeout(11000)
        lt = txt(R(VMS) + " [data-tco-sync=stuck]")
        ok(state() == "stuck" and lt.startswith("No progress from Tally in 3 minutes: keep " + VMS + " open in TallyPrime on its computer.") and pg.locator(R(VMS) + " .tco-bar").count() == 0,
           "5. no count for 3 minutes: stuck, the plain words, no bar (%s)" % lt)
        shot("5-stuck-3-minutes")
        n0 = len([c for c in E("window.__calls") if c[0] == "post"])
        pg.click(R(VMS) + " [data-tco-sync-again]"); pg.wait_for_timeout(1500)
        ok(state() == "running" and len([c for c in E("window.__calls") if c[0] == "post"]) > n0, "5. Try again: the ledgers asked again (the wake), the bar runs again (%s)" % state())
        # ---- 6. Books › From Tally: the same bar; done with today's changes
        E("(c) => { location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }", cid); pg.wait_for_timeout(1500)
        now_lp("r6", 600, 1240, False); E("(c) => window.__books[c] = window.__fix(%s)" % json.dumps(NOBOOK_DAYS("VMS", None)), cid)
        E("(c) => { S.tcoSync[c].at = Date.now(); S.tcoSync[c].moveAt = Date.now(); render(); }", cid); pg.wait_for_timeout(11000)
        B = "#app [data-up-ledgers]"
        ok(txt(B + " [data-tco-sync-words]").startswith("Reading ledgers from Tally: 600 of 1,240 (48%)") and pg.locator(B + " .tco-bar i.det").count() == 1,
           "6. From Tally: the same bar while reading (%s)" % txt(B))
        shot_page("6-books-reading")
        E("() => { window.__chg = {rounds: [{rows_received: 4, rows_read: 1240, complete: true}, {rows_received: 1240, rows_read: 1240, complete: true}], ren: [{name: 'Rent A/c'}]}; }")
        now_lp("r6", 1240, 1240, True)
        E("(c) => { window.__books[c] = window.__fix(%s); window.__ledn['bk-VMS'] = 1240; }" % json.dumps(NOBOOK_DAYS("VMS", "ago:0")), cid)
        try: pg.wait_for_selector(B + " [data-tco-sync=done]", timeout=15000); dn = True
        except Exception: dn = False
        pg.wait_for_timeout(800)
        ok(dn and re.match(r"^1,240 ledgers from Tally ✓ · \d\d:\d\d$", txt(B + " [data-tco-sync=done]")) is not None, "6. From Tally done: '1,240 ledgers from Tally ✓ · 10:42' (%s)" % txt(B))
        ok(txt(B + " [data-tco-later]") == "3 new or changed ledgers and 1 rename from Tally today", "6. today's changes, quietly (%s)" % txt(B + " [data-tco-later]"))
        shot_page("6-books-done-changes")
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
