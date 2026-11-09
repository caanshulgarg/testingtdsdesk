"""python3 run_migration150.py - server/tally-cloud/migration-150-gap-closed-by-days.sql (09-Nov-2026, branch next-gap-close).
On a throwaway PostgreSQL (pg_stand, port 31501 unless PG150_PORT; never a real database): the tables
tally_recorder_gap_check reads, made plain (tally_check_days from migration 133's own text), and migration 47's
tally_recorder_gap_check (staging's live text: the md5 of its pg_get_functiondef as read on 09-Nov-2026). Then 150 (twice).
Made-up rows only: a book whose gap opened 29-Oct (start point 5708, Tally's ALTVCHID 6127, measured 09-Nov).
Checks:
  0. the file: one transaction, lock_timeout 10 s; no table created, altered, dropped or emptied; names no real database;
     47's function text unchanged but the one line marked 150 (and its comment); the grants (service_role only); md5
  1. no day checked: the gap stays open (the copy holding Tally's highest AlterID is never enough alone)
  2. every day 29-Oct..09-Nov (India) done after the gap began, none open or left to upload: the gap closes, as a match
  3. a day checked BEFORE the gap began: stays open
  4. a day open (done_at null), a day left to upload / refused (upload_at), a day with no row: each stays open
  5. supporting conditions: all days done but the copy's highest AlterID below Tally's, or Tally's number moved on since
     the days were read: stays open; a gap seen for the first time (gap_at null) is not closed by the days
  6. the second run of 150 changes nothing (the same function text)"""
import os, re, sys, json, hashlib, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M150 = os.environ.get("M150_FILE") or os.path.join(SQLDIR, "migration-150-gap-closed-by-days.sql")
M47, M133 = os.path.join(SQLDIR, "migration-47-recorder-queue-alerts.sql"), os.path.join(SQLDIR, "migration-133-fetch-check.sql")
LIVE_MD5 = "1f99d30ed5ef0fe69c94d1291ae16f99"    # md5(pg_get_functiondef('public.tally_recorder_gap_check'::regproc)) on staging, 09-Nov-2026
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def fn_of(text, name):
    i = text.index("create or replace function public.%s(" % name); return text[i:text.index("$function$;", i) + len("$function$;")]

text = open(M150).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M150), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
ok(not re.search(r"\b(create table|alter table|drop|truncate|delete from)\b", code), "0. no table created, altered, dropped or emptied")
ok(sorted(re.findall(r"create or replace function public\.(\w+)", text)) == ["tally_recorder_gap_asked", "tally_recorder_gap_check"], "0. two functions")
ok(not re.search(r"supabase\.co|\.supabase\.|https?://", text.lower()), "0. names no real database")
old_fn, new_fn = fn_of(open(M47).read(), "tally_recorder_gap_check"), fn_of(text, "tally_recorder_gap_check")
diff = [l for l in difflib.unified_diff(old_fn.splitlines(), new_fn.splitlines(), lineterm="", n=0) if l[:1] in "+-" and not l.startswith(("+++", "---"))]
ok(diff == ["-  if missing > 0 then",
            "+  -- 150: a gap Tally was asked about day by day since it began, with nothing found missing, is closed (the match below)",
            "+  if missing > 0 and not (lost = 0 and tally_recorder_gap_asked(p_book, c.gap_at, since_, at_, greatest(p_altvchid, coalesce((c.gap->>'tally_altvchid')::bigint, 0)))) then"],
   "0. 47's text unchanged but the one line (%s)" % diff)
for f in ("tally_recorder_gap_asked(uuid, timestamptz, timestamptz, timestamptz, bigint)", "tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)"):
    ok(("revoke all on function public.%s from public, anon, authenticated;" % f) in text and ("grant execute on function public.%s to service_role;" % f) in text, "0. grants of %s as 47's" % f.split("(")[0])

F, B, D = "99999999-9999-9999-9999-999999999150", "11111111-1111-1111-1111-111111111150", "d1500000-0000-0000-0000-000000000001"
SCHEMA = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create or replace function tally_service_or_owner() returns boolean language sql stable as $$ select true $$;
create or replace function tally_post_result_accepted(r jsonb) returns boolean language sql immutable as $$ select coalesce((r->>'ok')::boolean, false) $$;
alter table tally_vouchers add column if not exists fincom_id text, add column if not exists deleted_at timestamptz;
create table tally_sync_cursor (book_id uuid primary key, firm_id uuid, last_voucher_alterid bigint, start_at timestamptz, start_device uuid, start_guid text, company_guid text,
  gap jsonb, gap_at timestamptz, updated_at timestamptz, state text, state_at timestamptz, state_why text, match_alter bigint, match_start timestamptz, match_at timestamptz,
  last_match_at timestamptz, recorder_max_alter bigint, recorder_last_at timestamptz);
