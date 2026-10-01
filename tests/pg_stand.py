"""A stand-in for the Supabase database in tests: a throwaway PostgreSQL 16 started here (the postgres user, a port of
its own, trust on localhost only), with the few Supabase pieces FinCom's SQL leans on made plain: auth.uid() from a
setting, the firm and member tables, my_firm(), is_superadmin(), can_write(). The cloud copy's tables are made as on
staging. Used by run_server_reports.py; nothing of a real database is touched.
    db = pg_stand.start(55432); db.sql("select 1"); db.rows("select ...") -> [dict]; db.stop()"""
import os, subprocess, shutil, time, json, csv, io
BIN = "/usr/lib/postgresql/16/bin"
HERE = os.path.dirname(os.path.abspath(__file__))
STUB = r"""
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('fincom.uid', true), '')::uuid $$;
create table if not exists firms (id uuid primary key, name text);
create table if not exists members (user_id uuid, firm_id uuid, name text, role text, active boolean default true);
create or replace function my_firm() returns uuid language sql stable as $$ select firm_id from members where user_id = auth.uid() and active $$;
create or replace function is_superadmin() returns boolean language sql stable as $$ select false $$;
create or replace function can_write() returns boolean language sql stable as $$ select exists (select 1 from members where user_id = auth.uid() and active and role in ('owner', 'staff')) $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
create table if not exists tally_books (book_id uuid primary key, firm_id uuid, client_id text, company text, from_date date, open_as_on date, ledgers_at timestamptz, days_at timestamptz, state jsonb, state_at timestamptz);
create table if not exists tally_ledgers (book_id uuid, firm_id uuid, name text, parent text, open numeric, chain text[], primary_group text, open_sent numeric, merged_into text, primary key (book_id, name));
create table if not exists tally_ledger_day (book_id uuid, firm_id uuid, ledger text, day date, amount numeric, dr numeric, cr numeric, n integer, primary key (book_id, ledger, day));
create index if not exists tally_ledger_day_day on tally_ledger_day (book_id, day);
create table if not exists tally_lines (book_id uuid, firm_id uuid, guid text, day date, ledger text, amount numeric, hsn text, rate numeric);
create index if not exists tally_lines_guid on tally_lines (book_id, guid);
create index if not exists tally_lines_ledger on tally_lines (book_id, ledger, day);
create table if not exists tally_vouchers (book_id uuid, firm_id uuid, guid text, day date, alter_id bigint, vtype text, vno text, party text, narration text, cancelled boolean, optional boolean,
  gstin text default '', pos text default '', ref text default '', ref_date date, cmp_gstin text default '', primary key (book_id, guid));
create table if not exists client_book_items (firm_id uuid, client_id text, key text, item text default '', ord integer, data jsonb, deleted boolean not null default false, seq bigint default 0,
  updated_at timestamptz default now(), updated_by uuid, primary key (firm_id, client_id, key, item));
-- as on staging (migration-3)
create or replace function tally_pick(p_client text, p_on date) returns uuid language sql stable security definer set search_path to 'public' as $function$
  select b.book_id from tally_books b
   where b.client_id = p_client and b.firm_id = my_firm() and b.from_date is not null
     and (p_on is null or b.open_as_on <= p_on)
   order by (b.from_date <= coalesce(p_on, b.from_date)) desc, b.from_date desc limit 1
$function$;
"""
class DB:
    def __init__(self, port, data):
        self.port, self.data = port, data
    def _psql(self, args, inp=None):
        r = subprocess.run(["runuser", "-u", "postgres", "--", BIN + "/psql", "-h", "127.0.0.1", "-p", str(self.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"] + args,
                           input=inp, capture_output=True, text=True)
        if r.returncode: raise RuntimeError((r.stderr or r.stdout)[-2000:])
        return r.stdout
    def sql(self, text, uid=None):
        pre = "set fincom.uid = '%s';\n" % uid if uid else ""
        return self._psql([], pre + text)
    def rows(self, query, uid=None):
        pre = "set fincom.uid = '%s';\n" % uid if uid else ""
        out = self._psql(["--csv", "-P", "footer=off"], pre + query)
        return list(csv.DictReader(io.StringIO(out)))
    def one(self, query, uid=None):
        r = self.rows(query, uid); return list(r[0].values())[0] if r else None
    def stop(self):
        subprocess.run(["runuser", "-u", "postgres", "--", BIN + "/pg_ctl", "-D", self.data, "-m", "immediate", "stop"], capture_output=True)
def start(port=55432):
    data = os.path.join(os.environ.get("TMPDIR", "/tmp"), "fincom-pg-%d" % port)    # the postgres user must reach it
    subprocess.run(["runuser", "-u", "postgres", "--", BIN + "/pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True)
    shutil.rmtree(data, ignore_errors=True); os.makedirs(os.path.dirname(data), exist_ok=True)
    os.makedirs(data); shutil.chown(data, "postgres", "postgres")
    subprocess.run(["runuser", "-u", "postgres", "--", BIN + "/initdb", "-D", data, "-A", "trust", "-U", "postgres", "--no-sync"], check=True, capture_output=True)
    subprocess.run(["runuser", "-u", "postgres", "--", BIN + "/pg_ctl", "-D", data, "-o", "-p %d -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off" % port, "-w", "-l", data + "/log", "start"], check=True, capture_output=True)
    db = DB(port, data); db.sql(STUB)
    return db
def migration_body(path):
    s = open(path).read()
    return s[s.index("\nbegin;") + 7:s.rindex("commit;")]
