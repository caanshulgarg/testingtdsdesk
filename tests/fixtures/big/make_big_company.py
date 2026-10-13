"""python3 tests/fixtures/big/make_big_company.py [--vouchers 200000] [--chunk 20000] [--fy 2025] [--out tests/out/big] [--seed 7]

A made-up company for measuring Tally (FinCom Bridge's "measure", items a-d of docs/tally-measure-sheet.txt): Tally import
XML with the masters (groups, ledgers with GSTIN/PAN and stored openings, GST and TDS duty ledgers, cost centres, a bank)
and a year of vouchers (by default 200,000, 1 April to 31 March, more in March as in real books): sales with output GST
and bill-wise New Ref, purchases with input GST against the supplier's bill, receipts and payments through the bank
against those bills (bank allocations with instrument numbers, most of them reconciled), expense journals with TDS
deducted and cost centres, and contras. Every name is invented. Accounting vouchers only (no stock items).

The files are written to tests/out/big (git ignores tests/out; never commit them):
    big-masters.xml            import first (Gateway of Tally > Import > Masters)
    big-vouchers-01.xml ...    then each of these (Import > Transactions), in order
Import into an EMPTY test company with GST and TDS switched on and cost centres maintained (F11), books from 1 April of
the year given. The steps are in docs/tally-measure-sheet.txt."""
import argparse, os, random, sys
from datetime import date, timedelta
from xml.sax.saxutils import escape

STATES = [("07", "Delhi"), ("09", "Uttar Pradesh"), ("06", "Haryana"), ("27", "Maharashtra"), ("29", "Karnataka"), ("33", "Tamil Nadu"), ("24", "Gujarat")]
HOME = ("07", "Delhi")
GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin_check(s14):
    """the GSTIN's 15th character (the standard check digit), so Tally takes the number as valid"""
    total = 0
    for i, ch in enumerate(s14):
        v = GSTIN_CHARS.index(ch) * (2 if i % 2 else 1)
        total += v // 36 + v % 36
    return GSTIN_CHARS[(36 - total % 36) % 36]


def make_pan(rnd, kind="C"):
    return "".join(rnd.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(3)) + kind + rnd.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + \
        "".join(rnd.choice("0123456789") for _ in range(4)) + rnd.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def make_gstin(rnd, state, pan):
    s14 = state + pan + "1Z"
    return s14 + gstin_check(s14)


SYL = ["Av", "an", "ri", "sh", "ka", "mo", "de", "lu", "ve", "ta", "ro", "ni", "pa", "sa", "go", "vi", "ra", "na", "ti", "ke", "so", "ma", "bu", "dh"]
TAIL = ["Traders", "Enterprises", "Industries", "Pvt Ltd", "LLP", "Exports", "Solutions", "Agencies", "Retail Pvt Ltd", "Logistics", "Foods", "Textiles"]


def invent(rnd, used):
    while True:
        n = "".join(rnd.choice(SYL) for _ in range(rnd.randint(2, 3))).capitalize() + " " + rnd.choice(TAIL)
        if n not in used:
            used.add(n)
            return n


def amt(v):
    return "%.2f" % v


def line(ledger, amount, deemed_positive, extra=""):
    """a ledger line as Tally imports it: a debit is negative with ISDEEMEDPOSITIVE Yes"""
    return ("<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><AMOUNT>%s</AMOUNT>%s</ALLLEDGERENTRIES.LIST>"
            % (escape(ledger), "Yes" if deemed_positive else "No", amt(amount), extra))


def bill(name, kind, amount, days=None):
    cp = "<BILLCREDITPERIOD>%d Days</BILLCREDITPERIOD>" % days if days else ""
    return "<BILLALLOCATIONS.LIST><NAME>%s</NAME><BILLTYPE>%s</BILLTYPE>%s<AMOUNT>%s</AMOUNT></BILLALLOCATIONS.LIST>" % (escape(name), kind, cp, amt(amount))


def cost(centre, amount):
    return ("<CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>"
            "<COSTCENTREALLOCATIONS.LIST><NAME>%s</NAME><AMOUNT>%s</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>" % (escape(centre), amt(amount)))


