-- Reports worked out by the database (branch fast-sync, review of 01-Oct-2026). MIS, and the TDS and GST summaries, came
-- from every entry downloaded into the browser: a fresh computer waited for the whole year first. Now the database
-- answers them from the cloud copy's ready totals (tally_ledger_day, a row per ledger per day) and sends only the
-- answer. The trial balance, a ledger, a group month by month and the entry search already work this way (migration-3).
-- Adds only; nothing is dropped or deleted. Every function answers for the caller's own firm only (tally_pick, my_firm).
--
--   tally_mis(client, from, to)          the profit and loss as FinCom's MIS heads it (revenue, other income, purchases,
--                                        direct, employee, other, finance, depreciation, tax: by each ledger's groups up
--                                        to its primary group, the same rules as the browser), month by month; profit
--                                        before tax; sales by customer; what customers owe and suppliers are owed, on
--                                        the last date; cash and bank
--   tally_tds_summary(client, from, to)  each TDS/TCS ledger (as confirmed in FinCom's ledger list): opening, deducted
--                                        and paid month by month, closing
--   tally_gst_summary(client, from, to)  month by month: output tax and input tax by head (CGST, SGST, IGST, cess), reverse
--                                        charge, taxable sales; from the GST ledgers as confirmed in FinCom, on the
--                                        documents only (sales, purchases, expenses), not the month's set-off or payment
--   index tally_lines (book_id, day)     the lines of a period, for sales by customer

begin;

create index if not exists tally_lines_book_day on public.tally_lines (book_id, day);

-- the MIS head of a ledger, from its chain of groups (FinCom's MIS.head, src/js/07-mis.js)
create or replace function public.tally_mis_head(p_name text, p_chain text[])
returns text language sql immutable set search_path to 'public' as $function$
  select case
    when exists (select 1 from unnest(p_chain) g where lower(g) in ('sales accounts', 'direct incomes')) then 'rev'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'indirect incomes') then 'oth'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'purchase accounts') then 'pur'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'direct expenses') then 'dir'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'indirect expenses') then
      case when p_name ~* '(SALAR|WAGES|BONUS|STAFF|GRATUITY|\yPF\y|\yESI\y|EMPLOYEE|INCENTIVE|LEAVE)' then 'emp'
           when p_name ~* '(INTEREST|FINANCE CHARGE|PROCESSING FEE|LOAN CHARGE)' and p_name !~* 'INTEREST ON (TDS|GST|INCOME TAX)' then 'fin'
           when p_name ~* '(DEPRECIATION|AMORTI)' then 'dep'
           when p_name ~* '(INCOME TAX|PROVISION FOR TAX|DEFERRED TAX)' then 'tax'
           else 'exp' end
    else '' end
$function$;

