"""python3 run_golive_dryrun.py - the read-only "dry run" queries in docs/GO-LIVE.md (section 1.2) for the migrations that
change rows already on live: 13, 23, 27, 32 and 37. On a throwaway PostgreSQL (pg_stand), never on staging or live.
For each: the query is taken from GO-LIVE.md as written; it runs on tables shaped as on Build 199 (before go: the later
columns and tables are not there yet) and on tables as they are when the file runs (the window); then the migration's own
data statements, copied out of the migration file word for word, run, and the rows they touched (new xmin, or gone) are
counted. The query's numbers must equal those counts. The queries must also write nothing (run in a read-only transaction)."""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..")
TC = os.path.join(ROOT, "server", "tally-cloud")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def read(p): return open(p).read()
DOC = read(os.environ.get("GOLIVE_DOC") or os.path.join(ROOT, "docs", "GO-LIVE.md"))
def dry(n):
    m = re.search(r"-- dry run %s\n(.*?)\n-- end" % n, DOC, re.S); assert m, "no dry run %s in GO-LIVE.md" % n; return m.group(1)
def cut(path, start, end, incl_end=True):
    s = read(path); i = s.index(start); j = s.index(end, i)
    return s[i:j + len(end)] if incl_end else s[i:j]

F, B1, B2 = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
# Build 199's tally tables (server/tally-cloud/migration.sql, -4-want) and clients, without foreign keys
BUILD199 = """
drop table if exists tally_books, tally_ledgers, tally_ledger_day, tally_lines, tally_vouchers cascade;
create table tally_books (book_id uuid primary key, firm_id uuid not null, client_id text not null, company text not null, from_date date, open_as_on date);
create table tally_devices (id uuid primary key default gen_random_uuid(), firm_id uuid not null, name text not null, key_hash text not null unique, revoked boolean not null default false, want_update_at timestamptz);
create table tally_companies (firm_id uuid not null, company text not null, client_id text, gstin text, book_id uuid not null default gen_random_uuid(), primary key (firm_id, company));
create table tally_ledgers (book_id uuid not null, firm_id uuid not null, name text not null, parent text not null default '', open numeric(18,2) not null default 0, primary key (book_id, name));
create table tally_vouchers (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, alter_id bigint not null default 0, vtype text not null default '', vno text not null default '',
  party text not null default '', narration text not null default '', cancelled boolean not null default false, optional boolean not null default false, primary key (book_id, guid));
create table tally_lines (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, ledger text not null, amount numeric(18,2) not null);
create table tally_ledger_day (book_id uuid not null, firm_id uuid not null, ledger text not null, day date not null, amount numeric(18,2) not null default 0, dr numeric(18,2) not null default 0,
  cr numeric(18,2) not null default 0, n integer not null default 0, primary key (book_id, ledger, day));
create table clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, gstin text, updated_at timestamptz, primary key (firm_id, id));
"""
# what 6, 7, 8 and 9 add to those tables (copied from the files)
def forward():
    s6, s7 = read(os.path.join(TC, "migration-6-groups-gst.sql")), read(os.path.join(TC, "migration-7-bills.sql"))
    out = [l for l in s6.splitlines() if l.startswith("alter table public.tally_") and "add column" in l]
    out.append(cut(os.path.join(TC, "migration-6-groups-gst.sql"), "create table if not exists public.tally_groups (", ");"))
    out.append(cut(os.path.join(TC, "migration-7-bills.sql"), "create table if not exists public.tally_bills (", ");"))
    for f in ("migration-8-year-openings.sql", "migration-9-ledger-twins.sql"):
        out += [l for l in read(os.path.join(TC, f)).splitlines() if l.startswith("alter table public.tally_ledgers add column")]
    return re.sub(r"references public\.\w+\s*\([^)]*\)( on delete cascade)?", "", "\n".join(out))

