-- Migration 171 (12-Nov-2026, branch next-gst-share-itc; written, NOT run: the owner reads it and runs it). GST part B, in
-- SHADOW mode: the input tax credit side. Nothing reads what this keeps yet: today's engine (server/_shared/gst3b.js, in
-- the browser and in gst-run) stays in charge and nothing on screen changes.
--
-- What is kept by entry and what by month (server/gst-run/engine.js, part B):
--   by entry, in gst_share (migration 164, no change to it): the entry's own contribution to 3B table 4 (4.impG, 4.impS,
--     4.rcmIn, 4.other, 4.blocked, 4.buy: 4(A)(1) to (5) before the 2B basis, 17(5), every inward row; qty is the row's
--     ineligible credit), 3.1(d) (4.rcm31), table 5 (5.inw by the supplier's state and non-GST or not), rule 42's common
--     credit (42.common) and turnover (42.to); summed into gst_month by gst_share_month_sum as part A's sections are.
--     Beside it, here, the entry's document as the 2B matching reads it (gst_itc_doc) and its bill-wise allocations as
--     rule 37 reads them (gst_itc_bill), written in the same transaction as its shares (gst_share_put_itc).
--   by month (worked out by gst-run, not stored by entry): the 2B matching, IMS and the ITC decisions, rules 37, 42 and
--     43, the figures typed or filed, and the credit carried and its set-off, by today's engine on the month's sums, the
--     documents and allocations kept, the client's work and the credit the month before carried out, kept in order in
--     gst_itc_month on the version of the inputs (gst_calc_version, migration 153).
--
--   gst_itc_doc          one row per entry that has a document of the 2B matching (purchases, expenses with input tax,
--                        the supplier's notes, ISD credit, imports): reg the registration the document names ('' when only
--                        the book's registrations can say), doc the document (GST2B.docOf's row, with imp). RLS on;
--                        service role only.
--   gst_itc_bill         one row per bill-wise allocation of an entry (GSTF.billRecs): the ledger and the bill's name, nb
--                        (a purchase bill's New Ref, which rule 37 follows), reg (the entry's registration), the amount
--                        and day, rec (the record as the engine reads it). RLS on; service role only.
--   gst_itc_month        one row per month and registration: the credit the month carried out (carry), its 3B as the
--                        month step worked it out (result) and as today's engine did (ref: the next month's check starts
--                        from it, not from the whole year again), on the engine and version they were worked out on, kept
--                        only when every month up to it was fresh. RLS on;
--                        members read their own firm's rows; written by the service role only.
--   gst_share_put_itc(book, run, at, shares, seen, errors, docs)   gst_share_put (164) and, once it is done, the entries'
--                        documents and allocations: each seen entry's rows deleted and the new ones put, in the same
--                        transaction (a refusal of either keeps nothing; a document that cannot be kept is its entry's
--                        error, as a share that failed, and the rest are kept)
--   gst_itc_book(book) / gst_itc_mark(book, run) / gst_itc_unmark(book)   calc_seen's row ('book', 'itc'): every entry
--                        of the book made due once since this migration (mark: under the book's lock and its lease), so
--                        each entry's documents are kept whatever was deployed first; unmark when a put of the documents
--                        was not found (a schema cache that did not know this yet)
--   gst_itc_inputs(book, reg, engine, version)   what the month step reads for a registration: the book's first and last
--                        month and its entries' GSTINs (as books() makes them), the registration's month rows (gst_month)
--                        and each month's status, the documents (that registration's and those naming none), the
--                        allocations of the bills rule 37 follows (the registration's New Refs and every allocation on
--                        the same ledger and bill), each such supplier's movement by month (tally_lines on entries not
--                        deleted, cancelled or optional: the ledger's balance as owing reads it), and the credit carried
--                        kept on this engine and version. The documents and allocations come in the book's order as
--                        gst_calc_rows (153) gives the entries (by day, then GUID), which the 2B matching keeps
--   gst_itc_month_put(...) / gst_itc_parity_put(...)   keep a month's carried credit / a check (calc_parity, calc
--                        'gst-itc', the same table as part A's 'gst-share')
--   gst_itc_ready()      true: gst-run's test that this migration is there
-- No trigger: the entries' documents follow the sweep of 164 (tally_calc_dirty and calc_seen say what is due). Add-only:
-- three new tables, new functions; nothing of any other migration dropped or altered (deletes only of its own tables'
-- rows and of its own marker row in calc_seen; gst_itc_mark makes a book's entries due, as 164's functions do); safe
-- to run twice. Needs migration 164 (gst_share_put, gst_month, calc_parity) and 153
-- (gst_calc_version); stops and says so otherwise. A book deleted takes every row of these tables with it (on delete
-- cascade). Either order of deploying works: gst-run sweeps a book's entries again once it finds this migration there
-- and the book not marked (gst_itc_mark).
-- Tested by tests/run_migration164.py (section 9, pg_stand), tests/run_gst_share.js (the month step on made-up books)
-- and tests/run_gst_share_deno.ts (gst-run's actions).

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.gst_share_put(uuid, text, timestamptz, jsonb, jsonb, jsonb)') is null or to_regclass('public.gst_month') is null
     or to_regclass('public.calc_parity') is null or to_regprocedure('public.gst_calc_version(uuid, text)') is null then
    raise exception 'migration 171 needs migration 164 (gst_share_put, gst_month, calc_parity) and 153 (gst_calc_version) first';
  end if;
end $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.gst_itc_doc (
  book_id   uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id   uuid not null,
  guid      text not null,
  ym        text not null check (ym ~ '^\d{6}$'),
  reg       text not null default '',
  doc       jsonb not null,
  primary key (book_id, guid)
);
create index if not exists gst_itc_doc_reg on public.gst_itc_doc (book_id, reg);

create table if not exists public.gst_itc_bill (
  book_id   uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id   uuid not null,
  guid      text not null,
  seq       integer not null,
  ledger    text not null,
  name      text not null,
  nb        boolean not null default false,
  reg       text not null default '',
  amount    numeric(20, 2) not null default 0,
  day       text not null default '',
  rec       jsonb not null,
  primary key (book_id, guid, seq)
);
create index if not exists gst_itc_bill_ref on public.gst_itc_bill (book_id, ledger, name);
create index if not exists gst_itc_bill_nb on public.gst_itc_bill (book_id, reg) where nb;

create table if not exists public.gst_itc_month (
  book_id   uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id   uuid not null,
  ym        text not null check (ym ~ '^\d{6}$'),
  reg       text not null,
  engine    text not null default '',
  version   text not null default '',
  carry     jsonb not null default '{}'::jsonb,
  result    jsonb,
  ref       jsonb,
  at        timestamptz not null default now(),
  primary key (book_id, ym, reg)
);

alter table public.gst_itc_doc enable row level security;
alter table public.gst_itc_bill enable row level security;
alter table public.gst_itc_month enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_itc_month' and policyname = 'gst_itc_month_read') then
    create policy gst_itc_month_read on public.gst_itc_month for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;
revoke all on public.gst_itc_doc, public.gst_itc_bill, public.gst_itc_month from public, anon, authenticated;
grant select on public.gst_itc_month to authenticated;
grant select, insert, update, delete on public.gst_itc_doc, public.gst_itc_bill, public.gst_itc_month to service_role;

-- ---------------------------------------------------------------- the sweep's put, with the documents
-- docs: [{guid, ym, doc_reg, bill_reg, doc, bills: [{l, name, amt, date, nb, reg, ...}]}], one an entry (engine.js itcRow);
-- every guid one of seen's. gst_share_put first (the book's lock, the lease, the shares, the months summed); then each
-- seen entry's documents and allocations made again (an entry with none now, deleted or gone: none kept)
create or replace function public.gst_share_put_itc(p_book uuid, p_run text, p_at timestamptz, p_shares jsonb, p_seen jsonb, p_errors jsonb, p_docs jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; seen text[]; r jsonb; n_d int; n_b int; docs jsonb := coalesce(p_docs, '[]'::jsonb); bad jsonb;
begin
  if jsonb_typeof(docs) is distinct from 'array' or jsonb_typeof(p_seen) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'docs and seen are lists');
  end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into seen from jsonb_array_elements(p_seen) x where coalesce(x->>'guid', '') <> '';
  if exists (select 1 from jsonb_array_elements(docs) x where coalesce(x->>'guid', '') = '' or not coalesce((x->>'guid') = any(seen), false)) then
    return jsonb_build_object('ok', false, 'error', 'a document of an entry not seen (or with no GUID)');
  end if;
  -- (review of 8ba35788d, L5) a document that cannot be kept (no month of six digits, allocations not a list) is its
  -- entry's error, as part A keeps an entry whose share failed; the rest of the batch is kept
  select coalesce(jsonb_agg(jsonb_build_object('guid', x->>'guid', 'error', 'its document could not be kept: month ' || coalesce(x->>'ym', 'none'))), '[]'::jsonb) into bad
    from jsonb_array_elements(docs) x where coalesce(x->>'ym', '') !~ '^\d{6}$' or (x ? 'bills' and jsonb_typeof(x->'bills') is distinct from 'array');
  if jsonb_array_length(bad) > 0 then
    docs := coalesce((select jsonb_agg(x) from jsonb_array_elements(docs) x where coalesce(x->>'ym', '') ~ '^\d{6}$' and not (x ? 'bills' and jsonb_typeof(x->'bills') is distinct from 'array')), '[]'::jsonb);
  end if;
  r := gst_share_put(p_book, p_run, p_at, p_shares, p_seen, coalesce(p_errors, '[]'::jsonb) || bad);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  select firm_id into f from tally_books where book_id = p_book;
  delete from gst_itc_doc d where d.book_id = p_book and d.guid = any(seen);
  delete from gst_itc_bill b where b.book_id = p_book and b.guid = any(seen);
  insert into gst_itc_doc (book_id, firm_id, guid, ym, reg, doc)
  select p_book, f, x->>'guid', x->>'ym', coalesce(x->>'doc_reg', ''), x->'doc'
    from jsonb_array_elements(docs) x where jsonb_typeof(x->'doc') = 'object';
  get diagnostics n_d = row_count;
  insert into gst_itc_bill (book_id, firm_id, guid, seq, ledger, name, nb, reg, amount, day, rec)
  select p_book, f, x->>'guid', (b.ord - 1)::int, coalesce(b.v->>'l', ''), coalesce(b.v->>'name', ''), coalesce((b.v->>'nb')::boolean, false), coalesce(b.v->>'reg', ''),
         coalesce((b.v->>'amt')::numeric, 0), coalesce(b.v->>'date', ''), b.v
    from jsonb_array_elements(docs) x cross join lateral jsonb_array_elements(coalesce(x->'bills', '[]'::jsonb)) with ordinality b(v, ord);
  get diagnostics n_b = row_count;
  return r || jsonb_build_object('docs', n_d, 'bills', n_b, 'docErrors', jsonb_array_length(bad));
