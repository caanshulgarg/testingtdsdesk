"""The console's migrations 118 to 123 together, in their order, on one throwaway PostgreSQL (pg_stand; never a real
database): the stand-ins each migration's own test uses, joined (billing's staging tables and old functions from
run_migration119.py, the assistant's tables as run_migration121.py makes them, the support desk, tally tables, Vault and
pg_cron / pgmq stand-ins from console_ops_stand.py), then 118, 119, 120, 121, 122, 123 and 125 (124 is next-mobile's).
    db = console_chain_stand.start(port)          stand-ins only
    console_chain_stand.apply(db)                 the files, in order (returns [(number, error or None)])
Used by run_migration_order.py (the chain, twice) and run_console_contracts.py (the contracts between the modules)."""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
import console_ops_stand as OPS

ROOT = os.path.normpath(os.path.join(HERE, ".."))
CONSOLE = os.path.join(ROOT, "server", "console")
FILES = [(118, "migration-118-console-foundation.sql"), (119, "migration-119-console-billing.sql"), (120, "migration-120-coupons.sql"),
         (121, "migration-121-ai-control.sql"), (122, "migration-122-console-ops.sql"), (123, "migration-123-notices-flags.sql"),
         (125, "migration-125-console-guards.sql")]
PATHS = [(n, os.path.join(CONSOLE, f)) for n, f in FILES]

def _block(path, name):
    """a module-level r\"\"\"...\"\"\" string of another test (one source for the staging stand-ins)"""
    m = re.search(r"^%s = r\"\"\"(.*?)\"\"\"" % name, open(os.path.join(HERE, path)).read(), re.S | re.M)
    assert m, "%s: no %s" % (path, name)
    return m.group(1)

# billing's tables and the old billing functions as staging has them (run_migration119.py's AUTH)
BILLING = _block("run_migration119.py", "AUTH")
# the assistant's tables (migrations 77 and 96) as run_migration121.py makes them (the end of its STAND)
_st = _block("run_migration121.py", "STAND")
ASSISTANT = _st[_st.index("-- the assistant's tables"):]

# what migration 125 leans on, as on Supabase / staging: the records table (firm_id, kind, id, client_id, data), a firm's
# members writing clients and records under RLS (the worst case: firms writable too), storage.objects under RLS with the
# permissive policies Supabase has, and the Realtime publication
UPLOADS = r"""
create table if not exists public.records (firm_id uuid not null, kind text not null, id text not null, client_id text not null default '',
  data jsonb not null default '{}'::jsonb, deleted boolean not null default false, updated_at timestamptz default now(), primary key (firm_id, kind, id));
alter table public.records enable row level security;
drop policy if exists records_own on public.records;
create policy records_own on public.records for all to authenticated using (firm_id = public.my_firm()) with check (firm_id = public.my_firm());
alter table public.clients add column if not exists data jsonb;
alter table public.clients enable row level security;
drop policy if exists clients_own on public.clients;
create policy clients_own on public.clients for all to authenticated using (firm_id = public.my_firm()) with check (firm_id = public.my_firm());
alter table public.firms enable row level security;
drop policy if exists firms_own on public.firms;
create policy firms_own on public.firms for all to authenticated using (id = public.my_firm()) with check (id = public.my_firm());
grant select, insert, update on public.records, public.clients, public.firms to authenticated;
grant select, insert, update, delete on public.records to service_role;
alter table storage.objects add column if not exists owner uuid;
alter table storage.objects enable row level security;
drop policy if exists objects_any on storage.objects;
create policy objects_any on storage.objects for all to authenticated using (true) with check (true);
grant usage on schema storage to authenticated, service_role;
grant select, insert, update on storage.objects to authenticated, service_role;
do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;
"""

def start(port):
    db = pg_stand.start(port)
    db.sql(BILLING)
    db.sql(OPS.AUTH)
    db.sql(ASSISTANT)
    db.sql(open(OPS.SUPPORT_SQL).read())
    db.sql(OPS.CRON)
    db.sql(UPLOADS)
    return db

def apply(db, only=None):
    out = []
    for n, p in PATHS:
        if only and n not in only: continue
        try: db.sql(open(p).read()); out.append((n, None))
        except Exception as e: out.append((n, str(e)[:600]))
    return out
