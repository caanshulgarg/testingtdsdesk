"""python3 run_signin_trips.py - next-speed-2 (the speed plan of 22-Nov-2026, #15): signing in asks the cloud fewer times one
after another. A stand-in for Supabase (as run_signin_session.py), every answer TRIPS_WAIT seconds late (default 0.3).
  1. signed in with the password, no two-step: the firm's members only after the two-step check (mfa_status) has
     answered; mfa_status once (it was asked again by the sync started right after); my_account once (the
     sign-in's and the sync's, which were two side by side); the time to the firm shown printed, before and after;
  2. with two-step on: the code is asked for, and nothing of the firm is asked, kept or shown
     before it (no members request, no account).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_signin_trips.py"""
import os, sys, json, time, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = int(os.environ.get("TRIPS_PORT", "8187")), int(os.environ.get("TRIPS_FAKE", "9327"))
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
        t0 = time.time(); time.sleep(WAIT)
        ST["calls"].append((self.command, self.path, t0, time.time()))
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
        if p == "/auth/v1/user": return self.out(200, {"id": "u1", "email": "owner@firm.in", "factors": [{"id": "fa1", "factor_type": "totp", "status": "verified"}] if ST.get("mfa") else []})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if p.startswith("/rest/v1/"):
            if bearer != ST["access"] or ST["dead"]: return self.out(401, {"message": "JWT expired"})
            if p == "/rest/v1/members": return self.out(200, [{"user_id": "u1", "firm_id": "F1", "name": "Owner", "email": "owner@firm.in", "role": ST["role"], "active": True}])
            if p == "/rest/v1/rpc/mfa_status": return self.out(200, {"required": True, "enrolled": True, "admin": False, "aal": "aal1", "ok": False} if ST.get("mfa") else {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
            if p == "/rest/v1/rpc/my_account": return self.out(200, {"me": {"role": ST["role"], "email": "owner@firm.in", "name": "Owner"}, "firm": {"balance": 100, "name": "Fake Firm"}, "people": [], "modules": [], "usage": []})
            if p == "/rest/v1/activity" and self.command == "POST": ST["activity"].append(self.body()); return self.out(201)
            if p.startswith("/rest/v1/rpc/"): return self.out(200, {})
            return self.out(200, [])
        return self.out(404, {"message": "not here"})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake).serve_forever, daemon=True).start()

WAIT = float(os.environ.get("TRIPS_WAIT", "0.3"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def sign_in(pg):
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.click('[data-act="cloudSignIn"]'); pg.fill('[data-cloud="password"]', "pw12345678")
    pg.click('[data-act="cloudSignIn"]')
calls = lambda name: [c for c in ST["calls"] if c[0] != "OPTIONS" and c[1].split("?")[0] == name]
with sync_playwright() as p:
    br = p.chromium.launch()
    for mfa in (False, True):
        ST["mfa"] = mfa; ST["calls"] = []
        ctx = br.new_context(viewport={"width": 1400, "height": 900})
        ctx.add_init_script("(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o); })()" % FAKE)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        pg.goto("http://localhost:%d/" % PAGE_PORT); pg.wait_for_selector('[data-act="cloudSignIn"]', timeout=60000); pg.wait_for_timeout(1000)
        ST["calls"] = []
        t0 = time.time(); sign_in(pg)
        if not mfa:
            print("== 1. signed in, no two-step (each answer %.1f s late)" % WAIT)
            pg.wait_for_function("() => typeof Cloud === 'object' && Cloud.st.state === 'ok' && !!S.account", timeout=60000)
            print("  info firm and account in: %d ms" % ((time.time() - t0) * 1000))
            pg.wait_for_timeout(4000)
            m, w = calls("/rest/v1/rpc/mfa_status"), calls("/rest/v1/members")
            ok(len(m) == 1, "1. the two-step check asked once (%d)" % len(m))
            ok(len(calls("/rest/v1/rpc/my_account")) == 1, "1. my_account asked once (%d)" % len(calls("/rest/v1/rpc/my_account")))
            ok(bool(m and w) and w[0][2] >= m[0][3], "1. the members asked only after the two-step check answered")
        else:
            print("== 2. two-step on")
            pg.wait_for_timeout(5000)
            st = pg.evaluate("() => ({mfa: Cloud.st.mfa && Cloud.st.mfa.need, firm: Cloud.st.firm, members: (Cloud.st.members || []).length, account: !!S.account})")
            ok(st["mfa"] == "code", "2. the code is asked for (%s)" % st)
            ok(not st["firm"] and not st["members"] and not st["account"], "2. nothing of the firm kept before the code (%s)" % st)
            ok(not calls("/rest/v1/rpc/my_account"), "2. the account not asked before the code")
            ok(not calls("/rest/v1/members"), "2. the firm's members not asked before the code (%d)" % len(calls("/rest/v1/members")))
        ctx.close()
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
