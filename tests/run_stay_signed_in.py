"""python3 run_stay_signed_in.py - "Stay signed in" (the owner, 13-Nov-2026): someone signed in to the firm account on
their own computer stays signed in, so the firm's screens just work.
The firm account is stood in for by a small HTTP server that behaves like Supabase Auth with refresh-token rotation (as
run_signin_session.py). Made-up logins only.
  1. the access token ran out while the browser was closed (the refresh token still good): opening FinCom refreshes it
     on its own and stays signed in
  2. no internet when FinCom opens: still signed in (nothing asks to sign in); once the internet is back the token is
     refreshed on its own. A server error (503; a 500 whose words name the session) or a 200 without a token never
     signs anyone out; a banned login (400 user_banned) is locked out and told so
  3. a laptop that slept for hours (no timer ran): coming back to the window refreshes the token at once
  4. a sign-in the firm account no longer takes (the refresh token revoked: "Sign out of all devices", a lost laptop):
     the page is locked behind the sign-in page as before, which says why, and comes back after signing in; no screen
     says "Sign in to the firm account"
  5. "This is a shared computer" (off by default): ticked, the sign-in is not kept once the browser is closed; not
     ticked, it is
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_stay_signed_in.py"""
import os, json, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = int(os.environ.get("STAY_PORT") or 8191), int(os.environ.get("STAY_FAKE_PORT") or 9331)
FAKE = "http://localhost:%d" % FAKE_PORT
URL = "http://localhost:%d/" % PAGE_PORT
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
page_srv = http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE))
threading.Thread(target=page_srv.serve_forever, daemon=True).start()

