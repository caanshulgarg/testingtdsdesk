"""python3 run_coupon_box_ui.py - the user app's "Have a coupon?" (migration 120's coupon_redeem; branch next-console-coupons).
The firm account is stood in for by a small HTTP server (Supabase Auth, the signup function, PostgREST) whose
rpc/coupon_redeem runs the REAL function on a throwaway PostgreSQL (pg_stand, port 31121, migration 118 and 120 run, the
made-up firms of coupons_pg_fixture.py, billing's console_credit_post stubbed), as the signed-in person.
  1. the register form: "Have a coupon?" is a link on the details step only; its box is its own file, fetched only when
     the link is pressed; the code goes with the form and is kept on this computer once the account is made
  2. the first sign-in (the firm is made): the code is redeemed once, with source 'signup'; the toast says what the firm
     got; the redemption is in the database (the credit through console_credit_post); the kept code is gone
  3. Settings, Plan and credit: the box for the firm's owner; an empty code, a wrong code, a used one: plain words; a good
     code applied; staff see no box
  4. budgets: the app's first file within 260 KB gzip and legacy.js within 600 (tests/run_stability.py's), the box in
     its own small file; phone 390 wide: no sideways scroll; dark mode; screenshots in SHOTS (default
     scratchpad/console-coupons-shots)
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_coupon_box_ui.py"""
import os, sys, json, glob, gzip, base64, threading, functools, http.server
from urllib.parse import urlparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import pg_stand, coupons_pg_fixture as fx
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("SHOTS") or os.path.join(HERE, "..", "..", "console-coupons-shots")
PAGE_PORT, FAKE_PORT = 8193, 9333
PAGE = "http://localhost:%d/" % PAGE_PORT
FAKE = "http://localhost:%d" % FAKE_PORT
NEW = fx.U(31)                      # the new login; its firm is made at the first sign-in
NEWFIRM = fx.U(131)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)

db = pg_stand.start(int(os.environ.get("PG121_PORT") or 31121))
fx.setup(db, run120=True, stub=True)
db.sql("insert into auth.users (id, email) values ('%s', 'neha@new.test')" % NEW)
# the codes the test uses (made as the console would: console_coupon_save, as Owner)
for d in ({"code": "ICAI1000", "kind": "credit", "value": 100000, "stackable": True},
          {"code": "TRIAL30", "kind": "trial_days", "value": 30, "stackable": True}):
    db.sql("set role service_role; select public.console_coupon_save('%s', null, '%s'::jsonb, 'test codes', null, null)" % (fx.OWNER, json.dumps(d)))

class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE)).serve_forever, daemon=True).start()
def jwt(sub, email):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return b({"alg": "HS256", "typ": "JWT"}) + "." + b({"sub": sub, "email": email, "aal": "aal1", "role": "authenticated"}) + ".sig"
ST = {"signups": [], "provisions": [], "redeems": [], "role": "owner"}
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
    def firm(self, uid): return db.one("select firm_id from members where user_id = '%s' and active" % uid) if uid else None
    def handle_any(self):
        p = urlparse(self.path).path
        if p == "/auth/v1/settings": return self.out(200, {"external": {"email": True}, "disable_signup": False})
        if p == "/functions/v1/signup":
            b = self.body()
            if b.get("action") == "provision":
                uid = self.who(); ST["provisions"].append(uid)
                created = not self.firm(uid)
                if created:
                    db.sql("insert into firms (id, name, plan_id, created_at) values ('%s', 'Neha & Co', '%s', now()); insert into members (user_id, firm_id, name, email, role, active) values ('%s', '%s', 'Neha', 'neha@new.test', 'owner', true)" % (NEWFIRM, fx.P1, uid, NEWFIRM))
                return self.out(200, {"ok": True, "created": created, "firm_id": NEWFIRM})
            ST["signups"].append(b); return self.out(200, {"ok": True, "reason": "check_email", "message": "Check your email and click the link to confirm, then sign in."})
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/auth/v1/token":
            return self.out(200, {"access_token": jwt(NEW, "neha@new.test"), "refresh_token": "R1", "expires_in": 3600, "user": {"id": NEW, "email": "neha@new.test"}})
        if p == "/auth/v1/user": return self.out(200, {"id": self.who(), "email": "neha@new.test", "factors": []})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if p.startswith("/rest/v1/"):
            uid = self.who(); f = self.firm(uid)
            if p == "/rest/v1/members":
                return self.out(200, [{"user_id": uid, "firm_id": f, "name": "Neha", "email": "neha@new.test", "role": ST["role"], "active": True}] if f else [])
            if p == "/rest/v1/rpc/mfa_status": return self.out(200, {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
            if p == "/rest/v1/rpc/my_account":
                bal = db.one("select balance from firms where id = '%s'" % f) if f else 0
                return self.out(200, {"me": {"role": ST["role"], "email": "neha@new.test", "name": "Neha"}, "firm": {"id": f, "balance": float(bal or 0), "name": "Neha & Co", "plan": {"name": "Pay as you go", "monthly_fee": 0}}, "people": [], "modules": [], "usage": []})
            if p == "/rest/v1/rpc/coupon_redeem":
                b = self.body(); ST["redeems"].append(b)
                lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
                try:
                    r = db.one("set role authenticated; set fincom.uid = '%s'; select public.coupon_redeem(%s, %s)::text" % (uid, lit(b.get("p_code")), lit(b.get("p_source", "settings"))))
                    return self.out(200, json.loads(r))
                except Exception as e: return self.out(400, {"message": str(e)[:200]})
            if p.startswith("/rest/v1/rpc/"): return self.out(200, {})
            return self.out(200, [] if self.command == "GET" else {})
        return self.out(404, {"message": "not here"})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake).serve_forever, daemon=True).start()
