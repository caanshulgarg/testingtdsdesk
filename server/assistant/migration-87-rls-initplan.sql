-- Migration 87 (14-Oct-2026, branch next-fix-asst-turn; Sentry FINCOM-CLOUD-STAGING-2, after 86). Staging only until the
-- owner says otherwise.
--
-- Why: the Assistant's due list timed out on staging (57014, the signed-in role's 8 s statement_timeout) for GARG SHEKHAR
-- (4,120 entries, 10,326 lines, 1,110 ledgers, 5,361 kept items): 16.6 s as the user, under 2 s for the same work without
-- row-level security. Each read policy says "firm_id = my_firm()", and my_firm() is SECURITY DEFINER (it cannot be inlined),
-- so Postgres called it once for EVERY row it read: 3.6 s just to count the book's 10,326 lines as the user, 3 ms without.
--
-- What it changes:
-- 1. the SELECT policies of the tables the book tools read, each rewritten from its own text with
-- my_firm() and is_superadmin() wrapped as "(select my_firm())" / "(select is_superadmin())" - Postgres then works each
-- out ONCE per query (an InitPlan), the pattern Supabase documents for RLS. The rows each policy lets through are exactly
-- the same (the same functions, the same comparisons); names, roles and commands are unchanged; write policies are not
-- touched. A policy already wrapped, or missing, is left alone;
-- 2. asst_tds_missed (194C and the other limits; 13 s on staging), replaced with the same arguments, rules and result:
--    its two correlated subqueries over the period's entries (the supplier of each bill, and "was TDS deducted on this
--    bill") read every entry once per entry; they are now joins over the entries read once, and the largest month per
--    supplier is worked out in one grouping. Still SECURITY INVOKER and STABLE.
-- Safe to run twice. One transaction (lock_timeout 10 s: ALTER POLICY takes a short lock on each table). Tested:
-- tests/run_assistant_sql.py (a book of GARG SHEKHAR's size answers the due list and 194C as a member inside 8 s; the
-- fixture's figures to the paisa as before).
begin;
set local lock_timeout = '10s';
set local search_path = public, pg_temp;

do $$
declare t text; q text; nq text;
begin
  foreach t in array array['tally_books', 'tally_ledgers', 'tally_vouchers', 'tally_lines', 'tally_ledger_day', 'tally_salary_pays',
                           'client_book_items', 'client_due_tasks', 'gst_returns', 'clients'] loop
    select p.qual into q from pg_policies p where p.schemaname = 'public' and p.tablename = t and p.policyname = t || '_read' and p.cmd = 'SELECT';
    if q is null or q ~* 'select\s+(public\.)?my_firm\(\)' then continue; end if;
    nq := regexp_replace(q, '(public\.)?my_firm\(\)', '(select public.my_firm())', 'g');
    nq := regexp_replace(nq, '(public\.)?is_superadmin\(\)', '(select public.is_superadmin())', 'g');
    execute format('alter policy %I on public.%I using (%s)', t || '_read', t, nq);
  end loop;
end $$;

create or replace function public.asst_tds_missed(p_client text, p_from date, p_to date, p_section text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare s record; res jsonb;
begin
  select * into s from asst_span(p_client, p_from, p_to);
  if s.bk is null then return asst_none('tds_missed'); end if;
  with led as materialized (select * from asst_led(p_client, s.bk)), e as materialized (select * from asst_entries(s.bk, s.d_from, s.d_to)),
  tdsl as (select name from led where kind in ('tds_payable', 'tds_clearing') or (kind = '' and name ~* '\mTDS\M' and duties)),
  -- the bills with a TDS line, read once
  tg as materialized (select distinct t.guid from e t join tdsl on tdsl.name = t.ledger),
  done as (select distinct c.ledger from e c join tg on tg.guid = c.guid join led cl on cl.name = c.ledger and cl.creditor
           union select distinct v.party from tally_vouchers v join tg on tg.guid = v.guid where v.book_id = s.bk),
  -- each bill's supplier: its creditor line with the largest credit
  pty as (select distinct on (c.guid) c.guid, c.ledger from e c join led cl on cl.name = c.ledger and cl.creditor where c.amount > 0 order by c.guid, c.amount desc),
  docs as (select e.guid, min(e.day) as day, min(e.vno) vno, min(e.vtype) vtype from e where e.vtype !~* 'sales' group by e.guid),
  x as materialized (select p.ledger party, r.rule, r.section, r.rate_ind, r.rate_oth, r.single, r.lim, r.basis, e.ledger, d.day, d.guid, d.vno, -e.amount a
          from e join docs d on d.guid = e.guid join pty p on p.guid = d.guid join led on led.name = e.ledger and led.expense cross join lateral asst_tds_rule(e.ledger) r
         where e.amount < 0 and p.ledger not in (select ledger from done where ledger is not null) and p.ledger !~* '\mBANK\M|GOVERNMENT|MUNICIPAL|\mLIC\M'
           and (coalesce(p_section, '') = '' or upper(replace(r.section, '-', '')) = upper(replace(p_section, '-', '')))),
  mm as (select z.party, z.rule, max(z.t) maxm from (select y.party, y.rule, sum(y.a) t from x y group by y.party, y.rule, to_char(y.day, 'YYYYMM')) z group by z.party, z.rule),
  agg as (select x.party, x.rule, min(x.section) as section, min(x.rate_ind) ri, min(x.rate_oth) ro, min(x.single) single, min(x.lim) lim, min(x.basis) basis, string_agg(distinct x.ledger, ', ') ledgers,
            sum(x.a) amt, max(x.a) mx, min(mm.maxm) maxm,
            (array_agg(x.guid order by x.day))[1] guid, min(x.day) as day, (array_agg(x.vno order by x.day))[1] vno, count(distinct x.guid) n
            from x join mm on mm.party = x.party and mm.rule is not distinct from x.rule group by x.party, x.rule),
  hit as (select a.*, l.pan from agg a left join led l on l.name = a.party
           where case a.basis when 'single_or_annual' then a.mx > a.single or a.amt > a.lim when 'monthly' then a.maxm > a.lim else a.amt > a.lim end)
  select jsonb_build_object('tool', 'tds_missed', 'title', 'Suppliers past the TDS limit with no TDS deducted', 'period', jsonb_build_object('from', s.d_from, 'to', s.d_to),
    'basis', 'the TDS provision from the expense ledger''s name, as the audit reads it; limits: 194C one bill over 30,000 or 1,00,000 in the year; 194J 50,000; 194H 20,000; 194-I 50,000 a month; 194A 10,000',
    'columns', jsonb_build_array(asst_col('party', 'Supplier'), asst_col('section', 'Section'), asst_col('ledgers', 'Booked to'), asst_col('amount', 'Expense', 'amount'), asst_col('largest', 'Largest bill', 'amount'), asst_col('rate', 'Rate %', 'pct'), asst_col('tds', 'TDS due', 'amount'), asst_col('pan', 'PAN')),
    'rows', coalesce(jsonb_agg(jsonb_build_object('guid', h.guid, 'day', h.day, 'vno', h.vno, 'party', h.party, 'section', h.section, 'ledgers', h.ledgers, 'amount', round(h.amt, 2), 'largest', round(h.mx, 2),
        'rate', case when h.pan = '' then 20 when substr(h.pan, 4, 1) in ('P', 'H') then h.ri else h.ro end,
        'tds', round(h.amt * (case when h.pan = '' then 20 when substr(h.pan, 4, 1) in ('P', 'H') then h.ri else h.ro end) / 100, 2), 'pan', h.pan) order by h.amt desc, h.party), '[]'::jsonb),
    'summary', jsonb_build_object('parties', count(*), 'amount', round(coalesce(sum(h.amt), 0), 2), 'disallowance30pct', round(coalesce(sum(h.amt), 0) * 0.3, 2)))
    into res from hit h;
  return res;
end $$;

commit;
