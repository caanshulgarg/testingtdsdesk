"""python3 run_nav_clean.py - clean-up batch 1, "Find your way" (11-Oct-2026; the owner: "clean… anyone would love to
work in FinCom"), used as a person would, on the fixture books (tests/fixtures/books):

  1. the firm's sidebar: Today · Compliance · Clients · Tally · Integrations (zoho-books) · Settings · Help, Today lit on Today (and on the firm's
     Inbox, opened from Today), People and Plan and credit as Settings' sections (and the firm menu's items);
  2. a client's sidebar: Clients · Overview / Bring in: Inbox · From Tally / Work: Purchase · Bank · Sales · Transactions /
     Returns: TDS · GST / Books: Reports · MIS · Accounts · Audit · Look up · Letters / Client setup · Help (ui-tidy,
     13-Oct-2026: Clients first, from inside a client too, and in the phone's bar; was All clients at the foot);
  3. each page's title is its sidebar word (Overview, From Tally, TDS, GST, Audit, Tally, Settings, …); the Tally ledgers
     are a tab of From Tally, the tie-out a tab of Audit;
  4. old addresses still open their page: …/dash, …/books/import, …/books/ledgers (now the TDS page's Ledgers), …/books/tieout, #/settings/account;
     new ones #/people, #/plan, …/overview, …/from-tally are written back as the page's own address;
  5. one set of count words: To read · To review · Ready to post · Needs you on Today, Clients and Overview, and in the
     review table's status; none of "Need a look", "Need a check", "Waiting for Tally", "Needs a check";
  6. no in-page "Back to…" that the sidebar covers (Tally page, Client setup); the sidebar's client card goes back;
  7. one name for bringing the Tally data in: "Bring in from Tally";
  8. a phone (390 px): the bar Overview · Purchase · Bank · Sales · More (Today · Compliance · Clients · Tally · More on
     the firm's pages); More opens a sheet with the rest, which opens a page and closes.
Layout and words only. Runs on the React build (app/dist-test) or TDSDESK_SITE. Screenshots to tests/out/nav_clean/."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("NAV_PORT") or 8343)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "nav_clean"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
OLD_WORDS = ["Need a look", "Need a check", "Waiting for Tally", "Needs a check"]
BRING_OLD = ["Upload Tally data", "Import ledger list", "Read the books from Tally", "Choose day book files", "Upload the ledger masters"]

def start(p, w, h):
    pg = p.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(2000)
    pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    return pg

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(); pg = start(br, 1440, 1000)
        E, W = pg.evaluate, pg.wait_for_timeout
        cid = E("S.coId")
        side = lambda: E("[...document.querySelectorAll('#side .side-link')].filter(e => e.offsetParent !== null).map(e => e.dataset.side || e.innerText.trim())")
        groups = lambda: E("[...document.querySelectorAll('#side .side-group')].map(e => e.innerText.trim())")
        lit = lambda: E("[...document.querySelectorAll('#side .side-link[aria-current=page]')].filter(e => e.offsetParent !== null).map(e => e.dataset.side)")
        title = lambda: pg.inner_text("#cobar .tbar-title h2").strip()
        def hash_go(h, wait=1300):
            E("(h) => { location.hash = h; }", h); W(wait)

        print("1. the firm's sidebar")
        E("navHome('today')"); W(1200)
        ok(side() == ["Today", "Compliance", "Clients", "Tally", "Integrations", "Settings", "Help"], "firm: Today · Compliance · Clients · Tally · Integrations · Settings · Help (%s)" % side())
        ok(lit() == ["Today"] and title() == "Today", "Today is lit on Today, and titled Today (%s)" % lit())
        pg.screenshot(path=os.path.join(OUT, "desk-firm-today.png"))
        E("navHome('inbox')"); W(600)
        ok(lit() == ["Today"], "the firm's Inbox (opened from Today's To read) lights Today")
        for label, want_hash, want_title in [("Compliance", "#/compliance", "Compliance"), ("Clients", "#/clients", "Clients"), ("Tally", "#/tally", "Tally"), ("Integrations", "#/integrations", "Integrations"), ("Settings", "#/settings", "Settings"), ("Help", "#/help", "Help"), ("Today", "#/today", "Today")]:
            pg.click('#side .side-link[data-side="%s"]' % label); W(900)
            ok(E("location.hash") == want_hash and title() == want_title and lit() == [label], "%s: %s, titled %s, lit (%s, %s, %s)" % (label, want_hash, want_title, E("location.hash"), title(), lit()))
        # People and Plan and credit: Settings' sections, and the firm menu's
        E("navHome('today')"); W(400)
        pg.click("#cobar .firmbtn"); W(500)
        menu = E("[...document.querySelectorAll('.firmmenu .fm-item')].map(e => e.innerText.trim())")
        ok(menu[:3] == ["Settings", "People", "Plan and credit"], "the firm menu: Settings · People · Plan and credit (%s)" % menu)
        pg.click('.firmmenu .fm-item:has-text("People")'); W(800)
        ok(E("S.homeTab") == "rules" and E("S.settingsTab") == "account" and title() == "Settings" and lit() == ["Settings"], "People opens Settings → its section, titled Settings")
        hash_go("#/plan")
        ok(E("S.settingsTab") == "plan" and E("location.hash") == "#/settings/plan", "#/plan opens Settings → Plan and credit (%s)" % E("location.hash"))
        hash_go("#/people")
        ok(E("S.settingsTab") == "account" and E("location.hash") == "#/settings/account", "#/people opens Settings → People")

        print("2. a client's sidebar and its titles")
        E("(c) => openCompany(c)", cid); W(800); E("() => { S.books = window.__bk; goClient('dash'); }"); W(1000)
        # ui-tidy (13-Oct-2026): Clients first (was All clients at the foot)
        # t70 (16-Oct-2026; the owner): Inbox is the top bar's tray, From Tally reached from the Tally panel (no "Bring in")
        want = ["Clients", "Overview", "Purchase", "Bank", "Sales", "Transactions", "TDS", "GST", "Reconciliations", "Reports", "MIS", "Accounts", "Audit", "Look up", "Letters", "Client setup", "Help"]
        ok(side() == want, "client: the tree in order (%s)" % side())
        ok(groups() == ["Work", "Returns", "Books"], "groups: Work · Returns · Books (%s)" % groups())
        ok("TDS & GST" not in side() and "Dashboard" not in side(), "no TDS & GST, no Dashboard")
        pg.screenshot(path=os.path.join(OUT, "desk-client-overview.png"))
        titles = {"Overview": "Overview", "Purchase": "Purchase", "Bank": "Bank", "Sales": "Sales", "Transactions": "Transactions",
                  "TDS": "TDS", "GST": "GST", "Reconciliations": "Reconciliations", "Reports": "Reports", "MIS": "MIS", "Accounts": "Accounts", "Audit": "Audit", "Look up": "Look up", "Letters": "Letters", "Client setup": "Client setup"}
        for label, t in titles.items():
            pg.click('#side .side-link[data-side="%s"]' % label); W(1100)
            ok(title() == t and lit() == [label], "%s: titled %s and lit (%s, %s)" % (label, t, title(), lit()))
        pg.click('#side .side-link[data-side="TDS"]'); W(900)
        ok(pg.locator('#app nav[aria-label="Books"]').count() == 0 and pg.locator('#app nav[aria-label="From Tally"]').count() == 0, "TDS: no row of book tabs (the sidebar is the way)")
        print("3. the TDS and GST ledgers on the TDS and GST pages (ledger-confirm, 14-Oct-2026); the tie-out a tab of Audit")
        pg.click('#cobar [data-topbar-inbox]'); W(1000)
        ok(title() == "Inbox" and E("S.tab") == "clientInbox", "the top bar's Inbox opens the client's Inbox (%s)" % title())
        E("() => goClient('books:import')"); W(900)
        ok(title() == "From Tally", "From Tally still opens (%s)" % title())
        ok(pg.locator('#app nav[aria-label="From Tally"] button[data-books-tab="ledgers"]').count() == 0, "From Tally: no Tally ledgers tab")
        E("() => booksTabGo('ledgers')"); W(900)
        ok(E("booksTab()") == "tds" and E("S.tdsView") == "ledgers" and title() == "TDS" and lit() == ["TDS"] and E("location.hash").endswith("/books/tds/ledgers/all"), "the Tally ledgers: the TDS page's Ledgers, its own address (%s)" % [E("booksTab()"), E("S.tdsView"), title(), lit(), E("location.hash")])
        pg.click('#side .side-link[data-side="Audit"]'); W(900)
        at = E("[...document.querySelectorAll('#app nav[aria-label=\"Audit\"] button')].map(b => b.innerText.trim())")
        ok(at[-1:] == ["Tie-out with Tally"], "Audit's tabs end with Tie-out with Tally (%s)" % at)
        pg.click('#app nav[aria-label="Audit"] button[data-audit-tab="tieout"]'); W(900)
        ok(E("booksTab()") == "tieout" and pg.locator("#app [data-tieout]").count() == 1 and title() == "Audit" and lit() == ["Audit"] and E("location.hash").endswith("/books/tieout"), "Tie-out: in Audit, its own address")
        pg.click('#app nav[aria-label="Audit"] button[data-audit-tab="find"]'); W(900)
        ok(E("booksTab()") == "audit" and E("S.auditTab") == "find", "back to Findings from the tie-out")

        print("4. old and new addresses")
        c = "#/c/" + cid + "/"
        for h, bt, t, canon in [(c + "dash", None, "Overview", c + "dash"), (c + "overview", None, "Overview", c + "dash"), (c + "books/import", "import", "From Tally", c + "books/import"),
                                (c + "from-tally", "import", "From Tally", c + "books/import"), (c + "from-tally/ledgers", "tds", "TDS", c + "books/tds/ledgers/all"),
                                (c + "books/tieout", "tieout", "Audit", c + "books/tieout"), (c + "books/tds", "tds", "TDS", None), (c + "books/gst", "gst", "GST", None)]:
            hash_go(h)
            ok(title() == t and (bt is None or E("booksTab()") == bt) and (canon is None or E("location.hash") == canon), "%s → %s (%s)" % (h.replace(c, "…/"), t, E("location.hash").replace(c, "…/")))

        print("5. one set of count words")
        E("() => goClient('dash')"); W(1000)
        tiles = E("[...document.querySelectorAll('#app .dtile > span')].map(e => e.innerText.trim())")
        ok(tiles[:3] == ["To read", "To review", "Ready to post"], "Overview: To read · To review · Ready to post (%s)" % tiles)
        E("navHome('today')"); W(1000)
        mt = E("[...document.querySelectorAll('#app .metric > span')].map(e => e.innerText.trim())")
        ok(mt == ["To read", "To review", "Ready to post", "Needs you"], "Today: To read · To review · Ready to post · Needs you (%s)" % mt)
        th = E("[...document.querySelectorAll('#app table thead th')].map(e => e.innerText.trim()).filter(Boolean)")
        ok(all(w in th for w in ["To read", "To review", "Ready to post", "Needs you"]), "Today's table in the same words (%s)" % th)
        E("navHome('clients')"); W(1000)
        th = E("[...document.querySelectorAll('#app table thead th')].map(e => e.innerText.trim()).filter(Boolean)")
        ok(all(w in th for w in ["To review", "Ready to post", "Needs you"]), "Clients: To review · Ready to post · Needs you (%s)" % th)
        seen = []
        for go in ["navHome('today')", "navHome('clients')", "goClient('dash')"]:
            if go.startswith("goClient"): E("(c) => openCompany(c)", cid); W(600)
            # the count words: the tiles' and the tables' headings ("Waiting for Tally" stays a Tally link's state word)
            E(go); W(900); txt = " | ".join(E("[...document.querySelectorAll('#app thead th, #app .metric > span, #app .dtile > span, #app .dtile > small')].map(e => e.innerText)"))
            seen += [w for w in OLD_WORDS if w in txt]
        E("() => { S.tab = 'invoices'; S.reviewTable = true; S.filter = 'draft'; S.step = null; render(); }"); W(1000)
        txt = " | ".join(E("[...document.querySelectorAll('#app thead th, #app .tag')].map(e => e.innerText)")); seen += [w for w in OLD_WORDS if w in txt]
        ok(not seen, "none of the old count words on Today, Clients, Overview, the review table (%s)" % seen)
        # the review table's status words, in the built program (the fixture client has no bills to review)
        src = open(os.path.join(SITE, "assets", next(f for f in os.listdir(os.path.join(SITE, "assets")) if f.startswith("index") and f.endswith(".js")))).read() if os.path.isdir(os.path.join(SITE, "assets")) else ""
        # upload-pages (14-Oct-2026): "Check" (the one-at-a-time list's word), not "Needs you", which was also the Tally chip's
        ok(not src or ('"Check":"Ready to approve"' in src and "Needs a check" not in src), "the review table's status: Check / Ready to approve")

        print("6. no in-page Back to…; the sidebar's client card goes back")
        E("() => { S.tallyFocus = ''; navHome('tally'); }"); W(1200)
        ok(pg.locator("#app [data-back-client]").count() == 0 and "Back to" not in pg.inner_text("#app"), "the Tally page has no '← Back to <client>'")
        card = pg.locator('#side [data-side-client="back"]')
        ok(card.count() == 1, "on a firm page the sidebar's client card goes back to the client")
        card.click(); W(1200)
        ok(E("S.view") == "company" and E("S.coId") == cid, "the client card opens the client again")
        E("() => { S.step = null; S.tab = 'settings'; render(); }"); W(900)
        ok("Back to the work" not in pg.inner_text("#cobar"), "Client setup: no 'Back to the work' in the header")

        print("7. Bring in from Tally")
        E("() => goClient('books:import')"); W(1000)
        ok(pg.locator('#cobar button:has-text("Bring in from Tally")').count() == 1, "From Tally's main button: Bring in from Tally")
        bad = []
        for go in ["goClient('books:import')", "goClient('books:ledgers')", "goClient('books:tds')", "goClient('dash')", "navHome('clients')"]:
            if go.startswith("navHome"): E(go)
            else: E("(c) => openCompany(c).then(() => { %s })" % go, cid)
            W(1000); txt = pg.inner_text("#cobar") + pg.inner_text("#app"); bad += [(go, w) for w in BRING_OLD if w in txt]
        ok(not bad, "no other names for it on From Tally, ledgers, TDS, Overview, Clients (%s)" % bad)
        pg.close()

        print("8. a phone: five in the bar, More for the rest")
        ph = start(br, 390, 844); E2, W2 = ph.evaluate, ph.wait_for_timeout
        bar = lambda: E2("[...document.querySelectorAll('#side .side-link')].filter(e => e.offsetParent !== null).map(e => (e.dataset.side || e.innerText).trim())")
        E2("navHome('today')"); W2(1000)
        ok(bar() == ["Today", "Compliance", "Clients", "Tally", "More"], "firm bar: Today · Compliance · Clients · Tally · More (%s)" % bar())
        ph.screenshot(path=os.path.join(OUT, "phone-firm-today.png"))
        E2("(c) => openCompany(c).then(() => { S.books = window.__bk; goClient('dash'); })", cid); W2(1200)
        # ui-tidy (13-Oct-2026): Clients in the client's bar too; Sales under More
        ok(bar() == ["Clients", "Overview", "Purchase", "Bank", "More"], "client bar: Clients · Overview · Purchase · Bank · More (%s)" % bar())
        sw = E2("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok(sw <= 0, "no sideways scroll (%s)" % sw)
        ph.screenshot(path=os.path.join(OUT, "phone-client-bar.png"))
        ph.click("#side .side-more"); W2(600)
        sheet = E2("[...document.querySelectorAll('[data-side-sheet] .side-link')].map(e => e.dataset.side)")
        # (t70: the Inbox is the top bar's tray on a phone too; From Tally from the Tally panel)
        ok(E2("(() => { const b = document.querySelector('#cobar [data-topbar-inbox]'); return !!b && b.getBoundingClientRect().width > 0; })()"), "a phone: the Inbox in the top bar")
        ok(sheet == ["Sales", "Transactions", "TDS", "GST", "Reconciliations", "Reports", "MIS", "Accounts", "Audit", "Look up", "Letters", "Client setup", "Help"], "More: the rest, in order (%s)" % sheet)
        ph.screenshot(path=os.path.join(OUT, "phone-more-sheet.png"))
        ph.click('[data-side-sheet] .side-link[data-side="GST"]'); W2(1200)
        ok(E2("booksTab()") == "gst" and ph.locator("[data-side-sheet]").count() == 0, "a page from More opens, and the sheet closes")
        ok(E2("document.querySelector('#side .side-more').getAttribute('aria-current')") == "page", "More is lit while on a page it holds")
        ph.click("#side .side-more"); W2(500); ph.keyboard.press("Escape"); W2(400)
        ok(ph.locator("[data-side-sheet]").count() == 0, "Esc closes the sheet")
        ph.close(); br.close()
finally:
    srv.shutdown()
if errors: print("page errors:", errors[:5])
print("\n%d failed" % len(fails) if fails or errors else "\nall passed")
sys.exit(1 if fails or errors else 0)
