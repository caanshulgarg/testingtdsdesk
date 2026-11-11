-- migration-163-mis-cash-speed (11-Nov-2026, branch next-mis-cash). Written, NOT run yet: the owner reads it and runs it.
-- Needs 152. (159 is gst-run's; 160 to 162 are other branches'.)
-- Why: tests/run_migration152.py's check 3 (every part of the MIS under 1 s on the 41,181-entry / 10,640-ledger book,
-- median of five) failed on the cash part alone: 1,184 ms for the books' whole span. Profiled there (EXPLAIN ANALYZE on
-- the same book): tally_calc_cash read EVERY line of the period through tally_calc_vl (113,455 lines), sorted them by
-- ledger to join each to every ledger of tally_calc_cls, and grouped them all by entry, though only an entry with a cash
-- or bank line moves cash (20,050 entries, 42,628 lines); then it called MIS.flowHead (plpgsql) once for each of the
-- 8,006 ledgers that took a share; and the partners' list ran a regex on every group of every ledger.
-- How (add-only; no table, no index, no row; one function made again with 152's arguments, result and grants):
--   tally_calc_cash, the same JSON byte for byte (tests/run_migration163.py: 152's function kept under another name and
--   both asked in one statement, on three books and thirteen periods each, through tally_calc_mis and tally_mis_part too):
--   - the entries with a cash or bank line first (tally_lines_ledger: book, ledger), then only their lines, read as
--     tally_calc_vl reads them (the entry's own day in the period; never a deleted, cancelled or optional entry; a line
--     with no ledger left out; the amount to the paisa). An entry with no cash or bank line gave nothing before either:
--     received and paid are the cash and bank lines, and the spread asks for at least one of them in the entry
--   - the ledgers from tally_calc_led with FinCom's list (what, side) as tally_calc_cls joins it: only what this part reads
--   - MIS.flowHead once for each kind of ledger (group path, kind, what, side, Loan-given mark), not once a ledger: the
--     name counts in it only by its staff rule, so a name is passed as 'SALARY' or '' by that same regex
--   - the partners: the regex on the whole path first; each group's own test only then (the same groups pass)
--   - enable_nestloop off for this function (as tally_calc_vl has it): the materialized steps' guesses are small, and a
--     nested loop over them took 12 s in the stand when one guess was a row
--   On the 40k book in the stand: 956 -> 565 ms for the whole span (a median of five, each run its own session).
-- Grants: as 152 set them (service_role only; not public, anon or authenticated). Safe to run twice.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- cash and bank (MIS.cashflow, MIS.cashActual)
create or replace function public.tally_calc_cash(p_book uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' set jit to 'off' set work_mem to '32MB' set enable_nestloop to 'off' as $function$
declare b tally_books%rowtype; res jsonb; months text[] := tally_calc_months(p_from, p_to); okb boolean; choices jsonb;
begin
  select * into b from tally_books x where x.book_id = p_book;
  if b.book_id is null or p_from is null or p_to is null or p_from > p_to then return null; end if;
  -- the owner's Loan-given marks (MIS.flowMark: the client's confirmed "flow:<ledger>" choices)
  select cl0.data -> 'choices' into choices from clients cl0 where cl0.firm_id = b.firm_id and cl0.id::text = b.client_id;
  -- Audit.balances from the books' first day: no opening or closing for a period that begins before it
  okb := b.from_date is not null and p_from >= b.from_date;
  -- the ledgers as tally_calc_cls gives them (its what and side: FinCom's ledger list), only what this part reads
  with mp as (select substr(i.item, 2) as name, i.data from client_book_items i
          where i.firm_id = b.firm_id and i.client_id = b.client_id and i.key = 'map' and i.item like '.%' and not i.deleted),
  c as materialized (select x.name, x.open, x.path, x.kind, coalesce(m.data ->> 'what', '') as what, coalesce(m.data ->> 'side', '') as side, x.in_master, x.cash or x.bank as cb
          from tally_calc_led(p_book) x left join mp m on m.name = x.name),
  -- MIS.flowPartners: the people the Capital Account ledgers name
  pt as (select coalesce(jsonb_object_agg(z.cn, z.name order by z.name), '{}'::jsonb) as j from (
           select c.name, tally_calc_flowclean(c.name) as cn from c
            where c.in_master and c.path <> '{}'::text[] and coalesce(c.path[1], '') !~* 'reserves' and array_to_string(c.path, chr(1)) ~* 'capital account'
              and exists (select 1 from unnest(c.path) g where regexp_replace(g, '^\s+|\s+$', '', 'g') ~* '^capital account$')) z where z.cn <> ''),
  -- Audit.balances(from, to).at(d) summed over cash and bank: the openings plus every entry from the books' first day to d
  -- (tally_calc_bal's rule, from the ledgers already read)
  dm as (select coalesce(sum(d.amount) filter (where d.day <= p_from - 1), 0) as a0, coalesce(sum(d.amount), 0) as a1
           from tally_ledger_day d join c on c.name = d.ledger and c.cb
          where okb and d.book_id = p_book and d.merged_into is null and d.day >= b.from_date and d.day <= p_to),
  oc as (select case when okb then round(-((select coalesce(sum(c.open), 0) from c where c.cb) + dm.a0), 2) end as op,
                case when okb then round(-((select coalesce(sum(c.open), 0) from c where c.cb) + dm.a1), 2) end as cl from dm),
  -- only an entry with a cash or bank line moves cash: those entries first (any day: the period is the entry's own day,
  -- as tally_calc_vl), then only their lines, as tally_calc_vl reads them
  cbl as (select array(select c.name from c where c.cb) as n),
  cand as materialized (select distinct t.guid from tally_lines t where t.book_id = p_book and t.ledger = any((select cbl.n from cbl)::text[])),
  vl as materialized (select v.guid, v.day, coalesce(v.vtype, '') as vtype, t.id, t.ledger, round(coalesce(t.amount, 0), 2) as a, t.ledger = any((select cbl.n from cbl)::text[]) as cb
        from cand join tally_vouchers v on v.book_id = p_book and v.guid = cand.guid join tally_lines t on t.book_id = p_book and t.guid = v.guid
       where v.day between p_from and p_to and v.deleted_at is null and v.cancelled is not true and v.optional is not true and coalesce(t.ledger, '') <> ''),
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
  fk as materialized (select s.ledger, coalesce(c.path, '{}'::text[]) as path, c.kind, c.what, c.side,
                case when choices -> ('flow:' || s.ledger) ->> 'state' = 'confirmed' then nullif(choices -> ('flow:' || s.ledger) ->> 'value', '') end as mark,
                case when s.ledger ~* 'SALAR|WAGES|BONUS|STAFF|IMPREST|EMPLOYEE|PROVIDENT|\yE?PFO?\y|\yESIC?\y|GRATUITY|PAYROLL' then 'SALARY' else '' end as nm
           from (select distinct sh.ledger from sh) s left join c on c.name = s.ledger),
  fu as materialized (select k.path, k.kind, k.what, k.side, k.mark, k.nm, tally_calc_flowhead(k.nm, k.path, k.kind, k.what, k.side, k.mark, (select pt.j from pt)) as h
           from (select distinct fk.path, fk.kind, fk.what, fk.side, fk.mark, fk.nm from fk) k),
  fh as materialized (select fk.ledger, fu.h, fk.path from fk join fu on fu.path = fk.path and fu.kind is not distinct from fk.kind and fu.what is not distinct from fk.what
                and fu.side is not distinct from fk.side and fu.mark is not distinct from fk.mark and fu.nm = fk.nm),
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

revoke all on function public.tally_calc_cash(uuid, date, date) from public, anon, authenticated;
grant execute on function public.tally_calc_cash(uuid, date, date) to service_role;

commit;
