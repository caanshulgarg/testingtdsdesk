"""python3 run_ledger_drop_ui.py - next-fix-ledger-drop (30-Oct-2026; the owner, 29-Oct: no silent marking of ledgers as
gone). Migration 131 holds many ledgers missing from one read of Tally "to confirm" and writes ONE tally_alerts row (kind
summary, data.what "ledger_drop", the list in data.names). Checked here, offline with FinCom's cloud made up in the page
(alerts_seed.SETUP), on the test build (app/dist-test):
  1. the bell: the alert in plain words (no computer's name), red, never cleared quietly; Show the 36 ledgers lists them;
     Confirm and Keep for the firm's owner
  2. the client's Books page: the slim line points to it (Confirm or keep); the Tally page's client row asks too
  3. Confirm: tally_ledger_drop_confirm with the hold's id; the alert gone once the cloud has it read
  4. Keep: tally_ledger_drop_keep; staff may answer (as the other ledger actions), a viewer is told who may
  5. its own file, fetched only when shown (LedgerDrop-*.js), nothing in the first file"""
import json, os, re, threading, functools, http.server, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from alerts_seed import dev, al, SETUP
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

CO = "GARG SHEKHAR & COMPANY"
NAMES = ["Advertisement and Promotion", "Battery", "CGST"] + ["Ledger %02d" % i for i in range(33)]
WORDS = CO + ": Tally lists 404 ledgers, 36 fewer than before (Advertisement and Promotion, Battery, CGST, …). If they were deleted in Tally, press Confirm; otherwise nothing changes."
DROP = "e0000000-0000-4000-8000-000000000131"
def drop_alert():
    a = al(41, "summary", "ago:3", WORDS, cid="G")
    a["data"] = {"what": "ledger_drop", "drop": DROP, "state": "pending", "names": NAMES, "count": 36, "listed": 404, "live": 440, "round": "r-1", "device": "d-1", "bridge": "go-6b1ba45fbb1d"}
    return a
# the confirm / keep RPCs answered as migration 131 does: the alert read, its state set
ANSWER = """() => { const prev = TCloud.rpc; TCloud.rpc = async (fn, a) => { const w = window.__w;
  if (fn === 'tally_ledger_drop_confirm' || fn === 'tally_ledger_drop_keep'){ w.calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    const x = w.alerts.find(r => r.data && r.data.drop === a.p_drop); if (x){ x.read_at = new Date().toISOString(); x.data.state = fn.endsWith('confirm') ? 'confirmed' : 'kept'; }
    return fn.endsWith('confirm') ? {ok: true, drop: a.p_drop, marked: 36, kept: 0} : {ok: true, drop: a.p_drop, kept: 36}; }
  return prev(fn, a); }; }"""
BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return null;
  if (!document.querySelector('[data-alerts-panel]')) b.click();
  return [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'), sev: e.getAttribute('data-sev'),
    text: (e.querySelector('[data-alert-text]') || {innerText: ''}).innerText.trim(), all: e.innerText, drop: !!e.querySelector('[data-ledger-drop]'),
    confirm: !!e.querySelector('[data-ledger-drop-confirm]'), keep: !!e.querySelector('[data-ledger-drop-keep]'), who: !!e.querySelector('[data-ledger-drop-owner]'),
    clear: !!e.querySelector('[data-alert-clear], [data-clear]'), read: !!e.querySelector('[data-alert-read]')})); }"""
CLOSE = "() => { S.alertsOpen = false; render(); }"
NAMED = re.compile(r"NWS144|anshul|Ranjeet|go-6b1b|bridge|computer", re.I)
srv = http.server.ThreadingHTTPServer(("localhost", 8363), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 800}); pg.on("pageerror", lambda e: errors.append(str(e)))
    got = []; pg.on("request", lambda r: got.append(r.url))
    pg.goto("http://localhost:8363/"); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    print("== 5. its own file")
    ok(not [u for u in got if "LedgerDrop" in u], "LedgerDrop's file not fetched on opening the app")
    main = [u for u in got if re.search(r"/assets/index-[^/]+\.js$", u)]
    src = pg.evaluate("(u) => fetch(u).then(r => r.text())", main[0]) if main else ""
    ok(main and "tally_ledger_drop_confirm" not in src, "the Confirm / Keep code is not in the first file")
    def scene(role="owner", where="dash"):
        cid = E(SETUP, [{"devs": [dev(recording=True)], "alerts": [drop_alert()], "gap": None}, role]); E(ANSWER)
        E("([cid, w]) => { S.view = 'company'; S.coId = cid; S.loadingCo = false; goClient(w); }", [cid, where]); pg.wait_for_timeout(1500)
        E("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); }"); pg.wait_for_timeout(1500)
        return cid

    print("== 1. the bell")
    cid = scene()
    items = E(BELL) or []; pg.wait_for_timeout(800); items = E(BELL) or []
    d = [x for x in items if x["key"].startswith("ledgers:")]
    x = d[0] if d else {"text": "", "all": "", "sev": "", "confirm": False, "keep": False, "clear": True, "read": True, "drop": False}
    ok(len(d) == 1 and x["text"] == WORDS, "one alert, in the owner's words (%s)" % x["text"][:120])
    ok(not NAMED.search(x["all"]), "no computer's name, no Windows login, no bridge (%s)" % (NAMED.search(x["all"]) or [""])[0])
    ok(x["sev"] == "bad" and not x["read"], "red (needs action), no Mark read: it goes only when answered (%s)" % x["sev"])
    ok(x["drop"] and x["confirm"] and x["keep"], "Confirm and Keep for the owner")
    ok(any(f for f in got if "LedgerDrop" in f), "LedgerDrop's file fetched when the alert is shown")
    ok(pg.locator("[data-alerts-panel] [data-ledger-drop-confirm]").inner_text().strip() == "Confirm" and pg.locator("[data-alerts-panel] [data-ledger-drop-keep]").inner_text().strip() == "Keep",
       "the buttons say Confirm and Keep")
    pg.locator("[data-alerts-panel] [data-ledger-drop-show]").click(); pg.wait_for_timeout(300)
    li = pg.locator("[data-alerts-panel] [data-ledger-drop-names] li").all_inner_texts()
    ok(li == NAMES, "Show the 36 ledgers: the list, as the cloud held it (%d)" % len(li))
    ok(pg.locator("[data-alerts-panel]").count() == 1, "the bell stays open after Show (the click is the alert's own)")
    E(CLOSE)

    print("== 2. the Books page's slim line, the Tally page's client row")
    E("([cid]) => { S.view = 'company'; S.coId = cid; goClient('books:reports'); }", [cid]); pg.wait_for_timeout(1500)
    line = pg.locator("#app [data-alert-line]")
    ok(line.count() == 1 and "36 fewer" in line.inner_text() and pg.locator("#app [data-alert-line-drop]").count() == 1, "the client's Books page: the slim line, with Confirm or keep (%s)" % (line.inner_text()[:80] if line.count() else ""))
    if pg.locator("#app [data-alert-line-drop]").count():
        pg.locator("#app [data-alert-line-drop]").click(); pg.wait_for_timeout(1200)
        ok(pg.locator("[data-alerts-panel] [data-ledger-drop-confirm]").count() == 1, "Confirm or keep opens the bell at the question")
        E(CLOSE)
    E("() => navHome('tally')"); pg.wait_for_timeout(2000)
    row = pg.locator("#app [data-tco-ledger-drop]")
    if row.count():
        ok("36 fewer" in row.inner_text() and row.locator("[data-ledger-drop-confirm]").count() == 1 and not NAMED.search(row.inner_text()), "the Tally page: the client's row asks too, plain words (%s)" % row.inner_text()[:100])
    else:
        print("  ..   the Tally page lists no linked row for the made-up client in this stand (checked in the bell and Books page)")

    print("== 3. Confirm")
    E("([cid]) => { S.view = 'company'; S.coId = cid; goClient('dash'); }", [cid]); pg.wait_for_timeout(800)
    E(BELL); pg.wait_for_timeout(1000)
    E("() => { window.__w.calls = []; }")
    pg.locator("[data-alerts-panel] [data-ledger-drop-confirm]").click(); pg.wait_for_timeout(1800)
    calls = E("window.__w.calls")
    ok(calls[:1] == [["tally_ledger_drop_confirm", {"p_drop": DROP}]], "Confirm: tally_ledger_drop_confirm with the hold's id (%s)" % calls[:2])
    items = E(BELL) or []
    ok(not [i for i in items if i["key"].startswith("ledgers:")], "the alert gone once answered (%s)" % [i["text"][:40] for i in items])
    E(CLOSE)

    print("== 4. Keep; who may")
    cid = scene("staff")
    E(BELL); pg.wait_for_timeout(1000)
    ok(pg.locator("[data-alerts-panel] [data-ledger-drop-keep]").count() == 1, "staff may answer (as the other ledger actions)")
    E("() => { window.__w.calls = []; }")
    pg.locator("[data-alerts-panel] [data-ledger-drop-keep]").click(); pg.wait_for_timeout(1800)
    ok(E("window.__w.calls")[:1] == [["tally_ledger_drop_keep", {"p_drop": DROP}]], "Keep: tally_ledger_drop_keep with the hold's id")
    ok(not [i for i in (E(BELL) or []) if i["key"].startswith("ledgers:")], "the alert gone once kept")
    E(CLOSE)
    cid = scene("viewer")
    items = E(BELL) or []; pg.wait_for_timeout(1000); items = E(BELL) or []
    d = [x for x in items if x["key"].startswith("ledgers:")]
    ok(d and not d[0]["confirm"] and not d[0]["keep"] and d[0]["who"], "a viewer sees the question, no buttons, and who answers it")
    E(CLOSE)
    # phone width: nothing wider than the screen
    pg.set_viewport_size({"width": 375, "height": 760}); cid = scene(); E(BELL); pg.wait_for_timeout(1000)
    w = E("() => { const e = document.querySelector('[data-alerts-panel] [data-ledger-drop]'); return e ? [e.getBoundingClientRect().right, document.documentElement.clientWidth, document.documentElement.scrollWidth] : null; }")
    ok(w and w[0] <= w[1] + 1 and w[2] <= w[1], "phone width (375): the answer fits, no sideways scroll (%s)" % w)
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:2])
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