def bank(d, kind, number, amount, reconciled):
    ds = d.strftime("%Y%m%d")
    rd = "<BANKERSDATE>%s</BANKERSDATE>" % (d + timedelta(days=reconciled)).strftime("%Y%m%d") if reconciled is not None else ""
    return ("<BANKALLOCATIONS.LIST><DATE>%s</DATE><INSTRUMENTDATE>%s</INSTRUMENTDATE><TRANSACTIONTYPE>%s</TRANSACTIONTYPE><INSTRUMENTNUMBER>%s</INSTRUMENTNUMBER>"
            "<PAYMENTFAVOURING></PAYMENTFAVOURING>%s<AMOUNT>%s</AMOUNT></BANKALLOCATIONS.LIST>" % (ds, ds, kind, number, rd, amt(amount)))


def envelope(report, body_writer, f):
    f.write('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>%s</REPORTNAME>'
            '</REQUESTDESC><REQUESTDATA>\n' % report)
    body_writer(f)
    f.write('</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n')


def msg(x):
    return '<TALLYMESSAGE xmlns:UDF="TallyUDF">' + x + "</TALLYMESSAGE>\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--vouchers", type=int, default=200000)
    ap.add_argument("--chunk", type=int, default=20000, help="vouchers a file (Tally imports a big file slowly)")
    ap.add_argument("--fy", type=int, default=2025, help="the year from 1 April")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "out", "big"))
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    os.makedirs(a.out, exist_ok=True)
    used = set()
    customers = []
    for _ in range(600):
        st = rnd.choice(STATES)
        pan = make_pan(rnd)
        customers.append({"name": invent(rnd, used), "state": st, "gstin": make_gstin(rnd, st[0], pan), "pan": pan, "open": -round(rnd.uniform(0, 250000), 2) if rnd.random() < .4 else 0})
    suppliers = []
    for _ in range(400):
        st = rnd.choice(STATES)
        pan = make_pan(rnd)
        suppliers.append({"name": invent(rnd, used), "state": st, "gstin": make_gstin(rnd, st[0], pan), "pan": pan, "open": round(rnd.uniform(0, 180000), 2) if rnd.random() < .4 else 0})
    contractors = []
    for _ in range(80):
        pan = make_pan(rnd, rnd.choice("CPF"))
        contractors.append({"name": invent(rnd, used), "pan": pan})
    centres = ["Head Office", "Delhi Branch", "Noida Plant", "Gurugram Sales", "Mumbai Office", "Bengaluru Office", "Warehouse", "Projects"]
    expenses = [("Freight Inward", "Direct Expenses"), ("Factory Wages", "Direct Expenses"), ("Rent", "Indirect Expenses"), ("Professional Fees", "Indirect Expenses"),
                ("Repairs and Maintenance", "Indirect Expenses"), ("Advertisement", "Indirect Expenses"), ("Contract Labour", "Direct Expenses"), ("Electricity Charges", "Indirect Expenses"),
                ("Printing and Stationery", "Indirect Expenses"), ("Travelling Expenses", "Indirect Expenses")]
    BANK, CASH = "HDFC Bank 50200012345678", "Cash"
    tds_ledger = {"194C": "TDS Payable 194C", "194J": "TDS Payable 194J", "194I": "TDS Payable 194I"}

    # --- the masters
    def masters(f):
        for name, parent in [("Head Office Expenses", "Indirect Expenses")]:
            f.write(msg('<GROUP NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT>%s</PARENT></GROUP>' % (escape(name), escape(name), escape(parent))))
        for c in centres:
            f.write(msg('<COSTCENTRE NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><CATEGORY>Primary Cost Category</CATEGORY></COSTCENTRE>' % (escape(c), escape(c))))

        def ledger(name, parent, opening=0.0, extra=""):
            f.write(msg('<LEDGER NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT>%s</PARENT><OPENINGBALANCE>%s</OPENINGBALANCE>%s</LEDGER>'
                        % (escape(name), escape(name), escape(parent), amt(opening), extra)))
        ledger(BANK, "Bank Accounts", -2500000.00)
        ledger(CASH, "Cash-in-Hand", -45000.00)
        ledger("Capital Account - Partners", "Capital Account", 2545000.00 + sum(-x["open"] for x in customers) - sum(x["open"] for x in suppliers))
        for name in ["Sales - Local", "Sales - Interstate"]:
            ledger(name, "Sales Accounts", 0, "<ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><GSTAPPLICABLE>Applicable</GSTAPPLICABLE>")
        for name in ["Purchase - Local", "Purchase - Interstate"]:
            ledger(name, "Purchase Accounts", 0, "<GSTAPPLICABLE>Applicable</GSTAPPLICABLE>")
        for name, head in [("Output CGST", "Central Tax"), ("Output SGST", "State Tax"), ("Output IGST", "Integrated Tax"),
                           ("Input CGST", "Central Tax"), ("Input SGST", "State Tax"), ("Input IGST", "Integrated Tax")]:
            ledger(name, "Duties & Taxes", 0, "<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>%s</GSTDUTYHEAD>" % head)
        for sec, name in tds_ledger.items():
            ledger(name, "Duties & Taxes", 0, "<TAXTYPE>TDS</TAXTYPE><TDSDEDUCTEETYPE>Company - Resident</TDSDEDUCTEETYPE>")
        for name, parent in expenses:
            ledger(name, parent, 0, "<ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>")
        for c in customers:
            ledger(c["name"], "Sundry Debtors", c["open"], "<ISBILLWISEON>Yes</ISBILLWISEON><PARTYGSTIN>%s</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>"
                   "<LEDSTATENAME>%s</LEDSTATENAME><COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE><INCOMETAXNUMBER>%s</INCOMETAXNUMBER>" % (c["gstin"], c["state"][1], c["pan"]))
        for s in suppliers:
            ledger(s["name"], "Sundry Creditors", s["open"], "<ISBILLWISEON>Yes</ISBILLWISEON><PARTYGSTIN>%s</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>"
                   "<LEDSTATENAME>%s</LEDSTATENAME><COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE><INCOMETAXNUMBER>%s</INCOMETAXNUMBER>" % (s["gstin"], s["state"][1], s["pan"]))
        for c in contractors:
            ledger(c["name"], "Sundry Creditors", 0, "<ISBILLWISEON>Yes</ISBILLWISEON><INCOMETAXNUMBER>%s</INCOMETAXNUMBER><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE>" % c["pan"])
    with open(os.path.join(a.out, "big-masters.xml"), "w", encoding="utf-8") as f:
        envelope("All Masters", masters, f)

    # --- the vouchers: a year, more towards March
    start, end = date(a.fy, 4, 1), date(a.fy + 1, 3, 31)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    weight = [1.0 + (0.8 if d.month == 3 else 0.3 if d.month in (9, 12) else 0) - (0.5 if d.weekday() == 6 else 0) for d in days]
    open_sales = {c["name"]: [] for c in customers}
    open_purch = {s["name"]: [] for s in suppliers}
    seq = {"Sales": 0, "Purchase": 0, "Payment": 0, "Receipt": 0, "Journal": 0, "Contra": 0}
    mix = [("Sales", .38), ("Purchase", .22), ("Receipt", .15), ("Payment", .13), ("Journal", .09), ("Contra", .03)]
    kinds = [k for k, _ in mix]
    probs = [p for _, p in mix]
    total = a.vouchers
    dates = sorted(rnd.choices(days, weights=weight, k=total))
    files = []
    f = None
    for i, d in enumerate(dates):
        if i % a.chunk == 0:
            if f:
                f.write("</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n")
                f.close()
            path = os.path.join(a.out, "big-vouchers-%02d.xml" % (i // a.chunk + 1))
            files.append(path)
            f = open(path, "w", encoding="utf-8")
            f.write('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>'
                    '</REQUESTDESC><REQUESTDATA>\n')
        k = rnd.choices(kinds, weights=probs)[0]
        if k == "Receipt" and not any(open_sales.values()):
            k = "Sales"
        if k == "Payment" and not any(open_purch.values()):
            k = "Purchase"
        seq[k] += 1
        no = "%s/%02d-%02d/%06d" % (k[0], a.fy % 100, (a.fy + 1) % 100, seq[k])
        ds = d.strftime("%Y%m%d")
        lines, party, ref, narr = [], "", "", ""
        if k == "Sales":
            c = rnd.choice(customers)
            party, base = c["name"], round(rnd.uniform(1500, 450000), 2)
            local = c["state"] == HOME
            rate = rnd.choice([5, 12, 18, 18, 28])
            tax = round(base * rate / 100, 2)
            gross = round(base + tax, 2)
            centre = rnd.choice(centres)
            lines.append(line(party, -gross, True, bill(no, "New Ref", -gross, rnd.choice([15, 30, 45, 60]))))
            lines.append(line("Sales - Local" if local else "Sales - Interstate", base, False, cost(centre, base)))
            if local:
                lines += [line("Output CGST", round(tax / 2, 2), False), line("Output SGST", round(tax - round(tax / 2, 2), 2), False)]
            else:
                lines.append(line("Output IGST", tax, False))
            open_sales[party].append([no, gross])
            narr = "Being goods sold to %s, invoice %s" % (party, no)
        elif k == "Purchase":
            s = rnd.choice(suppliers)
            party, base = s["name"], round(rnd.uniform(800, 300000), 2)
            local = s["state"] == HOME
            rate = rnd.choice([5, 12, 18, 18, 28])
            tax = round(base * rate / 100, 2)
            gross = round(base + tax, 2)
            ref = "%s/%d" % ("".join(w[0] for w in party.split()[:2]).upper(), rnd.randint(1000, 99999))
            lines.append(line(party, gross, False, bill(ref, "New Ref", gross, rnd.choice([30, 45, 60]))))
            lines.append(line("Purchase - Local" if local else "Purchase - Interstate", -base, True))
            if local:
                lines += [line("Input CGST", -round(tax / 2, 2), True), line("Input SGST", -round(tax - round(tax / 2, 2), 2), True)]
            else:
                lines.append(line("Input IGST", -tax, True))
            open_purch[party].append([ref, gross])
            narr = "Being goods purchased from %s, bill %s" % (party, ref)
        elif k == "Receipt":
            party = rnd.choice([n for n, b in open_sales.items() if b])
            bno, bamt = open_sales[party].pop(0)
            rec = None if rnd.random() < .15 else rnd.randint(0, 4)
            lines.append(line(BANK, -bamt, True, bank(d, "NEFT", "UTR%010d" % rnd.randint(0, 10 ** 10 - 1), -bamt, rec)))
            lines.append(line(party, bamt, False, bill(bno, "Agst Ref", bamt)))
            narr = "Received from %s against %s" % (party, bno)
        elif k == "Payment":
            party = rnd.choice([n for n, b in open_purch.items() if b])
            bno, bamt = open_purch[party].pop(0)
            rec = None if rnd.random() < .15 else rnd.randint(0, 6)
            lines.append(line(party, -bamt, True, bill(bno, "Agst Ref", -bamt)))
            lines.append(line(BANK, bamt, False, bank(d, "Cheque", "%06d" % rnd.randint(1, 999999), bamt, rec)))
            narr = "Paid to %s against %s" % (party, bno)
        elif k == "Journal":
            c = rnd.choice(contractors)
            party = c["name"]
            sec, exp = rnd.choice([("194C", "Contract Labour"), ("194C", "Freight Inward"), ("194J", "Professional Fees"), ("194I", "Rent")])
            base = round(rnd.uniform(5000, 200000), 2)
            tds = round(base * {"194C": .02, "194J": .10, "194I": .10}[sec], 2)
            centre = rnd.choice(centres)
            ref = "INV-%d" % rnd.randint(100, 9999)
            lines.append(line(exp, -base, True, cost(centre, -base)))
            lines.append(line(party, round(base - tds, 2), False, bill(ref, "New Ref", round(base - tds, 2), 30)))
            lines.append(line(tds_ledger[sec], tds, False))
            narr = "Being %s booked for %s, TDS u/s %s deducted" % (exp.lower(), party, sec)
        else:
            v = round(rnd.uniform(5000, 100000), 2)
            lines.append(line(CASH, -v, True))
            lines.append(line(BANK, v, False, bank(d, "Cash", "", v, rnd.randint(0, 2))))
            narr = "Cash withdrawn from bank"
        head = ('<VOUCHER VCHTYPE="%s" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>%s</DATE><EFFECTIVEDATE>%s</EFFECTIVEDATE><VOUCHERTYPENAME>%s</VOUCHERTYPENAME>'
                '<VOUCHERNUMBER>%s</VOUCHERNUMBER>' % (k, ds, ds, k, no))
        if ref:
            head += "<REFERENCE>%s</REFERENCE><REFERENCEDATE>%s</REFERENCEDATE>" % (escape(ref), ds)
        if party:
            head += "<PARTYLEDGERNAME>%s</PARTYLEDGERNAME>" % escape(party)
        f.write(msg(head + "<NARRATION>%s</NARRATION>%s</VOUCHER>" % (escape(narr), "".join(lines))))
    if f:
        f.write("</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n")
        f.close()
    size = sum(os.path.getsize(p) for p in files) / 1e6
    print("Made-up company: %d vouchers %s to %s (%s) in %d file(s), %.0f MB, and big-masters.xml (%d customers, %d suppliers, %d contractors), in %s"
          % (total, start, end, ", ".join("%s %d" % (k, n) for k, n in seq.items()), len(files), size, len(customers), len(suppliers), len(contractors), os.path.abspath(a.out)))


if __name__ == "__main__":
    sys.exit(main())
