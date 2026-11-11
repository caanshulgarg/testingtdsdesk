"""python3 run_migration163.py - server/tally-cloud/migration-163-mis-cash-speed.sql (11-Nov-2026, branch next-mis-cash:
tests/run_migration152.py's check 3 failed on the cash part, 1,184 ms median on the 41,181-entry book against the 1 s
target). On a throwaway PostgreSQL (pg_stand, port 31163 unless PG163_PORT; never a real database), built as
run_migration152.py builds it (the cloud copy's tables as on staging, 151, 152), then 163 (twice). The made-up books are
run_migration152.py's own (make_book, its fixed seeds: small, 40k, nogroups), with FinCom's ledger list made here so
that every what / side / kind the cash part reads is there (GST set-off, output GST, GST interest, TDS, a bank by
FinCom's guess), Loan-given marks (confirmed and only guessed) and partners named by a Capital Account ledger. Written
before the file. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no drop, delete, truncate, alter, insert, update, no table
     or index made); names no real database; makes again ONE function, tally_calc_cash, with 152's arguments, returns,
     SECURITY DEFINER and search_path (its other settings as 152's, enable_nestloop off added), and 152's grants
     (service_role only), written out again; nothing else of before replaced; runs twice
  1. THE SAME ANSWER, byte for byte: 152's tally_calc_cash is kept in the stand under another name (its own text, only
     the name changed) and both are asked in ONE statement, as text, for every book and: the five periods
     run_migration152.py compares, the three it times, the books' first day alone, a period before the books' first
     day (no opening), one running past it, a single day, a month with nothing, the last day, from after to (null), a
     book that does not exist (null); and through tally_calc_mis(book, 'cash', ...) and tally_mis_part (a member)
  2. timings on the 40k book (each run in its own session, as run_migration152.py's): 163's median of five under 1 s
     for each period run_migration152.py times, and for the books' whole span not slower than 152's
RED_WITHOUT_163=1: the same checks without the file (0 and 2 fail)."""
import os, re, sys, io, json, time, hashlib, contextlib, datetime, statistics, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M151 = os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")
M152 = os.path.join(ROOT, "server", "tally-cloud", "migration-152-cloud-calc-2.sql")
M163 = os.environ.get("M163_FILE") or os.path.join(ROOT, "server", "tally-cloud", "migration-163-mis-cash-speed.sql")
RED = os.environ.get("RED_WITHOUT_163") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"

# run_migration152.py's books and loaders (its definitions only: the part before it builds the browser; its own file
# checks print nothing here)
src = open(os.path.join(HERE, "run_migration152.py")).read()
G = {"__file__": os.path.join(HERE, "run_migration152.py"), "__name__": "m152_defs"}
import tempfile
OWN_TMP = None if os.environ.get("M152_TMP") else tempfile.mkdtemp(prefix="m163-")     # its scratch folder (unused here), removed at the end
if OWN_TMP: os.environ["M152_TMP"] = OWN_TMP
with contextlib.redirect_stdout(io.StringIO()): exec(compile(src[:src.index("import importlib.util, shutil")], "run_migration152.py", "exec"), G)
make_book, load_book, settings, store, F, U, TODAY = G["make_book"], G["load_book"], G["settings"], G["store"], G["F"], G["U"], G["TODAY"]

t152 = open(M152).read()
text = "" if RED or not os.path.exists(M163) else open(M163).read()
print("== 0. the file%s" % (" (RED_WITHOUT_163: none)" if RED else ""))
if text: print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M163), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(bool(text) and re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate|alter|create\s+table|create\s+(unique\s+)?index|insert|update)\s", code), "add-only: nothing dropped, deleted, truncated, altered, inserted or updated; no table or index made")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == ["tally_calc_cash"], "makes again only tally_calc_cash (%s)" % made)
def head_of(t, fn):
    m = re.search(r"create or replace function public\.%s\((.*?)\)\s*\nreturns (.*?) language (\w+) (\w+) (security definer )?set search_path to 'public', 'pg_temp'((?: set \w+ to '[^']*')*) as \$function\$" % fn, t, re.S)
    return m and {"args": m.group(1), "returns": m.group(2), "lang": m.group(3), "vol": m.group(4), "definer": bool(m.group(5)), "set": re.findall(r"set (\w+) to '([^']*)'", m.group(6))}
