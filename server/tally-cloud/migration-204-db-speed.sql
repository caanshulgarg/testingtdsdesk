-- Migration 204 (21-Nov-2026, branch next-fix-dbspeed; written, NOT run: the owner reads it and runs it). After 203 or
-- before it: it needs nothing of 199-203. The owner: "make the database fast ... the effect should remain the same".
-- What staging's pg_stat_statements showed heaviest (21-Nov-2026), and what this file does about each, every answer the
-- same as before (tests/run_migration204.py: the md5 of each answer before and after, on staging's tables with made-up
-- books of staging's size):
--
--   1. the gst-share-sweep job (every minute, 315 ms each): gst_share_books_due looked up calc_seen once per entry of every
--      book (31,736 probes, 280 ms) to find a book with an entry not seen. Now the books with an unseen entry are found
--      once, by one anti-join over every book; the rest of the function as it was.
--   2. the tally-post-register-settle job (every 10 minutes, 2.6 s each): tally_post_register_settle_book's second look,
--      by the add-on's remote GUID, read every recorder line of the book for each open register row (97% of its time).
--      Now an index on that GUID (made CONCURRENTLY, after the transaction), and statistics on the test that picks those
--      lines, so the planner sees how few there are and takes the index. The function is not touched.
--   3. tally_unknown_ledger_entries (484 ms): looked up each line's ledger name (39,704 look-ups for one book); a line's
--      ledger is unknown by its book and name alone, so each distinct name is looked up once now.
--   4. gst_calc_rows (596 ms) and gst_share_rows (535 ms): built as json and made jsonb once at the end; the same value.
--
-- No table, nothing dropped, no row changed (ANALYZE only refreshes the planner's statistics).
-- How to apply (two steps, in this order):
--   1. this file through the Management API, as one query (it is one transaction: functions, statistics, policies,
--      grants; lock_timeout 3 s; safe twice):            sbq.sh server/tally-cloud/migration-204-db-speed.sql
--   2. its indexes, one statement per call, each checked valid (an invalid one left by a build cut off is dropped and
--      built again, up to 3 tries; exit 1 if one stays invalid):
--        python3 tools/apply_concurrent_indexes.py --run "sbq.sh" server/tally-cloud/migration-204-indexes.sql
--      The ANALYZE of tally_recorder_lines is that file's last line: the script runs it after the index is valid.
--      A CONCURRENTLY build cannot share a call with "set lock_timeout" (a query of several statements is a
--      transaction block), so it runs under the session's own timeouts (on staging, read 21-Nov-2026: lock_timeout 0,
--      statement_timeout 2 min); it does not block reads or writes of the table while it builds.

begin;
set local lock_timeout = '3s';

create or replace function public.gst_share_books_due(p_n integer default 3)
 returns table(book_id uuid)
 language sql stable security definer set search_path = public, pg_temp
as $function$
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
revoke all on function public.gst_share_books_due(integer) from public, anon, authenticated;
grant execute on function public.gst_share_books_due(integer) to service_role;

create or replace function public.tally_unknown_ledger_entries(p_book uuid)
 returns table(book_id uuid, client_id text, guid text, vtype text, vno text, day date, ledgers text[])
 language plpgsql stable security definer set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare f uuid := my_firm(); svc boolean := tally_service_or_owner();
begin
  if f is null and not svc then raise exception 'not allowed' using errcode = '42501'; end if;
  if svc and f is null and p_book is null then raise exception 'which book?'; end if;
  -- 204: a line's ledger is unknown by its book and name alone, so each distinct name of a book is looked up once (before:
  -- once per line); the same entries, in the same order
  return query
    with bk as (select b.book_id, b.client_id from tally_books b
                 where (p_book is null or b.book_id = p_book) and (b.firm_id = f or (svc and f is null))),
    unk as materialized (
      select n.book_id, n.ledger from (select distinct l.book_id, l.ledger from bk join tally_lines l on l.book_id = bk.book_id
                                         where btrim(coalesce(l.ledger, '')) <> '') n
       where not exists (select 1 from tally_ledgers t where t.book_id = n.book_id and tally_nm(t.name) = n.ledger and t.deleted_at is null))
    select bk.book_id, bk.client_id, v.guid, v.vtype, v.vno, v.day, array_agg(distinct l.ledger order by l.ledger)
      from unk u
      join bk on bk.book_id = u.book_id
      join tally_lines l on l.book_id = u.book_id and l.ledger = u.ledger
      join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid and v.deleted_at is null
     group by bk.book_id, bk.client_id, v.guid, v.vtype, v.vno, v.day
     order by v.day desc, v.vno, v.guid
     limit 500;
