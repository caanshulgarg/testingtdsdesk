"""python3 tests/run_migration209.py - server/tally-cloud/migration-209-sync-speed.sql (DRAFT, not applied anywhere), on a
throwaway PostgreSQL (pg_stand, port 31209 unless PG209_PORT; never a real database), with staging's tables as
tests/run_migration204.py has them and made-up books. The re-review of 22-Nov-2026 (track sync-speed-tally):
  1. the file runs through the API stand-in as one query, twice
  2. tally_monthly comes in a steady order (ledger, month): TCloud.rpcAll reads it a thousand rows at a time
  3. a book's "unseen" mark is stamped with the time of the write (clock_timestamp), not the start of its transaction
  4. gst_share_unseen_settle never removes a mark a voucher write still holds (a long write: its rows not visible to the
     settle's snapshot): it is skipped, and looked at again in the next minute
  5. settle: a book with nothing unseen is unmarked; a book with an unseen voucher keeps its mark; the sweep still finds it
RED_WITHOUT_FIX=1 is not offered: run it on the file before the re-review (git show) to see 2-4 fail."""
import os, re, sys, subprocess, shutil, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.dirname(HERE)
M209 = os.environ.get("M209_FILE") or os.path.join(ROOT, "server", "tally-cloud", "migration-209-sync-speed.sql")
PORT = int(os.environ.get("PG209_PORT", "31209"))
BIN = pg_stand.BIN
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
t204 = open(os.path.join(HERE, "run_migration204.py")).read()
DDL = re.search(r'\nDDL = r"""(.*?)\n"""', t204, re.S).group(1)
STUBS = re.search(r'\nSTUBS = r"""(.*?)\n"""', t204, re.S).group(1)
FIRM, OWNER = "f0000000-0000-0000-0000-000000000204", "11111111-0000-0000-0000-000000000204"
BA, BB = "a0000000-0000-0000-0000-0000000002a9", "b0000000-0000-0000-0000-0000000002b9"
SEED = """
alter table tally_ledger_day add column if not exists merged_into text;
insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values
 ('%(a)s', '%(f)s', 'c-209a', 'Made-up Ninth Co', '2025-04-01', '2025-04-01'),
 ('%(b)s', '%(f)s', 'c-209b', 'Made-up Tenth Co', '2025-04-01', '2025-04-01');
-- ledgers written in no order, over several months
insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
select '%(a)s', '%(f)s', 'Ledger ' || lpad(((i * 7919) %% 400)::text, 3, '0'), date '2025-04-01' + ((i * 31) %% 300), i, i, 0, 1
  from generate_series(1, 4000) i on conflict do nothing;
-- book A: every voucher seen; book B: one voucher not seen
insert into tally_vouchers (book_id, firm_id, guid, day) select '%(a)s', '%(f)s', 'ga-' || i, date '2025-05-01' from generate_series(1, 50) i;
insert into tally_vouchers (book_id, firm_id, guid, day) select '%(b)s', '%(f)s', 'gb-' || i, date '2025-05-01' from generate_series(1, 50) i;
insert into calc_seen (book_id, firm_id, calc, kind, key) select book_id, firm_id, 'gst-share', 'entry', guid from tally_vouchers where guid <> 'gb-50';
insert into calc_seen (book_id, firm_id, calc, kind, key, data) select book_id, '%(f)s', 'gst-share', 'book', 'ctx', '{"engine": "e1"}' from tally_books where book_id in ('%(a)s', '%(b)s');
insert into gst_share_engine (one, engine) values (true, 'e1');
""" % {"a": BA, "b": BB, "f": FIRM}
def psql_proc(db):
    return subprocess.Popen(["runuser", "-u", "postgres", "--", BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
text = open(M209).read()
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
db = pg_stand.start(PORT)
try:
    db.sql(STUBS); db.sql(DDL); db.sql(SEED)
    # tally_monthly as staging has it (migration.sql: 209 adds its order only)
    mt = open(os.path.join(ROOT, "server", "tally-cloud", "migration.sql")).read()
    i = mt.index("create or replace function public.tally_monthly("); db.sql(mt[i:mt.index("end $$;", i) + 7])
    print("== 1. the file through the API, twice")
    api = ["python3", os.path.join(HERE, "api_standin.py"), str(db.port), M209]
    env = dict(os.environ, STANDIN_PGOPTIONS="-c check_function_bodies=off")   # (tally_post_own_words names bridge tables the stand has not)
    for i in (1, 2):
        r = subprocess.run(api, capture_output=True, text=True, env=env)
        ok(r.returncode == 0 and not r.stdout.strip().startswith("{"), "time %d%s" % (i, "" if not r.stdout.strip().startswith("{") else ": " + r.stdout[-400:]))

    print("== 2. tally_monthly in a steady order")
    rows = db.rows("set enable_sort = off; set enable_indexscan = off; set enable_bitmapscan = off; set enable_indexonlyscan = off;\nselect ledger, ym from tally_monthly('c-209a', '2025-04-01', '2026-03-31')", uid=OWNER)
    keys = [(r["ledger"], r["ym"]) for r in rows]
    ok(len(keys) > 1000 and keys == sorted(keys), "ordered by ledger, month (%d rows)" % len(keys))

    print("== 3. the mark's time is the write's own")
    db.sql("delete from gst_share_unseen;")
    got = db.one("begin; create temp table z on commit drop as select 1 x from pg_sleep(1.5); insert into tally_vouchers (book_id, firm_id, guid, day) values ('%s', '%s', 'ga-late', '2025-05-02');"
                 " select (select at from gst_share_unseen where book_id = '%s') > now() + interval '1 second'; rollback;" % (BA, FIRM, BA))
    ok(got == "t", "a write 1.5 s into its transaction: the mark has the write's time (%s)" % got)

    print("== 4. a long voucher write holding the mark")
    db.sql("delete from gst_share_unseen; insert into gst_share_unseen (book_id, at) values ('%s', now() - interval '20 minutes');" % BA)
    a = psql_proc(db)
    # (a write whose transaction began long ago: its upsert left the mark old, as now() does in a 10-minute transaction)
    a.stdin.write("begin;\ninsert into tally_vouchers (book_id, firm_id, guid, day) values ('%s', '%s', 'ga-long', '2025-05-03');\n"
                  "update gst_share_unseen set at = now() - interval '10 minutes' where book_id = '%s';\nselect pg_sleep(0.01);\n" % (BA, FIRM, BA))
    a.stdin.flush(); time.sleep(1.0)
    b = psql_proc(db)
    b.stdin.write("select gst_share_unseen_settle();\n"); b.stdin.close()
    time.sleep(1.5)
    a.stdin.write("commit;\n"); a.stdin.close(); a.wait(30)
    b.wait(30); bo, be = b.stdout.read(), b.stderr.read()
    left = db.one("select count(*) from gst_share_unseen where book_id = '%s'" % BA)
    ok(left == "1", "the mark stays while the write holds it (settle said %s%s)" % (bo.strip(), (" " + be.strip()) if be.strip() else ""))
    due = [r["book_id"] for r in db.rows("select book_id from gst_share_books_due(5)")]
    ok(BA in due, "the sweep then finds the book with the new voucher (%s)" % due)

    print("== 5. settle")
    db.sql("insert into calc_seen (book_id, firm_id, calc, kind, key) values ('%s', '%s', 'gst-share', 'entry', 'ga-long') on conflict do nothing;"
           " delete from gst_share_unseen; insert into gst_share_unseen (book_id, at) values ('%s', now() - interval '20 minutes'), ('%s', now() - interval '20 minutes');" % (BA, FIRM, BA, BB))
    n = db.one("select gst_share_unseen_settle()")
    left = sorted(r["book_id"] for r in db.rows("select book_id from gst_share_unseen"))
    ok(n == "1" and left == [BB], "the book with nothing unseen unmarked, the other kept (%s, %s)" % (n, left))
    due = [r["book_id"] for r in db.rows("select book_id from gst_share_books_due(5)")]
    ok(BB in due and BA not in due, "the sweep finds the book with an unseen voucher only (%s)" % due)
    ok("for update of u skip locked" in code and "clock_timestamp()" in code, "the file: settle skips a mark being written; marks stamped with clock_timestamp()")
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%d failed" % len(fails) if fails else "\nall ok"); sys.exit(1 if fails else 0)
