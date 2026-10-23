"""python3 run_signin_session.py - staying signed in (owner's section D, 03-Oct-2026).
The firm account is stood in for by a small HTTP server that behaves like Supabase Auth with refresh-token rotation:
a refresh token works once; a second refresh with the same token is refused (invalid_grant, "Already Used") and the
whole session family dies, as GoTrue does outside its reuse window. Two real tabs (one browser context, one
localStorage) are opened against it.
  1. two tabs whose token ran out refresh at the same moment: one refresh for both, nobody refused, both stay in
  2. a sign-out in one tab: the other tab says so (not a blank sign-in page); a sign-in in one tab brings the other in
  3. a session that cannot continue (every refresh refused): the sign-in page says why, the open bill and what was typed
     come back after signing in, and the sign-out reason reaches the activity log
  4. no automatic sign-out: 31 minutes without a click, still signed in; no such control in Settings
  5. "Sign out of all devices": the owner sees it and it calls logout?scope=global; a member does not see it
  6. "Keep me signed in": ticked (default) = session in localStorage; unticked = sessionStorage (a new tab is not signed
     in, a reload is)
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_signin_session.py"""
import os, json, time, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = 8181, 9321
FAKE = "http://localhost:%d" % FAKE_PORT
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE)).serve_forever, daemon=True).start()

# ---------- the fake Supabase ----------
ST = {"n": 1, "access": "A1", "refresh": "R1", "used": set(), "dead": False, "refuse_all": False, "delay": 0.0, "role": "owner",
      "refreshes": 0, "refused": 0, "logouts": [], "activity": [], "calls": [], "lock": threading.Lock()}
