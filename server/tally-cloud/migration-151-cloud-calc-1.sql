-- Migration 151 (09-Nov-2026, branch next-cloud-calc1; written, NOT run: the owner reads it and runs it).
-- The owner, 09-Nov-2026: "it should not freeze at all, whatever the book size; calculation should happen in cloud".
-- The browser downloads a client's whole books (TCloud.load) and works every figure out itself: on a book of 40,000
-- entries a balance, the month-end tie-out or the ageing held the page for seconds. Phase 1, the server side only: the
-- same figures worked out here from the cloud copy (tally_ledgers, tally_ledger_day, tally_vouchers, tally_lines,
-- tally_bills) and FinCom's ledger list (client_book_items, key "map"), by the browser's own rules, ported one by one
-- (tests/run_migration151.py checks each figure against the browser's engine on the same made-up books). Nothing in the
-- browser changes yet.
--
--   tally_calc_led(book)               every ledger as the browser sees it: the masters (merged ones left out, as
--                                      TCloud.load reads them) and any ledger with entries but no master; its opening,
--                                      its group path (chain), the kind in FinCom's ledger list, and the browser's tests:
--                                      Audit.isDebtor / isCreditor / isCash / isBankL, and MIS.plHead (a profit and loss
--                                      ledger)
--   tally_calc_bal(book, dates)        Audit.balances().at(d) for each date: the opening plus every entry from the book's
--                                      first day to d (tally_ledger_day: never a deleted, cancelled or optional entry), a
--                                      credit positive; the ledgers the browser's answer holds (the masters, and a ledger
--                                      with no master once it has an entry)
--   tally_balances_at(book, dates)     the same for a member of the book's firm: (date, ledger, bal)
--   tally_calc_tieout / tally_tieout   Rec.fincom (src/js/61) for each month-end: receivables and payables
--                                      (Parties.position), cash and bank, the profit after tax from the year's start
--                                      (MIS.pl), the trial balance's debit total (LK.tbBooks, with Tally's "Difference in
--                                      opening balances" line; none when it does not total)
--   tally_calc_ageing / tally_ageing   MIS.ageing (src/js/07; server/_shared/misageing.js): bill by bill (tally_bills, else
--                                      the line on account), by age from the due date, each party's open bills net of
--                                      payments on account, advances and the difference to its ledger balance
--                                      (MIS.netOpen), not bill-wise, advances, the control against the balance
--   tally_calc_results                 worked-out answers kept per book, kind and arguments with the book's data version
--                                      (tally_calc_version: the book's days and ledgers times, its entries' count, highest
--                                      AlterID and deletions, and FinCom's ledger list): an answer is used only while the
--                                      version is the same, so new entries make it worked out again (mis-run "now")
--   tally_calc_cached / tally_calc_put the answer kept for a member's client (only while current) / kept by the server
-- Adds only: new functions and one new table (RLS on; members read their own firm's rows; written by the service role
-- only). No index needed: tally_ledger_day (book_id, ledger, day) and (book_id, day), tally_lines (book_id, ledger, day),
-- tally_bills (book_id, guid), tally_vouchers (book_id, guid) are there. Safe to run twice.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- every ledger, as the browser's books hold it
create or replace function public.tally_calc_led(p_book uuid)
returns table (name text, open numeric, in_master boolean, path text[], kind text, deb boolean, cred boolean, cash boolean, bank boolean, pl boolean)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with bk as (select b.firm_id, b.client_id from tally_books b where b.book_id = p_book),
  -- the masters as TCloud.load reads them (merged_into is null); the path is the chain up to the primary group
  -- (ledGroupPath), else the parent and the primary group
  m as (select l.name, coalesce(l.open, 0) as open, true as im,
          case when coalesce(array_length(l.chain, 1), 0) > 0 then l.chain
               when coalesce(l.parent, '') <> '' then case when coalesce(l.primary_group, '') not in ('', l.parent) then array[l.parent, l.primary_group] else array[l.parent] end
               else '{}'::text[] end as path
          from tally_ledgers l where l.book_id = p_book and l.merged_into is null),
  -- a ledger with entries but no master: no opening, no group
  x as (select distinct d.ledger as name from tally_ledger_day d where d.book_id = p_book and d.merged_into is null
           and not exists (select 1 from m where m.name = d.ledger)),
  a as (select m.name, m.open, m.im, m.path from m union all select x.name, 0::numeric, false, '{}'::text[] from x),
  -- FinCom's ledger list (Books.ledgerOf: b.map, saved under client_book_items key "map", item "." + name)
  k as (select substr(i.item, 2) as name, coalesce(i.data->>'kind', '') as kind from client_book_items i, bk
         where i.firm_id = bk.firm_id and i.client_id = bk.client_id and i.key = 'map' and i.item like '.%' and not i.deleted),
  f as (select a.name, a.open, a.im, a.path, coalesce(k.kind, '') as kind, coalesce((select array_agg(lower(g)) from unnest(a.path) g), '{}'::text[]) as lp
          from a left join k on k.name = a.name),
  g as (select f.*, ('cash-in-hand' = any(f.lp)) or (f.path = '{}' and f.kind = 'bank' and f.name ~* '\yCASH\y') as is_cash from f)
  select g.name, g.open, g.im, g.path, g.kind,
         'sundry debtors' = any(g.lp),                                                    -- Audit.isDebtor
         'sundry creditors' = any(g.lp),                                                  -- Audit.isCreditor
         g.is_cash,                                                                       -- Audit.isCash
         (g.lp && array['bank accounts', 'bank od a/c', 'bank occ a/c']) or (g.kind = 'bank' and not g.is_cash),   -- Audit.isBankL
         -- MIS.plHead: a ledger in a profit and loss group (FS.nature's reserved groups, MIS.headByGroup); with no group,
         -- by its name when FinCom's list gives it no kind
         case when g.path <> '{}' then g.lp && array['sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses']
              else g.kind = '' and (g.name ~* '^SALES' or g.name ~* 'SERVICE RENDERED' or g.name ~* 'REVENUE' or g.name ~* '^PURCHASE') end
    from g;
$function$;

-- ---------------------------------------------------------------- Audit.balances().at(d), for several dates in one pass
create or replace function public.tally_calc_bal(p_book uuid, p_dates date[])
returns table (day date, ledger text, bal numeric, in_master boolean, deb boolean, cred boolean, cash boolean, bank boolean, pl boolean)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with bk as (select b.from_date from tally_books b where b.book_id = p_book),
  dts as (select z.x as d, (row_number() over (order by z.x))::int as k from (select distinct x from unnest(p_dates) x where x is not null) z),
  -- each day's totals go to the first date on or after it (width_bucket over the dates + 1: the count of dates before it)
  th as (select coalesce(array_agg(dts.d + 1 order by dts.d), '{}'::date[]) as a, max(dts.d) as last from dts),
  mv as (select ld.ledger, width_bucket(ld.day, th.a) + 1 as k, sum(ld.amount) as a
           from tally_ledger_day ld, th, bk
          where ld.book_id = p_book and ld.merged_into is null and ld.day >= bk.from_date and ld.day <= th.last
          group by 1, 2),
  led as (select * from tally_calc_led(p_book)),
  cum as (select dts.d, l.name, l.open, l.in_master, l.deb, l.cred, l.cash, l.bank, l.pl,
                 sum(mv.a) over w as c, count(mv.k) over w as n
            from led l cross join dts left join mv on mv.ledger = l.name and mv.k = dts.k
          window w as (partition by l.name order by dts.k))
  select cum.d, cum.name, cum.open + coalesce(cum.c, 0), cum.in_master, cum.deb, cum.cred, cum.cash, cum.bank, cum.pl
    from cum where cum.in_master or cum.n > 0;
$function$;

create or replace function public.tally_balances_at(p_book uuid, p_dates date[])
returns table (date date, ledger text, bal numeric)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if not exists (select 1 from tally_books b where b.book_id = p_book and b.firm_id = my_firm()) then
    raise exception 'not a company of your firm' using errcode = '42501';
  end if;
  return query select c.day, c.ledger, c.bal from tally_calc_bal(p_book, p_dates) c order by 1, 2;
end $function$;

-- ---------------------------------------------------------------- the month-end tie-out (Rec.fincom, src/js/61)
create or replace function public.tally_calc_tieout(p_book uuid, p_months text[])
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare b tally_books%rowtype; res jsonb;
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then return null; end if;
  with mo as (select distinct m, (date_trunc('month', m::date) + interval '1 month - 1 day')::date as e from unnest(p_months) m where m ~ '^\d{4}-\d{2}-01$'),
  fy as (select mo.m, mo.e, make_date(case when extract(month from mo.e) >= 4 then extract(year from mo.e)::int else extract(year from mo.e)::int - 1 end, 4, 1) as fs from mo),
  bal as (select * from tally_calc_bal(p_book, (select array_agg(e) || array_agg(fs - 1) from fy))),
  -- Tally's "Difference in opening balances": the openings of the masters (LK.openOff)
  od as (select round(-coalesce(sum(coalesce(l.open, 0)), 0), 2) as od from tally_ledgers l where l.book_id = p_book and l.merged_into is null),
  -- each date's figures in one pass over the balances
  ag as (select x.day,
      -- Parties.position: a debit balance as a positive figure; customers in debit owed to you, suppliers in credit owed by you
      coalesce(sum(-round(x.bal, 2)) filter (where x.deb and -round(x.bal, 2) > 0 and abs(round(x.bal, 2)) >= 0.005), 0) as receivables,
      coalesce(sum(round(x.bal, 2)) filter (where x.cred and not x.deb and -round(x.bal, 2) < 0 and abs(round(x.bal, 2)) >= 0.005), 0) as payables,
      coalesce(sum(-round(x.bal, 2)) filter (where x.cash or x.bank), 0) as cash_bank,
      coalesce(sum(x.bal) filter (where x.pl), 0) as pl,
      -- LK.tbBooks: every balance of a paisa or more, its debit side and its credit side
      coalesce(sum(-round(x.bal, 2)) filter (where abs(x.bal) >= 0.005 and -round(x.bal, 2) > 0), 0) as dr0,
      coalesce(sum(round(x.bal, 2)) filter (where abs(x.bal) >= 0.005 and -round(x.bal, 2) < 0), 0) as cr0
      from bal x group by x.day),
  -- MIS.pl(year's start, month-end).pat: every profit and loss ledger's entries in between, a credit positive
  per as (select fy.m, fy.e, fy.fs, coalesce(e.receivables, 0) as receivables, coalesce(e.payables, 0) as payables, coalesce(e.cash_bank, 0) as cash_bank,
            coalesce(e.pl, 0) - coalesce(s.pl, 0) as profit, coalesce(e.dr0, 0) as dr0, coalesce(e.cr0, 0) as cr0
            from fy left join ag e on e.day = fy.e left join ag s on s.day = fy.fs - 1),
  tb as (select per.*, od.od, (abs(od.od) >= 0.01 and abs((per.dr0 - per.cr0) - od.od) < 1) as with_od from per, od),
  tb2 as (select tb.*, tb.dr0 + case when tb.with_od and -tb.od > 0 then -tb.od else 0 end as dr, tb.cr0 + case when tb.with_od and -tb.od < 0 then tb.od else 0 end as cr from tb)
  select coalesce(jsonb_object_agg(tb2.m, jsonb_build_object(
      'end', to_char(tb2.e, 'YYYYMMDD'),
      'receivables', round(tb2.receivables, 2), 'payables', round(tb2.payables, 2), 'cash_bank', round(tb2.cash_bank, 2),
      'profit', case when b.from_date > tb2.fs then null else round(tb2.profit, 2) end,
      'tb_total', case when abs(tb2.dr - tb2.cr) >= 1 then null else round(tb2.dr, 2) end,
      'why', jsonb_strip_nulls(jsonb_build_object(
        'profit', case when b.from_date > tb2.fs then 'the books here begin after ' || to_char(tb2.fs, 'DD-Mon-YYYY') end,
        'tb_total', case when abs(tb2.dr - tb2.cr) >= 1 then 'the trial balance here does not total (off by ' || to_char(round(tb2.dr - tb2.cr, 2), 'FM9999999999990.00') || ')' end)))), '{}'::jsonb)
    into res from tb2;
  return res;
end $function$;

create or replace function public.tally_tieout(p_client text, p_months text[])
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare bk uuid := tally_pick(p_client, null);
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  return jsonb_build_object('book', bk, 'months', tally_calc_tieout(bk, p_months));
end $function$;

-- ---------------------------------------------------------------- the ageing (MIS.bills, MIS.ageing, MIS.netOpen)
create or replace function public.tally_calc_ageing(p_book uuid, p_as_on date, p_side text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare res jsonb;
begin
  if p_side not in ('r', 'p') or p_as_on is null or not exists (select 1 from tally_books b where b.book_id = p_book) then return null; end if;
  -- the balances on the day (Parties.position's), with each ledger's side; the parties of the side
  with ab as materialized (select c.ledger, c.bal, c.deb, c.cred from tally_calc_bal(p_book, array[p_as_on]) c),
  pty as (select ab.ledger as name from ab where case when p_side = 'r' then ab.deb else ab.cred end),
  -- the entries up to the day; never a deleted, cancelled or optional one
  ln as (select t.guid, t.ledger, t.amount, t.id, v.day, coalesce(v.vno, '') as vno
           from tally_lines t join pty on pty.name = t.ledger
           join tally_vouchers v on v.book_id = t.book_id and v.guid = t.guid
          where t.book_id = p_book and v.day <= p_as_on and v.deleted_at is null and not coalesce(v.cancelled, false) and not coalesce(v.optional, false)),
  lk as (select distinct ln.guid, ln.ledger, ln.day, ln.vno from ln),
  bl as (select x.guid, x.ledger, x.id, coalesce(x.name, '') as nm, coalesce(x.type, '') as ty, coalesce(x.amount, 0) as amt, coalesce(x.credit_days, 0) as cd
           from tally_bills x join lk on lk.guid = x.guid and lk.ledger = x.ledger where x.book_id = p_book),
  -- each allocation; a line with none is one "On Account" of its whole amount
  al as (select lk.ledger, lk.day, lk.vno, lk.guid, bl.id as ord, bl.nm, bl.ty, bl.amt, bl.cd from lk join bl on bl.guid = lk.guid and bl.ledger = lk.ledger
         union all
         select ln.ledger, ln.day, ln.vno, ln.guid, ln.id, '', 'On Account', ln.amount, 0 from ln
          where not exists (select 1 from bl where bl.guid = ln.guid and bl.ledger = ln.ledger)),
  ky as (select al.*, case when al.ty = 'On Account' or al.nm = '' then '' else al.nm end as ref, case when p_side = 'r' then -al.amt else al.amt end as s from al),
  ag as (select ky.ledger as party, ky.ref, round(sum(ky.s), 2) as amt, min(ky.day) as first,
           (array_agg(ky.day order by ky.day, ky.guid, ky.ord) filter (where ky.ty in ('New Ref', 'Advance')))[1] as nd,
           (array_agg(ky.vno order by ky.day, ky.guid, ky.ord) filter (where ky.ty in ('New Ref', 'Advance')))[1] as nno,
           (array_agg(case when ky.ty = 'New Ref' and ky.cd > 0 then ky.cd end order by ky.day, ky.guid, ky.ord) filter (where ky.ty in ('New Ref', 'Advance')))[1] as ndays
           from ky group by 1, 2),
  bi as (select ag.party, ag.ref, ag.amt, coalesce(ag.nd, ag.first) as date, ag.nd is not null as has_new, coalesce(ag.nno, '') as no,
           case when ag.ndays is not null then coalesce(ag.nd, ag.first) + ag.ndays::int end as due
           from ag where abs(ag.amt) >= 0.5),
  bx as (select bi.*, p_as_on - bi.date as age, case when bi.due is not null then greatest(0, p_as_on - bi.due) else p_as_on - bi.date end as od from bi),
  bk2 as (select bx.*, case when bx.od <= 30 then 1 when bx.od <= 60 then 2 when bx.od <= 90 then 3 when bx.od <= 180 then 4 else 5 end as bucket,
            case when bx.ref = '' then 'unalloc' when not bx.has_new then 'pre' when bx.amt < 0 then 'adv' else 'open' end as cls from bx),
  -- each party: its bills, or (a balance but no bill in the books read) a row of its own
  pa as (select bk2.party, false as no_bills from bk2 group by 1
         union all
         select a.ledger, true from ab a where case when p_side = 'r' then a.deb else a.cred end and abs(a.bal) >= 0.005
            and not exists (select 1 from bk2 where bk2.party = a.ledger)),
  pg as (select x.party, round(sum(x.amt), 2) as total,
           coalesce(round(sum(x.amt) filter (where x.cls = 'adv'), 2), 0) as adv, coalesce(round(sum(x.amt) filter (where x.cls = 'unalloc'), 2), 0) as unalloc,
           coalesce(round(sum(x.amt) filter (where x.cls = 'pre'), 2), 0) as pre, coalesce(max(x.od) filter (where x.cls = 'open'), 0) as oldest,
           array[coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 1), 2), 0), coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 2), 2), 0),
                 coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 3), 2), 0), coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 4), 2), 0),
                 coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 5), 2), 0)] as b
           from bk2 x group by 1),
  pr as (select pa.party, pa.no_bills, coalesce(pg.total, 0) as total, coalesce(pg.adv, 0) as adv, coalesce(pg.unalloc, 0) as unalloc, coalesce(pg.pre, 0) as pre,
           coalesce(pg.oldest, 0) as oldest, coalesce(pg.b, array[0, 0, 0, 0, 0]::numeric[]) as b,
           round(case when p_side = 'r' then -ab.bal else ab.bal end, 2) as tally
           from pa left join pg on pg.party = pa.party left join ab on ab.ledger = pa.party),
  pn as (select pr.*, case when pr.tally is not null then round(pr.tally - pr.total, 2) end as diff, coalesce(pr.tally, pr.total) as net, greatest(0, coalesce(pr.tally, pr.total)) as owe from pr),
  -- MIS.netOpen: what the bills carry beyond the balance is set against the oldest bills first
  ob as (select x.party, x.ref, x.date, x.due, x.age, x.od, x.amt, x.no, x.bucket,
           sum(x.amt) over (partition by x.party) - pn.owe as less0,
           coalesce(sum(x.amt) over (partition by x.party order by x.date, x.ref rows between unbounded preceding and 1 preceding), 0) as before
           from bk2 x join pn on pn.party = x.party where x.cls = 'open'),
  ol as (select ob.*, ob.amt - greatest(0, least(ob.amt, ob.less0 - ob.before)) as left_ from ob),
  oo as (select ol.* from ol where ol.left_ >= 0.005),
  og as (select o.party,
           array[coalesce(round(sum(o.left_) filter (where o.bucket = 1), 2), 0), coalesce(round(sum(o.left_) filter (where o.bucket = 2), 2), 0), coalesce(round(sum(o.left_) filter (where o.bucket = 3), 2), 0),
                 coalesce(round(sum(o.left_) filter (where o.bucket = 4), 2), 0), coalesce(round(sum(o.left_) filter (where o.bucket = 5), 2), 0)] as nb,
           sum(o.left_) as left_all,
           jsonb_agg(jsonb_build_object('ref', o.ref, 'date', to_char(o.date, 'YYYYMMDD'), 'due', coalesce(to_char(o.due, 'YYYYMMDD'), ''), 'age', o.age, 'od', o.od,
                      'amt', o.amt, 'left', round(o.left_, 2), 'no', o.no) order by o.date, o.ref) as open_bills
           from oo o group by 1),
  rows_ as (select pn.*, coalesce(og.nb, array[0, 0, 0, 0, 0]::numeric[]) as nb, round(pn.owe - coalesce(og.left_all, 0), 2) as und0,
           case when pn.net < 0 then round(-pn.net, 2) else 0 end as advance, coalesce(og.open_bills, '[]'::jsonb) as open_bills
           from pn left join og on og.party = pn.party),
  rr as (select rows_.*, case when rows_.und0 >= 0.005 then rows_.und0 else 0 end as und from rows_)
  select jsonb_build_object('asOn', to_char(p_as_on, 'YYYYMMDD'), 'side', p_side,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('party', rr.party, 'total', rr.total, 'b', to_jsonb(rr.b), 'adv', rr.adv, 'unalloc', rr.unalloc, 'pre', rr.pre, 'oldest', rr.oldest,
               'tally', rr.tally, 'diff', rr.diff, 'net', round(rr.net, 2), 'owe', round(rr.owe, 2), 'open', rr.open_bills, 'nb', to_jsonb(rr.nb), 'und', rr.und, 'advance', rr.advance, 'noBills', rr.no_bills)
               order by rr.total desc, rr.party) from rr), '[]'::jsonb),
    'sum', (select jsonb_build_object('total', coalesce(round(sum(rr.total), 2), 0),
               'b', (select jsonb_agg(coalesce((select round(sum(rr2.b[i]), 2) from rr rr2), 0) order by i) from generate_series(1, 5) i),
               'adv', coalesce(round(sum(rr.adv), 2), 0), 'unalloc', coalesce(round(sum(rr.unalloc), 2), 0), 'pre', coalesce(round(sum(rr.pre), 2), 0),
               'tally', round(sum(rr.tally), 2),
               'open', coalesce(round(sum(rr.b[1] + rr.b[2] + rr.b[3] + rr.b[4] + rr.b[5]), 2), 0),
               'owe', coalesce(round(sum(greatest(0, rr.net)), 2), 0), 'advance', coalesce(round(sum(rr.advance), 2), 0),
               'nb', (select jsonb_agg(coalesce((select round(sum(rr2.nb[i]), 2) from rr rr2), 0) order by i) from generate_series(1, 5) i),
               'und', coalesce(round(sum(rr.und), 2), 0), 'diff', coalesce(round(sum(coalesce(rr.diff, 0)), 2), 0),
               'differ', coalesce((select jsonb_agg(jsonb_build_object('party', d.party, 'bills', d.total, 'ledger', d.tally, 'diff', d.diff) order by abs(d.diff) desc, d.party)
                                    from rr d where d.diff is not null and abs(d.diff) >= 1), '[]'::jsonb)) from rr))
    into res;
  return res;
