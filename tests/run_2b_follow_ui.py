"""python3 run_2b_follow_ui.py - the follow-up is part of the 2B reconciliation, and its decisions are kept in one store
(the owner, 23-Oct-2026, Leads Insurance: "I have done some vendor to be followed but it was not showing up there"; then
next-itc-simple, 24-Oct-2026: no separate ITC follow-up, "in 2B reconciliation there should be follow-up also"):
  1. "Follow up with supplier" on a bill in Tally only, on a document in 2B only, and "Ask supplier to correct" on a
     mismatch, chosen on the reconciliation's line: kept as the line's Decision (S.books.itcDec, one item each on the
     server) and its supplier is under "Write to suppliers", with the letter;
  2. the decisions made before (a remark in reco2b.tag, ITC follow-up's itcTrack.dec) read as decisions: the latest wins;
  3. kept with the books item by item (client_book_items): after a reload, and on a second computer; a change on one
     reaches the other without a reload.
A stand-in for Supabase here (REST and the Realtime socket), shared by both browsers (as run_live_sync.py). Made-up
books only. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_2b_follow_ui.py"""
import os, re, json, time, threading, functools, http.server, itertools, datetime
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8298), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
FIRM = "f0000000-0000-0000-0000-00000000000f"; CID = "zzfollow1"
USERS = {"tA": ("u-asha", "Asha"), "tB": ("u-rahul", "Rahul")}
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
# ---------- the stand-in database (client_book_items, members, records, clients) and its Realtime socket
seq = itertools.count(1)
DB = {"items": {}, "records": {}, "clients": {}}
SOCKS = []
def broadcast(table, rec):
    msg = json.dumps({"topic": "realtime:fincom-" + FIRM, "event": "postgres_changes", "ref": None,
                      "payload": {"ids": [1], "data": {"schema": "public", "table": table, "type": "UPDATE", "commit_timestamp": now(), "errors": None, "record": rec}}})
    for s in list(SOCKS):
        try: s.send(msg)
        except Exception: SOCKS.remove(s)
def route(r):
    req = r.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    body = json.loads(req.post_data) if req.post_data else None
    me = USERS.get((req.headers.get("authorization") or "").replace("Bearer ", ""), ("", ""))[0]
    if path.endswith("/rest/v1/members"): return j([{"user_id": v[0], "firm_id": FIRM, "name": v[1], "email": v[1].lower() + "@zz.test", "role": "staff", "active": True} for v in USERS.values()])
    if path.endswith("/rest/v1/client_book_items"):
        cid = q["client_id"][0][3:]; after = int(q.get("seq", ["gt.0"])[0][3:])
        return j(sorted([x for x in DB["items"].values() if x["client_id"] == cid and x["seq"] > after], key=lambda x: x["seq"])[:1000])
    if path.endswith("/rest/v1/rpc/save_book_items"):
        out = []
        for x in body["p_items"]:
            rec = {"firm_id": FIRM, "client_id": body["p_client"], "key": x["k"], "item": x.get("i", ""), "ord": x.get("o"), "data": None if x.get("del") else x.get("d"),
                   "deleted": bool(x.get("del")), "seq": next(seq), "updated_at": now(), "updated_by": me}
            DB["items"][(rec["client_id"], rec["key"], rec["item"])] = rec; out.append({"k": rec["key"], "i": rec["item"], "seq": rec["seq"]})
        for x in out: broadcast("client_book_items", DB["items"][(body["p_client"], x["k"], x["i"])])
        return j({"ok": True, "items": out, "at": now()})
    if path.endswith("/rest/v1/client_books"): return j([])
    if path.endswith("/rest/v1/records") or path.endswith("/rest/v1/clients"):
        table = "records" if path.endswith("/records") else "clients"
        if req.method == "POST":
            for x in body:
                rec = dict(x, updated_at=now(), updated_by=me); DB[table][(x.get("kind", "client"), x.get("client_id", ""), x["id"])] = rec; broadcast(table, rec)
            return r.fulfill(status=201, body="")
        return j(sorted(DB[table].values(), key=lambda x: x["updated_at"])[:200])
    if "/rest/v1/rpc/" in path: return j([])
    if "/functions/v1/" in path: return j({})
    return j([])
def ws_route(ws):
    SOCKS.append(ws)
    def on_msg(m):
        try: x = json.loads(m)
        except Exception: return
        if x.get("event") == "phx_join": ws.send(json.dumps({"topic": x["topic"], "event": "phx_reply", "ref": x["ref"], "payload": {"status": "ok", "response": {"postgres_changes": [{"id": 1}]}}}))
        elif x.get("event") == "heartbeat": ws.send(json.dumps({"topic": "phoenix", "event": "phx_reply", "ref": x["ref"], "payload": {"status": "ok", "response": {}}}))
    ws.on_message(on_msg)
def wait_for(pg, js, t=10):
    s = time.time()
    while time.time() - s < t:
        try:
            if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
        except Exception: pass
        time.sleep(0.05)
    return None