create table tally_days (book_id uuid, day date, alter_max bigint, at timestamptz);
create table tally_post_jobs (id uuid primary key, firm_id uuid, company text, taken_at timestamptz, created_at timestamptz, results jsonb);
create table tally_post_windows (id bigserial primary key, job_id uuid, book_id uuid, a0 bigint, a1 bigint, created_vch integer, created_mst integer, company_guid text, at timestamptz);
create table tally_post_ids (job_id uuid, firm_id uuid, fincom_id text, accepted_at timestamptz, released_at timestamptz, matched_at timestamptz, matched_alter bigint);
create table tally_recorder_lines (book_id uuid, device_id uuid, state text, held_why text, event text, object_guid text, alter_id bigint, received_at timestamptz);
"""
db = pg_stand.start(int(os.environ.get("PG150_PORT") or 31501))
try:
    db.sql(SCHEMA)
    m = re.search(r"create table if not exists public\.tally_check_days \(.*?\n\);", open(M133).read(), re.S)
    ok(m is not None, "migration 133's tally_check_days found"); db.sql(m.group(0))
    db.sql(old_fn + "\nrevoke all on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;\ngrant execute on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) to service_role;")
    defn = lambda: db.one("select pg_get_functiondef('public.tally_recorder_gap_check'::regproc)")
    ok(hashlib.md5(defn().encode()).hexdigest() == LIVE_MD5, "before: 47's text is staging's live tally_recorder_gap_check (md5 %s)" % LIVE_MD5)
    db.sql("""insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%s, %s, 'c1', 'ZZ CO', '2026-04-01');
      insert into tally_vouchers (book_id, firm_id, guid, day, alter_id) values (%s, %s, 'g-6127', '2026-11-09', 6127), (%s, %s, 'g-5000', '2026-10-20', 5000);""" % (q(B), q(F), q(B), q(F), q(B), q(F)))
    db.sql(text)
    first = defn()
    db.sql(text)
    ok(defn() == first, "6. the second run: the same function text")
    acl = db.rows("select proname, proacl::text as acl from pg_proc where proname in ('tally_recorder_gap_check', 'tally_recorder_gap_asked') order by 1")
    ok(all("service_role=X" in r["acl"] and "anon" not in r["acl"] and "authenticated" not in r["acl"] and "=X/" not in r["acl"].split(",")[0][:3] for r in acl) and len(acl) == 2, "0. both executable by service_role only (%s)" % acl)

    AT = "'2026-11-09 15:25:27+00'"
    def reset(gap_at="'2026-10-29 11:13:41+00'"):
        db.sql("""delete from tally_sync_cursor; delete from tally_check_days;
          insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, last_match_at, gap, gap_at)
          values (%s, %s, 5708, '2026-10-29 10:58:14+00', '2026-10-29 11:09:14+00', %s, %s);""" % (q(B), q(F), "'{\"tally_altvchid\": 6127}'" if gap_at != "null" else "null", gap_at))
    def days(done="'2026-11-09 15:04:00+00'", skip=(), **one):
        rows = []
        for i in range(12):     # 29-Oct .. 09-Nov
            d = "date '2026-10-29' + %d" % i
            if i in skip: continue
            dn, up = done, "null"
            if i in one.get("before", ()): dn = "'2026-10-28 10:00:00+00'"
            if i in one.get("open", ()): dn = "null"
            if i in one.get("upload", ()): up = "'2026-11-09 15:04:00+00'"
            rows.append("(%s, %s, %s, 'fill', %s, %s, %s)" % (q(B), q(F), d, dn, "case when %s is null then null else true end" % dn, up))
        db.sql("insert into tally_check_days (book_id, firm_id, day, source, done_at, same, upload_at) values " + ", ".join(rows))
    def check(alt=6127, at=AT):
        r = json.loads(db.one("select tally_recorder_gap_check(%s, %s, %d, %s)::text" % (q(B), q(D), alt, at)))
        c = db.rows("select gap is null as closed, match_alter, last_match_at from tally_sync_cursor where book_id = %s" % q(B))[0]
        return r, c
    reset(); r, c = check()
    ok(r.get("missing") == 419 and c["closed"] == "f", "1. no day checked: open, 419 missing (%s)" % r.get("missing"))
    reset(); days(); r, c = check()
    ok(r.get("matched") is True and c["closed"] == "t" and c["match_alter"] == "6127", "2. every day done after the gap began: closed as a match (%s, %s)" % (r, c))
    r, c = check()
    ok(r.get("matched") is True and c["closed"] == "t", "2. the next check matches from there")
    reset(); days(before=(4,)); r, c = check()
    ok(c["closed"] == "f" and r.get("missing") == 419, "3. one day checked before the gap began: open")
    reset(); days(open=(3,)); r, c = check(); ok(c["closed"] == "f", "4. one day open: open")
    reset(); days(upload=(7,)); r, c = check(); ok(c["closed"] == "f", "4. one day left to upload / refused: open")
    reset(); days(skip=(11,)); r, c = check(); ok(c["closed"] == "f", "4. the day of the check never asked: open")
    reset(); days(skip=(0,)); r, c = check(); ok(c["closed"] == "f", "4. the gap's first day never asked: open")
    reset(); days(); r, c = check(alt=6130); ok(c["closed"] == "f" and r.get("missing") == 422, "5. Tally's number moved on after the days were read (6130 > the copy's 6127): open")
    db.sql("update tally_vouchers set alter_id = 6000 where guid = 'g-6127'")
    reset(); days(); r, c = check(); ok(c["closed"] == "f", "5. all days done but the copy's highest AlterID (6000) below Tally's 6127: open")
    db.sql("update tally_vouchers set alter_id = 6127 where guid = 'g-6127'")
    reset("null"); days(); r, c = check(); ok(c["closed"] == "f", "5. a gap seen for the first time (gap_at null): not closed by the days")
except RuntimeError as e:
    ok(False, "the run: %s" % str(e)[-600:])
finally:
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
