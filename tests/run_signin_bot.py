"""python3 run_signin_bot.py - the bot check on the sign-in and register forms (Cloudflare Turnstile, 26-Oct-2026; the owner:
"Security of sign in and sign up page should be better").
Two builds of the testing site: one with a Turnstile site key (TDSDESK_SITE_BOT, default ../app/dist-test-bot, built with
FINCOM_TURNSTILE_SITE_KEY=1x00000000000000000000AA) and the usual one without (TDSDESK_SITE, ../app/dist-test). Cloudflare's
script is stood in for (it calls back with a token); the firm account by a small HTTP server.
  1. with a key: the sign-in page loads Cloudflare's script, draws the check in its "interaction-only" look (nothing shown
     unless Cloudflare asks), the page's CSP lets challenges.cloudflare.com in (script and frame); Sign in sends the token
     to the signin function; each try sends a fresh one; the register form has its own and sends it to the signup function;
     with no signin function (the old way, straight at Auth) the token goes as gotrue_meta_security.captcha_token
  2. without a key (today's build): no check drawn, nothing asked of Cloudflare, no Cloudflare in the CSP, no bot file in
     the build, and what the forms send is exactly as before (no token field)"""
import os, json, glob, base64, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SITE_BOT = os.environ.get("TDSDESK_SITE_BOT", os.path.join(HERE, "..", "app", "dist-test-bot"))
PORT_BOT, PORT_PLAIN, FAKE_PORT = 8211, 8212, 9331
FAKE = "http://localhost:%d" % FAKE_PORT
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
for port, site in ((PORT_BOT, SITE_BOT), (PORT_PLAIN, SITE)):
    threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Pages, directory=site)).serve_forever, daemon=True).start()

def jwt(sub, email):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return b({"alg": "HS256", "typ": "JWT"}) + "." + b({"sub": sub, "email": email, "aal": "aal1", "role": "authenticated"}) + ".sig"
ST = {"signin": [], "signup": [], "token": [], "signin_404": False}
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, code, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-client-info, accept")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data: self.wfile.write(data)
    def do_OPTIONS(self): self.out(204)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try: return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception: return {}
    def handle_any(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path
        if p == "/functions/v1/signin":
            if ST["signin_404"]: return self.out(404, {"code": "NOT_FOUND", "message": "Requested function was not found"})
            b = self.body(); ST["signin"].append(b)
            if b.get("password") != "right-password-1": return self.out(400, {"ok": False, "error": "Wrong email or password."})
            return self.out(200, {"access_token": jwt("u1", b.get("email", "")), "refresh_token": "R", "expires_in": 3600, "user": {"id": "u1", "email": b.get("email", "")}})
        if p == "/functions/v1/signup":
            ST["signup"].append(self.body()); return self.out(200, {"ok": True, "reason": "check_email", "message": "Check your email and click the link to confirm, then sign in."})
        if p == "/auth/v1/token":
            b = self.body(); ST["token"].append(b)
            return self.out(400, {"error_code": "invalid_credentials", "msg": "Invalid login credentials"})
        if p == "/auth/v1/settings": return self.out(200, {"external": {"email": True}})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if p.startswith("/rest/v1/"): return self.out(200, {} if "rpc/" in p else [])
        return self.out(404, {})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake).serve_forever, daemon=True).start()

# Cloudflare's script, stood in for: draws a marker and calls back with a fresh token (as Turnstile does after its check)
TURNSTILE_JS = """window.turnstile = { n: 0, o: {}, issued: 0,
  give(id) { const o = this.o[id]; setTimeout(() => o.callback('TS-' + id + '-' + (++this.issued)), 120); },
  render(el, o) { const id = ++this.n; this.o[id] = o; el.setAttribute('data-ts', [o.sitekey, o.action, o.appearance].join('|')); this.give(id); return id; },
  reset(id) { if (this.o[id]) this.give(id); }, remove(id) { delete this.o[id]; } };"""
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
KEY = "1x00000000000000000000AA"

