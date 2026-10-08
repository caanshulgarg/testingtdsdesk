"""python3 run_held_not_in_sync.py - the owner's finding (05-Oct-2026): the app said "in sync" for a book with a recorder
line HELD (tally_recorder_lines.state = 'held'). A held line is "received, not yet entered in the books: <reason>"
(<reason> = the line's held_why) wherever its state is shown, and a book with held lines is never "in sync": it says
"N received, not yet entered in the books".
Checked here, offline with FinCom's cloud made up in the page (alerts_seed.SETUP), a line held with held_why
"not found by its type and number (asked 3 times)" and an applied line:
  - Sync activity (Tally page): the held row says "Received, not yet entered in the books: not found by its type and
    number (asked 3 times)"; the applied row "Entered in the books", as before;
  - the Tally status (the pill on the Tally page and in the top bar's Tally panel, the Clients list, the firm-wide and the
    client's tallyStatus): "1 received, not yet entered in the books", never "in sync";
  - the bell and the client's Books page slim line: the same words with the reason; no "in sync" on the Books page;
  - the line applied: no held words anywhere, and the status is "Connected & in sync" again (as before).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_held_not_in_sync.py
RED (before the change): the Tally status said "Connected & in sync" with the line held; the bell said "1 change from
Tally is waiting, not yet in the books." without the reason."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
from alerts_seed import D1, dev, SETUP
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
WHY = "not found by its type and number (asked 3 times)"
WORDS = "eceived, not yet entered in the books: " + WHY      # "Received, ..." at the head of a cell, "received, ..." in a sentence
HELDW = re.compile(r"[Rr]" + re.escape(WORDS))
SYNC = re.compile(r"in sync", re.I)
CO = "GARG SHEKHAR & COMPANY"
def line(i, state, why, ago, no):
    return {"id": i, "client_id": "G", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": CO, "line_id": "L%d" % i, "event": "altered",
            "object_guid": "g-%d" % i, "alter_id": 54000 + i, "vch_type": "Payment", "vch_no": no, "vch_date": "2026-10-05", "saved_at": ago, "received_at": ago,
            "applied_at": ago if state == "applied" else None, "state": state, "held_why": why, "ledgers": []}
LINES = [line(601, "held", WHY, "ago:9", "P-44"), line(602, "applied", None, "ago:4", "P-45")]
BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return null;
  if (!document.querySelector('[data-alerts-panel]')) b.click();
  return [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'),
    text: (e.querySelector('[data-alert-text]') || {innerText: ''}).innerText.trim(), fix: (e.querySelector('[data-alert-fix]') || {innerText: ''}).innerText.trim()})); }"""
