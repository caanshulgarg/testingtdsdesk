"""python3 run_account_switch.py - one browser, two firms (owner, 21-Oct-2026).
The owner signed in as support@ (firm "Garg Shekhar & Company"), signed out, signed in as test@ (firm "ABC") in the same
browser, and saw support's clients under test@. The firms' rows on the server were not mixed: the browser's own copy
(databases tdsdesk-work / tdsdesk-bank, the tdsdesk:* keys: sync marks, "pulled up to" time...) was one copy for whoever
signed in next. Now each copy belongs to one person in one firm (LocalOwner, src/js/00-core.js).
A fake firm account with two firms and row-level security (a write of a row of another firm is refused and counted):
  1. A (firm A: IX DESIGNS, Posterity) signs in, adds a client while the server refuses writes (unsent), signs out:
     the sign-out says the copy is kept for A only. B (firm B: Korakanvas) signs in in the same page: B sees Korakanvas
     only, and nothing of A is ever sent with B's sign-in.
  2. B signs out, A signs in again: A's copy is back (with the unsent client), A is told it is being sent, and it
     reaches firm A.
  3. A's sign-in ends (every refresh refused), B signs in over it without signing out: B sees B's clients only.
  4. A stale tab of A while B signs in in another tab: the stale tab opens again on B's copy, sends nothing of A.
  5. Two tabs of two people, neither kept signed in: the later sign-in keeps the browser, the other tab is signed out
     and says why; the tabs do not take the browser back and forth.
  6. A copy from before this change holding another firm's synced clients (the owner's browser): put aside on sign-in.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_account_switch.py"""
import os, json, time, threading, functools, http.server, itertools
from urllib.parse import urlparse, parse_qs, unquote
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = 8187, 9327
FAKE = "http://localhost:%d" % FAKE_PORT
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE)).serve_forever, daemon=True).start()

# ---------- the fake firm account: two firms, row-level security ----------
USERS = {"a@firm-a.in": {"id": "uA", "firm": "FA", "firm_name": "Garg Shekhar Test Co"}, "b@firm-b.in": {"id": "uB", "firm": "FB", "firm_name": "ABC Test Co"}}
TOK = {}        # access token -> email
REF = {}        # refresh token -> email
REFUSE = set()  # emails whose refresh is refused (the session cannot continue)
seq = itertools.count(1)
def stamp(): return "2026-10-21T10:00:00.%06dZ" % next(seq)
def crow(firm, cid, name): return {"firm_id": firm, "id": cid, "name": name, "gstin": "", "pan": "", "tally_name": name, "deleted": False, "updated_at": stamp(),
                                   "data": {"id": cid, "name": name, "gstin": "", "pan": "", "tallyName": name, "stats": {}, "hashes": {}, "keys": {}}}
DB = {"clients": [crow("FA", "cX", "IX DESIGNS"), crow("FA", "cY", "Posterity"), crow("FB", "cZ", "Korakanvas")], "records": []}
ST = {"fail_writes": False, "violations": [], "writes": [], "lock": threading.Lock()}
def token_for(email):
    n = next(seq); a, r = "acc-%s-%d" % (USERS[email]["id"], n), "ref-%s-%d" % (USERS[email]["id"], n)
    TOK[a] = email; REF[r] = email
    return {"access_token": a, "refresh_token": r, "expires_in": 3600, "user": {"id": USERS[email]["id"], "email": email}}
