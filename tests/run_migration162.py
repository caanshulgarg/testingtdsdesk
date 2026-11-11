"""python3 tests/run_migration162.py - server/gst-run/migration-162-gst-prep.sql (next-gst-big, 11-Nov-2026): a large book's
entries made once for gst-run (gst_calc_prep, gst_calc_prep_get, gst_calc_prep_put). On a throwaway PostgreSQL (pg_stand,
port 31862 unless PG162_PORT; never a real database), made-up rows only, after migrations 151, 153 and 159.
  0. the file: one transaction, lock_timeout 10 s; add-only (one table, RLS on, no member grant; two functions, service
     role only); names no real database
  1. run before 151/153 it stops and says so; after them it runs (twice)
  2. put keeps the text exactly (key order, numbers), on the book's own firm; get gives it only on that version and engine;
     a new put replaces it; not a JSON list or no such book: false, nothing kept; the book deleted takes the row
  3. anon and authenticated may not read the table or call either function"""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(ROOT, "server", "gst-run", "migration-162-gst-prep.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read(); code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(re.findall(r"create table if not exists public\.(\w+)", code) == ["gst_calc_prep"] and "alter table public.gst_calc_prep enable row level security" in code
   and "revoke all on public.gst_calc_prep from public, anon, authenticated;" in text and "grant select, insert, update, delete on public.gst_calc_prep to service_role;" in text, "one new table, RLS on, no member grant")
