"""python3 run_ledcheck_saved.py - the ledger check's state is kept with the books (b.ledCheck in BOOKS_KEYS), on the
owner's conditions of 08-Oct-2026:
  a) the saved suggestions are kept as "pending" and count in NO figure until confirmed: a reload alone never changes a
     return;
  b) books with unconfirmed suggestions are opened again (saved, then read back as on opening the client): EVERY return
     figure - GSTR-1 (each month and registration), GSTR-3B (ITC, net tax), the inward supplies (ITC), the TDS rows
     (26Q, 27Q, 27EQ), and the ledger page's counts - is the same before and after. Done twice: before anything is
     confirmed, and after some answers are confirmed through the check (its "only confirmed ledgers count" switch on).
     The comparison is shown to catch a change: the pending suggestions taken as confirmed DO change the figures;
  c) once confirmed, an answer stays confirmed after the reload, with who confirmed it and when (IST) on the page; a
     second computer (a stand-in for FinCom's server, shared by two browsers, as run_live_sync.py) sees the same;
  d) no database change: the check rides the generic client_book_items sync (key "ledCheck"), checked here.
Made-up client: tests/ledpage_setup.py (fixture books and masters).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledcheck_saved.py
RED before: b.ledCheck is not in BOOKS_KEYS, so the reload drops it (and the "only confirmed count" switch with it)."""
import os, re, sys, json, time, itertools, datetime
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# every figure a return is made from, as plain data
FIGS = """() => { const b = S.books, out = {}, r2_ = x => Math.round((x || 0) * 100) / 100;
  if (typeof GSTR === "object"){ GSTR._carry = null; } if (typeof GST2B === "object") GST2B._memo = null; if (typeof LedCheck === "object") LedCheck._held = null;
  const months = GSTR.months(), regs = [""].concat((GSTR.gstins(b) || []).map(g => g.slice(0, 2)));
  const sum = s => ({taxable: r2_(s.taxable), igst: r2_(s.igst), cgst: r2_(s.cgst), sgst: r2_(s.sgst), cess: r2_(s.cess)});
  out.gstr1 = {}; out.gstr3b = {}; out.itc = {};
  months.forEach(m => regs.forEach(r => { const k = m + "|" + r, o = GSTR.one(m, r);
    out.gstr1[k] = ["b2b", "b2cl", "b2c", "cdnr", "nil"].map(t => sum(GSTR.sum(o[t] || [])));
    const t = GSTR.threeB(m, r); out.gstr3b[k] = {itc: t.itc, netItc: t.netItc, net: t.net};
    out.itc[k] = sum(GSTR.sum(GSTR.inward(m, r) || [])); }));
  const tds = rows => rows.map(x => [x.section, x.party || x.name || "", r2_(x.amount), r2_(x.tds), x.date || "", x.pan || ""]).sort((a, c) => JSON.stringify(a).localeCompare(JSON.stringify(c)));
  out.q26 = tds(TDS.rows()); out.q27 = tds(TDS.nrRows()); out.q27e = tds(TDS.tcsRows());
  const rows = LedPage.rows(b);
  out.page = {pending: LedMaster.pending(b).length, gst: rows.filter(r => !r.ok && !r.unclear && r.kind === "gst").length, tds: rows.filter(r => !r.ok && !r.unclear && r.kind === "tds").length,
    unclear: rows.filter(r => !r.ok && r.unclear).length, confirmed: rows.filter(r => r.ok).length};
  return JSON.parse(JSON.stringify(out)); }"""
# opened again: saved, the books dropped, read back as on opening the client (openBooks)
RELOAD = """async () => { const cid = S.books.cid; await saveBooks(); S.books = null; await openBooks(cid);
  for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise(r => setTimeout(r, 50)); render(); return !!S.books && !S.books.loading; }"""
