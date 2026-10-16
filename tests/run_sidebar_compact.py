"""python3 run_sidebar_compact.py - the sidebar takes less room (t70, 16-Oct-2026; the owner: "Side bar is also taking too
much space.. we can make good use of that space", and on the icons-only rail: "only icons make the system unreadable"),
used as a person would, on the fixture books:

  1. wider than 1440: 200 px (was 236), each item 32 px with a 16 px icon; up to 1440: 168 px, 30 px rows; the words
     always shown and none cut; the page beside it gains the room (.mainwrap wider); never folded on its own;
  2. the client's card: the name on one line (its full name in the title), the GSTIN under it, ▾ to change the client;
  3. the foot: one small line (where the work is kept, Sign in) and the rest (not shared, today's date, Your data) under ⓘ;
     a background event ("Audit ran on its own…") goes to the bell, not the sidebar;
  4. folded by the person: a 72 px rail, each item its icon with its words under it (two lines at most), remembered
     across a reload;
  5. a phone keeps its bar along the bottom.
Runs on the React build (app/dist-test) or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("SIDE_PORT") or 8344)
OUT = os.path.join(HERE, "out", "sidebar"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
GEO = """() => { const s = document.getElementById('side'), m = document.querySelector('.mainwrap'), r = (e) => e.getBoundingClientRect();
  const links = [...s.querySelectorAll('.side-link')].filter((e) => e.offsetParent);
  return {w: Math.round(r(s).width), main: Math.round(r(m).width), folded: s.classList.contains('side-folded'), scroll: s.scrollHeight - s.clientHeight,
    hs: [...new Set(links.map((e) => Math.round(r(e).height)))], icon: links.length ? Math.round(r(links[0].querySelector('svg')).width) : 0,
    words: links.map((e) => { const w = [...e.querySelectorAll(':scope > span:not(.side-count)')].find((x) => x.offsetParent); return w ? [w.innerText.trim(), Math.round(r(w).height / parseFloat(getComputedStyle(w).lineHeight)), w.scrollHeight > w.clientHeight + 3 || w.scrollWidth > w.clientWidth + 1] : ['', 0, false]; }),
    below: links.filter((e) => r(e).bottom > innerHeight).map((e) => e.dataset.side),
    cut: [...s.querySelectorAll('.side-link > span:not(.side-rail-word), .side-co b, .side-label, [data-side-foot] *')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.textContent),
    titles: links.every((e) => !!e.title)}; }"""

def start(br, w, h, fresh=True, ctx=None):
    ctx = ctx or br.new_context(viewport={"width": w, "height": h})
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    pg.evaluate("() => { S.booksTab = 'tds'; goClient('books:tds'); }"); pg.wait_for_timeout(1000)
    return ctx, pg

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        print("1. open, at 1440×900")
        ctx, pg = start(br, 1440, 900)
        E, W = pg.evaluate, pg.wait_for_timeout
        g = E(GEO)
        ok(not g["folded"] and g["w"] == 168, "1440: open, the compact 168 px (%s)" % g["w"])
        ok(g["hs"] == [30] and g["icon"] == 16, "1440: each item 30 px high, its icon 16 px (%s, %s)" % (g["hs"], g["icon"]))
        ok(all(len(w) >= 2 for w, _, _ in g["words"]), "every item says its words (%s)" % [w for w, _, _ in g["words"]][:4])
        ok(not g["cut"], "no word cut (%s)" % g["cut"][:4])
        ok(not g["below"] and g["scroll"] <= 0, "open at 1440×900: every item of the client in view, no scrolling (below %s, scroll %s)" % (g["below"], g["scroll"]))
        ok(g["main"] >= 1440 - 168 - 2, "the page beside it 1440 − 168 wide (was 1440 − 236) (%d)" % g["main"])
        pg.screenshot(path=os.path.join(OUT, "open-1440.png"))
        card = E("() => { const b = document.querySelector('#side .side-co'); const n = b.querySelector('b'); return {lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight || 18)), h: Math.round(n.getBoundingClientRect().height), title: b.title, text: b.innerText}; }")
        ok(card["h"] <= 22 and "▾" in card["text"] and E("CO().gstin") in card["text"] and E("CO().name") in (card["title"] + card["text"]), "the client's card: the name on one line, ▾, the GSTIN under it (%s)" % card)
        foot = E("() => { const f = document.querySelector('#side [data-side-foot]'); return f ? {h: Math.round(f.getBoundingClientRect().height), text: f.innerText} : null; }")
        ok(foot and foot["h"] <= 22 and "Sign in" in foot["text"], "the foot: one small line with Sign in (%s)" % foot)
        if pg.locator("#side [data-side-foot] summary").count(): pg.click("#side [data-side-foot] summary"); W(300)
        more = pg.inner_text("#side [data-side-foot-more]") if pg.locator("#side [data-side-foot-more]").count() else ""
        ok("Not shared" in more and "Today " in more and "Your data" in more, "ⓘ: not shared, today's date, Your data (%s)" % more.replace("\n", " / "))
        E("() => toast('Audit ran on its own: 3 findings. See Audit.', {background: true})"); W(400)
        ok(pg.locator("#side [data-quiet-note]").count() == 0, "a background event is not in the sidebar")
        pg.click("#cobar [data-bell]"); W(400)
        ok("Audit ran on its own" in pg.inner_text("[data-alerts-panel]"), "… it is in the bell")
        E("() => { S.alertsOpen = false; render(); }"); W(200)
        ctx.close()
        print("2. wider than 1440 (1600×1000): 200 px, 32 px rows")
        ctx, pg = start(br, 1600, 1000)
        E, W = pg.evaluate, pg.wait_for_timeout
        g = E(GEO)
        ok(not g["folded"] and g["w"] == 200 and g["hs"] == [32] and not g["cut"] and g["main"] >= 1600 - 200 - 2, "1600: 200 px, 32 px rows, no word cut, the page 1600 − 200 (%s, %s, %s)" % (g["w"], g["hs"], g["main"]))
        ctx.close()

        print("3. 1366×768: open with its words on a first visit; folded by the person: a rail with words")
        ctx, pg = start(br, 1366, 768)
        E, W = pg.evaluate, pg.wait_for_timeout
        g = E(GEO)
        ok(not g["folded"] and g["w"] == 168 and not g["cut"] and g["main"] >= 1366 - 168 - 2, "a first visit at 1366: not folded, 168 px, no word cut (%s, %s)" % (g["w"], g["cut"][:3]))
        pg.screenshot(path=os.path.join(OUT, "open-1366.png"))
        pg.click("#side .side-fold"); W(400)
        g = E(GEO)
        ok(g["folded"] and g["w"] == 72 and g["main"] >= 1366 - 72 - 2, "folded by the person: a 72 px rail (%s)" % g["w"])
        ok(all(len(w) >= 2 and n <= 2 and not clip for w, n, clip in g["words"]), "the rail: each icon with its words under it, two lines at most (%s)" % [x for x in g["words"] if not (len(x[0]) >= 2 and x[1] <= 2 and not x[2])][:4])
        ok(g["titles"], "and each its words as a tooltip too")
        pg.screenshot(path=os.path.join(OUT, "rail-1366.png"))
        pg.reload(); W(2500)
        ok(E("document.getElementById('side').classList.contains('side-folded')"), "the rail kept across a reload")
        pg.click("#side .side-fold"); W(300); pg.reload(); W(2500)
        ok(not E("document.getElementById('side').classList.contains('side-folded')"), "open again: kept across a reload")
        ctx.close()

        print("4. Inbox in the top bar, From Tally from the Tally panel (no Bring in in the sidebar)")
        ctx, pg = start(br, 1366, 768)
        E, W = pg.evaluate, pg.wait_for_timeout
        cid = E("S.coId")
        side = E("[...document.querySelectorAll('#side .side-link')].filter(e => e.offsetParent).map(e => e.dataset.side)")
        grp = E("[...document.querySelectorAll('#side .side-group')].map(e => e.innerText.trim())")
        ok("Inbox" not in side and "From Tally" not in side and "Bring in" not in grp, "the sidebar: no Inbox, no From Tally, no Bring in (%s, %s)" % (side, grp))
        g = E(GEO)
        ok(not g["below"] and not g["folded"], "1366×768, open with its words: every item of the client in view (below %s)" % g["below"])
        E("(c) => { S.docq = {t70a: {id: 't70a', client_id: c, status: 'waiting', receivedAt: '2026-10-16T09:00:00Z', name: 'bill.pdf'}, t70b: {id: 't70b', client_id: c, status: 'waiting', receivedAt: '2026-10-16T09:05:00Z', name: 'bill2.pdf'}}; render(); }", cid); W(400)
        ib = pg.locator("#cobar [data-topbar-inbox]")
        ok(ib.count() == 1 and ib.get_attribute("aria-label").startswith("Inbox") and ib.locator("[data-inbox-count]").inner_text() == "2", "the top bar: Inbox with its count, 2 waiting (%s)" % (ib.count() and ib.get_attribute("aria-label")))
        if ib.count(): ib.click(); W(900)
        ok(E("S.tab") == "clientInbox" and E("location.hash").endswith("/inbox"), "it opens the client's Inbox (%s)" % E("location.hash"))
        E("() => navHome('today')"); W(800)
        ib = pg.locator("#cobar [data-topbar-inbox]")
        ok(ib.count() == 1 and ib.locator("[data-inbox-count]").inner_text() == "2", "on the firm's pages too, every client's count (2)")
        if ib.count(): ib.click(); W(800)
        ok(E("S.view") == "home" and E("S.homeTab") == "inbox", "it opens the firm's Inbox (%s)" % E("S.homeTab"))
        E("(c) => { location.hash = '#/c/' + c + '/inbox'; }", cid); W(1200)
        ok(E("S.tab") == "clientInbox", "the old address …/inbox still opens the client's Inbox")
        E("(c) => { location.hash = '#/c/' + c + '/books/import'; }", cid); W(1200)
        ok(E("booksTab()") == "import" and pg.inner_text("#cobar .tbar-title h2").strip() == "From Tally", "…/books/import still opens From Tally")
        E("() => goClient('books:tds')"); W(800)
        E("() => doAct('tallyPanel')"); W(800)
        up = pg.locator("[data-overlay=tallypanel] [data-tp-upload]")
        ok(up.count() == 1 and "Upload" in up.inner_text(), "the Tally panel: Upload Day Book or masters (%s)" % (up.count() and up.inner_text()))
        if up.count(): up.click(); W(1000)
        ok(E("booksTab()") == "import", "… which opens From Tally's upload")
        pg.screenshot(path=os.path.join(OUT, "topbar-inbox-1366.png"))
        ctx.close()

        print("3. a phone")
        ctx, pg = start(br, 390, 844)
        ph = pg.evaluate("() => { const s = document.getElementById('side').getBoundingClientRect(); return [Math.round(s.top), Math.round(s.bottom), Math.round(s.height), innerHeight]; }")
        ok(ph[1] >= ph[3] - 40 and ph[2] < 120, "a phone: the bar along the bottom (%s)" % ph)
        ctx.close()
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
