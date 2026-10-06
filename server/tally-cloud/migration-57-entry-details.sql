-- Migration 57 (06-Oct-2026, FinCom Bridge 2.3.1 part A: "item invoices enter complete"). Runs AFTER 56 (fresh database:
-- ... -> 55 -> 56 -> 57; staging: after 56). ADD-ONLY: no table, column, row or function removed; no statement in this file
-- removes rows, not even in a comment; safe to run twice; one transaction (lock_timeout 10 s). Tables and columns added if
-- missing; functions created or replaced. Nothing is rewritten by running it.
--
--   THE OWNER'S DECISIONS (06-Oct-2026). The entry request (bridge 2.3.1) fetches the whole entry; the cloud's reader
--   (parse.js, one reader for the Day Book and the entry body) reads it; this file stores it:
--     tally_vouchers + irn, irn_ack_no, irn_ack_date, eway_no      the e-invoice IRN and acknowledgement, the e-way bill number
--                    + check_notes (jsonb, [] when none)           the accuracy checks' plain words (a Day Book entry is never
--                                                                   refused: flagged here; a recorder body that fails is held
--                                                                   by tally-ingest and never reaches the copy)
--     tally_item_lines   one row per item line: item, quantity, unit, rate, taxable value, the HSN / SAC and GST rate Tally
--                        applied to the line, CGST / SGST / IGST / cess (worked out from the line's rate and taxable value as
--                        Tally does: Tally 7.1 writes no tax amount per item line; tax_basis says so)
--     tally_cost_allocs  cost category and cost centre allocations, on ledger lines and on the ledger lines under items
--     tally_bank_allocs  bank details on bank lines: transaction type, instrument number or UTR, instrument date, bank date
--     tally_tds_lines    TDS details where present: nature of payment, section (Tally's own from the entry's bill-wise
--                        detail TDSDEDUCTEESECTIONNUMBER, else the section written in the nature's name, else blank:
--                        section_from says which), rate, assessable value, tax, the deductee and the deductee type
--     tally_ledgers.tds_deductee_type   the party ledger master's TDSDEDUCTEETYPE (written by the ledger list once part B's
--                        ledger request fetches it); tally_tds_details(book) (members of the firm) reads the current one
--     tally_bills.due    a due date Tally keeps as a date (a credit period "15-Nov-2026"), besides the credit days (48)
--   Each detail row carries its entry (guid), AlterID, day and line number (the line's place in the entry as parse.js reads
--   it) and gone_at: a re-sent entry's earlier rows are marked gone (gone_at, kept as history), never removed. Readers take
--   gone_at is null, and the entry's tally_vouchers.deleted_at is null. RLS: the firm's members read (my_firm()), as the
--   neighbouring tables; written only by the entry path.
--
--   1. tally_ingest_details(p_book, p_vouchers, p_keep): writes the above for the entries just stored. An entry whose body
--      carries no details (a reader before part A: no 'items' key) is left as it is. The Day Book (p_keep false) is
--      authoritative: its values replace the stored ones, an empty list included. The recorder (p_keep true, migration 56's
--      flag) never blanks a stored value: a blank IRN / acknowledgement / e-way bill keeps the stored one, an empty list
--      keeps the stored rows; a value or rows sent replace them.
--   2. tally_ingest_entries(p_book, p_vouchers, p_lines, p_rebuild, p_keep): 56's text; after 48's 4-argument form it calls
--      tally_ingest_details, and re-applies an applied delete (cancel) of an entry the body brings back at a lower AlterID,
--      or one settled as "nothing to remove": a later Day Book cannot undo a delete; a cancelled entry comes in cancelled.
--      The owner's review of 06-Oct-2026: one settled as "nothing to remove" WITHOUT an AlterID is re-applied only to a body
--      at or below its bound (tally_nothing_removed: the book's highest AlterID received when it settled); a body above it
--      is a later change in Tally, applied normally and never touched by that line again; no bound known: at most once.
--      Both paths reach it: the recorder (tally_recorder_line, 56: p_keep true) and the Day Book (below: p_keep false).
--   3. tally_ingest_day (8 arguments): 44's text, its one call through the 5-argument form with p_keep false (48's 4-argument
--      behaviour exactly, plus the details). The 7-argument form calls it (41), unchanged.
--   4. tally_ingest_delete: 50's text; a delete or cancel of an entry never in FinCom's copy settles by itself: state applied,
--      "nothing to remove: the entry is not in FinCom's copy and no longer counts in Tally" (the line kept, visible in Sync
--      activity), instead of waiting for a Day Book; it records the bound above (tally_nothing_removed, add-only, RLS on,
--      the service role's only).
--   Every function: security definer, search_path = public, pg_temp; tally_ingest_details and the 5-argument
--   tally_ingest_entries granted to nobody (run as the owner by the entry path); tally_ingest_day and tally_ingest_delete
--   the service role's, as before. Tested by tests/run_migration57.py (pg_stand) and tests/run_migration_order.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- 1. the entry's details: columns and tables
alter table public.tally_vouchers add column if not exists irn text not null default '';
alter table public.tally_vouchers add column if not exists irn_ack_no text not null default '';
alter table public.tally_vouchers add column if not exists irn_ack_date date;
alter table public.tally_vouchers add column if not exists eway_no text not null default '';
alter table public.tally_vouchers add column if not exists check_notes jsonb not null default '[]'::jsonb;

create table if not exists public.tally_item_lines (
  id bigserial primary key,
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,
  alter_id bigint not null default 0,
  day date not null,
  line_no integer not null,
  item text not null default '',
  qty numeric,
  unit text not null default '',
  rate numeric,
  taxable numeric not null default 0,
  hsn text not null default '',
  gst_rate numeric,
  cgst numeric not null default 0,
  sgst numeric not null default 0,
  igst numeric not null default 0,
  cess numeric not null default 0,
  tax_basis text not null default 'worked out from the line''s GST rate and taxable value, as Tally does (Tally 7.1 writes no tax amount per item line)',
  at timestamptz not null default now(),
  gone_at timestamptz
);
create table if not exists public.tally_cost_allocs (
  id bigserial primary key,
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,
  alter_id bigint not null default 0,
  day date not null,
  line_no integer not null,
  ledger text not null default '',
  category text not null default '',
  centre text not null default '',
  amount numeric not null default 0,
  at timestamptz not null default now(),
  gone_at timestamptz
);
create table if not exists public.tally_bank_allocs (
  id bigserial primary key,
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,
  alter_id bigint not null default 0,
  day date not null,
  line_no integer not null,
  ledger text not null default '',
  txn_type text not null default '',
  instrument_no text not null default '',
  instrument_date date,
  bank_date date,
  at timestamptz not null default now(),
  gone_at timestamptz
);
create table if not exists public.tally_tds_lines (
  id bigserial primary key,
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,
  alter_id bigint not null default 0,
  day date not null,
  line_no integer not null,
  ledger text not null default '',
  nature text not null default '',
  section text not null default '',
  rate numeric,
  assessable numeric,
  amount numeric,
  party text not null default '',
  deductee_type text not null default '',
  at timestamptz not null default now(),
  gone_at timestamptz
);
-- the TDS section's source ("Tally's entry": the entry's bill-wise detail; "the nature of payment's name"; '' unknown), and
-- the party ledger's deductee type (the ledger master's TDSDEDUCTEETYPE; written by the ledger list once part B's ledger
-- request fetches it; '' until then)
alter table public.tally_tds_lines add column if not exists section_from text not null default '';
alter table public.tally_ledgers add column if not exists tds_deductee_type text not null default '';
create index if not exists tally_item_lines_now on public.tally_item_lines (book_id, guid) where gone_at is null;
create index if not exists tally_item_lines_hsn on public.tally_item_lines (book_id, day, hsn) where gone_at is null;
create index if not exists tally_cost_allocs_now on public.tally_cost_allocs (book_id, guid) where gone_at is null;
create index if not exists tally_cost_allocs_centre on public.tally_cost_allocs (book_id, centre, day) where gone_at is null;
create index if not exists tally_bank_allocs_now on public.tally_bank_allocs (book_id, guid) where gone_at is null;
create index if not exists tally_tds_lines_now on public.tally_tds_lines (book_id, guid) where gone_at is null;
-- read as the other tables of the copy: a member of the firm; written only by the entry path (the functions below)
do $$
declare t text;
begin
  foreach t in array array['tally_item_lines', 'tally_cost_allocs', 'tally_bank_allocs', 'tally_tds_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (firm_id = public.my_firm())', t || '_read', t);
    end if;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- the owner's review of 06-Oct-2026: a delete or cancel settled as "nothing to remove" (the entry never in the copy) records
