"""python3 run_add_client_tally.py - "Add client" (02-Oct-2026; 23-Oct-2026, next-fix-tally-link: Pick from Tally): the
Tally companies the bridge here sees open and the ones the firm's Tally computers reported, not linked to a client, are
offered first; "Add as client" adds the client with that company as its Tally name and links it in one step (sent to the
server, then tally_company_link). A company linked to another client is not offered.
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
    pg.goto("http://localhost:8206/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
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
    rows = pg.evaluate("[...document.querySelectorAll('#app [data-add-pick-row]')].map(r => [r.getAttribute('data-add-pick-row'), r.innerText])")
    zz = [r for r in rows if r[0] == "ZZ TEST"]
    ok(zz and "open in Tally on this computer" in zz[0][1], "ZZ TEST is offered, open in Tally (%s)" % (zz and zz[0][1]))
    ok(not [r for r in rows if r[0] == "GARG SHEKHAR & COMPANY"], "GARG SHEKHAR & COMPANY, linked to Testing AAD, is not offered")
    pg.click('#app [data-add-pick-company="ZZ TEST"]'); pg.wait_for_timeout(1000)
    r = pg.evaluate("(() => { const c = Object.values(S.companies).find(x => x.name === 'ZZ TEST'); return {postTo: c.postTo || '', tally: c.tallyName, id: c.id, calls: window.__calls, open: S.coId === c.id}; })()")
    ok(r["tally"] == "ZZ TEST" and r["open"] and not r["postTo"], "added and opened: Tally name ZZ TEST; posting waits for the tick on its card")
    ok(r["calls"] == [["push"], ["link", "ZZ TEST", r["id"]]], "sent to the server, then linked to ZZ TEST in the cloud (%s)" % r["calls"])
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
