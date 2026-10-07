-- Migration 61 (07-Oct-2026, the owner's decision, option A, for the bridge release after 2.3.1): "Work out the rate as tax
-- divided by assessable amount where Tally stores 0, and mark it as worked out." TallyPrime 7.1 stores TAXRATE 0 on a TDS
-- entry keyed on its screen (real run 37492981527, S5); the cloud's reader (parse.js) works the rate out from the Income Tax
-- sub-category's tax and assessable amount and marks the line rateWorkedOut: true. This file keeps that mark with the line.
-- Runs AFTER 57 (fresh database and staging: ... -> 57 -> 58 -> 59 -> 60 -> 61; independent of 58, 59 and 60). ADD-ONLY: no
-- table, column, row or function removed; no statement in this file removes rows, not even in a comment; safe to run twice;
-- one transaction (lock_timeout 10 s). One column added, tally_tds_lines.rate_worked_out (false on every row there is); one
-- function replaced: tally_ingest_details (same arguments, security definer, search_path = public, pg_temp, granted to
-- nobody as in 57), 57's text with the lines marked "61" changed (the TDS row carries the mark). tally_tds_details(book) is
-- not replaced (its columns would change: the mark is read from tally_tds_lines, which the firm's members read). Nothing
-- else is touched; no row is changed by running it. Tested on pg_stand only: tests/run_migration61.py. NOT yet run on
-- staging.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- the rate worked out by FinCom (tax / assessable amount x 100) where Tally stores 0; false: the rate is Tally's own
alter table public.tally_tds_lines add column if not exists rate_worked_out boolean not null default false;

-- ---------------------------------------------------------------- 57's tally_ingest_details with the lines marked "61"
create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; k boolean := coalesce(p_keep, false); din jsonb;
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return; end if;
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
  insert into tally_tds_lines (book_id, firm_id, guid, alter_id, day, line_no, ledger, nature, rate, assessable, amount, party, section, section_from, deductee_type, rate_worked_out)     -- 61: the rate worked out
  select p_book, f, d.guid, d.alter_id, d.day, coalesce((t->>'n')::integer, 0), tally_nm(coalesce(t->>'ledger', '')), left(coalesce(t->>'nature', ''), 200),
         nullif(t->>'rate', '')::numeric, nullif(t->>'base', '')::numeric, nullif(t->>'tax', '')::numeric, tally_nm(coalesce(t->>'party', '')),
         left(coalesce(t->>'section', ''), 20), case when coalesce(t->>'section', '') = '' then '' else left(coalesce(t->>'sectionFrom', ''), 40) end,
         coalesce((select l.tds_deductee_type from tally_ledgers l where l.book_id = p_book and l.name = tally_nm(coalesce(t->>'party', '')) limit 1), ''),
         coalesce(t->>'rateWorkedOut', '') = 'true'     -- 61: parse.js's rateWorkedOut (tax / assessable x 100 where Tally stores the rate as 0)
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
