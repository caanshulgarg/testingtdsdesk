# A made-up year of books for "Aarohi Textiles Pvt Ltd" (fictional), in TDS Desk's books format.
import json, random, datetime
R = random.Random(42)
CMP = "09AAHCA7732L1Z4"
groups = {"Capital Account":"", "Current Assets":"", "Current Liabilities":"", "Direct Expenses":"", "Direct Incomes":"", "Fixed Assets":"",
 "Indirect Expenses":"", "Indirect Incomes":"", "Loans (Liability)":"", "Purchase Accounts":"", "Sales Accounts":"",
 "Bank Accounts":"Current Assets", "Cash-in-Hand":"Current Assets", "Duties & Taxes":"Current Liabilities", "Sundry Creditors":"Current Liabilities",
 "Sundry Debtors":"Current Assets", "Unsecured Loans":"Loans (Liability)", "Provisions":"Current Liabilities", "Plant & Machinery":"Fixed Assets"}
under = {}
def L(name, grp): under[name] = grp; return name
BANK = L("HDFC Bank Current Account", "Bank Accounts"); CASH = L("Cash", "Cash-in-Hand")
SALES = L("Sales - Fabrics", "Sales Accounts"); SALES_I = L("Sales - Fabrics (Interstate)", "Sales Accounts")
PUR = L("Purchase - Yarn", "Purchase Accounts"); PUR_I = L("Purchase - Yarn (Interstate)", "Purchase Accounts")
CGO, SGO, IGO = L("Output CGST", "Duties & Taxes"), L("Output SGST", "Duties & Taxes"), L("Output IGST", "Duties & Taxes")
CGI, SGI, IGI = L("Input CGST", "Duties & Taxes"), L("Input SGST", "Duties & Taxes"), L("Input IGST", "Duties & Taxes")
TDS_C, TDS_J, TDS_I, TDS_Q = L("TDS Payable - Contractors", "Duties & Taxes"), L("TDS Payable - Professional", "Duties & Taxes"), L("TDS Payable - Rent", "Duties & Taxes"), L("TDS Payable - Purchase of Goods", "Duties & Taxes")
EXP = {"Job Work Charges": "Direct Expenses", "Freight Inward": "Direct Expenses", "Power and Fuel": "Direct Expenses", "Salary and Wages": "Indirect Expenses",
 "Rent": "Indirect Expenses", "Professional Fees": "Indirect Expenses", "Telephone and Internet": "Indirect Expenses", "Printing and Stationery": "Indirect Expenses",
 "Repairs and Maintenance": "Indirect Expenses", "Advertisement": "Indirect Expenses", "Travelling": "Indirect Expenses", "Bank Charges": "Indirect Expenses",
 "Interest on Loan": "Indirect Expenses", "Staff Welfare": "Indirect Expenses", "Depreciation": "Indirect Expenses"}
for k, g in EXP.items(): L(k, g)
SALP = L("Salary Payable", "Provisions"); LOAN = L("Term Loan - SBI", "Unsecured Loans"); CAP = L("Share Capital", "Capital Account"); MACH = L("Plant and Machinery", "Plant & Machinery")
INT_INC = L("Interest Received", "Indirect Incomes")
ST = {"09": "Uttar Pradesh", "07": "Delhi", "27": "Maharashtra", "24": "Gujarat", "08": "Rajasthan", "06": "Haryana", "33": "Tamil Nadu", "29": "Karnataka"}
cust_names = ["Raj Fabrics", "Noor Garments", "Krishna Textiles", "Meenakshi Exports", "Saanvi Fashions LLP", "Orbit Apparel Pvt Ltd", "Kalpataru Stores", "Vastra Retail Pvt Ltd",
 "Rangoli Creations", "Silverline Uniforms", "Dhruv Home Furnishings", "Ashoka Handloom", "Mehar Linen Co", "Trident Workwear", "Lotus Kids Wear", "Aarav Traders",
 "Sundar Silks", "Bluepeak Clothing", "Pooja Dress Materials", "Neelkanth Sarees", "Tulsi Textiles", "Urban Loom Pvt Ltd"]
sup_names = ["Shree Balaji Yarns", "Vardhaman Spinners", "Kaveri Office Supplies", "Vistar Logistics LLP", "Suryansh IT Services Pvt Ltd", "Meher Associates",
 "Greenline Facility Services", "Anand Dyeing Works", "Prakash Job Workers", "Jyoti Power Traders", "Omkar Packaging", "Sai Weaving Mills", "Nimbus Print Media",
 "Rathi Machinery Stores", "Dev Travel Services", "Kiran Canteen Services", "Kavya Properties", "Unity Cotton Traders"]
