"""FinCom Assistant's stand-in database: a throwaway PostgreSQL (pg_stand.py) with the cloud copy's tables as on staging
(the columns the assistant reads; RLS on, the members' read policies, firm_id = my_firm()), the report functions the
book tools reuse taken from the repository's migrations (tally_nm, tally_pick, tally_mis_head, tally_mis, tally_led_kinds,
tally_tds_summary, tally_gst_summary: the latest text of each, as run on staging), and the made-up books of
tests/fixtures/books (assistant_books.js) loaded as the bridge and the app keep them. Queries can run as a signed-in member
(role authenticated, auth.uid() set), so row-level security applies as on staging.
    import assistant_stand as A
    db = A.start(55476); A.migrate(db); A.load_fixture(db)      # firm A.FIRM, client A.CLIENT
    A.ask(db, "select asst_tds_missed('larkspur', null, null, null)")     # as A.ME
"""
import os, re, json, uuid, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
import pg_stand
ROOT = os.path.join(HERE, "..")
SQL = os.path.join(ROOT, "server", "tally-cloud")
MIG77 = os.path.join(ROOT, "server", "assistant", "migration-77-assistant.sql")
# run after 77 as on staging: asst_span without tally_pick (Sentry FINCOM-CLOUD-STAGING-1)
MIG85 = os.path.join(ROOT, "server", "assistant", "migration-85-asst-span.sql")
FIRM, OTHER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
ME, STAFF, VIEWER, STRANGER = ("aaaaaaaa-0000-4000-8000-00000000000%d" % i for i in (1, 2, 3, 4))
CLIENT, OTHER_CLIENT = "larkspur", "zz-other-client"
BOOK, OTHER_BOOK = "00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b2"
q = lambda s: "'" + str(s).replace("'", "''") + "'"

SCHEMA = r"""
-- pg_stand's own short tables are made again with staging's columns
drop table if exists tally_books, tally_ledgers, tally_ledger_day, tally_lines, tally_vouchers, client_book_items, members, firms cascade;
create extension if not exists pgcrypto;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('fincom.uid', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table if not exists firms (id uuid primary key, name text);
create table if not exists members (user_id uuid, firm_id uuid, name text, email text, role text, active boolean default true);
create or replace function my_firm() returns uuid language sql stable security definer set search_path = public as $$ select firm_id from members where user_id = auth.uid() and active $$;
create or replace function is_superadmin() returns boolean language sql stable as $$ select false $$;
create or replace function can_write() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from members where user_id = auth.uid() and active and role in ('owner', 'staff')) $$;
create table if not exists clients (id text primary key, firm_id uuid, name text, gstin text, pan text, deleted boolean default false);
create table if not exists tally_books (book_id uuid primary key, firm_id uuid, client_id text, company text, from_date date, open_as_on date, ledgers_at timestamptz, days_at timestamptz, state jsonb default '{}', state_at timestamptz);
create table if not exists tally_ledgers (book_id uuid, firm_id uuid, name text, parent text default '', open numeric(18,2) default 0, chain text[], primary_group text, open_sent numeric, merged_into text,
  gstin text, pan text, deleted_at timestamptz, primary key (book_id, name));
create table if not exists tally_vouchers (book_id uuid, firm_id uuid, guid text, day date, alter_id bigint default 0, vtype text default '', vno text default '', party text default '', narration text default '',
  cancelled boolean default false, optional boolean default false, gstin text default '', pos text default '', ref text default '', ref_date date, cmp_gstin text default '', deleted_at timestamptz,
  gst_rcm boolean, primary key (book_id, guid));
create table if not exists tally_lines (book_id uuid, firm_id uuid, guid text, day date, ledger text, amount numeric(18,2), hsn text, rate numeric);
create index if not exists tally_lines_guid on tally_lines (book_id, guid);
create index if not exists tally_lines_ledger on tally_lines (book_id, ledger, day);
create table if not exists tally_ledger_day (book_id uuid, firm_id uuid, ledger text, day date, amount numeric(18,2) default 0, dr numeric(18,2) default 0, cr numeric(18,2) default 0, n integer default 0, merged_into text, primary key (book_id, ledger, day));
create table if not exists tally_salary_pays (id bigserial primary key, book_id uuid, firm_id uuid, guid text, alter_id bigint, day date, line_no integer, ledger text, employee text, amount numeric, paid_on date, gone_at timestamptz);
create table if not exists tally_month_locks (id bigserial primary key, firm_id uuid, client_id text, book_id uuid, month date, locked_at timestamptz, locked_by uuid, note text, unlocked_at timestamptz, unlocked_by uuid);
create table if not exists tally_voucher_versions (book_id uuid, firm_id uuid, tally_guid text, alter_id bigint, payload jsonb, seen_at timestamptz, lines jsonb);
create table if not exists client_book_items (firm_id uuid, client_id text, key text, item text default '', ord integer, data jsonb, deleted boolean not null default false, seq bigint default 0,
  updated_at timestamptz default now(), updated_by uuid, primary key (firm_id, client_id, key, item));
create table if not exists gst_returns (firm_id uuid, gstin text, form text, period text, status text default 'ok', data jsonb, error text, parts int, fetched_at timestamptz default now(), fetched_by uuid, primary key (firm_id, gstin, form, period));
do $$ declare t text; begin
  foreach t in array array['tally_books','tally_ledgers','tally_vouchers','tally_lines','tally_ledger_day','tally_salary_pays','tally_month_locks','tally_voucher_versions','client_book_items','gst_returns','clients'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (firm_id = my_firm())', t || '_read', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;
grant select on members, firms to authenticated;
grant usage on schema public to authenticated, anon, service_role;
-- the service role as on Supabase: past row-level security, every table (the migration's revokes then apply)
alter role service_role bypassrls;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated;
grant usage on schema auth to authenticated, anon, service_role;
-- Storage, as far as the migration's policies need it
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
"""

