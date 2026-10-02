-- Ledger names with line breaks, 02-Oct-2026. Tally keeps some ledger masters with line breaks in the name
-- ("MCS Project Pvt Ltd\r\n", "RAKVIK TECHNOLOGIES PRIVATE LIMITED\r\n\r\n") while the day book names them without. The
-- trial balance showed each as two ledgers: the master with its group and opening, and its entries with no master
-- (out by Rs 38,200 against Tally's). Now both meet on the name without line breaks. Replaces two functions; adds one.
-- Nothing is dropped or deleted; the masters keep their names as Tally sends them.

begin;

create or replace function public.tally_nm(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '(&#13;|&#10;|\r|\n)+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.tally_tb(p_client text, p_as_on date)
returns table (ledger text, parent text, open numeric, movement numeric, closing numeric)
language plpgsql stable security definer set search_path = public as $$
declare bk uuid := tally_pick(p_client, p_as_on); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
    with lg as (select tally_nm(t.name) as name, max(t.parent) as parent, sum(t.open) as open from tally_ledgers t
                 where t.book_id = bk and t.merged_into is null group by 1),
    mv as (select tally_nm(d.ledger) as ledger, sum(d.amount) m from tally_ledger_day d where d.book_id = bk and d.day between b.from_date and p_as_on group by 1)
    select coalesce(lg.name, mv.ledger), coalesce(lg.parent, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.ledger = lg.name;
end $$;

create or replace function public.tally_ledger(p_client text, p_ledger text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype; ob numeric; lines jsonb; nm text := tally_nm(p_ledger);
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  select coalesce((select sum(t.open) from tally_ledgers t where t.book_id = bk and t.merged_into is null and tally_nm(t.name) = nm), 0)
       + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and tally_nm(d.ledger) = nm and d.day >= b.from_date and d.day < p_from), 0)
    into ob;
  select coalesce(jsonb_agg(jsonb_build_array(to_char(l.day, 'YYYYMMDD'), v.vtype, v.vno, v.party, v.narration, l.amount, l.guid) order by l.day, v.vno), '[]'::jsonb)
    into lines
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = bk and tally_nm(l.ledger) = nm and l.day between greatest(p_from, b.from_date) and p_to and not v.cancelled and not v.optional;
  return jsonb_build_object('open', ob, 'lines', lines, 'from', b.from_date, 'company', b.company, 'daysAt', b.days_at);
end $$;

revoke execute on function public.tally_tb(text, date), public.tally_ledger(text, text, date, date) from public, anon;
grant execute on function public.tally_tb(text, date), public.tally_ledger(text, text, date, date) to authenticated;

commit;
