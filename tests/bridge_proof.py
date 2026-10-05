"""The proof a FinCom Bridge 2.3.0 gives on /ping?n=<nonce> (the owner's condition of 05-Oct-2026), for the tests' stand-in
bridges: HMAC-SHA256(bridge key, nonce || bridge id || port) as "proof", and HMAC-SHA256(pairing code, nonce) as
"pairProof" while a pairing code is given (its window open). FinCom sends nothing secret to a bridge before it proves itself.
    ping_body(url, key, bridge_id, port, code=None, **extra) -> the /ping answer as a dict"""
import hmac, hashlib
from urllib.parse import urlparse, parse_qs
def mac(secret, msg): return hmac.new(str(secret).encode(), msg.encode(), hashlib.sha256).hexdigest()
def nonce_of(url): return (parse_qs(urlparse(url).query).get("n") or [""])[0]
def is_ping(url): return urlparse(url).path == "/ping"
def ping_body(url, key, bridge_id="go-5e1f00000001", port=None, code=None, **extra):
    n, port = nonce_of(url), port or urlparse(url).port or 9100
    o = {"ok": True, "bridge": "FinCom Tally Bridge", "impl": "go", "version": "2.3.0", "yours": True, "bridgeId": bridge_id, "port": port}
    if n and key: o["proof"] = mac(key, n + bridge_id + str(port))
    if n and code: o["pairProof"] = mac(code, n)
    o.update(extra)
    return o
