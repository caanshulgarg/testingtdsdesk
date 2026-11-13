"""python3 run_tally_lna_many.py - next-tally-connectfix, audit items 8 and 9 (04-Nov-2026). Signed in to a stand-in of FinCom's
cloud with the made-up firm of tally_shapes.py, on the Tally page; the browser's permission and the bridge made up:
  8. Chrome's Local Network Access permission denied for the site (navigator.permissions says "denied"; every /ping fails):
     Connect says the plain fix (the icon left of the address bar > Local network access > Allow, then reload), the page's
     own words say the same, and nowhere does the page say FinCom Bridge is not running;
  9. Tally with several companies open at once (two Tallys of this login, four companies, one session saying Tally runs
     in Educational mode: the bridge has no such field, so an unknown field is passed through untouched): Get companies
     lists every one, Find Tally counts them, and the table offers each company open in this login's Tally that no client
     has; nothing says "no company open" or "not answering".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_lna_many.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
from run_tally_connect_norekey import Q, ok, fails, errors, LATEST, READY
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_PORT", "9574"))
DENY = """(() => { const q = navigator.permissions && navigator.permissions.query ? navigator.permissions.query.bind(navigator.permissions) : null;
  if (navigator.permissions) navigator.permissions.query = (d) => (d && /local-network|loopback/.test(d.name)) ? Promise.resolve({ state: 'denied', name: d.name, onchange: null }) : (q ? q(d) : Promise.reject(new Error('no'))); })()"""
COS = ["MADE-UP ALPHA TRADERS 2026-27", "MADE-UP BETA SERVICES LLP", "MADE-UP GAMMA EDU COMPANY", "MADE-UP DELTA EXPORTS"]

def page(br, base, deny):
    fx = TS.make(); cloud = TS.FakeCloud(fx)
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    pg.add_init_script(TS.signin_script(fx))
    if deny: pg.add_init_script(DENY)
    ctx.route("https://*.supabase.co/**", cloud.route)
    ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
    ctx.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
    ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("failed"))
    pg.goto(base + "#/tally", wait_until="domcontentloaded", timeout=120000)
    pg.wait_for_function(READY, timeout=90000); pg.wait_for_function("() => !!window.FCTallyConnect && !!window.FCTallySimple", timeout=60000)
    return ctx, pg

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://localhost:%d/" % PORT
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        print("== 8. Local Network Access denied")
        ctx, pg = page(br, base, True)
        pg.wait_for_timeout(5000)
        ok(pg.evaluate("async () => { await FCTallyConnect.checkLna(); return FCTallyConnect.LNA.st; }") == "denied", "8. the permission is read as denied")
        r = pg.evaluate("async () => { TCloud.on = () => true; const r = await FCTallyConnect.connectNow({}); return [r.st, r.say]; }")
        ok(r[0] == "lna" and "Local network access" in r[1] and "Allow" in r[1] and "not running" not in r[1], "8. Connect: the plain fix (%s: %s)" % tuple(r))
        b = pg.evaluate("() => FCTallySimple.bridgeSay([])")
        ok(b and b["kind"] == "blocked" and "Local network access" in b["words"], "8. the page's own words: blocked, the fix (%s)" % b)
        pg.evaluate("() => { FCTallySimple.LOCALB.perm = 'denied'; render(); }"); pg.wait_for_timeout(1200)
        txt = pg.evaluate("() => (document.querySelector('#app [data-tally-simple]') || document.body).innerText")
        ok("not running" not in txt, "8. nowhere on the Tally page: 'not running' (%s)" % [l for l in txt.splitlines() if "not running" in l][:2])
        ok("Local network access" in txt, "8. the page shows the fix")
        ctx.close()

        print("== 9. several companies open, one Tally in Educational mode")
        ctx, pg = page(br, base, False)
        st = {"ok": True, "version": "2.5.3", "computer": "PC-SHARED", "user": "PC-SHARED\\userone", "sameSession": True, "mode": "auto",
              "sessions": [{"port": 9000, "ok": True, "mine": True, "companies": [{"name": COS[0], "gstin": ""}, {"name": COS[1], "gstin": ""}]},
                           {"port": 9001, "ok": True, "mine": True, "licenseMode": "Educational", "companies": [{"name": COS[2], "gstin": ""}, {"name": COS[3], "gstin": ""}]}]}
        r = pg.evaluate("""async (st) => {
          const cfg = { url: 'http://127.0.0.1:9100', key: 'made-up-key', bridgeId: 'go-9100abcdef' };
          Bridge.blocked = () => false; Bridge.cfg = () => Object.assign({}, cfg); Bridge.setCfg = (x) => Object.assign(cfg, x);
          Bridge.call = async (path) => { if (path.startsWith('/status')) return JSON.parse(JSON.stringify(st)); if (path === '/diagnose') return { tallies: [], findings: [] }; return { ok: true }; };
          Bridge.ensureProven = async () => true; Bridge.diagnose = async () => ({ tallies: [], findings: [] });
          const g = await FCTallyConnect.getCompanies(), f = await FCTallyConnect.findTally();
          FCTallySimple.LOCALB.page = 1;   // (next-tally-own-status: the Tally page's own first look is not asked again over this made-up answer)
          FCTallySimple.LOCALB.list = [{ port: 9100, url: 'http://127.0.0.1:9100', bridgePort: 9100, bridgeId: 'go-9100abcdef', sameSession: true, windowsUser: 'PC-SHARED\\\\userone', version: '2.5.3', bridge: 'FinCom Tally Bridge' }];
          const o = FCTallySimple.ownState();
          const rows = FCTallySimple.tableRows({}).filter((x) => x.kind === 'company').map((x) => x.company);
          return { g: (g.list || []).map((x) => x.company), gsay: g.say, f: f.say, own: o.state, names: o.names ? [...o.names.values()] : [], rows };
        }""", st)
        ok(sorted(r["g"]) == sorted(COS), "9. Get companies: every open company (%s)" % r["g"])
        ok("4 companies open" in r["gsay"], "9. Get companies says 4 open (%s)" % r["gsay"])
        ok("2 companies open" in r["f"] and r["f"].count("TallyPrime on port") == 2, "9. Find Tally: both Tallys, 2 companies each (%s)" % r["f"])
        ok(r["own"] == "ok" and sorted(r["names"]) == sorted(COS), "9. this login's Tally: every company open (%s)" % r["names"])
        ok(all(c in r["rows"] for c in COS), "9. the table offers each open company no client has (%s)" % r["rows"])
        pg.evaluate("() => render()"); pg.wait_for_timeout(1500)
        txt = pg.evaluate("() => (document.querySelector('#app [data-tally-simple]') || document.body).innerText")
        ok(all(c in txt for c in COS), "9. every open company is on the page")
        ok("no company open" not in txt.lower() and "not answering" not in txt.lower(), "9. no false 'no company open' / 'not answering'")
        ok(not errors, "no page errors (%s)" % errors[:3])
        ctx.close(); br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