def new_session():
    ST["n"] += 1; ST["access"] = "A%d" % ST["n"]; ST["refresh"] = "R%d" % ST["n"]; ST["dead"] = False
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-upsert, x-client-info, accept")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
    def out(self, code, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code); self.cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data: self.wfile.write(data)
    def do_OPTIONS(self): self.out(204)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try: return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception: return {}
    def handle_any(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path; bearer = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        ST["calls"].append((self.command, self.path))
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/auth/v1/token":
            b = self.body()
            if q.get("grant_type") == ["password"]:
                new_session(); ST["used"] = set()
                return self.out(200, {"access_token": ST["access"], "refresh_token": ST["refresh"], "expires_in": 3600, "user": {"id": "u1", "email": b.get("email", "")}})
            if q.get("grant_type") == ["refresh_token"]:
                time.sleep(ST["delay"])
                with ST["lock"]:
                    tok = b.get("refresh_token")
                    if ST["refuse_all"]:
                        ST["refused"] += 1; return self.out(400, {"error": "invalid_grant", "error_description": "Invalid Refresh Token: Refresh Token Not Found"})
                    if tok in ST["used"] or tok != ST["refresh"]:
                        # a used token offered again: GoTrue ends the whole family
                        ST["refused"] += 1; ST["dead"] = True
                        return self.out(400, {"error": "invalid_grant", "error_description": "Invalid Refresh Token: Already Used"})
                    ST["used"].add(tok); new_session(); ST["refreshes"] += 1
                    return self.out(200, {"access_token": ST["access"], "refresh_token": ST["refresh"], "expires_in": 3600, "user": {"id": "u1", "email": "owner@firm.in"}})
            return self.out(400, {"error": "unsupported_grant_type"})
        if p == "/auth/v1/logout": ST["logouts"].append(q.get("scope", [""])[0]); return self.out(204)
        if p == "/auth/v1/user": return self.out(200, {"id": "u1", "email": "owner@firm.in", "factors": []})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if p.startswith("/rest/v1/"):
            if bearer != ST["access"] or ST["dead"]: return self.out(401, {"message": "JWT expired"})
            if p == "/rest/v1/members": return self.out(200, [{"user_id": "u1", "firm_id": "F1", "name": "Owner", "email": "owner@firm.in", "role": ST["role"], "active": True}])
            if p == "/rest/v1/rpc/mfa_status": return self.out(200, {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
            if p == "/rest/v1/rpc/my_account": return self.out(200, {"me": {"role": ST["role"], "email": "owner@firm.in", "name": "Owner"}, "firm": {"balance": 100, "name": "Fake Firm"}, "people": [], "modules": [], "usage": []})
            if p == "/rest/v1/activity" and self.command == "POST": ST["activity"].append(self.body()); return self.out(201)
            if p.startswith("/rest/v1/rpc/"): return self.out(200, {})
            return self.out(200, [])
        return self.out(404, {"message": "not here"})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake).serve_forever, daemon=True).start()

fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def signin_page(pg): return pg.locator('[data-act="cloudSignIn"]').count() > 0
def sign_in(pg, keep=None):
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.fill('[data-cloud="password"]', "pw12345678")
    if keep is not None: pg.set_checked('[data-cloud="keep"]', keep)
    pg.click('[data-act="cloudSignIn"]'); pg.wait_for_timeout(1800)
def storage(pg): return pg.evaluate("() => ({local: !!localStorage.getItem('tdsdesk-test:cloudsess'), session: !!sessionStorage.getItem('tdsdesk-test:cloudsess'), on: Cloud.on()})")
def open_settings(pg): pg.evaluate("() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'account'; render(); }"); pg.wait_for_timeout(500)

with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 900})
    # the test build is tied to the staging address (CLOUD_DEFAULT.lock): its requests are sent to the fake instead
    ctx.add_init_script("(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o); })()" % FAKE)
    A = ctx.new_page(); A.on("pageerror", lambda e: errors.append("A: " + str(e)))
    A.goto("http://localhost:%d/" % PAGE_PORT); A.wait_for_timeout(2500)
    ok(signin_page(A) and A.locator('[data-cloud="keep"]').count() == 1 and A.is_checked('[data-cloud="keep"]'), "the sign-in form has 'Keep me signed in', ticked by default")
    sign_in(A)
    st = storage(A)
    ok(not signin_page(A) and st["on"] and st["local"] and not st["session"], "ticked: signed in, the session is kept in localStorage " + str(st))
    B = ctx.new_page(); B.on("pageerror", lambda e: errors.append("B: " + str(e)))
    B.goto("http://localhost:%d/" % PAGE_PORT); B.wait_for_timeout(2500)
    ok(not signin_page(B), "a second tab is signed in with the same session")

    # 1. the two-tab refresh race: the token ran out while both tabs sat open; both call the firm account at once
    ST["refreshes"] = ST["refused"] = 0; ST["delay"] = 0.7
    A.evaluate("() => Cloud.setSess(Object.assign({}, Cloud.sess(), {at: Date.now() - 7200e3}))")
    A.evaluate("() => { window.__p = Cloud.api('records?select=id&limit=1').then(() => 'ok', e => 'err: ' + e.message); }")
    B.evaluate("() => { window.__p = Cloud.api('records?select=id&limit=1').then(() => 'ok', e => 'err: ' + e.message); }")
    ra = A.evaluate("() => window.__p"); rb = B.evaluate("() => window.__p"); A.wait_for_timeout(300)
    ok(ST["refreshes"] == 1 and ST["refused"] == 0, "two tabs refreshing at once: one refresh, none refused (refreshes %d, refused %d)" % (ST["refreshes"], ST["refused"]))
    ok(ra == "ok" and rb == "ok", "both tabs' requests go through (A: %s, B: %s)" % (ra, rb))
    ta, tb = A.evaluate("Cloud.sess().access_token"), B.evaluate("Cloud.sess().access_token")
    ok(ta == tb == ST["access"] and not signin_page(A) and not signin_page(B) and not ST["dead"], "both tabs hold the new token and stay signed in (%s, %s, server %s)" % (ta, tb, ST["access"]))
    ST["delay"] = 0.0

    # 2. signing out in one tab: the other says so; signing in again in one tab brings the other in
    ST["activity"] = []
    A.evaluate("() => { S.view = 'home'; S.homeTab = 'today'; render(); }")
    A.evaluate("() => signOutHere('Signed out.')"); B.wait_for_timeout(1200)
    ok(signin_page(A) and signin_page(B), "signing out in tab A also shows the sign-in page in tab B")
    ok("another tab" in B.inner_text("#app") and "Your sign-in ended" in B.inner_text("#app"), "and tab B says why (signed out in another tab), not a blank sign-in page")
    ok(any(a.get("what") == "signout" and "Signed out" in a.get("detail", "") for a in ST["activity"]), "the activity log has the sign-out with its reason: " + str([(a.get("what"), a.get("detail")) for a in ST["activity"]]))
    sign_in(B); A.wait_for_timeout(1500)
    ok(not signin_page(B) and not signin_page(A), "signing in again in tab B brings tab A in too")
    B.close()

    # 3. a session that cannot continue: every refresh refused, the token no longer accepted
    cid = A.evaluate("""() => { const c = newCompany({name: 'ZZ Session Co', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      const e = newEntry('a.pdf'); Object.assign(e.x, {vendorName: 'Alpha', invoiceNo: '1', invoiceDate: '2026-09-19', taxable: 100, total: 100}); S.data[c.id].entries[e.id] = e;
      Store.saveCompany(c); Store.saveEntry(c.id, e); return [c.id, e.id]; }""")
    A.evaluate("(a) => openCompany(a[0]).then(() => { S.tab = 'invoices'; S.reviewTable = false; S.selected = a[1]; render(); })", cid); A.wait_for_timeout(900)
    bill = A.evaluate("location.hash")
    A.fill('[data-fk="x:vendorName"]', "Alpha Traders typed"); A.wait_for_timeout(300)
    ST["refuse_all"] = True; ST["access"] = "gone-on-server"; ST["activity"] = []; ST["refused"] = 0
    r = A.evaluate("() => Cloud.api('records?select=id&limit=1').then(() => 'ok', e => 'err: ' + e.message)"); A.wait_for_timeout(800)
    t = A.inner_text("#app")
    ok(signin_page(A), "a refused refresh on every path ends the sign-in (the request: %s)" % r)
    ok("Your sign-in ended:" in t and "Sign in again; your work is kept." in t, "the sign-in page says why, in words: " + (t.split("Your sign-in ended:")[1].split("\n")[0].strip() if "Your sign-in ended:" in t else "(nothing)"))
    ok(ST["refused"] == 1, "one refused refresh is enough: no retry storm (%d)" % ST["refused"])
    ok(A.evaluate("Route.pending") == bill, "the open bill is remembered (" + str(A.evaluate("Route.pending")) + ")")
    ST["refuse_all"] = False
    sign_in(A); A.wait_for_timeout(1500)
    ok(not signin_page(A) and A.evaluate("location.hash") == bill, "after signing in the bill page is back (" + A.evaluate("location.hash") + ")")
    ok(A.evaluate("() => (document.querySelector('[data-fk=\"x:vendorName\"]') || {}).value") == "Alpha Traders typed", "and what was typed in the bill is kept")
    A.wait_for_timeout(1500)
    ok(any(a.get("what") == "signout" and "sign-in ended" in a.get("detail", "") for a in ST["activity"]), "the sign-out and its reason reach the activity log once signed in again: " + str([(a.get("what"), a.get("detail")[:60]) for a in ST["activity"] if a.get("what") == "signout"]))

    # 4. no automatic sign-out
    ok(A.evaluate("typeof idleSet === 'undefined' && typeof idleMin === 'undefined'"), "the idle timer and its setting are gone")
    A.evaluate("() => { const t = Date.now; Date.now = () => t() + 31 * 60000; }"); A.wait_for_timeout(31500)
    ok(not signin_page(A) and A.evaluate("Cloud.on()"), "31 minutes without a click: still signed in")
    open_settings(A); t = A.inner_text("#app")
    ok("Sign out after" not in t and A.locator('select[aria-label="Sign out after"]').count() == 0, "Settings no longer offers 'Sign out after N minutes'")
    ok("does not sign you out by itself" in t, "and says there is no automatic sign-out")

    # 5. Sign out of all devices (the owner only)
    ok(A.locator('button:has-text("Sign out of all devices")').count() == 1 and A.locator('button:has-text("Sign out")').count() >= 2, "the owner sees Sign out and Sign out of all devices")
    ST["logouts"] = []
    A.click('button:has-text("Sign out of all devices")'); A.wait_for_timeout(400); A.click('[data-cbx="yes"]'); A.wait_for_timeout(1200)
    ok("global" in ST["logouts"] and signin_page(A), "it calls auth/v1/logout?scope=global and signs out here (%s)" % ST["logouts"])
    ST["role"] = "staff"
    sign_in(A); open_settings(A); A.wait_for_timeout(800)
    ok(not signin_page(A) and A.locator('button:has-text("Sign out of all devices")').count() == 0 and A.locator('button:has-text("Sign out")').count() >= 1, "a member sees Sign out, not Sign out of all devices")

    # 6. Keep me signed in, unticked
    A.evaluate("() => signOutHere('Signed out.')"); A.wait_for_timeout(600)
    sign_in(A, keep=False)
    st = storage(A)
    ok(not signin_page(A) and st["on"] and st["session"] and not st["local"], "unticked: signed in, the session is kept in sessionStorage only " + str(st))
    C = ctx.new_page(); C.goto("http://localhost:%d/" % PAGE_PORT); C.wait_for_timeout(2000)
    ok(signin_page(C), "a new tab is not signed in (sessionStorage is this tab's own)"); C.close()
    A.reload(); A.wait_for_timeout(2500)
    ok(not signin_page(A) and A.evaluate("Cloud.on()"), "a reload of the same tab stays signed in")
    A.evaluate("() => Cloud.setSess(Object.assign({}, Cloud.sess(), {at: Date.now() - 7200e3}))")
    r = A.evaluate("() => Cloud.api('records?select=id&limit=1').then(() => 'ok', e => 'err: ' + e.message)")
    st = storage(A)
    ok(r == "ok" and st["session"] and not st["local"], "a refresh keeps the session where it was (sessionStorage) " + str(st))
    A.evaluate("() => signOutHere('Signed out.')"); A.wait_for_timeout(600)
    sign_in(A, keep=True); st = storage(A)
    ok(st["local"] and not st["session"], "ticked again: back in localStorage " + str(st))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