# ---------- made-up books: April 2026, registration 09; Tally's sign, debit negative
CMP = "09AAACZ1234A1Z5"; REG = "09"
VA, VB, VD, VO = "09AABCA1111A1Z1", "09AABCB2222B1Z2", "09AABCD5555E1Z6", "09AABCO4444D1Z4"
def V(id, date, no, party, gstin, taxable, tax):
    return {"id": id, "type": "Purchase", "date": date, "no": no, "party": party, "gstin": gstin, "pos": "", "cmp": CMP, "narr": "", "hsn": [], "cancel": False, "opt": False,
            "ent": [{"l": "Office Expenses", "a": -taxable}, {"l": "Input CGST", "a": -tax / 2}, {"l": "Input SGST", "a": -tax / 2}, {"l": party, "a": taxable + tax}]}
VS = [V("zza1", "20260405", "A/101", "Alpha Supplies", VA, 10000, 1800),      # in Tally, not in 2B
      V("zzb1", "20260410", "B/7", "Beta Traders", VB, 20000, 3600),          # in both, the same
      V("zzd1", "20260412", "D/9", "Delta Services", VD, 30000, 5400)]        # in both, 2B differs
def row(gstin, party, no, date, taxable, tax):
    return {"no": no, "noN": re.sub(r"[^A-Z0-9]", "", no.upper()), "ym": "202604", "dir": 1, "ims": "N", "key": "042026|b2b|" + gstin + "|" + re.sub(r"[^A-Z0-9]", "", no.upper()) + "|" + date + "|0",
            "pos": REG, "rcm": False, "sec": "b2b", "typ": "R", "val": taxable + tax, "cess": 0, "cgst": tax / 2, "sgst": tax / 2, "igst": 0, "date": date, "gstin": gstin, "party": party, "itcavl": "Y", "taxable": taxable}
TWOB = {CMP + "|042026": {"ym": "202604", "gstin": CMP, "period": "042026", "rows": [
    row(VB, "BETA TRADERS", "B/7", "20260410", 20000, 3600),
    row(VD, "DELTA SERVICES", "D/9", "20260412", 30000, 4500),
    row(VO, "OMEGA LOGISTICS", "O/5", "20260415", 5000, 900)]}}          # in 2B, not in Tally
SETUP = """async ([cid, vs, twoBs, cmp, reg]) => {
  const b = {cid, vouchers: vs, meta: {from: "20260401", to: "20260430", gstins: [cmp], bills: 1}, challans: [], alloc: {}, pans: {}, certs: [], gstins: {}, states: {}, twoBs,
    under: {"Alpha Supplies": "Sundry Creditors", "Beta Traders": "Sundry Creditors", "Delta Services": "Sundry Creditors"}, groups: {"Sundry Creditors": "Current Liabilities"}};
  b.map = Books.mapLedgers(vs, {});
  ["CGST", "SGST"].forEach(t => { b.map["Input " + t] = Object.assign(b.map["Input " + t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "input", reg, ok: true, byHand: true}); });
  await Books.save(cid, b); }"""
def computer(br, tok, name):
    ctx = br.new_context(viewport={"width": 1400, "height": 950}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(name + ": " + str(e)))
    ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
    start(pg, tok); return ctx, pg
def start(pg, tok):
    pg.goto("http://localhost:8298/"); pg.wait_for_timeout(2000)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate("""([tok, uid, firm]) => { Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
      Cloud.st.firm = firm; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-asha", name: "Asha"}, {user_id: "u-rahul", name: "Rahul"}]; startCloudSync2(); }""", [tok, USERS[tok][0], FIRM])
    wait_for(pg, "Live.st === 'live'", 10)
def open_part(pg, part):
    pg.evaluate("""([cid, part, reg]) => { S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = "gst"; S.gstPart = part; S.gstYm = "202604"; S.gstReg = reg; S.gstView = "return";
      if (!S.books || S.books.cid !== cid) S.books = null; render(); }""", [CID, part, REG])
    return wait_for(pg, "S.books && S.books.cid === '%s' && !S.books.loading && document.querySelector('[data-itc-reco]')" % CID, 20)
def row(no): return 'tr[data-ic-row]:has(.code:text-is("%s"))' % no
def dec(pg, no): return pg.evaluate("(no) => { const r = [...document.querySelectorAll('tr[data-ic-row]')].find(tr => [...tr.querySelectorAll('.code')].some(c => c.textContent.trim() === no)); const s = r && r.querySelector('select[data-ic-dec]'); return s ? s.value : null; }", no)
def line(pg, no): return pg.evaluate("(no) => { const r = ITCF.rows('%s').find(x => x.no === no || x.bookNo === no); return r ? {code: r.e.code, auto: !!r.e.auto, src: (r.s || {}).src || ''} : null; }" % REG, no)
def letters(pg): return pg.evaluate("ITCF.letters('%s', ITCF.month('%s', '202604').rows).map(s => s.party)" % (REG, REG))
def choose(pg, no, v):
    try: pg.select_option(row(no) + " select[data-ic-dec]", v, timeout=4000)
    except Exception: ok(False, "the line %s: no choice %r there" % (no, v))
    pg.wait_for_timeout(600)
