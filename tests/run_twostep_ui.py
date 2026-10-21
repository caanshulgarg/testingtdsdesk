"""Two-step sign-in is optional: without it, signing in goes straight in; turning it on (QR code and key, then the 6-digit
code) makes the next sign-in ask for the code; a wrong code is refused; signing out tells the server; no idle sign-out;
the audit trail gets sign-in and Tally writes. The firm account is stood in by routes."""
import json, os, re, threading, functools, http.server, base64
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 0), H); PORT = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def jwt(aal): return "x." + base64.urlsafe_b64encode(json.dumps({"sub": "u1", "aal": aal}).encode()).decode().rstrip("=") + ".y"
ST = {"factors": [], "calls": [], "activity": [], "logout": 0, "enrols": 0}
# what GoTrue really sends (fmt.Sprintf("data:image/svg+xml;utf-8,%v", svg)): raw markup with '#', '"', '%', newlines;
# un-encoded, the '#' starts a URL fragment and the image is blank (Safari, 21-Oct-2026)
_cells = "".join('<rect x="%d" y="%d" width="10" height="10" style="fill:#000000;stroke:none"/>' % (x * 10, y * 10) for x in range(25) for y in range(25) if (x * 7 + y * 3) % 5 < 2)
QR = 'data:image/svg+xml;utf-8,<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" viewBox="0 0 250 250"><rect width="100%" height="100%" style="fill:#ffffff"/>' + _cells + '</svg>\n'
def handle(route):
    req = route.request; url = req.url; auth = req.headers.get("authorization") or ""
    aal = "aal2" if "aal2" in (lambda t: base64.urlsafe_b64decode(t + "==").decode() if t else "")(auth.split(".")[1] if auth.count(".") == 2 else "") else "aal1"
    J = lambda b, s=200: route.fulfill(status=s, content_type="application/json", body=json.dumps(b))
    ST["calls"].append((req.method, re.sub(r"https://[^/]+", "", url)))
    if "/auth/v1/token" in url: return J({"access_token": jwt("aal1"), "refresh_token": "r1", "expires_in": 3600, "user": {"id": "u1", "email": "owner@firm.in"}})
    if "/auth/v1/logout" in url: ST["logout"] += 1; return J({})
    if url.endswith("/auth/v1/user"): return J({"id": "u1", "factors": ST["factors"]})
    if url.endswith("/auth/v1/factors") and req.method == "POST":
        ST["factors"] = [{"id": "f1", "factor_type": "totp", "status": "unverified"}]; ST["enrols"] += 1
        return J({"id": "f1", "type": "totp", "totp": {"qr_code": QR, "secret": "JBSWY3DPEHPK3PXP", "uri": "otpauth://x"}})
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
    if "/rpc/my_account" in url: return J({"me": {"role": "owner"}, "firm": {"name": "Test Firm", "balance": 100}})   # named: the firm-details dialog is not due
    return J([])
ENGINE = os.environ.get("PW_ENGINE", "chromium")
with sync_playwright() as p:
    br = getattr(p, ENGINE).launch(); print("engine:", ENGINE); pg = br.new_page(viewport={"width": 1300, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("localStorage.setItem('tdsdesk-test:cloud', JSON.stringify({url: 'https://qbocskaiewaxqcvaunzc.supabase.co'}))")
    pg.route("https://qbocskaiewaxqcvaunzc.supabase.co/**", handle)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2000)
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.fill('[data-cloud="password"]', "pw12345678"); pg.click('[data-act="cloudSignIn"]'); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("Two-step sign-in" not in t and pg.locator('[data-act="cloudSignIn"]').count() == 0, "without two-step turned on, signing in goes straight in")
    pg.evaluate("mfaAction('mfaOptIn')"); pg.wait_for_timeout(500)
    ok("Two-step sign-in" in pg.inner_text("#app") and pg.locator('[data-act="mfaCancel"]').count() == 1, "turning it on is optional (Not now is offered)")
    pg.evaluate("() => { const b = document.querySelector('[data-act=mfaStart]'); b.click(); b.click(); }"); pg.wait_for_timeout(100)
    ok(pg.locator('[data-act="mfaStart"]').count() == 0 or pg.locator('[data-act="mfaStart"]').is_disabled(), "Set it up is disabled while it is on its way")
    pg.wait_for_timeout(1200)
    ok(ST["enrols"] == 1, "pressing Set it up twice makes one authenticator entry (%d)" % ST["enrols"])
    pg.wait_for_function("() => { const i = document.querySelector('.signin img'); return i && i.complete; }", timeout=5000)
    img = pg.evaluate("() => { const i = document.querySelector('.signin img'); const r = i.getBoundingClientRect(); return {w: i.naturalWidth, h: i.naturalHeight, cw: getComputedStyle(i).width, src: i.getAttribute('src').slice(0, 40)}; }")
    ok(img["w"] > 0 and img["h"] > 0, "the QR image (GoTrue's raw SVG with '#' and '%') really loads: " + str(img))
    ok(img["cw"] == "190px", "the QR stays 190 px")
    ok(pg.evaluate("!document.querySelector('.signin svg rect')"), "the SVG is an image, never page markup")
    ok(pg.inner_text("[data-mfa-key]").strip() == "JBSW Y3DP EHPK 3PXP" and pg.locator('[data-act="mfaCopyKey"]').count() == 1, "the typed key shows in groups of 4 with a Copy button")
    if ENGINE == "chromium":
        pg.context.grant_permissions(["clipboard-read", "clipboard-write"])
        pg.locator('[data-act="mfaCopyKey"]').dispatch_event('click'); pg.wait_for_timeout(300)
        ok(pg.evaluate("navigator.clipboard.readText()") == "JBSWY3DPEHPK3PXP", "Copy puts the key (without spaces) on the clipboard")
    ok(pg.evaluate("mfaQrSrc('<svg xmlns=\"http://www.w3.org/2000/svg\"/>')").startswith("data:image/svg+xml;base64,") and pg.evaluate("mfaQrSrc('data:image/png;base64,AAA')") == "data:image/png;base64,AAA" and pg.evaluate("mfaQrSrc('javascript:alert(1)')") == "", "bare <svg> is wrapped, PNG kept, anything else refused")
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
    pg.click('.firmmenu button:has-text("Sign out")'); pg.wait_for_timeout(400); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1200)
    ok(ST["logout"] == 1 and pg.locator('[data-act="cloudSignIn"]').count() == 1, "signing out ends the session on the server too")
    # next sign-in asks only for the code
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.fill('[data-cloud="password"]', "pw12345678"); pg.click('[data-act="cloudSignIn"]'); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("6-digit code for FinCom" in t and pg.locator('[data-act="mfaStart"]').count() == 0 and pg.locator('[data-act="mfaCancel"]').count() == 0, "once turned on, the next sign-in asks for the code (no skipping)")
    ok(not any("/rest/v1/records" in c[1] for c in ST["calls"][-6:]), "no firm data is asked for before the code")
    pg.fill("#mfaCode", "123456"); pg.keyboard.press("Enter"); pg.wait_for_timeout(2000)
    ok(pg.evaluate("Cloud.aal()") == "aal2", "code accepted with Enter")
    # no automatic sign-out (section D, 03-Oct-2026): 31 minutes without a click, still signed in
    pg.evaluate("() => { const t = Date.now; Date.now = () => t() + 31 * 60000; }"); pg.wait_for_timeout(31000)
    ok(pg.locator('[data-act="cloudSignIn"]').count() == 0 and ST["logout"] == 1, "not signed out after 31 minutes without use")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
print(("%d failed" % len(fails)) if fails else "all passed")
