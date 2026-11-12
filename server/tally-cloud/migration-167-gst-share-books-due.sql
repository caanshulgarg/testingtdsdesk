-- Migration 167 (12-Nov-2026, branch next-gst-share): gst_share_books_due (migration 164) also picks a book that has an
-- entry never worked out. In 164 a book with no dirty day and nothing due was picked for its first fill only while its
-- ledger context (calc_seen 'book'/'ctx') was missing. On staging five books had their context saved by runs that then
-- stopped at the statement timeout (fixed in 165/166), so their entries were never picked. Now a book is also due while
-- any of its entries has no calc_seen row (index lookup on calc_seen's key; stops at the first one).
-- Replaces only this function. Same signature, same grants.
begin;

create or replace function public.gst_share_books_due(p_n integer default 3)
returns table (book_id uuid) language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select b.book_id from tally_books b
   cross join lateral (select min(d.changed_at) w from tally_calc_dirty d
                         left join calc_seen s on s.book_id = d.book_id and s.calc = 'gst-share' and s.kind = 'day' and s.key = d.day::text
                        where d.book_id = b.book_id and s.stamp is distinct from d.changed_at::text) dd
   where b.client_id is not null
     and (dd.w is not null
          or exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.due)
          or (not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx')
              and exists (select 1 from tally_vouchers v where v.book_id = b.book_id))
          or exists (select 1 from tally_vouchers v where v.book_id = b.book_id
                      and not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid)))
     and not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book'
                      and s.key in ('lease', 'backoff:ctx') and (s.data->>'until')::timestamptz > clock_timestamp())
   order by dd.w nulls last, b.book_id
   limit greatest(1, least(coalesce(p_n, 3), 5));
$function$;

revoke all on function public.gst_share_books_due(integer) from public, anon, authenticated;
grant execute on function public.gst_share_books_due(integer) to service_role;

commit;
