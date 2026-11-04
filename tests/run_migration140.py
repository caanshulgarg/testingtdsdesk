"""python3 run_migration140.py - migration-140-bridge-alert-clears (04-Nov-2026, next-tally-connectfix). On staging the Tally
page's Connect made a second computer key for a bridge that was already the firm's; tally_bridge_bind refused it and kept
one alert for the owners, which stayed uncleared for days while the bridge went on reporting with its first key. On a
throwaway PostgreSQL (pg_stand, port 31140; never a real database), with migration 54's tables and its tally_bridge_bind as
written in migration-54 (its md5 checked against staging's), made-up firms, computer keys and bridge ids only:
  0. the file: one transaction (lock_timeout 10 s), add-only (one column added, one function replaced; no drop, delete or
     truncate), names no real database; runs twice; the function stays service_role only (anon and authenticated: none).
  1. a key made by mistake is refused (the alert kept, as before), and the bridge reporting with its own key at once (within
     10 minutes) does not clear it;
  2. the alert not raised again for 10 minutes and the bridge's own key reporting: cleared (cleared_at, cleared_why), the row
     kept (never deleted), the computer keys untouched;
  3. an alert still being raised (another key really using the id: its last_at fresh) is kept; another firm's alert and
     another bridge's alert are never cleared.
  4. the md5 guard: a tally_bridge_bind that is neither migration 54's nor 140's stops the file, nothing changed.
RED_WITHOUT_140=1: checks 2 without the file (fails)."""
import os, re, sys, uuid, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M54 = os.path.join(SQLDIR, "migration-54-post-target-bridge.sql")
M140 = os.environ.get("M140_FILE") or os.path.join(SQLDIR, "migration-140-bridge-alert-clears.sql")
RED = os.environ.get("RED_WITHOUT_140") == "1"
STAGING_MD5 = "f8a4dd53741a3aa2de2d8f03c3d5c5a0"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
# migration 54's pieces the bind needs, as written there
TABLES = """
create table if not exists public.tally_devices (id uuid primary key, firm_id uuid, name text, key_hash text, created_at timestamptz default now(), created_by uuid,
  last_seen timestamptz, version text, info jsonb not null default '{}'::jsonb, revoked boolean default false);
create table if not exists public.tally_bridge_ids (bridge_id text not null, device_id uuid not null, firm_id uuid not null, at timestamptz not null default now(),
  reset_at timestamptz, reset_by uuid, reset_why text);
create unique index if not exists tally_bridge_ids_one on public.tally_bridge_ids (firm_id, bridge_id) where reset_at is null;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
"""
def fn_from_54(name, last):
    s = open(M54).read(); i = s.index("create or replace function public." + name + "(")
    j = s.index(last, i) + len(last)
    return s[i:j]
