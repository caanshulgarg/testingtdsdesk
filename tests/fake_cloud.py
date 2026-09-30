"""A stand-in for FinCom's cloud (the tally-ingest function) on port 9200, for the bridge tests."""
import json, gzip, base64, re, threading, http.server
KEY = "fcd_" + "a" * 48
CTRL = {"down": False, "revoked": False, "badgz": set()}
LINKS = {}          # company -> client id (None: seen, not linked)
DAYS = {}           # (company, day) -> text
SENT = []           # (company, day) in the order received
LEDGERS = {}        # company -> body
STATE = {}          # company -> state
CALLS = []          # (kind, bytes)
BEATS = []          # heartbeats
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); raw = self.rfile.read(n)
        if CTRL["down"]: self.close_connection = True; return
        if self.headers.get("x-fincom-device") != KEY or CTRL["revoked"]: return self._send(401, {"ok": False, "error": "This computer's key is not valid any more."})
        o = json.loads(raw); k = o.get("kind"); CALLS.append((k + ("-plain" if k == "days" and any("b64" in d for d in o.get("days", [])) else ""), n))
        if k == "beat":
            BEATS.append(o); w = CTRL.pop("want", False)
            return self._send(200, {"ok": True, "updateNow": w})
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
        if k == "ledgers": LEDGERS[co] = o; return self._send(200, {"ok": True, "ledgers": len(o.get("ledgers", []))})
        if k == "state": STATE[co] = o.get("state"); return self._send(200, {"ok": True})
        return self._send(400, {"ok": False, "error": "unknown kind"})
def start():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 9200), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