def diff(a, b, path=""):
    if type(a) != type(b): return [path]
    if isinstance(a, dict): return [x for k in sorted(set(a) | set(b)) for x in diff(a.get(k), b.get(k), path + "/" + k)]
    if isinstance(a, list): return [path + "#len"] if len(a) != len(b) else [x for i in range(len(a)) for x in diff(a[i], b[i], path + "/%d" % i)]
    return [] if a == b else [path]
with sync_playwright() as p:
    srv, br, pg = L.start(p, 8403, SITE, errors=errors)
    E = pg.evaluate
    L.open_page(pg, "owner", cloud=False)
    # the books as read from Tally (for the two computers below), before any check
    BK = E("() => { const b = JSON.parse(JSON.stringify(S.books)); delete b.ledCheck; delete b.loading; return b; }")
    ok("ledCheck" in E("BOOKS_KEYS"), "d) the check is kept with the books (BOOKS_KEYS)")
    # a ledger whose pending suggestion would move the returns: the master has 07 CGST OUTPUT as input (set by hand,
    # not confirmed, as after an undo), the check reads it as output
    E("() => { LedMaster.refresh(S.books); const m = S.books.map['07 CGST OUTPUT']; m.side = 'input'; m.byHand = true; m.ok = false; S.books.mapV = (S.books.mapV || 0) + 1; LedPage.ensure(S.books); }")
    pend = E("() => Object.values(S.books.ledCheck.items).filter(it => it.state === 'pending').length")
    ok(pend > 10 and E("() => Object.values(S.books.ledCheck.items).every(it => it.state === 'pending')"), "a) the suggestions are kept as pending (%d)" % pend)
    # ---------- b) nothing confirmed yet
    f0 = E(FIGS)
    ok(E(RELOAD), "the books opened again")
    f1 = E(FIGS)
    ok(E("!!(S.books.ledCheck && S.books.ledCheck.items && Object.keys(S.books.ledCheck.items).length)"), "a) the suggestions came back with the books")
    d = diff(f0, f1)
    ok(not d, "b) every return figure is the same after the reload (nothing confirmed): %d GSTR-1 / 3B / ITC month-registrations, %d TDS rows%s" % (len(f0["gstr1"]), len(f0["q26"]), (" DIFFERS " + str(d[:5])) if d else ""))
    # the comparison catches pending suggestions that start counting: taken as confirmed, the figures move
    # (on a copy of the books, so nothing here is learnt or saved)
    moved = E("""() => { window.__orig = S.books; const c = JSON.parse(JSON.stringify(S.books)); let k = 0;
      Object.entries(c.ledCheck.items).forEach(([n, it]) => { const m = c.map[n] = c.map[n] || {n: 0}; if (m.ok) return; const p = LedCheck.pick(it);
        LedMaster.applyWhat(m, p.what || "none"); if (LedMaster.isGst(p.what)){ m.tax = p.tax || m.tax; m.side = p.side || m.side; } if (LedMaster.isTds(p.what)) m.section = p.section || ""; m.ok = true; k++; });
      c.mapV = (c.mapV || 0) + 1; S.books = c; return k; }""")
    fx = E(FIGS)
    E("() => { S.books = window.__orig; }")
    ret = [x for x in diff(f0, fx) if not x.startswith("/page")]
    ok(moved > 0 and ret, "b) ... and the returns themselves move (%d GSTR / TDS figures, e.g. %s)" % (len(ret), ret[:3]))
    ok(moved > 0 and diff(f0, fx), "b) the comparison would catch it: the %d pending suggestions taken as confirmed change %d figures, e.g. %s" % (moved, len(diff(f0, fx)), diff(f0, fx)[:3]))
    ok(not diff(f0, E(FIGS)), "(the books as they were)")
    # ---------- c) some answers confirmed through the check (its switch on), the rest pending
    E("() => { S.ledMore = true; render(); }"); pg.wait_for_timeout(300)
    pg.click("#app [data-led-confirm-sure]"); pg.wait_for_timeout(600)
    first = pg.locator("#app [data-led-table] tbody tr:has([data-led-confirm])").first; own = first.get_attribute("data-key")
    first.locator("[data-led-confirm]").click(); pg.wait_for_timeout(400)
    st = E("() => ({strict: !!S.books.ledCheck.strict, conf: Object.values(S.books.ledCheck.items).filter(it => it.state === 'confirmed').length, pend: Object.values(S.books.ledCheck.items).filter(it => it.state === 'pending').length})")
    ok(st["strict"] and st["conf"] > 0 and st["pend"] > 0, "some confirmed, some still pending: %s" % st)
    sure = E("() => Object.keys(S.books.ledCheck.items).filter(n => S.books.ledCheck.items[n].state === 'confirmed')")
    g0 = E(FIGS)
    ok(E(RELOAD), "opened again")
    g1 = E(FIGS)
    d = diff(g0, g1)
    ok(not d, "b) every return figure is the same after the reload (some confirmed, the rest pending)%s" % ((" DIFFERS " + str(d[:5])) if d else ""))
    ok(E("!!S.books.ledCheck.strict"), "c) the check's 'only confirmed ledgers count' switch is kept")
    ok(all(E("(n) => !!(S.books.map[n] || {}).ok && S.books.ledCheck.items[n].state === 'confirmed'", n) for n in sure), "c) the %d confirmed stay confirmed" % len(sure))
    who = E("(n) => [S.books.map[n].okBy || '', S.books.map[n].okAt || '']", own)
    ok(who[0] and who[1], "c) who confirmed %s and when are kept: %s" % (own, who))
    E("() => { S.ledShowDone = true; render(); }"); pg.wait_for_timeout(400)
    line = pg.locator("#app tr[data-key=%s] [data-led-okby]" % json.dumps(own))
    ok(line.count() == 1 and who[0] in line.inner_text() and re.search(r"\d\d-[A-Z][a-z]{2}-\d{4} \d\d:\d\d IST", line.inner_text()) is not None, "c) the page says who and when, in IST: %r" % (line.inner_text() if line.count() else ""))
    br.close(); srv.shutdown()

    # ---------- c) a second computer sees the same (a stand-in for FinCom's server, shared by both browsers)
    STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"; FIRM = "f0000000-0000-0000-0000-00000000000f"
    USERS = {"tA": ("u-asha", "Asha"), "tB": ("u-rahul", "Rahul")}
    seq = itertools.count(1); DB = {"items": {}}; SOCKS = []
    now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    def broadcast(rec):
        msg = json.dumps({"topic": "realtime:fincom-" + FIRM, "event": "postgres_changes", "ref": None, "payload": {"ids": [1], "data": {"schema": "public", "table": "client_book_items", "type": "UPDATE", "commit_timestamp": now(), "errors": None, "record": rec}}})
        for s in list(SOCKS):
            try: s.send(msg)
            except Exception: SOCKS.remove(s)
    def route(r):
        req = r.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
        j = lambda o: r.fulfill(status=200, content_type="application/json", body=json.dumps(o))
        body = json.loads(req.post_data) if req.post_data else None
        me = USERS.get((req.headers.get("authorization") or "").replace("Bearer ", ""), ("", ""))[0]
        if path.endswith("/rest/v1/members"): return j([{"user_id": v[0], "firm_id": FIRM, "name": v[1], "email": v[0] + "@zz.test", "role": "staff", "active": True} for v in USERS.values()])
        if path.endswith("/rest/v1/client_book_items"):
            cid = q["client_id"][0][3:]; after = int(q.get("seq", ["gt.0"])[0][3:])
            return j(sorted([x for x in DB["items"].values() if x["client_id"] == cid and x["seq"] > after], key=lambda x: x["seq"])[:1000])
        if path.endswith("/rest/v1/rpc/save_book_items"):
            out = []
            for x in body["p_items"]:
                rec = {"firm_id": FIRM, "client_id": body["p_client"], "key": x["k"], "item": x.get("i", ""), "ord": x.get("o"), "data": None if x.get("del") else x.get("d"),
                       "deleted": bool(x.get("del")), "seq": next(seq), "updated_at": now(), "updated_by": me}
                DB["items"][(rec["client_id"], rec["key"], rec["item"])] = rec; out.append(rec)
            for rec in out: broadcast(rec)
            return j({"ok": True, "items": [{"k": x["key"], "i": x["item"], "seq": x["seq"]} for x in out], "at": now()})
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
            time.sleep(0.1)
        return None
    import threading, functools, http.server
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("localhost", 8404), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    br = p.chromium.launch()
    def computer(tok, name):
        ctx = br.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(name + ": " + str(e)))
        ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
        pg.goto("http://localhost:8404/"); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate("""([tok, uid, firm]) => { S.firm.firmName = S.firm.firmName || "Test Firm"; Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
          Cloud.st.firm = firm; Cloud.st.email = uid + "@zz.test"; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-asha", name: "Asha"}, {user_id: "u-rahul", name: "Rahul"}]; startCloudSync2(); }""", [tok, USERS[tok][0], FIRM])
        wait_for(pg, "Live.st === 'live'", 10)
        return ctx, pg
    CID = "zzledchk1"
    OPEN = """async ([cid, bk]) => { if (!S.companies[cid]){ const c = newCompany({name: "ZZ Test Client", gstin: "%s"}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; }
      if (bk) await Books.save(cid, bk); S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = "ledgers"; S.books = null; render(); }""" % L.GSTIN if hasattr(L, "GSTIN") else ""
    ctxA, A = computer("tA", "A"); ctxB, B = computer("tB", "B")
    # the client's books from Tally on both computers (as read from Tally there), with their masters: A reads them
    bk = BK
    for pg_ in (A, B):
        pg_.evaluate(OPEN, [CID, dict(bk, cid=CID)]); wait_for(pg_, "S.books && S.books.cid === '%s' && !S.books.loading" % CID, 15)
    pg_ = None
    A.wait_for_timeout(800)
    row = A.locator("#app [data-led-table] tbody tr:has([data-led-confirm])").first; n = row.get_attribute("data-key")
    row.locator("[data-led-confirm]").click()
    t = wait_for(B, "!!(S.books.map[%s] || {}).ok && (S.books.map[%s] || {}).okBy === 'u-asha@zz.test'" % (json.dumps(n), json.dumps(n)), 8)
    ok(t is not None, "c) %s confirmed on A: confirmed on B, by u-asha@zz.test (%.2fs)" % (n, t or 99))
    ok(any(k[1] == "ledCheck" for k in DB["items"]), "d) the check went through the generic book items (key ledCheck): %s" % sorted(set(k[1] for k in DB["items"]))[:12])
    B.evaluate("() => { S.ledShowDone = true; render(); }"); B.wait_for_timeout(500)
    lb = B.locator("#app tr[data-key=%s] [data-led-okby]" % json.dumps(n))
    la = A.locator("#app tr[data-key=%s] [data-led-okby]" % json.dumps(n)) if A.evaluate("() => { S.ledShowDone = true; render(); return 1; }") else None
    A.wait_for_timeout(400)
    ok(lb.count() == 1 and la.count() == 1 and lb.inner_text() == la.inner_text() and "u-asha@zz.test" in lb.inner_text(), "c) B's page says the same who and when as A's: %r" % (lb.inner_text() if lb.count() else ""))
    # B reopens: the server's state
    B.evaluate("() => { S.books = null; render(); }"); wait_for(B, "S.books && S.books.cid === '%s' && !S.books.loading" % CID, 15)
    ok(B.evaluate("(n) => !!S.books.map[n].ok && S.books.map[n].okBy === 'u-asha@zz.test'", n), "c) and after B opens the client again")
    ok(not errors, "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()
print("\n%d FAILED" % len(fails) if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
