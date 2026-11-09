-- Migration 151 (09-Nov-2026, branch next-cloud-calc1; written, NOT run: the owner reads it and runs it).
-- The owner, 09-Nov-2026: "it should not freeze at all, whatever the book size; calculation should happen in cloud".
-- The browser downloads a client's whole books (TCloud.load) and works every figure out itself: on a book of 40,000
-- entries a balance, the month-end tie-out or the ageing held the page for seconds. Phase 1, the server side only: the
-- same figures worked out here from the cloud copy (tally_ledgers, tally_ledger_day, tally_vouchers, tally_lines,
-- tally_bills) and FinCom's ledger list (client_book_items, key "map"), by the browser's own rules, ported one by one
-- (tests/run_migration151.py checks each figure against the browser's engine on the same made-up books). Nothing in the
-- browser changes yet.
--
--   tally_calc_nclean / _nkey          namesClean / namesKey (server/_shared/names.js): names matched as the browser does
--   tally_calc_led(book)               every ledger as the browser sees it (TCloud.load, TallyRead.balances and
--                                      yearOpen): the masters not merged and not deleted in Tally, any ledger with entries
--                                      but no master; its opening, its group path (ledGroupPath over tally_groups; the
--                                      parent alone when no groups are read), the kind in FinCom's ledger list, and the
--                                      browser's tests: Audit.isDebtor / isCreditor / isCash / isBankL, MIS.plHead
--   tally_calc_bal(book, dates)        Audit.balances().at(d) for each date (at most 400): the opening plus every entry
--                                      from the book's first day to d (tally_ledger_day: never a deleted, cancelled or
--                                      optional entry), a credit positive; the ledgers the browser's answer holds
--   tally_balances_at(book, dates)     the same for a member of the book's firm (at most 31 dates): (date, ledger, bal)
--   tally_balances_json(book, dates)   the same as one value {date: {ledger: bal}} (no REST row limit; at most 31 dates)
--   tally_calc_tieout / tally_tieout   Rec.fincom (src/js/61) for each month-end (a member: at most 24 months; the server
--                                      120), each month from the book that covers it: receivables and payables
--                                      (Parties.position), cash and bank, the profit after tax from the year's start
--                                      (MIS.pl), the trial balance's debit total (LK.tbBooks, with "Difference in opening
--                                      balances"; none when it does not total)
--   tally_calc_ageing(_sides/_json/_bal) / tally_ageing  MIS.ageing (src/js/07; server/_shared/misageing.js): bill by
--                                      bill (tally_bills, else the line on account), by age from the due date, each
--                                      party's open bills net of payments on account, advances and the difference to its
--                                      ledger balance (MIS.netOpen), not bill-wise, advances, the control against the
--                                      balance. Like MIS.bills, every entry up to the day counts (no floor at the book's
--                                      first day: the balances have one, as Audit.balances moves from tb.from)
--   tally_now(client, from, to)        mis-run "now" in one call: the book's version and its kept answer, else both
--                                      ageings, owed (Parties.position(to)), cash and bank (MIS.runNow's r.balances) and
--                                      every balance on the day, all from one working of it
--   tally_calc_results                 worked-out answers kept per book, kind and arguments with the book's data version
--                                      (tally_calc_version, with FinCom's working CALC_V): used only while the version is
--                                      the same, so new entries, a rename or a fix make it worked out again
--   tally_calc_cached / tally_calc_put the answer kept for a member's client (only while current) / kept by the server
-- Adds only: new functions and one new table (RLS on; members read their own firm's rows; written by the service role
-- only; its one policy is dropped and made again so a second run converges, the only drop here). No index needed: tally_ledger_day (book_id, ledger, day) and (book_id, day), tally_lines (book_id, ledger, day),
-- tally_bills (book_id, guid), tally_vouchers (book_id, guid), tally_groups (book_id, name) are there. Safe to run twice.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- names, as the browser matches them
-- namesClean / namesKey (server/_shared/names.js, put at the head of the app): entities decoded (also escaped twice), each
-- run of line breaks with the spaces around it one space, the ends trimmed; the key also every run of white space one
-- space, lower case. The named entities and &#9; &#10; &#13; &#160; (the ones Tally writes in names) are decoded here;
-- other numeric entities are left as they are (migration 23 keeps names free of line breaks on the way in).
create or replace function public.tally_calc_nclean(p text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $function$
  select btrim(regexp_replace(
    case when coalesce(p, '') !~ '[&\r\n]' then coalesce(p, '') else
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        coalesce(p, ''), '&(amp;)?#(13|10|x0d|x0a);', E'\n', 'gi'), '&(amp;)?#(9|160|x09|xa0);', ' ', 'gi'),
        '&(amp;)?lt;', '<', 'gi'), '&(amp;)?gt;', '>', 'gi'), '&(amp;)?quot;', '"', 'gi'), '&(amp;)?apos;', '''', 'gi'), '&(amp;)?nbsp;', ' ', 'gi'), '&(amp;)?amp;', '&', 'gi') end,
    '[ \t]*[\r\n]+[ \t]*', ' ', 'g'))
$function$;
create or replace function public.tally_calc_nkey(p text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $function$
  select lower(btrim(regexp_replace(tally_calc_nclean(p), '\s+', ' ', 'g')))
$function$;

-- ---------------------------------------------------------------- every ledger, as the browser's books hold it
-- TCloud.load: the masters not merged and not deleted in Tally (TCloud.restAll adds deleted_at=is.null; a deleted ledger
-- that still has entries is a ledger with no master), put in by TallyRead.balances: under[ledger] = its parent (cleaned),
-- and TallyRead.yearOpen when the copy starts on 1 April and the groups are read: the openings of the profit and loss
-- ledgers go to "Profit & Loss A/c". The group path is ledGroupPath's (src/js/00-core.js): the parent, then each group's
-- parent in tally_groups (what TCloud.groupsInto reads), each looked up as ledLook does (the name as kept, else by its
-- namesKey), a name with & or a line break that is no group as kept cleaned before it goes in. A book with no groups
-- read: the parent alone, as the browser (TCloud.load reads name, parent and open only; the chain is not read).
create or replace function public.tally_calc_led(p_book uuid)
returns table (name text, open numeric, in_master boolean, path text[], kind text, deb boolean, cred boolean, cash boolean, bank boolean, pl boolean)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with recursive bk as (select b.firm_id, b.client_id, b.from_date from tally_books b where b.book_id = p_book),
  grp as materialized (select g.name, coalesce(g.parent, '') as parent from tally_groups g where g.book_id = p_book),
  -- ledLook by key: the last name with a parent among those of one key (ledIdx), when the name as kept is no group
  gk as materialized (select distinct on (tally_calc_nkey(grp.name)) tally_calc_nkey(grp.name) as k, grp.parent from grp order by tally_calc_nkey(grp.name), (grp.parent <> '') desc, grp.name desc),
  hasg as (select exists (select 1 from grp) as y),
  ml0 as materialized (select l.name, coalesce(l.open, 0) as open, coalesce(l.parent, '') as parent
          from tally_ledgers l where l.book_id = p_book and l.merged_into is null and l.deleted_at is null),
  -- each parent cleaned once (a few dozen), not once a ledger
  pc as materialized (select z.parent, case when z.parent = '' then '' else tally_calc_nclean(z.parent) end as par from (select distinct ml0.parent from ml0) z),
  ml as materialized (select ml0.name, ml0.open, pc.par from ml0 join pc on pc.parent = ml0.parent),
  -- ledGroupPath from each parent the ledgers have (a few dozen), at most 15 names
  walk (st, cur, path, n) as (
    select z.par, z.par, array[z.par], 1 from (select distinct ml.par from ml where ml.par <> '') z where (select y from hasg)
    union all
    select w.st, nx.p, w.path || nx.p, w.n + 1
      from walk w
      cross join lateral (select coalesce((select grp.parent from grp where grp.name = w.cur), (select gk.parent from gk where gk.k = tally_calc_nkey(w.cur)), '') as raw) q
      cross join lateral (select case when q.raw ~ '[&\r\n]' and not exists (select 1 from grp where grp.name = q.raw) then tally_calc_nclean(q.raw) else q.raw end as p) nx
     where nx.p <> '' and w.n < 15),
  wp0 as (select distinct on (walk.st) walk.st, walk.path from walk order by walk.st, walk.n desc),
  -- and its primary group (TallyRead.primaryOf: the last name before "Primary"), once a parent, not once a ledger
  wp as (select wp0.st, wp0.path, (select (array_agg(u.g order by u.i desc))[1] from unnest(wp0.path) with ordinality u(g, i)
                    where u.i < coalesce((select min(v.i) from unnest(wp0.path) with ordinality v(g, i) where v.g ~* '^\W*Primary$'), 1000)) as prim from wp0),
  m1 as (select ml.name, ml.open, wp.prim,
           case when ml.par = '' then '{}'::text[] when (select y from hasg) then wp.path else array[ml.par] end as path
           from ml left join wp on wp.st = ml.par),
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
  if cardinality(p_dates) = 1 then
    -- one date (tally_now, the ageing): the sums to the day, no running total
    return query
    with bk as (select b.from_date from tally_books b where b.book_id = p_book),
    mv as (select ld.ledger, sum(ld.amount) as a from tally_ledger_day ld, bk
            where ld.book_id = p_book and ld.merged_into is null and ld.day >= bk.from_date and ld.day <= p_dates[1] group by 1)
    select p_dates[1], l.name, l.open + coalesce(mv.a, 0), l.in_master, l.deb, l.cred, l.cash, l.bank, l.pl
      from tally_calc_led(p_book) l left join mv on mv.ledger = l.name
     where l.in_master or mv.ledger is not null;
    return;
  end if;
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

-- a member asks at most 31 dates (a month's days, or the month-ends of two and a half years: what Reports and MIS ask);
-- the server's own functions up to 400
create or replace function public.tally_balances_at(p_book uuid, p_dates date[])
returns table (date date, ledger text, bal numeric)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if cardinality(p_dates) > 31 then raise exception 'at most 31 dates' using errcode = '22023'; end if;
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
  if cardinality(p_dates) > 31 then raise exception 'at most 31 dates' using errcode = '22023'; end if;
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
  if cardinality(p_months) > 24 then raise exception 'at most 24 months' using errcode = '22023'; end if;     -- a member: two years (the server's own: 120)
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
create or replace function public.tally_calc_ageing_sides(p_book uuid, p_as_on date, p_side text, p_bal jsonb)
returns table (sd text, j json) language plpgsql stable security definer set search_path to 'public', 'pg_temp'
-- hash joins: the parties' count is known only at run time (jsonb_each), and the planner, guessing 100, looped an index
-- scan per party (0.77 s against 0.51 s on 4,000 customers)
set enable_nestloop to off as $function$
#variable_conflict use_column
begin
  if p_side not in ('r', 'p', 'rp') or p_as_on is null or not exists (select 1 from tally_books b where b.book_id = p_book) then return; end if;
  -- worked in whole paise (bigint; Tally's amounts have two places, so every sum is the browser's r2 at each step), and
  -- given back in rupees with two places
  return query
  with ab as materialized (select e.key as ledger, round((e.value->>0)::numeric * 100)::bigint as bal, (e.value->>1)::boolean as deb, (e.value->>2)::boolean as cred from jsonb_each(coalesce(p_bal, '{}'::jsonb)) e),
  -- the parties of each side asked (Audit.isDebtor for 'r', Audit.isCreditor for 'p')
  pty as materialized (select ab.ledger as name, 'r' as sd from ab where ab.deb and strpos(p_side, 'r') > 0
                       union all select ab.ledger, 'p' from ab where ab.cred and strpos(p_side, 'p') > 0),
  pn1 as (select distinct pty.name from pty),
  -- the entries up to the day; never a deleted, cancelled or optional one. A line carries its entry's day (as
  -- tally_ledger_day_rebuild reads it; on staging no line differs from its entry, none has no entry); the entry's number
  -- is read only for a bill's first New Ref (fn below)
  vx as materialized (select v.guid from tally_vouchers v where v.book_id = p_book and (v.deleted_at is not null or coalesce(v.cancelled, false) or coalesce(v.optional, false))),
  lk as materialized (select t.guid, t.ledger, min(t.day) as day, sum(round(t.amount * 100)::bigint) as lt, min(t.id) as id
           from tally_lines t join pn1 on pn1.name = t.ledger where t.book_id = p_book and t.day <= p_as_on and not exists (select 1 from vx where vx.guid = t.guid) group by 1, 2),
  -- the bills of those entries (a bill row carries its entry's day as its lines do; on staging none differs, none has no line)
  bl as materialized (select x.guid, x.ledger, x.day, x.id, coalesce(x.name, '') as nm, coalesce(x.type, '') as ty, round(coalesce(x.amount, 0) * 100)::bigint as amt, coalesce(x.credit_days, 0) as cd
           from tally_bills x join pn1 on pn1.name = x.ledger where x.book_id = p_book and x.day <= p_as_on and not exists (select 1 from vx where vx.guid = x.guid)),
  bs as (select bl.guid, bl.ledger, sum(bl.amt) as amt from bl group by 1, 2),
  -- each allocation, a bill's own key (party and name; "On Account" or no name: the party's one key with no name); a
  -- line with none is one "On Account" of its whole amount. The cloud keeps an entry's bills by party, not by line: with
  -- two lines of one party and bills on one, what the bills do not cover is on account
  bk0 as (select bl.ledger, case when bl.ty = 'On Account' or bl.nm = '' then '' else bl.nm end as ref, bl.day, bl.guid, bl.id as ord, bl.ty, bl.amt, bl.cd from bl),
  oa as (select lk.ledger, lk.day, lk.lt - coalesce(bs.amt, 0) as amt from lk left join bs on bs.guid = lk.guid and bs.ledger = lk.ledger
          where bs.guid is null or lk.lt <> bs.amt),
  -- each bill's sum and the day it was first touched, worked out once for both sides (the side only turns the sign)
  ag1 as (select z.ledger, z.ref, sum(z.amt) as amt, min(z.first) as first from
            (select bk0.ledger, bk0.ref, sum(bk0.amt) as amt, min(bk0.day) as first from bk0 group by 1, 2
             union all select oa.ledger, '', sum(oa.amt), min(oa.day) from oa group by 1) z group by 1, 2),
  -- the first New Ref or Advance of a bill (in the order of the entries): its date, entry number and credit days
  fn0 as (select distinct on (bk0.ledger collate "C", bk0.ref collate "C") bk0.ledger, bk0.ref, bk0.day, bk0.guid, case when bk0.ty = 'New Ref' and bk0.cd > 0 then bk0.cd end as cd
           from bk0 where bk0.ty in ('New Ref', 'Advance') order by bk0.ledger collate "C", bk0.ref collate "C", bk0.day, bk0.guid collate "C", bk0.ord),
  fn as (select fn0.*, coalesce(v.vno, '') as vno from fn0 left join tally_vouchers v on v.book_id = p_book and v.guid = fn0.guid),
  ag as (select pty.sd, ag1.ledger as party, ag1.ref, case when pty.sd = 'r' then -ag1.amt else ag1.amt end as amt, ag1.first, fn.day as nd, fn.vno as nno, fn.cd as ndays
           from ag1 join pty on pty.name = ag1.ledger left join fn on fn.ledger = ag1.ledger and fn.ref = ag1.ref),
  bi as (select ag.sd, ag.party, ag.ref, ag.amt, coalesce(ag.nd, ag.first) as date, ag.nd is not null as has_new, coalesce(ag.nno, '') as no,
           case when ag.ndays is not null then coalesce(ag.nd, ag.first) + ag.ndays::int end as due
           from ag where abs(ag.amt) >= 50),
  bx as (select bi.*, p_as_on - bi.date as age, case when bi.due is not null then greatest(0, p_as_on - bi.due) else p_as_on - bi.date end as od from bi),
  bk2 as materialized (select bx.*, case when bx.od <= 30 then 1 when bx.od <= 60 then 2 when bx.od <= 90 then 3 when bx.od <= 180 then 4 else 5 end as bucket,
            case when bx.ref = '' then 'unalloc' when not bx.has_new then 'pre' when bx.amt < 0 then 'adv' else 'open' end as cls from bx),
  pg as (select x.sd, x.party, sum(x.amt) as total,
           coalesce(sum(x.amt) filter (where x.cls = 'adv'), 0) as adv, coalesce(sum(x.amt) filter (where x.cls = 'unalloc'), 0) as unalloc,
           coalesce(sum(x.amt) filter (where x.cls = 'pre'), 0) as pre, coalesce(max(x.od) filter (where x.cls = 'open'), 0) as oldest,
           array[coalesce(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 1), 0), coalesce(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 2), 0),
                 coalesce(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 3), 0), coalesce(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 4), 0),
                 coalesce(sum(x.amt) filter (where x.cls = 'open' and x.bucket = 5), 0)]::bigint[] as b
           from bk2 x group by 1, 2),
  -- each party: its bills, or (a balance but no bill in the books read) a row of its own
  pa as (select pg.sd, pg.party, false as no_bills from pg
         union all
         select pty.sd, pty.name, true from pty join ab a on a.ledger = pty.name where a.bal <> 0
            and not exists (select 1 from pg where pg.sd = pty.sd and pg.party = pty.name)),
  pr as (select pa.sd, pa.party, pa.no_bills, coalesce(pg.total, 0) as total, coalesce(pg.adv, 0) as adv, coalesce(pg.unalloc, 0) as unalloc, coalesce(pg.pre, 0) as pre,
           coalesce(pg.oldest, 0) as oldest, coalesce(pg.b, array[0, 0, 0, 0, 0]::bigint[]) as b,
           case when pa.sd = 'r' then -ab.bal else ab.bal end as tally
           from pa left join pg on pg.sd = pa.sd and pg.party = pa.party left join ab on ab.ledger = pa.party),
  pn as materialized (select pr.*, pr.tally - pr.total as diff, coalesce(pr.tally, pr.total) as net, greatest(0, coalesce(pr.tally, pr.total)) as owe from pr),
  -- MIS.netOpen: what the bills carry beyond the balance is set against the oldest bills first
  -- (the open bills' sum is the party's buckets' sum; one window, one sort)
  ob as (select x.sd, x.party, x.ref, x.date, x.due, x.age, x.od, x.amt, x.no, x.bucket,
           (pn.b[1] + pn.b[2] + pn.b[3] + pn.b[4] + pn.b[5]) - pn.owe as less0,
           coalesce(sum(x.amt) over (partition by x.sd, x.party collate "C" order by x.date, x.ref rows between unbounded preceding and 1 preceding), 0) as before
           from bk2 x join pn on pn.sd = x.sd and pn.party = x.party where x.cls = 'open'),
  ol as (select ob.*, ob.amt - greatest(0, least(ob.amt, ob.less0 - ob.before)) as left_ from ob),
  oo as (select ol.* from ol where ol.left_ > 0),
  og as (select o.sd, o.party,
           array[coalesce(sum(o.left_) filter (where o.bucket = 1), 0), coalesce(sum(o.left_) filter (where o.bucket = 2), 0), coalesce(sum(o.left_) filter (where o.bucket = 3), 0),
                 coalesce(sum(o.left_) filter (where o.bucket = 4), 0), coalesce(sum(o.left_) filter (where o.bucket = 5), 0)]::bigint[] as nb,
           sum(o.left_) as left_all,
           json_agg(json_build_object('ref', o.ref, 'date', to_char(o.date, 'YYYYMMDD'), 'due', coalesce(to_char(o.due, 'YYYYMMDD'), ''), 'age', o.age, 'od', o.od,
                      'amt', round((o.amt)::numeric / 100, 2), 'left', round((o.left_)::numeric / 100, 2), 'no', o.no) order by o.date, o.ref) as open_bills
           from oo o group by 1, 2),
  rows_ as (select pn.*, coalesce(og.nb, array[0, 0, 0, 0, 0]::bigint[]) as nb, pn.owe - coalesce(og.left_all, 0) as und0,
           case when pn.net < 0 then -pn.net else 0 end as advance, coalesce(og.open_bills, '[]'::json) as open_bills
           from pn left join og on og.sd = pn.sd and og.party = pn.party),
  rr as materialized (select rows_.*, case when rows_.und0 > 0 then rows_.und0 else 0 end as und from rows_),
  sides as (select x as sd from unnest(case p_side when 'rp' then array['r', 'p'] else array[p_side] end) x),
  one as (select sides.sd, json_build_object('asOn', to_char(p_as_on, 'YYYYMMDD'), 'side', sides.sd,
    'rows', coalesce((select json_agg(json_build_object('party', rr.party, 'total', round((rr.total)::numeric / 100, 2), 'b', json_build_array(round((rr.b[1])::numeric / 100, 2), round((rr.b[2])::numeric / 100, 2), round((rr.b[3])::numeric / 100, 2), round((rr.b[4])::numeric / 100, 2), round((rr.b[5])::numeric / 100, 2)),
               'adv', round((rr.adv)::numeric / 100, 2), 'unalloc', round((rr.unalloc)::numeric / 100, 2), 'pre', round((rr.pre)::numeric / 100, 2), 'oldest', rr.oldest,
               'tally', round((rr.tally)::numeric / 100, 2), 'diff', round((rr.diff)::numeric / 100, 2), 'net', round((rr.net)::numeric / 100, 2), 'owe', round((rr.owe)::numeric / 100, 2), 'open', rr.open_bills,
               'nb', json_build_array(round((rr.nb[1])::numeric / 100, 2), round((rr.nb[2])::numeric / 100, 2), round((rr.nb[3])::numeric / 100, 2), round((rr.nb[4])::numeric / 100, 2), round((rr.nb[5])::numeric / 100, 2)), 'und', round((rr.und)::numeric / 100, 2), 'advance', round((rr.advance)::numeric / 100, 2), 'noBills', rr.no_bills)
               order by rr.total desc, rr.party) from rr where rr.sd = sides.sd), '[]'::json),
    'sum', (select json_build_object('total', round((coalesce(sum(rr.total), 0))::numeric / 100, 2),
               'b', json_build_array(round((coalesce(sum(rr.b[1]), 0))::numeric / 100, 2), round((coalesce(sum(rr.b[2]), 0))::numeric / 100, 2), round((coalesce(sum(rr.b[3]), 0))::numeric / 100, 2), round((coalesce(sum(rr.b[4]), 0))::numeric / 100, 2), round((coalesce(sum(rr.b[5]), 0))::numeric / 100, 2)),
               'adv', round((coalesce(sum(rr.adv), 0))::numeric / 100, 2), 'unalloc', round((coalesce(sum(rr.unalloc), 0))::numeric / 100, 2), 'pre', round((coalesce(sum(rr.pre), 0))::numeric / 100, 2),
               'tally', round((sum(rr.tally))::numeric / 100, 2),
               'open', round((coalesce(sum(rr.b[1] + rr.b[2] + rr.b[3] + rr.b[4] + rr.b[5]), 0))::numeric / 100, 2),
               'owe', round((coalesce(sum(greatest(0, rr.net)), 0))::numeric / 100, 2), 'advance', round((coalesce(sum(rr.advance), 0))::numeric / 100, 2),
               'nb', json_build_array(round((coalesce(sum(rr.nb[1]), 0))::numeric / 100, 2), round((coalesce(sum(rr.nb[2]), 0))::numeric / 100, 2), round((coalesce(sum(rr.nb[3]), 0))::numeric / 100, 2), round((coalesce(sum(rr.nb[4]), 0))::numeric / 100, 2), round((coalesce(sum(rr.nb[5]), 0))::numeric / 100, 2)),
               'und', round((coalesce(sum(rr.und), 0))::numeric / 100, 2), 'diff', round((coalesce(sum(coalesce(rr.diff, 0)), 0))::numeric / 100, 2),
               'differ', coalesce((select json_agg(json_build_object('party', d.party, 'bills', round((d.total)::numeric / 100, 2), 'ledger', round((d.tally)::numeric / 100, 2), 'diff', round((d.diff)::numeric / 100, 2)) order by abs(d.diff) desc, d.party)
                                    from rr d where d.sd = sides.sd and d.diff is not null and abs(d.diff) >= 100), '[]'::json)) from rr where rr.sd = sides.sd)) as j from sides)
  -- built as json (text, in order): a third quicker than jsonb at every level; tally_now passes it on as it is
  select one.sd, one.j from one;
end $function$;

create or replace function public.tally_calc_ageing_json(p_book uuid, p_as_on date, p_side text, p_bal jsonb)
returns json language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select case when p_side = 'rp' then (select json_object_agg(z.sd, z.j) from tally_calc_ageing_sides(p_book, p_as_on, p_side, p_bal) z)
              else (select z.j from tally_calc_ageing_sides(p_book, p_as_on, p_side, p_bal) z) end;
$function$;

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
-- a member: the book for the period's last day (tally_pick(client, to)) and its data version, worked out once here.
-- An answer kept for that version (tally_calc_results, kind mis-now.2, args "from|to") comes back as it is:
-- {kept: true, at, result}. Otherwise the figures, {kept: false, book, version, ...}: the balances on the day worked out
-- once and shared by the receivables and payables ageing, the headline owed to you and by you (Parties.position(to)),
-- the cash and bank lists (MIS.runNow's r.balances) and every balance on the day; mis-run keeps them with that version
-- (read before the figures: a change meanwhile makes the next ask work them out again, never serves them stale). One
-- json value (built in order, not parsed again), so no REST row limit applies. The month-end tie-out is not part of
-- MIS.runNow (tally_tieout). At most 120 months.
create or replace function public.tally_now(p_client text, p_from date, p_to date)
returns json language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare bk uuid := tally_pick(p_client, p_to); ver text; k_ver text; k_at timestamptz; k_res jsonb; at_ json; pb jsonb; jr json; jp json; cashl json; bankl json;
  o_r numeric; o_p numeric; c_adv numeric; s_adv numeric; nm int;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'give the period, from before to' using errcode = '22023'; end if;
  nm := (extract(year from p_to)::int - extract(year from p_from)::int) * 12 + extract(month from p_to)::int - extract(month from p_from)::int + 1;
  if nm > 120 then raise exception 'at most 120 months' using errcode = '22023'; end if;
  if bk is null then return json_build_object('none', true); end if;
  ver := tally_calc_version(bk);
  select x.version, x.at, x.result into k_ver, k_at, k_res from tally_calc_results x
   where x.book_id = bk and x.kind = 'mis-now.2' and x.args = to_char(p_from, 'YYYYMMDD') || '|' || to_char(p_to, 'YYYYMMDD') and x.firm_id = my_firm();
  if k_ver = ver then return json_build_object('kept', true, 'at', k_at, 'book', bk, 'version', ver, 'result', k_res); end if;
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
  -- both sides in one pass over the entries and bills
  select (array_agg(z.j) filter (where z.sd = 'r'))[1], (array_agg(z.j) filter (where z.sd = 'p'))[1] into jr, jp from tally_calc_ageing_sides(bk, p_to, 'rp', pb) z;
  return json_build_object('kept', false, 'book', bk, 'version', ver, 'from', to_char(p_from, 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'),
    'recv', jr, 'pay', jp,
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
-- this migration's own policy, made again so a second run leaves it as written here (the only drop in this file)
drop policy if exists tally_calc_results_read on public.tally_calc_results;
create policy tally_calc_results_read on public.tally_calc_results for select to authenticated using (firm_id = (select public.my_firm()));
revoke all on public.tally_calc_results from public, anon, authenticated;
grant select on public.tally_calc_results to authenticated;
grant all on public.tally_calc_results to service_role;

-- the book's data version: FinCom's working (CALC_V below, raised with every change to how a figure is worked out, so
-- no answer kept before a fix is ever given back), every day read (days_at), every ledger list (ledgers_at), every
-- entry the bridge's lines add, change or delete (count, highest AlterID, deletions, cancelled, optional), and
-- fingerprints that move with a ledger renamed or carried (tally_ledger_rename / tally_ledger_carry move lines, bills
-- and day totals from one name to another without a new AlterID): the masters (name, parent, opening, chain, merged,
-- deleted), the groups (each a count and a sum of row hashes), the day totals (they move with the lines: a rename or
-- carry moves both) and the bills (each a count and a sum of name hash x amount), and FinCom's ledger list.
create or replace function public.tally_calc_version(p_book uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  -- every part in its place: a part with no value is the marker ~ (concat_ws would drop it and shift the rest)
  select md5(array_to_string(array['CALC_V=151.3', b.days_at::text, b.ledgers_at::text, b.from_date::text,
           (select array_to_string(array[count(*), max(v.alter_id), count(v.deleted_at), count(*) filter (where v.cancelled), count(*) filter (where v.optional)]::text[] || max(v.deleted_at)::text, ':', '~')
              from tally_vouchers v where v.book_id = b.book_id),
           (select array_to_string(array[count(*), sum(hashtext(array_to_string(array[l.name, l.parent, l.open::text, l.chain::text, l.primary_group, l.merged_into, (l.deleted_at is null)::text], '~', '^'))::bigint)]::text[], ':', '~')
              from tally_ledgers l where l.book_id = b.book_id),
           (select array_to_string(array[count(*), sum(hashtext(g.name || '~' || coalesce(g.parent, '^'))::bigint)]::text[], ':', '~') from tally_groups g where g.book_id = b.book_id),
           (select array_to_string(array[count(*), sum(hashtext(d.ledger)::numeric * d.amount)]::text[], ':', '~') from tally_ledger_day d where d.book_id = b.book_id and d.merged_into is null),
           (select array_to_string(array[count(*), sum(hashtext(x.ledger || '|' || coalesce(x.name, '') || '|' || coalesce(x.type, ''))::numeric * x.amount + coalesce(x.credit_days, 0))]::text[], ':', '~')
              from tally_bills x where x.book_id = b.book_id),
           (select array_to_string(array[count(*)::text, max(i.seq)::text, max(i.updated_at)::text], ':', '~') from client_book_items i
             where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'map')], '|', '~'))
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
revoke all on function public.tally_calc_nclean(text) from public, anon, authenticated;
revoke all on function public.tally_calc_nkey(text) from public, anon, authenticated;
revoke all on function public.tally_calc_ageing_sides(uuid, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_bal(uuid, date[]) from public, anon, authenticated;
revoke all on function public.tally_calc_tieout(uuid, text[]) from public, anon, authenticated;
revoke all on function public.tally_calc_ageing(uuid, date, text) from public, anon, authenticated;
revoke all on function public.tally_calc_ageing_bal(uuid, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_ageing_json(uuid, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_version(uuid) from public, anon, authenticated;
revoke all on function public.tally_calc_put(uuid, text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.tally_calc_led(uuid) to service_role;
grant execute on function public.tally_calc_nclean(text) to service_role;
grant execute on function public.tally_calc_nkey(text) to service_role;
grant execute on function public.tally_calc_ageing_sides(uuid, date, text, jsonb) to service_role;
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
