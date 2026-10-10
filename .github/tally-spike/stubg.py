# Mode tdsgst (round 43): a stand-in for FinCom's cloud (tally-ingest) on 127.0.0.1, every request body kept (one JSON per
# line), answering as tally-ingest does where the bridge's behaviour depends on it:
#   - beat: recorderSource "both" (the owner's per-computer choice in FinCom, tally_devices.recorder_source), so the bridge
#     reads Tally's change list beside the add-on and entries made by XML import reach FinCom; refetch: this bridge's own
#     held lines without their entry (as refetchFor: created / altered / imported, no body, no "<id>:resolved" yet; at most
#     20, oldest first), so the bridge asks its Tally again and sends "<line id>:resolved" with the entry
#   - recorder_lines: a created / altered / imported line without Tally's entry is answered "held" (tally-ingest holds it);
#     every other line "applied" (run 38060636032: answered "applied", the 15 lines sent without their body were never
#     asked again)
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[2]
LOCK = threading.Lock()
HELD = {}       # line id -> the refetch row, oldest first
DONE = set()    # line ids resolved
class H(BaseHTTPRequestHandler):
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
                res = []
                for l in body.get('lines', []):
                    lid = str(l.get('line_id', '')); ev = str(l.get('event', ''))
                    if lid.endswith(':resolved'):
                        DONE.add(lid[:-9]); HELD.pop(lid[:-9], None)
                    if ev in ('created', 'altered', 'imported') and not l.get('xml') and not lid.endswith(':resolved') and not l.get('fid'):
                        res.append({'line_id': lid, 'state': 'held', 'why': l.get('heldWhy') or 'waiting for the entry from Tally'})
                        if lid not in DONE:
                            HELD.setdefault(lid, {'line_id': lid, 'company': body.get('company', ''), 'company_guid': l.get('company_guid', ''), 'event': ev,
                                                  'master_id': str(l.get('master_id') or ''), 'vch_type': l.get('vch_type', ''), 'vch_no': l.get('vch_no', ''), 'vch_date': l.get('vch_date', '')})
                    else:
                        res.append({'line_id': lid, 'state': 'applied', 'why': None})
                out = {'ok': True, 'results': res, 'applied': sum(1 for r in res if r['state'] == 'applied'), 'held': sum(1 for r in res if r['state'] == 'held'), 'duplicate': 0, 'stale': 0, 'failed': 0}
            elif kind == 'beat':
                out = {'ok': True, 'updateNow': False, 'posts': 0, 'trialTools': True, 'recorderSource': 'both'}
                rf = list(HELD.values())[:20]
                if rf: out['refetch'] = rf
            elif kind == 'hello':
                out = {'ok': True, 'firm': 'Spike', 'device': 'runner'}
            elif kind == 'companies':
                out = {'ok': True, 'links': {}}
            else:
                out = {'ok': True}
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'at': time.strftime('%H:%M:%S'), 'kind': kind, 'device': self.headers.get('x-fincom-device', ''), 'body': body, 'answer': out}) + '\n')
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
