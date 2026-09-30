"""python3 run_gstapi_session.py - GST API: the portal session is kept by the server; the card reads it, no OTP again.
Needs no client data: the React card is put in the page on its own, with the firm's server function stood in.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gstapi_session.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8148), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors, calls = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
G = "09AANFG3202D1ZR"; SERVER = {"sessions": []}
def fake(route):
    b = json.loads(route.request.post_data or "{}"); calls.append(b)
    r = {"ok": True, "sessions": SERVER["sessions"]} if b.get("action") == "status" else {"ok": False, "error": "?"}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(r))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/functions/v1/gst-taxpro", fake)
    pg.goto("http://localhost:8148/"); pg.wait_for_timeout(2500)
    pg.evaluate("""(g) => { Cloud.on = () => true; Cloud.cfg = () => ({url: 'https://example.supabase.co', key: 'anon'}); Cloud.sess = () => ({access_token: 't'});
      S.account = {email: 'a@b.c'}; S.gstReg = '09'; S.books = {twoBs: {}}; GSTAPI.gstinOf = () => g; GSTAPI.user = () => 'gargshekhar09';
      window.render = FinComReact.redraw; document.getElementById('app').innerHTML = '<div data-react="GstApiCard"></div>'; }""", G)
    card = lambda: pg.evaluate("FinComReact.redraw(), document.getElementById('app').innerHTML")
    card(); pg.wait_for_timeout(800); h = card()
    ok(any(c.get("action") == "status" and c.get("gstins") == [G] for c in calls), "the card asks the server which GSTINs it keeps connected")
    ok(">Send OTP<" in h and "Connected to the portal" not in h, "nothing kept on the server: Send OTP" + ("" if ">Send OTP<" in h else " [" + h[:300] + "]"))
    # another tab, another staff member: the server already has the session from an OTP given earlier
    SERVER["sessions"] = [{"gstin": G, "username": "gargshekhar09", "until": "2099-01-01T00:00:00Z", "connectedAt": "2026-09-29T13:00:00Z", "error": None}]
    pg.evaluate("GSTAPI.seen = {}"); card(); pg.wait_for_timeout(800); h = card()
    ok("Connected to the portal for " + G + " since" in h and "OTP</button>" not in h and ">Fetch 2B<" in h, "kept on the server: connected, Fetch 2B, no OTP asked")
    n = len(calls); card(); card()
    ok(len(calls) == n, "the server is not asked again on every draw (only every 10 minutes)")
    # the taxpayer's API access period is over: the server could not renew it
    SERVER["sessions"] = [dict(SERVER["sessions"][0], until="2020-01-01T00:00:00Z", error="Invalid Session (AUTH4037)")]
    pg.evaluate("GSTAPI.seen = {}"); card(); pg.wait_for_timeout(800); h = card()
    ok("The portal session has ended" in h and "AUTH4037" in h and ">Send OTP<" in h, "session over: says so, with the portal's reason, and offers one OTP")
    # the OTP is typed into a field that keeps it through redraws of the page around it
    SERVER["sessions"] = []; pg.evaluate("GSTAPI.seen = {}; GSTAPI.sess = {'" + G + "': {sentAt: Date.now()}}"); card(); pg.wait_for_timeout(500); card()
    pg.fill('input[aria-label="OTP"]', "12a3456"); card(); card()
    v = pg.input_value('input[aria-label="OTP"]'); ok(v == "123456", "OTP field: digits only, kept through redraws" + ("" if v == "123456" else " [" + v + "]"))
    ok("auth_token" not in json.dumps(pg.evaluate("GSTAPI.sess"), default=str), "the tab holds no portal token")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