-- a bound here: its own AlterID, or without one the book's highest AlterID received then (tally_sync_cursor.recorder_max_alter,
-- the copy's highest); null when nothing is known. A later body is deleted (cancelled) again only at or below the bound;
-- with no bound, at most once (reapplied). Written by tally_ingest_delete / tally_ingest_entries only (no member, no anon)
create table if not exists public.tally_nothing_removed (
  book_id uuid not null,
  guid text not null,
  event text not null check (event in ('deleted', 'cancelled')),
  bound bigint,
  settled_at timestamptz not null default now(),
  reapplied integer not null default 0,
  primary key (book_id, guid, event)
);
alter table public.tally_nothing_removed enable row level security;
revoke all on public.tally_nothing_removed from public, anon, authenticated;
grant all on public.tally_nothing_removed to service_role;

-- the details of the entries just stored (p_vouchers as the entry path got them, each with its guid, alter and day). p_keep
-- (the recorder, 56): never blank a stored value; else (the Day Book) authoritative
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
  insert into tally_tds_lines (book_id, firm_id, guid, alter_id, day, line_no, ledger, nature, rate, assessable, amount, party, section, section_from, deductee_type)
  select p_book, f, d.guid, d.alter_id, d.day, coalesce((t->>'n')::integer, 0), tally_nm(coalesce(t->>'ledger', '')), left(coalesce(t->>'nature', ''), 200),
         nullif(t->>'rate', '')::numeric, nullif(t->>'base', '')::numeric, nullif(t->>'tax', '')::numeric, tally_nm(coalesce(t->>'party', '')),
         left(coalesce(t->>'section', ''), 20), case when coalesce(t->>'section', '') = '' then '' else left(coalesce(t->>'sectionFrom', ''), 40) end,
         coalesce((select l.tds_deductee_type from tally_ledgers l where l.book_id = p_book and l.name = tally_nm(coalesce(t->>'party', '')) limit 1), '')
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
-- the TDS details as members read them (as 56's tally_unknown_ledger_entries: the caller's firm, my_firm(); the service
-- role or owner names the book): the deductee type the party ledger has now (the ledger master's TDSDEDUCTEETYPE, part B),
-- else the one stored with the line; the section and where it came from
create or replace function public.tally_tds_details(p_book uuid)
returns table (book_id uuid, guid text, day date, line_no integer, ledger text, nature text, section text, section_from text, rate numeric,
               assessable numeric, amount numeric, party text, deductee_type text)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
#variable_conflict use_column
declare f uuid := my_firm(); svc boolean := tally_service_or_owner();
begin
  if f is null and not svc then raise exception 'not allowed' using errcode = '42501'; end if;
  if svc and f is null and p_book is null then raise exception 'which book?'; end if;
  return query
    select t.book_id, t.guid, t.day, t.line_no, t.ledger, t.nature, t.section, t.section_from, t.rate, t.assessable, t.amount, t.party,
           coalesce(nullif((select x.tds_deductee_type from tally_ledgers x where x.book_id = t.book_id and x.name = t.party and x.deleted_at is null limit 1), ''), t.deductee_type)
      from tally_tds_lines t
      join tally_books b on b.book_id = t.book_id
      join tally_vouchers v on v.book_id = t.book_id and v.guid = t.guid and v.deleted_at is null
     where t.gone_at is null and (p_book is null or t.book_id = p_book) and (b.firm_id = f or (svc and f is null))
     order by t.day, t.guid, t.line_no
     limit 5000;
end $function$;
revoke all on function public.tally_tds_details(uuid) from public, anon;
grant execute on function public.tally_tds_details(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. the entry path: 56's 5-argument form, the details written after the entries
-- 56's text; the one return replaced by the details and the re-applied delete (cancel)
create or replace function public.tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb, p_rebuild boolean, p_keep boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare vs jsonb := p_vouchers; ls jsonb := p_lines; res jsonb; sent text[]; x record; nb bigint; nr int;     -- 57: res, sent, x, nb, nr
begin
  if not tally_service_or_owner() and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_keep, false) then
    perform pg_advisory_xact_lock(hashtext(p_book::text));     -- the stored values read under the lock the entry path takes (re-entrant)
    vs := tally_recorder_keep_vouchers(p_book, p_vouchers);
    ls := tally_recorder_keep_lines(p_book, p_lines, p_vouchers);
  end if;
  res := tally_ingest_entries(p_book, vs, ls, p_rebuild);
  -- 57: the entry's details (bridge 2.3.1 part A), written for both paths here; nothing when the entries were not stored (a
  -- locked month)
  if coalesce((res->>'ok')::boolean, false) then
    perform tally_ingest_details(p_book, vs, coalesce(p_keep, false));
    -- 57: a later entry body (a Day Book, or another computer's line) cannot undo a delete or cancel already received: an
    -- applied delete (cancel) of the entry above the body's AlterID is applied again. One settled as "nothing to remove"
    -- without an AlterID (the owner's review of 06-Oct-2026) only up to its bound (tally_nothing_removed: the book's highest
    -- AlterID received when it settled): a body at or below it is the old entry, deleted (cancelled) again; one above it is a
    -- later change in Tally, applied and never touched by that line again; with no bound known, at most once
    select coalesce(array_agg(distinct y->>'guid'), '{}') into sent from jsonb_array_elements(vs) y where coalesce(y->>'guid', '') <> '';
    for x in select v.guid, l.event, max(l.alter_id) as alt, max(coalesce(v.alter_id, 0)) as valt,
                    bool_or(coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0)) as above from tally_vouchers v
               join tally_recorder_lines l on l.book_id = p_book and l.object_guid = v.guid and l.state = 'applied' and l.event in ('deleted', 'cancelled')
              where v.book_id = p_book and v.guid = any(sent) and v.deleted_at is null and (l.event = 'deleted' or not v.cancelled)
                and (coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0) or (l.alter_id is null and coalesce(l.held_why, '') like 'nothing to remove%'))
              group by v.guid, l.event order by v.guid, l.event
    loop
      if not x.above then
        select n.bound, n.reapplied into nb, nr from tally_nothing_removed n where n.book_id = p_book and n.guid = x.guid and n.event = x.event for update;
        if not found then
          insert into tally_nothing_removed (book_id, guid, event, bound, reapplied) values (p_book, x.guid, x.event, null, 0) on conflict do nothing;
          nb := null; nr := 0;
        end if;
        if (nb is not null and x.valt > nb) or (nb is null and nr > 0) then continue; end if;
        update tally_nothing_removed set reapplied = reapplied + 1 where book_id = p_book and guid = x.guid and event = x.event;
      end if;
      perform tally_ingest_delete(p_book, x.guid, x.alt, x.event = 'cancelled', 'a delete or cancel already received: a later entry body does not undo it');
    end loop;
  end if;
  return res;
