-- migration-98-period-pull.sql (21-Oct-2026, FinCom Bridge 2.4.5, ROUND 102, branch next-245; NOT run on staging: the
-- owner runs it). Older entries from Tally ONLY for a period the person chooses (the owner's change and decisions of
-- 21-Oct-2026): a financial year, or a half-year (Apr-Sep / Oct-Mar) once the year is counted at more than 20,000
-- vouchers; never a blanket fetch. The bridge counts the year one day at a time (FinComDayHeads), then brings in the entries
-- FinCom lacks for the part chosen, idle only. Progress "8,412 of 12,960 vouchers (65%) · 4,548 left": the count built day
-- by day; a day is done when FinCom holds every entry Tally lists for it (each at the same or a higher AlterID).
--   tally_period_pulls     the person's choice, one a book (the year, the part, going or paused)
--   tally_period_days      per day: Tally's count and heads as last listed, FinCom's count of them, done, "upload by hand"
--   tally_ledger_progress  the ledger read's progress for Connect Tally's step 5 ("312 of 1,240 ledgers")
-- Functions: for the app (signed in, the firm's own books): tally_period_choose, tally_period_pause, tally_period_status;
-- for tally-ingest (service role only): tally_period_next, tally_period_heads, tally_period_upload, tally_period_entries,
-- tally_ledger_progress_save, tally_period_stop; the owner's tally_device_period_fetch with three new columns of
-- tally_devices (ROUND 103: reading older entries switched on per computer, default off) and tally_device_period_night with
-- five more (ROUND 103, the owner's decision of 21-Oct-2026, evening: office hours per computer, 20:00-08:00 IST and Sunday
-- by default; outside them up to 30 days an answer). Add-only: three new tables, sixteen new functions (five helpers nobody
-- may call), eight columns added to tally_devices, no existing function, table or row changed;
-- every new table with its own grants (ROUND 101: service_role only; the app reads through the functions). One transaction,
-- lock_timeout 10 s, safe twice. Tested by tests/run_migration98.py. Deploy order: 98, then the tally-ingest of next-245
-- (without 98 that tally-ingest says nothing of older entries and the beat goes on as before).
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the tables
create table if not exists public.tally_period_pulls (
  book_id    uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id    uuid not null,
  fy_start   date not null check (extract(month from fy_start) = 4 and extract(day from fy_start) = 1),
  part       text not null default 'year' check (part in ('year', 'h1', 'h2')),
  state      text not null default 'going' check (state in ('going', 'paused', 'stopped')),
  chosen_by  uuid,
  chosen_at  timestamptz not null default now(),
  paused_at  timestamptz,
  -- ROUND 103 (1b): stopped by the bridge (a day's list over 2 s, or Tally's window held over 2 s): never listed again
  -- until the person chooses again; one quiet line
  stopped_at timestamptz,
  stop_day   date,
  stop_why   text check (stop_why is null or length(stop_why) <= 40),
  stop_words text check (stop_words is null or length(stop_words) <= 300),
  -- ROUND 103 (the owner's decision of 21-Oct-2026, evening): the pace FinCom last handed days out at (night: outside
  -- the computer's office hours, up to 30 days an answer; day: 3), for the status line's time left
  pace       text check (pace is null or pace in ('day', 'night')),
  pace_at    timestamptz
);
create table if not exists public.tally_period_days (
  book_id      uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id      uuid not null,
  day          date not null,
  tally_n      integer check (tally_n between 0 and 100000),     -- Tally's count of the day (null: not counted yet)
  held_n       integer not null default 0 check (held_n >= 0),   -- of those, FinCom holds (the same or a higher AlterID)
  heads        jsonb,                                             -- [[guid, masterId, alterId, type], ...] as Tally listed them
  via          text check (via in ('day', 'split')),
  counted_at   timestamptz,
  done_at      timestamptz,                                       -- FinCom holds every entry Tally lists for the day
  asked_at     timestamptz,                                       -- last handed to a bridge
  upload_at    timestamptz,                                       -- to be uploaded by hand (never asked of Tally again)
  upload_why   text check (upload_why is null or length(upload_why) <= 40),
  upload_type  text check (upload_type is null or length(upload_type) <= 100),
  upload_words text check (upload_words is null or length(upload_words) <= 300),
  seen         jsonb not null default '{}'::jsonb,                -- {guid: alterId}: entries Tally gave that FinCom keeps no entry
                                                                  -- of (no ledger line: a stock journal, a delivery note); held
  primary key (book_id, day)
);
create table if not exists public.tally_ledger_progress (
  book_id    uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id    uuid not null,
  round      text not null default '' check (length(round) <= 64),
  read       integer not null default 0 check (read between 0 and 10000000),
  of         integer not null default 0 check (of between 0 and 10000000),
  done       boolean not null default false,
  at         timestamptz not null default now(),
  device_id  uuid
);
-- (a stand that ran an earlier copy of this file gets the two pace columns too)
alter table public.tally_period_pulls add column if not exists pace text check (pace is null or pace in ('day', 'night'));
alter table public.tally_period_pulls add column if not exists pace_at timestamptz;
alter table public.tally_period_pulls enable row level security;
alter table public.tally_period_days enable row level security;
alter table public.tally_ledger_progress enable row level security;
-- ROUND 101: each new table's own grants. The service role (tally-ingest) reads and writes; the app reads through the
-- functions below (security definer, the firm's own books only), so no grant to authenticated or anon
grant select, insert, update, delete on public.tally_period_pulls to service_role;
grant select, insert, update, delete on public.tally_period_days to service_role;
grant select, insert, update, delete on public.tally_ledger_progress to service_role;

-- ---------------------------------------------------------------- 2. helpers (granted to nobody)
-- the financial year's last day and the part's days
create or replace function public.tally_period_range(p_fy date, p_part text, out d_from date, out d_to date)
language sql immutable security definer set search_path = public, pg_temp as $function$
  select case p_part when 'h2' then (p_fy + interval '6 months')::date else p_fy end,
         case p_part when 'h1' then (p_fy + interval '6 months' - interval '1 day')::date else (p_fy + interval '1 year' - interval '1 day')::date end
$function$;

-- the heads of a day FinCom holds (each GUID live in tally_vouchers at the same or a higher AlterID, or seen: given by Tally
-- at that AlterID and not an accounting entry FinCom keeps): how many, and the MasterIDs it lacks (at most p_max)
create or replace function public.tally_period_held(p_book uuid, p_heads jsonb, p_max integer, p_seen jsonb, out held integer, out want jsonb)
language sql stable security definer set search_path = public, pg_temp as $function$
  with h as (
    select x->>0 as guid, x->>1 as mid, case when coalesce(x->>2, '') ~ '^[0-9]{1,15}$' then (x->>2)::bigint else 0 end as alt
      from jsonb_array_elements(coalesce(p_heads, '[]'::jsonb)) x
     where jsonb_typeof(x) = 'array'),
  k as (
    select h.*, (exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = h.guid and v.deleted_at is null and coalesce(v.alter_id, 0) >= h.alt)
                 or (coalesce(p_seen->>h.guid, '') ~ '^[0-9]{1,15}$' and (p_seen->>h.guid)::bigint >= h.alt)) as have from h)
  select (select count(*)::int from k where have),
         coalesce((select jsonb_agg(m) from (select mid as m from k where not have and mid ~ '^[0-9]{1,18}$' order by mid::numeric limit greatest(p_max, 0)) z), '[]'::jsonb)
$function$;

-- the year is counted (every day up to today, or marked to upload) at more than 20,000 vouchers
create or replace function public.tally_period_half(p_book uuid, p_fy date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  with y as (select p_fy as a, least((p_fy + interval '1 year' - interval '1 day')::date, (now() at time zone 'Asia/Kolkata')::date) as z)
  select (select count(*) from tally_period_days d, y where d.book_id = p_book and d.day between y.a and y.z and (d.tally_n is not null or d.upload_at is not null))
           >= (select greatest(0, z - a + 1) from y)
     and (select coalesce(sum(d.tally_n), 0) from tally_period_days d, y where d.book_id = p_book and d.day between y.a and y.z) > 20000
$function$;

-- the period's status (the bar): y, the entries Tally lists for the part's counted days; x, those FinCom holds; the year's
-- count; the days to upload by hand; the ledger progress
create or replace function public.tally_period_status_of(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare p tally_period_pulls%rowtype; r record; fy_to date; y bigint; x bigint; ydays int; cdays int; pdays int; pcount int; fyn bigint; up jsonb; led jsonb; today date := (now() at time zone 'Asia/Kolkata')::date;
  rn bigint; rmin numeric; rate int; cn bigint; cmin numeric; crate numeric; eta int;
begin
  select coalesce(jsonb_build_object('read', read, 'of', greatest(of, read), 'done', done, 'at', at, 'round', round), 'null'::jsonb) into led from tally_ledger_progress where book_id = p_book;
  select * into p from tally_period_pulls where book_id = p_book;
  if not found then
    return jsonb_build_object('ok', true, 'pull', null, 'ledger', led);
  end if;
  select d_from, d_to into r from tally_period_range(p.fy_start, p.part);
  fy_to := (p.fy_start + interval '1 year' - interval '1 day')::date;
  ydays := greatest(0, least(fy_to, today) - p.fy_start + 1);
  pdays := greatest(0, least(r.d_to, today) - r.d_from + 1);
  select count(*), coalesce(sum(tally_n), 0) into cdays, fyn from tally_period_days d
   where d.book_id = p_book and d.day between p.fy_start and least(fy_to, today) and (d.tally_n is not null or d.upload_at is not null);
  -- a day marked "upload" counts as looked at (review 245 R1: else the period was never done); its entries are not in y
  select count(*), coalesce(sum(d.tally_n) filter (where d.upload_at is null), 0),
         coalesce(sum(case when d.done_at is not null then d.tally_n else least(d.held_n, d.tally_n) end) filter (where d.upload_at is null), 0)
    into pcount, y, x from tally_period_days d
   where d.book_id = p_book and d.day between r.d_from and least(r.d_to, today) and (d.tally_n is not null or d.upload_at is not null);
  -- ROUND 103: the speed of the last 30 minutes (entries of the part's days done, a minute; days counted, a minute), from
  -- when those days were handed out; at least 2 minutes measured, else no time left is shown
  select coalesce(sum(d.tally_n), 0), extract(epoch from now() - min(coalesce(d.asked_at, d.counted_at))) / 60 into rn, rmin from tally_period_days d
   where d.book_id = p_book and d.day between r.d_from and least(r.d_to, today) and d.upload_at is null and d.done_at > now() - interval '30 minutes';
  select count(*), extract(epoch from now() - min(coalesce(d.asked_at, d.counted_at))) / 60 into cn, cmin from tally_period_days d
   where d.book_id = p_book and d.day between p.fy_start and least(fy_to, today) and d.counted_at > now() - interval '30 minutes';
  rate := case when rmin >= 2 and rn > 0 then round(rn / rmin)::int end;
  crate := case when cmin >= 2 and cn > 0 then cn / cmin end;
  eta := case when p.state <> 'going' then null
              when cdays < ydays then case when crate > 0 then ceil((ydays - cdays) / crate)::int end
              when rate > 0 then ceil(greatest(y - least(x, y), 0)::numeric / rate)::int end;
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYYMMDD'), 'words', d.upload_words, 'why', d.upload_why) order by d.day), '[]'::jsonb) into up
    from tally_period_days d where d.book_id = p_book and d.day between p.fy_start and fy_to and d.upload_at is not null;
  return jsonb_build_object('ok', true, 'ledger', led, 'pull', jsonb_build_object(
    'fy', to_char(p.fy_start, 'YYYYMMDD'), 'part', p.part, 'state', p.state, 'from', to_char(r.d_from, 'YYYYMMDD'), 'to', to_char(r.d_to, 'YYYYMMDD'),
    'yearDays', ydays, 'countedDays', cdays, 'counting', cdays < ydays, 'yearVouchers', fyn,
    'half', cdays >= ydays and fyn > 20000,     -- the owner's decision of 21-Oct-2026: half-years offered above 20,000 vouchers a year
    'partDays', pdays, 'partCounted', pcount, 'y', y, 'x', least(x, y), 'left', greatest(y - x, 0),
    'done', p.state <> 'stopped' and cdays >= ydays and pcount >= pdays and x >= y and pdays > 0,
    'upload', up, 'chosenAt', p.chosen_at,
    'pace', case when p.pace_at > now() - interval '10 minutes' then p.pace end, 'rate', rate, 'etaMin', eta,
    'stopped', case when p.state = 'stopped' then jsonb_build_object('day', to_char(p.stop_day, 'YYYYMMDD'), 'words', p.stop_words, 'why', p.stop_why, 'at', p.stopped_at,
      'from', to_char(r.d_from, 'YYYYMMDD'), 'to', to_char(least(r.d_to, today), 'YYYYMMDD')) end));
end $function$;

-- ---------------------------------------------------------------- 3. the app (the firm's own books; owner or staff to change)
create or replace function public.tally_period_member(p_book uuid, p_change boolean) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b uuid;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into b from tally_books where book_id = p_book;
  if b is null or b <> f then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_change and not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role in ('owner', 'staff')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return f;
end $function$;

create or replace function public.tally_period_choose(p_book uuid, p_fy_start date, p_part text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_period_member(p_book, true); today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_fy_start is null or extract(month from p_fy_start) <> 4 or extract(day from p_fy_start) <> 1 or p_fy_start > today or p_fy_start < date '2000-04-01' then
    return jsonb_build_object('ok', false, 'error', 'Choose a financial year that has begun (April to March).');
  end if;
  if coalesce(p_part, '') not in ('year', 'h1', 'h2') then
    return jsonb_build_object('ok', false, 'error', 'Choose the whole year, April to September, or October to March.');
  end if;
  -- half-years only once the year is counted at more than 20,000 vouchers (the owner's decision of 21-Oct-2026)
  if p_part <> 'year' and not tally_period_half(p_book, p_fy_start) then
    return jsonb_build_object('ok', false, 'error', 'Half-years are offered once the year is counted at more than 20,000 vouchers.', 'status', tally_period_status_of(p_book));
  end if;
  insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_by) values (p_book, f, p_fy_start, p_part, 'going', auth.uid())
  on conflict (book_id) do update set fy_start = excluded.fy_start, part = excluded.part, state = 'going', paused_at = null, chosen_by = excluded.chosen_by, chosen_at = now(),
    stopped_at = null, stop_day = null, stop_why = null, stop_words = null;
  return tally_period_status_of(p_book);
end $function$;

create or replace function public.tally_period_pause(p_book uuid, p_pause boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_period_member(p_book, true);
begin
  -- a period the bridge stopped (ROUND 103) is never restarted by Resume: only a fresh choice (tally_period_choose) starts it
  update tally_period_pulls set state = case when p_pause then 'paused' else 'going' end, paused_at = case when p_pause then now() end where book_id = p_book and state <> 'stopped';
  return tally_period_status_of(p_book);
end $function$;

create or replace function public.tally_period_status(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if not tally_service_or_owner() then perform tally_period_member(p_book, false); end if;
  return tally_period_status_of(p_book);
end $function$;

-- ---------------------------------------------------------------- 4. tally-ingest (service role only)
-- the next days for a bridge (at most p_max, 3): while the year is being counted, the days not counted (newest first,
-- fetch false); then the part's days counted and not done (newest first, fetch true). Never a day marked "upload", never a
-- day after today. Days handed out in the last 2 minutes come after the others (review 245 R2: a day that does not end
-- never holds the rest back; the bridge finishes the day it is reading though the next answer lists others first). A day of a month locked in FinCom is not fetched: marked to upload (unlock, then upload).
-- Types for a split: Tally's six standard ones first, then every type the book's entries and Tally's day lists name, the
-- most used first (at most 40; never one with a quote mark)
create or replace function public.tally_period_next(p_book uuid, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare p tally_period_pulls%rowtype; r record; fy_to date; today date := (now() at time zone 'Asia/Kolkata')::date; out jsonb := '[]'::jsonb; d date; n int := 0;
  types jsonb; fetch boolean := false; lim int := least(greatest(coalesce(p_max, 3), 0), 30);
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  if not found or p.state <> 'going' or lim = 0 then return out; end if;
  -- ROUND 103 (the owner's decision of 21-Oct-2026, evening): tally-ingest asks 3 by day, up to 30 outside the computer's
  -- office hours; the pace kept for the status line
  update tally_period_pulls set pace = case when lim > 3 then 'night' else 'day' end, pace_at = now() where book_id = p_book;
  fy_to := (p.fy_start + interval '1 year' - interval '1 day')::date;
  select d_from, d_to into r from tally_period_range(p.fy_start, p.part);
  -- counting: the year's days with no count yet
  for d in select g::date from generate_series(least(fy_to, today), p.fy_start, interval '-1 day') g
            where not exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date and (x.tally_n is not null or x.upload_at is not null))
            order by exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date and x.asked_at > now() - interval '2 minutes'), g desc
            limit lim loop
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', false, 'chosenAt', p.chosen_at));
    n := n + 1;
  end loop;
  if n = 0 and not exists (select 1 from generate_series(least(fy_to, today), p.fy_start, interval '-1 day') g
                            where not exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date and (x.tally_n is not null or x.upload_at is not null))) then
    -- the year is counted: the part's days FinCom does not hold whole; a locked month's days marked to upload, not fetched
    update tally_period_days x set upload_at = now(), upload_why = 'locked',
           upload_words = 'FinCom did not bring in ' || to_char(x.day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month, then upload that day''s Day Book.'
     where x.book_id = p_book and x.day between r.d_from and least(r.d_to, today) and x.tally_n > 0 and x.done_at is null and x.upload_at is null
       and tally_month_locked(p_book, array[x.day]) is not null;
    for d in select x.day from tally_period_days x
              where x.book_id = p_book and x.day between r.d_from and least(r.d_to, today) and x.tally_n > 0 and x.done_at is null and x.upload_at is null
              order by (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit lim loop
      out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', p.chosen_at));
      n := n + 1;
    end loop;
  end if;
  if n > 0 then
    -- the types (only when a day is listed): the six first, then the book's own, the most used first
    select coalesce(jsonb_agg(t order by o, c desc, t), '[]'::jsonb) into types from (
      select t, min(o) as o, sum(c) as c from (
        select unnest(array['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra']) as t, 0 as o, 0::bigint as c
        union all select v.vtype, 1, count(*) from tally_vouchers v where v.book_id = p_book group by v.vtype
        union all select h->>3, 1, count(*) from tally_period_days x, jsonb_array_elements(coalesce(x.heads, '[]'::jsonb)) h
                   where x.book_id = p_book and x.day between p.fy_start and fy_to and jsonb_typeof(h) = 'array' group by h->>3) a
       where t is not null and t <> '' and t !~ '["[:cntrl:]]' and length(t) <= 60 and t = btrim(t)
       group by t order by min(o), sum(c) desc, t limit 40) z;
    select coalesce(jsonb_agg(e || jsonb_build_object('types', types)), '[]'::jsonb) into out from jsonb_array_elements(out) e;
    insert into tally_period_days (book_id, firm_id, day, asked_at)
    select p_book, p.firm_id, to_date(e->>'day', 'YYYYMMDD'), now() from jsonb_array_elements(out) e
    on conflict (book_id, day) do update set asked_at = now();
  end if;
  return out;
end $function$;

-- a day's heads from Tally: its count kept (a day of the year chosen only), FinCom's count of them, the MasterIDs it lacks
-- (at most 2,000 a call; the rest at the next turn)
create or replace function public.tally_period_heads(p_book uuid, p_day date, p_heads jsonb, p_via text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare p tally_period_pulls%rowtype; n int; h record; fy_to date;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  fy_to := (p.fy_start + interval '1 year' - interval '1 day')::date;
  -- review 245 R3: only while the pull goes (paused: refused in words, so the bridge leaves the day at once)
  if not found or p.state <> 'going' or p_day is null or p_day < p.fy_start or p_day > fy_to or p_day > (now() at time zone 'Asia/Kolkata')::date then
    return jsonb_build_object('ok', false, 'error', 'FinCom did not ask for this day');
  end if;
  if jsonb_typeof(coalesce(p_heads, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_heads) > 100000 then
    return jsonb_build_object('ok', false, 'error', 'the day''s list is not a list');
  end if;
  n := jsonb_array_length(p_heads);
  select * into h from tally_period_held(p_book, p_heads, 2000, coalesce((select x.seen from tally_period_days x where x.book_id = p_book and x.day = p_day), '{}'::jsonb));
  insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at, done_at)
  values (p_book, p.firm_id, p_day, n, h.held, p_heads, case when p_via = 'split' then 'split' else 'day' end, now(), case when h.held >= n then now() end)
  on conflict (book_id, day) do update set tally_n = excluded.tally_n, held_n = excluded.held_n, heads = excluded.heads, via = excluded.via, counted_at = now(),
    done_at = case when excluded.held_n >= excluded.tally_n then coalesce(tally_period_days.done_at, now()) end
    where tally_period_days.upload_at is null;
  return jsonb_build_object('ok', true, 'n', n, 'held', h.held, 'done', h.held >= n, 'want', h.want);
end $function$;

-- a day Tally could not give within 2 s even one voucher type at a time (or whose answer carried another date): to be
-- uploaded by hand, never asked again; the one quiet line
create or replace function public.tally_period_upload(p_book uuid, p_day date, p_why text, p_type text, p_words text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_period_pulls where book_id = p_book;
  if f is null or p_day is null then return jsonb_build_object('ok', false, 'error', 'FinCom did not ask for this day'); end if;
  insert into tally_period_days (book_id, firm_id, day, upload_at, upload_why, upload_type, upload_words)
  values (p_book, f, p_day, now(), left(coalesce(p_why, ''), 40), nullif(left(coalesce(p_type, ''), 100), ''),
          left(coalesce(nullif(p_words, ''), 'Please upload the Day Book of ' || to_char(p_day, 'DD-Mon-YYYY') || '.'), 300))
  on conflict (book_id, day) do update set upload_at = coalesce(tally_period_days.upload_at, now()), upload_why = excluded.upload_why, upload_type = excluded.upload_type, upload_words = excluded.upload_words;
  return jsonb_build_object('ok', true);
end $function$;

-- the entries FinCom lacked, read from Tally by FinComVoucherObject (parsed by tally-ingest as a Day Book's entries): each
-- dated the day, a locked month refused, an entry FinCom holds at a higher AlterID left as it is; stored through the one
-- entry path (as the Day Book's, p_keep false); then the day counted again from its heads
create or replace function public.tally_period_entries(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_seen jsonb, p_gone jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d tally_period_days%rowtype; pp tally_period_pulls%rowtype; pr record; lk date; vs jsonb; ls jsonb; g text[]; stale int; res jsonb; h record; sn jsonb := '{}'::jsonb; hd jsonb; k text; w text;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from tally_period_days where book_id = p_book and day = p_day;
  if not found or d.heads is null then return jsonb_build_object('ok', false, 'error', 'FinCom did not ask for this day'); end if;
  -- review 245 R3: only while the pull goes, for a day of the part chosen
  select * into pp from tally_period_pulls where book_id = p_book;
  if not found or pp.state <> 'going' then return jsonb_build_object('ok', false, 'error', 'FinCom did not ask for this day'); end if;
  select d_from, d_to into pr from tally_period_range(pp.fy_start, pp.part);
  if p_day < pr.d_from or p_day > pr.d_to then return jsonb_build_object('ok', false, 'error', 'FinCom did not ask for this day'); end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_vouchers, '[]'::jsonb)) v where coalesce(v->>'day', '') <> to_char(p_day, 'YYYY-MM-DD')) then
    return jsonb_build_object('ok', false, 'error', 'an entry of another date');
  end if;
  lk := tally_month_locked(p_book, array[p_day]);
  if lk is not null then
    -- review 245 R1: never fetched again; the one quiet line asks for the day to be uploaded once the month is unlocked
    w := 'FinCom did not bring in ' || to_char(p_day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month, then upload that day''s Day Book.';
    update tally_period_days set upload_at = coalesce(upload_at, now()), upload_why = 'locked', upload_words = w where book_id = p_book and day = p_day;
    return jsonb_build_object('ok', true, 'locked', true, 'upload', w, 'stored', 0);
  end if;
  -- entries Tally gave that FinCom keeps no entry of (no ledger line): held as seen at their AlterID
  for k in select jsonb_object_keys(coalesce(case when jsonb_typeof(p_seen) = 'object' then p_seen end, '{}'::jsonb)) loop
    if length(k) between 1 and 100 and coalesce(p_seen->>k, '') ~ '^[0-9]{1,15}$' then sn := sn || jsonb_build_object(k, (p_seen->>k)::bigint); end if;
  end loop;
  -- MasterIDs Tally gave no entry for (p_gone): NOT taken out of the day's list (review 245 R2: one empty answer is no
  -- proof); a day whose entry is really gone ends when it is counted again (its fresh list no longer names it)
  hd := d.heads;
  -- an entry FinCom holds at a higher AlterID than Tally's answer gave: left as it is
  select coalesce(jsonb_agg(v), '[]'::jsonb) into vs from jsonb_array_elements(coalesce(p_vouchers, '[]'::jsonb)) v
   where not exists (select 1 from tally_vouchers t where t.book_id = p_book and t.guid = v->>'guid' and coalesce(t.alter_id, 0) > coalesce((v->>'alter')::bigint, 0));
  stale := jsonb_array_length(coalesce(p_vouchers, '[]'::jsonb)) - jsonb_array_length(vs);
  select coalesce(array_agg(v->>'guid'), '{}') into g from jsonb_array_elements(vs) v;
  select coalesce(jsonb_agg(l), '[]'::jsonb) into ls from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l where l->>0 = any(g);
  if jsonb_array_length(vs) > 0 then
    res := tally_ingest_entries(p_book, vs, ls, true, false);
    if not coalesce((res->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', coalesce(res->>'error', 'not stored'), 'locked', coalesce((res->>'locked')::boolean, false));
    end if;
  end if;
  select * into h from tally_period_held(p_book, hd, 0, d.seen || sn);
  -- (the heads and the count are the latest tally_period_heads stored; only FinCom's side is written here)
  update tally_period_days set seen = seen || sn, held_n = h.held,
         done_at = case when h.held >= coalesce(tally_n, 0) then coalesce(done_at, now()) end where book_id = p_book and day = p_day;
  return jsonb_build_object('ok', true, 'stored', jsonb_array_length(vs), 'stale', stale, 'n', jsonb_array_length(hd), 'held', h.held, 'done', h.held >= jsonb_array_length(hd));
end $function$;

-- the ledger read's progress: never back within a round; "of" never below "read"
create or replace function public.tally_ledger_progress_save(p_book uuid, p_round text, p_read integer, p_of integer, p_done boolean, p_device uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rd int := least(greatest(coalesce(p_read, 0), 0), 10000000); o int := least(greatest(coalesce(p_of, 0), 0), 10000000);
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  insert into tally_ledger_progress (book_id, firm_id, round, read, of, done, at, device_id)
  values (p_book, f, left(coalesce(p_round, ''), 64), rd, greatest(o, rd), coalesce(p_done, false), now(), p_device)
  on conflict (book_id) do update set
    read = case when tally_ledger_progress.round = excluded.round and not excluded.done then greatest(tally_ledger_progress.read, excluded.read) else excluded.read end,
    of = greatest(excluded.of, case when tally_ledger_progress.round = excluded.round and not excluded.done then greatest(tally_ledger_progress.read, excluded.read) else excluded.read end),
    round = excluded.round, done = excluded.done or (tally_ledger_progress.round = excluded.round and tally_ledger_progress.done), at = now(), device_id = excluded.device_id;
  return jsonb_build_object('ok', true);
end $function$;

-- ROUND 103 (1b): the bridge stopped the period for this book (a day's list over 2 s, or Tally's window held over 2 s):
-- nothing more is listed until the person chooses again; the one quiet line asks for the Day Book of the days missing
create or replace function public.tally_period_stop(p_book uuid, p_day date, p_why text, p_words text, p_chosen_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  -- review 103: only the choice the bridge was reading (a newer choice is never stopped by an older stop), and only a
  -- day of that financial year
  update tally_period_pulls set state = 'stopped', stopped_at = now(), stop_day = p_day, stop_why = left(coalesce(p_why, ''), 40),
         stop_words = left(coalesce(nullif(p_words, ''), 'FinCom stopped reading older entries from Tally. Please upload the Day Book for the days still missing.'), 300)
   where book_id = p_book and state <> 'stopped' and p_chosen_at is not null and chosen_at = p_chosen_at
     and p_day between fy_start and (fy_start + interval '1 year' - interval '1 day')::date;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'stopped', n > 0);
end $function$;

-- ROUND 103 (1c): reading older entries is switched on per computer by an owner (default off): tally_devices.period_fetch
alter table public.tally_devices add column if not exists period_fetch boolean not null default false;
alter table public.tally_devices add column if not exists period_fetch_at timestamptz;
alter table public.tally_devices add column if not exists period_fetch_by uuid;
grant select (period_fetch, period_fetch_at, period_fetch_by) on public.tally_devices to authenticated;
create or replace function public.tally_device_period_fetch(p_device uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); d tally_devices%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can switch reading older entries on or off for a computer' using errcode = '42501'; end if;
  if p_device is null or not exists (select 1 from tally_devices x where x.id = p_device and x.firm_id = f and not coalesce(x.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  if p_on is null then raise exception 'say whether reading older entries is on or off (true or false)'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_device_period_fetch:' || p_device::text));
  update tally_devices set period_fetch = p_on, period_fetch_at = now(), period_fetch_by = auth.uid() where id = p_device and firm_id = f;
  select * into d from tally_devices where id = p_device;
  return jsonb_build_object('ok', true, 'device', p_device, 'periodFetch', d.period_fetch, 'at', d.period_fetch_at, 'by', d.period_fetch_by);
end $function$;

-- ROUND 103 (the owner's decision of 21-Oct-2026, evening): office hours per computer. Outside them (from period_night_from
-- to period_night_to, India's time, and all Sunday when period_night_sunday) tally-ingest hands out up to 30 days an answer
-- instead of 3, so the period is read day after day while Tally is idle. 20:00 to 08:00 and Sunday by default; an owner
-- changes them on FinCom's Tally page (tally_device_period_night); the per-computer switch (period_fetch) still wins
alter table public.tally_devices add column if not exists period_night_from smallint not null default 20 check (period_night_from between 0 and 23);
alter table public.tally_devices add column if not exists period_night_to smallint not null default 8 check (period_night_to between 0 and 23);
alter table public.tally_devices add column if not exists period_night_sunday boolean not null default true;
alter table public.tally_devices add column if not exists period_night_at timestamptz;
alter table public.tally_devices add column if not exists period_night_by uuid;
grant select (period_night_from, period_night_to, period_night_sunday, period_night_at, period_night_by) on public.tally_devices to authenticated;
create or replace function public.tally_device_period_night(p_device uuid, p_from integer, p_to integer, p_sunday boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); d tally_devices%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can set a computer''s office hours' using errcode = '42501'; end if;
  if p_device is null or not exists (select 1 from tally_devices x where x.id = p_device and x.firm_id = f and not coalesce(x.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  if p_from is null or p_to is null or p_from not between 0 and 23 or p_to not between 0 and 23 then
    raise exception 'give the hours from 0 to 23 (India''s time)'; end if;
  if p_sunday is null then raise exception 'say whether all Sunday is outside office hours (true or false)'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_device_period_night:' || p_device::text));
  update tally_devices set period_night_from = p_from, period_night_to = p_to, period_night_sunday = p_sunday, period_night_at = now(), period_night_by = auth.uid()
   where id = p_device and firm_id = f;
  select * into d from tally_devices where id = p_device;
  return jsonb_build_object('ok', true, 'device', p_device, 'from', d.period_night_from, 'to', d.period_night_to, 'sunday', d.period_night_sunday, 'at', d.period_night_at, 'by', d.period_night_by);
end $function$;

-- ---------------------------------------------------------------- 5. who may call
revoke all on function public.tally_period_range(date, text), public.tally_period_held(uuid, jsonb, integer, jsonb), public.tally_period_status_of(uuid), public.tally_period_half(uuid, date),
  public.tally_period_member(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.tally_period_choose(uuid, date, text), public.tally_period_pause(uuid, boolean), public.tally_period_status(uuid) from public, anon;
grant execute on function public.tally_period_choose(uuid, date, text), public.tally_period_pause(uuid, boolean), public.tally_period_status(uuid) to authenticated, service_role;
revoke all on function public.tally_period_next(uuid, integer), public.tally_period_heads(uuid, date, jsonb, text), public.tally_period_upload(uuid, date, text, text, text),
  public.tally_period_entries(uuid, date, jsonb, jsonb, jsonb, jsonb), public.tally_ledger_progress_save(uuid, text, integer, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.tally_period_next(uuid, integer), public.tally_period_heads(uuid, date, jsonb, text), public.tally_period_upload(uuid, date, text, text, text),
  public.tally_period_entries(uuid, date, jsonb, jsonb, jsonb, jsonb), public.tally_ledger_progress_save(uuid, text, integer, integer, boolean, uuid) to service_role;
revoke all on function public.tally_period_stop(uuid, date, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_period_stop(uuid, date, text, text, timestamptz) to service_role;
revoke all on function public.tally_device_period_fetch(uuid, boolean) from public, anon;
grant execute on function public.tally_device_period_fetch(uuid, boolean) to authenticated;
revoke all on function public.tally_device_period_night(uuid, integer, integer, boolean) from public, anon;
grant execute on function public.tally_device_period_night(uuid, integer, integer, boolean) to authenticated;

commit;
