"""python3 run_tally_table_first.py - next-tally-table (04-Nov-2026; the owner: "its still in problem.. now the table is not
showing... this tally link is the basic page that should work seamlessly"; Sentry FINCOM-APP-STAGING-G "Page blocked" on
home/tally from the shared server). Signed in to a stand-in of FinCom's cloud with a made-up firm in staging's shapes
(tally_shapes.py: 12 clients, 20 Tally companies, 5,272 ledgers, the held lines, opening balances, day checks and summary as
staging answered them, 8 computers, the member's bridge link), at a 4x slower CPU (the busy shared server), made-up FinCom
Bridges on 127.0.0.1:
  1. from Today to the Tally page: every client's row in the table within 1 s, whatever this computer's bridges do:
     a. this login's 2.5.3 bridge answers (others' too); b. no bridge of this login (others' only); c. this login's port
     accepts and never answers; d. only bridges older than 2.5.3; e. every port hangs. The "Open in Tally right now?"
     column never stays "Checking…" (it says what it found within 6 s), and the table never says "No client yet";
  2. the Tally page opened first (a cold load): the table with every client within 1 s of the page, never "No client yet"
     while the clients are on their way ("Reading your clients from FinCom's cloud…");
  3. five minutes on the Tally page (TALLY_SOAK_S, default 300), the beats and reads coming as on staging: no task over
     200 ms (longtask), at a 4x slower CPU.
RED on build mw1uewq4-6a2306 (2827a1820): 3 fails (tasks of 300-580 ms: every answer drew the whole app, the rows worked out
in every drawing). Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_table_first.py"""
import os, sys, json, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
HOST, PORT = os.environ.get("TALLY_HOST", "localhost"), int(os.environ.get("TALLY_PORT", "9563"))
CPU = float(os.environ.get("TALLY_CPU", "4")); SOAK = int(os.environ.get("TALLY_SOAK_S", "300"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
LATEST = {"setup": {"version": "2.5.3", "url": "https://x.example/assets/bridge-go/FinComBridge-Setup-2.5.3.exe", "sha256": "ab" * 32}}
# when each thing first shows (performance.now(), from __mark()), the long tasks and frames, whether "No client yet" was ever said
WATCH = """(() => {
  window.__tt = {}; window.__t0 = 0; window.__long = []; window.__loaf = []; window.__said = {};
  window.__mark = () => { window.__tt = {}; window.__t0 = performance.now(); window.__long = []; window.__loaf = []; window.__said = {}; };
  const live = () => (typeof S === 'object' && S && S.companies) ? Object.values(S.companies).filter((c) => c && !c.deleted).length : -1;
  const chk = () => {
    const tt = window.__tt, t = performance.now();
    if (!('page' in tt) && document.querySelector('#app [data-tally-simple]')) tt.page = t;
    if (!('table' in tt) && document.querySelector('#app [data-tsm-table]')) tt.table = t;
    const n = document.querySelectorAll('#app [data-tsm-table] tbody tr[data-tsm-kind=client]').length, want = live();
    if (!('rows' in tt) && want > 0 && n >= want) tt.rows = t;
    if (!('full' in tt) && document.querySelector('#app [data-tsm-rows=done]') && n >= want && want > 0) tt.full = t;
    const none = document.querySelector('#app [data-tsm-none]'); if (none) window.__said[none.getAttribute('data-tsm-none')] = 1;
  };
  new MutationObserver(chk).observe(document, {subtree: true, childList: true, attributes: true});
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push({d: Math.round(e.duration), t: Math.round(e.startTime)}))).observe({type: 'longtask', buffered: false}); } catch (e) {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__loaf.push({d: Math.round(e.duration), t: Math.round(e.startTime), s: (e.scripts || []).map((x) => [Math.round(x.duration), String(x.sourceURL).split('/').pop().split('?')[0], x.sourceFunctionName || x.invoker]).slice(0, 4)}))).observe({type: 'long-animation-frame', buffered: false}); } catch (e) {}
})()"""
READY = "() => typeof S === 'object' && S && S.firm && typeof Cloud === 'object' && Cloud.st && !!Cloud.st.lastSync && typeof render === 'function'"
def main():
    srv = http.server.ThreadingHTTPServer((HOST, PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://%s:%d/" % (HOST, PORT)
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        def open_(scene, hash_):
            fx = TS.make(); cloud = TS.FakeCloud(fx); loop = []
            ctx = br.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
            pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append("%s: %s" % (scene, str(e)[:300])))
            pg.add_init_script(TS.signin_script(fx)); pg.add_init_script(WATCH)
            ctx.route("https://*.supabase.co/**", cloud.route)
            ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
            ctx.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
            ctx.route("http://127.0.0.1:*/**", TS.bridges(scene, loop))
            cdp = ctx.new_cdp_session(pg)
            if CPU > 1: cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU})
            pg.goto(base + hash_, wait_until="domcontentloaded", timeout=120000)
            return ctx, pg, loop
        def row_words(pg):
            return pg.evaluate("""() => [...document.querySelectorAll('#app [data-tsm-table] tbody tr[data-tsm-kind=client]')].map((r) => ({c: (r.querySelector('[data-tsm-col=c] [data-tsm-word]') || {}).textContent || '',
              o: ((r.querySelector('[data-tsm-col=o]') || {}).innerText || '').replace(/\\s+/g, ' ').trim()}))""")

        print("1. from Today to the Tally page, at a %gx slower CPU: every client within 1 s, whatever the bridges do" % CPU)
        WANT = {"own253": ("No ", "Yes"), "none": ("FinCom Bridge is not running in this Windows login",), "ownhang": ("FinCom Bridge is not running in this Windows login",),
                "old": ("Your FinCom Bridge is old (2.5.1)",), "allhang": ("FinCom Bridge is not running in this Windows login",)}
        for scene, label in [("own253", "a. this login's 2.5.3 bridge answers"), ("none", "b. no bridge of this login"), ("ownhang", "c. this login's port never answers"),
                             ("old", "d. only bridges older than 2.5.3"), ("allhang", "e. every port hangs")]:
            ctx, pg, loop = open_(scene, "#/today")
            pg.wait_for_function(READY, timeout=90000); pg.wait_for_timeout(4000)
            pg.evaluate("() => { __mark(); location.hash = '#/tally'; }")
            try: pg.wait_for_function("() => 'rows' in window.__tt", timeout=15000)
            except Exception: pass
            pg.wait_for_timeout(6000)
            r = pg.evaluate("() => ({tt: Object.fromEntries(Object.entries(window.__tt).map(([k, v]) => [k, Math.round(v - window.__t0)])), said: window.__said, n: Object.values(S.companies).filter((c) => !c.deleted).length})")
            w = row_words(pg); linked = [x for x in w if x["c"] == "Yes"]
            print("      %s: %s; linked rows' Open in Tally: %s" % (scene, json.dumps(r), json.dumps(sorted(set(x["o"][:70] for x in linked)))[:400]))
            ok("rows" in r["tt"] and r["tt"]["rows"] <= 1000, "%s: every client's row within 1 s (%s ms)" % (label, r["tt"].get("rows")))
            ok(len(w) == r["n"] and len(linked) >= 7, "%s: %d clients in the table, %d of them connected to Tally" % (label, len(w), len(linked)))
            ok("none" not in r["said"], "%s: never “No client yet”" % label)
            ok(linked and not [x for x in linked if "Checking" in x["o"]], "%s: Open in Tally right now? says what it found, never stays “Checking…”" % label)
            ok(linked and all(any(x["o"].startswith(s) or s in x["o"] for s in WANT[scene]) for x in linked), "%s: the words for it (%s)" % (label, WANT[scene][0]))
            ctx.close()

        print("2. the Tally page opened first (a cold load)")
        ctx, pg, loop = open_("own253", "#/tally")
        try: pg.wait_for_function("() => 'rows' in window.__tt", timeout=90000)
        except Exception: pass
        pg.wait_for_timeout(3000)
        r = pg.evaluate("() => ({tt: Object.fromEntries(Object.entries(window.__tt).map(([k, v]) => [k, Math.round(v)])), said: window.__said})")
        print("      ", json.dumps(r))
        tt = r["tt"]
        ok("page" in tt and "rows" in tt and tt["rows"] - tt["page"] <= 1000, "every client within 1 s of the page (page %s, rows %s ms)" % (tt.get("page"), tt.get("rows")))
        ok("none" not in r["said"], "never “No client yet” while the clients are on their way (said: %s)" % sorted(r["said"]))
        ctx.close()

        print("3. %d s on the Tally page at a %gx slower CPU: no task over 200 ms" % (SOAK, CPU))
        ctx, pg, loop = open_("own253", "#/today")
        pg.wait_for_function(READY, timeout=90000); pg.wait_for_timeout(4000)
        pg.evaluate("() => { __mark(); location.hash = '#/tally'; }")
        t1 = time.time(); worst = 0
        while time.time() - t1 < SOAK:
            pg.wait_for_timeout(15000)
            lt = pg.evaluate("() => window.__long.reduce((m, x) => Math.max(m, x.d), 0)")
            if lt > worst: worst = lt; print("      after %3d s: the longest task so far %d ms" % (time.time() - t1, lt), flush=True)
        r = pg.evaluate("() => ({long: window.__long.slice().sort((a, b) => b.d - a.d).slice(0, 5), loaf: window.__loaf.slice().sort((a, b) => b.d - a.d).slice(0, 3), n: window.__long.length, rows: document.querySelectorAll('#app [data-tsm-table] tbody tr').length})")
        print("      ", json.dumps(r)[:900])
        ok(r["rows"] >= 10, "the table still shown at the end (%d rows)" % r["rows"])
        ok(not r["long"] or r["long"][0]["d"] <= 200, "no task over 200 ms in %d s (the longest %s ms, %d over 50 ms)" % (SOAK, r["long"][0]["d"] if r["long"] else 0, r["n"]))
        ctx.close()
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)
main()
