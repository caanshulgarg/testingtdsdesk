"""python3 run_signup_ui.py - creating an account (signup v12, the owner's decision of 26-Oct-2026).
The firm account is stood in for by a small HTTP server (Supabase Auth, the signup function, PostgREST).
  1. the sign-in page is sign-in only; "New to FinCom? Create an account" opens the register page, its own address #/register
     (opened directly too); "Already have an account? Sign in" goes back (#/signin), and Back returns to the register page
  2. the register form (name, firm name, email, password) sends those to the signup function and shows one line:
     "Check your email and click the link to confirm, then sign in." Nothing else is asked for (no provision)
  3. the first sign-in of a confirmed person with no firm asks the signup function to set it up (provision, with the
     person's token), once, and then FinCom opens with that firm
  4. "Continue with Google / Microsoft": shown only for the providers switched on in Supabase Auth (/auth/v1/settings
     external.google / external.azure), on both pages; none, Google only, and both
  5. Google: the button goes to Supabase's /auth/v1/authorize (provider=google, back to this page, with a PKCE
     code_challenge); coming back with ?code= signs the person in and their first sign-in sets up their firm. An old-style
     confirmation link (#access_token=…&type=signup) no longer signs in: "Email confirmed — now sign in" (security review of
     26-Oct-2026, M1; the PKCE rules themselves: run_signin_pkce.py)
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_signup_ui.py"""
import os, json, time, base64, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = 8183, 9323
PAGE = "http://localhost:%d/" % PAGE_PORT
FAKE = "http://localhost:%d" % FAKE_PORT
CHECK = "Check your email and click the link to confirm, then sign in."
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE)).serve_forever, daemon=True).start()

def jwt(sub, email):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return b({"alg": "HS256", "typ": "JWT"}) + "." + b({"sub": sub, "email": email, "aal": "aal1", "role": "authenticated"}) + ".sig"

