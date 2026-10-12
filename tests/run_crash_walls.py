"""python3 run_crash_walls.py - crash walls (reliability item 4): each routed screen and each major panel has its own
React error boundary (app/src/Guard.jsx, the "wall" kind). In the React test build (app/dist-test), working without an
account:
  - a screen that throws (Help's guide, its data source made to throw with business words in the message) shows one calm
    Arc card in the page's main part only: "This part of FinCom hit a problem. Your work is saved." with Retry and
    Go to Today; the sidebar and the top bar stay outside the wall and keep working; redraws keep the card (no loop);
    the crash is reported once with the wall's name (window.__fincomReport, Sentry on staging), its words scrubbed there;
  - Retry draws the screen again (it recovers once the cause is gone); Go to Today opens Today;
  - the card in dark mode and at phone width;
  - a screen's file that fails to load is fetched once more by itself (the page opens); when it fails again the wall
    says FinCom may have been updated and offers Reload FinCom, which reloads the page.
A failure here fails CI (tests/ci/tests.txt). Run: TDSDESK_SITE=../app/dist-test python3 run_crash_walls.py"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
if not os.path.isabs(SITE): SITE = os.path.join(HERE, SITE)
PORT = int(os.environ.get("CRASH_WALLS_PORT", "8367"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
WORDS = "This part of FinCom hit a problem. Your work is saved."

def open_app(br, scheme="light", viewport=(1400, 950), route=None):
    ctx = br.new_context(viewport={"width": viewport[0], "height": viewport[1]}, color_scheme=scheme)
    ctx.add_init_script("window.__reports = []; Object.defineProperty(window, '__fincomReport', {configurable: true, get() { return (e, g) => window.__reports.push([String(g), String(e && e.message)]); }, set() {}});")
    ctx.route(re.compile(r"^https://[^/]*(supabase\.co|sentry\.io)/.*"), lambda r: r.abort())
    if route: ctx.route(*route)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    return ctx, pg, errs
WALL = "#app [data-crash-wall]"
BREAK = "() => { window.__guideAll = window.__guideAll || GUIDE.all; GUIDE.all = () => { throw new Error('ALPHA TRADERS 09AANFG3202D1ZR could not be read'); }; SUP.st().tab = 'guide'; }"
MEND = "() => { GUIDE.all = window.__guideAll; }"

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx, pg, errs = open_app(br)
    E = pg.evaluate
    # ---- a screen that throws
    E(BREAK); E("navHome('help')"); pg.wait_for_timeout(2500)
    wall = pg.locator(WALL)
    ok(wall.count() == 1 and wall.is_visible(), "Help throwing: one crash wall in the page's main part")
    t = wall.inner_text() if wall.count() else ""
    ok(WORDS in t, "it says: " + WORDS + " (" + t.replace("\n", " | ")[:160] + ")")
    ok(pg.locator(WALL + " button", has_text="Retry").count() == 1 and pg.locator(WALL + " button", has_text="Go to Today").count() == 1, "with Retry and Go to Today")
    ok("ALPHA" not in t and "09AANFG3202D1ZR" not in t, "the card shows no raw error words")
    ok(pg.locator("#side [data-crash-wall], header.top [data-crash-wall]").count() == 0, "the sidebar and the top bar are outside the wall")
    ok(pg.locator("#side button[data-side='Clients']").is_visible() and pg.locator("header.top").is_visible(), "the sidebar and the top bar still drawn")
    ok(E("window.__reports.length") >= 1 and E("window.__reports.every(r => r[0] === 'this screen')"), "the crash reported with the wall's name (%s)" % E("window.__reports.map(r => r[0])"))
    n0 = E("window.__reports.length")
    E("() => { for (let i = 0; i < 5; i++) render(); }"); pg.wait_for_timeout(800)
    ok(pg.locator(WALL).count() == 1 and E("window.__reports.length") == n0, "redraws keep the card; not reported again (no loop)")
    # the sidebar keeps working: another page, then back to the broken one
    pg.click("#side button[data-side='Clients']"); pg.wait_for_timeout(1200)
    ok(E("S.homeTab") == "clients" and pg.locator(WALL).count() == 0, "the sidebar still works: Clients opens, the card is gone")
    pg.click("#side button[data-side='Help']"); pg.wait_for_timeout(1200)
    ok(pg.locator(WALL).count() == 1, "back to Help: the card again (it still throws)")
    # Retry: still broken -> the card stays; mended -> the screen draws
    pg.click(WALL + " button:has-text('Retry')"); pg.wait_for_timeout(800)
    ok(pg.locator(WALL).count() == 1, "Retry while it still throws: the card stays")
    E(MEND); pg.click(WALL + " button:has-text('Retry')"); pg.wait_for_timeout(1200)
    ok(pg.locator(WALL).count() == 0 and pg.locator("input[data-fk='supgq']").count() == 1, "Retry once the cause is gone: Help's guide is drawn again")
    # Go to Today
    E(BREAK); E("render()"); pg.wait_for_timeout(1000)
    ok(pg.locator(WALL).count() == 1, "broken again")
    pg.click(WALL + " button:has-text('Go to Today')"); pg.wait_for_timeout(1500)
    ok(E("S.view") == "home" and E("S.homeTab") == "today" and pg.locator(WALL).count() == 0, "Go to Today opens Today; the card is gone")
    E(MEND)
    # Arc's look: a card (border, radius), the main action a primary button
    look = E("""() => { navHome('help'); return null; }"""); E(BREAK); E("render()"); pg.wait_for_timeout(1000)
    st = E("""() => { const c = document.querySelector('#app [data-crash-wall]'); const s = getComputedStyle(c);
      return {radius: parseFloat(s.borderTopLeftRadius), border: s.borderTopStyle, retry: document.querySelector('#app [data-crash-wall] button[data-tone]') ? document.querySelector('#app [data-crash-wall] button[data-tone]').dataset.tone : ''}; }""")
    ok(st["radius"] >= 8 and st["border"] != "none" and st["retry"] == "primary", "an Arc card: rounded, bordered, Retry the primary button (%s)" % st)
    E(MEND)
    ok(not [e for e in errs if "ALPHA" not in e], "no other page error (%s)" % errs[:3])
    ctx.close()

    # ---- dark mode and phone width
    for scheme, vp, what in (("dark", (1400, 950), "dark mode"), ("light", (390, 844), "phone width")):
        ctx, pg, errs = open_app(br, scheme=scheme, viewport=vp)
        pg.evaluate(BREAK); pg.evaluate("navHome('help')"); pg.wait_for_timeout(2500)
        c = pg.locator(WALL)
        box = c.bounding_box() if c.count() else None
        bg = pg.evaluate("() => { const c = document.querySelector('#app [data-crash-wall]'); const m = getComputedStyle(c).backgroundColor.match(/\\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; }") if c.count() else -1
        ink = pg.evaluate("() => { const c = document.querySelector('#app [data-crash-wall] h2, #app [data-crash-wall] h3, #app [data-crash-wall] b'); const m = getComputedStyle(c).color.match(/\\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; }") if c.count() else -1
        ok(c.count() == 1 and (bg < 80 and ink > 150 if scheme == "dark" else bg > 200 and ink < 100), "%s: the card in the page's colours (background %d, words %d)" % (what, bg, ink))
        if vp[0] == 390:
            ok(box and box["x"] >= 0 and box["x"] + box["width"] <= 390 and pg.evaluate("document.documentElement.scrollWidth <= 390"), "phone width: the card fits, no sideways scroll (%s)" % box)
        ctx.close()

    # ---- a screen's file that fails once: fetched again by itself, the page opens
    hits = {"n": 0}
    def flaky(route):
        hits["n"] += 1
        return route.abort() if hits["n"] == 1 else route.continue_()
    ctx, pg, errs = open_app(br, route=(re.compile(r".*/assets/Help-[^/]+\.js(\?.*)?$"), flaky))
    pg.evaluate("navHome('help')"); pg.wait_for_timeout(3000)
    ok(hits["n"] >= 2 and pg.locator("#app [data-crash-wall]").count() == 0 and pg.locator("#app .sp-head").count() == 1, "Help's file failing once: fetched again by itself, Help opens (%d fetches)" % hits["n"])
    ctx.close()
    # ---- a screen's file that keeps failing: the wall offers Reload
    hits2 = {"n": 0}
    ctx, pg, errs = open_app(br, route=(re.compile(r".*/assets/Help-[^/]+\.js(\?.*)?$"), lambda r: (hits2.__setitem__("n", hits2["n"] + 1), r.abort())))
    pg.evaluate("navHome('help')"); pg.wait_for_timeout(3500)
    c = pg.locator(WALL); t = c.inner_text() if c.count() else ""
    ok(c.count() == 1 and "could not be loaded" in t and "updated" in t, "Help's file failing twice: the wall says it could not be loaded, FinCom may have been updated (%s)" % t.replace("\n", " | ")[:200])
    ok(hits2["n"] == 2, "tried exactly twice (once more by itself), not in a loop (%d)" % hits2["n"])
    ok(pg.locator(WALL + " button", has_text="Reload FinCom").count() == 1 and pg.locator(WALL + " button", has_text="Go to Today").count() == 1, "with Reload FinCom and Go to Today")
    ok(pg.evaluate("window.__reports.length") >= 1, "the load failure reported")
    with pg.expect_navigation(timeout=10000):
        pg.click(WALL + " button:has-text('Reload FinCom')")
    ok(True, "Reload FinCom reloads the page")
    ctx.close()
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
