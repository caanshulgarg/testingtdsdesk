-- FinCom Bridge 2.1.5, owner's rule of 02-Oct-2026: read each Tally company's baseline once, then only changes; never ask
-- Tally for a balance. Every balance is worked out here, from the openings (tally_ledgers.open) and the entries
-- (tally_ledger_day), as the reports already do. Adds only: nothing is dropped or deleted; tally_status is replaced to
-- carry three more fields.
--
--   tally_books.sync              where the bridge is, kept in the cloud: {lastV, lastM, at, base:{phase, from, next}}:
--                                 the last voucher and master AlterID the cloud holds, and a baseline read's progress
--   tally_books.verify            the nightly check's result: {at, asOn, ok, groups:[[group, tally, cloud]], days, masters,
--                                 ledgers, n}: "Tally's totals differ from FinCom's: n ledgers to check"
--   tally_books.reread            asked in FinCom ("Re-read these"): {days, masters, at, by}; the bridge clears it when done
--   tally_ledgers.guid, alter_id, open_master
--                                 the master's GUID (a rename is followed by it), its AlterID, and the opening as Tally's
--                                 ledger master stores it (OPENINGBALANCE, never a balance Tally works out). When the copy
--                                 starts later than the books in Tally, the opening as on the copy's start moves by as
--                                 much as the stored opening moves
--   tally_sync_get(book)          the bridge's start: what the cloud holds (period, ledgers, days, last AlterIDs, re-read)
--   tally_sync_set(book, p)       the last AlterIDs (only upwards, unless reset), the baseline's progress, a re-read done
--   tally_ingest_masters(...)     changed masters (ledgers by GUID or name, groups): added, renamed (lines, bills, day
--                                 totals and parties follow), moved, their stored opening; then the chains and the year's
--                                 openings again (tally_year_openings)
--   tally_day_ids(book, from, to) per day: the number of entries and an md5 of "guid:alterid" in GUID order (no amounts),
--                                 for the bridge's deletion check against Tally's list of the same days
--   tally_verify(book, asOn, groups)   the trial balance's primary-group totals worked out here, against Tally's
--   tally_verify_save(book, p)    the nightly result kept, with the ledgers on the differing days (what to check)
--   tally_reread(client)          FinCom's "Re-read these": the days and masters of the last check asked of the bridge
--   tally_status(client)          as before, with sync, verify and reread

begin;

alter table public.tally_books add column if not exists sync jsonb not null default '{}'::jsonb;
alter table public.tally_books add column if not exists verify jsonb;
alter table public.tally_books add column if not exists reread jsonb;
alter table public.tally_ledgers add column if not exists guid text;
alter table public.tally_ledgers add column if not exists alter_id bigint;
alter table public.tally_ledgers add column if not exists open_master numeric(18,2);
create index if not exists tally_ledgers_guid on public.tally_ledgers (book_id, guid) where guid is not null;

