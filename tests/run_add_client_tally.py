"""python3 run_add_client_tally.py - "Add client" (02-Oct-2026): the Tally companies the bridge here sees open and the ones
the firm's Tally computers reported are offered; choosing one fills the Tally name, ticks "Post this client's entries only
into <company>", and on Add the client is sent to the server and linked to that company in one step. A company linked
to another client cannot be chosen.
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
      TCloud.link = async (c, id) => { window.__calls.push(['link', c, id]); };
      window.cloudPushNow = async () => { window.__calls.push(['push']); };
      doAct('addCo'); }""")
    pg.wait_for_timeout(600)
    opts = pg.evaluate("[...document.querySelectorAll('#app select[data-add-tally] option')].map(o => [o.value, o.textContent, o.disabled])")
    zz = [o for o in opts if o[0] == "ZZ TEST"]; gs = [o for o in opts if o[0] == "GARG SHEKHAR & COMPANY"]
    ok(zz and "open in Tally on this computer" in zz[0][1] and not zz[0][2], "ZZ TEST is offered, open in Tally (%s)" % (zz and zz[0][1]))
    ok(gs and gs[0][2] and "linked to Testing AAD" in gs[0][1], "GARG SHEKHAR & COMPANY, linked to Testing AAD, cannot be chosen")
    pg.select_option("#app select[data-add-tally]", "ZZ TEST"); pg.wait_for_timeout(300)
    ok(pg.input_value("#ncName") == "ZZ TEST" and pg.is_checked("#app [data-add-postonly] input"), "choosing it fills the name and ticks 'Post this client's entries only into ZZ TEST'")
    pg.click('#app button:has-text("Add and open")'); pg.wait_for_timeout(1000)
    r = pg.evaluate("(() => { const c = Object.values(S.companies).find(x => x.name === 'ZZ TEST'); return {postTo: c.postTo, tally: c.tallyName, id: c.id, calls: window.__calls, open: S.coId === c.id}; })()")
    ok(r["postTo"] == "ZZ TEST" and r["tally"] == "ZZ TEST" and r["open"], "added and opened: Tally name ZZ TEST, posting allowed only into ZZ TEST")
    ok(r["calls"] == [["push"], ["link", "ZZ TEST", r["id"]]], "sent to the server, then linked to ZZ TEST in the cloud (%s)" % r["calls"])
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