def main():
    s = open(M140).read()
    print("== 0. the file")
    body = re.sub(r"--[^\n]*", "", s)
    ok(s.count("\nbegin;") == 1 and s.rstrip().endswith("commit;") and "lock_timeout = '10s'" in s, "0. one transaction with lock_timeout 10 s")
    ok(not re.search(r"\b(drop|delete|truncate)\b", body, re.I), "0. add-only: no drop, delete or truncate")
    ok(len(re.findall(r"create or replace function", body, re.I)) == 1 and len(re.findall(r"alter table", body, re.I)) == 1 and "add column if not exists cleared_why" in body,
       "0. one function replaced, one column added")
    ok("nrtczucrlgalvtojwoes" not in s and "qbocskaiewaxqcvaunzc" not in s, "0. names no real database")
    ok(STAGING_MD5 in s, "0. checks the live function's md5 (migration 54's text, as on staging)")
    db = pg_stand.start(31140)
    try:
        db.sql(TABLES)
        s54 = open(M54).read()
        i = s54.index("create table if not exists public.tally_bridge_alerts"); j = s54.index("grant select on public.tally_bridge_alerts to authenticated;", i) + len("grant select on public.tally_bridge_alerts to authenticated;")
        db.sql(s54[i:j].replace("references public.firms(id) on delete cascade", "").replace("references public.tally_devices(id) on delete cascade", ""))
        i = s54.index("create or replace function public.tally_bridge_words("); j = s54.index("revoke all on function public.tally_bridge_bind(uuid, text) from public, anon, authenticated;", i)
        db.sql(s54[i:j] + "revoke all on function public.tally_bridge_bind(uuid, text) from public, anon, authenticated;\ngrant execute on function public.tally_bridge_bind(uuid, text) to service_role;")
        md = db.one("select md5(prosrc) from pg_proc where proname = 'tally_bridge_bind'")
        ok(md == STAGING_MD5, "0. migration 54's tally_bridge_bind here is staging's text (md5 %s)" % md)
        F1, F2 = str(uuid.uuid4()), str(uuid.uuid4())
        A, B, X, O = [str(uuid.uuid4()) for _ in range(4)]   # A: the bridge's first key; B: a key made by mistake; X: another key; O: another firm's
        BR, BR2 = "go-aaaa1111bbbb", "go-cccc2222dddd"
        db.sql("insert into firms values (%s, 'Made-up Firm'), (%s, 'Other Made-up Firm');" % (q(F1), q(F2)) +
               "insert into tally_devices (id, firm_id, name, info) values (%s, %s, 'PC-MADEUP · userone', jsonb_build_object('bridges', jsonb_build_object(%s, jsonb_build_object('computer', 'PC-MADEUP', 'user', 'PC-MADEUP\\userone'))))," % (q(A), q(F1), q(BR)) +
               "(%s, %s, 'PC-MADEUP · userone', '{}'), (%s, %s, 'PC-MADEUP · usertwo', '{}'), (%s, %s, 'PC-OTHER', '{}');" % (q(B), q(F1), q(X), q(F1), q(O), q(F2)))
        bind = lambda d, b: db.one("select tally_bridge_bind(%s, %s)::text" % (q(d), q(b)))
        if not RED:
            db.sql(open(M140).read()); db.sql(open(M140).read())
            ok(True, "0. the file runs twice")
            ok(db.one("select md5(prosrc) from pg_proc where proname = 'tally_bridge_bind'") != STAGING_MD5, "0. tally_bridge_bind replaced")
            gr = db.rows("select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'tally_bridge_bind'")
            ok(not [g for g in gr if g["grantee"] in ("anon", "authenticated", "PUBLIC")] and any(g["grantee"] == "service_role" for g in gr), "0. grants: service_role only (%s)" % [g["grantee"] for g in gr])
        print("== 1. a key made by mistake: refused, its alert kept")
        ok('"own": true' in bind(A, BR), "1. the first key binds the bridge")
        r = bind(B, BR)
        ok('"own": false' in r, "1. the second key is refused (%s)" % r[:80])
        bind(A, BR)
        ok(db.one("select count(*) from tally_bridge_alerts where bridge_id = %s and cleared_at is null" % q(BR)) == "1", "1. the bridge's own key at once: the alert stays (it may still be raised)")
        print("== 2. not raised for 10 minutes, the bridge's own key reports: cleared")
        db.sql("update tally_bridge_alerts set last_at = now() - interval '11 minutes', at = now() - interval '11 minutes' where device_id = %s" % q(B))
        bind(A, BR)
        rows = db.rows("select cleared_at is not null as c, %s from tally_bridge_alerts where device_id = %s" % ("cleared_why" if not RED else "''::text as cleared_why", q(B)))
        ok(len(rows) == 1 and rows[0]["c"] == "t", "2. the alert is cleared (%s)" % rows)
        ok(not RED and rows and "own computer key" in (rows[0]["cleared_why"] or ""), "2. why it was cleared is said")
        ok(db.one("select count(*) from tally_devices") == "4" and db.one("select count(*) from tally_devices where revoked") == "0", "2. the computer keys are untouched (none removed, none revoked)")
        print("== 3. still raised, another firm's, another bridge's: kept")
        bind(X, BR)                                     # another key using the id right now
        bind(A, BR)
        ok(db.one("select count(*) from tally_bridge_alerts where device_id = %s and cleared_at is null" % q(X)) == "1", "3. an alert raised just now is kept")
        db.sql("insert into tally_bridge_alerts (firm_id, bridge_id, device_id, owner_device_id, words, at, last_at) values (%s, %s, %s, %s, 'made-up', now() - interval '1 day', now() - interval '1 day'), (%s, %s, %s, %s, 'made-up', now() - interval '1 day', now() - interval '1 day')"
               % (q(F2), q(BR), q(O), q(O), q(F1), q(BR2), q(B), q(A)))
        bind(A, BR)
        ok(db.one("select count(*) from tally_bridge_alerts where firm_id = %s and cleared_at is null" % q(F2)) == "1", "3. another firm's alert is never cleared")
        ok(db.one("select count(*) from tally_bridge_alerts where bridge_id = %s and cleared_at is null" % q(BR2)) == "1", "3. another bridge's alert is not cleared")
        ok(db.one("select count(*) from tally_bridge_alerts") == "4", "3. no alert row removed (4: the cleared one kept)")
        if not RED:
            print("== 4. the md5 guard")
            db.sql("create or replace function public.tally_bridge_bind(p_device uuid, p_bridge text) returns jsonb language sql as $f$ select '{}'::jsonb $f$;")
            try: db.sql(open(M140).read()); stopped = False
            except RuntimeError as e: stopped = "not migration 54" in str(e)
            ok(stopped and db.one("select prosrc from pg_proc where proname = 'tally_bridge_bind'").strip() == "select '{}'::jsonb", "4. another text of the function: the file stops, nothing changed")
    finally:
        db.stop()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
