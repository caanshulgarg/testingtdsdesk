-- Look up and Reports answered by the cloud for every client (build 192): the browser asks for the answer, not the books.
-- Both run as the signed-in person: tally_pick keeps them to their own firm's books.

-- each ledger over a period: its balance the day before (Tally's sign: a credit positive), debits and credits in it
create or replace function public.tally_period(p_client text, p_from date, p_to date)
returns table(ledger text, parent text, open numeric, dr numeric, cr numeric)
language plpgsql stable security definer set search_path = public as $$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
  with names as (select l.name as n from tally_ledgers l where l.book_id = bk union select d.ledger from tally_ledger_day d where d.book_id = bk),
  before as (select d.ledger as n, sum(d.amount) as a from tally_ledger_day d where d.book_id = bk and d.day >= b.from_date and d.day < p_from group by d.ledger),
  inside as (select d.ledger as n, sum(d.dr) as dr, sum(d.cr) as cr from tally_ledger_day d where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by d.ledger)
  select x.n, t.parent, coalesce(t.open, 0) + coalesce(be.a, 0), coalesce(i.dr, 0), coalesce(i.cr, 0)
    from names x left join tally_ledgers t on t.book_id = bk and t.name = x.n left join before be on be.n = x.n left join inside i on i.n = x.n
   order by x.n;
end $$;

-- any entry: words (all of them, in the party, narration, number, type or a ledger), or an amount; a page at a time
create or replace function public.tally_find(p_client text, p_q text, p_from date, p_to date, p_type text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare bk uuid := tally_pick(p_client, p_from); words text[]; amt numeric; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  if regexp_replace(coalesce(p_q, ''), '[₹,\s]', '', 'g') ~ '^\d+(\.\d+)?$' then amt := regexp_replace(p_q, '[₹,\s]', '', 'g')::numeric;
  else words := array_remove(string_to_array(lower(trim(coalesce(p_q, ''))), ' '), ''); end if;
  with hit as (
    select v.guid, v.day, v.vtype, v.vno, v.party, v.narration,
           (select coalesce(sum(l.amount) filter (where l.amount > 0), 0) from tally_lines l where l.book_id = bk and l.guid = v.guid) as tot,
           (select jsonb_agg(jsonb_build_array(l.ledger, l.amount)) from tally_lines l where l.book_id = bk and l.guid = v.guid) as ent
      from tally_vouchers v
     where v.book_id = bk and v.day between p_from and p_to and not v.cancelled
       and (p_type is null or p_type = '' or v.vtype = p_type)
       and (case when amt is not null then exists (select 1 from tally_lines l where l.book_id = bk and l.guid = v.guid and abs(abs(l.amount) - amt) < 1)
                 when coalesce(array_length(words, 1), 0) = 0 then true
                 else (select bool_and(position(w in lower(concat_ws(' ', v.party, v.narration, v.vno, v.vtype,
                          (select string_agg(l.ledger, ' ') from tally_lines l where l.book_id = bk and l.guid = v.guid)))) > 0) from unnest(words) w) end)
  )
  select jsonb_build_object('n', (select count(*) from hit), 'total', (select coalesce(sum(tot), 0) from hit),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(to_char(h.day, 'YYYYMMDD'), h.vtype, h.vno, h.party, h.narration, h.tot, h.guid, h.ent) order by h.day, h.vno, h.guid)
                        from (select * from hit order by day, vno, guid limit greatest(1, least(coalesce(p_limit, 500), 5000)) offset greatest(0, coalesce(p_offset, 0))) h), '[]'::jsonb))
    into res;
  return res;
end $$;

revoke all on function public.tally_period(text, date, date), public.tally_find(text, text, date, date, text, integer, integer) from public, anon;
grant execute on function public.tally_period(text, date, date), public.tally_find(text, text, date, date, text, integer, integer) to authenticated;