R = r"&#13;&#10;"
SEED = f"""
insert into firms (id, name) values ('{F}', 'Firm') on conflict do nothing;
insert into tally_books values ('{B1}', '{F}', 'c1', 'ALPHA', '2026-04-01', '2026-03-31'), ('{B2}', '{F}', 'c2', 'BETA', '2026-04-01', '2026-03-31');
insert into tally_devices (firm_id, name, key_hash) values ('{F}', 'PC-1', 'k1'), ('{F}', 'PC-2', 'k2'), ('{F}', 'PC-3', 'k3');
insert into tally_companies (firm_id, company, client_id, gstin) values ('{F}', 'ALPHA', 'c1', '27AAAAA0000A1Z5'), ('{F}', 'BETA', 'c2', '27BBBBB0000B1Z5'),
  ('{F}', 'GAMMA 1', 'c3', '27CCCCC0000C1Z5'), ('{F}', 'GAMMA 2', 'c3', '27CCCCC0000C1Z5'), ('{F}', 'DELTA', 'c4', '27DDDDD0000D1Z5'), ('{F}', 'EPS', 'c5', '');
insert into clients (id, firm_id, name, data, deleted, gstin) values
  ('c1', '{F}', 'Alpha', '{{}}', false, '27aaaaa0000a1z5'),                       -- set (same GSTIN, case aside)
  ('c2', '{F}', 'Beta', '{{"postTo": "BETA"}}', false, '27BBBBB0000B1Z5'),        -- kept: already chosen
  ('c3', '{F}', 'Gamma', '{{}}', false, '27CCCCC0000C1Z5'),                       -- kept: two companies
  ('c4', '{F}', 'Delta', '{{"gstin": "27DDDDD0000D1Z5"}}', false, ''),            -- set (GSTIN in data)
  ('c5', '{F}', 'Eps', '{{}}', false, ''),                                         -- kept: no GSTIN
  ('c6', '{F}', 'Gone', '{{}}', true, '27AAAAA0000A1Z5');
insert into tally_ledgers (book_id, firm_id, name, parent, open) values
  ('{B1}', '{F}', 'MCS Project Pvt Ltd' || chr(13) || chr(10), 'Sundry Debtors', 6000),   -- unclean, alone: renamed
  ('{B1}', '{F}', 'RAKVIK{R}', 'Sundry Debtors', -17550),                                    -- unclean, with a clean twin
  ('{B1}', '{F}', 'RAKVIK', '', 0),                                                          -- the clean twin: rewritten
  ('{B1}', '{F}', 'Arktos  Control', 'Sundry Creditors' || chr(10), 0),                    -- parent unclean
  ('{B1}', '{F}', 'Cash', 'Cash-in-Hand', 100),                                              -- untouched
  ('{B2}', '{F}', 'Sales', 'Sales Accounts', 0);
insert into tally_vouchers (book_id, firm_id, guid, day, party, narration) values
  ('{B1}', '{F}', 'g1', '2026-04-02', 'MCS Project Pvt Ltd' || chr(13) || chr(10), 'Bill | TDSDesk:abc12'),
  ('{B1}', '{F}', 'g2', '2026-04-03', 'RAKVIK', 'Rent | TDSDesk:x.y-z'),
  ('{B1}', '{F}', 'g3', '2026-04-03', 'Cash', 'plain'),
  ('{B2}', '{F}', 'g4', '2026-04-05', 'Sales', 'TDSDesk:.only-dots'),
  ('{B2}', '{F}', 'g5', '2026-04-06', 'Sales', 'TDSDesk: none');
insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values
  ('{B1}', '{F}', 'g1', '2026-04-02', 'MCS Project Pvt Ltd' || chr(13) || chr(10), -500), ('{B1}', '{F}', 'g1', '2026-04-02', 'Cash', 500),
  ('{B1}', '{F}', 'g2', '2026-04-03', 'RAKVIK', -50), ('{B1}', '{F}', 'g2', '2026-04-03', 'Cash', 50),
  ('{B1}', '{F}', 'g3', '2026-04-03', 'Cash', 0),
  ('{B2}', '{F}', 'g4', '2026-04-05', 'Sales', -10), ('{B2}', '{F}', 'g4', '2026-04-05', 'Cash', 10);
insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values
  ('{B1}', '{F}', 'MCS Project Pvt Ltd' || chr(13) || chr(10), '2026-04-02', -500, 500, 0, 1), ('{B1}', '{F}', 'Cash', '2026-04-02', 500, 0, 500, 1),
  ('{B1}', '{F}', 'RAKVIK', '2026-04-03', -50, 50, 0, 1), ('{B1}', '{F}', 'Cash', '2026-04-03', 50, 0, 50, 1),
  ('{B2}', '{F}', 'Sales', '2026-04-05', -10, 10, 0, 1), ('{B2}', '{F}', 'Cash', '2026-04-05', 10, 0, 10, 1);
"""
SEED_WINDOW = f"""
update tally_ledgers set chain = array['Sundry Debtors', 'Current Assets' || chr(10)], primary_group = 'Current Assets' || chr(10) where name = 'Cash';
insert into tally_ledgers (book_id, firm_id, name, parent, open, merged_into) values ('{B2}', '{F}', 'Old twin', 'Sales Accounts', 0, 'Sales' || chr(13));
insert into tally_groups (book_id, firm_id, name, parent) values ('{B1}', '{F}', 'Sundry Debtors', 'Current Assets' || chr(10)), ('{B1}', '{F}', 'Duties{R}', 'Current Liabilities'),
  ('{B1}', '{F}', 'Loans', 'Liabilities'), ('{B1}', '{F}', 'Twin', ''), ('{B1}', '{F}', 'Twin' || chr(10), 'X');
insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount) values ('{B1}', '{F}', 'g1', '2026-04-02', 'MCS Project Pvt Ltd' || chr(10), 'b1', 'New Ref', -500),
  ('{B1}', '{F}', 'g2', '2026-04-03', 'RAKVIK', 'b2', 'New Ref', -50);
"""
TABLES = ["tally_devices", "clients", "tally_ledgers", "tally_vouchers", "tally_lines", "tally_ledger_day", "tally_groups", "tally_bills"]
def exists(db, t): return db.one("select to_regclass('public.%s') is not null" % t) == "t"
def touched(db, stmt):
    """runs stmt in one transaction; returns {table: rows with that transaction's xmin} and {table: rows gone}"""
    before = {t: {r["c"] for r in db.rows("select ctid::text || xmin::text as c from public.%s" % t)} for t in TABLES if exists(db, t)}
    db.sql("begin;\n%s\ncreate table public._x as select txid_current()::text as x;\ncommit;" % stmt)
    x = int(db.one("select x from public._x")) % (2 ** 32)
    new = {t: int(db.one("select count(*) from public.%s where xmin::text = '%d'" % (t, x))) for t in before}
    gone = {t: len(before[t] - {r["c"] for r in db.rows("select ctid::text || xmin::text as c from public.%s" % t)}) for t in before}
    db.sql("drop table public._x")
    return new, gone