end $function$;
revoke all on function public.tally_unknown_ledger_entries(uuid) from public, anon, authenticated;
grant execute on function public.tally_unknown_ledger_entries(uuid) to authenticated, service_role;

create or replace function public.gst_calc_rows(p_book uuid)
 returns jsonb
 language sql stable security definer set search_path = public, pg_temp
as $function$
  -- 204: built as json and made jsonb once at the end (before: jsonb at every step, each array taken apart and built again
  -- by the next); the same value
  with led as (select x.ledger, (row_number() over (order by x.ledger)) - 1 as i
                 from (select l.ledger from tally_lines l where l.book_id = p_book union select b.ledger from tally_bills b where b.book_id = p_book) x where x.ledger is not null),
  ln as (select l.guid, json_agg(json_build_array(d.i, l.amount, l.hsn, l.rate) order by l.id) a
           from tally_lines l join led d on d.ledger = l.ledger where l.book_id = p_book group by l.guid),
  bl as (select b.guid, json_agg(json_build_array(d.i, b.name, b.type, b.amount, b.credit_days) order by b.id) a
           from tally_bills b join led d on d.ledger = b.ledger where b.book_id = p_book group by b.guid)
  select json_build_object(
    'ledgers', (select coalesce(json_agg(led.ledger order by led.i), '[]'::json) from led),
    'heads', (select coalesce(json_agg(json_build_array(v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.narration, v.cancelled, v.optional, v.deleted_at,
                v.gstin, v.pos, v.ref, v.ref_date, v.cmp_gstin, v.irn, v.irn_ack_date, v.gst_reg_type, v.gst_country, v.gst_rcm, v.gst_nature, v.gst_taxability,
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id, coalesce(ln.a, '[]'::json), coalesce(bl.a, '[]'::json)) order by v.day, v.guid), '[]'::json)
                from tally_vouchers v left join ln on ln.guid = v.guid left join bl on bl.guid = v.guid where v.book_id = p_book))::jsonb;
$function$;
revoke all on function public.gst_calc_rows(uuid) from public, anon, authenticated;
grant execute on function public.gst_calc_rows(uuid) to service_role;

create or replace function public.gst_share_rows(p_book uuid, p_guids text[])
 returns jsonb
 language sql stable security definer set search_path = public, pg_temp
as $function$
  -- 204: built as json and made jsonb once at the end (before: jsonb at every step); the same value
  with led as materialized (select y.ledger, (row_number() over (order by y.ledger)) - 1 as i
            from (select l.ledger from tally_lines l where l.book_id = p_book and l.guid = any(p_guids)
                  union select b.ledger from tally_bills b where b.book_id = p_book and b.guid = any(p_guids)) y where y.ledger is not null),
  m as materialized (select coalesce(jsonb_object_agg(ledger, i), '{}'::jsonb) o from led)
  select json_build_object(
    'ledgers', (select coalesce(json_agg(led.ledger order by led.i), '[]'::json) from led),
    'heads', (select coalesce(json_agg(json_build_array(v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.narration, v.cancelled, v.optional, v.deleted_at,
                v.gstin, v.pos, v.ref, v.ref_date, v.cmp_gstin, v.irn, v.irn_ack_date, v.gst_reg_type, v.gst_country, v.gst_rcm, v.gst_nature, v.gst_taxability,
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id,
                coalesce((select json_agg(json_build_array((m.o->>l.ledger)::int, l.amount, l.hsn, l.rate) order by l.id) from tally_lines l
                           where l.book_id = p_book and l.guid = v.guid and l.ledger is not null), '[]'::json),
                coalesce((select json_agg(json_build_array((m.o->>b.ledger)::int, b.name, b.type, b.amount, b.credit_days) order by b.id) from tally_bills b
                           where b.book_id = p_book and b.guid = v.guid and b.ledger is not null), '[]'::json)) order by v.day, v.guid), '[]'::json)
                from tally_vouchers v, m where v.book_id = p_book and v.guid = any(p_guids)))::jsonb;
$function$;
revoke all on function public.gst_share_rows(uuid, text[]) from public, anon, authenticated;
grant execute on function public.gst_share_rows(uuid, text[]) to service_role;

-- 2: the planner's count of the lines that carry a remote GUID (the settle's own test, as it is written there)
create statistics if not exists public.tally_recorder_lines_remote_guid_stats on (coalesce(payload->>'remoteGuid', payload->>'remote_guid', '')) from public.tally_recorder_lines;

commit;
