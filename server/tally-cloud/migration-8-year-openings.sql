-- Cloud copy of the books, review of 01-Oct-2026 (owner's go-ahead): at the start of a financial year, income and
-- expense ledgers open at nil and their total goes to Profit & Loss A/c, as Tally does. Openings sent from a trial
-- balance as on the day before the year (31 March) still carried last year's income and expenses.
-- Adds only: a column keeping each opening exactly as it was sent (open_sent), and a function that works the year's
-- openings out from it again whenever the ledgers or the groups change. Nothing is dropped; what was sent is kept.
--
--   tally_ledgers + open_sent      the opening as the bridge or the file sent it
--   tally_year_openings(book)      open = open_sent, except: when the book starts on 1 April, a ledger whose primary
--                                  group is Sales Accounts, Purchase Accounts, Direct or Indirect Incomes or Expenses
--                                  opens at nil, and their total is added to Profit & Loss A/c (made if missing)
--   tally_ingest_ledgers_g         as migration-6, then tally_year_openings

begin;

alter table public.tally_ledgers add column if not exists open_sent numeric(18,2);

create or replace function public.tally_year_openings(p_book uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; fd date; moved numeric := 0; n int := 0;
  pl constant text[] := array['Sales Accounts', 'Purchase Accounts', 'Direct Incomes', 'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses'];
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id, from_date into f, fd from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  -- what was sent is kept once; every turn starts again from it
  update tally_ledgers set open_sent = open where book_id = p_book and open_sent is null;
  update tally_ledgers set open = open_sent where book_id = p_book and open is distinct from open_sent;
  if fd is null or to_char(fd, 'MM-DD') <> '04-01' then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0); end if;
  select coalesce(sum(open_sent), 0), count(*) into moved, n
    from tally_ledgers where book_id = p_book and primary_group = any(pl) and open_sent <> 0;
  if n = 0 then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0); end if;
  update tally_ledgers set open = 0 where book_id = p_book and primary_group = any(pl) and open <> 0;
  insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent) values (p_book, f, 'Profit & Loss A/c', '', moved, 0)
  on conflict (book_id, name) do update set open = coalesce(tally_ledgers.open_sent, 0) + excluded.open;
  return jsonb_build_object('ok', true, 'moved', moved, 'ledgers', n);
end $function$;
revoke all on function public.tally_year_openings(uuid) from public, anon, authenticated;
grant execute on function public.tally_year_openings(uuid) to service_role;

create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; n_groups int := 0; yo jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  perform public.tally_ingest_ledgers(p_book, p_from, p_open_as_on, p_ledgers);
  if jsonb_array_length(coalesce(p_groups, '[]'::jsonb)) > 0 then
    delete from tally_groups where book_id = p_book;
    insert into tally_groups (book_id, firm_id, name, parent)
    select distinct on (x->>0) p_book, f, x->>0, coalesce(x->>1, '') from jsonb_array_elements(p_groups) x where coalesce(x->>0, '') <> ''
    on conflict (book_id, name) do update set parent = excluded.parent;
    get diagnostics n_groups = row_count;
  end if;
  with recursive up as (
    select l.name as ledger, l.parent as grp, 1 as depth, array[l.parent] as chain
      from tally_ledgers l where l.book_id = p_book and l.parent <> ''
    union all
    select u.ledger, g.parent, u.depth + 1, u.chain || g.parent
      from up u join tally_groups g on g.book_id = p_book and g.name = u.grp
     where g.parent <> '' and u.depth < 30 and not (g.parent = any(u.chain))
  ), best as (
    select distinct on (ledger) ledger, chain from up order by ledger, depth desc
  )
  update tally_ledgers l set chain = b.chain, primary_group = b.chain[array_length(b.chain, 1)]
    from best b where l.book_id = p_book and l.name = b.ledger;
  yo := public.tally_year_openings(p_book);
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(p_ledgers), 'groups', n_groups, 'yearOpenings', yo);
end $function$;

commit;
