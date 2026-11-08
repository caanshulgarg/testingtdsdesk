"""python3 run_migration147.py - server/tally-cloud/migration-147-period-fetch-on.sql (08-Nov-2026, branch next-book-start;
the owner's decision: reading older entries ON by default). On a throwaway PostgreSQL (pg_stand, port 31147 unless
PG147_PORT; never a real database), tally_devices with migration 98's three switch columns (taken from its file). Checks:
  0. the file: one transaction, lock_timeout 10 s; no create, drop, delete, truncate; only the column default and one
     guarded update; names no real database; md5; runs twice
  1. a key nobody ever switched (period_fetch_at null): turned on; its period_fetch_at / _by stay null
  2. a key an owner turned OFF (period_fetch_at set): stays off; one turned on: stays on
  3. a key made after it: on by default
  4. the second run changes nothing (a key turned off between the runs stays off)"""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M147, M98 = os.path.join(SQLDIR, "migration-147-period-fetch-on.sql"), os.path.join(SQLDIR, "migration-98-period-pull.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M147).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M147), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
ok(not re.search(r"\b(create|drop|truncate|delete|grant|revoke)\b", code), "0. nothing created, dropped, deleted or granted")
stmts = [s.strip() for s in code.split(";") if s.strip() and s.strip() not in ("begin", "commit") and not s.strip().startswith("set local")]
ok(stmts == ["alter table public.tally_devices alter column period_fetch set default true",
             "update public.tally_devices set period_fetch = true where period_fetch = false and period_fetch_at is null"], "0. only the default and the guarded update (%s)" % stmts)
ok(not re.search(r"supabase\.co|\.supabase\.|https?://", text.lower()), "0. names no real database")
cols98 = re.findall(r"^alter table public\.tally_devices add column if not exists period_fetch[^;]*;", open(M98).read(), re.M)
ok(len(cols98) == 3, "0. migration 98's three switch columns found (%d)" % len(cols98))

F = "99999999-9999-9999-9999-999999999147"
K1, K2, K3, K4, K5 = ["11111111-1111-1111-1111-11111111114%d" % i for i in range(1, 6)]
U = "22222222-2222-2222-2222-222222222147"
db = pg_stand.start(int(os.environ.get("PG147_PORT") or 31147))
try:
    db.sql("create table if not exists public.tally_devices (id uuid primary key default gen_random_uuid(), firm_id uuid, name text, key_hash text, revoked boolean default false);\n" + "\n".join(cols98))
    ok(db.one("select column_default from information_schema.columns where table_name = 'tally_devices' and column_name = 'period_fetch'") == "false", "before: the default is false (migration 98)")
    db.sql("""insert into tally_devices (id, firm_id, name) values ('%(K1)s', '%(F)s', 'never switched'), ('%(K4)s', '%(F)s', 'never switched, revoked');
      update tally_devices set revoked = true where id = '%(K4)s';
      insert into tally_devices (id, firm_id, name, period_fetch, period_fetch_at, period_fetch_by) values
        ('%(K2)s', '%(F)s', 'turned off', false, now() - interval '3 days', '%(U)s'), ('%(K3)s', '%(F)s', 'turned on', true, now() - interval '2 days', '%(U)s');""" % locals())
    db.sql(text)
    on = lambda k: db.one("select period_fetch::text from tally_devices where id = '%s'" % k) == "true"
    ok(on(K1) and db.one("select (period_fetch_at is null and period_fetch_by is null)::text from tally_devices where id = '%s'" % K1) == "true", "1. a key nobody switched: on, still never turned by a person")
    ok(on(K4), "1. (a revoked key nobody switched: on too; revoked keys get nothing anyway)")
    ok(not on(K2), "2. a key an owner turned off: stays off")
    ok(on(K3), "2. a key turned on: stays on")
    db.sql("insert into tally_devices (id, firm_id, name) values ('%s', '%s', 'made later')" % (K5, F))
    ok(on(K5) and db.one("select column_default from information_schema.columns where table_name = 'tally_devices' and column_name = 'period_fetch'") == "true", "3. a key made after it: on by default")
    db.sql("update tally_devices set period_fetch = false, period_fetch_at = now(), period_fetch_by = '%s' where id = '%s'" % (U, K5))
    db.sql(text)
    ok(not on(K5) and not on(K2) and on(K1) and on(K3), "4. the second run changes nothing (a key turned off between the runs stays off)")
except RuntimeError as e:
    ok(False, "the run: %s" % str(e)[-400:])
finally:
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
