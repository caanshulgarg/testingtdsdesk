"""python3 run_migration215.py - migration-215-short-day-note (23-Nov-2026, a DRAFT). On throwaway PostgreSQL (pg_stand,
port 30215; never a real database): migration 57's tally_ingest_day installed from its own file, its neighbours stubbed
(the same stubs before and after, so only the function's own behaviour is compared), then 215 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), add-only, no 'delete from', names no real
     database; its function is 57's text with exactly the two changes; the guard refuses a function that is not 57's (nothing
     changed) and passes 57's and its own; security definer, search_path public, pg_temp; execute for service_role only.
  1. the same reads, run under 57 and under 215 (a book each): every answer, every tally_days row (n, note, whether
     empty_at is set) and every entry's deleted mark the same, except that a short read bringing entries now leaves the
     note 'short read: x of n' (before: no note); a later full read clears it.
Prints the md5 of the migration file and of the new function's prosrc."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M215 = os.path.join(SQLDIR, "migration-215-short-day-note.sql")
M57 = os.path.join(SQLDIR, "migration-57-entry-details.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
S_DAY = "create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)"
E_DAY = "grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) to service_role;"
SIG = "tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)"
M57_MD5 = "dd3749b6477664947227df46083f605d"
def block(t): i = t.index(S_DAY); return t[i:t.index(E_DAY, i) + len(E_DAY)]

text = open(M215).read() if os.path.exists(M215) else ""
ok(bool(text), "the migration file is there")
if not text: print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
ok(low.count("delete from") == 0 and not re.search(r"\bdrop\b|\btruncate\b|\brename\b", low), "0. add-only: no delete, drop, truncate or rename")
ok(not re.search(r"supabase\.co|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text))) == ["tally_ingest_day"], "0. one function: tally_ingest_day")
b57, b215 = block(open(M57).read()), block(text)
want = b57.replace("""    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
""", """    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
    -- migration 215: entries came in on a short read and no note is set yet: the day keeps the note, so a reader of
    -- tally_days (the sales check with reads off, src/js/26-sales-invoice.js) sees the day is only partly in the copy
    if n_in > 0 and d_note is null then d_note := short; end if;
""").replace("""     note = case when n_in > 0 then null else coalesce(excluded.note, tally_days.note) end;""",
             """     note = case when n_in > 0 then excluded.note else coalesce(excluded.note, tally_days.note) end;     -- 215: null for a full read, as before; the short read's note""")
ok(want != b57 and b215 == want, "0. the function is 57's text with exactly the two changes (the short read's note, and the upsert keeping it)")
src57 = b57[b57.index("$function$") + 10:b57.index("$function$;")]
ok(hashlib.md5(src57.encode()).hexdigest() == M57_MD5 and M57_MD5 in text, "0. the guard's md5 is 57's prosrc (%s)" % M57_MD5)

os.environ.setdefault("TMPDIR", "/tmp/salesro-pg")
db = pg_stand.start(30215)
def run(sql): return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def live(): return db.one("select md5(prosrc) from pg_proc where oid = %s::regprocedure" % q("public." + SIG))
STUBS = """
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('fincom.role', true), ''), 'anon') $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
alter table tally_vouchers add column if not exists deleted_at timestamptz;
create table if not exists tally_days (book_id uuid, firm_id uuid, day date, n integer not null default 0, alter_max bigint not null default 0, bytes integer not null default 0,
  at timestamptz not null default now(), empty_at timestamptz, note text, primary key (book_id, day));
create or replace function tally_month_locked(p_book uuid, p_days date[]) returns date language sql as $$ select null::date $$;
create or replace function tally_voucher_version_lines(p_book uuid, p_guids text[]) returns void language sql as $$ select $$;
create or replace function tally_ledger_day_rebuild(p_book uuid, p_days date[]) returns void language sql as $$ select $$;
create or replace function tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb, p_rebuild boolean, p_keep boolean) returns jsonb language plpgsql as $f$
begin
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno)
    select p_book, (select firm_id from tally_books where book_id = p_book), x->>'guid', (x->>'day')::date, (x->>'alter')::bigint, 'Sales', x->>'no' from jsonb_array_elements(p_vouchers) x
  on conflict (book_id, guid) do update set day = excluded.day, alter_id = excluded.alter_id, deleted_at = null;
  return jsonb_build_object('touched', coalesce((select jsonb_agg(distinct x->>'day') from jsonb_array_elements(p_vouchers) x), '[]'::jsonb));
end $f$;
"""
F = "99999999-9999-9999-9999-999999999215"
BOOKS = {"57": "f79e4bc3-871d-4482-874d-000000000057", "215": "f79e4bc3-871d-4482-874d-000000000215"}
def vs(day, n, tag): return [{"guid": "%s-%s-%d" % (tag, day, i), "alter": i + 1, "no": "S/%d" % (i + 1)} for i in range(n)]
# (day, entries in the file, p_n, p_empty) in order; the same guids each time a day is read again
SCEN = [("2026-10-01", 3, 3, False), ("2026-10-02", 2, 5, False), ("2026-10-03", 2, 5, False), ("2026-10-03", 5, 5, False),
        ("2026-10-04", 30, 30, False), ("2026-10-04", 0, 0, True), ("2026-10-05", 4, 4, False), ("2026-10-05", 0, 6, False),
        ("2026-10-06", 30, 30, False), ("2026-10-06", 0, 0, True), ("2026-10-06", 3, 30, False), ("2026-10-07", 0, 0, True), ("2026-10-08", 0, 4, False)]
