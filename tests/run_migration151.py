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
  1. tally_balances_at = Audit.balances().at(d) at every month-end and a few odd days: the same ledgers, every balance to
     the paisa (cancelled, optional and deleted entries left out; a ledger with entries and no master; a deleted master)
  2. tally_tieout = Rec.fincom at every month-end: receivables, payables, cash and bank, profit (none before the books
     begin in that year), trial balance total (with the opening difference line; none once an entry does not balance)
  3. tally_ageing = MIS.ageing, receivables and payables, on several days: every party's total, buckets, advances, on
     account, older bills, oldest, ledger balance and difference, net, not bill-wise, open bills one by one; the sums
  4. members: another firm's member is refused / sees nothing; the kept answers (tally_calc_put, tally_calc_cached) are
     used only while the book's version is the same, and a new entry, a deletion or a changed ledger list moves it
  5. timings on the 40,000-entry book (best of three; the target: under 1 s each)"""
import os, re, sys, json, hashlib, random, subprocess, datetime, time, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE); sys.path.insert(0, ROOT)
import pg_stand, csv
csv.field_size_limit(1 << 30)           # an ageing of 4,000 parties is one large answer
M151 = os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")
SCRATCH = os.environ.get("M151_TMP") or tempfile.mkdtemp(prefix="m151-")
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
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and not re.search(r"\balter\s+table\s+(?!public\.tally_calc_results\s+enable)", code), "add-only: nothing dropped, deleted, truncated; no other table altered")
ok("create table if not exists public.tally_calc_results" in code and "alter table public.tally_calc_results enable row level security" in code, "the new table, RLS on")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
SVC = {"tally_calc_led": "(uuid)", "tally_calc_bal": "(uuid, date[])", "tally_calc_tieout": "(uuid, text[])", "tally_calc_ageing": "(uuid, date, text)", "tally_calc_version": "(uuid)", "tally_calc_put": "(uuid, text, text, text, jsonb, integer)"}
MEM = {"tally_balances_at": "(uuid, date[])", "tally_tieout": "(text, text[])", "tally_ageing": "(text, date, text)", "tally_calc_cached": "(text, date, text, text)"}
for fn, sig in SVC.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only" % fn)
for fn, sig in MEM.items():
    ok(("revoke all on function public.%s%s from public, anon;" % (fn, sig)) in text and ("grant execute on function public.%s%s to authenticated, service_role;" % (fn, sig)) in text, "%s: members" % fn)
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == sorted(list(SVC) + list(MEM)), "adds only %s" % made)
old = set()
for d in ("server/tally-cloud", "server/security", "server/mis-run"):
    for f in os.listdir(os.path.join(ROOT, d)):
        if f.endswith(".sql") and "151" not in f: old |= set(re.findall(r"create or replace function public\.(\w+)\(", open(os.path.join(ROOT, d, f)).read().lower()))
ok(not (set(made) & old), "no existing function replaced (%s)" % sorted(set(made) & old))

# ------------------------------------------------------------------------------------------------ the made-up books
F, F2 = "99999999-9999-9999-9999-999999999151", "88888888-8888-8888-8888-888888888151"
U, U2 = "55555555-5555-5555-5555-555555555151", "66666666-6666-6666-6666-666666666151"
GROUPS = {"Current Assets": "", "Current Liabilities": "", "Sales Accounts": "", "Purchase Accounts": "", "Indirect Expenses": "", "Direct Expenses": "", "Indirect Incomes": "",
          "Capital Account": "", "Fixed Assets": "", "Loans (Liability)": "", "Sundry Debtors": "Current Assets", "North Customers": "Sundry Debtors", "Sundry Creditors": "Current Liabilities",
          "Bank Accounts": "Current Assets", "Cash-in-Hand": "Current Assets", "Duties & Taxes": "Current Liabilities", "Unsecured Loans": "Loans (Liability)", "Bank OD A/c": "Loans (Liability)",
          "Salary & Wages": "Indirect Expenses"}
def chain(parent):
    out, p = [], parent
    while p and len(out) < 15: out.append(p); p = GROUPS.get(p, "")
    return out
def d8(d): return d.strftime("%Y%m%d")

def make_book(seed, n_v, n_cust, n_sup, n_exp, start, end):
    """ledgers {name: (parent, open_paise, master, deleted)}, vouchers [{id, date, no, type, party, opt, cancel, deleted, ent: [{l, a, b}]}] in paise"""
    R = random.Random(seed)
    L = {}
    def led(n, parent, op=0, master=True, deleted=False): L[n] = (parent, op, master, deleted); return n
    cust = [led("Customer %05d Stores" % i, "North Customers" if i % 3 == 0 else "Sundry Debtors", -R.randrange(0, 900000) * 10 if i % 4 == 0 else 0) for i in range(n_cust)]
    sup = [led("Supplier %05d Mills" % i, "Sundry Creditors", R.randrange(0, 700000) * 10 if i % 5 == 0 else 0) for i in range(n_sup)]
    exps = [led("Expense Head %04d" % i, "Salary & Wages" if i % 7 == 0 else ("Direct Expenses" if i % 11 == 0 else "Indirect Expenses")) for i in range(n_exp)]
    bank = led("Kestrel Bank Current", "Bank Accounts", -250000000); od = led("Kestrel Bank OD", "Bank OD A/c", 120000000); cash = led("Cash", "Cash-in-Hand", -1500000)
    charges = led("Bank Charges", "Indirect Expenses")                     # FinCom's guess makes it a bank (Books.guess): the browser counts it in cash and bank
    s_loc, s_int = led("Sales Local", "Sales Accounts"), led("Sales Interstate", "Sales Accounts"); pur = led("Purchase Goods", "Purchase Accounts")
    cg, sg, ig = led("Output CGST", "Duties & Taxes"), led("Output SGST", "Duties & Taxes"), led("Input IGST", "Duties & Taxes")
    intr = led("Interest Received", "Indirect Incomes"); led("Capital", "Capital Account", 300000000); led("Loan from Director", "Unsecured Loans", 50000000)
    led("Office Equipment", "Fixed Assets", -40000000)
    led("Old Deposit (deleted)", "Current Assets", -333300, True, True)    # a master deleted in Tally: still in the browser's balances (TCloud.load reads merged_into only)
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

def load_book(db, B, F_, cid, L, V, start):
    rows_l, rows_v, rows_t, rows_b = [], [], [], []
    for n, (parent, op, master, deleted) in L.items():
        if master: rows_l.append("\t".join([B, F_, n, parent, paise(op), "{" + ",".join('"%s"' % g for g in chain(parent)) + "}", (chain(parent) or [""])[-1], "\\N", "2026-10-01 00:00:00+00" if deleted else "\\N"]))
    tid = int(B[-6:]) * 10**7          # ids of its own per book
    for v in V:
        rows_v.append("\t".join([B, F_, v["id"], v["date"].isoformat(), v["id"][1:], v["type"], v["no"], v["party"], "", "t" if v["cancel"] else "f", "t" if v["opt"] else "f", "2026-10-02 00:00:00+00" if v["deleted"] else "\\N"]))
        for e in v["ent"]:
            tid += 1; rows_t.append("\t".join([str(tid), B, F_, v["id"], v["date"].isoformat(), e["l"], paise(e["a"])]))
            for x in (e.get("b") or []):
                tid += 1; rows_b.append("\t".join([str(tid), B, F_, v["id"], v["date"].isoformat(), e["l"], x[0], x[1], paise(x[2]), str(x[3])]))
    s = ["insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on, days_at, ledgers_at) values (%s, %s, %s, 'Made-up Heron Traders', %s, %s, now(), now());" % (q(B), q(F_), q(cid), q(start.isoformat()), q(start.isoformat())),
         "copy tally_ledgers (book_id, firm_id, name, parent, open, chain, primary_group, merged_into, deleted_at) from stdin;", "\n".join(rows_l), "\\.",
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

def browser_books(cid, L, V, start, end):
    return {"cid": cid, "meta": {"from": d8(start), "to": d8(end), "company": "Made-up Heron Traders"},
            "tb": {"from": d8(start), "to": d8(end), "at": "2026-11-01T00:00:00Z", "src": "copy", "led": {n: {"open": op / 100, "close": ""} for n, (p, op, m, dl) in L.items() if m}},
            "under": {n: p for n, (p, op, m, dl) in L.items() if m and p}, "groups": dict(GROUPS),
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
    body = json.dumps({"books": books, "dates": dates, "months": months, "ageing": ageing})
    key = hashlib.md5((body + open(HTML).read()).encode()).hexdigest()
    if os.path.exists(out + "." + key): return json.load(open(out + "." + key))      # the same books and engine as a run before (M151_TMP kept)
    open(inp, "w").write(body)
    env = dict(os.environ, TDSDESK_HTML=HTML)
    r = subprocess.run(["flock", "/tmp/fincom-app.lock", "node", "--max-old-space-size=4096", os.path.join(HERE, "run_migration151.js"), inp, out], capture_output=True, text=True, env=env)
    if r.returncode: raise RuntimeError("the browser engine: " + (r.stderr or r.stdout)[-1500:])
    os.replace(out, out + "." + key)
    return json.load(open(out + "." + key))

def store_map(db, F_, cid, m):
    rows = ["\t".join([F_, cid, "map", "." + n, json.dumps({k: v for k, v in x.items() if k != "n"}).replace("\\", "\\\\"), "f"]) for n, x in m.items()]
    db.sql("copy client_book_items (firm_id, client_id, key, item, data, deleted) from stdin;\n" + "\n".join(rows) + "\n\\.\n")

def compare(db, label, B, cid, br, dates, months, ageing):
    # 1. balances
    got = {}
    for r in db.rows("select date, ledger, bal from tally_balances_at(%s, array[%s]::date[])" % (q(B), ",".join(q(d) for d in dates)), uid=U):
        got.setdefault(r["date"].replace("-", ""), {})[r["ledger"]] = P(r["bal"])
    bad = []
    for d in dates:
        want = {l: P(a) for l, a in br["bal"][d.replace("-", "")].items()}
        g = got.get(d.replace("-", ""), {})
        if set(want) != set(g): bad.append((d, "ledgers", sorted(set(want) ^ set(g))[:5]))
        diff = [(l, want[l], g.get(l)) for l in want if l in g and want[l] != g[l]]
        if diff: bad.append((d, diff[:3]))
    ok(not bad, "%s 1. tally_balances_at = Audit.balances().at(d) on %d dates, %d ledgers each (%s)" % (label, len(dates), len(br["bal"][dates[-1].replace("-", "")]), bad[:3]))
    # 2. tie-out
    T = json.loads(db.one("select tally_tieout(%s, array[%s])::text" % (q(cid), ",".join(q(m) for m in months)), uid=U))["months"]
    bad, nulls = [], {}
    for m in months:
        w, g = br["tie"][m], T.get(m, {})
        for k in ("receivables", "payables", "cash_bank", "profit", "tb_total"):
            if P(w.get(k)) != P(g.get(k)): bad.append((m, k, w.get(k), g.get(k)))
            if w.get(k) is None: nulls[k] = nulls.get(k, 0) + 1
    ok(not bad, "%s 2. tally_tieout = Rec.fincom at %d month-ends, five figures each (none where the browser gives none: %s) %s" % (label, len(months), nulls, bad[:4]))
    # 3. ageing
    for d in ageing:
        for side in ("r", "p"):
            A = json.loads(db.one("select tally_ageing(%s, %s, %s)::text" % (q(cid), q(d), q(side)), uid=U)); W = br["age"][d.replace("-", "")][side]
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
            ok(not bad and len(wr) > 0, "%s 3. tally_ageing %s on %s = MIS.ageing: %d parties, %d open bills, owed %s, not bill-wise %s (%s)" % (label, side, d, len(wr), nb_bills, A["sum"]["owe"], A["sum"]["und"], bad[:3]))

def timing(db, B, cid, dates, months, d):
    db.sql("""create or replace function t_ms(p text) returns numeric language plpgsql as $$ declare t timestamptz := clock_timestamp(); n bigint; begin execute p into n; return round(extract(epoch from clock_timestamp() - t) * 1000, 1); end $$;""")
    asks = {"tally_balances_at (%d dates)" % len(dates): "select count(*) from tally_calc_bal(%s, array[%s]::date[])" % (q(B), ",".join(q(x) for x in dates)),
            "tally_balances_at (1 date)": "select count(*) from tally_calc_bal(%s, array[%s]::date[])" % (q(B), q(dates[-1])),
            "tally_tieout (%d months)" % len(months): "select count(*) from jsonb_object_keys(tally_calc_tieout(%s, array[%s]))" % (q(B), ",".join(q(m) for m in months)),
            "tally_tieout (1 month)": "select count(*) from jsonb_object_keys(tally_calc_tieout(%s, array[%s]))" % (q(B), q(months[-1])),
            "tally_ageing r": "select length(tally_calc_ageing(%s, %s, 'r')::text)" % (q(B), q(d)),
            "tally_ageing p": "select length(tally_calc_ageing(%s, %s, 'p')::text)" % (q(B), q(d)),
            "tally_calc_version": "select length(tally_calc_version(%s))" % q(B)}
    res = {}
    for k, s in asks.items():
        res[k] = min(float(db.one("select t_ms(%s)" % q(s))) for _ in range(3))
    return res

# the test page: build.py's own assembly, into the scratch folder (site/ and site-test/ are not touched)
import build
HTML = os.path.join(SCRATCH, "index-m151.html")
open(HTML, "w").write(build.assemble())

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
        compare(db, label, B, cid, br, dates, months, ageing)
        if timed:
            T = timing(db, B, cid, dates, months, ageing[-1])
            for k, v in T.items(): print("   %-34s %8.1f ms" % (k, v))
            ok(all(v < 1000 for v in T.values()), "5. every function under 1 s on %d entries / %d ledgers (slowest %.0f ms)" % (len(V), len(L), max(T.values())))

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
except RuntimeError as e:
    ok(False, "the run: %s" % str(e)[-1500:])
finally:
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
