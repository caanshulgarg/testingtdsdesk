"""A stand-in for Supabase in front of the assistant's stand-in database (assistant_stand.py), for running the
fincom-assistant function (server/assistant/index.ts) under Deno in the tests. It answers what the function asks, the way
GoTrue, PostgREST and Storage answer it:
  GET  /auth/v1/user                      the user of a token ("tok-<user id>")
  POST /rest/v1/rpc/<fn>                  the function, as the token's user (role authenticated, auth.uid() set: row-level
                                          security as on staging) or, with the service key, as the database's owner
  GET  /rest/v1/<table>?select=..&c=eq.v  a read (as the user, or the service role); lt. and limit= too
  POST /rest/v1/<table>                   an insert by the service role (Prefer: return=representation answers the row)
  GET/POST/DELETE /storage/v1/object/...  the bucket, in memory; a user reads only their firm's folder (the bucket's policy)
Everything it is asked is kept in CALLS (method, path, who) for the tests to check."""
import json, threading, http.server, re
from urllib.parse import urlparse, parse_qs, unquote
SERVICE, ANON = "service-key", "anon-key"
CALLS, FILES, SECRETS = [], {}, {"claude_api_key": "stand-in-key-not-real"}
STATE = {"db": None, "mfa": True}
q = lambda s: "'" + str(s).replace("'", "''") + "'"

def who(headers):
    a = (headers.get("Authorization") or "").replace("Bearer ", "")
    if a == SERVICE: return "service"
    if a.startswith("tok-"): return a[4:]
    return None

def run(sql, uid=None):
    db = STATE["db"]
    pre = "set fincom.uid = '%s'; set role authenticated;\n" % uid if uid else ""
    return db._psql(["-t", "-A", "-q"], pre + sql).strip()

COLTYPES = {}
def coltypes(table):
    if table not in COLTYPES:
        out = run("select coalesce(json_object_agg(column_name, data_type), '{}') from information_schema.columns where table_schema = 'public' and table_name = %s;" % q(table))
        COLTYPES[table] = json.loads(out or "{}")
    return COLTYPES[table]

ARGTYPES = {}
def argtypes(fn):
    if fn not in ARGTYPES:
        out = run("select coalesce(json_agg(json_build_object('n', n, 't', t) order by o), '[]') from (select unnest(p.proargnames) n, unnest(p.proargtypes::regtype[]::text[]) t, generate_subscripts(p.proargtypes::regtype[], 1) o from pg_proc p where p.proname = %s and pronamespace = 'public'::regnamespace limit 50) z;" % q(fn))
        ARGTYPES[fn] = json.loads(out or "[]")
    return ARGTYPES[fn]

