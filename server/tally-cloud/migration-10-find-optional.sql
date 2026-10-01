-- Cloud copy of the books, review of 01-Oct-2026: Look up's search (tally_find) listed Optional entries without saying
-- so and counted them in its total. An Optional entry is not in Tally's books (no balance counts it), e.g. a payroll
-- kept as Optional: the search still lists it (it can be looked for), now marked, and the total leaves it out.
-- Only the function changes; no table, no data. Each row gets a ninth element, true for an Optional entry, and the
-- answer an "opt" count.

create or replace function public.tally_find(p_client text, p_q text, p_from date, p_to date, p_type text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare bk uuid := tally_pick(p_client, p_from); words text[]; amt numeric; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  if regexp_replace(coalesce(p_q, ''), '[₹,\s]', '', 'g') ~ '^\d+(\.\d+)?$' then amt := regexp_replace(p_q, '[₹,\s]', '', 'g')::numeric;
  else words := array_remove(string_to_array(lower(trim(coalesce(p_q, ''))), ' '), ''); end if;
  with hit as (
    select v.guid, v.day, v.vtype, v.vno, v.party, v.narration, v.optional,
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
  select jsonb_build_object('n', (select count(*) from hit), 'total', (select coalesce(sum(tot) filter (where not optional), 0) from hit),
    'opt', (select count(*) filter (where optional) from hit),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(to_char(h.day, 'YYYYMMDD'), h.vtype, h.vno, h.party, h.narration, h.tot, h.guid, h.ent, h.optional) order by h.day, h.vno, h.guid)
                        from (select * from hit order by day, vno, guid limit greatest(1, least(coalesce(p_limit, 500), 5000)) offset greatest(0, coalesce(p_offset, 0))) h), '[]'::jsonb))
    into res;
  return res;
end $function$;
