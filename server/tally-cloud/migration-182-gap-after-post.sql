-- migration-182-gap-after-post.sql (13-Nov-2026, branch next-fix-gap-after-post). Written, NOT run yet: the owner reads it and runs it.
-- Why (staging, 13-Nov-2026, Client CL): FinCom posted 42 bank entries dated 01-Oct to 31-Oct (Tally's AlterIDs 42873 to
-- 42915). The posting window's credit closed the gap as a match, though none of the 42 was matched by a recorder line or
-- read back (FinCom's copy of Tally has none of them). Tally's number then went to 43025 (110 changes, on older dates).
-- The page asks for the Day Book of 12-Nov to 13-Nov (the gap's time, not the entries' dates): empty in Tally, so the
-- upload cannot help. Oct was counted 0 on 07-Nov and 98's period count never counts a day again; 160's gap read is held
-- for ever by an old over2s stop of the check and given up 6 hours after the gap opened; its "checking" flag is worked
-- out only when the row changes.
-- What 182 does. Nothing new is asked of Tally (133's check day: FinComDayHeads and the entries it wants); the bridge's
-- rules stay (each request at most 2 s, one at a time, postings first, the typing gate). The owner, 13-Nov-2026: nobody
-- opens Tally at night, so nothing here waits for the night: the extra reads ("light" reads: a posting's read back, the
-- older days a gap needs, the recount, the retry after a 2 s stop) go by day, only while the computer is idle, slowly:
--   idle: tally-ingest's p_idle (no typing or clicks in Tally seen by the bridge for 2 minutes, its last request answered
--   within 2 s, Tally not busy, reading not paused; the beat's keepWait / periodPull waits and reqs.last), kept a book at
--   a time (tally_light_pace.idle_at, 45 s); and no posting of the company waiting or running (tally_gap_front).
--   pace: one light day at a time for a book, at most one every 25 s, 120 an hour and 600 a day (tally_light_may / _took).
--   A. tally_post_job_read_back (a trigger on tally_post_jobs): a posting done queues its entries' days (by the voucher's
--      date, at most 100, none after today) as light days (tally_light_days, why 'post'); no check is started for a book
--      without one. tally_recorder_gap_check (150's text, the window's credit only): a window credits only entries of its
--      posting matched by a recorder line above the window's floor (matched_alter > lo) or read back (the copy holds the
--      entry by FinCom's id at an AlterID > lo); the rest stay in the gap, said "N of FinCom's posted entries not read
--      back from Tally yet".
--   B. tally_gap_front(book, max, idle): 160's, plus one light day when idle and paced (posted days, older days asked by
--      From Tally), before the gap's own days. A gap open more than 6 hours, or a check stopped by a 2 s stop (over2s,
--      window) an hour or more ago, is no longer given up: one day at a time as a light read; for the stop a retry under
--      its own choice time (tally_gap_retries), at most every 3 hours; the bridge's stop of it stops the retry only
--      (tally_check_stop, 133's text plus that); a retry day Tally gave in time resumes the check by itself (the owner's
--      decision of 13-Nov-2026), under the retry's choice time. tally_gap_front(book, max) (160's arguments): the same, not idle.
--      tally_period_next_paced (98's text plus the recount): a book whose gap's own days match Tally (C) has its days
--      counted before Tally's number now was first seen counted again, one light day at a time: once a book and number.
--      tally_fill_request (135's text plus): each day goes to the client's book whose year has it (the latest book before);
--      a day read whole since Tally's number now was seen is not queued again; a gap's older days (C) go as light days.
--   C. tally_gap_own_read(book, gap): every day of the gap (from its first day, India's, to the day Tally's number was
--      first seen; at most 7) read whole (day or split) after that number was seen, and done. tally_gap_front then stops
--      asking for those days; the gap says older: {from, say: "Changes were made in Tally on older dates.", fix: "Upload
--      the Day Book from <day> to today."}, <day> the first day of the book's own year (its period's, else the year its
--      first day is in; its first day when later), or the oldest day FinCom posted since the gap began when earlier.
--   D. tally_gap_state(book, gap, gap_at): checking (the check can still read: going, or a 2 s stop whose retry has not
--      failed; a computer reading older entries for the company; the gap's own days not read yet, or posted days queued in
--      the last 24 hours not read back) and older; 160's trigger (tally_sync_cursor_gap_checking, replaced) writes both
--      with checkUntil (an hour on) at every write of the gap; the page counts checking only until then.
-- Add-only: three new tables (row security on, service_role only), seven new functions (one an overload of
-- tally_gap_front), one new trigger; replaced with the same arguments, grants restated: 150's tally_recorder_gap_check,
-- 98's tally_period_next_paced, 133's tally_check_stop, 135's tally_fill_request, 160's tally_gap_front(uuid, integer) and
-- tally_sync_cursor_gap_checking. No column, row or other function changed. One transaction, lock_timeout 10 s; safe
-- twice. Tested by tests/run_migration182.py (pg_stand) and tests/run_gap_post_ingest.py (tally-ingest). Runs after 98,
-- 133, 135, 150, 158 and 160.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the tables
-- a gap read retried after a 2 s stop (B)
create table if not exists public.tally_gap_retries (
  book_id    uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id    uuid not null,
  chosen_at  timestamptz not null default now(),       -- the retry's own choice time (the bridge's stop names it)
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  stop_day   date,
  stop_why   text check (stop_why is null or length(stop_why) <= 40),
  day        date,                                      -- the day the retry read
  resumed_at timestamptz                                -- the retry's day read (within 2 s): the check resumed
);
-- the light days of a book: read only while the computer is idle, one at a time (A, B)
create table if not exists public.tally_light_days (
  book_id    uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id    uuid not null,
  day        date not null,
  why        text not null check (why in ('post', 'fill')),
  queued_at  timestamptz not null default now(),
  handed_at  timestamptz,                               -- handed to the check (133's tally_check_days)
  primary key (book_id, day)
);
-- the pace of a book's light reads, and whether its computer is idle now
create table if not exists public.tally_light_pace (
  book_id    uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id    uuid not null,
  idle_at    timestamptz,                               -- the last beat that found the computer idle (null: not idle)
  last_at    timestamptz,                               -- the last light day handed out
  hour_at    timestamptz,
  hour_n     integer not null default 0 check (hour_n >= 0),
  day_on     date,
  day_n      integer not null default 0 check (day_n >= 0)
);
alter table public.tally_gap_retries enable row level security;
alter table public.tally_light_days enable row level security;
alter table public.tally_light_pace enable row level security;
grant select, insert, update, delete on public.tally_gap_retries to service_role;
grant select, insert, update, delete on public.tally_light_days to service_role;
grant select, insert, update, delete on public.tally_light_pace to service_role;

-- ---------------------------------------------------------------- 2. the light pace
-- a light day may be handed out now: the computer idle (its last beat, 45 s), none in the last 25 s, under 120 this hour
-- and 600 today (India's)
create or replace function public.tally_light_may(p_book uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((select x.idle_at > now() - interval '45 seconds'
                      and (x.last_at is null or x.last_at <= now() - interval '25 seconds')
                      and (x.hour_at is null or x.hour_at <= now() - interval '1 hour' or x.hour_n < 120)
                      and (x.day_on is distinct from (now() at time zone 'Asia/Kolkata')::date or x.day_n < 600)
                     from tally_light_pace x where x.book_id = p_book), false)
$function$;
create or replace function public.tally_light_took(p_book uuid) returns void
language sql security definer set search_path = public, pg_temp as $function$
  update tally_light_pace set last_at = now(),
         hour_n = case when hour_at is null or hour_at <= now() - interval '1 hour' then 1 else hour_n + 1 end,
         hour_at = case when hour_at is null or hour_at <= now() - interval '1 hour' then now() else hour_at end,
         day_n = case when day_on is distinct from (now() at time zone 'Asia/Kolkata')::date then 1 else day_n + 1 end,
         day_on = (now() at time zone 'Asia/Kolkata')::date
   where book_id = p_book
$function$;

-- a day of a book read whole (day or split) by Tally after p_at and done, by the check or by 98's count
create or replace function public.tally_day_read_for(p_book uuid, p_day date, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select p_at is not null and (
    exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = p_day and k.via in ('day', 'split') and k.listed_at >= p_at and k.done_at is not null and k.upload_at is null)
    or exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = p_day and x.counted_at >= p_at and x.done_at is not null and x.upload_at is null))
$function$;

-- ---------------------------------------------------------------- 3. the gap's own days read (C)
-- every day from the gap's first day (India's) to the day FinCom first saw Tally's number now (158's tally_gap_numbers, that
-- very number; at most 7 days) listed whole (day or split) by Tally after that, and done; none given up. A later day can
-- hold only an entry made before that number was seen and dated ahead (Tally's number has not moved since): the residual
create or replace function public.tally_gap_own_read(p_book uuid, p_gap jsonb) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare n tally_gap_numbers%rowtype; a date; z date;
begin
  if p_book is null or p_gap is null or jsonb_typeof(p_gap) <> 'object' or coalesce(p_gap->>'since', '') !~ '^\d{4}-\d\d-\d\d'
     or coalesce(p_gap->>'tally_altvchid', '') !~ '^[0-9]{1,15}$' then return false; end if;
  select * into n from tally_gap_numbers where book_id = p_book;
  if not found or n.altvchid <> (p_gap->>'tally_altvchid')::bigint then return false; end if;
  a := ((p_gap->>'since')::timestamptz at time zone 'Asia/Kolkata')::date;
  z := greatest(a, (n.first_at at time zone 'Asia/Kolkata')::date);
  if z - a > 6 then return false; end if;
  return not exists (select 1 from generate_series(a, z, interval '1 day') s(d) where not tally_day_read_for(p_book, s.d::date, n.first_at)
                        and not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = s.d::date and k.via in ('day', 'split')
                                          and k.listed_at >= n.first_at and k.done_at is not null and k.upload_at is null));
end $function$;

-- ---------------------------------------------------------------- 4. what the gap says (D, C)
create or replace function public.tally_gap_state(p_book uuid, p_gap jsonb, p_gap_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare a date; z date := (now() at time zone 'Asia/Kolkata')::date; since_ timestamptz; r tally_check_runs%rowtype; p tally_period_pulls%rowtype; t tally_gap_retries%rowtype;
  bk tally_books%rowtype; n tally_gap_numbers%rowtype; can boolean; reader boolean; own boolean; own_left boolean; post_left boolean; chk boolean; fy date; pd date;
begin
  if p_book is null or p_gap is null or jsonb_typeof(p_gap) <> 'object' or coalesce(p_gap->>'since', '') !~ '^\d{4}-\d\d-\d\d' then
    return jsonb_build_object('checking', false);
  end if;
  since_ := (p_gap->>'since')::timestamptz;
  a := (since_ at time zone 'Asia/Kolkata')::date;
  select * into bk from tally_books where book_id = p_book;
  select * into r from tally_check_runs where book_id = p_book;
  select * into p from tally_period_pulls where book_id = p_book;
  select * into t from tally_gap_retries where book_id = p_book;
  select * into n from tally_gap_numbers where book_id = p_book;
  -- the check can still read: going (or none yet), or a 2 s stop whose retry has not failed since; the period not paused
  can := (r.book_id is null or r.state = 'going' or (coalesce(r.stop_why, '') in ('over2s', 'window') and t.stopped_at is null))
         and (p.book_id is null or p.state <> 'paused');
  -- a computer that reads older entries for the company (its switch on)
  reader := exists (select 1 from tally_companies tc join tally_devices d on d.id = tc.device_id
                     where tc.firm_id = bk.firm_id and tc.company = bk.company and coalesce(d.period_fetch, false) and not coalesce(d.revoked, false));
  own := tally_gap_own_read(p_book, p_gap);
  own_left := not own and a <= z and z - a <= 6
    and not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day between a and z and k.upload_at is not null
                      and k.upload_at >= coalesce(p_gap_at, now()) - interval '5 seconds');
  -- posted days queued in the last 24 hours not read back yet
  post_left := exists (select 1 from tally_light_days l where l.book_id = p_book and l.why = 'post' and l.queued_at > now() - interval '24 hours' and l.day <= z
                         and (l.handed_at is null or exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = l.day and k.done_at is null and k.upload_at is null))
                         and not tally_day_read_for(p_book, l.day, l.queued_at));
  chk := coalesce(can, false) and reader and (own_left or post_left);
  if not own or post_left then
    return jsonb_build_object('checking', chk) || case when chk then jsonb_build_object('checkUntil', now() + interval '1 hour') else '{}'::jsonb end;
  end if;
  -- the book's own year: its period's (the year chosen), else the year its first day is in (else today's), its first day
  -- when later
  fy := coalesce(p.fy_start, make_date(extract(year from (coalesce(bk.from_date, z) - interval '3 months'))::int, 4, 1));
  if p.fy_start is null and bk.from_date is not null and bk.from_date > fy and bk.from_date <= z then fy := bk.from_date; end if;
  select min(l.day) into pd from tally_light_days l where l.book_id = p_book and l.why = 'post' and l.queued_at >= since_ - interval '1 day';
  fy := least(fy, coalesce(pd, fy));
  return jsonb_build_object('checking', false, 'older', jsonb_build_object('from', to_char(fy, 'YYYY-MM-DD'), 'say', 'Changes were made in Tally on older dates.',
                            'fix', 'Upload the Day Book from ' || to_char(fy, 'DD-Mon-YYYY') || ' to today.'));
end $function$;

-- 160's trigger: the gap's words worked out at every write of it (D)
create or replace function public.tally_sync_cursor_gap_checking() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare s jsonb;
begin
  begin
    s := tally_gap_state(new.book_id, new.gap, new.gap_at);
    new.gap := (new.gap - 'checking' - 'checkUntil' - 'older') || s;
  exception when others then
    raise log 'tally_sync_cursor_gap_checking: book %: % %', new.book_id, sqlstate, sqlerrm;
  end;
  return new;
end $function$;

-- ---------------------------------------------------------------- 5. a posting done: its days read back, lightly (A)
-- the days of the posting's entries (the voucher's DATE, at most 100, none after today) as light days of each book of the
-- posting's company (why 'post'; a day handed out before: queued again). No check is started. Never fails what fired it
create or replace function public.tally_post_job_read_back() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare b record; today date := (now() at time zone 'Asia/Kolkata')::date; ds date[];
begin
  begin
    ds := array(select y.d from (select distinct to_date(z.m, 'YYYYMMDD') as d
                                   from jsonb_array_elements(case when jsonb_typeof(new.payload->'vouchers') = 'array' then new.payload->'vouchers' else '[]'::jsonb end) v
                                  cross join lateral (select substring(coalesce(v->>'xml', '') from '<DATE>(\d{8})</DATE>') as m) z
                                  where z.m ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$') y
                 where y.d <= today order by y.d desc limit 100);
    if coalesce(array_length(ds, 1), 0) = 0 then return null; end if;
    for b in select bk.book_id, bk.firm_id from tally_books bk where bk.firm_id = new.firm_id and bk.company = new.company loop
      insert into tally_light_days (book_id, firm_id, day, why, queued_at)
      select b.book_id, b.firm_id, d, 'post', now() from unnest(ds) d
      on conflict (book_id, day) do update set why = 'post', queued_at = now(), handed_at = null;
    end loop;
  exception when others then
    raise log 'tally_post_job_read_back: job %: % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end $function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_post_jobs'::regclass and tgname = 'tally_post_job_read_back' and not tgisinternal) then
    create trigger tally_post_job_read_back after update of status on public.tally_post_jobs for each row
      when (new.status = 'done' and old.status is distinct from 'done') execute function public.tally_post_job_read_back();
  end if;