# ---------- the fake Supabase ----------
ST = {"ext": {"google": False, "azure": False}, "signups": [], "provisions": [], "firms": {}, "settings_calls": 0}
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
    def who(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        try: return json.loads(base64.urlsafe_b64decode(tok.split(".")[1] + "==")).get("sub")
        except Exception: return None
    def handle_any(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/auth/v1/settings": ST["settings_calls"] += 1; return self.out(200, {"external": dict(ST["ext"], email=True), "disable_signup": False})
        if p == "/functions/v1/signup":
            b = self.body()
            if b.get("action") == "provision":
                uid = self.who(); ST["provisions"].append(uid)
                if not uid: return self.out(401, {"ok": False, "reason": "signed_out"})
                created = uid not in ST["firms"]; ST["firms"].setdefault(uid, "F-" + uid)
                return self.out(200, {"ok": True, "created": created, "firm_id": ST["firms"][uid]})
            ST["signups"].append(b)
            return self.out(200, {"ok": True, "reason": "check_email", "message": CHECK})
        if p == "/auth/v1/token":
            b = self.body()
            if q.get("grant_type") == ["pkce"]:
                return self.out(200, {"access_token": jwt("u-g", "ravi@gmail.test"), "refresh_token": "RG", "expires_in": 3600, "user": {"id": "u-g", "email": "ravi@gmail.test"}})
            if q.get("grant_type") == ["password"]:
                return self.out(200, {"access_token": jwt("u-pw", b.get("email", "")), "refresh_token": "R1", "expires_in": 3600, "user": {"id": "u-pw", "email": b.get("email", "")}})
            return self.out(200, {"access_token": jwt("u-pw", "x@y.test"), "refresh_token": "R2", "expires_in": 3600})
        if p == "/auth/v1/user": return self.out(200, {"id": self.who(), "email": "", "factors": []})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if p.startswith("/rest/v1/"):
            uid = self.who()
            if p == "/rest/v1/members":
                f = ST["firms"].get(uid)
                return self.out(200, [{"user_id": uid, "firm_id": f, "name": "Owner", "email": "o@x.test", "role": "owner", "active": True}] if f else [])
            if p == "/rest/v1/rpc/mfa_status": return self.out(200, {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
            if p == "/rest/v1/rpc/my_account": return self.out(200, {"me": {"role": "owner", "email": "o@x.test", "name": "Owner"}, "firm": {"balance": 10000, "name": "Rao & Co"}, "people": [], "modules": [], "usage": []})
            if p.startswith("/rest/v1/rpc/"): return self.out(200, {})
            return self.out(200, [] if self.command == "GET" else {})
        return self.out(404, {"message": "not here"})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake).serve_forever, daemon=True).start()

fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def signin_page(pg): return pg.locator('[data-act="cloudSignIn"]').count() > 0
def register_page(pg): return pg.locator('[data-act="cloudSignUp"]').count() > 0 or pg.locator("[data-signup-sent]").count() > 0
def oauth(pg): return [n for n, a in (("google", "oauthGoogle"), ("azure", "oauthAzure")) if pg.locator('[data-act="%s"]' % a).count()]
# the layout (owner, 26-Oct-2026, as Claude's): the provider buttons at the top, full width with their logos, then a thin
# "or" line, then the email form, then the switch link last; with no provider, the form alone (no buttons, no "or")
LAYOUT_JS = """(first) => {
  const box = document.querySelector('.signin-box'), q = (s) => box.querySelector(s);
  const parts = [['google', q('[data-act="oauthGoogle"]')], ['azure', q('[data-act="oauthAzure"]')], ['or', q('[data-oauth-or]')],
    ['form', q('[data-cloud="' + first + '"]')], ['submit', q('[data-act="cloudSignIn"],[data-act="cloudSignUp"]')],
    ['switch', q('[data-act="showSignUp"],[data-act="showSignIn"]')]].filter(([, e]) => e);
  parts.sort((a, b) => a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const acts = [...box.querySelectorAll('[data-act]')], last = acts[acts.length - 1];
  const w = (e) => e ? Math.round(e.getBoundingClientRect().width) : 0, inp = q('[data-cloud="' + first + '"]');
  const or = q('[data-oauth-or]');
  return {order: parts.map(([k]) => k), lastAct: last && last.dataset.act,
    full: ['oauthGoogle', 'oauthAzure'].filter((a) => q('[data-act="' + a + '"]')).every((a) => Math.abs(w(q('[data-act="' + a + '"]')) - w(inp)) <= 2),
    logos: ['oauthGoogle', 'oauthAzure'].filter((a) => q('[data-act="' + a + '"]')).every((a) => q('[data-act="' + a + '"] svg')),
    orText: or ? or.textContent.trim() : null};
}"""
def layout(pg, first): return pg.evaluate(LAYOUT_JS, first)

with sync_playwright() as pw:
    br = pw.chromium.launch()
    def context():
        ctx = br.new_context(viewport={"width": 1300, "height": 900})
        # the test build is tied to the staging address: its requests are sent to the fake instead
        ctx.add_init_script("(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o); })()" % FAKE)
        return ctx
    def page(ctx, url=PAGE):
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(2500); return pg

    # 1-3: no providers switched on
    ctx = context(); A = page(ctx)
    t = A.inner_text("#app")
    ok(signin_page(A) and not register_page(A) and A.locator('[data-cloud="firm"]').count() == 0, "the sign-in page is sign-in only (no firm-name box)")
    ok("New to FinCom?" in t and A.locator('[data-act="showSignUp"]').count() == 1, "it links to the register page: New to FinCom? Create an account")
    ok(oauth(A) == [] and ST["settings_calls"] >= 1, "no provider switched on: no Google or Microsoft button (settings asked %d)" % ST["settings_calls"])
    L = layout(A, "email")
    ok(L["order"] == ["form", "submit", "switch"] and L["lastAct"] == "showSignUp", "no provider: the form stands alone (no 'or' line), the switch link last (%s)" % L)
    A.click('[data-act="showSignUp"]'); A.wait_for_timeout(500)
    ok(register_page(A) and not signin_page(A) and A.evaluate("location.hash") == "#/register", "Create an account opens the register page at #/register (%s)" % A.evaluate("location.hash"))
    ok([A.locator('[data-cloud="%s"]' % k).count() for k in ("name", "firm", "email", "password")] == [1, 1, 1, 1], "the form: your name, firm name, email, password")
    ok(oauth(A) == [], "and no provider buttons there either")
    L = layout(A, "name")
    ok(L["order"] == ["form", "submit", "switch"] and L["lastAct"] == "showSignIn", "register, no provider: the form alone, the switch link last (%s)" % L)
    A.click('[data-act="showSignIn"]'); A.wait_for_timeout(500)
    ok(signin_page(A) and A.evaluate("location.hash") == "#/signin", "Already have an account? Sign in: back to the sign-in page (#/signin)")
    A.go_back(); A.wait_for_timeout(600)
    ok(register_page(A), "Back returns to the register page")
    # a short password is caught on the page; nothing is sent
    A.fill('[data-cloud="name"]', "Asha Rao"); A.fill('[data-cloud="firm"]', "Rao & Co"); A.fill('[data-cloud="email"]', "asha@new.test"); A.fill('[data-cloud="password"]', "short")
    A.click('[data-act="cloudSignUp"]'); A.wait_for_timeout(400)
    ok(ST["signups"] == [] and "10 characters" in A.inner_text("#app"), "a short password: said on the page, nothing sent")
    A.fill('[data-cloud="password"]', "a-long-password-1")
    A.click('[data-act="cloudSignUp"]'); A.wait_for_timeout(1000)
    s = ST["signups"][-1] if ST["signups"] else {}
    ok(len(ST["signups"]) == 1 and [s.get(k) for k in ("name", "firm", "email", "password")] == ["Asha Rao", "Rao & Co", "asha@new.test", "a-long-password-1"] and s.get("redirect") == PAGE + "#confirmed" and len(s.get("challenge") or "") == 43,
       "the form goes to the signup function with name, firm, email, password, this page (#confirmed) as the link's way back and a PKCE challenge: " + json.dumps({k: v for k, v in s.items() if k != "password"}))
    ok(A.locator("[data-signup-sent]").count() == 1 and CHECK in A.inner_text("#app") and A.locator('[data-act="cloudSignUp"]').count() == 0, "then one line: " + CHECK)
    ok(ST["provisions"] == [] and not A.evaluate("Cloud.on()"), "nothing else: not signed in, no firm asked for")
    # 3. the first sign-in of the confirmed person: the firm is set up, once, and FinCom opens
    A.click('[data-act="showSignIn"]'); A.wait_for_timeout(400)
    A.fill('[data-cloud="email"]', "asha@new.test"); A.fill('[data-cloud="password"]', "a-long-password-1")
    A.click('[data-act="cloudSignIn"]'); A.wait_for_timeout(2500)
    ok(ST["provisions"] == ["u-pw"], "the first sign-in asks for the firm once, with the person's own token (%s)" % ST["provisions"])
    ok(not signin_page(A) and A.evaluate("Cloud.st.firm") == "F-u-pw" and A.evaluate("Cloud.st.state") == "ok", "and FinCom opens with that firm (%s)" % A.evaluate("Cloud.st.firm"))
    A.evaluate("() => { Cloud.st.firm = ''; return Cloud.whoAmI(); }"); A.wait_for_timeout(300)
    ok(ST["provisions"] == ["u-pw"], "a later look-up of the firm does not ask again (it has a member row)")
    # #/register opened directly
    B = page(context(), PAGE + "#/register")
    ok(register_page(B) and not signin_page(B), "#/register opened directly shows the register page")
    ctx.close()

    # 4. providers switched on: Google only, then both
    ST["ext"] = {"google": True, "azure": False}
    C = page(context())
    ok(oauth(C) == ["google"], "Google switched on: the sign-in page shows Continue with Google only (%s)" % oauth(C))
    ok(C.locator('[data-act="oauthGoogle"]').inner_text().strip() == "Continue with Google", "its words: Continue with Google")
    C.click('[data-act="showSignUp"]'); C.wait_for_timeout(500)
    ok(oauth(C) == ["google"], "and so does the register page")
    ST["ext"] = {"google": True, "azure": True}
    D = page(context())
    ok(oauth(D) == ["google", "azure"] and D.locator('[data-act="oauthAzure"]').inner_text().strip() == "Continue with Microsoft", "both switched on: Google and Microsoft on the sign-in page")
    WANT = ["google", "azure", "or", "form", "submit", "switch"]
    L = layout(D, "email")
    ok(L["order"] == WANT and L["lastAct"] == "showSignUp" and L["orText"] == "or", "sign-in: Google, Microsoft at the top, then 'or', then the form, the switch link last (%s)" % L)
    ok(L["full"] and L["logos"], "the provider buttons are full width, with their logos (%s)" % L)
    D.click('[data-act="showSignUp"]'); D.wait_for_timeout(500)
    ok(oauth(D) == ["google", "azure"], "and on the register page")
    L = layout(D, "name")
    ok(L["order"] == WANT and L["lastAct"] == "showSignIn" and L["full"] and L["logos"], "register: the same order, full width with logos, the switch link last (%s)" % L)

    # 5. Google there and back: Supabase's authorize sends the person back with a code (PKCE)
    asked = []
    ctx5 = context()
    def authorize(route):
        asked.append(route.request.url)
        back = parse_qs(urlparse(route.request.url).query).get("redirect_to", [PAGE])[0]
        route.fulfill(status=302, headers={"Location": back + "?code=G1"})
    ctx5.route("https://*.supabase.co/auth/v1/authorize*", authorize)
    E = page(ctx5)
    E.click('[data-act="oauthGoogle"]'); E.wait_for_timeout(3500)
    q = parse_qs(urlparse(asked[0]).query) if asked else {}
    ok(q.get("provider") == ["google"] and q.get("redirect_to") == [PAGE] and q.get("code_challenge_method") == ["s256"], "Continue with Google goes to Supabase's authorize: provider=google, back to this page, PKCE (%s)" % (asked[:1]))
    ok("code=" not in E.evaluate("location.href"), "back on the page, the code is taken out of the address")
    ok(E.evaluate("Cloud.on()") and E.evaluate("Cloud.sess().user_id") == "u-g" and E.evaluate("Cloud.sess().email") == "ravi@gmail.test", "the person is signed in as their Google login")
    ok(ST["provisions"][-1:] == ["u-g"] and ST["provisions"].count("u-g") == 1 and not signin_page(E) and E.evaluate("Cloud.st.firm") == "F-u-g", "their first sign-in sets up their firm, once, and FinCom opens (%s)" % ST["provisions"])
    # Microsoft asks Supabase for the email scope
    asked.clear()
    F = page(ctx5); F.evaluate("() => signOutHere('Signed out.')"); F.wait_for_timeout(500)
    F.click('[data-act="oauthAzure"]'); F.wait_for_timeout(1500)
    q = parse_qs(urlparse(asked[0]).query) if asked else {}
    ok(q.get("provider") == ["azure"] and q.get("scopes") == ["email"], "Continue with Microsoft: provider=azure with the email scope (%s)" % q)
    # an old-style confirmation link (the session in the address): the email is confirmed, nobody is signed in by it
    G = page(context(), PAGE + "#access_token=" + jwt("u-link", "new@link.test") + "&expires_in=3600&refresh_token=RL&token_type=bearer&type=signup")
    ok(not G.evaluate("Cloud.on()") and signin_page(G) and "Email confirmed \u2014 now sign in" in G.inner_text("#app") and ST["provisions"].count("u-link") == 0 and G.locator("#spw1").count() == 0,
       "an old-style confirmation link (#access_token=…&type=signup): not signed in, \u201cEmail confirmed \u2014 now sign in\u201d, no firm")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