end $function$;

-- ---------------------------------------------------------------- the book's entries swept with their documents
-- (review of 8ba35788d, M4) calc_seen's row ('book', 'itc') says every entry of the book was made due once with this
-- migration there, so the sweep keeps their documents: gst-run deployed before 171, or an answer of a schema cache that
-- did not know 171 yet, can never leave a book's documents empty for good. gst_itc_book: is it there; gst_itc_mark (under
-- the book's lock, while the run holds the lease): every entry due, and the row kept; gst_itc_unmark: the row taken
-- away (gst-run, when a put of the documents was not found)
create or replace function public.gst_itc_book(p_book uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (select 1 from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'itc');
$function$;

create or replace function public.gst_itc_mark(p_book uuid, p_run text)
returns jsonb language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  if not gst_share_holds(p_book, p_run) then return jsonb_build_object('ok', false, 'error', 'lease lost'); end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  update calc_seen s set due = true, due_at = now() where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and not s.due;
  get diagnostics n = row_count;
  insert into calc_seen (book_id, firm_id, calc, kind, key, stamp, at) values (p_book, f, 'gst-share', 'book', 'itc', 'docs', now())
  on conflict (book_id, calc, kind, key) do update set stamp = excluded.stamp, at = now();
  return jsonb_build_object('ok', true, 'due', n);
end $function$;

create or replace function public.gst_itc_unmark(p_book uuid)
returns boolean language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  with d as (delete from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'itc' returning 1) select count(*) > 0 from d;
$function$;

-- ---------------------------------------------------------------- the month step's inputs
create or replace function public.gst_itc_inputs(p_book uuid, p_reg text, p_engine text, p_version text)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with nb as (select distinct b.ledger, b.name from gst_itc_bill b where b.book_id = p_book and b.nb and b.reg = coalesce(p_reg, '')),
  live as (select v.guid, v.day, v.cmp_gstin, v.cancelled, v.optional, v.vno from tally_vouchers v where v.book_id = p_book and v.deleted_at is null),
  dated as (select l.day from live l where exists (select 1 from tally_lines x where x.book_id = p_book and x.guid = l.guid and coalesce(x.ledger, '') <> '')
              or (coalesce(l.cancelled, false) and coalesce(l.vno, '') <> ''))
  select jsonb_build_object(
    'first', (select to_char(min(d.day), 'YYYYMM') from dated d),
    'last', (select to_char(max(d.day), 'YYYYMM') from dated d),
    'gstins', (select coalesce(jsonb_agg(distinct upper(l.cmp_gstin)), '[]'::jsonb) from live l where coalesce(l.cmp_gstin, '') <> ''),
    'months', (select coalesce(jsonb_object_agg(q.ym, q.rows), '{}'::jsonb) from (
                 select m.ym, jsonb_agg(jsonb_build_object('reg', m.reg, 'sec', m.sec, 'k1', m.k1, 'k2', m.k2, 'k3', m.k3, 'n', m.n, 'taxable', m.taxable, 'igst', m.igst,
                          'cgst', m.cgst, 'sgst', m.sgst, 'cess', m.cess, 'qty', m.qty) order by m.sec, m.k1, m.k2, m.k3) rows
                   from gst_month m where m.book_id = p_book and m.reg = coalesce(p_reg, '') and m.sec <> '*' group by m.ym) q),
    'status', (select coalesce(jsonb_object_agg(m.ym, m.status), '{}'::jsonb) from gst_month m where m.book_id = p_book and m.reg = '' and m.sec = '*'),
    'docs', (select coalesce(jsonb_agg(jsonb_build_object('guid', d.guid, 'doc', d.doc) order by d.doc->>'bookDate', d.guid), '[]'::jsonb)
               from gst_itc_doc d where d.book_id = p_book and d.reg in (coalesce(p_reg, ''), '')),
    'bills', (select coalesce(jsonb_agg(jsonb_build_object('guid', b.guid, 'seq', b.seq, 'rec', b.rec) order by b.day, b.guid, b.seq), '[]'::jsonb)
                from gst_itc_bill b join nb on nb.ledger = b.ledger and nb.name = b.name where b.book_id = p_book),
    'moves', (select coalesce(jsonb_object_agg(z.ledger, z.ms), '{}'::jsonb) from (
                select q.ledger, jsonb_agg(jsonb_build_array(q.ym, q.amt) order by q.ym) ms from (
                  select x.ledger, to_char(l.day, 'YYYYMM') ym, sum(x.amount) amt
                    from tally_lines x join live l on l.guid = x.guid
                   where x.book_id = p_book and x.ledger in (select distinct nb.ledger from nb)
                     and not coalesce(l.cancelled, false) and not coalesce(l.optional, false)
                   group by x.ledger, to_char(l.day, 'YYYYMM')) q group by q.ledger) z),
    'carry', (select coalesce(jsonb_object_agg(c.ym, c.carry), '{}'::jsonb) from gst_itc_month c
               where c.book_id = p_book and c.reg = coalesce(p_reg, '') and c.engine = coalesce(p_engine, '') and c.version = coalesce(p_version, '') and coalesce(p_version, '') <> ''),
    'refs', (select coalesce(jsonb_object_agg(c.ym, c.ref), '{}'::jsonb) from gst_itc_month c
               where c.book_id = p_book and c.reg = coalesce(p_reg, '') and c.engine = coalesce(p_engine, '') and c.version = coalesce(p_version, '') and coalesce(p_version, '') <> '' and c.ref is not null));
$function$;

create or replace function public.gst_itc_month_put(p_book uuid, p_ym text, p_reg text, p_engine text, p_version text, p_carry jsonb, p_result jsonb, p_ref jsonb)
returns boolean language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null or coalesce(p_ym, '') !~ '^\d{6}$' or coalesce(p_reg, '') !~ '^\d{2}$' or jsonb_typeof(p_carry) is distinct from 'object' then return false; end if;
  insert into gst_itc_month (book_id, firm_id, ym, reg, engine, version, carry, result, ref, at)
  values (p_book, f, p_ym, p_reg, coalesce(p_engine, ''), coalesce(p_version, ''), p_carry, p_result, p_ref, now())
  on conflict (book_id, ym, reg) do update set engine = excluded.engine, version = excluded.version, carry = excluded.carry, result = excluded.result, ref = excluded.ref, at = now();
  return true;
end $function$;

create or replace function public.gst_itc_parity_put(p_book uuid, p_ym text, p_reg text, p_engine text, p_ok boolean, p_max numeric, p_diffs jsonb, p_notes jsonb)
returns bigint language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; i bigint;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null or coalesce(p_ym, '') !~ '^\d{6}$' then return null; end if;
  insert into calc_parity (book_id, firm_id, calc, ym, reg, engine, ok, max_diff, diffs, notes)
  values (p_book, f, 'gst-itc', p_ym, coalesce(p_reg, ''), coalesce(p_engine, ''), p_ok, coalesce(p_max, 0),
          coalesce(p_diffs, '[]'::jsonb), coalesce(p_notes, '{}'::jsonb))
  returning id into i;
  return i;
end $function$;

create or replace function public.gst_itc_ready()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$ select true; $function$;

revoke all on function public.gst_share_put_itc(uuid, text, timestamptz, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gst_share_put_itc(uuid, text, timestamptz, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.gst_itc_inputs(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.gst_itc_inputs(uuid, text, text, text) to service_role;
revoke all on function public.gst_itc_month_put(uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gst_itc_month_put(uuid, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.gst_itc_book(uuid) from public, anon, authenticated;
grant execute on function public.gst_itc_book(uuid) to service_role;
revoke all on function public.gst_itc_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_itc_mark(uuid, text) to service_role;
revoke all on function public.gst_itc_unmark(uuid) from public, anon, authenticated;
grant execute on function public.gst_itc_unmark(uuid) to service_role;
revoke all on function public.gst_itc_parity_put(uuid, text, text, text, boolean, numeric, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gst_itc_parity_put(uuid, text, text, text, boolean, numeric, jsonb, jsonb) to service_role;
revoke all on function public.gst_itc_ready() from public, anon, authenticated;
grant execute on function public.gst_itc_ready() to service_role;

commit;
