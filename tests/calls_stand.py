"""The stand for FinCom's call tests (run_video_calls_ui.py, run_work_together_ui.py, run_remote_help_ui.py): the built app
served here, Chromium with fake camera and microphone, and in this one Python process:
  - Supabase Realtime, faked (Playwright's route_web_socket): Phoenix channel joins, broadcast to the others on a topic,
    presence (state and diffs), heartbeats; every frame kept per topic so a test can read what travelled
  - the fincom-call function, faked with the same rules (who hosts, waiting room, removed people, recording allowed,
    guests never on the working-together channel); every call kept
  - Storage's signed uploads (the bytes kept), PostgREST for the few reads the call windows make, and a save path that
    keeps the database's own rule: a look-only member's write is refused (42501), each write recorded with its token
Nothing real is reached: no Supabase, no Cloudflare, no Groq, no Anthropic."""
import os, json, threading, functools, http.server, urllib.parse, secrets, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("CALL_SHOTS", "")
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
        "--disable-features=WebRtcHideLocalIpsWithMdns", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
USERS = {
    "tok-staff": {"id": "aaaaaaaa-0000-4000-8000-000000000002", "role": "staff", "name": "Riya Staff", "email": "riya@firm.test"},
    "tok-owner": {"id": "aaaaaaaa-0000-4000-8000-000000000001", "role": "owner", "name": "Anshul Owner", "email": "anshul@firm.test"},
    "tok-look": {"id": "aaaaaaaa-0000-4000-8000-000000000003", "role": "readonly", "name": "Lata Look", "email": "lata@firm.test"},
}
CLIENT = "c-call-1"
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-upsert", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS"}

def serve(port):
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=SITE))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

class Checks:
    def __init__(self): self.fails = []; self.errors = []
    def ok(self, c, w):
        print(("  ok   " if c else "  FAIL ") + w)
        if not c: self.fails.append(w)
    def done(self):
        real = [e for e in self.errors if "supabase" not in e.lower() and "Failed to fetch" not in e]
        self.ok(not real, "no page errors (%s)" % real[:3])
        print("\n" + (str(len(self.fails)) + " FAILED" if self.fails else "all passed"))
        raise SystemExit(1 if self.fails else 0)

# ---------------------------------------------------------------- Supabase Realtime, faked
class Hub:
    def __init__(self):
        self.members = {}        # topic -> {id(ws): {"ws", "key", "meta", "join"}}
        self.frames = {}         # topic -> [message dicts sent by browsers]
        self.n = 0
    def handler(self, ws):
        me = {"topics": set()}
        def send(m):
            try: ws.send(json.dumps(m))
            except Exception: pass
        def diff(topic, joins, leaves):
            for x in list(self.members.get(topic, {}).values()):
                try: x["ws"].send(json.dumps({"topic": topic, "event": "presence_diff", "payload": {"joins": joins, "leaves": leaves}}))
                except Exception: pass
        def leave(topic):
            row = self.members.get(topic, {}).pop(id(ws), None)
            if row and row.get("meta"): diff(topic, {}, {row["key"]: {"metas": [row["meta"]]}})
        def on_message(raw):
            m = json.loads(raw)
            t, ev = m.get("topic"), m.get("event")
            if t == "phoenix": return send({"topic": "phoenix", "event": "phx_reply", "payload": {"status": "ok", "response": {}}, "ref": m.get("ref")})
            self.frames.setdefault(t, []).append(m)
            if ev == "phx_join":
                key = (((m.get("payload") or {}).get("config") or {}).get("presence") or {}).get("key") or ""
                self.members.setdefault(t, {})[id(ws)] = {"ws": ws, "key": key, "meta": None}
                me["topics"].add(t)
                send({"topic": t, "event": "phx_reply", "payload": {"status": "ok", "response": {}}, "ref": m.get("ref"), "join_ref": m.get("ref")})
                state = {}
                for x in self.members[t].values():
                    if x["meta"]: state.setdefault(x["key"], {"metas": []})["metas"].append(x["meta"])
                send({"topic": t, "event": "presence_state", "payload": state})
            elif ev == "presence":
                row = self.members.get(t, {}).get(id(ws))
                if not row: return
                self.n += 1
                old = row["meta"]; row["meta"] = dict((m["payload"] or {}).get("payload") or {}, phx_ref="r%d" % self.n)
                diff(t, {row["key"]: {"metas": [row["meta"]]}}, {row["key"]: {"metas": [old]}} if old else {})
            elif ev == "broadcast":
                for k, x in list(self.members.get(t, {}).items()):
                    if k != id(ws):
                        try: x["ws"].send(json.dumps({"topic": t, "event": "broadcast", "payload": m.get("payload")}))
                        except Exception: pass
            elif ev == "phx_leave":
                leave(t)
        def on_close(*a):
            for t in list(me["topics"]): leave(t)
        ws.on_message(on_message)
        ws.on_close(on_close)
    def topics_of(self, pred):
        return [t for t in self.frames if pred(t)]