h152, h163 = head_of(t152, "tally_calc_cash"), head_of(text, "tally_calc_cash")
ok(bool(h152) and bool(h163) and all(h163[k] == h152[k] for k in ("args", "returns", "lang", "vol", "definer")) and h163["set"] == h152["set"] + [("enable_nestloop", "off")],
   "152's arguments, returns, language, volatility, SECURITY DEFINER, search_path; its settings with enable_nestloop off added (%s)" % (h163 and h163["set"]))
g152 = re.findall(r"(?:revoke all|grant execute) on function public\.tally_calc_cash\([^)]*\)[^;]*;", t152)
g163 = re.findall(r"(?:revoke all|grant execute) on function public\.tally_calc_cash\([^)]*\)[^;]*;", text)
ok(len(g152) == 2 and g163 == g152, "152's grants written out again (%s)" % g163)

DB_PORT = int(os.environ.get("PG163_PORT") or 31163)
db = pg_stand.start(DB_PORT)
B_OF = {}
try:
    db.sql("""
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
    alter database postgres set jit = off;
    alter table tally_ledgers add column if not exists deleted_at timestamptz;
    alter table tally_ledger_day add column if not exists merged_into text;
    alter table tally_vouchers add column if not exists deleted_at timestamptz;
    alter table tally_lines add column if not exists id bigint;
    create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text, type text, amount numeric, bill_date date, credit_days integer, due date, id bigint primary key);
    create index if not exists tally_bills_book_guid on tally_bills (book_id, guid);
    create index if not exists tally_lines_book_day on tally_lines (book_id, day);
    create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));
    create table if not exists clients (id text, firm_id uuid, name text, data jsonb default '{}', deleted boolean default false, primary key (firm_id, id));
    insert into firms values (%s, 'Made-up Firm A');
    insert into members (user_id, firm_id, name, role) values (%s, %s, 'Made-up Owner', 'owner');
    """ % (q(F), q(U), q(F)))
    db.sql(open(M151).read()); db.sql(t152)
    # 152's own function, its text, only the name changed
    f152 = re.search(r"create or replace function public\.tally_calc_cash\(.*?end \$function\$;", t152, re.S).group(0).replace("public.tally_calc_cash(", "public.t152_cash(")
    db.sql(f152)
    if text:
        db.sql(text); first = db.one("select md5(pg_get_functiondef('public.tally_calc_cash(uuid, date, date)'::regprocedure))")
        db.sql(text)
        ok(db.one("select md5(pg_get_functiondef('public.tally_calc_cash(uuid, date, date)'::regprocedure))") == first, "0. runs twice: the same function")
        acl = db.one("select proacl::text from pg_proc where oid = 'public.tally_calc_cash(uuid, date, date)'::regprocedure")
        ok("service_role=X" in acl and "authenticated" not in acl and "anon" not in acl and not re.search(r"(^|[{,])=X", acl), "0. in the database: execute for service_role only (%s)" % acl)
        cfg = db.one("select array_to_string(proconfig, '|') from pg_proc where oid = 'public.tally_calc_cash(uuid, date, date)'::regprocedure")
        ok(db.one("select prosecdef::text from pg_proc where oid = 'public.tally_calc_cash(uuid, date, date)'::regprocedure") == "true" and "search_path=public, pg_temp" in cfg and "enable_nestloop=off" in cfg,
           "0. in the database: SECURITY DEFINER, search_path fixed, enable_nestloop off (%s)" % cfg)
    else:
        ok(False, "0. no file: runs twice"); ok(False, "0. no file: grants"); ok(False, "0. no file: settings")

    print("== 1. the same answer, byte for byte (152's function as t152_cash)")
    start, end = datetime.date(2024, 4, 1), datetime.date(2026, 10, 31)
    for label, seed, n_v, n_c, n_s, n_e, groups in (("small", 152, 3000, 60, 40, 30, True), ("40k", 40152, 40000, 4000, 3000, 2900, True), ("nogroups", 1520, 2500, 50, 30, 30, False)):
        B, cid = "b1520000-0000-0000-0000-%012d" % seed, "client-%d" % seed; B_OF[label] = B
        t0 = time.time(); L, V = make_book(seed, n_v, n_c, n_s, n_e, start, end); st = settings(L, seed, label == "40k")
        load_book(db, B, F, cid, L, V, start, groups)
        # FinCom's ledger list as Books.mapLedgers keeps it: every what / side / kind the cash part reads
        names = sorted(L)
        fmap = {n: {"kind": ""} for n in names}
        for n in names:
            if "GST" in n and "Output" in n or n.endswith("IGST Output"): fmap[n] = {"kind": "gst", "side": "output"}
            elif "Input IGST" == n: fmap[n] = {"kind": "gst", "side": "input"}
            elif "TDS" in n or "194" in n: fmap[n] = {"kind": "tds_payable"}
            elif n == "Bank Charges": fmap[n] = {"kind": "bank"}
            elif n == "Petty Cash Float": fmap[n] = {"kind": "bank"}
        fmap.update({"GST Electronic Cash": {"kind": "", "what": "gst_setoff"}, "GST Late Fee": {"kind": "", "what": "gst_interest"}, "Suspense Unknown": {"kind": "", "what": "gst_rcm", "side": "output"},
                     "Insurance Refund": {"kind": "", "what": "gst_import"}, "Freight Recovered": {"kind": "tcs_collected"}})
        for i, n in enumerate(n for n in names if n.startswith("Expense Head")):
            if i % 97 == 3: fmap[n] = {"kind": "gst_common", "side": "output" if i % 2 else "input"}
        store(db, F, cid, fmap, st)
        # Loan given, confirmed and only guessed (settings: Loan to Associate confirmed, Staff Advance guessed); partners:
        # a Capital Account ledger named for the group "Rowan Teal" (Loans (Liability)) and for "Partner Current ..."
        print("   %s: %d entries, %d ledgers, made and loaded in %.1f s" % (label, len(V), len(L), time.time() - t0))
        periods = [("2025-04-01", "2026-03-31"), ("2026-10-01", "2026-10-31"), ("2025-08-15", "2025-11-20"), ("2024-04-01", "2026-11-09"), ("2024-05-01", "2024-06-30"),
                   ("2025-05-01", "2026-10-31"), ("2024-04-01", "2024-04-01"), ("2024-03-01", "2024-04-30"), ("2023-01-01", "2023-12-31"), ("2025-12-25", "2025-12-25"),
                   ("2026-12-01", "2026-12-31"), ("2026-10-31", "2026-10-31"), ("2026-03-31", "2025-04-01")]
        rows = db.rows("select p.f::text as f, p.t::text as t, md5(coalesce(t152_cash(%s, p.f, p.t)::text, '<null>')) as a, md5(coalesce(tally_calc_cash(%s, p.f, p.t)::text, '<null>')) as b, "
                       "length(coalesce(tally_calc_cash(%s, p.f, p.t)::text, '')) as n from (values %s) p(f, t)"
                       % (q(B), q(B), q(B), ", ".join("(%s::date, %s::date)" % (q(f), q(t)) for f, t in periods)))
        bad = [(r["f"], r["t"]) for r in rows if r["a"] != r["b"]]
        ok(not bad and len(rows) == len(periods), "1. %s: tally_calc_cash = 152's, byte for byte, on %d periods (%s characters; differs: %s)" % (label, len(rows), "/".join(r["n"] for r in rows), bad))
        flows = db.rows("select jsonb_array_length(tally_calc_cash(%s, '2024-04-01', '2026-11-09') #> '{flow,rows}') as r, jsonb_array_length(tally_calc_cash(%s, '2024-04-01', '2026-11-09') #> '{flow,notes}') as n" % (q(B), q(B)))[0]
        labs = db.one("select string_agg(distinct x ->> 'lab', ', ') from jsonb_array_elements(tally_calc_cash(%s, '2024-04-01', '2026-11-09') #> '{flow,rows}') x" % q(B))
        print("        cash flow over the whole span: %s lines, %s notes (%s)" % (flows["r"], flows["n"], labs))
        if label == "small":
            ok(all(k in labs for k in ("GST", "GST interest and late fees", "TDS and TCS", "Loans given", "Partners' accounts", "Salaries and staff", "Input GST paid with bills")),
               "1. small: the lines the list and marks lead to are there (GST, GST interest, TDS and TCS, Loans given, Partners' accounts, Salaries, Input GST)")
        ok(db.one("select md5(tally_calc_mis(%s, 'cash', '2025-04-01', '2026-03-31', %s)::text) = md5(t152_cash(%s, '2025-04-01', '2026-03-31')::text)" % (q(B), q(TODAY.isoformat()), q(B))) == "t",
           "1. %s: tally_calc_mis(book, 'cash', ...) gives 152's answer" % label)
        r = json.loads(db.one("select tally_mis_part(%s, 'cash', '2025-04-01', '2026-03-31', %s)::text" % (q(cid), q(TODAY.isoformat())), uid=U))
        ok(json.dumps(r.get("result"), sort_keys=True) == json.dumps(json.loads(db.one("select t152_cash(%s, '2025-04-01', '2026-03-31')::text" % q(B))), sort_keys=True), "1. %s: tally_mis_part as a member: 152's answer" % label)
    ok(db.one("select coalesce(tally_calc_cash('00000000-0000-0000-0000-000000000163', '2025-04-01', '2026-03-31')::text, 'null') = coalesce(t152_cash('00000000-0000-0000-0000-000000000163', '2025-04-01', '2026-03-31')::text, 'null')") == "t",
       "1. a book that does not exist: as 152 (null)")

    print("== 2. timings on the 40k book (each run in its own session; median of five)")
    def ms(fn, f, t):
        return float(db.one("select t_ms(%s)" % q("select length(%s(%s, %s, %s)::text)" % (fn, q(B_OF["40k"]), q(f), q(t)))))
    db.sql("""create or replace function t_ms(p text) returns numeric language plpgsql as $$ declare t timestamptz := clock_timestamp(); n bigint; begin execute p into n; return round(extract(epoch from clock_timestamp() - t) * 1000, 1); end $$;""")
    for f, t in (("2025-04-01", "2026-03-31"), ("2025-05-01", "2026-10-31"), ("2024-04-01", "2026-11-09")):
        a, b = [], []
        for _ in range(5): a.append(ms("t152_cash", f, t)); b.append(ms("tally_calc_cash", f, t))
        ma, mb = statistics.median(a), statistics.median(b)
        print("   %s - %s: 152 %.0f ms, now %.0f ms (best %.0f)" % (f, t, ma, mb, min(b)))
        ok(mb < 1000 and (mb <= ma or (f, t) != ("2024-04-01", "2026-11-09")), "2. %s - %s: median under 1 s (%.0f ms; 152's %.0f ms)" % (f, t, mb, ma))
except RuntimeError as e:
    ok(False, "the run: %s" % str(e)[-1500:])
finally:
    db.stop()
    shutil.rmtree(db.data, ignore_errors=True)
    if OWN_TMP: shutil.rmtree(OWN_TMP, ignore_errors=True)
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