def scenarios(book):
    out = []
    for d, k, n, e in SCEN:
        r = db.one("set fincom.role = 'service_role'; select tally_ingest_day(%s, %s, %s::jsonb, '[]'::jsonb, %d, %d, 0, %s)::text" % (q(book), q(d), q(json.dumps(vs(d, k, "g"))), n, k, "true" if e else "false"))
        row = db.rows("select n::text, coalesce(note, '') as note, (empty_at is not null)::text as e from tally_days where book_id = %s and day = %s" % (q(book), q(d)))[0]
        dl = db.one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is not null" % (q(book), q(d)))
        out.append((d, json.loads(r), row, dl))
    return out
try:
    r = run(STUBS); ok(r.returncode == 0, "stubs " + r.stderr[-300:])
    db.sql("insert into firms values (%s, 'ZZ Test Firm') on conflict do nothing; insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%s, %s, 'c1', 'ZZ Test Co', '2026-04-01'), (%s, %s, 'c2', 'ZZ Test Co', '2026-04-01')"
           % (q(F), q(BOOKS["57"]), q(F), q(BOOKS["215"]), q(F)))
    r = run(b57.replace(E_DAY, "") + "\n" + E_DAY + "\n"); ok(r.returncode == 0 and live() == M57_MD5, "57's function installed from its own file; live md5 %s" % live())

    print("== the guard")
    r = run(b57.replace("begin\n  if auth.role()", "begin\n  -- someone's other change\n  if auth.role()", 1))
    other = live(); ok(r.returncode == 0 and other != M57_MD5, "a function that is not 57's put in place (md5 %s)" % other)
    r = run(text); ok(r.returncode != 0 and "is not migration 57's text" in r.stderr and live() == other, "215 refuses it, nothing changed (%s)" % r.stderr.strip()[-160:])
    run(b57)
    ok(live() == M57_MD5, "57's text put back")

    print("== under 57")
    old = scenarios(BOOKS["57"])
    rows_before = db.one("select md5(string_agg(x::text, '|' order by x::text)) from tally_days x")
    r = run(text); ok(r.returncode == 0, "215 runs (1) " + r.stderr[-300:])
    r = run(text); ok(r.returncode == 0, "215 runs (2): its own text passes the guard " + r.stderr[-300:])
    ok(db.one("select md5(string_agg(x::text, '|' order by x::text)) from tally_days x") == rows_before, "running it changes no row")
    new_src = db.one("select prosrc from pg_proc where oid = %s::regprocedure" % q("public." + SIG))
    ok("migration 215" in new_src and live() != M57_MD5, "the new function in place")
    rr = db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c from pg_proc where oid = %s::regprocedure" % q("public." + SIG))[0]
    ok(rr["d"] == "true" and rr["c"].replace(" ", "") == "search_path=public,pg_temp", "security definer, search_path public, pg_temp")
    can = lambda role: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q("public." + SIG)))
    ok((can("anon"), can("authenticated"), can("service_role")) == ("f", "f", "t") and db.one("select has_function_privilege('public', %s, 'execute')" % q("public." + SIG)) == "f",
       "execute: service_role only (not public, anon, authenticated)")

    print("== under 215: the same reads")
    new = scenarios(BOOKS["215"])
    changed = []
    for i, ((d, a, ra, da), (_, b, rb, db_)) in enumerate(zip(old, new)):
        same_answer = {k: v for k, v in a.items() if k != "touched"} == {k: v for k, v in b.items() if k != "touched"} and a.get("touched") == b.get("touched")
        ok(same_answer and da == db_ and ra["n"] == rb["n"] and ra["e"] == rb["e"], "read %d (%s, %d of %d%s): the same answer, count, empty mark and deleted marks" % (i + 1, d, SCEN[i][1], SCEN[i][2], ", empty" if SCEN[i][3] else ""))
        if ra["note"] != rb["note"]: changed.append((i + 1, ra["note"], rb["note"]))
    ok(changed == [(2, "", "short read: 2 of 5"), (3, "", "short read: 2 of 5"), (11, "", "short read: 3 of 30")],
       "the note differs only where entries came on a short read: now 'short read: x of n' (%s)" % changed)
    ok(new[3][2]["note"] == "" and old[3][2]["note"] == "", "a later full read of the day clears it, as before")
    ok(new[7][2]["note"] == old[7][2]["note"] and new[12][2]["note"] == old[12][2]["note"], "a short read with no entries: the note as before")
    ok(new[5][2]["note"].startswith("empty day with 30 live entries") and new[11][2]["note"] == "empty day, nothing to mark", "the empty-read notes as before")
    print("md5 of the file: %s" % hashlib.md5(open(M215, "rb").read()).hexdigest())
    print("md5 of the new prosrc: %s" % live())
finally:
    db.stop()
    d = db.data
    if d.startswith("/tmp/salesro-pg/"): subprocess.run(["rm", "-rf", "--", d])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
