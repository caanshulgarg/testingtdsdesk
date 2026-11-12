"""python3 tests/run_migration169.py - server/tally-cloud/migration-169-openings-speed.sql (Sentry FINCOM-CLOUD-STAGING-6,
7-Nov-2026: "canceling statement due to statement timeout" in applyLedgerList). The last batch of a first ledger round of a
new book (about 4,000 ledgers) called tally_openings_settle, which ran tally_year_openings; the database had no figures yet
for the new book's rows (they had come in seconds before), so the planner took the book for one row and joined the twins
CTE to itself and to tally_ledgers by nested loops: quadratic, past PostgREST's 8 s. On a throwaway PostgreSQL (pg_stand,
port 31869 unless PG169_PORT; never a real database), built as tests/run_migration130.py builds it, then 130. Written
before the file. Checks:
  0. the file: one transaction (lock_timeout 10 s); add-only (create or replace function only; no table altered, nothing
     dropped or deleted); explicit grants (service_role only); names no real database; runs twice.
  1. the same answer: a made-up book with twins (a name with a line break, one with two spaces; the head with a group;
     a deleted twin; income and expense ledgers moved to Profit & Loss A/c) gives the same rows (open, open_sent,
     merged_into) and the same reply from 169's tally_year_openings as from 33's; run again, nothing changes; a head
     deleted: its twin is its own again, as before.
  2. the speed: a new book of 4,500 ledgers written after the table's figures were taken (the planner's case on 7-Nov):
     a dated round staged in three batches and settled within 8 s (statement_timeout as PostgREST's): under 2 s; and
     tally_year_openings alone under 1 s. 33's own time on the same book is printed (it ran about 10 s here)."""
import os, re, sys, json, time, hashlib, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M169 = os.path.join(SQLDIR, "migration-169-openings-speed.sql")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-130-opening-guards.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-4999-8999-999999999169"
B1, B2, BN = "bbbbbbbb-0169-4000-8000-000000000001", "bbbbbbbb-0169-4000-8000-000000000002", "bbbbbbbb-0169-4000-8000-0000000000aa"

text = open(M169).read() if os.path.exists(M169) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M169))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M169), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\b(drop|truncate|delete\s+from|alter\s+table|create\s+table|create\s+index)\b", code), "add-only: functions only (nothing dropped, deleted or altered)")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", code)))
ok(FNS == ["tally_year_openings"], "one function replaced (%s)" % FNS)
ok("revoke all on function public.tally_year_openings(uuid) from public, anon, authenticated;" in text and "grant execute on function public.tally_year_openings(uuid) to service_role;" in text, "explicit grants: service_role only")
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "names no real database")

db = pg_stand.start(int(os.environ.get("PG169_PORT") or 31869))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    return json.loads(db.one(s))
def snap(book):
    return [(r["name"], r["open"], r["open_sent"], r["merged_into"], r["deleted"]) for r in
            db.rows("select name, open::numeric(18,2)::text open, open_sent::numeric(18,2)::text open_sent, coalesce(merged_into, '') merged_into, (deleted_at is not null)::text deleted from tally_ledgers where book_id = %s order by name" % q(book))]
# a made-up book with twins: Rent (with a group) and two spellings of it (a line break; two spaces), Sales twice, a
# deleted twin of Cash, an expense opening moved to Profit & Loss A/c
TWINS = [("Cash", "Cash-in-Hand", -1000, False), ("Cash ", "", -50, True), ("Capital", "Capital Account", 1500, False),
         ("Rent", "Indirect Expenses", -300, False), ("Rent&#10;", "", -20, False), ("Rent\n", "", -5, False), ("Office  Rent", "Indirect Expenses", -10, False),
         ("Office Rent", "", -15, False), ("Sales", "Sales Accounts", 400, False), ("Sales ", "", 0, False), ("Made-up Party", "Sundry Debtors", -500, False)]
def seed(book):
    db.sql("delete from tally_ledgers where book_id = %s;" % q(book) + "".join(
        "insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, chain, primary_group, deleted_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s);" % (
            q(book), q(F), q(n), q(p), v, v, q("{" + p + "}") if p else "'{}'", q(p), "now()" if d else "null") for n, p, v, d in TWINS))
