"""python3 tests/run_migration153.py - server/gst-run/migration-153-gst-cloud.sql (next-cloud-gst, 09-Nov-2026): the version a
cloud 3B is kept by, and a member's read of the kept 3B. On a throwaway PostgreSQL (pg_stand, port 31153 unless PG153_PORT;
never a real database), made-up rows only.
153 needs migration 151 (branch next-cloud-calc1: tally_calc_results, tally_calc_version). 151 is taken from
server/tally-cloud/migration-151-cloud-calc-1.sql when this branch has it, else from commit 37fcf2489 (git show).
  0. the file: one transaction, lock_timeout 10 s; add-only (no table made, nothing dropped, deleted or altered); grants
     explicit (gst_calc_version service role only; gst_calc_cached members); names no real database
  1. run before 151 it stops and says so; after 151, it runs (twice)
  2. gst_calc_version moves on every input of a 3B: an entry, a line, a 2B month, an IMS decision, a figure typed into 3B,
     a return marked filed, a GST setting, the ledger list, the client's record, a marketplace sale, a 2B matching run and
     a decision on it; it stays the same when nothing changed and when another client's or another firm's rows change
  3. gst_calc_cached: a member reads the kept 3B while it is current, nothing after a change; another firm's member reads
     nothing; anon and authenticated may not call gst_calc_version"""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M153 = os.path.join(ROOT, "server", "gst-run", "migration-153-gst-cloud.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

text = open(M153).read(); code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("create table" not in code and "delete from" not in code and not re.search(r"\b(drop|truncate|alter)\s", code), "add-only: no table made, nothing dropped, deleted, truncated or altered")
ok("revoke all on function public.gst_calc_version(uuid, text) from public, anon, authenticated;" in text and "grant execute on function public.gst_calc_version(uuid, text) to service_role;" in text, "gst_calc_version: service role only")
ok("revoke all on function public.gst_calc_cached(text, date, text, text) from public, anon;" in text and "grant execute on function public.gst_calc_cached(text, date, text, text) to authenticated, service_role;" in text, "gst_calc_cached: members")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["gst_calc_cached", "gst_calc_version"], "adds gst_calc_version and gst_calc_cached only")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczucr", text.lower()), "names no real database")

m151 = os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")
t151 = open(m151).read() if os.path.exists(m151) else subprocess.run(["git", "-C", ROOT, "show", "37fcf2489:server/tally-cloud/migration-151-cloud-calc-1.sql"], capture_output=True, text=True).stdout
if not t151.strip():
    print("  SKIP: migration 151 is not in this checkout (commit 37fcf2489 not fetched): sections 1 to 3 need it"); sys.exit(1 if fails else 0)

