"""A stand-in for Supabase (REST, auth, storage, and the queue functions of migration-13) on port 9300, in memory, for
running the cloud function tally-ingest (server/tally-cloud/index.ts) under Deno in the tests. Only what that function
asks is answered, the way PostgREST, GoTrue and Storage answer it (Storage: also a GET with Range: bytes=a-b, answered 206
with Content-Range, as Supabase Storage does)."""
import json, time, threading, http.server, re, uuid, itertools
from urllib.parse import urlparse, parse_qs, unquote
PORT = 9300
SERVICE = "service-key"
T = {"members": [], "clients": [], "tally_companies": [], "tally_jobs": [], "tally_devices": [], "tally_post_jobs": [], "tally_books": []}
USERS = {}            # bearer token -> {id, email}
FILES = {}            # bucket/path -> bytes
RANGES = []           # (bucket/path, from, to) of each ranged GET (Range: bytes=from-to)
QUEUE = []            # {msg_id, vt, read_ct, message, archived}
DAYS = []             # (book, day, n) of each tally_ingest_day
FAIL = {}             # day -> times tally_ingest_day fails for it before it works
WORK_KEY = "work-key-" + "c" * 32
CALLS = []
BCAST = []            # the Realtime broadcasts sent (POST /realtime/v1/api/broadcast), as JSON
ARGS = {}             # function -> the arguments of each call (the names sent to the ingest functions, migration-23)
SECRETS = {}          # Vault: name -> value (gsp_secret_put / gsp_secret_get, migration-16)
CRON_KEY = "cron-key-" + "d" * 32
# round 21 (docs/reviews/migration-47-48-review.md): hooks for the upload worker's failure cases
LOCK = threading.Lock()   # a PATCH and tally_upload_advance are atomic, as one SQL statement / transaction is
HEAD_DELAY = [0.0]        # seconds a Range bytes=0-0 GET waits before answering (two upload_done calls then overlap)
IGNORE_RANGE = [False]    # Storage answers 200 with the whole object, ignoring Range
SENT = []                 # (bucket/path, bytes written) of each 200 whole-object answer (stops when the client hangs up)
STORAGE_FAIL = {}         # {status, body, n}: the next n Storage GETs answer this
FAIL_INSERT = {}          # table -> {message, code}: a POST answers this PostgREST error
FAIL_DONE = {"upload": 0} # the next n tally_work_done of an upload piece fail
FAIL_DAY = {}             # day -> n: the next n calls queuing a day file of that day fail (tally_work_send / tally_upload_advance)
NO_FN = set()             # functions this database does not have yet (an older cloud): PostgREST's 404 PGRST202
LEASE7_MISSING = [False]  # migration 55 not run: the 7-argument tally_lease_take (p_purpose) is not there (PGRST202 for that call only)
PK = {"gst_sessions": ["firm_id", "gstin"], "gst_returns": ["firm_id", "gstin", "form", "period"], "gst_einv_accounts": ["firm_id", "gstin"], "gst_einvoices": ["firm_id", "gstin", "doc_key"]}
ids = itertools.count(1)
def now(): return time.time()
def match(row, q):
    for k, vs in q.items():
        if k in ("select", "order", "limit", "offset", "on_conflict", "columns"): continue
        v = vs[0]
        op, _, val = v.partition(".")
        cell = row.get(k)
        cs = "" if cell is None else str(cell).lower() if isinstance(cell, bool) else str(cell)
        if op == "eq" and cs != val: return False
        if op == "neq" and cs == val: return False
        if op == "lt" and not cs < val: return False
        if op == "gt" and not cs > val: return False
        if op == "is" and val == "null" and cell is not None: return False
        if op == "in" and cs not in val.strip("()").split(","): return False
    return True