def run_dry(db, n):
    rows = db.rows("begin transaction read only;\n" + dry(n) + "\ncommit;")
    return {r["rows_changed"]: int(r["how_many"]) for r in rows}

M13 = os.path.join(TC, "migration-13-fast-sync.sql")
STMT = {
  "13": "\n".join(l for l in read(M13).splitlines() if l.startswith("alter table public.tally_devices add column if not exists wake_token") or l.startswith("update public.tally_devices set wake_token")),
  "23": (lambda p: cut(p, "create or replace function public.tally_nm(p text)", "$$;") + "\n" + cut(p, "with g as (", "select 'ledgers' as t,", incl_end=False))(os.path.join(TC, "migration-23-clean-names.sql")),
  "27": cut(os.path.join(TC, "migration-27-post-record.sql"), "update public.clients cl", "as post_to;"),
  "32": "\n".join(l for l in read(os.path.join(TC, "migration-32-sync-safety.sql")).splitlines() if l.startswith("alter table public.tally_vouchers add column if not exists origin") or l.startswith("update public.tally_vouchers set origin")),
  "37": "alter table public.tally_vouchers add column if not exists origin text not null default 'tally';\n" + "\n".join(
        l for l in read(os.path.join(TC, "migration-37-follow-ups.sql")).splitlines() if l.startswith("alter table public.tally_vouchers add column if not exists fincom_id")) + "\n" +
        cut(os.path.join(TC, "migration-37-follow-ups.sql"), "update public.tally_vouchers set fincom_id", ";"),
}
for k, v in STMT.items(): ok(len(v) > 40 and ("update" in v), "migration %s: its data statements found in the file" % k)

