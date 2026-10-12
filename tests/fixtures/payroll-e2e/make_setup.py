"""python3 make_setup.py - the payroll test company of bridge 2.4.4 (test data only; made-up names, PANs and amounts):
setup.json, the one source of the masters and entries the e2e test and the real-Tally gate (tally-versions mode payg) make.
Educational-mode Tally keeps only the days 1, 2 and 31 of a month: each month's payroll is dated the 1st, the salary paid the
2nd, the month's TDS deposited the 2nd of the next month (March's on 31 March)."""
import json
PH = [  # name, group, PAYTYPE, PAYSTATTYPE, ITCOMPONENT, kind
    ["PE Basic", "Indirect Expenses", "Earnings for Employees", "", "Basic Salary", "earn"],
    ["PE HRA", "Indirect Expenses", "Earnings for Employees", "", "House Rent Allowance", "earn"],
    ["PE Special Allowance", "Indirect Expenses", "Earnings for Employees", "", "", "earn"],
    ["PE PF Employee", "Current Liabilities", "Employees' Statutory Deductions", "PF Account (A/c No. 1)", "", "ded"],
    ["PE Professional Tax", "Current Liabilities", "Employees' Statutory Deductions", "Professional Tax", "", "ded"],
    ["PE Income Tax", "Current Liabilities", "Employees' Statutory Deductions", "Income Tax", "", "ded"],
    ["PE PF Employer", "Indirect Expenses", "Employer's Statutory Contributions", "PF Account (A/c No. 1)", "", "employer"],
]
# name, PAN, joined, left (yyyymmdd, '' none), designation, monthly: basic, hra, special, pf, pt, tds; employer pf
EMP = [
    ["PE Asha Rao", "ABCPR1001A", "20240401", "", "Accountant", [50000, 20000, 30000, 1800, 200, 0]],
    ["PE Bimal Das", "ABCPD1002B", "20230601", "", "Manager", [100000, 40000, 60000, 1800, 200, 23500]],
    ["PE Chitra Iyer", "ABCPI1003C", "20220101", "", "Senior Accountant", [60000, 30000, 10000, 1800, 200, 5000]],
    ["PE Dev Malhotra", "ABCPM1004D", "20200401", "", "Consultant", [70000, 0, 20000, 1800, 200, 4000]],
    ["PE Esha Kapoor", "ABCPK1005E", "20260701", "", "Analyst", [40000, 16000, 24000, 1800, 200, 1500]],
    ["PE Farid Khan", "", "20250101", "20261231", "Driver", [20000, 8000, 7000, 1800, 200, 7000]],
    ["PE Gita Sharma", "ABCPS1007G", "20190401", "", "Director", [300000, 120000, 180000, 1800, 200, 165000]],
]
MONTHS = ["202604", "202605", "202606", "202607", "202608", "202609", "202610", "202611", "202612", "202701", "202702", "202703"]
def active(e, ym):
    j, l = e[2], e[3]
    return j[:6] <= ym and (not l or l[:6] >= ym)
pay = []
for m in MONTHS:
    rows = []
    for e in EMP:
        if not active(e, m): continue
        b, h, s, pf, pt, it = e[5]
        rows.append({"employee": e[0], "heads": {"PE Basic": b, "PE HRA": h, "PE Special Allowance": s, "PE PF Employee": pf, "PE Professional Tax": pt, "PE Income Tax": it}})
    pay.append({"no": "PE-PAY-" + m, "date": m + "01", "rows": rows})
nxt = lambda m: (str(int(m[:4]) + 1) + "01") if m[4:] == "12" else (m[:4] + "%02d" % (int(m[4:]) + 1))
salpay, chal = [], []
for i, p in enumerate(pay):
    m = p["date"][:6]
    net = []
    for r in p["rows"]:
        h = r["heads"]; n = h["PE Basic"] + h["PE HRA"] + h["PE Special Allowance"] - h["PE PF Employee"] - h["PE Professional Tax"] - h["PE Income Tax"]
        net.append([r["employee"], n])
    salpay.append({"no": "PE-SAL-" + m, "date": m + "02", "bank": "PE Salary Bank", "rows": net})
    tds = sum(r["heads"]["PE Income Tax"] for r in p["rows"])
    cd = (m + "31") if m == "202703" else (nxt(m) + "02")
    chal.append({"no": "PE-TDS-" + m, "date": cd, "from": m + "01", "bsr": "0510308", "challan": str(1001 + i), "challanDate": cd, "tax": tds})
# what FinCom keeps for each employee (Tally does not hold it): the regime, declarations, rent, housing loan, previous employer, address
DET = {
    "PE Asha Rao": {"regime": "new", "address": "1 Test Road, New Delhi 110001"},
    "PE Bimal Das": {"regime": "new", "address": "2 Test Road, Gurugram 122001", "d80CCD2": 60000},
    "PE Chitra Iyer": {"regime": "old", "hraMetro": "yes", "rent": 300000, "landlordPan": "AAAPL2003L", "d80C": 150000, "d80D": 25000, "d80DParents": 30000, "address": "3 Test Road, Mumbai 400001"},
    "PE Dev Malhotra": {"regime": "old", "senior": "yes", "hlInterest": 250000, "lenderPan": "AAACH1004H", "d80C": 120000, "d80TTA": 60000, "address": "4 Test Road, Pune 411001"},
    "PE Esha Kapoor": {"regime": "new", "prevSalary": 300000, "prevTds": 10000, "address": "5 Test Road, Noida 201301"},
    "PE Farid Khan": {"address": "6 Test Road, Delhi 110006"},
    "PE Gita Sharma": {"regime": "new", "address": "7 Test Road, New Delhi 110003"},
}
json.dump({"company": "PE Payroll Test Co", "fy": "2026-27", "category": "Primary Cost Category", "group": "PE Office Staff", "other": ["PE Delhi Branch"],
           "payable": "PE Salary Payable", "bank": "PE Salary Bank", "payHeads": PH, "employees": EMP, "payrolls": pay, "salaryPayments": salpay, "tdsPayments": chal,
           "details": DET}, open("setup.json", "w"), indent=1)
print(len(pay), "payrolls,", sum(len(p["rows"]) for p in pay), "employee-months")
