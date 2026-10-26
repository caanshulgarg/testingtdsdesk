-- Migration 107 (26-Oct-2026, branch next-fast-reports; after 106). Staging only until the owner says otherwise.
--
-- Why (pg_stat_statements on staging, 26-Oct-2026):
-- 1. The Assistant's book tools were slow: asst_find_ledgers 654 ms on average (131 calls, 4.2 s at worst), asst_due_list
--    1.6 s, asst_tds_late 2.0 s, asst_tds_missed up to 5.9 s. All of them (24 tools) read the ledger list through
--    asst_led, and asst_led worked out each ledger's P&L head by calling asst_pl_head TWICE per ledger, which itself
--    called tally_mis_head twice. Each of these has its own search_path (so Postgres cannot fold it into the query) and
--    costs about 0.1 ms a call: 4,006 ledgers (the largest book on staging) = 1.2 s before any figure is added up.
-- 2. client_book_items has no index that starts with client_id (its keys start with firm_id), yet the app's pull
--    (client_id = .. and seq > .. order by seq), asst_data_version (max(seq) of a client), asst_led (a client's
--    "map" / "ledInfo" / "groupInfo") and ad hoc checks all ask by client_id: each read the whole index, then sorted.
--    The two 21-27 s statements in the evidence ("with b as (select book_id, client_id from tally_books ...), tdsl as
--    (... client_book_items ...)") were ad hoc checks run from the Supabase SQL console (tagged "source: POST /mcp", as
--    postgres), not a FinCom screen: they looked up the client's TDS ledgers in client_book_items once per entry line.
-- 3. The records, clients and tally_bills policies still call my_firm(), can_write() and is_superadmin() once for EVERY
--    row (migration 87 fixed the read policies of the book tables only): the app's sync of records (upsert of up to 20
--    rows, 68 ms on average; the pull, 13,000 calls) and the bills the reports read.
--
-- What it changes:
-- 1. two indexes on client_book_items: (client_id, key, item) and (client_id, seq). The table is small (11,400 rows,
--    4.6 MB): each builds in well under a second inside this transaction (writes to client_book_items wait for it; reads
--    do not). CONCURRENTLY is not used: it cannot run inside a transaction and is not needed at this size;
-- 2. the policies of records, clients and tally_bills that call my_firm() / can_write() / is_superadmin() bare: each
--    rewritten from its own text with them wrapped as "(select public.my_firm())" etc. - worked out once per statement
--    (an InitPlan), the pattern migration 87 used. The same functions, the same comparisons: the same rows pass. Names,
--    commands and roles unchanged; a policy already wrapped is left alone;
-- 3. asst_pl_head: tally_mis_head worked out once instead of twice (same text otherwise);
--    asst_led: asst_pl_head called once per ledger instead of twice, and not at all for a ledger that cannot be in the
--    P&L - none of its Tally groups is one of the six P&L groups tally_mis_head knows (sales accounts, direct incomes,
--    indirect incomes, purchase accounts, direct expenses, indirect expenses) and its top group is not a revenue group
--    in groupInfo ("rev": true). asst_pl_head answers '' for exactly those ledgers, so the result is the same; the
--    test checks tally_mis_head against that list. Same arguments, columns, STABLE, SECURITY INVOKER, search_path and
--    grants.
-- Expected (pg_stand, a book of 4,002 ledgers as the largest on staging, as a member): asst_led 1.1-1.3 s -> 0.2 s;
-- asst_find_ledgers 1.1 s -> 0.23 s, asst_profit_loss 1.1 s -> 0.23 s, asst_tds_missed 1.0 s -> 0.3 s, asst_due_list and
-- asst_tds_late 2.3 s -> 0.7 s. client_book_items by client: the app's next changes and max(seq) a seek (EXPLAIN cost
-- of max(seq) 399 -> 1); a ledger looked up by name per entry line (the console check) 9.4 s -> 0.04 s as postgres.
-- The records upsert stays about 65 ms: its time is the size of the rows sent (bank chunks up to 350 KB of JSON).
-- Safe to run twice. One transaction, lock_timeout 10 s. Tested: tests/run_migration107.py (pg_stand).
begin;
set local lock_timeout = '10s';
set local search_path = public, pg_temp;

-- 1. client_book_items asked by client
create index if not exists client_book_items_client_key on public.client_book_items (client_id, key, item);
create index if not exists client_book_items_client_seq on public.client_book_items (client_id, seq);

-- 2. the per-row calls in the policies of records, clients and tally_bills
do $$
declare p record; q text; w text; fn constant text := '(public\.)?(my_firm|can_write|is_superadmin)\(\)';
begin
  for p in select pol.tablename, pol.policyname, pol.cmd, pol.qual, pol.with_check from pg_policies pol
            where pol.schemaname = 'public' and pol.tablename in ('records', 'clients', 'tally_bills') loop
    q := p.qual; w := p.with_check;
    -- already wrapped (this file run before, or written so): left alone
    if q is not null and (q !~ fn or q ~* ('select\s+' || fn)) then q := null; end if;
    if w is not null and (w !~ fn or w ~* ('select\s+' || fn)) then w := null; end if;
    q := regexp_replace(q, fn, '(select public.\2())', 'g');
    w := regexp_replace(w, fn, '(select public.\2())', 'g');
    if q is not null and w is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', p.policyname, p.tablename, q, w);
    elsif q is not null then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q);
    elsif w is not null then
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, w);
    end if;
  end loop;
