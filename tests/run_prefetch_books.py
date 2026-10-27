"""python3 run_prefetch_books.py - the owner, 26-Oct-2026: "Every new browser sign-up loads complete books.. it takes
time.. can we have it just after login.. not after clicking on the part where books required.. so that no latency."
Then: "dont write anything at the bottom sidebar.. just do it at the earliest".
A browser with no copy (a new browser, or after signing out) brought a client's whole books in only when the person
opened that client. Now (Prefetch, src/js/98-prefetch-books.js) right after sign-in, as soon as the client list is known,
FinCom fills this browser's own stores (books:<cid>, tcday:<book>:<day>, bookitems:<cid>) for the clients in the background,
with the same reads and the same functions an opening uses, so the opening later only checks for changes.
A fake firm account (sign-in, clients, the cloud copy of the books of eight clients, their TDS/GST work as items, row-level
security for a staff member) that logs every request with its start, end and client:
  1. a fresh browser, signed in, no click: every client's books are in this browser's stores within PREFETCH_S seconds, the
     first read soon after the client list came, in order of the books' last change, one client at a time and at most two requests
     at a time (speed round, 27-Oct-2026: one before); nothing is written to the cloud;
  2. a prefetched client opened: no full read (no day file, no month of day files, no ledger list, no entries' heads or
     their GUID list, no work items from the start), only the change checks, and its entries on screen with no wait;
  3. a client opened while it is being prefetched: nothing is fetched twice, and its books are whole;
  4. the person's open of another client goes first: no prefetch request starts while it opens; then the rest come in;
  5. a connection that saves data (navigator.connection.saveData, or 2g): no prefetch at all;
  6. a staff member whose reads of some clients the database refuses: only the clients they may read are prefetched;
  7. nothing of the prefetch is written on the page (no line, no toast, no progress text);
  8. signing out with "remove this firm's work" clears what was prefetched, and no prefetch follows;
  also: the order with this person's recent clients first, and the timings kinds prefetch/<step>.
Prints the time to open a client in a fresh browser right after sign-in, and after the prefetch.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_prefetch_books.py"""
import os, re, json, gzip, time, threading, functools, http.server, itertools
from urllib.parse import urlparse, parse_qs, unquote
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PAGE_PORT, FAKE_PORT = 8493, 9493
FAKE = "http://localhost:%d" % FAKE_PORT
PREFETCH_S = int(os.environ.get("PREFETCH_S") or 60)
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
pages = http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(Pages, directory=SITE)); pages.handle_error = lambda *a: None
threading.Thread(target=pages.serve_forever, daemon=True).start()

