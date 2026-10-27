"""python3 run_pages_live.py - (07-Oct-2026, next release, branch next-realtime; migration 64) Look up, the ledgers and
Sync activity refresh by themselves. Two computers (A and B) open on the same client; a stand-in for Supabase here (REST and
the Realtime socket, as run_live_sync.py), shared by both; FinCom's copy changes as the bridge's lines and day reads change
it, and the database's tally_book_changes row for the book is sent on the firm's channel (realtime:fincom-copy-<firm>):
  1. B on Look up, a ledger answered from FinCom's copy: an entry the bridge brings in shows on B within 4 s, no click, no
     page reload;
  2. A on the ledgers: a ledger the bridge brings in is in A's list within 4 s;
  3. A locks a month (the tie-out): B's tie-out shows it locked within 4 s (before: after a minute); the gap on Sync
     activity (tally_sync_cursor) the same;
  4. a burst of 300 changes in a second: B asks the copy at most twice (debounced: 1.5 s quiet, 6 s at most), never reloads;
  5. a change for another client (not on screen): nothing is read;
  6. a database without tally_book_changes (before 64): the channel is not joined, nothing breaks.
Made-up books only. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_pages_live.py
RED: on a build without the change, 1-4 fail (nothing comes until a refresh or the minute's look)."""
import os, re, json, time, threading, functools, http.server, itertools, datetime
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8169), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
FIRM = "f0000000-0000-0000-0000-00000000064f"; CID = "zzpages1"; OTHER = "zzpages2"; BOOK = "b0000000-0000-0000-0000-000000000064"
USERS = {"tA": ("u-asha", "Asha"), "tB": ("u-rahul", "Rahul"), "tC": ("u-chitra", "Chitra")}
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
# ---------- FinCom's copy (made up) and Sync activity's rows
COPY = {"ledgers": [{"name": "Cash", "parent": "Cash-in-Hand", "open": -1000}, {"name": "Sales", "parent": "Sales Accounts", "open": 0}],
        "lines": {"Cash": [["20260501", "Receipt", "1", "ZZ Customer", "", -500, "g1"]]}}
LOCKS, CURSOR = [], []
CALLS = {}           # (token, what) -> count
NO64 = set()         # tokens whose database has no tally_book_changes (before 64)
SOCKS = []           # [ws, set(topics joined)]
def hit(tok, what): CALLS[(tok, what)] = CALLS.get((tok, what), 0) + 1
def calls(tok, what): return CALLS.get((tok, what), 0)
def send_change(table, rec, kind="UPDATE"):
    topic = "realtime:fincom-copy-" + FIRM
    msg = json.dumps({"topic": topic, "event": "postgres_changes", "ref": None,
                      "payload": {"ids": [1], "data": {"schema": "public", "table": table, "type": kind, "commit_timestamp": now(), "errors": None, "record": rec}}})
    for s in list(SOCKS):
        if topic in s[1]:
            try: s[0].send(msg)
            except Exception: SOCKS.remove(s)
