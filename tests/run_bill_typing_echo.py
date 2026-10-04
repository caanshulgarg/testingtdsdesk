"""python3 run_bill_typing_echo.py - typing on a purchase bill while the firm account is on (owner, 04-Oct-2026): the
invoice number kept the value from before the last keystroke. Each typed field is saved a moment after typing stops
and sent to the server; the server sends the row back to every open computer, this one too. When that copy came back
after one more keystroke, it was taken for a change made elsewhere: the older value replaced the bill here, became the
sync mark, and the full value was never sent. A wrong saved value becomes a wrong entry in Tally.
Now a copy coming in is not laid over a bill with a change here not yet sent (a save waiting, or the bill changed since
it was last sent): what was changed here stays and is sent; what was changed only elsewhere still comes in.
Checked for every typed field (invoice no., date, taxable, total, supplier, GSTIN, narration, party ledger): the box,
the bill in memory and the next push to the server all hold the full value. Also: a change made on another computer,
with nothing pending here, still shows; leaving the page saves a pending bill at once and sends it.
A stand-in for Supabase here (REST and the Realtime socket); its echo of a push is held back and let go after the last
keystroke, as a slow server would. Made-up bill only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bill_typing_echo.py"""
import os, re, json, time, threading, functools, http.server, datetime
from urllib.parse import urlparse, parse_qs, unquote
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8279), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
FIRM = "f0000000-0000-0000-0000-00000000000f"; CID = "zzecho1"
USERS = {"tA": ("u-asha", "Asha"), "tB": ("u-rahul", "Rahul")}
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
# ---------- the stand-in database; the echo of a push can be held back (HOLD) and let go later
DB = {"records": {}, "clients": {}}
SOCKS, HELD, HOLD, UPS = [], [], [False], []     # UPS: every entry row pushed, in order (time, data)
def msg_of(table, rec):
    return json.dumps({"topic": "realtime:fincom-" + FIRM, "event": "postgres_changes", "ref": None,
                       "payload": {"ids": [1], "data": {"schema": "public", "table": table, "type": "UPDATE", "commit_timestamp": now(), "errors": None, "record": rec}}})
def send_all(msg):
    for s in list(SOCKS):
        try: s.send(msg)
        except Exception: SOCKS.remove(s)
def broadcast(table, rec):
    m = msg_of(table, rec)
    if HOLD[0]: HELD.append(m)
    else: send_all(m)
def release():
    HOLD[0] = False
    while HELD: send_all(HELD.pop(0))
def uid_of(req): return USERS.get((req.headers.get("authorization") or "").replace("Bearer ", ""), ("", ""))[0]
def route(r):
    req = r.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    body = json.loads(req.post_data) if req.post_data else None
    if path.endswith("/rest/v1/members"): return j([{"user_id": v[0], "firm_id": FIRM, "name": v[1], "email": v[1].lower() + "@zz.test", "role": "admin", "active": True} for v in USERS.values()])
    if path.endswith("/rest/v1/records") or path.endswith("/rest/v1/clients"):
        table = "records" if path.endswith("/records") else "clients"
        if req.method == "POST":
            me = uid_of(req)
            for x in body:
                rec = dict(x, updated_at=now(), updated_by=me)
                DB[table][(x.get("kind", "client"), x.get("client_id", ""), x["id"])] = rec
                if x.get("kind") == "entry": UPS.append((time.time(), json.loads(json.dumps(x["data"]))))
                broadcast(table, rec)
            return r.fulfill(status=201, body="")
        if req.method == "PATCH":                       # a client's setup merged (cloudPushClient): written as asked
            want = unquote(q.get("id", ["eq."])[0][3:]); out = []
            for k, rec in list(DB[table].items()):
                if k[2] == want: rec = dict(rec, **body, updated_at=now(), updated_by=uid_of(req)); DB[table][k] = rec; out.append(rec); broadcast(table, rec)
            return j(out)
        since = unquote(q.get("updated_at", ["gt.1970"])[0][3:])
        return j(sorted([x for x in DB[table].values() if x["updated_at"] > since], key=lambda x: x["updated_at"])[:200])
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
        pg.wait_for_timeout(50)
    return None
def server_entry(eid):
    rec = DB["records"].get(("entry", CID, eid))
    return (rec or {}).get("data") or {}
