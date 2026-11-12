-- Migration 180 (12-Nov-2026, branch next-gst-isd-2b; review of ee1fe32c5): the share context's version also follows
-- the entries Tally types "Input Service Distributor".
-- gst-run's context (server/gst-run/engine.js ctxOf) now carries the GSTINs of the suppliers whose entries Tally types
-- ISD (isdTyped: a supplier with any such entry is the ISD for all its entries and its 2B rows, 3B 4(A)(4)). The context
-- is made again only when gst_share_ctx_version (migration 164) moves, and that covered the ledgers, groups and work
-- items, not the entries: a first ISD-typed entry, or the last one deleted or retyped, left the context as it was.
-- Now the version also takes a hash of the distinct (party, registration type) pairs of the book's entries (not
-- deleted) whose type reads ISD, as GSTR.ISD_RE does ("Input Service Distributor", hyphens or underscores between the
-- words, or "ISD" at the start). A book with no such entry keeps exactly migration 164's version (nothing is made
-- again for it); a book with one gets a new version once, and again whenever that set changes.
-- The pattern is GSTR.ISD_RE's (tests/isd_types.json), and migration 181's index's, character for character: run 181
-- (the index, made concurrently) before this file, so the version reads the few ISD-typed entries by it.
-- Replaces only this function (same signature, same grants, restated). Nothing else changes. Safe to run twice.
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.gst_share_ctx_version(uuid)') is null then
    raise exception 'migration 180 needs migration 164 (gst_share_ctx_version) first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_vouchers' and column_name = 'gst_reg_type') then
    raise exception 'migration 180 needs migration 72 (tally_vouchers.gst_reg_type) first';
  end if;
end $$;

create or replace function public.gst_share_ctx_version(p_book uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select case when x.isd is null then x.v else md5(x.v || '|ISD=180.1|' || x.isd) end
    from (
      select md5(array_to_string(array['GST_SHARE=164.1', coalesce(b.ledgers_at::text, '~'), coalesce(b.from_date::text, '~'),
               (select array_to_string(array[count(*), sum(hashtext(to_jsonb(l)::text)::bigint)]::text[], ':', '~') from tally_ledgers l where l.book_id = b.book_id),
               (select array_to_string(array[count(*), sum(hashtext(g.name || '~' || coalesce(g.parent, '^'))::bigint)]::text[], ':', '~') from tally_groups g where g.book_id = b.book_id),
               (select array_to_string(array[count(*)::text, max(i.seq)::text, max(i.updated_at)::text,
                         sum(hashtext(i.key || '~' || i.item || '~' || coalesce(i.data::text, '^') || '~' || i.deleted::text)::bigint)::text], ':', '~') from client_book_items i
                 where i.firm_id = b.firm_id and i.client_id = b.client_id
                   and i.key in ('map', 'gstPosFix', 'gstins', 'groups', 'under', 'ledInfo', 'ledInfoAt', 'gstRegs', 'pans', 'states'))], '|', '~')) as v,
             -- the entries Tally types ISD: their distinct (party, type), none: null (the version as 164 made it)
             (select md5(string_agg(t.p || '~' || t.r, '|' order by t.p, t.r))
                from (select distinct coalesce(v.party, '^') as p, v.gst_reg_type as r from tally_vouchers v
                       where v.book_id = b.book_id and v.deleted_at is null
                         and v.gst_reg_type ~* '(input[ \t\n\r_-]*service[ \t\n\r_-]*distributor|^[ \t\n\r]*isd([^A-Za-z0-9_]|$))') t) as isd
        from tally_books b where b.book_id = p_book) x;
$function$;

revoke all on function public.gst_share_ctx_version(uuid) from public, anon, authenticated;
grant execute on function public.gst_share_ctx_version(uuid) to service_role;

commit;
