-- Migration 210 (23-Nov-2026, branch next-fix-audit-all): DRAFT, written, NOT run. The owner reads it and runs it on
-- staging first. After 204 (it replaces 204's gst_calc_rows in place) and 37 (tally_vouchers.fincom_id). Add-only: one
-- function replaced; no table, row or grant changed.
--
-- gst_calc_rows' compact heads now end with each entry's FinCom id (tally_vouchers.fincom_id: the "TDSDesk:<id>" the
-- bridge read from the WHOLE narration), after the lines and the bills, so the answer's earlier places are as before.
-- gst-run (server/gst-run/data.ts unpack) reads it when it is there; BookSrc.fromCopy keeps it as the entry's fid, and
-- GSTR.inBooks finds a posted marketplace invoice in the books by it, where the narration (cut to 120 characters in
-- fromCopy) can have lost the tag on a long buyer's name. Without this migration gst-run reads the same ids from
-- tally_vouchers for the client's marketplace invoices (data.ts salesSeen) as before.
create or replace function public.gst_calc_rows(p_book uuid)
 returns jsonb
 language sql stable security definer set search_path = public, pg_temp
as $function$
  -- 204: built as json and made jsonb once at the end; 210: the FinCom id last
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
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id, coalesce(ln.a, '[]'::json), coalesce(bl.a, '[]'::json), v.fincom_id) order by v.day, v.guid), '[]'::json)
                from tally_vouchers v left join ln on ln.guid = v.guid left join bl on bl.guid = v.guid where v.book_id = p_book))::jsonb;
$function$;
revoke all on function public.gst_calc_rows(uuid) from public, anon, authenticated;
grant execute on function public.gst_calc_rows(uuid) to service_role;