-- ---------------------------------------------------------------- the bridge's start and progress (service role only)
create or replace function public.tally_sync_get(p_book uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare b tally_books%rowtype; res jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then return jsonb_build_object('none', true); end if;
  select jsonb_build_object('from', to_char(b.from_date, 'YYYYMMDD'), 'openAsOn', to_char(b.open_as_on, 'YYYYMMDD'), 'ledgersAt', b.ledgers_at,
      'ledgers', (select count(*) from tally_ledgers l where l.book_id = p_book),
      'days', count(d.day), 'daysFrom', to_char(min(d.day), 'YYYYMMDD'), 'daysTo', to_char(max(d.day), 'YYYYMMDD'),
      -- the last voucher AlterID held: the bridge's, else the highest in the day books kept (uploaded files included)
      'lastV', coalesce((b.sync->>'lastV')::bigint, max(d.alter_max), 0), 'lastVKept', b.sync ? 'lastV',
      'lastM', (b.sync->>'lastM')::bigint, 'base', b.sync->'base', 'reread', b.reread)
    into res from tally_days d where d.book_id = p_book;
  return res;
end $function$;

create or replace function public.tally_sync_set(p_book uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s jsonb; r jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select coalesce(sync, '{}'::jsonb), reread into s, r from tally_books where book_id = p_book;
  if s is null then raise exception 'no such book'; end if;
  -- the last AlterIDs only go up (two runs never take the cloud back), unless Tally's own numbers went back (reset)
  if p ? 'lastV' then s := s || jsonb_build_object('lastV', case when coalesce((p->>'reset')::boolean, false) then (p->>'lastV')::bigint
                                                           else greatest(coalesce((s->>'lastV')::bigint, 0), (p->>'lastV')::bigint) end); end if;
  if p ? 'lastM' then s := s || jsonb_build_object('lastM', case when coalesce((p->>'reset')::boolean, false) then (p->>'lastM')::bigint
                                                           else greatest(coalesce((s->>'lastM')::bigint, 0), (p->>'lastM')::bigint) end); end if;
  if p ? 'base' then s := s || jsonb_build_object('base', p->'base'); end if;
  s := s || jsonb_build_object('at', now());
  update tally_books set sync = s,
         reread = case when p ? 'rereadDone' and r->>'at' = p->>'rereadDone' then null else reread end,
         verify = case when p ? 'rereadDone' and verify is not null and r->>'at' = p->>'rereadDone' then verify || jsonb_build_object('rereadAt', now()) else verify end
   where book_id = p_book;
  return s;
end $function$;

-- ---------------------------------------------------------------- changed masters
create or replace function public.tally_ingest_masters(p_book uuid, p_ledgers jsonb, p_groups jsonb, p_base boolean, p_from date, p_open_as_on date, p_last bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; x jsonb; nm text; was text; par text; op numeric; g text; aid bigint; cur tally_ledgers%rowtype; old text;
  renamed int := 0; added int := 0; changed int := 0; yo jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  -- a baseline read by the bridge: the copy starts on the day the books begin in Tally, its openings the stored ones
  if coalesce(p_base, false) and p_from is not null then
    update tally_books set from_date = p_from, open_as_on = coalesce(p_open_as_on, p_from - 1), ledgers_at = now() where book_id = p_book;
  else
    update tally_books set ledgers_at = now() where book_id = p_book;
  end if;
  insert into tally_groups (book_id, firm_id, name, parent)
  select distinct on (tally_nm(gx->>0)) p_book, f, tally_nm(gx->>0), tally_nm(gx->>1) from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) gx
   where tally_nm(gx->>0) <> '' order by tally_nm(gx->>0), (tally_nm(gx->>1) <> '') desc
  on conflict (book_id, name) do update set parent = excluded.parent;
  for x in select * from jsonb_array_elements(coalesce(p_ledgers, '[]'::jsonb)) loop
    nm := tally_nm(x->>0);
    continue when nm = '';
    par := tally_nm(x->>1); op := round(coalesce(nullif(x->>2, '')::numeric, 0), 2); g := nullif(x->>5, ''); aid := nullif(x->>6, '')::bigint; was := tally_nm(x->>7);
    -- renamed in Tally: the row found by its GUID (else by the name it had) takes the new name, and so do its entries
    old := null;
    select l.name into old from tally_ledgers l where l.book_id = p_book and l.merged_into is null and l.name <> nm
       and ((g is not null and l.guid = g) or (was <> '' and l.name = was)) order by (l.guid = g) desc nulls last limit 1;
    if old is not null and not exists (select 1 from tally_ledgers l where l.book_id = p_book and l.name = nm) then
      update tally_ledgers set name = nm where book_id = p_book and name = old;
      update tally_lines set ledger = nm where book_id = p_book and ledger = old;
      update tally_bills set ledger = nm where book_id = p_book and ledger = old;
      update tally_vouchers set party = nm where book_id = p_book and party = old;
      -- the day totals of both names worked out again from the lines (the new name may have entries already)
      delete from tally_ledger_day where book_id = p_book and ledger in (old, nm);
      insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
      select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
        from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
       where l.book_id = p_book and l.ledger = nm and not v.cancelled and not v.optional
       group by l.ledger, l.day;
      renamed := renamed + 1;
    end if;
    select * into cur from tally_ledgers l where l.book_id = p_book and l.name = nm;
    if cur.name is null then
      insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, open_master, guid, alter_id, gstin, pan)
      values (p_book, f, nm, par, op, op, op, g, aid, nullif(upper(coalesce(x->>3, '')), ''), nullif(upper(coalesce(x->>4, '')), ''));
      added := added + 1;
    else
      -- the opening: the stored one on a baseline; else moved by as much as the stored one moved (first seen: kept as it is)
      update tally_ledgers set parent = case when par <> '' then par else parent end, guid = coalesce(g, guid), alter_id = coalesce(aid, alter_id),
             gstin = coalesce(nullif(upper(coalesce(x->>3, '')), ''), gstin), pan = coalesce(nullif(upper(coalesce(x->>4, '')), ''), pan),
             open_sent = case when coalesce(p_base, false) then op
                              when cur.open_master is not null then coalesce(cur.open_sent, cur.open) + (op - cur.open_master)
                              else cur.open_sent end,
             open_master = op
       where book_id = p_book and name = nm;
      changed := changed + 1;
    end if;
  end loop;
  -- each ledger's chain up to its primary group, as tally_ingest_ledgers_g
  with recursive up as (
    select l.name as ledger, l.parent as grp, 1 as depth, array[l.parent] as chain
      from tally_ledgers l where l.book_id = p_book and l.parent <> ''
    union all
    select u.ledger, gr.parent, u.depth + 1, u.chain || gr.parent
      from up u join tally_groups gr on gr.book_id = p_book and gr.name = u.grp
     where gr.parent <> '' and u.depth < 30 and not (gr.parent = any(u.chain))
  ), best as (
    select distinct on (ledger) ledger, chain from up order by ledger, depth desc
  )
  update tally_ledgers l set chain = b.chain, primary_group = b.chain[array_length(b.chain, 1)]
    from best b where l.book_id = p_book and l.name = b.ledger;
  yo := public.tally_year_openings(p_book);
  if p_last is not null then
    update tally_books set sync = coalesce(sync, '{}'::jsonb) || jsonb_build_object('lastM', greatest(coalesce((sync->>'lastM')::bigint, 0), p_last), 'at', now()) where book_id = p_book;
  end if;
  return jsonb_build_object('ok', true, 'added', added, 'changed', changed, 'renamed', renamed, 'yearOpenings', yo);
end $function$;

-- ---------------------------------------------------------------- the deletion check: per day, ids and count, no amounts
create or replace function public.tally_day_ids(p_book uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare res jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_array(to_char(day, 'YYYYMMDD'), n, h) order by day), '[]'::jsonb) into res from (
    select v.day, count(*) as n, md5(string_agg(v.guid || ':' || v.alter_id, ',' order by v.guid collate "C")) as h
      from tally_vouchers v where v.book_id = p_book and v.day between p_from and p_to and not v.optional
     group by v.day) z;
  return res;
