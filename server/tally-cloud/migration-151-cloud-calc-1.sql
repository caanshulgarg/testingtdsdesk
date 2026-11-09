-- Migration 151 (09-Nov-2026, branch next-cloud-calc1; written, NOT run: the owner reads it and runs it).
-- The owner, 09-Nov-2026: "it should not freeze at all, whatever the book size; calculation should happen in cloud".
-- The browser downloads a client's whole books (TCloud.load) and works every figure out itself: on a book of 40,000
-- entries a balance, the month-end tie-out or the ageing held the page for seconds. Phase 1, the server side only: the
-- same figures worked out here from the cloud copy (tally_ledgers, tally_ledger_day, tally_vouchers, tally_lines,
-- tally_bills) and FinCom's ledger list (client_book_items, key "map"), by the browser's own rules, ported one by one
-- (tests/run_migration151.py checks each figure against the browser's engine on the same made-up books). Nothing in the
-- browser changes yet.
--
--   tally_calc_led(book)               every ledger as the browser sees it (TCloud.load, TallyRead.balances and
--                                      yearOpen): the masters not merged and not deleted in Tally, any ledger with entries
--                                      but no master; its opening, its group path (the parent, then tally_groups up), the
--                                      kind in FinCom's ledger list, and the browser's tests: Audit.isDebtor / isCreditor /
--                                      isCash / isBankL, and MIS.plHead (a profit and loss ledger)
--   tally_calc_bal(book, dates)        Audit.balances().at(d) for each date (at most 400): the opening plus every entry
--                                      from the book's first day to d (tally_ledger_day: never a deleted, cancelled or
--                                      optional entry), a credit positive; the ledgers the browser's answer holds
--   tally_balances_at(book, dates)     the same for a member of the book's firm: (date, ledger, bal) rows
--   tally_balances_json(book, dates)   the same as one value {date: {ledger: bal}} (no REST row limit)
--   tally_calc_tieout / tally_tieout   Rec.fincom (src/js/61) for each month-end (at most 120), each month from the book
--                                      that covers it: receivables and payables (Parties.position), cash and bank, the
--                                      profit after tax from the year's start (MIS.pl), the trial balance's debit total
--                                      (LK.tbBooks, with "Difference in opening balances"; none when it does not total)
--   tally_calc_ageing(_bal) / tally_ageing  MIS.ageing (src/js/07; server/_shared/misageing.js): bill by bill
--                                      (tally_bills, else the line on account), by age from the due date, each party's
--                                      open bills net of payments on account, advances and the difference to its ledger
--                                      balance (MIS.netOpen), not bill-wise, advances, the control against the balance
--   tally_now(client, from, to)        mis-run "now" in one call: both ageings, owed (Parties.position(to)), cash and bank
--                                      (MIS.runNow's r.balances), every balance on the day; all from one working of it
--   tally_calc_results                 worked-out answers kept per book, kind and arguments with the book's data version
--                                      (tally_calc_version, with FinCom's working CALC_V): used only while the version is
--                                      the same, so new entries, a rename or a fix make it worked out again
--   tally_calc_cached / tally_calc_put the answer kept for a member's client (only while current) / kept by the server
-- Adds only: new functions and one new table (RLS on; members read their own firm's rows; written by the service role
-- only). No index needed: tally_ledger_day (book_id, ledger, day) and (book_id, day), tally_lines (book_id, ledger, day),
-- tally_bills (book_id, guid), tally_vouchers (book_id, guid), tally_groups (book_id, name) are there. Safe to run twice.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- every ledger, as the browser's books hold it
-- TCloud.load: the masters not merged and not deleted in Tally (TCloud.restAll adds deleted_at=is.null; a deleted ledger
-- that still has entries is a ledger with no master), put in by TallyRead.balances: under[ledger] = its parent, and
-- TallyRead.yearOpen when the copy starts on 1 April and the groups are read: the openings of the profit and loss
-- ledgers go to "Profit & Loss A/c". The group path is ledGroupPath's: the parent, then each group's parent in
-- tally_groups (tally_groups is what TCloud.groupsInto reads); a book with no groups read: the chain the bridge sent.
create or replace function public.tally_calc_led(p_book uuid)
returns table (name text, open numeric, in_master boolean, path text[], kind text, deb boolean, cred boolean, cash boolean, bank boolean, pl boolean)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with recursive bk as (select b.firm_id, b.client_id, b.from_date from tally_books b where b.book_id = p_book),
  grp as (select g.name, coalesce(g.parent, '') as parent from tally_groups g where g.book_id = p_book),
  -- each group's way up: itself, then its parent while that is a group (ledGroupPath; at most 15 names)
  gw (top, cur, path, n) as (
    select grp.name, grp.parent, array[grp.name], 1 from grp
    union all
    select gw.top, coalesce(p.parent, ''), gw.path || gw.cur, gw.n + 1 from gw left join grp p on p.name = gw.cur where gw.cur <> '' and gw.n < 15),
  gp0 as (select distinct on (gw.top) gw.top as name, gw.path from gw order by gw.top, gw.n desc),
  -- and its primary group (TallyRead.primaryOf: the last name before "Primary"), once a group, not once a ledger
  gpath as (select gp0.name, gp0.path, (select (array_agg(u.g order by u.i desc))[1] from unnest(gp0.path) with ordinality u(g, i)
                    where u.i < coalesce((select min(v.i) from unnest(gp0.path) with ordinality v(g, i) where v.g ~* '^\W*Primary$'), 1000)) as prim from gp0),
  hasg as (select exists (select 1 from grp) as y),
  m1 as (select l.name, coalesce(l.open, 0) as open,
           case when not (select y from hasg) or coalesce(l.parent, '') = '' then null when gp.name is not null then gp.prim when l.parent !~* '^\W*Primary$' then l.parent end as prim,
           case when coalesce(l.parent, '') = '' then '{}'::text[]
                when (select y from hasg) then coalesce(gp.path, array[l.parent])
                when coalesce(array_length(l.chain, 1), 0) > 0 then l.chain
                when coalesce(l.primary_group, '') not in ('', l.parent) then array[l.parent, l.primary_group]
                else array[l.parent] end as path
           from tally_ledgers l left join gpath gp on gp.name = l.parent
          where l.book_id = p_book and l.merged_into is null and l.deleted_at is null),
  -- TallyRead.yearOpen: a profit and loss ledger's opening moves when the copy starts on 1 April and the groups are read
  yo as (select (extract(month from bk.from_date) = 4 and extract(day from bk.from_date) = 1 and (select y from hasg)) as on_ from bk),
  m2 as (select m1.name, m1.open, m1.path,
           (select on_ from yo) and m1.name <> 'Profit & Loss A/c' and m1.open <> 0
             and lower(btrim(coalesce(m1.prim, ''))) in ('sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses') as moves
           from m1),
  mv as (select coalesce(sum(m2.open) filter (where m2.moves), 0) as amt, count(*) filter (where m2.moves) as n from m2),
  m as (select m2.name, case when m2.moves then 0 when m2.name = 'Profit & Loss A/c' and (select n from mv) > 0 then m2.open + (select amt from mv) else m2.open end as open, true as im, m2.path from m2
        union all
        select 'Profit & Loss A/c', (select amt from mv), true, '{}'::text[] where (select n from mv) > 0 and not exists (select 1 from m2 where m2.name = 'Profit & Loss A/c')),
  -- a ledger with entries but no master: no opening, no group
  x as (select distinct d.ledger as name from tally_ledger_day d where d.book_id = p_book and d.merged_into is null
           and not exists (select 1 from m where m.name = d.ledger)),
  a as (select m.name, m.open, m.im, m.path from m union all select x.name, 0::numeric, false, '{}'::text[] from x),
  -- FinCom's ledger list (Books.ledgerOf: b.map, saved under client_book_items key "map", item "." + name)
  k as (select substr(i.item, 2) as name, coalesce(i.data->>'kind', '') as kind from client_book_items i, bk
         where i.firm_id = bk.firm_id and i.client_id = bk.client_id and i.key = 'map' and i.item like '.%' and not i.deleted),
  -- materialized: inlined, the planner ran the masters' part again for every ledger (1.2 s on 10,000 ledgers; 0.17 s so)
  f as materialized (select a.name, a.open, a.im, a.path, coalesce(k.kind, '') as kind, coalesce((select array_agg(lower(g)) from unnest(a.path) g), '{}'::text[]) as lp
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
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
#variable_conflict use_column
begin
  if cardinality(p_dates) > 400 then raise exception 'at most 400 dates' using errcode = '22023'; end if;
  return query
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
end $function$;

create or replace function public.tally_balances_at(p_book uuid, p_dates date[])
returns table (date date, ledger text, bal numeric)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if not exists (select 1 from tally_books b where b.book_id = p_book and b.firm_id = my_firm()) then
    raise exception 'not a company of your firm' using errcode = '42501';
  end if;
  return query select c.day, c.ledger, c.bal from tally_calc_bal(p_book, p_dates) c order by 1, 2;
end $function$;

-- the same as one value {"YYYYMMDD": {ledger: balance}} (a REST call of rows stops at 1,000)
create or replace function public.tally_balances_json(p_book uuid, p_dates date[])
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare res jsonb;
begin
  if not exists (select 1 from tally_books b where b.book_id = p_book and b.firm_id = my_firm()) then
    raise exception 'not a company of your firm' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(d, m), '{}'::jsonb) into res
    from (select to_char(c.day, 'YYYYMMDD') as d, jsonb_object_agg(c.ledger, c.bal) as m from tally_calc_bal(p_book, p_dates) c group by c.day) z;
  return res;
end $function$;

-- ---------------------------------------------------------------- the month-end tie-out (Rec.fincom, src/js/61)
create or replace function public.tally_calc_tieout(p_book uuid, p_months text[])
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare b tally_books%rowtype; res jsonb;
begin
  if cardinality(p_months) > 120 then raise exception 'at most 120 months' using errcode = '22023'; end if;
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then return null; end if;
  with mo as (select distinct m, (date_trunc('month', m::date) + interval '1 month - 1 day')::date as e from unnest(p_months) m where m ~ '^\d{4}-\d{2}-01$'),
  fy as (select mo.m, mo.e, make_date(case when extract(month from mo.e) >= 4 then extract(year from mo.e)::int else extract(year from mo.e)::int - 1 end, 4, 1) as fs from mo),
  bal as (select * from tally_calc_bal(p_book, (select array_agg(e) || array_agg(fs - 1) from fy))),
  -- Tally's "Difference in opening balances": the openings of the masters (LK.openOff: tb.led, not merged, not deleted; yearOpen keeps their sum)
  od as (select round(-coalesce(sum(coalesce(l.open, 0)), 0), 2) as od from tally_ledgers l where l.book_id = p_book and l.merged_into is null and l.deleted_at is null),
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

-- a member: each month from the book that covers its month-end (tally_pick(client, month-end), as every other function
-- picks the book for its day); {book: the last month's, books: {month: book}, months: {month: figures}}
create or replace function public.tally_tieout(p_client text, p_months text[])
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare r record; res jsonb := '{}'; bks jsonb := '{}'; last_bk uuid;
begin
  if cardinality(p_months) > 120 then raise exception 'at most 120 months' using errcode = '22023'; end if;
  for r in select z.bk, array_agg(z.m order by z.m) as ms, max(z.m) as mx from
             (select m, tally_pick(p_client, (date_trunc('month', m::date) + interval '1 month - 1 day')::date) as bk from unnest(p_months) m where m ~ '^\d{4}-\d{2}-01$') z
            where z.bk is not null group by z.bk order by max(z.m) loop
    res := res || coalesce(tally_calc_tieout(r.bk, r.ms), '{}'::jsonb);
    select bks || coalesce(jsonb_object_agg(x, r.bk), '{}'::jsonb) into bks from unnest(r.ms) x;
    last_bk := r.bk;
  end loop;
  if last_bk is null then return jsonb_build_object('none', true); end if;
  return jsonb_build_object('book', last_bk, 'books', bks, 'months', res);
end $function$;

-- ---------------------------------------------------------------- the ageing (MIS.bills, MIS.ageing, MIS.netOpen)
-- p_bal: the balances on the day of the customers and suppliers, {ledger: [balance, is a debtor, is a creditor]}
-- (worked out once by the caller: tally_calc_ageing below, tally_now). p_side 'r' or 'p': that side's ageing; 'rp': both
-- in one pass over the entries and bills, {r: ..., p: ...}
create or replace function public.tally_calc_ageing_json(p_book uuid, p_as_on date, p_side text, p_bal jsonb)
returns json language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare res json;
begin
  if p_side not in ('r', 'p', 'rp') or p_as_on is null or not exists (select 1 from tally_books b where b.book_id = p_book) then return null; end if;
  with ab as materialized (select e.key as ledger, (e.value->>0)::numeric as bal, (e.value->>1)::boolean as deb, (e.value->>2)::boolean as cred from jsonb_each(coalesce(p_bal, '{}'::jsonb)) e),
  -- the parties of each side asked (Audit.isDebtor for 'r', Audit.isCreditor for 'p')
  pty as materialized (select ab.ledger as name, 'r' as sd from ab where ab.deb and strpos(p_side, 'r') > 0
                       union all select ab.ledger, 'p' from ab where ab.cred and strpos(p_side, 'p') > 0),
  pn1 as (select distinct pty.name from pty),
  -- the entries up to the day; never a deleted, cancelled or optional one. A line carries its entry's day (as
  -- tally_ledger_day_rebuild reads it; on staging no line differs from its entry, none has no entry); the entry's number
  -- is read only for a bill's first New Ref (fn below)
  vx as materialized (select v.guid from tally_vouchers v where v.book_id = p_book and (v.deleted_at is not null or coalesce(v.cancelled, false) or coalesce(v.optional, false))),
  lk as materialized (select t.guid, t.ledger, min(t.day) as day, sum(t.amount) as lt, min(t.id) as id
           from tally_lines t join pn1 on pn1.name = t.ledger where t.book_id = p_book and t.day <= p_as_on and not exists (select 1 from vx where vx.guid = t.guid) group by 1, 2),
  bl as materialized (select x.guid, x.ledger, x.id, coalesce(x.name, '') as nm, coalesce(x.type, '') as ty, coalesce(x.amount, 0) as amt, coalesce(x.credit_days, 0) as cd
           from tally_bills x join pn1 on pn1.name = x.ledger join lk on lk.guid = x.guid and lk.ledger = x.ledger where x.book_id = p_book),
  bs as (select bl.guid, bl.ledger, sum(bl.amt) as amt from bl group by 1, 2),
  -- each allocation; a line with none is one "On Account" of its whole amount. The cloud keeps an entry's bills by
  -- party, not by line: with two lines of one party and bills on one, what the bills do not cover is on account
  al as (select lk.ledger, lk.day, lk.guid, bl.id as ord, bl.nm, bl.ty, bl.amt, bl.cd from lk join bl on bl.guid = lk.guid and bl.ledger = lk.ledger
         union all
         select lk.ledger, lk.day, lk.guid, lk.id, '', 'On Account', lk.lt - coalesce(bs.amt, 0), 0 from lk left join bs on bs.guid = lk.guid and bs.ledger = lk.ledger
          where bs.guid is null or abs(lk.lt - bs.amt) >= 0.005),
  ky as (select al.*, pty.sd, case when al.ty = 'On Account' or al.nm = '' then '' else al.nm end as ref, case when pty.sd = 'r' then -al.amt else al.amt end as s
           from al join pty on pty.name = al.ledger),
  -- the first New Ref or Advance of a bill (in the order of the entries): its date, entry number and credit days
  fn0 as (select distinct on (ky.sd, ky.ledger, ky.ref) ky.sd, ky.ledger, ky.ref, ky.day, ky.guid, case when ky.ty = 'New Ref' and ky.cd > 0 then ky.cd end as cd
           from ky where ky.ty in ('New Ref', 'Advance') order by ky.sd, ky.ledger, ky.ref, ky.day, ky.guid, ky.ord),
  fn as (select fn0.*, coalesce(v.vno, '') as vno from fn0 left join tally_vouchers v on v.book_id = p_book and v.guid = fn0.guid),
  ag0 as (select ky.sd, ky.ledger as party, ky.ref, round(sum(ky.s), 2) as amt, min(ky.day) as first from ky group by 1, 2, 3),
  ag as (select ag0.*, fn.day as nd, fn.vno as nno, fn.cd as ndays from ag0 left join fn on fn.sd = ag0.sd and fn.ledger = ag0.party and fn.ref = ag0.ref),
  bi as (select ag.sd, ag.party, ag.ref, ag.amt, coalesce(ag.nd, ag.first) as date, ag.nd is not null as has_new, coalesce(ag.nno, '') as no,
           case when ag.ndays is not null then coalesce(ag.nd, ag.first) + ag.ndays::int end as due
           from ag where abs(ag.amt) >= 0.5),
  bx as (select bi.*, p_as_on - bi.date as age, case when bi.due is not null then greatest(0, p_as_on - bi.due) else p_as_on - bi.date end as od from bi),
  bk2 as materialized (select bx.*, case when bx.od <= 30 then 1 when bx.od <= 60 then 2 when bx.od <= 90 then 3 when bx.od <= 180 then 4 else 5 end as bucket,
            case when bx.ref = '' then 'unalloc' when not bx.has_new then 'pre' when bx.amt < 0 then 'adv' else 'open' end as cls from bx),
  pg as (select x.sd, x.party, round(sum(x.amt), 2) as total,
           coalesce(round(sum(x.amt) filter (where x.cls = 'adv'), 2), 0) as adv, coalesce(round(sum(x.amt) filter (where x.cls = 'unalloc'), 2), 0) as unalloc,
           coalesce(round(sum(x.amt) filter (where x.cls = 'pre'), 2), 0) as pre, coalesce(max(x.od) filter (where x.cls = 'open'), 0) as oldest,
           array[coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 1), 2), 0), coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 2), 2), 0),
                 coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 3), 2), 0), coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 4), 2), 0),
                 coalesce(round(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 5), 2), 0)] as b
           from bk2 x group by 1, 2),
  -- each party: its bills, or (a balance but no bill in the books read) a row of its own
  pa as (select pg.sd, pg.party, false as no_bills from pg
         union all
         select pty.sd, pty.name, true from pty join ab a on a.ledger = pty.name where abs(a.bal) >= 0.005
            and not exists (select 1 from pg where pg.sd = pty.sd and pg.party = pty.name)),
  pr as (select pa.sd, pa.party, pa.no_bills, coalesce(pg.total, 0) as total, coalesce(pg.adv, 0) as adv, coalesce(pg.unalloc, 0) as unalloc, coalesce(pg.pre, 0) as pre,
           coalesce(pg.oldest, 0) as oldest, coalesce(pg.b, array[0, 0, 0, 0, 0]::numeric[]) as b,
           round(case when pa.sd = 'r' then -ab.bal else ab.bal end, 2) as tally
           from pa left join pg on pg.sd = pa.sd and pg.party = pa.party left join ab on ab.ledger = pa.party),
  pn as materialized (select pr.*, case when pr.tally is not null then round(pr.tally - pr.total, 2) end as diff, coalesce(pr.tally, pr.total) as net, greatest(0, coalesce(pr.tally, pr.total)) as owe from pr),
  -- MIS.netOpen: what the bills carry beyond the balance is set against the oldest bills first
  ob as (select x.sd, x.party, x.ref, x.date, x.due, x.age, x.od, x.amt, x.no, x.bucket,
           sum(x.amt) over (partition by x.sd, x.party) - pn.owe as less0,
           coalesce(sum(x.amt) over (partition by x.sd, x.party order by x.date, x.ref rows between unbounded preceding and 1 preceding), 0) as before
           from bk2 x join pn on pn.sd = x.sd and pn.party = x.party where x.cls = 'open'),
  ol as (select ob.*, ob.amt - greatest(0, least(ob.amt, ob.less0 - ob.before)) as left_ from ob),
  oo as (select ol.* from ol where ol.left_ >= 0.005),
  og as (select o.sd, o.party,
           array[coalesce(round(sum(o.left_) filter (where o.bucket = 1), 2), 0), coalesce(round(sum(o.left_) filter (where o.bucket = 2), 2), 0), coalesce(round(sum(o.left_) filter (where o.bucket = 3), 2), 0),
                 coalesce(round(sum(o.left_) filter (where o.bucket = 4), 2), 0), coalesce(round(sum(o.left_) filter (where o.bucket = 5), 2), 0)] as nb,
           sum(o.left_) as left_all,
           json_agg(json_build_object('ref', o.ref, 'date', to_char(o.date, 'YYYYMMDD'), 'due', coalesce(to_char(o.due, 'YYYYMMDD'), ''), 'age', o.age, 'od', o.od,
                      'amt', o.amt, 'left', round(o.left_, 2), 'no', o.no) order by o.date, o.ref) as open_bills
           from oo o group by 1, 2),
  rows_ as (select pn.*, coalesce(og.nb, array[0, 0, 0, 0, 0]::numeric[]) as nb, round(pn.owe - coalesce(og.left_all, 0), 2) as und0,
           case when pn.net < 0 then round(-pn.net, 2) else 0 end as advance, coalesce(og.open_bills, '[]'::json) as open_bills
           from pn left join og on og.sd = pn.sd and og.party = pn.party),
  rr as materialized (select rows_.*, case when rows_.und0 >= 0.005 then rows_.und0 else 0 end as und from rows_),
  sides as (select x as sd from unnest(case p_side when 'rp' then array['r', 'p'] else array[p_side] end) x),
  one as (select sides.sd, json_build_object('asOn', to_char(p_as_on, 'YYYYMMDD'), 'side', sides.sd,
    'rows', coalesce((select json_agg(json_build_object('party', rr.party, 'total', rr.total, 'b', to_json(rr.b), 'adv', rr.adv, 'unalloc', rr.unalloc, 'pre', rr.pre, 'oldest', rr.oldest,
               'tally', rr.tally, 'diff', rr.diff, 'net', round(rr.net, 2), 'owe', round(rr.owe, 2), 'open', rr.open_bills, 'nb', to_json(rr.nb), 'und', rr.und, 'advance', rr.advance, 'noBills', rr.no_bills)
               order by rr.total desc, rr.party) from rr where rr.sd = sides.sd), '[]'::json),
    'sum', (select json_build_object('total', coalesce(round(sum(rr.total), 2), 0),
               'b', json_build_array(coalesce(round(sum(rr.b[1]), 2), 0), coalesce(round(sum(rr.b[2]), 2), 0), coalesce(round(sum(rr.b[3]), 2), 0), coalesce(round(sum(rr.b[4]), 2), 0), coalesce(round(sum(rr.b[5]), 2), 0)),
               'adv', coalesce(round(sum(rr.adv), 2), 0), 'unalloc', coalesce(round(sum(rr.unalloc), 2), 0), 'pre', coalesce(round(sum(rr.pre), 2), 0),
               'tally', round(sum(rr.tally), 2),
               'open', coalesce(round(sum(rr.b[1] + rr.b[2] + rr.b[3] + rr.b[4] + rr.b[5]), 2), 0),
               'owe', coalesce(round(sum(greatest(0, rr.net)), 2), 0), 'advance', coalesce(round(sum(rr.advance), 2), 0),
               'nb', json_build_array(coalesce(round(sum(rr.nb[1]), 2), 0), coalesce(round(sum(rr.nb[2]), 2), 0), coalesce(round(sum(rr.nb[3]), 2), 0), coalesce(round(sum(rr.nb[4]), 2), 0), coalesce(round(sum(rr.nb[5]), 2), 0)),
               'und', coalesce(round(sum(rr.und), 2), 0), 'diff', coalesce(round(sum(coalesce(rr.diff, 0)), 2), 0),
               'differ', coalesce((select json_agg(json_build_object('party', d.party, 'bills', d.total, 'ledger', d.tally, 'diff', d.diff) order by abs(d.diff) desc, d.party)
                                    from rr d where d.sd = sides.sd and d.diff is not null and abs(d.diff) >= 1), '[]'::json)) from rr where rr.sd = sides.sd)) as j from sides)
  -- built as json (text, in order): a third quicker than jsonb at every level; tally_now passes it on as it is
  select case when p_side = 'rp' then (select json_object_agg(one.sd, one.j) from one) else (select one.j from one) end
    into res;
  return res;