def match(row, q):
    for k, vs in q.items():
        if k in ("select", "order", "limit", "on_conflict", "offset"): continue
        op, _, val = vs[0].partition("."); cell = "" if row.get(k) is None else str(row.get(k))
        if op == "eq" and cell != unquote(val): return False
        if op == "gt" and not cell > unquote(val): return False
        if op == "in" and cell not in [unquote(x) for x in val.strip("()").split(",")]: return False
    return True
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-upsert, x-client-info, accept, range")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS"); self.send_header("Access-Control-Expose-Headers", "content-range")
    def out(self, code, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code); self.cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data: self.wfile.write(data)
    def do_OPTIONS(self): self.out(204)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try: return json.loads(self.rfile.read(n) or b"null") if n else None
        except Exception: return None
    def handle_any(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path; bearer = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/auth/v1/token":
            b = self.body() or {}
            if q.get("grant_type") == ["password"]:
                if b.get("email") not in USERS: return self.out(400, {"error_description": "Invalid login credentials"})
                REFUSE.discard(b["email"]); return self.out(200, token_for(b["email"]))
            em = REF.pop(b.get("refresh_token"), None)
            if not em or em in REFUSE: return self.out(400, {"error": "invalid_grant", "error_description": "Invalid Refresh Token: Refresh Token Not Found"})
            return self.out(200, token_for(em))
        if p == "/auth/v1/logout": return self.out(204)
        em = TOK.get(bearer)
        if p == "/auth/v1/user": return self.out(200, {"id": USERS[em]["id"], "email": em, "factors": []}) if em else self.out(401, {"msg": "bad token"})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if not p.startswith("/rest/v1/"): return self.out(200 if self.command == "GET" else 201, [] if self.command == "GET" else {})
        if not em or em in REFUSE: return self.out(401, {"message": "JWT expired"})
        me = USERS[em]; t = p[len("/rest/v1/"):]
        if t == "members": return self.out(200, [{"user_id": me["id"], "firm_id": me["firm"], "name": em, "email": em, "role": "owner", "active": True}])
        if t == "rpc/mfa_status": return self.out(200, {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
        if t == "rpc/my_account": return self.out(200, {"me": {"role": "owner", "email": em, "name": em}, "firm": {"balance": 100, "name": me["firm_name"], "id": me["firm"]}, "people": [], "modules": [], "usage": []})
        if t.startswith("rpc/"):
            with ST["lock"]: ST["writes"].append((em, t, json.dumps(self.body())))
            return self.out(200, {})
        if t in ("clients", "records"):
            rows = DB[t]
            if self.command == "GET":
                hit = sorted([r for r in rows if r["firm_id"] == me["firm"] and match(r, q)], key=lambda r: r["updated_at"])
                if q.get("limit"): hit = hit[:int(q["limit"][0])]
                return self.out(200, hit)
            if ST["fail_writes"]: return self.out(503, {"message": "the server is busy (test)"})
            if self.command == "POST":
                b = self.body(); b = b if isinstance(b, list) else [b]
                with ST["lock"]:
                    for d in b:
                        ST["writes"].append((em, t, d.get("id"), d.get("firm_id")))
                        if d.get("firm_id") != me["firm"]: ST["violations"].append((em, t, d.get("id"), d.get("firm_id"))); return self.out(403, {"message": "new row violates row-level security policy"})
                    for d in b:
                        keys = ["firm_id", "id"] if t == "clients" else ["firm_id", "kind", "id"]
                        old = next((r for r in rows if all(r.get(k) == d.get(k) for k in keys)), None)
                        d = dict(d, updated_at=stamp())
                        if old: old.update(d)
                        else: rows.append(d)
                return self.out(201)
            if self.command == "PATCH":
                d = self.body() or {}; hit = []
                with ST["lock"]:
                    for r in rows:
                        if r["firm_id"] == me["firm"] and match(r, q): r.update(d); r["updated_at"] = stamp(); hit.append(r)
                    ST["writes"].append((em, t + " patch", q.get("id", [""])[0], me["firm"]))
                return self.out(200, hit)
        if self.command == "GET": return self.out(200, [])
        with ST["lock"]: ST["writes"].append((em, t, json.dumps(self.body())[:200]))
        return self.out(201)
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake).serve_forever, daemon=True).start()

fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
A_NAMES, B_NAMES = {"IX DESIGNS", "Posterity", "Unsent Aesthetix"}, {"Korakanvas"}
def signin_page(pg): return pg.locator('[data-act="cloudSignIn"]').count() > 0
def sign_in(pg, email, keep=None, wait=4500):
    pg.wait_for_selector('[data-act="cloudSignIn"]', timeout=15000)
    pg.fill('[data-cloud="email"]', email); pg.fill('[data-cloud="password"]', "pw12345678")
    if keep is not None: pg.set_checked('[data-cloud="keep"]', keep)
    pg.click('[data-act="cloudSignIn"]'); pg.wait_for_timeout(wait)
    pg.wait_for_load_state("load"); pg.wait_for_timeout(800)
def names(pg):
    for _ in range(3):
        try: return set(pg.evaluate("() => Object.values(S.companies || {}).map(c => c.name)"))
        except Exception: pg.wait_for_timeout(800)
    return set()
def shown(pg):
    try: return pg.inner_text("body")
    except Exception: return ""
def toasts(pg):
    try: return pg.evaluate("() => (window.__toasts || []).join(' | ')")
    except Exception: return ""
REC = """(() => { window.__toasts = []; const f = window.fetch.bind(window); window.fetch = (u, o) => f(String(u).replace(/^https:\\/\\/[a-z]+\\.supabase\\.co/, '%s'), o);
  new MutationObserver(() => { const t = document.getElementById('toast'); if (t && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); })
    .observe(document, {subtree: true, childList: true, characterData: true}); })()""" % FAKE

with sync_playwright() as p:
    br = p.chromium.launch()
    # ---------- 1 and 2: sign out, sign in as another firm in the same page; then back ----------
    ctx = br.new_context(viewport={"width": 1400, "height": 900}); ctx.add_init_script(REC)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append("1: " + str(e)))
    pg.goto("http://localhost:%d/" % PAGE_PORT); pg.wait_for_timeout(2500)
    sign_in(pg, "a@firm-a.in")
    ok(names(pg) == {"IX DESIGNS", "Posterity"}, "A signed in: A's clients only (%s)" % sorted(names(pg)))
    ST["fail_writes"] = True
    pg.evaluate("""() => { const c = newCompany({name: 'Unsent Aesthetix', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); render(); }""")
    pg.wait_for_timeout(2500)
    pg.evaluate("() => signOutHere('Signed out.')"); pg.wait_for_timeout(1200)
    t = toasts(pg)
    ok("kept for you only" in t and "Garg Shekhar Test Co" in t, "the sign-out says the copy of A's firm is kept for A only: " + t[-200:])
    ST["fail_writes"] = False; before = len(ST["writes"])
    sign_in(pg, "b@firm-b.in")
    nb = names(pg); body = shown(pg)
    ok(nb == B_NAMES, "B signed in on the same page after A signed out: B's clients only (%s)" % sorted(nb))
    ok(not any(n in body for n in A_NAMES), "nothing of A's clients is on B's screen")
    ok(not ST["violations"], "no write of firm A's rows with B's sign-in (refused by the server: %s)" % ST["violations"])
    bw = [w for w in ST["writes"][before:] if w[0] == "b@firm-b.in" and ("cX" in w or "cY" in w or "Aesthetix" in json.dumps(w))]
    ok(not bw, "and none was even tried (%s)" % bw[:3])
    ok(not any(r.get("firm_id") == "FB" and r.get("id") in ("cX", "cY") for r in DB["clients"]) and not any("Aesthetix" in json.dumps(r) for r in DB["clients"] if r["firm_id"] == "FB"), "firm B's server rows hold nothing of A")
    t = toasts(pg)
    ok("Signed in as b@firm-b.in" in t, "B is told they are signed in, on their own copy: " + t[-160:])
    pg.wait_for_timeout(3500)
    ok(any(a.get("what") == "signin" for a in [json.loads(w[2]) for w in ST["writes"] if w[0] == "b@firm-b.in" and w[1] == "activity" and w[2].startswith("{")]) or any(w[0] == "b@firm-b.in" and w[1] == "activity" for w in ST["writes"]), "B's sign-in reaches the activity log")

    pg.evaluate("() => signOutHere('Signed out.')"); pg.wait_for_timeout(1000)
    sign_in(pg, "a@firm-a.in", wait=6500)
    na = names(pg)
    ok(na == A_NAMES, "A signs in again: A's own copy is back, with the client not sent yet (%s)" % sorted(na))
    t = toasts(pg)
    ok("Welcome back" in t and "being sent now" in t, "A is told the change not sent yet is being sent: " + t[-220:])
    ok(any(r["firm_id"] == "FA" and r["name"] == "Unsent Aesthetix" for r in DB["clients"]), "and it reaches firm A")
    ok(not ST["violations"], "still no write across firms (%s)" % ST["violations"])

    # ---------- 3: A's sign-in ends; B signs in over it, without signing out ----------
    REFUSE.add("a@firm-a.in")
    pg.evaluate("() => Cloud.setSess(Object.assign({}, Cloud.sess(), {at: Date.now() - 7200e3}))")
    pg.evaluate("() => Cloud.api('records?select=id&limit=1').catch(() => 0)"); pg.wait_for_timeout(1200)
    ok(signin_page(pg), "A's session refused: the sign-in page")
    sign_in(pg, "b@firm-b.in")
    nb = names(pg)
    ok(nb == B_NAMES and not any(n in shown(pg) for n in A_NAMES), "B signs in over A's ended session: B's clients only (%s)" % sorted(nb))
    ok(not ST["violations"], "no write across firms (%s)" % ST["violations"])
    ctx.close()

    # ---------- 4: a stale tab of A while B signs in in another tab ----------
    ctx = br.new_context(viewport={"width": 1400, "height": 900}); ctx.add_init_script(REC)
    t1 = ctx.new_page(); t1.on("pageerror", lambda e: errors.append("4/t1: " + str(e)))
    t1.goto("http://localhost:%d/" % PAGE_PORT); t1.wait_for_timeout(2500)
    sign_in(t1, "a@firm-a.in")
    ok(names(t1) == {"IX DESIGNS", "Posterity", "Unsent Aesthetix"}, "tab 1: A signed in (%s)" % sorted(names(t1)))
    t2 = ctx.new_page(); t2.on("pageerror", lambda e: errors.append("4/t2: " + str(e)))
    t2.goto("http://localhost:%d/" % PAGE_PORT); t2.wait_for_timeout(3000)
    t2.evaluate("() => signOutHere('Signed out.')"); t2.wait_for_timeout(1200)
    before = len(ST["writes"])
    sign_in(t2, "b@firm-b.in"); t1.wait_for_timeout(4000)
    ok(names(t2) == B_NAMES, "tab 2: B signed in, B's clients (%s)" % sorted(names(t2)))
    n1 = names(t1)
    ok(n1 <= B_NAMES and not any(n in shown(t1) for n in A_NAMES), "tab 1 (A's, left open) no longer shows A's clients once B signed in (%s)" % sorted(n1))
    bw = [w for w in ST["writes"][before:] if w[0] == "b@firm-b.in" and ("cX" in w or "cY" in w or "Aesthetix" in json.dumps(w))]
    ok(not ST["violations"] and not bw, "nothing of A sent from either tab with B's sign-in (%s %s)" % (ST["violations"], bw[:3]))
    ctx.close()

    # ---------- 5: two tabs of two people, neither kept signed in ----------
    ctx = br.new_context(viewport={"width": 1400, "height": 900}); ctx.add_init_script(REC)
    loads = {"t1": 0, "t2": 0}
    t1 = ctx.new_page(); t1.on("load", lambda: loads.__setitem__("t1", loads["t1"] + 1)); t1.on("pageerror", lambda e: errors.append("5/t1: " + str(e)))
    t1.goto("http://localhost:%d/" % PAGE_PORT); t1.wait_for_timeout(2500)
    sign_in(t1, "a@firm-a.in", keep=False)
    t2 = ctx.new_page(); t2.on("load", lambda: loads.__setitem__("t2", loads["t2"] + 1)); t2.on("pageerror", lambda e: errors.append("5/t2: " + str(e)))
    t2.goto("http://localhost:%d/" % PAGE_PORT); t2.wait_for_timeout(2500)
    sign_in(t2, "b@firm-b.in", keep=False); t1.wait_for_timeout(5000)
    l1, l2 = dict(loads), None
    ok(names(t2) == B_NAMES, "tab 2: B's clients (%s)" % sorted(names(t2)))
    ok(signin_page(t1) and "another tab" in shown(t1) and not any(n in shown(t1) for n in A_NAMES), "tab 1 (A, this tab only): signed out, says someone else signed in in another tab")
    t1.wait_for_timeout(4000); l2 = dict(loads)
    ok(l1 == l2 and l2["t1"] <= 3 and l2["t2"] <= 3, "the tabs settle: no back-and-forth reloads (%s then %s)" % (l1, l2))
    ok(not ST["violations"], "no write across firms (%s)" % ST["violations"])
    ctx.close()

    # ---------- 6: a copy from before this change, holding another firm's synced clients ----------
    ctx = br.new_context(viewport={"width": 1400, "height": 900}); ctx.add_init_script(REC)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append("6: " + str(e)))
    pg.goto("http://localhost:%d/" % PAGE_PORT); pg.wait_for_timeout(2500)
    sign_in(pg, "a@firm-a.in")
    # as an older build left it: the copy belongs to nobody, and its sync marks say these clients were sent
    pg.evaluate("() => { const s = LocalOwner.read(); s.cur = {slot: s.cur.slot, uid: '', firm: ''}; LocalOwner.write(s); }")
    pg.evaluate("() => signOutHere('Signed out.')"); pg.wait_for_timeout(800)
    pg.reload(); pg.wait_for_timeout(2500)
    sign_in(pg, "b@firm-b.in", wait=6500)
    nb = names(pg)
    ok(nb == B_NAMES and not any(n in shown(pg) for n in A_NAMES), "an older copy holding firm A's synced clients is put aside when B signs in (%s)" % sorted(nb))
    ok(not ST["violations"], "no write across firms (%s)" % ST["violations"])
    ctx.close()

    ok(not errors, "no page errors" + ("" if not errors else ": " + "; ".join(errors[:3])))
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
