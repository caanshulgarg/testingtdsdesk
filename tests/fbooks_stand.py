"""FinCom Books' test stand (tests/run_migration220.py, tests/run_fbooks_ui.py): the cloud copy's tables as on staging
(as much as migration 220 reads), the made-up firm and members, and the made-up books of tests/fbooks_fixture.mjs."""
import os, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "server", "fincom-books", "migration-220-fincom-books.sql")
# 218 (after 220): Set up only enrols; the 3-minute catch-up builds the book
MIG218 = os.path.join(HERE, "..", "server", "fincom-books", "migration-218-fbooks-setup-fast.sql")
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
OWN, STAFF, OTHER = "aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003"
TB1 = "bbbbbbbb-0000-0000-0000-000000000001"   # the copy's book (tally_books) of client c1
# the copy as on staging (migrations 1, 6, 7, 18, 32, 57, 75), as much as FinCom Books reads of it
COPY = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
grant usage on schema public to authenticated, anon, service_role;
create or replace function auth.role() returns text language sql stable as $f$ select coalesce(nullif(current_setting('fincom.role', true), ''), 'authenticated') $f$;
create or replace function my_firm() returns uuid language sql stable security definer set search_path = public as $f$ select firm_id from members where user_id = auth.uid() and active $f$;
create or replace function can_write() returns boolean language sql stable security definer set search_path = public as $f$ select exists (select 1 from members where user_id = auth.uid() and active and role in ('owner', 'staff')) $f$;
alter table tally_books add column if not exists source text not null default 'tally';
alter table tally_vouchers alter column cancelled set default false, alter column optional set default false, alter column alter_id set default 0;
alter table tally_vouchers add column if not exists deleted_at timestamptz, add column if not exists irn text not null default '', add column if not exists irn_ack_no text not null default '',
  add column if not exists irn_ack_date date, add column if not exists eway_no text not null default '', add column if not exists source text not null default 'tally';
alter table tally_ledgers alter column open set default 0;
alter table tally_ledgers add column if not exists deleted_at timestamptz, add column if not exists state text not null default '', add column if not exists gstin text not null default '',
  add column if not exists pan text not null default '', add column if not exists tds_deductee_type text not null default '';
create table if not exists tally_groups (book_id uuid not null, firm_id uuid not null, name text not null, parent text not null default '', primary key (book_id, name));
create table if not exists tally_bills (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, ledger text not null, name text not null default '',
  type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);
create table if not exists tally_cost_allocs (id bigserial primary key, book_id uuid not null, firm_id uuid not null, guid text not null, alter_id bigint not null default 0, day date not null,
  line_no integer not null, ledger text not null default '', category text not null default '', centre text not null default '', amount numeric not null default 0,
  at timestamptz not null default now(), gone_at timestamptz);
-- as Supabase did before 30-Oct-2026 (the stricter case for revokes): anon and authenticated get every right on what is made
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
"""

def load_sql(book, firm, d, only=None):
    """the made-up books into the copy (as the bridge's ingest leaves them)"""
    j = json.dumps(d).replace("$j$", "")
    return """
with d as (select $j$%s$j$::jsonb as j)
insert into tally_groups (book_id, firm_id, name, parent) select '%s', '%s', g->>'name', g->>'parent' from d, jsonb_array_elements(j->'groups') g on conflict do nothing;
with d as (select $j$%s$j$::jsonb as j)
insert into tally_ledgers (book_id, firm_id, name, parent, open, gstin, pan, state) select '%s', '%s', l->>'name', l->>'parent', (l->>'open')::numeric, coalesce(l->>'gstin', ''), coalesce(l->>'pan', ''), coalesce(l->>'state', '')
  from d, jsonb_array_elements(j->'ledgers') l on conflict do nothing;
with d as (select $j$%s$j$::jsonb as j)
insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos)
select '%s', '%s', v->>'guid', (v->>'day')::date, (v->>'alter_id')::bigint, v->>'vtype', v->>'vno', v->>'party', v->>'narration', (v->>'cancelled')::boolean, (v->>'optional')::boolean, v->>'gstin', v->>'pos'
  from d, jsonb_array_elements(j->'vouchers') v;
with d as (select $j$%s$j$::jsonb as j)
insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) select '%s', '%s', v->>'guid', (v->>'day')::date, l->>'ledger', (l->>'amount')::numeric
  from d, jsonb_array_elements(j->'vouchers') v, jsonb_array_elements(v->'lines') l;
with d as (select $j$%s$j$::jsonb as j)
insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
select '%s', '%s', v->>'guid', (v->>'day')::date, b->>'ledger', b->>'name', b->>'type', (b->>'amount')::numeric, (b->>'bill_date')::date, (b->>'credit_days')::int, (b->>'due')::date
  from d, jsonb_array_elements(j->'vouchers') v, jsonb_array_elements(v->'bills') b;
with d as (select $j$%s$j$::jsonb as j)
insert into tally_cost_allocs (book_id, firm_id, guid, day, line_no, ledger, category, centre, amount)
select '%s', '%s', v->>'guid', (v->>'day')::date, (c->>'line_no')::int, c->>'ledger', c->>'category', c->>'centre', (c->>'amount')::numeric
  from d, jsonb_array_elements(j->'vouchers') v, jsonb_array_elements(v->'cc') c;
""" % ((j, book, firm) * 6)

def books(n, seed):
    return json.loads(subprocess.run(["node", os.path.join(HERE, "fbooks_fixture.mjs"), str(n), str(seed)], capture_output=True, text=True, check=True).stdout)

