"""python3 run_clean_b2.py - clean-up batch 2, "One main button, one place for each thing" (11-Oct-2026, owner-approved),
used as a person would, on the made-up client of shots_ui_pass.py (4 bills) with the fixture books (tests/fixtures/books):

  1. one main (primary) button a page: exactly one on Clients (Add client), Post to Tally (Post N to Tally; Upload is
     plain there), In Tally, Tally ledgers (Confirm N), Audit after a run (Run now), MIS, From Tally; at most one on every
     other page and state checked; Transactions has none (Excel and CSV under Download);
  2. each thing moved is still reachable: Clients' More (upload for any client, Day Books for several clients, the
     reading check), the records used (Settings → Plan and credit), the Overview's cards (More about this client), what
     was posted lately (Purchase → In Tally), Post to Tally's REMOTEID test (its More), Audit's and Transactions'
     downloads (Download), asking the books (Look up, and "/");
  3. one home for each repeated thing, the others a line that links there: FinCom Bridge on this computer and Everything
     sent to Tally (the Tally page; Settings, In Tally and the Tally panel link there), the Link to Tally card (Client
     setup → Tally; From Tally and the Overview show its one status line and link there), People and Plan (Settings);
  4. old addresses still open: #/settings/bridge, #/settings/postlog, #/people, #/plan, …/dash;
  5. a phone (390 px): the Clients page lists the clients first (no drop zone before the list), one primary.
Layout and words only. Runs on the React build (app/dist-test) or TDSDESK_SITE. Screenshots to tests/out/clean_b2/."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CLEAN_B2_PORT") or 8347)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "clean_b2"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
# the made-up client with its 4 bills (shots_ui_pass.py), the fixture books on it for two years, and three more clients
SEED0 = re.search(r'SEED = """(.*?)"""', open(os.path.join(HERE, "shots_ui_pass.py")).read(), re.S).group(1)
SEED = """(bk) => { const seed = %s; const cid = seed(null); const c = S.companies[cid];
  for (const [n, g] of [["Mehra Textiles LLP", "07AAAFM1234K1Z5"], ["Iyer Foods Private Limited", "29AAACI9876L1Z2"], ["Bansal & Sons", ""]]) { const o = newCompany({name: n, gstin: g}); S.companies[o.id] = o; o.stats = {}; S.data[o.id] = {parties: {}, entries: {}, loaded: true}; }
  S.coId = cid; const b = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: cid});
  S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
  S.account = Object.assign(S.account || {}, {me: {role: 'owner', user_id: 'u-owner', name: 'Owner'}}); render(); return cid; }""" % SEED0

PRIMARY = """() => [...document.querySelectorAll('#cobar .primary, #app .primary, #cobar [data-tone=primary], #app [data-tone=primary]')]
  .filter(e => e.offsetParent !== null && e.getBoundingClientRect().width > 0 && !e.closest('details:not([open])')).map(e => (e.innerText || '').trim())"""
CL = lambda js: "() => { S.view = 'company'; S.books = window.__bk; " + js + " }"
HOME = lambda t: "() => { navHome('%s'); }" % t
# [name, how to open it, how many primaries: 1 exactly, or None for at most one]
PAGES = [
    ("clients", HOME("clients"), 1), ("today", HOME("today"), None), ("tally", "() => { S.tallyFocus = ''; S.tallyTab = 'computers'; navHome('tally'); }", None),
    ("settings", "() => goSettings(null)", None), ("settings-bridge", "() => goSettings('bridge')", None), ("settings-postlog", "() => goSettings('postlog')", None),
    ("people", "() => goSettings('account')", None), ("plan", "() => goSettings('plan')", None),
    ("overview", CL("goClient('dash');"), None), ("purchase-review", CL("goClient('bills');"), 1),
    ("post", CL("S.postTabs = {}; goStep('post', 'bills');"), 1), ("in-tally", CL("goStep('done', 'bills');"), 1),
    ("bank", CL("goClient('bank');"), None), ("sales", CL("goClient('sales');"), None), ("transactions", CL("goClient('txn');"), 0),
    ("from-tally", CL("goClient('books:import');"), 1), ("ledgers", CL("goClient('books:ledgers');"), 1),
    ("tds", CL("goClient('books:tds');"), None), ("gst", CL("goClient('books:gst');"), None), ("reports", CL("goClient('books:reports');"), None),
    ("mis", CL("goClient('books:mis'); const dr = Audit.defaultRange(S.books); MIS.run(Audit.iso(dr.from), Audit.iso(dr.to), 'run now'); render();"), 1),
    ("audit", CL("goClient('books:audit'); S.auditTab = 'find'; const dr = Audit.defaultRange(S.books); Audit.run(dr.from, dr.to, 'by hand'); render();"), 1),
    ("audit-3cd", CL("goClient('books:audit'); S.auditTab = '3cd'; render();"), None),
    ("lookup", CL("goClient('books:lookup');"), None), ("letters", CL("goClient('books:letters');"), None),
    ("client-setup", CL("S.step = null; S.tab = 'settings'; render();"), None), ("client-setup-tally", CL("S.step = null; S.tab = 'cotally'; render();"), None),
]

def start(p, w, h):
    pg = p.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    cid = pg.evaluate(SEED, books); pg.wait_for_timeout(1200)
    return pg, cid

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(); pg, cid = start(br, 1440, 1000)
        E, W = pg.evaluate, pg.wait_for_timeout
        title = lambda: pg.inner_text("#cobar .tbar-title h2").strip()
        app = lambda: pg.inner_text("#app")
        def go(js, wait=1300):
            pg.keyboard.press("Escape"); E("() => { S.tallyPanel = false; S.firmMenu = false; }"); E(js); W(wait)
        def hash_go(h, wait=1300):
            E("(h) => { location.hash = h; }", h); W(wait)

        print("1. one main button a page")
        for name, js, want in PAGES:
            go(js); prim = E(PRIMARY)
            ok((len(prim) == want) if want is not None else len(prim) <= 1, "%s: %s main button%s (%s)" % (name, "exactly %d" % want if want is not None else "at most one", "" if want == 1 else "s", prim))
        go(CL("S.postTabs = {}; goStep('post', 'bills');"))
        ok(pg.locator('#cobar [data-upload="bills"]').count() == 1 and "primary" not in (pg.get_attribute('#cobar [data-upload="bills"]', "class") or ""), "Post to Tally: Upload bills is there, as a plain button")
        ok(E("[...document.querySelectorAll('#app [data-post-main]')].map(b => b.className).join(' ')").count("primary") == 1, "Post to Tally: Post N to Tally is the one main button")
        ok("primary" not in (pg.get_attribute("#app [data-post-action]", "class") or "") if pg.locator("#app [data-post-action]").count() else True, "Post to Tally: the banner's 'Choose the Tally company' is plain")
        pg.screenshot(path=os.path.join(OUT, "desk-post.png"))
        go(CL("goClient('books:ledgers');"))
        ok(pg.locator("#app [data-led-upload-btn]").count() in (0, 1) and all("primary" not in (c or "") for c in E("[...document.querySelectorAll('#app [data-led-upload-btn]')].map(b => b.className)")), "Tally ledgers: Bring in from Tally is plain")

        print("2. what moved is still reachable")
        go(HOME("clients"))
        ok(pg.locator("#app .drop").count() == 0 and "Upload invoices for any client" not in app() and pg.locator("#app .rcheck").count() == 0, "Clients: no drop zone and no reading check on the page")
        ok("records used" not in app(), "Clients: no 'records used' line")
        ok(E("[...document.querySelectorAll('#app thead th')].map(e => e.innerText.trim())")[:1] == ["Client"], "Clients: the list is the page")
        pg.screenshot(path=os.path.join(OUT, "desk-clients.png"))
        for k, check, label in [("upload", "#app [data-clients-panel=upload] .drop", "Upload bills for any client: its drop zone"),
                                ("daybooks", "#app [data-clients-panel=daybooks] button:has-text('Bring in from Tally')", "Day Books for several clients: its Bring in from Tally"),
                                ("reading", "#app [data-clients-panel=reading] .rcheck", "Reading check: the reading engines")]:
            pg.click("#app [data-clients-more] > summary"); W(300)
            pg.click("#app [data-clients-open=%s]" % k); W(600)
            ok(pg.locator(check).count() == 1, "Clients → More → " + label)
            if k == "upload": pg.screenshot(path=os.path.join(OUT, "desk-clients-upload.png"))
            pg.click("#app [data-clients-panel-close]"); W(400)
            ok(pg.locator("#app [data-clients-panel]").count() == 0, "  … and Close folds it away")
        pg.click("#app [data-add-client]"); W(500)
        ok(pg.locator("#app #ncName").count() == 1 and len(E(PRIMARY)) == 1, "Add client opens its form, with one main button (Add and open)")
        E("() => doAct('cancelCo')"); W(400)
        go("() => goSettings('plan')")
        ok(pg.locator("#app [data-records-used]").count() == 1 and "records used" in pg.inner_text("#app [data-records-used]"), "Settings → Plan and credit: the records used")
        go(CL("goClient('dash');"))
        ok(pg.locator("#app .dash-ask").count() == 0 and pg.locator("#app .dash-tiles .dtile").count() == 4, "Overview: no ask box, the four counts")
        ok(E("[...document.querySelectorAll('#app .dash > section, #app .dash > details, #app .dash > div')].map(e => e.className)")[:1] in (["dash-card onb"], ["onb-fold"]), "Overview: the getting-ready checklist first")
        ok(pg.locator("#app [data-dash-more]:not([open])").count() == 1, "Overview: More about this client, folded")
        pg.screenshot(path=os.path.join(OUT, "desk-overview.png"))
        pg.click("#app [data-dash-more] > summary"); W(400)
        txt = pg.inner_text("#app [data-dash-more]")
        ok(all(w in txt for w in ["TDS", "On bills approved here", "Bank", "Sales"]), "  … it holds the TDS, Bank and Sales cards")
        E("() => { const co = CO(); co.onbHide = true; render(); }"); W(600)
        ok(pg.locator("#app [data-onb-folded=hidden]").count() == 1, "Overview: the checklist hidden folds to one line (it can be opened again)")
        pg.click("#app [data-onb-folded] > summary"); W(300)
        ok(pg.locator("#app [data-onb-show]").count() == 1, "  … with Show the card again")
        E("() => { const co = CO(); co.onbHide = false; render(); }"); W(400)
        pg.keyboard.press("/"); W(900)
        ok(E("booksTab()") == "lookup" and pg.locator("#lkAsk").count() == 1, "'/' opens Look up, where the books are asked")
        go(CL("goStep('done', 'bills');"))
        # upload-pages (14-Oct-2026): Purchase → In Tally is Post to Tally's list of what is in Tally, newest first
        ok(pg.locator("#app [data-post-panel=posted]").count() == 1, "Purchase → In Tally: what is in Tally, newest first")
        ok("Bank lines in Tally" not in app() and "Everything sent to Tally" not in E("[...document.querySelectorAll('#app h2')].map(e => e.innerText).join('|')"), "Purchase → In Tally: no bank lines, no copy of the post log")
        go(CL("S.postTabs = {}; goStep('post', 'bills');"))
        ok(pg.locator("#app [data-remoteid-test]").count() == 1 and not pg.locator("#app [data-remoteid-test]").is_visible(), "Post to Tally: the REMOTEID test is not on the page")
        pg.click("#app [data-more=post] > summary"); W(300)
        ok(pg.locator("#app [data-more=post] [data-remoteid-test]").is_visible(), "  … it is under More")
        ok(pg.locator("#app [data-more=post] button:has-text('Download Tally file')").count() == 1, "  … with Download Tally file")
        go(CL("goClient('txn');"))
        pg.click("#app [data-txn-download] > summary"); W(300)
        ok(pg.locator("#app [data-txn-excel]").is_visible() and pg.locator("#app [data-txn-csv]").is_visible(), "Transactions → Download: Excel and CSV")
        go(CL("goClient('books:audit'); S.auditTab = 'find'; const dr = Audit.defaultRange(S.books); Audit.run(dr.from, dr.to, 'by hand'); render();"))
        pg.click("#app [data-audit-download] > summary"); W(300)
        ok(pg.locator("#app [data-audit-report]").is_visible() and pg.locator("#app [data-audit-download] .more-item").count() == 3, "Audit → Download: the report, the Excel, the Tally file")
        ok(pg.locator("#app button:text-is('Finalise this report')").count() == 1, "Audit: Finalise this report, plain")

        print("3. one home for each repeated thing")
        go("() => goSettings('bridge')")
        ok(pg.locator("#app [data-connect-section]").count() == 0 and pg.locator("#app [data-home-link=bridge]").count() == 1, "Settings → FinCom Bridge: one line, no copy of the card")
        ok(pg.locator("#app [data-confirm-foot]").count() == 0, "  … and no Save bar beside 'Nothing to save'")
        pg.screenshot(path=os.path.join(OUT, "desk-settings-bridge.png"))
        pg.click("#app [data-home-go=bridge]"); W(1300)
        ok(E("S.homeTab") == "tally" and title() == "Tally" and pg.locator("#app [data-connect-guide]").count() == 1, "  … its link opens the Tally page at its six steps (round 66: Connect Tally)")
        go("() => goSettings('postlog')")
        ok(pg.locator("#app [data-home-link=sent]").count() == 1 and "Everything sent to Tally" not in E("[...document.querySelectorAll('#app h2')].map(e => e.innerText).join('|')"), "Settings → Sent to Tally: one line, no copy of the log")
        pg.click("#app [data-home-go=sent]"); W(1300)
        ok(E("S.homeTab") == "tally" and E("S.tallyTab") == "sent" and E("[...document.querySelectorAll('#app h2')].map(e => e.innerText).join('|')").count("Everything sent to Tally") == 1, "  … its link opens the Tally page → Everything sent")
        go(CL("goStep('done', 'bills');"))
        pg.click("#app [data-home-go=sent]"); W(1300)
        ok(E("S.homeTab") == "tally" and E("S.tallyTab") == "sent" and E("!S.logAll"), "Purchase → In Tally: its link opens Everything sent, for this client")
        go(CL("goClient('dash'); doAct('tallyPanel');"), 900)
        pg.click("[data-panel-sent]"); W(1300)
        ok(E("S.homeTab") == "tally" and E("S.tallyTab") == "sent", "the Tally panel's Everything sent to Tally opens the same page")
        # the Link to Tally card: whole in Client setup → Tally only
        go(CL("S.step = null; S.tab = 'cotally'; render();"))
        ok(pg.locator("#app .tlink .tlink-title").count() == 1, "Client setup → Tally: the client's Tally card")
        go(CL("goClient('books:import');"))
        ok(pg.locator("#app .tlink-title").count() == 0 and pg.locator("#app [data-tally-link-line]").count() == 1, "From Tally: the link's one status line, not the card")
        # 15-Oct-2026: a client not linked: the line points to the one place to link, Connect Tally (step 4)
        pg.click("#app [data-tally-link-line] [data-open-connect]"); W(1000)
        ok(E("[S.homeTab, (S.tallyGuide || {}).step]") == ["tally", 5] and pg.locator("#app [data-connect-guide]").count() == 1, "  … its Open Connect Tally opens the guide's step 4")
        E("() => { const co = CO(); co.onbHide = true; }"); go(CL("goClient('dash');"))
        ok(pg.locator("#app .tlink-title").count() == 0 and pg.locator("#app [data-tally-link-line]").count() == 1, "Overview (checklist folded): the link's one status line")
        pg.click("#app [data-tally-link-line] [data-open-connect]"); W(1000)
        ok(E("[S.homeTab, (S.tallyGuide || {}).step]") == ["tally", 5], "  … its Open Connect Tally opens the guide's step 4")
        E("() => { const co = CO(); co.onbHide = false; }"); go(CL("goClient('dash');"))
        ok(pg.locator("#app [data-tally-link-line]").count() == 0 and pg.locator("#app [data-onb-step=link]").count() == 1, "Overview (checklist open): its Link to Tally step says it, once")
        # the bridge card and the post log: nowhere else among the pages
        seen_bridge, seen_log = [], []
        for name, js, _ in PAGES:
            if name == "tally": continue
            go(js, 900)
            if pg.locator("#app [data-connect-section]").count(): seen_bridge.append(name)
            if "Everything sent to Tally" in E("[...document.querySelectorAll('#app h2')].map(e => e.innerText).join('|')"): seen_log.append(name)
        ok(not seen_bridge, "FinCom Bridge on this computer: only on the Tally page (%s)" % seen_bridge)
        ok(not seen_log, "Everything sent to Tally: only on the Tally page (%s)" % seen_log)
        # People and Plan and credit: Settings' sections, not pages of their own
        go(HOME("today"))
        side = E("[...document.querySelectorAll('#side .side-link')].filter(e => e.offsetParent !== null).map(e => e.dataset.side || e.innerText.trim())")
        ok("People" not in side and "Plan and credit" not in side, "People and Plan and credit: not in the sidebar (%s)" % side)

        print("4. old addresses")
        for h, tab, sec in [("#/settings/bridge", "rules", "bridge"), ("#/settings/postlog", "rules", "postlog"), ("#/people", "rules", "account"), ("#/plan", "rules", "plan")]:
            hash_go(h)
            ok(E("S.homeTab") == tab and E("S.settingsTab") == sec and title() == "Settings", "%s opens Settings → %s" % (h, sec))
        hash_go("#/c/" + cid + "/dash")
        ok(title() == "Overview", "…/dash opens the Overview")
        pg.close()

        print("5. a phone")
        ph, _ = start(br, 390, 844); E2, W2 = ph.evaluate, ph.wait_for_timeout
        E2(HOME("clients")); W2(1200)
        ok(ph.locator("#app .drop").count() == 0, "Clients on a phone: no drop zone before the list")
        prim = E2(PRIMARY)
        ok(len(prim) == 1, "Clients on a phone: one main button (%s)" % prim)
        ok(E2("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0, "Clients on a phone: no sideways scroll")
        ph.screenshot(path=os.path.join(OUT, "phone-clients.png"), full_page=True)
        E2(CL("S.postTabs = {}; goStep('post', 'bills');")); W2(1300)
        ok(len(E2(PRIMARY)) == 1, "Post to Tally on a phone: one main button")
        ph.screenshot(path=os.path.join(OUT, "phone-post.png"), full_page=True)
        ph.close(); br.close()
finally:
    srv.shutdown()
if errors: print("page errors:", errors[:5]); fails.append("page errors")
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