end $function$;

-- ---------------------------------------------------------------- the nightly check
-- Tally's closing of each primary group (one request, as on p_as_on, its year from 1 April) against the same worked out
-- here: a balance-sheet group is its ledgers' openings and every entry to the date; an income or expense group only this
-- year's entries (and the openings when the copy starts this year); Tally's sign (a debit is negative)
create or replace function public.tally_verify(p_book uuid, p_as_on date, p_groups jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare b tally_books%rowtype; fy date; res jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book;
  if b.from_date is null then return jsonb_build_object('none', true); end if;
  fy := make_date(extract(year from p_as_on)::int - case when extract(month from p_as_on) < 4 then 1 else 0 end, 4, 1);
  with led as (select l.name, l.primary_group as pg, coalesce(l.open, 0) as open from tally_ledgers l
                where l.book_id = p_book and l.merged_into is null and l.primary_group <> ''),
  mv as (select d.ledger, coalesce(sum(d.amount) filter (where d.day >= greatest(fy, b.from_date)), 0) as cur, sum(d.amount) as allm
           from tally_ledger_day d where d.book_id = p_book and d.day between b.from_date and p_as_on group by d.ledger),
  cg as (select l.pg, round(sum(case when lower(l.pg) in ('sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses')
                                     then (case when b.from_date >= fy then l.open else 0 end) + coalesce(m.cur, 0)
                                     else l.open + coalesce(m.allm, 0) end), 2) as c
           from led l left join mv m on m.ledger = l.name group by l.pg),
  tg as (select tally_nm(x->>0) as g, round(sum(coalesce(nullif(x->>1, '')::numeric, 0)), 2) as t from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) x
          where tally_nm(x->>0) <> '' group by 1),
  j as (select coalesce(tg.g, cg.pg) as g, coalesce(tg.t, 0) as t, coalesce(cg.c, 0) as c from tg full join cg on cg.pg = tg.g)
  select jsonb_build_object('asOn', to_char(p_as_on, 'YYYYMMDD'), 'from', to_char(b.from_date, 'YYYYMMDD'),
           'groups', coalesce(jsonb_agg(jsonb_build_array(g, t, c) order by g), '[]'::jsonb),
           'differ', count(*) filter (where abs(t - c) >= 1),
           'tallyTotal', coalesce(sum(t), 0), 'cloudTotal', coalesce(sum(c), 0))
    into res from j;
  return res;
end $function$;

