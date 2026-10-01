"""python3 run_live_sync.py - live sync (review of 01-Oct-2026, branch server-books): two computers open on the same
client. Four TDS ledgers confirmed on one still showed the old state on the other, even after a refresh, and changing
them there said someone else had changed them. Now each change goes to the server at once, item by item, and reaches
the other computer through Supabase Realtime in a second or two, with no refresh:
  - a TDS ledger confirmed on A shows confirmed on B within 2 seconds; two ledgers confirmed at once on A and B are
    both kept; the same ledger changed on both keeps the later change, with a note, not an error;
  - a bill approved on A, and a client setting changed on A, show on B within 2 seconds;
  - a refresh on B shows the server's state, never the older copy kept in B's browser;
  - the work kept before as one blob (client_books) comes over to the items on first opening;
  - offline: the change waits, the top bar says so, and it goes when the computer is back online.
A stand-in for Supabase here (REST and the Realtime socket), shared by both browsers. Made-up books only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_live_sync.py"""
import os, re, json, time, threading, functools, http.server, itertools, datetime
from urllib.parse import urlparse, parse_qs, unquote
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8168), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
FIRM = "f0000000-0000-0000-0000-00000000000f"; CID = "zzlive1"
USERS = {"tA": ("u-asha", "Asha"), "tB": ("u-rahul", "Rahul")}
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
# ---------- the stand-in database
seq = itertools.count(1)
DB = {"items": {}, "records": {}, "clients": {}, "blob": None, "calls": {"save_items": 0}}
SOCKS = []
def broadcast(table, rec):
    msg = json.dumps({"topic": "realtime:fincom-" + FIRM, "event": "postgres_changes", "ref": None,
                      "payload": {"ids": [1], "data": {"schema": "public", "table": table, "type": "UPDATE", "commit_timestamp": now(), "errors": None, "record": rec}}})
    for s in list(SOCKS):
        try: s.send(msg)
        except Exception: SOCKS.remove(s)
def uid_of(req):
    t = (req.headers.get("authorization") or "").replace("Bearer ", "")
    return USERS.get(t, ("", ""))[0]
OFFLINE = set()      # the tokens of a computer cut off the network (set_offline does not stop answers given here)
def route(r):
    req = r.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    if (req.headers.get("authorization") or "").replace("Bearer ", "") in OFFLINE: return r.abort("internetdisconnected")
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    body = json.loads(req.post_data) if req.post_data else None
    if path.endswith("/rest/v1/members"): return j([{"user_id": v[0], "firm_id": FIRM, "name": v[1], "email": v[1].lower() + "@zz.test", "role": "staff", "active": True} for v in USERS.values()])
    if path.endswith("/rest/v1/client_book_items"):
        cid = q["client_id"][0][3:]; after = int(q.get("seq", ["gt.0"])[0][3:])
        rows = sorted([x for x in DB["items"].values() if x["client_id"] == cid and x["seq"] > after], key=lambda x: x["seq"])
        return j(rows[:1000])
    if path.endswith("/rest/v1/rpc/save_book_items"):
        DB["calls"]["save_items"] += 1; me = uid_of(req); out = []
        for x in body["p_items"]:
            s = next(seq); rec = {"firm_id": FIRM, "client_id": body["p_client"], "key": x["k"], "item": x.get("i", ""), "ord": x.get("o"),
                                  "data": None if x.get("del") else x.get("d"), "deleted": bool(x.get("del")), "seq": s, "updated_at": now(), "updated_by": me}
            DB["items"][(rec["client_id"], rec["key"], rec["item"])] = rec; out.append({"k": rec["key"], "i": rec["item"], "seq": s})
        for x in out: broadcast("client_book_items", DB["items"][(body["p_client"], x["k"], x["i"])])
        return j({"ok": True, "items": out, "at": now()})
    if path.endswith("/rest/v1/client_books"): return j([DB["blob"]] if DB["blob"] else [])
    if path.endswith("/rest/v1/records") or path.endswith("/rest/v1/clients"):
        table = "records" if path.endswith("/records") else "clients"
        if req.method == "POST":
            me = uid_of(req)
            for x in body:
                rec = dict(x, updated_at=now(), updated_by=me)
                k = (x.get("kind", "client"), x.get("client_id", ""), x["id"])
                DB[table][k] = rec; broadcast(table, rec)
            return r.fulfill(status=201, body="")
        since = unquote(q.get("updated_at", ["gt.1970"])[0][3:])
        rows = sorted([x for x in DB[table].values() if x["updated_at"] > since], key=lambda x: x["updated_at"])
        return j(rows[:200])
    if "/rest/v1/rpc/" in path: return j([])
    if "/functions/v1/" in path: return j({})
    return j([])