def function_text(path, name):
    """the LAST definition of public.<name> in a migration file, from 'create or replace function' to its closing dollar quote"""
    s = open(path).read()
    starts = [m.start() for m in re.finditer(r"create or replace function public\." + re.escape(name) + r"\(", s)]
    if not starts: return None
    i = starts[-1]
    m = re.compile(r"\bas\s+(\$[A-Za-z_]*\$)", re.I).search(s, i)
    tag = m.group(1)
    j = s.index(tag, m.end()) + len(tag)
    k = s.index(";", j)
    return s[i:k + 1]

# where each reused function is defined last, in staging's order (docs/MIGRATION-ORDER.md)
REUSED = [("tally_nm", "migration-23-clean-names.sql"), ("tally_pick", "migration.sql"), ("tally_mis_head", "migration-14-reports.sql"),
          ("tally_led_kinds", "migration-23-clean-names.sql"), ("tally_tds_summary", "migration-14-reports.sql"),
          ("tally_gst_summary", "migration-37-follow-ups.sql"), ("tally_mis", "migration-37-follow-ups.sql")]

# who may run the reused functions, as on staging (checked there on 14-Oct-2026): tally_pick is revoked from public and anon
# (server/tally-cloud/migration.sql) and from signed-in users (server/security/migration-3-phase2.sql); only SECURITY
# DEFINER functions and the service role call it. Sentry FINCOM-CLOUD-STAGING-1: the stand had left it callable by all, so
# the book tools passed here and failed on staging ("permission denied for function tally_pick").
PRIVILEGES = r"""
revoke all on function tally_pick(text, date) from public, anon, authenticated;
grant execute on function tally_pick(text, date) to service_role;
"""

def start(port):
    db = pg_stand.start(port)
    db.sql(SCHEMA)
    for name, f in REUSED:
        t = function_text(os.path.join(SQL, f), name)
        if t is None: raise SystemExit("not found: " + name + " in " + f)
        db.sql(t)
    db.sql(PRIVILEGES)
    return db

def migrate(db, path=MIG77):
    out = db.sql(open(path).read())
    if path == MIG77: out += db.sql(open(MIG85).read())
    return out

def ask(db, query, uid=ME):
    """a query as a signed-in member: role authenticated, auth.uid() = uid (row-level security applies)"""
    out = db._psql(["-t", "-A"], "set fincom.uid = '%s';\nset role authenticated;\n%s" % (uid, query))
    return out.strip()

def askj(db, query, uid=ME):
    t = ask(db, query, uid)
    return json.loads(t) if t else None

# the ledger list as the CA confirms it (Tally ledgers page): what FinCom guessed, with the reverse-charge payables, the
# month-end TDS account and the interest income set right
CONFIRM = {
    "07 RCM CGST PAYABLE": {"kind": "gst", "side": "output", "tax": "CGST", "reg": "07", "rcm": True, "what": "gst_rcm"},
    "07 RCM SGST PAYABLE": {"kind": "gst", "side": "output", "tax": "SGST", "reg": "07", "rcm": True, "what": "gst_rcm"},
    "07 RCM IGST PAYABLE": {"kind": "gst", "side": "output", "tax": "IGST", "reg": "07", "rcm": True, "what": "gst_rcm"},
    "TDS Payable - Month End": {"kind": "tds_clearing", "what": "tds_clearing"},
    "Interest on Bank Deposit": {"kind": "", "what": "none"},
    "Cash": {"kind": "bank", "what": "bank"},
}