def book_changed(cid, tables): send_change("tally_book_changes", {"book_id": BOOK, "firm_id": FIRM, "client_id": cid, "changed_at": now(), "tables": tables, "n": 1})
def route(r):
    req = r.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    tok = (req.headers.get("authorization") or "").replace("Bearer ", "")
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    body = json.loads(req.post_data) if req.post_data else {}
    if path.endswith("/rest/v1/members"): return j([{"user_id": v[0], "firm_id": FIRM, "name": v[1], "email": v[1].lower() + "@zz.test", "role": "owner", "active": True} for v in USERS.values()])
    if path.endswith("/rest/v1/rpc/tally_status"):
        hit(tok, "status")
        if body.get("p_client") != CID: return j([])
        return j([{"from": "2026-04-01", "to": "2027-03-31", "book": BOOK, "company": "ZZ PAGES CO", "entries": 10, "ledgersAt": now(), "state": {"readAt": now()}}])
    if path.endswith("/rest/v1/rpc/tally_ledger"):
        hit(tok, "ledger")
        led = body.get("p_ledger")
        return j({"open": next((l["open"] for l in COPY["ledgers"] if l["name"] == led), 0), "lines": COPY["lines"].get(led, []), "company": "ZZ PAGES CO", "from": "2026-04-01", "to": "2027-03-31"})
    if path.endswith("/rest/v1/rpc/tally_month_lock"):
        row = {"firm_id": FIRM, "client_id": body["p_client"], "month": body["p_month"], "locked_at": now(), "locked_by": USERS.get(tok, ("", ""))[0], "note": body.get("p_note", ""), "unlocked_at": None}
        LOCKS.append(row); send_change("tally_month_locks", row, "INSERT")
        return j({"ok": True, "locked": 1})
    if path.endswith("/rest/v1/tally_book_changes"):
        return j({"message": "relation \"public.tally_book_changes\" does not exist", "code": "42P01"}, 404) if tok in NO64 else j([])
    if path.endswith("/rest/v1/tally_ledgers"):
        hit(tok, "ledgers")
        return j([] if "deleted_at=not.is.null" in u.query else [{"name": l["name"], "parent": l["parent"], "open": l["open"]} for l in COPY["ledgers"]])
    if path.endswith("/rest/v1/tally_month_locks"): hit(tok, "locks"); return j([l for l in LOCKS if "client_id=eq." + l["client_id"] in u.query])
    if path.endswith("/rest/v1/tally_tieouts"): return j([])
    if path.endswith("/rest/v1/tally_sync_cursor"): hit(tok, "cursor"); return j(CURSOR)
    if path.endswith("/rest/v1/tally_books"): return j([{"book_id": BOOK, "client_id": CID, "company": "ZZ PAGES CO"}])
    if "/rest/v1/rpc/" in path: return j([])
    if "/functions/v1/" in path: return j({})
    return j([])
