-- migration-133-fetch-check.sql (30-Oct-2026, branch next-fetch-eta-check; NOT run on staging: the owner runs it). The owner,
-- 30-Oct-2026: "there should be two ways.. one is automatically updating books from tally and giving progress bar and timing
-- with that bar.. also if anyone uploads any books and there is any difference.. it should find out the difference in tally
-- and correct it"; "tally should not hang". This supersedes the 26-Oct "upload only" decision. Nothing new is asked of Tally:
-- the upload's days go through the existing older-entries path (FinComDayHeads, then the entries FinCom lacks), on a computer
-- whose period_fetch switch is on, idle only, under every rule the bridge already keeps (2 s stop, one request at a time,
-- postings first, a window held 2 s stops it).
--   tally_check_runs   per book: the check's choice time (the bridge's chosenAt when no period is chosen) and its stop
--   tally_check_days   per day of an upload: Tally's heads as last listed, the entries to remove after a second whole-day
--                      list, what was added / updated / removed, done (same or corrected), or to upload by hand
--   tally_fetch_log    what FinCom brought in or corrected from Tally (older entries, the upload check), for "Today from Tally"
-- Functions: tally-ingest (service role only): tally_check_queue, tally_check_next, tally_check_heads, tally_check_entries,
-- tally_check_stop, tally_period_entries_logged (98's tally_period_entries, each entry it brings in logged); the app (signed
-- in, the firm's own books; owner or staff to change): tally_check_status, tally_check_resume, tally_period_cancel (Stop),
-- tally_today_from_tally, tally_fetch_summary; helpers nobody may call: tally_check_status_of, tally_check_want,
-- tally_today_rows. FinCom's copy is corrected to Tally only: an entry is added or brought up to date through the one entry
-- path (tally_ingest_entries: a version row for each AlterID), an entry Tally no longer lists is soft-deleted through
-- tally_ingest_delete (deleted_at; its version and lines kept) and only when a SECOND whole-day list a minute or more later
-- still lacks it; never a row deleted, never anything sent to Tally.
-- Add-only: three new tables (each with its own grants: service_role only; the app reads through the functions), fourteen
-- new functions, no existing function, table or row changed. One transaction, lock_timeout 10 s, safe twice. Tested by
-- tests/run_migration133.py. Deploy order: 133, then the tally-ingest of this branch (without 133 that tally-ingest says
-- nothing of the check and goes on as before).
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the tables
create table if not exists public.tally_check_runs (
  book_id    uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id    uuid not null,
  chosen_at  timestamptz not null default now(),                   -- the bridge's chosenAt for the check's days (no period chosen)
  state      text not null default 'going' check (state in ('going', 'stopped')),
  stopped_at timestamptz,
  stop_day   date,
  stop_why   text check (stop_why is null or length(stop_why) <= 40),
  stop_words text check (stop_words is null or length(stop_words) <= 300)
);
create table if not exists public.tally_check_days (
  book_id      uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id      uuid not null,
  day          date not null,
  source       text not null default 'upload' check (length(source) <= 20),
  queued_at    timestamptz not null default now(),
  asked_at     timestamptz,                                   -- last handed to a bridge
  first_asked_at timestamptz,
  lists        integer not null default 0 check (lists >= 0),  -- Tally's whole lists of the day taken
  tally_n      integer check (tally_n between 0 and 100000),
  heads        jsonb,                                         -- [[guid, masterId, alterId, type], ...] as Tally last listed them
  via          text check (via in ('day', 'split')),
  listed_at    timestamptz,
  gone1        jsonb,                                         -- GUIDs FinCom holds that the first whole-day list lacked
  gone1_at     timestamptz,
  seen         jsonb not null default '{}'::jsonb,            -- {guid: alterId}: entries Tally gave that FinCom keeps no entry of
  added        integer not null default 0 check (added >= 0),
  updated      integer not null default 0 check (updated >= 0),
  removed      integer not null default 0 check (removed >= 0),
  same         boolean,
  done_at      timestamptz,
  upload_at    timestamptz,
  upload_words text check (upload_words is null or length(upload_words) <= 300),
  primary key (book_id, day)
);
create table if not exists public.tally_fetch_log (
  id      bigserial primary key,
  book_id uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id uuid not null,
  at      timestamptz not null default now(),
  via     text not null check (via in ('older', 'check')),
  what    text not null check (what in ('added', 'changed', 'deleted')),
  guid    text not null check (length(guid) between 1 and 100),
  day     date
);
create index if not exists tally_fetch_log_book_at on public.tally_fetch_log (book_id, at desc);
create index if not exists tally_check_days_open on public.tally_check_days (book_id, day) where done_at is null and upload_at is null;
alter table public.tally_check_runs enable row level security;
alter table public.tally_check_days enable row level security;
alter table public.tally_fetch_log enable row level security;
-- each new table's own grants: the service role (tally-ingest) reads and writes; the app reads through the functions below
grant select, insert, update, delete on public.tally_check_runs to service_role;
grant select, insert, update, delete on public.tally_check_days to service_role;
grant select, insert, update, delete on public.tally_fetch_log to service_role;
grant usage, select on sequence public.tally_fetch_log_id_seq to service_role;

-- ---------------------------------------------------------------- 2. helpers (granted to nobody)
-- the MasterIDs of Tally's heads FinCom does not hold exactly (no live entry of that GUID at that AlterID; an entry Tally gave
-- with no ledger line, seen at that AlterID or later, counts as held), at most 2,000
create or replace function public.tally_check_want(p_book uuid, p_heads jsonb, p_seen jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $function$
  with h as (
    select x->>0 as guid, x->>1 as mid, case when coalesce(x->>2, '') ~ '^[0-9]{1,15}$' then (x->>2)::bigint else 0 end as alt
      from jsonb_array_elements(case when jsonb_typeof(p_heads) = 'array' then p_heads else '[]'::jsonb end) x
     where jsonb_typeof(x) = 'array')
  select coalesce(jsonb_agg(m order by m::numeric), '[]'::jsonb) from (
    select h.mid as m from h
     where h.mid ~ '^[0-9]{1,18}$'
       and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = h.guid and v.deleted_at is null and coalesce(v.alter_id, 0) = h.alt)
       and not (coalesce(p_seen->>h.guid, '') ~ '^[0-9]{1,15}$' and (p_seen->>h.guid)::bigint >= h.alt)
     order by h.mid::numeric limit 2000) z