def books_json(out=None):
    out = out or os.path.join(HERE, "out", "assistant-books.json")
    r = subprocess.run(["node", os.path.join(HERE, "assistant_books.js"), out], capture_output=True, text=True, cwd=HERE)
    if r.returncode: raise SystemExit(r.stdout + r.stderr)
    return json.load(open(out))

def load_books(db, b, firm=FIRM, client=CLIENT, book=BOOK, company="Larkspur Fixture Events Private Limited", gstin="07AAGCL4827M1Z3", confirm=True, extra_vouchers=()):
    sql = ["insert into clients (id, firm_id, name, gstin) values (%s, %s, %s, %s) on conflict do nothing;" % (q(client), q(firm), q(company), q(gstin)),
           "insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on, days_at) values (%s, %s, %s, %s, '2025-04-01', '2025-03-31', '2026-10-13 09:00+05:30');" % (q(book), q(firm), q(client), q(company))]
    rows = ["(%s, %s, %s, %s, %s, %s, %s, %s)" % (q(book), q(firm), q(l["name"]), q(l["parent"]), l["open"], "array[%s]::text[]" % ",".join(q(g) for g in l["chain"]) if l["chain"] else "'{}'::text[]", q(l["pan"]), q(l["gstin"])) for l in b["ledgers"]]
    sql.append("insert into tally_ledgers (book_id, firm_id, name, parent, open, chain, pan, gstin) values " + ",".join(rows) + ";")
    vs, ls, day = [], [], {}
    for v in list(b["vouchers"]) + list(extra_vouchers):
        vs.append("(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)" % (q(book), q(firm), q(v["guid"]), q(v["day"]), v.get("alter", 0), q(v["vtype"]), q(v["vno"]), q(v["party"]), q(v["narration"]),
            "true" if v["cancelled"] else "false", "true" if v.get("optional") else "false", q(v.get("gstin", "")), q(v.get("ref", "")), q(v.get("cmp", ""))))
        for l, a in v["lines"]:
            ls.append("(%s, %s, %s, %s, %s, %s)" % (q(book), q(firm), q(v["guid"]), q(v["day"]), q(l), a))
            if not v["cancelled"] and not v.get("optional"):
                x = day.setdefault((l, v["day"]), [0.0, 0.0, 0.0, 0]); x[0] += a; x[1] += -a if a < 0 else 0; x[2] += a if a > 0 else 0; x[3] += 1
    sql.append("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, ref, cmp_gstin) values " + ",".join(vs) + ";")
    if ls: sql.append("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values " + ",".join(ls) + ";")
    sql.append("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values " + ",".join("(%s, %s, %s, %s, %.2f, %.2f, %.2f, %d)" % (q(book), q(firm), q(l), q(d), a, dr, cr, n) for (l, d), (a, dr, cr, n) in day.items()) + ";")
    m = dict(b["map"])
    if confirm:
        for n, d in CONFIRM.items(): m[n] = dict(m.get(n, {}), **d)
    items = [("map", "." + n, d) for n, d in m.items()] + [("ledInfo", "." + n, d) for n, d in b["ledInfo"].items()] + [("groupInfo", "." + n, d) for n, d in b["groupInfo"].items()] + [("twoBs", t["item"], t["data"]) for t in b["twoBs"]]
    sql.append("insert into client_book_items (firm_id, client_id, key, item, data) values " + ",".join("(%s, %s, %s, %s, %s::jsonb)" % (q(firm), q(client), q(k), q(i), q(json.dumps(d))) for k, i, d in items) + ";")
    db.sql("\n".join(sql))

def load_fixture(db, extra_vouchers=()):
    b = books_json()
    db.sql("insert into firms values (%s, 'Garg Test Firm'), (%s, 'Another Firm');" % (q(FIRM), q(OTHER)) +
           "insert into members (user_id, firm_id, name, role) values (%s, %s, 'Owner', 'owner'), (%s, %s, 'Staff', 'staff'), (%s, %s, 'Viewer', 'viewer'), (%s, %s, 'Stranger', 'owner');" % (q(ME), q(FIRM), q(STAFF), q(FIRM), q(VIEWER), q(FIRM), q(STRANGER), q(OTHER)))
    load_books(db, b, extra_vouchers=extra_vouchers)
    # another firm's client with the same books: a member of FIRM must never see it
    load_books(db, b, firm=OTHER, client=OTHER_CLIENT, book=OTHER_BOOK, company="Another Firm's Client")
    db.sql("analyze;")
    return b

