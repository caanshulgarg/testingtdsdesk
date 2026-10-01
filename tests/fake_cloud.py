"""A stand-in for FinCom's cloud (the tally-ingest function) on port 9200, for the bridge tests."""
import json, gzip, base64, re, threading, http.server
KEY = "fcd_" + "a" * 48
CTRL = {"down": False, "revoked": False, "badgz": set()}
LINKS = {}          # company -> client id (None: seen, not linked)
DAYS = {}           # (company, day) -> text
SENT = []           # (company, day) in the order received
LEDGERS = {}        # company -> body
GROUPS = {}         # company -> body of a groups-only send (bridge 1.14.9)
STATE = {}          # company -> state
CALLS = []          # (kind, bytes)
BEATS = []          # heartbeats
SHADOW = []         # calls marked shadow (the Go bridge in test mode, beside bridge 1.15.0): (kind, body)
POSTS = {}          # the posting queue (build 199): id -> {company, payload, status, done, message, results, checking}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); raw = self.rfile.read(n)
        if CTRL["down"]: self.close_connection = True; return
        if self.headers.get("x-fincom-device") != KEY or CTRL["revoked"]: return self._send(401, {"ok": False, "error": "This computer's key is not valid any more."})
        o = json.loads(raw); k = o.get("kind")
        if o.get("shadow"):
            # as tally-ingest does for a bridge in test mode: never a posting, its heartbeat kept apart, its days compared
            # with what is kept (bridge 1.15.0's), never kept
            SHADOW.append((k, o))
            if k in ("posts_take", "posts_update"): return self._send(403, {"ok": False, "error": "A bridge in test mode does not post."})
            if k == "beat": return self._send(200, {"ok": True, "updateNow": False, "posts": 0, "wake": CTRL.get("wake"), "shadow": True})
            if k == "hello": return self._send(200, {"ok": True, "firm": "ZZ TEST FIRM", "device": "TEST-PC"})
            if k == "companies": return self._send(200, {"ok": True, "links": {c["name"]: bool(LINKS.get(c["name"])) for c in o.get("companies", [])}})
            co = o.get("company", "")
            if not LINKS.get(co): return self._send(409, {"ok": False, "notLinked": True, "error": "not linked"})
            if k == "days":
                done, same, differ, new = [], [], [], []
                for d in o.get("days", []):
                    t = (base64.b64decode(d["b64"]) if "b64" in d else gzip.decompress(base64.b64decode(d["gz"]))).decode("utf-8")
                    had = DAYS.get((co, d["day"])); done.append(d["day"])
                    (new if had is None else same if had == t else differ).append(d["day"])
                return self._send(200, {"ok": True, "done": done, "bad": [], "same": same, "differ": differ, "new": new, "shadow": True})
            return self._send(200, {"ok": True, "shadow": True})
        CALLS.append((k + ("-plain" if k == "days" and any("b64" in d for d in o.get("days", [])) else ""), n))
        if k == "beat":
            BEATS.append(o); w = CTRL.pop("want", False)
            return self._send(200, {"ok": True, "updateNow": w, "posts": sum(1 for j in POSTS.values() if j["status"] == "waiting"), "wake": CTRL.get("wake")})   # wake: bridge 1.15.0
        if k == "posts_take":
            for jid, j in POSTS.items():
                if j["status"] == "waiting":
                    j["status"] = "taken"; return self._send(200, {"ok": True, "job": {"id": jid, "company": j["company"], "payload": j["payload"]}})
            return self._send(200, {"ok": True, "job": None})
        if k == "posts_update":
            j = POSTS.get(o.get("id"))
            if j and j["status"] != "cancelled":
                j.update({x: o.get(x) for x in ("status", "done", "message", "results", "checking")}); j.setdefault("log", []).append((o.get("status"), o.get("done"), o.get("checking")))
            return self._send(200, {"ok": True})
        if k == "hello": return self._send(200, {"ok": True, "firm": "ZZ TEST FIRM", "device": "TEST-PC"})
        if k == "companies":
            for c in o.get("companies", []): LINKS.setdefault(c["name"], None)
            return self._send(200, {"ok": True, "links": {c["name"]: bool(LINKS.get(c["name"])) for c in o.get("companies", [])}})
        co = o.get("company", "")
        if not LINKS.get(co): return self._send(409, {"ok": False, "notLinked": True, "error": "not linked"})
        if k == "days":
            done, bad = [], []
            for d in o.get("days", []):
                if "gz" in d and d["day"] in CTRL["badgz"]: bad.append({"day": d["day"], "error": "corrupt gzip stream does not have a matching checksum"}); continue
                DAYS[(co, d["day"])] = (base64.b64decode(d["b64"]) if "b64" in d else gzip.decompress(base64.b64decode(d["gz"]))).decode("utf-8"); SENT.append((co, d["day"])); done.append(d["day"])
            return self._send(200, {"ok": True, "done": done, "bad": bad})
        if k == "groups": GROUPS[co] = o; return self._send(200, {"ok": True, "ledgers": len(o.get("ledgers", [])), "groups": len(o.get("groups", []))})
        if k == "ledgers": LEDGERS[co] = o; return self._send(200, {"ok": True, "ledgers": len(o.get("ledgers", []))})
        if k == "state": STATE[co] = o.get("state"); return self._send(200, {"ok": True})
        return self._send(400, {"ok": False, "error": "unknown kind"})
def start():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 9200), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