# the fields typed, as on the bill: (what, the box, the value typed, where it is kept on the bill)
FIELDS = [
    ("invoice no.", "x:invoiceNo", "ZZ/2026/0417", "x.invoiceNo"),
    ("invoice date", "x:invoiceDate", "09102026", "x.invoiceDate"),
    ("taxable value", "x:taxable", "125000", "x.taxable"),
    ("invoice total", "x:total", "147500", "x.total"),
    ("supplier name", "x:vendorName", "ZZ Echo Traders", "x.vendorName"),
    ("GSTIN", "x:vendorGstin", "09AAACZ9999K1Z5", "x.vendorGstin"),
    ("narration", "e:narration", "Being goods bought on credit", "narration"),
    ("party ledger", "e:partyLedger", "ZZ Echo Traders (Creditor)", "partyLedger"),
]
def get(o, dotted):
    for k in dotted.split("."): o = (o or {}).get(k)
    return o
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1400, "height": 950}, locale="en-US"); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
    pg.goto("http://localhost:8279/"); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""([tok, uid, firm]) => { Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
      Cloud.st.firm = firm; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-asha", name: "Asha"}, {user_id: "u-rahul", name: "Rahul"}]; startCloudSync2(); }""", ["tA", "u-asha", FIRM])
    ok(wait_for(pg, "Live.st === 'live'", 10) is not None, "signed in to the firm account (stand-in), live changes on")
    pg.evaluate("""(cid) => { const c = newCompany({name: "ZZ ECHO TEST", gstin: "09AANFG3202D1ZR"}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); }""", CID)
    pg.evaluate("(cid) => openCompany(cid).then(() => goStep('review', 'bills'))", CID); pg.wait_for_timeout(1200)
    pg.click('#app button:has-text("One at a time")'); pg.wait_for_timeout(600)
    pg.evaluate("doAct('manual')"); pg.wait_for_timeout(800)
    eid = pg.evaluate("S.selected")
    ok(bool(eid) and wait_for(pg, "true", 0.1) is not None, "a new bill typed in, open in the drawer (%s)" % eid)
    ok(wait_for(pg, "Live.sv.state === 'saved'", 5) is not None and server_entry(eid) != {}, "the new bill is on the server")
    here = lambda path: pg.evaluate("(p) => { let o = D().entries[S.selected]; for (const k of p.split('.')) o = (o || {})[k]; return o == null ? '' : String(o); }", path)
    box = lambda fk: pg.locator('#app .detail [data-fk="%s"]' % fk)
    for what, fk, typed, path in FIELDS:
        b = box(fk)
        if not b.count(): ok(False, "%s: the box is on the bill" % what); continue
        kind = b.get_attribute("type")
        full = "2026-09-10" if kind == "date" else typed
        short = "0202-09-10" if kind == "date" else typed[:-1]
        if kind == "date": b.fill(""); b.focus()
        else: b.click(); pg.keyboard.press("Control+A"); pg.keyboard.press("Backspace")
        pg.wait_for_timeout(1300)                        # the emptied box saved, sent and echoed
        HOLD[0] = True
        pg.keyboard.type(typed[:-1], delay=25)
        pg.wait_for_timeout(1400)                        # the save of what is typed so far goes, its echo held by the server
        sent_short = str(get(server_entry(eid), path) or "")
        pg.keyboard.type(typed[-1])                      # one more keystroke ...
        release(); pg.wait_for_timeout(250)              # ... and the server's copy of the earlier save arrives
        n0 = len(UPS)
        pg.wait_for_timeout(1800)                        # the save of the last keystroke and its push
        b = box(fk)
        shown, kept, srv_now = b.input_value(), here(path), str(get(server_entry(eid), path) or "")
        last = str(get(UPS[-1][1], path) or "") if UPS else ""
        print("    %-14s pushed before the last key: %r; box %r, bill %r, server %r, pushes after the echo %d" % (what, sent_short, shown, kept, srv_now, len(UPS) - n0))
        ok(sent_short == short, "%s: the earlier value %r reached the server before the last keystroke (the echo is of it)" % (what, short))
        ok(shown == full, "%s: the box keeps the full value %r after the echo (shows %r)" % (what, full, shown))
        ok(kept == full, "%s: the bill keeps the full value (D().entries[id].%s = %r)" % (what, path, kept))
        ok(srv_now == full and last == full, "%s: the next push to the server holds the full value (server %r, last push %r)" % (what, srv_now, last))
    # a change made on another computer, with nothing pending here: still shows here
    pg.wait_for_timeout(1500)
    pending = pg.evaluate("(id) => typeof pendingEdit === 'function' ? pendingEdit('e' + id) : null", eid)
    rec = json.loads(json.dumps(DB["records"][("entry", CID, eid)])); rec["data"]["x"]["invoiceNo"] = "ZZ/REMOTE/9"; rec["data"]["narration"] = "Changed on Rahul's computer"
    rec.update(updated_at=now(), updated_by="u-rahul"); DB["records"][("entry", CID, eid)] = rec; send_all(msg_of("records", rec))
    t = wait_for(pg, "D().entries[S.selected].x.invoiceNo === 'ZZ/REMOTE/9'", 4); pg.wait_for_timeout(400)
    ok(t is not None and box("x:invoiceNo").input_value() == "ZZ/REMOTE/9" and here("narration") == "Changed on Rahul's computer",
       "a change made on another computer, nothing pending here (pending save: %s): shows in the box and on the bill" % pending)
    pg.wait_for_timeout(1200)
    ok(get(server_entry(eid), "x.invoiceNo") == "ZZ/REMOTE/9", "and it is not sent back over by this computer (server: %r)" % get(server_entry(eid), "x.invoiceNo"))
    # the same bill changed on both at once, different fields: typing the invoice no. here while the narration is changed
    # on another computer (its copy still has the old number): both are kept, here and on the server
    b = box("x:invoiceNo"); b.click(); pg.keyboard.press("Control+A"); pg.keyboard.type("ZZ/BOTH/1", delay=10)
    rec = json.loads(json.dumps(DB["records"][("entry", CID, eid)])); rec["data"]["narration"] = "Narration from Rahul"
    rec.update(updated_at=now(), updated_by="u-rahul"); DB["records"][("entry", CID, eid)] = rec; send_all(msg_of("records", rec))
    pg.wait_for_timeout(300)
    ok(here("x.invoiceNo") == "ZZ/BOTH/1" and here("narration") == "Narration from Rahul" and b.input_value() == "ZZ/BOTH/1",
       "both computers at once, different fields: the number typed here stays, the narration from the other comes in (%r, %r)" % (here("x.invoiceNo"), here("narration")))
    pg.wait_for_timeout(1800)
    se = server_entry(eid)
    ok(get(se, "x.invoiceNo") == "ZZ/BOTH/1" and get(se, "narration") == "Narration from Rahul", "and the server ends with both (%r, %r)" % (get(se, "x.invoiceNo"), get(se, "narration")))
    # leaving the page with a save waiting: saved here at once and sent
    pg.evaluate("() => { window.__puts = []; const o = Store.put.bind(Store); Store.put = (path, obj) => { window.__puts.push([path, obj ? JSON.stringify(obj) : null]); return o(path, obj); }; }")
    b = box("e:narration"); b.click(); pg.keyboard.press("End"); pg.keyboard.type(" (left)", delay=10)
    n0 = len(UPS)
    pg.evaluate("() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: false}))")
    saved = pg.evaluate("(id) => window.__puts.filter(x => x[0].endsWith('/entries/' + id) && x[1] && JSON.parse(x[1]).narration.endsWith('(left)')).length", eid)
    ok(saved >= 1, "leaving the page: the bill waiting to be saved is saved here at once (%d saves)" % saved)
    pg.wait_for_timeout(350)                            # less than the 600 ms the save would wait on its own
    ok(any(str(d.get("narration", "")).endswith("(left)") for _, d in UPS[n0:]), "and sent to the server straight away (%d pushes within 350 ms)" % (len(UPS) - n0))
    # the tab hidden (another tab, the computer locked): the same
    b.click(); pg.keyboard.press("End"); pg.keyboard.type(" (hid)", delay=10)
    pg.evaluate("() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); }")
    saved = pg.evaluate("(id) => window.__puts.filter(x => x[0].endsWith('/entries/' + id) && x[1] && JSON.parse(x[1]).narration.endsWith('(hid)')).length", eid)
    pg.evaluate("() => { delete document.visibilityState; }")
    ok(saved >= 1, "the tab hidden: the waiting save is made at once (%d saves)" % saved)
    pg.wait_for_timeout(1500)
    ok(str(get(server_entry(eid), "narration")).endswith("(hid)"), "and it reaches the server (%r)" % get(server_entry(eid), "narration"))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
