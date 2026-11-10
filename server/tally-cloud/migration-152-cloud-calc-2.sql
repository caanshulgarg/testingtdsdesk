-- Migration 152 (09-Nov-2026, branch next-cloud-calc2; written, NOT run: the owner reads it and runs it). Needs 151.
-- The owner, 09-Nov-2026: "it should not freeze at all, whatever the book size; calculation should happen in cloud".
-- Phase 2, the server side only: the rest of MIS.runNow (src/js/07) worked out here from the cloud copy, by the browser's
-- own rules ported one by one (tests/run_migration152.py checks every figure against the browser's engine, to the paisa,
-- on made-up books with a year before). GST 3B (comp.gst's output, credit and worked-out tax) is the separate helper's;
-- what was paid to the GST ledgers from the bank is here. Nothing in the browser changes yet.
--
--   tally_calc_cls(book)                  every ledger of tally_calc_led with what the engine asks of it: Books.ledgerOf
--                                         (kind, what, side, reg, payTds), Audit.under (sales accounts, purchase accounts,
--                                         direct / indirect incomes, fixed assets), Audit.isExpense, MIS.gstPaidTo, a TDS
--                                         ledger (MIS.tdsPayable)
--   tally_calc_vl(book, from, to)         the period's entries line by line (Audit.vouchers: never a deleted, cancelled
--                                         or optional one), each line in its entry's order
--   tally_calc_plhead(...)                MIS.plHead (FS.nature, FS.place, FS.cfg's map and manufacturing switch,
--                                         MIS.headByGroup); tally_calc_lineof = FS.lineOf
--   tally_calc_flowhead(...)              MIS.flowHead (flowGroup, flowPartners, flowMark, flowClean, flowWhy)
--   tally_calc_sales(book, from, to)      MIS.sales: by customer and month, other income, by state and registration,
--                                         top five, new customers; tally_calc_sales_total its total alone
--   tally_calc_purchases(book, from, to)  MIS.purchases: by supplier and month, the expense heads and the months that
--                                         jumped; with goods (MIS.runNow's r.goods: Purchase Accounts used)
--   tally_calc_pl(book, from, to)         MIS.pl / MIS.plRule: the heads with their ledgers month by month, an expense
--                                         ledger in credit set off in its head, a head in credit to Other income, the
--                                         gross profit, EBITDA, profit before and after tax
--   tally_calc_cash(book, from, to)       MIS.cashflow (received, paid) and MIS.cashActual (the cash flow by what it was
--                                         for, month by month, with the opening and closing cash and bank, and the
--                                         grouping notes)
--   tally_calc_comp(book, from, to)       MIS.compliance without GST 3B: GST paid from the bank by month, TDS deducted and
--                                         deposited (Books.lines), the challans kept (client_book_items "challans"), the
--                                         TDS payable rolled from the opening (MIS.tdsPayable)
--   tally_calc_msme(book, to)             MIS.runNow's r.msme: micro and small suppliers' bills left past the days set
--                                         (MIS.msme from "ledInfo" and "msme", MIS.cfg's msmeDays from "misCfg")
--   tally_calc_control(book, from, to, today)  MIS.runNow's r.control: none on the cloud copy (the browser skips the check
--                                         when its balances are the copy, tb.src "copy": next-mis-speed b33f4a180)
--   tally_calc_mis(book, part, from, to, today)  one part of MIS.runNow: sales, purchases, pl, prev, ly (with their
--                                         ranges), tops (mtd, ytd), cash, comp, msme, control
--   tally_mis_part(client, part, from, to, today)  the same for a member: the book for the period of its own firm only
-- Adds only: new functions. No table, no index (tally_vouchers (book_id, guid), tally_lines (book_id, guid),
-- tally_ledger_day (book_id, ledger, day) and (book_id, day) are there). Safe to run twice. Built on 151 exactly as applied
-- on staging (516eb301c). Four of 151's functions are made again with the same signatures, grants and search_path
-- (create or replace): tally_calc_nclean and tally_calc_nkey, as server/_shared/names.js (the final review of 151:
-- every numeric entity, JavaScript's white space); tally_calc_led, whose primary group (for the 1 April openings) is now
-- read from the raw group names as TallyRead.primaryOf reads them, so the cleaner names do not move openings the
-- browser leaves; and tally_calc_version (CALC_V 152.2 for both, and the work 152's parts read, so no kept answer
-- outlives a change to it). Nothing else of 151 changes.
-- Each function sets jit off (on a plan the planner costs high, JIT compiling took half a second before the first row on
-- 10,000 ledgers), the heavy ones work_mem 32MB (the period's lines sorted in memory), and the line reader no nested
-- loop (the planner, not knowing the period, guessed a few hundred entries for 40,000). Every part takes under 1 s on
-- 40,000 entries and 10,000 ledgers (tests/run_migration152.py).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- names, as server/_shared/names.js has them (151 replaced)
-- The final review of 151 (applied on staging as 516eb301c): its tally_calc_nclean decoded only some entities and trimmed
-- spaces only. Replaced here with the same signature, the same grants and the same search_path, as names.js does it:
--   namesDecode: every numeric entity, also escaped twice (&(amp;)?#(x[0-9a-f]+|\d+);, in one pass): 13 and 10 a line
--     break, 9 and 160 a space, any other code below 32 (and none Unicode can hold, or half of a UTF-16 pair) a space,
--     the rest the character itself ("ABC&#4;Ltd" -> "ABC Ltd", "Tom &#38; Jerry", "O&#39;Brien", "a&#x26;b"); then the
--     named ones (amp, lt, gt, quot, apos, nbsp; also escaped twice), in one pass
--   namesBreaks: each run of line breaks (raw, or &#13; &#10;) with the spaces and tabs around it one space; the ends
--     trimmed as JavaScript's trim (tab, line breaks, vertical tab, form feed, space, U+00A0, U+1680, U+2000-U+200A,
--     U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF)
--   namesKey: namesClean, every run of that white space one space, trimmed, lower case (locale-free, as toLowerCase)
-- The path keeps a name with & that is no group cleaned ("&#4; Primary" is "Primary" in it), as ledGroupPath; the primary
-- group for the 1 April openings is read from the raw names, as TallyRead.primaryOf (tally_calc_led, below). The data
-- version is raised with both (tally_calc_version, below).
create or replace function public.tally_calc_nclean(p text)
returns text language plpgsql immutable set search_path to 'public', 'pg_temp' as $function$
declare
  s text := coalesce(p, ''); o text; i int; m text[]; c bigint; d text; r text;
  ws constant text := '[\t\n\v\f\r    -     　﻿]';
begin
  if s ~ '[&\r\n]' then
    -- numeric entities, in one pass (what one gives is not looked at again)
    o := '';
    loop
      i := regexp_instr(s, '&(amp;)?#(x[0-9a-f]+|[0-9]+);', 1, 1, 0, 'i');
      exit when i = 0;
      m := regexp_match(substr(s, i), '^&(amp;)?#(x[0-9a-f]+|[0-9]+);', 'i');
      d := m[2];
      if lower(left(d, 1)) = 'x' then d := ltrim(substr(d, 2), '0'); c := case when d = '' then 0 when length(d) > 8 then 99999999 else ('x' || lpad(d, 16, '0'))::bit(64)::bigint end;
      else d := ltrim(d, '0'); c := case when d = '' then 0 when length(d) > 9 then 99999999 else d::bigint end; end if;
      r := case when c in (13, 10) then E'\n' when c in (9, 160) then ' ' when c >= 32 and c < 1114112 and not (c between 55296 and 57343) then chr(c::int) else ' ' end;
      o := o || left(s, i - 1) || r;
      s := substr(s, i + length('&' || coalesce(m[1], '') || '#' || m[2] || ';'));
    end loop;
    s := o || s;
    -- the named ones, in one pass
    o := '';
    loop
      i := regexp_instr(s, '&(amp;)?(amp|lt|gt|quot|apos|nbsp);', 1, 1, 0, 'i');
      exit when i = 0;
      m := regexp_match(substr(s, i), '^&(amp;)?(amp|lt|gt|quot|apos|nbsp);', 'i');
      r := case lower(m[2]) when 'amp' then '&' when 'lt' then '<' when 'gt' then '>' when 'quot' then '"' when 'apos' then '''' else ' ' end;
      o := o || left(s, i - 1) || r;
      s := substr(s, i + length('&' || coalesce(m[1], '') || m[2] || ';'));
    end loop;
    s := o || s;
  end if;
  -- namesBreaks, then JavaScript's trim
  s := regexp_replace(s, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g');
  return regexp_replace(s, '^' || ws || '+|' || ws || '+$', '', 'g');
end $function$;

create or replace function public.tally_calc_nkey(p text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $function$
  select lower(regexp_replace(regexp_replace(tally_calc_nclean(p), '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'), '^ | $', '', 'g') collate "und-x-icu")
$function$;

revoke all on function public.tally_calc_nclean(text) from public, anon, authenticated;
revoke all on function public.tally_calc_nkey(text) from public, anon, authenticated;
grant execute on function public.tally_calc_nclean(text) to service_role;
grant execute on function public.tally_calc_nkey(text) to service_role;

-- ---------------------------------------------------------------- every ledger (151's tally_calc_led, replaced: the same signature)
-- The review of 152: with the names cleaned as names.js, a group's parent "&#4; Primary" became "Primary", and the path's
-- Primary test then made the group under it a primary group, so on a book starting 1 April the openings under it moved to
-- Profit & Loss A/c where the browser moves none. The browser's TallyRead.primaryOf tests the RAW value ledLook(groups, p)
-- gives and returns that raw value. 151's function as applied on staging, with only that changed: the raw chain kept
-- beside the path, the primary group read from it, and compared after JavaScript's trim. The path is as before.
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
  -- beside the path, the raw chain TallyRead.primaryOf walks: the parent as b.under keeps it (cleaned), then each group's
  -- parent as ledLook(groups, p) gives it, before any cleaning
  walk (st, cur, path, raw, n) as (
    select z.par, z.par, array[z.par], array[z.par], 1 from (select distinct ml.par from ml where ml.par <> '') z where (select y from hasg)
    union all
    select w.st, nx.p, w.path || nx.p, w.raw || q.raw, w.n + 1
      from walk w
      cross join lateral (select coalesce((select grp.parent from grp where grp.name = w.cur), (select gk.parent from gk where gk.k = tally_calc_nkey(w.cur)), '') as raw) q
      cross join lateral (select case when q.raw ~ '[&\r\n]' and not exists (select 1 from grp where grp.name = q.raw) then tally_calc_nclean(q.raw) else q.raw end as p) nx
     where nx.p <> '' and w.n < 15),
  wp0 as (select distinct on (walk.st) walk.st, walk.path, walk.raw from walk order by walk.st, walk.n desc),
  -- and its primary group, TallyRead.primaryOf (src/js/18, next-mis-speed b33f4a180): along the raw chain, the name just
  -- before the first that is empty or /^\W*Primary$/i, as it is (raw: "&#4; Primary" is no Primary there, so the
  -- group under it is no primary group). JavaScript's \W is ASCII: [^A-Za-z0-9_] here, not Postgres's \W
  wk as (select wp0.*, (select min(u.i) from unnest(wp0.raw) with ordinality u(g, i) where u.g = '' or u.g ~* '^[^A-Za-z0-9_]*Primary$') as k from wp0),
  wp as (select wk.st, wk.path, case when wk.k is null then wk.raw[cardinality(wk.raw)] when wk.k = 1 then '' else wk.raw[wk.k - 1] end as prim from wk),
  m1 as (select ml.name, ml.open, wp.prim,
           case when ml.par = '' then '{}'::text[] when (select y from hasg) then wp.path else array[ml.par] end as path
           from ml left join wp on wp.st = ml.par),
  -- TallyRead.yearOpen: a profit and loss ledger's opening moves when the copy starts on 1 April and the groups are read
  yo as (select (extract(month from bk.from_date) = 4 and extract(day from bk.from_date) = 1 and (select y from hasg)) as on_ from bk),
  m2 as (select m1.name, m1.open, m1.path,
           (select on_ from yo) and m1.name <> 'Profit & Loss A/c' and m1.open <> 0
             -- String(primaryOf).trim().toLowerCase(): JavaScript's trim
             and lower(regexp_replace(coalesce(m1.prim, ''), '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'))
               in ('sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses') as moves
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

revoke all on function public.tally_calc_led(uuid) from public, anon, authenticated;
grant execute on function public.tally_calc_led(uuid) to service_role;

-- ---------------------------------------------------------------- the data version (151's, replaced: the same signature)
-- 151's version with FinCom's working raised (CALC_V 152.2: the names above and the primary group; nothing kept under 151.3 is served after
-- them), and with what 152's parts read besides the entries and the ledger list, so an answer kept with them is worked
-- out again when one changes: FinCom's work kept for the client (client_book_items ledInfo and msme: the MSME types; fs:
-- the accounts' line chosen by hand and the manufacturing switch; misCfg: the MSME days; challans) and the client's
-- choices (clients.data -> choices: a ledger marked Loan given)
create or replace function public.tally_calc_version(p_book uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  -- every part in its place: a part with no value is the marker ~ (concat_ws would drop it and shift the rest)
  select md5(array_to_string(array['CALC_V=152.2', b.days_at::text, b.ledgers_at::text, b.from_date::text,
           (select array_to_string(array[count(*), max(v.alter_id), count(v.deleted_at), count(*) filter (where v.cancelled), count(*) filter (where v.optional)]::text[] || max(v.deleted_at)::text, ':', '~')
              from tally_vouchers v where v.book_id = b.book_id),
           (select array_to_string(array[count(*), sum(hashtext(array_to_string(array[l.name, l.parent, l.open::text, l.chain::text, l.primary_group, l.merged_into, (l.deleted_at is null)::text], '~', '^'))::bigint)]::text[], ':', '~')
              from tally_ledgers l where l.book_id = b.book_id),
           (select array_to_string(array[count(*), sum(hashtext(g.name || '~' || coalesce(g.parent, '^'))::bigint)]::text[], ':', '~') from tally_groups g where g.book_id = b.book_id),
           (select array_to_string(array[count(*), sum(hashtext(d.ledger)::numeric * d.amount)]::text[], ':', '~') from tally_ledger_day d where d.book_id = b.book_id and d.merged_into is null),
           (select array_to_string(array[count(*), sum(hashtext(x.ledger || '|' || coalesce(x.name, '') || '|' || coalesce(x.type, ''))::numeric * x.amount + coalesce(x.credit_days, 0))]::text[], ':', '~')
              from tally_bills x where x.book_id = b.book_id),
           (select array_to_string(array[count(*)::text, max(i.seq)::text, max(i.updated_at)::text], ':', '~') from client_book_items i
             where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'map'),
           -- 152: the work its parts read, each a count, the highest change and an order-free sum of row hashes
           (select array_to_string(array[count(*)::text, max(i.seq)::text, max(i.updated_at)::text,
                     sum(hashtext(i.key || '~' || i.item || '~' || coalesce(i.data::text, '^') || '~' || i.deleted::text)::bigint)::text], ':', '~') from client_book_items i
             where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key in ('ledInfo', 'msme', 'fs', 'misCfg', 'challans')),
           (select coalesce(md5((c.data -> 'choices')::text), '^') from clients c where c.firm_id = b.firm_id and c.id::text = b.client_id)], '|', '~'))
    from tally_books b where b.book_id = p_book;
$function$;

revoke all on function public.tally_calc_version(uuid) from public, anon, authenticated;
grant execute on function public.tally_calc_version(uuid) to service_role;

-- ---------------------------------------------------------------- small helpers, the browser's own arithmetic
-- MIS.shift(d, years, days): a year on with JavaScript's Date (29 February to 1 March in a year that has none)
create or replace function public.tally_calc_shift(p_d date, p_years integer, p_days integer)
returns date language sql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
  select (case when coalesce(p_years, 0) = 0 then p_d
               when extract(month from p_d) = 2 and extract(day from p_d) = 29
                and not ((((extract(year from p_d))::int + p_years) % 4 = 0 and ((extract(year from p_d))::int + p_years) % 100 <> 0) or ((extract(year from p_d))::int + p_years) % 400 = 0)
               then make_date((extract(year from p_d))::int + p_years, 3, 1)
               else (p_d + make_interval(years => p_years))::date end) + coalesce(p_days, 0);
$function$;

-- MIS.monthsOf(from, to): 'YYYYMM' each
create or replace function public.tally_calc_months(p_from date, p_to date)
returns text[] language sql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
  select coalesce(array_agg(to_char(m, 'YYYYMM') order by m), '{}'::text[])
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m;
$function$;

-- num(v) (src/js/01): a number as it is; text by parseFloat after everything but digits, "." and "-" is taken out
create or replace function public.tally_calc_num(p jsonb)
returns numeric language sql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
  select case when p is null then 0 when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' then coalesce(substring(regexp_replace(p #>> '{}', '[^0-9.\-]', '', 'g') from '^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)')::numeric, 0)
              else 0 end;
$function$;

-- a JavaScript truthy value in a jsonb
create or replace function public.tally_calc_truthy(p jsonb)
returns boolean language sql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
  select p is not null and p not in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb);
$function$;

-- FS.lineOf: a code of the financial statements ("13A") as its line; any other value as it is ("none": no line)
create or replace function public.tally_calc_lineof(p_v text)
returns text language sql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
  select case when p_v is null then null
    when p_v !~ '^[0-9]+[A-Z]$' then case when p_v = 'none' then '' else p_v end
    else (with x as (select substring(p_v from '^([0-9]+)') as n, right(p_v, 1) as k)
      select coalesce(case x.n when '3' then case when ascii(x.k) > ascii('O') then 'capital' else 'share' end when '4' then 'reserves' when '30' then 'ltb'
        when '31' then 'dtl' when '32' then 'oltl' when '5' then case when x.k in ('A', 'C', 'D') then 'ltp' else 'stp' end when '33' then 'stb' when '6' then 'tp'
        when '7' then 'ocl' when '8' then case when x.k = 'E' then 'dep' else 'ppe' end when '34' then case when x.k = 'D' then 'dep' else 'intang' end
        when '35' then 'cwip' when '36' then 'nci' when '9' then 'dta' when '38' then case when x.k = 'C' then 'onca' else 'ltla' end when '37' then 'ci'
        when '39' then 'inv' when '10' then 'tr' when '11' then 'cash' when '12' then case when x.k in ('E', 'K') then 'oca' else 'stla' end when '13' then 'rev'
        when '14' then 'oth' when '40' then 'mat' when '41' then 'pur' when '42' then 'chg' when '15' then 'emp' when '16' then 'fin' when '17' then 'exp'
        when '43' then 'exc' when '22' then 'tax' end, '') from x) end;
$function$;

-- MIS.plHead(l, FS.cfg(books)): {s: the line in the statement of profit and loss, h: MIS's head}, or null (not a profit
-- and loss ledger). p_line: FS.lineOf of the line chosen on the Mapping tab (b.fs.map), p_mfg: b.fs.mfg. No groupInfo
-- in the cloud copy: a group's nature is the reserved group's (FS.nature's names)
create or replace function public.tally_calc_plhead(p_name text, p_path text[], p_kind text, p_line text, p_mfg boolean)
returns text[] language plpgsql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
declare
  n int := coalesce(array_length(p_path, 1), 0);
  lp text[] := coalesce((select array_agg(lower(g) order by o) from unnest(p_path) with ordinality u(g, o)), '{}'::text[]);
  t text; gp boolean; dr boolean; w text; s text; h text; up text;
begin
  if n > 0 then
    t := lower(p_path[n]);
    if t in ('sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses') then
      gp := t in ('sales accounts', 'direct incomes', 'purchase accounts', 'direct expenses');
      dr := t in ('purchase accounts', 'direct expenses', 'indirect expenses');
      w := nullif(p_line, '');
      if w is null then                                   -- FS.place, a revenue ledger
        if not dr then w := case when gp then 'rev' else 'oth' end;
        elsif gp then w := case when 'purchase accounts' = any(lp) then 'pur' else 'exp' end;
        else
          up := upper(p_name) || ' ' || upper(array_to_string(p_path, ' '));
          w := case when up ~ 'DEPRECIATION|AMORTI' then 'dep'
                    when up ~ 'INCOME TAX|PROVISION FOR TAX|DEFERRED TAX' then 'tax'
                    when up ~ 'EMPLOYEE|SALAR|WAGES|BONUS|STAFF|GRATUITY|\yPF\y|\yESI|PROVIDENT|LEAVE ENCASH|INCENTIVE' then 'emp'
                    when up ~ 'FINANCE|INTEREST|PROCESSING FEE|LOAN CHARGE|BANK CHARGE' and upper(p_name) !~ 'INTEREST ON (TDS|GST|INCOME TAX)' then 'fin'
                    else 'exp' end;
        end if;
      end if;
      s := case when w = 'pur' and coalesce(p_mfg, false) then 'mat' else w end;
      h := case when s in ('mat', 'pur', 'chg') then 'pur' when s = 'exp' then case when gp then 'dir' else 'exp' end when s = 'exc' then 'exp' else s end;
      return case when h in ('rev', 'oth', 'pur', 'dir', 'emp', 'exp', 'fin', 'dep', 'tax') then array[s, h] end;
    end if;
  end if;
  -- MIS.headByGroup
  h := case when 'sales accounts' = any(lp) or 'direct incomes' = any(lp) then 'rev'
            when 'indirect incomes' = any(lp) then 'oth'
            when 'purchase accounts' = any(lp) then 'pur'
            when 'direct expenses' = any(lp) then 'dir'
            when 'indirect expenses' = any(lp) then
              case when p_name ~* 'SALAR|WAGES|BONUS|STAFF|GRATUITY|\yPF\y|\yESI\y|EMPLOYEE|INCENTIVE|LEAVE' then 'emp'
                   when p_name ~* 'INTEREST|FINANCE CHARGE|PROCESSING FEE|LOAN CHARGE' and p_name !~* 'INTEREST ON (TDS|GST|INCOME TAX)' then 'fin'
                   when p_name ~* 'DEPRECIATION|AMORTI' then 'dep'
                   when p_name ~* 'INCOME TAX|PROVISION FOR TAX|DEFERRED TAX' then 'tax' else 'exp' end
            when n > 0 then ''
            when coalesce(p_kind, '') <> '' then ''
            when p_name ~* '^SALES|SERVICE RENDERED|REVENUE' then 'rev'
            when p_name ~* '^PURCHASE' then 'pur' else '' end;
  return case when h <> '' then array[case when h = 'dir' then 'exp' else h end, h] end;
end $function$;

-- MIS.flowClean: a name for the partner match
create or replace function public.tally_calc_flowclean(p_n text)
returns text language sql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
  select btrim(regexp_replace(regexp_replace(regexp_replace(upper(coalesce(p_n, '')), '\yA/C\y', ' ', 'g'), '\y(CAPITAL|ACCOUNT|CURRENT)\y', ' ', 'g'), '[^A-Z0-9]+', ' ', 'g'));
$function$;

-- MIS.flowHead(l): {section, line, why (MIS.flowWhy; '' for none)}. p_mark: the owner's confirmed "flow:<ledger>" choice;
-- p_partners: MIS.flowPartners (cleaned name -> Capital Account ledger)
create or replace function public.tally_calc_flowhead(p_name text, p_path text[], p_kind text, p_what text, p_side text, p_mark text, p_partners jsonb)
returns text[] language plpgsql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
declare
  n int := coalesce(array_length(p_path, 1), 0); i int; k text; own text[] := '{}'; top text := ''; ownj text; hit text;
  staff text := 'SALAR|WAGES|BONUS|STAFF|IMPREST|EMPLOYEE|PROVIDENT|\yE?PFO?\y|\yESIC?\y|GRATUITY|PAYROLL';
  kind text := coalesce(p_kind, ''); what text := coalesce(p_what, ''); side text := coalesce(p_side, '');
begin
  -- MIS.flowGroup: the first of Tally's reserved groups up the path (tally_calc_flowkind, in place)
  for j in 1 .. n loop
    k := case lower(regexp_replace(coalesce(p_path[j], ''), '^\s+|\s+$', '', 'g'))
          when 'sundry debtors' then 'debtor' when 'sundry creditors' then 'creditor' when 'duties & taxes' then 'tax' when 'provisions' then 'other'
          when 'fixed assets' then 'fixed' when 'investments' then 'invest' when 'deposits (asset)' then 'invest' when 'loans & advances (asset)' then 'lent'
          when 'loans (liability)' then 'loan' when 'secured loans' then 'loan' when 'unsecured loans' then 'loan'
          when 'capital account' then 'capital' when 'reserves & surplus' then 'capital'
          when 'sales accounts' then 'income' when 'direct incomes' then 'income' when 'indirect incomes' then 'income'
          when 'direct expenses' then 'expense' when 'indirect expenses' then 'expense'
          when 'purchase accounts' then 'other' when 'stock-in-hand' then 'other' when 'current assets' then 'other' when 'current liabilities' then 'other'
          when 'suspense a/c' then 'other' when 'misc. expenses (asset)' then 'other' when 'branch / divisions' then 'other' when 'bank accounts' then 'other'
          when 'bank od a/c' then 'other' when 'bank occ a/c' then 'other' when 'cash-in-hand' then 'other' end;
    if k is not null then i := j; exit; end if;
  end loop;
  if i is not null then own := coalesce(p_path[1 : i - 1], '{}'::text[]); top := regexp_replace(p_path[i], '^\s+|\s+$', '', 'g');
  else k := case when n > 0 then 'other' else '' end; own := coalesce(p_path, '{}'::text[]); top := ''; end if;
  ownj := array_to_string(own, ' | ');
  if k = 'debtor' then return array['op', 'Received from customers', '']; end if;
  if k = 'creditor' then return array['op', 'Paid to suppliers', '']; end if;
  if k = 'fixed' then return array['inv', 'Fixed assets', '']; end if;
  if k = 'invest' then return array['inv', 'Investments and deposits', '']; end if;
  if k = 'lent' and coalesce(p_mark, '') = 'loan_given' then return array['inv', 'Loans given', 'marked Loan given on the Mapping tab']; end if;
  if k = 'loan' then
    select p_partners ->> z.c into hit from unnest(own) with ordinality u(g, o) cross join lateral (select tally_calc_flowclean(u.g) as c) z
     where z.c <> '' and coalesce(p_partners, '{}'::jsonb) ? z.c order by u.o limit 1;
    if hit is not null then return array['fin', 'Partners'' accounts', 'its sub-group is named for a partner: the Capital Account ledger “' || hit || '”']; end if;
    if ownj ~* 'PARTNER' then return array['fin', 'Partners'' accounts', '']; end if;
    return array['fin', 'Loans', ''];
  end if;
  if k = 'capital' then return array['fin', 'Capital and drawings', '']; end if;
  if what = 'gst_setoff' or (kind in ('gst', 'gst_common') and side = 'output') or (what = 'gst_rcm' and side = 'output') then return array['op', 'GST', '']; end if;
  if what = 'gst_interest' then return array['op', 'GST interest and late fees', '']; end if;
  if what ~ '^(gst|gst_common|ineligible|gst_rcm|gst_import|gst_control)$' or kind in ('gst', 'gst_common') then return array['op', 'Input GST paid with bills', '']; end if;
  if coalesce(nullif(kind, ''), nullif(what, ''), '') ~ '^tds_|^tcs_' or ownj ~* '\yTDS\y|\yTCS\y' then return array['op', 'TDS and TCS', '']; end if;
  if ownj ~* 'INCOME TAX|ADVANCE TAX|SELF ASSESSMENT' then return array['op', 'Income tax', '']; end if;
  if ownj ~* staff then return array['op', 'Salaries and staff', '']; end if;
  if k = 'other' and top ~* '^current liabilities$' and own = '{}'::text[] and p_name ~* staff then
    return array['op', 'Salaries and staff', 'directly under Current Liabilities with no sub-group, so its own name decided'];
  end if;
  if k = 'expense' and ownj ~* 'INTEREST|FINANCE COST|BORROWING COST' then return array['fin', 'Interest paid', '']; end if;
  if k = 'lent' then return array['op', 'Loans and advances (asset)', '']; end if;
  if k = 'income' then return array['op', 'Other income received', '']; end if;
  if k = 'expense' then return array['op', 'Expenses paid', '']; end if;
  return array['op', 'Other receipts and payments', ''];
end $function$;

-- ---------------------------------------------------------------- every ledger, with what the engine asks of it
create or replace function public.tally_calc_cls(p_book uuid)
returns table (name text, open numeric, path text[], kind text, what text, side text, reg text, no_pay_tds boolean, in_master boolean, deb boolean, cred boolean, cash boolean, bank boolean,
  sales_acc boolean, pur_acc boolean, inc_di boolean, expense boolean, fixed boolean, gst_paid boolean, tds_l boolean, sales_name boolean)
language sql stable rows 10000 security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
  with bk as (select b.firm_id, b.client_id from tally_books b where b.book_id = p_book),
  mp as (select substr(i.item, 2) as name, i.data from client_book_items i, bk
          where i.firm_id = bk.firm_id and i.client_id = bk.client_id and i.key = 'map' and i.item like '.%' and not i.deleted),
  -- the group path as one lowered text, each name between chr(1)s: a name in it is a reserved group in the path
  l as materialized (select x.name, x.open, x.path, x.kind, x.in_master, x.deb, x.cred, x.cash, x.bank,
           chr(1) || lower(array_to_string(x.path, chr(1))) || chr(1) as lt from tally_calc_led(p_book) x),
  j as (select l.*, coalesce(m.data ->> 'what', '') as w, coalesce(m.data ->> 'side', '') as sd, m.data from l left join mp m on m.name = l.name)
  select j.name, j.open, j.path, j.kind, j.w, j.sd, coalesce(j.data ->> 'reg', ''), coalesce(j.data -> 'payTds' = 'false'::jsonb, false), j.in_master, j.deb, j.cred, j.cash, j.bank,
         strpos(j.lt, chr(1) || 'sales accounts' || chr(1)) > 0, strpos(j.lt, chr(1) || 'purchase accounts' || chr(1)) > 0,
         strpos(j.lt, chr(1) || 'direct incomes' || chr(1)) > 0 or strpos(j.lt, chr(1) || 'indirect incomes' || chr(1)) > 0,
         -- Audit.isExpense
         strpos(j.lt, chr(1) || 'indirect expenses' || chr(1)) > 0 or strpos(j.lt, chr(1) || 'direct expenses' || chr(1)) > 0
           or (j.path = '{}'::text[] and j.kind = '' and j.name ~* 'EXP|CHARGES|RENT|SALARY|WAGES|FEES|REPAIR|FREIGHT|CARTAGE|TRAVEL|CONVEYANCE|COMMISSION|ADVERT'),
         strpos(j.lt, chr(1) || 'fixed assets' || chr(1)) > 0,
         -- MIS.gstPaidTo
         j.w = 'gst_setoff' or (j.kind in ('gst', 'gst_common') and j.sd = 'output') or (j.w = 'gst_rcm' and j.sd = 'output'),
         j.kind in ('tds_payable', 'tds_clearing'),
         -- Books.byContent's name rule: a ledger with no group named for sales
         j.path = '{}'::text[] and j.name ~* '\ySALES?\y'
    from j;
$function$;

-- the period's entries, line by line (b.vouchers, Audit.vouchers: never a deleted, cancelled or optional entry); the
-- amounts to the paisa as BookSrc.fromCopy reads them; id: the line's order in its entry
create or replace function public.tally_calc_vl(p_book uuid, p_from date, p_to date)
returns table (guid text, day date, vtype text, vno text, party text, pos text, cmp text, id bigint, ledger text, a numeric)
language sql stable rows 100000 security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' set enable_nestloop to 'off' as $function$
  select v.guid, v.day, coalesce(v.vtype, ''), coalesce(v.vno, ''), coalesce(v.party, ''), coalesce(v.pos, ''), upper(coalesce(v.cmp_gstin, '')), t.id, t.ledger, round(coalesce(t.amount, 0), 2)
    from tally_vouchers v join tally_lines t on t.book_id = v.book_id and t.guid = v.guid
   where v.book_id = p_book and t.book_id = p_book and v.day between p_from and p_to and v.deleted_at is null
     and v.cancelled is not true and v.optional is not true and coalesce(t.ledger, '') <> '';
$function$;

-- ---------------------------------------------------------------- sales (MIS.sales)
-- Books.isSale on an entry, from its type and what byContent finds on its lines (bcs: a credit to a sales ledger, or to a
-- ledger with no group named for sales; bcp: the same for a purchase ledger, the name rule being byContent's own)
create or replace function public.tally_calc_issale(p_vtype text, p_bcs boolean, p_bcp boolean)
returns boolean language sql immutable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
  select coalesce(p_vtype, '') !~* 'ORDER|DELIVERY NOTE|RECEIPT NOTE|REJECTION|STOCK JOURNAL|PHYSICAL STOCK|MATERIAL (IN|OUT)|MEMO'
     and (coalesce(p_vtype, '') ~* 'SALE|SALES|CREDIT NOTE|EXPORT'
          or (coalesce(p_vtype, '') ~* 'DEBIT NOTE' and coalesce(p_bcs, false) and not coalesce(p_bcp, false))
          or (coalesce(p_vtype, '') !~* 'PUR|PURCHASE|DEBIT NOTE' and coalesce(p_bcs, false)));
$function$;

create or replace function public.tally_calc_sales(p_book uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
declare b tally_books%rowtype; res jsonb; months text[] := tally_calc_months(p_from, p_to); fresh boolean;
begin
  select * into b from tally_books x where x.book_id = p_book;
  if b.book_id is null or p_from is null or p_to is null or p_from > p_to then return null; end if;
  -- MIS.covered(MIS.shift(from, -1)): the books reach a year back, so a customer can be new
  fresh := b.from_date is not null and b.from_date <= tally_calc_shift(p_from, -1, 0);
  with c as materialized (select x.name, x.path, x.kind, x.reg, x.in_master, x.deb, x.sales_acc, x.pur_acc, x.inc_di, x.sales_name from tally_calc_cls(p_book) x),
  -- the masters are read (Audit.mastersIn: a ledger with a group): the Sales Accounts ledgers are the sales. Without
  -- them the browser takes the taxable value of the sale entries (Books.lines), not worked out here
  mi as (select exists (select 1 from c where c.in_master and c.path <> '{}'::text[]) as masters),
  -- only the entries with a sales or an income line count: those first, then only their lines (the lines of
  -- tally_calc_vl: the period's entries, never a deleted, cancelled or optional one)
  cand as materialized (select distinct t.guid from tally_lines t join c on c.name = t.ledger and (c.sales_acc or c.inc_di) where t.book_id = p_book),
  vl as materialized (
      select v.guid, v.day, coalesce(v.party, '') as party, coalesce(v.pos, '') as pos, upper(coalesce(v.cmp_gstin, '')) as cmp, t.id, t.ledger, round(coalesce(t.amount, 0), 2) as a,
             coalesce(c.sales_acc, false) as sa, coalesce(c.inc_di, false) as di, coalesce(c.deb, false) as deb,
             case when c.kind in ('gst', 'gst_common', 'ineligible') and c.reg <> '' then c.reg end as reg
        from cand join tally_vouchers v on v.book_id = p_book and v.guid = cand.guid join tally_lines t on t.book_id = p_book and t.guid = v.guid
             left join c on c.name = t.ledger
       where v.day between p_from and p_to and v.deleted_at is null and v.cancelled is not true and v.optional is not true and coalesce(t.ledger, '') <> ''),
  vs as (select vl.guid, vl.day, vl.party, vl.pos, vl.cmp, sum(vl.a) filter (where vl.sa) as amt, bool_or(vl.sa) as has,
           (array_agg(vl.ledger order by vl.id) filter (where vl.deb))[1] as deb1,
           (array_agg(vl.ledger order by vl.id) filter (where vl.a < 0 and not vl.sa))[1] as neg1,
           (array_agg(vl.ledger order by vl.id) filter (where vl.a >= 0 and not vl.sa))[1] as pos1,
           count(distinct vl.reg) as nreg, min(vl.reg) as reg1
           from vl group by vl.guid, vl.day, vl.party, vl.pos, vl.cmp),
  -- the customer: the entry's party, else its debtor line, else the first line on the other side of the sale; the
  -- registration (GSTR.regOf): the GST ledgers' one registration, else the company GSTIN's state
  sv as materialized (select vs.*, round(vs.amt, 2) as amt2, to_char(vs.day, 'YYYYMM') as ym,
           case when vs.party <> '' then vs.party else coalesce(vs.deb1, case when vs.amt < 0 then vs.pos1 else vs.neg1 end, '—') end as who,
           case when vs.pos <> '' then vs.pos else '—' end as st,
           coalesce(nullif(case when vs.nreg = 1 then vs.reg1 else '' end, ''), nullif(substr(vs.cmp, 1, 2), ''), '—') as rg
           from vs where vs.has and round(vs.amt, 2) <> 0),
  pr as materialized (select sv.who, sum(sv.amt2) as t, count(*) as n from sv group by sv.who),
  pm as (select q.who, jsonb_object_agg(q.ym, q.a) as m from (select sv.who, sv.ym, sum(sv.amt2) as a from sv group by 1, 2) q group by q.who),
  -- the parties of the sale entries before the period (Books.isSale on any entry the books hold, cancelled and optional
  -- ones too); the lines are looked at only for a type that does not say
  bv as (select v.guid, coalesce(v.vtype, '') as vtype, coalesce(v.party, '') as party from tally_vouchers v
          where fresh and v.book_id = p_book and v.day < p_from and v.deleted_at is null
            and (exists (select 1 from tally_lines t where t.book_id = v.book_id and t.guid = v.guid and coalesce(t.ledger, '') <> '') or (coalesce(v.cancelled, false) and coalesce(v.vno, '') <> ''))
            and coalesce(v.vtype, '') !~* 'ORDER|DELIVERY NOTE|RECEIPT NOTE|REJECTION|STOCK JOURNAL|PHYSICAL STOCK|MATERIAL (IN|OUT)|MEMO'),
  bu as (select bv.guid, bool_or(coalesce(c.sales_acc, false) or coalesce(c.sales_name, t.ledger ~* '\ySALES?\y')) as bcs,
           bool_or(coalesce(c.pur_acc, false) or coalesce(c.sales_name, t.ledger ~* '\ySALES?\y')) as bcp
           from bv join tally_lines t on t.book_id = p_book and t.guid = bv.guid and t.amount > 0 left join c on c.name = t.ledger
          where bv.vtype !~* 'SALE|SALES|CREDIT NOTE|EXPORT|JOURNAL|PAYMENT|RECEIPT|CONTRA' group by bv.guid),
  bf as (select distinct bv.party from bv left join bu on bu.guid = bv.guid
          where bv.vtype ~* 'SALE|SALES|CREDIT NOTE|EXPORT'
             or (bv.vtype !~* 'JOURNAL|PAYMENT|RECEIPT|CONTRA' and tally_calc_issale(bv.vtype, bu.bcs, bu.bcp))),
  top5 as (select pr.t from pr order by pr.t desc, pr.who collate "und-x-icu" limit 5)
  select case when not mi.masters then jsonb_build_object('masters', false, 'why', 'the ledger masters are not in the cloud copy') else jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object('party', pr.who, 't', pr.t, 'm', pm.m, 'n', pr.n) order by pr.t desc, pr.who collate "und-x-icu") from pr join pm on pm.who = pr.who), '[]'::jsonb),
      'total', coalesce((select sum(pr.t) from pr), 0),
      'other', coalesce((select sum(vl.a) from vl where vl.di), 0),
      'months', to_jsonb(months),
      'byState', coalesce((select jsonb_agg(jsonb_build_array(q.st, q.a) order by q.a desc, q.first) from (select sv.st, sum(sv.amt2) as a, min(sv.day::text || sv.guid) as first from sv group by 1) q), '[]'::jsonb),
      'byReg', coalesce((select jsonb_agg(jsonb_build_array(q.rg, q.a) order by q.rg collate "und-x-icu") from (select sv.rg, sum(sv.amt2) as a from sv group by 1) q), '[]'::jsonb),
      'top5', coalesce((select sum(top5.t) from top5), 0),
      'fresh', case when fresh then (select count(*) from pr where pr.who not in (select bf.party from bf)) end,
      'masters', true) end
    into res from mi;
  return res;
end $function$;

-- the sales total alone (MIS.sales(from, to).total: prev, ly; mtd and ytd in one pass, p_from2 the later start):
-- {the total from p_from, the total from p_from2}, both to p_to; none without the masters
create or replace function public.tally_calc_sales_total(p_book uuid, p_from date, p_to date, p_from2 date default null)
returns numeric[] language sql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
  with c0 as materialized (select x.name, x.sales_acc, x.in_master and x.path <> '{}'::text[] as m from tally_calc_cls(p_book) x),
  c as (select c0.name from c0 where c0.sales_acc),
  q as (select v.guid, v.day, sum(round(coalesce(t.amount, 0), 2)) as a from tally_lines t join c on c.name = t.ledger join tally_vouchers v on v.book_id = p_book and v.guid = t.guid
         where t.book_id = p_book and v.day between p_from and p_to and v.deleted_at is null and v.cancelled is not true and v.optional is not true group by v.guid, v.day)
  select case when exists (select 1 from c0 where c0.m) then array[coalesce(sum(round(q.a, 2)), 0), coalesce(sum(round(q.a, 2)) filter (where q.day >= p_from2), 0)] end from q;
$function$;

-- ---------------------------------------------------------------- purchases (MIS.purchases)
create or replace function public.tally_calc_purchases(p_book uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
declare res jsonb; months text[] := tally_calc_months(p_from, p_to); nm int;
begin
  if not exists (select 1 from tally_books x where x.book_id = p_book) or p_from is null or p_to is null or p_from > p_to then return null; end if;
  nm := coalesce(array_length(months, 1), 0);
  with c as materialized (select * from tally_calc_cls(p_book)),
  -- an entry counts only with a supplier credited (MIS.purchases' p): those entries first, then only their lines (the
  -- lines of tally_calc_vl: the period's entries, never a deleted, cancelled or optional one)
  cand as materialized (select distinct t.guid from tally_lines t join c on c.name = t.ledger and c.cred where t.book_id = p_book and round(t.amount, 2) > 0),
  vl as materialized (select v.guid, v.day, coalesce(v.vtype, '') as vtype, t.id, t.ledger, round(coalesce(t.amount, 0), 2) as a,
             coalesce(c.cred, false) as cred, coalesce(c.expense or c.pur_acc or c.fixed, false) as cost,
             coalesce(c.sales_acc, false) as sa, coalesce(c.pur_acc, false) as pa, coalesce(c.sales_name, t.ledger ~* '\ySALES?\y') as sn
        from cand join tally_vouchers v on v.book_id = p_book and v.guid = cand.guid join tally_lines t on t.book_id = p_book and t.guid = v.guid
             left join c on c.name = t.ledger
       where v.day between p_from and p_to and v.deleted_at is null and v.cancelled is not true and v.optional is not true and coalesce(t.ledger, '') <> ''),
  vs as (select vl.guid, vl.day, vl.vtype,
           (array_agg(vl.ledger order by vl.id) filter (where vl.a > 0 and vl.cred))[1] as p,
           round(coalesce(sum(-vl.a) filter (where vl.a < 0 and vl.cost), 0), 2) as val,
           bool_or(vl.a > 0 and (vl.sa or vl.sn)) as bcs0,
           bool_or(vl.a > 0 and (vl.pa or vl.sn)) as bcp0
           from vl group by vl.guid, vl.day, vl.vtype),
  vp as (select vs.*, to_char(vs.day, 'YYYYMM') as ym from vs
          where not tally_calc_issale(vs.vtype, vs.vtype !~* 'JOURNAL|PAYMENT|RECEIPT|CONTRA' and vs.bcs0, vs.vtype !~* 'JOURNAL|PAYMENT|RECEIPT|CONTRA' and vs.bcp0)
            and vs.p is not null and vs.val <> 0),
  pr as (select vp.p, sum(vp.val) as t, count(*) as n from vp group by vp.p),
  pm as (select q.p, jsonb_object_agg(q.ym, q.a) as m from (select vp.p, vp.ym, sum(vp.val) as a from vp group by 1, 2) q group by q.p),
  -- the expense heads by month (MIS.moves: the day totals), and the months that jumped
  mv as (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as a from tally_ledger_day d
          where d.book_id = p_book and d.merged_into is null and d.day between p_from and p_to group by 1, 2),
  -- every month nought, then the months that moved (a month with no entry is nought: never a jump)
  zero as (select jsonb_object_agg(x, 0) as z from unnest(months) x),
  hm as (select mv.ledger, mv.ym, -mv.a as v from mv join c on c.name = mv.ledger and (c.expense or c.pur_acc)),
  hj as (select hm.*, sum(hm.v) over (partition by hm.ledger) as s from hm),
  hd as (select hj.ledger, hj.s as t, (select zero.z from zero) || jsonb_object_agg(hj.ym, hj.v) as m,
           coalesce(jsonb_agg(hj.ym order by hj.ym) filter (where hj.v >= 50000 and nm > 1 and (hj.s - hj.v) / (nm - 1) > 0 and hj.v > (hj.s - hj.v) / (nm - 1) * 1.5), '[]'::jsonb) as jumps
           from hj group by hj.ledger, hj.s)
  select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object('party', pr.p, 't', pr.t, 'm', pm.m, 'n', pr.n) order by pr.t desc, pr.p collate "und-x-icu") from pr join pm on pm.p = pr.p), '[]'::jsonb),
      'months', to_jsonb(months),
      'heads', coalesce((select jsonb_agg(jsonb_build_object('l', hd.ledger, 't', hd.t, 'm', hd.m, 'jumps', hd.jumps) order by hd.t desc, hd.ledger collate "und-x-icu") from hd), '[]'::jsonb),
      'total', coalesce((select sum(pr.t) from pr), 0),
      -- MIS.runNow's r.goods: a Purchase Accounts ledger moved by a rupee or more
      'goods', exists (select 1 from (select mv.ledger, sum(mv.a) as t from mv group by 1) g join c on c.name = g.ledger and c.pur_acc where abs(g.t) >= 1))
    into res;
  return res;
end $function$;

-- ---------------------------------------------------------------- the profit and loss (MIS.pl, MIS.plRule)
create or replace function public.tally_calc_pl(p_book uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
declare b tally_books%rowtype; res jsonb; months text[] := tally_calc_months(p_from, p_to); last_m text; fmap jsonb; mfg boolean;
begin
  select * into b from tally_books x where x.book_id = p_book;
  if b.book_id is null or p_from is null or p_to is null or p_from > p_to then return null; end if;
  last_m := months[array_length(months, 1)];
  -- FS.cfg(books): the lines chosen on the Mapping tab and the manufacturing switch (client_book_items "fs")
  select i.data into fmap from client_book_items i where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'fs' and i.item = '.map' and not i.deleted;
  select tally_calc_truthy(i.data) into mfg from client_book_items i where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'fs' and i.item = '.mfg' and not i.deleted;
  if jsonb_typeof(fmap) is distinct from 'object' then fmap := '{}'::jsonb; end if;
  with mv as materialized (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as a from tally_ledger_day d
          where d.book_id = p_book and d.merged_into is null and d.day between p_from and p_to group by 1, 2),
  lt as (select mv.ledger, sum(mv.a) as t from mv group by 1),
  c as materialized (select x.name, x.path, x.kind, chr(1) || lower(array_to_string(x.path, chr(1))) || chr(1) as lt from tally_calc_led(p_book) x),
  -- each ledger with its head; income credit positive, expenses debit positive
  hd as (select lt.ledger, lt.t, ph[1] as s, ph[2] as h, case when ph[2] in ('rev', 'oth') then 1 else -1 end as sg
           from lt left join c on c.name = lt.ledger
           cross join lateral (select tally_calc_plhead(lt.ledger, coalesce(c.path, '{}'::text[]), coalesce(c.kind, ''), tally_calc_lineof(fmap ->> lt.ledger), mfg) as ph) z
          -- MIS.plHead is null for a ledger whose groups hold no profit and loss group: not asked
          where (c.path is null or c.path = '{}'::text[] or c.lt ~ ('\x01(sales accounts|direct incomes|indirect incomes|purchase accounts|direct expenses|indirect expenses)\x01'))
            and z.ph is not null),
  zero as (select jsonb_object_agg(x, 0) as z from unnest(months) x),
  hdm as (select hd.ledger, (select zero.z from zero) || jsonb_object_agg(mv.ym, round(mv.a * hd.sg, 2)) as m
            from hd join mv on mv.ledger = hd.ledger group by hd.ledger),
  rw as materialized (select hd.ledger as l, hd.s, hd.h, round(hd.t * hd.sg, 2) as t, hdm.m,
           hd.sg < 0 and hd.s in ('mat', 'pur', 'emp', 'fin', 'dep', 'exp') and round(hd.t * hd.sg, 2) < -0.004 as flag
           from hd join hdm on hdm.ledger = hd.ledger),
  -- the rule for an expense ledger in credit: set off in its line (s); a line that ends in credit goes to Other income
  so as (select x.s, array_position(array['mat', 'pur', 'emp', 'fin', 'dep', 'exp'], x.s) as so,
           coalesce(sum(x.t) filter (where x.t > 0), 0) as dr, coalesce(-sum(x.t) filter (where x.t < 0), 0) as cr, count(distinct x.h) as nh
           from rw x where x.s in ('mat', 'pur', 'emp', 'fin', 'dep', 'exp') group by x.s),
  sh as (select x.s, x.h, array_position(array['rev', 'oth', 'pur', 'dir', 'emp', 'exp', 'fin', 'dep', 'tax'], x.h) as ho, sum(x.t) as by_h
           from rw x where x.s in ('mat', 'pur', 'emp', 'fin', 'dep', 'exp') group by x.s, x.h),
  st as (select so.*, so.dr - so.cr as tt, case when so.s = 'mat' then 'Cost of materials consumed' when so.s = 'pur' then 'Purchases of stock-in-trade'
           when so.s = 'emp' then 'Employee benefits expense' when so.s = 'fin' then 'Finance costs' when so.s = 'dep' then 'Depreciation and amortisation expense'
           else 'Other expenses' end as lab from so),
  sp as (select sh.*, st.so, st.tt, st.nh, st.lab,
           coalesce(-sum(sh.by_h) filter (where sh.by_h < 0) over (partition by sh.s), 0) as left0,
           coalesce(sum(case when sh.by_h > 0 then sh.by_h else 0 end) over (partition by sh.s order by sh.ho rows between unbounded preceding and 1 preceding), 0) as cum
           from sh join st on st.s = sh.s),
  sl as (
    -- the line ends in credit: each part set off, what is left to Other income
    select sp.s, sp.h, sp.so, 1 as k, sp.ho, -sp.by_h as t,
           case when sp.nh < 2 then 'Excess credit moved to Other income' when sp.by_h > 0 then 'Set off against the credits in ' || sp.lab
                else 'Set off against the rest of ' || sp.lab || '; the excess credit moved to Other income' end as l
      from sp where sp.tt < -0.004
    union all
    -- in debit, but a part MIS shows apart is in credit: set off against the others, in order
    select sp.s, sp.h, sp.so, 1, sp.ho, -sp.by_h, 'Set off against the rest of ' || sp.lab from sp where sp.tt >= -0.004 and sp.nh > 1 and sp.by_h < 0
    union all
    select sp.s, sp.h, sp.so, 2, sp.ho, -greatest(0, least(sp.by_h, sp.left0 - least(sp.left0, sp.cum))), 'Credits in ' || sp.lab || ' set off here'
      from sp where sp.tt >= -0.004 and sp.nh > 1 and sp.by_h > 0 and least(sp.by_h, sp.left0 - least(sp.left0, sp.cum)) > 0),
  sl2 as (select sl.*, row_number() over (order by sl.so, sl.k, sl.ho) as o from sl where abs(sl.t) >= 0.005),
  mo as (select st.s, st.so, -st.tt as t, 'Excess credit in ' || st.lab as l from st where st.tt < -0.004),
  -- every row of each head: the ledgers (largest first), then the set-off lines, then (Other income) the excess credits
  allr as (
    select rw.h, 1 as grp, row_number() over (partition by rw.h order by abs(rw.t) desc, rw.l collate "und-x-icu") as o, rw.l, rw.t, rw.m,
           case when rw.flag then jsonb_build_object('flag', 'expense ledger with a credit balance') else '{}'::jsonb end as extra from rw
    union all
    select sl2.h, 2, sl2.o, sl2.l, round(sl2.t, 2), (select jsonb_object_agg(x, case when x = last_m then round(sl2.t, 2) else 0 end) from unnest(months) x), jsonb_build_object('so', true) from sl2
    union all
    select 'oth', 3, mo.so, mo.l, round(mo.t, 2), (select jsonb_object_agg(x, case when x = last_m then round(mo.t, 2) else 0 end) from unnest(months) x), jsonb_build_object('so', true, 'from', mo.s) from mo),
  hm as (select allr.h, x.key as ym, sum(x.value::numeric) as v from allr cross join lateral jsonb_each_text(allr.m) x group by 1, 2),
  heads as (select allr.h, sum(allr.t) as t,
              jsonb_agg(jsonb_build_object('l', allr.l, 't', allr.t, 'm', allr.m) || allr.extra order by allr.grp, allr.o) as led
              from allr group by allr.h),
  hj as (select heads.h, heads.t, heads.led, (select jsonb_object_agg(hm.ym, hm.v) from hm where hm.h = heads.h) as m from heads),
  g as (select coalesce(sum(hj.t) filter (where hj.h = 'rev'), 0) as rev, coalesce(sum(hj.t) filter (where hj.h = 'oth'), 0) as oth,
          coalesce(sum(hj.t) filter (where hj.h = 'pur'), 0) as pur, coalesce(sum(hj.t) filter (where hj.h = 'dir'), 0) as dir,
          coalesce(sum(hj.t) filter (where hj.h = 'emp'), 0) as emp, coalesce(sum(hj.t) filter (where hj.h = 'exp'), 0) as exp,
          coalesce(sum(hj.t) filter (where hj.h = 'fin'), 0) as fin, coalesce(sum(hj.t) filter (where hj.h = 'dep'), 0) as dep,
          coalesce(sum(hj.t) filter (where hj.h = 'tax'), 0) as tax from hj),
  gm as (select x as ym,
           coalesce(sum(hm.v) filter (where hm.h = 'rev'), 0) as rev, coalesce(sum(hm.v) filter (where hm.h = 'oth'), 0) as oth,
           coalesce(sum(hm.v) filter (where hm.h = 'pur'), 0) as pur, coalesce(sum(hm.v) filter (where hm.h = 'dir'), 0) as dir,
           coalesce(sum(hm.v) filter (where hm.h = 'emp'), 0) as emp, coalesce(sum(hm.v) filter (where hm.h = 'exp'), 0) as exp,
           coalesce(sum(hm.v) filter (where hm.h = 'fin'), 0) as fin, coalesce(sum(hm.v) filter (where hm.h = 'dep'), 0) as dep,
           coalesce(sum(hm.v) filter (where hm.h = 'tax'), 0) as tax
           from unnest(months) x left join hm on hm.ym = x group by x)
  select jsonb_build_object(
      'months', to_jsonb(months),
      'heads', coalesce((select jsonb_object_agg(hj.h, jsonb_build_object('t', hj.t, 'm', hj.m, 'led', hj.led)) from hj), '{}'::jsonb),
      'sum', coalesce((select jsonb_object_agg(st.s, jsonb_build_object('dr', st.dr, 'cr', st.cr, 'moved', case when st.tt < -0.004 then -st.tt else 0 end, 't', greatest(0, st.tt), 'label', st.lab)) from st), '{}'::jsonb),
      'income', jsonb_build_object('t', g.rev + g.oth, 'm', (select jsonb_object_agg(gm.ym, gm.rev + gm.oth) from gm)),
      'gross', jsonb_build_object('t', g.rev - g.pur - g.dir, 'm', (select jsonb_object_agg(gm.ym, gm.rev - gm.pur - gm.dir) from gm)),
      'ebitda', jsonb_build_object('t', g.rev + g.oth - g.pur - g.dir - g.emp - g.exp, 'm', (select jsonb_object_agg(gm.ym, gm.rev + gm.oth - gm.pur - gm.dir - gm.emp - gm.exp) from gm)),
      'pbt', jsonb_build_object('t', g.rev + g.oth - g.pur - g.dir - g.emp - g.exp - g.fin - g.dep, 'm', (select jsonb_object_agg(gm.ym, gm.rev + gm.oth - gm.pur - gm.dir - gm.emp - gm.exp - gm.fin - gm.dep) from gm)),
      'pat', jsonb_build_object('t', g.rev + g.oth - g.pur - g.dir - g.emp - g.exp - g.fin - g.dep - g.tax, 'm', (select jsonb_object_agg(gm.ym, gm.rev + gm.oth - gm.pur - gm.dir - gm.emp - gm.exp - gm.fin - gm.dep - gm.tax) from gm)))
    into res from g;
  return res;
end $function$;

-- ---------------------------------------------------------------- cash and bank (MIS.cashflow, MIS.cashActual)
create or replace function public.tally_calc_cash(p_book uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
declare b tally_books%rowtype; res jsonb; months text[] := tally_calc_months(p_from, p_to); okb boolean; choices jsonb;
begin
  select * into b from tally_books x where x.book_id = p_book;
  if b.book_id is null or p_from is null or p_to is null or p_from > p_to then return null; end if;
  -- the owner's Loan-given marks (MIS.flowMark: the client's confirmed "flow:<ledger>" choices)
  select cl0.data -> 'choices' into choices from clients cl0 where cl0.firm_id = b.firm_id and cl0.id::text = b.client_id;
  -- Audit.balances from the books' first day: no opening or closing for a period that begins before it
  okb := b.from_date is not null and p_from >= b.from_date;
  with c as materialized (select x.name, x.open, x.path, x.kind, x.what, x.side, x.in_master, x.cash or x.bank as cb from tally_calc_cls(p_book) x),
  -- MIS.flowPartners: the people the Capital Account ledgers name
  pt as (select coalesce(jsonb_object_agg(z.cn, z.name order by z.name), '{}'::jsonb) as j from (
           select c.name, tally_calc_flowclean(c.name) as cn from c
            where c.in_master and c.path <> '{}'::text[] and coalesce(c.path[1], '') !~* 'reserves'
              and exists (select 1 from unnest(c.path) g where regexp_replace(g, '^\s+|\s+$', '', 'g') ~* '^capital account$')) z where z.cn <> ''),
  -- Audit.balances(from, to).at(d) summed over cash and bank: the openings plus every entry from the books' first day to d
  -- (tally_calc_bal's rule, from the ledgers already read)
  dm as (select coalesce(sum(d.amount) filter (where d.day <= p_from - 1), 0) as a0, coalesce(sum(d.amount), 0) as a1
           from tally_ledger_day d join c on c.name = d.ledger and c.cb
          where okb and d.book_id = p_book and d.merged_into is null and d.day >= b.from_date and d.day <= p_to),
  oc as (select case when okb then round(-((select coalesce(sum(c.open), 0) from c where c.cb) + dm.a0), 2) end as op,
                case when okb then round(-((select coalesce(sum(c.open), 0) from c where c.cb) + dm.a1), 2) end as cl from dm),
  vl as materialized (select x.*, coalesce(c.cb, false) as cb from tally_calc_vl(p_book, p_from, p_to) x left join c on c.name = x.ledger),
  -- MIS.cashflow: what came into and went out of cash and bank, contra entries left out
  rp as (select coalesce(sum(-vl.a) filter (where vl.a < 0), 0) as rec, coalesce(sum(vl.a) filter (where vl.a >= 0), 0) as pay from vl where vl.cb and vl.vtype !~* 'CONTRA'),
  -- MIS.cashActual: the cash moved, spread over the lines on the other side of it (in double precision, as the browser)
  vn as (select vl.guid, sum(vl.a::float8 order by vl.id) filter (where vl.cb) as net, count(*) filter (where vl.cb) as ncb, count(*) filter (where not vl.cb) as nother
           from vl group by vl.guid),
  op_ as (select vl.*, vn.net from vl join vn on vn.guid = vl.guid where vn.ncb > 0 and vn.nother > 0 and not vl.cb and ((vl.a > 0) = (vn.net < 0))),
  tt as (select op_.guid, sum(abs(op_.a)::float8 order by op_.id) as tot from op_ group by 1),
  sh as materialized (select op_.guid, op_.day, op_.id, op_.ledger, to_char(op_.day, 'YYYYMM') as ym,
           -- r2 on a JavaScript number (tally_calc_r2f, in place)
           round((floor(((-op_.net) * abs(op_.a)::float8 / tt.tot + 2.220446049250313e-16::float8) * 100::float8 + 0.5::float8) / 100::float8)::numeric, 2) as share
           from op_ join tt on tt.guid = op_.guid where tt.tot <> 0 and abs(op_.net) >= 0.01),
  fh as materialized (select s.ledger, tally_calc_flowhead(s.ledger, coalesce(c.path, '{}'::text[]), c.kind, c.what, c.side,
                  case when choices -> ('flow:' || s.ledger) ->> 'state' = 'confirmed' then nullif(choices -> ('flow:' || s.ledger) ->> 'value', '') end, (select pt.j from pt)) as h,
                coalesce(c.path, '{}'::text[]) as path
           from (select distinct sh.ledger from sh) s left join c on c.name = s.ledger),
  -- money in on a line named for paying (or out on one named for receiving) has a line of its own
  ln as materialized (select sh.*, fh.h[1] as sec,
           case when sh.share > 0 and fh.h[2] = 'Paid to suppliers' then 'Refunds and receipts from suppliers'
                when sh.share > 0 and fh.h[2] = 'Income tax' then 'Tax refunds'
                when sh.share < 0 and fh.h[2] = 'Received from customers' then 'Refunds and payments to customers'
                when sh.share > 0 and fh.h[2] = 'Expenses paid' then 'Expenses refunded or recovered' else fh.h[2] end as lab
           from sh join fh on fh.ledger = sh.ledger),
  rw as (select ln.sec, ln.lab, sum(ln.share) as t, min(ln.day::text || ln.guid || lpad(ln.id::text, 20, '0')) as first from ln group by 1, 2),
  rm as (select q.sec, q.lab, jsonb_object_agg(q.ym, q.a) as m from (select ln.sec, ln.lab, ln.ym, sum(ln.share) as a from ln group by 1, 2, 3) q group by 1, 2),
  rl as (select q.sec, q.lab, jsonb_object_agg(q.ledger, q.a) as led from (select ln.sec, ln.lab, ln.ledger, sum(ln.share) as a from ln group by 1, 2, 3) q group by 1, 2),
  sm as (select ln.sec, ln.ym, sum(ln.share) as a from ln group by 1, 2),
  secm as (select s.sec, x as ym, coalesce(sm.a, 0) as a from unnest(array['op', 'inv', 'fin']) s(sec) cross join unnest(months) x left join sm on sm.sec = s.sec and sm.ym = x),
  nt as (select coalesce(sum(ln.share), 0) as net from ln)
  select jsonb_build_object(
      'cash', jsonb_build_object('rec', rp.rec, 'pay', rp.pay),
      'flow', jsonb_build_object(
        'months', to_jsonb(months),
        'rows', coalesce((select jsonb_agg(jsonb_build_object('sec', rw.sec, 'lab', rw.lab, 't', rw.t, 'm', rm.m, 'led', rl.led)
                            order by array_position(array['op', 'inv', 'fin'], rw.sec), rw.t desc, rw.first)
                          from rw join rm on rm.sec = rw.sec and rm.lab = rw.lab join rl on rl.sec = rw.sec and rl.lab = rw.lab), '[]'::jsonb),
        'op', jsonb_build_object('t', coalesce((select sum(sm.a) from sm where sm.sec = 'op'), 0), 'm', (select jsonb_object_agg(secm.ym, secm.a) from secm where secm.sec = 'op')),
        'inv', jsonb_build_object('t', coalesce((select sum(sm.a) from sm where sm.sec = 'inv'), 0), 'm', (select jsonb_object_agg(secm.ym, secm.a) from secm where secm.sec = 'inv')),
        'fin', jsonb_build_object('t', coalesce((select sum(sm.a) from sm where sm.sec = 'fin'), 0), 'm', (select jsonb_object_agg(secm.ym, secm.a) from secm where secm.sec = 'fin')),
        'net', nt.net, 'open', oc.op, 'close', oc.cl,
        'diff', case when oc.op is not null then oc.cl - oc.op - nt.net end,
        'ties', oc.op is null or abs(oc.cl - oc.op - nt.net) < 1,
        -- the grouping notes (MIS.flowNotes) for the ledgers that moved money in the period
        'notes', coalesce((select jsonb_agg(jsonb_build_object('ledger', fh.ledger, 'group', array_to_string(fh.path, ' ← '), 'line', fh.h[2], 'why', fh.h[3]) order by fh.ledger collate "und-x-icu")
                             from fh where fh.h[3] <> ''), '[]'::jsonb)))
    into res from rp, nt, oc;
  return res;
end $function$;

-- ---------------------------------------------------------------- compliance, without GST 3B (MIS.compliance)
create or replace function public.tally_calc_comp(p_book uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
declare b tally_books%rowtype; res jsonb; months text[] := tally_calc_months(p_from, p_to); okb boolean;
begin
  select * into b from tally_books x where x.book_id = p_book;
  if b.book_id is null or p_from is null or p_to is null or p_from > p_to then return null; end if;
  okb := b.from_date is not null and p_from >= b.from_date;
  with c as materialized (select x.name, x.open, x.kind, x.no_pay_tds, x.gst_paid, x.tds_l from tally_calc_cls(p_book) x),
  -- MIS.booksPaid: TDS deducted and paid by Books.lines' rules; GST paid to the government by a bank payment
  vl as materialized (select x.*, coalesce(c.kind, '') as kind, coalesce(c.gst_paid, false) as gp,
             coalesce(c.no_pay_tds, false) and x.ledger !~* '\yTDS\y|INCOME[[:space:]-]*TAX' as not_tds
        from tally_calc_vl(p_book, p_from, p_to) x left join c on c.name = x.ledger),
  vv as (select vl.guid, bool_or(vl.kind = 'bank') as hb, bool_or(vl.kind = 'tds_clearing' and vl.a > 0) as hc, bool_or(vl.kind = 'bank' and vl.a > 0) as hbc from vl group by 1),
  x as (select to_char(vl.day, 'YYYYMM') as ym,
          case when vl.kind = 'tds_payable' and not vl.not_tds and vl.a > 0 then vl.a else 0 end as ded,
          case when vl.kind = 'tds_clearing' and vl.a < 0 and vv.hb then abs(vl.a)
               when vl.kind = 'tds_payable' and not vl.not_tds and vl.a <= 0 and not (vl.a < 0 and vv.hc) and vv.hb then abs(vl.a) else 0 end as paid,
          case when vv.hbc and vl.a < 0 and vl.gp then -vl.a else 0 end as gst
          from vl join vv on vv.guid = vl.guid),
  bp as (select x.ym, sum(x.gst) as gst, sum(x.ded) as ded, sum(x.paid) as paid from x group by 1),
  tot as (select coalesce(sum(bp.ded), 0) as ded, coalesce(sum(bp.paid), 0) as paid from bp),
  -- MIS.tdsPayable: opening + deducted - paid = closing, against the TDS ledgers' balance (none before the books begin)
  -- the TDS ledgers' balance (a credit, owed, positive): the openings plus every entry from the books' first day
  dm as (select coalesce(sum(d.amount) filter (where d.day <= p_from - 1), 0) as a0, coalesce(sum(d.amount), 0) as a1
           from tally_ledger_day d join c on c.name = d.ledger and c.tds_l
          where okb and d.book_id = p_book and d.merged_into is null and d.day >= b.from_date and d.day <= p_to),
  ow as (select case when okb then round((select coalesce(sum(c.open), 0) from c where c.tds_l) + dm.a0, 2) end as op,
                case when okb then round((select coalesce(sum(c.open), 0) from c where c.tds_l) + dm.a1, 2) end as bk from dm),
  -- the challans typed or brought in (TDS.challans: client_book_items "challans"), by the month of their date
  ch as (select i.data from client_book_items i where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'challans' and i.item like '#%' and not i.deleted
            and not tally_calc_truthy(i.data -> 'deleted')),
  cm as (select substr(z.d, 1, 6) as ym, sum(tally_calc_num(ch.data -> 'tax')) as tax
           from ch cross join lateral (select regexp_replace(coalesce(ch.data ->> 'date', ''), '[^0-9]', '', 'g') as d) z where length(z.d) >= 6 group by 1)
  select jsonb_build_object(
      -- GST: what was paid from the bank; the output, credit and tax worked out to pay are GST 3B's (its own helper)
      'gst', (select jsonb_agg(jsonb_build_object('ym', u.m, 'pay', coalesce(bp.gst, 0)) order by u.o) from unnest(months) with ordinality u(m, o) left join bp on bp.ym = u.m),
      'tds', (select jsonb_agg(jsonb_build_object('ym', u.m, 'ded', coalesce(bp.ded, 0), 'dep', coalesce(bp.paid, 0), 'challans', round(coalesce(cm.tax, 0), 2)) order by u.o)
                from unnest(months) with ordinality u(m, o) left join bp on bp.ym = u.m left join cm on cm.ym = u.m),
      'tdsRoll', jsonb_build_object('open', coalesce(ow.op, 0), 'ded', tot.ded, 'paid', tot.paid, 'close', coalesce(ow.op, 0) + tot.ded - tot.paid, 'books', ow.bk,
                   'ties', ow.bk is null or abs(ow.bk - (coalesce(ow.op, 0) + tot.ded - tot.paid)) < 1))
    into res from tot, ow;
  return res;
end $function$;

-- ---------------------------------------------------------------- MSME suppliers past the days (MIS.runNow's r.msme)
create or replace function public.tally_calc_msme(p_book uuid, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
declare b tally_books%rowtype; ag jsonb; md numeric := 45; v jsonb; res jsonb; pb jsonb; mm jsonb;
begin
  select * into b from tally_books x where x.book_id = p_book;
  if b.book_id is null or p_to is null then return null; end if;
  -- MIS.cfg: misCfg.msmeDays, else 45
  select i.data into v from client_book_items i where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'misCfg' and i.item = '.msmeDays' and not i.deleted;
  if v is not null then md := tally_calc_num(v); end if;
  -- MIS.msme: the Udyam type in the ledger masters (ledInfo), the type set on the page (msme) over it ('' takes it off);
  -- only a micro or small enterprise counts here
  with li as (select substr(i.item, 2) as name, i.data ->> 'msme' as t from client_book_items i
                where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'ledInfo' and i.item like '.%' and not i.deleted and tally_calc_truthy(i.data -> 'msme')),
  ms as (select substr(i.item, 2) as name, i.data from client_book_items i
                where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'msme' and i.item like '.%' and not i.deleted),
  m0 as (select coalesce(ms.name, li.name) as name, case when ms.name is not null then case when tally_calc_truthy(ms.data) then ms.data #>> '{}' end else li.t end as t
           from li full join ms on ms.name = li.name)
  select coalesce(jsonb_object_agg(m0.name, m0.t), '{}'::jsonb) into mm from m0 where m0.t ~* 'micro|small';
  if mm = '{}'::jsonb then return jsonb_build_object('days', md, 'rows', '[]'::jsonb); end if;
  -- the payables ageing on the day (MIS.ageing(to, "p"), tally_calc_ageing_bal) of these suppliers alone: each party's
  -- row is its own bills and its own balance (Audit.balances: the opening plus every entry from the books' first day)
  with l as (select x.name, x.open, x.deb, x.cred from tally_calc_led(p_book) x where x.cred and mm ? x.name),
  d as (select d.ledger, sum(d.amount) as a from tally_ledger_day d join l on l.name = d.ledger
         where d.book_id = p_book and d.merged_into is null and d.day >= b.from_date and d.day <= p_to group by 1)
  select coalesce(jsonb_object_agg(l.name, jsonb_build_array(l.open + coalesce(d.a, 0), l.deb, l.cred)), '{}'::jsonb) into pb from l left join d on d.ledger = l.name;
  ag := tally_calc_ageing_bal(p_book, p_to, 'p', pb);
  -- the bills left past the days, party by party in the ageing's order (MIS.runNow's r.msme)
  with pr as (select r.o, r.x ->> 'party' as party, mm ->> (r.x ->> 'party') as t, r.x -> 'open' as op
                from jsonb_array_elements(coalesce(ag -> 'rows', '[]'::jsonb)) with ordinality r(x, o)),
  pb2 as (select pr.o, pr.party, pr.t, jsonb_agg(z.y order by z.k) as bills, sum((z.y ->> 'left')::numeric) as amt
           from pr cross join lateral jsonb_array_elements(pr.op) with ordinality z(y, k) where (z.y ->> 'age')::numeric > md group by 1, 2, 3)
  select coalesce(jsonb_agg(jsonb_build_object('party', pb2.party, 'type', pb2.t, 'bills', pb2.bills, 'amt', round(pb2.amt, 2)) order by pb2.o), '[]'::jsonb) into res from pb2;
  return jsonb_build_object('days', md, 'rows', res);
end $function$;

-- ---------------------------------------------------------------- the control against Tally's balances (r.control)
-- MIS.runNow (src/js/07-mis.js as of next-mis-speed b33f4a180): the control is worked out only on Tally's own closing
-- balances (the bridge's trial balance read, a trial balance file). FinCom's cloud copy has openings only (tally_ledgers
-- has no closing) or closings FinCom worked out itself, and the browser marks its balances tb.src "copy" and skips the
-- check ("963 ledgers differ from Tally" on such a book before). Everything here is the cloud copy, so the control is
-- none, always, as the browser's on these books
create or replace function public.tally_calc_control(p_book uuid, p_from date, p_to date, p_today date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
begin
  return null;
end $function$;

-- ---------------------------------------------------------------- one part of MIS.runNow
create or replace function public.tally_calc_mis(p_book uuid, p_part text, p_from date, p_to date, p_today date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' as $function$
declare b tally_books%rowtype; d int; pf date; pt date; f date; t2 date; k int; st numeric[];
begin
  select * into b from tally_books x where x.book_id = p_book;
  if b.book_id is null or p_from is null or p_to is null or p_from > p_to then return null; end if;
  if p_part = 'sales' then return tally_calc_sales(p_book, p_from, p_to); end if;
  if p_part = 'purchases' then return tally_calc_purchases(p_book, p_from, p_to); end if;
  if p_part = 'pl' then return tally_calc_pl(p_book, p_from, p_to); end if;
  if p_part in ('prev', 'ly') then
    if p_part = 'ly' then f := tally_calc_shift(p_from, -1, 0); t2 := tally_calc_shift(p_to, -1, 0);
    else
      -- the period before: whole months when the period is whole months, else the same number of days
      d := (p_to - p_from) + 1; f := p_from - d; t2 := p_from - 1;
      if extract(day from p_from) = 1 and extract(day from p_to + 1) = 1 then
        k := coalesce(array_length(tally_calc_months(p_from, p_to), 1), 0);
        f := (date_trunc('month', p_from) - make_interval(months => k))::date; t2 := p_from - 1;
      end if;
    end if;
    return jsonb_build_object('range', jsonb_build_array(to_char(f, 'YYYYMMDD'), to_char(t2, 'YYYYMMDD')),
      'cmp', case when b.from_date is not null and b.from_date <= f then jsonb_build_object('sales', (tally_calc_sales_total(p_book, f, t2))[1], 'pl', tally_calc_pl(p_book, f, t2)) end);
  end if;
  if p_part = 'tops' then
    pf := date_trunc('month', p_to)::date;
    pt := make_date(case when extract(month from p_to) >= 4 then extract(year from p_to)::int else extract(year from p_to)::int - 1 end, 4, 1);
    -- MIS.covered: the books reach the month's or the year's first day; one pass from the earlier of the two
    st := tally_calc_sales_total(p_book, least(pf, pt), p_to, greatest(pf, pt));
    return jsonb_build_object('mtd', case when b.from_date is not null and b.from_date <= pf then st[case when pf >= pt then 2 else 1 end] end,
                              'ytd', case when b.from_date is not null and b.from_date <= pt then st[case when pt >= pf then 2 else 1 end] end);
  end if;
  if p_part = 'cash' then return tally_calc_cash(p_book, p_from, p_to); end if;
  if p_part = 'comp' then return tally_calc_comp(p_book, p_from, p_to); end if;
  if p_part = 'msme' then return tally_calc_msme(p_book, p_to); end if;
  if p_part = 'control' then return jsonb_build_object('control', tally_calc_control(p_book, p_from, p_to, p_today)); end if;
  raise exception 'no such part: %', p_part using errcode = '22023';
end $function$;

-- a member of the firm: the part for its own client (tally_pick: its own firm's book for the period's last day). p_today
-- (the day the books are brought in, for the control) is not part of the data version nor of mis-run's kept answer's
-- key: that is right only while the control is none on the cloud copy (tally_calc_control); a control that uses it again
-- must put it in the key
create or replace function public.tally_mis_part(p_client text, p_part text, p_from date, p_to date, p_today date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' as $function$
declare bk uuid := tally_pick(p_client, p_to);
begin
  -- the same limit as tally_now: a period from before to, of at most 120 months
  if p_from is null or p_to is null or p_from > p_to then raise exception 'give the period, from before to' using errcode = '22023'; end if;
  if (extract(year from p_to)::int - extract(year from p_from)::int) * 12 + extract(month from p_to)::int - extract(month from p_from)::int + 1 > 120 then
    raise exception 'at most 120 months' using errcode = '22023';
  end if;
  if bk is null then return jsonb_build_object('none', true); end if;
  return jsonb_build_object('book', bk, 'part', p_part, 'result', tally_calc_mis(bk, p_part, p_from, p_to, p_today));
end $function$;

-- the service role only: the functions on a book id or with no firm check of their own
revoke all on function public.tally_calc_shift(date, integer, integer) from public, anon, authenticated;
revoke all on function public.tally_calc_months(date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_num(jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_truthy(jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_lineof(text) from public, anon, authenticated;
revoke all on function public.tally_calc_plhead(text, text[], text, text, boolean) from public, anon, authenticated;
revoke all on function public.tally_calc_flowclean(text) from public, anon, authenticated;
revoke all on function public.tally_calc_flowhead(text, text[], text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.tally_calc_cls(uuid) from public, anon, authenticated;
revoke all on function public.tally_calc_vl(uuid, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_issale(text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.tally_calc_sales(uuid, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_sales_total(uuid, date, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_purchases(uuid, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_pl(uuid, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_cash(uuid, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_comp(uuid, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_msme(uuid, date) from public, anon, authenticated;
revoke all on function public.tally_calc_control(uuid, date, date, date) from public, anon, authenticated;
revoke all on function public.tally_calc_mis(uuid, text, date, date, date) from public, anon, authenticated;
grant execute on function public.tally_calc_shift(date, integer, integer) to service_role;
grant execute on function public.tally_calc_months(date, date) to service_role;
grant execute on function public.tally_calc_num(jsonb) to service_role;
grant execute on function public.tally_calc_truthy(jsonb) to service_role;
grant execute on function public.tally_calc_lineof(text) to service_role;
grant execute on function public.tally_calc_plhead(text, text[], text, text, boolean) to service_role;
grant execute on function public.tally_calc_flowclean(text) to service_role;
grant execute on function public.tally_calc_flowhead(text, text[], text, text, text, text, jsonb) to service_role;
grant execute on function public.tally_calc_cls(uuid) to service_role;
grant execute on function public.tally_calc_vl(uuid, date, date) to service_role;
grant execute on function public.tally_calc_issale(text, boolean, boolean) to service_role;
grant execute on function public.tally_calc_sales(uuid, date, date) to service_role;
grant execute on function public.tally_calc_sales_total(uuid, date, date, date) to service_role;
grant execute on function public.tally_calc_purchases(uuid, date, date) to service_role;
grant execute on function public.tally_calc_pl(uuid, date, date) to service_role;
grant execute on function public.tally_calc_cash(uuid, date, date) to service_role;
grant execute on function public.tally_calc_comp(uuid, date, date) to service_role;
grant execute on function public.tally_calc_msme(uuid, date) to service_role;
grant execute on function public.tally_calc_control(uuid, date, date, date) to service_role;
grant execute on function public.tally_calc_mis(uuid, text, date, date, date) to service_role;
-- a member of the firm: its own firm's books only (tally_pick)
revoke all on function public.tally_mis_part(text, text, date, date, date) from public, anon;
grant execute on function public.tally_mis_part(text, text, date, date, date) to authenticated, service_role;

commit;
