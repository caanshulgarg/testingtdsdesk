"""python3 run_migration173.py - migration-173-gst-filing-once (12-Nov-2026, branch next-fix-gst-file-once): the lease and
file_tried_at columns on gst_filings (migration-94) that keep filing through the GST API from sending the set-off or the
filing twice, on a throwaway PostgreSQL (pg_stand, port 30173; never a real database).
  0. the file: one transaction with lock_timeout, add-only (only "add column if not exists"), no status or CHECK changed,
     names no real database.
  1. runs after 94, and a second time with nothing changed; a row made before it keeps its data and is free (busy_until 1970).
  2. the lease as gst-taxpro takes it (update ... where busy_until < now() returning): of two at once, one gets it; the second
     waits for the first's row lock and then finds it taken (0 rows); a write conditional on the holder's token only.
  3. a member still reads only the firm's own rows and cannot write (the lease included).
RED_WITHOUT_173=1: the same checks without running the file (1 to 3 fail)."""
import os, re, sys, time, hashlib, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M94 = os.path.join(HERE, "..", "server", "gst-taxpro", "migration-94-gst-filing.sql")
M173 = os.path.join(HERE, "..", "server", "gst-taxpro", "migration-173-gst-filing-once.sql")
RED = os.environ.get("RED_WITHOUT_173") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M173).read()
print("  md5 of %s: %s" % (os.path.basename(M173), hashlib.md5(text.encode()).hexdigest()))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction, with lock_timeout")
alters = re.findall(r"\balter\s+table\b[^;]*;", code)
stmts = re.sub(r"\b(grant|revoke)\b[^;]*;", "", code)   # grants name privileges (update, truncate); the rest must not
ok("delete from" not in stmts and not re.search(r"\b(drop|truncate|update)\b", stmts) and alters and all(re.search(r"add column if not exists", a) for a in alters), "0. add-only: columns added, nothing dropped or changed")
ok("check" not in code and "status" not in code, "0. no status value or CHECK changed")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", text.lower()), "0. names no real database")
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
U1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
G = "09AAAPZ9999Z1Z5"
db = pg_stand.start(int(os.environ.get("PG173_PORT") or 30173))
def fails_sql(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
KEY = "firm_id = '%s' and gstin = '%s' and form = '3B' and period = '082026'" % (F1, G)
try:
    db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;")
    db.sql("insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'staff');" % (F1, F2, U1, F1) +
           " grant usage on schema auth to authenticated; grant select on members to authenticated;")
    db.sql(open(M94).read())
    db.sql("insert into gst_filings (firm_id, gstin, form, period, status, save_state) values ('%s', '%s', '3B', '082026', 'confirmed', 'P'), ('%s', '%s', '3B', '082026', 'saved', 'P');" % (F1, G, F2, G))
    if not RED:
        e = fails_sql(text) or fails_sql(text)
        ok(not e, "1. runs after 94, and a second time" + (": " + e[-300:] if e else ""))
    cols = {r["column_name"]: r for r in db.rows("select column_name, is_nullable, column_default from information_schema.columns where table_name = 'gst_filings'")}
    ok(all(c in cols for c in ("busy_token", "busy_action", "busy_until", "file_tried_at", "offset_tried_at", "offset_sends")) and cols.get("busy_until", {}).get("is_nullable") == "NO", "1. the six columns, busy_until not null")
    try: old = db.rows("select status, save_state, busy_until < now() as free from gst_filings where " + KEY)
    except RuntimeError as x: old = [{"err": str(x)[:100]}]
    ok(old == [{"status": "confirmed", "save_state": "P", "free": "t"}], "1. a row made before keeps its data and is free: %s" % old)
    # 2. the lease: two at once (the first holds its row lock a moment), one gets it
    take = lambda tok, hold: ("begin; update gst_filings set busy_token = '%s', busy_action = 'proceed', busy_until = now() + interval '10 minutes' where %s and busy_until < now() returning busy_token; select pg_sleep(%s); commit;" % (tok, KEY, hold))
    got = {}
    def run(tok, hold):
        try: got[tok] = [v for r in db.rows(take(tok, hold)) for v in r.values() if str(v).startswith("tok-")]
        except RuntimeError as x: got[tok] = ["err: " + str(x)[:120]]
    t1 = threading.Thread(target=run, args=("tok-a", 1.5)); t1.start(); time.sleep(0.4)
    t2 = threading.Thread(target=run, args=("tok-b", 0)); t2.start(); t1.join(); t2.join()
    ok(got.get("tok-a") == ["tok-a"] and got.get("tok-b") == [], "2. two leases at once: the first gets it, the second (after waiting) gets none: %s" % got)
    try:
        n_other = db.rows("update gst_filings set status = 'proceeded' where %s and busy_token = 'tok-b' returning status" % KEY)
        n_mine = db.rows("update gst_filings set status = 'proceeded' where %s and busy_token = 'tok-a' returning status" % KEY)
        db.sql("update gst_filings set busy_token = null, busy_action = null, busy_until = '1970-01-01' where %s and busy_token = 'tok-a'" % KEY)
        again = db.rows("update gst_filings set busy_token = 'tok-c', busy_until = now() + interval '10 minutes' where %s and busy_until < now() returning busy_token" % KEY)
    except RuntimeError as x: n_other, n_mine, again = ["err"], [], []
    ok(n_other == [] and n_mine == [{"status": "proceeded"}] and again == [{"busy_token": "tok-c"}], "2. a write only under the holder's token; released, the next action takes it")
    # 3. members: read their own, write nothing
    try: seen = db.rows("set role authenticated; select gstin, busy_action from gst_filings", U1)
    except RuntimeError as x: seen = [{"err": str(x)[:100]}]
    ok(len(seen) == 1 and "err" not in seen[0], "3. a member reads only the firm's own row")
    w1 = fails_sql("set role authenticated; update gst_filings set busy_until = '1970-01-01'", U1)
    ok("permission denied" in w1, "3. a member cannot take or free a lease")
    sr = db.one("select has_table_privilege('service_role', 'public.gst_filings', 'update')")
    ok(sr == "t", "3. the service role (the function) may update")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
