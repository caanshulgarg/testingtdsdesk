-- Migration 153 (09-Nov-2026, branch next-cloud-gst; written, NOT run: the owner reads it and runs it).
-- A month's GSTR-3B worked out in the cloud (the gst-run function) by the browser's own engine (server/_shared/gst3b.js,
-- the same file the app is built from), and kept until something it is worked out from changes.
--
-- Needs migration 151 (branch next-cloud-calc1) first: it reuses 151's table and functions, as they are:
--   tally_calc_results   one row per book, kind and arguments: here kind 'gst-3b', args '<state code>|<YYYYMM>' (e.g.
--                        '07|202510'), the result (every 3B box, the credit carried in and out), the version it was
--                        worked out on, and how long it took. RLS on, members read their own firm's rows, written by the
--                        service role only (all in 151).
--   tally_calc_version   the book's own version: its days and ledgers times, its entries' count, highest AlterID and
--                        deletions, and FinCom's ledger list.
-- What this adds (functions only; no table, nothing altered, dropped or deleted; safe to run twice):
--   gst_calc_version(book, client)    the version of everything a 3B is worked out from: the book's (tally_calc_version),
--                                     and the client's work in FinCom: every item of its books (client_book_items: the
--                                     2B months and their matching, the IMS decisions, the figures typed into 3B, the
--                                     returns marked filed and their copies, the GST settings, rules 37, 42 and 43,
--                                     advances, the opening credit, the ledger list), the client's own record (clients:
--                                     QRMP, advances on or off, where a supplier's invoice number is kept), its marketplace
--                                     sales (records, kind 'sales'), and the 2B matching runs and decisions kept by
--                                     gst-2b-match (gst_2b_runs, gst_2b_decisions). Any change to any of them moves it.
--                                     Service role only.
--   gst_calc_cached(client, on, reg, ym)
--                                     for a member of the client's firm: the 3B kept for that month, only while the
--                                     version is the same ({book, version, result: null when not current, at}).
-- The result's own "engine" says which engine worked it out; gst-run works a month out again when it differs.

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.tally_calc_results') is null or to_regprocedure('public.tally_calc_version(uuid)') is null then
    raise exception 'migration 153 needs migration 151 (tally_calc_results, tally_calc_version) to be run first';
  end if;
end $$;

-- the version of everything a client's 3B reads (see above); the book's firm decides whose rows count
create or replace function public.gst_calc_version(p_book uuid, p_client text)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select md5(concat_ws('|', 'gst-3b',
           tally_calc_version(b.book_id),
           (select concat_ws(':', count(*), max(i.seq), max(i.updated_at), count(*) filter (where i.deleted))
              from client_book_items i where i.firm_id = b.firm_id and i.client_id = p_client),
           (select concat_ws(':', count(*), max(c.updated_at), md5(coalesce(max(c.data::text), '')), bool_or(c.deleted))
              from clients c where c.firm_id = b.firm_id and c.id = p_client),
           (select concat_ws(':', count(*), max(r.updated_at), count(*) filter (where r.deleted))
              from records r where r.firm_id = b.firm_id and r.client_id = p_client and r.kind = 'sales'),
           (select concat_ws(':', count(*), max(g.id)) from gst_2b_runs g
             where g.firm_id = b.firm_id and g.client_id = p_client and g.status = 'done'),
           (select concat_ws(':', count(*), max(d.at), md5(coalesce(string_agg(d.pair_id || '=' || d.decision, ',' order by d.gstin, d.fy, d.pair_id), '')))
              from gst_2b_decisions d where d.firm_id = b.firm_id
               and d.gstin in (select g.gstin from gst_2b_runs g where g.firm_id = b.firm_id and g.client_id = p_client))))
    from tally_books b where b.book_id = p_book and b.client_id = p_client;
$function$;

-- a member: the 3B kept for its client's month, only while it is current
create or replace function public.gst_calc_cached(p_client text, p_on date, p_reg text, p_ym text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare bk uuid := tally_pick(p_client, p_on); v text; r tally_calc_results%rowtype;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  v := gst_calc_version(bk, p_client);
  select * into r from tally_calc_results x
   where x.book_id = bk and x.kind = 'gst-3b' and x.args = coalesce(p_reg, '') || '|' || coalesce(p_ym, '') and x.firm_id = my_firm();
  return jsonb_build_object('book', bk, 'version', v, 'result', case when r.version = v then r.result end, 'at', case when r.version = v then r.at end);
end $function$;

revoke all on function public.gst_calc_version(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_calc_version(uuid, text) to service_role;
revoke all on function public.gst_calc_cached(text, date, text, text) from public, anon;
grant execute on function public.gst_calc_cached(text, date, text, text) to authenticated, service_role;

commit;
