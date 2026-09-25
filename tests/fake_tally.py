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
    return bal
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8")
        g = lambda t: (re.search("<" + t + ">([^<]*)</" + t + ">", body) or [None, ""])[1]
        if "TDSDeskCompanies" in body:
            out = '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="%s"><NAME>%s</NAME><STARTINGFROM>20240401</STARTINGFROM></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>' % (COMPANY.replace("&", "&amp;"), COMPANY)
        elif "<REPORTNAME>Day Book</REPORTNAME>" in body:
            a, b = g("SVFROMDATE"), g("SVTODATE")
            lo, hi = bisect.bisect_left(dates, a), bisect.bisect_right(dates, b)
            out = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>%s</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" % COMPANY + "".join(p for _, p in V[lo:hi]) + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
        elif "TDSDeskBalances" in body:
            asOn = g("SVTODATE"); mv = amounts_until(asOn)
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT><CLOSINGBALANCE>%.2f</CLOSINGBALANCE></LEDGER>' % (n, p, ob + mv.get(n.replace("&amp;", "&"), mv.get(n, 0))) for n, p, ob in L) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        elif "TDSDeskLedgers" in body:
            out = "<ENVELOPE><BODY><DATA><COLLECTION>" + "".join('<LEDGER NAME="%s"><PARENT>%s</PARENT></LEDGER>' % (n, p) for n, p, _ in L[:300]) + "</COLLECTION></DATA></BODY></ENVELOPE>"
        else:
            out = "<ENVELOPE><BODY><DATA></DATA></BODY></ENVELOPE>"
        data = out.encode("utf-8")
        self.send_response(200); self.send_header("Content-Type", "text/xml; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
def start():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 9000), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
