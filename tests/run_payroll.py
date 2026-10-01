"""python3 run_payroll.py - review of 01-Oct-2026: salary entered in Tally's payroll (a Payroll voucher, PaySlip view)
has no ledger lines; its pay heads sit in each employee's allocations. Both FinCom's own day-book reader
(Books.importDayBook) and the cloud's parser (server/tally-cloud/parse.js) take them as ledger lines: earnings debit,
deductions credit, the party ledger (Salary Payable) the net. Also the year's openings (TallyRead.yearOpen): at 1 April
income and expense ledgers open at nil and their total goes to Profit & Loss A/c. Made-up names and amounts only."""
import json, os, sys, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8149), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def payhead(n, a, i): return ("<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>%s</PAYHEADNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><PAYHEADSORTORDER> %d</PAYHEADSORTORDER><AMOUNT>%.2f</AMOUNT></PAYHEADALLOCATIONS.LIST>" % (n, "Yes" if a < 0 else "No", i, a))
def employee(name, heads):
    net = round(sum(a for _, a in heads), 2)
    return ("<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>%s</EMPLOYEENAME><EMPLOYEESORTORDER> 1</EMPLOYEESORTORDER><AMOUNT>%.2f</AMOUNT>%s</EMPLOYEEENTRIES.LIST>"
            % (name, net, "".join(payhead(n, a, i + 1) for i, (n, a) in enumerate(heads))))
EMP = [("ZZ Employee One", [("ZZ Basic", -30000), ("ZZ HRA", -15000), ("ZZ Employee PF", 1800)]),
       ("ZZ Employee Two", [("ZZ Basic", -20000), ("ZZ HRA", -10000), ("ZZ Salary Advance", 5000)])]
PAYROLL = ('<TALLYMESSAGE><VOUCHER REMOTEID="zz-pay-1" VCHTYPE="Payroll" ACTION="Create" OBJVIEW="PaySlip"><DATE>20260331</DATE><GUID>zz-pay-guid-1</GUID>'
           "<VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME><PARTYLEDGERNAME>ZZ Salary Payable</PARTYLEDGERNAME><VOUCHERNUMBER>1</VOUCHERNUMBER><PERSISTEDVIEW>PaySlip</PERSISTEDVIEW>"
           "<ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL><ASPAYSLIP>Yes</ASPAYSLIP><ALTERID> 900</ALTERID>"
           "<ATTENDANCEENTRIES.LIST>      </ATTENDANCEENTRIES.LIST><LEDGERENTRIES.LIST>      </LEDGERENTRIES.LIST>"
           "<CATEGORYENTRY.LIST><CATEGORY>Primary Cost Category</CATEGORY>" + "".join(employee(n, h) for n, h in EMP) + "</CATEGORYENTRY.LIST>"
           "<PAYROLLMODEOFPAYMENT.LIST>      </PAYROLLMODEOFPAYMENT.LIST></VOUCHER></TALLYMESSAGE>")
# an ordinary journal that names a pay-head ledger: read as before, nothing added
JOURNAL = ('<TALLYMESSAGE><VOUCHER REMOTEID="zz-jv-1" VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20260331</DATE><GUID>zz-jv-guid-1</GUID>'
           "<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>7</VOUCHERNUMBER><ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL><ALTERID> 901</ALTERID>"
           "<ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Basic</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1000.00</AMOUNT></ALLLEDGERENTRIES.LIST>"
           "<ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ Salary Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>")
DAY = "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>" + PAYROLL + JOURNAL + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
WANT = {"ZZ Basic": -50000.0, "ZZ HRA": -25000.0, "ZZ Employee PF": 1800.0, "ZZ Salary Advance": 5000.0, "ZZ Salary Payable": 68200.0}

# the cloud's parser
js = ("import {parseDay} from %s; const t = (await import('fs')).readFileSync(0, 'utf8'); process.stdout.write(JSON.stringify(parseDay(t)));"
      % json.dumps("file://" + os.path.join(HERE, "..", "server", "tally-cloud", "parse.js")))
r = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], input=DAY, capture_output=True, text=True, timeout=60).stdout)
pay = {l[1]: l[2] for l in r["lines"] if l[0] == "zz-pay-guid-1"}
ok(r["n"] == 2, "the cloud's parser keeps the payroll voucher and the journal (%d)" % r["n"])
ok(pay == WANT, "the cloud's parser: each pay head summed over the employees, Salary Payable the net (%s)" % json.dumps(pay))
ok(abs(sum(pay.values())) < 0.005, "and the payroll voucher balances")
jv = [l for l in r["lines"] if l[0] == "zz-jv-guid-1"]
ok(sorted((l[1], l[2]) for l in jv) == [("ZZ Basic", -1000.0), ("ZZ Salary Payable", 1000.0)], "an ordinary journal naming a pay head is read as before")

