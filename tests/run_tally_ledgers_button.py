"""python3 run_tally_ledgers_button.py - "Bring ledgers from Tally" (04-Nov-2026, next-tally-ledgers-button; the owner: "When
first time integrating tally company I can not see master is coming automatically, nor can I see any button to press to
bring it"). Made-up firm, clients, companies and computers only (run_tally_page_clean.py's stand-in cloud).
  1. a connected client with no ledgers yet and no first sync going (the page opened again after linking), its company
     open in this user's Tally: "Ledgers received?" Not yet with the button "Bring ledgers from Tally"; What to do says to
     press it (not "Nothing. It is coming in by itself."). The click: the existing ledgers wake (kind wake, what ledgers)
     and the existing Update now (tally_want_update) for that client; nothing else is asked; the cell shows it coming in.
  2. the automatic first sync through the cloud: the wake brought nothing in 45 seconds: Update now asked once by itself
     (a bridge reads the ledger list only for a company it keeps in step already; a company just linked is not kept yet).
     The Tally page reads a first sync going every 10 seconds: no progress in 3 minutes is stuck (No, the reason) with the
     button again.
  3. the company open on no computer FinCom hears: the button is off, with "Open this company in Tally first".
  4. the client's Tally ledgers screen with no ledgers yet: "Bring ledgers from Tally", the same two asks.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_ledgers_button.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9541
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PC, WIN = "MADEUP-PC", "user-a"          # made-up
NEWCO, OLDCO = "Nova Traders Pvt Ltd", "Orbit Mills"   # made-up
BRING = "Bring ledgers from Tally"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(TS.LATEST)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda fn: [c[1] for c in E("window.__calls") if c[0] == fn]
        wakes = lambda: [w for w in E("window.__wakes") if w.get("kind") == "wake" and w.get("what") != "active"]
        def scene(devs, cos, clients, books):
            ids = E(T.SETUP, [devs, cos, [], "owner", clients, True, books])
            E("() => { window.__linksApi = false; S.tcoSync = {}; }")
            E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {})
            E(TS.MINE, ["linked", devs[0]["main_bridge"], devs[0]["id"]] if devs else [None, "", ""]); pg.wait_for_timeout(2600)
            return ids
        def row(name): return '#app [data-tsm-table] tr[data-tsm-row="%s"]' % name
        def cell(name, k): return row(name) + ' [data-tsm-col="%s"]' % k
        def word(name, k): return pg.get_attribute(cell(name, k) + " [data-tsm-word]", "data-tsm-word") if n(cell(name, k) + " [data-tsm-word]") else None
        btn = lambda name: cell(name, "l") + " [data-tsm-bring-btn]"
        def press(sel):
            if not n(sel): ok(False, "no button to press: " + sel); finish(br, srv)
            pg.click(sel)
        # a connected client whose book has no ledgers yet (ledgersAt none, no entries), and one with its ledgers
        books = {NEWCO: T.book(NEWCO, ledgers=False, days=False), OLDCO: T.book(OLDCO)}
        cos = lambda d: [{"company": c, "client_id": "NAME:" + c, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"} for c in (NEWCO, OLDCO)]
        LED = "(l) => { window.__ledgers['bk-" + OLDCO + "'] = Array.from({length: 40}, (_, i) => ({name: 'L' + i})); }"

        print("== 1. not yet, the company open in this user's Tally: the button")
        d = T.dev(7, PC, WIN, tally="open", opened=(NEWCO, OLDCO), version="2.5.3", rec=(NEWCO, OLDCO))
        ids = scene([d], cos(d), [NEWCO, OLDCO], books); E(LED, None); pg.wait_for_timeout(1500)
        c = ids[NEWCO]
        ok(word(NEWCO, "c") == "Yes" and word(NEWCO, "o") == "Yes" and word(NEWCO, "l") == "Not yet", "1. connected, open, ledgers Not yet (%s)" % txt(row(NEWCO)))
        ok(n(btn(NEWCO)) == 1 and txt(btn(NEWCO)) == BRING and pg.is_enabled(btn(NEWCO)), "1. under Ledgers received?: the button '%s', on (%s)" % (BRING, txt(cell(NEWCO, "l"))))
        ok(txt(cell(NEWCO, "do") + " [data-tsm-todo]") == "Press Bring ledgers from Tally.", "1. What to do: press it, not 'coming in by itself' (%s)" % txt(cell(NEWCO, "do")))
        ok(n(btn(OLDCO)) == 0, "1. a client whose ledgers are in: no button (%s)" % txt(cell(OLDCO, "l")))
        E("() => { window.__wakes = []; window.__calls = []; }")
        press(btn(NEWCO)); pg.wait_for_timeout(1500)
        wk = wakes()
        ok(wk == [{"kind": "wake", "what": "ledgers", "client": c}], "1. the click: the existing ledgers wake, once (%s)" % wk)
        ok(calls("tally_want_update") == [{"p_client": c}], "1. and the existing Update now for that client, once (%s)" % calls("tally_want_update"))
        ok(not [x for x in E("window.__calls") if x[0] not in ("tally_want_update", "tally_status", "tally_period_status", "tally_fetch_summary", "tally_check_ask_status", "tally_held_status", "tally_openings_decide")],
           "1. nothing else is asked (%s)" % sorted(set(x[0] for x in E("window.__calls"))))
        ok(word(NEWCO, "l") == "Not yet" and txt(cell(NEWCO, "l") + " [data-tsm-note]") == "Coming in now" and n(btn(NEWCO)) == 0, "1. then: Coming in now, the button gone (%s)" % txt(cell(NEWCO, "l")))

        print("== 2. the automatic first sync: Update now after 45 s with nothing; stuck after 3 minutes, the button again")
        E("() => { window.__calls = []; }")
        E("(c) => { const x = S.tcoSync[c]; x.upAsked = 0; x.at = Date.now() - 50000; x.moveAt = 0; }", c); pg.wait_for_timeout(11500)
        ok(calls("tally_want_update") == [{"p_client": c}], "2. nothing in 45 seconds through the cloud: Update now asked once by itself (%s)" % calls("tally_want_update"))
        E("() => { window.__calls = []; }"); pg.wait_for_timeout(10500)
        ok(calls("tally_want_update") == [], "2. once only (%s)" % calls("tally_want_update"))
        E("(c) => { S.tcoSync[c].at = Date.now() - 4 * 60000; }", c); pg.wait_for_timeout(11500)
        ok(word(NEWCO, "l") == "No" and n(btn(NEWCO)) == 1 and pg.is_enabled(btn(NEWCO)), "2. no progress in 3 minutes, read by this page itself: No, the reason, the button (%s)" % txt(cell(NEWCO, "l")))
        ok(n(cell(NEWCO, "do") + " .btn") == 0 and "Bring ledgers from Tally" in txt(cell(NEWCO, "do") + " [data-tsm-todo]"), "2. one button only, What to do names it (%s)" % txt(cell(NEWCO, "do")))
        E("() => { window.__wakes = []; window.__calls = []; }"); press(btn(NEWCO)); pg.wait_for_timeout(1500)
        ok(len([w for w in wakes() if w.get("what") == "ledgers"]) == 1 and calls("tally_want_update") == [{"p_client": c}], "2. pressed again: the wake and Update now once more")

        print("== 3. open on no computer: the button off, one plain line")
        d = T.dev(7, PC, WIN, tally="open", opened=(OLDCO,), version="2.5.3", rec=(OLDCO,))
        ids = scene([d], cos(d), [NEWCO, OLDCO], books); E(LED, None); pg.wait_for_timeout(1500)
        ok(word(NEWCO, "l") == "Not yet" and n(btn(NEWCO)) == 1 and not pg.is_enabled(btn(NEWCO)), "3. the button is there, off (%s)" % txt(cell(NEWCO, "l")))
        ok(txt(cell(NEWCO, "l") + " [data-tsm-bring-why]") == "Open this company in Tally first", "3. 'Open this company in Tally first' (%s)" % txt(cell(NEWCO, "l")))

        print("== 4. the client's Tally ledgers screen, no ledgers yet")
        # (run_tally_page_clean's stand-in cloud holds the books screen's own loads; here only what the screen asks)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        E(L.CLIENT, L.BOOKS); pg.wait_for_timeout(600)
        c = E("""(name) => { const co = S.companies[S.books.cid];
          window.__calls = []; window.__wakes = [];
          Cloud.on = () => true; Cloud.st.firm = 'f-1'; Cloud.api = async () => []; TCloud.on = () => true; TCloud.has = (x) => x === co.id;
          TCloud.st[co.id] = {at: Date.now(), books: [{book: 'bk-1', company: name, from: '2026-04-01', ledgersAt: null, ledgers: 0}]};
          TCloud.status = async () => TCloud.st[co.id].books; TCloud.restAll = async () => [];
          TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return fn === 'tally_status' ? TCloud.st[co.id].books : {ok: true}; };
          TCloudUp.post = async (body) => { window.__wakes.push(body); return body && body.what === 'ledgers' ? {ok: true, woken: 1, debounced: 0, asked: 1} : {}; };
          Ledgers.st = {}; S.lmView = ''; S.ledQ = ''; TaxLed.go('all'); return co.id; }""", NEWCO); pg.wait_for_timeout(3000)
        ok(n("#app [data-led-status-line=none]") == 1 and n("#app [data-led-bring]") == 1 and txt("#app [data-led-bring]") == BRING, "4. 'No ledgers from Tally yet' with '%s' (%s)" % (BRING, txt("#app [data-led-status]")))
        E("() => { window.__wakes = []; window.__calls = []; }"); press("#app [data-led-bring]"); pg.wait_for_timeout(2500)
        ok([w for w in wakes() if w.get("what") == "ledgers"] == [{"kind": "wake", "what": "ledgers", "client": c}] and calls("tally_want_update") == [{"p_client": c}],
           "4. the click: the same wake and Update now (%s | %s)" % (wakes(), calls("tally_want_update")))

        ok(not errors, "no page errors (%s)" % errors[:3])
        finish(br, srv)

def finish(br, srv):
    br.close(); srv.shutdown()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
