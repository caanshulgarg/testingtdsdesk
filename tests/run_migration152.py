"""python3 run_migration152.py - server/tally-cloud/migration-152-cloud-calc-2.sql (09-Nov-2026, branch next-cloud-calc2; the
owner: "it should not freeze at all, whatever the book size; calculation should happen in cloud").
On a throwaway PostgreSQL (pg_stand, port 31252 unless PG152_PORT; never a real database): the cloud copy's tables as on
staging, then 151 and 152 (152 twice). Made-up books only, written here with a fixed seed, each with a year before the
year looked at (from 1 April 2024 to 31 October 2026): one small (about 3,000 entries) and one of 40,000 entries and
10,000 ledgers. For each book the browser's own engine (src/js, assembled by build.py into a scratch test page and run
in Node by tests/run_migration152.js) runs MIS.runNow for five periods from the same entries; FinCom's ledger list
(Books.mapLedgers, with ledgers set by hand), the MSME types, the MIS settings, the accounts' line choices, the challans
and the client's Loan-given choice are kept in client_book_items and clients as the browser keeps them. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no drop, delete, truncate, alter, no table made, nothing of
     151 or before replaced); SECURITY DEFINER with a fixed search_path on every function; grants explicit (members:
     tally_mis_part; the rest service_role only); names no real database; runs twice; md5
  1. every part of MIS.runNow worked out here equals the browser's, figure by figure to the paisa, ledger by ledger and
     month by month: sales (by customer and month, other income, by state, by registration, top five, new customers),
     purchases (by supplier and month, expense heads, the months that jumped, goods), the profit and loss (every head,
     ledger, month, set-off line, the excess credit, gross / EBITDA / PBT / PAT), the period before and last year (their
     ranges, sales and profit and loss), month and year to date, received and paid, the cash flow (every line, ledger,
     month, the sections, opening, closing, difference, grouping notes), compliance (GST paid from the bank, TDS deducted
     and deposited, challans, the TDS payable rolled), MSME suppliers past the days, the control, days of sales and
     purchases (worked out as the handler does)
  2. members: another firm's member gets nothing; a part that does not exist is refused
  3. timings on the 40,000-entry book (best of three; the target: under 1 s each part)
M152_ONLY=small (or 40k) runs one book; M152_TMP keeps the browser's answers between runs."""
import os, re, sys, json, hashlib, random, subprocess, datetime, time, tempfile, math
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE); sys.path.insert(0, ROOT)
import pg_stand, csv
csv.field_size_limit(1 << 30)
M151 = os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")
M152 = os.path.join(ROOT, "server", "tally-cloud", "migration-152-cloud-calc-2.sql")
SCRATCH = os.environ.get("M152_TMP") or tempfile.mkdtemp(prefix="m152-")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"

text = open(M152).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M152), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate|alter|create\s+table|create\s+(unique\s+)?index|insert|update)\s", code), "add-only: nothing dropped, deleted, truncated, altered, inserted or updated; no table or index made")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
old = set()
for d in ("server/tally-cloud", "server/security", "server/mis-run", "server/books-sync", "server/console"):
    if not os.path.isdir(os.path.join(ROOT, d)): continue
    for f in os.listdir(os.path.join(ROOT, d)):
        if f.endswith(".sql") and "152" not in f: old |= set(re.findall(r"create or replace function public\.(\w+)\(", open(os.path.join(ROOT, d, f)).read().lower()))
ok(not (set(made) & old), "no existing function replaced (%s)" % sorted(set(made) & old))
heads = {m.group(1): m.group(2) for m in re.finditer(r"create or replace function public\.(\w+)\((.*?)\$function\$", text, re.S)}
ok(sorted(heads) == made and all(re.search(r"security definer set search_path to 'public', 'pg_temp'( set \w+ to '[^']*')* as $", h) for h in heads.values()), "every function SECURITY DEFINER with search_path public, pg_temp (%d)" % len(heads))
MEM = {"tally_mis_part"}
for fn in made:
    sig = re.search(r"(revoke all on function public\.%s\(([^)]*)\) from public, anon(, authenticated)?;)" % fn, text)
    if fn in MEM: ok(sig is not None and not sig.group(3) and ("grant execute on function public.%s(%s) to authenticated, service_role;" % (fn, sig.group(2))) in text, "%s: members (revoked from public and anon, granted to authenticated)" % fn)
    else: ok(sig is not None and sig.group(3) and ("grant execute on function public.%s(%s) to service_role;" % (fn, sig.group(2))) in text, "%s: service_role only" % fn)

# ------------------------------------------------------------------------------------------------ the made-up books
F, F2 = "99999999-9999-9999-9999-999999999152", "88888888-8888-8888-8888-888888888152"
U, U2 = "55555555-5555-5555-5555-555555555152", "66666666-6666-6666-6666-666666666152"
GROUPS = {"Current Assets": "", "Current Liabilities": "", "Sales Accounts": "", "Purchase Accounts": "", "Indirect Expenses": "", "Direct Expenses": "", "Indirect Incomes": "", "Direct Incomes": "",
          "Capital Account": "", "Fixed Assets": "", "Loans (Liability)": "", "Investments": "", "Loans & Advances (Asset)": "", "Provisions": "",
          "Sundry Debtors": "Current Assets", "North Customers": "Sundry Debtors", "Sundry Creditors": "Current Liabilities",
          "Bank Accounts": "Current Assets", "Cash-in-Hand": "Current Assets", "Duties & Taxes": "Current Liabilities", "Unsecured Loans": "Loans (Liability)", "Secured Loans": "Loans (Liability)",
          "Bank OD A/c": "Loans (Liability)", "Salary & Wages": "Indirect Expenses", "Finance Costs": "Indirect Expenses", "Advance Income Tax": "Current Assets",
          "Staff Dues": "Current Liabilities", "Rowan Teal": "Loans (Liability)", "Partner Current Accounts": "Unsecured Loans"}
