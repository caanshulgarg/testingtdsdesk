"""python3 run_catch_soon.py - MIS and the audit after pulls from Tally (speed, 11-Nov-2026: a linked client's MIS or Audit
tab worked the year out again on every pull, 2 s each, 7 s on an office PC, the browser tab on screen or not). With the
books of tests/books_data.py (the made-up fixture unless tests/data has a real one), nothing signed in:
  1. Tally changed (b.stale, as TallyRead.after marks it): the MIS tab works MIS out again at once, the first time;
  2. three more pulls within 5 s, each drawn: not again until 5 s after the last time, then once (the words "working it
     out again" meanwhile); the figures the same as a run by hand for the same period;
  3. the browser tab not on screen (document.hidden): a pull is not worked out; on screen again: worked out, once;
  4. the same for the Audit tab.
RED on the build before this change: 2 (worked out on each pull), 3 (worked out while hidden).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_catch_soon.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CATCH_PORT", "8219"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
import sys; sys.path.insert(0, HERE)
import books_data as BD
books = json.load(open(BD.CACHE))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

SETUP = """(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
  window.__runs = {mis: 0, audit: 0};
  // next-speed-render: a run is MIS.runIn / Audit.runIn (in steps behind the page; runNow runs the same steps at once)
  const m = MIS.runIn, a = Audit.runIn;
  MIS.runIn = function(){ window.__runs.mis++; return m.apply(this, arguments); };
  Audit.runIn = function(){ window.__runs.audit++; return a.apply(this, arguments); };
  window.__hidden = false; Object.defineProperty(document, "hidden", {configurable: true, get: () => window.__hidden});
  S.booksTab = "mis"; render(); }"""
PULL = "(k) => { S.books = window.__bk; S.books.stale = {audit: 'after changes came from the cloud copy', mis: 'after changes came from the cloud copy', range: null}; S.booksTab = k; render(); }"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1500)
        E = lambda js, *a: pg.evaluate(js, *a)
        E(SETUP, books); pg.wait_for_timeout(1500)
        E("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
        for k in ("mis", "audit"):
            print("== %s" % k)
            E("(k) => { window.__runs[k] = 0; }", k)
            pg.wait_for_timeout(5200)
            E(PULL, k); pg.wait_for_timeout(1500)
            n1 = E("(k) => window.__runs[k]", k)
            ok(n1 == 1, "1. %s: Tally changed, the tab on screen: worked out again at once (%d)" % (k, n1))
            for i in range(3): E(PULL, k); pg.wait_for_timeout(500)
            n2 = E("(k) => window.__runs[k]", k); words = "working it out again" in pg.inner_text("#app")
            ok(n2 == 1 and words, "2. %s: three more pulls within 5 s: not again yet (%d runs), says it will (%s)" % (k, n2, words))
            pg.wait_for_timeout(4500)
            n3 = E("(k) => window.__runs[k]", k)
            ok(n3 == 2 and not E("(k) => !!(S.books.stale || {})[k]", k), "2. %s: 5 s after: worked out again, once (%d runs)" % (k, n3))
            if k == "mis":
                last = E("() => { const L = S.books.mis.last; return [L.from, L.to, L.code]; }")
                again = E("() => { const L = S.books.mis.last; const r = MIS.run(L.from, L.to, 'run now'); return [r.from, r.to, r.code]; }")
                ok(last == again and last[2], "2. the figures the same as a run by hand for that period (result code %s)" % last)
            pg.wait_for_timeout(5200)
            E("(k) => { window.__runs[k] = 0; window.__hidden = true; }", k)
            E(PULL, k); pg.wait_for_timeout(1500)
            n4 = E("(k) => window.__runs[k]", k)
            ok(n4 == 0, "3. %s: the browser tab not on screen: not worked out (%d)" % (k, n4))
            E("() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); }"); pg.wait_for_timeout(1500)
            n5 = E("(k) => window.__runs[k]", k)
            ok(n5 == 1, "3. %s: on screen again: worked out, once (%d)" % (k, n5))
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
