"""python3 mis_big_books.py OUTDIR - made-up books at the size of a large client, for run_mis_speed.py: the fixture
(tests/fixtures/books/make_books.py) plus 125 groups, about 4,100 ledgers and 3,500 vouchers, all invented (fixed seed)."""
import os, sys, random, importlib.util
OUTDIR = sys.argv[1]; WT = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."); os.makedirs(OUTDIR, exist_ok=True)
spec = importlib.util.spec_from_file_location("mb", os.path.join(WT, "tests", "fixtures", "books", "make_books.py"))
mb = importlib.util.module_from_spec(spec); spec.loader.exec_module(mb)
rnd = random.Random(20261109)
SYL = ["ka", "ri", "mo", "ta", "ve", "lu", "si", "no", "pa", "de", "zo", "ha", "mi", "ru", "be", "xo", "fi", "go"]
def word(): return "".join(rnd.choice(SYL) for _ in range(rnd.randint(2, 3))).capitalize()
used = set(n for n, _, _, _ in mb.L)
def uniq(s):
    while s in used: s += " " + word()
    used.add(s); return s
def grp(name, parent, rev, gp, dr): mb.GROUPS.append((name, parent, rev, gp, dr)); return name
D_G = [grp("Debtors Zone %02d" % i, "Sundry Debtors", 0, 0, 1) for i in range(40)]
C_G = [grp("Creditors Zone %02d" % i, "Sundry Creditors", 0, 0, 0) for i in range(35)]
IE_G = [grp("Overheads %02d" % i, "Indirect Expenses", 1, 0, 1) for i in range(25)]
DE_G = [grp("Site Costs %02d" % i, "Direct Expenses", 1, 1, 1) for i in range(10)]
SA_G = [grp("Sales Line %02d" % i, "Sales Accounts", 1, 1, 0) for i in range(5)]
LA_G = [grp("Advances Pool %02d" % i, "Loans & Advances (Asset)", 0, 0, 1) for i in range(5)]
II_G = [grp("Other Receipts %02d" % i, "Indirect Incomes", 1, 0, 0) for i in range(5)]
CUST, SUPP, EXP, DEXP, SALES, ADV, INC = [], [], [], [], [], [], []
ob_total = 0.0
def led(name, parent, ob=0.0, **k):
    global ob_total
    ob = round(ob, 2); ob_total += ob; mb.led(name, parent, ob, **k); return name
for i in range(1800):
    st = rnd.choice(["Delhi", "Uttar Pradesh", "Haryana"]); bw = rnd.random() < 0.8
    obills = []
    if bw and rnd.random() < 0.5:
        for j in range(rnd.randint(1, 3)): obills.append(("OB/%04d/%d" % (i, j), "2025%02d%02d" % (rnd.randint(1, 3), rnd.randint(1, 28)), -round(rnd.uniform(2000, 90000), 0)))
    ob = sum(x[2] for x in obills) if obills else (-round(rnd.uniform(0, 50000), 0) if rnd.random() < 0.3 else 0)
    CUST.append(led(uniq(word() + " " + word() + " Traders %04d" % i), rnd.choice(D_G), ob, state=st, billwise=bw, obills=obills))
for i in range(1400):
    bw = rnd.random() < 0.75; obills = []
    if bw and rnd.random() < 0.4:
        for j in range(rnd.randint(1, 2)): obills.append(("SB/%04d/%d" % (i, j), "2025%02d%02d" % (rnd.randint(1, 3), rnd.randint(1, 28)), round(rnd.uniform(2000, 60000), 0)))
    ob = sum(x[2] for x in obills) if obills else 0
    kw = dict(state="Delhi", billwise=bw, obills=obills)
    if rnd.random() < 0.1: kw["msme"] = ("UDYAM-DL-07-%07d" % i, rnd.choice(["Micro", "Small"]))
    SUPP.append(led(uniq(word() + " " + word() + " Supplies %04d" % i, ), rnd.choice(C_G), ob, **kw))
