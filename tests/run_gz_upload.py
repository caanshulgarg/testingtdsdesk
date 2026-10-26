"""python3 run_gz_upload.py - large saves sent compressed (owner, 26-Oct-2026: "saves faster on slow office connections").
A save of more than 32 KB (a client's bank_meta of ~560 KB, bank_rows parts of 300 lines, a large save_book_items) goes
gzipped to the records-upload function (server/records-upload), which makes the same PostgREST request as the person;
anything smaller goes as before. Checked here, two browsers on one stand-in Supabase (REST, the function, Realtime):
  1. a small save goes plain; the bank's records go gzipped, through the function, as one call; the rows on the server
     are exactly the ones the plain call writes (the same kind, id, client_id, data, deleted), and the other browser
     takes them live: its bank (keys, history, the statement's lines in order) the same as the first one's; nothing is
     sent back from there;
  2. a change on A goes gzipped again and reaches B; a large save_book_items goes gzipped and its answer is the RPC's;
  3. the function missing (404), failing (500), answering something else, or the browser without CompressionStream:
     the save goes plain, the same rows; a missing function is not asked again in that tab for a while;
  4. a refusal by the database (row level security) comes back as the same error as the plain call's, sent once;
  5. sizes and times: the bank's save before/after, and on a connection throttled to 1.5 Mbps up (Chrome's own
     network throttling, the requests going to a local server).
Made-up records only. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gz_upload.py"""
import os, re, json, time, gzip, threading, functools, http.server, itertools, datetime
from urllib.parse import urlparse, parse_qs, unquote
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8427
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
FIRM = "f0000000-0000-0000-0000-00000000000f"; CID = "zzgz1"; SID = "stgz1"
USERS = {"tA": ("u-asha", "Asha"), "tB": ("u-rahul", "Rahul"), "tC": ("u-asha", "Asha")}
ROUTES = {"records?on_conflict=firm_id,kind,id": "resolution=merge-duplicates,return=minimal",
          "clients?on_conflict=firm_id,id": "resolution=merge-duplicates,return=minimal", "rpc/save_book_items": ""}
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
seq = itertools.count(1)
DB = {"items": {}, "records": {}, "clients": {}}
CTRL = {"fn": "on", "rls": set()}      # fn: on | 404 | 500 | other
LOG = []                               # (who, "fn" | "plain", path, bytes on the wire, bytes of JSON)
SOCKS = []
def broadcast(table, rec):
    msg = json.dumps({"topic": "realtime:fincom-" + FIRM, "event": "postgres_changes", "ref": None,
                      "payload": {"ids": [1], "data": {"schema": "public", "table": table, "type": "UPDATE", "commit_timestamp": now(), "errors": None, "record": rec}}})
    for s in list(SOCKS):
        try: s.send(msg)
        except Exception: SOCKS.remove(s)
def tok_of(req): return (req.headers.get("authorization") or "").replace("Bearer ", "")
# the PostgREST writes of the app, as the database does them for the person with this token: (status, body text)
def rest_write(path, tok, body, prefer):
    who = USERS.get(tok)
    if not who: return 401, json.dumps({"code": "PGRST301", "message": "JWT expired"})
    if tok in CTRL["rls"]: return 403, json.dumps({"code": "42501", "message": 'new row violates row-level security policy for table "records"'})
    if path == "rpc/save_book_items":
        out = []
        for x in body["p_items"]:
            s = next(seq); rec = {"firm_id": FIRM, "client_id": body["p_client"], "key": x["k"], "item": x.get("i", ""), "ord": x.get("o"),
                                  "data": None if x.get("del") else x.get("d"), "deleted": bool(x.get("del")), "seq": s, "updated_at": now(), "updated_by": who[0]}
            DB["items"][(rec["client_id"], rec["key"], rec["item"])] = rec; out.append({"k": rec["key"], "i": rec["item"], "seq": s})
        return 200, json.dumps({"ok": True, "items": out, "at": now()})
    table = path.split("?")[0]
    if prefer != "resolution=merge-duplicates,return=minimal": return 400, json.dumps({"message": "unexpected Prefer " + prefer})
    for x in body:
        if x.get("firm_id") != FIRM: return 403, json.dumps({"code": "42501", "message": "row-level security"})
        rec = dict(x, updated_at=now(), updated_by=who[0])
        k = ("client", x["id"], x["id"]) if table == "clients" else (x["kind"], x.get("client_id", ""), x["id"])
        DB[table][k] = rec; broadcast(table, rec)
    return 201, ""