CLOSE = "() => { S.alertsOpen = false; render(); }"
STATUS = "(cid) => [tallyStatus(CO(cid)).label, tallyStatus(CO(cid)).say, tallyStatus(null).label, tallyStatus(null).say, tallyStatus(CO(cid)).state]"
srv = http.server.ThreadingHTTPServer(("localhost", 8379), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8379/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda s: (E("(s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; }", s))
    tc = lambda sel: (pg.text_content(sel) or "").replace("\n", " ").strip() if pg.locator(sel).count() else ""   # 2.3.5: the lines under "Which entries" are folded
    cid = E(SETUP, [{"devs": [dev(recording=True)], "alerts": [], "gap": None, "lines": LINES}, "owner"])
    E("() => { AlertHub.refresh(true); }"); pg.wait_for_timeout(1200)
    # ---- 1. Sync activity on the Tally page
    E("() => { S.syncClient = ''; S.tallyTab = 'activity'; Rec.act.at = 0; navHome('tally'); }"); pg.wait_for_timeout(1800)
    held, applied = txt('#app [data-sync-line="601"] [data-sync-state]'), txt('#app [data-sync-line="602"] [data-sync-state]')
    ok(HELDW.fullmatch(held or "") is not None, "Sync activity: the held line says 'received, not yet entered in the books: <held_why>' (%s)" % held)
    ok(applied == "Entered in the books", "Sync activity: the applied line as before (%s)" % applied)
    # 2.3.5: a line held for a reason only a person settles is under "Needs you" (its group's sentence, the line below it)
    wl = tc('#app [data-sync-needs-line="601"]'); gt = txt('#app [data-sync-needs] [data-needs-text]')
    ok(wl.endswith(": " + WHY) and ", received " in wl and "not yet entered in the books (" + WHY + ")" in gt, "Sync activity's Needs you: received at, not yet entered in the books, the reason (%s | %s)" % (wl, gt))
    ok(not SYNC.search(pg.inner_text("#app")), "Sync activity: no 'in sync' on the page")
    # ---- 2. the Tally status: never "in sync" with a held line
    st = E(STATUS, cid)
    ok(st[0] == "1 received, not yet entered in the books" and st[2] == "1 received, not yet entered in the books", "the Tally status, the client's and the firm's: '1 received, not yet entered in the books' (%s | %s)" % (st[0], st[2]))
    ok(not SYNC.search(" ".join(st[:4])) and WHY in st[1], "never 'in sync'; the reason in its words (%s)" % st[1])
    E("() => { S.tallyTab = 'computers'; navHome('tally'); }"); pg.wait_for_timeout(1200)
    t = pg.inner_text("#app")
    ok(not SYNC.search(t) and HELDW.search(t), "the Tally page: no 'in sync'; its slim line says the held line with its reason (%s)" % txt("#app [data-alert-line]"))
    # the client's pages: the Books page's slim line, the top bar's Tally panel
    E("([cid]) => { S.view = 'company'; S.coId = cid; S.loadingCo = false; goClient('books:reports'); }", [cid]); pg.wait_for_timeout(1500)
    sl = txt("#app [data-alert-line]")
    ok(HELDW.search(sl) is not None, "the client's Books page slim line: 'received, not yet entered in the books: <held_why>' (%s)" % sl)
    ok(not SYNC.search(pg.inner_text("#app")), "the client's Books page: no 'in sync'")
    E("() => doAct('tallyPanel')"); pg.wait_for_timeout(600)
    pn = txt(".tallypanel")
    ok(pn and not SYNC.search(pn) and "1 received, not yet entered in the books" in pn, "the top bar's Tally panel for the client: no 'in sync' (%s)" % pn[:200])
    E("() => doAct('tallyPanelClose')"); pg.wait_for_timeout(300)
    # ---- 3. the bell
    items = E(BELL) or []
    g = [x for x in items if CO in x["text"]]
    ok(len(g) == 1 and HELDW.search(g[0]["text"]) and not SYNC.search(g[0]["text"] + g[0]["fix"]), "the bell: one alert for the book, with the held words and the reason (%s)" % [x["text"] for x in g])
    E(CLOSE)
    # the Clients list: the client's Tally tag
    E("() => { S.view = 'home'; navHome('clients'); }"); pg.wait_for_timeout(1200)
    tags = E("() => [...document.querySelectorAll('#app [data-tally]')].map(e => e.innerText + ' ' + (e.title || ''))")
    ok(not SYNC.search(" ".join(tags)), "the Clients list: no 'in sync' on a tag (%s)" % tags)
    # ---- 4. the line applied: as before
    E("() => { window.__w.lines = window.__w.lines.map(l => Object.assign(l, {state: 'applied', held_why: null, applied_at: new Date().toISOString()})); Rec.act.at = 0; Rec.actLoad(); AlertHub.refresh(true); }")
    pg.wait_for_timeout(1500)
    st = E(STATUS, cid)
    ok(st[4] == "ok" and st[0] == "Connected & in sync", "the line applied: the client's Tally status is in sync again, as before (%s)" % st[0])
    items = E(BELL) or []
    ok(not [x for x in items if CO in x["text"]], "and the bell's alert is gone by itself")
    E(CLOSE)
    E("() => { S.syncClient = ''; S.tallyTab = 'activity'; Rec.act.at = 0; navHome('tally'); }"); pg.wait_for_timeout(1500)
    ok(txt('#app [data-sync-line="601"] [data-sync-state]') == "Entered in the books" and not HELDW.search(pg.inner_text("#app")), "Sync activity: the line entered in the books, no held words")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
