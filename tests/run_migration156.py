"""python3 run_migration156.py - server/tally-cloud/migration-156-reliability.sql (11-Nov-2026, the reliability audit,
cloud item C3: tally_fetch_summary built one JSON row per entry fetched today, each with its own sum over tally_lines,
only to count them). On a throwaway PostgreSQL (pg_stand, port 31156 unless PG156_PORT; never a real database), built
as run_migration133.py builds it, through 133, then 156 (twice). Made-up rows only. Written before the file. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate / alter table), names no
     real database; replaces ONE function (tally_fetch_summary, same arguments), adds one index (if not exists); runs
     twice; the function's grants as 133 set them (authenticated and service_role; not anon, not public); still STABLE,
     SECURITY DEFINER, search_path public, pg_temp; the helpers' grants untouched (tally_today_rows: nobody).
  1. THE SAME ANSWER, byte for byte: 133's function is kept in the stand under another name (its own text, only the
     name changed) and both are asked in ONE statement (the same now()), for: the whole firm, each book alone, a book
     with nothing, another firm, a signed-in person of no firm (refused the same), and under two session time zones.
     The made-up rows cover: every recorder event (counted and not), every state, applied_at missing (received_at
     counts), times at the day's first instant and one microsecond before it, whole-second and fractional times (the
     "last" time is the largest TEXT, as before), an entry with no voucher, both kinds of fetch-log rows.
  2. the new function no longer builds the rows (it does not call tally_today_rows) and today's counts read the new
     index's shape; with 6,000 made-up rows of today the answers still agree and the new one is not slower.
  3. tally_today_from_tally (not changed) still lists the same rows, its counts equal to the summary's.
RED_WITHOUT_156=1: the same checks without the file (they fail)."""
import os, re, sys, json, time, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand, csv
csv.field_size_limit(1 << 28)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql", "migration-63-recorder-repeat.sql",
                                           "migration-98-period-pull.sql", "migration-133-fetch-check.sql")]
M = os.environ.get("M156_FILE") or os.path.join(SQLDIR, "migration-156-reliability.sql")
RED = os.environ.get("RED_WITHOUT_156") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, STAFF, OTHER, NOBODY = "99999999-9999-9999-9999-999999999156", "88888888-8888-8888-8888-888888888156", "55555555-5555-5555-5555-555555555156", "55555555-5555-5555-5555-555555555157", "44444444-4444-4444-4444-444444444156", "33333333-3333-3333-3333-333333333156"
B, B3, B2 = "819d4a59-4cee-4bf7-8f8c-000000000156", "819d4a59-4cee-4bf7-8f8c-000000000157", "819d4a59-4cee-4bf7-8f8c-000000000158"
BE = "819d4a59-4cee-4bf7-8f8c-000000000159"                      # a book of the firm with nothing at all
DV, DV2 = "dddddddd-0000-4000-8000-000000000156", "dddddddd-0000-4000-8000-000000000157"
T0 = "((date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata')"      # India's day, as the function works it out

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    ok("delete from" not in code and not re.search(r"\b(drop|truncate|update|insert)\b", code) and not re.search(r"\balter\s+table\b", code), "0. add-only: no delete from, drop, truncate or alter table; no row written")
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    FNS = sorted(re.findall(r"create or replace function public\.(\w+)\s*\(", text))
    ok(FNS == ["tally_fetch_summary"] and "create or replace function public.tally_fetch_summary(p_book uuid) returns jsonb" in text, "0. one function replaced, same arguments and result (%s)" % FNS)
    ok(not re.search(r"\bcreate\s+(table|type|trigger|policy|view)\b", code), "0. no table, type, trigger, policy or view made")
    idx = re.findall(r"create (unique )?index (if not exists )?(?:concurrently )?(\w+)", code)
    ok(len(idx) == 1 and idx[0][0] == "" and idx[0][1] == "if not exists ", "0. one index, if not exists (%s)" % idx)
    ok(re.search(r"revoke all on function public\.tally_fetch_summary\(uuid\) from public, anon;", text) is not None
       and re.search(r"grant execute on function public\.tally_fetch_summary\(uuid\) to authenticated, service_role;", text) is not None, "0. the grants are written out (as 133: authenticated and service_role; not public, not anon)")
    ok("tally_today_rows" not in code, "2. the function no longer builds today's rows (no call of tally_today_rows)")