def route(r):
    req = r.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    tok = tok_of(req)
    if path.endswith("/functions/v1/records-upload"):
        raw = req.post_data_buffer or b""
        if CTRL["fn"] == "404": LOG.append((tok, "fn404", "", len(raw), 0)); return j({"code": "NOT_FOUND", "message": "Requested function was not found"}, 404)
        if CTRL["fn"] == "500": LOG.append((tok, "fn500", "", len(raw), 0)); return j({"message": "boom"}, 500)
        if CTRL["fn"] == "other": LOG.append((tok, "fnother", "", len(raw), 0)); return j({})
        # as server/records-upload/handler.ts: only the app's saves, a gzip body, at most 20 MB of JSON, as the person
        p, pref = q.get("path", [""])[0], q.get("prefer", [""])[0]
        if ROUTES.get(p, None) != pref or "gzip" not in (req.headers.get("content-type") or ""): return j({"error": "refused"}, 400)
        text = gzip.decompress(raw)
        if len(text) > 20 * 1024 * 1024: return j({"error": "too large"}, 413)
        LOG.append((tok, "fn", p, len(raw), len(text)))
        st, out = rest_write(p, tok, json.loads(text), pref)
        return j({"fincomUpload": 1, "status": st, "body": out, "range": ""})
    if path.endswith("/rest/v1/members"): return j([{"user_id": v[0], "firm_id": FIRM, "name": v[1], "email": v[1].lower() + "@zz.test", "role": "staff", "active": True} for v in USERS.values()])
    if req.method == "POST" and "/rest/v1/" in path:
        p = path.split("/rest/v1/")[1] + ("?" + u.query if u.query else "")
        if p in ROUTES:
            body = req.post_data or ""
            LOG.append((tok, "plain", p, len(body.encode()), len(body.encode())))
            st, out = rest_write(p, tok, json.loads(body), req.headers.get("prefer") or "")
            return r.fulfill(status=st, content_type="application/json", body=out)
    if path.endswith("/rest/v1/client_book_items"):
        cid = q["client_id"][0][3:]; after = int(q.get("seq", ["gt.0"])[0][3:])
        return j(sorted([x for x in DB["items"].values() if x["client_id"] == cid and x["seq"] > after], key=lambda x: x["seq"])[:1000])
    if path.endswith("/rest/v1/records") or path.endswith("/rest/v1/clients"):
        table = "records" if path.endswith("/records") else "clients"
        if table == "clients" and "id" in q:          # one client's row (cloudPushClient): read, and written on condition
            k = ("client", q["id"][0][3:], q["id"][0][3:]); cur = DB["clients"].get(k)
            if req.method == "GET": return j([cur] if cur else [])
            if req.method == "PATCH":
                if not cur or cur["updated_at"] != unquote(q.get("updated_at", ["eq."])[0][3:]): return j([])
                rec = dict(cur, **json.loads(req.post_data), updated_at=now(), updated_by=USERS[tok][0]); DB["clients"][k] = rec; broadcast("clients", rec)
                return j([rec])
        if req.method == "GET":
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
def computer(br, tok, name, init=None):
    ctx = br.new_context(viewport={"width": 1300, "height": 900}); pg = ctx.new_page()
    if init: pg.add_init_script(init)
    pg.on("pageerror", lambda e: errors.append(name + ": " + str(e)))
    ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""([tok, uid, firm]) => { Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
      Cloud.st.firm = firm; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-asha", name: "Asha"}, {user_id: "u-rahul", name: "Rahul"}]; startCloudSync2(); }""", [tok, USERS[tok][0], FIRM])
    wait_for(pg, "Live.st === 'live'", 10)
    return ctx, pg

