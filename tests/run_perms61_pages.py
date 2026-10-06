"""python3 run_perms61_pages.py - migration 61 (06-Oct-2026): what the people and key pages really send. Migration 61 takes
INSERT / UPDATE / DELETE on members and platform_secrets away from signed-in users, although staging has policies for them
(members_self: a member updates their own row; secrets_write / secrets_update: a platform administrator adds or changes a
key). This test drives the real pages (Settings -> Firm account -> People; Settings -> Platform -> Keys) with the firm
account's network stood in for (every request to the account's address is answered here and recorded: method and path,
nothing stubbed inside the page: the page's own Cloud.fn / Cloud.rpc / Cloud.api send them), and checks the request each
action sends: an edge function or a function (rpc), never a table:
  1. inviting a person (with a role chosen, "Look only"): POST /functions/v1/admin, action invite_person, role readonly;
  2. adding a person with a password made: POST /functions/v1/admin, action add_person;
  3. a person switched off / on (the only change to a member the page offers: the role is shown, not editable):
     POST /functions/v1/admin, action set_person;
  4. a platform key saved (Claude API key, Google Vision key): POST /rest/v1/rpc/admin_set_secret;
  5. over the whole run: no POST / PATCH / DELETE / PUT to /rest/v1/members or /rest/v1/platform_secrets (or any other
     table).
The pages are React only (app/src/screens/Account.jsx); the legacy build has the same handlers (src/js/27-firm-account.js
doAct) but no longer renders these pages. The stand-in does not enforce grants: tests/run_migration61.py runs the SQL
behind each request (the service role's members upsert / update, admin_set_secret) on PostgreSQL with 61 applied.
Run: TDSDESK_SITE=../app/dist-test python3 run_perms61_pages.py (the default)."""
import os, json, threading, functools, http.server
from urllib.parse import urlparse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PORT = 8613
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = "https://perms61-stand-in.supabase.co"     # a name the page's CSP allows; every request to it is answered by the route below, none leaves the machine
fails, errors, reqs = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def answer(route, request):
    u = urlparse(request.url)
    try: body = json.loads(request.post_data or "null")
    except Exception: body = request.post_data
    reqs.append({"method": request.method, "path": u.path, "body": body})
    if request.method == "OPTIONS": return route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})
    if u.path.startswith("/functions/v1/admin"):
        out = {"ok": True, "email": (body or {}).get("email", ""), "password": "Pw-1" if (body or {}).get("action") == "add_person" else None, "note": ""}
    elif u.path.startswith("/rest/v1/rpc/"): out = None
    else: out = []
    route.fulfill(status=200, headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}, body=json.dumps(out))
