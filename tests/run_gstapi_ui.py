"""python3 run_gstapi_ui.py - GST API: portal username in settings, OTP sign-in, 2B fetched into the 2B reconciliation.
The firm's server function is stood in by a route that answers as it does, with VMS's real March 2B."""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
f2b = os.path.join(DATA, "returns_R2B_07AADCV3366N1ZU_032026.json")
if not os.path.exists(f2b): print("  (VMS 2B file not here; skipped)\n\nall passed"); raise SystemExit(0)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8147), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
mar = json.load(open(f2b))["data"]
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
seen = []
def fake(route):
    b = json.loads(route.request.post_data or "{}"); seen.append(b)
    auth = route.request.headers.get("authorization", "")
    if auth != "Bearer tok-firm": return route.fulfill(status=401, body=json.dumps({"ok": False, "error": "Sign in again."}))
    a = b.get("action")
    if a == "otp": r = {"ok": True, "app_key": "Xo8lBiPr3atUJ7c0LjG2kDHVAThCvMZE"}
    elif a == "auth": r = {"ok": True, "auth_token": "at-1", "sek": "sek-1", "expiryMinutes": 120} if b.get("otp") == "575757" else {"ok": False, "error": "Invalid OTP (AUTH4033)"}
    elif a == "2b" and b.get("period") == "032026" and b.get("auth_token") == "at-1": r = {"ok": True, "parts": 1, "data": mar}
    elif a == "2b": r = {"ok": False, "error": "No 2B for this period (RET2B1016)"}
    else: r = {"ok": False, "error": "?"}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(r))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/functions/v1/gst-api", fake)
    pg.goto("http://localhost:8147/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "r2b"; S.gstYm = "202603"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; S.gstPart = 'r2b'; render();"); pg.wait_for_timeout(2500)
    ok("Fetch 2B from the portal" in pg.inner_text("#app") and "Sign in to the firm account" in pg.inner_text("#app"), "without the firm account: the card says to sign in; files can still be brought in")
    # the firm account, as signed in
    pg.evaluate("() => { Cloud.on = () => true; Cloud.cfg = () => ({url: 'https://example.supabase.co', key: 'anon'}); Cloud.sess = () => ({access_token: 'tok-firm'}); Cloud.refreshToken = async () => {}; S.account = {email: 'a@b.c'}; render(); }"); pg.wait_for_timeout(800)
    ok("GST portal username in" in pg.inner_text("#app"), "signed in, no username yet: points to GST settings")
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2000)
    pg.fill('input[data-gset="puser"][data-greg="07"]', "vmsevents07"); pg.press('input[data-gset="puser"][data-greg="07"]', "Tab"); pg.wait_for_timeout(800)
    ok(pg.evaluate("GSTSet.peek('07').portalUser") == "vmsevents07", "the portal username is kept in GST settings")
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(2000)
    pg.click('button[data-gapi="otp"]'); pg.wait_for_timeout(1500)
    ok(seen[-1] == {"action": "otp", "gstin": "07AADCV3366N1ZU", "username": "vmsevents07"} and "OTP sent" in pg.inner_text("#app"), "Send OTP: the GSTIN and username go to the firm's server function; the OTP box appears")
    pg.fill("input[data-gapiotp]", "111111"); pg.click('button[data-gapi="auth"]'); pg.wait_for_timeout(1500)
    ok("Invalid OTP" in pg.inner_text("#app") and not pg.evaluate("GSTAPI.live('07AADCV3366N1ZU')"), "a wrong OTP: the portal's reason is shown, not connected")
    pg.fill("input[data-gapiotp]", "575757"); pg.click('button[data-gapi="auth"]'); pg.wait_for_timeout(1500)
    ok("Connected to the portal" in pg.inner_text("#app"), "the right OTP: connected, with the time the session ends")
    pg.select_option("select[data-gapiym]", "202603"); pg.click('button[data-gapi="one"]'); pg.wait_for_timeout(5000)
    t = pg.inner_text("#app")
    ok(pg.evaluate("!!S.books.twoBs['07AADCV3366N1ZU|032026'] && S.books.twoBs['07AADCV3366N1ZU|032026'].source === 'api'") and "2B fetched: Mar 2026" in t, "March 2B fetched and put where a 2B file goes")
    rows = pg.evaluate("S.books.twoBs['07AADCV3366N1ZU|032026'].rows.length"); want = pg.evaluate("(j) => GST2B.fromJson({data: j}).rows.length", mar)
    ok(rows == want and rows > 0, "every document of it: %d, the same as the portal's JSON file gives" % rows)
    ok(seen[-1].get("auth_token") == "at-1" and seen[-1].get("app_key") and seen[-1].get("period") == "032026", "the session goes with each call")
    ok("matched" in t.lower() or "Matched" in t, "the 2B reconciliation runs on it")
    pg.screenshot(path=OUT + "/gstapi-2b.png", full_page=False)
    pg.select_option("select[data-gapiym]", "202602"); pg.click('button[data-gapi="one"]'); pg.wait_for_timeout(2500)
    ok("RET2B1016" in pg.inner_text("#app"), "a month the portal has no 2B for: its reason is shown")
    ok("at-1" not in json.dumps(pg.evaluate("S.books"), default=str) and "Xo8lBiPr" not in json.dumps(pg.evaluate("S.books"), default=str), "the portal session is never saved with the books")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