# a client's bank as an office has it: 441 lines of one statement (two parts), the keys of ~4,000 lines of earlier
# statements, and ~2,400 lines learnt (history): bank_meta ~560 KB, bank_rows 300 lines a part
FIXTURE = """async ([cid, sid]) => {
  let x = 7; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const hex = (n) => Array.from({length: n}, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
  const NAMES = ['ACME TRADERS PVT LTD', 'SHREE GANESH ENTERPRISES', 'BHARAT PETROLEUM CORP', 'RELIANCE JIO INFOCOMM', 'KOTAK MAHINDRA BANK', 'TATA POWER DDL', 'SHARMA AND SONS', 'GUPTA CA ASSOCIATES', 'AMAZON SELLER SERVICES', 'HDFC ERGO GENERAL', 'MAHAVIR STEEL TRADERS', 'NEW DELHI MUNICIPAL'];
  const LEDS = ['Acme Traders', 'Shree Ganesh Enterprises', 'Fuel Expenses', 'Telephone Expenses', 'Bank Charges', 'Electricity', 'Sharma & Sons', 'Professional Fees', 'Amazon Sales', 'Insurance', 'Mahavir Steel', 'Property Tax'];
  const narr = (i) => { const k = i % NAMES.length, ref = String(Math.floor(rnd() * 1e12)).padStart(12, '0');
    return [['UPI', ref, NAMES[k], NAMES[k].split(' ')[0].toLowerCase() + '@ok' + ['icici', 'hdfcbank', 'axis', 'sbi'][i % 4], 'Payment'].join('/'),
            ['NEFT', 'N' + ref, NAMES[k], 'HDFC0001234'].join('-'), ['IMPS', ref, NAMES[k], 'P2A'].join('/'), 'CHQ NO ' + ref.slice(6) + ' ' + NAMES[k]][i % 4]; };
  const rows = Array.from({length: 441}, (_, i) => { const out = i % 3 !== 0, amt = Math.round(rnd() * 250000) / 100, k = i % NAMES.length;
    return {id: sid + '-' + i, fp: hex(16), date: '2025-' + String(4 + Math.floor(i / 40) % 9).padStart(2, '0') + '-' + String(1 + i % 28).padStart(2, '0'),
      debit: out ? amt : 0, credit: out ? 0 : amt, balance: Math.round(rnd() * 5e7) / 100, narr: narr(i), state: 'ready', ledger: LEDS[k], source: i % 5 ? 'history' : 'rule',
      dec: {kind: i % 4 === 0 ? 'upi' : 'neft', key: NAMES[k].toLowerCase().replace(/[^a-z]+/g, ' ').trim(), name: NAMES[k], upi: i % 4 === 0 ? NAMES[k].split(' ')[0].toLowerCase() + '@okicici' : ''}}; });
  const keys = {}, hist = {rows: {}};
  for (let i = 0; i < 4000; i++) keys['bamgz1|' + hex(16)] = 'old' + (i % 9);
  rows.forEach(r => { keys['bamgz1|' + r.fp] = sid; });
  for (let i = 0; i < 2400; i++){ const k = i % NAMES.length;
    hist.rows[hex(16)] = {k: NAMES[k].toLowerCase(), p: NAMES[k].split(' ')[0].toLowerCase(), t: NAMES[k].split(' ').filter(w => w.length > 3).slice(0, 3).join(' '), l: LEDS[k], d: i % 3 ? 'out' : 'in', dt: '2024-' + String(1 + i % 12).padStart(2, '0') + '-' + String(1 + i % 28).padStart(2, '0'), s: ['hand', 'confirm', 'rule', 'tally'][i % 4], n: NAMES[k]}; }
  const stmt = {id: sid, n: 441, acctId: 'bamgz1', bank: 'ICICI Bank', acct: '167105000331', ifsc: 'ICIC0001671', fileName: 'ZZ Bank 25-26.xlsx', hash: 'hgz441', from: '2025-04-01', to: '2026-03-31'};
  await Promise.all([BankDB.set('stmts:' + cid, [stmt]), BankDB.set('stmt:' + cid + ':' + sid, rows), BankDB.set('keys:' + cid, keys), BankDB.set('hist:' + cid, hist), BankDB.set('rules:' + cid, [{id: 'r1', when: 'ACME', led: 'Acme Traders'}]), BankDB.set('newled:' + cid, [])]);
  S.coId = cid; S.view = 'company'; S.tab = 'bank'; S.bank = null; render();
}"""
SNAP = """(cid) => Object.fromEntries(cloudSnapshot().filter(r => r.client_id === cid && r.kind.startsWith('bank')).map(r => [r.kind + '|' + r.id, JSON.stringify(r.data)]))"""
BANK_HERE = """async ([cid, sid]) => JSON.stringify({keys: await BankDB.get('keys:' + cid), hist: await BankDB.get('hist:' + cid), rules: await BankDB.get('rules:' + cid), rows: await BankDB.get('stmt:' + cid + ':' + sid), stmts: await BankDB.get('stmts:' + cid)})"""
def server_bank():
    return {k[0] + "|" + k[2]: json.dumps(v["data"], separators=(",", ":"), ensure_ascii=False) for k, v in DB["records"].items() if k[1] == CID and k[0].startswith("bank")}
