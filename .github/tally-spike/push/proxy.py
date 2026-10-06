# push-design (measurement only): a timing proxy between FinCom Bridge and TallyPrime. Listens on 127.0.0.2:<port> (the
# bridge's TallyHost is set to 127.0.0.2), forwards each request unchanged to 127.0.0.1:<port> (Tally), and logs one JSON
# line per request: its id (Tally request id / TALLYREQUEST), when it reached the proxy and when Tally's answer was back
# (epoch ms), the sizes and the HTTP status. Nothing is changed or read beyond that.
import json, re, sys, threading, time, http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
PORT = int(sys.argv[1]); LOG = sys.argv[2]
LOCK = threading.Lock()
def rid(b):
    s = b[:4000].decode('utf-8', 'replace')
    if s.startswith('﻿') or b[:2] in (b'\xff\xfe', b'\xfe\xff'):
        try: s = b[:8000].decode('utf-16', 'replace')
        except Exception: pass
    m = re.search(r'<ID>([^<]*)</ID>', s) or re.search(r'NAME="([^"]+)"', s)
    t = re.search(r'<TALLYREQUEST>([^<]*)</TALLYREQUEST>', s)
    n = len(re.findall(r'<VOUCHER\b', s))
    return (m.group(1) if m else ''), (t.group(1) if t else ''), n
class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def go(self, method):
        t0 = time.time()
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        i, tr, nv = rid(body)
        st, data, err = 0, b'', ''
        try:
            c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=900)
            h = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'connection', 'content-length')}
            c.request(method, self.path, body=body if method == 'POST' else None, headers=h)
            r = c.getresponse(); data = r.read(); st = r.status; ct = r.getheader('Content-Type') or 'text/xml'
            c.close()
        except Exception as e:
            err = str(e)
        t1 = time.time()
        try:
            if err:
                self.send_response(502); self.send_header('Content-Length', '0'); self.send_header('Connection', 'close'); self.end_headers()
            else:
                self.send_response(st); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(data))); self.send_header('Connection', 'close'); self.end_headers(); self.wfile.write(data)
        except Exception as e:
            err = err or ('reply: ' + str(e))
        self.close_connection = True
        with LOCK, open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'t0': round(t0 * 1000), 't1': round(t1 * 1000), 'ms': round((t1 - t0) * 1000), 'method': method, 'id': i, 'req': tr, 'vouchers': nv, 'in': len(body), 'out': len(data), 'status': st, 'err': err}) + '\n')
    def do_POST(self): self.go('POST')
    def do_GET(self): self.go('GET')
    def log_message(self, *a): pass
class S(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
S(('127.0.0.2', PORT), H).serve_forever()
