# Versions harness, mode dsrc (bridge 2.4.1, two data sources): stub235.py (the stand-in for FinCom's cloud, every request
# body kept, one JSON per line) that also plays tally-ingest's data locations (migration 71, as 9f8016ff describes them):
#   - the beat's dataSources (the bridge's own data id per company): the FIRST own one named for a company is chosen by
#     itself; the answer names, per company the beat names, {company, company_guid, dataId, chosenId, chosen}
#   - recorder_lines: 'other_source' -> held ("saved in another data location"); a line whose data_id is not the chosen one
#     -> held; else applied (a line without data_id: applied, as an older add-on's)
#   - the owner's choice: POST {"kind": "_ctl", "choose": {"company_guid": g, "data_id": id}}; the next beat that names
#     the chosen id as the bridge's own records a fresh starting point (logged as kind "_fresh" with the beat's startPoint)
# GET / gives the state. Harness only.
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[2]
LOCK = threading.Lock()
STATE = {'chosen': {}, 'fresh': {}, 'readStop': None}


def logj(o):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(o) + '\n')


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
        now = round(time.time() * 1000)
        with LOCK:
            if kind == 'recorder_lines':
                res = []
                for l in body.get('lines', []) or []:
                    ev, did = l.get('event', ''), (l.get('data_id') or '').lower()
                    g = (l.get('company_guid') or '').lower()
                    ch = STATE['chosen'].get(g, '')
                    if ev == 'other_source':
                        res.append({'line_id': l.get('line_id', ''), 'state': 'held', 'why': 'saved in another data location of the company; FinCom reads the chosen one'})
                    elif did and ch and did != ch:
                        res.append({'line_id': l.get('line_id', ''), 'state': 'held', 'why': 'its data location is not the one FinCom reads'})
                    else:
                        res.append({'line_id': l.get('line_id', ''), 'state': 'applied', 'why': None})
                out = {'ok': True, 'results': res, 'applied': sum(1 for r in res if r['state'] == 'applied'), 'held': sum(1 for r in res if r['state'] == 'held'), 'duplicate': 0, 'stale': 0, 'failed': 0}
            elif kind == 'beat':
                ans = []
                for d in body.get('dataSources') or []:
                    g = (d.get('company_guid') or '').lower(); own = (d.get('data_id') or '').lower()
                    if not g or not own:
                        continue
                    if g not in STATE['chosen']:
                        STATE['chosen'][g] = own
                        logj({'at': time.strftime('%H:%M:%S'), 'ms': now, 'kind': '_auto', 'body': {'company_guid': g, 'data_id': own}, 'answer': {'chosen': own}})
                    ch = STATE['chosen'][g]
                    if STATE['fresh'].get(g) == 'pending' and own == ch:
                        STATE['fresh'][g] = 'recorded'
                        logj({'at': time.strftime('%H:%M:%S'), 'ms': now, 'kind': '_fresh', 'body': {'company_guid': g, 'data_id': own, 'startPoint': body.get('startPoint')}, 'answer': {}})
                    ans.append({'company': d.get('company', ''), 'company_guid': d.get('company_guid', ''), 'dataId': own, 'chosenId': ch, 'chosen': own == ch})
                out = {'ok': True, 'updateNow': False, 'posts': 0, 'trialTools': True, 'readStop': STATE['readStop'], 'dataSources': ans}
            elif kind == 'hello':
                out = {'ok': True, 'firm': 'Spike', 'device': 'runner'}
            elif kind == 'companies':
                out = {'ok': True, 'links': {}}
            elif kind == '_ctl':
                c = body.get('choose') or {}
                g, did = (c.get('company_guid') or '').lower(), (c.get('data_id') or '').lower()
                if g and did:
                    if STATE['chosen'].get(g) != did:
                        STATE['fresh'][g] = 'pending'
                    STATE['chosen'][g] = did
                out = {'ok': True, 'chosen': STATE['chosen'], 'fresh': STATE['fresh']}
            else:
                out = {'ok': True}
            logj({'at': time.strftime('%H:%M:%S'), 'ms': now, 'kind': kind, 'device': self.headers.get('x-fincom-device', ''), 'body': body, 'answer': out})
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
