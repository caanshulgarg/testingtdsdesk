"""python3 run_migration59.py - migration-59-ledger-aliases (bridge 2.3.1, the owner's decision of 06-Oct-2026: a ledger
renamed in Tally and fetched for an unknown name). tally-ingest records Tally's new name against the ledger FinCom holds
(same Tally GUID) and applies an entry using the new name under FinCom's ledger; 2.3.1 does not rename. On throwaway
PostgreSQL (pg_stand, port 30590; never a real database), built 32 -> ... -> 55 -> 56 -> 57 -> 58 in staging's order with
Supabase's default grants, then 59 (twice). Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from', add-only (no drop), no real
     database named; it runs twice; nothing removed (row counts kept); no function.
  1. tally_ledger_aliases: its columns, its key (book_id, tally_name), row security on with the firm's read policy.
  2. privileges: authenticated select only, anon nothing, the service role all; a member reads only the firm's own rows.
  3. an upsert by (book_id, tally_name) keeps one row and takes the newer fincom name / GUID / time (tally-ingest's write).
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
                                           "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql")]
M59 = os.environ.get("M59_FILE") or os.path.join(SQLDIR, "migration-59-ledger-aliases.sql")
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, OTHER = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666"
B, B2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"

text = open(M59).read() if os.path.exists(M59) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M59))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low) and "create or replace function" not in low and "create function" not in low, "0. names no real database; no function")

db = pg_stand.start(30590)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def privs(role, t): return [p for p in PRIVS if db.one("select has_table_privilege(%s, %s, %s)::text" % (q(role), q("public." + t), q(p))) == "true"]
def counts(): return {r["t"]: int(db.one("select count(*) from public.%s" % r["t"])) for r in db.rows("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like 'tally_%' order by 1")}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%(B2)s, %(F2)s, 'c9', 'YY CO', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "X": q(OTHER), "B": q(B), "B2": q(B2)})
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated;")
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    nf = int(db.one("select count(*) from pg_proc where pronamespace = 'public'::regnamespace"))
    n0 = counts()
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "0. pass %d: migration 59 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        if rnd == 1:
            db.sql("""insert into tally_ledger_aliases (book_id, firm_id, tally_name, fincom_name, tally_guid) values (%s, %s, 'New Name Traders', 'Old Name Traders', 'g-1'),
                      (%s, %s, 'Elsewhere', 'Theirs', 'g-9');""" % (q(B), q(F), q(B2), q(F2)))
    c = counts(); c0 = dict(n0, tally_ledger_aliases=2)
    ok(c == c0, "0. nothing removed (the second run kept the two rows; %s)" % {k: v for k, v in c.items() if n0.get(k) != v})
    ok(int(db.one("select count(*) from pg_proc where pronamespace = 'public'::regnamespace")) == nf, "0. no function added or removed")
    cols = [r["c"] for r in db.rows("select column_name as c from information_schema.columns where table_name = 'tally_ledger_aliases' order by ordinal_position")]
    ok(cols == ["book_id", "firm_id", "tally_name", "fincom_name", "tally_guid", "seen_at"], "1. the columns (%s)" % cols)
    pk = db.one("select string_agg(a.attname, ',' order by k.n) from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum, n) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum where c.conrelid = 'public.tally_ledger_aliases'::regclass and c.contype = 'p'")
    ok(pk == "book_id,tally_name", "1. the key: (book_id, tally_name) (%s)" % pk)
    ok(db.one("select relrowsecurity::text from pg_class where oid = 'public.tally_ledger_aliases'::regclass") == "true"
       and db.one("select count(*) from pg_policies where tablename = 'tally_ledger_aliases' and policyname = 'tally_ledger_aliases_read' and cmd = 'SELECT'") == "1", "1. row security on, the firm's read policy")
    ok(db.one("select confdeltype from pg_constraint where conrelid = 'public.tally_ledger_aliases'::regclass and contype = 'f'") == "r", "1. the book's key: ON DELETE RESTRICT (nothing removed with a book)")
    ok(privs("authenticated", "tally_ledger_aliases") == ["SELECT"] and privs("anon", "tally_ledger_aliases") == [] and privs("service_role", "tally_ledger_aliases")[:3] == ["SELECT", "INSERT", "UPDATE"],
       "2. authenticated select only, anon nothing, the service role writes (%s; %s; %s)" % (privs("authenticated", "tally_ledger_aliases"), privs("anon", "tally_ledger_aliases"), privs("service_role", "tally_ledger_aliases")))
    ok(db.one("set role authenticated; select string_agg(tally_name, ',') from tally_ledger_aliases", OWNER) == "New Name Traders"
       and db.one("set role authenticated; select string_agg(tally_name, ',') from tally_ledger_aliases", OTHER) == "Elsewhere", "2. a member reads only the firm's own rows")
    db.sql("""insert into tally_ledger_aliases (book_id, firm_id, tally_name, fincom_name, tally_guid, seen_at) values (%s, %s, 'New Name Traders', 'Old Name Traders', 'g-1', now() + interval '1 hour')
              on conflict (book_id, tally_name) do update set fincom_name = excluded.fincom_name, tally_guid = excluded.tally_guid, seen_at = excluded.seen_at""" % (q(B), q(F)))
    ok(db.one("select count(*) from tally_ledger_aliases where book_id = %s" % q(B)) == "1" and db.one("select (seen_at > now())::text from tally_ledger_aliases where book_id = %s" % q(B)) == "true", "3. an upsert by (book, Tally's name) keeps one row, the time moved on")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