pans, gstins, states = {}, {}, {}
def gstin(sc, i, kind="C"):
    letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
    pan = "AA" + kind + letters[i % 23] + letters[(i * 7) % 23] + "%04d" % (1000 + i * 37 % 9000) + letters[(i * 3) % 23]
    return pan, sc + pan + "1Z" + "123456789ABCDEFG"[i % 16]
custs = []
for i, n in enumerate(cust_names):
    sc = ["09", "09", "09", "07", "27", "24", "09", "08", "06", "09", "33", "09", "29", "07", "09", "09", "33", "27", "09", "09", "09", "24"][i]
    L(n, "Sundry Debtors"); p, g = gstin(sc, i + 3, "F" if "LLP" in n else "C"); pans[n] = p; gstins[n] = g; states[n] = ST[sc]
    custs.append((n, sc, R.uniform(0.4, 2.2)))
sups = []
for i, n in enumerate(sup_names):
    sc = ["09", "08", "09", "09", "07", "09", "09", "09", "09", "09", "09", "24", "09", "27", "09", "09", "09", "24"][i]
    L(n, "Sundry Creditors"); p, g = gstin(sc, i + 41, "F" if "LLP" in n else "C"); pans[n] = p; gstins[n] = g; states[n] = ST[sc]
    sups.append((n, sc))
V = []; seq = [0]
def vid(): seq[0] += 1; return "demo-%06d" % seq[0]
def voucher(date, typ, no, party, ents, ref="", g="", pos=""):
    V.append({"id": vid(), "date": date, "type": typ, "no": no, "ref": ref or no, "refDate": date if ref else "", "irn": "", "irnDate": "", "party": party,
      "gstin": g, "pos": pos, "cmp": CMP, "narr": "", "regType": "Regular" if g else "", "country": "India", "rcm": False, "taxability": "Taxable" if g else "",
      "supply": "Goods", "ineligibleFlag": False, "hsn": [], "by": "accounts", "upd": date, "cancel": False, "opt": False, "ent": ents})
