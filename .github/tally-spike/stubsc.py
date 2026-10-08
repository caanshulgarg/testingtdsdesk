# Versions harness, mode selfck (2.4.0's nightly self-check, next-selfcheck; migration 65): stubv.py's stand-in for FinCom's
# cloud (every request body kept, one JSON per line; recorder_lines -> every line "applied"; beat with trialTools) that ALSO
# keeps FinCom's copy of the entries (GUID -> the highest AlterID it holds, from each entry line that carries Tally's entry;
# a delete marks it deleted) and answers tally-ingest's kind "selfcheck" as tally_selfcheck_compare / _record do:
#   compare {entries: [[guid, alter, masterId, yyyymmdd]]} -> {ok, missing: [{guid, why: absent|older|deleted, alter, have}],
#           received: the highest AlterID in the copy}
#   record  {listed, missing, fetched, still, deleted, mastersBehind, stopped, fetchOff, gapDays, night, since, ran_at}
#           -> {ok, id, result: ok|fetched|missing|not_checked, words}: the words from migration 65's own
#           public.tally_selfcheck_words, run in the runner's PostgreSQL (argv 3: a JSON file {psql, db, env}); the result and
#           the counts derived as tally_selfcheck_record derives them (clamps, the result's order); no copy check (null)
#   POST {"kind": "_ctl", "forget": [guid, ...]} (the harness only): the copy loses those entries (FinCom lacks them)
#   GET /copy: the copy as JSON
import json, re, sys, threading, time, html, subprocess, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[2]
PG = json.load(open(sys.argv[3], encoding='utf-8-sig')) if len(sys.argv) > 3 and os.path.exists(sys.argv[3]) else None
LOCK = threading.Lock()
COPY = {}   # guid -> {alter, deleted}
REC = {'n': 0}

def tag(x, t):
    m = re.search(r'<' + t + r'(?:\s[^>]*)?>([^<]*)</' + t + '>', x or '')
    return html.unescape(m.group(1)).strip() if m else ''

def num(v, hi):
    s = str(v if v is not None else '')
    return min(int(s), hi) if re.fullmatch(r'[0-9]{1,7}', s) else 0

def sqlq(s):
    return "'" + str(s).replace("'", "''") + "'"

def words(r):
    listed = num(r.get('listed'), 1000000); missing = num(r.get('missing'), 1000000)
    fetched = min(num(r.get('fetched'), 1000000), missing); still = num(r.get('still'), 1000000)
    deleted = min(num(r.get('deleted'), 1000000), still)
    mb = str(r.get('mastersBehind') or ''); masters = int(mb) if re.fullmatch(r'[0-9]{1,15}', mb) else 0
    stopped = str(r.get('stopped') or '').strip()[:300]; foff = str(r.get('fetchOff') or '').strip()[:300]
    night = str(r.get('night') or ''); since = str(r.get('since') or '')
    gap = sorted(set(x for x in (r.get('gapDays') or []) if re.fullmatch(r'[0-9]{8}', str(x))))
    res = 'not_checked' if stopped else 'missing' if still > 0 else 'fetched' if fetched > 0 else 'ok'
    if not PG:
        return res, '', 'no PostgreSQL for the words'
    d = lambda s: ("to_date(%s, 'YYYYMMDD')" % sqlq(s)) if re.fullmatch(r'[0-9]{8}', s) else 'null::date'
    args = ("%s, %s::timestamptz, %s, %s, %d, %d, %d, %d, %d, %d::bigint, %s, %s, %s, null::jsonb" %
         (sqlq(res), sqlq(r.get('ran_at') or time.strftime('%Y-%m-%dT%H:%M:%S%z')), d(night), d(since), listed, missing, fetched, still, deleted, masters,
          sqlq(stopped), sqlq(foff), ("array[%s]::date[]" % ', '.join("to_date(%s, 'YYYYMMDD')" % sqlq(g) for g in gap)) if gap else "'{}'::date[]"))
    # the 2.4.0 review's form takes p_x ({after, altvchid, sliceFrom, sliceTo} as the record keeps them); the first form
    # does not: the one migration 65 at the ref made is used
    px = json.dumps({k: str(r.get(k)) for k in ('after', 'altvchid', 'sliceFrom', 'sliceTo') if r.get(k) is not None})
    err = ''
    for q in ("select public.tally_selfcheck_words(%s, %s::jsonb)" % (args, sqlq(px)), "select public.tally_selfcheck_words(%s)" % args):
        try:
            p = subprocess.run([PG['psql'], '-At', '-d', PG['db'], '-c', q], capture_output=True, text=True, timeout=30, env=dict(os.environ, **PG.get('env', {})))
            if p.returncode == 0:
                return res, p.stdout.strip(), ''
            err = 'psql: ' + (p.stderr or p.stdout).strip()[:300]
        except Exception as e:
            err = 'psql: %s' % e
    return res, '', err

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        with LOCK:
            b = json.dumps(COPY).encode()
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
                res = []
                for l in body.get('lines', []):
                    res.append({'line_id': l.get('line_id', ''), 'state': 'applied', 'why': None})
                    g = str(l.get('object_guid') or ''); ev = str(l.get('event') or '')
                    if not g:
                        continue
                    if ev == 'deleted':
                        COPY[g] = {'alter': COPY.get(g, {}).get('alter', 0), 'deleted': True}
                    elif l.get('xml'):
                        a = 0
                        try: a = int(l.get('alter_id') or tag(l.get('xml'), 'ALTERID') or 0)
                        except Exception: a = 0
                        if a >= COPY.get(g, {}).get('alter', -1):
                            COPY[g] = {'alter': a, 'deleted': False}
                out = {'ok': True, 'results': res, 'applied': len(res), 'held': 0, 'duplicate': 0, 'stale': 0, 'failed': 0}
            elif kind == 'selfcheck' and body.get('step') == 'compare':
                miss = []
                for e in body.get('entries') or []:
                    g, a = str(e[0]), int(e[1] or 0)
                    c = COPY.get(g)
                    if c is None: miss.append({'guid': g, 'why': 'absent', 'alter': a, 'have': None})
                    elif c.get('deleted'): miss.append({'guid': g, 'why': 'deleted', 'alter': a, 'have': c.get('alter')})
                    elif c.get('alter', 0) < a: miss.append({'guid': g, 'why': 'older', 'alter': a, 'have': c.get('alter')})
                out = {'ok': True, 'n': len(body.get('entries') or []), 'missing': miss, 'received': max([c.get('alter', 0) for c in COPY.values()] or [0])}
            elif kind == 'selfcheck' and body.get('step') == 'record':
                REC['n'] += 1
                res, w, err = words(body)
                out = {'ok': True, 'id': REC['n'], 'result': res, 'words': w, 'copy': None}
                if err: out['harnessError'] = err
            elif kind == 'beat':
                out = {'ok': True, 'updateNow': False, 'posts': 0, 'trialTools': True}
            elif kind == 'hello':
                out = {'ok': True, 'firm': 'Spike', 'device': 'runner'}
            elif kind == 'companies':
                out = {'ok': True, 'links': {}}
            elif kind == '_ctl':
                for g in body.get('forget') or []:
                    COPY.pop(str(g), None)
                out = {'ok': True, 'copy': len(COPY)}
            else:
                out = {'ok': True}
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'at': time.strftime('%H:%M:%S'), 'ms': round(time.time() * 1000), 'kind': kind, 'device': self.headers.get('x-fincom-device', ''), 'body': body, 'answer': out}) + '\n')
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