create or replace function public.tally_mis(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with led as (
    select l.name, coalesce(l.open, 0) as open, tally_mis_head(l.name, l.chain) as hd,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts') as sales,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry debtors') as deb,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry creditors') as cred,
           exists (select 1 from unnest(l.chain) g where lower(g) in ('bank accounts', 'cash-in-hand', 'bank od a/c', 'bank occ a/c')) as cash
      from tally_ledgers l where l.book_id = bk and l.merged_into is null),
  mv as (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as a from tally_ledger_day d
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1, 2),
  sg as (select * from (values ('rev', 1), ('oth', 1), ('pur', -1), ('dir', -1), ('emp', -1), ('exp', -1), ('fin', -1), ('dep', -1), ('tax', -1)) s(hd, sign)),
  hm as (select l.hd, m.ym, round(sum(m.a * s.sign), 2) as v from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  ht as (select hd, round(sum(v), 2) as t, jsonb_object_agg(ym, v) as m from hm group by hd),
  hl as (select l.hd, m.ledger, round(sum(m.a * s.sign), 2) as t from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  tops as (select hd, jsonb_agg(jsonb_build_object('l', ledger, 't', t) order by abs(t) desc, ledger) as led from (select *, row_number() over (partition by hd order by abs(t) desc, ledger) as r from hl) z where r <= 15 group by hd),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  tot as (select mo.ym,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) as income,
           coalesce(sum(hm.v) filter (where hm.hd = 'rev'), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir')), 0) as gross,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp')), 0) as ebitda,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep')), 0) as pbt,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep', 'tax')), 0) as pat
         from months mo left join hm on hm.ym = mo.ym group by mo.ym),
  -- sales by customer: the Sales Accounts lines of each entry, under the entry's party (else its debtor line)
  sl as (select coalesce(nullif(v.party, ''), (select x.ledger from tally_lines x join led dl on dl.name = x.ledger and dl.deb where x.book_id = bk and x.guid = v.guid limit 1), '') as party, sum(t.amount) as a
           from tally_lines t join led l on l.name = t.ledger and l.sales join tally_vouchers v on v.book_id = t.book_id and v.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to and not v.cancelled and not v.optional group by 1),
  -- balances on the last date
  bal as (select l.name, l.deb, l.cred, l.cash, l.open + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.ledger = l.name and d.day between b.from_date and p_to), 0) as c
            from led l where l.deb or l.cred or l.cash)
  select jsonb_build_object(
    'from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'company', b.company,
    'months', (select jsonb_agg(ym order by ym) from months),
    'heads', coalesce((select jsonb_object_agg(ht.hd, jsonb_build_object('t', ht.t, 'm', ht.m, 'led', coalesce(tops.led, '[]'::jsonb))) from ht left join tops on tops.hd = ht.hd), '{}'::jsonb),
    'income', (select jsonb_build_object('t', round(sum(income), 2), 'm', jsonb_object_agg(ym, round(income, 2))) from tot),
    'gross', (select jsonb_build_object('t', round(sum(gross), 2), 'm', jsonb_object_agg(ym, round(gross, 2))) from tot),
    'ebitda', (select jsonb_build_object('t', round(sum(ebitda), 2), 'm', jsonb_object_agg(ym, round(ebitda, 2))) from tot),
    'pbt', (select jsonb_build_object('t', round(sum(pbt), 2), 'm', jsonb_object_agg(ym, round(pbt, 2))) from tot),
    'pat', (select jsonb_build_object('t', round(sum(pat), 2), 'm', jsonb_object_agg(ym, round(pat, 2))) from tot),
    'sales', jsonb_build_object('total', coalesce((select round(sum(a), 2) from sl), 0),
       'other', coalesce((select round(sum(m.a), 2) from mv m join led l on l.name = m.ledger where l.hd in ('rev', 'oth') and not l.sales), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', party, 't', round(a, 2)) order by a desc) from (select * from sl order by a desc limit 20) z), '[]'::jsonb)),
    'recv', jsonb_build_object('owed', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where deb), 0), 'advance', coalesce((select round(sum(greatest(c, 0)), 2) from bal where deb), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owed', round(-c, 2)) order by c) from (select * from bal where deb and c < 0 order by c limit 20) z), '[]'::jsonb)),
    'pay', jsonb_build_object('owe', coalesce((select round(sum(greatest(c, 0)), 2) from bal where cred), 0), 'advance', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where cred), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owe', round(c, 2)) order by c desc) from (select * from bal where cred and c > 0 order by c desc limit 20) z), '[]'::jsonb)),
    'cash', jsonb_build_object('total', coalesce((select round(sum(-c), 2) from bal where cash), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('l', name, 'bal', round(-c, 2)) order by name) from bal where cash), '[]'::jsonb)),
    'grouped', exists (select 1 from led where hd <> '' limit 1),
    'at', now())
  into res;
  return res;
end $function$;

-- the ledgers FinCom's ledger list says are of a kind (client_book_items, key "map"; the caller's firm only)
create or replace function public.tally_led_kinds(p_client text)
returns table (ledger text, kind text, side text, tax text, what text) language sql stable security definer set search_path to 'public' as $function$
  -- a ledger not confirmed yet carries FinCom's guess without "what": its kind says it (reverse charge when marked so)
  select substr(i.item, 2), coalesce(i.data->>'kind', ''), coalesce(i.data->>'side', ''), coalesce(i.data->>'tax', ''),
         coalesce(nullif(i.data->>'what', ''), case when i.data->>'kind' = 'gst' and coalesce(i.data->>'rcm', '') = 'true' then 'gst_rcm' else coalesce(i.data->>'kind', '') end)
    from client_book_items i where i.firm_id = my_firm() and i.client_id = p_client and i.key = 'map' and i.item like '.%' and not i.deleted;
$function$;