# ---------------------------------------------------------------- the fincom-call function, faked
class Fn:
    def __init__(self, allow_recording=True):
        self.allow = allow_recording
        self.rooms, self.people, self.invites, self.msgs, self.recs, self.pieces, self.uploads, self.tasks, self.remote, self.calls = {}, {}, {}, [], {}, [], [], [], [], []
        self.codes = {}
    def session(self, r, p):
        rec = next((x for x in self.recs.values() if x["room"] == r["id"] and not x.get("ended")), None)
        return {"ok": True, "room": {k: r[k] for k in ("id", "kind", "title", "client_id", "batch_id", "status", "host_user", "cowork_on", "started_at")},
                "me": {"id": p["id"], "role": p["role"], "name": p["name"], "state": p["state"]}, "topic": "call:%s-e%d" % (r["id"][:8], r["epoch"]),
                "ice": [], "mode": "p2p", "max": 4, "recording": {"id": rec["id"], "notice": "This call is being recorded"} if rec else None}
    def handle(self, body, tok):
        a = body.get("action"); self.calls.append({"action": a, "tok": tok, "gt": body.get("gt"), "body": body})
        u = USERS.get(tok)
        gp = self.people.get((body.get("gt") or "")[3:]) if body.get("gt") else None
        def err(code, msg, kind="other"): return code, {"ok": False, "error": msg, "kind": kind}
        def room_of(): return self.rooms.get(gp["room"]) if gp else self.rooms.get(body.get("room_id"))
        def me_in(r): return gp if gp else next((p for p in self.people.values() if p["room"] == r["id"] and p.get("user") == (u or {}).get("id")), None)
        if a == "guest_hello":
            inv = self.invites.get(body.get("token"))
            if not inv: return err(404, "This link is not a FinCom call link.", "link")
            r = self.rooms[inv]
            return 200, {"ok": True, "title": r["title"], "firm": "Garg & Co", "kind": r["kind"], "status": r["status"], "mail": True}
        if a == "guest_start":
            inv = self.invites.get(body.get("token"))
            if not inv: return err(404, "bad link", "link")
            pid = "99999999-0000-4000-8000-%012d" % (len(self.people) + 1)
            self.people[pid] = {"id": pid, "room": inv, "role": "guest", "name": body["name"], "email": body["email"], "state": "waiting", "verified": False}
            self.codes[pid] = "424242"
            return 200, {"ok": True, "gt": "gt-" + pid, "code_sent": True, "mail": True}
        if body.get("gt"):
            if not gp: return err(401, "pass", "guest")
            if a not in ("guest_verify", "guest_poll", "topic", "chat", "history_chat", "upload", "download", "consent", "piece", "cf", "leave"): return err(403, "A guest cannot do that.", "guest")
            if a == "guest_verify":
                if body.get("code") != self.codes.get(gp["id"]): return err(400, "That code is not right.", "otp")
                gp["verified"] = True; return 200, {"ok": True, "verified": True}
            if a == "guest_poll":
                r = self.rooms[gp["room"]]
                if r["status"] == "ended": return 200, {"ok": True, "state": "ended"}
                if gp["state"] != "admitted": return 200, {"ok": True, "state": gp["state"], "verified": gp["verified"]}
                return 200, dict(self.session(r, gp), state="admitted")
        elif not u: return err(401, "Sign in to the firm account first.", "auth")
        if a == "start":
            if u["role"] not in ("owner", "staff"): return err(403, "A look-only member can join a call but not start one.", "role")
            r = next((x for x in self.rooms.values() if x["status"] == "open" and x["client_id"] == body.get("client_id") and body.get("kind") == "client"), None)
            if not r:
                rid = "cccccccc-0000-4000-8000-%012d" % (len(self.rooms) + 1)
                r = self.rooms[rid] = {"id": rid, "kind": body.get("kind"), "title": "Call with Client One" if body.get("kind") == "client" else body.get("title") or "Help call", "client_id": body.get("client_id"),
                                       "batch_id": body.get("batch_id"), "status": "open", "host_user": u["id"], "cowork_on": False, "started_at": "2026-10-23T05:00:00Z", "epoch": 1}
            return 200, self.session(r, self._join(r, u))
        if a == "join":
            r = self.rooms.get(body.get("room_id"))
            if not r or r["status"] == "ended": return err(410, "This call has ended.", "ended")
            return 200, self.session(r, self._join(r, u))
        if a in ("rec_part", "rec_stop"):
            rec = self.recs.get(body.get("recording_id"))
            if not rec: return err(404, "Not your recording.")
            if a == "rec_part": rec["parts"] += 1; rec["bytes"] += body.get("bytes", 0)
            else: rec["ended"] = True
            return 200, {"ok": True}
        if a == "history": return 200, {"ok": True, "rooms": [{k: r[k] for k in ("id", "kind", "title", "status", "client_id", "batch_id", "started_at")} for r in self.rooms.values() if r["client_id"] == body.get("client_id")]}
        r = room_of()
        if not r: return err(404, "no room", "room")
        p = me_in(r)
        host = bool(u) and (r["host_user"] == u["id"] or u["role"] == "owner")
        if a == "roster":
            return 200, {"ok": True, "people": [dict(id=x["id"], user_id=x.get("user"), name=x["name"], email=x.get("email", "") if host else "", role=x["role"], state=x["state"], verified=x.get("verified", True))
                         for x in self.people.values() if x["room"] == r["id"] and x["state"] in ("waiting", "admitted") and (host or x["state"] == "admitted")], "host": host, "status": r["status"], "cowork_on": r["cowork_on"]}
        if a == "invite":
            t = secrets.token_urlsafe(32)[:43].ljust(43, "x"); self.invites[t] = r["id"]
            url = body.get("base", "").split("#")[0] + "#join=" + t
            return 200, {"ok": True, "token": t, "url": url, "text": "Join: " + url, "emailed": False, "mail": True}
        if a in ("admit", "deny", "remove"):
            if not host: return err(403, "Only the host can do that.", "host")
            x = self.people.get(body.get("participant_id"))
            if not x: return err(404, "not in call")
            x["state"] = {"admit": "admitted", "deny": "denied", "remove": "removed"}[a]
            if a == "remove": r["epoch"] += 1; return 200, {"ok": True, "rekey": True, "topic": "call:%s-e%d" % (r["id"][:8], r["epoch"])}
            return 200, {"ok": True}
        if a == "topic":
            if not p or p["state"] != "admitted": return err(403, "You are not in this call.", "notin")
            return 200, {"ok": True, "topic": "call:%s-e%d" % (r["id"][:8], r["epoch"]), "status": r["status"]}
        if a in ("chat", "history_chat", "upload", "download", "consent", "piece", "cf") and (not p or p["state"] != "admitted") and not (a in ("piece", "consent") and p): return err(403, "You are not in this call.", "notin")
        if a == "chat":
            m = {"id": len(self.msgs) + 1, "participant_id": p["id"], "author": p["name"], "body": body.get("body", ""), "file": body.get("file"), "at": "2026-10-23T05:01:00Z", "room": r["id"]}
            self.msgs.append(m); return 200, {"ok": True, "message": m}
        if a == "history_chat": return 200, {"ok": True, "messages": [m for m in self.msgs if m["room"] == r["id"]]}
        if a == "upload":
            what = body.get("what"); path = "firm/client/%s/%s/%s-%s" % (r["id"], what, p["id"][:8], body.get("seq", body.get("name", "f")))
            if what == "chat" and body.get("size", 0) > 20 * 1024 * 1024: return err(413, "A file may be at most 20 MB.", "size")
            if what == "rec" and not host: return err(403, "Only the host records.", "host")
            return 200, {"ok": True, "bucket": "call-files" if what == "chat" else "call-recordings", "path": path, "url": "https://stand.supabase.co/storage/v1/object/upload/sign/b/" + urllib.parse.quote(path) + "?token=t"}
        if a == "download": return 200, {"ok": True, "url": "https://stand.supabase.co/storage/v1/object/sign/x?token=d"}
        if a == "rec_start":
            if not host: return err(403, "Only the host can record.", "host")
            if not self.allow: return err(403, "Recording is off for this client.", "recoff")
            rid = "dddddddd-0000-4000-8000-%012d" % (len(self.recs) + 1); self.recs[rid] = {"id": rid, "room": r["id"], "parts": 0, "bytes": 0}
            return 200, {"ok": True, "recording_id": rid, "notice": "This call is being recorded"}
        if a == "consent": self.calls[-1]["who"] = p["name"]; return 200, {"ok": True}
        if a == "piece": self.pieces.append(dict(body, who=p["name"])); return 200, {"ok": True}
        if a == "transcribe":
            if u["role"] not in ("owner", "staff"): return err(403, "Only the owner or staff can make the transcript.", "role")
            lines = [{"who": x["who"], "start_ms": x["start_ms"], "text": "words heard from " + x["who"]} for x in sorted(self.pieces, key=lambda x: x["start_ms"]) if x["room_id"] == r["id"] or True]
            return 200, {"ok": True, "lines": lines, "done": len(lines), "all": len(lines), "left": 0, "wait": 0}
        if a == "summarise": return 200, {"ok": True, "summary": {"summary": "They agreed the GST return for September.", "decisions": ["File GSTR-3B by 20th"], "actions": [{"title": "Send the purchase bills", "who": "Client", "due": "2026-10-30"}]}}
        if a == "tasks":
            if u["role"] not in ("owner", "staff"): return err(403, "Your role cannot add tasks (look only).", "role")
            self.tasks.append({"tok": tok, "items": body.get("items")}); return 200, {"ok": True, "added": len(body.get("items") or [])}
        if a == "cowork":
            if not host: return err(403, "Only the host can start or stop working together.", "host")
            r["cowork_on"] = bool(body.get("on")); return 200, {"ok": True, "on": r["cowork_on"], "topic": "cowork:%s" % r["id"][:8] if r["cowork_on"] else None}
        if a == "cowork_join":
            if not r["cowork_on"]: return err(409, "The host has not started working together.", "cowork")
            return 200, {"ok": True, "topic": "cowork:%s" % r["id"][:8], "host_user": r["host_user"], "client_id": r["client_id"]}
        if a == "remote":
            if u["role"] not in ("owner", "staff"): return err(403, "Only the owner or staff can start remote help.", "role")
            if body.get("op") == "start":
                row = {"id": "rrrrrrrr-%d" % (len(self.remote) + 1), "by": u["name"], "client": r["client_id"], "reason": body.get("reason"), "peer": body.get("peer_name"), "start": time.time(), "end": None}
                self.remote.append(row); return 200, {"ok": True, "id": row["id"], "server": {"id_server": "", "relay": "", "key": ""}}
            row = next((x for x in self.remote if x["id"] == body.get("id")), None)
            if row: row["end"] = time.time()
            return 200, {"ok": True, "ended": bool(row)}
        if a == "leave":
            if p: p["state"] = "left"
            return 200, {"ok": True}
        if a == "end":
            if not host: return err(403, "Only the host can end the call for everyone.", "host")
            r["status"] = "ended"; r["cowork_on"] = False
            for x in self.remote:
                if x["end"] is None: x["end"] = time.time()
            return 200, {"ok": True}
        return err(400, "Unknown request " + str(a))
    def _join(self, r, u):
        p = next((x for x in self.people.values() if x["room"] == r["id"] and x.get("user") == u["id"]), None)
        if not p:
            pid = "bbbbbbbb-0000-4000-8000-%012d" % (len(self.people) + 1)
            p = self.people[pid] = {"id": pid, "room": r["id"], "user": u["id"], "name": u["name"], "email": u["email"], "role": "host" if r["host_user"] == u["id"] else "member", "state": "admitted"}
        p["state"] = "admitted"
        return p
    def route(self, route, request):
        if request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
        tok = (request.headers.get("authorization") or "").replace("Bearer ", "")
        try: body = json.loads(request.post_data or "{}")
        except Exception: body = {}
        code, j = self.handle(body, tok)
        route.fulfill(status=code, content_type="application/json", body=json.dumps(j), headers=CORS)
    def storage(self, route, request):
        if request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
        if request.method == "PUT": self.uploads.append({"url": request.url, "size": len(request.post_data_buffer or b""), "type": request.headers.get("content-type")})
        route.fulfill(status=200, content_type="application/json", body='{"Key":"x"}', headers=CORS)

