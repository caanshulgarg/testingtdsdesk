# Versions harness, mode s235: proxy.py (push-design's timing proxy) for FinCom Bridge 2.3.5's read-stop checks. Listens on
# 127.0.0.2:<port> (the bridge's TallyHost is 127.0.0.2), forwards each request unchanged to Tally on 127.0.0.1:<port> and
# logs one JSON line per request: its id as the bridge's allow-list names it (tallyRequestID: an object export of a voucher
# is FinComVoucherObject, its MasterID kept in "mid"), when it reached the proxy (t0) and when Tally's answer was back (t1),
# the sizes and the HTTP status. The harness reads this log to say whether any voucher request reached Tally.
# Check s4 only (a real failure): when the control file (argv 3) exists and names a request id pattern, the FIRST request
# whose id matches it suspends Tally's process (pid from the file) for `sec` seconds before it is forwarded, so Tally takes
# the request and does not answer (Tally itself not answering, not a refusal by the proxy). The control file is removed
# at once (one shot) and a {"event": "suspend"} line is logged when Tally is suspended and {"event": "resume"} after.
import ctypes, json, os, re, sys, threading, time, http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
PORT = int(sys.argv[1]); LOG = sys.argv[2]; CTL = sys.argv[3] if len(sys.argv) > 3 else ''
LOCK = threading.Lock()
CTL_LOCK = threading.Lock()

def logj(o):
    with LOCK, open(LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(o) + '\n')

def rid(b):
    s = b[:8000].decode('utf-8', 'replace')
    if s.startswith('﻿') or b[:2] in (b'\xff\xfe', b'\xfe\xff'):
        try: s = b[:16000].decode('utf-16', 'replace')
        except Exception: pass
    mid = ''
    if re.search(r'<TALLYREQUEST>\s*Import', s, re.I):
        i = 'Import'
    elif '<TYPE>Object</TYPE>' in s:
        st = re.search(r'<SUBTYPE>([^<]*)</SUBTYPE>', s)
        st = st.group(1).strip() if st else ''
        i = 'FinComVoucherObject' if st == 'Voucher' else 'Object:' + st
        m = re.search(r'<ID TYPE="Name">ID:(\d+)</ID>', s)
        mid = m.group(1) if m else ''
    else:
        m = re.search(r'<ID(?:\s[^>]*)?>([^<]*)</ID>', s) or re.search(r'<REPORTNAME>([^<]*)</REPORTNAME>', s)
        i = m.group(1).strip() if m else ''
        m2 = re.search(r'\$MasterID\s*=\s*(\d+)', s, re.I)
        mid = m2.group(1) if m2 else ''
    t = re.search(r'<TALLYREQUEST>([^<]*)</TALLYREQUEST>', s)
    return i, (t.group(1) if t else ''), mid

def suspend_maybe(i):
    if not CTL:
        return None
    with CTL_LOCK:
        if not os.path.exists(CTL):
            return None
        try:
            c = json.load(open(CTL, encoding='utf-8-sig'))
        except Exception as e:
            logj({'event': 'ctl-unreadable', 'err': str(e), 't': round(time.time() * 1000)})
            return None
        if not re.search(c.get('suspendOn', '^$'), i or ''):
            return None
        try: os.remove(CTL)
        except Exception: pass
    pid, sec = int(c.get('pid', 0)), float(c.get('sec', 20))
    k32, nt = ctypes.windll.kernel32, ctypes.windll.ntdll
    k32.OpenProcess.restype = ctypes.c_void_p
    k32.CloseHandle.argtypes = [ctypes.c_void_p]
    nt.NtSuspendProcess.argtypes = [ctypes.c_void_p]; nt.NtResumeProcess.argtypes = [ctypes.c_void_p]
    h = k32.OpenProcess(0x0800, False, pid)  # PROCESS_SUSPEND_RESUME
    if not h:
        logj({'event': 'suspend-failed', 'id': i, 'pid': pid, 'err': 'OpenProcess %d' % k32.GetLastError(), 't': round(time.time() * 1000)})
        return None
    r = nt.NtSuspendProcess(h)
    logj({'event': 'suspend', 'id': i, 'pid': pid, 'status': r, 'sec': sec, 't': round(time.time() * 1000)})
    def resume():
        rr = nt.NtResumeProcess(h)
        logj({'event': 'resume', 'id': i, 'pid': pid, 'status': rr, 't': round(time.time() * 1000)})
        k32.CloseHandle(h)
    threading.Timer(sec, resume).start()
    return True

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def go(self, method):
        t0 = time.time()
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        i, tr, mid = rid(body)
        sus = suspend_maybe(i) if method == 'POST' else None
        st, data, err = 0, b'', ''
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
            err = err or ('reply: ' + str(e))
        self.close_connection = True
        logj({'t0': round(t0 * 1000), 't1': round(t1 * 1000), 'ms': round((t1 - t0) * 1000), 'method': method, 'id': i, 'req': tr, 'mid': mid,
              'suspended': bool(sus), 'in': len(body), 'out': len(data), 'status': st, 'err': err})
    def do_POST(self): self.go('POST')
    def do_GET(self): self.go('GET')
    def log_message(self, *a): pass

class S(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
S(('127.0.0.2', PORT), H).serve_forever()
