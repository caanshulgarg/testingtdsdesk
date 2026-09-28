"""Two-step sign-in is optional: without it, signing in goes straight in; turning it on (QR code and key, then the 6-digit
code) makes the next sign-in ask for the code; a wrong code is refused; signing out tells the server; idle sign-out;
the audit trail gets sign-in and Tally writes. The firm account is stood in by routes."""
import json, os, re, threading, functools, http.server, base64
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8167), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def jwt(aal): return "x." + base64.urlsafe_b64encode(json.dumps({"sub": "u1", "aal": aal}).encode()).decode().rstrip("=") + ".y"
ST = {"factors": [], "calls": [], "activity": [], "logout": 0}
def handle(route):
    req = route.request; url = req.url; auth = req.headers.get("authorization") or ""
    aal = "aal2" if "aal2" in (lambda t: base64.urlsafe_b64decode(t + "==").decode() if t else "")(auth.split(".")[1] if auth.count(".") == 2 else "") else "aal1"
    J = lambda b, s=200: route.fulfill(status=s, content_type="application/json", body=json.dumps(b))
    ST["calls"].append((req.method, re.sub(r"https://[^/]+", "", url)))
    if "/auth/v1/token" in url: return J({"access_token": jwt("aal1"), "refresh_token": "r1", "expires_in": 3600, "user": {"id": "u1", "email": "owner@firm.in"}})
    if "/auth/v1/logout" in url: ST["logout"] += 1; return J({})
    if url.endswith("/auth/v1/user"): return J({"id": "u1", "factors": ST["factors"]})
    if url.endswith("/auth/v1/factors") and req.method == "POST":
        ST["factors"] = [{"id": "f1", "factor_type": "totp", "status": "unverified"}]
        return J({"id": "f1", "type": "totp", "totp": {"qr_code": "data:image/svg+xml;utf-8,<svg xmlns='http://www.w3.org/2000/svg'/>", "secret": "JBSWY3DPEHPK3PXP", "uri": "otpauth://x"}})
    if re.search(r"/factors/f1/challenge", url): return J({"id": "ch1"})
    if re.search(r"/factors/f1/verify", url):
        if json.loads(req.post_data)["code"] != "123456": return J({"msg": "Invalid TOTP code entered"}, 422)
        ST["factors"] = [{"id": "f1", "factor_type": "totp", "status": "verified"}]
        return J({"access_token": jwt("aal2"), "refresh_token": "r2", "expires_in": 3600})
    if "/rpc/mfa_status" in url:
        enrolled = any(f["status"] == "verified" for f in ST["factors"])
        return J({"required": enrolled, "enrolled": enrolled, "admin": False, "aal": aal, "ok": aal == "aal2" or not enrolled})
    if "/rest/v1/members" in url:
        return J([{"user_id": "u1", "firm_id": "F1", "name": "Owner", "email": "owner@firm.in", "role": "owner", "active": True}] if aal == "aal2" else [{"user_id": "u1", "firm_id": "F1", "role": "owner", "active": True}])
    if "/rest/v1/activity" in url: ST["activity"].append(json.loads(req.post_data or "{}")); return route.fulfill(status=201, body="")
    if "/rpc/my_account" in url: return J({"me": {"role": "owner"}, "firm": {"balance": 100}})
    return J([])
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1300, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("localStorage.setItem('tdsdesk-test:cloud', JSON.stringify({url: 'https://qbocskaiewaxqcvaunzc.supabase.co'}))")
    pg.route("https://qbocskaiewaxqcvaunzc.supabase.co/**", handle)
    pg.goto("http://localhost:8167/"); pg.wait_for_timeout(2000)
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.fill('[data-cloud="password"]', "pw12345678"); pg.click('[data-act="cloudSignIn"]'); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("Two-step sign-in" not in t and pg.locator('[data-act="cloudSignIn"]').count() == 0, "without two-step turned on, signing in goes straight in")
    pg.evaluate("mfaAction('mfaOptIn')"); pg.wait_for_timeout(500)
    ok("Two-step sign-in" in pg.inner_text("#app") and pg.locator('[data-act="mfaCancel"]').count() == 1, "turning it on is optional (Not now is offered)")
    pg.click('[data-act="mfaStart"]'); pg.wait_for_timeout(800)
    ok(pg.locator(".signin img").count() == 1 and "JBSWY3DPEHPK3PXP" in pg.inner_text("#app"), "QR code and typed key are shown")
    pg.fill("#mfaCode", "000000"); pg.click('[data-act="mfaVerify"]'); pg.wait_for_timeout(800)
    ok("did not match" in pg.inner_text("#app"), "a wrong code is refused")
    pg.fill("#mfaCode", "123456"); pg.click('[data-act="mfaVerify"]'); pg.wait_for_timeout(2500)
    ok("Two-step sign-in" not in pg.inner_text("#app") and pg.evaluate("Cloud.aal()") == "aal2", "the right code opens the app (aal2)")
    ok(any(a.get("what") in ("signin", "signin.mfa") for a in ST["activity"]), "the audit trail has the sign-in: " + str([a.get("what") for a in ST["activity"]]))
    # a write to Tally goes into the trail
    pg.evaluate("() => { Bridge.cfg = () => ({url: 'http://127.0.0.1:9', key: 'k'}); Bridge.call('/unpost', {company: 'ZZ TEST', guid: 'g-1', vchNumber: '7'}, 500).catch(() => {}); }"); pg.wait_for_timeout(800)
    ok(any(a.get("what") == "tally.unpost" and "g-1" in a.get("detail", "") for a in ST["activity"]), "a delete in Tally is in the trail")
    # sign out: the server is told
    pg.evaluate("() => { S.firmMenu = true; render(); }"); pg.wait_for_timeout(300)
    pg.click('[data-act="signOutNow"]'); pg.wait_for_timeout(400); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1200)
    ok(ST["logout"] == 1 and pg.locator('[data-act="cloudSignIn"]').count() == 1, "signing out ends the session on the server too")
    # next sign-in asks only for the code
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.fill('[data-cloud="password"]', "pw12345678"); pg.click('[data-act="cloudSignIn"]'); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("6-digit code for TDS Desk" in t and pg.locator('[data-act="mfaStart"]').count() == 0 and pg.locator('[data-act="mfaCancel"]').count() == 0, "once turned on, the next sign-in asks for the code (no skipping)")
    ok(not any("/rest/v1/records" in c[1] for c in ST["calls"][-6:]), "no firm data is asked for before the code")
    pg.fill("#mfaCode", "123456"); pg.keyboard.press("Enter"); pg.wait_for_timeout(2000)
    ok(pg.evaluate("Cloud.aal()") == "aal2", "code accepted with Enter")
    # idle: pretend 31 minutes have passed
    pg.evaluate("() => { idleLast = Date.now() - 31 * 60000; }"); pg.wait_for_timeout(31000)
    ok(pg.locator('[data-act="cloudSignIn"]').count() == 1 and ST["logout"] == 2, "signed out after 30 minutes without use")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
print(("%d failed" % len(fails)) if fails else "all passed")