$function$;

-- the check of a book in plain words: each day's state and words, the counts, the total line, the stop
create or replace function public.tally_check_status_of(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; run jsonb; lines jsonb; c record; per text;
begin
  select * into r from tally_check_runs where book_id = p_book;
  run := case when found then jsonb_build_object('state', r.state, 'why', r.stop_why, 'words', r.stop_words, 'day', to_char(r.stop_day, 'YYYYMMDD'), 'at', r.stopped_at, 'chosenAt', r.chosen_at) end;
  select state into per from tally_period_pulls where book_id = p_book;
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(x.day, 'YYYYMMDD'), 'state', x.st, 'added', x.added, 'updated', x.updated, 'removed', x.removed,
           'words', case x.st when 'upload' then x.upload_words when 'waiting' then 'waiting for Tally' when 'same' then 'the same as Tally'
             else concat_ws(' · ',
               case when x.added > 0 then x.added || case when x.added = 1 then ' entry' else ' entries' end || ' in Tally not in the upload (added)' end,
               case when x.updated > 0 then x.updated || ' changed (updated)' end,
               case when x.removed > 0 then x.removed || ' deleted in Tally (removed, kept in history)' end) end) order by x.day), '[]'::jsonb) into lines
    from (select d.*, case when d.upload_at is not null then 'upload' when d.done_at is null then 'waiting' when d.added + d.updated + d.removed = 0 then 'same' else 'fixed' end as st
            from tally_check_days d where d.book_id = p_book) x;
  select count(*)::int as total, count(*) filter (where done_at is not null and upload_at is null)::int as checked,
         count(*) filter (where done_at is not null and upload_at is null and added + updated + removed = 0)::int as same,
         count(*) filter (where done_at is not null and upload_at is null and added + updated + removed > 0)::int as fixed,
         count(*) filter (where done_at is null and upload_at is null)::int as waiting, count(*) filter (where upload_at is not null)::int as upload,
         coalesce(sum(added), 0)::int as a, coalesce(sum(updated), 0)::int as u, coalesce(sum(removed), 0)::int as m, max(queued_at) as queued
    into c from tally_check_days where book_id = p_book;
  return jsonb_build_object('ok', true, 'run', run, 'period', per, 'total', c.total, 'checked', c.checked, 'same', c.same, 'fixed', c.fixed, 'waiting', c.waiting, 'upload', c.upload,
    'added', c.a, 'updated', c.u, 'removed', c.m, 'queuedAt', c.queued, 'lines', lines,
    'totalWords', 'In all: ' || c.a || ' added · ' || c.u || ' updated · ' || c.m || ' removed');
