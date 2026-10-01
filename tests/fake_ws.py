"""A stand-in for Supabase Realtime's websocket (the Phoenix protocol, version 1) on port 9201, for the bridge tests:
it answers a join and heartbeats, and the test sends a broadcast to a topic (as realtime.send does in the database)."""
import socket, threading, base64, hashlib, struct, json, time
PORT = 9201
CONNS = []           # {"sock", "topics": set(), "joined_at"}
LOG = []             # (time, what)
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
def _recv_exact(s, n):
    b = b""
    while len(b) < n:
        c = s.recv(n - len(b))
        if not c: raise ConnectionError("closed")
        b += c
    return b
def _read_frame(s):
    h = _recv_exact(s, 2); op = h[0] & 0x0F; ln = h[1] & 0x7F; masked = h[1] & 0x80
    if ln == 126: ln = struct.unpack(">H", _recv_exact(s, 2))[0]
    elif ln == 127: ln = struct.unpack(">Q", _recv_exact(s, 8))[0]
    mask = _recv_exact(s, 4) if masked else b"\0\0\0\0"
    data = bytearray(_recv_exact(s, ln))
    for i in range(len(data)): data[i] ^= mask[i % 4]
    return op, bytes(data)
def _send_frame(s, text, op=1):
    b = text.encode() if isinstance(text, str) else text
    h = bytes([0x80 | op]) + (bytes([len(b)]) if len(b) < 126 else (bytes([126]) + struct.pack(">H", len(b)) if len(b) < 65536 else bytes([127]) + struct.pack(">Q", len(b))))
    s.sendall(h + b)
def _serve(s):
    try:
        req = b""
        while b"\r\n\r\n" not in req: req += s.recv(4096)
        key = [l.split(":", 1)[1].strip() for l in req.decode().split("\r\n") if l.lower().startswith("sec-websocket-key")][0]
        acc = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        s.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n" % acc).encode())
        c = {"sock": s, "topics": set(), "lock": threading.Lock()}; CONNS.append(c); LOG.append((time.time(), "open"))
        while True:
            op, data = _read_frame(s)
            if op == 8: break
            if op == 9:
                with c["lock"]: _send_frame(s, data, 10)
                continue
            if op != 1: continue
            m = json.loads(data)
            LOG.append((time.time(), m.get("event") + " " + m.get("topic", "")))
            if m.get("event") == "phx_join": c["topics"].add(m["topic"])
            if m.get("event") in ("phx_join", "heartbeat"):
                with c["lock"]: _send_frame(s, json.dumps({"topic": m["topic"], "event": "phx_reply", "ref": m.get("ref"), "payload": {"status": "ok", "response": {}}}))
    except Exception: pass
    finally:
        CONNS[:] = [c for c in CONNS if c["sock"] is not s]
        try: s.close()
        except Exception: pass
def joined(topic): return any(("realtime:" + topic) in c["topics"] for c in CONNS)
def broadcast(topic, event, payload=None):
    """as realtime.send(payload, event, topic, false) in the database"""
    msg = json.dumps({"topic": "realtime:" + topic, "event": "broadcast", "ref": None, "payload": {"event": event, "payload": payload or {}, "type": "broadcast"}})
    n = 0
    for c in list(CONNS):
        if ("realtime:" + topic) in c["topics"]:
            try:
                with c["lock"]: _send_frame(c["sock"], msg); n += 1
            except Exception: pass
    return n
def start():
    ls = socket.socket(); ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); ls.bind(("127.0.0.1", PORT)); ls.listen(8)
    def acc():
        while True:
            s, _ = ls.accept(); threading.Thread(target=_serve, args=(s,), daemon=True).start()
    threading.Thread(target=acc, daemon=True).start()
    return ls