def rpc_sql(fn, args):
    j = q(json.dumps(args))
    parts = []
    for a in argtypes(fn):
        n, t = a["n"], a["t"]
        if n not in args: continue
        if t.endswith("[]"): parts.append("%s := array(select jsonb_array_elements_text(%s::jsonb->%s))::%s" % (n, j, q(n), t))
        elif t in ("jsonb", "json"): parts.append("%s := (%s::jsonb->%s)::%s" % (n, j, q(n), t))
        else: parts.append("%s := (%s::jsonb->>%s)::%s" % (n, j, q(n), t))
    return "select to_json(%s(%s));" % (fn, ", ".join(parts))

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj=None, raw=None, ctype="application/json"):
        b = raw if raw is not None else (b"" if obj is None else json.dumps(obj).encode())
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""
    def any(self, method):
        u = urlparse(self.path); path = u.path; qs = parse_qs(u.query); w = who(self.headers)
        CALLS.append((method, path, w))
        try:
            if path == "/auth/v1/user":
                if not w or w == "service": return self.send(401, {"message": "no user"})
                return self.send(200, {"id": w, "aud": "authenticated"})
            if path.startswith("/rest/v1/rpc/"):
                fn = path.split("/")[-1]
                args = json.loads(self.body() or b"{}")
                if fn == "mfa_ok": return self.send(200, STATE["mfa"])
                if not w: return self.send(401, {"message": "no token"})
                out = run(rpc_sql(fn, args), None if w == "service" else w)
                return self.send(200, raw=(out or "null").encode())
            if path.startswith("/rest/v1/"):
                table = path[len("/rest/v1/"):]
                if table == "platform_secrets":
                    if w != "service": return self.send(200, [])
                    n = (qs.get("name") or ["eq."])[0][3:]
                    return self.send(200, [{"value": SECRETS[n]}] if n in SECRETS else [])
                if method == "GET":
                    cols = (qs.get("select") or ["*"])[0]
                    where, lim = [], ""
                    for k, vs in qs.items():
                        if k in ("select", "order"): continue
                        if k == "limit": lim = " limit %d" % int(vs[0]); continue
                        op, _, v = vs[0].partition(".")
                        where.append("%s %s %s" % (k, {"eq": "=", "lt": "<", "gt": ">"}[op], q(unquote(v))))
                    sql = "select coalesce(json_agg(t), '[]') from (select %s from %s%s%s) t;" % (cols, table, " where " + " and ".join(where) if where else "", lim)
                    return self.send(200, raw=run(sql, None if w == "service" else w).encode())
                if method in ("POST", "PATCH"):
                    if not w: return self.send(401, {"message": "no token"})
                    row = json.loads(self.body() or b"{}")
                    cols = list(row.keys())
                    ctypes = coltypes(table)
                    def lit(v, col=None):
                        if v is None: return "null"
                        if col and ctypes.get(col) in ("jsonb", "json"): return q(json.dumps(v)) + "::jsonb"
                        if isinstance(v, bool): return "true" if v else "false"
                        if isinstance(v, (int, float)): return repr(v)
                        if isinstance(v, list) and all(isinstance(x, str) for x in v) and table != "assistant_chats": return "array[%s]::text[]" % ",".join(q(x) for x in v) if v else "'{}'::text[]"
                        if isinstance(v, list): return q(json.dumps(v)) + "::jsonb"
                        if isinstance(v, dict): return q(json.dumps(v)) + "::jsonb"
                        return q(v)
                    if method == "PATCH":
                        where = " and ".join("%s = %s" % (k, q(unquote(vs[0].partition(".")[2]))) for k, vs in qs.items() if vs[0].startswith("eq."))
                        sql = "update %s set %s where %s returning to_json(%s.*);" % (table, ", ".join("%s = %s" % (c, lit(row[c], c)) for c in cols), where or "false", table)
                    elif "merge-duplicates" in (self.headers.get("Prefer") or "") and table == "assistant_cert_settings":
                        sql = "insert into %s (%s) values (%s) on conflict (firm_id) do update set %s returning to_json(%s.*);" % (table, ", ".join(cols), ", ".join(lit(row[c], c) for c in cols), ", ".join("%s = excluded.%s" % (c, c) for c in cols if c != "firm_id"), table)
                    else:
                        sql = "insert into %s (%s) values (%s) returning to_json(%s.*);" % (table, ", ".join(cols), ", ".join(lit(row[c], c) for c in cols), table)
                    out = run(("set role service_role; " + sql) if w == "service" else sql, None if w == "service" else w)
                    return self.send(201, raw=("[" + out + "]").encode() if "return=representation" in (self.headers.get("Prefer") or "") else b"")
            # the certificates (migration 83): a listing of a folder (as the user), and a copy (the service role)
            if path.startswith("/storage/v1/object/list/"):
                bucket = path[len("/storage/v1/object/list/"):]; pre = json.loads(self.body() or b"{}").get("prefix", "")
                firm = run("select my_firm()", w) if w and w != "service" else ""
                if w != "service" and pre.split("/")[0] != firm: return self.send(200, [])
                return self.send(200, [{"name": k[len(bucket) + 1 + len(pre):], "metadata": {"mimetype": v[1]}} for k, v in FILES.items() if k.startswith(bucket + "/" + pre)])
            if path == "/storage/v1/object/copy":
                if w != "service": return self.send(403, {"message": "no"})
                j = json.loads(self.body() or b"{}"); src = j["bucketId"] + "/" + j["sourceKey"]
                if src not in FILES: return self.send(404, {"message": "not found"})
                FILES[j["bucketId"] + "/" + j["destinationKey"]] = FILES[src]
                return self.send(200, {"Key": j["destinationKey"]})
            if path.startswith("/storage/v1/object/"):
                key = unquote(path[len("/storage/v1/object/"):])
                if key.startswith("authenticated/"): key = key[len("authenticated/"):]
                bucket, _, name = key.partition("/")
                if method == "DELETE":
                    if w != "service": return self.send(403, {"message": "no"})
                    for p in json.loads(self.body() or b"{}").get("prefixes", []): FILES.pop(bucket + "/" + p, None)
                    return self.send(200, [])
                if method == "POST":
                    if w != "service":
                        firm = run("select my_firm()", w)
                        if name.split("/")[0] != firm or name.split("/")[2:3] not in (["notices"], ["uploads"]):   # 77 notices/, 84 uploads/
                            return self.send(403, {"message": "new row violates row-level security policy"})
                    FILES[key] = (self.body(), self.headers.get("Content-Type") or "application/octet-stream")
                    return self.send(200, {"Key": key})
                if method == "GET":
                    if key not in FILES: return self.send(404, {"message": "not found"})
                    if w != "service":
                        firm = run("select my_firm()", w) if w else ""
                        if name.split("/")[0] != firm: return self.send(400, {"message": "Object not found"})
                    b, ct = FILES[key]
                    return self.send(200, raw=b, ctype=ct)
            return self.send(404, {"message": "not here: " + path})
        except Exception as e:
            return self.send(500, {"message": str(e)[:800]})
    def do_GET(self): self.any("GET")
    def do_POST(self): self.any("POST")
    def do_DELETE(self): self.any("DELETE")
    def do_PATCH(self): self.any("PATCH")
    def do_OPTIONS(self):
        self.send_response(204); [self.send_header(k, v) for k, v in (('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Headers', '*'), ('Access-Control-Allow-Methods', '*'))]; self.end_headers()

def start(db, port):
    STATE["db"] = db
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
