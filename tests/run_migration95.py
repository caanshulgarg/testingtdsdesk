"""python3 run_migration95.py - migration-95-gst-2b-match (17-Oct-2026, branch next-2b-automatch, round 72b): the tables of the
2B matching that runs by itself (gst_2b_inputs, gst_2b_runs, gst_2b_decisions) and its queue functions (gst2b_enqueue,
gst2b_take), on a throwaway PostgreSQL (pg_stand, port 30950; never a real database).
  0. the file: one transaction, add-only (no delete / drop / truncate / alter table but enabling RLS), names no real database.
  1. runs, and runs a second time with nothing changed.
  2. a member reads only the firm's own rows of the three tables; a member cannot write any of them.
  3. the checks: a GSTIN, year, period, side, why, status or decision that is not one is refused.
  4. the queue: a 2B fetched before the app sent the purchases queues nothing; after, one run for the year of the period
     (March 2027 is 2026-27, April 2027 is 2027-28); a second fetch joins the waiting run; gst2b_take takes it once.
RED_WITHOUT_95=1: the same checks without running the file (1 to 4 fail)."""
import os, re, sys, hashlib, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M95 = os.path.join(HERE, "..", "server", "gst-2b-match", "migration-95-gst-2b-match.sql")
RED = os.environ.get("RED_WITHOUT_95") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M95).read()
print("  md5 of %s: %s" % (os.path.basename(M95), hashlib.md5(text.encode()).hexdigest()))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and not re.search(r"\balter\s+table\b(?!\s+public\.gst_2b_\w+\s+enable row level security)", code), "0. add-only")
ok(not re.search(r"supabase\.co|https?://", low), "0. names no real database")
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
U1, U2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
G1, G2 = "09AANFG3202D1ZR", "07AAACT1234A1Z5"
db = pg_stand.start(int(os.environ.get("PG95_PORT") or 30950))
def fails_sql(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
def one(s):
    try: return db.one(s)
    except RuntimeError as e: return "ERROR " + str(e)[:200]
try:
    db.sql("insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'staff'), ('%s', '%s', 'owner');" % (F1, F2, U1, F1, U2, F2) +
           " grant usage on schema auth to authenticated; grant select on members to authenticated;" +
           " alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated;" +
           " alter default privileges in schema public grant execute on functions to anon, authenticated;")
    if not RED:
        db.sql(text); db.sql(text)
    have = one("select count(*) from information_schema.tables where table_name in ('gst_2b_inputs', 'gst_2b_runs', 'gst_2b_decisions')")
    fns = one("select count(*) from pg_proc where proname in ('gst2b_enqueue', 'gst2b_take')")
    ok(have == "3" and fns == "2", "1. the three tables and two functions there after running the file twice")
    ins = lambda f, g: ("insert into gst_2b_inputs (firm_id, gstin, fy, side, period, client_id, rows, n) values ('%s', '%s', '2026-27', 'books', '', 'c-%s', '[]', 0);" % (f, g, g) +
        "insert into gst_2b_runs (firm_id, client_id, gstin, fy, why, status) values ('%s', 'c-%s', '%s', '2026-27', 'match again', 'done');" % (f, g, g) +
        "insert into gst_2b_decisions (firm_id, gstin, fy, pair_id, decision) values ('%s', '%s', '2026-27', 'k1>v1', 'accept');" % (f, g))
    e = fails_sql(ins(F1, G1) + ins(F2, G2))
    ok(not e, "1. the function (as the database owner) writes all three" + (": " + e[:160] if e else ""))
    seen = {}
    for t in ("gst_2b_inputs", "gst_2b_runs", "gst_2b_decisions"):
        try: seen[t] = [r.get("gstin") for r in db.rows("set role authenticated; select gstin from %s" % t, U1)]
        except RuntimeError as x: seen[t] = ["ERR " + str(x)[:80]]
    ok(all(v == [G1] for v in seen.values()), "2. a member reads only the firm's own inputs, runs and decisions: %s" % json.dumps(seen))
    w = [fails_sql("set role authenticated; insert into gst_2b_decisions (firm_id, gstin, fy, pair_id, decision) values ('%s', '%s', '2026-27', 'a>b', 'reject')" % (F1, G1), U1),
         fails_sql("set role authenticated; update gst_2b_runs set line = 'x'", U1),
         fails_sql("set role authenticated; delete from gst_2b_inputs", U1),
         fails_sql("set role authenticated; select gst2b_enqueue('%s', '%s', '092026', 'fetched')" % (F1, G1), U1)]
    ok(all("permission denied" in x for x in w), "2. a member cannot insert, change or remove, nor queue a run: %s" % [x[:60] for x in w])
    bad = [fails_sql("insert into gst_2b_inputs (firm_id, gstin, fy, side, period, client_id) values ('%s', 'NOTAGSTIN', '2026-27', 'books', '', 'c')" % F1),
           fails_sql("insert into gst_2b_inputs (firm_id, gstin, fy, side, period, client_id) values ('%s', '%s', '2026', 'books', '', 'c')" % (F1, G1)),
           fails_sql("insert into gst_2b_inputs (firm_id, gstin, fy, side, period, client_id) values ('%s', '%s', '2026-27', '2b', '2026-09', 'c')" % (F1, G1)),
           fails_sql("insert into gst_2b_inputs (firm_id, gstin, fy, side, period, client_id) values ('%s', '%s', '2026-27', 'sales', '', 'c')" % (F1, G1)),
           fails_sql("insert into gst_2b_runs (firm_id, client_id, gstin, fy, why) values ('%s', 'c', '%s', '2026-27', 'because')" % (F1, G1)),
           fails_sql("insert into gst_2b_runs (firm_id, client_id, gstin, fy, why, status) values ('%s', 'c', '%s', '2026-27', 'opened', 'half')" % (F1, G1)),
           fails_sql("insert into gst_2b_decisions (firm_id, gstin, fy, pair_id, decision) values ('%s', '%s', '2026-27', 'k2>v2', 'maybe')" % (F1, G1)),
           fails_sql("insert into gst_2b_decisions (firm_id, gstin, fy, pair_id, decision) values ('%s', '%s', '2026-27', 'nopair', 'accept')" % (F1, G1))]
    ok(all("check" in b or "violates" in b for b in bad), "3. a wrong GSTIN, year, period, side, why, status or decision is refused")
    # 4. the queue
    G3 = "27AAAPL1234C1ZV"
    q0 = one("select gst2b_enqueue('%s', '%s', '032027', 'fetched')::text" % (F1, G3))
    ok('"queued": false' in q0, "4. a 2B fetched before the app sent the purchases queues nothing (%s)" % q0[:120])
    fails_sql("insert into gst_2b_inputs (firm_id, gstin, fy, side, period, client_id) values ('%s', '%s', '2026-27', 'books', '', 'c-3'), ('%s', '%s', '2027-28', 'books', '', 'c-3')" % (F1, G3, F1, G3))
    q1 = one("select gst2b_enqueue('%s', '%s', '032027', 'fetched')::text" % (F1, G3))
    q2 = one("select gst2b_enqueue('%s', '%s', '012027', 'fetched')::text" % (F1, G3))
    q3 = one("select gst2b_enqueue('%s', '%s', '042027', 'fetched')::text" % (F1, G3))
    ok('"queued": true' in q1 and '"2026-27"' in q1 and '"joined": true' in q2 and '"2027-28"' in q3,
       "4. March 2027 queues 2026-27, January 2027 joins it, April 2027 queues 2027-28: %s | %s | %s" % (q1[:80], q2[:80], q3[:80]))
    took = one("select count(*) from gst2b_take(10)"); again = one("select count(*) from gst2b_take(10)")
    st = one("select string_agg(status || ':' || client_id, ',' order by id) from gst_2b_runs where gstin = '%s'" % G3)
    ok(took == "2" and again == "0" and st == "running:c-3,running:c-3", "4. gst2b_take takes the two waiting runs once (%s, then %s; %s)" % (took, again, st))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
