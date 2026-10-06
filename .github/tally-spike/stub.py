# A stand-in for FinCom's cloud (tally-ingest) on 127.0.0.1: every request body is kept (one JSON per line), and each
# call gets a 200 with the smallest answer that lets the bridge go on: recorder_lines -> every line "applied".
# Bridge 2.3.1 masters (scenarios S8 and S9, as tally-ingest at b-231 does them):
#  - the book's ledger list per company: seeded by the harness ({"kind": "_seed_ledgers", company, names}: the ledgers
#    FinCom has from an earlier full list), kept current by kind "ledger_changes" (rows [guid, mid, alter, name, parent,
#    opening, gstin, pan, openingChanged, state]); a company never seeded holds nothing (as a book with no ledger list)
#  - recorder_lines: a line whose body (xml) names a ledger the book does not have is held "waiting for the ledger
#    '<name>' from Tally ..." (ledgerWait); the beat then answers ledgersWanted [{company, company_guid, name}] for this
#    bridge's held lines, and, once every ledger is in, refetch [{line_id, company, company_guid, event, master_id, vch_type,
#    vch_no, vch_date, ledgerAgain?}] until "<line id>:resolved" is applied
import html, json, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[2]
LOCK = threading.Lock()
BOOK = {}      # company -> {lower name: name}
HELD = {}      # base line id -> {line, company, bridge, waits, again, done}
GUIDS = {}     # company -> {ledger GUID: FinCom's name}  (seeded with the names)
POSTS = []     # the retry check's posting: {id, company, payload, taken, updates} (a FinCom posting job, as tally-ingest's queue gives it)
ALIAS = {}     # company -> {lower Tally name: FinCom's name}: a ledger renamed in Tally, kept under FinCom's name (2.3.1, as
               # tally-ingest with migration 59: the GUID FinCom holds, the new name noted)
LEDGER_WAIT = 'waiting for the ledger'
RE_LED = re.compile(r'<LEDGERNAME(?:\s[^>]*)?>([^<]*)</LEDGERNAME>')

def words(names):
    one = len(names) == 1
    q = ', '.join("'" + n + "'" for n in names[:5])
    return ((LEDGER_WAIT + ' ' if one else LEDGER_WAIT + 's ') + q + ' from Tally (FinCom does not have ' + ('it' if one else 'them') +
            ' yet; the bridge fetches ' + ('it' if one else 'them') + ', then the entry is applied)')[:300]

def missing(company, names):
    b = BOOK.get(company)
    if b is None:
        return []
    out = []
    for n in names:
        if n and n.lower() not in b and n not in out:
            out.append(n)
    return out

def recorder(body):
    company = str(body.get('company', ''))
    bridge = str((body.get('bridge') or {}).get('id', ''))
    res = []
    for l in body.get('lines', []) or []:
        lid = str(l.get('line_id', ''))
        base = lid[:-9] if lid.endswith(':resolved') else lid
        xml = l.get('xml') or ''
        ev = str(l.get('event', ''))
        state, why = 'applied', None
        if xml and not ev.startswith('ledger_'):
            names = [html.unescape(m).strip() for m in RE_LED.findall(xml)]
            miss = missing(company, names)
            if miss:
                state, why = 'held', words(miss)
                h = HELD.get(base)
                if h is None:
                    HELD[base] = {'line': l, 'company': company, 'bridge': bridge, 'waits': miss, 'again': lid != base, 'done': False, 'heldAt': time.strftime('%H:%M:%S')}
                else:
                    h['waits'] = miss
                    h['again'] = h['again'] or lid != base
        if state == 'applied' and xml and not ev.startswith('ledger_'):
            al = ALIAS.get(company, {})
            under = [(n, al[n.lower()]) for n in dict.fromkeys(html.unescape(m).strip() for m in RE_LED.findall(xml)) if n.lower() in al]
            if under:
                why = '; '.join("applied under FinCom's ledger '%s' (named '%s' in Tally now)" % (old, new) for new, old in under)
        if state == 'applied' and base in HELD and lid != base:
            HELD[base]['done'] = True
            HELD[base]['appliedAt'] = time.strftime('%H:%M:%S')
            HELD[base]['appliedWhy'] = why
        res.append({'line_id': lid, 'state': state, 'why': why})
    n = lambda k: sum(1 for r in res if r['state'] == k)
    return {'ok': True, 'results': res, 'applied': n('applied'), 'held': n('held'), 'duplicate': 0, 'stale': 0, 'failed': 0}

