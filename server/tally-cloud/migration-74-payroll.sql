-- Migration 74 (12-Oct-2026, FinCom Bridge 2.4.4, branch next-payroll; the owner's decisions of 12-Oct-2026: payroll and
-- salary TDS from Tally). Kept in the cloud copy:
--   - the payroll's employees (tally_employees), per book by their Tally GUID, as bridge 2.4.4's FinComEmployees reads them:
--     name, employee group (parent), cost category, whether it is an employee group, PAN, date of joining, date of leaving,
--     designation; nothing else (no date of birth, Aadhaar, bank or other personal field: the bridge never reads them). A
--     complete list marks the employees it no longer names gone (gone_at), never removed;
--   - on each ledger (tally_ledgers): a pay head's PAYTYPE, PAYSTATTYPE, ITCOMPONENT and FORPAYROLL (the ledger list's 15th to
--     18th columns);
--   - the salary paid to each employee (tally_salary_pays), from a salary payment's bank allocations as parse.js reads them
--     into each voucher's "salpay" (the employee and the amount; never the account, IFSC or the name in favour), for the
--     version of the entry just stored; the rows of an earlier version marked gone, never removed.
-- Each employee's amount per pay head is kept already (tally_cost_allocs, migration 57; parse.js 2.4.4 now writes them from
-- the Day Book path too).
-- Runs AFTER 73 (73's tally_ingest_details is in force on staging). ADD-ONLY: no table, column, row or function removed; no
-- statement in this file removes rows; safe to run twice; one transaction (lock_timeout 10 s). Four columns added to
-- tally_ledgers (null on every row there is: not read yet); two tables added (read by a member of the firm, written by the
-- functions below only); two functions added, tally_ingest_salpay(book, vouchers) (security definer, search_path = public,
-- pg_temp, granted to nobody: called by tally_ingest_details) and tally_ingest_employees(book, rows, complete) (the same,
-- executed by service_role alone: tally-ingest's "employees"); one function replaced: tally_ingest_details (73's text, same
-- arguments, security definer, granted to nobody), with ONE line added, marked "74", calling tally_ingest_salpay. Nothing else
-- is touched; no row is changed by running it. Tested on pg_stand only: tests/run_migration74.py. Deploy order: run this file
-- BEFORE deploying the tally-ingest of 2.4.4 (without it the "salpay" key, the four ledger columns and the employees are sent
-- and left: nothing breaks, nothing is stored).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- the pay-head fields on a ledger master (null: not read yet: a bridge before 2.4.4)
alter table public.tally_ledgers add column if not exists pay_type text;           -- PAYTYPE: Earnings for Employees, Employees' Statutory Deductions, Employer's Statutory Contributions, ...
alter table public.tally_ledgers add column if not exists pay_stat_type text;      -- PAYSTATTYPE: PF Account (A/c No. 1), Employee State Insurance, Professional Tax, Income Tax ('' : not applicable)
alter table public.tally_ledgers add column if not exists it_component text;       -- ITCOMPONENT: Basic Salary, House Rent Allowance, ... ('' : none)
alter table public.tally_ledgers add column if not exists for_payroll boolean;     -- FORPAYROLL: the ledger is a pay head

-- the payroll's employees (and employee groups), by their Tally GUID
create table if not exists public.tally_employees (
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,
  name text not null,
  parent text not null default '',          -- the employee group
  category text not null default '',        -- the cost category
  is_group boolean not null default false,  -- an employee group (ISEMPLOYEEGROUP)
  pan text not null default '',
  joined date,                              -- DATEOFJOIN
  left_on date,                             -- DEACTIVATIONDATE (the date of leaving)
  designation text not null default '',
  master_id bigint,
  alter_id bigint,
  seen_at timestamptz not null default now(),
  gone_at timestamptz,                      -- a complete list no longer named it (kept, never removed)
  primary key (book_id, guid)
);
create index if not exists tally_employees_book_name on public.tally_employees (book_id, name);
alter table public.tally_employees enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_employees' and policyname = 'tally_employees_read') then
    create policy tally_employees_read on public.tally_employees for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_employees from public, anon, authenticated;
grant select on public.tally_employees to authenticated;
grant all on public.tally_employees to service_role;

-- the salary paid to each employee: one row a bank allocation that names an employee, per version of the entry
create table if not exists public.tally_salary_pays (
  id bigint generated always as identity primary key,
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,                       -- the entry's Tally GUID
  alter_id bigint not null default 0,       -- the version it was read from
  day date,                                 -- the entry's date
  line_no integer not null default 0,       -- the ledger line (the bank's) in the entry
  ledger text not null default '',          -- the bank ledger
  employee text not null,
  amount numeric(18, 2) not null default 0,
  paid_on date,                             -- the bank allocation's date
  gone_at timestamptz                       -- a later version of the entry replaced it (kept, never removed)
);
create index if not exists tally_salary_pays_book_guid on public.tally_salary_pays (book_id, guid) where gone_at is null;
create index if not exists tally_salary_pays_book_emp on public.tally_salary_pays (book_id, employee) where gone_at is null;
alter table public.tally_salary_pays enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_salary_pays' and policyname = 'tally_salary_pays_read') then
    create policy tally_salary_pays_read on public.tally_salary_pays for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_salary_pays from public, anon, authenticated;
grant select on public.tally_salary_pays to authenticated;
grant all on public.tally_salary_pays to service_role;

-- ---------------------------------------------------------------- the salary paid, from the entries just stored
-- p_vouchers as the entry path got them (each with its guid and alter); only a voucher carrying a "salpay" array is written,
-- and only onto the entry stored at exactly that AlterID (the version just stored): its earlier rows marked gone, then its
-- rows (at most 5,000 an entry) added. A voucher without "salpay" (no bank details, or a bridge before 2.4.4) leaves its rows
create or replace function public.tally_ingest_salpay(p_book uuid, p_vouchers jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid;
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return; end if;
  -- the entries of this call that carry "salpay", each once (the highest AlterID), stored at exactly that AlterID
  update tally_salary_pays t set gone_at = now()
    from (select d.guid, d.alter_id, v.day, d.x
              from (select distinct on (y->>'guid') y->>'guid' as guid, coalesce(nullif(y->>'alter', '')::bigint, 0) as alter_id, y->'salpay' as x
                      from jsonb_array_elements(p_vouchers) y
                     where jsonb_typeof(y) = 'object' and coalesce(y->>'guid', '') <> '' and jsonb_typeof(y->'salpay') = 'array'
                       and coalesce(y->>'alter', '0') ~ '^[0-9]{1,18}$' and jsonb_array_length(y->'salpay') <= 5000
                     order by y->>'guid', coalesce(nullif(y->>'alter', '')::bigint, 0) desc) d
              join tally_vouchers v on v.book_id = p_book and v.guid = d.guid and coalesce(v.alter_id, 0) = d.alter_id) d
   where t.book_id = p_book and t.guid = d.guid and t.gone_at is null;
  insert into tally_salary_pays (book_id, firm_id, guid, alter_id, day, line_no, ledger, employee, amount, paid_on)
  select p_book, f, d.guid, d.alter_id, d.day, coalesce(case when coalesce(r->>'n', '') ~ '^[0-9]{1,6}$' then (r->>'n')::integer end, 0),
         left(tally_nm(coalesce(r->>'ledger', '')), 300), left(tally_nm(coalesce(r->>'employee', '')), 200),
         coalesce(case when coalesce(r->>'amt', '') ~ '^-?[0-9]{1,15}(\.[0-9]{1,4})?$' then round((r->>'amt')::numeric, 2) end, 0), tally_d8(r->>'date')
    from (select d.guid, d.alter_id, v.day, d.x
              from (select distinct on (y->>'guid') y->>'guid' as guid, coalesce(nullif(y->>'alter', '')::bigint, 0) as alter_id, y->'salpay' as x
                      from jsonb_array_elements(p_vouchers) y
                     where jsonb_typeof(y) = 'object' and coalesce(y->>'guid', '') <> '' and jsonb_typeof(y->'salpay') = 'array'
                       and coalesce(y->>'alter', '0') ~ '^[0-9]{1,18}$' and jsonb_array_length(y->'salpay') <= 5000
                     order by y->>'guid', coalesce(nullif(y->>'alter', '')::bigint, 0) desc) d
              join tally_vouchers v on v.book_id = p_book and v.guid = d.guid and coalesce(v.alter_id, 0) = d.alter_id) d, jsonb_array_elements(d.x) r
   where jsonb_typeof(r) = 'object' and btrim(coalesce(r->>'employee', '')) <> '';
end $function$;
revoke all on function public.tally_ingest_salpay(uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the payroll's employees the bridge read
-- p_rows: [[guid, MasterID, AlterID, name, group, category, employee group 1/0, PAN, joined yyyymmdd, left yyyymmdd,
-- designation]] (at most 50,000); one row per GUID added or brought up to date (and named again: gone_at cleared); with
-- p_complete (the whole payroll list read), the book's employees it does not name are marked gone, never removed. The
-- number of rows written
create or replace function public.tally_ingest_employees(p_book uuid, p_rows jsonb, p_complete boolean)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; n integer := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return 0; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return 0; end if;
  insert into tally_employees as t (book_id, firm_id, guid, name, parent, category, is_group, pan, joined, left_on, designation, master_id, alter_id, seen_at, gone_at)
  select p_book, f, q.guid, left(tally_nm(coalesce(q.x->>3, '')), 200), left(tally_nm(coalesce(q.x->>4, '')), 200), left(btrim(coalesce(q.x->>5, '')), 200),
         coalesce(q.x->>6, '') in ('1', 'true'),
         case when upper(btrim(coalesce(q.x->>7, ''))) ~ '^[A-Z0-9]{0,10}$' then upper(btrim(coalesce(q.x->>7, ''))) else '' end,
         tally_d8(q.x->>8), tally_d8(q.x->>9), left(btrim(coalesce(q.x->>10, '')), 100),
         case when coalesce(q.x->>1, '') ~ '^[0-9]{1,18}$' then (q.x->>1)::bigint end,
         case when coalesce(q.x->>2, '') ~ '^[0-9]{1,18}$' then (q.x->>2)::bigint end,
         now(), null
    from (select distinct on (left(btrim(y->>0), 100)) left(btrim(y->>0), 100) as guid, y as x
            from (select y from jsonb_array_elements(p_rows) y limit 50000) a
           where jsonb_typeof(y) = 'array' and btrim(coalesce(y->>0, '')) <> '' and btrim(coalesce(y->>3, '')) <> '') q
  on conflict (book_id, guid) do update set name = excluded.name, parent = excluded.parent, category = excluded.category, is_group = excluded.is_group,
         pan = excluded.pan, joined = excluded.joined, left_on = excluded.left_on, designation = excluded.designation, master_id = excluded.master_id,
         alter_id = excluded.alter_id, seen_at = excluded.seen_at, gone_at = null;
  get diagnostics n = row_count;
  if coalesce(p_complete, false) then
    update tally_employees t set gone_at = now()
     where t.book_id = p_book and t.gone_at is null
       and not exists (select 1 from jsonb_array_elements(p_rows) y where jsonb_typeof(y) = 'array' and left(btrim(y->>0), 100) = t.guid);
  end if;
  return n;
end $function$;
revoke all on function public.tally_ingest_employees(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.tally_ingest_employees(uuid, jsonb, boolean) to service_role;     -- called by tally-ingest (employees)

-- ---------------------------------------------------------------- 73's tally_ingest_details with the line marked "74"
create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; k boolean := coalesce(p_keep, false); din jsonb;
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return; end if;
  perform tally_ingest_gsttype(p_book, p_vouchers);     -- 72: each entry's GST type (bridge 2.4.2, the Day Book), before the details' own early return
  perform tally_ingest_tdstally(p_book, p_vouchers);     -- 73: each TDS payment's challan and the TDS references (bridge 2.4.3, the Day Book)
  perform tally_ingest_salpay(p_book, p_vouchers);     -- 74: the salary paid to each employee (bridge 2.4.4, the Day Book)
  -- the entries sent with their details (a body read before part A carries no 'items': left as it is), each once (the
  -- highest AlterID, as the entry path keeps it), and stored now: [{guid, alter, day, x}]
  select coalesce(jsonb_agg(jsonb_build_object('guid', q.guid, 'alter', q.alter_id, 'day', q.day, 'x', q.y)), '[]'::jsonb) into din from (
    select distinct on (y->>'guid') y->>'guid' as guid, coalesce((y->>'alter')::bigint, 0) as alter_id, v.day, y
      from jsonb_array_elements(p_vouchers) y join tally_vouchers v on v.book_id = p_book and v.guid = y->>'guid'
     where coalesce(y->>'guid', '') <> '' and jsonb_typeof(y->'items') = 'array'
     order by y->>'guid', coalesce((y->>'alter')::bigint, 0) desc) q;
  if jsonb_array_length(din) = 0 then return; end if;
  -- review M2 (06-Oct-2026): an entry the bridge marked "full": true (its 2.3.1 entry request fetched these details) is
  -- authoritative for its own details, as the Day Book is: a blank is written blank, an empty list marks its rows gone (kept,
  -- never removed). Other recorder entries keep (k) as before
  -- the e-invoice, the e-way bill, the checks' words
  update tally_vouchers v set
         irn = case when (k and lower(coalesce(d.x->>'full', '')) <> 'true') and btrim(coalesce(d.x->>'irn', '')) = '' then v.irn else left(btrim(coalesce(d.x->>'irn', '')), 100) end,
         irn_ack_no = case when (k and lower(coalesce(d.x->>'full', '')) <> 'true') and btrim(coalesce(d.x->>'ackNo', '')) = '' then v.irn_ack_no else left(btrim(coalesce(d.x->>'ackNo', '')), 40) end,
         irn_ack_date = case when (k and lower(coalesce(d.x->>'full', '')) <> 'true') and tally_d8(d.x->>'ackDate') is null then v.irn_ack_date else tally_d8(d.x->>'ackDate') end,
         eway_no = case when (k and lower(coalesce(d.x->>'full', '')) <> 'true') and btrim(coalesce(d.x->>'eway', '')) = '' then v.eway_no else left(btrim(coalesce(d.x->>'eway', '')), 40) end,
         check_notes = case when jsonb_typeof(d.x->'checks') = 'array' then d.x->'checks' else '[]'::jsonb end
    from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d where v.book_id = p_book and v.guid = d.guid;
  -- each list: the earlier rows of an entry marked gone, then the rows sent; the recorder sending none keeps the stored ones
  update tally_item_lines t set gone_at = now() from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d
   where t.book_id = p_book and t.guid = d.guid and t.gone_at is null and not ((k and lower(coalesce(d.x->>'full', '')) <> 'true') and jsonb_array_length(d.x->'items') = 0);
  insert into tally_item_lines (book_id, firm_id, guid, alter_id, day, line_no, item, qty, unit, rate, taxable, hsn, gst_rate, cgst, sgst, igst, cess)
  select p_book, f, d.guid, d.alter_id, d.day, coalesce((i->>'n')::integer, (o - 1)::integer), left(tally_nm(coalesce(i->>'item', '')), 300),
         nullif(i->>'qty', '')::numeric, left(coalesce(i->>'unit', ''), 20), nullif(i->>'rate', '')::numeric, coalesce(nullif(i->>'taxable', '')::numeric, 0),
         left(coalesce(i->>'hsn', ''), 20), nullif(i->>'gst', '')::numeric, coalesce(nullif(i->>'cgst', '')::numeric, 0), coalesce(nullif(i->>'sgst', '')::numeric, 0),
         coalesce(nullif(i->>'igst', '')::numeric, 0), coalesce(nullif(i->>'cess', '')::numeric, 0)
    from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d, jsonb_array_elements(d.x->'items') with ordinality as e(i, o)
   where jsonb_typeof(i) = 'object';
  update tally_cost_allocs t set gone_at = now() from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d
   where t.book_id = p_book and t.guid = d.guid and t.gone_at is null and not ((k and lower(coalesce(d.x->>'full', '')) <> 'true') and jsonb_array_length(coalesce(d.x->'costs', '[]'::jsonb)) = 0);
  insert into tally_cost_allocs (book_id, firm_id, guid, alter_id, day, line_no, ledger, category, centre, amount)
  select p_book, f, d.guid, d.alter_id, d.day, coalesce((c->>'n')::integer, 0), tally_nm(coalesce(c->>'ledger', '')), left(coalesce(c->>'cat', ''), 200),
         left(tally_nm(coalesce(c->>'centre', '')), 200), coalesce(nullif(c->>'amt', '')::numeric, 0)
    from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d, jsonb_array_elements(case when jsonb_typeof(d.x->'costs') = 'array' then d.x->'costs' else '[]'::jsonb end) c
   where jsonb_typeof(c) = 'object';
  update tally_bank_allocs t set gone_at = now() from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d
   where t.book_id = p_book and t.guid = d.guid and t.gone_at is null and not ((k and lower(coalesce(d.x->>'full', '')) <> 'true') and jsonb_array_length(coalesce(d.x->'banks', '[]'::jsonb)) = 0);
  insert into tally_bank_allocs (book_id, firm_id, guid, alter_id, day, line_no, ledger, txn_type, instrument_no, instrument_date, bank_date)
  select p_book, f, d.guid, d.alter_id, d.day, coalesce((b->>'n')::integer, 0), tally_nm(coalesce(b->>'ledger', '')), left(coalesce(b->>'type', ''), 60),
         left(coalesce(b->>'no', ''), 60), tally_d8(b->>'date'), tally_d8(b->>'bdate')
    from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d, jsonb_array_elements(case when jsonb_typeof(d.x->'banks') = 'array' then d.x->'banks' else '[]'::jsonb end) b
   where jsonb_typeof(b) = 'object';
  update tally_tds_lines t set gone_at = now() from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d
   where t.book_id = p_book and t.guid = d.guid and t.gone_at is null and not ((k and lower(coalesce(d.x->>'full', '')) <> 'true') and jsonb_array_length(coalesce(d.x->'tds', '[]'::jsonb)) = 0);
  insert into tally_tds_lines (book_id, firm_id, guid, alter_id, day, line_no, ledger, nature, rate, assessable, amount, party, section, section_from, deductee_type, rate_worked_out, exempt)     -- 62: the rate worked out, Tally's exempt mark
  select p_book, f, d.guid, d.alter_id, d.day, coalesce((t->>'n')::integer, 0), tally_nm(coalesce(t->>'ledger', '')), left(coalesce(t->>'nature', ''), 200),
         nullif(t->>'rate', '')::numeric, nullif(t->>'base', '')::numeric, nullif(t->>'tax', '')::numeric, tally_nm(coalesce(t->>'party', '')),
         left(coalesce(t->>'section', ''), 20), case when coalesce(t->>'section', '') = '' then '' else left(coalesce(t->>'sectionFrom', ''), 40) end,
         coalesce((select l.tds_deductee_type from tally_ledgers l where l.book_id = p_book and l.name = tally_nm(coalesce(t->>'party', '')) limit 1), ''),
         coalesce(t->>'rateWorkedOut', '') = 'true',     -- 62: parse.js's rateWorkedOut (tax / assessable x 100 where Tally stores the rate as 0)
         coalesce(t->>'exempt', '') = 'true'     -- 62: parse.js's exempt (Tally's EXEMPTED Yes; never a rate worked out)
    from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d, jsonb_array_elements(case when jsonb_typeof(d.x->'tds') = 'array' then d.x->'tds' else '[]'::jsonb end) t
   where jsonb_typeof(t) = 'object';
  -- a due date Tally keeps as a date, on the bill the entry path stored just now (the same ledger, name, type and amount)
  update tally_bills b set due = tally_d8(u->>'due')
    from (select z->>'guid' as guid, (z->>'alter')::bigint as alter_id, (z->>'day')::date as day, z->'x' as x from jsonb_array_elements(din) z) d, jsonb_array_elements(case when jsonb_typeof(d.x->'dues') = 'array' then d.x->'dues' else '[]'::jsonb end) u
   where b.book_id = p_book and b.guid = d.guid and b.ledger = tally_nm(coalesce(u->>'ledger', '')) and b.name = left(coalesce(u->>'name', ''), 200)
     and b.type = left(coalesce(u->>'type', ''), 20) and b.amount = nullif(u->>'amt', '')::numeric and tally_d8(u->>'due') is not null
     and b.due is distinct from tally_d8(u->>'due');
end $function$;
revoke all on function public.tally_ingest_details(uuid, jsonb, boolean) from public, anon, authenticated, service_role;


commit;
