"""python3 make_books.py - writes Master.xml and DayBook.xml beside this file: a made-up company's books for 2025-26,
in the shape TallyPrime exports them (UTF-16 with a byte-order mark, CRLF, ENVELOPE / TALLYMESSAGE, ALLLEDGERENTRIES.LIST in
accounting vouchers and LEDGERENTRIES.LIST in invoices, BILLALLOCATIONS.LIST, ISDEEMEDPOSITIVE, debits negative, dates
YYYYMMDD). Everything in it is invented: the company, the parties, the GSTINs and PANs (valid in form, with the right
check character, and not anyone's). The figures the reports should give are worked out by hand in EXPECTED.md; change a
voucher here and EXPECTED.md must be worked out again.

The tests read these files when tests/data (a real client's export, never committed) is not there: see tests/books_data.py
and tests/harness.js."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
COMPANY = "Larkspur Fixture Events Private Limited"
CO_GUID = "5f1c0d2a-7b3e-4c9a-9e21-3d8f6a0b4c71"     # the company part of every GUID, as Tally writes it
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin(first14):
    """the GSTIN with its check character (the published mod-36 rule)"""
    s = 0
    for i, c in enumerate(first14):
        p = CHARS.index(c) * (2 if i % 2 else 1)
        s += p // 36 + p % 36
    return first14 + CHARS[(36 - s % 36) % 36]


PAN = "AAGCL4827M"
G07, G09 = gstin("07" + PAN + "1Z"), gstin("09" + PAN + "1Z")
BANK, CASH = "Tamarind Urban Bank - CA 0042", "Cash"
# a customer whose name in Tally carries a line break (Tally writes it as &#13;&#10;); read, it is "... Ltd (Noida)"
ORCHID = "Orchid Lane Hospitality Pvt Ltd&#13;&#10;(Noida)"
QUILL, BRINDLE, VELL, MARI, ZIN = "Quillfeather Weddings LLP", "Brindle Corporate Travels", "Vellichor Learning Foundation", "Marigold Expo Services", "Zinnia Retreats Pvt Ltd"
NIGHTJAR, PERE, JUNI, ASHV, KEST, SALT = "Nightjar Sound & Light Co", "Peregrine Tent Works", "Juniper Legal Associates", "Ashvattha Transport Co", "Kestrel Computers Pvt Ltd", "Saltmarsh Software Pvt Ltd"
HEMANT, NIRMALA = "Hemant Zaverchand (Loan)", "Nirmala Quereshi (Loan)"

# ---------------------------------------------------------------- groups: name, parent ("" = primary), revenue, gross profit, debit
GROUPS = [
    ("Capital Account", "", 0, 0, 0), ("Reserves & Surplus", "Capital Account", 0, 0, 0),
    ("Current Assets", "", 0, 0, 1), ("Bank Accounts", "Current Assets", 0, 0, 1), ("Cash-in-Hand", "Current Assets", 0, 0, 1),
    ("Deposits (Asset)", "Current Assets", 0, 0, 1), ("Loans & Advances (Asset)", "Current Assets", 0, 0, 1),
    ("Stock-in-Hand", "Current Assets", 0, 0, 1), ("Sundry Debtors", "Current Assets", 0, 0, 1),
    ("Current Liabilities", "", 0, 0, 0), ("Duties & Taxes", "Current Liabilities", 0, 0, 0), ("Provisions", "Current Liabilities", 0, 0, 0),
    ("Sundry Creditors", "Current Liabilities", 0, 0, 0),
    ("Fixed Assets", "", 0, 0, 1), ("Investments", "", 0, 0, 1),
    ("Loans (Liability)", "", 0, 0, 0), ("Secured Loans", "Loans (Liability)", 0, 0, 0), ("Unsecured Loans", "Loans (Liability)", 0, 0, 0),
    ("Bank OD A/c", "Loans (Liability)", 0, 0, 0),
    ("Sales Accounts", "", 1, 1, 0), ("Purchase Accounts", "", 1, 1, 1), ("Direct Incomes", "", 1, 1, 0), ("Direct Expenses", "", 1, 1, 1),
    ("Indirect Incomes", "", 1, 0, 0), ("Indirect Expenses", "", 1, 0, 1),
    ("Suspense A/c", "", 0, 0, 0), ("Misc. Expenses (ASSET)", "", 0, 0, 1), ("Branch / Divisions", "", 0, 0, 0),
    # the company's own: a primary group of expenses, and a group two steps below a primary one
    ("Employee Benefit Expenses", "", 1, 0, 1), ("Office Costs", "Indirect Expenses", 1, 0, 1),
]
RESERVED = {g[0] for g in GROUPS} - {"Employee Benefit Expenses", "Office Costs"}

# ---------------------------------------------------------------- ledgers: name, parent, opening (Tally's sign: a debit negative), details
L = []
def led(name, parent, ob=0.0, **k): L.append((name, parent, ob, k))
led("Share Capital", "Capital Account", 1000000)
led("Profit & Loss A/c", "\x04 Primary", -800000)        # the losses of earlier years, a debit
led(HEMANT, "Unsecured Loans", 200000, pan="AFRPZ6610B")
led(NIRMALA, "Unsecured Loans", 100000, pan="AKQPQ2203F")
led("Laptops and Computers", "Fixed Assets", -150000)
led("Event Software Licence", "Fixed Assets")
led(BANK, "Bank Accounts", -178700)
led(CASH, "Cash-in-Hand", -15000)
led("Security Deposit - Office Rent", "Loans & Advances (Asset)", -60000)
# customers
led(QUILL, "Sundry Debtors", -40000, state="Delhi", gst=gstin("07AAJFQ3158R1Z"), billwise=True, obills=[("QW/24-25/88", "20250210", -40000)])
led(ORCHID, "Sundry Debtors", -70000, state="Uttar Pradesh", gst=gstin("09AACCO6624H1Z"), billwise=True, regdetails=True, obills=[("OL/24-25/31", "20250305", -70000)])
led(BRINDLE, "Sundry Debtors", -25000, state="Delhi", gst=gstin("07ABNPB7712K1Z"), billwise=False)
led(VELL, "Sundry Debtors", state="Delhi", gst=gstin("07AAATV5093D1Z"), billwise=True, regdetails=True)
led(MARI, "Sundry Debtors", state="Uttar Pradesh", gst=gstin("09AAPFM2281C1Z"), billwise=True)
led(ZIN, "Sundry Debtors", state="Delhi", gst=gstin("07AABCZ8840P1Z"), billwise=True)
# suppliers
led(NIGHTJAR, "Sundry Creditors", 30000, state="Delhi", gst=gstin("07AAKFN4416E1Z"), billwise=True, msme=("UDYAM-DL-07-0031416", "Micro"), obills=[("NSL/98", "20250320", 30000)])
led(PERE, "Sundry Creditors", 7500, state="Uttar Pradesh", gst=gstin("09ACBPP3390L1Z"), billwise=True, regdetails=True, obills=[("PTW/OLD/17", "20230915", 7500)])
led(JUNI, "Sundry Creditors", state="Delhi", gst=gstin("07AAHFJ6012N1Z"), billwise=True)
led(ASHV, "Sundry Creditors", state="Delhi", pan="AGWPA1185G", regtype="Unregistered", billwise=True)
led(KEST, "Sundry Creditors", state="Haryana", gst=gstin("06AAFCK2290B1Z"), billwise=True)
led(SALT, "Sundry Creditors", state="Delhi", gst=gstin("07AAICS7751J1Z"), billwise=True)
# GST
for reg in ("07", "09"):
    for h, head in (("CGST", "Central Tax"), ("SGST", "State Tax"), ("IGST", "Integrated Tax")):
        for side in ("OUTPUT", "INPUT"):
            if reg == "09" and h == "IGST": continue
            led("%s %s %s" % (reg, h, side), "Duties & Taxes", taxtype="GST", duty=head)
led("07 RCM CGST PAYABLE", "Duties & Taxes", taxtype="GST", duty="Central Tax")
led("07 RCM SGST PAYABLE", "Duties & Taxes", taxtype="GST", duty="State Tax")
led("07 IGST INPUT PROVISIONAL", "Duties & Taxes", taxtype="GST", duty="Integrated Tax")    # never used: a ledger to confirm
# TDS
led("TDS ON CONTRACT 194C", "Duties & Taxes", 1200, taxtype="TDS", nature="Payment to Contractors")
led("TDS ON PROFESSIONAL 194J", "Duties & Taxes", taxtype="TDS", nature="Fees for Professional Services")
led("TDS ON INTEREST 194A", "Duties & Taxes", taxtype="TDS", nature="Interest other than Interest on Securities")
led("TDS Payable - Month End", "Duties & Taxes", taxtype="TDS")
# income and expenses
led("Sale of Decor Goods", "Sales Accounts")
led("Event Management Services", "Sales Accounts")
led("Interest on Bank Deposit", "Indirect Incomes")
led("Sound and Light Hire", "Direct Expenses")
led("Tent and Venue Hire", "Direct Expenses")
led("Freight Inward", "Direct Expenses")
led("Staff Salaries", "Employee Benefit Expenses")
led("Office Rent", "Office Costs")
led("Printing and Stationery", "Office Costs")
led("Legal and Professional Fees", "Indirect Expenses")
led("Travelling Expenses", "Indirect Expenses")
led("Interest on TDS", "Indirect Expenses")
led("GST Late Fee", "Indirect Expenses")
led("Sundry Balances Written Off", "Indirect Expenses")
led("Depreciation", "Indirect Expenses")
led("Interest on Unsecured Loans", "Indirect Expenses")

# ---------------------------------------------------------------- vouchers
# a line: (ledger, amount in Tally's sign: a debit negative, options); options: hsn, rate (the whole GST rate), bills
# [(name, type, amount, credit days)], cc [(centre, amount)]
V = []
def vch(date, vtype, lines, no="", party="", reg="07", ref="", narr="", rcm=False, cancel=False):
    V.append(dict(date=date, vtype=vtype, lines=lines, no=no, party=party, reg=reg, ref=ref, narr=narr, rcm=rcm, cancel=cancel))
def b(name, kind, amt, days=0): return (name, kind, amt, days)

def sale(date, no, party, lines, bills=None, reg="07", narr=""):
    total = -sum(a for _, a, _ in lines)
    vch(date, "Sales", [(party, total, {"bills": bills if bills is not None else [b(no, "New Ref", total)]})] + lines, no=no, party=party, reg=reg, narr=narr or "Invoice " + no)
def purchase(date, ref, party, lines, bills=None, reg="07", rcm=False, narr="", no=""):
    total = -sum(a for _, a, _ in lines)
    vch(date, "Purchase", lines + [(party, total, {"bills": bills if bills is not None else [b(ref, "New Ref", total)]})], no=no, party=party, reg=reg, ref=ref, rcm=rcm, narr=narr or "Bill " + ref)
def pay(date, debits, narr, credit=BANK, party=""):
    vch(date, "Payment", [(l, -a, o) for l, a, o in debits] + [(credit, sum(a for _, a, _ in debits), {})], party=party or debits[0][0], narr=narr)
def rcpt(date, credits, narr, debit=BANK, party=""):
    vch(date, "Receipt", [(debit, -sum(a for _, a, _ in credits), {})] + [(l, a, o) for l, a, o in credits], party=party or credits[0][0], narr=narr)
def jv(date, lines, narr, party=""):
    vch(date, "Journal", lines, party=party, narr=narr)

GOODS = {"hsn": "9405", "rate": 18}
EVENT = {"hsn": "998596", "rate": 18}
HIRE = {"hsn": "997329", "rate": 18}
def o(base, **k): d = dict(base); d.update(k); return d

pay("20250401", [(NIGHTJAR, 30000, {"bills": [b("NSL/98", "Agst Ref", -30000)]})], "Paid bill NSL/98 of March 2025")
pay("20250407", [("TDS ON CONTRACT 194C", 1200, {})], "TDS for March 2025, challan 00417")
sale("20250415", "LFE/25-26/001", QUILL, [("Sale of Decor Goods", 400000, o(GOODS, cc=[("Weddings", 400000)])), ("07 CGST OUTPUT", 36000, {}), ("07 SGST OUTPUT", 36000, {})],
     bills=[b("LFE/25-26/001", "New Ref", -472000, 30)])
for d in ("20250505", "20250508"):        # the same bill entered twice
    purchase(d, "NSL/112", NIGHTJAR, [("Sound and Light Hire", -100000, o(HIRE, cc=[("Weddings", -100000)])), ("07 CGST INPUT", -9000, {}), ("07 SGST INPUT", -9000, {}),
                                     ("TDS ON CONTRACT 194C", 2000, {})], bills=[b("NSL/112", "New Ref", 116000, 30)])
pay("20250512", [("Travelling Expenses", 12000, {})], "Air tickets for the Jaipur recce")
pay("20250520", [("07 CGST OUTPUT", 36000, {}), ("07 SGST OUTPUT", 36000, {})], "GST for April 2025, CPIN 25070700012345")
rcpt("20250525", [(QUILL, 472000, {"bills": [b("LFE/25-26/001", "Agst Ref", 472000)]})], "Received against LFE/25-26/001")
rcpt("20250605", [(QUILL, 40000, {"bills": [b("QW/24-25/88", "Agst Ref", 40000)]})], "Received against last year's bill QW/24-25/88")
rcpt("20250610", [(VELL, 118000, {"bills": [b("VLF/ADV/1", "Advance", 118000)]})], "Advance for the July seminar")
rcpt("20250614", [("Travelling Expenses", 3000, {})], "Refund of a cancelled air ticket&#13;&#10;(part of the tickets of 12 May)")
pay("20250615", [(NIGHTJAR, 116000, {"bills": [b("NSL/112", "Agst Ref", -116000)]})], "Paid bill NSL/112")
sale("20250618", "LFU/25-26/001", MARI, [("Event Management Services", 50000, o(EVENT, cc=[("Corporate", 50000)])), ("09 CGST OUTPUT", 4500, {}), ("09 SGST OUTPUT", 4500, {})], reg="09")
purchase("20250620", "PTW/2025/41", PERE, [("Tent and Venue Hire", -20000, HIRE), ("09 CGST INPUT", -1800, {}), ("09 SGST INPUT", -1800, {})], reg="09")
pay("20250630", [("Staff Salaries", 45000, {})], "Salaries for April to June 2025")
vch("20250701", "Sales", [], no="LFE/25-26/004", party=MARI, narr="Cancelled", cancel=True)
pay("20250705", [(PERE, 23600, {"bills": [b("PTW/2025/41", "Agst Ref", -23600)]})], "Paid bill PTW/2025/41")
purchase("20250710", "KC/1187", KEST, [("Laptops and Computers", -80000, {"hsn": "8471", "rate": 18}), ("07 IGST INPUT", -14400, {})])
sale("20250715", "LFE/25-26/006", VELL, [("Event Management Services", 200000, o(EVENT, cc=[("Corporate", 200000)])), ("07 CGST OUTPUT", 18000, {}), ("07 SGST OUTPUT", 18000, {})],
     bills=[b("VLF/ADV/1", "Agst Ref", -118000), b("LFE/25-26/006", "New Ref", -118000)])
pay("20250720", [("09 CGST OUTPUT", 2700, {}), ("09 SGST OUTPUT", 2700, {})], "GST for June 2025 (09), CPIN 25070900004321")
V[-1]["reg"] = "09"
pay("20250731", [(KEST, 94400, {"bills": [b("KC/1187", "Agst Ref", -94400)]})], "Paid bill KC/1187")
rcpt("20250805", [(ZIN, 59000, {"bills": [b("ZR/ADV/1", "Advance", 59000)]})], "Advance for the October retreat")
purchase("20250812", "SS/AUG/77", SALT, [("Event Software Licence", -120000, {"hsn": "997331", "rate": 18}), ("07 CGST INPUT", -10800, {}), ("07 SGST INPUT", -10800, {})])
pay("20250830", [(SALT, 141600, {"bills": [b("SS/AUG/77", "Agst Ref", -141600)]})], "Paid bill SS/AUG/77")
rcpt("20250903", [(ORCHID, 70800, {"bills": [b("OL/ADV/9", "Advance", 70800)]})], "Advance for the September launch")
rcpt("20250910", [(QUILL, 100000, {"bills": [b("", "On Account", 100000)]})], "Received on account")
pay("20250918", [("07 IGST INPUT", 3600, {})], "IGST on the stage truss order, paid separately")
purchase("20250920", "PTW/2025/77", PERE, [("Tent and Venue Hire", -200000, HIRE), ("07 IGST INPUT", -36000, {}), ("TDS ON CONTRACT 194C", 2000, {})])
sale("20250922", "LFE/25-26/008", ORCHID, [("Event Management Services", 120000, o(EVENT, cc=[("Corporate", 120000)])), ("07 IGST OUTPUT", 21600, {})],
     bills=[b("OL/ADV/9", "Agst Ref", -70800), b("LFE/25-26/008", "New Ref", -70800, 45)])
rcpt("20250930", [(VELL, 118000, {"bills": [b("LFE/25-26/006", "Agst Ref", 118000)]})], "Received against LFE/25-26/006")
pay("20250930", [("Staff Salaries", 45000, {})], "Salaries for July to September 2025")
sale("20251020", "LFE/25-26/010", QUILL, [("Sale of Decor Goods", 300000, o(GOODS, cc=[("Weddings", 300000)])), ("07 CGST OUTPUT", 27000, {}), ("07 SGST OUTPUT", 27000, {})],
     bills=[b("LFE/25-26/010", "New Ref", -354000, 30)])
pay("20251020", [(PERE, 234000, {"bills": [b("PTW/2025/77", "Agst Ref", -234000)]})], "Paid bill PTW/2025/77")
purchase("20251105", "JLA/311", JUNI, [("Legal and Professional Fees", -60000, {"hsn": "998211", "rate": 18}), ("07 CGST INPUT", -5400, {}), ("07 SGST INPUT", -5400, {}),
                                        ("TDS ON PROFESSIONAL 194J", 6000, {})])
rcpt("20251110", [(ORCHID, 40000, {"bills": [b("OL/24-25/31", "Agst Ref", 40000)]})], "Part of last year's bill OL/24-25/31")
sale("20251112", "LFE/25-26/011", BRINDLE, [("Event Management Services", 80000, o(EVENT, cc=[("Corporate", 80000)])), ("07 CGST OUTPUT", 7200, {}), ("07 SGST OUTPUT", 7200, {})], bills=[])
pay("20251205", [("Office Rent", 30000, {})], "Rent for December 2025")
pay("20251215", [(JUNI, 64800, {"bills": [b("JLA/311", "Agst Ref", -64800)]})], "Paid bill JLA/311")
rcpt("20251220", [(BRINDLE, 50000, {})], "Received from Brindle")
pay("20251231", [("Staff Salaries", 45000, {})], "Salaries for October to December 2025")
pay("20260105", [("Office Rent", 30000, {})], "Rent for January 2026")
sale("20260110", "LFE/25-26/013", QUILL, [("Sale of Decor Goods", 200000, o(GOODS, cc=[("Weddings", 200000)])), ("07 CGST OUTPUT", 18000, {}), ("07 SGST OUTPUT", 18000, {})],
     bills=[b("LFE/25-26/013", "New Ref", -236000, 30)])
purchase("20260115", "NSL/140", NIGHTJAR, [("Sound and Light Hire", -150000, o(HIRE, cc=[("Weddings", -100000), ("Corporate", -50000)])), ("07 CGST INPUT", -13500, {}), ("07 SGST INPUT", -13500, {}),
                                         ("TDS ON CONTRACT 194C", 3000, {})], bills=[b("NSL/140", "New Ref", 174000, 30)])
jv("20260131", [("TDS ON CONTRACT 194C", -4000, {}), ("TDS ON PROFESSIONAL 194J", -6000, {}), ("TDS Payable - Month End", 10000, {})], "TDS moved to the month-end account for payment")
pay("20260205", [("Office Rent", 30000, {})], "Rent for February 2026")
purchase("20260205", "ATC/56", ASHV, [("Freight Inward", -40000, {"hsn": "996511", "rate": 5}), ("07 CGST INPUT", -1000, {}), ("07 SGST INPUT", -1000, {}),
                                       ("07 RCM CGST PAYABLE", 1000, {}), ("07 RCM SGST PAYABLE", 1000, {})], rcm=True, narr="Freight, reverse charge (GTA)")
pay("20260207", [("TDS Payable - Month End", 10000, {}), ("Interest on TDS", 450, {})], "TDS of May and November 2025 with interest, challan 00933")
rcpt("20260215", [(QUILL, 60000, {"bills": [b("QW/ADV/2", "Advance", 60000)]})], "Advance for the April 2026 order")
purchase("20260225", "JLA/388", JUNI, [("Legal and Professional Fees", -30000, {"hsn": "998211", "rate": 18}), ("07 CGST INPUT", -2700, {}), ("07 SGST INPUT", -2700, {}),
                                        ("TDS ON PROFESSIONAL 194J", 3000, {})])
pay("20260228", [("Printing and Stationery", 2500, {})], "Printing, paid in cash", credit=CASH)
pay("20260305", [("Office Rent", 30000, {})], "Rent for March 2026")
pay("20260305", [(ASHV, 40000, {"bills": [b("ATC/56", "Agst Ref", -40000)]})], "Paid bill ATC/56")
pay("20260318", [("GST Late Fee", 200, {})], "Late fee on GSTR-1 for February 2026")
pay("20260320", [("07 RCM CGST PAYABLE", 1000, {}), ("07 RCM SGST PAYABLE", 1000, {})], "GST on reverse charge for February 2026")
sale("20260320", "LFE/25-26/015", ORCHID, [("Event Management Services", 50000, o(EVENT, cc=[("Corporate", 50000)])), ("07 IGST OUTPUT", 9000, {})],
     bills=[b("LFE/25-26/015", "New Ref", -59000, 45)])
pay("20260325", [(SALT, 25000, {"bills": [b("SS/ADV/3", "Advance", -25000)]})], "Advance for next year's licence")
rcpt("20260331", [("Interest on Bank Deposit", 4200, {})], "Interest on the sweep deposit")
pay("20260331", [("Staff Salaries", 45000, {})], "Salaries for January to March 2026")
jv("20260331", [("Interest on Unsecured Loans", -20000, {}), (HEMANT, 18000, {}), ("TDS ON INTEREST 194A", 2000, {})], "Interest on the loan for 2025-26, TDS at 10%", party=HEMANT)
jv("20260331", [("Depreciation", -60000, {}), ("Laptops and Computers", 40000, {}), ("Event Software Licence", 20000, {})], "Depreciation for the year 2025-26")
jv("20260331", [(PERE, -7500, {"bills": [b("PTW/OLD/17", "Agst Ref", -7500)]}), ("Sundry Balances Written Off", 7500, {})], "Old balance of 2023 written back", party=PERE)

# ---------------------------------------------------------------- writing
def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("&amp;#", "&#")
def amt(a): return "%.2f" % a
def rate_details(rate):
    if rate is None: return ""
    half = rate / 2
    out = "".join("       <RATEDETAILS.LIST>\r\n        <GSTRATEDUTYHEAD>%s</GSTRATEDUTYHEAD>\r\n        <GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>\r\n        <GSTRATE> %s</GSTRATE>\r\n       </RATEDETAILS.LIST>\r\n" % (h, ("%g" % r))
                  for h, r in (("CGST", half), ("SGST/UTGST", half), ("IGST", rate)))
    return out + "       <RATEDETAILS.LIST>\r\n        <GSTRATEDUTYHEAD>Cess</GSTRATEDUTYHEAD>\r\n        <GSTRATEVALUATIONTYPE>Not Applicable</GSTRATEVALUATIONTYPE>\r\n       </RATEDETAILS.LIST>\r\n"

INFO = {n: k for n, _, _, k in L}
STATE_OF_REG = {"07": "Delhi", "09": "Uttar Pradesh"}

def entry(tag, l, a, opt, party, n):
    o = ["      <%s>\r\n" % tag, "       <OLDAUDITENTRYIDS.LIST TYPE=\"Number\">\r\n        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>\r\n       </OLDAUDITENTRYIDS.LIST>\r\n",
         "       <LEDGERNAME>%s</LEDGERNAME>\r\n" % esc(l), "       <GSTCLASS/>\r\n",
         "       <ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE>\r\n" % ("Yes" if a < 0 else "No"), "       <LEDGERFROMITEM>No</LEDGERFROMITEM>\r\n",
         "       <ISPARTYLEDGER>%s</ISPARTYLEDGER>\r\n" % ("Yes" if l == party else "No")]
    if opt.get("hsn"):
        o.append("       <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>\r\n       <GSTOVRDNTYPEOFSUPPLY>%s</GSTOVRDNTYPEOFSUPPLY>\r\n       <GSTHSNNAME>%s</GSTHSNNAME>\r\n"
                 % ("Services" if opt["hsn"].startswith("99") else "Goods", opt["hsn"]))
    o.append("       <AMOUNT>%s</AMOUNT>\r\n" % amt(a))
    o.append(rate_details(opt.get("rate")))
    for name, kind, ba, days in opt.get("bills", []):
        o.append("       <BILLALLOCATIONS.LIST>\r\n")
        if name: o.append("        <NAME>%s</NAME>\r\n" % esc(name))
        if days: o.append('        <BILLCREDITPERIOD JD="%d" P="%d Days">%d Days</BILLCREDITPERIOD>\r\n' % (45700 + n, days, days))
        o.append("        <BILLTYPE>%s</BILLTYPE>\r\n        <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>\r\n        <AMOUNT>%s</AMOUNT>\r\n" % (kind, amt(ba)))
        o.append("        <INTERESTCOLLECTION.LIST>        </INTERESTCOLLECTION.LIST>\r\n       </BILLALLOCATIONS.LIST>\r\n")
    if opt.get("cc"):
        o.append("       <CATEGORYALLOCATIONS.LIST>\r\n        <CATEGORY>Primary Cost Category</CATEGORY>\r\n        <ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE>\r\n" % ("Yes" if a < 0 else "No"))
        for cname, ca in opt["cc"]:
            o.append("        <COSTCENTREALLOCATIONS.LIST>\r\n         <NAME>%s</NAME>\r\n         <AMOUNT>%s</AMOUNT>\r\n        </COSTCENTREALLOCATIONS.LIST>\r\n" % (esc(cname), amt(ca)))
        o.append("       </CATEGORYALLOCATIONS.LIST>\r\n")
    o.append("      </%s>\r\n" % tag)
    return "".join(o)

def voucher(n, v):
    guid = "%s-%08x" % (CO_GUID, 0x10 + n)
    invoice = v["vtype"] in ("Sales", "Purchase") and v["lines"]
    view = "Invoice Voucher View" if invoice else "Accounting Voucher View"
    party = v["party"]; info = INFO.get(party, {})
    cmp = G07 if v["reg"] == "07" else G09
    h = ['    <TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n',
         '     <VOUCHER REMOTEID="%s" VCHKEY="%s-0000ab12:%08x" VCHTYPE="%s" ACTION="Create" OBJVIEW="%s">\r\n' % (guid, CO_GUID, n, v["vtype"], view),
         "      <OLDAUDITENTRYIDS.LIST TYPE=\"Number\">\r\n       <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>\r\n      </OLDAUDITENTRYIDS.LIST>\r\n",
         "      <DATE>%s</DATE>\r\n" % v["date"]]
    if v["ref"]: h.append("      <REFERENCEDATE>%s</REFERENCEDATE>\r\n" % v["date"])
    h.append("      <GUID>%s</GUID>\r\n" % guid)
    if info.get("gst") or info.get("regtype"): h.append("      <GSTREGISTRATIONTYPE>%s</GSTREGISTRATIONTYPE>\r\n" % info.get("regtype", "Regular"))
    if info.get("state"): h.append("      <STATENAME>%s</STATENAME>\r\n" % info["state"])
    if v["narr"]: h.append("      <NARRATION>%s</NARRATION>\r\n" % esc(v["narr"]))
    h.append("      <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>\r\n")
    if info.get("gst") and v["vtype"] in ("Sales", "Purchase"): h.append("      <PARTYGSTIN>%s</PARTYGSTIN>\r\n" % info["gst"])
    if v["vtype"] in ("Sales", "Purchase") and info.get("state"):
        h.append("      <PLACEOFSUPPLY>%s</PLACEOFSUPPLY>\r\n" % (info["state"] if v["vtype"] == "Sales" else STATE_OF_REG[v["reg"]]))
    if party:
        h.append("      <PARTYNAME>%s</PARTYNAME>\r\n" % esc(party))
    h.append("      <VOUCHERTYPENAME>%s</VOUCHERTYPENAME>\r\n" % v["vtype"])
    if v["ref"]: h.append("      <REFERENCE>%s</REFERENCE>\r\n" % esc(v["ref"]))
    h.append("      <VOUCHERNUMBER>%s</VOUCHERNUMBER>\r\n" % esc(v["no"] or str(n)))
    if party: h.append("      <PARTYLEDGERNAME>%s</PARTYLEDGERNAME>\r\n" % esc(party))
    h.append("      <CMPGSTIN>%s</CMPGSTIN>\r\n      <CMPGSTREGISTRATIONTYPE>Regular</CMPGSTREGISTRATIONTYPE>\r\n      <CMPGSTSTATE>%s</CMPGSTSTATE>\r\n" % (cmp, STATE_OF_REG[v["reg"]]))
    if v["rcm"]: h.append("      <GSTOVRDNISREVCHARGEAPPL>&#4; Applicable</GSTOVRDNISREVCHARGEAPPL>\r\n")
    h.append("      <ENTEREDBY>accounts</ENTEREDBY>\r\n")
    h.append("      <ISINVOICE>%s</ISINVOICE>\r\n" % ("Yes" if invoice else "No"))
    h.append("      <ISCANCELLED>%s</ISCANCELLED>\r\n      <ISOPTIONAL>No</ISOPTIONAL>\r\n" % ("Yes" if v["cancel"] else "No"))
    h.append("      <ALTERID> %d</ALTERID>\r\n      <MASTERID> %d</MASTERID>\r\n" % (100 + n, n))
    tag = "LEDGERENTRIES.LIST" if invoice else "ALLLEDGERENTRIES.LIST"
    if not invoice: h.append("      <LEDGERENTRIES.LIST>      </LEDGERENTRIES.LIST>\r\n")    # Tally writes the empty list beside the full one
    h += [entry(tag, l, a, opt, party, n) for l, a, opt in v["lines"]]
    h.append("     </VOUCHER>\r\n    </TALLYMESSAGE>\r\n")
    return "".join(h)

def ledger_xml(n, name, parent, ob, k):
    guid = "%s-%08x" % (CO_GUID, 0x9000 + n)
    o = ['    <TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n', '     <LEDGER NAME="%s" RESERVEDNAME="%s">\r\n' % (esc(name), "Profit &amp; Loss A/c" if name == "Profit & Loss A/c" else "")]
    if k.get("state"):
        o.append("      <ADDRESS.LIST TYPE=\"String\">\r\n       <ADDRESS>Plot %d, made-up street</ADDRESS>\r\n      </ADDRESS.LIST>\r\n" % (10 + n))
    o.append("      <GUID>%s</GUID>\r\n" % guid)
    o.append("      <PARENT>%s</PARENT>\r\n" % ("&#4; Primary" if parent.startswith("\x04") else esc(parent)))
    if k.get("taxtype"): o.append("      <TAXTYPE>%s</TAXTYPE>\r\n" % k["taxtype"])
    if k.get("duty"): o.append("      <GSTDUTYHEAD>%s</GSTDUTYHEAD>\r\n" % k["duty"])
    if k.get("nature"): o.append("      <TDSNATUREOFPAYMENT>%s</TDSNATUREOFPAYMENT>\r\n" % k["nature"])
    pan = k.get("pan") or (k["gst"][2:12] if k.get("gst") and not k.get("regdetails") else "")
    if pan: o.append("      <INCOMETAXNUMBER>%s</INCOMETAXNUMBER>\r\n" % pan)
    if k.get("regtype"): o.append("      <GSTREGISTRATIONTYPE>%s</GSTREGISTRATIONTYPE>\r\n" % k["regtype"])
    if k.get("gst") and not k.get("regdetails"):      # an older release keeps it here; TallyPrime 4 in dated registration details
        o.append("      <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\r\n      <PARTYGSTIN>%s</PARTYGSTIN>\r\n" % k["gst"])
    if k.get("state"): o.append("      <LEDSTATENAME>%s</LEDSTATENAME>\r\n      <COUNTRYNAME>India</COUNTRYNAME>\r\n" % k["state"])
    if k.get("msme"):
        o.append("      <UDYAMREGNUMBER>%s</UDYAMREGNUMBER>\r\n      <ENTERPRISETYPE>%s</ENTERPRISETYPE>\r\n" % k["msme"])
    o.append("      <ISBILLWISEON>%s</ISBILLWISEON>\r\n" % ("Yes" if k.get("billwise") else "No"))
    o.append("      <ISCOSTCENTRESON>%s</ISCOSTCENTRESON>\r\n" % ("Yes" if parent in ("Sales Accounts", "Direct Expenses") else "No"))
    o.append("      <OPENINGBALANCE>%s</OPENINGBALANCE>\r\n" % amt(ob))
    o.append("      <LANGUAGENAME.LIST>\r\n       <NAME.LIST TYPE=\"String\">\r\n        <NAME>%s</NAME>\r\n       </NAME.LIST>\r\n       <LANGUAGEID> 1033</LANGUAGEID>\r\n      </LANGUAGENAME.LIST>\r\n" % esc(name))
    if k.get("regdetails"):
        o.append("      <LEDGSTREGDETAILS.LIST>\r\n       <APPLICABLEFROM>20170701</APPLICABLEFROM>\r\n       <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\r\n       <STATE>%s</STATE>\r\n       <PLACEOFSUPPLY>%s</PLACEOFSUPPLY>\r\n       <GSTIN>%s</GSTIN>\r\n      </LEDGSTREGDETAILS.LIST>\r\n" % (k["state"], k["state"], k["gst"]))
    for bn, bd, ba in k.get("obills", []):
        o.append("      <BILLALLOCATIONS.LIST>\r\n       <BILLDATE>%s</BILLDATE>\r\n       <NAME>%s</NAME>\r\n       <ISADVANCE>No</ISADVANCE>\r\n       <OPENINGBALANCE>%s</OPENINGBALANCE>\r\n      </BILLALLOCATIONS.LIST>\r\n" % (bd, esc(bn), amt(ba)))
    o.append("     </LEDGER>\r\n    </TALLYMESSAGE>\r\n")
    return "".join(o)

def group_xml(n, name, parent, rev, gp, dr):
    o = ['    <TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n', '     <GROUP NAME="%s" RESERVEDNAME="%s">\r\n' % (esc(name), esc(name) if name in RESERVED else ""),
         "      <GUID>%s-%08x</GUID>\r\n" % (CO_GUID, 0x8000 + n), ("      <PARENT>%s</PARENT>\r\n" % esc(parent)) if parent else "      <PARENT/>\r\n",
         "      <ISBILLWISEON>%s</ISBILLWISEON>\r\n" % ("Yes" if name in ("Sundry Debtors", "Sundry Creditors") else "No"),
         "      <ISSUBLEDGER>No</ISSUBLEDGER>\r\n      <ISREVENUE>%s</ISREVENUE>\r\n      <AFFECTSGROSSPROFIT>%s</AFFECTSGROSSPROFIT>\r\n      <ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE>\r\n" % tuple("Yes" if x else "No" for x in (rev, gp, dr)),
         "      <LANGUAGENAME.LIST>\r\n       <NAME.LIST TYPE=\"String\">\r\n        <NAME>%s</NAME>\r\n       </NAME.LIST>\r\n       <LANGUAGEID> 1033</LANGUAGEID>\r\n      </LANGUAGENAME.LIST>\r\n" % esc(name),
         "     </GROUP>\r\n    </TALLYMESSAGE>\r\n"]
    return "".join(o)

def envelope(report, body):
    return ("<ENVELOPE>\r\n <HEADER>\r\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\r\n </HEADER>\r\n <BODY>\r\n  <IMPORTDATA>\r\n   <REQUESTDESC>\r\n    <REPORTNAME>%s</REPORTNAME>\r\n"
            "    <STATICVARIABLES>\r\n     <SVCURRENTCOMPANY>%s</SVCURRENTCOMPANY>\r\n    </STATICVARIABLES>\r\n   </REQUESTDESC>\r\n   <REQUESTDATA>\r\n%s   </REQUESTDATA>\r\n  </IMPORTDATA>\r\n </BODY>\r\n</ENVELOPE>\r\n"
            % (report, esc(COMPANY), body))

def check():
    for v in V:
        s = round(sum(a for _, a, _ in v["lines"]), 2)
        assert abs(s) < 0.005, (v["date"], v["no"], s)
        for l, a, opt in v["lines"]:
            assert l in INFO, l
            if opt.get("bills"): assert abs(sum(x[2] for x in opt["bills"]) - a) < 0.005, (v["date"], l)
            if opt.get("cc"): assert abs(sum(x[1] for x in opt["cc"]) - a) < 0.005, (v["date"], l)
    assert abs(sum(ob for _, _, ob, _ in L)) < 0.005, sum(ob for _, _, ob, _ in L)

def two_b():
    """GSTR-2B for Delhi, February and March 2026, as the portal's JSON (only run_gstq.js reads them): February has
    Juniper's bill JLA/388; March has Nightjar's NSL/140 of January, filed late"""
    import json
    def doc(party, no, date, taxable, half):
        d = date[6:8] + "-" + date[4:6] + "-" + date[:4]
        return {"ctin": INFO[party]["gst"], "trdnm": party.upper(), "supfildt": "", "supprd": date[4:6] + date[:4],
                "inv": [{"inum": no, "dt": d, "val": taxable + 2 * half, "txval": taxable, "igst": 0, "cgst": half, "sgst": half, "cess": 0, "pos": "07", "rev": "N", "itcavl": "Y", "typ": "R"}]}
    for per, docs in (("022026", [doc(JUNI, "JLA/388", "20260225", 30000, 2700)]), ("032026", [doc(NIGHTJAR, "NSL/140", "20260115", 150000, 13500)])):
        j = {"chksum": "", "data": {"gstin": G07, "rtnprd": per, "version": "1.0", "gendt": "14-" + per[:2] + "-" + per[2:], "docdata": {"b2b": docs}}}
        open(os.path.join(HERE, "returns_R2B_%s_%s.json" % (G07, per)), "w").write(json.dumps(j, indent=1) + "\n")

def main():
    check()
    two_b()
    V.sort(key=lambda v: v["date"])        # stable: the order above within a day
    body = "".join(voucher(i + 1, v) for i, v in enumerate(V))
    open(os.path.join(HERE, "DayBook.xml"), "w", encoding="utf-16", newline="").write(envelope("Vouchers", body))
    m = "".join(group_xml(i, *g) for i, g in enumerate(GROUPS)) + "".join(ledger_xml(i, *x) for i, x in enumerate(L))
    open(os.path.join(HERE, "Master.xml"), "w", encoding="utf-16", newline="").write(envelope("All Masters", m))
    print("%d vouchers, %d groups, %d ledgers; company GSTINs %s, %s" % (len(V), len(GROUPS), len(L), G07, G09))

if __name__ == "__main__":
    main()
