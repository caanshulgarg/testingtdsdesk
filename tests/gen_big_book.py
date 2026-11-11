"""python3 tests/gen_big_book.py [--entries 100000] [--seed 100] [--keep] [--no-measure]

A MADE-UP Tally book for measuring the cloud copy (step 0 of the per-entry calc plan, docs/calc-step0.md). Nothing here
is a real client: the company is "Demo Traders", every party is "Demo Customer nnnn" / "Demo Supplier nnnn", every
GSTIN and PAN is invented (GSTINs carry a valid check character so the GST code treats them as well formed).

What it does:
  1. makes the book: N entries (default 100,000) from 1-Apr-2024 to 31-Oct-2026, a realistic mix - B2B and B2C sales
     (intra-state CGST+SGST and inter-state IGST), exports under LUT, credit and debit notes, purchases with input tax,
     reverse-charge purchases (legal fees, GTA freight), expense journals with TDS deducted (194C, 194J, 194I), plain
     journals, receipts, payments and contras; a few deleted, cancelled and optional entries, as the copy keeps them.
     Written as PostgreSQL COPY files (vouchers, lines, bills, ledgers, groups, days) in a temporary folder.
  2. starts a throwaway PostgreSQL (tests/pg_stand.py: /tmp/fincom-pg-<port>, port 31900 unless BIGBOOK_PORT; never
     a real database), makes the cloud copy's tables with the columns and indexes the repo's migrations give them (the
     list below, each with the migration it comes from), then applies the repo's migration files the calc paths need,
     in order: 64 (the per-book change trigger), 151, 152, 153, 159, 162, 163; then loads the COPY files.
  3. measures (unless --no-measure): bytes per entry of each table and its indexes; gst_calc_rows (the cloud 3B's read
     of the book, migration 153) and gst_calc_version; tally_calc_mis for each part (152/163) over a year and a month;
     and two sketches of the planned sweep (a whole-book and a one-day diff against a calc_seen-like table, and a
     month's re-sum from a per-entry share table). Medians of 3 runs, each in its own session.
  4. stops the database and removes its folder and the COPY files (--keep leaves both, and prints where).
Disk: keeps at least 2.5 GB free on / (checked before loading; it stops otherwise)."""
import os, sys, json, time, random, shutil, datetime, tempfile, statistics, subprocess, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand

ap = argparse.ArgumentParser()
ap.add_argument("--entries", type=int, default=100000)
ap.add_argument("--seed", type=int, default=100)
ap.add_argument("--keep", action="store_true")
ap.add_argument("--no-measure", action="store_true")
ap.add_argument("--runs", type=int, default=3)
A = ap.parse_args()

F = "f0000000-0000-4000-8000-00000000d0e0"           # the made-up firm
B = "b0000000-0000-4000-8000-00000000d0e1"           # the made-up book
CID = "demo-traders"
COMPANY = "Demo Traders"
START, END = datetime.date(2024, 4, 1), datetime.date(2026, 10, 31)
MIN_FREE_MB = 2560

# ---------------------------------------------------------------- made-up GSTINs (valid check character)
CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def gst_check(s14):
    t = 0
    for i, c in enumerate(s14):
        p = CH.index(c) * (2 if i % 2 else 1); t += p // 36 + p % 36
    return CH[(36 - t % 36) % 36]
def fake_pan(R, kind="C"):
    L = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    return "".join(R.choice(L) for _ in range(3)) + kind + R.choice(L) + "%04d" % R.randrange(1, 9999) + R.choice(L)
def fake_gstin(R, state, kind="C"):
    s = "%02d%s1Z" % (state, fake_pan(R, kind)); return s + gst_check(s)
STATES = {27: "Maharashtra", 24: "Gujarat", 29: "Karnataka", 33: "Tamil Nadu", 7: "Delhi", 9: "Uttar Pradesh", 19: "West Bengal", 36: "Telangana", 8: "Rajasthan", 23: "Madhya Pradesh"}
HOME = 27

# ---------------------------------------------------------------- the made-up book
GROUPS = {  # Tally's own groups (a primary group has parent "")
    "Capital Account": "", "Current Assets": "", "Current Liabilities": "", "Fixed Assets": "", "Sales Accounts": "", "Purchase Accounts": "",
    "Direct Expenses": "", "Indirect Expenses": "", "Direct Incomes": "", "Indirect Incomes": "", "Loans (Liability)": "",
    "Sundry Debtors": "Current Assets", "Bank Accounts": "Current Assets", "Cash-in-Hand": "Current Assets", "Loans & Advances (Asset)": "Current Assets",
    "Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "Provisions": "Current Liabilities",
}
def chain(g):
    out = []
    while g: out.append(g); g = GROUPS.get(g, "")
    return out

