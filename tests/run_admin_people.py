"""python3 run_admin_people.py - security fix batch 1 (verify-browser-known.md item 3, 27-Oct-2026): the admin function's
"Add person" never makes a login with a password the owner chooses, and never pulls a login in without its owner saying yes.
  - add_person / invite_person, a new email: Supabase's invite email (inviteUserByEmail, redirect_to the app's own page,
    where an invite link asks for the password first); no createUser, no password set or shown (a password in the request
    is ignored); the member row is there for a login that cannot sign in until the link is used;
  - an existing login in no firm: NOT added. A pending invite is kept on the login (app_metadata.fincom_invite: firm,
    role, by, at) and the answer says "Invite sent"; it joins the firm only when that person calls accept_invite
    themselves (signed in as that login); an invite cannot be taken twice, nor by someone it was not made for;
  - a login in another firm: refused as before (409); a login already in this firm (even switched off): refused (409),
    its row unchanged (it is not switched back on from here);
  - staff and look-only members cannot add people (403); nothing is made for them.
The real function (server/security/functions/admin/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py, with GoTrue's admin endpoints added here). Needs Deno (DENO, default: the deno on the PATH or
/opt/deno/deno)."""
import os, sys, json, time, uuid, subprocess, urllib.request, shutil, threading, tempfile
from urllib.parse import urlparse, parse_qs
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
F.PORT = 9377; FN_PORT = 8077
APP = "https://staging.fincom.live/"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, OTHER = "f-1", "f-2"
AUTH = {}            # id -> the login, as GoTrue keeps it
GOTRUE = []          # (method, path, query, body) of each GoTrue admin call
def login(email, confirmed=True, tok=None, invited=False):
    u = {"id": str(uuid.uuid4()), "aud": "authenticated", "role": "authenticated", "email": email, "app_metadata": {"provider": "email"}, "user_metadata": {},
         "email_confirmed_at": "2026-10-01T00:00:00Z" if confirmed else None, "confirmed_at": "2026-10-01T00:00:00Z" if confirmed else None,
         "invited_at": "2026-10-20T00:00:00Z" if invited else None, "created_at": "2026-10-01T00:00:00Z"}
    AUTH[u["id"]] = u
    if tok: F.USERS[tok] = u          # the same record: /auth/v1/user answers it as it is now (its app_metadata too)
    return u
owner = login("owner@a.test", tok="tok-owner"); staff = login("staff@a.test", tok="tok-staff"); look = login("look@a.test", tok="tok-look")
other_owner = login("owner@b.test", tok="tok-other")
loose = login("loose@c.test", tok="tok-loose")                   # a confirmed login in no firm
loose2 = login("loose2@c.test", tok="tok-loose2")
halfway = login("halfway@c.test", confirmed=False, tok="tok-half")   # signed up, email not confirmed yet, no firm
theirs = login("theirs@b.test")
mine = login("mine@a.test"); gone = login("gone@a.test")
F.T["members"] += [{"user_id": owner["id"], "firm_id": FIRM, "role": "owner", "active": True, "email": owner["email"], "name": "Owner"},
                   {"user_id": staff["id"], "firm_id": FIRM, "role": "staff", "active": True, "email": staff["email"], "name": "Staff"},
                   {"user_id": look["id"], "firm_id": FIRM, "role": "readonly", "active": True, "email": look["email"], "name": "Look"},
                   {"user_id": other_owner["id"], "firm_id": OTHER, "role": "owner", "active": True, "email": other_owner["email"], "name": "B"},
                   {"user_id": theirs["id"], "firm_id": OTHER, "role": "staff", "active": True, "email": theirs["email"], "name": "Theirs"},
                   {"user_id": mine["id"], "firm_id": FIRM, "role": "readonly", "active": True, "email": mine["email"], "name": "Mine"},
                   {"user_id": gone["id"], "firm_id": FIRM, "role": "staff", "active": False, "email": gone["email"], "name": "Gone"}]
F.T.setdefault("platform_admins", []); F.T.setdefault("activity", [])

