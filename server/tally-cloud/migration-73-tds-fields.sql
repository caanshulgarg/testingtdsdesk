-- Migration 73 (11-Oct-2026, FinCom Bridge 2.4.3, branch next-tdsfields; the owner's approval of 11-Oct-2026: TDS challan
-- details and TDS master settings from Tally). Kept in the cloud copy:
--   - on each entry (tally_vouchers): a TDS payment's challan as Tally keeps it (BSR code, number, date, cheque, bank,
--     branch; the Stat Payment's duty and period; per nature its period, return, deductee status, amount paid and challan;
--     each line's tax / interest / late fee) and the TDS references Tally links a deduction and its payment by
--     (TAXOBJECTALLOCATIONS: New Ref on the deduction, Agst Ref on the payment), as parse.js reads them into each voucher's
--     "tdsx" (one reader for the Day Book and the bridge's entry body); with the AlterID they were read at;
--   - on each ledger (tally_ledgers): a TDS duty ledger's nature of payment (TDSRATENAME), a party's special rate and its
--     lower-deduction certificates (the ledger list's 12th, 13th and 14th columns);
--   - the natures of payment (tally_tds_natures): each one's section, rates and thresholds by the date they apply from.
-- Runs AFTER 72 (72's tally_ingest_details is in force on staging). ADD-ONLY: no table, column, row or function removed; no
-- statement in this file removes rows; safe to run twice; one transaction (lock_timeout 10 s). Five columns added (null on
-- every row there is: not read yet); one table added (read by a member of the firm, written by the functions below only);
-- two functions added, tally_ingest_tdstally(book, vouchers) (security definer, search_path = public, pg_temp, granted to
-- nobody: called by tally_ingest_details) and tally_ingest_natures(book, natures) (the same, executed by service_role alone: tally-ingest's ledger_list); one function replaced: tally_ingest_details (72's text, same arguments,
-- security definer, granted to nobody), with ONE line added, marked "73", calling tally_ingest_tdstally. Nothing else is
-- touched; no row is changed by running it. Tested on pg_stand only: tests/run_migration73.py. Deploy order: run this file
-- BEFORE deploying the tally-ingest that carries the new parse.js (without it the "tdsx" key, the three ledger columns and
-- the natures are sent and left: nothing breaks, nothing is stored).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- the entry's TDS challan and references as Tally keeps them (null: not read yet: a body without the fields)
alter table public.tally_vouchers add column if not exists tds_tally jsonb;               -- parse.js's "tdsx": {stat, from, to, nature, section, challan, kinds, periods, refs}
alter table public.tally_vouchers add column if not exists tds_tally_alter_id bigint;     -- the AlterID tds_tally was read at; below alter_id: an older version's (a later body carried none)
-- the TDS settings on a ledger master (null: not read yet: a bridge before 2.4.3)
alter table public.tally_ledgers add column if not exists tds_nature text;               -- TDSRATENAME: the nature of payment of a TDS duty ledger (and of an expense or party ledger where Tally keeps one)
alter table public.tally_ledgers add column if not exists tds_special_rate text;         -- TDSDEDUCTEESPECIALRATE when TDSDEDUCTEEISSPECIALRATE is Yes ('' : none)
alter table public.tally_ledgers add column if not exists tds_ldc jsonb;                 -- the lower-deduction certificates: [[nature, from, to, section, certificate, rate, limit]]

-- the natures of payment (Tally's TDSRate masters), by their Tally GUID
create table if not exists public.tally_tds_natures (
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,
  name text not null,
  master_id bigint,
  alter_id bigint,
  categories jsonb not null default '[]'::jsonb,     -- [[from, section, rate, other rate, rate without PAN, other rate without PAN, yearly threshold, single bill threshold]]
  seen_at timestamptz not null default now(),
  primary key (book_id, guid)
);
alter table public.tally_tds_natures enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_tds_natures' and policyname = 'tally_tds_natures_read') then
    create policy tally_tds_natures_read on public.tally_tds_natures for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_tds_natures from public, anon, authenticated;
grant select on public.tally_tds_natures to authenticated;
grant all on public.tally_tds_natures to service_role;

-- ---------------------------------------------------------------- the TDS challan and references of the entries just stored
-- p_vouchers as the entry path got them (each with its guid and alter); only a voucher carrying a "tdsx" object is written,
-- and only onto the entry stored at exactly that AlterID (the version just stored), with tds_tally_alter_id = that AlterID
-- (a later version stored from a body without "tdsx" leaves tds_tally_alter_id below the entry's alter_id)
create or replace function public.tally_ingest_tdstally(p_book uuid, p_vouchers jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return; end if;
  update tally_vouchers v set tds_tally = d.x, tds_tally_alter_id = d.alter_id
    from (select distinct on (y->>'guid') y->>'guid' as guid, coalesce(nullif(y->>'alter', '')::bigint, 0) as alter_id, y->'tdsx' as x
            from jsonb_array_elements(p_vouchers) y
           where jsonb_typeof(y) = 'object' and coalesce(y->>'guid', '') <> '' and jsonb_typeof(y->'tdsx') = 'object'
             and coalesce(y->>'alter', '0') ~ '^[0-9]{1,18}$' and octet_length((y->'tdsx')::text) <= 200000
           order by y->>'guid', coalesce(nullif(y->>'alter', '')::bigint, 0) desc) d
   where v.book_id = p_book and v.guid = d.guid and coalesce(v.alter_id, 0) = d.alter_id;
end $function$;
revoke all on function public.tally_ingest_tdstally(uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the natures of payment the ledger list brought
-- p_natures: [[guid, MasterID, AlterID, name, [[from, section, rate, other, no-PAN rate, no-PAN other, threshold, single
-- bill]]]] (at most 2,000 natures, 20 dates each); one row per GUID added or brought up to date; none removed. The number
-- of rows written
create or replace function public.tally_ingest_natures(p_book uuid, p_natures jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; n integer := 0;
begin
  if jsonb_typeof(p_natures) is distinct from 'array' then return 0; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return 0; end if;
  insert into tally_tds_natures as t (book_id, firm_id, guid, name, master_id, alter_id, categories, seen_at)
  select p_book, f, q.guid, left(tally_nm(coalesce(q.x->>3, '')), 200),
         case when coalesce(q.x->>1, '') ~ '^[0-9]{1,18}$' then (q.x->>1)::bigint end,
         case when coalesce(q.x->>2, '') ~ '^[0-9]{1,18}$' then (q.x->>2)::bigint end,
         coalesce((select jsonb_agg(c) from (select c from jsonb_array_elements(case when jsonb_typeof(q.x->4) = 'array' then q.x->4 else '[]'::jsonb end) c
                                              where jsonb_typeof(c) = 'array' and octet_length(c::text) <= 2000 limit 20) z), '[]'::jsonb),
         now()
    from (select distinct on (left(btrim(y->>0), 100)) left(btrim(y->>0), 100) as guid, y as x
            from (select y from jsonb_array_elements(p_natures) y limit 2000) a
           where jsonb_typeof(y) = 'array' and btrim(coalesce(y->>0, '')) <> '' and btrim(coalesce(y->>3, '')) <> '') q
  on conflict (book_id, guid) do update set name = excluded.name, master_id = excluded.master_id, alter_id = excluded.alter_id,
         categories = excluded.categories, seen_at = excluded.seen_at;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.tally_ingest_natures(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_ingest_natures(uuid, jsonb) to service_role;     -- called by tally-ingest (ledger_list)

-- ---------------------------------------------------------------- 72's tally_ingest_details with the line marked "73"
create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; k boolean := coalesce(p_keep, false); din jsonb;
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return; end if;
  perform tally_ingest_gsttype(p_book, p_vouchers);     -- 72: each entry's GST type (bridge 2.4.2, the Day Book), before the details' own early return
  perform tally_ingest_tdstally(p_book, p_vouchers);     -- 73: each TDS payment's challan and the TDS references (bridge 2.4.3, the Day Book)
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
