"""python3 run_migration130.py - migration-130-opening-guards (30-Oct-2026, with FinCom Bridge 2.5.0; the owner's decision of
30-Oct-2026): opening balances are taken only when they add up to nil, and a dated read is preferred. On a throwaway
PostgreSQL (pg_stand, port 31300; never a real database), built in staging's order 32 -> ... -> 63 as run_migration98.py
builds it. Written before the file. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate / alter table other than the
     new table's row security), names no real database; runs twice; the new table's grants and every function's: service
     role only, nothing for anon or authenticated.
  1. tally_inr: Indian digit groups, Dr for a debit (negative), Cr for a credit.
  2. tally_openings_candidate: the stored sum (open_sent, else open; live ledgers only), whether it ties, the sum with the
     rows in place and how many would change.
  3. a round (stage, stage, settle) whose openings add up to nil: applied (open and open_sent), the year's openings worked
     out again (an expense ledger's opening moved to Profit & Loss A/c as before), the held rows marked applied.
  4. (a) a round whose openings do not add up to nil (beyond Rs 1): nothing stored changes; the incoming held (one row
     with the round's openings and the difference); ONE alert "Opening balances from the bridge's ledger read do not add up
     to nil: 1,28,00,000.00 Dr" (no computer name), for the firm and book; a difference of Rs 1 or less is taken.
  5. (c) a book whose openings tie: an undated round that changes them is kept (nothing changes, no alert); a dated round
     that changes them and ties is taken. A fresh book (no opening yet) takes an undated round that ties.
  6. tally_openings_hold for an upload: held with its source's words and one alert; stage must be held or kept; another
     firm's book cannot be named (no such book); the functions refuse anyone but the service role.
RED_WITHOUT_130=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql")]
M130 = os.environ.get("M130_FILE") or os.path.join(SQLDIR, "migration-130-opening-guards.sql")
RED = os.environ.get("RED_WITHOUT_130") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2 = "99999999-9999-9999-9999-999999999130", "88888888-8888-8888-8888-888888888130"
B, B2, B3 = "819d4a59-4cee-4bf7-8f8c-000000000130", "819d4a59-4cee-4bf7-8f8c-000000000131", "819d4a59-4cee-4bf7-8f8c-000000000132"

text = open(M130).read() if os.path.exists(M130) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M130))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M130), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_openings_held enable row level security;"], "0. add-only: no delete, drop or truncate; the only table change is the new table's row security (%s)" % alters)
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
TABLES = sorted(re.findall(r"create table if not exists public\.(\w+)", text))
ok(TABLES == ["tally_openings_held"], "0. one new table (%s)" % TABLES)
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
SVC = ["tally_inr", "tally_openings_candidate", "tally_openings_hold", "tally_openings_settle", "tally_openings_stage"]
ok(FNS == SVC, "0. five new functions (%s)" % FNS)
ok(re.search(r"revoke all on public\.tally_openings_held from public, anon, authenticated;", text) and re.search(r"grant select, insert, update on public\.tally_openings_held to service_role;", text),
   "0. the table's own grants: service_role reads and writes, nothing for anon or authenticated")
for fn in SVC:
    ok(re.search(r"revoke all on function public\.%s\([^)]*\) from public, anon, authenticated;" % fn, text) and re.search(r"grant execute on function public\.%s\([^)]*\) to service_role;" % fn, text), "0. %s: explicit grants, service_role only" % fn)

db = pg_stand.start(int(os.environ.get("PG130_PORT") or 31300))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def led(book):
    return {r["name"]: (float(r["open"]), None if r["open_sent"] in (None, "") else float(r["open_sent"])) for r in db.rows("select name, open, open_sent from tally_ledgers where book_id = %s and deleted_at is null" % q(book))}
def alerts(book): return db.rows("select kind, words, data::text as data, firm_id::text as firm, client_id from tally_alerts where book_id = %s order by id" % q(book))
def held(book): return db.rows("select stage, source, round, openings_at::text as openings_at, rows::text as rows, diff::text as diff from tally_openings_held where book_id = %s order by id" % q(book))
def seed(book, rows):
    db.sql("delete from tally_ledgers where book_id = %s;" % q(book) + "".join(
        "insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, chain, primary_group) values (%s, %s, %s, %s, %s, %s, %s, %s);" % (
            q(book), q(F), q(n), q(p), v, v, q("{" + p + "}"), q(p)) for n, p, v in rows))
def stage(book, rnd, rows, at=None): return j("select tally_openings_stage(%s, %s, 'the bridge''s ledger read', %s, %s)::text" % (q(book), q(rnd), "null" if at is None else q(at), js(rows)))
def settle(book, rnd, at=None): return j("select tally_openings_settle(%s, %s, 'the bridge''s ledger read', %s)::text" % (q(book), q(rnd), "null" if at is None else q(at)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'LOAN CO', '2025-04-01', '2025-03-31'),
        (%(B2)s, %(F)s, 'c2', 'TIED CO', '2025-04-01', '2025-03-31'), (%(B3)s, %(F)s, 'c3', 'FRESH CO', '2025-04-01', '2025-03-31');""" % {"F": q(F), "F2": q(F2), "B": q(B), "B2": q(B2), "B3": q(B3)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if not RED:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "130 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    for rl in ("anon", "authenticated"):
        ok(db.one("select has_table_privilege(%s, 'public.tally_openings_held', 'select') or has_table_privilege(%s, 'public.tally_openings_held', 'insert')" % (q(rl), q(rl))) in ("f", "false"), "0. tally_openings_held: nothing for %s" % rl)
    ok(all(db.one("select has_table_privilege('service_role', 'public.tally_openings_held', %s)" % q(p)) in ("t", "true") for p in ("select", "insert", "update")), "0. tally_openings_held: service_role reads and writes")
    ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_openings_held'::regclass") in ("t", "true"), "0. tally_openings_held: row security on")
    sig = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'tally_openings%' or p.proname = 'tally_inr')")}
    ex = lambda rl, fn: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig[fn]))) in ("t", "true") if fn in sig else None
    for fn in SVC: ok(ex("service_role", fn) and ex("authenticated", fn) is False and ex("anon", fn) is False, "0. %s: service_role only" % fn)

    print("== 1. tally_inr")
    inr = {v: db.one("select tally_inr(%s)" % v) for v in ("-12800000", "319000.5", "0", "-999.99", "123456789.01")}
    ok(inr == {"-12800000": "1,28,00,000.00 Dr", "319000.5": "3,19,000.50 Cr", "0": "0.00", "-999.99": "999.99 Dr", "123456789.01": "12,34,56,789.01 Cr"}, "1. Indian groups, Dr / Cr (%s)" % inr)

    print("== 2. the candidate")
    seed(B, [("Cash", "Cash-in-Hand", -631000), ("Capital", "Capital Account", 631000), ("Loan Advance Party", "Loans & Advances (Asset)", 0), ("Rent", "Indirect Expenses", 0)])
    c = j("select tally_openings_candidate(%s, %s)::text" % (q(B), js([["Loan Advance Party", -8950000]])))
    ok(c.get("storedTies") is True and float(c.get("stored")) == 0 and c.get("nonzero") == 2 and float(c.get("candidate")) == -8950000 and c.get("candidateTies") is False and c.get("changed") == 1, "2. stored ties; the candidate does not (%s)" % c)
    c = j("select tally_openings_candidate(%s, %s)::text" % (q(B), js([["New Ledger", 5], ["Cash", -631000]])))
    ok(float(c.get("candidate")) == 5 and c.get("changed") == 1, "2. a name not held counts (and an unchanged one does not) (%s)" % c)

    print("== 3. a round that adds up to nil: applied")
    r1 = stage(B, "r-ok", [["Cash", -700000], ["Rent", 10000]], "2025-04-01"); r2 = stage(B, "r-ok", [["Capital", 690000]], "2025-04-01")
    s = settle(B, "r-ok", "2025-04-01")
    L = led(B)
    ok(s.get("settled") == "applied" and s.get("changed") == 3 and L["Cash"] == (-700000, -700000) and L["Capital"] == (690000, 690000), "3. applied: open and open_sent (%s; %s)" % (s, L))
    ok(L.get("Rent", (None, None))[1] == 10000 and L["Rent"][0] == 0 and L.get("Profit & Loss A/c", (0,))[0] == 10000, "3. the year's openings worked out again: the expense moved to Profit & Loss A/c (%s)" % L)
    ok([h["stage"] for h in held(B)] == ["applied", "applied"] and not alerts(B), "3. the pending rows applied; no alert (%s)" % [h["stage"] for h in held(B)])
    ok(settle(B, "r-ok", "2025-04-01").get("settled") == "nothing pending", "3. settled once only")

    print("== 4. (a) a round that does not add up to nil: held, one alert")
    before = led(B)
    stage(B, "r-bad", [["Loan Advance Party", -8950000], ["Cash", -700000]]); stage(B, "r-bad", [["Party P Singh", -3850000]])
    s = settle(B, "r-bad")
    ok(s.get("settled") == "held" and float(s.get("difference")) == -12800000, "4. held, the difference (%s)" % s)
    ok(led(B) == before, "4. nothing stored changed (%s)" % led(B))
    H = held(B)
    ok([h["stage"] for h in H[2:]] == ["held", "held", "held"] and H[-1]["round"] == "r-bad" and float(H[-1]["diff"]) == -12800000 and "Loan Advance Party" in H[-1]["rows"] and "Party P Singh" in H[-1]["rows"], "4. the incoming kept as held, with the round's openings (%s)" % [(h["stage"], h["diff"]) for h in H])
    A = alerts(B)
    ok(len(A) == 1 and A[0]["words"] == "Opening balances from the bridge's ledger read do not add up to nil: 1,28,00,000.00 Dr" and A[0]["kind"] == "summary" and A[0]["firm"] == F and A[0]["client_id"] == "c1", "4. one alert, plain words, the firm's (%s)" % A)
    ok(not re.search(r"PC-|computer|user", A[0]["words"] if A else "", re.I), "4. no computer name in the words")
    stage(B, "r-rupee", [["Cash", -700000.75]], "2025-04-01")
    ok(settle(B, "r-rupee", "2025-04-01").get("settled") == "applied" and led(B)["Cash"][1] == -700000.75 and len(alerts(B)) == 1, "4. a difference of Rs 1 or less is taken")

    print("== 5. (c) a dated round preferred on a book whose openings tie")
    seed(B2, [("Cash", "Cash-in-Hand", -500), ("Capital", "Capital Account", 500), ("Party", "Sundry Debtors", 0)])
    stage(B2, "u-1", [["Cash", -900], ["Capital", 900]])
    s = settle(B2, "u-1")
    ok(s.get("settled") == "kept" and led(B2)["Cash"] == (-500, -500) and not alerts(B2), "5. an undated round that changes tied openings: kept, nothing changed, no alert (%s)" % s)
    ok([h["stage"] for h in held(B2)] == ["kept", "kept"], "5. kept as held (stage kept) (%s)" % [h["stage"] for h in held(B2)])
    stage(B2, "d-1", [["Cash", -900], ["Capital", 900]], "2025-04-01")
    s = settle(B2, "d-1", "2025-04-01")
    ok(s.get("settled") == "applied" and led(B2)["Cash"] == (-900, -900) and led(B2)["Capital"] == (900, 900), "5. a dated round that ties: taken (%s)" % s)
    stage(B2, "u-2", [["Cash", -900], ["Capital", 900]])
    ok(settle(B2, "u-2").get("changed") == 0, "5. an undated round that changes nothing: nothing to keep")
    seed(B3, [("Cash", "Cash-in-Hand", 0), ("Capital", "Capital Account", 0)])   # tally-ingest adds a round's new ledgers at nil first
    stage(B3, "u-fresh", [["Cash", -100], ["Capital", 100]])
    s = settle(B3, "u-fresh")
    ok(s.get("settled") == "applied" and led(B3) == {"Cash": (-100, -100), "Capital": (100, 100)}, "5. a fresh book takes an undated round that ties (%s; %s)" % (s, led(B3)))

    print("== 6. hold for an upload; refusals")
    h = j("select tally_openings_hold(%s, 'the trial balance file TB.xml', null, '2025-03-31', %s, 'held', -12800000)::text" % (q(B3), js([["Cash", -12800000]])))
    A3 = alerts(B3)
    ok(isinstance(h, int) and len(A3) == 1 and A3[0]["words"] == "Opening balances from the trial balance file TB.xml do not add up to nil: 1,28,00,000.00 Dr" and led(B3)["Cash"] == (-100, -100), "6. an upload held: its source's words, one alert, nothing stored changed (%s)" % A3)
    j("select tally_openings_hold(%s, 'the trial balance file TB.xml', null, '2025-03-31', %s, 'held', -12800000)::text" % (q(B3), js([["Cash", -12800000]])))
    ok(len(alerts(B3)) == 1 and len(held(B3)) >= 2, "6. the same file again: held again, no second alert that day (%d alerts)" % len(alerts(B3)))
    ok(db.one("select has_sequence_privilege('authenticated', 'public.tally_openings_held_id_seq', 'usage') or has_sequence_privilege('anon', 'public.tally_openings_held_id_seq', 'update')") in ("f", "false"), "0. the table's sequence: nothing for anon or authenticated")
    ok("stage is held or kept" in str(j("select tally_openings_hold(%s, 'x', null, null, '[]'::jsonb, 'applied', 0)::text" % q(B3))), "6. stage must be held or kept")
    ok("no such book" in str(j("select tally_openings_stage('00000000-0000-0000-0000-00000000dead', 'r', 'x', null, '[]'::jsonb)::text")), "6. a book that is not there: refused")
    for fn, args in (("tally_openings_stage", "%s, 'r', 'x', null, '[]'::jsonb" % q(B)), ("tally_openings_settle", "%s, 'r', 'x', null" % q(B)), ("tally_openings_candidate", "%s, '[]'::jsonb" % q(B)),
                     ("tally_openings_hold", "%s, 'x', null, null, '[]'::jsonb, 'held', 5" % q(B))):
        ok("not allowed" in str(j("select %s(%s)::text" % (fn, args), "authenticated")), "6. %s refuses a signed-in person (service role only)" % fn)
    ok(len(alerts(B)) == 1, "6. no alert added on the other book")
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
raise SystemExit(1 if fails else 0)
