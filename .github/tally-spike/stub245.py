# Mode g245 (bridge 2.4.5's gate): a stand-in for FinCom's cloud (tally-ingest with migration 98) on 127.0.0.1, every
# request body kept (one JSON per line), answering as tally-ingest does where the bridge's behaviour depends on it.
# As stubg.py: beat recorderSource "both", recorder_lines held / applied, companies linked. And, as migration 98 and
# tally-ingest of next-245 do:
#   - beat: periodDays, at most 3: while counting, the days of the chosen year not yet counted (newest first, fetch false);
#     then the days of the chosen part FinCom does not hold in full (fetch true), with the six standard types
#   - period_heads: a day's heads [[guid, mid, alter, type]] kept as Tally's count of that day; when fetching, "want" =
#     the MasterIDs FinCom lacks (or holds at a lower AlterID); upload: the day marked "upload by hand", never listed again
#   - period_entries: each voucher's MasterID / GUID / AlterID / date taken as held (the date must be the day's); "gone"
#     taken out of the day's heads
#   - ledger_progress: kept (the step-5 bar); beat "ledgers" {company: at} when the harness asks for the ledger read
# ROUND 103 (the owner's decision of 21-Oct-2026, evening): ctl "night": true answers periodNight true and lists up to 30
# days (tally-ingest outside the computer's office hours); "employees" bodies kept (time, count; payroll rows only); each
# period_entries body's payroll vouchers (VCHTYPE Payroll: the employees' allocations counted) and salary payments
# (BANKEMPLOYEENAME) kept with any bank detail seen; every period_entries call's time and count (the night pace's speed)
# The harness steers it with a control file (argv 3, JSON, read again when it changes):
#   {"company": name, "phase": "off" | "count" | "fetch", "count_days": [yyyymmdd newest first], "part_days": [...],
#    "missing": [days FinCom holds nothing of when the fetch starts], "ledgers_at": "<ISO time>" or ""}
# and reads its state (argv 4, JSON, written after every change): counted {day: n}, heads {day: n}, held {day: n},
# done [days], upload {day: words}, want {day: [mids]}, entries_sent {day: n}, bad_dates [..], ledger_progress [..],
# beats, period_days_listed [[at, [days]]], tallyIni (the last beat's).
import json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG, CTL, STATE = sys.argv[2], sys.argv[3], sys.argv[4]
LOCK = threading.Lock()
HELD_LINES = {}
DONE_LINES = set()
STD = ['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra']
ctl = {'phase': 'off'}
ctl_mtime = 0.0
st = {'counted': {}, 'heads': {}, 'held': {}, 'done': [], 'upload': {}, 'want': {}, 'entries_sent': {}, 'bad_dates': [], 'ledger_progress': [],
      'beats': 0, 'period_days_listed': [], 'tallyIni': None, 'company_guid': '', 'fetch_seeded': False, 'heads_asked': {}, 'stops': [], 'stopped_for': None, 'oldDaysTest': None,
      'employees': [], 'payroll': [], 'salpay': [], 'entries_log': [], 'night_beats': 0, 'max_listed': 0}
HEADS = {}   # day -> {mid: (guid, alter, type)} as Tally last listed it
HOLD = {}    # day -> {mid: alter} FinCom holds
LED_SENT = ''

def load_ctl():
    global ctl, ctl_mtime
    try:
        m = os.path.getmtime(CTL)
    except OSError:
        return
    if m != ctl_mtime:
        try:
            ctl = json.load(open(CTL, encoding='utf-8-sig')); ctl_mtime = m
        except Exception:
            pass

def save_state():
    tmp = STATE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(st, f)
    os.replace(tmp, STATE)

def held_n(day):
    h = HEADS.get(day, {}); k = HOLD.get(day, {})
    return sum(1 for mid, (g, a, t) in h.items() if mid in k and k[mid] >= a)

def day_done(day):
    return day in st['counted'] and held_n(day) >= len(HEADS.get(day, {}))

def seed_fetch():
    # when a fetch starts (each new choice, chosen_at): FinCom holds every entry counted, except the days named missing
    # (as if their entries had never come)
    chosen = ctl.get('chosen_at') or '2026-04-01T00:00:00Z'
    if st['fetch_seeded'] == chosen:
        return
    miss = set(ctl.get('missing') or [])
    for d, h in HEADS.items():
        if d in miss:
            HOLD[d] = {}
        elif not st['fetch_seeded']:
            HOLD[d] = {mid: a for mid, (g, a, t) in h.items()}
    st['fetch_seeded'] = chosen

def period_days(guid):
    co = ctl.get('company', '')
    out = []
    ph = ctl.get('phase', 'off')
    mx = 30 if ctl.get('night') else 3
    chosen = ctl.get('chosen_at') or '2026-04-01T00:00:00Z'
    # ROUND 103 (1b): stopped by the bridge: nothing listed until the harness makes a fresh choice (a new chosen_at)
    if st['stopped_for'] and st['stopped_for'] == chosen:
        return out
    if ph == 'count':
        for d in ctl.get('count_days') or []:
            if d not in st['counted'] and d not in st['upload']:
                out.append({'company': co, 'company_guid': guid, 'day': d, 'fetch': False, 'types': STD, 'chosenAt': chosen})
            if len(out) == mx:
                break
    elif ph == 'fetch':
        seed_fetch()
        for d in ctl.get('part_days') or []:
            if d in st['upload']:
                continue
            if d not in st['counted'] or not day_done(d):
                out.append({'company': co, 'company_guid': guid, 'day': d, 'fetch': True, 'types': STD, 'chosenAt': chosen})
            if len(out) == mx:
                break
    return out