create or replace function public.tally_tds_summary(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with k as (select * from tally_led_kinds(p_client) where kind in ('tds_payable', 'tds_receivable', 'tcs_payable', 'tcs_receivable', 'tds_clearing')),
  op as (select k.ledger, coalesce((select l.open from tally_ledgers l where l.book_id = bk and l.name = k.ledger), 0)
           + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.ledger = k.ledger and d.day >= b.from_date and d.day < p_from), 0) as open from k),
  mm as (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.cr) as cr, sum(d.dr) as dr from tally_ledger_day d join k on k.ledger = d.ledger
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1, 2),
  per as (select k.ledger, k.kind, op.open, coalesce(sum(mm.cr), 0) as cr, coalesce(sum(mm.dr), 0) as dr,
            coalesce(jsonb_object_agg(mm.ym, jsonb_build_object('cr', round(mm.cr, 2), 'dr', round(mm.dr, 2))) filter (where mm.ym is not null), '{}'::jsonb) as m
            from k join op on op.ledger = k.ledger left join mm on mm.ledger = k.ledger group by 1, 2, 3)
  select jsonb_build_object('from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'),
    'ledgers', coalesce(jsonb_agg(jsonb_build_object('l', ledger, 'kind', kind, 'open', round(-open, 2), 'deducted', round(cr, 2), 'paid', round(dr, 2), 'close', round(-(open + cr - dr), 2), 'm', m) order by kind, ledger), '[]'::jsonb),
    'deducted', coalesce(round(sum(cr) filter (where kind in ('tds_payable', 'tcs_payable')), 2), 0),
    'paid', coalesce(round(sum(dr) filter (where kind in ('tds_payable', 'tcs_payable')), 2), 0),
    'receivable', coalesce(round(sum(dr - cr) filter (where kind in ('tds_receivable', 'tcs_receivable')), 2), 0),
    'mapped', (select count(*) from k), 'at', now())
  into res from per;
  return res;
end $function$;

create or replace function public.tally_gst_summary(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with k as (select * from tally_led_kinds(p_client) where kind = 'gst' and what in ('gst', 'gst_rcm', 'gst_import')),
  sales as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null and exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts')),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  -- the tax on documents only (review: the month's set-off and payment entries moved the tax ledgers too): output tax on
  -- entries with a sales or income line, input tax on entries with an expense, purchase or fixed-asset line
  nom as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses', 'fixed assets'))),
  inc as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes'))),
  docs as (select v.guid,
             exists (select 1 from tally_lines x join inc on inc.name = x.ledger where x.book_id = bk and x.guid = v.guid) as outward,
             exists (select 1 from tally_lines x join nom on nom.name = x.ledger where x.book_id = bk and x.guid = v.guid) as doc
             from tally_vouchers v where v.book_id = bk and v.day between greatest(p_from, b.from_date) and p_to and not v.cancelled and not v.optional),
  tx as (select to_char(t.day, 'YYYYMM') as ym, k.side, k.what, upper(k.tax) as tax, sum(t.amount) as net
           from tally_lines t join k on k.ledger = t.ledger join docs on docs.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to
            and ((k.side = 'output' and docs.outward) or (k.side <> 'output' and docs.doc)) group by 1, 2, 3, 4),
  sv as (select to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as v from tally_ledger_day d join sales s on s.name = d.ledger
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1),
  heads as (select * from (values ('CGST'), ('SGST'), ('IGST'), ('CESS')) h(tax)),
  per as (select mo.ym,
    (select jsonb_object_agg(h.tax, coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and side = 'output' and what = 'gst' and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as out_tax,
    (select jsonb_object_agg(h.tax, coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and side = 'input' and what in ('gst', 'gst_import') and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as in_tax,
    coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'output'), 0) as rcm_out,
    coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'input'), 0) as rcm_in,
    coalesce((select round(v, 2) from sv where sv.ym = mo.ym), 0) as taxable_sales
    from months mo)
  select jsonb_build_object('from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'mapped', (select count(*) from k),
    'months', coalesce(jsonb_agg(jsonb_build_object('ym', ym, 'out', out_tax, 'in', in_tax, 'rcmOut', rcm_out, 'rcmIn', rcm_in, 'taxableSales', taxable_sales) order by ym), '[]'::jsonb), 'at', now())
  into res from per;
  return res;
end $function$;

revoke all on function public.tally_mis(text, date, date), public.tally_tds_summary(text, date, date), public.tally_gst_summary(text, date, date), public.tally_led_kinds(text) from public, anon;
grant execute on function public.tally_mis(text, date, date), public.tally_tds_summary(text, date, date), public.tally_gst_summary(text, date, date), public.tally_led_kinds(text) to authenticated;

commit;