def ws_route(ws):
    SOCKS.append(ws)
    def on_msg(m):
        try: x = json.loads(m)
        except Exception: return
        if x.get("event") == "phx_join":
            ws.send(json.dumps({"topic": x["topic"], "event": "phx_reply", "ref": x["ref"], "payload": {"status": "ok", "response": {"postgres_changes": [{"id": 1}]}}}))
        elif x.get("event") == "heartbeat":
            ws.send(json.dumps({"topic": "phoenix", "event": "phx_reply", "ref": x["ref"], "payload": {"status": "ok", "response": {}}}))
    ws.on_message(on_msg)
def wait_for(pg, js, t=10):
    s = time.time()
    while time.time() - s < t:
        try:
            if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
        except Exception: pass
        time.sleep(0.05)
    return None
# made-up books: a few ledgers FinCom asks to confirm
V = [{"id": "zz-%d" % n, "date": "202504%02d" % (n + 1), "type": "Journal", "no": str(n), "party": "ZZ Vendor %d" % n, "gstin": "", "pos": "", "cmp": "", "narr": "", "hsn": [], "cancel": False, "opt": False,
      "ent": [{"l": "ZZ Expense", "a": -1000, "r": None}, {"l": led, "a": 100, "r": None}, {"l": "ZZ Vendor %d" % n, "a": 900, "r": None}]}
     for n, led in enumerate(["TDS on Rent", "TDS on Contract", "TDS on Professional Fees", "TDS on Commission", "TDS on Interest"])]
