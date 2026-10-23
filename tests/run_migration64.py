"""python3 run_migration64.py - migration-64-pages-live (07-Oct-2026, next release, branch next-realtime): Look up, the
ledgers and Sync activity refresh by themselves. On throwaway PostgreSQL (pg_stand, port 30640 unless PG64_PORT; never a
real database), built 32 -> ... -> 60 in staging's order, with a publication named supabase_realtime as Supabase makes it
(every table operation published), then 64 (twice).
  0. the file: one transaction, no 'delete from' anywhere, no drop / truncate, no real database named; one function
     (tally_book_changed: security definer, search_path public, pg_temp, executable by nobody); prints the file's md5.
  1. why the copy's tables are not published: on 60, tally_lines in a publication like supabase_realtime makes "delete from
     tally_lines" fail (no replica identity) - shown in a transaction rolled back.
  2. the publication after 64: tally_book_changes, tally_sync_cursor, tally_month_locks, tally_tieouts in it (and 45 / 47's
     tally_recorder_lines, tally_alerts when there); NOT tally_vouchers, tally_lines, tally_ledgers, tally_ledger_day,
     tally_groups; every published table of these has RLS on and a firm read policy.
  3. a day read (vouchers, lines, ledger day, ledgers, groups written in ONE transaction, deletes included): one row in
     tally_book_changes for the book, n 1, the tables listed; another transaction: n 2; a transaction touching two books:
     one row each. Deletes from tally_lines still work.
  4. RLS: a member of firm A sees A's book's row only; a member of firm B sees none of A's.
  5. a failure inside the trigger never fails the write (the signal table made unwritable for the test: the write goes on,
     with a warning).
RED: before the file exists it stops at the first check."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql")]
M64 = os.environ.get("M64_FILE") or os.path.join(SQLDIR, "migration-64-pages-live.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FA, FB = "99999999-9999-9999-9999-99999999999a", "99999999-9999-9999-9999-99999999999b"
UA, UB = "55555555-5555-5555-5555-55555555555a", "55555555-5555-5555-5555-55555555555b"
BA, BA2, BB = "64646464-0000-4000-8000-00000000000a", "64646464-0000-4000-8000-0000000000a2", "64646464-0000-4000-8000-00000000000b"
COPY = ["tally_vouchers", "tally_lines", "tally_ledgers", "tally_ledger_day", "tally_groups"]
PUB = ["tally_book_changes", "tally_sync_cursor", "tally_month_locks", "tally_tieouts"]

text = open(M64).read() if os.path.exists(M64) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M64))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s" % (os.path.basename(M64), hashlib.md5(text.encode()).hexdigest()))
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"alter table [^\n]*(drop|rename|alter column)", low), "0. add-only (no drop, truncate, column change)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_book_changed"], "0. one function: tally_book_changed (%s)" % FNS)

db = pg_stand.start(int(os.environ.get("PG64_PORT") or 30640))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_user(uid, stmt):
    try: return db.rows("set fincom.role = 'authenticated'; set role authenticated; " + stmt, uid)
    except RuntimeError as e: return "ERROR " + str(e)[-300:]
def day_read(book, firm, day, guids):
    # what a day read does: the day's rows deleted and written again, the ledgers and groups too, in ONE transaction
    vs = ", ".join("(%s, %s, %s, %s, 1)" % (q(book), q(firm), q(g), q(day)) for g in guids)
    ls = ", ".join("(%s, %s, %s, %s, 'Cash', -10), (%s, %s, %s, %s, 'Sales', 10)" % (q(book), q(firm), q(g), q(day), q(book), q(firm), q(g), q(day)) for g in guids)
    return """begin;
      delete from tally_lines where book_id = %(b)s and day = %(d)s; delete from tally_vouchers where book_id = %(b)s and day = %(d)s; delete from tally_ledger_day where book_id = %(b)s and day = %(d)s;
      insert into tally_vouchers (book_id, firm_id, guid, day, alter_id) values %(vs)s;
      insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values %(ls)s;
      insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%(b)s, %(f)s, 'Cash', %(d)s, -10), (%(b)s, %(f)s, 'Sales', %(d)s, 10);
      insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%(b)s, %(f)s, 'Cash', 'Cash-in-Hand', 0) on conflict do nothing;
      update tally_ledgers set parent = parent where book_id = %(b)s;
      insert into tally_groups (book_id, firm_id, name, parent) values (%(b)s, %(f)s, 'Cash-in-Hand', '') on conflict do nothing;
      commit;""" % {"b": q(book), "f": q(firm), "d": q(day), "vs": vs, "ls": ls}
def sig(book): return (db.rows("select n::text as n, array_to_string(tables, ',') as tables, client_id from tally_book_changes where book_id = %s" % q(book)) or [None])[0]
def published(): return sorted(r["t"] for r in db.rows("select tablename as t from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'"))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create publication supabase_realtime")     # as Supabase makes it: insert, update, delete and truncate published
    db.sql("""insert into firms values (%(FA)s, 'Firm A'), (%(FB)s, 'Firm B') on conflict do nothing;
      insert into members values (%(UA)s, %(FA)s, 'A', 'owner', true), (%(UB)s, %(FB)s, 'B', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(BA)s, %(FA)s, 'ca', 'A CO', '2026-04-01', '2026-03-31'),
        (%(BA2)s, %(FA)s, 'ca2', 'A CO 2', '2026-04-01', '2026-03-31'), (%(BB)s, %(FB)s, 'cb', 'B CO', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" %
           {"FA": q(FA), "FB": q(FB), "UA": q(UA), "UB": q(UB), "BA": q(BA), "BA2": q(BA2), "BB": q(BB)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    for t in ("tally_recorder_lines", "tally_alerts"):      # 45 / 47 add them when the publication exists: as on staging
        if t not in published(): db.sql("alter publication supabase_realtime add table public.%s" % t)
    db.sql("alter default privileges in schema public grant select on tables to authenticated; grant select on all tables in schema public to authenticated; grant execute on all functions in schema public to authenticated;")

    print("== 1. why the copy's tables are not published (on 60)")
    db.sql(day_read(BA, FA, "2026-05-01", ["g1"]))
    r = psql_text("begin; create publication zz_like_realtime for table public.tally_lines; delete from tally_lines where book_id = %s; rollback;" % q(BA))
    ok(r.returncode != 0 and "replica identity" in r.stderr and "publishes deletes" in r.stderr,
       "1. tally_lines in a publication like supabase_realtime: 'delete from tally_lines' fails (%s)" % r.stderr.strip().split("\n")[-1][:200])

    print("== 2. 64, twice")
    for i in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "64 runs (%s time) %s" % ("first" if i == 1 else "second", r.stderr[-300:] if r.returncode else ""))
    pub = published()
    ok(all(t in pub for t in PUB) and not any(t in pub for t in COPY), "2. published: %s; none of the copy's five tables" % pub)
    pol = {r["t"]: r for r in db.rows("select c.relname as t, c.relrowsecurity::text as rls, (select string_agg(p.qual, ' ') from pg_policies p where p.tablename = c.relname and p.cmd = 'SELECT') as qual from pg_class c where c.relname = any(array[%s])" % ",".join(q(t) for t in pub))}
    ok(all(pol.get(t, {}).get("rls") == "true" and "my_firm()" in (pol.get(t, {}).get("qual") or "") for t in pub), "2. every published table has RLS and the firm's read policy (%s)" % {t: (v["rls"], v["qual"]) for t, v in pol.items()})
    f = (db.rows("select prosecdef::text as d, array_to_string(proconfig, ',') as c, has_function_privilege('authenticated', oid, 'execute')::text as a from pg_proc where proname = 'tally_book_changed'") or [{}])[0]
    ok(f.get("d") == "true" and f.get("c") == "search_path=public, pg_temp" and f.get("a") == "false", "0. tally_book_changed: security definer, search_path, not executable by members (%s)" % f)
    ntrig = db.one("select count(*) from pg_trigger where tgname like 'tally_%_changed_%'")
    ok(ntrig == "15", "2. 15 statement triggers (5 tables x insert, update, delete): %s" % ntrig)

    print("== 3. a day read gives one signal per transaction")
    ok(sig(BA) is None, "3. nothing before 64's first write (%s)" % sig(BA))
    db.sql(day_read(BA, FA, "2026-05-01", ["g1", "g2", "g3"]))
    s1 = sig(BA)
    ok(s1 and s1["n"] == "1" and s1["client_id"] == "ca" and set(s1["tables"].split(",")) == set(COPY) - {"tally_groups"}, "3. one transaction: n 1, the four tables it changed listed (its group was there already: no row changed, no signal) (%s)" % s1)
    db.sql(day_read(BA, FA, "2026-05-02", ["g4"]))
    ok(sig(BA)["n"] == "2", "3. another transaction: n 2 (%s)" % sig(BA))
    db.sql("begin; update tally_vouchers set alter_id = alter_id + 1 where book_id in (%s, %s); commit;" % (q(BA), q(BA2)))
    db.sql(day_read(BA2, FA, "2026-05-01", ["h1"]))
    ok(sig(BA)["n"] == "3" and sig(BA)["tables"] == "tally_vouchers" and sig(BA2) is not None, "3. a statement on two books: a row each (%s %s)" % (sig(BA), sig(BA2)))
    ok(db.one("select count(*) from tally_lines where book_id = %s" % q(BA)) == "8", "3. the day reads' deletes and writes all went (lines %s)" % db.one("select count(*) from tally_lines where book_id = %s" % q(BA)))
    db.sql(day_read(BB, FB, "2026-05-01", ["b1"]))

    print("== 4. RLS")
    ra, rb = as_user(UA, "select book_id::text as b from tally_book_changes order by 1"), as_user(UB, "select book_id::text as b from tally_book_changes order by 1")
    ok(isinstance(ra, list) and sorted(r["b"] for r in ra) == sorted([BA, BA2]), "4. a member of firm A sees A's two books (%s)" % ra)
    ok(isinstance(rb, list) and [r["b"] for r in rb] == [BB], "4. a member of firm B sees only B's (%s)" % rb)
    w = as_user(UA, "insert into tally_book_changes (book_id, firm_id) values (gen_random_uuid(), %s) returning 1" % q(FA))
    ok(isinstance(w, str) and "denied" in w, "4. a member cannot write it (%s)" % str(w)[:120])

    print("== 5. never fails the write")
    r = psql_text("begin; alter table tally_book_changes rename to tally_book_changes_away; %s rollback;" % day_read(BA, FA, "2026-05-03", ["z1"]).replace("begin;", "").replace("commit;", "select count(*) from tally_vouchers where guid = 'z1';"))
    ok(r.returncode == 0 and "WARNING:  tally_book_changed" in r.stderr, "5. the signal table gone: the day read still goes, with a warning (%s)" % (r.stderr.strip().split("\n")[0][:160] if r.stderr else r.returncode))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