def refresh():
    st['held'] = {d: held_n(d) for d in HEADS}
    st['heads'] = {d: len(h) for d, h in HEADS.items()}
    st['done'] = sorted(d for d in HEADS if day_done(d))

def tag(x, t):
    m = re.search(r'<' + t + r'[^>]*>\s*([^<]*?)\s*</' + t + r'>', x)
    return m.group(1) if m else ''

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        global LED_SENT
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n).decode('utf-8', 'replace')
        try:
            body = json.loads(raw)
        except Exception:
            body = {'_raw': raw}
        kind = body.get('kind', '') if isinstance(body, dict) else ''
        logged = body
        with LOCK:
            load_ctl()
            if kind == 'recorder_lines':
                res = []
                for l in body.get('lines', []):
                    lid = str(l.get('line_id', '')); ev = str(l.get('event', ''))
                    if lid.endswith(':resolved'):
                        DONE_LINES.add(lid[:-9]); HELD_LINES.pop(lid[:-9], None)
                    if ev in ('created', 'altered', 'imported') and not l.get('xml') and not lid.endswith(':resolved') and not l.get('fid'):
                        res.append({'line_id': lid, 'state': 'held', 'why': l.get('heldWhy') or 'waiting for the entry from Tally'})
                        if lid not in DONE_LINES:
                            HELD_LINES.setdefault(lid, {'line_id': lid, 'company': body.get('company', ''), 'company_guid': l.get('company_guid', ''), 'event': ev,
                                                        'master_id': str(l.get('master_id') or ''), 'vch_type': l.get('vch_type', ''), 'vch_no': l.get('vch_no', ''), 'vch_date': l.get('vch_date', '')})
                    else:
                        res.append({'line_id': lid, 'state': 'applied', 'why': None})
                out = {'ok': True, 'results': res, 'applied': sum(1 for r in res if r['state'] == 'applied'), 'held': sum(1 for r in res if r['state'] == 'held'), 'duplicate': 0, 'stale': 0, 'failed': 0}
            elif kind == 'beat':
                st['beats'] += 1
                co = ctl.get('company', '')
                for c in body.get('companies') or []:
                    if isinstance(c, dict) and c.get('name') == co and c.get('guid'):
                        st['company_guid'] = c['guid']
                if body.get('tallyIni') is not None:
                    st['tallyIni'] = body.get('tallyIni')
                st['periodPull'] = body.get('periodPull')
                if body.get('oldDaysTest') is not None:
                    st['oldDaysTest'] = body.get('oldDaysTest')
                # ROUND 103 (1c): this computer's switch on (as the owner switches it in FinCom)
                out = {'ok': True, 'updateNow': False, 'posts': 0, 'trialTools': True, 'recorderSource': 'both', 'periodFetch': True, 'periodNight': bool(ctl.get('night'))}
                if ctl.get('night'):
                    st['night_beats'] += 1
                rf = list(HELD_LINES.values())[:20]
                if rf: out['refetch'] = rf
                if st['company_guid'] and ctl.get('phase') in ('count', 'fetch'):
                    pd = period_days(st['company_guid'])
                    out['periodDays'] = pd
                    if pd:
                        st['max_listed'] = max(st['max_listed'], len(pd))
                        st['period_days_listed'].append([time.strftime('%H:%M:%S'), [x['day'] for x in pd], pd[0]['fetch']])
                        st['period_days_listed'] = st['period_days_listed'][-400:]
                la = ctl.get('ledgers_at') or ''
                if la and co:
                    out['ledgers'] = {co: la}
                save_state()
                # a beat every 5 s for about two hours: the log keeps what this mode reads
                logged = {k2: body.get(k2) for k2 in ('version', 'open', 'tally', 'tallyState', 'periodPull', 'ledgerProgress', 'tallyIni', 'readStopped')}
            elif kind == 'period_heads':
                d = str(body.get('day', ''))
                if body.get('upload'):
                    st['upload'][d] = {'why': body.get('why', ''), 'type': body.get('type', ''), 'words': body.get('words', '')}
                    out = {'ok': True}
                else:
                    h = {}
                    for r in body.get('heads') or []:
                        if isinstance(r, list) and len(r) >= 4:
                            h[str(r[1])] = (str(r[0]), int(r[2] or 0), str(r[3]))
                    HEADS[d] = h
                    st.setdefault('head_mids', {})[d] = sorted(h.keys(), key=int)  # 2.4.9: a group's range read against the day's heads
                    st['payroll_mids'] = sorted(set(st.get('payroll_mids') or []) | {mid for mid, (g, a, t) in h.items() if t == 'Payroll'}, key=int)
                    st['counted'][d] = len(h)
                    st['heads_asked'][d] = st['heads_asked'].get(d, 0) + 1
                    out = {'ok': True, 'counted': len(h)}
                    if body.get('fetch'):
                        seed_fetch()
                        k = HOLD.setdefault(d, {})
                        want = sorted((mid for mid, (g, a, t) in h.items() if k.get(mid, -1) < a), key=int)[:2000]
                        st['want'][d] = want
                        # ROUND 104 (g3): tally_period_held gives at most 2,000 a day's answer (migration 98), so a day of
                        # more is wanted over two answers: every MasterID ever wanted for the day is kept for the check
                        wa = st.setdefault('want_all', {}); wa[d] = sorted(set(wa.get(d, [])) | set(want), key=int)
                        out['want'] = want
                    refresh()
                save_state()
                # the heads are many (about 2,200 a day): the log keeps their count only
                logged = {k2: v for k2, v in body.items() if k2 != 'heads'}
                logged['heads_n'] = len(body.get('heads') or [])
            elif kind == 'period_entries':
                d = str(body.get('day', ''))
                k = HOLD.setdefault(d, {}); n = 0
                BANK = ('ACCOUNTNUMBER', 'IFSCODE', 'PAYMENTFAVOURING', 'BENEFICIARYCODE', 'SWIFTCODE')
                for x in body.get('vouchers') or []:
                    x = str(x)
                    vt = tag(x, 'VOUCHERTYPENAME')
                    if vt == 'Payroll' or 'VCHTYPE="Payroll"' in x[:300]:
                        st['payroll'].append({'day': d, 'mid': re.sub(r'\D', '', tag(x, 'MASTERID')).lstrip('0'), 'no': tag(x, 'VOUCHERNUMBER'), 'alloc': x.count('<COSTCENTREALLOCATIONS.LIST>'),
                                              'employees': len(set(re.findall(r'<COSTCENTREALLOCATIONS\.LIST><NAME>([^<]*)</NAME>', x))), 'bank': [b for b in BANK if '<' + b in x], 'at': time.strftime('%H:%M:%S')})
                    elif 'BANKEMPLOYEENAME' in x:
                        st['salpay'].append({'day': d, 'no': tag(x, 'VOUCHERNUMBER'), 'employees': len(re.findall(r'<BANKEMPLOYEENAME>[^<]+</BANKEMPLOYEENAME>', x)), 'bank': [b for b in BANK if '<' + b in x]})
                    dd = re.sub(r'\D', '', tag(x, 'DATE'))
                    if dd != d:
                        st['bad_dates'].append([d, dd]); continue
                    mid = re.sub(r'\D', '', tag(x, 'MASTERID')).lstrip('0')
                    alt = int(re.sub(r'\D', '', tag(x, 'ALTERID')) or 0)
                    if mid:
                        k[mid] = max(alt, k.get(mid, -1)); n += 1
                for g in body.get('gone') or []:
                    HEADS.get(d, {}).pop(str(g), None)
                st['entries_sent'][d] = st['entries_sent'].get(d, 0) + n
                st['entries_log'].append([round(time.time(), 3), n])
                refresh()
                save_state()
                out = {'ok': True, 'taken': n}
                # the bodies are large: the log keeps their count and sizes only
                logged = {k2: v for k2, v in body.items() if k2 != 'vouchers'}
                logged['vouchers_n'] = len(body.get('vouchers') or []); logged['vouchers_chars'] = sum(len(str(v)) for v in body.get('vouchers') or [])
            elif kind == 'period_stop':
                st['stops'].append({k2: body.get(k2) for k2 in ('company', 'company_guid', 'day', 'why', 'words')} | {'at': time.strftime('%H:%M:%S')})
                st['stopped_for'] = ctl.get('chosen_at') or '2026-04-01T00:00:00Z'
                save_state()
                out = {'ok': True}
            elif kind == 'ledger_progress':
                st['ledger_progress'].append({k2: body.get(k2) for k2 in ('company', 'company_guid', 'round', 'read', 'of', 'done')} | {'at': time.strftime('%H:%M:%S')})
                save_state()
                out = {'ok': True}
            elif kind == 'employees':
                st['employees'].append({'at': round(time.time(), 3), 'n': len(body.get('employees') or []), 'complete': body.get('complete')})
                save_state()
                out = {'ok': True, 'employees': len(body.get('employees') or [])}
                logged = {k2: v for k2, v in body.items() if k2 != 'employees'}
                logged['employees_n'] = len(body.get('employees') or [])
            elif kind == 'hello':
                out = {'ok': True, 'firm': 'Spike', 'device': 'runner'}
            elif kind == 'companies':
                out = {'ok': True, 'links': {str(c.get('name', '')): True for c in (body.get('companies') or []) if isinstance(c, dict)}}
            else:
                out = {'ok': True}
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'at': time.strftime('%H:%M:%S'), 'kind': kind, 'device': self.headers.get('x-fincom-device', ''), 'body': logged, 'answer': out}) + '\n')
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
