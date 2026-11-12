-- Migration 166 (12-Nov-2026, branch next-gst-share): gst_share_rows (migrations 164, 165) by index, per entry.
-- Same signature, same answer, same grants. 165 still took 3.3 s for a 3,000-entry batch on staging. Inside the function the
-- planner guesses the GUID list is tiny and joins the entries to their grouped lines and bills by scanning them once for
-- every entry. Now each entry's lines and bills are read by the (book_id, guid) index, and the ledger numbers come from one
-- map: 507 ms for 3,000 entries of a 9,360-entry book, the same answer as 165 (checked on staging, 300 and 3,000 entries).
-- Lines and bills with no ledger are left out, as before (they never joined a ledger number).
-- Replaces only this function. Nothing else changes.
begin;

create or replace function public.gst_share_rows(p_book uuid, p_guids text[])
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with led as materialized (select y.ledger, (row_number() over (order by y.ledger)) - 1 as i
            from (select l.ledger from tally_lines l where l.book_id = p_book and l.guid = any(p_guids)
                  union select b.ledger from tally_bills b where b.book_id = p_book and b.guid = any(p_guids)) y where y.ledger is not null),
  m as materialized (select coalesce(jsonb_object_agg(ledger, i), '{}'::jsonb) o from led)
  select jsonb_build_object(
    'ledgers', (select coalesce(jsonb_agg(led.ledger order by led.i), '[]'::jsonb) from led),
    'heads', (select coalesce(jsonb_agg(jsonb_build_array(v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.narration, v.cancelled, v.optional, v.deleted_at,
                v.gstin, v.pos, v.ref, v.ref_date, v.cmp_gstin, v.irn, v.irn_ack_date, v.gst_reg_type, v.gst_country, v.gst_rcm, v.gst_nature, v.gst_taxability,
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id,
                coalesce((select jsonb_agg(jsonb_build_array((m.o->>l.ledger)::int, l.amount, l.hsn, l.rate) order by l.id) from tally_lines l
                           where l.book_id = p_book and l.guid = v.guid and l.ledger is not null), '[]'::jsonb),
                coalesce((select jsonb_agg(jsonb_build_array((m.o->>b.ledger)::int, b.name, b.type, b.amount, b.credit_days) order by b.id) from tally_bills b
                           where b.book_id = p_book and b.guid = v.guid and b.ledger is not null), '[]'::jsonb)) order by v.day, v.guid), '[]'::jsonb)
                from tally_vouchers v, m where v.book_id = p_book and v.guid = any(p_guids)));
$function$;

revoke all on function public.gst_share_rows(uuid, text[]) from public, anon, authenticated;
grant execute on function public.gst_share_rows(uuid, text[]) to service_role;

commit;