def sent(method, path, **want):
    return [r for r in reqs if r["method"] == method and r["path"] == path and all(isinstance(r["body"], dict) and r["body"].get(k) == v for k, v in want.items())]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(FAKE + "/**", answer)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    # signed in to a stood-in firm account: only the address and the session are set; Cloud.fn / Cloud.rpc / Cloud.api are the page's own
    pg.evaluate("""() => { Cloud.on = () => true; Cloud.aal = () => 'aal1'; Cloud.fresh = async () => {}; window.__cc = {url: %s, key: 'anon-key', auto: false}; Cloud.cfg = () => window.__cc;
      Cloud.sess = () => ({access_token: 'tok-owner', refresh_token: 'r', user_id: 'u-owner', at: Date.now(), expires_in: 3600}); window.startCloudSync = () => {};
      window.loadAccount = () => {}; window.loadAdminOverview = () => {};
      Cloud.st = Object.assign(Cloud.st, {email: 'a@b.in', role: 'owner', mfa: null, mfaInfo: {}, members: []});
      S.account = {me: {role: 'owner'}, superadmin: true, firm: {id: 'f1', balance: 400, warn_at: 100, period_start: '2026-09-01'}, modules: [], people: [{name: 'Bina', email: 'b@b.in', role: 'staff', active: true}]};
      S.backups = []; S.dropKeys = []; S.firmSetupLater = true; S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'account'; render(); }""" % json.dumps(FAKE))
    pg.wait_for_timeout(500)
    ok(pg.locator("#npEmail").count() == 1 and pg.locator('tr[data-key="b@b.in"]').count() == 1, "the People page is shown (Settings -> Firm account)")
    # 1. invite, with a role chosen
    pg.fill("#npEmail", "c@b.in"); pg.fill("#npName", "Chetan"); pg.select_option("#npRole", "readonly"); pg.click('button:text-is("Invite by email")'); pg.wait_for_timeout(600)
    ok(len(sent("POST", "/functions/v1/admin", action="invite_person", email="c@b.in", role="readonly")) == 1,
       "1. inviting a person (role 'Look only'): POST /functions/v1/admin {action: invite_person, role: readonly} (%s)" % [r for r in reqs if r["path"].startswith("/functions")][-1:])
    # 2. a person added with a password made
    pg.fill("#npEmail", "d@b.in"); pg.fill("#npName", "Divya"); pg.select_option("#npRole", "owner"); pg.click('button:text-is("or make a password instead")'); pg.wait_for_timeout(600)
    ok(len(sent("POST", "/functions/v1/admin", action="add_person", email="d@b.in", role="owner")) == 1, "2. adding a person with a password made: POST /functions/v1/admin {action: add_person}")
    # 3. the role: shown, not editable; a person switched off and on
    row = pg.locator('tr[data-key="b@b.in"]')
    ok(row.locator("select, input").count() == 0 and "staff" in row.inner_text(), "3. a person's role is shown, with no control to change it (the page offers no role change)")
    row.locator('button:text-is("Switch off")').click(); pg.wait_for_timeout(600)
    ok(len(sent("POST", "/functions/v1/admin", action="set_person", email="b@b.in", active=False)) == 1, "3. a person switched off: POST /functions/v1/admin {action: set_person, active: false}")
    pg.evaluate("() => { S.account.people[0].active = false; render(); }"); pg.wait_for_timeout(300)
    pg.locator('tr[data-key="b@b.in"] button:text-is("Switch on")').click(); pg.wait_for_timeout(600)
    ok(len(sent("POST", "/functions/v1/admin", action="set_person", email="b@b.in", active=True)) == 1, "3. switched on again: POST /functions/v1/admin {action: set_person, active: true}")
    # 4. a platform key saved
    pg.evaluate("""() => { S.settingsTab = 'platform'; S.adminData = {month: 0, firms: [], plans: [], modules: [], secrets: [{name: 'claude_api_key', set_at: '2026-09-01'}]}; render(); }"""); pg.wait_for_timeout(400)
    for k in ("claude_api_key", "google_vision_key"):
        pg.fill("#sec_" + k, "key-" + k); pg.click('tr:has(#sec_%s) button:text-is("Save")' % k); pg.wait_for_timeout(600)
        ok(len(sent("POST", "/rest/v1/rpc/admin_set_secret", p_name=k, p_value="key-" + k)) == 1, "4. %s saved: POST /rest/v1/rpc/admin_set_secret (a function), not the table" % k)
    # 5. over the whole run
    tw = [(r["method"], r["path"]) for r in reqs if r["method"] in ("POST", "PATCH", "DELETE", "PUT") and r["path"].startswith("/rest/v1/") and not r["path"].startswith("/rest/v1/rpc/")]
    ok(not tw, "5. no POST / PATCH / DELETE / PUT to a table, members and platform_secrets included (%s)" % tw)
    ok(not [r for r in reqs if "/rest/v1/members" in r["path"] and r["method"] != "GET"] and not [r for r in reqs if "platform_secrets" in r["path"]],
       "5. members: never written; platform_secrets: never named in a request")
    print("  requests sent: %s" % sorted(set("%s %s" % (r["method"], r["path"]) for r in reqs)))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