end $function$;

-- today's rows from Tally (since p_from): the recorder's applied changes (Tally's own saves) and what FinCom brought in or
-- corrected (tally_fetch_log), each with its date, voucher type and number, party and amount; never a computer's name
create or replace function public.tally_today_rows(p_book uuid, p_from timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_agg(jsonb_build_object('at', z.at, 'day', to_char(z.day, 'YYYY-MM-DD'), 'vtype', coalesce(z.vtype, ''), 'vno', coalesce(z.vno, ''), 'party', coalesce(z.party, ''),
           'amount', (select round(sum(abs(l.amount)) / 2, 2) from tally_lines l where l.book_id = p_book and l.guid = z.guid), 'what', z.what, 'via', z.via) order by z.at desc, z.guid), '[]'::jsonb)
    from (
      select coalesce(l.applied_at, l.received_at) as at, coalesce(l.vch_date, v.day) as day, coalesce(nullif(l.vch_type, ''), v.vtype) as vtype, coalesce(nullif(l.vch_no, ''), v.vno) as vno, v.party,
             case l.event when 'created' then 'added' when 'altered' then 'changed' else 'deleted' end as what, 'tally' as via, l.object_guid as guid
        from tally_recorder_lines l left join tally_vouchers v on v.book_id = l.book_id and v.guid = l.object_guid
       where l.book_id = p_book and l.state = 'applied' and l.event in ('created', 'altered', 'deleted', 'cancelled') and coalesce(l.applied_at, l.received_at) >= p_from
      union all
      select g.at, coalesce(g.day, v.day), v.vtype, v.vno, v.party, g.what, g.via, g.guid
        from tally_fetch_log g left join tally_vouchers v on v.book_id = g.book_id and v.guid = g.guid
       where g.book_id = p_book and g.at >= p_from) z
$function$;

-- ---------------------------------------------------------------- 3. tally-ingest (service role only)
-- an upload's days, read into FinCom: queued for the check (again from the start when the same day is uploaded again)
create or replace function public.tally_check_queue(p_book uuid, p_days date[], p_source text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; n int; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  insert into tally_check_runs (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select p_book, f, d, left(coalesce(nullif(p_source, ''), 'upload'), 20), now()
    from (select distinct d from unnest(coalesce(p_days, '{}'::date[])) d where d is not null and d <= today and d >= date '2000-04-01' order by d desc limit 400) x
  on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null, heads = null, via = null,
    listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'queued', n);
end $function$;

-- the next days to check for a bridge (at most p_max): newest first, a day handed out in the last 2 minutes after the others.
-- The choice time is the period's when one is chosen (one stop rule for both: a stop of either stops the bridge's reading of
-- the company until the person goes on), else the check's own. None while the period is paused or stopped, or the check is
-- stopped
create or replace function public.tally_check_next(p_book uuid, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; has_p boolean; ca timestamptz; out jsonb := '[]'::jsonb; d date; lim int := least(greatest(coalesce(p_max, 3), 0), 30);
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from tally_check_runs where book_id = p_book;
  if not found or r.state <> 'going' or lim = 0 then return out; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  has_p := found;
  if has_p and p.state <> 'going' then return out; end if;
  ca := case when has_p then p.chosen_at else r.chosen_at end;
  for d in select x.day from tally_check_days x where x.book_id = p_book and x.done_at is null and x.upload_at is null and x.day <= today
            order by (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit lim loop
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true));
  end loop;
  update tally_check_days x set asked_at = now(), first_asked_at = coalesce(x.first_asked_at, now())
   where x.book_id = p_book and x.day in (select to_date(e->>'day', 'YYYYMMDD') from jsonb_array_elements(out) e);
  return out;
end $function$;

-- Tally's heads of a day being checked: the MasterIDs FinCom does not hold exactly (want); FinCom's live entries of the day
-- Tally does not list (an optional entry never) are removed only on a second WHOLE-day list a minute or more after the first
-- (a list split by voucher type removes nothing); a day with nothing to bring and nothing to remove is done. A day not being
-- checked: {mine: false} (the period's path takes it). Six lists without an end: the day to upload by hand
create or replace function public.tally_check_heads(p_book uuid, p_day date, p_heads jsonb, p_via text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d tally_check_days%rowtype; f uuid; n int; w jsonb; cand jsonb := '[]'::jsonb; g1 jsonb; g1at timestamptz; g text; res jsonb; rem int := 0; done boolean; whole boolean := coalesce(p_via, 'day') <> 'split';
  sn jsonb; locked boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from tally_check_days where book_id = p_book and day = p_day and done_at is null and upload_at is null for update;
  if not found then return jsonb_build_object('ok', true, 'mine', false); end if;
  if jsonb_typeof(coalesce(p_heads, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_heads) > 100000 then
    return jsonb_build_object('ok', false, 'mine', true, 'error', 'the day''s list is not a list');
  end if;
  f := d.firm_id; n := jsonb_array_length(p_heads);
  sn := d.seen || coalesce((select x.seen from tally_period_days x where x.book_id = p_book and x.day = p_day), '{}'::jsonb);
  w := tally_check_want(p_book, p_heads, sn);
  g1 := d.gone1; g1at := d.gone1_at;
  if whole then
    select coalesce(jsonb_agg(v.guid order by v.guid), '[]'::jsonb) into cand from tally_vouchers v
     where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not coalesce(v.optional, false)
       and not exists (select 1 from jsonb_array_elements(p_heads) x where jsonb_typeof(x) = 'array' and x->>0 = v.guid);
    if jsonb_array_length(cand) > 0 and d.gone1 is not null and d.gone1_at <= now() - interval '60 seconds' then
      for g in select jsonb_array_elements_text(cand) intersect select jsonb_array_elements_text(d.gone1) loop
        res := tally_ingest_delete(p_book, g, null, false, 'upload check: deleted in Tally');
        if res->>'state' = 'applied' and not coalesce((res->>'already')::boolean, false) then
          rem := rem + 1;
          insert into tally_fetch_log (book_id, firm_id, via, what, guid, day) values (p_book, f, 'check', 'deleted', g, p_day);
        elsif coalesce((res->>'locked')::boolean, false) then locked := true;
        end if;
      end loop;
      select coalesce(jsonb_agg(v.guid order by v.guid), '[]'::jsonb) into cand from tally_vouchers v
       where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not coalesce(v.optional, false)
         and not exists (select 1 from jsonb_array_elements(p_heads) x where jsonb_typeof(x) = 'array' and x->>0 = v.guid);
      g1 := case when jsonb_array_length(cand) > 0 then cand end; g1at := case when jsonb_array_length(cand) > 0 then now() end;
    elsif jsonb_array_length(cand) > 0 then
      g1 := coalesce(d.gone1, cand); g1at := coalesce(d.gone1_at, now());
    else
      g1 := null; g1at := null;
    end if;
  end if;
  done := jsonb_array_length(w) = 0 and g1 is null and not locked;
  update tally_check_days set heads = p_heads, tally_n = n, via = case when whole then 'day' else 'split' end, listed_at = now(), lists = lists + 1, gone1 = g1, gone1_at = g1at,
         removed = removed + rem, done_at = case when done then now() end,
         same = case when done then added + updated + removed + rem = 0 end,
         upload_at = case when locked then now() when not done and lists + 1 >= 6 then now() end,
         upload_words = case when locked then 'FinCom could not correct ' || to_char(p_day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month, then upload that day''s Day Book again.'
                             when not done and lists + 1 >= 6 then 'FinCom could not finish checking ' || to_char(p_day, 'DD-Mon-YYYY') || ' against Tally. Please upload that day''s Day Book again.' end
   where book_id = p_book and day = p_day;
  return jsonb_build_object('ok', true, 'mine', true, 'n', n, 'want', w, 'done', done, 'removed', rem);
end $function$;

-- the entries Tally gave for a day being checked (parsed by tally-ingest as a Day Book's entries, each dated the day): stored
-- through the one entry path, each counted as added (not in the upload) or updated (another AlterID) and logged; a locked
-- month stores nothing and the day is to be uploaded by hand; then the day is done when nothing is left to bring or remove
create or replace function public.tally_check_entries(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_seen jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d tally_check_days%rowtype; vs jsonb := case when jsonb_typeof(p_vouchers) = 'array' then p_vouchers else '[]'::jsonb end; bf jsonb; res jsonb; x record; a int := 0; u int := 0;
  sn jsonb := '{}'::jsonb; k text; w jsonb; done boolean; wl text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from tally_check_days where book_id = p_book and day = p_day and done_at is null and upload_at is null for update;
  if not found then return jsonb_build_object('ok', true, 'mine', false); end if;
  if exists (select 1 from jsonb_array_elements(vs) v where coalesce(v->>'day', '') <> to_char(p_day, 'YYYY-MM-DD')) then
    return jsonb_build_object('ok', false, 'mine', true, 'error', 'an entry of another date');
  end if;
  if tally_month_locked(p_book, array[p_day]) is not null then
    wl := 'FinCom could not correct ' || to_char(p_day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month, then upload that day''s Day Book again.';
    update tally_check_days set upload_at = now(), upload_words = wl where book_id = p_book and day = p_day;
    return jsonb_build_object('ok', true, 'mine', true, 'locked', true, 'upload', wl, 'stored', 0);
  end if;
  for k in select jsonb_object_keys(case when jsonb_typeof(p_seen) = 'object' then p_seen else '{}'::jsonb end) loop
    if length(k) between 1 and 100 and coalesce(p_seen->>k, '') ~ '^[0-9]{1,15}$' then sn := sn || jsonb_build_object(k, (p_seen->>k)::bigint); end if;
  end loop;
  select coalesce(jsonb_object_agg(v.guid, jsonb_build_object('a', coalesce(v.alter_id, 0), 'live', v.deleted_at is null)), '{}'::jsonb) into bf
    from tally_vouchers v where v.book_id = p_book and v.guid in (select y->>'guid' from jsonb_array_elements(vs) y);
  if jsonb_array_length(vs) > 0 then
    res := tally_ingest_entries(p_book, vs, coalesce(p_lines, '[]'::jsonb), true, false);
    if not coalesce((res->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'mine', true, 'error', coalesce(res->>'error', res->>'refused', 'not stored'), 'locked', coalesce((res->>'locked')::boolean, false));
    end if;
    for x in select distinct v.guid, coalesce(v.alter_id, 0) as alt from tally_vouchers v
              where v.book_id = p_book and v.deleted_at is null and v.guid in (select y->>'guid' from jsonb_array_elements(vs) y) loop
      if bf->x.guid is null or not coalesce((bf->x.guid->>'live')::boolean, false) then
        a := a + 1; insert into tally_fetch_log (book_id, firm_id, via, what, guid, day) values (p_book, d.firm_id, 'check', 'added', x.guid, p_day);
      elsif (bf->x.guid->>'a')::bigint <> x.alt then
        u := u + 1; insert into tally_fetch_log (book_id, firm_id, via, what, guid, day) values (p_book, d.firm_id, 'check', 'changed', x.guid, p_day);
      end if;
    end loop;
  end if;
  w := tally_check_want(p_book, d.heads, d.seen || sn || coalesce((select z.seen from tally_period_days z where z.book_id = p_book and z.day = p_day), '{}'::jsonb));
  done := jsonb_array_length(w) = 0 and d.gone1 is null;
  update tally_check_days set seen = seen || sn, added = added + a, updated = updated + u, done_at = case when done then now() end,
         same = case when done then added + a + updated + u + removed = 0 end
   where book_id = p_book and day = p_day;
  return jsonb_build_object('ok', true, 'mine', true, 'stored', jsonb_array_length(vs), 'added', a, 'updated', u, 'done', done, 'want', w);
end $function$;

-- the bridge stopped reading the company (a day's list over 2 s, or Tally's window held 2 s): the check stops, and the period
-- with it (one rule: Tally is never asked again until the person presses Resume); only the choice the bridge was reading
create or replace function public.tally_check_stop(p_book uuid, p_day date, p_why text, p_words text, p_chosen_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; hr boolean; hp boolean; w text := left(coalesce(nullif(p_words, ''), 'FinCom stopped reading from Tally: Tally was busy.'), 300);
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from tally_check_runs where book_id = p_book; hr := found;
  select * into p from tally_period_pulls where book_id = p_book; hp := found;
  if p_chosen_at is null or not ((hr and r.chosen_at = p_chosen_at) or (hp and p.chosen_at = p_chosen_at)) then
    return jsonb_build_object('ok', true, 'stopped', false);
  end if;
  if hr then
    update tally_check_runs set state = 'stopped', stopped_at = now(), stop_day = p_day, stop_why = left(coalesce(p_why, ''), 40), stop_words = w where book_id = p_book;
  end if;
  update tally_period_pulls set state = 'stopped', stopped_at = now(), stop_day = p_day, stop_why = left(coalesce(p_why, ''), 40), stop_words = w where book_id = p_book and state = 'going';
  return jsonb_build_object('ok', true, 'stopped', true);
end $function$;

-- 98's tally_period_entries, with each entry it brought in or brought up to date logged (older entries, for "Today from
-- Tally"); its answer unchanged plus logged
create or replace function public.tally_period_entries_logged(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_seen jsonb, p_gone jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; bf jsonb; res jsonb; x record; n int := 0; vs jsonb := case when jsonb_typeof(p_vouchers) = 'array' then p_vouchers else '[]'::jsonb end;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  select coalesce(jsonb_object_agg(v.guid, jsonb_build_object('a', coalesce(v.alter_id, 0), 'live', v.deleted_at is null)), '{}'::jsonb) into bf
    from tally_vouchers v where v.book_id = p_book and v.guid in (select y->>'guid' from jsonb_array_elements(vs) y);
  res := tally_period_entries(p_book, p_day, p_vouchers, p_lines, p_seen, p_gone);
  if f is not null and coalesce((res->>'ok')::boolean, false) and not coalesce((res->>'locked')::boolean, false) then
    for x in select distinct v.guid, coalesce(v.alter_id, 0) as alt from tally_vouchers v
              where v.book_id = p_book and v.deleted_at is null and v.guid in (select y->>'guid' from jsonb_array_elements(vs) y) loop
      if bf->x.guid is null or not coalesce((bf->x.guid->>'live')::boolean, false) then
        n := n + 1; insert into tally_fetch_log (book_id, firm_id, via, what, guid, day) values (p_book, f, 'older', 'added', x.guid, p_day);
      elsif (bf->x.guid->>'a')::bigint <> x.alt then
        n := n + 1; insert into tally_fetch_log (book_id, firm_id, via, what, guid, day) values (p_book, f, 'older', 'changed', x.guid, p_day);
      end if;
    end loop;
  end if;
  return res || jsonb_build_object('logged', n);
end $function$;

-- ---------------------------------------------------------------- 4. the app (the firm's own books; owner or staff to change)
create or replace function public.tally_check_status(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if not tally_service_or_owner() then perform tally_period_member(p_book, false); end if;
  return tally_check_status_of(p_book);
end $function$;

-- Resume after the bridge stopped the check: a new choice time (the bridge reads the company again)
create or replace function public.tally_check_resume(p_book uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_period_member(p_book, true);
begin
  insert into tally_check_runs (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  update tally_check_runs set state = 'going', chosen_at = now(), stopped_at = null, stop_day = null, stop_why = null, stop_words = null where book_id = p_book;
  return tally_check_status_of(p_book);
end $function$;

-- Stop (the person): the period stopped, said so; Start (tally_period_choose) begins it afresh
create or replace function public.tally_period_cancel(p_book uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_period_member(p_book, true);
begin
  update tally_period_pulls set state = 'stopped', stopped_at = now(), stop_day = null, stop_why = 'person', stop_words = 'Stopped by you. Press Start to begin again.'
   where book_id = p_book and state <> 'stopped';
  return tally_period_status_of(p_book);
end $function$;

-- Today from Tally (India's day): every row, and the counts of the same rows (they always agree); at most 2,000 rows sent
create or replace function public.tally_today_from_tally(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare rows jsonb; c record; t0 timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
begin
  if not tally_service_or_owner() then perform tally_period_member(p_book, false); end if;
  rows := tally_today_rows(p_book, t0);
  select count(*) filter (where r->>'via' = 'tally' and r->>'what' = 'added')::int as a, count(*) filter (where r->>'via' = 'tally' and r->>'what' = 'changed')::int as ch,
         count(*) filter (where r->>'via' = 'tally' and r->>'what' = 'deleted')::int as dl, count(*) filter (where r->>'via' = 'older')::int as o,
         count(*) filter (where r->>'via' = 'check')::int as k, count(*)::int as n, max(r->>'at') as last
    into c from jsonb_array_elements(rows) r;
  return jsonb_build_object('ok', true, 'counts', jsonb_build_object('added', c.a, 'changed', c.ch, 'deleted', c.dl, 'older', c.o, 'corrected', c.k), 'total', c.n, 'last', c.last,
    'rows', (select coalesce(jsonb_agg(r order by o), '[]'::jsonb) from jsonb_array_elements(rows) with ordinality t(r, o) where o <= 2000));
end $function$;

-- the firm's books for the Tally page and Books › From Tally (one call): each book's period (as tally_period_status), today's
-- counts, the check's counts, and the computers that hold its company (their id and switch only; never a name)
create or replace function public.tally_fetch_summary(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); out jsonb; t0 timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('book', b.book_id, 'client', b.client_id, 'company', b.company, 'from', b.from_date,
      'pull', case when exists (select 1 from tally_period_pulls p where p.book_id = b.book_id) then tally_period_status_of(b.book_id)->'pull' end,
      'today', (select jsonb_build_object('added', count(*) filter (where r->>'via' = 'tally' and r->>'what' = 'added'), 'changed', count(*) filter (where r->>'via' = 'tally' and r->>'what' = 'changed'),
                  'deleted', count(*) filter (where r->>'via' = 'tally' and r->>'what' = 'deleted'), 'older', count(*) filter (where r->>'via' = 'older'),
                  'corrected', count(*) filter (where r->>'via' = 'check'), 'last', max(r->>'at'))
                  from jsonb_array_elements(tally_today_rows(b.book_id, t0)) r),
      'check', case when exists (select 1 from tally_check_days x where x.book_id = b.book_id) then (select jsonb_build_object('total', s->'total', 'same', s->'same', 'fixed', s->'fixed',
                  'waiting', s->'waiting', 'upload', s->'upload', 'run', s->'run') from (select tally_check_status_of(b.book_id) s) z) end,
      'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'fetchOn', coalesce(d.period_fetch, false)) order by d.id), '[]'::jsonb) from tally_devices d
                   where d.firm_id = f and not coalesce(d.revoked, false)
                     and (d.id in (select c.device_id from tally_companies c where c.book_id = b.book_id and c.device_id is not null)
                          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'beat'->'open') = 'array' then d.info->'beat'->'open' else '[]'::jsonb end) o
                                      where lower(btrim(coalesce(o->>'name', o #>> '{}'))) = lower(btrim(b.company)))
                          or exists (select 1 from jsonb_each(case when jsonb_typeof(d.info->'bridges') = 'object' then d.info->'bridges' else '{}'::jsonb end) e,
                                      jsonb_array_elements(case when jsonb_typeof(e.value->'open') = 'array' then e.value->'open' else '[]'::jsonb end) o
                                      where lower(btrim(coalesce(o->>'name', o #>> '{}'))) = lower(btrim(b.company)))))
      ) order by b.company), '[]'::jsonb) into out
    from tally_books b where b.firm_id = f and (p_book is null or b.book_id = p_book);
  return jsonb_build_object('ok', true, 'books', out);
end $function$;

-- ---------------------------------------------------------------- 5. who may call
revoke all on function public.tally_check_want(uuid, jsonb, jsonb), public.tally_check_status_of(uuid), public.tally_today_rows(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.tally_check_queue(uuid, date[], text), public.tally_check_next(uuid, integer), public.tally_check_heads(uuid, date, jsonb, text),
  public.tally_check_entries(uuid, date, jsonb, jsonb, jsonb), public.tally_check_stop(uuid, date, text, text, timestamptz),
  public.tally_period_entries_logged(uuid, date, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_check_queue(uuid, date[], text), public.tally_check_next(uuid, integer), public.tally_check_heads(uuid, date, jsonb, text),
  public.tally_check_entries(uuid, date, jsonb, jsonb, jsonb), public.tally_check_stop(uuid, date, text, text, timestamptz),
  public.tally_period_entries_logged(uuid, date, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.tally_check_status(uuid), public.tally_check_resume(uuid), public.tally_period_cancel(uuid), public.tally_today_from_tally(uuid), public.tally_fetch_summary(uuid) from public, anon;
grant execute on function public.tally_check_status(uuid), public.tally_check_resume(uuid), public.tally_period_cancel(uuid), public.tally_today_from_tally(uuid), public.tally_fetch_summary(uuid) to authenticated, service_role;

commit;
