"""python3 run_admin_coowner.py - the admin function's reset actions (13-Nov-2026, security review M6).
A firm's owner resets the password, or removes the two-step sign-in, only of their own login or of a staff or look-only
member. Never of another owner: that person asks for a reset link themselves (send_reset still goes to their own email).
  - reset_password / reset_two_step on a co-owner: refused (403), no password set, no authenticator removed;
  - on a staff or look-only member, and on the owner's own login: done, as before;
  - a password in the request is not used: the new password is always made up by the function;
  - a person who was an owner and was made staff, or switched off, by another owner is not reset by an owner for 30 days;
  - another firm's person: refused as before; the platform administrator may still do it.
The real function (server/security/functions/admin/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py, with GoTrue's admin endpoints added here). Needs Deno (DENO, else the deno on the PATH)."""
import os, sys, json, time, uuid, subprocess, urllib.request, urllib.error, shutil, threading, tempfile, datetime
from urllib.parse import urlparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
F.PORT = 9378; FN_PORT = 8078
APP = "https://staging.fincom.live/"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, OTHER = "f-1", "f-2"
AUTH, FACTORS, GOTRUE = {}, {}, []
def login(email, tok=None):
    u = {"id": str(uuid.uuid4()), "aud": "authenticated", "role": "authenticated", "email": email, "app_metadata": {"provider": "email"}, "user_metadata": {},
         "email_confirmed_at": "2026-10-01T00:00:00Z", "confirmed_at": "2026-10-01T00:00:00Z", "created_at": "2026-10-01T00:00:00Z", "password": "their-own-" + email}
    AUTH[u["id"]] = u; FACTORS[u["id"]] = [{"id": str(uuid.uuid4()), "factor_type": "totp", "status": "verified", "friendly_name": "phone"}]
    if tok: F.USERS[tok] = u
    return u
owner = login("owner@a.test", "tok-owner"); co = login("partner@a.test", "tok-co"); third = login("third@a.test", "tok-third")
staff = login("staff@a.test", "tok-staff"); look = login("look@a.test"); theirs = login("owner@b.test", "tok-other"); boss = login("admin@fincom.test", "tok-admin")
F.T["members"] += [{"user_id": u["id"], "firm_id": f, "role": r, "active": True, "email": u["email"], "name": u["email"]} for u, f, r in
                   ((owner, FIRM, "owner"), (co, FIRM, "owner"), (third, FIRM, "owner"), (staff, FIRM, "staff"), (look, FIRM, "readonly"), (theirs, OTHER, "owner"))]
F.T["platform_admins"] = [{"user_id": boss["id"]}]; F.T.setdefault("activity", [])
real = F.H.handle_any
def handle_any(self, method):
    path = urlparse(self.path).path
    if not path.startswith("/auth/v1/admin/"): return real(self, method)
    raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)) if method in ("POST", "PUT") else b""
    body = json.loads(raw or b"{}"); GOTRUE.append((method, path, body))
    if (self.headers.get("Authorization") or "") != "Bearer " + F.SERVICE: return self.send(401, {"msg": "service role only"})
    parts = path.split("/")
    if path == "/auth/v1/admin/users" and method == "GET": return self.send(200, {"users": list(AUTH.values()), "aud": "authenticated"})
    uid = parts[5] if len(parts) > 5 else ""
    if uid not in AUTH: return self.send(404, {"msg": "User not found"})
    if len(parts) == 6 and method == "GET": return self.send(200, AUTH[uid])
    if len(parts) == 6 and method == "PUT":
        if "app_metadata" in body: AUTH[uid]["app_metadata"] = dict(AUTH[uid]["app_metadata"], **body["app_metadata"])
        if "password" in body: AUTH[uid]["password"] = body["password"]
        return self.send(200, AUTH[uid])
    if len(parts) == 7 and parts[6] == "factors" and method == "GET": return self.send(200, FACTORS[uid])
    if len(parts) == 8 and parts[6] == "factors" and method == "DELETE":
        FACTORS[uid] = [f for f in FACTORS[uid] if f["id"] != parts[7]]; return self.send(200, {"id": parts[7]})
    return self.send(404, {"msg": "no such path " + path})
