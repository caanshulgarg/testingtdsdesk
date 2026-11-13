"""python3 run_migration197.py - migration-197-day-retry (13-Nov-2026, FinCom Bridge 2.5.16; the owner's YES of 13-Nov-2026:
"stops lift by themselves"). On a throwaway PostgreSQL (pg_stand, port 31197 unless PG197_PORT; never a real database),
built as run_migration182.py builds it, then 182 and 197 (twice). Made-up books only. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (one new table with its row security; no drop, delete or
     truncate), names no real database, its grants (the table and the bridge's two functions service_role only; the
     page's status for members); md5; runs twice.
  1. a day stop counts once a day: the 1st holds the day 24 hours; another within 20 hours is the same day's; the 3rd
     separate day marks the day to upload (tally_period_days 'slow3', its words) and an open check day of it too.
  2. tally_period_retry_days: the days held now, not those whose 24 hours are over.
  3. tally_catchup_status: the days left (period days Tally lists entries for that FinCom does not hold whole, open check
     days), those brought in today (finished after they were counted), the days held; nothing for a period paused.
RED_WITHOUT_197=1: the same checks without the file (1-3 fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
src = open(os.path.join(HERE, "run_migration182.py")).read()
ns = {"os": os, "HERE": HERE, "SQLDIR": SQLDIR}
exec(src[src.index("FILES = "):src.index("M = os.environ")], ns)     # 182's own build list (FILES, AFTER)
FILES, AFTER = ns["FILES"], ns["AFTER"] + [os.path.join(SQLDIR, "migration-182-gap-after-post.sql")]
M = os.path.join(SQLDIR, "migration-197-day-retry.sql")
RED = os.environ.get("RED_WITHOUT_197") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-9999-9999-999999999197"
BK = {k: "819d4a59-4cee-4bf7-8f8c-0000000%02d197" % k for k in range(1, 4)}
DV = "dddddddd-0000-4000-8000-000000000197"
OWNER = "55555555-5555-5555-5555-555555555197"
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
FY = datetime.date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
D = lambda n: (TODAY - datetime.timedelta(days=n)).isoformat()

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text) or RED, "the migration file is there")
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
    low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_period_day_retry enable row level security;"], "0. add-only (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|https?://|project[_ ]ref", low), "0. names no real database")
    ok(sorted(re.findall(r"create table if not exists public\.(\w+)", text)) == ["tally_period_day_retry"], "0. one new table")
    ok("grant select, insert, update, delete on public.tally_period_day_retry to service_role;" in text and "revoke all on table public.tally_period_day_retry from public, anon, authenticated;" in text, "0. its own grants (service_role only)")
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == ["tally_catchup_status", "tally_catchup_status_of", "tally_period_day_stop", "tally_period_retry_days"], "0. four new functions, none replaced (%s)" % FNS)
    ok("grant execute on function public.tally_period_day_stop(uuid, date, text) to service_role;" in text and "revoke all on function public.tally_period_day_stop(uuid, date, text) from public, anon, authenticated;" in text
       and "grant execute on function public.tally_period_retry_days(uuid) to service_role;" in text and "revoke all on function public.tally_period_retry_days(uuid) from public, anon, authenticated;" in text, "0. the bridge's two functions: service_role only")
    ok("revoke all on function public.tally_catchup_status_of(uuid) from public, anon, authenticated, service_role;" in text and "grant execute on function public.tally_catchup_status(uuid) to authenticated, service_role;" in text
       and "perform tally_period_member(p_book, false)" in text, "0. the page's status: members of the book's firm only")

db = pg_stand.start(int(os.environ.get("PG197_PORT") or 31197))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing;" % q(F))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));")
    for k, b in BK.items():
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c%d', 'MADE UP %d', %s, %s);" % (q(b), q(F), k, k, q(FY.isoformat()), q((FY - datetime.timedelta(days=1)).isoformat())))
        db.sql("insert into clients (id, firm_id, name, data) values ('c%d', %s, 'MADE UP %d', '{\"choices\": {}}')" % (k, q(F), k))
    db.sql("insert into members values (%s, %s, 'Owner', 'owner', true)" % (q(OWNER), q(F)))
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));""")
    for path in AFTER:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "0. 197 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    B = BK[1]
    print("== 1. a day stop counts once a day")
    a = j("select tally_period_day_stop(%s, %s, 'over2s')::text" % (q(B), q(D(5))))
    ok(a.get("ok") is True and a.get("fails") == 1 and a.get("upload") is False, "1. the first stop: held, not to upload (%s)" % a)
    held = db.rows("select fails, (retry_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute') as day_on from tally_period_day_retry where book_id = %s and day = %s" % (q(B), q(D(5)))) if text else []
    ok(bool(held) and held[0]["day_on"] in (True, "t"), "1. held 24 hours (%s)" % held)
    a = j("select tally_period_day_stop(%s, %s, 'window')::text" % (q(B), q(D(5))))
    ok(a.get("fails") == 1 and a.get("upload") is False, "1. another stop within 20 hours: the same day's try (%s)" % a)
    if text: db.sql("update tally_period_day_retry set last_at = now() - interval '21 hours' where book_id = %s and day = %s" % (q(B), q(D(5))))
    a = j("select tally_period_day_stop(%s, %s, 'over2s')::text" % (q(B), q(D(5))))
    ok(a.get("fails") == 2 and a.get("upload") is False, "1. the 2nd separate day: not to upload yet (%s)" % a)
    if text:
        db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'gap') on conflict do nothing" % (q(B), q(F), q(D(5))))
        db.sql("update tally_period_day_retry set last_at = now() - interval '21 hours' where book_id = %s and day = %s" % (q(B), q(D(5))))
    a = j("select tally_period_day_stop(%s, %s, 'over2s')::text" % (q(B), q(D(5))))
    d5 = datetime.date.fromisoformat(D(5))
    words = "Tally could not send %s in time on 3 days. Upload that day's Day Book to finish it." % d5.strftime("%d-%b-%Y")
    ok(a.get("fails") == 3 and a.get("upload") is True and a.get("words") == words, "1. the 3rd separate day: to upload, its words (%s)" % a)
    pd = db.rows("select upload_why, upload_words, (upload_at is not null) as up from tally_period_days where book_id = %s and day = %s" % (q(B), q(D(5)))) if text else []
    ok(bool(pd) and pd[0]["upload_why"] == "slow3" and pd[0]["upload_words"] == words, "1. the period's day marked (%s)" % pd)
    cd = db.rows("select upload_words, (upload_at is not null) as up from tally_check_days where book_id = %s and day = %s" % (q(B), q(D(5)))) if text else []
    ok(bool(cd) and cd[0]["up"] in (True, "t") and cd[0]["upload_words"] == words, "1. its open check day too (%s)" % cd)

    print("== 2. the days held now")
    j("select tally_period_day_stop(%s, %s, 'over2s')::text" % (q(B), q(D(6))))
    j("select tally_period_day_stop(%s, %s, 'over2s')::text" % (q(B), q(D(7))))
    if text: db.sql("update tally_period_day_retry set retry_at = now() - interval '1 minute' where book_id = %s and day = %s" % (q(B), q(D(7))))
    r = j("select tally_period_retry_days(%s)::text" % q(B))
    want = [(TODAY - datetime.timedelta(days=n)).strftime("%Y%m%d") for n in (5, 6)]
    ok(r == want, "2. the days held: %s (want %s)" % (r, want))
    ok(j("select tally_period_retry_days(%s)::text" % q(BK[2])) == [], "2. another book: none")

    print("== 3. the catch-up's count")
    B3 = BK[3]
    if text:
        db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, part, state) values (%s, %s, %s, 'year', 'going')" % (q(B3), q(F), q(FY.isoformat())))
        # left: 3 days Tally lists entries for that FinCom lacks; one done today after it was counted (brought in); one
        # done when it was counted (FinCom held it whole: not a missed day); one with no entries; one marked to upload
        for n, extra in ((1, ""), (2, ""), (3, ""), (4, "done"), (5, "same"), (6, "empty"), (8, "up")):
            cols = {"": "null, now() - interval '1 hour', null", "done": "now() - interval '1 minute', now() - interval '1 hour', null",
                    "same": "now() - interval '2 hours', now() - interval '2 hours', null", "empty": "null, now(), null", "up": "null, now(), now()"}[extra]
            db.sql("insert into tally_period_days (book_id, firm_id, day, tally_n, done_at, counted_at, upload_at) values (%s, %s, %s, %d, %s)" % (q(B3), q(F), q(D(n)), 0 if extra == "empty" else 4, cols))
        db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'gap'), (%s, %s, %s, 'gap')" % (q(B3), q(F), q(D(1)), q(B3), q(F), q(D(9))))
        db.sql("insert into tally_check_days (book_id, firm_id, day, source, done_at, added) values (%s, %s, %s, 'gap', now(), 2)" % (q(B3), q(F), q(D(10))))
        db.sql("insert into tally_period_day_retry (book_id, firm_id, day, fails, retry_at) values (%s, %s, %s, 1, now() + interval '5 hours')" % (q(B3), q(F), q(D(11))))
    s = j("select tally_catchup_status(%s)::text" % q(B3))
    ok(s.get("ok") is True and s.get("left") == 4 and s.get("n") == 6 and s.get("held") == 1, "3. left 4 (3 period days, 1 check day not also a period day), 6 in all (1 brought in today, 1 check day fixed today), 1 held (%s)" % s)
    if text: db.sql("update tally_period_pulls set state = 'paused' where book_id = %s" % q(B3))
    s = j("select tally_catchup_status(%s)::text" % q(B3))
    ok(s.get("left") == 2 and s.get("n") == 3, "3. the period paused: its days not counted, the check days are (%s)" % s)
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
