"""python3 run_tally_masters_live.py - next-masters-progress (the owner: "reading masters does not have progress bar.. we
could not know whether it is working or not"). The Tally page's Masters cell shows the ledgers' read FinCom's cloud holds
(tally_ledger_progress, read with tally_period_status's ledger) also for a read nobody pressed on this page (Update now from
another place, the nightly run, Import ledgers). Made-up firm, login, clients and companies only (the stand-in cloud of
run_tally_simple.py). Written before the code. Checks:
  1. a company open in Tally, its read going (not done, fresh): "Reading now · Reading masters from Tally: 1,200 of 4,191
     ledgers…", its bar at 29; the count moves with the cloud's;
  2. the read done: "✓ Up to date · … · Masters read: 4,191 ledgers, HH:MM";
  3. a read that ended with nothing (done at 0 of 0): "No masters from Tally · Tally gave no masters for this company — is
     the right Tally company linked?", never ✓;
  4. a company open nowhere: its progress never asked (no bridge reads it);
  5. Update now pressed here, the read ending with nothing: the same words, never "✓ Up to date".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_masters_live.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_MASTERS_LIVE_PORT", "9583"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.13", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.13.exe", "sha256": "cd" * 32}}
PC = "SRV09"; UA = PC + "\\made-up-m"
HERON, PINE, QUILL, ROWAN = "Heron Fabrics", "Pine Logistics", "Quill Papers", "Rowan Foods"
HERC, PINC, QUIC, ROWC = "HERON FABRICS", "PINE LOGISTICS", "QUILL PAPERS", "ROWAN FOODS"
EMPTY = "Tally gave no masters for this company — is the right Tally company linked?"

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
        TB = "#app [data-tsm-table]"
        R = lambda name: TB + ' tr[data-tsm-row="%s"]' % name
        MC = lambda name: R(name) + " [data-tpg-masters]"
        up = {"port": 9039, "ok": True, "skipped": False, "n": 3, "error": "", "reason": "open"}
        dA = T.dev(7, PC, "made-up-m", tally="open", opened=(HERC, PINC, ROWC), version="2.5.13", rec=(HERC, PINC, ROWC), beat={"bridgePort": 9101, "windowsUser": UA}, ports=[up])
        cos = [{"company": HERC, "client_id": "NAME:" + HERON, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
               {"company": PINC, "client_id": "NAME:" + PINE, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
               {"company": QUIC, "client_id": "NAME:" + QUILL, "device_id": dA["id"], "gstin": "", "last_seen": "ago:3000"},
               {"company": ROWC, "client_id": "NAME:" + ROWAN, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"}]
        books = {HERON: T.book(HERON), PINE: T.book(PINE), QUILL: T.book(QUILL), ROWAN: T.book(ROWAN, ledgers=False, days=False)}
        ids = E(T.SETUP, [[dA], cos, [], "owner", [HERON, PINE, QUILL, ROWAN], True, books])
        E("() => { window.__linksApi = false; }")
        E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {"9101": TS.ping(9101, True, UA, version="2.5.13", bridgeId="go-9")}); E(TS.FORGET); E(TS.MINE, ["", "", ""])
        # the cloud: the ledgers and groups (counts), and each book's ledger progress (tally_period_status's ledger)
        E("""() => { window.__ledgers = {'bk-Heron Fabrics': Array.from({length: 4100}, (_, i) => ({name: 'L' + i})), 'bk-Pine Logistics': Array.from({length: 300}, (_, i) => ({name: 'L' + i})),
            'bk-Quill Papers': Array.from({length: 90}, (_, i) => ({name: 'L' + i}))};
          window.__groups = {'bk-Heron Fabrics': 61, 'bk-Pine Logistics': 40, 'bk-Quill Papers': 30}; window.__lp = {}; window.__lpAsked = {};
          const api = Cloud.api;
          Cloud.api = async (p, o) => { const m = /book_id=eq\\.([^&]+)/.exec(p), bk = m ? decodeURIComponent(m[1]) : '';
            if (/^tally_groups\\?/.test(p)) return Array.from({length: window.__groups[bk] || 0}, (_, i) => ({name: 'G' + i}));
            if (/^tally_ledger_rounds\\?/.test(p)) return [];
            return api(p, o); };
          TCloud.restAll = (u) => Cloud.api(u);
          const rpc = TCloud.rpc;
          TCloud.rpc = async (fn, a) => { if (fn === 'tally_fetch_summary') return {ok: true, books: []};
            if (fn === 'tally_period_status') { const b = a.p_book; window.__lpAsked[b] = (window.__lpAsked[b] || 0) + 1; const v = window.__lp[b];
              return {ok: true, pull: null, ledger: v ? Object.assign({}, v, v.now ? {at: new Date().toISOString()} : {}) : null}; }
            return rpc(fn, a); }; }""")
        E("() => { navHome('clients'); }"); pg.wait_for_timeout(500)
        E("() => { Object.values(TCloud.st || {}).forEach(s => { if (s) delete s.ledN; }); const G = window.FCGroupCounts || {}; Object.keys(G).forEach(k => delete G[k]); S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
        pg.wait_for_timeout(3500)
        ok(n(MC(HERON)) == 1 and pg.get_attribute(MC(HERON), "data-tpg-masters") == "done", "0. Heron starts up to date (%s)" % txt(MC(HERON)))

        print("== 1. a read nobody pressed here, going")
        E("() => { window.__lp['bk-Heron Fabrics'] = {round: 'r-n1', read: 1200, of: 4191, done: false, now: true}; }")
        pg.wait_for_timeout(22500)
        mh = txt(MC(HERON))
        ok(pg.get_attribute(MC(HERON), "data-tpg-masters") == "reading" and "Reading now" in mh and "Reading masters from Tally: 1,200 of 4,191 ledgers…" in mh, "1. Reading masters from Tally: 1,200 of 4,191 ledgers… (%s)" % mh)
        ok(pg.get_attribute(MC(HERON) + " [role=progressbar]", "aria-valuenow") == "29", "1. its bar at 29 (%s)" % pg.get_attribute(MC(HERON) + " [role=progressbar]", "aria-valuenow"))
        E("() => { window.__lp['bk-Heron Fabrics'].read = 3000; }")
        pg.wait_for_timeout(7000)
        mh = txt(MC(HERON))
        ok("3,000 of 4,191 ledgers…" in mh, "1. the count moves with the cloud's (%s)" % mh)

        print("== 2. the read done")
        E("() => { Object.assign(window.__lp['bk-Heron Fabrics'], {read: 4191, of: 4191, done: true, now: false, at: new Date().toISOString()}); }")
        pg.wait_for_timeout(7000)
        mh = txt(MC(HERON))
        ok(pg.get_attribute(MC(HERON), "data-tpg-masters") == "done" and re.search(r"Masters read: 4,191 ledgers, \d\d:\d\d$", mh), "2. ✓ … Masters read: 4,191 ledgers, HH:MM (%s)" % mh)

        print("== 3. a read that ended with nothing")
        E("() => { window.__lp['bk-Rowan Foods'] = {round: 'r-e', read: 0, of: 0, done: true, at: new Date().toISOString()}; }")
        pg.wait_for_timeout(22500)
        mr = txt(MC(ROWAN))
        ok(pg.get_attribute(MC(ROWAN), "data-tpg-masters") == "why" and mr == "No masters from Tally " + EMPTY and "✓" not in mr, "3. No masters from Tally · the plain words (%s)" % mr)

        print("== 4. a company open nowhere")
        ok(not E("() => window.__lpAsked['bk-Quill Papers'] || 0"), "4. Quill (open nowhere): its progress never asked (%s)" % E("() => window.__lpAsked"))

        print("== 5. Update now pressed here, the read ending with nothing")
        E("() => { window.__lp['bk-Pine Logistics'] = {round: 'r-p', read: 0, of: 0, done: true, now: true}; }")
        pg.click(R(PINE) + ' [data-tpt-main="update"]'); pg.wait_for_timeout(6000)
        mp, why = txt(MC(PINE)), txt(R(PINE) + " .tpt-why")
        ok(pg.get_attribute(MC(PINE), "data-tpg-masters") == "why" and EMPTY in mp and "✓" not in mp, "5. the Masters cell: the plain words, never ✓ (%s)" % mp)
        ok(EMPTY in why, "5. the row's result says it (%s)" % why)
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
