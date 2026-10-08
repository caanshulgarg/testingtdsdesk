-- Migration 65 (07-Oct-2026, next release, item e: the nightly self-check; docs/selfcheck-requests-for-approval.md). Runs
-- after 60 in both orders (and after 61, 62, 63 and 64 where they ran: it touches none of their objects); it needs tally_books, tally_vouchers, tally_lines, tally_ledger_day,
-- tally_ledgers (with 32's deleted_at and 33's merged_into), my_firm() and 47's tally_service_or_owner(). ADD-ONLY: one new
-- table with its indexes, row security and grants, and four new functions; no existing table or function is changed, no
-- statement here removes rows; safe to run twice; one transaction (lock_timeout 10 s). NOT run on staging.
--
-- Once a night per company FinCom Bridge compares Tally's change counter and Tally's own list of the entries changed since
-- the last good check with FinCom's copy, fetches what is missing, and records the result here through tally-ingest
-- (kind "selfcheck"). FinCom's cloud adds a check of its own copy that needs no Tally request.
--
--   tally_selfchecks              one row per check, never updated or removed: firm, book, company, the computer key and
--                                 bridge, ran_at, the night, Tally's ALTVCHID / ALTMSTID, the highest AlterID the copy
--                                 holds, the AlterID checked from, listed, missing found, fetched, still missing, masters
--                                 behind, why it stopped, the days for a Day Book upload, the copy check, the result
--                                 (ok | fetched | missing | not_checked) and the words the Tally page shows. The firm's
--                                 members read their own firm's rows; only tally-ingest (service role) writes.
--   tally_selfcheck_compare(book, entries)   which of Tally's listed entries [[guid, alter, ...]] the copy lacks: no entry
--                                 with that GUID ('absent'), one at a lower AlterID ('older'), one deleted ('deleted');
--                                 and the highest AlterID the copy holds. At most 5,000 entries a call. Reads only.
--   tally_selfcheck_copy(book)    the copy's own trial balance against the ledger openings and the entries received (no
--                                 Tally request): live entries whose lines do not add up to zero, ledgers whose ready totals
--                                 (tally_ledger_day) differ from their entries' lines, the movement over all ledgers, the
--                                 openings' total, ledgers named by entries but not in the ledger list. Reads only.
--   tally_selfcheck_words(...)    the plain words of a check (one text for the record and the tests).
--   tally_selfcheck_record(firm, book, device, bridge, result)   the bridge's result checked and kept with the copy check
--                                 and the words; answers {ok, id, result, words, copy}.
-- The functions: security definer, search_path public, pg_temp; tally_service_or_owner() checked first; executable by the
-- service role only (tally-ingest), never by anon or authenticated.
-- Tested by tests/run_migration65.py (pg_stand, twice) and tests/run_migration_order.py (65 in both orders).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create table if not exists public.tally_selfchecks (
  id                bigserial primary key,
  firm_id           uuid not null,
  book_id           uuid not null references public.tally_books (book_id) on delete restrict,
  device_id         uuid,
  bridge            text not null default '',
  company           text not null default '',
  company_guid      text not null default '',
  ran_at            timestamptz not null default now(),
  night             date,
  tally_altvchid    bigint,
  tally_altmstid    bigint,
  received_altvchid bigint,                       -- the highest AlterID FinCom's copy holds for the book
  checked_from      bigint,                       -- the AlterID up to which the last good check proved the copy complete
  listed            integer not null default 0,   -- entries Tally listed above checked_from
  missing_found     integer not null default 0,
  fetched           integer not null default 0,
  still_missing     integer not null default 0,
  masters_behind    bigint not null default 0,
  stopped           text not null default '',     -- why Tally's list was not taken ('' : it was)
  fetch_off         text not null default '',     -- why nothing was fetched (2.3.2's stop of the entry fetch)
  gap_days          date[] not null default '{}', -- the days of the entries still missing, for a Day Book upload
  since_night       date,                         -- the night of the last good check
  copy              jsonb not null default '{}'::jsonb,
  copy_ok           boolean,
  result            text not null check (result in ('ok', 'fetched', 'missing', 'not_checked')),
  words             text not null default '',
  data              jsonb not null default '{}'::jsonb,
  at                timestamptz not null default now()
);
create index if not exists tally_selfchecks_book on public.tally_selfchecks (book_id, ran_at desc);
create index if not exists tally_selfchecks_firm on public.tally_selfchecks (firm_id, ran_at desc);

alter table public.tally_selfchecks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_selfchecks' and policyname = 'tally_selfchecks_read') then
    create policy tally_selfchecks_read on public.tally_selfchecks for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_selfchecks from public, anon, authenticated;
grant select on public.tally_selfchecks to authenticated;
grant all on public.tally_selfchecks to service_role;
revoke all on sequence public.tally_selfchecks_id_seq from public, anon, authenticated;
grant usage, select on sequence public.tally_selfchecks_id_seq to service_role;

-- which of Tally's listed entries the copy lacks; the highest AlterID it holds
create or replace function public.tally_selfcheck_compare(p_book uuid, p_entries jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare n int; miss jsonb; rec bigint;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book) then raise exception 'no such book'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'entries: a list of [guid, alter, ...]'; end if;
  n := jsonb_array_length(p_entries);
  if n > 5000 then raise exception 'at most 5000 entries a call (% given)', n; end if;
  with e as (
    select left(btrim(x->>0), 100) as guid,
           case when (x->>1) ~ '^[0-9]{1,15}$' then (x->>1)::bigint end as alter_
      from jsonb_array_elements(p_entries) x
     where jsonb_typeof(x) = 'array' and coalesce(btrim(x->>0), '') <> ''
  ), w as (
    select e.guid, e.alter_, v.alter_id, v.deleted_at,
           case when v.guid is null then 'absent'
                when v.deleted_at is not null then 'deleted'
                when e.alter_ is not null and coalesce(v.alter_id, 0) < e.alter_ then 'older' end as why
      from e left join tally_vouchers v on v.book_id = p_book and v.guid = e.guid
  )
  select coalesce(jsonb_agg(jsonb_build_object('guid', w.guid, 'why', w.why, 'alter', w.alter_, 'have', w.alter_id) order by w.alter_ nulls last, w.guid), '[]'::jsonb)
    into miss from w where w.why is not null;
  select max(v.alter_id) into rec from tally_vouchers v where v.book_id = p_book;
  return jsonb_build_object('ok', true, 'n', n, 'missing', miss, 'received', rec);
end $function$;

-- the copy's own trial balance: needs no Tally request
create or replace function public.tally_selfcheck_copy(p_book uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; ents bigint; unbal bigint; unbal_ex jsonb; movement numeric; opens numeric; dmis bigint; dmis_ex jsonb; unknown bigint; unknown_ex jsonb;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  select count(*) into ents from tally_vouchers v where v.book_id = p_book and v.deleted_at is null and not coalesce(v.cancelled, false) and not coalesce(v.optional, false);
  -- live entries whose lines do not add up to zero
  with s as (
    select v.guid, v.vtype, v.vno, v.day, coalesce(sum(l.amount), 0) as total
      from tally_vouchers v join tally_lines l on l.book_id = v.book_id and l.guid = v.guid
     where v.book_id = p_book and v.deleted_at is null and not coalesce(v.cancelled, false) and not coalesce(v.optional, false)
     group by v.guid, v.vtype, v.vno, v.day
  )
  select count(*) filter (where abs(total) >= 0.01),
         coalesce(jsonb_agg(jsonb_build_object('guid', guid, 'type', vtype, 'no', vno, 'day', day, 'total', total) order by day, vno) filter (where abs(total) >= 0.01), '[]'::jsonb)
    into unbal, unbal_ex from s;
  -- the ready totals against the entries' lines, ledger by ledger (live entries, as tally_ledger_day_rebuild counts them)
  with ld as (select d.ledger, sum(d.amount) as amt from tally_ledger_day d where d.book_id = p_book group by d.ledger),
  ll as (select l.ledger, sum(l.amount) as amt from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
          where l.book_id = p_book and v.deleted_at is null and not coalesce(v.cancelled, false) and not coalesce(v.optional, false) group by l.ledger),
  x as (select coalesce(ld.ledger, ll.ledger) as ledger, coalesce(ld.amt, 0) as totals, coalesce(ll.amt, 0) as lines from ld full join ll on ll.ledger = ld.ledger)
  select count(*) filter (where abs(totals - lines) >= 0.01),
         coalesce((select jsonb_agg(jsonb_build_object('ledger', y.ledger, 'totals', y.totals, 'lines', y.lines)) from (select * from x where abs(totals - lines) >= 0.01 order by ledger limit 20) y), '[]'::jsonb)
    into dmis, dmis_ex from x;
  select coalesce(sum(d.amount), 0) into movement from tally_ledger_day d where d.book_id = p_book and (b.from_date is null or d.day >= b.from_date);
  select coalesce(sum(t.open), 0) into opens from tally_ledgers t where t.book_id = p_book and t.merged_into is null and t.deleted_at is null;
  -- ledgers named by entries but not in the ledger list at all
  select count(*), coalesce((select jsonb_agg(z.ledger order by z.ledger) from (select distinct d.ledger from tally_ledger_day d where d.book_id = p_book
            and not exists (select 1 from tally_ledgers t where t.book_id = p_book and t.name = d.ledger) order by d.ledger limit 20) z), '[]'::jsonb)
    into unknown, unknown_ex
    from (select distinct d.ledger from tally_ledger_day d where d.book_id = p_book and not exists (select 1 from tally_ledgers t where t.book_id = p_book and t.name = d.ledger)) u;
  return jsonb_build_object('entries', ents, 'unbalanced', unbal, 'unbalancedSome', unbal_ex, 'totalsOff', dmis, 'totalsOffSome', dmis_ex,
    'movement', round(movement, 2), 'openings', round(opens, 2), 'tb', round(opens + movement, 2), 'unknownLedgers', unknown, 'unknownSome', unknown_ex,
    'ok', unbal = 0 and dmis = 0 and abs(movement) < 0.01 and abs(opens) < 0.01 and unknown = 0);
end $function$;

-- the words of a check, as the Tally page shows them
create or replace function public.tally_selfcheck_words(p_result text, p_ran_at timestamptz, p_night date, p_since date, p_listed integer, p_missing integer,
  p_fetched integer, p_still integer, p_deleted integer, p_masters bigint, p_stopped text, p_fetch_off text, p_gap date[], p_copy jsonb)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare w text; hm text := to_char(p_ran_at at time zone 'Asia/Kolkata', 'HH24:MI'); nt text := to_char(p_night, 'DD-Mon-YYYY');
  days text := ''; probs text[] := '{}'; ent text;
begin
  if coalesce(array_length(p_gap, 1), 0) > 0 then
    select string_agg(to_char(d, 'DD-Mon-YYYY'), ', ' order by d) into days from (select distinct d from unnest(p_gap) d order by d limit 31) g;
    if array_length(p_gap, 1) > 31 then days := days || ' and later days'; end if;
  end if;
  if p_result = 'not_checked' then
    return 'Not checked on the night of ' || nt || ' (' || hm || ' IST): ' || coalesce(nullif(p_stopped, ''), 'Tally could not be asked') || '. Upload the Day Book '
      || case when p_since is not null then 'from ' || to_char(p_since, 'DD-Mon-YYYY') || ' to today' else 'for the days worked on since the starting point' end
      || ' to be sure nothing is missing.';
  end if;
  w := 'Checked on the night of ' || nt || ' at ' || hm || ' IST: ';
  ent := case when p_missing = 1 then ' entry' else ' entries' end;
  if p_missing = 0 then
    w := w || case when p_listed = 0 then 'nothing changed in Tally since the last check'
                   else 'every change Tally made since ' || coalesce('the night of ' || to_char(p_since, 'DD-Mon-YYYY'), 'the starting point') || ' is in FinCom (' || p_listed || ' checked)' end || '.';
  elsif p_still = 0 then
    w := w || p_missing || ent || ' missing from FinCom; ' || case when p_fetched = 1 then 'fetched' else 'all ' || p_fetched || ' fetched' end || ' from Tally.';
  else
    w := w || p_missing || ent || ' missing from FinCom' || case when p_fetched > 0 then '; ' || p_fetched || ' fetched from Tally, ' || p_still || ' still missing' else '' end
      || case when p_fetch_off <> '' then ' (entries are not fetched for this company now: ' || p_fetch_off || ')' else '' end
      || case when days <> '' then ': upload the Day Book for ' || days || '.' else '.' end
      || case when p_deleted > 0 then ' ' || p_deleted || ' of them FinCom holds as deleted.' else '' end;
  end if;
  if p_masters > 0 then w := w || ' ' || p_masters || ' master change' || case when p_masters = 1 then '' else 's' end || ' in Tally not yet taken by FinCom.'; end if;
  if p_copy is not null and p_copy ? 'ok' then
    if (p_copy->>'ok')::boolean then w := w || ' FinCom''s copy adds up.';
    else
      if coalesce((p_copy->>'unbalanced')::bigint, 0) > 0 then probs := probs || ((p_copy->>'unbalanced') || ' entr' || case when (p_copy->>'unbalanced')::bigint = 1 then 'y does' else 'ies do' end || ' not add up to zero'); end if;
      if coalesce((p_copy->>'totalsOff')::bigint, 0) > 0 then probs := probs || ('the totals of ' || (p_copy->>'totalsOff') || ' ledger' || case when (p_copy->>'totalsOff')::bigint = 1 then '' else 's' end || ' differ from their entries'); end if;
      if abs(coalesce((p_copy->>'movement')::numeric, 0)) >= 0.01 then probs := probs || ('the year''s entries total Rs ' || to_char(abs((p_copy->>'movement')::numeric), 'FM999999999999990.00') || ' instead of zero'); end if;
      if abs(coalesce((p_copy->>'openings')::numeric, 0)) >= 0.01 then probs := probs || ('the openings differ by Rs ' || to_char(abs((p_copy->>'openings')::numeric), 'FM999999999999990.00') || ' (Tally''s difference in opening balances)'); end if;
      if coalesce((p_copy->>'unknownLedgers')::bigint, 0) > 0 then probs := probs || ((p_copy->>'unknownLedgers') || ' ledger' || case when (p_copy->>'unknownLedgers')::bigint = 1 then ' named by entries is' else 's named by entries are' end || ' not in the ledger list'); end if;
      w := w || ' FinCom''s copy: ' || array_to_string(probs, '; ') || '.';
    end if;
  end if;
  return w;
end $function$;

-- the bridge's result, checked and kept with the copy check and the words
create or replace function public.tally_selfcheck_record(p_firm uuid, p_book uuid, p_device uuid, p_bridge text, p_r jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; cp jsonb; res text; w text; rid bigint; rec bigint;
  listed int; missing int; fetched int; still int; deleted int; masters bigint; stopped text; foff text; gap date[] := '{}'; night date; since date; ran timestamptz;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null or b.firm_id is distinct from p_firm then raise exception 'not a book of this firm'; end if;
  if p_r is null or jsonb_typeof(p_r) <> 'object' then raise exception 'the result: an object'; end if;
  -- whole numbers 0..1,000,000 (counts) and 0..10^15 (AlterIDs); anything else is 0 / null
  listed  := case when (p_r->>'listed')  ~ '^[0-9]{1,7}$' then least((p_r->>'listed')::int, 1000000) else 0 end;
  missing := case when (p_r->>'missing') ~ '^[0-9]{1,7}$' then least((p_r->>'missing')::int, 1000000) else 0 end;
  fetched := case when (p_r->>'fetched') ~ '^[0-9]{1,7}$' then least((p_r->>'fetched')::int, missing) else 0 end;
  still   := case when (p_r->>'still')   ~ '^[0-9]{1,7}$' then least((p_r->>'still')::int, 1000000) else 0 end;
  deleted := case when (p_r->>'deleted') ~ '^[0-9]{1,7}$' then least((p_r->>'deleted')::int, still) else 0 end;
  masters := case when (p_r->>'mastersBehind') ~ '^[0-9]{1,15}$' then (p_r->>'mastersBehind')::bigint else 0 end;
  stopped := left(btrim(coalesce(p_r->>'stopped', '')), 300);
  foff    := left(btrim(coalesce(p_r->>'fetchOff', '')), 300);
  night   := case when (p_r->>'night') ~ '^[0-9]{8}$' then to_date(p_r->>'night', 'YYYYMMDD') end;
  since   := case when (p_r->>'since') ~ '^[0-9]{8}$' then to_date(p_r->>'since', 'YYYYMMDD') end;
  begin ran := (p_r->>'ran_at')::timestamptz; exception when others then ran := null; end;
  if ran is null or ran > now() + interval '1 day' then ran := now(); end if;
  if night is null then night := (ran at time zone 'Asia/Kolkata')::date; end if;
  if jsonb_typeof(p_r->'gapDays') = 'array' then
    select coalesce(array_agg(distinct to_date(x, 'YYYYMMDD') order by to_date(x, 'YYYYMMDD')), '{}') into gap
      from (select jsonb_array_elements_text(p_r->'gapDays') x limit 400) g where x ~ '^[0-9]{8}$';
  end if;
  res := case when stopped <> '' then 'not_checked' when still > 0 then 'missing' when fetched > 0 then 'fetched' else 'ok' end;
  cp := tally_selfcheck_copy(p_book);
  select max(v.alter_id) into rec from tally_vouchers v where v.book_id = p_book;
  w := tally_selfcheck_words(res, ran, night, since, listed, missing, fetched, still, deleted, masters, stopped, foff, gap, cp);
  insert into tally_selfchecks (firm_id, book_id, device_id, bridge, company, company_guid, ran_at, night, tally_altvchid, tally_altmstid, received_altvchid, checked_from,
      listed, missing_found, fetched, still_missing, masters_behind, stopped, fetch_off, gap_days, since_night, copy, copy_ok, result, words, data)
    values (p_firm, p_book, p_device, left(coalesce(p_bridge, ''), 80), left(coalesce(p_r->>'company', b.company, ''), 200), left(coalesce(p_r->>'company_guid', ''), 100), ran, night,
      case when (p_r->>'altvchid') ~ '^[0-9]{1,15}$' then (p_r->>'altvchid')::bigint end, case when (p_r->>'altmstid') ~ '^[0-9]{1,15}$' then (p_r->>'altmstid')::bigint end, rec,
      case when (p_r->>'after') ~ '^[0-9]{1,15}$' then (p_r->>'after')::bigint end,
      listed, missing, fetched, still, masters, stopped, foff, gap, since, cp, (cp->>'ok')::boolean, res, w,
      jsonb_build_object('deleted', deleted))
    returning id into rid;
  return jsonb_build_object('ok', true, 'id', rid, 'result', res, 'words', w, 'copy', cp, 'received', rec);
end $function$;

revoke all on function public.tally_selfcheck_compare(uuid, jsonb), public.tally_selfcheck_copy(uuid),
  public.tally_selfcheck_words(text, timestamptz, date, date, integer, integer, integer, integer, integer, bigint, text, text, date[], jsonb),
  public.tally_selfcheck_record(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tally_selfcheck_compare(uuid, jsonb), public.tally_selfcheck_copy(uuid),
  public.tally_selfcheck_words(text, timestamptz, date, date, integer, integer, integer, integer, integer, bigint, text, text, date[], jsonb),
  public.tally_selfcheck_record(uuid, uuid, uuid, text, jsonb) to service_role;

commit;
