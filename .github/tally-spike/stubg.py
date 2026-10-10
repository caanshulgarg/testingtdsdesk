# Mode tdsgst (round 43): stubv.py with the beat answering recorderSource "both" (the owner's per-computer choice in FinCom,
# tally_devices.recorder_source, which tally-ingest's beat answer carries): the bridge reads Tally's change list beside the
# add-on, so entries made by XML import reach FinCom. Otherwise stubv.py: every request body kept, one JSON per line.
# Versions harness copy of stub.py (beat also answers trialTools: true, so the tray's fetch and read tests may run).
# A stand-in for FinCom's cloud (tally-ingest) on 127.0.0.1: every request body is kept (one JSON per line), and each
# call gets a 200 with the smallest answer that lets the bridge go on: recorder_lines -> every line "applied".
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[2]
LOCK = threading.Lock()
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n).decode('utf-8', 'replace')
        try:
            body = json.loads(raw)
        except Exception:
            body = {'_raw': raw}
        kind = body.get('kind', '')
        if kind == 'recorder_lines':
            res = [{'line_id': l.get('line_id', ''), 'state': 'applied', 'why': None} for l in body.get('lines', [])]
            out = {'ok': True, 'results': res, 'applied': len(res), 'held': 0, 'duplicate': 0, 'stale': 0, 'failed': 0}
        elif kind == 'beat':
            out = {'ok': True, 'updateNow': False, 'posts': 0, 'trialTools': True, 'recorderSource': 'both'}
        elif kind == 'hello':
            out = {'ok': True, 'firm': 'Spike', 'device': 'runner'}
        elif kind == 'companies':
            out = {'ok': True, 'links': {}}
        else:
            out = {'ok': True}
        with LOCK, open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'at': time.strftime('%H:%M:%S'), 'kind': kind, 'device': self.headers.get('x-fincom-device', ''), 'body': body, 'answer': out}) + '\n')
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
