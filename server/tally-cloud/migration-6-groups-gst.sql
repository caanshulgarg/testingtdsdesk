-- Cloud copy of the books, review of 01-Oct-2026: ledger groups, party GSTIN, HSN and GST rate.
-- Only adds: new columns (with defaults, so every row already there stays as it is), a table for the groups, and
-- the two functions that fill them. Nothing is dropped and no row is deleted by this migration.
--
--   tally_vouchers + gstin, pos              the party's GSTIN and the place of supply on the entry
--   tally_lines    + hsn, rate               HSN/SAC and the GST rate (IGST's, the whole rate) on each line
--   tally_ledgers  + chain, primary_group    the ledger's groups from its own parent up to the primary group
--   tally_groups   (new)                     Tally's group list: name and parent (empty for a primary group)
--
-- tally_ingest_day: the same as now, with the new fields. tally_ingest_ledgers_g: as tally_ingest_ledgers, plus the
-- groups, and each ledger's chain worked out from them. tally_ingest_ledgers stays as it is for older callers.

begin;

alter table public.tally_vouchers add column if not exists gstin text not null default '';
alter table public.tally_vouchers add column if not exists pos text not null default '';
alter table public.tally_lines add column if not exists hsn text not null default '';
alter table public.tally_lines add column if not exists rate numeric;
alter table public.tally_ledgers add column if not exists chain text[] not null default '{}';
alter table public.tally_ledgers add column if not exists primary_group text not null default '';

create table if not exists public.tally_groups (
  book_id uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id uuid not null,
  name text not null,
  parent text not null default '',
  primary key (book_id, name)
);
alter table public.tally_groups enable row level security;
-- read as the other tables of the copy: a member of the firm; written only by the functions below (service role)
drop policy if exists tally_groups_read on public.tally_groups;
create policy tally_groups_read on public.tally_groups for select to authenticated using (firm_id = public.my_firm());
revoke all on public.tally_groups from public, anon, authenticated;
grant select on public.tally_groups to authenticated;
grant all on public.tally_groups to service_role;

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
  delete from tally_lines l where l.book_id = p_book and (l.day = p_day or l.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  delete from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         coalesce(x->>'party', ''), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60)
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc;
  -- a line is [guid, ledger, amount] (bridge and parser before 01-Oct-2026) or [guid, ledger, amount, hsn, rate]
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, p_day, x->>1, (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric from jsonb_array_elements(p_lines) x;
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

create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; n_groups int := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  -- the ledgers, as tally_ingest_ledgers does them
  perform public.tally_ingest_ledgers(p_book, p_from, p_open_as_on, p_ledgers);
  -- the groups: Tally's whole list each time it is sent (a group renamed or gone is then right too)
  if jsonb_array_length(coalesce(p_groups, '[]'::jsonb)) > 0 then
    delete from tally_groups where book_id = p_book;
    insert into tally_groups (book_id, firm_id, name, parent)
    select distinct on (x->>0) p_book, f, x->>0, coalesce(x->>1, '') from jsonb_array_elements(p_groups) x where coalesce(x->>0, '') <> ''
    on conflict (book_id, name) do update set parent = excluded.parent;
    get diagnostics n_groups = row_count;
  end if;
  -- each ledger's chain: its parent, that group's parent, ... up to a group with no parent (a primary group);
  -- at most 30 steps, so a loop in the list cannot run on
  with recursive up as (
    select l.name as ledger, l.parent as grp, 1 as depth, array[l.parent] as chain
      from tally_ledgers l where l.book_id = p_book and l.parent <> ''
    union all
    select u.ledger, g.parent, u.depth + 1, u.chain || g.parent
      from up u join tally_groups g on g.book_id = p_book and g.name = u.grp
     where g.parent <> '' and u.depth < 30 and not (g.parent = any(u.chain))
  ), best as (
    select distinct on (ledger) ledger, chain from up order by ledger, depth desc
  )
  update tally_ledgers l set chain = b.chain, primary_group = b.chain[array_length(b.chain, 1)]
    from best b where l.book_id = p_book and l.name = b.ledger;
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(p_ledgers), 'groups', n_groups);
end $function$;

revoke all on function public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb) to service_role;

commit;
