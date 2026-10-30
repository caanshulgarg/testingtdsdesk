-- Migration 130 (30-Oct-2026, branch bridge-dated-ledgers, with FinCom Bridge 2.5.0; NOT run on staging: the owner reads it
-- and runs it). Opening balances are taken only when they add up to nil, and a dated read is preferred.
--
-- Why (book 3d36a836, 29/30-Oct-2026): a bridge read the ledgers with no period, so Tally gave each ledger's opening as at the
-- start of the Gateway's CURRENT period (2026-27) and the cloud took them as the books' openings (2025-26): the openings no
-- longer added up to nil (a Rs 3.19 cr difference). Bridge 2.5.0 reads them dated (the books' first year) and says so
-- (openingsAt); this file is the cloud's side, three guards (tally-ingest calls them):
--   (a) after a complete ledger round (the book's openings with the round's in place), a trial-balance list ("ledgers") or
--       a trial balance uploaded as opening balances ("upload_ledgers": the file's own total, a trial balance leaving out
--       the ledgers with a nil balance): when they would not add up to nil (beyond Rs 1), the stored openings are NOT
--       overwritten: the previous stay, the incoming are kept as held (tally_openings_held), and one tally_alerts row says
--       "Opening balances from <source> do not add up to nil: <difference>" (no computer names in the words);
--   (b) a trial balance used as opening balances whose date is not the day before the books begin is refused (tally-ingest,
--       plain words; no SQL);
--   (c) when a round's openings differ from the stored ones of a book whose stored openings tie (some opening not nil, the
--       sum nil): a dated round (the bridge says openingsAt) is taken; an undated round (a bridge before 2.5.0) never changes
--       openings (kept as held, stage 'kept').
--
-- ADD-ONLY: one new table and six new functions; no table altered, nothing dropped, no row deleted; safe to run twice; one
-- transaction, lock_timeout 10 s. Grants explicit: service_role (tally-ingest) only, on the table and on every function;
-- authenticated and anon nothing (the alert reaches the firm through tally_alerts, which its members already read).
--
--   tally_openings_held: every set of openings the cloud was sent through these guards: pending (a round's batches, until
--     its last), applied, held (did not add up to nil), kept (an undated round on a book whose openings tie).
--   tally_inr(n): an amount in Indian digit groups with Dr / Cr ("1,28,00,000.00 Dr"; Tally's sign: a debit is negative).
--   tally_openings_candidate(book, rows): the book's openings now (sum, whether they tie) and with rows [[name, opening]]
--     in place of their ledgers' (the sum, how many would change).
--   tally_openings_hold(book, source, round, openings_at, rows, stage, diff): one held row; for 'held' one alert (one a
--     day for the same source and difference).
--   tally_openings_stage(book, round, source, openings_at, rows): a round's batch of openings, pending.
--   tally_openings_settle(book, round, source, openings_at): the round's pending openings, on its last batch: applied
--     (open and open_sent, then tally_year_openings) when they add up to nil and (c) allows; else held (and the alert) or
--     kept.
--
-- Deploy: this file first, then tally-ingest (which uses these when they are there and, until then, does as before). Tested
-- on pg_stand: tests/run_migration130.py; tally-ingest: server/tally-cloud/openings130_test.ts.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the openings held
create table if not exists public.tally_openings_held (
  id          bigserial primary key,
  book_id     uuid not null references public.tally_books(book_id) on delete restrict,
  firm_id     uuid not null,
  source      text not null,
  round       text,
  openings_at date,
  rows        jsonb not null default '[]'::jsonb,
  stage       text not null default 'pending' check (stage in ('pending', 'applied', 'held', 'kept')),
  why         text not null default '',
  diff        numeric(18,2),
  at          timestamptz not null default now(),
  settled_at  timestamptz
);
create index if not exists tally_openings_held_round on public.tally_openings_held (book_id, round, stage);
alter table public.tally_openings_held enable row level security;
revoke all on public.tally_openings_held from public, anon, authenticated;
grant select, insert, update on public.tally_openings_held to service_role;
revoke all on sequence public.tally_openings_held_id_seq from public, anon, authenticated;
grant usage, select on sequence public.tally_openings_held_id_seq to service_role;

-- ---------------------------------------------------------------- 2. an amount in words' figures
create or replace function public.tally_inr(p numeric)
returns text language plpgsql immutable set search_path = public, pg_temp as $function$
declare a numeric := abs(round(coalesce(p, 0), 2)); i text := trunc(a)::text; d text := lpad(((a - trunc(a)) * 100)::int::text, 2, '0'); g text;
begin
  g := right(i, 3); i := left(i, greatest(length(i) - 3, 0));
  while length(i) > 0 loop g := right(i, 2) || ',' || g; i := left(i, greatest(length(i) - 2, 0)); end loop;
  return g || '.' || d || case when coalesce(p, 0) < 0 then ' Dr' when coalesce(p, 0) > 0 then ' Cr' else '' end;
end $function$;
revoke all on function public.tally_inr(numeric) from public, anon, authenticated;
grant execute on function public.tally_inr(numeric) to service_role;

-- ---------------------------------------------------------------- 3. the book's openings, now and with rows in place
-- the stored opening of a ledger is open_sent (as Tally gave it; tally_year_openings moves income and expense openings to
-- Profit & Loss A/c in open), else open; the live ledgers only. rows: [[name, opening]], the names as tally_ledgers keeps them
create or replace function public.tally_openings_candidate(p_book uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare stored numeric; nonzero int; cand numeric; changed int;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  with inc as (
    select distinct on (x->>0) x->>0 as name, round(coalesce(nullif(x->>1, '')::numeric, 0), 2) as op
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where coalesce(x->>0, '') <> '' order by x->>0
  ), live as (
    select l.name, coalesce(l.open_sent, l.open, 0) as op from tally_ledgers l where l.book_id = p_book and l.deleted_at is null
  )
  select (select coalesce(sum(op), 0) from live), (select count(*) from live where op <> 0),
         (select coalesce(sum(coalesce(i.op, v.op)), 0) from live v left join inc i on i.name = v.name)
           + (select coalesce(sum(i.op), 0) from inc i where not exists (select 1 from live v where v.name = i.name)),
         (select count(*) from inc i left join live v on v.name = i.name where v.name is null and i.op <> 0 or v.op is distinct from i.op and v.name is not null)
    into stored, nonzero, cand, changed;
  return jsonb_build_object('stored', stored, 'nonzero', nonzero, 'storedTies', nonzero > 0 and abs(stored) <= 1,
    'candidate', cand, 'candidateTies', abs(cand) <= 1, 'changed', changed);
end $function$;
revoke all on function public.tally_openings_candidate(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_openings_candidate(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- 4. a set of openings held (and, when held, the alert)
create or replace function public.tally_openings_hold(p_book uuid, p_source text, p_round text, p_openings_at date, p_rows jsonb, p_stage text, p_diff numeric)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; cl text; src text := left(coalesce(nullif(btrim(p_source), ''), 'Tally'), 120); hid bigint; words text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_stage not in ('held', 'kept') then raise exception 'stage is held or kept'; end if;
  select firm_id, client_id into f, cl from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  insert into tally_openings_held (book_id, firm_id, source, round, openings_at, rows, stage, why, diff, settled_at)
  values (p_book, f, src, left(p_round, 80), p_openings_at, coalesce(p_rows, '[]'::jsonb), p_stage,
          case when p_stage = 'held' then 'they do not add up to nil' else 'an undated read never changes openings that add up to nil' end, p_diff, now())
  returning id into hid;
  if p_stage = 'held' then
    words := 'Opening balances from ' || src || ' do not add up to nil: ' || tally_inr(p_diff);
    -- one row a day for the same source and difference (tally_alerts_once is per firm, kind, book, device and day: a
    -- digest of the source and the difference stands in for the device, as migration 122's notices do); a retry of the
    -- same file adds none; the firm's members read it in the bell
    insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
    values (f, cl, p_book, md5('tally_openings_held:' || p_book || ':' || src || ':' || coalesce(p_diff, 0)::text)::uuid, 'summary', (now() at time zone 'Asia/Kolkata')::date, words,
            jsonb_build_object('openingsHeld', hid, 'difference', p_diff, 'source', src, 'round', p_round, 'openingsAt', p_openings_at))
    on conflict do nothing;
  end if;
  return hid;
end $function$;
revoke all on function public.tally_openings_hold(uuid, text, text, date, jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.tally_openings_hold(uuid, text, text, date, jsonb, text, numeric) to service_role;

-- ---------------------------------------------------------------- 5. a round's batch, pending
create or replace function public.tally_openings_stage(p_book uuid, p_round text, p_source text, p_openings_at date, p_rows jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; hid bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_round), '') = '' then raise exception 'a round is needed'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  insert into tally_openings_held (book_id, firm_id, source, round, openings_at, rows, stage)
  values (p_book, f, left(coalesce(nullif(btrim(p_source), ''), 'Tally'), 120), left(p_round, 80), p_openings_at, coalesce(p_rows, '[]'::jsonb), 'pending')
  returning id into hid;
  return hid;
end $function$;
revoke all on function public.tally_openings_stage(uuid, text, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.tally_openings_stage(uuid, text, text, date, jsonb) to service_role;

-- ---------------------------------------------------------------- 6. the round settled, on its last batch
create or replace function public.tally_openings_settle(p_book uuid, p_round text, p_source text, p_openings_at date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare rws jsonb; c jsonb; n int; hid bigint; ids bigint[];
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select array_agg(id order by id) into ids from tally_openings_held where book_id = p_book and round = left(p_round, 80) and stage = 'pending';
  if ids is null then return jsonb_build_object('ok', true, 'settled', 'nothing pending'); end if;
  -- the round's openings, the last batch's for a name sent twice
  select coalesce(jsonb_agg(jsonb_build_array(name, op) order by name), '[]'::jsonb) into rws from (
    select distinct on (x->>0) x->>0 as name, x->>1 as op
      from tally_openings_held h, jsonb_array_elements(h.rows) with ordinality as e(x, k)
     where h.id = any(ids) and coalesce(x->>0, '') <> '' order by x->>0, h.id desc, k desc) s;
  c := tally_openings_candidate(p_book, rws);
  if (c->>'changed')::int = 0 then
    update tally_openings_held set stage = 'applied', why = 'no opening changed', settled_at = now() where id = any(ids);
    return jsonb_build_object('ok', true, 'settled', 'applied', 'changed', 0) || jsonb_build_object('check', c);
  end if;
  if not (c->>'candidateTies')::boolean then
    -- (a) they would not add up to nil: the stored openings stay; the incoming are held, with one alert
    hid := tally_openings_hold(p_book, p_source, p_round, p_openings_at, rws, 'held', (c->>'candidate')::numeric);
    update tally_openings_held set stage = 'held', why = 'part of the round held in row ' || hid, settled_at = now() where id = any(ids);
    return jsonb_build_object('ok', true, 'settled', 'held', 'held', hid, 'difference', (c->>'candidate')::numeric, 'check', c);
  end if;
  if (c->>'storedTies')::boolean and p_openings_at is null then
    -- (c) the stored openings tie and this round is undated (a bridge before 2.5.0): openings never changed by it
    hid := tally_openings_hold(p_book, p_source, p_round, p_openings_at, rws, 'kept', (c->>'candidate')::numeric);
    update tally_openings_held set stage = 'kept', why = 'part of the round kept in row ' || hid, settled_at = now() where id = any(ids);
    return jsonb_build_object('ok', true, 'settled', 'kept', 'kept', hid, 'check', c);
  end if;
  -- taken: each ledger's opening as sent (open_sent) and open; the year's openings worked out again
  with inc as (select x->>0 as name, round(coalesce(nullif(x->>1, '')::numeric, 0), 2) as op from jsonb_array_elements(rws) x)
  update tally_ledgers l set open = i.op, open_sent = i.op
    from inc i where l.book_id = p_book and l.name = i.name and coalesce(l.open_sent, l.open) is distinct from i.op;
  get diagnostics n = row_count;
  update tally_openings_held set stage = 'applied', why = n || ' opening(s) changed', settled_at = now() where id = any(ids);
  perform public.tally_year_openings(p_book);
  return jsonb_build_object('ok', true, 'settled', 'applied', 'changed', n, 'check', c);
end $function$;
revoke all on function public.tally_openings_settle(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.tally_openings_settle(uuid, text, text, date) to service_role;

commit;