# an Optional payroll (Tally keeps it out of every balance): both readers mark it, and Look up's search lists it marked
# and leaves it out of its total (review of 01-Oct-2026: an Optional payroll of 30,000 showed in a total)
OPTPAY = PAYROLL.replace("zz-pay-1", "zz-pay-2").replace("zz-pay-guid-1", "zz-pay-guid-2").replace("<ISOPTIONAL>No</ISOPTIONAL>", "<ISOPTIONAL>Yes</ISOPTIONAL>").replace("<VOUCHERNUMBER>1</VOUCHERNUMBER>", "<VOUCHERNUMBER>2</VOUCHERNUMBER>")
DAY2 = "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>" + PAYROLL + OPTPAY + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
r2_ = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], input=DAY2, capture_output=True, text=True, timeout=60).stdout)
ok(sorted((v["guid"], v["opt"]) for v in r2_["vouchers"]) == [("zz-pay-guid-1", False), ("zz-pay-guid-2", True)], "the cloud's parser marks the Optional payroll as Optional")

# FinCom's own reader, and the year's openings
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page()
    pg.goto("http://localhost:8149/index.html"); pg.wait_for_function("typeof Books === 'object' && typeof TallyRead === 'object'", timeout=60000)
    res = pg.evaluate("async (x) => { const r = await Books.importDayBook(new Blob([x], {type: 'text/xml'})); return r.vouchers.map(v => ({type: v.type, ent: v.ent.map(e => [e.l, e.a])})); }", DAY)
    pv = [v for v in res if v["type"] == "Payroll"]
    got = {l: a for l, a in (pv[0]["ent"] if pv else [])}
    ok(len(res) == 2 and len(pv) == 1, "FinCom's reader keeps the payroll voucher and the journal (%d)" % len(res))
    ok(got == WANT, "FinCom's reader: the same pay-head lines (%s)" % json.dumps(got))
    jvs = [v for v in res if v["type"] == "Journal"]
    ok(jvs and sorted(map(tuple, jvs[0]["ent"])) == [("ZZ Basic", -1000.0), ("ZZ Salary Payable", 1000.0)], "and the journal as before")
    fo = pg.evaluate("""async (x) => { const r = await Books.importDayBook(new Blob([x], {type: 'text/xml'})); S.books = {vouchers: r.vouchers};
      const f = LK.find("payroll", "20260301", "20260331", ""); return {opt: r.vouchers.map(v => [v.id, !!v.opt]).sort(), n: f.rows.length, total: f.total, nopt: f.opt, marked: f.rows.filter(z => z.opt).map(z => z.no)}; }""", DAY2)
    ok(fo["opt"] == [["zz-pay-guid-1", False], ["zz-pay-guid-2", True]], "FinCom's reader marks the Optional payroll as Optional")
    ok(fo["n"] == 2 and fo["nopt"] == 1 and fo["marked"] == ["2"] and fo["total"] == 75000, "Look up's search lists both, the Optional one marked and out of the total (75,000 of one, not 150,000 of two) (%s)" % json.dumps(fo))
    yo = pg.evaluate("""() => {
      const b = {groups: {"Indirect Expenses": "", "Office Costs": "Indirect Expenses", "Sales Accounts": "", "Current Assets": "", "Bank Accounts": "Current Assets"},
                 under: {"ZZ Rent": "Office Costs", "ZZ Sales": "Sales Accounts", "ZZ Bank": "Bank Accounts"}};
      const led = {ledgers: [{name: "ZZ Rent", parent: "Office Costs", open: "-120000"}, {name: "ZZ Sales", parent: "Sales Accounts", open: "500000"},
                             {name: "ZZ Bank", parent: "Bank Accounts", open: "-80000"}, {name: "Profit & Loss A/c", parent: "", open: "-300000"}]};
      TallyRead.balances(b, led, "20250401", "20260331");
      const a = Object.fromEntries(Object.entries(b.tb.led).map(([n, x]) => [n, x.open]));
      TallyRead.balances(b, led, "20250401", "20260331"); TallyRead.yearOpen(b);           // again: the same
      const again = Object.fromEntries(Object.entries(b.tb.led).map(([n, x]) => [n, x.open]));
      const c = {groups: b.groups, under: b.under}; TallyRead.balances(c, led, "20251001", "20260331");   // not 1 April: as read
      return {a, again, mid: Object.fromEntries(Object.entries(c.tb.led).map(([n, x]) => [n, x.open])), sent: b.tb.led["ZZ Rent"].openSent};
    }""")
    ok(yo["a"] == {"ZZ Rent": 0, "ZZ Sales": 0, "ZZ Bank": -80000, "Profit & Loss A/c": 80000}, "1 April: income and expenses open at nil, their total to Profit & Loss A/c (%s)" % json.dumps(yo["a"]))
    ok(yo["again"] == yo["a"] and yo["sent"] == -120000, "done again, the same; what was read is kept (openSent %s)" % yo["sent"])
    ok(yo["mid"] == {"ZZ Rent": -120000, "ZZ Sales": 500000, "ZZ Bank": -80000, "Profit & Loss A/c": -300000}, "a book not starting on 1 April keeps its openings as read")
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
