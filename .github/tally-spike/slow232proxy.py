# Bridge 2.3.2 (issue 232), input only=slow232: a timing proxy between FinCom Bridge 1 and TallyPrime 9000 (the push-design
# proxy of branch tally-versions, .github/tally-spike/push/proxy.py, with the company and the MasterID of each request).
# Listens on 127.0.0.2:<port> (bridge 1's TallyHost is 127.0.0.2), forwards each request unchanged to 127.0.0.1:<port>,
# and logs one JSON line per request: its id, TALLYREQUEST, company (SVCURRENTCOMPANY), MasterID ($MasterID = n), when it
# reached the proxy and when Tally's answer was back (epoch ms; ms is Tally's whole time, also after the bridge stopped
# waiting at 2 s), the sizes, the HTTP status, and whether the bridge was still there for the answer. Nothing is changed.
import html, json, os, re, sys, threading, time, http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
PORT = int(sys.argv[1]); LOG = sys.argv[2]
# backlog233 (bridge 2.3.3): an optional delay per company for the entry requests (FinComVoucherByMaster / ByNumber), read
# from <log>.delay.json ({"company": ms}) at each request: the proxy waits that long before forwarding (Tally itself is not
# busy then; said as such in the results). No file: nothing is delayed
DELAYS = LOG + '.delay.json'
def delay_for(i, co):
    if i not in ('FinComVoucherByMaster', 'FinComVoucherByNumber', 'FinComVoucherObject', 'FinComLedgers') or not os.path.exists(DELAYS):
        return 0
    try:
        return int((json.load(open(DELAYS, encoding='utf-8')) or {}).get(co, 0))
    except Exception:
        return 0
LOCK = threading.Lock()
def info(b):
    s = b[:20000].decode('utf-8', 'replace')
    if b[:2] in (b'\xff\xfe', b'\xfe\xff'):
        try: s = b[:40000].decode('utf-16', 'replace')
        except Exception: pass
    m = re.search(r'<ID>([^<]*)</ID>', s) or re.search(r'<REPORTNAME>([^<]*)</REPORTNAME>', s)
    # next-fastfetch (fast234): the object export of one voucher carries no collection ID: named as the bridge names it
    obj = '<TYPE>Object</TYPE>' in s and '<SUBTYPE>Voucher</SUBTYPE>' in s
    t = re.search(r'<TALLYREQUEST>([^<]*)</TALLYREQUEST>', s)
    c = re.search(r'<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>', s)
    mid = re.search(r'\$MasterID = (\d+)', s) or re.search(r'<ID TYPE="Name">ID:(\d+)</ID>', s)
    return ('FinComVoucherObject' if obj else (m.group(1) if m else '')), (t.group(1) if t else ''), (html.unescape(c.group(1)) if c else ''), (mid.group(1) if mid else '')
class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def go(self, method):
        t0 = time.time()
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        i, tr, co, mid = info(body)
        st, data, err, gone = 0, b'', '', False
        dl = delay_for(i, co)
        if dl > 0:
            time.sleep(dl / 1000.0)
        try:
            c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=900)
            h = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'connection', 'content-length')}
            c.request(method, self.path, body=body if method == 'POST' else None, headers=h)
            r = c.getresponse(); data = r.read(); st = r.status
            hd = [(k, v) for k, v in r.getheaders() if k.lower() not in ('content-length', 'connection', 'transfer-encoding', 'keep-alive')]
            c.close()
        except Exception as e:
            err = str(e)
        t1 = time.time()
        try:
            if err:
                self.send_response(502); self.send_header('Content-Length', '0'); self.send_header('Connection', 'close'); self.end_headers()
            else:
                self.send_response(st)
                for k, v in hd: self.send_header(k, v)
                self.send_header('Content-Length', str(len(data))); self.send_header('Connection', 'close'); self.end_headers(); self.wfile.write(data)
        except Exception as e:
            gone = True
        self.close_connection = True
        with LOCK, open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'t0': round(t0 * 1000), 't1': round(t1 * 1000), 'ms': round((t1 - t0) * 1000), 'at': time.strftime('%H:%M:%S', time.localtime(t0)),
                                'id': i, 'req': tr, 'company': co, 'mid': mid, 'in': len(body), 'out': len(data), 'status': st, 'err': err, 'clientGone': gone, 'delay': dl}) + '\n')
    def do_POST(self): self.go('POST')
    def do_GET(self): self.go('GET')
    def log_message(self, *a): pass
class S(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
S(('127.0.0.2', PORT), H).serve_forever()
