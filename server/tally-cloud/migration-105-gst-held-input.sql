-- migration-105-gst-held-input.sql (24-Oct-2026, branch next-fix-gst-not2b; NOT run on staging: the owner runs it).
-- The server's GST summary (tally_gst_summary) takes input tax as the app's GSTR-3B does since commit c326262 (Leads
-- Insurance, owner 23-Oct-2026: "gstr 3b is not matching with books, some negative entry is coming"). The client keeps
-- credit not yet in 2B in input ledgers of its own ("IGST INPUT NOT SHOWN IN 2B", under a group "Not in GSTR-2B"), books
-- its bills as journals and moves the credit to Input IGST by journal when 2B shows the bill. Until now the summary took
-- input tax on every entry with an expense line, whatever the input ledger, and never on an entry without one, so:
--   - a bill booked to the held ledger was credit in the month it was booked (Mar-2026: 8,10,000 of IGST held on four
--     bills counted), and the journal that moved it to Input IGST counted nothing (Apr-2026, May-2026);
--   - the write-off of a held credit to an expense was negative credit (journal 658 of 01-Apr-2025: IGST -900).
-- Now, entry by entry (GSTR.inward and GSTR.netIn, src/js/12):
--   - a sale is no purchase; an entry that is not a bill counts only when it moves input tax and no output tax;
--   - an input ledger is "held" when its map says held true, or (no held set) when it is a GST input ledger whose name or
--     one of whose groups says "not shown / reflected / appearing in 2A/2B", "ITC on hold / pending" or "pending ITC"
--     (GSTR.HELD); its lines take no credit;
--   - the credit is the net of the other input ledgers' lines, head by head (debit more): a move from the held ledger to
--     Input IGST is that month's credit once; a bill on the held ledger, and its write-off, take none;
--   - a set-off (with output tax, the GST payable or a cash ledger: kind tax_other or what gst_setoff), a rounding of the
--     input ledgers alone, and an entry whose input ledgers net to nothing are no purchases (never negative credit).
-- Output tax, reverse-charge output tax and taxable sales are worked out as before (the same text); "in" and "rcmIn" by
-- the rule above. The answer's shape is unchanged.
-- Add-only: one function replaced with the same signature, return type, volatility, security definer and search_path;
-- its grants restated as they are on staging (execute: authenticated and service_role; not public, not anon). Nothing
-- dropped, no table or row changed. One transaction; safe to run twice.
begin;
set local lock_timeout = '10s';