db = pg_stand.start(int(os.environ.get("PG156_PORT") or 31156))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
APPU = lambda s, uid=OWNER: j(s, uid, "authenticated")
def both(arg, uid=OWNER, tz="UTC"):
    """the old and the new answer as text, asked in ONE statement (the same now(), the same snapshot)"""
    pre = "set fincom.role = 'authenticated';\nset timezone = %s;\n" % q(tz)
    try: r = db.rows(pre + "select tally_fetch_summary_133(%s)::text as old, tally_fetch_summary(%s)::text as new" % (arg, arg), uid)
    except RuntimeError as e: return ("error: " + str(e)[-300:], None)
    return (r[0]["old"], r[0]["new"]) if r else (None, None)
def same(arg, uid, what, tz="UTC", must=None):
    o, n = both(arg, uid, tz)
    ok(o is not None and n is not None and o == n and (must is None or must(json.loads(o))),
       "1. byte for byte the same: %s (%d bytes, md5 %s%s)" % (what, len(o or ""), hashlib.md5((o or "").encode()).hexdigest()[:12], "" if o == n else "; OLD %s ... NEW %s" % (str(o)[:300], str(n)[:300])))
    return json.loads(o) if o and o.startswith("{") else {}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'MADE UP CO', '2020-04-01', '2020-03-31'), (%(B3)s, %(F)s, 'c2', 'ANOTHER MADE UP CO', '2020-04-01', '2020-03-31'),
        (%(BE)s, %(F)s, 'c3', 'EMPTY MADE UP CO', '2020-04-01', '2020-03-31'), (%(B2)s, %(F2)s, 'c9', 'OTHER CO', '2020-04-01', '2020-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'MADE UP CO', '{"choices": {}}'), ('c2', %(F)s, 'ANOTHER MADE UP CO', '{"choices": {}}');"""
           % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "X": q(OTHER), "B": q(B), "B3": q(B3), "BE": q(BE), "B2": q(B2)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info) values (%s, %s, 'MADEUP-PC1', 'kh156', %s), (%s, %s, 'MADEUP-PC2', 'kh157', '{}'::jsonb) on conflict do nothing;
      insert into tally_companies (firm_id, company, client_id, device_id, book_id) values (%s, 'MADE UP CO', 'c1', %s, %s) on conflict do nothing;"""
           % (q(DV), q(F), js({"beat": {"open": ["MADE UP CO", {"name": " another made up co "}]}, "computer": "MADEUP-PC1"}), q(DV2), q(F), q(F), q(DV2), q(B)))
    # 133's function, kept under another name: its own text as the database holds it, only the name changed
    old_def = db.one("select pg_get_functiondef('public.tally_fetch_summary(uuid)'::regprocedure)")
    ok("tally_today_rows(b.book_id, t0)" in old_def, "the stand holds 133's function before 156 (it builds the rows)")
    db.sql(old_def.replace("FUNCTION public.tally_fetch_summary(", "FUNCTION public.tally_fetch_summary_133(", 1) + ";\ngrant execute on function public.tally_fetch_summary_133(uuid) to authenticated, service_role;")
    acl_before = db.one("select proacl::text from pg_proc where oid = 'public.tally_fetch_summary(uuid)'::regprocedure")
    rows_acl_before = db.one("select proacl::text from pg_proc where oid = 'public.tally_today_rows(uuid, timestamptz)'::regprocedure")
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "156 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))

    print("== 0. the function as the database holds it")
    p = (db.rows("select provolatile, prosecdef, proconfig::text cfg, proacl::text acl, prosrc from pg_proc where oid = 'public.tally_fetch_summary(uuid)'::regprocedure") or [{}])[0]
    ok(p.get("provolatile") == "s" and p.get("prosecdef") in ("t", "true") and "search_path=public, pg_temp" in (p.get("cfg") or ""), "0. STABLE, SECURITY DEFINER, search_path public, pg_temp (%s)" % p.get("cfg"))
    ok(p.get("acl") == acl_before, "0. the same grants as before the file (%s)" % p.get("acl"))
    ex = lambda rl: db.one("select has_function_privilege(%s, 'public.tally_fetch_summary(uuid)', 'execute')" % q(rl)) in ("t", "true")
    ok(ex("authenticated") and ex("service_role") and not ex("anon"), "0. authenticated and service_role may call it; anon may not")
    ok(db.one("select proacl::text from pg_proc where oid = 'public.tally_today_rows(uuid, timestamptz)'::regprocedure") == rows_acl_before, "0. tally_today_rows' grants untouched (nobody)")
    ok("tally_today_rows" not in (p.get("prosrc") or "tally_today_rows"), "2. the function in the database does not call tally_today_rows")
    ix = db.rows("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'tally_recorder_lines' and indexdef ilike '%COALESCE(applied_at, received_at)%'")
    ok(len(ix) == 1 and "state = 'applied'" in ix[0]["indexdef"] and "book_id" in ix[0]["indexdef"], "2. the index for today's applied lines of a book (%s)" % (ix[0]["indexdef"] if ix else "none"))

    print("== 1. the same answer, byte for byte")
    same("null", OWNER, "before any row (the firm's three books)", must=lambda o: len(o.get("books") or []) == 3)
    # a period chosen and an upload's days queued for one book, so "pull" and "check" are there too
    APPU("select tally_period_choose(%s, '2024-04-01', 'year')::text" % q(B))
    j("select tally_check_queue(%s, array['2024-04-10', '2024-04-11']::date[], 'upload')::text" % q(B))
    # vouchers and lines for some of the entries (the old function joined them; the counts must not care)
    db.sql("""insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party) select %(B)s, %(F)s, 'g-' || i, date '2024-04-10', i, 'Sales', i::text, 'Made-up Traders' from generate_series(1, 40) i where i %% 3 <> 0;
      insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) select %(B)s, %(F)s, 'g-' || i, date '2024-04-10', l.ledger, l.amount from generate_series(1, 40) i, (values ('Made-up Traders', -118.0), ('Sales', 118.0)) l(ledger, amount) where i %% 3 <> 0;"""
           % {"B": q(B), "F": q(F)})
    # the recorder's lines: every event and state, at the edges of India's day, whole-second and fractional times
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, pc, tally_user, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, applied_at, received_at)
      select %(F)s, 'c1', %(B)s, %(DV)s, 'MADEUP-PC1', 'madeup-user', e.event, case when e.event like 'ledger%%' then null else 'g-' || (1 + (row_number() over ()) %% 45) end, 1000 + row_number() over (), 'Sales', 'S-' || row_number() over (), date '2024-04-10',
             s.state, t.applied, coalesce(t.received, %(T0)s + interval '1 hour')
        from (values ('created'), ('altered'), ('deleted'), ('cancelled'), ('imported'), ('ledger_created'), ('ledger_renamed')) e(event),
             (values ('applied'), ('received'), ('duplicate'), ('stale'), ('held'), ('failed')) s(state),
             (values (%(T0)s, null::timestamptz),                                            -- the day's first instant: counted
                     (%(T0)s - interval '1 microsecond', null),                               -- one microsecond before: not
                     (null, %(T0)s + interval '3 hours'),                                     -- never applied_at: received_at counts
                     (null, %(T0)s - interval '5 hours'),                                     -- received yesterday
                     (%(T0)s + interval '2 hours', %(T0)s - interval '1 day'),                 -- applied today, received yesterday
                     (%(T0)s - interval '1 day', %(T0)s + interval '2 hours'),                 -- applied yesterday, received today: not
                     (%(T0)s + interval '9 hours 0.5 seconds', null),                         -- fractional seconds
                     (%(T0)s + interval '9 hours 0.123456 seconds', null),
                     (%(T0)s + interval '9 hours', null),                                     -- whole second (JSON text has no fraction)
                     (%(T0)s + interval '23 hours 59 minutes 59.999999 seconds', null)) t(applied, received);"""
           % {"F": q(F), "B": q(B), "DV": q(DV), "T0": T0})
    db.sql("""insert into tally_fetch_log (book_id, firm_id, at, via, what, guid, day)
      select %(B)s, %(F)s, t.at, v.via, w.what, 'g-' || (1 + (row_number() over ()) %% 45), case when (row_number() over ()) %% 2 = 0 then date '2024-04-10' end
        from (values ('older'), ('check')) v(via), (values ('added'), ('changed'), ('deleted')) w(what),
             (values (%(T0)s), (%(T0)s - interval '1 microsecond'), (%(T0)s + interval '4 hours 0.25 seconds'), (%(T0)s + interval '4 hours'), (%(T0)s - interval '2 days')) t(at);"""
           % {"F": q(F), "B": q(B), "T0": T0})
    # the second book: fetch-log rows only, the last of them a whole second after a fractional one (the largest TEXT is not the latest time in every collation)
    db.sql("""insert into tally_fetch_log (book_id, firm_id, at, via, what, guid, day) values
      (%(B3)s, %(F)s, %(T0)s + interval '6 hours 0.9 seconds', 'older', 'added', 'h-1', '2024-05-01'), (%(B3)s, %(F)s, %(T0)s + interval '6 hours', 'older', 'added', 'h-2', null),
      (%(B3)s, %(F)s, %(T0)s + interval '6 hours 1 second', 'check', 'deleted', 'h-3', null);
      insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, event, object_guid, alter_id, state, applied_at, received_at) values
      (%(F2)s, 'c9', %(B2)s, null, 'created', 'x-1', 1, 'applied', %(T0)s + interval '1 hour', %(T0)s + interval '1 hour');"""
           % {"F": q(F), "F2": q(F2), "B3": q(B3), "B2": q(B2), "T0": T0})
    n_rec = int(db.one("select count(*) from tally_recorder_lines where book_id = %s" % q(B))); n_log = int(db.one("select count(*) from tally_fetch_log where book_id = %s" % q(B)))
    print("  made-up rows of the first book: %d recorder lines, %d fetch-log rows" % (n_rec, n_log))
    exp = {r["k"]: r["n"] for r in db.rows("""select 'tally' k, count(*)::text n from tally_recorder_lines where book_id = %(B)s and state = 'applied' and event in ('created', 'altered', 'deleted', 'cancelled') and coalesce(applied_at, received_at) >= %(T0)s
      union all select via, count(*)::text from tally_fetch_log where book_id = %(B)s and at >= %(T0)s group by via""" % {"B": q(B), "T0": T0})}
    def counts_right(o):
        t = next((x for x in o.get("books") or [] if x.get("book") == B), {}).get("today") or {}
        return t.get("added") + t.get("changed") + t.get("deleted") == int(exp["tally"]) and t.get("deleted") == 2 * t.get("added") > 0 and t.get("older") == int(exp["older"]) > 0 and t.get("corrected") == int(exp["check"]) > 0 and bool(t.get("last"))
    whole = same("null", OWNER, "the whole firm (owner)", must=lambda o: counts_right(o) and len(o.get("books") or []) == 3)
    bk = next((x for x in whole.get("books") or [] if x.get("book") == B), {})
    print("  today of the first book: %s" % bk.get("today"))
    ok(bool(bk.get("pull")) and bool(bk.get("check")) and len(bk.get("devices") or []) == 2, "1. the fixture fills every part: pull, check, devices (%s)" % sorted(k for k in bk if bk.get(k)))
    be = next((x for x in whole.get("books") or [] if x.get("book") == BE), {})
    ok(be.get("today") == {"added": 0, "changed": 0, "deleted": 0, "older": 0, "corrected": 0, "last": None} and be.get("pull") is None and be.get("check") is None and be.get("devices") == [], "1. a book with nothing: zeros, last null (%s)" % be.get("today"))
    same("null", STAFF, "the whole firm (staff)")
    same(q(B) + "::uuid", OWNER, "the first book alone", must=lambda o: counts_right(o) and len(o.get("books") or []) == 1)
    same(q(B3) + "::uuid", OWNER, "the second book alone (fetch-log rows only)", must=lambda o: (o["books"][0]["today"]["older"], o["books"][0]["today"]["corrected"], o["books"][0]["today"]["added"]) == (2, 1, 0))
    same(q(BE) + "::uuid", OWNER, "the book with nothing, alone")
    same(q(B2) + "::uuid", OWNER, "another firm's book asked by this firm (no book)", must=lambda o: o.get("books") == [])
    same("null", OTHER, "the other firm", must=lambda o: [x.get("book") for x in o.get("books") or []] == [B2] and o["books"][0]["today"]["added"] == 1)
    same("null", OWNER, "the whole firm, the session's time zone Asia/Kolkata", tz="Asia/Kolkata", must=counts_right)
    same("null", OWNER, "the whole firm, the session's time zone America/St_Johns", tz="America/St_Johns", must=counts_right)
    o, n = both("null", NOBODY)
    ok(n is None and "not allowed" in str(o), "1. a signed-in person of no firm is refused (%s)" % str(o)[-80:])
    ok("not allowed" in str(APPU("select tally_fetch_summary(null)::text", NOBODY)), "1. ... by the new function alone too")

    print("== 2. many rows of today")
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, applied_at, received_at)
      select %(F)s, 'c1', %(B)s, %(DV)s, (array['created', 'altered', 'deleted', 'cancelled'])[1 + i %% 4], 'g-' || (i %% 40), 50000 + i, 'Sales', 'S-' || i, date '2024-04-10', 'applied',
             %(T0)s + (i * 7919 %% 86400000) * interval '1 millisecond', %(T0)s from generate_series(1, 3000) i;
      insert into tally_fetch_log (book_id, firm_id, at, via, what, guid, day)
      select %(B)s, %(F)s, %(T0)s + (i * 104729 %% 86400000) * interval '1 millisecond', (array['older', 'check'])[1 + i %% 2], (array['added', 'changed', 'deleted'])[1 + i %% 3], 'g-' || (i %% 40), date '2024-04-10' from generate_series(1, 3000) i;
      analyze tally_recorder_lines; analyze tally_fetch_log; analyze tally_lines; analyze tally_vouchers;""" % {"F": q(F), "B": q(B), "DV": q(DV), "T0": T0})
    same("null", OWNER, "the whole firm with 6,000 more rows of today", must=lambda o: next(x for x in o["books"] if x["book"] == B)["today"]["older"] >= 1500)
    same("null", OWNER, "... and under Asia/Kolkata", tz="Asia/Kolkata")
    def timed(fn):
        best = None
        for _ in range(5):
            r = db.rows("set fincom.uid = %s; set fincom.role = 'authenticated';\nselect clock_timestamp() as a, length(%s(null)::text) as n, clock_timestamp() as b" % (q(OWNER), fn))
            ms = float(db.one("select extract(epoch from (%s::timestamptz - %s::timestamptz)) * 1000" % (q(r[0]["b"]), q(r[0]["a"]))))
            best = ms if best is None else min(best, ms)
        return best
    t_old, t_new = timed("tally_fetch_summary_133"), timed("tally_fetch_summary")
    print("  best of 5 on the stand: old %.1f ms, new %.1f ms" % (t_old, t_new))
    ok(t_new <= t_old, "2. the new function is not slower with a day's rows (old %.1f ms, new %.1f ms)" % (t_old, t_new))
    plan = "\n".join(r["QUERY PLAN"] for r in db.rows("""set enable_seqscan = off; explain select count(*) from tally_recorder_lines l where l.book_id = %s and l.state = 'applied'
      and l.event in ('created', 'altered', 'deleted', 'cancelled') and coalesce(l.applied_at, l.received_at) >= now() - interval '1 hour'""" % q(B)))
    ok(bool(ix) and ix[0]["indexname"] in plan, "2. today's applied lines of a book are read by the new index (%s)" % (plan.splitlines()[1].strip() if len(plan.splitlines()) > 1 else plan)[:160])

    print("== 3. Today from Tally (not changed) agrees")
    t3 = APPU("select tally_today_from_tally(%s)::text" % q(B)); s3 = next((x for x in APPU("select tally_fetch_summary(%s)::text" % q(B)).get("books") or [{}]), {}).get("today") or {}
    ok(t3.get("ok") is True and t3.get("counts") == {k: s3.get(k) for k in ("added", "changed", "deleted", "older", "corrected")} and t3.get("last") == s3.get("last") and t3.get("total") == sum((t3.get("counts") or {}).values()),
       "3. the list's counts and last time equal the summary's (%s, last %s)" % (t3.get("counts"), t3.get("last")))
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
