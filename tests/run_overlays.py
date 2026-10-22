"""python3 run_overlays.py - every overlay closes on a click outside it and on Esc (the owner, 14-Oct-2026: "When we open
More or Check before filing or anything, I need to go to the cross to remove it. If I click on the screen it should
close."). One place does it: app/src/parts/dismiss.js (useDismiss, the native <details> popups, window.FCOverlay).
  1. More (a <details> menu), the column pickers' kind, an Info (i) popover: an outside click closes it and does not also
     press what was under it; Esc closes it and the client stays open
  2. the challan register's split; the alerts (bell); the client switcher; the Tally panel; the help panel
  3. drawers: Check before filing, the Assistant (what was typed stays as a draft)
  4. a confirm step (askConfirm) with a reason typed stays on an outside click; Esc is Cancel; a backdrop click never
     confirms
  5. a phone: tapping the dimmed area closes the More sheet; Back closes the top overlay and the page stays
Runs on the React build: app/dist-test, or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("OVERLAYS_PORT") or 8362)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
        pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        J = lambda e, a=None: pg.evaluate(e, a)
        W = pg.wait_for_timeout
        cid = J("S.coId")
        def tds_year():
            J("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsFy = '2025-26'; S.tdsView = 'year'; S.tdsQ = ''; S.tdsPickForm = ''; render(); }"); W(500)
        def blank():
            """a point on the page with nothing under it: the page title's line, right of the title"""
            b = pg.locator("#cobar .tbar-title h2").bounding_box()
            return (b["x"] + b["width"] + 300, b["y"] + 8)
        def in_client(): return J("S.view") == "company" and J("S.coId") == cid

        print("1. More, an Info popover")
        tds_year()
        pg.click("#app [data-tds-bar] details.more > summary"); W(200)
        ok(J("!!document.querySelector('#app [data-tds-bar] details.more[open]')"), "More opens")
        cell = pg.locator('#app [data-tds-grid] button[data-cell]').first
        cell.click(); W(500)
        ok(not J("!!document.querySelector('#app [data-tds-bar] details.more[open]')") and J("S.tdsView") == "year", "a click outside (on a return's cell) closes More, and the cell is not pressed too (%s)" % J("S.tdsView"))
        pg.click("#app [data-tds-bar] details.more > summary"); W(200)
        pg.keyboard.press("Escape"); W(300)
        ok(not J("!!document.querySelector('#app [data-tds-bar] details.more[open]')") and in_client() and J("booksTab()") == "tds", "Esc closes More, and the client stays open")
        J("() => { S.tdsView = 'register'; render(); }"); W(500)
        pg.click("#app [data-register] details.info > summary"); W(200)
        ok(J("!!document.querySelector('#app [data-register] details.info[open]')"), "an Info (i) popover opens")
        pg.mouse.click(*blank()); W(300)
        ok(not J("!!document.querySelector('#app details.info[open]')"), "a click outside closes it")
        pg.click("#app [data-register] details.info > summary"); W(200); pg.keyboard.press("Escape"); W(300)
        ok(not J("!!document.querySelector('#app details.info[open]')") and in_client(), "Esc closes it, the client stays")

        print("2. the split, the alerts, the switcher, the Tally panel, the help panel")
        pg.locator('#app [data-split="total"]').first.click(); W(200)
        ok(pg.locator('[data-split-open]').count() == 1, "the challan's split opens on a tap")
        pg.mouse.click(*blank()); W(300)
        ok(pg.locator('[data-split-open]').count() == 0, "a click outside closes it")
        pg.locator('#app [data-split="total"]').first.click(); W(200); pg.keyboard.press("Escape"); W(300)
        ok(pg.locator('[data-split-open]').count() == 0 and pg.locator('[data-register]').count() == 1 and in_client(), "Esc closes it; the page and the client stay")
        J("() => { S.alertsOpen = true; render(); }"); W(300)
        ok(pg.locator('[data-alerts-panel]').count() == 1, "the alerts open")
        pg.keyboard.press("Escape"); W(300)
        ok(pg.locator('[data-alerts-panel]').count() == 0 and in_client(), "Esc closes the alerts, the client stays")
        J("() => { S.alertsOpen = true; render(); }"); W(300); pg.mouse.click(700, 600); W(300)
        ok(pg.locator('[data-alerts-panel]').count() == 0, "a click outside closes the alerts")
        J("() => openSwitcher()"); W(300)
        ok(pg.locator(".sw[role=dialog]").is_visible(), "the client switcher opens")
        pg.mouse.click(30, 980); W(300)
        ok(not J("!!S.switcher"), "a click on the dark area closes it")
        J("() => openSwitcher()"); W(300); pg.keyboard.press("Escape"); W(300)
        ok(not J("!!S.switcher") and in_client(), "Esc closes it, the client stays")
        J("() => { S.tallyPanel = true; render(); }"); W(600)
        ok(pg.locator('[data-overlay="tallypanel"]').count() == 1, "the Tally panel opens")
        pg.mouse.click(400, 600); W(600)
        ok(not J("!!S.tallyPanel"), "a click outside closes the Tally panel")
        J("() => { S.tallyPanel = true; render(); }"); W(500); pg.keyboard.press("Escape"); W(500)
        ok(not J("!!S.tallyPanel") and in_client(), "Esc closes it, the client stays")
        J("() => { S.tdsView = 'return'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'deductions'; render(); }"); W(600)
        # next-tds-clear (19-Oct-2026): a return's "How this works" is in its header's ⋯
        moreOpen = lambda: (pg.click("#app [data-return-card] details.more > summary"), W(250))
        moreOpen()
        hb = pg.locator("#app [data-help]").first
        if hb.count():
            hb.click(); W(400)
            ok(J("!!document.getElementById('helpPanel')"), "the help panel opens")
            pg.mouse.click(*blank()); W(400)
            ok(not J("!!document.getElementById('helpPanel')"), "a click outside closes the help panel")
            moreOpen(); pg.locator("#app [data-help]").first.click(); W(400); pg.keyboard.press("Escape"); W(400)
            ok(not J("!!document.getElementById('helpPanel')") and in_client(), "Esc closes it, the client stays")
        else:
            ok(False, "the return page has its How this tab works button")

        print("3. drawers: Check before filing, the Assistant")
        J("() => PreFile.open('tds', '26Q', '2025-26', 'Q1')"); W(1200)
        ok(pg.locator('[data-overlay="prefile"]').count() == 1, "Check before filing opens")
        tab = J("S.tdsTab")
        pg.locator('#app nav[aria-label=Return] button:has-text("Deductees")').click(); W(600)
        ok(not J("!!(S.prefile && S.prefile.open)") and J("S.tdsTab") == tab, "a click outside closes it, and the first click only closes (the tab under it is not pressed: %s)" % J("S.tdsTab"))
        J("() => PreFile.open('tds', '26Q', '2025-26', 'Q1')"); W(1000); pg.keyboard.press("Escape"); W(500)
        ok(not J("!!(S.prefile && S.prefile.open)") and in_client(), "Esc closes it, the client stays")
        J("() => { const a = ASST.st(); a.open = true; a.q = 'What is due this month?'; ASST.draw(); }"); W(800)
        ok(pg.locator('[data-overlay="asst"]').count() == 1, "the Assistant panel opens")
        pg.mouse.click(*blank()); W(600)
        ok(not J("!!ASST.st().open") and J("ASST.st().q") == "What is due this month?", "a click outside closes the Assistant; the question typed stays as a draft")
        J("() => { ASST.st().open = true; ASST.draw(); }"); W(600); pg.keyboard.press("Escape"); W(500)
        ok(not J("!!ASST.st().open") and in_client(), "Esc closes it, the client stays")

        print("4. a confirm step")
        J("() => { window.__cf = 'open'; askConfirm({title: 'Delete it?', body: '<input type=text id=cfReason aria-label=Reason>', ok: 'Delete', read: () => document.getElementById('cfReason').value}).then(r => { window.__cf = r ? 'ok' : 'cancel'; }); }"); W(300)
        pg.fill("#cfReason", "typed twice"); pg.mouse.click(20, 20); W(300)
        ok(J("window.__cf") == "open" and pg.locator("#confirmBox [data-cbx=yes]").is_visible(), "with a reason typed, a click outside leaves it open (never OK)")
        pg.keyboard.press("Escape"); W(300)
        ok(J("window.__cf") == "cancel" and in_client(), "Esc is Cancel, the client stays")
        J("() => { window.__cf = 'open'; askConfirm({title: 'Mark filed?', body: 'Sure?', ok: 'Mark filed'}).then(r => { window.__cf = r ? 'ok' : 'cancel'; }); }"); W(300)
        pg.mouse.click(20, 20); W(300)
        ok(J("window.__cf") == "cancel", "nothing typed: a click outside is Cancel, never OK")

        print("4b. a column picker; the firm's details (typed input)")
        J("() => { S.view = 'company'; S.tab = 'txn'; S.txnTab = 'bills'; render(); }"); W(800)
        cp = pg.locator("#app details.colpick > summary").first
        if cp.count():
            cp.click(); W(200)
            ok(J("!!document.querySelector('#app details.colpick[open]')"), "the Columns picker opens")
            pg.locator("#app details.colpick .colpick-box input").first.click(); W(200)
            ok(J("!!document.querySelector('#app details.colpick[open]')"), "a tick inside it leaves it open")
            pg.mouse.click(*blank()); W(300)
            ok(not J("!!document.querySelector('#app details.colpick[open]')"), "a click outside closes it")
            cp.click(); W(200); pg.keyboard.press("Escape"); W(300)
            ok(not J("!!document.querySelector('#app details.colpick[open]')") and in_client(), "Esc closes it, the client stays")
        else:
            ok(False, "the transactions page has its Columns picker")
        J("() => { window.__fsDue = true; window.__fsReal = [window.firmSetupDue, window.firmSetupLater]; window.firmSetupDue = () => window.__fsDue; window.firmSetupLater = () => { window.__fsDue = false; render(); }; render(); }"); W(600)
        fs = '[data-overlay="firmsetup"]'
        ok(pg.locator(fs).count() == 1, "the firm's details ask opens")
        pg.mouse.click(15, 15); W(400)
        ok(pg.locator(fs).count() == 0 and not J("window.__fsDue"), "a click outside closes it (Later), at once (the owner, 22-Oct-2026)")
        J("() => { window.__fsDue = true; render(); }"); W(600)
        pg.fill(fs + ' input[aria-label="Firm name"]', "Garg & Co"); W(200)
        pg.keyboard.press("Escape"); W(400)
        ok(pg.locator(fs).count() == 0 and not pg.locator("#confirmBox [data-cbx=yes]").is_visible(), "something typed: Esc closes it at once, no ask")
        J("() => { window.__fsDue = true; render(); }"); W(600)
        ok(pg.input_value(fs + ' input[aria-label="Firm name"]') == "Garg & Co" and pg.locator(fs + " [data-draft-kept]").count() == 1, "asked again: what was typed is kept as a draft")
        pg.locator(fs + " [data-draft-discard]").click(); W(300); pg.keyboard.press("Escape"); W(400)
        ok(pg.locator(fs).count() == 0 and in_client(), "Esc closes it, the client stays")
        J("() => { [window.firmSetupDue, window.firmSetupLater] = window.__fsReal; render(); }"); W(300)

        print("5. a phone")
        pg.set_viewport_size({"width": 390, "height": 844}); W(600)
        tds_year()
        h0 = J("location.hash")
        pg.click('#side button[data-side="More"], #side .side-link:has-text("More")'); W(500)
        ok(pg.locator('[data-side-sheet]').count() == 1, "the phone's More sheet opens")
        pg.mouse.click(195, 60); W(500)
        ok(pg.locator('[data-side-sheet]').count() == 0, "tapping the dimmed area closes it")
        pg.click('#side button[data-side="More"], #side .side-link:has-text("More")'); W(500)
        pg.go_back(); W(800)
        ok(pg.locator('[data-side-sheet]').count() == 0 and J("location.hash") == h0 and in_client(), "Back closes the sheet; the page stays (%s)" % J("location.hash"))
        pg.locator('#app [data-tds-grid] button[data-cell]').first.click(); W(600)
        J("render()"); W(300); h1 = J("location.hash")   # the return's own address, its tab included
        J("() => { S.alertsOpen = true; render(); }"); W(400)
        pg.go_back(); W(800)
        ok(pg.locator('[data-alerts-panel]').count() == 0 and J("location.hash") == h1, "Back closes the alerts, the return stays open (%s)" % J("location.hash"))
        n0 = J("history.length")
        J("() => { S.alertsOpen = true; render(); }"); W(400)
        ok(J("!!(history.state && history.state.fcOverlay)"), "open on a phone, the alerts add a step to the history")
        pg.keyboard.press("Escape"); W(600)
        ok(pg.locator('[data-alerts-panel]').count() == 0 and not J("!!(history.state && history.state.fcOverlay)") and J("location.hash") == h1,
           "closed by Esc, the step it added is gone again, so the next Back leaves the page as usual (%s)" % J("JSON.stringify(history.state)"))
        ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
finally:
    srv.shutdown()
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
