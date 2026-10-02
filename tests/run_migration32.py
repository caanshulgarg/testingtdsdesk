"""python3 run_migration32.py - migration-32 (FinCom Bridge 2.1.5: the baseline once, then only changes by AlterID; no
balance asked of Tally). On a throwaway PostgreSQL (pg_stand), with the cloud tables as on staging (02-Oct-2026) and
made-up books. Checks: the file runs twice without harm; the last AlterIDs are kept in the cloud and only go up (unless
reset); changed masters are added, moved and renamed by GUID (entries, bills, parties and day totals follow, sums kept),
their stored opening moves the opening by its change only; the per-day ids and counts match the bridge's md5 rule; the
primary-group totals are worked out from openings and entries (this year only for income and expenses); the nightly
result names the ledgers on the differing days; "Re-read these" asks the bridge and is cleared when done; tally_status
carries it; a signed-in member cannot call the bridge's functions."""
import os, sys, json, subprocess, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
TC = os.path.join(HERE, "..", "server", "tally-cloud")
SQL = os.path.join(TC, "migration-32-alterid-sync.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SCHEMA = """
drop table if exists tally_books, tally_ledgers, tally_groups, tally_vouchers, tally_lines, tally_bills, tally_ledger_day, tally_days, tally_devices, tally_companies, tally_vouchers_gone cascade;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('fincom.role', true), ''), 'service_role') $$;
create table tally_books (book_id uuid primary key, firm_id uuid not null, client_id text not null, company text not null, from_date date, open_as_on date,
  ledgers_at timestamptz, days_at timestamptz, state jsonb not null default '{}', state_at timestamptz);
create table tally_ledgers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, name text not null, parent text not null default '',
  open numeric not null default 0, chain text[] not null default '{}', primary_group text not null default '', merged_into text, gstin text, pan text,
  primary key (book_id, name));
create table tally_groups (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, name text not null, parent text not null default '', primary key (book_id, name));
create table tally_vouchers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, alter_id bigint not null default 0,
  vtype text not null default '', vno text not null default '', party text not null default '', narration text not null default '', cancelled boolean not null default false,
  optional boolean not null default false, gstin text not null default '', pos text not null default '', ref text not null default '', ref_date date, cmp_gstin text not null default '',
  primary key (book_id, guid));
create table tally_lines (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, ledger text not null,
  amount numeric not null, hsn text not null default '', rate numeric);
create table tally_bills (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, ledger text not null,
  name text not null default '', type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);
create table tally_ledger_day (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, ledger text not null, day date not null,
  amount numeric not null default 0, dr numeric not null default 0, cr numeric not null default 0, n integer not null default 0, primary key (book_id, ledger, day));
create table tally_days (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, day date not null, n integer not null default 0,
  alter_max bigint not null default 0, bytes integer not null default 0, at timestamptz not null default now(), primary key (book_id, day));
create table tally_devices (id uuid primary key, firm_id uuid not null, name text, key_hash text, revoked boolean not null default false, want_update_at timestamptz, want_sent_at timestamptz, info jsonb default '{}');
create table tally_companies (firm_id uuid not null, company text not null, client_id text, device_id uuid, book_id uuid, primary key (firm_id, company));
create table tally_vouchers_gone (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, alter_id bigint, vtype text, vno text, party text, gstin text,
  ref text, ref_date date, optional boolean, lines jsonb, gone_at timestamptz not null default now(), back_at timestamptz, primary key (book_id, guid, gone_at));
"""
B, F, U, DEV = "11111111-1111-1111-1111-111111111111", "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "77777777-7777-7777-7777-777777777777"
def q(s): return "'" + str(s).replace("'", "''") + "'"
def body(path): return pg_stand.migration_body(path)

# made-up books: from 1-Apr-2026; Cash (Current Assets), Party X (Sundry Debtors < Current Assets), Sales (Sales Accounts)
ROWS = """
insert into firms values (%(F)s, 'Firm') on conflict do nothing;
insert into members values (%(U)s, %(F)s, 'Me', 'owner', true);
insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
insert into tally_devices (id, firm_id, name, key_hash) values (%(DEV)s, %(F)s, 'PC', 'h');
insert into tally_companies values (%(F)s, 'ZZ CO', 'c1', %(DEV)s, %(B)s);
insert into tally_groups (book_id, firm_id, name, parent) values (%(B)s, %(F)s, 'Current Assets', ''), (%(B)s, %(F)s, 'Sundry Debtors', 'Current Assets'),
  (%(B)s, %(F)s, 'Cash-in-Hand', 'Current Assets'), (%(B)s, %(F)s, 'Sales Accounts', ''), (%(B)s, %(F)s, 'Capital Account', '');
insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, chain, primary_group) values
  (%(B)s, %(F)s, 'Cash', 'Cash-in-Hand', -1000, -1000, '{Cash-in-Hand,Current Assets}', 'Current Assets'),
  (%(B)s, %(F)s, 'Party X', 'Sundry Debtors', -500, -500, '{Sundry Debtors,Current Assets}', 'Current Assets'),
  (%(B)s, %(F)s, 'Capital', 'Capital Account', 1500, 1500, '{Capital Account}', 'Capital Account'),
  (%(B)s, %(F)s, 'Sales', 'Sales Accounts', 0, 0, '{Sales Accounts}', 'Sales Accounts');
insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party) values
  (%(B)s, %(F)s, 'g-b', '2026-05-02', 12, 'Sales', '1', 'Party X'), (%(B)s, %(F)s, 'g-a', '2026-05-02', 11, 'Receipt', '2', 'Party X'),
  (%(B)s, %(F)s, 'G-C', '2026-05-02', 13, 'Sales', '3', 'Party X'), (%(B)s, %(F)s, 'g-o', '2026-05-02', 14, 'Sales', '4', 'Party X'),
  (%(B)s, %(F)s, 'g-d', '2026-06-10', 20, 'Sales', '5', 'Party X');
update tally_vouchers set optional = true where guid = 'g-o';
insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values
  (%(B)s, %(F)s, 'g-b', '2026-05-02', 'Party X', -300), (%(B)s, %(F)s, 'g-b', '2026-05-02', 'Sales', 300),
  (%(B)s, %(F)s, 'g-a', '2026-05-02', 'Cash', -200), (%(B)s, %(F)s, 'g-a', '2026-05-02', 'Party X', 200),
  (%(B)s, %(F)s, 'G-C', '2026-05-02', 'Party X', -50), (%(B)s, %(F)s, 'G-C', '2026-05-02', 'Sales', 50),
  (%(B)s, %(F)s, 'g-o', '2026-05-02', 'Party X', -999), (%(B)s, %(F)s, 'g-o', '2026-05-02', 'Sales', 999),
  (%(B)s, %(F)s, 'g-d', '2026-06-10', 'Party X', -100), (%(B)s, %(F)s, 'g-d', '2026-06-10', 'Sales', 100);
insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount) values (%(B)s, %(F)s, 'g-b', '2026-05-02', 'Party X', 'B1', 'New Ref', -300);
insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select l.book_id, l.firm_id, l.ledger, l.day, sum(l.amount), sum(greatest(-l.amount, 0)), sum(greatest(l.amount, 0)), count(*)
    from tally_lines l join tally_vouchers v using (book_id, guid) where not v.optional group by 1, 2, 3, 4;