def make_book(n, seed):
    R = random.Random(seed)
    L = {}   # name -> (parent, opening in paise)
    def led(name, parent, op=0): L.setdefault(name, (parent, op)); return name
    for nm, g in (("Sales - GST 18%", "Sales Accounts"), ("Sales - GST 12%", "Sales Accounts"), ("Sales - GST 5%", "Sales Accounts"), ("Sales - Exempt", "Sales Accounts"),
                  ("Export Sales (LUT)", "Sales Accounts"), ("Purchase - GST 18%", "Purchase Accounts"), ("Purchase - GST 12%", "Purchase Accounts"), ("Purchase - GST 5%", "Purchase Accounts"),
                  ("Output CGST", "Duties & Taxes"), ("Output SGST", "Duties & Taxes"), ("Output IGST", "Duties & Taxes"), ("Input CGST", "Duties & Taxes"), ("Input SGST", "Duties & Taxes"),
                  ("Input IGST", "Duties & Taxes"), ("RCM Output CGST", "Duties & Taxes"), ("RCM Output SGST", "Duties & Taxes"), ("RCM Input CGST", "Duties & Taxes"), ("RCM Input SGST", "Duties & Taxes"),
                  ("TDS Payable 194C", "Duties & Taxes"), ("TDS Payable 194J", "Duties & Taxes"), ("TDS Payable 194I", "Duties & Taxes"),
                  ("Legal Fees (RCM)", "Indirect Expenses"), ("Freight Inward (GTA)", "Direct Expenses"), ("Contract Labour", "Direct Expenses"), ("Professional Fees", "Indirect Expenses"),
                  ("Office Rent", "Indirect Expenses"), ("Salaries", "Indirect Expenses"), ("Office Expenses", "Indirect Expenses"), ("Bank Charges", "Indirect Expenses"),
                  ("Depreciation", "Indirect Expenses"), ("Interest Received", "Indirect Incomes"), ("Discount Received", "Indirect Incomes"),
                  ("Furniture & Fixtures", "Fixed Assets"), ("Salary Payable", "Provisions"), ("Staff Advance", "Loans & Advances (Asset)"), ("Term Loan - Demo Bank", "Loans (Liability)")):
        led(nm, g)
    led("Demo Bank Current A/c", "Bank Accounts", -250000000); led("Demo Bank OD A/c", "Bank Accounts", 0); led("Cash", "Cash-in-Hand", -2000000)
    led("Proprietor Capital", "Capital Account", 400000000)
    cust = []
    for i in range(max(50, n // 50)):
        st = HOME if R.random() < 0.6 else R.choice([s for s in STATES if s != HOME])
        nm = led("Demo Customer %04d" % (i + 1), "Sundry Debtors", -R.randrange(0, 5000000)); cust.append((nm, st, fake_gstin(R, st)))
    sup = []
    for i in range(max(30, n // 125)):
        st = HOME if R.random() < 0.7 else R.choice([s for s in STATES if s != HOME])
        nm = led("Demo Supplier %04d" % (i + 1), "Sundry Creditors", R.randrange(0, 4000000)); sup.append((nm, st, fake_gstin(R, st)))
    foreign = [led("Demo Overseas Buyer %02d" % (i + 1), "Sundry Debtors") for i in range(12)]
    contractors = [(led("Demo Contractor %03d" % (i + 1), "Sundry Creditors"), fake_pan(R, "P")) for i in range(max(10, n // 2000))]
    profs = [(led("Demo Consultant %03d" % (i + 1), "Sundry Creditors"), fake_pan(R, "P")) for i in range(max(8, n // 4000))]
    landlord = led("Demo Landlord", "Sundry Creditors")
    cmp = "%02d%s1Z" % (HOME, "AAAAD1234D"); CMP = cmp + gst_check(cmp)            # the company's made-up GSTIN
    days = (END - START).days + 1
    mix = [("b2b", 22), ("b2c", 12), ("export", 1.5), ("cn", 2), ("dn", 1), ("pur", 15), ("rcm", 1.5), ("tds", 4), ("jv", 6), ("rcpt", 17), ("pay", 16), ("contra", 2)]
    kinds = [k for k, _ in mix]; wts = [w for _, w in mix]
    V, no = [], {}
    alter = 0
    for i in range(n):
        k = R.choices(kinds, wts)[0]
        d = START + datetime.timedelta(days=R.randrange(days))
        alter += R.randrange(1, 4)
        g = "%08x-dem0-4bbk-%04x-%012x" % (seed, i % 65536, i)
        rate = R.choice([18, 18, 18, 12, 5])
        tx = R.randrange(50000, 50000000)          # paise
        ent, v = [], {"guid": g, "day": d, "alter": alter, "party": "", "gstin": "", "pos": "", "reg": "", "country": "", "rcm": None, "nature": "", "taxab": "", "supply": ""}
        def bill(e, ref, typ, days_=None): e["b"] = [[ref, typ, e["a"], days_]]; return e
        if k in ("b2b", "b2c", "export", "cn"):
            vt = {"b2b": "Sales", "b2c": "Sales", "export": "Sales", "cn": "Credit Note"}[k]
            if k == "export":
                party, st, gn = R.choice(foreign), 96, ""; rate = 0; v["country"] = "United States"; v["reg"] = "Regular"; v["nature"] = "Exports - LUT/Bond"; v["pos"] = "Other Countries"
            elif k == "b2c":
                party, st, gn = "Cash", HOME, ""; v["reg"] = "Unregistered/Consumer"; tx //= 20; v["nature"] = "Local Sales - Taxable"
            else:
                party, st, gn = R.choice(cust); v["reg"] = "Regular"; v["nature"] = "Local Sales - Taxable" if st == HOME else "Interstate Sales - Taxable"
            v["party"], v["gstin"] = party, gn
            if not v["pos"]: v["pos"] = STATES.get(st, "")
            sl = "Export Sales (LUT)" if k == "export" else ("Sales - Exempt" if R.random() < 0.03 else "Sales - GST %d%%" % rate)
            if sl == "Sales - Exempt": rate = 0; v["taxab"] = "Exempt"
            tax = tx * rate // 100
            sg = 1 if vt == "Sales" else -1           # Tally: a debit is negative; a sale credits sales and tax
            if st == HOME and rate: taxes = [("Output CGST", tax // 2), ("Output SGST", tax - tax // 2)]
            elif rate: taxes = [("Output IGST", tax)]
            else: taxes = []
            tot = tx + tax
            pe = {"l": party, "a": -sg * tot}
            ent.append(bill(pe, "INV-%d" % i, "New Ref" if vt == "Sales" else "Agst Ref", 30) if party != "Cash" else pe)
            ent.append({"l": sl, "a": sg * tx, "h": R.choice(["8471", "8517", "3004", "9983", "6109", "8504"]), "r": rate})
            for t, a in taxes: ent.append({"l": t, "a": sg * a})
        elif k in ("pur", "dn", "rcm"):
            vt = {"pur": "Purchase", "dn": "Debit Note", "rcm": "Purchase"}[k]
            if k == "rcm":
                exp = R.choice(["Legal Fees (RCM)", "Freight Inward (GTA)"]); rr = 18 if exp.startswith("Legal") else 5
                party, st, gn = R.choice(sup); gn = ""                      # an unregistered provider
                v.update(party=party, gstin="", pos=STATES[HOME], reg="Unregistered/Consumer", rcm=True, nature="Purchase from Unregistered Dealer - Reverse Charge")
                tax = tx * rr // 100
                ent += [bill({"l": party, "a": tx}, "RCM-%d" % i, "New Ref", 15), {"l": exp, "a": -tx, "h": "9982" if rr == 18 else "9965", "r": rr},
                        {"l": "RCM Input CGST", "a": -(tax // 2)}, {"l": "RCM Input SGST", "a": -(tax - tax // 2)},
                        {"l": "RCM Output CGST", "a": tax // 2}, {"l": "RCM Output SGST", "a": tax - tax // 2}]
            else:
                party, st, gn = R.choice(sup); v.update(party=party, gstin=gn, pos=STATES.get(st, ""), reg="Regular", nature="Purchase Taxable")
                pl = "Purchase - GST %d%%" % rate; tax = tx * rate // 100
                sg = 1 if vt == "Purchase" else -1     # a purchase debits purchases and input tax
                taxes = [("Input CGST", tax // 2), ("Input SGST", tax - tax // 2)] if st == HOME else [("Input IGST", tax)]
                ent += [bill({"l": party, "a": sg * (tx + tax)}, "PB-%d" % i, "New Ref" if sg > 0 else "Agst Ref", 45), {"l": pl, "a": -sg * tx, "h": "8471", "r": rate}]
                for t, a in taxes: ent.append({"l": t, "a": -sg * a})
        elif k == "tds":
            vt = "Journal"; sec, (party, pan), exp, r_ = R.choice([("194C", R.choice(contractors), "Contract Labour", 1), ("194C", R.choice(contractors), "Contract Labour", 2),
                                                                  ("194J", R.choice(profs), "Professional Fees", 10), ("194I", (landlord, ""), "Office Rent", 10)])
            v["party"] = party; tds = tx * r_ // 100
            ent += [{"l": exp, "a": -tx}, bill({"l": party, "a": tx - tds}, "TDS-%d" % i, "New Ref", 30), {"l": "TDS Payable " + sec, "a": tds}]
        elif k == "jv":
            vt = "Journal"; a = R.randrange(10000, 2000000)
            pair = R.choice([("Depreciation", "Furniture & Fixtures"), ("Salaries", "Salary Payable"), ("Office Expenses", "Staff Advance"), ("Demo Bank Current A/c", "Interest Received")])
            ent += [{"l": pair[0], "a": -a}, {"l": pair[1], "a": a}]
        elif k == "rcpt":
            vt = "Receipt"; party = R.choice(cust)[0]; v["party"] = party; a = R.randrange(100000, 30000000)
            ent += [{"l": R.choice(["Demo Bank Current A/c", "Demo Bank Current A/c", "Cash"]), "a": -a}, bill({"l": party, "a": a}, "INV-%d" % R.randrange(max(1, i)), "Agst Ref")]
        elif k == "pay":
            vt = "Payment"; a = R.randrange(100000, 25000000)
            r_ = R.random()
            if r_ < 0.7: party = R.choice(sup)[0]; ent.append(bill({"l": party, "a": -a}, "PB-%d" % R.randrange(max(1, i)), "Agst Ref"))
            elif r_ < 0.85: party = R.choice(["TDS Payable 194C", "TDS Payable 194J", "TDS Payable 194I"]); ent.append({"l": party, "a": -(a // 20)}); a //= 20
            else: party = R.choice(["Office Expenses", "Bank Charges", "Salary Payable"]); ent.append({"l": party, "a": -a})
            v["party"] = party; ent.append({"l": "Demo Bank Current A/c", "a": a})
        else:
            vt = "Contra"; a = R.randrange(100000, 5000000); ent += [{"l": "Cash", "a": -a}, {"l": "Demo Bank Current A/c", "a": a}]
        no[vt] = no.get(vt, 0) + 1
        v.update(type=vt, no="%s/%d" % ({"Sales": "DT", "Credit Note": "CN", "Debit Note": "DN", "Purchase": "PB"}.get(vt, vt[:2].upper()), no[vt]), ent=ent, cmp=CMP,
                 deleted=R.random() < 0.005, cancel=R.random() < 0.003, opt=R.random() < 0.001,
                 narr="Made-up entry %d" % i if R.random() < 0.4 else "", ref="REF-%d" % i if vt in ("Purchase", "Debit Note") else "")
        assert sum(e["a"] for e in ent) == 0, (k, ent)
        V.append(v)
    V.sort(key=lambda v: (v["day"], v["guid"]))
    return L, V, CMP

def paise(p): return ("-" if p < 0 else "") + "%d.%02d" % divmod(abs(p), 100)
def esc(s): return str(s).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")
N = "\\N"

def write_copies(L, V, out):
    """the COPY files, one per table (tab separated, as COPY reads them)"""
    paths = {}
    def w(name, rows):
        p = os.path.join(out, name + ".copy")
        with open(p, "w") as fh:
            for r in rows: fh.write("\t".join(r) + "\n")
        paths[name] = p
    w("tally_ledgers", ([B, F, n, par, paise(op), "{" + ",".join('"%s"' % g for g in chain(par)) + "}", (chain(par) or [""])[-1]] for n, (par, op) in sorted(L.items())))
    w("tally_groups", ([B, F, g, p] for g, p in GROUPS.items()))
    vid = [0]
    def vrows():
        for v in V:
            yield [B, F, v["guid"], v["day"].isoformat(), str(v["alter"]), v["type"], v["no"], esc(v["party"]), esc(v["narr"]), "t" if v["cancel"] else "f", "t" if v["opt"] else "f",
                   v["gstin"], esc(v["pos"]), v["ref"], N if not v["ref"] else v["day"].isoformat(), v["cmp"], "2026-10-15 10:00:00+00" if v["deleted"] else N,
                   v["reg"] or N, v["country"] or N, N if v["rcm"] is None else ("t" if v["rcm"] else "f"), v["nature"] or N, v["taxab"] or N, N, str(v["alter"])]
    w("tally_vouchers", vrows())
    lid = [0]
    def lrows():
        for v in V:
            for e in v["ent"]:
                lid[0] += 1
                yield [str(lid[0]), B, F, v["guid"], v["day"].isoformat(), esc(e["l"]), paise(e["a"]), e.get("h", ""), N if e.get("r") is None else str(e["r"])]
    w("tally_lines", lrows())
    bid = [0]
    def brows():
        for v in V:
            for e in v["ent"]:
                for x in e.get("b") or []:
                    bid[0] += 1
                    yield [str(bid[0]), B, F, v["guid"], v["day"].isoformat(), esc(e["l"]), x[0], x[1], paise(x[2]), N if x[1] != "New Ref" else v["day"].isoformat(), N if x[3] is None else str(x[3]),
                           N if x[3] is None or x[1] != "New Ref" else (v["day"] + datetime.timedelta(days=x[3])).isoformat()]
    w("tally_bills", brows())
    per = {}
    for v in V:
        p = per.setdefault(v["day"], [0, 0]); p[0] += 0 if v["deleted"] else 1; p[1] = max(p[1], v["alter"])
    w("tally_days", ([B, F, d.isoformat(), str(c), str(a), str(4000 + 900 * c), "2026-10-31 12:00:00+00"] for d, (c, a) in sorted(per.items())))
    return paths, lid[0], bid[0]

# the cloud copy's tables, beyond pg_stand's: each column and index as the repo's migrations make it
SCHEMA = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
alter database postgres set jit = off;
-- migration.sql (tally_days; tally_vouchers_day), 41 (empty_at, note)
create table if not exists tally_days (book_id uuid not null, firm_id uuid not null, day date not null, n integer not null default 0, alter_max bigint not null default 0,
  bytes integer not null default 0, at timestamptz not null default now(), empty_at timestamptz, note text, primary key (book_id, day));
create index if not exists tally_vouchers_day on tally_vouchers (book_id, day);
-- 6, 11, 31, 32, 37, 57, 72, 73, 75: the entry's columns
alter table tally_vouchers add column if not exists deleted_at timestamptz, add column if not exists origin text not null default 'tally', add column if not exists raw_party text,
  add column if not exists fincom_id text, add column if not exists irn text not null default '', add column if not exists irn_ack_no text not null default '', add column if not exists irn_ack_date date,
  add column if not exists eway_no text not null default '', add column if not exists check_notes jsonb not null default '[]'::jsonb,
  add column if not exists gst_reg_type text, add column if not exists gst_country text, add column if not exists gst_rcm boolean, add column if not exists gst_nature text,
  add column if not exists gst_taxability text, add column if not exists gst_supply text, add column if not exists gst_ineligible boolean, add column if not exists gst_mixed boolean,
  add column if not exists gst_alter_id bigint, add column if not exists tds_tally jsonb, add column if not exists tds_tally_alter_id bigint, add column if not exists source text not null default 'tally';
create index if not exists tally_vouchers_fincom on tally_vouchers (book_id, fincom_id) where fincom_id is not null;     -- 37
-- 6 (hsn, rate: in pg_stand already), 31 (raw_ledger), 14 (tally_lines_book_day); id: the line's order (read by 152 and 153)
alter table tally_lines add column if not exists raw_ledger text, add column if not exists id bigint;
create index if not exists tally_lines_book_day on tally_lines (book_id, day);
-- 7 (tally_bills and its three indexes), 31 (raw_ledger); id as on staging (read by 153)
create table if not exists tally_bills (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, ledger text not null, name text not null default '',
  type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date, raw_ledger text, id bigint primary key);
create index if not exists tally_bills_book_party on tally_bills (book_id, ledger, name);
create index if not exists tally_bills_book_guid on tally_bills (book_id, guid);
create index if not exists tally_bills_book_day on tally_bills (book_id, day);
-- 31 and 36 (the ledger-day cache's columns), 34 (ledgers' deleted_at)
alter table tally_ledger_day add column if not exists raw_ledger text, add column if not exists merged_into text, add column if not exists before_clean jsonb;
alter table tally_ledgers add column if not exists deleted_at timestamptz;
-- what 151-153 read besides (as tests/run_migration153.py makes them)
create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));
create table if not exists clients (firm_id uuid, id text, name text, data jsonb default '{}', deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, id));
create table if not exists records (firm_id uuid, kind text, id text, client_id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, kind, id));
create table if not exists gst_2b_runs (id bigint generated always as identity primary key, firm_id uuid, client_id text, gstin text, fy text, status text, done_at timestamptz, result jsonb);
create table if not exists gst_2b_decisions (firm_id uuid, gstin text, fy text, pair_id text, decision text, at timestamptz default now(), primary key (firm_id, gstin, fy, pair_id));
"""
MIGRATIONS = [os.path.join(ROOT, *p) for p in (("server", "tally-cloud", "migration-64-pages-live.sql"), ("server", "tally-cloud", "migration-151-cloud-calc-1.sql"),
              ("server", "tally-cloud", "migration-152-cloud-calc-2.sql"), ("server", "gst-run", "migration-153-gst-cloud.sql"), ("server", "gst-run", "migration-159-gst-posfix.sql"),
              ("server", "gst-run", "migration-162-gst-prep.sql"), ("server", "tally-cloud", "migration-163-mis-cash-speed.sql"))]

def free_mb():
    return shutil.disk_usage("/").free // (1024 * 1024)

def q(s): return "'" + str(s).replace("'", "''") + "'"

def psql_file(db, path):
    with open(path, "rb") as fh:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
                           stdin=fh, capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr.decode()[-2000:])

def copy_in(db, table, cols, path):
    """COPY ... FROM stdin, the file streamed to psql (the postgres user need not read the folder)"""
    hdr = os.path.join(os.path.dirname(path), table + ".sql")
    with open(hdr, "w") as fh: fh.write("copy %s (%s) from stdin;\n" % (table, cols))
    r = subprocess.run("cat %s %s | runuser -u postgres -- %s/psql -h 127.0.0.1 -p %d -U postgres -d postgres -v ON_ERROR_STOP=1 -q" % (hdr, path, pg_stand.BIN, db.port), shell=True, capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr.decode()[-2000:])

def main():
    t0 = time.time()
    print("== making the book: %d entries (seed %d)" % (A.entries, A.seed))
    L, V, CMP = make_book(A.entries, A.seed)
    mix = {}
    for v in V: mix[v["type"]] = mix.get(v["type"], 0) + 1
    print("   %d ledgers; entries by type: %s; deleted %d, cancelled %d, optional %d; RCM %d; exports %d (%.1f s)" % (
        len(L), json.dumps(dict(sorted(mix.items()))), sum(v["deleted"] for v in V), sum(v["cancel"] for v in V), sum(v["opt"] for v in V),
        sum(1 for v in V if v["rcm"]), sum(1 for v in V if v["country"]), time.time() - t0))
    out = tempfile.mkdtemp(prefix="bigbook-")
    paths, n_lines, n_bills = write_copies(L, V, out)
    mb = sum(os.path.getsize(p) for p in paths.values()) / 1e6
    print("   COPY files: %s (%.1f MB; %d lines, %d bill rows)" % (out, mb, n_lines, n_bills))
    if free_mb() < MIN_FREE_MB + 6 * mb:
        print("   STOP: %d MB free on /, below %d MB + room for the database" % (free_mb(), MIN_FREE_MB)); shutil.rmtree(out); sys.exit(2)
    port = int(os.environ.get("BIGBOOK_PORT") or 31900)
    db = pg_stand.start(port)
    try:
        db.sql(SCHEMA)
        print("== the repo's migrations, in order: " + ", ".join(os.path.basename(m).split("-")[1] for m in MIGRATIONS))
        for m in MIGRATIONS: psql_file(db, m)
        t1 = time.time()
        db.sql("insert into firms values (%s, 'Demo Firm (made up)'); insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on, days_at, ledgers_at) values (%s, %s, %s, %s, %s, %s, now(), now());"
               % (q(F), q(B), q(F), q(CID), q(COMPANY), q(START.isoformat()), q(START.isoformat())))
        copy_in(db, "tally_ledgers", "book_id, firm_id, name, parent, open, chain, primary_group", paths["tally_ledgers"])
        copy_in(db, "tally_groups", "book_id, firm_id, name, parent", paths["tally_groups"])
        copy_in(db, "tally_vouchers", "book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin, deleted_at, "
                "gst_reg_type, gst_country, gst_rcm, gst_nature, gst_taxability, gst_supply, gst_alter_id", paths["tally_vouchers"])
        copy_in(db, "tally_lines", "id, book_id, firm_id, guid, day, ledger, amount, hsn, rate", paths["tally_lines"])
        copy_in(db, "tally_bills", "id, book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due", paths["tally_bills"])
        copy_in(db, "tally_days", "book_id, firm_id, day, n, alter_max, bytes, at", paths["tally_days"])
        # the day cache as tally_ledger_day_rebuild (44) makes it, live entries only
        db.sql("""insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
          select l.book_id, l.firm_id, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
            from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
           where l.book_id = %s and v.deleted_at is null and not v.cancelled and not v.optional group by 1, 2, 3, 4;""" % q(B))
        # FinCom's ledger list (client_book_items 'map') for the GST and TDS ledgers, and the client's record
        fmap = {}
        for n in L:
            if n.startswith(("Output ", "RCM Output")): fmap[n] = {"kind": "gst", "side": "output"}
            elif n.startswith(("Input ", "RCM Input")): fmap[n] = {"kind": "gst", "side": "input"}
            elif n.startswith("TDS Payable"): fmap[n] = {"kind": "tds_payable", "section": n.split()[-1]}
            elif L[n][0] == "Bank Accounts": fmap[n] = {"kind": "bank"}
        rows = "\n".join("\t".join([F, CID, "map", "." + n, json.dumps(x), "f", str(i + 1)]) for i, (n, x) in enumerate(sorted(fmap.items())))
        db.sql("copy client_book_items (firm_id, client_id, key, item, data, deleted, seq) from stdin;\n" + rows + "\n\\.\n")
        db.sql("insert into clients (firm_id, id, name, data) values (%s, %s, %s, %s::jsonb)" % (q(F), q(CID), q(COMPANY), q(json.dumps({"name": COMPANY, "gstin": CMP}))))
        db.sql("vacuum analyze;")
        print("   loaded in %.1f s" % (time.time() - t1))
        if not A.no_measure: measure(db)
    finally:
        if A.keep: print("   kept: the database at %s (port %d), the COPY files at %s" % (db.data, db.port, out))
        else:
            db.stop(); shutil.rmtree(db.data, ignore_errors=True); shutil.rmtree(out, ignore_errors=True)
            print("   removed: the database folder %s and the COPY files" % db.data)
    print("done in %.1f s" % (time.time() - t0))

def measure(db):
    R = []
    def med(sql, runs=None):
        xs = [float(db.one("select t_ms(%s)" % q(sql))) for _ in range(runs or A.runs)]
        return statistics.median(xs), min(xs), max(xs)
    db.sql("""create or replace function t_ms(p text) returns numeric language plpgsql as $$ declare t timestamptz := clock_timestamp(); n bigint;
              begin execute p into n; return round(extract(epoch from clock_timestamp() - t) * 1000, 1); end $$;""")
    n_all = int(db.one("select count(*) from tally_vouchers")); n_live = int(db.one("select count(*) from tally_vouchers where deleted_at is null"))
    n_l = int(db.one("select count(*) from tally_lines")); n_b = int(db.one("select count(*) from tally_bills")); n_d = int(db.one("select count(*) from tally_ledger_day"))
    print("== 1. bytes per entry (%d entries, %d live; %d lines, %d bills, %d ledger-day rows, %s days)" % (n_all, n_live, n_l, n_b, n_d, db.one("select count(*) from tally_days")))
    rows = db.rows("""select c.relname as t, pg_table_size(c.oid) as heap, pg_indexes_size(c.oid) as idx, pg_total_relation_size(c.oid) as total from pg_class c
                      where c.relname in ('tally_vouchers', 'tally_lines', 'tally_bills', 'tally_ledger_day', 'tally_days', 'tally_ledgers', 'tally_voucher_versions') and c.relkind = 'r' order by 4 desc""")
    tot = [0, 0, 0]
    print("   %-18s %12s %12s %12s %10s %10s" % ("table", "table bytes", "index bytes", "total", "B/entry", "MB"))
    for r in rows:
        h, i, t = int(r["heap"]), int(r["idx"]), int(r["total"]); tot = [tot[0] + h, tot[1] + i, tot[2] + t]
        print("   %-18s %12d %12d %12d %10.0f %10.1f" % (r["t"], h, i, t, t / n_all, t / 1e6))
    print("   %-18s %12d %12d %12d %10.0f %10.1f" % ("all", tot[0], tot[1], tot[2], tot[2] / n_all, tot[2] / 1e6))
    print("== 2. the cloud GST month path (gst-run: gst_calc_version, gst_calc_rows of the whole book; migration 153/159)")
    m, lo, hi = med("select length(gst_calc_rows(%s)::text)" % q(B))
    size = int(db.one("select length(gst_calc_rows(%s)::text)" % q(B)))
    print("   gst_calc_rows(book): median %.0f ms (min %.0f, max %.0f); answer %.1f MB of JSON text" % (m, lo, hi, m and size / 1e6))
    m2, lo2, hi2 = med("select length(gst_calc_version(%s, %s))" % (q(B), q(CID)))
    print("   gst_calc_version(book, client): median %.0f ms (min %.0f, max %.0f)" % (m2, lo2, hi2))
    m3, _, _ = med("select length(tally_calc_version(%s))" % q(B))
    print("   tally_calc_version(book): median %.0f ms" % m3)
    print("== 3. the MIS SQL (tally_calc_mis, 152 with 163's cash): median of %d, ms" % A.runs)
    periods = [("FY 2025-26", "2025-04-01", "2026-03-31"), ("Oct 2026", "2026-10-01", "2026-10-31"), ("whole span", "2024-04-01", "2026-10-31")]
    print("   %-10s %12s %12s %12s" % ("part", *[p[0] for p in periods]))
    for part in ("sales", "purchases", "pl", "prev", "ly", "tops", "cash", "comp", "msme", "control"):
        cells = []
        for _, f, t in periods:
            m, _, _ = med("select length(coalesce(tally_calc_mis(%s, %s, %s, %s, '2026-11-09')::text, ''))" % (q(B), q(part), q(f), q(t)))
            cells.append("%.0f" % m)
        print("   %-10s %12s %12s %12s" % (part, *cells))
    m, _, _ = med("select count(*) from tally_calc_led(%s)" % q(B)); print("   tally_calc_led(book) alone: %.0f ms" % m)
    m, _, _ = med("select count(*) from tally_calc_bal(%s, array['2026-03-31'::date])" % q(B)); print("   tally_calc_bal(book, 31-Mar-2026) (the balance sheet's balances): %.0f ms" % m)
    print("   sanity (FY 2025-26): sales %s; P&L keys %s" % (db.one("select left(tally_calc_mis(%s, 'sales', '2025-04-01', '2026-03-31')::text, 160)" % q(B)),
          db.one("select string_agg(k, ',') from jsonb_object_keys(tally_calc_mis(%s, 'pl', '2025-04-01', '2026-03-31')) k" % q(B))))
    print("== 4. sketches of the planned sweep (made here, dropped after)")
    db.sql("""create table calc_seen (book_id uuid, guid text, alter_id bigint, gone boolean, ledger_month date, primary key (book_id, guid));
              insert into calc_seen select v.book_id, v.guid, v.alter_id, v.deleted_at is not null or v.cancelled or v.optional, date_trunc('month', v.day)::date from tally_vouchers v;
              create table calc_share (book_id uuid, guid text, ledger_month date, gst numeric[], tds numeric[], mis numeric[], primary key (book_id, guid));
              insert into calc_share select v.book_id, v.guid, date_trunc('month', v.day)::date, array[sum(l.amount) filter (where l.ledger like 'Output%%'), sum(l.amount) filter (where l.ledger like 'Input%%'),
                       sum(l.amount) filter (where l.ledger like 'RCM%%'), sum(l.amount) filter (where l.ledger like 'Sales%%'), 0, 0, 0, 0],
                     array[sum(l.amount) filter (where l.ledger like 'TDS%%'), 0], array[sum(l.amount) filter (where l.ledger like 'Sales%%'), sum(l.amount) filter (where l.ledger like 'Purchase%%'), 0, 0, 0, 0]
                from tally_vouchers v join tally_lines l on l.book_id = v.book_id and l.guid = v.guid group by 1, 2, 3;
              create index on calc_share (book_id, ledger_month);
              update tally_vouchers set alter_id = alter_id + 1000000 where book_id = '%s' and guid in (select guid from tally_vouchers where book_id = '%s' order by guid limit 50);
              vacuum analyze calc_seen, calc_share, tally_vouchers;""" % (B, B))
    for nm in ("calc_seen", "calc_share"):
        t = int(db.one("select pg_total_relation_size('%s')" % nm)); print("   %s: %d bytes, %.0f B/entry" % (nm, t, t / n_all))
    diff = """select count(*) from tally_vouchers v left join calc_seen s on s.book_id = v.book_id and s.guid = v.guid
               where v.book_id = '%s' %s and (s.guid is null or s.alter_id <> v.alter_id or s.gone <> (v.deleted_at is not null or v.cancelled or v.optional))"""
    m, _, _ = med(diff % (B, "")); print("   whole-book diff against calc_seen (50 entries changed): %.0f ms (%s found)" % (m, db.one(diff % (B, ""))))
    day = db.one("select day::text from tally_days where book_id = '%s' order by n desc limit 1" % B)
    m, _, _ = med(diff % (B, "and v.day = '%s'" % day)); print("   one-day diff (the busiest day, %s entries): %.1f ms" % (db.one("select n from tally_days where book_id = '%s' and day = '%s'" % (B, day)), m))
    m, _, _ = med("select count(*) from (select ledger_month, sum(gst[1]), sum(gst[2]), sum(gst[3]), sum(tds[1]), sum(mis[1]) from calc_share where book_id = '%s' and ledger_month = '2025-10-01' group by 1) x" % B)
    print("   one month's re-sum from calc_share: %.1f ms" % m)
    m, _, _ = med("select count(*) from (select ledger_month, sum(gst[1]), sum(mis[1]) from calc_share where book_id = '%s' group by 1) x" % B)
    print("   every month's re-sum from calc_share: %.1f ms" % m)
    m, _, _ = med("select count(*) from tally_days where at > now() - interval '1 minute'")
    print("   tally_days rows stamped in the last minute (no index on at; %s rows): %.1f ms" % (db.one("select count(*) from tally_days"), m))
    db.sql("drop table calc_seen, calc_share;")

if __name__ == "__main__":
    main()