end $$;

-- 150's tally_recorder_gap_check, its text unchanged but the window's credit (A, marked 182)
create or replace function public.tally_recorder_gap_check(p_book uuid, p_device uuid, p_altvchid bigint, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; bk tally_books%rowtype; c tally_sync_cursor%rowtype; dmax bigint; base bigint; g jsonb; byd jsonb; at_ timestamptz := coalesce(p_at, now()); missing bigint;
  mbase bigint; since_ timestamptz; w record; lo bigint; hi bigint; above bigint; kk bigint; dup bigint; cr bigint; credit bigint := 0; ww text := ''; wins jsonb := '[]'::jsonb;
  fb bigint := 0; fbm bigint := 0; wm bigint := 0; since_fb timestamptz; cg text; lost bigint := 0; lost_w text := ''; kn bigint; un bigint := 0;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into bk from tally_books where book_id = p_book;
  f := bk.firm_id;
  if f is null then raise exception 'no such book'; end if;
  if p_altvchid is null or p_altvchid >= 1000000000000000 then raise exception 'the check needs Tally''s highest voucher AlterID'; end if;
  -- 0 or less is unknown (the bridge read no ALTVCHID): never a starting point, never a rewind; the cursor untouched (review M2)
  if p_altvchid <= 0 then return jsonb_build_object('ok', true, 'gap', null, 'unknown', true); end if;
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  select * into c from tally_sync_cursor where book_id = p_book;
  -- no starting point yet: this number is it (7.), and there is no gap
  if c.start_at is null then
    update tally_sync_cursor set last_voucher_alterid = p_altvchid, start_at = now(), start_device = p_device, start_guid = coalesce(start_guid, company_guid), gap = null, gap_at = null, updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'startRecorded', true, 'gap', null, 'startVoucher', p_altvchid);
  end if;
  -- below the starting point: a backup restored or the data rewritten - needs_baseline as today, never a gap (45: the last
  -- match's number cleared too)
  if p_altvchid < coalesce(c.last_voucher_alterid, 0) then
    update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, match_alter = null, match_start = null, updated_at = now(),
           state_why = format('Tally''s highest voucher AlterID (%s) is below the starting point (%s): a backup restored or the data rewritten', p_altvchid, c.last_voucher_alterid)
     where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the starting point (%s < %s)', p_altvchid, c.last_voucher_alterid));
  end if;
  select max(d.alter_max) into dmax from tally_days d where d.book_id = p_book;
  -- 45: the last check that matched under this starting point accounted everything up to its number
  mbase := case when c.match_start is not distinct from c.start_at then c.match_alter end;
  -- review L10: below that number, read after that match, is a restore as below the start (needs_baseline as 44, never
  -- matched); a reading older than the match (two beats crossing) changes nothing and says nothing
  if mbase is not null and p_altvchid < mbase then
    if c.last_match_at is null or at_ > c.last_match_at then
      update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, updated_at = now(),
             state_why = format('Tally''s highest voucher AlterID (%s) is below the last matched check''s (%s): a backup restored or the data rewritten', p_altvchid, mbase)
       where book_id = p_book;
      return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the last match (%s < %s)', p_altvchid, mbase));
    end if;
    return jsonb_build_object('ok', true, 'gap', null, 'behind', true, 'why', format('a reading older than the last match (%s < %s)', p_altvchid, mbase));
  end if;
  base := greatest(coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0), coalesce(dmax, 0), coalesce(mbase, 0));
  since_ := coalesce(c.last_match_at, c.start_at);
  missing := p_altvchid - base;
  if missing > 0 then
    -- (a) the posting windows above the baseline and below Tally's number now (review M1), of this book's company GUID
    cg := coalesce(c.start_guid, c.company_guid);
    for w in select pw.job_id, pw.a0, pw.a1, pw.created_vch, pw.created_mst, pw.company_guid, coalesce(j.taken_at, j.created_at, pw.at) as posted_at
               from tally_post_windows pw left join tally_post_jobs j on j.id = pw.job_id
              where pw.book_id = p_book and pw.a1 > base and pw.a0 < p_altvchid and pw.a1 >= pw.a0 order by pw.a0, pw.id loop
      if w.company_guid is null or cg is null or w.company_guid <> cg then
        ww := ww || format('; FinCom''s posting of %s not counted (made in company GUID %s; this book''s is %s)', to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'),
                           coalesce(w.company_guid, 'not sent'), coalesce(cg, 'not known yet'));
        wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'counted', 0, 'otherCompany', true));
        continue;
      end if;
      lo := greatest(w.a0, base); hi := least(w.a1, p_altvchid); above := greatest(hi - lo, 0);
      -- the changes in the window that are not FinCom's vouchers (a person's, or its masters'): at most kk; of the part above
      -- the baseline at least above - kk is FinCom's (review M1), and only vouchers raise ALTVCHID's count here (review M2)
      kk := greatest(w.a1 - w.a0 - w.created_vch, 0); wm := wm + w.created_mst;
      -- never subtract twice: the window's entries a recorder line matched carry their AlterID into recorder_max_alter, so they
      -- are inside the baseline already; counted here they are taken off (review L7: empty by construction, kept as the guard)
      select count(*) into dup from tally_post_ids p where p.job_id = w.job_id and p.matched_at is not null and p.matched_alter > lo and p.matched_alter <= w.a1
         and p.matched_alter <= coalesce(c.recorder_max_alter, 0);
      -- 182 (A): of the posting's entries only those FinCom KNOWS are in Tally count: matched by a recorder line, or read back
      -- (the copy holds the entry by FinCom's id: a day read brought it). Tally's reply alone is not enough (Client CL,
      -- 12-Nov-2026: 42 posted, none matched or read back, the gap closed as a match)
      -- (only those above the window's floor here: matched at an AlterID > lo, or held by the copy at an AlterID > lo)
      select count(*) into kn from tally_post_ids p where p.job_id = w.job_id and p.accepted_at is not null and p.released_at is null
         and ((p.matched_at is not null and coalesce(p.matched_alter, 0) > lo)
              or exists (select 1 from tally_vouchers v where v.book_id = p_book and v.fincom_id is not null and (v.fincom_id = p.fincom_id or v.fincom_id = p.entry_id)
                           and coalesce(v.alter_id, 0) > lo));
      un := un + greatest(least(above, w.created_vch, above - kk) - kn, 0);
      cr := greatest(least(above, w.created_vch, above - kk, kn) - dup, 0);
      if kk > 0 then     -- not fully accounted: someone else changed something while it ran (or it made ledgers)
        ww := ww || format('; up to %s changes not received during the posting of %s', kk, to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'));
      end if;
      credit := credit + cr;
      wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'masters', w.created_mst, 'full', kk = 0, 'counted', cr, 'known', kn));
    end loop;
    -- (c) the fallback: the vouchers of FinCom's postings without a window, accepted after the last match (else the starting
    -- point), not matched by a recorder line and not in the copy (a day read or a line brought them: inside the baseline;
    -- review L1: also when the copy marked it deleted since). Review H1: "after" is the SERVER's time of the latest thing that
    -- set the baseline: the last match (match_at, the server's clock), the last recorder line that raised recorder_max_alter
    -- (recorder_last_at), the day read that brought the highest AlterID. A posting accepted before it has its changes under
    -- the baseline already; no posting is subtracted at two checks. Residual: these are the times acceptances REACHED the
    -- cloud, not Tally's; a batch reported seconds after a later person's line still counts (at most one request; closed by
    -- 2.2.0's windows; docs/reviews/migration-45-review.md, Fixed)
    since_fb := greatest(coalesce(case when c.match_start is not distinct from c.start_at then coalesce(c.match_at, c.last_match_at) end, c.start_at),
                         case when coalesce(c.recorder_max_alter, 0) > coalesce(c.last_voucher_alterid, 0) then c.recorder_last_at end,
                         (select max(d.at) from tally_days d where d.book_id = p_book and d.alter_max >= base));
    select count(*) into fb from tally_post_ids p join tally_post_jobs j on j.id = p.job_id
     where p.firm_id = f and j.firm_id = f and j.company = bk.company
       and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
       and p.accepted_at is not null and p.accepted_at > since_fb and p.released_at is null and p.matched_at is null
       and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.fincom_id = p.fincom_id);
    if fb > 0 then
      select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) r
                            where r->>'kind' = 'master' and tally_post_result_accepted(r))), 0) into fbm
        from tally_post_jobs j
       where j.firm_id = f and j.company = bk.company and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
         and exists (select 1 from tally_post_ids p where p.job_id = j.id and p.accepted_at > since_fb);
    end if;
    missing := p_altvchid - base - credit - fb;
    if un > 0 then     -- 182 (A): said plainly; their days are read again (tally_post_job_read_back)
      ww := ww || format('; %s of FinCom''s posted entries not read back from Tally yet', un);
    end if;
    fbm := fbm + wm;
  end if;
  -- 47 (review H1): the lines of a queued send that failed for good are NOT received, though later lines raised the
  -- recorder's highest AlterID above them: each one not brought since (a later line of that entry at its AlterID or above,
  -- or the copy holding the entry so: a day read) is counted, so the check is never fooled into a match
  select count(*) into lost from tally_recorder_lines r
   where r.book_id = p_book and r.state = 'failed' and r.held_why like 'queued send failed%'
     and r.event in ('created', 'altered', 'imported', 'deleted', 'cancelled') and r.object_guid is not null and r.alter_id is not null
     and not exists (select 1 from tally_recorder_lines r2 where r2.book_id = p_book and r2.object_guid = r.object_guid and r2.alter_id >= r.alter_id and r2.state in ('applied', 'duplicate', 'stale'))
     and case when r.event = 'deleted' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and coalesce(v.alter_id, 0) < r.alter_id)
              when r.event = 'cancelled' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and not coalesce(v.cancelled, false) and coalesce(v.alter_id, 0) < r.alter_id)
              else not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and coalesce(v.alter_id, 0) >= r.alter_id) end;
  if lost > 0 then
    missing := greatest(coalesce(missing, 0), 0) + lost;
    lost_w := format('; %s of them in a queued send that failed (Sync activity: failed): send them again or read those days again', lost);
  end if;
  -- 150: a gap Tally was asked about day by day since it began, with nothing found missing, is closed (the match below)
  if missing > 0 and not (lost = 0 and tally_recorder_gap_asked(p_book, c.gap_at, since_, at_, greatest(p_altvchid, coalesce((c.gap->>'tally_altvchid')::bigint, 0)))) then
    -- an UPPER bound: each create, alter or delete raises ALTVCHID by at least one, so the changes missed are at most this
    select jsonb_object_agg(s.device_id::text, jsonb_build_object('max', s.mx, 'lastAt', s.la)) into byd
      from (select r.device_id, max(r.alter_id) mx, max(r.received_at) la from tally_recorder_lines r
             where r.book_id = p_book and r.device_id is not null and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') group by r.device_id) s;
    g := jsonb_build_object('tally_altvchid', p_altvchid, 'recorder_max', c.recorder_max_alter, 'day_max', dmax, 'start_point', c.last_voucher_alterid, 'missing', missing, 'missingMax', missing,
           'since', since_, 'last_match_at', c.last_match_at, 'by_device', coalesce(byd, '{}'::jsonb), 'device', p_device, 'at', at_,
           'accounted', credit, 'posted', fb, 'unread', un, 'windows', wins, 'ledgers', fbm, 'lost', lost,
           'words', format('up to %s changes not received since %s', missing, to_char(since_ at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI')) || ww || lost_w
                    || case when fbm > 0 then format('; of which up to %s may be FinCom''s own new ledgers', least(fbm, missing)) else '' end);
    update tally_sync_cursor set gap = g, gap_at = coalesce(gap_at, now()), updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', g, 'missing', missing, 'missingMax', missing);
  end if;
  update tally_sync_cursor set gap = null, gap_at = null, last_match_at = at_, match_at = now(), match_alter = greatest(coalesce(mbase, 0), p_altvchid), match_start = c.start_at, updated_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'gap', null, 'matched', true, 'lastMatchAt', at_, 'accounted', credit + fb);
end $function$;

-- ---------------------------------------------------------------- 6. the gap read (B, C)
create or replace function public.tally_gap_front(p_book uuid, p_max integer, p_idle boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare c tally_sync_cursor%rowtype; bk tally_books%rowtype; r tally_check_runs%rowtype; p tally_period_pulls%rowtype; t tally_gap_retries%rowtype; n tally_gap_numbers%rowtype;
  has_p boolean; has_r boolean; ca timestamptz; out jsonb := '[]'::jsonb; e record; a date; z date := (now() at time zone 'Asia/Kolkata')::date; since_ timestamptz;
  lim int := least(greatest(coalesce(p_max, 1), 0), 7); idle boolean := coalesce(p_idle, false); retry boolean := false; old boolean; light boolean; fa timestamptz;
  days date[] := '{}'; gaps date[] := '{}'; lights date[] := '{}';
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_book is null or lim = 0 then return out; end if;
  -- 182 (the owner's decision of 13-Nov-2026): a retry whose day Tally gave whole (the bridge stops a request over 2 s, so
  -- a day listed is one given in time) and not stopped resumes the check by itself, under the retry's choice time
  select * into t from tally_gap_retries where book_id = p_book;
  if found and t.stopped_at is null and t.resumed_at is null and t.day is not null
     and exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = t.day and k.via is not null and k.listed_at >= t.started_at) then
    update tally_check_runs set state = 'going', chosen_at = t.chosen_at, stopped_at = null, stop_day = null, stop_why = null, stop_words = null
     where book_id = p_book and state = 'stopped' and coalesce(stop_why, '') in ('over2s', 'window');
    update tally_gap_retries set resumed_at = now() where book_id = p_book;
  end if;
  select * into c from tally_sync_cursor where book_id = p_book;
  if not found or c.gap is null or c.gap_at is null then return out; end if;
  -- 182: whether the book's computer is idle now (98's recount reads it too)
  insert into tally_light_pace (book_id, firm_id, idle_at) values (p_book, c.firm_id, case when idle then now() end)
  on conflict (book_id) do update set idle_at = excluded.idle_at;
  if c.gap_at > now() - interval '2 minutes' or coalesce(c.gap->>'since', '') !~ '^\d{4}-\d\d-\d\d' then return out; end if;
  since_ := (c.gap->>'since')::timestamptz;
  a := (since_ at time zone 'Asia/Kolkata')::date;
  -- nothing of the book held or waiting since the gap began (the held lines' own path goes first)
  if exists (select 1 from tally_recorder_lines l where l.book_id = p_book and l.received_at >= since_ and l.state in ('held', 'received')) then return out; end if;
  -- postings first: none while a posting of the book's company waits or runs
  select * into bk from tally_books where book_id = p_book;
  if exists (select 1 from tally_post_jobs j where j.firm_id = bk.firm_id and j.company = bk.company and j.status in ('waiting', 'taken', 'running')
               and j.created_at > now() - interval '1 day') then return out; end if;
  -- 135's stop rules; 182: a 2 s stop an hour old or more is tried again, one light day, at most every 3 hours
  select * into r from tally_check_runs where book_id = p_book;
  has_r := found;
  select * into t from tally_gap_retries where book_id = p_book;
  if has_r and r.state <> 'going' then
    if not (coalesce(r.stop_why, '') in ('over2s', 'window') and r.stopped_at <= now() - interval '1 hour'
            and (t.book_id is null or t.started_at <= now() - interval '3 hours')) then return out; end if;
    retry := true;
  end if;
  select * into p from tally_period_pulls where book_id = p_book;
  has_p := found;
  if has_p and p.state = 'paused' then return out; end if;
  if has_p and p.state = 'stopped' and not coalesce(has_r and r.chosen_at > coalesce(p.stopped_at, p.chosen_at), false)
     and not (retry and coalesce(p.stop_why, '') in ('over2s', 'window')) then return out; end if;
  -- 182: a gap open more than 6 hours, and a retry: light reads only (idle, paced, one day)
  old := c.gap_at < now() - interval '6 hours';
  light := idle and tally_light_may(p_book);
  if (retry or old) and not light then return out; end if;
  select * into n from tally_gap_numbers where book_id = p_book;
  fa := case when n.book_id is not null and n.altvchid::text = c.gap->>'tally_altvchid' then n.first_at end;
  -- the days: one light day (posted, or older days asked by From Tally) not read since Tally's number was seen, then the
  -- gap's own days (at most 7), each at most once per 15 minutes; 182 (C): a day of the gap read whole after Tally's number
  -- was seen, and done, is not asked again for it
  for e in select q.day, q.o from (
             select distinct on (x.day) x.day, x.o from (
               (select l.day, 0 as o from tally_light_days l
                 where light and l.book_id = p_book and l.day <= z
                   and (l.handed_at is null or (l.handed_at < now() - interval '30 minutes'
                                                and exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = l.day and k.done_at is null and k.upload_at is null)))
                   and not tally_day_read_for(p_book, l.day, greatest(fa, l.queued_at))
                 order by l.day desc limit 1)
               union all
               select s.d::date, 1 from generate_series(a, z, interval '1 day') s(d)
                where a <= z and z - a <= 6
                  and not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = s.d::date
                                    and (k.upload_at is not null or (k.asked_at is not null and k.asked_at > now() - interval '15 minutes')))
                  and not tally_day_read_for(p_book, s.d::date, fa)) x
             order by x.day, x.o) q
           order by q.o, q.day desc limit case when retry or old then 1 else lim end loop
    days := days || e.day;
    if e.o = 0 then lights := lights || e.day; else gaps := gaps || e.day; end if;
  end loop;
  if coalesce(array_length(days, 1), 0) = 0 then return out; end if;
  if retry then
    insert into tally_gap_retries (book_id, firm_id, chosen_at, started_at, day) values (p_book, c.firm_id, now(), now(), days[1])
    on conflict (book_id) do update set chosen_at = excluded.chosen_at, started_at = excluded.started_at, stopped_at = null, stop_day = null, stop_why = null,
      day = excluded.day, resumed_at = null;
    ca := now();
  else
    ca := coalesce(case when has_p and p.state = 'going' then p.chosen_at end, case when has_r then r.chosen_at end, c.gap_at);
  end if;
  if retry or old or array_length(lights, 1) > 0 then perform tally_light_took(p_book); end if;
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true, 'gap', true)
                            || case when retry then jsonb_build_object('retry', true) else '{}'::jsonb end order by o), '[]'::jsonb) into out
    from unnest(days) with ordinality u(d, o);
  -- the days queued for 133's check (a day read already: read again; what its earlier checks found is kept, as 158's trigger)
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select p_book, c.firm_id, d, 'gap', now() from unnest(gaps) d
  on conflict (book_id, day) do update set source = 'gap', queued_at = now(), lists = 0, same = null, done_at = null
    where tally_check_days.done_at is not null and tally_check_days.upload_at is null;
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select p_book, c.firm_id, l.day, l.why, now() from tally_light_days l where l.book_id = p_book and l.day = any (lights)
  on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), lists = 0, same = null, done_at = null
    where tally_check_days.done_at is not null and tally_check_days.upload_at is null;
  update tally_light_days set handed_at = now() where book_id = p_book and day = any (lights);
  update tally_check_days x set asked_at = now(), first_asked_at = coalesce(x.first_asked_at, now())
   where x.book_id = p_book and x.day = any (days);
  return out;
