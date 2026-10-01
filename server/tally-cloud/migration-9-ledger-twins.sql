-- Cloud copy of the books, review of 01-Oct-2026: one Tally ledger kept twice. A ledger whose name in Tally ends in a
-- line break ("MCS Project Pvt Ltd" + CR LF) came once from a trial balance file, with the break written as text
-- ("MCS Project Pvt Ltd&#13;&#10;": the opening balance, no group), and once from the bridge, with the break itself
-- (the group, no opening). Adds only: a column naming the ledger a twin is counted in. Nothing is deleted; the twin
-- keeps what was sent (open_sent) and opens at nil, and its opening is counted in the ledger it is a twin of.
--
--   tally_ledgers + merged_into    the ledger this one is counted in (null: itself)
--   tally_ledger_key(name)         the name without line breaks (as text or as such) and extra spaces
--   tally_year_openings(book)      as migration-8, and first: ledgers with the same key are found; one with a group
--                                  (else the one named exactly as the key) is the ledger, the others its twins

begin;

alter table public.tally_ledgers add column if not exists merged_into text;

create or replace function public.tally_ledger_key(p text)
returns text language sql immutable set search_path to 'public' as $function$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '(&#13;|&#10;|\r|\n)+', ' ', 'g'), '\s+', ' ', 'g'))
$function$;

create or replace function public.tally_year_openings(p_book uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; fd date; moved numeric := 0; n int := 0; twins int := 0;
  pl constant text[] := array['Sales Accounts', 'Purchase Accounts', 'Direct Incomes', 'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses'];
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id, from_date into f, fd from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  update tally_ledgers set open_sent = open where book_id = p_book and open_sent is null;
  -- twins: the same name but for line breaks and spaces
  with k as (
    select name, parent, tally_ledger_key(name) as key,
           row_number() over (partition by tally_ledger_key(name) order by (parent <> '') desc, (name = tally_ledger_key(name)) desc, name) as rn,
           count(*) over (partition by tally_ledger_key(name)) as c
      from tally_ledgers where book_id = p_book
  ), head as (select key, name from k where rn = 1 and c > 1)
  update tally_ledgers l set merged_into = case when l.name = h.name then null else h.name end
    from head h where l.book_id = p_book and tally_ledger_key(l.name) = h.key and l.merged_into is distinct from (case when l.name = h.name then null else h.name end);
  get diagnostics twins = row_count;
  update tally_ledgers l set open = case when l.merged_into is null then l.open_sent else 0 end where l.book_id = p_book;
  update tally_ledgers l set open = l.open + s.x
    from (select merged_into, sum(open_sent) x from tally_ledgers where book_id = p_book and merged_into is not null group by merged_into) s
   where l.book_id = p_book and l.name = s.merged_into;
  if fd is null or to_char(fd, 'MM-DD') <> '04-01' then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  select coalesce(sum(open), 0), count(*) into moved, n
    from tally_ledgers where book_id = p_book and merged_into is null and primary_group = any(pl) and open <> 0;
  if n = 0 then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  update tally_ledgers set open = 0 where book_id = p_book and merged_into is null and primary_group = any(pl) and open <> 0;
  insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent) values (p_book, f, 'Profit & Loss A/c', '', moved, 0)
  on conflict (book_id, name) do update set open = tally_ledgers.open + excluded.open;
  return jsonb_build_object('ok', true, 'moved', moved, 'ledgers', n, 'twins', twins);
end $function$;
revoke all on function public.tally_year_openings(uuid) from public, anon, authenticated;
grant execute on function public.tally_year_openings(uuid) to service_role;

commit;