ok(not re.search(r"\b(drop|truncate|delete\s+from|alter\s+table\s+(?!public\.gst_calc_prep\s))", code), "add-only: nothing dropped, deleted or altered")
SVC = {"gst_calc_prep_get": "(uuid, text, text)", "gst_calc_prep_put": "(uuid, text, text, text)"}
for fn, sig in SVC.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, fn + ": service role only")
ok(sorted(re.findall(r"create or replace function public\.(\w+)\(", code)) == sorted(SVC), "adds only its own functions")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczucr", text.lower()), "names no real database")
m151 = os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")
t151 = open(m151).read()
t153 = open(os.path.join(ROOT, "server", "gst-run", "migration-153-gst-cloud.sql")).read(); t159 = open(os.path.join(ROOT, "server", "gst-run", "migration-159-gst-posfix.sql")).read()
db = pg_stand.start(int(os.environ.get("PG162_PORT") or 31862))
try:
    F, F2, U, U2 = "99999999-9999-4999-8999-999999999162", "88888888-8888-4888-8888-888888888162", "55555555-5555-4555-8555-555555555162", "66666666-6666-4666-8666-666666666162"
    BK, BK2 = "bbbbbbbb-0162-4000-8000-000000000001", "bbbbbbbb-0162-4000-8000-000000000002"
    db.sql("""
    do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
    alter table tally_ledgers add column if not exists deleted_at timestamptz;
    alter table tally_ledger_day add column if not exists merged_into text;
    alter table tally_vouchers add column if not exists deleted_at timestamptz;
    -- the entry's columns gst-run reads, as on staging (migrations 57 and 72)
    alter table tally_vouchers add column if not exists irn text, add column if not exists irn_ack_date date, add column if not exists gst_reg_type text, add column if not exists gst_country text,
      add column if not exists gst_rcm boolean, add column if not exists gst_nature text, add column if not exists gst_taxability text, add column if not exists gst_supply text,
      add column if not exists gst_ineligible boolean, add column if not exists gst_mixed boolean, add column if not exists gst_alter_id bigint;
    alter table tally_lines add column if not exists id bigint;
    create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text, type text, amount numeric, bill_date date, credit_days integer, due date, id bigint primary key);
    create table if not exists clients (firm_id uuid, id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, id));
    create table if not exists records (firm_id uuid, kind text, id text, client_id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, kind, id));
    create table if not exists gst_2b_runs (id bigint generated always as identity primary key, firm_id uuid, client_id text, gstin text, fy text, status text, done_at timestamptz, result jsonb);
    create table if not exists gst_2b_decisions (firm_id uuid, gstin text, fy text, pair_id text, decision text, at timestamptz default now(), primary key (firm_id, gstin, fy, pair_id));
    insert into firms values ('%(F)s', 'Made-up Firm A'), ('%(F2)s', 'Made-up Firm B');
    insert into members values ('%(U)s', '%(F)s', 'A', 'viewer', true), ('%(U2)s', '%(F2)s', 'B', 'owner', true);
    insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%(BK)s', '%(F)s', 'c1', 'Synthetic Traders', '2025-04-01', '2025-04-01'), ('%(BK2)s', '%(F2)s', 'c1', 'Other', '2025-04-01', '2025-04-01');
    insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional, cmp_gstin) values ('%(BK)s', '%(F)s', 'g1', '2025-04-05', 1, 'Sales', '1', 'Birchwood Retail', false, false, '07AAKCS4821Q1ZW');
    insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, id) values ('%(BK)s', '%(F)s', 'g1', '2025-04-05', 'Sales - Goods', 1000, 1);
    insert into clients (firm_id, id, data) values ('%(F)s', 'c1', '{"name": "Synthetic Traders"}'), ('%(F)s', 'c2', '{"name": "Second"}');
    insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%(F)s', 'c1', 'map', '.Output CGST', '{"kind": "gst"}', 1), ('%(F)s', 'c1', 'twoBs', '', '{"$t": "obj"}', 2);
    """ % dict(F=F, F2=F2, U=U, U2=U2, BK=BK, BK2=BK2))
    # what 151 also reads, as on staging (pg_stand has not got it)
    db.sql("create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));")
    print("== 1. after 151 and 153")
    try: db.sql(text); ok(False, "162 before 151/153 should stop")
    except RuntimeError as e: ok("needs migrations 152 and 153" in str(e), "run before 151 and 153: stops and says so")
    db.sql(t151); db.sql(t153); db.sql(t159); db.sql(text); db.sql(text)
    ok(db.one("select count(*) from pg_proc where proname in ('gst_calc_prep_get', 'gst_calc_prep_put')") == "2", "after them: runs, twice")
    print("== 2. put and get")
    V = [{"id": "g1", "date": "20250405", "type": "Sales", "ent": [{"l": "Sales - Goods", "a": -1000.5, "r": None, "h": "8471", "gr": 18}], "alt": 1, "src": "bridge", "gstOwn": True, "zz": 1e-7}]
    txt = json.dumps(V, separators=(",", ":")); q = lambda s: "'" + s.replace("'", "''") + "'"
    ok(db.one("select gst_calc_prep_put('%s', 'v1', 'e1', %s)" % (BK, q(txt))) == "t", "put: kept")
    got = db.one("select gst_calc_prep_get('%s', 'v1', 'e1')::text" % BK)
    ok(got == txt, "get: the text exactly as put (key order, numbers): " + str(got)[:60])
    ok(db.one("select firm_id from gst_calc_prep where book_id = '%s'" % BK) == F, "kept on the book's own firm")
    ok(db.one("select gst_calc_prep_get('%s', 'v2', 'e1') is null" % BK) == "t" and db.one("select gst_calc_prep_get('%s', 'v1', 'e2') is null" % BK) == "t", "another version or engine: null")
    txt2 = json.dumps(V + V)
    ok(db.one("select gst_calc_prep_put('%s', 'v2', 'e1', %s)" % (BK, q(txt2))) == "t" and db.one("select gst_calc_prep_get('%s', 'v1', 'e1') is null" % BK) == "t"
       and db.one("select gst_calc_prep_get('%s', 'v2', 'e1')::text" % BK) == txt2 and db.one("select count(*) from gst_calc_prep") == "1", "a new put replaces the book's earlier one")
    ok(db.one("select gst_calc_prep_put('%s', 'v1', 'e1', '{\"a\": 1}')" % BK2) == "f" and db.one("select gst_calc_prep_put('cccccccc-0162-4000-8000-000000000009', 'v1', 'e1', '[]')") == "f"
       and db.one("select count(*) from gst_calc_prep") == "1", "not a JSON list, or no such book: false, nothing kept")
    try: db.sql("select gst_calc_prep_put('%s', 'v1', 'e1', '[1,')" % BK2); bad = False
    except RuntimeError: bad = True
    ok(bad and db.one("select count(*) from gst_calc_prep where book_id = '%s'" % BK2) == "0", "text that is not JSON: refused, nothing kept")
    db.sql("delete from tally_books where book_id = '%s'" % BK)
    ok(db.one("select count(*) from gst_calc_prep") == "0", "the book deleted takes its row")
    print("== 3. members")
    for role in ("anon", "authenticated"):
        for s in ("select count(*) from gst_calc_prep", "select gst_calc_prep_get('%s', 'v1', 'e1')" % BK2, "select gst_calc_prep_put('%s', 'v1', 'e1', '[]')" % BK2):
            try: db.sql("set role %s; %s;" % (role, s)); ok(False, role + " may not: " + s)
            except RuntimeError as e: ok("permission denied" in str(e), role + " may not: " + s.split("(")[0])
finally:
    db.stop()
print("all ok" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
