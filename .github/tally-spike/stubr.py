# Versions harness, mode renum (branch next-renumber): stubv.py's stand-in for FinCom's cloud (every request body kept, one
# JSON per line; recorder_lines -> every line "applied"; beat with trialTools) that ALSO keeps FinCom's copy of the entries,
# as tally-ingest and migration 67 keep it, so the run can say whether FinCom ends with Tally's numbers:
#   - POST {"kind": "_seed", "entries": [{mid, guid, day, no, alter, type}]}  (the harness only): the copy FinCom holds before the
#     insert (as from a Day Book upload)
#   - recorder_lines: an entry line with Tally's entry (xml) sets the copy's entry of that GUID (number, date, type, AlterID) unless
#     the copy holds a higher AlterID (an equal AlterID with another number is applied: migration 67); a delete removes it
#   - renumber_list: tally-ingest's read-only kind (server/tally-cloud/index.ts renumberList), the same filter: that type, from the
#     date on, on that date only those numbered from the given number up, the given MasterID left out, at most `limit`
#   - GET /copy: the copy as JSON (the harness compares it with Tally's own list)
import json, re, sys, threading, time, html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[2]
LOCK = threading.Lock()
COPY = {}   # guid -> {mid, guid, day, no, alter, type}

def tag(x, t):
    m = re.search(r'<' + t + r'(?:\s[^>]*)?>([^<]*)</' + t + '>', x or '')
    return html.unescape(m.group(1)).strip() if m else ''

def numcmp(a, b):
    a, b = (a or '').strip(), (b or '').strip()
    if not a or not b: return None
    if a == b: return 0
    i = 0
    while i < len(a) and i < len(b) and a[i] == b[i]: i += 1
    while i > 0 and a[i - 1].isdigit(): i -= 1
    ra, rb = a[i:], b[i:]
    j = 0
    while j < len(ra) and j < len(rb) and ra[len(ra) - 1 - j] == rb[len(rb) - 1 - j]: j += 1
    while j > 0 and ra[len(ra) - j].isdigit(): j -= 1
    da, db = ra[:len(ra) - j], rb[:len(rb) - j]
    if not (da.isdigit() and db.isdigit()): return None
    return (int(da) > int(db)) - (int(da) < int(db))

def renumber_list(b):
    vt, frm, no, skip = b.get('vtype', ''), b.get('from', ''), b.get('no', ''), str(b.get('mid', ''))
    lim = max(1, min(500, int(b.get('limit') or 500)))
    rows = [e for e in COPY.values() if e['type'] == vt and e['day'] >= frm and str(e['mid']) != skip]
    rows = [e for e in rows if e['day'] > frm or not no or numcmp(e['no'], no) is None or numcmp(e['no'], no) >= 0]
    rows.sort(key=lambda e: (e['day'], int(re.sub(r'\D', '', e['no']) or 0), e['no']))
    out = [{'mid': str(e['mid']), 'guid': e['guid'], 'day': e['day'], 'no': e['no'], 'alter': e['alter']} for e in rows]
    return {'ok': True, 'entries': out[:lim], 'more': len(out) > lim, 'unknown': 0}

def take_lines(b):
    for l in b.get('lines', []):
        ev, x = l.get('event', ''), l.get('xml', '')
        if ev in ('created', 'altered', 'imported') and x:
            g, a = tag(x, 'GUID'), int(re.sub(r'\D', '', tag(x, 'ALTERID')) or 0)
            old = COPY.get(g)
            if g and (old is None or a >= old['alter']):
                COPY[g] = {'mid': int(re.sub(r'\D', '', tag(x, 'MASTERID')) or 0), 'guid': g, 'day': tag(x, 'DATE'), 'no': tag(x, 'VOUCHERNUMBER'), 'alter': a, 'type': tag(x, 'VOUCHERTYPENAME')}
        elif ev == 'deleted':
            g = l.get('object_guid', '')
            mid = str(l.get('master_id', ''))
            for k in [k for k, e in COPY.items() if (g and k == g) or (not g and mid and str(e['mid']) == mid)]:
                COPY.pop(k, None)

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        with LOCK:
            b = json.dumps(sorted(COPY.values(), key=lambda e: (e['type'], e['day'], e['mid']))).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n).decode('utf-8', 'replace')
        try:
            body = json.loads(raw)
        except Exception:
            body = {'_raw': raw}
        kind = body.get('kind', '')
        with LOCK:
            if kind == 'recorder_lines':
                take_lines(body)
                res = [{'line_id': l.get('line_id', ''), 'state': 'applied', 'why': None} for l in body.get('lines', [])]
                out = {'ok': True, 'results': res, 'applied': len(res), 'held': 0, 'duplicate': 0, 'stale': 0, 'failed': 0}
            elif kind == '_seed':
                for e in body.get('entries', []):
                    COPY[e['guid']] = {'mid': int(e['mid']), 'guid': e['guid'], 'day': e['day'], 'no': e['no'], 'alter': int(e['alter']), 'type': e['type']}
                out = {'ok': True, 'n': len(COPY)}
            elif kind == 'renumber_list':
                out = renumber_list(body)
            elif kind == 'beat':
                out = {'ok': True, 'updateNow': False, 'posts': 0, 'trialTools': True}
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
