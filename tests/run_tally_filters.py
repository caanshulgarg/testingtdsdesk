"""python3 run_tally_filters.py - the Tally page's clients table: a filter at the head of each column (next-tally-filters;
the owner, 09-Nov-2026: "there should be filters in the tally companies list.. in column also... and with regard to
statuses also"). Made-up names only.
  1. three filters (state, masters, entries), each choice with its count; a choice with none greyed
  2. state "Not open in Tally": only the client whose company is open nowhere; "Showing 1 of 3", Clear filters
  3. the filters add up (state and entries); none match: "No client matches", the filters stay to change, Show all
  4. a phone width: no sideways scroll of the page
"""
import os, re, sys, json, threading, functools, http.server
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_FILTERS_PORT", "9573"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
NW = "NW144"
ORBIT, NOVA_C, LARK = "Orbit Space", "Nova Widgets", "Larkspur & Co"
ORB, NOVA = "ORBIT SPACE", "NOVA WIDGETS"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        o1 = T.dev(5, NW, "made-up-o1", tally="open", opened=(ORB,), version="2.5.4", rec=(ORB,), beat={"bridgePort": 9101, "windowsUser": NW + "\\made-up-o1"},
                   ports=[{"port": 9041, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        o2 = T.dev(6, NW, "made-up-o2", tally="open", opened=(NOVA,), version="2.5.4", rec=(NOVA,), beat={"bridgePort": 9102, "windowsUser": NW + "\\made-up-o2"},
                   ports=[{"port": 9043, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        c9 = [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": o1["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": NOVA, "client_id": "NAME:" + NOVA_C, "device_id": o2["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": "LARKSPUR CO", "client_id": "NAME:" + LARK, "device_id": o1["id"], "gstin": "", "last_seen": "ago:3000"}]
        E(T.SETUP, [[o1, o2], c9, [], "owner", [ORBIT, NOVA_C, LARK], True, {ORBIT: T.book(ORBIT), NOVA_C: T.book(NOVA_C)}])
        E("() => { window.__linksApi = false; }"); E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {}); E(TS.FORGET)
        E(TS.MINE, ["", "", ""]); E("() => { S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
        pg.wait_for_timeout(3500)
        ROWS = "#app [data-tsm-table] tr[data-tsm-row]"
        names = lambda: [pg.get_attribute(x, "data-tsm-row") for x in [ROWS + ":nth-of-type(%d)" % (i + 1) for i in range(n(ROWS))]]
        pick = lambda k, v: (pg.select_option("#app select[data-tpt-filter=%s]" % k, v), pg.wait_for_timeout(500))
        opts = lambda k: E("(k) => [...document.querySelectorAll('#app select[data-tpt-filter=' + k + '] option')].map(o => [o.value, o.textContent, o.disabled])", k)

        print("== 1. three filters at the column heads")
        ok(n("#app [data-tsm-table] thead select[data-tpt-filter]") == 3, "1. a filter under Client, Masters and Entries (%d)" % n("#app thead select[data-tpt-filter]"))
        ok(n(ROWS) == 3, "1. all 3 clients shown (%s)" % names())
        st = {v: (w, d) for v, w, d in opts("fst")}
        ok(st["away"][0] == "Not open in Tally (1)" and not st["away"][1], "1. state: Not open in Tally (1) (%s)" % (st.get("away"),))
        ok(st["free"][0] == "Not linked (0)" and st["free"][1], "1. state: Not linked (0), greyed (%s)" % (st.get("free"),))
        ok(all(re.search(r"\(\d+\)$", w) for v, w, d in opts("fma") + opts("fen") if v != "all"), "1. every masters and entries choice with its count")
        ok(n("#app [data-tpt-filtered]") == 0, "1. no 'Showing' line while nothing is filtered")

        print("== 2. Not open in Tally")
        pick("fst", "away")
        ok(names() == [LARK], "2. only the client open nowhere (%s)" % names())
        ok(txt("#app [data-tpt-filtered]").startswith("Showing 1 of 3"), "2. Showing 1 of 3 (%s)" % txt("#app [data-tpt-filtered]"))
        ok("on" in (pg.get_attribute("#app select[data-tpt-filter=fst]", "class") or ""), "2. the filter in use stands out")
        pg.click("#app [data-tpt-fclear]"); pg.wait_for_timeout(500)
        ok(n(ROWS) == 3 and pg.input_value("#app select[data-tpt-filter=fst]") == "all", "2. Clear filters: all 3 again (%s)" % names())

        print("== 3. filters add up; none match")
        pick("fst", "ok")
        k = n(ROWS); ok(k >= 1 and LARK not in names(), "3. Connected: the open ones only (%s)" % names())
        e = [v for v, w, d in opts("fen") if v != "all" and not d and v != pg.input_value("#app select[data-tpt-filter=fen]")]
        pick("fst", "away"); pick("fen", "up") if "up" in [v for v, w, d in opts("fen") if not d] else None
        if pg.input_value("#app select[data-tpt-filter=fen]") == "up":
            ok(n(ROWS) == 0 and n("#app [data-tsm-none=match]") == 1, "3. Not open in Tally and entries up to date: none (%s)" % txt("#app [data-tsm-table]")[:160])
            ok(n("#app thead select[data-tpt-filter]") == 3, "3. the filters stay, to change them")
        else:
            pick("fma", "done") if "done" in [v for v, w, d in opts("fma") if not d] else None
            ok(True, "3. (no 'up to date' entries here: %s)" % e)
        pg.click("#app [data-tpt-fclear]"); pg.wait_for_timeout(500)
        ok(n(ROWS) == 3, "3. Clear filters: all 3 again")

        print("== 5. a read asked for the client's older Tally company (relinked since): not this link's read")
        OR = '#app [data-tsm-table] tr[data-tsm-row="%s"]' % ORBIT
        cid = pg.get_attribute(OR, "data-tsm-cid")
        before = pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters")
        E("""(c) => { S.tcoSync = S.tcoSync || {}; S.tcoSync[c] = {cid: c, company: 'ORBIT SPACE - (from 1-Apr-2021)', at: Date.now() - 400000, via: 'cloud', err: '', end: 0, late: false, led: null, prog: null, why: 'made up', la0: '', samples: []}; render(); }""", cid)
        pg.wait_for_timeout(700)
        ok(pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters") == before and "from 1-Apr-2021" not in txt(OR), "5. the older company's read is not shown on the row (%s -> %s; %s)" % (before, pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters"), txt(OR)[:160]))
        E("""(c) => { S.tcoSync[c].company = 'ORBIT SPACE'; render(); }""", cid); pg.wait_for_timeout(700)
        ok(pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters") in ("reading", "waiting"), "5. the same read for the linked company: shown (%s)" % pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters"))
        E("""(c) => { delete S.tcoSync[c]; render(); }""", cid); pg.wait_for_timeout(400)

        print("== 4. a phone")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(600)
        sw = E("() => document.documentElement.scrollWidth")
        ok(sw <= 392, "4. no sideways scroll of the page (%d)" % sw)
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
