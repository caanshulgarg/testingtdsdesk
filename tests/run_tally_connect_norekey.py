"""python3 run_tally_connect_norekey.py - next-tally-connectfix finding 1 (04-Nov-2026). On staging the Tally page's Connect made
a NEW computer key whenever the bridge's heartbeat was not fresh (connectNow -> rekey), although FinCom's cloud already had
the bridge for this firm; the bridge is bound to its first key (migration 54), so the new key was refused for ever ("This
computer key cannot use bridge go-...: it belongs to ...": 3 alerts, each with a key made a second before). Signed in to a
stand-in of FinCom's cloud with the made-up firm of tally_shapes.py, on the Tally page; the bridge and the cloud's answers
made up in the page (nothing listens, nothing real is asked):
  1. the cloud has the bridge for this firm (tally_bridge_whose mine), its heartbeat 10 minutes old, its link this cloud's:
     Connect makes NO key, says "Connected ...; waiting for its first heartbeat", and asks the bridge for a beat (the wake);
  2. the same with Connect pressed again (force): no key;
  3. the bridge's link names another address, or it holds no key now: no key made; the latter says what an owner can do;
  4. a key FinCom does not know (the bridge reports to no firm): a key is made, as before (one), and handed over;
  5. TCloud.auto handing a key over in this tab at that moment: Connect waits for it, asks the cloud again, makes none;
  6. another tab made a key a moment ago: this one waits and asks again, makes none when the bridge is this firm's now.
RED on the build before this change: 1, 2, 3, 5, 6 fail (a key is made each time).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_connect_norekey.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_PORT", "9571"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
LATEST = {"setup": {"version": "2.5.3", "url": "https://x.example/assets/bridge-go/FinComBridge-Setup-2.5.3.exe", "sha256": "ab" * 32}}
READY = "() => typeof S === 'object' && S && S.firm && typeof Cloud === 'object' && Cloud.st && !!Cloud.st.lastSync && typeof render === 'function'"

def open_page(br, base):
    fx = TS.make(); cloud = TS.FakeCloud(fx)
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.add_init_script(TS.signin_script(fx))
    ctx.route("https://*.supabase.co/**", cloud.route)
    ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
    ctx.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
    ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
    pg.goto(base + "#/tally", wait_until="domcontentloaded", timeout=120000)
    pg.wait_for_function(READY, timeout=90000)
    pg.wait_for_function("() => !!window.FCTallyConnect", timeout=60000)
    return ctx, pg

# the made-up bridge and cloud in the page: whose (the cloud's answer, a list taken in turn), the bridge's link, its beat's age
SCENE = """async (o) => {
  window.__ocMsScale = 0.02;
  try { localStorage.removeItem('tdsdesk:rekeyAt'); } catch (e) {}
  if (o.otherTab) localStorage.setItem('tdsdesk:rekeyAt', String(Date.now() - 1000));
  const made = [], handed = [], wakes = [], whoseAsked = [];
  const old = new Date(Date.now() - o.beatMin * 60000).toISOString();
  Bridge.blocked = () => false; Bridge.on = () => true; Bridge.ensureProven = async () => true; Bridge.refind = async () => false;
  Bridge.cfg = () => ({ url: 'http://127.0.0.1:9100', key: 'made-up-key', bridgeId: 'go-aaaa1111bbbb', follow: true });
  Bridge.refresh = async () => { Bridge.st = { state: 'ok', at: Date.now(), computer: 'PC-SHARED', user: 'PC-SHARED\\\\userone', beat: { on: true, last: old }, sessions: [], open: [] }; return Bridge.st; };
  Bridge.call = async (path, body) => {
    if (path !== '/cloudlink') return { ok: true };
    if (body) { handed.push(body.key); return { ok: true, firm: 'Made-up Firm' }; }
    return o.link;
  };
  const whose = [].concat(o.whose);
  TCloud.on = () => true;
  TCloud.refreshPane = async () => {};
  TCloud.rekeyed = null;
  TCloud.autoBusy = !!o.autoBusy;
  if (o.autoBusy) setTimeout(() => { TCloud.autoBusy = false; }, 100);
  TCloud.rpc = async (fn, a) => {
    if (fn === 'tally_bridge_whose') { whoseAsked.push(Date.now()); return whose.length > 1 ? whose.shift() : whose[0]; }
    if (fn === 'tally_device_create') { made.push(a.p_name); return { id: 'd0000000-0000-4000-8000-0000000000' + String(10 + made.length), key: 'fcd_' + '0'.repeat(47) + made.length }; }
    if (fn === 'tally_device_revoke') return {};
    return null;
  };
  TWake.send = (b) => { wakes.push(b); return Promise.resolve(null); };
  const t0 = Date.now();
  const r = await FCTallyConnect.connectNow({ force: !!o.force });
  return { st: r.st, say: r.say || '', made: made.length, handed: handed.length, wakes: wakes.length, asked: whoseAsked.length, ms: Date.now() - t0 };
}"""
ING = "() => TCloud.ingestUrl()"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://localhost:%d/" % PORT
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        ctx, pg = open_page(br, base)
        url = pg.evaluate(ING)
        mine = {"may": True, "mine": True, "elsewhere": False, "busy": False}
        dead = {"may": True, "mine": False, "elsewhere": False, "busy": False}
        same = {"connected": True, "url": url}

        print("== 1. the cloud has the bridge for this firm, its heartbeat 10 minutes old")
        r = pg.evaluate(SCENE, {"whose": [mine], "link": same, "beatMin": 10})
        ok(r["made"] == 0 and r["handed"] == 0, "1. no computer key made, none handed over (%s)" % r)
        ok(r["st"] == "ok" and "waiting for its first heartbeat" in r["say"], "1. says Connected, waiting for its first heartbeat (%s)" % r["say"])
        ok(r["wakes"] >= 1, "1. the bridge is asked for a beat (the wake)")

        print("== 2. Connect pressed again (force)")
        r = pg.evaluate(SCENE, {"whose": [mine], "link": same, "beatMin": 10, "force": True})
        ok(r["made"] == 0 and r["st"] == "ok", "2. force: no key made (%s)" % r)

        print("== 3. its link names another address; it holds no key now")
        r = pg.evaluate(SCENE, {"whose": [mine], "link": {"connected": True, "url": "https://made-up.example/functions/v1/tally-ingest"}, "beatMin": 10})
        ok(r["made"] == 0 and r["st"] == "ok", "3. another address, the cloud has it: no key made (%s)" % r)
        r = pg.evaluate(SCENE, {"whose": [mine], "link": {"connected": False}, "beatMin": 600})
        ok(r["made"] == 0 and r["st"] == "error" and "Release this bridge" in r["say"], "3. no key on the bridge, the cloud has it bound: no key made, the owner's step said (%s)" % r["say"][:120])

        print("== 4. a key FinCom does not know: a new key, as before")
        r = pg.evaluate(SCENE, {"whose": [dead], "link": same, "beatMin": 10})
        ok(r["made"] == 1 and r["handed"] == 1 and r["st"] == "ok", "4. one key made and handed over (%s)" % r)

        print("== 5. TCloud.auto handing a key over at that moment")
        r = pg.evaluate(SCENE, {"whose": [dead, mine], "link": {"connected": False}, "beatMin": 600, "autoBusy": True})
        ok(r["made"] == 0 and r["asked"] >= 2 and r["st"] == "ok", "5. waited for it, asked the cloud again, no second key (%s)" % r)

        print("== 6. another tab made a key a moment ago")
        r = pg.evaluate(SCENE, {"whose": [dead, mine], "link": {"connected": False}, "beatMin": 600, "otherTab": True})
        ok(r["made"] == 0 and r["st"] == "ok", "6. waited, asked again, no second key (%s)" % r)
        ok(r["ms"] < 5000, "6. bounded: answered in %d ms" % r["ms"])

        ok(not errors, "no page errors (%s)" % errors[:3])
        ctx.close(); br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
