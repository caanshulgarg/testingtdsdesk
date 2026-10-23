"""python3 run_2b_follow_ui.py - a remark in 2B reconciliation and the decision in ITC follow-up are one (the owner,
23-Oct-2026, Leads Insurance: "I have done some vendor to be followed but it was not showing up there"). The 2B
reconciliation kept its remarks (reco2b.tag) and ITC follow-up its decisions (itcTrack.dec) apart, and nothing read one
from the other, so "Follow up with supplier" set in the reconciliation never reached ITC follow-up's "Suppliers to
write to". Now:
  1. "Follow up with supplier" on a bill in Tally only, on a document in 2B only, and "Ask supplier to correct" on a
     mismatch, set in the reconciliation: the line in ITC follow-up is to follow up / to ask the supplier, and its
     supplier is under "Suppliers to write to", even over an older decision made there;
  2. a decision made in ITC follow-up shows as the remark in the reconciliation; the later of the two always wins;
  3. both are kept with the books item by item (client_book_items): after a reload, and on a second computer.
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
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""([tok, uid, firm]) => { Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
      Cloud.st.firm = firm; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-asha", name: "Asha"}, {user_id: "u-rahul", name: "Rahul"}]; startCloudSync2(); }""", [tok, USERS[tok][0], FIRM])
    wait_for(pg, "Live.st === 'live'", 10)
def open_part(pg, part):
    pg.evaluate("""([cid, part, reg]) => { S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = "gst"; S.gstPart = part; S.gstYm = "202604"; S.gstReg = reg; S.r2Scope = "all"; S.r2View = "reco"; S.itctShow = "all";
      if (!S.books || S.books.cid !== cid) S.books = null; render(); }""", [CID, part, REG])
    return wait_for(pg, "S.books && S.books.cid === '%s' && !S.books.loading && document.querySelector(%s)" % (CID, json.dumps("[data-reco]" if part == "r2b" else ".gf-ctl")), 20)
# the line of ITC follow-up for a supplier, and the remark on the reconciliation's row for an invoice number
ITEM = "(ITCT.items(%s).items.find(x => x.supplier && x.supplier.toLowerCase().startsWith(%%s)) || {})" % json.dumps(REG)
def item(pg, who): return pg.evaluate("(() => { const x = " + ITEM % json.dumps(who) + "; return {key: x.key, cat: x.cat, act: x.act, open: x.open}; })()")
def suppliers(pg): return pg.evaluate("ITCT.suppliers(%s, ITCT.items(%s).items).map(s => s.party)" % (json.dumps(REG), json.dumps(REG)))
def reco_row(pg, no): return 'tr[data-reco-row]:has(td.rc-doc .code:text-is("%s"))' % no
def remark(pg, no): return pg.evaluate("(no) => { const r = [...document.querySelectorAll('tr[data-reco-row]')].find(tr => [...tr.querySelectorAll('td.rc-doc .code')].some(c => c.textContent.trim() === no)); const s = r && r.querySelector('select[data-reco-act]'); return s ? s.value : null; }", no)
def choose(pg, sel, v, what):
    try: pg.select_option(sel, v, timeout=3000)
    except Exception: ok(False, "%s: no choice %r there" % (what, v))
    pg.wait_for_timeout(600)
