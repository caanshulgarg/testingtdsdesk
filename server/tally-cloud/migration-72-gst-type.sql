-- Migration 72 (11-Oct-2026, FinCom Bridge 2.4.2, branch next-gsttype; the owner's approval of 11-Oct-2026: "the bridge sends
-- each entry's GST type"). The entry's GST type as Tally stores it, kept with the entry in the cloud copy: the party's
-- GST registration type, the buyer's country, reverse charge, the nature of the transaction (SEZ with or without payment,
-- export with or without payment / LUT, ...), the taxability (taxable, nil-rated, exempt, non-GST), goods or services and
-- the ineligible (blocked, 17(5)) input credit mark. parse.js reads them (one reader for the Day Book and for the bridge's
-- entry body) into each voucher's "gst" object; a voucher read without them (a body from a bridge before 2.4.2, whose entry
-- request does not keep them) carries no "gst" key and its stored values are left as they are (never blanked).
-- Runs AFTER 62 (staging: 57 .. 68 and 70 have run there; 62's tally_ingest_details is in force, prosrc md5
-- 641618d1a6af1baf42a2ed5b1470df7e). ADD-ONLY: no table, column, row or function removed; no statement in this file removes
-- rows; safe to run twice; one transaction (lock_timeout 10 s). Nine columns added to tally_vouchers (null on every row
-- there is: not read yet; review of 11-Oct-2026: gst_mixed (M2) and gst_alter_id (H1) with the seven); one function added, tally_ingest_gsttype(book, vouchers) (security definer, search_path =
-- public, pg_temp, granted to nobody); one function replaced: tally_ingest_details (62's text, same arguments, security
-- definer, granted to nobody), with ONE line added, marked "72", calling tally_ingest_gsttype. Nothing else is touched; no
-- row is changed by running it. Tested on pg_stand only: tests/run_migration72.py. Deploy order: run this file BEFORE
-- deploying the tally-ingest that carries the new parse.js (without it the "gst" key is sent and ignored: nothing breaks,
-- nothing is stored).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- the entry's GST type as Tally stores it (null: not read yet: a Day Book or a bridge body without the fields)
alter table public.tally_vouchers add column if not exists gst_reg_type text;       -- the party's GST registration type (GSTREGISTRATIONTYPE: Regular, Unregistered, Composition, Consumer, ...)
alter table public.tally_vouchers add column if not exists gst_country text;        -- the party's country (COUNTRYOFRESIDENCE: an export when not India)
alter table public.tally_vouchers add column if not exists gst_rcm boolean;         -- reverse charge (ISREVERSECHARGEAPPLICABLE Yes, or a line's GSTOVRDNISREVCHARGEAPPL Applicable)
alter table public.tally_vouchers add column if not exists gst_nature text;         -- the nature of the transaction (GSTOVRDNNATURE: "Sales to SEZ - Taxable", "Exports - LUT/Bond", ...)
alter table public.tally_vouchers add column if not exists gst_taxability text;     -- the taxability (GSTOVRDNTAXABILITY: Taxable, Nil Rated, Exempt, Non-GST)
alter table public.tally_vouchers add column if not exists gst_supply text;         -- goods or services (GSTOVRDNTYPEOFSUPPLY)
alter table public.tally_vouchers add column if not exists gst_ineligible boolean;  -- input credit ineligible (blocked, 17(5)): a line's GSTOVRDNINELIGIBLEITC Applicable
alter table public.tally_vouchers add column if not exists gst_mixed boolean;      -- review M2: the entry's GST lines disagree on the nature or the taxability (the values above are the first GST line's)
alter table public.tally_vouchers add column if not exists gst_alter_id bigint;    -- review H1: the AlterID the values above were read at; below alter_id: an older version's (a later body carried none)

-- ---------------------------------------------------------------- the GST type of the entries just stored
-- p_vouchers as the entry path got them (each with its guid and alter); only a voucher carrying a "gst" object is written,
-- and only onto the entry stored at exactly that AlterID (review L1: the version just stored; an older or a newer row is
-- left as it is), with gst_alter_id = that AlterID (review H1: a later version stored from a body without "gst" leaves
-- gst_alter_id below the entry's alter_id, so a reader knows the values are an older version's)
create or replace function public.tally_ingest_gsttype(p_book uuid, p_vouchers jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return; end if;
  update tally_vouchers v set
         gst_reg_type = left(btrim(coalesce(d.g->>'reg', '')), 60),
         gst_country = left(btrim(coalesce(d.g->>'country', '')), 60),
         gst_rcm = coalesce((d.g->>'rcm')::boolean, false),
         gst_nature = left(btrim(coalesce(d.g->>'nature', '')), 100),
         gst_taxability = left(btrim(coalesce(d.g->>'taxability', '')), 40),
         gst_supply = left(btrim(coalesce(d.g->>'supply', '')), 20),
         gst_ineligible = coalesce((d.g->>'ineligible')::boolean, false),
         gst_mixed = coalesce((d.g->>'mixed')::boolean, false),
         gst_alter_id = d.alter_id
    from (select distinct on (y->>'guid') y->>'guid' as guid, coalesce(nullif(y->>'alter', '')::bigint, 0) as alter_id, y->'gst' as g
            from jsonb_array_elements(p_vouchers) y
           where jsonb_typeof(y) = 'object' and coalesce(y->>'guid', '') <> '' and jsonb_typeof(y->'gst') = 'object'
             and coalesce(y->'gst'->>'rcm', 'false') in ('true', 'false') and coalesce(y->'gst'->>'ineligible', 'false') in ('true', 'false')
             and coalesce(y->'gst'->>'mixed', 'false') in ('true', 'false')
             and coalesce(y->>'alter', '0') ~ '^[0-9]{1,18}$'
           order by y->>'guid', coalesce(nullif(y->>'alter', '')::bigint, 0) desc) d
   where v.book_id = p_book and v.guid = d.guid and coalesce(v.alter_id, 0) = d.alter_id;
end $function$;
revoke all on function public.tally_ingest_gsttype(uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 62's tally_ingest_details with the line marked "72"
create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; k boolean := coalesce(p_keep, false); din jsonb;
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return; end if;
  perform tally_ingest_gsttype(p_book, p_vouchers);     -- 72: each entry's GST type (bridge 2.4.2, the Day Book), before the details' own early return
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