real = F.H.handle_any
def handle_any(self, method):
    u = urlparse(self.path); path = u.path; q = parse_qs(u.query)
    if not (path.startswith("/auth/v1/admin/") or path == "/auth/v1/invite"): return real(self, method)
    raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)) if method in ("POST", "PUT") else b""
    body = json.loads(raw or b"{}"); GOTRUE.append((method, path, q, body))
    if (self.headers.get("Authorization") or "") != "Bearer " + F.SERVICE: return self.send(401, {"msg": "service role only"})
    if path == "/auth/v1/admin/users" and method == "GET":
        page, per = int((q.get("page") or ["1"])[0]), int((q.get("per_page") or ["50"])[0])
        al = list(AUTH.values()); return self.send(200, {"users": al[(page - 1) * per: page * per], "aud": "authenticated"}, {"x-total-count": str(len(al))})
    if path == "/auth/v1/admin/users" and method == "POST":      # createUser: must never be called by "Add person"
        nu = login(body["email"], confirmed=bool(body.get("email_confirm"))); nu["password"] = body.get("password"); return self.send(200, nu)
    if path.startswith("/auth/v1/admin/users/") and method == "PUT":
        x = AUTH.get(path.rsplit("/", 1)[1])
        if not x: return self.send(404, {"msg": "User not found"})
        if "app_metadata" in body: x["app_metadata"] = dict(x["app_metadata"], **body["app_metadata"])
        if "password" in body: x["password"] = body["password"]
        return self.send(200, x)
    if path.startswith("/auth/v1/admin/users/") and method == "GET":
        x = AUTH.get(path.rsplit("/", 1)[1]); return self.send(200, x) if x else self.send(404, {"msg": "User not found"})
    if path == "/auth/v1/invite":
        old = next((x for x in AUTH.values() if x["email"] == body["email"]), None)
        if old and old["email_confirmed_at"]: return self.send(422, {"msg": "A user with this email address has already been registered", "error_code": "email_exists"})
        nu = old or login(body["email"], confirmed=False, invited=True); nu["invited_at"] = "2026-10-27T00:00:00Z"; nu["user_metadata"] = body.get("data") or {}
        return self.send(200, nu)
    if path == "/auth/v1/admin/generate_link":
        return self.send(200, {"action_link": "https://x.supabase.co/auth/v1/verify?token=t&type=" + body.get("type", ""), "email_otp": "", "hashed_token": "t", "redirect_to": body.get("redirect_to"), "verification_type": body.get("type"), **next((x for x in AUTH.values() if x["email"] == body["email"]), {})})
    return self.send(404, {"msg": "no such path " + path})
F.H.handle_any = handle_any
srv = F.start()

