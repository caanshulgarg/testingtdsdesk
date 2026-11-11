-- migration-159-gst-posfix (11-Nov-2026, next-fix-lookup). Written, NOT run yet: the owner reads it and runs it.
-- Why: the GSTR-3B engine (server/_shared/gst3b.js) now reads b.gstPosFix, FinCom's own place of supply typed under
-- GST > What to fix (GSTR.posOfSale: 3B 3.2 and GSTR-1 follow it). The version a cloud 3B is kept by
-- (gst_calc_version, migration 153) did not count that item, so a correction typed after the cloud worked a month out
-- left the cloud's 3B looking current. Now it counts 'gstPosFix' too, as server/_shared/gst3bprint.js's GST3B_KEYS do,
-- so any correction moves the version and the page works the month out itself until the cloud has caught up.
-- What it does: create or replace public.gst_calc_version(uuid, text) with migration 153's definition (as in
-- server/gst-run/migration-153-gst-cloud.sql), the one change 'gstPosFix' in its list of keys; the same grants (service
-- role only). Add-only: no table, no row, no other function touched. Needs migration 153 (stops and says so otherwise).
-- Every client's kept 3B whose work has a gstPosFix item moves to a new version, so its months are worked out again;
-- the others keep theirs (the version's text is the same for a client with no such item).
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.gst_calc_version(uuid, text)') is null or to_regclass('public.gst_calc_queue') is null then
    raise exception 'migration 159 needs migration 153 (gst_calc_version, gst_calc_queue) to be run first';
  end if;
end $$;

create or replace function public.gst_calc_version(p_book uuid, p_client text)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with g as (select unnest(gst_calc_gstins(p_book, p_client)) as gstin)
  select md5(concat_ws('|', 'gst-3b',
           tally_calc_version(b.book_id),
           (select concat_ws(':', count(*), max(i.seq), max(i.updated_at), count(*) filter (where i.deleted))
              from client_book_items i where i.firm_id = b.firm_id and i.client_id = p_client
               and i.key = any (array['advFix', 'amendFix', 'assets', 'filed', 'filed1a', 'gone', 'groups', 'gst3b', 'gstAato', 'gstApi', 'gstCashLedger', 'gstContacts', 'gstFiled', 'gstOpen', 'gstPosFix', 'gstRegs', 'gstSet', 'gstVault', 'gstins', 'itcBasis', 'itcDec', 'itcTrack', 'ledCheck', 'ledInfo', 'ledInfoAt', 'map', 'outRej', 'pans', 'reco2b', 'rev', 'rule37On', 'states', 'twoBs', 'under']::text[])),
           (select concat_ws(':', count(*), max(c.updated_at), md5(coalesce(max(c.data::text), '')), bool_or(c.deleted))
              from clients c where c.firm_id = b.firm_id and c.id = p_client),
           (select concat_ws(':', count(*), max(r.updated_at))
              from records r where r.firm_id = b.firm_id and r.client_id = p_client and r.kind = 'sales' and r.deleted is not true),
           (select concat_ws(':', count(*), max(r.id)) from gst_2b_runs r
             where r.firm_id = b.firm_id and r.status = 'done' and r.gstin in (select gstin from g)),
           (select concat_ws(':', count(*), max(d.at), md5(coalesce(string_agg(d.pair_id || '=' || d.decision, ',' order by d.gstin, d.fy, d.pair_id), '')))
              from gst_2b_decisions d where d.firm_id = b.firm_id and d.gstin in (select gstin from g))))
    from tally_books b where b.book_id = p_book and b.client_id = p_client;
$function$;

revoke all on function public.gst_calc_version(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_calc_version(uuid, text) to service_role;

commit;
