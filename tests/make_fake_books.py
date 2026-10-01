"""python3 make_fake_books.py DIR - a made-up company's books, as Tally exports them, for the fake Tally (fake_tally.py)
when no real client's export is at hand: DIR/DayBook.xml and DIR/Master.xml (UTF-16, as Tally writes them).
Groups with a chain (Office Costs under Indirect Expenses, a primary group), ledgers with and without an opening
balance, and entries for March 2026 with the party's GSTIN, the place of supply, HSN/SAC and the GST rate on lines.
Nothing in it is a real client's. Used by run_cloud_groups.py."""
import os, sys

GROUPS = [  # name, parent ("" = a primary group)
    ("Current Assets", ""), ("Current Liabilities", ""), ("Sales Accounts", ""), ("Purchase Accounts", ""),
    ("Indirect Expenses", ""), ("Direct Expenses", ""), ("Capital Account", ""),
    ("Sundry Debtors", "Current Assets"), ("Bank Accounts", "Current Assets"), ("Sundry Creditors", "Current Liabilities"),
    ("Duties & Taxes", "Current Liabilities"), ("Office Costs", "Indirect Expenses"), ("Travel Costs", "Office Costs"),
]
LEDGERS = [  # name, parent, opening (Tally's sign: debit negative)
    ("ZZ Alpha Customers", "Sundry Debtors", -50000.0), ("ZZ Beta Customers", "Sundry Debtors", 0.0),
    ("ZZ Gamma Suppliers", "Sundry Creditors", 30000.0), ("ZZ Delta Suppliers", "Sundry Creditors", 0.0),
    ("ZZ Bank", "Bank Accounts", -200000.0), ("ZZ Capital", "Capital Account", 220000.0),
    ("Consultancy Income", "Sales Accounts", 0.0), ("Goods Sold", "Sales Accounts", 0.0), ("Goods Bought", "Purchase Accounts", 0.0),
    ("Office Rent", "Office Costs", 0.0), ("Cab Hire", "Travel Costs", 0.0), ("Printing", "Indirect Expenses", 0.0),
    ("Output IGST", "Duties & Taxes", 0.0), ("Output CGST", "Duties & Taxes", 0.0), ("Output SGST", "Duties & Taxes", 0.0),
    ("Input IGST", "Duties & Taxes", 0.0),
]
def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
def rate_block(r): return ("<RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> %g</GSTRATE></RATEDETAILS.LIST>" % r) if r is not None else ""
def bill(name, kind, amt, days=None):
    return ("<BILLALLOCATIONS.LIST><NAME>%s</NAME>%s<BILLTYPE>%s</BILLTYPE><AMOUNT>%.2f</AMOUNT></BILLALLOCATIONS.LIST>"
            % (esc(name), ('<BILLCREDITPERIOD JD="0" P="%d Days">%d Days</BILLCREDITPERIOD>' % (days, days)) if days else "", kind, amt))
def line(led, amt, hsn="", rate=None, bills=()):
    return ("<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE>%s%s<AMOUNT>%.2f</AMOUNT>%s</ALLLEDGERENTRIES.LIST>"
            % (esc(led), "Yes" if amt < 0 else "No", ("<GSTHSNNAME>%s</GSTHSNNAME>" % hsn) if hsn else "", rate_block(rate), amt, "".join(bills)))
CMP = "09ZZZZZ0000Z1Z5"   # the made-up company's own GSTIN (CMPGSTIN on each entry)
def voucher(n, day, vtype, party, gstin, pos, lines, alter, ref=""):
    return ('<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="zz-%d" VCHTYPE="%s" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>%s</DATE>'
            "<GUID>zz-guid-%04d</GUID><ALTERID> %d</ALTERID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>%d</VOUCHERNUMBER>%s"
            "<PARTYLEDGERNAME>%s</PARTYLEDGERNAME>%s%s<CMPGSTIN>%s</CMPGSTIN><NARRATION>made-up entry %d</NARRATION><ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>%s</VOUCHER></TALLYMESSAGE>"
            % (n, vtype, day, n, alter, vtype, n, ("<REFERENCEDATE>%s</REFERENCEDATE><REFERENCE>%s</REFERENCE>" % (day, esc(ref))) if ref else "",
               esc(party), ("<PARTYGSTIN>%s</PARTYGSTIN>" % gstin) if gstin else "", ("<PLACEOFSUPPLY>%s</PLACEOFSUPPLY>" % pos) if pos else "", CMP, n, "".join(lines)))
def entries():
    out, n = [], 0
    for d in range(1, 21):
        day = "202603%02d" % d
        n += 1   # a service sold out of state: IGST 18%, SAC 998311
        t = 10000 + 500 * d; tax = round(t * 0.18, 2)
        out.append((day, voucher(n, day, "Sales", "ZZ Alpha Customers", "27AAACZ1234A1Z5", "Maharashtra",
            [line("ZZ Alpha Customers", -(t + tax), bills=[bill("A/%d" % n, "New Ref", -(t + tax), 30)]), line("Consultancy Income", t, "998311", 18), line("Output IGST", tax)], n)))
        n += 1   # goods sold in the state: CGST + SGST at 5%, HSN 6109
        t = 4000 + 100 * d; half = round(t * 0.025, 2)
        out.append((day, voucher(n, day, "Sales", "ZZ Beta Customers", "09AAACZ5678B1Z2", "Uttar Pradesh",
            [line("ZZ Beta Customers", -(t + 2 * half)), line("Goods Sold", t, "6109", 5), line("Output CGST", half), line("Output SGST", half)], n)))
        n += 1   # an expense from a registered supplier, under a group two steps below its primary group
        t = 1500 + 10 * d; tax = round(t * 0.05, 2)
        out.append((day, voucher(n, day, "Purchase", "ZZ Gamma Suppliers", "09AAACZ9999C1Z1", "Uttar Pradesh",
            [line("Cab Hire", -t, "996601", 5), line("Input IGST", -tax), line("ZZ Gamma Suppliers", t + tax)], n, ref="GS/%d" % d)))
        if d % 10 == 0:
            n += 1   # ZZ Alpha pays the first bill of the month in part, against that bill
            out.append((day, voucher(n, day, "Receipt", "ZZ Alpha Customers", "", "", [line("ZZ Bank", -5000), line("ZZ Alpha Customers", 5000, bills=[bill("A/1", "Agst Ref", 5000)])], n)))
        if d % 5 == 0:
            n += 1   # rent paid from the bank: no GST
            out.append((day, voucher(n, day, "Payment", "ZZ Bank", "", "", [line("Office Rent", -25000), line("ZZ Bank", 25000)], n)))
    return out
def main(d):
    os.makedirs(d, exist_ok=True)
    body = "".join(v for _, v in entries())
    open(os.path.join(d, "DayBook.xml"), "w", encoding="utf-16").write(
        "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDATA>" + body + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
    m = "".join('<TALLYMESSAGE><GROUP NAME="%s"><PARENT>%s</PARENT></GROUP></TALLYMESSAGE>' % (esc(g), esc(p)) for g, p in GROUPS)
    m += "".join('<TALLYMESSAGE><LEDGER NAME="%s"><PARENT>%s</PARENT><OPENINGBALANCE>%.2f</OPENINGBALANCE></LEDGER></TALLYMESSAGE>' % (esc(n), esc(p), ob) for n, p, ob in LEDGERS)
    open(os.path.join(d, "Master.xml"), "w", encoding="utf-16").write("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>" + m + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
    return d
if __name__ == "__main__":
    print(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "fakebooks")))