end $function$;

create or replace function public.tally_ageing(p_client text, p_as_on date, p_side text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare bk uuid := tally_pick(p_client, p_as_on);
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  return tally_calc_ageing(bk, p_as_on, p_side) || jsonb_build_object('book', bk);
end $function$;

-- ---------------------------------------------------------------- worked-out answers, kept while the books are the same
create table if not exists public.tally_calc_results (
  book_id   uuid not null,
  firm_id   uuid not null,
  kind      text not null,            -- 'mis-now', ...
  args      text not null,            -- e.g. '20250401|20260331'
  version   text not null,            -- tally_calc_version(book) when worked out
  result    jsonb not null,
  ms        integer,                  -- how long it took
  at        timestamptz not null default now(),
  primary key (book_id, kind, args)
);
alter table public.tally_calc_results enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_calc_results' and policyname = 'tally_calc_results_read') then
    create policy tally_calc_results_read on public.tally_calc_results for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_calc_results from public, anon, authenticated;
grant select on public.tally_calc_results to authenticated;
grant all on public.tally_calc_results to service_role;

-- the book's data version: moved by every day read (days_at), every ledger list (ledgers_at), every entry the bridge's
-- lines add, change or delete (count, highest AlterID, deletions), and every change to FinCom's ledger list
create or replace function public.tally_calc_version(p_book uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select md5(concat_ws('|', b.days_at, b.ledgers_at, b.from_date,
           (select concat_ws(':', count(*), max(v.alter_id), count(v.deleted_at), max(v.deleted_at), count(*) filter (where v.cancelled), count(*) filter (where v.optional))
              from tally_vouchers v where v.book_id = b.book_id),
           (select concat_ws(':', count(*), max(i.seq), max(i.updated_at)) from client_book_items i
             where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'map')))
    from tally_books b where b.book_id = p_book;
$function$;

-- a member: the answer kept for its client, only while it is current ({book, version, result: null when not})
create or replace function public.tally_calc_cached(p_client text, p_on date, p_kind text, p_args text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare bk uuid := tally_pick(p_client, p_on); v text; r tally_calc_results%rowtype;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  v := tally_calc_version(bk);
  select * into r from tally_calc_results x where x.book_id = bk and x.kind = p_kind and x.args = p_args and x.firm_id = my_firm();
  return jsonb_build_object('book', bk, 'version', v, 'result', case when r.version = v then r.result end, 'at', case when r.version = v then r.at end);
end $function$;

-- the server: keep an answer (the version it was worked out on)
create or replace function public.tally_calc_put(p_book uuid, p_kind text, p_args text, p_version text, p_result jsonb, p_ms integer default null)
returns void language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  insert into tally_calc_results (book_id, firm_id, kind, args, version, result, ms, at)
  select b.book_id, b.firm_id, p_kind, p_args, p_version, p_result, p_ms, now() from tally_books b where b.book_id = p_book
  on conflict (book_id, kind, args) do update set version = excluded.version, result = excluded.result, ms = excluded.ms, at = excluded.at;
$function$;

-- the service role only: the functions on a book id (no firm check of their own)
revoke all on function public.tally_calc_led(uuid) from public, anon, authenticated;
revoke all on function public.tally_calc_bal(uuid, date[]) from public, anon, authenticated;
revoke all on function public.tally_calc_tieout(uuid, text[]) from public, anon, authenticated;
revoke all on function public.tally_calc_ageing(uuid, date, text) from public, anon, authenticated;
revoke all on function public.tally_calc_version(uuid) from public, anon, authenticated;
revoke all on function public.tally_calc_put(uuid, text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.tally_calc_led(uuid) to service_role;
grant execute on function public.tally_calc_bal(uuid, date[]) to service_role;
grant execute on function public.tally_calc_tieout(uuid, text[]) to service_role;
grant execute on function public.tally_calc_ageing(uuid, date, text) to service_role;
grant execute on function public.tally_calc_version(uuid) to service_role;
grant execute on function public.tally_calc_put(uuid, text, text, text, jsonb, integer) to service_role;
-- a member of the firm: its own firm's books only (my_firm(), tally_pick)
revoke all on function public.tally_balances_at(uuid, date[]) from public, anon;
revoke all on function public.tally_tieout(text, text[]) from public, anon;
revoke all on function public.tally_ageing(text, date, text) from public, anon;
revoke all on function public.tally_calc_cached(text, date, text, text) from public, anon;
grant execute on function public.tally_balances_at(uuid, date[]) to authenticated, service_role;
grant execute on function public.tally_tieout(text, text[]) to authenticated, service_role;
grant execute on function public.tally_ageing(text, date, text) to authenticated, service_role;
grant execute on function public.tally_calc_cached(text, date, text, text) to authenticated, service_role;

commit;