F.H.handle_any = handle_any
srv = F.start()
TMP = tempfile.mkdtemp(prefix="admin-co-")
wrap = os.path.join(TMP, "serve.ts")
open(wrap, "w").write("const serve = Deno.serve.bind(Deno);\n(Deno as any).serve = (h: any) => serve({ port: %d, hostname: \"127.0.0.1\" }, h);\nawait import(%s);\n"
                      % (FN_PORT, json.dumps("file://" + os.path.abspath(os.path.join(HERE, "..", "server", "security", "functions", "admin", "index.ts")))))
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key", APP_URL=APP)
env.pop("RESEND_API_KEY", None)
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", wrap], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, tok="tok-owner"):
    rq = urllib.request.Request("http://127.0.0.1:%d/" % FN_PORT, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Origin": APP.rstrip("/"), "Authorization": "Bearer " + tok})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except ValueError: return e.code, {}
row = lambda u: next(m for m in F.T["members"] if m["user_id"] == u["id"])
state = lambda u: (u["password"], len(FACTORS[u["id"]]))
try:
    t0 = time.time()
    while time.time() - t0 < 120 and not any("Listening" in l for l in log): time.sleep(0.2)
    ok(any("Listening" in l for l in log), "admin started under Deno")

    print("-- another owner of the firm")
    before = state(co)
    for action in ("reset_password", "reset_two_step"):
        c, r = call({"action": action, "email": co["email"], "password": "Chosen-By-Caller-1"})
        ok(c == 403 and r.get("ok") is False and r.get("reason") == "owner" and "password" not in r, "%s on a co-owner: refused (%s %s)" % (action, c, r))
    ok(state(co) == before, "the co-owner's password and authenticator are as they were")
    ok(not [a for a in F.T["activity"] if a.get("what") in ("admin.reset_password", "admin.reset_two_step")], "nothing written to the audit trail as done")
    c, r = call({"action": "send_reset", "email": co["email"], "redirect": APP})
    ok(c in (200, 400, 502) and state(co) == before, "a reset link to the co-owner's own email is still theirs to use; nothing is changed by asking (%s)" % c)

    print("-- staff, look-only, and the owner's own login")
    for u in (staff, look):
        c, r = call({"action": "reset_password", "email": u["email"], "password": "Chosen-By-Caller-1"})
        ok(c == 200 and r.get("ok") and r.get("password") == u["password"] and r["password"] != "Chosen-By-Caller-1" and len(r["password"]) >= 16, "reset_password for %s: a made-up password, never the one in the request" % u["email"])
        c, r = call({"action": "reset_two_step", "email": u["email"]})
        ok(c == 200 and r.get("ok") and len(FACTORS[u["id"]]) == 0, "reset_two_step for %s: done" % u["email"])
    c, r = call({"action": "reset_two_step", "email": owner["email"]})
    ok(c == 200 and len(FACTORS[owner["id"]]) == 0, "the owner's own two-step: done")
    c, r = call({"action": "reset_password", "email": owner["email"]})
    ok(c == 200 and r.get("password") == owner["password"], "the owner's own password: done")
    c, r = call({"action": "reset_password", "email": staff["email"]}, tok="tok-staff")
    ok(c == 403, "(guard) a staff member resets nobody")

    print("-- an owner made staff, or switched off, by another owner")
    before = state(third)
    c, r = call({"action": "set_person", "email": third["email"], "role": "staff"})
    ok(c == 200 and row(third)["role"] == "staff", "(guard) an owner may still change a co-owner's role (%s %s)" % (c, r))
    for action in ("reset_password", "reset_two_step"):
        c, r = call({"action": action, "email": third["email"]})
        ok(c == 403 and r.get("reason") == "owner", "%s right after: refused (%s %s)" % (action, c, r))
    ok(state(third) == before, "their password and authenticator are as they were")
    mark = AUTH[third["id"]]["app_metadata"].get("fincom_was_owner")
    ok(bool(mark), "the day they stopped being an owner is kept on the login (by the server only)")
    AUTH[third["id"]]["app_metadata"]["fincom_was_owner"] = (datetime.datetime.utcnow() - datetime.timedelta(days=31)).isoformat() + "Z"
    c, r = call({"action": "reset_password", "email": third["email"]})
    ok(c == 200 and r.get("password") == third["password"], "31 days on: a staff member like any other")
    before = state(co)
    c, r = call({"action": "set_person", "email": co["email"], "active": False})
    c2, r2 = call({"action": "reset_two_step", "email": co["email"]})
    ok(c == 200 and c2 == 403 and state(co) == before, "a co-owner switched off is not reset either (%s %s)" % (c, c2))
    c, r = call({"action": "set_person", "email": staff["email"], "role": "readonly"})
    ok(c == 200 and not AUTH[staff["id"]]["app_metadata"].get("fincom_was_owner"), "(guard) a staff member's role change leaves no mark")

    print("-- others")
    c, r = call({"action": "reset_password", "email": theirs["email"]})
    ok(c == 403 and "not in your firm" in str(r.get("error")), "(guard) another firm's owner: refused as before")
    before = state(co)
    c, r = call({"action": "reset_two_step", "email": co["email"]}, tok="tok-admin")
    ok(c == 200 and len(FACTORS[co["id"]]) == 0, "(guard) the platform administrator may still remove a lost authenticator (%s %s)" % (c, r))
    ok(not any("their-own-" in l or "Chosen-By-Caller" in l for l in log), "no password in the function's log")
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: fn.kill()
    srv.shutdown(); shutil.rmtree(TMP, ignore_errors=True)
print("\n%d failed" % len(fails) if fails else "\nall passed")
if fails: print("".join(log[-30:]))
sys.exit(1 if fails else 0)
