-- Migration 172 (12-Nov-2026, branch next-gst-isd-2b; written, NOT run: the owner reads it and runs it). The 2B matching
-- looks only at the financial years whose GSTR-2B is here for the registration (the owner's decision of 12-Nov-2026,
-- server/_shared/gst3b.js GST2B.run): a purchase document booked in a year with no 2B is no candidate. gst-run's month
-- step (server/gst-run/engine.js itcMonths) therefore needs only those years' documents; migration 171's
-- gst_itc_inputs gives every document of the book (30,000 documents: 5.7 MB a call).
--
--   gst_itc_inputs_2b(book, reg, engine, version, yms)   what gst_itc_inputs (171) gives, word for word, but the
--                        documents only of the months in yms (gst_itc_doc.ym, the month the entry is booked in: the
--                        months of the years whose 2B is here, server/gst-run/engine.js twoBYms); yms null: every
--                        document, as 171. Service role only.
--   gst_itc_doc_ym       an index on gst_itc_doc (book_id, reg, ym) for that filter
-- Add-only: one new function and one new index; nothing of any other migration dropped or altered; no trigger; safe to
-- run twice. Needs migration 171 (gst_itc_doc, gst_itc_bill, gst_itc_month, gst_itc_inputs); stops and says so otherwise.
-- Either order of deploying works: gst-run calls gst_itc_inputs_2b and, while it is not there (404), gst_itc_inputs.
-- Tested by tests/run_migration164.py (section 10, pg_stand) and tests/run_gst_share_deno.ts (gst-run's actions).

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.gst_itc_doc') is null or to_regclass('public.gst_itc_bill') is null or to_regclass('public.gst_itc_month') is null
     or to_regprocedure('public.gst_itc_inputs(uuid, text, text, text)') is null then
    raise exception 'migration 172 needs migration 171 (gst_itc_doc, gst_itc_bill, gst_itc_month, gst_itc_inputs) first';
  end if;
end $$;

create index if not exists gst_itc_doc_ym on public.gst_itc_doc (book_id, reg, ym);

create or replace function public.gst_itc_inputs_2b(p_book uuid, p_reg text, p_engine text, p_version text, p_yms text[])
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with nb as (select distinct b.ledger, b.name from gst_itc_bill b where b.book_id = p_book and b.nb and b.reg = coalesce(p_reg, '')),
  live as (select v.guid, v.day, v.cmp_gstin, v.cancelled, v.optional, v.vno from tally_vouchers v where v.book_id = p_book and v.deleted_at is null),
  dated as (select l.day from live l where exists (select 1 from tally_lines x where x.book_id = p_book and x.guid = l.guid and coalesce(x.ledger, '') <> '')
              or (coalesce(l.cancelled, false) and coalesce(l.vno, '') <> ''))
  select jsonb_build_object(
    'first', (select to_char(min(d.day), 'YYYYMM') from dated d),
    'last', (select to_char(max(d.day), 'YYYYMM') from dated d),
    'gstins', (select coalesce(jsonb_agg(distinct upper(l.cmp_gstin)), '[]'::jsonb) from live l where coalesce(l.cmp_gstin, '') <> ''),
    'months', (select coalesce(jsonb_object_agg(q.ym, q.rows), '{}'::jsonb) from (
                 select m.ym, jsonb_agg(jsonb_build_object('reg', m.reg, 'sec', m.sec, 'k1', m.k1, 'k2', m.k2, 'k3', m.k3, 'n', m.n, 'taxable', m.taxable, 'igst', m.igst,
                          'cgst', m.cgst, 'sgst', m.sgst, 'cess', m.cess, 'qty', m.qty) order by m.sec, m.k1, m.k2, m.k3) rows
                   from gst_month m where m.book_id = p_book and m.reg = coalesce(p_reg, '') and m.sec <> '*' group by m.ym) q),
    'status', (select coalesce(jsonb_object_agg(m.ym, m.status), '{}'::jsonb) from gst_month m where m.book_id = p_book and m.reg = '' and m.sec = '*'),
    'docs', (select coalesce(jsonb_agg(jsonb_build_object('guid', d.guid, 'doc', d.doc) order by d.doc->>'bookDate', d.guid), '[]'::jsonb)
               from gst_itc_doc d where d.book_id = p_book and d.reg in (coalesce(p_reg, ''), '') and (p_yms is null or d.ym = any(p_yms))),
    'bills', (select coalesce(jsonb_agg(jsonb_build_object('guid', b.guid, 'seq', b.seq, 'rec', b.rec) order by b.day, b.guid, b.seq), '[]'::jsonb)
                from gst_itc_bill b join nb on nb.ledger = b.ledger and nb.name = b.name where b.book_id = p_book),
    'moves', (select coalesce(jsonb_object_agg(z.ledger, z.ms), '{}'::jsonb) from (
                select q.ledger, jsonb_agg(jsonb_build_array(q.ym, q.amt) order by q.ym) ms from (
                  select x.ledger, to_char(l.day, 'YYYYMM') ym, sum(x.amount) amt
                    from tally_lines x join live l on l.guid = x.guid
                   where x.book_id = p_book and x.ledger in (select distinct nb.ledger from nb)
                     and not coalesce(l.cancelled, false) and not coalesce(l.optional, false)
                   group by x.ledger, to_char(l.day, 'YYYYMM')) q group by q.ledger) z),
    'carry', (select coalesce(jsonb_object_agg(c.ym, c.carry), '{}'::jsonb) from gst_itc_month c
               where c.book_id = p_book and c.reg = coalesce(p_reg, '') and c.engine = coalesce(p_engine, '') and c.version = coalesce(p_version, '') and coalesce(p_version, '') <> ''),
    'refs', (select coalesce(jsonb_object_agg(c.ym, c.ref), '{}'::jsonb) from gst_itc_month c
               where c.book_id = p_book and c.reg = coalesce(p_reg, '') and c.engine = coalesce(p_engine, '') and c.version = coalesce(p_version, '') and coalesce(p_version, '') <> '' and c.ref is not null));
$function$;

revoke all on function public.gst_itc_inputs_2b(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.gst_itc_inputs_2b(uuid, text, text, text, text[]) to service_role;

commit;
