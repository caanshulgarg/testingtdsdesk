"""python3 run_alerts_clear_keys.py - release-240 review M2 (09-Oct-2026): a cleared notification stays cleared.
  a) A fingerprint longer than the cloud keeps (migration 68/70: 2,000 characters a fingerprint, 500 notifications a call)
     still clears: each row sent is at most 2,000 characters (a long item is sent as its hash; many items go as several
     rows of the same notification), each call carries at most 500; read back from the cloud, it is still cleared.
     A Clear all of 1,200 notifications goes in calls of 500 or fewer, every one sent, none refused.
  b) "Changes wait on one computer" (ownwait) and "Bill reading has a problem on this computer" (selftest) are keyed on
     when the problem started, not on the day: cleared, the same problem the next day stays cleared; ended and back
     again, it is a new notification.
Offline; FinCom's cloud made up in the page (its dismissals kept as migration 68 keeps them, cut at 2,000 characters).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_alerts_clear_keys.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8419), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the cloud's dismissals as migration 68/70 keep them: at most 500 a call (else refused), key and fingerprint cut at 2,000
CLOUD = """() => { window.__db = []; window.__calls = [];
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.email = "me@zz.test"; Cloud.sess = () => ({user_id: "u-1"});
  AlertClear.rpc = async (fn, a) => { window.__calls.push([fn, a]);
    if (fn === "alert_dismiss"){ if (a.p_items.length > 500) throw new Error("at most 500 notifications at once");
      const b = "b" + window.__calls.length; a.p_items.forEach(x => window.__db.push({key: String(x.key).slice(0, 2000), fp: String(x.fp).slice(0, 2000), batch: b})); return {ok: true, batch: b, n: a.p_items.length}; }
    if (fn === "alert_dismissals_list") return window.__db.map(r => Object.assign({}, r));
    return {ok: true}; };
  AlertClear.reset(); try { Object.keys(localStorage).filter(k => /^fincom:alert/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e){}
  return true; }"""
# read back from the cloud only (this browser's copy dropped)
RELOAD = """async () => { try { Object.keys(localStorage).filter(k => /^fincom:alerts-cleared/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e){}
  AlertClear.reset(); AlertClear.rowsNow(); await AlertClear.load(); return AlertClear.st.rows.length; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8419/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    E = pg.evaluate
    # ---------- a) a long fingerprint
    E(CLOUD)
    E("""async () => { const items = Array.from({length: 260}, (_, i) => "line:" + (100000 + i) + ":need"); items.push("gap:" + "b".repeat(2600) + ":2026-10-07");
      window.__x = {key: "book:c1|b1", fp: AlertClear.fp(items), text: "GARG: 260 entries"}; await AlertClear.clear([window.__x]); }""")
    sent = E("window.__calls.filter(c => c[0] === 'alert_dismiss').map(c => c[1].p_items)")
    rows = [r for c in sent for r in c]
    ok(E("window.__x.fp.length") > 4000, "a notification whose fingerprint is %d characters" % E("window.__x.fp.length"))
    ok(rows and all(len(r["fp"]) <= 2000 and len(r["key"]) <= 2000 for r in rows) and all(len(c) <= 500 for c in sent),
       "a) each row sent at most 2,000 characters (%s rows, longest %d), each call at most 500" % (len(rows), max([len(r["fp"]) for r in rows] or [0])))
    E(RELOAD)
    ok(E("AlertClear.cleared(window.__x)"), "a) read back from the cloud (as it keeps them): still cleared")
    # ---------- a) Clear all of 1,200
    E(CLOUD)
    E("""async () => { window.__all = Array.from({length: 1200}, (_, i) => ({key: "alert:" + i, fp: AlertClear.fp(["alert:" + i]), text: "n" + i})); await AlertClear.clear(window.__all); }""")
    calls = E("window.__calls.filter(c => c[0] === 'alert_dismiss').map(c => c[1].p_items.length)")
    ok(calls and max(calls) <= 500 and sum(calls) == 1200, "a) Clear all of 1,200: calls of %s (each 500 or fewer, all sent)" % calls)
    E(RELOAD)
    ok(E("window.__all.every(x => AlertClear.cleared(x))") and E("AlertClear.st.rows.every(r => !r.pending)"), "a) every one cleared in the cloud, none left to send again")
    # ---------- b) ownwait and selftest keyed on when the problem started
    E(CLOUD)
    # the self-test failing on this computer all along (the page's own list keys it as the test does)
    E("() => { window.__now = Date.now(); window.__realNow = Date.now; window.selfTestSummary = () => ({state: 'fail', fails: ['pdf'], r: {pdf: {msg: 'PDF reading failed'}}}); }")
    day = lambda d: E("(d) => { Date.now = () => window.__now + d * 86400000; return true; }", d)
    fp = lambda: E("() => [AlertClear.ownwaitFp('d1', true), AlertClear.selftestFp(['pdf'], true)]")
    day(0); f0 = fp()
    E("async (f) => { await AlertClear.clear([{key: 'ownwait:d1', fp: f[0], text: 'wait'}, {key: 'app:selftest', fp: f[1], text: 'self'}]); }", f0)
    day(1); f1 = fp()
    ok(f1 == f0 and E("(f) => f.every(x => AlertClear.cleared({fp: x}))", f1), "b) the same problems the next day: the same fingerprints, still cleared (%s)" % f1)
    E("() => { AlertClear.ownwaitFp('d1', false); AlertClear.selftestFp(['pdf'], false); }")
    day(2); f2 = fp()
    ok(f2[0] != f0[0] and f2[1] != f0[1] and E("(f) => f.every(x => !AlertClear.cleared({fp: x}))", f2), "b) ended, then back: new notifications, shown (%s)" % f2)
    E("() => { Date.now = window.__realNow; }")
    ok(not errors, "no page errors %s" % errors[:3])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