def chain(parent):
    out, p = [], parent
    while p and len(out) < 15: out.append(p); p = GROUPS.get(p, "")
    return out
def d8(d): return d.strftime("%Y%m%d")

def make_book(seed, n_v, n_cust, n_sup, n_exp, start, end):
    """ledgers {name: (parent, open_paise, master)}, vouchers [{id, date, no, type, party, pos, cmp, opt, cancel, deleted, ent: [{l, a, b}]}] in paise"""
    R = random.Random(seed)
    L = {}
    def led(n, parent, op=0, master=True): L[n] = (parent, op, master); return n
    cust = [led("Customer %05d Stores" % i, "North Customers" if i % 3 == 0 else "Sundry Debtors", -R.randrange(0, 900000) * 10 if i % 4 == 0 else 0) for i in range(n_cust)]
    sup = [led("Supplier %05d Mills" % i, "Sundry Creditors", R.randrange(0, 700000) * 10 if i % 5 == 0 else 0) for i in range(n_sup)]
    exps = [led("Expense Head %04d" % i, "Salary & Wages" if i % 7 == 0 else ("Direct Expenses" if i % 11 == 0 else "Indirect Expenses")) for i in range(n_exp)]
    bank = led("Kestrel Bank Current", "Bank Accounts", -250000000); od = led("Kestrel Bank OD", "Bank OD A/c", 120000000); cash = led("Cash", "Cash-in-Hand", -1500000)
    charges = led("Bank Charges", "Indirect Expenses")                     # FinCom's guess makes it a bank (Books.guess): cash and bank, and "bank" for TDS and GST paid
    s_loc, s_int = led("Sales Local", "Sales Accounts"), led("Sales Interstate", "Sales Accounts"); svc = led("Service Income", "Direct Incomes"); pur = led("Purchase Goods", "Purchase Accounts")
    cg, sg, ig = led("Output CGST", "Duties & Taxes"), led("Output SGST", "Duties & Taxes"), led("Input IGST", "Duties & Taxes")
    ig07, ig27 = led("07 IGST Output", "Duties & Taxes"), led("27 IGST Output", "Duties & Taxes")
    gcash = led("GST Electronic Cash", "Duties & Taxes"); gint = led("GST Late Fee", "Indirect Expenses")
    tds_c, tds_j, tds_cl = led("TDS Payable 194C", "Duties & Taxes"), led("Professional Withholding 194J", "Duties & Taxes"), led("TDS Clearing", "Current Liabilities")
    intr = led("Interest Received", "Indirect Incomes"); led("Capital", "Capital Account", 300000000); rcap = led("Rowan Teal Capital", "Capital Account", 50000000)
    dloan = led("Loan from Director", "Unsecured Loans", 50000000); tloan = led("Kestrel Term Loan", "Secured Loans", 90000000)
    rloan = led("Rowan Teal Loan", "Rowan Teal", 10000000); pcur = led("Partner Current Iris", "Partner Current Accounts", 2000000)
    equip = led("Office Equipment", "Fixed Assets", -40000000); fd = led("Fixed Deposit Kestrel", "Investments", -20000000)
    lent1, lent2 = led("Loan to Associate", "Loans & Advances (Asset)", -5000000), led("Staff Advance", "Loans & Advances (Asset)")
    salp, esi = led("Salary Payable", "Current Liabilities"), led("ESI Payable", "Staff Dues")
    advtax = led("Advance Tax", "Advance Income Tax", -3000000); ptax_e, ptax = led("Provision for Income Tax", "Indirect Expenses"), led("Provision for Taxation", "Provisions", 1000000)
    ifin = led("Interest on Term Loan", "Finance Costs"); dep, depwb = led("Depreciation", "Indirect Expenses"), led("Depreciation Written Back", "Indirect Expenses")
    frec = led("Freight Recovered", "Direct Expenses"); insr = led("Insurance Refund", "Indirect Expenses")
    petty = led("Petty Cash Float", "", 0, False)                          # entries, no master: no group; the guess makes it cash
    scrap = led("Sales Scrap", "", 0, False)                               # no master: profit and loss by its name
    misc = led("Suspense Unknown", "", 0, False)
    V, open_bills, nid = [], {}, [0]
    days = (end - start).days + 1
    for c in cust[::4]: open_bills.setdefault(c, []).append(["OB-" + c[-11:-7], L[c][1]])
    def vch(date, typ, party, ent, opt=False, cancel=False, deleted=False, pos="", cmp=""):
        nid[0] += 1
        V.append({"id": "g%07d" % nid[0], "date": date, "no": str(nid[0]), "type": typ, "party": party, "pos": pos, "cmp": cmp, "opt": opt, "cancel": cancel, "deleted": deleted, "ent": ent})
    def rday(): return start + datetime.timedelta(days=R.randrange(days))
    for i in range(n_v):
        date = rday(); k = R.random()
        if k < 0.28:
            c = R.choice(cust); tx = R.randrange(1000, 500000) * 100; tax = tx * 18 // 100 // 2 * 2; tot = tx + tax; ref = "INV%06d" % i
            cd = R.choice([0, 0, 30, 45, 90]); pos = R.choice(["07", "07", "27", "", "09"]); cmp = R.choice(["", "07AAAPZ0152Q1Z5", "27AAAPZ0152Q1ZX"])
            gl = [{"l": ig27, "a": tax}] if pos == "27" else ([{"l": ig07, "a": tax // 2}, {"l": ig27, "a": tax // 2}] if pos == "09" else [{"l": cg, "a": tax // 2}, {"l": sg, "a": tax // 2}])
            ent = [{"l": c, "a": -tot, "b": [[ref, "New Ref", -tot, cd]]}, {"l": R.choice([s_loc, s_loc, s_int, svc]), "a": tx}] + gl
            if R.random() < 0.06: ent[0]["b"] = None
            if R.random() < 0.15: ent.insert(1, {"l": s_int, "a": 0})     # a sales line of nothing
            open_bills.setdefault(c, []).append([ref, tot] if ent[0]["b"] else None)
            party = "" if R.random() < 0.05 else c
            vch(date, "Sales" if R.random() < 0.9 else "GST Local", party, ent, opt=R.random() < 0.01, cancel=R.random() < 0.01, deleted=R.random() < 0.005, pos=pos, cmp=cmp)
        elif k < 0.30:
            c = R.choice(cust); tx = R.randrange(100, 50000) * 100; tax = tx * 18 // 100 // 2 * 2
            vch(date, "Credit Note", c, [{"l": s_loc, "a": -tx}, {"l": cg, "a": -tax // 2}, {"l": sg, "a": -tax // 2}, {"l": c, "a": tx + tax}], pos="07")
        elif k < 0.46:
            c = R.choice(cust); bills = [x for x in open_bills.get(c, []) if x]
            if bills and R.random() < 0.8:
                b1 = R.choice(bills); amt = b1[1] if R.random() < 0.6 else max(100, b1[1] // R.choice([2, 3, 4]) // 100 * 100)
                al = [[b1[0], "Agst Ref", amt, 0]]
            elif R.random() < 0.5:
                amt = R.randrange(100, 300000) * 100; al = [["ADV%06d" % i, "Advance", amt, 0]]
            else:
                amt = R.randrange(100, 300000) * 100; al = [["", "On Account", amt, 0]]
            if R.random() < 0.1:                                           # one receipt for three: the cash spread over them
                c2, c3 = R.choice(cust), R.choice(cust); a2, a3 = R.randrange(1, 99999) * 7 + 1, R.randrange(1, 99999) * 3 + 2
                vch(date, "Receipt", c, [{"l": bank, "a": -(amt + a2 + a3)}, {"l": c, "a": amt, "b": al}, {"l": c2, "a": a2}, {"l": c3, "a": a3}])
            elif R.random() < 0.1:                                         # tax deducted by the customer: not cash
                td = amt // 10
                vch(date, "Receipt", c, [{"l": bank, "a": -(amt - td)}, {"l": misc, "a": -td}, {"l": c, "a": amt, "b": al}])
            else:
                vch(date, "Receipt", c, [{"l": R.choice([bank, bank, od, cash]), "a": -amt}, {"l": c, "a": amt, "b": al}], cancel=R.random() < 0.01)
        elif k < 0.58:
            s = R.choice(sup); tx = R.randrange(1000, 400000) * 100; tax = tx * 12 // 100; tot = tx + tax; ref = "B%06d" % i
            vch(date, "Purchase", s, [{"l": s, "a": tot, "b": [[ref, "New Ref", tot, R.choice([0, 60])]]}, {"l": pur, "a": -tx}, {"l": ig, "a": -tax}], opt=R.random() < 0.01)
            open_bills.setdefault(s, []).append([ref, tot])
        elif k < 0.59:
            s = R.choice(sup); tx = R.randrange(1000, 300000) * 100; tax = tx * 18 // 100; ref = "FA%06d" % i
            vch(date, "Purchase", s, [{"l": s, "a": tx + tax, "b": [[ref, "New Ref", tx + tax, 0]]}, {"l": equip, "a": -tx}, {"l": ig, "a": -tax}])
            open_bills.setdefault(s, []).append([ref, tx + tax])
        elif k < 0.62:                                                     # a contractor's bill with TDS
            s = R.choice(sup); e = R.choice(exps); tx = R.randrange(1000, 200000) * 100; td = tx // 100; ref = "C%06d" % i
            tl = R.choice([tds_c, tds_c, tds_j])
            vch(date, "Journal", s, [{"l": e, "a": -tx}, {"l": s, "a": tx - td, "b": [[ref, "New Ref", tx - td, 30]]}, {"l": tl, "a": td}])
            open_bills.setdefault(s, []).append([ref, tx - td])
        elif k < 0.70:
            s = R.choice(sup); bills = open_bills.get(s, [])
            if bills and R.random() < 0.75: b1 = R.choice(bills); amt = b1[1] if R.random() < 0.5 else max(100, b1[1] // 3 // 100 * 100); al = [[b1[0], "Agst Ref", -amt, 0]]
            else: amt = R.randrange(100, 200000) * 100; al = [["", "On Account", -amt, 0]] if R.random() < 0.6 else [["SADV%06d" % i, "Advance", -amt, 0]]
            if R.random() < 0.15:
                vch(date, "Payment", s, [{"l": s, "a": -amt, "b": al}, {"l": bank, "a": amt - amt // 3}, {"l": cash, "a": amt // 3}])
            else:
                vch(date, "Payment", s, [{"l": s, "a": -amt, "b": al}, {"l": R.choice([bank, bank, od]), "a": amt}], deleted=R.random() < 0.005)
            if R.random() < 0.03: vch(date, "Receipt", s, [{"l": bank, "a": -amt // 4 or -100}, {"l": s, "a": amt // 4 or 100}])   # money back from a supplier
        elif k < 0.83:
            e = R.choice(exps); amt = R.randrange(10, 80000) * 100
            vch(date, "Payment", "", [{"l": e, "a": -amt}, {"l": R.choice([bank, cash, petty, bank]), "a": amt}])
        elif k < 0.86:
            amt = R.randrange(10, 5000) * 100
            vch(date, "Journal", "", [{"l": charges, "a": -amt}, {"l": bank, "a": amt}] if R.random() < 0.5 else [{"l": bank, "a": -amt}, {"l": intr, "a": amt}])
        elif k < 0.88:
            amt = R.randrange(100, 100000) * 100
            vch(date, "Contra", "", [{"l": cash, "a": -amt}, {"l": bank, "a": amt}])
        elif k < 0.91:
            amt = R.randrange(100, 50000) * 100
            vch(date, "Sales", "", [{"l": petty, "a": -amt}, {"l": scrap, "a": amt}]) if R.random() < 0.5 else vch(date, "Journal", "", [{"l": misc, "a": -amt}, {"l": R.choice(exps), "a": amt}])
        else:
            # money in and out on everything else the cash flow places by group
            amt = R.randrange(100, 200000) * 100; w = R.randrange(14)
            pairs = [(rloan, 1), (pcur, -1), (lent1, -1), (lent2, -1), (fd, -1), (advtax, -1), (advtax, 1), (salp, -1), (esi, -1), (ifin, -1), (frec, 1), (insr, 1), (dloan, 1), (tloan, -1)]
            l2, sgn = pairs[w]
            vch(date, "Receipt" if sgn > 0 else "Payment", "", [{"l": R.choice([bank, bank, cash]), "a": -amt * sgn}, {"l": l2, "a": amt * sgn}], opt=R.random() < 0.01)
            if l2 == insr and R.random() < 0.3: vch(date, "Payment", "", [{"l": insr, "a": -amt // 5 or -100}, {"l": bank, "a": amt // 5 or 100}])
    # month by month: salaries, depreciation, tax, the TDS deposited and moved, the GST paid
    m = datetime.date(start.year, start.month, 1)
    while m <= end:
        me = (datetime.date(m.year + (m.month == 12), m.month % 12 + 1, 1) - datetime.timedelta(days=1))
        sal = R.randrange(200000, 400000) * 100
        vch(me, "Journal", "", [{"l": exps[0], "a": -sal}, {"l": salp, "a": sal - sal // 20}, {"l": esi, "a": sal // 20}])
        vch(me, "Journal", "", [{"l": dep, "a": -500000}, {"l": equip, "a": 500000}])
        # written back twice a year, more than a quarter's depreciation: the head ends in credit in some periods
        if m.month in (3, 9): vch(me, "Journal", "", [{"l": equip, "a": -2600000}, {"l": depwb, "a": 2600000}])
        if m.month in (6, 9, 12, 3): vch(me, "Journal", "", [{"l": ptax_e, "a": -7500000}, {"l": ptax, "a": 7500000}])
        d7 = me + datetime.timedelta(days=7)
        if d7 <= end:
            t1 = R.randrange(1000, 90000) * 100
            vch(d7, "Payment", "", [{"l": tds_c, "a": -t1}, {"l": bank, "a": t1}])
            t2 = R.randrange(1000, 30000) * 100
            vch(d7, "Journal", "", [{"l": tds_c, "a": -t2}, {"l": tds_cl, "a": t2}])
            vch(d7, "Payment", "", [{"l": tds_cl, "a": -t2}, {"l": bank, "a": t2}])
            vch(d7, "Payment", "", [{"l": tds_j, "a": -120000}, {"l": bank, "a": 120000}])
            g1, g2, g3 = R.randrange(1000, 90000) * 100, R.randrange(1000, 90000) * 100, R.randrange(10, 900) * 100
            vch(me + datetime.timedelta(days=20) if me + datetime.timedelta(days=20) <= end else me, "Payment", "", [{"l": cg, "a": -g1}, {"l": gcash, "a": -g2}, {"l": ig, "a": -g3}, {"l": gint, "a": -500}, {"l": bank, "a": g1 + g2 + g3 + 500}])
        m = datetime.date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    for c, bl in open_bills.items():
        for x in bl:
            if x and x[0].startswith("OB-") and x[1] < 0 and R.random() < 0.7:
                amt = -x[1] // 2 // 100 * 100 or 100
                vch(start + datetime.timedelta(days=R.randrange(60)), "Receipt", c, [{"l": bank, "a": -amt}, {"l": c, "a": amt, "b": [[x[0], "Agst Ref", amt, 0]]}])
    vch(end - datetime.timedelta(days=3), "Journal", "", [{"l": misc, "a": -500}, {"l": bank, "a": 0}])
    V.sort(key=lambda v: (v["date"], v["id"]))
    return L, V

# the browser's own settings for the book, as FinCom keeps them (client_book_items / clients)
def settings(L, seed, big):
    sups = sorted(n for n, x in L.items() if x[0] == "Sundry Creditors")
    saved = {"TDS Clearing": {"kind": "tds_clearing", "byHand": True}, "GST Electronic Cash": {"kind": "", "what": "gst_setoff", "byHand": True},
             "GST Late Fee": {"kind": "", "what": "gst_interest", "byHand": True},
             "Professional Withholding 194J": {"kind": "tds_payable", "section": "194J", "payTds": False, "byHand": True}}
    led_info = {s: {"msme": "Micro"} for s in sups[::7]}
    led_info.update({s: {"msme": "Medium"} for s in sups[3::11]})
    msme = {s: "Small" for s in sups[1::9]}
    msme.update({s: "" for s in sups[::21]})                                # a Udyam type taken off on the page
    fs = {"map": {"Interest Received": "14A", "Freight Recovered": "17A", "Service Income": "13B", "Bank Charges": "16A"}, "mfg": bool(big), "kind": "co"}
    R = random.Random(seed + 7)
    challans = [{"id": "ch%04d" % i, "date": (datetime.date(2024, 4, 7) + datetime.timedelta(days=30 * i + R.randrange(5))).isoformat() if i % 9 else "07/%02d/2025" % (i % 12 + 1),
                 "tax": (R.randrange(1000, 90000) * 100) / 100 if i % 4 else "Rs. %d.50" % R.randrange(100, 9000), "deleted": i % 13 == 5} for i in range(31)]
    company = {"choices": {"flow:Loan to Associate": {"value": "loan_given", "state": "confirmed", "by": "made-up", "at": "2026-10-01T00:00:00Z"},
                           "flow:Staff Advance": {"value": "loan_given", "state": "guessed", "by": "", "at": ""}}}
    cfg = {"msmeDays": 30} if big else {}
    return saved, led_info, msme, fs, challans, company, cfg

def paise(p): return ("-" if p < 0 else "") + "%d.%02d" % divmod(abs(p), 100)

def load_book(db, B, F_, cid, L, V, start):
    rows_l, rows_v, rows_t, rows_b = [], [], [], []
    for n, (parent, op, master) in L.items():
        if master: rows_l.append("\t".join([B, F_, n, parent, paise(op), "{" + ",".join('"%s"' % g for g in chain(parent)) + "}", (chain(parent) or [""])[-1], "\\N", "\\N"]))
    tid = int(B[-6:]) * 10**7
    for v in V:
        rows_v.append("\t".join([B, F_, v["id"], v["date"].isoformat(), v["id"][1:], v["type"], v["no"], v["party"], "", "t" if v["cancel"] else "f", "t" if v["opt"] else "f", "2026-10-02 00:00:00+00" if v["deleted"] else "\\N", v["pos"], v["cmp"]]))
        for e in v["ent"]:
            tid += 1; rows_t.append("\t".join([str(tid), B, F_, v["id"], v["date"].isoformat(), e["l"], paise(e["a"])]))
            for x in (e.get("b") or []):
                tid += 1; rows_b.append("\t".join([str(tid), B, F_, v["id"], v["date"].isoformat(), e["l"], x[0], x[1], paise(x[2]), str(x[3])]))
    s = ["insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on, days_at, ledgers_at) values (%s, %s, %s, 'Made-up Heron Traders', %s, %s, now(), now());" % (q(B), q(F_), q(cid), q(start.isoformat()), q(start.isoformat())),
         "copy tally_ledgers (book_id, firm_id, name, parent, open, chain, primary_group, merged_into, deleted_at) from stdin;", "\n".join(rows_l), "\\.",
         "copy tally_groups (book_id, firm_id, name, parent) from stdin;", "\n".join("\t".join([B, F_, g, pg]) for g, pg in GROUPS.items()), "\\.",
         "copy tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, deleted_at, pos, cmp_gstin) from stdin;", "\n".join(rows_v), "\\.",
         "copy tally_lines (id, book_id, firm_id, guid, day, ledger, amount) from stdin;", "\n".join(rows_t), "\\.",
         "copy tally_bills (id, book_id, firm_id, guid, day, ledger, name, type, amount, credit_days) from stdin;", "\n".join(rows_b), "\\.",
         "analyze tally_lines, tally_vouchers, tally_bills, tally_ledgers;",
         """insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
            select l.book_id, l.firm_id, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
              from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
             where l.book_id = %s and v.deleted_at is null and not v.cancelled and not v.optional group by 1, 2, 3, 4;""" % q(B),
         "analyze;"]
    db.sql("\n".join(s) + "\n")

TODAY = datetime.date(2026, 11, 9)          # the day the books were brought in (b.tb.to; the control's day)
def browser_books(cid, L, V, start, end, led_order, st):
    """what TCloud.load reads (tally_ledgers in the cloud's order by name, tally_groups, the entries: a deleted one is gone,
    a cancelled or optional one kept, marked), and the work the browser keeps for the client"""
    saved, led_info, msme, fs, challans, company, cfg = st
    return {"cid": cid, "from": d8(start), "today": d8(TODAY),
            "ledgers": [{"name": n, "parent": L[n][0], "open": L[n][1] / 100} for n in led_order],
            "groups": [{"name": g, "parent": pg} for g, pg in GROUPS.items()],
            "work": {"ledInfo": led_info, "msme": msme, "fs": fs, "challans": challans, "misCfg": cfg},
            "vouchers": [{"id": v["id"], "date": d8(v["date"]), "no": v["no"], "type": v["type"], "party": v["party"], "pos": v["pos"], "cmp": v["cmp"].upper(), "narr": "", "opt": v["opt"], "cancel": v["cancel"],
                          "ent": [dict({"l": e["l"], "a": e["a"] / 100}, **({"b": [[x[0], x[1], x[2] / 100, x[3]] for x in e["b"]]} if e.get("b") else {})) for e in v["ent"]]}
                         for v in V if not v["deleted"]]}

def store(db, F_, cid, br_map, st):
    saved, led_info, msme, fs, challans, company, cfg = st
    rows = []
    def put(key, item, data, deleted=False): rows.append("\t".join([F_, cid, key, item, json.dumps(data).replace("\\", "\\\\"), "t" if deleted else "f"]))
    for n, x in br_map.items(): put("map", "." + n, {k: v for k, v in x.items() if k != "n"})
    for n, x in led_info.items(): put("ledInfo", "." + n, x)
    for n, x in msme.items(): put("msme", "." + n, x)
    for k, x in fs.items(): put("fs", "." + k, x)
    for k, x in cfg.items(): put("misCfg", "." + k, x)
    for c in challans: put("challans", "#" + c["id"], c)
    put("challans", "#gone01", {"id": "gone01", "date": "2025-06-07", "tax": 99999}, True)   # an item deleted in FinCom: not a challan any more
    db.sql("copy client_book_items (firm_id, client_id, key, item, data, deleted) from stdin;\n" + "\n".join(rows) + "\n\\.\n")
    db.sql("insert into clients (id, firm_id, name, data) values (%s, %s, 'Made-up Heron Traders', %s::jsonb)" % (q(cid), q(F_), q(json.dumps(company))))

P = lambda x: None if x is None else int(round(float(x) * 100))           # to paise, for an exact comparison

def run_browser(name, books, saved, company, periods):
    inp, out = os.path.join(SCRATCH, name + "-in.json"), os.path.join(SCRATCH, name + "-out.json")
    body = json.dumps({"books": books, "saved": saved, "company": company, "periods": periods})
    key = hashlib.md5((body + open(HTML).read() + open(os.path.join(HERE, "run_migration152.js")).read()).encode()).hexdigest()
    if os.path.exists(out + "." + key): return json.load(open(out + "." + key))      # the same books and engine as a run before (M152_TMP kept)
    open(inp, "w").write(body)
    env = dict(os.environ, TDSDESK_HTML=HTML)
    r = subprocess.run(["flock", "/tmp/fincom-app.lock", "node", "--max-old-space-size=6144", os.path.join(HERE, "run_migration152.js"), inp, out], capture_output=True, text=True, env=env)
    if r.returncode: raise RuntimeError("the browser engine: " + (r.stderr or r.stdout)[-1500:])
    os.replace(out, out + "." + key)
    return json.load(open(out + "." + key))

# ------------------------------------------------------------------------------------------------ the comparison
def diff(w, g, path, out, unordered=()):
    """every difference between the browser's w and the SQL's g: numbers to the paisa, everything else exactly"""
    if len(out) > 8: return
    if isinstance(w, bool) or isinstance(g, bool) or w is None or g is None:
        if w != g and not (w is None and g is None): out.append((path, w, g))
    elif isinstance(w, (int, float)) and isinstance(g, (int, float)):
        if P(w) != P(g): out.append((path, w, g))
    elif isinstance(w, dict) and isinstance(g, dict):
        if set(w) != set(g): out.append((path, "keys", sorted(set(w) ^ set(g))[:6])); return
        for k in w: diff(w[k], g[k], path + "." + str(k), out, unordered)
    elif isinstance(w, list) and isinstance(g, list):
        if len(w) != len(g): out.append((path, "length", len(w), len(g))); return
        if path.split(".")[-1] in unordered:
            w, g = sorted(w, key=json.dumps), sorted(g, key=json.dumps)
        for i, (a, b) in enumerate(zip(w, g)): diff(a, b, path + "[%d]" % i, out, unordered)
    elif w != g: out.append((path, w, g))

def sql_part(db, cid, part, f, t, today, uid=U):
    r = json.loads(db.one("select tally_mis_part(%s, %s, %s, %s, %s)::text" % (q(cid), q(part), q(f), q(t), q(today) if today else "null"), uid=uid))
    return r.get("result") if "result" in r else r

def iso(d): return d[:4] + "-" + d[4:6] + "-" + d[6:]

def compare(db, label, cid, br, periods, end):
    for (f, t) in periods:
        W = br["runs"][f + "|" + t]; F_, T_ = iso(f), iso(t); tag = "%s %s-%s" % (label, f, t)
        S = {p: sql_part(db, cid, p, F_, T_, end.isoformat()) for p in ("sales", "purchases", "pl", "prev", "ly", "tops", "cash", "comp", "msme", "control")}
        def chk(what, w, g, unordered=()):
            out = []; diff(w, g, what, out, unordered)
            ok(not out, "%s %s (%s)" % (tag, what, out[:4]))
            return not out
        s = dict(S["sales"]); s.pop("masters", None)
        chk("sales", W["sales"], s, unordered=("byState",))
        print("        sales %s from %d customers (top five %s, new %s), other income %s, %d states, %d registrations" % (s["total"], len(s["rows"]), s["top5"], s["fresh"], s["other"], len(s["byState"]), len(s["byReg"])))
        p = dict(S["purchases"]); goods = p.pop("goods")
        chk("purchases", W["purchases"], p); chk("goods", W["goods"], goods)
        print("        purchases %s from %d suppliers, %d expense heads (%d jumped)" % (p["total"], len(p["rows"]), len(p["heads"]), sum(1 for h in p["heads"] if h["jumps"])))
        chk("pl", W["pl"], S["pl"])
        pl = S["pl"]
        print("        profit and loss: %s; set-off lines %d, excess credit %s; PAT %s" % (", ".join("%s %s" % (h, pl["heads"][h]["t"]) for h in pl["heads"]), sum(1 for h in pl["heads"].values() for x in h["led"] if x.get("so")),
              [x["t"] for x in pl["heads"].get("oth", {"led": []})["led"] if x.get("from")], pl["pat"]["t"]))
        for k in ("prev", "ly"):
            chk(k + "Range", W[k + "Range"], S[k]["range"]); chk(k, W[k], S[k]["cmp"])
        chk("mtd", W["mtd"], S["tops"]["mtd"]); chk("ytd", W["ytd"], S["tops"]["ytd"])
        print("        period before %s: %s; last year %s: %s; month to date %s, year to date %s" % (S["prev"]["range"], S["prev"]["cmp"] and S["prev"]["cmp"]["sales"], S["ly"]["range"], S["ly"]["cmp"] and S["ly"]["cmp"]["sales"], S["tops"]["mtd"], S["tops"]["ytd"]))
        chk("cash", W["cash"], S["cash"]["cash"]); chk("cash flow", W["flow"], S["cash"]["flow"])
        fl = S["cash"]["flow"]
        print("        received %s, paid %s; cash flow %d lines, net %s, open %s, close %s, diff %s, %d notes" % (S["cash"]["cash"]["rec"], S["cash"]["cash"]["pay"], len(fl["rows"]), fl["net"], fl["open"], fl["close"], fl["diff"], len(fl["notes"])))
        chk("comp.gst (paid)", W["comp"]["gstPay"], S["comp"]["gst"]); chk("comp.tds", W["comp"]["tds"], S["comp"]["tds"]); chk("comp.tdsRoll", W["comp"]["tdsRoll"], S["comp"]["tdsRoll"])
        c = S["comp"]
        print("        GST paid from the bank %s; TDS deducted %s, deposited %s, challans %s; TDS roll %s" % (sum(x["pay"] for x in c["gst"]), c["tdsRoll"]["ded"], c["tdsRoll"]["paid"], round(sum(x["challans"] for x in c["tds"]), 2), c["tdsRoll"]))
        gm = [{"party": m["party"], "type": m["type"], "amt": m["amt"], "bills": [{k: z[k] for k in ("ref", "date", "age", "amt", "left")} for z in m["bills"]]} for m in S["msme"]["rows"]]
        chk("msme", W["msme"], gm)
        chk("control", W["control"], S["control"]["control"])
        print("        MSME past %s days: %d suppliers %s; control %s" % (S["msme"]["days"], len(gm), round(sum(m["amt"] for m in gm), 2), S["control"]["control"] and {k: S["control"]["control"][k] for k in ("ok", "n", "amt")}))
        # days of sales and purchases, as the handler works them out (MIS.runNow's own formula)
        days = (datetime.date.fromisoformat(T_) - datetime.date.fromisoformat(F_)).days + 1
        rev = (pl["heads"].get("rev") or {"t": 0})["t"] or s["total"]
        js_round = lambda x: math.floor(x + 0.5)
        dso = js_round(W["owe"]["r"] / (rev / days)) if W["owe"]["r"] > 0 and rev > 0 else None
        dpo = js_round(W["owe"]["p"] / (p["total"] / days)) if goods and W["owe"]["p"] > 0 and p["total"] > 0 else None
        ok(dso == W["dso"] and dpo == W["dpo"], "%s dso %s, dpo %s from the parts here (the browser: %s, %s)" % (tag, dso, dpo, W["dso"], W["dpo"]))

def timing(db, B, periods, end):
    db.sql("""create or replace function t_ms(p text) returns numeric language plpgsql as $$ declare t timestamptz := clock_timestamp(); n bigint; begin execute p into n; return round(extract(epoch from clock_timestamp() - t) * 1000, 1); end $$;""")
    res = {}
    for (f, t) in periods:
        for part in ("sales", "purchases", "pl", "prev", "ly", "tops", "cash", "comp", "msme", "control"):
            s = "select length(tally_calc_mis(%s, %s, %s, %s, %s)::text)" % (q(B), q(part), q(iso(f)), q(iso(t)), q(end.isoformat()))
            res["%s %s-%s" % (part, f, t)] = min(float(db.one("select t_ms(%s)" % q(s))) for _ in range(3))
    return res

import build
HTML = os.path.join(SCRATCH, "index-m152.html")
open(HTML, "w").write(build.assemble())

db = pg_stand.start(int(os.environ.get("PG152_PORT") or 31252))
T_ALL = {}
try:
    db.sql("""
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
    alter table tally_ledgers add column if not exists deleted_at timestamptz;
    alter table tally_ledger_day add column if not exists merged_into text;
    alter table tally_vouchers add column if not exists deleted_at timestamptz;
    alter table tally_lines add column if not exists id bigint;
    create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text, type text, amount numeric, bill_date date, credit_days integer, due date, id bigint primary key);
    create index if not exists tally_bills_book_guid on tally_bills (book_id, guid);
    create index if not exists tally_lines_book_day on tally_lines (book_id, day);
    create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));
    create table if not exists clients (id text, firm_id uuid, name text, data jsonb default '{}', deleted boolean default false, primary key (firm_id, id));
    insert into firms values (%s, 'Made-up Firm A'), (%s, 'Made-up Firm B');
    insert into members (user_id, firm_id, name, role) values (%s, %s, 'Made-up Owner', 'owner'), (%s, %s, 'Made-up Other', 'owner');
    """ % (q(F), q(F2), q(U), q(F), q(U2), q(F2)))
    db.sql(open(M151).read())
    db.sql(text); first = db.one("select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p where p.proname in (%s)" % ",".join(q(x) for x in made))
    db.sql(text)
    ok(db.one("select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p where p.proname in (%s)" % ",".join(q(x) for x in made)) == first, "0. runs twice: the same functions")
    acl = {r["proname"]: r["acl"] for r in db.rows("select proname, proacl::text as acl from pg_proc where proname in (%s)" % ",".join(q(x) for x in made))}
    ok(all(("authenticated=X" in acl[f]) == (f in MEM) and "anon" not in acl[f] and "service_role=X" in acl[f] and not re.search(r"(^|[{,])=X", acl[f]) for f in made), "0. execute rights as declared")
    ok(db.one("select count(*) from pg_proc where proname in (%s) and (not prosecdef or not exists (select 1 from unnest(proconfig) c where c = 'search_path=public, pg_temp'))" % ",".join(q(x) for x in made)) == "0", "0. in the database: every function SECURITY DEFINER, search_path fixed")

    for label, seed, n_v, n_c, n_s, n_e, timed in (("small", 152, 3000, 60, 40, 30, False), ("40k", 40152, 40000, 4000, 3000, 2900, True)):
        if os.environ.get("M152_ONLY") and os.environ["M152_ONLY"] != label: continue      # one book only (a quick look)
        start, end = datetime.date(2024, 4, 1), datetime.date(2026, 10, 31)
        B, cid = "b1520000-0000-0000-0000-%012d" % seed, "client-%d" % seed
        t0 = time.time(); L, V = make_book(seed, n_v, n_c, n_s, n_e, start, end)
        st = settings(L, seed, label == "40k")
        load_book(db, B, F, cid, L, V, start)
        nlines = int(db.one("select count(*) from tally_lines where book_id = %s" % q(B)))
        print("== %s: %d entries (%d ledgers, %d lines) made and loaded in %.1f s" % (label, len(V), len(L), nlines, time.time() - t0))
        led_order = [r["name"] for r in db.rows("select name from tally_ledgers where book_id = %s and merged_into is null order by name" % q(B))]
        periods = [("20250401", "20260331"), ("20261001", "20261031"), ("20250815", "20251120"), (d8(start), d8(TODAY)), ("20240501", "20240630")]
        t0 = time.time()
        br = run_browser(label, browser_books(cid, L, V, start, end, led_order, st), st[0], st[5], periods)
        print("   the browser's engine in Node: %.1f s (MIS.runNow: %s ms)" % (time.time() - t0, ", ".join("%s %d" % (k, v) for k, v in br["ms"].items())))
        store(db, F, cid, br["map"], st)
        compare(db, label, cid, br, periods, TODAY)
        if timed:
            T = timing(db, B, [periods[0], periods[3]], TODAY); T_ALL = T
            for k, v in T.items(): print("   %-34s %8.1f ms" % (k, v))
            ok(all(v < 1000 for v in T.values()), "3. every part under 1 s on %d entries / %d ledgers (slowest %.0f ms: %s)" % (len(V), len(L), max(T.values()), max(T, key=T.get)))

    # 2. members
    cid = "client-152"
    r = json.loads(db.one("select tally_mis_part(%s, 'pl', '2025-04-01', '2026-03-31')::text" % q(cid), uid=U2))
    ok(r.get("none") is True and "result" not in r, "2. another firm's member: nothing (no such client in its firm)")
    r = json.loads(db.one("select tally_mis_part(%s, 'pl', '2025-04-01', '2026-03-31')::text" % q(cid)))
    ok(r.get("none") is True, "2. no member signed in: nothing")
    try:
        db.sql("select tally_mis_part(%s, 'nothing', '2025-04-01', '2026-03-31')" % q(cid), uid=U); ok(False, "2. a part that does not exist is refused")
    except RuntimeError as e: ok("no such part" in str(e), "2. a part that does not exist is refused")
except RuntimeError as e:
    ok(False, "the run: %s" % str(e)[-1500:])
finally:
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
