-- Cloud copy of the books, review of 01-Oct-2026: bill-wise details, so receivables and payables can be aged from the
-- cloud copy. Only adds: a table for the bill-wise lines and, in tally_ingest_day, filling it. Nothing is dropped.
--
--   tally_bills (new)   one row per bill-wise line of an entry: the party ledger, the bill's name, New Ref / Agst Ref /
--                       Advance / On Account, the amount (Tally's sign: debit negative), the bill date (the entry's date
--                       for a New Ref or an Advance) and the due date (bill date + Tally's credit days, when given)
--
-- The day books already kept in storage carry these details: "Read the kept day books again" (Settings > Tally > Books
-- in the cloud, owners) fills the table for the past; new days fill it as they come. No change to the bridge.
-- tally_ingest_day: as migration-6, and a line's sixth element is its bill-wise details:
-- [guid, ledger, amount, hsn, rate, [[bill name, type, amount, credit days or null], ...]].

begin;

create table if not exists public.tally_bills (
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  guid text not null,
  day date not null,
  ledger text not null,
  name text not null default '',
  type text not null default '',
  amount numeric not null,
  bill_date date,
  credit_days integer,
  due date
);
create index if not exists tally_bills_book_party on public.tally_bills (book_id, ledger, name);
create index if not exists tally_bills_book_guid on public.tally_bills (book_id, guid);
create index if not exists tally_bills_book_day on public.tally_bills (book_id, day);
alter table public.tally_bills enable row level security;
-- read as the other tables of the copy: a member of the firm; written only by tally_ingest_day (service role)
drop policy if exists tally_bills_read on public.tally_bills;
create policy tally_bills_read on public.tally_bills for select to authenticated using (firm_id = public.my_firm());
revoke all on public.tally_bills from public, anon, authenticated;
grant select on public.tally_bills to authenticated;
grant all on public.tally_bills to service_role;

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
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         coalesce(x->>'party', ''), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60)
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc;
  -- a line is [guid, ledger, amount] (older), [guid, ledger, amount, hsn, rate], or that and its bill-wise details
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

commit;