# the function listens on its own port (8000 is tally-ingest's in the other tests)
wrap = os.path.join(tempfile.mkdtemp(prefix="admin-fn-"), "serve.ts")
open(wrap, "w").write("const serve = Deno.serve.bind(Deno);\n(Deno as any).serve = (h: any) => serve({ port: %d, hostname: \"127.0.0.1\" }, h);\nawait import(%s);\n"
                      % (FN_PORT, json.dumps("file://" + os.path.abspath(os.path.join(HERE, "..", "server", "security", "functions", "admin", "index.ts")))))
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key", APP_URL=APP)
env.pop("RESEND_API_KEY", None)
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", wrap], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, tok="tok-owner"):
    h = {"Content-Type": "application/json", "Origin": APP.rstrip("/")}
    if tok: h["Authorization"] = "Bearer " + tok
    rq = urllib.request.Request("http://127.0.0.1:%d/" % FN_PORT, data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except ValueError: return e.code, {}
row = lambda uid: next((m for m in F.T["members"] if m["user_id"] == uid), None)
byemail = lambda e: next((x for x in AUTH.values() if x["email"] == e), None)
created = lambda: [g for g in GOTRUE if g[0] == "POST" and g[1] == "/auth/v1/admin/users"]
pw_set = lambda: [g for g in GOTRUE if g[0] == "PUT" and "password" in g[3]]
try:
    t0 = time.time()
    while time.time() - t0 < 120 and not any("Listening" in l for l in log): time.sleep(0.2)
    ok(any("Listening" in l for l in log), "admin started under Deno")

    print("-- a new email: Supabase's invite, never a password")
    for action, mail in (("add_person", "new1@d.test"), ("invite_person", "new2@d.test")):
        n0 = len(GOTRUE)
        c, r = call({"action": action, "email": mail, "name": "New", "role": "staff", "password": "Owner-Chosen-1", "redirect": APP})
        inv = [g for g in GOTRUE[n0:] if g[1] == "/auth/v1/invite"]
        ok(c == 200 and r.get("ok") and r.get("invited") is True, "%s: answered invited (%s %s)" % (action, c, r))
        ok("password" not in r and "Owner-Chosen-1" not in json.dumps(r), "%s: no password in the answer" % action)
        ok(len(inv) == 1 and inv[0][3].get("email") == mail and (inv[0][2].get("redirect_to") or [""])[0] == APP, "%s: inviteUserByEmail with redirect_to the app's page (%s)" % (action, inv[0][2] if inv else None))
        u = byemail(mail)
        ok(u and not u.get("email_confirmed_at") and not u.get("password"), "%s: the login is unconfirmed and has no password until the link is used" % action)
        m = u and row(u["id"])
        ok(m and m["firm_id"] == FIRM and m["role"] == "staff", "%s: the member row is there for that invited login (%s)" % (action, m))
        ok("their password" in str(r.get("note")), "%s: the note says they set their own password (%s)" % (action, r.get("note")))
    ok(not created(), "no createUser call at all (a confirmed login with a chosen password is never made)")
    c, r = call({"action": "add_person", "email": "new1@d.test", "role": "staff"})
    ok(c == 200 and r.get("invited") is True and not created(), "the invite sent again to a person who has not used it yet (%s %s)" % (c, r.get("error")))

    print("-- an existing login in no firm: an invite they must accept")
    for action, who in (("add_person", loose), ("invite_person", loose2)):
        c, r = call({"action": action, "email": who["email"], "name": "Loose", "role": "readonly", "password": "Owner-Chosen-1", "redirect": APP})
        ok(c == 200 and r.get("ok") and r.get("pending") is True and "Invite sent" in str(r.get("note")), "%s: 'Invite sent' (%s %s)" % (action, c, r))
        ok(row(who["id"]) is None, "%s: NOT added to the firm (no member row)" % action)
        inv = (AUTH[who["id"]].get("app_metadata") or {}).get("fincom_invite") or {}
        ok(inv.get("firm_id") == FIRM and inv.get("role") == "readonly" and inv.get("by") == owner["id"], "%s: a pending invite kept on the login (%s)" % (action, inv))
        ok(not AUTH[who["id"]].get("password") and "password" not in r, "%s: their password untouched" % action)
    c, r = call({"action": "add_person", "email": halfway["email"], "role": "staff"})
    ok(c == 200 and r.get("pending") is True and row(halfway["id"]) is None, "an unconfirmed sign-up in no firm: a pending invite too, not added (%s %s)" % (c, r.get("note")))
    ok(not pw_set(), "no password set for anyone")
    c, r = call({"action": "accept_invite"}, "tok-loose2")
    ok(c == 200 and r.get("ok") and r.get("firm_id") == FIRM, "accept_invite by that login: they join (%s %s)" % (c, r))
    m = row(loose2["id"])
    ok(m and m["firm_id"] == FIRM and m["role"] == "readonly" and m["active"] is True and m["email"] == loose2["email"], "the member row made on acceptance, with the invited role (%s)" % m)
    ok(not (AUTH[loose2["id"]]["app_metadata"] or {}).get("fincom_invite"), "the invite is used up")
    c, r = call({"action": "accept_invite"}, "tok-loose2")
    ok(c in (404, 409) and row(loose2["id"])["role"] == "readonly", "an invite cannot be taken twice (%s)" % c)
    c, r = call({"action": "accept_invite"}, "tok-other")
    ok(c in (404, 409) and row(other_owner["id"])["firm_id"] == OTHER, "someone with no invite gets nothing (%s)" % c)
    c, r = call({"action": "accept_invite"}, "tok-half")
    ok(c == 403 and row(halfway["id"]) is None, "an unconfirmed login cannot take its invite (%s)" % c)

    print("-- logins already in a firm")
    c, r = call({"action": "add_person", "email": theirs["email"], "role": "staff"})
    ok(c == 409 and row(theirs["id"])["firm_id"] == OTHER, "a login in another firm: refused (%s)" % c)
    c, r = call({"action": "invite_person", "email": gone["email"], "role": "owner"})
    ok(c == 409 and row(gone["id"])["active"] is False and row(gone["id"])["role"] == "staff", "a switched-off person of this firm: refused, not switched back on (%s)" % c)
    c, r = call({"action": "add_person", "email": mine["email"], "role": "owner"})
    ok(c == 409 and row(mine["id"])["role"] == "readonly", "a person already in the firm: refused, role unchanged (%s)" % c)

    print("-- only the owner adds people")
    for tok in ("tok-staff", "tok-look"):
        n0 = len(GOTRUE); m0 = len(F.T["members"])
        c, r = call({"action": "add_person", "email": "by-" + tok + "@d.test", "role": "owner", "password": "Owner-Chosen-1"}, tok)
        c2, r2 = call({"action": "invite_person", "email": "by2-" + tok + "@d.test", "role": "owner"}, tok)
        ok(c == 403 and c2 == 403, "%s: add_person and invite_person refused (%s %s)" % (tok, c, c2))
        ok(len(F.T["members"]) == m0 and not [g for g in GOTRUE[n0:] if g[0] != "GET"], "%s: nothing made" % tok)
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: fn.kill()
    srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
if fails: print("".join(log[-30:]))
sys.exit(1 if fails else 0)