def ws_route(ws):
    me = [ws, set()]; SOCKS.append(me)
    def on_msg(m):
        try: x = json.loads(m)
        except Exception: return
        if x.get("event") == "phx_join":
            me[1].add(x["topic"])
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
def computer(br, tok, name):
    ctx = br.new_context(viewport={"width": 1300, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(name + ": " + str(e)))
    ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
    pg.goto("http://localhost:8169/"); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""([tok, uid, firm]) => { Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
      Cloud.st.firm = firm; Cloud.st.state = "ok"; Cloud.st.members = []; S.account = {me: {role: "owner"}}; startCloudSync2(); window.__mark = "same page"; }""", [tok, USERS[tok][0], FIRM])
    wait_for(pg, "Live.st === 'live'", 10)
    # the client and its books (the copy is FinCom's; nothing read here)
    pg.evaluate("""([cid, other]) => { for (const [id, nm] of [[cid, "ZZ PAGES CO"], [other, "ZZ OTHER CO"]]){ const c = newCompany({name: nm, gstin: ""}); c.id = id; c.tallyName = nm; S.companies[id] = c; S.data[id] = {parties: {}, entries: {}, loaded: true}; }
      S.coId = cid; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = {cid, loading: false, challans: [], alloc: {}, vouchers: [], meta: {}, groups: {}, under: {}}; render(); }""", [CID, OTHER])
    return ctx, pg
with sync_playwright() as p:
    br = p.chromium.launch()
    ctxA, A = computer(br, "tA", "A"); ctxB, B = computer(br, "tB", "B")
    ok(A.evaluate("Live.st") == "live" and B.evaluate("Live.st") == "live", "A and B: connected to the server's live changes")
    ok(wait_for(B, "Live.copyLive === true", 6) is not None and wait_for(A, "Live.copyLive === true", 6) is not None, "A and B: joined the copy's channel (realtime:fincom-copy-<firm>)")
    # ---------- 1. B on Look up: Cash from FinCom's copy
    B.evaluate("""async () => { S.booksTab = "lookup"; const x = LK.st(); Object.assign(x, {kind: "ledger", led: "Cash", from: "20260401", to: "20270331", src: ""}); await TCloud.status(S.coId, true); await LK.run("tally"); render(); }""")
    ok(B.evaluate("S.lk.res && S.lk.res.src === 'cloud' && S.lk.res.rows.length === 1"), "B: Look up answers Cash from FinCom's copy (1 entry)")
    n0 = calls("tB", "ledger")
    COPY["lines"]["Cash"].append(["20260510", "Receipt", "2", "ZZ New Customer", "", -700, "g2"])     # the bridge's line applied in the cloud
    book_changed(CID, ["tally_vouchers", "tally_lines", "tally_ledger_day"])
    t = wait_for(B, "S.lk.res && S.lk.res.rows.length === 2", 6)
    ok(t is not None and t < 4, "1. the entry the bridge brought in shows on B's Look up in %.2f s, no click" % (t or 99))
    ok(wait_for(B, "document.body.innerText.includes('ZZ New Customer')", 3) is not None, "1. and it is on B's screen")
    ok(B.evaluate("window.__mark") == "same page", "1. no page reload")
    ok(calls("tB", "ledger") - n0 == 1 and calls("tA", "ledger") == 0, "1. B asked the copy once; A (not on Look up) not at all (%d, %d)" % (calls("tB", "ledger") - n0, calls("tA", "ledger")))
    # ---------- 2. A on the ledgers
    A.evaluate("""async () => { S.booksTab = "ledgers"; await Ledgers.load(S.coId); render(); }""")
    ok(A.evaluate("Ledgers.list(S.coId).map(l => l.name).join(',')") == "Cash,Sales", "A: the ledgers from FinCom's copy (%s)" % A.evaluate("Ledgers.list(S.coId).map(l => l.name).join(',')"))
    COPY["ledgers"].append({"name": "ZZ New Party", "parent": "Sundry Debtors", "open": 0})
    book_changed(CID, ["tally_ledgers"])
    t = wait_for(A, "Ledgers.list(S.coId).some(l => l.name === 'ZZ New Party')", 6)
    ok(t is not None and t < 4, "2. the ledger the bridge brought in is in A's list in %.2f s, no click" % (t or 99))
    ok(A.evaluate("window.__mark") == "same page", "2. no page reload")
    # ---------- 3. two computers: A locks a month; B's tie-out and Sync activity follow
    B.evaluate("async (cid) => { await Rec.tieLoad(cid); await Rec.gapsLoad(); }", CID)
    ok(B.evaluate("Object.keys(Rec.tie['%s'].locks).length" % CID) == 0, "before: no month locked on B")
    A.evaluate("async (cid) => { await Rec.lockCall(cid, '2026-05-01', 'tally_month_lock', {p_client: cid, p_month: '2026-05-01', p_note: 'audited'}); }", CID)
    t = wait_for(B, "!!Rec.tie['%s'].locks['2026-05-01']" % CID, 6)
    ok(t is not None and t < 4, "3. A locked May 2026: locked on B's tie-out in %.2f s (before: the minute's look)" % (t or 99))
    CURSOR.append({"book_id": BOOK, "gap": {"missing": 3, "missingMax": 3, "words": "up to 3 changes not received"}, "gap_at": now(), "last_match_at": now()})
    send_change("tally_sync_cursor", {"book_id": BOOK, "firm_id": FIRM, "gap": CURSOR[0]["gap"]})
    t = wait_for(B, "(Rec.gaps.byClient['%s'] || []).length === 1" % CID, 6)
    ok(t is not None and t < 4, "3. the gap on Sync activity on B in %.2f s" % (t or 99))
    # ---------- 4. a burst: 300 changes in a second
    n0, r0 = calls("tB", "ledger"), B.evaluate("CopyLive.runs")
    for i in range(300):
        book_changed(CID, ["tally_lines"])
        if i % 30 == 0: time.sleep(0.1)
    B.wait_for_timeout(9000)
    asked, runs = calls("tB", "ledger") - n0, B.evaluate("CopyLive.runs") - r0
    ok(1 <= asked <= 2 and 1 <= runs <= 2, "4. 300 changes in a second: B asked the copy %d time(s), %d refresh(es) (at most 2)" % (asked, runs))
    ok(B.evaluate("window.__mark") == "same page" and B.evaluate("S.lk.res && S.lk.res.rows.length") == 2, "4. no page reload; the answer still there")
    # ---------- 5. another client's change: nothing read
    n0, s0 = calls("tB", "ledger") + calls("tA", "ledgers"), calls("tB", "status")
    book_changed(OTHER, ["tally_lines", "tally_ledgers"])
    B.wait_for_timeout(3000)
    ok(calls("tB", "ledger") + calls("tA", "ledgers") == n0 and calls("tB", "status") == s0, "5. a change of a client not on screen: nothing read")
    # ---------- 6. a database before 64
    NO64.add("tC")
    ctxC, C = computer(br, "tC", "C")
    C.wait_for_timeout(1500)
    ok(C.evaluate("Live.st") == "live" and C.evaluate("Live.copyTopic") in ("", None) and not C.evaluate("!!Live.copyLive"), "6. without tally_book_changes: live as before, the copy's channel not joined")
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