end $$;

-- 3. a ledger's head in the profit and loss (as migration 77), tally_mis_head worked out once
create or replace function public.asst_pl_head(p_name text, p_chain text[], p_top jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when h.m <> '' then h.m
    when coalesce((p_top->>'rev')::boolean, false) then
      case when coalesce((p_top->>'dr')::boolean, false) then
             case when array_to_string(p_chain, ' ') ~* '(EMPLOYEE|SALAR|STAFF|WAGES|PERSONNEL|PAYROLL)' then 'emp'
                  when coalesce((p_top->>'gp')::boolean, false) then 'dir' else 'exp' end
           else case when coalesce((p_top->>'gp')::boolean, false) then 'rev' else 'oth' end end
    else '' end
  from (select tally_mis_head(p_name, p_chain) as m offset 0) h
$$;

-- every ledger of a book with what it is (as migration 77); the P&L head once per ledger, only where it can be one
create or replace function public.asst_led(p_client text, p_book uuid)
returns table (name text, parent text, open numeric, chain text[], cash boolean, bank boolean, debtor boolean, creditor boolean,
  expense boolean, income boolean, sales boolean, purchase boolean, loan boolean, capital boolean, duties boolean, fixed boolean,
  kind text, side text, tax text, what text, section text, msme text, pan text, gstin text, emp boolean, mis text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with m as (select distinct on (tally_nm(substr(i.item, 2))) tally_nm(substr(i.item, 2)) as n, i.data from client_book_items i
              where i.client_id = p_client and i.key = 'map' and i.item like '.%' and not i.deleted order by tally_nm(substr(i.item, 2)), i.updated_at desc),
  inf as (select distinct on (tally_nm(substr(i.item, 2))) tally_nm(substr(i.item, 2)) as n, i.data from client_book_items i
              where i.client_id = p_client and i.key = 'ledInfo' and i.item like '.%' and not i.deleted order by tally_nm(substr(i.item, 2)), i.updated_at desc),
  gi as (select distinct on (tally_nm(substr(i.item, 2))) tally_nm(substr(i.item, 2)) as n, i.data from client_book_items i
              where i.client_id = p_client and i.key = 'groupInfo' and i.item like '.%' and not i.deleted order by tally_nm(substr(i.item, 2)), i.updated_at desc)
  select l.name, l.parent, coalesce(l.open, 0), coalesce(l.chain, '{}'),
    g.lc && array['cash-in-hand'], g.lc && array['bank accounts', 'bank od a/c', 'bank occ a/c'], g.lc && array['sundry debtors'], g.lc && array['sundry creditors'],
    g.lc && array['direct expenses', 'indirect expenses'], g.lc && array['sales accounts', 'direct incomes', 'indirect incomes'], g.lc && array['sales accounts'], g.lc && array['purchase accounts'],
    g.lc && array['loans (liability)', 'secured loans', 'unsecured loans'], g.lc && array['capital account'], g.lc && array['duties & taxes'], g.lc && array['fixed assets'],
    coalesce(m.data->>'kind', ''), coalesce(m.data->>'side', ''), upper(coalesce(m.data->>'tax', '')),
    coalesce(nullif(m.data->>'what', ''), case when m.data->>'kind' = 'gst' and coalesce(m.data->>'rcm', '') = 'true' then 'gst_rcm' else coalesce(m.data->>'kind', '') end),
    upper(replace(coalesce(m.data->>'section', ''), '-', '')), coalesce(inf.data->>'msme', ''),
    upper(coalesce(nullif(l.pan, ''), inf.data->>'pan', '')), upper(coalesce(nullif(l.gstin, ''), inf.data->>'gstin', '')),
    ph.h = 'emp', ph.h
  from tally_ledgers l
  cross join lateral (select coalesce((select array_agg(lower(x)) from unnest(coalesce(l.chain, '{}')) x), '{}') || array[lower(coalesce(l.parent, ''))] as lc) g
  left join m on m.n = l.name
  left join inf on inf.n = l.name
  left join gi top on top.n = coalesce(l.chain[array_length(l.chain, 1)], l.parent)
  -- asst_pl_head is '' unless one of the chain's groups is a P&L group of tally_mis_head or the top group is a revenue one
  cross join lateral (select case
      when exists (select 1 from unnest(coalesce(l.chain, '{}')) x where lower(x) in ('sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses'))
        then asst_pl_head(l.name, coalesce(l.chain, '{}'), top.data)
      when coalesce((top.data->>'rev')::boolean, false) then asst_pl_head(l.name, coalesce(l.chain, '{}'), top.data)
      else '' end as h offset 0) ph
  where l.book_id = p_book and l.merged_into is null and l.deleted_at is null
$$;

-- who may run them: as before (migration 77) - signed-in members and the service role, never anon
revoke all on function public.asst_pl_head(text, text[], jsonb), public.asst_led(text, uuid) from public, anon;
grant execute on function public.asst_pl_head(text, text[], jsonb), public.asst_led(text, uuid) to authenticated, service_role;

commit;
