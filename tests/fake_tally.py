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
POSTED = []          # (date, narration, number, xml) of every voucher created here
DELETED = []
REQS = {}            # how many requests of each kind this Tally was asked (the tests check nothing heavy is asked)
def _kind(body):
    for k in ("TDSDeskLedVch", "TDSDeskOneLed", "TDSDeskVchHeads", "TDSDeskBalances", "TDSDeskLedgers", "TDSDeskCompanies"):
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
        with _serial: return self._post()      # like TallyPrime: one request at a time
    def _post(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8")
        g = lambda t: (re.search("<" + t + ">([^<]*)</" + t + ">", body) or [None, ""])[1]
        REQS[_kind(body)] = REQS.get(_kind(body), 0) + 1
        if "<TALLYREQUEST>Import Data</TALLYREQUEST>" in body:
            CTRL["_imported"] = True
            import time as _t
            if CTRL["refuse"] > 0:
                CTRL["refuse"] -= 1; self.close_connection = True; return
            if CTRL["hang_before"] > 0:
                CTRL["hang_before"] -= 1; _t.sleep(CTRL["hang_sec"])
            _t.sleep(CTRL["delay"])
            with _lock:
                if 'ACTION="Delete"' in body:
                    rid = (re.search(r'REMOTEID="([^"]*)"', body) or [0, ""])[1]
                    before = len(POSTED)
                    POSTED[:] = [x for x in POSTED if "g-" + x[2] != rid]
                    DELETED.append(rid)
                    out = "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>%d</DELETED><ERRORS>%d</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>" % (before - len(POSTED), 0 if before > len(POSTED) else 1)
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
            plain = name.replace("&amp;", "&"); mv = amounts_until(asOn)
            hit = [(n, ob) for n, _, ob in L if n.replace("&amp;", "&") == plain]
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><NAME>%s</NAME><CLOSINGBALANCE>%.2f</CLOSINGBALANCE></LEDGER>' % (n, n, ob + mv.get(plain, mv.get(n, 0))) for n, ob in hit) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskVchHeads" in body:
            a, b = g("SVFROMDATE"), g("SVTODATE")
            with _lock: mine = [x for x in POSTED if a <= x[0] <= b]
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<VOUCHER><DATE>%s</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER><NARRATION>%s</NARRATION><MASTERID>%d</MASTERID><GUID>g-%s</GUID><ISOPTIONAL>No</ISOPTIONAL></VOUCHER>' % (d, num, n, 900000 + int(num), num) for d, n, num, _ in mine) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskCompanies" in body:
            out = '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="%s"><NAME>%s</NAME><STARTINGFROM>20240401</STARTINGFROM></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>' % (COMPANY.replace("&", "&amp;"), COMPANY)
        elif "<REPORTNAME>Day Book</REPORTNAME>" in body:
            a, b = g("SVFROMDATE"), g("SVTODATE")
            lo, hi = bisect.bisect_left(dates, a), bisect.bisect_right(dates, b)
            out = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>%s</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" % COMPANY + "".join(p for _, p in V[lo:hi]) + "".join('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + re.sub(r"^(<VOUCHER\b[^>]*>)", lambda m: m.group(1) + "<GUID>g-%s</GUID><MASTERID>%d</MASTERID><VOUCHERNUMBER>%s</VOUCHERNUMBER>" % (num, 900000 + int(num), num), re.sub(r"<DATE>[^<]*</DATE>", "<DATE>%s</DATE>" % d, vx, 1)) + "</TALLYMESSAGE>" for d, _, num, vx in list(POSTED) if a <= d <= b) + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
        elif "TDSDeskBalances" in body:
            asOn = g("SVTODATE"); mv = amounts_until(asOn)
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT><CLOSINGBALANCE>%.2f</CLOSINGBALANCE></LEDGER>' % (n, p, ob + mv.get(n.replace("&amp;", "&"), mv.get(n, 0))) for n, p, ob in L) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskLedgers" in body:
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT></LEDGER>' % (n, p) for n, p, _ in L[:300] + [x for x in L[300:] if "BANK ACCOUNT" in x[0]]) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        else:
            out = "<ENVELOPE><BODY><DATA></DATA></BODY></ENVELOPE>"
        data = out.encode("utf-8")
        self.send_response(200); self.send_header("Content-Type", "text/xml; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
def start():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 9000), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