def d(y, m, day): return "%04d%02d%02d" % (y, m, day)
months = [(2025, m) for m in range(4, 13)] + [(2026, m) for m in range(1, 4)]
voucher("20250401", "Receipt", "0", CAP, [{"l": CAP, "a": 25000000}, {"l": BANK, "a": -25000000}])
voucher("20250402", "Receipt", "00", LOAN, [{"l": LOAN, "a": 15000000}, {"l": BANK, "a": -15000000}])
voucher("20250410", "Payment", "000", MACH, [{"l": MACH, "a": -12400000}, {"l": BANK, "a": 12400000}])
open_bills = {}  # party -> list [ref, amount, date]
sale_no = 0; pur_no = 0; rc_no = 0; py_no = 0; jv_no = 0
season = {4: .8, 5: .85, 6: .9, 7: 1.0, 8: 1.1, 9: 1.25, 10: 1.45, 11: 1.3, 12: 1.05, 1: .95, 2: 1.0, 3: 1.2}
for mi, (y, m) in enumerate(months):
    grow = 1 + mi * 0.025
    # sales
    for k in range(R.randint(14, 20)):
        c = R.choice(custs); n, sc, w = c
        taxable = round(R.uniform(110000, 640000) * w * season[m] * grow / 100) * 100
        day = R.randint(1, 28); sale_no += 1; no = "AT/25-26/%04d" % sale_no; dt = d(y, m, day)
        tot = round(taxable * 1.05, 2)
        if sc == "09":
            ents = [{"l": n, "a": -tot, "r": None, "b": [[no, "New Ref", -tot]]}, {"l": SALES, "a": taxable, "r": 2.5, "gr": 5, "h": "5208"},
                    {"l": CGO, "a": round(taxable * .025, 2), "r": None}, {"l": SGO, "a": round(taxable * .025, 2), "r": None}]
        else:
            ents = [{"l": n, "a": -tot, "r": None, "b": [[no, "New Ref", -tot]]}, {"l": SALES_I, "a": taxable, "r": 5, "gr": 5, "h": "5208"}, {"l": IGO, "a": round(taxable * .05, 2), "r": None}]
        voucher(dt, "Sales", no, n, ents, g=gstins[n], pos=states[n]); V[-1]["hsn"] = ["5208"]
        open_bills.setdefault(n, []).append([no, tot, dt, R.randint(28, 70) if n not in ('Lotus Kids Wear', 'Rangoli Creations') else 400])
    # yarn purchases
    for k in range(R.randint(6, 10)):
        n, sc = R.choice([s for s in sups if s[0] in ("Shree Balaji Yarns", "Vardhaman Spinners", "Sai Weaving Mills", "Unity Cotton Traders")])
        taxable = round(R.uniform(215000, 1000000) * season[m] * grow / 100) * 100; tot = round(taxable * 1.05, 2)
        day = R.randint(1, 28); pur_no += 1; ref = "%s/%d" % ("".join(x[0] for x in n.split()[:2]).upper(), 300 + pur_no); dt = d(y, m, day)
        tdsq = round(taxable * 0.001, 0) if n == "Vardhaman Spinners" else 0
        if sc == "09":
            ents = [{"l": PUR, "a": -taxable, "r": 2.5, "gr": 5}, {"l": CGI, "a": -round(taxable * .025, 2)}, {"l": SGI, "a": -round(taxable * .025, 2)}]
        else:
            ents = [{"l": PUR_I, "a": -taxable, "r": 5, "gr": 5}, {"l": IGI, "a": -round(taxable * .05, 2)}]
        if tdsq: ents.append({"l": TDS_Q, "a": tdsq})
        ents.append({"l": n, "a": round(tot - tdsq, 2), "b": [[ref, "New Ref", round(tot - tdsq, 2)]]})
        voucher(dt, "Purchase", "P%04d" % pur_no, n, ents, ref=ref, g=gstins[n], pos="Uttar Pradesh")
        open_bills.setdefault(n, []).append([ref, round(tot - tdsq, 2), dt, R.randint(20, 44)])
    # services with TDS
    for n, led, base, rate, tdsled, trate in [("Anand Dyeing Works", "Job Work Charges", 180000, 18, TDS_C, .02), ("Prakash Job Workers", "Job Work Charges", 95000, 5, TDS_C, .01),
        ("Vistar Logistics LLP", "Freight Inward", 46000, 5, TDS_C, .02), ("Kavya Properties", "Rent", 120000, 18, TDS_I, .10), ("Meher Associates", "Professional Fees", 65000, 18, TDS_J, .10),
        ("Suryansh IT Services Pvt Ltd", "Repairs and Maintenance", 28000, 18, TDS_J, .02), ("Jyoti Power Traders", "Power and Fuel", 210000, 18, None, 0),
        ("Kaveri Office Supplies", "Printing and Stationery", 14000, 18, None, 0), ("Kiran Canteen Services", "Staff Welfare", 38000, 5, TDS_C, .01), ("Nimbus Print Media", "Advertisement", 55000, 18, TDS_C, .02)]:
        if n == "Nimbus Print Media" and m not in (9, 10, 11, 3): continue
        sc = [s[1] for s in sups if s[0] == n][0]
        taxable = round(base * R.uniform(.85, 1.2) * (season[m] if led in ("Job Work Charges", "Freight Inward", "Power and Fuel") else 1) / 100) * 100
        if n == "Meher Associates" and m == 11: taxable = 65000  # repeated below as a duplicate bill
        gst = round(taxable * rate / 100, 2); tds = round(taxable * trate, 0) if tdsled else 0
        if n == "Nimbus Print Media" and m == 10: tds = 0  # TDS missed on this one
        day = R.randint(3, 25); pur_no += 1; ref = "%s-%d%02d" % ("".join(x[0] for x in n.split()[:2]).upper(), y % 100, m); dt = d(y, m, day)
        ents = [{"l": led, "a": -taxable, "r": rate / 2 if sc == "09" else rate, "gr": rate}]
        ents += [{"l": CGI, "a": -round(gst / 2, 2)}, {"l": SGI, "a": -round(gst / 2, 2)}] if sc == "09" else [{"l": IGI, "a": -gst}]
        if tds: ents.append({"l": tdsled, "a": tds})
        net = round(taxable + gst - tds, 2); ents.append({"l": n, "a": net, "b": [[ref, "New Ref", net]]})
        voucher(dt, "Purchase", "P%04d" % pur_no, n, ents, ref=ref, g=gstins[n], pos="Uttar Pradesh")
        open_bills.setdefault(n, []).append([ref, net, dt, R.randint(20, 44) if n != 'Anand Dyeing Works' else R.randint(60, 95)])
        if n == "Meher Associates" and m == 11:   # the same bill entered twice
            pur_no += 1; voucher(d(y, m, day + 2), "Purchase", "P%04d" % pur_no, n, json.loads(json.dumps(ents)), ref=ref, g=gstins[n], pos="Uttar Pradesh")
            open_bills[n].append([ref, net, d(y, m, day + 2), 30])
    # salary
    sal = round(640000 * (1 + mi * .01)); jv_no += 1
    voucher(d(y, m, 28 if m != 2 else 27), "Journal", "JV%03d" % jv_no, SALP, [{"l": "Salary and Wages", "a": -sal}, {"l": SALP, "a": sal}])
    py_no += 1; voucher(d(y, m + 1, 5) if m < 12 else d(y + 1, 1, 5), "Payment", str(py_no), SALP, [{"l": SALP, "a": -sal}, {"l": BANK, "a": sal}])
    # small monthly items
    for led, amt in [("Telephone and Internet", 8400), ("Bank Charges", 1180), ("Travelling", 22000)]:
        py_no += 1; a = round(amt * R.uniform(.8, 1.3)); voucher(d(y, m, R.randint(10, 26)), "Payment", str(py_no), led, [{"l": led, "a": -a}, {"l": BANK, "a": a}])
    if m in (6, 9, 12, 3):
        py_no += 1; voucher(d(y, m, 20), "Payment", str(py_no), "Interest on Loan", [{"l": "Interest on Loan", "a": -186000}, {"l": BANK, "a": 186000}])
    if (y, m) == (2025, 8):
        py_no += 1; voucher(d(y, m, 14), "Payment", str(py_no), "Repairs and Maintenance", [{"l": "Repairs and Maintenance", "a": -24500}, {"l": CASH, "a": 24500}])  # cash over 10,000
    # receipts: customers pay 30-75 days later; two stay unpaid long
    for n in list(open_bills):
        if n not in [c[0] for c in custs]: continue
        for bill in list(open_bills[n]):
            no, amt, dt, lag = bill
            bd = datetime.date(int(dt[:4]), int(dt[4:6]), int(dt[6:]))
            due = bd + datetime.timedelta(days=lag)
            if due.year == y and due.month == m:
                rc_no += 1; tds = round(amt / 1.05 * 0.001, 0) if n in ("Orbit Apparel Pvt Ltd", "Vastra Retail Pvt Ltd") else 0
                voucher(due.strftime("%Y%m%d"), "Receipt", str(rc_no), n, [{"l": n, "a": amt, "b": [[no, "Agst Ref", amt]]}, {"l": BANK, "a": -round(amt, 2)}])
                open_bills[n].remove(bill)
    # payments to suppliers 30-60 days; one MSME supplier paid late
    for n in list(open_bills):
        if n not in [s[0] for s in sups]: continue
        for bill in list(open_bills[n]):
            ref, amt, dt, lag = bill
            bd = datetime.date(int(dt[:4]), int(dt[4:6]), int(dt[6:]))
            due = bd + datetime.timedelta(days=lag)
            if due.year == y and due.month == m:
                py_no += 1; voucher(due.strftime("%Y%m%d"), "Payment", str(py_no), n, [{"l": n, "a": -amt, "b": [[ref, "Agst Ref", -amt]]}, {"l": BANK, "a": amt}])
                open_bills[n].remove(bill)
# year end: depreciation
jv_no += 1; voucher("20260331", "Journal", "JV%03d" % jv_no, "Depreciation", [{"l": "Depreciation", "a": -1240000}, {"l": MACH, "a": 1240000}])
V = [v for v in V if v["date"] <= "20260331"]
V.sort(key=lambda v: (v["date"], v["id"]))
books = {"cid": "c_demo", "vouchers": V, "meta": {"company": "Aarohi Textiles Pvt Ltd", "from": "20250401", "to": "20260331", "gstins": [CMP], "bills": 1, "cc": 0},
  "pans": pans, "gstins": gstins, "under": under, "states": states, "groups": groups}
import sys, os
out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/demo/books.json"
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
json.dump(books, open(out, "w"))
print(len(V), "vouchers;", sum(1 for v in V if v["type"] == "Sales"), "sales")
