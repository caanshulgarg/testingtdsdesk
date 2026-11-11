"""python3 run_bell_tally_basic.py - the owner (11-Nov-2026): "When I open the Tally page from the bell (top bar
notifications), it redirects to the Advanced settings of the Tally page; it should go to the basic Tally page."
Checked here, offline with FinCom's cloud made up in the page (alerts_seed.SETUP), with Advanced (for support) left open
from an earlier visit (S.tallyMore.support), for every way into the Tally page from elsewhere:
  - the bell's item for a client's lines waiting: the BASIC Tally page (#/tally, never Sync activity), Advanced closed,
    that client's row marked and in view, and in that row a small "More settings" that opens Sync activity for the client
    (the advanced-only list where those lines are applied); Back from there returns to the basic page, Back again to the
    page the bell was opened on;
  - the top bar's Tally icon (its popover's "Open Tally page"), Client setup's "Open in Tally page", the Clients list's
    Tally chip: the basic page, Advanced closed, the row marked; Back returns to where it was opened; the icon saying
    entries need you adds the row's "More settings" (Sync activity), Client setup's link none;
  - Sync activity's "Open the Tally page" (Rec.openTallyPage) and its "← Tally": the basic page, Advanced closed;
  - the Tally page's own "Advanced (for support)" still opens and closes it (nothing else of it changed).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bell_tally_basic.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from alerts_seed import dev, SETUP, HELD_OURS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
srv = http.server.ThreadingHTTPServer(("localhost", int(os.environ.get("BELL_TALLY_PORT") or 0)), functools.partial(Q, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % srv.server_address[1]
# a line a person must settle (the month is locked): the bell's warn item for the client ("Apply them ... or unlock the month")
HELD = dict(HELD_OURS, id=777, line_id="L777", held_why="month locked: Oct-2026 is closed in FinCom")
# where the page is: the address, the page, the tab, Advanced open?, the rows marked, the marked row in view
WHERE = """() => { const f = [...document.querySelectorAll('#app [data-tsm-row][data-focus]')], r = f[0] && f[0].getBoundingClientRect();
  return {hash: location.hash, home: S.view === 'home' ? S.homeTab : S.view, tab: S.tallyTab || '', simple: !!document.querySelector('#app [data-tally-simple]'),
    adv: !!document.querySelector('#app [data-support-body]'), advToggle: !!document.querySelector('#app [data-support-toggle]'),
    focus: f.map(e => e.getAttribute('data-tsm-cid')), inView: !!r && r.top >= 0 && r.bottom <= innerHeight,
    more: [...document.querySelectorAll('#app [data-tally-more-go]')].map(e => [e.closest('[data-tsm-row]') ? e.closest('[data-tsm-row]').getAttribute('data-tsm-cid') : '', e.innerText.trim()])}; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 800}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    W = lambda: E(WHERE)
    cid = E(SETUP, [{"devs": [dev()], "alerts": [], "gap": None, "lines": [HELD]}, "owner"])
    def at_client(tab="dash"):
        # a new step in the browser's history for each place, as a person's clicks make
        E("([c, t]) => { S.view = 'company'; S.coId = c; S.loadingCo = false; S.alertsOpen = false; S.tallyPanel = false; if (t === 'cotally') { S.step = null; S.tab = t; render(); } else goClient(t); }", [cid, tab]); pg.wait_for_timeout(1300)
        return E("() => location.hash")
    def adv_left_open():
        # the owner opened Advanced (for support) on an earlier visit: it is remembered while FinCom is open
        E("() => { S.tallyMore = Object.assign({}, S.tallyMore, {support: true, page: true}); }")
    def basic(w, what):
        ok(w["hash"] == "#/tally" and w["home"] == "tally" and w["tab"] == "computers" and w["simple"], "%s: the basic Tally page (%s %s %s)" % (what, w["hash"], w["home"], w["tab"]))
        ok(not w["adv"] and w["advToggle"], "%s: Advanced (for support) closed (its toggle there)" % what)
        ok(w["focus"] == [cid] and w["inView"], "%s: the client's row marked and in view (%s %s)" % (what, w["focus"], w["inView"]))

    # ---- 1. the bell's item for the client's lines waiting
    back_to = at_client("dash"); adv_left_open()
    E("() => AlertHub.refresh(true)"); pg.wait_for_timeout(1200)
    pg.click("#cobar [data-bell]"); pg.wait_for_timeout(500)
    item = '[data-alerts-panel] [data-alert-key^="book:"]'
    ok(pg.locator(item).count() == 1 and pg.locator(item + " [data-alert-act]").count() == 1, "bell: the client's item, with its button")
    words = pg.inner_text(item) if pg.locator(item).count() else ""
    pg.click(item + " [data-alert-act]"); pg.wait_for_timeout(1800)
    w = W(); basic(w, "bell")
    ok(not E("() => !!S.alertsOpen"), "bell: closed after its button")
    ok(w["more"] == [[cid, "More settings"]], "bell: a small 'More settings' in the client's row (%s)" % w["more"])
    ok("Sync activity" not in words or "More settings" in words, "bell: the item's words point to the Tally page (%s)" % words.replace("\n", " ")[:200])
    pg.click("#app [data-tally-more-go]"); pg.wait_for_timeout(1300)
    ok(E("() => [location.hash, S.tallyTab, S.syncClient]") == ["#/tally/activity", "activity", cid], "More settings: Sync activity, for the client (%s)" % E("() => [location.hash, S.tallyTab, S.syncClient]"))
    pg.go_back(); pg.wait_for_timeout(1300)
    w = W(); ok(w["hash"] == "#/tally" and w["simple"] and not w["adv"], "Back from Sync activity: the basic page again, Advanced closed (%s)" % w["hash"])
    pg.go_back(); pg.wait_for_timeout(1300)
    ok(E("() => location.hash") == back_to, "Back again: the page the bell was opened on (%s)" % E("() => location.hash"))

    # ---- 2. the top bar's Tally icon: its popover's "Open Tally page"
    back_to = at_client("dash"); adv_left_open()
    pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top [data-tally-pop-page]", timeout=15000)
    pg.click("header.top [data-tally-pop-page]"); pg.wait_for_timeout(1800)
    # (the icon says "Some entries from Tally need you": the lines waiting, so the row has "More settings" to Sync activity too)
    w = W(); basic(w, "Tally icon"); ok(w["more"] == [[cid, "More settings"]], "Tally icon (entries need you): 'More settings' in the row (%s)" % w["more"])
    pg.go_back(); pg.wait_for_timeout(1300)
    ok(E("() => location.hash") == back_to, "Tally icon: Back returns to the client's page (%s)" % E("() => location.hash"))

    # ---- 3. Client setup's "Open in Tally page"
    back_to = at_client("cotally"); adv_left_open()
    pg.click("#app [data-tally-one-go]"); pg.wait_for_timeout(1800)
    w = W(); basic(w, "Client setup's Open in Tally page"); ok(w["more"] == [], "Client setup: no 'More settings' (nothing advanced asked)")
    pg.go_back(); pg.wait_for_timeout(1300)
    ok(E("() => location.hash") == back_to, "Client setup: Back returns there (%s)" % E("() => location.hash"))

    # ---- 4. the Clients list's Tally chip
    E("() => { S.tallyFocus = ''; navHome('clients'); }"); pg.wait_for_timeout(1200); adv_left_open()
    chip = "#app [data-tally-chip-at=clients]"
    ok(pg.locator(chip).count() >= 1, "Clients: the client's Tally chip")
    if pg.locator(chip).count(): pg.locator(chip).first.click(); pg.wait_for_timeout(1800); basic(W(), "Clients' Tally chip")

    # ---- 5. Sync activity: "Open the Tally page" (Rec.openTallyPage) and "← Tally"
    E("() => { Rec.openActivity(''); }"); pg.wait_for_timeout(1200); adv_left_open()
    E("() => Rec.openTallyPage()"); pg.wait_for_timeout(1500)
    w = W(); ok(w["hash"] == "#/tally" and w["simple"] and not w["adv"], "Sync activity's Open the Tally page: basic, Advanced closed (%s %s)" % (w["hash"], w["adv"]))
    E("(c) => openTallyFor(c, {to: 'activity'})", cid); pg.wait_for_timeout(1500)
    pg.click("#app [data-tally-more-go]"); pg.wait_for_timeout(1200)
    pg.click('#app [data-tally-tab="computers"]'); pg.wait_for_timeout(1500)
    w = W(); ok(w["hash"] == "#/tally" and w["simple"] and not w["adv"], "Sync activity's ← Tally: basic, Advanced closed (%s %s)" % (w["hash"], w["adv"]))

    # ---- 6. the page's own Advanced (for support) still opens and closes
    pg.click("#app [data-support-toggle]"); pg.wait_for_timeout(1200)
    ok(W()["adv"], "Advanced (for support): opens from its own toggle")
    pg.click("#app [data-support-toggle]"); pg.wait_for_timeout(600)
    ok(not W()["adv"], "Advanced (for support): closes again")

    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