def rpc(fn, a):
    ARGS.setdefault(fn, []).append(a)
    if fn == "mfa_ok": return True
    if fn == "tally_ingest_ledgers_g": return {"ok": True, "ledgers": len(a.get("p_ledgers") or []), "groups": len(a.get("p_groups") or [])}
    if fn == "tally_year_openings": return {"ok": True, "moved": 0, "ledgers": 0, "twins": 0}
    if fn == "tally_book_for": return next((c["book_id"] for c in T["tally_companies"] if c["firm_id"] == a["p_firm"] and c["company"] == a["p_company"]), None)
    if fn == "tally_ingest_day":
        d = a["p_day"].replace("-", "")
        if FAIL.get(d, 0) > 0: FAIL[d] -= 1; raise RuntimeError("the database is busy (test)")
        DAYS.append((a["p_book"], d, a["p_n"])); return {"ok": True}
    if fn == "tally_work_send":
        fail_day([a["p_msg"]])
        m = next(ids); QUEUE.append({"msg_id": m, "vt": 0, "read_ct": 0, "message": a["p_msg"], "archived": False}); return m
    if fn == "tally_upload_advance":          # migration 47 (review M3): the piece's messages queued once, the cursor moved, in one go
        with LOCK:
            j = next((x for x in T["tally_jobs"] if x["id"] == a["p_job"] and x.get("kind") == "upload"), None)
            if not j: raise RuntimeError("no such upload")
            up = j.get("upload") or {}
            if "at" in up and up["at"] != a["p_at"]: return {"ok": True, "moved": False, "at": up["at"]}
            msgs = a.get("p_msgs") or []
            if any(not isinstance(m_, dict) or m_.get("job") != a["p_job"] for m_ in msgs): raise RuntimeError("a piece of another job")
            fail_day(msgs)
            for m_ in msgs: QUEUE.append({"msg_id": next(ids), "vt": 0, "read_ct": 0, "message": m_, "archived": False})
            j["upload"] = dict(up, at=a.get("p_next") or "end"); j["total"] = j.get("total", 0) + max(0, a.get("p_late") or 0)
            return {"ok": True, "moved": True, "sent": len(msgs)}
    if fn == "tally_work_read":
        out = []
        for q in QUEUE:
            if len(out) >= a["p_n"]: break
            if not q["archived"] and q["vt"] <= now(): q["vt"] = now() + a["p_vt"]; q["read_ct"] += 1; out.append({"msg_id": q["msg_id"], "read_ct": q["read_ct"], "message": q["message"]})
        return out
    if fn == "tally_work_done":
        q0 = next((q for q in QUEUE if q["msg_id"] == a["p_msg"]), None)
        if q0 and isinstance((q0["message"] or {}).get("upload"), dict) and FAIL_DONE["upload"] > 0:
            FAIL_DONE["upload"] -= 1; raise RuntimeError("the database is busy (test)")
        for q in QUEUE:
            if q["msg_id"] == a["p_msg"]: q["archived"] = True
        return True
    if fn == "tally_job_step":
        for j in T["tally_jobs"]:
            if j["id"] == a["p_job"]:
                j["done"] += a["p_done"] or 0; j["bad"] = j["bad"] + (a["p_bad"] or [])
                j["status"] = "failed" if a.get("p_failed") else ("done" if j["sealed"] and j["done"] >= j["total"] else "running")
                if a.get("p_failed"): j["message"] = a["p_failed"][:300]
        return None
    if fn == "tally_work_key_ok": return a.get("p_key") == WORK_KEY
    if fn == "gsp_secret_put":
        if not a["p_name"].startswith("gsp:"): raise RuntimeError("not a GST secret")
        SECRETS[a["p_name"]] = a["p_value"]; return "sec-" + a["p_name"]
    if fn == "gsp_secret_get": return SECRETS.get(a["p_name"]) if a["p_name"].startswith("gsp:") else None
    if fn == "gst_cron_ok": return a.get("k") == CRON_KEY
    if fn == "tally_bridge_bind":       # migration 54 (review M3, M-A): a bridge id belongs to the first of the firm's computers that reports it
        bound = T.setdefault("tally_bridge_ids", [])
        if not re.match(r"^go-[0-9a-f]{6,32}$", a.get("p_bridge") or ""): return {"own": True}
        firm = next((x.get("firm_id") for x in T["tally_devices"] if x["id"] == a["p_device"]), None)
        hit = next((x for x in bound if x["bridge_id"] == a["p_bridge"] and x.get("firm_id") == firm), None)
        if not hit: hit = {"bridge_id": a["p_bridge"], "device_id": a["p_device"], "firm_id": firm}; bound.append(hit)
        if hit["device_id"] == a["p_device"]: return {"own": True}
        d = next((x for x in T["tally_devices"] if x["id"] == hit["device_id"]), {}); e = ((d.get("info") or {}).get("bridges") or {}).get(a["p_bridge"]) or {}
        return {"own": False, "words": "This computer key cannot use bridge %s: it belongs to %s. Ask the firm's owner." % (a["p_bridge"], " · ".join(x for x in (e.get("computer"), e.get("user")) if x) or d.get("name", ""))}
    if fn == "tally_post_take_for":     # migration 54: the oldest waiting posting of the computer for this bridge (or none named, when main)
        if any(p.get("device_id") == a["p_device"] and p.get("bridge_id") == a["p_bridge"] and p.get("changes_only") for p in T.get("tally_bridge_prefs", [])): return []
        if not any(a["p_bridge"] in ((d.get("info") or {}).get("bridges") or {}) for d in T["tally_devices"] if d["id"] == a["p_device"]): return []
        for j in sorted(T["tally_post_jobs"], key=lambda j: j.get("created_at") or ""):
            if j["device_id"] == a["p_device"] and j["status"] == "waiting" and (j.get("target_bridge") == a["p_bridge"] or (j.get("target_bridge") is None and a.get("p_main"))):
                j["status"] = "taken"; return [j]
        return []
    if fn == "tally_post_rescue":       # migration 54 (review M-B): a computer's waiting postings for a bridge that may no longer post: moved to its main bridge
        # (the owner's rule of 05-Oct-2026: only the main bridge of the SAME Windows user stops a bridge, and a posting moves only to it)
        d = next((x for x in T["tally_devices"] if x["id"] == a["p_device"]), {}); main = d.get("main_bridge"); bs = (d.get("info") or {}).get("bridges") or {}
        u = lambda b: str((bs.get(b) or {}).get("user") or "").strip().lower()
        same = lambda t: bool(main) and main in bs and u(main) == u(t)
        co = {p.get("bridge_id") for p in T.get("tally_bridge_prefs", []) if p.get("device_id") == a["p_device"] and p.get("changes_only")}
        moved = failed = 0
        for j in T["tally_post_jobs"]:
            t = j.get("target_bridge")
            if j["device_id"] != a["p_device"] or j["status"] != "waiting" or not t or ((not same(t) or main == t) and t not in co): continue
            if same(t) and main not in co: j["target_bridge"] = main; moved += 1
            else: j["status"] = "failed"; failed += 1
        return {"ok": True, "moved": moved, "failed": failed}
    if fn == "tally_post_checks_for":   # migration 55 (decision B): the waiting checks of this bridge's postings
        out = []
        for c in T.get("tally_post_checks", []):
            j = next((x for x in T["tally_post_jobs"] if x["id"] == c["job_id"]), None)
            if c.get("state") != "waiting" or not j or j["device_id"] != a["p_device"]: continue
            if not (j.get("target_bridge") == a["p_bridge"] or (j.get("target_bridge") is None and a.get("p_main"))): continue
            xml = next((v.get("xml") for v in (j.get("payload") or {}).get("vouchers", []) if v.get("id") == c["entry_id"]), None)
            out.append({"check": c["id"], "job": j["id"], "entry": c["entry_id"], "company": j["company"], "why": c.get("why"), "xml": xml})
        return out
    if fn == "tally_post_check_report":  # migration 55: the bridge's answer (the SQL is tested on pg_stand: run_migration55.py)
        return {"ok": True, "state": "waiting" if a.get("p_result") == "unable" else a.get("p_result"), "check": a.get("p_check")}
    if fn == "tally_lease_take":        # 32/37 (6 arguments) and 55 (7, p_purpose): free unless the test says otherwise
        if "p_purpose" in a and LEASE7_MISSING[0]: raise LookupError("PGRST202")
        return {"ok": True, "held": False, "purpose": a.get("p_purpose") or "", "lease": {"until": "2026-10-05T12:00:00Z", "ttl": a.get("p_ttl")}}
    if fn == "tally_lease_release": return {"ok": True, "released": True}
    if fn == "tally_post_take":
        for j in T["tally_post_jobs"]:
            if j["device_id"] == a["p_device"] and j["status"] == "waiting": j["status"] = "taken"; return [j]
        return []
    raise RuntimeError("no such function " + fn)
