"""A stand-in for Supabase (REST, auth, storage, and the queue functions of migration-13) on port 9300, in memory, for
running the cloud function tally-ingest (server/tally-cloud/index.ts) under Deno in the tests. Only what that function
asks is answered, the way PostgREST, GoTrue and Storage answer it."""
import json, time, threading, http.server, re, uuid, itertools
from urllib.parse import urlparse, parse_qs, unquote
PORT = 9300
SERVICE = "service-key"
T = {"members": [], "clients": [], "tally_companies": [], "tally_jobs": [], "tally_devices": [], "tally_post_jobs": [], "tally_books": []}
USERS = {}            # bearer token -> {id, email}
FILES = {}            # bucket/path -> bytes
QUEUE = []            # {msg_id, vt, read_ct, message, archived}
DAYS = []             # (book, day, n) of each tally_ingest_day
FAIL = {}             # day -> times tally_ingest_day fails for it before it works
WORK_KEY = "work-key-" + "c" * 32
CALLS = []
SECRETS = {}          # Vault: name -> value (gsp_secret_put / gsp_secret_get, migration-16)
CRON_KEY = "cron-key-" + "d" * 32
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
    if fn == "mfa_ok": return True
    if fn == "tally_book_for": return next((c["book_id"] for c in T["tally_companies"] if c["firm_id"] == a["p_firm"] and c["company"] == a["p_company"]), None)
    if fn == "tally_ingest_day":
        d = a["p_day"].replace("-", "")
        if FAIL.get(d, 0) > 0: FAIL[d] -= 1; raise RuntimeError("the database is busy (test)")
        DAYS.append((a["p_book"], d, a["p_n"])); return {"ok": True}
    if fn == "tally_work_send": m = next(ids); QUEUE.append({"msg_id": m, "vt": 0, "read_ct": 0, "message": a["p_msg"], "archived": False}); return m
    if fn == "tally_work_read":
        out = []
        for q in QUEUE:
            if len(out) >= a["p_n"]: break
            if not q["archived"] and q["vt"] <= now(): q["vt"] = now() + a["p_vt"]; q["read_ct"] += 1; out.append({"msg_id": q["msg_id"], "read_ct": q["read_ct"], "message": q["message"]})
        return out
    if fn == "tally_work_done":
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
    if fn == "tally_post_take":
        for j in T["tally_post_jobs"]:
            if j["device_id"] == a["p_device"] and j["status"] == "waiting": j["status"] = "taken"; return [j]
        return []
    raise RuntimeError("no such function " + fn)
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
            try: return self.send(200, rpc(path.rsplit("/", 1)[1], json.loads(raw or b"{}")))
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
                d = json.loads(raw)
                for r in rows:
                    if match(r, q): r.update(d)
                return self.send(204)
        if path.startswith("/storage/v1/object/list/"):
            b = path.split("/")[-1]; a = json.loads(raw or b"{}"); pre = b + "/" + a.get("prefix", "").strip("/") + "/"
            names = sorted(set(k[len(pre):].split("/")[0] for k in FILES if k.startswith(pre)))
            return self.send(200, [{"name": n, "id": None if "." not in n else n} for n in names])
        if path.startswith("/storage/v1/object/"):
            key = unquote(path[len("/storage/v1/object/"):]).replace("authenticated/", "", 1)
            if method == "POST" or method == "PUT": FILES[key] = raw; return self.send(200, {"Key": key})
            if method == "GET": return self.send(200, raw=FILES[key], headers={"Content-Type": "application/gzip"}) if key in FILES else self.send(404, {"message": "not found"})
        self.send(404, {"message": "no such path " + path})
    def do_GET(self): self.handle_any("GET")
    def do_HEAD(self): self.handle_any("HEAD")
    def do_POST(self): self.handle_any("POST")
    def do_PATCH(self): self.handle_any("PATCH")
    def do_PUT(self): self.handle_any("PUT")
def start():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv
