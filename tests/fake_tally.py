"""A stand-in for TallyPrime on port 9000: answers the bridge's requests from the real VMS files."""
import re, threading, http.server, pickle, os, bisect
import os
_DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
DAYBOOK = os.path.join(_DATA, "DayBook.xml")
MASTER = os.path.join(os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")), "Master.xml")
COMPANY = "VMS EVENTS PRIVATE LIMITED (2024-25)"
cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "fake-tally.pkl")
if os.path.exists(cache):
    V, L = pickle.load(open(cache, "rb"))
else:
    V = []  # (date, xml of one voucher)
    f = open(DAYBOOK, encoding="utf-16"); buf = ""
    for chunk in iter(lambda: f.read(1 << 22), ""):
        buf += chunk
        while True:
            i = buf.find("</VOUCHER>")
            if i < 0: break
            s = buf.rfind("<TALLYMESSAGE", 0, i); e = buf.find("</TALLYMESSAGE>", i) + len("</TALLYMESSAGE>")
            piece = buf[s:e]; buf = buf[e:]
            d = re.search(r"<DATE>(\d{8})</DATE>", piece).group(1)
            V.append((d, piece))
    m = open(MASTER, encoding="utf-16").read()
    L = []
    for x in re.finditer(r'<LEDGER NAME="([^"]*)"(.*?)</LEDGER>', m, re.S):
        p = re.search(r"<PARENT>([^<]*)</PARENT>", x.group(2)); ob = re.search(r"<OPENINGBALANCE>([^<]*)</OPENINGBALANCE>", x.group(2))
        L.append((x.group(1), p.group(1) if p else "", float((ob.group(1) if ob else "0").replace(",", "") or 0)))
    V.sort(key=lambda z: z[0])
    pickle.dump((V, L), open(cache, "wb"))
dates = [d for d, _ in V]
def amounts_until(asOn):
    bal = {}
    for d, piece in V[:bisect.bisect_right(dates, asOn)]:
        for e in re.finditer(r"<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>", piece, re.S):
            bal[e.group(1)] = bal.get(e.group(1), 0) + float(e.group(2))
    for d, _, _, piece in list(POSTED):
        if d > asOn: continue
        for e in re.finditer(r"<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>", piece, re.S):
            nm = e.group(1).replace("&amp;", "&")
            bal[nm] = bal.get(nm, 0) + float(e.group(2))
    return bal
# what the tests make this Tally do when entries are imported: be slow, stop answering (after or before creating), refuse
CTRL = {"delay": 0.0, "hang_after": 0, "hang_before": 0, "hang_sec": 25, "refuse": 0}
BUSY = []            # (start, end) of every request, to see how much of Tally's time was taken
POSTED = []          # (date, narration, number, xml) of every voucher created here
DELETED = []
BODIES = []
REQS = {}
INFLIGHT = [0, 0]     # [now, most at once]
_cnt = __import__("threading").Lock()
LOG = []             # (kind, from, to) of every request, for the tests to see how much was asked at a time            # how many requests of each kind this Tally was asked (the tests check nothing heavy is asked)
def _kind(body):
    for k in ("TDSDeskKeepList", "TDSDeskKeepLed", "TDSDeskKeepCo", "TDSDeskKeepBal", "TDSDeskLedVch", "TDSDeskOneLed", "TDSDeskVchHeads", "TDSDeskBalances", "TDSDeskGroupNames", "TDSDeskNames", "TDSDeskTB", "TDSDeskLedgers", "TDSDeskCompanies"):
        if k in body: return k
    if "<REPORTNAME>Day Book</REPORTNAME>" in body: return "DayBook"
    if "Import Data" in body: return "Import"
    return "other"
def _with_ids(vx, d, num):
    return re.sub(r"^(<VOUCHER\b[^>]*>)", lambda m: m.group(1) + "<GUID>g-%s</GUID><MASTERID>%d</MASTERID><VOUCHERNUMBER>%s</VOUCHERNUMBER>" % (num, 900000 + int(num), num), re.sub(r"<DATE>[^<]*</DATE>", "<DATE>%s</DATE>" % d, vx, 1))