with sync_playwright() as p:
    br = p.chromium.launch()
    ctxA, A = computer(br, "tA", "A")
    A.evaluate("""(cid) => { const c = newCompany({name: "ZZ FOLLOW TEST", gstin: %s}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); }""" % json.dumps(CMP), CID)
    ctxB, B = computer(br, "tB", "B")
    ok(wait_for(B, "S.companies['%s']" % CID, 5) is not None, "computer B: the client made on A is there")
    for pg in (A, B): pg.evaluate(SETUP, [CID, VS, TWOB, CMP, REG])
    # ---------- the lines as worked out, before anything is decided
    ok(open_part(A, "r2b") is not None, "A: 2B reconciliation opens")
    ok(dec(A, "A/101") == "follow" and dec(A, "O/5") == "book" and dec(A, "D/9") == "now", "FinCom's rule: Alpha (in Tally only) Follow up, Omega (2B only) Book in Tally, Delta (differs) Take now")
    ok("Alpha Supplies" in letters(A), "Alpha (followed up by the rule) is among the suppliers to write to")
    # ---------- 1. decisions on the reconciliation's lines
    choose(A, "A/101", "reverse"); choose(A, "O/5", "follow"); choose(A, "D/9", "correct")
    ok(dec(A, "A/101") == "reverse" and dec(A, "O/5") == "follow" and dec(A, "D/9") == "correct", "1. the decisions set on the lines")
    sup = letters(A)
    ok("Alpha Supplies" not in sup and "OMEGA LOGISTICS" in sup and "DELTA SERVICES" in sup, "Write to suppliers: Omega and Delta, not Alpha (%s)" % sup)
    A.click("[data-ic-letters]"); A.wait_for_timeout(600)
    ctxA.grant_permissions(["clipboard-read", "clipboard-write"])
    try: A.click('[data-letter-copy=%s]' % json.dumps(VO), timeout=3000); A.wait_for_timeout(800); clip = A.evaluate("navigator.clipboard.readText()")
    except Exception: clip = ""
    ok("O/5" in clip, "the letter to Omega names its document O/5")
    A.keyboard.press("Escape"); A.wait_for_timeout(400)
    # ---------- 2. an old remark and an old follow-up decision
    A.evaluate("() => { S.books.reco2b = S.books.reco2b || {}; S.books.reco2b.tag = Object.assign({}, S.books.reco2b.tag, {zza1: {tag: 'Follow up with supplier', at: new Date(Date.now() + 60000).toISOString()}}); render(); }"); A.wait_for_timeout(500)
    ok(line(A, "A/101")["code"] == "follow" and line(A, "A/101")["src"] == "remark", "2. a remark kept before (reco2b.tag), later than the decision: the line follows it (%s)" % line(A, "A/101"))
    A.evaluate("() => { S.books.reco2b.tag = {}; render(); }")
    choose(A, "A/101", "follow")
    time.sleep(1.5)
    # ---------- 3. kept with the books: the server, a second computer, a reload
    keys = sorted(set(k[1] for k in DB["items"] if k[0] == CID))
    items = [k[2] for k in DB["items"] if k[0] == CID and k[1] == "itcDec" and k[2]]
    ok("itcDec" in keys and len(items) >= 3, "kept on the server item by item: itcDec, one item a line (%d)" % len(items))
    ok(open_part(B, "r2b") is not None, "B: 2B reconciliation opens"); B.wait_for_timeout(1500)
    ok(dec(B, "A/101") == "follow" and dec(B, "O/5") == "follow" and dec(B, "D/9") == "correct", "computer B: the same decisions (%s, %s, %s)" % (dec(B, "A/101"), dec(B, "O/5"), dec(B, "D/9")))
    ok(all(n in letters(B) for n in ("Alpha Supplies", "OMEGA LOGISTICS", "DELTA SERVICES")), "computer B: the same suppliers to write to")
    choose(B, "A/101", "later")
    t = wait_for(A, "(ITCF.rows('%s').find(x => x.bookNo === 'A/101') || {e: {}}).e.code === 'later'" % REG, 6)
    ok(t is not None, "Alpha set to a later month on B: on A in %.2f s, no reload" % (t or 99))
    A.close(); A = ctxA.new_page(); A.on("pageerror", lambda e: errors.append("A2: " + str(e))); start(A, "tA")
    open_part(A, "r2b"); A.wait_for_timeout(1500)
    ok(dec(A, "A/101") == "later" and dec(A, "O/5") == "follow" and dec(A, "D/9") == "correct", "A after a reload: the same decisions (%s, %s, %s)" % (dec(A, "A/101"), dec(A, "O/5"), dec(A, "D/9")))
    A.screenshot(path=os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "2b-follow.png"), full_page=False)
    br.close()
srv.shutdown()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); raise SystemExit(1 if fails else 0)