create or replace function public.tally_gst_summary(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
  held_re constant text := 'NOT\s*(SHOWN|REFLECT\w*|APPEAR\w*)?\s*IN\s*(GSTR\s*-?\s*)?2\s*[AB]\y|ITC\s*(ON\s*HOLD|PENDING)|PENDING\s*ITC';
  nonacc constant text := 'ORDER|DELIVERY NOTE|RECEIPT NOTE|REJECTION|STOCK JOURNAL|PHYSICAL STOCK|MATERIAL (IN|OUT)|MEMO';
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with k as (select * from tally_led_kinds(p_client) where kind = 'gst' and what in ('gst', 'gst_rcm', 'gst_import')),
  sales as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null and exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts')),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  -- output tax on documents only (review: the month's set-off and payment entries moved the tax ledgers too): on entries
  -- with a sales or income line
  inc as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes'))),
  docs as (select v.guid, v.day, v.vtype,
             exists (select 1 from tally_lines x join inc on inc.name = x.ledger where x.book_id = bk and x.guid = v.guid) as outward
             from tally_vouchers v where v.book_id = bk and v.day between greatest(p_from, b.from_date) and p_to and v.deleted_at is null and not v.cancelled and not v.optional),
  tx as (select to_char(t.day, 'YYYYMM') as ym, k.side, k.what, upper(k.tax) as tax, sum(t.amount) as net
           from tally_lines t join k on k.ledger = t.ledger join docs on docs.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to
            and k.side = 'output' and docs.outward group by 1, 2, 3, 4),
  -- input tax (migration 105): the ledgers' map with "held" (worked out once a ledger), the ledgers under Sales or
  -- Purchase Accounts, and every line of the period's entries classified
  mp as (select m.*, coalesce(m.held_set, m.kind = 'gst' and m.side = 'input'
             and (m.ledger ~* held_re or exists (select 1 from tally_ledgers l, unnest(l.chain) g where l.book_id = bk and l.name = m.ledger and l.merged_into is null and g ~* held_re))) as held_l
           from (select tally_nm(substr(i.item, 2)) as ledger, coalesce(i.data->>'kind', '') as kind, coalesce(i.data->>'side', '') as side, upper(coalesce(i.data->>'tax', '')) as tax,
                   coalesce(nullif(i.data->>'what', ''), case when i.data->>'kind' = 'gst' and coalesce(i.data->>'rcm', '') = 'true' then 'gst_rcm' else coalesce(i.data->>'kind', '') end) as what,
                   case when i.data->>'held' in ('true', 'false') then (i.data->>'held')::boolean end as held_set
                   from client_book_items i where i.firm_id = my_firm() and i.client_id = p_client and i.key = 'map' and i.item like '.%' and not i.deleted) m),
  lk as (select l.name, cardinality(coalesce(l.chain, '{}'::text[])) > 0 as grouped,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts') as sales_c, exists (select 1 from unnest(l.chain) g where lower(g) = 'purchase accounts') as purch_c
           from tally_ledgers l where l.book_id = bk and l.merged_into is null),
  ln as (select t.guid, t.amount, coalesce(m.kind, '') as kind, coalesce(m.side, '') as side, coalesce(m.tax, '') as tax, coalesce(m.what, '') as what,
           (coalesce(m.kind, '') in ('gst', 'gst_common') and m.side = 'input') or coalesce(m.kind, '') = 'ineligible' as inp, coalesce(m.held_l, false) as held_l,
           coalesce(lk.sales_c, false) or (not coalesce(lk.grouped, false) and t.ledger ~* '\ySALES?\y') as sales_l,
           coalesce(lk.purch_c, false) or (not coalesce(lk.grouped, false) and t.ledger ~* 'PURCHASE') as purch_l, coalesce(lk.purch_c, false) as purch_c
           from tally_lines t join docs on docs.guid = t.guid left join mp m on m.ledger = t.ledger left join lk on lk.name = t.ledger
          where t.book_id = bk),
  -- one row a line and head (a CGST+SGST ledger: half each; UTGST is SGST; no head: IGST), the credit it gives (debit more)
  lh as (select ln.guid, ln.what, ln.kind, ln.held_l, hh.head, -ln.amount * (case when ln.tax = 'CGST+SGST' then 0.5 else 1 end) as cr
           from ln cross join lateral unnest(case when ln.tax = 'CGST+SGST' then array['CGST', 'SGST']
                                                  else array[case when ln.tax = '' then 'IGST' when ln.tax = 'UTGST' then 'SGST' else ln.tax end] end) hh(head)
          where ln.inp),
  -- each entry: what its lines are (GSTR.inward and GSTR.netIn) ...
  lg as (select guid, bool_or(inp) as in_tax,
           bool_or(kind in ('gst', 'gst_common') and side = 'output' and what <> 'gst_rcm') as out_tax,
           bool_or(not inp and (kind = 'tax_other' or what = 'gst_setoff' or (kind in ('gst', 'gst_common') and side = 'output' and what <> 'gst_rcm'))) as other,
           bool_and(inp or kind = 'roundoff') as only_round, bool_or(not inp and kind = 'roundoff') as ro,
           bool_or(amount > 0 and sales_l) as cr_sales, bool_or(amount > 0 and purch_c) as cr_purch_c, bool_or(amount < 0 and purch_l) as dr_purch
           from ln group by guid),
  -- ... the held ledgers' credit (debit more), and whether the other input ledgers net to nothing, head by head
  gh as (select guid, head, sum(cr) filter (where held_l) as h, sum(cr) filter (where not held_l and kind <> 'ineligible') as c, sum(cr) filter (where kind = 'ineligible') as i from lh group by 1, 2),
  hv as (select guid, round(coalesce(sum(h), 0), 2) as hold, bool_and(abs(coalesce(c, 0)) < 0.005) and abs(coalesce(sum(i), 0)) < 0.005 as nothing from gh group by 1),
  -- what the app's Books.isSale / isPurchase say of the entry (src/js/04): by its type, else by its lines (not for a
  -- journal, payment, receipt or contra)
  pk as (select d.guid, d.day, coalesce(lg.in_tax, false) as in_tax, coalesce(lg.out_tax, false) as out_tax, coalesce(lg.other, false) as other,
           coalesce(lg.only_round, true) as only_round, coalesce(lg.ro, false) as ro, coalesce(hv.hold, 0) as hold, coalesce(hv.nothing, true) as nothing,
           d.vtype !~* nonacc and (d.vtype ~* 'SALE|SALES|CREDIT NOTE|EXPORT' or (d.vtype ~* 'DEBIT NOTE' and coalesce(lg.cr_sales, false) and not coalesce(lg.cr_purch_c, false))
             or (d.vtype !~* 'PUR|PURCHASE|DEBIT NOTE' and d.vtype !~* 'JOURNAL|PAYMENT|RECEIPT|CONTRA' and coalesce(lg.cr_sales, false))) as sale,
           d.vtype !~* nonacc and not (d.vtype ~* 'DEBIT NOTE' and coalesce(lg.cr_sales, false) and not coalesce(lg.cr_purch_c, false))
             and (d.vtype ~* 'PUR|PURCHASE|DEBIT NOTE' or (d.vtype !~* 'SALE|SALES|CREDIT NOTE|EXPORT' and d.vtype !~* 'JOURNAL|PAYMENT|RECEIPT|CONTRA' and coalesce(lg.dr_purch, false))) as purch
           from docs d left join lg on lg.guid = d.guid left join hv on hv.guid = d.guid),
  -- the entries that take credit: a bill (its held lines apart), or another entry moving input tax and no output tax
  -- that is no set-off, no rounding alone, and leaves some credit once the input ledgers are netted
  took as (select guid, day from pk
            where not sale and (purch or (in_tax and not out_tax))
              and not (case when purch and hold = 0 then false when purch then nothing else other or (only_round and ro) or nothing end)),
  ix as (select to_char(took.day, 'YYYYMM') as ym, lh.what, lh.head, sum(lh.cr) as cr
           from took join lh on lh.guid = took.guid where not lh.held_l and lh.kind <> 'ineligible' group by 1, 2, 3),
  sv as (select to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as v from tally_ledger_day d join sales s on s.name = d.ledger
          where d.book_id = bk and d.merged_into is null and d.day between greatest(p_from, b.from_date) and p_to group by 1),
  heads as (select * from (values ('CGST'), ('SGST'), ('IGST'), ('CESS')) h(tax)),
  per as (select mo.ym,
    (select jsonb_object_agg(h.tax, coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and side = 'output' and what = 'gst' and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as out_tax,
    (select jsonb_object_agg(h.tax, coalesce((select round(sum(cr), 2) from ix where ix.ym = mo.ym and ix.what <> 'gst_rcm' and ix.head = h.tax), 0)) from heads h) as in_tax,
    coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'output'), 0) as rcm_out,
    coalesce((select round(sum(cr), 2) from ix where ix.ym = mo.ym and ix.what = 'gst_rcm'), 0) as rcm_in,
    coalesce((select round(v, 2) from sv where sv.ym = mo.ym), 0) as taxable_sales
    from months mo)
  select jsonb_build_object('from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'mapped', (select count(*) from k),
    'months', coalesce(jsonb_agg(jsonb_build_object('ym', ym, 'out', out_tax, 'in', in_tax, 'rcmOut', rcm_out, 'rcmIn', rcm_in, 'taxableSales', taxable_sales) order by ym), '[]'::jsonb), 'at', now())
  into res from per;
  return res;
end $function$;

-- the grants as on staging (read 24-Oct-2026: postgres, service_role and authenticated may execute; not anon, not public)
revoke all on function public.tally_gst_summary(text, date, date) from public, anon;
grant execute on function public.tally_gst_summary(text, date, date) to authenticated, service_role;

commit;
