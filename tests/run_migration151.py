"""python3 run_migration151.py - server/tally-cloud/migration-151-cloud-calc-1.sql (09-Nov-2026, branch next-cloud-calc1; the
owner: "it should not freeze at all, whatever the book size; calculation should happen in cloud").
On a throwaway PostgreSQL (pg_stand, port 31151 unless PG151_PORT; never a real database): the cloud copy's tables as on
staging (tally_ledger_day and tally_vouchers with their merged / deleted columns, tally_bills), then 151 (twice). Made-up
books only, written here with a fixed seed: one small (about 2,500 entries) and one of 40,000 entries and 10,000 ledgers.
For each book the browser's own engine (src/js, assembled by build.py into a scratch test page and run in Node by
tests/run_migration151.js, as tests/run_mis.js does) works out the same figures from the same entries; FinCom's ledger
list the browser makes on load (Books.mapLedgers) is kept in client_book_items as the browser keeps it. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no drop, delete, truncate, no existing table altered); RLS
     on the new table; grants explicit (members: tally_balances_at, tally_tieout, tally_ageing, tally_calc_cached; the
     rest service_role only); names no real database; runs twice; md5
  The browser side is put together as TCloud.load does it: tally_groups as TCloud.groupsInto reads them, the ledger rows
  TCloud.restAll reads (deleted_at is null), TallyRead.balances (and its yearOpen on a copy starting 1 April).
  1. tally_balances_at / tally_balances_json = Audit.balances().at(d) at every month-end and a few odd days: the same
     ledgers, every balance to the paisa (cancelled, optional and deleted entries left out; a ledger with entries and no
     master; a master deleted in Tally that still has entries; customers whose ledger has no chain, under a sub-group
     of Sundry Debtors, found by the groups; profit and loss openings moved to Profit & Loss A/c on 1 April)
  2. tally_tieout = Rec.fincom at every month-end: receivables, payables, cash and bank, profit (none before the books
     begin in that year), trial balance total (with the opening difference line; none once an entry does not balance)
  3. tally_ageing = MIS.ageing, receivables and payables, on several days: every party's total, buckets, advances, on
     account, older bills, oldest, ledger balance and difference, net, not bill-wise, open bills one by one; the sums
     (an entry with two lines of one customer, bills on one only: the other stays on account)
  3b. tally_now = what MIS.runNow takes from the day's balances: both ageings, owed (Parties.position(to)), cash and bank
  4. members: another firm's member is refused / sees nothing; the kept answers (tally_calc_put, tally_calc_cached) are
     used only while the book's version is the same, and a new entry, a deletion, a changed ledger list, a ledger renamed
     (masters, lines, bills, day totals) or carried (lines, bills, day totals only) moves it; the limits (400 dates, 120
     months)
  4b. one client with two books, 2025-26 (from 1 April 2025) and 2026-27 (from 1 April 2026, profit and loss openings
     carried): tally_tieout, tally_ageing and tally_now each take the book of the period (the 2025-26 months from the
     2025-26 book) and match the browser on that book
  5. timings on the 40,000-entry book (the median of five; the target: under 1 s each, tally_now under 0.8 s)
  7. a book with no groups read (the browser: the parent alone, ledGroupPath over an empty b.groups), and ledgers whose
     parent is a case or space variant of a group's name ("north customers", "sundry  debtors": found as ledLook finds
     them, by namesKey, the variant itself kept in the path): every figure to the paisa
  8. members: another firm's member and anon get nothing from tally_now, tally_balances_json, tally_calc_cached, nor rows
     of tally_calc_results; a member's limits: 31 dates, 24 months of tie-out
  The database is set as staging is (jit off: on, its compiling alone took 1.6 s of a 1.7 s call here).
  6. mis-run "now" end to end on the 40,000-entry book (server/mis-run/now_pg_test.ts, the real handler, each RPC through
     psql; needs deno: DENO, else on PATH): every balance (about 10,000 ledgers, over the 1,000 of a REST row call) and
     both ageings as the browser's; asked again: the kept answer"""
import os, re, sys, json, hashlib, random, subprocess, datetime, time, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE); sys.path.insert(0, ROOT)
import pg_stand, csv
csv.field_size_limit(1 << 30)           # an ageing of 4,000 parties is one large answer
M151 = os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")
SCRATCH = os.environ.get("M151_TMP") or tempfile.mkdtemp(prefix="m151-")
import shutil
DENO = os.environ.get("DENO") or shutil.which("deno")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"

text = open(M151).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M151), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "one transaction, lock_timeout 10 s")
code_nd = code.replace("drop policy if exists tally_calc_results_read on public.tally_calc_results;", "")
ok(code.count("drop policy if exists tally_calc_results_read on public.tally_calc_results;") == 1, "the one drop: this migration's own policy, made again at once")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\s", code_nd) and not re.search(r"\balter\s+table\s+(?!public\.tally_calc_results\s+enable)", code), "add-only: nothing dropped, deleted, truncated; no other table altered")
ok("create table if not exists public.tally_calc_results" in code and "alter table public.tally_calc_results enable row level security" in code, "the new table, RLS on")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
SVC = {"tally_calc_nclean": "(text)", "tally_calc_nkey": "(text)", "tally_calc_ageing_sides": "(uuid, date, text, jsonb)", "tally_calc_led": "(uuid)", "tally_calc_bal": "(uuid, date[])", "tally_calc_tieout": "(uuid, text[])", "tally_calc_ageing": "(uuid, date, text)", "tally_calc_ageing_bal": "(uuid, date, text, jsonb)", "tally_calc_ageing_json": "(uuid, date, text, jsonb)",
       "tally_calc_version": "(uuid)", "tally_calc_put": "(uuid, text, text, text, jsonb, integer)"}
MEM = {"tally_balances_at": "(uuid, date[])", "tally_balances_json": "(uuid, date[])", "tally_tieout": "(text, text[])", "tally_ageing": "(text, date, text)", "tally_calc_cached": "(text, date, text, text)",
       "tally_now": "(text, date, date)"}
for fn, sig in SVC.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only" % fn)
for fn, sig in MEM.items():
    ok(("revoke all on function public.%s%s from public, anon;" % (fn, sig)) in text and ("grant execute on function public.%s%s to authenticated, service_role;" % (fn, sig)) in text, "%s: members" % fn)
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == sorted(list(SVC) + list(MEM)), "adds only %s" % made)
old = set()
for d in ("server/tally-cloud", "server/security", "server/mis-run"):
    for f in os.listdir(os.path.join(ROOT, d)):
        # only what was there before 151 (a later migration, 152, makes some of 151's functions again on purpose)
        num = re.match(r"migration-(\d+)-", f)
        if f.endswith(".sql") and "151" not in f and not (num and int(num.group(1)) > 151): old |= set(re.findall(r"create or replace function public\.(\w+)\(", open(os.path.join(ROOT, d, f)).read().lower()))
ok(not (set(made) & old), "no existing function replaced (%s)" % sorted(set(made) & old))

# ------------------------------------------------------------------------------------------------ the made-up books
F, F2 = "99999999-9999-9999-9999-999999999151", "88888888-8888-8888-8888-888888888151"
U, U2 = "55555555-5555-5555-5555-555555555151", "66666666-6666-6666-6666-666666666151"
GROUPS = {"Current Assets": "\x04 Primary", "Current Liabilities": "", "Sales Accounts": "\x04 Primary", "Purchase Accounts": "", "Indirect Expenses": "", "Direct Expenses": "", "Indirect Incomes": "",
          "Capital Account": "", "Fixed Assets": "", "Loans (Liability)": "", "Sundry Debtors": "Current Assets", "North Customers": "Sundry Debtors", "Sundry Creditors": "Current Liabilities",
          "Bank Accounts": "Current Assets", "Cash-in-Hand": "Current Assets", "Duties & Taxes": "Current Liabilities", "Unsecured Loans": "Loans (Liability)", "Bank OD A/c": "Loans (Liability)",
          "Salary & Wages": "Indirect Expenses"}
def chain(parent):
    out, p = [], parent
    while p and len(out) < 15: out.append(p); p = GROUPS.get(p, "")
    return out
NOMINAL = {"sales accounts", "purchase accounts", "direct incomes", "direct expenses", "indirect incomes", "indirect expenses"}
def d8(d): return d.strftime("%Y%m%d")

