"""python3 run_timings_ui.py - next-timings (the owner, 26-Oct-2026: "measure FinCom's real round-trip latency from the
office to the cloud"): app/src/lib/timings.js in the React test build, signed in to a stand-in for FinCom's cloud (a small
HTTP server answering as Supabase does; never a real database). The 15 minutes between summaries are 4 s here
(window.__fincomTimingsEvery).
  1. after activity (reads and a save of records, a call of tally-ingest, a client's books opened): ONE summary row is
     sent to client_timings, with the kinds measured (rest/records read|save, fn/tally-ingest, the books' steps), the
     browser in a few words, and no firm or user id (the database's defaults put them) and no client id, email, token,
     host or query
  2. idle (no key or click; the app's own polls go on): nothing more is sent for three periods
  3. the page hidden and going away after new activity: one row at once (keepalive), not two
  4. "Copy report" (Settings > Reading bills): the diagnostic report carries the connection timings
  5. no page error; the cloud refusing the row (an older cloud without migration 108): three tries, then quiet
  flock /tmp/fincom-app.lock python3 tests/run_timings_ui.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, json, time, threading, functools, http.server
from urllib.parse import urlparse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = int(os.environ.get("TIMINGS_PORT") or 8631), int(os.environ.get("TIMINGS_FAKE_PORT") or 9631)
FAKE = "http://localhost:%d" % FAKE_PORT
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()

CID = "zzclient7f3a"
ST = {"rows": [], "calls": [], "refuse": False}
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-upsert, x-client-info, accept")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS"); self.send_header("Timing-Allow-Origin", "*")
    def out(self, code, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code); self.cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data: self.wfile.write(data)
    def do_OPTIONS(self): self.out(204)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""
    def handle_any(self):
        p = urlparse(self.path).path; raw = self.body()
        ST["calls"].append((time.time(), self.command, p))
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/functions/v1/tally-ingest": time.sleep(0.15); return self.out(200, {"ok": True})
        if p == "/auth/v1/token": return self.out(200, {"access_token": "A1tok", "refresh_token": "R1tok", "expires_in": 3600, "user": {"id": "u1", "email": "owner@firm.in"}})
        if p == "/auth/v1/user": return self.out(200, {"id": "u1", "email": "owner@firm.in", "factors": []})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if p == "/rest/v1/client_timings" and self.command == "POST":
            if ST["refuse"]: return self.out(404, {"code": "PGRST205", "message": "Could not find the table 'public.client_timings' in the schema cache"})
            ST["rows"].append({"t": time.time(), "raw": raw.decode(), "prefer": self.headers.get("Prefer", ""), "auth": self.headers.get("Authorization", "")}); return self.out(201)
        if p == "/rest/v1/members": return self.out(200, [{"user_id": "u1", "firm_id": "F1", "name": "Owner", "email": "owner@firm.in", "role": "owner", "active": True}])
        if p == "/rest/v1/rpc/mfa_status": return self.out(200, {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
        if p == "/rest/v1/rpc/my_account": return self.out(200, {"me": {"role": "owner", "email": "owner@firm.in", "name": "Owner"}, "firm": {"balance": 100, "name": "Fake Firm"}, "people": [], "modules": [], "usage": []})
        if p == "/rest/v1/records": time.sleep(0.05); return self.out(200 if self.command == "GET" else 201, [] if self.command == "GET" else None)
        if p.startswith("/rest/v1/rpc/"): return self.out(200, {})
        if p.startswith("/rest/v1/"): return self.out(200, [])
        return self.out(404, {"message": "not here"})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
fsrv = http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake); fsrv.handle_error = lambda *a: None
threading.Thread(target=fsrv.serve_forever, daemon=True).start()

fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ACT = """async (cid) => {
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Shift'}));
  await Cloud.api('records?select=kind,id,data,deleted&client_id=eq.' + cid + '&id=eq.bill-991');
  await Cloud.api('records?select=id&client_id=eq.' + cid);
  await Cloud.api('records?on_conflict=firm_id,kind,id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: [{client_id: cid, kind: 'bill', id: 'bill-991', data: {party: 'ZZ SECRET PARTY'}}]});
  const c = Cloud.cfg(), s = Cloud.sess();
  await fetch(c.url + '/functions/v1/tally-ingest', {method: 'POST', headers: {apikey: c.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json'}, body: JSON.stringify({kind: 'beat', client: cid})});
  return true; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 900})
    # the test build is tied to the staging address: its requests go to the stand-in instead; 15 minutes are 4 s here
    ctx.add_init_script("(() => { window.__fincomTimingsEvery = 4000; const f = window.fetch.bind(window); window.fetch = (u, o) => f(typeof u === 'string' ? u.replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s') : u, o); })()" % FAKE)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PAGE_PORT); pg.wait_for_timeout(2500)
    pg.fill('[data-cloud="email"]', "owner@firm.in"); pg.fill('[data-cloud="password"]', "pw12345678"); pg.click('[data-act="cloudSignIn"]')
    pg.wait_for_function("() => window.__fincomTimings && Cloud.on()", timeout=30000)
    ok(True, "signed in; the timings started a few seconds after the first page")

    print("== 1. after activity: one summary row")
    pg.wait_for_timeout(4500); n0 = len(ST["rows"])     # whatever the opening itself sent
    pg.evaluate(ACT, CID)
    # a client's books opened (this browser has no copy: a first visit)
    pg.evaluate("(cid) => { S.companies[cid] = {id: cid, name: 'ZZ SECRET CLIENT', choices: {}}; S.coId = cid; return openBooks(cid); }", CID)
    pg.wait_for_timeout(9000)
    new = ST["rows"][n0:]
    ok(len(new) >= 1, "a summary row was sent after the activity (%d)" % len(new))
    rows = [json.loads(r["raw"]) for r in new]
    ks = set().union(*[set(r.get("summary", {}).get("k", {})) for r in rows]) if rows else set()
    ok({"rest/records read", "rest/records save", "fn/tally-ingest"} <= ks, "the kinds measured: records read and save, tally-ingest " + str(sorted(ks)))
    ok(any(k.startswith("books/local ") for k in ks) and "books/shown" in ks and "books/total" in ks, "the books' opening, step by step: " + str(sorted(k for k in ks if k.startswith("books/"))))
    ok("books/local empty" in ks or "books/local kept-empty" in ks, "this browser had no copy of the client's books: said so")
    allraw = " ".join(r["raw"] for r in new)
    for bad in [CID, "bill-991", "owner@firm.in", "A1tok", "localhost", "supabase", "select=", "eq.", "ZZ SECRET", "F1", "u1\""]:
        ok(bad not in allraw, "not sent: " + bad)
    r0 = rows[-1] if rows else {}
    ok(set(r0) <= {"browser", "net_type", "net_rtt", "net_down", "summary"} and "firm_id" not in r0 and "user_id" not in r0, "the row's fields: browser, network, summary only (the database puts firm and user) " + str(sorted(r0)))
    ok(r0.get("browser", "").startswith("Chrome ") and r0.get("browser", "").endswith(" · Linux"), "the browser in a few words: " + r0.get("browser", ""))
    rr = r0.get("summary", {}).get("k", {}).get("rest/records read") or next((r["summary"]["k"]["rest/records read"] for r in rows if "rest/records read" in r["summary"]["k"]), {})
    ok(rr.get("n", 0) >= 2 and rr.get("p50", 0) >= 50 and rr.get("p95", 0) >= rr.get("p50", 0) and isinstance(rr.get("h"), list), "records read: count, p50, p95, histogram " + json.dumps(rr))
    sv = next((r["summary"]["k"]["rest/records save"] for r in rows if "rest/records save" in r["summary"]["k"]), {})
    ok(sv.get("up", 0) > 20, "a save: the bytes sent counted (%s)" % sv.get("up"))
    ok(all(r["prefer"] == "return=minimal" and r["auth"] == "Bearer A1tok" for r in new), "sent as the signed-in person, return=minimal")
    ok(not any("client_timings" in k for k in ks), "the summary's own sending is not measured")

    print("== 2. idle: nothing more")
    # the app's own work after the books were opened (the new client sent to the firm account) settles first: 5 s with no
    # request but the summary's own (60 s at most), and one more period for its row
    t_end = time.time() + 60
    while time.time() < t_end:
        last = max([c[0] for c in ST["calls"] if c[2] != "/rest/v1/client_timings"] or [0])
        if time.time() - last > 5: break
        pg.wait_for_timeout(1000)
    pg.wait_for_timeout(4500)
    n1 = len(ST["rows"]); t1 = time.time()
    pg.wait_for_timeout(13000)
    idle_calls = [c for c in ST["calls"] if c[0] > t1 and c[2] != "/rest/v1/client_timings"]
    ok(len(ST["rows"]) == n1, "13 s idle (three periods): no row sent (%d; other requests meanwhile: %s)" % (len(ST["rows"]) - n1, [c[1] + " " + c[2] for c in idle_calls][:6]))

    print("== 3. the page hidden after new activity")
    pg.evaluate(ACT, CID); th = time.time()
    # closing a tab fires both: hidden, then pagehide
    pg.evaluate("() => { Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); }")
    pg.wait_for_timeout(600)
    hid = [r for r in ST["rows"] if r["t"] > th]
    ok(len(hid) == 1 and "rest/records save" in json.loads(hid[0]["raw"])["summary"]["k"], "one row at once when the page is hidden and goes away (not two), with the new activity (%d)" % len(hid))
    pg.evaluate("() => { Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); }")

    print("== 4. the diagnostic report")
    pg.evaluate("() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'reading'; render(); }"); pg.wait_for_timeout(1500)
    txt = pg.evaluate("() => (document.getElementById('diagBox') || {}).value || ''")
    ok("FinCom diagnostic report" in txt and "Connection timings (this page" in txt and "rest/records read" in txt and "books/" in txt, "Copy report carries the connection timings and the books' steps:\n" + "\n".join(txt.split("Connection timings")[-1].splitlines()[:12]))
    part = txt.split("Connection timings")[-1]
    ok(CID not in part and "localhost" not in part and "eq." not in part, "the timings' part: no client id, host or query")

    print("== 5. an older cloud refusing the row")
    ST["refuse"] = True; t5 = time.time()
    for _ in range(5): pg.evaluate(ACT, CID); pg.wait_for_timeout(4300)
    tries = [c for c in ST["calls"] if c[0] > t5 and c[2] == "/rest/v1/client_timings"]
    ok(len(tries) == 3, "three tries, then quiet (%d)" % len(tries))
    ok(not errors, "no page error " + str(errors[:3]))
    br.close()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