with sync_playwright() as pw:
    br = pw.chromium.launch()
    cf = []
    def context():
        ctx = br.new_context(viewport={"width": 1300, "height": 900})
        ctx.add_init_script("(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o); })()" % FAKE)
        ctx.route("https://challenges.cloudflare.com/**", lambda r: (cf.append(r.request.url), r.fulfill(status=200, content_type="text/javascript", body=TURNSTILE_JS)))
        return ctx
    def page(ctx, url):
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(2500); return pg
    CSP = "() => (document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]') || {}).content || ''"
    def directive(csp, name): return next((d.strip() for d in csp.split(";") if d.strip().startswith(name + " ")), "")

    print("1. a build with a site key")
    ok(os.path.exists(os.path.join(SITE_BOT, "index.html")), "the build with a key is there (%s)" % SITE_BOT)
    A = page(context(), "http://localhost:%d/" % PORT_BOT)
    ok(any("challenges.cloudflare.com/turnstile/v0/api.js" in u and "render=explicit" in u for u in cf), "the sign-in page loads Cloudflare's script (%s)" % cf[:1])
    ok(A.locator('[data-bot-check="login"]').get_attribute("data-ts") == KEY + "|login|interaction-only", "the check is drawn on the sign-in form with the site key, interaction-only (%s)" % A.locator('[data-bot-check="login"]').get_attribute("data-ts"))
    csp = A.evaluate(CSP)
    ok("https://challenges.cloudflare.com" in directive(csp, "script-src") and "https://challenges.cloudflare.com" in directive(csp, "frame-src"), "the CSP lets challenges.cloudflare.com in for script and frame")
    A.fill('[data-cloud="email"]', "a@b.in"); A.fill('[data-cloud="password"]', "wrong"); A.click('[data-act="cloudSignIn"]'); A.wait_for_timeout(1200)
    A.fill('[data-cloud="password"]', "wrong-again"); A.click('[data-act="cloudSignIn"]'); A.wait_for_timeout(1200)
    toks = [b.get("captcha_token") for b in ST["signin"]]
    ok(len(toks) == 2 and all(t and t.startswith("TS-") for t in toks) and toks[0] != toks[1], "Sign in sends the token to the signin function, a fresh one each try (%s)" % toks)
    A.fill('[data-cloud="password"]', "right-password-1"); A.click('[data-act="cloudSignIn"]'); A.wait_for_timeout(2000)
    ok(A.evaluate("Cloud.on()") and (ST["signin"][-1].get("captcha_token") or "").startswith("TS-"), "and with the right password the person is signed in")
    B = page(context(), "http://localhost:%d/#/register" % PORT_BOT)
    ok(B.locator('[data-bot-check="signup"]').get_attribute("data-ts") == KEY + "|signup|interaction-only", "the register form has its own check")
    B.fill('[data-cloud="name"]', "Asha Rao"); B.fill('[data-cloud="firm"]', "Rao & Co"); B.fill('[data-cloud="email"]', "asha@new.test"); B.fill('[data-cloud="password"]', "a-long-password-1")
    B.click('[data-act="cloudSignUp"]'); B.wait_for_timeout(1500)
    ok(ST["signup"] and (ST["signup"][-1].get("captcha_token") or "").startswith("TS-") and B.locator("[data-signup-sent]").count() == 1, "Create the account sends the token to the signup function (%s)" % (ST["signup"][-1:] and ST["signup"][-1].get("captcha_token")))
    ST["signin_404"] = True
    C = page(context(), "http://localhost:%d/" % PORT_BOT)
    C.fill('[data-cloud="email"]', "a@b.in"); C.fill('[data-cloud="password"]', "wrong"); C.click('[data-act="cloudSignIn"]'); C.wait_for_timeout(1500)
    t = ST["token"][-1] if ST["token"] else {}
    ok(((t.get("gotrue_meta_security") or {}).get("captcha_token") or "").startswith("TS-"), "no signin function (straight at Auth): the token goes as gotrue_meta_security.captcha_token (%s)" % t.get("gotrue_meta_security"))
    ST["signin_404"] = False

    print("2. a build without a key (as today)")
    cf.clear(); n_in, n_up, n_tok = len(ST["signin"]), len(ST["signup"]), len(ST["token"])
    D = page(context(), "http://localhost:%d/" % PORT_PLAIN)
    ok(D.locator("[data-bot-check]").count() == 0 and cf == [], "no check drawn, nothing asked of Cloudflare")
    ok("cloudflare" not in D.evaluate(CSP), "no Cloudflare in the CSP")
    ok(not glob.glob(os.path.join(SITE, "assets", "bot-*.js")), "no bot-check file in the build")
    D.fill('[data-cloud="email"]', "a@b.in"); D.fill('[data-cloud="password"]', "wrong"); D.click('[data-act="cloudSignIn"]'); D.wait_for_timeout(1200)
    ok(len(ST["signin"]) == n_in + 1 and sorted(ST["signin"][-1].keys()) == ["email", "password"], "Sign in sends email and password only, as before (%s)" % sorted(ST["signin"][-1].keys()))
    E = page(context(), "http://localhost:%d/#/register" % PORT_PLAIN)
    ok(E.locator("[data-bot-check]").count() == 0, "the register form: no check either")
    E.fill('[data-cloud="name"]', "Asha Rao"); E.fill('[data-cloud="firm"]', "Rao & Co"); E.fill('[data-cloud="email"]', "asha2@new.test"); E.fill('[data-cloud="password"]', "a-long-password-1")
    E.click('[data-act="cloudSignUp"]'); E.wait_for_timeout(1500)
    ok(len(ST["signup"]) == n_up + 1 and "captcha_token" not in ST["signup"][-1], "Create the account sends no token field (%s)" % sorted(ST["signup"][-1].keys()))
    ST["signin_404"] = True
    F = page(context(), "http://localhost:%d/" % PORT_PLAIN)
    F.fill('[data-cloud="email"]', "a@b.in"); F.fill('[data-cloud="password"]', "wrong"); F.click('[data-act="cloudSignIn"]'); F.wait_for_timeout(1500)
    ok(len(ST["token"]) == n_tok + 1 and sorted(ST["token"][-1].keys()) == ["email", "password"], "straight at Auth: email and password only, as before (%s)" % sorted(ST["token"][-1].keys()))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