def make_book(seed, n_v, n_cust, n_sup, n_exp, start, end, pl_open=False):
    """ledgers {name: (parent, open_paise, master, deleted)}, vouchers [{id, date, no, type, party, opt, cancel, deleted, ent: [{l, a, b}]}] in paise"""
    R = random.Random(seed)
    L = {}
    def led(n, parent, op=0, master=True, deleted=False): L[n] = (parent, op, master, deleted); return n
    cust = [led("Customer %05d Stores" % i, "North Customers" if i % 3 == 0 else "Sundry Debtors", -R.randrange(0, 900000) * 10 if i % 4 == 0 else 0) for i in range(n_cust)]
    # a parent written in other capitals or with two spaces (ledLook finds the group by namesKey; the path keeps the variant:
    # "sundry  debtors" is not Audit.isDebtor's "sundry debtors", though its group's parent is walked)
    cust += [led("Customer %05d Lane" % i, "north customers" if i % 2 else "sundry  debtors", -R.randrange(0, 90000) * 10) for i in range(max(4, n_cust // 20))]
    sup = [led("Supplier %05d Mills" % i, "Sundry Creditors", R.randrange(0, 700000) * 10 if i % 5 == 0 else 0) for i in range(n_sup)]
    exps = [led("Expense Head %04d" % i, "Salary & Wages" if i % 7 == 0 else ("Direct Expenses" if i % 11 == 0 else "Indirect Expenses"), (-R.randrange(1, 90000) * 100 if pl_open and i % 9 == 0 else 0)) for i in range(n_exp)]
    bank = led("Kestrel Bank Current", "Bank Accounts", -250000000); od = led("Kestrel Bank OD", "Bank OD A/c", 120000000); cash = led("Cash", "Cash-in-Hand", -1500000)
    charges = led("Bank Charges", "Indirect Expenses")                     # FinCom's guess makes it a bank (Books.guess): the browser counts it in cash and bank
    s_loc, s_int = led("Sales Local", "Sales Accounts", 98765400 if pl_open else 0), led("Sales Interstate", "Sales Accounts"); pur = led("Purchase Goods", "Purchase Accounts")
    cg, sg, ig = led("Output CGST", "Duties & Taxes"), led("Output SGST", "Duties & Taxes"), led("Input IGST", "Duties & Taxes")
    intr = led("Interest Received", "Indirect Incomes"); led("Capital", "Capital Account", 300000000); led("Loan from Director", "Unsecured Loans", 50000000)
    led("Office Equipment", "Fixed Assets", -40000000)
    gone = led("Old Deposit (deleted)", "Current Assets", -333300, True, True)   # deleted in Tally: no master in the browser (TCloud.restAll: deleted_at=is.null); its entries still count
    petty = led("Petty Cash Float", "", 0, False)                          # entries, no master: no group; the guess makes it cash
    scrap = led("Sales Scrap", "", 0, False)                               # no master: profit and loss by its name
    misc = led("Suspense Unknown", "", 0, False)
    V, open_bills, adv_refs, nid = [], {}, {}, [0]
    days = (end - start).days + 1
    # old bills carried in (an opening balance settled against a bill these books never raised)
    for c in cust[::4]: open_bills.setdefault(c, []).append(["OB-" + c[-11:-7], L[c][1]])
    def vch(date, typ, party, ent, opt=False, cancel=False, deleted=False):
        nid[0] += 1
        V.append({"id": "g%07d" % nid[0], "date": date, "no": str(nid[0]), "type": typ, "party": party, "opt": opt, "cancel": cancel, "deleted": deleted, "ent": ent})
    for i in range(n_v):
        date = start + datetime.timedelta(days=R.randrange(days)); k = R.random()
        if k < 0.30:
            c = R.choice(cust); tx = R.randrange(1000, 500000) * 100; tax = tx * 18 // 100 // 2 * 2; tot = tx + tax; ref = "INV%06d" % i
            cd = R.choice([0, 0, 30, 45, 90])
            ent = [{"l": c, "a": -tot, "b": [[ref, "New Ref", -tot, cd]]}, {"l": R.choice([s_loc, s_loc, s_int]), "a": tx}, {"l": cg, "a": tax // 2}, {"l": sg, "a": tax // 2}]
            if R.random() < 0.06: ent[0]["b"] = None                        # no bill-wise details: on account
            open_bills.setdefault(c, []).append([ref, tot] if ent[0]["b"] else None)
            vch(date, "Sales", c, ent, opt=R.random() < 0.01, cancel=R.random() < 0.01, deleted=R.random() < 0.005)
        elif k < 0.50:
            c = R.choice(cust); bills = [x for x in open_bills.get(c, []) if x]
            if bills and R.random() < 0.8:
                b1 = R.choice(bills); amt = b1[1] if R.random() < 0.6 else max(100, b1[1] // R.choice([2, 3, 4]) // 100 * 100)
                al = [[b1[0], "Agst Ref", amt, 0]]
                if len(bills) > 1 and R.random() < 0.25:
                    b2 = R.choice(bills); a2 = max(100, b2[1] // 2 // 100 * 100); al.append([b2[0], "Agst Ref", a2, 0]); amt += a2
            elif R.random() < 0.5:
                amt = R.randrange(100, 300000) * 100; ref = "ADV%06d" % i; al = [[ref, "Advance", amt, 0]]
            else:
                amt = R.randrange(100, 300000) * 100; al = [["", "On Account", amt, 0]]
            vch(date, "Receipt", c, [{"l": R.choice([bank, bank, od, cash]), "a": -amt}, {"l": c, "a": amt, "b": al}], cancel=R.random() < 0.01)
        elif k < 0.65:
            s = R.choice(sup); tx = R.randrange(1000, 400000) * 100; tax = tx * 12 // 100; tot = tx + tax; ref = "B%06d" % i
            vch(date, "Purchase", s, [{"l": s, "a": tot, "b": [[ref, "New Ref", tot, R.choice([0, 60])]]}, {"l": pur, "a": -tx}, {"l": ig, "a": -tax}], opt=R.random() < 0.01)
            open_bills.setdefault(s, []).append([ref, tot])
        elif k < 0.75:
            s = R.choice(sup); bills = open_bills.get(s, [])
            if bills and R.random() < 0.75: b1 = R.choice(bills); amt = b1[1] if R.random() < 0.5 else max(100, b1[1] // 3 // 100 * 100); al = [[b1[0], "Agst Ref", -amt, 0]]
            else: amt = R.randrange(100, 200000) * 100; al = [["", "On Account", -amt, 0]] if R.random() < 0.6 else [["SADV%06d" % i, "Advance", -amt, 0]]
            vch(date, "Payment", s, [{"l": s, "a": -amt, "b": al}, {"l": R.choice([bank, bank, od]), "a": amt}], deleted=R.random() < 0.005)
        elif k < 0.92:
            e = R.choice(exps); amt = R.randrange(10, 80000) * 100
            vch(date, "Payment", "", [{"l": e, "a": -amt}, {"l": R.choice([bank, cash, petty, bank]), "a": amt}])
        elif k < 0.95:
            amt = R.randrange(10, 5000) * 100
            vch(date, "Journal", "", [{"l": charges, "a": -amt}, {"l": bank, "a": amt}] if R.random() < 0.5 else [{"l": bank, "a": -amt}, {"l": intr, "a": amt}])
        elif k < 0.97:
            amt = R.randrange(100, 100000) * 100
            vch(date, "Contra", "", [{"l": cash, "a": -amt}, {"l": bank, "a": amt}])
        else:
            amt = R.randrange(100, 50000) * 100
            vch(date, "Sales", "", [{"l": petty, "a": -amt}, {"l": scrap, "a": amt}]) if R.random() < 0.5 else vch(date, "Journal", "", [{"l": misc, "a": -amt}, {"l": R.choice(exps), "a": amt}])
    for i in range(max(3, n_v // 500)):
        amt = R.randrange(100, 9000) * 100
        vch(start + datetime.timedelta(days=R.randrange(days)), "Journal", "", [{"l": gone, "a": -amt}, {"l": misc, "a": amt}])
        # two lines of one customer, bills on one only: the other line is on account
        c = R.choice(cust); bl = [x for x in open_bills.get(c, []) if x]
        if bl:
            a1 = max(100, bl[0][1] // 2 // 100 * 100); a2 = R.randrange(100, 50000) * 100
            vch(start + datetime.timedelta(days=R.randrange(days)), "Receipt", c, [{"l": bank, "a": -(a1 + a2)}, {"l": c, "a": a1, "b": [[bl[0][0], "Agst Ref", a1, 0]]}, {"l": c, "a": a2}])
    # the old bills settled (no New Ref here: "before these books")
    for c, bl in open_bills.items():
        for x in bl:
            if x and x[0].startswith("OB-") and x[1] < 0 and R.random() < 0.7:
                amt = -x[1] // 2 // 100 * 100 or 100
                vch(start + datetime.timedelta(days=R.randrange(60)), "Receipt", c, [{"l": bank, "a": -amt}, {"l": c, "a": amt, "b": [[x[0], "Agst Ref", amt, 0]]}])
    # one entry that does not balance, late in the books (the trial balance does not total from then on)
    vch(end - datetime.timedelta(days=3), "Journal", "", [{"l": misc, "a": -500}, {"l": bank, "a": 0}])
    V.sort(key=lambda v: (v["date"], v["id"]))
    return L, V

def paise(p): return ("-" if p < 0 else "") + "%d.%02d" % divmod(abs(p), 100)

def load_book(db, B, F_, cid, L, V, start, groups=True):
    rows_l, rows_v, rows_t, rows_b = [], [], [], []
    for n, (parent, op, master, deleted) in L.items():
        # the customers under a sub-group of Sundry Debtors carry no chain (as a Zoho copy): only the groups place them
        nochain = parent == "North Customers"
        if master: rows_l.append("\t".join([B, F_, n, parent, paise(op), "\\N" if nochain else "{" + ",".join('"%s"' % g for g in chain(parent)) + "}", "Current Assets" if nochain else (chain(parent) or [""])[-1],
                                             "\\N", "2026-10-01 00:00:00+00" if deleted else "\\N"]))
    tid = int(B[-6:]) * 10**7          # ids of its own per book
    for v in V:
        rows_v.append("\t".join([B, F_, v["id"], v["date"].isoformat(), v["id"][1:], v["type"], v["no"], v["party"], "", "t" if v["cancel"] else "f", "t" if v["opt"] else "f", "2026-10-02 00:00:00+00" if v["deleted"] else "\\N"]))
        for e in v["ent"]:
            tid += 1; rows_t.append("\t".join([str(tid), B, F_, v["id"], v["date"].isoformat(), e["l"], paise(e["a"])]))
            for x in (e.get("b") or []):
                tid += 1; rows_b.append("\t".join([str(tid), B, F_, v["id"], v["date"].isoformat(), e["l"], x[0], x[1], paise(x[2]), str(x[3])]))
    s = ["insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on, days_at, ledgers_at) values (%s, %s, %s, 'Made-up Heron Traders', %s, %s, now(), now());" % (q(B), q(F_), q(cid), q(start.isoformat()), q(start.isoformat())),
         "copy tally_ledgers (book_id, firm_id, name, parent, open, chain, primary_group, merged_into, deleted_at) from stdin;", "\n".join(rows_l), "\\.",
         "copy tally_groups (book_id, firm_id, name, parent) from stdin;" if groups else "", "\n".join("\t".join([B, F_, g, pg]) for g, pg in GROUPS.items()) if groups else "", "\\." if groups else "",
         "copy tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, deleted_at) from stdin;", "\n".join(rows_v), "\\.",
         "copy tally_lines (id, book_id, firm_id, guid, day, ledger, amount) from stdin;", "\n".join(rows_t), "\\.",
         "copy tally_bills (id, book_id, firm_id, guid, day, ledger, name, type, amount, credit_days) from stdin;", "\n".join(rows_b) if rows_b else "", "\\.",
         "analyze tally_lines, tally_vouchers, tally_bills, tally_ledgers;",
         # the day totals, as tally_ledger_day_rebuild makes them (never a deleted, cancelled or optional entry)
         """insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
            select l.book_id, l.firm_id, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
              from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
             where l.book_id = %s and v.deleted_at is null and not v.cancelled and not v.optional group by 1, 2, 3, 4;""" % q(B),
         "analyze;"]
    db.sql("\n".join(s) + "\n")

def browser_books(cid, L, V, start, end, groups=True):
    """what TCloud.load reads: tally_ledgers (name, parent, open) not merged and not deleted in Tally, tally_groups, and
    the entries (a deleted one is gone from the browser's books; a cancelled or optional one is kept, marked)"""
    return {"cid": cid, "from": d8(start), "today": "20261109",
            "ledgers": [{"name": n, "parent": p, "open": op / 100} for n, (p, op, m, dl) in sorted(L.items()) if m and not dl],
            "groups": [{"name": g, "parent": pg} for g, pg in GROUPS.items()] if groups else [],
            "vouchers": [{"id": v["id"], "date": d8(v["date"]), "no": v["no"], "type": v["type"], "party": v["party"], "narr": "", "opt": v["opt"], "cancel": v["cancel"],
                          "ent": [dict({"l": e["l"], "a": e["a"] / 100}, **({"b": [[x[0], x[1], x[2] / 100, x[3]] for x in e["b"]]} if e.get("b") else {})) for e in v["ent"]]}
                         for v in V if not v["deleted"]]}

def month_ends(start, end):
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append("%04d-%02d-01" % (y, m)); m += 1
        if m > 12: m, y = 1, y + 1
    return out
def eom(m):
    y, mo = int(m[:4]), int(m[5:7]); n = datetime.date(y + (mo == 12), mo % 12 + 1, 1) - datetime.timedelta(days=1); return n
P = lambda x: None if x is None else int(round(float(x) * 100))           # to paise, for an exact comparison

def run_browser(name, books, dates, months, ageing):
    inp, out = os.path.join(SCRATCH, name + "-in.json"), os.path.join(SCRATCH, name + "-out.json")
    body = json.dumps(dict(books, dates=dates, months=months, ageing=ageing))
    key = hashlib.md5((body + open(HTML).read()).encode()).hexdigest()
    if os.path.exists(out + "." + key): return json.load(open(out + "." + key))      # the same books and engine as a run before (M151_TMP kept)
    open(inp, "w").write(body)
    env = dict(os.environ, TDSDESK_HTML=HTML)
    lock = [] if os.environ.get("M151_LOCK_HELD") == "1" else ["flock", "/tmp/fincom-app.lock"]     # the whole run under flock: not twice
    r = subprocess.run(lock + ["node", "--max-old-space-size=4096", os.path.join(HERE, "run_migration151.js"), inp, out], capture_output=True, text=True, env=env)
    if r.returncode: raise RuntimeError("the browser engine: " + (r.stderr or r.stdout)[-1500:])
    os.replace(out, out + "." + key)
    return json.load(open(out + "." + key))

STORED = {}
def store_map(db, F_, cid, m):
    # one ledger list a client (the browser keeps one: b.map, saved under the client); a second book adds its new names
    seen = STORED.setdefault((F_, cid), set())
    rows = ["\t".join([F_, cid, "map", "." + n, json.dumps({k: v for k, v in x.items() if k != "n"}).replace("\\", "\\\\"), "f"]) for n, x in m.items() if n not in seen]
    seen |= set(m)
    if not rows: return
    before = int(db.one("select count(*) from client_book_items where firm_id = %s and client_id = %s and key = 'map'" % (q(F_), q(cid))))
    if before and not STORED.get((F_, cid, "said")): print("   (%d ledger-list rows already kept for %s)" % (before, cid)); STORED[(F_, cid, "said")] = 1
    db.sql("create temp table m151_map (firm_id uuid, client_id text, key text, item text, data jsonb, deleted boolean);\n"
           "copy m151_map from stdin;\n" + "\n".join(rows) + "\n\\.\n"
           "insert into client_book_items (firm_id, client_id, key, item, data, deleted) select * from m151_map on conflict do nothing;\n")

def age_diff(W, A):
    """what differs between the browser's MIS.ageing (W) and the SQL's (A); and the parties and open bills counted"""
    bad = []
    for k in ("total", "adv", "unalloc", "pre", "tally", "open", "owe", "advance", "und", "diff"):
        if P(W["sum"].get(k)) != P(A["sum"].get(k)): bad.append(("sum." + k, W["sum"].get(k), A["sum"].get(k)))
    for k in ("b", "nb"):
        if [P(x) for x in W["sum"][k]] != [P(x) for x in A["sum"][k]]: bad.append(("sum." + k, W["sum"][k], A["sum"][k]))
    if [(z["party"], P(z["diff"])) for z in W["sum"]["differ"]] != [(z["party"], P(z["diff"])) for z in A["sum"]["differ"]]: bad.append(("sum.differ",))
    wr, gr = {p["party"]: p for p in W["rows"]}, {p["party"]: p for p in A["rows"]}
    if set(wr) != set(gr): bad.append(("parties", sorted(set(wr) ^ set(gr))[:5]))
    nb_bills = 0
    for n in wr:
        if n not in gr: continue
        w, g = wr[n], gr[n]
        for k in ("total", "adv", "unalloc", "pre", "tally", "diff", "net", "owe", "und", "advance"):
            if P(w.get(k)) != P(g.get(k)): bad.append((n, k, w.get(k), g.get(k)))
        if w.get("oldest", 0) != g.get("oldest", 0) or bool(w.get("noBills")) != bool(g.get("noBills")): bad.append((n, "oldest/noBills", w.get("oldest"), g.get("oldest")))
        for k in ("b", "nb"):
            if [P(x) for x in w[k]] != [P(x) for x in g[k]]: bad.append((n, k, w[k], g[k]))
        wo = [(x["ref"], x["date"], x.get("due", ""), x["age"], x["od"], P(x["amt"]), P(x["left"]), x.get("no", "")) for x in w.get("open", [])]
        go = [(x["ref"], x["date"], x["due"], x["age"], x["od"], P(x["amt"]), P(x["left"]), x["no"]) for x in g.get("open", [])]
        nb_bills += len(wo)
        if wo != go: bad.append((n, "open bills", wo[:2], go[:2]))
    return bad, len(wr), nb_bills

def bal_diff(want_at, got_at):
    want = {l: P(a) for l, a in want_at.items()}; got = {l: P(a) for l, a in got_at.items()}
    bad = []
    if set(want) != set(got): bad.append(("ledgers", sorted(set(want) ^ set(got))[:5]))
    diff = [(l, want[l], got.get(l)) for l in want if l in got and want[l] != got[l]]
    if diff: bad.append(diff[:3])
    return bad

def compare(db, label, B, cid, br, dates, months, ageing, now_from=None):
    # 1. balances, as rows and as one value
    got = {}
    for r in db.rows("select date, ledger, bal from tally_balances_at(%s, array[%s]::date[])" % (q(B), ",".join(q(d) for d in dates)), uid=U):
        got.setdefault(r["date"].replace("-", ""), {})[r["ledger"]] = r["bal"]
    J = json.loads(db.one("select tally_balances_json(%s, array[%s]::date[])::text" % (q(B), ",".join(q(d) for d in dates)), uid=U))
    bad = []
    for d in dates:
        w = br["bal"][d.replace("-", "")]
        bad += [(d, "rows") + tuple(x) for x in bal_diff(w, got.get(d.replace("-", ""), {}))] + [(d, "json") + tuple(x) for x in bal_diff(w, J.get(d.replace("-", ""), {}))]
    led = br["bal"][dates[-1].replace("-", "")]
    ok(not bad, "%s 1. tally_balances_at and tally_balances_json = Audit.balances().at(d) on %d dates, %d ledgers each (%s)" % (label, len(dates), len(led), bad[:3]))
    # 2. tie-out (each month from the book of its month-end)
    TT = json.loads(db.one("select tally_tieout(%s, array[%s])::text" % (q(cid), ",".join(q(m) for m in months)), uid=U)); T = TT["months"]
    bad, nulls = [], {}
    for m in months:
        w, g = br["tie"][m], T.get(m, {})
        if TT["books"].get(m) != B: bad.append((m, "book", TT["books"].get(m)))
        for k in ("receivables", "payables", "cash_bank", "profit", "tb_total"):
            if P(w.get(k)) != P(g.get(k)): bad.append((m, k, w.get(k), g.get(k)))
            if w.get(k) is None: nulls[k] = nulls.get(k, 0) + 1
    ok(not bad, "%s 2. tally_tieout = Rec.fincom at %d month-ends, five figures each, from this book (none where the browser gives none: %s) %s" % (label, len(months), nulls, bad[:4]))
    # 3. ageing; 3b. tally_now on the same day
    for d in ageing:
        for side in ("r", "p"):
            A = json.loads(db.one("select tally_ageing(%s, %s, %s)::text" % (q(cid), q(d), q(side)), uid=U))
            bad, np_, nb = age_diff(br["age"][d.replace("-", "")][side], A)
            if A.get("book") != B: bad.append(("book", A.get("book")))
            ok(not bad and np_ > 0, "%s 3. tally_ageing %s on %s = MIS.ageing: %d parties, %d open bills, owed %s, not bill-wise %s (%s)" % (label, side, d, np_, nb, A["sum"]["owe"], A["sum"]["und"], bad[:3]))
        f = now_from or months[0]
        N = json.loads(db.one("select tally_now(%s, %s, %s)::text" % (q(cid), q(f), q(d)), uid=U)); W = br["now"][d.replace("-", "")]
        bad = []
        if N.get("book") != B: bad.append(("book", N.get("book")))
        for side, k in (("r", "recv"), ("p", "pay")): bad += [(k,) + tuple(x) for x in age_diff(br["age"][d.replace("-", "")][side], N[k])[0]]
        bad += [("at",) + tuple(x) for x in bal_diff(br["bal"].get(d.replace("-", ""), {}), N["balances"]["at"])] if d.replace("-", "") in br["bal"] else []
        if {k: P(v) for k, v in (W["owed"] or {}).items()} != {k: P(v) for k, v in N["owed"].items()}: bad.append(("owed", W["owed"], N["owed"]))
        for k in ("cash", "bank"):
            if [(l, P(v)) for l, v in W[k]] != [(l, P(v)) for l, v in N["balances"][k]]: bad.append((k, W[k][:3], N["balances"][k][:3]))
        ok(not bad, "%s 3b. tally_now %s..%s = MIS.runNow's: both ageings, owed %s, %d cash and %d bank ledgers, %d balances (%s)" % (label, f, d, N["owed"], len(N["balances"]["cash"]), len(N["balances"]["bank"]), len(N["balances"]["at"]), bad[:3]))

def timing(db, B, cid, dates, months, d):
    db.sql("""create or replace function t_ms(p text) returns numeric language plpgsql as $$ declare t timestamptz := clock_timestamp(); n bigint; begin execute p into n; return round(extract(epoch from clock_timestamp() - t) * 1000, 1); end $$;""")
    asks = {"tally_balances_at (%d dates)" % len(dates): "select count(*) from tally_calc_bal(%s, array[%s]::date[])" % (q(B), ",".join(q(x) for x in dates)),
            "tally_balances_at (1 date)": "select count(*) from tally_calc_bal(%s, array[%s]::date[])" % (q(B), q(dates[-1])),
            "tally_tieout (%d months)" % len(months): "select count(*) from jsonb_object_keys(tally_calc_tieout(%s, array[%s]))" % (q(B), ",".join(q(m) for m in months)),
            "tally_tieout (1 month)": "select count(*) from jsonb_object_keys(tally_calc_tieout(%s, array[%s]))" % (q(B), q(months[-1])),
            "tally_ageing r": "select length(tally_calc_ageing(%s, %s, 'r')::text)" % (q(B), q(d)),
            "tally_ageing p": "select length(tally_calc_ageing(%s, %s, 'p')::text)" % (q(B), q(d)),
            "tally_now (%d months, worked out)" % (len(months) - 1): "select length(tally_now(%s, %s, %s)::text)" % (q(cid), q(months[1]), q(d)),
            "tally_calc_version": "select length(tally_calc_version(%s))" % q(B)}
    res = {}
    for k, s in asks.items():
        v = sorted(float(db.one("select t_ms(%s)" % q(s), uid=U)) for _ in range(5))
        res[k] = v[2]                                                     # the median of five
    # the same asked once kept (as mis-run keeps it): the kept answer back
    db.sql("select tally_calc_put(%s, 'mis-now.2', %s, tally_calc_version(%s), tally_now(%s, %s, %s)::jsonb)" % (q(B), q(months[1].replace("-", "") + "|" + d.replace("-", "")), q(B), q(cid), q(months[1]), q(d)), uid=U)
    v = sorted(float(db.one("select t_ms(%s)" % q("select length(tally_now(%s, %s, %s)::text)" % (q(cid), q(months[1]), q(d))), uid=U)) for _ in range(5))
    res["tally_now (kept)"] = v[2]
    return res

# the test page: build.py's own assembly, into the scratch folder (site/ and site-test/ are not touched)
import build
HTML = os.path.join(SCRATCH, "index-m151.html")
open(HTML, "w").write(build.assemble())

# M151_ONLY=e2e: only section 6 (the real handler end to end on the 40,000-entry book, against the browser's figures)
E2E = os.environ.get("M151_ONLY") == "e2e"
class E2EDone(Exception): pass
db = pg_stand.start(int(os.environ.get("PG151_PORT") or 31151))
try:
    db.sql("""
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
    alter table tally_ledgers add column if not exists deleted_at timestamptz;
    alter table tally_ledger_day add column if not exists merged_into text;
    alter table tally_vouchers add column if not exists deleted_at timestamptz;
    alter table tally_lines add column if not exists id bigint;
    create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text, type text, amount numeric, bill_date date, credit_days integer, due date, id bigint primary key);
    create index if not exists tally_bills_book_guid on tally_bills (book_id, guid);
    create index if not exists tally_bills_book_party on tally_bills (book_id, ledger, name);
    create index if not exists tally_lines_book_day on tally_lines (book_id, day);
    create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));
    alter database postgres set jit = off;
    grant select on members to authenticated; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into firms values (%s, 'Made-up Firm A'), (%s, 'Made-up Firm B');
    insert into members (user_id, firm_id, name, role) values (%s, %s, 'Made-up Owner', 'owner'), (%s, %s, 'Made-up Other', 'owner');
    """ % (q(F), q(F2), q(U), q(F), q(U2), q(F2)))
    db.sql(text); first = db.one("select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p where p.proname in (%s)" % ",".join(q(x) for x in made))
    db.sql(text)
    ok(db.one("select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p where p.proname in (%s)" % ",".join(q(x) for x in made)) == first, "0. runs twice: the same functions")
    acl = {r["proname"]: r["acl"] for r in db.rows("select proname, proacl::text as acl from pg_proc where proname in (%s)" % ",".join(q(x) for x in made))}
    ok(all("anon" not in acl[f] and "authenticated" not in acl[f] and "service_role=X" in acl[f] for f in SVC) and all("anon" not in acl[f] and "authenticated=X" in acl[f] for f in MEM)
       and all(not re.search(r"(^|[{,])=X", acl[f]) for f in made), "0. execute rights as declared")

    for label, seed, n_v, n_c, n_s, n_e, start, end, timed in (("small", 151, 2500, 60, 40, 30, datetime.date(2025, 5, 1), datetime.date(2026, 10, 31), False),
                                                                ("40k", 40151, 40000, 4000, 3000, 2950, datetime.date(2025, 5, 1), datetime.date(2026, 10, 31), True)):
        if E2E and not timed: continue          # M151_ONLY=e2e: the 40,000-entry book's end-to-end section alone
        B, cid = "b1510000-0000-0000-0000-%012d" % seed, "client-%d" % seed
        t0 = time.time(); L, V = make_book(seed, n_v, n_c, n_s, n_e, start, end)
        months = month_ends(start, end); dates = [eom(m).isoformat() for m in months] + ["2025-05-01", "2025-08-17", "2026-03-31", "2026-04-01", "2026-10-30"]
        dates = sorted(set(dates)); ageing = ["2025-09-30", "2026-03-31", "2026-10-31"]
        load_book(db, B, F, cid, L, V, start)
        nlines = int(db.one("select count(*) from tally_lines where book_id = %s" % q(B)))
        print("== %s: %d entries (%d ledgers, %d lines, %d bills) made and loaded in %.1f s" % (label, len(V), len(L), nlines, int(db.one("select count(*) from tally_bills where book_id = %s" % q(B))), time.time() - t0))
        t0 = time.time()
        br = run_browser(label, browser_books(cid, L, V, start, end), [d.replace("-", "") for d in dates], months, [d.replace("-", "") for d in ageing])
        print("   the browser's engine in Node: %.1f s (balances %d ms, tie-out %d ms, ageing %d ms)" % (time.time() - t0, br["ms"]["balances"], br["ms"]["tieout"], br["ms"]["ageing"]))
        store_map(db, F, cid, br["map"])
        if not E2E: compare(db, label, B, cid, br, dates, months, ageing)
        if timed and DENO:
            # 6. the real handler, end to end, on this book
            outp = os.path.join(SCRATCH, "now-pg.json")
            r = subprocess.run([DENO, "test", "-A", "--no-lock", os.path.join(ROOT, "server", "mis-run", "now_pg_test.ts")], cwd=ROOT, capture_output=True, text=True, timeout=900,
                               env=dict(os.environ, NO_COLOR="1", NOW_PG="|".join([str(db.port), U, cid, "20250501", "20261031", outp])))
            if r.returncode or not os.path.exists(outp): ok(False, "6. mis-run now end to end: %s" % (r.stdout + r.stderr)[-1200:])
            else:
                E = json.load(open(outp)); R0 = E["first"]["result"]
                bad = [("at",) + tuple(x) for x in bal_diff(br["bal"]["20261031"], R0["balances"]["at"])]
                for side, k in (("r", "recv"), ("p", "pay")): bad += [(k,) + tuple(x) for x in age_diff(br["age"]["20261031"][side], R0[k])[0]]
                # next-cloud-calc2: the handler also asks migration 152's parts (tally_mis_part), not in this database: they are
                # left to the browser, the answer is partial, and a partial answer is never kept (worked out again when asked)
                calls = [c for c in E["calls"] if c != "tally_mis_part"]
                part = bool(R0.get("partial"))
                kept_rows = int(db.one("select count(*) from tally_calc_results where book_id = %s and kind = 'mis-now.2'" % q(B)))
                ok(not bad and calls == (["tally_now", "tally_now"] if part else ["tally_now", "tally_calc_put", "tally_now"]) and (kept_rows == 0) == part,
                   "6. mis-run now end to end: %d balances (one value, not 1,000 rows), both ageings as the browser's; %d ms, asked again: %s, %d ms (%s %s)"
                   % (len(R0["balances"]["at"]), E["firstMs"], "partial (152 not here), not kept: %d kept rows" % kept_rows if part else "kept", E["secondMs"], calls, bad[:2]))
        elif timed: print("   6. skipped: no deno (DENO=... or on PATH)")
        if E2E: raise E2EDone()
        if timed:
            T = timing(db, B, cid, dates, months, ageing[-1])
            for k, v in T.items(): print("   %-34s %8.1f ms" % (k, v))
            ok(all(v < 1000 for v in T.values()), "5. every function under 1 s on %d entries / %d ledgers (median of five; slowest %.0f ms)" % (len(V), len(L), max(T.values())))
            tn = [v for k, v in T.items() if k.startswith("tally_now (") and "kept" not in k][0]
            ok(tn < 800, "5. tally_now under 0.8 s (median of five: %.0f ms)" % tn)

    # 4. members and the kept answers
    B, cid = "b1510000-0000-0000-0000-%012d" % 151, "client-151"
    try:
        db.sql("select * from tally_balances_at(%s, array['2026-03-31']::date[])" % q(B), uid=U2); ok(False, "4. another firm's member refused balances")
    except RuntimeError as e: ok("not a company of your firm" in str(e), "4. another firm's member refused balances")
    ok(json.loads(db.one("select tally_tieout(%s, array['2026-03-01'])::text" % q(cid), uid=U2)).get("none") is True, "4. another firm's member: no tie-out (no such client in its firm)")
    ok(json.loads(db.one("select tally_ageing(%s, '2026-03-31', 'r')::text" % q(cid), uid=U2)).get("none") is True, "4. another firm's member: no ageing")
    c0 = json.loads(db.one("select tally_calc_cached(%s, null, 'mis-now', '20260401|20261031')::text" % q(cid), uid=U))
    ok(c0.get("result") is None and c0.get("version"), "4. nothing kept yet")
    db.sql("select tally_calc_put(%s, 'mis-now', '20260401|20261031', %s, '{\"x\": 1}'::jsonb, 12)" % (q(B), q(c0["version"])))
    c1 = json.loads(db.one("select tally_calc_cached(%s, null, 'mis-now', '20260401|20261031')::text" % q(cid), uid=U))
    ok(c1.get("result") == {"x": 1}, "4. kept: given back while the book is the same")
    ok(db.one("select count(*) from pg_policies where tablename = 'tally_calc_results' and policyname = 'tally_calc_results_read' and qual like '%my_firm()%'") == "1", "4. the read policy is the firm's own")
    for what, s in (("a new entry the bridge sent", "insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional) values (%s, %s, 'gnew', '2026-10-31', 9999999, 'Journal', 'x', '', '', false, false)" % (q(B), q(F))),
                    ("an entry deleted", "update tally_vouchers set deleted_at = now() where book_id = %s and guid = 'gnew'" % q(B)),
                    ("FinCom's ledger list changed", "update client_book_items set seq = seq + 1, updated_at = now() + interval '1 second' where client_id = %s and item = '.Bank Charges'" % q(cid)),
                    ("a day read again", "update tally_books set days_at = now() + interval '1 minute' where book_id = %s" % q(B))):
        before = db.one("select tally_calc_version(%s)" % q(B)); db.sql(s)
        c = json.loads(db.one("select tally_calc_cached(%s, null, 'mis-now', '20260401|20261031')::text" % q(cid), uid=U))
        ok(c["version"] != before and c.get("result") is None, "4. %s: the version moves, the kept answer is not used" % what)
        db.sql("select tally_calc_put(%s, 'mis-now', '20260401|20261031', %s, '{\"x\": 1}'::jsonb)" % (q(B), q(c["version"])))
    for what, s in (("a ledger renamed (masters, lines, bills, day totals)", """update tally_ledgers set name = 'Cash Box' where book_id = %(b)s and name = 'Cash';
                         update tally_lines set ledger = 'Cash Box' where book_id = %(b)s and ledger = 'Cash'; update tally_ledger_day set ledger = 'Cash Box' where book_id = %(b)s and ledger = 'Cash';""" % {"b": q(B)}),
                    ("a ledger carried (lines, bills, day totals only)", """update tally_lines set ledger = 'Customer 00001 Stores' where book_id = %(b)s and ledger = 'Customer 00002 Stores';
                         update tally_bills set ledger = 'Customer 00001 Stores' where book_id = %(b)s and ledger = 'Customer 00002 Stores';
                         insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) select book_id, firm_id, 'Customer 00001 Stores', day, amount, dr, cr, n from tally_ledger_day where book_id = %(b)s and ledger = 'Customer 00002 Stores'
                           on conflict (book_id, ledger, day) do update set amount = tally_ledger_day.amount + excluded.amount;
                         update tally_ledger_day set merged_into = 'Customer 00001 Stores', amount = 0 where book_id = %(b)s and ledger = 'Customer 00002 Stores';""" % {"b": q(B)})):
        before = db.one("select tally_calc_version(%s)" % q(B)); db.sql(s)
        c = json.loads(db.one("select tally_calc_cached(%s, null, 'mis-now', '20260401|20261031')::text" % q(cid), uid=U))
        ok(c["version"] != before and c.get("result") is None, "4. %s: the version moves, the kept answer is not used" % what)
    for what, s, w in (("401 dates", "select count(*) from tally_calc_bal(%s, (select array_agg(d::date) from generate_series(date '2025-01-01', date '2025-01-01' + 400, interval '1 day') d))" % q(B), "at most 400 dates"),
                       ("121 months (server tieout)", "select tally_calc_tieout(%s, (select array_agg(to_char(d, 'YYYY-MM-DD')) from generate_series(date '2016-01-01', date '2026-01-01', interval '1 month') d))" % q(B), "at most 120 months"),
                       ("25 months (member tieout)", "select tally_tieout(%s, (select array_agg(to_char(d, 'YYYY-MM-DD')) from generate_series(date '2024-01-01', date '2026-01-01', interval '1 month') d))" % q(cid), "at most 24 months"),
                       ("32 dates (member rows)", "select count(*) from tally_balances_at(%s, (select array_agg(d::date) from generate_series(date '2025-06-01', date '2025-06-01' + 31, interval '1 day') d))" % q(B), "at most 31 dates"),
                       ("32 dates (member json)", "select tally_balances_json(%s, (select array_agg(d::date) from generate_series(date '2025-06-01', date '2025-06-01' + 31, interval '1 day') d))" % q(B), "at most 31 dates"),
                       ("121 months (now)", "select tally_now(%s, '2016-01-01', '2026-01-31')" % q(cid), "at most 120 months")):
        try: db.sql(s, uid=U); ok(False, "4. limit: %s refused" % what)
        except RuntimeError as e: ok(w in str(e), "4. limit: %s refused" % what)
    ok(db.one("select count(*) from tally_calc_bal(%s, (select array_agg(d::date) from generate_series(date '2025-05-01', date '2025-05-01' + 399, interval '1 day') d))" % q(B)) not in (None, "0"), "4. limit: 400 dates worked out (the server)")
    ok(db.one("select count(*) from tally_balances_at(%s, (select array_agg(d::date) from generate_series(date '2025-05-01', date '2025-05-01' + 30, interval '1 day') d))" % q(B), uid=U) not in (None, "0"), "4. limit: 31 dates worked out (a member)")
    # 8. another firm's member, and anon
    ok(json.loads(db.one("select tally_now(%s, '2026-04-01', '2026-10-31')::text" % q(cid), uid=U2)).get("none") is True, "8. another firm's member: tally_now gives nothing")
    ok(json.loads(db.one("select tally_calc_cached(%s, null, 'mis-now', '20260401|20261031')::text" % q(cid), uid=U2)).get("none") is True, "8. another firm's member: tally_calc_cached gives nothing")
    try: db.sql("select tally_balances_json(%s, array['2026-03-31']::date[])" % q(B), uid=U2); ok(False, "8. another firm's member refused tally_balances_json")
    except RuntimeError as e: ok("not a company of your firm" in str(e), "8. another firm's member refused tally_balances_json")
    n_own = db.one("set role authenticated; select count(*) from tally_calc_results;", uid=U); n_other = db.one("set role authenticated; select count(*) from tally_calc_results;", uid=U2)
    ok(n_own not in (None, "0") and n_other == "0", "8. tally_calc_results as a member: its own firm's %s rows; another firm's member: %s" % (n_own, n_other))
    for what, s in (("tally_now", "select tally_now(%s, '2026-04-01', '2026-10-31')" % q(cid)), ("tally_balances_json", "select tally_balances_json(%s, array['2026-03-31']::date[])" % q(B)),
                    ("tally_calc_cached", "select tally_calc_cached(%s, null, 'mis-now', 'x')" % q(cid)), ("tally_calc_results", "select count(*) from tally_calc_results"),
                    ("tally_calc_put", "select tally_calc_put(%s, 'k', 'a', 'v', '{}'::jsonb)" % q(B)), ("tally_calc_ageing_sides", "select count(*) from tally_calc_ageing_sides(%s, '2026-03-31', 'r', '{}'::jsonb)" % q(B))):
        try: db.sql("set role anon; " + s + ";"); ok(False, "8. anon refused %s" % what)
        except RuntimeError as e: ok("permission denied" in str(e), "8. anon refused %s" % what)
    try: db.sql("set role authenticated; select tally_calc_put(%s, 'k', 'a', 'v', '{}'::jsonb);" % q(B), uid=U); ok(False, "8. a member may not keep answers (tally_calc_put)")
    except RuntimeError as e: ok("permission denied" in str(e), "8. a member may not keep answers (tally_calc_put)")
    ok(db.one("select count(*) from pg_policies where tablename = 'tally_calc_results'") == "1", "0. the second run left the one policy, as written")

    # 7. a book with no groups read
    B, cid = "b1510000-0000-0000-0000-000000007151", "client-nogroups"
    start, end = datetime.date(2025, 4, 1), datetime.date(2026, 3, 31)
    L, V = make_book(7151, 1500, 50, 30, 30, start, end)
    load_book(db, B, F, cid, L, V, start, groups=False)
    months = month_ends(start, end); dates = sorted(set([eom(m).isoformat() for m in months])); ageing = ["2025-10-31", "2026-03-31"]
    brn = run_browser("nogroups", browser_books(cid, L, V, start, end, groups=False), [d.replace("-", "") for d in dates], months, [d.replace("-", "") for d in ageing])
    store_map(db, F, cid, brn["map"])
    compare(db, "7. no groups", B, cid, brn, dates, months, ageing, now_from=start.isoformat())
    direct = sum(1 for n, x in L.items() if x[2] and not x[3] and x[0] == "Sundry Debtors")
    got = len(json.loads(db.one("select tally_ageing(%s, '2026-03-31', 'r')::text" % q(cid), uid=U))["rows"])
    ok(0 < got <= direct < sum(1 for n in L if n.startswith("Customer")), "7. no groups: the customers are only those directly under Sundry Debtors (%d parties of %d directly there)" % (got, direct))

    # 4b. one client, two books: 2025-26 and 2026-27 (its profit and loss openings carried to Profit & Loss A/c)
    cid = "client-fy"
    books = (("b1510000-0000-0000-0000-000000025151", 25151, datetime.date(2025, 4, 1), datetime.date(2026, 3, 31), False),
             ("b1510000-0000-0000-0000-000000026151", 26151, datetime.date(2026, 4, 1), datetime.date(2026, 10, 31), True))
    BR, MONTHS = {}, {}
    for B, seed, start, end, plo in books:
        L, V = make_book(seed, 1500, 50, 30, 30, start, end, pl_open=plo)
        load_book(db, B, F, cid, L, V, start)
        months = month_ends(start, end); MONTHS[B] = months
        dates = sorted(set([eom(m).isoformat() for m in months])); ageing = [eom(months[len(months) // 2]).isoformat(), eom(months[-1]).isoformat()]
        BR[B] = run_browser("fy%d" % seed, browser_books(cid, L, V, start, end), [d.replace("-", "") for d in dates], months, [d.replace("-", "") for d in ageing])
        store_map(db, F, cid, BR[B]["map"])
    for B, seed, start, end, plo in books:
        # the browser on this book alone; the SQL picks the book by the period
        months = MONTHS[B]; dates = sorted(set([eom(m).isoformat() for m in months])); ageing = [eom(months[len(months) // 2]).isoformat(), eom(months[-1]).isoformat()]
        if plo: ok(BR[B]["plOpen"] not in (None, 0), "4b. the 2026-27 copy starts on 1 April: TallyRead.yearOpen carried %s to Profit & Loss A/c" % BR[B]["plOpen"])
        compare(db, "fy%d" % seed, B, cid, BR[B], dates, months, ageing, now_from=start.isoformat())
    TT = json.loads(db.one("select tally_tieout(%s, array[%s])::text" % (q(cid), ",".join(q(m) for m in MONTHS[books[0][0]] + MONTHS[books[1][0]])), uid=U))
    ok(all(TT["books"][m] == B for B in MONTHS for m in MONTHS[B]) and all(P(TT["months"][m]["tb_total"]) == P(BR[B]["tie"][m]["tb_total"]) and P(TT["months"][m]["profit"]) == P(BR[B]["tie"][m]["profit"]) for B in MONTHS for m in MONTHS[B]),
       "4b. one tie-out over both years: each month from its own book, as the browser on that book")
except E2EDone:
    pass
except RuntimeError as e:
    ok(False, "the run: %s" % str(e)[-1500:])
finally:
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