LEDGERS_MADE = []
_lock = threading.Lock(); _serial = threading.Lock()
def posted_tags():
    return [t for _, n, _, _ in POSTED for t in re.findall(r"TDSDesk:[A-Za-z0-9._-]+", n)]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        with _cnt: INFLIGHT[0] += 1; INFLIGHT[1] = max(INFLIGHT[1], INFLIGHT[0])      # requests at Tally at the same moment
        try: return self._post_serial()
        finally:
            with _cnt: INFLIGHT[0] -= 1
    def _post_serial(self):
        with _serial:                           # like TallyPrime: one request at a time
            import time as _tb
            t0 = _tb.time()
            try: return self._post()
            finally: BUSY.append((t0, _tb.time()))
    def _post(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8")
        g = lambda t: (re.search("<" + t + ">([^<]*)</" + t + ">", body) or [None, ""])[1]
        REQS[_kind(body)] = REQS.get(_kind(body), 0) + 1
        LOG.append((_kind(body), g("SVFROMDATE"), g("SVTODATE")))
        if CTRL.get("all_delay"): __import__("time").sleep(CTRL["all_delay"])     # a Tally slow at everything (still loading, say)
        if "<TALLYREQUEST>Import Data</TALLYREQUEST>" in body:
            CTRL["_imported"] = True
            BODIES.append(body[-600:])
            import time as _t
            if CTRL["refuse"] > 0:
                CTRL["refuse"] -= 1; self.close_connection = True; return
            if CTRL["hang_before"] > 0:
                CTRL["hang_before"] -= 1; _t.sleep(CTRL["hang_sec"])
            _t.sleep(CTRL["delay"])
            with _lock:
                if 'ACTION="Delete"' in body:
                    # CTRL delete_mode: "" any way; "number" only by date (d-MMM-yyyy) and voucher number; "refuse" never
                    mode = CTRL.get("delete_mode", "")
                    rid = (re.search(r'REMOTEID="([^"]*)"', body) or [0, ""])[1]
                    num = (re.search(r'TAGNAME="Voucher Number" TAGVALUE="([^"]*)"', body) or [0, ""])[1]
                    dat = (re.search(r'<VOUCHER DATE="([^"]*)"', body) or [0, ""])[1]
                    before = len(POSTED)
                    if mode == "refuse": pass
                    elif rid and mode != "number": POSTED[:] = [x for x in POSTED if "g-" + x[2] != rid]
                    elif num and re.match(r"\d{1,2}-[A-Z][a-z]{2}-\d{4}$", dat): POSTED[:] = [x for x in POSTED if x[2] != num]
                    n = before - len(POSTED)
                    if n: DELETED.append(rid or num)
                    err = "" if n else ("<LINEERROR>Deleting vouchers is not allowed for this user.</LINEERROR>" if mode == "refuse" else "<LINEERROR>Voucher does not exist!</LINEERROR>")
                    out = "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>%d</DELETED><ERRORS>%d</ERRORS><EXCEPTIONS>0</EXCEPTIONS>%s</RESPONSE>" % (n, 0 if n else 1, err)
                elif "<VOUCHER" in body:
                    made, errs = 0, []
                    for vx in re.findall(r"<VOUCHER\b.*?</VOUCHER>", body, re.S):
                        if "NoSuchLedger" in vx: errs.append("Ledger 'NoSuchLedger' does not exist!"); continue
                        d = (re.search(r"<DATE>(\d{8})</DATE>", vx) or [0, ""])[1]; n = (re.search(r"<NARRATION>([^<]*)</NARRATION>", vx) or [0, ""])[1]
                        if not d:
                            # what a real Tally did with an empty date: complained, and (sometimes) made it anyway on another date
                            errs.append("Voucher date is missing for: 'Payment' voucher 1. Verify the data, resolve errors (if any) and retry Split.")
                            if not CTRL.get("empty_date_creates"): continue
                            d = CTRL["empty_date_creates"]
                        num = str(len(POSTED) + 1 + len(DELETED)); POSTED.append((d, n, num, vx)); made += 1
                    vid = str(900000 + len(POSTED))
                    out = "<RESPONSE><CREATED>%d</CREATED><ALTERED>0</ALTERED><ERRORS>%d</ERRORS><EXCEPTIONS>0</EXCEPTIONS>%s<LASTVCHID>%s</LASTVCHID></RESPONSE>" % (made, len(errs), "".join("<LINEERROR>%s</LINEERROR>" % e for e in errs), vid)
                else:
                    LEDGERS_MADE.append(body)
                    out = "<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>"
            if CTRL["hang_after"] > 0:
                CTRL["hang_after"] -= 1; _t.sleep(CTRL["hang_sec"])
        elif "TDSDeskLedVch" in body:
            import time as _t2
            if CTRL.get("read_delay"): _t2.sleep(CTRL["read_delay"])
            if CTRL.get("read_delay_after_import") and CTRL.get("_imported"): _t2.sleep(CTRL["read_delay_after_import"])
            if CTRL.get("no_ledvch"):
                out = "<ENVELOPE><BODY><DATA><LINEERROR>Could not find Collection</LINEERROR></DATA></BODY></ENVELOPE>"
            else:
                a, b = g("SVFROMDATE"), g("SVTODATE"); led = g("CHILDOF")
                lo, hi = bisect.bisect_left(dates, a), bisect.bisect_right(dates, b)
                tagv = "<LEDGERNAME>%s</LEDGERNAME>" % led
                mine = [p for _, p in V[lo:hi] if tagv in p]
                with _lock: mine += [_with_ids(vx, d, num) for d, _, num, vx in list(POSTED) if a <= d <= b and tagv in vx]
                out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join(mine) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskOneLed" in body:
            asOn = g("SVTODATE"); name = (re.search(r'\$Name = "([^"]*)"', body) or [0, ""])[1]
            if CTRL.get("ignore_balance_dates"): asOn = "99991231"      # like a Tally that gives its latest balance whatever the date
            plain = name.replace("&amp;", "&"); mv = amounts_until(asOn)
            hit = [(n, ob) for n, _, ob in L if n.replace("&amp;", "&") == plain]
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><NAME>%s</NAME><CLOSINGBALANCE>%.2f</CLOSINGBALANCE></LEDGER>' % (n, n, ob + mv.get(plain, mv.get(n, 0))) for n, ob in hit) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskVchHeads" in body:
            a, b = g("SVFROMDATE"), g("SVTODATE")
            with _lock: mine = [x for x in POSTED if a <= x[0] <= b]
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<VOUCHER><DATE>%s</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER><NARRATION>%s</NARRATION><MASTERID>%d</MASTERID><GUID>g-%s</GUID><ISOPTIONAL>No</ISOPTIONAL></VOUCHER>' % (d, num, n, 900000 + int(num), num) for d, n, num, _ in mine) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskCompanies" in body or "TDSDeskCompanyInfo" in body:
            out = '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="%s"><NAME>%s</NAME><STARTINGFROM>20240401</STARTINGFROM></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>' % (COMPANY.replace("&", "&amp;"), COMPANY)
        elif "<REPORTNAME>Day Book</REPORTNAME>" in body:
            a, b = g("SVFROMDATE"), g("SVTODATE")
            if CTRL.get("daybook_delay"):
                import time as _td; _td.sleep(CTRL["daybook_delay"])
            if any(a <= d <= b for d in CTRL.get("fail_days", ())):
                # like a Tally that cannot give these days: the request just dies
                self.close_connection = True; return
            lo, hi = bisect.bisect_left(dates, a), bisect.bisect_right(dates, b)
            out = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>%s</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" % COMPANY + "".join(p for _, p in V[lo:hi]) + "".join('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + re.sub(r"^(<VOUCHER\b[^>]*>)", lambda m: m.group(1) + "<GUID>g-%s</GUID><MASTERID>%d</MASTERID><VOUCHERNUMBER>%s</VOUCHERNUMBER>" % (num, 900000 + int(num), num), re.sub(r"<DATE>[^<]*</DATE>", "<DATE>%s</DATE>" % d, vx, 1)) + "</TALLYMESSAGE>" for d, _, num, vx in list(POSTED) if a <= d <= b) + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
        elif "TDSDeskKeepCo" in body:
            if CTRL.get("no_counters"):
                out = '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="%s"><NAME>%s</NAME></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>' % (COMPANY, COMPANY)
            else:
                out = '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="%s"><ALTVCHID TYPE="Number"> %d</ALTVCHID><ALTMSTID TYPE="Number"> %d</ALTMSTID></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>' % (COMPANY, _alter[0], _malter[0])
        elif "TDSDeskKeepLed" in body:
            after = re.search(r"\$AlterID &gt; (\d+)", body); lim = int(after.group(1)) if after else -1
            rows = ['<LEDGER NAME="%s"><GUID>%s</GUID><ALTERID> %d</ALTERID><PARENT>%s</PARENT></LEDGER>' % (n, led_guid(n), LALT.get(led_guid(n), 1), p) for n, p, _ in L if LALT.get(led_guid(n), 1) > lim]
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join(rows) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskKeepList" in body:
            a, b = g("SVFROMDATE"), g("SVTODATE")
            after = re.search(r"\$AlterID &gt; (\d+)", body)
            lo, hi = bisect.bisect_left(dates, a), bisect.bisect_right(dates, b)
            rows = []
            for d, pc in V[lo:hi]:
                gu = re.search(r"<GUID>([^<]*)</GUID>", pc).group(1); al = int(re.search(r"<ALTERID>\s*(\d+)", pc).group(1))
                if after and al <= int(after.group(1)): continue
                rows.append("<VOUCHER><GUID>%s</GUID><ALTERID> %d</ALTERID><DATE>%s</DATE></VOUCHER>" % (gu, al, d))
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join(rows) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskKeepBal" in body:
            asOn = g("SVTODATE"); mv = amounts_until(asOn)
            if CTRL.get("bal_delay"): __import__("time").sleep(CTRL["bal_delay"])      # a Tally that works out every balance each time
            allL = "TDSDeskKeepThese" not in body
            want = set(__import__("html").unescape(n) for n in re.findall(r'\$Name = (?:&quot;|&#34;|")(.*?)(?:&quot;|&#34;|")(?: OR |</SYSTEM>)', body))
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT><CLOSINGBALANCE>%.2f</CLOSINGBALANCE></LEDGER>' % (n, p, ob + mv.get(n.replace("&amp;", "&"), mv.get(n, 0))) for n, p, ob in L if allL or __import__("html").unescape(n) in want or n in want) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskTB" in body:
            asOn = g("SVTODATE"); mv = amounts_until(asOn)
            rows = [(n, p, ob + mv.get(n.replace("&amp;", "&"), mv.get(n, 0))) for n, p, ob in L]
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT><CLOSINGBALANCE>%.2f</CLOSINGBALANCE></LEDGER>' % (n, p, b) for n, p, b in rows if abs(b) >= 0.005) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskGroupNames" in body:
            gs = sorted(set(p for _, p, _ in L if p))
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<GROUP NAME="%s"><PARENT></PARENT></GROUP>' % gname for gname in gs) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskNames" in body:
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT></LEDGER>' % (n, p) for n, p, _ in L) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskBalances" in body:
            asOn = g("SVTODATE"); mv = amounts_until(asOn)
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT><CLOSINGBALANCE>%.2f</CLOSINGBALANCE></LEDGER>' % (n, p, ob + mv.get(n.replace("&amp;", "&"), mv.get(n, 0))) for n, p, ob in L) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskLedgers" in body:
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT></LEDGER>' % (n, p) for n, p, _ in L[:300] + [x for x in L[300:] if "BANK ACCOUNT" in x[0]]) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        else:
            out = "<ENVELOPE><BODY><DATA></DATA></BODY></ENVELOPE>"
        data = out.encode("utf-8")
        self.send_response(200); self.send_header("Content-Type", "text/xml; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
_alter = [max(int(re.search(r"<ALTERID>\s*(\d+)", p).group(1)) for _, p in V) if V else 0]
def _resort():
    V.sort(key=lambda z: z[0]); dates[:] = [d for d, _ in V]
def edit_amount(guid, factor):
    """change every amount in one entry by a factor, as a user editing it in Tally would; it gets a new change number"""
    for i, (d, pc) in enumerate(V):
        if "<GUID>%s</GUID>" % guid in pc:
            _alter[0] += 1
            pc = re.sub(r"<AMOUNT>(-?[\d.]+)</AMOUNT>", lambda m: "<AMOUNT>%.2f</AMOUNT>" % (float(m.group(1)) * factor), pc)
            pc = re.sub(r"<ALTERID>\s*\d+</ALTERID>", "<ALTERID> %d</ALTERID>" % _alter[0], pc)
            V[i] = (d, pc); return _alter[0]
def delete(guid):
    for i, (d, pc) in enumerate(V):
        if "<GUID>%s</GUID>" % guid in pc:
            del V[i]; _resort()
            if CTRL.get("delete_bumps", True): _alter[0] += 1     # a deletion moves the company's change counter
            return d
def add_copy(guid, new_date, new_guid):
    """a new entry: a copy of one entry on another date"""
    for d, pc in list(V):
        if "<GUID>%s</GUID>" % guid in pc:
            _alter[0] += 1
            pc2 = pc.replace("<GUID>%s</GUID>" % guid, "<GUID>%s</GUID>" % new_guid).replace("<DATE>%s</DATE>" % d, "<DATE>%s</DATE>" % new_date)
            pc2 = re.sub(r"<ALTERID>\s*\d+</ALTERID>", "<ALTERID> %d</ALTERID>" % _alter[0], pc2)
            V.append((new_date, pc2)); _resort(); return _alter[0]
# ledger masters: each has a GUID and its own change number (Tally counts masters apart from entries)
LGUID = {}; LALT = {}; _malter = [1000]
def led_guid(n):
    if n not in LGUID: LGUID[n] = "led-%d" % len(LGUID)
    return LGUID[n]
for _n, _p, _o in L: led_guid(_n)
def _mbump(n): _malter[0] += 1; LALT[led_guid(n)] = _malter[0]
def rename_ledger(old, new):
    """a ledger renamed in Tally: its entries show the new name, their own change numbers stay as they were"""
    for i, (n, p, ob) in enumerate(L):
        if n == old:
            gid = LGUID.pop(old); LGUID[new] = gid; L[i] = (new, p, ob); _mbump(new)
    for i, (d, pc) in enumerate(V):
        if ">%s<" % old in pc: V[i] = (d, pc.replace("<LEDGERNAME>%s</LEDGERNAME>" % old, "<LEDGERNAME>%s</LEDGERNAME>" % new).replace("<PARTYLEDGERNAME>%s</PARTYLEDGERNAME>" % old, "<PARTYLEDGERNAME>%s</PARTYLEDGERNAME>" % new))
def set_opening(name, ob):
    for i, (n, p, o) in enumerate(L):
        if n == name: L[i] = (n, p, ob); _mbump(n)
def add_ledger(name, parent, ob):
    L.append((name, parent, ob)); _mbump(name)
def move_date(guid, new_date):
    """an entry whose date is changed in Tally: same GUID, a new change number"""
    for i, (d, pc) in enumerate(V):
        if "<GUID>%s</GUID>" % guid in pc:
            _alter[0] += 1
            pc = pc.replace("<DATE>%s</DATE>" % d, "<DATE>%s</DATE>" % new_date)
            pc = re.sub(r"<ALTERID>\s*\d+</ALTERID>", "<ALTERID> %d</ALTERID>" % _alter[0], pc)
            V[i] = (new_date, pc); _resort(); return _alter[0]
def renumber_down(by):
    """what restoring a backup can look like: every change number lower than before"""
    for i, (d, pc) in enumerate(V):
        V[i] = (d, re.sub(r"<ALTERID>\s*(\d+)</ALTERID>", lambda m: "<ALTERID> %d</ALTERID>" % max(1, int(m.group(1)) - by), pc))
    _alter[0] = max(1, _alter[0] - by)
def start():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 9000), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
