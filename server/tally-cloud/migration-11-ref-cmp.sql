-- Cloud copy of the books, review of 01-Oct-2026: each entry's reference number and date (on a purchase, the supplier's
-- invoice number and date, which 2B reconciliation pairs on) and the company GSTIN it was entered under (CMPGSTIN; a
-- client with more than one GSTIN files a GSTR-1 for each). Adds only: three columns (empty for entries read before;
-- "Read the kept day books again" fills them), a date helper, and the two functions changed to fill and return them.
-- Nothing is dropped or deleted.
--
--   tally_vouchers + ref        Tally's REFERENCE (the supplier's invoice number on a purchase), up to 60 characters
--                  + ref_date   Tally's REFERENCEDATE, or null
--                  + cmp_gstin  Tally's CMPGSTIN, the company's own GSTIN for the entry
--   tally_d8(text)              yyyymmdd to a date; null when it is not a real date
--   tally_ingest_day            as migration-7, and stores ref, refDate and cmp from each entry
--   tally_vouchers_in           as before, and returns reference, referenceDate, cmpGstin and gstin with each entry

begin;

alter table public.tally_vouchers add column if not exists ref text not null default '';
alter table public.tally_vouchers add column if not exists ref_date date;
alter table public.tally_vouchers add column if not exists cmp_gstin text not null default '';

create or replace function public.tally_d8(p text)
returns date language plpgsql immutable set search_path to 'public' as $function$
begin
  if coalesce(p, '') !~ '^(19|20)\d{6}$' then return null; end if;
  return make_date(substr(p, 1, 4)::int, substr(p, 5, 2)::int, substr(p, 7, 2)::int);
exception when others then return null;
end $function$;

create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare touched date[]; f uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
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
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched));
end $function$;

create or replace function public.tally_vouchers_in(p_client text, p_from date, p_to date, p_ledger text default null, p_types text[] default null)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with bk as (select tally_pick(p_client, p_to) b),
  v as (select v.* from tally_vouchers v, bk where v.book_id = bk.b and v.day between p_from and p_to
          and (p_types is null or v.vtype = any(p_types))
          and (p_ledger is null or exists (select 1 from tally_lines l where l.book_id = v.book_id and l.guid = v.guid and l.ledger = p_ledger))
        order by v.day, v.vno limit 20000)
  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(v.day, 'YYYYMMDD'), 'type', v.vtype, 'number', v.vno, 'party', v.party, 'narration', v.narration, 'guid', v.guid,
      'optional', case when v.optional then 'Yes' else 'No' end, 'cancelled', case when v.cancelled then 'Yes' else 'No' end,
      'reference', v.ref, 'referenceDate', coalesce(to_char(v.ref_date, 'YYYYMMDD'), ''), 'cmpGstin', v.cmp_gstin, 'gstin', v.gstin,
      'entries', (select coalesce(jsonb_agg(jsonb_build_object('ledger', l.ledger, 'amount', l.amount::text)), '[]'::jsonb) from tally_lines l where l.book_id = v.book_id and l.guid = v.guid))
    order by v.day, v.vno), '[]'::jsonb) from v;
$function$;

commit;
