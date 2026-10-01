-- GST against the filed returns, request of 02-Oct-2026 (items 2 and 12). Adds only; nothing is dropped or deleted.
--
--   tally_vouchers_gone            an entry that was in the cloud copy and is no longer in Tally's day book when its day is
--                                  read again: kept with its lines, the day FinCom saw it gone, and back_at if it comes back
--                                  (an entry moved to another date comes back when that date is read). Never deleted.
--   tally_ingest_day               as migration-11, and before a day is replaced, every entry of that day that Tally no longer
--                                  sends is kept in tally_vouchers_gone; an entry Tally sends again is marked back
--   tally_vouchers_gone_list(client)   the client's entries deleted in Tally (not back), newest first, with their lines
--   tally_gst_summary              as migration-14, and input tax is also counted on an entry with no expense or purchase line
--                                  (a bank payment with only an IGST line) when the entry has no output GST line, so a
--                                  set-off journal or a tax payment still does not count

begin;

create table if not exists public.tally_vouchers_gone (
  book_id    uuid not null,
  firm_id    uuid not null references public.firms(id),
  guid       text not null,
  day        date not null,
  alter_id   bigint,
  vtype      text,
  vno        text,
  party      text,
  gstin      text,
  ref        text,
  ref_date   date,
  optional   boolean,
  lines      jsonb,
  gone_at    timestamptz not null default now(),
  back_at    timestamptz,
  primary key (book_id, guid, gone_at)
);
create index if not exists tally_vouchers_gone_open on public.tally_vouchers_gone (book_id, guid) where back_at is null;

alter table public.tally_vouchers_gone enable row level security;
drop policy if exists tally_vouchers_gone_read on public.tally_vouchers_gone;
create policy tally_vouchers_gone_read on public.tally_vouchers_gone for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
revoke all on public.tally_vouchers_gone from anon, authenticated;
grant select on public.tally_vouchers_gone to authenticated;

create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare touched date[]; f uuid; gone integer := 0; back integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  -- entries of this day that Tally no longer sends: deleted in Tally (or moved to a day not read yet); kept with their lines
  insert into tally_vouchers_gone (book_id, firm_id, guid, day, alter_id, vtype, vno, party, gstin, ref, ref_date, optional, lines)
  select v.book_id, v.firm_id, v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.gstin, v.ref, v.ref_date, v.optional,
         (select coalesce(jsonb_agg(jsonb_build_array(l.ledger, l.amount)), '[]'::jsonb) from tally_lines l where l.book_id = v.book_id and l.guid = v.guid)
    from tally_vouchers v
   where v.book_id = p_book and v.day = p_day and not v.cancelled
     and v.guid not in (select x->>'guid' from jsonb_array_elements(p_vouchers) x)
     and not exists (select 1 from tally_vouchers_gone g where g.book_id = v.book_id and g.guid = v.guid and g.back_at is null);
  get diagnostics gone = row_count;
  -- an entry Tally sends again (moved back, or its date read later) is no longer deleted
  update tally_vouchers_gone g set back_at = now()
   where g.book_id = p_book and g.back_at is null and g.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x);
  get diagnostics back = row_count;
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x)
  ) q;
  delete from tally_bills b where b.book_id = p_book and (b.day = p_day or b.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  delete from tally_lines l where l.book_id = p_book and (l.day = p_day or l.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  delete from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         coalesce(x->>'party', ''), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60),
         left(coalesce(x->>'ref', ''), 60), tally_d8(x->>'refDate'), left(upper(coalesce(x->>'cmp', '')), 15)
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc;
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, p_day, x->>1, (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric from jsonb_array_elements(p_lines) x;
  insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
  select p_book, f, x->>0, p_day, x->>1, left(coalesce(b->>0, ''), 200), left(coalesce(b->>1, ''), 20), (b->>2)::numeric,
         case when b->>1 in ('New Ref', 'Advance') then p_day end,
         nullif(b->>3, '')::integer,
         case when b->>1 = 'New Ref' and nullif(b->>3, '') is not null then p_day + (b->>3)::integer end
    from jsonb_array_elements(p_lines) x, jsonb_array_elements(case when jsonb_typeof(x->5) = 'array' then x->5 else '[]'::jsonb end) b
   where coalesce(b->>2, '') <> '';
  delete from tally_ledger_day t where t.book_id = p_book and t.day = any(touched);
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = p_book and l.day = any(touched) and not v.cancelled and not v.optional
   group by l.ledger, l.day;
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at) values (p_book, f, p_day, p_n, p_alter, p_bytes, now())
  on conflict (book_id, day) do update set n = excluded.n, alter_max = excluded.alter_max, bytes = excluded.bytes, at = now();
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'gone', gone, 'back', back);
end $function$;

create or replace function public.tally_vouchers_gone_list(p_client text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('guid', g.guid, 'date', to_char(g.day, 'YYYYMMDD'), 'type', g.vtype, 'number', g.vno, 'party', g.party,
           'gstin', g.gstin, 'reference', g.ref, 'referenceDate', coalesce(to_char(g.ref_date, 'YYYYMMDD'), ''), 'optional', g.optional,
           'lines', g.lines, 'goneAt', g.gone_at) order by g.gone_at desc, g.day desc), '[]'::jsonb)
    from tally_vouchers_gone g join tally_books b on b.book_id = g.book_id
   where b.client_id = p_client and b.firm_id = my_firm() and g.back_at is null;
$function$;

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
  -- entries with a sales or income line, input tax on entries with an expense, purchase or fixed-asset line, or (request of
  -- 02-Oct-2026) on any entry with no output GST line, such as a bank payment with only an IGST line
  nom as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses', 'fixed assets'))),
  inc as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes'))),
  outk as (select ledger from k where side = 'output' and what = 'gst'),
  docs as (select v.guid,
             exists (select 1 from tally_lines x join inc on inc.name = x.ledger where x.book_id = bk and x.guid = v.guid) as outward,
             exists (select 1 from tally_lines x join nom on nom.name = x.ledger where x.book_id = bk and x.guid = v.guid) as doc,
             exists (select 1 from tally_lines x join outk on outk.ledger = x.ledger where x.book_id = bk and x.guid = v.guid) as has_out
             from tally_vouchers v where v.book_id = bk and v.day between greatest(p_from, b.from_date) and p_to and not v.cancelled and not v.optional),
  tx as (select to_char(t.day, 'YYYYMM') as ym, k.side, k.what, upper(k.tax) as tax, sum(t.amount) as net
           from tally_lines t join k on k.ledger = t.ledger join docs on docs.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to
            and ((k.side = 'output' and docs.outward) or (k.side <> 'output' and (docs.doc or not docs.has_out))) group by 1, 2, 3, 4),
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

revoke all on function public.tally_vouchers_gone_list(text) from public, anon;
grant execute on function public.tally_vouchers_gone_list(text) to authenticated;

commit;
