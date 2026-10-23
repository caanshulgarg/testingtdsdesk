"""python3 run_device_keys_60.py - the owner's rule of 05-Oct-2026 (no limit by user, company or number of bridges): a firm
makes as many computer keys as it has Windows users' bridges. migration.sql's tally_device_create refused the 51st key of a
firm ("too many computers; remove one first"); migration 54 replaces it without that limit (its text otherwise the same).
On throwaway PostgreSQL (pg_stand, port 30541; never a real database), with tally_devices as on staging and pgcrypto in
the schema extensions, as on Supabase:
  1. migration.sql's function (as it is on staging): the 51st key of a firm is refused (what was there);
  2. migration 54's function: 60 keys and more are made, by an owner and by staff; each keeps who made it (created_by),
     a fresh key and only its hash; a viewer (cannot write) and a stranger are still refused; a blank name still refused;
     the function is security definer, search_path = public, extensions, pg_temp, members only (not anon).
RED: before migration 54 defines tally_device_create the second part stops (no such function in the file)."""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M54 = os.environ.get("M54_FILE") or os.path.join(SQLDIR, "migration-54-post-target-bridge.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def fn_text(path, end):
    s = open(path).read()
    m = re.search(r"create or replace function public\.tally_device_create\(p_name text\).*?" + re.escape(end), s, re.S)
    return m.group(0) if m else ""
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, VIEWER, OTHER = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777", "44444444-4444-4444-4444-444444444444"
SCHEMA = """
create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
create table tally_devices (id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms(id) on delete cascade, name text not null,
  key_hash text not null unique, created_at timestamptz not null default now(), created_by uuid, last_seen timestamptz, version text, info jsonb not null default '{}'::jsonb,
  revoked boolean not null default false);
grant usage on schema public, auth to authenticated, anon;
"""
db = pg_stand.start(30541)
def as_user(uid, stmt):
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
make = lambda uid, n, name="PC": as_user(uid, "select count(*) from (select tally_device_create(%s || ' ' || g) from generate_series(1, %d) g) x" % (q(name), n))
keys = lambda f: int(db.one("select count(*) from tally_devices where firm_id = %s and not revoked" % q(f)))
try:
    db.sql(SCHEMA)
    db.sql("insert into firms values (%s, 'Firm'), (%s, 'Other'); insert into members values (%s, %s, 'Owner', 'owner', true), (%s, %s, 'Ravi', 'staff', true), (%s, %s, 'Viewer', 'viewer', true), (%s, %s, 'Priya', 'owner', true);"
           % (q(F), q(F2), q(OWNER), q(F), q(STAFF), q(F), q(VIEWER), q(F), q(OTHER), q(F2)))
    # 1. migration.sql's function, as on staging
    old = fn_text(os.path.join(SQLDIR, "migration.sql"), "end $$;")
    ok("too many computers" in old, "1. migration.sql's tally_device_create is read (it has the limit of 50)")
    db.sql(old + "\ngrant execute on function public.tally_device_create(text) to authenticated;")
    good, out = make(OWNER, 50)
    ok(good and out == "50" and keys(F) == 50, "1. migration.sql's: 50 keys are made (%s)" % out[-200:])
    good, out = make(OWNER, 1)
    ok(not good and "too many computers" in out, "1. migration.sql's: the 51st is refused, as it was (%s)" % out.strip()[-120:])
    # 2. migration 54's
    text = open(M54).read() if os.path.exists(M54) else ""
    new = fn_text(M54, "end $function$;") if text else ""
    ok(bool(new), "2. migration 54 replaces tally_device_create")
    if not new: raise SystemExit
    ok("too many computers" not in new and ">= 50" not in new, "2. migration 54's text has no limit")
    norm = lambda t: re.sub(r"\s+", " ", re.sub(r"\$(function)?\$", "$$", t)).strip()
    ok(norm(new).replace("search_path = public, extensions, pg_temp", "search_path = public, extensions") == norm("\n".join(l for l in old.splitlines() if "too many computers" not in l)),
       "2. otherwise the same as migration.sql's (the limit's line taken out; pg_temp added to its search_path)")
    i = text.index(new); j = text.index("\n\n", i + len(new))
    db.sql(text[i:j])                               # the function, its revoke and grant, as the file has them
    good, out = make(OWNER, 60)
    ok(good and out == "60" and keys(F) == 110, "2. 60 more keys are made by the owner (%d keys in the firm) (%s)" % (keys(F), out[-200:]))
    good, out = make(STAFF, 10, "NW144")
    ok(good and out == "10" and keys(F) == 120, "2. and 10 by staff: no limit by number or by who (%d)" % keys(F))
    by = db.rows("select created_by::text as by, count(*) as n from tally_devices where firm_id = %s group by 1 order by 1" % q(F))
    ok(by == [{"by": OWNER, "n": "110"}, {"by": STAFF, "n": "10"}], "2. each keeps who made it (%s)" % by)
    good, out = as_user(STAFF, "select tally_device_create('NW144 · ravi')::text")
    j_ = json.loads(out) if good else {}
    ok(good and re.match(r"^fcd_[0-9a-f]{48}$", j_.get("key", "")) and db.one("select key_hash = encode(extensions.digest(%s, 'sha256'), 'hex') from tally_devices where id = %s" % (q(j_.get("key", "")), q(j_.get("id", "")))) == "t",
       "2. a fresh key, shown once; only its hash is kept")
    good, out = as_user(VIEWER, "select tally_device_create('X')::text")
    ok(not good and "not allowed" in out, "2. a viewer (cannot write) is still refused")
    good, out = as_user("00000000-0000-0000-0000-00000000dead", "select tally_device_create('X')::text")
    ok(not good and "not allowed" in out, "2. a stranger is still refused")
    good, out = as_user(OTHER, "select tally_device_create('   ')::text")
    ok(not good and "give the computer a name" in out, "2. a blank name is still refused")
    good, out = as_user(OTHER, "select tally_device_create('OTHERPC')::text")
    ok(good and keys(F2) == 1 and keys(F) == 121, "2. another firm's owner makes his own, in his own firm only")
    row = db.rows("select prosecdef, array_to_string(proconfig, ',') as conf, has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth from pg_proc where proname = 'tally_device_create'")
    ok(row == [{"prosecdef": "t", "conf": "search_path=public, extensions, pg_temp", "anon": "f", "auth": "t"}], "2. security definer, search_path = public, extensions, pg_temp; members only (%s)" % row)
finally:
    db.stop()
print("\nall checks passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
