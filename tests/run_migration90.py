"""python3 run_migration90.py - migration-90-ledger-fetch-speed (15-Oct-2026, branch next-ledger-fetch). Migration 89's
tally_ledger_fetch_plan took 5,251 ms on staging's GARG SHEKHAR (10,326 lines, 1,112 live ledgers) and 580 ms on GB TEXCOAT:
it runs on every beat (30 s) per open company. 90 replaces that one function (same arguments, result and rules) with one
set-based pass. On a throwaway PostgreSQL (pg_stand, ports 30892 / 30893; never a real database). Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from', no drop or truncate, no real
     database named; only tally_ledger_fetch_plan replaced, its signature unchanged; runs twice.
  1. the same answers as 89: run_migration89.py's checks again with 90 applied after 89 (M89_THEN).
  2. speed: a book of 1,100 live ledgers and 10,000 lines (some in other capitals and spaces, an alias, 5 missing) answers
     the 5 missing names in under 100 ms (the best of 5 calls, timed inside the database); 4,006 ledgers and 100,000 lines
     in under 500 ms; the second size takes at most about its size's share more (linear, not quadratic).
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M89 = os.path.join(SQLDIR, "migration-89-ledger-fetch.sql")
M90 = os.environ.get("M90_FILE") or os.path.join(SQLDIR, "migration-90-ledger-fetch-speed.sql")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-59-ledger-aliases.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-9999-9999-999999999999"
B1, B2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"

text = open(M90).read() if os.path.exists(M90) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M90))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0 and not re.search(r"\bdrop\b", code) and not re.search(r"\btruncate\b", code), "0. no 'delete from', no drop, no truncate")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")
made = re.findall(r"create or replace function public\.(\w+)\s*\(([^)]*)\)", low)
ok([m[0] for m in made] == ["tally_ledger_fetch_plan"] and "create table" not in code, "0. replaces tally_ledger_fetch_plan only (%s)" % [m[0] for m in made])
ok(made and re.sub(r"\s+", " ", made[0][1]) == "p_book uuid, p_company text, p_paused boolean default false, p_room integer default 20, p_now timestamptz default now("
   , "0. the same arguments as 89 (%s)" % (made and made[0][1]))

# 1. the same answers as 89
r = subprocess.run([sys.executable, os.path.join(HERE, "run_migration89.py")], env=dict(os.environ, M89_THEN=M90, M89_PORT="30893"), capture_output=True, text=True)
bad = [l for l in r.stdout.splitlines() if l.startswith("  FAIL")]
ok(r.returncode == 0 and not bad, "1. run_migration89.py's checks with 90 in force: all pass (%s)" % (bad[:5] or r.stdout.strip().splitlines()[-1:]))

db = pg_stand.start(30892)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B1)s, %(F)s, 'c1', 'MID CO', '2026-04-01', '2026-03-31'), (%(B2)s, %(F)s, 'c2', 'BIG CO', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" % {"F": q(F), "B1": q(B1), "B2": q(B2)})
    for path in FILES + [M89, M90, M90]:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    ok(True, "0. 89, then 90 twice: runs")
    # a generated book: n ledgers ('Party Ledger 0001' ...), m lines over m/5 entries; every 7th line names its ledger in other
    # capitals and spaces, every 11th through an alias, and 5 names no ledger has
    def book(b, n, m):
        db.sql("""insert into tally_ledgers (book_id, firm_id, name, parent, open, tally_guid) select %(B)s, %(F)s, 'Party Ledger ' || lpad(i::text, 5, '0'), 'Sundry Debtors', 0, 'g-' || i from generate_series(1, %(N)d) i;
          insert into tally_ledger_aliases (book_id, firm_id, tally_name, fincom_name, tally_guid, confirmed_at) select %(B)s, %(F)s, 'Renamed ' || i, 'Party Ledger ' || lpad(i::text, 5, '0'), 'g-' || i, now() from generate_series(1, %(N)d, 11) i;
          insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party) select %(B)s, %(F)s, 'v' || j, date '2026-04-01' + (j %% 300), 'Journal', j::text, '' from generate_series(1, %(V)d) j;
          insert into tally_lines (book_id, firm_id, guid, day, ledger, amount)
            select %(B)s, %(F)s, 'v' || (k / 5 + 1), date '2026-04-01' + ((k / 5 + 1) %% 300),
                   case when k < 5 then 'Missing Ledger ' || k
                        when k %% 11 = 0 then 'Renamed ' || (1 + 11 * ((k / 11) %% ((%(N)d - 1) / 11 + 1)))
                        when k %% 7 = 0 then 'PARTY LEDGER' || lpad((1 + k %% %(N)d)::text, 5, '0')
                        else 'Party Ledger ' || lpad((1 + k %% %(N)d)::text, 5, '0') end, 1
              from generate_series(0, %(M)d - 1) k;
          analyze tally_ledgers; analyze tally_lines; analyze tally_vouchers; analyze tally_ledger_aliases;""" % {"B": q(b), "F": q(F), "N": n, "M": m, "V": m // 5 + 1})
    db.sql("""create or replace function test_time_plan(p_book uuid, p_n int) returns jsonb language plpgsql as $$
      declare t0 timestamptz; best numeric := 1e9; res jsonb;
      begin
        for i in 1..p_n loop
          t0 := clock_timestamp();
          res := public.tally_ledger_fetch_plan(p_book, 'CO', false, 20, now() + make_interval(mins => i));
          best := least(best, extract(epoch from clock_timestamp() - t0) * 1000);
        end loop;
        return res || jsonb_build_object('ms', round(best, 1));
      end $$;""")
    book(B1, 1100, 10000)
    r1 = json.loads(db.one("select test_time_plan(%s, 5)::text" % q(B1)))
    ok(r1.get("names") == ["Missing Ledger %d" % i for i in range(5)] and r1.get("missing") == 5, "2. 1,100 ledgers / 10,000 lines: the 5 missing names, the capitals / spaces and the aliases held (%s)" % r1.get("names"))
    ok(r1["ms"] < 100, "2. 1,100 ledgers / 10,000 lines: %.1f ms (under 100)" % r1["ms"])
    book(B2, 4006, 100000)
    r2 = json.loads(db.one("select test_time_plan(%s, 3)::text" % q(B2)))
    ok(r2.get("names") == ["Missing Ledger %d" % i for i in range(5)], "2. 4,006 ledgers / 100,000 lines: the same 5 names (%s)" % r2.get("names"))
    ok(r2["ms"] < 500, "2. 4,006 ledgers / 100,000 lines: %.1f ms (under 500)" % r2["ms"])
    ok(r2["ms"] < max(50.0, r1["ms"]) * 12, "2. linear, not quadratic: %.1f ms for 3.6 times the ledgers (%.1f ms before)" % (r2["ms"], r1["ms"]))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