def beat(body):
    out = {'ok': True, 'updateNow': False, 'posts': sum(1 for p in POSTS if not p['taken'])}
    bridge = str((body.get('bridge') or {}).get('id', ''))
    wanted, refetch = [], []
    for base, h in HELD.items():
        if h['done'] or h['bridge'] != bridge:
            continue
        l = h['line']
        miss = missing(h['company'], h['waits'])
        if miss:
            for name in miss:
                if not any(w['name'] == name and w['company'] == h['company'] for w in wanted):
                    wanted.append({'company': h['company'], 'company_guid': l.get('company_guid', ''), 'name': name})
        else:
            e = {'line_id': base, 'company': h['company'], 'company_guid': l.get('company_guid', ''), 'event': l.get('event', ''),
                 'master_id': str(l.get('master_id', '')), 'vch_type': l.get('vch_type', ''), 'vch_no': l.get('vch_no', ''), 'vch_date': str(l.get('vch_date', '')).replace('-', '')}
            if h['again']:
                e['ledgerAgain'] = True
            refetch.append(e)
    if wanted:
        out['ledgersWanted'] = wanted[:20]
    if refetch:
        out['refetch'] = refetch[:20]
    return out

def ledger_changes(body):
    company = str(body.get('company', ''))
    b = BOOK.setdefault(company, {})
    g = GUIDS.setdefault(company, {})
    added, kept = 0, []
    for r in body.get('ledgers', []) or []:
        name = str(r[3] if isinstance(r, list) and len(r) > 3 else '').strip()
        guid = str(r[0] if isinstance(r, list) and r else '').strip()
        have = g.get(guid) if guid else None
        if have and have != name:
            # the GUID FinCom holds under another name: kept under FinCom's name, the new name noted (an alias)
            ALIAS.setdefault(company, {})[name.lower()] = have
            b[name.lower()] = have
            kept.append("'%s' is named '%s' in Tally now: kept under FinCom's name (GUID %s)" % (have, name, guid))
            continue
        if name and name.lower() not in b:
            b[name.lower()] = name
            if guid:
                g[guid] = name
            added += 1
    rows = body.get('ledgers') or []
    return {'ok': True, 'ledgers': len(rows), 'added': added, 'updated': len(rows) - added, 'kept': kept}

class H(BaseHTTPRequestHandler):
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
                out = recorder(body)
            elif kind == 'beat':
                out = beat(body)
            elif kind == 'hello':
                out = {'ok': True, 'firm': 'Spike', 'device': 'runner'}
            elif kind == 'companies':
                out = {'ok': True, 'links': {}}
            elif kind == 'ledger_changes':
                out = ledger_changes(body)
            elif kind == '_seed_ledgers':
                BOOK[str(body.get('company', ''))] = {str(x).strip().lower(): str(x).strip() for x in body.get('names', []) if str(x).strip()}
                GUIDS[str(body.get('company', ''))] = {str(k): str(v) for k, v in (body.get('guids') or {}).items()}
                out = {'ok': True, 'seeded': len(BOOK[str(body.get('company', ''))])}
            elif kind == '_queue_post':
                POSTS.append({'id': str(body.get('id')), 'company': body.get('company'), 'payload': body.get('payload'), 'taken': None, 'updates': []})
                out = {'ok': True, 'queued': len(POSTS)}
            elif kind == 'posts_take':
                job = next((p for p in POSTS if not p['taken']), None)
                if job:
                    job['taken'] = time.strftime('%H:%M:%S')
                    out = {'ok': True, 'job': {'id': job['id'], 'company': job['company'], 'payload': job['payload'], 'released': [], 'resendOnly': []}}
                else:
                    out = {'ok': True, 'job': None}
            elif kind == 'posts_update':
                for p in POSTS:
                    if p['id'] == str(body.get('id')):
                        p['updates'].append({'at': time.strftime('%H:%M:%S'), 'status': body.get('status'), 'done': body.get('done'), 'message': body.get('message')})
                out = {'ok': True}
            elif kind == '_state':
                out = {'ok': True, 'book': {k: sorted(v.values()) for k, v in BOOK.items()}, 'held': {k: {a: b for a, b in h.items() if a != 'line'} for k, h in HELD.items()}}
            else:
                out = {'ok': True}
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'at': time.strftime('%H:%M:%S'), 'kind': kind, 'device': self.headers.get('x-fincom-device', ''), 'body': body, 'answer': out}) + '\n')
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