insert into tally_days (book_id, firm_id, day, n, alter_max) values (%(B)s, %(F)s, '2026-05-02', 4, 14), (%(B)s, %(F)s, '2026-06-10', 1, 20);
""" % {k: q(v) for k, v in dict(F=F, U=U, B=B, DEV=DEV).items()}

db = pg_stand.start(55442)
try:
    db.sql(SCHEMA)
    db.sql(body(os.path.join(TC, "migration-20-ledger-names.sql")))     # tally_nm (and its reports)
    db.sql(body(os.path.join(TC, "migration-8-year-openings.sql")))     # tally_year_openings
    db.sql(ROWS)
    # 1. the whole file as the owner runs it (psql, stop at the first error), twice
    for i in (1, 2):
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                            "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(SQL).read(), capture_output=True, text=True)
        ok(r.returncode == 0, "the file runs (run %d) %s" % (i, (r.stderr or "")[-400:]))
    cols = {r["column_name"] for r in db.rows("select column_name from information_schema.columns where table_name in ('tally_books', 'tally_ledgers')")}
    ok({"sync", "verify", "reread", "guid", "alter_id", "open_master"} <= cols, "the new columns are there")
    ok(db.one("select count(*) from tally_ledgers") == "4" and db.one("select count(*) from tally_vouchers") == "5", "nothing was deleted")

    j = lambda s, uid=None: json.loads(db.one(s, uid))
    # 2. the last AlterIDs, kept in the cloud
    g = j("select tally_sync_get(%s)" % q(B))
    ok(g["lastV"] == 20 and g["lastVKept"] is False and g["days"] == 2 and g["from"] == "20260401" and g["ledgers"] == 4,
       "before the bridge says: the highest AlterID of the day books kept (20), the period and counts (%s)" % g)
    db.sql("select tally_sync_set(%s, '{\"lastV\": 120, \"lastM\": 40, \"base\": {\"phase\": \"live\"}}')" % q(B))
    g = j("select tally_sync_get(%s)" % q(B))
    ok(g["lastV"] == 120 and g["lastM"] == 40 and g["lastVKept"] is True and g["base"]["phase"] == "live", "kept: lastV 120, lastM 40")
    db.sql("select tally_sync_set(%s, '{\"lastV\": 90, \"lastM\": 10}')" % q(B))
    g = j("select tally_sync_get(%s)" % q(B))
    ok(g["lastV"] == 120 and g["lastM"] == 40, "a lower number does not take the cloud back")
    db.sql("select tally_sync_set(%s, '{\"lastV\": 90, \"lastM\": 30, \"reset\": true}')" % q(B))
    g = j("select tally_sync_get(%s)" % q(B))
    ok(g["lastV"] == 90 and g["lastM"] == 30, "Tally's numbers gone back (reset): taken as they are")
    db.sql("select tally_sync_set(%s, '{\"lastV\": 120, \"lastM\": 40}')" % q(B))

    # 3. changed masters. First seen with a GUID: the opening as it is (the copy starts later than the books in Tally)
    led = lambda n: (db.rows("select * from tally_ledgers where book_id = %s and name = %s" % (q(B), q(n))) or [None])[0]
    r = j("""select tally_ingest_masters(%s, '[["Party X", "Sundry Debtors", "-700", "07AAACX1234A1Z5", "AAACX1234A", "guid-px", 41, ""],
             ["Cash", "Cash-in-Hand", "-1000", "", "", "guid-cash", 42, ""]]', '[]', false, null, null, 42)""" % q(B))
    x = led("Party X")
    ok(r["changed"] == 2 and r["added"] == 0 and float(x["open"]) == -500 and float(x["open_master"]) == -700 and x["guid"] == "guid-px" and x["gstin"] == "07AAACX1234A1Z5",
       "first seen: the opening kept (-500), the stored one noted (-700), GUID and GSTIN kept")
    ok(j("select tally_sync_get(%s)" % q(B))["lastM"] == 42, "lastM goes up with the masters (42)")
    # the stored opening changed in Tally by -100: the opening moves by -100
    j("""select tally_ingest_masters(%s, '[["Party X", "Sundry Debtors", "-800", "", "", "guid-px", 43, ""]]', '[]', false, null, null, 43)""" % q(B))
    ok(float(led("Party X")["open"]) == -600, "the stored opening moved by -100: the opening too (-600)")
    sums0 = db.rows("select sum(amount) a, count(*) n from tally_ledger_day where book_id = %s" % q(B))[0]
    # renamed in Tally (same GUID): the row, the lines, the bills, the parties and the day totals follow
    r = j("""select tally_ingest_masters(%s, '[["Party Y", "Sundry Debtors", "-800", "", "", "guid-px", 44, ""]]', '[]', false, null, null, 44)""" % q(B))
    ok(r["renamed"] == 1 and led("Party X") is None and float(led("Party Y")["open"]) == -600, "renamed by GUID: Party X is Party Y, opening kept")
    ok(db.one("select count(*) from tally_lines where ledger = 'Party X'") == "0" and db.one("select count(*) from tally_lines where ledger = 'Party Y'") == "5", "the lines follow the rename")
    ok(db.one("select count(*) from tally_bills where ledger = 'Party Y'") == "1" and db.one("select count(*) from tally_vouchers where party = 'Party Y'") == "5", "bills and parties follow")
    sums1 = db.rows("select sum(amount) a, count(*) n from tally_ledger_day where book_id = %s" % q(B))[0]
    ok(sums0 == sums1 and db.one("select count(*) from tally_ledger_day where ledger = 'Party X'") == "0", "the day totals follow, the sums unchanged (%s)" % sums1)
    # a new ledger, under a new group: added with its stored opening; its chain worked out
    j("""select tally_ingest_masters(%s, '[["Bank Z", "Bank Accounts", "-250.5", "", "", "guid-bz", 45, ""]]', '[["Bank Accounts", "Current Assets"]]', false, null, null, 45)""" % q(B))
    x = led("Bank Z")
    ok(x and float(x["open"]) == -250.5 and x["primary_group"] == "Current Assets" and x["chain"] == "{\"Bank Accounts\",\"Current Assets\"}", "a new ledger: its stored opening and chain (%s)" % x)
    # a baseline read by the bridge: the stored opening is the opening, and the period moves to the books' start
    db.sql("insert into tally_books (book_id, firm_id, client_id, company) values ('33333333-3333-3333-3333-333333333333', %s, 'c2', 'NEW CO')" % q(F))
    j("""select tally_ingest_masters('33333333-3333-3333-3333-333333333333', '[["Cash", "Cash-in-Hand", "-10", "", "", "g1", 3, ""]]', '[["Cash-in-Hand", "Current Assets"]]', true, '2024-04-01', '2024-03-31', 3)""")
    ok(db.one("select from_date || ' ' || open_as_on from tally_books where company = 'NEW CO'") == "2024-04-01 2024-03-31"
       and db.one("select open from tally_ledgers where name = 'Cash' and book_id = '33333333-3333-3333-3333-333333333333'") == "-10.00",
       "a baseline: the books' start and the stored openings")

    # 4. the deletion check: per day, count and md5 of guid:alterid in GUID order (bytewise), optional entries left out
    ids = j("select tally_day_ids(%s, '2026-04-01', '2026-06-30')" % q(B))
    want = hashlib.md5(",".join(sorted(["g-b:12", "g-a:11", "G-C:13"], key=lambda s: s.encode())).encode()).hexdigest()
    ok(ids[0] == ["20260502", 3, want] and ids[1][0:2] == ["20260610", 1], "per day: the count and the bridge's md5 (%s)" % ids)

    # 5. the nightly check: primary-group totals worked out from openings and entries
    v = j("select tally_verify(%s, '2026-06-30', '[]')" % q(B))
    gr = {x[0]: x[2] for x in v["groups"]}
    # Current Assets: Cash -1000-200 = -1200; Party Y -600 -300+200-50-100 = -850; Bank Z -250.5: -2300.5. Sales: 450. Capital 1500
    ok(abs(gr["Current Assets"] - -2300.5) < 0.005 and abs(gr["Sales Accounts"] - 450) < 0.005 and abs(gr["Capital Account"] - 1500) < 0.005, "the cloud's group totals (%s)" % gr)
    tally = json.dumps([["Current Assets", "-2300.50"], ["Sales Accounts", "450.00"], ["Capital Account", "1500.00"]])
    ok(j("select tally_verify(%s, '2026-06-30', %s)" % (q(B), q(tally)))["differ"] == 0, "the same as Tally's: nothing differs")
    tally = json.dumps([["Current Assets", "-2400.50"], ["Sales Accounts", "450.00"], ["Capital Account", "1500.00"]])
    v = j("select tally_verify(%s, '2026-06-30', %s)" % (q(B), q(tally)))
    ok(v["differ"] == 1, "Tally's Current Assets differ by 100: one group differs")
    # a later year: income and expenses count only that year's entries
    v2 = j("select tally_verify(%s, '2027-05-01', '[]')" % q(B))
    ok({x[0]: x[2] for x in v2["groups"]}["Sales Accounts"] == 0, "next year: the income group starts again at nil")

    # 6. the night's result: the ledgers on the differing day, and "Re-read these"
    s = j("select tally_verify_save(%s, %s)" % (q(B), q(json.dumps(dict(v, days=["20260610"], masters=[], totals=True)))))
    ok(s["ok"] is False and s["n"] == 2 and s["ledgers"] == ["Party Y", "Sales"], "the result: 2 ledgers to check (%s)" % s.get("ledgers"))
    st = j("select tally_status('c1')", uid=U)
    ok(st[0]["verify"]["n"] == 2 and st[0]["sync"]["lastV"] == 120, "tally_status carries the check and the sync")
    rr = j("select tally_reread('c1')", uid=U)
    rb = j("select reread from tally_books where book_id = %s" % q(B))
    ok(rr["ok"] and rr["devices"] == 1 and rb["days"] == ["20260610"] and rb["masters"] is False and db.one("select want_update_at is not null from tally_devices") == "t",
       "Re-read these: the days asked of the bridge, the computer woken (%s)" % rb)
    db.sql("select tally_sync_set(%s, %s)" % (q(B), q(json.dumps({"rereadDone": "nope"}))))
    ok(j("select reread from tally_books where book_id = %s" % q(B)) is not None, "another request's mark does not clear it")
    db.sql("select tally_sync_set(%s, %s)" % (q(B), q(json.dumps({"rereadDone": rb["at"]}))))
    ok(db.one("select reread is null from tally_books where book_id = %s" % q(B)) == "t" and "rereadAt" in j("select verify from tally_books where book_id = %s" % q(B)),
       "done: the request cleared, the check marked read again")
    nb = j("select tally_reread('c1')", uid=U)
    ok(nb["ok"] is True, "asked again while the last check still differs")

    # 7. who may call: a signed-in member cannot reach the bridge's functions
    for f in ["tally_sync_get(%s)" % q(B), "tally_day_ids(%s, '2026-04-01', '2026-06-30')" % q(B), "tally_sync_set(%s, '{}')" % q(B)]:
        try:
            db.sql("set fincom.role = 'authenticated'; select " + f + ";")
            ok(False, "a member was refused " + f)
        except RuntimeError as e:
            ok("not allowed" in str(e), "a member is refused " + f.split("(")[0])
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
