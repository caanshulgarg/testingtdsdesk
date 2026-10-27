"""python3 run_add_client_tally.py - "Add client" (02-Oct-2026; 23-Oct-2026, next-fix-tally-link: Pick from Tally): the
Tally companies the bridge here sees open and the ones the firm's Tally computers reported, not linked to a client, are
offered first; "Add as client" adds the client with that company as its Tally name and links it in one step (sent to the
server, then tally_company_link). A company linked to another client is not offered. 23-Oct-2026 (next-tally-suvit): the
rows are the Tally page's own Companies in Tally rows (data-tco-row), with the same pill ("Connected": open in Tally on
this computer). 24-Oct-2026 (next-tally-one-page): Add client picks no Tally company; its "Add it from the Tally page"
opens Companies in Tally, where Add as client does the same (every company listed, a linked one with its client).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_add_client_tally.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8206), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8206/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate("""() => { const g = newCompany({name: 'Testing AAD'}); S.companies[g.id] = g;
      window.__calls = [];
      Bridge.up = () => true; Bridge.st = Object.assign(Bridge.st || {}, {state: 'ok', open: [{name: 'ZZ TEST'}], sessions: []});
      TCloud.on = () => true; TCloud.refreshPane = async () => {};
      TCloud.pane.devices = [{id: 'd1', name: 'Office computer', revoked: false, info: {computer: 'NWS144', beat: {open: ['ZZ TEST']}}}];
      TCloud.pane.companies = [{company: 'ZZ TEST', client_id: null, gstin: ''}, {company: 'GARG SHEKHAR & COMPANY', client_id: g.id, gstin: '09AANFG3202D1ZR'}];
      TCloud.link = async (c, id) => { window.__calls.push(['link', c, id]); return true; };
      window.cloudPushNow = async () => { window.__calls.push(['push']); };
      doAct('addCo'); }""")
    pg.wait_for_timeout(600)
    # 24-Oct-2026 (next-tally-one-page): Add client picks no Tally company; its one button opens the Tally page's list
    ok(pg.locator("#app [data-tco-list=add]").count() == 0 and pg.locator("#app [data-add-tally-go]").count() == 1, "Add client: no Pick from Tally; 'Add it from the Tally page'")
    pg.click("#app [data-add-tally-go]"); pg.wait_for_timeout(1200)
    rows = pg.evaluate("[...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), r.innerText.replace(/\\s+/g, ' '), r.getAttribute('data-tco-state')])")
    zz = [r for r in rows if r[0] == "ZZ TEST"]
    ok(zz and zz[0][2] == "connected" and "Not a client" in zz[0][1] and "Add as client" in zz[0][1], "the Tally page: ZZ TEST, open in Tally on this computer, Not a client, Add as client (%s)" % (zz and zz[0][1]))
    gs = [r for r in rows if r[0] == "GARG SHEKHAR & COMPANY"]
    ok(gs and "Testing AAD" in gs[0][1] and "Add as client" not in gs[0][1], "GARG SHEKHAR & COMPANY is listed with its client Testing AAD, not offered to add (%s)" % (gs and gs[0][1]))
    pg.click('#app [data-tco-list=firm] [data-tco-row="ZZ TEST"] [data-tco-act=add]'); pg.wait_for_timeout(1500)
    r = pg.evaluate("(() => { const c = Object.values(S.companies).find(x => x.name === 'ZZ TEST'); return {postTo: c.postTo || '', tally: c.tallyName, id: c.id, calls: window.__calls, home: S.homeTab}; })()")
    ok(r["tally"] == "ZZ TEST" and r["home"] == "tally" and not r["postTo"], "added (the page stays on the list): Tally name ZZ TEST; posting waits for Post entries here")
    ok(r["calls"][:2] == [["push"], ["link", "ZZ TEST", r["id"]]], "sent to the server, then linked to ZZ TEST in the cloud (%s)" % r["calls"])
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
