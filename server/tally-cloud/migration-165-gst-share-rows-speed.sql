-- Migration 165 (12-Nov-2026, branch next-gst-share): gst_share_rows (migration 164) made fast. Same signature, same
-- answer, same grants. On staging, 300 entries of a 9,360-entry book took 1,740 ms. The planner joined each ledger's
-- lines in the whole book and tested every one against the GUID list, so a 3,000-entry batch ran past the 8 s statement
-- timeout and the GST share sweep never wrote a share. Now the batch's own lines and bills are fetched once by
-- (book_id, guid) and the ledger numbers come from them: 56 ms, identical result (checked on staging, 300 entries).
-- Replaces only this function, added by 164. Nothing else changes.
begin;

create or replace function public.gst_share_rows(p_book uuid, p_guids text[])
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with gl as materialized (select l.guid, l.id, l.ledger, l.amount, l.hsn, l.rate from tally_lines l where l.book_id = p_book and l.guid = any(p_guids)),
  gb as materialized (select b.guid, b.id, b.ledger, b.name, b.type, b.amount, b.credit_days from tally_bills b where b.book_id = p_book and b.guid = any(p_guids)),
  led as materialized (select y.ledger, (row_number() over (order by y.ledger)) - 1 as i
            from (select ledger from gl union select ledger from gb) y where y.ledger is not null),
  ln as (select l.guid, jsonb_agg(jsonb_build_array(d.i, l.amount, l.hsn, l.rate) order by l.id) a
           from gl l join led d on d.ledger = l.ledger group by l.guid),
  bl as (select b.guid, jsonb_agg(jsonb_build_array(d.i, b.name, b.type, b.amount, b.credit_days) order by b.id) a
           from gb b join led d on d.ledger = b.ledger group by b.guid),
  vs as (select v.* from tally_vouchers v where v.book_id = p_book and v.guid = any(p_guids))
  select jsonb_build_object(
    'ledgers', (select coalesce(jsonb_agg(led.ledger order by led.i), '[]'::jsonb) from led),
    'heads', (select coalesce(jsonb_agg(jsonb_build_array(v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.narration, v.cancelled, v.optional, v.deleted_at,
                v.gstin, v.pos, v.ref, v.ref_date, v.cmp_gstin, v.irn, v.irn_ack_date, v.gst_reg_type, v.gst_country, v.gst_rcm, v.gst_nature, v.gst_taxability,
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id, coalesce(ln.a, '[]'::jsonb), coalesce(bl.a, '[]'::jsonb)) order by v.day, v.guid), '[]'::jsonb)
                from vs v left join ln on ln.guid = v.guid left join bl on bl.guid = v.guid));
$function$;

revoke all on function public.gst_share_rows(uuid, text[]) from public, anon, authenticated;
grant execute on function public.gst_share_rows(uuid, text[]) to service_role;

commit;