for i in range(600): EXP.append(led(uniq(word() + " Expense %03d" % i), rnd.choice(IE_G)))
for i in range(150): DEXP.append(led(uniq(word() + " Site Cost %03d" % i), rnd.choice(DE_G)))
for i in range(80): SALES.append(led(uniq(word() + " Sales %03d" % i), rnd.choice(SA_G)))
for i in range(30): INC.append(led(uniq(word() + " Income %03d" % i), rnd.choice(II_G)))
for i in range(60): ADV.append(led(uniq(word() + " Advance %03d" % i), rnd.choice(LA_G), -round(rnd.uniform(0, 20000), 0)))
# the openings balance against the capital account
mb.led("Scale Capital Reserve", "Reserves & Surplus", round(-ob_total, 2))
b, o, BANK = mb.b, mb.o, mb.BANK
open_bills = {}   # party -> list of [name, left]
def day(): return "2025%02d%02d" % (rnd.randint(4, 12), rnd.randint(1, 28)) if rnd.random() < 0.75 else "2026%02d%02d" % (rnd.randint(1, 3), rnd.randint(1, 28))
for i in range(1400):
    p = rnd.choice(CUST); no = "SC/25-26/%05d" % i; lines = []; base = 0
    for _ in range(rnd.randint(1, 3)):
        a = round(rnd.uniform(1000, 80000), 0); base += a
        lines.append((rnd.choice(SALES), a, o(mb.EVENT, cc=[("Weddings" if rnd.random() < .5 else "Corporate", a)]) if rnd.random() < 0.3 else dict(mb.EVENT)))
    h = round(base * 0.09, 2); lines += [("07 CGST OUTPUT", h, {}), ("07 SGST OUTPUT", h, {})]
    tot = round(base + 2 * h, 2)
    mb.sale(day(), no, p, lines, bills=[b(no, "New Ref", -tot, rnd.choice([0, 15, 30, 45]))])
    open_bills.setdefault(p, []).append([no, tot])
for i in range(1000):
    p = rnd.choice(SUPP); ref = "PB/%05d" % i; lines = []; base = 0
    for _ in range(rnd.randint(1, 2)):
        a = round(rnd.uniform(1000, 50000), 0); base += a
        lines.append((rnd.choice(DEXP if rnd.random() < 0.4 else EXP), -a, dict(mb.HIRE)))
    h = round(base * 0.09, 2); lines += [("07 CGST INPUT", -h, {}), ("07 SGST INPUT", -h, {})]
    tot = round(base + 2 * h, 2)
    mb.purchase(day(), ref, p, lines, bills=[b(ref, "New Ref", tot, rnd.choice([0, 30, 60]))])
    open_bills.setdefault(p, []).append([ref, tot])
custs = [p for p in CUST if p in open_bills]
for i in range(650):
    p = rnd.choice(custs); bl = open_bills[p][0]; a = round(bl[1] * rnd.choice([1, 0.5, 0.3]), 2)
    mb.rcpt(day(), [(p, a, {"bills": [b(bl[0], "Agst Ref", a)]})], "Received against " + bl[0])
supps = [p for p in SUPP if p in open_bills]
for i in range(420):
    p = rnd.choice(supps); bl = open_bills[p][0]; a = round(bl[1] * rnd.choice([1, 0.5]), 2)
    mb.pay(day(), [(p, a, {"bills": [b(bl[0], "Agst Ref", -a)]})], "Paid against " + bl[0])
for i in range(80):
    mb.pay(day(), [(rnd.choice(EXP), round(rnd.uniform(500, 20000), 0), {})], "Expense paid")
for i in range(40):
    a = round(rnd.uniform(500, 20000), 0); mb.jv(day(), [(rnd.choice(ADV), -a, {}), (rnd.choice(INC), a, {})], "Adjustment")
for i in range(30):
    a = round(rnd.uniform(500, 20000), 0); mb.rcpt(day(), [(rnd.choice(INC), a, {})], "Other income")
mb.INFO = {n: k for n, _, _, k in mb.L}
mb.HERE = OUTDIR
mb.two_b = lambda: None
mb.main()
