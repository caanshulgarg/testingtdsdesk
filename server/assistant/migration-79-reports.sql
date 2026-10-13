-- FinCom Assistant, Step 3 (reports): read-only functions for server/assistant/tools/reports.ts (fs_build, cash_mis,
-- dcf_model, tax_audit_draft). Add-only; no table: the mapping, the details for you and the app's 3CD draft are kept with
-- the client's books (client_book_items, key 'fs', item '.rx'), written by the app as every other book setting is.
-- SECURITY INVOKER and STABLE: they run as the signed-in user under RLS and write nothing.

-- the client's book that covers a date
create or replace function public.rpt_book(p_client text, p_to date)
returns uuid language sql stable security invoker set search_path = public, pg_temp as $$
  select b.book_id from tally_books b where b.client_id = p_client and b.from_date is not null and b.from_date <= p_to
   order by b.from_date desc limit 1
$$;

-- the trial balance of a period (Dr positive): each ledger's parent and group chain, its opening on p_from, debits and
-- credits in the period, and the same for the year before when the book covers it
create or replace function public.rpt_tb(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare bk uuid := rpt_book(p_client, p_to); bfrom date; pfrom date := (p_from - interval '1 year')::date; pto date := p_from - 1; havepy boolean; res jsonb;
begin
  if bk is null then return jsonb_build_object('ok', false, 'why', 'no books held for this client for the period'); end if;
  select from_date into bfrom from tally_books where book_id = bk;
  havepy := bfrom <= pfrom;
  with led as (select l.name, l.parent, coalesce(l.chain, '{}') as chain, coalesce(l.open, 0) as open from tally_ledgers l
                where l.book_id = bk and l.merged_into is null and l.deleted_at is null),
  d as (select ledger,
          sum(case when day < p_from then amount else 0 end) as before,
          sum(case when day between p_from and p_to then dr else 0 end) as dr, sum(case when day between p_from and p_to then cr else 0 end) as cr,
          sum(case when day < pfrom then amount else 0 end) as pbefore,
          sum(case when day between pfrom and pto then dr else 0 end) as pdr, sum(case when day between pfrom and pto then cr else 0 end) as pcr
        from tally_ledger_day where book_id = bk and day <= p_to group by ledger)
  select jsonb_build_object('ok', true, 'book', bk, 'from', p_from, 'to', p_to, 'py', havepy,
    'rows', coalesce(jsonb_agg(jsonb_build_object('l', led.name, 'parent', led.parent, 'chain', to_jsonb(led.chain),
       'o', -(led.open + coalesce(d.before, 0)), 'd', coalesce(d.dr, 0), 'c', coalesce(d.cr, 0),
       'po', case when havepy then -(led.open + coalesce(d.pbefore, 0)) end, 'pd', case when havepy then coalesce(d.pdr, 0) end,
       'pc', case when havepy then coalesce(d.pcr, 0) end) order by led.name), '[]'::jsonb))
    into res from led left join d on d.ledger = led.name;
  return res;
end $$;

-- what the app keeps for the reports (b.fs.rx: the mapping versions, the details for you per year, the 3CD draft), and the
-- suppliers marked micro or small
create or replace function public.rpt_saved(p_client text)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'rx', coalesce((select i.data from client_book_items i where i.client_id = p_client and i.key = 'fs' and i.item = '.rx' and not i.deleted order by i.updated_at desc limit 1), '{}'::jsonb),
    'msme', coalesce((select jsonb_object_agg(substr(i.item, 2), i.data) from client_book_items i where i.client_id = p_client and i.key = 'msme' and i.item like '.%' and not i.deleted), '{}'::jsonb)
         || coalesce((select jsonb_object_agg(substr(i.item, 2), i.data->'msme') from client_book_items i where i.client_id = p_client and i.key = 'ledInfo' and i.item like '.%' and not i.deleted and coalesce(i.data->>'msme', '') <> ''), '{}'::jsonb))
$$;

-- the entries of a period that touch cash or bank, each with all its lines (Dr positive)
create or replace function public.rpt_cash_entries(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare bk uuid := rpt_book(p_client, p_to); res jsonb;
begin
  if bk is null then return '[]'::jsonb; end if;
  with cashled as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null and l.deleted_at is null
                    and exists (select 1 from unnest(coalesce(l.chain, '{}') || array[l.parent]) g where lower(g) in ('cash-in-hand', 'bank accounts', 'bank od a/c', 'bank occ a/c'))),
  v as (select distinct v.guid, v.day, v.vtype, v.vno from tally_vouchers v join tally_lines l on l.book_id = v.book_id and l.guid = v.guid join cashled c on c.name = l.ledger
         where v.book_id = bk and v.day between p_from and p_to and not v.cancelled and not v.optional and v.deleted_at is null)
  select coalesce(jsonb_agg(jsonb_build_object('date', v.day, 'no', v.vno, 'type', v.vtype,
           'ent', (select jsonb_agg(jsonb_build_object('l', l.ledger, 'a', -l.amount)) from tally_lines l where l.book_id = bk and l.guid = v.guid)) order by v.day, v.vno), '[]'::jsonb)
    into res from v;
  return res;
end $$;

revoke all on function public.rpt_book(text, date), public.rpt_tb(text, date, date), public.rpt_saved(text), public.rpt_cash_entries(text, date, date) from public, anon;
grant execute on function public.rpt_book(text, date), public.rpt_tb(text, date, date), public.rpt_saved(text), public.rpt_cash_entries(text, date, date) to authenticated;
