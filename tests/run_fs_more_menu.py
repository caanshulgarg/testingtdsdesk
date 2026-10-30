"""python3 run_fs_more_menu.py - a page's tab row "More" menu opens under its button (owner, 30-Oct-2026: on Safari the
Financial statements page's More menu, "Fixed assets & deferred tax", opened at the far left over the sidebar).

The menu used to be absolutely positioned with no top / left of its own (the browser's "static position" inside the tab
row's flex box), which Safari places differently from Chromium. Now it is placed from its button's own rectangle. On the
React build (app/dist-test, or TDSDESK_SITE), in Chromium and, when installed, WebKit, at 1440, 1366 and 390 wide:
  - the menu's top is just under the More button and its left edge lines up with the button (moved in only to stay on
    screen), the whole menu inside the window;
  - it is placed by its own coordinates (position fixed, top and left set), never left to the static position;
  - its item opens the tab; Esc closes it; a click outside closes it."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Q, directory=SITE)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BOOKS = json.load(open(os.path.join(HERE, "fixtures", "fin-depr", "books.json")))
SETUP = """(F) => {
  const c = newCompany({name: "Wren Systems Private Limited (made-up)"}); c.pan = "AABCW1234F";
  S.companies[c.id] = c; Store.saveCompany(c); S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const under = Object.assign({}, F.groups), led = {};
  Object.entries(F.open).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
  const vouchers = F.vouchers.map((v, i) => ({id: "v" + i, date: v[0], no: String(i + 1), type: v[1], narr: v[2], ent: v[3].map(([l, a]) => ({l, a: -a}))}));
  const b = {loading: false, cid: c.id, challans: [], alloc: {}, ledInfo: {}, gstins: {}, pans: {}, states: {}, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, msme: {},
    under, groups: {}, vouchers, meta: {from: "20250401", to: "20260331"}, tb: {from: "20250401", to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led}, fs: JSON.parse(JSON.stringify(F.fs))};
  b.map = Books.mapLedgers(b.vouchers, {});
  S.books = b; S.fsFy = "2025"; S.fin = null; saveBooks(); goClient('books:fs'); }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
GEO = """() => { const d = document.querySelector('#app nav.fin-tabs details.more'), s = d.querySelector(':scope > summary'), p = d.querySelector(':scope > .more-pop');
  const a = s.getBoundingClientRect(), b = p.getBoundingClientRect(), cs = getComputedStyle(p);
  return {open: d.open, btn: [a.left, a.top, a.right, a.bottom], pop: [b.left, b.top, b.right, b.bottom], vw: document.documentElement.clientWidth, vh: innerHeight,
    pos: cs.position, topSet: p.style.top !== "", leftSet: p.style.left !== "", visible: b.width > 0 && b.height > 0}; }"""

with sync_playwright() as pw:
    engines = [("chromium", pw.chromium)]
    try:
        b = pw.webkit.launch(); b.close(); engines.append(("webkit", pw.webkit))
    except Exception:
        print("  (WebKit is not installed here: Chromium only)")
    for name, eng in engines:
        br = eng.launch()
        for w in (1440, 1366, 390):
            print("\n%s, %d wide" % (name, w))
            ctx = br.new_context(viewport={"width": w, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
            pg.evaluate(SETUP, BOOKS); pg.wait_for_timeout(2500)
            more = pg.locator("#app nav.fin-tabs details.more > summary")
            ok(more.count() == 1, "the tab row has its More")
            more.scroll_into_view_if_needed(); more.click(); pg.wait_for_timeout(400)
            g = pg.evaluate(GEO)
            bl, bt, br_, bb = g["btn"]; pl, pt, pr, pb = g["pop"]
            ok(g["open"] and g["visible"], "the menu opens")
            ok(bb - 1 <= pt <= bb + 12, "it opens just under the button (button bottom %.0f, menu top %.0f)" % (bb, pt))
            ok(abs(pl - bl) <= 2 or (pr <= g["vw"] - 4 and pl < bl), "its left edge lines up with the button, moved in only to stay on screen (button %.0f, menu %.0f-%.0f)" % (bl, pl, pr))
            ok(pl >= 0 and pr <= g["vw"] and pb <= g["vh"], "the whole menu is inside the window (%.0f-%.0f of %d)" % (pl, pr, g["vw"]))
            ok(g["pos"] == "fixed" and g["topSet"] and g["leftSet"], "placed by its own coordinates, not the browser's static position (%s, top %s, left %s)" % (g["pos"], g["topSet"], g["leftSet"]))
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            ok(not pg.evaluate("document.querySelector('#app nav.fin-tabs details.more').open"), "Esc closes it")
            more.click(); pg.wait_for_timeout(300)
            pg.mouse.click(g["vw"] - 20, 880); pg.wait_for_timeout(300)
            ok(not pg.evaluate("document.querySelector('#app nav.fin-tabs details.more').open"), "a click outside closes it")
            more.click(); pg.wait_for_timeout(300)
            pg.locator("#app nav.fin-tabs details.more [data-fin-tab=depr]").click(); pg.wait_for_timeout(1200)
            ok(pg.locator("#app [data-fin-depr]").count() == 1 and not pg.evaluate("document.querySelector('#app nav.fin-tabs details.more').open"), "its item opens Fixed assets & deferred tax, and the menu closes")
            if w == 1440 and name == "chromium":
                more.click(); pg.wait_for_timeout(300)
                shots = os.environ.get("FS_MORE_SHOTS")
                if shots: os.makedirs(shots, exist_ok=True); pg.screenshot(path=os.path.join(shots, "more-menu-%s-%d.png" % (name, w)))
            ctx.close()
        br.close()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