db = pg_stand.start(int(os.environ.get("PG153_PORT") or 31153))
try:
    F, F2, U, U2 = "99999999-9999-4999-8999-999999999153", "88888888-8888-4888-8888-888888888153", "55555555-5555-4555-8555-555555555153", "66666666-6666-4666-8666-666666666153"
    BK, BK2 = "bbbbbbbb-0153-4000-8000-000000000001", "bbbbbbbb-0153-4000-8000-000000000002"
    db.sql("""
    do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
    alter table tally_ledgers add column if not exists deleted_at timestamptz;
    alter table tally_ledger_day add column if not exists merged_into text;
    alter table tally_vouchers add column if not exists deleted_at timestamptz;
    alter table tally_lines add column if not exists id bigint;
    create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text, type text, amount numeric, bill_date date, credit_days integer, due date, id bigint primary key);
    create table if not exists clients (firm_id uuid, id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, id));
    create table if not exists records (firm_id uuid, kind text, id text, client_id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, kind, id));
    create table if not exists gst_2b_runs (id bigint generated always as identity primary key, firm_id uuid, client_id text, gstin text, fy text, status text, done_at timestamptz, result jsonb);
    create table if not exists gst_2b_decisions (firm_id uuid, gstin text, fy text, pair_id text, decision text, at timestamptz default now(), primary key (firm_id, gstin, fy, pair_id));
    insert into firms values ('%(F)s', 'Made-up Firm A'), ('%(F2)s', 'Made-up Firm B');
    insert into members values ('%(U)s', '%(F)s', 'A', 'viewer', true), ('%(U2)s', '%(F2)s', 'B', 'owner', true);
    insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%(BK)s', '%(F)s', 'c1', 'Synthetic Traders', '2025-04-01', '2025-04-01'), ('%(BK2)s', '%(F2)s', 'c1', 'Other', '2025-04-01', '2025-04-01');
    insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional) values ('%(BK)s', '%(F)s', 'g1', '2025-04-05', 1, 'Sales', '1', 'Birchwood Retail', false, false);
    insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, id) values ('%(BK)s', '%(F)s', 'g1', '2025-04-05', 'Sales - Goods', 1000, 1);
    insert into clients (firm_id, id, data) values ('%(F)s', 'c1', '{"name": "Synthetic Traders"}'), ('%(F)s', 'c2', '{"name": "Second"}');
    insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%(F)s', 'c1', 'map', '.Output CGST', '{"kind": "gst"}', 1), ('%(F)s', 'c1', 'twoBs', '', '{"$t": "obj"}', 2);
    """ % dict(F=F, F2=F2, U=U, U2=U2, BK=BK, BK2=BK2))
    print("== 1. 151 first")
    try: db.sql(text); ok(False, "153 before 151 should stop")
    except RuntimeError as e: ok("needs migration 151" in str(e), "run before 151: stops and says 151 comes first")
    db.sql(t151); db.sql(text); db.sql(text)
    ok(db.one("select count(*) from pg_proc where proname in ('gst_calc_version', 'gst_calc_cached')") == "2", "after 151: runs, twice")
    V = lambda: db.one("select gst_calc_version('%s', 'c1')" % BK)
    print("== 2. the version moves on every input")
    seq = [3]
    def nseq(): seq[0] += 1; return seq[0]
    def item(key, i, data): return "insert into client_book_items (firm_id, client_id, key, item, data, seq, updated_at) values ('%s', 'c1', '%s', '%s', '%s', %d, now()) on conflict (firm_id, client_id, key, item) do update set data = excluded.data, seq = excluded.seq, updated_at = now()" % (F, key, i, json.dumps(data).replace("'", "''"), nseq())
    steps = [
        ("an entry added", "insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional) values ('%s', '%s', 'g2', '2025-04-06', 2, 'Purchase', '2', 'Alder Supply Co', false, false)" % (BK, F)),
        ("an entry altered in Tally (AlterID)", "update tally_vouchers set alter_id = 9 where guid = 'g2'"),
        ("an entry deleted in Tally", "update tally_vouchers set deleted_at = now() where guid = 'g2'"),
        ("a 2B month brought in", item("twoBs", ".07AAKCS4821Q1ZW|052025", {"rows": []})),
        ("an IMS decision", item("itcTrack", ".07", {"dec": {"R|x": {"act": "accept"}}})),
        ("a figure typed into 3B", item("gst3b", ".07|202505", {"rev2": {"igst": 100}})),
        ("a return marked filed", item("gstFiled", ".07", {"202505": {"r3b": "2025-06-20"}})),
        ("a GST setting (QRMP)", item("gstSet", ".07", {"filing": [{"type": "qrmp", "from": "202601"}]})),
        ("the ledger list", item("map", ".Output CGST", {"kind": "gst", "ok": True})),
        ("an item deleted", "update client_book_items set deleted = true, seq = %d where key = 'gst3b'" % nseq()),
        ("the client's record", "update clients set data = '{\"name\": \"Synthetic Traders\", \"choices\": {\"advGst\": {\"value\": \"on\"}}}', updated_at = now() where id = 'c1'"),
        ("a marketplace sale", "insert into records (firm_id, kind, id, client_id, data) values ('%s', 'sales', 'c1:mk1', 'c1', '{\"source\": \"market\"}')" % F),
        ("a 2B matching run kept", "insert into gst_2b_runs (firm_id, client_id, gstin, fy, status, done_at, result) values ('%s', 'c1', '07AAKCS4821Q1ZW', '2025-26', 'done', now(), '{}')" % F),
        ("a decision on its pairs", "insert into gst_2b_decisions (firm_id, gstin, fy, pair_id, decision) values ('%s', '07AAKCS4821Q1ZW', '2025-26', 'k>g1', 'accept')" % F),
        ("the decision changed", "update gst_2b_decisions set decision = 'reject'"),
    ]
    v = V(); ok(v and V() == v, "nothing changed: the same version")
    for what, q in steps:
        db.sql(q); w = V(); ok(w != v, "moves on " + what); v = w
    for what, q in [("another client's item", "insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%s', 'c2', 'gst3b', '', '{}', 999)" % F),
                    ("another firm's book", "insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, cancelled, optional) values ('%s', '%s', 'x1', '2025-04-05', 1, 'Sales', false, false)" % (BK2, F2)),
                    ("another client's sale", "insert into records (firm_id, kind, id, client_id, data) values ('%s', 'sales', 'c2:mk1', 'c2', '{}')" % F)]:
        db.sql(q); ok(V() == v, "stays on " + what)
    print("== 3. a member reads what is kept, while it is current")
    db.sql("insert into tally_calc_results (book_id, firm_id, kind, args, version, result, ms) values ('%s', '%s', 'gst-3b', '07|202505', '%s', '{\"payable\": 1234.5, \"engine\": \"e1\"}', 40)" % (BK, F, v))
    r = json.loads(db.one("select gst_calc_cached('c1', null, '07', '202505')", uid=U))
    ok(r.get("result", {}) and r["result"]["payable"] == 1234.5 and r["version"] == v, "a member of the firm: the kept 3B")
    r2 = json.loads(db.one("select gst_calc_cached('c1', null, '07', '202505')", uid=U2))
    ok(not r2.get("result") and r2.get("book") == BK2, "another firm's member: its own book only, no 3B of this firm")
    db.sql(item("gstOpen", ".07", {"igst": 1}))
    r = json.loads(db.one("select gst_calc_cached('c1', null, '07', '202505')", uid=U))
    ok(r.get("result") is None, "after a change (the opening credit typed): nothing current")
    for role in ("anon", "authenticated"):
        try: db.sql("set role %s; select gst_calc_version('%s', 'c1');" % (role, BK)); ok(False, role + " may not call gst_calc_version")
        except RuntimeError as e: ok("permission denied" in str(e), role + " may not call gst_calc_version")
finally:
    db.stop()
print("%d FAILED" % len(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