-- the night's result kept for FinCom: the ledgers on the days that differ, and the masters to read again
create or replace function public.tally_verify_save(p_book uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare ds date[]; leds text[]; v jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(to_date(x, 'YYYYMMDD')), '{}') into ds
    from jsonb_array_elements_text(case when jsonb_typeof(p->'days') = 'array' then p->'days' else '[]'::jsonb end) x where x ~ '^\d{8}$';
  select coalesce(array_agg(distinct n order by n), '{}') into leds from (
    select l.ledger as n from tally_lines l where l.book_id = p_book and l.day = any(ds)
    union select g.ledger from tally_vouchers_gone_lines(p_book, ds) g
    union select tally_nm(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'masters') = 'array' then p->'masters' else '[]'::jsonb end) x
  ) z where n <> '';
  v := p || jsonb_build_object('at', now(), 'ledgers', to_jsonb(leds[1:300]), 'n', coalesce(array_length(leds, 1), 0),
                               'ok', coalesce((p->>'differ')::int, 0) = 0 and coalesce(array_length(ds, 1), 0) = 0);
  update tally_books set verify = v where book_id = p_book;
  return v;
end $function$;

-- the ledgers of entries already marked gone on those days (tally_vouchers_gone of migration-18 when it is there)
create or replace function public.tally_vouchers_gone_lines(p_book uuid, p_days date[])
returns table (ledger text) language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if to_regclass('public.tally_vouchers_gone') is null then return; end if;
  return query execute 'select distinct tally_nm(e->>0) from tally_vouchers_gone g, jsonb_array_elements(coalesce(g.lines, ''[]''::jsonb)) e
                         where g.book_id = $1 and g.day = any($2) and g.back_at is null' using p_book, p_days;
end $function$;

-- ---------------------------------------------------------------- FinCom: "Re-read these"
create or replace function public.tally_reread(p_client text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); nb int; nd int;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_books b set reread = jsonb_build_object('days', coalesce(b.verify->'days', '[]'::jsonb),
                                                     'masters', case when jsonb_typeof(b.verify->'masters') = 'array' and jsonb_array_length(b.verify->'masters') > 0
                                                                     or coalesce((b.verify->>'differ')::int, 0) > 0 and jsonb_array_length(coalesce(b.verify->'days', '[]'::jsonb)) = 0
                                                                     then true else false end,
                                                     'at', now(), 'by', auth.uid())
   where b.firm_id = f and b.client_id = p_client and b.verify is not null and coalesce((b.verify->>'ok')::boolean, true) = false;
  get diagnostics nb = row_count;
  if nb = 0 then return jsonb_build_object('ok', false, 'books', 0, 'error', 'Nothing to read again: the last check found no difference.'); end if;
  -- the Tally computer is woken for an update (migration-4 and -13: the update wake-up)
  update tally_devices d set want_update_at = now()
   where d.firm_id = f and not coalesce(d.revoked, false)
     and d.id in (select c.device_id from tally_companies c where c.firm_id = f and c.client_id = p_client and c.device_id is not null);
  get diagnostics nd = row_count;
  return jsonb_build_object('ok', true, 'books', nb, 'devices', nd);
end $function$;

-- ---------------------------------------------------------------- what FinCom reads of a client's books (as before, and more)
create or replace function public.tally_status(p_client text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('book', b.book_id, 'company', b.company, 'from', b.from_date, 'openAsOn', b.open_as_on,
      'ledgersAt', b.ledgers_at, 'daysAt', b.days_at, 'state', b.state, 'stateAt', b.state_at,
      'days', (select count(*) from tally_days d where d.book_id = b.book_id),
      'entries', (select coalesce(sum(n), 0) from tally_days d where d.book_id = b.book_id),
      'to', (select max(day) from tally_days d where d.book_id = b.book_id),
      'sync', b.sync, 'verify', b.verify, 'reread', b.reread) order by b.from_date desc nulls last), '[]'::jsonb)
    from tally_books b where b.client_id = p_client and b.firm_id = my_firm()
$function$;

revoke all on function public.tally_sync_get(uuid), public.tally_sync_set(uuid, jsonb), public.tally_ingest_masters(uuid, jsonb, jsonb, boolean, date, date, bigint),
  public.tally_day_ids(uuid, date, date), public.tally_verify(uuid, date, jsonb), public.tally_verify_save(uuid, jsonb), public.tally_vouchers_gone_lines(uuid, date[])
  from public, anon, authenticated;
grant execute on function public.tally_sync_get(uuid), public.tally_sync_set(uuid, jsonb), public.tally_ingest_masters(uuid, jsonb, jsonb, boolean, date, date, bigint),
  public.tally_day_ids(uuid, date, date), public.tally_verify(uuid, date, jsonb), public.tally_verify_save(uuid, jsonb), public.tally_vouchers_gone_lines(uuid, date[])
  to service_role;
revoke all on function public.tally_reread(text) from public, anon;
grant execute on function public.tally_reread(text) to authenticated;
revoke execute on function public.tally_status(text) from public, anon;
grant execute on function public.tally_status(text) to authenticated;

commit;