LEDS = ["TDS on Rent", "TDS on Contract", "TDS on Professional Fees", "TDS on Commission", "TDS on Interest"]
def computer(br, tok, name):
    ctx = br.new_context(viewport={"width": 1300, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(name + ": " + str(e)))
    ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
    pg.goto("http://localhost:8168/"); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    sign_in(pg, tok)
    return ctx, pg
def sign_in(pg, tok):
    pg.evaluate("""([tok, uid, firm]) => { Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
      Cloud.st.firm = firm; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-asha", name: "Asha"}, {user_id: "u-rahul", name: "Rahul"}]; startCloudSync2(); }""", [tok, USERS[tok][0], FIRM])
    wait_for(pg, "Live.st === 'live'", 10)
def open_client(pg, tab="ledgers"):
    pg.evaluate("""([cid, tab]) => { S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = tab; S.books = null; render(); }""", [CID, tab])
    return wait_for(pg, "S.books && S.books.cid === '%s' && !S.books.loading" % CID, 15)
with sync_playwright() as p:
    br = p.chromium.launch()
    # the work kept before as one blob: one ledger already confirmed there
    DB["blob"] = {"rev": 3, "data": {"map": {"TDS on Interest": {"kind": "tds", "ok": True, "byHand": True, "what": "tds_payable"}}}, "updated_at": now(), "updated_by": "u-asha"}
    ctxA, A = computer(br, "tA", "A")
    ok(A.evaluate("Live.st") == "live", "computer A: connected to the server's live changes")
    # the client, made on A, reaches B by itself
    A.evaluate("""(cid) => { const c = newCompany({name: "ZZ LIVE TEST", gstin: ""}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); }""", CID)
    ctxB, B = computer(br, "tB", "B")
    ok(wait_for(B, "S.companies['%s']" % CID, 5) is not None, "computer B: the client made on A is there")
    # each computer has the client's books from Tally (here: put in its browser)
    for pg in (A, B):
        pg.evaluate("""async ([cid, vs]) => { const b = {cid, vouchers: vs, meta: {from: "20250401", to: "20250430"}, challans: [], alloc: {}, pans: {}}; b.map = Books.mapLedgers(vs, {}); await Books.save(cid, b); }""", [CID, V])
    ok(open_client(A) is not None, "A: the client opens")
    ok(A.evaluate("!!(S.books.map['TDS on Interest'] || {}).ok"), "the work kept before as one blob comes over: TDS on Interest confirmed")
    t0 = time.time(); took = open_client(B)
    ok(took is not None and B.evaluate("!!(S.books.map['TDS on Interest'] || {}).ok"), "B: opens with the server's state, the blob's confirmation included (%.2fs)" % (took or 0))
    ok(len([k for k in DB["items"] if k[1] == "map"]) >= 5, "the work is kept item by item: %d items for the ledgers" % len([k for k in DB["items"] if k[1] == "map"]))
    # ---------- 1. a TDS ledger confirmed on A shows on B within 2 seconds, with no refresh
    led = LEDS[0]
    ok(not B.evaluate("!!(S.books.map[%s] || {}).ok" % json.dumps(led)), "before: %s not confirmed on B" % led)
    A.evaluate("(n) => lmConfirmToggle(n)", led); t = wait_for(B, "!!(S.books.map[%s] || {}).ok" % json.dumps(led), 5)
    ok(t is not None and t < 2, "1. %s confirmed on A: confirmed on B in %.2f s, no refresh" % (led, t or 99))
    ok(wait_for(B, "document.body.innerText.includes('Updated by Asha at')", 2) is not None, "and B says “Updated by Asha at …”, not an error")
    ok(wait_for(A, "document.querySelector('[data-save=\"saved\"]')", 3) is not None and "Saved" in A.inner_text("header"), "A's top bar says Saved: " + re.sub(r"\s+", " ", A.inner_text(".tchip.ok") if A.locator(".tchip.ok").count() else "")[:40])
    # four at once on A, as in the review
    A.evaluate("(ns) => { LedMaster.confirm(S.books, ns, true); saveBooks(); render(); }", LEDS[1:4])
    t = wait_for(B, " && ".join("!!(S.books.map[%s] || {}).ok" % json.dumps(n) for n in LEDS[1:4]), 5)
    ok(t is not None and t < 2, "four ledgers confirmed on A: all on B in %.2f s" % (t or 99))
    # ---------- 2. both at once, different ledgers: both kept, no clash
    A.evaluate("(n) => lmConfirmToggle(n)", LEDS[1]); B.evaluate("(n) => lmConfirmToggle(n)", LEDS[2])
    t = wait_for(A, "!(S.books.map[%s] || {}).ok && !(S.books.map[%s] || {}).ok" % (json.dumps(LEDS[1]), json.dumps(LEDS[2])), 5)
    t2 = wait_for(B, "!(S.books.map[%s] || {}).ok && !(S.books.map[%s] || {}).ok" % (json.dumps(LEDS[1]), json.dumps(LEDS[2])), 5)
    ok(t is not None and t2 is not None, "2. A and B each un-confirm a different ledger at once: both changes on both computers")
    ok(not any("changed the same" in x for x in [A.inner_text("body"), B.inner_text("body")]), "no “someone else changed it” error")
    # the same ledger on both: the later change stays everywhere
    A.evaluate("(n) => { const m = S.books.map[n]; m.what = 'tds_payable'; m.ok = true; saveBooks(); }", LEDS[4]); time.sleep(0.05)
    B.evaluate("(n) => { const m = S.books.map[n]; m.what = 'tcs_payable'; m.ok = true; saveBooks(); }", LEDS[4])
    same = lambda pg: pg.evaluate("(n) => (S.books.map[n] || {}).what", LEDS[4])
    wait_for(A, "(S.books.map[%s] || {}).what === 'tcs_payable'" % json.dumps(LEDS[4]), 5); time.sleep(0.5)
    ok(same(A) == same(B) == "tcs_payable", "the same ledger changed on both: the later change stays on both (%s, %s)" % (same(A), same(B)))
    # ---------- 3. a bill approved on A shows on B
    A.evaluate("""(cid) => { const e = {id: "zzbill1", status: "draft", fileName: "zz.pdf", x: {vendorName: "ZZ Vendor 1", invNo: "ZZ/1", total: 1180}, billNo: "ZZ/1", party: "ZZ Vendor 1", date: "2025-04-05"}; S.data[cid].entries[e.id] = e; Store.saveEntry(cid, e); }""", CID)
    ok(wait_for(B, "S.data['%s'].entries.zzbill1" % CID, 3) is not None, "a bill put in on A is on B")
    A.evaluate("""(cid) => { const e = S.data[cid].entries.zzbill1; e.status = "approved"; e.approvedAt = new Date().toISOString(); Store.saveEntry(cid, e); render(); }""", CID)
    t = wait_for(B, "S.data['%s'].entries.zzbill1.status === 'approved'" % CID, 5)
    ok(t is not None and t < 2, "3. the bill approved on A: approved on B in %.2f s" % (t or 99))
    ok(wait_for(B, "document.body.innerText.includes('bill ZZ/1')", 2) is not None, "and B says who approved it: " + (re.search(r"Updated by [^\n]*bill[^\n]*", B.inner_text("body")) or [""])[0])
    # ---------- 4. a client setting changed on A shows on B
    A.evaluate("() => coCommit('supInvFrom', 'vno')")
    t = wait_for(B, "S.companies['%s'].supInvFrom === 'vno'" % CID, 5)
    ok(t is not None and t < 2, "4. a client setting changed on A (Supplier invoice no. is in: Voucher no.): on B in %.2f s" % (t or 99))
    # ---------- 5. a refresh on B shows the server's state, not B's older copy
    B.close(); A.evaluate("(n) => lmConfirmToggle(n)", LEDS[0]); time.sleep(1)
    ok(not A.evaluate("!!(S.books.map[%s] || {}).ok" % json.dumps(LEDS[0])), "A un-confirms %s while B is closed" % LEDS[0])
    B = ctxB.new_page(); B.on("pageerror", lambda e: errors.append("B2: " + str(e)))
    B.goto("http://localhost:8168/"); B.wait_for_timeout(1500)
    B.evaluate("() => { window.__seen = []; }")
    sign_in(B, "tB")
    B.evaluate("""([cid, n]) => { const o = window.render; window.render = function(){ try { if (S.books && S.books.cid === cid && !S.books.loading) window.__seen.push(!!(S.books.map[n] || {}).ok); } catch (e){} return o.apply(this, arguments); }; }""", [CID, LEDS[0]])
    t0 = time.time(); took = open_client(B)
    seen = B.evaluate("window.__seen")
    ok(took is not None and not B.evaluate("!!(S.books.map[%s] || {}).ok" % json.dumps(LEDS[0])) and True not in seen,
       "5. B refreshed: shows %s as the server has it, never its older copy (%d draws, opened in %.2f s)" % (LEDS[0], len(seen), took or 0))
    # ---------- 6. offline: kept here, said so, sent when back
    ctxB.set_offline(True); OFFLINE.add("tB"); B.evaluate("() => window.dispatchEvent(new Event('offline'))")
    B.evaluate("(n) => lmConfirmToggle(n)", LEDS[0])
    ok(wait_for(B, "document.body.innerText.includes('Offline')", 4) is not None, "6. offline: B says so (" + (re.search(r"Offline[^\n]*", B.inner_text("body")) or [""])[0] + ")")
    time.sleep(1); ok(not A.evaluate("!!(S.books.map[%s] || {}).ok" % json.dumps(LEDS[0])), "nothing reached A while B was offline")
    ctxB.set_offline(False); OFFLINE.discard("tB"); B.evaluate("() => window.dispatchEvent(new Event('online'))")
    t = wait_for(A, "!!(S.books.map[%s] || {}).ok" % json.dumps(LEDS[0]), 8)
    ok(t is not None, "back online: the change made offline reaches A (%.2f s)" % (t or 99))
    # ---------- the time to open, with the stand-in (no network delay): a fresh browser and a second opening
    C = br.new_context(); pc = C.new_page(); pc.on("pageerror", lambda e: errors.append("C: " + str(e)))
    C.route(STAGE + "/**", route); C.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
    pc.goto("http://localhost:8168/"); pc.wait_for_timeout(1500); pc.click('button[data-act="useOffline"]'); pc.wait_for_timeout(500); sign_in(pc, "tA")
    wait_for(pc, "S.companies['%s']" % CID, 5)
    open_client(pc); first = pc.evaluate("S.books.openMs")
    pc.evaluate("() => { S.books = null; S.coId = null; render(); }"); open_client(pc); second = pc.evaluate("S.books.openMs")
    ok(pc.evaluate("!!(S.books.map[%s] || {}).ok" % json.dumps(LEDS[0])), "a fresh browser: the same state")
    print("    opening the client: fresh browser %d ms, second opening %d ms (stand-in server, no network delay)" % (first, second))
    ok(second < 2000, "second opening under 2 seconds (%d ms)" % second)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
