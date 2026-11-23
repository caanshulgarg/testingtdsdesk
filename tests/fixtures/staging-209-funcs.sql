-- The four functions migration 209 touches, as staging has them NOW: pg_get_functiondef, read-only from staging on
-- 23-Nov-2026. Code only (no row of any table). tests/run_migration209.py loads these before 209, not migration.sql's text.

-- gst_share_books_due(integer)
CREATE OR REPLACE FUNCTION public.gst_share_books_due(p_n integer DEFAULT 3)
 RETURNS TABLE(book_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 204: the books with an entry gst-share has not seen, found once for every book by one anti-join (before: one probe of
  -- calc_seen per entry of every book, every minute); the same books, in the same order
  with unseen as materialized (
    select distinct v.book_id from tally_vouchers v
     where not exists (select 1 from calc_seen s where s.book_id = v.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid))
  select b.book_id from tally_books b
   cross join lateral (select min(d.changed_at) w from tally_calc_dirty d
                         left join calc_seen s on s.book_id = d.book_id and s.calc = 'gst-share' and s.kind = 'day' and s.key = d.day::text
                        where d.book_id = b.book_id and s.stamp is distinct from d.changed_at::text) dd
   where b.client_id is not null
     and (dd.w is not null
          or exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.due)
          or (not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx')
              and exists (select 1 from tally_vouchers v where v.book_id = b.book_id))
          or b.book_id in (select u.book_id from unseen u)
          -- 170: the context made by another engine than the one gst-run runs now
          or exists (select 1 from calc_seen s join gst_share_engine e on e.one
                      where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx'
                        and s.data->>'engine' is distinct from e.engine))
     and not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book'
                      and s.key in ('lease', 'backoff:ctx') and (s.data->>'until')::timestamptz > clock_timestamp())
   order by dd.w nulls last, b.book_id
   limit greatest(1, least(coalesce(p_n, 3), 5));
$function$;

-- tally_monthly(text,date,date)
CREATE OR REPLACE FUNCTION public.tally_monthly(p_client text, p_from date, p_to date)
 RETURNS TABLE(ledger text, ym text, amount numeric, dr numeric, cr numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query select d.ledger, to_char(d.day, 'YYYYMM'), sum(d.amount), sum(d.dr), sum(d.cr) from tally_ledger_day d
    where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by d.ledger, to_char(d.day, 'YYYYMM') order by 1, 2;
end $function$;

-- tally_post_own_words(uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.tally_post_own_words(p_firm uuid, p_company text, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with own as (select tally_bridge_words(d.id, k.key) as w, tally_bridge_may_post(d.id, k.key) as may, tally_bridge_has_open(d.id, k.key, p_company) as has
                 from tally_devices d, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
                where d.firm_id = p_firm and not coalesce(d.revoked, false) and tally_bridge_is_own(p_firm, p_user, d.id, k.key))
  select 'Nobody can post into ' || p_company || ' from your sign-in just now: '
      || case when not exists (select 1 from own)
                then 'FinCom has not heard from a FinCom Bridge of yours. Install FinCom Bridge on the computer where you use Tally, as your own Windows user ("Just for me"), and connect it to FinCom; then open '
                     || p_company || ' in Tally there and post again.'
              when exists (select 1 from own where has)
                then 'your FinCom Bridge (' || (select string_agg(distinct w, ', ') from own where has) || ') has it open but is set to Changes only or only reads Tally. '
                     || 'Ask the firm''s owner to switch Changes only off for it (Tally page), then post again.'
              else 'your FinCom Bridge (' || coalesce((select string_agg(distinct w, ', ') from own where may), (select string_agg(distinct w, ', ') from own)) || ') does not have '
                     || p_company || ' open in Tally. Open ' || p_company || ' in Tally there, then post again.' end
$function$;

-- tally_tb(text,date)
CREATE OR REPLACE FUNCTION public.tally_tb(p_client text, p_as_on date)
 RETURNS TABLE(ledger text, parent text, open numeric, movement numeric, closing numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare bk uuid := tally_pick(p_client, p_as_on); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
    with lg as (select tally_nm(t.name) as name, max(t.parent) as parent, sum(t.open) as open from tally_ledgers t
                 where t.book_id = bk and t.merged_into is null group by 1),
    mv as (select tally_nm(d.ledger) as ledger, sum(d.amount) m from tally_ledger_day d where d.book_id = bk and d.merged_into is null and d.day between b.from_date and p_as_on group by 1)
    select coalesce(lg.name, mv.ledger), coalesce(lg.parent, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.ledger = lg.name;
end $function$;