def scenario(book):
    seed(book)
    out = [j("select tally_year_openings(%s)::text" % q(book))]; s1 = snap(book)
    out.append(j("select tally_year_openings(%s)::text" % q(book))); s2 = snap(book)
    db.sql("update tally_ledgers set deleted_at = now() where book_id = %s and name = 'Rent'" % q(book))
    out.append(j("select tally_year_openings(%s)::text" % q(book))); s3 = snap(book)
    return out, [s1, s2, s3]
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("insert into firms values (%s, 'Made-up Firm') on conflict do nothing;" % q(F))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'Made-up One', '2025-04-01', '2025-03-31'), (%s, %s, 'c2', 'Made-up Two', '2025-04-01', '2025-03-31');" % (q(B1), q(F), q(B2), q(F)))
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # the figures of a table with other books in it (20 books of 600 ledgers), taken before the new book comes
    db.sql("""insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on)
                select ('cccccccc-0169-4000-8000-' || lpad(g::text, 12, '0'))::uuid, %s, 'o' || g, 'Other ' || g, '2025-04-01', '2025-03-31' from generate_series(1, 20) g;
              insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, chain, primary_group)
                select ('cccccccc-0169-4000-8000-' || lpad((g %% 20 + 1)::text, 12, '0'))::uuid, %s, 'Made-up Ledger ' || g, 'Sundry Debtors', 0, 0, '{Sundry Debtors}', 'Sundry Debtors' from generate_series(1, 12000) g;
              analyze tally_ledgers;""" % (q(F), q(F)))

    print("== 1. the same answer (33's, then 169's)")
    old_out, old_snaps = scenario(B1)
    for i in (1, 2):
        r = psql_text(text); ok(r.returncode == 0, "169 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    ok(db.one("select has_function_privilege('authenticated', 'public.tally_year_openings(uuid)', 'execute') or has_function_privilege('anon', 'public.tally_year_openings(uuid)', 'execute')") in ("f", "false")
       and db.one("select has_function_privilege('service_role', 'public.tally_year_openings(uuid)', 'execute')") in ("t", "true"), "grants: service_role only")
    new_out, new_snaps = scenario(B2)
    ok(old_out[0].get("twins", 0) >= 3 and float(old_out[0].get("moved")) != 0, "33's answer has twins and a P&L move (%s)" % old_out[0])
    ok(new_out == old_out, "the same replies (%s)" % new_out)
    for i, w in enumerate(("first run", "run again", "a head deleted")):
        ok(new_snaps[i] == old_snaps[i], "the same rows: %s" % w + ("" if new_snaps[i] == old_snaps[i] else " (33: %s; 169: %s)" % (old_snaps[i], new_snaps[i])))
    ok(new_snaps[0] == new_snaps[1], "run again: nothing changes")
    r = psql_text("set fincom.role = 'authenticated'; select tally_year_openings(%s);" % q(B2))
    ok(r.returncode != 0 and "not allowed" in r.stderr, "a signed-in person refused")

    print("== 2. the speed: a new book the planner has no figures for")
    N = 4500
    def new_book():
        db.sql("delete from tally_openings_held where book_id = %s; delete from tally_ledgers where book_id = %s; delete from tally_books where book_id = %s;" % (q(BN), q(BN), q(BN)))
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'cn', 'Made-up New', '2025-04-01', '2025-03-31');" % (q(BN), q(F)))
        db.sql("""insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, chain, primary_group)
                    select %s, %s, 'Made-up Ledger ' || g, case when g %% 9 = 0 then 'Indirect Expenses' else 'Sundry Debtors' end, 0, 0,
                           case when g %% 9 = 0 then '{Indirect Expenses}' else '{Sundry Debtors}' end::text[], case when g %% 9 = 0 then 'Indirect Expenses' else 'Sundry Debtors' end from generate_series(1, %d) g;""" % (q(BN), q(F), N))
        rows = [["Made-up Ledger %d" % g, (g if g % 2 else -g) if g < N else 0] for g in range(1, N + 1)]
        rows[-1][1] = -sum(r[1] for r in rows[:-1])        # the round adds up to nil
        for k in range(3):
            db.sql("select tally_openings_stage(%s, 'r-169', 'the bridge''s ledger read', '2025-04-01', %s)" % (q(BN), js(rows[k::3])))
    def timed(sql):
        t = time.time(); r = psql_text("set statement_timeout = '8s';\n" + sql); return time.time() - t, r
    new_book()
    t, r = timed("\\pset tuples_only on\nselect tally_openings_settle(%s, 'r-169', 'the bridge''s ledger read', '2025-04-01');" % q(BN))
    rep = json.loads(r.stdout.strip() or "{}") if r.returncode == 0 else {}
    ok(r.returncode == 0 and t < 2 and rep.get("settled") == "applied", "%d ledgers: a dated round settled (applied) in %.2f s (under 2 s, within 8 s)%s" % (N, t, " " + json.dumps(rep)[:200] if r.returncode == 0 else ": " + r.stderr[-200:]))
    ok(db.one("select count(*) from tally_ledgers where book_id = %s and open_sent <> 0" % q(BN)) == str(N) and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Profit & Loss A/c'" % q(BN)) == "1",
       "the openings taken and the expense openings moved to Profit & Loss A/c")
    new_book()
    t, r = timed("select tally_year_openings(%s);" % q(BN))
    ok(r.returncode == 0 and t < 1, "tally_year_openings alone: %.2f s (under 1 s)" % t)
    # 33's own time on the same book (printed, not checked)
    s33 = open(os.path.join(SQLDIR, "migration-33-ledger-lists.sql")).read(); i = s33.index("create or replace function public.tally_year_openings")
    psql_text(s33[i:s33.index("$function$;", i) + 11]); new_book()
    t, r = timed("select tally_year_openings(%s);" % q(BN))
    print("  (33's tally_year_openings on the same book: %.2f s%s)" % (t, "" if r.returncode == 0 else ", " + (r.stderr.strip().splitlines() or ["failed"])[-1][:120]))
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
raise SystemExit(1 if fails else 0)
