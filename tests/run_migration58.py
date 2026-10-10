"""python3 run_migration58.py - migration-58-lows (bridge 2.3.1: the deferred cloud Low of the 2.3.0 review round 1 on the
tables 54 and 55 made). Those files revoked only insert and update from anon and authenticated; Supabase gives both roles
every privilege on a new public table by default, so authenticated kept delete, references and trigger, and the one that
row security does not cover (emptying a table at once). 58 revokes all from anon and authenticated on the seven tables (and
their id sequences) and grants select back to authenticated (row security still shows a firm only its own rows). On
throwaway PostgreSQL (pg_stand, port 30580; never a real database), built 32 -> ... -> 55 in staging's order with
Supabase's default grants, then 58 (twice). Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from', add-only (no drop), no real
     database named; it runs twice; nothing removed (row counts kept).
  1. before 58 (red): authenticated holds more than select on the tables.
  2. after 58: authenticated holds select only; anon holds nothing; the sequences: neither role; the service role and the
     functions (security definer) unchanged: tally_bridge_bind still binds.
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
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql")]
M58 = os.environ.get("M58_FILE") or os.path.join(SQLDIR, "migration-58-lows.sql")
TABLES = ["tally_bridge_prefs", "tally_member_bridges", "tally_bridge_ids", "tally_bridge_alerts", "tally_bridge_rollbacks", "tally_bridge_release_log", "tally_post_checks"]
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER, D1 = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "d1000000-0000-0000-0000-000000000001"

text = open(M58).read() if os.path.exists(M58) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M58))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")

db = pg_stand.start(30580)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def privs(role, t): return [p for p in PRIVS if db.one("select has_table_privilege(%s, %s, %s)::text" % (q(role), q("public." + t), q(p))) == "true"]
def seqs(): return [r["s"] for r in db.rows("select pg_get_serial_sequence('public.' || c.relname, 'id') as s from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'id' where c.relnamespace = 'public'::regnamespace and c.relname in (%s)" % ", ".join(q(t) for t in TABLES)) if r["s"]]
def seqprivs(role, s): return [p for p in ("USAGE", "SELECT", "UPDATE") if db.one("select has_sequence_privilege(%s, %s, %s)::text" % (q(role), q(s), q(p))) == "true"]
def counts(): return {t: int(db.one("select count(*) from public.%s" % t)) for t in TABLES}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%(D1)s, %(F)s, 'NW144 · anshul', 'h1', '2.3.0', '{}');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" % {"F": q(F), "O": q(OWNER), "D1": q(D1)})
    # Supabase's default privileges: every new public table and sequence granted to anon and authenticated
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated;")
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.one("select tally_bridge_bind(%s, 'go-aaaa000001')::text" % q(D1))
    before = {t: privs("authenticated", t) for t in TABLES}
    ok(any(set(v) - {"SELECT"} for v in before.values()), "1. before 58: authenticated holds more than select (%s)" % before)
    n0 = counts()
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "0. pass %d: migration 58 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    ok(counts() == n0, "0. nothing removed (%s)" % counts())
    for t in TABLES:
        ok(privs("authenticated", t) == ["SELECT"] and privs("anon", t) == [], "2. %s: authenticated select only, anon nothing (%s; %s)" % (t, privs("authenticated", t), privs("anon", t)))
    ss = seqs()
    ok(len(ss) >= 4 and all(seqprivs("authenticated", s) == [] and seqprivs("anon", s) == [] for s in ss), "2. the id sequences: neither role (%s)" % {s: (seqprivs("authenticated", s), seqprivs("anon", s)) for s in ss})
    out = db.one("select tally_bridge_bind(%s, 'go-bbbb000002')::text" % q(D1))
    ok('"own": true' in (out or ""), "2. tally_bridge_bind (security definer) still binds (%s)" % out)
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
