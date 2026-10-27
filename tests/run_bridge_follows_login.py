"""python3 run_bridge_follows_login.py - the bridge follows the FinCom login using it (the owner, 27-Oct-2026: "it should not
matter whose computer is opened.. it should matter which login there... every login must have their account").
As found on staging: bridge go-372b35a9cdf6 (NWS144, Windows user NW144\\Durgesh) was paired from a login of firm ABC (A,
key DA); a member of Garg Shekhar & Company (B) signs in to FinCom in that Windows user's browser (which holds the bridge's
local key). The page is the React build; FinCom's cloud is a throwaway PostgreSQL (run_migration115.build: 32 -> 55, then
115) that the page's TCloud.rpc / Cloud.api reach as the signed-in member; the stub FinCom Bridge 2.4.7 on 127.0.0.1:9100
does on POST /cloudlink what bridge-go's setCloudLink does with tally-ingest: own_key with the old key (tally-ingest's
ownKey -> tally_bridge_follow_move as the service role), then hello with the new key (tally_bridge_bind).
  1. A's own owner signed in: the same firm, nothing switched (no key made, nothing sent to /cloudlink, no line).
  2. B's viewer (may not write): nothing switched.
  3. B's owner, with a posting waiting on the bridge in A: nothing switched, tried again later.
  4. The posting done: switched once, by itself, with no code asked: one key of B made, one /cloudlink with it, A's key DA
     revoked in the cloud (its data kept: A's IX DESIGNS row stays), the audit rows asked + done (who, from A, to B), and the
     one quiet line "Tally on this computer now sends to Garg Shekhar & Company".
  5. The next pass: nothing more (the bridge is B's now).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bridge_follows_login.py"""
import hashlib, hmac, json, os, re, sys, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_migration115 as M
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8659
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
q = M.q
KEY, BID, USER = "k" * 40, M.BID, M.USER
OLD = {"dev": M.DA}             # the computer key the bridge holds (its device in the cloud)
BR = {"log": [], "url": ""}
def mac(secret, msg): return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
db = None
def svc(stmt):
    try: return json.loads(db.one(stmt))
    except RuntimeError as e: return {"_error": str(e)[-300:]}

def on_bridge(route):
    req = route.request; u = urlparse(req.url); qs = parse_qs(u.query); path = u.path; origin = req.headers.get("origin", "")
    H = {"Access-Control-Allow-Origin": origin or "*", "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin"}
    if u.port != 9100: return route.abort("connectionrefused")
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=H, body="")
    send = lambda st, o: route.fulfill(status=st, headers=H, content_type="application/json", body=json.dumps(o))
    BR["log"].append((req.method, path))
    if path == "/ping":
        p = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.4.7", "impl": "go", "yours": True, "bridgeId": BID, "port": 9100}
        n = qs.get("n", [""])[0]
        if n and origin: p["proof"] = mac(KEY, n + BID + "9100")
        return send(200, p)
    if path in ("/pair", "/pair2", "/paircode"): return send(403, {"ok": False, "error": "no window open"})
    if req.headers.get("x-bridge-key") != KEY: return send(401, {"ok": False, "error": "Wrong bridge key."})
    if path == "/status": return send(200, {"ok": True, "version": "2.4.7", "sessions": [{"port": 9000, "ok": True, "mine": True, "companies": [{"name": "IX DESIGNS PRIVATE LIMITED - (from 1-Apr-25)"}]}],
                                            "computer": "NWS144", "user": USER, "mode": "auto", "tally": {"state": "open"}})
    if path == "/cloudlink":
        if req.method != "POST": return send(200, {"ok": True, "connected": True, "url": BR["url"]})
        b = json.loads(req.post_data or "{}"); key = b.get("key", "")
        new = db.one("select id::text from tally_devices where key_hash = %s" % q(hashlib.sha256(key.encode()).hexdigest()))
        if not new: return send(400, {"ok": False, "error": "FinCom's cloud did not accept this computer: 401"})
        # bridge-go setCloudLink: own_key (tally-ingest ownKey: an old key of another firm -> tally_bridge_follow_move) ...
        BR["own_key"] = svc("select tally_bridge_follow_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(BID), q(OLD["dev"]), q(new), q(USER)))
        # ... then hello with the new key (the bind, and what the beat reports)
        db.sql("update tally_devices set info = %s, last_seen = now() where id = %s" % (q(M.binfo((BID, USER))), q(new)))
        db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(new), q(BID)))
        OLD["dev"] = new
        return send(200, {"ok": True, "connected": True, "firm": "Garg Shekhar & Company", "device": "NWS144 · NW144\\Durgesh"})
    return send(200, {"ok": True})

WHO = {"uid": M.BO, "firm": M.B, "name": "Garg Shekhar & Company"}
CALLS = []
def rpc(fn, args):
    CALLS.append([fn, args])
    named = ", ".join("%s => %s" % (k, "null" if v is None else q(v)) for k, v in (args or {}).items())
    if not re.match(r"^tally_\w+$", fn): return {"_error": "no such function"}
    try:
        if fn == "tally_device_revoke": db.one("set role authenticated; select tally_device_revoke(%s)::text" % named, WHO["uid"]); return None
        out = db.one("set role authenticated; select %s(%s)::text" % (fn, named), WHO["uid"])
        return json.loads(out) if out else None
    except RuntimeError as e: return {"_error": str(e)[-300:]}