end $function$;
revoke all on function public.tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 3. the Day Book: 44's tally_ingest_day, its one call through the 5-argument form (p_keep false)
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0; n_in int := case when jsonb_typeof(p_vouchers) = 'array' then jsonb_array_length(p_vouchers) else 0 end; short text; emptied boolean := false; live_n int; prev_empty timestamptz; d_empty timestamptz; d_note text; pend int; capped boolean := false; lk date; ent jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> '';
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  ) q;
  -- migration 44: a day of a locked month (or an entry moving out of one) stores nothing: no entry, no mark, no record
  lk := tally_month_locked(p_book, touched);
  if lk is not null then
    return jsonb_build_object('ok', true, 'day', p_day, 'touched', '[]'::jsonb, 'marked', 0, 'sent', 0, 'locked', true,
      'refused', format('month locked: %s (locked by the owner; nothing stored, nothing marked)', to_char(lk, 'YYYY-MM')));
  end if;
  -- 8: the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, array(select v.guid from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid = any(sent))));
  -- the day's entries not in the file: marked, kept (lines and bills kept too) - but NEVER on a short read (migration 38,
  -- item 9): a file with no entries, or fewer than the bridge counted for the day (p_n), upserts what came and marks
  -- nothing; the answer says refused: 'short read: n of p_n' and tally-ingest logs it. Migration 44: marked before the
  -- entries are taken (the marked rows are never the file's), the cache of the day rebuilt after both
  select d.empty_at into prev_empty from tally_days d where d.book_id = p_book and d.day = p_day;
  select count(*) into live_n from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
  if n_in = 0 and coalesce(p_n, 0) = 0 and p_empty is true then
    -- migration 39: the bridge positively read the day and Tally listed no entries. Migration 42: a day that still has
    -- live entries is emptied only on the SECOND consecutive empty read (the first is recorded in tally_days.empty_at
    -- and refused); a day with no live entries has nothing to mark and is recorded as empty at once. Decided by
    -- empty_at and the live count alone, never by tally_days.n. A later file with entries un-marks them and clears the record
    -- the cap (migration 43): the book's days still PENDING a second empty read, however old (a first empty read never
    -- confirmed), plus the days an empty read MARKED in the last 24 hours; days with nothing to mark never count
    select count(*) into pend from tally_days d where d.book_id = p_book and d.empty_at is not null
       and (d.note like 'empty day with%' or (d.empty_at >= now() - interval '24 hours' and d.note ~ '^\d+ entries marked deleted on the second empty read'));
    if live_n = 0 then
      emptied := true; d_empty := now(); d_note := 'empty day, nothing to mark';
    elsif pend >= 10 then
      short := format('%s days of this book read empty within 24 hours: a read fault; this day is not emptied and not recorded; nothing marked', pend);
      capped := true;
    elsif prev_empty is null then
      short := format('empty day with %s live entries: confirm by a second empty read', live_n);
      d_empty := now(); d_note := short;
    else
      update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
      get diagnostics marked = row_count; emptied := true;
      d_empty := now(); d_note := format('%s entries marked deleted on the second empty read (the first at %s)', marked, to_char(prev_empty at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"'));
    end if;
  elsif n_in = 0 or n_in < coalesce(p_n, 0) then
    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
  else
    update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not (v.guid = any(sent));
    get diagnostics marked = row_count;
  end if;
  -- the entries in the file, each dated the day: the one entry path (owner item 95), which replaces their lines and
  -- bills and rebuilds the cache of the days they had and have
  ent := tally_ingest_entries(p_book, (select coalesce(jsonb_agg(x || jsonb_build_object('day', p_day) order by o), '[]'::jsonb) from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)), p_lines, true, false);     -- 57: the entry path with the entry's details (the Day Book: authoritative, p_keep false)
  if not (p_day = any(array(select jsonb_array_elements_text(coalesce(ent->'touched', '[]'::jsonb))::date))) then perform tally_ledger_day_rebuild(p_book, array[p_day]); end if;
  -- the day's bookkeeping. An empty read is recorded (empty_at, note); a file with entries clears the record. Migration 42:
  -- an empty file that marked nothing (a refused first empty read, a short read) keeps the n the day had, so the day's
  -- count is never zeroed by a read that changed nothing
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at, empty_at, note) values (p_book, f, p_day, p_n, p_alter, p_bytes, now(), d_empty, d_note)
  on conflict (book_id, day) do update set
     n = case when n_in = 0 and not emptied then tally_days.n else excluded.n end,
     alter_max = excluded.alter_max, bytes = excluded.bytes, at = now(),
     empty_at = case when n_in > 0 then null else coalesce(excluded.empty_at, tally_days.empty_at) end,
     note = case when n_in > 0 then null else coalesce(excluded.note, tally_days.note) end;
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0)) || case when short is null then '{}'::jsonb else jsonb_build_object('refused', short) end || case when emptied then jsonb_build_object('empty', true) else '{}'::jsonb end || case when d_empty is not null and not emptied then jsonb_build_object('emptyPending', true) else '{}'::jsonb end || case when capped then jsonb_build_object('emptyCapped', true) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) to service_role;

-- ---------------------------------------------------------------- 4. a delete or cancel of an entry never in the copy: settled ('nothing to remove')
-- 50's text; the one branch for an entry not in the copy changed
create or replace function public.tally_ingest_delete(p_book uuid, p_guid text, p_alter bigint, p_cancel boolean, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); act text := case when p_cancel then 'cancelled' else 'deleted' end;
  src text := left(coalesce(p_source, ''), 80); v_day date; v_alter bigint; v_del timestamptz; v_can boolean; lk date;
begin
  if auth.role() <> 'service_role' and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if g is null then return jsonb_build_object('ok', true, 'state', 'held', 'why', 'no entry GUID: nothing can be ' || act || ' by it; the Day Book for its date, once uploaded, brings that day up to date', 'action', act); end if;
  select v.day, coalesce(v.alter_id, 0), v.deleted_at, v.cancelled into v_day, v_alter, v_del, v_can from tally_vouchers v where v.book_id = p_book and v.guid = g;
  if not found then
    -- 57 (the owner's decision of 06-Oct-2026): a delete or cancel of an entry never in FinCom's copy settles by itself (the line
    -- kept, with these words): nothing is removed and nothing is waited for. A later Day Book cannot undo it: an entry body
    -- that brings this GUID later is deleted (cancelled) again at once (tally_ingest_entries, 5 arguments; and 50's day release)
    -- 57 (the owner's review of 06-Oct-2026): the bound of that re-apply (tally_nothing_removed): the line's AlterID, else the
    -- book's highest AlterID received so far; null when nothing is known (then at most once)
    insert into tally_nothing_removed (book_id, guid, event, bound)
    values (p_book, g, case when p_cancel then 'cancelled' else 'deleted' end,
            coalesce(p_alter, nullif(greatest(coalesce((select c.recorder_max_alter from tally_sync_cursor c where c.book_id = p_book), 0),
                                              coalesce((select max(v.alter_id) from tally_vouchers v where v.book_id = p_book), 0)), 0)))
    on conflict (book_id, guid, event) do update set bound = greatest(tally_nothing_removed.bound, excluded.bound), settled_at = now();
    return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'action', act, 'unknown', true, 'settled', true,
      'why', 'nothing to remove: the entry is not in FinCom''s copy and no longer counts in Tally');
  end if;
  lk := tally_month_locked(p_book, array[v_day]);
  if lk is not null then
    return jsonb_build_object('ok', true, 'state', 'held', 'guid', g, 'day', v_day, 'action', act, 'locked', true, 'why', format('month locked: %s', to_char(lk, 'YYYY-MM')));
  end if;
  if p_alter is not null and p_alter < v_alter then
    return jsonb_build_object('ok', true, 'state', 'stale', 'guid', g, 'day', v_day, 'action', act, 'why', format('AlterID %s is older than the %s held: not %s', p_alter, v_alter, act));
  end if;
  if (p_cancel and v_can) or (not coalesce(p_cancel, false) and v_del is not null) then
    return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'day', v_day, 'action', act, 'already', true, 'why', 'already ' || act);
  end if;
  -- the versions first: the lines it holds now go on its current version row
  perform tally_voucher_version_lines(p_book, array[g]);
  update tally_vouchers set cancelled = case when p_cancel then true else cancelled end,
         deleted_at = case when p_cancel then deleted_at else now() end,
         alter_id = greatest(coalesce(alter_id, 0), coalesce(p_alter, 0))
   where book_id = p_book and guid = g;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = g
  on conflict (book_id, tally_guid, alter_id) do nothing;
  perform tally_voucher_version_lines(p_book, array[g]);
  perform tally_ledger_day_rebuild(p_book, array[v_day]);
  return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'day', v_day, 'action', act, 'source', src);
end $function$;
revoke all on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) to service_role;

commit;
