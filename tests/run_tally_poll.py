"""python3 run_tally_poll.py - the speed round of 27-Oct-2026 (staging, measured): one office browser left on the Tally
page from 23:18 to 03:53 made about 32,000 requests to FinCom's cloud (about 7,000 an hour: tally_devices 4,877,
tally_sync_cursor 4,248, tally_books 4,247, tally_companies 2,670, tally_read_stops 2,642, tally_member_bridges 1,183,
rpc/tally_status 1,178, and about 1,045 each of the bridge alerts, rollbacks, self-checks, prefs and releases), with
nothing changing; and fincom-call (the waiting-room watcher) was asked 407 times in 45 minutes.
With a request counter on every read of FinCom's cloud (Cloud.api: the tables and functions; Cloud.fn: fincom-call) and
the page's clock run by hand (page.clock):
  1. the Tally page left open and visible for 2 minutes makes at most TALLY_MAX requests to the cloud, and fincom-call
     at most CALL_MAX;
  2. the releases, rollbacks, prefs, self-checks and member bridges are read once while the page stays open; Refresh
     reads them again (on demand);
  3. a hidden tab makes no request at all in 5 minutes (neither the Tally page nor fincom-call); shown again, it reads once;
  4. a bridge's beat that changes what the page shows is on the page within 30 s with no Realtime (the computer's line),
     and at once through the beat channel (TLight.beatIn);
  5. a change of FinCom's copy that leaves the gap as it was (tally_sync_cursor, the bridge's every send) reads nothing
     again; a new gap is read.
Prints the requests per path and the requests per hour each way.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_poll.py"""
import json, os, sys, threading, functools, http.server, collections
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8431
TALLY_MAX, CALL_MAX = 20, 5
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

D1 = "d0000000-0000-4000-8000-000000000001"
def dev(tally="open", opened=("GB TEXCOAT",)):
    b = {"at": "ago:0.2", "version": "2.4.4", "computer": "NWS144", "user": "anshul", "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally,
         "open": list(opened), "tallyPort": 9002, "dataFolder": "C:\\TallyPrime\\Data", "reqs": {"day": "TODAY", "n": 4}}
    bt = {"at": "ago:0.2", "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False,
          "ports": [{"port": 9002, "ok": tally == "open", "skipped": False, "n": len(opened), "error": "", "state": tally}],
          "companies": [{"name": co, "open": True, "phase": "live", "waiting": 0, "lastRead": "ago:1"} for co in opened]}
    return {"id": D1, "name": "NWS144", "revoked": False, "last_seen": "ago:0.2", "version": "2.4.4", "main_bridge": "go-1", "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": "NWS144", "user": "anshul", "beat": bt, "bridges": {"go-1": b}},
            "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}