os.makedirs(SHOTS, exist_ok=True)
def shot(pg, name): pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
def no_sideways(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

try:
    print("== 4a. budgets")
    gz = lambda f: len(gzip.compress(open(f, "rb").read(), 6)) // 1024
    main_js = glob.glob(os.path.join(SITE, "assets", "index-*.js"))
    rj, leg = sum(gz(f) for f in main_js), gz(os.path.join(SITE, "legacy.js"))
    box = glob.glob(os.path.join(SITE, "assets", "CouponBox-*.js"))
    ok(rj <= 260, "the React app's first file within its budget: %d KB gzip <= 260" % rj)
    ok(leg <= 600, "legacy.js within its budget: %d KB gzip <= 600" % leg)
    ok(len(box) == 1 and len(gzip.compress(open(box[0], "rb").read())) < 2048 and all("coupon_redeem" not in open(f).read() for f in main_js), "the box is its own small file (%s), not in the first file" % [os.path.basename(b) for b in box])

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        def context(**kw):
            ctx = br.new_context(**({"viewport": {"width": 1300, "height": 900}} | kw))
            ctx.add_init_script("(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o); })()" % FAKE)
            return ctx
        def page(ctx, url=PAGE):
            pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.chunks = []; pg.on("request", lambda r: pg.chunks.append(r.url) if "CouponBox" in r.url else None)
            pg.goto(url); pg.wait_for_timeout(2500)
            pg.evaluate("() => { window.__toasts = []; const t = window.toast; window.toast = (m, o) => { window.__toasts.push(String(m)); return t(m, o); }; }")
            return pg

        print("== 1. the register form")
        ctx = context(); A = page(ctx, PAGE + "#/register")
        ok(A.locator("[data-coupon-ask]").count() == 0, "the email step: no coupon link")
        A.fill('[data-cloud="email"]', "neha@new.test"); A.click('[data-act="cloudSignUp"]'); A.wait_for_timeout(300)
        ok(A.locator("[data-coupon-ask]").inner_text() == "Have a coupon?" and A.locator('[data-cloud="coupon"]').count() == 0, "the details step: a \"Have a coupon?\" link under the password, no box yet")
        ok(A.chunks == [], "the box's file is not fetched before the link is pressed")
        A.click("[data-coupon-ask]"); A.wait_for_selector('[data-cloud="coupon"]')
        ok(len(A.chunks) == 1 and A.evaluate("document.activeElement.dataset.cloud") == "coupon", "pressed: its file fetched once, the box has the focus")
        shot(A, "u01-signup-coupon")
        A.fill('[data-cloud="name"]', "Neha Shah"); A.fill('[data-cloud="firm"]', "Neha & Co"); A.fill('[data-cloud="password"]', "a-long-password-1")
        A.fill('[data-cloud="coupon"]', " icai 1000 ")
        ok(no_sideways(A), "no sideways scroll")
        A.click('[data-act="cloudSignUp"]'); A.wait_for_timeout(1200)
        ok(len(ST["signups"]) == 1 and "coupon" not in ST["signups"][0] and A.locator("[data-signup-sent]").count() == 1, "the account form is sent as before (the code is not sent to the signup function)")
        ok(A.evaluate("localStorage.getItem('fincom:signup-coupon')") == "ICAI1000", "the code is kept on this computer, in capitals without spaces")

        print("== 2. the first sign-in")
        A.click('[data-act="showSignIn"]'); A.wait_for_timeout(300)
        A.fill('[data-cloud="email"]', "neha@new.test"); A.click('[data-act="cloudSignIn"]'); A.fill('[data-cloud="password"]', "a-long-password-1")
        A.click('[data-act="cloudSignIn"]'); A.wait_for_timeout(3500)
        ok(ST["provisions"] == [NEW] and A.evaluate("Cloud.st.firm") == NEWFIRM, "the firm is made at the first sign-in")
        ok(ST["redeems"] == [{"p_code": "ICAI1000", "p_source": "signup"}], "then the code is redeemed once, source signup (%s)" % ST["redeems"])
        t = A.evaluate("window.__toasts")
        ok(any("Coupon ICAI1000: ₹1,000 has been added to your credit." in x for x in t), "the toast says what the firm got (%s)" % t)
        red = db.rows("select source, by_user, status, value_paise from public.coupon_redemptions where firm_id = '%s'" % NEWFIRM)
        ok(red == [{"source": "signup", "by_user": NEW, "status": "finished", "value_paise": "100000"}], "in the database: a signup redemption, ₹1,000 given (%s)" % red)
        ok(db.one("select count(*) from test_credit_posts where firm = '%s' and kind = 'coupon_credit'" % NEWFIRM) == "1", "the credit went through console_credit_post (kind coupon_credit, the ledger's)")
        ok(A.evaluate("localStorage.getItem('fincom:signup-coupon')") is None, "the kept code is gone")
        A.evaluate("() => Cloud.whoAmI()"); A.wait_for_timeout(500)
        ok(len(ST["redeems"]) == 1, "a later look-up does not redeem again")

        print("== 3. Settings, Plan and credit")
        A.evaluate("goSettings('plan')"); A.wait_for_selector("[data-coupon-box]")
        ok(A.inner_text("[data-coupon-box] h2") == "Have a coupon?", "the box under Plan and credit, for the firm's owner")
        A.click("[data-coupon-apply]"); A.wait_for_selector("[data-coupon-result]")
        ok(A.inner_text("[data-coupon-result]") == "Enter the code." and len(ST["redeems"]) == 1, "an empty code: said on the page, nothing sent")
        A.fill("[data-coupon-code]", "nosuch"); A.click("[data-coupon-apply]"); A.wait_for_selector("[data-coupon-result=no]:has-text('not valid')")
        ok(A.inner_text("[data-coupon-result]") == "That code is not valid. Check it and try again.", "a wrong code: plain words")
        A.fill("[data-coupon-code]", "icai1000"); A.click("[data-coupon-apply]"); A.wait_for_selector("[data-coupon-result=no]:has-text('already')")
        ok(A.inner_text("[data-coupon-result]") == "Your firm has already used this code.", "a code used already: plain words")
        A.fill("[data-coupon-code]", "Trial30"); A.click("[data-coupon-apply]"); A.wait_for_selector("[data-coupon-result=ok]")
        ok(A.inner_text("[data-coupon-result]") == "Your trial is longer by 30 days." and A.input_value("[data-coupon-code]") == "", "a good code: applied, in words; the box emptied")
        ok(db.one("select source || '|' || kind from public.coupon_redemptions where firm_id = '%s' and kind = 'trial_days'" % NEWFIRM) == "settings|trial_days" and db.one("select count(*) from public.coupon_discounts where firm_id = '%s'" % NEWFIRM) == "1", "in the database: source settings, a trial for billing")
        shot(A, "u02-settings-coupon")
        A.evaluate("() => { Cloud.st.role = 'staff'; render(); }"); A.wait_for_timeout(300)
        ok(A.locator("[data-coupon-box]").count() == 0, "staff: no box")
        A.evaluate("() => { Cloud.st.role = 'owner'; render(); }")
        ctx.close()

        print("== 4b. phone and dark")
        ctx = context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); P = page(ctx, PAGE + "#/register")
        P.fill('[data-cloud="email"]', "x@new.test"); P.click('[data-act="cloudSignUp"]'); P.click("[data-coupon-ask]"); P.wait_for_selector('[data-cloud="coupon"]')
        ok(no_sideways(P), "phone: the register form with the coupon box, no sideways scroll"); shot(P, "u03-phone-signup")
        ctx.close()
        ctx = context(color_scheme="dark"); D = page(ctx, PAGE + "#/register")
        D.fill('[data-cloud="email"]', "x@new.test"); D.click('[data-act="cloudSignUp"]'); D.click("[data-coupon-ask]"); D.wait_for_selector('[data-cloud="coupon"]')
        shot(D, "u04-dark-signup"); ctx.close()
        br.close()
    ok(not errors, "no page errors (%s)" % errors[:3])
except Exception as e:
    ok(False, "the checks stopped: %s" % str(e)[:500])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