def same_json(a, b): return json.loads(a) == json.loads(b)
# a sync as the app runs it (one at a time: cloudSync waits for one already running, as the timer's does)
def push(pg): return pg.evaluate("async () => { for (let i = 0; i < 200 && cloudBusy; i++) await new Promise(r => setTimeout(r, 50)); await cloudSync(false); }")
def mine(tok, since): return [x for x in LOG[since:] if x[0] == tok]
STATS = "() => window.loadGzUpload().then(m => Object.assign({}, m.stats))"

with sync_playwright() as p:
    br = p.chromium.launch()
    ctxA, A = computer(br, "tA", "A")
    ctxB, B = computer(br, "tB", "B")
    ok(A.evaluate("Live.st") == "live" and B.evaluate("Live.st") == "live", "two browsers, both following the server's live changes")
    ok(A.evaluate("typeof window.loadGzUpload") == "function", "the compressed-save loader is set (lib/gstr1Fix.js, fetched with the app)")
    ok(A.evaluate("!performance.getEntriesByType('resource').some(e => /gzUpload/.test(e.name))"), "its code is not loaded before the first large save")

    print("1. a small save goes plain; the bank's records gzipped, the same rows, taken live on B")
    n0 = len(LOG)
    A.evaluate("""(cid) => { const c = newCompany({name: "ZZ GZIP TEST", gstin: ""}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); }""", CID)
    push(A)
    ok(wait_for(B, "S.companies['%s']" % CID, 5) is not None, "the client made on A reaches B")
    ok(mine("tA", n0) and all(x[1] == "plain" for x in mine("tA", n0)), "small saves go plain: %s" % [(x[1], x[2].split("?")[0], x[3]) for x in mine("tA", n0)])
    ok(A.evaluate("!performance.getEntriesByType('resource').some(e => /gzUpload/.test(e.name))"), "and the compressed-save code is still not loaded")
    A.evaluate(FIXTURE, [CID, SID])
    ok(wait_for(A, "S.bank && S.bank.cid === '%s' && !S.bank.loading && S.bank.rows.length === 441" % CID, 10) is not None, "A: the bank open, 441 lines")
    snapA = A.evaluate(SNAP, CID)
    raw_meta = len(snapA["bank_meta|" + CID].encode())
    print("    bank_meta %d KB, bank_rows :0 %d KB, :1 %d KB (JSON)" % (raw_meta // 1024, len(snapA["bank_rows|%s:%s:0" % (CID, SID)]) // 1024, len(snapA["bank_rows|%s:%s:1" % (CID, SID)]) // 1024))
    per = A.evaluate("(snap) => window.loadGzUpload().then(async m => { const o = {}; for (const k of Object.keys(snap)) o[k] = [snap[k].length, (await m.gzip(snap[k])).byteLength]; return o; })", snapA)
    for k, (a, b) in sorted(per.items()): print("    %-16s %4d KB -> %3d KB gzipped" % (k.split("|")[0] + (" :" + k.split(":")[-1] if "rows" in k else ""), a // 1024, b // 1024))
    ok(450_000 < raw_meta < 700_000, "a realistic bank_meta: %d KB" % (raw_meta // 1024))
    B.evaluate("() => { window.__bankSent = []; const o = Cloud.api; Cloud.api = function(p, opts){ if (opts && opts.method === 'POST' && /^records/.test(p)) window.__bankSent.push(...(opts.body || []).filter(r => /^bank/.test(r.kind)).map(r => r.id)); return o.apply(this, arguments); }; }")
    n1 = len(LOG); sent = push(A)
    calls = mine("tA", n1)
    print("    A's calls: %s" % [(x[1], x[2].split("?")[0], x[3], x[4]) for x in calls])
    calls = [x for x in calls if x[2].startswith("records")]
    ok([x[1] for x in calls] == ["fn"] and calls[0][2] == "records?on_conflict=firm_id,kind,id", "the bank's records: one call, gzipped, through the function (%s)" % [(x[1], x[2]) for x in calls])
    if calls: print("    on the wire: %d KB gzipped for %d KB of JSON (%.1f%%)" % (calls[0][3] // 1024, calls[0][4] // 1024, 100.0 * calls[0][3] / max(1, calls[0][4])))
    srvB = server_bank()
    ok(set(srvB) == set(snapA) and all(same_json(srvB[k], snapA[k]) for k in snapA), "the server holds exactly A's bank records (%d: %s)" % (len(srvB), sorted(srvB)))
    ok(all(DB["records"][(k.split("|")[0], CID, k.split("|")[1])]["deleted"] is False and DB["records"][(k.split("|")[0], CID, k.split("|")[1])]["firm_id"] == FIRM for k in snapA), "each row with the firm, the client and deleted false, as before")
    ok(A.evaluate("(cid) => cloudChanges().changes.filter(r => r.client_id === cid).length", CID) == 0, "A's marks: all of it saved (nothing left to send)")
    time.sleep(2.5)
    bankA, bankB = json.loads(A.evaluate(BANK_HERE, [CID, SID])), json.loads(B.evaluate(BANK_HERE, [CID, SID]))
    ok(bankB["rows"] and len(bankB["rows"]) == 441 and [r["id"] for r in bankB["rows"]] == [r["id"] for r in bankA["rows"]], "B took the statement live: 441 lines in order")
    ok(bankB["keys"] == bankA["keys"] and bankB["hist"] == bankA["hist"] and bankB["rows"] == bankA["rows"] and bankB["rules"] == bankA["rules"], "B's bank (keys, history, rules, lines) is A's, value for value")
    push(B); ok(B.evaluate("window.__bankSent") == [], "nothing of the bank sent back from B (%s)" % B.evaluate("window.__bankSent"))

    print("2. a change on A gzipped again; a large save_book_items")
    B.evaluate("([cid, sid]) => { S.coId = cid; S.view = 'company'; S.tab = 'bank'; S.bank = null; render(); }", [CID, SID])
    wait_for(B, "S.bank && S.bank.cid === '%s' && !S.bank.loading && S.bank.rows.length === 441" % CID, 10)
    n2 = len(LOG)
    A.evaluate("() => { const b = S.bank; b.rows[5].ledger = 'Suspense'; b.hist.rows['zzfp-new'] = {k: 'zz', p: 'zz', t: 'ZZ', l: 'Suspense', d: 'out', dt: '2025-04-06', s: 'hand', n: 'ZZ'}; }")
    push(A)
    calls = mine("tA", n2)
    ok(sorted(x[1] for x in calls) == ["fn"], "the change (meta and the first part): gzipped (%s)" % [(x[1], x[3]) for x in calls])
    t = None; s0 = time.time()
    while time.time() - s0 < 6:
        if B.evaluate("([cid, sid]) => BankDB.get('stmt:' + cid + ':' + sid).then(r => r && r[5] && r[5].ledger)", [CID, SID]) == "Suspense": t = time.time() - s0; break
        time.sleep(0.1)
    ok(t is not None, "the change reaches B (%.2f s)" % (t or 99))
    ok(json.loads(B.evaluate(BANK_HERE, [CID, SID]))["hist"] == json.loads(A.evaluate(SNAP, CID)["bank_meta|" + CID])["hist"], "B's history is A's again")
    n3 = len(LOG)
    res = A.evaluate("""(cid) => Cloud.api("rpc/save_book_items", {method: "POST", body: {p_client: cid, p_items: Array.from({length: 120}, (_, i) => ({k: "map", i: "Ledger " + i, d: {kind: "tds", ok: true, what: "tds_payable", note: "confirmed by Asha on 26-Oct-2026 ".repeat(8)}}))}})""", CID)
    calls = mine("tA", n3)
    ok([x[1] for x in calls] == ["fn"] and calls[0][2] == "rpc/save_book_items", "a large save_book_items: gzipped (%s)" % [(x[1], x[2], x[3], x[4]) for x in calls])
    ok(res and res.get("ok") is True and len(res.get("items") or []) == 120 and all(isinstance(i.get("seq"), int) for i in res["items"]), "its answer is the RPC's own ({ok, items with seq})")
    ok(len([k for k in DB["items"] if k[0] == CID and k[1] == "map" and k[2].startswith("Ledger ")]) == 120, "the 120 items saved (%d)" % len([k for k in DB["items"] if k[0] == CID and k[1] == "map"]))
    n4 = len(LOG)
    res = A.evaluate("""(cid) => Cloud.api("rpc/save_book_items", {method: "POST", body: {p_client: cid, p_items: [{k: "map", i: "Ledger 1", d: {ok: false}}]}})""", CID)
    ok([x[1] for x in mine("tA", n4)] == ["plain"] and res.get("ok"), "a small one: plain, as before")

    print("3. the function missing, failing, something else, no CompressionStream: plain, the same rows")
    def change(pg, led):
        pg.evaluate("(led) => { S.bank.rows[7].ledger = led; S.bank.hist.rows['zzfp-' + led] = {l: led}; }", led)
    for mode, label in (("404", "missing (404)"), ("500", "failing (500)"), ("other", "answering something else (200 {})")):
        CTRL["fn"] = mode; A.evaluate("() => window.loadGzUpload().then(m => m.reset())")
        n5 = len(LOG); change(A, "Led " + mode); push(A)
        calls = mine("tA", n5)
        ok([x[1] for x in calls] == ["fn" + mode, "plain"], "the function %s: asked once, then the same save plain (%s)" % (label, [x[1] for x in calls]))
        snapA = A.evaluate(SNAP, CID); srvB = server_bank()
        ok(all(same_json(srvB[k], snapA[k]) for k in snapA), "  the server holds A's records, value for value")
        n6 = len(LOG); change(A, "Led " + mode + " again"); push(A)
        ok([x[1] for x in mine("tA", n6)] == ["plain"], "  the next large save: plain at once, the function not asked again in this tab (%s)" % [x[1] for x in mine("tA", n6)])
    CTRL["fn"] = "on"; A.evaluate("() => window.loadGzUpload().then(m => m.reset())")
    n7 = len(LOG); change(A, "Led back on"); push(A)
    ok([x[1] for x in mine("tA", n7)] == ["fn"], "the function back: gzipped again")
    # a browser without CompressionStream (Safari before 16.4)
    ctxC, C = computer(br, "tC", "C", init="delete window.CompressionStream; delete window.DecompressionStream;")
    C.evaluate(FIXTURE.replace("hgz441", "hgz441c"), [CID, SID]); wait_for(C, "S.bank && S.bank.cid === '%s' && !S.bank.loading && S.bank.rows.length === 441" % CID, 10)
    C.evaluate("() => { S.bank.rows[9].ledger = 'From C'; }")
    push(C)
    calls = mine("tC", 0)
    ok(any(x[3] > 32768 for x in calls) and all(x[1] == "plain" for x in calls), "no CompressionStream: the saves go plain, the large ones too (%s)" % [(x[1], x[3] // 1024) for x in calls])
    snapC = C.evaluate(SNAP, CID); srvB = server_bank()
    ok(all(same_json(srvB[k], snapC[k]) for k in snapC), "  the server holds that browser's records, value for value")
    ctxC.close()

    print("4. a refusal by the database: the same error as the plain call's, sent once")
    CTRL["rls"].add("tA"); nb = len(LOG)
    big = A.evaluate("""() => Cloud.api("records?on_conflict=firm_id,kind,id", {method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"}, body: [{firm_id: Cloud.st.firm, kind: "entry", id: "zzrls", client_id: "zzgz1", data: {pad: "x".repeat(40000)}, deleted: false}]}).then(() => "taken", e => e.message)""")
    n9 = len(LOG)
    small = A.evaluate("""() => Cloud.api("records?on_conflict=firm_id,kind,id", {method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"}, body: [{firm_id: Cloud.st.firm, kind: "entry", id: "zzrls", client_id: "zzgz1", data: {pad: "x"}, deleted: false}]}).then(() => "taken", e => e.message)""")
    CTRL["rls"].discard("tA")
    ok(big == small and "row-level security" in big, "gzipped and plain: the same error (%s)" % big)
    ok([x[1] for x in LOG[nb:] if x[0] == "tA" and x[2].startswith("records") and x[4] > 40000] == ["fn"] and ("entry", "zzgz1", "zzrls") not in DB["records"], "the refused save sent once through the function, never again plain; nothing written")
    st = A.evaluate(STATS)
    print("    this tab: %d saves gzipped (%d KB of JSON sent as %d KB), %d plain" % (st["gz"], st["raw"] // 1024, st["sent"] // 1024, st["plain"]))
    ctxA.close(); ctxB.close()

    print("5. sizes and times on a connection throttled to 1.5 Mbps up (Chrome's throttling, a local server)")
    # the same Cloud.api call, its request sent on to a local server that reads it all (so the throttling applies)
    got = []
    class Sink(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_OPTIONS(self):
            self.send_response(204); [self.send_header(k, v) for k, v in (("Access-Control-Allow-Origin", "*"), ("Access-Control-Allow-Headers", "*"), ("Access-Control-Allow-Methods", "POST"))]; self.end_headers()
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0))); got.append((self.path, len(raw)))
            if "records-upload" in self.path:
                q = parse_qs(urlparse(self.path).query); st, out = rest_write(q["path"][0], self.headers.get("authorization", "").replace("Bearer ", ""), json.loads(gzip.decompress(raw)), q["prefer"][0])
                b = json.dumps({"fincomUpload": 1, "status": st, "body": out, "range": ""}).encode(); code = 200
            elif "/rest/v1/" not in self.path: b = b"{}"; code = 200
            else:
                st, out = rest_write(self.path.split("/rest/v1/")[1], self.headers.get("authorization", "").replace("Bearer ", ""), json.loads(raw), self.headers.get("prefer") or ""); b = out.encode(); code = st
            self.send_response(code); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    sink = http.server.ThreadingHTTPServer(("127.0.0.1", 8428), Sink); threading.Thread(target=sink.serve_forever, daemon=True).start()
    ctxT, T = computer(br, "tA", "T")
    T.evaluate(FIXTURE, [CID, SID]); wait_for(T, "S.bank && S.bank.cid === '%s' && !S.bank.loading && S.bank.rows.length === 441" % CID, 10)
    T.evaluate("() => { const c = Cloud.cfg(); window.__cfg0 = Cloud.cfg; Cloud.cfg = () => Object.assign({}, window.__cfg0.call(Cloud), {url: 'http://127.0.0.1:8428'}); }")
    cdp = ctxT.new_cdp_session(T); cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 60, "downloadThroughput": 10e6 / 8, "uploadThroughput": 1.5e6 / 8})
    SAVE = """async (gz) => { const rows = cloudSnapshot().filter(r => r.client_id === '%s' && /^bank/.test(r.kind)).map(r => ({firm_id: Cloud.st.firm, kind: r.kind, id: r.id, client_id: r.client_id, data: r.data, deleted: false}));
      const keep = window.loadGzUpload; if (!gz) window.loadGzUpload = undefined; else (await keep()).reset();
      const t0 = performance.now();
      try { await Cloud.api("records?on_conflict=firm_id,kind,id", {method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"}, body: rows}); } finally { window.loadGzUpload = keep; }
      return [performance.now() - t0, JSON.stringify(rows).length]; }""" % CID
    T.evaluate(SAVE, True)       # the chunk loaded once (as after the first large save of a session)
    res = {}
    for mode in (False, True, False, True):
        del got[:]; ms, n = T.evaluate(SAVE, mode)
        mine_ = [g for g in got if "/records-upload" in g[0] or "/rest/v1/records" in g[0]]     # not the app's other calls
        res.setdefault(mode, []).append((ms, sum(g[1] for g in mine_), n, [g[0].split("?")[0] for g in mine_]))
    plain, gzd = min(res[False]), min(res[True])
    print("    bank save (bank_meta + statement + 2 parts): %d KB JSON" % (plain[2] // 1024))
    print("      plain:   %d KB on the wire, %.1f s" % (plain[1] // 1024, plain[0] / 1000))
    print("      gzipped: %d KB on the wire, %.1f s (compressing included)" % (gzd[1] // 1024, gzd[0] / 1000))
    ok(gzd[3] == ["/functions/v1/records-upload"] and plain[3] == ["/rest/v1/records"], "the throttled saves went the two ways (%s, %s)" % (gzd[3], plain[3]))
    ok(gzd[1] * 4 < plain[1], "gzipped: under a quarter of the bytes (%d of %d KB)" % (gzd[1] // 1024, plain[1] // 1024))
    ok(gzd[0] * 2 < plain[0], "and under half the time at 1.5 Mbps up (%.1f s against %.1f s)" % (gzd[0] / 1000, plain[0] / 1000))
    ctxT.close(); sink.shutdown()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\n%s" % ("ALL PASSED" if not fails else "%d FAILED" % len(fails)))
raise SystemExit(1 if fails else 0)
