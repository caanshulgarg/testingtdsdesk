# Versions harness, mode s235: stubv.py (the stand-in for FinCom's cloud: every request body kept, one JSON per line;
# recorder_lines -> every line "applied"; beat with trialTools) whose heartbeat answer also carries FinCom's read stop, as
# tally-ingest's beat does (selfwatch.go applyReadControl): readStop {by, reason, at} while the harness has set it, else
# readStop null (lifted). The harness sets it with POST {"kind": "_ctl", "readStop": {...} | null} (logged like the rest).
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[2]
LOCK = threading.Lock()
STATE = {'readStop': None}

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        with LOCK:
            b = json.dumps(STATE).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n).decode('utf-8', 'replace')
        try:
            body = json.loads(raw)
        except Exception:
            body = {'_raw': raw}
        kind = body.get('kind', '') if isinstance(body, dict) else ''
        with LOCK:
            if kind == 'recorder_lines':
                res = [{'line_id': l.get('line_id', ''), 'state': 'applied', 'why': None} for l in body.get('lines', [])]
                out = {'ok': True, 'results': res, 'applied': len(res), 'held': 0, 'duplicate': 0, 'stale': 0, 'failed': 0}
            elif kind == 'beat':
                out = {'ok': True, 'updateNow': False, 'posts': 0, 'trialTools': True, 'readStop': STATE['readStop']}
            elif kind == 'hello':
                out = {'ok': True, 'firm': 'Spike', 'device': 'runner'}
            elif kind == 'companies':
                out = {'ok': True, 'links': {}}
            elif kind == '_ctl':
                STATE['readStop'] = body.get('readStop')
                out = {'ok': True, 'readStop': STATE['readStop']}
            else:
                out = {'ok': True}
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'at': time.strftime('%H:%M:%S'), 'ms': round(time.time() * 1000), 'kind': kind, 'device': self.headers.get('x-fincom-device', ''), 'body': body, 'answer': out}) + '\n')
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
