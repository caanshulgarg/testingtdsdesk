"""python3 run_signin_pkce.py - sign-in links only sign in the browser that started them (security review of 26-Oct-2026,
M1 "Forged sign-in link": a link carrying someone's tokens signed the victim into the attacker's account).
The firm account is stood in for by a small HTTP server that keeps Supabase Auth's PKCE rules (the code_challenge given to
/authorize or to the sign-up, the code it hands back, and /token?grant_type=pkce that wants the matching code_verifier).
  1. Continue with Google: /authorize gets a code_challenge (s256); back with ?code= the browser trades it with its own
     verifier, the person is signed in, their firm set up once, and the code is taken out of the address
  2. a made-up #access_token= link (no type, magiclink, signup) signs nobody in: "This sign-in link was not started on this
     browser" (a signup one: "Email confirmed — now sign in"), nothing stored, the address cleaned
  3. a ?code= this browser did not start (no verifier here, or someone else's code while this browser waits for Google):
     refused with the same words, nothing stored
  4. the email's confirmation link: the register form sends a code_challenge and asks to come back to #confirmed; the link
     opened in this browser (a new tab) signs in; opened in another browser it says "Email confirmed — now sign in"
  5. an invite or reset link (#access_token=…&type=invite|recovery) still opens "choose your password", says whose login it
     is, keeps nothing until the password is saved (a reload is signed out), then signs in with that password set
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_signin_pkce.py"""
import os, json, base64, hashlib, threading, functools, http.server, secrets
from urllib.parse import urlparse, parse_qs, quote
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = 8189, 9329
PAGE = "http://localhost:%d/" % PAGE_PORT
FAKE = "http://localhost:%d" % FAKE_PORT
NOT_HERE = "This sign-in link was not started on this browser"
CONFIRMED = "Email confirmed — now sign in"
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE)).serve_forever, daemon=True).start()

def jwt(sub, email):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return b({"alg": "HS256", "typ": "JWT"}) + "." + b({"sub": sub, "email": email, "aal": "aal1", "role": "authenticated"}) + ".sig"
def s256(v): return base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip("=")