def chk(n):
    m = re.search(r"-- check %s\n(.*?)\n-- end" % n, DOC, re.S); assert m, "no check %s in GO-LIVE.md" % n; return m.group(1)
def run_chk(db, n): return db.rows("begin transaction read only;\n" + chk(n) + "\ncommit;")
CHK = {"13": "13", "23": "23", "27": "27", "32": "32 37", "37": "32 37"}
def check(label, db, n, expect):
    d = run_dry(db, n)
    m0, c0 = run_chk(db, "money"), run_chk(db, CHK[n])
    new, gone = touched(db, STMT[n])
    m1, c1 = run_chk(db, "money"), run_chk(db, CHK[n])
    ok(m0 == m1, "%s, %s: the money check is the same before and after (entries, lines, turnover, ledgers, openings, day totals)" % (label, n))
    I = lambda rows, k: sum(int(r[k]) for r in rows)
    if n == "13": ok(I(c1, "without_token") == 0 and I(c1, "different_tokens") == I(c1, "devices") == I(c0, "devices"), "%s, 13: after, every device has its own token %s" % (label, c1))
    if n == "23": ok(all(int(v) == 0 for v in c1[0].values()) and any(int(v) > 0 for v in c0[0].values()), "%s, 23: names not clean before %s, none after %s" % (label, c0, c1))
    if n == "27": ok(I(c1, "clients_with_post_to") - I(c0, "clients_with_post_to") == sum(d.values()), "%s, 27: clients with postTo grew by the dry run's number %s -> %s" % (label, c0, c1))
    if n in ("32", "37"):
        f0 = sum(int(r["entries"]) for r in c0 if r["origin"] == "fincom"); f1 = sum(int(r["entries"]) for r in c1 if r["origin"] == "fincom")
        ok(I(c0, "entries") == I(c1, "entries") and (f1 - f0 == sum(d.values()) if n == "32" else I(c1, "with_fincom_id") - I(c0, "with_fincom_id") == sum(d.values())),
           "%s, %s: entries the same; the marked ones grew by the dry run's number %s -> %s" % (label, n, c0, c1))
    for what, (kind, table) in expect.items():
        real = new.get(table, 0) if kind == "new" else gone.get(table, 0)
        ok(d.get(what) == real, "%s, %s: dry run says %s, the migration touched %s (%s)" % (label, n, d.get(what), real, what))
    return d

for phase in ("before go (Build 199's tables)", "in the window (6-22 already run)"):
    print("== " + phase)
    for n in ("13", "23", "27", "32", "37"):
        db = pg_stand.start(30493)
        try:
            db.sql(BUILD199); db.sql(SEED)
            if phase.startswith("in the window"):
                db.sql(forward()); db.sql(SEED_WINDOW)
                if n == "37": db.sql(STMT["32"])                 # 32 runs before 37
                d0 = None
            else:
                d0 = run_dry(db, n)                              # the numbers the owner sees before go
                db.sql(forward())                                # then 6-22 add their (empty) columns and tables
            exp = {"13": {"tally_devices: a new wake_token": ("new", "tally_devices")},
                   "23": {"tally_ledgers: rows rewritten": ("new", "tally_ledgers"), "tally_lines: ledger name cleaned": ("new", "tally_lines"),
                          "tally_vouchers: party name cleaned": ("new", "tally_vouchers"), "tally_ledger_day: rows deleted (their days are built again)": ("gone", "tally_ledger_day"),
                          "tally_groups: rows rewritten": ("new", "tally_groups"), "tally_bills: ledger name cleaned": ("new", "tally_bills")},
                   "27": {"clients: postTo set": ("new", "clients")},
                   "32": {"tally_vouchers: origin becomes fincom": ("new", "tally_vouchers")},
                   "37": {"tally_vouchers: fincom_id and origin filled": ("new", "tally_vouchers")}}[n]
            d = check(phase.split(" (")[0], db, n, exp)
            if d0 is not None: ok(d0 == d, "before go, %s: the same numbers on Build 199's tables as after 6-22 add theirs %s" % (n, d0))
            ok(any(v > 0 for v in d.values()), "%s, %s: the made-up rows include some it changes %s" % (phase.split(" (")[0], n, d))
        finally:
            db.stop()

print("\n%d check(s) failed" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