# ---------------------------------------------------------------- PostgREST: the existing save path, with the database's rule
class Rest:
    def __init__(self): self.writes = []
    def route(self, route, request):
        if request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
        tok = (request.headers.get("authorization") or "").replace("Bearer ", "")
        if request.method in ("POST", "PATCH", "DELETE"):
            u = USERS.get(tok)
            allowed = bool(u) and u["role"] in ("owner", "staff")
            self.writes.append({"url": request.url, "tok": tok, "author": (u or {}).get("name"), "allowed": allowed, "body": request.post_data})
            if not allowed: return route.fulfill(status=403, content_type="application/json", body=json.dumps({"code": "42501", "message": "new row violates row-level security policy"}), headers=CORS)
            return route.fulfill(status=200, content_type="application/json", body="[]", headers=CORS)
        route.fulfill(status=200, content_type="application/json", body="[]", headers=CORS)

FAKE_SCREEN = """(() => {
  // the screen to share: a moving canvas (headless Chromium has no screen to pick)
  if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); let n = 0;
    setInterval(() => { x.fillStyle = '#0a7'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText('SHARED SCREEN ' + (n++), 40, 180); }, 100);
    return c.captureStream(10);
  };
  window.confirm = () => true;
})()"""

def setup_js(tok):
    u = USERS[tok]
    return """async () => {
  Cloud.cfg = () => ({url: "https://stand.supabase.co", key: "sb_publishable_test", email: "%(email)s"});
  Cloud.sess = () => ({access_token: "%(tok)s", refresh_token: "", user_id: "%(id)s", email: "%(email)s", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "%(role)s"; Cloud.st.state = "ok"; Cloud.st.email = "%(email)s";
  Cloud.st.members = [{user_id: "%(id)s", name: "%(name)s", email: "%(email)s", role: "%(role)s"}];
  S.account = Object.assign(S.account || {}, {me: {role: "%(role)s", email: "%(email)s"}, firm: {name: "Garg & Co"}}); S.firm.firmName = "Garg & Co";
  try { Live.stop(); } catch (e) {}
  const c = newCompany({name: "Client One Private Limited", gstin: "09AANFG3202D1ZR"});
  delete S.companies[c.id]; c.id = "%(client)s"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  const c2 = newCompany({name: "Second Client LLP", gstin: "09AAAAA0000A1Z5"}); delete S.companies[c2.id]; c2.id = "c-call-2"; S.companies[c2.id] = c2; S.data[c2.id] = {parties: {}, entries: {}, loaded: true}; c2.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "dash"; render();
  return c.id;
}""" % dict(u, tok=tok, client=CLIENT)