def fail_day(msgs):
    for m_ in msgs:
        for d in ((m_ or {}).get("days") or []):
            if FAIL_DAY.get(d.get("day"), 0) > 0: FAIL_DAY[d["day"]] -= 1; raise RuntimeError("the database is busy (test)")
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj=None, headers=None, raw=None):
        b = raw if raw is not None else (json.dumps(obj).encode() if obj is not None else b"")
        self.send_response(code)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        if raw is None: self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0); return self.rfile.read(n) if n else b""
    def who(self):
        t = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        return "service" if t == SERVICE else USERS.get(t)
    def handle_any(self, method):
        u = urlparse(self.path); path = u.path; q = parse_qs(u.query, keep_blank_values=True); raw = self.body() if method in ("POST", "PATCH") else b""
        CALLS.append((method, path))
        if path == "/auth/v1/user":
            w = self.who(); return self.send(200, w) if isinstance(w, dict) else self.send(401, {"msg": "bad token"})
        if path.startswith("/rest/v1/rpc/"):
            if path.rsplit("/", 1)[1] in NO_FN:
                return self.send(404, {"code": "PGRST202", "message": "Could not find the function public.%s in the schema cache" % path.rsplit("/", 1)[1], "details": None, "hint": None})
            try: return self.send(200, rpc(path.rsplit("/", 1)[1], json.loads(raw or b"{}")))
            except LookupError:   # an overload this database does not have (PostgREST answers 404 PGRST202)
                return self.send(404, {"code": "PGRST202", "message": "Could not find the function public.%s with those arguments in the schema cache" % path.rsplit("/", 1)[1], "details": None, "hint": None})
            except Exception as e: return self.send(400, {"message": str(e), "code": "P0001"})
        if path.startswith("/rest/v1/"):
            t = path.rsplit("/", 1)[1]; rows = T.setdefault(t, []); single = "vnd.pgrst.object" in (self.headers.get("Accept") or "")
            if method in ("GET", "HEAD"):
                hit = [r for r in rows if match(r, q)]
                sel = (q.get("select") or ["*"])[0]
                if t.startswith("gst_") and sel != "*" and "(" not in sel:      # the columns asked for (gst-taxpro's tests)
                    cols = [c.strip() for c in sel.split(",")]; hit = [{c: r.get(c) for c in cols} for r in hit]
                if method == "HEAD" or "count=exact" in (self.headers.get("Prefer") or ""):
                    return self.send(200, None if method == "HEAD" else hit, {"Content-Range": "*/%d" % len(hit)})
                if single: return self.send(200, hit[0]) if len(hit) == 1 else self.send(406, {"message": "not one row"})
                return self.send(200, hit)
            if method == "POST" and t in FAIL_INSERT:
                return self.send(400, dict(FAIL_INSERT[t], details=None, hint=None))
            if method == "POST":
                data = json.loads(raw); data = data if isinstance(data, list) else [data]; out = []
                keys = (q.get("on_conflict") or [""])[0].split(",") if q.get("on_conflict") else PK.get(t)
                for d in data:
                    d = dict(d)
                    if t == "tally_jobs":
                        d = dict({"id": str(uuid.uuid4()), "status": "queued", "total": 0, "done": 0, "sealed": False, "bad": [], "message": "", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}, **d)
                    old = next((r for r in rows if keys and all(str(r.get(k)) == str(d.get(k)) for k in keys)), None)
                    if old: old.update(d); out.append(old)
                    else: rows.append(d); out.append(d)
                if "return=representation" in (self.headers.get("Prefer") or ""):
                    return self.send(201, out[0] if single else out)
                return self.send(201)
            if method == "PATCH":
                d = json.loads(raw); hit = []
                with LOCK:                                   # one UPDATE ... WHERE ... RETURNING: atomic
                    for r in rows:
                        if match(r, q): r.update(d); hit.append(r)
                if "return=representation" in (self.headers.get("Prefer") or ""):
                    return self.send(200, hit[0] if single and hit else hit)
                return self.send(204)
        if path == "/realtime/v1/api/broadcast":                      # the firm's broadcast channel (index.ts broadcast()): the messages kept for the tests
            try: BCAST.append(json.loads(raw or b"{}"))
            except Exception: BCAST.append({"raw": raw.decode("utf-8", "replace")})
            return self.send(202)
        if path.startswith("/storage/v1/object/list/"):
            b = path.split("/")[-1]; a = json.loads(raw or b"{}"); pre = b + "/" + a.get("prefix", "").strip("/") + "/"
            names = sorted(set(k[len(pre):].split("/")[0] for k in FILES if k.startswith(pre)))
            return self.send(200, [{"name": n, "id": None if "." not in n else n} for n in names])
        if path.startswith("/storage/v1/object/"):
            key = unquote(path[len("/storage/v1/object/"):]).replace("authenticated/", "", 1)
            if method == "POST" or method == "PUT": FILES[key] = raw; return self.send(200, {"Key": key})
            if method == "GET":
                if key not in FILES: return self.send(404, {"message": "not found"})
                if STORAGE_FAIL.get("n", 0) > 0:
                    STORAGE_FAIL["n"] -= 1; return self.send(STORAGE_FAIL["status"], raw=STORAGE_FAIL["body"].encode(), headers={"Content-Type": "text/plain"})
                if (self.headers.get("Range") or "").strip() == "bytes=0-0" and HEAD_DELAY[0]: time.sleep(HEAD_DELAY[0])
                if IGNORE_RANGE[0] and self.headers.get("Range"):     # a proxy or backend that ignores Range: the whole object, 200
                    data = FILES[key]; RANGES.append((key, 0, len(data) - 1)); n = 0
                    self.send_response(200); self.send_header("Content-Type", "application/octet-stream"); self.send_header("Content-Length", str(len(data))); self.end_headers()
                    try:
                        for i in range(0, len(data), 65536): self.wfile.write(data[i:i + 65536]); n += len(data[i:i + 65536])
                    except (BrokenPipeError, ConnectionResetError, OSError): pass
                    SENT.append((key, n)); self.close_connection = True; return
                rg = re.match(r"bytes=(\d+)-(\d*)$", (self.headers.get("Range") or "").strip())
                if rg:                                                    # a byte range (tally-ingest's upload worker, round 20)
                    data = FILES[key]; a = int(rg.group(1)); b = int(rg.group(2)) if rg.group(2) else len(data) - 1
                    RANGES.append((key, a, b))
                    if a >= len(data): return self.send(416, {"message": "range not satisfiable"}, {"Content-Range": "bytes */%d" % len(data)})
                    b = min(b, len(data) - 1)
                    return self.send(206, raw=data[a:b + 1], headers={"Content-Type": "application/octet-stream", "Content-Range": "bytes %d-%d/%d" % (a, b, len(data))})
                return self.send(200, raw=FILES[key], headers={"Content-Type": "application/gzip"})
        self.send(404, {"message": "no such path " + path})
    def do_GET(self): self.handle_any("GET")
    def do_HEAD(self): self.handle_any("HEAD")
    def do_POST(self): self.handle_any("POST")
    def do_PATCH(self): self.handle_any("PATCH")
    def do_PUT(self): self.handle_any("PUT")
def start():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv
