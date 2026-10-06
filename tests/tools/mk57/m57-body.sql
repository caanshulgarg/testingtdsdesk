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

-- the owner's review and re-review M-B of 06-Oct-2026: a delete or cancel settled as "nothing to remove" (the entry never in
-- the copy) is recorded here (bound: its own AlterID when it had one). A delete without an AlterID is applied again to any
-- later body; a cancel without one up to Tally's voucher counter the bridge sent on the line (vchCounter), else at most once
-- (reapplied). Written by tally_ingest_delete / tally_ingest_entries only (no member, no anon)
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