def member_page(br, port, tok, hub, fn, rest, checks, viewport=(1280, 860)):
    ctx = br.new_context(viewport={"width": viewport[0], "height": viewport[1]}, permissions=["camera", "microphone"])
    ctx.add_init_script(FAKE_SCREEN)
    pg = ctx.new_page(); pg.set_default_timeout(60000); pg.on("pageerror", lambda e: checks.errors.append(tok + ": " + str(e)))
    wire(pg, hub, fn, rest)
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(setup_js(tok)); pg.wait_for_timeout(600)
    return ctx, pg

def guest_page(br, port, link, hub, fn, rest, checks, viewport=(390, 844)):
    ctx = br.new_context(viewport={"width": viewport[0], "height": viewport[1]}, permissions=["camera", "microphone"], is_mobile=viewport[0] < 500, has_touch=viewport[0] < 500)
    ctx.add_init_script(FAKE_SCREEN)
    pg = ctx.new_page(); pg.set_default_timeout(60000); pg.on("pageerror", lambda e: checks.errors.append("guest: " + str(e)))
    seen = []; pg.on("request", lambda r: seen.append(r.url))
    wire(pg, hub, fn, rest)
    pg.goto(link); pg.wait_for_timeout(2500)
    return ctx, pg, seen

def wire(pg, hub, fn, rest):
    pg.route_web_socket("**/realtime/v1/websocket**", hub.handler)
    pg.route("**/functions/v1/fincom-call", fn.route)
    pg.route("**/storage/v1/object/**", fn.storage)
    pg.route("**/rest/v1/**", rest.route)
    pg.route("**/functions/v1/fincom-transcribe**", lambda route, req: route.fulfill(status=500, body="{}"))

def shot(pg, name):
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True)
    try: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))
    except Exception as e: print("  (screenshot %s: %s)" % (name, e))

def wait_for(pg, js, ms=15000, step=250):
    t0 = time.time()
    while (time.time() - t0) * 1000 < ms:
        try:
            if pg.evaluate(js): return True
        except Exception: pass
        pg.wait_for_timeout(step)
    return False

def pump(pages, ms):
    # let every page's events (and the fake hub's) run
    end = time.time() + ms / 1000.0
    while time.time() < end:
        for p in pages: p.wait_for_timeout(50)

def press(pg, sel, ms=60000):
    """a click without waiting for the page to settle (a busy CPU, a canvas being recorded): the element must be there"""
    pg.wait_for_selector(sel, state="attached", timeout=ms)
    pg.eval_on_selector(sel, "el => el.click()")