end $function$;

-- 160's arguments: the same, not idle
create or replace function public.tally_gap_front(p_book uuid, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  return tally_gap_front(p_book, p_max, false);
end $function$;

-- 133's tally_check_stop, its text unchanged but the retry's stop (B, marked 182)
create or replace function public.tally_check_stop(p_book uuid, p_day date, p_why text, p_words text, p_chosen_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; hr boolean; hp boolean; w text := left(coalesce(nullif(p_words, ''), 'FinCom stopped reading from Tally: Tally was busy.'), 300);
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  -- 182 (B): the bridge stopped a gap read retried at a quiet time (its own choice time): that retry stops, nothing else
  -- (the check, the period); the next quiet time tries again
  if p_chosen_at is not null and exists (select 1 from tally_gap_retries g where g.book_id = p_book and g.chosen_at = p_chosen_at) then
    update tally_gap_retries set stopped_at = now(), stop_day = p_day, stop_why = left(coalesce(p_why, ''), 40) where book_id = p_book and chosen_at = p_chosen_at;
    return jsonb_build_object('ok', true, 'stopped', true, 'retry', true);
  end if;
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

-- 98's tally_period_next_paced, its text unchanged but the recount (B, marked 182)
create or replace function public.tally_period_next_paced(p_book uuid, p_max integer, p_night boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare p tally_period_pulls%rowtype; r record; fy_to date; today date := (now() at time zone 'Asia/Kolkata')::date; out jsonb := '[]'::jsonb; d date; n int := 0;
  types jsonb; fetch boolean := false; lim int := least(greatest(coalesce(p_max, 3), 0), 30); rc timestamptz; nr int := 0;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  if not found or p.state <> 'going' or lim = 0 then return out; end if;
  -- ROUND 103 (the owner's decision of 21-Oct-2026, evening): tally-ingest asks 3 by day, up to 30 outside the computer's
  -- office hours; the pace kept for the status line
  update tally_period_pulls set pace = case when coalesce(p_night, lim > 3) then 'night' else 'day' end, pace_at = now() where book_id = p_book;
  fy_to := (p.fy_start + interval '1 year' - interval '1 day')::date;
  -- 182 (B): the book's gap open 2 minutes whose own days Tally's Day Book matches (the changes are on older dates): a day
  -- counted before FinCom first saw Tally's number now is counted again, once a book and number, one light day at a time
  -- (the computer idle, paced: tally_light_may), after the days never counted
  select case when cu.gap_at <= now() - interval '2 minutes' and tally_gap_own_read(p_book, cu.gap) then gn.first_at end into rc
    from tally_sync_cursor cu join tally_gap_numbers gn on gn.book_id = cu.book_id and gn.altvchid::text = cu.gap->>'tally_altvchid'
   where cu.book_id = p_book and cu.gap is not null;
  select d_from, d_to into r from tally_period_range(p.fy_start, p.part);
  -- counting: the year's days with no count yet
  for d in select g::date from generate_series(least(fy_to, today), p.fy_start, interval '-1 day') g
            where not exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date and (x.tally_n is not null or x.upload_at is not null))
            order by exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date and x.asked_at > now() - interval '2 minutes'), g desc
            limit lim loop
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', false, 'chosenAt', p.chosen_at));
    n := n + 1;
  end loop;
  if n = 0 and rc is not null and tally_light_may(p_book) then
    for d in select x.day from tally_period_days x
              where x.book_id = p_book and x.day between p.fy_start and least(fy_to, today) and x.tally_n is not null and x.upload_at is null
                and coalesce(x.counted_at, '-infinity'::timestamptz) < rc
              order by (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit 1 loop
      out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', false, 'chosenAt', p.chosen_at));
      nr := 1;
      perform tally_light_took(p_book);
    end loop;
  end if;
  if n = 0 and not exists (select 1 from generate_series(least(fy_to, today), p.fy_start, interval '-1 day') g
                            where not exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date and (x.tally_n is not null or x.upload_at is not null))) then
    -- the year is counted: the part's days FinCom does not hold whole; a locked month's days marked to upload, not fetched
    update tally_period_days x set upload_at = now(), upload_why = 'locked',
           upload_words = 'FinCom did not bring in ' || to_char(x.day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month, then upload that day''s Day Book.'
     where x.book_id = p_book and x.day between r.d_from and least(r.d_to, today) and x.tally_n > 0 and x.done_at is null and x.upload_at is null
       and tally_month_locked(p_book, array[x.day]) is not null;
    for d in select x.day from tally_period_days x
              where x.book_id = p_book and x.day between r.d_from and least(r.d_to, today) and x.tally_n > 0 and x.done_at is null and x.upload_at is null
              order by (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit greatest(lim - nr, 0) loop
      out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', p.chosen_at));
      n := n + 1;
    end loop;
  end if;
  n := n + nr;
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
    insert into tally_period_days (book_id, firm_id, day, asked_at, first_asked_at)
    select p_book, p.firm_id, to_date(e->>'day', 'YYYYMMDD'), now(), now() from jsonb_array_elements(out) e
    on conflict (book_id, day) do update set asked_at = now(), first_asked_at = coalesce(tally_period_days.first_asked_at, now());
  end if;
  return out;
end $function$;

-- 135's tally_fill_request: each day to the client's book whose year has it; not again once read for Tally's number; a
-- gap's older days as light days (B, C; marked 182)
create or replace function public.tally_fill_request(p_client text, p_days date[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); bk uuid; b tally_books%rowtype; lo date; n int := 0; m int; today date := (now() at time zone 'Asia/Kolkata')::date; p tally_period_pulls%rowtype;
  bx record; cu tally_sync_cursor%rowtype; gn tally_gap_numbers%rowtype; fa timestamptz; older boolean; ga date; nl int := 0;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role in ('owner', 'staff')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select x.book_id into bk from tally_books x where x.firm_id = f and x.client_id = p_client order by x.from_date desc nulls last, x.book_id limit 1;
  if bk is null then return jsonb_build_object('ok', false, 'error', 'This client''s books are not linked to Tally yet.'); end if;
  -- 182: each day to the client's book whose year has it (the latest book that begins on or before it; else the latest)
  for bx in select z.bid, array_agg(z.d order by z.d desc) as ds
             from (select y.d, coalesce((select t.book_id from tally_books t where t.firm_id = f and t.client_id = p_client and t.from_date <= y.d
                                          order by t.from_date desc, t.book_id limit 1), bk) as bid
                     from (select distinct d from unnest(coalesce(p_days, '{}'::date[])) d where d is not null and d <= today order by d desc limit 400) y) z
            group by z.bid loop
    select * into b from tally_books where book_id = bx.bid;
    lo := least(b.from_date, (select min(v.day) from tally_vouchers v where v.book_id = bx.bid and v.deleted_at is null));
    perform pg_advisory_xact_lock(hashtext('tally_check_request:' || bx.bid::text));
    -- 182: the book's open gap: a day read whole since Tally's number now was seen is not queued again; when the gap's own
    -- days match Tally (the changes are on older dates), its older days go as light days (read while nobody would feel it)
    select * into cu from tally_sync_cursor where book_id = bx.bid;
    select * into gn from tally_gap_numbers where book_id = bx.bid;
    fa := case when cu.gap is not null and gn.book_id is not null and gn.altvchid::text = cu.gap->>'tally_altvchid' then gn.first_at end;
    older := fa is not null and tally_gap_own_read(bx.bid, cu.gap);
    ga := case when older then ((cu.gap->>'since')::timestamptz at time zone 'Asia/Kolkata')::date end;
    if older then
      insert into tally_light_days (book_id, firm_id, day, why, queued_at)
      select bx.bid, f, d, 'fill', now() from unnest(bx.ds) d where d < ga and (lo is null or d >= lo) and not tally_day_read_for(bx.bid, d, fa)
      on conflict (book_id, day) do update set why = excluded.why, queued_at = now(), handed_at = null where tally_light_days.handed_at is not null;
      get diagnostics m = row_count;
      nl := nl + m;
    end if;
    insert into tally_check_days (book_id, firm_id, day, source, queued_at)
    select bx.bid, f, d, 'fill', now()
      from unnest(bx.ds) d where (lo is null or d >= lo) and not (older and d < ga) and not tally_day_read_for(bx.bid, d, fa)
    on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null, heads = null, via = null,
      listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null
      where tally_check_days.upload_at is null and tally_check_days.done_at is not null and tally_check_days.done_at < now() - interval '6 hours';
    get diagnostics m = row_count;
    n := n + m;
    if m > 0 then
      insert into tally_check_runs (book_id, firm_id) values (bx.bid, f) on conflict (book_id) do nothing;
      -- "Bring books from Tally" stopped by the person: the missing days go on under a new choice time (a bridge's stop holds)
      select * into p from tally_period_pulls where book_id = bx.bid;
      if found and p.state = 'stopped' and p.stop_why = 'person' then
        update tally_check_runs set chosen_at = now() where book_id = bx.bid and state = 'going' and chosen_at <= coalesce(p.stopped_at, p.chosen_at);
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'queued', n, 'light', nl, 'fill', tally_book_fetch_of(bk)->'fill');
end $function$;

-- ---------------------------------------------------------------- 7. who may call
revoke all on function public.tally_gap_own_read(uuid, jsonb), public.tally_gap_state(uuid, jsonb, timestamptz), public.tally_light_may(uuid), public.tally_light_took(uuid),
  public.tally_day_read_for(uuid, date, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_gap_own_read(uuid, jsonb), public.tally_gap_state(uuid, jsonb, timestamptz), public.tally_light_may(uuid), public.tally_light_took(uuid),
  public.tally_day_read_for(uuid, date, timestamptz) to service_role;
revoke all on function public.tally_gap_front(uuid, integer, boolean), public.tally_gap_front(uuid, integer) from public, anon, authenticated;
grant execute on function public.tally_gap_front(uuid, integer, boolean), public.tally_gap_front(uuid, integer) to service_role;
revoke all on function public.tally_sync_cursor_gap_checking(), public.tally_post_job_read_back() from public, anon, authenticated, service_role;
revoke all on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) to service_role;
revoke all on function public.tally_check_stop(uuid, date, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_check_stop(uuid, date, text, text, timestamptz) to service_role;
revoke all on function public.tally_period_next_paced(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_period_next_paced(uuid, integer, boolean) to service_role;
revoke all on function public.tally_fill_request(text, date[]) from public, anon;
grant execute on function public.tally_fill_request(text, date[]) to authenticated, service_role;

commit;