# for the notice tests (made-up): the client's own TDS credit - a TDS receivable ledger with three credits by customers in
# 2025-26 (Quillfeather 8,000 on 25-May and 5,000 on 20-Aug; Vellichor 2,000 on 10-Nov: 15,000 in the books), the client's
# Form 26AS for 2025-26 as the TDS page keeps it (Quillfeather's TAN, 8,000 + 5,000 = 13,000: Vellichor's 2,000 is not in
# it), and GSTR-3B for February 2026 as fetched from the portal (ITC 4(A)(5) 5,400 and 4(A)(3) reverse charge 5,600)
TDS_REC = "TDS Receivable FY 2025-26"
def add_notice_data(db, firm=FIRM, client=CLIENT, book=BOOK):
    sql = ["insert into tally_ledgers (book_id, firm_id, name, parent, open, chain) values (%s, %s, %s, 'Loans & Advances (Asset)', 0, array['Loans & Advances (Asset)', 'Current Assets']);" % (q(book), q(firm), q(TDS_REC)),
           "insert into client_book_items (firm_id, client_id, key, item, data) values (%s, %s, 'map', %s, '{\"kind\": \"tds_receivable\", \"what\": \"tds_receivable\"}');" % (q(firm), q(client), q("." + TDS_REC))]
    for i, (day, party, amt) in enumerate([("2025-05-25", "Quillfeather Weddings LLP", 8000), ("2025-08-20", "Quillfeather Weddings LLP", 5000), ("2025-11-10", "Vellichor Learning Foundation", 2000)]):
        g = "tds-credit-%d" % (i + 1)
        sql.append("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration) values (%s, %s, %s, %s, %d, 'Journal', %s, %s, 'TDS deducted by the customer u/s 194C');" % (q(book), q(firm), q(g), q(day), 900 + i, q("TJ%d" % (i + 1)), q(party)))
        sql.append("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%s, %s, %s, %s, %s, %d), (%s, %s, %s, %s, %s, %d);" % (q(book), q(firm), q(g), q(day), q(TDS_REC), -amt, q(book), q(firm), q(g), q(day), q(party), amt))
        for l, a in ((TDS_REC, -amt), (party, amt)):
            sql.append("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values (%s, %s, %s, %s, %d, %d, %d, 1) on conflict (book_id, ledger, day) do update set amount = tally_ledger_day.amount + excluded.amount, dr = tally_ledger_day.dr + excluded.dr, cr = tally_ledger_day.cr + excluded.cr, n = tally_ledger_day.n + 1;" % (q(book), q(firm), q(l), q(day), a, -a if a < 0 else 0, a if a > 0 else 0))
    as26 = {"id": "as1", "kind": "26AS", "pan": "AAGCL4827M", "fy": "2025-26", "file": "AAGCL4827M-2026.txt", "rows": [
        {"part": "TDS", "tan": "DELQ12345A", "name": "QUILLFEATHER WEDDINGS LLP", "section": "194C", "date": "20250525", "status": "F", "amount": 400000, "tax": 8000, "deposited": 8000, "q": "Q1", "fy": "2025-26"},
        {"part": "TDS", "tan": "DELQ12345A", "name": "QUILLFEATHER WEDDINGS LLP", "section": "194C", "date": "20250820", "status": "F", "amount": 250000, "tax": 5000, "deposited": 5000, "q": "Q2", "fy": "2025-26"}]}
    sql.append("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, %s, 'tds26as', '', '{\"$t\": \"arr\"}'), (%s, %s, 'tds26as', '#as1', %s::jsonb);" % (q(firm), q(client), q(firm), q(client), q(json.dumps(as26))))
    b3 = {"ret_period": "022026", "itc_elg": {"itc_avl": [{"ty": "IMPG", "iamt": 0, "camt": 0, "samt": 0, "csamt": 0}, {"ty": "IMPS", "iamt": 0, "camt": 0, "samt": 0, "csamt": 0},
          {"ty": "ISRC", "iamt": 0, "camt": 2800, "samt": 2800, "csamt": 0}, {"ty": "ISD", "iamt": 0, "camt": 0, "samt": 0, "csamt": 0}, {"ty": "OTH", "iamt": 0, "camt": 2700, "samt": 2700, "csamt": 0}]},
          "sup_details": {"osup_det": {"txval": 0, "iamt": 0, "camt": 0, "samt": 0, "csamt": 0}}}
    sql.append("insert into gst_returns (firm_id, gstin, form, period, status, data) values (%s, '07AAGCL4827M1Z3', '3B', '022026', 'ok', %s::jsonb);" % (q(firm), q(json.dumps(b3))))
    db.sql("\n".join(sql))