CLIENTS = ["GB TEXCOAT", "ABC TRADERS"]
SETUP = """([devs, clients]) => {
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  Object.values(S.companies).forEach(c => { if (!clients.includes(c.name)) delete S.companies[c.id]; });
  const ids = {};
  clients.forEach(n => { let c = Object.values(S.companies).find(x => x.name === n);
    if (!c){ c = newCompany({name: n, gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
    ids[n] = c.id; });
  window.__fix = fix;
  window.__devs = fix(devs);
  window.__companies = clients.map(n => ({company: n, client_id: ids[n], device_id: devs[0].id, gstin: "", last_seen: ago(1)}));
  window.__gap = null;
  // the request counter: every read of FinCom's cloud goes through Cloud.api (tables and rpc/…) or Cloud.fn (functions)
  window.__req = [];
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const tick = () => new Promise(r => setTimeout(r, 5));
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = []; Cloud.st.mfa = false;
  Cloud.sess = () => ({access_token: "t", refresh_token: "r", user_id: "u-1", at: Date.now(), expires_in: 3600});
  TCloud.on = () => true;
  Cloud.api = async (path) => {
    window.__req.push(String(path).split("?")[0]);
    await tick();
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    if (/^tally_books/.test(path)) return clients.map(n => ({book_id: "bk-" + n, client_id: ids[n], company: n, days_at: ago(30)}));
    if (/^tally_sync_cursor/.test(path)) return window.__gap ? [{book_id: "bk-GB TEXCOAT", gap: window.__gap, gap_at: ago(1), state: "ok"}] : [{book_id: "bk-GB TEXCOAT", state: "ok"}];
    if (/^tally_bridge_releases/.test(path)) return [{version: "2.4.4", pilot_started_at: ago(600), held_at: null, withdrawn_at: null}];
    if (/^rpc\\/tally_status/.test(path)) return [];
    if (/^rpc\\//.test(path)) return {ok: true};
    return [];
  };
  Cloud.fn = async (name, body) => { window.__req.push("fn/" + name + "/" + ((body && body.action) || "")); await tick(); return name === "fincom-call" ? {ok: true, topic: "lobby:test", knocks: [], every: 30} : {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  Object.keys(TCloud.st).forEach(k => delete TCloud.st[k]);
  TCloud.pane.devices = null; TCloud.pane.companies = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  TLight.st.at = 0;
  document.body.classList.add("is-test"); S.firm.firmName = "ABC";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {}; S.tallyFocus = ""; S.tallyGuide = {}; S.coId = null; navHome("tally");
  return ids;
}"""
HIDE = """(h) => {
  Object.defineProperty(document, "visibilityState", {configurable: true, get: () => h ? "hidden" : "visible"});
  Object.defineProperty(document, "hidden", {configurable: true, get: () => h});
  document.dispatchEvent(new Event("visibilitychange"));
}"""
ONCE = ["tally_bridge_releases", "tally_bridge_rollbacks", "tally_bridge_prefs", "tally_selfchecks", "tally_member_bridges"]

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        # no Realtime here (as when the line drops it): the page must keep up by its reads alone
        pg.add_init_script("window.WebSocket = function(){ throw new Error('no realtime in this test'); };")
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
            body=json.dumps({"setup": {"version": "2.4.4", "url": "https://x/FinComBridge-Setup-2.4.4.exe", "sha256": "ab" * 32}})))
        pg.clock.install()
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        E(SETUP, [[dev("closed", ())], CLIENTS])
        # the page opens and settles (its first reads, the waiting-room watcher started)
        pg.clock.run_for(15000)
        first = E("() => window.__req.slice()")
        print("  the page's first reads (%d): %s" % (len(first), dict(collections.Counter(first))))
        ok(all(any(r == t for r in first) for t in ONCE), "the page's first reads include the releases, rollbacks, prefs, self-checks and member bridges")
        E("() => { window.__req = []; }")
        # 1. two minutes open and visible
        pg.clock.run_for(120000)
        reqs = E("() => window.__req.slice()")
        tally = [r for r in reqs if not r.startswith("fn/")]
        calls = [r for r in reqs if r.startswith("fn/fincom-call")]
        print("  2 minutes visible: %d to the tables, %d to fincom-call: %s" % (len(tally), len(calls), dict(collections.Counter(reqs))))
        print("  per hour: Tally page %d, calls %d" % (len(tally) * 30, len(calls) * 30))
        ok(len(tally) <= TALLY_MAX, "the Tally page open for 2 minutes: at most %d requests (%d)" % (TALLY_MAX, len(tally)))
        ok(len(calls) <= CALL_MAX, "fincom-call in those 2 minutes: at most %d (%d)" % (CALL_MAX, len(calls)))
        # 2. once a page open
        again = [t for t in ONCE if t in tally]
        ok(not again, "the releases, rollbacks, prefs, self-checks and member bridges are not read again while the page stays open (%s)" % again)
        E("() => { window.__req = []; }")
        btn = pg.locator("#app button:has-text('Refresh'), #app [data-check-again]")
        if btn.count():
            btn.first.click(); pg.clock.run_for(3000)
            r2 = E("() => window.__req.slice()")
            ok("tally_bridge_releases" in r2 and "tally_devices" in r2, "Refresh (on demand) reads them all again (%s)" % dict(collections.Counter(r2)))
        else:
            E("() => TCloud.refreshPane({all: true})"); pg.clock.run_for(3000)
            r2 = E("() => window.__req.slice()")
            ok("tally_bridge_releases" in r2, "a refresh asked for reads them all again (%s)" % dict(collections.Counter(r2)))
        # 3. hidden: nothing
        pg.clock.run_for(5000)
        E(HIDE, True); E("() => { window.__req = []; }")
        pg.clock.run_for(300000)
        hid = E("() => window.__req.slice()")
        ok(len(hid) == 0, "a hidden tab: no request in 5 minutes (%s)" % dict(collections.Counter(hid)))
        E(HIDE, False); pg.clock.run_for(3000)
        back = E("() => window.__req.slice()")
        tb = collections.Counter(r for r in back if r.startswith("tally_") or r.startswith("rpc/tally") or r.startswith("fn/"))
        ok("tally_devices" in back and max(tb.values()) <= 2, "shown again: read once at once, each read at most twice (%s)" % dict(tb))
        # 4. a beat that changes the page, no Realtime: on the page within 30 s
        line = lambda: E("() => { const e = document.querySelector('#app [data-pc-line]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; }")
        before = line()
        E("(d) => { window.__devs = window.__fix(d); }", [dev("open", ("GB TEXCOAT",))])
        pg.clock.run_for(31000)
        after = line()
        ok(before != after and "GB TEXCOAT" in pg.inner_text("#app"), "a new beat (Tally opened, GB TEXCOAT open) shows within 30 s without Realtime (%r -> %r)" % (before[:80], after[:80]))
        # and through the beat channel, at once
        E("(d) => TLight.beatIn({device: d, beat: {paused: true, at: new Date().toISOString()}})", D1)
        pg.clock.run_for(500)
        ok(line() != after, "a beat through the beat channel shows at once (%r)" % line()[:80])
        # 5. FinCom's copy changed, the gap as it was: nothing read again; a new gap: read
        if E("() => typeof CopyLive === 'object' && typeof Rec === 'object'"):
            E("() => { Rec.gapsOf(); }"); pg.clock.run_for(2000)
            E("() => { window.__req = []; CopyLive.in('tally_sync_cursor', {book_id: 'bk-GB TEXCOAT', gap: null, last_match_at: new Date().toISOString()}); }")
            pg.clock.run_for(8000)
            same = [r for r in E("() => window.__req.slice()") if r in ("tally_sync_cursor", "tally_books")]
            ok(not same, "the bridge's send with the gap unchanged reads nothing again (%s)" % same)
            E("() => { window.__gap = {since: '2026-10-20', days: 3}; window.__req = []; CopyLive.in('tally_sync_cursor', {book_id: 'bk-GB TEXCOAT', gap: window.__gap}); }")
            pg.clock.run_for(8000)
            ok("tally_sync_cursor" in E("() => window.__req.slice()"), "a new gap is read")
        br.close()
    srv.shutdown()
    errs = [e for e in errors if "no realtime" not in e]
    ok(not errs, "no page errors (%s)" % errs[:3])
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