# ---------- the fake Supabase: a refresh token works once (rotation); "revoked" refuses every refresh ----------
ST = {"n": 1, "access": "A1", "refresh": "R1", "revoked": False, "fail503": False, "answer": None, "refreshes": 0, "refused": 0, "lock": threading.Lock()}
def new_session():
    ST["n"] += 1; ST["access"] = "A%d" % ST["n"]; ST["refresh"] = "R%d" % ST["n"]
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, code, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-upsert, x-client-info, accept")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data: self.wfile.write(data)
    def do_OPTIONS(self): self.out(204)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try: return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception: return {}
    def handle_any(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path; bearer = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/auth/v1/token":
            b = self.body()
            if q.get("grant_type") == ["password"]:
                new_session(); ST["revoked"] = False
                return self.out(200, {"access_token": ST["access"], "refresh_token": ST["refresh"], "expires_in": 3600, "user": {"id": "u1", "email": b.get("email", "")}})
            with ST["lock"]:
                if ST["fail503"]: return self.out(503, {"message": "upstream unavailable"})
                if ST["answer"]: return self.out(*ST["answer"])
                if ST["revoked"] or b.get("refresh_token") != ST["refresh"]:
                    ST["refused"] += 1
                    return self.out(400, {"error": "invalid_grant", "error_description": "Invalid Refresh Token: Refresh Token Not Found"})
                new_session(); ST["refreshes"] += 1
                return self.out(200, {"access_token": ST["access"], "refresh_token": ST["refresh"], "expires_in": 3600, "user": {"id": "u1", "email": "owner@firm.in"}})
        if p == "/auth/v1/user": return self.out(200, {"id": "u1", "email": "owner@firm.in", "factors": []})
        if p.startswith("/auth/v1/"): return self.out(204)
        if p.startswith("/rest/v1/"):
            if bearer != ST["access"] or ST["revoked"]: return self.out(401, {"message": "JWT expired"})
            if p == "/rest/v1/members": return self.out(200, [{"user_id": "u1", "firm_id": "F1", "name": "Owner", "email": "owner@firm.in", "role": "owner", "active": True}])
            if p == "/rest/v1/rpc/mfa_status": return self.out(200, {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
            if p == "/rest/v1/rpc/my_account": return self.out(200, {"me": {"role": "owner", "email": "owner@firm.in", "name": "Owner"}, "firm": {"balance": 100, "name": "Test Firm of Accountants"}, "people": [], "modules": [], "usage": []})
            if p.startswith("/rest/v1/rpc/"): return self.out(200, {})
            return self.out(200, [])
        return self.out(404, {"message": "not here"})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
fake_srv = http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake)
threading.Thread(target=fake_srv.serve_forever, daemon=True).start()

fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
KEY = "tdsdesk-test:cloudsess"      # the test build's own keys (tdsdesk-test:)
TO_FAKE = "(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o); })()" % FAKE
def context(br, state=None):
    c = br.new_context(viewport={"width": 1400, "height": 900}, storage_state=state)
    c.add_init_script(TO_FAKE)      # the test build is tied to staging: its requests go to the fake instead
    return c
def page(c):
    pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.goto(URL); pg.wait_for_timeout(2500); return pg
def signin_page(pg): return pg.locator('[data-act="cloudSignIn"]').count() > 0
def sign_in(pg, shared=None):
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.click('[data-act="cloudSignIn"]'); pg.fill('[data-cloud="password"]', "pw12345678")
    if shared is not None: pg.set_checked('[data-cloud="shared"]', shared)
    pg.click('[data-act="cloudSignIn"]'); pg.wait_for_timeout(2000)
def expire(pg):
    # the access token ran out two hours ago (the refresh token still the server's)
    pg.evaluate("(k) => { for (const st of [localStorage, sessionStorage]) { const s = JSON.parse(st.getItem(k) || 'null'); if (s) st.setItem(k, JSON.stringify(Object.assign(s, {at: Date.now() - 7200e3}))); } }", KEY)
def notes(pg): return pg.locator('[data-save="signedout"]')
def asks_sign_in(pg): return "Sign in to the firm account" in pg.inner_text("#app")

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = context(br); A = page(ctx)
    ok(A.locator('[data-cloud="shared"]').count() == 1, "the first step (where Google and Microsoft are) has 'This is a shared computer' too")
    A.fill('[data-cloud="email"]', "owner@firm.in"); A.click('[data-act="cloudSignIn"]'); A.wait_for_timeout(300)
    ok(A.locator('[data-cloud="shared"]').count() == 1 and not A.is_checked('[data-cloud="shared"]'), "the sign-in form has 'This is a shared computer', not ticked")
    A.goto(URL); A.wait_for_timeout(2000)
    sign_in(A)
    ok(not signin_page(A) and A.evaluate("Cloud.on()") and A.evaluate("(k) => !!localStorage.getItem(k)", KEY), "signed in; kept in this browser (localStorage)")

    # 1. the access token ran out while the browser was closed
    expire(A); ST["refreshes"] = 0
    A.reload(); A.wait_for_timeout(3500)
    ok(not signin_page(A) and A.evaluate("Cloud.on()") and ST["refreshes"] >= 1 and notes(A).count() == 0,
       "opened with an expired token: refreshed on its own (%d), still signed in, no note" % ST["refreshes"])

    # 2. no internet when FinCom opens
    expire(A); ST["refreshes"] = 0
    ctx.route(FAKE + "/**", lambda r: r.abort("internetdisconnected"))
    A.reload(); A.wait_for_timeout(3500)
    ok(not signin_page(A) and A.evaluate("Cloud.on()") and notes(A).count() == 0 and not asks_sign_in(A),
       "no internet at opening: still signed in, nothing asks to sign in")
    ctx.unroute(FAKE + "/**")
    A.evaluate("() => window.dispatchEvent(new Event('online'))"); A.wait_for_timeout(2500)
    ok(ST["refreshes"] >= 1 and A.evaluate("Cloud.on()"), "the internet back: the token is refreshed on its own (%d)" % ST["refreshes"])
    ST["fail503"] = True; expire(A)
    r = A.evaluate("() => Cloud.refreshToken().then(() => 'ok', (e) => 'err')"); A.wait_for_timeout(500)
    ok(r == "err" and A.evaluate("Cloud.on()") and not signin_page(A) and notes(A).count() == 0, "a server error on the refresh (503) never signs out")
    ST["fail503"] = False
    for ans, what in [((500, {"code": 500, "error_code": "unexpected_failure", "msg": "Database error finding session"}), "a 500 'Database error finding session'"),
                      ((200, {"token_type": "bearer"}), "a 200 without an access token")]:
        ST["answer"] = ans; expire(A)
        r = A.evaluate("() => Cloud.refreshToken().then(() => 'ok', (e) => 'err')"); A.wait_for_timeout(400)
        ok(r == "err" and A.evaluate("Cloud.on()") and not signin_page(A), what + ": still signed in")
    ST["answer"] = None

    # 3. a laptop that slept: no timer ran; the window comes back
    A.evaluate("() => { window.__t0 = Date.now(); }")
    A.wait_for_timeout(1500); expire(A); ST["refreshes"] = 0
    A.evaluate("() => window.dispatchEvent(new Event('focus'))"); A.wait_for_timeout(1500)
    ok(ST["refreshes"] == 1 and A.evaluate("Cloud.on()"), "back to the window after a long sleep: the token is refreshed at once (%d)" % ST["refreshes"])

    # 4. revoked (a deliberate sign-out elsewhere, "Sign out of all devices"): the page is locked again, as before
    A.evaluate("() => navHome('tally')"); A.wait_for_timeout(1200)
    here = A.evaluate("location.hash")
    ST["revoked"] = True; ST["refused"] = 0; expire(A)
    A.evaluate("() => window.dispatchEvent(new Event('focus'))"); A.wait_for_timeout(2000)
    t = A.inner_text("#app")
    ok(signin_page(A) and not A.evaluate("Cloud.on()") and "Your sign-in ended:" in t, "revoked: locked behind the sign-in page, which says why")
    ok(ST["refused"] == 1, "one refused refresh, no retry storm (%d)" % ST["refused"])
    ok(A.evaluate("Route.pending") == here, "the open page is remembered (%s)" % A.evaluate("Route.pending"))
    sign_in(A); A.wait_for_timeout(1500)
    ok(not signin_page(A) and A.evaluate("Cloud.on()") and A.evaluate("location.hash") == here, "signed in again: back on the same page (%s)" % A.evaluate("location.hash"))
    said = []
    A.evaluate("() => doAct('useOffline')")
    for go in ["navHome('tally')", "navHome('integrations')", "navHome('help')", "navHome('today')"]:
        A.evaluate("() => { " + go + "; }"); A.wait_for_timeout(700)
        if asks_sign_in(A): said.append(go)
    ok(not said, "no screen says 'Sign in to the firm account' (%s)" % said)

    # 4b. a login FinCom switched off (banned): locked out, told so
    ST["answer"] = (400, {"code": 400, "error_code": "user_banned", "msg": "User is banned"}); expire(A)
    A.evaluate("() => window.dispatchEvent(new Event('focus'))"); A.wait_for_timeout(2000)
    ok(signin_page(A) and "switched off" in A.inner_text("#app"), "banned: the sign-in page says the account is switched off")
    ST["answer"] = None; sign_in(A)
    # 4c. without the firm account: no nav item for its cloud-only pages
    A.evaluate("() => signOutHere('Signed out.')"); A.wait_for_timeout(600); A.evaluate("() => doAct('useOffline')"); A.wait_for_timeout(600)
    A.evaluate("() => goSettings(null)"); A.wait_for_timeout(800)
    t = A.inner_text("#app")
    ok(A.locator('[data-side="Integrations"]').count() == 0 and "Books in the cloud" not in t and "GST API, all clients" not in t,
       "signed out: no Integrations, Books in the cloud or GST API all clients")
    A.evaluate("() => { S.tallyTab = 'activity'; navHome('tally'); }"); A.wait_for_timeout(800)
    ok(A.locator('[data-tally-tab="activity"]').count() == 0 and A.locator("#app [data-sync-activity]").count() == 0, "and no Sync activity")
    A.evaluate("() => { S.tallyTab = ''; Cloud.setCfg({gate: true}); render(); }"); A.wait_for_timeout(600); sign_in(A)

    # 5. a shared computer: not kept after the browser closes; one's own computer: kept
    kept = context(br, ctx.storage_state()); K = page(kept)
    ok(not signin_page(K) and K.evaluate("Cloud.on()"), "own computer: the browser closed and opened again, still signed in")
    kept.close()
    c2 = context(br); B = page(c2); sign_in(B, shared=True)
    st = B.evaluate("(k) => ({local: !!localStorage.getItem(k), tab: !!sessionStorage.getItem(k), on: Cloud.on()})", KEY)
    ok(st["on"] and st["tab"] and not st["local"], "shared computer: signed in for this tab only " + str(st))
    B.reload(); B.wait_for_timeout(2500)
    ok(not signin_page(B) and B.evaluate("Cloud.on()"), "a reload of the same tab stays signed in")
    c3 = context(br, c2.storage_state()); C = page(c3)
    ok(signin_page(C), "shared computer: the browser closed and opened again asks to sign in")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
page_srv.shutdown(); fake_srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
