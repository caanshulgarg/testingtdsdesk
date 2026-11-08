"""python3 run_migration143.py - migration-143-fast-measure (08-Nov-2026, branch next-fast-measure): the fast-read
measurement kept per run (tally_fast_measures). On a throwaway PostgreSQL (pg_stand, port 31430; never a real database).
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate / alter table other than the
     new table's row security), names no real database; runs twice; one new table, no function; explicit grants:
     service_role reads and inserts (no update, no delete), authenticated reads (its firm's rows only), anon nothing.
  1. a row is kept (service_role); a result over 64 KB, a version over 40 characters: refused.
  2. row security: a member reads the firm's rows only; anon reads nothing; a member cannot write."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M143 = os.path.join(SQLDIR, "migration-143-fast-measure.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999143", "88888888-8888-8888-8888-888888888143"
B, B2 = "819d4a59-4cee-4bf7-8f8c-000000000143", "819d4a59-4cee-4bf7-8f8c-000000000144"
U, U2 = "11111111-1111-1111-1111-111111111143", "22222222-2222-2222-2222-222222222143"

text = open(M143).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M143), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_fast_measures enable row level security;"], "0. add-only (%s)" % alters)
ok(not re.search(r"supabase\.co|\.supabase\.|https?://", low), "0. names no real database")
ok(sorted(re.findall(r"create table if not exists public\.(\w+)", text)) == ["tally_fast_measures"] and "create or replace function" not in low, "0. one new table, no function")
ok(re.search(r"revoke all on public\.tally_fast_measures from public, anon, authenticated;", text) and re.search(r"grant select on public\.tally_fast_measures to authenticated;", text)
   and re.search(r"grant select, insert on public\.tally_fast_measures to service_role;", text), "0. the table's grants written out")

db = pg_stand.start(int(os.environ.get("PG143_PORT") or 31430))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members (user_id, firm_id, role, active) values (%(U)s, %(F)s, 'staff', true), (%(U2)s, %(F2)s, 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%(B)s, %(F)s, 'c1', 'ZZ TEST', '2026-04-01'), (%(B2)s, %(F2)s, 'c9', 'ZZ TEST', '2026-04-01');
      grant usage on schema public, auth to authenticated, anon, service_role; grant select on members to authenticated;""" % {"F": q(F), "F2": q(F2), "B": q(B), "B2": q(B2), "U": q(U), "U2": q(U2)})
    for i in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "143 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    priv = lambda rl, p: db.one("select has_table_privilege(%s, 'public.tally_fast_measures', %s)" % (q(rl), q(p))) in ("t", "true")
    ok(not any(priv("anon", p) for p in ("select", "insert", "update", "delete")), "0. anon: nothing")
    ok(priv("authenticated", "select") and not any(priv("authenticated", p) for p in ("insert", "update", "delete")), "0. authenticated: select only")
    ok(priv("service_role", "select") and priv("service_role", "insert") and not priv("service_role", "update") and not priv("service_role", "delete"), "0. service_role: select, insert (no update, no delete)")
    ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_fast_measures'::regclass") in ("t", "true"), "0. row security on")
    print("== 1. rows")
    res = json.dumps({"ok": True, "results": [{"kind": "W1", "days": 7, "rows": 30, "ms": 40, "holdMs": 0}]})
    ins = lambda firm, book, res_, ver="7.1.0.0": psql_text("insert into public.tally_fast_measures (firm_id, book_id, tally_version, pass, result) values (%s, %s, %s, true, %s::jsonb);" % (q(firm), q(book), q(ver), q(res_)))
    ok(ins(F, B, res).returncode == 0 and ins(F2, B2, res).returncode == 0, "1. a run kept (service_role)")
    ok(ins(F, B, json.dumps({"x": "y" * 70000})).returncode != 0, "1. a result over 64 KB refused")
    ok(ins(F, B, res, "9" * 41).returncode != 0, "1. a version over 40 characters refused")
    print("== 2. row security")
    sel = lambda uid: db.rows("set role authenticated; set fincom.uid = %s; select book_id::text from public.tally_fast_measures order by 1;" % q(uid))
    try:
        mine, theirs = sel(U), sel(U2)
        ok(len(mine) == 1 and mine[0]["book_id"] == B and len(theirs) == 1 and theirs[0]["book_id"] == B2, "2. each firm's member reads its own rows only (%s / %s)" % (mine, theirs))
    except RuntimeError as e: ok(False, "2. reads: %s" % str(e)[-300:])
    try: db.rows("reset role; set role anon; select * from public.tally_fast_measures;"); ok(False, "2. anon reads nothing")
    except RuntimeError: ok(True, "2. anon reads nothing (refused)")
    try: db.sql("reset role; set role authenticated; set fincom.uid = %s; insert into public.tally_fast_measures (firm_id, book_id, result) values (%s, %s, '{}');" % (q(U), q(F), q(B))); ok(False, "2. a member cannot write")
    except RuntimeError: ok(True, "2. a member cannot write (refused)")
except (RuntimeError, KeyError, TypeError) as e:
    ok(False, "the run: %s" % str(e)[-400:])
finally:
    db.stop(); import shutil; shutil.rmtree(db.data, ignore_errors=True)
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