# ---------- the firm: eight clients, each with a book of 30 days (FY 2026-27), 90 entries and 20 items of work ----------
FIRM = "f1000000-0000-4000-8000-00000000000f"
USERS = {"owner@zz-firm.in": {"id": "u-owner", "role": "owner"}, "staff@zz-firm.in": {"id": "u-staff", "role": "staff"}}
CIDS = ["czzpre%02d" % i for i in range(1, 9)]
STAFF_MAY = set(CIDS[:3])
BOOK = {c: "bk%s-0000-4000-8000-000000000000" % c[-2:] for c in CIDS}
CID_OF = {b: c for c, b in BOOK.items()}
DAYS_AT = {c: "2026-10-%02dT10:00:00+00:00" % (10 + i) for i, c in enumerate(CIDS)}     # czzpre08 changed last
ORDER = sorted(CIDS, key=lambda c: DAYS_AT[c], reverse=True)
DAYS = ["2026%02d%02d" % (4 + i // 15, 1 + i % 15) for i in range(30)]
esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
iso = lambda d8: d8[:4] + "-" + d8[4:6] + "-" + d8[6:8]
LEDGERS = ["ZZ Party %02d" % i for i in range(12)] + ["ZZ Expense %02d" % i for i in range(6)] + ["ZZ Bank"]
def vouchers(c):
    out = []
    for k in range(90):
        d = DAYS[k // 3]; p = "ZZ Party %02d" % (k % 12); a = 1000 + k * 13
        out.append({"guid": "%s-g%03d" % (c, k), "day": d, "alt": 100 + k, "no": str(k + 1), "party": p, "lines": [("ZZ Expense %02d" % (k % 6), -a), (p, a)]})
    return out
V = {c: vouchers(c) for c in CIDS}
def vxml(v):
    ent = "".join("<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><AMOUNT>%.2f</AMOUNT></ALLLEDGERENTRIES.LIST>"
                  % (esc(l), "Yes" if a < 0 else "No", a) for l, a in v["lines"])
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>'
            "<VOUCHERNUMBER>%s</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>zz entry %s</NARRATION><ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>%s</VOUCHER></TALLYMESSAGE>"
            % (v["day"], v["guid"], v["alt"], v["no"], esc(v["party"]), v["no"], ent))
GZ = {}
for c in CIDS:
    by = {}
    for v in V[c]: by.setdefault(v["day"], []).append(vxml(v))
    for d in DAYS: GZ[(BOOK[c], d)] = gzip.compress(("<ENVELOPE><BODY><DATA>" + "".join(by.get(d, [])) + "</DATA></BODY></ENVELOPE>").encode())
DAY_AT = "2026-10-20T07:46:51+00:00"
def head(c, v):
    return {"guid": v["guid"], "day": iso(v["day"]), "alter_id": v["alt"], "vtype": "Journal", "vno": v["no"], "party": v["party"], "narration": "zz",
            "cancelled": False, "optional": False, "deleted_at": None, "book_id": BOOK[c], "tds_tally_alter_id": None}
T = {"tally_ledgers": [], "tally_groups": [], "tally_vouchers": [], "tally_recorder_lines": [], "tally_lines": [], "tally_bills": [], "tally_tds_natures": [],
     "tally_employees": [], "tally_cost_allocs": [], "tally_salary_pays": [], "tally_jobs": [], "tally_book_changes": []}
for c in CIDS:
    T["tally_ledgers"] += [{"name": n, "parent": "Sundry Creditors" if "Party" in n else "Indirect Expenses" if "Expense" in n else "Bank Accounts", "open": 0, "pan": None, "gstin": None,
                            "tds_nature": None, "tds_special_rate": None, "tds_ldc": None, "merged_into": None, "deleted_at": None, "for_payroll": False, "book_id": BOOK[c]} for n in LEDGERS]
    T["tally_groups"] += [{"name": n, "parent": p, "book_id": BOOK[c]} for n, p in [("Sundry Creditors", "Current Liabilities"), ("Indirect Expenses", "Primary"), ("Bank Accounts", "Current Assets")]]
    T["tally_vouchers"] += [head(c, v) for v in V[c]]
ITEMS, SEQ = [], [0]
def item(cid, k, i, d):
    SEQ[0] += 1; ITEMS.append({"client_id": cid, "key": k, "item": i, "ord": None, "data": d, "deleted": False, "seq": SEQ[0], "updated_at": "2026-10-20T07:45:00+00:00", "updated_by": "u-other"})
for c in CIDS:
    item(c, "map", "", {"$t": "obj"})
    for n in LEDGERS: item(c, "map", "." + n, {"kind": "other", "n": 1})
def crow(cid, i):
    name = "ZZ Early Client %02d" % i
    return {"firm_id": FIRM, "id": cid, "name": name, "gstin": "", "pan": "", "tally_name": name, "deleted": False, "updated_at": "2026-10-01T10:00:%02d.000000Z" % i,
            "data": {"id": cid, "name": name, "gstin": "", "pan": "", "tallyName": name, "stats": {}, "hashes": {}, "keys": {}}}
CLIENTS = [crow(c, i + 1) for i, c in enumerate(CIDS)]

# ---------- the log: every request, its start and end, whose client, what kind ----------
LOG, LOCK = [], threading.Lock()
ST = {"delay": 0.06, "inflight": 0, "staff_denied": []}
TOK, REF, seq = {}, {}, itertools.count(1)
def token_for(email):
    n = next(seq); a, r = "acc-%s-%d" % (USERS[email]["id"], n), "ref-%s-%d" % (USERS[email]["id"], n)
    TOK[a] = email; REF[r] = email
    return {"access_token": a, "refresh_token": r, "expires_in": 3600, "user": {"id": USERS[email]["id"], "email": email}}
def proj(rows, q):
    sel = (q.get("select") or [None])[0]
    for key, vals in q.items():
        if key in ("select", "order", "limit", "offset"): continue
        v = unquote(vals[0])
        if v.startswith("eq."): rows = [r for r in rows if str(r.get(key)).lower() == v[3:].lower() or (r.get(key) is True and v[3:] == "true")]
        elif v.startswith("in.("):
            s = set(x.strip('"') for x in re.findall(r'"(?:[^"\\]|\\.)*"|[^,]+', v[4:-1])); rows = [r for r in rows if str(r.get(key)) in s]
        elif v == "is.null": rows = [r for r in rows if r.get(key) is None]
        elif v == "not.is.null": rows = [r for r in rows if r.get(key) is not None]
        elif v.startswith("gt."): rows = [r for r in rows if str(r.get(key) or "") > v[3:]]
    off = int((q.get("offset") or ["0"])[0]); lim = int((q.get("limit") or ["1000"])[0]); rows = rows[off:off + lim]
    if sel: cols = sel.split(","); rows = [{c: r.get(c) for c in cols} for r in rows]
    return rows
def pack_month(days):
    hd = json.dumps([{"day": d, "at": DAY_AT, "n": len(gz)} for d, gz in days]).encode()
    return len(hd).to_bytes(4, "big") + hd + b"".join(gz for _, gz in days)

class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-upsert, x-client-info, accept, range, x-bridge-key")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS"); self.send_header("Access-Control-Expose-Headers", "content-range")
    def out(self, code, body=None, raw=None, ctype="application/json"):
        data = raw if raw is not None else (b"" if body is None else json.dumps(body).encode())
        if self.rec is not None and code != 204:
            time.sleep(ST["delay"] + len(data) / 4e6)
        self.send_response(code); self.cors(); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data: self.wfile.write(data)
        if self.rec is not None:
            with LOCK: self.rec["t1"] = time.time(); self.rec["bytes"] = len(data); self.rec["code"] = code; ST["inflight"] -= 1
    def do_OPTIONS(self): self.rec = None; self.out(204)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try: return json.loads(self.rfile.read(n) or b"null") if n else None
        except Exception: return None
    def handle_any(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path; bearer = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        b = self.body() if self.command in ("POST", "PATCH", "PUT") else None
        em = TOK.get(bearer); me = USERS.get(em) if em else None
        # whose client the request is about, and what it is
        cid, kind = "", ""
        bk = (q.get("book_id") or [""])[0].replace("eq.", "") or ((b or {}).get("p_book") if isinstance(b, dict) else "") or ((b or {}).get("book") if isinstance(b, dict) else "")
        if bk: cid = CID_OF.get(unquote(bk), "")
        if isinstance(b, dict) and b.get("p_client"): cid = b["p_client"]
        if (q.get("client_id") or [""])[0].startswith("eq."): cid = unquote(q["client_id"][0][3:])
        m = re.search(r"/tally-days/[^/]+/([^/]+)/\d+/(\d{8})\.xml\.gz$", p)
        if m: cid, kind = CID_OF.get(m.group(1), ""), "dayfile"
        t = p[len("/rest/v1/"):] if p.startswith("/rest/v1/") else ""
        sel = (q.get("select") or [""])[0]
        if not kind:
            if p.endswith("/functions/v1/tally-ingest") and isinstance(b, dict) and b.get("kind") == "month_days": kind = "month"
            elif t == "tally_vouchers": kind = "heads-by-guid" if "guid" in q else ("thin-all" if sel.startswith("guid,alter_id,deleted_at") else "heads-all")
            # the ledger boxes' one list (Ledgers.readCloud, src/js/58: with each ledger's chain, read on each opening as before)
            # apart from the books' ledgers (TCloud.load: with the openings)
            elif t == "tally_ledgers": kind = "ledger-list" if "chain" in sel else "ledgers"
            elif t == "tally_groups": kind = "ledger-list-groups" if "order" in q else "tally_groups"
            elif t == "client_book_items": kind = "items-from0" if (q.get("seq") or ["gt.0"])[0] == "gt.0" else "items-since"
            elif t.startswith("rpc/"): kind = t
            elif t: kind = t + (" " + self.command if self.command != "GET" else "")
            else: kind = p
        self.rec = {"t0": time.time(), "t1": None, "who": em or "", "cid": cid, "kind": kind, "path": self.path, "method": self.command, "body": b}
        with LOCK: LOG.append(self.rec); ST["inflight"] += 1
        if p == "/functions/v1/signin": return self.out(404, {"msg": "no such function"})
        if p == "/auth/v1/token":
            if q.get("grant_type") == ["password"]:
                if (b or {}).get("email") not in USERS: return self.out(400, {"error_description": "Invalid login credentials"})
                return self.out(200, token_for(b["email"]))
            e2 = REF.pop((b or {}).get("refresh_token"), None)
            return self.out(200, token_for(e2)) if e2 else self.out(400, {"error": "invalid_grant", "error_description": "Invalid Refresh Token"})
        if p == "/auth/v1/logout": return self.out(204)
        if p == "/auth/v1/user": return self.out(200, {"id": me["id"], "email": em, "factors": []}) if me else self.out(401, {"msg": "bad token"})
        if p.startswith("/auth/v1/"): return self.out(200, {})
        if not me: return self.out(401, {"message": "JWT expired"})
        may = lambda c: me["role"] == "owner" or c in STAFF_MAY
        if cid and not may(cid):
            # row-level security: the rows of a client this person may not read are not given (rpc: refused)
            with LOCK: ST["staff_denied"].append((kind, cid))
            if t.startswith("rpc/") or kind in ("dayfile", "month"): return self.out(403 if kind != "dayfile" else 400, {"message": "not allowed", "code": "42501"})
            return self.out(200, [])
        if kind == "dayfile": return self.out(200, raw=GZ.get((BOOK[cid], m.group(2)), b""), ctype="application/gzip")
        if kind == "month":
            ym = str(b.get("month") or ""); return self.out(200, raw=pack_month([(d, GZ[(BOOK[cid], d)]) for d in DAYS if d[:6] == ym]), ctype="application/octet-stream")
        if p.startswith("/functions/v1/"): return self.out(200, {"ok": True})
        if p.startswith("/storage/v1/"): return self.out(404, {"message": "not found"})
        if t == "members": return self.out(200, [{"user_id": me["id"], "firm_id": FIRM, "name": em, "email": em, "role": me["role"], "active": True}])
        if t == "rpc/mfa_status": return self.out(200, {"required": False, "enrolled": False, "admin": False, "aal": "aal1", "ok": True})
        if t == "rpc/my_account": return self.out(200, {"me": {"role": me["role"], "email": em, "name": em}, "firm": {"balance": 100, "name": "ZZ Early Firm", "id": FIRM}, "people": [], "modules": [], "usage": []})
        if t == "rpc/tally_status":
            return self.out(200, [{"book": BOOK[cid], "company": "ZZ COMPANY " + cid.upper(), "from": "2026-04-01", "openAsOn": "2026-03-31", "state": {"phase": "live"}, "days": len(DAYS),
                                   "entries": len(V[cid]), "to": iso(DAYS[-1]), "ledgersAt": "2026-10-17T16:18:53Z", "daysAt": DAYS_AT[cid]}] if cid in BOOK else [])
        if t == "rpc/tally_days_list":
            off = int((q.get("offset") or ["0"])[0]); return self.out(200, [{"day": d, "n": 3, "at": DAY_AT} for d in DAYS][off:off + 1000] if cid else [])
        if t == "rpc/save_book_items":
            with LOCK: self.rec["write"] = True
            return self.out(200, {"ok": True, "items": [], "at": "2026-10-26T10:00:00Z"})
        if t.startswith("rpc/"): return self.out(200, [] if t.startswith("rpc/tally_") else {})
        if t == "clients" and self.command == "GET": return self.out(200, sorted([r for r in CLIENTS if all(proj([r], {k: v}) for k, v in q.items() if k in ("id", "updated_at"))], key=lambda r: r["updated_at"]))
        if t == "tally_books":
            rows = [{"book_id": BOOK[c], "client_id": c, "company": "ZZ COMPANY " + c.upper(), "days_at": DAYS_AT[c], "updated_at": DAYS_AT[c]} for c in CIDS if may(c)]
            return self.out(200, proj(rows, q))
        if t == "client_book_items":
            rows = [x for x in ITEMS if x["client_id"] == cid and x["seq"] > int((q.get("seq") or ["gt.0"])[0][3:])]
            if q.get("key"): rows = [x for x in rows if x["key"] == q["key"][0][3:]]
            return self.out(200, [{k: x[k] for k in ("key", "item", "ord", "data", "deleted", "seq", "updated_at", "updated_by")} for x in rows][:1000])
        if t in T: return self.out(200, proj([r for r in T[t] if not r.get("book_id") or may(CID_OF.get(r["book_id"], ""))], q))
        if self.command == "GET": return self.out(200, [])
        with LOCK: self.rec["write"] = True
        return self.out(201, {})
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any
fake = http.server.ThreadingHTTPServer(("localhost", FAKE_PORT), Fake); fake.handle_error = lambda *a: None; fake.daemon_threads = True
threading.Thread(target=fake.serve_forever, daemon=True).start()

fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the page's requests to the cloud go to the fake; every text written on the page is kept (no prefetch text may appear)
REC = r"""(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(typeof u === 'string' ? u.replace(/^https:\/\/[a-z]+\.supabase\.co/, '%s') : u, o);
  window.__texts = []; const seen = new Set();
  const look = () => { try { const t = document.body ? document.body.innerText : ''; t.split('\n').forEach(l => { l = l.trim(); if (l && !seen.has(l)){ seen.add(l); window.__texts.push(l); } }); } catch (e) {} };
  new MutationObserver(look).observe(document, {subtree: true, childList: true, characterData: true}); })()""" % FAKE
SAVEDATA = "Object.defineProperty(navigator, 'connection', {configurable: true, get(){ return {saveData: %s, effectiveType: '%s', addEventListener(){}, removeEventListener(){}}; }});"
STORES = r"""async () => { const out = {}, books = %s;
  for (const d of await indexedDB.databases()){ if (!/^tdsdesk-work/.test(d.name || '')) continue;
    const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    if (!db.objectStoreNames.contains('docs')){ db.close(); continue; }
    const rows = await new Promise(ok => { const q = db.transaction('docs').objectStore('docs').openCursor(), o = []; q.onsuccess = () => { const c = q.result; if (c){ o.push([c.key, c.value]); c.continue(); } else ok(o); }; });
    db.close();
    rows.forEach(([k, v]) => { const m = /^(books|bookitems|tcday):([^:]+)/.exec(k); if (!m) return; const x = out[m[2]] = out[m[2]] || {days: 0};
      if (m[1] === 'books') { x.n = (v.vouchers || []).length; x.cloud = !!(v.meta && v.meta.cloud); x.pre = !!(v.meta && v.meta.pre); }
      if (m[1] === 'bookitems') x.seq = v.seq || 0;
      if (m[1] === 'tcday') { const y = out[books[m[2]]] = out[books[m[2]]] || {days: 0}; y.days++; } }); }
  return out; }""" % json.dumps(CID_OF)
def sign_in(pg, email):
    pg.wait_for_selector('[data-act="cloudSignIn"]', timeout=20000)
    pg.fill('[data-cloud="email"]', email); pg.fill('[data-cloud="password"]', "pw12345678")
    t = time.time(); pg.click('[data-act="cloudSignIn"]')
    return t
def until(pg, js, t=60, every=0.1):
    s = time.time()
    while time.time() - s < t:
        try:
            if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
        except Exception: pass
        time.sleep(every)
    return None
def stores(pg):
    for _ in range(3):
        try: return pg.evaluate(STORES)
        except Exception: time.sleep(0.5)
    return {}
def ready(st, c): x = st.get(c) or {}; return x.get("n") == 90 and x.get("cloud") and x.get("seq", 0) > 0 and x.get("days") == len(DAYS)
def since(t0, t1=None): return [r for r in list(LOG) if r["t0"] >= t0 and (t1 is None or r["t0"] <= t1)]
def max_overlap(rs):
    ev = sorted([(r["t0"], 1) for r in rs] + [((r["t1"] or time.time()), -1) for r in rs], key=lambda x: (x[0], x[1]))
    n = m = 0
    for _, d in ev: n += d; m = max(m, n)
    return m
HEAVY = ("dayfile", "month", "ledgers", "heads-all", "thin-all", "items-from0", "heads-by-guid", "tally_groups", "tally_tds_natures")
OPEN = """(cid) => { openCompany(cid).then(() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }); }"""
SHOWN = "S.books && S.books.cid === '%s' && !S.books.loading && (S.books.vouchers || []).length === 90 && !S.books.busy && !document.querySelector('#app [data-loading]')"

with sync_playwright() as pw:
    br = pw.chromium.launch()
    def fresh(init=None):
        ctx = br.new_context(viewport={"width": 1400, "height": 900}); ctx.add_init_script(REC)
        if init: ctx.add_init_script(init)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PAGE_PORT); return ctx, pg
    def list_known(t0):
        """when the client list came (the first read of clients after t0)"""
        r = [x for x in since(t0) if x["kind"] == "clients" and x["t1"]]
        return r[0]["t1"] if r else None

    print("== 0. a fresh browser, a client opened right after sign-in (the time to open)")
    ctx, pg = fresh(); t0 = sign_in(pg, "owner@zz-firm.in")
    until(pg, "Object.keys(S.companies || {}).length === %d" % len(CIDS), 30)
    c0 = ORDER[3]; ts = time.time(); pg.evaluate(OPEN, c0)
    w = until(pg, SHOWN % c0, 60, 0.03)
    print("     fresh browser, %s opened at once after sign-in: entries on screen in %s ms" % (c0, int(w * 1000) if w is not None else "-"))
    ok(w is not None, "a client opened at once after sign-in in a fresh browser gets its books (%s s)" % w)
    ctx.close()

    print("== 1. a fresh browser, signed in, no click")
    LOG.clear(); ctx, pg = fresh(); t0 = sign_in(pg, "owner@zz-firm.in")
    until(pg, "Object.keys(S.companies || {}).length === %d" % len(CIDS), 30)
    w = None; s = time.time()
    while time.time() - s < PREFETCH_S:
        st = stores(pg)
        if all(ready(st, c) for c in CIDS): w = time.time() - t0; break
        time.sleep(0.5)
    st = stores(pg)
    print("     stores: %s" % json.dumps({c: st.get(c) for c in CIDS}))
    ok(w is not None, "every client's books, days and work are in this browser within %d s of signing in, with no click (%s s)" % (PREFETCH_S, round(w, 1) if w else "-"))
    # (the work of every client is brought in at sign-in by the due list already, DueList.syncAll: its client_book_items
    # reads are its own; the prefetch gives way to it)
    lk = list_known(t0); rs = [r for r in since(t0) if r["cid"] in CIDS and not r["kind"].startswith("items-")]
    pf = [r for r in since(t0) if r["kind"] == "tally_books"]
    # the app's own sign-in work (the due list bringing in every client's work, DueList.syncAll) goes first; then at once
    own = [r["t1"] or r["t0"] for r in since(t0) if r["kind"].startswith("items-") and pf and r["t0"] < pf[0]["t0"]]
    gap = pf[0]["t0"] - max(own + [lk or 0]) if pf and lk else None
    print("     the client list came %.2f s after signing in; the prefetch's first read %.2f s after it, %.2f s after the due list's last read"
          % ((lk or 0) - t0, (pf[0]["t0"] - lk) if pf and lk else -1, gap if gap is not None else -1))
    ok(gap is not None and gap < 1.0, "the first read starts as soon as the sign-in's own reads are done, with no wait for idle (%s s after them)" % (round(gap, 2) if gap is not None else "-"))
    seen = []
    for r in rs:
        if r["cid"] not in seen: seen.append(r["cid"])
    book_order = [c for c in seen]
    ok(book_order == ORDER, "the clients in order of their books' last change (%s; expected %s)" % (book_order, ORDER))
    spans = [(c, min(r["t0"] for r in rs if r["cid"] == c), max(r["t1"] or 0 for r in rs if r["cid"] == c)) for c in ORDER if any(r["cid"] == c for r in rs)]
    over = [(a[0], b[0]) for a, b in zip(spans, spans[1:]) if b[1] < a[2]]
    print("     each client's prefetch (first read to last): %s s" % ", ".join("%.1f" % (e - b) for _, b, e in spans))
    ok(not over, "one client at a time: each client's reads end before the next client's begin (%s)" % over)
    mo = max_overlap(rs)
    both = [(a["kind"], a["cid"], b["kind"], b["cid"]) for a in rs for b in rs if a is not b and a["t0"] < b["t0"] < (a["t1"] or 1e12)]
    # speed round (27-Oct-2026): the months of a client two at a time while the person is not in the way
    ok(mo <= 2, "at most two requests at a time (at most %d at once%s)" % (mo, (": " + str(both[:3])) if both else ""))
    last = pg.evaluate("() => typeof Prefetch === 'object' && Prefetch.last || ''")
    ok(not last, "no client failed to come in (%s)" % last)
    wr = [(r["kind"], r["cid"]) for r in since(t0) if r.get("write") and (r["cid"] or r["kind"] == "rpc/save_book_items")]
    ok(not wr, "nothing written to the cloud by the prefetch (%s)" % wr[:5])
    ok(not any(st.get(c, {}).get("pre") is False for c in CIDS), "each prefetched copy is marked as such for its first opening (meta.pre)")
    # 7. nothing of the prefetch on the page
    tx = pg.evaluate("() => window.__texts")
    bad = [x for x in tx if re.search(r"getting books|books ready|bringing in|prefetch|from FinCom.s cloud|coming in|loading 20", x, re.I)]
    ok(not bad, "7. nothing of the prefetch is written on the page (no line, toast or progress: %s)" % bad[:3])
    # the timings
    k = until(pg, "window.__fincomTimings && Object.keys(window.__fincomTimings.summary().k).some(k => /^prefetch\\//.test(k))", 20)
    kinds = pg.evaluate("() => window.__fincomTimings ? Object.keys(window.__fincomTimings.summary().k).filter(k => /^prefetch\\//.test(k)) : []")
    ok("prefetch/client" in kinds and "prefetch/all" in kinds, "timings: kinds prefetch/<step> measured (%s)" % kinds)
    # order with this person's recent clients first, then the books' last change; 15 or fewer: all, else the 10 most recent
    od = pg.evaluate("""(ids) => { const out = {recent: [], many: []}; if (typeof Prefetch !== 'object') return out;
      out.recent = Prefetch.order(ids.map(id => ({id})), [ids[1], ids[6]], ids.map((id, i) => ({client_id: id, days_at: '2026-10-' + (10 + i)})));
      const many = Array.from({length: 20}, (_, i) => ({id: 'x' + i})), at = many.map((c, i) => ({client_id: c.id, days_at: '2026-09-' + String(10 + i)}));
      out.many = Prefetch.order(many, ['x3'], at); return out; }""", CIDS)
    ok(od["recent"][:2] == [CIDS[1], CIDS[6]] and od["recent"][2:] == [c for c in ORDER if c not in (CIDS[1], CIDS[6])], "recent clients first, then by last change (%s)" % od["recent"])
    ok(len(od["many"]) == 10 and od["many"][0] == "x3" and od["many"][1] == "x19", "a firm of 20: the 10 most recent only (%s)" % od["many"])

    print("== 2. a prefetched client opened")
    time.sleep(1.5); c2 = ORDER[4]; ts = time.time(); pg.evaluate(OPEN, c2)
    w2 = until(pg, SHOWN % c2, 30, 0.03); time.sleep(2.5)
    rs = [r for r in since(ts) if r["cid"] == c2]
    heavy = [r["kind"] for r in rs if r["kind"] in HEAVY]
    print("     opened from the prefetched copy: entries on screen in %s ms; requests: %s" % (int(w2 * 1000) if w2 is not None else "-", sorted(set(r["kind"] for r in rs))))
    ok(not heavy, "no full read on opening a prefetched client: only the change checks (%s)" % heavy)
    ok(any(r["kind"] == "items-since" for r in rs), "the work: only what changed since the prefetch (client_book_items since its seq)")
    ok(w2 is not None and w2 < 1.5, "its entries on screen with no loading wait (%s ms)" % (int(w2 * 1000) if w2 is not None else "-"))
    wr = [(r["kind"], r["cid"]) for r in since(ts) if r.get("write") and r["cid"] in CIDS and r["cid"] != c2]
    ok(not wr, "no save of another client's books or work (%s)" % wr)

    print("== 8. signing out with 'remove this firm's work'")
    s = time.time()
    while time.time() - s < 20 and (ST["inflight"] > 0 or (LOG and time.time() - LOG[-1]["t0"] < 3)): time.sleep(0.2)
    pg.evaluate("() => signOutHere('Signed out.', true)"); time.sleep(3); pg.wait_for_load_state("load"); time.sleep(2)
    st = stores(pg)
    ok(not any(st.get(c) for c in CIDS), "the prefetched books, days and work are gone from this browser (%s)" % {c: st.get(c) for c in CIDS if st.get(c)})
    ts = time.time(); time.sleep(4)
    ok(not [r for r in since(ts) if r["cid"] in CIDS], "and no prefetch follows the sign-out")
    ctx.close()

    print("== 3. a client opened while it is being prefetched")
    LOG.clear(); ST["delay"] = 0.25; ctx, pg = fresh(); t0 = sign_in(pg, "owner@zz-firm.in")
    c3 = ORDER[0]
    until(pg, "true", 0)
    s = time.time()
    while time.time() - s < 30 and not any(r["cid"] == c3 and r["kind"] in ("month", "dayfile", "ledgers", "thin-all") for r in list(LOG)): time.sleep(0.05)
    ts = time.time(); pg.evaluate(OPEN, c3)
    w3 = until(pg, SHOWN % c3, 60, 0.05); time.sleep(3)
    rs = [r for r in since(t0) if r["cid"] == c3]
    keys = {}
    for r in rs:
        if r["kind"] in HEAVY: keys.setdefault(r["kind"] + " " + r["path"] + json.dumps(r["body"], sort_keys=True), []).append(r)
    twice = [k[:90] for k, v in keys.items() if len(v) > 1]
    print("     opened during its prefetch: entries on screen in %s ms" % (int(w3 * 1000) if w3 is not None else "-"))
    ok(w3 is not None, "its books are whole once open (%s s)" % w3)
    ok(not twice, "nothing fetched twice for it (%s)" % twice[:3])
    ctx.close()

    print("== 4. the person's open of another client goes first")
    LOG.clear(); ctx, pg = fresh(); t0 = sign_in(pg, "owner@zz-firm.in")
    s = time.time()
    while time.time() - s < 30 and not any(r["cid"] == ORDER[0] for r in list(LOG)): time.sleep(0.05)
    time.sleep(0.4)
    c4 = ORDER[-1]; ts = time.time(); pg.evaluate(OPEN, c4)
    w4 = until(pg, SHOWN % c4, 90, 0.05); te = time.time()
    others = [r for r in since(ts + 0.3, te) if r["cid"] in CIDS and r["cid"] != c4]
    print("     %s opened during the prefetch: entries on screen in %s ms; prefetch requests started meanwhile: %d" % (c4, int(w4 * 1000) if w4 else "-", len(others)))
    ok(w4 is not None, "the client opened during the prefetch gets its books (%s s)" % w4)
    ok(not others, "no prefetch request starts while the person's client opens (%s)" % [(r["kind"], r["cid"]) for r in others][:4])
    w = None; s = time.time()
    while time.time() - s < 120:
        st = stores(pg)
        if all(ready(st, c) for c in CIDS): w = time.time() - s; break
        time.sleep(0.5)
    ok(w is not None, "then the prefetch carries on with the rest (all in after %s s)" % (round(w, 1) if w is not None else "-"))
    ctx.close(); ST["delay"] = 0.06

    print("== 5. a connection that saves data")
    for sd, et in (("true", "4g"), ("false", "2g")):
        LOG.clear(); ctx, pg = fresh(SAVEDATA % (sd, et)); t0 = sign_in(pg, "owner@zz-firm.in")
        until(pg, "Object.keys(S.companies || {}).length === %d" % len(CIDS), 30); time.sleep(6)
        rs = [r for r in since(t0) if r["cid"] in CIDS and not r["kind"].startswith("items-")]
        ok(not rs, "saveData=%s, %s: no prefetch (%d requests about clients' books; the due list's reads of their work are its own)" % (sd, et, len(rs)))
        ctx.close()

    print("== 6. a staff member")
    LOG.clear(); ST["staff_denied"] = []; ctx, pg = fresh(); t0 = sign_in(pg, "staff@zz-firm.in")
    until(pg, "Object.keys(S.companies || {}).length === %d" % len(CIDS), 30)
    s = time.time(); w = None
    while time.time() - s < PREFETCH_S:
        st = stores(pg)
        if all(ready(st, c) for c in STAFF_MAY): w = time.time() - s; break
        time.sleep(0.5)
    time.sleep(3); st = stores(pg)
    ok(w is not None, "the clients the staff member may read are prefetched (%s)" % {c: st.get(c) for c in sorted(STAFF_MAY)})
    got = [c for c in CIDS if c not in STAFF_MAY and (st.get(c) or {}).get("n")]
    ok(not got, "no books of a client they may not read (%s)" % got)
    heavy = [(r["kind"], r["cid"]) for r in since(t0) if r["cid"] in CIDS and r["cid"] not in STAFF_MAY and r["kind"] in HEAVY and not r["kind"].startswith("items-")]
    ok(not heavy, "nothing past the database's refusal is asked for those clients (%s)" % heavy[:4])
    ctx.close()

    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
fake.shutdown(); pages.shutdown()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