def api(path):
    if path.startswith("tally_devices"):
        return db.rows("select id::text as id, name, main_bridge, info::text as info, created_by::text as created_by, revoked::text as revoked from tally_devices where firm_id = %s" % q(WHO["firm"]))
    return []

SETUP = """([uid, firm, name]) => {
  window.__toasts = window.__toasts || [];
  if (!window.__toastWrapped) { const t = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; window.__toastWrapped = true; }
  Cloud.on = () => true; Cloud.st.firm = firm; Cloud.sess = () => ({user_id: uid});
  Cloud.api = async (path) => (await window.pyApi(path)).map(r => Object.assign({}, r, r.info ? {info: JSON.parse(r.info), revoked: r.revoked === "true"} : {}));
  TCloud.rpc = async (fn, a) => { const r = await window.pyRpc(fn, a || {}); if (r && r._error) throw new Error(r._error); return r; };
  S.firm.firmName = name;
  Bridge.setCfg({key: "%s", bridgeId: "%s", url: "http://127.0.0.1:9100"});
  Bridge.st = Object.assign({}, Bridge.st || {}, {state: "ok", computer: "NWS144", user: "NW144\\\\Durgesh", sessions: [], open: [], at: Date.now(), error: ""});
  TCloud.autoAt = 0; TCloud.autoBusy = false; TCloud.autoErr = "";
  return TCloud.ingestUrl();
}""" % (KEY, BID)
RUN = "async () => { TCloud.autoAt = 0; TCloud.autoBusy = false; await TCloud.auto(); return TCloud.autoErr || ''; }"

def main():
    global db
    db = M.build(31151)
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route(re.compile(r"^http://127\.0\.0\.1:\d+/"), on_bridge)
            pg.expose_function("pyRpc", rpc); pg.expose_function("pyApi", api)
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            def as_member(uid, firm, name):
                WHO.update(uid=uid, firm=firm, name=name); BR["url"] = pg.evaluate(SETUP, [uid, firm, name]); CALLS.clear(); BR["log"].clear(); pg.evaluate("() => { window.__toasts = []; }")
            posts = lambda: [x for x in BR["log"] if x == ("POST", "/cloudlink")]
            made = lambda: [c for c in CALLS if c[0] == "tally_device_create"]
            said = lambda: [t for t in pg.evaluate("() => window.__toasts") if "now sends to" in t]
            revoked = lambda: db.one("select revoked::text from tally_devices where id = %s" % q(M.DA))

            print("1. A's own owner on the computer: the same firm")
            as_member(M.AO, M.A, "ABC"); err = pg.evaluate(RUN)
            ok(not made() and not posts() and not said(), "nothing switched (keys made %d, /cloudlink posts %d) %s" % (len(made()), len(posts()), err))
            ok(revoked() == "false", "A's key stays")

            print("2. B's viewer (may not write)")
            as_member(M.BV, M.B, "Garg Shekhar & Company"); err = pg.evaluate(RUN)
            ok(not made() and not posts() and not said(), "nothing switched for a viewer %s" % err)
            ok(any(c[0] == "tally_bridge_whose" for c in CALLS), "the page asked the cloud whose the bridge is")

            print("3. B's owner, a posting waiting on the bridge in A")
            db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge) values ('00000000-0000-0000-0000-000000000915', %s, 'c1', 'IX', %s, '{}', 1, 'taken', %s)" % (q(M.A), q(M.DA), q(BID)))
            as_member(M.BO, M.B, "Garg Shekhar & Company"); err = pg.evaluate(RUN)
            ok(not made() and not posts() and not said(), "not switched while a posting is in flight %s" % err)
            ok(pg.evaluate("() => TCloud.autoAt - Date.now()") <= 61000, "tried again within a minute")
            ok(revoked() == "false", "A's key stays meanwhile")

            print("4. the posting done: switched once")
            db.sql("update tally_post_jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000915'")
            as_member(M.BO, M.B, "Garg Shekhar & Company"); err = pg.evaluate(RUN)
            ok(len(made()) == 1 and len(posts()) == 1, "one key of B made and handed over (%d, %d) %s" % (len(made()), len(posts()), err))
            ok(not any(x[1] in ("/pair", "/pair2") for x in BR["log"]), "no code asked, no pairing run")
            ok(BR.get("own_key", {}).get("moved") is True, "the cloud moved it: %s" % BR.get("own_key"))
            ok(revoked() == "true", "A's key DA revoked")
            ok(db.one("select count(*) from tally_companies where firm_id = %s" % q(M.A)) == "1", "A's IX DESIGNS row stays")
            sw = M.switches() if M.db is db else []
            ok([s["state"] for s in sw] == ["asked", "done"] and sw[-1]["from_firm"] == M.A and sw[-1]["to_firm"] == M.B and sw[-1]["by_user"] == M.BO, "audit: asked, done; by B's owner, from A to B %s" % [s["state"] for s in sw])
            ok(said() == ["Tally on this computer now sends to Garg Shekhar & Company"], "the one line: %s" % said())

            print("5. the next pass")
            CALLS.clear(); BR["log"].clear(); pg.evaluate("() => { window.__toasts = []; }"); err = pg.evaluate(RUN)
            ok(not made() and not posts() and not said(), "nothing more %s" % err)
            ok(not errors, "no page error %s" % errors[:2])
            br.close()
    finally:
        db.stop(); srv.shutdown()
    print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
    raise SystemExit(1 if fails else 0)
main()