# ---------- the fake Supabase, with Auth's PKCE rules ----------
# FLOWS: auth code -> {challenge, sub, email}; issued by /authorize (Google) or by the sign-up's confirmation link
ST = {"flows": {}, "exchanges": [], "signups": [], "provisions": [], "firms": {}, "pw_set": []}
def new_flow(challenge, sub, email):
    code = secrets.token_hex(8); ST["flows"][code] = {"challenge": challenge, "sub": sub, "email": email}; return code
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
    def tok(self): return (self.headers.get("Authorization") or "").replace("Bearer ", "")
    def who(self):
        try: return json.loads(base64.urlsafe_b64decode(self.tok().split(".")[1] + "==")).get("sub")
        except Exception: return None
    def handle_any(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/auth/v1/settings": return self.out(200, {"external": {"google": True, "azure": False, "email": True}, "disable_signup": False})
        if p == "/functions/v1/signup":
            b = self.body()
            if b.get("action") == "provision":
                uid = self.who(); ST["provisions"].append(uid)
                if not uid: return self.out(401, {"ok": False, "reason": "signed_out"})
                created = uid not in ST["firms"]; ST["firms"].setdefault(uid, "F-" + uid)
                return self.out(200, {"ok": True, "created": created, "firm_id": ST["firms"][uid]})
            ST["signups"].append(b)
            return self.out(200, {"ok": True, "reason": "check_email", "message": "Check your email and click the link to confirm, then sign in."})
        if p == "/auth/v1/token":
            b = self.body()
            if q.get("grant_type") == ["pkce"]:
                ST["exchanges"].append(b)
                f = ST["flows"].get(b.get("auth_code") or "")
                if not f: return self.out(404, {"code": 404, "error_code": "flow_state_not_found", "msg": "invalid flow state, no valid flow state found"})
                if s256(b.get("code_verifier") or "") != f["challenge"]: return self.out(400, {"code": 400, "error_code": "bad_code_verifier", "msg": "code challenge does not match previously saved code verifier"})
                del ST["flows"][b["auth_code"]]
                return self.out(200, {"access_token": jwt(f["sub"], f["email"]), "refresh_token": "R-" + f["sub"], "expires_in": 3600, "token_type": "bearer", "user": {"id": f["sub"], "email": f["email"]}})
            if q.get("grant_type") == ["password"]:
                return self.out(200, {"access_token": jwt("u-pw", b.get("email", "")), "refresh_token": "R1", "expires_in": 3600, "user": {"id": "u-pw", "email": b.get("email", "")}})
            return self.out(200, {"access_token": self.tok() or jwt("u-x", "x@y.test"), "refresh_token": "R2", "expires_in": 3600})
        if p == "/auth/v1/user":
            if self.command == "PUT":
                b = self.body(); ST["pw_set"].append({"sub": self.who(), "password": b.get("password")})
                try: email = json.loads(base64.urlsafe_b64decode(self.tok().split(".")[1] + "==")).get("email", "")
                except Exception: email = ""
                return self.out(200, {"id": self.who(), "email": email})
            return self.out(200, {"id": self.who(), "email": "", "factors": []})
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
# what this browser keeps of a sign-in: the session in either storage (both builds' key prefixes)
STORED = """() => { const ks = []; for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) ks.push(s.key(i));
  return ks.filter(k => /cloudsess$/.test(k)).map(k => (localStorage.getItem(k) || sessionStorage.getItem(k) || '').slice(0, 40)); }"""
def stored(pg): return pg.evaluate(STORED)
def shown(pg): return pg.inner_text("#app")
def opened(pg):
    # signed in: wait (up to 10 s) for the firm to be known, as an office computer may take a while
    try: pg.wait_for_function("() => Cloud.st.firm && !document.querySelector('[data-act=\"cloudSignIn\"]')", timeout=10000)
    except Exception: pass

with sync_playwright() as pw:
    br = pw.chromium.launch()
    asked = []
    def authorize(route):
        # Supabase's /authorize: remembers the challenge, signs in at "Google", and sends the browser back with ?code=
        u = route.request.url; asked.append(u); q = parse_qs(urlparse(u).query)
        back = q.get("redirect_to", [PAGE])[0]
        if q.get("code_challenge") and q.get("code_challenge_method", [""])[0].lower() == "s256":
            code = new_flow(q["code_challenge"][0], "u-g", "ravi@gmail.test")
            route.fulfill(status=302, headers={"Location": back + ("&" if "?" in back else "?") + "code=" + code})
        else:   # the old implicit flow: the tokens in the address
            route.fulfill(status=302, headers={"Location": back + "#access_token=" + jwt("u-g", "ravi@gmail.test") + "&expires_in=3600&refresh_token=RG&token_type=bearer"})
    def context():
        ctx = br.new_context(viewport={"width": 1300, "height": 900})
        # the test build is tied to the staging address: its requests are sent to the fake instead
        ctx.add_init_script("(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o); })()" % FAKE)
        ctx.route("https://*.supabase.co/auth/v1/authorize*", authorize)
        return ctx
    def page(ctx, url=PAGE, wait=2500):
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(wait); return pg

    print("1. Continue with Google, through PKCE")
    A = page(context())
    A.click('[data-act="oauthGoogle"]'); A.wait_for_timeout(1500); opened(A)
    q = parse_qs(urlparse(asked[0]).query) if asked else {}
    ok(q.get("provider") == ["google"] and q.get("redirect_to") == [PAGE], "the button goes to Supabase's authorize: provider=google, back to this page (%s)" % asked[:1])
    ok(len(q.get("code_challenge", [""])[0]) >= 43 and q.get("code_challenge_method") == ["s256"], "with a code_challenge (s256) made in this browser (%s)" % q.get("code_challenge_method"))
    ex = ST["exchanges"][-1:]
    ok(len(ST["exchanges"]) == 1 and ex and len(ex[0].get("code_verifier") or "") >= 43, "back with ?code=, the browser trades it at /token?grant_type=pkce with its own verifier")
    ok("code=" not in A.evaluate("location.search") and "access_token" not in A.evaluate("location.href"), "the code is taken out of the address (%s)" % A.evaluate("location.href"))
    ok(A.evaluate("Cloud.on()") and A.evaluate("Cloud.sess().user_id") == "u-g" and A.evaluate("Cloud.sess().email") == "ravi@gmail.test", "the person is signed in as their Google login")
    ok(ST["provisions"].count("u-g") == 1 and not signin_page(A) and A.evaluate("Cloud.st.firm") == "F-u-g", "their first sign-in sets up their firm, once, and FinCom opens (%s)" % ST["provisions"])
    ok(A.evaluate("() => Object.keys(sessionStorage).filter(k => /pkce/.test(k)).length") == 0, "the verifier is not kept after the round trip")

    print("2. a made-up #access_token= link signs nobody in")
    for kind, extra, words in (("no type (as Google's way back was)", "", NOT_HERE), ("type=magiclink", "&type=magiclink", NOT_HERE), ("type=signup", "&type=signup", CONFIRMED)):
        n0 = len(ST["provisions"])
        B = page(context(), PAGE + "#access_token=" + jwt("u-attacker", "attacker@evil.test") + "&expires_in=3600&refresh_token=RA&token_type=bearer" + extra)
        ok(not B.evaluate("Cloud.on()") and stored(B) == [] and signin_page(B), kind + ": not signed in, nothing stored, the sign-in page shown (%s)" % stored(B))
        ok(words in shown(B), kind + ": it says “" + words + "”")
        ok("access_token" not in B.evaluate("location.href"), kind + ": the tokens are taken out of the address")
        ok(len(ST["provisions"]) == n0, kind + ": no firm asked for")
        B.reload(); B.wait_for_timeout(2000)
        ok(not B.evaluate("Cloud.on()"), kind + ": and still signed out after a reload")
        B.context.close()

    print("3. a ?code= this browser did not start")
    code = new_flow(s256("the-attacker's-own-verifier-" + "x" * 30), "u-attacker", "attacker@evil.test")
    n0 = len(ST["exchanges"])
    C = page(context(), PAGE + "?code=" + code)
    ok(not C.evaluate("Cloud.on()") and stored(C) == [] and NOT_HERE in shown(C), "no verifier in this browser: refused (“%s”), nothing stored" % NOT_HERE)
    ok(len(ST["exchanges"]) == n0 and "code=" not in C.evaluate("location.search"), "the code is not even tried, and is taken out of the address")
    C.context.close()
    # this browser started Google, and a link with someone else's code arrives instead of the real way back
    ctx = context(); D = page(ctx)
    D.route("https://*.supabase.co/auth/v1/authorize*", lambda r: r.fulfill(status=302, headers={"Location": PAGE + "?code=" + new_flow(s256("someone-else-" + "y" * 40), "u-attacker", "attacker@evil.test")}))
    D.click('[data-act="oauthGoogle"]'); D.wait_for_timeout(3500)
    ok(not D.evaluate("Cloud.on()") and stored(D) == [] and NOT_HERE in shown(D), "someone else's code while this browser waits for Google: Auth refuses the verifier, nothing stored")
    ctx.close()

    print("4. the email's confirmation link")
    ctx = context(); E = page(ctx)
    E.click('[data-act="showSignUp"]'); E.wait_for_timeout(500)
    E.fill('[data-cloud="email"]', "asha@new.test"); E.click('[data-act="cloudSignUp"]'); E.fill('[data-cloud="name"]', "Asha Rao"); E.fill('[data-cloud="firm"]', "Rao & Co"); E.fill('[data-cloud="password"]', "a-long-password-1")
    E.click('[data-act="cloudSignUp"]'); E.wait_for_timeout(1500)
    s = ST["signups"][-1] if ST["signups"] else {}
    ok(len(s.get("challenge") or "") == 43 and s.get("redirect") == PAGE + "#confirmed", "the register form sends a code_challenge and asks to come back to this page's #confirmed (%s)" % {k: v for k, v in s.items() if k != "password"})
    ok(E.locator("[data-signup-sent]").count() == 1 and not E.evaluate("Cloud.on()"), "and says: check your email (not signed in)")
    # Supabase's /verify then sends the browser to redirect?code=… (the flow made with the form's challenge)
    link = PAGE + "?code=" + new_flow(s.get("challenge") or "-", "u-asha", "asha@new.test") + "#confirmed"
    other = page(context(), link)
    ok(not other.evaluate("Cloud.on()") and stored(other) == [] and CONFIRMED in shown(other) and NOT_HERE not in shown(other), "opened in another browser (a phone's email app): “%s”, not signed in" % CONFIRMED)
    ok("code=" not in other.evaluate("location.href") and "confirmed" not in other.evaluate("location.hash"), "and the address is cleaned (%s)" % other.evaluate("location.href"))
    other.context.close()
    link = PAGE + "?code=" + new_flow(s.get("challenge") or "-", "u-asha", "asha@new.test") + "#confirmed"
    F = page(ctx, link, 1500); opened(F)      # a new tab of the browser that registered
    ok(F.evaluate("Cloud.on()") and F.evaluate("Cloud.sess().user_id") == "u-asha" and F.evaluate("Cloud.sess().email") == "asha@new.test", "opened in the browser that registered (a new tab): signed in as that person")
    # (the register tab, still open, sees the sign-in too and may ask as well: the signup function makes one firm however often asked)
    ok(not signin_page(F) and "u-asha" in ST["provisions"] and F.evaluate("Cloud.st.firm") == "F-u-asha" and F.locator("#spw1").count() == 0, "their firm set up, FinCom opens, no 'choose your password' (%s)" % ST["provisions"])
    ok("code=" not in F.evaluate("location.href") and "confirmed" not in F.evaluate("location.hash"), "the address is cleaned")
    ctx.close()

    print("5. invite and reset links still set the password")
    tok = jwt("u-inv", "bina@firm.test")
    G = page(context(), PAGE + "#access_token=" + tok + "&expires_in=3600&refresh_token=RI&token_type=bearer&type=invite")
    ok("Welcome to FinCom" in shown(G) and G.locator("#spw1").count() == 1 and G.evaluate("location.hash") == "", "an invite link opens “choose your password” and is taken off the address")
    ok("bina@firm.test" in shown(G), "it says whose login the password is for (bina@firm.test)")
    ok(stored(G) == [] and not G.evaluate("Cloud.on()"), "nothing is kept before the password is saved")
    G.fill("#spw1", "short"); G.fill("#spw2", "short"); G.click('[data-act="setPasswordGo"]'); G.wait_for_timeout(300)
    ok("10 characters or more" in shown(G) and ST["pw_set"] == [], "a short password is refused, nothing sent")
    G.fill("#spw1", "a-good-password-7"); G.fill("#spw2", "a-good-password-7"); G.click('[data-act="setPasswordGo"]'); G.wait_for_timeout(2500)
    ok(ST["pw_set"][-1:] == [{"sub": "u-inv", "password": "a-good-password-7"}], "the password is set with the link's own sign-in (%s)" % ST["pw_set"])
    ok(G.evaluate("Cloud.on()") and G.evaluate("Cloud.sess().user_id") == "u-inv" and G.evaluate("Cloud.sess().email") == "bina@firm.test" and G.locator("#spw1").count() == 0, "then the person is signed in")
    G.context.close()
    H = page(context(), PAGE + "#access_token=" + jwt("u-rec", "ravi@firm.test") + "&expires_in=3600&refresh_token=RR&token_type=bearer&type=recovery")
    ok("Choose a new password" in shown(H) and "ravi@firm.test" in shown(H), "a reset link: “Choose a new password”, for ravi@firm.test")
    H.reload(); H.wait_for_timeout(2000)
    ok(not H.evaluate("Cloud.on()") and stored(H) == [] and signin_page(H), "left without saving (a reload): signed out, nothing kept")
    H.context.close()

    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