def set_remark(pg, no, v): choose(pg, reco_row(pg, no) + " select[data-reco-act]", v, "the reconciliation's row " + no)
def set_act(pg, key, v): choose(pg, 'tr[data-key=%s] select[aria-label="What to do"]' % json.dumps(key), v, "ITC follow-up's line " + str(key))
with sync_playwright() as p:
    br = p.chromium.launch()
    ctxA, A = computer(br, "tA", "A")
    A.evaluate("""(cid) => { const c = newCompany({name: "ZZ FOLLOW TEST", gstin: %s}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); }""" % json.dumps(CMP), CID)
    ctxB, B = computer(br, "tB", "B")
    ok(wait_for(B, "S.companies['%s']" % CID, 5) is not None, "computer B: the client made on A is there")
    for pg in (A, B): pg.evaluate(SETUP, [CID, VS, TWOB, CMP, REG])
    # ---------- the lines as worked out, before anything is decided
    ok(open_part(A, "follow") is not None, "A: ITC follow-up opens")
    a0, o0, d0 = item(A, "alpha"), item(A, "omega"), item(A, "delta")
    ok(a0["cat"] == "waiting" and o0["cat"] == "tobook" and d0["cat"] == "diff", "the three lines: Alpha in Tally not in 2B, Omega in 2B not in Tally, Delta amounts differ (%s, %s, %s)" % (a0["cat"], o0["cat"], d0["cat"]))
    # an older decision in ITC follow-up: no letter to Alpha, correct Tally for Delta
    set_act(A, a0["key"], "wait"); set_act(A, d0["key"], "books")
    ok(item(A, "alpha")["act"] == "wait" and "Alpha Supplies" not in suppliers(A), "before: Alpha set to wait in ITC follow-up, not among the suppliers to write to")
    time.sleep(1.1)
    # ---------- 1. remarks set in the 2B reconciliation reach ITC follow-up
    ok(open_part(A, "r2b") is not None, "A: the 2B reconciliation opens")
    ok(remark(A, "A/101") == "Expect in next 2B", "2. the decision made in ITC follow-up (wait) shows as the remark in the reconciliation (%s)" % remark(A, "A/101"))
    set_remark(A, "A/101", "Follow up with supplier")
    set_remark(A, "O/5", "Follow up with supplier")
    set_remark(A, "D/9", "Ask supplier to correct")
    ok(remark(A, "A/101") == "Follow up with supplier" and remark(A, "O/5") == "Follow up with supplier" and remark(A, "D/9") == "Ask supplier to correct", "the three remarks set in the reconciliation")
    open_part(A, "follow"); A.wait_for_timeout(800)
    a1, o1, d1 = item(A, "alpha"), item(A, "omega"), item(A, "delta")
    ok(a1["act"] == "follow" and a1["open"], "1. Alpha's bill (in Tally only), Follow up with supplier in 2B reco: in ITC follow-up as Follow up the supplier (%s)" % a1["act"])
    ok(o1["act"] == "supplier" and o1["open"], "Omega's document (in 2B only), Follow up with supplier in 2B reco: in ITC follow-up to ask the supplier (%s)" % o1["act"])
    ok(d1["act"] == "supplier", "Delta's mismatch, Ask supplier to correct in 2B reco: Ask the supplier to amend (%s)" % d1["act"])
    sel = lambda key: A.evaluate("(k) => { const s = document.querySelector('tr[data-key=\"' + k + '\"] select[aria-label=\"What to do\"]'); return s ? s.options[s.selectedIndex].text : null; }", key)
    ok(sel(a1["key"]) == "Follow up the supplier", "the line's What to do reads “Follow up the supplier” (%s)" % sel(a1["key"]))
    sup = suppliers(A)
    ok(all(n in sup for n in ("Alpha Supplies", "OMEGA LOGISTICS", "DELTA SERVICES")), "Suppliers to write to: Alpha, Omega and Delta (%s)" % sup)
    card = A.inner_text("section.dash-card:has(h3:text-is('Suppliers to write to'))")
    ok("Alpha Supplies" in card and "OMEGA LOGISTICS" in card and "DELTA SERVICES" in card, "and on the page, under Suppliers to write to")
    ctxA.grant_permissions(["clipboard-read", "clipboard-write"])
    try: A.click('tr[data-key=%s] button:text-is("copy")' % json.dumps(VO), timeout=3000); A.wait_for_timeout(800); clip = A.evaluate("navigator.clipboard.readText()")
    except Exception: clip = ""
    ok("O/5" in clip, "the letter to Omega names its document O/5")
    # ---------- 2. a decision in ITC follow-up shows in the reconciliation; the later wins
    set_act(A, d1["key"], "accept")
    open_part(A, "r2b"); A.wait_for_timeout(500)
    ok(remark(A, "D/9") == "", "2. Delta set to accept in ITC follow-up: the reconciliation's Ask supplier to correct is taken off (%r)" % remark(A, "D/9"))
    open_part(A, "follow"); set_act(A, d1["key"], "supplier")
    open_part(A, "r2b"); A.wait_for_timeout(500)
    ok(remark(A, "D/9") == "Ask supplier to correct", "and set back to ask the supplier: the remark is back (%s)" % remark(A, "D/9"))
    set_remark(A, "O/5", ""); open_part(A, "follow"); A.wait_for_timeout(500)
    ok(item(A, "omega")["act"] == "book" and "OMEGA LOGISTICS" not in suppliers(A), "the remark cleared in the reconciliation: Omega back to its first choice, off the letters (%s)" % item(A, "omega")["act"])
    set_act(A, item(A, "omega")["key"], "supplier")
    ok(item(A, "omega")["act"] == "supplier", "Omega set to ask the supplier in ITC follow-up")
    # ---------- 3. kept with the books: the server has both, a reload and a second computer show the same
    time.sleep(1.5)
    keys = sorted(set(k[1] for k in DB["items"] if k[0] == CID))
    ok("reco2b" in keys and "itcTrack" in keys, "kept on the server item by item: reco2b and itcTrack (%s)" % [k for k in keys if k in ("reco2b", "itcTrack")])
    open_part(B, "follow"); B.wait_for_timeout(1500)
    b1, bo, bd = item(B, "alpha"), item(B, "omega"), item(B, "delta")
    ok(b1["act"] == "follow" and bo["act"] == "supplier" and bd["act"] == "supplier", "computer B: Alpha to follow up, Omega and Delta to ask the supplier (%s, %s, %s)" % (b1["act"], bo["act"], bd["act"]))
    ok(all(n in suppliers(B) for n in ("Alpha Supplies", "OMEGA LOGISTICS", "DELTA SERVICES")), "computer B: the same suppliers to write to")
    open_part(B, "r2b"); B.wait_for_timeout(800)
    ok(remark(B, "A/101") == "Follow up with supplier" and remark(B, "O/5") == "Ask supplier to correct" and remark(B, "D/9") == "Ask supplier to correct", "computer B: the same remarks in the reconciliation (%s, %s, %s)" % (remark(B, "A/101"), remark(B, "O/5"), remark(B, "D/9")))
    # a change on B reaches A without a reload
    open_part(B, "follow"); set_act(B, b1["key"], "wait")
    t = wait_for(A, "(" + ITEM % json.dumps("alpha") + ").act === 'wait'", 6)
    ok(t is not None, "Alpha set to wait on B: wait on A in %.2f s, no reload" % (t or 99))
    # A reloads: the server's state
    A.close(); A = ctxA.new_page(); A.on("pageerror", lambda e: errors.append("A2: " + str(e))); start(A, "tA")
    open_part(A, "follow"); A.wait_for_timeout(1500)
    ok(item(A, "alpha")["act"] == "wait" and item(A, "omega")["act"] == "supplier" and item(A, "delta")["act"] == "supplier", "A after a reload: the same decisions (%s, %s, %s)" % (item(A, "alpha")["act"], item(A, "omega")["act"], item(A, "delta")["act"]))
    open_part(A, "r2b"); A.wait_for_timeout(800)
    ok(remark(A, "A/101") == "Expect in next 2B", "and the reconciliation's remark for Alpha follows: Expect in next 2B (%s)" % remark(A, "A/101"))
    # a remark kept before this build (only in reco2b.tag, as Leads Insurance's), later than the decision: it decides
    A.evaluate("() => { S.books.reco2b.tag.zza1 = {tag: 'Follow up with supplier', at: new Date(Date.now() + 1000).toISOString()}; }")
    ok(item(A, "alpha")["act"] == "follow" and "Alpha Supplies" in suppliers(A), "a remark made before, only in the reconciliation and later than the decision: the line follows it (%s)" % item(A, "alpha")["act"])
    A.screenshot(path=os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "2b-follow.png"), full_page=False)
    br.close()
srv.shutdown()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); raise SystemExit(1 if fails else 0)