end $function$;

create or replace function public.tally_calc_ageing_bal(p_book uuid, p_as_on date, p_side text, p_bal jsonb)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select tally_calc_ageing_json(p_book, p_as_on, p_side, p_bal)::jsonb;
$function$;

-- the same with the balances worked out here
create or replace function public.tally_calc_ageing(p_book uuid, p_as_on date, p_side text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare pb jsonb;
begin
  select coalesce(jsonb_object_agg(c.ledger, jsonb_build_array(c.bal, c.deb, c.cred)), '{}'::jsonb) into pb
    from tally_calc_bal(p_book, array[p_as_on]) c where c.deb or c.cred;
  return tally_calc_ageing_bal(p_book, p_as_on, p_side, pb);
end $function$;

create or replace function public.tally_ageing(p_client text, p_as_on date, p_side text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare bk uuid := tally_pick(p_client, p_as_on);
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  return tally_calc_ageing(bk, p_as_on, p_side) || jsonb_build_object('book', bk);
end $function$;

-- ---------------------------------------------------------------- MIS for a period, in one call (mis-run "now")
-- a member: the book for the period's last day (tally_pick(client, to)); the balances on that day worked out once and
-- shared by the receivables and payables ageing, the headline owed to you and by you (Parties.position(to)) and the cash
-- and bank lists (MIS.runNow's r.balances), and every balance on the day. One value, so no REST row limit applies. The
-- month-end tie-out is not part of MIS.runNow and is asked on its own (tally_tieout). At most 120 months. The data
-- version is not worked out here: mis-run takes it from tally_calc_cached, asked first (an answer kept under a version
-- read before the figures can only be worked out again too soon, never served stale).
create or replace function public.tally_now(p_client text, p_from date, p_to date)
returns json language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare bk uuid := tally_pick(p_client, p_to); at_ json; pb jsonb; ag json; cashl json; bankl json; o_r numeric; o_p numeric; c_adv numeric; s_adv numeric; nm int;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'give the period, from before to' using errcode = '22023'; end if;
  nm := (extract(year from p_to)::int - extract(year from p_from)::int) * 12 + extract(month from p_to)::int - extract(month from p_from)::int + 1;
  if nm > 120 then raise exception 'at most 120 months' using errcode = '22023'; end if;
  if bk is null then return json_build_object('none', true); end if;
  select coalesce(json_object_agg(c.ledger, c.bal), '{}'::json),
         coalesce(jsonb_object_agg(c.ledger, jsonb_build_array(c.bal, c.deb, c.cred)) filter (where c.deb or c.cred), '{}'::jsonb),
         coalesce(json_agg(json_build_array(c.ledger, -round(c.bal, 2)) order by c.ledger collate "C") filter (where c.cash), '[]'::json),
         coalesce(json_agg(json_build_array(c.ledger, -round(c.bal, 2)) order by c.ledger collate "C") filter (where c.bank), '[]'::json),
         -- Parties.position(to): a debit balance as a positive figure d; customers: d > 0 owed to you, d < 0 an advance
         -- received; suppliers: d < 0 owed by you, d > 0 an advance paid
         coalesce(sum(-round(c.bal, 2)) filter (where c.deb and round(c.bal, 2) < 0), 0),
         coalesce(sum(round(c.bal, 2)) filter (where c.deb and round(c.bal, 2) > 0), 0),
         coalesce(sum(round(c.bal, 2)) filter (where c.cred and not c.deb and round(c.bal, 2) > 0), 0),
         coalesce(sum(-round(c.bal, 2)) filter (where c.cred and not c.deb and round(c.bal, 2) < 0), 0)
    into at_, pb, cashl, bankl, o_r, c_adv, o_p, s_adv
    from tally_calc_bal(bk, array[p_to]) c;
  ag := tally_calc_ageing_json(bk, p_to, 'rp', pb);                -- both sides in one pass
  return json_build_object('book', bk, 'from', to_char(p_from, 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'),
    'recv', ag->'r', 'pay', ag->'p',
    'owed', json_build_object('r', round(o_r, 2), 'p', round(o_p, 2), 'custAdv', round(c_adv, 2), 'supAdv', round(s_adv, 2)),
    'balances', json_build_object('asOn', to_char(p_to, 'YYYYMMDD'), 'cash', cashl, 'bank', bankl, 'at', at_));
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
    create policy tally_calc_results_read on public.tally_calc_results for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;
revoke all on public.tally_calc_results from public, anon, authenticated;
grant select on public.tally_calc_results to authenticated;
grant all on public.tally_calc_results to service_role;

-- the book's data version: FinCom's working (CALC_V below, raised with every change to how a figure is worked out, so
-- no answer kept before a fix is ever given back), every day read (days_at), every ledger list (ledgers_at), every
-- entry the bridge's lines add, change or delete (count, highest AlterID, deletions, cancelled, optional), and
-- fingerprints that move with a ledger renamed or carried (tally_ledger_rename / tally_ledger_carry move lines, bills
-- and day totals from one name to another without a new AlterID): the masters (name, parent, opening, chain, merged,
-- deleted), the groups, the day totals (they move with the lines: a rename or carry moves both) and the bills (each a
-- count and a sum of name hash x amount), and FinCom's ledger list. About 0.1 s on 40,000 entries.
create or replace function public.tally_calc_version(p_book uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select md5(concat_ws('|', 'CALC_V=151.2', b.days_at, b.ledgers_at, b.from_date,
           (select concat_ws(':', count(*), max(v.alter_id), count(v.deleted_at), max(v.deleted_at), count(*) filter (where v.cancelled), count(*) filter (where v.optional))
              from tally_vouchers v where v.book_id = b.book_id),
           (select md5(string_agg(concat_ws('~', l.name, l.parent, l.open, l.chain::text, l.primary_group, l.merged_into, l.deleted_at is null), '|' order by l.name))
              from tally_ledgers l where l.book_id = b.book_id),
           (select md5(string_agg(g.name || '~' || coalesce(g.parent, ''), '|' order by g.name)) from tally_groups g where g.book_id = b.book_id),
           (select concat_ws(':', count(*), sum(hashtext(d.ledger)::numeric * d.amount)) from tally_ledger_day d where d.book_id = b.book_id and d.merged_into is null),
           (select concat_ws(':', count(*), sum(hashtext(x.ledger || '|' || coalesce(x.name, '') || '|' || coalesce(x.type, ''))::numeric * x.amount + coalesce(x.credit_days, 0)))
              from tally_bills x where x.book_id = b.book_id),
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
revoke all on function public.tally_calc_ageing_bal(uuid, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_ageing_json(uuid, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_version(uuid) from public, anon, authenticated;
revoke all on function public.tally_calc_put(uuid, text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.tally_calc_led(uuid) to service_role;
grant execute on function public.tally_calc_bal(uuid, date[]) to service_role;
grant execute on function public.tally_calc_tieout(uuid, text[]) to service_role;
grant execute on function public.tally_calc_ageing(uuid, date, text) to service_role;
grant execute on function public.tally_calc_ageing_bal(uuid, date, text, jsonb) to service_role;
grant execute on function public.tally_calc_ageing_json(uuid, date, text, jsonb) to service_role;
grant execute on function public.tally_calc_version(uuid) to service_role;
grant execute on function public.tally_calc_put(uuid, text, text, text, jsonb, integer) to service_role;
-- a member of the firm: its own firm's books only (my_firm(), tally_pick)
revoke all on function public.tally_balances_at(uuid, date[]) from public, anon;
revoke all on function public.tally_tieout(text, text[]) from public, anon;
revoke all on function public.tally_ageing(text, date, text) from public, anon;
revoke all on function public.tally_calc_cached(text, date, text, text) from public, anon;
revoke all on function public.tally_balances_json(uuid, date[]) from public, anon;
revoke all on function public.tally_now(text, date, date) from public, anon;
grant execute on function public.tally_balances_at(uuid, date[]) to authenticated, service_role;
grant execute on function public.tally_tieout(text, text[]) to authenticated, service_role;
grant execute on function public.tally_ageing(text, date, text) to authenticated, service_role;
grant execute on function public.tally_calc_cached(text, date, text, text) to authenticated, service_role;
grant execute on function public.tally_balances_json(uuid, date[]) to authenticated, service_role;
grant execute on function public.tally_now(text, date, date) to authenticated, service_role;

commit;
